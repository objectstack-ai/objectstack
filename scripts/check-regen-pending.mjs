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
 * ## The deferred merge (#8047)
 *
 * One commit is exempt from the refusal above, and only one: the MERGE commit
 * itself. `scripts/pm/os-regen-merge.sh` — the sanctioned landing sequence, and
 * the in-repo authority for it — takes main's side of every generated path and
 * **commits the merge before regenerating anything**, deliberately, because the
 * driver exits 0 while silently dropping one side: a clean merge and a lost
 * baseline are indistinguishable, and only a separate regeneration commit on a
 * known-good base lets a reviewer read "what main brought" apart from "what my
 * change produces". Refusing that commit made one in-repo authority forbid what
 * another in-repo tool deliberately produces, and the way out people learned was
 * to skip the ENTIRE pre-commit hook — trading one false positive for a blanket
 * bypass. Measured on PR #7851, ruled 2026-08-12.
 *
 * So a merge commit whose artifacts are stale is **deferred, not passed**: the
 * deferral is recorded in the marker (`deferred-at <head> <merge-head>`) and the
 * commit proceeds. Two properties make that a split rather than an escape hatch:
 *
 *   - **It is one commit deep, by construction.** A deferral is only ever entered
 *     while `MERGE_HEAD` exists, and a second merge attempted while one is still
 *     outstanding is refused. Every non-merge commit after it is refused too — by
 *     the ordinary staleness check, unchanged — so nothing can land between the
 *     merge and its discharge. "The immediately following commit" is enforced by
 *     there being no other commit it could be.
 *   - **The discharge is checked where it becomes knowable.** At the instant the
 *     merge commit is created, the commit that discharges it does not exist yet,
 *     so `pre-commit` can only RECORD the deferral. The two events that can
 *     follow are the next commit (this same check, which refuses while stale) and
 *     the push (`.githooks/pre-push`, which runs this with `--pre-push`). A
 *     deferral that is never discharged therefore cannot leave the machine.
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
 *   node scripts/check-regen-pending.mjs --pre-push   # pre-push: never defers
 *   node scripts/check-regen-pending.mjs --self-test  # fixtures only, no repo state
 */

import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PENDING_MARKER, entryForPath } from './regen-artifacts.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = join(REPO_ROOT, 'packages/spec');

/**
 * Where the `check:*` gates are spawned. `--self-test`'s fixtures point this at a
 * throwaway package so the two-commit sequence can be replayed without spawning
 * the real spec gates; nothing else sets it. A mistake here fails SAFE — a
 * directory without those scripts makes pnpm exit non-zero, which reads as stale.
 */
const GATE_CWD = process.env.OS_REGEN_GATE_CWD || SPEC_DIR;

/**
 * Marker line recording a deferral, distinguished from the driver's path lines by
 * a prefix no repo path can have (it contains a space; `%P` pathnames do not).
 * An unrecognised line would be reported as an unknown pending path — blocked,
 * the conservative direction — rather than silently ignored.
 */
const DEFERRAL_PREFIX = 'deferred-at ';

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

/**
 * This worktree's git dir — `--absolute-git-dir` resolves to `.git/worktrees/<name>`
 * in a linked worktree, so the marker and its deferral are per-worktree state and
 * two agents merging in parallel cannot collect each other's debt.
 */
function gitDirPath() {
  return execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
}

/** The marker's two kinds of line: the driver's deferred paths, and our deferral record. */
export function readMarker(marker) {
  if (!existsSync(marker)) return { paths: [], deferral: null };
  const lines = readFileSync(marker, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const record = lines.find((l) => l.startsWith(DEFERRAL_PREFIX));
  const [head, ...mergeHeads] = record ? record.slice(DEFERRAL_PREFIX.length).trim().split(/\s+/) : [];
  return {
    paths: [...new Set(lines.filter((l) => !l.startsWith(DEFERRAL_PREFIX)))],
    deferral: record ? { head, mergeHeads } : null,
  };
}

/** Append the deferral record. Appended, never rewritten — the driver owns the path lines. */
export function recordDeferral(marker, { head, mergeHeads }) {
  appendFileSync(marker, `${DEFERRAL_PREFIX}${[head, ...mergeHeads].join(' ')}\n`);
}

/**
 * Is a merge commit being created right now? `MERGE_HEAD` exists only between a
 * stopped merge and the commit that completes it, which is exactly the window
 * `pre-commit` runs in for a merge commit.
 *
 * ⚠️ A merge that completes WITHOUT stopping never reaches this file: git does not
 * run `pre-commit` for the commit it makes itself (verified, git 2.43). Such a
 * merge lands with the marker set and untouched, and the refusal falls on the next
 * commit — which is the deferral's discharge point either way.
 */
export function mergeInProgress(gitDir) {
  const file = join(gitDir, 'MERGE_HEAD');
  if (!existsSync(file)) return null;
  const mergeHeads = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  let head = '';
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    head = '(root)'; // A merge as the first commit has no HEAD. Vanishingly rare, not an error.
  }
  return { head, mergeHeads };
}

/**
 * The whole state machine, as a pure function — five cases, no I/O, so the
 * self-test can pin every one of them including the ones a fixture cannot reach.
 *
 * `blocked` is how many artifacts failed their gate; `merging` is `MERGE_HEAD`
 * present; `deferral` is a record already outstanding; `allowDefer` is false on
 * `--pre-push`, where deferring would defeat the point of checking at all.
 */
export function decide({ blocked, merging, deferral, allowDefer = true }) {
  if (!blocked) return deferral ? 'discharged' : 'clear';
  if (merging && deferral) return 'refuse-second-deferral';
  if (merging && allowDefer) return 'defer';
  if (deferral) return 'refuse-undischarged';
  return 'refuse-stale';
}

function runCheck(script) {
  try {
    execSync(`pnpm -s ${script}`, { cwd: GATE_CWD, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err?.stdout?.toString() ?? ''}${err?.stderr?.toString() ?? ''}`.trim() };
  }
}

function main({ prePush = false } = {}) {
  const gitDir = gitDirPath();
  const marker = join(gitDir, PENDING_MARKER);
  const { paths: pending, deferral } = readMarker(marker);
  if (!pending.length) {
    // Nothing deferred (or a record with no paths left to owe): the marker has no
    // debt to collect, so it cannot get stuck. Same clearing property as before.
    if (deferral) rmSync(marker, { force: true });
    return 0;
  }
  const merging = prePush ? null : mergeInProgress(gitDir);

  const entries = pending.map((p) => ({ path: p, entry: entryForPath(p) })).filter((x) => x.entry);
  const unknown = pending.filter((p) => !entryForPath(p));

  console.error(
    `\nos-regen: ${pending.length} generated artifact(s) were merged WITHOUT a text merge and must be `
      + `regenerated from the merged tree${prePush ? ' before this push' : ' before this commit'}.\n`,
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

  const action = decide({ blocked, merging, deferral, allowDefer: !prePush });
  const owed = `the ${blocked} stale artifact(s) above`;

  if (action === 'defer') {
    recordDeferral(marker, merging);
    console.error(
      `\nos-regen: this is a MERGE commit — ${owed} are DEFERRED to the next commit, not passed.\n`
        + `  Recorded against ${merging.head.slice(0, 12)} + ${merging.mergeHeads.map((h) => h.slice(0, 12)).join(' ')}.\n`
        + '  The merge lands as its own commit on purpose (`scripts/pm/os-regen-merge.sh` step 3): the\n'
        + '  os-regen driver exits 0 while silently dropping one side, so only a separate regeneration\n'
        + '  commit on a known-good base tells "what main brought" apart from "what your change produces".\n'
        + '\n  ⚠️ The NEXT commit must discharge this — regenerate, `git add`, commit. Until it does, every\n'
        + '  commit is refused, a second merge cannot defer on top, and `git push` is refused too.\n',
    );
    return 0;
  }

  if (action === 'refuse-second-deferral') {
    console.error(
      `\nos-regen: a deferral is already outstanding (taken at ${deferral.head.slice(0, 12)}) and ${owed}\n`
        + '  are still stale, so THIS merge cannot defer on top of it. A deferral is one commit deep by\n'
        + '  construction — any deeper and it is an escape hatch, not the split-commit procedure.\n'
        + '  Discharge the first one (regenerate + commit), then merge again.\n',
    );
    return 1;
  }

  if (action === 'refuse-undischarged') {
    console.error(
      `\nos-regen: the deferral taken on the merge commit at ${deferral.head.slice(0, 12)} is UNDISCHARGED —\n`
        + (prePush
          ? `  this push still owes ${owed}. A merge may defer its regeneration to the next commit;\n`
            + '  it may not defer it past the push, which is the last moment anything local can see it.\n'
          : `  this is the commit that owes ${owed}. Regenerate them and \`git add\` them.\n`)
        + '  (`scripts/pm/os-regen-merge.sh` prints the step-4 chain for the surface you touched.)\n',
    );
    return 1;
  }

  if (action === 'refuse-stale') {
    console.error(
      `\nRegenerate ${owed}, \`git add\` them, and ${prePush ? 'commit the result before pushing' : 'commit again'}.\n`
        + '  This check clears itself the moment they are current — nothing to reset by hand.\n'
        + '  Landing a merge? `bash scripts/pm/os-regen-merge.sh` runs the sanctioned sequence — it commits\n'
        + '  the merge first (this hook records that as a deferral) and regeneration follows as its own\n'
        + '  commit. Every artifact above also has a required gate on the PR.\n',
    );
    return 1;
  }

  if (prePush && blocked) {
    // Unreachable via `decide` — `allowDefer: false` routes every blocked push into
    // one of the refusals above. Kept as a floor: a future case that forgets the
    // push path must not let a stale artifact out of the machine by falling through.
    console.error('\nos-regen: refusing to push with deferred artifacts still stale.\n');
    return 1;
  }

  rmSync(marker, { force: true });
  console.error(
    action === 'discharged'
      ? 'os-regen: deferred regeneration discharged — all artifacts current, marker cleared.\n'
      : 'os-regen: all deferred artifacts are current — marker cleared.\n',
  );
  return 0;
}

// `check:generated --fix` imports `distIsStale` from here, so nothing may run on
// import — only when this file IS the entry point.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * Replay the deferred-merge sequence against a THROWAWAY git repo (#8047).
 *
 * This behaviour is a property of a PAIR of commits — accept here, collect there
 * — which no single-tree assertion can express, so the fixture builds the pair.
 * The worked precedent it is shaped after is PR #7851: merge commit `cbea40d`
 * (parents `c57e636` + `e3c8ed0`) followed by regeneration `7e4799f`.
 *
 * The gates are redirected at the fixture's own `package.json` via
 * `OS_REGEN_GATE_CWD`, so `check:spec-changes` is a one-line stub the fixture
 * flips from failing to passing — the two-commit shape is what is under test, not
 * the spec gates, and spawning the real ones here would make the self-test cost
 * a full spec build.
 */
function fixtureSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'os-regen-defer-'));
  const git = (args, opts = {}) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const results = [];
  const check = (label, cond) => {
    results.push(cond);
    console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  };

  /** Run the real script inside the fixture, with the stub gate in the given state. */
  const runHook = (gate, args = []) => {
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'os-regen-fixture', scripts: { 'check:spec-changes': gate === 'clean' ? 'exit 0' : 'exit 1' } }, null, 2)}\n`,
    );
    // `spawnSync`, not `execFileSync`: every message this script prints goes to
    // STDERR, which execFileSync returns only on the failure path — capturing the
    // accept-path wording is half of what is under test here.
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, OS_REGEN_GATE_CWD: dir },
    });
    return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  try {
    git(['init', '-q', '-b', 'main', '.']);
    git(['config', 'user.email', 'fixture@objectstack.test']);
    git(['config', 'user.name', 'os-regen fixture']);
    git(['config', 'core.hooksPath', '/dev/null']); // the fixture drives the script itself
    const gitDir = git(['rev-parse', '--absolute-git-dir']).trim();
    const marker = join(gitDir, PENDING_MARKER);
    const pendingPath = 'packages/spec/spec-changes.json'; // a real REGEN_ARTIFACTS entry
    const write = (f, c) => writeFileSync(join(dir, f), c);

    write('f.txt', 'base\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'base']);
    git(['checkout', '-qb', 'side']);
    write('s.txt', 'side\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'side']);
    git(['checkout', '-q', 'main']);
    write('f.txt', 'main moved\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'main moves']);

    // A merge left uncommitted — the state `pre-commit` sees when it runs for a
    // merge commit — with the driver's marker set, artifacts stale.
    git(['merge', '--no-commit', '--no-ff', 'side'], { stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(marker, `${pendingPath}\n`);

    const merge = runHook('stale');
    check('a MERGE commit with stale artifacts is ACCEPTED as a deferral', merge.code === 0);
    check('  …and says so — "DEFERRED", not a silent pass', /DEFERRED to the next commit/.test(merge.out));
    check('  …and points at the sanctioned procedure, never at skipping the hook',
      /os-regen-merge\.sh/.test(merge.out) && !/no-verify/.test(merge.out));
    const recorded = readMarker(marker).deferral;
    check('  …recording the merge it was taken on', Boolean(recorded?.head) && recorded.mergeHeads.length === 1);
    git(['commit', '-q', '--no-verify', '-m', 'merge side (regeneration follows)']);

    // Still stale one commit later: the deferral is now due, and this is where the
    // pre-fix hook and this one must AGREE — both refuse.
    const due = runHook('stale');
    check('the NEXT commit is REFUSED while the deferral is undischarged', due.code === 1);
    check('  …naming the merge that owes it', /UNDISCHARGED/.test(due.out));

    // A second merge cannot stack a second deferral on the first.
    git(['checkout', '-qb', 'side2', 'main~1']);
    write('s2.txt', 'side2\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'side2']);
    git(['checkout', '-q', 'main']);
    git(['merge', '--no-commit', '--no-ff', 'side2'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const second = runHook('stale');
    check('a SECOND merge cannot defer on top of an outstanding deferral', second.code === 1);
    check('  …so the exemption stays one commit deep', /one commit deep/.test(second.out));
    git(['merge', '--abort']);

    // The push is the other event that can follow a merge: it must not carry an
    // undischarged deferral off the machine.
    const push = runHook('stale', ['--pre-push']);
    check('`--pre-push` REFUSES an undischarged deferral', push.code === 1);
    const pushDefers = /DEFERRED to the next commit/.test(push.out);
    check('  …and never defers, whatever the merge state', !pushDefers);

    // Discharge: the artifacts come current, exactly as the regeneration commit makes them.
    const discharged = runHook('clean');
    check('regeneration DISCHARGES the deferral and clears the marker', discharged.code === 0);
    check('  …saying which of the two clearing paths ran', /discharged/.test(discharged.out));
    check('  …and the marker is gone, so nothing can get stuck', !existsSync(marker));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results.every(Boolean);
}

/**
 * The pre-push hook must be executable **in the index**, not just on this disk —
 * git silently ignores a non-executable hook, printing at most an
 * `advice.ignoredHook` note nobody reads. `git-merge-regen.mjs --self-test`
 * already asserts this for `.githooks/pre-commit`; the assertion lives here for
 * its sibling because `check:merge-driver` runs both halves, so the coverage
 * lands in the same gate either way, and a disarmed pre-push means an
 * undischarged deferral leaves the machine in silence.
 */
function prePushIsArmedSelfTest() {
  let mode = '';
  try {
    mode = execFileSync('git', ['ls-files', '-s', '.githooks/pre-push'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split(/\s+/)[0] ?? '';
  } catch (err) {
    console.log(`  ✗ could not stat .githooks/pre-push: ${err?.message ?? err}`);
    return false;
  }
  const ok = mode === '100755';
  console.log(
    ok
      ? '  ✓ .githooks/pre-push is executable in the index (100755)'
      : `  ✗ .githooks/pre-push is mode ${mode || '<untracked>'} in the index, not 100755.\n`
        + '      Git IGNORES a non-executable hook — the deferral would never be collected.\n'
        + '      Fix: git update-index --chmod=+x .githooks/pre-push',
  );
  return ok;
}

/** The five `decide` cases, including the ones a fixture cannot reach. */
function decisionTableSelfTest() {
  const cases = [
    [{ blocked: 0, merging: null, deferral: null }, 'clear'],
    [{ blocked: 0, merging: null, deferral: { head: 'a' } }, 'discharged'],
    [{ blocked: 2, merging: { head: 'a' }, deferral: null }, 'defer'],
    [{ blocked: 2, merging: { head: 'a' }, deferral: { head: 'b' } }, 'refuse-second-deferral'],
    [{ blocked: 2, merging: null, deferral: { head: 'b' } }, 'refuse-undischarged'],
    [{ blocked: 2, merging: null, deferral: null }, 'refuse-stale'],
    // `--pre-push`: deferring is off, so a merge in progress cannot buy a pass.
    [{ blocked: 2, merging: { head: 'a' }, deferral: null, allowDefer: false }, 'refuse-stale'],
    [{ blocked: 2, merging: { head: 'a' }, deferral: { head: 'b' }, allowDefer: false }, 'refuse-second-deferral'],
  ];
  let ok = true;
  for (const [input, expected] of cases) {
    const got = decide(input);
    if (got !== expected) ok = false;
    console.log(
      `  ${got === expected ? '✓' : '✗'} blocked=${input.blocked} merging=${input.merging ? 'y' : 'n'} `
        + `deferral=${input.deferral ? 'y' : 'n'} allowDefer=${input.allowDefer !== false ? 'y' : 'n'} → ${got}`
        + (got === expected ? '' : ` (expected ${expected})`),
    );
  }
  return ok;
}

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    // Touches no repo state: the interesting logic is the staleness rules, and
    // their dangerous direction is "says fresh when stale".
    const noDist = distIsStale(join(REPO_ROOT, 'scripts')) === true;
    console.log(`${noDist ? '✓' : '✗'} a directory with no dist/ reads as STALE (conservative default)`);
    const noTree = schemaTreeIsStale(join(REPO_ROOT, 'scripts')) === true;
    console.log(`${noTree ? '✓' : '✗'} a directory with no json-schema/ reads as STALE (conservative default)`);
    console.log('\ndeferred-merge collection point:');
    const armed = prePushIsArmedSelfTest();
    console.log('\ndeferred-merge decision table:');
    const table = decisionTableSelfTest();
    console.log('\ndeferred-merge sequence, replayed on a throwaway repo:');
    const fixture = fixtureSelfTest();
    const ok = noDist && noTree && armed && table && fixture;
    console.log(ok ? '\n✓ check-regen-pending self-test passed.' : '\n✗ self-test failed.');
    process.exit(ok ? 0 : 1);
  }
  process.exit(main({ prePush: process.argv.includes('--pre-push') }));
}
