#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-harness-current -- is every harness-loaded file on `origin/main` already in the
 * shared (primary) checkout's HEAD? A seat-side fire-time reading; ⛔ not a CI gate.
 *
 *   node scripts/pm/check-harness-current.mjs [--shared <dir>] [--ref origin/main]
 *   node scripts/pm/check-harness-current.mjs --self-test
 *
 * The harness reads `.claude/settings.json`, `.claude/agents/*.md` and `.claude/hooks/*` from
 * the PRIMARY checkout when a session starts and never reloads them, so a touch that lands on
 * `origin/main` after that clone is inert for the running session -- measured: a session whose
 * primary checkout predated the MCP-write deny list still carried every denied tool. Worktrees
 * do not help (the harness never reads them) and the primary checkout is never advanced in place
 * (worktree-first), so the remedy is to close the shift and re-seat in a fresh session.
 *
 * Reads git only -- fetch first. Exit 0 = current; 1 = stale (each stale path printed with its
 * touch); 2 = undecidable: the ancestry test is negative on a SHALLOW clone and the touch is not
 * newer than HEAD, so the missing ancestor path may be a truncation, not a fact -- deepen, rerun.
 *
 * ## The printed sha is a PROVENANCE clause, and raw `git log -1` fabricates it (#18330)
 *
 * Agent containers clone shallow, so the shared checkout this tool reads has graft boundaries.
 * A boundary's commit object still names a parent the clone does not have; git applies the graft
 * at traversal, treats the commit as a root, and diffs it against the EMPTY tree -- so every path
 * in its tree reads as touched there, and `git log -1 <ref> -- <path>` names the boundary at exit
 * 0 with no warning. Measured on the shared checkout: `.claude/hooks/*` was reported as last
 * touched by a real, plausible commit that never changed a hook.
 *
 * The VERDICT survives that reading, which is why this tool keeps computing it exactly as before:
 * the verdict is a placement question about a COMMIT (is it under the shared HEAD?), not about the
 * path, and the boundary is only ever named when no commit ABOVE the shallow floor touched the
 * path -- so the true touch is at or below the floor, hence an ancestor of the named boundary, and
 * a commit whose descendant is already under HEAD is under HEAD too. The negative direction is
 * separately conservative: a negative ancestry test on a shallow clone is reported UNDECIDED
 * rather than STALE, because the missing path may be a truncation.
 *
 * What does NOT survive is the sha. So the provenance clause goes through
 * `scripts/pm/git-history.mjs#touchIsProvable` (PR #18327) and prints `boundary` or `unprovable`
 * -- with the reason -- in place of a sha it cannot prove, and prints the sha WITH its proof
 * (parents present, diff-tree touches the path) when it can. ⛔ It never fetches: the shared
 * checkout is not this tool's to deepen (`git-history.mjs`'s header: deepening is an operator
 * action), and a seat-side reading must not mutate the tree every other seat is reading.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { isShallow, touchIsProvable } from './git-history.mjs';

const PATHS = ['.claude/settings.json', '.claude/agents/*.md', '.claude/hooks/*'];
const argv = process.argv.slice(2);
const opt = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
const git = (dir, ...args) => {
  try {
    return { ok: true, out: execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() };
  } catch (error) {
    return { ok: false, out: String(error.stdout ?? '').trim() };
  }
};

const short = (sha) => sha.slice(0, 10);

/**
 * The provenance clause for one raw `git log -1 <ref> -- <path>` answer: the sha only when
 * `touchIsProvable` proves it is a reading OF THE PATH, otherwise the word `boundary` (the graft
 * case) or `unprovable` (every other unproven case) followed by that tool's own reason. Pure
 * reads -- no fetch, no deepen. Callers splice this where the bare sha used to sit, so the
 * verdict phrase and the trailing `-- STALE` / `-- UNDECIDED` markers keep their positions.
 */
function provenance(cwd, sha, ci, path) {
  const v = touchIsProvable({ cwd, sha, path });
  if (v.provable) {
    const parents = v.parents.length === 0
      ? 'a real root, its object names no parent'
      : `${v.parents.length} parent(s) present locally`;
    return `${short(sha)} (${ci}) [proven: ${parents}, diff-tree touches ${v.touched.join(' ')}]`;
  }
  return `${v.boundary ? 'boundary' : 'unprovable'} (${ci}) [${v.reason}]`;
}

function main() {
  const common = git(process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const shared = opt('--shared', common.ok ? common.out.replace(/\/\.git$/, '') : undefined);
  const ref = opt('--ref', 'origin/main');
  const head = shared ? git(shared, 'rev-parse', 'HEAD') : { ok: false, out: '' };
  if (!head.ok) { console.error(`check-harness-current: no git checkout at ${shared ?? '(cwd)'} -- pass --shared <dir>`); return 2; }
  const headTime = Number(git(shared, 'log', '-1', '--format=%ct', 'HEAD').out);
  const shallow = git(shared, 'rev-parse', '--is-shallow-repository').out === 'true';
  let stale = 0;
  let undecided = 0;
  for (const path of PATHS) {
    const touch = git(shared, 'log', '-1', '--format=%H %ct %cI', ref, '--', path);
    if (!touch.ok || !touch.out) { undecided += 1; console.log(`? ${path}: no touch of ${ref} visible from ${shared} (unfetched ref, or a shallow window) -- UNDECIDED`); continue; }
    const [sha, ct, ci] = touch.out.split(' ');
    const prov = provenance(shared, sha, ci, path);
    if (git(shared, 'merge-base', '--is-ancestor', sha, 'HEAD').ok) { console.log(`✓ ${path}: latest touch ${prov} is in the shared HEAD`); continue; }
    if (Number(ct) > headTime || !shallow) { stale += 1; console.log(`✗ ${path}: latest touch ${prov} is NOT in the shared HEAD ${short(head.out)} -- STALE`); continue; }
    undecided += 1;
    console.log(`? ${path}: touch ${prov} is not under HEAD in a SHALLOW clone and not newer than HEAD -- UNDECIDED, deepen and rerun`);
  }
  const verdict = stale
    ? `STALE -- ${stale} harness-loaded path(s) on ${ref} are not in ${shared} HEAD ${short(head.out)}: close the shift and re-seat in a fresh session; ⛔ never advance the shared checkout in place`
    : undecided ? `UNDECIDED -- ${undecided} path(s) could not be placed; fetch/deepen ${shared} and rerun` : `CURRENT -- every harness-loaded path on ${ref} is in ${shared} HEAD ${short(head.out)}`;
  console.log(`check-harness-current: ${verdict}`);
  return stale ? 1 : undecided ? 2 : 0;
}

// ── self-test ────────────────────────────────────────────────────────────────

/**
 * The floor this self-test's own run is judged against (#13489's shape, one section). `failures
 * === 0` alone cannot tell "every case held" from "the cases never ran" -- a `return` or a throw
 * inside the fixture block leaves the same silence. Adding cases is ordinary work; a run BELOW
 * this floor means cases stopped running, and the floor names that rather than passing.
 */
const SELF_TEST_CASE_FLOOR = 14;

const FIXTURE_EPOCH = '2026-06-01T12:00:00Z';
const FIXTURE_COMMITS = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

function selfTest() {
  let failures = 0;
  let cases = 0;
  const t = (name, ok, detail = '') => {
    cases += 1;
    if (ok) { process.stdout.write(`  ✓ ${name}\n`); return; }
    failures += 1;
    process.stdout.write(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}\n`);
  };

  const root = mkdtempSync(join(tmpdir(), 'harness-current-selftest-'));
  const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const self = new URL(import.meta.url).pathname;
  const run = (args, cwd) => {
    const r = spawnSync(process.execPath, [self, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), code: r.status };
  };
  const lineFor = (out, path) => out.split('\n').find((l) => l.includes(`${path}:`)) ?? '';
  const summaryOf = (out) => out.split('\n').filter(Boolean).at(-1) ?? '';

  try {
    // 40 commits, one per day, oldest first. The three harness paths are created at c0;
    // `.claude/hooks/h.sh` moves ONLY at c1 -- below every shallow floor cut below -- while
    // `.claude/agents/a.md` (c38) and `.claude/settings.json` (c39) move above it. So one shallow
    // clone carries both readings at once: a fabricated one and a provable one.
    const up = join(root, 'up');
    mkdirSync(join(up, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(up, '.claude', 'hooks'), { recursive: true });
    g(['init', '--quiet', '--initial-branch=main', '.'], up);
    g(['config', 'user.email', 'selftest@objectstack.ai'], up);
    g(['config', 'user.name', 'selftest'], up);
    for (let i = 0; i < FIXTURE_COMMITS; i += 1) {
      const d = new Date(Date.parse(FIXTURE_EPOCH) + i * DAY_MS).toISOString();
      writeFileSync(join(up, 'f.txt'), `commit ${i}\n`);
      if (i === 0) {
        writeFileSync(join(up, '.claude', 'settings.json'), '{}\n');
        writeFileSync(join(up, '.claude', 'agents', 'a.md'), 'agent 0\n');
        writeFileSync(join(up, '.claude', 'hooks', 'h.sh'), 'hook 0\n');
      }
      if (i === 1) writeFileSync(join(up, '.claude', 'hooks', 'h.sh'), 'hook 1\n');
      if (i === 38) writeFileSync(join(up, '.claude', 'agents', 'a.md'), 'agent 38\n');
      if (i === 39) writeFileSync(join(up, '.claude', 'settings.json'), '{"v":39}\n');
      g(['add', '-A'], up);
      execFileSync('git', ['commit', '--quiet', '-m', `c${i}`], {
        cwd: up,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d },
      });
    }

    const full = join(root, 'full');
    g(['clone', '--quiet', `file://${up}`, full], root);
    const trueHooksTouch = g(['log', '-1', '--format=%H', 'origin/main', '--', '.claude/hooks/*'], full);

    const shallow = join(root, 'shallow');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, shallow], root);
    const boundary = g(['rev-list', '--max-parents=0', 'origin/main'], shallow);
    const rawHooks = g(['log', '-1', '--format=%H', 'origin/main', '--', '.claude/hooks/*'], shallow);
    const agentsTouch = g(['log', '-1', '--format=%H', 'origin/main', '--', '.claude/agents/*.md'], shallow);

    t('BASELINE — on the shallow fixture raw `git log -1` names the graft boundary as the last '
      + 'touch of a hook the boundary never changed (the defect, reproduced: a real sha, exit 0)',
      rawHooks === boundary && rawHooks !== trueHooksTouch,
      `raw ${rawHooks.slice(0, 9)} boundary ${boundary.slice(0, 9)} true ${trueHooksTouch.slice(0, 9)}`);

    const shallowRun = run(['--shared', shallow], root);

    t('the unprovable reading prints `boundary` in place of the sha, with the graft mechanism named',
      /^✓ \.claude\/hooks\/\*: latest touch boundary \(20\d\d-/.test(lineFor(shallowRun.stdout, '.claude/hooks/*'))
        && /shallow graft boundary/.test(lineFor(shallowRun.stdout, '.claude/hooks/*')),
      lineFor(shallowRun.stdout, '.claude/hooks/*'));
    t('and the fabricated sha is nowhere offered AS the touch — the whole defect is that clause',
      !shallowRun.stdout.includes(`latest touch ${boundary.slice(0, 10)}`), shallowRun.stdout);
    t('the VERDICT clause on that same line is untouched: the path is still placed under the shared HEAD',
      lineFor(shallowRun.stdout, '.claude/hooks/*').endsWith('is in the shared HEAD'),
      lineFor(shallowRun.stdout, '.claude/hooks/*'));
    t('a PROVABLE reading on the same shallow clone still prints its sha, with the proof named — '
      + 'the check discriminates rather than withholding everything on a shallow tree',
      lineFor(shallowRun.stdout, '.claude/agents/*.md')
        .includes(`latest touch ${agentsTouch.slice(0, 10)} (`)
        && /\[proven: 1 parent\(s\) present locally, diff-tree touches \.claude\/agents\/a\.md\]/
          .test(lineFor(shallowRun.stdout, '.claude/agents/*.md')),
      lineFor(shallowRun.stdout, '.claude/agents/*.md'));

    const expectedSummary = (dir) => `check-harness-current: CURRENT -- every harness-loaded path on origin/main is in ${dir} HEAD ${g(['rev-parse', 'HEAD'], dir).slice(0, 10)}`;
    t('the summary line is BYTE-IDENTICAL to the one seats read, on the run that withheld a sha',
      summaryOf(shallowRun.stdout) === expectedSummary(shallow),
      `${JSON.stringify(summaryOf(shallowRun.stdout))} vs ${JSON.stringify(expectedSummary(shallow))}`);
    t('and the exit code is unchanged (0 = CURRENT)', shallowRun.code === 0, JSON.stringify(shallowRun));

    t('⛔ and nothing was fetched: the shared checkout is still shallow and its boundary has not moved',
      isShallow(shallow) === true && g(['rev-list', '--max-parents=0', 'origin/main'], shallow) === boundary);

    // FIRING CONTROL — the same path, the same code, on a clone deep enough to prove it.
    const fullRun = run(['--shared', full], root);
    t('FIRING CONTROL — on a complete clone the same hook path prints its TRUE sha, so the '
      + '`boundary` above is a reading of the history and not a constant',
      lineFor(fullRun.stdout, '.claude/hooks/*').includes(`latest touch ${trueHooksTouch.slice(0, 10)} (`)
        && !lineFor(fullRun.stdout, '.claude/hooks/*').includes('boundary'),
      lineFor(fullRun.stdout, '.claude/hooks/*'));
    t('the summary line is BYTE-IDENTICAL there too, and the exit code is the same 0',
      summaryOf(fullRun.stdout) === expectedSummary(full) && fullRun.code === 0,
      `${JSON.stringify(summaryOf(fullRun.stdout))} exit ${fullRun.code}`);

    // The STALE branch: a HEAD behind the newest touch. The verdict logic is what must not move.
    const behind = join(root, 'behind');
    g(['clone', '--quiet', `file://${up}`, behind], root);
    g(['checkout', '--quiet', g(['rev-parse', 'origin/main~5'], behind)], behind);
    const behindRun = run(['--shared', behind], root);
    t('a HEAD behind the newest touch still reads STALE, with the provenance clause spliced into '
      + 'the ✗ line and `-- STALE` still line-terminal',
      behindRun.code === 1 && /^✗ \.claude\/settings\.json: latest touch \w{10} \(20\d\d-.*\[proven: .*\] is NOT in the shared HEAD \w{10} -- STALE$/
        .test(lineFor(behindRun.stdout, '.claude/settings.json')),
      `exit ${behindRun.code} :: ${lineFor(behindRun.stdout, '.claude/settings.json')}`);
    // TWO paths, not one: HEAD sits at c34, below both the agents touch (c38) and the settings
    // touch (c39); only the hook touch (c1) is still under it.
    t('and its summary line is the STALE one, byte for byte',
      summaryOf(behindRun.stdout) === `check-harness-current: STALE -- 2 harness-loaded path(s) on origin/main are not in ${behind} HEAD ${g(['rev-parse', 'HEAD'], behind).slice(0, 10)}: close the shift and re-seat in a fresh session; ⛔ never advance the shared checkout in place`,
      summaryOf(behindRun.stdout));

    // An unreadable path stays exactly what it is today: UNDECIDED, exit 2, no provenance clause
    // at all -- there is no sha to prove or withhold.
    const bare = join(root, 'bare-up');
    mkdirSync(join(bare, '.claude', 'agents'), { recursive: true });
    g(['init', '--quiet', '--initial-branch=main', '.'], bare);
    g(['config', 'user.email', 'selftest@objectstack.ai'], bare);
    g(['config', 'user.name', 'selftest'], bare);
    writeFileSync(join(bare, '.claude', 'settings.json'), '{}\n');
    writeFileSync(join(bare, '.claude', 'agents', 'a.md'), 'agent\n');
    g(['add', '-A'], bare);
    g(['commit', '--quiet', '-m', 'c0'], bare);
    const noHooks = join(root, 'no-hooks');
    g(['clone', '--quiet', `file://${bare}`, noHooks], root);
    const noHooksRun = run(['--shared', noHooks], root);
    t('a path no commit on the ref touches stays UNDECIDED at exit 2, in today\'s exact words',
      noHooksRun.code === 2
        && lineFor(noHooksRun.stdout, '.claude/hooks/*')
          === `? .claude/hooks/*: no touch of origin/main visible from ${noHooks} (unfetched ref, or a shallow window) -- UNDECIDED`,
      `exit ${noHooksRun.code} :: ${lineFor(noHooksRun.stdout, '.claude/hooks/*')}`);
    t('and that run\'s summary line is the UNDECIDED one, byte for byte',
      summaryOf(noHooksRun.stdout) === `check-harness-current: UNDECIDED -- 1 path(s) could not be placed; fetch/deepen ${noHooks} and rerun`,
      summaryOf(noHooksRun.stdout));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (cases < SELF_TEST_CASE_FLOOR) {
    failures += 1;
    process.stdout.write(
      `  ✗ only ${cases} case(s) registered, below the pinned floor of ${SELF_TEST_CASE_FLOOR} — cases that used to run no longer do. `
        + 'Find what stopped registering (an early return, a throw inside the fixture block, a deleted section) and restore it.\n',
    );
  }
  process.stdout.write(failures === 0
    ? `\ncheck-harness-current --self-test: all ${cases} cases passed.\n`
    : `\ncheck-harness-current --self-test: ${failures} FAILED.\n`);
  return failures === 0 ? 0 : 1;
}

process.exit(argv.includes('--self-test') ? selfTest() : main());
