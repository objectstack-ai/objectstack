#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-harness-current -- is every harness-loaded file on `origin/main` already in the
 * shared (primary) checkout's HEAD? A seat-side fire-time reading; ⛔ not a CI gate.
 *
 *   node scripts/pm/check-harness-current.mjs [--shared <dir>] [--ref origin/main]
 *   node scripts/pm/check-harness-current.mjs --self-test
 *
 * Measured for `.claude/settings.json` and `.claude/skills/**`: the harness reads both from the
 * PRIMARY checkout when a session starts and does not reload them. For settings.json, a deny-roster
 * change that lands on `origin/main` after that clone is inert for the running session -- a session
 * whose primary checkout predated the MCP-write deny list still carried every denied tool. For the
 * skills tree, `scripts/pm/check-skill-line-ratchet.mjs`'s header states the same load moment
 * («`.claude/skills/pm-dispatch/SKILL.md` is read in full by every seat session and every Routine
 * fire»), and the realised case is recorded on #18544: a seat ran a whole shift enforcing a
 * stand-down rule that had already left `origin/main`, while this tool -- which then watched three
 * paths and not the skills tree -- reported on the other paths in the same invocation and never
 * named the charter. The load moment of `.claude/hooks/*` and `.claude/agents/*.md` is UNMEASURED:
 * whether the harness reads them once at start or from disk at each use is not known, and this tool
 * asserts neither. Worktrees do not help (the harness never reads them) and the primary checkout is
 * not advanced in place (worktree-first).
 * A STALE verdict is a REPORT, not a prescription: the seat notes it on its seat post and picks
 * it up at its next natural shift boundary; ⛔ it never interrupts a batch.
 *
 * TWO readings per watched path, both printed, each path counted once. (1) PLACEMENT: is the
 * commit that last touched the path on `ref` an ancestor of the shared HEAD? (2) CONTENT: does the
 * shared HEAD's copy of the path equal `ref`'s? Reading 2 exists because reading 1 -- and the
 * round-open marker comparison built on it -- are both blind to a checkout that was ALREADY behind
 * when the seat sat down: the touch sha is then identical from one marker to the next. See
 * `contentReading` below. A path is STALE if EITHER reading places it behind; ⛔ a reading is never
 * removed or narrowed to obtain a green verdict.
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

/**
 * The watched population. `.claude/skills/**` is a DIRECTORY surface, not a file list: naming the
 * charters one by one is how a predicate ends up guarding less than it claims (the population it
 * covers must be the population that is loaded). Every entry here is a git PATHSPEC, and the
 * default pathspec magic matches `*` across `/` -- measured on this repo at `e81c4e5f3`, where
 * `.claude/skills/**`, `.claude/skills/*` and `.claude/skills` all select the same 9 files and the
 * same `git log -1` sha, while `.claude/hooks/*` (the firing control, a term unchanged by that
 * reading) keeps selecting its own 2. ⛔ Never narrow an entry to buy a green verdict.
 */
const PATHS = ['.claude/settings.json', '.claude/agents/*.md', '.claude/hooks/*', '.claude/skills/**'];
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

/**
 * SECOND READING -- content, not placement. The touch reading above answers "is the COMMIT that
 * last touched this path under the shared HEAD?", and a seat's round-open marker answers "has that
 * sha moved since my last marker?". Both are blind to the same case: a checkout that was ALREADY
 * behind when the seat sat down. The sha is then identical from one marker to the next -- nothing
 * moved, because the thing that is wrong never moves -- and on a shallow clone the placement test
 * can even read `✓` off a graft boundary that is genuinely an ancestor. This reading asks the
 * header's question directly of the BYTES: does the shared HEAD's copy of this path equal `ref`'s?
 * It needs no history at all, so it answers where the placement test is UNDECIDED, and it fires
 * alone whenever HEAD carries content `ref` does not. Pure read -- no fetch, no deepen.
 */
function contentReading(shared, ref, path) {
  const diff = git(shared, 'diff', '--name-only', 'HEAD', ref, '--', path);
  if (!diff.ok) {
    return { state: 'unreadable', line: `? ${path}: content of HEAD cannot be compared with ${ref} from ${shared} (unfetched ref, or an unreadable tree) -- UNDECIDED` };
  }
  const files = diff.out ? diff.out.split('\n').filter(Boolean) : [];
  if (files.length === 0) return { state: 'same', line: `= ${path}: HEAD content is identical to ${ref}` };
  const shown = files.slice(0, 5).join(' ');
  const more = files.length > 5 ? ` +${files.length - 5} more` : '';
  return { state: 'differs', line: `✗ ${path}: HEAD content differs from ${ref} in ${files.length} file(s) (${shown}${more}) -- STALE` };
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
  // Two readings per path, both printed, counted ONCE per path: a path is stale if EITHER reading
  // places it behind. The touch lines below are byte-for-byte the ones seats have always read.
  for (const path of PATHS) {
    let pathStale = false;
    let pathUndecided = false;
    const touch = git(shared, 'log', '-1', '--format=%H %ct %cI', ref, '--', path);
    if (!touch.ok || !touch.out) {
      pathUndecided = true;
      console.log(`? ${path}: no touch of ${ref} visible from ${shared} (unfetched ref, or a shallow window) -- UNDECIDED`);
    } else {
      const [sha, ct, ci] = touch.out.split(' ');
      const prov = provenance(shared, sha, ci, path);
      if (git(shared, 'merge-base', '--is-ancestor', sha, 'HEAD').ok) {
        console.log(`✓ ${path}: latest touch ${prov} is in the shared HEAD`);
      } else if (Number(ct) > headTime || !shallow) {
        pathStale = true;
        console.log(`✗ ${path}: latest touch ${prov} is NOT in the shared HEAD ${short(head.out)} -- STALE`);
      } else {
        pathUndecided = true;
        console.log(`? ${path}: touch ${prov} is not under HEAD in a SHALLOW clone and not newer than HEAD -- UNDECIDED, deepen and rerun`);
      }
    }
    const content = contentReading(shared, ref, path);
    console.log(content.line);
    if (content.state === 'differs') pathStale = true;
    if (content.state === 'unreadable') pathUndecided = true;
    if (pathStale) stale += 1;
    else if (pathUndecided) undecided += 1;
  }
  const verdict = stale
    ? `STALE -- ${stale} harness-loaded path(s) on ${ref} are not in ${shared} HEAD ${short(head.out)}: note it on the seat post and pick it up at the seat's next natural shift boundary; ⛔ never interrupt a batch for it`
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
const SELF_TEST_CASE_FLOOR = 26;

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
    mkdirSync(join(up, '.claude', 'skills', 'pm-dispatch'), { recursive: true });
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
        // The skills tree moves ONLY at c0 here, so every expectation below keeps the count it
        // had before this path joined PATHS; the skills READINGS get their own fixtures further down.
        writeFileSync(join(up, '.claude', 'skills', 'pm-dispatch', 'SKILL.md'), 'charter 0\n');
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
      summaryOf(behindRun.stdout) === `check-harness-current: STALE -- 2 harness-loaded path(s) on origin/main are not in ${behind} HEAD ${g(['rev-parse', 'HEAD'], behind).slice(0, 10)}: note it on the seat post and pick it up at the seat's next natural shift boundary; ⛔ never interrupt a batch for it`,
      summaryOf(behindRun.stdout));
    // The verdict is a REPORT: it names the seat post and the shift boundary, and it names neither
    // re-seating nor advancing the shared checkout -- the prescription that used to sit there.
    t('and that summary is a report, not a prescription: it names the seat post and the shift '
      + 'boundary, and names neither a re-seat nor advancing the shared checkout',
      /seat post/.test(summaryOf(behindRun.stdout)) && /shift boundary/.test(summaryOf(behindRun.stdout))
        && !/re-seat|fresh session|advance the shared checkout/.test(summaryOf(behindRun.stdout)),
      summaryOf(behindRun.stdout));

    // An unreadable path stays exactly what it is today: UNDECIDED, exit 2, no provenance clause
    // at all -- there is no sha to prove or withhold.
    const bare = join(root, 'bare-up');
    mkdirSync(join(bare, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(bare, '.claude', 'skills', 'pm-dispatch'), { recursive: true });
    g(['init', '--quiet', '--initial-branch=main', '.'], bare);
    g(['config', 'user.email', 'selftest@objectstack.ai'], bare);
    g(['config', 'user.name', 'selftest'], bare);
    writeFileSync(join(bare, '.claude', 'settings.json'), '{}\n');
    writeFileSync(join(bare, '.claude', 'agents', 'a.md'), 'agent\n');
    writeFileSync(join(bare, '.claude', 'skills', 'pm-dispatch', 'SKILL.md'), 'charter\n');
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

    // ── the skills tree: the watched population, and the CONTENT reading ─────────────────────
    // Everything above proves the three original paths still read exactly as they did. These
    // sections cover what was added: `.claude/skills/**` in PATHS, and the second reading.

    t('the watched population covers the skills tree: the full-clone run places `.claude/skills/**` '
      + 'by name, so a charter change is inside the question this tool answers',
      /^[✓✗?] \.claude\/skills\/\*\*: /m.test(fullRun.stdout), fullRun.stdout);
    // FIRING CONTROL — the count is read off the same run that keeps naming the original three,
    // with a term ('latest touch', unchanged by this fix) counted the same way on the same output.
    t('and BOTH readings run for EVERY watched path — 4 placement lines and 4 content lines on one run',
      fullRun.stdout.split('\n').filter((l) => / latest touch /.test(l)).length === 4
        && fullRun.stdout.split('\n').filter((l) => /: HEAD content /.test(l)).length === 4,
      fullRun.stdout);

    // A charter fixture: the skills tree moves at c2 and nothing else does after c0, so a HEAD at
    // c1 is a checkout that was ALREADY behind on the charter when the seat sat down.
    const skUp = join(root, 'skills-up');
    mkdirSync(join(skUp, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(skUp, '.claude', 'hooks'), { recursive: true });
    mkdirSync(join(skUp, '.claude', 'skills', 'pm-dispatch', 'references'), { recursive: true });
    g(['init', '--quiet', '--initial-branch=main', '.'], skUp);
    g(['config', 'user.email', 'selftest@objectstack.ai'], skUp);
    g(['config', 'user.name', 'selftest'], skUp);
    const skCommit = (msg) => { g(['add', '-A'], skUp); g(['commit', '--quiet', '-m', msg], skUp); return g(['rev-parse', 'HEAD'], skUp); };
    writeFileSync(join(skUp, 'f.txt'), 'c0\n');
    writeFileSync(join(skUp, '.claude', 'settings.json'), '{}\n');
    writeFileSync(join(skUp, '.claude', 'agents', 'a.md'), 'agent\n');
    writeFileSync(join(skUp, '.claude', 'hooks', 'h.sh'), 'hook\n');
    writeFileSync(join(skUp, '.claude', 'skills', 'pm-dispatch', 'SKILL.md'), 'charter 0\n');
    writeFileSync(join(skUp, '.claude', 'skills', 'pm-dispatch', 'references', 'rest-channel.md'), 'channels 0\n');
    skCommit('c0');
    writeFileSync(join(skUp, 'f.txt'), 'c1\n');
    const skSeat = skCommit('c1');
    writeFileSync(join(skUp, '.claude', 'skills', 'pm-dispatch', 'references', 'rest-channel.md'), 'channels 2\n');
    const skCharterTouch = skCommit('c2');

    // The seat's checkout: cloned when origin/main was c2, seated at c1 — behind on the charter
    // from its first minute, and nothing about the charter moves during the shift.
    const skBehind = join(root, 'skills-behind');
    g(['clone', '--quiet', `file://${skUp}`, skBehind], root);
    g(['checkout', '--quiet', skSeat], skBehind);
    const markerOf = (dir) => g(['log', '-1', '--format=%H', 'origin/main', '--', '.claude/skills/**'], dir);
    const markerOne = markerOf(skBehind);
    // The round rolls: `origin/main` advances by a commit that does NOT touch the charter.
    writeFileSync(join(skUp, 'f.txt'), 'c3\n');
    skCommit('c3');
    g(['fetch', '--quiet', 'origin'], skBehind);
    const markerTwo = markerOf(skBehind);

    t('ALREADY-STALE-AT-SEATING — the charter touch sha is IDENTICAL across two round-open markers '
      + 'taken either side of a ref advance, so the marker-to-marker comparison is structurally '
      + 'blind here: nothing moved, because the thing that is wrong never moves',
      markerOne === markerTwo && markerOne === skCharterTouch,
      `marker1 ${markerOne.slice(0, 9)} marker2 ${markerTwo.slice(0, 9)} charter touch ${skCharterTouch.slice(0, 9)}`);

    const skBehindRun = run(['--shared', skBehind], root);
    t('and the CONTENT reading catches exactly that: the skills path is NAMED, with the differing '
      + 'file listed, and `-- STALE` line-terminal',
      /^✗ \.claude\/skills\/\*\*: HEAD content differs from origin\/main in 1 file\(s\) \(\.claude\/skills\/pm-dispatch\/references\/rest-channel\.md\) -- STALE$/
        .test(skBehindRun.stdout.split('\n').find((l) => l.startsWith('✗ .claude/skills/**: HEAD content')) ?? ''),
      skBehindRun.stdout);
    t('the run exits 1 and its summary counts the skills path ONCE, though both readings fired on it',
      skBehindRun.code === 1
        && summaryOf(skBehindRun.stdout) === `check-harness-current: STALE -- 1 harness-loaded path(s) on origin/main are not in ${skBehind} HEAD ${g(['rev-parse', 'HEAD'], skBehind).slice(0, 10)}: note it on the seat post and pick it up at the seat's next natural shift boundary; ⛔ never interrupt a batch for it`,
      `exit ${skBehindRun.code} :: ${summaryOf(skBehindRun.stdout)}`);
    // FIRING CONTROL — the same run, the three paths this fix does not move: all three read clean,
    // so the ✗ above is a reading of the charter and not a blanket failure of the new reading.
    t('FIRING CONTROL — on that same run the three original paths still read `✓` placement and '
      + '`=` content, so the skills verdict is a reading of that path and not a blanket failure',
      ['.claude/settings.json', '.claude/agents/*.md', '.claude/hooks/*'].every((path) =>
        skBehindRun.stdout.includes(`✓ ${path}: latest touch `)
        && skBehindRun.stdout.includes(`= ${path}: HEAD content is identical to origin/main`)),
      skBehindRun.stdout);

    // The other direction on the same fixture family: a checkout that IS current reads clean.
    const skCurrent = join(root, 'skills-current');
    g(['clone', '--quiet', `file://${skUp}`, skCurrent], root);
    const skCurrentRun = run(['--shared', skCurrent], root);
    t('BOTH DIRECTIONS — a checkout whose skills tree matches origin/main reads CURRENT at exit 0, '
      + 'with the summary line seats already read, byte for byte',
      skCurrentRun.code === 0 && summaryOf(skCurrentRun.stdout) === expectedSummary(skCurrent),
      `exit ${skCurrentRun.code} :: ${summaryOf(skCurrentRun.stdout)}`);

    // The reading the placement test structurally cannot make: the touch commit IS under HEAD and
    // the loaded bytes are still not origin/main's.
    const skLocal = join(root, 'skills-local');
    g(['clone', '--quiet', `file://${skUp}`, skLocal], root);
    g(['config', 'user.email', 'selftest@objectstack.ai'], skLocal);
    g(['config', 'user.name', 'selftest'], skLocal);
    writeFileSync(join(skLocal, '.claude', 'skills', 'pm-dispatch', 'SKILL.md'), 'charter LOCAL\n');
    g(['add', '-A'], skLocal);
    g(['commit', '--quiet', '-m', 'local charter edit'], skLocal);
    const skLocalRun = run(['--shared', skLocal], root);
    t('CONTENT READING FIRES ALONE — the placement reading passes (the last touch on origin/main IS '
      + 'an ancestor of HEAD) while the loaded charter is not origin/main\'s, and the path is still '
      + 'named STALE at exit 1',
      skLocalRun.code === 1
        && (skLocalRun.stdout.split('\n').find((l) => l.startsWith('✓ .claude/skills/**: latest touch')) ?? '')
          .endsWith('is in the shared HEAD')
        && /^✗ \.claude\/skills\/\*\*: HEAD content differs from origin\/main in 1 file\(s\) \(\.claude\/skills\/pm-dispatch\/SKILL\.md\) -- STALE$/
          .test(skLocalRun.stdout.split('\n').find((l) => l.startsWith('✗ .claude/skills/**: HEAD content')) ?? ''),
      `exit ${skLocalRun.code} :: ${skLocalRun.stdout}`);
    t('and the three original paths are untouched by that second reading too — `=` on all three',
      ['.claude/settings.json', '.claude/agents/*.md', '.claude/hooks/*'].every((path) =>
        skLocalRun.stdout.includes(`= ${path}: HEAD content is identical to origin/main`)),
      skLocalRun.stdout);

    // ⛔ An unreadable comparison must never read as "identical": that is the silent-green failure
    // this whole tool exists to refuse. An unresolvable ref makes BOTH readings refuse.
    const noRefRun = run(['--shared', skCurrent, '--ref', 'origin/no-such-branch'], root);
    t('⛔ a comparison that could not be made is UNDECIDED, never `identical` — no `=` line is '
      + 'printed for any path when the ref does not resolve',
      !noRefRun.stdout.includes('HEAD content is identical to')
        && PATHS.every((path) => noRefRun.stdout.includes(`? ${path}: content of HEAD cannot be compared with origin/no-such-branch`)),
      noRefRun.stdout);
    t('and that run is UNDECIDED at exit 2 for all four watched paths',
      noRefRun.code === 2
        && summaryOf(noRefRun.stdout) === `check-harness-current: UNDECIDED -- ${PATHS.length} path(s) could not be placed; fetch/deepen ${skCurrent} and rerun`,
      `exit ${noRefRun.code} :: ${summaryOf(noRefRun.stdout)}`);
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
