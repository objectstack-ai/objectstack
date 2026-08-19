#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * git-history.mjs — answer a "how many commits on <ref> in <window>" question,
 * or REFUSE, so a churn number can never be quoted from truncated history
 * (#9878).
 *
 *   node scripts/pm/git-history.mjs count  --since=2026-07-19 [--until=2026-08-19]
 *   node scripts/pm/git-history.mjs count  --days=30 [--ref=origin/main] [--path=packages/core]
 *   node scripts/pm/git-history.mjs log    --since=2026-07-19 [--format=%H%x09%s]
 *   node scripts/pm/git-history.mjs ensure --since=2026-07-19   # deepen + prove, answer nothing
 *   node scripts/pm/git-history.mjs --self-test
 *
 * Exit codes: **0** answered, and the answer is provable · **2** refused — the
 * window is not fully present locally and could not be made so · **1** usage or
 * environment.
 *
 * On success the ANSWER alone goes to stdout (so `$(...)` capture works) and a
 * one-line method receipt goes to stderr, ready to paste beside the number.
 * On refusal **stdout stays empty** — a caller that captures the number gets an
 * empty string rather than a plausible one. Zero is a broken scan, not a clean
 * repo (#4690).
 *
 * ## The trap this exists to end (all figures measured 2026-08-19, this container)
 *
 * Agent containers clone shallow. `git log --since` / `rev-list --count` then
 * answer from whatever part of the population happens to be present, **exit 0,
 * and print no warning** — the grafted boundary is invisible. Two reproductions:
 *
 *   | clone                                   | "commits on main in the month to 2026-08-19" |
 *   |-----------------------------------------|----------------------------------------------|
 *   | `git clone --depth=63`                  | **63**, exit 0, no warning                   |
 *   | this container as it arrived (floor 06-02) | 3205 — correct, because the window happened to fit |
 *   | same clone, window crossing the floor   | **324** for the month to 2026-06-15, exit 0  |
 *
 * The 63-commit clone also answers `git log --since=2026-07-19 --until=2026-08-01`
 * with **zero lines** — indistinguishable from "nothing landed that fortnight".
 * PR #9712 priced a ratchet on **269** commits/month this way; the first-parent
 * count for its window is ~3,110, so the denominator was ~12x too small.
 *
 * ## Two findings that shape this tool, both measured rather than assumed
 *
 * **1. `git fetch --shallow-since` is NOT monotonic — it SHORTENS too.** The
 * card's own suggested remedy, run against a clone that already had more
 * history than asked for, silently threw history away:
 *
 *   | step                                             | first-parent on origin/main | floor      |
 *   |--------------------------------------------------|-----------------------------|------------|
 *   | container as it arrived                           | 4585                        | 2026-06-02 |
 *   | `git fetch --shallow-since=2026-07-19 origin main`| **3205**                    | 2026-07-19 |
 *
 * exit 0, no warning. git documents this ("deepen or **shorten**"), and it makes
 * the naive fix a second instance of the defect. So this tool never passes a
 * `--shallow-since` date that is newer than the OLDEST boundary already present
 * (`chooseDeepenSince()`); the deepen it issues can only ever add.
 *
 * **2. `--is-shallow-repository` is the WRONG predicate on its own.** After a
 * legitimate deepen this repo still reports `true` while answering the asked
 * month exactly — a guard that refused on "still shallow" would refuse correct
 * answers and train people to bypass it. What decides the question is whether
 * the window sits entirely ABOVE the shallow floor, so that is what is checked:
 * the newest boundary commit reachable from the ref must predate `--since`.
 *
 * ## Cost, measured — because a tool nobody runs fixes nothing
 *
 *   | case                                            | wall  |
 *   |-------------------------------------------------|-------|
 *   | window already covered (the common case)         | 1.6 s |
 *   | cold deepen, +1 month (+1019 first-parent commits)| 5.2 s |
 *
 * Cheaper than the ~15 s the filing card estimated, and the common case pays
 * nothing at all: coverage is proved from local refs first, and a fetch is
 * issued only when the floor actually intrudes into the window.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_REF = 'origin/main';
/** Slack applied below `--since` when deepening, absorbing commit-date skew. */
const DEFAULT_MARGIN_DAYS = 7;

// ── git plumbing ─────────────────────────────────────────────────────────────

function git(args, { cwd = process.cwd(), allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${String(err.stderr || err.message).trim()}`);
  }
}

export function isShallow(cwd) {
  return (git(['rev-parse', '--is-shallow-repository'], { cwd, allowFail: true }) || '').trim() === 'true';
}

/**
 * Commit dates (ms) of every parentless commit reachable from `ref`. In a
 * shallow clone those are the graft boundaries; in a complete clone they are
 * the real roots. Read from the ref rather than from `.git/shallow` so the
 * answer is about the history actually being measured — and so it is correct
 * from a linked worktree, where `.git` is a file and the shallow list lives in
 * the common dir shared with every other worktree.
 */
export function boundaryTimes(cwd, ref) {
  const out = git(['rev-list', '--max-parents=0', '--format=%cI', ref], { cwd, allowFail: true });
  if (out === null) return null;
  return out
    .split('\n')
    .filter((l) => l !== '' && !l.startsWith('commit '))
    .map((l) => Date.parse(l.trim()))
    .filter((n) => Number.isFinite(n));
}

// ── the two decisions, as pure functions so the self-test can pin them ───────

/**
 * Is every commit in `[since, ...)` on this ref present locally? True when the
 * NEWEST boundary predates the window: nothing in the window can then sit below
 * a graft. Note this is deliberately not `!isShallow` — a shallow clone whose
 * floor is old enough answers the asked window exactly.
 */
export function windowIsCovered({ shallow, boundaries, sinceMs }) {
  if (!shallow) return true;
  if (!boundaries || boundaries.length === 0) return false;
  return Math.max(...boundaries) < sinceMs;
}

/**
 * The `--shallow-since` date to deepen with. Never newer than the oldest
 * boundary already present, so the fetch can only ADD history — see finding 1
 * in the header, where the naive form threw 1380 commits away at exit 0.
 */
export function chooseDeepenSince({ sinceMs, boundaries, marginDays = DEFAULT_MARGIN_DAYS }) {
  const desired = sinceMs - marginDays * 24 * 60 * 60 * 1000;
  const floor = boundaries && boundaries.length > 0 ? Math.min(...boundaries) : desired;
  return new Date(Math.min(desired, floor)).toISOString();
}

/** `origin/main` -> { remote: 'origin', branch: 'main' }; a local ref -> null. */
export function splitRemoteRef(ref, knownRemotes) {
  const slash = ref.indexOf('/');
  if (slash <= 0) return null;
  const remote = ref.slice(0, slash);
  const branch = ref.slice(slash + 1);
  if (!knownRemotes.includes(remote) || branch === '') return null;
  return { remote, branch };
}

// ── ensure ───────────────────────────────────────────────────────────────────

export function ensureWindowCovered({ cwd, ref, sinceMs, allowFetch = true, allowUnshallow = true, marginDays }) {
  const steps = [];
  const shallow0 = isShallow(cwd);
  const boundaries0 = boundaryTimes(cwd, ref);
  if (boundaries0 === null) {
    return { covered: false, steps, reason: `ref '${ref}' does not resolve in this checkout` };
  }
  if (windowIsCovered({ shallow: shallow0, boundaries: boundaries0, sinceMs })) {
    steps.push(shallow0 ? 'floor already predates the window (no fetch)' : 'complete clone (no fetch)');
    return { covered: true, steps, shallow: shallow0, boundaries: boundaries0 };
  }
  if (!allowFetch) {
    return {
      covered: false,
      steps,
      shallow: shallow0,
      boundaries: boundaries0,
      reason: 'history is truncated inside the window and --no-fetch was given',
    };
  }

  const remotes = (git(['remote'], { cwd, allowFail: true }) || '').split('\n').filter(Boolean);
  const target = splitRemoteRef(ref, remotes);
  if (!target) {
    return {
      covered: false,
      steps,
      reason:
        `history is truncated inside the window and '${ref}' names no remote to deepen from ` +
        `(remotes here: ${remotes.length ? remotes.join(', ') : 'none'})`,
    };
  }

  const deepenSince = chooseDeepenSince({ sinceMs, boundaries: boundaries0, marginDays });
  const fetched = git(['fetch', `--shallow-since=${deepenSince}`, target.remote, target.branch], { cwd, allowFail: true });
  steps.push(`fetch --shallow-since=${deepenSince} ${target.remote} ${target.branch}${fetched === null ? ' (failed)' : ''}`);

  let boundaries = boundaryTimes(cwd, ref) || boundaries0;
  let shallow = isShallow(cwd);
  if (windowIsCovered({ shallow, boundaries, sinceMs })) {
    return { covered: true, steps, shallow, boundaries };
  }

  if (allowUnshallow) {
    const un = git(['fetch', '--unshallow', target.remote], { cwd, allowFail: true });
    steps.push(`fetch --unshallow ${target.remote}${un === null ? ' (failed)' : ''}`);
    boundaries = boundaryTimes(cwd, ref) || boundaries;
    shallow = isShallow(cwd);
    if (windowIsCovered({ shallow, boundaries, sinceMs })) {
      return { covered: true, steps, shallow, boundaries };
    }
  }

  return {
    covered: false,
    steps,
    shallow,
    boundaries,
    reason: 'the shallow floor still sits inside the window after deepening',
  };
}

// ── answering ────────────────────────────────────────────────────────────────

function windowArgs({ since, until }) {
  const args = [`--since=${since}`];
  if (until) args.push(`--until=${until}`);
  return args;
}

/**
 * The date of the newest commit on `ref`. Depth is only half the question: a ref
 * that is merely STALE answers "commits in the last month" just as wrongly and
 * just as silently. Measured while building this: a depth-63 fixture whose
 * origin/main stopped at 2026-08-16 answered 2902 for the month to 2026-08-19,
 * and 2902 is the exactly correct answer for that ref. Nothing about the number
 * says the ref stopped three days early, so the tip travels in the receipt.
 */
export function refTip(cwd, ref) {
  const out = git(['log', '-1', '--format=%cI', ref], { cwd, allowFail: true });
  return out === null ? 'unknown' : out.trim().slice(0, 10);
}

export function describeFloor(boundaries) {
  if (!boundaries || boundaries.length === 0) return 'unknown';
  return new Date(Math.max(...boundaries)).toISOString().slice(0, 10);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function usage(msg) {
  if (msg) process.stderr.write(`git-history: ${msg}\n\n`);
  process.stderr.write(
    'usage:\n' +
      '  node scripts/pm/git-history.mjs count  --since=<date>|--days=<n> [--until=<date>] [--ref=<ref>]\n' +
      '                                         [--path=<p>]... [--no-first-parent] [--no-fetch] [--no-unshallow]\n' +
      '  node scripts/pm/git-history.mjs log    --since=<date>|--days=<n> [--format=<fmt>] [...]\n' +
      '  node scripts/pm/git-history.mjs ensure --since=<date>|--days=<n> [--ref=<ref>]\n' +
      '  node scripts/pm/git-history.mjs --self-test\n\n' +
      'exit 0 answered · 2 refused (window not provably complete) · 1 usage/environment\n',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { paths: [], firstParent: true, fetch: true, unshallow: true, ref: DEFAULT_REF, format: '%H%x09%cI%x09%s' };
  let cmd = null;
  for (const arg of argv) {
    if (!arg.startsWith('--') && cmd === null) { cmd = arg; continue; }
    const [k, ...rest] = arg.split('=');
    const v = rest.join('=');
    switch (k) {
      case '--since': opts.since = v; break;
      case '--until': opts.until = v; break;
      case '--days': opts.days = Number(v); break;
      case '--ref': opts.ref = v; break;
      case '--path': opts.paths.push(v); break;
      case '--format': opts.format = v; break;
      case '--margin-days': opts.marginDays = Number(v); break;
      case '--no-first-parent': opts.firstParent = false; break;
      case '--no-fetch': opts.fetch = false; break;
      case '--no-unshallow': opts.unshallow = false; break;
      case '--cwd': opts.cwd = v; break;
      default: usage(`unknown option ${k}`);
    }
  }
  return { cmd, opts };
}

function resolveSince(opts) {
  if (opts.since !== undefined && opts.days !== undefined) usage('pass --since or --days, not both');
  if (opts.days !== undefined) {
    if (!Number.isFinite(opts.days) || opts.days <= 0) usage('--days must be a positive number');
    return new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000).toISOString();
  }
  if (opts.since === undefined) usage('--since=<date> or --days=<n> is required');
  const ms = Date.parse(opts.since);
  // Refuse what cannot be compared to a boundary rather than guessing: git
  // accepts "30 days ago", but a window this tool cannot place on a timeline is
  // a window whose coverage it cannot prove.
  if (!Number.isFinite(ms)) usage(`--since=${opts.since} is not a date this tool can place (use YYYY-MM-DD, or --days=<n>)`);
  return opts.since;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  const { cmd, opts } = parseArgs(argv);
  if (cmd === null) usage('a command is required');
  if (!['count', 'log', 'ensure'].includes(cmd)) usage(`unknown command '${cmd}'`);

  const since = resolveSince(opts);
  const sinceMs = Date.parse(since);
  const cwd = opts.cwd || process.cwd();

  const ensured = ensureWindowCovered({
    cwd,
    ref: opts.ref,
    sinceMs,
    allowFetch: opts.fetch,
    allowUnshallow: opts.unshallow,
    marginDays: opts.marginDays,
  });

  if (!ensured.covered) {
    process.stderr.write(
      `⛔ git-history REFUSES to answer — ${ensured.reason}.\n` +
        `   ref: ${opts.ref}   window: since ${String(since).slice(0, 10)}` +
        `${opts.until ? ` until ${opts.until}` : ''}\n` +
        `   shallow floor: ${describeFloor(ensured.boundaries)} (the oldest commit this clone can see on that ref)\n` +
        `${ensured.steps.length ? `   tried: ${ensured.steps.join(' · ')}\n` : ''}` +
        `   Any number derived here would be real, plausible and WRONG — the missing\n` +
        `   commits are invisible to git log, which reports no error (#9878).\n` +
        `   Remedy: git -C ${cwd} fetch --unshallow ${splitRemoteRef(opts.ref, ['origin']) ? 'origin' : '<remote>'}\n`,
    );
    process.exit(2);
  }

  const receipt =
    `method: ${cmd === 'log' ? 'git log' : 'git rev-list --count'}` +
    `${opts.firstParent ? ' --first-parent' : ''} ${opts.ref} since ${String(since).slice(0, 10)}` +
    `${opts.until ? ` until ${opts.until}` : ''}` +
    `${opts.paths.length ? ` -- ${opts.paths.join(' ')}` : ''}` +
    ` · floor ${describeFloor(ensured.boundaries)} · tip ${refTip(cwd, opts.ref)} · ${ensured.steps.join(' · ')}`;

  if (cmd === 'ensure') {
    process.stderr.write(`✓ history covers the window — ${receipt}\n`);
    return 0;
  }

  const fp = opts.firstParent ? ['--first-parent'] : [];
  const pathArgs = opts.paths.length ? ['--', ...opts.paths] : [];
  const out =
    cmd === 'count'
      ? git(['rev-list', '--count', ...fp, ...windowArgs({ since, until: opts.until }), opts.ref, ...pathArgs], { cwd })
      : git(['log', ...fp, `--format=${opts.format}`, ...windowArgs({ since, until: opts.until }), opts.ref, ...pathArgs], { cwd });

  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  process.stderr.write(`${receipt}\n`);
  return 0;
}

// ── self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  let failures = 0;
  const t = (name, ok, detail = '') => {
    if (ok) { process.stdout.write(`  ✓ ${name}\n`); return; }
    failures += 1;
    process.stdout.write(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}\n`);
  };

  // ── pure decisions ────────────────────────────────────────────────────────
  const day = 24 * 60 * 60 * 1000;
  const t0 = Date.parse('2026-08-01T00:00:00Z');

  t('a complete clone is covered whatever its roots say',
    windowIsCovered({ shallow: false, boundaries: [t0 + day], sinceMs: t0 }));
  t('a shallow clone whose floor predates the window IS covered (the #9878 refinement: '
    + 'is-shallow alone would refuse a provably correct answer)',
    windowIsCovered({ shallow: true, boundaries: [t0 - 10 * day], sinceMs: t0 }));
  t('a shallow clone whose floor sits inside the window is NOT covered',
    !windowIsCovered({ shallow: true, boundaries: [t0 + 2 * day], sinceMs: t0 }));
  t('the NEWEST boundary decides, not the oldest — one truncated line is enough',
    !windowIsCovered({ shallow: true, boundaries: [t0 - 50 * day, t0 + 2 * day], sinceMs: t0 }));
  t('a shallow clone with no readable boundary is refused rather than assumed fine',
    !windowIsCovered({ shallow: true, boundaries: [], sinceMs: t0 }));

  // The measured hazard: a deepen must never be able to shorten.
  const shortenCase = chooseDeepenSince({ sinceMs: t0, boundaries: [t0 - 60 * day, t0 + 2 * day], marginDays: 7 });
  t('chooseDeepenSince never asks for a date NEWER than the oldest boundary '
    + '(else fetch --shallow-since SHORTENS: measured 4585 -> 3205 commits at exit 0)',
    Date.parse(shortenCase) <= t0 - 60 * day, `chose ${shortenCase}`);
  t('with no boundary older than the window it still applies the skew margin',
    Date.parse(chooseDeepenSince({ sinceMs: t0, boundaries: [t0 + 2 * day], marginDays: 7 })) === t0 - 7 * day);

  t('splitRemoteRef reads a remote-tracking ref', 
    JSON.stringify(splitRemoteRef('origin/main', ['origin'])) === JSON.stringify({ remote: 'origin', branch: 'main' }));
  t('splitRemoteRef refuses a local branch name', splitRemoteRef('main', ['origin']) === null);
  t('splitRemoteRef refuses an unknown remote', splitRemoteRef('upstream/main', ['origin']) === null);

  // ── real repos ────────────────────────────────────────────────────────────
  const root = mkdtempSync(join(tmpdir(), 'git-history-selftest-'));
  const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const up = join(root, 'up');
    mkdirSync(up, { recursive: true });
    g(['init', '--quiet', '--initial-branch=main', '.'], up);
    g(['config', 'user.email', 'selftest@objectstack.ai'], up);
    g(['config', 'user.name', 'selftest'], up);
    // 40 commits, one per day, oldest first: 2026-06-01 .. 2026-07-10.
    for (let i = 0; i < 40; i += 1) {
      const d = new Date(Date.parse('2026-06-01T12:00:00Z') + i * day).toISOString();
      writeFileSync(join(up, 'f.txt'), `commit ${i}\n`);
      g(['add', 'f.txt'], up);
      execFileSync('git', ['commit', '--quiet', '-m', `c${i}`], {
        cwd: up,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d },
      });
    }

    const full = join(root, 'full');
    g(['clone', '--quiet', `file://${up}`, full], root);
    const self = new URL(import.meta.url).pathname;
    // spawnSync, not execFileSync: the receipt this tool writes goes to stderr
    // on SUCCESS too, and execFileSync surfaces stderr only when it throws.
    const runCliAllowFail = (args, cwd) => {
      const r = spawnSync(process.execPath, [self, ...args, `--cwd=${cwd}`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), code: r.status };
    };

    const fullAnswer = runCliAllowFail(['count', '--since=2026-06-20', '--until=2026-07-11'], full);
    t('a complete clone answers, exit 0', fullAnswer.code === 0, JSON.stringify(fullAnswer));
    t('and the answer is the real one (21 commits: the daily fixture commits i=19..39)',
      fullAnswer.stdout.trim() === '21', `got ${JSON.stringify(fullAnswer.stdout)}`);

    // The card's shape: a shallow clone that answers plausibly and WRONGLY.
    const shallow = join(root, 'shallow');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, shallow], root);
    t('the shallow fixture really is shallow', isShallow(shallow) === true);
    const raw = g(['rev-list', '--count', '--first-parent', '--since=2026-06-20', '--until=2026-07-11', 'origin/main'], shallow).trim();
    t('BASELINE — raw git answers the same question with a wrong number and no warning '
      + '(this is the defect, reproduced)', raw === '5' && raw !== '20', `raw git said ${raw}`);

    const refused = runCliAllowFail(['count', '--since=2026-06-20', '--until=2026-07-11', '--no-fetch'], shallow);
    t('the helper REFUSES that same question rather than answering it', refused.code === 2, `exit ${refused.code}`);
    t('and stdout stays EMPTY, so a captured number is empty rather than plausible '
      + '(zero is a broken scan, not a clean repo — #4690)', refused.stdout.trim() === '',
      `stdout ${JSON.stringify(refused.stdout)}`);
    t('and the refusal names the floor and a remedy',
      /shallow floor: 2026-0/.test(refused.stderr || '') && /unshallow/.test(refused.stderr || ''),
      refused.stderr);

    // Deepening from a real (local) remote makes the same question answerable.
    const deepened = runCliAllowFail(['count', '--since=2026-06-20', '--until=2026-07-11'], shallow);
    t('with fetching allowed it deepens and then answers, exit 0', deepened.code === 0, JSON.stringify(deepened));
    t('and the answer now MATCHES the complete clone', deepened.stdout.trim() === '21',
      `got ${JSON.stringify(deepened.stdout)}`);
    t('and the receipt states the method beside the number',
      /method: git rev-list --count --first-parent/.test(deepened.stderr || ''), deepened.stderr);
    t('and the receipt carries the ref TIP as well as the floor, so a stale ref is legible '
      + 'in the pasted method line (depth is only half the question)',
      /floor \d{4}-\d{2}-\d{2} · tip \d{4}-\d{2}-\d{2}/.test(deepened.stderr || ''), deepened.stderr);

    // A shallow clone deep enough for the asked window answers with NO fetch.
    const shallowDeep = join(root, 'shallow-deep');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, shallowDeep], root);
    const narrow = runCliAllowFail(['count', '--since=2026-07-08', '--until=2026-07-11', '--no-fetch'], shallowDeep);
    t('a still-shallow clone whose floor predates the window answers WITHOUT fetching '
      + '(a bare is-shallow guard would have refused this correct answer)',
      narrow.code === 0 && narrow.stdout.trim() === '3', JSON.stringify(narrow));
    t('and it says it did not need to fetch', /no fetch/.test(narrow.stderr || ''), narrow.stderr);
    t('the clone is still shallow after that answer — proving the predicate is the floor, '
      + 'not the shallow flag', isShallow(shallowDeep) === true);

    // No remote to deepen from: refuse, never answer.
    const orphan = join(root, 'orphan');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, orphan], root);
    g(['remote', 'remove', 'origin'], orphan);
    g(['update-ref', 'refs/heads/probe', g(['rev-parse', 'HEAD'], orphan).trim()], orphan);
    const noRemote = runCliAllowFail(['count', '--since=2026-06-20', '--ref=probe'], orphan);
    t('with no remote to deepen from it refuses instead of answering from what is there',
      noRemote.code === 2, JSON.stringify(noRemote));
    t('and it says so by name', /no remote|does not resolve/.test(noRemote.stderr || ''), noRemote.stderr);

    // An unusable --since is refused up front rather than silently mis-parsed.
    const badSince = runCliAllowFail(['count', '--since=30 days ago'], full);
    t('a --since git would accept but this tool cannot place is refused as usage',
      badSince.code === 1, JSON.stringify(badSince));

    // ensure answers nothing at all
    const ens = runCliAllowFail(['ensure', '--since=2026-07-08'], shallowDeep);
    t('ensure proves coverage and prints no number', ens.code === 0 && ens.stdout.trim() === '',
      JSON.stringify(ens));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write(failures === 0 ? '\ngit-history --self-test: all cases passed.\n' : `\ngit-history --self-test: ${failures} FAILED.\n`);
  return failures === 0 ? 0 : 1;
}

const invokedDirectly = existsSync(process.argv[1] || '') && new URL(import.meta.url).pathname === process.argv[1];
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)) || 0);
}
