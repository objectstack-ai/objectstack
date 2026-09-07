#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:partof-closing-keyword — the PR-scoped BLOCKING guard over BOTH the
 * surfaces GitHub's reference parser reads when a pull request merges.
 *
 *   RULE 1 — THE BODY. A pull request may not declare itself only `Part of #N`
 *   while also telling GitHub to close that same `#N`. This is the half-state
 *   sweep's H7, called.
 *
 *   RULE 2 — THE COMMIT MESSAGES. No commit on the pull request may carry a
 *   card-relation trailer at all: no closing keyword, no Part-of and no Refs
 *   bound to any card number. The body is the only carrier of the relation.
 *
 *   node scripts/check-partof-closing-keyword.mjs              # judge this PR (CI)
 *   node scripts/check-partof-closing-keyword.mjs --self-test  # verify it offline
 *
 * ⚠️ Repo paths are named UNQUOTED in this header on purpose. See the last
 * section for the measurement that forces it.
 *
 * ## The defect this blocks
 *
 * A half-delivered card was closed `completed` two seconds after its PR merged,
 * although that PR body opened with the words Part of and carried an explicit
 * warning against auto-closing the card. The warning sentence read, verbatim:
 * "…the PM should close #8131 deliberately once #8136 lands." GitHub's
 * closing-keyword parser matches the keyword plus the number and ignores every
 * bit of the surrounding prose — the modal, the negation in the clause before
 * it, the whole paragraph arguing the card must stay open. The sentence written
 * to PREVENT the auto-close is what performed it, and a closed card reads as
 * finished, so the loss was found only by a post-merge inventory re-pull.
 *
 * Habit is what failed there: the author wrote the warning correctly and still
 * lost the card. Only a mechanical comparison at PR time catches a mistake that
 * reads as natural English.
 *
 * ## Why this is a SEPARATE check and not a mode flip of the sweep
 *
 * scripts/pm/check-half-states.mjs enumerates H1–H7 and is deliberately
 * report-only: H1–H6 are facts about a live, shared BOARD, and failing an
 * unrelated PR over board state punishes the wrong actor. H7 is the one item
 * that is a fact about THE PR BEING CHECKED, so gating on it here contradicts
 * nothing the sweep argues. H7 also stays in the sweep — patrol coverage of the
 * same fact, on PRs whose CI predates this gate — and the sweep keeps its own
 * exit-0-always contract untouched. Two consumers, one predicate, no fork: the
 * verdict below is the sweep's exported h7PartOfWithClosingKeyword, called.
 *
 * The sweep is also unrunnable in most agent containers (its transport section
 * measures three container classes, only one of which can reach the API), so
 * patrol alone guards nothing in the place where PR bodies are written.
 *
 * ## Where the body comes from, and why it is not an API read
 *
 * The wiring workflow hands this script the body through the ENVIRONMENT, out
 * of the pull_request event payload. Two consequences worth stating, because
 * the alternative (a live GET of the PR) is the obvious-looking design:
 *
 *   1. There is no HTTP call in the judging path, so the whole "API hiccup"
 *      failure class does not exist here — not by policy, by construction. The
 *      only inputs are two environment variables.
 *   2. A payload is a frozen snapshot, and this repo has measured what that
 *      costs when the fix for a red gate is an edit GitHub does not re-deliver:
 *      a re-run replays the SAME payload, so the run stays red forever. That is
 *      why the wiring workflow subscribes to the `edited` activity type — an
 *      author who rewords the sentence gets a fresh event with a fresh payload
 *      and a green run, with no push and no re-run. The identical trigger set
 *      and the identical reason are already in the duplicate-fix guard, the
 *      repo's other PR-body-scoped blocking check; this follows it rather than
 *      inventing a second shape.
 *
 * The residual hole is named rather than hidden: `rerun_failed_jobs` on a run
 * whose body has since been fixed replays the stale body and stays red. The
 * remedy is to edit the body (which fires a new run), not to re-run.
 *
 * ## RULE 2 — why a commit trailer is a defect even when it is TRUE
 *
 * This repository squash-merges, so the commit that lands on the default branch
 * is ASSEMBLED AT MERGE TIME by concatenating the branch's commit messages.
 * Each of those was written at a different moment about a different slice of
 * the work, and each can be perfectly honest on its own; the concatenation is
 * written by nobody and reviewed by nobody.
 *
 * Measured on the squash of PR 16247, commit fc3fb7c4619, an ancestor of the
 * default branch: three bullets assembled from three commit messages, a closing
 * trailer for a card sitting inside the first bullet's body, and a third bullet
 * that retracts a claim the first bullet still makes. The landed message
 * therefore asserts and withdraws the same thing in one text, and it told
 * GitHub to close the card from inside a bullet nobody read as a declaration.
 *
 * Note what RULE 1 cannot see there: the contradictory text existed in no body,
 * so the body was clean — correctly so. The sweep's H23 reads this surface, but
 * AFTER the fact, on the default branch, and it binds narrower: it reports only
 * the Part-of-plus-closing-keyword CONTRADICTION, and the specimen above
 * carries no Part-of at all, so H23 is silent on exactly this shape.
 *
 * RULE 2 is the pre-merge, blocking, strictly WIDER statement, and the width is
 * what makes it enforceable. "Trailers that would contradict each other once
 * concatenated" cannot be judged commit by commit, because the contradiction is
 * a property of the assembly, which does not exist until the merge button. "No
 * relation trailer in any commit" is a property of ONE commit, so one commit is
 * enough to judge — and an assembly cannot manufacture what none of its inputs
 * contain. Squash is not the only cost either: the trailers are also live on
 * their own, so a branch pushed to the default branch by any other route closes
 * the cards its intermediate commits name.
 *
 * The remedy is the contract this repository already carries, cited rather than
 * restated — the card relation is declared ONCE, in the PR body, and the merger
 * takes the squash message from that body. ⛔ Nothing in this gate's output asks
 * anyone to rewrite history: amend, rebase and force-push are forbidden here,
 * and a red on an already-pushed branch is repaired the way this repo's merges
 * already repair it, in the body and at the merge.
 *
 * ## Where the commit messages come from, and why the endpoint and not a walk
 *
 * The WORKFLOW gathers them and hands them over as data, so the judging path
 * stays HTTP-free by construction exactly as it is for the body: this script
 * still makes no request, and its inputs are still only the environment and, now,
 * a file the environment names.
 *
 * The gather is one paginated REST read of the pull request's own commits list,
 * chosen over a git walk for a measured reason. That endpoint returns exactly
 * the set GitHub will squash. The git equivalent needs the merge base present in
 * order to exclude what is already on the default branch, and this job checks
 * out at depth 1 — so on a branch that has merged the default branch back in, a
 * shallow walk cannot perform that exclusion and reports ANOTHER author's landed
 * trailers as this pull request's. The alternatives are a deepen-until-found
 * loop, which is unbounded, or a full-history clone to read a handful of
 * messages. The endpoint is bounded, exact, and needs one added read scope.
 *
 * The list reaches the script as a FILE named in the environment, not as a value
 * in it. Commit messages carry newlines, blank lines and quotes; JSON Lines
 * through a file keeps that payload out of the shell and out of the environment
 * block, which is the same argument the body's `env:` spelling rests on, applied
 * to a payload too big and too multi-line to be an environment value.
 *
 * ## Exit codes — and why an empty body is a VERDICT, not a skip
 *
 *   0  judged, clean — BOTH rules, over inputs that were really read.
 *   1  judged, finding. The PR is red until the body is reworded (RULE 1) or
 *      the relation is moved out of the commits and into the body (RULE 2).
 *   2  NOT WIRED — an input this gate judges is missing, so a rule verified
 *      nothing. A usage/wiring failure, never a statement about any PR.
 *
 * Exit 2 covers no PR context at all AND the case where the body arrived but
 * the commit list did not. That second one is deliberate and is the whole
 * presence semantics of RULE 2: a wiring that forgot the commits has not seen a
 * clean commit history, it has seen no commit history, and the two must never
 * print the same line. An empty commit list is read the same way rather than as
 * a clean PR with nothing in it — every pull request has at least one commit,
 * so zero rows means the gather failed, not that the author pushed nothing.
 *
 * The precedence when both apply — a real finding and a half-wired run — is
 * FINDING first, because a finding is a true statement about an input that was
 * really read, while exit 2 claims nothing was judged. The unread half is still
 * named in the output, so a run can never quietly drop the fact that it read
 * only one of the two surfaces.
 *
 * The split matters in both directions. A gate that cannot read its input has
 * verified nothing, and exiting 0 there is the anti-pattern this repo keeps
 * paying for: a check that skips silently reads as "no violations". But the
 * inverse is a real cost too — a mis-wired gate must not read as "this PR is
 * guilty", because it would be red on every PR at once for something no author
 * did. Exit 2 says which of the two it is, in its own words.
 *
 * A PR with an EMPTY body is neither of those. It demonstrably contains no
 * Part-of declaration, so it cannot contain the contradiction, and passing it
 * is a real judgment of a real (if terse) input. `PR_NUMBER` is what tells the
 * two apart: GitHub renders a null body as an EMPTY environment value, so
 * "empty body" and "variable absent" are indistinguishable on their own. When
 * either variable is present the run is wired, and an absent body is read as
 * the empty string it is.
 *
 * ## What this gate does NOT do
 *
 * It does not judge a closing keyword bound to a DIFFERENT card than the one
 * the body says it is only part of. `Part of #A` plus a real `Fixes #B` is a
 * correct, common shape — the actionable half of one card landing while another
 * is genuinely closed — and the predicate binds per issue number precisely so
 * that stays green.
 *
 * It also does not decide branch protection. This publishes a red check run;
 * whether that check run becomes a REQUIRED context is a settings change no
 * agent seat can make — the seat reads the repository as a non-admin
 * (permissions.admin false) — and, per the required-context registry
 * convention, one that carries a maintainer ruling. ⚠️ Not-writable is the
 * claim here, and only that: the required set is READABLE from an ordinary
 * seat (the rulesets API answers 200; it is the classic branch-protection
 * endpoint that answers 403, and this repo does not use classic branch
 * protection — #9642, which retired that conflation elsewhere in this tree).
 * The duplicate-fix guard sits in exactly the same position.
 *
 * ## Why the paths above are unquoted
 *
 * The dispatch-gates derivation resolves a check family to its script file and
 * scans THAT FILE for quoted path literals — its watch hints — and the scan
 * reads comments and self-test fixtures too (an open card proposes masking
 * them; it has not landed). Written the ordinary way, with each path in
 * backticks, a header like this one yields a hint per path and fabricates
 * MATCHED leads for cards that touch none of this. So paths are named unquoted
 * in prose here, and the only quoted paths in this file are the real inputs
 * below. The self-test's fixtures are safe by a different mechanism, worth
 * knowing rather than re-deriving: a hint must be a single unbroken token, and
 * every fixture string here is prose with spaces, so none of them can become
 * one.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// The relation extractors are the sweep's, imported and not re-spelled. Two
// things ride on that beyond the usual no-fork argument. GitHub's
// closing-keyword grammar is spelled in three places in this tree and a parity
// gate holds those three behaviourally equal; a FOURTH spelling here would be a
// fourth thing to keep in step, and it would be the one nobody remembers when
// the grammar next moves. And the `markdown: false` reading these are called
// with is itself a measured contract — a commit message is not markdown, so
// backticks do not neutralise a keyword there — which is the sweep's H23
// section, not a call this gate is entitled to re-make.
import {
  closingKeywordTargets,
  h7PartOfWithClosingKeyword,
  partOfTargets,
  refsTargets,
} from './pm/check-half-states.mjs';
import { isEntrypoint } from './invoked-as.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// This self-test used to decide success by "no failure was recorded" and
// nothing else, so "every case held" and "the cases never ran" printed the same
// line. Closed the way PR #13487 validated on check-doc-authoring: what is
// pinned is the registered NAMES, not a number. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3 keeps
// a total "right" the moment a sibling grows. A set difference says WHICH
// battery stopped; a count says only that something did.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
//
// The machinery lives HERE, at module scope, rather than inside the self-test:
// this self-test's assertion sink is not a block-bodied helper in its body (it
// is a concise arrow, or a module-scope function), so there is no in-body
// helper to thread a per-run ledger through. Module scope is safe because the
// self-test runs once per process, and it is what lets the existing sink route
// through `registerCase()` with no case rewritten and no assertion changed.
const SELF_TEST_BATTERIES = Object.freeze({
  'The measured arms. All three were read live on one throwaway PR, in one': 3,
  'The shapes that must stay green, so the gate does not tax correct PRs.': 4,
  'Delegation, not a second copy of the rule. Every body above must get': 1,
  'The failure message must carry the approved rewordings. This is the': 4,
  'Empty body: a verdict about a real input, and it must SAY so rather': 2,
  'Wiring absent: never clean, never a verdict about a PR.': 3,
  'Context reading: presence, not truthiness.': 4,
  'The wiring itself. A gate whose workflow step is deleted or whose': 6,
  'The predicate source this gate reuses must still be there to reuse.': 1,
  'RULE 2 — every card-relation spelling in a commit message is a finding,': 13,
  'The regression fixture: the squash that assembled a contradiction no': 4,
  'RULE 2 delegates to the sweep extractors at the commit-message reading.': 3,
  'The commit list input. An absent, broken or empty list can never read': 8,
  'The verdict layer over two rules: precedence, and the unread half is': 5,
  'The wiring gathers the commit list and hands it over as a file path.': 5,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 15;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// ⚠️ None of these helpers is named with a self-test spelling, deliberately and
// on the record: `check:pm-dispatch-gates` anchors on a top-level declaration
// whose NAME spells self-test, and every such name owes a row in that gate's
// COMPOUND_ANCHOR_LEDGER. These are the battery ROSTER's machinery -- they hold
// no fixtures to mask and read no path literal -- so the accurate name is the
// one that says `battery`, not the one that would owe a ledger row for a role
// this code does not have.

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

/** The predicate's home — this gate reuses it and must move when it moves. */
const PREDICATE_SOURCE = 'scripts/pm/check-half-states.mjs';

/** The wiring that gives this gate a PR to judge. */
const WIRING_WORKFLOW = '.github/workflows/partof-closing-keyword-guard.yml';

export const EXIT_CLEAN = 0;
export const EXIT_CONTRADICTION = 1;
export const EXIT_NOT_WIRED = 2;

/** The env var naming the file the wiring writes the PR's commit list to. */
export const COMMITS_FILE_ENV = 'PR_COMMITS_FILE';

/**
 * The contract RULE 2's finding CITES. It is quoted, not restated: the sentence
 * is written down elsewhere in this repository, that copy is the authority, and
 * a gate that paraphrased it would become a second source for one rule — the
 * exact drift this file refuses elsewhere by importing its predicate instead of
 * copying it. Quoted verbatim, in its own language, because a translation of a
 * ruling is a rewrite of it.
 *
 * Named in prose rather than as a bare path literal on purpose: the
 * dispatch-gates derivation turns quoted path literals in this file into watch
 * hints, and a sentence with spaces in it cannot become one. The header's last
 * section is the authority on that.
 */
const RELATION_CONTRACT =
  'The contract is written down in the agent rules at .claude/agents/os-dev.md — '
  + '「PR 正文与 commit message 分开解析:卡片关系只在正文声明一次,commit ⛔ 不带卡片 trailer。'
  + 'squash 会把全部 commit message 连成一条落地,逐条诚实拼成的一条自相矛盾。」 '
  + '(The PR body and the commit messages are parsed separately: the card relation is declared ONCE, '
  + 'in the body, and a commit carries no card trailer.)';

/**
 * The commit rows the wiring gathered, as JSON Lines — one object per line,
 * `{ sha, message }`.
 *
 * A commit message is multi-line by nature and JSON escapes those newlines, so
 * one row really is one line and the format needs no separator of its own. A
 * malformed line is a PROBLEM and never a skipped row: a parser that silently
 * dropped what it could not read would shrink the population this rule judges
 * and report the survivors as the whole PR.
 */
export function parseCommitRecords(text) {
  const rows = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch (err) {
      return { problem: `line ${i + 1} of the commit list is not JSON — ${err.message}` };
    }
    if (typeof row?.sha !== 'string' || typeof row?.message !== 'string') {
      return { problem: `line ${i + 1} of the commit list has no string \`sha\` and \`message\`.` };
    }
    rows.push({ sha: row.sha, message: row.message });
  }
  return { rows };
}

/**
 * Every card-relation trailer one commit message carries, in a fixed order.
 *
 * All three relations, because all three are the PR body's to declare: a
 * closing keyword acts on merge, and Part-of and Refs are read by this repo's
 * own board tooling, so a commit carrying either tells the board something its
 * author only meant to tell the pull request. Read at `markdown: false` — see
 * the import note.
 */
export function commitRelations(message) {
  const found = [];
  for (const card of partOfTargets(message, { markdown: false })) found.push({ keyword: 'Part of', card });
  for (const card of refsTargets(message, { markdown: false }).keys()) found.push({ keyword: 'Refs', card });
  for (const [card, keyword] of closingKeywordTargets(message, { markdown: false })) found.push({ keyword, card });
  return found;
}

/** The commit's subject, trimmed to a length that keeps a log line readable. */
function commitSubject(message) {
  const first = String(message ?? '').split('\n', 1)[0].trim();
  return first.length > 72 ? `${first.slice(0, 69)}…` : first;
}

/**
 * RULE 2 — one finding sentence per offending commit, empty when clean.
 *
 * Per COMMIT rather than per relation: an author fixes a message, not a match,
 * and a commit carrying three trailers is one edit and should be one line.
 */
export function commitTrailerFindings(commits) {
  const findings = [];
  for (const commit of commits) {
    const relations = commitRelations(commit.message);
    if (relations.length === 0) continue;
    const sha = String(commit.sha ?? '').slice(0, 9) || '(unknown sha)';
    const carried = relations.map((r) => `\`${r.keyword} #${r.card}\``).join(', ');
    findings.push(
      `commit \`${sha}\` ("${commitSubject(commit.message)}") carries ${carried} in its message. ` +
        `This repo squash-merges, so every commit message on this PR is concatenated into the one ` +
        `message that lands on the default branch — a text no one writes and no one reviews, which ` +
        `carries every trailer its inputs carried and can contradict itself where its parts did not. ` +
        `The trailer is also live on its own. ${RELATION_CONTRACT} ` +
        `Remedy: move this relation into the PR body, where it is stated once, and take the squash ` +
        `message from that body at merge. ` +
        `⛔ Do NOT amend, rebase or force-push to remove it — rewriting pushed history is forbidden ` +
        `here, and it is not what fixes this.`,
    );
  }
  return findings;
}

/**
 * The PR context, or null when this process was handed none.
 *
 * Presence, not truthiness: an empty body is a legitimate input (see the exit
 * codes section) and `PR_NUMBER` is the witness that the workflow really ran
 * this step, whatever the body rendered to.
 */
export function readPrContext(env) {
  const wired = Object.hasOwn(env, 'PR_BODY') || Object.hasOwn(env, 'PR_NUMBER');
  if (!wired) return null;
  return {
    number: String(env.PR_NUMBER ?? '').trim(),
    body: env.PR_BODY ?? '',
    ...readCommits(env),
  };
}

/**
 * RULE 2's input: `{ commits }` when a list was really read, else
 * `{ commits: null, commitsProblem }` naming which way it was not.
 *
 * Every failure mode lands in `commitsProblem` rather than throwing, so that a
 * missing or broken commit list is REPORTED by the verdict layer as an unjudged
 * rule instead of killing the process with a stack trace that reads, to whoever
 * finds the red X, exactly like the gate itself being broken.
 *
 * The `readText` seam exists so the self-test drives every one of these arms
 * without a temp file; production passes the real reader.
 */
export function readCommits(env, readText = (p) => readFileSync(p, 'utf8')) {
  const path = env[COMMITS_FILE_ENV];
  if (typeof path !== 'string' || path.trim() === '') {
    return {
      commits: null,
      commitsProblem: `${COMMITS_FILE_ENV} names no file, so the PR's commit messages were never read.`,
    };
  }

  let text;
  try {
    text = readText(path.trim());
  } catch (err) {
    return { commits: null, commitsProblem: `${COMMITS_FILE_ENV} names ${path.trim()}, which could not be read — ${err.message}` };
  }

  const parsed = parseCommitRecords(text);
  if (parsed.problem) return { commits: null, commitsProblem: `the commit list at ${path.trim()} is malformed — ${parsed.problem}` };
  if (parsed.rows.length === 0) {
    return {
      commits: null,
      commitsProblem:
        `the commit list at ${path.trim()} is EMPTY. Every pull request has at least one commit, so this ` +
        'is a gather that failed, not a PR with nothing in it — and it must not be read as a clean commit history.',
    };
  }
  return { commits: parsed.rows, commitsProblem: null };
}

/**
 * The verdict: `{ exit, lines }`, pure, so the self-test drives it directly.
 *
 * The finding sentence is the sweep predicate's own, unedited. It already
 * carries the three approved rewordings, and keeping ONE wording source is what
 * stops the gate's advice and the protocol's advice from drifting apart.
 */
export function judge(ctx) {
  if (ctx === null) {
    return {
      exit: EXIT_NOT_WIRED,
      lines: [
        'check:partof-closing-keyword: NOT WIRED — neither PR_BODY nor PR_NUMBER is set, so this run',
        'was handed no pull request and judged nothing. This is a wiring or usage failure, NOT a',
        'verdict: it says nothing about whether any PR body contradicts itself, and no author caused it.',
        '',
        `Fix:  run it from the workflow that supplies the context (${WIRING_WORKFLOW}), or locally with`,
        `      PR_BODY="$(cat some-body.md)" ${COMMITS_FILE_ENV}=some-commits.jsonl \\`,
        '        node scripts/check-partof-closing-keyword.mjs',
      ],
    };
  }

  const where = ctx.number ? `PR #${ctx.number}` : 'this PR';
  const contradiction = h7PartOfWithClosingKeyword({ body: ctx.body });
  const commitFindings = ctx.commits ? commitTrailerFindings(ctx.commits) : [];

  // The unread half is named wherever it exists, on EVERY exit path — a run
  // that judged one surface must never present itself as one that judged both.
  const unread = ctx.commitsProblem ? [`  ⚠️ RULE 2 judged nothing: ${ctx.commitsProblem}`] : [];

  if (contradiction || commitFindings.length) {
    const lines = [];
    if (contradiction) {
      lines.push(
        `::error::${where} contradicts itself: ${contradiction}`,
        '',
        `✗ check:partof-closing-keyword: ${where} contradicts itself.`,
        '',
        `  ${contradiction}`,
        '',
        '  Why this is blocking rather than advisory: the card closes SILENTLY on merge, and a closed',
        '  card reads as finished — the one incident behind this gate was found only by a post-merge',
        '  inventory re-pull. Editing the body re-runs this check; no push and no re-run are needed.',
      );
    }
    if (commitFindings.length) {
      if (contradiction) lines.push('');
      for (const finding of commitFindings) lines.push(`::error::${finding}`);
      lines.push(
        '',
        `✗ check:partof-closing-keyword: ${commitFindings.length} commit message(s) on ${where} carry a`,
        '  card-relation trailer. The PR body is the only carrier of the relation.',
        '',
      );
      for (const finding of commitFindings) lines.push(`  ${finding}`, '');
      lines.push(
        '  Pushing the reworded commits re-runs this check. ⛔ The repair is NOT a history rewrite:',
        '  state the relation once in the PR body and take the squash message from that body at merge.',
      );
    }
    return { exit: EXIT_CONTRADICTION, lines: [...lines, ...(unread.length ? ['', ...unread] : [])] };
  }

  if (ctx.commitsProblem) {
    return {
      exit: EXIT_NOT_WIRED,
      lines: [
        `check:partof-closing-keyword: PARTLY WIRED — ${where}'s body was read and carries no Part-of/closing-keyword`,
        'contradiction, but its COMMIT MESSAGES were not read, so RULE 2 judged nothing. This is a wiring',
        'failure, NOT a verdict: reporting an unread commit history as a clean one is the exact shape this',
        'gate exists to refuse.',
        '',
        `  ${ctx.commitsProblem}`,
        '',
        `Fix:  run it from the workflow that supplies the context (${WIRING_WORKFLOW}), which writes the PR's`,
        `      commits as JSON Lines and names that file in ${COMMITS_FILE_ENV}.`,
      ],
    };
  }

  const what = ctx.body.trim() === '' ? 'has an empty body, which can carry no' : 'carries no';
  return {
    exit: EXIT_CLEAN,
    lines: [
      `✓ check:partof-closing-keyword: ${where} ${what} Part-of/closing-keyword contradiction, and its`,
      `  ${ctx.commits.length} commit message(s) carry no card-relation trailer.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Self-test — the verdict layer, the exit-code contract, and the wiring.
//
// The predicate itself is the sweep's and is tested there; what is pinned here
// is (a) that this gate really delegates to it rather than carrying a second
// copy of the rule, (b) the three code-formatting arms as MEASURED live, and
// (c) that the wiring which feeds this gate still exists and still carries the
// activity type without which a reworded body can never go green.
// ---------------------------------------------------------------------------

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-partof-closing-keyword self-test reached its verdict';

function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => {
    registerCase();
    return cases.push([name, actual, expected]);
  };
  // Every RULE 1 case below judges a BODY, so each is handed a commit list that
  // is present and clean. Without one they would all exit 2 on the unread half
  // and stop testing the thing they were written to test — and the day that
  // happened they would still print, which is what the battery floor is for.
  const CLEAN_COMMITS = [{ sha: 'a1b2c3d4e5f60718', message: 'chore(ci): a subject carrying no card relation\n\nBody prose.\n' }];
  const verdict = (body, number = '1') => judge({ number, body, commits: CLEAN_COMMITS, commitsProblem: null });
  /** A verdict over COMMITS, with a body that is clean under RULE 1. */
  const commitVerdict = (...messages) =>
    judge({
      number: '1',
      body: 'A body with no relation declared in it.',
      commits: messages.map((message, i) => ({ sha: `${i}0deadbeef1234567`, message })),
      commitsProblem: null,
    });

  // --- The measured arms. All three were read live on one throwaway PR, in one
  // body, at one moment, with the PR OPEN and unmerged: the plain-prose target
  // gained a closing link within seconds, and the fenced and inline targets
  // gained none. The predicate strips code before scanning; these three cases
  // are that measurement, kept executable.
  battery('The measured arms. All three were read live on one throwaway PR, in one');
  t(
    'plain prose beside a Part-of declaration is a finding (the incident specimen)',
    verdict('Part of #8131 — the PM should close #8131 deliberately once #8136 lands.').exit,
    EXIT_CONTRADICTION,
  );
  t(
    'a closing keyword inside a FENCED block is not a finding (measured 2026-08-13)',
    verdict('Part of #8520\n\n```text\nFixes #8520\n```\n').exit,
    EXIT_CLEAN,
  );
  t(
    'a closing keyword inside an INLINE span is not a finding (measured 2026-08-13)',
    verdict('Part of #8521 — the dispatch asked for `Fixes #8521`, which is deliberately not used.').exit,
    EXIT_CLEAN,
  );

  // --- The shapes that must stay green, so the gate does not tax correct PRs.
  battery('The shapes that must stay green, so the gate does not tax correct PRs.');
  t(
    'Part of one card while genuinely closing another is clean',
    verdict('Part of #8247\n\nFixes #8245').exit,
    EXIT_CLEAN,
  );
  t('an ordinary closing PR with no Part-of declaration is clean', verdict('Fixes #8476').exit, EXIT_CLEAN);
  t(
    'a Part-of PR with no closing keyword at all is clean',
    verdict('Part of #8476 — the decision half stays open.').exit,
    EXIT_CLEAN,
  );
  t(
    'the word closing is not a closing keyword',
    verdict('Part of #8284 — merging this and closing #8284 would drop the severe half.').exit,
    EXIT_CLEAN,
  );

  // --- Delegation, not a second copy of the rule. Every body above must get
  // the same verdict from this gate as from the shipped predicate; a fork would
  // pass the cases above and drift from the sweep on the next one.
  battery('Delegation, not a second copy of the rule. Every body above must get');
  const bodies = [
    'Part of #1 close #1',
    'Part of #1\n\nFixes #2',
    'Part of #1 — `Fixes #1`',
    'Fixes #1',
    '',
    'Part of #1 Part of #2 resolves #2',
  ];
  t(
    'the verdict is exactly the shipped predicate over every fixture (no forked rule)',
    bodies.every(
      (body) =>
        (judge({ number: '1', body, commits: CLEAN_COMMITS, commitsProblem: null }).exit === EXIT_CONTRADICTION) ===
        (h7PartOfWithClosingKeyword({ body }) !== null),
    ),
    true,
  );

  // --- The failure message must carry the approved rewordings. This is the
  // card's own requirement and the reason the predicate's sentence is reused
  // verbatim: an author reading a red check gets the fix, not just the verdict.
  battery('The failure message must carry the approved rewordings. This is the');
  const failed = verdict('Part of #8131 — close #8131 once the rest lands.').lines.join('\n');
  t('the failure names the "not addressed here" rewording', failed.includes('is not addressed here'), true);
  t('the failure names the "out of scope" rewording', failed.includes('out of scope: #8131'), true);
  t('the failure names the backtick escape', failed.includes('backticks'), true);
  t('the failure is annotated for the GitHub UI', failed.includes('::error::'), true);

  // --- Empty body: a verdict about a real input, and it must SAY so rather
  // than look like a run that judged nothing.
  battery('Empty body: a verdict about a real input, and it must SAY so rather');
  const empty = verdict('');
  t('an empty body is clean', empty.exit, EXIT_CLEAN);
  t('an empty body says it was judged, not skipped', empty.lines.join('\n').includes('empty body'), true);

  // --- Wiring absent: never clean, never a verdict about a PR.
  battery('Wiring absent: never clean, never a verdict about a PR.');
  const unwired = judge(readPrContext({}));
  t('no PR context at all exits NOT WIRED', unwired.exit, EXIT_NOT_WIRED);
  t('NOT WIRED says it judged nothing', unwired.lines.join('\n').includes('judged nothing'), true);
  t('NOT WIRED does not read as a clean board', unwired.lines.join('\n').includes('✓'), false);

  // --- Context reading: presence, not truthiness.
  battery('Context reading: presence, not truthiness.');
  t('a present but empty body is still wired', readPrContext({ PR_BODY: '' })?.body, '');
  t('the PR number alone is enough to be wired', readPrContext({ PR_NUMBER: '42' })?.number, '42');
  t('an absent body reads as the empty string', readPrContext({ PR_NUMBER: '42' })?.body, '');
  t('an unset environment is not wired', readPrContext({}), null);

  // --- The wiring itself. A gate whose workflow step is deleted or whose
  // trigger loses the edit activity is not a weaker gate, it is a silent one.
  battery('The wiring itself. A gate whose workflow step is deleted or whose');
  const wiringPath = join(ROOT, WIRING_WORKFLOW);
  const wiring = existsSync(wiringPath) ? readFileSync(wiringPath, 'utf8') : '';
  t('the wiring workflow exists', wiring !== '', true);
  t('the wiring workflow runs this script', wiring.includes('node scripts/check-partof-closing-keyword.mjs'), true);
  t(
    'the wiring subscribes to body edits, so a reworded body can go green',
    /types:\s*\[[^\]]*\bedited\b[^\]]*\]/.test(wiring),
    true,
  );
  t('the wiring passes the body through env, never through shell interpolation', /env:[\s\S]{0,200}?PR_BODY:/.test(wiring), true);
  t('the wiring passes the PR number too (the wired-ness witness)', /PR_NUMBER:/.test(wiring), true);

  // This gate installs no package manager, and that is a property of the JOB,
  // not a preference. Measured the hard way: the first draft used a setup-node
  // major whose package-manager-cache default is on, which reads packageManager
  // out of package.json and shells out to pnpm to find its store. The job died
  // in the setup step with "Unable to locate executable file: pnpm", before the
  // script ran at all — a failure that names a tool the workflow source never
  // mentions. The wording of the pin is deliberately about the WORKFLOW naming
  // a package manager, since a comment explaining the incident has to be able
  // to say the word; only the executable lines are scanned.
  const wiringCommands = wiring
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  t(
    'the guard job invokes no package manager (it needs node and nothing else)',
    /\b(pnpm|corepack|yarn|npm)\b/.test(wiringCommands),
    false,
  );

  // --- The predicate source this gate reuses must still be there to reuse.
  battery('The predicate source this gate reuses must still be there to reuse.');
  t('the predicate source exists', existsSync(join(ROOT, PREDICATE_SOURCE)), true);

  // --- RULE 2. Every spelling the ruling names, plus the shapes that must stay
  // green so the rule does not tax ordinary commit prose.
  battery('RULE 2 — every card-relation spelling in a commit message is a finding,');
  for (const spelling of ['Fixes', 'Closes', 'Resolves', 'Part of', 'Refs']) {
    t(
      `a commit message carrying "${spelling}" bound to a card is a finding`,
      commitVerdict(`fix(x): a subject\n\n${spelling} #4242\n`).exit,
      EXIT_CONTRADICTION,
    );
  }
  const named = commitVerdict('fix(x): the subject that must be quoted back\n\nFixes #4242\n').lines.join('\n');
  t('the finding names the offending commit by short sha', named.includes('`00deadbee`'), true);
  t('the finding quotes the commit subject back', named.includes('the subject that must be quoted back'), true);
  t('the finding names the trailer and the card it binds', named.includes('`Fixes #4242`'), true);
  t(
    'the finding CITES the contract rather than restating it in its own words',
    named.includes(RELATION_CONTRACT),
    true,
  );
  t(
    'an ordinary commit message with no card relation is clean',
    commitVerdict('fix(cli): stop counting the walk instead of the tree\n\nBody prose about the change.\n').exit,
    EXIT_CLEAN,
  );
  t(
    'the squash subject marker `(#N)` is not a card relation',
    commitVerdict('fix(cli): report key counts off the emitted bytes (#16247)\n').exit,
    EXIT_CLEAN,
  );
  t(
    'the word closing is still not a closing keyword on this surface either',
    commitVerdict('docs: explain why closing #4242 by hand would drop the severe half\n').exit,
    EXIT_CLEAN,
  );
  t(
    'the harness trailer pair carries no card number and stays clean',
    commitVerdict('fix(x): a subject\n\nCo-Authored-By: Someone <nobody@example.invalid>\nClaude-Session: https://example.invalid/session_0\n').exit,
    EXIT_CLEAN,
  );

  // --- The regression fixture. This is the specimen the card was filed on, and
  // it is the argument for RULE 2 being WIDER than the sweep's H23: the squash
  // carries a closing trailer and NO Part-of, so the contradiction row is silent
  // on it while the assembly it produced contradicts itself in plain sight.
  battery('The regression fixture: the squash that assembled a contradiction no');
  const FIXTURE_SQUASH = [
    'fix(cli): report `os i18n extract` key counts off the emitted bytes (#16247)',
    '',
    '* fix(cli): report i18n extract key counts off the emitted bytes',
    '',
    'Two consequences of the same conflation go with it: the emit gate is now',
    "the module's own leaf count; and `--json`'s `counts` now counts the",
    '`bundles` payload beside it, as `metadataFormsCounts` already counted',
    '`metadataForms`.',
    '',
    'Fixes #16121',
    '',
    '* fix(cli): unbreak the pin\'s typecheck, drop a false symmetry claim',
    '',
    '2. The changeset, the PR body and the `--json` comment all claimed the new',
    '   `counts`/`bundles` relationship was "the relationship `metadataFormsCounts`',
    '   already had to `metadataForms`". It is not.',
  ].join('\n');
  const fixture = commitVerdict(FIXTURE_SQUASH);
  t('the fixture squash message is a finding', fixture.exit, EXIT_CONTRADICTION);
  t('the fixture finding names the trailer it found', fixture.lines.join('\n').includes('`Fixes #16121`'), true);
  t(
    'the fixture is INVISIBLE to the contradiction rule — it declares no Part-of',
    partOfTargets(FIXTURE_SQUASH, { markdown: false }).size,
    0,
  );
  t(
    'the fixture body alone is clean under RULE 1, which is why RULE 2 exists',
    h7PartOfWithClosingKeyword({ body: FIXTURE_SQUASH }),
    null,
  );

  // --- Delegation again, on the second surface: the reading must be the sweep's
  // `markdown: false`, or an author who "quotes" the trailer gets a green for a
  // trailer GitHub still acts on.
  battery('RULE 2 delegates to the sweep extractors at the commit-message reading.');
  t(
    'a trailer inside backticks in a COMMIT is still a finding (a commit is not markdown)',
    commitVerdict('fix(x): a subject\n\n`Fixes #4242`\n').exit,
    EXIT_CONTRADICTION,
  );
  t(
    'a trailer inside a fenced block in a COMMIT is still a finding',
    commitVerdict('fix(x): a subject\n\n```\nFixes #4242\n```\n').exit,
    EXIT_CONTRADICTION,
  );
  t(
    'the relations found are exactly the sweep extractors\' union over the message',
    commitRelations('Part of #1 and Refs #2 and Fixes #3').map((r) => `${r.keyword} #${r.card}`),
    ['Part of #1', 'Refs #2', 'Fixes #3'],
  );

  // --- The commit list input. Every way it can be missing must land on a
  // verdict that says the rule judged nothing.
  battery('The commit list input. An absent, broken or empty list can never read');
  const noFile = readCommits({});
  t('an absent file name is not a commit list', noFile.commits, null);
  t('an absent file name says the messages were never read', noFile.commitsProblem.includes('never read'), true);
  t('an empty file name is treated as absent', readCommits({ [COMMITS_FILE_ENV]: '   ' }).commits, null);
  t(
    'an unreadable file is a problem, not a crash',
    readCommits({ [COMMITS_FILE_ENV]: 'x.jsonl' }, () => {
      throw new Error('ENOENT');
    }).commits,
    null,
  );
  t(
    'a malformed line is a problem, never a silently dropped row',
    readCommits({ [COMMITS_FILE_ENV]: 'x.jsonl' }, () => '{"sha":"a","message":"m"}\nnot json\n').commitsProblem !== null,
    true,
  );
  t(
    'a row missing its message is a problem',
    readCommits({ [COMMITS_FILE_ENV]: 'x.jsonl' }, () => '{"sha":"a"}\n').commitsProblem !== null,
    true,
  );
  t(
    'an EMPTY list is a failed gather, never a clean history',
    readCommits({ [COMMITS_FILE_ENV]: 'x.jsonl' }, () => '\n\n').commitsProblem?.includes('EMPTY'),
    true,
  );
  t(
    'a well-formed list parses to its rows, blank lines ignored',
    readCommits({ [COMMITS_FILE_ENV]: 'x.jsonl' }, () => '{"sha":"a","message":"m"}\n\n{"sha":"b","message":"n"}\n').commits
      ?.length,
    2,
  );

  // --- The verdict layer: what wins when both apply, and the rule that an
  // unjudged half is always SAID.
  battery('The verdict layer over two rules: precedence, and the unread half is');
  const partly = judge({ number: '1', body: 'A clean body.', commits: null, commitsProblem: 'the list was not read.' });
  t('a body-only run is NOT WIRED, never clean', partly.exit, EXIT_NOT_WIRED);
  t('a body-only run does not read as a clean board', partly.lines.join('\n').includes('✓'), false);
  t('a body-only run says which rule judged nothing', partly.lines.join('\n').includes('RULE 2 judged nothing'), true);
  const both = judge({
    number: '1',
    body: 'Part of #4242 — close #4242 once the rest lands.',
    commits: null,
    commitsProblem: 'the list was not read.',
  });
  t('a real finding outranks a half-wired run', both.exit, EXIT_CONTRADICTION);
  t('and the half-wired run is still named in the output', both.lines.join('\n').includes('RULE 2 judged nothing'), true);

  // --- The wiring's second half: the step that gathers the commit list.
  battery('The wiring gathers the commit list and hands it over as a file path.');
  t('the wiring names the commit-list file variable', wiring.includes(`${COMMITS_FILE_ENV}:`), true);
  t(
    'the wiring reads the PR commits endpoint rather than walking a shallow clone',
    /pulls\/[^\n]*\/commits/.test(wiring),
    true,
  );
  t('the wiring pages the endpoint, so a long PR is not silently truncated', wiring.includes('--paginate'), true);
  t(
    'the wiring grants the read scope that endpoint needs',
    /permissions:[\s\S]{0,200}?pull-requests:\s*read/.test(wiring),
    true,
  );
  t(
    'the commit list reaches the script as a PATH in env, never as a body of text in it',
    new RegExp(`${COMMITS_FILE_ENV}:\\s*\\$\\{?\\{?\\s*(RUNNER_TEMP|runner\\.temp)`, 'i').test(wiring),
    true,
  );

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
    console.error(`✗ check-partof-closing-keyword self-test: ${failedCount} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-partof-closing-keyword self-test: ${cases.length} cases pass.`);

  return SELF_TEST_VERDICT;
}

// The basename comparison, as in the sweep: this file is imported by nothing
// today, but a future importer must not trigger a judgment as a side effect.
const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-partof-closing-keyword self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    const result = judge(readPrContext(process.env));
    const emit = result.exit === EXIT_CLEAN ? console.log : console.error;
    for (const line of result.lines) emit(line);
    process.exit(result.exit);
  }
}
