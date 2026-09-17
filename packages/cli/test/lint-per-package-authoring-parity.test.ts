// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18778, the BEHAVIOURAL half — `os lint` and `os build` report the same
 * author-time finding set for a MULTI-PACKAGE project, and the `--strict` exit
 * that only the real binary can be asked about.
 *
 * `os build` has run the rule table a second time, once per
 * `artifactPackages(…)` entry, since #16611; `os validate` joined it in #18677.
 * `os lint` ran the union fold and stopped, so the survivors of that pass —
 * "exactly the set the union could not see", in `compile.ts`' own words — were
 * findings `os build` reported and `os lint` structurally could not.
 *
 * ## Why this file exists next to the in-process seam pin
 *
 * `lint-per-package-authoring-seam.test.ts` reaches `lintConfig` directly, which
 * is where the findings are produced — and that is exactly what it CANNOT
 * answer about: `os lint`'s verdict is `failing = errors + (strict ? warnings :
 * 0)`, computed in `run()`, above the two faces and below no test that does not
 * spawn. The NARROWING this card lands is a `--strict` exit, so the pin for it
 * has to be a process.
 *
 * ## The reading this file was written from
 *
 * On `origin/main` 7572329069, over `CONFIG_FLIP` below — a project whose union
 * run raises NOTHING and whose per-package run raises one advisory:
 *
 *     os build  --json            warnings 1   <- per-package only
 *     os lint   --json            total 0      ✓ exit 0
 *     os lint   --json --strict   total 0      ✓ exit 0   <- the false clean
 *
 * and after: `os lint --json` total 1, `os lint --json --strict` exit 1. That
 * exit is a NEWLY-REFUSED INPUT on this door, exhibited rather than reasoned
 * about — ⛔ #18677's `Clause-②: no` was measured on `os validate`'s door and
 * does not transfer.
 *
 * ## Tier
 *
 * SPAWNS the CLI ⇒ INTEGRATION tier by `packages/cli/vitest-tiers.ts`' predicate
 * (`childProcess` + `helperCliOrTsx`). The filename carries no `.e2e` segment,
 * so by the orthogonal NIGHTLY cut it is a QUEUE-tier file — the combination
 * that module names as deliberate.
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

/**
 * `os build` publishes `where` as its own key; `os lint` folds it into the head
 * of `message` (`${where}: ${message}`) and always has. Two readers, ONE prefix
 * — which is why the comparison below is on the prefix + the rule id and not on
 * a whole rendered string the two faces were never required to share.
 */
const buildPerPackage = (warnings: unknown[]): string[] =>
  warnings
    .filter((w): w is { where: string; rule: string } => typeof (w as { where?: unknown })?.where === 'string')
    .filter((w) => PER_PACKAGE_WHERE.test(w.where))
    .map((w) => `${w.rule} @ ${w.where}`)
    .sort();

const lintPerPackage = (issues: unknown[]): string[] =>
  issues
    .filter((i): i is { message: string; rule: string } => typeof (i as { message?: unknown })?.message === 'string')
    .filter((i) => PER_PACKAGE_WHERE.test(i.message))
    .map((i) => `${i.rule} @ ${i.message.slice(0, i.message.indexOf(': '))}`)
    .sort();

/**
 * The falsifier. `core` owns `pp_account`; `orders` owns the view that displays
 * `pp_account.industry`. Judged as one flattened union the field has a consumer
 * and nothing is raised; judged per package, `core` declares a field nothing in
 * `core` reads. ⇒ the union run is CLEAN and the per-package run is not, which
 * is the one shape that can tell "the doors agree" from "the doors agree because
 * neither of them looked".
 */
const CONFIG_FLIP = `
const coreManifest = {
  id: 'com.example.ppflip.core', name: 'ppflip core', namespace: 'pp',
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
  id: 'com.example.ppflip.orders', name: 'ppflip orders', namespace: 'pp',
  version: '1.0.0', type: 'module', engines: { protocol: '^17' },
  dependencies: { 'com.example.ppflip.core': '^1.0.0' },
};
const ordersObjects = [{
  name: 'pp_order', label: 'Order', pluralLabel: 'Orders', sharingModel: 'private',
  fields: {
    name: { name: 'name', type: 'text', label: 'Order Number', required: true },
    account: { name: 'account', type: 'lookup', label: 'Account', reference: 'pp_account' },
  },
}];
const ordersViews = [
  {
    name: 'pp_account_list', label: 'Account List', object: 'pp_account',
    list: { label: 'Account List', columns: ['name', 'industry'] },
  },
  {
    name: 'pp_order_list', label: 'Order List', object: 'pp_order',
    list: { label: 'Order List', columns: ['name', 'account'] },
  },
];

export default {
  manifest: coreManifest,
  objects: [...ordersObjects, ...coreObjects],
  apps: [...coreApps],
  views: [...ordersViews],
  packages: [
    { manifest: { ...ordersManifest, objects: ordersObjects, views: ordersViews } },
    { manifest: { ...coreManifest, objects: coreObjects, apps: coreApps } },
  ],
};
`;

/**
 * The CONTROL: the same kind of project as ONE package, no `packages[]`. The
 * pass is skipped on every door, so agreement here holds for a reason that has
 * nothing to do with this change — which is precisely how the gap survived two
 * cards' worth of parity files.
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

const dirs = { flip: '', single: '' };

function plant(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-lintpp-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'objectstack.config.ts'), config, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'lintpp-fixture', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  return dir;
}

describe('#18778 — `os lint` and `os build` report the same per-package finding set', () => {
  beforeAll(() => {
    dirs.flip = plant(CONFIG_FLIP);
    dirs.single = plant(CONFIG_SINGLE);
  });

  afterAll(() => {
    for (const dir of Object.values(dirs)) if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the fixture reaches the pass at all, and the UNION sees nothing — `os build` raises exactly the survivor', async () => {
    // Asserted BEFORE any claim about parity: a fixture that never reaches the
    // per-package pass makes every comparison below vacuous, and a fixture whose
    // union run raises the same finding makes the comparison an echo count.
    const build = await runCli(['build', '--json'], dirs.flip);
    expect(build.code, `os build --json failed:\n${build.stdout}${build.stderr}`).toBe(0);
    const warnings = payloadOf(build, 'os build --json').warnings as unknown[];
    expect(buildPerPackage(warnings).length).toBeGreaterThan(0);
    // Nothing else: every warning on this fixture is a per-package survivor.
    expect(warnings.length).toBe(buildPerPackage(warnings).length);
  }, 180_000);

  it('`os lint` reports every per-package finding `os build` does', async () => {
    // The pin. On `origin/main` 7572329069 this read `build: 1, lint: 0`.
    const build = await runCli(['build', '--json'], dirs.flip);
    const lint = await runCli(['lint', '--json'], dirs.flip);
    expect(build.code, `os build --json failed:\n${build.stdout}${build.stderr}`).toBe(0);
    expect(lint.code, `os lint --json failed:\n${lint.stdout}${lint.stderr}`).toBe(0);

    const inLint = new Set(lintPerPackage(payloadOf(lint, 'os lint --json').issues as unknown[]));
    const missing = buildPerPackage(payloadOf(build, 'os build --json').warnings as unknown[])
      .filter((w) => !inLint.has(w));
    expect(
      missing,
      'these per-package findings ride `os build` and `os lint` cannot see them — the #18778 false-clean set',
    ).toEqual([]);
  }, 180_000);

  it('…and nothing per-package rides `os lint` that `os build` does not report either', async () => {
    // Parity is an equality. A lint that over-reports is its own defect — an
    // author fixing a finding the command that SHIPS never raises.
    const build = await runCli(['build', '--json'], dirs.flip);
    const lint = await runCli(['lint', '--json'], dirs.flip);
    const inBuild = new Set(buildPerPackage(payloadOf(build, 'os build --json').warnings as unknown[]));
    expect(lintPerPackage(payloadOf(lint, 'os lint --json').issues as unknown[]).filter((w) => !inBuild.has(w))).toEqual([]);
  }, 180_000);

  it('⚠️ THE NARROWING — `os lint --strict` now EXITS 1 on a project it exited 0 for', async () => {
    // The Clause-② evidence, pinned so it can neither regress silently nor widen
    // silently. `--strict` is documented as "treat warnings as errors", and a
    // per-package advisory is a warning this door could not see before, so the
    // verdict moves with it. ⛔ The DEFAULT face is deliberately NOT asserted to
    // move: no `error`-severity per-package-only finding was exhibited on this
    // fixture, and a pin asserting one would be asserting something unmeasured.
    const strict = await runCli(['lint', '--json', '--strict'], dirs.flip);
    const payload = payloadOf(strict, 'os lint --json --strict');
    expect(payload.strict).toBe(true);
    expect(payload.failing).toBe(1);
    expect(payload.passed).toBe(false);
    expect(strict.code, 'the --strict exit must follow `failing`').toBe(1);

    // …and the same project without `--strict` still exits 0, so what moved is
    // the strict verdict and not the default one.
    const plain = await runCli(['lint', '--json'], dirs.flip);
    expect(plain.code).toBe(0);
    expect(payloadOf(plain, 'os lint --json').passed).toBe(true);
  }, 180_000);

  it('CONTROL — a single-package project raises NO per-package finding on either door', async () => {
    // "Present" must be distinguishable from "always present": the prefix this
    // file matches on is not something either command emits unconditionally, and
    // `os lint --strict` still exits 1 there for the ORDINARY warning, which is
    // how the case above is read as a change and not as a constant.
    const build = await runCli(['build', '--json'], dirs.single);
    const lint = await runCli(['lint', '--json'], dirs.single);
    expect(build.code, `os build --json failed:\n${build.stdout}${build.stderr}`).toBe(0);
    expect(lint.code, `os lint --json failed:\n${lint.stdout}${lint.stderr}`).toBe(0);
    expect(buildPerPackage(payloadOf(build, 'os build --json').warnings as unknown[])).toEqual([]);
    expect(lintPerPackage(payloadOf(lint, 'os lint --json').issues as unknown[])).toEqual([]);
  }, 180_000);
});
