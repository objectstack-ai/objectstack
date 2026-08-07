#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The other half of the `merge=os-regen` driver (#4675): make the deferred
 * regeneration **mandatory** instead of remembered.
 *
 * The driver resolves generator-owned artifacts without text-merging them and
 * records each one in `$GIT_DIR/os-regen-pending`. It cannot regenerate them
 * itself — git runs merge drivers before the sources are merged, so anything
 * computed there describes a half-merged tree (see `git-merge-regen.mjs`). This
 * runs from `pre-commit`, where the merged tree finally exists, and refuses the
 * commit while any pending artifact is still stale.
 *
 * It **verifies, then clears** — it does not regenerate. Blanket regeneration
 * from a hook would rewrite artifacts whose staleness nobody saw, which is the
 * signal-destroying behaviour `check:generated` already refuses for the same
 * reason. And a marker cannot get stuck: the moment the artifacts check clean,
 * whether you regenerated them or the merge simply did not change them, the
 * marker is removed and the commit proceeds.
 *
 * ## The dist trap
 *
 * `gen:api-surface` reads the BUILT `dist/*.d.ts`. On a stale dist it does not
 * fail — it emits a plausible surface missing every export added since the last
 * build. So for `readsDist` artifacts this refuses to even run the gate unless
 * the build is newer than the sources, because a phantom "breaking removal" has
 * cost real triage time before (#4687, and the trap is recorded in AGENTS.md).
 *
 * Usage:
 *   node scripts/check-regen-pending.mjs              # pre-commit
 *   node scripts/check-regen-pending.mjs --self-test  # no repo state touched
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PENDING_MARKER, entryForPath } from './regen-artifacts.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = join(REPO_ROOT, 'packages/spec');

/** Newest mtime under `dir` for files matching `pred`, or 0 when there are none. */
function newestMtime(dir, pred, depth = 0) {
  if (depth > 12 || !existsSync(dir)) return 0;
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p, pred, depth + 1));
    else if (pred(e.name)) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

/**
 * Is `packages/spec/dist` older than the sources it claims to describe? Missing
 * counts as stale. Deliberately conservative: a false "stale" costs a build, a
 * false "fresh" costs a silently wrong artifact.
 */
export function distIsStale(specDir = SPEC_DIR) {
  const dist = newestMtime(join(specDir, 'dist'), (n) => n.endsWith('.d.ts'));
  if (!dist) return true;
  return newestMtime(join(specDir, 'src'), (n) => n.endsWith('.ts')) > dist;
}

/**
 * The same question for the OTHER build artifact a gate reads: is
 * `packages/spec/json-schema` older than the sources it was generated from?
 *
 * `build-docs.ts` reads that tree — it is the input the reference docs are
 * rendered from — and the tree is gitignored, so nothing in a checkout carries
 * it. Until #4723 the question could not arise: `check:docs` ran `gen:schema` as
 * its first step, so the tree was regenerated on every run. That is also what
 * made `check:docs` a "check" that WROTE two tracked artifacts (json-schema.manifest/
 * and authorable-surface/, whenever they were behind), which is the defect
 * #4711 removed from `--check` and #4723 removed from this composition. With the
 * generation gone, the freshness it silently guaranteed has to be ASSERTED, or
 * `check:docs` reports a verdict about a tree that predates the edit under test —
 * a FALSE GREEN on exactly the change (`.describe()` added, key renamed) the gate
 * exists to catch. Same trap, same conservative direction, as `readsDist` above.
 *
 * Two deliberate differences from `distIsStale`:
 *   - `.test.ts` is excluded from the source side. Test files are not inputs to
 *     `build-schemas.ts` (it imports the namespace barrels), so counting them
 *     would send every test-only spec PR to a `gen:schema` it does not need —
 *     and a guard that cries wolf is a guard someone deletes.
 *   - the artifact side matches `.json`, the tree's only content.
 */
export function schemaTreeIsStale(specDir = SPEC_DIR) {
  const tree = newestMtime(join(specDir, 'json-schema'), (n) => n.endsWith('.json'));
  if (!tree) return true;
  return newestMtime(join(specDir, 'src'), (n) => n.endsWith('.ts') && !n.endsWith('.test.ts')) > tree;
}

function markerPath() {
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
  return join(gitDir, PENDING_MARKER);
}

function readPending(marker) {
  if (!existsSync(marker)) return [];
  return [...new Set(readFileSync(marker, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean))];
}

function runCheck(script) {
  try {
    execSync(`pnpm -s ${script}`, { cwd: SPEC_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err?.stdout?.toString() ?? ''}${err?.stderr?.toString() ?? ''}`.trim() };
  }
}

function main() {
  const marker = markerPath();
  const pending = readPending(marker);
  if (!pending.length) return 0;

  const entries = pending.map((p) => ({ path: p, entry: entryForPath(p) })).filter((x) => x.entry);
  const unknown = pending.filter((p) => !entryForPath(p));

  console.error(
    `\nos-regen: ${pending.length} generated artifact(s) were merged WITHOUT a text merge and must be `
      + `regenerated from the merged tree before this commit.\n`,
  );

  // Group by gate: `gen:schema` owns two artifacts, so running it twice is waste.
  const byCheck = new Map();
  for (const { path, entry } of entries) {
    const g = byCheck.get(entry.check) ?? { entry, paths: [] };
    g.paths.push(path);
    byCheck.set(entry.check, g);
  }

  let blocked = 0;
  for (const [check, { entry, paths }] of byCheck) {
    if (entry.readsDist && distIsStale()) {
      blocked++;
      console.error(
        `  ✗ ${paths.join(', ')}\n`
          + `      ${check} reads packages/spec/dist, which is older than src — NOT running it.\n`
          + `      On a stale dist this gate reports phantom removals and the generator WRITES them.\n`
          + `      pnpm --filter @objectstack/spec build && pnpm --filter @objectstack/spec ${entry.gen}`,
      );
      continue;
    }
    // Same shape one artifact over (#4723). The gate would refuse on its own —
    // `build-docs.ts` carries the guard, so every caller is covered, not just
    // this one — but running it here would spend the spawn only to reprint a
    // message this hook can state with the merge context already in hand.
    if (entry.readsSchemaTree && schemaTreeIsStale()) {
      blocked++;
      console.error(
        `  ✗ ${paths.join(', ')}\n`
          + `      ${check} reads packages/spec/json-schema/, which is missing or older than src —\n`
          + `      NOT running it. That tree is gitignored, so a merge never brings it with them.\n`
          + `      pnpm --filter @objectstack/spec gen:schema && pnpm --filter @objectstack/spec ${entry.gen}`,
      );
      continue;
    }
    const { ok, output } = runCheck(check);
    if (ok) {
      console.error(`  ✓ ${paths.join(', ')} — current`);
      continue;
    }
    blocked++;
    const detail = output.split('\n').filter(Boolean).slice(0, 3).map((l) => `        ${l}`).join('\n');
    console.error(`  ✗ ${paths.join(', ')} — stale\n${detail ? `${detail}\n` : ''}`
      + `      pnpm --filter @objectstack/spec ${entry.gen}`);
  }

  for (const p of unknown) {
    blocked++;
    console.error(`  ✗ ${p} — recorded as pending but absent from scripts/regen-artifacts.mjs (cannot verify)`);
  }

  if (blocked) {
    console.error(
      `\nRegenerate the ${blocked} stale artifact(s) above, \`git add\` them, and commit again.\n`
        + '  This check clears itself the moment they are current — nothing to reset by hand.\n'
        + '  Bypass with --no-verify only if you intend CI to catch it: every one of these has a\n'
        + '  required gate on the PR.\n',
    );
    return 1;
  }

  rmSync(marker, { force: true });
  console.error('os-regen: all deferred artifacts are current — marker cleared.\n');
  return 0;
}

// `check:generated --fix` imports `distIsStale` from here, so nothing may run on
// import — only when this file IS the entry point.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    // Touches no repo state: the interesting logic is the staleness rules, and
    // their dangerous direction is "says fresh when stale".
    const noDist = distIsStale(join(REPO_ROOT, 'scripts')) === true;
    console.log(`${noDist ? '✓' : '✗'} a directory with no dist/ reads as STALE (conservative default)`);
    const noTree = schemaTreeIsStale(join(REPO_ROOT, 'scripts')) === true;
    console.log(`${noTree ? '✓' : '✗'} a directory with no json-schema/ reads as STALE (conservative default)`);
    const ok = noDist && noTree;
    console.log(ok ? '\n✓ check-regen-pending self-test passed.' : '\n✗ self-test failed.');
    process.exit(ok ? 0 : 1);
  }
  process.exit(main());
}
