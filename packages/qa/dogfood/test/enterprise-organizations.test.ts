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
 *
 * ── #16539 — why the subject below is a `@fixture/*` name ────────────────────
 *
 * Every verdict here is a statement about what a host root HAS and, just as
 * load-bearing, what it has NOT got. Until #16215 the second half came free:
 * `@objectstack/organizations` was cloud-private, so a temp host that declared
 * it and did not install it was unresolvable by construction. ADR-0132 (#16215)
 * brought the package into this workspace; pnpm's hoisted store carries it, and every
 * `pnpm exec`-launched runner (vitest's bin shim included) exports a `NODE_PATH`
 * that reaches that store. From then on the CONTROL's verdict was a function of
 * whether an unrelated package had been BUILT: green on CI, whose task graph
 * never builds it, red on any tree that had run a full `pnpm build`.
 *
 * The visible half of that is a false red. The half that matters is the quiet
 * one — a control whose subject is reachable is no longer controlling the thing
 * its name claims, and nothing says so. So the cases below drive a name this
 * workspace can never contain, and PROVE its absence instead of assuming it;
 * `ORGANIZATIONS_PKG` stays pinned as the probe's default subject by its own
 * case. #16723 made exactly this repair to `packages/types/src/node.test.ts`
 * for the same landing, and this file reuses its `@fixture/*` scope.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostRequire } from '@objectstack/types/node';
import { probeOrganizations, MULTI_ORG_ENV, ORGANIZATIONS_PKG } from './enterprise-organizations.js';

/**
 * The package name every fixture host below is built around: modelled on the
 * real enterprise plugin (its export is the class `serve` / `bootStack`
 * construct), fixture-only in NAME.
 *
 * ⚠️ #16539 — it must stay a `@fixture/*` name. A name this workspace owns
 * cannot state "this host root does not have it", because the hoisted store and
 * the launcher's `NODE_PATH` answer that question instead of the fixture; and no
 * workspace name is safe from becoming one (`@objectstack/organizations` was
 * cloud-private when these cases were written). Only a name the workspace can
 * never contain is, and the PREMISE cases below prove this one still is not.
 */
const HOST_ONLY = '@fixture/enterprise-organizations';

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
 *
 * ⚠️ #16539 — "NOT installed" is a property of THIS directory, and only a
 * subject the workspace can never supply keeps it one. See {@link HOST_ONLY}.
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
      ...(declare ? { dependencies: { [HOST_ONLY]: '*' } } : {}),
    }),
    'utf8',
  );
  if (withPkg) {
    const pkgDir = join(dir, 'node_modules', ...HOST_ONLY.split('/'));
    mkdirSync(pkgDir, { recursive: true });
    if (opts.typesOnly) {
      // No `require` condition (the CJS resolver throws) and no `import`
      // condition (the #14041 fallback finder has nothing to load) — the
      // manifest names nothing runnable at all.
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({
          name: HOST_ONLY,
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
        name: HOST_ONLY,
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

describe('multi-org runtime availability probe (#4700)', () => {
  it('reports AVAILABLE when the package is installed in the host app', async () => {
    // The verdict the old probe could never reach, no matter what any app or CI
    // had installed. This is what makes `describe.skipIf(!organizationsAvailable)`
    // a real gate rather than an unconditional skip.
    const probe = await probeOrganizations(hostWithPkg, false, HOST_ONLY);
    expect(probe.available).toBe(true);
    expect(probe.reason).toBeUndefined();
  });

  it('reports UNAVAILABLE, with an actionable reason, when the app lacks it', async () => {
    const probe = await probeOrganizations(hostWithoutPkg, false, HOST_ONLY);
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
    await expect(probeOrganizations(hostWithoutPkg, true, HOST_ONLY)).rejects.toThrow(
      new RegExp(`${MULTI_ORG_ENV}=1 declares`),
    );
  });

  it('does not throw when the run declares the package AND it is there', async () => {
    await expect(probeOrganizations(hostWithPkg, true, HOST_ONLY)).resolves.toEqual({ available: true });
  });

  it('reports UNAVAILABLE when the package is merely PRESENT but not declared (#4719)', async () => {
    // The gate is the app's declaration, not what happens to be reachable. Under
    // the old resolver this host answered AVAILABLE — same bytes on disk, same
    // package.json, and the multi-org gates would run for an app that never
    // asked for the enterprise runtime. Worse, in a real pnpm workspace the
    // "present" half arrives via the bin shim's NODE_PATH, so the verdict moved
    // with the launcher.
    const probe = await probeOrganizations(hostInstalledButUndeclared, false, HOST_ONLY);
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain("package.json");
  });

  it('THROWS with a DECLARE-it remedy when the run declares it but the app does not (#4719)', async () => {
    // The remedy has to be the one that works. "Install it" is unfollowable
    // advice here — it is already installed; the missing act is declaring it.
    await expect(probeOrganizations(hostInstalledButUndeclared, true, HOST_ONLY)).rejects.toThrow(
      new RegExp(`declare ${HOST_ONLY.replace('/', '\\/')} in .* package\\.json`),
    );
  });

  it('CONTROL — the `declared-unresolvable` remedy is unchanged: declared, not installed', async () => {
    // The arm #14270 did NOT touch. Pinned here so the three-way rewrite is a
    // measurement: this text has to be byte-identical either side of it.
    const probe = await probeOrganizations(hostDeclaredNotInstalled, false, HOST_ONLY);
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain(
      `${hostDeclaredNotInstalled} DECLARES ${HOST_ONLY}, so repair its INSTALL there `
      + '(`pnpm install`, un-prune, rebuild its dist)',
    );
  });

  it('DEFERS to the importer when the package is declared, installed, and unloadable (#14270)', async () => {
    // #14041's third kind. This probe's remedy was a two-way branch written for
    // two, so `declared-no-loadable-entry` fell into the else leg and told an
    // operator whose app DECLARES the package and HAS it installed to declare
    // it and install it. No install action can change what a package publishes.
    const probe = await probeOrganizations(hostDeclaredNoLoadableEntry, false, HOST_ONLY);
    expect(probe.available).toBe(false);
    // Which arm fired: the deferral names the two things that are NOT the
    // problem and hands the remedy to the importer's message, which this
    // reason interpolates at the end.
    expect(probe.reason).toContain('and it IS installed, so neither is the problem');
    expect(probe.reason).toContain('publishes no entry Node can load');
    // ⛔ Neither of the other two arms — both are unfollowable for this kind.
    expect(probe.reason).not.toContain(`declare ${HOST_ONLY} in`);
    expect(probe.reason).not.toContain('repair its INSTALL');
    // The message deferred TO has to actually arrive.
    expect(probe.reason).toContain('publishes no entry that Node can load');
  });

  it('THROWS with that same deferral when the run declares the package (#14270)', async () => {
    // The loud half: MULTI_ORG=1 says the package is there, and it IS — it just
    // cannot be loaded. The refusal must still name the right remedy.
    const err = await probeOrganizations(hostDeclaredNoLoadableEntry, true, HOST_ONLY).then(
      () => new Error('probeOrganizations resolved; MULTI_ORG=1 must make this a failure'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toContain(MULTI_ORG_ENV);
    expect(err.message).toContain('and it IS installed, so neither is the problem');
    expect(err.message).not.toContain(`declare ${HOST_ONLY} in`);
  });
});

/**
 * #16539 — the premises the cases above rest on, asserted instead of assumed.
 *
 * Both legs are load-bearing and they fail in opposite directions. Without leg 1
 * a name that exists nowhere at all satisfies leg 2 and every verdict above is
 * vacuous; without leg 2 the fixture stops deciding what the host root has, and
 * the CONTROL silently starts measuring the ambient workspace — which is exactly
 * how this file broke.
 */
describe('PREMISE — the fixture subject is host-only (#16539)', () => {
  it('resolves from a host app that installs it', () => {
    // Leg 1. The fixture host really can see it, so "unresolvable" elsewhere is
    // a statement about the resolver's anchor and not about a typo.
    const fromHost = createHostRequire(hostWithPkg).resolve(HOST_ONLY);
    expect(fromHost).toContain(hostWithPkg);
  });

  it('is absent from every ambient store the runner exposes', () => {
    // Leg 2, and the guard that would have caught this card. Asserted on the
    // BARE SPECIFIER, ⛔ never on `/Cannot find module/` alone: a package the
    // runner CAN see whose entry file merely is not on disk throws
    // MODULE_NOT_FOUND too, naming `<store>/<pkg>/dist/index.js` instead of the
    // specifier. That second throw is what kept the CONTROL above green while
    // the property went unguarded — `@objectstack/organizations` was reachable
    // through the pnpm bin shim's NODE_PATH and simply unbuilt on CI's graph.
    // Read as a bare-specifier failure, the premise can no longer be satisfied
    // by an unbuilt workspace package, in either build state.
    expect(() => createHostRequire(hostDeclaredNotInstalled).resolve(HOST_ONLY)).toThrow(
      new RegExp(`Cannot find module '${HOST_ONLY}'`),
    );
  });

  it('and the probe still binds the ENTERPRISE package as its default subject', () => {
    // What the fixture name must NOT quietly become: the subject. Production
    // callers pass no specifier, and the one they get is the real package.
    expect(ORGANIZATIONS_PKG).toBe('@objectstack/organizations');
    expect(HOST_ONLY).not.toBe(ORGANIZATIONS_PKG);
  });

  it("and this package's own resolution still cannot see it", async () => {
    // The sentence that used to sit in `enterprise-organizations.ts` as prose —
    // "resolvable from nowhere in the framework workspace" — died with #16215
    // and nothing noticed. It is an assertion now, on the default subject, over
    // the arm that actually uses this module's ESM base.
    //
    // ⚠️ A red here is NOT a fixture problem: it means `@objectstack/dogfood`
    // can now resolve the enterprise package, so `organizationsAvailable` is
    // true in the framework repo and the multi-org gates have started running
    // here. Read the verdict, then decide — do not re-point this case.
    const probe = await probeOrganizations(hostWithoutPkg, false);
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain(`declare ${ORGANIZATIONS_PKG} in`);
  });
});
