#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `merge=os-regen` — the merge driver for generator-owned artifacts (#4675).
 *
 * ## The problem
 *
 * `packages/spec`'s checked-in artifacts are sorted arrays and append-only
 * ledgers. Two PRs each adding a few lines is a set union, semantically
 * composable — but git sees a text conflict. Measured on one afternoon
 * (2026-08-02): four merges, nine conflicts across those files, and NOT ONE of
 * them was a real semantic conflict. Every correct resolution was the same
 * three steps: throw away both sides, re-run the generator, re-run the gates —
 * a dozen-plus minutes each, on a `main` moving fast enough that the rerun could
 * itself go stale.
 *
 * ## Why this driver does not regenerate
 *
 * The obvious implementation — "on conflict, run the generator" — is wrong, and
 * measurably so. Git invokes merge drivers **while** it is merging, in index
 * order, and the worktree still holds the pre-merge sources at that moment.
 * `packages/spec/spec-changes.json` sorts before `packages/spec/src/...`
 * (`'p' < 'r'`), so a driver that shelled out to `gen:spec-changes` would read a
 * `src/migrations/registry.ts` with the incoming side's retirements MISSING and
 * write a confidently wrong artifact. Verified directly:
 *
 *     driver invoked for packages/spec/spec-changes.json
 *     worktree src/registry.ts at that moment:  <ours only — theirs not merged>
 *
 * That is worse than the conflict it replaces. A conflict marker is a visible
 * error; a plausible-looking generated file is an invisible one, and this repo
 * already has the scar: on #4687 a `gen:api-surface` run against an incomplete
 * `dist` silently dropped an unrelated `./studio` export and ratcheted a
 * baseline exemption in to cover the hole. Nothing failed. It was caught by
 * diffing generated files against `main`.
 *
 * ## What it does instead
 *
 * Defer. The driver resolves the path (no text merge, no markers, exit 0) and
 * records it in `$GIT_DIR/os-regen-pending`. Regeneration happens later, from
 * the fully-merged tree — the only state in which it is correct — and the
 * `pre-commit` hook refuses the commit until it has. So the rework disappears
 * without the artifact's currency ever resting on someone remembering.
 *
 * The content left behind is OURS, chosen only because git pre-fills it there.
 * It is a placeholder, not an answer: correctness comes from the mandatory
 * regeneration, and three independent things enforce it — the pending marker,
 * the `pre-commit` hook, and the `check:*` gates that already run on every PR.
 *
 * ## Usage
 *
 *   node scripts/git-merge-regen.mjs %O %A %B %P   # invoked by git, never by hand
 *   node scripts/git-merge-regen.mjs --self-test   # reconcile + end-to-end merge proof
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NOT_DRIVER_MANAGED, PENDING_MARKER, REGEN_ARTIFACTS, entryForPath } from './regen-artifacts.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function gitDir(cwd = process.cwd()) {
  // In a linked worktree this resolves to `.git/worktrees/<name>`, which is what
  // we want: the marker is per-worktree, so parallel agents never see each
  // other's pending regenerations.
  return execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd, encoding: 'utf8' }).trim();
}

/** Record `path` as needing regeneration. Idempotent — a path is listed once. */
function markPending(path, cwd = process.cwd()) {
  const marker = join(gitDir(cwd), PENDING_MARKER);
  const existing = existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').filter(Boolean) : [];
  if (existing.includes(path)) return marker;
  appendFileSync(marker, `${path}\n`);
  return marker;
}

function drive(argv) {
  // %O %A %B %P — ancestor, ours (also the OUTPUT file), theirs, pathname.
  const path = argv[3];
  if (!path) {
    console.error('git-merge-regen: no %P pathname — check the `merge.os-regen.driver` config.');
    return 1;
  }

  const entry = entryForPath(path);
  if (!entry) {
    // `.gitattributes` routed a path here that the table does not own. Refusing
    // is the only safe answer: resolving it would silently keep one side of a
    // file nobody proved is regenerable.
    console.error(
      `git-merge-regen: ${path} is mapped to merge=os-regen but is absent from scripts/regen-artifacts.mjs.\n`
        + '  Leaving it CONFLICTED rather than guessing. Run `node scripts/git-merge-regen.mjs --self-test`.',
    );
    return 1;
  }

  markPending(path);

  const dist = entry.readsDist
    ? '\n     (this one is built from dist/*.d.ts — the regeneration will refuse on a stale build)'
    : '';
  console.error(
    `  ⟳ ${path}\n`
      + `     not text-merged — it is generated. Regenerate from the merged tree:\n`
      + `       pnpm --filter @objectstack/spec ${entry.gen}${dist}\n`
      + `     The pre-commit hook will not let this commit through until you do.`,
  );
  return 0;
}

/* ------------------------------------------------------------------ self-test */

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  return false;
}

/** `.gitattributes` and the table must name the same paths — in both directions. */
function reconcileAttributes() {
  const file = join(REPO_ROOT, '.gitattributes');
  if (!existsSync(file)) return fail('.gitattributes is missing — the driver is mapped to nothing.');
  const mapped = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .filter((l) => /\bmerge=os-regen\b/.test(l))
    .map((l) => l.trim().split(/\s+/)[0]);

  const declared = REGEN_ARTIFACTS.map((e) => e.path);
  const missing = declared.filter((p) => !mapped.includes(p));
  const extra = mapped.filter((p) => !declared.includes(p));
  let ok = true;
  if (missing.length) {
    ok = fail(`declared in regen-artifacts.mjs but not mapped in .gitattributes: ${missing.join(', ')}\n`
      + '  Those paths still text-merge — the table says otherwise.');
  }
  if (extra.length) {
    ok = fail(`mapped to merge=os-regen but not declared in regen-artifacts.mjs: ${extra.join(', ')}\n`
      + '  The driver refuses unknown paths, so those merges would CONFLICT with no explanation.');
  }
  // A path cannot be both driver-managed and deliberately excluded.
  const overlap = NOT_DRIVER_MANAGED.map((e) => e.path).filter((p) => declared.includes(p));
  if (overlap.length) ok = fail(`listed as BOTH driver-managed and NOT_DRIVER_MANAGED: ${overlap.join(', ')}`);
  if (ok) console.log(`✓ .gitattributes ↔ regen-artifacts.mjs agree on ${declared.length} path(s)`);
  return ok;
}

/** Every `gen:`/`check:` the table names must still exist, or the driver's advice is a dead command. */
function reconcileScripts() {
  const pkg = join(REPO_ROOT, 'packages/spec/package.json');
  if (!existsSync(pkg)) return fail('packages/spec/package.json not found');
  const scripts = JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {};
  const dead = [];
  for (const e of REGEN_ARTIFACTS) {
    if (!scripts[e.gen]) dead.push(`${e.path} → ${e.gen}`);
    if (!scripts[e.check]) dead.push(`${e.path} → ${e.check}`);
  }
  if (dead.length) {
    return fail(`script(s) named by the table no longer exist in @objectstack/spec:\n  ${dead.join('\n  ')}`);
  }
  console.log(`✓ all ${REGEN_ARTIFACTS.length * 2} gen:/check: names resolve in @objectstack/spec`);
  return true;
}

/**
 * The hook must be executable **in the index**, not just on this disk. Git
 * silently ignores a non-executable hook — it prints an `advice.ignoredHook`
 * hint and proceeds, so the deferred regeneration stops being mandatory and
 * nothing fails. Caught exactly that way while testing this change: both e2e
 * commits went through with the hook installed and inert.
 */
function hookIsExecutable() {
  try {
    const mode = execFileSync('git', ['ls-files', '-s', '.githooks/pre-commit'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim().split(/\s+/)[0];
    if (mode !== '100755') {
      return fail(`.githooks/pre-commit is mode ${mode || '<untracked>'} in the index, not 100755.\n`
        + '  Git IGNORES a non-executable hook — the pre-commit half is disarmed and says nothing.\n'
        + '  Fix: git update-index --chmod=+x .githooks/pre-commit');
    }
    console.log('✓ .githooks/pre-commit is executable in the index (100755)');
    return true;
  } catch (err) {
    return fail(`could not stat .githooks/pre-commit: ${err?.message ?? err}`);
  }
}

/**
 * Prove the driver end to end against real git: a conflicting change on both
 * sides of a mapped path must come out resolved, marker-free, and recorded.
 * Asserting the behaviour rather than the wiring is the point — the wiring
 * (`%P` order, git-dir resolution in a worktree) is exactly what silently rots.
 */
function endToEnd() {
  const dir = mkdtempSync(join(tmpdir(), 'os-regen-selftest-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q', '--initial-branch=main', '.');
    git('config', 'user.email', 'selftest@objectstack.ai');
    git('config', 'user.name', 'self-test');
    git('config', 'merge.os-regen.name', 'regenerate instead of text-merging');
    git('config', 'merge.os-regen.driver', `node ${join(REPO_ROOT, 'scripts/git-merge-regen.mjs')} %O %A %B %P`);

    const target = REGEN_ARTIFACTS[0].path;
    mkdirSync(join(dir, dirname(target)), { recursive: true });
    writeFileSync(join(dir, '.gitattributes'), `${target} merge=os-regen\n`);
    writeFileSync(join(dir, target), '["base"]\n');
    git('add', '-A');
    git('commit', '-qm', 'base');

    git('checkout', '-qb', 'incoming');
    writeFileSync(join(dir, target), '["base","theirs"]\n');
    git('commit', '-qam', 'theirs');

    git('checkout', '-q', 'main');
    writeFileSync(join(dir, target), '["base","ours"]\n');
    git('commit', '-qam', 'ours');

    git('merge', 'incoming', '-m', 'merge');

    const merged = readFileSync(join(dir, target), 'utf8');
    if (/^<{7}|^={7}$|^>{7}/m.test(merged)) return fail(`self-test: conflict markers survived in ${target}`);
    if (git('status', '--porcelain').match(/^(UU|AA)/m)) return fail('self-test: path left conflicted after merge');

    const marker = join(gitDir(dir), PENDING_MARKER);
    if (!existsSync(marker)) return fail(`self-test: no pending marker written at ${marker}`);
    if (!readFileSync(marker, 'utf8').includes(target)) return fail(`self-test: ${target} absent from the pending marker`);

    console.log(`✓ end-to-end: conflicting ${target} merged without markers and recorded as pending`);
    return true;
  } catch (err) {
    return fail(`self-test: ${err?.stderr?.toString() || err?.message || err}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv.includes('--self-test')) {
  console.log('git-merge-regen --self-test\n');
  const results = [reconcileAttributes(), reconcileScripts(), hookIsExecutable(), endToEnd()];
  console.log(
    results.every(Boolean)
      ? `\n✓ merge driver wiring is consistent (${NOT_DRIVER_MANAGED.length} path(s) deliberately excluded).`
      : '\n✗ merge driver wiring is inconsistent — see above.',
  );
} else {
  try {
    process.exit(drive(process.argv.slice(2)));
  } catch (err) {
    // Non-zero leaves the path conflicted with OURS in it and no markers. That
    // is a degraded state a human must look at — which is the right outcome for
    // "the driver itself broke", and never a silently-wrong artifact.
    console.error(`git-merge-regen: ${err?.message ?? err}\n  Leaving the path conflicted.`);
    process.exit(1);
  }
}
