#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * git-history.mjs — answer a "how many commits on <ref> in <window>" question,
 * or a "which commit last touched <path> on <ref>" question, or REFUSE, so
 * neither a churn number nor a provenance sha can ever be quoted from
 * truncated history (#9878).
 *
 *   node scripts/pm/git-history.mjs count  --since=2026-07-19 [--until=2026-08-19]
 *   node scripts/pm/git-history.mjs count  --days=30 [--ref=origin/main] [--path=packages/core]
 *   node scripts/pm/git-history.mjs log    --since=2026-07-19 [--format=%H%x09%s]
 *   node scripts/pm/git-history.mjs ensure --since=2026-07-19   # deepen + prove, answer nothing
 *   node scripts/pm/git-history.mjs touch  --path=<file> [--ref=origin/main] [--format=%H]
 *                                          # the last commit on <ref> that touched <file>, PROVEN
 *   node scripts/pm/git-history.mjs --self-test
 *
 * Exit codes: **0** answered, and the answer is provable · **2** refused — the
 * window (or the touch) is not provably present locally and could not be made
 * so · **1** usage or environment.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  'real repos': 15,
  'historyHorizon: the read-only reading the #9902 adopters call': 12,
  'touch: the provenance reading a shallow clone fabricates': 26,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 4;

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
      '  node scripts/pm/git-history.mjs --self-test\n\n' +
      'exit 0 answered · 2 refused (window or touch not provably complete) · 1 usage/environment\n',
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
  const ms = Date.parse(opts.since);
  // Refuse what cannot be compared to a boundary rather than guessing: git
  // accepts "30 days ago", but a window this tool cannot place on a timeline is
  // a window whose coverage it cannot prove.
  if (!Number.isFinite(ms)) usage(`--since=${opts.since} is not a date this tool can place (use YYYY-MM-DD, or --days=<n>)`);
  return opts.since;
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
      process.exit(1);
    }
    return selfTestCode;
  }
  const { cmd, opts } = parseArgs(argv);
  if (cmd === null) usage('a command is required');
  if (!['count', 'log', 'ensure', 'touch'].includes(cmd)) usage(`unknown command '${cmd}'`);
  if (cmd === 'touch') return touchMain(opts);

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
  // step, has always spelled its window this way.
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
  process.exit(main(process.argv.slice(2)) || 0);
}
