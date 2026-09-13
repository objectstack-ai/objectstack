#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:partof-closing-keyword — the PR-scoped BLOCKING guard over the pull
 * request BODY, which is both what GitHub's reference parser reads when the
 * request merges and — since the squash message is taken from it — the text
 * that lands on the default branch.
 *
 *   RULE 1 — THE BODY. A pull request may not declare itself only `Part of #N`
 *   while also telling GitHub to close that same `#N`. This is the half-state
 *   sweep's H7, called.
 *
 *   RULE 2 — THE COMMIT MESSAGES — is no longer judged here. It moved to a
 *   pre-push hook when the squash message stopped being assembled from the
 *   commits; the section below is the authority on where it went and why.
 *
 *   RULE 3 — THE BODY, NEGATED. A pull request may not bind a closing keyword
 *   to a `#N` inside a sentence that reads as NOT closing it. This is the
 *   half-state sweep's H21, called. It reads the same surface as RULE 1 and is
 *   disjoint from it by construction.
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
 *      and the identical reason are already in the duplicate-fix guard, one of
 *      this repo's other PR-body-scoped blocking checks; this follows it rather
 *      than inventing a second shape.
 *
 * The residual hole is named rather than hidden: `rerun_failed_jobs` on a run
 * whose body has since been fixed replays the stale body and stays red. The
 * remedy is to edit the body (which fires a new run), not to re-run.
 *
 * ## Where RULE 2 went, and why this gate no longer reads the commit list
 *
 * There was a third rule here, and it is worth knowing where it went rather
 * than discovering its absence. RULE 2 refused a card-relation trailer in ANY
 * commit message on the pull request, and it rested on one premise: this
 * repository squash-merges by assembling the branch's COMMIT MESSAGES, so a
 * trailer left on a pushed commit really does reach the default branch's
 * permanent history.
 *
 * That premise no longer holds. The repository setting
 * `squash_merge_commit_message` is `PR_BODY` — paired with `PR_TITLE`, the only
 * combination GitHub accepts it in — so every squash, queue merges included,
 * lands the pull request BODY and nothing else. A trailer in a branch commit is
 * no longer a trailer on the default branch.
 *
 * What remained was the cost of saying so LATE. This gate reads the pull
 * request's commit list, so once a branch is pushed a new commit on top JOINS
 * that list and leaves the offending message in it; nothing an author may
 * legally do removes it, because the removal is the history rewrite this
 * repository forbids. Two rounds, hours apart, each paid a full redo — a new
 * branch, the diff re-applied, a new pull request — for a mistake that costs
 * one reword when it is caught before the push. A gate whose only reachable
 * remedy is a redo is a post-push detector for a pre-push mistake.
 *
 * So the rule moved to the moment the repair is still free: it is a PRE-PUSH
 * hook now, in check-commit-card-trailers, called from .githooks/pre-push. It
 * judges exactly the commits a push would publish, and everything it judges is
 * by construction unpublished, so its remedy is an ordinary reword rather than
 * a rewrite. The rule itself did not weaken — no commit carries a card
 * relation, the body is the only carrier — and the contract citation moved with
 * it, to the finding that now prints it.
 *
 * ⚠️ What the move gives up is stated rather than left to be discovered: a hook
 * is registered PER CLONE (by `pnpm install`, through the hook registrar), runs
 * on the pusher's machine, and reports to nobody, so a clone that never
 * installed pushes unchecked. That is the ruled trade — the enforcement lands
 * at the only moment where the fix is cheap, and CI holds its self-test. ⛔ It
 * is not an argument for re-adding a commit-list read here: with the squash
 * message coming from the body, a red on this surface would report a text that
 * no longer lands.
 *
 * The numbering is left alone. RULE 3 keeps its number although RULE 2 is gone,
 * exactly as it kept it while reading RULE 1's surface: the numbers are the
 * order the rules were learned, and renumbering would rewrite output text this
 * file's own self-test pins by name, for no gain.
 * ## RULE 3 — the same surface as RULE 1, and the half of the class it misses
 *
 * RULE 1's own rationale is stated in fully general terms: GitHub's parser
 * matches the keyword plus the number and ignores the surrounding prose
 * entirely, negations and modals included, so the sentence an author writes to
 * PREVENT an auto-close is exactly what performs it. Its PREDICATE is narrower
 * than that sentence — it is bound to a Part-of declaration and fires only when
 * the same number carries both. A body that declares Part of for nothing is
 * silent under RULE 1 however plainly it says the card stays open.
 *
 * RULE 3 is that missing half, and it is the sweep's H21 called rather than a
 * second rule invented here — the same no-fork posture the import note below
 * takes for RULE 1. It fires when a closing keyword is bound to a number the
 * body never declared itself part of, inside a SENTENCE carrying a negation or
 * filing marker. The trigger is the negation WINDOW and never keyword presence:
 * 277 of the 300 most recently merged bodies in the measurement behind H21
 * carry a closing keyword bound to a number, so a presence rule would red every
 * correct pull request in the corpus.
 *
 * Numbered 3 although it reads RULE 1's surface: renumbering the commit rule
 * would rewrite output text that this file's own self-test pins by name, for no
 * gain. Read the numbers as the order the rules were learned, not as a grouping
 * by surface.
 *
 * ## Why RULE 3 is here NOW, and not when H21 was written
 *
 * H21 shipped deliberately report-only, as a patrol row this gate did not
 * import, so that widening the class could not widen a check that fails builds
 * before the class had a baseline. The promotion rode a measurement rather than
 * a moment, and the measurement is what a reader of this section should know:
 *
 *   - Over every pull request that was open at any point between H21 landing
 *     and 2026-09-07 — 2,285 of them, every body read through the shipped
 *     predicate — H21 flags three. None is a correct close wrongly refused.
 *   - One of the three is a second specimen of the original incident, and it is
 *     the argument for a blocking gate rather than a patrol row. A body said a
 *     finding was filed rather than repaired, bound a closing keyword to that
 *     card in the same sentence, and the card closed two seconds after the
 *     merge — still carrying its bug and queue labels, i.e. a genuine unfixed
 *     defect reading as finished.
 *   - The patrol could not have caught it. That pull request was open for 41
 *     minutes, entirely between two six-hourly sweeps. A report-only row is
 *     structurally blind to a short-lived pull request; a PR-time gate is not.
 *     That gap is not a discipline problem and no schedule fixes it.
 *
 * ## Exit codes — and why an empty body is a VERDICT, not a skip
 *
 *   0  judged, clean — both rules, over an input that was really read.
 *   1  judged, finding. The PR is red until the body is reworded. Both findings
 *      share this exit: a body that negates the relation it also states is the
 *      same contradiction class RULE 1 refuses, so it is a new finding KIND and
 *      not a new exit code.
 *   2  NOT WIRED — the input this gate judges is missing, so nothing was
 *      judged. A usage/wiring failure, never a statement about any PR.
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

// Both predicates are the sweep's, imported and not re-spelled. GitHub's
// closing-keyword grammar is spelled in three places in this tree and a parity
// gate holds those three behaviourally equal; a FOURTH spelling here would be a
// fourth thing to keep in step, and it would be the one nobody remembers when
// the grammar next moves. Importing the PREDICATES rather than the extractors
// takes the same posture one level up: the rule itself has one home.
import { h7PartOfWithClosingKeyword, h21NegatedClosingKeyword } from './pm/check-half-states.mjs';
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
  'RULE 3 — a closing keyword bound to a card the sentence says it is NOT': 17,
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
  };
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
        '      PR_BODY="$(cat some-body.md)" node scripts/check-partof-closing-keyword.mjs',
      ],
    };
  }

  const where = ctx.number ? `PR #${ctx.number}` : 'this PR';
  const contradiction = h7PartOfWithClosingKeyword({ body: ctx.body });
  // RULE 3, the sweep's H21 called on the same body. Disjoint from RULE 1 by
  // construction — a number already declared Part of is RULE 1's, and H21 skips
  // it — so one number can never be reported twice in one verdict.
  const negated = h21NegatedClosingKeyword({ body: ctx.body });

  if (contradiction || negated) {
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
    if (negated) {
      if (contradiction) lines.push('');
      lines.push(
        `::error::${where} tells GitHub to close a card its own sentence says it is not closing: ${negated}`,
        '',
        `✗ check:partof-closing-keyword: ${where} tells GitHub to close a card its own sentence says it`,
        '  is NOT closing.',
        '',
        `  ${negated}`,
        '',
        '  Remedy, in order of preference: reword so that no closing keyword sits beside that number —',
        '  the sentence above names the three approved rewordings, and any of them says the same thing',
        '  to a reader while saying nothing to the parser. If the keyword must stay in the prose, put',
        '  it in BACKTICKS: a pull request body is markdown, the parser does not fire inside a code',
        '  span, and that was measured live rather than assumed. ⛔ Backticks are NOT the escape in a',
        '  commit message — nothing renders one, so they are ordinary characters there, and the',
        '  pre-push card-trailer refusal is the check that surface answers to.',
        '',
        '  Why this is blocking rather than advisory: this body declares no `Part of`, so RULE 1 is',
        '  silent on it by construction, however plainly the sentence says the card stays open. The',
        '  close then lands SILENTLY on merge, on a card nobody is watching, and a closed card reads as',
        '  finished — the measured specimen closed a genuine unfixed defect two seconds after its merge.',
        '  Editing the body re-runs this check; no push and no re-run are needed.',
      );
    }
    return { exit: EXIT_CONTRADICTION, lines };
  }

  const what = ctx.body.trim() === '' ? 'has an empty body, which can carry no' : 'carries no';
  return {
    exit: EXIT_CLEAN,
    lines: [
      `✓ check:partof-closing-keyword: ${where} ${what} Part-of/closing-keyword contradiction and no`,
      '  closing keyword bound to a card its own sentence says it is not closing.',
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
  const verdict = (body, number = '1') => judge({ number, body });

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
        (judge({ number: '1', body }).exit === EXIT_CONTRADICTION) ===
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

  // --- RULE 3 — a closing keyword bound to a card the sentence says it is NOT
  // closing. The sweep's H21, called. Every fixture below is a real sentence:
  // the two positives are measured specimens quoted byte-for-byte, and the
  // greens are the register the specimens live in, which the corpus behind H21
  // found 116 times without one of them binding a keyword to a number. That
  // ratio is the whole reason this rule reads a negation WINDOW and not keyword
  // presence, and these cases are what stops a later edit from widening it.
  battery('RULE 3 — a closing keyword bound to a card the sentence says it is NOT');
  const negatedOut = verdict('## Out of scope\n\nFiled, not fixed: #10240 — the same leak through the delete verb.');
  const negatedText = negatedOut.lines.join('\n');
  t('the incident specimen is refused, and under the existing finding exit', negatedOut.exit, EXIT_CONTRADICTION);
  t(
    'the second specimen is refused too (measured 2026-08-24, a card closed 2s after its merge)',
    verdict('One adjacent finding filed rather than fixed: #11745').exit,
    EXIT_CONTRADICTION,
  );
  t('the control passes: an ordinary closing body with no negation is clean', verdict('Fixes #10171').exit, EXIT_CLEAN);
  t(
    'the specimen REGISTER stays clean when it binds no keyword to a number (the near miss)',
    verdict('## Out of scope — filed, not repaired here\n\nThe delete verb keeps its own card.').exit,
    EXIT_CLEAN,
  );
  t(
    '…and its other measured spelling stays clean for the same reason',
    verdict('The adjacent leak is filed, not fixed here.').exit,
    EXIT_CLEAN,
  );
  t(
    'a multi-card close list under an earlier negation is clean (the sentence bound, measured)',
    verdict('This does not change the loader.\n\nFixes #10581\nFixes #10582\nFixes #10583').exit,
    EXIT_CLEAN,
  );
  t(
    'a markdown structural line start bounds the window, so the negation does not reach the keyword',
    verdict('This does not touch the loader.\n\n### Closing lines\n\nFixes #10581').exit,
    EXIT_CLEAN,
  );
  t(
    'backticks ARE the escape on this surface, so an author explaining the keyword is not taxed',
    verdict('Out of scope — this body deliberately does not say `Fixes #10240` in prose.').exit,
    EXIT_CLEAN,
  );
  t(
    "a number already declared Part of is RULE 1's row: RULE 3 does not double-report it",
    h21NegatedClosingKeyword({ body: 'Part of #8131 — this does not close #8131 yet.' }),
    null,
  );
  t(
    '…and that body is still refused, by RULE 1, so the disjointness costs no coverage',
    verdict('Part of #8131 — this does not close #8131 yet.').exit,
    EXIT_CONTRADICTION,
  );
  const negatedBodies = [
    'Filed, not fixed: #10240 — the same leak through the delete verb.',
    'Fixes #10171',
    'Part of #8131 — this does not close #8131 yet.',
    'This does not change the loader.\n\nFixes #10581',
    '',
    'Out of scope: closes #77.',
  ];
  t(
    'the verdict is exactly the two shipped predicates over every fixture (no forked rule)',
    negatedBodies.every(
      (body) =>
        (judge({ number: '1', body }).exit === EXIT_CONTRADICTION) ===
        (h7PartOfWithClosingKeyword({ body }) !== null || h21NegatedClosingKeyword({ body }) !== null),
    ),
    true,
  );
  t('the failure names the "not addressed here" rewording', negatedText.includes('#10240 is not addressed here'), true);
  t('the failure names the "out of scope" rewording', negatedText.includes('out of scope: #10240'), true);
  t('the failure names the "remains open" rewording', negatedText.includes('#10240 remains open'), true);
  t('the failure names the backtick escape, which is valid on THIS surface', negatedText.includes('BACKTICKS'), true);
  t(
    '…and says in the same breath that backticks are NOT the escape in a commit message',
    negatedText.includes('Backticks are NOT the escape in a'),
    true,
  );
  t('the RULE 3 failure is annotated for the GitHub UI', negatedText.includes('::error::'), true);

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
