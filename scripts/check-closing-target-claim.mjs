#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:closing-target-claim — a pull request may close a card only while that
 * card's own thread carries a `Claim:` naming this pull request's HEAD BRANCH.
 *
 *   node scripts/check-closing-target-claim.mjs              # judge this PR (CI)
 *   node scripts/check-closing-target-claim.mjs --self-test  # verify it offline
 *
 * ⚠️ Repo paths are named UNQUOTED in this header on purpose, and the self-test
 * fixtures below use branches and repos that exist nowhere. Both are
 * load-bearing; the last section carries the measurement that forces them.
 *
 * ## The defect this blocks
 *
 * Every agent in this repository shares ONE GitHub identity, so the assignee
 * field is a presence bit and the `Claim:` comment — first line beginning
 * `Claim:`, with a `Branch:` line naming `claude/issue-N-slug` — is the
 * identity record. Two guards already run at pull-request time: the Duplicate
 * Fix Guard asks whether another OPEN PR claims the same card, and the
 * Single-Claim Path Guard asks whether another open PR writes the same
 * at-most-one-writer path. Neither asks the question that actually decides
 * ownership: does the card this PR CLOSES carry a claim naming this PR's
 * branch?
 *
 * That question was already asked in this tree — by H46 in
 * scripts/pm/check-half-states.mjs — and asked AFTER THE FACT, as a report-only
 * patrol input. The cost of that timing is measured twice, which makes it a
 * rate and not an anecdote:
 *
 *   - the cloud-repo incident: an epic seat and a lane PM implementing ONE card
 *     29 minutes apart, the second with no claim comment at all;
 *   - an objectstack card implemented TWICE in one morning.
 *
 * Both were visible to H46's predicate and stopped by nothing. ⭐ A control that
 * detects a defect it cannot prevent is a TIMING defect in an existing control,
 * not an absent one — so what ships here is the promotion of H46's leg (b) to a
 * check that runs while the merge can still be stopped, and ⛔ NOT a second
 * predicate.
 *
 * ## Everything decisive is IMPORTED, never re-spelled
 *
 * Three readings, three shipped owners:
 *
 *   - the closing-keyword grammar is `closingKeywordTargets`, H7's and H21's
 *     and H46's, the module parser that check-closing-keyword-parity holds
 *     behaviourally equal to the two workflow spellings. A FOURTH spelling here
 *     would be the one nobody remembers when the grammar next moves.
 *   - the claim predicate is `h46ClaimNamesBranch`, which is itself
 *     `CLAIM_COMMENT_MARKER` plus `claimedBranches` — the same pair
 *     check-clause2-carriers reads. ⭐ "Import, never restate."
 *   - the merge-queue ref reading is `pullNumberFromQueueRef`, the governed
 *     queue guard's, which already carries the `release/v5`-style base-branch
 *     lesson its own header records.
 *
 * ## What is deliberately NOT changed
 *
 * ⛔ What a claim IS. The single-character separator is a maintainer ruling of
 * 2026-08-11 recorded verbatim at `CLAIM_COMMENT_MARKER`, and the repair
 * direction for a malformed claim is the WRITE side. This gate reads the
 * shipped predicate and widens nothing.
 *
 * ⛔ Any assignee-field logic. The field is a presence bit under a shared
 * identity; it answers no ownership question and is not read here.
 *
 * ⛔ H46 itself. It stays exactly as it is — the patrol's after-the-fact view,
 * still covering pull requests whose CI predates this gate, still report-only,
 * still exporting the predicate this file calls. Two consumers, one predicate,
 * no fork.
 *
 * ⛔ A `Part of #N` target. It is not a closing keyword and never enters this
 * gate's target set: a body declaring itself part of a card is not telling
 * GitHub to finish it, and `closingKeywordTargets` already excludes it.
 *
 * ## The branch-rename edge, decided here rather than discovered in CI
 *
 * A seat that claims correctly and then RENAMES or RE-CREATES its branch leaves
 * a claim naming a ref that no longer exists, and fails a gate it satisfied in
 * substance. Two repairs were available: name the case in the failure text, or
 * widen the predicate to accept any claim from the same SESSION.
 *
 * ⇒ The failure text names it. Widening to a session identity would make this
 * gate the second reader of what a claim IS — the one change the 2026-08-11
 * ruling closes — and it would accept a claim whose `Branch:` line points at a
 * ref nobody can find, which is the state H20 exists to report. The remedy is
 * one comment, it is the same act the protocol already requires, and the
 * failure text spells it out rather than leaving the first person it blocks to
 * work it out.
 *
 * ## Cost — bounded by the PR's closing-keyword count, and cheap on the
 * ## overwhelmingly common shape
 *
 * A body binding no closing keyword makes ZERO API calls and prints one line.
 * Otherwise, per closing target:
 *
 *   1. one comment page (`per_page=100`). The claim is found here on every
 *      thread this board has, so this is where the common path ends.
 *   2. only when NO claim was found: one issue read, to classify the number
 *      before accusing anyone of anything. This is the short-circuit on the
 *      cheap side — the second read happens only on the path about to go red.
 *
 * The page walk is capped, and a thread that could not be walked to the end is
 * UNDETERMINED rather than unclaimed: absence over a truncated read is not
 * absence (#4690), and a degraded reading must never be folded into either
 * verdict.
 *
 * ## Which numbers are judged, and which are declined
 *
 * A closing keyword can bind a number that is not an open card, and accusing
 * its author would make this gate noise on day one. Declined, each for its own
 * reason and each said out loud:
 *
 *   - the number names a PULL REQUEST. A PR carries no claim and was never on
 *     the board; `Closes #<a PR>` is a relation between two PRs.
 *   - the card is already CLOSED. The merge closes nothing, so there is no
 *     second implementation to prevent. This is H46's open-cards scope, reached
 *     by a read instead of by a listing.
 *   - the number could not be read at all — UNDETERMINED, warned about, and
 *     never counted as clean.
 *
 * ## The merge queue, asserted rather than assumed
 *
 * The card behind this gate states that merge-queue builds see the same PR body
 * so the check holds in the queue too. That is TRUE HERE only because this file
 * makes it true, and the mechanism is worth stating because the two sibling
 * PR-scoped guards deliberately do the opposite:
 *
 *   - a `merge_group` event carries NO pull request and therefore no body. Both
 *     body-scoped siblings stop there and take no queue leg.
 *   - this gate takes one anyway, because the queue ref NAMES its pull request:
 *     `gh-readonly-queue/<base>/pr-<N>-<sha>`, read by the imported
 *     `pullNumberFromQueueRef`. With the number in hand the body and the head
 *     ref are one ordinary read away, so the queue leg judges the SAME PR BODY
 *     against the SAME live comment threads. Nothing is re-derived and no
 *     second rule appears on the queue side: both legs end in the same
 *     `collect` and the same `judge`.
 *
 * ⚠️ In a MULTI-PR group the queue ref names only the LAST pull request — the
 * limit `pullNumberFromQueueRef`'s own header states. It is not a hole in the
 * regime: every member of that group passed this gate's `pull_request` leg to
 * be armed at all, and the queue leg is the re-verification on the rebuilt
 * generation for the one it can name. It IS a limit on what the queue leg alone
 * proves, and it is stated rather than left to be discovered.
 *
 * ⛔ This PR does not add this check to the required set. A required context is
 * a `REQUIRED_CONTEXTS` row PLUS a Settings ruleset entry in one sitting, and
 * the settings half is the maintainer's. What the `merge_group` leg buys today
 * is that the question is ASKED on the last thing between a speculative merge
 * and the default branch; what it buys tomorrow is that required-izing this
 * context cannot deadlock the queue, which a workflow with no queue leg always
 * does.
 *
 * ## Exit codes — and why "could not tell" is never 0
 *
 *   0  judged, clean.
 *   1  judged, finding: a card this PR closes records no claim on this branch.
 *   2  NOT MEASURED — the run was handed no usable context (no `PR_NUMBER` and
 *      no queue ref, an empty repo slug or token, a head ref this gate cannot
 *      read), or the queue leg could not read its pull request. A usage,
 *      wiring or transport failure, never a verdict about any PR.
 *
 * A gate that cannot read its input has verified nothing, and exiting 0 there
 * reads as "no violations". The inverse matters as much: a mis-wired gate must
 * not read as an accusation, because it would be red on every PR at once for
 * something no author did.
 *
 * ## The remedy is read LIVE, which the body-scoped siblings cannot say
 *
 * Those guards judge a frozen payload, so `rerun_failed_jobs` replays a stale
 * body and a fixed PR stays red forever; their way back to green is a body EDIT
 * that fires a fresh event. Here the decisive input — the card's comments — is
 * read live on every run, so posting the claim and RE-RUNNING the job is enough
 * and no push is needed. The body is still the frozen half, so the OTHER remedy
 * (dropping the closing keyword) needs a fresh event, which the `edited`
 * activity type supplies.
 *
 * ## Why the paths above are unquoted, and the fixtures fictional
 *
 * The dispatch-gates derivation resolves a check family to its script file and
 * scans THAT FILE for quoted path literals as watch hints, comments and test
 * fixtures included. Written the ordinary way, this header would emit a hint
 * per path and fabricate MATCHED leads for cards touching none of this. So repo
 * paths are named unquoted in prose here; the only quoted paths below are the
 * two real inputs the self-test reads.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { isEntrypoint } from './invoked-as.mjs';

// Imported, never restated. The closing-keyword grammar and the claim
// predicate both have exactly one home in this tree, and this gate is their
// second consumer rather than a second spelling.
import { closingKeywordTargets, h46ClaimNamesBranch } from './pm/check-half-states.mjs';
import { pullNumberFromQueueRef } from './pm/check-governed-queue-guard.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// A self-test whose only success condition is "no failure was recorded" prints
// the same line for "every case held" and "the cases never ran". Every section
// opens with `battery('<name>')`, every assertion is attributed to the battery
// most recently opened, and the floor requires the OPENED set to equal the
// DECLARED set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3 keeps
// a total "right" the moment a sibling grows. A set difference says WHICH
// battery stopped; a count says only that something did.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red.
const SELF_TEST_BATTERIES = Object.freeze({
  'The acceptance pair. Red and GREEN, because a probe tested only on its': 8,
  'The negative controls: a PR that closes nothing and a PR that is only': 7,
  'Delegation, not a second copy of the rule. The targets and the claim': 5,
  'The failure has to carry the card, the branch and every remedy — the': 8,
  'Declined numbers. A closing keyword can bind something that is not an': 6,
  'UNDETERMINED is its own answer: never clean, never an accusation.': 6,
  'Wiring absent: never clean, never an accusation.': 12,
  'The merge-queue leg, asserted rather than assumed.': 9,
  'The wiring itself. A gate whose workflow step is deleted or whose': 10,
  'The predicate sources this gate reuses must still be there to reuse.': 3,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 10;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// ⚠️ None of these helpers is named with a self-test spelling, deliberately and
// on the record: `check:pm-dispatch-gates` anchors on a top-level declaration
// whose NAME spells self-test, and every such name owes a row in that gate's
// COMPOUND_ANCHOR_LEDGER. These are the battery ROSTER's machinery -- they hold
// no fixtures to mask and read no path literal -- so the accurate name is the
// one that says `battery`.

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's own assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared battery RAN, and ran its cases (#13489).
 *
 * Evaluated after every battery has had its chance and BEFORE the verdict, so
 * the success line can only be printed by a run in which the set of batteries
 * that registered assertions EQUALS the set declared.
 */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

const ROOT = new URL('..', import.meta.url).pathname;

/** The wiring that gives this gate a pull request to judge. */
const WIRING_WORKFLOW = '.github/workflows/closing-target-claim-guard.yml';

/**
 * ⚠️ THIS LITERAL IS THE CHECK-RUN NAME branch protection would pin, and it is
 * duplicated in the workflow's `name:` — deliberately, and pinned in both
 * directions by the self-test below. Renaming a job silently detaches a
 * required context, and this is the cheap half of the two-step that makes that
 * impossible to do by accident.
 */
export const CHECK_CONTEXT_NAME = 'The card this PR closes must claim this branch';

/** The predicate homes this gate reuses, and must move when they move. */
const PREDICATE_SOURCES = ['scripts/pm/check-half-states.mjs', 'scripts/pm/check-governed-queue-guard.mjs'];

export const EXIT_CLEAN = 0;
export const EXIT_UNCLAIMED = 1;
export const EXIT_NOT_WIRED = 2;

/** A comment thread is walked at most this far; past it the thread is UNDETERMINED, never unclaimed. */
export const MAX_COMMENT_PAGES = 10;

/** How a single closing target was resolved. One verdict per target, never a shrug. */
export const TARGET_CLAIMED = 'claimed';
export const TARGET_UNCLAIMED = 'unclaimed';
export const TARGET_NOT_A_CARD = 'not-a-card';
export const TARGET_CLOSED = 'closed';
export const TARGET_UNDETERMINED = 'undetermined';

const NOT_WIRED_REASON = Object.freeze({
  CONTEXT: 'neither PR_NUMBER nor MERGE_GROUP_HEAD_REF is set',
  GITHUB_REPOSITORY: 'GITHUB_REPOSITORY is not set (or set to an empty string)',
  GITHUB_TOKEN: 'GITHUB_TOKEN is not set (or set to an empty string)',
  PR_HEAD_REF: 'PR_HEAD_REF is not set (or set to an empty string), and the head branch IS the question',
  MERGE_GROUP_HEAD_REF: 'MERGE_GROUP_HEAD_REF names no merge-queue pull request',
});

/**
 * The run context, or a NOT-WIRED marker, or null.
 *
 * Three-way for the sibling gate's reason: "nothing was handed to this run" and
 * "something was handed but the run is still unusable" are different failures
 * with different remedies, and BOTH must route to EXIT_NOT_WIRED rather than to
 * the finding code or to a request built from an empty slug.
 *
 * `PR_NUMBER` is read by PRESENCE, not truthiness: its value witnesses that the
 * workflow ran this step and is never spliced into a URL on the pull_request
 * leg. `GITHUB_REPOSITORY`, `GITHUB_TOKEN` and `PR_HEAD_REF` are read by
 * truthiness, deliberately a DIFFERENT convention, because each is consumed
 * directly — two into the request, one into the predicate — so for them an
 * empty string is the SAME failure as an absent variable rather than a
 * different one.
 */
export function readPrContext(env) {
  const queueRef = String(env.MERGE_GROUP_HEAD_REF ?? '').trim();
  const wired = Object.hasOwn(env, 'PR_NUMBER') || queueRef !== '';
  if (!wired) return null;

  const repo = String(env.GITHUB_REPOSITORY ?? '').trim();
  if (!repo) return { wired: false, missing: 'GITHUB_REPOSITORY' };

  const token = String(env.GITHUB_TOKEN ?? '').trim();
  if (!token) return { wired: false, missing: 'GITHUB_TOKEN' };

  if (queueRef !== '') {
    const number = pullNumberFromQueueRef(queueRef);
    if (number === null) return { wired: false, missing: 'MERGE_GROUP_HEAD_REF' };
    // The queue leg carries no body and no head ref; `collect` reads both from
    // the pull request the ref names, so the two legs converge before judging.
    return { source: 'merge_group', number: String(number), repo, token, queueRef, body: null, head: null };
  }

  const head = String(env.PR_HEAD_REF ?? '').trim();
  if (!head) return { wired: false, missing: 'PR_HEAD_REF' };

  return { source: 'pull_request', number: String(env.PR_NUMBER ?? '').trim(), repo, token, body: env.PR_BODY ?? '', head };
}

function notWiredVerdict(reasonText) {
  return {
    exit: EXIT_NOT_WIRED,
    lines: [
      `check:closing-target-claim: NOT MEASURED — ${reasonText}, so this run was handed no usable pull`,
      'request context and judged nothing. This is a wiring, usage or transport failure, NOT a verdict:',
      'it says nothing about whether any PR closes a card that never claimed its branch, and no author',
      'caused it.',
      '',
      `Fix:  run it from the workflow that supplies the context (${WIRING_WORKFLOW}), or locally with`,
      '      PR_NUMBER=123 PR_HEAD_REF=claude/issue-123-slug PR_BODY="Closes #123" \\',
      '        GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... node scripts/check-closing-target-claim.mjs',
    ],
  };
}

/**
 * The verdict: `{ exit, lines }`, pure over its input, so the self-test drives
 * every arm with no network at all.
 *
 * `ctx.targets` is the collected result — one row per closing target, each
 * carrying its own verdict. A row is never omitted: a declined number is a
 * DECISION with a reason, not a silence.
 */
export function judge(ctx) {
  if (ctx === null) return notWiredVerdict(NOT_WIRED_REASON.CONTEXT);
  if (ctx.wired === false) return notWiredVerdict(NOT_WIRED_REASON[ctx.missing]);
  if (ctx.unreadable) return notWiredVerdict(ctx.unreadable);

  const where = ctx.number ? `PR #${ctx.number}` : 'this PR';
  const leg = ctx.source === 'merge_group' ? ' (merge-queue build)' : '';
  const targets = ctx.targets ?? [];

  if (targets.length === 0) {
    return {
      exit: EXIT_CLEAN,
      lines: [
        `✓ check:closing-target-claim: ${where}${leg} binds no closing keyword to a card, so it can ` +
          'attribute none. A `Part of #N` declaration is not a closing target and is not checked.',
      ],
    };
  }

  const undetermined = targets.filter((t) => t.verdict === TARGET_UNDETERMINED);
  const unclaimed = targets.filter((t) => t.verdict === TARGET_UNCLAIMED);
  const undeterminedLines = undetermined.map(
    (t) =>
      `::warning::UNDETERMINED — #${t.number} could not be read to the end (${t.why}), so this run ` +
      `could not prove whether any \`Claim:\` on it names \`${ctx.head}\`.`,
  );

  if (unclaimed.length === 0) {
    const claimed = targets.filter((t) => t.verdict === TARGET_CLAIMED).map((t) => `#${t.number}`);
    const declined = targets.filter((t) => t.verdict === TARGET_NOT_A_CARD || t.verdict === TARGET_CLOSED);
    return {
      exit: EXIT_CLEAN,
      lines: [
        ...undeterminedLines,
        claimed.length > 0
          ? `✓ check:closing-target-claim: ${where}${leg} closes ${claimed.join(', ')}, and each carries a ` +
            `\`Claim:\` whose \`Branch:\` line names \`${ctx.head}\`.`
          : `✓ check:closing-target-claim: ${where}${leg} binds no closing keyword to an open card.`,
        ...declined.map(
          (t) =>
            `  #${t.number} was not judged: ${t.verdict === TARGET_NOT_A_CARD ? 'it names a pull request, which carries no claim' : 'the card is already closed, so the merge closes nothing'}.`,
        ),
        ...(undetermined.length > 0
          ? [`  ${undetermined.length} closing target(s) could not be judged — see the UNDETERMINED warning(s) above.`]
          : []),
      ],
    };
  }

  const rows = unclaimed.map(
    (t) =>
      `  - \`${t.keyword} #${t.number}\` — no comment on #${t.number} is a \`Claim:\` whose \`Branch:\` ` +
      `line names \`${ctx.head}\`.`,
  );

  return {
    exit: EXIT_UNCLAIMED,
    lines: [
      ...undeterminedLines,
      `::error::${where} closes ${unclaimed.map((t) => `#${t.number}`).join(', ')} with no \`Claim:\` on ` +
        `the card naming \`${ctx.head}\``,
      '',
      `✗ check:closing-target-claim: ${where}${leg} is set to close a card that never recorded this branch`,
      '  as its claim.',
      '',
      ...rows,
      '',
      '  Why this is blocking rather than advisory: every agent here shares one GitHub identity, so the',
      '  assignee field is a presence bit and the `Claim:` comment is the only identity record on the',
      '  board. With no claim naming this branch, nothing on that card stopped a second seat taking it —',
      '  and that has cost a whole duplicated dev round twice, once 29 minutes apart and once twice in one',
      '  morning. Both were visible to the patrol row that asks this question AFTER the merge, and stopped',
      '  by nothing.',
      '',
      '  Remedy, in order of preference:',
      `    1. Post the claim on the card, in the fixed spelling: a comment whose FIRST line begins`,
      `       \`Claim:\` and which carries a \`Branch:\` line naming \`${ctx.head}\`. The separator is one`,
      '       ASCII colon — a dash-written or fullwidth-written claim is a malformed claim, not a dialect,',
      '       and widening the reader is the one repair the 2026-08-11 ruling closes. The comment threads',
      '       are read LIVE on every run, so re-running this job after posting is enough: no push needed.',
      `    2. Claimed already, then RENAMED or RE-CREATED the branch? The old claim still names the old`,
      `       ref, which is why this is red. Re-post the claim naming the current branch, \`${ctx.head}\`.`,
      '    3. Not this card\'s implementation? Drop the closing keyword and write `Part of #N` instead —',
      '       a `Part of` target is not a closing target and this gate never reads it. Editing the body',
      '       fires a fresh event, so that route goes green with no push and no re-run.',
      '',
      '  ⛔ Do not take the card away from whoever holds it. A `Claim:` from another session or branch',
      '     means TAKEN, whatever the assignee field says.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Collection — the only part that touches the network.
//
// The cheap question first: a body binding no closing keyword makes zero calls.
// Then, per target, one comment page; the classifying read happens ONLY on the
// path that is about to go red.
// ---------------------------------------------------------------------------

/**
 * Every comment body on one card, and whether the thread was walked to its end.
 *
 * `complete: false` is never folded into the answer: a claim that would be on
 * page 11 is indistinguishable here from a claim that was never written, and
 * the two have opposite verdicts.
 */
async function listIssueComments(api, repo, number) {
  const bodies = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const batch = await api(`/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    for (const comment of batch) bodies.push(comment?.body ?? '');
    if (batch.length < 100) return { bodies, complete: true };
  }
  return { bodies, complete: false };
}

/**
 * Resolve every closing target of this PR's body to exactly one verdict.
 *
 * `api` returns parsed JSON or throws; `apiOrNull` turns a throw into a
 * declared UNDETERMINED rather than an unhandled rejection, because a transport
 * hiccup is not something a PR author did.
 */
export async function collect(ctx, api) {
  const apiOrNull = async (path) => {
    try {
      return await api(path);
    } catch {
      return null;
    }
  };

  let body = ctx.body;
  let head = ctx.head;
  if (ctx.source === 'merge_group') {
    const pr = await apiOrNull(`/repos/${ctx.repo}/pulls/${ctx.number}`);
    if (!pr) {
      return {
        ...ctx,
        unreadable:
          `the merge-queue ref named PR #${ctx.number} but that pull request could not be read`,
      };
    }
    body = pr.body ?? '';
    head = String(pr.head?.ref ?? '').trim();
    if (!head) {
      return { ...ctx, unreadable: `PR #${ctx.number} reported no head branch, and the head branch IS the question` };
    }
  }

  const targets = [];
  for (const [number, keyword] of closingKeywordTargets(body ?? '')) {
    let bodies = null;
    let complete = true;
    try {
      const walked = await listIssueComments(api, ctx.repo, number);
      bodies = walked.bodies;
      complete = walked.complete;
    } catch {
      targets.push({ number, keyword, verdict: TARGET_UNDETERMINED, why: 'its comment thread could not be read' });
      continue;
    }

    if (h46ClaimNamesBranch(bodies, head)) {
      targets.push({ number, keyword, verdict: TARGET_CLAIMED });
      continue;
    }
    if (!complete) {
      targets.push({
        number,
        keyword,
        verdict: TARGET_UNDETERMINED,
        why: `its thread is longer than ${MAX_COMMENT_PAGES} pages of 100 comments`,
      });
      continue;
    }

    // Only now — on the path about to accuse someone — is the second read spent.
    const issue = await apiOrNull(`/repos/${ctx.repo}/issues/${number}`);
    if (!issue) {
      targets.push({ number, keyword, verdict: TARGET_UNDETERMINED, why: 'the number itself could not be read' });
      continue;
    }
    if (issue.pull_request) {
      targets.push({ number, keyword, verdict: TARGET_NOT_A_CARD });
      continue;
    }
    if (issue.state !== 'open') {
      targets.push({ number, keyword, verdict: TARGET_CLOSED });
      continue;
    }
    targets.push({ number, keyword, verdict: TARGET_UNCLAIMED });
  }

  return { ...ctx, body, head, targets };
}

const githubApi = (token) => async (path) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
};

// ---------------------------------------------------------------------------
// Self-test — the verdict layer, the exit-code contract, the collection policy
// over a fake transport, and the wiring.
//
// The two predicates this gate reuses are tested where they live; what is
// pinned here is that this gate really DELEGATES to them rather than carrying a
// second copy of either, that both halves of the acceptance pair hold (a
// correct claim is GREEN, a claim naming another branch is RED), that the
// negative controls add no output at all, and that the queue leg exists and
// ends in the same judgement as the pull-request leg.
// ---------------------------------------------------------------------------

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798).
let selfTestReachedVerdict = false;

/** A fake transport: a route table plus a call log, so cost is an assertion and not a claim. */
function fakeApi(routes) {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (key === undefined) throw new Error(`no route for ${path}`);
    const value = routes[key];
    if (value instanceof Error) throw value;
    return value;
  };
  return { api, calls };
}

async function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => {
    registerCase();
    return cases.push([name, actual, expected]);
  };

  const HEAD = 'claude/issue-15845-claim-comment-pr-gate';
  const OTHER = 'claude/issue-15845-someone-else';
  const claim = (ref) => ({ body: `Claim: session_0deadbeef\nBranch: \`${ref}\`` });
  const ctxOf = (patch) => ({
    source: 'pull_request',
    number: '900',
    repo: 'o/r',
    token: 't',
    body: '',
    head: HEAD,
    targets: [],
    ...patch,
  });
  const verdict = (patch) => judge(ctxOf(patch));
  const text = (v) => v.lines.join('\n');

  // Collection over the fake transport, so both the VERDICT and the CALL COST
  // are measured rather than asserted in prose.
  const run = async (body, routes, patch = {}) => {
    const { api, calls } = fakeApi(routes);
    const collected = await collect(ctxOf({ body, targets: undefined, ...patch }), api);
    return { verdict: judge(collected), calls, collected };
  };

  // --- The acceptance pair. Red and GREEN, because a probe tested only on its
  // red half has not been shown to reach the card at all.
  battery('The acceptance pair. Red and GREEN, because a probe tested only on its');
  const green = await run('Closes #15845', { '/repos/o/r/issues/15845/comments': [claim(HEAD)] });
  t('a card carrying a `Claim:` that names this head branch is CLEAN', green.verdict.exit, EXIT_CLEAN);
  t('…and the clean line names the card it verified', text(green.verdict).includes('#15845'), true);
  t('…and it cost exactly one comment page — the card\'s stated bound', green.calls.length, 1);
  t('…with no classifying read spent on a card that is fine', green.calls.some((c) => c === '/repos/o/r/issues/15845'), false);

  const red = await run('Closes #15845', {
    '/repos/o/r/issues/15845/comments': [claim(OTHER)],
    '/repos/o/r/issues/15845': { state: 'open', number: 15845 },
  });
  t('a card whose only `Claim:` names ANOTHER branch is a FINDING', red.verdict.exit, EXIT_UNCLAIMED);
  t('…and the red path costs one comment page plus ONE classifying read, never more', red.calls.length, 2);
  t('a card with NO claim comment at all is a FINDING', (await run('Closes #15845', {
    '/repos/o/r/issues/15845/comments': [{ body: 'Triage: p2.' }],
    '/repos/o/r/issues/15845': { state: 'open', number: 15845 },
  })).verdict.exit, EXIT_UNCLAIMED);
  t('an EMPTY thread is a FINDING too — nothing there claims anything', (await run('Closes #15845', {
    '/repos/o/r/issues/15845/comments': [],
    '/repos/o/r/issues/15845': { state: 'open', number: 15845 },
  })).verdict.exit, EXIT_UNCLAIMED);

  // --- The negative controls: a PR that closes nothing and a PR that is only
  // `Part of` a card must be UNAFFECTED, and must add no output of their own.
  battery('The negative controls: a PR that closes nothing and a PR that is only');
  const nothing = await run('An ordinary body with no card relation at all.', {});
  t('a PR that closes nothing is clean', nothing.verdict.exit, EXIT_CLEAN);
  t('…and makes ZERO API calls', nothing.calls.length, 0);
  t('…and emits no error annotation', text(nothing.verdict).includes('::error::'), false);
  t('…and emits no warning annotation', text(nothing.verdict).includes('::warning::'), false);

  const partOf = await run('Part of #15845 — the gate half lands separately.', {});
  t('a PR carrying only `Part of` is clean', partOf.verdict.exit, EXIT_CLEAN);
  t('…and makes ZERO API calls, so a `Part of` target is never even read', partOf.calls.length, 0);
  t('…and the clean line says `Part of` is not a closing target', text(partOf.verdict).includes('`Part of #N`'), true);

  // --- Delegation, not a second copy of the rule. The targets and the claim
  // predicate are the shipped ones; a fork would pass the cases above and drift
  // from the sweep on the next grammar move.
  battery('Delegation, not a second copy of the rule. The targets and the claim');
  const grammar = ['Closes #1', 'Fixes: #2', 'Part of #3', 'resolved #4', '', 'Part of #5\n\nFixes #6'];
  const collectedNumbers = [];
  for (const body of grammar) {
    const { api } = fakeApi({ '/repos/o/r/issues/': [] });
    const out = await collect(ctxOf({ body, targets: undefined }), api);
    collectedNumbers.push((out.targets ?? []).map((row) => String(row.number)));
  }
  t(
    'the target set is exactly `closingKeywordTargets` over every fixture (no forked grammar)',
    collectedNumbers,
    grammar.map((body) => [...closingKeywordTargets(body)].map(([n]) => String(n))),
  );
  t('…which for `Part of #3` alone is the empty set', collectedNumbers[2], []);
  t('…and for a body that is `Part of` one card while closing another, only the closed one', collectedNumbers[5], ['6']);

  const claimFixtures = [[claim(HEAD).body], [claim(OTHER).body], ['Claim: no branch line here'], ['ordinary prose'], []];
  const delegated = [];
  for (const bodies of claimFixtures) {
    const { api } = fakeApi({
      '/repos/o/r/issues/15845/comments': bodies.map((body) => ({ body })),
      '/repos/o/r/issues/15845': { number: 15845, state: 'open' },
    });
    const out = await collect(ctxOf({ body: 'Closes #15845', targets: undefined }), api);
    delegated.push(out.targets[0].verdict === TARGET_CLAIMED);
  }
  t(
    'a target is CLAIMED exactly when the shipped `h46ClaimNamesBranch` says so (no forked predicate)',
    delegated,
    claimFixtures.map((bodies) => h46ClaimNamesBranch(bodies, HEAD)),
  );
  t(
    'the documented blockquote claim reads, unrespelled',
    (await run('Closes #15845', { '/repos/o/r/issues/15845/comments': [{ body: `> Claim: wave 9\n> Branch: \`${HEAD}\`` }] })).verdict.exit,
    EXIT_CLEAN,
  );
  t(
    '…and so do the shipped `Claimed:` / `Branches:` spellings',
    (await run('Closes #15845', { '/repos/o/r/issues/15845/comments': [{ body: `Claimed: x\nBranches: \`${HEAD}\`` }] })).verdict.exit,
    EXIT_CLEAN,
  );

  // --- The failure has to carry the card, the branch and every remedy — the
  // card's own requirement, and triage's branch-rename edge is one of them.
  battery('The failure has to carry the card, the branch and every remedy — the');
  const failed = text(red.verdict);
  t('the failure names the CARD', failed.includes('#15845'), true);
  t('the failure names the BRANCH', failed.includes(HEAD), true);
  t('the failure names the keyword that bound it', failed.includes('`Closes #15845`'), true);
  t('remedy 1 — post the claim in the fixed spelling', failed.includes('FIRST line begins'), true);
  t('remedy 1 names the `Branch:` line the claim must carry', failed.includes('`Branch:` line naming'), true);
  t('remedy 2 — the RENAMED/RE-CREATED branch case, named rather than discovered', failed.includes('RENAMED or RE-CREATED'), true);
  t('remedy 3 — drop the closing keyword for `Part of`', failed.includes('`Part of #N`'), true);
  t('the failure is annotated for the GitHub UI', failed.includes('::error::'), true);

  // --- Declined numbers. A closing keyword can bind something that is not an
  // open card, and accusing its author would make this gate noise on day one.
  battery('Declined numbers. A closing keyword can bind something that is not an');
  const prTarget = await run('Closes #16700', {
    '/repos/o/r/issues/16700/comments': [],
    '/repos/o/r/issues/16700': { number: 16700, state: 'open', pull_request: { url: 'x' } },
  });
  t('a closing keyword bound to a PULL REQUEST is not a finding', prTarget.verdict.exit, EXIT_CLEAN);
  t('…and the clean line SAYS the number was declined, rather than staying silent', text(prTarget.verdict).includes('names a pull request'), true);

  const closedCard = await run('Closes #15667', {
    '/repos/o/r/issues/15667/comments': [],
    '/repos/o/r/issues/15667': { number: 15667, state: 'closed' },
  });
  t('a closing keyword bound to an already-CLOSED card is not a finding', closedCard.verdict.exit, EXIT_CLEAN);
  t('…and the clean line says why it was declined', text(closedCard.verdict).includes('already closed'), true);
  t('the classifying read is spent, and only here', closedCard.calls.includes('/repos/o/r/issues/15667'), true);
  t('…so a declined number costs exactly two reads and never more', closedCard.calls.length, 2);

  // --- UNDETERMINED is its own answer: never clean, never an accusation.
  battery('UNDETERMINED is its own answer: never clean, never an accusation.');
  const unreadableThread = await run('Closes #15845', { '/repos/o/r/issues/15845/comments': new Error('boom') });
  t('a thread that could not be read is NOT a finding', unreadableThread.verdict.exit, EXIT_CLEAN);
  t('…and it is warned about rather than folded into the clean answer', text(unreadableThread.verdict).includes('::warning::UNDETERMINED'), true);
  t('…and the warning names the branch it could not prove anything about', text(unreadableThread.verdict).includes(HEAD), true);

  const unreadableNumber = await run('Closes #15845', { '/repos/o/r/issues/15845/comments': [] });
  t('a number whose own read fails is UNDETERMINED, not unclaimed', unreadableNumber.verdict.exit, EXIT_CLEAN);
  t('…and says so', text(unreadableNumber.verdict).includes('UNDETERMINED'), true);
  t('the page walk is capped, so an endless thread cannot hang the job', MAX_COMMENT_PAGES > 0 && MAX_COMMENT_PAGES <= 20, true);

  // --- Wiring absent: never clean, never an accusation.
  battery('Wiring absent: never clean, never an accusation.');
  const unwired = judge(readPrContext({}));
  t('no context at all exits NOT MEASURED', unwired.exit, EXIT_NOT_WIRED);
  t('NOT MEASURED says it judged nothing', text(unwired).includes('judged nothing'), true);
  t('NOT MEASURED does not read as a clean board', text(unwired).includes('✓'), false);
  t('an empty repo slug is NOT WIRED, never a request to /repos//…', judge(readPrContext({ PR_NUMBER: '1', GITHUB_REPOSITORY: '' })).exit, EXIT_NOT_WIRED);
  t('…and the reason names the variable', text(judge(readPrContext({ PR_NUMBER: '1', GITHUB_REPOSITORY: '' }))).includes('GITHUB_REPOSITORY'), true);
  t('an empty token is NOT WIRED', judge(readPrContext({ PR_NUMBER: '1', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: '' })).exit, EXIT_NOT_WIRED);
  t(
    'a missing head ref is NOT WIRED — the head branch IS the question, so a blank one cannot be judged',
    judge(readPrContext({ PR_NUMBER: '1', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', PR_BODY: 'Closes #2' })).exit,
    EXIT_NOT_WIRED,
  );
  t('…and it says which variable, so the fix is one line', text(judge(readPrContext({ PR_NUMBER: '1', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }))).includes('PR_HEAD_REF'), true);
  t('PR_NUMBER is read by PRESENCE, so an empty one is still a wired witness', readPrContext({ PR_NUMBER: '', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', PR_HEAD_REF: HEAD })?.number, '');
  t('an absent body reads as the empty string', readPrContext({ PR_NUMBER: '7', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', PR_HEAD_REF: HEAD })?.body, '');
  t('an unset environment is not wired', readPrContext({}), null);
  t('the NOT MEASURED text carries a runnable local spelling', text(unwired).includes('PR_HEAD_REF=claude/issue-123-slug'), true);

  // --- The merge-queue leg, asserted rather than assumed.
  battery('The merge-queue leg, asserted rather than assumed.');
  const queueEnv = {
    MERGE_GROUP_HEAD_REF: 'refs/heads/gh-readonly-queue/main/pr-900-abcdef1234567890abcdef1234567890abcdef12',
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_TOKEN: 't',
  };
  const queueCtx = readPrContext(queueEnv);
  t('a merge_group ref alone is a WIRED context', queueCtx?.source, 'merge_group');
  t('…and the PR number is read by the shipped queue-ref parser, not a second regex', queueCtx?.number, String(pullNumberFromQueueRef(queueEnv.MERGE_GROUP_HEAD_REF)));
  t('a base branch containing a slash is still read (the shipped parser\'s own lesson)', pullNumberFromQueueRef('refs/heads/gh-readonly-queue/release/v5/pr-7-abcdef1'), 7);
  t('a ref that is NOT a queue ref is NOT WIRED, never a PR number invented from a branch name', judge(readPrContext({ ...queueEnv, MERGE_GROUP_HEAD_REF: 'refs/heads/pr-12-abcdef1' })).exit, EXIT_NOT_WIRED);

  const queueApi = fakeApi({
    '/repos/o/r/pulls/900': { number: 900, body: 'Closes #15845', head: { ref: HEAD } },
    '/repos/o/r/issues/15845/comments': [claim(HEAD)],
  });
  const queueGreen = judge(await collect(queueCtx, queueApi.api));
  t('the queue leg reads the SAME PR body and goes green on a correct claim', queueGreen.exit, EXIT_CLEAN);
  t('…and says it is a merge-queue build, so a reader can tell the legs apart', text(queueGreen).includes('merge-queue build'), true);

  const queueRedApi = fakeApi({
    '/repos/o/r/pulls/900': { number: 900, body: 'Closes #15845', head: { ref: HEAD } },
    '/repos/o/r/issues/15845/comments': [claim(OTHER)],
    '/repos/o/r/issues/15845': { number: 15845, state: 'open' },
  });
  const queueRed = judge(await collect(queueCtx, queueRedApi.api));
  t('…and the queue leg reaches the SAME finding as the pull_request leg', queueRed.exit, EXIT_UNCLAIMED);
  t('…with the same remedies, because it is the same verdict layer', text(queueRed).includes('RENAMED or RE-CREATED'), true);

  const queueBroken = judge(await collect(queueCtx, fakeApi({}).api));
  t('a queue ref whose pull request cannot be read is NOT MEASURED, never clean and never a finding', queueBroken.exit, EXIT_NOT_WIRED);

  // --- The wiring itself. A gate whose workflow step is deleted or whose
  // trigger loses a leg is not a weaker gate, it is a silent one.
  battery('The wiring itself. A gate whose workflow step is deleted or whose');
  const wiringPath = join(ROOT, WIRING_WORKFLOW);
  const wiring = existsSync(wiringPath) ? readFileSync(wiringPath, 'utf8') : '';
  t('the wiring workflow exists', wiring !== '', true);
  t('the wiring workflow runs this script', wiring.includes('node scripts/check-closing-target-claim.mjs'), true);
  t('the wiring declares the check-run name this file pins', wiring.includes(CHECK_CONTEXT_NAME), true);
  t('the wiring subscribes to body edits, so dropping the keyword can go green', /types:\s*\[[^\]]*\bedited\b[^\]]*\]/.test(wiring), true);
  t('the wiring subscribes to `synchronize`, so a re-pushed branch is re-judged', /types:\s*\[[^\]]*\bsynchronize\b[^\]]*\]/.test(wiring), true);
  t('the wiring takes the merge_group leg — the queue claim is wiring, not prose', /^\s{2}merge_group:\s*$/m.test(wiring), true);
  t('the wiring passes the head ref, without which nothing can be judged', /PR_HEAD_REF:/.test(wiring), true);
  t('the wiring passes the merge-queue head ref', /MERGE_GROUP_HEAD_REF:/.test(wiring), true);
  t('everything reaches the script through `env:`, never through shell interpolation', /env:[\s\S]{0,400}?PR_BODY:/.test(wiring), true);
  const wiringCommands = wiring.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  t('the guard job invokes no package manager (it needs node and nothing else)', /\b(pnpm|corepack|yarn|npm)\b/.test(wiringCommands), false);

  // --- The predicate sources this gate reuses must still be there to reuse.
  battery('The predicate sources this gate reuses must still be there to reuse.');
  for (const source of PREDICATE_SOURCES) t(`the predicate source ${source} exists`, existsSync(join(ROOT, source)), true);
  t('both predicate sources are declared, so a move reddens here', PREDICATE_SOURCES.length, 2);

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push([message, false, true]);

  let failedCount = 0;
  for (const [name, actual, expected] of cases) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failedCount++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  }
  if (failedCount) {
    console.error(`✗ check-closing-target-claim self-test: ${failedCount} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-closing-target-claim self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

// The basename comparison, as in the siblings: this file is imported by nothing
// today, but a future importer must not trigger a judgment as a side effect.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-closing-target-claim self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    const ctx = readPrContext(process.env);
    const collected = ctx === null || ctx.wired === false ? ctx : await collect(ctx, githubApi(ctx.token));
    const result = judge(collected);
    const emit = result.exit === EXIT_CLEAN ? console.log : console.error;
    for (const line of result.lines) emit(line);
    process.exit(result.exit);
  }
}
