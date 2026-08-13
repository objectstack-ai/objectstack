#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:partof-closing-keyword — the PR-scoped BLOCKING half of the half-state
 * sweep's H7: a pull request may not declare itself only `Part of #N` while
 * also telling GitHub to close that same `#N`.
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
 * ## Exit codes — and why an empty body is a VERDICT, not a skip
 *
 *   0  judged, clean.
 *   1  judged, contradiction found. The PR is red until the body is reworded.
 *   2  NOT WIRED — no PR context in the environment at all. A usage/wiring
 *      failure, never a statement about any PR.
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
 * agent seat can make (the protection endpoint answers 403 here) and, per the
 * required-context registry convention, one that carries a maintainer ruling.
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

import { h7PartOfWithClosingKeyword } from './pm/check-half-states.mjs';

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
  return { number: String(env.PR_NUMBER ?? '').trim(), body: env.PR_BODY ?? '' };
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
  if (!contradiction) {
    const what = ctx.body.trim() === '' ? 'has an empty body, which can carry no' : 'carries no';
    return {
      exit: EXIT_CLEAN,
      lines: [`✓ check:partof-closing-keyword: ${where} ${what} Part-of/closing-keyword contradiction.`],
    };
  }

  return {
    exit: EXIT_CONTRADICTION,
    lines: [
      `::error::${where} contradicts itself: ${contradiction}`,
      '',
      `✗ check:partof-closing-keyword: ${where} contradicts itself.`,
      '',
      `  ${contradiction}`,
      '',
      '  Why this is blocking rather than advisory: the card closes SILENTLY on merge, and a closed',
      '  card reads as finished — the one incident behind this gate was found only by a post-merge',
      '  inventory re-pull. Editing the body re-runs this check; no push and no re-run are needed.',
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

function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push([name, actual, expected]);
  const verdict = (body, number = '1') => judge({ number, body });

  // --- The measured arms. All three were read live on one throwaway PR, in one
  // body, at one moment, with the PR OPEN and unmerged: the plain-prose target
  // gained a closing link within seconds, and the fenced and inline targets
  // gained none. The predicate strips code before scanning; these three cases
  // are that measurement, kept executable.
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
  const failed = verdict('Part of #8131 — close #8131 once the rest lands.').lines.join('\n');
  t('the failure names the "not addressed here" rewording', failed.includes('is not addressed here'), true);
  t('the failure names the "out of scope" rewording', failed.includes('out of scope: #8131'), true);
  t('the failure names the backtick escape', failed.includes('backticks'), true);
  t('the failure is annotated for the GitHub UI', failed.includes('::error::'), true);

  // --- Empty body: a verdict about a real input, and it must SAY so rather
  // than look like a run that judged nothing.
  const empty = verdict('');
  t('an empty body is clean', empty.exit, EXIT_CLEAN);
  t('an empty body says it was judged, not skipped', empty.lines.join('\n').includes('empty body'), true);

  // --- Wiring absent: never clean, never a verdict about a PR.
  const unwired = judge(readPrContext({}));
  t('no PR context at all exits NOT WIRED', unwired.exit, EXIT_NOT_WIRED);
  t('NOT WIRED says it judged nothing', unwired.lines.join('\n').includes('judged nothing'), true);
  t('NOT WIRED does not read as a clean board', unwired.lines.join('\n').includes('✓'), false);

  // --- Context reading: presence, not truthiness.
  t('a present but empty body is still wired', readPrContext({ PR_BODY: '' })?.body, '');
  t('the PR number alone is enough to be wired', readPrContext({ PR_NUMBER: '42' })?.number, '42');
  t('an absent body reads as the empty string', readPrContext({ PR_NUMBER: '42' })?.body, '');
  t('an unset environment is not wired', readPrContext({}), null);

  // --- The wiring itself. A gate whose workflow step is deleted or whose
  // trigger loses the edit activity is not a weaker gate, it is a silent one.
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

  // --- The predicate source this gate reuses must still be there to reuse.
  t('the predicate source exists', existsSync(join(ROOT, PREDICATE_SOURCE)), true);

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
}

// The basename comparison, as in the sweep: this file is imported by nothing
// today, but a future importer must not trigger a judgment as a side effect.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    const result = judge(readPrContext(process.env));
    const emit = result.exit === EXIT_CLEAN ? console.log : console.error;
    for (const line of result.lines) emit(line);
    process.exit(result.exit);
  }
}
