// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The three gates that adopted #7122's dist precondition (#7181), pinned end to
// end: `check:dual-source-exports`, `check:exported-any`, `check:skill-examples`.
//
// ## Why these cases run the real scripts instead of the primitive
//
// `dist-freshness.test.ts` already pins the RULE and its wording in both
// directions. What #7181 is about is not the rule — it is the WIRING, and the
// wiring has exactly two ways to be wrong that a unit test cannot see:
//
//   1. the guard is absent, or sits BELOW the first `.d.ts` read, so the analysis
//      has already consumed the stale declarations by the time it speaks;
//   2. the guard is present but the gate refuses in a state CI is legitimately
//      in, which is how a guard gets deleted rather than obeyed.
//
// So each gate gets both directions against its own real entry point: a stale
// dist must produce the refusal INSTEAD of a verdict, and a fresh one must
// produce the ordinary verdict with no refusal in sight. The positive control is
// what makes the negative one mean anything — without it, every "refuses" case
// below would also pass if the script simply could not run in this sandbox.
//
// ## The identity assertion, and why it is `not.toContain('api-surface')`
//
// Before #7181 the refusal named `check:api-surface` by hand for every caller.
// A developer told to re-run a gate they never ran runs something that was never
// refused, sees it pass, and reads the refusal as cleared. Each case therefore
// asserts the message names ITSELF and does not name the gate whose wording this
// primitive was written for.
//
// ## Why a sandbox rather than the real package
//
// Same reason `dist-freshness.test.ts` gives: these scripts resolve everything
// from their own `__dirname`, and making the real `packages/spec/dist` stale to
// drive a refusal would corrupt whatever else is running in the container. Each
// run happens in a repo-shaped temp tree that copies `scripts/`, symlinks the
// read-only inputs, and seeds a `dist/` whose mtimes this test controls.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG, '../..');
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');

const OLD = Math.floor(Date.now() / 1000) - 3600;
const NEW = Math.floor(Date.now() / 1000) - 60;

/** A repo-shaped temp tree whose `packages/spec` runs the real gates. */
function sandboxSpec(): { root: string; spec: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'os-dist-adoption-'));
  const spec = path.join(root, 'packages', 'spec');
  fs.mkdirSync(spec, { recursive: true });
  // The root `scripts/` the shared freshness rule lives in, at its real relative
  // depth — `lib/dist-freshness.ts` imports it as `../../../../scripts/…`.
  fs.symlinkSync(path.join(REPO_ROOT, 'scripts'), path.join(root, 'scripts'), 'dir');
  fs.cpSync(path.join(PKG, 'scripts'), path.join(spec, 'scripts'), { recursive: true });
  fs.symlinkSync(path.join(PKG, 'node_modules'), path.join(spec, 'node_modules'), 'dir');
  // The real exports map: every gate here derives the `.d.ts` it reads from it.
  fs.copyFileSync(path.join(PKG, 'package.json'), path.join(spec, 'package.json'));
  // #10969 added `packages/client-react` + `packages/client` as check-skill-examples's
  // second surface, so a "repo-shaped" tree needs both to exist too -- otherwise the
  // surface's own zero-block guard fires on a directory this sandbox never populated,
  // which is a different fact than "the markers rotted" and would drown out whatever
  // this file's spec-staleness cases are actually probing. Seeded ALWAYS FRESH and
  // decoupled from the `distMtime`/`srcMtime` knobs `seed()` takes for `tree.spec` --
  // these tests are about spec's own staleness ordering, not the client surface's.
  seedClientSdkSurface(root);
  return { root, spec };
}

/**
 * One self-contained, marked, always-fresh example per client-SDK package, so
 * `check-skill-examples`'s second surface (#10969) never itself becomes the
 * reason a case in this file passes or fails. `.tsx` for client-react (its real
 * source extension — the fence itself can still be plain ` ```ts `, no JSX
 * needed) and `.ts` for client, matching `CLIENT_SDK_ROOTS`.
 */
function seedClientSdkSurface(root: string): void {
  for (const { dir, name, ext } of [
    { dir: 'client-react', name: '@objectstack/client-react', ext: '.tsx' },
    { dir: 'client', name: '@objectstack/client', ext: '.ts' },
  ]) {
    const pkgDir = path.join(root, 'packages', dir);
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'src', `index${ext}`),
      ['/**', ' * @example', ' * <!-- os:check -->', ' * ```ts', ' * export const ok = 1;', ' * ```', ' */', 'export const marker = 1;', ''].join('\n'),
      'utf8',
    );
    fs.utimesSync(path.join(pkgDir, 'src', `index${ext}`), OLD, OLD);
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify(
        {
          name,
          version: '0.0.0',
          exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs', require: './dist/index.js' } },
        },
        null,
        2,
      ),
      'utf8',
    );
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'dist', 'index.d.ts'), 'export {};\n', 'utf8');
    fs.utimesSync(path.join(pkgDir, 'dist', 'index.d.ts'), NEW, NEW);
  }
}

/** Every `dist/**.d.ts` the exports map points the gates at. */
function declaredDts(spec: string): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(spec, 'package.json'), 'utf8')) as {
    exports?: Record<string, { require?: { types?: string }; import?: { types?: string } }>;
  };
  const out: string[] = [];
  for (const [sub, val] of Object.entries(pkg.exports ?? {})) {
    if (!sub.startsWith('.')) continue;
    const dts = val?.require?.types ?? val?.import?.types;
    if (typeof dts === 'string' && dts.endsWith('.d.ts')) out.push(path.resolve(spec, dts));
  }
  return out;
}

/**
 * Seed `src/` and the declared `dist/*.d.ts` at controlled mtimes.
 *
 * The declarations are trivial but REAL — they parse, and every entry point
 * resolves — which is what makes the fresh-dist controls non-vacuous: each gate
 * runs its whole analysis over them and reaches its ordinary "nothing found"
 * verdict. The same tree, aged, is then the only variable in the refusal cases.
 */
function seed(spec: string, { distMtime, srcMtime }: { distMtime: number; srcMtime: number }): void {
  fs.mkdirSync(path.join(spec, 'src'), { recursive: true });
  // #10924 added `packages/spec/src` as check-skill-examples's THIRD surface, so
  // this seeded `src/` is now scanned for marked blocks too. Same reasoning as
  // `seedClientSdkSurface()` above, and the same failure it prevents: without a
  // marked block here that surface's zero-block guard fires on a directory this
  // sandbox merely stubs, and it fires BEFORE the freshness check — so the
  // staleness cases below would assert against "no marked examples found"
  // instead of the refusal they exist to probe.
  //
  // It goes in the SAME file `srcMtime` already governs rather than a sibling:
  // freshness compares dist against the newest source, so a second src file
  // would be a second, ungoverned mtime knob. The block imports nothing, which
  // is what lets it compile against the trivial `export {}` declarations
  // `declaredDts()` seeds and keeps the fresh-dist positive control honest.
  fs.writeFileSync(
    path.join(spec, 'src/index.ts'),
    [
      '/**',
      ' * @example',
      ' * <!-- os:check -->',
      ' * ```ts',
      ' * export const ok = 1;',
      ' * ```',
      ' */',
      'export const live = 1;',
      '',
    ].join('\n'),
  );
  fs.utimesSync(path.join(spec, 'src/index.ts'), srcMtime, srcMtime);

  for (const dts of declaredDts(spec)) {
    fs.mkdirSync(path.dirname(dts), { recursive: true });
    fs.writeFileSync(dts, 'export {};\n');
    fs.utimesSync(dts, distMtime, distMtime);
  }
}

function runGate(spec: string, script: string, args: string[] = []): SpawnSyncReturns<string> {
  return spawnSync(TSX, [`scripts/${script}`, ...args], {
    cwd: spec,
    encoding: 'utf8',
    env: { ...process.env, OS_SKIP_DTS: '' },
  });
}

/** Both halves of the refusal: it fired, and it named the right gate. */
function expectRefusal(run: SpawnSyncReturns<string>, rerun: string): void {
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('OLDER than packages/spec/src');
  expect(run.stderr).toContain('pnpm --filter @objectstack/spec build');
  expect(run.stderr).toContain(rerun);
  // The #7181 defect itself: every one of these used to print a fourth gate's name.
  expect(run.stderr).not.toContain('api-surface');
}

let tree: { root: string; spec: string };

beforeEach(() => {
  tree = sandboxSpec();
});

afterEach(() => {
  fs.rmSync(tree.root, { recursive: true, force: true });
});

// ── check:dual-source-exports ────────────────────────────────────────────────
//
// The one of the three that can WRITE. #7181 was filed on the reading that all
// three are check-only; `--update` rewrites `dual-source-exports.baseline.json`,
// so on a stale dist this gate can launder a wrong ratchet into a commit exactly
// the way `gen:api-surface` did (#7122).

const DUAL = 'check-dual-source-exports.ts';
const DUAL_BASELINE = 'dual-source-exports.baseline.json';
const SENTINEL = '{ "_comment": "sentinel", "entries": [] }\n';

function seedDualBaseline(spec: string): void {
  fs.writeFileSync(path.join(spec, DUAL_BASELINE), SENTINEL);
}

describe('check:dual-source-exports refuses a stale dist (#7181)', () => {
  it('POSITIVE CONTROL: a fresh dist runs the whole audit and reaches its verdict', () => {
    seed(tree.spec, { distMtime: NEW, srcMtime: OLD });
    seedDualBaseline(tree.spec);

    const run = runGate(tree.spec, DUAL);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('no new dual-source exports');
    expect(run.stderr).not.toContain('OLDER than');
  });

  it('refuses the audit on a stale dist instead of reporting "no new dual-source exports"', () => {
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });
    seedDualBaseline(tree.spec);

    const run = runGate(tree.spec, DUAL);
    expectRefusal(run, 'pnpm --filter @objectstack/spec check:dual-source-exports');
    expect(run.stdout).not.toContain('no new dual-source exports');
  });

  it('refuses --update and writes NOTHING — the laundering path #7181 assumed absent', () => {
    // A ratchet regenerated from declarations that predate the edit is wrong in
    // both directions at once: a name that only became dual-source after the last
    // build is written out as clean, and the plain run then compares that baseline
    // against the same stale dist and agrees with it.
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });
    seedDualBaseline(tree.spec);

    const run = runGate(tree.spec, DUAL, ['--update']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('WRITE a baseline');
    expect(fs.readFileSync(path.join(tree.spec, DUAL_BASELINE), 'utf8')).toBe(SENTINEL);
  });

  it('still runs --self-test on a stale dist — that path never reads dist/', () => {
    // Guard placement, asserted from the other side. The self-test compiles its
    // own fixture in a temp dir; refusing it would refuse a run the stale dist
    // cannot affect, and a gate that cannot be exercised without a build is a
    // gate people stop exercising.
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });
    seedDualBaseline(tree.spec);

    const run = runGate(tree.spec, DUAL, ['--self-test']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('self-test');
    expect(run.stderr).not.toContain('OLDER than');
  });
});

// ── check:exported-any ───────────────────────────────────────────────────────

const ANY = 'check-exported-any.ts';

describe('check:exported-any refuses a stale dist (#7181)', () => {
  it('POSITIVE CONTROL: a fresh dist runs the whole audit and reaches its verdict', () => {
    seed(tree.spec, { distMtime: NEW, srcMtime: OLD });

    const run = runGate(tree.spec, ANY);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('no exported type resolves to');
    expect(run.stderr).not.toContain('OLDER than');
  });

  it('refuses the audit on a stale dist instead of reporting "no exported type resolves to any"', () => {
    // The existing floors cannot see this state: the self-test's count assertions
    // pin the DETECTOR against a temp fixture, and `scan`'s "Is the package built?"
    // throw fires only when a module symbol will not resolve at all. A dist that
    // resolves fine and merely predates the edit passes both and prints a green.
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });

    const run = runGate(tree.spec, ANY);
    expectRefusal(run, 'pnpm --filter @objectstack/spec check:exported-any');
    expect(run.stdout).not.toContain('no exported type resolves to');
  });

  it('still runs --self-test on a stale dist — that path never reads dist/', () => {
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });

    const run = runGate(tree.spec, ANY, ['--self-test']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('self-test');
    expect(run.stderr).not.toContain('OLDER than');
  });
});

// ── check:skill-examples ─────────────────────────────────────────────────────
//
// The one whose route to the dist is NOT `collectEntries` + `ts.createProgram`:
// it turns the exports map into a tsconfig `paths` table and a spawned `tsc`
// follows it. So the guard sits at that boundary rather than at the top of the
// script, and the two cases below pin both consequences — no verdict below it is
// computed, and the dist-independent guards above it still speak.

const SKILL = 'check-skill-examples.ts';

/** One marked, self-contained example under the sandbox's `skills/`. */
function seedSkill(root: string, body: string[]): void {
  const dir = path.join(root, 'skills');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'fixture.md'),
    ['# Fixture skill', '', '<!-- os:check -->', '```ts', ...body, '```', ''].join('\n'),
    'utf8',
  );
}

describe('check:skill-examples refuses a stale dist (#7181)', () => {
  it('POSITIVE CONTROL: a fresh dist type-checks the marked example and reports it', () => {
    seed(tree.spec, { distMtime: NEW, srcMtime: OLD });
    seedSkill(tree.root, ['export const greeting: string = "ok";']);

    const run = runGate(tree.spec, SKILL);
    expect(run.status).toBe(0);
    // #10969: the surface-parameterised success message names surface COUNT,
    // not any one package -- it now covers this skills+docs surface, the
    // client-SDK one `seedClientSdkSurface` populates in every case in this
    // file, and (#10924) the spec-source one `seed()` populates. The count is
    // asserted literally, and moving it is the point: every surface added has
    // to be seeded here deliberately, or its zero-block guard fires ahead of
    // the refusal these cases probe.
    expect(run.stdout).toContain('prose examples type-check across 3 surface(s)');
    expect(run.stderr).not.toContain('OLDER than');
  }, 60_000);

  it('refuses before tsc on a stale dist instead of reporting the examples type-check', () => {
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });
    seedSkill(tree.root, ['export const greeting: string = "ok";']);

    const run = runGate(tree.spec, SKILL);
    expectRefusal(run, 'pnpm --filter @objectstack/spec check:skill-examples');
    expect(run.stdout).not.toContain('prose examples type-check across');
  }, 60_000);

  it('lets the dist-independent guards above it speak first, even on a stale dist', () => {
    // Deliberate ordering, and the reason this gate's guard is not at the top of
    // `main()` like its siblings': an orphan marker checks nothing whatever the
    // build state is, so reporting the freshness refusal in its place would trade
    // a true finding for a build instruction. The freshness guard covers only what
    // depends on the dist.
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });
    const dir = path.join(tree.root, 'skills');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'orphan.md'),
      ['# Fixture skill', '', '<!-- os:check -->', '', '```ts', 'export const a = 1;', '```', ''].join('\n'),
      'utf8',
    );

    const run = runGate(tree.spec, SKILL);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('os:check marker not directly above');
    expect(run.stderr).not.toContain('OLDER than packages/spec/src');
  }, 60_000);
});
