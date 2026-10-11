// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dispatch-gates.data — the hand-written tables `dispatch-gates.mjs` reads, as DATA and nothing else.
 *
 * The gate ROSTER is not here, and never was anywhere: which paths feed which `check:*` families is
 * derived from `.github/workflows/*.yml`, the composite actions they `uses:`, `package.json` and the
 * gate scripts' own sources, on every run of the engine beside this file. What IS hand-written is
 * below: the marker grammar vocabularies, the ledgers (whole-tree residue, compound anchors, governed
 * reads, escapable literals), the change-kind roster (convention-triggered gates, named by the KIND
 * of change rather than by a path), the model-tier globs, the tier ladder words and the generated-module
 * sources (a git-ignored module's committed inputs). Each table keeps the docblock that governs it; a
 * row's reason is part of the row.
 *
 * ⛔ No logic. A row that needs a function names it — a predicate by its key (`matches`, `except`),
 * a tier by its name (`tier`) — and the engine resolves the name at load, refusing one it does not
 * know. A new gate family under a kind is one row here, still only on the maintainer's words.
 *
 * ⛔ Not a watch surface. No gate family resolves to this file and no gate imports it, so the paths
 * its rows spell are never read as a population; the engine declares its own inherited population
 * from what it OPENS, which is why moving these rows here moved no derivation.
 */
/**
 * The THREE population markers' grammar, in ONE spelling, and the reading of
 * whether the reason one of them captures is WHOLE (#18422).
 *
 * ## The defect this exists for
 *
 * Every population marker below captured its reason with `(\S.*)$` under the
 * `m` flag, so the capture ends at the FIRST NEWLINE. A reason an author wraps
 * across two or three comment lines — which is what a comment that long looks
 * like in every file in this tree — was captured as line ONE, and nothing
 * refused it: `wholeTreePopulationRefusal` checks that a reason EXISTS and that
 * a root walk BACKS it, never that it is whole. Measured on card #17472: a
 * three-line reason rendered to the seat as "…and the verdict is", a sentence
 * that simply stops. The failure mode is the expensive kind — a truncated
 * reason reads as a complete sentence that merely ends oddly, and the reason is
 * the ONE thing a seat reads off that row when deciding whether a family
 * belongs on its card.
 *
 * ## The contract: the reason is WHOLE, or the declaration is RED
 *
 * A declaration OWNS the line it is written on and nothing else. It is
 * terminated by a blank line, a blank comment line, a non-comment line, EOF, or
 * another `dispatch-gates:` declaration. A comment line immediately below it,
 * in the SAME comment form, carrying text that is not a new `dispatch-gates:`
 * key, is read as a CONTINUATION of the reason — and a continued reason is
 * refused, naming the file and the line that continues it.
 *
 * ⛔ The remedy is NOT a marker that consumes a comment BLOCK. Nothing in the
 * text can tell a wrapped reason from an unrelated comment written under the
 * declaration, so a block-consuming marker would silently make the next
 * paragraph part of a seat-facing reason — the same class of defect pointed the
 * other way, and the coin toss this file refuses everywhere else. Refusing is
 * decidable; swallowing is a guess. Measured over the tree at the time of
 * writing: 27 declarations across 25 gate files, 26 of them already writing the
 * whole reason on one line (up to 1215 characters of it), and exactly one
 * wrapped — so the one-line spelling is what this convention already IS, and
 * the refusal names the one declaration that was being cut.
 *
 * ## Why the grammar is built here rather than written out three times
 *
 * The continuation reading has to agree with the capture about what a marker
 * line IS, down to the comment form. Two spellings of one grammar drift
 * silently — the exact failure `declaredNoCheckFamiliesReason`'s docblock
 * prices one level up — so the pattern each marker uses and the pattern the
 * continuation reading uses come out of this one function. Group 1 is the
 * comment form (`//` or `#`), group 2 is the reason; the form is captured
 * rather than discarded because a `#` line under a `//` declaration is not a
 * comment in the same language and cannot be continuing it.
 */
export const POPULATION_MARKER_KEYS = Object.freeze(['no-path-population', 'whole-tree-population', 'wide-population']);

/**
 * The COMMENT FORMS a `dispatch-gates:` declaration may be written in, in ONE
 * roster — and the HEAD every marker pattern below is built out of it: the
 * indent, the form, and the key that follows it.
 *
 * ## The defect the roster was widened for (#18661)
 *
 * The alternation listed `//` and `#` and nothing else, so a declaration
 * written in the file's own BLOCK-comment idiom parsed as NOTHING: not
 * refused, not printed, not counted. Measured on `origin/main` 95b21b33be,
 * `declaredNoPathPopulation` read `null` over both of this tree's block-form
 * declarations — `scripts/symbol-anchors.mjs` (a slash-star opener) and
 * `scripts/release-verify-npm.mjs` (a star-prefixed line inside a docblock) —
 * and both families sat in the residue's `undetermined` bucket with `hints=0`,
 * the exact bucket the marker exists to split them out of. A dropped
 * declaration printed IDENTICALLY to one nobody ever wrote, which is the one
 * shape neither side will go and check: its author believes they explained the
 * emptiness, its reader believes nobody ever did.
 *
 * ## Two KINDS of form, because they answer the wholeness question differently
 *
 * `line` — `//` and `#`. Each line is its OWN comment. The line under a
 *   declaration is a SEPARATE comment, and nothing in the text says whether it
 *   belongs to the reason or is an unrelated remark. So the declaration owns
 *   its line, and a comment line under it is refused as a CUT (#18422) —
 *   unchanged here, byte for byte, and `populationReasonCutRefusal`'s text
 *   still states it.
 *
 * `block` — a slash-star opener (one star or two) and the star-prefixed
 *   CONTINUATION lines inside it. The whole comment is ONE comment and its
 *   internal newlines are FORMATTING, not comment boundaries, so a reason that
 *   wraps is decidable rather than a guess: inside a block, the next
 *   star-prefixed line is a continuation BY CONSTRUCTION. What the block form
 *   therefore cannot do is cross any of the three places a block-comment author
 *   signals a new thought — each one pinned in the self-test:
 *
 *     the CLOSING delimiter       the comment is over
 *     a blank star-only line      the author ended the paragraph
 *     the next star-@tag line     the docblock's tag section begins
 *
 *   plus the two the line forms already carry: another `dispatch-gates:` key,
 *   and EOF. A line INSIDE the block carrying text with no star prefix is none
 *   of the five — it is reason text this walk cannot read — so it is recorded
 *   as a CUT and refused, the same direction and for the same reason the line
 *   forms are refused in.
 *
 * ⚠️ The residual asymmetry, named here rather than left to be found: a second
 * sentence written on the very next star line, with no blank line between it
 * and the declaration, IS swallowed into the reason. That is OVER-inclusion,
 * and it reaches the seat as a reason that says too much — visible on the row.
 * The truncation #18422 refused is UNDER-inclusion, and reaches the seat as a
 * sentence that merely ends oddly — invisible. The block idiom's own paragraph
 * break is the text that separates the two, and it is what a block-comment
 * author already writes; the line forms have no such text, which is why they
 * refuse instead.
 *
 * ## One alternation, one roster
 *
 * The form alternation is the half a reader has to be able to change in ONE
 * place: a form this roster does not list parses as nothing at all, silently,
 * and widening it in one builder while the other kept its own copy would fix
 * half the markers and leave the other half reading exactly as they did. Both
 * builders below and the continuation reading come out of this roster. Group 1
 * of every pattern is the form, because the reading has to know a `#` line is
 * not continuing a `//` one — and now also which KIND of form it is reading.
 *
 * ⚠️ Order is load-bearing: the two-star opener is listed BEFORE the one-star
 * opener, so a `/**` docblock opener captures whole instead of matching `/*`
 * and stranding its second star in front of the key.
 *
 * ⛔ Every example in the docblocks below is written with the docblock's OWN
 * star prefix AND the example's own form — two openers on one line. That is
 * not decoration: exactly ONE opener is what this grammar and the
 * unparsed-form probe both accept, so a two-opener line is documentation to
 * both of them and can never be read as a live declaration about this file.
 */
export const MARKER_COMMENT_FORMS = Object.freeze([
  Object.freeze({ label: '//', kind: 'line', open: '\\/\\/' }),
  Object.freeze({ label: '#', kind: 'line', open: '#' }),
  Object.freeze({ label: '/**', kind: 'block', open: '\\/\\*\\*' }),
  Object.freeze({ label: '/*', kind: 'block', open: '\\/\\*' }),
  Object.freeze({ label: '*', kind: 'block', open: '\\*' }),
]);

/**
 * The marker keys whose files are NOT JavaScript, and the comment forms those
 * files really have (#18662).
 *
 * The roster above is the set of idioms a `dispatch-gates:` declaration may be
 * written in across this tree; it is not a claim that every one of them is a
 * comment in every LANGUAGE a declaration is read out of. `no-check-families`
 * is read out of workflow YAML, where `#` is the only comment there is: a
 * `//` or slash-star line in a workflow is document content, and reading a
 * declaration off one would be reading it off text the workflow's own parser
 * never treats as a remark. So the alternation this key's pattern is built
 * from is the roster FILTERED to the forms its language has — never a second
 * roster, and never a second pattern.
 *
 * A key absent from this table gets the whole roster, which is the answer for
 * every marker read out of a JavaScript or shell source.
 *
 * ⛔ This table may only ever NARROW: it names a subset of the labels in
 * `MARKER_COMMENT_FORMS`, and a label that is not one of them throws below
 * rather than silently contributing nothing to the alternation — a form set
 * that quietly emptied would make every declaration of that key parse as
 * nothing at all, which is precisely the #18661 failure one level up.
 */
export const MARKER_KEY_FORMS = Object.freeze({
  'no-check-families': Object.freeze(['#']),
});

/**
 * The REASON-TAIL markers — the keys whose grammar is head + `-- <reason>`,
 * with nothing between the key and the separator (#18662).
 *
 * The three population keys were the whole roster until this card, and the
 * builder is still spelled `populationMarkerPattern` because `population*` is
 * what this machinery is CALLED everywhere it is exported
 * (`populationReasonContinuation`, `populationReasonCutRefusal`) and a rename
 * would move the names a reader greps for without moving a single behaviour.
 * ⚠️ The ROSTER, not the name, is the authority on which keys it serves:
 * `no-check-families` has exactly this grammar and is built here rather than
 * out of the fourth hand-written copy of the pattern it used to be — which is
 * what left its reason outside the #18422 wholeness reading for two cards.
 */
export const REASON_TAIL_MARKER_KEYS = Object.freeze([...POPULATION_MARKER_KEYS, 'no-check-families']);

/**
 * The PATH-LIST markers' grammar, in one spelling, for the same reason the
 * reason-only markers have one (#18673).
 *
 * A path-list declaration names files BEFORE its reason —
 * `dispatch-gates: <key> <path> [<path> ...] -- <reason>` — so it cannot come
 * out of `populationMarkerPattern`, whose tail is a bare reason. What it CAN
 * share is the head: the indent, the comment form and the key. Group 1 is the
 * comment form, group 2 the path list, group 3 the reason.
 *
 * The `--` is SPACE-delimited on both sides here (never `[ \t]*`), because a
 * path may legitimately contain one and a bare separator would split it.
 *
 * ⚠️ `local-env` shares this grammar with a list of ENVIRONMENT NAMES in the
 * path position (#20278). The grammar is LIST-then-reason and never reads what
 * the list holds; each key's own reader does (`declaredLocalEnv` refuses a
 * token that is not an env name). The roster keeps its name for the reason
 * `REASON_TAIL_MARKER_KEYS` states: a rename would move what a reader greps for
 * without moving a behaviour, and a third builder would be the copy of this
 * pattern the refusal below forbids.
 */
export const PATH_LIST_MARKER_KEYS = Object.freeze(['inherited-population', 'self-test-reads', 'local-env']);

/**
 * The WHOLE-TREE RESIDUE ledger (#15312) — the families whose own source sweeps
 * the repository root, that this derivation can place on NO card, and that are
 * deliberately not in the whole-tree bucket above.
 *
 * ## The defect
 *
 * `check:driver-memory-census` counts a `vi.mock` of a frozen driver package as
 * a module binding wherever in the tree it is written, and names no path
 * literal anywhere in its source — so this derivation scored it `undetermined`
 * for every card and no `--commands` harvest could contain it. A seat derived
 * its family, ran 57 of them with 53 green, and CI's lint job then failed on
 * the one gate the derivation could not offer. The gate was right; what was
 * missing was a way for a seat to be TOLD about it before the push, which is
 * exactly what the whole-tree channel above exists to be. It now declares.
 *
 * ⚠️ Fixing that one gate is not the fix. The question worth answering is
 * "which gates does CI run that no derivation can name", mechanically, so the
 * NEXT one reds here rather than in CI a cycle later. This table and the live
 * case in `--self-test` are that answer for the class the card names.
 *
 * ## The population, and why the closure subtraction is load-bearing
 *
 * A family is IN it when three things hold at once: its own source carries a
 * recognised repo-root walk (`repoRootWalkSpelling` — the same predicate that
 * vouches for a whole-tree declaration), it declares NEITHER marker, and no
 * path in the tree OUTSIDE the gate's own file closure can place it. That last
 * subtraction is not a detail: every family matches the card that edits the
 * gate itself, through the identity key, so counting that as "the derivation
 * can name it" would score this whole population green on a card nobody files.
 *
 * ## Why this class and not "every gate CI runs"
 *
 * The wider question was MEASURED for this card rather than guessed at: on
 * cd1f8ee96, of the 186 gate scripts CI runs, 44 are named by no derivation at
 * all. The bulk of them are SUBTREE walkers — seeded at `packages`, `apps`,
 * `examples` through a runtime constant no source scan reads — whose remedy is
 * the ordinary `ROOT_DIR_WATCH_HINTS` declaration, one per-gate judgement each.
 * A table that swallowed all 44 would be forty rows nobody revisits, which is
 * the shape `artifactRosterLines` refuses for its own members. So this holds
 * the class the card named, the rest is a filed follow-up, and the boundary is
 * STATED here rather than left to be inferred from what the table happens to
 * contain.
 *
 * ## Maintaining this table
 *
 * A member this table does not list reds `check:pm-dispatch-gates`, and there
 * are exactly two honest repairs. If the gate really does read the whole tree,
 * give it the `whole-tree-population` marker: it then leaves this population by
 * DECLARING, which is the outcome this table exists to push toward. If it does
 * not, add a row saying what it reads INSTEAD, so a reader can check the claim
 * against the gate. ⛔ Never a row that only says "not whole-tree" — that is
 * the reason-less opt-out both markers refuse, and it reads exactly like a
 * placeholder nobody will revisit. A listed family that stops being a member
 * reds too: a stale exclusion is an exclusion nobody is measuring any more.
 */
export const ROOT_WALK_RESIDUE_LEDGER = [
  [
    'scripts/check-console-intercept-disarm.mjs',
    'its `scan(REPO_ROOT)` walks `workspacePackageDirs(root)` — every workspace PACKAGE ROOT\'s package.json and '
      + 'vitest.config.*, read off pnpm-workspace.yaml. That is workspace-wide but it is not every file: a new test '
      + 'file under an existing package does not move it, a new PACKAGE does. Declaring the whole tree would put it '
      + 'on every card on a population it does not read.',
  ],
  [
    'scripts/check-console-intercept-disarm.mjs --self-test',
    'the same gate file, reached through its self-test invocation; the reading above is the whole of it.',
  ],
  [
    'scripts/check-skill-frame-freshness.mjs --self-test',
    'lint.yml runs the SELF-TEST HALF and never the scan — its step is named that, and the step comment states why '
      + '(the pnpm script would drag the scan in with it). The repo-root default parameter belongs to the scan half '
      + 'CI does not schedule, so a whole-tree row for this family would advertise work no workflow performs.',
  ],
  // ⚖️ `check:pm-half-states` LEFT this population under #16904's D2 and its row
  // is gone with it — a listed family that stops being a member reds here, and
  // a stale exclusion is an exclusion nobody measures. It is now placeable BY
  // PATH, and truthfully: `check-half-states.mjs`'s self-test reads two sibling
  // sources as program text — `scripts/pm/sweep-stale-finding.mjs` and
  // `scripts/pm/check-prior-rulings.mjs` — to pin that the sweep still ALIASES
  // the one stale-`finding` screen rather than re-growing a copy, and that the
  // prior-ruling line's writer still prints the key the patrol greps. So a card
  // touching either sibling really does owe this gate, which is the opposite of
  // the #15753 placement this row was written about: that one came from a
  // noise-floor constant and said the opposite of what the constant declares,
  // while these two literals are exactly what the self-test reads.
  // ⚖️ `scripts/symbol-anchors.mjs --self-test` LEFT this population under
  // #18661 and its row is gone with it — a listed family that stops being a
  // member reds here, and a stale exclusion is an exclusion nobody measures.
  // It left through the OUTCOME this table exists to push toward: it DECLARES.
  // The declaration was there the whole time — a `no-path-population` marker
  // written in that file's own block-comment idiom, in a form the marker
  // grammar did not list, so it read back `null` and the family arrived here
  // looking like a gate whose emptiness nobody had examined. This row was the
  // price of that silence: a hand-written exclusion, carrying by hand the
  // reading the gate's own source already carried, for a family that was never
  // a member of this population at all. Widening the form set (see
  // `MARKER_COMMENT_FORMS`) is what let the declaration be read; deleting the
  // row is the other half of the same landing.
];

/**
 * Every COMPOUND-name declaration the self-test anchor matches, tree-wide, and
 * whether that match is what the anchor MEANT.
 *
 * ## The defect this ledger answers
 *
 * `SELF_TEST_DECL` decides "this is a self-test" from the declaration's NAME.
 * A name is not a role, so the anchor also fires on production code whose name
 * merely spells self-test — and when it does, `maskSelfTests` blanks that
 * production body, and `extractWatchHints` never sees the paths in it. The
 * failure direction is SILENCE: a hint that is never extracted cannot be
 * missed, so a gate family quietly stops being derived for a file it really
 * opens.
 *
 * The specimen that opened this is `maskSelfTests` itself, six lines above:
 * `mask` + `Self` + `Test` + `s` matches, so this module's masker blanks its own
 * body whenever the module scans itself.
 *
 * ## The census, re-derived on this tree
 *
 * 275 code-position matches over the tracked JS/TS corpus. 244 are the bare
 * `selfTest`; the remaining 31 carry compound names over 28 distinct spellings,
 * and they are the rows below. Twenty are genuine self-test batteries — the
 * anchor firing on them is the anchor working. ELEVEN are production code:
 *
 *   scripts/check-self-test-wired.mjs             carriesSelfTest
 *   scripts/check-self-test-workflow-commands.mjs runSelfTest
 *   scripts/check-step-collectors.mjs             selfTestTargets
 *   scripts/check-step-collectors.mjs             selfTestDiscoveries
 *   scripts/measure-durability-swallow-family.mjs selfTestMode
 *   scripts/measure-self-test-floor.mjs           selfTestDefs
 *   scripts/pm/dispatch-gates.mjs                 selfTestOnlyCallables
 *   scripts/pm/dispatch-gates.mjs                 maskSelfTests
 *   scripts/pm/dispatch-gates.mjs                 selfTestCaseLines
 *   scripts/pm/dispatch-gates.mjs                 selfTestOnlyInvocation
 *   scripts/pm/dispatch-gates.mjs                 declaredSelfTestReads
 *
 * Every one of them is a gate that REASONS ABOUT self-tests, which is why they
 * cluster: a tool that finds, spawns, counts or masks other scripts' self-tests
 * names its functions after the thing it handles, and the anchor cannot tell
 * "runs a self-test" from "is one".
 *
 * ## What it costs today: nothing, MEASURED, and that is the whole point
 *
 * Neutralising each of the ten one at a time and re-extracting moves no hint
 * in any of the six files. The claim is therefore live rather than recalled —
 * and it is exactly the kind of claim that stops being true without anything
 * going red, which is what the pin in this module's self-test exists to catch.
 *
 * The same measurement, redone over the table's current twenty genuine rows,
 * is still NOT zero, and that asymmetry is what makes the classification
 * load-bearing rather than decorative: `fixtureSelfTest` drops
 * `packages/spec/spec-changes.json` and `prePushIsArmedSelfTest` drops
 * `.githooks/pre-push`, both fixture paths in `scripts/check-regen-pending.mjs`,
 * both correctly refused. So "no
 * compound-name match may contribute a hint" is FALSE as a blanket invariant;
 * the invariant holds only over the accidental half, and only a classification
 * can name that half.
 *
 * ## ⛔ Why the anchor is NOT narrowed, and why nothing is special-cased
 *
 * The obvious repairs were both refuted by the census rather than judged:
 *
 *   - **Narrowing the name pattern is impossible.** `runSelfTest` is a GENUINE
 *     entry point in `scripts/check-turbo-task-graph.mjs`, reached only from
 *     that file's `--self-test` guard, and ACCIDENTAL in
 *     `scripts/check-self-test-workflow-commands.mjs`, where it is exported and
 *     spawns other scripts' self-tests from the gate body. One spelling, both
 *     classes. No predicate over the name can separate them, so any narrowing
 *     that excludes the accidental one also unmasks a real self-test battery and
 *     readmits its fixture paths as hints — the fabricated-lead family this
 *     whole masker exists to refuse, traded for a silence that costs nothing.
 *   - **Special-casing this module's own path fixes four rows of ten.** The
 *     other six live in five other files, so the objection that a rename
 *     "fixes one instance and leaves the class" applies to it too, one file
 *     wider — and it would make the tool's self-scan differ from every other
 *     scan, which is a hazard of its own.
 *
 * ⇒ What ships is neither. The anchor keeps firing on all 31, the mask keeps
 * blanking all 31, and the cost of the eleven accidental ones is MEASURED on
 * every run instead of asserted in prose. Silence was the defect; the remedy is
 * noise on the day it starts costing something.
 *
 * ## Maintaining this table
 *
 * A compound-name declaration this table does not list reds
 * `check:pm-dispatch-gates`. Classify it and add a row: `accidental: false` if
 * it is a self-test battery (its fixtures SHOULD be masked away), `true` if it
 * is production code the anchor caught by accident — in which case the pin then
 * measures, and keeps measuring, that masking it costs no hint. ⛔ Do not
 * "repair" a red by renaming the function to dodge the anchor: the row is the
 * record, and the next accidental name is the one nobody will notice.
 *
 * The TOTAL / GENUINE / ACCIDENTAL counts stated above are pinned the same
 * way (#15310): `--self-test` computes them fresh from this table and checks
 * the docblock's own prose against that computation, never against a second
 * hand-typed constant. Prose that drifts from the table reds there, instead
 * of drifting further unnoticed the way it had — twice — by the time #15310
 * measured it.
 */
export const COMPOUND_ANCHOR_LEDGER = [
  ['packages/lint/scripts/check-doc-formula-expressions.mjs', 'specSelfTest', false],
  ['packages/lint/scripts/check-doc-formula-expressions.mjs', 'fieldRuleSelfTest', false],
  ['scripts/audits/14744-before-update-per-row-value-census.mjs', 'runSelfTest', false],
  ['scripts/check-comment-mask-corpus.mjs', 'runSelfTestCases', false],
  ['scripts/check-doc-authoring.mjs', 'selfTestRule3', false],
  ['scripts/check-doc-authoring.mjs', 'selfTestPackagesProse', false],
  ['scripts/check-durability-degradation-log-level.mjs', 'checkSelfTestFloor', false],
  ['scripts/check-durability-degradation-log-level.mjs', 'selfTestReadSeams', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestTrapVocabulary', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestProvisioningUse', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestUnreferencedRecipes', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestMetaCallSpelling', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestLineCitationBinding', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestSymbolAnchors', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestPlannedStatus', false],
  ['scripts/check-regen-pending.mjs', 'fixtureSelfTest', false],
  ['scripts/check-regen-pending.mjs', 'prePushIsArmedSelfTest', false],
  ['scripts/check-regen-pending.mjs', 'decisionTableSelfTest', false],
  ['scripts/check-turbo-task-graph.mjs', 'runSelfTest', false],
  ['scripts/check-workspace-manifest-cycles.mjs', 'runSelfTest', false],
  ['scripts/check-self-test-wired.mjs', 'carriesSelfTest', true],
  ['scripts/check-self-test-workflow-commands.mjs', 'runSelfTest', true],
  ['scripts/check-step-collectors.mjs', 'selfTestTargets', true],
  ['scripts/check-step-collectors.mjs', 'selfTestDiscoveries', true],
  ['scripts/measure-durability-swallow-family.mjs', 'selfTestMode', true],
  ['scripts/measure-self-test-floor.mjs', 'selfTestDefs', true],
  ['scripts/pm/dispatch-gates.mjs', 'selfTestOnlyCallables', true],
  ['scripts/pm/dispatch-gates.mjs', 'maskSelfTests', true],
  ['scripts/pm/dispatch-gates.mjs', 'selfTestCaseLines', true],
  ['scripts/pm/dispatch-gates.mjs', 'selfTestOnlyInvocation', true],
  ['scripts/pm/dispatch-gates.mjs', 'declaredSelfTestReads', true],
];

/**
 * The governed reads this tree carries, pinned — a FLOOR the next card lowers,
 * never a list this derivation reads (#18673).
 *
 * Three rows at the landing of this card, measured by `governedReadCensus`:
 *
 *   scripts/check-commit-card-trailers.mjs   .claude/agents/os-dev.md      undeclared
 *   scripts/pm/check-expected-skips.mjs      .claude/skills/pm-dispatch/SKILL.md   DECLARED
 *   scripts/pm/check-settings-deny-roster.mjs  .claude/settings.json       undeclared
 *
 * ## Why the two undeclared rows are not declared HERE
 *
 * Both are already MATCHED for the file they read, through a key this card did
 * not add: each spells its governed path in its MODULE BODY as well as in its
 * self-test, so `extractWatchHints` sees it and the derivation names the family
 * for a card touching it — measured, both ways, at this landing. They cost
 * nothing today, and declaring them would widen this PR onto two gates it was
 * not dispatched to. They are listed so the next reader inherits the
 * measurement rather than re-deriving it.
 *
 * ## What each column makes fail
 *
 * A row whose READ disappears reds (the census no longer finds it) — which is
 * what makes the pin on this class unsatisfiable by deleting the read. A NEW
 * governed read reds until it is classified here. A row whose `declared` flag
 * changes reds, in both directions: a declaration added is a floor to lower,
 * a declaration deleted is this card's defect coming back.
 *
 * ## The fourth row: a gate whose SUBJECT is a published skill
 *
 * `scripts/check-skill-top-level-keys.mjs` reconciles the top-level key
 * enumeration in the published platform skill against the stack schema, so
 * the governed file is its input, not a fixture; it spells that path in its
 * module body and is MATCHED for it the same way the two undeclared rows
 * above are, so `declared` is false for the same reason.
 */
export const GOVERNED_READ_FLOOR = Object.freeze([
  Object.freeze({ script: 'scripts/check-commit-card-trailers.mjs', file: '.claude/agents/os-dev.md', declared: false }),
  Object.freeze({
    script: 'scripts/check-skill-top-level-keys.mjs',
    file: 'skills/objectstack-platform/SKILL.md',
    declared: false,
  }),
  Object.freeze({
    script: 'scripts/pm/check-expected-skips.mjs',
    file: '.claude/skills/pm-dispatch/SKILL.md',
    declared: true,
  }),
  Object.freeze({
    script: 'scripts/pm/check-settings-deny-roster.mjs',
    file: '.claude/settings.json',
    declared: false,
  }),
]);

/**
 * ⛔ SHRINK-ONLY. The gates whose declared population is a bare top-level word
 * the tree HAS, and which have not declared the subtree spelling for it.
 *
 * It is a DEBT list, not an exception list, and the same property makes it safe
 * that makes `KNOWN_IMPORT_UNSAFE` safe (#10665): every entry has one remedy —
 * declare the subtree spelling beside the literal, the `ROOT_DIR_WATCH_HINTS`
 * idiom — and no entry records a judgement anyone has to re-make later. There
 * is no supported route in the other direction: a family this rule newly
 * reaches is a FAILURE with that one remedy, never a new line in here. An entry
 * whose gate has since taken the escape fails as STALE and names itself, which
 * is what stops the list from rotting into an allowlist nobody re-reads.
 *
 * Both halves are asserted in this file's self-test, against the live tree,
 * and `check:pm-dispatch-gates` runs that self-test on every pull request. So a
 * gate written tomorrow that spells a bare root word fails at AUTHORING time
 * rather than landing invisible — which is the half of this class the six
 * historical instances could not fix, because each of them was archaeology.
 *
 * ⚠️ Spelling rule for a new row: it must not become a watch hint of THIS file.
 * `extractWatchHints` reads any quoted span carrying a separator, so a family
 * keyed by a direct script path (`node scripts/check-x.mjs`) would enter this
 * file's own declared population as a path it does not read — the same trap
 * `DEFAULT_BASE_REF` is assembled in two halves to avoid. Spell such a row so
 * it carries no separator, or join it at runtime. A self-test case below holds
 * this, so the rule fails rather than needing to be remembered.
 */
export const ESCAPABLE_LITERAL_LEDGER_ROWS = Object.freeze([
]);

/**
 * Gates that fire on what a change IS, keyed by a mechanically-detectable
 * convention. Everything else in this script is derived at runtime and lists
 * nothing; this table is the one exception, and it is bounded on purpose.
 *
 * ## Why these cannot be derived like the rest
 *
 * The path derivation matches a gate when the gate's own source names a
 * directory that covers your file. Every gate here computes its population
 * instead of naming it, so no source carries a literal to match:
 *
 *   - the two type-check gates — one lints a glob set that lives in the shared
 *     ESLint config, the other walks the workspace members — sit permanently
 *     in the "undetermined" bucket;
 *   - the three test-file RATCHETS (`check:query-options-erasure`,
 *     `check:engine-double-contract`, `check:where-matcher`) each walk the tree
 *     for `*.test.*` files and reconcile the count against a baseline JSON. For
 *     two of the three, what the source names is that baseline — an artifact
 *     roster, never the population — so those two score `silent` for every card
 *     in the tree, and they HAVE hints, so the "undetermined" bucket never sees
 *     them either. Before this entry named them they were printed in NEITHER
 *     half of the output for every card in the tree.
 *
 *     ⛔ Their hint sets are NOT transcribed here, and a freshly re-measured
 *     copy must not be put back. The copy that used to sit here listed all
 *     three sets and read as measured; by the time anyone re-derived it,
 *     exactly one of its five claims — the `check:engine-double-contract` row —
 *     was still true. It named a git ref as a hint for two of the rows, a class
 *     `isNonPathNamespace` refuses (this file's own self-test pins that
 *     refusal); it gave `check:query-options-erasure` a one-hint set its source
 *     has since outgrown; and it drew the conclusion below from both. Not one
 *     of those drifts touched THIS file, so nothing here could have reported
 *     them. `--residue` prints every family's live `names:` set and re-derives
 *     it on every run: that is the authority for this question, and a reader
 *     who wants the sets should run it rather than trust a paragraph.
 *
 *     ⚠ `check:where-matcher` is the exception to the paragraph above, and it
 *     stays in this entry anyway. Since #13231 its source declares its
 *     `*.test.ts` population as a literal, so the ORDINARY path derivation
 *     MATCHES it for a test file under `packages/` and it is no longer silent.
 *     That is the shape the `check:cross-package-test-inputs` measurement in
 *     the deletion criterion below describes, and it is answered the same way:
 *     the declaration is set-equal to that gate's own walk, which is rooted at
 *     `packages/`, so it reaches no test file outside that root, while the KIND
 *     reaches every one — and the KIND reaches a card dispatched BEFORE its
 *     code exists, which no path derivation can. Two routes to one gate is
 *     redundancy, not a defect; the KIND is the load-bearing one. That gate's
 *     own source says the same thing in the docblock above its literal, so
 *     neither side of the pair asserts it alone.
 *
 *     Every membership claim in the two paragraphs above is re-derived in
 *     `--self-test` against the live tree rather than restated here, so a tree
 *     that moves one turns a case RED instead of leaving this prose quietly
 *     false — which is the failure this entry has now paid for twice;
 *   - `check:i18n` walks `packages/` at runtime for files NAMED
 *     `i18n-extract.config.ts` and re-extracts each owning package's bundles.
 *     Its source names only three hints (measured, post-#9144): the shared
 *     walk module (SURFACE_MODULE) and the two metadata-registry coupling
 *     constants below — none of them the OWNING-PACKAGE population this entry
 *     answers for. So it still matches nothing on an ordinary object/field
 *     edit AND, having hints, never reaches the "undetermined" bucket either:
 *     before this entry existed, an edit to
 *     `packages/services/service-messaging/src/objects/` — which regenerates
 *     that package's four bundles — printed the gate in NEITHER half of the
 *     output. A gate the derivation cannot mention at all is the one shape
 *     this script must not produce; it cost a PR a CI round.
 *
 * No per-card gate list derived from paths can ever name these, however the
 * derivation improves.
 *
 * ## Why a named table and not a wider heuristic
 *
 * The tempting generalisation — scan every discovered check script for
 * `*.test.ts`-shaped literals and call those the test-sensitive gates — was
 * measured against this tree and names 22 families, because a script's source
 * mentions test paths in its fixtures, its self-test and its comments.
 * "Mentions a test file" is not "counts test files", and 22 leads is the same
 * as none. So the pair is written down, and the cost of writing it down is paid
 * back by the two properties below.
 *
 * ## Why the two ratchets below joined this entry (#8632)
 *
 * `check:engine-double-contract` and `check:where-matcher` were handed to the
 * PM's judgment in this file's closing prose instead of being derived. Three
 * measured instances, all of them CI rounds, say that boundary was in the wrong
 * place — and the deciding evidence is not the incidents but a structural
 * identity with an entry that was already here.
 *
 * All three ratchets discover their population the same way: a walk collecting
 * `*.test.*` files (`scripts/check-engine-double-contract.mjs`, `walk` at ~line
 * 342, `/\.(test|spec)\.(ts|tsx|mts)$/`; `scripts/check-where-matcher-
 * conformance.mjs`, corpus walk at ~line 562, `/\.test\.ts$/`), reconciled
 * against a shrink-only baseline. `check:query-options-erasure` has sat in this
 * entry for exactly that reason. Naming one of three and calling the other two a
 * judgment call was an inconsistency in this table, not a considered line.
 *
 * The noise objection recorded on the card — a path-level trigger fires on test
 * files that contain no fake engine at all — is real and is answered by what
 * these gates cost to run rather than by narrowing the trigger. Each is a
 * whole-tree shrink-only ratchet: one invocation answers for the entire tree,
 * needs no build, and prints the offending file and line when it fails. A seat
 * that runs one needlessly loses seconds; a seat that is never prompted loses a
 * CI round, which is what all three instances did. The trigger deliberately does
 * NOT read the file's contents to confirm a double is present: a card is
 * dispatched BEFORE its code exists, so the double the gate will object to is
 * usually not on disk at derivation time — the second instance added one to a
 * file that already had one, the first added the file itself.
 *
 * This is the shape the "22 leads" note rejects a heuristic for, and it survives
 * that objection because the trigger is the gates' own population test, mirrored
 * (`isTestFilePath`), not a guess at which scripts look test-flavoured.
 *
 * ## What the two i18n entries still refuse to list
 *
 * Neither `matches` enumerates anything. The first walks for the packages that
 * own a bundle, the second for the tree's metadata form modules, and both walks
 * are the GATE'S OWN, imported from `scripts/i18n-bundle-surface.mjs` rather
 * than mirrored here. That import is the fix for a defect this file used to
 * carry in its own comment: `findI18nBundlePackages` was a hand-written copy
 * described as mirroring `findConfigs` "exactly", which is a second contract
 * with no way to report the day it stopped agreeing. What is written down here
 * is the KIND, not its population, so a tenth package growing a bundle — or an
 * eighteenth form module — is matched by the next run with nothing to update.
 *
 * ## Why the SECOND i18n entry exists (#9116)
 *
 * The owning-package entry answers for one of a bundle's two producers. The
 * `objects` half is enumerated by the config's own package, so the owning
 * package is the trigger surface. The `metadataForms` half is registry-driven
 * and identical for every stack, so exactly ONE package commits that baseline
 * (`platform-objects`; every other config passes `--no-metadata-forms`) while
 * its source sits in `packages/spec`, which owns no extract config and which
 * the gate's walk never reaches.
 *
 * Measured, and paid for once: PR #9113 added two form entries in
 * `packages/spec/src/data/`, four `platform-objects` metadata-form bundles
 * moved, `check:i18n` reddened on CI, and the dev's diff-derived gate union
 * could not have named the family — the path derivation misses it for the
 * reason stated above, and the owning-package entry does not cover
 * `packages/spec`. Cost: one CI round trip plus a patch commit. The invariant
 * the card states is the one this entry restores — a gate a diff can move must
 * be derivable FROM that diff; `undetermined` is an honest unknown, not a
 * standing blind spot on a known edge.
 *
 * Its applicability is read, never assumed: `metadataFormsSurfaceIsExtracted`
 * asks the configs' own documented flags whether any package still commits that
 * baseline. The day the last one opts out, no form module can move a committed
 * bundle and this entry stops firing on its own.
 *
 * ## Why there is no THIRD i18n entry, for the type-registry edge (#9144)
 *
 * `walkMetadataForms` has a second edge the SECOND entry above does not reach:
 * `DEFAULT_METADATA_TYPE_REGISTRY` (packages/spec/src/kernel/metadata-plugin.
 * zod.ts) supplies `metadataForms.<type>.label`/`.description` for EVERY
 * registry entry, including form-less types, and `METADATA_FORM_REGISTRY`
 * itself (packages/spec/src/system/metadata-form-registry.ts, the map, not
 * the `*.form.ts` leaves it points at) decides which types get section/field
 * labels at all. Editing either moves the same bundles PR #9113 paid for —
 * but unlike the `.form.ts` leaves, neither file carries a filename the
 * `.form.ts` convention (or any convention) distinguishes, so a KIND entry
 * here would need to invent one for exactly two files.
 *
 * That is not the same shape as the two entries above: this is not a
 * runtime-enumerated population at all, it is two SPECIFIC, KNOWN files —
 * the shape `SURFACE_MODULE` and `check-type-check-coverage.mjs`'s
 * `ROOT_PROGRAM_COUPLED_SCRIPT` already use. So it is closed there instead:
 * `check-i18n-bundles.mjs` declares both paths as bare module-body coupling
 * constants (`METADATA_TYPE_REGISTRY_MODULE` / `METADATA_FORM_REGISTRY_
 * MODULE`), which the ORDINARY path-literal derivation now reads directly off
 * that gate's own source — no `CHANGE_KIND_GATES` entry, no `matches`
 * function, nothing here to keep in sync. See that pair's doc comment in
 * check-i18n-bundles.mjs for the full reasoning, and this file's own
 * self-test for the live pins that keep the constants honest as the coupling
 * they are: manual, per-file, and silently rottable if nothing watched it.
 *
 * ## Why the ROOT-program entry does not weaken the ledger's discipline (#9873)
 *
 * `check-type-check-coverage.mjs` states, in its own source, the very thesis
 * the card for this entry was filed to argue: "The root program is everything
 * outside packages/apps/examples, so no list here can ever be complete -- add a
 * constant when a coupling has actually been measured, the way this one was."
 * That is a deliberate policy, written by the gate's author before the card
 * existed, and the entry below is a proposal against it. So it owes an answer
 * rather than a shrug.
 *
 * The answer is that the two lists answer different questions, and only one of
 * them is a measurement.
 *
 * The gate's ledger records MAGNITUDE. `ROOT_PROGRAM_COUPLED_SCRIPT` does not
 * merely say "this file is in the program" — it carries a measured claim, that
 * the file accounts for 29 of that entry's 80 errors, and the ledger note
 * spends that number. A rule that manufactured such constants automatically
 * really would register couplings nobody had measured, and the refusal is
 * right. This entry adds no constant, moves no count and asserts no magnitude:
 * the ledger keeps exactly the one measured coupling it has today, with every
 * reference to it intact.
 *
 * This table records RELEVANCE — which gate a seat is told to run before it
 * pushes. That claim needs no measurement to be true, because it is already
 * settled by a file the repo maintains for another purpose entirely: a path is
 * in the root program when the root tsconfig does not exclude it. Nothing here
 * is kept in sync by hand, so there is no second contract to rot, and the
 * measured-couplings rule the gate states about ITS list is untouched.
 *
 * What leaving the two questions merged cost, once, in the expensive direction:
 * PR #9853 added a single file under a directory this entry now covers, derived
 * its gate union with this script at final head, ran both gates the run named
 * and reported them green — then CI failed the type-debt ratchet with 19 new
 * errors from that one file. The gate worked exactly as designed. Nobody could
 * know to run it, and the repair most available at that point is the one the
 * gate's own text calls maintainer-only.
 *
 * ⚠ Its known limit, stated here rather than discovered later: `exclude` drops
 * files only from tsc's INITIAL WALK, so sources under an excluded directory
 * that a root script IMPORTS are pulled into the program anyway — the ledger
 * note for this entry records 4 of its 80 errors arriving exactly that way,
 * from the showcase example. A path-shaped trigger cannot see an import graph,
 * so a card editing only such a file is still not sent here. That is
 * deliberately NOT closed on this card: the direction is the safe one (this
 * entry under-covers rather than over-covers), and closing it means resolving
 * the program INCLUDING imports, which is a different tool than a path
 * predicate and a different card's scope.
 *
 * ## How these entries stay honest
 *
 * - Every `name` here is resolved against the families actually discovered in
 *   the workflows at runtime. A gate that is renamed, retired or dropped from
 *   CI does not silently stop being suggested — the run prints it as STALE and
 *   says to fix this table. A hand-written list that reports its own rot is a
 *   different object from one that quietly ages.
 * - Every `name` here is an INVOCATION, not a script. One check script can be
 *   wired into CI under two package scripts that answer different questions, and
 *   a rationale that names the script instead of the invocation sends a seat to
 *   a command which cannot reproduce the failure it describes.
 *   `check:type-check-coverage` and `check:type-check-debt` are one file
 *   (`scripts/check-type-check-coverage.mjs`); only the second passes
 *   `--re-measure`, which is the half a new test file's type errors move. This
 *   entry named the first while explaining the second, so a dev seat ran it in
 *   good faith, reported the union green, and CI found four new type errors.
 *   Swept over this tree when that was fixed: the workflows discover 96
 *   families resolving to 73 distinct script files, and 8 of those files are
 *   reached by more than one family — 7 of the 8 in the other shape, a `check:`
 *   script beside a direct `node scripts/check-x.mjs` step in a second
 *   workflow, which `derive` discovers as its own family and prints with its
 *   own runnable invocation. The pair below is the only one where two ROOT
 *   SCRIPTS differ by a flag, so this is a one-off today and what generalises
 *   is the rule, not the fix.
 * - Prose in a `why` is a MODULE-BODY string, so it is scanned for watch hints
 *   like any other literal — comment masking cannot reach it. The ratchet
 *   entry's remedy command therefore spells its `--filter` values unquoted (and
 *   says to quote them for the shell): measured, the shell-quoted spelling adds
 *   both of its glob filter values (the two `./packages` globs, one flat and
 *   one nested) to THIS file's own hint set as hints. That spelling is now
 *   LOAD-BEARING rather than
 *   merely tidy: it used to be inert as well, because `hintCovers` refused a
 *   hint that COLLAPSED to a bare top-level directory, and since #9626 that
 *   refusal reads the hint as written — `packages/*` carries a separator, so
 *   quoting it here would make this file's own prose match every card under
 *   `packages/`. Leave the filter values unquoted. A gate list that fabricates
 *   hints out of its own explanations is the failure this whole script is
 *   written against, and this is the one place in the tree where the trade is
 *   live rather than hypothetical.
 * - Every `name` here is checked against the LIVE workflows by the self-test,
 *   not only by the run that happens to print it. The STALE branch reports rot
 *   to whoever is looking at the output; the self-test case makes the same rot
 *   fail CI, because this table's names are the one enumerable list in the file
 *   and an enumerable list is one a guard can hold.
 * - Each entry is deletable, with a stated criterion:
 *   - test-file entry: when a gate on it grows a discoverable path literal,
 *     the ordinary derivation names it and its line becomes redundant. For the
 *     three ratchets that means a literal naming their POPULATION — the baseline
 *     path each already carries is their own output, and a card editing a
 *     baseline matches through it today without making the gate derivable for
 *     anybody else.
 *
 *     ⚠ "A literal naming their POPULATION" is the whole of that criterion,
 *     and one gate in this kind now fails it while READING as satisfied.
 *     Measured on this tree (#11199, the day PR #12300 landed): of the 2773
 *     tracked test files, the hint route names `check:cross-package-test-
 *     inputs` for 2760 of them — 99.5%, against 0–3.3% for its five siblings
 *     in this same kind — because #12300 taught `hintCovers` to read a glob in
 *     a non-final segment and the deep `packages` glob for TypeScript files
 *     came back to life. (That glob is not spelled here: its own wildcard
 *     closes a block comment.) The hint
 *     is neither this gate's population nor even its own literal: it is
 *     INHERITED from the declaration table the gate imports, where it is ONE
 *     package's declared turbo `inputs` glob (`@objectstack/core`'s, wide
 *     because a single pin test there walks the whole repo with `git
 *     ls-files`). It is a row the gate JUDGES, not a population the gate
 *     DECLARES — so it narrows the day that package's declaration narrows,
 *     which is the direction the gate's own repair advice pushes. And even at
 *     99.5% it reaches no test file outside `packages/**` (10 tracked today,
 *     all under `examples/**`), none with a `.tsx` suffix (3 today, all in
 *     client-react), and none under `apps/**` the day one arrives — while
 *     the KIND reaches every one of them, because the trigger really is "a
 *     test file's content changed, full stop". Both routes are kept (two
 *     routes to one gate is redundancy, not a defect); the KIND is the
 *     load-bearing one. The residue and the inheritance are pinned in the
 *     self-test, so the next reader re-points a red case instead of
 *     re-deriving this paragraph.
 *   - i18n entry: when `check-i18n-bundles.mjs` stops discovering its targets
 *     at runtime and names its POPULATION in its own source — a literal each
 *     owning package path starts with — the path half matches and this entry
 *     is redundant. Growing more prerequisite paths does not qualify; that is
 *     what it already has.
 *   - metadata-form entry: when every extract config passes
 *     `--no-metadata-forms`, no form module can move a committed bundle. That
 *     day the entry stops firing by itself (its `matches` reads the flags), so
 *     delete it only once the opt-out is the permanent shape rather than a
 *     transient one.
 *   - error-code entry: when the vocabulary gate's own source declares the
 *     population it walks in a form this derivation can read — which today
 *     means the bare-root ledger row for it moving off REFUSE-WIDE to a
 *     recorded subtree spelling — the ordinary path match names it and this
 *     entry is redundant. ⛔ Growing the gate's own SHAPES table does NOT
 *     qualify: more stamp positions make the gate see more, and change nothing
 *     about whether a dispatch brief can NAME it. ⛔ Nor does this predicate
 *     going quiet on a given card: it reads content, so silence about a file
 *     nobody can read yet is not evidence in either direction.
 *   - status entry: on the same criterion as the error-code entry. The
 *     conformance gate's source would have to declare the population it walks
 *     in a form this derivation can read, and that means its bare-root ledger
 *     row moving off REFUSE-WIDE, which takes a ruling. ⛔ Growing the gate's
 *     derivation rules does NOT qualify, and ⛔ neither does this predicate
 *     going quiet on a card, for the reason given above.
 *   - root-program entry: when the gate's own source names its root population
 *     in a form this derivation can read — a positive literal, or a generated
 *     manifest of the resolved program — the ordinary path match names it and
 *     this entry is redundant. Growing more measured coupling constants does
 *     NOT qualify: each names one file, and this entry exists for the files
 *     that have no constant yet, which is every new one.
 *   - gate-script entry: when BOTH gates it names declare the population they
 *     judge in a form this derivation can read, the ordinary path match names
 *     them and this entry is redundant. Neither can today, and the reasons
 *     differ, so the criterion is met only when both move:
 *     `bare-root-worklist` walks every family's own files and declares nothing
 *     (deliberately — recognising its species needs a heuristic over constant
 *     NAMES, and #10705 refused to put one on the path that derives every PR's
 *     gate list, which is why this entry names the gate rather than importing
 *     its verdicts); `check:pm-dispatch-gates` declares three tracked FILES,
 *     an artifact roster this tool itself flags as "the shape that reads as a
 *     clearance and is not", so it reaches a card by gate-script identity
 *     alone. ⛔ Growing more roster entries does NOT qualify — that is what it
 *     already has. ⛔ Nor does either gate happening to go quiet: three of the
 *     five measured instances involved a green that proved nothing, because a
 *     sweep that cannot see your file is not evidence about your file.
 *
 *
 *   Delete an entry the day its criterion is met, not before.
 */
export const CHANGE_KIND_ROWS = [
  {
    kind: 'adds or edits a test file',
    matches: 'test-file',
    gates: [
      {
        name: 'check:query-options-erasure',
        why: 'its test-surface ceiling counts sites in *.test/*.spec files, so new test code moves it',
      },
      {
        name: 'check:type-check-coverage',
        why: "the STRUCTURAL half: a package whose test files sit outside every tsc program accounting for it must carry a TEST_DEBT entry, so a new test file no tsconfig reaches moves this one. It re-measures no count — the ratchet is the invocation below",
      },
      {
        name: 'check:type-check-debt',
        why: "the RATCHET half, and the invocation CI runs for it: `--re-measure` re-runs tsc per ledger entry and fails when a count drifts up, so a new test file that does not typecheck cleanly moves it. Needs the workspace closure BUILT — on an unbuilt worktree it refuses outright, and that throw means NOT MEASURED, never `not applicable to me`. Build first, exactly as lint.yml does: pnpm exec turbo run build --filter=./packages/* --filter=./packages/*/* (quote the filter values for your shell)",
      },
      {
        name: 'check:engine-double-contract',
        why: 'it walks every *.test.* file for fake engine doubles and fails when one declares delete()/update() without routing through assertEngineDeleteDispatch/assertEngineUpdateDispatch, against a shrink-only per-file baseline. A new double, or a new test file carrying one, moves it — and so does a delegating pass-through seam wrapping a real engine, which is the reading that missed it twice. Repair by fixing the double, never by raising the baseline. Cheap and whole-tree: one run answers for the whole repo and names the file and line',
      },
      {
        name: 'check:cross-package-test-inputs',
        why: "it walks packages/, apps/ and examples/ for tests that read or import OUTSIDE their own package, and fails when turbo.json's `inputs` for that package does not declare what the test really reads — so a new test, or a new cross-package read in an existing one, moves it. Listed as a KIND rather than by path (#10542): its walk covers 5263 tracked files to judge the 2611 test files among them, so a subtree declaration would name it at 49.6% precision, while the kind names it at the granularity it actually judges. Repair by declaring the input in turbo.json, never by moving the fixture",
      },
      {
        name: 'check:where-matcher',
        why: 'it walks every *.test.ts file for hand-written WHERE matchers and fails on a NEW silently-wrong one (a combinator read as a field name), against a shrink-only baseline. It rides the same test code as the double gate — one new fake engine tripped both, one round apart, because these steps run sequentially inside the ESLint job and the first failure aborts the rest. Conforming by REFUSING the unsupported shape is the convention most of the discovered matchers already follow; the suite cannot notice this class, which is why the gate exists',
      },
    ],
  },
  {
    kind: 'edits a file in a package that owns an i18n-extract.config.ts',
    matches: 'i18n-bundle-package',
    gates: [
      {
        name: 'check:i18n',
        why: "it re-extracts every owning package's translation bundles and fails on drift, so any edit that changes what the extractor emits (an object definition, a label, the config itself) moves it — regenerate with `node scripts/check-i18n-bundles.mjs --write`",
      },
      {
        name: 'check:i18n-stale-fill',
        why: "REVISING an existing source string (a label, description or help text) is the move `check:i18n` cannot see: the extractor's merge fills gaps only, so the regeneration rewrites `en` and LEAVES the previous source text in every translated locale — in sync by key, green gate, superseded draft served forever (#11671). This ratchet fails when a NEW leaf goes stale that way. It needs no build. If your revision stranded a leaf, re-translate it and commit the bundle; regenerating does NOT fix it, because a present-but-stale string is not a gap",
      },
    ],
  },
  {
    kind: 'edits a metadata form module (a *.form.ts the Studio form registry collects)',
    matches: 'metadata-form-module',
    gates: [
      {
        name: 'check:i18n',
        why: "the metadataForms half of the bundles is registry-driven, so a form's sections, field labels, helpText or placeholder are extracted into ONE package's committed bundles — platform-objects today — and a form edit drifts them from a package your diff never touches. This is the edge PR #9113 paid a CI round for. Same repair as the entry above: regenerate with `node scripts/check-i18n-bundles.mjs --write` and commit the moved bundles",
      },
    ],
  },
  {
    kind: 'adds or edits a GATE SCRIPT (a file some discovered check family runs)',
    matches: 'gate-script',
    gates: [
      {
        name: 'scripts/pm/bare-root-worklist.mjs --self-test',
        why: 'a gate whose population is spelled as a BARE top-level word (a separator-less string such as the one naming the package root) builds no watch hint at all, so it lands unnameable by every dispatch brief — and this self-test refuses the tree until a verdict for it is RECORDED. That obligation is a ledger row, not a command, so no amount of running the families you were given surfaces it: four devs learned it from red CI instead, twice within one hour, each AFTER reporting. Three directions bite, which is why an EDIT counts and not only an add: FRESH (a new invisible population, unjudged), STALE (a recorded verdict whose row you renamed or removed), CONTRADICTED (you declared a hint on a gate whose recorded verdict says the population cannot be spelled). The remedy is the one the failure text names: REFUSE-WIDE, REFUSE-UNSPELLABLE, or the subtree-glob idiom beside the constant. ⛔ Declaring a root the gate does not really read is the costlier error, and ⛔ the map is shrink-only, so a new row is never a remedy for a stale one',
      },
      {
        name: 'check:pm-dispatch-gates',
        why: 'the SECOND obligation of the same shape, in this tool, and the one it cannot name for you: a gate that declares a bare top-level word the tree HAS joins the escapable-literal species, and this gate refuses the tree until the literal is either respelled or recorded. It reaches your card by gate-script IDENTITY only — its own declared literals are an artifact roster rather than a population — so a card that merely INCURS the obligation is never named by the path derivation, which is measured, not suspected. Two remedies and which is right depends on what your gate actually READS: it really does walk that root, so declare the subtree spelling beside the literal; or it does not, so respell the literal to say what the predicate means. ⛔ Do not reach for the first by default, and ⛔ the ledger is shrink-only',
      },
    ],
  },
  {
    kind: 'adds or edits TypeScript in the ROOT tsc program (outside the directories tsconfig.json excludes)',
    matches: 'root-ts-program',
    gates: [
      {
        name: 'check:type-check-debt',
        why: 'the ROOT ledger entry (@objectstack/spec-monorepo) IS this program, so a file here moves its raw tsc count even though your diff touches no package — measured, one added bench file put it 19 over and cost a CI round. It is a shrink-only ratchet: the repair is to make the file typecheck, and raising the entry is maintainer-only — ⛔ MAINTAINER-ONLY under the #8435 convention — never the co-equal option. Most of this class is one missing setting rather than real breakage — the root config carries lib ES2020 and no types, so process and console are absent unless the file declares them ambiently. Needs the workspace closure BUILT — on an unbuilt worktree it refuses outright, and that throw means NOT MEASURED, never `not applicable to me`. Build first, exactly as lint.yml does: pnpm exec turbo run build --filter=./packages/* --filter=./packages/*/* (quote the filter values for your shell)',
      },
    ],
  },
  {
    kind: 'adds or edits a file carrying an ADR-0112 error or notice CODE (judged from CONTENT — no path derivation can name this gate)',
    matches: 'error-code-literal',
    gates: [
      {
        name: 'check:dispatcher-error-vocabulary',
        why: 'it sweeps the non-test TypeScript sources under the package root for every site that stamps an error code, and reports each value the registered vocabulary (StandardErrorCode joined with ERROR_CODE_LEDGER) does not contain — so a code arriving through a quoted literal, a SCREAMING_SNAKE constant, a typeof reference to one, or a template moves it. This is the gate no path derivation can name: it computes its own population from a bare top-level root, which the bare-root ledger records as REFUSE-WIDE at 39% of the tracked tree, so it scores the same quiet silence for every card and #12843 paid a CI round trip for that silence. It needs NO build — a source scan, one pass, whole tree, and it names the file and line. Repair by REGISTERING the code where the vocabulary is declared, never by widening a consumer to tolerate it; reconciliation runs BOTH ways, so a table row whose site is gone fails too, and a pending-registration row whose code has since been registered fails as the discharge it is. ⚠ This lead is deliberately WIDE — it fires on a file that merely carries a code-shaped value, not only one that adds a new one — because the wasted run is one cheap gate and the miss is a CI round trip',
      },
    ],
  },
  {
    kind: 'adds or edits a file that binds an HTTP STATUS to an error response (judged from CONTENT — no path derivation can name this gate)',
    matches: 'http-status-emit',
    gates: [
      {
        name: 'check:error-status-conformance',
        why: 'it derives every (code, HTTP status) pair the non-test TypeScript sources under the package root can emit (an error class declaring both, the four-argument sendError door, a code-and-status or status-and-body terminal, an assignment pair on one error) and reconciles that set in BOTH directions with the statuses the error catalog and the error-handling page publish. So a status added, changed or removed at an emit site moves it, and so does a status constant another file resolves. This is a gate no path derivation can name: it walks a bare top-level root that the bare-root ledger records as REFUSE-WIDE, so it scores the same quiet silence for every card, and PR #22311 paid a CI round trip for that silence (#22320). It needs NO build, being a source scan in one pass over the whole tree, and it names the code, the status and the emit site. Repair by DOCUMENTING the status on that code entry (an exception line when the code already publishes another status), or by correcting the emit site when the status is the defect. ⛔ Never by admitting the code to the unpinned baseline, which is ⛔ MAINTAINER-ONLY under the #8435 convention. ⚠ This lead fires on any file that binds a status value, not only one that changes it, for the trade the vocabulary entry above states: the wasted run is one cheap gate and the miss is a CI round trip',
      },
    ],
  },
];

/**
 * The globs that MANDATE a model tier for any card whose file surface touches
 * them, as DATA. This is the one list in this file besides CHANGE_KIND_GATES,
 * and it is here for the same reason: it is enumerable, so a guard can hold it.
 *
 * ## Why a tier is derived here at all (#8640)
 *
 * Gate families used to be hand-recalled per card; this script exists because
 * recall expires. The model tier had the same shape and had not been fixed: the
 * PM recalled the mandatory roots and wrote free prose into the claim comment's
 * `Container & model` line. Measured incident: a card whose surface included
 * `.claude/skills/pm-dispatch/references/review-checklist.md` was claimed as
 * "not under the fable-mandatory roots" and dispatched at opus. One
 * misclassification sentence flowed unchecked from claim to dispatch to model
 * choice, and only a downstream seat's skepticism caught it — at PR time, after
 * the work was done, when the compensation available was a re-review rather
 * than a re-dispatch. Nothing mechanical had compared the recorded surface
 * against the mandatory globs, because nothing mechanical could: the globs
 * lived only in prose.
 *
 * So the invariant this section installs is narrow and total: a mandatory path
 * anywhere in the surface ⇒ the output cannot say otherwise. `deriveTier`
 * refuses to return a result whose parts contradict each other and `tierLines`
 * refuses to render one, in the same shape as the residue partition guard —
 * a derivation that cannot complete exits non-zero rather than printing a wrong
 * answer.
 *
 * ## What this derivation CANNOT promise, stated where it cannot be missed
 *
 * The mandatory-tier policy has two clauses and only the first is a question
 * about paths:
 *
 *   - clause ①, encoded below: a card editing the PM lane's PROTOCOL-SEMANTIC
 *     surfaces is `CONTRACT_REVIEW_TIER` — the pm-dispatch SKILL.md main file, every
 *     file carrying an enforced copy of the decision frame (the COPIES table
 *     of check:skill-frame-sync), the dev-agent definition, and — since the
 *     maintainer's 2026-09-10 ruling (「必须 fable的还包括对外发布的skills」) —
 *     the whole published catalog `skills/**`, which ships verbatim to third
 *     parties (`npx skills add objectstack-ai/objectstack/skills`,
 *     `npm create objectstack`). Narrowed from "the whole skill tree,
 *     references included" by the maintainer's 2026-08-20 ruling
 *     (「接受你的建议」— fable 当审计师用,不当施工队用): references-only
 *     surfaces carry NO path mandate any more (default-tier execution,
 *     compensated by the skills seat's review at CONTRACT_REVIEW_TIER). Still
 *     a file-surface predicate, and exactly what this script takes as argv;
 *   - clause ②, NOT encoded and deliberately not: a card that changes contract
 *     accept/reject behaviour or widens the public surface is built at the
 *     default tier and REVIEWED at `CONTRACT_REVIEW_TIER`. WHO owes that
 *     review is keyed by LANE — the maintainer's lane rule, keyed by seat on
 *     2026-09-10, re-keyed by served tier on 2026-09-16 and restated as the
 *     lane rule on 2026-09-17 (「曾经要求只有 spec 和 skills 需要 fable,其他
 *     opus 就够了,理论上其他车道不需要契约复审」): the spec and skills lanes
 *     owe it on every round they deliver — in-seat when the seat's served
 *     tier is that tier, otherwise by the at-tier review subagent the seat
 *     spawns (the fastest route, per the maintainer) — and every other lane
 *     owes NO contract review: its whole bar is the three landing pre-checks
 *     and the gates, ⛔ no default-tier "self-review" record is demanded of
 *     it and ⛔ no at-tier subagent is spawned from it (neither the triage
 *     seat nor the maintainer-summoned director spawns one for anything). A
 *     clause-② hit outside those two lanes is lane ROUTING, never a review
 *     demand on the lane that found it: the work is the spec lane's,
 *     whichever seat found it, and moves there. Clause ② itself is judged
 *     from the card's CONTENT — what the change
 *     does to the contract — and a path cannot answer it. An ordinary-looking
 *     surface (one package's source file) is the NORMAL shape of a clause-②
 *     card. The closest a path can honestly get is SUSPICION:
 *     SUSPECT_TIER_GLOBS below marks the contract surface itself — its test
 *     files excepted, because tests do not ship — and `--tier` prints a hint
 *     for it — never a verdict. The enforcement lives one step later, in the
 *     PM skill's enqueue gate over the PR's ACTUAL diff.
 *
 * A path derivation that pretended to cover clause ② would produce the failure
 * this whole file is written against, one level up: a "no mandate" line read as
 * a clearance. So the no-mandate output says which clause it checked and which
 * it cannot reach, every time, rather than leaving the reader to remember there
 * were two. The output is a FLOOR, never a ceiling.
 *
 * The sanctioned exits from a mandate — the one-line-class mechanical-edit
 * downgrade (a card CONTENT judgment, like clause ②), the measured quota
 * exemption (the mandated tier EXHAUSTED ⇒ the default tier, never lower — a
 * tier that is RETIRED is not exhausted and is a maintainer ruling instead,
 * ⛔ never a seat's reading) and the proactive low-headroom downgrade — are
 * claim-time judgments, not properties of the file surface. This tool states the mandate; the seat records any exit and
 * its reason in the claim comment. ONE exit is path-shaped, and so it IS
 * encoded: the one-line-class downgrade does not exist for a surface under
 * `skills/**` — the 2026-09-10 ruling's 必须, because a closed enumeration
 * beats a per-line "is this mechanical" call on a catalog third parties
 * install — so that entry carries `oneLineExit: false` and `tierLines`
 * refuses to offer the exit for any card whose surface hits it.
 *
 * ## Why the globs are matched with `hintCovers`, asymmetry included
 *
 * Same matcher as the gate half, so there is one path-comparison rule in this
 * file rather than two — and so a glob gets the segment-boundary semantics for
 * free: a declared surface of `.claude/skills/pm-disp` is not an ancestor of
 * `.claude/skills/pm-dispatch/SKILL.md`, though it is a string prefix of it.
 *
 * `hintCovers` also matches in the other direction — an input that is an
 * ANCESTOR of the glob (a surface declared as `.claude/skills`) counts as a
 * hit. For gate matching that direction is a fabricated lead; here it is the
 * correct one, because the error costs are not the same in the two halves. An
 * over-matched gate pastes a wrong command into a prompt; an under-mandated
 * tier crosses a maintainer guardrail and is only visible afterwards. A surface
 * declared as a directory that CONTAINS a mandatory root may well touch it, so
 * the derivation errs toward the mandate. Both directions are pinned in the
 * self-test.
 *
 * ## Keeping this list from rotting
 *
 * Two guards, both live. Every declared glob must name a path that EXISTS in
 * this tree — a renamed skill root would otherwise leave dead data that
 * mandates nothing while reading as protection, which is the incident class
 * itself. And two globs that cover one path with DIFFERENT tiers is a
 * derivation this file cannot complete honestly (nothing here orders tiers), so
 * it throws rather than picking one.
 *
 * ## One measured side effect of putting a path in a MODULE BODY
 *
 * Comment masking cannot reach a module-body string, so these globs — and the
 * suspect glob below — are watch hints of this file's own source. Re-measured
 * on c48d46d70a over 6840 tracked files: `extractWatchHints` yields 9 hints
 * here, and the four globs of these two tables cover 1026 files between them
 * (1023 of that is the suspect glob's contract surface). The `skills/**`
 * entry (2026-09-10) adds one hint and the 47 tracked files under `skills/`
 * (`git ls-files skills` on ebf9a489), one of which — the published PM
 * skill — the table already covered. That skill was deleted on 2026-09-10
 * (maintainer, verbatim: 「发布版 skills/objectstack-pm-dispatch 删」) and its
 * own entry left with it — a dead glob is refused by the self-test — so the
 * catalog is covered by `skills/**` alone and a catalog file hits exactly ONE
 * entry; the frame-copy half of clause ① now names the internal copy only.
 *
 * They stay inert against a gate that RESOLVES to this file, because no check
 * family does — `check:pm-dispatch-gates` resolves to `check-dispatch-gates.mjs`
 * and matches this file through that file's one constant. If the tool is ever
 * wired as its own gate (a shape `check-dispatch-gates.mjs`'s header measures
 * and refuses), this hint would start printing that gate as MATCHED for every
 * card editing the PM skill — a fabricated lead the refusal recorded there is
 * what prevents.
 *
 * They are inert against a gate that IMPORTS this module for a second reason
 * now, and that one is structural rather than remembered: the module's own
 * `inherited-population` declaration (top of the module body, #11556) names the
 * single population a follower inherits, and these globs are not in it. That
 * closes the class rather than these four literals — a tier glob added tomorrow
 * inherits nothing without someone widening the declaration, and the declaration
 * cannot be widened to a path this file does not spell.
 *
 * The authority for the policy is the maintainer ruling quoted in the PM
 * dispatch skill (2026-08-10 three-tier ruling, clause ① of its 强制条款, as
 * narrowed to protocol semantics by the 2026-08-20 ruling quoted there, and
 * widened to the published `skills/**` catalog by the 2026-09-10 ruling).
 * This table is a machine-readable copy of ONE predicate from it, not a second
 * statement of the policy: when they disagree, the skill wins and this table is
 * the thing to fix. The frame-copy half of the predicate is DEFINED by another
 * gate's table — check:skill-frame-sync's COPIES — and the self-test pins this
 * table as covering every file listed there, so a copy added to that gate
 * cannot silently fall out of the mandate.
 */
export const MANDATORY_TIER_GLOB_ROWS = [
  {
    glob: '.claude/skills/pm-dispatch/SKILL.md',
    tier: 'CONTRACT_REVIEW_TIER',
    why: 'clause ① of the model-tiering ruling (narrowed to protocol semantics, 2026-08-20): the PM dispatch skill MAIN file is the lane\'s own operating protocol and a wrong edit propagates to every later dispatch — references/** dropped out of the path mandate that day',
  },
  {
    glob: '.claude/agents/os-dev.md',
    tier: 'CONTRACT_REVIEW_TIER',
    why: 'clause ① (2026-08-20 narrowing): the dev-agent definition is protocol semantics — every dispatched dev runs under it, and receives the decision frame the PM pastes into its prompt at dispatch time rather than carrying a copy of its own',
  },
  {
    glob: 'skills/**',
    tier: 'CONTRACT_REVIEW_TIER',
    why: 'clause ① (2026-09-10 ruling, verbatim 「必须 fable的还包括对外发布的skills」): the published catalog ships verbatim to third parties by `npx skills add objectstack-ai/objectstack/skills` and `npm create objectstack`, so a wrong edit is installed elsewhere before anyone here reads it — and no one-line exemption applies under this root',
    // The one-line-class mechanical-edit exit is a card-CONTENT judgment
    // everywhere else; here the ruling closes it by PATH (a closed enumeration
    // beats a per-line call on an installed catalog), so it is data, not prose.
    oneLineExit: false,
  },
];

/**
 * The globs that make a surface a clause-② SUSPECT — a HINT, never a verdict.
 *
 * Clause ② is judged from a card's CONTENT; no path predicate can decide it
 * (the docblock above MANDATORY_TIER_GLOBS says why pretending otherwise would
 * recreate the incident class this file exists against). What a path CAN say
 * is where such cards normally land: `packages/spec/src/**` is the contract
 * surface itself — the error-code ledger and the `*.zod.ts` contract schemas
 * live there, and the measured incident shape (a below-tier dispatch flipping
 * accept-to-reject behaviour in the ledger, the same hole passed three times
 * in one day) sat exactly under it. So `--tier` prints a suspicion line for
 * these paths: judge the tier from the card content as best you can, and
 * whichever tier is dispatched, the PR's ACTUAL diff passes the clause-②
 * enqueue gate before the card may enqueue — the diff is a fact; the card's
 * semantics were a prediction. The gate itself lives in the PM skill
 * (入队与落地); this output only points at it.
 *
 * ## Test files are EXCEPTED, by a predicate this file imports (#19936)
 *
 * The enqueue gate's path limb reads this surface, and the review rule it
 * guards (the skill's contract-review reference) owes an at-tier review for
 * `packages/spec/src/**` NON-TEST files only. Without an exception the two
 * disagreed on a test-only diff: the limb demanded an at-tier record that the
 * review rule forbade spawning an agent to write, so an off-tier seat's
 * test-only spec PR could never enqueue. The maintainer's ruling (director
 * batch #219 item 1, letter A, comment 5805897677) settled it toward the review
 * rule: a published-contract change owes the record; a test-only change does
 * not, because tests do not ship.
 *
 * So an entry may carry `except`, a predicate over a path its glob covers, and
 * `deriveTier` drops a path it answers true for BEFORE recording a suspicion.
 * The predicate is `isTestPath`, imported from `check-undeclared-dep-imports.mjs`
 * and never respelled, as the ruling orders ("the repo's own test-file
 * predicate, not a new spelling"). Chosen over the repo's other test predicates
 * on measurement, not taste: that gate's own question is which files under a
 * package's `src/` are published source and which are its tests — the ruling's
 * question exactly; it covers the four shapes the ruling names (`*.test.ts`,
 * `*.pin.test.ts`, anything under `__tests__/`, fixtures under a test
 * directory); and it excepts no directory word a contract domain carries. A
 * census predicate that treats `qa/` as a test directory would drop
 * `packages/spec/src/qa/testing.zod.ts`, a real contract schema — pinned.
 *
 * A subtraction fails SILENT, so this one is held live: the self-test reds if
 * the exception drops any tracked `*.zod.ts` (the package's `files[]` ships
 * every `*.zod.ts` under `src/` verbatim), and if the predicate stops being
 * the imported one. The call hands it the repo-relative path although it was
 * written for package-relative ones; for this glob that is exact, because no
 * segment of `packages/spec/src/` is a test-directory name. ⛔ The exception
 * narrows the SUSPICION only: MANDATORY_TIER_GLOBS carries none, and an input
 * that CONTAINS the contract surface (a directory surface such as
 * `packages/spec`) is still a suspect, since the predicate answers no for it.
 */
export const SUSPECT_TIER_GLOB_ROWS = [
  {
    glob: 'packages/spec/src/**',
    why: 'the contract surface (error-code ledger, *.zod.ts contract schemas) — the normal landing zone of a clause-② card',
    except: 'test-path',
    exceptWhy: 'a test file ships nothing, so a test-only diff changes no published contract and owes no at-tier record (the review rule already reads non-test files only)',
  },
];

/** The tier floor for a card with no mandate — the ruling's 最低下限. */
export const TIER_FLOOR = 'sonnet';

/** The default judgment tier for a card with no mandate — the ruling's 默认判断档. */
export const TIER_DEFAULT = 'opus';

/**
 * Tier family words a maintainer ruling has RETIRED — none today.
 *
 * ⛔ Not a tier table and ⛔ not an ordering — a RETIRED-SPELLING guard, the
 * same shape as the retired clause-② keys pinned further down. The self-test
 * asserts no rendering contains one, so the day a ceiling is written down by
 * hand again it reds instead of quietly outliving the harness that served it.
 *
 * EMPTY is this list's correct steady state, ⛔ not a disabled guard. A word
 * enters it only on the maintainer's explicit ruling that names a retirement
 * and leaves it only on a ruling that brings the tier back — the conditions
 * {@link CONTRACT_REVIEW_TIER}'s docblock states; the one entry this list held
 * was written on a session's quota refusal, which is none of those. Because an
 * empty list clears every rendering for free, the self-test proves the guard
 * on a MUTATED copy — a list naming a word the ladder really prints has to red
 * — so the green above it is measured rather than vacuous.
 */
export const RETIRED_TIER_WORDS = Object.freeze([]);

/**
 * ## A GENERATED, git-ignored module is reached through its committed SOURCES (#22554)
 *
 * `packages/spec/src/migrations/registry.ts` left git under ruling B on #22554:
 * it is generated whole, on install and at build, from `registry.ts.template`
 * and the per-entry files under `entries/`, and git never sees it. So the hint a
 * gate's import yields — `packages/spec/src/migrations/registry`, or the
 * module's full path where a gate spells it — names a file no card can touch.
 * A card that changes what the module CONTAINS edits its sources instead, and
 * with nothing here such a card derived none of the families that import the
 * registry: the silent under-derivation #12514 repaired, back by another door.
 *
 * Each row names a generated module and its committed sources. The module's
 * hint, spelled with or without a `MODULE_SPECIFIER_EXTENSIONS` extension,
 * covers a source FILE or anything under a source DIRECTORY, and nothing more:
 * not a sibling, not the generator, not the package manifest. The engine's
 * `generatedModuleSources` finds a row and `hintCovers` applies it; the rows
 * themselves are data, here, like every other declared table the engine reads.
 *
 * DECLARED rather than derived, and why. That a module is generated and
 * git-ignored IS derivable from the tree (an untracked path `git check-ignore`
 * covers). WHICH files it is generated from is written in one place only, its
 * turbo task's `inputs` — and those also name the package manifest and the
 * generator script, so reading them would hand every card that touches the spec
 * manifest the registry's families: a widening this file prices per pair, and
 * not the mapping ruled. So the sources are a declared row, and the self-test
 * proves every row against the tree on each run — the module untracked and
 * ignored by a TRACKED ignore file, every source tracked — so a row that stops
 * being true reds instead of quietly matching nothing.
 */
export const GENERATED_MODULE_SOURCES = Object.freeze([
  Object.freeze({
    module: 'packages/spec/src/migrations/registry.ts',
    sources: Object.freeze([
      'packages/spec/src/migrations/registry.ts.template',
      'packages/spec/src/migrations/entries',
    ]),
  }),
]);
