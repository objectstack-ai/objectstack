#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * overlap-check — does a branch TEXTUALLY overlap `origin/main` or any open pull request? The claim-time and
 * pre-push replacement for "hot file, one writer" (#33941): two seats may share a file, and only a real textual
 * conflict queues one behind the other.
 *
 *   node scripts/pm/overlap-check.mjs [--branch=REF] [--base=REF] [--remote=NAME] [--repo=OWNER/NAME]
 *                                     [--pr=N[,N…]] [--exclude-pr=N[,N…]] [--json]
 *   node scripts/pm/overlap-check.mjs --self-test     # offline: real git repositories in a temp dir, no network
 *
 *   exit 0  no textual overlap — with the base, and with every open PR head that shares a file with the branch
 *   exit 1  overlap — each conflicting file is listed under the side it conflicts with
 *   exit 2  usage
 *   exit 3  cannot answer (PREREQUISITE NOT MET): a merge base missing from a shallow clone, an unreadable PR
 *           list, a PR head that would not fetch. ⛔ Never read as 0 — fix what it names and re-run.
 *
 * ## What it runs
 *
 *   1. The branch's own change set: `git diff --name-only --no-renames $(git merge-base BASE BRANCH) BRANCH`.
 *      Committed work only — commit before you ask.
 *   2. `git merge-tree --write-tree --name-only` of BRANCH against BASE (default `<remote>/main`).
 *   3. The candidate PRs: every open PR (`GET /repos/{repo}/pulls?state=open`, then each one's
 *      `/pulls/{n}/files`, both paged by `gh-pages.mjs`) whose files — `previous_filename` included — meet the
 *      branch's change set. The branch's own PR (same head ref name, or same head sha) is skipped.
 *      `--pr=N` names the candidates instead and reads nothing from the API: every named PR is merged.
 *   4. Each candidate's head is fetched into a ref this tool owns —
 *      `git fetch --no-tags <remote> +refs/pull/N/head:refs/overlap-check/pull/N` — and merged with BRANCH by
 *      `git merge-tree --write-tree --name-only`.
 *
 * ## Which conflicts count
 *
 * A conflict against the BASE is always the branch's own: both sides changed the file. A conflict against a PR
 * head on a path the BRANCH changed is the branch's own too. A conflict on any OTHER path is judged by evidence,
 * never by the path's name: it is `not yours` only when merging the BASE with that PR head conflicts on the same
 * path — a PR built on an older main meets that conflict whatever this branch does. Everything else counts. A PR
 * that renames a file the branch edits reports the conflict under the NEW name, outside the branch's change set,
 * and base × PR merges it cleanly; so it counts (self-test: the `cli` battery's rename case). When in doubt the
 * tool answers overlap: a needless queue costs a wait, a missed overlap costs a red queue run.
 *
 * ## Exit 1: queue behind whom
 *
 * A base conflict is not a queue: merge the base and resolve it. A PR-head conflict queues the branch behind
 * the PR named on that line until it lands, then merge the base and re-run. Before a claim, with no commits yet,
 * the change set is empty and the answer is 0 by construction: run it again before the first push, or start
 * from the branch you will build on (`--branch=`).
 *
 * ## Why every merge runs with an EMPTY attribute source
 *
 * `.gitattributes` routes generated artifacts to the `os-regen` merge driver, which answers exit 0 and leaves no
 * marker (AGENTS.md, Multi-agent discipline §11; `os-regen-merge.sh`). A merge-tree that runs the driver reads a
 * real conflict as clean — measured in this tool's self-test with a driver that resolves everything — while the
 * GitHub merge queue runs no custom driver at all. So each `merge-tree` runs as
 * `git --attr-source=<empty tree> merge-tree …`: no attribute, no driver, the plain three-way text merge the
 * queue performs, and no `os-regen-pending` written into the shared `.git/`. This differs from AGENTS.md §11's
 * mergeability probe (a throwaway bare clone with no driver registered) on purpose: the question here is only
 * which paths conflict, an empty attribute source answers it in place without a second clone, and the self-test
 * holds it to a driver-ON control leg.
 *
 * Every PR head this run fetched under `refs/overlap-check/pull/` is deleted again before it returns.
 *
 * ## Shallow clones
 *
 * Cloud checkouts are shallow. With the merge base below the shallow boundary, `git merge-base` answers nothing
 * and `merge-tree` refuses ("unrelated histories"); either one is exit 3 naming the remedy
 * `git fetch --deepen=1500 <remote> main`. Never a guess.
 *
 * The self-test is a battery roster with a floor and a verdict handshake (AGENTS.md, Writing a `--self-test`).
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import { readAllPages } from './gh-pages.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);

export const EXIT = Object.freeze({ CLEAN: 0, OVERLAP: 1, USAGE: 2, CANNOT_ANSWER: 3 });
export const DEFAULT_REPO = 'objectstack-ai/objectstack';
export const REF_NAMESPACE = 'refs/overlap-check/pull';
export const deepenHint = (remote) => `git fetch --deepen=1500 ${remote} main`;

const USAGE =
  'usage: node scripts/pm/overlap-check.mjs [--branch=REF] [--base=REF] [--remote=NAME] [--repo=OWNER/NAME]\n' +
  '                                         [--pr=N[,N…]] [--exclude-pr=N[,N…]] [--json]\n' +
  '       node scripts/pm/overlap-check.mjs --self-test';

// ── argv ─────────────────────────────────────────────────────────────────────

function numberList(flag, value) {
  const parts = String(value).split(',').map((s) => s.trim().replace(/^#/, ''));
  if (parts.length === 0 || parts.some((p) => !/^[1-9]\d*$/.test(p))) {
    return { error: `${flag} takes PR numbers, comma-separated (got ${JSON.stringify(value)})` };
  }
  return { value: parts.map(Number) };
}

/** `{ ok: true, opts }` or `{ ok: false, error }`; every flag is `--name=value` except the two switches. */
export function parseArgs(argv) {
  const opts = { branch: 'HEAD', base: null, remote: 'origin', repo: DEFAULT_REPO, prs: null, exclude: [], json: false };
  for (const arg of argv) {
    if (arg === '--json') { opts.json = true; continue; }
    const m = /^--(branch|base|remote|repo|pr|exclude-pr)=(.+)$/.exec(arg);
    if (!m) return { ok: false, error: `unknown or malformed argument ${JSON.stringify(arg)}` };
    const [, flag, value] = m;
    if (flag === 'pr' || flag === 'exclude-pr') {
      const list = numberList(`--${flag}`, value);
      if (list.error) return { ok: false, error: list.error };
      if (flag === 'pr') opts.prs = list.value; else opts.exclude = list.value;
    } else if (flag === 'repo' && !/^[\w.-]+\/[\w.-]+$/.test(value)) {
      return { ok: false, error: `--repo takes OWNER/NAME (got ${JSON.stringify(value)})` };
    } else {
      opts[flag] = value;
    }
  }
  if (opts.base === null) opts.base = `${opts.remote}/main`;
  return { ok: true, opts };
}

// ── git ──────────────────────────────────────────────────────────────────────

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: (r.stderr || r.error?.message || '').trim() };
}

function emptyTree(cwd) {
  const r = git(cwd, ['hash-object', '-t', 'tree', '/dev/null']);
  return r.status === 0 ? r.stdout.trim() : null;
}

function resolveCommit(cwd, ref) {
  const r = git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The branch's own change set against its merge base with `base`; `{ ok, files }` or `{ ok: false, error }`. */
export function changedFiles(cwd, base, branch, remote = 'origin') {
  const mb = git(cwd, ['merge-base', base, branch]);
  if (mb.status !== 0) {
    return { ok: false, error: `no merge base between ${base} and ${branch} here — a shallow clone? Run ${deepenHint(remote)}` };
  }
  const d = git(cwd, ['diff', '--name-only', '--no-renames', '-z', mb.stdout.trim(), branch]);
  if (d.status !== 0) return { ok: false, error: `git diff failed: ${d.stderr}` };
  return { ok: true, files: d.stdout.split('\0').filter(Boolean) };
}

/**
 * One `merge-tree --write-tree --name-only` with no attributes (header: why). `{ ok, conflicts }` — exit 0 is
 * clean, exit 1 lists the conflicted paths; anything else is `{ ok: false, error }`.
 */
export function mergeTree(cwd, ours, theirs, remote = 'origin') {
  const empty = emptyTree(cwd);
  if (!empty) return { ok: false, error: 'git could not name the empty tree' };
  const r = git(cwd, [`--attr-source=${empty}`, 'merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', ours, theirs]);
  if (r.status === 0 || r.status === 1) {
    const [, ...paths] = r.stdout.split('\0').filter(Boolean);
    return { ok: true, conflicts: r.status === 1 ? [...new Set(paths)] : [] };
  }
  const shallowish = /unrelated histories/.test(r.stderr);
  return {
    ok: false,
    error: `merge-tree ${ours} ${theirs} exited ${r.status}: ${r.stderr}` + (shallowish ? ` — run ${deepenHint(remote)}` : ''),
  };
}

// ── candidates ───────────────────────────────────────────────────────────────

/** Rows of `{ number, headRef, headSha, files }` whose files meet `own`, minus the branch's own PR and `exclude`. */
export function selectCandidates(prs, own, { branchName = null, branchSha = null, exclude = [] } = {}) {
  const mine = new Set(own);
  const out = [];
  for (const pr of prs) {
    if (exclude.includes(pr.number)) continue;
    if ((branchName && pr.headRef === branchName) || (branchSha && pr.headSha === branchSha)) continue;
    const shared = [...new Set(pr.files)].filter((f) => mine.has(f));
    if (shared.length > 0) out.push({ ...pr, shared });
  }
  return out;
}

/** Every open PR with its file list (renames contribute both names). `{ ok, prs }` or `{ ok: false, error }`. */
export function readOpenPrs(repo, { get } = {}) {
  const list = readAllPages(`repos/${repo}/pulls?state=open`, get ? { get } : {});
  if (!list.ok) return { ok: false, error: `open PR list unreadable: ${list.error}` };
  const prs = [];
  for (const pr of list.value) {
    const files = readAllPages(`repos/${repo}/pulls/${pr.number}/files`, get ? { get } : {});
    if (!files.ok) return { ok: false, error: `files of #${pr.number} unreadable: ${files.error}` };
    prs.push({
      number: pr.number,
      headRef: pr.head?.ref ?? null,
      headSha: pr.head?.sha ?? null,
      files: files.value.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)),
    });
  }
  return { ok: true, prs };
}

function fetchPrHead(cwd, remote, number) {
  const ref = `${REF_NAMESPACE}/${number}`;
  const r = git(cwd, ['fetch', '--no-tags', '--quiet', remote, `+refs/pull/${number}/head:${ref}`]);
  return r.status === 0 ? { ok: true, ref } : { ok: false, error: `fetch of #${number}'s head failed: ${r.stderr}` };
}

// ── the run ──────────────────────────────────────────────────────────────────

/** Pure orchestration over a checkout at `cwd`; `deps.get` replaces `gh api` reads. Returns `{ exit, report }`. */
export function run(opts, { cwd = process.cwd(), get } = {}) {
  const fetched = [];
  try {
    return runOnce(opts, { cwd, get, fetched });
  } finally {
    for (const ref of fetched) git(cwd, ['update-ref', '-d', ref]);
  }
}

function runOnce(opts, { cwd, get, fetched }) {
  const cannot = (error) => ({ exit: EXIT.CANNOT_ANSWER, report: { verdict: 'cannot-answer', error } });
  const branchSha = resolveCommit(cwd, opts.branch);
  if (!branchSha) return cannot(`--branch ${opts.branch} names no commit here`);
  const baseSha = resolveCommit(cwd, opts.base);
  if (!baseSha) return cannot(`--base ${opts.base} names no commit here — fetch it first (git fetch ${opts.remote} main)`);
  const sym = git(cwd, ['rev-parse', '--abbrev-ref', opts.branch]);
  const branchName = sym.status === 0 && sym.stdout.trim() !== 'HEAD' ? sym.stdout.trim() : null;

  const own = changedFiles(cwd, opts.base, opts.branch, opts.remote);
  if (!own.ok) return cannot(own.error);

  const report = {
    branch: opts.branch, branchName, branchSha, base: opts.base, baseSha, own: own.files,
    baseConflicts: [], prs: [], verdict: null,
  };
  const vsBase = mergeTree(cwd, opts.base, opts.branch, opts.remote);
  if (!vsBase.ok) return cannot(vsBase.error);
  report.baseConflicts = vsBase.conflicts;

  let candidates;
  if (opts.prs) {
    candidates = opts.prs.filter((n) => !opts.exclude.includes(n)).map((number) => ({ number, shared: null }));
  } else {
    const open = readOpenPrs(opts.repo, { get });
    if (!open.ok) return cannot(open.error);
    candidates = selectCandidates(open.prs, own.files, { branchName, branchSha, exclude: opts.exclude });
  }
  const mine = new Set(own.files);
  for (const c of candidates) {
    const head = fetchPrHead(cwd, opts.remote, c.number);
    if (!head.ok) return cannot(head.error);
    fetched.push(head.ref);
    const m = mergeTree(cwd, opts.branch, head.ref, opts.remote);
    if (!m.ok) return cannot(`#${c.number}: ${m.error}`);
    const elsewhere = m.conflicts.filter((f) => !mine.has(f));
    let theirs = [];
    if (elsewhere.length > 0) {
      const vsMain = mergeTree(cwd, opts.base, head.ref, opts.remote);
      if (!vsMain.ok) return cannot(`#${c.number} against ${opts.base}: ${vsMain.error}`);
      theirs = vsMain.conflicts;
    }
    const notYours = elsewhere.filter((f) => theirs.includes(f));
    report.prs.push({
      number: c.number,
      shared: c.shared,
      conflicts: m.conflicts.filter((f) => !notYours.includes(f)),
      notYours,
    });
  }
  const overlap = report.baseConflicts.length > 0 || report.prs.some((p) => p.conflicts.length > 0);
  report.verdict = overlap ? 'overlap' : 'clean';
  return { exit: overlap ? EXIT.OVERLAP : EXIT.CLEAN, report };
}

export function renderText({ exit, report }) {
  if (report.verdict === 'cannot-answer') {
    return `✗ overlap-check: PREREQUISITE NOT MET — ${report.error}\nVERDICT cannot-answer exit ${exit}`;
  }
  const short = (sha) => sha.slice(0, 10);
  const lines = [
    `overlap-check: ${report.branchName ?? report.branch} (${short(report.branchSha)}) changes ${report.own.length} ` +
      `file(s); against ${report.base} (${short(report.baseSha)}) and ${report.prs.length} PR head(s)`,
  ];
  lines.push(report.baseConflicts.length
    ? `  ✗ ${report.base}: conflicts in ${report.baseConflicts.join(', ')}`
    : `  ✓ ${report.base}: merges cleanly`);
  for (const p of report.prs) {
    const shares = p.shared ? ` (shares ${p.shared.join(', ')})` : '';
    lines.push(p.conflicts.length
      ? `  ✗ #${p.number}${shares}: conflicts in ${p.conflicts.join(', ')}`
      : `  ✓ #${p.number}${shares}: merges cleanly`);
    if (p.notYours.length) lines.push(`      not yours (#${p.number} against main): ${p.notYours.join(', ')}`);
  }
  lines.push(`VERDICT ${report.verdict} exit ${exit}`);
  return lines.join('\n');
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(`✗ overlap-check: ${parsed.error}\n${USAGE}`);
    return EXIT.USAGE;
  }
  const result = run(parsed.opts);
  if (parsed.opts.json) console.log(JSON.stringify({ exit: result.exit, ...result.report }, null, 2));
  else (result.exit === EXIT.CANNOT_ANSWER ? console.error : console.log)(renderText(result));
  return result.exit;
}

// ── self-test ────────────────────────────────────────────────────────────────

// Set as the self-test's last statement, after its success line; the dispatch refuses when it is unset.
let selfTestReachedVerdict = false;

// Battery name → minimum registered cases. A literal, so a deleted battery names itself in the refusal.
const SELF_TEST_BATTERIES = Object.freeze({
  'argv': 4,
  'merge-tree: a real two-branch conflict': 2,
  'merge-tree: no conflict (same file, other hunk; disjoint files)': 2,
  'merge-tree: a registered merge driver does not hide the conflict': 2,
  'candidates: shared files only, own PR skipped, renames count': 4,
  'open-PR read: paged through the injected reader, a failed read refuses': 3,
  'cli: end to end against a remote carrying refs/pull/N/head': 9,
});
const SELF_TEST_BATTERY_FLOOR = 7;

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'overlap-check', GIT_AUTHOR_EMAIL: 'self-test@example.invalid',
  GIT_COMMITTER_NAME: 'overlap-check', GIT_COMMITTER_EMAIL: 'self-test@example.invalid',
};

function fixtureGit(cwd, args) {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV },
  });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

const LINES = (edit = {}) => `${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => edit[n] ?? `line ${n}`).join('\n')}\n`;

/**
 * A remote (bare) and a clone of it. main: a.txt, b.txt, c.txt. Branches, all off main:
 *   mine     a.txt line 2                      — the branch under test
 *   rival    a.txt line 2                      — a real conflict with `mine`        (published as PR 7)
 *   friend   a.txt line 8                      — same file, other hunk: clean       (published as PR 8)
 *   stranger b.txt                             — disjoint files: clean              (published as PR 9)
 *   mover    a.txt → moved.txt, line 2 edited  — a rename: git names the conflict
 *            moved.txt, outside `mine`'s change set                                (published as PR 10)
 * plus `main2` (main moved on: a.txt line 2 again) for the base-conflict case, and `mine2` (main2 plus a c.txt
 * edit), whose merge with PR 7 conflicts on a.txt only because main2 and PR 7 do: not its own.
 */
function buildFixture(root) {
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  fixtureGit(root, ['init', '-q', '--bare', '-b', 'main', remote]);
  fixtureGit(root, ['init', '-q', '-b', 'main', work]);
  const commitOn = (branch, from, files, msg) => {
    if (from) fixtureGit(work, ['checkout', '-q', '-B', branch, from]);
    for (const [path, text] of Object.entries(files)) {
      if (text === null) unlinkSync(join(work, path)); else writeFileSync(join(work, path), text);
    }
    fixtureGit(work, ['add', '-A']);
    fixtureGit(work, ['commit', '-q', '-m', msg]);
  };
  writeFileSync(join(work, '.gitattributes'), 'a.txt merge=resolve-all\n');
  commitOn('main', null, { 'a.txt': LINES(), 'b.txt': 'b\n', 'c.txt': 'c\n' }, 'base');
  commitOn('mine', 'main', { 'a.txt': LINES({ 2: 'line 2 — mine' }) }, 'mine');
  commitOn('rival', 'main', { 'a.txt': LINES({ 2: 'line 2 — rival' }) }, 'rival');
  commitOn('friend', 'main', { 'a.txt': LINES({ 8: 'line 8 — friend' }) }, 'friend');
  commitOn('stranger', 'main', { 'b.txt': 'b — stranger\n' }, 'stranger');
  commitOn('mover', 'main', { 'a.txt': null, 'moved.txt': LINES({ 2: 'line 2 — mover' }) }, 'mover');
  commitOn('main2', 'main', { 'a.txt': LINES({ 2: 'line 2 — main moved' }) }, 'main moved');
  commitOn('mine2', 'main2', { 'c.txt': 'c — mine2\n' }, 'mine2');
  fixtureGit(work, ['remote', 'add', 'origin', remote]);
  fixtureGit(work, ['push', '-q', 'origin', 'main', 'mine', 'mine2',
    'rival:refs/pull/7/head', 'friend:refs/pull/8/head', 'stranger:refs/pull/9/head', 'mover:refs/pull/10/head', 'main2:refs/heads/main2']);
  fixtureGit(work, ['fetch', '-q', 'origin']);
  fixtureGit(work, ['checkout', '-q', 'mine']);
  return { remote, work };
}

function selfTest() {
  const seen = new Map();
  let failed = 0;
  let cases = 0;
  const check = (battery, label, ok, detail = '') => {
    seen.set(battery, (seen.get(battery) ?? 0) + 1);
    cases += 1;
    if (ok) return;
    failed += 1;
    console.error(`  ✗ [${battery}] ${label}${detail ? `\n      ${detail}` : ''}`);
  };
  const root = mkdtempSync(join(tmpdir(), 'overlap-check-'));
  try {
    // argv
    const A = 'argv';
    check(A, 'defaults: HEAD against origin/main of objectstack', (() => {
      const p = parseArgs([]);
      return p.ok && p.opts.branch === 'HEAD' && p.opts.base === 'origin/main' && p.opts.repo === DEFAULT_REPO && p.opts.prs === null;
    })());
    check(A, '--remote moves the default base with it', parseArgs(['--remote=up']).opts?.base === 'up/main');
    check(A, '--pr=#7,8 parses to [7, 8]', JSON.stringify(parseArgs(['--pr=#7,8']).opts?.prs) === '[7,8]');
    check(A, 'an unknown flag, a bare --pr and a non-number refuse', ['--frob', '--pr', '--pr=x', '--repo=nope']
      .every((a) => parseArgs([a]).ok === false));

    const { work } = buildFixture(root);

    // merge-tree, real git
    const T = 'merge-tree: a real two-branch conflict';
    const conflict = mergeTree(work, 'mine', 'origin/main2');
    check(T, 'mine × main2 (both edit a.txt line 2) conflicts', conflict.ok && conflict.conflicts.join() === 'a.txt', JSON.stringify(conflict));
    const rival = mergeTree(work, 'mine', 'rival');
    check(T, 'mine × rival conflicts on a.txt only', rival.ok && rival.conflicts.join() === 'a.txt', JSON.stringify(rival));

    const N = 'merge-tree: no conflict (same file, other hunk; disjoint files)';
    const friend = mergeTree(work, 'mine', 'friend');
    check(N, 'mine × friend (a.txt line 8) is clean', friend.ok && friend.conflicts.length === 0, JSON.stringify(friend));
    const stranger = mergeTree(work, 'mine', 'stranger');
    check(N, 'mine × stranger (b.txt) is clean', stranger.ok && stranger.conflicts.length === 0, JSON.stringify(stranger));

    // The fixture routes a.txt to a driver that "resolves" everything, as the os-regen driver does.
    const D = 'merge-tree: a registered merge driver does not hide the conflict';
    fixtureGit(work, ['config', 'merge.resolve-all.driver', 'true']);
    const control = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', 'mine', 'rival'], { cwd: work, encoding: 'utf8' });
    check(D, 'control: a plain merge-tree with the driver ON reads the conflict as clean (exit 0)', control.status === 0,
      `exit ${control.status} — the fixture no longer exercises the driver, so the next case proves nothing`);
    const withDriver = mergeTree(work, 'mine', 'rival');
    check(D, 'mergeTree() still reports a.txt with the driver registered', withDriver.ok && withDriver.conflicts.join() === 'a.txt', JSON.stringify(withDriver));
    fixtureGit(work, ['config', '--unset', 'merge.resolve-all.driver']);

    // candidates
    const C = 'candidates: shared files only, own PR skipped, renames count';
    const prs = [
      { number: 1, headRef: 'other', headSha: 's1', files: ['a.txt'] },
      { number: 2, headRef: 'other2', headSha: 's2', files: ['z.txt'] },
      { number: 3, headRef: 'mine', headSha: 's3', files: ['a.txt'] },
      { number: 4, headRef: 'x', headSha: 'MINE', files: ['a.txt'] },
      { number: 5, headRef: 'y', headSha: 's5', files: ['new.txt', 'a.txt'] },
    ];
    const sel = selectCandidates(prs, ['a.txt'], { branchName: 'mine', branchSha: 'MINE', exclude: [5] });
    check(C, 'a PR sharing a.txt is a candidate, with its shared list', sel.some((p) => p.number === 1 && p.shared.join() === 'a.txt'));
    check(C, 'a PR touching only other files is not', !sel.some((p) => p.number === 2));
    check(C, 'the branch\'s own PR (by head ref and by head sha) and --exclude-pr are skipped', sel.map((p) => p.number).join() === '1');
    const renamed = readOpenPrs('o/r', { get: (p) => ({ ok: true, value: p.startsWith('repos/o/r/pulls?') ? [{ number: 6, head: { ref: 'r', sha: 's6' } }]
      : [{ filename: 'moved.txt', previous_filename: 'a.txt' }] }) });
    check(C, 'a rename away from a shared file still shares it', renamed.ok
      && selectCandidates(renamed.prs, ['a.txt']).map((p) => p.number).join() === '6', JSON.stringify(renamed));

    // open-PR read, paged
    const R = 'open-PR read: paged through the injected reader, a failed read refuses';
    const asked = [];
    const pageOf = (n, from) => Array.from({ length: n }, (_, i) => ({ number: from + i, head: { ref: `b${from + i}`, sha: `s${from + i}` } }));
    const paged = readOpenPrs('o/r', { get: (p) => {
      asked.push(p);
      if (p.startsWith('repos/o/r/pulls?')) return { ok: true, value: /page=1$/.test(p) ? pageOf(100, 1) : pageOf(2, 101) };
      return { ok: true, value: [{ filename: 'f.txt' }] };
    } });
    check(R, 'two pages of PRs → 102 rows', paged.ok && paged.prs.length === 102, `${paged.prs?.length}`);
    check(R, 'one files read per PR', asked.filter((p) => /\/files\?/.test(p)).length === 102);
    const broken = readOpenPrs('o/r', { get: (p) => (p.includes('/pulls/2/files') ? { ok: false, error: 'HTTP 502' }
      : { ok: true, value: p.startsWith('repos/o/r/pulls?') ? pageOf(3, 1) : [] }) });
    check(R, 'a failed files read is an error naming the PR, never a shorter list', !broken.ok && /#2/.test(broken.error), JSON.stringify(broken));

    // CLI, end to end: the PR heads come from refs/pull/N/head on the remote, as on GitHub.
    const L = 'cli: end to end against a remote carrying refs/pull/N/head';
    const cli = (args) => spawnSync(process.execPath, [SELF_PATH, ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
    const hit = cli(['--pr=7,8,9']);
    check(L, '--pr=7,8,9 exits 1 on the real conflict with #7', hit.status === 1 && /#7: conflicts in a\.txt/.test(hit.stdout), `${hit.status}\n${hit.stdout}${hit.stderr}`);
    check(L, '…and names #8 (same file, other hunk) and #9 as clean', /#8: merges cleanly/.test(hit.stdout) && /#9: merges cleanly/.test(hit.stdout), hit.stdout);
    const clean = cli(['--pr=8,9']);
    check(L, '--pr=8,9 exits 0', clean.status === 0 && /VERDICT clean exit 0/.test(clean.stdout), `${clean.status}\n${clean.stdout}${clean.stderr}`);
    const vsBase = cli(['--base=origin/main2', '--pr=9', '--json']);
    const baseJson = (() => { try { return JSON.parse(vsBase.stdout); } catch { return null; } })();
    check(L, 'a conflict with the base exits 1 and lists the file under the base', vsBase.status === 1 && baseJson?.baseConflicts?.join() === 'a.txt', `${vsBase.status}\n${vsBase.stdout}${vsBase.stderr}`);
    const moverRun = cli(['--pr=10', '--json']);
    const moverJson = (() => { try { return JSON.parse(moverRun.stdout); } catch { return null; } })();
    check(L, 'a PR renaming the file the branch edits (conflict under the NEW name) exits 1, counted as yours',
      moverRun.status === 1 && moverJson?.prs?.[0]?.conflicts?.join() === 'moved.txt' && moverJson.prs[0].notYours.length === 0,
      `${moverRun.status}\n${moverRun.stdout}${moverRun.stderr}`);
    const inherited = cli(['--branch=origin/mine2', '--base=origin/main2', '--pr=7', '--json']);
    const inheritedJson = (() => { try { return JSON.parse(inherited.stdout); } catch { return null; } })();
    check(L, 'a conflict the PR has with the base itself, off the branch\'s files, is not yours: exit 0',
      inherited.status === 0 && inheritedJson?.prs?.[0]?.notYours?.join() === 'a.txt',
      `${inherited.status}\n${inherited.stdout}${inherited.stderr}`);
    const leftover = spawnSync('git', ['for-each-ref', REF_NAMESPACE], { cwd: work, encoding: 'utf8' });
    check(L, 'no fetched PR head is left under refs/overlap-check/pull/ after the runs', leftover.status === 0 && leftover.stdout.trim() === '',
      leftover.stdout);
    const usage = cli(['--nope']);
    check(L, 'a usage error exits 2', usage.status === 2, `${usage.status}`);
    fixtureGit(work, ['checkout', '-q', '--orphan', 'island']);
    fixtureGit(work, ['commit', '-q', '--allow-empty', '-m', 'no shared history']);
    const island = cli(['--pr=7']);
    check(L, 'no merge base (the shallow-clone shape) exits 3 naming --deepen on the remote, never 0', island.status === 3 && /--deepen=1500 origin main/.test(island.stderr), `${island.status}\n${island.stdout}${island.stderr}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ the self-test threw: ${err.stack ?? err.message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // Floor: the registered battery set must equal the declared roster, each at or above its pin.
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = (message) => { failed += 1; console.error(`✗ self-test floor: ${message}`); };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floor(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  for (const [name, count] of seen) {
    if (!declared.includes(name)) floor(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floor(count === 0 ? `battery "${name}" DID NOT RUN — 0 cases, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]}.`);
    }
  }
  if (failed > 0) {
    console.error(`\n✗ overlap-check self-test: ${failed} failure(s) (cases and floor).`);
    return 1;
  }
  console.log(`✓ overlap-check self-test: ${cases} cases in ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (code === 0 && !selfTestReachedVerdict) {
      console.error('✗ overlap-check self-test: selfTest() returned without reaching its verdict — not a pass.');
      process.exit(1);
    }
    process.exit(code);
  }
  process.exit(main(process.argv.slice(2)));
}
