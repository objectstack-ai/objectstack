// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4700 — proof that the multi-org availability probe is no longer constant.
 *
 * The old probe answered "unavailable" in every environment because it resolved
 * a cloud-private package against the framework workspace. Nothing detected that
 * — a `describe.skipIf` that always skips leaves no trace beyond a warning line,
 * and the suite stays green. The only way to know a capability probe works is to
 * make it say BOTH things, on demand.
 *
 * So these cases build real host roots on disk (real `node_modules`, a real
 * stand-in package, nothing mocked) and pin all three verdicts: available,
 * unavailable, and declared-but-missing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeOrganizations, MULTI_ORG_ENV, ORGANIZATIONS_PKG } from './enterprise-organizations.js';

let hostWithPkg: string;
let hostWithoutPkg: string;
/**
 * #4719 — the package is physically INSTALLED in the app's own `node_modules`
 * and the app's `package.json` never mentions it. That is what a hoisted
 * workspace store (or a `NODE_PATH` a pnpm bin shim exported) looks like to the
 * resolver, and it used to read as AVAILABLE.
 */
let hostInstalledButUndeclared: string;
/**
 * #14041/#14270 — declared AND installed, and the package's own `exports` names
 * no runtime entry Node can load (a `types`-only publish). The third
 * `HostImportFailureKind`; no install action can change what a package
 * publishes, so the "declare it and install it" remedy is unfollowable here.
 */
let hostDeclaredNoLoadableEntry: string;
/**
 * The `declared-unresolvable` CONTROL: declared and NOT installed. #14270 left
 * this arm alone, so its wording must come out byte-identical.
 */
let hostDeclaredNotInstalled: string;

function writeHost(
  prefix: string,
  withPkg: boolean,
  opts: { declare?: boolean; typesOnly?: boolean } = {},
): string {
  const declare = opts.declare ?? withPkg;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'dogfood-host-fixture',
      private: true,
      type: 'module',
      ...(declare ? { dependencies: { [ORGANIZATIONS_PKG]: '*' } } : {}),
    }),
    'utf8',
  );
  if (withPkg) {
    const pkgDir = join(dir, 'node_modules', ...ORGANIZATIONS_PKG.split('/'));
    mkdirSync(pkgDir, { recursive: true });
    if (opts.typesOnly) {
      // No `require` condition (the CJS resolver throws) and no `import`
      // condition (the #14041 fallback finder has nothing to load) — the
      // manifest names nothing runnable at all.
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({
          name: ORGANIZATIONS_PKG,
          version: '0.0.0-fixture',
          type: 'module',
          exports: { '.': { types: './index.d.ts' } },
        }),
        'utf8',
      );
      writeFileSync(
        join(pkgDir, 'index.d.ts'),
        'export declare class OrganizationsPlugin {}\n',
        'utf8',
      );
      return dir;
    }
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: ORGANIZATIONS_PKG,
        version: '0.0.0-fixture',
        type: 'module',
        main: 'index.js',
      }),
      'utf8',
    );
    writeFileSync(
      join(pkgDir, 'index.js'),
      'export class OrganizationsPlugin { name = "com.objectstack.organizations"; }\n',
      'utf8',
    );
  }
  return dir;
}

beforeAll(() => {
  hostWithPkg = writeHost('os-dogfood-org-ok-', true);
  hostWithoutPkg = writeHost('os-dogfood-org-missing-', false);
  hostInstalledButUndeclared = writeHost('os-dogfood-org-undeclared-', true, { declare: false });
  hostDeclaredNoLoadableEntry = writeHost('os-dogfood-org-no-entry-', true, { typesOnly: true });
  hostDeclaredNotInstalled = writeHost('os-dogfood-org-not-installed-', false, { declare: true });
});

afterAll(() => {
  for (const dir of [
    hostWithPkg,
    hostWithoutPkg,
    hostInstalledButUndeclared,
    hostDeclaredNoLoadableEntry,
    hostDeclaredNotInstalled,
  ]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('enterprise multi-org probe (#4700)', () => {
  it('reports AVAILABLE when the package is installed in the host app', async () => {
    // The verdict the old probe could never reach, no matter what any app or CI
    // had installed. This is what makes `describe.skipIf(!organizationsAvailable)`
    // a real gate rather than an unconditional skip.
    const probe = await probeOrganizations(hostWithPkg, false);
    expect(probe.available).toBe(true);
    expect(probe.reason).toBeUndefined();
  });

  it('reports UNAVAILABLE, with an actionable reason, when the app lacks it', async () => {
    const probe = await probeOrganizations(hostWithoutPkg, false);
    expect(probe.available).toBe(false);
    // The reason has to name the switch, or the skip stays folklore.
    expect(probe.reason).toContain(MULTI_ORG_ENV);
    expect(probe.reason).toContain(hostWithoutPkg);
  });

  it('THROWS when the run declares the package but it is missing', async () => {
    // The half that converts "silently green over gates that never ran" into a
    // failure a CI operator cannot miss (Prime Directive #10 / "absence must be
    // loud"). Without this, a cloud run that lost the package would look exactly
    // like a cloud run that has it.
    await expect(probeOrganizations(hostWithoutPkg, true)).rejects.toThrow(
      new RegExp(`${MULTI_ORG_ENV}=1 declares`),
    );
  });

  it('does not throw when the run declares the package AND it is there', async () => {
    await expect(probeOrganizations(hostWithPkg, true)).resolves.toEqual({ available: true });
  });

  it('reports UNAVAILABLE when the package is merely PRESENT but not declared (#4719)', async () => {
    // The gate is the app's declaration, not what happens to be reachable. Under
    // the old resolver this host answered AVAILABLE — same bytes on disk, same
    // package.json, and the multi-org gates would run for an app that never
    // asked for the enterprise runtime. Worse, in a real pnpm workspace the
    // "present" half arrives via the bin shim's NODE_PATH, so the verdict moved
    // with the launcher.
    const probe = await probeOrganizations(hostInstalledButUndeclared, false);
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain("package.json");
  });

  it('THROWS with a DECLARE-it remedy when the run declares it but the app does not (#4719)', async () => {
    // The remedy has to be the one that works. "Install it" is unfollowable
    // advice here — it is already installed; the missing act is declaring it.
    await expect(probeOrganizations(hostInstalledButUndeclared, true)).rejects.toThrow(
      new RegExp(`declare ${ORGANIZATIONS_PKG.replace('/', '\\/')} in .* package\\.json`),
    );
  });

  it('CONTROL — the `declared-unresolvable` remedy is unchanged: declared, not installed', async () => {
    // The arm #14270 did NOT touch. Pinned here so the three-way rewrite is a
    // measurement: this text has to be byte-identical either side of it.
    const probe = await probeOrganizations(hostDeclaredNotInstalled, false);
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain(
      `${hostDeclaredNotInstalled} DECLARES ${ORGANIZATIONS_PKG}, so repair its INSTALL there `
      + '(`pnpm install`, un-prune, rebuild its dist)',
    );
  });

  it('DEFERS to the importer when the package is declared, installed, and unloadable (#14270)', async () => {
    // #14041's third kind. This probe's remedy was a two-way branch written for
    // two, so `declared-no-loadable-entry` fell into the else leg and told an
    // operator whose app DECLARES the package and HAS it installed to declare
    // it and install it. No install action can change what a package publishes.
    const probe = await probeOrganizations(hostDeclaredNoLoadableEntry, false);
    expect(probe.available).toBe(false);
    // Which arm fired: the deferral names the two things that are NOT the
    // problem and hands the remedy to the importer's message, which this
    // reason interpolates at the end.
    expect(probe.reason).toContain('and it IS installed, so neither is the problem');
    expect(probe.reason).toContain('publishes no entry Node can load');
    // ⛔ Neither of the other two arms — both are unfollowable for this kind.
    expect(probe.reason).not.toContain(`declare ${ORGANIZATIONS_PKG} in`);
    expect(probe.reason).not.toContain('repair its INSTALL');
    // The message deferred TO has to actually arrive.
    expect(probe.reason).toContain('publishes no entry that Node can load');
  });

  it('THROWS with that same deferral when the run declares the package (#14270)', async () => {
    // The loud half: MULTI_ORG=1 says the package is there, and it IS — it just
    // cannot be loaded. The refusal must still name the right remedy.
    const err = await probeOrganizations(hostDeclaredNoLoadableEntry, true).then(
      () => new Error('probeOrganizations resolved; MULTI_ORG=1 must make this a failure'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toContain(MULTI_ORG_ENV);
    expect(err.message).toContain('and it IS installed, so neither is the problem');
    expect(err.message).not.toContain(`declare ${ORGANIZATIONS_PKG} in`);
  });
});
