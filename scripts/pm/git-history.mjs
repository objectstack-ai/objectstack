#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * git-history.mjs — answer a "how many commits on <ref> in <window>" question,
 * or a "which commit last touched <path> on <ref>" question, or an "is <commit>
 * in <ref>'s history" question, or REFUSE, so neither a churn number, nor a
 * provenance sha, nor a "not an ancestor" can ever be quoted from truncated
 * history (#9878).
 *
 *   node scripts/pm/git-history.mjs count  --since=2026-07-19 [--until=2026-08-19]
 *   node scripts/pm/git-history.mjs count  --days=30 [--ref=origin/main] [--path=packages/core]
 *   node scripts/pm/git-history.mjs log    --since=2026-07-19 [--format=%H%x09%s]
 *   node scripts/pm/git-history.mjs ensure --since=2026-07-19   # deepen + prove, answer nothing
 *   node scripts/pm/git-history.mjs touch  --path=<file> [--ref=origin/main] [--format=%H]
 *                                          # the last commit on <ref> that touched <file>, PROVEN
 *   node scripts/pm/git-history.mjs ancestor --commit=<sha> [--ref=origin/main] [--control=<sha>]
 *                                          # is <sha> in <ref>'s history: yes or no, PROVEN
 *   node scripts/pm/git-history.mjs --self-test
 *
 * Exit codes: **0** answered, and the answer is provable · **2** refused — the
 * window (or the touch, or the negative) is not provably present locally and
 * could not be made so · **1** usage or environment. `ancestor` alone has one
 * more: **0** is a proven yes and **3** a proven no (the sixth trap below says
 * why a no is neither 0 nor 1).
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
 * ## The second trap, same root: `git log -1 <ref> -- <path>` on a shallow clone
 *
 * The windowed guard covers COUNTS. A provenance lookup — "which commit last
 * touched <path>" — is broken by the same graft in a worse way, because the
 * answer is a single real sha with nothing beside it to look wrong. Measured
 * 2026-09-15 on a constructed 40-commit repo whose `charter.md` was last
 * touched at c2, cloned at two depths:
 *
 *   | clone        | `git log -1 origin/main -- charter.md` | its parent          | `git show --stat <sha> -- charter.md` |
 *   |--------------|----------------------------------------|---------------------|---------------------------------------|
 *   | `--depth=5`  | c35 — the graft boundary                | named, NOT present  | ` charter.md | 1 +`  (non-empty)      |
 *   | `--depth=20` | c20 — the graft boundary                | named, NOT present  | ` charter.md | 1 +`  (non-empty)      |
 *   | deepened     | c2 — correct                            | present             | ` charter.md | 2 +-`                  |
 *
 * Mechanism, established rather than inferred: the boundary commit's OBJECT
 * still names its parent, but the graft hides that parent from traversal, so
 * git diffs the boundary against the EMPTY tree — every path in its tree reads
 * as "added here", the pathspec walk stops, and `-1` prints the boundary as a
 * real, plausible sha at exit 0 with no warning. Two depths name two different
 * shas for one reason. And the natural verification leg — `git show --stat
 * <sha> -- <path>` printing a line — is fooled by the SAME empty-tree diff: the
 * whole file reads as an insertion. So `touch` proves an answer two ways before
 * printing it: the commit is not GRAFTED — every parent its object names is
 * present locally AND git's traversal still uses them (a real root names none
 * and passes on both counts) — and the diff against those parents touches the
 * path. Unprovable ⇒ `fetch --deepen=N` (additive by definition — it counts
 * from the current boundary, never from the tip — doubling from 64), then
 * `--unshallow`, then REFUSE with exit 2 and empty stdout. The predicate is the
 * COMMIT's graft state, never the repo's shallow flag: a clone that is still
 * shallow answers the moment the commit it names is not itself grafted.
 *
 * ## The third trap, same graft: the parent arrives, the registration stays
 *
 * "Every parent the object names is present" was the first spelling of leg 1,
 * and a fetch breaks it in the direction that looks harmless. Measured
 * 2026-09-16 on the shared checkout (#18355) and reproduced in this file's
 * self-test on a constructed fixture: a boundary stayed registered in the
 * shallow list while a LATER fetch — of another ref, or of one sha — brought
 * its parent OBJECT into the store. Leg 1 then passed, the graft was still
 * applied at traversal, and `diff-tree` diffed the commit against its EMPTY
 * grafted parent list and printed nothing. That read back as `{provable:
 * false, boundary: false, reason: "<sha> has its parent(s) locally but its
 * diff does not touch <path>"}` — the refusal still correct, the flag and the
 * sentence beside it both wrong: an operator was told the file was simply
 * untouched, when a grafted walk is what answered. Which of the two sentences
 * came out depended on when the last fetch ran.
 *
 * So the graft is read as git applies it, per sha: `git rev-parse <sha>^@`
 * lists the parents the TRAVERSAL uses — the `--max-parents=0` reading asked
 * of ONE commit — and an object naming a parent that list does not carry is
 * grafted, whether or not that parent is in the object store. Measured here at
 * 2.6 ms per call against 15 ms for `rev-list --max-parents=0 <sha>` (20 runs
 * each, this checkout): the ancestry walk costs more the more history it can
 * see, `^@` costs the same on every clone. It also reads the graft rather than
 * the shallow FILE, so it needs no common-dir resolution from a linked
 * worktree, and it catches a graft from any source.
 *
 * ## The fourth trap, no graft at all: a bare date is read at NOW's time of day
 *
 * The coverage proof places `--since` with `Date.parse`, and ECMA-262 reads a
 * date-only `YYYY-MM-DD` as that day's 00:00:00Z. git places the SAME string
 * with its approxidate, which fills a missing time of day from the CURRENT
 * WALL CLOCK. Passed through verbatim, `--since=2026-09-30` therefore proved
 * one window, counted a narrower one that shrank as the day went on, and
 * printed the wider one in its receipt — at exit 0, on exactly the spelling
 * the usage text recommends (#21601). Measured on ref a7ab047cf6, the clock
 * injected through git's own `GIT_TEST_DATE_NOW`:
 *
 *   | `count --since=…` on a7ab047cf6 | git's clock | answer |
 *   |---------------------------------|-------------|--------|
 *   | `2026-09-30` (bare)             | 00:30Z      | 472    |
 *   | `2026-09-30` (bare)             | 12:45Z      | 410    |
 *   | `2026-09-30` (bare)             | 15:17Z      | 393    |
 *   | `2026-09-30T00:00:00Z`          | any         | 474    |
 *
 * The 410 and the 393 are the two answers the filing card recorded by hand at
 * those hours; the receipt was identical on all four rows. Every other
 * spelling git approxidates fails the same way (`Sep 30 2026`, `2026/09/30`:
 * a midnight to `Date.parse`, now's time of day to git), and `--until` has the
 * mirror image. So a window edge is normalised ONCE, by `windowInstant()`, to
 * the complete UTC instant `Date.parse` already put it at; that instant is
 * what git is handed and what the receipt prints, and a complete instant is
 * parsed exactly and never consults the clock.
 *
 * ## The fifth trap, no git at all: a piped answer is cut at one buffer-full
 *
 * The answer leaves in ONE `process.stdout.write`. Node completes that write
 * at once when stdout is a FILE, but when stdout is a PIPE (on POSIX) it puts
 * in only what the pipe takes in one go and queues the rest for the event
 * loop. The entry used to end with `process.exit(main(...))`, which tears the
 * process down before that queue drains — so `log … | wc -l`, the natural
 * spelling of a count taken through `log`, read one buffer-full at exit 0
 * (#21659). Measured at 7d0781482d on this repository's shallow clone, the
 * same `log --since=2026-08-14T00:00:00Z --ref=3711e0b763` two ways:
 *
 *   | stdout                         | lines | exit |
 *   |--------------------------------|-------|------|
 *   | redirected to a file           | 5455  | 0    |
 *   | piped to `wc -l`, three runs   | 346   | 0    |
 *
 * 346 lines is about one 64 KiB pipe buffer. `count` and `touch` print one
 * line, which always fits, so they never showed it. The entry therefore sets
 * `process.exitCode` and returns: the process ends when its last queued write
 * has drained, on every stdout kind. `main()` and `touchMain()` RETURN their
 * exit codes; the one `process.exit` left is `usage()`'s, and every call to it
 * comes before anything is written to stdout. A reader that closes early
 * (`| head -1`) turns the queued rest into EPIPE; that is the reader's choice,
 * not a lost answer, so it is absorbed and the answer's own exit code stands.
 * The self-test pins a piped `log`, many buffers long, byte for byte against
 * the same `log` sent to a file.
 *
 * ## The sixth trap, same graft: `merge-base --is-ancestor` says "no" for a real ancestor
 *
 * A shallow clone can only WITHHOLD an ancestor path; it never invents one. So
 * the containment reading fails in one direction: exit 0 (an ancestor) proves
 * itself in any clone, and exit 1 (not an ancestor) is what a cut produces for
 * a commit that sits below it. The checks that want the negative — not yet
 * released, not on main, a blocker not landed — are the ones that get it free.
 * Measured on this file's 40-commit self-test fixture cloned at `--depth=5`
 * (floor c35), git 2.43.0:
 *
 *   | `git merge-base --is-ancestor <x> origin/main`                        | exit |
 *   |-----------------------------------------------------------------------|------|
 *   | c38 — inside the window                                               | 0    |
 *   | c2 — in main's real history, its object not in the clone              | 128  |
 *   | c2 — the same commit after `git fetch origin <c2>` put the object in  | **1** |
 *   | a commit built on c2 that never merged                                | 1    |
 *
 * Rows three and four are one exit code for opposite facts, and row two is a
 * third number that `if ! git merge-base --is-ancestor …` reads as the same
 * "no". The prose procedure that used to stand here in a skill file was to run
 * a second leg by hand: a commit known to be in the ref's history and at least
 * as deep as the tested one must answer 0 on the same clone, or the negative
 * is void. `ancestor` runs both legs and names its control itself:
 *
 *   - a YES is printed at once — the path exists here, so it exists;
 *   - a NO stands when no cut can hide the tested commit: either the ref's
 *     history carries no graft at all (every root under it is a real root), or
 *     every graft boundary under the ref is OLDER than the tested commit by the
 *     skew margin. A real ancestor that the walk missed must sit below a
 *     boundary, and a boundary is its descendant, so it cannot predate it. The
 *     newest boundary is therefore the control leg: it is in the ref's history
 *     by construction (it is where the walk stopped) and it is deeper than the
 *     tested commit. `--control=<sha>` adds the operator's own leg on top: it
 *     must answer 0 and must not be newer than the tested commit;
 *   - otherwise it deepens (`--deepen=N` doubling, then `--unshallow`, the same
 *     additive ladder `touch` climbs) and reads again, and REFUSES with exit 2
 *     and empty stdout when the negative still cannot be told from a cut.
 *
 * "Deeper" is read by COMMITTER DATE, the reading the windowed commands
 * already rest on. A history whose committer dates run backwards along
 * ancestry (a `--committer-date-is-author-date` rebase) defeats it;
 * `--margin-days` (default 7) is the slack, and a complete clone needs none.
 *
 * A proven no exits **3**, not 0 and not 1. Not 0, so `ancestor … && echo
 * landed` cannot read a no as a yes. Not 1, because 1 is this tool's usage
 * exit: a mistyped flag must never be readable as "not an ancestor", which is
 * the exact false negative this command exists to end.
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
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEntrypoint } from '../invoked-as.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'pure decisions': 10,
  'real repos': 17,
  'historyHorizon: the read-only reading the #9902 adopters call': 12,
  'bare dates: the instant the proof reads is the instant git counts': 16,
  'touch: the provenance reading a shallow clone fabricates': 26,
  'piped stdout: the answer a pipe reads is the answer a file holds': 4,
  'ancestor: the negative a shallow clone fabricates': 32,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 7;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

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
    // The boundaries were READ above; a ref that names no remote (a bare sha, a
    // local branch) cannot be deepened, but its floor is still known, so the
    // refusal prints it rather than `shallow floor: unknown`.
    return {
      covered: false,
      steps,
      shallow: shallow0,
      boundaries: boundaries0,
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

/**
 * A window edge as the ONE instant every reader of it uses — the coverage
 * proof, git, and the receipt (the fourth trap in the header).
 *
 * `Date.parse` decides the instant, because the proof already reads it that
 * way: a bare `2026-09-30` is that day's 00:00:00Z. It comes back as a COMPLETE
 * UTC instant, the one spelling git parses exactly instead of approxidating
 * against the current time of day. A complete instant comes back as the same
 * instant — byte-identical when already in `Z` with whole seconds; an offset
 * is restated in `Z`; whole seconds drop the `.000` — so the self-test's
 * complete-instant windows reach git exactly as they did before.
 *
 * @param {string} raw the edge as given on the command line
 * @returns {string|null} the complete instant, or null when `Date.parse` cannot place `raw`
 */
export function windowInstant(raw) {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
}

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

/**
 * The READ-ONLY half of this tool, for callers that answer their own windowed
 * question and only need to know whether they are allowed to (#9902).
 *
 * It never fetches, and that is a decision rather than an omission. The three
 * seat-run adopters either read a checkout they do not own (`check-governed-
 * merges` sweeps four sibling repos; `collect-release-notes` reads the release
 * engineer's `cloud` tree) or must not move the ground under an audit
 * mid-sweep. So deepening stays an operator action with a named command — and
 * the command is computed by `chooseDeepenSince()`, so the remedy this prints
 * can only ever ADD history. The naive `--shallow-since=<the window start>` is
 * measured in this file's header SHORTENING a clone by 1380 commits at exit 0,
 * and a remedy that does that would be the defect wearing a fix's clothes.
 * Callers that want the deepen-and-re-prove path keep using
 * `ensureWindowCovered()`.
 *
 * `floor` is the horizon to print BESIDE an answer that was allowed: these
 * numbers are evidence (a compliance list, an ADR trigger metric, release
 * notes), and evidence carries its provenance whether or not it is short.
 *
 * @returns {{covered: boolean, shallow: boolean, floor: string|null, tip: string,
 *            reason: string|null, remedy: string|null}}
 */
export function historyHorizon({ cwd, ref, sinceMs, marginDays }) {
  const shallow = isShallow(cwd);
  const boundaries = boundaryTimes(cwd, ref);
  if (boundaries === null) {
    return {
      covered: false,
      shallow,
      floor: null,
      tip: 'unknown',
      reason: `ref '${ref}' does not resolve in ${cwd}`,
      remedy: `git -C ${cwd} fetch origin`,
    };
  }
  const covered = windowIsCovered({ shallow, boundaries, sinceMs });
  const floor = shallow ? describeFloor(boundaries) : null;
  const tip = refTip(cwd, ref);
  if (covered) return { covered: true, shallow, floor, tip, reason: null, remedy: null };
  const deepenSince = chooseDeepenSince({ sinceMs, boundaries, marginDays }).slice(0, 10);
  return {
    covered: false,
    shallow,
    floor,
    tip,
    reason:
      boundaries.length === 0
        ? `${cwd} is shallow and no history boundary could be read on '${ref}'`
        : `this clone is shallow and its oldest visible commit on '${ref}' is ${floor}, which sits INSIDE the window`,
    remedy: `git -C ${cwd} fetch --shallow-since=${deepenSince} origin   # or: git -C ${cwd} fetch --unshallow origin`,
  };
}

// ── touch: the provenance reading ────────────────────────────────────────────

const DEFAULT_DEEPEN_STEP = 64;
/** Deepen steps double from DEFAULT_DEEPEN_STEP up to this before `--unshallow`. */
const MAX_DEEPEN_STEP = 4096;

/**
 * The parents a commit OBJECT names, each with whether it is present locally.
 * Read from the object rather than from `rev-list --parents`, because a
 * shallow graft is applied at traversal and never rewrites the object: the
 * boundary commit still says `parent <sha>`, and `<sha>` is simply not here.
 * That is what tells a boundary (names a parent this clone lacks) from a real
 * root (names none) — the shallow flag cannot, and neither can `--max-parents=0`,
 * which lists both.
 *
 * PRESENCE IS HALF THE READING. A fetch can bring the parent object in while
 * the graft stays registered, and the walk goes on ignoring it (#18355), so
 * `isGraftBoundary()` reads the traversal side and `touchIsProvable()` requires
 * both.
 *
 * @returns {Array<{sha: string, present: boolean}>|null} null when `sha` is not readable here.
 */
export function objectParents(cwd, sha) {
  const raw = git(['cat-file', '-p', sha], { cwd, allowFail: true });
  if (raw === null) return null;
  const parents = [];
  for (const line of raw.split('\n')) {
    if (line === '') break; // the commit header ends at the first blank line
    if (line.startsWith('parent ')) parents.push(line.slice('parent '.length).trim());
  }
  return parents.map((p) => ({
    sha: p,
    present: git(['cat-file', '-e', `${p}^{commit}`], { cwd, allowFail: true }) !== null,
  }));
}

/**
 * The parents git's TRAVERSAL uses for `sha`: the list AFTER any graft is
 * applied, which is the list every walk diffs against — `log`, `diff-tree`,
 * `rev-list` alike. `<sha>^@` is the `--max-parents=0` question asked of ONE
 * commit, and it answers without walking, so it costs the same on a complete
 * clone as on a shallow one.
 *
 * @returns {string[]|null} null when `sha` does not resolve here.
 */
function traversalParents(cwd, sha) {
  const out = git(['rev-parse', `${sha}^@`], { cwd, allowFail: true });
  if (out === null) return null;
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Is `sha` GRAFTED here — does its object name a parent that git's traversal
 * does not use? True for a shallow boundary WHETHER OR NOT the parent object is
 * present, which is the whole point of reading it this way: a later fetch can
 * bring the parent into the store without moving the boundary, the graft goes
 * on being applied, and the commit keeps reading as parentless in every walk
 * while the parent sits right there (#18355). False for a real root, whose
 * traversal list is empty because its object names no parent rather than
 * because anything was cut — the one case a `--max-parents=0` reading on its
 * own cannot tell apart, and the reason this compares the two lists instead of
 * counting one.
 *
 * @param {string} cwd
 * @param {string} sha
 * @param {Array<{sha: string, present: boolean}>|null} [parents] object parents, when already read
 * @returns {boolean} false when `sha` is unreadable here — that is refused on its own leg in
 *                    `touchIsProvable()`, never reported as a graft.
 */
export function isGraftBoundary(cwd, sha, parents = objectParents(cwd, sha)) {
  if (parents === null) return false;
  const traversal = traversalParents(cwd, sha);
  if (traversal === null) return false;
  const named = parents.map((p) => p.sha).sort().join(' ');
  const used = [...traversal].sort().join(' ');
  return named !== used;
}

/**
 * Is `sha` a PROVABLE answer to "the last commit on the ref that touched
 * `path`"? Two legs, both required, both pure reads:
 *
 *   1. the commit is not grafted — every parent its object names is present
 *      locally AND git's traversal still uses them. A graft boundary fails the
 *      first half while its parent is missing and the SECOND half ever after,
 *      because a fetch that brings the parent in does not move the boundary
 *      (#18355); either way git diffs the commit against the empty tree, so
 *      every path in its tree reads as touched there;
 *   2. the diff against those parents (against the empty tree for a real
 *      root) touches `path` — the `git show --stat <sha> -- <path>` leg in its
 *      machine form, which is only meaningful once leg 1 holds.
 *
 * @returns {{provable: boolean, boundary: boolean, parents: Array<{sha: string, present: boolean}>|null,
 *            touched: string[], reason: string|null}}
 */
export function touchIsProvable({ cwd, sha, path }) {
  const parents = objectParents(cwd, sha);
  if (parents === null) {
    return { provable: false, boundary: false, parents, touched: [], reason: `commit ${sha} is not readable in this checkout` };
  }
  const missing = parents.filter((p) => !p.present);
  if (missing.length > 0) {
    return {
      provable: false,
      boundary: true,
      parents,
      touched: [],
      reason:
        `${sha.slice(0, 9)} is a shallow graft boundary — its object names parent ${missing[0].sha.slice(0, 9)}, ` +
        'which this clone does not have, so git diffed it against the EMPTY tree and every path in its tree ' +
        `reads as touched there; nothing says whether ${path} was really changed by it`,
    };
  }
  if (isGraftBoundary(cwd, sha, parents)) {
    return {
      provable: false,
      boundary: true,
      parents,
      touched: [],
      reason:
        `${sha.slice(0, 9)} is a graft boundary whose registration OUTLIVED the fetch that brought its ` +
        `parent(s) ${parents.map((p) => p.sha.slice(0, 9)).join(' ')} in — they are present locally, and git's ` +
        `traversal still treats ${sha.slice(0, 9)} as parentless, so it diffed the commit against the EMPTY tree ` +
        `and an empty diff here says nothing about whether ${path} was changed by it`,
    };
  }
  const rootArgs = parents.length === 0 ? ['--root'] : [];
  const out = git(['diff-tree', '-r', '-m', '--no-commit-id', '--name-only', ...rootArgs, sha, '--', path], { cwd, allowFail: true });
  const touched = (out || '').split('\n').filter(Boolean);
  if (touched.length === 0) {
    return {
      provable: false,
      boundary: false,
      parents,
      touched,
      reason: `${sha.slice(0, 9)} has its parent(s) locally but its diff does not touch ${path}`,
    };
  }
  return { provable: true, boundary: false, parents, touched, reason: null };
}

/**
 * `git log -1 <ref> -- <path>`, raw. null when the ref does not resolve; the
 * empty string when no commit visible on the ref touches the path — which on
 * a shallow clone means nothing yet.
 */
export function lastTouch(cwd, ref, path) {
  const out = git(['log', '-1', '--format=%H', ref, '--', path], { cwd, allowFail: true });
  return out === null ? null : out.trim();
}

/**
 * Take the provenance reading, deepening only as far as proving it needs.
 * Deepens with `--deepen=N` (counted from the current boundary, so it can only
 * ADD history — the `--shallow-since` hazard in the header does not arise),
 * N doubling from `deepenStep`, then `--unshallow`. Fetching also refreshes
 * the remote-tracking ref, so a deepened answer is read at the fetched tip.
 *
 * @returns {{answered: boolean, sha: string|null, verdict: object, steps: string[], reason: string|null}}
 */
export function ensureTouchProvable({
  cwd, ref, path, allowFetch = true, allowUnshallow = true, deepenStep = DEFAULT_DEEPEN_STEP,
}) {
  const steps = [];
  const attempt = () => {
    const sha = lastTouch(cwd, ref, path);
    if (sha === null) {
      return { sha, verdict: { provable: false, boundary: false, reason: `ref '${ref}' does not resolve in this checkout` } };
    }
    if (sha === '') {
      const shallow = isShallow(cwd);
      // A complete clone with no touch is an answer about the path (there is
      // none); a shallow one may simply be hiding it below the floor.
      return {
        sha,
        verdict: {
          provable: !shallow,
          boundary: shallow,
          reason: shallow
            ? `no commit visible on '${ref}' touches ${path}, and the clone is shallow — the touch may sit below the floor`
            : `no commit on '${ref}' touches ${path}`,
        },
      };
    }
    return { sha, verdict: touchIsProvable({ cwd, sha, path }) };
  };

  let r = attempt();
  if (r.verdict.provable) {
    steps.push(isShallow(cwd) ? 'proved without fetching (the touch and its parent sit above the shallow floor)' : 'complete clone (no fetch)');
    return { answered: true, sha: r.sha, verdict: r.verdict, steps, reason: null };
  }
  if (r.sha === null) return { answered: false, sha: null, verdict: r.verdict, steps, reason: r.verdict.reason };
  if (!allowFetch) {
    return { answered: false, sha: r.sha, verdict: r.verdict, steps, reason: `${r.verdict.reason}; --no-fetch was given` };
  }
  const remotes = (git(['remote'], { cwd, allowFail: true }) || '').split('\n').filter(Boolean);
  const target = splitRemoteRef(ref, remotes);
  if (!target) {
    return {
      answered: false,
      sha: r.sha,
      verdict: r.verdict,
      steps,
      reason:
        `${r.verdict.reason}; '${ref}' names no remote to deepen from ` +
        `(remotes here: ${remotes.length ? remotes.join(', ') : 'none'})`,
    };
  }
  for (let n = deepenStep; n <= MAX_DEEPEN_STEP && isShallow(cwd); n *= 2) {
    const fetched = git(['fetch', `--deepen=${n}`, target.remote, target.branch], { cwd, allowFail: true });
    steps.push(`fetch --deepen=${n} ${target.remote} ${target.branch}${fetched === null ? ' (failed)' : ''}`);
    if (fetched === null) break;
    r = attempt();
    if (r.verdict.provable) return { answered: true, sha: r.sha, verdict: r.verdict, steps, reason: null };
  }
  if (allowUnshallow && isShallow(cwd)) {
    const un = git(['fetch', '--unshallow', target.remote], { cwd, allowFail: true });
    steps.push(`fetch --unshallow ${target.remote}${un === null ? ' (failed)' : ''}`);
    r = attempt();
    if (r.verdict.provable) return { answered: true, sha: r.sha, verdict: r.verdict, steps, reason: null };
  }
  return { answered: false, sha: r.sha, verdict: r.verdict, steps, reason: r.verdict.reason };
}

// ── ancestor: the containment reading ────────────────────────────────────────

/**
 * `ancestor`'s exit code for a PROVEN no. Its own number: 1 is this tool's
 * usage exit, and a mistyped flag must never be readable as "not an ancestor"
 * (the sixth trap in the header).
 */
export const EXIT_NOT_ANCESTOR = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The full sha `rev` names as a COMMIT here, or null when it resolves to none. */
function commitShaOf(cwd, rev) {
  if (typeof rev !== 'string' || rev === '' || rev.startsWith('-')) return null;
  const out = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd, allowFail: true });
  const sha = (out || '').trim();
  return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

/** Committer date of `sha` in ms, or null when it cannot be read. */
function commitDateMs(cwd, sha) {
  const out = git(['log', '-1', '--format=%cI', sha], { cwd, allowFail: true });
  const ms = out === null ? NaN : Date.parse(out.trim());
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `git merge-base --is-ancestor <commit> <ref>`, raw: the exit status as git
 * gave it, never thrown. 0 is an ancestor, 1 is not one AS FAR AS THIS CLONE
 * CAN SEE, and anything else (128 for an object that is not here) is no
 * reading at all.
 *
 * @returns {{status: number|null, stderr: string}}
 */
export function rawIsAncestor(cwd, commit, ref) {
  const r = spawnSync('git', ['merge-base', '--is-ancestor', commit, ref], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status, stderr: String(r.stderr || '').trim() };
}

/**
 * Every commit under `ref` where the walk is CUT: the parentless commits
 * reachable from it that are grafted rather than real roots, each with its
 * committer date. Empty means the history under `ref` is complete here,
 * whatever the repository's shallow flag says about some other ref.
 *
 * @returns {Array<{sha: string, ms: number|null}>|null} null when `ref` does not resolve.
 */
export function graftBoundaries(cwd, ref) {
  const out = git(['rev-list', '--max-parents=0', '--format=%cI', ref], { cwd, allowFail: true });
  if (out === null) return null;
  const found = [];
  let sha = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('commit ')) { sha = line.slice('commit '.length).trim(); continue; }
    if (line === '' || sha === null) continue;
    const ms = Date.parse(line.trim());
    if (isGraftBoundary(cwd, sha)) found.push({ sha, ms: Number.isFinite(ms) ? ms : null });
    sha = null;
  }
  return found;
}

/**
 * Does a NEGATIVE stand — can no cut under the ref be hiding the tested
 * commit? Pure, so the self-test pins every arm with injected numbers.
 *
 *   - no boundary at all: the history under the ref is complete, and a walk of
 *     a complete history that missed the commit missed nothing (`by: complete`);
 *   - otherwise the NEWEST boundary decides, as it does for a window: a real
 *     ancestor the walk missed sits below some boundary, a boundary is its
 *     descendant, and a descendant does not predate its ancestor. So when even
 *     the newest boundary is older than the tested commit by the skew margin,
 *     none can hide it (`by: floor`), and that boundary is the control leg:
 *     in the ref's history by construction, and deeper than the tested commit;
 *   - a tested commit with no date here (its object is absent) can be placed
 *     against nothing, and a boundary with no readable date decides nothing.
 *
 * @param {{boundaries: Array<{sha: string, ms: number|null}>, testedMs: number|null, marginDays?: number}} input
 * @returns {{proven: boolean, by: 'complete'|'floor'|null,
 *            control: {sha: string, ms: number|null}|null,
 *            why: 'tested-absent'|'boundary-undated'|'floor-intrudes'|null}}
 */
export function negativeIsProven({ boundaries, testedMs, marginDays = DEFAULT_MARGIN_DAYS }) {
  if (boundaries.length === 0) return { proven: true, by: 'complete', control: null, why: null };
  const undated = boundaries.find((b) => b.ms === null);
  if (undated) return { proven: false, by: null, control: undated, why: 'boundary-undated' };
  const newest = boundaries.reduce((a, b) => (b.ms > a.ms ? b : a));
  if (testedMs === null) return { proven: false, by: null, control: newest, why: 'tested-absent' };
  if (newest.ms < testedMs - marginDays * DAY_MS) return { proven: true, by: 'floor', control: newest, why: null };
  return { proven: false, by: null, control: newest, why: 'floor-intrudes' };
}

const isoDay = (ms) => (ms === null ? 'undated' : new Date(ms).toISOString().slice(0, 10));
const short9 = (sha) => String(sha).slice(0, 9);

/**
 * One reading of "is `commit` in `ref`'s history", fetching nothing. Both
 * legs, with the exit code each one gave, travel in the result so the receipt
 * can print them.
 *
 * @returns {{state: 'yes'|'no'|'unproven'|'unreadable', deepenCanHelp?: boolean, refSha: string|null, tested: string|null,
 *            testedStatus: number|null, testedMs: number|null, by: 'complete'|'floor'|null,
 *            boundaries: Array<{sha: string, ms: number|null}>, control: {sha: string, ms: number|null}|null,
 *            operator: {sha: string|null, status: number|null, ms: number|null, ok: boolean}|null,
 *            reason: string|null}}
 */
export function ancestorReading({ cwd, commit, ref, control, marginDays = DEFAULT_MARGIN_DAYS }) {
  const base = {
    refSha: null, tested: null, testedStatus: null, testedMs: null, by: null, boundaries: [], control: null, operator: null,
  };
  const refSha = commitShaOf(cwd, ref);
  if (refSha === null) {
    return { ...base, state: 'unreadable', reason: `ref '${ref}' does not resolve to a commit in this checkout` };
  }
  const tested = commitShaOf(cwd, commit);
  let testedStatus = null;
  let testedMs = null;
  if (tested !== null) {
    const raw = rawIsAncestor(cwd, tested, refSha);
    testedStatus = raw.status;
    if (raw.status === 0) {
      return { ...base, state: 'yes', refSha, tested, testedStatus, reason: null };
    }
    if (raw.status !== 1) {
      return {
        ...base, state: 'unreadable', refSha, tested, testedStatus,
        reason: `git merge-base --is-ancestor exited ${raw.status}, which is neither answer${raw.stderr ? ` (${raw.stderr})` : ''}`,
      };
    }
    testedMs = commitDateMs(cwd, tested);
  }
  const boundaries = graftBoundaries(cwd, refSha) ?? [];
  const neg = negativeIsProven({ boundaries, testedMs, marginDays });
  const reading = { ...base, refSha, tested, testedStatus, testedMs, boundaries, control: neg.control };

  // The operator's own control leg, when one was named. It can only ADD a
  // requirement: it never stands in for the floor, because a commit the
  // operator knows to be in the history says nothing about a second cut on
  // another line of it.
  let operator = null;
  if (control !== undefined) {
    const sha = commitShaOf(cwd, control);
    const status = sha === null ? null : rawIsAncestor(cwd, sha, refSha).status;
    const ms = sha === null ? null : commitDateMs(cwd, sha);
    let problem = null;
    if (sha === null) problem = `the control ${control} is not a commit in this clone`;
    else if (status !== 0) {
      problem =
        `the control leg answered exit ${status}: ${short9(sha)} is not in '${ref}' as this clone sees it, so the ` +
        "negative is void (a control is a commit KNOWN to be in the ref's history)";
    } else if (testedMs !== null && ms !== null && ms > testedMs) {
      problem =
        `the control ${short9(sha)} (${isoDay(ms)}) is NEWER than the tested commit (${isoDay(testedMs)}) — a near ` +
        'relative inside the shallow window answers 0 on every clone and proves nothing about a deeper commit';
    }
    operator = { sha, status, ms, ok: problem === null };
    // A control that is too SHALLOW is the operator's choice of commit, and no
    // deepen changes which commit was named; one that is absent or answers 1
    // is what a deepen exists to turn.
    const nearRelative = sha !== null && status === 0 && problem !== null;
    if (problem !== null) return { ...reading, state: 'unproven', deepenCanHelp: !nearRelative, operator, reason: problem };
  }

  if (neg.proven) return { ...reading, state: 'no', by: neg.by, operator, reason: null };

  const cut = `this clone's history of '${ref}' is cut at ${boundaries.length} graft boundar${boundaries.length === 1 ? 'y' : 'ies'}`;
  let reason;
  if (neg.why === 'tested-absent') {
    reason =
      `${commit} is not an object in this clone, and ${cut} (newest ${short9(neg.control.sha)}, ${isoDay(neg.control.ms)}) — ` +
      'it may sit below one of them, or nowhere in this history at all, and nothing here tells those apart';
  } else if (neg.why === 'boundary-undated') {
    reason = `${cut} and ${short9(neg.control.sha)} carries no readable commit date, so the cut cannot be placed against the tested commit`;
  } else {
    reason =
      `raw git says exit 1, and ${cut} whose newest, ${short9(neg.control.sha)} (${isoDay(neg.control.ms)}), is not ` +
      `${marginDays} day(s) older than the tested commit ${short9(tested)} (${isoDay(testedMs)}) — the commit can sit ` +
      'BELOW that cut, where a real ancestor reads exactly like this';
  }
  return { ...reading, state: 'unproven', deepenCanHelp: true, operator, reason };
}

/**
 * Take the containment reading, deepening only as far as proving a negative
 * needs. A yes never fetches. The ladder is `touch`'s: `--deepen=N` (counted
 * from the current boundary, so it can only ADD history), N doubling from
 * `deepenStep`, then `--unshallow`. Fetching also moves the remote-tracking
 * ref, so a deepened answer is read at the fetched tip and the receipt names
 * the sha it was read against.
 *
 * @returns {ReturnType<typeof ancestorReading> & {steps: string[]}}
 */
export function ensureAncestorProvable({
  cwd, commit, ref, control, allowFetch = true, allowUnshallow = true, deepenStep = DEFAULT_DEEPEN_STEP, marginDays,
}) {
  const steps = [];
  const attempt = () => ancestorReading({ cwd, commit, ref, control, marginDays });
  const settled = (r) => r.state === 'yes' || r.state === 'no';

  let r = attempt();
  if (settled(r)) {
    steps.push(isShallow(cwd) ? 'read without fetching' : 'complete clone (no fetch)');
    return { ...r, steps };
  }
  // Unreadable is about the question (a ref that names nothing here), and a
  // clone with no cut under the ref has nothing a deepen could add.
  if (r.state === 'unreadable' || r.boundaries.length === 0 || r.deepenCanHelp === false) return { ...r, steps };
  if (!allowFetch) return { ...r, steps, reason: `${r.reason}; --no-fetch was given` };

  const remotes = (git(['remote'], { cwd, allowFail: true }) || '').split('\n').filter(Boolean);
  const target = splitRemoteRef(ref, remotes);
  if (!target) {
    return {
      ...r,
      steps,
      reason:
        `${r.reason}; '${ref}' names no remote to deepen from ` +
        `(remotes here: ${remotes.length ? remotes.join(', ') : 'none'})`,
    };
  }
  for (let n = deepenStep; n <= MAX_DEEPEN_STEP && isShallow(cwd); n *= 2) {
    const fetched = git(['fetch', `--deepen=${n}`, target.remote, target.branch], { cwd, allowFail: true });
    steps.push(`fetch --deepen=${n} ${target.remote} ${target.branch}${fetched === null ? ' (failed)' : ''}`);
    if (fetched === null) break;
    r = attempt();
    if (settled(r)) return { ...r, steps };
  }
  if (allowUnshallow && isShallow(cwd)) {
    const un = git(['fetch', '--unshallow', target.remote], { cwd, allowFail: true });
    steps.push(`fetch --unshallow ${target.remote}${un === null ? ' (failed)' : ''}`);
    r = attempt();
    if (settled(r)) return { ...r, steps };
  }
  return { ...r, steps };
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
      '  node scripts/pm/git-history.mjs touch  --path=<file> [--ref=<ref>] [--format=%H] [--deepen=<n>]\n' +
      '                                         [--no-fetch] [--no-unshallow]\n' +
      '  node scripts/pm/git-history.mjs ancestor --commit=<sha> [--ref=<ref>] [--control=<sha>] [--margin-days=<n>]\n' +
      '                                         [--deepen=<n>] [--no-fetch] [--no-unshallow]\n' +
      '  node scripts/pm/git-history.mjs --self-test\n\n' +
      'exit 0 answered · 2 refused (window, touch or negative not provably complete) · 1 usage/environment\n' +
      'ancestor: exit 0 = yes · 3 = no, PROVEN (its control leg is in the receipt) · 2 refused · 1 usage\n',
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
      case '--commit': opts.commit = v; break;
      case '--control': opts.control = v; break;
      case '--format': opts.format = v; opts.formatGiven = true; break;
      case '--deepen': opts.deepen = Number(v); break;
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
  const instant = windowInstant(opts.since);
  // Refuse what cannot be compared to a boundary rather than guessing: git
  // accepts "30 days ago", but a window this tool cannot place on a timeline is
  // a window whose coverage it cannot prove.
  if (instant === null) usage(`--since=${opts.since} is not a date this tool can place (use YYYY-MM-DD, or --days=<n>)`);
  // What is returned is the instant the proof reads, never the raw string: git
  // reads a bare YYYY-MM-DD at the current time of day (the fourth trap).
  return instant;
}

/**
 * `--until`, normalised the way `--since` is: a bare `2026-10-01` reaches git
 * as `2026-10-01T00:00:00Z` — "before that day began" at every hour, where the
 * raw string meant "before now's time of day on it". No coverage proof reads
 * `--until`, so a spelling `Date.parse` cannot place still reaches git exactly
 * as given, the way it always has, and the receipt prints it as given: the
 * ruling was to normalise the recommended input, not to add a refusal.
 */
function resolveUntil(opts) {
  if (opts.until === undefined) return undefined;
  const instant = windowInstant(opts.until);
  return instant === null ? opts.until : instant;
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ git-history self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      return 1;
    }
    return selfTestCode;
  }
  const { cmd, opts } = parseArgs(argv);
  if (cmd === null) usage('a command is required');
  if (!['count', 'log', 'ensure', 'touch', 'ancestor'].includes(cmd)) usage(`unknown command '${cmd}'`);
  if (cmd !== 'ancestor' && (opts.commit !== undefined || opts.control !== undefined)) {
    usage(`--commit and --control belong to 'ancestor', not '${cmd}'`);
  }
  if (cmd === 'touch') return touchMain(opts);
  if (cmd === 'ancestor') return ancestorMain(opts);

  const since = resolveSince(opts);
  const until = resolveUntil(opts);
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
        `   ref: ${opts.ref}   window: since ${since}` +
        `${until ? ` until ${until}` : ''}\n` +
        `   shallow floor: ${describeFloor(ensured.boundaries)} (the oldest commit this clone can see on that ref)\n` +
        `${ensured.steps.length ? `   tried: ${ensured.steps.join(' · ')}\n` : ''}` +
        `   Any number derived here would be real, plausible and WRONG — the missing\n` +
        `   commits are invisible to git log, which reports no error (#9878).\n` +
        `   Remedy: git -C ${cwd} fetch --unshallow ${splitRemoteRef(opts.ref, ['origin']) ? 'origin' : '<remote>'}\n`,
    );
    return 2;
  }

  const receipt =
    `method: ${cmd === 'log' ? 'git log' : 'git rev-list --count'}` +
    `${opts.firstParent ? ' --first-parent' : ''} ${opts.ref} since ${since}` +
    `${until ? ` until ${until}` : ''}` +
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
      ? git(['rev-list', '--count', ...fp, ...windowArgs({ since, until }), opts.ref, ...pathArgs], { cwd })
      : git(['log', ...fp, `--format=${opts.format}`, ...windowArgs({ since, until }), opts.ref, ...pathArgs], { cwd });

  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  process.stderr.write(`${receipt}\n`);
  return 0;
}

/**
 * `touch`: print the proven last-touch sha of `--path` on `--ref`, or refuse.
 * Same contract as the windowed commands — the answer alone on stdout, a
 * one-line method receipt on stderr, exit 2 with EMPTY stdout on refusal.
 */
function touchMain(opts) {
  if (opts.since !== undefined || opts.days !== undefined) usage('touch takes no window — drop --since/--days');
  if (opts.paths.length !== 1) usage('touch needs exactly one --path=<file>');
  if (opts.deepen !== undefined && (!Number.isInteger(opts.deepen) || opts.deepen <= 0)) usage('--deepen must be a positive integer');
  const path = opts.paths[0];
  const cwd = opts.cwd || process.cwd();
  const format = opts.formatGiven ? opts.format : '%H';

  const r = ensureTouchProvable({
    cwd,
    ref: opts.ref,
    path,
    allowFetch: opts.fetch,
    allowUnshallow: opts.unshallow,
    deepenStep: opts.deepen,
  });

  if (r.answered && r.sha === '') {
    // Provably nothing: a complete clone in which no commit on the ref touches
    // the path. That is about the question, not the history — usage.
    process.stderr.write(`git-history touch: ${r.verdict.reason} (ref: ${opts.ref}; ${r.steps.join(' · ')}).\n`);
    return 1;
  }
  if (!r.answered) {
    const remote = splitRemoteRef(opts.ref, ['origin']) ? 'origin' : '<remote>';
    process.stderr.write(
      `⛔ git-history REFUSES to name a last-touch sha — ${r.reason}.\n` +
        `   ref: ${opts.ref}   path: ${path}` +
        `${r.sha ? `   raw git log -1 said: ${r.sha.slice(0, 9)} (NOT a reading of the path)` : ''}\n` +
        `${r.steps.length ? `   tried: ${r.steps.join(' · ')}\n` : ''}` +
        '   The sha raw git prints here is real, plausible and WRONG — a shallow graft boundary is diffed\n' +
        '   against the empty tree, so every path in its tree reads as touched there, at exit 0 (#9878).\n' +
        `   Remedy: git -C ${cwd} fetch --deepen=${opts.deepen ?? DEFAULT_DEEPEN_STEP} ${remote} ${opts.ref.replace(/^[^/]+\//, '')}` +
        `   # or: git -C ${cwd} fetch --unshallow ${remote}\n`,
    );
    return 2;
  }

  const answer = git(['log', '-1', `--format=${format}`, r.sha], { cwd }).trim();
  const when = git(['log', '-1', '--format=%cI', r.sha], { cwd }).trim();
  const stat = (git(['show', '--stat', '--format=', r.sha, '--', path], { cwd, allowFail: true }) || '')
    .split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  const parentsNote = r.verdict.parents.length === 0
    ? 'a real root (its object names no parent)'
    : `${r.verdict.parents.length} parent(s) present locally`;
  const receipt =
    `method: git log -1 ${opts.ref} -- ${path} · touch ${r.sha.slice(0, 9)} ${when}` +
    ` · proof: ${parentsNote}, diff-tree touches ${r.verdict.touched.join(' ')}${stat ? ` (${stat})` : ''}` +
    ` · tip ${refTip(cwd, opts.ref)} · ${r.steps.join(' · ')}`;
  process.stdout.write(`${answer}\n`);
  process.stderr.write(`${receipt}\n`);
  return 0;
}

/**
 * `ancestor`: is `--commit` in `--ref`'s history? Prints `yes` or `no` alone
 * on stdout and the two legs with their exit codes on stderr. Exit 0 for a
 * yes, {@link EXIT_NOT_ANCESTOR} for a PROVEN no, 2 with EMPTY stdout when the
 * negative cannot be told from a shallow cut.
 */
function ancestorMain(opts) {
  if (opts.since !== undefined || opts.days !== undefined || opts.until !== undefined) {
    usage('ancestor takes no window — drop --since/--days/--until');
  }
  if (opts.paths.length > 0 || opts.formatGiven) usage('ancestor takes no --path and no --format');
  if (opts.commit === undefined || opts.commit === '') usage('ancestor needs --commit=<sha>');
  if (opts.control === '') usage('--control needs a value');
  if (opts.deepen !== undefined && (!Number.isInteger(opts.deepen) || opts.deepen <= 0)) usage('--deepen must be a positive integer');
  if (opts.marginDays !== undefined && (!Number.isFinite(opts.marginDays) || opts.marginDays < 0)) usage('--margin-days must be zero or more');
  const cwd = opts.cwd || process.cwd();
  // A sha this clone does not have is a legitimate question (it may sit below
  // the floor). A NAME that resolves to nothing is a typo, and must not ride
  // the same path to a "no".
  if (commitShaOf(cwd, opts.commit) === null && !/^[0-9a-f]{7,64}$/.test(opts.commit)) {
    usage(`--commit=${opts.commit} names no commit here (give a sha, or a ref this checkout has)`);
  }
  const marginDays = opts.marginDays ?? DEFAULT_MARGIN_DAYS;

  const r = ensureAncestorProvable({
    cwd,
    commit: opts.commit,
    ref: opts.ref,
    control: opts.control,
    allowFetch: opts.fetch,
    allowUnshallow: opts.unshallow,
    deepenStep: opts.deepen,
    marginDays,
  });

  const testedLeg = r.tested === null
    ? `tested leg: ${opts.commit} is not an object in this clone`
    : `tested leg ${short9(r.tested)} exit ${r.testedStatus}`;

  if (r.state !== 'yes' && r.state !== 'no') {
    const remote = splitRemoteRef(opts.ref, ['origin']) ? 'origin' : '<remote>';
    // Three refusals, three remedies: a ref that names nothing is fetched, a
    // control that is too shallow is re-chosen, and only a cut is deepened.
    let remedy;
    if (r.state === 'unreadable') {
      remedy = `   Remedy: name a ref this checkout has (git -C ${cwd} fetch ${remote}), then ask again.\n`;
    } else if (r.deepenCanHelp === false) {
      remedy =
        '   Remedy: name a control at least as old as the tested commit, or drop --control and let the\n' +
        '   floor be the control leg.\n';
    } else if (r.boundaries.length === 0) {
      remedy =
        "   Remedy: this clone's history of the ref is complete, so no fetch turns that leg — the control,\n" +
        '   or the ref, is not the commit you take it for. Re-read both.\n';
    } else {
      remedy =
        '   A shallow clone withholds ancestor paths and never adds one: exit 0 proves itself, and exit 1\n' +
        '   is what a cut produces for a commit that sits below it. No answer was printed.\n' +
        `   Remedy: git -C ${cwd} fetch --deepen=${opts.deepen ?? DEFAULT_DEEPEN_STEP} ${remote} ${opts.ref.replace(/^[^/]+\//, '')}` +
        `   # or: git -C ${cwd} fetch --unshallow ${remote}\n`;
    }
    process.stderr.write(
      `⛔ git-history REFUSES to say "not an ancestor" — ${r.reason}.\n` +
        `   ref: ${opts.ref}${r.refSha ? ` (${short9(r.refSha)})` : ''}   commit: ${opts.commit}\n` +
        `${r.refSha
          ? `   ${testedLeg}${r.operator ? ` · operator control ${opts.control} exit ${r.operator.status ?? 'unreadable'}` : ''}\n`
          : ''}` +
        `${r.steps.length ? `   tried: ${r.steps.join(' · ')}\n` : ''}` +
        remedy,
    );
    return 2;
  }

  const head = `method: git merge-base --is-ancestor ${short9(r.tested ?? opts.commit)} ${opts.ref}@${short9(r.refSha)}`;
  const tail = ` · tip ${refTip(cwd, opts.ref)} · ${r.steps.join(' · ')}`;
  if (r.state === 'yes') {
    process.stdout.write('yes\n');
    process.stderr.write(
      `${head} · ${testedLeg} — an ancestor path present here is present in the full history ` +
        `(a shallow clone withholds paths, it never adds one), so no control leg is owed${tail}\n`,
    );
    return 0;
  }

  const controlLeg = r.by === 'complete'
    ? "control leg: none is owed — every root under the ref is a real root, so this clone's history of it is " +
      'complete and the walk that missed the commit missed nothing'
    : `control leg ${short9(r.control.sha)} exit 0 — the newest of ${r.boundaries.length} graft boundar` +
      `${r.boundaries.length === 1 ? 'y' : 'ies'} under the ref (${isoDay(r.control.ms)}), in its history by ` +
      `construction and at least ${marginDays} day(s) older than the tested commit (${isoDay(r.testedMs)}): ` +
      'no cut sits where that commit could hide';
  const operatorLeg = r.operator
    ? ` · operator control ${short9(r.operator.sha)} exit ${r.operator.status} (${isoDay(r.operator.ms)}, not newer than the tested commit)`
    : '';
  process.stdout.write('no\n');
  process.stderr.write(`${head} · ${testedLeg} · ${controlLeg}${operatorLeg}${tail}\n`);
  return EXIT_NOT_ANCESTOR;
}

// ── self-test ────────────────────────────────────────────────────────────────

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  let failures = 0;
  const t = (name, ok, detail = '') => {
    registerCase();
    if (ok) { process.stdout.write(`  ✓ ${name}\n`); return; }
    failures += 1;
    process.stdout.write(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}\n`);
  };

  // ── pure decisions ────────────────────────────────────────────────────────
  battery('pure decisions');
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
  // Every window edge below is a COMPLETE UTC instant, never a bare
  // `YYYY-MM-DD`. `git rev-list --since=2026-06-20` is an *approxidate*: git
  // fills the missing time of day from the CURRENT WALL CLOCK, not from
  // midnight. With this fixture stamped 12:00:00Z, that edge swept across c19
  // once a day — 21 commits before 12:00 UTC, 20 after — so this self-test was
  // green every morning and red every afternoon (measured 2026-08-21: three
  // off-by-one failures, ~10 h red on `main`, `Lint & Repo Gates` failing for
  // every PR and the merge queue evicting them on rebuild). A complete instant
  // is parsed exactly and never consults `now`; putting each edge at 00:00:00Z
  // additionally leaves 12 h — half the fixture's daily cadence, the widest gap
  // available — between it and the nearest commit stamp. `collect-release-notes.sh
  // --self-test`, which runs over an identical fixture in the same `lint.yml`
  // step, has always spelled its window this way. The CLI now normalises a bare
  // date itself (`windowInstant()`), but the BASELINE below hands these edges to
  // raw git, which still approxidates; the 'bare dates' battery pins the
  // normalisation at two injected clocks.
  battery('real repos');
  const FIXTURE_EPOCH = '2026-06-01T12:00:00Z';
  const FIXTURE_COMMITS = 40;
  const WINDOW_SINCE = '2026-06-20T00:00:00Z';
  const WINDOW_UNTIL = '2026-07-11T00:00:00Z';
  const NARROW_SINCE = '2026-07-08T00:00:00Z';

  // Both halves of that property, recomputed from the constants rather than
  // asserted about them, so moving a window or re-cadencing the fixture re-runs
  // the check instead of dating it. A bare date fails the shape test; a stamp
  // or edge nudged toward its neighbour fails the gap test.
  const stampsMs = Array.from({ length: FIXTURE_COMMITS }, (_, i) => Date.parse(FIXTURE_EPOCH) + i * day);
  const edges = [WINDOW_SINCE, WINDOW_UNTIL, NARROW_SINCE];
  const edgesAreCompleteInstants = edges.every((e) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(e));
  const closestEdgeMs = Math.min(
    ...edges.map((e) => Math.min(...stampsMs.map((stamp) => Math.abs(Date.parse(e) - stamp)))),
  );
  t('every window edge is a COMPLETE instant and clears every fixture stamp by hours — a bare '
    + 'YYYY-MM-DD is approxidated to the CURRENT time of day, which is what made this self-test '
    + 'pass before 12:00 UTC and fail after it',
    edgesAreCompleteInstants && closestEdgeMs >= 6 * 60 * 60 * 1000,
    `complete=${edgesAreCompleteInstants} closest edge-to-stamp gap ${closestEdgeMs / (60 * 60 * 1000)}h`);

  const root = mkdtempSync(join(tmpdir(), 'git-history-selftest-'));
  const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const up = join(root, 'up');
    mkdirSync(up, { recursive: true });
    g(['init', '--quiet', '--initial-branch=main', '.'], up);
    g(['config', 'user.email', 'selftest@objectstack.ai'], up);
    g(['config', 'user.name', 'selftest'], up);
    // 40 commits, one per day, oldest first: 2026-06-01 .. 2026-07-10. `f.txt`
    // moves in every commit; `charter.md` only in c0..c2 (its last touch, c2,
    // sits below every shallow floor the touch battery cuts); `root.txt` only
    // in c0 (a real root, which names no parent and must still be provable).
    for (let i = 0; i < FIXTURE_COMMITS; i += 1) {
      const d = new Date(Date.parse(FIXTURE_EPOCH) + i * day).toISOString();
      writeFileSync(join(up, 'f.txt'), `commit ${i}\n`);
      g(['add', 'f.txt'], up);
      if (i <= 2) { writeFileSync(join(up, 'charter.md'), `charter ${i}\n`); g(['add', 'charter.md'], up); }
      if (i === 0) { writeFileSync(join(up, 'root.txt'), 'root\n'); g(['add', 'root.txt'], up); }
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

    const fullAnswer = runCliAllowFail(['count', `--since=${WINDOW_SINCE}`, `--until=${WINDOW_UNTIL}`], full);
    t('a complete clone answers, exit 0', fullAnswer.code === 0, JSON.stringify(fullAnswer));
    t('and the answer is the real one (21 commits: the daily fixture commits i=19..39)',
      fullAnswer.stdout.trim() === '21', `got ${JSON.stringify(fullAnswer.stdout)}`);

    // The card's shape: a shallow clone that answers plausibly and WRONGLY.
    const shallow = join(root, 'shallow');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, shallow], root);
    t('the shallow fixture really is shallow', isShallow(shallow) === true);
    const raw = g(['rev-list', '--count', '--first-parent', `--since=${WINDOW_SINCE}`, `--until=${WINDOW_UNTIL}`, 'origin/main'], shallow).trim();
    t('BASELINE — raw git answers the same question with a wrong number and no warning '
      + '(this is the defect, reproduced)', raw === '5' && raw !== '20', `raw git said ${raw}`);

    const refused = runCliAllowFail(['count', `--since=${WINDOW_SINCE}`, `--until=${WINDOW_UNTIL}`, '--no-fetch'], shallow);
    t('the helper REFUSES that same question rather than answering it', refused.code === 2, `exit ${refused.code}`);
    t('and stdout stays EMPTY, so a captured number is empty rather than plausible '
      + '(zero is a broken scan, not a clean repo — #4690)', refused.stdout.trim() === '',
      `stdout ${JSON.stringify(refused.stdout)}`);
    t('and the refusal names the floor and a remedy',
      /shallow floor: 2026-0/.test(refused.stderr || '') && /unshallow/.test(refused.stderr || ''),
      refused.stderr);

    // Deepening from a real (local) remote makes the same question answerable.
    const deepened = runCliAllowFail(['count', `--since=${WINDOW_SINCE}`, `--until=${WINDOW_UNTIL}`], shallow);
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
    const narrow = runCliAllowFail(['count', `--since=${NARROW_SINCE}`, `--until=${WINDOW_UNTIL}`, '--no-fetch'], shallowDeep);
    t('a still-shallow clone whose floor predates the window answers WITHOUT fetching '
      + '(a bare is-shallow guard would have refused this correct answer)',
      narrow.code === 0 && narrow.stdout.trim() === '3', JSON.stringify(narrow));
    t('and it says it did not need to fetch', /no fetch/.test(narrow.stderr || ''), narrow.stderr);
    t('the clone is still shallow after that answer — proving the predicate is the floor, '
      + 'not the shallow flag', isShallow(shallowDeep) === true);

    // A ref that names no remote — a bare sha, the way a tree is usually quoted —
    // cannot be deepened, so a window crossing its floor is refused. The floor
    // printed beside that refusal is the one already READ, never `unknown`.
    // Nothing is fetched on this path, so `shallowDeep` keeps its depth.
    const shallowDeepTip = g(['rev-parse', 'origin/main'], shallowDeep).trim();
    const bareShaRefusal = runCliAllowFail(['count', `--since=${WINDOW_SINCE}`, `--ref=${shallowDeepTip}`], shallowDeep);
    t('a bare-sha --ref whose window crosses the shallow floor is REFUSED, exit 2 with EMPTY stdout, '
      + 'because it names no remote to deepen from',
      bareShaRefusal.code === 2 && bareShaRefusal.stdout.trim() === ''
        && /names no remote to deepen from/.test(bareShaRefusal.stderr), JSON.stringify(bareShaRefusal));
    t('and the refusal prints the floor it READ, 2026-07-06, not `shallow floor: unknown` — the no-remote '
      + 'branch used to return without the boundaries it had already read',
      /shallow floor: 2026-07-06 /.test(bareShaRefusal.stderr) && !/shallow floor: unknown/.test(bareShaRefusal.stderr),
      bareShaRefusal.stderr);

    // ── historyHorizon: the read-only reading the #9902 adopters call ───────
  battery('historyHorizon: the read-only reading the #9902 adopters call');
    const hFull = historyHorizon({ cwd: full, ref: 'origin/main', sinceMs: Date.parse(WINDOW_SINCE) });
    t('historyHorizon clears a complete clone and reports no floor',
      hFull.covered === true && hFull.shallow === false && hFull.floor === null && hFull.remedy === null,
      JSON.stringify(hFull));
    t('and it carries the ref tip, so an allowed answer can still be printed with its horizon',
      /^\d{4}-\d{2}-\d{2}$/.test(hFull.tip), JSON.stringify(hFull));

    const hShort = historyHorizon({ cwd: shallowDeep, ref: 'origin/main', sinceMs: Date.parse(WINDOW_SINCE) });
    t('historyHorizon REFUSES the window raw git answered with 5 instead of 21',
      hShort.covered === false, JSON.stringify(hShort));
    t('and it names the floor rather than only saying "shallow"',
      hShort.floor === '2026-07-06' && /INSIDE the window/.test(hShort.reason ?? ''), JSON.stringify(hShort));
    // The measured hazard again, this time in the REMEDY: a printed
    // `--shallow-since` newer than the floor shortens the clone at exit 0.
    const remedyDate = /--shallow-since=(\d{4}-\d{2}-\d{2})/.exec(hShort.remedy ?? '')?.[1];
    t('and the deepen command it prints can only ADD history — its --shallow-since is never '
      + 'newer than the floor already present',
      remedyDate !== undefined && Date.parse(remedyDate) <= Date.parse('2026-07-06'), String(hShort.remedy));

    const hNarrow = historyHorizon({ cwd: shallowDeep, ref: 'origin/main', sinceMs: Date.parse(NARROW_SINCE) });
    t('a shallow clone whose floor predates the window is CLEARED by historyHorizon too — '
      + 'the adopters must not refuse answers that are provably right',
      hNarrow.covered === true && hNarrow.shallow === true, JSON.stringify(hNarrow));
    t('and a cleared shallow clone still reports its floor, so the number travels with its horizon',
      hNarrow.floor === '2026-07-06', JSON.stringify(hNarrow));

    t('an unresolvable ref is refused rather than read as covered',
      historyHorizon({ cwd: shallowDeep, ref: 'origin/nope', sinceMs: Date.parse(NARROW_SINCE) }).covered === false);

    // No remote to deepen from: refuse, never answer.
    const orphan = join(root, 'orphan');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, orphan], root);
    g(['remote', 'remove', 'origin'], orphan);
    g(['update-ref', 'refs/heads/probe', g(['rev-parse', 'HEAD'], orphan).trim()], orphan);
    const noRemote = runCliAllowFail(['count', `--since=${WINDOW_SINCE}`, '--ref=probe'], orphan);
    t('with no remote to deepen from it refuses instead of answering from what is there',
      noRemote.code === 2, JSON.stringify(noRemote));
    t('and it says so by name', /no remote|does not resolve/.test(noRemote.stderr || ''), noRemote.stderr);

    // An unusable --since is refused up front rather than silently mis-parsed.
    const badSince = runCliAllowFail(['count', '--since=30 days ago'], full);
    t('a --since git would accept but this tool cannot place is refused as usage',
      badSince.code === 1, JSON.stringify(badSince));

    // ensure answers nothing at all
    const ens = runCliAllowFail(['ensure', `--since=${NARROW_SINCE}`], shallowDeep);
    t('ensure proves coverage and prints no number', ens.code === 0 && ens.stdout.trim() === '',
      JSON.stringify(ens));

    // ── bare dates: the instant the proof reads is the instant git counts ───
    // The fourth trap in the header. git reads a bare YYYY-MM-DD at the CURRENT
    // time of day; the proof reads it as that day's 00:00:00Z. So both clocks
    // here are INJECTED, through git's own `GIT_TEST_DATE_NOW` (epoch seconds,
    // the clock its approxidate consults), and every pin is taken at a morning
    // AND an evening: a pin read at one wall-clock hour is the shape that kept
    // this battery's predecessor green before noon and red after it. `TZ` is
    // pinned as well, because git approxidates a bare date in LOCAL time and
    // each BASELINE has to form the same way on every runner. The BASELINEs
    // come first and prove the injected clock reaches git, so a pin that holds
    // below holds because the tool normalised, not because the clock was ignored.
    battery('bare dates: the instant the proof reads is the instant git counts');
    const BARE_SINCE = WINDOW_SINCE.slice(0, 10); // 2026-06-20; c19 landed that day at 12:00Z
    const BARE_NARROW = NARROW_SINCE.slice(0, 10); // 2026-07-08; c37 landed that day at 12:00Z
    const BARE_UNTIL = '2026-07-10'; // c39, the fixture's last commit, landed that day at 12:00Z
    const MORNING = '2026-07-15T06:00:00Z';
    const EVENING = '2026-07-15T18:00:00Z';
    const clockEnv = (nowIso) => ({
      ...process.env,
      TZ: 'UTC',
      GIT_TEST_DATE_NOW: String(Math.floor(Date.parse(nowIso) / 1000)),
    });
    const runCliAt = (nowIso, args, cwd) => {
      const r = spawnSync(process.execPath, [self, ...args, `--cwd=${cwd}`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: clockEnv(nowIso),
      });
      return { stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), code: r.status };
    };
    const rawCountAt = (nowIso, windowFlags, cwd) => execFileSync(
      'git', ['rev-list', '--count', '--first-parent', ...windowFlags, 'origin/main'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: clockEnv(nowIso) },
    ).trim();

    t('windowInstant reads a bare date as that day\'s 00:00:00Z — the instant Date.parse already gave the proof',
      windowInstant(BARE_SINCE) === WINDOW_SINCE, String(windowInstant(BARE_SINCE)));
    t('windowInstant hands every complete-instant edge of the battery above back BYTE-IDENTICAL, so those '
      + 'windows reach git exactly as they did before normalising existed',
      [WINDOW_SINCE, WINDOW_UNTIL, NARROW_SINCE].every((e) => windowInstant(e) === e),
      JSON.stringify([WINDOW_SINCE, WINDOW_UNTIL, NARROW_SINCE].map(windowInstant)));
    t('an offset is restated in Z and milliseconds survive (the --days shape), so the instant never moves',
      windowInstant('2026-06-20T08:00:00+08:00') === WINDOW_SINCE
        && windowInstant('2026-06-20T00:00:00.250Z') === '2026-06-20T00:00:00.250Z');
    t('a spelling Date.parse cannot place is null, never guessed — resolveSince refuses it as usage, as before',
      windowInstant('30 days ago') === null);

    const rawMorning = rawCountAt(MORNING, [`--since=${BARE_SINCE}`, `--until=${WINDOW_UNTIL}`], full);
    const rawEvening = rawCountAt(EVENING, [`--since=${BARE_SINCE}`, `--until=${WINDOW_UNTIL}`], full);
    t('BASELINE — raw git counts the bare --since window as 21 at 06:00Z and 20 at 18:00Z: the injected clock '
      + 'reaches its approxidate, and the day\'s 12:00Z commit falls out after noon (the defect, reproduced)',
      rawMorning === '21' && rawEvening === '20', `morning ${rawMorning} evening ${rawEvening}`);
    const rawUntilMorning = rawCountAt(MORNING, [`--since=${WINDOW_SINCE}`, `--until=${BARE_UNTIL}`], full);
    const rawUntilEvening = rawCountAt(EVENING, [`--since=${WINDOW_SINCE}`, `--until=${BARE_UNTIL}`], full);
    t('BASELINE — raw git counts the bare --until window the other way round, 20 at 06:00Z and 21 at 18:00Z',
      rawUntilMorning === '20' && rawUntilEvening === '21', `morning ${rawUntilMorning} evening ${rawUntilEvening}`);
    const rawSlashEvening = rawCountAt(EVENING, ['--since=2026/06/20', `--until=${WINDOW_UNTIL}`], full);
    t('BASELINE — the bare date is one spelling of the trap, not the trap: raw git reads `2026/06/20` at '
      + '18:00Z as well, and answers 20',
      rawSlashEvening === '20', `evening ${rawSlashEvening}`);

    const bareMorning = runCliAt(MORNING, ['count', `--since=${BARE_SINCE}`, `--until=${WINDOW_UNTIL}`], full);
    const bareEvening = runCliAt(EVENING, ['count', `--since=${BARE_SINCE}`, `--until=${WINDOW_UNTIL}`], full);
    const explicitEvening = runCliAt(EVENING, ['count', `--since=${WINDOW_SINCE}`, `--until=${WINDOW_UNTIL}`], full);
    t('the tool answers the bare --since window with 21 at 06:00Z AND at 18:00Z — the explicit-instant answer, '
      + 'whatever the time of day',
      bareMorning.code === 0 && bareEvening.code === 0 && bareMorning.stdout.trim() === '21'
        && bareEvening.stdout.trim() === '21' && explicitEvening.stdout.trim() === '21',
      JSON.stringify({ bareMorning, bareEvening, explicitEvening }));
    t('and its receipt names the instant git counted from, not the bare date it was given',
      bareEvening.stderr.includes(` since ${WINDOW_SINCE} until ${WINDOW_UNTIL} · `)
        && !bareEvening.stderr.includes(` since ${BARE_SINCE} `), bareEvening.stderr);

    const untilMorning = runCliAt(MORNING, ['count', `--since=${WINDOW_SINCE}`, `--until=${BARE_UNTIL}`], full);
    const untilEvening = runCliAt(EVENING, ['count', `--since=${WINDOW_SINCE}`, `--until=${BARE_UNTIL}`], full);
    const untilExplicit = runCliAt(EVENING, ['count', `--since=${WINDOW_SINCE}`, `--until=${BARE_UNTIL}T00:00:00Z`], full);
    t('a bare --until is that day\'s 00:00:00Z too: 20 at both hours, the explicit-instant answer',
      untilMorning.stdout.trim() === '20' && untilEvening.stdout.trim() === '20' && untilExplicit.stdout.trim() === '20',
      JSON.stringify({ untilMorning, untilEvening, untilExplicit }));
    t('and the receipt names that instant as the until edge',
      untilEvening.stderr.includes(` until ${BARE_UNTIL}T00:00:00Z · `), untilEvening.stderr);

    const slashEvening = runCliAt(EVENING, ['count', '--since=2026/06/20', `--until=${WINDOW_UNTIL}`], full);
    t('every spelling Date.parse places is normalised the same way: `2026/06/20` answers 21 at 18:00Z and its '
      + 'receipt names 2026-06-20T00:00:00Z',
      slashEvening.code === 0 && slashEvening.stdout.trim() === '21'
        && slashEvening.stderr.includes(` since ${WINDOW_SINCE} `), JSON.stringify(slashEvening));

    const shallowEvening = runCliAt(EVENING, ['count', `--since=${BARE_NARROW}`, `--until=${WINDOW_UNTIL}`, '--no-fetch'], shallowDeep);
    const rawShallowEvening = rawCountAt(EVENING, [`--since=${BARE_NARROW}`, `--until=${WINDOW_UNTIL}`], shallowDeep);
    t('the filing card\'s shape — a shallow clone whose floor predates the window, asked after noon — answers 3 '
      + 'without fetching, the complete-instant answer of the battery above, where the raw bare date counts 2',
      shallowEvening.code === 0 && shallowEvening.stdout.trim() === narrow.stdout.trim()
        && shallowEvening.stdout.trim() === '3' && /no fetch/.test(shallowEvening.stderr) && rawShallowEvening === '2',
      JSON.stringify({ shallowEvening, rawShallowEvening }));

    const logEvening = runCliAt(EVENING, ['log', `--since=${BARE_SINCE}`, `--until=${WINDOW_UNTIL}`, '--format=%H'], full);
    t('`log` reads the same normalised window as `count`: 21 lines at 18:00Z',
      logEvening.code === 0 && logEvening.stdout.trim().split('\n').length === 21, JSON.stringify(logEvening));

    const refusedEvening = runCliAt(EVENING, ['count', `--since=${BARE_SINCE}`, '--no-fetch'], shallowDeep);
    t('a refusal names the instant too, with exit 2 and EMPTY stdout',
      refusedEvening.code === 2 && refusedEvening.stdout.trim() === ''
        && refusedEvening.stderr.includes(`window: since ${WINDOW_SINCE}`), JSON.stringify(refusedEvening));

    const untilNow = runCliAt(EVENING, ['count', `--since=${WINDOW_SINCE}`, '--until=now'], full);
    t('an --until Date.parse cannot place still reaches git as given, and the receipt prints it as given — '
      + 'normalising added no refusal',
      untilNow.code === 0 && untilNow.stdout.trim() === '21' && untilNow.stderr.includes(' until now · '),
      JSON.stringify(untilNow));

    // ── touch: the provenance reading a shallow clone fabricates ────────────
    // The fixture's `charter.md` was last touched at c2; every shallow clone
    // cut below floors above it. Measured on real history the same way: a
    // 50-deep container clone named its own boundary as the last touch of a
    // lane charter whose true touch sat a day below the floor.
    battery('touch: the provenance reading a shallow clone fabricates');
    const trueTouch = g(['log', '-1', '--format=%H', 'origin/main', '--', 'charter.md'], full).trim();
    const trueRoot = g(['log', '-1', '--format=%H', 'origin/main', '--', 'root.txt'], full).trim();
    const tipSha = g(['rev-parse', 'origin/main'], full).trim();
    const boundaryOf = (cwd) => g(['rev-list', '--max-parents=0', 'origin/main'], cwd).trim();
    const rawTouch = (cwd, p) => g(['log', '-1', '--format=%H', 'origin/main', '--', p], cwd).trim();
    const short = (sha) => sha.slice(0, 9);

    const touch5 = join(root, 'touch5');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, touch5], root);
    const b5 = boundaryOf(touch5);
    const raw5 = rawTouch(touch5, 'charter.md');
    t('BASELINE — on a depth-5 clone raw git names the graft boundary as the last touch of a file '
      + 'the boundary never changed (the defect, reproduced: a real sha, exit 0, no warning)',
      raw5 === b5 && raw5 !== trueTouch, `raw ${short(raw5)} boundary ${short(b5)} true ${short(trueTouch)}`);
    const boundaryParents = objectParents(touch5, b5);
    t('the boundary OBJECT still names one parent and that parent is absent — the graft hides it '
      + 'from traversal, not from the object, which is what tells a boundary from a real root',
      boundaryParents !== null && boundaryParents.length === 1 && boundaryParents[0].present === false,
      JSON.stringify(boundaryParents));
    t('the naive verification leg is fooled: `git show --stat <boundary> -- charter.md` prints a line '
      + '(the whole file as an insertion against the empty tree), so a non-empty stat proves nothing',
      g(['show', '--stat', '--format=', b5, '--', 'charter.md'], touch5).trim() !== '');

    const touch20 = join(root, 'touch20');
    g(['clone', '--quiet', '--depth=20', `file://${up}`, touch20], root);
    const b20 = boundaryOf(touch20);
    const raw20 = rawTouch(touch20, 'charter.md');
    t('a second depth names a second, different sha — its own boundary: one mechanism, seen from two depths',
      raw20 === b20 && raw20 !== raw5 && raw20 !== trueTouch, `raw ${short(raw20)} boundary ${short(b20)}`);

    const vBoundary = touchIsProvable({ cwd: touch5, sha: b5, path: 'charter.md' });
    t('touchIsProvable refuses the boundary and says it is one', vBoundary.provable === false && vBoundary.boundary === true,
      JSON.stringify(vBoundary));
    const vTrue = touchIsProvable({ cwd: full, sha: trueTouch, path: 'charter.md' });
    t('and accepts the true touch on the complete clone, listing the path its diff touches',
      vTrue.provable === true && vTrue.touched.join() === 'charter.md', JSON.stringify(vTrue));

    const refusedTouch = runCliAllowFail(['touch', '--path=charter.md', '--no-fetch'], touch5);
    t('the CLI REFUSES the shallow reading with exit 2', refusedTouch.code === 2, JSON.stringify(refusedTouch));
    t('and stdout stays EMPTY — a captured sha is empty rather than plausible', refusedTouch.stdout.trim() === '',
      JSON.stringify(refusedTouch.stdout));
    t('and the refusal names the boundary mechanism, the raw sha it is NOT printing, and a --deepen remedy',
      /graft boundary/.test(refusedTouch.stderr) && refusedTouch.stderr.includes(short(b5)) && /--deepen=/.test(refusedTouch.stderr),
      refusedTouch.stderr);

    // --deepen=34 from c35 lands the boundary on c1: c2's parent is present, the clone is still shallow.
    const answeredTouch = runCliAllowFail(['touch', '--path=charter.md', '--deepen=34'], touch5);
    t('with fetching allowed it deepens and answers the TRUE touch, exit 0',
      answeredTouch.code === 0 && answeredTouch.stdout.trim() === trueTouch, JSON.stringify(answeredTouch));
    t('while the clone is STILL shallow — the predicate is the COMMIT\'s graft state, never the repo\'s shallow flag',
      isShallow(touch5) === true && /fetch --deepen=34/.test(answeredTouch.stderr) && /proof: 1 parent\(s\) present/.test(answeredTouch.stderr),
      answeredTouch.stderr);

    // The worst case: --deepen=33 lands the boundary exactly ON c2 — the right sha for the wrong reason.
    const touch5c = join(root, 'touch5c');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, touch5c], root);
    const onBoundary = runCliAllowFail(['touch', '--path=charter.md', '--deepen=33'], touch5c);
    t('a deepen that lands the boundary exactly ON the true touch is not accepted at that step — the tool '
      + 'deepens again and only then answers the same sha, now with its parent present',
      onBoundary.code === 0 && onBoundary.stdout.trim() === trueTouch && /--deepen=33 .*--deepen=66/.test(onBoundary.stderr),
      onBoundary.stderr);

    // The state a LATER fetch leaves behind: the parent in the store, the graft
    // still registered (#18355). Constructed rather than described — clone
    // shallow, then fetch the boundary's OWN parent sha, a plain fetch with no
    // --deepen, so nothing rewrites the shallow list. Object-parent presence
    // then passes while the walk is still grafted, which is exactly the reading
    // that used to come back `boundary: false` with "its diff does not touch".
    const stale = join(root, 'touch-stale');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, stale], root);
    g(['config', 'uploadpack.allowAnySHA1InWant', 'true'], up);
    const bStale = boundaryOf(stale);
    g(['fetch', '--quiet', 'origin', objectParents(stale, bStale)[0].sha], stale);
    const readShallowList = (cwd) => {
      try {
        return readFileSync(join(g(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim(), 'shallow'), 'utf8');
      } catch { return '(no shallow list readable)'; }
    };
    const staleParents = objectParents(stale, bStale);
    t('FIXTURE — fetching the boundary\'s own parent sha puts that parent in the object store and leaves the '
      + 'graft REGISTERED: the shallow list still names the boundary, the walk still roots there, the clone is '
      + 'still shallow. Read first, because a case asserting on a state that did not form proves nothing',
      readShallowList(stale).includes(bStale) && staleParents.length === 1 && staleParents[0].present === true
        && boundaryOf(stale) === bStale && isShallow(stale) === true,
      `shallow list ${JSON.stringify(readShallowList(stale))} parents ${JSON.stringify(staleParents)}`);
    t('BASELINE — raw git STILL names that boundary as the last touch of charter.md in this state: the defect '
      + 'is the graft, not the absent object, and fetching the parent did not un-graft the walk',
      rawTouch(stale, 'charter.md') === bStale,
      `raw ${short(rawTouch(stale, 'charter.md'))} boundary ${short(bStale)} true ${short(trueTouch)}`);

    const vStale = touchIsProvable({ cwd: stale, sha: bStale, path: 'charter.md' });
    t('touchIsProvable calls it a BOUNDARY although every parent its object names is present — the flag follows '
      + 'the graft, not the timing of the last fetch, which is what made this a false negative',
      vStale.provable === false && vStale.boundary === true && vStale.parents.every((p) => p.present),
      JSON.stringify(vStale));
    t('and the reason names the outlived registration instead of telling an operator the commit simply did not '
      + 'touch the path — the refusal was always right; this is the sentence printed beside it',
      /graft boundary/.test(vStale.reason ?? '') && !/does not touch/.test(vStale.reason ?? ''),
      String(vStale.reason));
    t('isGraftBoundary is the discriminator, and it fires on BOTH graft shapes: parent present here, parent '
      + 'absent on the untouched depth-20 clone',
      isGraftBoundary(stale, bStale) === true && isGraftBoundary(touch20, b20) === true);
    t('and it is FALSE for an ordinary commit and for a real root — a leg that fired on either would refuse '
      + 'provable answers, the failure mode a bare is-shallow guard has',
      isGraftBoundary(stale, tipSha) === false && isGraftBoundary(full, trueRoot) === false);
    const staleControl = runCliAllowFail(['touch', '--path=f.txt', '--no-fetch'], stale);
    t('FIRING CONTROL — the same clone still ANSWERS for a path its tip really touched, so the new leg '
      + 'discriminates rather than refusing everything in a repo that carries a graft anywhere',
      staleControl.code === 0 && staleControl.stdout.trim() === tipSha, JSON.stringify(staleControl));
    const staleRefusal = runCliAllowFail(['touch', '--path=charter.md', '--no-fetch'], stale);
    t('and the CLI refuses charter.md there with exit 2, EMPTY stdout, and the REASON line carries the '
      + 'outlived registration rather than "its diff does not touch". The first spelling of this case tested '
      + 'the stderr for `graft boundary` and stayed green under ablation — the refusal boilerplate says that '
      + 'phrase on every refusal, so the case was pinning a constant',
      staleRefusal.code === 2 && staleRefusal.stdout.trim() === ''
        && /OUTLIVED the fetch/.test(staleRefusal.stderr) && !/its diff does not touch/.test(staleRefusal.stderr),
      JSON.stringify(staleRefusal));

    // Last on this clone, because it deepens it: the refusal has to be a step
    // rather than a dead end. A remedy that cannot clear the state it is
    // printed for would make the refusal correct and useless at once.
    const staleRecovered = runCliAllowFail(['touch', '--path=charter.md'], stale);
    t('and with fetching allowed the SAME clone deepens out of the registered graft and answers the TRUE touch: '
      + 'the printed remedy clears the state it is printed for',
      staleRecovered.code === 0 && staleRecovered.stdout.trim() === trueTouch
        && /fetch --deepen=/.test(staleRecovered.stderr), JSON.stringify(staleRecovered));

    const touch5b = join(root, 'touch5b');
    g(['clone', '--quiet', '--depth=5', `file://${up}`, touch5b], root);
    const control = runCliAllowFail(['touch', '--path=f.txt', '--no-fetch'], touch5b);
    t('FIRING CONTROL — a sha that did touch the path answers on the same shallow clone without any fetch: '
      + 'the check discriminates rather than always refusing',
      control.code === 0 && control.stdout.trim() === tipSha && /without fetching/.test(control.stderr), JSON.stringify(control));
    const rootAnswer = runCliAllowFail(['touch', '--path=root.txt'], touch5b);
    t('a real root is provable once reached: the deepen dissolves the graft and the answer is the root '
      + 'commit, whose object names no parent',
      rootAnswer.code === 0 && rootAnswer.stdout.trim() === trueRoot && isShallow(touch5b) === false && /a real root/.test(rootAnswer.stderr),
      JSON.stringify(rootAnswer));

    const fullTouch = runCliAllowFail(['touch', '--path=charter.md', '--format=%h'], full);
    t('a complete clone answers without fetching and honours --format',
      fullTouch.code === 0 && fullTouch.stdout.trim() === g(['rev-parse', '--short', trueTouch], full).trim()
        && /complete clone \(no fetch\)/.test(fullTouch.stderr),
      JSON.stringify(fullTouch));
    const never = runCliAllowFail(['touch', '--path=never.txt'], full);
    t('a path no commit on the ref ever touched is usage (exit 1) with empty stdout — neither a refusal nor an answer',
      never.code === 1 && never.stdout.trim() === '' && /no commit on/.test(never.stderr), JSON.stringify(never));
    const noPath = runCliAllowFail(['touch'], full);
    t('touch without --path is usage', noPath.code === 1 && noPath.stdout.trim() === '', JSON.stringify(noPath));

    // ── piped stdout: the answer a pipe reads is the answer a file holds ────
    // The fifth trap in the header. A file takes the whole answer in one write;
    // a pipe takes what fits and the rest waits on the event loop, which the
    // entry's old `process.exit()` ended. Every answer above fits in one
    // buffer-full, so none of them could see it. This one is padded to many:
    // `%<(16384)` pads a field to 16384 columns (git ignores wider), four to a
    // line, 21 lines. A child's pipe here is a socketpair, so a buffer-full is
    // the socket's send buffer (212992 bytes by default on Linux) rather than a
    // FIFO's 64 KiB; the answer is sized well past both. `full` is read-only
    // here, so this battery's place after the deepening ones changes nothing.
    battery('piped stdout: the answer a pipe reads is the answer a file holds');
    const wideArgs = [
      'log', `--since=${WINDOW_SINCE}`, `--until=${WINDOW_UNTIL}`, `--format=${'%<(16384)%H'.repeat(4)}`, `--cwd=${full}`,
    ];
    const newlines = (buf) => buf.reduce((n, b) => n + (b === 10 ? 1 : 0), 0);

    const wideFile = join(root, 'wide-answer.txt');
    const wideFd = openSync(wideFile, 'w');
    let toFile;
    try {
      toFile = spawnSync(process.execPath, [self, ...wideArgs], { cwd: full, encoding: 'utf8', stdio: ['ignore', wideFd, 'pipe'] });
    } finally {
      closeSync(wideFd);
    }
    const fileBytes = readFileSync(wideFile);
    const fileLines = newlines(fileBytes);
    t('FIXTURE — the wide `log` sent to a FILE holds the 21 answer lines, exit 0, and is over 1 MiB: many times '
      + 'what a pipe takes in one go. Read first, because an answer that fits one buffer-full passes the piped '
      + 'pins below with or without the fix',
      toFile.status === 0 && fileLines === 21 && fileBytes.length > 1024 * 1024,
      `exit ${toFile.status} lines ${fileLines} bytes ${fileBytes.length} stderr ${JSON.stringify(toFile.stderr)}`);

    // The reader is its own process, so the tool's stdout is a real pipe whose
    // far end nothing else drains. It attaches its listener at once (Node
    // discards a child's unread output when the child exits, which would look
    // like a truncation of the reader's own making), holds the stream paused
    // for 200 ms so the tool fills the pipe and has to wait, then reads to EOF —
    // or, in `close-early` mode, takes one chunk and closes, the shape of `| head -1`.
    const PIPE_READER = [
      "const { spawn } = require('node:child_process');",
      "const { createHash } = require('node:crypto');",
      'const [mode, ...cmd] = process.argv.slice(1);',
      "const child = spawn(process.execPath, cmd, { stdio: ['ignore', 'pipe', 'pipe'] });",
      "const hash = createHash('sha256');",
      "let bytes = 0; let lines = 0; let stderr = '';",
      "child.stderr.on('data', (d) => { stderr += d; });",
      'const take = (d) => { bytes += d.length; lines += d.reduce((n, b) => n + (b === 10 ? 1 : 0), 0); hash.update(d); };',
      "if (mode === 'close-early') child.stdout.once('data', (d) => { take(d); child.stdout.destroy(); });",
      "else child.stdout.on('data', take);",
      'child.stdout.pause();',
      'setTimeout(() => child.stdout.resume(), 200);',
      "child.on('close', (code, signal) => process.stdout.write(JSON.stringify({ code, signal, bytes, lines, sha256: hash.digest('hex'), stderr })));",
    ].join('\n');
    const readThroughPipe = (mode) => {
      const r = spawnSync(process.execPath, ['-e', PIPE_READER, mode, self, ...wideArgs], {
        cwd: full,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
      try {
        return JSON.parse(r.stdout);
      } catch {
        return { code: null, readerExit: r.status, readerSignal: r.signal, readerError: String(r.error ?? ''),
          readerStdout: String(r.stdout).slice(0, 300), stderr: String(r.stderr).slice(0, 300) };
      }
    };

    const piped = readThroughPipe('slow');
    t('the same `log` through a pipe whose reader holds off reads the SAME 21 lines, exit 0 — where the entry\'s '
      + 'old process.exit() delivered one buffer-full and still exited 0',
      piped.code === 0 && piped.lines === fileLines, JSON.stringify(piped));
    t('and the piped bytes ARE the file\'s bytes: the same length and the same sha256, not just the same line count',
      piped.bytes === fileBytes.length && piped.sha256 === createHash('sha256').update(fileBytes).digest('hex'),
      `piped ${piped.bytes} bytes ${piped.sha256} · file ${fileBytes.length} bytes`);

    const early = readThroughPipe('close-early');
    t('a reader that closes after its first chunk (the `| head -1` shape, proved by reading less than the file '
      + 'holds) costs the tool no `write EPIPE` trace: it exits with the answer\'s code, 0, and its stderr is the '
      + 'one-line method receipt',
      early.code === 0 && early.bytes > 0 && early.bytes < fileBytes.length
        && /^method: git log [^\n]*\n$/.test(early.stderr ?? '') && !/EPIPE/.test(early.stderr ?? ''),
      JSON.stringify(early));

    // ── ancestor: the negative a shallow clone fabricates ───────────────────
    // The sixth trap in the header. Last, because it adds two never-merged
    // commits to `up` and deepens its own clones; nothing above reads either.
    battery('ancestor: the negative a shallow clone fabricates');
    const bnd = (sha, iso) => ({ sha, ms: iso === null ? null : Date.parse(iso) });
    const tested0 = Date.parse('2026-07-11T12:00:00Z');
    const vComplete = negativeIsProven({ boundaries: [], testedMs: tested0 });
    t('no graft under the ref: a negative stands by COMPLETENESS and owes no control — even for a commit with no '
      + 'date here, because a walk of a complete history that missed it missed nothing',
      vComplete.proven === true && vComplete.by === 'complete' && vComplete.control === null
        && negativeIsProven({ boundaries: [], testedMs: null }).proven === true, JSON.stringify(vComplete));
    const vFloor = negativeIsProven({ boundaries: [bnd('old', '2026-06-01T00:00:00Z'), bnd('new', '2026-06-21T12:00:00Z')], testedMs: tested0 });
    t('every boundary older than the tested commit by the margin: the negative stands by the FLOOR, and the control '
      + 'leg it names is the NEWEST boundary — the one a hidden ancestor would have to predate',
      vFloor.proven === true && vFloor.by === 'floor' && vFloor.control.sha === 'new', JSON.stringify(vFloor));
    const vIntrude = negativeIsProven({ boundaries: [bnd('old', '2026-06-01T00:00:00Z'), bnd('new', '2026-07-06T12:00:00Z')], testedMs: tested0 });
    t('the NEWEST boundary decides, not the oldest — one cut inside the margin is enough to void the negative',
      vIntrude.proven === false && vIntrude.why === 'floor-intrudes' && vIntrude.control.sha === 'new', JSON.stringify(vIntrude));
    t('the margin is the whole difference between those two: the same cut five days below the tested commit is '
      + 'refused at the default 7 days and stands at --margin-days=1',
      negativeIsProven({ boundaries: [bnd('new', '2026-07-06T12:00:00Z')], testedMs: tested0, marginDays: 1 }).proven === true
        && negativeIsProven({ boundaries: [bnd('new', '2026-07-06T12:00:00Z')], testedMs: tested0, marginDays: 7 }).proven === false);
    t('a tested commit with no date here (its object is absent) is placed against nothing, and a boundary with no '
      + 'readable date decides nothing — neither is rounded to a "no"',
      negativeIsProven({ boundaries: [bnd('b', '2026-06-01T00:00:00Z')], testedMs: null }).why === 'tested-absent'
        && negativeIsProven({ boundaries: [bnd('b', null)], testedMs: tested0 }).why === 'boundary-undated');

    g(['config', 'uploadpack.allowAnySHA1InWant', 'true'], up);
    const cAt = (i) => g(['rev-parse', `origin/main~${FIXTURE_COMMITS - 1 - i}`], full).trim();
    const c2 = cAt(2);
    const c38 = cAt(38);
    // Two commits that never merged, built in `up` and fetched by sha: one on
    // c2, dated below every shallow floor cut here, and one on c38, dated a
    // day after the tip.
    const neverMerged = (parent, iso, msg) => execFileSync(
      'git', ['commit-tree', g(['rev-parse', `${parent}^{tree}`], up).trim(), '-p', parent, '-m', msg],
      { cwd: up, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } },
    ).trim();
    const oldSide = neverMerged(c2, '2026-06-04T00:00:00Z', 'never merged, old');
    const newSide = neverMerged(c38, '2026-07-11T12:00:00Z', 'never merged, new');
    const rawAnc = (cwd, x) => spawnSync('git', ['merge-base', '--is-ancestor', x, 'origin/main'], { cwd, stdio: 'ignore' }).status;
    const anc = (args, cwd) => runCliAllowFail(['ancestor', ...args], cwd);
    const shallowWith = (name, depth, shas) => {
      const dir = join(root, name);
      g(['clone', '--quiet', `--depth=${depth}`, `file://${up}`, dir], root);
      if (shas.length > 0) g(['fetch', '--quiet', 'origin', ...shas], dir);
      return dir;
    };

    const anc5 = shallowWith('anc5', 5, []);
    const b5anc = boundaryOf(anc5);
    t('BASELINE — c2 is in main\'s real history, and on a depth-5 clone that does not hold its object raw git '
      + 'exits 128: a third number, which `if ! git merge-base --is-ancestor …` reads as "not an ancestor"',
      rawAnc(full, c2) === 0 && rawAnc(anc5, c2) === 128, `full ${rawAnc(full, c2)} shallow ${rawAnc(anc5, c2)}`);
    g(['fetch', '--quiet', 'origin', c2, oldSide, newSide], anc5);
    t('FIXTURE — fetching those shas by name puts the objects in and moves no cut: the clone is still shallow and '
      + 'its one graft boundary under origin/main is the one it was cloned with',
      isShallow(anc5) === true && boundaryOf(anc5) === b5anc
        && JSON.stringify(graftBoundaries(anc5, 'origin/main').map((b) => b.sha)) === JSON.stringify([b5anc])
        && graftBoundaries(full, 'origin/main').length === 0,
      JSON.stringify(graftBoundaries(anc5, 'origin/main')));
    t('BASELINE — with its object present, the SAME real ancestor now reads exit 1 (the defect, reproduced: the '
      + 'cut withheld the path, at an ordinary exit code and with no warning)',
      rawAnc(anc5, c2) === 1, `raw ${rawAnc(anc5, c2)}`);
    t('BASELINE — and a commit that truly never merged reads exit 1 too: one exit code for opposite facts',
      rawAnc(anc5, oldSide) === 1 && rawAnc(full, c2) === 0, `raw ${rawAnc(anc5, oldSide)}`);

    const refusedAnc = anc([`--commit=${c2}`, '--no-fetch'], anc5);
    t('the CLI REFUSES that reading with exit 2 and EMPTY stdout — a captured answer is empty rather than "no"',
      refusedAnc.code === 2 && refusedAnc.stdout === '', JSON.stringify(refusedAnc));
    t('and the refusal prints the tested leg\'s own exit code, the cut it could not rule out with its date, and a '
      + '--deepen remedy',
      refusedAnc.stderr.includes(`tested leg ${short(c2)} exit 1`) && refusedAnc.stderr.includes(`${short(b5anc)} (2026-07-06)`)
        && /Remedy: git -C \S+ fetch --deepen=/.test(refusedAnc.stderr), refusedAnc.stderr);
    const libReading = ancestorReading({ cwd: anc5, commit: c2, ref: 'origin/main' });
    t('ancestorReading is the read-only form of the same refusal: unproven, both numbers in the result, and it '
      + 'fetched nothing (the cut is where it was)',
      libReading.state === 'unproven' && libReading.testedStatus === 1 && libReading.deepenCanHelp === true
        && libReading.control.sha === b5anc && boundaryOf(anc5) === b5anc, JSON.stringify(libReading));

    const yesAnc = anc([`--commit=${c38}`, '--no-fetch'], anc5);
    t('FIRING CONTROL — a commit inside the window answers `yes`, exit 0, on the same shallow clone without any '
      + 'fetch: a yes proves itself, so the command discriminates rather than refusing every shallow clone',
      yesAnc.code === 0 && yesAnc.stdout === 'yes\n' && /no control leg is owed/.test(yesAnc.stderr)
        && /read without fetching/.test(yesAnc.stderr) && isShallow(anc5) === true, JSON.stringify(yesAnc));

    const marginRefusal = anc([`--commit=${newSide}`, '--no-fetch'], anc5);
    t('a never-merged commit dated five days above the cut is REFUSED at the default margin: the cut is not 7 '
      + 'days older than it, so the cut is not yet a control',
      marginRefusal.code === 2 && marginRefusal.stdout === '' && /is not 7 day\(s\) older/.test(marginRefusal.stderr),
      JSON.stringify(marginRefusal));
    const noAnc = anc([`--commit=${newSide}`, '--no-fetch', '--margin-days=1'], anc5);
    t('with the margin it can meet, the same commit answers `no` WITHOUT fetching, and the clone is still shallow '
      + '— the predicate is the cut\'s place against the commit, never the shallow flag',
      noAnc.stdout === 'no\n' && /read without fetching/.test(noAnc.stderr) && isShallow(anc5) === true, JSON.stringify(noAnc));
    t(`a proven no exits ${EXIT_NOT_ANCESTOR}: not 0, so \`ancestor … && echo landed\` cannot read it as a yes, and not 1, `
      + 'which is this tool\'s usage exit',
      noAnc.code === EXIT_NOT_ANCESTOR && EXIT_NOT_ANCESTOR !== 0 && EXIT_NOT_ANCESTOR !== 1 && EXIT_NOT_ANCESTOR !== 2,
      `exit ${noAnc.code}`);
    t('and the receipt carries BOTH legs with their exit codes: the tested commit at 1, and the control — the '
      + 'graft boundary itself — at 0',
      noAnc.stderr.includes(`tested leg ${short(newSide)} exit 1`) && noAnc.stderr.includes(`control leg ${short(b5anc)} exit 0`)
        && rawAnc(anc5, b5anc) === 0, noAnc.stderr);

    const withControl = anc([`--commit=${newSide}`, '--no-fetch', '--margin-days=1', `--control=${c38}`], anc5);
    t('--control adds the operator\'s own leg to the receipt when it holds: in the ref\'s history (exit 0) and not '
      + 'newer than the tested commit',
      withControl.code === EXIT_NOT_ANCESTOR && withControl.stderr.includes(`operator control ${short(c38)} exit 0`),
      JSON.stringify(withControl));
    const nearRelative = anc([`--commit=${oldSide}`, `--control=${c38}`], anc5);
    t('⛔ a control NEWER than the tested commit is refused as a near relative, exit 2 with empty stdout — it '
      + 'answers 0 on every clone and says nothing about a deeper commit',
      nearRelative.code === 2 && nearRelative.stdout === '' && /NEWER than the tested commit/.test(nearRelative.stderr),
      JSON.stringify(nearRelative));
    t('and that refusal climbed no ladder although fetching was allowed: no deepen changes which commit the '
      + 'operator named, so the cut is where it was and nothing was tried',
      boundaryOf(anc5) === b5anc && !/tried:/.test(nearRelative.stderr) && /name a control at least as old/.test(nearRelative.stderr),
      nearRelative.stderr);
    const absentShallow = anc(['--commit=deadbeefdeadbeef', '--no-fetch'], anc5);
    t('a sha this shallow clone does not hold is REFUSED, exit 2 — below the cut or nowhere at all, and nothing '
      + 'here tells those apart',
      absentShallow.code === 2 && absentShallow.stdout === '' && /is not an object in this clone/.test(absentShallow.stderr),
      JSON.stringify(absentShallow));

    const anc20 = shallowWith('anc20', 20, [newSide]);
    const deepFloor = anc([`--commit=${newSide}`, '--no-fetch'], anc20);
    t('on a depth-20 clone the cut sits weeks below that commit, and the DEFAULT margin answers `no` without '
      + 'fetching — the common case pays nothing',
      deepFloor.code === EXIT_NOT_ANCESTOR && deepFloor.stdout === 'no\n' && /at least 7 day\(s\) older/.test(deepFloor.stderr)
        && isShallow(anc20) === true, JSON.stringify(deepFloor));

    const anc5b = shallowWith('anc5b', 5, [c2]);
    const deepenedYes = anc([`--commit=${c2}`, '--deepen=8'], anc5b);
    t('with fetching allowed the refused reading deepens and answers the TRUTH: c2 is an ancestor, `yes`, exit 0 '
      + '— the answer the complete clone gives, where raw git had said 1',
      deepenedYes.code === 0 && deepenedYes.stdout === 'yes\n' && /fetch --deepen=8 origin main/.test(deepenedYes.stderr)
        && anc([`--commit=${c2}`], full).stdout === 'yes\n', JSON.stringify(deepenedYes));

    const anc5c = shallowWith('anc5c', 5, [oldSide]);
    const deepenedNo = anc([`--commit=${oldSide}`], anc5c);
    t('and the never-merged commit built on c2 deepens to a PROVEN `no`: the ladder ends on a complete history, '
      + 'whose negative owes no control',
      deepenedNo.code === EXIT_NOT_ANCESTOR && deepenedNo.stdout === 'no\n' && /fetch --deepen=64 origin main/.test(deepenedNo.stderr)
        && /every root under the ref is a real root/.test(deepenedNo.stderr), JSON.stringify(deepenedNo));

    const anc5d = shallowWith('anc5d', 5, [oldSide]);
    const voidControl = anc([`--commit=${oldSide}`, `--control=${c2}`, '--no-fetch'], anc5d);
    t('an operator control that answers 1 on this clone VOIDS the negative: refused, exit 2, and the line says '
      + 'which leg failed',
      voidControl.code === 2 && voidControl.stdout === '' && /control leg answered exit 1/.test(voidControl.stderr)
        && rawAnc(anc5d, c2) === 1, JSON.stringify(voidControl));
    const curedControl = anc([`--commit=${oldSide}`, `--control=${c2}`], anc5d);
    t('and with fetching allowed the SAME clone deepens until that control turns 0, then reads again: `no`, with '
      + 'the operator leg at exit 0 in the receipt — the hand procedure, run',
      curedControl.code === EXIT_NOT_ANCESTOR && curedControl.stdout === 'no\n' && /fetch --deepen=/.test(curedControl.stderr)
        && curedControl.stderr.includes(`operator control ${short(c2)} exit 0`) && rawAnc(anc5d, c2) === 0,
      JSON.stringify(curedControl));

    g(['fetch', '--quiet', 'origin', oldSide, newSide], full);
    const fullNo = anc([`--commit=${oldSide}`], full);
    t('a complete clone answers `no` without fetching and says the history is complete rather than naming a floor',
      fullNo.code === EXIT_NOT_ANCESTOR && fullNo.stdout === 'no\n' && /complete clone \(no fetch\)/.test(fullNo.stderr)
        && /control leg: none is owed/.test(fullNo.stderr), JSON.stringify(fullNo));
    const fullAbsent = anc(['--commit=deadbeefdeadbeef'], full);
    t('there a sha the clone does not hold IS a no — absent from a complete history — and the receipt says the '
      + 'object is not here instead of quoting an exit code git never gave',
      fullAbsent.code === EXIT_NOT_ANCESTOR && /is not an object in this clone/.test(fullAbsent.stderr)
        && !/tested leg \S+ exit/.test(fullAbsent.stderr), JSON.stringify(fullAbsent));
    const fullBadControl = anc([`--commit=${oldSide}`, `--control=${newSide}`], full);
    t('a control that is NOT in the ref\'s history is refused even on a complete clone, with no fetch tried and '
      + 'no deepen prescribed: the control or the ref is not the commit the operator takes it for',
      fullBadControl.code === 2 && fullBadControl.stdout === '' && /control leg answered exit 1/.test(fullBadControl.stderr)
        && !/tried:/.test(fullBadControl.stderr) && !/--deepen=/.test(fullBadControl.stderr), JSON.stringify(fullBadControl));

    const noCommit = anc([], full);
    const typoName = anc(['--commit=not-a-ref-here'], full);
    t('ancestor without --commit is usage, and so is a NAME that resolves to nothing: exit 1 with empty stdout, '
      + `never the ${EXIT_NOT_ANCESTOR} a typo could otherwise ride to a "no"`,
      noCommit.code === 1 && noCommit.stdout === '' && typoName.code === 1 && typoName.stdout === ''
        && /names no commit here/.test(typoName.stderr), JSON.stringify({ noCommit: noCommit.code, typoName }));
    const windowed = anc([`--commit=${c2}`, '--since=2026-06-01'], full);
    const strayCommit = runCliAllowFail(['count', `--since=${WINDOW_SINCE}`, `--commit=${c2}`], full);
    t('ancestor takes no window, and no other command takes --commit: both are usage',
      windowed.code === 1 && windowed.stdout === '' && strayCommit.code === 1 && strayCommit.stdout === '',
      JSON.stringify({ windowed: windowed.code, strayCommit: strayCommit.code }));
    const noRef = anc([`--commit=${c38}`, '--ref=origin/nope'], anc5);
    t('an unresolvable ref is REFUSED (exit 2, empty stdout) with its own remedy, not read as "not in it"',
      noRef.code === 2 && noRef.stdout === '' && /does not resolve to a commit/.test(noRef.stderr)
        && !/--deepen=/.test(noRef.stderr), JSON.stringify(noRef));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => { failures += 1; process.stdout.write(`  ✗ ${message}\n`); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }

  process.stdout.write(failures === 0 ? '\ngit-history --self-test: all cases passed.\n' : `\ngit-history --self-test: ${failures} FAILED.\n`);

  selfTestReachedVerdict = true;
  return failures === 0 ? 0 : 1;
}

const invokedDirectly = isEntrypoint(import.meta.url);
if (invokedDirectly) {
  // The fifth trap in the header: `process.exit()` here ended the process with
  // most of a piped `log` answer still queued. Setting the exit code and
  // returning lets the queued writes drain first, on every stdout kind.
  process.stdout.on('error', (err) => {
    // A reader that stopped reading (`| head -1`) took what it wanted; the rest
    // of the answer has nowhere to go. Anything else is a real failure.
    if (err?.code !== 'EPIPE') throw err;
  });
  process.exitCode = main(process.argv.slice(2)) || 0;
}
