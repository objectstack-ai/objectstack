// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18677, the BEHAVIOURAL half — `os validate` and `os build` report the same
 * author-time advisory set for a MULTI-PACKAGE project.
 *
 * `os build` ran the rule table a second time, once per `artifactPackages(…)`
 * entry; `os validate` ran the union fold and stopped. By `compile.ts`' own
 * description the survivors of that pass are "exactly the set the union could
 * not see" ⇒ that whole set was findings `os build` reported and `os validate`
 * structurally could not. FALSE-CLEAN, on the fast pre-flight an author runs
 * before shipping.
 *
 * ## Why a NEW fixture and not an assertion on the existing parity file
 *
 * `test/build-json-advisory-parity.e2e.test.ts` already asserts, in so many
 * words, that "nothing rides in build's `warnings` that validate does not also
 * report" — and it stayed green through this entire defect. Its fixtures are
 * SINGLE-package: they declare no `packages[]`, `artifactPackages` returns `[]`,
 * the per-package pass is skipped on both doors, and the two agree for the wrong
 * reason. The claim was right and the fixture was blind to the one shape that
 * can falsify it. ⇒ what this file adds is the shape, not a new claim.
 *
 * Measured on `origin/main` 09e16a574 over `examples/app-multi-package` (the
 * repo's own two-package fixture), both commands exiting 0:
 *
 *   os build    --json  warnings: 4   <- 3 union + 1 per-package survivor
 *   os validate --json  warnings: 3   <- the survivor is the defect
 *
 * ## The survivor on that fixture is an ECHO, and this file says so
 *
 * ⚠️ The de-duplication key includes the POSITIONAL `path`, and a collection
 * index inside one package's own body is not the index the flattened top level
 * gives the same item — so on `examples/app-multi-package` what survives is the
 * union's own `crm_account.industry` finding re-reported at the package-local
 * index, not something the union could not see. That is a separate defect in
 * the key (filed, not fixed here — fixing it changes what `os build` reports,
 * which is a different decision from making the two doors agree). It does not
 * weaken these pins: whatever the pass produces, the assertion is that BOTH
 * doors produce it, so the pins measure parity rather than the survivor's
 * pedigree. The `where` prefix (`package '<id>' — …`) is what identifies a
 * per-package finding here, and it is the pass's own, not this file's guess.
 *
 * ## Tier
 *
 * SPAWNS the CLI ⇒ INTEGRATION tier by `packages/cli/vitest-tiers.ts`' predicate
 * (`childProcess` + `helperCliOrTsx`). The filename deliberately carries no
 * `.e2e` segment, so by the orthogonal NIGHTLY cut it is a QUEUE-tier file — the
 * combination that tiers module names as deliberate. Its unit-tier sibling is
 * `validate-per-package-authoring-seam.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

function payloadOf(run: Run, label: string): Record<string, unknown> {
  try {
    return JSON.parse(run.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

/** The `where` prefix `runPerPackageAuthoringRules` puts on every finding it raises. */
const PER_PACKAGE_WHERE = /^package '[^']+' — /;

const perPackageWarnings = (warnings: unknown[]): string[] =>
  warnings
    .filter((w): w is { where: string } => typeof (w as { where?: unknown })?.where === 'string')
    .map((w) => w.where)
    .filter((where) => PER_PACKAGE_WHERE.test(where));

/**
 * The two package bodies, mirroring `examples/app-multi-package`: an App package
 * owning `pp_account` and publishing the navigation container, plus a module
 * owning `pp_order`, whose `account` lookup points at the sibling's object —
 * legal under ADR-0130 §1.5, and the point of the shape.
 */
const CONFIG_MULTI = `
const coreManifest = {
  id: 'com.example.ppparity.core', name: 'ppparity core', namespace: 'pp',
  version: '1.0.0', type: 'app', engines: { protocol: '^17' },
};
const coreObjects = [{
  name: 'pp_account', label: 'Account', pluralLabel: 'Accounts', sharingModel: 'private',
  fields: {
    name: { name: 'name', type: 'text', label: 'Account Name', required: true },
    industry: { name: 'industry', type: 'text', label: 'Industry' },
  },
}];
const coreApps = [{
  name: 'pp_crm', label: 'PP CRM',
  navigation: [{
    id: 'sales_group', type: 'group', label: 'Sales',
    children: [{ id: 'nav_accounts', type: 'object', objectName: 'pp_account', label: 'Accounts' }],
  }],
}];

const ordersManifest = {
  id: 'com.example.ppparity.orders', name: 'ppparity orders', namespace: 'pp',
  version: '1.0.0', type: 'module', engines: { protocol: '^17' },
  dependencies: { 'com.example.ppparity.core': '^1.0.0' },
};
const ordersObjects = [{
  name: 'pp_order', label: 'Order', pluralLabel: 'Orders', sharingModel: 'private',
  fields: {
    name: { name: 'name', type: 'text', label: 'Order Number', required: true },
    account: { name: 'account', type: 'lookup', label: 'Account', reference: 'pp_account' },
  },
}];

export default {
  // The ARTIFACT's own identity: \`preserve\` is additive, so the singular
  // manifest is still picked by the default 'last' rule (ADR-0019 D1) and
  // carries manifest fields ONLY — \`ManifestSchema\` is strict, and a
  // collection key here is refused by name.
  manifest: coreManifest,
  objects: [...ordersObjects, ...coreObjects],
  apps: [...coreApps],
  // …and the per-package view the runtime registers from (ADR-0130 D4/D5). Each
  // entry's \`manifest\` is that package ASSEMBLED — its manifest fields with the
  // collections it owns written over them — which is the superset
  // \`packageBodyAsStack\` reads back as one package's stack.
  packages: [
    { manifest: { ...ordersManifest, objects: ordersObjects } },
    { manifest: { ...coreManifest, objects: coreObjects, apps: coreApps } },
  ],
};
`;

/**
 * The CONTROL: one package, no `packages[]`. The per-package pass is skipped on
 * both doors, so parity here holds for a reason that has nothing to do with the
 * fix — which is precisely how the defect survived the existing parity file.
 * Without this case, "the two payloads agree" cannot be read as a measurement of
 * anything.
 */
const CONFIG_SINGLE = `
export default {
  manifest: {
    id: 'com.example.ppsingle', name: 'ppsingle', namespace: 'ps',
    version: '1.0.0', type: 'app', engines: { protocol: '^17' },
  },
  objects: [{
    name: 'ps_thing', label: 'Thing', pluralLabel: 'Things', sharingModel: 'private',
    fields: {
      name: { name: 'name', type: 'text', label: 'Name', required: true },
      unused: { name: 'unused', type: 'text', label: 'Unused' },
    },
  }],
  apps: [{
    name: 'ps_app', label: 'PS App',
    navigation: [{ id: 'nav_things', type: 'object', objectName: 'ps_thing', label: 'Things' }],
  }],
};
`;

const dirs = { multi: '', single: '' };

function plant(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-ppparity-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'objectstack.config.ts'), config, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'ppparity-fixture', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  return dir;
}

describe('#18677 — `os validate` and `os build` report the same per-package advisory set', () => {
  beforeAll(() => {
    dirs.multi = plant(CONFIG_MULTI);
    dirs.single = plant(CONFIG_SINGLE);
  });

  afterAll(() => {
    for (const dir of Object.values(dirs)) if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the multi-package fixture reaches the pass at all — `os build` raises a per-package finding', async () => {
    // Asserted BEFORE any claim about parity: a fixture that never reaches the
    // per-package pass makes every comparison below vacuous, which is the exact
    // way this defect stayed invisible.
    const build = await runCli(['build', '--json'], dirs.multi);
    expect(build.code, `os build --json failed:\n${build.stdout}${build.stderr}`).toBe(0);
    const warnings = payloadOf(build, 'os build --json').warnings as unknown[];
    expect(perPackageWarnings(warnings).length).toBeGreaterThan(0);
  }, 180_000);

  it('`os validate` reports every per-package advisory `os build` does', async () => {
    // The pin. On `origin/main` 09e16a574 this read `build: 1, validate: 0`.
    const build = await runCli(['build', '--json'], dirs.multi);
    const validate = await runCli(['validate', '--json'], dirs.multi);
    expect(build.code, `os build --json failed:\n${build.stdout}${build.stderr}`).toBe(0);
    expect(validate.code, `os validate --json failed:\n${validate.stdout}${validate.stderr}`).toBe(0);

    const bw = payloadOf(build, 'os build --json').warnings as unknown[];
    const vw = payloadOf(validate, 'os validate --json').warnings as unknown[];

    const inValidate = new Set(perPackageWarnings(vw));
    const missingFromValidate = perPackageWarnings(bw).filter((w) => !inValidate.has(w));
    expect(
      missingFromValidate,
      'these per-package findings ride `os build` and `os validate` cannot see them — the #18677 false-clean set',
    ).toEqual([]);
  }, 180_000);

  it('…and nothing per-package rides `os validate` that `os build` does not report either', async () => {
    // The reverse end. Parity is an equality, and a validate that over-reports
    // is its own defect — an author fixing a finding the command that SHIPS
    // never raises.
    const build = await runCli(['build', '--json'], dirs.multi);
    const validate = await runCli(['validate', '--json'], dirs.multi);
    const bw = payloadOf(build, 'os build --json').warnings as unknown[];
    const vw = payloadOf(validate, 'os validate --json').warnings as unknown[];

    const inBuild = new Set(perPackageWarnings(bw));
    expect(perPackageWarnings(vw).filter((w) => !inBuild.has(w))).toEqual([]);
  }, 180_000);

  it('CONTROL — a single-package project raises NO per-package finding on either door', async () => {
    // "Present" must be distinguishable from "always present": the prefix this
    // file matches on is not something either command emits unconditionally.
    const build = await runCli(['build', '--json'], dirs.single);
    const validate = await runCli(['validate', '--json'], dirs.single);
    expect(build.code, `os build --json failed:\n${build.stdout}${build.stderr}`).toBe(0);
    expect(validate.code, `os validate --json failed:\n${validate.stdout}${validate.stderr}`).toBe(0);
    expect(perPackageWarnings(payloadOf(build, 'os build --json').warnings as unknown[])).toEqual([]);
    expect(perPackageWarnings(payloadOf(validate, 'os validate --json').warnings as unknown[])).toEqual([]);
  }, 180_000);
});
