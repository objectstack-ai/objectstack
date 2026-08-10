// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the precondition `gen:api-surface` / `check:api-surface` now enforce
// (#7122), and the ORDER in which it is enforced.
//
// ## The dangerous direction, and why every case below is written against it
//
// This guard has exactly one direction worth arguing about: **saying fresh when
// stale**. A false red costs a `pnpm build` — the command the docblock has
// always told you to run. A false green costs a committed baseline that DELETES
// a live export, is self-consistent (the `--check` half compares it against the
// same stale dist and passes), and rides into an unrelated PR where nobody reads
// `api-surface/contracts.json`. #7122 measured that: `JobRunOutcome (interface)`
// vanished from the baseline while the export was live the whole time.
//
// So every case here is written so that a rule answering "fresh" unconditionally
// fails it, and the two `fresh: true` cases exist so that a rule answering
// "stale" unconditionally fails too — a guard nobody can get green is a guard the
// next person deletes rather than obeys.
//
// The freshness RULE itself is `distIsStale` in `scripts/check-regen-pending.mjs`,
// shared with `check:generated --fix` and the pre-commit hook. It is exercised
// here through the real predicate rather than a stub: what #7122 broke was the
// wiring, not the arithmetic, and a stubbed predicate would pass with the wiring
// still absent.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectDistFreshness } from './lib/dist-freshness';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG, '../..');
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');

/** A throwaway `packages/spec`-shaped directory: `src/` plus `dist/`. */
let sandbox: string;

/** Write `rel` with `content`, creating parents, and stamp its mtime. */
function write(rel: string, content: string, mtimeEpochSeconds: number): string {
  const p = path.join(sandbox, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  fs.utimesSync(p, mtimeEpochSeconds, mtimeEpochSeconds);
  return p;
}

// Explicit stamps rather than sleeps, for the reason the sibling rule's test
// gives: mtime resolution and scheduling are not what this is about, and a test
// that races them is a test that gets `.skip`ped later.
const OLD = Math.floor(Date.now() / 1000) - 3600;
const NEW = Math.floor(Date.now() / 1000) - 60;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'os-dist-freshness-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('inspectDistFreshness — the dist precondition gen:api-surface never enforced (#7122)', () => {
  it('refuses a dist whose declarations are OLDER than src — THE case', () => {
    // #7122 in miniature: the dist was built from a base 24 commits behind, so
    // `src/contracts/job-service.ts` (which declares JobRunOutcome) is newer
    // than every `.d.ts` describing it. Answering `fresh` here is what let the
    // generator write a baseline with that export deleted.
    write('dist/contracts/index.d.ts', 'export {};', OLD);
    write('src/contracts/job-service.ts', 'export interface JobRunOutcome { ok: boolean }', NEW);

    const verdict = inspectDistFreshness(sandbox, 'generate');
    expect(verdict.fresh).toBe(false);
    if (verdict.fresh) return;
    expect(verdict.state).toBe('stale');
    expect(verdict.message).toContain('OLDER than packages/spec/src');
  });

  it('refuses in --check mode too, so CI cannot pass against a stale dist either', () => {
    // The half that makes the phantom removal survive: the committed baseline is
    // compared against THE SAME stale dist and agrees with it. Refusing only in
    // the writing mode would leave the laundering path intact — a wrong baseline
    // already on disk would keep passing forever.
    write('dist/contracts/index.d.ts', 'export {};', OLD);
    write('src/contracts/job-service.ts', 'export interface JobRunOutcome { ok: boolean }', NEW);

    const verdict = inspectDistFreshness(sandbox, 'check');
    expect(verdict.fresh).toBe(false);
    if (verdict.fresh) return;
    // The two modes must not print the same damage: one WRITES a wrong baseline,
    // the other AGREES with one. A reader who is told the wrong story looks in
    // the wrong place.
    expect(verdict.message).toContain('FALSE GREEN');
    expect(verdict.message).toContain('pnpm --filter @objectstack/spec check:api-surface');
    expect(verdict.message).not.toContain('WRITE a baseline');
  });

  it('names the writing damage in generate mode, and prescribes the build', () => {
    write('dist/contracts/index.d.ts', 'export {};', OLD);
    write('src/contracts/job-service.ts', 'export interface JobRunOutcome { ok: boolean }', NEW);

    const verdict = inspectDistFreshness(sandbox, 'generate');
    if (verdict.fresh) throw new Error('expected a refusal');
    expect(verdict.message).toContain('WRITE a baseline');
    expect(verdict.message).toContain('BREAKING');
    expect(verdict.message).toContain('pnpm --filter @objectstack/spec build');
    expect(verdict.message).toContain('gen:api-surface');
  });

  it('reads a MISSING dist as its own condition, not as staleness', () => {
    // A missing dist and a stale one are different facts with different fixes to
    // suggest, and #7122's ruling asked for them to be distinguishable. A never
    // built tree is also the ONE state where the old code failed honestly — the
    // TypeScript program could not resolve a module symbol — so this must not
    // regress into something quieter.
    write('src/contracts/job-service.ts', 'export interface JobRunOutcome { ok: boolean }', NEW);

    const verdict = inspectDistFreshness(sandbox, 'generate');
    expect(verdict.fresh).toBe(false);
    if (verdict.fresh) return;
    expect(verdict.state).toBe('missing');
    expect(verdict.message).toContain('no .d.ts declarations');
  });

  it('reads a JS-only dist as missing — the OS_SKIP_DTS=1 shape on a virgin tree', () => {
    // `OS_SKIP_DTS=1 pnpm build` emits JS and skips the declarations entirely.
    // The dist directory exists and is newer than src, so "does dist exist" and
    // "is dist newer" both answer the wrong question; only the `.d.ts` predicate
    // sees that the artifact this generator reads was never produced.
    write('src/contracts/job-service.ts', 'export interface JobRunOutcome { ok: boolean }', OLD);
    write('dist/contracts/index.js', 'export {};', NEW);

    const verdict = inspectDistFreshness(sandbox, 'generate');
    expect(verdict.fresh).toBe(false);
    if (verdict.fresh) return;
    expect(verdict.state).toBe('missing');
  });

  it('refuses the OS_SKIP_DTS=1 shape on an ALREADY-BUILT tree — the case dist/.build-input-hash cannot see', () => {
    // THE reason this guard reads mtimes instead of the content stamp #7122
    // suggested. `packages/spec`'s build runs the declaration pass only when
    // OS_SKIP_DTS is empty, but stamps `dist/.build-input-hash` either way — so
    // after `OS_SKIP_DTS=1 pnpm build` the stamp matches the sources exactly
    // while the `.d.ts` on disk predate them. check-dev-prereqs.mjs lists that as
    // a known false green and names this gate as the one it breaks.
    //
    // Fresh JS, fresh stamp, stale declarations: a stamp-based guard is GREEN
    // here. This one is red.
    write('src/contracts/job-service.ts', 'export interface JobRunOutcome { ok: boolean }', NEW);
    write('dist/contracts/index.d.ts', 'export {};', OLD);
    write('dist/contracts/index.js', 'export {};', NEW);
    write('dist/.build-input-hash', `${'a'.repeat(64)}\n`, NEW);

    const verdict = inspectDistFreshness(sandbox, 'generate');
    expect(verdict.fresh).toBe(false);
    if (verdict.fresh) return;
    expect(verdict.state).toBe('stale');
  });

  it('finds the newest source at ANY depth, not just the top level', () => {
    // A walk that stopped one level down would call this fresh and hand the
    // generator a dist that predates the only edit in the tree.
    write('src/index.ts', 'export {};', OLD);
    write('dist/index.d.ts', 'export {};', OLD + 60);
    write('src/contracts/nested/job-service.ts', 'export interface JobRunOutcome { ok: boolean }', NEW);

    expect(inspectDistFreshness(sandbox, 'generate').fresh).toBe(false);
  });

  it('lets a dist NEWER than src through, in both modes', () => {
    // The state right after `pnpm --filter @objectstack/spec build`, and the
    // state CI is in when lint.yml runs `check:api-surface` after the build step.
    // If this direction were wrong the gate would be a permanent red on every
    // run, which is how a guard gets removed instead of obeyed.
    write('src/contracts/job-service.ts', 'export interface JobRunOutcome { ok: boolean }', OLD);
    write('dist/contracts/index.d.ts', 'export {};', NEW);

    expect(inspectDistFreshness(sandbox, 'generate')).toEqual({ fresh: true });
    expect(inspectDistFreshness(sandbox, 'check')).toEqual({ fresh: true });
  });
});

// ── The real failure mode, end to end ────────────────────────────────────────
//
// A unit test on the rule cannot see the defect #7122 actually reported: the
// rule already existed (`check:generated --fix` and the pre-commit hook both
// consult it) and was simply never consulted on the path a person takes. What
// had to change is the WIRING, and only running the real script can show it.
//
// ## Why a sandbox rather than the real package
//
// `build-api-surface.ts` resolves every path from its own `__dirname`, so
// running it in place would rewrite the repo's tracked `api-surface/` shards —
// and making the real dist stale to drive the refusal would be destructive to
// whatever else is running. Each run therefore happens in a temp tree laid out
// like the repo (`<tmp>/packages/spec` beside `<tmp>/scripts`) that COPIES
// `scripts/` — so `__dirname` lands there — and symlinks the read-only inputs.
// No test-only seam is added to the gate: a seam is itself a place where the
// gate can differ from what CI runs (the same argument
// `build-schemas-check-mode.test.ts` makes for the same reason).
//
// ## Why the fixture dist is a set of trivial `.d.ts` files
//
// This is the laundering in miniature, and it is what makes these cases
// non-vacuous. The sandbox's declarations parse and resolve, so with a FRESH
// dist the script runs to completion and REWRITES the seeded baseline — the
// positive control below asserts exactly that. Which means that when the same
// tree with an OLD dist leaves the baseline untouched, the refusal is what
// stopped a write that would otherwise have happened: a baseline describing a
// build that no longer matches src. Measured against the pre-fix script, that
// run exited 0 and wrote the wrong shards.

/** A repo-shaped temp tree whose `packages/spec` runs the real generator. */
function sandboxSpec(): { root: string; spec: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'os-api-surface-'));
  const spec = path.join(root, 'packages', 'spec');
  fs.mkdirSync(spec, { recursive: true });
  // The root scripts/ the guard's shared rule lives in, at its real relative
  // depth — `distIsStale` is imported as `../../../../scripts/…`.
  fs.symlinkSync(path.join(REPO_ROOT, 'scripts'), path.join(root, 'scripts'), 'dir');
  fs.cpSync(path.join(PKG, 'scripts'), path.join(spec, 'scripts'), { recursive: true });
  fs.symlinkSync(path.join(PKG, 'node_modules'), path.join(spec, 'node_modules'), 'dir');
  // The real exports map: the entry points, and therefore the `.d.ts` paths the
  // generator reads, are read from it.
  fs.copyFileSync(path.join(PKG, 'package.json'), path.join(spec, 'package.json'));
  return { root, spec };
}

/** Every `dist/**.d.ts` the exports map points the generator at. */
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

const SENTINEL = '{ "sentinel": "not regenerated" }\n';

/** Seed `src/`, the declared `dist/*.d.ts`, and a recognisable baseline. */
function seed(spec: string, { distMtime, srcMtime }: { distMtime: number; srcMtime: number }): void {
  fs.mkdirSync(path.join(spec, 'src'), { recursive: true });
  fs.writeFileSync(path.join(spec, 'src/index.ts'), 'export const live = 1;\n');
  fs.utimesSync(path.join(spec, 'src/index.ts'), srcMtime, srcMtime);

  for (const dts of declaredDts(spec)) {
    fs.mkdirSync(path.dirname(dts), { recursive: true });
    fs.writeFileSync(dts, 'export {};\n');
    fs.utimesSync(dts, distMtime, distMtime);
  }

  fs.mkdirSync(path.join(spec, 'api-surface'), { recursive: true });
  fs.writeFileSync(path.join(spec, 'api-surface/root.json'), SENTINEL);
}

function runGenerator(spec: string, args: string[]) {
  return spawnSync(TSX, ['scripts/build-api-surface.ts', ...args], {
    cwd: spec,
    encoding: 'utf8',
    env: { ...process.env, OS_SKIP_DTS: '' },
  });
}

const baseline = (spec: string): string =>
  fs.readFileSync(path.join(spec, 'api-surface/root.json'), 'utf8');

describe('build-api-surface.ts refuses a stale dist end to end (#7122)', () => {
  let tree: { root: string; spec: string };

  beforeEach(() => {
    tree = sandboxSpec();
  });

  afterEach(() => {
    fs.rmSync(tree.root, { recursive: true, force: true });
  });

  it('POSITIVE CONTROL: a fresh dist runs to completion and rewrites the baseline', () => {
    // Without this case every assertion below could hold because the sandbox
    // cannot reach the write path at all, and the guard would be untested.
    seed(tree.spec, { distMtime: NEW, srcMtime: OLD });

    const run = runGenerator(tree.spec, []);
    expect(run.status).toBe(0);
    expect(baseline(tree.spec)).not.toBe(SENTINEL);
  });

  it('gen: refuses on a stale dist and writes NOTHING', () => {
    // The whole issue: the same tree the positive control just wrote from,
    // aged. Pre-fix this exited 0 and committed a baseline missing every export
    // added since that build — each one reading as a BREAKING removal.
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });

    const run = runGenerator(tree.spec, []);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('OLDER than packages/spec/src');
    expect(run.stderr).toContain('pnpm --filter @objectstack/spec build');
    expect(baseline(tree.spec)).toBe(SENTINEL);
  });

  it('--check refuses on the same stale dist, so CI cannot pass against it either', () => {
    // Step 2 of the laundering. If `--check` still ran here it would compare the
    // committed baseline against the same stale dist, agree with it, and report
    // the public API unchanged — the green that carries the phantom removal all
    // the way to main.
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });

    const run = runGenerator(tree.spec, ['--check']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('FALSE GREEN');
    expect(run.stdout).not.toContain('unchanged');
  });

  it('refuses a MISSING dist in both modes, naming the build rather than a phantom removal', () => {
    seed(tree.spec, { distMtime: OLD, srcMtime: NEW });
    fs.rmSync(path.join(tree.spec, 'dist'), { recursive: true, force: true });

    for (const args of [[], ['--check']]) {
      const run = runGenerator(tree.spec, args);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('no .d.ts declarations');
    }
    expect(baseline(tree.spec)).toBe(SENTINEL);
  });
});
