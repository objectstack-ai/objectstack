#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dispatch-gates (#7341 item 4) — map a card's file surface to the `check:*`
 * gate families that watch it, and to the model tier its paths MANDATE, both
 * derived from the tree AT RUNTIME.
 *
 *   node scripts/pm/dispatch-gates.mjs <path> [<path> ...]   # e.g. packages/spec/src/data/filter.zod.ts
 *   node scripts/pm/dispatch-gates.mjs --residue <path> ...  # + name every family the derivation did not place
 *   node scripts/pm/dispatch-gates.mjs --tier <path> ...     # the tier verdict alone, for the claim comment
 *   node scripts/pm/dispatch-gates.mjs --commands <path> ... # MACHINE-READABLE: one runnable command per line on stdout, nothing else
 *   node scripts/pm/dispatch-gates.mjs --json <path> ...     # MACHINE-READABLE: the whole derivation as one JSON document
 *   node scripts/pm/dispatch-gates.mjs --ran <file> ...      # VERDICT: reconcile what you RAN against what this derives; exit 1 if any family is unrun
 *   node scripts/pm/dispatch-gates.mjs                       # NO paths: derive them from git, off the merge base
 *   node scripts/pm/dispatch-gates.mjs --changed             # the same, said out loud
 *   node scripts/pm/dispatch-gates.mjs --repo <owner>/<name> ...  # refuse unless this checkout IS that repo
 *   node scripts/pm/dispatch-gates.mjs --tier --repo <sister> <path> ...  # a GOVERNED sister repo's tier verdict, from the path globs ALONE
 *   node scripts/pm/dispatch-gates.mjs --self-test [--fast]   # the battery; --fast runs the fast tier alone
 *
 * A path NAMED on argv that is not in this tree has two readings — a surface of
 * THIS repo that is not written yet, and a path belonging to ANOTHER repo — and
 * a repo-relative path cannot tell them apart. Unasserted, that is NOT MEASURED
 * and the run ends at exit 3 rather than picking the harmless reading: add
 * `--repo <owner>/<name>` naming THIS checkout to derive as a not-yet-written
 * path, or name the other repo and be refused with both repos named (exit 2).
 *
 * ## Run --self-test DETACHED on an agent container (#14281)
 *
 * The battery re-spawns this tool's own CLI as a child process many times —
 * deliberate (see `check-dispatch-gates.mjs`'s header for why a self-test this
 * size is not fixture-only) — and on an agent container it now runs
 * cap-SIZED, not cap-exceeding: since #18201 made discovery run once per tree
 * per process instead of many times over, it fits inside a quiet container's
 * foreground command cap with room to spare — but the cap is a property of
 * the CALLER's container and the margin a property of how contended it is,
 * neither of which this file can see, and an agent box runs several agents at
 * once. Do not run `--self-test` (or `pnpm check:pm-dispatch-gates`, which is
 * exactly that flag) in the foreground there. Detach it and poll the log
 * instead:
 *
 *   nohup pnpm check:pm-dispatch-gates > /tmp/pm-dispatch-gates.log 2>&1 &
 *
 * then tail the log file until it stops growing. Each case's `✓`/`✗` line
 * prints the moment that case is decided, so a run killed mid-battery — by
 * this cap, or by anything else — still leaves every case decided before the
 * kill in the log, readable as a partial result rather than a silent zero. The
 * measured runtime and case count are not repeated here — they move with the
 * tree and belong to a named commit, not to this header (see #14281 for the
 * reading that motivated this section).
 *
 * ## Harvest the machine-readable modes, never this prose (#13462)
 *
 * The matched block renders in TWO spellings — `pnpm check:NAME` and
 * `node scripts/check-NAME.mjs` — because lint.yml invokes many gates directly
 * (its GATE INVOCATION IDIOM, which is deliberate, justified, and NOT the
 * defect). A consumer that greps ONE spelling out of the printed block takes a
 * third of the list and is told nothing: measured, 8 of 12 on one real card,
 * with every command in the short list passing. `--commands` and `--json` exist
 * so no consumer has to pattern-match this prose at all, and the human footer
 * prints the spelling split so an un-migrated harvest is visibly short against
 * this tool's own count. See `spellingSplit` for the measurement, and for why
 * the COUNT alone would have signed off on the wrong list.
 *
 * ## The OTHER axis a harvest is lost on: the SECTION (#13642)
 *
 * The paragraph above is about two SPELLINGS inside one block. The harvest is
 * lost a second way, across the block boundary: this card's runnable answer
 * lives in a path-derived block AND a differently-shaped convention block, and
 * a consumer who pattern-matches one section's shape takes a strict subset.
 * Measured twice in one night by two independent devs, on
 * `check:system-context-census` and `check:engine-double-contract`, both times
 * after the header above already said never to harvest this prose — and a
 * third reader, the dispatching PM, misread the same output a third way. It
 * defeats the discipline built to stop it: both devs re-derived from the tree
 * rather than from memory, which is the correct practice, and still under-ran.
 *
 * ⛔ Not fixed with another output mode — `--commands` IS the flat list and it
 * already existed on both nights. Fixed by making a partial harvest
 * DETECTABLE: `familyReconciliation` states the union's total in the human
 * rendering with the arithmetic tying it to both sections, and
 * `spellingFooterLines` no longer spells its matched-block subtotal in the
 * vocabulary of a total. See those two for the measurements.
 *
 * ## The THIRD link, and the one no better list can close: EXECUTED (#13774)
 *
 * The two sections above are about a harvest that comes out SHORT. `--ran`
 * answers the next link in the same chain — harvested ⟶ executed — and it is a
 * different defect, not a stronger version of the same one. Measured: a dev
 * harvested this tool's list correctly, twice, with `--commands`; the gate that
 * later reddened CI was named explicitly in both harvests; and the list was
 * then used only to diff the two derivations against each other, never as a
 * checklist. Of the 62 families its union named, 19 had been run. ⭐ A better
 * list does not make anyone run it, so #13642's remedy — a perfect flat list —
 * leaves this hole exactly as wide as it was.
 *
 * Getting one CI red out of 43 unrun families was luck, and the report that
 * preceded it was honest, named real green families, and claimed a coverage it
 * did not have. That is the shape: a partial run is INVISIBLE unless something
 * compares the two lists, and the comparison has to be an exact set difference
 * against this tool's own output taken as an external artefact — never a count,
 * never a running total, never a matcher written per dev per card. Three
 * independent devs produced three confident, well-formed, false claims of
 * complete coverage: one made no comparison at all, one wrote a prefix matcher
 * that reported 0 where the raw comparison scored 36, and one did arithmetic
 * over its own loop counter that balanced perfectly because the missing family
 * had left the numerator and the denominator in the same operation.
 * `runReconciliation` carries all three measurements and what defeats each.
 *
 * The capture idiom is the load-bearing half, and it is one line: RECORD THE
 * COMMAND THIS TOOL PRINTED, as it runs, byte for byte — and record WHAT IT
 * ANSWERED beside it.
 *
 *     node scripts/pm/dispatch-gates.mjs --commands > gates.list
 *     while IFS= read -r cmd; do
 *       eval "$cmd" > "logs/$n" 2>&1; status=$?          # BEFORE any pipe
 *       printf '%s :: exit %d\n' "$cmd" "$status" >> ran.list
 *     done < gates.list
 *     node scripts/pm/dispatch-gates.mjs --ran ran.list      # exit 1 if any family is unrun
 *
 * Both sides of that comparison are then strings this file emitted from one
 * expression, so there is nothing to normalise and no shape for a matcher to
 * be lenient about. ⛔ Do not build the record from log FILE NAMES: that is the
 * step that needs a slug, and the slug is where the first hand-built
 * reconciliation went wrong.
 *
 * ⭐ The `:: exit <code>` half is OPTIONAL and it is the difference between a
 * measurement and a claim. A bare line says only "I ran it", and a gate that
 * refused with `PREREQUISITE NOT MET` is indistinguishable there from one that
 * passed — so the NOT-MEASURED count over bare lines is whatever the runner
 * remembered to declare, which is a claim. Measured across four consecutive
 * deliveries (#17204): the tool printed `0 NOT-MEASURED` on every one of them
 * while 2, 2, 1 and 2 gates respectively had exited 3, the truth carried only
 * by each runner's prose beside the tool's own line. With the code recorded the
 * class is DERIVED here and cannot be forgotten; without it, every count this
 * mode prints says `CLAIMED` in the same stroke.
 *
 * ## This tool answers about the tree it RUNS IN, and says so on every run
 *
 * It lives in one repo and derives from that repo's workflows and check
 * scripts. Handed another repo's paths it used to answer anyway — confidently,
 * well-formed, exit 0, about the wrong tree. Every derivation now opens with a
 * banner naming the repo and commit it came from, and `--repo` turns a caller's
 * expectation into a checked assertion that refuses on mismatch. See the
 * cross-repo guard section for what can be detected honestly and what cannot.
 *
 * ## Two input modes, because there are two questions (#9320)
 *
 * PATHS PASSED — the PM's form, at dispatch time. The card's file surface is a
 * hypothesis about files that may not exist yet, so no git range can answer it
 * and the caller's list is the only possible input. Unchanged, including
 * `--tier <paths>`.
 *
 * NO PATHS — the dev's form, mid-branch: "which gates does the diff I actually
 * wrote implicate?" That list used to be the caller's job too, and the obvious
 * spelling of it (`<base>..HEAD`, two-dot) is wrong on any branch that outlived
 * a sibling merge. It is computed here now, from the merge base, and the
 * provenance goes to STDERR so `--tier` output stays paste-clean. See
 * `changedPathsFromGit` for the measurement and for why a shallow checkout
 * makes it refuse rather than fall back.
 *
 * The tier half is a FLOOR from paths only, and it says so on every run: see
 * MANDATORY_TIER_GLOBS for what it encodes (clause ①, a file-surface
 * predicate) and what no path derivation can reach (clause ②, judged from the
 * card's content).
 *
 * ## Why derived, never listed
 *
 * The step-5 dispatch template's "Local gates for this card" line is filled by
 * the PM, and the gate inventory is a thing that expires SAME-DAY: it grew
 * twice in one 2026-08-08/09 shift (#6672 added `check:kernel-hook-pairs`,
 * #6661 added `check:app-nav-i18n`), and even "the farm lives in lint.yml" is
 * a memory-shaped claim — measured on #7341's own dispatch-time survey, checks
 * also live in ci.yml / spec-liveness-check.yml / validate-deps.yml /
 * release.yml / showcase-smoke.yml. #6492 is the canonical incident for a
 * second copy of a list rotting inside prose (three mutually-contradicting
 * counts, drifting within one hour), and #6865 for relaying remembered
 * workflow facts into a dispatch prompt (four of six required-context names
 * lived in a different file than claimed). So this script embeds NO list of
 * checks and NO map from paths to checks: every run re-reads
 * `.github/workflows/*.yml`, follows each `uses: ./.github/actions/…`
 * into that action's `runs:` steps (#19229 — a command executed through a
 * composite action runs on the runner exactly as an inline one does, so it is
 * derived exactly as one), resolves each `check:*` script through
 * package.json, and scans the check scripts' own sources for the path
 * literals they operate on. When the farm grows, the next run sees it.
 *
 * ## What the output means (and what it cannot promise)
 *
 * For each input path, checks are matched from two independent authorities:
 * the workflow's own `paths:` TRIGGER (does CI schedule this job for your
 * surface?) and the path literals discoverable in the check's source ("watch
 * hints" — does this gate read your file?). The first is a declaration, the
 * second is a heuristic:
 *
 *   - a MATCHED check is one CI's own trigger schedules for the input path, or
 *     one whose own source names a directory/file that covers it — high-signal,
 *     paste it into the dispatch prompt. It is printed as the RUNNABLE
 *     invocation (`pnpm --filter <pkg> run check:x` for a package-scoped gate,
 *     `pnpm check:x` for a root-scoped one), not as the bare script name: the
 *     bare name sends a dev to the root `package.json`, where a package-scoped
 *     gate is absent and therefore reads as nonexistent (#7440);
 *   - a check with NO discoverable path hints is counted in the "undetermined"
 *     bucket. It is NOT known to be irrelevant — many gates read the whole tree
 *     or a convention rather than a path. The PM's judgment call stays a
 *     judgment call; what this script removes is the memory-shaped half (which
 *     named checks exist and where they live);
 *   - a check whose sources DO name paths, none of which cover the input, is
 *     counted as "silent". That is the derivation's weakest claim and it used to
 *     be invisible: a gate that computes its population and names only its own
 *     baseline artifact scores silent for every card in the tree. All three
 *     buckets are now accounted for in the closing summary, and `--residue`
 *     names the two unmatched ones runnably — see residueLines. Silence is also
 *     SPLIT there (#10784): a family whose declared literals are all tracked
 *     FILES has named artifacts, not a population, and a roster of the files
 *     that already exist can never contain one added tomorrow — so for a card
 *     under that roster's own directory the verdict is not evidence in either
 *     direction. That is the shape that read as a clearance and was not; see
 *     artifactOnlySilence for what it does and does not claim;
 *   - an UNREACHABLE check is one whose whole declared population matches
 *     nothing in the tree — every path literal its own source names is a path
 *     this repo does not have. It is not a fourth bucket and it is not about
 *     your paths: it is a standing fact about the REPO, swept from the tracked
 *     files, and it cuts across the three verdicts the way the
 *     unfiltered-workflow count does. A family in that state scores the same
 *     quiet green for every card whether it still works or not, which is #4690
 *     one level up. Counted in the summary on every run and named, with the
 *     reason it could not reach, under `--residue` — see unreachableFamilies.
 *     The same fact one grain finer no longer hides (#13312): a DEAD literal
 *     inside a still-reachable family is marked in that family's `names:` line
 *     and counted under it — one live baseline used to walk three fabricated
 *     leads past the reader unlabelled — see deadHintSweep;
 *   - a CONVENTION-TRIGGERED check is one the path derivation can never reach,
 *     because it counts a population it computes for itself and so names no
 *     path literal to match. Those are derived from the change's KIND instead
 *     and printed under their own heading — see CHANGE_KIND_GATES.
 *
 * ## What no verdict above can reach: the always-runs tail (#13333)
 *
 * All five verdicts partition the families this file DISCOVERS. A gate CI runs
 * that discovery never sees is in none of them — not silent, not undetermined,
 * not even unreachable — because a family that is never discovered has no entry
 * to fall into. `runCommandTexts`' header calls that the one output shape this
 * contract forbids, and it shipped again: a dev derived 29 families, ran all 29
 * green, and reddened `Lint & Repo Gates` on
 * `packages/lint/scripts/check-reference-carrier-shape.mjs` — invoked by path
 * from a package, so keyed by neither the root `check:*` namespace nor the
 * `scripts/`-rooted path matcher.
 *
 * ⛔ The instance fix is REFUSED. #12205, #12850 and #13126 each widened a
 * matcher for one such gate and closed; the same red shipped again under a
 * different gate name each time, and #12956 and #13392 are open on it now.
 * Triage ruled it a class on 2026-08-30. So the tail does not extend discovery
 * at all — it reads what CI runs and reports what discovery did not reach, so a
 * gate added tomorrow in any spelling appears with nothing to update here.
 *
 * Measured at the time of writing: 189 unconditional steps across the
 * pull-request workflows CI cannot narrow by path, 162 of them accounted for by
 * a discovered family and 27 not — and the 27 are invisible for at least three
 * unrelated reasons (a package-local path, a non-`node` interpreter, a root
 * script that is not named `check:*`), which is why no widening of the three
 * matchers was going to be the last one. See `alwaysRunSteps` for what the tail
 * excludes and why each exclusion is the safe direction, and for why this is
 * the COMPLEMENT of the "22 leads is the same as none" set rather than a slice
 * of it.
 *
 * ⚠️ It answers ONE branch of that class. The tail says nothing about a
 * derivation that runs on a stale tree (#13392), that prints fabricated leads
 * (#13312, #13449), or that is truncated downstream of this file (#13462) — and
 * a gate whose population is unreachable for the #13126 reason is discovered
 * here, so the tail does not name it either. ⛔ Do not read a green tail as the
 * class being closed.
 *
 * ## Why CI's own trigger is read, and what it does NOT answer (#9171)
 *
 * The watch-hint half asks whether a gate READS your file. CI asks a different
 * question — whether it SCHEDULES the job at all — and answers it from the
 * workflow's `on.pull_request.paths` list. Nothing reconciled the two, and the
 * gap is not theoretical: measured on this tree before the trigger key existed,
 * four workflows declared a `paths:` filter AND contributed check families, and
 * across their declared globs there were 42 (trigger, family) pairs CI would
 * schedule that this derivation named in NEITHER half of its output. The whole
 * `Spec property liveness` job was one of them — all four of its gates score
 * `undetermined` (they read the metadata-type registry, so their sources carry
 * no path literal), so a card editing `packages/spec/**` — the job's own
 * primary trigger — derived none of them. Every dispatch brief tells a dev to
 * derive the gate union with this script and run it; where the derivation is
 * silent and CI is not, following the instruction exactly still under-runs.
 *
 * The trigger list is READ, never mirrored: adding a hand-written map from
 * `packages/spec/**` to `check:liveness` would install a second copy of a fact
 * the workflow already states, which is the drift this file's whole contract
 * exists to refuse. `extractTriggerPaths` re-reads the workflow on every run, so
 * a trigger edited tomorrow moves the derivation with nothing to update here.
 *
 * What the trigger key CANNOT answer is the workflow with no `paths:` filter at
 * all: CI schedules it on every PR, so it discriminates nothing and naming its
 * families for every card would be the "22 leads is the same as none" failure
 * below. Those families stay with the watch-hint derivation, and the count of
 * them is printed in the residue rather than left as an absence — a schedule
 * this tool cannot narrow is a fact the reader is owed, not one to keep quiet.
 *
 * ## The SCHEDULED-only routing question, measured and DEFERRED (#14899)
 *
 * The section above says what CI's trigger CAN answer. This one records what
 * a card asked it next, and why the answer was to ship a reading rather than a
 * rule. The card: the derivation names `node scripts/pm/check-half-states.mjs`
 * — a live board sweep — for any diff carrying a changeset, on the reading
 * that its only caller is a `schedule`-triggered workflow, so CI never runs it
 * on a PR while the dispatch protocol tells a dev to run every printed
 * command. The proposed general repair was a third withholding class beside
 * the CI-measured and value-bearing ones: "scheduled-only, not a PR gate".
 *
 * Measured first, from the workflow text at fa8c1963 (2026-09-04):
 *
 *     .github/workflows/*.yml                                            30
 *       declaring `schedule:`                                            15
 *       …of those, contributing a discovered check family                 8
 *     discovered families                                               252
 *       reaching a scheduled workflow at all                             21
 *       reached ONLY through scheduled workflows                         10
 *       SCHEDULED-ONLY — reached by no PR-time trigger                    0
 *
 * All ten candidates dissolve on the same fact, and it is a deliberate repo
 * posture rather than an accident: every patrol here declares a
 * `pull_request:` trigger with a `paths:` filter naming its own script, so
 * "changes to the patrol itself get exercised before they merge"
 * (`half-state-patrol.yml`'s own comment, and the same words in
 * `required-set-patrol.yml`, `release-coverage-patrol.yml` and
 * `merged-branch-reaper.yml`). The card's own specimen is one of those ten:
 * `half-state-patrol.yml` already carried that trigger on the day the card was
 * filed. Three of the ten are `validate-deps.yml`'s, including
 * `check:override-consistency` — a gate every dependency card must run. So
 * "its only source workflow declares a schedule" is not close to "no PR runs
 * it", and a class keyed on that predicate would have withheld gates a dev
 * owes.
 *
 * The reading does not turn on where the PR-time line is drawn either:
 * narrowing `PR_TIME_TRIGGER_EVENTS` to `pull_request` alone leaves the same
 * zero, because every one of the ten is reached through a `pull_request`
 * trigger specifically.
 *
 * ⛔ So the class is NOT shipped: an empty classification is a capability with
 * nothing in it, the speculative-capability shape `extractTriggerPaths`'
 * `paths-ignore:` boundary already refuses two sections down — "when one does
 * and its families matter, model it then". The cost the card measured (3m09s
 * of a dev's wall clock, plus shared API quota) is separately gone: #15083
 * classified that invocation VALUE-BEARING off its `$PROVENANCE` argv, so it
 * left `--commands` without any scheduled-only rule existing.
 *
 * What ships is the reading, and that is the load-bearing half. A deferral is
 * only honest while its population stays empty, and nothing was watching that:
 * `declaredTriggerEvents` re-takes the measurement from the workflow text on
 * every `--self-test`, so the day a family really is scheduled-only the pin
 * reds on the PR that creates it. Two exits from there, and the pin's own case
 * names both: give the workflow the `pull_request` paths trigger every patrol
 * here already carries, or ship the class this section defers. ⛔ Neither exit
 * is "edit the pin's expectation" — the zero is a reading, not a roster.
 *
 * ## Why a declaration can only NARROW, and what that guarantee costs (#12842)
 *
 * `declaredInheritedPopulation` refuses any path its own module does not
 * already spell, so a declaration can only ever REMOVE leads a caller would
 * otherwise inherit — never invent one, and never hide a real population. That
 * is a property this file asserts without reading any declaration's intent,
 * which is what lets every dispatch built on this derivation be trusted without
 * re-deriving it. It has a measured price, recorded here rather than left to be
 * rediscovered card by card.
 *
 * A hint is a path PREFIX and `hintCovers` matches subtrees, so no declaration
 * can express "the compiled subset of this tree". `cli-build-prerequisite.mjs`
 * declares `packages/cli/src` — the honest spelling, since the CLI's source
 * tree really is what compiles into the command `check:i18n` and
 * `check:i18n-coverage` spawn — and that prefix also names the 101 interleaved
 * test files under it plus `src/utils/console-route-ledger.ts`. All 102 are
 * excluded by `packages/cli/tsconfig.build.json`, so none can change a byte of
 * the `dist/` those two gates read. Measured on b1a987e4a, over the 322 tracked
 * files of `packages/cli`:
 *
 *                                    BEFORE #12841   AFTER
 *     covered by the inherited hints       322         214
 *       really read by the gates           112         112
 *       false leads                        210         102
 *
 * 102 files per gate — 204 (file, gate) pairs across the family. Priced the
 * same day, over the 4076 first-parent commits on `origin/main` in the 30 days
 * to 2026-08-28: 35 of them named these gates while provably unable to move
 * them (0.86% of all landings, 10.5% of the 332 touching `packages/cli`), and
 * each such card pays about 3m30s of compute to reach any reading at all —
 * both gates refuse outright on an unbuilt tree, `check:i18n` after a 56-task
 * CLI closure build and `check:i18n-coverage` only after a full `pnpm build`,
 * which its own second prerequisite demands one round LATER. Roughly two hours
 * of fleet compute per 30 days, before queueing.
 *
 * Maintainer ruling, 2026-08-28 (#12842): pay it. A mechanism that lets a
 * declaration SUBTRACT is a mechanism that can subtract a REAL population, and
 * that failure would be SILENT — a gate quietly no longer watching live code
 * while every dispatch order still reads normal. Today's cost is loud and
 * self-limiting; the trade runs the wrong way. ⛔ Do not give
 * `declaredInheritedPopulation` a subtraction spelling — not a marker suffix,
 * not a second marker.
 *
 * The recorded fallback, should the price ever escalate, is to apply a
 * classifier on the DERIVATION side for named gate families, so that no
 * declaration expresses anything. ⚠️ Two measured caveats it must carry:
 * `isTestFilePath` reaches 100 of these 102, not all of them (it judges the
 * filename infix, deliberately, so the `__tests__/` helper and the ledger file
 * both fall outside it), and every use of it in this file today is ADDITIVE —
 * see CHANGE_KIND_GATES — so this would be the first SUBTRACTIVE rule inside
 * the derivation itself. ⛔ Consulting the package's own `tsconfig.build.json`
 * instead is worse rather than better, and measurably so: an edit to that file
 * names ZERO i18n-family gates today (measured on b1a987e4a; nine other
 * families are named in the same run, so the zero is a reading, not a broken
 * instrument), so the input doing the subtracting would be one nobody is ever
 * named for.
 *
 * ⚠️ ORDER, carried from the card: the mirror axis is UNDER-naming (#12322,
 * fixed in e980f6448 / PR #12476 and still open on its own terms), and that is
 * exactly what a subtraction would put back at risk. Revisiting the rejected
 * option requires that card closed and re-verified FIRST.
 *
 * The output is print-only and exits 0 on a completed derivation; a run that
 * cannot read the workflows, package.json, or the tracked-file corpus the
 * reachability sweep needs exits non-zero (#4690: unreadable input must never
 * look like an empty answer). The no-path mode inherits that rule for its own
 * input: a change set it cannot compute, and a change set that comes back
 * empty, both exit non-zero rather than derive over nothing. The sweep
 * inherits it twice — over an empty corpus, and over an answer in which EVERY
 * declaring family reached nothing, which is a broken recognizer wearing a
 * finding's clothes.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import process from 'node:process';
import {
  anyConfigExtractsMetadataForms,
  findExtractConfigs,
  findMetadataFormModules,
  isExtractConfigPath,
  isMetadataFormModulePath,
} from '../i18n-bundle-surface.mjs';
// The number a refusing gate exits with, READ from the one module that declares
// it rather than spelled again here. `--ran` classifies a recorded exit code by
// this constant, so a repo that ever renumbered the class would move this tool
// with it instead of leaving a stale 3 behind in a second copy (#17204).
import { EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';
import { blank, maskComments, scanSource } from '../js-comment-mask.mjs';
import { invokedAs, isEntrypoint } from '../invoked-as.mjs';
// The human-merge line threshold is declared ONCE, in the landing gate; this
// tool prints the same reading at dispatch time and never carries a second copy.
import { GOVERNED_REPOS, HUMAN_MERGE_LINE_THRESHOLD, SELF_REPO_ID, parseNumstat, sizeVerdict } from './check-governed-merges.mjs';
// The test-file predicate the clause-② suspect table EXCEPTS by, read from the
// gate whose whole question is which files under a package's `src/` are
// published source and which are its tests — never respelled here (#19936). See
// SUSPECT_TIER_GLOBS for why this predicate and not one of the repo's others.
import { isTestPath } from '../check-undeclared-dep-imports.mjs';
// The hand-written tables — ledgers, marker grammars, the change-kind roster, the tier globs — are
// DATA, and live beside this file; this engine loads them, matches paths against them and derives.
// Every table is re-exported under the name it always had, so no consumer moved.
import {
  POPULATION_MARKER_KEYS,
  MARKER_COMMENT_FORMS,
  MARKER_KEY_FORMS,
  REASON_TAIL_MARKER_KEYS,
  PATH_LIST_MARKER_KEYS,
  ROOT_WALK_RESIDUE_LEDGER,
  COMPOUND_ANCHOR_LEDGER,
  GOVERNED_READ_FLOOR,
  TIER_FLOOR,
  TIER_DEFAULT,
  RETIRED_TIER_WORDS,
  ESCAPABLE_LITERAL_LEDGER_ROWS,
  CHANGE_KIND_ROWS,
  MANDATORY_TIER_GLOB_ROWS,
  SUSPECT_TIER_GLOB_ROWS,
} from './dispatch-gates.data.mjs';

export {
  POPULATION_MARKER_KEYS,
  MARKER_COMMENT_FORMS,
  MARKER_KEY_FORMS,
  REASON_TAIL_MARKER_KEYS,
  PATH_LIST_MARKER_KEYS,
  ROOT_WALK_RESIDUE_LEDGER,
  COMPOUND_ANCHOR_LEDGER,
  GOVERNED_READ_FLOOR,
  TIER_FLOOR,
  TIER_DEFAULT,
  RETIRED_TIER_WORDS,
};

// Re-exported so this tool's self-test drives the SAME predicates the gate
// runs, not copies of them. They used to be written twice — see the shared
// module's header, and the i18n entry in CHANGE_KIND_GATES below.
export { isExtractConfigPath, isMetadataFormModulePath };

export const ROOT = new URL('../..', import.meta.url).pathname;

// ── The source maskers are memoised, because discovery masks each file ~12x ──
//
// PROFILED, not guessed. `discoverFamilies` hands the SAME source string to six
// analysers in one pass of its per-family loop — `extractWatchHints`,
// `readProgramTargetsInSource`, `payloadEnvDependence`, `firstPartyImportTargets`,
// `spawnedProgramTargets` and `packageManifestTargets` — and every one of them
// re-derives the masked body from scratch, two of them twice (they mask, then
// hand the masked text to `anchoredReadTargets`, which masks again). One source
// therefore pays `maskComments` about seven times and `maskSelfTests` about five,
// per discovery, for bytes that cannot have changed in between.
//
// The cost that buys: a V8 CPU profile of ONE `discoverFamilies()` call on this
// tree — 201 families, 196 distinct gate sources, 11.8 MB of them — spent 14.3 s,
// of which `maskSelfTests` was 4.5 s of self time (31.7%) and the `maskComments`
// inside those six analysers most of another 5.2 s. That is the largest single
// entry in the profile, and all of it above the first pass is repetition.
//
// So the maskers are memoised on their INPUT STRING. Both are pure functions of
// that string, and JavaScript strings are immutable, so a memo is
// observationally identical to calling through: same bytes in, same bytes out,
// and no caller can edit the shared result under another. ⛔ This changes
// nothing about WHAT is masked, scanned or discovered — it is the same
// derivation run once instead of a dozen times, which is the only kind of
// speed-up this tool may take.
//
// The bound is in BYTES rather than entries because the corpora these run over
// differ by three orders of magnitude: the gate set is ~12 MB and fits whole, so
// repeated discoveries in one process reuse it, while a tracked-corpus sweep
// would otherwise grow the cache without limit. Eviction is oldest-first, and a
// miss after eviction is a recomputation — never a different answer.
const MASK_MEMO_BYTE_BUDGET = 32 * 1024 * 1024;

function memoiseMask(compute) {
  const cache = new Map();
  let bytes = 0;
  return (source) => {
    // A non-string argument is passed straight through: today's behaviour is
    // whatever the masker does with it, and a memo must not be the thing that
    // decides otherwise.
    if (typeof source !== 'string') return compute(source);
    const hit = cache.get(source);
    if (hit !== undefined) return hit;
    const value = compute(source);
    cache.set(source, value);
    bytes += source.length + value.length;
    // `Map` iterates in insertion order, so the first key is the oldest.
    while (bytes > MASK_MEMO_BYTE_BUDGET && cache.size > 1) {
      const oldest = cache.keys().next().value;
      bytes -= oldest.length + cache.get(oldest).length;
      cache.delete(oldest);
    }
    return value;
  };
}

/** `maskComments`, memoised — see the block above. */
const maskedComments = memoiseMask((source) => maskComments(source));

/**
 * `maskSelfTests(maskComments(source))`, memoised — see the block above. It
 * composes through `maskedComments` rather than calling `maskComments` again, so
 * the comment mask is derived once for the callers that want each half.
 */
const maskedModuleBody = memoiseMask((source) => maskSelfTests(maskedComments(source)));

/**
 * ── The `#` half of the same discipline, for the file kind the follow already
 *    admits (#16132) ───────────────────────────────────────────────────────
 *
 * `maskedModuleBody` reads line comments, block comments and a shebang, because every
 * caller it was written for is JavaScript. `PROGRAM_TEXT_TARGET` admits a THIRD
 * kind, and a shell script's prose is none of those three: on a `.sh` source every
 * path a `#` comment mentions came back as a watch hint, because the JS-shaped
 * literal regex reads a backticked path in prose as a template literal and a
 * double-quoted one as a string. Measured on `be92d46`, over the 27 tracked
 * `.sh` files: 37 hints as spelled, 8 once `#` comments are masked, and 8 of the
 * 16 files that spell any hint at all had a population that was 100% prose.
 * `scripts/bump-objectui.sh` was the sharpest — 7 hints, every one of them
 * inside a `#` comment or an `echo` line. Re-taken unchanged after merging
 * `5e53d73d`; the self-test asserts the DIRECTION rather than these numbers,
 * because a reading belongs to a named commit and this one moves whenever a
 * shell script gains or loses a comment.
 *
 * That is the one direction this file refuses everywhere else, stated twice next
 * door: `spawnedProgramTargets` takes a missing lead over a fabricated one, and
 * `readProgramTargetsInSource` blanks comments so a docblock naming a gate is
 * not a read of it. Hint extraction paid for neither, for this kind.
 *
 * ## Why this is a per-LINE recogniser and not a shell parser
 *
 * A `#` opens a comment only at the start of a WORD, and only outside quotes —
 * so `$#`, `${#a}`, `a#b` and a `#` inside `'…'` or `"…"` are not comment
 * starts, and a naive blank-from-`#`-to-end-of-line corrupts exactly the lines
 * worth reading. Quote tracking is therefore real, and it is where the cost of
 * being WRONG is unbounded: one unbalanced quote silently disables the mask for
 * the whole REST of the file, which is the fabricating direction.
 *
 * A flat scanner cannot keep shell's quoting straight, and the measurement is
 * not marginal. Command substitution restarts quoting — `"$(printf '%s' "$x")"`
 * is balanced in shell and reads as three separate spans to a scanner that does
 * not model `$( … )` — and a here-string `<<<` looks like a here-doc introducer
 * to anything that matches `<<` first. A cross-line implementation of both was
 * built and measured on this tree before this one: it left 1,467 comment lines
 * unmasked in `scripts/pm/os-verify-lock.sh` alone and 8 in
 * `scripts/release-spec-changes.sh`, where the two surviving hints were the
 * prose ones this card is about.
 *
 * ⇒ quote state is LINE-SCOPED: it opens and dies on its own line, and nothing
 * is carried across a newline. Every misreading is then bounded to the line it
 * is on, and the residue lands in the OVER-masking direction — a multi-line
 * quoted string or a here-doc body whose line begins with `#` is masked as if
 * it were a comment. That is a missing lead, on text that is data rather than a
 * path the script opens, and it is the direction this file errs in everywhere.
 * ⛔ Do not "fix" it into carried state: that trades a bounded over-mask for the
 * unbounded under-mask measured above.
 *
 * Same projection as `blank` next door — spans become spaces, newlines and byte
 * offsets survive — so this composes WITH the JS mask rather than replacing it.
 *
 * ## The ORDER, and why it is now `#` FIRST (#16744)
 *
 * Masking `#` LAST can only blank more of an already-masked body, so the shell
 * hint set was a subset of the JS-masked one by CONSTRUCTION. That is why the
 * card above took it: it could not widen, and widening was out of its scope.
 * The price it left unpaid is the OTHER direction of the same "THIRD kind"
 * defect. A `#` comment spelling `@objectstack/*`, a glob, or any other
 * two-character block-comment opener is not a comment to the JS scanner — it
 * opens a BLOCK comment that runs to the next terminator and blanks every line
 * of real shell CODE in between, with nothing in the output saying a region was
 * skipped. Re-measured per byte on `ce7bae8b`, over the 31 tracked `.sh` files:
 * 12 of them hand a caller shell code as prose, 73,859 bytes in
 * `scripts/pm/os-verify-lock.sh` alone.
 *
 * So `#` is masked FIRST now: shell prose never reaches the JS scanner and
 * cannot open a phantom comment. This UNCOVERS the code below such a comment
 * and therefore ADDS hints — 2 on this tree, `node_modules/@objectstack/spec/dist`
 * in `scripts/downstream-smoke.sh` and one site in
 * `.claude/hooks/guard-tree-enum.sh`, both of them real code the follow was
 * blind to. ⛔ The shell hint set is therefore NOT a subset of the JS-masked one
 * any more, and the live sweep in the self-test pins what the additions ARE —
 * ⛔ never that there are none, which is the blindness this removed.
 *
 * The JS mask still RUNS on a shell source, and still runs BEFORE
 * `maskSelfTests` as that function's header requires. Keeping it is the whole
 * difference between this order and "do not run the JS scanner over a non-JS
 * kind at all": the latter also drops the `//` masking pinned below on a `.sh`
 * source, which is a reconciliation across both cards rather than this fix.
 *
 * Composed from the raw maskers rather than through `maskedModuleBody` — the
 * intermediate is a DIFFERENT string on this path, so there is no half to
 * share, and routing it through the JS memo would only fill that cache with
 * shell-derived keys no JS caller can hit. The memo below is keyed on the raw
 * source, so the whole chain is still derived once per source.
 */
const SHELL_WORD_START = /[\s;&|()<>]/;

function shellCommentSpans(source) {
  const n = source.length;
  const comment = new Uint8Array(n);
  let quote = '';
  // The character before the cursor, as the WORD rule sees it. A newline reads
  // as a word boundary, so a `#` in column 0 is a comment start.
  let prev = '\n';
  let i = 0;
  while (i < n) {
    const ch = source[i];
    if (ch === '\n') {
      quote = '';
      prev = '\n';
      i++;
      continue;
    }
    if (quote) {
      // A backslash escapes inside `"…"` and is literal inside `'…'`.
      if (quote === '"' && ch === '\\' && i + 1 < n && source[i + 1] !== '\n') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < n && source[i + 1] !== '\n') {
      prev = 'x';
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      prev = 'x';
      i++;
      continue;
    }
    if (ch === '#' && SHELL_WORD_START.test(prev)) {
      while (i < n && source[i] !== '\n') comment[i++] = 1;
      continue;
    }
    prev = ch;
    i++;
  }
  return comment;
}

/**
 * The source with its `#` COMMENT spans blanked — the shell counterpart of
 * `maskComments`, and the same projection: spaces in, newlines and offsets kept.
 */
export function maskShellComments(source) {
  return blank(String(source), shellCommentSpans(String(source)));
}

/** `maskSelfTests(maskComments(maskShellComments(source)))`, memoised — see the block above. */
const maskedHashCommentBody = memoiseMask((source) =>
  maskSelfTests(maskComments(maskShellComments(source))),
);

// ── What a gate that IMPORTS this module inherits (#11556) ─────────────────
//
// This module is importable and is NOT a discovered gate file — `check:pm-dispatch-gates`
// resolves to `check-dispatch-gates.mjs`, which reaches the tool by `spawnSync`, so the
// follow's "never open a module that is itself a gate file" rule does not cover it. A gate
// that imports it therefore inherits its module-body literals as watch hints. Measured on
// c48d46d70a, over 6840 tracked files: nine literals, covering 2660 of them. Exactly ONE is
// a population this file opens (the workflow directory `discoverFamilies` readdirs, 28
// files); the other eight are the package-manifest join bases `discoverFamilies` builds
// paths FROM and the tier globs `MANDATORY_TIER_GLOBS`/`SUSPECT_TIER_GLOBS` declare — 2632
// pairs of population no caller reads.
//
// Until now the only thing standing between that and a dispatch prompt was prose in ONE
// caller's header (`check-dispatch-gates.mjs`, #8162): a convention held by the caller that
// remembered, not a property of this module. The line below makes it the module's own
// declaration, read fresh on every run and held to a subset of what this file really spells
// — see `declaredInheritedPopulation`.
// dispatch-gates: inherited-population .github/workflows .github/actions -- the two trees this tool opens: the workflow directory it readdirs and the composite actions those workflows `uses:` (#19229); every other module-body literal here is a package-manifest join base or a tier glob, not a path this file opens (#11556)

// ---------------------------------------------------------------------------
// Extraction — pure functions over file contents, self-testable offline.
// ---------------------------------------------------------------------------

/**
 * A `run:` value that is a YAML block-scalar HEADER (`|`, `>`, with any
 * chomping/indentation indicator) carries no command of its own: the commands
 * are the lines indented beneath the key.
 */
const BLOCK_SCALAR_HEADER = /^[|>][+-]?\d*$/;

/**
 * The command text of every `run:` step in a workflow, one string per step,
 * with whole-line `#` comments removed.
 *
 * ## Why the body of a block scalar has to be read
 *
 * The obvious spelling — one regex for `run:` and take the rest of the line —
 * reads only the steps whose command fits on the `run:` line itself. A step
 * written as a block scalar puts `|` there and its commands on the FOLLOWING
 * lines, so that spelling collected the string "|" and never saw the commands.
 * Measured on this tree at the time of writing: six gate families were invoked
 * exclusively from block-scalar bodies (`check-adr-0087-registration`,
 * `check-empty-changeset`, `check-shard-attestation`, `check-osv-exemptions`,
 * `check-test-completeness`, `check-cross-package-test-inputs`) and were
 * therefore absent from the derivation ENTIRELY — not matched, and not in the
 * "undetermined" bucket either, because a family that is never discovered has
 * no entry to fall into it. That is the one output shape this script's contract
 * forbids (a gate the derivation cannot mention at all), and it cost PR #8399 a
 * CI round: its declared-breaking changeset derived `check-changeset-no-major`
 * (a one-line `run:`, so visible) but not `check-adr-0087-registration` (a
 * block-scalar body, so invisible), which is the gate that actually reddened.
 *
 * Nothing downstream needed changing: `check-adr-0087-registration.mjs` names
 * `.changeset` in its own source, so the ordinary watch-hint match fires as
 * soon as the family is discovered at all. The bug was never in the matching.
 *
 * ## Why comments are stripped, and why only whole-line ones
 *
 * Reading a block body means reading the shell comments inside it, and this
 * tree's workflow bodies discuss gates by name at length (ci.yml's shard job
 * spells `check-shard-attestation.mjs` in a comment explaining that gate's own
 * classifier). "Mentions a gate" is not "runs a gate", and a family discovered
 * from prose would be a fabricated lead — the same failure the "22 leads is the
 * same as none" note below rejects for a wider heuristic. Only whole-line
 * comments are dropped: a trailing `# note` after a real command sits on a line
 * whose command still has to be read, and stripping from the first `#` anywhere
 * would corrupt commands that legitimately contain one inside a quoted string.
 *
 * Measured both ways on this tree: stripping changes no family's discovery
 * today (every gate named in a body comment is also really invoked somewhere).
 * It is here so that stops being luck.
 *
 * ## Why the COMPACT step form is read, and what `indent` must count (#9203)
 *
 * A step with no `name:` may be written as a compact block-sequence entry —
 * the list dash and the key on one line:
 *
 *   - run: pnpm check:something
 *
 * That is ordinary YAML and an ordinary Actions step, but `run:` there is not
 * preceded by whitespace alone, so a matcher anchored on `^[ \t]*run:` never
 * saw the line and the step contributed NOTHING to the derivation — the same
 * shape as the block-scalar bug above: not matched, and not "undetermined"
 * either, because a family that is never discovered has no entry to fall into.
 * Latent rather than live when it was fixed: both compact steps in this tree
 * (`showcase-smoke.yml`) run `pnpm install` and `pnpm turbo run build`, so no
 * `check:*` family was hidden — the shape was one workflow edit away from
 * hiding one.
 *
 * The regex widening is the easy half. The load-bearing half is what `indent`
 * counts, because the block-scalar walk below uses it to decide where a body
 * ENDS, and a compact step puts its own sibling keys in the columns the dash
 * occupies:
 *
 *   - run: |
 *       pnpm check:real
 *     env:
 *       NOTE: "... pnpm check:not-run-here ..."
 *
 * Counting only the leading whitespace makes `env:` deeper than the key, so
 * the walk swallows the rest of the mapping into the command text — and every
 * gate NAMED in a swallowed `env:`/`with:` value is then discovered as one the
 * step RUNS. That trades a missing lead for a fabricated one, which is the
 * strictly worse direction (see the "22 leads is the same as none" note in the
 * header): a gap costs a dev one CI round, an invention costs every dev whose
 * surface brushes it.
 *
 * So `indent` is the COLUMN OF THE `run` KEY — leading whitespace plus the
 * `- ` marker when there is one. Settled by measurement against a real YAML
 * parser rather than by inspection, in both directions:
 *
 *   - over-consumption: parsing the fixture above, counting whitespace only
 *     discovers 9 commands where YAML says 8, the extra one being the gate
 *     named in the `env:` value; counting the key column discovers exactly the
 *     8 the parser reports, for every step form in one file;
 *   - truncation: a body indented AT or BELOW the key column is not a body
 *     this walk should keep — under `- run: |` at key column 8, bodies at
 *     column 7 and 8 are YAML *errors* (ParserError / ScannerError) and only
 *     9-and-deeper parse. The `> keyColumn` comparison is therefore the YAML
 *     rule itself, not an approximation of it, and cannot cut a valid body
 *     short.
 *
 * The same reading also makes the two step forms behave identically, which is
 * the point: for `- run:` the key sits at the column `run` starts on, exactly
 * as it does for the `name:`/`run:` form, where this walk has always been
 * right.
 */
export function runCommandTexts(workflowText) {
  return runCommandSteps(workflowText).map((step) => step.text);
}

/**
 * An Actions EXPRESSION, which is the only thing a step's `env:` value can
 * carry that is not a literal.
 *
 * ⚠️ Deliberately NOT `WORKFLOW_VALUE_SOURCE`, which the argv reader uses:
 * that pattern also admits `$NAME` and `${NAME}`, because argv is read by a
 * SHELL and a shell expands them. An `env:` value is not — Actions substitutes
 * `${{ … }}` there and hands the rest through verbatim, so `FOO: $HOME` passes
 * the four characters `$HOME`. Reading the shell forms here would score a
 * literal env value as a workflow value and subtract a runnable command, which
 * is the silent direction `payloadEnvDependence` refuses one screen down.
 */
const WORKFLOW_ENV_EXPRESSION = /\$\{\{[\s\S]*?\}\}/;

/**
 * The names in a step's `env:` block whose VALUE is an Actions expression —
 * the values that step takes from the workflow and passes to its command
 * through the ENVIRONMENT rather than through argv (#15761).
 *
 * `lines` is the whole workflow, and `[start, end)` the step this `run:` key
 * belongs to; the caller derives both from the same indentation walk it uses
 * for the body, so the two readings cannot disagree about where a step ends.
 *
 * ## The boundaries, each with the direction it fails in
 *
 *   - the `env:` key is read only at the step's OWN key column, exactly as
 *     `extractStepBlocks` reads `if:` and for the same reason: a nested `with:`
 *     or a `services:` mapping carries `env:` keys of its own, and reading one
 *     of those would attribute another container's environment to this command;
 *   - only the DIRECT children of that key are read (the first child column,
 *     and lines deeper than it are the value of one of them, never a sibling);
 *   - a flow mapping (`env: {A: …}`) is not parsed at all, and neither is a
 *     job-level or workflow-level `env:`. Both under-report — a family keeps its
 *     place in `--commands` — which is the loud direction: the status quo this
 *     card names, a red the dev has to go read a gate to understand. Widening
 *     either one SUBTRACTS a row, and a subtraction that fires wrongly is
 *     silent. Neither form appears in this tree today.
 */
export function stepEnvExpressionVariables(lines, start, end, keyColumn) {
  const names = [];
  for (let i = start; i < end; i++) {
    const key = /^([ \t]*)(-[ \t]+)?env:[ \t]*(.*)$/.exec(lines[i]);
    if (!key) continue;
    if (key[1].length + (key[2] ? key[2].length : 0) !== keyColumn) continue;
    if (key[3].trim() !== '') continue;
    let childColumn = -1;
    for (let j = i + 1; j < end; j++) {
      if (lines[j].trim() === '') continue;
      const column = /^[ \t]*/.exec(lines[j])[0].length;
      if (column <= keyColumn) break;
      if (childColumn === -1) childColumn = column;
      if (column !== childColumn) continue;
      const pair = /^[ \t]*([A-Za-z_][\w.-]*):[ \t]*(.*)$/.exec(lines[j]);
      if (!pair) continue;
      let value = pair[2];
      if (BLOCK_SCALAR_HEADER.test(value.trim())) {
        const body = [];
        for (let k = j + 1; k < end; k++) {
          if (lines[k].trim() === '') {
            body.push('');
            continue;
          }
          if (/^[ \t]*/.exec(lines[k])[0].length <= column) break;
          body.push(lines[k]);
        }
        value = body.join('\n');
      }
      if (WORKFLOW_ENV_EXPRESSION.test(value) && !names.includes(pair[1])) names.push(pair[1]);
    }
  }
  return names;
}

/**
 * Every `run:` step of a workflow as `{ text, envVariables }` — the command
 * text `runCommandTexts` has always returned, plus the values the STEP passes
 * to it through `env:` (#15761).
 *
 * ## Why the step and not the command text alone
 *
 * `runCommandTexts` reads a `run:` value and throws the rest of the step away,
 * so a value the workflow hands the command through the ENVIRONMENT was
 * invisible to every reader downstream. `.github/workflows/`
 * `partof-closing-keyword-guard.yml` is the specimen: `PR_BODY` and
 * `PR_NUMBER` arrive through `env:` and the argv is bare, so the argv-shaped
 * classifier scored `node scripts/check-partof-closing-keyword.mjs` as a
 * command a dev can paste — while the gate's own refusal says the opposite in
 * its own words ("NOT WIRED — neither PR_BODY nor PR_NUMBER is set … This is a
 * wiring or usage failure, NOT a verdict"). The step is therefore the unit
 * this walk returns, and the command text stays exactly what it was.
 *
 * The step's extent is found with the SAME rule the body walk uses: the step's
 * keys sit at the `run:` key column, so the step ends at the first non-blank
 * line shallower than it — which is the next `- ` dash (a dash is indentation
 * for the mapping it opens) or the dedent out of the steps list. A compact
 * step (`- run: …`) opens its own mapping on the dash line, so the walk starts
 * there; a named step's `env:` may sit either side of its `run:`, so the walk
 * runs backwards from the key as well as forwards from the body.
 */
export function runCommandSteps(workflowText) {
  const lines = workflowText.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)(-[ \t]+)?run:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, lead, dash, inline] = m;
    // The column `run` starts on — the dash of a compact entry is INDENTATION
    // for the mapping it opens, so it counts. See the header block above for
    // the measurement that settles this.
    const keyColumn = lead.length + (dash ? dash.length : 0);
    const runLine = i;
    let text;
    if (!BLOCK_SCALAR_HEADER.test(inline.trim())) {
      text = inline.trim();
    } else {
      // Block scalar: the body is every following line indented deeper than the
      // key (blank lines belong to it too). Advancing `i` past the body is what
      // keeps a `run:` MENTIONED inside a body from being parsed as a new key.
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === '') {
          body.push('');
          continue;
        }
        if (/^[ \t]*/.exec(lines[j])[0].length <= keyColumn) break;
        body.push(lines[j]);
      }
      text = body.filter((l) => !/^[ \t]*#/.test(l)).join('\n');
      i = j - 1;
    }
    let start = runLine;
    if (!dash) {
      let j = runLine - 1;
      for (; j >= 0; j--) {
        if (lines[j].trim() === '') continue;
        if (/^[ \t]*/.exec(lines[j])[0].length >= keyColumn) continue;
        break;
      }
      start = j + 1;
    }
    let end = i + 1;
    for (; end < lines.length; end++) {
      if (lines[end].trim() === '') continue;
      if (/^[ \t]*/.exec(lines[end])[0].length >= keyColumn) continue;
      break;
    }
    out.push({ text, envVariables: stepEnvExpressionVariables(lines, start, end, keyColumn) });
  }
  return out;
}

/**
 * A step's `env:` names minus the ones its command line spells as a shell
 * expansion — the split between the two CARRIERS of one workflow value
 * (#15761).
 *
 * A name the command spells (`"$MERGE_BASE"`, `${OS_ATTEST_DIR}`) is read by
 * the shell, so it is already in the command TEXT and `renderedArgv` has
 * classified it. A name the command does not spell reaches the program only
 * through `process.env`, and that is the carrier no reader of the command line
 * can see — the whole defect this card names.
 *
 * Measured on this tree over the 13 `run:` steps that both carry an `env:`
 * expression and invoke a check: 8 of them spell every one of their env names
 * in the command (the `--base "$MERGE_BASE"` trio in `pr-automation.yml`, the
 * two `check-shard-attestation --verify` steps and the affected-set step in
 * `ci.yml`, `half-state-patrol.yml`'s `--provenance`, `required-set-patrol`'s
 * `$RUNNER_TEMP` redirection), so this filter is what keeps the classification
 * off eight invocations it must not touch.
 */
function envNamesNotSpelledInCommand(commandText, names) {
  return (names ?? []).filter(
    (name) => !new RegExp(String.raw`\$\{?${name.replace(/[^\w]/g, '\\$&')}\b`).test(commandText),
  );
}

/** Strip one layer of YAML quoting from a scalar. */
function unquoteScalar(s) {
  const t = s.trim();
  const m = /^(['"])([\s\S]*)\1$/.exec(t);
  return m ? m[2] : t;
}

/**
 * The entries of a YAML flow sequence (`[a, 'b', "c"]`), in order. Returns []
 * for anything that is not a flow sequence, so a caller can try the block form.
 */
function flowSequenceItems(text) {
  const t = text.trim();
  if (!t.startsWith('[')) return [];
  const inner = t.replace(/^\[/, '').replace(/\]\s*$/, '');
  return inner
    .split(',')
    .map((s) => unquoteScalar(s))
    .filter((s) => s !== '');
}

/**
 * The `on.pull_request.paths` filter a workflow declares, in DECLARATION ORDER
 * (`!` negations included — `triggerListCovers` needs the order to evaluate
 * them). `[]` means the workflow declares no path filter, which is NOT the same
 * as "matches nothing": it means CI schedules the workflow on every PR.
 *
 * ## Why this is parsed at all, rather than mapped by hand (#9171)
 *
 * See the header. The one-sentence version: CI decides whether a job runs from
 * this list, and until it was read, four `paths:`-filtered workflows scheduled
 * gates that no half of this tool's output named. A hand-written map would be a
 * second copy of a fact the workflow already states — the exact drift shape
 * this file refuses everywhere else.
 *
 * ## Why an indentation walk and not a YAML dependency
 *
 * This script is dependency-free by design (it runs from a bare checkout before
 * `pnpm install`, which is when a dispatch is written), and `runCommandTexts`
 * above already established the indentation-walk idiom for the same file
 * format. The walk is deliberately narrow: it reads the `pull_request:` key
 * inside the top-level `on:` mapping and nothing else.
 *
 * ## The boundaries, each with the direction it fails in
 *
 *   - `paths-ignore:` is NOT modelled. A workflow using it parses here as "no
 *     path filter", so its families fall back to the watch-hint derivation —
 *     today's behaviour, a possible MISSING lead, never a fabricated one. No
 *     workflow in this tree uses it; when one does and its families matter,
 *     model it then. Speculative capability is what this repo's own review
 *     standard rejects, and the degradation is safe in the meantime.
 *   - `merge_group:` supports no `paths` at all, so queue builds run these jobs
 *     unconditionally. That only ever WIDENS what CI runs, so ignoring it
 *     cannot make this derivation over-claim.
 *   - `pull_request_target:` is not read: it runs against the base, not the
 *     card's tree, so it is not a gate a dev can pre-run.
 */
export function extractTriggerPaths(workflowText) {
  const out = [];
  let inOn = false;
  let inEvent = false;
  let eventIndent = -1;
  let inList = false;
  let listIndent = -1;
  for (const line of workflowText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = /^[ \t]*/.exec(line)[0].length;
    if (indent === 0) {
      // A new top-level key closes whatever we were inside.
      inOn = /^(?:on|'on'|"on"|true):\s*$/.test(trimmed);
      inEvent = false;
      inList = false;
      continue;
    }
    if (!inOn) continue;
    if (inList) {
      if (indent > listIndent) {
        const item = /^-\s*(.*)$/.exec(trimmed);
        if (item && item[1] !== '') out.push(unquoteScalar(item[1]));
        continue;
      }
      inList = false;
    }
    if (inEvent) {
      if (indent > eventIndent) {
        const key = /^paths:\s*(.*)$/.exec(trimmed);
        if (key) {
          const flow = flowSequenceItems(key[1]);
          if (flow.length) out.push(...flow);
          else if (key[1].trim() === '') {
            inList = true;
            listIndent = indent;
          }
        }
        continue;
      }
      inEvent = false;
    }
    if (/^pull_request:\s*$/.test(trimmed)) {
      inEvent = true;
      eventIndent = indent;
    }
  }
  return out;
}

/**
 * ── The population a job's `if:` names one hop away (#12956) ────────────────
 *
 * `extractTriggerPaths` above reads the one path declaration CI obeys at the
 * WORKFLOW level. A job can carry a second, and this tree's busiest workflow
 * uses only that second one: `ci.yml` declares no `on.pull_request.paths` at
 * all and instead runs a `filter` job whose `dorny/paths-filter` step computes
 * per-area outputs, which every other job then reads in its own `if:`:
 *
 *   filter:                                  console-pin:
 *     outputs:                                 name: Console Pin Gate
 *       console: ${{ steps.changes.outputs.console || 'true' }}
 *     steps:                                   needs: filter
 *       - uses: dorny/paths-filter@v4          if: ${{ !cancelled() &&
 *         id: changes                                needs.filter.outputs.console != 'false' }}
 *         with:
 *           filters: |
 *             console:
 *               - '.objectui-sha'
 *
 * The population is real, correct, and sitting in the workflow file — just
 * expressed one hop from where the derivation read. The measured consequence:
 * a single-file `.objectui-sha` diff derived ZERO families, so the two gates a
 * pin bump exists to run (`check:console-sha`, `check:console-injection`) were
 * named in neither half of the output and reached the dev only from CI.
 *
 * ## What this closes, and what it deliberately does NOT
 *
 * It closes the INDIRECTION: a declared path population the tool could not
 * follow. It does not close, and cannot, the gate that declares no population
 * ON PURPOSE. `check:objectui-pin-citations` is unfiltered because `lint.yml`
 * says a `packages/spec/**` filter "would go dormant on exactly the PR that
 * moves `.objectui-sha`, which is the PR this exists to catch" — the
 * correctness requirement and the derivability requirement are in direct
 * opposition there, and the gate is right. Nothing here gives it a filter.
 *
 * ## Why a strict whitelist rather than an expression evaluator
 *
 * Every refusal below costs a MISSING lead; every over-permissive reading buys
 * a FABRICATED one, and this file errs in the first direction everywhere (see
 * the header's "22 leads is the same as none"). So an `if:` contributes a
 * population only when it reduces, exactly, to filter-output comparisons ORed
 * together. `&&` between two filter outputs would be an INTERSECTION this
 * returns null for rather than guessing; a negated or unrecognised comparison
 * is refused whole. `!cancelled()` is the one term stripped, because it is a
 * status function that discriminates no path — THE FILTER CONTRACT on ci.yml's
 * `filter` job is why every one of these `if:`s carries it.
 */
const JOB_IF_STATUS_TERM = /(?:^|\s)!\s*cancelled\(\)\s*&&\s*/g;
const JOB_FILTER_OUTPUT_TERM =
  /^needs\.([A-Za-z_][\w-]*)\.outputs\.([A-Za-z_][\w-]*)\s*(?:!=\s*(['"])false\3|==\s*(['"])true\4)$/;

/**
 * The `needs.<job>.outputs.<name>` references a job `if:` resolves to, as
 * `[{ job, output }]`, or null when the expression is anything this refuses to
 * read. Null is the safe answer: the job then contributes no population and the
 * family keeps whatever verdict it had before.
 */
export function jobFilterOutputRefs(ifExpression) {
  if (typeof ifExpression !== 'string') return null;
  let expr = ifExpression.trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(expr);
  if (wrapped) expr = wrapped[1].trim();
  expr = expr.replace(JOB_IF_STATUS_TERM, ' ').trim();
  // One balanced outer paren pair at a time — `(A || B)` is the live spelling.
  for (;;) {
    if (!expr.startsWith('(') || !expr.endsWith(')')) break;
    let depth = 0;
    let balanced = true;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') depth--;
      if (depth === 0 && i < expr.length - 1) { balanced = false; break; }
    }
    if (!balanced) break;
    expr = expr.slice(1, -1).trim();
  }
  if (expr === '') return null;
  const refs = [];
  for (const term of expr.split('||')) {
    const m = JOB_FILTER_OUTPUT_TERM.exec(term.trim());
    if (!m) return null;
    refs.push({ job: m[1], output: m[2] });
  }
  return refs.length ? refs : null;
}

/**
 * The `jobs:` mapping's entries, each as `{ id, name, if: <text|null>, text }`.
 *
 * `text` keeps the original indentation, so every extractor above — which are
 * all indentation-RELATIVE — reads a job block exactly as it reads a whole
 * file. That is the only reason this can hand a job's text back to
 * `extractCheckInvocations` instead of growing a second command scanner.
 *
 * `name` is read from the job's own `name:` key at its child indent and falls
 * back to the job id. It is load-bearing rather than cosmetic: the id
 * `console-pin` is not what CI, branch protection or a red check calls that
 * job, and a lead a dev cannot find in the Checks tab is a lead they will not
 * act on.
 */
export function extractJobBlocks(workflowText) {
  const lines = workflowText.split('\n');
  const blocks = [];
  let inJobs = false;
  let jobIndent = -1;
  let current = null;
  const close = () => {
    if (!current) return;
    current.text = current.lines.join('\n');
    delete current.lines;
    blocks.push(current);
    current = null;
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const indent = /^[ \t]*/.exec(line)[0].length;
    if (trimmed !== '' && !trimmed.startsWith('#') && indent === 0) {
      close();
      inJobs = /^jobs:\s*$/.test(trimmed);
      jobIndent = -1;
      continue;
    }
    if (!inJobs) continue;
    if (trimmed === '' || trimmed.startsWith('#')) {
      if (current) current.lines.push(line);
      continue;
    }
    const key = /^([A-Za-z_][\w-]*):\s*$/.exec(trimmed);
    if (key && (jobIndent === -1 || indent === jobIndent)) {
      close();
      jobIndent = indent;
      current = { id: key[1], name: key[1], if: null, childIndent: -1, lines: [line] };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (current.childIndent === -1 && indent > jobIndent) current.childIndent = indent;
    if (indent !== current.childIndent) continue;
    const named = /^name:\s*(\S.*)$/.exec(trimmed);
    if (named) current.name = unquoteScalar(named[1]);
    const cond = /^if:\s*(\S.*)$/.exec(trimmed);
    // A block-scalar `if:` is not read: the value would be the header `|`, and
    // a refused expression costs a missing lead where a misread one fabricates.
    if (cond && !BLOCK_SCALAR_HEADER.test(cond[1].trim())) current.if = cond[1].trim();
  }
  close();
  for (const b of blocks) delete b.childIndent;
  return blocks;
}

/** The action reference of a `dorny/paths-filter` step, in any pinned form. */
const PATHS_FILTER_ACTION = /^uses:\s*['"]?(?:[\w.-]+\/)*dorny\/paths-filter(?:@|['"]?\s*$)/;

/**
 * Every `dorny/paths-filter` step's `filters:` block in one workflow, keyed by
 * the step `id:` that downstream `steps.<id>.outputs.<name>` references use:
 * `Map<stepId, Map<filterName, string[]>>`.
 *
 * The filters value is a YAML block scalar carrying its own mapping, parsed the
 * same indentation-walk way as everything else here, and for the same reason
 * (`extractTriggerPaths`' docblock: this script is dependency-free because a
 * dispatch is written from a bare checkout).
 */
export function extractPathsFilterSteps(workflowText) {
  const lines = workflowText.split('\n');
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)(-[ \t]+)?(uses:.*)$/.exec(lines[i]);
    if (!m || !PATHS_FILTER_ACTION.test(m[3].trim())) continue;
    const keyColumn = m[1].length + (m[2] ? m[2].length : 0);
    let stepId = null;
    let filters = null;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === '' || t.startsWith('#')) continue;
      const ind = /^[ \t]*/.exec(lines[j])[0].length;
      if (ind < keyColumn || (ind === keyColumn && /^-[ \t]/.test(t))) break;
      if (ind === keyColumn) {
        const id = /^id:\s*(\S.*)$/.exec(t);
        if (id) stepId = unquoteScalar(id[1]);
        continue;
      }
      const f = /^filters:\s*(.*)$/.exec(t);
      if (f && BLOCK_SCALAR_HEADER.test(f[1].trim())) {
        const body = [];
        let k = j + 1;
        for (; k < lines.length; k++) {
          if (lines[k].trim() === '') { body.push(''); continue; }
          if (/^[ \t]*/.exec(lines[k])[0].length <= ind) break;
          body.push(lines[k]);
        }
        filters = parseFilterMapping(body.join('\n'));
        j = k - 1;
      }
    }
    if (stepId && filters && filters.size) out.set(stepId, filters);
  }
  return out;
}

/** `<name>:` / `- <glob>` mapping inside a paths-filter block scalar. */
export function parseFilterMapping(body) {
  const out = new Map();
  let baseIndent = -1;
  let currentName = null;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = /^[ \t]*/.exec(line)[0].length;
    if (baseIndent === -1) baseIndent = indent;
    if (indent === baseIndent) {
      const key = /^([A-Za-z_][\w.-]*):\s*(.*)$/.exec(trimmed);
      if (!key) { currentName = null; continue; }
      currentName = key[1];
      if (!out.has(currentName)) out.set(currentName, []);
      const flow = flowSequenceItems(key[2]);
      if (flow.length) out.get(currentName).push(...flow);
      continue;
    }
    if (indent <= baseIndent || !currentName) continue;
    const item = /^-\s*(.*)$/.exec(trimmed);
    if (item && item[1] !== '') out.get(currentName).push(unquoteScalar(item[1]));
  }
  for (const [k, v] of out) if (v.length === 0) out.delete(k);
  return out;
}

/**
 * A job's `outputs:` mapping, resolved to the `steps.<id>.outputs.<name>` each
 * value reads: `Map<jobOutputName, { step, output }>`.
 *
 * The indirection is not decorative in this tree. Every one of ci.yml's four
 * outputs is `${{ steps.changes.outputs.<x> || 'true' }}` — the `|| 'true'`
 * being half 1 of THE FILTER CONTRACT (when in doubt, run everything). Reading
 * the step reference rather than assuming the names match is what keeps this a
 * derivation instead of a coincidence.
 */
export function extractJobOutputSources(jobText) {
  const lines = jobText.split('\n');
  const out = new Map();
  let mapIndent = -1;
  let itemIndent = -1;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = /^[ \t]*/.exec(line)[0].length;
    if (mapIndent === -1) {
      if (/^outputs:\s*$/.test(trimmed)) mapIndent = indent;
      continue;
    }
    if (indent <= mapIndent) break;
    if (itemIndent === -1) itemIndent = indent;
    if (indent !== itemIndent) continue;
    const entry = /^([A-Za-z_][\w.-]*):\s*(\S.*)$/.exec(trimmed);
    if (!entry) continue;
    const ref = /steps\.([A-Za-z_][\w-]*)\.outputs\.([A-Za-z_][\w-]*)/.exec(entry[2]);
    if (ref) out.set(entry[1], { step: ref[1], output: ref[2] });
  }
  return out;
}

/**
 * An extglob construct — `!(a)`, `@(a|b)`, `+(a)`, `?(a)`, `*(a)`.
 *
 * `dorny/paths-filter` matches with picomatch, which supports these;
 * `triggerPatternRegex` implements GitHub's own `paths:` language, which does
 * not. Translating one language with the other is how a derivation goes
 * confidently wrong, so a glob carrying an extglob is DROPPED from the derived
 * population and counted, never approximated. Live specimen and the whole cost
 * of the refusal on this tree: `apps/!(docs)/**` in ci.yml's `core` filter, its
 * one extglob entry — the rest (`packages/**`, `examples/**`, `package.json`,
 * `pnpm-lock.yaml`, `tsconfig.json`, the workflow file itself, and since #21202
 * the root build inputs turbo.json declares) carry the filter. A dropped
 * POSITIVE entry can only narrow what is claimed; a dropped
 * NEGATION would WIDEN it, so one of those refuses the whole population instead.
 */
const EXTGLOB_CONSTRUCT = /[!?*+@]\(/;

/**
 * The path population a job's `if:` resolves to, or null — the whole of
 * direction 1, assembled from the three readings above.
 *
 * Returns `{ paths, outputs, dropped }`. `paths` is a UNION: the `if:` is an OR
 * of filter outputs, so CI schedules the job when ANY of them matched.
 */
export function jobFilterPopulation(job, filterStepsByOutputSource) {
  const refs = jobFilterOutputRefs(job.if);
  if (!refs) return null;
  const paths = [];
  const outputs = [];
  let dropped = 0;
  for (const ref of refs) {
    const globs = filterStepsByOutputSource.get(`${ref.job}.${ref.output}`);
    if (!globs) return null;
    for (const g of globs) {
      if (EXTGLOB_CONSTRUCT.test(g)) {
        // A negation that cannot be translated cannot be dropped either: the
        // remaining list would claim paths the negation excludes.
        if (g.startsWith('!')) return null;
        dropped++;
        continue;
      }
      paths.push(g);
    }
    outputs.push(`${ref.job}.${ref.output}`);
  }
  return paths.length ? { paths, outputs, dropped } : null;
}

/**
 * Every job in one workflow whose `if:` resolves to a path population, WITH the
 * job's own text: `[{ job, name, text, outputs, paths, dropped }]`.
 *
 * ⛔ No check filter here, and that is the whole reason this is its own
 * function. The caller below drops a job that invokes no discoverable check
 * family, because a family is what IT is keying; `jobFilteredSteps` keeps
 * exactly those jobs, because a job CI schedules for your path and whose work
 * this derivation names no family for is the thing that reader is owed. Two
 * callers, opposite dispositions, ONE walk — spelled twice they would be two
 * readings of one workflow, which is the drift this file's whole contract
 * refuses.
 */
export function jobFilterPopulations(workflowText) {
  const stepFilters = extractPathsFilterSteps(workflowText);
  if (stepFilters.size === 0) return [];
  const jobs = extractJobBlocks(workflowText);
  // `<jobId>.<outputName>` -> globs, resolved through the job's own `outputs:`
  // indirection so a rename on either side of it is followed, not assumed.
  const byOutput = new Map();
  for (const job of jobs) {
    for (const [name, src] of extractJobOutputSources(job.text)) {
      const globs = stepFilters.get(src.step)?.get(src.output);
      if (globs?.length) byOutput.set(`${job.id}.${name}`, globs);
    }
  }
  if (byOutput.size === 0) return [];
  const out = [];
  for (const job of jobs) {
    const population = jobFilterPopulation(job, byOutput);
    if (!population) continue;
    out.push({ job: job.id, name: job.name, text: job.text, ...population });
  }
  return out;
}

/**
 * Every job in one workflow that resolves to a path population, with the check
 * families it invokes: `[{ job, name, outputs, paths, dropped, checks }]`.
 */
export function jobPathPopulations(workflowText, workflowFile) {
  const out = [];
  for (const { text, ...population } of jobFilterPopulations(workflowText)) {
    const checks = [...new Set(extractCheckInvocations(text, workflowFile).map((i) => i.check))];
    if (!checks.length) continue;
    out.push({ ...population, checks });
  }
  return out;
}

/**
 * ## The DIRECTORY PREFIX both matchers below carry, and why it is shared (#15342)
 *
 * This repo has a package-local gate lane, and `lint.yml` really runs one of
 * its gates by path — `node packages/lint/scripts/check-reference-carrier-
 * shape.mjs --self-test`, with the bare production invocation on the next line.
 * Both patterns used to open on the literal `scripts/` immediately after
 * `node `, so neither matched that step AT ALL. The gate was in no family, and
 * `--residue` could not report it either: it is absent from the universe the
 * matched / silent / undetermined buckets partition, which is the #11397 state
 * one lane over. Measured on the base tree for a card editing that gate's OWN
 * file: `--commands` named it zero times, every one of the 27 `--residue`
 * mentions was the dev's own CHANGED PATH echoed back as an input, and the step
 * surfaced only in the always-runs STEP tail, as one of the 33 unconditional CI
 * steps this derivation names no family for.
 *
 * ## What the prefix admits, and what it deliberately refuses
 *
 *   - A prefix segment must START with an alphanumeric or `_`, so `..` is not
 *     one. A climbing spelling cannot be resolved against this ROOT without
 *     knowing what it is relative to, and `entry.files` would then carry a key
 *     with no file behind it — the phantom `resolveCheckToFiles`' docblock
 *     prices at "strictly worse than the bug being fixed". Zero occur in the
 *     workflow corpus today; refusing to match is the safe direction, and the
 *     sibling anchor in `scripts/check-self-test-wired.mjs` refuses it in the
 *     same spelling for the same reason.
 *   - A `scripts/` segment is still REQUIRED, so no new file species is
 *     admitted. `node packages/cli/bin/run.js` is the only other non-root path
 *     any workflow invokes with `node`, and it stays out.
 *   - The prefix cannot RE-ATTRIBUTE an existing match. For a path that already
 *     began at `scripts/` the group matches empty and the remainder of each
 *     pattern is byte-identical, so every key this tool minted before it is
 *     minted after it. Asserted below rather than left as this sentence.
 *
 * ## Priced in both directions, over 7472 tracked files (base `65846bc46`)
 *
 *   check families discovered        252 -> 254       (+2, ZERO lost)
 *   gate files                       201 -> 202       (+1, ZERO lost)
 *   watch-hint (gate, file) pairs  240947 -> 254181   (+13234, ZERO lost)
 *   existing families re-attributed  0 — every pre-existing family's pair count
 *                                    is byte-identical before and after
 *   always-runs steps naming NO family  33 -> 32 (18 -> 17 distinct commands)
 *
 * The +13234 is exactly 2 x 6617: the gate declares four subtree hints
 * (`packages/**`, `examples/**`, `scripts/**`, `apps/**`) and CI runs it twice,
 * so it arrives as two families under two keys — the split #14880 made, working
 * as designed. Becoming a GATE FILE is the one direction of this change that
 * could SUBTRACT (`discoverFamilies` excludes gate files from import-following),
 * so it is measured rather than argued: no existing family's pair count moved,
 * in either direction, so the net subtraction is zero.
 *
 * ## Why `SELF_TEST_INVOCATION` is widened too, on ZERO specimens
 *
 * Today's one package-local specimen carries a `check-` basename, so the direct
 * matcher takes it and the self-test matcher skips it by design — that half
 * gains no recall at all. It is widened anyway because the two matchers'
 * coordination contract is that they mint BYTE-IDENTICAL keys for one script,
 * and two adjacent patterns with two different path grammars cannot hold it: a
 * package-local gate NOT named `check-*` would then be discovered by neither,
 * which is this card's silence wearing a different filename. Same standard as
 * the extension right-boundary in `resolveCheckToFiles` — zero recall today,
 * zero cost today (both numbers above are the direct matcher's alone), class
 * closed before the first specimen arrives. ⛔ Keep the two prefixes spelled
 * identically; the self-test asserts that both accept the same package-local
 * path, so a drift reds rather than going quiet.
 */

/**
 * A `run:` step that invokes a repo script with `--self-test`. The flag is the
 * SCRIPT'S OWN declaration that this invocation verifies the script rather than
 * doing its work, which is what makes the step a gate.
 *
 * Between the script path and the flag only FLAG-SHAPED tokens are allowed, and
 * that is the whole over-match guard. A command text is one whole `run:` body,
 * so a permissive `[^\n]*` would let `--self-test` on the SECOND command in a
 * two-command body attach itself to the first script named in the body — the
 * `node scripts/pm/git-history.mjs --self-test` line sits three lines below a
 * `node scripts/…` line in this very tree. Every shell separator that could
 * join two commands (`&&`, `||`, `;`, `|`, a newline) and every bare word or
 * quoted value fails the token pattern, so the match cannot cross one. Live
 * specimen for the value case: `run-with-stall-guard.mjs --log "$RUNNER_TEMP/…"
 * --stall-minutes 10 -- pnpm …` stops at the quoted `--log` value, and the bare
 * `--` argument separator fails it too (the pattern requires an alphanumeric
 * after the dashes) — so a wrapper never absorbs the flag of the command it
 * wraps, while the wrapped `node scripts/x.mjs --self-test` still matches on
 * its own, which is correct: the inner script is the gate.
 */
const SELF_TEST_INVOCATION =
  /node[ \t]+((?:[A-Za-z0-9_][\w.-]*\/)*scripts\/[\w./-]+\.mjs)(?:[ \t]+-{1,2}[A-Za-z0-9][\w-]*)*[ \t]+--self-test\b/g;

/**
 * A `run:` step that invokes a `check-`named repo script directly, WITH the
 * argument tail that belongs to that invocation. The tail stops at the first
 * shell construct that ENDS an argv — a separator, a redirection, a subshell —
 * because everything past one of those belongs to a different command, or to
 * the shell, and never to this argv.
 *
 * ⚠️ A line-continuation backslash is NOT a terminator, and since #15083 it is
 * not a refusal either: `joinLineContinuations` splices the continued lines
 * into one command text BEFORE this matcher runs, so the tail this captures is
 * the invocation's WHOLE argv. Ending the tail at the backslash would still be
 * wrong for the reason it always was — `node scripts/check-shard-attestation.mjs
 * --emit` reads as the whole argv while `ci.yml` continues it with
 * `--job test --shard N --total 6 --out "$RUNNER_TEMP/…"` on the next two
 * lines, and a truncated argv that LOOKS runnable is the worst of the three
 * outcomes. Joining is how that hazard is removed rather than merely refused.
 */
const DIRECT_CHECK_INVOCATION =
  /node[ \t]+((?:[A-Za-z0-9_][\w.-]*\/)*scripts\/[\w./-]*check-[\w.-]+\.mjs)([^\n;|&<>()]*)/g;

/**
 * Splice a shell line-continuation back into ONE line, so a matcher reading a
 * `run:` body sees the command the shell sees.
 *
 * The workflow corpus really does continue check invocations: measured on this
 * tree, 107 lines inside `run:` bodies end in a backslash, and five of the nine
 * scripts #15083 is about carry their values on a continued line. Before the
 * join the matchers read only the first physical line of those, which is why
 * `renderedArgv`'s predecessor had to refuse the whole tail rather than render
 * half of it.
 *
 * ⛔ A COMMENT line is never joined, and that is shell semantics rather than
 * caution: a `#` comment runs to the end of the line, so a trailing backslash
 * is comment TEXT and the line below it is a command in its own right. Joining
 * one would splice prose onto the command underneath and hand a matcher an
 * invocation nobody wrote. Measured when this landed: zero comment lines in any
 * `run:` body on this tree end in a backslash, so the guard costs nothing today
 * and is here because the day one does is the day it matters.
 */
export function joinLineContinuations(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const prev = out.length > 0 ? out[out.length - 1] : null;
    if (prev !== null && /\\$/.test(prev) && !/^[ \t]*#/.test(prev)) {
      out[out.length - 1] = `${prev.slice(0, -1).replace(/[ \t]+$/, '')} ${line.replace(/^[ \t]+/, '')}`;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Split an argument tail into argv tokens the way the shell would — quotes and
 * `${{ … }}` expressions hold their spaces.
 *
 * Two live spellings make a bare whitespace split wrong, and both are in
 * `ci.yml`: `--gate 'Test Core'` (a quoted literal with a space in it) and
 * `--shard ${{ matrix.shard }}` (a GitHub expression with two). A split that
 * broke either into three tokens would classify the pieces separately and
 * render an invocation no shell would accept.
 */
export function argvTokens(tail) {
  const text = String(tail ?? '');
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
    if (i >= text.length) break;
    let token = '';
    while (i < text.length && text[i] !== ' ' && text[i] !== '\t') {
      if (text[i] === "'" || text[i] === '"') {
        const close = text.indexOf(text[i], i + 1);
        if (close === -1) {
          token += text.slice(i);
          i = text.length;
          break;
        }
        token += text.slice(i, close + 1);
        i = close + 1;
        continue;
      }
      if (text.startsWith('${{', i)) {
        const close = text.indexOf('}}', i + 3);
        if (close === -1) {
          token += text.slice(i);
          i = text.length;
          break;
        }
        token += text.slice(i, close + 2);
        i = close + 2;
        continue;
      }
      token += text[i];
      i += 1;
    }
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

/**
 * The part of a token this tool could NOT resolve, or null when the token is
 * whole — a token the tokeniser above had to swallow to the end of the tail
 * because the construct it opened never closed, or a token left ending in a
 * bare `$`.
 *
 * ## The seam, and why it is one predicate rather than three
 *
 * `DIRECT_CHECK_INVOCATION` ends the tail at the first `;|&<>()`, which is the
 * shell boundary it has always drawn and is right: past one of those the text
 * belongs to another command or to the shell. What this reads is what the CUT
 * leaves behind. A value written as a command substitution is cut INSIDE its
 * own construct — `--base "$(git merge-base origin/main HEAD)"` is cut at the
 * `(` and leaves the tail `--base "$` — and `argvTokens` handles the unclosed
 * quote by swallowing the rest into one token. That token carries no
 * `WORKFLOW_VALUE_SOURCE` hit, so without this it classified as a LITERAL and
 * the key `scripts/check-x.mjs --base "$` rendered into `--commands`: a
 * truncated argv that LOOKS runnable, which `renderedArgv`'s docblock below
 * names as the worst of the outcomes.
 *
 * Three spellings reach that state and they are ONE state, so they get one
 * predicate rather than a list: an unclosed quote (`"$` from a `$(…)`, `'a`
 * from a terminator inside a quoted value like `--gate 'a;b'`), an unclosed
 * `${{ … }}` (a GitHub expression holding a terminator, `${{ inputs.x || 'y' }}`
 * being the live-looking spelling), and a token ending in a bare `$` (the same
 * cut with the value unquoted, `--base $(…)`). Each is the tokeniser's OWN
 * unterminated branch, replayed here over the finished token — which is
 * faithful because that branch copies the remainder verbatim (`text.slice(i)`)
 * and a closing delimiter is always inside the token that used it, so the
 * replay reaches the same verdict the tokeniser did.
 *
 * ⛔ NOT done here: widening `DIRECT_CHECK_INVOCATION`'s terminator set to
 * carry the whole `$(…)` through. The cut at `(` is the shell's boundary and a
 * matcher that reads past it would have to know which parens are a
 * substitution and which end the command — this reads what the cut left, which
 * needs no such knowledge.
 *
 * Measured when this landed: 114 direct invocations across `.github/workflows`
 * and ZERO of them reach this branch, so nothing this tool prints today moves.
 * The shape is latent, and this is here because the day a workflow writes a
 * `$(…)` value is the day the derivation would otherwise render the truncation
 * silently.
 */
function unresolvedRemainder(token) {
  const text = String(token ?? '');
  let i = 0;
  while (i < text.length) {
    if (text[i] === "'" || text[i] === '"') {
      const close = text.indexOf(text[i], i + 1);
      if (close === -1) return text.slice(i);
      i = close + 1;
      continue;
    }
    if (text.startsWith('${{', i)) {
      const close = text.indexOf('}}', i + 3);
      if (close === -1) return text.slice(i);
      i = close + 2;
      continue;
    }
    i += 1;
  }
  return /\$$/.test(text) ? '$' : null;
}

/**
 * Every spelling by which a workflow puts a value into an argv WITHOUT writing
 * the value down: a GitHub expression, a shell parameter expansion, a shell
 * special. Anything else in a token is a literal — a value that appears
 * verbatim in the workflow text and is the same on every run.
 *
 * This is the whole classifier #15083 asked for, and it is read from the
 * workflow text rather than declared per script. The triage's ⛔ stands on that
 * measurement: a per-script declaration table would be owed only if the split
 * could NOT be read from the workflow, and over all fifteen live invocations of
 * the nine scripts every value is one or the other by inspection.
 */
const WORKFLOW_VALUE_SOURCE = /\$\{\{[\s\S]*?\}\}|\$\{[A-Za-z_]\w*\}|\$[A-Za-z_]\w*|\$[@?*#!$0-9]/g;

/**
 * The captured tail, rendered as the argv half of a derivation key — or null
 * when this tool cannot render it as a command a dev could paste.
 *
 * ## Why a key of (script, args) at all (#14880)
 *
 * The key used to be the script PATH, so CI's two invocations of one script
 * collapsed into a single entry, and the entry kept was whichever the matcher
 * saw first — the PLAIN one, because the old matcher captured the path and
 * dropped the tail. Measured on PR #14958: `lint.yml` runs
 * `node scripts/check-tenant-audit-census.mjs --self-test` beside
 * `node scripts/check-tenant-audit-census.mjs`, the CI red was carried
 * ENTIRELY by the `--self-test` invocation (exit 1, `1 of 19 case(s) failed`)
 * while the plain one exited 0 — and the derived list named only the plain
 * one. A dev following that list verbatim runs the green invocation of a
 * script that is red in CI, with nothing on either stream saying an invocation
 * had been elided. That is worse than an omission: the list returns a PASS for
 * a family CI fails.
 *
 * The collapse was not rare. Read from this tree's workflow text rather than
 * argued: 28 scripts in `lint.yml` are invoked more than once under different
 * argv, and every one of them carries a `check-` basename, so every one of
 * them collapsed. 41 across all workflow files.
 *
 * ## Why a VALUE-BEARING tail is rendered rather than refused (#15083)
 *
 * The first cut of this key admitted only a complete run of flag-shaped
 * tokens. Nine scripts whose ONLY CI invocations carry a value or a line
 * continuation therefore kept a BARE path key, and CI never runs any of them
 * bare. That is not a neutral omission — it is a command this tool made up.
 * Measured on this tree, invocation by invocation:
 *
 *   `node scripts/check-test-completeness.mjs`  →  exit 3, `PREREQUISITE NOT
 *       MET — this gate grades a saved `turbo run test` log, and no log was
 *       named.` A dev following the list runs it and gets a non-verdict.
 *   `node scripts/check-required-contexts.mjs`  →  exit 0 — but it runs the
 *       STATIC pin check, while `required-set-patrol.yml` runs
 *       `--verify-required-set`, a live sweep of the repo's required set. Same
 *       script, different question, and the row said `[required-set-patrol.yml]`.
 *   `node scripts/check-shard-attestation.mjs` and
 *       `node scripts/check-cross-package-test-inputs.mjs`  →  exit 0, and both
 *       duplicate what `lint.yml` already runs under a `pnpm check:` alias
 *       this derivation keys separately. The bare row added no gate and
 *       misattributed the ci.yml `--emit`/`--verify`/`--union-into`
 *       invocations to a run CI never makes.
 *   `--base` gates (`check-empty-changeset`, `check-changeset-no-major`,
 *       `check-adr-0087-registration`)  →  exit 0 against their DEFAULT base,
 *       while CI pins the base to the PR's merge base or the cut's snapshot.
 *
 * ## The rule, and it is read from the workflow text
 *
 * Each argv token is a workflow LITERAL (it appears verbatim in the workflow
 * and is the same on every run) or a workflow VARIABLE (`${{ … }}`, a shell
 * expansion, a step output, a path an earlier step produced). The classifier
 * is `WORKFLOW_VALUE_SOURCE` above; no per-script declaration is involved,
 * which is the triage's ⛔ discharged by measurement rather than by assertion.
 *
 *   Every token literal  →  the invocation renders in full, exactly as CI runs
 *       it, and goes into `--commands` as a command a dev can paste.
 *       `check-engine-split-ratio.mjs --days 90` is one; so are
 *       `check-required-contexts.mjs --verify-required-set` and
 *       `check-prerelease-pin-watch.mjs --verbose`, whose argv were complete
 *       all along and were refused only because a REDIRECTION and a
 *       CONTINUATION sat behind them.
 *   Any token a variable  →  the invocation still renders, with the variable's
 *       own name in the value position. The KEY is that spelling, always. What
 *       the row renders as its RUNNABLE member then has two cases (#15441): if
 *       the script's own usage block declares a default for the flag holding
 *       that variable, the row renders the invocation with the default filled
 *       in — the real check, runnable here, in `--commands`, saying which value
 *       CI pins in its place. Otherwise the row is marked NOT RUNNABLE LOCALLY
 *       on its own labelled line: it is named, its workflow is named, its
 *       question is called NOT MEASURED, and it is ⛔ NOT in `--commands` —
 *       that list promises runnable. See `declaredArgvDefaults` below for why
 *       the declaration is read from the script rather than from a table here.
 *
 * ⛔ Both directions NOT taken, and they are the two ways this gets worse.
 * Keying on the TRUNCATED flag run hands the dev `node scripts/… --base`, a
 * command that exits non-zero for a reason that has nothing to do with the
 * tree. Emitting the variable-bearing command INTO `--commands` hands them
 * `--base ""`, which is worse still: it runs, and it answers a question CI
 * never asked. A missing lead, never a fabricated one.
 *
 * Returns `null` for an invocation with no argv at all — that one keeps the
 * bare path key, because bare is what CI runs.
 */
export function renderedArgv(tail) {
  const tokens = argvTokens(tail);
  if (tokens.length === 0) return null;
  const variables = [];
  for (const token of tokens) {
    for (const hit of token.matchAll(WORKFLOW_VALUE_SOURCE)) {
      if (!variables.includes(hit[0])) variables.push(hit[0]);
    }
    // A remainder this tool could not resolve is a value that comes FROM THE
    // WORKFLOW just as surely as `${{ … }}` does — it is the visible half of a
    // construct the cut ran through. Naming it here is the whole fix, and it
    // rides the channel the classification already has: any entry in
    // `variables` marks the row NOT RUNNABLE LOCALLY and keeps the key out of
    // `--commands`, so the truncation is NAMED rather than rendered runnable.
    const remainder = unresolvedRemainder(token);
    if (remainder !== null && !variables.includes(remainder)) variables.push(remainder);
  }
  return { args: tokens.join(' '), variables };
}

/**
 * A script's LEADING comment block — its usage block, and nothing past it.
 *
 * The declaration below is read from here rather than from the whole file, and
 * the narrowing is the difference between a declaration and a coincidence.
 * Measured over the seven scripts whose CI argv carries a workflow value: the
 * phrase this reader keys on ("<name> defaults to <value>") appears FIVE times
 * across them, and only three are declarations. `check-changeset-no-major.mjs`
 * spells it inside an assertion message about the wiring it forbids, and
 * `pm/check-half-states.mjs` spells it twice in docblocks deep in the file (one
 * about a `@param`, one about a GitHub endpoint). A whole-file scan takes all
 * five and mints `--endpoint` as a flag of a script that has no such flag; the
 * usage block takes the three that are the script telling its caller what it
 * does with no argument.
 *
 * Both header spellings in this corpus are admitted, because both are live: a
 * run of `//` lines (`check-adr-0087-registration.mjs`) and one JSDoc-opened
 * block (`check-changeset-no-major.mjs`). The block ends at the first line that
 * is neither blank nor comment — the first line of code — so nothing a function
 * docblock says can reach this reader.
 */
export function leadingCommentBlock(source) {
  const lines = String(source ?? '').split('\n');
  const kept = [];
  let inBlock = false;
  let seenAny = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!seenAny && trimmed.startsWith('#!')) { seenAny = true; continue; }
    if (inBlock) {
      kept.push(line);
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed === '') { kept.push(line); continue; }
    if (trimmed.startsWith('//')) { seenAny = true; kept.push(line); continue; }
    if (trimmed.startsWith('/*')) {
      seenAny = true;
      kept.push(line);
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    break;
  }
  return kept.join('\n');
}

/**
 * The argv defaults a script DECLARES for itself, in its own usage block
 * (#15441) — `Map<'--flag', 'value'>`.
 *
 * ## The defect this exists to close
 *
 * `renderedArgv` above classifies an argv token as a workflow VARIABLE when the
 * workflow does not write the value down, and a family whose argv carries one
 * is marked NOT RUNNABLE LOCALLY and kept out of `--commands`. That rule asks
 * whether the WORKFLOW supplies the value. It never asks whether the SCRIPT
 * needs it supplied.
 *
 * For the `--base` gates the two answers differ, and the gap was measured
 * rather than supposed. `pr-automation.yml` runs
 * `node scripts/check-adr-0087-registration.mjs --base "$MERGE_BASE"`, so the
 * family scored value-bearing and the only member `--commands` offered for it
 * was the SELF-TEST invocation lint-side of the same script. A self-test
 * exercises the script's detector against its own fixtures; it says nothing
 * about the changeset in the working diff. Its exit 0 is a zero from a command
 * that cannot answer the question, and in the union it is indistinguishable
 * from a real green — a dev reported "50 run · 50 exit 0 · 0 red" on a PR whose
 * Check Changeset job was red in CI the whole time.
 *
 * But the script's own first lines say `base defaults to origin/main`, and the
 * scan starts at `merge-base(base, head)` either way — which is the reading
 * `check-empty-changeset.mjs` states as idempotent: "merge-base(X, head) is X
 * again whenever X is already the branch point". The workflow PASSES the merge
 * base; it does not REQUIRE it. Measured on three real heads with the emitted
 * command, two controls chosen so neither could answer the other's question:
 * exit 1 on a PR declaring BREAKING with no ADR-0087 marker, exit 0 on one that
 * declares it and answers it, exit 0 on one that declares none. The gate
 * returns both values here, so the red is a reading rather than a command that
 * always fails.
 *
 * ## Why the declaration is read from the SCRIPT, not from a table here
 *
 * The same rule `WORKFLOW_VALUE_SOURCE` follows, one file over: a per-script
 * table in this tool is a second place for the truth to live, and the day a
 * script drops its default the table still says it has one — which is a
 * FABRICATED runnable command, the one outcome this file refuses everywhere.
 * Reading the script's own usage block cannot drift: a script that stops
 * documenting the default returns its family to NOT RUNNABLE LOCALLY on the
 * next run, with no edit here. That direction is pinned in the self-test.
 *
 * ⛔ What this does NOT do: guess. Only a flag the usage block both NAMES (as
 * `--flag`) and DECLARES a default for is admitted, only when the workflow
 * hands that flag a token that is nothing but the variable, and only when EVERY
 * variable in the invocation is covered. A partially defaulted argv stays
 * value-bearing and unrunnable, because a command that runs with one real value
 * and one invented one answers a question CI never asked.
 */
export function declaredArgvDefaults(source) {
  const usage = leadingCommentBlock(source);
  const out = new Map();
  if (!usage) return out;
  for (const m of usage.matchAll(/(?:^|[^\w-])([a-z][a-z0-9-]*)\s+defaults to\s+`?([^\s`'",;)]+)/g)) {
    const flag = `--${m[1]}`;
    // The usage block has to name it as a FLAG too. Prose about "the endpoint
    // defaults to …" is a sentence about behaviour, not a declaration about an
    // argument, and the two are indistinguishable without this half.
    if (!usage.includes(flag)) continue;
    if (!out.has(flag)) out.set(flag, m[2]);
  }
  return out;
}

/**
 * One argv, re-rendered as the command that runs HERE — the workflow's variable
 * replaced by the default its script declares for that flag (#15441).
 *
 * The default is SPELLED OUT (`--base origin/main`) rather than dropped for the
 * bare invocation the usage block also documents. Two reasons, and both are
 * live in this tree: the bare spelling of one of these three scripts is
 * forbidden by that script's own wiring assertion ("with no `--base` it
 * defaults to origin/main, which on a stale checkout is the two-dot reading
 * #6129 rules out"), and a rendered command that differs from CI's by one VALUE
 * is a command a reader can diff against the row beside it, while one that
 * differs by a missing flag reads as a different invocation.
 *
 * ⛔ The KEY is not touched. `check` stays the invocation as CI spells it, so a
 * script CI runs with two different bases keeps two entries and neither is
 * re-attributed onto the other — the invariant #14880 bought and this card must
 * not spend. What moves is what the row RENDERS as its runnable member.
 */
export function defaultedArgv(args, defaults = new Map()) {
  const tokens = argvTokens(args);
  const declared = defaults instanceof Map ? defaults : new Map();
  const rendered = [];
  const defaulted = [];
  // A token that is NOTHING BUT the variable, quotes aside. `"$RUNNER_TEMP/x"`
  // is not one: the workflow wrote half the value down, and substituting the
  // whole token would throw that half away.
  const wholeVariable = (text) => {
    const bare = String(text ?? '').replace(/^(["'])([\s\S]*)\1$/, '$2');
    const hits = [...bare.matchAll(WORKFLOW_VALUE_SOURCE)];
    return hits.length === 1 && hits[0][0] === bare ? bare : null;
  };
  const spell = (value) => (/^[\w./:@=+-]+$/.test(value) ? value : JSON.stringify(value));
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const inline = /^(--[a-z][a-z0-9-]*)=([\s\S]*)$/.exec(token);
    if (inline && declared.has(inline[1])) {
      const variable = wholeVariable(inline[2]);
      if (variable !== null) {
        const value = declared.get(inline[1]);
        rendered.push(`${inline[1]}=${spell(value)}`);
        defaulted.push({ flag: inline[1], variable, value });
        continue;
      }
    }
    if (declared.has(token) && i + 1 < tokens.length) {
      const variable = wholeVariable(tokens[i + 1]);
      if (variable !== null) {
        const value = declared.get(token);
        rendered.push(token, spell(value));
        defaulted.push({ flag: token, variable, value });
        i += 1;
        continue;
      }
    }
    rendered.push(token);
  }
  return { args: rendered.join(' '), defaulted };
}

/**
 * The captured tail minus the file descriptor of a redirection that follows it.
 *
 * `DIRECT_CHECK_INVOCATION` stops the tail before `>`, which is right — the
 * redirection is the shell's. But `2>&1` puts its fd on the argv side of that
 * boundary, so `--verbose 2>&1` captured as ` --verbose 2` and the stray `2`
 * read as an argument. It is the live spelling in `prerelease-pin-watch.yml`,
 * and it is why an argv that was complete all along scored unrenderable.
 *
 * The discriminator is the shell's own: digits touching the operator are a
 * descriptor (`2>`), digits with a space before it are an argument
 * (`--total 6 > out`). Applied only when a redirection really follows.
 */
function tailBeforeRedirection(tail, nextChar) {
  if (nextChar !== '>' && nextChar !== '<') return tail;
  return String(tail ?? '').replace(/\d+$/, '');
}

/**
 * Pull every `check:*` invocation out of a workflow file's `run:` steps,
 * with the pnpm --filter package (if any) and the workflow's file name.
 *
 * ## Why a third matcher: a gate that follows no naming convention (#11404)
 *
 * The two matchers above key discovery on a NAME. A step qualifies only if it
 * runs a `check:*` npm script, or a script whose basename carries `check-`. A
 * real gate that reds the required lane and follows neither convention is not
 * a family with an unspellable population — the state #11199 and #11190 are
 * about, where the gate at least appears under `--residue` in the `silent` or
 * `undetermined` bucket. It is absent from the universe those buckets
 * partition, so no local derivation can name it at all.
 *
 * Measured on PR #11397: `node scripts/pm/bare-root-worklist.mjs --self-test`
 * shipped a red on `Lint & Repo Gates` for a diff whose seven derived families
 * were all run and all green. `grep -c bare-root-worklist` over a full
 * `--residue` run returned 6 lines, and all six were the dev's own CHANGED PATH
 * echoed back. The file was visible to the derivation only as an INPUT.
 *
 * ## What `--self-test` buys that a widening does not
 *
 * The refused direction is any `scripts/**` script in a `run:` step. Measured
 * over the 26 workflow files on this tree it admits 12 distinct scripts, and
 * the three it adds beyond this matcher are all non-gate tooling:
 * `release-github-releases.mjs` (the release run), `run-with-stall-guard.mjs`
 * (a test wrapper, 7 invocations), and `affected-docs.mjs` (a docs-drift
 * query). Those are the fabricated leads `hintCovers`' docblock prices the
 * bare-top-level-word admission at +139084 pairs for refusing.
 *
 * `--self-test` is not a heuristic over those names, it is the same scripts'
 * own declaration. The discriminating specimen is in the tree twice:
 * `scripts/partition-test-shards.mjs` and `scripts/pr-labels.mjs` are each
 * invoked BOTH ways — `--self-test` in `lint.yml`, and doing their actual work
 * in `ci.yml` / `pr-automation.yml`. The flag separates the gate invocation
 * from the work invocation of one script, which no filename rule can.
 *
 * ## Why a `check-` basename is skipped HERE — and where the split moved to (#14880)
 *
 * A `check-` basename is admitted by `DIRECT_CHECK_INVOCATION` above, which
 * since #14880 captures the invocation's argv tail too. So the flagged and the
 * plain invocation of one `check-` script already arrive as two entries under
 * two keys, and this matcher would produce a key byte-identical to the one the
 * direct matcher just produced: one invocation counted twice, not a second
 * family. That is the whole reason for the skip now.
 *
 * ⚠️ It is NOT the reason it originally carried. The skip landed (#11404)
 * arguing that a `check-` script "is already a family under its BARE path key"
 * and that splitting it would re-attribute matches — measured then at 0 of
 * 52774 pairs changed. That argument held only while the bare key was the
 * whole key: with the plain invocation and the `--self-test` invocation
 * sharing one entry, the entry kept was the plain one, and CI's failing
 * invocation had no entry at all (PR #14958, measured; `renderedArgv`'s
 * docblock carries it). The split is the repair, not the hazard. What survives
 * of the old argument is its standard of proof, and it is met the same way: a
 * family whose invocation this tool can render keeps every pair it had — the
 * plain entry is unchanged and the flagged entry is NEW, so the change adds
 * families and re-attributes none, except where CI never ran the bare
 * invocation at all and the bare key was therefore a command nobody runs.
 *
 * ## The price, measured the way #11512 priced import-following
 *
 * Over 6465 tracked files, before -> after:
 *
 *   check families discovered      140 -> 149     (+9, ZERO lost)
 *   watch-hint (gate, file) pairs  52774 -> 52880 (+106, ZERO lost)
 *   existing matches re-attributed 0 — no pre-existing (file, family, hint)
 *                                  claim changed, and no existing family's
 *                                  pair count moved by one
 *
 * The +106 is 0.08% of the refused widening's price. Six of the nine new
 * families contribute no pairs at all; the three that do declare the
 * population themselves — `release-rehearsal-clone.mjs` +75 (the `.changeset`
 * tree its self-test clones), `pm/ci-failure.mjs` +30 (`.github`),
 * `pr-labels.mjs` +1 (`.github/labeler.yml`).
 *
 * All nine also become GATE FILES, which `discoverFamilies` excludes from
 * import-following. That is the one direction of this change that could
 * SUBTRACT, so it is measured rather than argued. Four of the nine were being
 * followed on the base tree, over 111 import edges — `invoked-as.mjs` by 77
 * families, `ts-parse.mjs` by 18, `js-comment-mask.mjs` by 14,
 * `pm/git-history.mjs` by 2 — and all four declare ZERO path literals, so the
 * edges carried nothing to lose. The three that do declare literals
 * (`release-rehearsal-clone.mjs` 7, `pm/ci-failure.mjs` 2, `pr-labels.mjs` 1)
 * are followed by no family at all. Net subtraction: zero hints, zero pairs.
 * Asserted in the self-test rather than left as this paragraph, because a
 * subtraction here is silent — a lead that stops appearing looks exactly like
 * a lead that was never earned.
 *
 * ## What is NOT closed here, and why it is not folded in
 *
 * `bare-root-worklist --self-test` is a whole-corpus gate over every gate
 * source, and it now enters the universe with ZERO hints — reached by identity
 * (a card editing it) and, for any other card, printed in the residue as a
 * family whose population is not path-expressible. That is the state #11199 is
 * about, one level down from this card, and it is progress with a name: before
 * this change the gate was in no bucket at all, so `--residue` could not report
 * it as anything. Giving it a population is #11199's ground and is refused here
 * on top of that: this tool's own self-test asserts, mechanically, that it
 * declares no population of its own ("it reads gate sources, never a repo
 * subtree"), so a hint added for this card's convenience would fail the very
 * gate the card is about.
 */
export function extractCheckInvocations(workflowText, workflowFile, { via = null } = {}) {
  const out = [];
  // WHERE the step this invocation came out of is written (#19229). `null` is
  // an inline step of the workflow itself; a path is the composite action file
  // the caller `uses:`. The WORKFLOW attribution never moves — CI schedules the
  // caller — so this rides alongside as provenance a reader can go check, the
  // same split `readEdge` keeps for a read's spelling.
  const withVia = (inv) => (via === null ? inv : { ...inv, viaAction: via });
  for (const { text: raw, envVariables: stepEnv } of runCommandSteps(workflowText)) {
    // ONE joined text for all three matchers, so no two of them can disagree
    // about where a command ends — the discipline `discoverFamilies` follows
    // for the workflow reads it makes.
    const cmd = joinLineContinuations(raw);
    // The step's `env:` values, MINUS the ones this command line spells for
    // itself (#15761). `env: MERGE_BASE: ${{ … }}` beside
    // `run: node scripts/check-changeset-no-major.mjs --base "$MERGE_BASE"` is
    // one value with one carrier: the variable reaches the script through
    // ARGV, the argv reader already sees it, and `declaredArgvDefaults` may
    // already have repaired the invocation into a runnable one (#15441).
    // Counting it a second time here would undo that repair and mark three
    // live `--base` families NOT MEASURED again. What is left is the class
    // this card is about: a value that reaches the program only through
    // `process.env`, which no reader of the command line can see.
    const carriedEnv = envNamesNotSpelledInCommand(cmd, stepEnv);
    for (const m of cmd.matchAll(/pnpm\s+(?:--filter\s+(\S+)\s+)?(?:run\s+)?(check:[\w:-]+)/g)) {
      out.push(withVia({ check: m[2], filter: m[1] ?? null, workflow: workflowFile, envVariables: carriedEnv }));
    }
    for (const m of cmd.matchAll(DIRECT_CHECK_INVOCATION)) {
      const script = m[1];
      // The KEY is (script, args), never the path alone — `renderedArgv`'s
      // docblock carries the measurement and the classification it applies.
      const argv = renderedArgv(tailBeforeRedirection(m[2], cmd[m.index + m[0].length]));
      out.push(withVia({
        check: argv ? `${script} ${argv.args}` : script,
        script,
        filter: null,
        workflow: workflowFile,
        direct: true,
        // The values this invocation takes FROM THE WORKFLOW, in the workflow's
        // own spelling — empty when every token is a literal. This is what
        // decides whether the rendered command is one a dev can paste, and it
        // travels on the invocation so every rendering downstream reads one
        // answer rather than re-deriving it (#15083).
        argvVariables: argv ? argv.variables : [],
        // The same fact for the OTHER carrier (#15761): the values the step
        // hands this command through `env:`. It rides the invocation for the
        // same reason `argvVariables` does — so every rendering downstream
        // reads one answer rather than re-deriving it — and it is a fact about
        // the STEP, so it is attached to every matcher here and narrowed to the
        // families it may classify in `workflowEnvValues`, never here.
        envVariables: carriedEnv,
        // The same declaration the matcher below reads, on the same flag: this
        // invocation runs the script's SELF-TEST rather than its work, and two
        // narrowings downstream turn on knowing that (the import/spawn/manifest
        // follows in `discoverFamilies`, and `ciOnlyMeasurement`). Before the
        // key carried the argv there was nothing here to read it off.
        selfTest: Boolean(argv) && argv.args.split(/[ \t]+/).includes('--self-test'),
      }));
    }
    for (const m of cmd.matchAll(SELF_TEST_INVOCATION)) {
      const script = m[1];
      // Admitted above, under the SAME (script, args) key this matcher would
      // produce — so re-admitting it here would be one invocation counted
      // twice, not a second family. The skip is what keeps the two matchers
      // from disagreeing; the split into two families is done by the key.
      if (nodePath.basename(script).includes('check-')) continue;
      out.push(withVia({
        // The flag is part of the KEY because it is part of the runnable
        // command: `node scripts/pm/bare-root-worklist.mjs` on its own prints
        // a worklist and exits 0. A dev pasting the key without it runs
        // nothing, and reads that as the gate passing.
        check: `${script} --self-test`,
        script,
        filter: null,
        workflow: workflowFile,
        direct: true,
        selfTest: true,
        envVariables: carriedEnv,
      }));
    }
  }
  return out;
}

// ── Following a command OUT of a workflow and into a composite action ────────
//
// Everything above reads a `run:` step out of a workflow file. That was the
// whole population until composite actions started carrying runner-executed
// commands, and the gap it left was measured rather than argued (#19229): six
// gates in this repo root their population at `.github/workflows` and NONE of
// them reads `.github/actions/**`, while every one prints a scope line that
// reads as coverage. The positive control on the tree that filed it:
// `.github/actions/setup-pnpm/action.yml` already carried SIX `run:` steps, so
// the zero was a reading and not an empty query.
//
// A command GitHub executes through `uses: ./.github/actions/NAME` is executed
// on the runner exactly as an inline one is, in the caller's job, under the
// caller's triggers. So it is derived exactly as an inline one is: the steps of
// the action are read into the CALLING workflow's invocation set, keeping the
// caller's file name as the attribution, because the caller is what CI
// schedules and what a `paths:` filter narrows. ⛔ The action file is NOT a
// second workflow with triggers of its own — an action declares no `on:` block
// at all, so attributing an invocation to it would invent a schedule nobody
// wrote.
//
// ⚠️ SCOPE, and the direction each boundary fails in:
//
//   - Only a LOCAL action is followed (`uses: ./…`). A third-party action's
//     steps are not in this tree, so nothing here could read them and no gate
//     in this repo claims to audit them.
//   - Only `./.github/actions/**` is followed, which is where GitHub's own
//     convention puts them and where every local action in this repo lives.
//     A local action landing outside that tree would be followed by nothing —
//     a MISSING lead, never a fabricated one — and it is refused deliberately:
//     the declared inherited population at the top of this file has to stay
//     exactly equal to the trees this module really opens, and a follow that
//     could open any directory a workflow names could not be declared at all.
//   - A `uses:` naming a directory with no `action.yml`/`action.yaml` in it is
//     UNRESOLVED and reported, never skipped. GitHub fails such a job outright,
//     so on a tree where it happens the derivation must say so rather than
//     derive a smaller answer and print it as a whole one (#4690).
//   - The follow is RECURSIVE with a visited set, because an action may itself
//     `uses:` a sibling action; a one-hop follow would re-open this card's own
//     blind spot one level down.
//
// ⛔ What is deliberately NOT extended here, stated because an unstated
// omission is the shape this card is about: the always-runs tail
// (`alwaysRunSteps`) and the job-filtered tail (`jobFilteredSteps`) below still
// read the workflow's own `jobs:` structure only. A composite action has no
// `jobs:`, so those two walks find nothing in it and their rows are UNDER-
// reported rather than wrong — the safe direction, and the same one
// `extractTriggerPaths` takes for `paths-ignore:`. The size of that deferral is
// measured by this file's own `--self-test` so it goes loud the day it grows.

/** The tree local composite actions live in — the one extra tree this module opens. */
export const COMPOSITE_ACTION_DIR = '.github/actions';

/**
 * A step that `uses:` a LOCAL composite action under `.github/actions/`.
 *
 * Matched on the `uses:` line rather than parsed, for the reason
 * `extractTriggerPaths` states at length: this script is dependency-free by
 * design and runs from a bare checkout before `pnpm install`. The value may be
 * quoted either way and may carry a trailing comment; a local `uses:` takes no
 * `@ref` (GitHub resolves it inside the checked-out tree), so a value carrying
 * one is not this shape and is left alone.
 */
const LOCAL_COMPOSITE_USES =
  /^[ \t]*(?:-[ \t]+)?uses:[ \t]*(['"]?)\.\/(\.github\/actions\/[\w.-]+(?:\/[\w.-]+)*)\1[ \t]*(?:#.*)?$/gm;

/**
 * Every local composite action a text `uses:`, in declaration order, deduped —
 * as repo-relative DIRECTORY paths (`.github/actions/half-state-patrol`).
 *
 * Works on a workflow and on an action alike, which is what makes the follow
 * below recursive without a second reader.
 */
export function localCompositeActionUses(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(LOCAL_COMPOSITE_USES)) {
    if (!out.includes(m[2])) out.push(m[2]);
  }
  return out;
}

/**
 * The body of an action file's top-level `runs:` block — the steps a composite
 * action executes, and nothing else in the file.
 *
 * Narrowed to `runs:` rather than handing the whole file to the matchers, so a
 * `run:` line appearing inside a top-level `description:` block scalar or an
 * input default is not read as a step nobody wrote. The walk is the same
 * indentation walk the three `on:` readers above use.
 *
 * ⛔ NOT gated on `using: composite`. A `node20` or `docker` action's `runs:`
 * block declares no `run:` step, so it contributes nothing either way, and a
 * gate on the `using:` value would be a second thing to keep true about a file
 * this function already reads correctly.
 */
export function compositeActionRunsBlock(actionText) {
  const lines = String(actionText ?? '').split('\n');
  const body = [];
  let inRuns = false;
  for (const line of lines) {
    if (line.trim() === '' || /^[ \t]*#/.test(line)) {
      if (inRuns) body.push(line);
      continue;
    }
    const indent = /^[ \t]*/.exec(line)[0].length;
    if (indent === 0) {
      if (inRuns) break;
      inRuns = /^runs:\s*$/.test(line.trim());
      continue;
    }
    if (inRuns) body.push(line);
  }
  return body.join('\n');
}

/**
 * Follow every local composite action a workflow reaches, recursively.
 *
 * `readAction` is a parameter rather than a filesystem call so this whole walk
 * is a pure function over text that `--self-test` drives offline — the same
 * discipline every extractor above keeps. It is handed a repo-relative
 * directory and answers `{ file, text }` for the action file inside it, or
 * `null` when there is none.
 *
 * @param {string} workflowText
 * @param {(dir: string) => ({ file: string, text: string } | null)} readAction
 * @returns {{ steps: {action: string, dir: string, text: string}[], unresolved: string[] }}
 *   `steps[].text` is the action's `runs:` body, ready for the same matchers a
 *   workflow's own text goes through; `unresolved` names every `uses:` target
 *   with no action file behind it.
 */
export function followCompositeActions(workflowText, readAction) {
  const steps = [];
  const unresolved = [];
  const seen = new Set();
  const queue = localCompositeActionUses(workflowText);
  while (queue.length > 0) {
    const dir = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    const found = readAction(dir);
    if (found === null || found === undefined) {
      unresolved.push(dir);
      continue;
    }
    steps.push({ action: found.file, dir, text: compositeActionRunsBlock(found.text) });
    // An action may `uses:` a sibling. Queued from the WHOLE action text rather
    // than from the `runs:` body alone, so a `uses:` written beside the steps
    // still enters the walk.
    for (const next of localCompositeActionUses(found.text)) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return { steps, unresolved };
}

/**
 * The filesystem half of `followCompositeActions`, rooted at this checkout.
 *
 * Both extensions GitHub accepts are probed, in the order GitHub resolves them.
 */
export function compositeActionReader(root = ROOT) {
  return (dir) => {
    for (const name of ['action.yml', 'action.yaml']) {
      const rel = `${dir}/${name}`;
      const abs = nodePath.join(root, rel);
      if (existsSync(abs)) return { file: rel, text: readFileSync(abs, 'utf8') };
    }
    return null;
  };
}
// ── The "always runs" tail: the steps CI runs whatever your diff is (#13333) ─
//
// Everything above discovers CHECK FAMILIES. The four functions below answer
// the complementary question, and it is the one a dev following the dispatch
// brief has no way to ask: which steps does CI run on EVERY pull request that
// this derivation names no family for at all?

/**
 * Does this workflow declare a `pull_request:` trigger?
 *
 * `extractTriggerPaths` returns `[]` for two different workflows — one with a
 * `pull_request:` trigger and no `paths:` filter, and one with no
 * `pull_request:` trigger at all — and the always-runs derivation must not
 * confuse them: the first runs on every PR, the second runs on none. The walk
 * is the same narrow one, kept beside it so the pair cannot drift.
 */
export function declaresPullRequestTrigger(workflowText) {
  let inOn = false;
  for (const line of workflowText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = /^[ \t]*/.exec(line)[0].length;
    if (indent === 0) {
      inOn = /^(?:on|'on'|"on"|true):\s*$/.test(trimmed);
      continue;
    }
    if (inOn && /^pull_request:\s*$/.test(trimmed)) return true;
  }
  return false;
}

/**
 * Every event a workflow's `on:` block DECLARES, in declaration order.
 *
 * The third of the three narrow `on:` walkers, kept beside the two above so
 * the trio cannot drift: `extractTriggerPaths` reads one event's `paths:`,
 * `declaresPullRequestTrigger` answers one event's presence, and this one
 * answers WHICH events there are. All three walk indentation rather than
 * parse YAML, for the reason `extractTriggerPaths` states — this script is
 * dependency-free by design.
 *
 * ## Why it exists when NO derivation consumes it (#14899)
 *
 * It is the instrument for the scheduled-only measurement in the header, and
 * the self-test's live block is its only caller. That is deliberate and it is
 * the whole shape of what shipped: the classification the card proposed has
 * ZERO members on this tree, so shipping it would be a capability with nothing
 * in it, and the header records why. What a deferral needs to be safe is a
 * reading that goes loud the day the population stops being empty — and a
 * reading needs an instrument. ⛔ Do not delete this as unused: its caller is
 * the pin, and deleting it deletes the detection that makes the deferral
 * honest rather than merely convenient.
 *
 * ## The three `on:` spellings, all read
 *
 *   - the mapping (`on:` then `  pull_request:` on its own line) — every
 *     workflow in this tree today;
 *   - the flow sequence (`on: [push, pull_request]`);
 *   - the bare scalar (`on: push`), and the block sequence under it.
 *
 * The YAML 1.1 spelling is read too: an unquoted `on` is the BOOLEAN `true` to
 * a 1.1 parser, so `'on':`, `"on":` and a literal `true:` are all the same key
 * — the same three spellings the two walkers above already accept.
 *
 * ## The boundaries, each with the direction it fails in
 *
 *   - Only keys at the FIRST indentation level inside `on:` are events. A
 *     `paths:`/`types:`/`branches:` under an event is not one, and neither is
 *     a `schedule:` under `jobs:` — a walk that scooped either would report
 *     events a workflow does not declare, and this reader's whole use is to
 *     decide that a workflow has NO PR-time trigger. A fabricated event fails
 *     in the safe direction (it can only ever REMOVE a family from the
 *     scheduled-only class); a missed one fails in the loud direction (a false
 *     member, caught by the reader of the pin). Both are pinned below.
 *   - `workflow_call` is reported as declared and is NOT a PR-time event: a
 *     reusable workflow runs with its caller's event, so the caller is where
 *     the question is answered. No family in this tree reaches one.
 */
export function declaredTriggerEvents(workflowText) {
  const out = [];
  const add = (name) => {
    const clean = unquoteScalar(name);
    if (clean !== '' && !out.includes(clean)) out.push(clean);
  };
  let inOn = false;
  let eventIndent = -1;
  for (const line of workflowText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = /^[ \t]*/.exec(line)[0].length;
    if (indent === 0) {
      // A new top-level key closes whatever we were inside — the same reset
      // the two walkers above make, and what keeps a `jobs:` decoy out.
      const on = /^(?:on|'on'|"on"|true):\s*(.*)$/.exec(trimmed);
      inOn = Boolean(on);
      eventIndent = -1;
      if (on && on[1].trim() !== '') {
        const flow = flowSequenceItems(on[1]);
        if (flow.length > 0) for (const item of flow) add(item);
        else add(on[1].trim());
        // An inline value IS the whole declaration; nothing indented under it.
        inOn = false;
      }
      continue;
    }
    if (!inOn) continue;
    // The first indented line fixes the level events live at. Anything deeper
    // belongs to an event, not to `on:`.
    if (eventIndent === -1) eventIndent = indent;
    if (indent !== eventIndent) continue;
    const item = /^-\s*(.*)$/.exec(trimmed);
    if (item) {
      add(item[1]);
      continue;
    }
    const key = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(trimmed);
    if (key) add(key[1]);
  }
  return out;
}

/**
 * The events that put a workflow in front of a PULL REQUEST — the predicate
 * the scheduled-only measurement subtracts by (#14899).
 *
 * `pull_request` and `pull_request_target` run on the PR itself; `merge_group`
 * runs on the speculative merge the queue builds out of it; `push` runs on the
 * result of landing it. All four judge a diff a dev wrote, which is the
 * question — `schedule`, `workflow_dispatch`, `workflow_run` and
 * `workflow_call` judge a board, a human's button, another run, or a caller.
 *
 * ⚠️ The set is deliberately WIDE, and the header records that the measured
 * answer does not depend on it: narrowing it to `pull_request` alone leaves
 * the scheduled-only count at zero, because every family this tree reaches
 * through a scheduled workflow is also reached through a `pull_request` one.
 * A wide set can only ever UNDER-report the class, which is the direction that
 * fails quietly — so the pin below asserts the narrow reading too.
 */
export const PR_TIME_TRIGGER_EVENTS = Object.freeze([
  'pull_request',
  'pull_request_target',
  'merge_group',
  'push',
]);

/**
 * A job's steps, each as `{ name, if: <text|null>, text }`, with the original
 * indentation kept so every extractor above reads a step exactly as it reads a
 * whole file — the same property `extractJobBlocks` relies on one level up.
 *
 * ## Why the step is the unit, when everything else here counts families
 *
 * A family is what a dev RUNS; a step is what CI runs. Those are the same thing
 * only while every step invokes a discoverable family, and the measurement in
 * `alwaysRunSteps` below is that they are not. Counting families can therefore
 * never surface a step that contributes none — the step simply is not in the
 * universe the three verdicts partition, which is the one output shape this
 * file's header forbids.
 *
 * ## The two boundaries, and the direction each fails in
 *
 * The steps list is located by its own `steps:` key and the step boundaries are
 * the SHALLOWEST dash lines inside it, so nothing outside that list can be read
 * as a step. A block-scalar body cannot be mistaken for one either: a body is
 * indented deeper than its `run:` key, which is itself deeper than the dash, so
 * a `- item` line inside a shell heredoc or a `printf` sits below the dash
 * indent by construction rather than by luck.
 *
 * `if:` is read only at the step's own key column. Read anywhere in the step
 * text it would pick up the condition on a nested `with:` value and mark an
 * unconditional step conditional; read at the key column it cannot, because a
 * `run:` body is always deeper than the column its key sits on. A step whose
 * `if:` this cannot parse is treated as CONDITIONAL — the safe direction here
 * is the opposite of the one `extractJobBlocks` takes for jobs, because the
 * output is a claim that CI runs the step NO MATTER WHAT. A missed step costs a
 * lead; a step wrongly promised as unconditional is a fabricated one.
 */
export function extractStepBlocks(jobText) {
  const lines = jobText.split('\n');
  let stepsIndent = -1;
  let regionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (/^steps:\s*$/.test(trimmed)) {
      stepsIndent = /^[ \t]*/.exec(lines[i])[0].length;
      regionStart = i + 1;
      break;
    }
  }
  if (regionStart === -1) return [];
  let regionEnd = lines.length;
  for (let i = regionStart; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (/^[ \t]*/.exec(lines[i])[0].length <= stepsIndent) {
      regionEnd = i;
      break;
    }
  }
  let dashIndent = -1;
  for (let i = regionStart; i < regionEnd; i++) {
    const m = /^([ \t]*)-[ \t]+\S/.exec(lines[i]);
    if (!m) continue;
    if (dashIndent === -1 || m[1].length < dashIndent) dashIndent = m[1].length;
  }
  if (dashIndent === -1) return [];
  const starts = [];
  for (let i = regionStart; i < regionEnd; i++) {
    const m = /^([ \t]*)(-[ \t]+)\S/.exec(lines[i]);
    if (m && m[1].length === dashIndent) starts.push({ line: i, keyColumn: m[1].length + m[2].length });
  }
  return starts.map((s, k) => {
    const to = k + 1 < starts.length ? starts[k + 1].line : regionEnd;
    const text = lines.slice(s.line, to).join('\n');
    let name = null;
    let cond = null;
    for (let i = s.line; i < to; i++) {
      const m = /^([ \t]*)(?:-[ \t]+)?([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const column = i === s.line ? s.keyColumn : m[1].length;
      if (column !== s.keyColumn) continue;
      if (m[2] === 'name' && name === null) name = unquoteScalar(m[3]);
      if (m[2] === 'if' && cond === null) cond = m[3].trim() === '' ? '(block scalar)' : m[3].trim();
    }
    return { name: name ?? '(unnamed step)', if: cond, text };
  });
}

/**
 * Every step CI runs on EVERY pull request that the family derivation above
 * names nothing for — the "always runs" tail.
 *
 * Input is the same `[{ file, text }]` the discovery reads, so the tail and the
 * families come from ONE read of each workflow and cannot describe different
 * revisions of it.
 *
 * ## The measured failure (#13333, and four closed instances before it)
 *
 * A dev followed the standing instruction exactly — derive the family with this
 * tool rather than from a recalled list — got 29 families, ran all 29 green,
 * and shipped a red on `Lint & Repo Gates`. The gate was
 * `packages/lint/scripts/check-reference-carrier-shape.mjs`, invoked by path in
 * an unconditional step. It is not in the residue's `silent` bucket and not in
 * `undetermined`: it is in NO bucket, because the three matchers in
 * `extractCheckInvocations` key discovery on a root `check:*` script name or a
 * `scripts/`-rooted path, and this gate is neither. A family that is never
 * discovered has no entry to fall into — the shape `runCommandTexts`' header
 * calls the one output this contract forbids.
 *
 * ⛔ The fix REFUSED here is adding that gate, or its shape, to the discovery
 * matchers. #12205 (`check:exported-any-returns`), #12850
 * (`check:dispatcher-error-vocabulary`) and #13126 (228 unreached (family,
 * module) pairs) were each closed that way, and the same red shipped again
 * under a different gate name each time; #12956 and #13392 are open on the same
 * mechanism. Triage ruled it a class, not an instance, on 2026-08-30. So the
 * answer is not a wider matcher — it is to stop deriving the answer from the
 * matchers alone and read what CI actually runs.
 *
 * ## Why this is NOT "22 leads is the same as none"
 *
 * The header refuses naming every unfiltered family for every card, and that
 * refusal stands: on this tree 166 of the 187 discovered families sit outside
 * both path declarations CI obeys, and printing 166 leads per card would say
 * nothing. This is the COMPLEMENT of that set, not a slice of it. A step leaves
 * this list the moment the derivation names any family for it, so the list is
 * bounded by the derivation's own blind spot and shrinks as discovery improves
 * — it cannot grow toward the farm. Measured on this tree at the time of
 * writing: 189 unconditional steps across the unfiltered pull-request
 * workflows, 162 of them accounted for by a discovered family, 27 not.
 *
 * It also carries NO per-card claim and must not be read as one. Every row is
 * identical for every card, which is the honest shape: these steps run whatever
 * the diff is, so a per-card verdict on them would be the lie.
 *
 * ## What is excluded, and why each exclusion is the safe direction
 *
 *   - a workflow with an `on.pull_request.paths` filter: CI can narrow it, so
 *     its steps are not unconditional and the path derivation above already
 *     answers for them;
 *   - a workflow with no `pull_request:` trigger at all: it runs on no PR;
 *   - a job carrying any `if:`, and a step carrying any `if:`: the claim being
 *     made is "CI runs this no matter what", and a condition this walk did not
 *     evaluate could falsify it. Both counts are RETURNED rather than dropped —
 *     an exclusion nobody can size is one nobody can weigh, the same reason the
 *     unfiltered-workflow count is printed rather than left as an absence.
 *
 * ⛔ Steps are NOT classified into "gate" and "setup". `pnpm install` and
 * `pnpm lint` are both in this tail on this tree, and only one of them is a
 * verification — but every rule that separates them is a guess about a step's
 * intent, and a guess in this position fabricates. What every row DOES share is
 * exactly what is claimed for it: CI runs it on every PR and this derivation
 * names no family for it. The reader judges the rest, which is the same
 * contract `unreachableLines` states for its own listing.
 */
export function alwaysRunSteps(entries) {
  const rows = [];
  const counts = {
    unconditional: 0,
    accounted: 0,
    unaccounted: 0,
    conditionalSteps: 0,
    conditionalJobs: 0,
    filteredWorkflows: 0,
    nonPullRequestWorkflows: 0,
  };
  for (const { file, text } of entries) {
    if (!declaresPullRequestTrigger(text)) {
      counts.nonPullRequestWorkflows += 1;
      continue;
    }
    if (extractTriggerPaths(text).length > 0) {
      counts.filteredWorkflows += 1;
      continue;
    }
    for (const job of extractJobBlocks(text)) {
      if (job.if) {
        counts.conditionalJobs += 1;
        continue;
      }
      for (const step of extractStepBlocks(job.text)) {
        const commands = runCommandTexts(step.text)
          .flatMap((c) => c.split('\n'))
          .map((l) => l.trim())
          .filter((l) => l !== '');
        if (commands.length === 0) continue;
        if (step.if) {
          counts.conditionalSteps += 1;
          continue;
        }
        counts.unconditional += 1;
        if (extractCheckInvocations(step.text, file).length > 0) {
          counts.accounted += 1;
          continue;
        }
        rows.push({ workflow: file, job: job.name, step: step.name, commands });
      }
    }
  }
  counts.unaccounted = rows.length;
  return { rows, counts };
}

/**
 * ⭐ The OTHER half of the same partition: every step of a CI job that YOUR
 * paths schedule, which this derivation names no check family for.
 *
 * `alwaysRunSteps` above answers "what does CI run on every PR that I derive
 * nothing for". It answers that question only for the jobs CI CANNOT narrow —
 * it excludes a path-filtered workflow, and it excludes any job carrying an
 * `if:`, which is every job whose schedule a `dorny/paths-filter` output
 * decides. Those two exclusions are correct for the claim that tail makes
 * ("CI runs this whatever your diff is") and they are exactly why the
 * path-narrowed jobs had no reader at all: the family derivation looks INSIDE
 * them for `check:*` invocations and reports what it finds, and nothing
 * anywhere reported the rest of what those jobs run.
 *
 * ## The measured failure (#16285)
 *
 * `packages/qa/dogfood` routes to no gate family. A dev editing
 * `packages/qa/dogfood/test/authz-probe-blind-spot.census.ts` derived 43
 * commands with not one mention of dogfood on stdout, ran all 43, reconciled
 * with `--ran`, and truthfully reported full coverage while
 * `Dogfood Regression Gate (3/3)` was red on a test file in the very package
 * they had edited. `--ran` cannot catch it: it reconciles against what the
 * derivation produced, and the derivation never named the job.
 *
 * ⛔ The instance fix is REFUSED, and the count is why. Of the 74 workspace
 * packages that declare a `test` script, ZERO are run by any of the 215
 * `check:*` scripts in this tree — every one of them is run by a workflow job
 * (`Test Core (N/6)` over the affected set, `Dogfood Regression Gate (N/3)`
 * over the one package the partitioner excludes from it). So `packages/qa/
 * dogfood` is not a missing edge, it is the first instance of a whole
 * VOCABULARY this derivation did not have: its words are `check:*` families,
 * and a workflow job watches a path just as much as a gate script does. A
 * per-package edge would have to be re-derived for every one of the 74 and
 * would still say nothing about the 75th.
 *
 * ## What is claimed for a row, and what is deliberately NOT
 *
 * Claimed: CI schedules this JOB for this path of yours, through the job
 * `if:` this tool already resolves for the family derivation — and this step
 * of it runs a command no discovered family accounts for. Both halves are
 * read off the workflow text on every run; nothing here is listed.
 *
 * ⛔ NOT claimed: that a row is a test, a build or a setup step.
 * `alwaysRunLines` refuses that classification for its own rows and the reason
 * carries unchanged — every rule that separates them is a guess about a step's
 * intent, and a guess in this position fabricates. `pnpm install
 * --frozen-lockfile` and the sharded `turbo run test` sit in the same job and
 * the reader judges which is which; what the tool states is only what it
 * measured.
 *
 * ⛔ NOT a runnable command. Every row is CI's own shell, in CI's environment,
 * with `${{ … }}` and `$RUNNER_TEMP` in it — so this block is OUTSIDE the
 * runnable total and ⛔ never in `--commands`' stdout, for the reason
 * `notRunnableRows` states one channel over: a stream a consumer executes must
 * not carry a command that cannot run.
 *
 * ## What is excluded, and why each exclusion is the safe direction
 *
 *   - a job whose `if:` this tool cannot resolve to a filter output: it
 *     contributes no population, exactly as it contributes none to the family
 *     derivation, and a population guessed at would fabricate a schedule;
 *   - a job whose population covers none of your paths: CI may skip it, so no
 *     per-card claim is available;
 *   - a step carrying an `if:`: counted and RETURNED, never silently dropped —
 *     the claim is "CI runs this for your path", and a condition this walk did
 *     not evaluate could falsify it, the same standard the tail holds;
 *   - a step the family derivation DOES name a check family for: it is already
 *     in the matched block above, and a row here would double-count it. The two
 *     halves are disjoint by construction, which is what makes either count
 *     mean anything.
 */
export function jobFilteredSteps(entries, paths) {
  const rows = [];
  const counts = {
    populations: 0,
    covering: 0,
    named: 0,
    steps: 0,
    accounted: 0,
    unaccounted: 0,
    conditionalSteps: 0,
  };
  for (const { file, text } of entries) {
    for (const job of jobFilterPopulations(text)) {
      counts.populations += 1;
      // Every path of yours this job's population covers, with the pattern that
      // covered it — the same provenance the matched column carries, and for
      // the same reason: a row is a claim and the reader is owed what backs it.
      const hits = [];
      for (const path of paths) {
        const pattern = triggerListCovers(job.paths, path);
        if (pattern) hits.push({ path, pattern });
      }
      if (hits.length === 0) continue;
      counts.covering += 1;
      const steps = [];
      for (const step of extractStepBlocks(job.text)) {
        // Continuations are SPLICED before the split, so a row is the command
        // the shell sees rather than a fragment of its argv. It is the same
        // reading `extractCheckInvocations` takes for the same body, and here
        // it is what keeps the disclosure intact under the cap below: the
        // dogfood job's test invocation is the FIFTH physical line of a
        // backslash-continued command and the FIRST logical one, so unspliced
        // it is the line the elision eats — a pointer that elides the one line
        // the reader came for. ⛔ The always-runs tail is deliberately left
        // reading physical lines: its rows are a disjoint set of jobs with
        // their own pins, and changing a rendering this card does not touch is
        // scope this card does not have.
        const commands = runCommandTexts(step.text)
          .flatMap((c) => joinLineContinuations(c).split('\n'))
          .map((l) => l.trim())
          .filter((l) => l !== '');
        if (commands.length === 0) continue;
        if (step.if) {
          counts.conditionalSteps += 1;
          continue;
        }
        counts.steps += 1;
        if (extractCheckInvocations(step.text, file).length > 0) {
          counts.accounted += 1;
          continue;
        }
        counts.unaccounted += 1;
        steps.push({ step: step.name, commands });
      }
      if (steps.length === 0) continue;
      counts.named += 1;
      rows.push({ workflow: file, job: job.name, outputs: job.outputs, hits, dropped: job.dropped, steps });
    }
  }
  return { rows, counts };
}

/**
 * Does this `run:` line invoke a TypeScript type-check PROGRAM?
 *
 * Two spellings, both read as ARGV TOKENS and never as substrings, because the
 * substring reading over-matches on this very tree: an `echo` about a
 * `tsc-built package` and the lane aggregator's own `console.log` about a
 * `type-check lane` each carry the word and neither runs anything.
 *
 *   - `tsc` as a token together with `--noEmit`, `-p` or `--project`;
 *   - `run` followed by `typecheck` or `type-check` — the task or script name,
 *     whoever runs it (`turbo run typecheck`, `pnpm --filter X run typecheck`).
 *
 * ⛔ The MISSES are silent, every one — `pnpm typecheck`, `pnpm -r typecheck`
 * and `node --run typecheck` carry no `run` token; `tsc --build`, `tsc -b`,
 * `vue-tsc` and `tsgo` are not this vocabulary. So the producer SIZES its walk,
 * and the live control pins the required aggregate's lanes BY NAME.
 */
export function isTypeCheckInvocation(command) {
  if (typeof command !== 'string') return false;
  const tokens = command.split(/\s+/).filter((t) => t !== '').map((t) => t.replace(/^['"]+|['"]+$/g, ''));
  if (tokens.includes('tsc') && tokens.some((t) => ['--noEmit', '-p', '--project'].includes(t) || t.startsWith('--project='))) return true;
  return tokens.some((t, i) => t === 'run' && ['typecheck', 'type-check'].includes(tokens[i + 1]));
}

/**
 * ⭐ The TYPE-CHECK LANES CI runs — every step whose `run:` invokes a
 * TypeScript type-check program, read from the SAME workflow entries the two
 * blocks above read, so no block can describe a different revision of a
 * workflow than the families printed beside it.
 *
 * ## The measured failure (#19172)
 *
 * A dev derived this tool's families for a PR, ran all 82 green, and shipped a
 * red on the required `TypeScript Type Check` context: `packages/spec`'s own
 * `typecheck` exited 2 on two TS7016 errors one added import line introduced.
 *
 * ⛔ What was missing was NOT the steps. Measured: all four rows this walk
 * returns were already rows of the always-runs tail — same workflow, job, step
 * and command, 4 of its 33. Missing was a NAME for them and any disclosure at
 * all on `--commands`, where a dispatch order is built. ⭐ And that absence did
 * not read as one: the derivation DOES emit `check:type-check-coverage` and
 * `check:type-check-debt` for a TypeScript-touching path — on that PR's paths,
 * 2 of 70 commands matched a `typecheck` grep, both of them those LEDGER gates.
 * So a reader greps the one word they would grep, finds something, and stops.
 *
 * Claimed for a row: this step's `run:` invokes a type-check program, read off
 * the argv of the SPLICED command text (`joinLineContinuations`, the reading
 * `jobFilteredSteps` takes — an unspliced split drops a continued invocation
 * silently). ⛔ NOT claimed: the step's INTENT — `alwaysRunLines` refuses that
 * classification and the reason carries unchanged. ⛔ NOT runnable and ⛔ never
 * in `--commands`: every row is CI's own shell over its whole-workspace filters.
 *
 * A job or step carrying an `if:` is KEPT and MARKED, never excluded: the two
 * blocks above drop a conditional because each claims CI definitely runs the
 * step, and this one claims only that the lane exists — a lane a reader cannot
 * see because it MIGHT be skipped is the absence this block was filed on.
 */
export function typeCheckLaneSteps(entries) {
  const rows = [];
  const counts = { prWorkflows: 0, nonPullRequestWorkflows: 0, steps: 0, runLines: 0, conditional: 0 };
  for (const { file, text } of entries) {
    if (!declaresPullRequestTrigger(text)) {
      counts.nonPullRequestWorkflows += 1;
      continue;
    }
    counts.prWorkflows += 1;
    for (const job of extractJobBlocks(text)) {
      for (const step of extractStepBlocks(job.text)) {
        const lines = runCommandTexts(step.text)
          .flatMap((c) => joinLineContinuations(c).split('\n'))
          .map((l) => l.trim())
          .filter((l) => l !== '');
        if (lines.length === 0) continue;
        counts.steps += 1;
        counts.runLines += lines.length;
        const commands = lines.filter((l) => isTypeCheckInvocation(l));
        if (commands.length === 0) continue;
        const conditional = Boolean(job.if) || Boolean(step.if);
        if (conditional) counts.conditional += 1;
        rows.push({ workflow: file, job: job.name, step: step.name, commands, conditional });
      }
    }
  }
  return { rows, counts };
}

/**
 * A workflow's OWN declaration that it deliberately has no check family to
 * discover — a whole-line comment anywhere in the workflow text:
 *
 *   # dispatch-gates: no-check-families -- <reason>
 *
 * ## Why a marker IN the workflow, never a list in this script (#9187)
 *
 * `checkFamilyCoverageGaps` below turns "a paths-filtered workflow discovers
 * zero check families" from a silent omission into a CI failure — but one
 * real case (`scaffold-e2e.yml`: an install/build/boot/docker pipeline, not a
 * named local verification) is not a bug, it is a workflow that genuinely has
 * none. The tempting fix is a hardcoded exemption list ([`scaffold-e2e.yml`])
 * in THIS file — which reinstalls the exact failure this whole family exists
 * to retire: a second copy of a fact that belongs on the thing it describes,
 * silently drifting from it (the workflow gets renamed or a real gap gets
 * added beside the exempted one, and the list says nothing). A marker the
 * workflow carries is instead read fresh every run, same as `paths:` and
 * every `run:` step above — nothing to remember to update here.
 *
 * The reason is REQUIRED (not just the marker) — an opt-out with no reason
 * reads identically to a placeholder nobody will ever revisit, and is exactly
 * the shape a reviewer cannot tell apart from "forgot to name a family".
 *
 * ## The reason is WHOLE, or the declaration is REFUSED (#18662)
 *
 * This marker captured its reason with the same `(\S.*)$`-under-`m` shape the
 * three population markers did, so the capture ended at the FIRST NEWLINE and
 * a reason an author wrapped onto the comment line below reached its reader as
 * a sentence that simply stops — the #18422 defect on a marker that repair did
 * not reach. Measured on `origin/main` 034f5a3afd before this change: a
 * two-line reason read back as line one, `checkFamilyCoverageGaps` accepted the
 * workflow, and nothing sounded. So the grammar now comes out of the shared
 * builder and the read is graded by the shared wholeness reading; a continued
 * reason THROWS, naming the workflow, the line, the marker and the text that
 * continues it.
 *
 * ⚠️ Nothing in this tool RENDERS this reason (measured, #18662): the only
 * consumer is `checkFamilyCoverageGaps`, which reads the return value as a
 * BOOLEAN. The refusal is still owed — wholeness is a property of the
 * declaration, not of today's consumer, and the next reader of the reason is
 * the seat that greps the workflow for it — but the cost of a cut here is that
 * seat's, not a rendered row's, and this sentence is the price said out loud
 * rather than left to be discovered.
 *
 * ## `#` is the ONLY form here, and that is a property of YAML (#18662)
 *
 * The key restriction in `MARKER_KEY_FORMS` is not a narrowing of the roster:
 * this marker is read out of a workflow's YAML text, where `#` is the only
 * comment syntax there is. `//`, and every BLOCK form #18661 added, are not
 * comments in YAML at all — a line spelled that way is document content, so
 * admitting one would read a declaration off text the workflow's own parser
 * never treats as a remark. ⛔ The block forms therefore cannot apply to this
 * marker, and widening it to them would be a defect rather than a courtesy.
 */
export function declaredNoCheckFamiliesReason(workflowText, file = null) {
  const read = readPopulationMarker(workflowText, 'no-check-families');
  if (!read) return null;
  refuseCutMarkerReason(read, 'no-check-families', file);
  return read.reason;
}

// `POPULATION_MARKER_KEYS` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

// `MARKER_COMMENT_FORMS` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

// `MARKER_KEY_FORMS` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

export function markerFormsFor(key, table = MARKER_KEY_FORMS) {
  const labels = table[key];
  if (!labels) return MARKER_COMMENT_FORMS;
  const forms = MARKER_COMMENT_FORMS.filter((f) => labels.includes(f.label));
  if (forms.length !== labels.length) {
    throw new Error(
      `dispatch-gates: MARKER_KEY_FORMS names ${labels.length} form(s) for '${key}' and only ${forms.length} of them ` +
        `are in MARKER_COMMENT_FORMS (${MARKER_COMMENT_FORMS.map((f) => f.label).join(', ')}). The restriction may only ` +
        'ever NARROW the roster — a label the roster does not carry contributes nothing to the alternation, and a ' +
        'declaration of that key would then parse as nothing at all.',
    );
  }
  return forms;
}

/**
 * The HEAD every marker pattern is built out of — the indent, the comment form
 * (group 1) and the key — for the forms THAT key's language has.
 */
function markerLineHead(key) {
  return `^[ \\t]*(${markerFormsFor(key).map((f) => f.open).join('|')})[ \\t]*dispatch-gates:[ \\t]*`;
}

/**
 * Which KIND a captured comment form is — `line` or `block`. Read off the
 * roster above rather than off the characters, so a form added there is
 * classified there too and no reading can disagree with the alternation that
 * matched it. Throws on anything else: the capture group can only ever hold a
 * label from that roster, so an unknown one means the two have drifted apart.
 */
export function markerFormKind(form) {
  const known = MARKER_COMMENT_FORMS.find((f) => f.label === form);
  if (!known) {
    throw new Error(
      `dispatch-gates: unrecognised comment form '${form}' — group 1 can only ever hold one of: ` +
        `${MARKER_COMMENT_FORMS.map((f) => f.label).join(', ')}. A form is added to MARKER_COMMENT_FORMS, never here.`,
    );
  }
  return known.kind;
}

// `REASON_TAIL_MARKER_KEYS` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

export function populationMarkerPattern(key) {
  if (!REASON_TAIL_MARKER_KEYS.includes(key)) {
    throw new Error(
      `dispatch-gates: unknown population marker key '${key}' — known keys: ${REASON_TAIL_MARKER_KEYS.join(', ')}. ` +
        'A marker is added by naming it here, never by writing a fourth copy of this pattern.',
    );
  }
  return new RegExp(`${markerLineHead(key)}${key}[ \\t]*--[ \\t]*(\\S.*)$`, 'm');
}

// `PATH_LIST_MARKER_KEYS` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

export function pathListMarkerPattern(key) {
  if (!PATH_LIST_MARKER_KEYS.includes(key)) {
    throw new Error(
      `dispatch-gates: unknown path-list marker key '${key}' — known keys: ${PATH_LIST_MARKER_KEYS.join(', ')}. ` +
        'A marker is added by naming it here, never by writing a third copy of this pattern.',
    );
  }
  return new RegExp(`${markerLineHead(key)}${key}[ \\t]+(\\S.*?)[ \\t]+--[ \\t]+(\\S.*)$`, 'm');
}

/**
 * Which grammar every reason-bearing `dispatch-gates:` key is read by, and
 * which capture group of it holds the REASON (#18662) — built BY CONSTRUCTION
 * out of the two rosters above rather than hand-listed.
 *
 * ## Why by construction, and not a fourth hand-written table
 *
 * Both builders end in a reason capture, so every key either builder serves
 * carries a reason that can be CUT — the #18422 defect is a property of the
 * grammar, not of the three keys it was found on. A hand-listed roster here
 * would be a second copy of "which keys have a reason", and it would be wrong
 * in exactly the silent direction the moment a sixth key was added to either
 * builder: the key would parse, the reason would capture, and nothing would
 * ask whether it ended where its author did — which is how `no-check-families`
 * and both path-list markers sat outside the repair until this card. Derived,
 * the class is closed: a key added to either roster gets the wholeness reading
 * in the same line, and cannot be added without it.
 *
 * Group 2 is the reason for a reason-tail key (group 1 is the form); group 3
 * is the reason for a path-list key (group 2 is the path list).
 */
export const MARKER_REASON_GRAMMARS = Object.freeze(Object.fromEntries([
  ...REASON_TAIL_MARKER_KEYS.map((k) => [k, Object.freeze({ build: populationMarkerPattern, reasonGroup: 2 })]),
  ...PATH_LIST_MARKER_KEYS.map((k) => [k, Object.freeze({ build: pathListMarkerPattern, reasonGroup: 3 })]),
]));

/**
 * A `dispatch-gates:` declaration read WHOLE — its form, its reason, and the
 * line that CUTS the reason short — off ONE match (#18422, widened to the block
 * forms by #18661 and to every reason-bearing marker key by #18662). Pure over
 * the source text, so the refusals below, the five `declared*` readers and any
 * future caller cannot disagree about what a cut reason is or about where a
 * whole one ends.
 *
 * ⚠️ Still spelled `readPopulationMarker` for the reason
 * `REASON_TAIL_MARKER_KEYS` states: the exported half of this machinery is
 * named `population*` and a reader greps for it. `MARKER_REASON_GRAMMARS` is
 * the authority on which keys it reads — today all seven, population or not.
 *
 * Returns `{ form, kind, line, reason, cut, match }`, or null when this source
 * carries no usable declaration of that key — no match, or a match whose reason
 * is empty, which is a declaration written and dropped rather than one made.
 * `line` is the 1-based line the declaration is written on; `cut` is
 * `{ line, text, kind }` — the 1-based line that truncates the reason and its
 * text, because a refusal a reader cannot navigate to is a refusal they cannot
 * act on — or null when the reason is whole. `match` is the raw match, so a
 * path-list reader takes its path list off the SAME read its reason came from
 * and the two can never describe different declarations.
 *
 * Reads the FIRST marker of that key, exactly as the capture does: a second
 * declaration of one key in one file is a different defect, and every reading
 * taken off this function must grade the declaration the capture returned.
 *
 * The two KINDS part company on ONE question and no other — where the reason
 * ENDS. `MARKER_COMMENT_FORMS`' docblock is the authority on why; the two
 * functions under this one are where that answer is executed.
 */
export function readPopulationMarker(scriptSource, markerKey) {
  const grammar = MARKER_REASON_GRAMMARS[markerKey];
  if (!grammar) {
    throw new Error(
      `dispatch-gates: unknown marker key '${markerKey}' — known keys: ` +
        `${Object.keys(MARKER_REASON_GRAMMARS).join(', ')}. A marker is added by naming it in one of the two grammar ` +
        'rosters, never by writing another copy of this pattern.',
    );
  }
  const text = String(scriptSource);
  const m = grammar.build(markerKey).exec(text);
  if (!m) return null;
  // Counted off the SAME text the capture read, and off `m.index` rather than
  // by re-matching: the pattern is anchored at the line start, so the newlines
  // before the match ARE the declaration's line number.
  const declarationLine = text.slice(0, m.index).split('\n').length;
  const lines = text.split('\n');
  const kind = markerFormKind(m[1]);
  const tail = m[grammar.reasonGroup];
  const read = kind === 'block'
    ? blockFormReason(lines, declarationLine, tail)
    : lineFormReason(lines, declarationLine, m[1], tail);
  if (!read.reason) return null;
  return { form: m[1], kind, line: declarationLine, reason: read.reason, cut: read.cut, match: m };
}

/**
 * The LINE forms' reading, unchanged from #18422 in both halves: the
 * declaration owns the line it is written on, and a comment line under it IN
 * THE SAME FORM, carrying text that is not a new `dispatch-gates:` key, is the
 * cut. The form is the whole point — `#` is not a comment in a file whose
 * declaration is spelled `//`, so such a line cannot be continuing it, and the
 * opener comes off the same roster the alternation was built from so the two
 * can never disagree about what that form's comment looks like.
 */
export function lineFormReason(lines, declarationLine, form, tail) {
  const reason = tail.trim();
  const next = lines[declarationLine];
  if (next === undefined) return { reason, cut: null };
  const opener = MARKER_COMMENT_FORMS.find((f) => f.label === form).open;
  const continuation = new RegExp(`^[ \\t]*${opener}[ \\t]*(\\S.*)$`).exec(next);
  if (!continuation) return { reason, cut: null };
  const continued = continuation[1].trim();
  // A NEW key below a declaration is a second declaration, never a continuation
  // of the first. The pair refusals are what grade that shape, and they are
  // deliberately left to do it: a reason that reads "dispatch-gates: …" is not
  // a reason anyone wrapped.
  if (/^dispatch-gates:/.test(continued)) return { reason, cut: null };
  return { reason, cut: { line: declarationLine + 1, text: continued, kind: 'line' } };
}

/**
 * The BLOCK forms' reading: the star-prefixed lines under the declaration are
 * the SAME comment, so they are joined into the reason until one of the five
 * terminators the form roster pins — the closing delimiter, a blank star-only
 * line, the next star-@tag line, another `dispatch-gates:` key, or EOF. A line
 * carrying TEXT with no star prefix is none of the five: it is reason text this
 * walk cannot read, which is the silent direction, so it is recorded as the CUT
 * and refused exactly as a line form's continuation is.
 *
 * The closing delimiter is found by SCANNING for it rather than by anchoring a
 * pattern, because it sits at the end of a content line as readily as on one of
 * its own — and a reason can never contain it, since the two characters would
 * have ended the comment.
 */
function blockFormReason(lines, declarationLine, tail) {
  const head = blockChunk(tail);
  const parts = head.text ? [head.text] : [];
  let cut = null;
  if (!head.closed) {
    for (let i = declarationLine; i < lines.length; i += 1) {
      const raw = lines[i];
      const cont = blockContinuationChunk(raw);
      if (!cont) {
        // A blank line ends the paragraph whichever side of the closing
        // delimiter it falls on. A line with TEXT and no star prefix is the one
        // shape that is refused rather than read as an ending.
        if (raw.trim() !== '') cut = { line: i + 1, text: raw.trim(), kind: 'block' };
        break;
      }
      if (cont.text === '') break;
      if (cont.text.startsWith('@')) break;
      if (/^dispatch-gates:/.test(cont.text)) break;
      parts.push(cont.text);
      if (cont.closed) break;
    }
  }
  return { reason: parts.join(' '), cut };
}

/**
 * The comment TEXT on one line of a block, up to the closing delimiter, and
 * whether that delimiter was on it.
 */
function blockChunk(rest) {
  const end = rest.indexOf('*/');
  return end === -1
    ? { text: rest.trim(), closed: false }
    : { text: rest.slice(0, end).trim(), closed: true };
}

/**
 * One CONTINUATION line of a block comment, or null when the line is not one.
 * A star-only line and a bare closing delimiter both read as empty text — the
 * two terminators that are not the end of the reason's own sentence.
 */
function blockContinuationChunk(raw) {
  const m = /^[ \t]*\*(.*)$/.exec(raw);
  if (!m) return null;
  const rest = m[1];
  if (rest.startsWith('/')) return { text: '', closed: true };
  return blockChunk(rest);
}

/**
 * The line that CUTS a population declaration's reason short, or null when the
 * reason is whole (#18422). A thin reading of `readPopulationMarker` above, kept
 * exported and kept to its own signature because the refusal and the discovery
 * both name it, and because a caller asking only this question should not have
 * to know the shape of the whole reading.
 *
 * Returns `{ file, line, text, kind }` — the 1-based line number of the CUT
 * (not of the declaration), its text, and which KIND of form was cut, because
 * the two kinds are cut by different shapes and the refusal has to say which.
 * `file` is whatever the caller knew the source by; the discovery passes the
 * repo-relative path it read, so reason and cut can never describe two
 * different files.
 */
export function populationReasonContinuation(scriptSource, markerKey, file = null) {
  const read = readPopulationMarker(scriptSource, markerKey);
  if (!read?.cut) return null;
  return { file: file ?? null, line: read.cut.line, text: read.cut.text, kind: read.cut.kind };
}

/**
 * WHY a cut reason must be refused — the text, for ANY reason-bearing marker
 * key (#18662), and the one place both sentences live.
 *
 * `populationReasonCutRefusal` below is this function reached through a
 * discovery ENTRY, and its output is byte-identical to what it was before this
 * split: the three population channels carry their reason and their cut in
 * entry fields, which the other three markers have no entry to carry. Those
 * three reach it with the cut in hand instead — one text, five keys, so a
 * reader who has seen this refusal once has seen all of them.
 *
 * Returns null when `cut` is null, i.e. when the reason is whole.
 */
export function markerReasonCutRefusal(markerKey, cut) {
  if (!MARKER_REASON_GRAMMARS[markerKey]) {
    throw new Error(
      `dispatch-gates: unknown marker key '${markerKey}' — known keys: ` +
        `${Object.keys(MARKER_REASON_GRAMMARS).join(', ')}.`,
    );
  }
  if (!cut) return null;
  const where = `${cut.file ?? 'the declaring file'}:${cut.line}`;
  // A BLOCK form is cut by a different shape and takes a different repair
  // (#18661), so it gets its own text rather than the line forms' advice. In a
  // block the star lines under a declaration ARE the reason — the walk joins
  // them — so the only way to lose half of one is to write a line the walk
  // cannot see as part of the comment. Telling that author to "put the whole
  // reason on the marker line" would send them to the wrong half of their
  // declaration, which is precisely what this family of refusals exists not to
  // do. The line forms' text below is unchanged, byte for byte.
  if (cut.kind === 'block') {
    return `declares ${markerKey} inside a block comment and its reason is CUT at ${where} by a line the block walk `
      + `cannot read as part of the comment: "${cut.text}". Inside a block the star-prefixed lines under a `
      + 'declaration are the same comment and are joined into the reason; a line with text and no star prefix is '
      + 'neither a continuation nor one of the endings (the closing delimiter, a blank star line, the next star-@tag, '
      + 'another dispatch-gates: key), so everything from it on is dropped and the seat is handed the declaration cut '
      + 'off mid-sentence. Give that line the block\'s star prefix, or end the reason before it with a blank star '
      + 'line. Rewrite the declaration — never route around this refusal.';
  }
  return `declares ${markerKey} and its reason does not END on the marker line: ${where} continues it with `
    + `"${cut.text}". The capture stops at the FIRST NEWLINE, so the seat is handed the declaration cut off `
    + 'mid-sentence — and the reason is the one thing a seat reads off this row when deciding whether the family '
    + 'belongs on its card. Put the WHOLE reason on the marker line, however long it runs (this tree already carries '
    + 'one-line reasons past 1200 characters), and separate any comment written under the declaration with a blank '
    + 'line. ⛔ Never widen the marker to swallow the next line instead: nothing in the text tells a wrapped reason '
    + 'from an unrelated comment, so that repair would make the next paragraph part of a seat-facing reason silently. '
    + 'Rewrite the declaration — never route around this refusal.';
}

/**
 * The cut refusal DELIVERED, for the three markers whose reason no rendering
 * ever prints (#18662) — `no-check-families`, `inherited-population` and
 * `self-test-reads`.
 *
 * ## Why a throw here, where the population markers get a row
 *
 * The three population channels carry their declaration into a discovery entry
 * that IS rendered, so their refusal is a printed row and a red self-test case.
 * These three have no such row: measured on `origin/main` 034f5a3afd, every
 * production call site of all three reads only the BOOLEAN or the PATH LIST,
 * and not one renders the reason to a seat or to a log. A refusal returned as
 * text would therefore be a refusal returned to nobody — the exact silence
 * this whole marker family exists to end.
 *
 * So the read itself refuses, which is already how both path-list markers
 * refuse an invented path: the tool's CLI catches it, prints
 * `dispatch-gates: derivation failed — <this text>` and exits 2, so a cut
 * reason reds every run of this tool rather than reaching a reader as half a
 * sentence. The message names the FILE, the LINE, the MARKER and the text that
 * continues it — the four a reader needs to navigate to it.
 */
export function refuseCutMarkerReason(read, markerKey, file) {
  if (!read?.cut) return;
  const why = markerReasonCutRefusal(markerKey, { ...read.cut, file: file ?? null });
  throw new Error(`dispatch-gates: ${file ?? 'the declaring file'} ${why}`);
}

/**
 * A GATE SCRIPT's own declaration that it deliberately has no path population —
 * a whole-line comment anywhere in the script's source:
 *
 *   // dispatch-gates: no-path-population -- <reason>
 *   #  dispatch-gates: no-path-population -- <reason>      (shell gates)
 *   /* dispatch-gates: no-path-population -- <reason>      (block comment; the
 *    * reason may wrap onto the star lines under it, and ends at the
 *    * closing delimiter, a blank star line or the next star-@tag)
 *    * dispatch-gates: no-path-population -- <reason>      (inside a docblock)
 *
 * ## What it is for (#10542)
 *
 * `undetermined` is this derivation's honest bucket — "source names no path at
 * all, NOT known irrelevant" — and it is honest precisely because it does not
 * claim to know why. That is the right verdict and the wrong report: measured
 * over this tree, the bucket holds gates whose emptiness has three completely
 * different causes, and a reader cannot tell them apart:
 *
 *   the derivation CANNOT place it   a gate whose population is a registry,
 *                                    not a path (the spec-liveness job)
 *   the derivation NEED NOT place it a gate whose CI invocation is its own
 *                                    `--self-test`, so no card's file surface
 *                                    should ever schedule it
 *   the derivation ALREADY places it a gate whose population is one repo-root
 *                                    file its own workflow names in `paths:`,
 *                                    reached through the trigger key (#9171)
 *                                    rather than through a hint
 *
 * The last two are FINISHED work that reads exactly like the unexamined pile.
 * #10542 was filed against a count of that pile, and the count could not have
 * distinguished them — which is the failure this marker retires: a family whose
 * emptiness has been read and explained says so, in its own source, and the
 * residue reports it apart from the families nobody has looked at.
 *
 * ## Why a marker IN the gate, never a list in this script
 *
 * Same reason as `declaredNoCheckFamiliesReason` above, one level down: a
 * hardcoded roster here is a second copy of a fact that belongs on the thing it
 * describes, and it drifts silently — the gate grows a real population, or gets
 * renamed, and the roster keeps vouching for it. A marker the gate carries is
 * read fresh on every run.
 *
 * The reason is REQUIRED, not just the marker. An opt-out with no reason reads
 * identically to a placeholder nobody will revisit, and is exactly the shape a
 * reviewer cannot tell apart from a gate whose population was never examined.
 *
 * ⚠️ This marker is NOT an escape from declaring a real population. A gate that
 * walks a subtree declares it (the `ROOT_DIR_WATCH_HINTS` idiom); a gate whose
 * population is a repo-root file declares the subtree spelling. The marker is
 * for the families where BOTH of those are false, and the self-test holds that
 * line by asserting the live tree's markers are only ever on families this
 * derivation leaves unplaced.
 */
export function declaredNoPathPopulation(scriptSource) {
  return readPopulationMarker(scriptSource, 'no-path-population')?.reason ?? null;
}

/**
 * A GATE SCRIPT's own declaration that its population is the WHOLE TREE — a
 * whole-line comment anywhere in the script's source:
 *
 *   // dispatch-gates: whole-tree-population -- <reason>
 *   #  dispatch-gates: whole-tree-population -- <reason>      (shell gates)
 *   /* dispatch-gates: whole-tree-population -- <reason>      (block comment; the
 *    * reason may wrap onto the star lines under it, and ends at the
 *    * closing delimiter, a blank star line or the next star-@tag)
 *    * dispatch-gates: whole-tree-population -- <reason>      (inside a docblock)
 *
 * Read it as the exact INVERSE of `no-path-population` above — which is why
 * the two are spelled to read as opposites, tolerate the same two comment
 * forms, and are parsed by sibling regexes. That one says "this gate reads NO
 * file, and here is why". This one says "this gate reads EVERY file; every
 * card implicates me; do not try to narrow me."
 *
 * ## The defect (#14189, filed out of #13519's measured M bucket)
 *
 * #13519 repaired four gates by having each declare, in its own module body,
 * the population it really reads (the `ROOT_DIR_WATCH_HINTS` idiom). Three
 * could not be repaired that way, and the reason was the same for all three:
 * their population is the whole repository. `check:nul-bytes` sweeps
 * `git ls-files` PLUS the untracked-not-ignored listing;
 * `check-comment-mask-corpus` walks every authored source file from the repo
 * root; `check:refd-timer-probe` reads the same tracked-plus-untracked tree.
 *
 * A TRUTHFUL declaration for any of them is "every file", and this file's own
 * header prices that direction and refuses it: "22 leads is the same as none".
 * A gate named on every card is a gate named on no card, and MATCHED is the
 * one column whose entire value is precision. ⛔ So the remedy is NOT a
 * whole-tree literal in the gate's declaration — not `**`, not `.`, not the
 * bare root: `scripts/workspace-enumerator.mjs`'s header prices the
 * workspace-wide version of exactly that move at +41725 (gate, file) pairs,
 * every one of them a fabricated lead.
 *
 * What did not exist is a third thing for such a gate to BE — neither a lead
 * nor a silence. `check:nul-bytes` is the specimen the card was filed on: a
 * gate every dev is told to run on ANY edit, whose declared population is two
 * files. A dev deriving the family for a card that adds a file with a raw
 * control byte in it was not told about the one gate that judges exactly that,
 * and the report they hand back — "I ran the gates the tool named" — is true
 * and incomplete at the same time.
 *
 * ## What the declaration DOES to the derivation
 *
 * A declaring family is placed BY ITS DECLARATION and leaves the three
 * verdicts entirely (`placeFamily` below is the one seam that does it): never
 * `matched`, because that would be a lead on every card; never `silent`,
 * because its silence would be a lie; never `undetermined`, because its
 * population is not unknown — it has been READ. It is rendered under its own
 * always-runs heading, identical for every card, and its command IS inside the
 * runnable union `--commands` prints and `--ran` reconciles against, because a
 * gate every card implicates is a gate this card owes.
 *
 * The lead columns are untouched by construction: nothing enters or leaves
 * `matched`/`silent`/`undetermined` for any NON-declaring family because of
 * this channel — `placeFamily` delegates to `classifyEntry` unchanged, and a
 * self-test case holds that byte-identity over probe paths.
 *
 * ⚠️ Unlike `no-path-population`, this declaration does NOT contradict a gate
 * that names paths. A whole-tree gate still spells its own baseline artifacts
 * and its own conveniences, and those literals stay in `entry.hints`, where
 * the unreachable sweep and the per-hint residue annotations still grade them.
 * The declaration supersedes them for PLACEMENT only — the one question those
 * literals were answering wrongly. What it DOES contradict is
 * `no-path-population`: "every file" and "no file" cannot both be true of one
 * gate, and `wholeTreePopulationRefusal` refuses the pair.
 *
 * The reason is REQUIRED, for the same reason it is required on both markers
 * above: an opt-out with no reason reads exactly like a placeholder nobody
 * will revisit, and is the one shape a reviewer cannot tell from a gate whose
 * population was never examined.
 */
export function declaredWholeTreePopulation(scriptSource) {
  return readPopulationMarker(scriptSource, 'whole-tree-population')?.reason ?? null;
}

/**
 * A GATE SCRIPT's own declaration that CI runs it over a population TOO WIDE
 * TO PLACE — a whole-line comment anywhere in the script's source:
 *
 *   // dispatch-gates: wide-population -- <reason>
 *   #  dispatch-gates: wide-population -- <reason>      (shell gates)
 *   /* dispatch-gates: wide-population -- <reason>      (block comment; the
 *    * reason may wrap onto the star lines under it, and ends at the
 *    * closing delimiter, a blank star line or the next star-@tag)
 *    * dispatch-gates: wide-population -- <reason>      (inside a docblock)
 *
 * The THIRD derivation channel, and the one that is neither of the two above.
 * `no-path-population` says "this gate reads NO file". `whole-tree-population`
 * says "this gate reads EVERY file". This one says the thing that was true of
 * eleven measured families and that neither of those could express: "this gate
 * walks a real subtree — here is which — and NO subtree glob places it, so do
 * not try to narrow me and do not read my silence as a clearance."
 *
 * ## The defect (#15341, ruled 2026-09-05)
 *
 * #15341 measured sixteen gates CI runs that declare no path literal at all and
 * walk a subtree, so this derivation scored them `undetermined` for every card
 * and no `--commands` harvest could contain them. The card's remedy — declare
 * the subtree with the `ROOT_DIR_WATCH_HINTS` idiom — collided with a recorded
 * triage it did not know about: `scripts/pm/bare-root-worklist.mjs` holds
 * human-decided, per-row-measured verdicts for exactly this species, and eleven
 * of the sixteen sit on its refused side. `REFUSE-WIDE` says the bare-root
 * declaration would be TRUE and is refused anyway, because it names the gate
 * for every card under a root the fleet already touches wholesale — 39%, 37%,
 * 90% precision — and MATCHED is the one column whose entire value is
 * precision. `REFUSE-UNSPELLABLE` says the population is a file-KIND filter
 * inside the root that no glob spelling describes at all.
 *
 * Two lanes, wanting compatible things. The card wants a seat to be TOLD about
 * a gate CI runs. The map refuses ONE WAY of telling them. What did not exist
 * was a third thing for such a gate to BE. Maintainer ruling, 2026-09-05,
 * decision batch #43, verbatim reply 「同意」 to the recommendation quoted here
 * in the terms it was ruled in:
 *
 *   `dispatch-gates.mjs` gains a third derivation channel, `wide-population` —
 *   a gate declares "CI runs me over a population too wide to place", which
 *   lists it in the residue's declared column and keeps it OUT of the matched
 *   column; the eleven `REFUSE-WIDE` / `REFUSE-UNSPELLABLE` families move onto
 *   it; `bare-root-worklist.mjs`'s rows are not deleted.
 *
 * ## What the declaration DOES to the derivation
 *
 * A declaring family leaves `undetermined` for its own verdict, `wide-population`,
 * and is rendered under its own heading with its reason — the DECLARED column
 * the ruling names. Its command is ⛔ NOT in the runnable union `--commands`
 * prints: that is the whole difference from the whole-tree channel beside it. A
 * whole-tree gate is owed by every card, so its command belongs in every card's
 * total; a wide-population gate is owed by CI and by no card in particular, and
 * pasting it into every harvest is the same fabricated lead the map refused —
 * arrived at one channel further along. The reason is what a seat reads.
 *
 * ⚠️ The one placement it does NOT suppress is the IDENTITY key: a card that
 * edits the gate's own script still MATCHES it, and still gets its command.
 * That is not a leak in "keeps it OUT of the matched column" — it is the
 * boundary of what the declaration is ABOUT. The declaration is a claim about
 * the gate's POPULATION (`coveringKey`'s docblock: the identity key is "an
 * identity claim about a single FILE", not a population claim), the ruling's
 * contrast is with declaring the ROOTS, and a card editing the gate is a 100%
 * precise lead this channel has no business deleting — the gate you are editing
 * is the one gate you certainly owe. Suppressing it would make a channel added
 * to ADD information subtract some, silently, on the one card class where the
 * derivation is exactly right. Pinned in both directions below.
 *
 * ⛔ Not an escape from declaring a real population, and refused rather than
 * trusted: a gate that carries this marker AND names paths, or that carries
 * either sibling marker, is REFUSED by `widePopulationRefusal` — a gate
 * declares exactly ONE population shape, and picking between two would be the
 * coin toss `wholeTreePopulationRefusal` refuses one channel over.
 *
 * The reason is REQUIRED, and it is required to do more work here than on
 * either sibling: it must NAME the population in words — which root or roots
 * the gate walks, and why no subtree glob places it — because that sentence is
 * the entire content of this channel. A reader deciding whether to go run the
 * gate has nothing else, and an opt-out with no reason reads exactly like a
 * placeholder nobody will revisit.
 */
export function declaredWidePopulation(scriptSource) {
  return readPopulationMarker(scriptSource, 'wide-population')?.reason ?? null;
}

/**
 * The OPENER a lookalike may carry, for a key whose language is this tree's
 * JavaScript or shell: the indent, then AT MOST ONE opener made of comment
 * punctuation. Deliberately WIDER than `MARKER_COMMENT_FORMS`, because finding
 * a form the roster does not list is half of what the probe is FOR — and it is
 * exactly the half that cannot apply to a key whose language restricts its
 * forms, where every spelling outside the restriction is document content
 * rather than a comment at all.
 */
const MARKER_LOOKALIKE_OPENER = `([^\\s\\w'"\`]{1,4})?`;

/**
 * The HEAD of the lookalike for one key — the indent, the opener THAT key may
 * be written with (group 1), and the prefix. The counterpart of
 * `markerLineHead` one question further out: that one is built from the forms
 * the grammar ACCEPTS, this one from the forms the key's LANGUAGE has.
 */
function markerLookalikeHead(key) {
  const opener = MARKER_KEY_FORMS[key]
    ? `(${markerFormsFor(key).map((f) => f.open).join('|')})`
    : MARKER_LOOKALIKE_OPENER;
  return `^[ \\t]*${opener}[ \\t]*dispatch-gates:[ \\t]*`;
}

/**
 * The lookalike pattern for EVERY reason-bearing `dispatch-gates:` key — keyed
 * on the DERIVED grammar roster, and carrying each key's OWN admissible forms
 * (#18825).
 *
 * ## The defect this roster answers
 *
 * The pattern this replaced was built from `POPULATION_MARKER_KEYS` alone
 * while the tool reads SIX reason-bearing keys, so `unparsedPopulationMarkers`
 * was a probe over three of them and a silence over the other three. Measured
 * on `origin/main` 42f8df1723 through the exported function, one line each:
 * the two population CONTROLS — a `//` line with no separator, and a line
 * opened with an unrecognised `--` — returned 1 row each, while
 * `# dispatch-gates: no-check-families <reason, no separator>`,
 * `// dispatch-gates: inherited-population a b <reason>` and
 * `-- dispatch-gates: self-test-reads a -- x` returned NOTHING at all. One
 * shape, refused by name on a population key and silent on the other three: a
 * dropped declaration there printed exactly what a file that declares nothing
 * prints — no reason, no refusal, no row, no count — which is #18661's own
 * sentence, measured on the keys its repair never reached.
 *
 * What each silence costs, the three named apart because they fail
 * differently: a dropped `inherited-population` lets the module's watch hints
 * fall back to the spelled literals, silently, so a consumer inherits the
 * pre-declaration population with nothing saying the declaration was
 * discarded; a dropped `no-check-families` makes the workflow read as
 * declaring nothing, which today reaches the coverage-gap census as a GAP
 * rather than as a drop; and a dropped `self-test-reads` takes a family out of
 * the DERIVED SET, so `--ran` then reads its zero-NOT-MEASURED verdict over a
 * set that no longer contains it — #18673's own hole, re-opened from the
 * parsing side, and the reason this is not a cosmetic roster.
 *
 * ## Why DERIVED, and derived from THAT roster
 *
 * `MARKER_REASON_GRAMMARS` is already the by-construction answer to "which
 * keys carry a reason that can be dropped": a key named in either grammar
 * builder appears in it without anyone remembering to add it. A hand-list here
 * would be a second copy of that roster, and it would be wrong in exactly the
 * silent direction the moment a seventh key arrived — the key would parse, and
 * the probe would not know it existed. So the probe's roster IS that roster,
 * and the self-test holds the two EQUAL so neither can grow alone.
 *
 * ## The forms are the KEY's own, never the whole roster
 *
 * A key `MARKER_KEY_FORMS` restricts is restricted because its LANGUAGE has no
 * other comment: `no-check-families` is read out of workflow YAML, where `#`
 * is the only comment syntax there is. A `//` or block-form line in a workflow
 * is document content — not a dropped declaration — and admitting one here
 * would report a line the workflow's own parser never treats as a remark,
 * which is the same reading error the grammar refuses one level up. So a
 * restricted key's lookalike is a line in one of ITS OWN forms that fails to
 * parse, and on `no-check-families` that is the missing-`-- <reason>` half
 * alone: in YAML there is no unrecognised-comment-form half to find, because a
 * spelling outside `#` was never a comment to begin with. An unrestricted key
 * keeps the wide opener above, and both halves with it.
 *
 * ⚠️ The refusal below therefore prescribes `markerFormsFor(key)` and not the
 * whole roster: telling the author of a workflow to rewrite their line as `//`
 * would be prescribing a remedy their file cannot take.
 */
export const MARKER_LOOKALIKES = Object.freeze(Object.fromEntries(
  Object.keys(MARKER_REASON_GRAMMARS).map((key) => [key, new RegExp(`${markerLookalikeHead(key)}${key}\\b(.*)$`)]),
));

/**
 * A line that READS as a `dispatch-gates:` declaration and did not PARSE as
 * one — the SOUND a dropped declaration makes (#18661), and the half of that
 * card that outlives the form set it was filed over. Read over EVERY
 * reason-bearing key since #18825, through the derived roster above; still
 * exported under its `population*` name for the reason
 * `REASON_TAIL_MARKER_KEYS` states — that is the name a reader greps for, and
 * moving it would move the name without moving a behaviour.
 *
 * ## Why widening the forms is not the whole repair
 *
 * #18661 was found because two gates wrote their declaration in a comment form
 * the alternation did not list. The forms are widened above; the DEFECT is not
 * the two files, it is that the tool answered a declaration it could not read
 * with exactly the output it gives a file that declares nothing — no reason, no
 * refusal, no row, no count. The author reads the residue and sees their gate
 * in the unexamined pile; the seat reads the same row and concludes nobody has
 * looked. Neither of them has any reason to go and check, because there is
 * nothing to check against. The next comment form nobody thought of replays it
 * exactly, and so does a declaration whose reason someone forgot to write.
 *
 * ## What counts as READING like a declaration
 *
 * The indent, then AT MOST ONE opener THAT KEY may be written with, then
 * `dispatch-gates: <key>`. For a key whose language restricts its forms the
 * opener is that restriction (`markerFormsFor`); for every other key it is the
 * wide punctuation class `MARKER_LOOKALIKE_OPENER` spells. Two deliberate
 * boundaries, and they hold either way:
 *
 *   ONE opener, never two. A line carrying the docblock's own star AND a
 *   second opener is an EXAMPLE of a declaration written inside a comment
 *   about declarations — which is how every example in this file is written,
 *   and it is why they are. The grammar above reads one opener too, so the
 *   probe and the grammar agree about what documentation looks like.
 *
 *   The key text starts the comment. Every live prose mention of these keys in
 *   this tree writes them mid-sentence or inside backticks (`symbol-anchors`,
 *   `workspace-enumerator`, `check-widening-tells`, `check-declared-population-live`,
 *   `bare-root-worklist` — measured, five of them), and a mention that is not
 *   the first thing in its comment was never trying to be a declaration.
 *
 *   A QUOTE is not a comment opener. Gate sources carry declarations inside
 *   string literals — every self-test in this family builds its fixtures out
 *   of them, this file's own included — and they open with a quote or a
 *   backtick, never with comment punctuation. The grammar above already
 *   ignores them for that exact reason (it anchors on a comment form, and a
 *   line beginning with a quote has none), so excluding the three quote
 *   characters here keeps the probe agreeing with the grammar instead of
 *   reporting every fixture in the tree as a dropped declaration.
 *
 * A WORD-character opener (`rem`, `REM`) is not covered — no gate in this tree
 * is written in a language that uses one, and admitting word characters here
 * would make every sentence that opens with the key a finding.
 *
 * ## Both ways a line can read like one and not parse
 *
 * An unrecognised comment FORM, and a recognised form with no `-- <reason>`
 * tail (or an empty one). They are one finding on purpose: the author's
 * experience is identical — they wrote a declaration and the tool behaved as
 * though they had not — and splitting them would let one of the two go quiet.
 *
 * A key `MARKER_KEY_FORMS` restricts has only the SECOND half, and that is a
 * property of its language rather than a gap in this reading: outside `#`
 * there is no comment in YAML for a `no-check-families` line to have been
 * dropped out of, so the first half has nothing to find and a line spelled any
 * other way is document content. `MARKER_LOOKALIKES`' docblock is the
 * authority on why.
 *
 * Pure over the source text, and returns EVERY such line rather than the first:
 * a file with two of them has two authors' declarations dropped.
 */
export function unparsedPopulationMarkers(scriptSource, file = null) {
  const found = [];
  const lines = String(scriptSource).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const [key, lookalike] of Object.entries(MARKER_LOOKALIKES)) {
      const m = lookalike.exec(lines[i]);
      if (!m) continue;
      // Asked of the LINE, because that is the whole question: does this text,
      // as written, reach the grammar? A block declaration whose reason wraps
      // still answers yes here — its own line carries the head of the reason.
      if (!readPopulationMarker(lines[i], key)) {
        found.push({ file: file ?? null, line: i + 1, key, form: m[1] ?? '(no comment opener)', text: lines[i].trim() });
      }
      // A line can name exactly ONE key — the key text follows the prefix
      // immediately — so the first pattern that matches is the only one that
      // can, whichever way the line was then graded.
      break;
    }
  }
  return found;
}


/**
 * Why a dropped population declaration must be refused, or null when a source
 * carries none (#18661) — the same shape the three refusals above take, so the
 * self-test's live half and any future caller cannot disagree about what a
 * dropped declaration is.
 *
 * It names the FILE, the LINE and the FORM it was written in, because those
 * three are exactly what the old output withheld: a reader of the residue could
 * not have found this line from anything the tool printed.
 *
 * ## The remedy is the KEY's own forms, never the whole roster (#18825)
 *
 * Each row carries the forms ITS key may be written in — `markerFormsFor(key)`
 * — because the roster is not the answer for a key whose language restricts
 * it. A dropped `no-check-families` line is in a workflow, and a refusal that
 * offered `//` as the repair would be prescribing a spelling YAML has no
 * comment for: the author would take the advice, the line would parse as
 * document content, and the declaration would still be dropped — the same
 * silence, now with the tool's endorsement. So the forms are named per ROW,
 * and the prose points at the row rather than at a roster.
 */
export function unparsedPopulationMarkerRefusal(unparsed) {
  if (!unparsed?.length) return null;
  const rows = unparsed.map(
    (u) => `${u.file ?? 'the declaring file'}:${u.line} declares ${u.key} in form ${u.form} — "${u.text}" `
      + `(${u.key} may be written in: ${markerFormsFor(u.key).map((f) => f.label).join(', ')})`,
  );
  return `${unparsed.length} line(s) READ as a dispatch-gates declaration and did not PARSE as one: ${rows.join(' · ')}. `
    + 'A declaration the grammar cannot read produces the SAME output as a gate that declares nothing at all — no '
    + 'reason, no refusal, no row — so its author believes the emptiness was explained and its reader believes '
    + 'nobody ever looked, and neither has anything to check. Either the comment form is not one of the forms named '
    + 'beside that key above, or the line carries no "-- <reason>" tail. Rewrite the declaration in one of THAT '
    + 'key\'s forms with a reason, or — if the form is a real comment idiom the language that key is read out of '
    + 'uses — add it to MARKER_COMMENT_FORMS in scripts/pm/dispatch-gates.data.mjs (and to that key\'s MARKER_KEY_FORMS '
    + 'entry, where it has one) with a self-test case beside it, answering where a reason written in it ENDS. '
    + '⛔ Never delete the line to clear this refusal: a declaration nobody can read and a declaration nobody wrote '
    + 'are the two states this refusal exists to keep apart.';
}

/**
 * The three channels' entry fields, in one roster (#18422) — which field holds
 * each marker's captured reason, which holds the line that continues it, and
 * which reader produces the reason.
 *
 * A roster rather than three hand-written pairs because the contract is the
 * same for all three and has to STAY the same: a fourth channel added without
 * a wholeness reading would be a marker whose reason can be cut again, and this
 * is the one place that would have to be edited to add one. The self-test holds
 * the roster equal to `POPULATION_MARKER_KEYS`, so neither can grow alone.
 */
export const POPULATION_DECLARATION_FIELDS = Object.freeze({
  'no-path-population': Object.freeze({
    reason: 'noPopulationReason', cut: 'noPopulationReasonCut', read: declaredNoPathPopulation,
  }),
  'whole-tree-population': Object.freeze({
    reason: 'wholeTreeReason', cut: 'wholeTreeReasonCut', read: declaredWholeTreePopulation,
  }),
  'wide-population': Object.freeze({
    reason: 'widePopulationReason', cut: 'widePopulationReasonCut', read: declaredWidePopulation,
  }),
});

/**
 * Record a population declaration AND the wholeness of its reason from ONE
 * source text (#18422), or leave the entry untouched when that source declares
 * nothing.
 *
 * The two answers come off one read of one file for the reason every other
 * reader in the discovery loop does: a refusal that graded the reason of file A
 * against the continuation of file B would be judging two declarations as one.
 * A family with several files keeps the FIRST declaration it meets, exactly as
 * the `??=` this replaced did.
 */
export function readPopulationDeclaration(entry, scriptSource, file, markerKey) {
  const fields = POPULATION_DECLARATION_FIELDS[markerKey];
  if (!fields) {
    throw new Error(
      `dispatch-gates: unknown population marker key '${markerKey}' — known keys: ` +
        `${Object.keys(POPULATION_DECLARATION_FIELDS).join(', ')}.`,
    );
  }
  if (entry[fields.reason] != null) return;
  const reason = fields.read(scriptSource);
  if (reason == null) return;
  entry[fields.reason] = reason;
  entry[fields.cut] = populationReasonContinuation(scriptSource, markerKey, file);
}

/**
 * Why a population declaration's REASON must be refused, or null when it is
 * whole (#18422) — the third refusal, and the one the other two delegate to.
 *
 * Shared across all three channels because the defect is one defect: the
 * capture stops at the first newline whichever marker it belongs to, so a
 * per-channel copy of this reading would be three chances to fix it in two
 * places. `no-path-population` has no refusal function of its own — it is
 * graded inline where it is rendered and in the self-test's live half — so this
 * is that channel's refusal as well as the wholeness half of the other two.
 *
 * ⚠️ It fires AFTER the pair refusals in both callers, deliberately: a
 * declaration that contradicts a sibling marker is refused for THAT, and the
 * pair refusals' text is what a reader has been getting for it. It fires BEFORE
 * `widePopulationRefusal`'s hint check and before the whole-tree walk check,
 * because both of those grade the declaration against a reason this reading
 * says is only PART of one — a hint named in the wrapped half would be read as
 * unaccounted for, and the refusal would name the wrong defect.
 */
export function populationReasonCutRefusal(entry, markerKey) {
  const fields = POPULATION_DECLARATION_FIELDS[markerKey];
  if (!fields) {
    throw new Error(
      `dispatch-gates: unknown population marker key '${markerKey}' — known keys: ` +
        `${Object.keys(POPULATION_DECLARATION_FIELDS).join(', ')}.`,
    );
  }
  if (!entry?.[fields.reason]) return null;
  // The TEXT lives in `markerReasonCutRefusal` since #18662, so the three
  // markers with no entry to carry a cut are refused in the same words as the
  // three that have one. Byte-identical output either way: this reading is the
  // entry-shaped half, nothing more.
  return markerReasonCutRefusal(markerKey, entry?.[fields.cut] ?? null);
}

/**
 * The recognised spellings of a REPO-ROOT WALK — the liveness half of the
 * declaration above, and PUBLISHED here rather than left inside the
 * implementation.
 *
 * ## Why a liveness predicate at all
 *
 * `check:declared-population-live` (#13519) exists because a declared
 * population that reaches NOTHING is the quietest failure this family has: the
 * gate keeps declaring, the derivation keeps placing it, and every count still
 * prints. This channel has the same exposure pointed the other way — a gate
 * that declares the whole tree and does not walk it would be advertised on
 * EVERY card forever, and a wrong row on every card is this file's own
 * definition of a fabricated lead. So the declaration is checkable, and this
 * is what it is checked against.
 *
 * ## What the predicate is, and the direction it is allowed to fail in
 *
 * It is a claim about the gate's own SOURCE TEXT, comments and `--self-test`
 * bodies masked (the same normalization `payloadEnvDependence` applies, for
 * the same reason: what a gate SAYS is not what it READS — a fixture tree
 * built inside a self-test is not the gate's population, and every one of
 * these gates builds one).
 *
 * It is deliberately a NECESSARY condition and not a sufficient one. A gate
 * that seeds a root walk and then filters it to a subtree passes this and is
 * still mis-declared; nothing textual can settle that, and the declaration's
 * REASON is where the human answer lives, judged by a reader — the same
 * contract `unreachableLines` states for its own listing. What the predicate
 * does buy is the failure direction that is silent: a declaration with no walk
 * behind it at all cannot pass. Its own failure mode is the loud one — a gate
 * that really does sweep the tree in a spelling not listed here is REFUSED,
 * which is a missing declaration somebody has to fix, never a wrong row on
 * every card.
 *
 * ## Why the list is published instead of hidden
 *
 * Same rule AGENTS.md states for `check:cross-package-test-inputs`: a source
 * scan sees only the spellings it knows, and an unrecognised one produces no
 * flag — silently. So the recognised set is written where the author of the
 * next whole-tree gate reads it, the refusal text prints it, and the remedy
 * for a new spelling is to EXTEND this list with a self-test case beside it,
 * never to route around the check.
 *
 * Measured over the six candidate gates #14189 and #14325 nominated: the limbs
 * select five — three by A (`check-nul-bytes`, `check-refd-timer-probe`,
 * `check-closing-keyword-parity`), one by B (`check-watch-hint-literal`), one
 * by C (`check-comment-mask-corpus`) — and `check-self-test-workflow-commands.mjs`
 * is selected by none of them, which is the reading of its source, not a
 * coincidence. Its population is a bounded subtree (`scripts/`), never the
 * tree, so its remedy is the ordinary subtree declaration and not this channel.
 *
 * ⚠️ Re-derived rather than recalled (#15510), and the count is the durable
 * half of that sentence: the ATTRIBUTION was stale. `check-comment-mask-corpus`
 * moved from limb B to limb C when limb B was tightened to refuse a path BUILD
 * (the note on limb B below records that tightening), and "limbs A/B select
 * five" was left behind. The REASON the sixth is unselected is stale-prone for
 * its own reason: it was the SHAPE of that gate's walk, and a gate can stop
 * holding a walk without the census outcome moving at all. What is written
 * above is the population, which is what the remedy turns on.
 */
export const REPO_ROOT_WALK_SPELLINGS = [
  {
    label: 'a `git ls-files` enumeration of the tracked corpus',
    // The subcommand as the gate spells it: an argv element, never the joined
    // command line, because that is how `execFileSync` takes it here.
    re: /['"`]ls-files['"`]/,
  },
  {
    // The root is the WHOLE argument list, deliberately. Written to allow a
    // trailing comma-argument this limb accepts `join(REPO_ROOT, 'scripts')`
    // and `resolve(REPO_ROOT, maskerPath)` — path BUILDS, not walks — which
    // was measured on the candidates and made the limb near-vacuous: it
    // selected `check-comment-mask-corpus` on a `resolve` call while the walk
    // it really performs is reached through limb C.
    label: 'a walk CALLED on the repo-root binding as its whole argument',
    re: /\b[A-Za-z_$][\w$]*\(\s*(?:REPO_ROOT|REPO_ROOT_DIR|ROOT_DIR)\s*\)/,
  },
  {
    label: 'a walk whose DEFAULT PARAMETER is the repo-root binding',
    re: /[({,]\s*[A-Za-z_$][\w$]*\s*=\s*(?:REPO_ROOT|REPO_ROOT_DIR|ROOT_DIR)\s*[,)}]/,
  },
];

/**
 * The first recognised repo-root walk spelling in this gate's own source, or
 * null. The LABEL is returned rather than a boolean, because it is printed
 * beside the declaration it vouches for: a reader deciding whether to trust
 * the row is being told which reading produced it, exactly as the matched
 * column's `via` says which key produced a lead.
 */
export function repoRootWalkSpelling(scriptSource) {
  const body = maskedModuleBody(String(scriptSource));
  for (const { label, re } of REPO_ROOT_WALK_SPELLINGS) if (re.test(body)) return label;
  return null;
}

/**
 * Why this family's whole-tree declaration must be refused, or null when it
 * stands. Pure, and reading only what the discovery already put on the entry,
 * so the live half of the self-test and any future caller cannot disagree
 * about what a bad declaration is.
 *
 * Two refusals, and each one is a contradiction the derivation cannot resolve
 * on the gate's behalf:
 *
 *   BOTH markers   "every file" and "no file" are not both true of one gate.
 *                  Silently preferring either one would place the family by a
 *                  coin toss and print a confident row for it.
 *   NO WALK        the declaration is the only evidence for a row that appears
 *                  on every card, and nothing in the gate's source backs it.
 */
export function wholeTreePopulationRefusal(entry) {
  const reason = entry?.wholeTreeReason ?? null;
  if (!reason) return null;
  // The THIRD marker (#15341) reaches this refusal for the same reason the
  // second does: a gate declares exactly ONE population shape, and these two
  // carry opposite dispositions — a whole-tree family's command is inside every
  // card's runnable total, a wide-population family's is inside none. Named
  // from BOTH sides (`widePopulationRefusal` states the mirror), so whichever
  // channel a reader arrives through, the pair is refused rather than resolved.
  if (entry?.widePopulationReason) {
    return 'declares BOTH whole-tree-population and wide-population — a gate declares exactly ONE population shape, and '
      + 'these two place it in opposite columns: whole-tree is owed by every card, wide-population by none. Delete the '
      + 'one that is not true; a derivation that picked either would be placing the family by a coin toss.';
  }
  if (entry?.noPopulationReason) {
    return 'declares BOTH whole-tree-population and no-path-population — "my population is every file" and "my population '
      + 'is no file" cannot both be true of one gate. Delete the one that is not true; a derivation that picked either '
      + 'would be placing the family by a coin toss.';
  }
  // The reason's WHOLENESS (#18422), graded before the walk below: both of the
  // checks under this one read a reason this one may be telling us is only the
  // first LINE of, and a refusal that named the walk while the reason was cut
  // would send the author to the wrong half of their declaration.
  const cut = populationReasonCutRefusal(entry, 'whole-tree-population');
  if (cut) return cut;
  if (!entry?.rootWalk) {
    return 'declares whole-tree-population and its own source carries no recognised repo-root walk. Recognised spellings: '
      + `${REPO_ROOT_WALK_SPELLINGS.map((s) => s.label).join('; ')}. A declaration with no walk behind it puts a row on `
      + 'EVERY card on no evidence. If the walk is real and spelled some other way, EXTEND REPO_ROOT_WALK_SPELLINGS in '
      + 'scripts/pm/dispatch-gates.mjs with a self-test case beside it — never route around this refusal.';
  }
  return null;
}

/**
 * Whether a hint sitting beside a WIDE-population declaration is compatible
 * with it, rather than a competing claim about the population (#16828, found
 * on `check:route-envelope`).
 *
 * The refusal below used to fire on ANY named hint at all, on the theory that
 * a gate claiming "no subtree glob places me" contradicts itself the moment
 * its own source spells one. That is true of a hint that REACHES beyond the
 * one file it names — a bare directory, or a glob — because such a hint is
 * itself an attempt to spell the population, and two competing spellings of
 * one population is exactly the coin toss this file refuses everywhere else.
 * It is NOT true of a hint that reaches nothing but itself: an exact file path
 * ending in a source/doc extension. `hintCovers`'s own plain branch matches
 * such a hint only by EQUALITY — nothing can start with `<file>.ts/` — so
 * admitting one changes nothing the marker claims about the population's
 * WIDTH; it only records that one member of it happens to already be on
 * record (`check:route-envelope`'s `MODULES` table, keyed by exact path, is
 * the specimen: 30-plus such hints, every one a route module the gate already
 * audits, none of them any narrower a claim than "this one file exists").
 *
 * A hint that DOES reach beyond itself is admitted only when the marker's own
 * REASON TEXT names it — the same bar `wholeTreePopulationRefusal` holds a
 * repo-root walk to (a claim with no reason behind it puts a row out on
 * nothing). `check:route-envelope` carries exactly one such hint,
 * `DISPATCHER_DOMAIN_DIR` (`packages/runtime/src/domains`): a directory whose
 * own membership is exhaustively audited by `discoverDomains()` against the
 * separate `DISPATCHER_DOMAINS` table, so it is a second, independently closed
 * surface rather than a rival spelling of the FIRST one the marker is about.
 * Naming it in the reason is what lets a reader tell the two apart instead of
 * being asked to trust a silent exemption.
 *
 * A glob is never exempt this way, named or not: `judgedAsPattern` reports a
 * hint that is ITSELF a population spelling — reason text that repeats it
 * back is not an account of it, it is the same contradiction typed twice.
 */
function widePopulationHintCompatible(hint, reason) {
  if (judgedAsPattern(hint)) return false;
  if (/\.[A-Za-z0-9]{1,6}$/.test(hint)) return true;
  return reason.includes(hint);
}

/**
 * Why this family's WIDE-population declaration must be refused, or null when
 * it stands. Pure, and reading only what the discovery already put on the
 * entry — the same contract `wholeTreePopulationRefusal` above states, and for
 * the same reason: the live half of the self-test and any future caller cannot
 * be allowed to disagree about what a bad declaration is.
 *
 * Three refusals, and every one of them is a gate claiming TWO population
 * shapes at once. A gate declares exactly one:
 *
 *   BOTH markers   with `no-path-population`: "a population too wide to place"
 *                  and "no population at all" are not both true of one gate.
 *                  With `whole-tree-population`: a gate that reads EVERY file
 *                  is placed by declaration and its command is owed by every
 *                  card — the opposite disposition from this one — so the pair
 *                  would place the family by whichever branch was read first.
 *   NAMES PATHS    the declaration says no subtree glob places this gate, and
 *                  the gate's own source spells one anyway — a hint
 *                  `widePopulationHintCompatible` above does not clear. One of
 *                  the two is wrong and the derivation cannot tell which: the
 *                  marker's whole content is the sentence a reader trusts, so
 *                  a marker sitting above an unaccounted-for population is the
 *                  rot direction that costs — the reader is told "nothing
 *                  here can be narrowed" while the matched column narrows it.
 *                  ⚠️ This is deliberately NOT "does the gate name any path at
 *                  all" (#16828): an enumerated exact-file member, or a
 *                  subtree the reason itself names, is not that contradiction
 *                  — see `widePopulationHintCompatible`'s own docblock.
 */
export function widePopulationRefusal(entry) {
  const reason = entry?.widePopulationReason ?? null;
  if (!reason) return null;
  if (entry?.noPopulationReason) {
    return 'declares BOTH wide-population and no-path-population — "my population is too wide to place" and "my population '
      + 'is no file" cannot both be true of one gate. Delete the one that is not true; a derivation that picked either '
      + 'would be placing the family by a coin toss.';
  }
  if (entry?.wholeTreeReason) {
    return 'declares BOTH wide-population and whole-tree-population — a gate declares exactly ONE population shape, and '
      + 'these two carry OPPOSITE dispositions: a whole-tree family is owed by every card and its command is inside every '
      + "card's runnable total, a wide-population one is owed by CI and is in no card's. Delete the one that is not true.";
  }
  // The reason's WHOLENESS (#18422), graded before the hint check below —
  // which reads the reason TEXT to decide whether a hint is accounted for. A
  // hint named in the wrapped half of a cut reason would read as unaccounted
  // for, and this refusal would name the wrong defect in confident words.
  const cut = populationReasonCutRefusal(entry, 'wide-population');
  if (cut) return cut;
  const uncovered = (entry?.hints ?? []).filter((h) => !widePopulationHintCompatible(h, reason));
  if (uncovered.length > 0) {
    return 'declares wide-population and its own source NAMES paths that reach beyond the single file each one names: '
      + `${uncovered.slice(0, 4).join(', ')}${uncovered.length > 4 ? ', …' : ''}. `
      + 'The declaration says no subtree glob places this gate and the gate spells one it does not account for, so one of '
      + 'the two is wrong and nothing here can tell which. If the literal is the real population, delete the marker and '
      + 'let the matched column do its job; if it is a second, separately audited surface, name it in the reason text; '
      + 'if it is an artifact rather than a population, it does not belong in a scanned position.';
  }
  return null;
}

// `ROOT_WALK_RESIDUE_LEDGER` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

/** The ledger as a Map, keyed by the family key this derivation places. */
export const ROOT_WALK_RESIDUE_REASONS = new Map(ROOT_WALK_RESIDUE_LEDGER);

/**
 * Why this family is an unnamed repo-root walker, or null when it is not one.
 *
 * Pure, and reading only what discovery already put on the entry plus the
 * placement this derivation gave it — the same contract
 * `wholeTreePopulationRefusal` above states, and for the same reason: the live
 * sweep in `--self-test` and any future caller must not be able to disagree
 * about what a member of this population IS.
 *
 * ⚠️ `placement` is the verdict from `placeFamily` over a probe card that
 * EXCLUDES the gate's own file closure. Passing the raw whole-tree verdict
 * instead returns `matched` for every family in the repo and empties this
 * population silently — which is why the live case builds the probe rather than
 * taking a convenient shortcut, and why this parameter is a verdict and not a
 * path list (a caller cannot get the subtraction wrong in a way this function
 * would then hide).
 */
export function unnamedRootWalk(entry, placement) {
  if (!entry?.rootWalk) return null;
  // All THREE declarations leave this population, and for one reason rather
  // than three: this table holds the families nobody has looked at, and a
  // family carrying any of the markers has been looked at. `wide-population`
  // (#15341) is the answer for a walker whose population is real, is not the
  // whole tree, and has no subtree spelling — the exact shape a row here would
  // otherwise have to describe in prose nobody re-measures.
  if (entry.wholeTreeReason || entry.noPopulationReason || entry.widePopulationReason) return null;
  if (placement === 'matched') return null;
  return entry.rootWalk;
}

/**
 * A family whose verdict CANNOT EXIST outside a workflow run, read from the
 * gate's own source rather than from a roster of names (#14004).
 *
 * ## The defect
 *
 * `check-governed-queue-guard.mjs` judges the merge-queue event payload and
 * nothing else. Run on a clean tree with nothing wrong in it, its only possible
 * outcome is `EXIT=1` — deliberately, because "could not look" must never exit
 * 0 in a guard (#13885 / #13954, and that refusal is CORRECT: ⛔ this rule does
 * not touch the gate). The derivation nonetheless advertised it among the
 * families under "Local gates for this card (paste into the dispatch prompt)",
 * and `--commands` emitted it on a line whose caption promises a runnable
 * command. Every dev on a `.claude/agents/**` diff — the highest-traffic
 * governed surface in this repo — harvested 10 commands, ran them, and got 9
 * green and 1 structurally red, then went and read the gate source to learn the
 * red meant nothing. The second cost is the one that compounds: a red that
 * always fires trains its reader to discount reds in that list, which is #4690
 * pointed at the reader instead of at the tool.
 *
 * ## Why a SHAPE and not a list of CI-only gate names
 *
 * The same reason nothing else in this file is a list: a hand-maintained roster
 * does a per-family job and drifts the day a family is added, and this file's
 * whole contract is that a gate added tomorrow classifies itself. Triage leaned
 * this way and left the criterion's COST to be measured here; measured on
 * fa1eca31d over the 200 discovered families, it is cheap — the discovery
 * already reads every family file once for four other answers, so this is a
 * fifth answer off the same read, with no new I/O at all.
 *
 * ## The criterion is a CONJUNCTION, and the second limb is the safe direction
 *
 *   limb 1  the gate's own source ACCESSES the workflow event payload —
 *           `process.env.GITHUB_EVENT_PATH` / `env['GITHUB_EVENT_PATH']` —
 *           with comments and self-test bodies masked out, so a gate that
 *           merely mentions the variable in prose or stages it in a fixture is
 *           not classified by what it talks about;
 *   limb 2  and NO ONE CAN RUN IT BY NAME here: the family is a direct
 *           workflow `run:` invocation (never a `check:*` npm script, which is
 *           a local invocation by construction) and no root manifest script
 *           names its file.
 *
 * Measured on fa1eca31d, over 200 families: limb 1 alone selects 1, limb 2
 * alone selects 43, the conjunction selects exactly 1 — the queue guard. So
 * limb 2 buys nothing TODAY and is not there for today: this classification
 * SUBTRACTS a row from `--commands`, and a subtraction that fires wrongly is
 * silent (a real gate quietly missing from the runnable list, every dispatch
 * order still reading normal), while a miss is loud (the status quo — a red the
 * dev has to go read a gate to understand). The whole file errs that way, and
 * `declaredInheritedPopulation`'s ruling one screen up is the same trade
 * decided the same direction by the maintainer. A gate with a `check:*` name,
 * or one that reads the payload with a git fallback, therefore keeps its place
 * in the list and keeps its loud red.
 *
 * ⚠️ Deliberately NARROW on the variable, too: `GITHUB_EVENT_PATH` alone, not
 * the whole `GITHUB_EVENT_NAME`/`GITHUB_BASE_REF`/`GITHUB_HEAD_REF`/
 * `GITHUB_REF_NAME` family, because those are routinely read WITH a local
 * fallback while the payload path is the run's input or nothing. The narrowing
 * costs nothing measurable: on this tree exactly one tracked file names any of
 * the five, so widening the set changes zero classifications — it is a
 * statement about tomorrow's gate, not today's count.
 *
 * ⚠️ What this does NOT claim: that the gate refuses. It reads a dependence,
 * not a control-flow proof, and no static reading of a source can promise how a
 * program behaves with an env var absent. That is why the family stays NAMED,
 * with its provenance and this reason printed beside it, in every rendering —
 * an annotation a reader can check against the gate, never a family this tool
 * quietly disappears.
 */
const WORKFLOW_PAYLOAD_ENV = 'GITHUB_EVENT_PATH';

// Assembled from the variable name held above rather than spelled inline, for
// the reason DEFAULT_BASE_REF states one screen down: a module-body literal in
// this file is inherited as a watch hint by anything that follows it, and a
// name with no slash cannot become one. The access forms are the two JS
// spellings of one read — dotted and bracketed, through `process.env` or
// through a local `env` alias, which is how the live specimen spells it.
const PAYLOAD_ENV_ACCESS = new RegExp(
  String.raw`(?:process\s*\.\s*env|(?<![\w$.])env)\s*` +
    String.raw`(?:\.\s*${WORKFLOW_PAYLOAD_ENV}\b|\[\s*(['"\`])${WORKFLOW_PAYLOAD_ENV}\1\s*\])`,
);

/**
 * limb 1 — the gate's own source, comments and self-test bodies masked, ACCESSES
 * the workflow event payload. Returns the variable name, or null.
 *
 * The masking is the same normalization `extractWatchHints` applies, and for
 * the same reason: what a gate SAYS is not what it READS. It costs nothing on
 * this tree (one file names the variable, and it also accesses it), and it is
 * the difference between classifying a gate and classifying its docblock.
 */
export function payloadEnvDependence(scriptSource) {
  const body = maskedModuleBody(String(scriptSource));
  return PAYLOAD_ENV_ACCESS.test(body) ? WORKFLOW_PAYLOAD_ENV : null;
}

/**
 * Both limbs, against one discovered family. Returns `{ env }` for a CI-measured
 * family and null for every other, which is the answer every rendering keys on.
 *
 * `rootScripts` is passed IN, from the manifest `discoverFamilies` has already
 * read, so this cannot answer from a different revision of the file than the
 * discovery that calls it.
 */
export function ciOnlyMeasurement(entry, rootScripts = {}) {
  const env = entry?.payloadEnv ?? null;
  if (!env) return null;
  // A `--self-test` invocation is never CI-measured-only, and the argument is
  // the invocation-shaped one `discoverFamilies` already makes about the import
  // follow (#14880). `payloadEnvDependence` reads the gate's module body with
  // self-test bodies MASKED OUT, so the payload access it finds belongs to the
  // script's WORK — the invocation this one is not. Suppressing the self-test
  // entry from `--commands` on the strength of a read its run never performs
  // would hide a command a dev CAN run, which is the direction this whole file
  // refuses. Costs nothing on the tree today: all twelve self-test families
  // score `payloadEnv` null and never reach this line; it is the split key
  // above that first lets a payload-reading gate have a self-test entry at all.
  if (entry.selfTest) return null;
  // A `check:*` family is invocable by name by construction — limb 2 fails
  // before the manifest is consulted at all.
  if (!entry.direct) return null;
  const files = entry.files ?? [];
  const namedByManifest = Object.values(rootScripts).some(
    (command) => typeof command === 'string' && files.some((f) => f && command.includes(f)),
  );
  if (namedByManifest) return null;
  return { env };
}

/**
 * The values a family takes from the workflow through its step's `env:` — the
 * THIRD carrier, and the generalisation of #14004 rather than a second special
 * case of it (#15761).
 *
 * ## The defect
 *
 * `.github/workflows/partof-closing-keyword-guard.yml` passes the pull request
 * to `node scripts/check-partof-closing-keyword.mjs` through
 * `env: PR_BODY: ${{ … }}` / `PR_NUMBER: ${{ … }}`, and its argv is BARE. The
 * argv-shaped classifier one screen up therefore saw a command with no
 * variable in it and put it in `--commands`, under a caption that promises a
 * runnable command — while the gate's own refusal says the opposite in its own
 * words: "NOT WIRED — neither PR_BODY nor PR_NUMBER is set, so this run was
 * handed no pull request and judged nothing. This is a wiring or usage
 * failure, NOT a verdict". A dev harvesting the family runs a command whose
 * only possible outcome outside CI is exit 2.
 *
 * ⛔ The fix REFUSED: moving `PR_BODY` into the argv so the existing detector
 * sees it. That `env:` spelling is a security decision the workflow states at
 * length ("An expression interpolated into a shell line is substituted before
 * bash ever sees it, so a PR body is arbitrary attacker-controlled text
 * landing in a command; through `env:` it is inert data"), and reopening a
 * deliberately closed injection surface to fix a DISPLAY bug trades the two
 * the wrong way round. The repair is on the reader's side, which is where this
 * one is.
 *
 * ## What it selects, measured rather than argued
 *
 * On this tree: 405 `run:` steps, 52 carrying an `env:` expression, 13 of
 * those invoking a check. Eight spell every env name in the command itself and
 * are filtered out before this function sees them (`envNamesNotSpelledInCommand`,
 * which is what keeps #15441's three repaired `--base` families runnable). Of
 * the five that reach the limbs below, the conjunction selects THREE — every
 * one of which was verified by running it here, and every one of which refuses
 * rather than judges:
 *
 *   `check-partof-closing-keyword.mjs`            exit 2, "NOT WIRED"
 *   `check-single-claim-paths.mjs`                exit 2, "NOT WIRED — PR_NUMBER is not set"
 *   `check-required-contexts.mjs --verify-required-set`
 *                                                 exit 2, "NOT VERIFIED — … HTTP 401"
 *
 * so the class this card names is three families wide, not one. A fourth,
 * `check-half-states.mjs --format=markdown --provenance="$PROVENANCE"`, is
 * already NOT MEASURED through its argv and only gains the two env names it
 * also carries.
 *
 * ## The limbs, each with a live case on this tree
 *
 *   selfTest  a `--self-test` invocation runs the script's own fixtures and
 *             consumes no workflow value, exactly the argument `ciOnlyMeasurement`
 *             makes one screen up. LIVE: `render-release-coverage-anchor.mjs
 *             --self-test` sits in a step carrying three `${{ … }}` env values,
 *             and it is runnable here — this limb is what keeps it in the list.
 *   direct    a `check:*` family is invocable by name by construction (#14004's
 *             limb 2), and its KEY drops the argv, so one key is produced by
 *             steps in different environments and the env of one of them is not
 *             a property of the key. LIVE: `check:console-injection`, run by
 *             `ci.yml` and `release.yml` under `CONSOLE_DIST_CACHE_KEY` and by
 *             the root manifest under nothing.
 *   ciOnly    the family is ALREADY named in the CI-measured bucket, and one
 *             family printed as two omissions tells a reader it owes two runs.
 *             LIVE: `check-governed-queue-guard.mjs`, whose step also passes
 *             `GITHUB_TOKEN: ${{ … }}` — #14004's own specimen.
 *
 * and one limb that is per NAME rather than per family (#20278):
 *
 *   localEnv  the script's own `local-env` declaration names values its BARE
 *             invocation does not need (`declaredLocalEnv`, graded by
 *             `localEnvRefusal`, scoped by `localEnvAdmitted`). Only the
 *             declared names leave the list, so a name the script did not
 *             declare still keeps the family out. LIVE:
 *             `check-issue-citations.mjs`, whose `lint.yml` step passes
 *             `GITHUB_TOKEN` and `OS_GATE_MERGE_GROUP_BASE_SHA` and whose own
 *             declaration says the pull-request run needs neither — while its
 *             `--census` sibling, which declares nothing, keeps `GITHUB_TOKEN`.
 *
 * ⚠️ What this does NOT claim, and it is `payloadEnvDependence`'s caveat
 * unchanged: that the gate READS the variable. It reads what the WORKFLOW
 * passes, not what the program consumes, so the family stays NAMED with its
 * variables printed beside it in every rendering — an annotation a reader can
 * check against the gate, never a family this tool quietly disappears.
 */
export function workflowEnvValues(entry) {
  const names = entry?.envVariables ?? [];
  if (names.length === 0) return [];
  if (entry.selfTest) return [];
  if (!entry.direct) return [];
  if (entry.ciOnly) return [];
  const admitted = localEnvAdmitted(entry);
  return names.filter((name) => !admitted.includes(name));
}

/**
 * A FOLLOWED MODULE's own declaration of which of its module-body literals are
 * a population a gate INHERITS by importing it — a whole-line comment anywhere
 * in the module's source:
 *
 *   // dispatch-gates: inherited-population <path> [<path> ...] -- <reason>
 *   #  dispatch-gates: inherited-population <path> [<path> ...] -- <reason>
 *
 * ## What it is for (#11556)
 *
 * `firstPartyImportTargets` opens a gate's first-party imports and appends the
 * imported module's hints to the gate's own, because a population MOVED out of
 * a gate and into a shared module must not stop being declared. That is right
 * for a module whose literals ARE a population. It is wrong for a module whose
 * literals are join bases it builds paths from, or a declaration table it
 * exports for some other purpose: the importer never opens those trees, so
 * every pair they contribute is a fabricated lead in the column a dispatch
 * prompt pastes.
 *
 * The follow already refuses one case of this — a module that is itself a
 * discovered gate file (firstPartyImportTargets' docblock carries the +4014
 * measurement that decided it). That refusal keys on a property the derivation
 * can SEE. This marker is for the case it cannot see: an ordinary module,
 * followable by construction, whose author knows which of its literals a caller
 * would be reading and which it would not.
 *
 * ## What this marker cannot reach, and what does (#17991)
 *
 * It is keyed on the MODULE, while whether a contribution is fabricated is a
 * property of the CALLER — and a module can be both at once. This file's own
 * globs are a real population for the gate that reads them and a fabrication
 * for a gate that binds one string constant out of the same file; a declaration
 * narrow enough for the second blinds the first, and one wide enough for the
 * first fabricates for the second. ⛔ One declaration cannot be both.
 *
 * The half that reaches the caller is `importBindsNoPopulation`, keyed on what
 * the importer BINDS: a value constant carries no behaviour and no table, so it
 * reaches none of the module's reads however the module is written. ⛔ It is
 * deliberately NOT a second marker on the importer — a per-caller opt-out is
 * the hand-written path map this contract refuses, rewritten one caller at a
 * time — and it narrows nothing for a table importer, so this marker's ruling
 * for them stands unchanged.
 *
 * ## Why a marker IN the module, never a roster in this script
 *
 * Same reason as the two markers above: a roster here is a second copy of a
 * fact that belongs on the thing it describes, and it rots silently — the
 * module grows a real population, or is renamed, and the roster keeps vouching
 * for it. It is also the exact failure this card was filed against: the guard
 * that existed was prose in one CALLER, so it protected that caller and no
 * other. A declaration the module carries protects every caller, including the
 * one written next year.
 *
 * ## Narrowing only — a declaration can never INVENT a population
 *
 * Every declared path must be one the module's own source really spells: the
 * declaration is checked against `extractWatchHints` of that same source and
 * REFUSES (throws) on a path that is not there. So the marker can only ever
 * remove leads a caller would otherwise inherit, never add one — an opt-out
 * that could also opt IN would be a hand-written path map, which is the drift
 * this file's whole contract refuses. A marker carrying no path at all does not
 * parse as a declaration — it reads as no marker, so the module keeps
 * contributing everything it spells. That is the safe direction: a blanket
 * "inherit nothing" reads identically to a placeholder nobody will revisit, and
 * a module with no literals needs no marker to contribute none.
 *
 * The reason is REQUIRED, and separated from the path list by a SPACE-delimited
 * `--`: a bare `--` would split a path that legitimately contains one.
 *
 * ## The reason half is WHOLE, or the declaration is REFUSED (#18662)
 *
 * The path list above is this marker's own grammar and is unchanged. Its
 * REASON captured with the same `(\S.*)$`-under-`m` shape #18422 repaired for
 * the three population markers, so a reason wrapped onto the comment line
 * below was read as line ONE and nothing sounded — measured on `origin/main`
 * 034f5a3afd before this change. The read is now graded by the shared
 * wholeness reading and a continued reason THROWS, naming the module, the
 * line, the marker and the text that continues it, exactly as an invented path
 * already did.
 *
 * ⚠️ Nothing in this tool RENDERS this reason (measured, #18662): every
 * production call site reads `.population` alone. The refusal is owed anyway —
 * wholeness is a property of the declaration, and the next reader of the
 * reason is the seat that greps the module for it — and this sentence is that
 * cost stated rather than left to be discovered.
 *
 * Returns `{ population, reason }`, or null when the module declares nothing.
 */
export const INHERITED_POPULATION_MARKER = pathListMarkerPattern('inherited-population');

export function declaredInheritedPopulation(moduleSource, hints = null, file = null) {
  const source = String(moduleSource);
  // ONE read, both halves (#18662): the path list AND the wholeness of the
  // reason come off the same match, so a refusal can never grade the reason of
  // one declaration against the path list of another. The reason half is the
  // #18422 reading this marker sat outside of until that card.
  const read = readPopulationMarker(source, 'inherited-population');
  if (!read) return null;
  refuseCutMarkerReason(read, 'inherited-population', file);
  const m = read.match;
  // The path list is non-empty by construction: the marker pattern requires a
  // non-space before the ` -- `, so a marker carrying only a reason does not
  // parse as a declaration at all — it reads as no marker, which is the safe
  // direction (inherit everything) rather than a silent blanket opt-out.
  const population = m[2].trim().split(/[ \t]+/).filter(Boolean);
  const reason = read.reason;
  const spelled = new Set(hints ?? extractWatchHints(source));
  const invented = population.filter((h) => !spelled.has(h));
  if (invented.length > 0) {
    throw new Error(
      `dispatch-gates: inherited-population declares ${invented.length} path(s) this module does not spell: ` +
        `${invented.join(', ')} — the declaration may only NARROW what a caller inherits, never invent it`,
    );
  }
  return { population, reason };
}

/**
 * A GATE SCRIPT's own declaration of the tracked files its SELF-TEST opens —
 * a whole-line comment anywhere in the script's source:
 *
 *   // dispatch-gates: self-test-reads <path> [<path> ...] -- <reason>
 *   #  dispatch-gates: self-test-reads <path> [<path> ...] -- <reason>   (shell gates)
 *
 * ## The defect this exists for (#18673)
 *
 * `maskSelfTests` blanks every self-test body before `extractWatchHints` runs,
 * and that masking is correct for the reason its docblock measures: a
 * self-test is made of FIXTURE paths, and admitting them printed a gate in the
 * MATCHED column for most of the tree. But a self-test case can also assert a
 * STRUCTURAL fact about a real, tracked file — `check-expected-skips.mjs`
 * asserts that the enqueue bar in `.claude/skills/pm-dispatch/SKILL.md` still
 * names it — and that read is not a fixture: it is a population claim on a file
 * a card can edit. The mask cannot tell the two apart from the bytes, so the
 * claim was dropped with the fixtures.
 *
 * What it cost, measured: a PR re-keying that SKILL.md derived its gate list
 * with this tool, got 19 families, ran all 19 to exit 0 and reconciled with
 * `--ran` at 「0 NOT-MEASURED」 — and `Lint & Repo Gates` went red on
 * `check:pm-expected-skips`, the twentieth. ⭐ A list that reconciles against
 * itself is more dangerous than no list: the reconciliation's zero is a
 * statement about the DERIVED set, so a family outside that set is invisible to
 * it by construction, and the seat that did every prescribed step was told it
 * had done them all.
 *
 * ## Why a DECLARATION and not a widening of the read scan
 *
 * `anchoredReadTargets` already resolves this read — it scans unmasked source,
 * so the self-test's `readFileSync(join(ROOT, '.claude/…/SKILL.md'))` comes
 * back from it today. What drops it is `readProgramTargetsInSource`'s boundary:
 * a followed read must be PROGRAM TEXT, because a gate that parses a data file
 * it found by walking a tree would otherwise contribute every fixture it ever
 * touched. Dropping that boundary re-admits the fixture class the mask exists
 * to refuse. A declaration is decidable where a widening is a guess, and it
 * puts the fact on the file it describes — the same argument the three
 * population markers and `inherited-population` are built on.
 *
 * ## ADMITTING only, and never INVENTING — the mirror of inherited-population
 *
 * Every declared path must be one this script really OPENS at an anchored path:
 * the declaration is checked against `anchoredReadTargets` of that same source
 * and REFUSES (throws) on a path that is not there. So the marker can only ever
 * re-admit a read the scan already sees and the boundary above dropped, never
 * add a lead the source does not support — and a declaration whose read is
 * DELETED stops parsing and reddens every run of this tool, which is what makes
 * the pin on this class unsatisfiable by deleting the read.
 *
 * The reason is REQUIRED, and separated from the path list by a SPACE-delimited
 * `--`, exactly as `inherited-population` spells it.
 *
 * ## Measured at the landing, both directions
 *
 * For a change set holding `.claude/skills/pm-dispatch/SKILL.md` alone, the
 * derived command list goes 18 -> 19 and the new member is
 * `pnpm check:pm-expected-skips`, keyed `declared self-test read by
 * scripts/pm/check-expected-skips.mjs`. Replayed against the run record the
 * defect produced — the 18 commands, each with an exit code — `--ran` stops
 * saying 「0 NOT-MEASURED, 0 UNRUN」 and says `1 of 19 derived famil(ies) UNRUN
 * — pnpm check:pm-expected-skips [absent from the run record]`. Ablated on disk
 * from the committed fix by deleting the declaration line, the derivation falls
 * back to 18 without that family and this file's self-test fails 5 of 1788
 * cases: the specimen, the census's declared half, the flag pin, the
 * class-wide derived pin, and the declared-data-read hole beside the
 * program-text refusal. Nothing else moves.
 *
 * @param {string} scriptSource  the script's contents
 * @param {string[]} readTargets  what `anchoredReadTargets` resolved from it
 * @param {string|null} file  what the caller knows the source by, named by the
 *   cut refusal (#18662) so a reader can navigate to the continuation
 * @returns {{ population: string[], reason: string } | null}
 */
export function declaredSelfTestReads(scriptSource, readTargets, file = null) {
  const source = String(scriptSource);
  // ONE read, both halves — see `declaredInheritedPopulation` (#18662). The
  // wholeness reading reaches this marker by construction: both path-list keys
  // come out of one grammar, so neither can carry a cut reason the other
  // refuses.
  const read = readPopulationMarker(source, 'self-test-reads');
  if (!read) return null;
  // ⛔ NOT an optional argument with a permissive default. The whole contract of
  // this marker is that it cannot invent, and a caller that supplies no read set
  // would be handed a declaration nothing can refuse — a silent opt-in, which is
  // the one shape every marker in this file is written to avoid.
  if (!Array.isArray(readTargets)) {
    throw new Error(
      'dispatch-gates: self-test-reads is graded against the reads the source really performs — '
        + 'the caller must supply them (anchoredReadTargets of the same source text). '
        + 'A declaration read with no read set is a declaration nothing can refuse.',
    );
  }
  refuseCutMarkerReason(read, 'self-test-reads', file);
  const population = read.match[2].trim().split(/[ \t]+/).filter(Boolean);
  const reason = read.reason;
  const performed = new Set(readTargets);
  const invented = population.filter((p) => !performed.has(p));
  if (invented.length > 0) {
    throw new Error(
      `dispatch-gates: self-test-reads declares ${invented.length} path(s) this script does not open at an anchored path: `
        + `${invented.join(', ')} — the declaration may only ADMIT a read the source really performs, never invent one. `
        + 'Deleting the read does not satisfy the declaration; it breaks it.',
    );
  }
  return { population, reason };
}

/**
 * A GATE SCRIPT's own declaration that its BARE invocation answers CI's
 * question here WITHOUT some of the values its workflow step passes through
 * `env:` — a whole-line comment anywhere in the script's source (#20278):
 *
 *   // dispatch-gates: local-env <NAME> [<NAME> ...] -- <reason>
 *   #  dispatch-gates: local-env <NAME> [<NAME> ...] -- <reason>   (shell gates)
 *
 * ## The defect this exists for
 *
 * `workflowEnvValues` (#15761) marks a family NOT RUNNABLE LOCALLY when its
 * step hands it a `${{ … }}` value through `env:`, and it reads what the
 * WORKFLOW passes, never what the program needs. For the step that runs
 * `node scripts/check-issue-citations.mjs` — the diff-scoped verdict
 * `Lint & Repo Gates` blocks on — the two answers differ: the step passes
 * `GITHUB_TOKEN` and `OS_GATE_MERGE_GROUP_BASE_SHA`, and the script needs
 * neither to answer the pull-request run's question (the base renders EMPTY on
 * `pull_request`; the token is used when present). So `--commands` offered only
 * the family's `--self-test`, named the verdict NOT MEASURED, and a dev whose
 * sweep reconciled clean took the red on CI instead — measured on #20268's CI
 * run, whose citation the bare command, run here, refuses with the same exit 2.
 *
 * ## Why a declaration read from the SCRIPT, not a rule about the variables
 *
 * Measured before this landed: dropping the job token and the merge-group base
 * from the classification GENERICALLY also admits the same script's `--census`
 * (a report-only enumeration of the whole board that always exits 0) and
 * `check-required-contexts.mjs --verify-required-set` (exit 2 here, through
 * the proxy route) — one right answer bought with two wrong ones. Whether a
 * value is needed is a fact about the PROGRAM and about the MODE, so the
 * program states it, for the reason `declaredArgvDefaults` reads the usage
 * block rather than a table here: a script that stops declaring returns its
 * family to NOT MEASURED on the next run, with no edit in this file.
 *
 * ## What it does NOT do
 *
 *   guess             only a name the declaration spells is admitted; nothing
 *                     is inferred from how the script reads the variable.
 *   admit a name the workflow does not pass
 *                     every declared name must be one EVERY step running the
 *                     bare invocation passes as a workflow value through `env:`
 *                     (`entry.envVariables`, the intersection). A name no step
 *                     passes, one only some steps pass, a literal-valued one and
 *                     one the command spells as argv are all REFUSED by
 *                     `localEnvRefusal`, so a declaration the workflow outgrew
 *                     reds every run of this tool instead of vouching quietly.
 *   admit an argv no workflow runs
 *                     the declaration is scoped to the script's BARE invocation
 *                     — the key that is the script path alone — and a script
 *                     that declares one while no workflow runs that invocation
 *                     is REFUSED the same way.
 *   touch any other invocation of the same script
 *                     `--census`, `--self-test` and every other argv keep the
 *                     classification they had (`localEnvAdmitted` answers []
 *                     for them). An argv-scoped spelling is not built: no
 *                     family has pulled one.
 *   repair an argv value
 *                     a value the command spells is the argv carrier's, and
 *                     `declaredArgvDefaults` is its only repair.
 *
 * The reason is REQUIRED, separated from the name list by a SPACE-delimited
 * `--` exactly as the two path-list markers spell it, and graded WHOLE by the
 * shared reading (#18422): a cut reason throws, naming the file and the line.
 *
 * Returns `{ names, reason, line }`, or null when the script declares nothing.
 */
export function declaredLocalEnv(scriptSource, file = null) {
  const read = readPopulationMarker(String(scriptSource), 'local-env');
  if (!read) return null;
  refuseCutMarkerReason(read, 'local-env', file);
  const names = read.match[2].trim().split(/[ \t]+/).filter(Boolean);
  // The name shape `stepEnvExpressionVariables` reads off a step's `env:` keys,
  // so a declared token can only ever be one that reader could have produced.
  const malformed = names.filter((name) => !/^[A-Za-z_][\w.-]*$/.test(name));
  if (malformed.length > 0) {
    throw new Error(
      `dispatch-gates: ${file ?? 'the declaring script'}:${read.line} declares local-env with `
        + `${malformed.length} token(s) that are not environment variable names: ${malformed.join(', ')} — `
        + 'the list names `env:` keys of the step that runs this script bare, and nothing else.',
    );
  }
  return { names, reason: read.reason, line: read.line };
}

/**
 * Why a `local-env` declaration is REFUSED against the tree's workflows, or
 * null when it holds (#20278) — the two refusals `declaredLocalEnv`'s docblock
 * lists, in one pure reading so the discovery and the self-test cannot
 * disagree about what a stale declaration is.
 *
 * `bareEntry` is the discovery entry keyed on the declaring script's path
 * ALONE — its bare invocation — or null when no workflow runs one. Every entry
 * that reads the declaring file grades the declaration against that same
 * entry, so the census, the self-test alias and the bare run all get one
 * answer, and a declaration whose bare run is gone is refused even when only
 * some OTHER invocation of the script is still wired.
 */
export function localEnvRefusal(declaration, bareEntry, file = null) {
  if (!declaration) return null;
  const script = file ?? 'the declaring script';
  const where = `${script}:${declaration.line}`;
  if (!bareEntry || !bareEntry.direct || bareEntry.selfTest || bareEntry.check !== bareEntry.script) {
    return `${where} declares local-env ${declaration.names.join(' ')} for its BARE invocation, and no workflow `
      + `runs \`node ${script}\` with no argv. The declaration admits nothing there is to run, and left standing it `
      + 'reads as a promise about a run CI never makes. Delete it, or wire the bare invocation it describes.';
  }
  const passed = bareEntry.envVariables ?? [];
  const unpassed = declaration.names.filter((name) => !passed.includes(name));
  if (unpassed.length === 0) return null;
  return `${where} declares local-env ${unpassed.join(', ')}, which the step(s) running \`node ${script}\` do not `
    + `all pass as a workflow value through \`env:\` (every such step passes: ${passed.join(', ') || 'nothing'}). `
    + 'A name no step passes is stale; one only SOME steps pass is not a property of the invocation; a literal '
    + 'value is not a workflow value; and a name the command spells is argv, whose only repair is a usage-block '
    + 'default. Correct the declaration to the names the step really passes — never widen this reading to admit it.';
}

/**
 * The step-`env:` names the classification DROPS for this one invocation, off
 * its script's `local-env` declaration (#20278) — and [] for every key except
 * that script's BARE one, which is the whole of the scope rule.
 */
export function localEnvAdmitted(entry) {
  if (!entry?.direct || !entry.script || entry.check !== entry.script || entry.selfTest) return [];
  return [...(entry.localEnv?.names ?? [])];
}

/**
 * The workflows (by filename) that violate the #9187 coverage invariant:
 *
 *   Every workflow that declares a `paths:` filter either discovers at least
 *   one check family, or carries a `declaredNoCheckFamiliesReason`.
 *
 * ## Why scoped to paths-filtered workflows, not all of them
 *
 * The harm this closes is specific, not general: a `paths:` filter is CI
 * SCHEDULING a job for a SUBSET of PRs, and #9171 taught this tool to read
 * that schedule as a match key. A workflow with no `paths:` filter runs on
 * every PR regardless — it discriminates nothing, so a card touching it
 * derives no MORE from a family than it already would from every other
 * unfiltered job, and `residueLines`' "unfiltered" bucket already surfaces
 * that count honestly rather than as a silent absence. Widening this guard to
 * every workflow would fold that already-accounted-for bucket into a false
 * positive, and would also flag every zero-check workflow that is not a
 * verification job at all (release/publish/nightly-smoke pipelines) — the
 * "22 leads is the same as none" trap one level down. Measured on this tree
 * (#9187): 6 of the 25 workflow files declare a `paths:` filter; 4 of those 6
 * already discover a family, and the remaining 2 (`docs-drift-check.yml`,
 * `scaffold-e2e.yml`) are the whole known blast radius — one fixed by naming
 * its self-test through a `check:` script, one exempted by the marker above.
 */
export function checkFamilyCoverageGaps(workflowEntries) {
  const out = [];
  for (const { file, text } of workflowEntries) {
    if (extractTriggerPaths(text).length === 0) continue;
    if (extractCheckInvocations(text, file).length > 0) continue;
    if (declaredNoCheckFamiliesReason(text, file)) continue;
    out.push(file);
  }
  return out;
}

/**
 * Resolve a `check:x` script name to the TRACKED PATHS of the script files it
 * runs, via a `package.json` `scripts` map. `dir` is the directory that
 * manifest lives in, repo-relative — `''` for the root manifest.
 *
 * ## The extensions, and why the list was wrong (#12107)
 *
 * The alternation used to read `mjs|cjs|js|sh`. A gate whose npm script names a
 * `.ts` / `.mts` / `.cts` file matched nothing, so `entry.files` stayed empty
 * and `discoverFamilies` never opened the source — no watch hints, no
 * first-party import following, no `declaredNoPathPopulation` read, and no
 * entry in `gateFiles`. Such a family scores `undetermined` for every card in
 * the tree, and the output cannot tell that apart from a gate whose author
 * declined to declare a population: in the first case the declaration was
 * never READ, in the second there is none to read. Measured on this tree at
 * the fix: 24 of 167 families resolved to zero files; 23 of them were this
 * defect, all `tsx`-run TypeScript gates.
 *
 * The 24th, `check:app-nav-i18n`, is NOT this defect and is deliberately still
 * zero-file: its root script is `pnpm --filter @objectstack/cli run
 * check:app-nav-i18n`, a composite that names a PACKAGE and a SCRIPT NAME
 * rather than a path. No extension list can reach it — resolving it means
 * following a `pnpm --filter … run …` hop into another manifest, which is a
 * different mechanism and a different card. A fix here that reported zero
 * remaining would have absorbed it by accident.
 *
 * ## Why `dir`, and why the climb prefix is part of the match (#12107, point 1)
 *
 * A package manifest spells its script relative to ITSELF, and one of the 23
 * climbs out of its own package: `packages/client`'s alias is
 * `tsx ../../scripts/check-exported-any-returns.mts …`. The caller used to
 * prepend the package prefix to whatever came back, which is correct for the
 * 22 in-package spellings (`packages/spec` + `scripts/build-docs.ts`) and
 * wrong for the climbing one.
 *
 * ⚠️ It is wrong in a way the card that filed this predicted the shape of but
 * not the mechanism of, and the difference decides the fix. The card expected
 * `packages/client/../../scripts/…` — a path that resolves on disk but is not
 * a tracked-path spelling. That is not what happens: the pattern was anchored
 * on the literal `scripts/`, so the match SILENTLY DROPPED the `../../` and
 * produced the bare `scripts/check-exported-any-returns.mts`, leaving `join`
 * nothing to normalise. Prepending the package prefix then yields
 * `packages/client/scripts/check-exported-any-returns.mts`, which does not
 * exist. Measured with the extension list widened and this normalisation NOT
 * yet in place: the family leaves the zero-file set and stops scoring
 * `undetermined`, while `existsSync` still refuses the file so it reads
 * **zero hints** — the card's own trigger gate, still silent, now silent
 * behind a confident phantom identity key instead of an honest bucket. That
 * is a strictly worse output than the bug being fixed, so the climb prefix is
 * matched here and normalised through `join` against the manifest's own
 * directory.
 *
 * A spelling that climbs clear of the repo root is dropped rather than
 * returned: `join` cannot normalise it into a tracked path, and a lead no
 * `hintCovers` can ever match is the fabricated-lead direction this file
 * refuses everywhere.
 *
 * ## Why the extension needs a right-hand boundary, and why that is part of
 * ## this widening rather than a tidy-up beside it
 *
 * The alternation was never anchored on its right, so an extension that is a
 * PREFIX of a longer one matched as itself and the rest of the word was
 * dropped. That was already live before this change — a `scripts/**.json`
 * argument matched as `…/pins.js` through the `js` branch — but admitting `ts`
 * adds the common one: `scripts/render.tsx` would match as
 * `scripts/render.ts`. Both produce the same output, and it is the worst one
 * this function has: a gate file that does not exist, which `existsSync` then
 * refuses to open, so the family carries an identity key `coveringKey` prints
 * as a `gate script` match over a file nothing ever read. That is the same
 * phantom the package-relative case above produces, reached by a second route,
 * so it is closed in the same edit and pinned by the same live assertion
 * ("every gate file the derivation names exists on disk").
 *
 * Measured: adding the boundary changes nothing on this tree — no live command
 * names a `scripts/…` argument whose extension merely starts with one of these
 * — so it costs zero recall today and closes the class before the first `.tsx`
 * or `.json` argument arrives.
 *
 * ## What it costs, measured in BOTH directions (the deliverable, not the code)
 *
 * This is a WIDENING, and this file prices widenings by measurement rather
 * than by argument — `firstPartyImportTargets`' docblock above is the standard
 * this section is written to. Over 167 discovered families x 6763 tracked
 * files, at the commit that lands it:
 *
 *   watch-hint (gate, file) pairs   73278 -> 74481   (+1203, and ZERO lost)
 *   zero-file families              24 -> 1
 *   families gaining coverage       19
 *   families losing coverage        0
 *   gate files naming nothing       0 -> 0
 *   existing matches re-attributed  4
 *
 * The +1203 is concentrated in three families that declare real corpora —
 * check:skill-examples (+495), check:docs (+440), check:generated (+234) —
 * with check:template-manifests (+14) and check:react-blocks (+3) next; the
 * remaining fourteen gain 1 or 2 each, which is the identity match on their
 * own source and, for most of them, nothing more. That distribution is the
 * honest shape of the fix: what these families were missing was mostly the
 * ability to be named AT ALL, not a large population.
 *
 * The 4 re-attributions are the one number that differs from the precedent's
 * (which reports 0), so it is reported rather than rounded: check:liveness,
 * check:empty-state, check:variant-docs and check:strictness-ledger each
 * matched their OWN source file already, through the `paths:` filter of
 * spec-liveness-check.yml, and now match it through identity instead. The via
 * label changes from `CI trigger in spec-liveness-check.yml` to `gate script`;
 * no path enters or leaves any family's matched list. That direction is
 * `coveringKey`'s own declared ordering — identity outranks a trigger because
 * it is the stronger provenance — so these are re-attributions UP, not the
 * silent key churn the precedent was guarding against.
 *
 * ## The SUBTRACTION direction, which is the half an addition count hides
 *
 * Admitting these sources also makes them GATE FILES, and `discoverFamilies`
 * refuses to follow a module that is itself a gate file. Any family that used
 * to inherit a hint from one of the 23 would silently stop — and a lead that
 * stops appearing is indistinguishable from one that was never earned, so
 * nothing in the output would say so.
 *
 *   import-follow edges suppressed  0
 *   inherited hints lost            0
 *
 * Zero, and for a structural reason rather than by luck: `firstPartyImportTargets`
 * admits only relative specifiers that resolve INSIDE the root `scripts/` dir,
 * and 22 of the 23 live under `packages/spec/scripts/`, which no first-party
 * follow can reach. The 23rd, `scripts/check-exported-any-returns.mts`, does
 * live there and is imported by nothing. The live half of the self-test
 * asserts this rather than trusting it, because a future TypeScript gate in
 * the root `scripts/` dir could make it false.
 *
 * The mirror question, asked because it is the one that could FABRICATE:
 * opening 23 files that were never opened also means following their imports
 * one level, which is how a gate inherits a population it does not read. Also
 * measured at 0 new edges. The 22 under `packages/spec/scripts/` are out of
 * reach for the same rule; the root-dir one imports `./check-regen-pending.mjs`
 * and `./invoked-as.mjs`, and BOTH are already discovered gate files, so the
 * pre-existing narrowing refuses them. This change therefore adds nothing to
 * the inheritable-literal surface #11556 records for this module: measured on
 * this tree, `extractWatchHints` over this file yields the same 9 hints
 * covering the same 2642 tracked files before and after.
 *
 * ## What the fix does NOT buy, stated because the number invites the reading
 *
 * `check:exported-any-returns` — the gate this card was filed from — resolves
 * its source now and still contributes no watch hints, because that source
 * declares no path literals and carries no `no-path-population` marker. It
 * scores `undetermined` before and after. The difference is the whole point of
 * the card and none of it is visible in a pair count: before, the declaration
 * was never READ; now it has been read and there is nothing there. The first
 * is a defect in this derivation, the second is a missing declaration on that
 * gate, and only the second can be acted on by its author.
 */
export function resolveCheckToFiles(checkName, scriptsMap, { dir = '' } = {}) {
  const cmd = scriptsMap[checkName];
  if (!cmd) return [];
  // The conventional script shape names its file twice (`--self-test && run`) —
  // dedupe, and dedupe on the NORMALISED path so two spellings of one file
  // (`scripts/x.mts` from the root, `../../scripts/x.mts` from a package)
  // cannot both be returned.
  const out = new Set();
  for (const m of cmd.matchAll(/((?:\.\.\/)*scripts\/[\w./-]+\.(?:mjs|cjs|js|sh|ts|mts|cts))(?![\w-])/g)) {
    const tracked = nodePath.join(dir, m[1]);
    // Climbed clear of the repo root: unnameable as a tracked path, so it is
    // not a lead at all.
    if (tracked === '..' || tracked.startsWith('../')) continue;
    out.add(tracked);
  }
  return [...out];
}

/**
 * The comment/literal scanner used to live here. It now lives in
 * `scripts/js-comment-mask.mjs`, because five source-scanning GATES needed the
 * same judgment and each had grown a private copy that got it wrong in one of
 * two silent ways -- see that module's header for the two failure families and
 * the shapes its self-test pins.
 *
 * ## Why comments must not contribute hints (the reason it was written here)
 *
 * A gate's header discusses the tree at length, and the hint scan accepts
 * backticks, so every backticked path in a header used to be read as a path the
 * gate operates on. Measured, and self-inflicted: the first draft of
 * `scripts/pm/check-dispatch-gates.mjs` explained this very pollution with each
 * path in backticks, and that header alone produced ten hints -- reproducing,
 * from the file documenting the problem, the exact false MATCHED leads it was
 * written to avoid. It ships today with its paths deliberately unquoted, a
 * workaround `maskComments` retires: naming a path is not reading it.
 *
 * Re-exported because this tool's self-test drives the SAME masker the gates
 * run, not a copy of it.
 */
export { maskComments };

/**
 * A top-level self-test function DECLARATION. The anchor is structural, not a
 * comment convention: `function selfTest() {` at column 0, optionally `export`
 * and/or `async`, with any name that spells self-test (`selfTest`,
 * `fixtureSelfTest`, `selfTestReadSeams`, `prePushIsArmedSelfTest`,
 * `decisionTableSelfTest` — four of the 18 compound names this tree uses).
 *
 * Re-derived at 6193e576d across the 169 scripts under `scripts/` that carry
 * one — 185 declarations: 111 `function selfTest(`, 28
 * `export function selfTest(`, 19 `async function selfTest(`, 8
 * `export async function selfTest(`, and 19 compound names. The load-bearing
 * half holds: 185 of 185 at column 0, and a column-0 scan for the const/arrow
 * spelling finds ZERO.
 *
 * ⚠ A name is not a role, so this anchor also fires on production code whose
 * name merely spells self-test — `maskSelfTests` six hundred lines below is one,
 * which is why this file's masker blanks its own body whenever it scans itself.
 * ⛔ That is NOT one specimen: it is a class with seven live members over four
 * files, and this docblock claimed it was one until a census counted them. The
 * census, what each member costs, why this pattern is deliberately NOT narrowed
 * to exclude them, and the live pin that keeps their cost at zero all live at
 * `COMPOUND_ANCHOR_LEDGER`. Read that table before touching this pattern; the
 * short version is that one spelling, `runSelfTest`, is a genuine entry point in
 * one script and production code in another, so no name predicate can separate
 * the two classes and narrowing this anchor can only trade a silence that costs
 * nothing for a fabricated lead that does.
 * ⚠ The counts in this paragraph read 61/53/7/4 when it was written and had
 * gone stale by a factor of three before anyone re-read them — re-derive them
 * rather than quoting them; only the two PROPERTIES are what this pattern
 * rests on. If a script ever spells one as
 * `const selfTest = () => {`, widen this pattern rather than reaching for a
 * comment marker; a declaration is a thing the language guarantees, a marker
 * comment is a thing an author has to remember.
 */
const SELF_TEST_DECL =
  /^(?:export[ \t]+)?(?:async[ \t]+)?function[ \t]+[A-Za-z0-9_$]*[Ss]elf[_]?[Tt]est[A-Za-z0-9_$]*[ \t]*\(/gm;

/**
 * Every TOP-LEVEL declaration in a module body: `export`ness, name, span, and
 * whether it is CALLABLE (a `function`/`class`, whose body runs only when
 * something calls it) or a VALUE (`const`/`let`/`var`, evaluated at module
 * load). Anchored at column 0 for the same structural reason the self-test
 * anchor above is, and measured on the same corpus.
 *
 * Destructuring binders (`const { a } = x`) are deliberately unmatched: the
 * declaration below is only ever used to decide what NOT to read, so a binder
 * this pattern cannot name stays in the module body, which is the direction
 * that masks LESS.
 */
const TOP_LEVEL_DECL =
  /^(export[ \t]+)?(?:(?:default[ \t]+)?(?:async[ \t]+)?function[ \t]*\*?[ \t]*([A-Za-z_$][\w$]*)[ \t]*\(|(?:default[ \t]+)?class[ \t]+([A-Za-z_$][\w$]*)[\s{]|(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=)/gm;

/** One JavaScript identifier. Read as a REFERENCE, wherever it stands. */
const IDENTIFIER_TOKEN = /[A-Za-z_$][\w$]*/g;

/**
 * The end of a brace-balanced body, or -1 if the braces never close.
 *
 * `skipParams` walks the parameter list first, and it is not a refinement: a
 * destructured default puts braces in the SIGNATURE, and counting those closes
 * the body before it opens. `release-rehearsal-clone.mjs` writes two of them
 * among its fixture builders — and, the half this docblock asserted backwards
 * once, THREE self-test ENTRY POINTS in the `scripts/` tree carry one TODAY, so
 * this repairs live files rather than guarding against a future spelling:
 *
 *   `scripts/check-test-completeness.mjs#selfTest`
 *   `scripts/measure-position-name-fold-census.mjs#selfTest`
 *       both `function selfTest({ quiet = false } = {})`
 *   `scripts/workspace-enumerator.mjs#selfTest`
 *       `export function selfTest({ root = null } = {})`
 *
 * Measured at 6193e576d — bytes `maskSelfTests` changes in each file, this
 * module against a staged copy of the one on `origin/main`: 30 -> 14848,
 * 30 -> 3961, 34 -> 6294. Thirty bytes is the destructured parameter and
 * nothing else; the entire self-test body was surviving the mask. The control
 * that makes those three a reading rather than an artifact is a self-test with
 * no brace in its signature, identical both ways —
 * `check-empty-changeset.mjs`, 48044 -> 48044.
 *
 * It did not move the hint census, and that is LUCK rather than design: those
 * three bodies happen to carry no path literal their module bodies do not
 * already carry, so `extractWatchHints` returns the same set on both sides
 * (`[]`, `[]`, and the same 8 hints). A fourth file with the same signature
 * shape and one fixture path in it would have been a live fabricated lead.
 */
function bracedBodyEnd(source, scan, start, skipParams) {
  let i = start;
  if (skipParams) {
    let parens = 0;
    let openedParen = false;
    for (; i < source.length; i++) {
      if (scan.comment[i] || scan.literal[i]) continue;
      if (source[i] === '(') {
        parens++;
        openedParen = true;
      } else if (source[i] === ')') {
        parens--;
        if (openedParen && parens === 0) {
          i++;
          break;
        }
      }
    }
    if (!openedParen) return -1;
  }
  let depth = 0;
  let opened = false;
  for (; i < source.length; i++) {
    if (scan.comment[i] || scan.literal[i]) continue;
    if (source[i] === '{') {
      depth++;
      opened = true;
    } else if (source[i] === '}') {
      depth--;
      if (opened && depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The end of a value declaration — the first `;` at bracket depth 0 — or -1
 * when the statement has none (ASI). Braces, brackets and parens are counted
 * over CODE positions only, so a `;` inside a fixture string or a regex cannot
 * end the statement early.
 */
function valueDeclEnd(source, scan, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (scan.comment[i] || scan.literal[i]) continue;
    const c = source[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return i + 1;
  }
  return -1;
}

/**
 * The module's top-level declarations, in source order and non-overlapping.
 *
 * A declaration whose span cannot be closed is DROPPED rather than run to end
 * of file: one unterminated span would otherwise swallow every declaration
 * after it, including the self-test the mask exists to find. Its text stays in
 * the module body — again the direction that masks less. The mask-to-end-of-
 * file behaviour a malformed self-test has always had is kept where it lives,
 * in `maskSelfTests` itself.
 */
function topLevelDecls(source, scan, selfTestStarts) {
  const decls = [];
  let guard = 0;
  for (const m of source.matchAll(TOP_LEVEL_DECL)) {
    const start = m.index;
    if (start < guard) continue;
    if (scan.comment[start] || scan.literal[start]) continue;
    const isFunction = m[2] !== undefined;
    const callable = isFunction || m[3] !== undefined;
    const end = callable ? bracedBodyEnd(source, scan, start, isFunction) : valueDeclEnd(source, scan, start);
    if (end < 0) continue;
    decls.push({
      name: m[2] ?? m[3] ?? m[4],
      start,
      end,
      callable,
      exported: m[1] !== undefined,
      selfTest: selfTestStarts.has(start),
    });
    guard = end;
  }
  return decls;
}

/**
 * The top-level CALLABLES that only the self-test can reach.
 *
 * ## The defect this answers
 *
 * `SELF_TEST_DECL` finds the ENTRY POINT and nothing else. A helper the entry
 * point calls is named for what it builds — `makeSource`, `buildFixtureTree`,
 * `stampFor`, `fixtureCommit` — and no part of that name spells self-test, so
 * its body survived the mask and its fixture literals were read as paths the
 * gate opens. Measured on `scripts/pm/release-rehearsal-clone.mjs`, whose
 * `makeSource` writes a fixture `.changeset` tree: the hint set carried
 * `.changeset/one.md` and `.changeset/two.md`, and the residue printed a cause
 * for them — "the tree stops at .changeset; the layout moved under it" — that
 * describes a directory rename which never happened. A fabricated lead, from
 * the same fixture family the entry-point mask was written to refuse.
 *
 * ## Why reachability, and not a banner comment
 *
 * The obvious alternative is to mask everything below the block-comment
 * `self-test` banner these scripts write. `SELF_TEST_DECL`'s docblock argues
 * against it directly, and that argument is adopted here rather than
 * re-litigated: a declaration is a thing the language guarantees, a marker
 * comment is a thing an author has to remember. The banner is also not
 * load-bearing anywhere else, so nothing would go red when one is missing — the mask would simply
 * stop reaching, silently, which is the failure family this whole module is
 * built to refuse.
 *
 * ## The predicate, and which half is the safety half
 *
 * A callable is masked when it is reachable from a self-test body AND NOT
 * reachable from anything else the module does. The second conjunct is the
 * safety half: a helper shared by the self-test and the real gate body stays
 * unmasked, or the mask would drop a population the gate really reads. The
 * roots of "anything else" are the module-body statements outside every
 * declaration (the `import`s, the top-level side effects, the `export { … }`
 * lists, the entrypoint guard at the bottom) plus every `export`ed
 * declaration, which is reachable from outside this file by definition. A
 * self-test body is REACHED but never TRAVERSED — the bottom of these scripts
 * calls `selfTest()` from module scope, so traversing it would make every
 * helper root-reachable and the whole predicate vacuous.
 *
 * ## Why VALUE declarations are excluded, measured rather than assumed
 *
 * Extending the same predicate to `const`/`let`/`var` was implemented and
 * REFUSED. A top-level constant that carries path literals and is referenced
 * from no executing code is, in this tree, overwhelmingly a gate DECLARING its
 * population for this very scanner to read — `ROOT_DIR_WATCH_HINTS`,
 * `ROOT_FILE_WATCH_HINTS`, `ROOT_WATCH_HINTS`, the shape
 * `scripts/check-watch-hint-literal.mjs` exists to enforce. Being unreferenced
 * is what those declarations ARE. Measured over the 204 files this derivation
 * scans: masking values as well takes 36 files and 175 hints instead of 9 and
 * 104, and the 71 extra include the declared populations of eight gates
 * (`.claude/**`, `content/**`, `docs/**`, `skills/**`, `packages/drivers/**`,
 * `examples/**`, `scripts/**`, `ARCHITECTURE.md/**`) — the mask erasing
 * exactly the declarations it is supposed to see. The fixture TABLES it would
 * also have caught (`SELF_TEST_CASES` and friends) are left behind
 * deliberately: keeping a false hint costs a CI round, dropping a declared
 * population costs a gate.
 *
 * ## What counts as a reference
 *
 * Identifiers at CODE positions, plus identifiers inside `${…}`
 * interpolations, which are code — `scan.interpolation` exists for exactly
 * this and skipping it is not academic: `release-rehearsal-clone.mjs` names
 * its own path constant only from inside template literals, so a scan that
 * read `${SELF}` as string text would have found `SELF` unreferenced and
 * masked away the one hint that file really declares. Prose is excluded (a
 * docblock naming a helper is not a call), and so is plain string text;
 * admitting string text too was measured over the same 204 files and moved
 * nothing at all, so it buys no safety worth its cost.
 *
 * An identifier is counted wherever it stands, property accesses and shadowing
 * locals included. That over-counts references, and over-counting can only
 * keep a declaration unmasked.
 */
function selfTestOnlyCallables(source, scan, selfTestStarts) {
  const decls = topLevelDecls(source, scan, selfTestStarts);
  if (!decls.some((d) => d.selfTest)) return [];
  const refs = decls.map(() => new Set());
  const moduleBodyRefs = new Set();
  let at = 0;
  for (const m of source.matchAll(IDENTIFIER_TOKEN)) {
    const i = m.index;
    if (scan.comment[i]) continue;
    if (scan.literal[i] && !scan.interpolation[i]) continue;
    while (at < decls.length && decls[at].end <= i) at++;
    if (at < decls.length && i >= decls[at].start) refs[at].add(m[0]);
    else moduleBodyRefs.add(m[0]);
  }
  const byName = new Map();
  for (let k = 0; k < decls.length; k++) {
    const list = byName.get(decls[k].name);
    if (list) list.push(k);
    else byName.set(decls[k].name, [k]);
  }
  const reach = (seeds) => {
    const seen = new Set();
    const queue = [...seeds];
    while (queue.length > 0) {
      const name = queue.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      for (const k of byName.get(name) ?? []) {
        // Reached, never traversed: what a self-test body calls is not part of
        // what this module DOES.
        if (decls[k].selfTest) continue;
        for (const next of refs[k]) if (!seen.has(next)) queue.push(next);
      }
    }
    return seen;
  };
  const roots = new Set(moduleBodyRefs);
  for (const d of decls) if (d.exported) roots.add(d.name);
  const live = reach(roots);
  const fromSelfTest = reach(decls.flatMap((d, k) => (d.selfTest ? [...refs[k]] : [])));
  return decls.filter((d) => d.callable && !d.selfTest && fromSelfTest.has(d.name) && !live.has(d.name));
}

/**
 * The source with the BODY of every top-level self-test function blanked, and
 * with it every top-level callable ONLY the self-test can reach.
 *
 * ## Why the self-test is not part of what a gate reads
 *
 * A check script's self-test is made of fixture paths — it has to be, since the
 * thing under test is a judgment about paths. The hint scan could not tell a
 * fixture from a literal the gate really opens, so a gate was printed in the
 * MATCHED column for most of the tree. The three worst specimens, measured on
 * this branch's base: `scripts/pm/dispatch-gates.mjs` (46 coverage-capable
 * hints, 2 real), `scripts/check-empty-changeset.mjs` (36), and
 * `scripts/check-adr-0087-registration.mjs` (34) — the last two also reached
 * through `check:changeset-gate-self-tests`, which resolves to all three
 * changeset gates at once and inherits the union of their fixtures.
 *
 * The fixture builders those self-tests CALL are the other half, and they are
 * `selfTestOnlyCallables`' subject: the declaration's own name is what
 * `SELF_TEST_DECL` reads, and a helper's name never spells self-test. Measured
 * over the 204 scripts this derivation scans, adding them removes 104 hints
 * from 9 files and adds none; every one of the 104 is attributable to a single
 * fixture-building declaration, and no family loses coverage of a file it
 * still opens.
 *
 * The end of the body is found by counting braces over code positions only, so
 * a `}` inside a fixture string or a `{1,6}` inside a regex cannot close it
 * early. A self-test declaration whose braces never balance masks to end of
 * file: recall loss on a malformed script, never a fabricated lead.
 *
 * Compose comment masking FIRST — otherwise a `function selfTest() {` written
 * at column 0 inside a block comment (a docblock example, exactly the kind this
 * file is full of) would anchor a mask over real code.
 *
 * The result is a strict superset of the mask this function applied before the
 * helper follow existed: the self-test spans are computed exactly as they were,
 * and the helpers are added to them. Nothing that used to be blanked survives.
 */
export function maskSelfTests(source) {
  const scan = scanSource(source);
  const flags = new Uint8Array(source.length);
  const selfTestStarts = new Set();
  for (const m of source.matchAll(SELF_TEST_DECL)) {
    const start = m.index;
    if (scan.comment[start] || scan.literal[start]) continue;
    selfTestStarts.add(start);
    const end = bracedBodyEnd(source, scan, start, true);
    for (let k = start; k < (end < 0 ? source.length : end); k++) flags[k] = 1;
  }
  for (const decl of selfTestOnlyCallables(source, scan, selfTestStarts)) {
    for (let k = decl.start; k < decl.end; k++) flags[k] = 1;
  }
  return blank(source, flags);
}

/**
 * The source extensions the name-anchor census below reads. The anchor is a
 * JavaScript declaration shape, so the corpus is the tree's JavaScript and
 * TypeScript, and nothing else.
 */
export const ANCHOR_CENSUS_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;

/**
 * The bare name this tree's self-test convention spells. Every other name the
 * anchor matches is COMPOUND, and a compound name is the only place the anchor
 * can be wrong in either direction.
 */
const BARE_ENTRY_POINT_NAME = 'selfTest';

// `COMPOUND_ANCHOR_LEDGER` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

/**
 * The ledger as `"<file>::<name>"` keys. `runSelfTest` alone proves the key has
 * to carry the file: that one spelling is a genuine entry point in one script
 * and production code in another, so a name-keyed ledger could not hold both
 * verdicts at once — the same reason the anchor itself cannot be narrowed.
 */
export const COMPOUND_ANCHOR_KEYS = new Map(
  COMPOUND_ANCHOR_LEDGER.map(([file, name, accidental]) => [`${file}::${name}`, accidental]),
);

/**
 * Every COMPOUND-name declaration the self-test anchor matches in `source`, at
 * CODE positions only.
 *
 * Comments are masked first for the same reason `maskSelfTests` composes them
 * first: this tree's docblocks quote declaration shapes at column 0, and a
 * quoted one is prose, not a declaration. A match inside a string literal is
 * excluded by the same means the mask uses — `scanSource`'s literal map — so a
 * self-test fixture that BUILDS a module source cannot enter the census as if
 * it were a declaration of the file holding it.
 */
export function compoundAnchorDecls(source) {
  const scan = scanSource(source);
  const decommented = maskedComments(source);
  const out = [];
  for (const m of decommented.matchAll(SELF_TEST_DECL)) {
    if (scan.comment[m.index] || scan.literal[m.index]) continue;
    const name = m[0].match(/function[ \t]+([A-Za-z0-9_$]+)/)[1];
    if (name === BARE_ENTRY_POINT_NAME) continue;
    out.push({ name, index: m.index, line: decommented.slice(0, m.index).split('\n').length });
  }
  return out;
}

/**
 * `source` with one declaration renamed so the self-test anchor no longer sees
 * it — the counterfactual the accidental half is measured against.
 *
 * The rename replaces the self-test token INSIDE the identifier rather than
 * appending or truncating, because the anchor matches the token anywhere in the
 * name: a mangle that leaves any spelling of it behind is a mutation that does
 * not land, and a mutation that does not land reads exactly like a clean
 * measurement. Both directions are asserted by the caller, which refuses unless
 * the anchored-declaration count drops by exactly one.
 *
 * Word-anchored so a longer identifier sharing the prefix is untouched —
 * renaming `runSelfTest` must not also rewrite `runSelfTestCases`.
 */
export function withoutAnchor(source, name) {
  const replacement = name.replace(/[Ss]elf[_]?[Tt]est/, 'Probe');
  if (/[Ss]elf[_]?[Tt]est/.test(replacement)) return null;
  if (new RegExp(`\\b${replacement}\\b`).test(source)) return null;
  return source.replace(new RegExp(`\\b${name}\\b`, 'g'), replacement);
}

/**
 * The IANA top-level media types. A closed registry, not a heuristic: these ten
 * are the whole of it, so a two-segment literal headed by one of them is a MIME
 * type rather than a path — `application/json`, `text/event-stream`,
 * `image/png`.
 */
const MEDIA_TOP_LEVEL_TYPES = new Set([
  'application', 'audio', 'example', 'font', 'image',
  'message', 'model', 'multipart', 'text', 'video',
]);

/**
 * The remote names whose `<remote>/<branch>` shorthand is a git revision, not a
 * directory. `origin` is the only one this repo's tooling ever spells — it is
 * what `DEFAULT_BASE_REMOTE` holds, five hundred lines below, for the very
 * reason this predicate exists.
 */
const GIT_REMOTE_NAMES = new Set(['origin']);

/**
 * Is this literal a name from a namespace that is NOT the filesystem?
 *
 * `extractWatchHints` decides "looks pathy" by "contains a slash", and a slash
 * is the separator of several namespaces this repo's scripts also handle. When
 * one of those strings survives into a family's hint set it becomes a DECLARED
 * POPULATION the gate never declared — a literal scraped out of the script's
 * operational constants and read as the corpus it watches.
 *
 * ## The three shapes this refuses, and why each is closed rather than a guess
 *
 *   MIME type        `type/subtype` headed by one of the ten IANA top-level
 *                    types, with a subtype carrying no dot. The registry is
 *                    closed, and the dot check keeps a real path with an
 *                    extension (`image/logo.png`, were such a directory ever
 *                    added) out of the refusal.
 *   git revision     the `refs/…` namespace git reserves for refs, and the
 *                    `origin/…` remote-tracking shorthand for it.
 *   `@`-headed name  a first segment beginning with `@` is a scope marker,
 *                    not a directory: an npm package specifier
 *                    (`@objectstack/spec`, `@typescript-eslint/parser`), a
 *                    version-suffixed one (`@objectstack/spec@*`), or a
 *                    bundler alias (`@/lib/i18n` — the bare `@` head is the
 *                    whole first segment there). Closed by grammar rather
 *                    than by registry — npm reserves the leading `@` for
 *                    scopes — and measured on this tree: ZERO tracked paths
 *                    have a first segment starting with `@` (git ls-files at
 *                    5f0a9c4ad), so the refusal cannot touch a live hint. A
 *                    later segment starting with `@` (`packages/@scope/x`,
 *                    were one ever tracked) stays untouched: only the FIRST
 *                    segment carries the namespace claim. The bare scope name
 *                    itself (`@objectstack`, what a trailing-slash literal
 *                    trims down to) is the same namespace and refused with it.
 *                    Measured against
 *                    #13312's population sweep: 353 of the 598 dead hints
 *                    riding unannotated in reachable families were this one
 *                    shape — package specifiers scraped out of dependency
 *                    ledgers and workspace enumerations and read as watched
 *                    paths.
 *
 * ## Why refusing is the safe direction here (measured, not assumed)
 *
 * Refusing a hint cannot fabricate a lead; it can only withhold one. A family
 * that loses its last hint lands in `undetermined` — "source names no path at
 * all — NOT known irrelevant" — which is the honest bucket for a gate this
 * derivation cannot place, and strictly more honest than the `unreachable`
 * verdict a phantom population earns it.
 *
 * Swept over this tree at the time of writing, the refusal takes 21 distinct
 * literals out of the hint sets (20 media types, 1 ref) and NONE of them names
 * a tracked path or path prefix — the tree has no top-level directory called
 * `refs`, `origin`, or any of the ten media types. So it moves no verdict for
 * any card: every literal it removes was already dead for matching purposes.
 * What changes is which families are reported as having a dead POPULATION.
 *
 * ## Why the whole class, and not the two families that surfaced it
 *
 * The two families whose ENTIRE population was one of these strings
 * (`check:release-body` naming `application/json`,
 * `check-skill-frame-freshness.mjs` naming `refs/remotes/origin/main`) are the
 * instances that made it visible, but the same literal is scraped out of a
 * dozen other gate sources where a real hint happens to sit beside it and hide
 * the effect. Those survivors are the fabrication risk `extractWatchHints`'
 * header calls the expensive direction — a lead pasted into a dispatch prompt
 * that the dev cannot tell from a real one. One predicate closes the class.
 *
 * This file already knew: `DEFAULT_BASE_REF` is assembled from two unslashed
 * halves specifically so the joined `origin/main` never enters its own hint
 * set. That workaround is the single-file version of this rule, and its comment
 * is the prior measurement.
 */
export function isNonPathNamespace(literal) {
  const segments = String(literal).split('/');
  if (segments.length === 2 && MEDIA_TOP_LEVEL_TYPES.has(segments[0]) && !segments[1].includes('.')) {
    return true;
  }
  if (segments[0].startsWith('@') && (segments[0].length > 1 || segments.length > 1)) return true;
  return segments.length >= 2 && (segments[0] === 'refs' || GIT_REMOTE_NAMES.has(segments[0]));
}

/**
 * Resolve a MODULE-RELATIVE literal against the directory of the script that
 * WROTE it, as a repo-relative path — or `null` when it names nothing inside
 * the repo.
 *
 * ## Why this is the producer's job and not the reader's
 *
 * `./lib/dist-freshness`, `../src/kernel/protocol-version` — those are how a
 * gate INSIDE a package spells a file it really reads. Stripping the prefix
 * produced `lib/dist-freshness` and `src/kernel/protocol-version`, strings this
 * tree has no top-level `lib/` or `src/` for, so they reached nothing and the
 * residue asserted they "never were repo paths" about files that are on disk.
 * Resolving is the contract-first repair: the extracted hint means what the
 * source means, rather than the reader being taught to forgive a spelling the
 * producer got wrong.
 *
 * ## Two refusals, both about naming no path rather than about taste
 *
 *   escapes the repo      `relative()` answers with a leading `..` — a sibling
 *                         checkout is not a path `hintCovers` can compare
 *                         against, because its inputs are repo-relative.
 *   resolves to the root  the empty string, which every input "starts with" and
 *                         which would therefore cover the entire tree.
 *
 * ## The same idiom as `firstPartyImportTargets`, deliberately
 *
 * That function already resolves a relative specifier against
 * `dirname(join(root, scriptPath))` and reads the answer back through
 * `relative(root, …)`. Two resolvers for "where does this script's `../` point"
 * would be free to disagree, and one of them would be the one nobody
 * re-measured. This is the same three lines, and the self-test pins that the
 * import follow and the hint resolve agree on a shared specimen.
 *
 * ## Price (measured, and the deliverable this card owes)
 *
 * The resolve is a NO-OP for every literal already spelled from the repo root
 * by a writer at that depth, which is most of them — see the pair-count
 * measurement in this change's PR body, taken over the live fleet with
 * `hintCovers` as the sole predicate.
 */
export function resolveModuleRelativeHint(literal, scriptPath, { root = ROOT } = {}) {
  const rel = nodePath.relative(root, nodePath.resolve(nodePath.join(root, nodePath.dirname(scriptPath)), literal));
  if (!rel || rel === '..' || rel.startsWith('../')) return null;
  return rel;
}

/**
 * The repo-relative DIRECTORY a single-segment module-relative literal names —
 * or `null` for every other single-segment literal, which is the standing
 * refusal this narrows by exactly one class.
 *
 * ## The class, and the two literals it exists for
 *
 * `looksPathy` reads a literal as the author wrote it minus the depth prefix,
 * so a literal that is ONE segment after the strip carries no separator and is
 * no hint at all. That is right for `'./invoked-as.mjs'` and `'./package.json'`
 * and wrong for these two, which are unambiguous subtree declarations:
 *
 *   `packages/spec/scripts/build-docs.ts#SRC_DIR`             path.resolve(__dirname, '../src')
 *   `packages/spec/scripts/build-skill-references.ts#SPEC_SRC` path.resolve(__dirname, '../src')
 *
 * Checked at the declaration site rather than assumed, which is the provenance
 * criterion this file prices: `build-docs.ts` does `fs.readdirSync(SRC_DIR)`
 * and walks the category directories under it; `build-skill-references.ts`
 * resolves every spec file it reads against `SPEC_SRC`. Both really do read
 * `packages/spec/src`.
 *
 * ## Why the test is "a tracked DIRECTORY" and not "the resolve succeeded"
 *
 * Admitting on the resolved form alone is the naive widening, and it is
 * measured and REFUSED — `extractWatchHints`' admission comment carries the
 * verdict. Re-measured on this tree at `96dc446c9`, it adds 53 distinct hints,
 * and the split is the whole argument:
 *
 *   resolve to a tracked DIRECTORY   1    `packages/spec/src`, on the two gates above
 *   resolve to a tracked FILE       42    `invoked-as.mjs` (x123 families),
 *                                         `ts-parse.mjs`, `js-comment-mask.mjs`,
 *                                         `packages/spec/package.json` — the sibling
 *                                         module and manifest class, a second and
 *                                         unpriced answer to the question
 *                                         `firstPartyImportTargets` already owns
 *   resolve to nothing tracked      10    `packages/spec/json-schema`,
 *                                         `packages/spec/scripts/{contracts,data,other,ui}`,
 *                                         `scripts/{package,base,tsconfig}.json` —
 *                                         build OUTPUT directories and untracked
 *                                         siblings, hints that would print and reach
 *                                         nothing
 *
 * So the directory test is not a refinement of the naive widening, it is a
 * different predicate that happens to share its resolve: it takes 1 of the 53
 * and leaves the two refused classes bit for bit.
 *
 * TRACKED, never `existsSync` + `isDirectory`. The ten in the third row are
 * exactly what a filesystem test would get wrong the moment anything has been
 * built — `packages/spec/json-schema` and the four `packages/spec/scripts/*`
 * roots are generated output, absent from a clean checkout and present after a
 * build, so a filesystem predicate would mint five hints whose existence
 * depends on whether the reader ran a build first. `git` is the corpus every
 * other answer in this file is measured against, and it is the corpus here.
 *
 * ## Why the resolved form must carry a SEPARATOR
 *
 * A literal like `'../../skills'` written from `scripts/pm/` resolves to
 * `skills` — a tracked directory, and a BARE ROOT. Admitting it would build a
 * hint `hintCovers` refuses on its own bare-word rule, so it would reach
 * nothing, and it would land as a fresh row in the SHRINK-ONLY escapable-literal
 * ledger (`escapableLiteralRows` selects on exactly "no separator, and the tree
 * has the whole literal"). That is the +139084-pair class re-entering one
 * literal at a time, through a door labelled "directory".
 *
 * The separator requirement makes the refusal structural rather than lucky: no
 * literal this function admits can be a hint `hintCovers` would refuse, so the
 * bare-word verdict is untouched by construction and not merely untouched on
 * today's tree. The gate whose population really is a repo root has the same
 * escape it always had — declare the subtree spelling, `ROOT_DIR_WATCH_HINTS`.
 *
 * ## WITH the neighbouring refusals, or APART? — apart, and on their own criterion
 *
 * `hintCovers`' docblock refuses two neighbours: a bare top-level word
 * (+139084 pairs) and a bare root FILE literal (refused on provenance, 8 of 17
 * new pairs fabricated because `README.md` is a basename gates JOIN with a
 * package directory). This class sits APART from both, and the distinction is
 * not one of degree:
 *
 *   - both neighbours are literals with NO WRITER to resolve against, so the
 *     tree cannot say which path — if any — they mean. `packages` is a path
 *     COMPONENT in dozens of gates that never read the root. A module-relative
 *     literal is the opposite shape: it is an author pointing from where they
 *     stand, it resolves to exactly one path, and whether that path is a
 *     tracked directory is a fact of the tree rather than a reading of intent;
 *   - provenance, which is the criterion the docblock says it actually prices
 *     and never volume: 2 of 2 admitted (family, hint) pairs are TRUE leads,
 *     verified at the declaration site above. 0 fabricated;
 *   - the neighbours are refusals of a hint the covering rule cannot judge.
 *     This function emits a resolved, multi-segment path, so both refusals keep
 *     running on exactly the population they always did.
 *
 * ## Price, measured through `hintCovers` and nothing else
 *
 * Over 176 families x 7131 tracked files at `96dc446c9`:
 *
 *   watch-hint (gate, file) pairs   83846 -> 85954   (+2108, and ZERO lost)
 *   families gaining coverage       2; ZERO losing
 *   (check, hint) live / inert      892/590 -> 894/590   (+2 live, 0 newly inert)
 *   distinct hints in the fleet     829 -> 829       UNCHANGED, and that is the
 *                                   shape of the thing: `packages/spec/src` is
 *                                   already spelled from the root by other
 *                                   gates, so this admits no hint text the
 *                                   fleet did not already carry — it gives two
 *                                   gates the hint their own source declares
 *   check:docs                      451 -> 1505
 *   check:skill-refs                 15 -> 1069
 *
 * Each of the two new (check, hint) pairs contributes 1054 files, the whole of
 * `packages/spec/src`, which is why the pair total is exactly twice it. The
 * hint has no `packages/spec/src.<ext>` sibling, so the dropped-extension
 * disjunct adds nothing to either.
 *
 * The card that filed this measured 2062 (1031 + 1031) on 6899 tracked files
 * and the pre-#12794 matcher. The reading moved with the tree, not with the
 * rule: `packages/spec/src` holds 1054 tracked files now rather than 1031, and
 * both gates take all of them.
 *
 * ## Why the TREE is a parameter and not a read
 *
 * `extractWatchHints` is a pure string function over one script's source, and
 * `hintCovers`' docblock refuses coupling extraction to a git checkout — the
 * refusal that sent the dropped-extension follow to comparison time. It is not
 * relaxed here. The corpus arrives as an argument, from the caller that has
 * already read it once; a caller with no tree gets the standing refusal, which
 * is a MISSING lead and the direction this file errs in everywhere. And the
 * membership questions are answered by `trackedPrefixes` and `trackedFiles` —
 * the file's existing single owners of "what does the tree have" — never by a
 * second walker built here.
 */
export function moduleRelativeDirectoryHint(literal, scriptPath, tree, { root = ROOT } = {}) {
  if (!scriptPath || !tree) return null;
  const resolved = resolveModuleRelativeHint(literal, scriptPath, { root });
  // A bare root is refused BEFORE the tree is consulted: it is not a directory
  // this rule declines to name, it is a hint `hintCovers` would refuse anyway.
  if (!resolved || !resolved.includes('/')) return null;
  // A tracked prefix that is not itself a tracked file IS a directory — read
  // off the two sets the sweep already builds, so this cannot disagree with
  // what the reachability half of the tool believes the tree holds.
  if (!tree.prefixes.has(resolved) || tree.files.has(resolved)) return null;
  return resolved;
}

/** A binding worth resolving is seeded from the running module's own location. */
const MODULE_ANCHOR_SEED = /import\.meta\.(?:url|dirname|filename)/;

/**
 * ── The THIRD anchor: the PACKAGE ROOT a gate binds from its own module URL
 *    (#14208) ──────────────────────────────────────────────────────────────────
 *
 * The repo root is one anchor and the writer's own directory
 * (`resolveModuleRelativeHint`) is the second. A gate that lives INSIDE a
 * package writes against a third, bound once at module top and used everywhere
 * after:
 *
 *   const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
 *   const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
 *
 * This function answers WHERE that binding points, and answers nothing else.
 * Whether any literal should be read against it is the caller's question
 * (`packageRootAnchoredHint`), which is what keeps this one a fact of the tree
 * rather than a reading of intent.
 *
 * ## Why it routes through `resolvePathExpression` and builds no walker
 *
 * `anchoredReadTargets` already resolves exactly these expressions, from the
 * same three-part context, for the read follow. A second regex over
 * `fileURLToPath` spellings would be a copy of that resolver, and a copy that
 * drifts is the defect this file exists to refuse — so the ctx is built the
 * way that scan builds it and the resolution is the resolver's.
 *
 * ## Narrowings, and why each one is structural
 *
 * SEEDED FROM `import.meta` ONLY. A binding computed from the repo root
 * (`join(ROOT, 'packages/spec')`) is already spelled from the root and needs no
 * anchor; admitting it would make every join base in the file a candidate
 * anchor, which is a widening nothing here measured.
 *
 * A TRACKED DIRECTORY, read off `tree.prefixes`/`tree.files` — the same two
 * sets `moduleRelativeDirectoryHint` reads, so this cannot disagree with what
 * the reachability half of the tool believes the tree holds.
 *
 * THAT CARRIES A TRACKED `package.json`. This is the narrowing that makes the
 * anchor a PACKAGE root rather than "any directory above the writer": the
 * manifest is the tree's own declaration that this directory is a root things
 * are addressed from, and it is the same declaration the manifest follow
 * (`packageManifestTargets`) reads one edge over. Without it the rule would
 * re-anchor at every intermediate directory a script happens to climb to.
 *
 * NEVER THE REPO ROOT: a binding that resolves to zero segments is the anchor
 * the extractor already applies, so admitting it would be a no-op wearing a
 * rule's clothes. `dispatch-gates.mjs`' own `ROOT` is that shape.
 *
 * The FIRST such binding in source order wins. Measured on this tree the
 * question does not arise — every script in the population binds exactly one —
 * and a file that bound two package roots would be describing two packages,
 * which is a card to file rather than a guess to make here.
 */
export function packageRootBinding(scriptPath, moduleBody, tree) {
  if (!scriptPath || !tree) return null;
  const ctx = {
    fileSegs: scriptPath.split('/'),
    names: nameInitialisers(moduleBody),
    returns: singleReturnExpressions(moduleBody),
    params: singleCallSiteParameters(moduleBody),
    seen: new Set(),
  };
  for (const inits of ctx.names.values()) {
    for (const init of inits) {
      if (!MODULE_ANCHOR_SEED.test(init)) continue;
      ctx.seen.clear();
      const at = resolvePathExpression(init, ctx);
      if (at.kind !== 'in-tree' || at.segs.length === 0) continue;
      const dir = at.segs.join('/');
      if (!tree.prefixes.has(dir) || tree.files.has(dir)) continue;
      if (!tree.files.has(`${dir}/package.json`)) continue;
      return dir;
    }
  }
  return null;
}

/**
 * One hint, re-read against the package root its writer binds — or `null` when
 * that reading is not available or does not reach the tree (#14208).
 *
 * ## The defect, and the one class it is allowed to touch
 *
 * `extractWatchHints` takes a literal with no `./` prefix as spelled FROM THE
 * REPO ROOT. For a gate inside a package that is the wrong base and the tree
 * says so out loud: `check:generated` declares `api-surface/`,
 * `export-origins/`, `declaration-map/`, `liveness/state-counts.md` and
 * `src/meta-spelling/meta-url-data.generated.ts`, all five alive under
 * `packages/spec/` and all five printed by the residue as dead leads.
 *
 * The admitted class is exactly the one whose residue sentence was FALSE, and
 * that coupling is deliberate rather than convenient: a hint is re-anchored
 * only when `deepestTrackedPrefix` is empty — no tracked path begins with even
 * its first segment — which is the branch `unreachableReason` renders as "never
 * was a repo path". A hint that stops at a SHORTER prefix is the "layout moved"
 * class and is left alone: its first segment is a real repo directory, so the
 * root is the base the author most plausibly meant and re-anchoring it would
 * replace a triage lead with a fabricated one.
 *
 * ## Why this is not the widening the two priced refusals refuse
 *
 * `moduleRelativeDirectoryHint`'s docblock prices a naive widening of the
 * RESOLVED form at +53 hints of which 1 was a true lead, and `hintCovers`'
 * bare-top-level-word admission at +139084 pairs. Neither is relaxed here, and
 * neither can be reached from here:
 *
 *   - ADMISSION is untouched. A literal that is not already a hint — a bare
 *     single-segment word, a sibling specifier, a package name — never arrives
 *     at this function. What is re-anchored is a literal the scan already
 *     admitted and the tree already refused;
 *   - the candidate must REACH THE TREE, through `hintReachesTree`, which is
 *     `hintCovers` applied to the corpus. A re-anchoring that names nothing is
 *     dropped and the hint keeps the spelling it had, so the rule cannot invent
 *     a path — measured live on `check:browser-reachable-entries`' `'zod'`,
 *     which stays dead because `packages/spec/zod` is not there;
 *   - it REPLACES rather than adds. The re-anchored form is the same claim
 *     about the same literal under the base its writer actually bound, so the
 *     family's declared-literal count does not move and no second hint is
 *     manufactured beside a dead one.
 *
 * ## The POPULATION, swept before the rule was written (ad54eb342)
 *
 * The card that filed this asked for the sweep first and the repair only if it
 * survived. Over the 201 discovered families' 195 scannable gate scripts:
 *
 *   scripts binding a package root this way              8   (all `packages/spec`)
 *   ...of which carry a hint dead at the repo root       2
 *   dead-at-root hints in that population                6
 *   ...that re-anchor onto something the tree HAS        5
 *   ...refused because the re-anchoring reaches nothing  1   (`'zod'`, a package
 *                                                            specifier, in
 *                                                            check:browser-reachable-entries)
 *
 * ⚠️ The card described the class as literals passed to `resolve(PKG_DIR, …)`.
 * That shape is real — 6 such literals across 6 of the 8 scripts — but it is
 * NOT where the confirmed instance comes from, and a rule restricted to it
 * would have repaired none of the three dead leads the card names: all five of
 * check:generated's are `artifact:` values in its GATED ledger, describing what
 * each gate verifies, resolved by nothing. The syntactic restriction was
 * measured and dropped for that reason; the reachability test above is what
 * keeps the wider reading honest.
 *
 * ## Blast radius, measured before the change and after it (ad54eb342)
 *
 * A rule that moves rows moves them for EVERY family, so the price is the
 * deliverable and not a footnote. Over 201 discovered families and 7900 tracked
 * files:
 *
 *   watch-hint (gate, file) pairs   142089 -> 142139   (+50, and ZERO lost)
 *   families whose hint set moves        1  — check:generated, and no other
 *   pairs RE-ATTRIBUTED (same pair, new via)            0 — every replaced
 *                                   spelling was DEAD, so it covered nothing
 *                                   that could be re-attributed
 *   (check, hint) live / inert      1108/152 -> 1113/147
 *   distinct hints in the fleet          725 -> 722, because three of the five
 *                                   re-anchored forms are already spelled from
 *                                   the root by other gates
 *   families carrying dead literals       46 -> 45
 *   dead literals                        152 -> 147
 *   ...of them in the empty-`deepest` class          128 -> 123
 *
 * PROVENANCE, which is the criterion this file prices and never volume: 5 of 5
 * admitted hints are TRUE leads and 50 of 50 pairs with them, each verified at
 * its declaration site — they are `check:generated`'s own artifact ledger, and
 * the gate's whole job is to verify those artifacts against their sources:
 *
 *   packages/spec/api-surface        17 files    packages/spec/export-origins  17
 *   packages/spec/declaration-map    14          .../meta-url-data.generated.ts  1
 *   packages/spec/liveness/state-counts.md        1
 *
 * 0 fabricated. For scale, `hintCovers`' docblock prices the bare-top-level-word
 * admission it refuses at +139084 pairs on this corpus; this is 0.04% of it.
 *
 * @param {string} hint  a hint `extractWatchHints` has already admitted
 * @param {string} base  the package root, from `packageRootBinding`
 * @param {{files: Set<string>, prefixes: Set<string>}} tree
 * @param {string[]} files  the same corpus, as the array `hintReachesTree` walks
 * @returns {string|null} the re-anchored hint, or null
 */
export function packageRootAnchoredHint(hint, base, tree, files) {
  if (!base || !tree || !files) return null;
  if (deepestTrackedPrefix(hint, tree.prefixes) !== '') return null;
  const candidate = `${base}/${hint}`;
  return hintReachesTree(candidate, files) ? candidate : null;
}

/**
 * The spans of a scanned gate's own EXCLUSION constants — the declarations
 * whose contents are the paths that gate refuses to look at (#15753).
 *
 * ## The defect
 *
 * The scan below reads the whole module body, so a path literal sitting inside
 * a declared exclusion list was admitted as a surface the gate WATCHES — the
 * exact inverse of what the declaration says. `check-half-states.mjs` declares
 * a two-spelling noise floor meaning "never pair on this", and the hint
 * `.changeset` came straight out of the prefix half of it. Every user-visible
 * PR in this repo adds a changeset, so that derivation landed on essentially
 * every card: an exclusion list read as an inclusion surface, where the size of
 * the mistake is set by the spelling that happens to be in the constant rather
 * than by anything anyone chose. A noise floor that later grows a broader
 * prefix scales it silently, and the hint reader had no way to tell
 * watch-this from never-pair-on-this.
 *
 * ## Why the DECLARATION, and not a list of paths here
 *
 * A copy of any gate's noise floor inside this tool would answer today's
 * spelling and drift from the constant the moment either side moved — the
 * defect this file refuses everywhere else. The exclusion is already declared,
 * in the scanned source, by the identifier the literal is assigned under, so
 * that is what is read. A comment-marker convention was refused for a
 * mechanical reason rather than a stylistic one: `maskedModuleBody` blanks
 * comments before this scan ever runs, so a marker on the constant is invisible
 * from here, while declaration TEXT survives the mask.
 *
 * ## The census, measured on this tree
 *
 * Re-measured with the `DEFERRED` arm in place, over the objectstack-ai/objectstack
 * tree at `e6a03e6491`. The METHOD, which this block used to leave implicit: run
 * `topLevelDecls` over every tracked JS/TS file under `scripts/`, keep the
 * non-callable declarations, test each name against the predicate, and price
 * the arm by diffing `extractWatchHints` against a build of this module whose
 * predicate matches nothing. Attribution is the regex engine's own — leftmost
 * position first, then alternation order.
 *
 * 4,697 top-level VALUE declarations over the 287 tracked JS/TS files under
 * `scripts/`. 75 identifiers match the predicate; 66 carry at least one string
 * literal; the whole set moves 24 hints, across 8 files:
 *
 *   scripts/check-issue-citations.mjs     DEFERRED_SURFACES                 8
 *   scripts/check-doc-authoring.mjs       SKIP_DIRS, SKIP_PATHS, SKIP_FILES,
 *                                         PACKAGES_PROSE_EXCLUDED           6
 *   scripts/check-refd-timer-probe.mjs    EXCLUDED_DIRS                     4
 *   scripts/pm/measurement-claim-triage.mjs  EXCLUDED, SKIP_DIRS            2
 *   scripts/check-corpus-claim-drift.mjs  SKIP_DIRS, SKIP_SUBTREES          1
 *   scripts/check-role-word.mjs           SKIP_DIRS, SKIP_SUBTREES          1
 *   scripts/check-keyed-text-bounds.mjs   SKIP_DIRS                         1
 *   scripts/pm/check-half-states.mjs      H36_SHARED_PATH_NOISE,
 *                                         H36_SHARED_PREFIX_NOISE           1
 *
 * Each was read against the gate that declares it, and each is an exclusion in
 * that gate's own words: "whole subtrees skipped by path", "generated
 * subtrees, excluded by PATH under ROOTS", "generated from spec/frontmatter —
 * not hand-authored, don't police", "directories `git ls-files` can still name
 * that hold no authored source", "deliberately OUT, each with the reading that
 * put it out", and — for `PACKAGES_PROSE_EXCLUDED`, the one that is a bare
 * string rather than a list — the `continue` in the gate's own `descend` that
 * skips it.
 *
 * ## What the 24 cost, which is not 24
 *
 * THIRTEEN of them change no derivation at all, because the gate ALSO declares
 * the containing root as an inclusion population and `hintCovers` still reaches
 * the path through that. Measured per hint, probing under each dropped hint
 * against the surviving set: all six of check-doc-authoring's (`.claude/**`,
 * `docs/**`, `content/**` and `packages/**` are its `ROOT_WATCH_HINTS`), both
 * `content/docs/references` (covered by `content/docs`), and the five test
 * globs of the deferred table (covered by check-issue-citations' own
 * `packages/**`). That gate's own self-test already said so from the other
 * side — every `SKIP_PATHS` entry must sit UNDER a declared root — so those
 * exclusion hints were pure duplication.
 *
 * ELEVEN really leave a derivation, and every one of them is a lead that was
 * false: `node_modules`, `dist`, `coverage` and `.turbo` off
 * check-refd-timer-probe's skip set; `.changeset` twice — off
 * check-keyed-text-bounds' `SKIP_DIRS` and off the noise floor the card was
 * filed on; the two gate paths measurement-claim-triage declares it skips; and
 * `scripts/**`, `docs/adr/**` and `.changeset/**` off `DEFERRED_SURFACES`,
 * which is what the `DEFERRED` arm retired. The changeset pair is what a dev
 * actually saw when #15753 was filed: a card that has not written its
 * changeset yet is told which families it will owe once it does, and that
 * projection carried FOUR fabricated rows, 16 -> 12 — including
 * `check-half-states.mjs --format=markdown --provenance="$PROVENANCE"`, the
 * networked half-state-patrol sweep, advertised to every card in the tree as a
 * gate its changeset would trigger. The deferred table is that same reading
 * one gate over, and it is why this arm exists: `surfaceFor` opens by
 * returning `null` for every deferred glob, so `check:issue-citations` was
 * offered to a changeset path as a gate it triggers while the gate looks at
 * nothing there.
 *
 * ## The predicate: what the census kept, and what it retired
 *
 * `DENY`/`DENIED` was measured and REMOVED. It matched exactly one declaration
 * on this tree and that one is a false positive — an HTTP fixture, not an
 * exclusion list — and "deny" in this tree names AUTHORIZATION vocabulary
 * (`DENY_CODE`), never a path skip list. `DEFERRED` was measured and ADDED: it
 * matches two declarations on this tree, `DEFERRED_SURFACES` and
 * `DEFERRED_GLOBS` in `check-issue-citations.mjs`, and both are that gate's
 * own exclusion table. Matches for the surviving alternatives, first-match
 * attribution: SKIP 54, EXCLUDED 10, EXCLUSION 4, NOISE 2, SKIPPED 2,
 * DEFERRED 2, EXCLUSIONS 1, and EXCLUDE / EXCLUDES / IGNORE / IGNORED 0. The
 * four zero-scoring arms are kept deliberately and the reason is
 * the direction this predicate fails in: over-matching DROPS a hint (a missing
 * lead — one card, one CI round), while under-matching KEEPS a wrong one (a
 * fabricated lead pasted into every dispatch prompt whose surface brushes it).
 * That asymmetry is the extractor's own, stated in its docblock below, and it
 * is why an author's next spelling should be met by this predicate rather than
 * by a rediscovery of this card.
 *
 * ONE false positive survives, and it costs nothing: `SHOW_EXCLUDED` in
 * `scripts/objectui-range.mjs` is a CLI flag whose sense is to INCLUDE the
 * excluded rows, not a population — its only literal is `'--all'`, refused by
 * the flag rule regardless. A matched identifier that turns out to be an
 * INCLUSION list is the reading that would narrow this predicate; the census
 * found none, and `check-watch-hint-literal.mjs`'s roster of the inclusion
 * idiom (`ROOT_WATCH_HINTS` and its three siblings) shares no word with it.
 *
 * ## What this deliberately does NOT reach, so a reader is not told otherwise
 *
 * Only TOP-LEVEL declarations, because `topLevelDecls` is anchored at column 0
 * for the reasons its own docblock gives. A function-local exclusion constant
 * is not reached — `check-test-completeness.mjs` has the one instance on this
 * tree, and it costs nothing today because every literal in it is a bare
 * directory word the admission rule already refuses. camelCase spellings are
 * not reached either: the anchor is the SCREAMING_SNAKE segment, and the seven
 * camelCase near-misses on this tree (five in
 * `scripts/docs-audit/affected-docs.mjs`, one in
 * `scripts/check-type-check-coverage.mjs`, one here) are counters, note strings
 * and memo caches, not populations. Both are the direction that
 * drops LESS, which is the direction a widening of this rule may not silently
 * take.
 */
const EXCLUSION_DECL_NAME =
  /(?:^|_)(?:NOISE|SKIP|SKIPPED|DEFERRED|EXCLUDE|EXCLUDED|EXCLUDES|EXCLUSION|EXCLUSIONS|IGNORE|IGNORED)(?:_|$)/;

/** `topLevelDecls` classifies self-tests for its OTHER caller; this one has no stake in it. */
const NO_SELF_TEST_STARTS = new Set();

/**
 * The VALUE-declaration arm of `TOP_LEVEL_DECL`, on its own, as a prefilter.
 *
 * `topLevelDecls` needs a full `scanSource` of the body, and that scan is the
 * expensive half: measured on this tree with `--commands` over this file, two
 * runs each, running it unconditionally inside the hint scan cost ~12% of a
 * whole discovery pass (17.2s -> 19.2s). About 180 of the 230 scripts declare
 * no exclusion constant at all, so this decides that with a regex before any
 * scan starts, and the same measurement comes back 18.1s — ~5%, paid only by
 * the ~50 files that really carry one. ⛔ Not memoised on top of that: the
 * remaining cost is one scan per declaring file per analyser pass, and a third
 * bespoke cache for it would buy ~3% for a construct the profile above does not
 * justify. Re-measure before adding one.
 *
 * It is a SUPERSET of what `topLevelDecls` can return — the same arm, minus the
 * code-position test — so it never hides a declaration; the worst it does is
 * pay for a scan that then finds nothing, which is what a match inside a
 * string or a comment costs.
 */
const EXCLUSION_DECL_PREFILTER = /^(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=/gm;

/**
 * The `[start, end)` spans of `moduleBody`'s exclusion declarations, in source
 * order. Pure, and derived from the SAME masked text the scan reads, so the two
 * cannot disagree about what is code.
 */
function exclusionDeclSpans(moduleBody) {
  EXCLUSION_DECL_PREFILTER.lastIndex = 0;
  let candidate = false;
  for (const m of moduleBody.matchAll(EXCLUSION_DECL_PREFILTER)) {
    if (EXCLUSION_DECL_NAME.test(m[1])) {
      candidate = true;
      break;
    }
  }
  if (!candidate) return [];
  const spans = [];
  for (const decl of topLevelDecls(moduleBody, scanSource(moduleBody), NO_SELF_TEST_STARTS)) {
    if (decl.callable || !EXCLUSION_DECL_NAME.test(decl.name)) continue;
    spans.push([decl.start, decl.end]);
  }
  return spans;
}

/**
 * Scan a check script's MODULE BODY for the path-ish string literals it
 * operates on. A hint is a quoted string that contains a `/` (or names a
 * top-level dotted dir) and looks like a repo path rather than a URL or a
 * regex — read from the source with its comments and its self-test blanked, so
 * a path the script merely NAMES is not read as a path it watches.
 *
 * ## Why the narrowing, and why it is the precision half of the product
 *
 * The MATCHED column is what a dispatch prompt pastes, and its error is
 * one-directional in the expensive direction: a missing lead costs one card one
 * CI round, while a fabricated lead is pasted into EVERY dispatch prompt whose
 * file surface brushes a fixture path, and the dev who runs it cannot tell it
 * from a real one. The "repo-wide / undetermined" bucket already exists for
 * gates this derivation cannot place, and it is the honest home for a gate
 * whose only claim on your path was a string in its own test.
 *
 * What this does NOT remove: a fixture constant defined at module scope and
 * used only by the self-test still reads as a hint. That residue is bounded
 * (measured below) and it is the same shape the scan has always had — a literal
 * in the module body — rather than a boundary this function is pretending to
 * draw.
 *
 * ## Why a module-relative literal is RESOLVED against its writer, not stripped
 *
 * Dropping the comments turned one gate's only surviving literal into a hint
 * that could no longer match anything: `check:pm-skill-ratchet` reads
 * `new URL('../../.claude/skills/pm-dispatch/SKILL.md', import.meta.url)`, and
 * before this narrowing it matched a SKILL.md card through the copy of that
 * path written in its own header — a real input reached by way of prose, which
 * is the accident this function exists to stop relying on. The leading `../`
 * segments are the SCRIPT's depth, not part of the watched path: a
 * module-relative URL is how these scripts spell a repo path, and `hintCovers`
 * compares against repo-relative inputs.
 *
 * They used to be STRIPPED, and the strip carried an unstated premise: that the
 * writer sits at the depth its own `../` run climbs to, i.e. that the literal
 * is spelled from the repo root. That holds for `scripts/*.mjs` writing
 * `'../../packages/…'` and it FAILS for a gate that lives inside a package —
 * `packages/spec/scripts/check-x.ts` writing `'./lib/dist-freshness'` yielded
 * the hint `lib/dist-freshness`, a string that never was a repo path while the
 * file it names exists. That is a hint set stating something FALSE about the
 * source, and the residue said so out loud: `unreachableReason` printed "never
 * was a repo path" about targets that are on disk. ⚠️ That sentence is retired
 * — `unreachableReason` no longer claims a base it did not test (#14208) — so
 * it is quoted here as history and will not be found in today's output.
 *
 * So the prefix is resolved against `scriptPath`'s own directory instead
 * (`resolveModuleRelativeHint`). For a literal already spelled from the root by
 * a writer at that depth the resolve is a NO-OP — which is why this widening is
 * cheap, and the measurement in that helper's docblock is the price.
 *
 * `scriptPath` is optional and the strip is what a caller without one still
 * gets. Not every caller has a path to give (a fixture string in a self-test
 * has no writer), and a caller that has one and forgets is a missing lead
 * rather than a fabricated one — the direction this file errs in everywhere.
 * A literal that is nothing but dots (`'../..'`, this file's own ROOT) names no
 * file and is dropped outright on BOTH paths, before either runs: resolving one
 * would name the writer's own directory, which is a subtree claim no author
 * made by writing `'..'`.
 *
 * ## Why a TRAILING dot is stripped too, and why it stopped being cosmetic
 *
 * A path literal written as the last word of a sentence keeps the sentence's
 * period: `scripts/check-skill-compatibility-version.mjs` is spelled in a
 * backticked span at line 295 of its own module body — an array element, so
 * comment masking cannot reach it — and it was extracted as the hint
 * `scripts/check-skill-compatibility-version.mjs.`, with the period. No repo
 * path ends in a dot, so a hint that does names nothing.
 *
 * That was harmless while `hintCovers` compared raw string prefixes, because
 * the hint still reached the real file through `plain.startsWith(inputPath)`.
 * The segment-boundary rule below removes exactly that branch, so the two
 * changes are COUPLED and had to land together — measured on this tree, the
 * boundary rule alone takes this one live hint from covering its own file to
 * covering nothing at all:
 *
 *   raw prefix (before)         -> true
 *   segment rule, not stripped  -> false      <- the coupling
 *   segment rule, stripped      -> true
 *
 * A trailing run of dots and slashes is therefore trimmed here, at extraction,
 * where the hint is built — not at comparison time, where every caller would
 * have to remember to do it.
 */
export function extractWatchHints(scriptSource, scriptPath = null, { tree = null } = {}) {
  // The `#` mask is KIND-scoped, so it is reached through the path rather than
  // sniffed out of the bytes. A caller with no `scriptPath` therefore keeps the
  // JS-only mask over a shell source, and that direction is the one this
  // parameter fails in the OTHER way from everything else in this function: a
  // forgotten path is a missing lead for the resolve below, and a FABRICATED
  // one here. Both live callers pass it (`discoverFamilies`, twice); the
  // pathless overload is the self-test's and `declaredInheritedPopulation`'s
  // own fallback, and a shell module that declared an inherited population
  // would be held to the path-aware set that `discoverFamilies` computes.
  const moduleBody = hashCommentProgram(scriptPath)
    ? maskedHashCommentBody(scriptSource)
    : maskedModuleBody(scriptSource);
  const exclusions = exclusionDeclSpans(moduleBody);
  const hints = new Set();
  for (const m of moduleBody.matchAll(/['"`]([^'"`\n]{2,120})['"`]/g)) {
    const raw = m[1];
    if (/^(https?:|[A-Z_]+=|-{1,2}\w)/.test(raw)) continue;
    if (!/^[\w.@][\w.@/*-]*$/.test(raw)) continue;
    // A literal the scanned gate declares as EXCLUDED is not a surface it
    // watches — it is the surface it refuses to look at, and admitting it
    // states the exact inverse of the declaration. See `exclusionDeclSpans`
    // above for the identifier predicate, the tree-wide census behind it, and
    // the three shapes it deliberately does not reach.
    if (exclusions.some(([from, to]) => m.index >= from && m.index < to)) continue;
    // ADMISSION reads the literal as the AUTHOR wrote it, minus the depth
    // prefix — byte for byte the test this scan has always applied. Only the
    // VALUE is resolved, below. Widening admission to the resolved form was
    // measured on this tree and REFUSED: it admits every single-segment sibling
    // specifier (`'./invoked-as.mjs'`, `'./package.json'`) as a watched
    // population, which is a second and unpriced answer to the question
    // `firstPartyImportTargets` already owns — with the wrong provenance label,
    // `gate source` where the import channel says `gate source via <mod>`. It
    // also put a path population on two gates that DECLARE they have none. The
    // bare-single-segment refusal in `hintCovers`' docblock is the same
    // standing verdict, one class over. Re-measured at 96dc446c9 the refusal
    // still costs all three: the self-test's `--self-test`-inherits-nothing
    // case, its no-path-population case (contradicted for check:release-body
    // and check-prerelease-pin-watch.mjs), and the two pins that state the
    // refusal itself.
    //
    // ONE class is admitted back, and it is a different predicate rather than a
    // softening of that one: a single-segment literal whose resolved form is a
    // tracked DIRECTORY carrying a separator (`moduleRelativeDirectoryHint`,
    // whose docblock carries the split of the 53 hints and the judgement).
    // Nothing about the sibling module, the manifest, or the bare root moves.
    const stripped = raw.replace(/^(?:\.\.?(?:\/|$))+/, '');
    // Dots and nothing else name no file, on either path — checked before the
    // resolve so it cannot turn `'..'` into the writer's own directory.
    if (!stripped) continue;
    const looksPathy = stripped.includes('/') || /^\.(claude|changeset|github|gitattributes)\b/.test(stripped);
    if (!looksPathy) {
      // The one narrow re-admission, and it is MODULE-RELATIVE ONLY. `resolve`
      // treats a bare word exactly like a `./` one, so dropping the
      // `stripped !== raw` test here silently widens this to the bare-word class
      // one writer's directory at a time — measured on this tree at three
      // fabricated hints, the sharpest being `'fixtures'`, a member of
      // check-error-status-conformance's SKIP_DIRS set, i.e. a directory the
      // gate declares it does NOT read, admitted as `scripts/fixtures` because
      // the tree happens to have one. The hint is the RESOLVED directory, so
      // what reaches `hintCovers` is an ordinary multi-segment path and every
      // refusal below is untouched; a caller with no tree keeps the standing
      // refusal, which is a missing lead rather than a fabricated one.
      const directory =
        stripped !== raw
          ? moduleRelativeDirectoryHint(raw.replace(/[./]+$/, ''), scriptPath, tree)
          : null;
      if (!directory) continue;
      hints.add(directory);
      continue;
    }
    const trimmed = stripped.replace(/[./]+$/, '');
    if (!trimmed) continue;
    // A slash is the separator of several namespaces, and only one of them is
    // the filesystem. See `isNonPathNamespace` for what is refused and why the
    // refusal is measured rather than guessed.
    if (isNonPathNamespace(trimmed)) continue;
    // A literal the writer spelled module-relative means the file that sits
    // there RELATIVE TO THE WRITER; one spelled from the root already is what
    // it claims to be. A caller with no `scriptPath` keeps the strip.
    if (stripped !== raw && scriptPath) {
      const resolved = resolveModuleRelativeHint(raw.replace(/[./]+$/, ''), scriptPath);
      if (!resolved) continue; // escapes the repo, or names the root itself
      hints.add(resolved);
      continue;
    }
    hints.add(trimmed);
  }
  return anchorAtPackageRoot(hints, scriptPath, moduleBody, tree);
}

/**
 * The THIRD anchor, applied to a finished hint set (#14208).
 *
 * It runs LAST and over the assembled set rather than inside the admission
 * loop, because it is a re-reading of hints and not a second admission rule:
 * everything it can touch is already a hint, so the loop above keeps being the
 * one place that decides what a hint IS.
 *
 * The order of the returned list is preserved to the byte for every hint it
 * does not touch, and a re-anchored hint keeps its ORIGINAL POSITION rather
 * than moving to the end. `discoverFamilies` puts a gate's own hints at the
 * front so an already-matched path keeps the exact key and via label it had,
 * and `residueNames` prints the first three — a rule that reshuffled the list
 * would move rows in output that nothing in this change is entitled to move.
 *
 * The two cheap refusals come first, so the corpus is materialised and the
 * source is parsed for bindings ONLY for a script that has both a dead-at-root
 * hint and something to re-anchor it to. Over the live fleet that is 2 scripts
 * of 201 families' worth of files.
 */
function anchorAtPackageRoot(hints, scriptPath, moduleBody, tree) {
  const spelled = [...hints];
  if (!scriptPath || !tree) return spelled;
  const orphans = spelled.filter((h) => deepestTrackedPrefix(h, tree.prefixes) === '');
  if (orphans.length === 0) return spelled;
  const base = packageRootBinding(scriptPath, moduleBody, tree);
  if (!base) return spelled;
  const files = [...tree.files];
  const anchored = new Map();
  for (const h of orphans) {
    const at = packageRootAnchoredHint(h, base, tree, files);
    if (at) anchored.set(h, at);
  }
  if (anchored.size === 0) return spelled;
  const out = [];
  const seen = new Set();
  for (const h of spelled) {
    const v = anchored.get(h) ?? h;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * The FIRST-PARTY MODULES a gate script IMPORTS, resolved one level down: the
 * relative specifiers that land inside the repo's own scripts/ tree (#11190).
 *
 * ## The blind spot this closes
 *
 * resolveCheckToFiles reads a family's script paths out of the npm script's
 * COMMAND STRING, and discoverFamilies scanned exactly those files. A module a
 * gate IMPORTS was never opened, so a population declaration MOVED out of a
 * gate and into a shared module stopped contributing hints to every gate that
 * imports it — the tidy-up that centralises a declaration DELETED it, with
 * every gate still green and nothing in the output saying so. That was pinned
 * here as an invariant rather than left as prose; it is pinned in its widened
 * form now (search the self-test for the first-party import section), and
 * closing it is what unblocks consolidating the fifteen private
 * pnpm-workspace.yaml parsers behind one enumerator.
 *
 * ## What it costs, measured (the deliverable, not the code)
 *
 * Over 140 discovered families x 6460 tracked files, on this tree:
 *
 *   watch-hint (gate, file) pairs   51848 -> 52741   (+893, and ZERO lost)
 *   families gaining coverage       6
 *   existing matches re-attributed  0 — imported hints are appended AFTER
 *                                   every own hint, so a path already matched
 *                                   keeps the exact key and via label it had
 *
 * For scale, hintCovers' docblock prices the bare-top-level-word admission it
 * refuses at +139084 pairs on the same corpus. This widening is 0.6% of that.
 *
 * The six: check:i18n and check:i18n-coverage (+285 each, through
 * cli-build-prerequisite.mjs, which declares the CLI build both gates require),
 * check:merge-driver (+264, through regen-artifacts.mjs, which declares the
 * artifacts the driver regenerates — the specimen this whole change is for),
 * check:adr-anchors (+53, through adr-anchors.mjs), check:slot-lookup and
 * check:query-options-erasure (+3 each, through the two eslint helpers).
 *
 * ## Every narrowing below is a measurement, not a preference
 *
 * ONE LEVEL, as dispatched. Not a compromise on this tree: re-run at depth 2
 * and depth 3 the sweep adds exactly ZERO further pairs, because every module
 * reached from a followed module (invoked-as.mjs, js-comment-mask.mjs,
 * ts-parse.mjs) declares no path literals at all. One level is the mandate AND
 * the measured fixpoint; if a future helper chain makes depth 2 pay, that is a
 * measurement to bring back, not a widening to assume.
 *
 * RELATIVE specifiers only. A bare specifier is a package: it resolves through
 * node_modules (workspace links included), and an installed dependency is not
 * a repo source input — the same boundary check:cross-package-test-inputs
 * draws for test reads, for the same reason (no glob in this repo can name it).
 *
 * INSIDE scripts/ only, which is what makes the specifier first-party rather
 * than merely relative. Live specimen for the refusal: check:slot-lookup and
 * check:query-options-erasure both import ../eslint.config.mjs, whose globs
 * describe what the LINT reads, not what either ratchet reads. Admitting the
 * class costs +2517 pairs on top of the +893, measured, to hand two gates a
 * population neither one opens. Measured cost of the refusal today: zero — the
 * only two family scripts outside scripts/ (packages/lint/scripts/*.mjs) carry
 * no relative first-party import at all.
 *
 * STATIC declarations only — import/export ... from, and the side-effect
 * import form. A dynamic import() is a load edge too, and admitting it was
 * measured: +0 pairs, because both live dynamic edges (check-governed-prose ->
 * check-governed-merges, check-governed-merges -> check-audit-scope) point at
 * modules the next rule excludes anyway. It also costs precision that is not
 * hypothetical — a module body carrying import of a ../<rel> placeholder, or
 * of a ./local.js that documentation invents, resolves to nothing today only
 * because the existence check below catches it. Zero gain, real hazard, so
 * the class stays out.
 *
 * NEVER a module that is ITSELF a discovered gate file, and this is the one
 * narrowing that changes the number. Without it the sweep reads +4907 rather
 * than +893, and 3660 of the extra 4014 pairs are two families importing one
 * module — scripts/check-cross-package-test-inputs.mjs, whose module body
 * carries the CROSS_PACKAGE_TEST_INPUTS declaration table. What
 * check:examples-live-imports imports from it is globToRegExp, a string
 * utility; the gate reads examples/. It would have inherited that table's
 * packages-wide globs — 3065 pairs of population it never opens, a fabricated
 * lead in the column a dispatch prompt pastes. That is the trade this file
 * refuses on provenance rather than on volume (#9964 refused an admission
 * worth 17 pairs because 8 of them were fabricated). The refusal costs recall
 * in one direction and that is worth naming: where an importer really does
 * read the imported gate's population (check-ci-filter-parity.mjs imports
 * CROSS_PACKAGE_TEST_INPUTS itself, +595 pairs), the lead is now missing, and
 * a missing lead costs one card one CI round — the side this file's header
 * errs on everywhere. The card is not blind either way: the imported gate's
 * OWN family already matches those paths, because it is discovered too.
 *
 * A hint from a followed module is a different CLAIM from one the gate spells
 * itself, so it does not travel unlabelled: entry.hintOrigin records which
 * module contributed it and coveringKey prints that in the via column.
 *
 * ## What the follow does NOT decide (#17991)
 *
 * Which modules a gate REACHES and what it INHERITS from one are two questions,
 * and the refusals above answer only the first. The second is answered per
 * CALLER, by `importBindsNoPopulation`, off the binding that
 * `firstPartyImportBindings` carries beside each target: an importer that binds
 * only a value constant reaches none of the module's reads and inherits
 * nothing, and every other shape inherits exactly what it did. One resolver,
 * two readings of it — the edge set below is unchanged to the byte.
 */
const IMPORT_FROM_SPECIFIER = /(?:^|[;\n])[ \t]*(import|export)\b([^;]*?)\bfrom[ \t]*(['"])([^'"\n]+)\3/g;
const SIDE_EFFECT_IMPORT = /(?:^|[;\n])[ \t]*import[ \t]*(['"])([^'"\n]+)\1/g;
const NAMED_BINDING_LIST = /\{([^}]*)\}/;
const BINDING_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * What ONE import clause BINDS — the exported names it names, or `whole` when
 * the clause reaches the module's every export and there is no name list to
 * read. Every shape this reading cannot resolve to a name list answers `whole`,
 * which is the inheriting direction and therefore today's behaviour: a rule
 * that narrowed on a clause it could not parse would drop leads by accident
 * rather than by measurement.
 *
 * `whole` for: the namespace form (the module object reaches every export), a
 * default binding (a name this module never declares under), the side-effect
 * form (nothing is bound), a re-export (it republishes names rather than
 * reading them, and nothing here can tell whether the re-exporter's own callers
 * open the population), and any braced list carrying something that is not an
 * identifier.
 */
function clauseBinding(keyword, clause) {
  if (keyword !== 'import') return { names: [], whole: true };
  const text = String(clause ?? '');
  if (text.includes('*')) return { names: [], whole: true };
  const braced = NAMED_BINDING_LIST.exec(text);
  const outside = (braced ? text.slice(0, text.indexOf('{')) : text).replace(/,/g, '').trim();
  if (outside.length > 0) return { names: [], whole: true };
  if (!braced) return { names: [], whole: true };
  const names = [];
  for (const part of braced[1].split(',')) {
    const name = part.trim().split(/[ \t\n]+as[ \t\n]+/)[0].trim();
    if (name === '') continue;
    if (!BINDING_IDENTIFIER.test(name)) return { names: [], whole: true };
    if (!names.includes(name)) names.push(name);
  }
  return names.length > 0 ? { names, whole: false } : { names: [], whole: true };
}

/**
 * The same resolution as `firstPartyImportTargets` below, carrying the one
 * thing that function drops: WHAT the importer binds from each module it
 * reaches. Returned as a Map in the same sorted order the targets list has, so
 * a caller iterating this Map builds its follow set in the byte-identical order
 * it built before this seam existed.
 *
 * Two different specifiers can resolve to one module (`./x.mjs` from here and
 * `../pm/x.mjs` from a sibling directory), and one file can import a module
 * twice; the bindings are UNIONED, so a module bound by name in one clause and
 * wholly in another answers `whole`.
 */
export function firstPartyImportBindings(scriptPath, source, { root = ROOT } = {}) {
  // The same masking hint extraction uses, for the same reason: an import
  // written out in a docblock, or one inside a self-test fixture, is a
  // specifier this script NAMES rather than one it loads.
  const body = maskedModuleBody(String(source));
  const specifiers = new Map();
  const bind = (specifier, binding) => {
    const prior = specifiers.get(specifier);
    if (!prior) {
      specifiers.set(specifier, { names: [...binding.names], whole: binding.whole });
      return;
    }
    prior.whole = prior.whole || binding.whole;
    for (const name of binding.names) if (!prior.names.includes(name)) prior.names.push(name);
  };
  for (const m of body.matchAll(IMPORT_FROM_SPECIFIER)) bind(m[4], clauseBinding(m[1], m[2]));
  for (const m of body.matchAll(SIDE_EFFECT_IMPORT)) bind(m[2], { names: [], whole: true });
  const here = nodePath.dirname(nodePath.join(root, scriptPath));
  const targets = new Map();
  for (const [specifier, binding] of specifiers) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    const rel = nodePath.relative(root, nodePath.resolve(here, specifier));
    // One test, three refusals: a path that escapes the repo, one that lands
    // at the root, and one in any other tree all fail to start with scripts/.
    if (!rel.startsWith('scripts/')) continue;
    if (rel.split('/').includes('node_modules')) continue;
    const abs = nodePath.join(root, rel);
    // A specifier that resolves to nothing is a specifier, not a module: the
    // extension-less spellings ESM does not resolve, and the ../<rel> shapes a
    // module body carries as illustration, both land here.
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    const prior = targets.get(rel);
    if (!prior) {
      targets.set(rel, { names: [...binding.names], whole: binding.whole });
      continue;
    }
    prior.whole = prior.whole || binding.whole;
    for (const name of binding.names) if (!prior.names.includes(name)) prior.names.push(name);
  }
  // Sorted with the default string comparison the targets list has always used,
  // never a locale-aware one: the follow order decides which module a shared
  // hint is attributed to, and a re-ordering would move rows in output.
  return new Map([...targets].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function firstPartyImportTargets(scriptPath, source, { root = ROOT } = {}) {
  return [...firstPartyImportBindings(scriptPath, source, { root }).keys()];
}

/**
 * The exporter half of the binding rule: is NAME declared in this module as a
 * VALUE — a `const` initialised to one primitive literal?
 *
 * Returns `{ literal }` — the string's own text when the value is a quoted
 * string, and `null` for a number, a boolean or `null` — or `null` for every
 * other declaration, which is the answer that inherits.
 *
 * ## Why this recogniser is deliberately this narrow
 *
 * It is read in ONE direction only: a positive answer REMOVES leads, so every
 * shape it cannot read has to answer negative. It therefore requires the whole
 * initialiser on the declaration's own line and refuses escapes and template
 * literals rather than parsing them — an array, an object, a function, a class,
 * a computed initialiser, a multi-line one, a re-exported binding and a name
 * this module does not declare at all are all "not a value", and a module whose
 * export surface this reading cannot see contributes exactly what it
 * contributed before.
 *
 * The module body is masked first, for the reason every reader in this file
 * masks: a declaration written out in a docblock, or built inside a self-test
 * fixture, is a declaration this module NAMES rather than one it exports.
 */
export function exportedValueConstant(moduleSource, name) {
  if (typeof name !== 'string' || !BINDING_IDENTIFIER.test(name)) return null;
  const body = maskedModuleBody(String(moduleSource));
  const declaration = new RegExp(`(?:^|\\n)[ \\t]*export[ \\t]+const[ \\t]+${name}[ \\t]*=[ \\t]*([^\\n]*)$`, 'm');
  const m = declaration.exec(body);
  if (!m) return null;
  const initialiser = m[1].trim();
  const quoted = /^('[^'\\\n]*'|"[^"\\\n]*")[ \t]*;[ \t]*$/.exec(initialiser);
  if (quoted) return { literal: quoted[1].slice(1, -1) };
  if (/^(?:-?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|true|false|null)[ \t]*;[ \t]*$/.test(initialiser)) {
    return { literal: null };
  }
  return null;
}

/**
 * Does this import bind NOTHING that can carry the followed module's
 * population? (#17991)
 *
 * `declaredInheritedPopulation` is keyed on the MODULE, and whether a
 * contribution is fabricated is a property of the CALLER — so one module cannot
 * serve two importers when one of them reads its population table and the other
 * takes a single constant out of it. This is the per-caller half, and it asks
 * the one question the derivation can SEE without a path map: what did the
 * importer BIND?
 *
 * A value carries no behaviour and no table. A caller that binds only value
 * constants reaches none of the module's reads however the module is written,
 * so every pair the module would contribute to it is a fabricated lead in the
 * column a dispatch prompt pastes. Everything else — a function, a class, a
 * declaration table, a namespace, a default, a re-export — keeps today's
 * inheritance: the follow exists because a population MOVED into a shared
 * module must not stop being declared, and a population moves into exactly
 * those shapes.
 *
 * ⭐ One value is NOT inert: a string constant whose own text is one of the
 * paths the module contributes IS a one-path population, and binding it is
 * reading it. Measured on this tree, the shape is live — `scripts/adr-anchors.mjs`
 * exports its anchor directory as a bare string constant — so the exception is
 * a specimen, not a hypothetical.
 *
 * Live cost of the whole rule, measured over the 52 import edges this tree
 * follows: ONE edge answers true, and it is the card's —
 * `scripts/pm/check-clause2-carriers.mjs` binding `CONTRACT_REVIEW_TIER` out of
 * this file and inheriting the workflow directory it never opens. Every other
 * edge binds a function or a table and is untouched, which is the measurement
 * that says this rule narrows the fabrication and not the follow.
 */
export function importBindsNoPopulation(binding, moduleSource, population = []) {
  if (!binding || binding.whole) return false;
  const names = binding.names ?? [];
  if (names.length === 0) return false;
  const paths = new Set(population ?? []);
  return names.every((name) => {
    const value = exportedValueConstant(moduleSource, name);
    if (!value) return false;
    return value.literal === null || !paths.has(value.literal);
  });
}

/**
 * Render an invocation a dev can paste and run, from the same parse the
 * workflow line produced. The script NAME alone is not runnable for a
 * package-scoped check: `check:doc-formula-expressions` lives in
 * `@objectstack/lint`, not in the root `package.json`, so a dev who searched
 * the obvious place found nothing and concluded the gate did not exist — twice,
 * in independent sessions, within one hour (#7440, PR #7416 / #7417). The
 * `--filter` package is the one piece of provenance this tool parsed and then
 * dropped, and it is the piece needed to run the thing.
 */
export function runnableInvocation({ check, filter, direct, localCheck = null }) {
  // `localCheck` is the (#15441) repair and it is the ONLY place the two
  // spellings diverge: the key stays the invocation CI runs, and what a dev
  // pastes is that invocation with the script's own declared default in the
  // value position. Absent on every other family, where the two are one string.
  if (direct) return `node ${localCheck ?? check}`; // already a script path, never a pnpm script
  if (filter) return `pnpm --filter ${filter} run ${check}`;
  return `pnpm ${check}`;
}

/**
 * Does this invocation run ONLY the checker's own `--self-test`?
 *
 * ## The defect (#16030)
 *
 * The artifact-roster block tells its reader to run its rows. Two of them
 * resolve to a `--self-test` invocation and nothing else, because the half
 * that judges a pull request needs the `pull_request` event payload and runs
 * in its own workflow. Their green is a statement about the checker's own
 * fixtures: it cannot fail for anything in the diff. Printed in the same
 * shape and the same list as rows whose green does grade the diff, it is the
 * failure class this repo keeps re-deriving -- a reading that CANNOT fail is
 * indistinguishable from one that passed. The repair principle is the card's
 * own: name the axis your control discriminates on, and check that it is the
 * axis that can fail.
 *
 * ## Why the card's own discriminator is NOT the one implemented here
 *
 * The card names the discriminator as "the echoed command ends in
 * `--self-test`". Measured over the 39 roster rows on this tree, that reading
 * selects five of them and MISSES BOTH ROWS IT WAS FILED FOR: those two are
 * pnpm-spelled, so the flag lives in the manifest entry that defines the name
 * and never in the bytes the block prints. A control read off the printed
 * bytes alone would have discriminated on an axis that cannot fail for the
 * population it exists for -- the same defect, one level up. So the row's
 * invocation is resolved one hop through the manifest that DEFINES it, and
 * this predicate is applied to the command body that actually runs.
 *
 * ## EVERY segment, never `some` and never a match on the whole string
 *
 * The conventional shape in this repo names its script twice
 * (`node x.mjs --self-test && node x.mjs`), and that IS a PR-judging row: the
 * second segment does the work. A `some`, or a test against the undivided
 * string, would classify the conventional shape as checker-health and suppress
 * a row a dev owes -- a false negative in the direction that reads as less
 * work. Measured on this tree: 7 checker-health, 32 PR-judging, 0 unresolved.
 */
export function selfTestOnlyInvocation(body) {
  if (typeof body !== 'string') return false;
  const segments = body.split(/&&|\|\||;/).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => /(?:^|\s)--self-test(?:\s|$)/.test(segment));
}

/**
 * The axis one artifact-roster row is classified on: `true` when running the
 * row grades only the checker's own fixtures, `false` when running it grades
 * the diff, and `null` when this derivation cannot resolve the invocation and
 * may therefore assert NEITHER.
 *
 * ⛔ The third answer is not a hedge and it is deliberately not folded into
 * `false`. A row this tool could not resolve, filed silently among the rows
 * that judge, is the very defect the classification exists to close; so it is
 * named in the block as unresolved and left to the reader. Zero members on
 * this tree, which is the state that has to stay LOUD rather than become
 * invisible the day it stops being empty.
 *
 * The two carriers are read where the flag actually lives, never one of them
 * for both: a direct row IS its invocation, so the rendered command is the
 * body; a pnpm-spelled row is a NAME, and the body is the manifest entry
 * `discoverFamilies` already read for it -- the same manifest, from the same
 * read, for the reason `ciOnlyMeasurement` states about `rootScripts`.
 */
export function rosterCheckerHealth(entry, command) {
  if (entry?.direct) return selfTestOnlyInvocation(command);
  if (typeof entry?.manifestCommand !== 'string') return null;
  return selfTestOnlyInvocation(entry.manifestCommand);
}

// ---------------------------------------------------------------------------
// The seam between this tool and its caller (#13462)
// ---------------------------------------------------------------------------

/**
 * The spelling distribution of a rendered block, counted from the text a
 * harvest actually sees.
 *
 * ## The hazard, measured rather than supposed
 *
 * The matched block renders in TWO spellings, because lint.yml invokes many
 * gates directly rather than through an alias. That idiom is deliberate and
 * correct and is NOT the defect, and discovery is not lossy across the two
 * either: measured at 57827b617, all 39 direct-form gate scripts in lint.yml
 * are discovered by this derivation. The loss happens one step DOWNSTREAM of
 * discovery, in whatever the consumer does with the printed block:
 *
 *     node scripts/pm/dispatch-gates.mjs scripts/measure-durability-swallow-family.mjs
 *     total rows: 12   ·   pnpm-spelled: 8   ·   direct-node-spelled: 4
 *
 * A consumer that greps one spelling out of that block takes 8 of the 12 and is
 * told nothing. The four it drops are real gates, CI runs them anyway, and
 * every command in the SHORT list passes — so the contributor reports "all
 * matched families green" in good faith. One third, silently, in the direction
 * that looks safe. The tool is right and the idiom is right; the seam between
 * them is where the list gets truncated.
 *
 * ## Why the COUNT is not the control, and the SPLIT is
 *
 * Measured on that same run: a consumer greping `pnpm check:` over the WHOLE
 * output rather than over the block gets 12 rows — the right COUNT and the
 * wrong twelve. It drops all four direct rows and backfills with three families
 * from the pending-changeset section (which do not apply yet) and one from the
 * unreachable section (which is dead). A footer printing `12 families` would
 * have signed that harvest off. The DISTRIBUTION discriminates where the count
 * cannot: that harvest is 12 pnpm and 0 direct, and the footer says 8 and 4.
 *
 * ## Read from the RENDERED command, not from `entry.direct`
 *
 * The hazard is about what a consumer greps out of the output, so the footer
 * has to describe the printed bytes. Reading the flag instead would let the two
 * disagree the day the renderer grows a third shape — and `other` below counts
 * that third shape rather than folding it into either side, because the gate
 * corpus already runs steps under `bash` and `python3`. A footer that hardcoded
 * "pnpm or node" would answer a question about a spelling it cannot see with a
 * confident zero, which is this same failure one class up.
 */
export function spellingSplit(commands) {
  const split = { total: 0, pnpm: 0, node: 0, other: 0, otherCommands: [] };
  for (const command of commands) {
    split.total += 1;
    if (/^pnpm\s/.test(command)) split.pnpm += 1;
    else if (/^node\s/.test(command)) split.node += 1;
    else {
      split.other += 1;
      split.otherCommands.push(command);
    }
  }
  return split;
}

/**
 * The transitional harvest, PUBLISHED — and published only as a transition.
 *
 * This is the correct harvest of the human block: it takes the WHOLE matched
 * block and strips only the trailing annotation, so it cannot drop a spelling.
 * It was already correct and already in use, as ONE agent's private discipline
 * — stated once in a PR body, enforced by nothing, and written down nowhere
 * this repo could reach. A rule that lives only in an operator's head protects
 * only that operator. It is published here so a consumer holding captured text
 * has the correct form in the tool's OWN output; `--commands` makes it
 * unnecessary, and `--commands` is the fix.
 *
 * It is also strictly weaker than `--commands`, which is the honest reason not
 * to stop here: it reads the matched block alone, so it drops the
 * convention-triggered gates printed under their own heading below it.
 *
 * Both lines contain spaces, so `extractWatchHints`' admission test rejects
 * them whole and this file grows no hint from publishing them — the property
 * DEFAULT_BASE_REF buys by assembly, bought here by the syntax. The self-test
 * pins that rather than trusting this reading.
 */
export const HARVEST_SNIPPET = [
  "awk '/^Local gates for this card/{f=1;next} /^$/{if(f)exit} f' gates.txt \\",
  "  | sed -E 's/^  - (.*)   \\[.*$/\\1/'",
];

/**
 * The footer, and the blank line above it is load-bearing.
 *
 * The published snippet ends the block at the first EMPTY line after it. A
 * footer appended with no blank line between would be swallowed INTO that
 * harvest and read as several more "commands" — the remedy breaking the very
 * transition it exists to cover. `derive` prints the separator, and the
 * self-test drives the real snippet over the real rendering and pins that it
 * still yields exactly the matched commands and nothing else.
 *
 * Both terms print at zero, always. The control that answers is whether this
 * footer HARDCODES "there is always a direct form": on a pure-pnpm card it has
 * to say `0 direct node` rather than fall silent on the term it cannot see.
 * The ⛔ line, by contrast, is conditional — on a card with no direct row a
 * one-spelling grep really does lose nothing, and a warning that fires anyway
 * would be training the reader on a claim this run just measured as false.
 *
 * ## Why the heading says `matched families` and not `families` (#13642)
 *
 * This footer counts the MATCHED block and nothing else, and for a long time it
 * opened with a bare `N families` — a SUBTOTAL spelled in the vocabulary of a
 * total, printed immediately under the rows a consumer harvests. That is the
 * shape #13642 was filed on. Measured on this tree at 24b66352, for the card
 * `packages/spec/src/foo.test.ts`: the matched block prints 40 rows, this
 * footer said `40 families`, and the card's real runnable answer is 44. A
 * reader who harvested the block, counted 40 and read the footer got a
 * reconciliation that AGREED — on the wrong list. Both the incidents on that
 * card lost the convention block specifically, and this line is the number they
 * would have checked against.
 *
 * The count is not wrong; its SCOPE was unsaid. Naming the scope costs nothing
 * a consumer had, and it makes the total below the only line in the human
 * rendering that claims to be a total. See `familyReconciliation` for that
 * total and for the arithmetic tying it back to these rows.
 *
 * `recon` is optional and the whole forward-pointer is conditional on
 * `conventionOnly > 0`, for the reason the ⛔ line above is conditional: on a
 * card whose convention block is empty, a warning that this block is a part of
 * the answer would be training the reader on a claim this run measured as
 * false. It is passed IN rather than recomputed so the footer and the
 * reconciliation cannot disagree about how many families sit outside this
 * block — one structure, two renderings, which is the rule the rest of this
 * file's output already follows.
 */
export function spellingFooterLines(split, recon = null) {
  if (split.total === 0) return [];
  const parts = [`${split.pnpm} pnpm`, `${split.node} direct node`];
  if (split.other > 0) parts.push(`${split.other} neither (${split.otherCommands.join(', ')})`);
  const lines = [`${split.total} matched families — ${parts.join(', ')}.`];
  if (split.pnpm < split.total) {
    lines.push(
      `  ⛔ Two spellings, deliberately (the GATE INVOCATION IDIOM in lint.yml). A harvest that greps 'pnpm check:' out of` +
        ` the block above takes ${split.pnpm} of the ${split.total} and reports nothing missing.`,
    );
  }
  lines.push(
    '  ⇒ Harvest with --commands (one runnable command per line, nothing else on stdout) or --json. Neither can drop a spelling.',
    '  Holding captured text already? This form takes the whole block and strips only the annotation:',
    ...HARVEST_SNIPPET.map((line) => `      ${line}`),
  );
  if (recon && recon.conventionOnly > 0) {
    lines.push(
      `  ⛔ ...and a harvest of this block is ${split.total} of the ${recon.total} this card owes, whichever spelling it takes:` +
        ` ${recon.conventionOnly} more famil(ies) are named by change KIND and print under their own heading below,` +
        ' outside every harvest of THIS block — the published snippet above included.',
      `    The Reconciliation line under that heading carries the ${recon.total}. Assert your list against THAT number, never against this one.`,
    );
  }
  return lines;
}

/**
 * Does a watch hint cover an input path? Containment either way, compared on
 * PATH SEGMENT boundaries, with globs collapsed. A hint that names a bare
 * top-level directory (`packages`, `scripts` — a WORD, with no separator
 * anywhere in it, and not a dotted dir) is rejected as too generic: it would
 * match every file under the tree's biggest directories and drown the signal
 * the matched-via column exists to carry.
 *
 * ## Why the refusal reads the hint AS WRITTEN, not the collapsed copy (#9626)
 *
 * That refusal used to be applied to `plain` — the hint AFTER globs were
 * collapsed and trailing separators stripped. Collapsing is lossy in exactly
 * the way the refusal is deciding on: `content/**` and `skills/**` collapse to
 * `content` and `skills`, so a gate that declared a whole SUBTREE as its
 * population was refused as though it had written a bare word. The two are not
 * the same claim. A bare `packages` is a path component a script joins with
 * something else; `packages/**` is an author stating what the gate reads, in
 * the syntax the repo uses for exactly that everywhere else (`paths:` filters,
 * turbo inputs, the `files` field).
 *
 * The blind spot was total for the class and it hid REQUIRED coverage. Measured
 * on this tree, three live hints collapse to a bare root, and all three are
 * genuine population declarations that reached nothing at all:
 *
 *   `scripts/**`, `content/**`  check-cross-package-test-inputs' declaration
 *                               table, whose own header calls its entries "the
 *                               repo-relative globs they really read"
 *   `skills/**`                 check-governed-merges' GOVERNED_SURFACES row
 *                               for the published skills catalog
 *
 * `check:doc-anchors` was the specimen that surfaced it: it spelled its root
 * `'content'`, contributed no hint at all, and so scored `silent` for every
 * card under `content/**` — while being the ONLY fragment coverage this repo
 * has (`check-links.yml` sets `include_fragments = "none"`, and says so).
 *
 * Reading the hint as written closes the class without widening the scan.
 * Measured over 107 discovered families against all 6181 tracked files:
 *
 *   watch-hint (gate, file) pairs   19024 -> 19834   (+810, and ZERO lost)
 *   families gaining coverage       3, via those three hints and nothing else
 *
 * The alternative — teaching `extractWatchHints` to accept a bare single-segment
 * literal that happens to name a real top-level directory — was measured on the
 * same corpus and REFUSED: it takes those pairs to 158108 (+139084), because
 * `packages`, `apps`, `examples` and `package.json` are path COMPONENTS in
 * dozens of gates that never read the root. One card
 * (`packages/spec/src/index.ts`) goes from 7 matched families to 34. That is
 * the "22 leads is the same as none" failure in the header, bought wholesale.
 *
 * What stays out of reach, deliberately: a top-level FILE named as a bare
 * LITERAL (`README.md`). A bare filename carries no separator either, and
 * accepting one would admit every `package.json` / `turbo.json` /
 * `tsconfig.json` basename a gate joins with a package directory — the same
 * explosion, one class over. A miss there costs one card one CI round; that is
 * the side this file errs on. What is refused is the literal, never the file:
 * a gate whose population really is a root file reaches it through the escape
 * hatch below, and several now do.
 *
 * Re-measured (#9964) on 114 families x 6326 tracked files, narrowing that
 * admission to bare `*.md` literals naming a real tracked root file makes the
 * VOLUME trivial — 26060 pairs to 26077 — and it still fails, on PROVENANCE:
 * 8 of those 17 new pairs are fabricated, because `README.md` / `CHANGELOG.md`
 * are exactly the basenames gates join with a package directory (a manifest
 * `files` entry, a per-package markdown exclusion, a remote directory listing).
 * A README.md card would come back with six leads of which five name a gate
 * that never reads that file. Volume was never the whole criterion; the header
 * above prices a fabricated lead, not a big number.
 *
 * So the class stays out, and a gate whose population genuinely IS a repo-root
 * file reaches it by DECLARING the subtree spelling — `AGENTS.md/**`, which the
 * collapse above reduces to that one path and to nothing else. One gate pays
 * for its own precision instead of every gate paying for one gate's. The pm
 * line ratchet is the worked instance; its own header carries the reasoning.
 *
 * ## Why a segment boundary and not a raw string prefix (#8534)
 *
 * A path prefix is not a string prefix. Compared raw, a hint naming one entry
 * claims every SIBLING whose name merely starts with the same characters, and
 * the MATCHED column is what a dispatch prompt pastes — a fabricated lead there
 * is indistinguishable from a real one to the dev who runs it.
 *
 * This was filed as dormant, on a census of 324 hints against 73 PACKAGE
 * directories that found no live false coverage. Re-measured here against every
 * tracked file rather than package directories only — 354 live hints × 5940
 * tracked files — it is not dormant, and one answer changes:
 *
 *   hint 'content/docs' vs 'content/docs.site.json'  raw=true  segment=false
 *       <- check:role-word, check:docs-audit-scope
 *
 * `content/docs.site.json` was a real file sitting beside the `content/docs`
 * directory, and neither gate read it. So both were printed as MATCHED for any
 * card touching that file. The sibling class was always live; the earlier census
 * probed directories, and that specimen was a file. (The file itself was deleted
 * as dead config in #12489 — the measurement above stands as the record of why
 * this narrowing exists, and the self-test's live specimen moved to
 * `packages/spec/authorable-surface` + `.base.json`.)
 *
 * The neighbouring predicate already draws this boundary and has a pinned case
 * for it (`isInI18nBundlePackage`: `path === dir || path.startsWith(dir + '/')`).
 * This is the one place in the file that did not.
 *
 * ## The collapsed-glob reach trade — DECIDED, not assumed
 *
 * Globs are collapsed by deletion, so `packages/client*` becomes
 * `packages/client`. As a glob it would legitimately match a sibling package
 * `packages/client-react`; under the segment rule it no longer reaches it. That
 * trade was decided to REFUSE the reach, on three grounds:
 *
 *   - measured need: exactly two live hints carry a partial-segment glob, and
 *     both are npm package specifiers rather than repo paths (`@objectstack/
 *     spec@*` from check:release-page-status, `@fx/spec*` from
 *     check:type-source-resolution). No repo path begins with `@`, so both are
 *     inert either way. The capability this trade would protect has zero live
 *     instances — a `packages/client*` hint is hypothetical, not a thing the
 *     tree has;
 *   - one rule, not two: preserving glob reach means re-deriving, at comparison
 *     time, information the collapse deliberately destroys — a second matching
 *     mode keyed on syntax that is already gone by the time this function runs;
 *   - the error directions are not symmetric, and this file's contract picks a
 *     side everywhere else: refusing costs a MISSING lead (one card, one CI
 *     round), preserving costs a FABRICATED lead (pasted into every prompt whose
 *     surface brushes it). Refusal errs in the direction the header calls the
 *     safe one.
 *
 * Both directions of the trade are pinned in the self-test, so a future reader
 * finds the decision as an assertion rather than as this paragraph. If a real
 * `packages/client*`-shaped hint ever appears and the reach is genuinely wanted,
 * the answer is to spell the hint as the two paths it means, not to widen this
 * comparison back into a string prefix.
 */
/**
 * A hint with its globs collapsed and its trailing separators dropped — the
 * form `hintCovers` compares against for every hint whose globs are TRAILING,
 * extracted so the reachability sweep can describe a dead hint in the SAME
 * terms the comparison judged it by. The transformation is carried verbatim
 * from where it was written inline; a second, separately-maintained copy of it
 * is exactly the drift this file refuses everywhere else.
 *
 * One strip, not two. The trailing-separator cleanup used to be written
 * `.replace(/\/+$/, '').replace(/\/$/, '')`, and the second call was
 * unreachable: `/\/+$/` is greedy and anchored, so after it runs no trailing
 * separator survives for the second to find. Measured over all 754 distinct
 * hints in the fleet — and over every probe string the shape admits (`a///`,
 * `a/`, `a//`, `a/**\/`, `**\/`, `/`) — it changed the answer for zero of them.
 * Deleted here rather than left as decoration, because a redundant strip reads
 * as defence against a case the first one misses and there is no such case:
 * what the anchored strips genuinely cannot touch is a separator left in the
 * MIDDLE, which is the defect the branch below fixes rather than one more
 * trailing pass would.
 */
export function collapseHint(hint) {
  return hint.replace(/\*\*?/g, '').replace(/\/+$/, '');
}

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
 * not a sibling, not the generator, not the package manifest.
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

/**
 * The declared committed sources a collapsed hint reaches because it names a
 * `GENERATED_MODULE_SOURCES` module — by its full path, or as its module
 * specifier with the extension dropped — or `null` for every other hint.
 */
export function generatedModuleSources(plain) {
  for (const row of GENERATED_MODULE_SOURCES) {
    if (plain === row.module || MODULE_SPECIFIER_EXTENSIONS.some((ext) => plain + ext === row.module)) return row.sources;
  }
  return null;
}

/**
 * ## A glob in a NON-FINAL segment is not collapsible, and must not be collapsed
 *
 * Collapse-by-deletion is sound for a glob in the LAST segment, which is every
 * shape the idioms above use: `packages/**` → `packages`, `packages/spec/src/**`
 * → `packages/spec/src`, `packages/client*` → `packages/client`. Each names a
 * subtree root the tree really has, and `ROOT_DIR_WATCH_HINTS` depends on
 * exactly that reduction (`scripts/check-published-files.mjs` declares
 * the workspace globs VERBATIM so "the glob collapse reduces each back to the
 * root it names", justified there at 91.3%).
 *
 * A glob in a non-final segment is the one case where deletion does not reduce
 * — it MANGLES. `skills/*\/references/_index.md` collapses to
 * `skills//references/_index.md`, a double separator no tree can hold, so the
 * hint matches nothing BY CONSTRUCTION while looking like an ordinary literal.
 * `check:skill-refs` was the live specimen: `packages/spec/scripts/
 * build-skill-references.ts` generates nine `_index.md` files, `git ls-files
 * 'skills/*\/references/_index.md'` returns those nine, and the derivation
 * reached zero of them.
 *
 * It also produced the worst row this output can print. `unreachableClass`
 * calls a family "THE LAYOUT MOVED … a real miss, worth triaging" when a dead
 * hint's `deepest` differs from its collapsed form, and the mangled form makes
 * that true for a gate whose layout did not move at all — with the three
 * "reasons" printed beside it drawn from OTHER inert hints, TypeScript
 * `paths`-mapped module specifiers that were never repo paths. Both halves of
 * the row were wrong: the classification and its evidence.
 *
 * No spelling of `collapseHint` can fix this, which is why the branch is here
 * rather than there, and the impossibility is structural rather than a matter
 * of a cleverer string. For a family to be classed "by construction" its dead
 * hint needs `deepest(P) === P`, i.e. P must be a tracked prefix — but any
 * tracked prefix P makes the three comparisons below reach every file beneath
 * it, so the hint goes LIVE and never enters `dead` to be classified at all.
 * The two requirements are mutually exclusive. Re-checked on this tree against
 * every candidate P the specimen admits: `skills` is a tracked prefix and
 * reaches 50 files (live, never classified); `skills/*`,
 * `skills/*\/references`, `skills/*\/references/_index.md`, `skills/references`
 * and the mangled `skills//references/_index.md` are none of them tracked
 * prefixes and all reach 0.
 *
 * ## The rule, and why it reuses `triggerCovers`
 *
 * When — and ONLY when — a glob sits in a non-final segment, the hint is
 * matched as the filter pattern it visibly is, through `triggerCovers`. That is
 * not a second matching language: `triggerCovers` is `triggerPatternRegex` plus
 * the literal-prefix directory reach, both of which already live in this file
 * for this exact job, and the docblock above refuses a second one on principle.
 * It also lines the two directions up with the ones the collapse gives: the
 * regex answers "does this pattern match the file" (`plain`-equality and
 * subtree descent), and the literal prefix answers "is the input a DIRECTORY
 * the pattern reaches into" (reverse containment).
 *
 * ## Measured, both directions, on 170 families × 754 distinct hints × 6816
 * ## tracked files
 *
 * Exactly SIX distinct hints in the whole fleet carry a glob in a non-final
 * segment, so the blast radius is enumerable rather than estimated:
 *
 *   packages/**\/*.ts             0 → 4693   check:cross-package-test-inputs (+2)
 *   packages/**\/*.object.ts      0 →   79   the same three families
 *   skills/*\/references/_index.md 0 →    9   check:skill-refs
 *   src/**\/*                     0 →    0   check:type-source-resolution
 *   spec/src/*\/index.ts          0 →    0   check:type-source-resolution
 *   src/**\/*.zod.ts              0 →    0   check:published-files
 *
 *   watch-hint (gate, file) pairs   72482 → 86807
 *   families gaining coverage       4 rows / 3 gates, listed above; ZERO losing
 *   (check, hint) newly live        7; newly inert 0
 *   unreachable families            12 → 11, and "layout moved" 1 → 0
 *   `skills/*\/references/_index.md` claims the 9 real files and 0 others
 *
 * The narrower rule is deliberate. Matching ALL whole-segment globs this way
 * was measured and REFUSED: it takes `check:test-source-alias` 7511 → 107,
 * `check:type-source-resolution` 8682 → 1278 and `check:published-files` 7407 →
 * 3 (−7404 each), because it stops collapsing the trailing `**` the
 * `ROOT_DIR_WATCH_HINTS` idiom is built on. That is a regression, not a
 * correction, and this branch keeps the idiom bit-for-bit: `packages/*` 5228,
 * `examples/*` 241, `skills/**` 50, `content/**` 442, all unchanged. So is the
 * DECIDED partial-segment trade — `packages/client*` still refuses
 * `packages/client-react/src/index.ts` and still covers `packages/client`,
 * because a partial-segment glob in the LAST segment is not this case.
 *
 * ## What the +14325 pairs are, and why they are not a widening
 *
 * All of the residual cost is two hints: `packages/**\/*.ts` and
 * `packages/**\/*.object.ts`, declared in `scripts/cross-package-test-inputs.mjs`
 * and inherited by three family rows. They reach 0 today ONLY because of this
 * defect, so the question is not whether to widen a gate but whether a
 * declaration that finally means what it says is wanted — and it is, checked at
 * the declaration site rather than assumed: `packages/**\/*.ts` is held by
 * `packages/core/src/security/operation-private-keys.pin.test.ts`, whose scan
 * surface is spelled `git ls-files` over "every `.ts`/`.tsx` file under
 * `packages/`", and `packages/**\/*.object.ts` by the two repo-wide
 * `*.object.ts` walkers in `packages/spec`. Those tests really do read every
 * matching file, so every recovered pair is a TRUE lead, not a fabricated one —
 * which is the provenance criterion the docblock above prices, never volume.
 *
 * Its derivation cost was measured rather than feared, because "22 leads is the
 * same as none" is the failure this file exists to avoid. Reading each tracked
 * file as a one-file card surface: `check:cross-package-test-inputs` is named by
 * 3323 cards today and 5561 after — 2238 additional cards, 32.8% of the tree.
 * It is NOT "nearly every card touching `packages/**`": of the 4693
 * `packages/**\/*.ts` files, 2455 already name the family through some other
 * hint and 2238 do not. Mean matched families per card goes 12.05 → 13.51 for a
 * `packages/**\/*.ts` card and 11.99 → 12.89 fleet-wide — about one extra
 * lead, against the +139084-pair explosion that took one card from 7 families
 * to 34 and is the number this file calls unaffordable. So the two hints stay
 * as declared; narrowing them at their declaration site was considered and is
 * refused, because the narrowing would be the false statement.
 *
 * ## A DROPPED EXTENSION is followed, at comparison time (#12514)
 *
 * An ESM/TypeScript relative import spells its target without the extension, so
 * `check-spec-changes.ts` importing `../src/migrations/registry` yields the hint
 * `packages/spec/src/migrations/registry` — correct, resolved against the
 * writing script by `resolveModuleRelativeHint` — while the tree holds
 * `…/registry.ts`. The comparisons above are segment-wise, and an extension is
 * not a segment, so the hint missed the file it names by exactly four bytes.
 *
 * The cost was NOT the residue row (#12780 repaired that: the printout names
 * the real file and stops calling it a layout move). It was the MATCHED column.
 * Nine `packages/spec` families were unreachable ENTIRELY for this reason, so
 * no path derivation could ever name them: a dev editing
 * `packages/spec/src/migrations/registry.ts` was never told they owed
 * `check:spec-changes`. Silent under-derivation, exit 0 — measured four times
 * in one day on this board as red CI after a dev had run a complete-looking
 * union (`check:api-surface` on #12585, `check:docs` on #12591,
 * `check:adr-anchors` on #12652, and #12393/PR #12585).
 *
 * ## Why COMPARISON and not EXTRACTION — the two are not equivalent
 *
 * The other place to follow the extension is `extractWatchHints`, emitting
 * `…/registry.ts` as the hint. That was considered and refused on three counts,
 * and the choice is recorded here because the printed hint is what a reader
 * sees:
 *
 *   - it would make the hint text a LIE ABOUT THE SOURCE. The gate really does
 *     import `../src/migrations/registry`, extensionless; the hint set's job is
 *     to say what the script declares, and `resolveModuleRelativeHint`'s own
 *     docblock calls resolving-rather-than-forgiving the contract-first repair.
 *     "Which file does this specifier mean" is a different question, and it is
 *     the one this comparison answers;
 *   - `extractWatchHints` is a PURE STRING function over one script's source.
 *     Following an extension there needs the tracked-file set, which would
 *     couple extraction to a git checkout and hand the file a SECOND answer to
 *     a question `extensionlessModuleTarget` already owns — the drift this file
 *     refuses everywhere else;
 *   - it would move the printed hint for all 38 affected hints, i.e. re-write
 *     the residue rows #12780 landed the day before, for no gain in the column
 *     this card is about.
 *
 * What extraction-side would have bought and this does not: `deepestTrackedPrefix`
 * and the escapable-literal rows still see the extensionless spelling. That is
 * deliberate — those readers describe what the AUTHOR WROTE, and they are
 * correct about it.
 *
 * ## Measured, both directions, through `hintCovers` and nothing else
 *
 * Over 176 discovered families x 829 distinct hints x 7129 tracked files, on
 * `ead731756`:
 *
 *   watch-hint (gate, file) pairs   83775 -> 83830   (+55, and ZERO lost)
 *   (check, hint) live / inert      837/645 -> 892/590   (+55 live, 0 newly inert)
 *   distinct hints reaching a file  444 -> 482   (+38, all resolving through `.ts`)
 *   unreachable families            11 -> 2     (the nine `packages/spec` ones)
 *   families gaining coverage       18; ZERO losing
 *
 * Each newly live (check, hint) pair contributes EXACTLY ONE file, which is why
 * the two `+55` figures coincide: the rule is an equality against one derived
 * name, so a hint that starts matching starts matching one path. The specimen
 * the card was filed for moves with it — a card touching
 * `packages/spec/src/migrations/registry.ts` goes from 18 matched families to
 * 21, and `check:spec-changes` is one of the three it gains.
 *
 * +55 pairs is 0.07% of the corpus, against the +139084 the bare-top-level-word
 * admission is refused at above — because the rule is an EQUALITY against one
 * derived name, not a prefix. It cannot reach a subtree and it cannot reach a
 * sibling: `plain + ext` is one string per extension.
 *
 * ## Provenance, which is the criterion this file actually prices
 *
 * 39 distinct (hint, file) equalities are added. 38 are the module specifiers
 * above, each naming the file its own gate imports. The 39th is
 * `scripts/adr-anchors` vs `scripts/adr-anchors.mjs` — the only hint in the
 * fleet whose collapsed form is a tracked DIRECTORY that also has a
 * module-extension sibling. It is a TRUE lead, checked at the declaration site
 * rather than assumed: `scripts/check-adr-anchors.mjs` line 239 imports
 * `./adr-anchors.mjs`, and that gate's own header sends a reader editing the
 * anchor layout to that module's header first. So zero of the 39 are fabricated.
 *
 * That case is also the boundary with the `content/docs` sibling trade above,
 * and the boundary holds because the extension list is a NARROWING:
 * `content/docs.site.json` is `content/docs` + `.site.json`, which is not a
 * module extension, so the pinned refusal is untouched. Any suffix in the same
 * directory would have taken it back, and would additionally have named a
 * `.test.ts` sibling for 4 of the 38 (`protocol-version`,
 * `metadata-type-schemas`, `react-blocks`, `manifest-collection-spelling`) —
 * re-measured here, not taken on trust. See `MODULE_SPECIFIER_EXTENSIONS`.
 *
 * ## The fabrication direction, and why it is pinned rather than argued
 *
 * This widening is root-agnostic: it follows an extension wherever the hint
 * points, including at a root the tree does not have. 41 distinct top-level
 * roots sit one directory away from converting 259 inert hints into MATCHED
 * pairs (`src` gates 20 of them, `data` 9) — most of that surface predates this
 * change, but this change adds the extensionless members of it. A repo that
 * grows a top-level `src/` or `data/` must not mint those pairs SILENTLY, so
 * the self-test holds the roots out by name and reds on arrival rather than
 * leaving it to whoever reads a prompt.
 */
export function hintCovers(hint, inputPath) {
  if (judgedAsPattern(hint))
    return zeroSegmentForms(hint).some((form) => triggerCovers(form, inputPath));
  const plain = collapseHint(hint);
  if (plain.length < 2) return false;
  // `refusedAsTooGeneric`, not a second copy of its condition: the residue
  // printer has to state WHICH refusal fired, and a rule spelled twice is the
  // drift this file refuses everywhere else (#12797). The predicate reads
  // `hint` and not `plain` for the reason the docblock gives -- glob collapse
  // destroys the separator the refusal is deciding on, and a declared subtree
  // is not a bare word.
  if (refusedAsTooGeneric(hint)) return false;
  return (
    inputPath === plain ||
    inputPath.startsWith(`${plain}/`) ||
    plain.startsWith(`${inputPath}/`) ||
    // EQUALITY, never a prefix: a dropped extension can only name the ONE file
    // the specifier resolves to, and the extension list is the shared
    // `MODULE_SPECIFIER_EXTENSIONS` rather than a second copy of it. See the
    // section above for the price and for what this deliberately cannot do.
    MODULE_SPECIFIER_EXTENSIONS.some((ext) => inputPath === plain + ext) ||
    // A generated, git-ignored module is reached through its committed sources,
    // declared in `GENERATED_MODULE_SOURCES` (#22554): a source file, or a path
    // under a source directory.
    (generatedModuleSources(plain)?.some((source) => inputPath === source || inputPath.startsWith(`${source}/`)) ?? false)
  );
}

/**
 * The refusal `hintCovers` applies BEFORE it compares anything: a literal with
 * no path separator anywhere in it, and not a dotted dir, is too generic to
 * match with. Its own name because two readers need it and they must not
 * answer it differently -- `hintCovers` to refuse the hint, and
 * `unreachableReason` to say which refusal fired when it reports one dead
 * (#12797).
 *
 * ⚠️ The SHORT-literal refusal one line above the call site is deliberately
 * NOT folded in: "shorter than two characters" and "carries no separator" are
 * two different rules, and a predicate that answered both could not tell the
 * residue printer which of them it was reporting.
 *
 * A pattern-judged hint is excluded here rather than left to the caller: at
 * `hintCovers` the exclusion is already structural (a pattern returns one
 * branch earlier), but the residue printer reaches this with EVERY dead hint,
 * and a glob whose collapse happens to lose its separators is not a bare word.
 */
export function refusedAsTooGeneric(hint) {
  if (judgedAsPattern(hint)) return false;
  return !hint.includes('/') && !collapseHint(hint).startsWith('.');
}

/**
 * Does a glob sit anywhere but this hint's LAST segment? The one question that
 * decides which of the two rules above judges a hint, kept as its own named
 * predicate so the branch reads as the case it is rather than as an inline
 * condition. Segment-wise on purpose: `packages/client*` is a glob in the last
 * segment and stays with the collapse (the DECIDED trade), while
 * `packages/**\/*.ts` is not.
 */
export function globInNonFinalSegment(hint) {
  const segments = hint.split('/');
  for (let i = 0; i < segments.length - 1; i++) if (segments[i].includes('*')) return true;
  return false;
}

/**
 * ## The OTHER shape collapse-by-deletion mangles: a glob with a literal SUFFIX
 * ## behind it in the FINAL segment (#13448)
 *
 * `zeroSegmentForms`' docblock recorded this species and left it: "the sibling
 * spelling `scripts/*.d.mts` is dead too, by the OLDER route … a different
 * species (deletion-collapse mangling a final segment whose glob carries a
 * literal SUFFIX)". It is the same defect as the non-final case one level
 * finer. There, deletion splices ACROSS a separator
 * (`skills/*\/references/_index.md` → `skills//references/_index.md`); here it
 * splices WITHIN one segment (`.changeset/*.md` → `.changeset/.md`). Both
 * produce a string no tree can hold, so the hint matches nothing BY
 * CONSTRUCTION while reading as an ordinary literal, and both then get filed
 * under the row this output calls its worst — "THE LAYOUT MOVED".
 *
 * The distinction that decides it is not "does the segment contain a glob" but
 * "is the deletion a REDUCTION or a SPLICE". Deleting a glob that has nothing
 * but more glob characters behind it truncates the hint to a prefix the tree
 * really can have — `packages/**` → `packages`, `packages/*` → `packages`,
 * `packages/client*` → `packages/client`, all sound, all untouched here.
 * Deleting a glob with a literal behind it joins two strings that were never
 * adjacent, which is not a reduction of anything.
 *
 * ## The live specimen and the whole blast radius, measured
 *
 * On 191 families × 749 distinct hints × 7588 tracked files at `4301f7846`,
 * EXACTLY ONE hint in the fleet carries this shape:
 *
 *   .changeset/*.md    0 -> 548 files   check:changeset-gate-self-tests,
 *                                       check-adr-0087-registration.mjs,
 *                                       check-changeset-no-major.mjs,
 *                                       check-empty-changeset.mjs,
 *                                       release-rehearsal-clone.mjs --self-test
 *
 *   (hint, file) pairs              35275 -> 35823   (+548, ZERO lost)
 *   (gate, file) pairs              140716 -> 143456 (+2740, ZERO lost)
 *   hints reaching zero files       215 -> 214
 *   distinct hints whose reach changes at all       1
 *   residue notes asserting a layout move for it    5 -> 0
 *
 * The `.changeset` population is the reason the count is worth restating
 * rather than quoting: 548 here, 548 by `git ls-files '.changeset/*.md' | wc
 * -l` on the same ref, and four different readings on four different days
 * (~400 on the filing, 537 at triage, 546 at dispatch, 548 here) because it grows
 * with every merged PR. A hint over a directory like that is precisely the one
 * a silent zero costs the most on.
 *
 * ## What it does NOT buy, measured rather than assumed
 *
 * ZERO cards gain a family and ZERO cards lose one. The card and its triage
 * both expected the matched column to move — "a live change to which gates a
 * dispatch brief names" — and on this tree it does not, for a reason only the
 * census shows: all five owners ALSO declare the bare literal `.changeset`,
 * which the subtree branch of `hintCovers` has always matched against every
 * file beneath it. The brief was already naming all five families for a
 * changeset card, through the sibling literal rather than through the glob.
 *
 * So the live cost of this defect was never an under-named brief. It was the
 * FALSE REASON the residue printed about it (see `comparedForm`), plus a
 * single point of failure nobody could see: the moment any of those five gates
 * spells its population as the glob alone — the natural spelling, and the one
 * `scripts/*.d.mts` already uses — its coverage would vanish silently. That is
 * recorded here rather than left as a nicer-sounding claim about verdicts.
 *
 * One thing does move, and it is a printed KEY rather than a verdict: 548
 * (family, card) pairs re-attribute from `.changeset` to `.changeset/*.md`, all
 * of them in `release-rehearsal-clone.mjs --self-test`, the one owner that
 * spells the glob before the bare literal. Same family, same `gate source`
 * provenance, strictly more precise key — the pattern that actually matches
 * rather than the directory it sits in. Every other owner keeps the exact key
 * it printed.
 *
 * ## Deliberately narrow, in the three directions this file already prices
 *
 *   - only `*` counts, and only in the FINAL segment. `globInNonFinalSegment`
 *     keeps its own branch and its own pins; nothing that reaches the collapse
 *     today is re-routed. Measured: `packages/*` 5631, `examples/*` 243,
 *     `skills/**` 50, `content/**` 442, `scripts/**` 299, `packages/**` 5631 —
 *     the `ROOT_DIR_WATCH_HINTS` idiom is bit-for-bit unchanged;
 *   - a TRAILING partial-segment glob is NOT this case, so the DECIDED
 *     `packages/client*` trade above is untouched and stays pinned in both
 *     directions. Re-measured: zero hints in the fleet carry that shape today,
 *     exactly as its docblock recorded;
 *   - `?`, `+` and `[…]` are NOT admitted. `collapseHint` never deleted them,
 *     so they are not a mangle — they are an ordinary literal that fails to
 *     match, which is the missing-lead direction this file errs in. Measured:
 *     zero hints in the whole fleet carry any of the three. Admitting them
 *     would be a fabricated-lead widening bought for no live instance, and the
 *     self-test reds on their arrival rather than leaving it to a reader.
 *
 * The provenance criterion, which is what this file actually prices rather
 * than volume: all 2740 recovered pairs are `.changeset/*.md` against real
 * `.changeset/*.md` files, checked at the declaration site — `check-empty-
 * changeset.mjs` and `check-changeset-no-major.mjs` both walk the directory
 * and read every `.md` in it. Zero of them are fabricated.
 */
export function globCarriesLiteralSuffix(hint) {
  const last = hint.split('/').pop();
  const firstGlob = last.indexOf('*');
  if (firstGlob < 0) return false;
  // A literal character BEHIND the glob is what turns deletion into a splice.
  // Nothing but further `*` behind it means the deletion truncates, which is
  // the sound reduction the collapse is built on.
  return /[^*]/.test(last.slice(firstGlob));
}

/**
 * Is this hint judged as a PATTERN (`triggerCovers`) rather than by the glob
 * collapse? The two shapes whose collapse is a splice rather than a reduction,
 * asked as ONE question because two call sites need the same answer and a
 * second copy of it is the drift this file refuses everywhere else:
 * `hintCovers` needs it to route the comparison, and the residue reason needs
 * it to avoid describing a hint in terms of a form the comparison never used.
 *
 * That second reader is the half #13448 is really about. Before it, every
 * reason branch reasoned from `collapseHint` unconditionally, including for
 * the hints `hintCovers` had already stopped judging that way — so the residue
 * could state a specific cause ("the layout moved under it") derived from a
 * string the comparison never looked at. See `comparedForm`.
 */
export function judgedAsPattern(hint) {
  return globInNonFinalSegment(hint) || globCarriesLiteralSuffix(hint);
}

/**
 * The form `hintCovers` ACTUALLY judged this hint by — the one string any
 * statement about why the hint is dead has to be about.
 *
 * For a collapse-judged hint that is `collapseHint(hint)`, exactly as before.
 * For a pattern-judged hint the collapsed form is not a form at all
 * (`.changeset/.md`, `skills//references/_index.md`), and the string the
 * comparison reasons from is the LITERAL PREFIX — the segments ahead of the
 * first glob, which is the same prefix `triggerCovers` uses for its reverse
 * containment. `.changeset/*.md` → `.changeset`; `skills/*\/references/
 * _index.md` → `skills`; `src/**\/*` → `''`.
 *
 * ## Why this is the second half of the same defect, not a display polish
 *
 * `deepestTrackedPrefix` walks this form and `unreachableClass` compares
 * against it, so with `collapseHint` hard-wired in both, a pattern hint could
 * never satisfy `deepest === form` — `.changeset` is never `.changeset/.md` —
 * and therefore ALWAYS fell through to the "the tree stops at X; the layout
 * moved under it" branch. That is not a wording problem: the sentence names a
 * directory rename as the cause, and a reader who acts on it goes looking for
 * one that never happened. Repairing `hintCovers` alone would have retired
 * today's five instances of that row and left the derivation that mints it
 * intact, which is trading one error for a better-hidden one.
 *
 * With the form corrected the three branches mean what they say for BOTH
 * comparison modes: `deepest === form` is "the population's root is right
 * there", a strictly shorter `deepest` is a genuine move under a surviving
 * parent, and an empty one is a literal no tracked path begins with — a
 * specifier, or a path anchored at a base this scan did not resolve (#14208).
 */
export function comparedForm(hint) {
  if (!judgedAsPattern(hint)) return collapseHint(hint);
  const segments = hint.split('/');
  const upto = segments.findIndex((s) => s.includes('*'));
  return (upto < 0 ? segments : segments.slice(0, upto)).join('/');
}

/**
 * How many `**` segments one hint may carry before the enumeration below stops
 * being exhaustive. The forms are a power set, so the bound is what keeps a
 * pathological hint from costing 2^n comparisons per file. Measured over all
 * 764 distinct hints in the fleet, the maximum any hint carries is ONE; the cap
 * is headroom, not a live constraint, and the self-test pins what a hint above
 * it still gets.
 */
export const ZERO_SEGMENT_STAR_CAP = 8;

/**
 * ## `a/**\/b` must reach `a/b` — the spellings a hint author writes, not the
 * ## ones CI's trigger language happens to share
 *
 * Every spelling of a hint that carries a glob in a non-final segment is judged
 * by `triggerCovers`, which is `triggerPatternRegex` and therefore GitHub's
 * filter-pattern language verbatim: there `**` is a CHARACTER wildcard ("zero
 * or more of any character, `/` included"), so the `/` written after it is a
 * literal that must still appear. The consequence is segment-wise arithmetic no
 * hint author expects — `scripts/**\/*.d.mts` compiles to
 * `^scripts/.*\/[^/]*\.d\.mts$`, which needs at least one intervening
 * segment, so `**` there means ONE OR MORE and a top-level file is unreachable
 * BY CONSTRUCTION:
 *
 *   scripts/check-regen-pending.d.mts   ← 3 tracked files, the natural
 *   scripts/invoked-as.d.mts              spelling for them reaches 0 of them
 *   scripts/js-comment-mask.d.mts
 *
 * That is the same dead-hint species #12246 was filed for, arriving through the
 * branch that fixed it: a hint that matches nothing while looking like an
 * ordinary literal, which `unreachableClass` then files as "THE LAYOUT MOVED …
 * a real miss, worth triaging" — the wrong-classification-plus-wrong-evidence
 * row this output calls the worst one it can print.
 *
 * ## Why the repair is HERE and not in `triggerPatternRegex`
 *
 * `triggerPatternRegex` is the CI mirror. `triggerListCovers`/`coveringTrigger`
 * evaluate real workflow `paths:` lists with it, and its docblock's whole claim
 * is that it reads the trigger language rather than approximating it. Teaching
 * `**` to swallow its own separator THERE would change what this file says CI
 * does — a fleet-wide semantic change, and a lie about a `paths:` list, for
 * every workflow (`validate-deps.yml`'s `'**\/package.json'` is the live
 * specimen). So the character-wildcard translation stays exactly as it is, and
 * the difference is confined to the side that actually differs: a HINT is a
 * glob a gate author wrote to describe what the gate reads, not a filter GitHub
 * will evaluate, and in that language `a/**\/b` covers `a/b`.
 *
 * ## The rule
 *
 * A hint's forms are itself plus every spelling reachable by deleting some
 * subset of its whole-`**` non-final segments — the power set, because each
 * `**` means "zero or more" independently of the others. A match against ANY
 * form is a match. Deliberately narrow in three ways:
 *
 *   - only a segment that is EXACTLY `**` is droppable. `packages/client*` and
 *     `*.d.mts` are partial-segment globs and keep the meaning they have;
 *   - only NON-FINAL segments, so nothing that reaches the collapse is touched;
 *   - a single `*` is never droppable — `a/*\/b` means exactly one segment in
 *     every glob language, `skills/*\/references/_index.md` included.
 *
 * ## Measured, both directions, on 174 families × 764 distinct hints × 6861
 * ## tracked files
 *
 * The blast radius is enumerable rather than estimated: four of the six live
 * hints with a glob in a non-final segment carry a whole-`**` segment, and the
 * form this rule adds for each reaches nothing the tree has.
 *
 *   packages/**\/*.ts          + packages/*.ts          4718 → 4718
 *   packages/**\/*.object.ts   + packages/*.object.ts     79 →   79
 *   src/**\/*                  + src/*                     0 →    0
 *   src/**\/*.zod.ts           + src/*.zod.ts              0 →    0
 *   skills/*\/references/_index.md   no `**` segment        9 →    9
 *   spec/src/*\/index.ts            no `**` segment        0 →    0
 *
 *   watch-hint (gate, file) pairs   70188 → 70188 (ZERO change)
 *   families gaining or losing coverage                    0
 *   (check, hint) newly live 0; newly inert 0
 *   hints reaching zero tracked files                388 → 388
 *
 * Zero is the expected reading, not a disappointing one: `packages/` holds no
 * file at its top level, and the two `src/**` hints are package-relative module
 * specifiers that were never repo paths. What the rule buys is that the natural
 * spelling for a top-level population STOPS BEING A TRAP — `scripts/**\/*.d.mts`
 * goes 0 → 3 the moment a gate declares it, instead of being recorded as an
 * unspellable population.
 *
 * The `ROOT_DIR_WATCH_HINTS` idiom #12300 measured at −7404 pairs on each of
 * three gates if widened wrongly is untouched, because no trailing glob reaches
 * this function at all: `packages/*` 5253, `examples/*` 241, `skills/**` 50,
 * `content/**` 442, `scripts/**` 272, all unchanged, and the three gates hold
 * at check:test-source-alias 5534, check:type-source-resolution 5534,
 * check:published-files 5535.
 *
 * ## The sibling species this did NOT fix — since repaired next door (#13448)
 *
 * This section used to record `scripts/*.d.mts` as still dead by the OLDER
 * route: a glob in the LAST segment went through `collapseHint`, which deletes
 * the `*` and yields `scripts/.d.mts`, a path no tree holds. That was called a
 * different species (deletion-collapse mangling a final segment whose glob
 * carries a literal SUFFIX, next door to the DECIDED partial-segment trade)
 * and left as it was, pinned so the asymmetry read as recorded rather than
 * overlooked.
 *
 * It is now repaired by `globCarriesLiteralSuffix`, which routes exactly that
 * shape into the same `triggerCovers` branch this one uses — the two are one
 * defect, splicing across a separator and splicing inside a segment. The live
 * cost of leaving it was `.changeset/*.md` measuring dead against 548 tracked
 * changesets while the residue named a directory rename as the reason. The
 * pins below flipped with it and now assert the reach rather than the deadness;
 * the DECIDED partial-segment trade (`packages/client*`) is a TRAILING glob and
 * is still not this case, still refused, still pinned in both directions.
 */
export function zeroSegmentForms(hint) {
  const segments = hint.split('/');
  const droppable = [];
  for (let i = 0; i < segments.length - 1; i++) if (segments[i] === '**') droppable.push(i);
  if (droppable.length === 0) return [hint];
  // Above the cap the power set is refused rather than truncated arbitrarily:
  // the two forms that carry meaning are the hint as written (every `**` at one
  // or more) and the hint fully reduced (every `**` at zero).
  const dropSets =
    droppable.length > ZERO_SEGMENT_STAR_CAP
      ? [[], droppable]
      : Array.from({ length: 1 << droppable.length }, (_, mask) =>
          droppable.filter((_, k) => (mask >> k) & 1),
        );
  const forms = [];
  for (const drop of dropSets) {
    const dropped = new Set(drop);
    const form = segments.filter((_, i) => !dropped.has(i)).join('/');
    if (form.length > 0 && !forms.includes(form)) forms.push(form);
  }
  return forms;
}

/**
 * Translate ONE GitHub filter pattern into an anchored regex, following the
 * documented filter-pattern semantics rather than approximating them:
 *
 *   `**`  zero or more of ANY character, `/` included
 *   `*`   zero or more characters, but never `/`
 *   `?` `+` `[…]`  keep their regex meaning — GitHub's cheat sheet defines them
 *         as the regex quantifiers/class they look like, so a translation that
 *         escaped them would be a DIFFERENT language from CI's
 *
 * Every other regex metacharacter is escaped. Nothing in this tree uses the
 * three quantifier forms today; they are translated rather than refused because
 * "mirror the trigger language exactly" is the whole point of reading the
 * trigger instead of writing a map — a pattern this function silently got wrong
 * would be the drift, one level down.
 */
export function triggerPatternRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '?' || c === '+' || c === '[' || c === ']') {
      out += c;
      continue;
    }
    out += /[\\^$.|(){}]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${out}$`);
}

/**
 * Does one GitHub filter pattern cover an input path? Two ways, and only two:
 *
 *   - the pattern matches the path itself — the exact question CI asks of every
 *     changed file;
 *   - the path is a DIRECTORY the pattern reaches into, decided from the
 *     pattern's literal prefix (everything before its first wildcard). A card's
 *     file surface is often given as a directory, and `packages/spec/**` plainly
 *     schedules the job for a card whose surface is `packages/spec`.
 *
 * The directory rule is deliberately decided on the LITERAL prefix and nothing
 * else, which refuses one reach it could plausibly claim: `**` + `/package.json`
 * has an empty literal prefix, so a directory surface never derives it — only
 * the real changed file `packages/spec/package.json` does. That is the same
 * trade `hintCovers` records and decides the same way: refusing costs a missing
 * lead on a surface given coarsely, claiming it would paste a gate into every
 * prompt whose directory might contain a manifest.
 */
export function triggerCovers(pattern, inputPath) {
  if (triggerPatternRegex(pattern).test(inputPath)) return true;
  const literalPrefix = pattern.split(/[*?+[]/)[0];
  return literalPrefix.length > 0 && literalPrefix.startsWith(`${inputPath}/`);
}

/**
 * Evaluate a workflow's whole `paths:` list against one input path and return
 * the pattern that DECIDED the answer, or null.
 *
 * Order matters, exactly as it does in CI: a later `!` pattern that matches
 * excludes a path an earlier one included, and a later positive re-includes it.
 * A list of negations only never covers anything — a path nothing positively
 * matched was never in.
 */
export function triggerListCovers(patterns, inputPath) {
  let decided = null;
  for (const raw of patterns ?? []) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    if (!triggerCovers(pattern, inputPath)) continue;
    decided = negated ? null : raw;
  }
  return decided;
}

/**
 * The first of a family's workflows whose declared `paths:` trigger covers the
 * input path, or null. `entry.triggers` is `[{ workflow, paths }]`, built in
 * `derive` from `extractTriggerPaths` — workflows that declare NO filter are
 * left out there, because "CI runs this on every PR" discriminates nothing and
 * would name every unfiltered family for every card.
 */
export function coveringTrigger(entry, inputPath) {
  for (const { workflow, paths } of entry.triggers ?? []) {
    const pattern = triggerListCovers(paths, inputPath);
    if (pattern) return { workflow, pattern };
  }
  return null;
}

/**
 * The first of a family's JOB-level filters whose derived population covers the
 * input path, or null. Same claim as `coveringTrigger` one hop in: CI decides
 * whether to schedule this job from this list, stated by the repo, in the file
 * CI itself obeys — see `jobPathPopulations` for how the hop is followed and
 * what it refuses to follow.
 *
 * The JOB NAME travels with the answer because that is what a dev sees go red.
 * `console-pin` is the id; `Console Pin Gate` is the required check, and the
 * measured failure this closes (#12956) was a dev reading a derived list that
 * named neither.
 */
export function coveringJobFilter(entry, inputPath) {
  for (const jf of entry.jobFilters ?? []) {
    const pattern = triggerListCovers(jf.paths, inputPath);
    if (pattern) return { ...jf, pattern };
  }
  return null;
}

/**
 * The key that makes one check family relevant to one input path, or null —
 * the family's OWN script files first, then CI's declared trigger for it, then
 * the path literals scanned out of those files.
 *
 * ## Why a gate's own script files are match keys (#8509)
 *
 * `derive` resolves every family to the script FILES that implement it and
 * stores them on `entry.files`, then used to compare only `entry.hints` — the
 * literals scanned from those files' CONTENTS. So the most direct relationship
 * the tool has was the one it never used: *this gate IS this file*. A card
 * editing `scripts/check-empty-changeset.mjs` derived nothing at all, because
 * the gate that runs that script names it in **package.json**, not in the
 * script's own source.
 *
 * Measured on this tree the day this landed: of the 70 gate scripts the
 * workflows resolve to, 8 derived any family when edited — and those eight only
 * because they happen to quote their own filename in their module body, which
 * was never a feature. The blind spot is self-shaped: it is exactly the class of
 * card that edits gate tooling, which is the work most likely to break a gate.
 *
 * Nothing is listed to close it. `entry.files` is resolved at runtime from
 * package.json, so the identity key follows the same derived-never-listed
 * contract as the rest of this script: a gate script added tomorrow is matched
 * by the next run with nothing to update here.
 *
 * ## Why identity is consulted FIRST, and why the keys cannot fight
 *
 * Only one answer is taken per path, so a family can never print twice.
 * Ordering therefore decides one thing only: which provenance the `matched via`
 * column shows when more than one key fires. Identity is the most specific
 * claim available — the input IS this file, not a pattern or a literal that
 * happens to cover it — so it goes first (`check:nul-bytes` against
 * `scripts/check-nul-bytes.mjs` is the live specimen: the same single line, now
 * attributed to the file itself).
 *
 * CI's trigger outranks a scanned literal for the remaining ties, and the
 * reason is what the two claims are worth to the reader. The trigger is a
 * DECLARATION — this workflow will run on your PR, stated by the repo, in the
 * file CI itself obeys. A watch hint is this tool's inference from a string it
 * found in a script. When both cover the same path the stronger provenance is
 * the one to print.
 *
 * Where only one fires, order changes nothing, and this tool's own gate is the
 * specimen for that: `scripts/pm/check-dispatch-gates.mjs` is a thin file whose
 * one module-body constant is the tool it runs, so a card editing the TOOL
 * still matches through that constant while a card editing the GATE FILE
 * matches through identity. They answer different inputs.
 *
 * ## The FIFTH key this file measured and REFUSED: the module a gate IMPORTS (#13126)
 *
 * `firstPartyImportTargets` already follows a gate's `./sibling.mjs` import —
 * but only to inherit that module's HINTS, which answers "what population does
 * this gate watch, once you count what its helper watches". The same edge
 * answers a second question, and it is identity-shaped: *if I edit this helper,
 * which gate can I break?* None of the four keys above reaches it. A module is
 * not the family's own file, not a `paths:` pattern, not a job filter, and its
 * own path is not a literal the gate spells.
 *
 * The gap is real. Its SIZE is a fact about this tree rather than about this
 * argument, so it is not written down here: `--self-test` re-derives it on
 * every run and prints it, and one run yields all four quantities the refusal
 * turns on —
 *
 *   node scripts/pm/dispatch-gates.mjs --self-test \
 *     | grep -A7 'the refused import-edge class'
 *
 * which puts the refused key's whole block on stdout. Four of its lines carry
 * the quantities, each naming its own in the sentence it prints:
 *
 *   "the refused import-edge class is real and NOVEL — N pair(s) no key
 *    reaches, of M"
 *        M = every (family, imported module) pair this tree has; N = the NOVEL
 *        half, the pairs no existing key answers, i.e. what the key would ADD
 *   "and the split the refusal quotes is not invented: K pair(s) another key
 *    already answers"
 *        K = M - N, which is why N is a measurement and not a raw edge count
 *   "the refusal is still earned — a card editing MOD would name F families
 *    under the refused key"
 *        MOD = the worst head utility; F = the single largest lead the key
 *        would print, for a card that edits it
 *   "and the class is still concentrated: C of N novel pair(s) land on 5
 *    module(s)"
 *        C of N = the concentration this whole refusal rests on
 *
 * Those four were once written into this docblock as literals, and all four
 * had drifted — the novel half alone has now been measured at four sizes on
 * four days — while the run printed the true ones a few lines below and
 * nothing compared the two (#13468). Pinning them instead would red on every
 * legitimate tree change, which is how an assertion gets weakened later. The
 * run is the instrument, this prose is the argument, and only the argument
 * keeps.
 *
 * Every OTHER size in this section — the tail, the two narrowings, the
 * lower-bound shapes, the witness's own family count — is #13126's
 * measurement over that day's tree (183 families x 7347 tracked files).
 * Nothing re-derives those, so they are dated evidence for a decision already
 * taken and NOT a description of this tree: re-measure from the commands on
 * that card, never from this prose. Same rule the aggregate section below
 * states for its own firing rates.
 *
 * So the key would be additive by construction, the way #13000's is: the sweep
 * was run over the whole corpus with the candidate key consulted LAST, and it
 * RE-ATTRIBUTED 0 and LOST 0. It is still refused. The reason is PRECISION and
 * the numbers are not close — #13000 bought its class for 5 novel leads on
 * this same corpus, this one costs the entire novel half, and the run's
 * concentration line says most of that half lands on five shared utilities
 * nearly every gate links:
 *
 *   scripts/invoked-as.mjs
 *   scripts/import-prerequisite.mjs
 *   scripts/ts-parse.mjs
 *   scripts/js-comment-mask.mjs
 *   scripts/workspace-enumerator.mjs
 *
 * Every one of those leads is TRUE — editing `invoked-as.mjs` really can turn
 * every family that imports it red, and the run's `would name F families` line
 * says how many that is today. A list that size is still the failure this
 * file's header names: the dev who gets one stops reading it, which ends
 * exactly where a list that omits the one gate that matters ends. The tail is
 * the opposite shape and is the half worth having — 21 modules carrying 31
 * pairs, the median card moving from 14 families to 15 — and the ONLY property
 * separating the two halves is fan-in. This file draws its lines on provenance
 * rather than on volume (`firstPartyImportTargets` says so where it refuses an
 * imported gate file), and a fan-in cut has no provenance to state:
 * `invoked-as.mjs` and `dispatch-gates.mjs` are the same KIND of edge, one
 * link apart.
 *
 * Two narrowings were measured and neither earns it either:
 *
 *   importer is a `--self-test` family   12 novel pairs, but 8 of the 12 are
 *                                        `<- invoked-as.mjs`, and the line is
 *                                        the INHERITANCE narrowing borrowed for
 *                                        the question #11556 / #11511 settled
 *                                        separately — identity is not that
 *   target is not itself a gate file     63 novel pairs, and it still takes an
 *                                        `import-prerequisite.mjs` card to 55
 *
 * What the refusal COSTS is a live missing lead, and it is named rather than
 * implied: `scripts/pm/bare-root-worklist.mjs --self-test` statically imports
 * THIS file, and a card editing this file derives 14 families without naming
 * it. That gate gets run by hand, but lint.yml runs it on every PR too, so the
 * miss costs one CI round, which is the side this file's header errs on
 * everywhere, and it is a far smaller cost than the card the general key
 * prints for the module nearly every family imports — the run's `would name F
 * families` line is what prices that one.
 *
 * WHERE THAT PRICE DOES NOT HOLD (#13467). "One CI round" is the WITNESS's
 * price and an AVERAGE over the class, and the next reader will quote it as the
 * price of every missed lead. For a minority it is wrong. Which minority is a
 * TREE-fact, re-derived and printed by every `--self-test` run instead of
 * recorded here, because this class has already been measured at three
 * different sizes on three different days:
 *
 *   - the large majority of novel pairs sit in a family at least one UNFILTERED
 *     workflow runs. CI opens that module on this PR whatever the derivation
 *     said, so one round really is the whole price; and
 *   - the rest sit in families NO every-PR workflow runs — today the
 *     paths-filtered and scheduled callers (the patrols, `validate-deps.yml`,
 *     and the release-time ones). No CI round on this PR repays those. The
 *     family next executes on its own cadence, detached from the change.
 *
 * That remainder is a LOWER bound for the same two reasons the novel total is
 * (below), and it is NOT the claim that a load break in those helpers ships
 * green: every module carrying a deferred pair is imported by every-PR families
 * as well, so a module that fails to LOAD reddens this PR through a sibling.
 * What defers is the narrower break, the one only the deferred consumer would
 * have seen. Nor do the deferred pairs spread thin — they concentrate on the
 * shared heads this refusal is refused FOR, i.e. the modules most likely to be
 * edited into a break. Both halves are asserted in `--self-test`; a red there
 * says the exception changed shape and this paragraph is due a re-read, not
 * that the derivation broke.
 *
 * Two shapes make that novel half a LOWER bound rather than an exact size,
 * both already refused upstream for their own measured reasons: a dynamic
 * `import()` of a `scripts/` module (3 live family-module pairs) and a
 * relative target outside `scripts/` (3, all `eslint.config.mjs`).
 *
 * ## The AGGREGATE line over the same edges, measured and refused too (#13251)
 *
 * The follow-up to this refusal asked whether ONE summary line per edited
 * module ("imported by N discovered families; a change to its exports breaks
 * them at load") could carry the information the refused leads carry.
 * Measured over the live card population — 1,862 first-parent commits on
 * origin/main, 2026-08-16..30, window proven by git-history.mjs, at 71627f7b
 * — and refused as well:
 *
 *   - it would have fired on 8.8% of cards, but the case an aggregate exists
 *     for — the five head utilities whose refused lists motivated it — fired
 *     on 0.6% (11 cards), and on those no runnable subset exists between the
 *     derived list and the farm. 231 of the then-241 novel pairs sat in
 *     UNFILTERED workflows: CI already buys the whole class in one round.
 *   - 93% of firings land on TAIL modules (fan-in <= 3), where the value is
 *     the NAMES, and every names-shape is already decided: all names is this
 *     refused key; names under a threshold — and "top importers: …" capped at
 *     K is the same thing — is a fan-in cutoff, the volume rule this file has
 *     no provenance to state; a bare count without names fails "changes a
 *     decision" exactly where it fires most. 61 of the 164 firings were cards
 *     on THIS file, whose count line ("imported by 1 discovered family")
 *     withholds the one name that matters — the bare-root-worklist witness
 *     the COSTS paragraph above already prices.
 *
 * The staleness alarms for this refusal are the SAME pins as the key's
 * (concentration + witness, re-derived every `--self-test` run). The firing
 * rates are history-facts, not tree-facts: re-measure them from the commands
 * on #13251, never from this prose.
 *
 * Returns `{ key, via }` — `via` is the provenance label the output prints, so
 * a lead can never be read as the wrong kind of claim.
 */
export function coveringKey(entry, inputPath) {
  const identity = (entry.files ?? []).find((f) => hintCovers(f, inputPath));
  if (identity) return { key: identity, via: 'gate script' };
  const trigger = coveringTrigger(entry, inputPath);
  if (trigger) return { key: trigger.pattern, via: `CI trigger in ${trigger.workflow}` };
  // A job filter is the same KIND of claim as the workflow trigger — a
  // declaration CI obeys — so it outranks a literal scanned out of a script,
  // and sits below the workflow trigger because that one decides whether the
  // job is reachable at all. Where both fire the stronger provenance prints.
  const jobFilter = coveringJobFilter(entry, inputPath);
  if (jobFilter) {
    return {
      key: jobFilter.pattern,
      via: `CI job filter for '${jobFilter.name}' in ${jobFilter.workflow}`,
    };
  }
  const hint = (entry.hints ?? []).find((h) => hintCovers(h, inputPath));
  if (hint) {
    // A hint a gate spells itself and one it inherits from a module it imports
    // are different claims, so the label says which — the same reason the
    // trigger and the identity keys carry their own provenance above.
    const inherited = entry.hintOrigin?.get(hint);
    if (!inherited) return { key: hint, via: 'gate source' };
    // WHICH edge carried it, not just that it was carried: a population a gate
    // inherits by RUNNING a program is a different claim from one it inherits
    // by importing a module, and a dev reading the line has to be able to go
    // check the right thing (#13511).
    const edge =
      { run: 'the program it runs, ', manifest: 'the export surface declared by ' }[
        entry.hintEdge?.get(hint)
      ] ?? '';
    return { key: hint, via: `gate source via ${edge}${inherited}` };
  }
  // LAST, and deliberately (#13000). The four keys above are all claims about a
  // POPULATION — a pattern or a literal that covers your path — and this one is
  // a claim about a single FILE, so consulting it earlier could only change
  // which provenance an already-matched family prints. Placed here it is
  // additive BY CONSTRUCTION: measured over the live tree, 81 (family, target)
  // pairs, 19 of which another key already answers and keep the exact label
  // they had. Nothing is re-attributed, and the widening is 5 leads.
  const read = (entry.reads ?? []).find((r) => r === inputPath);
  if (read) {
    const by = entry.readOrigin?.get(read);
    // WHICH spelling carried it, not just that it was carried (#18673): a
    // program text this scan resolved by itself and a file the script DECLARES
    // its self-test opens are different claims, and a dev reading the row has
    // to know which one to go check — the same argument `hintEdge` makes above.
    const kind =
      entry.readEdge?.get(read) === 'declared-self-test' ? 'declared self-test read' : 'program text read';
    return { key: read, via: by && by !== read ? `${kind} by ${by}` : kind };
  }
  return null;
}

/**
 * Place one check family against a card's whole file surface: `matched` (with
 * the hits to print), `undetermined` (the honest "this derivation cannot place
 * the gate" bucket), or `silent`.
 *
 * ## Why the undetermined bucket still counts SCANNED hints only
 *
 * The one-line spelling of the identity match — push `entry.files` into
 * `entry.hints` — also quietly empties this bucket, because a family whose
 * source names no path whatsoever still resolves to a script file, so
 * `hints.length === 0` would stop being true for it. Measured on this tree: 35
 * families have no discoverable path literals and 16 of them resolve to a
 * script file, so that spelling would move 16 gates out of the output's honest
 * half and into silence — a gate the derivation cannot mention at all, the one
 * output shape this script's contract forbids.
 *
 * The two questions are simply different. Matching asks "is this family
 * relevant to these paths?", which identity answers directly. The bucket asks
 * "does this family's source name any path at all?", which identity does not
 * answer for anybody's card but the one editing that very script. So identity
 * decides matching, and the bucket keeps reading `entry.hints`.
 *
 * The CI-trigger key (#9171) is the same shape of addition and takes the same
 * answer: it decides MATCHING for a card the workflow schedules, and it is
 * invisible to the bucket. The two are not interchangeable — the whole
 * `Spec property liveness` job is `undetermined` and always will be, because
 * its gates read a registry rather than a path, and that remains the honest
 * verdict for every card the workflow does NOT schedule.
 */
export function classifyEntry(entry, paths) {
  const hits = [];
  for (const p of paths) {
    const covering = coveringKey(entry, p);
    if (covering) hits.push({ path: p, hint: covering.key, via: covering.via });
  }
  if (hits.length) return { verdict: 'matched', hits };
  return { verdict: (entry.hints ?? []).length === 0 ? 'undetermined' : 'silent', hits };
}

/**
 * Place one family, declaration FIRST (#14189). The one seam through which the
 * whole-tree channel touches placement, and it is deliberately the whole of
 * it: everything below this line is `classifyEntry`, unchanged, so a family
 * that declares nothing is classified byte-for-byte as it was before this
 * channel existed. A self-test case pins that identity over probe paths, and
 * removing the two lines above the delegation is the mutation that reddens the
 * placement pins — which is what makes them discriminating rather than
 * decorative.
 *
 * Why the declaration is consulted BEFORE the matchers rather than after: a
 * whole-tree gate would `match` a card that edits its own script (the identity
 * key) and score `silent` for every other card, so an "after" ordering would
 * hand the same gate two different placements depending on the card — the one
 * shape this channel exists to retire. Its population does not vary by card,
 * so neither does its placement.
 *
 * `always-runs` is a FOURTH verdict, not a fourth flavour of the three: it is
 * outside `matched`/`silent`/`undetermined` everywhere they are counted, and
 * `residueLines` accounts for it as its own term rather than folding it into
 * the partition (a fold would silently shrink the residue, which is the exact
 * failure that function's own throw exists to catch).
 */
export function placeFamily(entry, paths) {
  if (entry?.wholeTreeReason) return { verdict: 'always-runs', hits: [] };
  const placed = classifyEntry(entry, paths);
  // The THIRD channel (#15341), and it is deliberately spelled the other way
  // round from the one above: consulted AFTER the classifier, not before.
  //
  // Why the asymmetry is the design rather than an inconsistency. The
  // whole-tree declaration is consulted first because such a gate would
  // otherwise be `matched` on the card that edits its own script and `silent`
  // on every other — one gate, two placements, which is the shape that channel
  // exists to retire. This declaration has no such problem to solve: it is a
  // claim about the gate's POPULATION, and the only way one of these families
  // can be `matched` at all is through a key that is NOT a population claim —
  // `coveringKey`'s identity key, "an identity claim about a single FILE". A
  // card editing the gate's own script is a 100%-precise lead, and the ruling's
  // "keeps it OUT of the matched column" is about the ROOTS the gate walks:
  // suppressing the identity match too would make a channel added to ADD
  // information subtract some, silently, on the one card class where this
  // derivation is exactly right. `widePopulationRefusal` keeps the two apart by
  // refusing a marker that sits above any scanned path population at all, so
  // this branch can only ever override an UNPLACED verdict.
  if (entry?.widePopulationReason && placed.verdict !== 'matched') {
    return { verdict: 'wide-population', hits: [] };
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Telling a WEAK silence from an INVERTED one (#10784)
// ---------------------------------------------------------------------------

/**
 * The deepest directory containing every one of these paths, compared on
 * SEGMENT boundaries, or '' when they share nothing above the repo root.
 *
 * Segment boundaries for the same reason `hintCovers` uses them: a string
 * prefix would report `packages/spec` as the shared home of `packages/spec.ts`
 * and `packages/species/x.ts`, which is a directory neither one is in.
 */
export function commonDirectory(paths) {
  if (!paths.length) return '';
  let shared = paths[0].split('/').slice(0, -1);
  for (const p of paths.slice(1)) {
    const other = p.split('/').slice(0, -1);
    let i = 0;
    while (i < shared.length && i < other.length && shared[i] === other[i]) i++;
    shared = shared.slice(0, i);
    if (!shared.length) break;
  }
  return shared.join('/');
}

/**
 * A silent family whose ENTIRE declared population is tracked FILES — an
 * artifact roster rather than a population — or null.
 *
 * ## Why `silent` needed splitting at all (#10784)
 *
 * `silent` is this derivation's weakest claim, and the residue block already
 * says so and names two ways to earn it that have nothing to do with the
 * caller's paths. A third way was measured, and it is worse than weak: a gate
 * whose declared literals are an ENUMERATION OF THE FILES THAT ALREADY EXIST.
 * `check-entry-guard` was the specimen — its only module-body literals were the
 * ten allowlisted files that already violate its import-safety half, while at
 * runtime it walked the whole directory and judged new files too. So the
 * derivation answered `silent` for a NEW file under that root: not a weak
 * verdict there but an INVERTED one, for exactly the input most likely to fail
 * the gate. One CI round was paid for it before the shape had a name.
 *
 * A reader could not tell that from an ordinary silence, because the output
 * said the same words for both. This is the distinction, printed.
 *
 * ## The test, and why it is FILES and not a shape heuristic
 *
 * Every declared literal must NAME a path the tree tracks as a FILE. A
 * gate that names one directory has declared a population, whatever else it
 * names; a gate that names only files has declared ARTIFACTS — a baseline it
 * maintains, an allowlist of current members, a sibling tool it reads — and
 * artifacts are not a population. Both known sub-shapes fall out of the one
 * test rather than needing to be told apart: one artifact is the "names only
 * its baseline artifact" case the residue prose already describes, and several
 * under a common root is the enumeration above.
 *
 * ## Why it asks `declaredFileTarget` and holds no answer of its own (#13520)
 *
 * "NAME" above used to read "collapse to", and the difference was a whole
 * category. The test was `trackedFiles.has(collapseHint(h))` — a private,
 * weaker copy of a question this file already has an owner for. `hintCovers`
 * resolves a module specifier through `MODULE_SPECIFIER_EXTENSIONS` (#12514)
 * and `extensionlessModuleTarget` names the file it resolves to (#12299); this
 * predicate followed neither, so a family whose whole roster is extensionless
 * import targets — `packages/spec/scripts/lib/dist-freshness`, while the tree
 * holds `…/dist-freshness.ts` — failed the every-literal test and printed as
 * an ORDINARY silence, which this file's header calls a different fact.
 *
 * ⚠️ Note the failure direction, which is why it survived: it threw nothing and
 * printed no error. It returned a coherent, plausible, WRONG category, and the
 * `--residue` block printed both halves of the contradiction on one line — the
 * dead-hint sweep (`hintCovers`) marking every literal as reaching the tree,
 * and this predicate declining to call the family a roster.
 *
 * The repair is not a list of the families it got wrong. It is that this
 * predicate no longer decides the question at all: `declaredFileTarget` is the
 * one owner of "the tracked FILE this declared literal names", and every
 * spelling that owner learns is learned here in the same edit, for every
 * family at once. The self-test holds the two EQUAL over the live fleet, so a
 * future widening of the covering rule that forgets this reader reds instead of
 * silently re-categorising families — the class, not the gate names.
 *
 * ## Blast radius, measured over the WHOLE fleet before widening (#13520)
 *
 * On 192 discovered families × 754 distinct hints × 7605 tracked files, at
 * `16c3601d2`:
 *
 *   artifact-roster families            30 -> 39   (+9, and ZERO lost)
 *   rosters whose membership or dir moved        0
 *   literals where the covering rule and this predicate disagree   40 -> 0
 *
 * All nine gained are `packages/spec` families whose rosters are `.ts` module
 * specifiers; no family loses the verdict it had, and no existing roster's
 * `artifacts` or `dir` changes, because resolution is the identity on a literal
 * that already spells its file. The card that filed this named six; the sweep
 * it asked for found nine.
 *
 * The widening cannot reach a declared POPULATION: `extensionlessModuleTarget`
 * refuses any hint the tree has as a prefix, so a directory literal never
 * resolves, and a pattern is refused up front (measured: 18 pattern-judged
 * hints in the fleet, 0 of which collapse to a tracked file — the refusal is
 * structural rather than lucky).
 *
 * Deliberately NOT inferred: whether the author meant the roster as the
 * population. Intent is not in the tree — the same refusal `unreachableFamilies`
 * makes — so this reports the SHAPE and hands the reader the discriminator.
 * A gate that really does read only those files is silent correctly, and the
 * note says which question to answer rather than answering it.
 *
 * `coversYourPath` is the half that makes it a lead instead of a standing fact:
 * the artifacts' common directory contains one of the caller's paths. It is
 * NOT a claim that the gate reads that file — see `artifactOnlyNote` for the
 * two live shapes that are indistinguishable from the tree, and for the claim
 * that is exactly true of both. It is the one place where a roster's silence
 * could have been read as a clearance about the card, which is the only place
 * this note raises its voice.
 *
 * @param {{hints?: string[]}} entry
 * @param {string[]} paths the card's file surface
 * @param {{files: Set<string>, prefixes: Set<string>}} tree the `watchHintTree` bundle
 */
export function artifactOnlySilence(entry, paths, tree) {
  // A bare file set is exactly what this predicate used to take, and it is the
  // shape that loses every literal naming its file through a dropped
  // extension. Refused loudly rather than read as an empty answer (#4690's
  // rule, applied to a caller instead of to a corpus): a wrong CATEGORY is the
  // failure this parameter was widened to stop, and it prints as a plausible
  // sentence when it happens.
  if (!(tree?.files instanceof Set) || !(tree?.prefixes instanceof Set)) {
    throw new TypeError(
      'artifactOnlySilence needs the watch-hint TREE bundle ({files, prefixes}) from watchHintTree(), ' +
        'not a bare file set — the pair is meaningless apart, and files alone silently mis-categorises ' +
        'every family whose roster is spelled as extensionless module specifiers.',
    );
  }
  const declared = [...new Set(entry.hints ?? [])];
  if (declared.length === 0) return null;
  const artifacts = declared.map((h) => declaredFileTarget(h, tree));
  if (!artifacts.every(Boolean)) return null;
  const dir = commonDirectory(artifacts);
  const coversYourPath = Boolean(dir) && paths.some((p) => p === dir || p.startsWith(`${dir}/`));
  return { artifacts, dir, coversYourPath };
}

/**
 * The note printed under an artifact-roster family in the `--residue` listing.
 *
 * ## What it claims, and the claim it deliberately stops short of
 *
 * It does NOT say the gate reads your file. It cannot: whether a roster is a
 * baseline sitting in a directory or a census taken of it is exactly the intent
 * this tool refuses to read out of the tree, and measured on this repo the two
 * live side by side — `check:where-matcher` names one baseline JSON under
 * `scripts/` and walks `packages/**` test files, while `check-entry-guard`
 * named ten files under `scripts/` and walked all of it. An alarm that read the
 * first as "this gate very likely reads your file" would be a FABRICATED lead,
 * which this file's header prices as the expensive direction.
 *
 * What it says instead is exactly true of both: a list of files that already
 * exist can never contain one added tomorrow, so `silent` here is not evidence
 * about your path in either direction. That is the whole defect — the verdict
 * read as a clearance and was not — stated without inventing the half the tree
 * cannot answer, and with the discriminator handed to the reader.
 *
 * The remedy is spelled from the roster's OWN common directory at runtime, not
 * from a literal here: a worked example baked into this file would be a path
 * this tool does not read entering its own declared population, which is the
 * trap `DEFAULT_BASE_REF` is assembled in two halves to avoid.
 */
export function artifactOnlyNote({ artifacts, dir, coversYourPath }) {
  const what =
    // "NAME", not "are" (#13520). A literal may name its file through a
    // dropped extension, so the roster is a list of files the literals RESOLVE
    // to, and a sentence saying the literals ARE those files stopped being true
    // the moment the classifier learned to follow the resolution.
    `⚠ artifact roster: all ${artifacts.length} declared literal(s) name tracked FILES` +
    (dir ? `, under ${dir}` : '') +
    ' — artifacts this gate names (a baseline, an allowlist of current members), not a population it declares.';
  if (!coversYourPath) {
    return [
      `      ${what}`,
      dir
        ? `        Nothing of yours is under ${dir}, so this silence is an ordinary one.`
        : '        They share no directory, so this silence is an ordinary one.',
    ];
  }
  return [
    `      ${what}`,
    `        ⛔ One of YOUR paths is under ${dir}. A list of the files that already exist can never contain one added tomorrow, so this`,
    '        `silent` is not evidence about your path in EITHER direction — it is the shape that reads as a clearance and is not.',
    `        Read the gate before treating it as one. If it scans ${dir}, the fix belongs there: declare the scan surface beside the`,
    `        roster (the subtree spelling, ${dir}/**), after which it is MATCHED here. If it really reads only those files, the silence is correct.`,
  ];
}

/**
 * The artifact-roster families, as their own labelled block — printed on every
 * run, never counted among the derived families (#14880).
 *
 * ## What this block is for, and what it deliberately does not say
 *
 * `artifactOnlyNote` above says all of this per family, but only under
 * `--residue`, and only inside the silent listing a dev reading a dispatch
 * brief is not told to ask for. Measured twice on this card: a dev derived the
 * families for a diff, ran every one, and shipped a CI red carried by a gate
 * whose declared literals are its own artifacts — `check:optional-error-sink`
 * on PR #14866, then `check:error-code-provenance` on PR #14930, whose residue
 * text names the remedy in its own words. Both are invisible to a `--commands`
 * harvest by construction, for every card, not just theirs.
 *
 * So the block states the one thing that is true of every member and is not a
 * guess about intent: this derivation scores them `silent` for EVERY card in
 * the tree, so their silence is a fact about a LIST rather than a verdict about
 * your paths.
 *
 * ⛔ It does NOT call them repo-wide scanners, and the refusal is the same one
 * `artifactOnlyNote`'s docblock prices: whether a roster is a baseline sitting
 * in a directory or a census taken OF that directory is exactly the intent this
 * tool refuses to read out of the tree, and the two live side by side here
 * (`check:where-matcher` names one baseline and walks `packages/**`;
 * `check-entry-guard` named ten files under `scripts/` and walked all of it).
 * A block asserting "these are scanners you must run" would be a fabricated
 * lead over the members for which it is false — the expensive direction.
 *
 * ⛔ And it is NEVER merged into the derived list or into any count. The rows
 * are `silent`, and `commandsFor`/`familyReconciliation` read only the matched,
 * convention and always-runs rows, so the separation is structural rather than
 * a filter someone has to remember. In `--commands` the block goes to STDERR
 * for the reason every other accounting there does: stdout carries commands and
 * nothing else, and a labelled block in that stream is prose for a harvest to
 * pattern-match.
 *
 * The ⛔ subset is the correlation the card asks for by name — the rosters
 * whose common directory contains one of THIS card's paths, where the silence
 * is not evidence in either direction.
 *
 * ## The SECOND axis, and why the block owes it (#16030)
 *
 * Everything above is about the `silent` VERDICT. This block also issues an
 * instruction — "Run them, or read them" — and for some of its rows running
 * them produces a second green that is not a clearance either: the row's
 * invocation resolves to the checker's own `--self-test` and nothing else, so
 * it cannot fail for anything in the diff. Two such rows
 * (`pnpm check:partof-closing-keyword`, `pnpm check:single-claim-paths`) were
 * harvested as PR clearance; the half of each gate that judges a pull request
 * needs the event payload and runs in its own workflow, so the pnpm name is a
 * checker-health invocation ON PURPOSE and the defect is that nothing said so.
 *
 * So the rows are SPLIT, and the split is derived (`rosterCheckerHealth`)
 * rather than kept as a list here — a hand-kept list is a declaration that
 * goes stale silently, which is the shape this whole file refuses.
 *
 * ⛔ The marker rides on the ROW, not only in the sub-heading, and that is the
 * measured requirement rather than a decoration: `spellingDistribution`'s
 * docblock records what consumers of this output actually do, which is grep
 * ROWS out of the block. A caption a row-wise harvest never reads would leave
 * the two greens indistinguishable in exactly the stream that matters.
 *
 * ⛔ And a row this tool cannot resolve is named as unresolved rather than
 * defaulted into either side. Defaulting it to "judges the diff" would mint
 * the same false clearance from a different door, and defaulting it the other
 * way would suppress a row a dev owes.
 */
export function artifactRosterLines(rosters = []) {
  if (rosters.length === 0) return [];
  const inverted = rosters.filter((r) => r.coversYourPath);
  // Three-valued on purpose: `!== true` is not "judges", and `!== false` is not
  // "checker-health". Every row lands in exactly one of the three.
  const checkerHealth = rosters.filter((r) => r.checkerHealth === true);
  const judging = rosters.filter((r) => r.checkerHealth === false);
  const unresolved = rosters.filter((r) => r.checkerHealth !== true && r.checkerHealth !== false);
  const byCommand = (a, b) => a.command.localeCompare(b.command);
  const row = (r) => `  - ${r.command}${r.coversYourPath ? `   ⛔ roster under ${r.dir}, which one of your paths is in` : ''}`;
  const lines = [
    `Artifact rosters — ${rosters.length} famil(ies) whose \`silent\` verdict is a fact about a LIST, not about your paths:`,
    '  Each declares only tracked FILES — a baseline, an allowlist of the members it already has. A list of the files that',
    '  already exist can never contain one added tomorrow, so this derivation scores them silent for EVERY card in the tree,',
    '  and no path you pass can move them. ⛔ They are NOT in the runnable total above and are NOT counted among the derived',
    '  families. Run them, or read them — but ⛔ never read their silence as a clearance, and ⛔ never read a green from a row',
    '  marked below as checker-health as one either: that command grades the checker\'s own fixtures and cannot fail for your diff.',
    '  ⇒ The fix is the gate\'s, not this tool\'s: declare the scan surface beside the roster (the subtree spelling), after',
    '  which the family is MATCHED here and leaves this block.',
  ];
  if (inverted.length) {
    lines.push(
      `  ⛔ ${inverted.length} of them keep that roster in a directory one of YOUR paths is in (marked ⛔ below) — there the`,
      '  silence is not evidence in EITHER direction. Read those gates before treating them as passed.',
    );
  } else {
    lines.push('  None of their rosters sits in a directory your paths are in, so none of them is a lead about this card.');
  }
  for (const r of [...judging].sort(byCommand)) lines.push(row(r));
  if (checkerHealth.length) {
    lines.push(
      `  ⛔ ${checkerHealth.length} of these ${rosters.length} famil(ies) run ONLY the checker's own \`--self-test\` — they judge the`,
      '  checker\'s fixtures and CANNOT judge your diff, so a green from one of them is not PR clearance in either direction:',
    );
    for (const r of [...checkerHealth].sort(byCommand)) {
      lines.push(`${row(r)}   ⚠ checker-health only (--self-test) — NOT a PR verdict`);
    }
  }
  if (unresolved.length) {
    lines.push(
      `  ⚠ ${unresolved.length} row(s) whose invocation this derivation could not resolve to a command body, so it can say NEITHER`,
      '  that they judge your diff nor that they cannot. ⛔ Read them before treating either answer as settled:',
    );
    for (const r of [...unresolved].sort(byCommand)) {
      lines.push(`${row(r)}   ⚠ invocation not resolvable here — UNCLASSIFIED`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The reachability sweep — a declared population that matches NOTHING (#9883)
// ---------------------------------------------------------------------------

/**
 * Every file git tracks, repo-relative — the corpus a declared population is
 * measured against.
 *
 * ## Why it refuses an empty read instead of returning an empty list
 *
 * An empty corpus makes EVERY declared population unreachable, and that
 * prints as "the whole farm reads nothing" — a wrong answer that reads as a
 * catastrophic finding. The same empty list also arrives from a checkout that
 * is not a git work tree at all. This file already follows #4690's rule for
 * its other inputs ("an unreadable input must never look like an empty
 * answer"), so a failed or empty listing is an error here too, and the sweep
 * is never attempted over nothing.
 *
 * The null-separated form is deliberate: without it git quotes any path with a
 * non-ASCII byte in it, so a corpus containing one would carry escaped names
 * that no hint can match — a fabricated unreachable, invented by the reader of
 * the corpus rather than declared by any gate.
 */
export function trackedFiles({ cwd = ROOT } = {}) {
  const r = runGit(['ls-files', '-z'], cwd);
  if (r.status !== 0) {
    throw new Error(
      `could not list the tracked files to sweep — git exited ${r.status}${r.stderr ? `: ${r.stderr}` : ''}. ` +
        'The tier half needs no tree: pass --tier for the claim-time answer.',
    );
  }
  const files = r.stdout.split('\0').filter(Boolean);
  if (files.length === 0) {
    throw new Error(
      'the tracked-file listing came back EMPTY, so every declared population would sweep as unreachable — ' +
        'zero is a broken scan, not a clean repo (#4690). Refusing to derive a reachability verdict over nothing.',
    );
  }
  return files;
}

/**
 * Every path prefix the tree still has — each tracked file, plus every
 * directory above it. Used only to say HOW FAR a dead hint still got, never to
 * decide the verdict; the verdict is `hintCovers` and nothing else.
 */
export function trackedPrefixes(files) {
  const prefixes = new Set();
  for (const f of files) {
    prefixes.add(f);
    for (let i = f.indexOf('/'); i !== -1; i = f.indexOf('/', i + 1)) prefixes.add(f.slice(0, i));
  }
  return prefixes;
}
// ── In-tree scratch directories: the CLASS, not two named roots (#12749) ────
//
// `changedPathsFromGit` reads untracked files on purpose, so the ignore rules
// are the only thing between a killed test run's leftover fixture and every
// seat's gate list. The two-directional pin in this file's self-test holds that
// property for two paths BY NAME. The hazard is a class: any directory a
// tracked source creates inside the tracked tree at a root the ignore rules do
// not cover. A fifth fixture author who picks a new root reproduces it exactly,
// and the named pin stays green — it never looks at their file.
//
// What follows enumerates the class from source text, so the guard grows with
// the tree instead of with this file's literals.
//
// ## Why a source scan can be COMPLETE for one shape, and where it stops
//
// A path inside the repo can only be built from an anchor inside the repo, and
// tracked sources spell that anchor a handful of ways (`IN_TREE_ANCHOR_*` and
// the `new URL` form below). Everything else — `os.tmpdir()`, `RUNNER_TEMP`, an
// absolute literal — is outside the tree by construction. So the classifier has
// THREE answers, and the third carries the honesty: a site whose base it cannot
// resolve is UNRESOLVED, never "probably fine". For `mkdtempSync` — the shape
// every in-tree fixture in this tree is built from — an unresolved site is a
// FAILURE. A detector that silently skipped what it could not read would be
// this card's own defect one level up: green over the sites nobody measured.
//
// Measured on the tree at the time of writing: 359 `mkdtempSync` sites — 4 in
// the tree (the four `packages/cli` fixtures the convention names), the rest in
// the system temp directory, 0 unresolved.
//
// `mkdirSync` is swept too and deliberately NOT held to completeness: of its
// sites, ~124 take a base this resolver cannot see (a function parameter, a
// value read from config) and are overwhelmingly children of a system-temp root
// already. Demanding zero unresolved there would red the tree over sites that
// carry none of this hazard. So that half is a net of DECLARED shape: what it
// resolves it holds, what it cannot resolve it names in the report, and this
// module claims nothing more. ⛔ Do not read its silence as coverage.
//
// ## Why the verdict is `git check-ignore` and not a pattern reimplementation
//
// The rules are the repo's real ignore files, and an excerpt would pin the
// excerpt. `git check-ignore` also names the SOURCE file and line of the
// covering rule, which is the only way to tell a rule every clone has from one
// that lives in `.git/info/exclude` — a local exclusion covers its author's
// tree and nobody else's, so a root "covered" only that way is not covered.
//
// ## Why a tracked directory is not a hazard
//
// A source that creates a generated-output directory is not leaving scratch
// behind; that directory is part of the tree. The escape is DERIVED, never
// declared: a created directory git already tracks content under is tree, not
// leftover. There is no ledger to keep in step, and a directory that stops
// being tracked stops being exempt on the same run.

/** Path expressions that anchor INSIDE the repo, at the scanned file's own directory. */
const IN_TREE_ANCHOR_DIR =
  /^(?:(?:path|node:path)\.)?dirname\s*\(\s*(?:fileURLToPath\s*\(\s*import\.meta\.url\s*\)|import\.meta\.filename)\s*\)$|^import\.meta\.dirname$|^__dirname$/;

/** The same, anchored at the FILE — `resolve(<file>, '..')` is a spelling this tree writes. */
const IN_TREE_ANCHOR_FILE = /^(?:fileURLToPath\s*\(\s*import\.meta\.url\s*\)|import\.meta\.filename)$/;

/** `new URL('<rel>', import.meta.url)`, which resolves from the file's DIRECTORY. */
const IN_TREE_ANCHOR_URL = /^new\s+URL\s*\(\s*(['"`])([\s\S]*?)\1\s*,\s*import\.meta\.url\s*,?\s*\)$/;

/**
 * Expressions that put a path OUTSIDE the tree wherever they sit inside it —
 * read against the whole expression, so `realpathSync(process.env.RUNNER_TEMP)`
 * is outside however deeply the marker is nested. Deliberately spelled as exact
 * forms rather than a word list: a binding merely NAMED `TMP_ROOT` is an
 * in-tree root in this very repo.
 */
const OUTSIDE_TREE_MARKER =
  /\btmpdir\s*\(\s*\)|\bhomedir\s*\(\s*\)|process\.env\.(?:RUNNER_TEMP|TMPDIR|TEMP|TMP)\b/;

const PATH_JOINER_CALL = /^(?:(?:path|node:path)\.)?(?:join|resolve)\s*\(/;
const PATH_DIRNAME_CALL = /^(?:(?:path|node:path)\.)?dirname\s*\(/;
const MKDTEMP_CALL = /^(?:fs\.)?mkdtempSync\s*\(/;
const SCRATCH_CALL = /\b(?:fs\.)?(mkdtempSync|mkdirSync)\s*\(/g;
const QUOTED_LITERAL = /^(['"`])([\s\S]*)\1$/;
const PLAIN_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The synthetic tail a probe path carries. `mkdtempSync` appends six characters
 * the tree cannot know, so what `git check-ignore` is asked about is a
 * REPRESENTATIVE leftover rather than a path that exists: the directory the
 * call creates, plus a file inside it — the shape a killed run leaves behind.
 */
const SCRATCH_PROBE_TAIL = '0osprobe';
const SCRATCH_PROBE_LEAF = 'leftover-probe';

/** The text of a balanced argument list, starting just past its opening paren. */
function balancedArgText(source, from) {
  let depth = 1;
  let out = '';
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return { text: out, end: i };
    }
    out += ch;
  }
  return { text: out, end: source.length };
}

/** Split an argument list on top-level commas, respecting quotes and nesting. */
function splitArgList(text) {
  const args = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && i + 1 < text.length) cur += text[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) args.push(cur);
  return args;
}

/** An initialiser expression: from `from` up to the first top-level `;` or newline. */
function initialiserTail(source, from) {
  let depth = 0;
  let quote = null;
  let out = '';
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < source.length) out += source[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth--;
    } else if ((ch === ';' || ch === '\n') && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

/**
 * Every initialiser a name is given in this file, in source order.
 *
 * Scope is deliberately NOT tracked. Two scopes reusing one name is the case
 * that would make a scoped resolver wrong in the QUIET direction, so the
 * readings are combined instead: an in-tree reading anywhere wins, and readings
 * that disagree stay unknown. The bias is always toward reporting a site rather
 * than clearing it.
 */
function nameInitialisers(source) {
  const byName = new Map();
  const add = (name, init) => {
    const list = byName.get(name);
    if (list) list.push(init);
    else byName.set(name, [init]);
  };
  for (const m of source.matchAll(/(?:^|[;{}\s(])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*/g)) {
    add(m[1], initialiserTail(source, m.index + m[0].length));
  }
  for (const m of source.matchAll(/^[ \t]*([A-Za-z_$][\w$]*)\s*=\s*/gm)) {
    add(m[1], initialiserTail(source, m.index + m[0].length));
  }
  return byName;
}

/**
 * The expression every same-file function returns, when it returns exactly one
 * thing. One hop is enough for the shape this tree actually writes — a local
 * helper wrapping the system temp directory — and stopping at one hop keeps the
 * answer readable instead of a whole-program analysis nobody can check.
 */
function singleReturnExpressions(source) {
  const byName = new Map();
  for (const m of source.matchAll(/(?:^|[;{}\s])function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const params = balancedArgText(source, m.index + m[0].length);
    const open = source.indexOf('{', params.end);
    if (open === -1) continue;
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = source.slice(open, end);
    const returns = [...body.matchAll(/\breturn\s+/g)];
    if (returns.length !== 1) continue;
    byName.set(m[1], initialiserTail(body, returns[0].index + returns[0][0].length));
  }
  return byName;
}

/**
 * ── The PACKAGE ROOT a gate holds in a PARAMETER: one more spelling of a base
 *    this resolver already reads (#13518) ─────────────────────────────────────
 *
 * `nameInitialisers` reads a base a file BINDS (`const PKG_DIR = …`) and
 * `singleReturnExpressions` reads one a same-file function RETURNS. The third
 * spelling is a base a same-file function RECEIVES:
 *
 *     const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
 *     function collectSourceEntries(pkgDir) {
 *       JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));   // ← here
 *     }
 *     const entries = collectSourceEntries(PKG_DIR);
 *
 * `PKG_DIR` resolves; `pkgDir` is the same value under a parameter's name, and
 * without this hop it comes back "not bound in this file" — so a gate that
 * reads its package through one helper contributes nothing while the identical
 * gate that inlines the read contributes everything. Live specimen and the
 * reason this exists: `packages/spec/scripts/build-export-origins.ts` was the
 * one member of #13518's six the manifest edge could not reach, for no reason
 * but that spelling.
 *
 * ## Why this cannot move an answer the resolver already gives
 *
 * The hop is consulted ONLY where `ctx.names` has no binding at all, which is
 * exactly the branch that returns `unknown` today. So its whole reachable
 * effect is `unknown` -> a reading; no in-tree answer can change, and none can
 * be lost. That is a property of the placement rather than of this tree, and
 * the self-test pins it in both directions.
 *
 * ## Narrowings, each one measured
 *
 * EXACTLY ONE CALL SITE. A parameter with two callers has two values and the
 * scan would have to pick; picking is how a fabricated lead gets minted, and
 * this file errs at a missing lead everywhere. Two call sites contribute
 * nothing, and so does a name a second function declares under the same
 * spelling — the map keeps every binding it sees and the resolver takes it only
 * when there is one.
 *
 * `function` DECLARATIONS ONLY, the same shape `singleReturnExpressions` reads,
 * and its docblock's argument applies unchanged: one hop is what this tree
 * writes, and a whole-program analysis is not checkable by a reader.
 *
 * POSITIONAL parameters only. A destructured or defaulted parameter carries no
 * single identifier to bind, so it contributes nothing rather than a guess.
 */
function singleCallSiteParameters(source) {
  const byName = new Map();
  const declarations = [];
  for (const m of source.matchAll(/(?:^|[;{}\s])function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const params = balancedArgText(source, m.index + m[0].length);
    declarations.push({
      name: m[1],
      // A TYPE ANNOTATION is not part of the name: half these gate scripts are
      // TypeScript, and reading `pkgDir: string` as un-nameable would refuse
      // the very spelling this hop exists for.
      params: splitArgList(params.text).map((p) => p.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/)?.[1] ?? null),
    });
  }
  for (const fn of declarations) {
    if (!fn.params.some(Boolean)) continue;
    const sites = [];
    for (const c of source.matchAll(new RegExp(`(?<![.\\w$])${fn.name}\\s*\\(`, 'g'))) {
      // The declaration's own parameter list is not a call site.
      if (/\bfunction\s+$/.test(source.slice(Math.max(0, c.index - 16), c.index))) continue;
      sites.push(c);
    }
    if (sites.length !== 1) continue;
    const args = splitArgList(balancedArgText(source, sites[0].index + sites[0][0].length).text).map((a) => a.trim());
    fn.params.forEach((p, i) => {
      if (!p || !args[i]) return;
      const list = byName.get(p);
      if (list) list.push(args[i]);
      else byName.set(p, [args[i]]);
    });
  }
  return byName;
}

/**
 * Walk repo-relative segments by one path literal. Returns null when the
 * literal climbs out of the repo or carries a dynamic part this resolver
 * refuses to guess at — the caller turns both into the answers they deserve.
 */
function walkSegments(segs, literal, isLast) {
  let text = literal;
  const dynamic = text.indexOf('${');
  if (dynamic !== -1) {
    // A dynamic part is readable only as a PREFIX, and only where it cannot
    // introduce a separator of its own after the static head — otherwise the
    // depth the call reaches is a runtime value.
    if (!isLast || text.includes('/')) return null;
    text = text.slice(0, dynamic);
  }
  if (text.startsWith('/')) return null;
  const out = segs.slice();
  for (const part of text.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/** The created directory of a `mkdtempSync(<base>)`: the base plus a random tail. */
function withProbeTail(segs) {
  if (segs.length === 0) return null;
  const out = segs.slice();
  out[out.length - 1] = `${out[out.length - 1]}${SCRATCH_PROBE_TAIL}`;
  return out;
}

/**
 * The literal text of one path COMPONENT of a `join()`/`resolve()` — directly
 * when it is written as a literal, or through ONE hop when it is a name bound
 * to one (#13511).
 *
 * The base of a path expression already resolves through `ctx.names`; only the
 * components after it were required to be written out. That asymmetry refused
 * the idiom this tree actually writes for running a sibling program —
 * `spawnSync(process.execPath, [join(ROOT, TOOL)])`, where `TOOL` is the
 * module-body constant a gate declares its subject in — so the whole expression
 * came back `unknown` and the edge contributed nothing.
 *
 * ONE hop, and only to a LITERAL: an initialiser that is itself an expression
 * is left to the base resolver above, which is where multi-hop reasoning
 * belongs and where its cycle guard lives. A name with more than one
 * initialiser is refused rather than guessed at — a rebound name has no single
 * reading, and `combineReadings`' preference for an in-tree answer is a rule
 * about BASES, where the readings are path expressions, not about a component
 * where they are raw text. Refusal here costs a lead; a wrong reading costs a
 * fabricated one, which this file's header prices higher.
 *
 * Template literals are returned as written, `${}` included: `walkSegments`
 * already reads one as a prefix and refuses it where a runtime part could
 * introduce a separator, so this hop inherits that judgement instead of
 * repeating it.
 *
 * ## What the hop costs its OTHER callers, measured (c0770d0b7)
 *
 * This resolver is shared, so widening it is not free by inspection. Every
 * consumer, before -> after:
 *
 *   anchored read targets over the gate corpus      73 -> 101
 *   ...of PROGRAM TEXT, which is what `entry.reads` takes    5 -> 15
 *   (family, file) pairs those add through coveringKey            +3
 *   in-tree scratch-dir sites                        17 -> 17  (unchanged)
 *   unresolved scratch-dir expressions             154 -> 154  (unchanged)
 *
 * The scratch scan does not move at all: its bases are anchors, not named
 * constants. The ten new read targets are gates opening the very file they
 * grade at `join(<root>, <CONST>)` — `check:pm-label-desc-cap` reading
 * `scripts/pm/ensure-pm-labels.sh` is the plainest of them — reads that were
 * invisible only because the path was spelled through a name.
 */
function componentLiteral(expr, ctx) {
  const direct = expr.match(QUOTED_LITERAL);
  if (direct) return direct[2];
  if (!PLAIN_IDENTIFIER.test(expr)) return null;
  if (ctx.seen.has(expr)) return null;
  const inits = ctx.names.get(expr);
  if (!inits || inits.length !== 1) return null;
  const lit = inits[0].trim().match(QUOTED_LITERAL);
  return lit ? lit[2] : null;
}

/**
 * Where a path expression lands, relative to the repo root.
 *
 *   { kind: 'in-tree', segs }  — repo-relative segments
 *   { kind: 'outside' }        — the system temp directory, a home directory, an absolute path
 *   { kind: 'unknown', why }   — a base this resolver refuses to guess at
 */
export function resolvePathExpression(expr, ctx, depth = 0) {
  let e = String(expr).trim();
  if (!e) return { kind: 'unknown', why: 'an empty expression' };
  if (depth > 10) return { kind: 'unknown', why: 'an expression nested deeper than this resolver reads' };
  if (OUTSIDE_TREE_MARKER.test(e)) return { kind: 'outside' };

  // `fileURLToPath(<url>)` and `<url>.pathname` are spellings OF a URL anchor,
  // not path operations of their own.
  if (e.endsWith('.pathname')) e = e.slice(0, -'.pathname'.length).trim();
  const unwrapped = e.match(/^fileURLToPath\s*\(/);
  if (unwrapped) {
    const inner = balancedArgText(e, e.indexOf('(') + 1);
    if (e.slice(inner.end + 1).trim() === '' && !IN_TREE_ANCHOR_FILE.test(e)) {
      return resolvePathExpression(inner.text, ctx, depth + 1);
    }
  }

  if (IN_TREE_ANCHOR_DIR.test(e)) return { kind: 'in-tree', segs: ctx.fileSegs.slice(0, -1) };
  if (IN_TREE_ANCHOR_FILE.test(e)) return { kind: 'in-tree', segs: ctx.fileSegs.slice() };
  const url = e.match(IN_TREE_ANCHOR_URL);
  if (url) {
    const segs = walkSegments(ctx.fileSegs.slice(0, -1), url[2], true);
    return segs ? { kind: 'in-tree', segs } : { kind: 'unknown', why: `a URL anchor that leaves the tree: ${e}` };
  }

  const quoted = e.match(QUOTED_LITERAL);
  if (quoted) {
    if (quoted[2].startsWith('/')) return { kind: 'outside' };
    return { kind: 'unknown', why: `a bare relative literal, resolved against a cwd this scan cannot see: ${e}` };
  }

  for (const [head, kind] of [[PATH_JOINER_CALL, 'join'], [PATH_DIRNAME_CALL, 'dirname'], [MKDTEMP_CALL, 'mkdtemp']]) {
    if (!head.test(e)) continue;
    const { text, end } = balancedArgText(e, e.indexOf('(') + 1);
    if (e.slice(end + 1).trim() !== '') return { kind: 'unknown', why: `a path expression with a tail this scan cannot read: ${e.slice(0, 80)}` };
    const args = splitArgList(text).map((a) => a.trim());
    const base = resolvePathExpression(args[0] ?? '', ctx, depth + 1);
    if (base.kind !== 'in-tree') return base;
    if (kind === 'dirname') {
      if (base.segs.length === 0) return { kind: 'unknown', why: 'a dirname that climbs out of the repo root' };
      return { kind: 'in-tree', segs: base.segs.slice(0, -1) };
    }
    if (kind === 'mkdtemp') {
      const segs = withProbeTail(base.segs);
      return segs ? { kind: 'in-tree', segs } : { kind: 'unknown', why: 'a mkdtempSync rooted at the repo root itself' };
    }
    let segs = base.segs;
    for (let i = 1; i < args.length; i++) {
      const lit = componentLiteral(args[i], ctx);
      if (lit === null) return { kind: 'unknown', why: `a path component this scan cannot read: ${args[i]}` };
      const walked = walkSegments(segs, lit, i === args.length - 1);
      if (!walked) return { kind: 'unknown', why: `a path component built at runtime or leaving the tree: ${args[i]}` };
      segs = walked;
    }
    return { kind: 'in-tree', segs };
  }

  if (PLAIN_IDENTIFIER.test(e)) {
    if (ctx.seen.has(e)) return { kind: 'unknown', cycle: true, why: `the binding ${e} resolves through itself` };
    // A PARAMETER is consulted only where nothing BINDS the name, which is the
    // branch that returned `unknown` before this hop existed — so the hop can
    // add a reading and can never move one (`singleCallSiteParameters`).
    const params = ctx.params?.get(e);
    const inits = ctx.names.get(e) ?? (params?.length === 1 ? params : undefined);
    if (!inits) return { kind: 'unknown', why: `${e} is not bound in this file` };
    ctx.seen.add(e);
    const readings = inits.map((init) => resolvePathExpression(init, ctx, depth + 1));
    ctx.seen.delete(e);
    return combineReadings(readings, e);
  }

  const call = e.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (call && ctx.returns.has(call[1])) {
    if (ctx.seen.has(call[1])) return { kind: 'unknown', cycle: true, why: `${call[1]}() resolves through itself` };
    ctx.seen.add(call[1]);
    const r = resolvePathExpression(ctx.returns.get(call[1]), ctx, depth + 1);
    ctx.seen.delete(call[1]);
    return r;
  }

  return { kind: 'unknown', why: `a base this scan cannot read: ${e.slice(0, 80)}` };
}

/**
 * In-tree wins; readings that are not unanimously outside stay unknown.
 *
 * A reading that came back through a CYCLE carries no information — the name is
 * re-entered while it is already being resolved, which happens whenever a later
 * scope rebinds a name from the value this one is resolving. It is dropped
 * rather than counted as disagreement: counting it turned every name a helper
 * rebinds into `unknown`, which is a refusal to answer rather than an answer.
 */
function combineReadings(readings, name) {
  const informative = readings.filter((r) => !r.cycle);
  const inTree = informative.find((r) => r.kind === 'in-tree');
  if (inTree) return inTree;
  if (informative.length > 0 && informative.every((r) => r.kind === 'outside')) return { kind: 'outside' };
  const why = informative.find((r) => r.kind === 'unknown')?.why
    ?? readings.find((r) => r.kind === 'unknown')?.why
    ?? `nothing bound ${name}`;
  return { kind: 'unknown', why };
}

/**
 * Every directory-creating call in one source, classified. `rel` is the file's
 * own repo-relative path — the anchor spellings resolve against it.
 */
export function scratchDirSitesInSource(rel, source) {
  const masked = maskedComments(String(source));
  // A call spelled inside a STRING is a fixture, not a call — this module's own
  // self-test plants fixture sources as string literals, and read as code they
  // reported four sites in a file that creates none of them. Comments are
  // blanked (a discussed call is not a call either) but literals are not: the
  // path components the resolver reads ARE string literals, so they are skipped
  // by position instead. ⛔ Not the same masking `maskSelfTests` does — a check
  // script's self-test that really creates an in-tree directory is a real
  // leftover hazard, and blanking self-tests wholesale would hide it.
  const { literal } = scanSource(masked);
  const ctx = {
    fileSegs: rel.split('/'),
    names: nameInitialisers(masked),
    returns: singleReturnExpressions(masked),
    params: singleCallSiteParameters(masked),
    seen: new Set(),
  };
  const inTree = [];
  const unresolved = [];
  let scanned = 0;
  for (const m of masked.matchAll(SCRATCH_CALL)) {
    if (literal[m.index]) continue;
    const { text } = balancedArgText(masked, m.index + m[0].length);
    const expr = (splitArgList(text)[0] ?? '').trim();
    ctx.seen.clear();
    const at = resolvePathExpression(expr, ctx);
    const site = {
      file: rel,
      line: masked.slice(0, m.index).split('\n').length,
      call: m[1],
      expr: expr.replace(/\s+/g, ' ').slice(0, 120),
    };
    scanned++;
    if (at.kind === 'unknown') {
      unresolved.push({ ...site, why: at.why });
      continue;
    }
    if (at.kind !== 'in-tree') continue;
    const segs = m[1] === 'mkdtempSync' ? withProbeTail(at.segs) : at.segs;
    if (!segs || segs.length === 0) continue;
    inTree.push({ ...site, dir: segs.join('/'), probe: [...segs, SCRATCH_PROBE_LEAF].join('/') });
  }
  return { inTree, unresolved, scanned };
}

/**
 * ── The PROGRAM a gate opens by path, one hop from an import (#13000) ───────
 *
 * `firstPartyImportTargets` above follows the one undeclared dependency this
 * tool knew about: a gate's `./sibling.mjs` import. A gate has a second kind,
 * spelled in ordinary code rather than in an import statement — a repo file it
 * opens at a path it builds from its OWN location:
 *
 *     readFileSync(join(__dirname, 'check-adr-0087-registration.mjs'), 'utf8')
 *
 * ## The measured miss
 *
 * `scripts/objectui-changeset-digest.mjs` builds a throwaway repo and stages a
 * COPY of `scripts/check-adr-0087-registration.mjs` into it, then runs the copy
 * — the only thing that settles a claim about another gate's verdict. A PR that
 * added an import to the staged gate broke the digest's self-test with
 * ERR_MODULE_NOT_FOUND, and this derivation had scored `check:objectui-changeset`
 * `silent` for that diff: the family declares exactly one population
 * (`.changeset`), and the gate-script IDENTITY key fires on the edited gate's
 * OWN families, never on the families of a gate that runs a copy of it.
 *
 * Why the literal did not reach `extractWatchHints` is worth naming, because it
 * is not an oversight to repair there: that scan runs `maskSelfTests` first, so
 * a fixture path planted in a self-test cannot become the gate's population.
 * The staging sits inside the digest's `--self-test`, and the invocation CI runs
 * IS that self-test. So the two scans want opposite things from the same bytes —
 * a self-test's fixture LITERALS are not the gate's population, while the files
 * its self-test really opens are the gate's inputs — and this one deliberately
 * masks comments only.
 *
 * ## Why PROGRAM TEXT and not every file a gate opens
 *
 * Measured on this tree, over the 181 discovered families:
 *
 *   any tracked read target        81 pairs, 62 of them leads no other key gives
 *   ...of PROGRAM TEXT only         5 novel leads
 *   ...that are themselves gates    2 novel leads
 *
 * The widest reading is not WRONG — every one of the 62 is a file some gate
 * really opens, and editing it really can turn that gate red. It is a different
 * and larger card: 34 of the 62 land on four files (`package.json` +12,
 * `.github/workflows/lint.yml` +9, `packages/spec/package.json` +8,
 * `turbo.json` +5), which would take a root-manifest card from 5 leads to 17.
 * This file's header prices that direction ("22 leads is the same as none"), so
 * the data half is left for a card that pays for it.
 *
 * The line drawn instead is one the reader can state: a gate that opens another
 * file's PROGRAM TEXT depends on that PROGRAM, and the shapes that dependency
 * takes — stage it, execute it, assert on it — are three spellings of the same
 * fact. A gate that opens data it PARSES is the other question. Restricting the
 * TARGET rather than trying to recognise the write is also what keeps this
 * derived: the writes in this tree go through local helpers (`gw(rel, text)`,
 * `writeFixtureFile(dest, text)`) whose NAMES are the only thing saying they
 * write, and matching a name and calling it semantics is the failure this card
 * exists to avoid, one level in.
 *
 * Cost of the target restriction, stated rather than implied: a stager whose
 * sandbox copies a JSON or Markdown input is not followed. `scripts/objectui-
 * changeset-digest.mjs` stages ADR-0087's record beside the gate for exactly
 * that reason, and this scan does not name it.
 *
 * ## What makes this precise where `git grep` is not
 *
 * The other mechanisation on the table was a grep of stager scripts for the
 * edited gate's filename. Measured on this tree, a basename grep over the 5404
 * tracked sources hits 924 mentions in 451 files; blanking comments leaves 372
 * in 187, still almost entirely fixture names and prose. This scan reports 5.
 *
 * Three refusals do it, all borrowed from `scratchDirSitesInSource`, which
 * reads path expressions for a different question and pays for this half:
 *
 *   - comments are BLANKED, so a docblock naming a gate is not a read of it;
 *   - a call spelled inside a STRING literal is skipped by POSITION, so a
 *     fixture source planted in a self-test is not a call;
 *   - the argument is RESOLVED, never matched: an expression this scan cannot
 *     read comes back `unknown` and contributes nothing, and a resolved path
 *     that is not TRACKED contributes nothing either.
 *
 * The last one is also the boundary, and it is a MISSING lead by construction:
 * a read whose path is built from a loop variable — `for (const f of [...])
 * readFileSync(join(__dirname, f))`, which the digest writes five times — has
 * no resolvable base, so it is refused. `scripts/bump-objectui.sh` is reached
 * here only because the same file also reads it at a spelled-out path. ⛔ Do
 * not close that by admitting the basename literal: that is the grep above.
 *
 * The gate's own file is dropped — a script that stages a copy of ITSELF is
 * already matched by the identity key, and naming it again would print the same
 * family twice under a weaker provenance.
 *
 * @param {string} rel  repo-relative path of the gate script
 * @param {string} source  its contents
 * @param {(path: string) => boolean} isTracked
 * @returns {string[]} repo-relative paths, in source order, deduped
 */
const SOURCE_READ_CALL = /\b(?:fs\.)?(?:readFileSync|copyFileSync)\s*\(/g;

/**
 * The read-call vocabulary the GOVERNED-READ CENSUS scans with (#18673) — a
 * strict superset of `SOURCE_READ_CALL`, adding the asynchronous spellings and
 * the `promises` namespaces.
 *
 * The census's job is to find every structural read of a governed file, which
 * includes ones the derivation's own edge cannot carry. A read written
 * `await fs.promises.readFile(join(ROOT, 'AGENTS.md'))` is exactly as much a
 * population claim on `AGENTS.md` as the sync spelling, and a census that could
 * not see it would report a clean tree while the claim went underived —
 * a verifier that silently degrades, which this tree prices as worse than none.
 * Seeing it and refusing it names the remedy; not seeing it names nothing.
 */
export const GOVERNED_READ_CALL = /\b(?:fs\.|fsp\.|promises\.)?(?:readFileSync|readFile|copyFileSync)\s*\(/g;

/** Program text, as opposed to data a gate parses — see the docblock above. */
export const PROGRAM_TEXT_TARGET = /\.(?:[cm]?[jt]sx?|sh)$/;

/**
 * Program text this file's JS masker cannot read — derived from the other two
 * kind tests rather than listed, so it cannot drift away from them (#16132).
 *
 * `PROGRAM_TEXT_TARGET` decides which kinds a population follow may reach;
 * `SCANNED_SOURCE_EXTENSIONS` names the JS/TS half `maskedModuleBody` was
 * written for. The remainder is the half whose comment syntax that masker does
 * not know, and today it is exactly `.sh`. Spelling it as the DIFFERENCE means a
 * kind added to the follow arrives already masked: the widening that admits it
 * is the same edit that routes it here. A kind whose comments are not `#`
 * would be over-masked by that default, which is a missing lead rather than a
 * fabricated one — the direction the two scans next door both state.
 */
export function hashCommentProgram(scriptPath) {
  return (
    typeof scriptPath === 'string'
    && PROGRAM_TEXT_TARGET.test(scriptPath)
    && !SCANNED_SOURCE_EXTENSIONS.test(scriptPath)
  );
}

/**
 * The program files, of the tracked files a gate opens at an anchored path.
 *
 * Two functions rather than one, and the split is the DECISION: `anchoredReadTargets`
 * answers what the scan can see, and this one applies the boundary this card
 * drew. Kept apart so the self-test can price the refused half from the same
 * primitive — a restriction measured only through itself reads 0 refusals
 * whether it refuses much or nothing, which is how the first spelling of that
 * case passed as a green over an instrument that could not return non-zero.
 */
export function readProgramTargetsInSource(rel, source, isTracked) {
  return anchoredReadTargets(rel, source, isTracked).filter((t) => PROGRAM_TEXT_TARGET.test(t));
}

/**
 * Every TRACKED file the source opens at a path anchored to its own location.
 *
 * `calls` is the read-call vocabulary, and it is a PARAMETER for one reason
 * (#18673): the derivation's edge and the governed-read census ask this same
 * question with different eyes. The edge follows `SOURCE_READ_CALL` — the
 * synchronous spellings a population follow was measured on. The census passes
 * `GOVERNED_READ_CALL`, a strict superset, so a governed file opened in a
 * spelling the edge does not carry is REPORTED rather than silently absent.
 * ⛔ Widening the default is a different change with its own blast radius over
 * every family; this parameter widens the READING, never the follow.
 */
export function anchoredReadTargets(rel, source, isTracked, { calls = SOURCE_READ_CALL } = {}) {
  const masked = maskedComments(String(source));
  const { literal } = scanSource(masked);
  const ctx = {
    fileSegs: rel.split('/'),
    names: nameInitialisers(masked),
    returns: singleReturnExpressions(masked),
    params: singleCallSiteParameters(masked),
    seen: new Set(),
  };
  const out = [];
  for (const m of masked.matchAll(calls)) {
    if (literal[m.index]) continue;
    const { text } = balancedArgText(masked, m.index + m[0].length);
    const expr = (splitArgList(text)[0] ?? '').trim();
    ctx.seen.clear();
    const at = resolvePathExpression(expr, ctx);
    if (at.kind !== 'in-tree' || at.segs.length === 0) continue;
    const path = at.segs.join('/');
    if (path === rel || out.includes(path) || !isTracked(path)) continue;
    out.push(path);
  }
  return out;
}

/**
 * ── GOVERNED SURFACES, and the census of the scripts that READ them (#18673) ─
 *
 * The rule-layer files of this repository: `AGENTS.md`, `CLAUDE.md`, and
 * everything under `.claude/` and `skills/`. They are the surfaces Prime
 * Directive #14 reserves to the maintainer, and — the property this scan is
 * about — they are surfaces a CARD edits, while a gate somewhere else asserts
 * something structural about them.
 *
 * ⛔ This is not a second copy of the governance register. `check-governed-
 * merges.mjs` owns WHO may land a diff touching one; this predicate answers a
 * different question — "is a read of this path a population claim a derivation
 * has to carry?" — and the two would not stay in step if either tried to be the
 * other. What they share is the shape of the surface, and that is spelled here
 * for this question only.
 */
export const GOVERNED_SURFACE_PREFIXES = Object.freeze(['.claude/', 'skills/']);
export const GOVERNED_SURFACE_FILES = Object.freeze(['AGENTS.md', 'CLAUDE.md']);

export function isGovernedSurfacePath(path) {
  const p = String(path ?? '');
  return GOVERNED_SURFACE_FILES.includes(p) || GOVERNED_SURFACE_PREFIXES.some((dir) => p.startsWith(dir));
}

/** The cheap prefilter, derived from the two rosters so it cannot drift from them. */
const GOVERNED_SURFACE_MENTION = new RegExp(
  [...GOVERNED_SURFACE_PREFIXES, ...GOVERNED_SURFACE_FILES]
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
);

/**
 * Every (script, governed file) pair in the tree where a script under
 * `scripts/` opens a governed surface at an anchored path, and whether the
 * script DECLARES that read.
 *
 * ## Why the census exists, and why it is not just this card's gate
 *
 * The defect this card was filed for is one instance of a class: a gate whose
 * self-test asserts something about a governed file is not derived for a change
 * to that file, so a dev who runs the prescribed derivation and reconciles
 * `--ran` is handed a complete-looking list that CI contradicts. Fixing the one
 * instance leaves the class, and the class is invisible — nothing anywhere
 * counts these reads. So the reads are counted here, on every run, and the
 * self-test holds the count to a pinned roster: a NEW governed read arrives
 * either declared or red, never silent.
 *
 * ## The eyes are deliberately WIDER than the derivation's edge
 *
 * Scanned with `GOVERNED_READ_CALL`, a strict superset of the vocabulary the
 * population follow uses. A governed file opened in a spelling the follow
 * cannot carry is a real claim that the derivation will miss, and the census
 * exists to SAY so. Seeing it and refusing it names the remedy — widen the
 * follow — where not seeing it names nothing and reads as a clean tree.
 *
 * @param {{ files?: Set<string>|null, read?: ((rel: string) => string)|null }} [options]
 * @returns {{ script: string, file: string, declared: boolean }[]} sorted by script, then file
 */
export function governedReadCensus({ files = null, read = null } = {}) {
  const tracked = files ?? new Set(trackedFiles());
  const readSource = read ?? ((rel) => readFileSync(nodePath.join(ROOT, rel), 'utf8'));
  const isTracked = (t) => tracked.has(t);
  const rows = [];
  for (const rel of [...tracked].sort()) {
    if (!rel.startsWith('scripts/')) continue;
    if (!SCANNED_SOURCE_EXTENSIONS.test(rel)) continue;
    let source;
    try {
      source = readSource(rel);
    } catch {
      continue;
    }
    if (!GOVERNED_SURFACE_MENTION.test(source)) continue;
    const governed = anchoredReadTargets(rel, source, isTracked, { calls: GOVERNED_READ_CALL })
      .filter(isGovernedSurfacePath);
    if (governed.length === 0) continue;
    // Graded against the DEFAULT vocabulary, exactly as `discoverFamilies`
    // grades it: a declaration is only ever as good as the read the follow can
    // carry, and one naming a path only the wider scan reaches throws here
    // rather than passing as coverage the derivation does not have.
    const declared = new Set(
      declaredSelfTestReads(source, anchoredReadTargets(rel, source, isTracked), rel)?.population ?? [],
    );
    for (const file of [...governed].sort()) rows.push({ script: rel, file, declared: declared.has(file) });
  }
  return rows;
}

// `GOVERNED_READ_FLOOR` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

/**
 * ── The PROGRAM a gate RUNS: the third spelling of the same fact (#13511) ───
 *
 * `readProgramTargetsInSource` above draws the line this one is on the other
 * side of. Its own docblock states it: "a gate that opens another file's
 * PROGRAM TEXT depends on that PROGRAM, and the shapes that dependency takes —
 * stage it, execute it, assert on it — are three spellings of the same fact."
 * The scan there recognises ONE of the three, the `readFileSync`/`copyFileSync`
 * spelling. This one recognises EXECUTE:
 *
 *     spawnSync(process.execPath, [join(ROOT, TOOL), '--self-test'])
 *
 * ## Why the missing spelling cost a CI round
 *
 * `check:pm-dispatch-gates` runs `scripts/pm/dispatch-gates.mjs --self-test`,
 * and that run READS EVERY WORKFLOW FILE IN THE TREE. A PR adding exactly one
 * `.github/workflows/*.yml` derived its families WITH THIS TOOL, ran every one
 * of them green, and reddened `Lint & Repo Gates` on that gate — on an
 * assertion about the new workflow file. The derivation had scored the family
 * `silent`: the gate script declares three literals and all three are tracked
 * FILES under `scripts/`, so nothing in it could cover a path under
 * `.github/workflows/`. The gate's read surface was a strict superset of the
 * surface it was derived for, and the tool's promise — "these are the gates
 * your diff implicates" — was not kept for that surface.
 *
 * ⛔ The fix is NOT this gate's name in a table. Adding one gate name to a
 * derivation is the repair this lane's triage has ruled against three times,
 * on the ground that the same red keeps shipping under the next gate's name.
 * What is added here is an EDGE, and the class closes with it: any gate that
 * runs an in-tree program inherits that program's declared population, today
 * and for every gate written after this one, with nothing to keep in step.
 *
 * ## The rule this completes, rather than a new one beside it
 *
 * The general rule already exists in this file — `firstPartyImportTargets` and
 * `hintsOfModule` follow a gate to a module it IMPORTS and append that module's
 * declared population to the gate's own. Exec is the same relation over a
 * different edge, so it routes through the same three pieces and adds none:
 * `declaredInheritedPopulation` narrows what a follower inherits (the target's
 * own declaration, checked against what it really spells and unable to invent),
 * `entry.hintOrigin` labels the inherited hint so it never travels as a claim
 * the gate made itself, and the follow refuses a target that is itself a
 * discovered gate file for the reason recorded there.
 *
 * That the pieces were already in place is measurable rather than lucky:
 * `scripts/pm/dispatch-gates.mjs` has carried an `inherited-population`
 * declaration naming `.github/workflows` — and nothing else of its nine
 * literals — since #11556, written for importers. This edge is what lets a
 * caller that spawns it read that declaration too.
 *
 * ## Narrowings, each one measured
 *
 * ARGV FORMS ONLY — `spawnSync`, `spawn`, `execFileSync`, `execFile`. The shell
 * forms (`execSync`, `exec`) take a COMMAND STRING, and a command string is a
 * quoted literal that `resolvePathExpression` refuses by construction, so
 * admitting them would add a scan that cannot return a target: dead code that
 * reads as coverage. Live specimens of the refused class in this tree, both
 * shell-quoted: `pnpm -s ${script}` and `git rev-parse --show-toplevel`.
 *
 * THE PROGRAM POSITION ONLY — argument 0, plus the elements of an argv ARRAY
 * LITERAL in argument 1. That is where a program path is; an options object is
 * not scanned, and an argv passed as a BINDING (`spawnSync(execPath, args)`)
 * contributes nothing rather than a guess. Missing lead, never a fabricated
 * one — the direction this file errs in everywhere.
 *
 * RESOLVED, NEVER MATCHED, and TRACKED PROGRAM TEXT only: the same three
 * refusals `anchoredReadTargets` documents, from the same primitive. A bare
 * `'git'` is a quoted literal with no anchor and comes back `unknown`;
 * `process.execPath` is a base this scan cannot read; a `tscBin` under
 * `node_modules/` resolves but is not tracked.
 *
 * THE GATE'S OWN FILE IS DROPPED, for the reason stated one function up: the
 * PROXY REARM idiom in this tree re-execs the running script (`SELF_PATH`,
 * `fileURLToPath(import.meta.url)`), and a family that runs a copy of itself is
 * already matched by identity.
 *
 * NEVER A TARGET THAT IS ITSELF A DISCOVERED GATE FILE, and a `--self-test`
 * family follows no edge at all — the two refusals the import follow makes,
 * applied here unchanged because their arguments are about the RELATION, not
 * about how it was spelled. Both are live rather than theoretical: two families
 * spawn `scripts/docs-audit/affected-docs.mjs`, which is a gate file, and
 * neither inherits its four literals. The self-test refusal costs zero on this
 * tree — no `--self-test` family reaches an in-tree program by spawn.
 *
 * ## Blast radius, measured before the change and after it (c0770d0b7)
 *
 * A rule that moves rows moves them for EVERY family, so the price is the
 * deliverable and not a footnote. Over 196 discovered families and 7673 tracked
 * files, counted through `coveringKey` — the same key the printed block renders
 * from — and including the component hop `componentLiteral` adds:
 *
 *   (family, file) pairs the derivation covers   164087 -> 164119  (+32)
 *   pairs LOST                                                          0
 *   pairs RE-ATTRIBUTED (same pair, new via)                            0
 *   families whose VERDICT changes                                      1
 *
 * The one verdict is `check:pm-dispatch-gates`, silent -> matched, and 29 of
 * the 32 pairs are its: one per workflow file in the tree, which is the defect
 * exactly. The other three arrive through the component hop, on the READ key
 * next door. Nothing here names twenty gates for a diff — a derivation that did
 * would be useless in a different way, and this file's header prices that
 * direction as "22 leads is the same as none".
 *
 * @param {string} rel  repo-relative path of the gate script
 * @param {string} source  its contents
 * @param {(path: string) => boolean} isTracked
 * @returns {string[]} repo-relative paths, in source order, deduped
 */
const SPAWN_CALL = /(?<![.\w$])(?:(?:cp|child_process)\.)?(?:spawnSync|spawn|execFileSync|execFile)\s*\(/g;

export function spawnedProgramTargets(rel, source, isTracked) {
  // Masked like `firstPartyImportTargets`, not like `anchoredReadTargets`: this
  // follow inherits a POPULATION, and a spawn written inside a self-test body
  // is a fixture the self-test drives rather than the gate's work. The read
  // scan next door wants the opposite from the same bytes, and says so.
  const masked = maskedModuleBody(String(source));
  const { literal } = scanSource(masked);
  const ctx = {
    fileSegs: rel.split('/'),
    names: nameInitialisers(masked),
    returns: singleReturnExpressions(masked),
    params: singleCallSiteParameters(masked),
    seen: new Set(),
  };
  const out = [];
  for (const m of masked.matchAll(SPAWN_CALL)) {
    if (literal[m.index]) continue;
    const { text } = balancedArgText(masked, m.index + m[0].length);
    const args = splitArgList(text);
    const positions = [(args[0] ?? '').trim()];
    const argv = (args[1] ?? '').trim();
    if (argv.startsWith('[') && argv.endsWith(']')) {
      positions.push(...splitArgList(argv.slice(1, -1)).map((a) => a.trim()));
    }
    for (const expr of positions) {
      if (!expr) continue;
      ctx.seen.clear();
      const at = resolvePathExpression(expr, ctx);
      if (at.kind !== 'in-tree' || at.segs.length === 0) continue;
      const path = at.segs.join('/');
      if (path === rel || out.includes(path) || !isTracked(path)) continue;
      if (!PROGRAM_TEXT_TARGET.test(path)) continue;
      out.push(path);
    }
  }
  return out;
}

/**
 * ── The PACKAGE a gate re-derives from: the fourth edge, and the one that is
 *    not a program (#13518) ────────────────────────────────────────────────────
 *
 * The three scans above all end at a PROGRAM — a module the gate imports, a
 * file whose program text it opens, a program it spawns — but only TWO of them
 * inherit that program's declared population. The import and spawn scans feed
 * `hintsOfModule` in `discoverFamilies`; the READ scan does not, and nothing
 * feeds `entry.reads` into it. It reaches a card through the LAST key in
 * `coveringKey`, which is an identity claim about a single FILE (#13000) and
 * never a population. Measured on this tree: the read edge is 12 families, 16
 * (family, target) pairs over 15 distinct targets, and it carries 0 inherited
 * hints — against 373 for the import edge, 7 for the manifest edge and 1 for
 * the run edge (#14289). Reading a program's TEXT is not performing its work,
 * and identity-only is the correct behaviour, so the claim was the defect
 * rather than the code.
 *
 * ⚠️ TWO numberings live in this file and they count different things. Here the
 * edges are numbered in SOURCE ORDER, all four of them, which makes this one
 * the fourth. `discoverFamilies` numbers only the POPULATION FOLLOWS — import,
 * spawn, manifest — which makes the same edge its third. Neither is wrong; the
 * sentence claiming three population follows all ending at a program was, and
 * that is what is repaired above.
 *
 * This one ends at DATA: a workspace package's
 * `package.json`, whose `exports` map is the tree's own declaration of what a
 * package's public entry points ARE.
 *
 * ## The class this closes, and why every member of it fell out at once
 *
 * #13518 measured six gates that all re-derive their population from
 * `@objectstack/spec`'s public export surface — `check:api-surface`,
 * `check:export-origins`, `check:entry-nameability`, `check:exported-any`,
 * `check:dual-source-exports`, `check:browser-reachable-entries` — and found
 * every one of them ABSENT from the derivation for `packages/spec/src/index.ts`,
 * the entry point that IS their subject. Not six defects: one.
 *
 * None of the six spells its subject as a path. Each reads
 * `<pkg>/package.json`, walks its `exports` map, and resolves each subpath to
 * a built `dist/*.d.ts` (or, for `build-export-origins.ts`, to
 * `src/<sub>/index.ts`). So the population is COMPUTED, through the manifest,
 * and the two places a literal could have carried it both fail:
 *
 *   - `dist/` is a build OUTPUT and untracked, so any literal reaching it dies
 *     in the reachability sweep by construction — `moduleRelativeDirectoryHint`
 *     already prices this class ("build OUTPUT directories … hints that would
 *     print and reach nothing");
 *   - the literals these gates DO write are anchored at a package root
 *     (`resolve(PKG_DIR, 'src/index.ts')`), and `extractWatchHints` resolves
 *     against exactly one anchor, the writer's own directory. A literal with no
 *     `./` prefix is taken from the ROOT, so `'src/index.ts'` becomes the
 *     repo-root hint `src/index.ts` and reaches nothing. The live proof that
 *     this is a class and not a story is printed on a SEVENTH gate today:
 *     `check:generated`'s dead leads are `src/meta-spelling/…`, `api-surface`
 *     and `export-origins` — three literals alive under `packages/spec/` and
 *     dead at the root.
 *
 * ⛔ The repair is therefore NOT these six names in a table. This lane's triage
 * has ruled against that three times, on the ground that the same red keeps
 * shipping under the next gate's name. What is added is an EDGE, and the class
 * closes with it: any gate that re-derives from a package's export surface
 * reaches that package's source, today and for every gate written after this
 * one, with nothing to keep in step.
 *
 * ## What is inherited, and why it is read from the MANIFEST and not the gate
 *
 * `hintsOfManifest` (in `discoverFamilies`) answers with the package's tracked
 * SOURCE subtree, and it answers only for a manifest that declares an
 * `exports` map. That test is a fact of the tree, read from the followed file's
 * own declaration — the `declaredInheritedPopulation` discipline the other TWO
 * follows take, one file kind over (the read scan takes none of it: it
 * inherits no population to narrow, #14289) — and never a regex over the gate's
 * prose about what it thinks it reads.
 *
 * It is also what makes the edge precise rather than merely broad. Measured on
 * this tree, 23 families read a tracked `package.json` at an anchored path, and
 * SEVEN of them read the repo ROOT manifest for the version or the changeset
 * config. The root manifest declares no `exports`, so all seven inherit
 * nothing — structurally, not because today's tree happens to be kind.
 *
 * ## Narrowings, each one measured
 *
 * A TRACKED manifest, RESOLVED and never matched: the same three refusals
 * `anchoredReadTargets` documents, from the same primitive, because this scan
 * IS that primitive with one filter on the answer.
 *
 * SELF-TESTS MASKED, like the import and spawn follows and unlike the read
 * scan next door: a manifest a self-test writes into a temp directory is a
 * FIXTURE, and `check-entry-nameability.ts` builds exactly one. Inheriting a
 * population from it would hand the gate its own scaffolding.
 *
 * NO `<pkg>/src`, NO HINT. A package whose source the tree does not track
 * contributes nothing rather than a hint that would print and reach nothing —
 * the direction this file errs in everywhere.
 *
 * THE GATE MUST READ THE `exports` MAP, and this narrowing decides the number
 * rather than tidying it. A manifest is read for many reasons and only one of
 * them is this class; without the test the edge admits every reader of any
 * manifest, which is +1678 pairs on this tree and every one of them fabricated.
 * The three refusals are live, and each was checked at its own declaration site
 * rather than assumed:
 *
 *   check:docs-image-tag      packages/cli/package.json  -> `.version`, because
 *                             every doc surface pinning a concrete image tag
 *                             must equal it (#9018). 235 pairs, 0 of
 *                             `packages/cli/src` ever opened;
 *   check:authorable-surface  packages/spec/package.json -> `.version`, one
 *                             line, stamped into the generated schemas;
 *   check:generated           packages/spec/package.json -> the `scripts` map,
 *                             reconciling its GATED/NO_GENERATOR ledgers
 *                             against the npm scripts in BOTH directions.
 *
 * All three read a manifest; none reads an export surface. This file refuses
 * that class on provenance and not on volume — #9964 refused an admission
 * worth 17 pairs because 8 of them were fabricated. With the test the split is
 * exact on this tree: 6 families read the map, and all 6 are #13518's six.
 *
 * ⚠️ `check:generated` is under-matched for `packages/spec/src` for a DIFFERENT
 * reason, and this edge is not its repair: its own literals (`api-surface`,
 * `export-origins`, `src/meta-spelling/…`) are package-root-anchored and die at
 * the repo root, which is the second half of the diagnosis above and is filed
 * separately rather than fixed here under a test it does not pass.
 *
 * `module.exports` is excluded by name: it is the CJS assignment idiom and says
 * nothing about a manifest.
 *
 * ## Blast radius, measured before the change and after it (987fe370)
 *
 * A rule that moves rows moves them for EVERY family, so the price is the
 * deliverable and not a footnote. Over 199 discovered families and 7762 tracked
 * files, counted through `coveringKey` — the same key the printed block renders
 * from — and including the parameter hop `singleCallSiteParameters` adds:
 *
 *   (family, file) pairs the derivation covers   166173 -> 172797  (+6624)
 *   pairs LOST                                                          0
 *   pairs RE-ATTRIBUTED (same pair, new via)                            0
 *   families whose VERDICT changes                                      6
 *
 * The six are #13518's six, silent -> matched, and they take 1104 pairs each:
 * the whole of `packages/spec/src`, once, which is the defect exactly. No
 * family outside the class moves in either direction.
 *
 * @param {string} rel  repo-relative path of the gate script
 * @param {string} source  its contents
 * @param {(path: string) => boolean} isTracked
 * @returns {string[]} repo-relative manifest paths, in source order, deduped
 */
const PACKAGE_MANIFEST_TARGET = /(?:^|\/)package\.json$/;
const MANIFEST_EXPORTS_READ = /(?<!\bmodule)\.exports\b|\[\s*(['"`])exports\1\s*\]|\bexports\s*[:?]/;

export function packageManifestTargets(rel, source, isTracked) {
  const masked = maskedModuleBody(String(source));
  if (!MANIFEST_EXPORTS_READ.test(masked)) return [];
  return anchoredReadTargets(rel, masked, isTracked).filter((t) => PACKAGE_MANIFEST_TARGET.test(t));
}

const SCANNED_SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;

/**
 * The whole tree's directory-creating sites, read from the tracked files.
 *
 * A zero-site sweep is a BROKEN scan, not a clean tree — the same refusal
 * `trackedFiles` makes about an empty listing, for the same reason: every
 * assertion built on it would be vacuously true over nothing.
 */
export function inTreeScratchDirs({ cwd = ROOT, files = null } = {}) {
  const list = (files ?? trackedFiles({ cwd })).filter((f) => SCANNED_SOURCE_EXTENSIONS.test(f));
  const inTree = [];
  const unresolved = [];
  let sites = 0;
  for (const rel of list) {
    let source;
    try {
      source = readFileSync(nodePath.join(cwd, rel), 'utf8');
    } catch {
      continue;
    }
    if (!source.includes('mkdtempSync') && !source.includes('mkdirSync')) continue;
    const found = scratchDirSitesInSource(rel, source);
    sites += found.scanned;
    inTree.push(...found.inTree);
    unresolved.push(...found.unresolved);
  }
  if (sites === 0) {
    throw new Error(
      'the directory-creation sweep found ZERO sites across the tracked sources, which is a broken scan rather ' +
        'than a tree with no fixtures (#4690). Refusing to report ignore coverage over nothing.',
    );
  }
  return { inTree, unresolved, sites, scannedFiles: list.length };
}

/**
 * `git check-ignore`'s verdict for each path, in ONE invocation.
 *
 * `--non-matching` is what makes this a reading rather than a silence: without
 * it an uncovered path produces no output and exit 1, which is shaped exactly
 * like the command failing. With it every input gets a line, and the line count
 * is checked against the input count — so a truncated answer is a refusal, not
 * a row of `covered: false`.
 *
 * `--no-index` asks about the RULES rather than about the index: a tracked path
 * is never "ignored" to plain `check-ignore`, and the question here is whether
 * a leftover appearing at that path WOULD be ignored.
 */
export function ignoreVerdicts(paths, { cwd = ROOT } = {}) {
  const unique = [...new Set(paths)];
  const verdicts = new Map();
  if (unique.length === 0) return verdicts;
  const r = spawnSync('git', ['check-ignore', '-v', '--non-matching', '--no-index', '--stdin'], {
    cwd,
    encoding: 'utf8',
    input: `${unique.join('\n')}\n`,
  });
  if (r.error) throw new Error(`could not run git check-ignore — ${r.error.message}`);
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git check-ignore exited ${r.status}${r.stderr ? `: ${r.stderr.trim()}` : ''}`);
  }
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.length > 0);
  if (lines.length !== unique.length) {
    throw new Error(
      `git check-ignore answered about ${lines.length} of ${unique.length} path(s) — a partial answer is not a verdict`,
    );
  }
  for (const line of lines) {
    const tab = line.indexOf('\t');
    const rule = tab === -1 ? '' : line.slice(0, tab);
    const path = tab === -1 ? line : line.slice(tab + 1);
    const firstColon = rule.indexOf(':');
    const secondColon = rule.indexOf(':', firstColon + 1);
    const source = firstColon === -1 ? '' : rule.slice(0, firstColon);
    verdicts.set(path, source === ''
      ? { covered: false, source: null, line: null, pattern: null }
      : {
          covered: true,
          source,
          line: rule.slice(firstColon + 1, secondColon),
          pattern: rule.slice(secondColon + 1),
        });
  }
  return verdicts;
}

/**
 * The whole verdict: every in-tree directory a tracked source creates, split
 * into the ones a leftover would be ignored at and the ones EXPOSED.
 *
 * Two escapes, both derived from the tree rather than declared:
 *
 *   - a covering rule that lives in a TRACKED ignore file. A rule in
 *     `.git/info/exclude`, or in the user's global excludes, covers its own
 *     clone and nobody else's, so a root covered only that way is exposed on
 *     every other machine — including CI, where the leftover would land in the
 *     change set exactly as if no rule existed.
 *   - a directory git already tracks content under. That is tree, not scratch:
 *     a generated-output directory is part of the repo, and this escape stops
 *     being available on the run where the tracking stops.
 */
export function exposedScratchDirs({ cwd = ROOT, files = null } = {}) {
  const list = files ?? trackedFiles({ cwd });
  const sweep = inTreeScratchDirs({ cwd, files: list });
  const tracked = trackedPrefixes(list);
  const verdicts = ignoreVerdicts(sweep.inTree.map((s) => s.probe), { cwd });
  const exposed = [];
  const covered = [];
  for (const site of sweep.inTree) {
    const v = verdicts.get(site.probe);
    if (v?.covered && isTrackedIgnoreSource(v.source)) {
      covered.push({ ...site, rule: `${v.source}:${v.line}:${v.pattern}` });
      continue;
    }
    if (tracked.has(site.dir)) {
      covered.push({ ...site, rule: 'tracked directory' });
      continue;
    }
    exposed.push({
      ...site,
      why: v?.covered
        ? `covered only by ${v.source}, which is not a tracked ignore file — every other clone is exposed`
        : 'no ignore rule covers a leftover here, and git tracks nothing under it',
    });
  }
  return { ...sweep, exposed, covered };
}

/** An ignore file every clone has, as opposed to one local to whoever ran this. */
function isTrackedIgnoreSource(source) {
  if (!source) return false;
  if (source.startsWith('/') || source.startsWith('~')) return false;
  return !source.split('/').includes('.git');
}

/**
 * The tracked corpus in the two shapes `moduleRelativeDirectoryHint` asks it
 * about: every tracked FILE, and every path PREFIX the tree has. Built once and
 * handed down, so the extractor, the reachability sweep and the ledger cannot
 * describe different revisions of the tree — the same "one read, N answers"
 * discipline `discoverFamilies` takes with a workflow's text.
 *
 * It is a bundle rather than two parameters because the pair is meaningless
 * apart: "is this a directory" is `prefixes.has(p) && !files.has(p)`, and a
 * caller that supplied one from one listing and one from another would get an
 * answer about no tree at all.
 */
export function watchHintTree(files = trackedFiles()) {
  return { files: new Set(files), prefixes: trackedPrefixes(files) };
}

/**
 * ── The repository's OWN corpus, listed once per process (#18201) ───────────
 *
 * The listing and the tree built from it, for the one tree this process is
 * about: the checkout `ROOT` names. Every caller that wants "this repo" takes
 * the SAME two objects from here, which is the "one read, N answers"
 * discipline `watchHintTree`'s own docblock states, promoted from an
 * invariant each caller had to keep by hand to one the module keeps for them.
 *
 * ⛔ It is NOT a general tree cache. A caller that means a DIFFERENT tree — a
 * temporary repository, a hand-built fixture listing, `null` — still builds
 * and passes its own, and nothing here answers for it; the memo below is keyed
 * on the tree object, so a fixture tree can never be served this one's answer.
 *
 * What makes the reuse observationally identical rather than merely cheaper:
 * within one process nothing writes to `ROOT`. The CLI is one-shot, and the
 * self-test's every write goes to a `mkdtemp` directory under the system temp
 * root — the in-tree-fixture class its own cases refuse. A process that did
 * mutate the checkout under itself would need a fresh listing, and would ask
 * `trackedFiles()` for one, which is untouched.
 */
let repoCorpusMemo = null;
export function repoCorpus() {
  if (repoCorpusMemo === null) {
    const files = trackedFiles();
    repoCorpusMemo = { files, tree: watchHintTree(files) };
  }
  return repoCorpusMemo;
}

/**
 * The longest leading run of a hint's segments that the tree still has, or ''
 * when even its first segment names nothing.
 *
 * This is the "why" half of the verdict, and it is the one distinction the
 * tree can actually answer (#9883 H2). It separates three populations that
 * would otherwise print identically as "matched nothing":
 *
 *   ''                  no tracked path begins with the literal — a MIME type,
 *                       a remote ref, a package or repo specifier that survived
 *                       the extractor, or a path anchored at a base this scan
 *                       did not resolve (#14208). Nothing moved under it; as
 *                       spelled it was never live;
 *   a shorter prefix    the tree HAS the parent and stops there — the layout
 *                       moved under a gate that still names the old spelling.
 *                       This is the class that is usually a real miss;
 *   the WHOLE hint      the population is right there and the covering rule
 *                       still refuses the literal — a single-segment name
 *                       carries no separator, so `hintCovers` rejects it as
 *                       too generic. Nothing is wrong with the gate or the
 *                       tree; the derivation simply cannot express this one.
 *
 * That third case is why the prefix is computed at all rather than reporting a
 * bare "no match": measured on this tree it is one of the six, and a reader
 * triaging it from the bare verdict would go looking for a directory that is
 * sitting in front of them.
 *
 * It deliberately does NOT claim to know whether an empty population is
 * intended. See the sweep's own docblock for why that distinction is not
 * expressible from the tree.
 */
export function deepestTrackedPrefix(hint, prefixes) {
  // `comparedForm`, not `collapseHint`: for a pattern-judged hint the collapsed
  // string is a splice the comparison never looked at, and walking it hands
  // every downstream reason a prefix that cannot equal the form it is compared
  // against — which is how the "layout moved" sentence became unconditional for
  // that whole shape class. See `comparedForm` (#13448).
  const segments = comparedForm(hint).split('/');
  let deepest = '';
  for (let i = 1; i <= segments.length; i++) {
    const candidate = segments.slice(0, i).join('/');
    if (!prefixes.has(candidate)) break;
    deepest = candidate;
  }
  return deepest;
}

/**
 * The file extensions a module specifier is allowed to have DROPPED.
 *
 * Not a general "source file" list and not a guess: it is the set of
 * extensions an extensionless relative import can resolve to, and the
 * narrowing is PRICED against the obvious alternative rather than asserted.
 * Measured over the live fleet (829 distinct hints, 385 inert, 7125 tracked
 * files, on 1246b4cf2): this list and a rule that accepts ANY suffix in the
 * same directory select the SAME 38 hints — the narrowing costs no lead — and
 * they NAME A DIFFERENT FILE for 4 of them, because a test sibling sorts
 * first:
 *
 *   packages/spec/src/kernel/protocol-version.test.ts   <- the loose rule
 *   packages/spec/src/kernel/protocol-version.ts        <- the import's target
 *
 * ...and likewise for `metadata-type-schemas`, `react-blocks` and
 * `manifest-collection-spelling`. Reporting a gate's test sibling as "the file
 * this specifier means" is a new false sentence in place of the old one, which
 * is the entire failure this repair exists to undo. So the list stays explicit.
 * All 38 resolve through `.ts` today; the rest is what module resolution
 * admits, not padding. Both halves are pinned in the self-test — the hint sets
 * agree, and no named file is invented — so a divergence reds rather than
 * drifts.
 */
export const MODULE_SPECIFIER_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];

/**
 * The tracked file a dead hint names when the hint is a module specifier with
 * its extension dropped — or `null` when there is no such file.
 *
 * ## The row this exists to stop printing (#12299, measured on 1246b4cf2)
 *
 * `hintCovers` compares WHOLE SEGMENTS, and an ESM/TypeScript relative import
 * spells its target without the extension. So a gate that imports
 * `./lib/dist-freshness` yields the hint
 * `packages/spec/scripts/lib/dist-freshness` — correct, resolved against the
 * writing script — while the tree holds
 * `packages/spec/scripts/lib/dist-freshness.ts`. The hint misses the tracked
 * prefix set by exactly its extension, and `deepestTrackedPrefix` therefore
 * stops one segment short, at `packages/spec/scripts/lib`.
 *
 * That lands the hint in the branch `unreachableClass` reads as
 * **"THE LAYOUT MOVED … a real miss, worth triaging"** — about a directory
 * nothing moved out of, for a file sitting right there. `globInNonFinalSegment`
 * calls that row "the worst row this output can print", and the reasoning holds
 * verbatim here: a fabricated triage lead costs a reader a hunt for a directory
 * in front of them, while the honest verdict is a standing fact.
 *
 * ## Why this reads as a REGRESSION and not as a standing gap
 *
 * These nine families used to print "never was a repo path" — false, but filed
 * BY CONSTRUCTION, i.e. under the heading that tells a reader there is nothing
 * to chase. (That sentence is retired; the branch now names what the sweep
 * established without claiming a base it did not test — #14208.)
 * Resolving the literal against its writing script (the producer-side
 * repair in `resolveModuleRelativeHint`) was right and stays; what it also did
 * was move the falsehood from an inert bucket into the actionable one:
 *
 *   families printing a false reason      9 of 11, before and after
 *   ...filed "by construction" (inert)    9  ->  0
 *   ...filed "layout moved" (triage me)   0  ->  9
 *
 * The pin that accompanied the resolve asserted `Boolean(deepest)` — that the
 * hint had LEFT the "never" branch. Leaving that branch is exactly what puts a
 * hint into this one, so the pin was green for the arrival it did not check.
 * It is widened below to assert the reason the reader is actually shown.
 *
 * ## What it deliberately does NOT do
 *
 * It moves no verdict. The hint stays dead, the family stays unreachable, and
 * `hintCovers` is untouched — teaching the MATCHED column to follow a dropped
 * extension is a fleet-wide widening that owes its own pair-count measurement,
 * and it is not this repair. This function is read by the residue printer and
 * by nothing else, so its whole cost is one true sentence in place of a false
 * one.
 *
 * A hint the tree already HAS as a path is refused up front: that hint is
 * either live (multi-segment, so `hintCovers` reaches everything beneath it) or
 * it is the "too generic" case, whose own message is the more useful one
 * because it names the escape. Measured on this tree the two cases never
 * overlap — 0 dead hints are both a tracked prefix and extensionless-resolvable
 * — and the guard makes that structural rather than lucky.
 */
export function extensionlessModuleTarget(hint, files, prefixes) {
  const plain = collapseHint(hint);
  if (!plain || prefixes.has(plain)) return null;
  for (const ext of MODULE_SPECIFIER_EXTENSIONS) if (files.has(plain + ext)) return plain + ext;
  return null;
}

/**
 * The tracked FILE a declared literal NAMES, or `null` when it names anything
 * else — a directory, a pattern, a path this tree does not have. The one owner
 * of that question, for every reader in this file that has it (#13520).
 *
 * ## Why it exists: the question had three answers and they disagreed
 *
 * Three places in this file ask some form of "does this literal name a tracked
 * file", and until this function they answered it three different ways:
 *
 *   - `hintCovers` — the covering rule, which follows a dropped extension
 *     through `MODULE_SPECIFIER_EXTENSIONS` (#12514);
 *   - `extensionlessModuleTarget` — which NAMES the file such a specifier
 *     resolves to, and is what the residue printer says "the tree HAS this
 *     file" with (#12299);
 *   - `artifactOnlySilence` — which asked `trackedFiles.has(collapseHint(h))`
 *     and so followed nothing.
 *
 * The third is a private copy of a rule that lives elsewhere, and a copy that
 * drifts is the defect this file refuses everywhere else — `extractWatchHints`
 * was refused the same widening on exactly this ground ("a SECOND answer to a
 * question `extensionlessModuleTarget` already owns — the drift this file
 * refuses everywhere else"). Measured over the fleet, the copy disagreed with
 * the covering rule about 40 of 754 declared literals, silently, in the
 * direction that prints a coherent wrong category rather than an error.
 *
 * ## What it composes, and why the composition is total
 *
 * A literal names a tracked file in exactly two ways, and they are mutually
 * exclusive by construction rather than by luck: it IS the file, or it is that
 * file's module specifier with the extension dropped.
 * `extensionlessModuleTarget` refuses any hint the tree has as a prefix, and a
 * tracked file is a tracked prefix, so the second branch can never re-answer
 * the first. That exclusion is already pinned; this function is where the two
 * halves are joined so no third caller has to join them again.
 *
 * ## Why a PATTERN is refused before either branch
 *
 * A glob is a declared population — the opposite of an artifact — and a
 * mangled collapse must never be able to smuggle one in through the file
 * branch. `globInNonFinalSegment` and `globCarriesLiteralSuffix` both splice
 * strings that were never adjacent (`skills/*\/references/_index.md` →
 * `skills//references/_index.md`, `.changeset/*.md` → `.changeset/.md`), and
 * a splice that happened to land on a tracked file would enter here as an
 * artifact. Measured on this tree: 18 pattern-judged hints in the fleet, none
 * of which collapses to a tracked file — so the refusal costs nothing today and
 * makes the exclusion structural, the standard this file holds its other
 * boundaries to.
 *
 * @param {string} hint one declared literal, as the family spells it
 * @param {{files: Set<string>, prefixes: Set<string>}} tree the `watchHintTree` bundle
 */
export function declaredFileTarget(hint, tree) {
  if (judgedAsPattern(hint)) return null;
  const plain = collapseHint(hint);
  if (!plain) return null;
  if (tree.files.has(plain)) return plain;
  return extensionlessModuleTarget(hint, tree.files, tree.prefixes);
}

/**
 * Does this hint reach ANY tracked file?
 *
 * The predicate is `hintCovers` — the same one `coveringKey` matches cards
 * with, applied to the tree instead of to a card's paths. A second, faster
 * implementation is available (a hint reaches the tree exactly when its
 * collapsed form is in `trackedPrefixes`) and is deliberately NOT used: it
 * would answer this question through a copy of a rule that lives somewhere
 * else, and a copy that drifts is the whole defect this file exists to refuse.
 * The sweep costs one pass per hint over a corpus this repo reads in full for
 * several other gates already.
 */
export function hintReachesTree(hint, files) {
  return files.some((f) => hintCovers(hint, f));
}

/**
 * The third verdict: the families whose DECLARED POPULATION matches nothing in
 * the tree.
 *
 * ## What the verdict is, and why it is not a fourth bucket
 *
 * `matched` / `undetermined` / `silent` all answer a question about the CARD:
 * is this family relevant to these paths? `unreachable` answers a question
 * about the TREE: does this family's declared population exist at all? The two
 * are independent — an unreachable family can be matched (a card's surface is
 * a hypothesis about files that may not exist yet), undetermined it can never
 * be (that bucket is precisely the families that declare NO population). So it
 * cuts across the partition the way the unfiltered-workflow count already
 * does, and it is kept out of the accounting throw for the same reason:
 * folding it in would double-count and turn a correct run into an error.
 *
 * Keeping it out is also what makes the addition safe for the fleet. Every
 * seat derives its gate family from this tool; a verdict that re-classified
 * even one family would move the list every dispatch pastes. This one adds a
 * count and a listing, and moves no existing verdict.
 *
 * ## Why a family, and why ALL of its hints
 *
 * A single dead hint is ordinary and means almost nothing: gates name
 * baseline artifacts, sibling tools and example paths, and one literal in a
 * script that reads ten is not a population. What is reportable is a family
 * whose ENTIRE declared population is dead — every path literal its own
 * source names is a path this repo does not have — because that family scores
 * the same quiet `silent` green for every card in the tree whether it works or
 * not. That is #4690 one level up: zero is a broken scan, not a clean repo.
 *
 * Families with no hints at all are NOT unreachable. They declare no
 * population, which is the honest `undetermined` verdict and a different fact.
 *
 * The family bar is for the VERDICT only. What it must not do — and did, for
 * as long as this was the only sweep (#13312) — is decide what the reader is
 * SHOWN: a family kept reachable by one live literal printed its dead
 * siblings verbatim in the residue's `names:` line, three fabricated leads
 * riding one real baseline. Display is per-hint now: `deadHintSweep` above is
 * this same sweep at that grain, and the residue renderer marks and counts
 * dead literals from it without any verdict moving.
 *
 * ## What it cannot tell you (#9883 H2, answered rather than papered over)
 *
 * A population that is empty TODAY BY DESIGN — a gate whose corpus the repo
 * happens not to have yet — is indistinguishable, from the tree alone, from a
 * hint spelled for a layout that moved. Intent is not in the tree, and no
 * signal in this repo carries it, so this sweep does not pretend to read it.
 * What it does instead is hand the reader the evidence to triage in one look:
 * every dead hint is printed with the deepest prefix the tree still has, which
 * separates "never was a path" from "the tree moved under it" mechanically.
 * If dormancy ever needs to be DECLARED rather than inferred, the shape is the
 * marker convention this file already reads for a workflow with no families —
 * built when a real instance asks for it, not before.
 *
 * ## Why an all-unreachable answer is refused
 *
 * If the recognizer breaks — hint extraction, the corpus, `hintCovers` — every
 * declaring family sweeps as unreachable, and the result reads as a repo-wide
 * catastrophe rather than as the broken measurement it is. A tree whose gates
 * are green cannot have zero live populations, so that answer is refused
 * outright and names the recognizer as the suspect. It is a threshold-free
 * guard: only the degenerate all-or-nothing shape is refused, never a count
 * that is merely larger than someone expected.
 */
/**
 * The same reachability sweep at PER-HINT grain: every declaring family's DEAD
 * literals, whether or not a live sibling keeps the family reachable.
 *
 * ## The class this exists for (#13312)
 *
 * `unreachableFamilies` below reports a family only when its WHOLE population
 * is dead — the right bar for the unreachable VERDICT, and exactly the wrong
 * one for the `names:` line a `--residue` reader is handed: one live literal
 * (a baseline artifact is enough) keeps the family reachable, and every dead
 * sibling then prints VERBATIM with nothing saying it names a file that has
 * never existed. `isNonPathNamespace`'s docblock called that survivor class
 * the expensive direction; this sweep is the instance count it did not have.
 * Measured on this tree at 5f0a9c4ad, before the `@`-scope refusal landed
 * beside it: 65 of 151 declaring families carried 598 dead literals in
 * reachable hint sets, three of the five hints shown for
 * check:query-options-erasure among them.
 *
 * ## What a row is, and what it is NOT
 *
 * A row is a DISPLAY fact for the residue renderer: this family declares
 * `declared` distinct literals and `dead` of them reach nothing tracked. It
 * moves no verdict — matched/undetermined/silent and the unreachable listing
 * are untouched, for the reason `unreachableFamilies`' docblock gives: a
 * single dead hint is ordinary (gates name baseline artifacts and example
 * paths), so it is ANNOTATED where it is shown rather than promoted to a
 * verdict. The refusals are shared with the family-grain sweep: an empty
 * corpus throws here (#4690), and the all-dead recognizer refusal stays in
 * `unreachableFamilies`, which reads its answer off this one.
 */
export function deadHintSweep(entries, files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(
      'the reachability sweep was handed an empty corpus — zero tracked files is a broken scan, not a clean repo (#4690).',
    );
  }
  const prefixes = trackedPrefixes(files);
  const fileSet = new Set(files);
  const reach = new Map();
  const reaches = (hint) => {
    if (!reach.has(hint)) reach.set(hint, hintReachesTree(hint, files));
    return reach.get(hint);
  };

  let declaring = 0;
  const byCheck = new Map();
  for (const [check, entry] of entries) {
    const hints = [...new Set(entry.hints ?? [])];
    if (hints.length === 0) continue; // declares no population — that is `undetermined`
    declaring++;
    const deadHints = hints.filter((hint) => !reaches(hint));
    if (deadHints.length === 0) continue;
    byCheck.set(check, {
      check,
      entry,
      declared: hints.length,
      dead: deadHints.map((hint) => ({
        hint,
        deepest: deepestTrackedPrefix(hint, prefixes),
        // Carried on the entry beside `deepest`, for the same reason: the
        // renderers are pure functions over `dead` and must not have to re-read
        // the corpus to describe what the sweep already knows.
        target: extensionlessModuleTarget(hint, fileSet, prefixes),
      })),
    });
  }
  return { declaring, byCheck };
}

export function unreachableFamilies(entries, files, sweep = null) {
  const { declaring, byCheck } = sweep ?? deadHintSweep(entries, files);
  const unreachable = [...byCheck.values()]
    .filter((row) => row.dead.length === row.declared)
    .map(({ check, entry, dead }) => ({ check, entry, dead }));

  if (declaring > 0 && unreachable.length === declaring) {
    throw new Error(
      `every one of the ${declaring} famil(ies) that declare a population reached nothing in a corpus of ${files.length} tracked file(s). ` +
        'That is this sweep failing, not the farm — suspect the recognizer (hint extraction, the corpus, or the covering rule) ' +
        'before reading it as a defect count.',
    );
  }
  return unreachable;
}

/**
 * One family's dead population, rendered for the reader: the hint as the gate
 * spells it, and WHY it reached nothing — the three cases
 * `deepestTrackedPrefix` distinguishes plus the one it CANNOT (a specifier
 * whose target the tree has under a dropped extension, which reads to a prefix
 * sweep as a short prefix and to a reader as a move that never happened; see
 * `extensionlessModuleTarget`), each named in words rather than left for the
 * reader to infer from a prefix. Capped like the neighbouring residue listing:
 * the reason is a triage lead, not an inventory.
 */
/**
 * Which KIND of unreachable is this family — one the tree could ever fix, or
 * one that is unreachable by construction?
 *
 * The three cases `deepestTrackedPrefix` distinguishes split two-to-one on the
 * question a reader actually has, which is "is this a miss I should chase?":
 *
 *   by construction   no tracked path begins with the literal (nothing under
 *                     even its first segment — a package specifier, a cross-repo
 *                     slug, or a base this scan did not resolve), or the tree
 *                     HAS the population and the covering rule refuses the
 *                     literal as too generic. Neither is a
 *                     defect in the gate or in the tree, and NO change to either
 *                     makes the derivation reach it. This is the class that is
 *                     merely a standing fact.
 *   layout moved      the tree stops at a shorter prefix — the gate still spells
 *                     a path whose parent survives. That is usually a REAL miss
 *                     and it wants triage, so it must not sit under the same
 *                     "nothing to see here" label as the other two.
 *
 * The split is derived from the prefix sweep, never declared: intent is not in
 * the tree (see `unreachableFamilies`' docblock) and this does not pretend to
 * read it. "By construction" here is a statement about the DERIVATION — this
 * literal cannot be reached by it — not a claim about what the author meant.
 *
 * One input the prefix sweep alone gets WRONG, and it is the only exception
 * this function makes: an extensionless module specifier whose file the tree
 * really has stops the sweep one segment short, which is bit-for-bit the shape
 * of a move. It is not one, so it does not vote — `extensionlessModuleTarget`
 * carries the measurement and the incident.
 */
export function unreachableClass(dead) {
  // A hint whose target the tree HAS (`extensionlessModuleTarget`) is NOT
  // evidence of a move, however short its `deepest` is: the prefix stops one
  // segment early because the specifier drops the extension, not because
  // anything left the directory. Counting it would put nine families under
  // "a real miss, worth triaging" with nothing to triage — see that helper.
  // Compared against the form the hint was JUDGED by, never against the
  // collapse unconditionally: a pattern-judged hint can never equal its own
  // collapsed splice, so the hard-wired `collapseHint` made "layout moved" the
  // only reachable verdict for that whole shape class — a specific wrong cause,
  // printed under the heading that tells a reader to go chase it (#13448).
  const everMoved = dead.some(({ hint, deepest, target }) => !target && deepest && deepest !== comparedForm(hint));
  return everMoved ? 'layout moved' : 'by construction';
}

/**
 * The `names:` fragment for one residue row, with each DEAD literal marked.
 *
 * Three of the five hints shown for check:query-options-erasure named files
 * that have never existed in this tree, printed verbatim (#13312) — the
 * `names:` line is what a dispatching seat reads to decide which gates a
 * card's edit reaches, so a dead literal shown unmarked is a fabricated lead
 * in the one place reserved for real ones. The mark is display-only and the
 * cap is the listing's own: a dead literal hidden behind the `…` is still
 * counted, and named with its reason, by `deadNamesNote` below.
 */
export function residueNames(hints, deadHints = null, cap = 3) {
  const unique = [...new Set(hints)];
  const shown = unique.slice(0, cap).map((h) => (deadHints?.has(h) ? `${h} ✗` : h));
  return `${shown.join(', ')}${unique.length > cap ? ', …' : ''}`;
}

/**
 * The one-line account of a family's dead literals, printed under its residue
 * row. Same voice as the unreachable listing (`unreachableReason` renders the
 * WHY for both), because it is the same fact one grain finer: the family is
 * reachable, and `dead` of its `declared` literals still name nothing this
 * tree has. Without this line the two facts collapse into one — a live
 * baseline kept the family out of the unreachable listing AND kept its dead
 * siblings unannotated, which is how three fabricated leads rode a real one
 * into every reader's residue (#13312).
 */
export function deadNamesNote({ declared, dead }, cap = 3) {
  return (
    `      ↳ ⚠ ${dead.length} of ${declared} declared literal(s) reach nothing tracked (marked ✗ where shown) — ` +
    `dead leads, not population: ${unreachableReason(dead, cap)}`
  );
}

export function unreachableReason(dead, cap = 3) {
  const shown = dead
    .slice(0, cap)
    .map(({ hint, deepest, target }) => {
      // One sentence, one spelling, whichever branch reaches it: the two
      // callers below differ only in WHAT the tree has, and a second copy of
      // this wording is a second thing to keep in step (#12797).
      const tooGeneric = (what) =>
        `'${hint}' — the tree HAS ${what}; the covering rule refuses the literal as too generic (no path separator)`;
      // ── The refusal that ACTUALLY fired, ordered ahead of `target` (#12797)
      //
      // `hintCovers` rejects a separator-less literal BEFORE it compares
      // anything, so for a bare hint every sentence below describes a
      // comparison that was never performed. The `target` branch's wording
      // ("no whole-segment comparison reaches") was a true statement about the
      // RULE when it was written; #12514 then taught `hintCovers` to follow a
      // dropped extension, after which a separator-CARRYING hint whose file the
      // tree has is MATCHED and never enters `dead` at all. That leaves the
      // bare hint as the only population the `target` branch can still reach —
      // and it is the one population where its sentence is FALSE, because what
      // this literal lacks is a separator, not an extension. Same species as
      // the two cards that put the branch there: a residue row whose
      // classification and whose evidence are both wrong about a file sitting
      // right in front of the reader.
      //
      // ⛔ The repair is the ORDER, not a `target` sentence taught which
      // refusal fired: that would add machinery to a branch which then has no
      // live caller. `target` is evidence this row already carries, so naming
      // the file here costs nothing and keeps the reader's escape (declare the
      // subtree spelling) attached to the refusal that is actually blocking it.
      if (target && refusedAsTooGeneric(hint)) return tooGeneric(target);
      // Then the strongest statement available for everything else: the sweep
      // knows the actual file. Every other branch reasons from a PREFIX, and
      // for this shape every one of them lands on something false.
      if (target) {
        return `'${hint}' — the tree HAS ${target}; the literal is that file's extensionless module spelling, which no whole-segment comparison reaches`;
      }
      // ⚠️ This sentence used to end "never was a repo path" — a claim about
      // EVERY base, made from evidence about ONE (#14208). check:generated's
      // `api-surface`, `export-origins` and `src/meta-spelling/…` all printed
      // under it while sitting on disk under `packages/spec/`, which is a
      // dead-lead label on a live path: the reader is told there is nothing to
      // chase, about three files they could open. What the sweep actually
      // established is the first clause, and the second now names the two ways
      // that happens instead of asserting the literal never existed.
      if (!deepest) {
        return `'${hint}' — no tracked path under its first segment; a specifier, or a path anchored at a base this scan did not resolve`;
      }
      // Every branch below reasons about the form the COMPARISON used, so the
      // pattern-judged shapes get their own sentence instead of borrowing the
      // collapse's. Borrowing it is what made the residue assert a directory
      // rename for a hint whose directory is exactly where it has always been
      // (#13448) — and the replacement is checkable by the reader, which is the
      // bar a triage lead has to clear: `git ls-files` on the hint as written.
      const form = comparedForm(hint);
      if (judgedAsPattern(hint)) {
        return deepest === form
          ? `'${hint}' — the tree HAS ${form}; this hint is a GLOB PATTERN and nothing under that root matches it — check with \`git ls-files '${hint}'\``
          : `'${hint}' — a glob pattern whose literal prefix ${form} is gone; the tree stops at ${deepest}, so the layout moved under it`;
      }
      if (deepest === form) return tooGeneric('it');
      return `'${hint}' — the tree stops at ${deepest}; the layout moved under it`;
    })
    .join(' · ');
  return dead.length > cap ? `${shown} · …` : shown;
}

// ---------------------------------------------------------------------------
// The escapable-literal ledger (#10705)
// ---------------------------------------------------------------------------

/**
 * One family's ESCAPABLE literals: the bare separator-less population literals
 * it declares that the tree really HAS, and for which it has NOT declared the
 * subtree spelling.
 *
 * ## The species, and why it is worth enumerating rather than re-finding
 *
 * `hintCovers` refuses a bare single-segment literal as too generic, and that
 * refusal is measured (+139084 fabricated pairs — see its docblock) and stays.
 * The consequence is a gate whose declared population is a bare top-level word
 * the tree DOES have: nothing is wrong with the gate or the tree, but no
 * dispatch derivation can name it, so it scores the same quiet verdict for
 * every card in the tree and, as `check-plugin-teardown-shape.mjs` puts it,
 * "lands already invisible".
 *
 * The escape exists and is a named, copyable idiom — `ROOT_DIR_WATCH_HINTS`,
 * carried by `check-role-word.mjs` (`['skills/**']`) and by
 * `check-examples-live-imports.mjs` (`['examples/**']`), each pinned in its own
 * gate's self-test. What was missing is any record of WHO still needs to take
 * it. Six instances were found one at a time, on six unrelated cards, by
 * someone happening to read the residue block on the way past; the sixth was a
 * re-discovery of the fourth, filed fresh by an agent who did not know the
 * enumeration existed. Discovery-by-coincidence is the failure this ledger
 * closes.
 *
 * ## What counts as ESCAPED, and why the test is the collapsed form
 *
 * A sibling hint escapes the literal only when it declares the SAME population
 * as a subtree — `collapseHint(g) === plain`, with a separator in `g`. A hint
 * that merely reaches INTO the root does not count, and the distinction is
 * live rather than theoretical: `check:published-files` names
 * `scripts/check-published-files.mjs`, which `hintCovers` accepts against the
 * bare directory `scripts` through its reverse-containment branch while
 * covering no other file under that root. Treating that as an escape would
 * retire a ledger row for a gate that is still unnameable for every card under
 * the root it appears to declare.
 *
 * ## What this does NOT see
 *
 * Only literals that reach the HINT SET, which requires a separator somewhere
 * in the source spelling (`'scripts/'` trims to `scripts`). A gate that spells
 * its root with no separator at all (`const POPULATION = 'packages'`) builds no
 * hint, so it is invisible to the derivation AND to this ledger — the same
 * shape #10107 recorded for the directory half. That remainder is bounded only
 * by each gate's own `ROOT_DIR_WATCH_HINTS` declaration and self-test, because
 * only the gate knows its real population; this tool cannot read intent out of
 * a bare word, and a sweep that tried was measured at 73 (family, word) pairs
 * across 52 of 128 families — overwhelmingly `join(ROOT, 'packages', …)` path
 * components, which is the +139084 fabrication re-introduced one level up.
 */
export function escapableLiteralRows(entries, prefixes) {
  const rows = [];
  for (const [check, entry] of entries) {
    const hints = [...new Set(entry.hints ?? [])];
    for (const hint of hints) {
      const plain = collapseHint(hint);
      // Exactly `hintCovers`' refusal, read off the same two conditions rather
      // than a paraphrase of them: a literal it does NOT refuse is nameable and
      // is no part of this species.
      if (plain.length < 2) continue;
      if (hint.includes('/') || plain.startsWith('.')) continue;
      // …and the tree HAS the whole literal. A bare word the tree does not have
      // (`node_modules`, `@objectstack`) is the genuinely-dead species instead,
      // which no declaration can fix and which `unreachableReason` already
      // separates by exactly this test.
      if (deepestTrackedPrefix(hint, prefixes) !== plain) continue;
      if (hints.some((g) => g !== hint && g.includes('/') && collapseHint(g) === plain)) continue;
      rows.push({ check, hint, plain });
    }
  }
  return rows;
}

/** The ledger key for one row — see the ledger's docblock for the spelling rule. */
export function escapableLiteralKey({ check, hint }) {
  return `${check} ${hint}`;
}

/**
 * The ledger's rows are data (`ESCAPABLE_LITERAL_LEDGER_ROWS` in `dispatch-gates.data.mjs`, with the
 * docblock that governs them); this binding is the Set the derivation reads.
 */
export const ESCAPABLE_LITERAL_LEDGER = new Set(ESCAPABLE_LITERAL_LEDGER_ROWS);

// ---------------------------------------------------------------------------
// Change-kind derivation — the gates a path match can never reach
// ---------------------------------------------------------------------------

/**
 * Is this path a test file, judged the way the gates below judge it?
 *
 * Both gates classify by the FILENAME infix (`*.test.*` / `*.spec.*`), not by
 * directory: a helper at `__tests__/fixtures.ts` is test-adjacent but neither
 * gate counts it — it falls in their NON-test population, where the ordinary
 * blocking lint rule applies instead. Matching directories here would name two
 * gates that cannot move, which is the failure mode this whole script exists to
 * avoid. The extension set is the UNION of the two gates' own (one counts
 * `.ts`/`.tsx`, the other also `.mts`/`.cts`); these are leads to run locally,
 * not verdicts, so the wider side is the safe one.
 */
export function isTestFilePath(path) {
  return /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(path);
}

/**
 * Does this file carry a value shaped like an ADR-0112 error/notice CODE — the
 * content trigger for `check:dispatcher-error-vocabulary` (#12850)?
 *
 * ## Why this one is judged from CONTENT, when every other kind reads a PATH
 *
 * The four path predicates around this one answer questions about a path: is it a
 * test file, does its package own an extract config, is it a gate script, is it
 * in the root program (`emitsAnHttpStatus` below is the one other CONTENT
 * predicate, for the same reason). This one cannot, and the reason is recorded elsewhere in
 * the tree rather than argued here. The vocabulary gate computes its own
 * population by walking a bare top-level root, and `scripts/pm/bare-root-
 * worklist.mjs` already carries the verdict for that spelling: REFUSE-WIDE,
 * "non-test sources plus manifests, 1898 of 4903 (39%) — same trade" as the
 * sibling it is grouped with, whose note spells the trade out — a declaration
 * that "would name this gate for every card in the repo that touches a
 * package".
 *
 * So there is no path prefix to give this entry. Inventing one would not merely
 * be imprecise: it would mirror, inside this file, a population the ledger next
 * door has already refused to spell — and mirroring a fact another file states
 * is the drift this whole script is written against. A trigger that looks right
 * and covers a third of the tree is strictly worse than today's honest silence,
 * because a lead that fires on every card is one a reader learns to skip.
 *
 * What IS derivable from a diff is the thing the gate actually bites on: a code
 * value entering the tree. That is content, so this predicate reads content.
 *
 * ## What it matches, and why it is deliberately broader than the gate
 *
 * Two limbs, both anchored on the shapes an error code is written in here:
 *
 *   - STAMP POSITION — the token `code` bound to a quoted literal or to a
 *     SCREAMING_SNAKE identifier, through `:` or `=`, optional or not, with an
 *     optional `typeof` between. That last part is not decoration: the specimen
 *     that cost the CI round trip is `code: typeof CONVERSION_NOTICE_CODE`, and
 *     a matcher without it misses the very case this entry exists for.
 *   - CONSTANT BINDING — a SCREAMING_SNAKE binding whose value is a quoted
 *     SCREAMING_SNAKE string, which is how this repo declares a code before any
 *     `code` token is anywhere near it (`const CONVERSION_NOTICE_CODE =
 *     'OS_METADATA_CONVERTED'`). The specimen file matches on both limbs; a
 *     tree sweep found no file that only the second reaches, so neither limb is
 *     carrying the other.
 *
 * ⛔ This is NOT a copy of the gate's own `SHAPES` table and must never become
 * one. A copy would be a second spelling of a fact that file owns, and it would
 * go stale in the SILENT direction the day `SHAPES` grows an indirection — that
 * table has grown twice for exactly that reason. Being broader than `SHAPES` is
 * what makes staleness impossible in the expensive direction: a shape added
 * there is already inside this predicate's wider net.
 *
 * ## The false-positive trade, stated so nobody assumes narrowing is free
 *
 * This predicate over-matches on purpose. It fires for a file that merely
 * CONTAINS a code, not only one that adds a new one, and it does not ask
 * whether the value is registered — both would need the gate's own resolver,
 * which is the thing this must not import. Cost of a false positive: one extra
 * gate run, and this gate needs no build and answers for the whole tree in one
 * pass. Cost of a false negative, measured on #12843: a full CI round trip,
 * because the derived union reads green locally and the gate reds in `Lint &
 * Repo Gates`. The two costs are not close, so the wide side is the correct
 * one. ⚠ Narrowing it later is therefore not a tidy-up — it is a trade against
 * a measured price, and it needs the same kind of measurement to justify.
 *
 * Measured on this tree when written, over 7169 tracked files: 196 of the 2281
 * non-test TypeScript files match (8.6%, 2.7% of the tree) — two orders of
 * discrimination away from the 39% a path spelling would have named. 194 of
 * those 196 are inside the gate's own scanned population; the other two are one
 * file each under the app and example roots, which the gate does not scan. Two
 * wasted runs across the whole tree is the entire cost of leaving the
 * population half out, and leaving it out is what keeps this file from spelling
 * a pathy literal it would then match cards through — see the note on `why`
 * prose in the table's docblock.
 *
 * ## What it cannot see, said out loud rather than discovered later
 *
 * A file that does not exist has no content, so this returns false for one —
 * and at DISPATCH time the card's file surface is a hypothesis, which is where
 * a brand-new file carrying a brand-new code lives. The trigger therefore fires
 * for the dev's re-derivation off the merge base (where the file is real and
 * where the missed gate actually costs the round trip) and stays quiet for the
 * PM's hypothetical surface. That asymmetry is the honest one: firing on a path
 * whose content nobody can read would be the path-shaped trigger this entry
 * exists to refuse, wearing a different name. ⛔ Do not close it by falling back
 * to the path half.
 */
const CODE_STAMP_POSITION = /\bcode\s*\??\s*[:=]\s*(?:typeof\s+)?(?:['"`]|[A-Z][A-Z0-9_]*\b)/;
const CODE_CONSTANT_BINDING =
  /\b(?:const|readonly|static|let)\s+[A-Z][A-Z0-9_]*\s*(?::[^=;\n]+)?=\s*['"`][A-Z][A-Z0-9_]*['"`]/;

/** The file's text, or null when there is nothing on disk to read. */
function readTrackedSource(path) {
  try {
    return readFileSync(nodePath.join(ROOT, path), 'utf8');
  } catch {
    return null;
  }
}

export function stampsAnErrorCodeLiteral(path, readSource = readTrackedSource) {
  if (!/\.[cm]?tsx?$/.test(path) || /\.d\.[cm]?ts$/.test(path)) return false;
  if (isTestFilePath(path)) return false;
  const source = readSource(path);
  if (source === null || source === undefined) return false;
  // Comments are masked for the reason the gate masks them: a code DISCUSSED in
  // prose is not a code stamped in source. This narrows nothing the gate would
  // have reported, so it costs no recall in the expensive direction.
  const masked = maskedComments(source);
  return CODE_STAMP_POSITION.test(masked) || CODE_CONSTANT_BINDING.test(masked);
}

/**
 * Does this file bind an HTTP STATUS to an error response? This is the content
 * trigger for `check:error-status-conformance` (#22320).
 *
 * ## Why a SIBLING of the code predicate above, not a second gate on its entry
 *
 * That gate reconciles the (code, HTTP status) pairs the runtime can emit with
 * the statuses the two error pages publish. It walks the same bare top-level
 * root the vocabulary gate walks, and the bare-root ledger records it
 * REFUSE-WIDE for the same trade. So no path prefix names it either, and it
 * reaches a card here, by content, the way its sibling does. ⛔ That ledger row
 * is not re-decided to make a path match possible: REFUSE-WIDE refuses a TRUE
 * declaration on purpose, and re-deciding it would take a ruling.
 *
 * It does not simply join the entry above, because the two questions DIVERGE
 * on this tree. Measured at 11e2a5299b (the bytes of main 28bff18d0c) with the
 * gate's own deriver, one file at a time: 128 files carry a derived (code,
 * status) producer, and 19 of them, holding 86 producer sites, carry no
 * code-shaped value `stampsAnErrorCodeLiteral` can see. Two shapes account for
 * all 19. The four-argument `sendError` door takes its code as a POSITIONAL
 * argument, with no `code` token near it. The assignment pair reads its code
 * from an enum member (`StandardErrorCode.enum.X`), not a quoted literal or a
 * bare SCREAMING_SNAKE name. A dev editing one of those files is exactly where
 * PR #22311 stood: the derived union read green, and CI failed this gate.
 *
 * ## What it matches
 *
 * Every rule the gate derives a producer with needs either a status VALUE in a
 * status position or the door call. So the limbs read those, never the code:
 *
 *   - STATUS POSITION: the token `status` or `statusCode`, bound through `:` or
 *     `=` (never `==`, `=>` or `::`) to a 4xx/5xx literal, or to a
 *     SCREAMING_SNAKE name, bare or ending a member chain. That covers a class's
 *     own `readonly status`, the `{ code, status }` and `{ status, body }`
 *     terminals, and the `err.status =` assignment.
 *   - DOOR CALL: `sendError(` whose second argument is a 4xx/5xx literal or
 *     such a name. This is the positional door, the first shape the code
 *     predicate misses.
 *   - STATUS CONSTANT BINDING: a SCREAMING_SNAKE binding to a 4xx/5xx literal,
 *     which is how this repo declares a refusal's status before any emit site
 *     uses it (`const NOT_UPLOADER_STATUS = 403`). The gate resolves such a
 *     name across files, so the declaring file moves the gate even though it
 *     emits nothing itself.
 *
 * ⛔ This is not a copy of the gate's derivation rules, for the reason the code
 * predicate gives about `SHAPES`: a net broader than the rules already holds a
 * rule added there, so staleness can only fall in the cheap direction.
 *
 * ## Measured, so a narrowing has a number to beat
 *
 * On the same tree, 185 of the 3247 non-test TypeScript files match. Every one
 * of them is inside the gate's own scanned population, and 128 of them carry a
 * producer (69%). All 128 producer files match, so recall over what can fail
 * the gate is complete. The code predicate names 283 files for its own gate.
 * There are two residues, both stated here rather than left to be found:
 *
 *   - 9 files hold only UNRESOLVED pairs, where the status is a runtime value,
 *     and 6 of them do not match. The gate reports those and never fails on
 *     them, so as written they cannot fail it. The edit that would make one
 *     resolvable writes a status value, which this predicate then sees.
 *   - 4 files resolve a producer elsewhere through a constant they declare.
 *     The binding limb reaches 3 of them. The fourth declares only a CODE
 *     constant, and the entry above reaches it, this one does not. A
 *     code-constant limb here would add 45 matches (185 to 230) for that one
 *     file, and this entry declines that precision trade.
 *
 * The false-positive trade is the code predicate's: one extra run of a gate
 * that needs no build, against a CI round trip. The unreadable branch is the
 * code predicate's too: a file with nothing on disk answers false. ⛔ Do not
 * close it by falling back to a path.
 */
const STATUS_STAMP_POSITION =
  /\b(?:status|statusCode)\s*\??\s*(?::(?!:)|=(?![=>]))\s*(?:[45]\d\d\b|(?:[A-Za-z_$][\w$]*\.)*[A-Z][A-Z0-9_]*\b)/;
const STATUS_DOOR_CALL = /\bsendError\(\s*[\w$.]+\s*,\s*(?:[45]\d\d\b|(?:[A-Za-z_$][\w$]*\.)*[A-Z][A-Z0-9_]*\b)/;
const STATUS_CONSTANT_BINDING = /\b(?:const|readonly|static|let)\s+[A-Z][A-Z0-9_]*\s*(?::[^=;\n]+)?=\s*[45]\d\d\b/;

export function emitsAnHttpStatus(path, readSource = readTrackedSource) {
  if (!/\.[cm]?tsx?$/.test(path) || /\.d\.[cm]?ts$/.test(path)) return false;
  if (isTestFilePath(path)) return false;
  const source = readSource(path);
  if (source === null || source === undefined) return false;
  // Masked for the code predicate's reason: a status DISCUSSED in prose is not
  // a status bound in source.
  const masked = maskedComments(source);
  return STATUS_STAMP_POSITION.test(masked) || STATUS_DOOR_CALL.test(masked) || STATUS_CONSTANT_BINDING.test(masked);
}

/**
 * Is this path inside the ROOT package's tsc program — the population behind
 * the `@objectstack/spec-monorepo` entry of `check:type-check-debt`?
 *
 * This is the one gate population in the tree that no path literal can ever
 * describe, in principle rather than by omission. The root program is declared
 * by EXCLUSION: `tsconfig.json` names the four directories tsc does not walk,
 * and "everything else" has no positive spelling. The ordinary derivation —
 * scan a gate's own source for whole-string path literals — therefore reaches
 * this gate for the twelve ledgered PACKAGE names and for the single measured
 * coupling constant the gate declares, and reaches nothing at all for the root
 * entry, which is the largest of the fifteen.
 *
 * The complement is computed from the config's own `exclude` array, never
 * mirrored here — see `rootTsProgramExcludedDirs`.
 *
 * TypeScript extensions ONLY, and that half is load-bearing rather than tidy.
 * The root config sets no `allowJs`, so the 117 tracked JavaScript files
 * sitting in exactly these directories — nearly all of them the repo's own
 * checker scripts — are NOT in the program, against 11 TypeScript files that
 * are. A bare "outside those directories" test would fire on 128 paths to reach
 * 11, sending every card that edits a checker to a ratchet needing a built
 * workspace closure. That is how a convention entry earns the reputation that
 * gets it skipped, which costs more than the hole it was added to close.
 *
 * @param {string} path repo-relative, posix
 * @param {string[]} excludedTopLevelDirs from `rootTsProgramExcludedDirs()`
 */
export function isInRootTsProgram(path, excludedTopLevelDirs) {
  const rel = path.replace(/^\.\//, '');
  if (!/\.(ts|tsx|mts|cts)$/.test(rel)) return false;
  return !excludedTopLevelDirs.includes(rel.split('/')[0]);
}

/**
 * `isExtractConfigPath` is imported at the top of this file, not defined here.
 *
 * It used to be a hand-written mirror of the gate's own filename test, with a
 * comment saying so ("mirrored exactly rather than approximated"). A mirror is
 * a second contract: it agrees until one side moves, and nothing reports the
 * day it stops agreeing. The test, the walk and the docstring-flag parse now
 * live once in the shared module and BOTH readers import them (#9116).
 */

/**
 * The package directory that OWNS an extract config: everything above the
 * `scripts/` segment `isExtractConfigPath` required. Returns null when the
 * owner would collapse to a bare top-level directory (a config sitting at
 * `packages/scripts/…`) — such an owner covers the entire tree below it, which
 * is the same over-broad match `hintCovers` rejects for watch hints.
 */
export function owningPackageOfExtractConfig(configPath) {
  const i = configPath.indexOf('/scripts/');
  if (i < 0) return null;
  const owner = configPath.slice(0, i);
  return owner.includes('/') ? owner : null;
}

/**
 * Is this input path inside a package that owns an extract config?
 *
 * The WHOLE owning package counts, the config file included. Narrowing to the
 * object definitions would under-cover: the extraction reads whatever each
 * package's config enumerates, and the config itself is part of the trigger
 * surface — edit it and the emitted bundles change.
 *
 * One-directional on purpose: the input must sit inside an owner, never the
 * reverse. Letting a shorter input "cover" owners below it would make a
 * directory argument like `packages/services` drag in every bundle package
 * under it, and `packages` drag in all nine.
 */
export function isInI18nBundlePackage(path, ownerDirs) {
  return ownerDirs.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/**
 * The repo-relative package directories that own an extract config, deduped —
 * derived from the GATE'S OWN walk, imported rather than mirrored.
 *
 * Runtime discovery, like `extractCheckInvocations` re-reading the workflows:
 * when a tenth package grows a bundle, the next run matches it with nothing to
 * update here.
 */
export function findI18nBundlePackages(configs) {
  const out = [];
  for (const { rel } of configs) {
    const owner = owningPackageOfExtractConfig(rel);
    if (owner && !out.includes(owner)) out.push(owner);
  }
  return out;
}

/**
 * The two walks, memoised per process — one answer serves every input path. An
 * unreadable `packages/` throws rather than degrading to "no owners": under
 * this script's contract unreadable input must never look like an empty
 * answer, and the entrypoint turns the throw into a non-zero exit.
 */
let i18nConfigs = null;
function i18nExtractConfigs() {
  i18nConfigs ??= findExtractConfigs(nodePath.join(ROOT, 'packages'), 'packages');
  return i18nConfigs;
}

let i18nOwnerDirs = null;
export function i18nBundlePackageDirs() {
  i18nOwnerDirs ??= findI18nBundlePackages(i18nExtractConfigs());
  return i18nOwnerDirs;
}

/**
 * The metadata form modules in the tree, memoised — the population of the
 * SECOND i18n entry below.
 */
let formModules = null;
export function metadataFormModulePaths() {
  formModules ??= findMetadataFormModules(nodePath.join(ROOT, 'packages'), 'packages');
  return formModules;
}

/**
 * Does any package still commit the shared Studio metadata-form baseline?
 * Read from the configs' own documented flags, memoised — see the shared
 * module's `anyConfigExtractsMetadataForms`.
 */
let metadataFormsExtracted = null;
export function metadataFormsSurfaceIsExtracted() {
  metadataFormsExtracted ??= anyConfigExtractsMetadataForms(i18nExtractConfigs());
  return metadataFormsExtracted;
}

/**
 * The root tsconfig's `exclude` array, as declared. Read, never mirrored: a
 * hand-written copy of that list here would be a second contract — it agrees
 * until one side moves and nothing reports the day it stops, which is the
 * defect the i18n entries above were rewritten to remove. The config is the
 * authority for this question and it is already on disk.
 *
 * Unreadable input must never look like an empty answer, so an unparseable
 * config or a missing `exclude` THROWS rather than degrading to "excludes
 * nothing" — that reading would fire this kind on every TypeScript file in the
 * tree, and a convention entry that cries wolf on every card is worse than one
 * that was never added. Same contract as the two walks above; the entrypoint
 * turns the throw into a non-zero exit.
 */
export function rootTsconfigExcludeEntries() {
  const raw = readFileSync(nodePath.join(ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error('tsconfig.json is not parseable, so the root tsc program cannot be derived', { cause });
  }
  const exclude = parsed?.exclude;
  if (!Array.isArray(exclude) || exclude.length === 0) {
    throw new Error('tsconfig.json declares no non-empty `exclude`: the root tsc program is defined by that list and cannot be derived without it');
  }
  return exclude;
}

/**
 * A plain top-level directory name — the ONE exclude shape this complement can
 * judge. A pattern form excludes files INSIDE directories rather than whole
 * directories, and reading one as a directory would narrow the complement and
 * put the original hole back in a new place.
 */
export function isPlainTopLevelDir(entry) {
  return typeof entry === 'string' && entry !== '' && !/[\/*?[\]]/.test(entry);
}

/**
 * The top-level directories the root program does not walk, memoised.
 *
 * Entries that are not plain directory names are DROPPED, which widens the kind
 * (a card is told to run a gate it may not move) rather than narrowing it — the
 * safe direction, since these are leads to run locally and not verdicts. It is
 * not left to rot either: the self-test pins that the live config still
 * consists only of the shape this reads, so the day someone adds a pattern
 * form CI says so and a human decides what the complement should mean.
 */
let rootProgramExcludes = null;
export function rootTsProgramExcludedDirs() {
  rootProgramExcludes ??= rootTsconfigExcludeEntries().filter(isPlainTopLevelDir);
  return rootProgramExcludes;
}

/**
 * Every file the discovered gate families RESOLVE TO — the gate scripts — as a
 * Set, memoised per process.
 *
 * Derived from `discoverFamilies`, never listed, which is the same
 * derived-never-listed contract `coveringKey` states for the identity key it
 * already reads off `entry.files`: a gate script added tomorrow is in this set
 * on the next run with nothing to update here. Deriving it also means this
 * helper grows no module-body path literal, so it adds nothing to this file's
 * own watch-hint set (the `inherited-population` declaration at the top of the
 * module body stays true).
 */
let gateScriptFiles = null;
export function gateFamilyFiles(families = null) {
  if (families) {
    const derived = new Set();
    for (const [, entry] of families) for (const f of entry.files ?? []) derived.add(f);
    return derived;
  }
  gateScriptFiles ??= gateFamilyFiles([...discoverFamilies().byCheck]);
  return gateScriptFiles;
}

/**
 * Is this input path a gate script — a file some discovered family RUNS?
 *
 * ⛔ Deliberately NOT a filename test. The obvious spelling of this kind is a
 * `check-*` regex over `scripts/`, and it is the wrong instrument in BOTH
 * directions — measured on this tree rather than assumed:
 *
 *   - it FABRICATES 10 leads — files no discovered family RESOLVES to, which
 *     is NOT the same as dead, and the difference is the whole trap. Three of
 *     the ten are healthy and running: `check-dts-emitted.mjs` is invoked by
 *     about eleven packages' own build scripts, and `check:platform-checklist`
 *     is maintainer-run by design and says so where CI would otherwise run it.
 *     `check-regen-pending.d.mts` and `check-test-typecheck.mts` wear the name
 *     too; three more are test files ABOUT a gate. Neither sweep below ever
 *     OPENS one of them, because both walk `entry.files` — so naming them is
 *     the fabricated lead `hintCovers`' docblock prices above a missing one,
 *     however alive the script itself is. ⚠ Measured, not assumed: a survey
 *     scoped to the root manifest and the workflows reads the first of them as
 *     unwired, and the per-package manifests say otherwise.
 *   - it MISSES 31 real gate scripts, because a gate is not obliged to be
 *     called `check-` anything: the ten `packages/spec/scripts/build-*.ts`
 *     generators are gates, and so is a `.sh`.
 *
 * 93.3% precision and 81.8% recall, against 100/100 for the identity test —
 * which needs no heuristic at all, because the question "will these sweeps open
 * my file?" is answered by the same `entry.files` the sweeps themselves walk.
 *
 * A leading `./` is tolerated for the reason `isInRootTsProgram` tolerates one:
 * a seat pastes paths as its shell printed them.
 *
 * @param {string} path
 * @param {Set<string>} files
 */
export function isGateScriptPath(path, files) {
  return files.has(path.replace(/^\.\//, ''));
}

/**
 * Does this input path reach a metadata form module?
 *
 * A card's surface is named before its code exists, so a directory argument
 * counts when it CONTAINS one — `packages/spec/src/ui` really does cover seven
 * of them. The containment is one-directional in the same sense
 * `isInI18nBundlePackage` is: an input that collapses to a bare top-level
 * directory (`packages`) is refused, because such an input covers the whole
 * tree below it and would print this gate for every card in the repo.
 */
export function reachesMetadataFormModule(path, modulePaths) {
  if (!path.includes('/')) return false;
  return modulePaths.some((m) => m === path || m.startsWith(`${path}/`));
}

/**
 * The change-kind roster is data: `CHANGE_KIND_ROWS` in `dispatch-gates.data.mjs` carries each kind, the
 * NAME of the predicate that recognises it, and the gates it names — with the docblock that governs the
 * table. This binding resolves each predicate name to the function below, and refuses a name it does not
 * know at load time, so a row that spells a predicate wrongly can never match nothing in silence.
 */
const CHANGE_KIND_PREDICATES = Object.freeze({
  'test-file': isTestFilePath,
  'i18n-bundle-package': (path) => isInI18nBundlePackage(path, i18nBundlePackageDirs()),
  'metadata-form-module': (path) => metadataFormsSurfaceIsExtracted() && reachesMetadataFormModule(path, metadataFormModulePaths()),
  'gate-script': (path) => isGateScriptPath(path, gateFamilyFiles()),
  'root-ts-program': (path) => isInRootTsProgram(path, rootTsProgramExcludedDirs()),
  'error-code-literal': stampsAnErrorCodeLiteral,
  'http-status-emit': emitsAnHttpStatus,
});

export function bindChangeKindRows(rows, predicates = CHANGE_KIND_PREDICATES) {
  return rows.map((row) => {
    const matches = predicates[row.matches];
    if (typeof matches !== 'function') {
      throw new Error(
        `dispatch-gates: change-kind row '${row.kind}' names the predicate '${row.matches}', which this engine does not define — ` +
          `known: ${Object.keys(predicates).join(', ')}`,
      );
    }
    return { ...row, matches };
  });
}

export const CHANGE_KIND_GATES = bindChangeKindRows(CHANGE_KIND_ROWS);

/**
 * Render the convention-triggered section. Pure over its inputs so the
 * self-test can drive both the hit and the STALE branch offline;
 * `resolveInvocation` returns a runnable command for a gate the live run
 * discovered, or null for one it did not.
 */
/**
 * The convention-triggered gates a card's KINDS hit, as DATA.
 *
 * Split out from the rendering below for the reason the per-hint sweep is
 * shared with the residue annotations: the human lines and the machine-readable
 * modes must not be able to disagree about which gates a card owes. A second
 * traversal of CHANGE_KIND_GATES for `--json` would be a second answer to a
 * question this file already answers once, and the whole card is about two
 * renderings of one derivation drifting apart.
 *
 * `command` is null exactly where the rendering prints its STALE warning — a
 * name no workflow runs any more. Machine consumers get the null rather than a
 * fabricated command, and the shape of the row says which.
 */
export function changeKindGates(paths, resolveInvocation, kinds = CHANGE_KIND_GATES) {
  const groups = [];
  for (const { kind, matches, gates } of kinds) {
    const hits = paths.filter((p) => matches(p));
    if (hits.length === 0) continue;
    groups.push({
      kind,
      hits,
      gates: gates.map(({ name, why }) => ({ name, why, command: resolveInvocation(name) })),
    });
  }
  return groups;
}

export function changeKindLines(paths, resolveInvocation, kinds = CHANGE_KIND_GATES) {
  const lines = [];
  for (const { kind, hits, gates } of changeKindGates(paths, resolveInvocation, kinds)) {
    lines.push(`  ${kind}: ${hits.join(', ')}`);
    for (const { name, why, command } of gates) {
      lines.push(
        command
          ? `    - ${command}   — ${why}`
          : `    - ⚠ ${name}: STALE — no workflow runs a gate under this name. It was renamed or retired; fix CHANGE_KIND_GATES in this script.`,
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The families a changeset will add — derived, not listed (#10309)
// ---------------------------------------------------------------------------

/**
 * The hypothetical changeset file the pending section is derived against.
 *
 * Assembled from halves for the reason DEFAULT_BASE_REF is: a module-body
 * constant spelling it whole would enter THIS file's own watch-hint set as a
 * path, which is the fabrication its header argues against. Only the joined
 * value is pathy, and it exists at runtime alone.
 *
 * The dot is on the TEMPLATE rather than on the directory constant, and that is
 * load-bearing here in a way it is not for the base ref. `looksPathy` is not
 * "contains a slash" alone — `extractWatchHints` also admits a literal naming a
 * top-level dotted dir with no separator in it at all, and the changeset
 * directory is one of the four it names. Measured on this file: written the
 * obvious way, as one `.changeset` constant, this tool's own source grew a
 * ninth hint reaching the changeset directory — inert for gate matching today
 * only because no family resolves to this file, and the broadest possible
 * fabrication on the day one does. Spelled below, it grows none.
 *
 * The filename is deliberately not a plausible one. It is printed in the
 * provenance column of every row below, and a reader who takes it for a file on
 * disk has been told something false by a tool whose whole contract is that its
 * leads are real.
 */
const CHANGESET_DIR_NAME = 'changeset';
const CHANGESET_PROBE_NAME = 'the-one-you-have-not-written-yet.md';
export const CHANGESET_PROBE_PATH = `.${CHANGESET_DIR_NAME}/${CHANGESET_PROBE_NAME}`;

/**
 * The families that will apply once this card's changeset exists — the ones the
 * derivation is structurally short by at the moment it is USED (#10309).
 *
 * ## The defect this answers
 *
 * The PM derives the gate list at DISPATCH time, over the card's declared file
 * surface, and pastes it into the brief. The dev then re-derives from the real
 * diff. Measured over one round of five independent dispatches, every single
 * dev reported the same delta and it was always the same five families:
 * `check:changeset-gate-self-tests`, `check:objectui-changeset`,
 * `check-adr-0087-registration.mjs`, `check-changeset-no-major.mjs`,
 * `check-empty-changeset.mjs`. On two of the five cards those five were the
 * WHOLE delta.
 *
 * They are triggered by the changeset directory, they are perfectly
 * path-derivable, and the path is simply not there yet: the dev writes the
 * changeset after the derivation runs. So the derivation is correct at the
 * moment it runs and short by these families by the time anyone acts on it —
 * and short the same way every time, which is the part that costs something. A
 * delta that is constant trains a reader to skip the whole comparison, and a
 * real delta then hides inside five rows of noise. The property worth having is
 * that the difference between the PM's list and the dev's re-derivation is
 * INFORMATION.
 *
 * ## Why this is a probe and not a list
 *
 * ⛔ There is no table of changeset gates in this file and there must not be.
 * This re-runs the SAME classifier the matched list is built from, against one
 * hypothetical path, over the families the live discovery pass already found —
 * so it reads CI's declared trigger and the gates' own watch hints exactly as
 * every other row does. A sixth changeset-triggered family appears here the day
 * it lands, with nothing to edit. That is the same contract as the rest of the
 * script ("this script names no gate from memory"), applied to a question about
 * a file that does not exist yet.
 *
 * ## Why already-matched families are subtracted
 *
 * `matchedChecks` is the set the matched list already printed. When the input
 * really does carry a changeset — the dev's re-derivation after writing one —
 * these families match on their own and belong in that list; printing them here
 * as well would be the same lead twice, in two sections that make different
 * claims about time. Subtraction is also why no predicate over the input paths
 * is needed: a path set that reaches these families for ANY reason removes them
 * from this section, and a partial overlap leaves exactly the remainder.
 *
 * Pure over its inputs — `entries` is `[check, entry]` pairs — so the self-test
 * drives it offline on fixtures.
 */
export function pendingChangesetFamilies(entries, matchedChecks, probe = CHANGESET_PROBE_PATH) {
  const pending = [];
  for (const [check, entry] of entries) {
    if (matchedChecks.has(check)) continue;
    const { verdict, hits } = classifyEntry(entry, [probe]);
    if (verdict === 'matched') pending.push({ check, entry, hits });
  }
  return pending;
}

/**
 * Render the pending-changeset section. Empty array when there is nothing
 * pending, so the section vanishes rather than printing a zero — a card whose
 * diff already carries a changeset has no temporal gap left to disclose, and a
 * "0 families" heading would invite the reader to look for one.
 */
export function pendingChangesetLines(pending, probe = CHANGESET_PROBE_PATH) {
  if (pending.length === 0) return [];
  const lines = [
    `Once a changeset exists, ${pending.length} more famil(ies) apply — write one unless this card publishes nothing from any released package (then the skip-changeset label instead, per the os-dev clause):`,
  ];
  for (const { entry, hits } of [...pending].sort((a, b) => a.check.localeCompare(b.check))) {
    const via = hits.map((h) => `${h.via} '${h.hint}'`).join('; ');
    lines.push(
      `  - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]   would match ${probe} via ${via}`,
    );
  }
  lines.push(
    `  Derived by re-running this same discovery pass against ${probe} — a path that does not exist. Nothing here is`,
    '    listed in this script, so a changeset-triggered family added tomorrow prints itself with nothing to update.',
    '  ⛔ NOT a fourth bucket, and NOT a second copy of the matched list: for the paths as they stand these families',
    '    earn an ordinary verdict in the residue below and are counted there. They are lifted out here because the',
    '    changeset is written by the DEV, after this derivation runs — so a list that is right when it is derived is',
    '    short by exactly these rows by the time it is used. Once the diff really carries one they move into the',
    '    matched list above and this section stops printing.',
  );
  return lines;
}

/**
 * The closing accounting: every discovered family placed, with runtime counts
 * and NOT ONE GATE NAMED.
 *
 * ## What this replaced, and why naming any gate here is the bug (#8632)
 *
 * This paragraph used to end with a hand-written list — "the rest stay the PM
 * judgment call — new fake engine => check:engine-double-contract, new error
 * code => check:error-code-casing, any edit => check:nul-bytes". Three problems,
 * all measured:
 *
 *   - it was a SECOND COPY of a list that lives in `.claude/agents/os-dev.md`,
 *     which names four gates where this named three (it also carries
 *     `.claude/agents/**` => check:agent-model-declared). The two copies had
 *     already drifted apart. A second copy of a list rotting inside prose is the
 *     canonical incident this file's own header cites as the reason it embeds no
 *     list of checks — reproduced in the file's last sentence;
 *   - it was not a census of its own residue and nothing said so.
 *     `check:where-matcher` is the same class of gate and appears nowhere in
 *     this file — grep count 0 — so a dev following the output to the letter,
 *     closing paragraph included, had no path to it at all. That cost a CI
 *     round;
 *   - the residue it claimed to summarise is not three families. Measured at the
 *     time of writing: 98 discovered, 8 matched for a two-path card, 35
 *     undetermined and 55 silent. An enumeration of 90 families in prose is not
 *     a thing anyone can keep in sync, so keeping the sentence and guarding it
 *     was never available — the honest move is to stop enumerating and state the
 *     partition, which is derived and cannot drift.
 *
 * So this function names no gate, and a self-test case holds it to that. The
 * families themselves are listed on demand by `--residue`, from the live
 * derivation, where they cannot be stale.
 *
 * ## Why `silent` is now printed at all
 *
 * It was the undeclared fourth bucket: `classifyEntry` has always produced it
 * and no output ever mentioned it, so the majority of the farm (55 of 98) was
 * excluded by a verdict the reader could not see, let alone weigh. And it is the
 * derivation's WEAKEST claim — a gate that computes its population and names
 * only its own baseline artifact scores `silent` for every card in the tree,
 * which is exactly how the three test-file ratchets went missing. Counting it
 * out loud is what makes "no family names your paths" an answer a reader can
 * judge instead of an absence they never see.
 *
 * Throws when the three verdicts do not account for every discovered family:
 * under this script's contract a derivation that cannot complete exits non-zero
 * rather than printing a wrong answer, and a fourth bucket added without wiring
 * it in here would otherwise silently shrink the residue.
 *
 * ## Why the unfiltered-workflow count is printed, and why it is NOT a bucket
 *
 * `unfiltered` counts the families reached by NEITHER path declaration CI
 * obeys: no `on.pull_request.paths` filter on any of their workflows, and no
 * job `if:` resolving to a `dorny/paths-filter` population (#12956). CI
 * schedules those on EVERY pull request, so no path derivation can ever narrow
 * them.
 *
 * The second half is not decorative. Counting only the workflow trigger kept
 * this line asserting "no path derivation can narrow them" about the six
 * families in ci.yml's filtered jobs — including the two a pin bump exists to
 * run — in the same output where the derivation had just narrowed them. A count
 * that contradicts the answer above it is worse than no count. It cuts across all
 * three verdicts (an unfiltered family can be matched, undetermined or silent),
 * so it is deliberately outside the accounting throw: adding it to the
 * partition would double-count and turn a correct run into a thrown error.
 *
 * It is printed for the same reason `silent` is: the reader is being told what
 * this derivation's silence does and does not mean, and on this tree the number
 * is most of the farm. An absence nobody can size is one nobody can weigh.
 *
 * ## Why the unreachable count is printed, and why the SWEPT total is beside it
 *
 * `unreachable` is the third verdict (#9883): families whose whole declared
 * population matches nothing in the tree. Like `unfiltered` it cuts across the
 * partition — it is a fact about the TREE, not about the card's paths — so it
 * is outside the accounting throw for the same double-counting reason.
 *
 * `swept` is the size of the corpus that produced it, and it is required
 * rather than optional because a bare "0 unreachable" is the exact ambiguity
 * the verdict exists to remove one level down: it reads identically as "the
 * repo is healthy" and as "the sweep matched nothing at all" (#4690). Printed
 * with the corpus it swept, zero is readable. `trackedFiles` refuses an empty
 * corpus before it gets here; this validation is the second half of the same
 * refusal, for a caller that computed the count some other way.
 */
/**
 * The unreachable listing, rendered for the DEFAULT output rather than for
 * `--residue` alone (#10097, option A).
 *
 * ## Why this moved out from behind the flag
 *
 * The disclosure already existed — the sweep has always reported these families
 * and called them a standing repo fact. What did not exist was any reason for a
 * reader to look. Every dispatch brief in this lane says "run every family
 * `dispatch-gates` names", and nothing told a dev that the derived list is not
 * a local pre-flight equivalent of CI. A dev who followed the brief exactly
 * passed locally and then went red in CI on `check:driver-memory-census` — a
 * real defect, caught by a gate no derivation could ever have named. The flag
 * that would have shown it is one nobody was told to pass.
 *
 * So the limit prints at the moment of use. This is the file's own standing
 * argument ("silent is not clearance") applied to the derivation itself.
 *
 * ## What the heading has to say, and what it must NOT be read as
 *
 * ⛔ These gates are NOT skipped. Every one of them sits in a workflow with no
 * `pull_request` path filter, so CI schedules them on EVERY pull request. The
 * unreachable verdict is about what this DERIVATION can name, never about what
 * CI runs — and a reader who takes it for a skip list draws exactly the wrong
 * conclusion, so the heading carries the correction rather than leaving it to
 * the residue prose two screens down.
 *
 * Entries are grouped by `unreachableClass`, and the ordering is deliberate:
 * "layout moved" is a real miss wanting triage and prints FIRST, while the
 * by-construction families — the standing facts — print after it. A single flat
 * list would bury the actionable one among the inert.
 */
export function unreachableLines(unreachable, swept) {
  if (!Number.isInteger(swept) || swept <= 0) {
    throw new Error(
      `the unreachable listing needs the corpus it swept: got ${String(swept)} tracked file(s) ` +
        '(an empty listing and an empty sweep read alike without it — #4690)',
    );
  }
  const scheduled = unreachable.filter((u) => (u.entry?.jobFilters?.length ?? 0) > 0).length;
  const lines = [
    `Unreachable — the ${unreachable.length} famil(ies) whose declared population matches NOTHING in this tree,` +
      ` swept over ${swept} tracked file(s).`,
    '  ⛔ NOT a skip list. This says only that the family\'s OWN declared literals name nothing here, so its verdict',
    '    is the same quiet green for every card in the tree — yours included — whether it still works or not.',
  ];
  // Since #12956 the two facts can come apart, and saying otherwise would make
  // this heading contradict the matched list two screens up: a family whose own
  // literals reach nothing can still be SCHEDULED from a path population, when
  // the job that runs it carries a resolvable paths-filter `if:`. The blanket
  // "CI runs these on every pull request" was true of every entry before that
  // and is not true of those, so it is stated per entry instead.
  lines.push(
    scheduled === 0
      ? '  Every one of them also sits outside any path filter, so CI schedules it on EVERY pull request.'
      : `  Nonetheless SCHEDULED from a path population: ${scheduled} of the ${unreachable.length} — the job running each` +
        ' carries a resolvable paths-filter `if:`, so it IS named in the matched list above for the cards that job runs on,'
        + ' and is marked below. The rest sit outside any path filter, so CI schedules those on EVERY pull request.',
  );
  if (unreachable.length === 0) {
    lines.push('  (none — every declaring family reaches something in the tree.)');
    return lines;
  }
  const byClass = new Map();
  for (const item of [...unreachable].sort((a, b) => a.check.localeCompare(b.check))) {
    const cls = unreachableClass(item.dead);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(item);
  }
  for (const cls of ['layout moved', 'by construction']) {
    const items = byClass.get(cls);
    if (!items?.length) continue;
    lines.push(
      cls === 'layout moved'
        ? `  ${items.length} where THE LAYOUT MOVED under a gate that still spells the old path — a real miss, worth triaging:`
        : `  ${items.length} unreachable BY CONSTRUCTION — the literal is not a path this derivation can reach, and no change` +
          ' to the gate or the tree makes it one:',
    );
    for (const { entry, dead } of items) {
      const jf = entry.jobFilters ?? [];
      const schedule = jf.length
        ? `   ⇢ but SCHEDULED by ${jf.map((f) => `'${f.name}' in ${f.workflow}`).join(', ')} — reachable through that job's filter, not through its own literals`
        : '';
      lines.push(
        `    - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]   dead: ${unreachableReason(dead)}${schedule}`,
      );
    }
  }
  return lines;
}
/**
 * The "always runs" tail, rendered — printed on EVERY run, like the unreachable
 * listing and for the same reason.
 *
 * The disclosure has no value behind a flag nobody is told to pass: the dev who
 * paid for #13333 ran every family this tool named, and the step that reddened
 * was one the tool had never mentioned. `unreachableLines`' header records the
 * identical lesson one bucket over, and the fix there was to print at the
 * moment of use rather than to write a warning somewhere.
 *
 * ## Deduplicated by COMMAND, never by step name
 *
 * `Install dependencies` appears once per job and is the same command every
 * time; `Build workspace packages` and `Build the ledgered packages'
 * dependencies` are different names for two different turbo filters. Collapsing
 * by name would merge two real commands and hide one; collapsing by command
 * text merges only what is literally the same thing to run. The jobs a repeated
 * command also belongs to are named on its row, so nothing is lost by the
 * collapse — a reader can still see it is five jobs' worth of setup and not a
 * gate.
 *
 * Refuses rather than prints when the counts do not account for each other, on
 * the same contract as `residueLines`: a tail that has silently lost rows reads
 * exactly like a farm with nothing left to disclose (#4690).
 */
export const ALWAYS_RUN_COMMAND_CAP = 4;

export function alwaysRunLines(rows, counts) {
  const { unconditional, accounted, unaccounted, conditionalSteps, conditionalJobs } = counts ?? {};
  if (!Number.isInteger(unconditional) || unconditional <= 0) {
    throw new Error(
      `the always-runs tail found ${String(unconditional)} unconditional CI step(s): a workflow tree with none ` +
        'is a broken walk, not a clean farm — an unreadable input must never look like an empty answer (#4690)',
    );
  }
  if (!Number.isInteger(accounted) || !Number.isInteger(unaccounted) || accounted + unaccounted !== unconditional) {
    throw new Error(
      `the always-runs tail does not account for its own steps: ${String(accounted)} accounted + ` +
        `${String(unaccounted)} unaccounted != ${unconditional} unconditional`,
    );
  }
  if (unaccounted !== rows.length) {
    throw new Error(`the always-runs tail counted ${unaccounted} unaccounted step(s) but carries ${rows.length} row(s)`);
  }

  const byCommand = new Map();
  for (const row of rows) {
    const key = row.commands.join('\n');
    if (!byCommand.has(key)) byCommand.set(key, { ...row, alsoIn: [] });
    else byCommand.get(key).alsoIn.push(`${row.workflow} · ${row.job}`);
  }

  const lines = [
    `Always runs — ${unaccounted} of the ${unconditional} unconditional CI step(s) are ones this derivation names NO family for` +
      ` (${byCommand.size} distinct command(s), over ${unconditional - unaccounted} it does name one for).`,
    '  ⛔ NOT a per-card list and NOT narrowable: these steps sit in a workflow with no pull_request path filter, in a job and a',
    '    step with no `if:`, so CI runs every one of them on EVERY pull request whatever your diff is. Running every family named',
    '    above therefore does NOT cover them — that is the gap this tail exists to close, and it is identical for every card.',
    '  ⛔ NOT classified into gates and setup. Some rows are verification and some are `pnpm install`; every rule that tells them',
    '    apart is a guess about a step\'s intent. What is claimed for each row is only what was measured: CI runs it, and the',
    '    derivation above names nothing for it.',
  ];
  if (conditionalSteps || conditionalJobs) {
    lines.push(
      `  Excluded as conditional, and sized rather than dropped: ${conditionalJobs} job(s) and ${conditionalSteps} step(s) carry an` +
        ' `if:`, so CI may skip them and this tail makes no claim about those.',
    );
  }
  if (byCommand.size === 0) {
    lines.push('  (none — every unconditional step contributes a family the derivation can name.)');
    return lines;
  }
  for (const row of byCommand.values()) {
    const also = row.alsoIn.length ? `   (also run by ${row.alsoIn.length} other job(s))` : '';
    lines.push(`  - [${row.workflow} · ${row.job}] ${row.step}${also}`);
    // A row is a POINTER to a step, not a transcript of it. One step in this
    // tree is a 30-line shell program that discovers and runs every hook
    // self-test, and printed whole it is longer than the other fifteen rows
    // together — a tail nobody reads discloses nothing. The elision names the
    // file to read instead, so the disclosure survives the cut.
    for (const command of row.commands.slice(0, ALWAYS_RUN_COMMAND_CAP)) lines.push(`      ${command}`);
    const elided = row.commands.length - ALWAYS_RUN_COMMAND_CAP;
    if (elided > 0) lines.push(`      … ${elided} more line(s) — read the step in ${row.workflow}`);
  }
  return lines;
}

/**
 * The path-scheduled CI jobs, rendered (#16285) — printed BELOW the
 * reconciliation, because everything under that total names something OUTSIDE
 * this card's runnable answer and these rows are outside it by construction:
 * they are CI's own shell, in CI's environment, and no local run of them is on
 * offer.
 *
 * Placed directly ABOVE the always-runs tail because the two are the halves of
 * one partition and the adjacency is the claim: the tail reads the jobs CI
 * CANNOT narrow by path, this reads the jobs your paths narrow it TO. A reader
 * meeting one and not the other has half the account of what CI runs.
 *
 * Rows carry the job NAME, which is what CI, branch protection and a red check
 * call it — a lead a dev cannot find in the Checks tab is a lead they will not
 * act on, the reason `extractJobBlocks` reads the name at all.
 *
 * The command transcript is capped and elided on `ALWAYS_RUN_COMMAND_CAP`, the
 * tail's own cap and the same pointer text, because it is the same decision for
 * the same reason: a row is a POINTER to a step, not a transcript of it, and a
 * block nobody reads discloses nothing. ⛔ One cap, one spelling — a second
 * constant here would be a second rule about one thing.
 */
export function jobFilteredStepLines(rows, counts) {
  if (rows.length === 0) return [];
  const { covering = 0, named = 0, steps = 0, accounted = 0, unaccounted = 0, conditionalSteps = 0 } = counts ?? {};
  if (named !== rows.length) {
    throw new Error(
      `the path-scheduled job block counted ${named} job(s) with an unnamed step but carries ${rows.length} row(s)`,
    );
  }
  if (accounted + unaccounted !== steps) {
    throw new Error(
      `the path-scheduled job block does not account for its own steps: ${accounted} accounted + ` +
        `${unaccounted} unaccounted != ${steps} walked`,
    );
  }
  const lines = [
    `CI jobs YOUR paths schedule — ${covering} job(s) CI runs because one of your paths is in the population its \`if:\` reads,` +
      ` ${named} of them carrying ${unaccounted} step(s) this derivation names NO check family for (over ${accounted} it does).`,
    '  ⛔ NOT runnable and ⛔ NOT in --commands: every row is CI\'s own shell in CI\'s environment. They sit OUTSIDE the runnable',
    '    total above — running every family named there does NOT cover them, which is the gap this block exists to close.',
    '  ⛔ NOT classified into tests, builds and setup — the same refusal the always-runs tail makes, for the same reason: every rule',
    '    that tells them apart is a guess about a step\'s intent. What is claimed for a row is only what was measured — YOUR path puts',
    '    this job on the PR, and nothing above names a family for this step. The reader judges the rest.',
    '  ⇒ The always-runs tail below is the OTHER half of this partition: it reads the jobs CI cannot narrow by path, this one reads',
    '    the jobs your paths narrow it TO — and a job carrying an `if:` is excluded there, which is every job on this list.',
  ];
  if (conditionalSteps) {
    lines.push(
      `  Excluded as conditional, and sized rather than dropped: ${conditionalSteps} step(s) of these jobs carry an \`if:\`,` +
        ' so CI may skip them and this block makes no claim about those.',
    );
  }
  for (const row of rows) {
    const via = row.hits.map((h) => `${h.path} ⇢ '${h.pattern}'`).join('; ');
    const dropped = row.dropped ? `, ${row.dropped} glob(s) of it untranslatable and dropped` : '';
    lines.push(
      `  - [${row.workflow} · ${row.job}]   scheduled by ${via}   (job \`if:\` reads ${row.outputs.join(', ')}${dropped})`,
    );
    for (const { step, commands } of row.steps) {
      lines.push(`      · ${step}`);
      for (const command of commands.slice(0, ALWAYS_RUN_COMMAND_CAP)) lines.push(`          ${command}`);
      const elided = commands.length - ALWAYS_RUN_COMMAND_CAP;
      if (elided > 0) lines.push(`          … ${elided} more line(s) — read the step in ${row.workflow}`);
    }
  }
  return lines;
}

/**
 * The type-check lanes, rendered — printed on EVERY run, like the two step
 * blocks around it and for the same reason: it is not about the card's paths,
 * and the family list provably does not cover it (#19172). Rows carry the JOB
 * NAME, which is what CI and a red check call it. ⭐ Absence renders LOUD
 * instead of vanishing — a tree whose pull-request workflows yield no lane is a
 * recogniser that has rotted, not a farm with nothing left to disclose.
 */
export function typeCheckLaneLines(rows, counts) {
  const { prWorkflows = 0, steps = 0, runLines = 0 } = counts ?? {};
  const walked = `${steps} command-carrying step(s) / ${runLines} spliced \`run:\` line(s) across ${prWorkflows} pull-request workflow(s)`;
  if (rows.length === 0) {
    return [
      'Type-check lanes — ⊘ NOT MEASURED, and THE SOURCE OF TRUTH CAME BACK EMPTY.',
      `  Walked ${walked}, and not one line in them invokes a TypeScript type-check program.`,
      '  ⛔ Read that as a BROKEN READ, never as a tree without type checking: this block names what CI runs, so a reading of zero',
      '    is a statement about this walk. It is printed rather than dropped because a missing block looks exactly like a covered surface.',
    ];
  }
  const lines = [
    `Type-check lanes — ${rows.length} CI step(s) run a TypeScript type-check PROGRAM and ⊘ NOT ONE of them is measured by anything above.`,
    `  Walked ${walked} to find them: the DENOMINATOR, so a recogniser that stops spelling a lane shows as a dip rather than as silence.`,
    '  ⛔ NOT the `check:type-check-coverage` / `check:type-check-debt` families the matched block may carry: those ratchet a LEDGER and a',
    '    lane reds on a per-package `tsc` program instead — finding those two in a grep for `typecheck` is the false reassurance this block',
    '    exists to break. NOT runnable as spelled either: CI\'s own shell over CI\'s whole-workspace filters, OUTSIDE the runnable total, and',
    '    a row marked conditional MAY be skipped. ⇒ What a card owes instead: `pnpm --filter <pkg> run typecheck` for every package whose',
    '    TypeScript this diff changes what a program can SEE — one added import or one new root-level declaration is enough.',
  ];
  for (const row of rows) {
    lines.push(`  - [${row.workflow} · ${row.job}] ${row.step}${row.conditional ? '   (conditional — CI may skip it)' : ''}`);
    for (const command of row.commands.slice(0, ALWAYS_RUN_COMMAND_CAP)) lines.push(`      ${command}`);
    const elided = row.commands.length - ALWAYS_RUN_COMMAND_CAP;
    if (elided > 0) lines.push(`      … ${elided} more line(s) — read the step in ${row.workflow}`);
  }
  return lines;
}

/**
 * The whole-tree channel, rendered (#14189) — its own heading, identical on
 * every card, printed ABOVE the reconciliation because its commands are inside
 * that total.
 *
 * ⛔ Not folded into the matched block. A row that appears on every card is not
 * a lead, and pasting these into the matched block would put them under a
 * caption that promises "these families name YOUR paths" — the fabricated-lead
 * shape this file's header prices and refuses. The heading is the claim: these
 * are placed by declaration.
 *
 * Each row carries the gate's own REASON and the liveness spelling that vouches
 * for it, for the same reason the matched column carries `via`: a reader
 * deciding whether to trust a row is being told what produced it. A refused
 * declaration prints as a REFUSED row rather than vanishing — a family dropped
 * from every rendering because its declaration was malformed is the silent
 * direction, and this file's contract is that an omission is stated where the
 * omission happens.
 */
export function alwaysRunsPopulationLines(rows) {
  if (rows.length === 0) return [];
  const lines = [
    `Always runs (declared population) — ${rows.length} famil(ies) DECLARE that their population is the WHOLE TREE, so every card` +
      ' implicates them. ⛔ Not the always-runs STEP tail further down: that one is about workflow steps this derivation names no family for.',
  ];
  for (const row of rows) {
    if (row.refused) {
      lines.push(`  - ⚠ ${row.check}: REFUSED — ${row.refused}`);
      continue;
    }
    lines.push(`  - ${row.command}   [${row.workflows.join(', ')}]   declared whole-tree population — ${row.reason}`);
    lines.push(
      `      ↳ liveness: its own source carries ${row.rootWalk}` +
        `${row.ciOnly ? ' · CI-MEASURED ONLY — no local run of it can produce a verdict, so it is NOT in --commands' : ''}` +
        `${row.notRunnable ? ` · ⛔ NOT RUNNABLE LOCALLY — it takes ${row.notRunnable.variables.join(', ')} from the workflow, so it is NOT in --commands` : ''}`,
    );
  }
  lines.push(
    '  ⇒ Placed by DECLARATION, not by your paths: every card gets these same rows, which is the honest shape for a gate that reads every' +
      ' file. They are NOT leads — nothing enters or leaves the matched column because of them — and they ARE in the runnable total below.',
  );
  return lines;
}

/**
 * The WIDE-population channel, rendered (#15341) — the residue's DECLARED
 * column, printed BELOW the reconciliation because its commands are NOT inside
 * that total.
 *
 * That placement is the claim, and it is the one line of difference from
 * `alwaysRunsPopulationLines` above: everything under the reconciliation names
 * something OUTSIDE this card's runnable answer. A whole-tree family is owed by
 * every card, so it prints above the total and its command is in it. A
 * wide-population family is run by CI over a population no card's paths can
 * narrow — pasting it into every harvest would be the fabricated lead the
 * recorded triage refused in the first place — so it prints here, named, with
 * the reason that is the whole content of the channel.
 *
 * A refused declaration prints as REFUSED rather than vanishing, for the reason
 * the sibling section states: a family dropped from every rendering because its
 * declaration was malformed is the silent direction.
 */
export function widePopulationLines(rows) {
  if (rows.length === 0) return [];
  const lines = [
    `Declared WIDE population — ${rows.length} famil(ies) DECLARE that CI runs them over a population too wide to place, so no`
      + " path of yours can narrow them and their absence from the matched block above is NOT a clearance.",
  ];
  for (const row of rows) {
    if (row.refused) {
      lines.push(`  - ⚠ ${row.check}: REFUSED — ${row.refused}`);
      continue;
    }
    lines.push(`  - ${row.command}   [${row.workflows.join(', ')}]   declared wide population — ${row.reason}`);
  }
  lines.push(
    '  ⇒ Declared, and deliberately NOT in this card\'s runnable total: the population is real and every subtree spelling of it'
      + ' is either false or so wide it would name the gate on every card under the root — the trade scripts/pm/bare-root-worklist.mjs'
      + ' records per row as REFUSE-WIDE / REFUSE-UNSPELLABLE. CI runs them on every PR regardless, so read this block as "these'
      + ' gates judge your diff and no derivation can tell you whether they bite" — go read the reason, not the absence.',
  );
  return lines;
}

export function residueLines(
  {
    discovered, matched, undetermined, silent, unfiltered, unreachable, swept,
    artifactRosters, invertedRosters, documentedNoPopulation, alwaysRuns = 0, widePopulation = 0,
  },
  kinds = CHANGE_KIND_GATES,
) {
  // FIVE verdicts now (#14189, #15341). Each declaration channel is a term of
  // the partition rather than a subset of one, and each is added HERE because
  // the throw below is the thing that would otherwise absorb it silently: a
  // placement wired into the derivation and not into this sum shrinks the
  // residue by exactly the families it placed, and every count still prints.
  const placed = matched + undetermined + silent + alwaysRuns + widePopulation;
  if (placed !== discovered) {
    throw new Error(
      `residue accounting is short: ${placed} famil(ies) placed of ${discovered} discovered ` +
        '(matched + undetermined + silent + always-runs + wide-population must cover every discovered family)',
    );
  }
  if (!Number.isInteger(widePopulation) || widePopulation < 0 || widePopulation > discovered) {
    throw new Error(
      `declared-wide-population count is not derivable: got ${String(widePopulation)} of ${discovered} discovered ` +
        "(it is read from each gate's own marker — never omitted; a missing count would print as a missing line)",
    );
  }
  if (!Number.isInteger(alwaysRuns) || alwaysRuns < 0 || alwaysRuns > discovered) {
    throw new Error(
      `declared-whole-tree count is not derivable: got ${String(alwaysRuns)} of ${discovered} discovered ` +
        "(it is read from each gate's own marker — never omitted; a missing count would print as a missing line)",
    );
  }
  if (!Number.isInteger(unfiltered) || unfiltered < 0 || unfiltered > discovered) {
    throw new Error(
      `unfiltered-workflow count is not derivable: got ${String(unfiltered)} of ${discovered} discovered ` +
        '(it must be counted from the workflows, never omitted — a missing count would print as a missing line)',
    );
  }
  if (!Number.isInteger(unreachable) || unreachable < 0 || unreachable > discovered) {
    throw new Error(
      `unreachable-population count is not derivable: got ${String(unreachable)} of ${discovered} discovered ` +
        '(it must be swept from the tree, never omitted — a missing count would print as a missing line)',
    );
  }
  if (!Number.isInteger(swept) || swept <= 0) {
    throw new Error(
      `the swept corpus size is not derivable: got ${String(swept)} tracked file(s) ` +
        '(a reachability count without the corpus it swept cannot be read: zero unreachable and a zero-file sweep print alike — #4690)',
    );
  }
  // The silence split (#10784), held to the same standard as the two counts
  // above and for the same reason: this one sizes the part of `silent` that is
  // not weak but INVERTED, and a count that could go missing quietly would
  // render the one line a reader needs as a line with `undefined` in it.
  if (!Number.isInteger(artifactRosters) || artifactRosters < 0 || artifactRosters > silent) {
    throw new Error(
      `artifact-roster count is not derivable: got ${String(artifactRosters)} of ${silent} silent ` +
        '(it is a subset of the silent families, counted from the tree — never omitted)',
    );
  }
  if (!Number.isInteger(invertedRosters) || invertedRosters < 0 || invertedRosters > artifactRosters) {
    throw new Error(
      `inverted-roster count is not derivable: got ${String(invertedRosters)} of ${artifactRosters} artifact roster(s) ` +
        "(the rosters whose common directory contains one of the caller's paths — a subset, never omitted)",
    );
  }
  // Held to the same standard as the counts above, and for the same reason
  // (#10542): this one sizes the part of `undetermined` that has been READ and
  // explained, and a count that could go missing quietly would render the one
  // line separating examined from unexamined as a line with `undefined` in it.
  if (
    !Number.isInteger(documentedNoPopulation)
    || documentedNoPopulation < 0
    || documentedNoPopulation > undetermined
  ) {
    throw new Error(
      `documented-no-population count is not derivable: got ${String(documentedNoPopulation)} of ${undetermined} undetermined ` +
        '(it is a subset of the undetermined families, read from each gate\'s own marker — never omitted)',
    );
  }
  const unplaced = undetermined + silent;
  return [
    `Residue — all ${discovered} discovered famil(ies) placed, derived at runtime:`,
    `  ${matched} matched above · ${undetermined} undetermined (their sources name no path at all — NOT known irrelevant)` +
      ` · ${silent} silent (their sources name paths, none of which cover yours)` +
      ` · ${alwaysRuns} always-runs (they DECLARE a whole-tree population, so they are placed by declaration and not by your paths)` +
      ` · ${widePopulation} declared-wide (they DECLARE a population too wide to place, so no path of yours can narrow them either way).`,
    `  Those ${alwaysRuns} are not leads and not silences: a gate that reads EVERY file is named on every card, so naming it in the matched` +
      ' column would be a fabricated lead and leaving it silent would be a false clearance. It declares the fact in its own source' +
      ' (dispatch-gates: whole-tree-population -- REASON, the inverse of the no-path-population marker above), the declaration is checked' +
      " against a repo-root walk in that same source, and the family is listed under its own always-runs heading with its commands INSIDE" +
      ' this card\'s runnable total.',
    `  Those ${widePopulation} are the THIRD channel (#15341) and the opposite disposition: CI runs each of them over a population too wide to place` +
      ' — a whole top-level root, or a file-KIND filter inside one that no subtree glob spells — so a true declaration would name the gate on every' +
      ' card under that root and the matched column would stop discriminating. They declare the fact in their own source' +
      ' (dispatch-gates: wide-population -- REASON), are listed under their own heading with that reason, and are deliberately' +
      " not in this card's runnable total: the per-row measured refusals behind them live in scripts/pm/bare-root-worklist.mjs." +
      ' Their absence from the matched block is NOT a clearance — read the reason.',
    `  ${documentedNoPopulation} of those ${undetermined} undetermined famil(ies) DECLARE that they have no path population, each with its own` +
      ' reason, read from a marker in the gate\'s source and printed against it under --residue. Those have been examined; the rest of the bucket' +
      ' has not, and the two used to read alike. A declaration is not an escape from having a population: a gate that walks a subtree declares it' +
      ' (the ROOT_DIR_WATCH_HINTS idiom) and a gate whose population is a repo-root FILE declares the subtree spelling — the marker is only for the' +
      ' families where both of those are false.',
    '  A `silent` verdict is this derivation\'s weakest claim, not a clearance, and there are two ways to earn it that have' +
      ' nothing to do with your paths: a gate that computes its own population and names only its baseline artifact scores' +
      ' silent for every card in the tree, and so does one whose population is a repo-root FILE it spells as a bare' +
      ' filename — a literal with no path separator is refused as too generic, so the gate reads your file while naming' +
      ' nothing that can match it. That second one is escapable, and gates have escaped it: a gate whose population really' +
      ' is a root file reaches it by declaring the subtree spelling (`AGENTS.md/**`), after which it is no longer silent' +
      " for that file. hintCovers' docblock carries the measurement and what the refusal buys.",
    `  ${artifactRosters} of those ${silent} declare ONLY tracked FILES — an artifact roster, not a population: a baseline the gate maintains, or an` +
      ' allowlist of the members it already has. A list of the files that already exist can never contain one added tomorrow, so its silence is a' +
      ` fact about the roster rather than about your paths.${
        invertedRosters
          ? ` ⛔ For ${invertedRosters} of them the roster sits in a directory one of YOUR paths is in, and there this verdict is not evidence in` +
            ' EITHER direction — it is the shape that reads as a clearance and is not. Named, with the discriminator and the remedy, under --residue.'
          : ' None of their rosters sits in a directory your paths are in. They are named, with the discriminator, under --residue.'
      }`,
    `  ${unfiltered} of the ${discovered} are reached by NEITHER path declaration CI obeys — no workflow pull_request path filter,` +
      ' and no job `if:` that resolves to a dorny/paths-filter population. CI schedules those on EVERY pull request, so no path' +
      ' derivation can narrow them and their verdict above is about relevance, never schedule.',
    `  ${unreachable} of the ${discovered} declare a population that reaches NOTHING in the tree, swept over ${swept} tracked file(s) —` +
      ' their own sources name paths and this repo has none of them, so they score the same quiet green for every card in the tree' +
      ' whether they still work or not. A standing repo fact, not a verdict about your paths; they are named ABOVE on every run,' +
      ' each with the deepest prefix the tree still has for it and whether it is unreachable by construction.',
    `  Convention-triggered gates cut ACROSS all three and are printed above when a kind hits (${kinds.map((k) => k.kind).join('; ')}).`,
    `  This script names no gate from memory. To list the ${unplaced} famil(ies) the path derivation did not place, runnably:` +
      ' node scripts/pm/dispatch-gates.mjs --residue <paths>',
  ];
}

// ---------------------------------------------------------------------------
// Model-tier derivation — the half of the tier decision that IS a path question
// ---------------------------------------------------------------------------

/**
 * The single source of truth for the model tier the PM lane's governance
 * reads — clause ②'s CONTRACT-REVIEW tier: the tier the clause-② REVIEW runs
 * at, both halves of it — the spec and skills lanes' review of every round
 * they deliver (a card that WIDENS a published accept set or the public
 * surface is spec-lane work, whichever seat found it; a card that only
 * NARROWS one is not, and owes one contract-review-tier review before the
 * queue while staying in its lane) and the `Served-tier:` line every
 * `## Contract review` record carries. The
 * BUILD of such a card is at the default judgment tier, so
 * this constant is a review tier and never a dispatch mandate. Declared HERE
 * and only here, as a constant, so a model upgrade is a one-line change in one
 * file — the clause-① mandate rows below read it, the self-test compares
 * against it, and the PM skill's prose names it, so the model id is spelled as
 * a VALUE on this one line and nowhere else across `scripts/pm/**` and
 * `.claude/skills/pm-dispatch/**` (a second value site is what let this
 * constant drift from the served tier unnoticed). The comparison against the
 * served tier is EXACT, never a family or prefix floor — widening a governance
 * gate's accept set is the maintainer's decision, not a refresh-time
 * convenience. The review label deliberately names WHAT is reviewed, never a
 * model (maintainer, 2026-08-16: 「needs:fable-review 这个标签不好,下次模型升级怎么办」).
 *
 * ## A tier that is GONE is not a tier that is EXHAUSTED — and a SESSION not
 * served one is neither of them (#19544, reversed by #19680)
 *
 * The exits below carry a QUOTA exemption: a tier that is exhausted comes
 * back, so the card waits out of the queue and the review is never downgraded
 * and never self-reviewed. A tier that has been RETIRED never comes back, and
 * the two cases differ on WHO MAY ACT: a seat reading 「⛔ 不许降档」 onto a
 * vanished tier holds its whole lane forever, and a seat picking the
 * replacement itself is the silent downgrade this rule exists to stop. So a
 * retirement is a maintainer ruling and ⛔ never a seat's reading — and when
 * the ruling lands, this VALUE is the one line that moves. The ceiling of the
 * ladder `tierLines` prints is DERIVED from it ({@link TIER_CEILING}) so the
 * two cannot drift apart.
 *
 * A THIRD case is what this line was once actually moved on, and it is neither
 * of the two above. On 2026-09-21 two review dispatches died on their first
 * request with an HTTP 429 quota refusal at this tier; that reading — ONE
 * agent, temporarily, not authorized — was written in here as a retirement,
 * and the skills moved with it. It is not a retirement. Maintainer,
 * 2026-09-22, verbatim and untranslated (ruling record: issue comment
 * 5771798588): 「复核档应该就是 fable 啊」 ·
 * 「某个agent临时没有fable给的特殊授权，不应该改变skills」 ·
 * 「fable 撤回卡 你来创建」.
 *
 * As one rule, and this docblock is its home — the PM skill points every tier
 * value at this file, so there is nowhere else it could live: a tier word is
 * RETIRED only by the maintainer's explicit ruling that NAMES a retirement; a
 * 429, an exhausted quota or a missing authorization on one session is ⛔
 * never a retirement; and a seat this tier is not served to renders the review
 * through an isolated at-tier subagent or waits outside the queue — ⛔ never
 * by editing this line. What one session is authorized for is a property of
 * that session; this constant is a property of the lane's governance, and the
 * two ⛔ never trade places.
 *
 * Rulebook: `.claude/skills/pm-dispatch/references/contract-review.md` — the review of record and its `Served-tier:` line.
 */
export const CONTRACT_REVIEW_TIER = 'claude-fable-5-1';

/**
 * The constant's NAME — the one token a GitHub artefact (a claim's `model:`
 * value, a record's `Served-tier:` line) may carry for the ceiling, because
 * AGENTS.md lets no model identifier land in a comment. Declared beside the
 * constant it names so the two cannot drift apart: `record-recognisers.mjs`
 * re-exports it for the `Served-tier:` reading, and `readContainerModelLine`
 * below compares a claim's declared tier against it.
 */
export const CONTRACT_REVIEW_TIER_NAME = 'CONTRACT_REVIEW_TIER';

/**
 * The clause-① mandate rows are data: `MANDATORY_TIER_GLOB_ROWS` in `dispatch-gates.data.mjs` carries each
 * glob, the NAME of the tier it mandates, its reason and its one-line-exit switch — with the docblock that
 * governs the table. This binding resolves the tier name to the one value site above, and refuses a name
 * it does not know at load time, so a row cannot mandate a tier this engine does not serve.
 */
const TIER_BY_NAME = Object.freeze({ [CONTRACT_REVIEW_TIER_NAME]: CONTRACT_REVIEW_TIER });

export function bindMandatoryTierRows(rows, tiers = TIER_BY_NAME) {
  return rows.map((row) => {
    const tier = tiers[row.tier];
    if (typeof tier !== 'string') {
      throw new Error(
        `dispatch-gates: mandate row '${row.glob}' names the tier '${row.tier}', which this engine does not define — ` +
          `known: ${Object.keys(tiers).join(', ')}`,
      );
    }
    return { ...row, tier };
  });
}

export const MANDATORY_TIER_GLOBS = bindMandatoryTierRows(MANDATORY_TIER_GLOB_ROWS);

/**
 * The clause-② suspect rows are data: `SUSPECT_TIER_GLOB_ROWS` in `dispatch-gates.data.mjs` carries each
 * glob, its reason and the NAME of the exception predicate — with the docblock that governs the table.
 * This binding resolves the exception name to the repo's own predicate, imported above, never a
 * respelling here, and refuses a name it does not know at load time.
 */
const SUSPECT_EXCEPTIONS = Object.freeze({ 'test-path': isTestPath });

export function bindSuspectTierRows(rows, exceptions = SUSPECT_EXCEPTIONS) {
  return rows.map((row) => {
    if (row.except === undefined) return { ...row };
    const except = exceptions[row.except];
    if (typeof except !== 'function') {
      throw new Error(
        `dispatch-gates: suspect row '${row.glob}' names the exception '${row.except}', which this engine does not define — ` +
          `known: ${Object.keys(exceptions).join(', ')}`,
      );
    }
    return { ...row, except };
  });
}

export const SUSPECT_TIER_GLOBS = bindSuspectTierRows(SUSPECT_TIER_GLOB_ROWS);

// `TIER_FLOOR` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

// `TIER_DEFAULT` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

/**
 * The FAMILY word inside a model id — `claude-<family>-<version>` ⇒ `family`.
 *
 * The ladder the claim comment quotes is written in family words (`sonnet`,
 * `opus`), while {@link CONTRACT_REVIEW_TIER} is a full model id, so the
 * ceiling has to cross between the two vocabularies somewhere. It crosses
 * HERE, by derivation, because the alternative — writing the ceiling's word
 * down beside the constant — is the second value site the constant's own
 * docblock refuses, and it is exactly how the ladder came to read 「ceiling
 * fable」 for a tier the harness had stopped serving.
 *
 * An id this cannot read returns VERBATIM rather than throwing or guessing: a
 * ladder printing the whole model id is louder than one printing a family word
 * nobody ruled, and `--tier` runs on every dispatch, so a model id in an
 * unfamiliar shape must not take the tool down. Both directions are pinned.
 */
export function tierWordOf(modelId) {
  const m = /^claude-([a-z]+)-/.exec(String(modelId ?? ''));
  return m === null ? String(modelId ?? '') : m[1];
}

/**
 * The ladder's CEILING — the contract-review tier, in the ladder's vocabulary.
 *
 * ⛔ Not a constant of its own: derived from {@link CONTRACT_REVIEW_TIER} so a
 * retirement ruling moves ONE line and the ladder follows. The day the ceiling
 * and the default read the same word is not a bug — it is what a retired
 * ceiling falling to the default LOOKS like, and the ladder says so rather
 * than keeping a tier nobody can be dispatched at.
 */
export const TIER_CEILING = tierWordOf(CONTRACT_REVIEW_TIER);

// `RETIRED_TIER_WORDS` is data: it lives in `dispatch-gates.data.mjs` beside this file, imported and re-exported above.

/**
 * Place a card's file surface against the mandatory globs. Pure over its
 * inputs, so the self-test can drive every branch offline.
 *
 * Throws when two globs covering the same surface mandate DIFFERENT tiers:
 * this file encodes no ordering over tiers, so choosing between them would be a
 * guess printed as a derivation.
 *
 * A suspect glob's `except` is applied per PATH, before the suspicion is
 * recorded (SUSPECT_TIER_GLOBS says why test files are excepted): a mixed diff
 * keeps every non-excepted path's suspicion, and a mandate is never excepted.
 */
export function deriveTier(paths, globs = MANDATORY_TIER_GLOBS, suspectGlobs = SUSPECT_TIER_GLOBS) {
  const hits = [];
  const suspects = [];
  for (const p of paths) {
    for (const g of globs) {
      if (hintCovers(g.glob, p)) hits.push({ path: p, glob: g.glob, tier: g.tier, why: g.why, oneLineExit: g.oneLineExit !== false });
    }
    for (const g of suspectGlobs) {
      if (hintCovers(g.glob, p) && !(typeof g.except === 'function' && g.except(p))) {
        suspects.push({ path: p, glob: g.glob, why: g.why });
      }
    }
  }
  const tiers = [...new Set(hits.map((h) => h.tier))];
  if (tiers.length > 1) {
    throw new Error(
      `mandatory tier is ambiguous for this surface: ${tiers.join(' vs ')} — ` +
        'two globs cover it with different tiers and this script orders no tiers',
    );
  }
  return { mandatory: hits.length > 0, tier: tiers[0] ?? null, hits, suspects, declared: globs.length };
}

/**
 * Render the tier verdict. Throws on a result whose parts contradict each other
 * — a hit with no tier, or a tier with no hit to justify it — because the one
 * thing this section owes the reader is that a mandatory surface cannot print
 * as anything else.
 */
export function tierLines(result) {
  const { mandatory, tier, hits, declared, suspects = [] } = result;
  if (mandatory !== hits.length > 0 || mandatory !== Boolean(tier)) {
    throw new Error(
      `tier verdict is self-contradictory: mandatory=${mandatory}, tier=${tier ?? 'none'}, ` +
        `${hits.length} hit(s) — a mandatory surface must print its mandate`,
    );
  }
  const clause2 =
    '  Clause ② is NOT reachable from paths: a card that WIDENS a published accept set or the public surface owes a' +
    ' contract-review-tier REVIEW too (owed in the spec and skills lanes, in-seat at tier or by the at-tier subagent;' +
    ' default-tier build; a hit outside those lanes is spec-lane work and moves there); a card that only NARROWS one is' +
    ' `Clause-②: no`, stays in its lane, and owes one contract-review-tier review before the queue — judged from' +
    ' the card CONTENT. This line is a FLOOR, never a clearance.';
  // The suspicion tail prints only on a hit — unlike the clause-② note above,
  // which prints always: "no suspicion" and "no suspect table" must not share a
  // spelling, and the note is what keeps silence from reading as a clearance.
  const suspicion = suspects.length === 0
    ? []
    : [
        `  Clause ② SUSPECT surface — a hint, not a verdict: judge the tier from the card CONTENT as best you can` +
          ` (a card widening a published accept set or the public surface is reviewed at ${CONTRACT_REVIEW_TIER}` +
          ' in the spec lane — a contract-surface hit is spec-lane work whichever seat found it — built at the default tier;' +
          ' a card that only narrows one stays in its lane and owes the same review before the queue);' +
          ` whichever tier is dispatched, the PR's actual diff passes the clause-② enqueue gate before the card may enqueue.`,
        ...suspects.map((s) => `    - ${s.path} ⇢ '${s.glob}' — ${s.why}`),
      ];
  if (!mandatory) {
    return [
      `Model tier — no path-derived mandate: the surface hits none of the ${declared} declared glob(s), derived here, not recalled.`,
      `  The tier stays the PM's per-card judgment call (floor ${TIER_FLOOR} · default ${TIER_DEFAULT} · ceiling ${TIER_CEILING}).`,
      clause2,
      ...suspicion,
    ];
  }
  // The one-line-class exit is a card-CONTENT judgment for every mandated
  // surface but one: a glob declared with `oneLineExit: false` (the published
  // catalog, 2026-09-10 ruling) closes it by PATH, and one such hit closes it
  // for the WHOLE card — the exit is taken per card, not per file.
  const oneLineBarred = [...new Set(hits.filter((h) => h.oneLineExit === false).map((h) => h.glob))];
  const oneLineExit =
    oneLineBarred.length === 0
      ? 'a one-line-class mechanical governed edit drops to opus execution (sonnet floor for pure one-liners at PM' +
        ` discretion, compensated by the skill-face review at ${CONTRACT_REVIEW_TIER}) — judged from the card CONTENT,` +
        ' never from paths'
      : `the one-line-class mechanical-edit downgrade is ⛔ NOT available for this surface — ${oneLineBarred.map((g) => `'${g}'`).join(', ')}` +
        ' carries no one-line exemption (the published catalog, 2026-09-10 ruling), and one such path closes the exit for the whole card';
  return [
    `Model tier — MANDATORY: ${tier} (derived from the file surface, not recalled).`,
    ...hits.map((h) => `  - ${h.path} ⇢ '${h.glob}' — ${h.why}`),
    `  Exits, each recorded with its reason in the claim comment's \`Container & model\` line: ${oneLineExit};` +
      ` the measured quota exemption (the mandated tier EXHAUSTED ⇒ ${TIER_DEFAULT}, never lower — a tier that is` +
      " RETIRED is a maintainer ruling instead, ⛔ never a seat's reading); the proactive low-headroom downgrade.",
    clause2,
    ...suspicion,
  ];
}

/**
 * The dispatch-time reading of the human-merge line threshold (maintainer
 * ruling 2026-09-18; `HUMAN_MERGE_LINE_THRESHOLD`, declared once in
 * check-governed-merges.mjs), printed beside the tier verdict so a seat knows
 * BEFORE ACCEPT that the PR needs a human. Prints on EVERY run, like the tier
 * line: an absent line would mean both "under" and "this build has no size
 * derivation", and a claim comment is written from whatever the run said. An
 * explicit path list carries no diff, so it is NOT MEASURED — said out loud,
 * never a silent "under". Pure.
 */
export function changedLineLines(size) {
  const s = sizeVerdict(size);
  const t = s.threshold;
  if (!s.measured) {
    return [
      `Changed lines — NOT MEASURED: a path list carries no diff to count. The human-merge threshold (${t},` +
        ' additions + deletions, generated files INCLUDED) is read off the worktree by this tool run with no paths,' +
        ' and at landing by `node scripts/pm/check-governed-merges.mjs --pr <n>`.',
    ];
  }
  const reading = `Changed lines — ${s.changedLines} (+${s.additions} / -${s.deletions}; generated files INCLUDED) vs the human-merge threshold ${t}:`;
  if (!s.exceeds) {
    return [
      `${reading} under. Read off THIS worktree's diff against the merge base, not off the PR; the landing pre-check` +
        ' (`check-governed-merges.mjs --pr <n>`) reads the PR\'s own number.',
    ];
  }
  return [
    `${reading} ⛔ OVER — this PR lands as a Tier H surface does: an authorized APPROVED review (GOVERNED_APPROVERS, on ANY` +
      ' commit) and then the owning seat, or a HUMAN MERGE (maintainer rulings 2026-09-18 and 2026-09-27; no exemption for' +
      ' generated files, regen artefacts, docs builds or reverts). The governed terminal: no seat flips it ready, enqueues' +
      ' it, or arms auto-merge before that — ACCEPT on the card, `needs-user-decision` on the PR, the final 维护者速读,' +
      ' review requested from GOVERNED_APPROVERS. The landing pre-check `check-governed-merges.mjs --pr <n>` reads the' +
      ' PR\'s own number.',
  ];
}

// ---------------------------------------------------------------------------
// The claim's `Container & model:` line — read against the ladder this file
// derives, so the tier a seat DECLARES is compared to something
// ---------------------------------------------------------------------------

/**
 * The spellings a claim may use for the CEILING tier, derived — never listed:
 * the constant's NAME (what a GitHub artefact may carry), its VALUE (which a
 * claim must not carry, and which a reader must still recognise as the ceiling
 * rather than wave through as an unknown word), and the ladder's family word —
 * that last one only while the ceiling is a tier of its own: the day it retires
 * onto the default (see TIER_CEILING) the default's word names no ceiling.
 */
export function ceilingTierSpellings() {
  const words = [CONTRACT_REVIEW_TIER_NAME, CONTRACT_REVIEW_TIER];
  if (TIER_CEILING !== TIER_DEFAULT && TIER_CEILING !== TIER_FLOOR) words.push(TIER_CEILING);
  return words;
}

/**
 * The `Container & model:` key line of a claim, at the START of a line — the
 * decoration the record readers tolerate (a leading blockquote, a bullet, bold
 * or backticks round the key) tolerated here for the same reason.
 */
export const CONTAINER_MODEL_KEY_LINE = /^[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?(?:\*\*)?`?Container & model`?(?:\*\*)?[ \t]*:(.*)$/m;

/**
 * What a claim's `Container & model:` line declares about the tier, and what
 * it cites for it.
 *
 * ## Why this reader exists (the measured incident)
 *
 * The claim template asks for `model: <tier, quoting this run's --tier
 * output>`, and until this reader nothing compared the line to anything. A
 * sister-repo seat — for whom `--tier` refused to answer at all — hand-wrote
 * the ceiling tier into every claim of a whole shift after a quota wall, and
 * every dev and every reviewer on that lane ran at the scarcest tier on cards
 * with no mandatory-clause hit. The seat's own error is its own; this reader
 * is why nothing caught it.
 *
 * ## What is read, and what is deliberately not
 *
 * The declared tier is the FIRST token after `model:` (decoration stripped),
 * exactly as `Served-tier:` is read: prose in front is the value and compares
 * unequal, and the ladder line a seat pastes further along (`floor … · default
 * … · ceiling …`) names every tier without declaring any. A ceiling token owes
 * a citation ON THE SAME LINE: the word `MANDATORY` — which `--tier` prints,
 * and prints only for a mandated surface — or a `reason:` naming the per-card
 * ruling. The default and floor tiers owe nothing here: their exits are
 * recorded on the line by the skill's rule, and a reader that demanded them
 * would refuse every ordinary claim over a formatting preference.
 *
 * ⛔ Absence is nobody's refusal: a claim that carries no `Container & model:`
 * line, or one whose `model:` slot reads no token, declares no ceiling — the
 * older claims never carried the line, and this reader judges a ceiling, not
 * an omission.
 *
 * @returns {{ present: false } | { present: true, line: string, tier: string|null, ceiling: boolean,
 *            mandateCited: boolean, reasonCited: boolean }}
 */
export function readContainerModelLine(body) {
  const m = CONTAINER_MODEL_KEY_LINE.exec(String(body ?? ''));
  if (!m) return { present: false };
  const value = String(m[1] ?? '');
  const model = /\bmodel[ \t]*:[ \t]*(?:\*\*|`|[ \t])*([A-Za-z0-9][A-Za-z0-9_.-]*)?/i.exec(value);
  const tier = model?.[1] ?? null;
  const ceiling = tier !== null && ceilingTierSpellings().some((word) => word.toLowerCase() === tier.toLowerCase());
  return {
    present: true,
    line: m[0].trim(),
    tier,
    ceiling,
    mandateCited: /\bMANDATORY\b/.test(value),
    reasonCited: /\breason[ \t]*:/i.test(value),
  };
}

/**
 * The refusal a ceiling-tier claim earns when it derives its tier from nothing
 * — `null` when the line reads, or when there is no ceiling to judge. The row
 * shape is `post-stamped.mjs`'s keyed-line row (`key`, `why`), so that tool
 * files it beside the `Seat:`, `Thread-read:` and `Clause-②:` refusals it
 * already imports; the `why` names the ceiling by the constant's NAME and
 * quotes no model identifier back.
 */
export function containerModelRefusal(body) {
  const read = readContainerModelLine(body);
  if (!read.present || !read.ceiling || read.mandateCited || read.reasonCited) return null;
  return {
    key: 'Container & model',
    line: read.line,
    why:
      `the \`model:\` value names the ceiling tier (${CONTRACT_REVIEW_TIER_NAME}) and the line cites neither the MANDATORY hit` +
      ' `--tier` printed for the card\'s paths nor a `reason:` naming the per-card ruling — a ceiling nobody derived is the' +
      ' hand-written default that ran a whole shift at the scarcest tier.',
  };
}

// ---------------------------------------------------------------------------
// A GOVERNED sister repo's tier verdict — from the path globs alone
// ---------------------------------------------------------------------------

/**
 * The governed register's entry for a sister slug — `null` for this repo's
 * own slug, an unknown slug, or a value that is no slug at all. Read from the
 * register `check-governed-merges.mjs` declares, never from a list here.
 */
export function governedSisterRepo(slug, { repos = GOVERNED_REPOS, selfId = SELF_REPO_ID } = {}) {
  const wanted = String(slug ?? '').trim().toLowerCase();
  return repos.find((r) => r.id !== selfId && String(r.slug).toLowerCase() === wanted) ?? null;
}

/**
 * `--tier --repo <sister> <path> ...` — the tier verdict for a governed sister
 * repo, from MANDATORY_TIER_GLOBS and SUSPECT_TIER_GLOBS ALONE.
 *
 * ## Why the tier half needs no tree
 *
 * The cross-repo guard refuses a sister slug because the GATE FAMILIES are a
 * property of the repo's own workflows and check scripts, which this checkout
 * does not hold. The tier verdict is not: `deriveTier` is a pure predicate over
 * the paths and the two glob tables, reads no workflow and no check script, and
 * the refusal it inherited was the gate half's. Measured cost of inheriting it:
 * every sister-repo claim hand-wrote its `model:` line, and one shift wrote the
 * ceiling into all of them (see `readContainerModelLine`). So this mode answers
 * the tier question for a slug the governed register knows, and says on stderr
 * exactly what it derived from and what it did not read.
 *
 * ⛔ Explicit paths only. No diff of another repo is readable from here, so a
 * sister run with no paths refuses rather than deriving THIS tree's change set
 * and printing it under that repo's name. ⛔ The gate half is untouched: every
 * other mode keeps the wrong-repo refusal, which now points at this one.
 *
 * @returns `null` when `asserted` is not a governed sister slug — this repo, an
 *          unknown repo, a malformed value — so the ordinary assertion path
 *          answers those exactly as before; otherwise `{ ok, stderr, stdout }`.
 */
export function sisterRepoTierRun({ asserted, paths = [], identity = null, repos = GOVERNED_REPOS, selfId = SELF_REPO_ID }) {
  const sister = governedSisterRepo(asserted, { repos, selfId });
  if (sister === null) return null;
  const at = identity?.head ? ` at commit ${identity.head}` : '';
  const stderr = [
    `dispatch-gates: tier verdict for '${sister.slug}' derived from the path globs ALONE — MANDATORY_TIER_GLOBS and` +
      ` SUSPECT_TIER_GLOBS as this checkout${at} declares them, over the ${paths.length} path(s) named on argv.`,
    `  That repo's tree was NOT read: the tier question is a path predicate and needs none. The gate FAMILIES are a property` +
      ` of '${sister.slug}' and still derive only from a checkout OF it (its own package manifest and workflow files).`,
  ];
  if (paths.length === 0) {
    stderr.push(
      `dispatch-gates: REFUSING — a sister-repo tier verdict takes explicit paths: no diff of '${sister.slug}' is readable` +
        " from this checkout, so there is nothing to derive them from. Name the card's file surface.",
    );
    return { ok: false, sister, stderr, stdout: [] };
  }
  return {
    ok: true,
    sister,
    stderr,
    stdout: [
      ...tierLines(deriveTier(paths)),
      `Changed lines — NOT MEASURED: no diff of '${sister.slug}' is readable from this checkout. The human-merge threshold` +
        ` (${HUMAN_MERGE_LINE_THRESHOLD}, additions + deletions, generated files INCLUDED) is read off that repo's PR at landing.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Live derivation
// ---------------------------------------------------------------------------

/**
 * Discover every check family in the tree: the workflows that invoke it, the
 * `paths:` triggers that schedule it, the script files it resolves to, and the
 * watch hints those files declare — plus the hints declared by the first-party
 * modules those files IMPORT, one level down (`firstPartyImportTargets`), so a
 * population declared in a shared module still reaches the gates that read it.
 *
 * Lifted out of `derive` so the escapable-literal ledger can ask the SAME
 * question the derivation asks, from the same implementation. The ledger's
 * whole claim is about what the derivation can and cannot name, so a second
 * discovery pass built beside this one would let the two disagree — and a
 * ledger enumerating a population no dispatch prompt is actually derived from
 * is the drift this file's header refuses everywhere else. The self-test is
 * the only other caller, and it calls THIS.
 */
/**
 * ── ONE discovery pass per tree, per process (#18201) ──────────────────────
 *
 * PROFILED, not guessed, on the same principle as the source maskers far
 * above and with the same promise: ⛔ this changes nothing about WHAT is
 * discovered — it is the same derivation run once instead of N times, which
 * is the only kind of speed-up this tool may take.
 *
 * The reading that motivated it belongs to a named commit rather than to this
 * comment, so it lives on the card: a V8 CPU profile of one plain derivation
 * found this function running TWICE over the identical tree — once from
 * `derive`, once from `gateFamilyFiles` under `changeKindGates` — and the
 * self-test driving it a further twenty-odd times in one process, every pass
 * re-reading every workflow and re-masking every gate source for bytes that
 * cannot have changed in between.
 *
 * Keyed on the TREE OBJECT, which is what makes the memo observationally
 * identical rather than merely cheaper: the answer is a pure function of the
 * tree it is handed plus the checkout on disk, a caller that means a
 * different tree hands a different object and gets its own pass, and nothing
 * in this process writes to the checkout (see `repoCorpus`). A `null` tree —
 * the deliberate no-tree probe — is not an object and is never memoised.
 *
 * ⛔ The entries this hands back are SHARED. A caller that mutates one for an
 * ablation must restore it before it returns, exactly as the one self-test
 * case that does so already restores `entry.reads`.
 */
const discoveryMemo = new WeakMap();

/**
 * How many discovery passes this process has really computed — the reading a
 * case needs to tell "memoised" from "cheap enough that nobody noticed", and
 * the only way to pin a collapse whose whole symptom is the absence of work.
 */
let discoveryPasses = 0;
export function discoveryPassCount() {
  return discoveryPasses;
}

export function discoverFamilies({ tree = repoCorpus().tree } = {}) {
  if (tree !== null && typeof tree === 'object') {
    const hit = discoveryMemo.get(tree);
    if (hit !== undefined) return hit;
    const value = discoverFamiliesPass(tree);
    discoveryMemo.set(tree, value);
    return value;
  }
  return discoverFamiliesPass(tree);
}

function discoverFamiliesPass(tree) {
  discoveryPasses += 1;
  const wfDir = nodePath.join(ROOT, '.github/workflows');
  const workflows = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
  if (workflows.length === 0) throw new Error('no workflow files found under .github/workflows');
  const rootScripts = JSON.parse(readFileSync(nodePath.join(ROOT, 'package.json'), 'utf8')).scripts ?? {};

  const invocations = [];
  // The `paths:` each workflow declares, read from the SAME text the check
  // invocations come out of — one read, two answers, no chance of the pair
  // describing different revisions of a file.
  const triggerPathsByWorkflow = new Map();
  // The SECOND path declaration CI obeys (#12956) — a job `if:` that reads a
  // `dorny/paths-filter` output. Read from the same text as the two above, for
  // the reason stated there: one read, three answers, no chance of them
  // describing different revisions of a file.
  const jobPopulationsByCheck = new Map();
  // The always-runs tail (#13333) reads the SAME text as the three answers
  // above, for the same reason they read it together: a tail derived from a
  // second read could describe a different revision of a workflow than the
  // families it is printed beside, and the whole point of the tail is that it
  // states what the family list does not cover.
  const workflowEntries = [];
  // The composite actions the workflows reach, read ONCE for the whole pass and
  // keyed by the action file, so a helper two workflows `uses:` is opened once
  // and cannot arrive as two revisions of itself (#19229).
  const readAction = compositeActionReader();
  const compositeActionFiles = new Set();
  const unresolvedCompositeUses = [];
  for (const wf of workflows) {
    const text = readFileSync(nodePath.join(wfDir, wf), 'utf8');
    // The steps this workflow executes THROUGH a composite action. They are
    // derived under the caller's name because the caller is what CI schedules;
    // the action file rides along as `viaAction` provenance. See
    // `followCompositeActions` for the boundaries and the direction each fails
    // in.
    const followed = followCompositeActions(text, readAction);
    for (const dir of followed.unresolved) {
      unresolvedCompositeUses.push(`.github/workflows/${wf} uses ./${dir}, which holds no action.yml`);
    }
    workflowEntries.push({ file: wf, text, composites: followed.steps });
    invocations.push(...extractCheckInvocations(text, wf));
    for (const step of followed.steps) {
      compositeActionFiles.add(step.action);
      invocations.push(...extractCheckInvocations(step.text, wf, { via: step.action }));
    }
    triggerPathsByWorkflow.set(wf, extractTriggerPaths(text));
    for (const pop of jobPathPopulations(text, wf)) {
      for (const check of pop.checks) {
        if (!jobPopulationsByCheck.has(check)) jobPopulationsByCheck.set(check, []);
        jobPopulationsByCheck.get(check).push({
          workflow: wf, job: pop.job, name: pop.name,
          outputs: pop.outputs, paths: pop.paths, dropped: pop.dropped,
        });
      }
    }
  }
  if (invocations.length === 0) throw new Error('no check:* invocations found in any workflow');
  // A `uses: ./…` with no action file behind it is a job GitHub refuses to
  // start, so a derivation that quietly dropped it would be describing a CI
  // this repo does not have. Loud, naming every one (#4690).
  if (unresolvedCompositeUses.length > 0) {
    throw new Error(
      `composite action(s) named by a workflow but absent from the tree:\n  ${unresolvedCompositeUses.join('\n  ')}`,
    );
  }

  // Dedupe by (check, workflow); resolve each to script files + watch hints.
  const byCheck = new Map();
  for (const inv of invocations) {
    const key = inv.check;
    if (!byCheck.has(key)) byCheck.set(key, { ...inv, workflows: new Set(), files: [], hints: [] });
    const merged = byCheck.get(key);
    merged.workflows.add(inv.workflow);
    // The composite action file this invocation was read out of, when it was
    // not written inline (#19229). A SET because one family may be reached both
    // ways, and the union is the honest answer to "where is this command
    // written".
    if (inv.viaAction) (merged.viaActions ??= new Set()).add(inv.viaAction);
    // INTERSECTION, not union (#15761). `argvVariables` needs no merge — argv
    // is part of the KEY, so every invocation under one key spells the same
    // one. `env:` is NOT part of the key, so two workflows can run the same
    // command in different environments, and the classification this feeds
    // SUBTRACTS a row from `--commands`: keeping only the names EVERY step
    // passes means a command one workflow runs bare keeps its place in the
    // list. A wrong subtraction is silent; a miss is loud (#14004's trade,
    // same direction). Costs nothing measurable today — 14 of the 260 keys on
    // this tree carry more than one invocation and NONE of them disagree about
    // its env, so union and intersection classify identically here.
    merged.envVariables = (merged.envVariables ?? []).filter((name) => (inv.envVariables ?? []).includes(name));
  }
  for (const entry of byCheck.values()) {
    // Only the workflows that DECLARE a filter become trigger keys. An
    // unfiltered workflow runs on every PR, so it discriminates nothing.
    entry.triggers = [...entry.workflows]
      .map((wf) => ({ workflow: wf, paths: triggerPathsByWorkflow.get(wf) ?? [] }))
      .filter((t) => t.paths.length > 0);
    // Only the jobs whose `if:` RESOLVED become job-filter keys, for the same
    // reason: a job CI schedules unconditionally discriminates nothing.
    entry.jobFilters = jobPopulationsByCheck.get(entry.check) ?? [];
  }
  for (const entry of byCheck.values()) {
    // A direct entry carries its script path in `script` rather than reusing
    // `check`, because a self-test key carries the flag too (`… --self-test`)
    // and a flag is not a path: `existsSync` would refuse it, and the family
    // would resolve to no files and therefore to no hints — a family that
    // exists and can never match anything, which reads exactly like a gate
    // with an unspellable population.
    let files = entry.direct ? [entry.script] : resolveCheckToFiles(entry.check, rootScripts);
    // The manifest BODY beside the files resolved out of it, from this one read
    // (#16030). A pnpm-spelled row prints a NAME, and whether running that name
    // grades the diff or only the checker's own fixtures is a fact about the
    // body the name expands to. Captured here, where the manifest is already
    // open, for the reason `ciOnlyMeasurement` states about `rootScripts`: no
    // reader downstream can then answer from a different revision of the file.
    if (!entry.direct) entry.manifestCommand = rootScripts[entry.check] ?? null;
    if (entry.filter) {
      // package-scoped check: resolve through that package's manifest when findable
      const pkgDirGuess = entry.filter.replace(/^@objectstack\//, '');
      for (const base of ['packages', 'packages/plugins', 'packages/drivers', 'packages/services']) {
        const p = nodePath.join(ROOT, base, pkgDirGuess, 'package.json');
        if (existsSync(p)) {
          const pkgScripts = JSON.parse(readFileSync(p, 'utf8')).scripts ?? {};
          // The package manifest is the one that DEFINES a `--filter`-spelled
          // row, so its body is the body that runs -- it wins over a root
          // script that happens to carry the same name (#16030).
          if (typeof pkgScripts[entry.check] === 'string') entry.manifestCommand = pkgScripts[entry.check];
          // The manifest's own directory goes IN, and tracked paths come back
          // out — a package script may climb out of its package
          // (`tsx ../../scripts/x.mts`), and prefixing the result here instead
          // was measured to misattribute exactly that spelling to the package
          // (#12107; resolveCheckToFiles' docblock carries the measurement).
          files = files.concat(
            resolveCheckToFiles(entry.check, pkgScripts, { dir: nodePath.join(base, pkgDirGuess) }),
          );
        }
      }
    }
    entry.files = files;
  }
  // Which files ARE gates, settled before a single import is followed: the
  // follow refuses to open one (firstPartyImportTargets' docblock carries the
  // measurement that decided it). That set is not knowable while the first
  // loop is still building it, which is the only reason there are two.
  const gateFiles = new Set([...byCheck.values()].flatMap((e) => e.files));
  // The same tracked listing the reachability sweep walks, as a membership test
  // for `readProgramTargetsInSource`: a resolved path the repo does not track is
  // a sandbox destination or a build artifact, never an input a card can edit.
  const trackedSet = tree?.files ?? new Set(trackedFiles());
  // The directory half of the same listing, for the manifest edge below. Taken
  // from the tree when there is one and derived from `trackedSet` when there is
  // not, so the edge answers identically either way.
  const manifestPrefixes = tree?.prefixes ?? trackedPrefixes([...trackedSet]);
  // A followed module is scanned once however many families import it —
  // invoked-as.mjs is imported by 79 of them.
  const moduleSources = new Map();
  const sourceOfModule = (rel) => {
    if (!moduleSources.has(rel)) moduleSources.set(rel, readFileSync(nodePath.join(ROOT, rel), 'utf8'));
    return moduleSources.get(rel);
  };
  const moduleHints = new Map();
  const hintsOfModule = (rel) => {
    if (!moduleHints.has(rel)) {
      // ONE read, THREE answers — the module's literals, its own declaration of
      // which of them a caller INHERITS, and (through `sourceOfModule`, which
      // holds the same bytes) what each of its exported names is declared as —
      // so no two of them can describe different revisions of a file, the same
      // discipline the trigger paths take above. A module that declares nothing
      // contributes everything it spells, which is the behaviour every followed
      // module had before the marker existed.
      const source = sourceOfModule(rel);
      const spelled = extractWatchHints(source, rel, { tree });
      const declared = declaredInheritedPopulation(source, spelled, rel);
      moduleHints.set(rel, declared ? declared.population : spelled);
    }
    return moduleHints.get(rel);
  };
  // A manifest is read once however many families follow it — every gate in
  // #13518's class follows the same one.
  const manifestHints = new Map();
  const hintsOfManifest = (rel) => {
    if (!manifestHints.has(rel)) {
      // The followed file's OWN declaration decides what a caller inherits,
      // exactly as `declaredInheritedPopulation` does for a module — here the
      // declaration is the `exports` map, and a manifest without one (the repo
      // ROOT manifest, and every package that publishes no entry points)
      // declares no export surface and so contributes nothing.
      let population = [];
      const dir = rel.slice(0, Math.max(0, rel.length - 'package.json'.length - 1));
      try {
        const manifest = JSON.parse(readFileSync(nodePath.join(ROOT, rel), 'utf8'));
        const exportsMap = manifest?.exports;
        if (dir && exportsMap && typeof exportsMap === 'object' && Object.keys(exportsMap).length > 0) {
          const src = `${dir}/src`;
          // A tracked prefix that is not itself a tracked file IS a directory —
          // read off the two sets the sweep already builds, the same test
          // `moduleRelativeDirectoryHint` makes, so this cannot disagree with
          // what the reachability half of the tool believes the tree holds.
          //
          // Read from `trackedSet` and NOT from the optional `tree`, so a
          // caller passing no tree gets the same answer. This edge lives in
          // discovery rather than in `extractWatchHints`, so the purity
          // argument that makes the tree a parameter THERE does not reach it —
          // and coupling it to the parameter would make a `tree: null`
          // discovery a second, quieter derivation. The live cost of getting
          // this wrong is measured next door: the `moduleRelativeDirectoryHint`
          // blast-radius pin reads exactly the with-tree/without-tree
          // difference, and a tree-coupled edge here would show up inside it as
          // six families that rule never touched.
          if (manifestPrefixes.has(src) && !trackedSet.has(src)) population = [src];
        }
      } catch {
        // A manifest this scan cannot parse contributes nothing. A missing
        // lead, never a fabricated one.
        population = [];
      }
      manifestHints.set(rel, population);
    }
    return manifestHints.get(rel);
  };
  for (const entry of byCheck.values()) {
    entry.imports = [];
    // The subset of `entry.imports` that CONTRIBUTES a population (#17991).
    // The edge list stays whole — the gate really does import every module in
    // it — and what an importer inherits is decided separately, per caller, by
    // what the caller BINDS. Unioned across the family's files: one file taking
    // a constant out of a module another file reads the table of is a family
    // that reads the table.
    entry.populationImports = new Set();
    entry.runs = [];
    entry.manifests = [];
    entry.reads = [];
    entry.readOrigin = new Map();
    // WHICH spelling carried a read, the counterpart of `hintEdge` next door
    // (#18673): a program text this scan resolved by itself is a different
    // claim from a file the script DECLARES its self-test opens, and the line a
    // dev reads has to name the one they can go check.
    entry.readEdge = new Map();
    entry.hintOrigin = new Map();
    entry.hintEdge = new Map();
    for (const f of entry.files) {
      const abs = nodePath.join(ROOT, f);
      if (!existsSync(abs)) continue;
      // ONE read, FOUR answers now — the hints, the gate's own no-population
      // declaration, the first-party modules it imports, and the program files
      // it opens by path — so no two of them can describe different revisions
      // of a file, the same discipline the trigger paths take above.
      const source = readFileSync(abs, 'utf8');
      entry.hints.push(...extractWatchHints(source, f, { tree }));
      // ONE read, four answers now (#13000). ⛔ NOT gated on `entry.selfTest`,
      // and that is the measurement rather than an oversight: the import follow
      // is refused for a self-test because a module's population describes the
      // gate's WORK, which a `--self-test` invocation does not perform. A file
      // the self-test OPENS is the opposite case — the self-test is the run, and
      // that read is the run's own input. The live specimen is this card's:
      // `scripts/objectui-changeset-digest.mjs` stages its copy inside
      // `--self-test`, and skipping self-tests here would close nothing.
      for (const target of readProgramTargetsInSource(f, source, (t) => trackedSet.has(t))) {
        if (entry.reads.includes(target)) continue;
        entry.reads.push(target);
        entry.readOrigin.set(target, f);
        entry.readEdge.set(target, 'program-text');
      }
      // ONE read, and the ELEVENTH answer off it (#18673): the files this
      // script DECLARES its self-test opens. The boundary one loop up keeps
      // PROGRAM TEXT only — correctly, since a data file a gate found by
      // walking a tree is a fixture and not a population — and a structural
      // self-test case asserting something about a real tracked file falls on
      // the wrong side of it. The declaration is what puts it back, and it is
      // graded against `anchoredReadTargets` of this SAME source text, so it can
      // only re-admit a read this file really performs.
      const declaredReads = declaredSelfTestReads(
        source,
        anchoredReadTargets(f, source, (t) => trackedSet.has(t)),
        f,
      );
      if (declaredReads) {
        for (const target of declaredReads.population) {
          if (entry.reads.includes(target)) continue;
          entry.reads.push(target);
          entry.readOrigin.set(target, f);
          entry.readEdge.set(target, 'declared-self-test');
        }
      }
      // ONE read, and now TWO answers per channel (#18422): the reason, and the
      // comment line that CONTINUES it where the capture stopped. They come off
      // the same text, and off the same FILE, for the reason the walk does — a
      // refusal that graded one file's reason against another file's
      // continuation would be judging two declarations as one.
      readPopulationDeclaration(entry, source, f, 'no-path-population');
      // ONE read, and the SEVENTH and EIGHTH answers off it (#14189). The
      // declaration and the walk that vouches for it are read from the same
      // source text as the six above, so the liveness check can never grade a
      // different revision of the gate than the declaration it is grading.
      readPopulationDeclaration(entry, source, f, 'whole-tree-population');
      entry.rootWalk ??= repoRootWalkSpelling(source);
      // ONE read, and the TENTH answer off it (#15341). Same source text as
      // every reader above, for the same reason: `widePopulationRefusal` grades
      // this declaration against `entry.hints`, and hints and marker have to
      // come out of one revision of the gate or the refusal is judging two.
      readPopulationDeclaration(entry, source, f, 'wide-population');
      // ONE read, SIX answers now (#14004). The payload dependence is read off
      // the SAME source text as the five above, so this classification cannot
      // describe a different revision of the gate than the hints printed beside
      // it — the discipline every other reader in this loop follows.
      entry.payloadEnv ??= payloadEnvDependence(source);
      // ONE read, and the NINTH answer off it (#15441): the argv defaults this
      // script DECLARES in its own usage block. Read from the SAME source text
      // as the eight above, and taken from the gate's OWN file only — a
      // followed module cannot declare on its caller's behalf what the caller
      // does with an argument it was not given, exactly like the declarations
      // around it.
      if (entry.direct && f === entry.script) entry.argvDefaults = declaredArgvDefaults(source);
      // ONE read, and one more answer off it (#20278): the step-`env:` values
      // this script DECLARES its bare invocation does not need. Collected from
      // EVERY family that reads the file — the bare run, the census, the
      // self-test alias — so each of them grades the declaration below against
      // the one bare entry, and a declaration whose bare run is gone is refused
      // even while another invocation of the script is still wired. It is SPENT
      // on the bare key alone (`localEnvAdmitted`).
      const localEnv = declaredLocalEnv(source, f);
      if (localEnv) (entry.localEnvDeclarations ??= []).push({ file: f, ...localEnv });
      // A `--self-test` family follows NO import, and that is a measurement
      // rather than a preference (#11404). The invocation runs the script's
      // SELF-TEST; a module the script imports carries the population of the
      // script's WORK, which this invocation does not perform — so an inherited
      // hint here describes a read that cannot happen.
      //
      // The live specimen is the reason the narrowing shipped with the matcher
      // rather than after it. `scripts/pm/bare-root-worklist.mjs` statically
      // imports `./dispatch-gates.mjs`, whose module-body literals are join
      // bases (`packages/plugins`, `packages/drivers`, `packages/services`) and
      // a tier glob (`packages/spec/src/**`) — not a population anything reads.
      // Inheriting them handed that one gate 2553 (gate, file) pairs, 96% of
      // this change's entire price, every one of them a lead the gate would
      // never justify. That exact fabrication is already a decided verdict:
      // `check-dispatch-gates.mjs` exists as a separate file, spawning the tool
      // instead of importing it, for no other reason (#8162, and its header
      // measures the same literals reaching the same trees). It arrives here by
      // a new route, and it is refused the same way.
      //
      // Cost of the refusal on this tree: zero. Of the nine self-test families,
      // only bare-root-worklist inherits anything at all — the other eight
      // import `invoked-as.mjs` (no literals) or a module that is itself a gate
      // file and already excluded. A future self-test that really does read a
      // population declared elsewhere can spell it here, which is the direction
      // this file errs in everywhere: a missing lead, never a fabricated one.
      if (entry.selfTest) continue;
      //
      // What the follow INHERITS is decided one line down, and separately
      // (#17991): the edge is a fact about this file, the population is a fact
      // about the BINDING. `declaredInheritedPopulation` is keyed per module and
      // so cannot express it — the same module's globs ARE a real population for
      // an importer that reads them, and a declaration narrow enough for the
      // constant-importer would blind that reader.
      for (const [mod, binding] of firstPartyImportBindings(f, source)) {
        if (gateFiles.has(mod)) continue;
        if (!entry.imports.includes(mod)) entry.imports.push(mod);
        if (importBindsNoPopulation(binding, sourceOfModule(mod), hintsOfModule(mod))) continue;
        entry.populationImports.add(mod);
      }
      // The SECOND POPULATION FOLLOW, under the same two refusals as the first
      // and for the same reasons (#13511). ⚠️ "Second" counts FOLLOWS, not
      // edges: the read scan a few lines up is an edge too, and it is the
      // second of those in source order, but it inherits no population and so
      // is not one of these (#14289 — `packageManifestTargets`' docblock holds
      // both numberings side by side). It sits BELOW the self-test
      // guard deliberately: the narrowing above is invocation-shaped — an
      // inherited population describes the gate's WORK — and that argument does
      // not change with the edge it arrives over. One rule, not two. Cost of
      // placing it here, measured on this tree: zero, because no `--self-test`
      // family reaches an in-tree program by spawn at all.
      for (const ran of spawnedProgramTargets(f, source, (t) => trackedSet.has(t))) {
        if (gateFiles.has(ran) || entry.runs.includes(ran)) continue;
        entry.runs.push(ran);
      }
      // The THIRD AND LAST POPULATION FOLLOW, under the same self-test guard
      // and for the same invocation-shaped reason the spawn follow states
      // (#13518). Its own docblock calls it the FOURTH EDGE, numbering all four
      // scans in source order; here the count is of follows, and there are
      // three (#14289). The
      // gate-file refusal the other two make does not apply and is not spelled:
      // a `package.json` is never a discovered gate file, so there is nothing
      // to refuse.
      for (const pkg of packageManifestTargets(f, source, (t) => trackedSet.has(t))) {
        if (entry.manifests.includes(pkg)) continue;
        entry.manifests.push(pkg);
      }
    }
    // The gate's OWN hints keep their order and their place at the FRONT, so
    // every path this derivation already matched keeps the exact key and via
    // label it had: the widening adds leads, it never re-attributes one
    // (measured at 0 re-attributions over the live tree).
    const own = new Set(entry.hints);
    for (const mod of entry.imports) {
      // A value-only importer inherits nothing (#17991) — see
      // `importBindsNoPopulation`. The edge stays in `entry.imports`, because it
      // is real; what it does not do is contribute a lead.
      if (!entry.populationImports.has(mod)) continue;
      for (const hint of hintsOfModule(mod)) {
        if (own.has(hint) || entry.hintOrigin.has(hint)) continue;
        entry.hintOrigin.set(hint, mod);
        entry.hintEdge.set(hint, 'import');
        entry.hints.push(hint);
      }
    }
    // LAST, so every key an earlier edge already answered keeps the exact hint
    // and via label it had — the widening adds leads, it never re-attributes
    // one, and that is asserted in the self-test rather than argued here.
    for (const ran of entry.runs) {
      for (const hint of hintsOfModule(ran)) {
        if (own.has(hint) || entry.hintOrigin.has(hint)) continue;
        entry.hintOrigin.set(hint, ran);
        entry.hintEdge.set(hint, 'run');
        entry.hints.push(hint);
      }
    }
    // LAST of the three follows, on the same rule and for the same reason: a
    // key an earlier edge already answered keeps the exact hint and via label
    // it had, so this widening adds leads and never re-attributes one.
    for (const pkg of entry.manifests) {
      for (const hint of hintsOfManifest(pkg)) {
        if (own.has(hint) || entry.hintOrigin.has(hint)) continue;
        entry.hintOrigin.set(hint, pkg);
        entry.hintEdge.set(hint, 'manifest');
        entry.hints.push(hint);
      }
    }
    // The marker stays a claim about THIS gate, read from its own files only.
    // A shared helper cannot declare on a caller's behalf that the caller has
    // no path population — and cannot withdraw it either: a gate that keeps
    // the marker while inheriting a population is a contradiction the live
    // half of the self-test catches, which is the direction that costs.
    entry.noPopulationReason ??= null;
    entry.noPopulationReasonCut ??= null;
    // Read from the gate's own files only, for the same reason as the
    // declaration above it: a followed module cannot declare on its caller's
    // behalf that the CALLER sweeps the whole tree, and it cannot withdraw the
    // claim either. The liveness half is anchored the same way — the walk that
    // vouches for the declaration has to be in the source that carries it.
    entry.wholeTreeReason ??= null;
    entry.wholeTreeReasonCut ??= null;
    entry.rootWalk ??= null;
    // Read from the gate's own files only, for the reason the two declarations
    // above it are: a followed module cannot declare on its caller's behalf
    // that the CALLER's population is too wide to place — and a caller that
    // inherited the marker would be excused from the matched column by a
    // sentence written about a different gate.
    entry.widePopulationReason ??= null;
    entry.widePopulationReasonCut ??= null;
    // Read from the gate's own files only, exactly like the declaration above
    // it: a followed module cannot make its caller CI-only, and a family that
    // reached no file at all reaches no classification either.
    entry.payloadEnv ??= null;
    entry.ciOnly = ciOnlyMeasurement(entry, rootScripts);
    // The SECOND not-runnable-here classification (#15083), and it is read off
    // the INVOCATION rather than off the gate's source — which is the whole
    // difference between the two. `ciOnly` is a fact about what the gate reads;
    // this is a fact about what the workflow passes it. A family whose argv
    // takes a value from the workflow has no local run at all, so it is named,
    // its workflow is named, and it is kept out of `--commands` — the same
    // treatment, reached by a different measurement.
    // The repair of that second classification (#15441). It asked whether the
    // WORKFLOW supplies the value and never whether the SCRIPT needs it
    // supplied, so a gate whose own usage block documents a default for the
    // flag CI pins was filed unrunnable and its `--self-test` was the only
    // member `--commands` offered for it — a zero from a command that cannot
    // answer the question, sitting in the union where nothing distinguishes it
    // from a green. `declaredArgvDefaults` reads the script's declaration; this
    // is where it is spent, and it is spent ALL-OR-NOTHING: an invocation is
    // repaired only when every variable in it is covered by a declared default,
    // because a command that runs with one real value and one invented one
    // answers a question CI never asked.
    entry.argvDefaulted = [];
    entry.localCheck = null;
    if ((entry.argvVariables ?? []).length > 0 && entry.argvDefaults?.size && entry.script) {
      const substituted = defaultedArgv(entry.check.slice(entry.script.length + 1), entry.argvDefaults);
      const remaining = entry.argvVariables.filter(
        (variable) => !substituted.defaulted.some((d) => d.variable === variable),
      );
      if (substituted.defaulted.length > 0 && remaining.length === 0) {
        entry.argvDefaulted = substituted.defaulted;
        entry.argvVariables = remaining;
        // ⛔ The KEY is untouched — `check` stays the invocation as CI spells
        // it, so nothing is re-attributed and a script CI runs under two
        // different variables keeps its two entries. This is the LOCAL
        // spelling, read by `runnableInvocation` and by nothing else.
        entry.localCheck = `${entry.script} ${substituted.args}`;
      }
    }
    // Both CARRIERS of one fact — a value that comes from the workflow and has
    // none here (#15761). They are unioned into ONE classification rather than
    // given a bucket each, because a reader asking "can I run this" is asking
    // one question: the rendering, the `--json` key and the subtraction from
    // `--commands` are all the argv one, unchanged. The env names are spelled
    // `env NAME` so the two carriers stay legible in a single list — an argv
    // variable always carries its `$`.
    // GRADED before it is spent (#20278): a declaration naming a value the step
    // does not pass, or scoped to a bare run no workflow makes, throws here, and
    // the CLI answers `derivation failed` — a stale declaration reds every run
    // rather than quietly listing a command. See `localEnvRefusal`.
    for (const declaration of entry.localEnvDeclarations ?? []) {
      const refusal = localEnvRefusal(declaration, byCheck.get(declaration.file) ?? null, declaration.file);
      if (refusal) throw new Error(`dispatch-gates: ${refusal}`);
    }
    entry.localEnv = entry.direct && entry.script
      ? (entry.localEnvDeclarations ?? []).find((d) => d.file === entry.script) ?? null
      : null;
    entry.envValues = workflowEnvValues(entry);
    const workflowValues = [
      ...(entry.argvVariables ?? []),
      ...entry.envValues.map((name) => `env ${name}`),
    ];
    entry.notRunnable = workflowValues.length > 0
      ? { variables: workflowValues, envVariables: [...entry.envValues] }
      : null;
  }
  // `compositeActions` is the reading that makes this pass's new tree a
  // MEASUREMENT rather than a capability nobody can size (#19229): the action
  // files really opened on this run, sorted. A zero here on a tree that holds
  // composite actions is a follow that stopped following.
  return { byCheck, workflows, workflowEntries, compositeActions: [...compositeActionFiles].sort() };
}

/**
 * The runnable command list — the whole point of the machine-readable modes.
 *
 * Matched families UNION the convention-triggered ones, because both are gates
 * this card owes and a consumer asking "what do I run" is asking one question,
 * not two. This is where `--commands` is strictly better than the published
 * awk snippet rather than merely equal to it: the snippet reads the matched
 * block alone and silently drops the convention block underneath it.
 *
 * Deduplicated, because a family can be both matched by path and named by a
 * kind, and a list that says the same command twice teaches its reader to skim.
 * Sorted, so two runs on one tree are byte-identical and a diff of two harvests
 * means something.
 *
 * A convention gate whose name no workflow runs any more contributes NOTHING
 * here — `command` is null and it is filtered out. That row is a defect in this
 * script's own table, it is reported as a STALE warning in the human rendering
 * and as a null in `--json`, and emitting a fabricated command for it would be
 * exactly the failure this whole file exists to refuse.
 */
/**
 * The commands a CI-measured family renders — read off the matched rows, which
 * are where the classification lives, and shared by every consumer that has to
 * subtract them. One expression, so `--commands` and the reconciliation cannot
 * disagree about which commands are omitted.
 */
export function ciOnlyCommandSet(matchedRows = [], alwaysRunsRows = []) {
  // Both row sets, because the subtraction follows the COMMAND and not the
  // section it was reached through — the rule `commandsFor` already states for
  // the convention block, applied unchanged to the whole-tree channel (#14189).
  // Empty on this tree today (no declaring family reads the payload) and kept
  // for the same reason that exclusion is kept there: a rule that held in one
  // section and not another is the two-renderings drift this file keeps closing.
  return new Set([...matchedRows, ...alwaysRunsRows].filter((row) => row.ciOnly).map((row) => row.command));
}

/**
 * The commands a VALUE-BEARING family renders — the second not-runnable-here
 * set, built the same way and from the same rows as `ciOnlyCommandSet` above,
 * and kept separate from it because the two are different facts a reader is
 * owed separately: one family cannot be run here because it needs the workflow
 * EVENT PAYLOAD, the other because it needs a workflow VALUE. Folding them
 * would print one count for two omissions and tell nobody which.
 */
export function notRunnableCommandSet(matchedRows = [], alwaysRunsRows = []) {
  return new Set([...matchedRows, ...alwaysRunsRows].filter((row) => row.notRunnable).map((row) => row.command));
}

export function commandsFor({ matchedRows = [], kindGroups = [], alwaysRunsRows = [] } = {}) {
  const commands = new Set();
  // A CI-MEASURED-ONLY family contributes NOTHING here (#14004). This list's
  // caption promises one RUNNABLE command per line, and a command whose only
  // possible local outcome is a nonzero exit is not one. It is the single
  // subtraction this list makes, it is measured rather than listed
  // (`ciOnlyMeasurement`), and it is loud in both other renderings: the family
  // keeps its own heading with its provenance in the human output, and carries
  // `ciOnly` on its row in `--json`. ⛔ Not silence — omission stated where the
  // omission happens is this file's own rule for the pending-changeset
  // families, and it applies here unchanged.
  const ciOnly = ciOnlyCommandSet(matchedRows, alwaysRunsRows);
  // The SECOND subtraction, and it is made for the identical reason (#15083):
  // this list's caption promises one RUNNABLE command per line, and an
  // invocation whose values come from the workflow has no value outside a CI
  // run. Rendering it here with `$RUNNER_TEMP` unset would produce a command
  // that RUNS and answers a question CI never asked — the one outcome worse
  // than the bare key it replaces. Loud in both other renderings: its own
  // heading in the human output, `notRunnable` on its row in `--json`.
  // ⚠️ `$MERGE_BASE` used to be this comment's example and is no longer a
  // member: since #15441 a variable the script itself declares a default for is
  // filled in and the family renders a real runnable command, so what is
  // subtracted here is only what nothing can supply a value for.
  const notRunnable = notRunnableCommandSet(matchedRows, alwaysRunsRows);
  for (const row of matchedRows) if (!row.ciOnly && !row.notRunnable) commands.add(row.command);
  // The whole-tree channel is IN the union, on every card (#14189). It is not
  // a lead — nothing about `matched` moves — but it is a gate the card owes,
  // and this list's whole contract is that it is the complete runnable answer
  // for the paths it was given. A declaring family left out of it would be the
  // very omission the card was filed about, reproduced inside its own fix.
  for (const row of alwaysRunsRows) if (!row.ciOnly && !row.notRunnable) commands.add(row.command);
  for (const group of kindGroups) {
    // The exclusion follows the COMMAND, not the section it was reached
    // through: a family named by change KIND as well as by path is one family,
    // and it is no more runnable from the second section than from the first.
    // Reachable only in a corner today — no CI-measured family is in
    // CHANGE_KIND_GATES — but a rule that held in one section and not the
    // other is exactly the two-renderings drift this file keeps closing.
    for (const gate of group.gates) {
      if (gate.command && !ciOnly.has(gate.command) && !notRunnable.has(gate.command)) commands.add(gate.command);
    }
  }
  return [...commands].sort();
}

/**
 * The count reconciliation — ONE number a consumer can assert a harvest
 * against, and the arithmetic that ties it back to the sections above it
 * (#13642).
 *
 * ## The defect this answers, and why it is not a reading problem
 *
 * The human rendering places this card's runnable answer in TWO differently
 * shaped sections: the matched block (path-derived, `  - ` rows carrying a
 * `matched via` column) and the convention block (kind-derived, `    - ` rows
 * under a per-kind heading). Twice in one night, on two cards, two independent
 * devs harvested one section, ran it green, and reddened CI on a family the
 * other section had named — `check:system-context-census` once,
 * `check:engine-double-contract` once. Both classified it as their own error.
 * A third reader, the dispatching PM, misread the same output a third way and
 * nearly filed a derivation bug that would have been false.
 *
 * ⛔ The remedy is NOT another output mode. `--commands` and `--json` already
 * exist and already carry the union; #13462 put "never harvest this prose" in
 * this file's own header, with its 8-of-12 measurement, and the prose was
 * harvested twice more afterwards. What was missing is the half that makes a
 * partial harvest DETECTABLE: nothing in the human rendering stated the total.
 * The nearest thing to it was the spelling footer's `N families`, which counts
 * the matched block alone — so a consumer who dropped the convention block
 * reconciled successfully against a subtotal. See spellingFooterLines for that
 * measurement and for why its heading now names its scope.
 *
 * ## Why the parts are computed from the SAME sets `commandsFor` unions
 *
 * A count computed independently of the sections it claims to reconcile can
 * drift from them, and an instrument that cannot fail toward its own target is
 * the recurring defect this repo keeps finding one level up — a reconciliation
 * line that says 44 while the sections hold 45 is worse than no line, because
 * it is assertable and wrong. So the two parts below are built with the SAME
 * two expressions `commandsFor` unions, not with a second traversal of
 * `matched`/`CHANGE_KIND_GATES`: add a family to either input and both the
 * section and its term here move together, because they are readings of one
 * structure. The identity `matched + convention − both === total` then holds by
 * set algebra rather than by care, and it is ASSERTED anyway — a mismatch means
 * the union and its parts came from different places, which is a broken
 * instrument, and #4690's rule is that a broken instrument refuses rather than
 * prints a number that looks like an answer.
 *
 * ## What the total deliberately does NOT cover
 *
 * Every block printed BELOW this line is outside it, each with its own count
 * under its own heading. That disclosure is made for the same reason
 * `machineReadableOutput` makes its own on stderr: a new number that reads as
 * "the complete account of what CI runs" would reproduce this card's own defect
 * one layer up.
 *
 * ⛔ This comment deliberately does NOT list those blocks. It used to, and the
 * rendering listed them too — one claim, written out twice — and the two copies
 * drifted: both named three of the five blocks the same run printed, omitting
 * the artifact rosters and the declared WIDE population. A harvester who
 * followed the enumeration and stopped never reached either, and CI caught the
 * difference on a family printed in the WIDE block (#16398). The list now
 * exists ONCE, as the exported `outsideBlockNames`, built from the block counts
 * its callers hand it so a block that printed cannot be missing from it and a
 * block that did not print cannot be named. All THREE output lanes read it —
 * this one, `--ran` and the `--commands`/`--json` stderr accounting, which used
 * to carry short prose copies of their own (#16795). Amend it there; there is
 * no second copy here to keep in step.
 *
 * `staleRows` and the row/family gap are surfaced rather than smoothed. A
 * consumer counting PRINTED rows in the convention block and comparing them
 * with `convention` here would otherwise find a discrepancy with no
 * explanation — a STALE row prints and contributes no command, and one family
 * hit by two kinds prints twice. Both are stated in the rendering.
 */
export function familyReconciliation({
  matchedRows = [], kindGroups = [], alwaysRunsRows = [], rosterRows = [], widePopulationRows = [], pendingRows = [],
  jobFilteredRows = [],
} = {}) {
  const commands = commandsFor({ matchedRows, kindGroups, alwaysRunsRows });
  // The SAME expression commandsFor uses for its matched half. Written as a
  // second traversal it would be a second answer to a question this file
  // already answers once.
  const runnableRows = matchedRows.filter((row) => !row.ciOnly && !row.notRunnable);
  const ciOnlyRows = matchedRows.filter((row) => row.ciOnly);
  const notRunnableRows = matchedRows.filter((row) => row.notRunnable);
  const matchedCommands = new Set(runnableRows.map((row) => row.command));
  // Counted, never folded into the total: the total is the RUNNABLE answer and
  // a CI-measured family is outside it by construction. Kept as its own term so
  // the omission is a number the reader gets rather than a difference they have
  // to notice (#14004).
  const ciOnlyCommands = ciOnlyCommandSet(matchedRows, alwaysRunsRows);
  // Counted and kept OUT of the total on the same rule as the term above: the
  // total is the RUNNABLE answer, and an invocation whose values come from the
  // workflow is outside it by construction (#15083).
  const notRunnableCommands = notRunnableCommandSet(matchedRows, alwaysRunsRows);
  // The SAME expression `commandsFor` unions for the whole-tree channel, for
  // the reason this function's header gives for the other two terms: a count
  // built by a second traversal can drift from the section it claims to
  // reconcile, and this one is asserted against the union below.
  const alwaysRunsCommands = new Set(
    alwaysRunsRows.filter((row) => !row.ciOnly && !row.notRunnable).map((row) => row.command),
  );
  const conventionCommands = new Set();
  let conventionRows = 0;
  let staleRows = 0;
  let ciOnlyConventionRows = 0;
  let notRunnableConventionRows = 0;
  for (const group of kindGroups) {
    for (const gate of group.gates) {
      conventionRows += 1;
      if (!gate.command) {
        staleRows += 1;
        continue;
      }
      // The SAME subtraction `commandsFor` makes, from the same set — a term
      // counted here but absent from the union would break the arithmetic
      // below, which is the drift that check exists to catch. Counted on its
      // own so the rows-versus-commands note names this reason rather than
      // charging it to the two it already knows about.
      if (ciOnlyCommands.has(gate.command)) ciOnlyConventionRows += 1;
      else if (notRunnableCommands.has(gate.command)) notRunnableConventionRows += 1;
      else conventionCommands.add(gate.command);
    }
  }
  const both = [...conventionCommands].filter((command) => matchedCommands.has(command)).length;
  // The set-algebra term: |M u C u A| = |M| + |C| - |M n C| + |A \ (M u C)|.
  // Counted as the REMAINDER rather than as the whole of A, so a declaring
  // family that some card also reaches by path or by kind is counted once,
  // exactly like `both` one term over.
  const alwaysRunsOnly = [...alwaysRunsCommands].filter(
    (command) => !matchedCommands.has(command) && !conventionCommands.has(command),
  ).length;
  const recon = {
    total: commands.length,
    alwaysRuns: alwaysRunsCommands.size,
    alwaysRunsOnly,
    alwaysRunsRows: alwaysRunsRows.length,
    matched: matchedCommands.size,
    matchedRows: runnableRows.length,
    ciOnly: ciOnlyCommands.size,
    ciOnlyRows: ciOnlyRows.length,
    notRunnable: notRunnableCommands.size,
    notRunnableRows: notRunnableRows.length,
    convention: conventionCommands.size,
    conventionRows,
    conventionOnly: conventionCommands.size - both,
    both,
    staleRows,
    ciOnlyConventionRows,
    notRunnableConventionRows,
    // Three counts that are NOT terms of the total and never enter the closure
    // assertion below — they are the SIZES of three blocks printed under this
    // line, carried here for the same reason `ciOnly` and `notRunnable` are:
    // the rendering has to name what sits outside the answer, and a count it
    // reads from the arrays that RENDER those blocks cannot disagree with them
    // (#16398). They are handed to `outsideBlockNames`, which is the only place
    // the list of outside blocks exists.
    artifactRosters: rosterRows.length,
    widePopulation: widePopulationRows.length,
    // The THIRD block size (#16795). Its name was the one the enumeration still
    // spelled UNCONDITIONALLY, while `pendingChangesetLines` returns nothing at
    // zero — so on a card with no pending family the sentence pointed a reader
    // below at a heading that is not there. That is this same defect facing the
    // other way, and it is fixed the same way: by counting the array that
    // renders the block rather than by writing the name out.
    pendingChangeset: pendingRows.length,
    // The FOURTH block size (#16285), carried on exactly the same terms as the
    // three above: not a term of the total, never in the closure assertion, and
    // read off the array `jobFilteredStepLines` renders so the enumeration
    // cannot name a heading the output does not print.
    jobFilteredJobs: jobFilteredRows.length,
  };
  if (recon.matched + recon.convention - recon.both + recon.alwaysRunsOnly !== recon.total) {
    throw new Error(
      'dispatch-gates: the family reconciliation does not close — ' +
        `${recon.matched} matched + ${recon.convention} convention − ${recon.both} both + ${recon.alwaysRunsOnly} declared ` +
        `whole-tree (reached no other way) ≠ ${recon.total} distinct. ` +
        'The parts and the union came from different structures, which is the drift this line exists to detect. ' +
        'Refusing rather than printing a total that cannot be trusted (#4690).',
    );
  }
  return recon;
}

/**
 * ⭐ The blocks that sit OUTSIDE a card's runnable total, enumerated ONCE for
 * ALL THREE output lanes.
 *
 * This is one claim, and it has been spelled four different ways. The human
 * rendering and a comment beside it each wrote it out in prose; the two copies
 * drifted, and both named three of the five blocks the same run printed — the
 * artifact rosters and the declared WIDE population, the two nothing else tells
 * a seat to run. A harvester who followed the enumeration and stopped reached
 * neither, and CI reddened on a family printed in the WIDE block (#16398). That
 * card built the list once, for the human lane. The other two lanes kept their
 * own short prose copies: `--ran` named three of five, and the
 * `--commands`/`--json` stderr accounting named exactly ONE — on the very
 * channel this file's own header tells consumers to use INSTEAD of harvesting
 * the prose, which makes a whole block missing from it the same failure on the
 * lane that was supposed to be the safe one (#16795).
 *
 * ⛔ So a lane never spells its own copy. It calls this with the counts it
 * holds, and a block it does not know about is absent by construction rather
 * than by care. Four copies of one sentence is how the sentence went wrong;
 * this is the one copy.
 *
 * ⭐ Built from the block COUNTS, never written out: each count is the length
 * of the very array `artifactRosterLines`, `widePopulationLines` or
 * `pendingChangesetLines` renders, so the enumeration cannot name a set the
 * output does not contain. A count of 0 drops the name, because at zero rows
 * all three of those return nothing — pointing a reader "below" at a heading
 * that is not there is this same defect facing the other way, and the
 * pending-changeset name carried exactly that bug for as long as it was
 * spelled unconditionally. The last two names have no count and no condition
 * because their renderings have none: `unreachableLines` and `alwaysRunLines`
 * print on EVERY run, at zero as at fifty.
 *
 * Named in the order a plain run PRINTS them, so a reader walking down the
 * output meets the blocks in the order this list promised them.
 */
export function outsideBlockNames({
  artifactRosters = 0, widePopulation = 0, pendingChangeset = 0, jobFilteredJobs = 0,
} = {}) {
  return [
    ...(artifactRosters > 0 ? [`the ${artifactRosters} artifact-roster famil(ies)`] : []),
    ...(widePopulation > 0 ? [`the ${widePopulation} declared WIDE-population famil(ies)`] : []),
    ...(pendingChangeset > 0 ? [`the ${pendingChangeset} pending-changeset famil(ies)`] : []),
    'the unreachable listing',
    // The FOURTH conditional name (#16285), and the only one that is not last
    // among the conditionals: the list is spelled in the order a plain run
    // PRINTS the blocks, and this block prints between the unreachable listing
    // and the always-runs tail, beside the partition half it belongs to. It
    // arrives HERE and nowhere else for the reason this function exists at all:
    // the same enumeration is rendered by three lanes, and a block a lane
    // spells for itself is a block another lane forgets. Counted off the array
    // that renders it, like the three above, so the name cannot outlive the
    // heading.
    ...(jobFilteredJobs > 0 ? [`the ${jobFilteredJobs} path-scheduled CI job(s)`] : []),
    // UNCONDITIONAL, like the unreachable listing and the tail below it: its
    // block prints on every run, at zero rows as loudly as at four (#19172). ⛔
    // So no count — a name sized off a row array goes missing on the empty walk.
    'the type-check lanes',
    'the always-runs tail',
  ];
}

/**
 * The same enumeration as one English phrase — the only place the join is
 * spelled, for the reason the list itself has only one place.
 *
 * Every name opens with a lowercase article, so a sentence-initial use raises
 * the leading letter at the point of use rather than keeping a second,
 * capitalised copy of the list — which is the duplication this pair exists to
 * remove.
 */
export function outsideBlocksPhrase(counts) {
  const names = outsideBlockNames(counts);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The three block sizes a `recon` from `familyReconciliation` carries, read
 * back off it in the shape `outsideBlockNames` takes.
 *
 * A named reader rather than an object literal at each call site: the human
 * lane and `--ran` both hand the same three counts across, and two literals
 * spelling the same three key names is the smallest possible version of the
 * duplication this whole construction removes.
 */
export function outsideBlockCounts(recon) {
  return {
    artifactRosters: recon?.artifactRosters ?? 0,
    widePopulation: recon?.widePopulation ?? 0,
    pendingChangeset: recon?.pendingChangeset ?? 0,
    jobFilteredJobs: recon?.jobFilteredJobs ?? 0,
  };
}

/**
 * The reconciliation, rendered. Printed on EVERY completed derivation, hit or
 * not — including at zero.
 *
 * That is deliberate and it is the OPPOSITE of the neighbouring rule for
 * `spellingFooterLines`, which returns nothing on an empty block. The two
 * answer different questions and the divergence is the point rather than an
 * oversight. That footer warns about a shortfall INSIDE a block, so with no
 * block there is nothing to warn about and a zero heading would only invite a
 * hunt for rows that do not exist. This line is a NUMBER A CONSUMER ASSERTS
 * AGAINST, and an absent number is not assertable: printing it only on a hit
 * would make its absence mean two things at once — "this card owes no gates"
 * and "this build has no reconciliation" — which is exactly the argument
 * `derive` already makes for printing the tier verdict on every run.
 */
export function familyReconciliationLines(recon) {
  // The CI-measured term, rendered identically on the zero and non-zero
  // branches (#14004). An answer of zero RUNNABLE families on a card that
  // matched a CI-measured one is exactly the reading that must not come out as
  // a bare "nothing matched": the family matched, it is named above, and what
  // is zero is what the dev can run.
  const ciOnlyLine =
    recon.ciOnly > 0
      ? `  + ${recon.ciOnly} famil(ies) this card's paths reach are CI-MEASURED ONLY and sit OUTSIDE this total —` +
        ' they read the workflow event payload, so no local run of them can produce a verdict. Named under their own' +
        ' heading above, carried on their row in --json, and omitted from --commands by design.'
      : null;
  // The second omission term, rendered on both branches for the reason the
  // first one is (#15083): a card whose only matched family is value-bearing
  // must not read as "nothing matched" — the family matched, it is named
  // above, and what is zero is what the dev can run.
  const notRunnableLine =
    (recon.notRunnable ?? 0) > 0
      ? `  + ${recon.notRunnable} famil(ies) this card's paths reach take a VALUE FROM THE WORKFLOW and sit OUTSIDE this total —` +
        " their argv, or their step's `env:`, carries a variable that has no value outside a CI run, so there is no local invocation to hand you." +
        ' Named under their own heading above with the variable in the value position, carried on their row in --json,' +
        ' and omitted from --commands by design.'
      : null;
  // ⭐ The enumeration of what sits OUTSIDE this total, READ from the one place
  // it exists (`outsideBlockNames`) and rendered by BOTH branches below. It is
  // one claim, and a copy of it per lane is exactly how it went wrong — see
  // that function for the two measured drifts and for why every name is
  // conditional on the count of the array that renders its block.
  const outsideBlocks = outsideBlocksPhrase(outsideBlockCounts(recon));
  // Both uses below are sentence-initial and every name opens with a lowercase
  // article, so the leading letter is raised here rather than by keeping a
  // second, capitalised copy of the list — which is the duplication this whole
  // construction exists to remove.
  const outsideBlocksCapitalised = `${outsideBlocks.charAt(0).toUpperCase()}${outsideBlocks.slice(1)}`;
  if (recon.total === 0) {
    return [
      'Reconciliation — 0 famil(ies): this card\'s whole runnable answer, and the derivation COMPLETED to reach it.',
      '  0 named by PATH (the matched block) + 0 named by change KIND (the convention block). An empty answer, not a missing one.',
      ...(ciOnlyLine ? [ciOnlyLine] : []),
      ...(notRunnableLine ? [notRunnableLine] : []),
      `  ⇒ --commands prints nothing for these paths and exits 0. ${outsideBlocksCapitalised} below still apply and are NOT covered by this number.`,
    ];
  }
  const lines = [
    `Reconciliation — ${recon.total} famil(ies): this card's WHOLE runnable answer, and the number to assert a harvest against.`,
    `  ${recon.matched} named by PATH (the matched block) + ${recon.convention} named by change KIND (the convention block)` +
      `${recon.alwaysRunsOnly ? ` + ${recon.alwaysRunsOnly} DECLARED whole-tree (the always-runs block)` : ''}` +
      `${recon.both ? `, ${recon.both} of them the same family reached both ways` : ''} ⇒ ${recon.total} distinct.`,
  ];
  if (recon.conventionOnly > 0) {
    lines.push(
      `  ⛔ A harvest that ends at ONE section is SHORT and reports nothing missing: the matched block alone is` +
        ` ${recon.matched} of the ${recon.total}, the convention block alone is ${recon.convention} of the ${recon.total}.` +
        ' Two cards lost the convention block exactly this way, hours apart, and CI found it both times.',
    );
  }
  if (ciOnlyLine) lines.push(ciOnlyLine);
  if (notRunnableLine) lines.push(notRunnableLine);
  if (recon.alwaysRuns > 0) {
    lines.push(
      `  + ${recon.alwaysRuns} of the ${recon.total} DECLARE that their population is the WHOLE TREE` +
        `${recon.alwaysRunsOnly !== recon.alwaysRuns ? `, ${recon.alwaysRuns - recon.alwaysRunsOnly} of them also reached by path or kind` : ''}` +
        ' — placed by their own declaration, never by your paths, and named under their own heading above. They are INSIDE this total' +
        ' (a gate every card implicates is a gate this card owes) and outside the matched column (a row on every card is not a lead).',
    );
  }
  lines.push(
    `  ⇒ Skip the arithmetic: --commands prints exactly these ${recon.total}, one runnable command per line, nothing else on stdout.` +
      ' It cannot drop a section or a spelling; this line exists so a harvest of the PROSE can be caught when it does.',
  );
  if (recon.matchedRows !== recon.matched) {
    lines.push(
      `  (the matched block prints ${recon.matchedRows} rows for those ${recon.matched} — the surplus rows render the same runnable command.)`,
    );
  }
  if (recon.conventionRows !== recon.convention) {
    const notes = [];
    if (recon.staleRows > 0) notes.push(`${recon.staleRows} STALE, contributing no command`);
    // Named before the repeat term, which is computed as a remainder: an
    // unnamed reason would be charged to "a repeat" and read as a fact about
    // the kinds table rather than about a family nobody can run here (#14004).
    const ciOnlyConventionRows = recon.ciOnlyConventionRows ?? 0;
    if (ciOnlyConventionRows > 0) notes.push(`${ciOnlyConventionRows} CI-measured only, contributing no runnable command`);
    // Named for the same reason the term above it is: an unnamed reason is
    // charged to "a repeat" and read as a fact about the kinds table rather
    // than about a family nobody can run here (#15083).
    const notRunnableConventionRows = recon.notRunnableConventionRows ?? 0;
    if (notRunnableConventionRows > 0) {
      notes.push(`${notRunnableConventionRows} value-bearing argv or env, contributing no runnable command`);
    }
    const accounted = recon.staleRows + ciOnlyConventionRows + notRunnableConventionRows;
    if (recon.conventionRows - accounted > recon.convention) {
      notes.push(`${recon.conventionRows - accounted - recon.convention} a repeat of a family another kind already hit`);
    }
    lines.push(
      `  (the convention block prints ${recon.conventionRows} rows for those ${recon.convention}: ${notes.join('; ')}.)`,
    );
  }
  lines.push(
    `  ⛔ ${recon.total} is what THIS CARD owes by path and kind — NOT a complete account of what CI runs on the PR.` +
      ` ${outsideBlocksCapitalised} below are each OUTSIDE it, each with its own count.`,
  );
  return lines;
}

// ── The RUN reconciliation: harvested ⟶ EXECUTED (#13774) ────────────────────

/**
 * The marker a run record puts in front of a family the runner is claiming it
 * could not measure, and the separator between that claim and its reason.
 *
 * Both are compared BYTE-EXACTLY and case-sensitively, and neither carries a
 * slash, so this file's own watch-hint extraction cannot read them as paths.
 */
export const RUN_RECORD_UNMEASURED_MARKER = 'NOT-MEASURED';
export const RUN_RECORD_REASON_SEPARATOR = ' :: ';

/**
 * The word that opens the OPTIONAL annotation a ran line may carry after the
 * separator: `<command> :: exit <code>`.
 *
 * ## Why this is additive, and what "additive" had to mean here (#17204)
 *
 * The record format is a contract other seats write BY HAND — nothing in this
 * repo writes a ran-file — so a change that invalidated existing records would
 * not be a fix. Measured before it was written, and the three properties are
 * the whole argument for this spelling:
 *
 *   • A record line that reconciles TODAY cannot be re-read tomorrow. This
 *     annotation is recognised only as the TAIL of a line, after ` :: `, and no
 *     command this tool derives contains that separator — so the only lines
 *     whose reading changes are lines that already matched nothing.
 *   • A record WITHOUT the annotation classifies byte-identically to before:
 *     every bare line is a ran claim, exactly as it was.
 *   • A record WITH it, handed to a tool that predates it, fails LOUD rather
 *     than green — the whole line misses the derivation and the family reports
 *     UNRUN, exit 1. The one direction a format change must never take is a
 *     silent pass, and this one cannot take it.
 *
 * ## Why the tail and not a `NOT-MEASURED`-style prefix
 *
 * The prefix marker is a CLASS the runner declares; this is a DATUM their shell
 * captured (`status=$?`). Keeping it at the tail keeps the capture idiom a
 * one-line `printf` over `"$cmd"` — the command still leads the line, byte for
 * byte, which is the property every comparison in this file rests on.
 *
 * The payload is matched exactly: `exit ` followed by digits, nothing else. A
 * lenient reader (`EXIT 3`, `exit=3`, `3`) would be a second dialect of a field
 * whose entire purpose is to be unambiguous, so a tail that opens with the
 * separator and is not this shape is reported as MALFORMED and the line keeps
 * its old reading — the direction that costs a rerun, never a false green.
 */
export const RUN_RECORD_EXIT_PREFIX = 'exit ';

/**
 * The recorded exit codes that are a KILL rather than a VERDICT — the numbers a
 * gate never chose, because something outside it ended the process first.
 *
 * ## Why the distinction has to be drawn here and cannot be left to the runner
 *
 * Every other code in a record is a gate's own answer: `0` passed, `1` failed,
 * `EXIT_PREREQUISITE_NOT_MET` refused with its own stated prerequisite. These
 * are not answers at all. The process was terminated with no verdict produced,
 * so counting the family as `run` asserts a measurement that does not exist —
 * the false green this whole reconciliation is built to refuse. Measured on a
 * real card: a gate cap-killed at the container's foreground ceiling recorded
 * `exit 124`, reconciled inside the `run` total, and the round would have read
 * its own ledger as complete had the runner not said so in prose.
 *
 * ## Why each member is in the set
 *
 *   TIMEOUT (124)   coreutils `timeout` exits with this when the deadline fires
 *                   and it had to signal the child. It is the number the
 *                   WRAPPER chose to report a kill, not the child's answer, and
 *                   it is the shape a foreground-cap kill wears in this repo's
 *                   own gate runs. ⛔ It is below the signal floor, so a floor
 *                   test alone does not catch it — this is the member the set
 *                   exists for.
 *   SIGNAL_FLOOR    a shell reports a signalled child as `128 + signum`, and
 *   (128)           node's `spawnSync` reports the same shape for its `signal`
 *                   field, so ANY code at or above the floor names a signal and
 *                   therefore a process that was ended rather than finished.
 *                   The named ones a gate run meets here are SIGINT (130),
 *                   SIGKILL (137, the OOM killer's), SIGPIPE (141, a `| head`
 *                   closing the read end) and SIGTERM (143, the container's
 *                   foreground cap) — each labelled below so the row names what
 *                   killed it, not just a number.
 *
 * ## Why over-inclusion is the safe direction
 *
 * A gate that deliberately exits ≥ 128 with a meaning of its own would be read
 * here as killed, and its family would cost a rerun or a stated reason. That is
 * the direction this module always takes: a rerun is cheap and a false green is
 * the defect. ⛔ The reverse rule — enumerate only the four signals seen so far
 * — buys nothing and silently re-admits every signal nobody has met yet.
 */
export const RUN_RECORD_KILL_EXITS = Object.freeze({
  TIMEOUT: 124,
  SIGNAL_FLOOR: 128,
  SIGNAL_NAMES: Object.freeze({ 130: 'SIGINT', 137: 'SIGKILL', 141: 'SIGPIPE', 143: 'SIGTERM' }),
});

/**
 * What killed a run, in words — or `null` when the code is a verdict.
 *
 * The one place a number is compared against `RUN_RECORD_KILL_EXITS`, so no
 * reconciliation branch and no rendering line carries a bare code of its own.
 */
export function runRecordKillLabel(code) {
  if (typeof code !== 'number' || !Number.isInteger(code)) return null;
  if (code === RUN_RECORD_KILL_EXITS.TIMEOUT) return 'a `timeout` wrapper fired and signalled the child';
  if (code < RUN_RECORD_KILL_EXITS.SIGNAL_FLOOR) return null;
  const named = RUN_RECORD_KILL_EXITS.SIGNAL_NAMES[code];
  return named
    ? `killed by ${named}`
    : `killed by signal ${code - RUN_RECORD_KILL_EXITS.SIGNAL_FLOOR}`;
}

/**
 * The `source` a NOT-MEASURED row carries when the runner recorded a KILL code
 * AND declared the family with a stated reason.
 *
 * It is its own value because the three channels answer different questions and
 * a reader has to be able to tell them apart: `exit-code` is this tool deriving
 * the class from a number that cannot mean anything else; `claim` is the
 * runner's word with no code behind it; this one is BOTH — the most honest
 * record available, and the one the reconciliation used to discard (#18074).
 */
export const RUN_RECORD_NOT_MEASURED_KILL_SOURCE = 'kill-claim';

/**
 * A run record, parsed. One entry per line that claims something.
 *
 * ## The format is the tool's, and it is the exact strings `--commands` emits
 *
 * That sentence is the whole design, and it is what makes the comparison below
 * an EXACT set difference rather than a normalisation problem. The triage
 * ruling that selected this producer-side shape attached a condition to it:
 * if the run record's names cannot be reliably normalised tool-side — "各 dev
 * 的日志名形状不受控" — report back rather than shipping a fuzzy matcher. The
 * answer here is not a better normaliser. It is that there is NOTHING to
 * normalise: the record's lines are the tool's own output lines, copied by the
 * runner as it goes, so both sides of the comparison were produced by one
 * expression in this file and are identical in shape by construction.
 *
 * The measured alternative is the reason. A dev built the first hand-made
 * reconciliation by slugging LOG FILE NAMES back into family names, and the
 * bash that wrote those names used `tr -c` on `echo` output, so every log name
 * carried a trailing underscore the dev's Python slug did not reproduce. Its
 * prefix matcher paired names that did not correspond and reported a confident
 * `unreconciled 0` over a set on which the raw `comm` reported 36. ⭐ A fuzzy
 * reconciliation reproduces exactly the failure a reconciliation exists to
 * catch, one level up. So no matcher in this file is allowed to be clever:
 * every comparison below is `Set.has` on the untouched string.
 *
 * ## What is decoded, and why that is not normalisation
 *
 * A line is split on `\n` and one trailing `\r` is removed, because a CRLF file
 * ends its lines with two bytes and the second is a line TERMINATOR, not
 * content. Nothing else is touched: leading and trailing spaces INSIDE a line
 * are content, and stripping them would be a normalisation applied to one side
 * of the comparison only — which is the fuzzy shape wearing a smaller hat. A
 * line whose content is only whitespace carries no command (no command is
 * whitespace) and is skipped with the blank lines; a line opening with `#`
 * is a comment for the same reason, since no runnable invocation starts there.
 *
 * ## The NOT-MEASURED claim, and why it costs a reason
 *
 * A family a gate REFUSES to judge — it states its own unmet prerequisite — is
 * genuinely not the same as one that never ran, and a record has to be able to
 * say so. But the category is also where a family you simply did not FINISH
 * running goes to hide: measured on a real card, a gate cap-killed at the
 * container's foreground ceiling (exit 143) was written off as NOT MEASURED,
 * and on re-running to completion it was green. So the claim parses only with
 * a stated reason after `RUN_RECORD_REASON_SEPARATOR`; a marked line without
 * one leaves its family UNRUN, which is the direction that costs a rerun
 * instead of a false green.
 */
export function parseRunRecord(text) {
  const entries = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
    const line = i + 1;
    if (raw.trim() === '' || raw.startsWith('#')) continue;
    if (raw.startsWith(`${RUN_RECORD_UNMEASURED_MARKER} `)) {
      const rest = raw.slice(RUN_RECORD_UNMEASURED_MARKER.length + 1);
      const at = rest.indexOf(RUN_RECORD_REASON_SEPARATOR);
      if (at < 0) {
        entries.push({ command: rest, claim: 'not-measured', reason: null, exitCode: null, line, raw, malformed: `no '${RUN_RECORD_REASON_SEPARATOR.trim()}' and no reason after it`, malformedKind: 'claim' });
        continue;
      }
      const reason = rest.slice(at + RUN_RECORD_REASON_SEPARATOR.length).trim();
      entries.push({
        command: rest.slice(0, at),
        claim: 'not-measured',
        reason: reason || null,
        exitCode: null,
        line,
        raw,
        malformed: reason ? null : 'an empty reason',
        malformedKind: reason ? null : 'claim',
      });
      continue;
    }
    const { command, exitCode, malformed } = ranLineExitAnnotation(raw);
    entries.push({ command, claim: 'ran', reason: null, exitCode, line, raw, malformed, malformedKind: malformed ? 'exit' : null });
  }
  return entries;
}

/**
 * A ran line split into its command and the exit code it recorded, if any.
 *
 * The separator is found from the RIGHT: the annotation is a tail, so a command
 * that somehow contained the separator keeps all of itself and only the last
 * segment is read as a candidate annotation. A tail that is not the exact
 * `exit <digits>` shape leaves the command as the WHOLE line — its reading
 * before this field existed — and reports itself, so a runner who spelled it
 * `EXIT 3` learns that from the run instead of from a family silently landing
 * outside the derivation.
 */
function ranLineExitAnnotation(raw) {
  const at = raw.lastIndexOf(RUN_RECORD_REASON_SEPARATOR);
  if (at < 0) return { command: raw, exitCode: null, malformed: null };
  const tail = raw.slice(at + RUN_RECORD_REASON_SEPARATOR.length);
  const digits = tail.startsWith(RUN_RECORD_EXIT_PREFIX) ? tail.slice(RUN_RECORD_EXIT_PREFIX.length) : null;
  if (digits === null || !/^\d{1,3}$/.test(digits)) {
    return {
      command: raw,
      exitCode: null,
      malformed: `a '${RUN_RECORD_REASON_SEPARATOR.trim()}' tail that is not an exit code ('${tail}')`,
    };
  }
  return { command: raw.slice(0, at), exitCode: Number(digits), malformed: null };
}

/**
 * What a record's NOT-MEASURED count RESTS on — the one question the headline
 * used to answer by not asking it (#17204).
 *
 * ## The two channels, and why they are counted apart
 *
 * A family this record accounts for arrives through one of three doors, and
 * only the first is a measurement the runner could not have forgotten to make:
 *
 *   CODED   the line carries `:: exit <code>`. The CLASS is derived here, from
 *           a datum their shell captured. ⛔ This tool still did not run the
 *           gate — it read a number — but the number is not a judgement, and
 *           `exit 3` cannot be left undeclared by a runner in a hurry.
 *   SILENT  a bare line: "I ran it". A gate that refused with its own unmet
 *           prerequisite is INDISTINGUISHABLE here from one that passed, so
 *           every NOT-MEASURED count over silent families is a floor at best
 *           and, when every family is silent, a claim outright.
 *   CLAIMED the `NOT-MEASURED … :: <reason>` line. Declared, reasoned, and
 *           still the runner's own classification — which is why it keeps its
 *           own block, its own count, and the word CLAIMED in both sentences.
 *
 * ## Why the class is `silent`-driven and not `claimed`-driven
 *
 * A hidden refusal can only live in a SILENT family: a claimed one is already
 * counted, and a coded one is classified by its code. So the kind below turns
 * on `silent` alone, and the floor it reports is a floor over exactly those
 * families — not over the record's line count, which is a different number and
 * would make the sentence unfalsifiable.
 *
 * ## Why a KILLED family is counted once and not twice (#18074)
 *
 * A family whose record carries a kill code AND a reasoned claim arrives
 * through two doors at once, and it is ONE family. It is already inside
 * `coded` — it carries a code, which is the question `coded` asks — so adding
 * it to `claimed` as well would make `accounted` exceed the number of families
 * the record accounts for, and every sentence quoting that total would be
 * wrong by exactly the count of the most careful records in it. ⭐ So it keeps
 * its own count, `killClaimed`, which is reported beside the others and added
 * to none of them.
 */
export function runRecordEvidence({ coded = 0, silent = 0, notMeasured = [] } = {}) {
  const derivedFromExit = notMeasured.filter((entry) => entry.source === 'exit-code').length;
  const killClaimed = notMeasured.filter((entry) => entry.source === RUN_RECORD_NOT_MEASURED_KILL_SOURCE).length;
  const claimed = notMeasured.length - derivedFromExit - killClaimed;
  const accounted = coded + silent + claimed;
  let kind;
  if (accounted === 0) kind = 'none';
  else if (coded === 0) kind = 'claimed';
  else if (silent === 0) kind = 'derived';
  else kind = 'floor';
  return { coded, silent, claimed, killClaimed, derivedFromExit, accounted, kind };
}

/**
 * What this card's derivation names, against what the record says was run.
 *
 * ## The link this closes, and why the count line above does not close it
 *
 * `familyReconciliation` answers PRINTED ⟶ HARVESTED: it states the union's
 * total so a consumer that harvested one section of the human rendering can
 * detect that its list is short. This answers the NEXT link, HARVESTED ⟶
 * EXECUTED, and the two are not the same defect. Measured: a dev harvested the
 * family list correctly — the gate that later reddened CI was in both of its
 * `--commands` harvests, named explicitly, twice — and then used the list only
 * to diff its two derivations against each other, never as a checklist. Of the
 * 62 families its merged-head union named, 19 had been run. ⭐ A better list
 * does not make anyone run it, so a perfect answer to the first link leaves
 * this one wide open.
 *
 * ## Why the denominator is recomputed here and never read from the record
 *
 * `derived` is `commandsFor`'s union, recomputed in THIS process from this
 * tree, and it is the same expression `--commands` prints. That is what makes
 * this a set difference against an external artefact rather than arithmetic
 * over the runner's own bookkeeping, and the distinction is measured, not
 * aesthetic. A dev recovering from a cap kill by counting a loop counter
 * reported "58 families, 57 exit 0, 1 accounted for" — and the books balanced
 * PERFECTLY, because the dropped family had left the numerator and the
 * denominator in the same operation. ⭐ An arithmetic reconciliation over a
 * list you maintain yourself cannot detect an item you never added to it: it
 * is self-consistent by construction, and self-consistency is precisely what
 * it is being offered as evidence of. The reviewing PM accepted the number for
 * the same reason — checking the arithmetic runs the same broken instrument.
 *
 * Here the record can only ever SUBTRACT from a total it did not produce. A
 * family the runner never wrote down is a family that stays in `unrun`, and an
 * empty record over a non-empty derivation reports every family unrun rather
 * than a balanced nothing.
 *
 * ## The classes, and why the tool owns the remainder rather than the prose
 *
 * A reconciliation whose output is routinely non-empty trains its readers to
 * wave it through, and that has already been measured here: one card's
 * remainder of 18 was accepted because the dev named every entry in prose — 16
 * of them CI-owned job steps, 2 of them spelling duplicates of gates already
 * run. Neither can appear in this remainder, and neither is classified away by
 * a rule: `derived` is `commandsFor`'s union, which never contained the
 * always-runs tail (it is a listing about the REPO, printed under its own
 * heading) and which deduplicates the two spellings of one family into one
 * command before this function ever sees them. What the tool CAN still meet in
 * a record it classifies itself — a CI-measured-only family, which `commandsFor`
 * subtracts by design; a VALUE-BEARING family, which `commandsFor` subtracts for
 * the same reason one step later because its argv takes a value from the
 * workflow (#15083); and a pending-changeset family, derived against a path
 * that did not exist at derivation time. All three are matched byte-exactly
 * against sets this same derivation produced.
 *
 * ⭐ The third bucket is not a convenience: this file's own rule is that an
 * omission is disclosed WHERE the omission happens, and a class `commandsFor`
 * deliberately withholds is a class the runner cannot be expected to have
 * derived. Left in the remainder it reads as a command "named by nothing this
 * run derived" — the one sentence that is false about it, because this run
 * derived it and then classified it out. The likeliest recorder is a dev who
 * writes the bare spelling of one of these scripts out of habit, and what they
 * are owed is the reason, not a shrug (#15115).
 *
 * What is left for the runner to explain is therefore only what the tool
 * genuinely cannot know: a gate that refused with its own prerequisite. That is
 * the `not-measured` class, it costs a stated reason, and it is reported apart
 * from `ran` because this tool did not measure it and must not imply it did.
 *
 * ## Near misses are a DIAGNOSTIC and can never move a verdict
 *
 * A record entry that differs from a derived command only by surrounding
 * whitespace is reported as such — and the derived command stays UNRUN. That
 * asymmetry is deliberate: the trailing-underscore incident above is exactly
 * this shape, and the failure was not that the mismatch went unnoticed but that
 * a matcher RESOLVED it. Naming it while refusing to pair it gives the runner
 * the repair without giving the instrument a blind spot.
 */
export function runReconciliation({
  derived = [],
  ciOnlyCommands = new Set(),
  // Beside `ciOnlyCommands` and not after `pendingCommands`, because the file
  // already groups them: these are the TWO subtractions `commandsFor` makes
  // from the runnable union, in that order, and the pending families are a
  // different fact (a path that did not exist at derivation time). Defaulting
  // to empty keeps every existing caller's verdict byte-identical.
  notRunnableCommands = new Set(),
  pendingCommands = new Set(),
  record = [],
} = {}) {
  const derivedSet = new Set(derived);
  const ranClaims = new Set();
  const recordedExits = new Map();
  const exitContradictions = [];
  const unmeasuredClaims = new Map();
  const malformed = [];
  for (const entry of record) {
    if (entry.claim === 'ran') {
      if (entry.malformed) malformed.push({ line: entry.line, raw: entry.raw, why: entry.malformed, kind: entry.malformedKind ?? 'exit' });
      ranClaims.add(entry.command);
      if (typeof entry.exitCode === 'number') {
        const held = recordedExits.get(entry.command);
        if (!held) {
          recordedExits.set(entry.command, { code: entry.exitCode, line: entry.line });
        } else if (held.code !== entry.exitCode) {
          exitContradictions.push({ command: entry.command, held: held.code, also: entry.exitCode, line: entry.line });
          // Resolved the way the ran/claim contradiction beside it is: the
          // reading that costs a rerun, never the one that costs a false green.
          // Two lines disagreeing about one family is a record defect either
          // way, and it is REPORTED — the resolution is not a repair.
          if (entry.exitCode === EXIT_PREREQUISITE_NOT_MET) recordedExits.set(entry.command, { code: entry.exitCode, line: entry.line });
        }
      }
      continue;
    }
    if (entry.malformed) malformed.push({ line: entry.line, raw: entry.raw, why: entry.malformed, kind: entry.malformedKind ?? 'claim' });
    if (!unmeasuredClaims.has(entry.command)) unmeasuredClaims.set(entry.command, entry);
  }
  // A command claimed BOTH ways is read as run — running it is the stronger
  // fact — and the contradiction is reported rather than resolved silently.
  const conflicts = [...unmeasuredClaims.keys()].filter((command) => ranClaims.has(command)).sort();

  const ran = [];
  const unrun = [];
  const notMeasured = [];
  // The two halves of the evidence question, counted over the families this
  // record ACCOUNTS FOR rather than over its lines: `coded` is what the runner
  // measured and wrote down, `silent` is what their line merely asserts. A
  // hidden refusal can only live in `silent`, which is why that number and not
  // the line count is what the rendering quotes (#17204).
  let coded = 0;
  let silent = 0;
  for (const command of [...derivedSet].sort()) {
    if (ranClaims.has(command)) {
      const recorded = recordedExits.get(command);
      if (!recorded) {
        silent += 1;
        ran.push(command);
        continue;
      }
      coded += 1;
      // ⭐ The card's whole subject: the class is DERIVED from the recorded
      // code, so a runner cannot fail to declare it. This is not the tool
      // measuring the gate — it did not run it — it is the tool reading a
      // datum the runner captured, which is a strictly different thing from
      // the runner's own classification of it.
      if (recorded.code === EXIT_PREREQUISITE_NOT_MET) {
        notMeasured.push({
          command,
          reason: `recorded ${RUN_RECORD_EXIT_PREFIX}${recorded.code} on line ${recorded.line} — PREREQUISITE NOT MET`,
          line: recorded.line,
          source: 'exit-code',
          exitCode: recorded.code,
        });
        continue;
      }
      // ⭐ #18074: a KILL is not a verdict, so it can never be `run`. Which of
      // the two remaining classes it lands in is decided by the record, and the
      // ordering is the module's own principle: the runner who recorded the
      // code AND declared the family with a reason has said everything there is
      // to say, and their declaration is KEPT rather than overruled by the run
      // line beside it; a bare kill code says only that nothing was measured,
      // and that is UNRUN — the direction that costs a rerun, never a false
      // green.
      const killed = runRecordKillLabel(recorded.code);
      if (killed) {
        const killClaim = unmeasuredClaims.get(command);
        const recordedPhrase = `recorded ${RUN_RECORD_EXIT_PREFIX}${recorded.code} on line ${recorded.line} — ${killed}, so no verdict was reached`;
        if (killClaim && killClaim.reason) {
          notMeasured.push({
            command,
            reason: `${recordedPhrase}; declared on line ${killClaim.line}: ${killClaim.reason}`,
            line: killClaim.line,
            source: RUN_RECORD_NOT_MEASURED_KILL_SOURCE,
            exitCode: recorded.code,
          });
          continue;
        }
        unrun.push({
          command,
          why: killClaim
            ? `${recordedPhrase}, and the ${RUN_RECORD_UNMEASURED_MARKER} on line ${killClaim.line} has ${killClaim.malformed} — a kill without a stated reason is read as unrun`
            : `${recordedPhrase}; declare it as \`${RUN_RECORD_UNMEASURED_MARKER} <command>${RUN_RECORD_REASON_SEPARATOR}<reason>\` beside the code to count it ${RUN_RECORD_UNMEASURED_MARKER}`,
        });
        continue;
      }
      ran.push(command);
      continue;
    }
    const claim = unmeasuredClaims.get(command);
    if (claim && claim.reason) {
      notMeasured.push({ command, reason: claim.reason, line: claim.line, source: 'claim', exitCode: null });
      continue;
    }
    unrun.push({
      command,
      why: claim
        ? `recorded as ${RUN_RECORD_UNMEASURED_MARKER} on line ${claim.line} with ${claim.malformed} — an unexplained refusal is the shape a cap-killed run wears, so it is read as unrun`
        : 'absent from the run record',
    });
  }

  const explainedCiOnly = [];
  const explainedNotRunnable = [];
  const explainedPending = [];
  const extra = [];
  const nearMiss = [];
  const seen = new Set();
  for (const entry of record) {
    if (seen.has(entry.command)) continue;
    seen.add(entry.command);
    if (derivedSet.has(entry.command)) continue;
    if (ciOnlyCommands.has(entry.command)) {
      explainedCiOnly.push(entry.command);
      continue;
    }
    // The order is the precedence, and it is the one `commandsFor` already
    // states: `ciOnly` is the FIRST subtraction, so a family that were somehow
    // both is reported as CI-measured — one bucket per command, chosen the same
    // way in both places rather than two counts for one omission.
    if (notRunnableCommands.has(entry.command)) {
      explainedNotRunnable.push(entry.command);
      continue;
    }
    if (pendingCommands.has(entry.command)) {
      explainedPending.push(entry.command);
      continue;
    }
    // Diagnostic only — see the header. The entry stays in `extra` and its
    // near neighbour stays in `unrun`, whatever this reports.
    const trimmed = entry.command.trim();
    if (trimmed !== entry.command && derivedSet.has(trimmed)) {
      nearMiss.push({ recorded: entry.command, derived: trimmed, line: entry.line });
    }
    extra.push(entry.command);
  }

  const recon = {
    derivedTotal: derivedSet.size,
    ran,
    unrun,
    notMeasured,
    explainedCiOnly: explainedCiOnly.sort(),
    explainedNotRunnable: explainedNotRunnable.sort(),
    explainedPending: explainedPending.sort(),
    extra: extra.sort(),
    nearMiss,
    malformed,
    conflicts,
    exitContradictions,
    // ⭐ Computed ONCE, here, and read by both sentences that quote it. The
    // count line and the verdict line used to be free to say different things
    // about the same number because each wrote its own words; the class below
    // is the single expression both of them render (#17204).
    evidence: runRecordEvidence({ coded, silent, notMeasured }),
    recordEntries: record.length,
    ok: unrun.length === 0,
  };
  // Every derived family lands in exactly one of three places, and the parts
  // are built from the SAME set the total is taken from — so this closes by
  // construction, and it is asserted anyway for the reason the count
  // reconciliation above asserts its own: a total that cannot fail toward its
  // target is the defect this file keeps finding one level up, and #4690's rule
  // is that a broken instrument refuses rather than printing a verdict.
  if (recon.ran.length + recon.unrun.length + recon.notMeasured.length !== recon.derivedTotal) {
    throw new Error(
      'dispatch-gates: the run reconciliation does not close — ' +
        `${recon.ran.length} run + ${recon.unrun.length} unrun + ${recon.notMeasured.length} not-measured ≠ ${recon.derivedTotal} derived. ` +
        'The classes and the derivation came from different structures. Refusing rather than printing a verdict that cannot be trusted (#4690).',
    );
  }
  return recon;
}

/**
 * The run reconciliation, rendered — and the ONE bit at the end of it.
 *
 * The verdict is a single line and a single exit code, for the reason the
 * remainder is classified by the tool: a verdict a reader has to assemble from
 * several counts is a verdict that gets waved through once the counts are
 * routinely non-empty.
 *
 * `outside` carries the SIZES of the blocks a run without `--ran` prints below
 * its reconciliation — the same three counts `familyReconciliation` puts on its
 * own recon, taken from the same arrays. They are a parameter rather than a
 * term of `runReconciliation` on purpose: this reconciliation's arithmetic is
 * record-against-derived and closes over its own classes, and a block size is
 * not one of them — it is an input to the SENTENCE, so it arrives where the
 * sentence is written. Defaulting to zero counts keeps every caller that has no
 * derivation beside it (the self-test's fixtures) naming exactly the two blocks
 * that print unconditionally, which is the true answer for a run with none of
 * the other three (#16795).
 */
export function runReconciliationLines(recon, outside = {}) {
  const lines = [];
  const marker = RUN_RECORD_UNMEASURED_MARKER;
  lines.push(
    `Run reconciliation — ${recon.derivedTotal} derived, ${recon.ran.length} run, ${recon.notMeasured.length} ${marker}, ${recon.unrun.length} UNRUN.`,
  );
  lines.push(
    `  The ${recon.derivedTotal} is THIS tree's derivation, recomputed in this process from the same expression --commands prints —` +
      ' never read back from your record. A family you never wrote down is still counted, which is what an arithmetic over your own list cannot do.',
  );
  lines.push(...runRecordEvidenceLines(recon.evidence ?? runRecordEvidence({})));
  if (recon.unrun.length > 0) {
    lines.push(`  ⛔ UNRUN (${recon.unrun.length}) — derived for these paths, and the record does not account for them:`);
    for (const { command, why } of recon.unrun) lines.push(`    - ${command}   [${why}]`);
  }
  const derivedNotMeasured = recon.notMeasured.filter((entry) => entry.source === 'exit-code');
  const killedNotMeasured = recon.notMeasured.filter((entry) => entry.source === RUN_RECORD_NOT_MEASURED_KILL_SOURCE);
  const claimedNotMeasured = recon.notMeasured.filter(
    (entry) => entry.source !== 'exit-code' && entry.source !== RUN_RECORD_NOT_MEASURED_KILL_SOURCE,
  );
  if (derivedNotMeasured.length > 0) {
    lines.push(
      `  ${marker} · DERIVED (${derivedNotMeasured.length}) — your record carries ${RUN_RECORD_EXIT_PREFIX}${EXIT_PREREQUISITE_NOT_MET} for these,`
        + ` the number a gate refusing its own prerequisite exits with. ⛔ This tool did not run them either — it classified the code YOU recorded,`
        + ' which is the one channel here that cannot be left undeclared:',
    );
    for (const { command, reason } of derivedNotMeasured) lines.push(`    - ${command}   [${reason}]`);
  }
  if (killedNotMeasured.length > 0) {
    lines.push(
      `  ${marker} · KILLED (${killedNotMeasured.length}) — your record carries BOTH a kill code and a stated reason for these, so the run line beside it`
        + ` is NOT read as run: a kill is not a verdict. ⛔ This tool ran none of them; it read the code YOU recorded and KEPT the declaration you wrote`
        + ' next to it — the most complete record this format can carry, and the one it used to discard:',
    );
    for (const { command, reason } of killedNotMeasured) lines.push(`    - ${command}   [${reason}]`);
  }
  if (claimedNotMeasured.length > 0) {
    lines.push(
      `  ${marker} · CLAIMED (${claimedNotMeasured.length}) — the RUNNER's claim, recorded with a reason. ⛔ This tool did not measure them and cannot verify the reason:`,
    );
    for (const { command, reason } of claimedNotMeasured) lines.push(`    - ${command}   [${reason}]`);
    lines.push(
      `    ⚠️ ${marker} is for a gate that REFUSES with its own stated prerequisite. A run the OS killed is not that —` +
        ' a cap kill (exit 143) leaves no verdict of its own. Record that code beside the claim and the family is classified KILLED above, with the'
        + ' number on the page; a bare claim cannot be told from a refusal here. The two are easy to conflate under time pressure, and one of them was.',
    );
  }
  if (recon.explainedCiOnly.length > 0) {
    lines.push(
      `  Classified by this tool, no explanation owed (${recon.explainedCiOnly.length}) — CI-MEASURED ONLY, and outside the derived total by design:`,
    );
    for (const command of recon.explainedCiOnly) lines.push(`    - ${command}`);
  }
  if (recon.explainedNotRunnable.length > 0) {
    lines.push(
      `  Classified by this tool, no explanation owed (${recon.explainedNotRunnable.length}) — VALUE-BEARING famil(ies):`
        + " its argv or its step's `env:` takes a value from the workflow, so it is recorded, not derived as runnable:",
    );
    for (const command of recon.explainedNotRunnable) lines.push(`    - ${command}`);
  }
  if (recon.explainedPending.length > 0) {
    lines.push(
      `  Classified by this tool, no explanation owed (${recon.explainedPending.length}) — pending-changeset famil(ies), derived against a path that did not exist at derivation time:`,
    );
    for (const command of recon.explainedPending) lines.push(`    - ${command}`);
  }
  if (recon.extra.length > 0) {
    lines.push(
      `  Outside this card's derivation (${recon.extra.length}) — recorded, and named by nothing this run derived. Not an error: a run beyond the union costs nothing.`,
    );
    for (const command of recon.extra) lines.push(`    - ${command}`);
  }
  for (const { recorded, derived, line } of recon.nearMiss) {
    lines.push(
      `  ⚠️ line ${line} '${recorded}' differs from the derived '${derived}' by surrounding whitespace ONLY — and is NOT paired with it.` +
        ' Record the command as --commands emits it, byte for byte. ⛔ A matcher that resolved this difference is how a reconciliation reported 0 over a set the raw comparison scored 36.',
    );
  }
  for (const { line, raw, why, kind } of recon.malformed) {
    lines.push(
      kind === 'exit'
        ? `  ⚠️ line ${line} carries ${why}: '${raw}'. Read as a command in full, so it pairs with nothing.`
          + ` Spelling: <command>${RUN_RECORD_REASON_SEPARATOR}${RUN_RECORD_EXIT_PREFIX}<code>.`
        : `  ⚠️ line ${line} claims ${marker} with ${why}: '${raw}'. Spelling: ${marker} <command>${RUN_RECORD_REASON_SEPARATOR}<reason>.`,
    );
  }
  for (const { command, held, also, line } of recon.exitContradictions ?? []) {
    lines.push(
      `  ⚠️ '${command}' is recorded with TWO different exit codes (${held}, then ${also} on line ${line}).`
        + ` Read as ${held === EXIT_PREREQUISITE_NOT_MET || also === EXIT_PREREQUISITE_NOT_MET ? EXIT_PREREQUISITE_NOT_MET : held}`
        + ' — the reading that costs a rerun rather than a false green; fix the record so it states one thing.',
    );
  }
  // ⭐ The sentence states the reading this run actually TOOK, and it reads it
  // back out of the classes rather than re-deciding it here (#18074). A second
  // copy of the precedence in the renderer is a second place for the two to
  // disagree, and the failure mode is the one this whole module exists to
  // refuse: a line that confidently reports a classification the totals above
  // it do not share.
  for (const command of recon.conflicts) {
    const landedNotMeasured = recon.notMeasured.find((entry) => entry.command === command);
    const landedUnrun = recon.unrun.find((entry) => entry.command === command);
    const both = `  ⚠️ '${command}' is recorded BOTH as run and as ${marker}.`;
    if (landedNotMeasured?.source === 'exit-code') {
      lines.push(
        `${both} Read as ${marker}, derived from its recorded ${RUN_RECORD_EXIT_PREFIX}${EXIT_PREREQUISITE_NOT_MET}; fix the record so it states one thing.`,
      );
      continue;
    }
    if (landedNotMeasured?.source === RUN_RECORD_NOT_MEASURED_KILL_SOURCE) {
      // ⛔ Not "fix the record": the two lines AGREE here — a kill code and a
      // reasoned claim both say no verdict was reached — and this is the shape
      // a runner should be writing, not one to talk them out of.
      lines.push(
        `${both} The two AGREE: ${RUN_RECORD_EXIT_PREFIX}${landedNotMeasured.exitCode} is a kill, not a verdict. Read as ${marker} with your stated reason`
          + ' — ⭐ this is the record shape to keep, not one to repair.',
      );
      continue;
    }
    if (landedUnrun) {
      lines.push(`${both} Read as UNRUN — ${landedUnrun.why}.`);
      continue;
    }
    lines.push(`${both} Read as run; fix the record so it states one thing.`);
  }
  // ⭐ The enumeration READ from the one place it exists, not a prose copy.
  // This sentence used to spell three of the five blocks a plain run prints,
  // omitting the artifact rosters and the declared WIDE population — the same
  // short list, on a second lane, that #16398 measured a CI round trip for on
  // the first one (#16795). It also named the pending-changeset families
  // unconditionally, at a heading that is not printed when there are none.
  // Both are structural now: `outsideBlockNames` cannot name a block whose
  // count is zero, and cannot omit one whose count is not.
  lines.push(
    '  ⛔ This answers ONE link: what this card DERIVES against what you RAN. It is not a complete account of what CI runs on the PR —' +
      ` ${outsideBlocksPhrase(outside)} are each outside the derived total, each printed under its own heading by a run without --ran.`,
  );
  lines.push(
    recon.ok
      ? `✓ dispatch-gates --ran: ${recon.derivedTotal} derived famil(ies) accounted for — ${recon.ran.length} run,`
        + ` ${recon.notMeasured.length} ${marker}${notMeasuredEvidenceTerm(recon)}.`
      : `✗ dispatch-gates --ran: ${recon.unrun.length} of ${recon.derivedTotal} derived famil(ies) UNRUN.`,
  );
  return lines;
}

/**
 * The evidence block, printed under the counts it qualifies.
 *
 * It is unconditional wherever there is anything to qualify, and that is the
 * point: a note that appears only when something is wrong is a note a reader
 * learns to skip, and the state this card was filed about — `0 NOT-MEASURED`
 * over three gates that had exited 3 — looked exactly like nothing being wrong.
 */
function runRecordEvidenceLines(evidence) {
  const marker = RUN_RECORD_UNMEASURED_MARKER;
  const spelling = `<command>${RUN_RECORD_REASON_SEPARATOR}${RUN_RECORD_EXIT_PREFIX}<code>`;
  const capture = `Record it as \`${spelling}\`, capturing $? BEFORE any pipe.`;
  const { coded, silent, claimed, killClaimed = 0, accounted, kind } = evidence;
  if (kind === 'none') return [];
  if (kind === 'derived') {
    return [
      `  EXIT CODES — all ${accounted} accounted famil(ies) carry one, so the ${marker} count above is DERIVED from them`
        + `${killClaimed > 0 ? `, ${killClaimed} of them a KILL code the runner paired with a stated reason` : ''}`
        + `${claimed > 0 ? `, bar ${claimed} reasoned claim(s) counted beside them` : ''}. ⛔ This tool ran none of them; it read the codes you recorded.`,
    ];
  }
  if (kind === 'claimed') {
    return [
      `  ⛔ EXIT CODES — 0 of the ${accounted} accounted famil(ies) carry one. A bare line says only "I ran it", and a gate that exited`
        + ` ${EXIT_PREREQUISITE_NOT_MET} is indistinguishable here from one that exited 0 — so the ${marker} count above is the RUNNER'S CLAIM`
        + `${claimed > 0
          ? `: it is the ${claimed} they DECLARED, and a refusal they did not declare is invisible here.`
          : `, and nothing in this record can raise it above the zero it declares.`}`
        + ` ${capture}`,
    ];
  }
  return [
    `  ⚠️ EXIT CODES — ${coded} of the ${accounted} accounted famil(ies) carry one; ${silent} famil(ies) say only "I ran it".`
      + ` The ${marker} count above is a FLOOR over those ${silent}, not a total. ${capture}`,
  ];
}

/**
 * The parenthetical the ✓ line carries after its NOT-MEASURED count — the
 * sentence this card is about.
 *
 * ⭐ It is a FUNCTION of the same `evidence` the block above renders, so the two
 * cannot drift; and it is never empty when there is evidence to state, because
 * the defect was a zero that read as a measurement. The incentive it removes is
 * the one the card names: a runner who records nothing used to get the cleanest
 * line in the file, cleaner than one who annotated honestly and was rewarded
 * with a non-zero count. After this, the annotated run is the clean one.
 */
function notMeasuredEvidenceTerm(recon) {
  const evidence = recon.evidence ?? runRecordEvidence({});
  const { coded, silent, claimed, killClaimed = 0, derivedFromExit, accounted, kind } = evidence;
  const code = EXIT_PREREQUISITE_NOT_MET;
  // ⭐ Named here once so both branches quote the same clause. A KILLED family
  // is neither derived from `code` nor a bare claim, and a term that omitted it
  // would state a NOT-MEASURED count whose parts do not add up to it (#18074).
  const killedTerm = killClaimed > 0 ? `, ${killClaimed} a KILL code with a stated reason` : '';
  if (kind === 'none') return '';
  if (kind === 'derived') {
    if (recon.notMeasured.length === 0) {
      // ⛔ Byte-identical to what it always said, and it stays true under the
      // kill rule for a structural reason: this sentence is only ever reached
      // from the ✓ line, so every derived family is in `ran` — and a killed
      // family can no longer be there (#18074).
      return ` (a DERIVED zero — all ${accounted} recorded an exit code and none of them is ${code})`;
    }
    return ` (${derivedFromExit} DERIVED from a recorded ${RUN_RECORD_EXIT_PREFIX}${code}${killedTerm}${claimed > 0 ? `, ${claimed} claimed` : ''})`;
  }
  if (kind === 'claimed') {
    return ` (⛔ CLAIMED — ${silent} of ${accounted} recorded no exit code, so this`
      + ` ${recon.notMeasured.length === 0 ? 'zero' : 'count'} is what the runner declared, not what the record shows)`;
  }
  return ` (⛔ a FLOOR — ${derivedFromExit} derived from ${RUN_RECORD_EXIT_PREFIX}${code}${killedTerm}${claimed > 0 ? `, ${claimed} claimed` : ''};`
    + ` ${silent} of ${coded + silent + claimed} recorded no exit code)`;
}

/**
 * `--json`, as one document. Everything the human rendering places, placed the
 * same way, so a consumer never has to choose between a machine-readable answer
 * and a complete one.
 *
 * `pendingChangeset` is IN this document and deliberately NOT in `commands`.
 * Those families are derived against a path that does not exist yet — the
 * changeset the dev writes after this runs — so listing them as runnable
 * commands would hand a consumer commands about a file that is not there. They
 * are disclosed as their own key instead, with the probe path that produced
 * them, so the omission is a fact the consumer can read rather than a silence.
 * That distinction is the card's own subject matter: what is left out of a list
 * must be visible in the list.
 */
export function derivationJson({ paths, size = null, matchedRows, kindGroups, pending, counts, identity, alwaysRunsRows = [], widePopulationRows = [], rosters = [], jobFiltered = { rows: [], counts: {} }, typeCheckLanes = { rows: [], counts: {} } }) {
  const commands = commandsFor({ matchedRows, kindGroups, alwaysRunsRows });
  const { otherCommands, ...spelling } = spellingSplit(commands);
  return {
    tool: 'dispatch-gates',
    repo: identity?.slug ?? null,
    commit: identity?.head ?? null,
    paths: [...paths],
    // The changed-line reading (2026-09-18 human-merge threshold), measured
    // only when the change set was derived from git: an explicit path list
    // carries no diff, and `measured: false` says so rather than a zero.
    changedLines: size
      ? { ...sizeVerdict(size), files: size.files, binaryFiles: size.binaryFiles, untrackedFiles: size.untrackedFiles }
      : sizeVerdict(null),
    commands,
    spelling: otherCommands.length ? { ...spelling, otherCommands } : spelling,
    matched: matchedRows,
    convention: kindGroups,
    // IN this document and IN `commands`, unlike `pendingChangeset` below: a
    // declaring family is runnable today and owed by this card, and the whole
    // reason it has its own key is that it is placed by declaration rather
    // than by `paths` — a consumer reading `matched` must not find it there
    // (that would be a lead on every card) and must not have to infer it from
    // the commands list either (#14189).
    alwaysRunsPopulation: alwaysRunsRows,
    // IN this document and ⛔ NOT in `commands` (#15341) — the mirror of the
    // key above it, and the pair is why both exist: a whole-tree family is owed
    // by every card, a wide-population family by none, and a consumer must be
    // able to read the difference rather than infer it from an absence. Its own
    // key for the reason `artifactRosterSilences` has one: an omission a machine
    // consumer has to deduce is the omission this document exists to state.
    widePopulation: widePopulationRows,
    // IN this document and ⛔ NOT in `commands`, for the reason
    // `artifactRosterLines` states: these families are `silent`, so no path a
    // caller passes can move them, and merging them into the runnable union
    // would make every card's total a different number for a reason unrelated
    // to the card. Their own key instead, so a machine consumer reads the same
    // omission the human block names rather than inferring it (#14880).
    artifactRosterSilences: rosters.map(({ check, command, workflows, artifacts, dir, coversYourPath, checkerHealth }) => ({
      check, command, workflows, artifacts, dir, coversYourPath,
      // The same three-valued axis the human block splits on (#16030), stated
      // rather than left for a machine consumer to re-derive from the command
      // string -- re-deriving it from the printed bytes is exactly the reading
      // that misses the pnpm-spelled rows. `null` is "not resolvable here",
      // never "judges the diff".
      checkerHealth,
    })),
    pendingChangeset: {
      probePath: CHANGESET_PROBE_PATH,
      families: pending.map(({ check, entry }) => ({
        check,
        command: runnableInvocation(entry),
        workflows: [...entry.workflows],
      })),
    },
    // IN this document and ⛔ NOT in `commands` (#16285) — the same disposition
    // as `widePopulation` above and for a stricter reason: these rows are not
    // check families at all. They are CI's own steps, in CI's environment, in
    // jobs THIS CARD'S PATHS schedule, that no discovered family accounts for.
    // Its own key so a machine consumer reads the omission the human block
    // names rather than inferring it from an absence — the whole contract of
    // this document. `counts` travels beside the rows because the block's
    // heading is arithmetic (how many jobs cover, how many steps are accounted
    // for) and a consumer that had to recount it could name a set the rows do
    // not contain.
    jobFilteredSteps: { jobs: jobFiltered.rows, counts: jobFiltered.counts },
    // IN this document and ⛔ NOT in `commands` (#19172), on the disposition of
    // the key above it: these are CI's own type-check programs, not families.
    // `counts` is the walk's DENOMINATOR — an empty `lanes` is not a bare tree.
    typeCheckLanes: { lanes: typeCheckLanes.rows, counts: typeCheckLanes.counts },
    counts,
  };
}

/**
 * Render a machine-readable mode. stdout carries the ANSWER and nothing else;
 * every word about the answer goes to stderr, where this tool already puts its
 * banner and its change-set provenance.
 *
 * That split is the mechanism, not a convenience. A consumer redirecting stdout
 * gets a file it can execute or parse with no filter in front of it, which is
 * what makes the harvest hazard structurally unreachable rather than merely
 * documented — there is no prose in the stream to pattern-match, and therefore
 * no spelling for a pattern to prefer.
 *
 * The stderr accounting exists so everything stdout deliberately omits is
 * omitted OUT LOUD. A quiet omission is the defect this mode was added to fix,
 * and adding a new one inside the fix is how that defect reproduces itself one
 * layer up — which is exactly what the closing disclaimer did: it named the
 * always-runs tail and stopped, while FIVE blocks sit outside the command list
 * and the declared WIDE population was not mentioned in it at all. It reads
 * `outsideBlockNames` now, with the counts this function already holds (#16795).
 */
export function machineReadableOutput(mode, { paths, size = null, matchedRows, kindGroups, pending, counts, alwaysRunsRows = [], widePopulationRows = [], rosters = [], jobFiltered = { rows: [], counts: {} }, typeCheckLanes = { rows: [], counts: {} } }) {
  const identity = repoIdentity();
  const commands = commandsFor({ matchedRows, kindGroups, alwaysRunsRows });
  const split = spellingSplit(commands);

  if (mode === 'json') {
    console.log(JSON.stringify(derivationJson({ paths, size, matchedRows, kindGroups, pending, counts, identity, alwaysRunsRows, widePopulationRows, rosters, jobFiltered, typeCheckLanes }), null, 2));
  } else {
    for (const command of commands) console.log(command);
  }

  const conventionCount = kindGroups.reduce((n, g) => n + g.gates.filter((x) => x.command).length, 0);
  const ciOnlyRows = matchedRows.filter((row) => row.ciOnly);
  const notRunnableRows = matchedRows.filter((row) => row.notRunnable);
  const alwaysRunsRunnable = alwaysRunsRows.filter((row) => !row.ciOnly && !row.notRunnable && !row.refused);
  console.error(
    `dispatch-gates --${mode}: ${commands.length} command(s) — ${split.pnpm} pnpm, ${split.node} direct node` +
      `${split.other ? `, ${split.other} neither` : ''} (${matchedRows.length - ciOnlyRows.length - notRunnableRows.length} matched by path, ${conventionCount} by change KIND` +
      `${alwaysRunsRunnable.length ? `, ${alwaysRunsRunnable.length} declared WHOLE-TREE and named on every card` : ''}).`,
  );
  // Stated on stderr where every other provenance is stated, and stated even
  // though these commands ARE on stdout: a consumer counting "matched by path"
  // against the stdout line count would otherwise find a surplus with no
  // explanation, which is the arithmetic-with-no-story shape this mode's own
  // accounting exists to prevent (#14189).
  if (alwaysRunsRunnable.length) {
    console.error(
      `  + those ${alwaysRunsRunnable.length} are placed by their own whole-tree-population declaration, not by these paths — identical on every` +
        ' card, and outside the matched/silent/undetermined verdicts entirely. Run without --commands/--json to see each one with its reason.',
    );
  }
  // Omitted OUT LOUD for the same reason as everything around it (#15341), and
  // this one is the omission a reader is most likely to misread as a clearance:
  // these gates DO judge the diff, CI runs every one of them, and no path
  // derivation can narrow them — so the stream a consumer executes cannot carry
  // them and the accounting beside it has to say they exist.
  const wideRunnable = widePopulationRows.filter((row) => !row.refused);
  if (wideRunnable.length) {
    console.error(
      `  + ${wideRunnable.length} famil(ies) DECLARE a population too wide to place and are ${mode === 'json' ? 'under widePopulation, not in commands' : 'NOT above'} — ` +
        'CI runs them over a whole root (or a file-kind filter inside one) that no subtree glob spells, so no path of yours narrows them ' +
        'and their absence here is not a clearance. Run without --commands/--json to see each one with its reason.',
    );
  }
  // The THIRD thing stdout deliberately omits, omitted OUT LOUD for the reason
  // this function's header gives for the other two: a quiet omission is the
  // defect this mode exists to fix (#14004).
  if (ciOnlyRows.length) {
    console.error(
      `  + ${ciOnlyRows.length} famil(ies) matched by path are CI-MEASURED ONLY and are ${mode === 'json' ? 'flagged as ciOnly on their matched row, not in commands' : 'NOT above'} — ` +
        'they read the workflow event payload, so no local run of them can produce a verdict. Run without --commands/--json to see them named.',
    );
  }
  // The FIFTH thing stdout deliberately omits (#15083), on stderr for the same
  // reason as the four around it: a quiet omission is the defect this mode
  // exists to fix, and this one subtracts commands the list used to carry —
  // as a BARE key CI never ran.
  if (notRunnableRows.length) {
    console.error(
      `  + ${notRunnableRows.length} famil(ies) matched by path take a VALUE FROM THE WORKFLOW and are ${mode === 'json' ? 'flagged as notRunnable on their matched row, not in commands' : 'NOT above'} — ` +
        "their argv or their step's `env:` carries a variable with no value outside a CI run. Run without --commands/--json to see each one printed as CI spells it.",
    );
    // Named, one per line, and named as NOT MEASURED rather than as an omission
    // (#15441). A count says something is missing; it does not say that a
    // `--self-test` of the same script sitting in the list above is not the
    // thing that is missing — which is the substitution this card was filed on.
    for (const row of notRunnableRows) {
      console.error(`      ⊘ NOT MEASURED — ${row.check}`);
    }
    console.error(
      '      ⛔ A --self-test or any other argv of those same scripts may well be in the list above: it grades the script,' +
        ' not your diff. Nothing above answers the families just named.',
    );
  }
  if (pending.length) {
    console.error(
      `  + ${pending.length} famil(ies) apply once this card's changeset exists and are ${mode === 'json' ? 'under pendingChangeset, not in commands' : 'NOT above'} — ` +
        'they are derived against a path that does not exist yet. Write the changeset, then derive again.',
    );
  }
  // The SIXTH thing stdout deliberately omits (#16285), and the one a consumer
  // of THIS lane is least able to infer: it is not a check family at all, so no
  // key on any row above hints that it exists. The jobs are NAMED one per line
  // rather than counted, for the reason the NOT MEASURED lines above are: a
  // count says something is missing; it does not say that the thing missing is
  // the CI job that runs the tests of the package this card edits — which is
  // exactly the report this block was filed on.
  if (jobFiltered.rows.length) {
    console.error(
      `  + ${jobFiltered.rows.length} CI job(s) are scheduled BY YOUR PATHS and run ${jobFiltered.counts.unaccounted} step(s) no family above names` +
        ` — ${mode === 'json' ? 'under jobFilteredSteps, not in commands' : 'NOT above'}. They are CI's own shell in CI's environment,` +
        ' so there is no local invocation to hand you, and running every command on stdout does ⛔ NOT cover them.',
    );
    for (const row of jobFiltered.rows) {
      console.error(
        `      ⊘ NOT MEASURED — [${row.workflow} · ${row.job}] ${row.steps.length} step(s):` +
          ` ${row.steps.map((s) => s.step).join(' · ')}`,
      );
    }
    console.error('      ⇒ Run without --commands/--json to see each step printed as CI spells it.');
  }
  // ⭐ The SEVENTH thing stdout deliberately omits (#19172) — and the lane this
  // card was filed on, because `--commands` disclosed it in no form at all. It
  // is stated at BOTH zero and non-zero: an omitted heading reads as a clearance.
  if (typeCheckLanes.rows.length) {
    console.error(
      `  + ${typeCheckLanes.rows.length} CI step(s) run a TYPE-CHECK PROGRAM and are ${mode === 'json' ? 'under typeCheckLanes, not in commands' : 'NOT above'} —` +
        " CI's own shell over CI's whole-workspace filters, so there is no local invocation to hand you." +
        ` Walked ${typeCheckLanes.counts?.steps ?? 0} step(s) / ${typeCheckLanes.counts?.runLines ?? 0} run: line(s) to find them.`,
    );
    for (const row of typeCheckLanes.rows) {
      const more = row.commands.length > 1 ? `   (+${row.commands.length - 1} more lane line(s) in this step)` : '';
      console.error(`      ⊘ NOT MEASURED — [${row.workflow} · ${row.job}] ${row.commands[0]}${more}${row.conditional ? '   (conditional)' : ''}`);
    }
    console.error('      ⛔ pnpm check:type-check-coverage and pnpm check:type-check-debt are NOT these, whichever list they are in:'
      + ' they ratchet a ledger. What this card owes is `pnpm --filter <pkg> run typecheck` per package whose TypeScript it touches.');
  } else {
    console.error(`  + ⊘ TYPE-CHECK LANES: ${typeCheckLanes.counts?.steps ?? 0} step(s) walked across ${typeCheckLanes.counts?.prWorkflows ?? 0} pull-request workflow(s), NONE found — read that as a broken read, never as a tree without type checking.`);
  }
  // The FOURTH thing stdout deliberately omits (#14880), on stderr for exactly
  // the reason the three above are: the block is prose, and prose in the stream
  // a consumer executes is the harvest hazard this mode exists to make
  // unreachable. ⛔ Never merged into the command list — these families are
  // `silent`, and no path a caller passes can move them.
  for (const line of artifactRosterLines(rosters)) console.error(`  ${line}`);
  // ⭐ The closing disclaimer, READ from the one place the list exists. It named
  // the always-runs tail alone, so a `--commands` consumer — the reader this
  // file's own header sends here INSTEAD of the prose — was never told the
  // declared WIDE population exists, which is the same defect on the lane that
  // was supposed to be the safe one (#16795).
  //
  // The counts are the LENGTHS OF THE ARRAYS THAT RENDER THE BLOCKS on a plain
  // run, deliberately not the runnable subsets the count lines above report:
  // `widePopulationLines` prints its refused rows too, so sizing this name off
  // `wideRunnable` would name a block by a number the block does not show. Each
  // name is the block, not the part of it this lane happens to summarise.
  console.error(
    `  ⛔ Not a complete account of what CI runs on this PR: ${outsideBlocksPhrase({
      artifactRosters: rosters.length,
      widePopulation: widePopulationRows.length,
      pendingChangeset: pending.length,
      jobFilteredJobs: jobFiltered.rows.length,
    })} are each OUTSIDE the ${commands.length} command(s) on stdout. Run without --commands/--json to see every one of them named.`,
  );
}

function derive(paths, { showResidue = false, mode = 'human', runRecord = [], size = null } = {}) {
  // The reachability sweep runs BEFORE a line is printed, so its refusals
  // (#4690: an empty corpus, or an all-unreachable answer) come out as a
  // failed derivation rather than as a footnote under an answer that already
  // looks complete. It reads the tree only; it moves no verdict above.
  //
  // It is read here, above the discovery, because the extractor needs the same
  // corpus to judge a single-segment directory literal — one listing, so the
  // hints and the sweep that grades them cannot be taken from different trees.
  // Both halves come from `repoCorpus`, which lists the checkout once per
  // process. Held in names rather than built inline: the artifact-roster split
  // needs the SAME bundle the discovery was handed. Built twice they would be
  // two readings of one listing, which is the drift `watchHintTree`'s own
  // docblock refuses ("the pair is meaningless apart") — and taking them from
  // the shared corpus makes the pair the same two OBJECTS rather than two
  // equal copies, which is also what lets the discovery below be the same pass
  // `gateFamilyFiles` gets under `changeKindGates` instead of a second one
  // over an identical tree (#18201).
  const { files: swept, tree } = repoCorpus();
  const { byCheck, workflows, workflowEntries } = discoverFamilies({ tree });
  // ONE per-hint sweep feeds both readers of dead literals: the unreachable
  // listing (whole-family grain) and the residue annotations (per-hint grain,
  // #13312) — so the two cannot disagree about which literals are dead.
  const sweep = deadHintSweep([...byCheck], swept);
  const unreachable = unreachableFamilies([...byCheck], swept, sweep);

  const matched = new Map();
  const undetermined = [];
  const silent = [];
  // The fourth bucket (#14189): families placed by their own whole-tree
  // declaration. `placeFamily` is the ONLY thing that decides which bucket a
  // family lands in, so a family that declares nothing reaches exactly the
  // classifier it always reached.
  const alwaysRuns = [];
  // The FIFTH bucket (#15341): families placed by their own wide-population
  // declaration. Same seam, opposite disposition to the fourth — declared, and
  // outside this card's runnable total.
  const widePopulation = [];
  for (const [check, entry] of byCheck) {
    const { verdict, hits } = placeFamily(entry, paths);
    if (verdict === 'always-runs') alwaysRuns.push([check, entry]);
    else if (verdict === 'wide-population') widePopulation.push([check, entry]);
    else if (verdict === 'matched') matched.set(check, { entry, hits });
    else if (verdict === 'undetermined') undetermined.push([check, entry]);
    else silent.push([check, entry]);
  }
  // The roster classification travels ON the row, for the same reason the
  // matched provenance does: the human block, the `--commands` stderr
  // accounting and the `--json` document are three readings of THESE rows, so
  // none of them can name a different set than the residue summary counts
  // (#14880).
  const rosters = silent
    .map(([check, entry]) => {
      const roster = artifactOnlySilence(entry, paths, tree);
      if (!roster) return null;
      const command = runnableInvocation(entry);
      // The SECOND axis this block reports, beside `coversYourPath` and
      // travelling on the row for the same reason (#16030): the human block,
      // the `--commands` stderr accounting and the `--json` document are three
      // readings of THESE rows, so none of them can name a different set.
      const checkerHealth = rosterCheckerHealth(entry, command);
      return { check, command, workflows: [...entry.workflows], checkerHealth, ...roster };
    })
    .filter(Boolean);

  // ONE structured answer, rendered three ways below. The human block, the
  // `--commands` list and the `--json` document are readings of these same
  // rows: the card this section answers is about two renderings of one
  // derivation drifting apart, so a second traversal here would reintroduce it.
  const resolveInvocation = (name) => {
    const entry = byCheck.get(name);
    return entry ? runnableInvocation(entry) : null;
  };
  const matchedRows = [...matched].sort().map(([check, { entry, hits }]) => ({
    check,
    command: runnableInvocation(entry),
    workflows: [...entry.workflows],
    // The provenance travels with every hit: a lead CI's own trigger schedules
    // and a lead inferred from a string in a script are different claims, and
    // the column that justifies the lead has to say which.
    via: hits.map((h) => ({ path: h.path, via: h.via, hint: h.hint })),
    // The classification travels ON the row, for the same reason the
    // provenance does: every rendering below is a reading of these rows, so a
    // family cannot be runnable in one output and CI-measured in another
    // (#14004).
    ciOnly: entry.ciOnly ?? null,
    // Travels on the row for the identical reason `ciOnly` does: every
    // rendering below is a reading of these rows, so a family cannot be
    // runnable in one output and value-bearing in another (#15083).
    notRunnable: entry.notRunnable ?? null,
    // Travels for the same reason again (#15441): the row states which of its
    // workflow values it filled from the script's own declaration, so the human
    // block, the `--commands` accounting and `--json` cannot disagree about
    // whether a family was repaired or merely rendered.
    argvDefaulted: entry.argvDefaulted ?? [],
    // And again (#20278): the step-`env:` names this row runs WITHOUT because
    // its script declares them unneeded, so no rendering can list the command
    // runnable without also being able to say why a CI-env step became one.
    localEnv: localEnvAdmitted(entry),
    // The script path, so a rendering can ask whether a family's `--self-test`
    // sibling is in the runnable list beside it — the substitute this card is
    // about, which has to be labelled where it is offered.
    script: entry.script ?? null,
  }));
  // Built the same way `matchedRows` is, and for the same reason: every
  // rendering below is a reading of these rows, so the human block, the
  // `--commands` union and the `--json` document cannot disagree about which
  // families declared a whole-tree population or why (#14189).
  const alwaysRunsRows = [...alwaysRuns].sort().map(([check, entry]) => ({
    check,
    command: runnableInvocation(entry),
    workflows: [...entry.workflows],
    reason: entry.wholeTreeReason,
    // The liveness reading travels ON the row for the same reason the matched
    // provenance does: the row is a claim, and the reader is owed what backs it.
    rootWalk: entry.rootWalk ?? null,
    refused: wholeTreePopulationRefusal(entry),
    ciOnly: entry.ciOnly ?? null,
    notRunnable: entry.notRunnable ?? null,
  }));
  // Built the same way the two row sets above are, and for the same reason: the
  // human block and the `--json` document are readings of THESE rows, so they
  // cannot disagree about which families declared a wide population or why
  // (#15341). No `ciOnly`/`notRunnable` here — those two exist to subtract a
  // command from the runnable union, and no row of this kind is ever in it.
  const widePopulationRows = [...widePopulation].sort().map(([check, entry]) => ({
    check,
    command: runnableInvocation(entry),
    workflows: [...entry.workflows],
    reason: entry.widePopulationReason,
    refused: widePopulationRefusal(entry),
  }));
  const kindGroups = changeKindGates(paths, resolveInvocation);
  // The pending-changeset section is derived in BOTH input modes and is gated
  // on nothing but the answer itself: the PM's paths are a hypothesis with no
  // changeset in it, and a dev's real diff has none either until the changeset
  // is written. Where one already exists, the families are in `matched` above
  // and this comes back empty. See pendingChangesetFamilies for the round of
  // five dispatches that measured the gap.
  const pending = pendingChangesetFamilies([...byCheck], new Set(matched.keys()));
  // Read from the SAME `workflowEntries` the discovery and the always-runs tail
  // read, for the reason they share it: a block derived from a second read
  // could describe a different revision of a workflow than the families it is
  // printed beside, and the whole point of this block is that it states what
  // the family list does not cover (#16285).
  const jobFiltered = jobFilteredSteps(workflowEntries, paths);

  if (mode === 'ran') {
    // Built from the SAME four expressions the other renderings read, in this
    // process, on this tree: the union `--commands` prints, the two sets that
    // union subtracts — CI-measured, and value-bearing — and the pending
    // families it holds back. A second
    // traversal here would be a second answer to a question this file already
    // answers once — and it would be the answer the reconciliation is judged
    // against, which is the worst possible place to keep a duplicate.
    const recon = runReconciliation({
      // The whole-tree channel is DERIVED work, so `--ran` holds the runner to
      // it exactly as it holds them to a matched family: a declaring gate this
      // card never ran comes back UNRUN, which is the half of the channel that
      // makes it a contract rather than a note (#14189).
      derived: commandsFor({ matchedRows, kindGroups, alwaysRunsRows }),
      ciOnlyCommands: ciOnlyCommandSet(matchedRows, alwaysRunsRows),
      // The SECOND set `commandsFor` subtracts, read from the SAME rows by the
      // SAME expression it uses — so the union and the reconciliation cannot
      // drift about which invocations are withheld, exactly as they cannot for
      // the CI-measured set above it (#15115).
      notRunnableCommands: notRunnableCommandSet(matchedRows, alwaysRunsRows),
      pendingCommands: new Set(pending.map(({ entry }) => runnableInvocation(entry))),
      record: runRecord,
    });
    // The block sizes handed across as the SAME arrays a plain run renders
    // those blocks from — never as recounts of them, for the reason the human
    // lane's own call states: a second count could name a set the output does
    // not contain (#16398, #16795). `--ran` prints none of these blocks itself;
    // the sentence points at the run that does, and it must point at what THAT
    // run would print for these paths, which is what these three arrays are.
    for (const line of runReconciliationLines(recon, {
      artifactRosters: rosters.length,
      widePopulation: widePopulationRows.length,
      pendingChangeset: pending.length,
      jobFilteredJobs: jobFiltered.rows.length,
    })) console.log(line);
    return recon.ok ? 0 : 1;
  }

  // The SAME entries, for the reason the `jobFiltered` line states — and BELOW
  // the `--ran` return, which renders no block of it (#19172).
  const typeCheckLanes = typeCheckLaneSteps(workflowEntries);

  if (mode !== 'human') {
    machineReadableOutput(mode, {
      paths,
      size,
      matchedRows,
      kindGroups,
      pending,
      alwaysRunsRows,
      widePopulationRows,
      rosters,
      jobFiltered,
      typeCheckLanes,
      counts: {
        discovered: byCheck.size,
        workflows: workflows.length,
        matched: matched.size,
        undetermined: undetermined.length,
        silent: silent.length,
        alwaysRuns: alwaysRuns.length,
        widePopulation: widePopulation.length,
        unreachable: unreachable.length,
        swept: swept.length,
      },
    });
    return;
  }

  // Computed ONCE, above the rendering, and handed to both readers of it: the
  // matched block's footer (which needs to know how many families sit outside
  // the block it counts) and the reconciliation line below. Recomputing it in
  // either place would be two readings of one derivation, which is the drift
  // this card is about.
  // `rosters`, `widePopulationRows` and `pending` are handed in as the SAME
  // arrays the three conditional blocks below the reconciliation are rendered
  // from, never as recounts of them: the line has to name every block that sits
  // outside this total, and a second count of those rows could name a set the
  // output does not contain (#16398, #16795).
  const recon = familyReconciliation({
    matchedRows, kindGroups, alwaysRunsRows, rosterRows: rosters, widePopulationRows, pendingRows: pending,
    jobFilteredRows: jobFiltered.rows,
  });

  console.log(`dispatch-gates: ${byCheck.size} check famil(ies) discovered across ${workflows.length} workflow file(s) — derived at runtime, nothing listed in this script.\n`);
  // The tier verdict prints on EVERY run, hit or not. Printing it only on a hit
  // would make its absence mean two things at once — "no mandate" and "this
  // build has no tier derivation" — and the claim comment is written from
  // whatever the run said.
  for (const line of tierLines(deriveTier(paths))) console.log(line);
  // The changed-line reading beside it (2026-09-18 ruling), on every run for
  // the same reason the tier verdict is.
  for (const line of changedLineLines(size)) console.log(line);
  console.log('');
  // The block a dev PASTES carries only families a dev can run (#14004). The
  // CI-measured ones are not dropped — they get their own heading below, past
  // the blank line the published harvest stops at, so the family stays named
  // and named ONCE, and no harvest of this block can pick up a command whose
  // only local outcome is a nonzero exit.
  const runnableRows = matchedRows.filter((row) => !row.ciOnly && !row.notRunnable);
  const ciOnlyRows = matchedRows.filter((row) => row.ciOnly);
  // The second not-runnable channel (#15083). Kept out of the pasted block for
  // the reason the CI-measured rows are: the block a dev pastes carries only
  // families a dev can run, and these get their own heading below the blank
  // line the published harvest stops at — named ONCE, and unable to reach a
  // harvest of the block above.
  const notRunnableRows = matchedRows.filter((row) => row.notRunnable);
  const viaText = (hits) => hits.map((h) => `${h.path} ⇢ ${h.via} '${h.hint}'`).join('; ');
  // ⚠️ Since #15441 two matched rows can render ONE command: a script CI
  // invokes under two different workflow variables has two keys, and both
  // render the same locally-runnable invocation once the script's own declared
  // default fills the value position. The block a dev pastes is deduplicated on
  // the COMMAND for the reason `commandsFor` states in its own docblock — "a
  // list that says the same command twice teaches its reader to skim" — and
  // both rows' workflows, provenance and filled values are carried onto the one
  // row, so the merge loses the repetition and nothing else. It is also what
  // keeps this block's footer and the reconciliation agreeing: `matchedCommands`
  // in `familyReconciliation` has always counted DISTINCT commands.
  const pastedRows = [];
  const pastedByCommand = new Map();
  for (const row of runnableRows) {
    const already = pastedByCommand.get(row.command);
    if (!already) {
      const merged = {
        ...row,
        workflows: [...row.workflows],
        via: [...row.via],
        argvDefaulted: [...(row.argvDefaulted ?? [])],
        localEnv: [...(row.localEnv ?? [])],
      };
      pastedByCommand.set(row.command, merged);
      pastedRows.push(merged);
      continue;
    }
    for (const wf of row.workflows) if (!already.workflows.includes(wf)) already.workflows.push(wf);
    for (const hit of row.via) {
      if (!already.via.some((h) => h.path === hit.path && h.via === hit.via && h.hint === hit.hint)) already.via.push(hit);
    }
    for (const filled of row.argvDefaulted ?? []) {
      if (!already.argvDefaulted.some((d) => d.flag === filled.flag && d.variable === filled.variable)) {
        already.argvDefaulted.push(filled);
      }
    }
    for (const name of row.localEnv ?? []) if (!already.localEnv.includes(name)) already.localEnv.push(name);
  }
  if (runnableRows.length) {
    console.log('Local gates for this card (paste into the dispatch prompt):');
    for (const { command, workflows: wfs, via: hits, argvDefaulted, localEnv } of pastedRows) {
      // The note rides the SAME line, deliberately: the published harvest ends
      // this block at the first empty line and reads each row with one regexp,
      // so a second line under a row would be harvested as another command. It
      // carries no `   [` for the same reason — that is the separator the
      // harvest's own `sed` keys on.
      const filled = (argvDefaulted ?? []).length
        ? `   · ${[...new Set(argvDefaulted.map((d) => `${d.flag} ${d.value}`))].join(', ')} is this script's own documented`
          + ` default; CI pins it to ${[...new Set(argvDefaulted.map((d) => d.variable))].join(', ')}`
        : '';
      // Same line, same reason as the note above (#20278).
      const unneeded = (localEnv ?? []).length
        ? `   · runs here without ${localEnv.join(', ')}: its script declares local-env for this bare invocation,`
          + " and CI passes them through the step's env:"
        : '';
      console.log(`  - ${command}   [${wfs.join(', ')}]   matched via ${viaText(hits)}${filled}${unneeded}`);
    }
    // The blank line FIRST, and it is not cosmetic: the published harvest ends
    // the block at the first empty line, so a footer butted against the rows
    // would be harvested AS rows. See spellingFooterLines.
    console.log('');
    for (const line of spellingFooterLines(spellingSplit(pastedRows.map((r) => r.command)), recon)) {
      console.log(line);
    }
  } else if (ciOnlyRows.length || notRunnableRows.length) {
    // ⛔ NOT the "nothing matched" sentence below: families DID match, and
    // saying otherwise would hide the one row this card is about behind a
    // claim the run just measured as false.
    console.log('No LOCALLY runnable check family names the given paths — every family they matched is CI-measured only or takes a value from the workflow; see the headings below.');
  } else {
    console.log("No check family names the given paths in its own source, and no workflow's path filter schedules one for them.");
  }

  if (ciOnlyRows.length) {
    console.log('');
    console.log(`CI-measured only — matched by path, and NOT runnable here (${ciOnlyRows.length} famil(ies)):`);
    for (const { command, workflows: wfs, via: hits, ciOnly } of ciOnlyRows) {
      console.log(`  - ${command}   [${wfs.join(', ')}]   matched via ${viaText(hits)}`);
      console.log(
        `      ↳ reads the workflow event payload (${ciOnly.env}) and is invoked only by its workflow — outside a run` +
          ' there is no payload to judge, and a guard that "could not look" must never exit 0, so a local run of this' +
          ' can only ever exit nonzero. CI measures it on the PR; there is nothing to run here, and a red from running it' +
          ' anyway is not a finding.',
      );
    }
    console.log('  ⇒ Derived from the gate\'s own source, not from a list of names: a family that reads the payload and has no local invocation classifies itself.');
  }

  // The value-bearing channel (#15083), rendered on the CI-measured section's
  // exact shape and placed beside it because it answers the same question — a
  // family this card owes that this machine cannot run — from a different
  // measurement. The invocation prints in FULL, as CI spells it, so the reader
  // can see which value is missing and where it comes from; the refusal is a
  // labelled line of its own, never an ellipsis and never a truncated command.
  if (notRunnableRows.length) {
    console.log('');
    console.log(`Value-bearing argv or env — matched by path, and NOT runnable here (${notRunnableRows.length} famil(ies)):`);
    // A sibling of the SAME script that this card CAN run, matched on the
    // script path rather than on a name (#15441). It is what a reader reaches
    // for when the row below says the question is unanswered, and it is exactly
    // what must not be mistaken for an answer: the card that filed this was
    // filed on a `--self-test` sitting in `--commands` as the only member of a
    // family whose real check was refused, and a dev reporting "50 run · 50
    // exit 0 · 0 red" on a PR whose Check Changeset job was red the whole time.
    const siblingOf = new Map();
    for (const row of runnableRows) {
      if (row.script && !siblingOf.has(row.script)) siblingOf.set(row.script, row.command);
    }
    for (const { command, workflows: wfs, via: hits, notRunnable, script } of notRunnableRows) {
      console.log(`  - ${command}   [${wfs.join(', ')}]   matched via ${viaText(hits)}`);
      console.log(
        `      ⛔ NOT RUNNABLE LOCALLY — ${notRunnable.variables.length} value(s) come from the workflow:` +
          ` ${notRunnable.variables.join(', ')}`,
      );
      // Two carriers, two reasons — and the argv sentence is FALSE for an
      // env-carried row: there is no flag to document a default for (#15761).
      // Printing it anyway would send a reader to a usage block that cannot
      // hold the answer, which is the shape of advice this file refuses.
      const envCarried = (notRunnable.envVariables ?? []).length === notRunnable.variables.length;
      console.log(
        `      ⊘ NOT MEASURED — nothing this card can run answers ${command}. `
          + (envCarried
            ? "The value reaches its script through the step's `env:` and not through a flag this tool could default"
            : 'Its script documents no default for the flag the workflow pins')
          + ', so there is no local invocation of it, and this tool will ⛔ not invent one.',
      );
      const sibling = siblingOf.get(script);
      if (sibling) {
        console.log(
          `      ⚠ \`${sibling}\` above is a DIFFERENT invocation of the same script — a self-test grades the script against` +
            ' its own fixtures, and any other argv asks another question. ⛔ Its exit 0 is a zero from a command that cannot' +
            ' answer this row, never a green for it.',
        );
      }
    }
    console.log(
      '  ⇒ Printed as CI spells it, variable names in the value positions, so nothing above reads as a command to paste:' +
        ' these are ⛔ NOT in --commands, and a BARE run of any of these scripts is an invocation CI never makes.',
    );
    console.log(
      '  ⇒ Read from the workflow text, not from a table in this script: a token carrying ${{ … }} or a shell expansion' +
        ' is a variable, everything else is a literal and renders in full under the heading above.',
    );
  }
  const kindLines = changeKindLines(paths, resolveInvocation);
  if (kindLines.length) {
    console.log('\nConvention-triggered gates (this change KIND moves them; no path derivation can name them):');
    for (const line of kindLines) console.log(line);
  }

  // ABOVE the reconciliation and BELOW the two per-card sections, because its
  // commands are inside that total and its rows are not about this card's
  // paths. Its own heading is the whole point: the same rows on every card,
  // said to be the same rows on every card (#14189).
  const alwaysRunsOut = alwaysRunsPopulationLines(alwaysRunsRows);
  if (alwaysRunsOut.length) {
    console.log('');
    for (const line of alwaysRunsOut) console.log(line);
  }

  // Directly BELOW the last section that feeds it, and above everything the
  // total deliberately excludes. Placed at the top it would state a figure
  // before the sections it reconciles had been printed; placed under the
  // residue it would sit past the point a harvesting consumer stops reading.
  // Here it closes the runnable answer and the section boundary is the claim.
  console.log('');
  for (const line of familyReconciliationLines(recon)) console.log(line);

  // Directly BELOW that total and above everything else it excludes (#14880).
  // The placement IS the claim: the reconciliation line closes the runnable
  // answer, and every section under it names something outside the answer. This
  // one names the families no path can ever move — printed on every run, not
  // only under `--residue`, because a dev reading a dispatch brief is never
  // told to pass that flag and both measured CI reds on this card were carried
  // by families of exactly this shape.
  const rosterOut = artifactRosterLines(rosters);
  if (rosterOut.length) {
    console.log('');
    for (const line of rosterOut) console.log(line);
  }

  // BELOW the reconciliation for the reason the roster block is: every section
  // under that total names something outside this card's runnable answer, and
  // these commands are outside it by construction (#15341). Printed on EVERY
  // run and not only under `--residue`, for the reason the roster block states
  // and this card measured twice over: a dev reading a dispatch brief is never
  // told to pass that flag, and a gate nobody is told about is the whole defect.
  const wideOut = widePopulationLines(widePopulationRows);
  if (wideOut.length) {
    console.log('');
    for (const line of wideOut) console.log(line);
  }

  const pendingOut = pendingChangesetLines(pending);
  if (pendingOut.length) {
    console.log('');
    for (const line of pendingOut) console.log(line);
  }

  if (showResidue) {
    const listing = (title, entries, withHints) => {
      console.log(`\n${title}: ${entries.length} famil(ies).`);
      for (const [check, entry] of [...entries].sort()) {
        // The per-hint dead annotation (#13312): a literal that reaches
        // nothing tracked is marked where it is SHOWN and counted where it is
        // not, so a live baseline can no longer walk its dead siblings past
        // the reader unlabelled.
        const deadRow = withHints ? sweep.byCheck.get(check) : null;
        const names = withHints && entry.hints.length
          ? `   names: ${residueNames(entry.hints, deadRow ? new Set(deadRow.dead.map((d) => d.hint)) : null)}`
          : '';
        console.log(`  - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]${names}`);
        if (deadRow) console.log(deadNamesNote(deadRow));
        // The gate's own account of why it names nothing (#10542), printed
        // against the family rather than only counted in the residue: a reader
        // looking at this listing is deciding whether to go READ the gate, and
        // that is exactly the decision this declaration answers.
        if (entry.noPopulationReason) {
          // A refused declaration prints as REFUSED rather than as the reason
          // it was cut down to (#18422) — the shape `alwaysRunsPopulationLines`
          // already takes for the two channels that have a refusal function,
          // and for the reason its docblock states: a declaration dropped, or
          // rendered as though it were whole, is the silent direction.
          const cutWhy = populationReasonCutRefusal(entry, 'no-path-population');
          console.log(cutWhy
            ? `      ↳ ⚠ declared no path population — REFUSED — ${cutWhy}`
            : `      ↳ declared no path population — ${entry.noPopulationReason}`);
        }
        // The silence split (#10784): a family that declared only ARTIFACTS
        // said the same words in this listing as one that really does not read
        // your file. The note says which, and raises its voice only where the
        // roster was taken from a directory the card edits.
        const roster = withHints ? artifactOnlySilence(entry, paths, tree) : null;
        if (roster) for (const line of artifactOnlyNote(roster)) console.log(line);
      }
    };
    listing('Undetermined (source names no path at all — NOT known irrelevant)', undetermined, false);
    listing('Silent (source names paths, none of which cover yours — the weakest verdict)', silent, true);
  }

  // The unreachable listing prints on EVERY run, not only under --residue. It
  // is the one part of the residue that is not about the card's paths at all,
  // and the flag that used to hide it is one no dispatch brief tells anyone to
  // pass — see `unreachableLines` for the CI failure that made that concrete.
  console.log('');
  for (const line of unreachableLines(unreachable, swept.length)) console.log(line);

  // The path-scheduled CI jobs (#16285), printed on EVERY run for the reason
  // the unreachable listing and the always-runs tail are: neither is about the
  // card's paths at all and both print unconditionally, while THIS one is about
  // the card's paths and is the block whose absence was measured — a truthful
  // "N derived, N run, 0 NOT-MEASURED" report standing for three hours beside a
  // red gate in the very package the card edited. Directly ABOVE the always-runs
  // tail because the two are the halves of ONE partition — the tail reads the
  // jobs CI cannot narrow by path, this reads the jobs your paths narrow it TO
  // — and a reader meeting one without the other has half the account.
  const jobFilteredOut = jobFilteredStepLines(jobFiltered.rows, jobFiltered.counts);
  if (jobFilteredOut.length) {
    console.log('');
    for (const line of jobFilteredOut) console.log(line);
  }

  // The type-check lanes (#19172), directly above the tail because the tail is
  // where these steps otherwise dissolve: one row among thirty-three, unnamed
  // and unclassified by contract. The heading IS the repair — the rows were
  // never missing, the name was.
  console.log('');
  for (const line of typeCheckLaneLines(typeCheckLanes.rows, typeCheckLanes.counts)) console.log(line);

  // The always-runs tail prints on every run for the same reason and with the
  // same standing: it is not about the card's paths either, and the family list
  // above provably does not cover it (#13333). Above the residue rather than
  // below it, because the residue's closing line tells the reader the
  // derivation is complete, and this is the part that is not.
  console.log('');
  {
    const { rows, counts } = alwaysRunSteps(workflowEntries);
    for (const line of alwaysRunLines(rows, counts)) console.log(line);
  }

  console.log('');
  for (const line of residueLines({
    discovered: byCheck.size,
    matched: matched.size,
    undetermined: undetermined.length,
    silent: silent.length,
    alwaysRuns: alwaysRuns.length,
    widePopulation: widePopulation.length,
    // Neither declaration reaches them: no workflow `paths:` trigger AND no job
    // `if:` that resolves to a paths-filter population (#12956). Counting only
    // the first would keep printing 'no path derivation can narrow them' about
    // families this run just narrowed.
    unfiltered: [...byCheck.values()].filter(
      (e) => e.triggers.length === 0 && (e.jobFilters?.length ?? 0) === 0,
    ).length,
    unreachable: unreachable.length,
    swept: swept.length,
    artifactRosters: rosters.length,
    invertedRosters: rosters.filter((r) => r.coversYourPath).length,
    documentedNoPopulation: undetermined.filter(([, e]) => e.noPopulationReason).length,
  })) {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// The change set, derived HERE rather than by the caller (#9320)
// ---------------------------------------------------------------------------

/**
 * The base ref the change set is measured against, assembled from two
 * UNSLASHED halves on purpose.
 *
 * `extractWatchHints` reads any quoted span that looks pathy, and "looks pathy"
 * is "contains a slash". A module-body constant spelling the ref whole would
 * therefore enter this file's own hint set as a path — a hint no repo path can
 * ever reach, but a fabricated entry in the column reserved for real reads, in
 * the one file whose header argues against exactly that. Neither half below
 * carries a slash, so the joined value exists only at runtime. Same reasoning
 * as the unquoting convention in the gate file next door; see its header.
 */
export const DEFAULT_BASE_REMOTE = 'origin';
export const DEFAULT_BASE_BRANCH = 'main';
export const DEFAULT_BASE_REF = `${DEFAULT_BASE_REMOTE}/${DEFAULT_BASE_BRANCH}`;

function runGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`could not run git — ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: (r.stderr ?? '').trim() };
}

function gitLines(args, cwd) {
  const r = runGit(args, cwd);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed — ${r.stderr || `exit ${r.status}`}`);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * The paths this branch actually changes, from the MERGE BASE (#9320).
 *
 * ## Why the caller no longer supplies this list
 *
 * Every dispatch brief tells a dev to re-derive the gate union from the paths
 * it really changed, and the obvious way to produce that list is the two-dot
 * range `<base>..HEAD`. Two-dot means "reachable from HEAD but not from the
 * base AS IT IS NOW", so on a branch cut an hour ago every sibling PR that
 * landed on the base since the cut is attributed to your diff. Measured on
 * PR #9312: three sibling PRs' files, on a branch hours old, in a repo that
 * merges ~18 times a working day.
 *
 * The failure is silent and it fails toward looking diligent — over-derivation
 * runs MORE gates than the change needs, so it stays green and nothing
 * complains. What it corrupts is the record: this repo's review posture is
 * "the dev states which gates it ran, and the PM reads that list", and a list
 * inflated by other people's files makes that statement untrue in a direction
 * nobody checks.
 *
 * A warning in the docs cannot close that, because the wrong list is produced
 * OUTSIDE this tool by whoever typed the range. So the tool computes it, and
 * the range it uses is not a caller's to get wrong. The explicit-path form is
 * untouched and is still the PM's form: at dispatch time the card's file
 * surface is a HYPOTHESIS about files that do not exist yet, and no git range
 * can answer that. Derivation is what the no-path invocation means, never an
 * override of paths that were passed.
 *
 * ## Why it refuses instead of falling back (the shallow boundary)
 *
 * Measured on a shallow checkout whose true base sits below the graft point:
 * `git merge-base` exits 1 with EMPTY output and the three-dot diff exits 128
 * (`no merge base`) — it fails loudly, it does not return a wrong base. The
 * two-dot form in the same checkout exits 0 and prints the inflated list. So
 * the honest reading of the shallow hazard is the reverse of the intuitive
 * one: the merge-base form cannot lie here, only refuse, and the fallback a
 * refusal tempts you into is the exact defect this function exists to remove.
 * Hence no fallback, and an error that names the deepen remedy instead.
 *
 * Uncommitted and untracked files are included: a dev who re-derives before
 * committing would otherwise get a SHORT list, and under-derivation is the one
 * failure direction the original defect did not have.
 */
export function changedPathsFromGit({ cwd = ROOT, base = DEFAULT_BASE_REF } = {}) {
  const inside = runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    throw new Error(`not inside a git work tree (${cwd}) — pass explicit paths instead`);
  }

  const baseSha = runGit(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], cwd).stdout.trim();
  if (!baseSha) {
    throw new Error(
      `base ref '${base}' does not resolve in this checkout — fetch it first ` +
        `(git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}), or pass explicit paths.`,
    );
  }

  const mb = runGit(['merge-base', base, 'HEAD'], cwd);
  const mergeBase = mb.stdout.trim();
  if (mb.status !== 0 || !mergeBase) {
    const shallow = runGit(['rev-parse', '--is-shallow-repository'], cwd).stdout.trim() === 'true';
    throw new Error(
      `no merge base between '${base}' and HEAD${shallow ? ' — this checkout is SHALLOW, so the branch point is very likely below the graft' : ''}. ` +
        (shallow
          ? `Deepen it (git fetch --unshallow ${DEFAULT_BASE_REMOTE}, or git fetch --deepen=200 ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}) and re-run. `
          : '') +
        `Refusing to fall back to the two-dot range: it exits 0 here and would attribute other PRs' landed files to this branch (#9320).`,
    );
  }

  // --no-renames so a moved file contributes BOTH names. Rename detection
  // prints only the new one, and a gate watching the old directory is exactly
  // as implicated by the move as one watching the new.
  const committed = gitLines(['diff', '--name-only', '--no-renames', mergeBase, 'HEAD'], cwd);
  const worktree = gitLines(['diff', '--name-only', '--no-renames', 'HEAD'], cwd);
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard'], cwd);

  const paths = [...new Set([...committed, ...worktree, ...untracked])].sort();
  const size = changedLinesFromGit({ cwd, mergeBase, untracked });
  return { paths, base, baseSha, mergeBase, counts: { committed: committed.length, worktree: worktree.length, untracked: untracked.length }, size };
}

/**
 * The changed-line count of the same change set (the 2026-09-18 human-merge
 * line threshold, `HUMAN_MERGE_LINE_THRESHOLD` in check-governed-merges.mjs):
 * `git diff --numstat --no-renames <merge-base>` against the WORKING TREE, so
 * committed and uncommitted edits to tracked files count in one read, plus
 * every untracked file counted from disk — under-derivation is the one
 * failure direction the path derivation above refuses, and the size follows
 * it. A binary file (a NUL in its first 8000 bytes, git's own heuristic) is a
 * file and 0 lines, as GitHub counts it. An untracked file that cannot be read
 * is counted as 0 lines and NAMED in the reading rather than crashing the
 * derivation. Throws on a `--numstat` that does not read: an unanswered size
 * is never a size of zero.
 */
export function changedLinesFromGit({ cwd = ROOT, mergeBase, untracked = null }) {
  const tracked = runGit(['diff', '--numstat', '--no-renames', mergeBase], cwd);
  if (tracked.status !== 0) {
    throw new Error(`git diff --numstat ${mergeBase.slice(0, 9)} failed — ${tracked.stderr || `exit ${tracked.status}`}; the changed-line count cannot be answered, and an unanswered count is never zero`);
  }
  const counted = parseNumstat(tracked.stdout);
  const others = untracked ?? gitLines(['ls-files', '--others', '--exclude-standard'], cwd);
  let untrackedLines = 0;
  let untrackedBinary = 0;
  let unreadable = 0;
  for (const rel of others) {
    let bytes;
    try {
      bytes = readFileSync(nodePath.join(cwd, rel));
    } catch {
      unreadable += 1;
      continue;
    }
    const n = lineCountOf(bytes);
    if (n === null) untrackedBinary += 1;
    else untrackedLines += n;
  }
  return {
    additions: counted.additions + untrackedLines,
    deletions: counted.deletions,
    files: counted.files + others.length,
    binaryFiles: counted.binaryFiles + untrackedBinary,
    untrackedFiles: others.length,
    unreadableFiles: unreadable,
    source: 'git diff --numstat off the merge base against the working tree, plus untracked files counted from disk',
  };
}

/** Lines in a buffer as GitHub would count a NEW file: null for binary (a NUL in the first 8000 bytes). Pure. */
export function lineCountOf(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''), 'utf8');
  if (buf.subarray(0, 8000).includes(0)) return null;
  if (buf.length === 0) return 0;
  let n = 0;
  for (const b of buf) if (b === 10) n += 1;
  if (buf[buf.length - 1] !== 10) n += 1;
  return n;
}

/**
 * Provenance for a derived run, on STDERR.
 *
 * `--tier` output is pasted verbatim into a claim comment, so stdout has to
 * stay the answer and nothing else. The reader still needs to know which range
 * produced the list — a derived run that looked identical to an explicit-path
 * run would just move the unverifiable claim one level up.
 */
export function derivationProvenance({ paths, base, mergeBase, counts, size = null }) {
  const sized = sizeVerdict(size);
  const sizeLine = sized.measured
    ? [
        `  changed lines: ${sized.changedLines} (+${sized.additions} / -${sized.deletions}; ${size.files} file(s), ${size.binaryFiles} binary counted 0,` +
          ` ${size.untrackedFiles} untracked counted from disk${size.unreadableFiles ? `, ${size.unreadableFiles} unreadable counted 0` : ''})` +
          ` vs the human-merge threshold ${sized.threshold}: ${sized.exceeds ? 'OVER — see the Changed-lines line on stdout' : 'under'}`,
      ]
    : [];
  return [
    `dispatch-gates: change set derived from git — ${paths.length} path(s) vs merge base ${mergeBase.slice(0, 9)} of '${base}' and HEAD`,
    `  (committed ${counts.committed}, working tree ${counts.worktree}, untracked ${counts.untracked}; three-dot semantics, never '${base}..HEAD')`,
    ...sizeLine,
    ...paths.map((p) => `  · ${p}`),
  ];
}

// ---------------------------------------------------------------------------
// WHOSE repo is this answer about? — the cross-repo guard
// ---------------------------------------------------------------------------

/**
 * This tool exists in ONE repo and answers about the tree it is run in.
 *
 * ## The measured failure
 *
 * The gate inventory is derived from the workflows and check scripts of
 * whatever checkout the process happens to sit in. That is the whole design and
 * it is right — but the answer never said so. A seat dispatching a card that
 * lands in a SISTER repo (which has no copy of this script at all: no
 * `scripts/pm` directory, nothing to run) ran it from this checkout with that
 * card's paths and got back a confident, well-formed, entirely wrong answer:
 * 121 families across 26 workflow files, three matched, a residue breakdown —
 * every number real, and every number about the WRONG repo. Exit 0. The only
 * tell was incidental: a family name and a package name the other repo does not
 * have, noticed by accident rather than by the tooling.
 *
 * The correct list for that card had to be hand-derived, and it differed
 * substantially — the load-bearing family in it was one this checkout's run
 * never mentions. So the failure is not "slightly off": it is the exact shape
 * the derive-don't-recall contract exists to remove, one level up. A dev is
 * handed families that do not exist in its repo and is missing the ones that
 * do; it runs what it was told, reports those green, and the real gates are
 * first exercised in CI.
 *
 * ## What can be detected honestly, and what cannot
 *
 * The paths a caller passes are REPO-RELATIVE, and the explicit-path mode is
 * documented as a hypothesis about files that may not exist yet. So a path's
 * home repo is not recoverable from its shape, and existence in this checkout
 * is a WEAK signal in both directions — the measured failure used `package.json`
 * and the lockfile, which every repo in the family has. Guessing a repo from a
 * path would fabricate the same kind of confident wrong answer one layer down.
 *
 * What is honestly available is two things, and this guard is exactly those:
 *
 *   BANNER      Every derivation says, as its FIRST line, which repo's tree
 *               produced it, at which commit. Unconditional, so the seat cannot
 *               be reading an answer without reading whose answer it is. It
 *               costs nothing and it closes "no tell" — which was the defect.
 *   ASSERTION   `--repo <owner>/<name>` states which repo the answer must be
 *               about. It is checked against this checkout's own `origin`
 *               remote and a mismatch REFUSES, naming both repos. A caller that
 *               knows the answer it needs can now demand the tool prove it.
 *
 * Refusal, not a warning, for the assertion half: a warning is the failure mode
 * already measured one level up — output that reads as an answer while being
 * about the wrong tree. A caller that spelled `--repo` has stated a
 * requirement, and a requirement the tool cannot meet is an error. The banner
 * half is unconditional precisely because it cannot refuse: with no assertion
 * there is nothing to contradict, and refusing every explicit-path run would
 * break the mode the PM uses on every dispatch.
 *
 * ## Why the banner goes to STDERR
 *
 * Not to hide it — it is printed first and it is a full sentence. Stdout is
 * contractually the ANSWER and nothing else, because both modes' stdout gets
 * pasted verbatim (the tier verdict into a claim comment, the gate list into a
 * dispatch prompt). A provenance line on stdout would travel into those
 * artifacts as though it were part of the answer, and the derived-change-set
 * provenance next door already made this call for the same reason.
 *
 * ## What this guard deliberately does NOT do
 *
 * It does not point the derivation at another checkout. `--repo` asserts, it
 * never retargets — and it refuses a value shaped like a filesystem path so
 * that the misreading fails loudly instead of being taken as a repo name.
 * Deriving another repo's gates would be new cross-repo capability, and no
 * second-repo consumer for it exists yet: the sister repos hold no copy of this
 * script and their seats hand-derive. When one does exist it gets its own flag,
 * whose value is a checkout, and the two meanings stay apart.
 */

/** The assertion flag. Leading dashes keep it out of this file's own hint set. */
export const REPO_FLAG = '--repo';

/**
 * The run-record flag (#13774). Same spelling rule as the assertion above: the
 * leading dashes keep it out of this file's own hint set, and its VALUE is a
 * path this tool reads at runtime rather than a literal it declares.
 */
export const RAN_FLAG = '--ran';

/**
 * `<owner>/<name>` out of a git remote URL, or null when it is not recoverable.
 *
 * Both spellings git writes end in the same two segments — the URL form and the
 * SCP-like form differ only in the separator before the owner, so splitting on
 * both separators and taking the last two is one rule for both. A value that
 * does not end in two plain name segments returns null rather than a guess: an
 * unrecognised remote must read as "unknown", never as a repo identity, because
 * the assertion below treats unknown as unverifiable and refuses.
 */
export function parseRepoSlug(remoteUrl) {
  const raw = String(remoteUrl ?? '').trim();
  if (!raw) return null;
  const segments = raw
    .replace(/\?.*$/, '')
    .replace(/[/\\]+$/, '')
    .replace(/\.git$/i, '')
    .split(/[:/\\]+/)
    .filter(Boolean);
  if (segments.length < 2) return null;
  const [owner, name] = segments.slice(-2);
  if (!isPlainRepoSegment(owner) || !isPlainRepoSegment(name)) return null;
  return `${owner}/${name}`;
}

/** A repo/owner name segment: word characters, dots and dashes — never all dots. */
function isPlainRepoSegment(segment) {
  return /^[\w.-]+$/.test(segment) && /[^.]/.test(segment);
}

/**
 * Who this checkout is, measured — never assumed and never hardcoded.
 *
 * Every field is independently optional. A tree with no readable `origin`
 * remote is a real state (a fresh clone-less checkout, a mirror with a
 * differently-named remote), and it must degrade to "unverified" rather than
 * throw: the banner still has a directory and a commit to name, and only the
 * assertion — which needs an identity to compare against — refuses.
 */
export function repoIdentity({ cwd = ROOT } = {}) {
  const read = (args) => {
    try {
      const r = runGit(args, cwd);
      return r.status === 0 ? r.stdout.trim() : null;
    } catch {
      return null; // git itself unavailable — the banner degrades, it never throws
    }
  };
  const root = read(['rev-parse', '--show-toplevel']);
  const head = read(['rev-parse', '--short', 'HEAD']);
  const remote = read(['remote', 'get-url', DEFAULT_BASE_REMOTE]);
  return { root: root ?? cwd, head, remote, slug: remote ? parseRepoSlug(remote) : null };
}

/**
 * The files a derivation's ANSWER is made of — the ones whose staleness can
 * change it. The gate inventory is read from the workflow files, `check:*` is
 * resolved through the manifest, and the checks themselves live under
 * `scripts/`. Everything else in the tree can be arbitrarily old without moving
 * a single family, which is what makes this list the right filter and raw
 * commit distance the wrong one.
 */
export const DERIVATION_SURFACE = ['.github/workflows', '.github/actions', 'package.json', 'scripts'];

/**
 * How far behind `DEFAULT_BASE_REF` this checkout is — and whether that matters.
 *
 * `bannerLines` already names the commit an answer came from, which is the very
 * fact that exposes a stale checkout — but it prints it in the same spelling a
 * current checkout uses, so staleness arrives dressed as ordinary provenance.
 * The measured failure: a long-lived shared checkout drifted far enough back
 * that its on-disk copy of a check script predated a PR that had changed that
 * exact file, and a run from it printed a well-formed verdict, exit 0, about a
 * tree nobody is on. Nothing in the tool, the output or the workflow said so.
 *
 * Commit distance ALONE would be the wrong instrument. A dev worktree falls a
 * few commits behind within the hour by construction, so a warning keyed on
 * distance fires on nearly every honest run and stops being read — and a
 * warning nobody reads reproduces the silence it was added to break. What
 * decides whether the distance matters is narrower and just as cheap to ask:
 * did anything in `DERIVATION_SURFACE` change across that range? So both are
 * measured, and only the second one shouts.
 *
 * That second question is asked with a THREE-dot diff, which is the whole
 * difference between reporting upstream work this tree is missing and
 * reporting the caller's own edits back to them. A dev worktree that is a few
 * commits behind AND has edited a check script is the ordinary case, and a
 * two-dot diff would name that dev's own file as evidence the tree is stale.
 *
 * The count is a LOWER BOUND and says so. `DEFAULT_BASE_REF` is a LOCAL
 * remote-tracking ref that only a fetch moves, so a checkout nobody fetches is
 * measured against a base that is itself behind. Unfetched staleness can only
 * make the true number bigger, never smaller — which is what lets this stay
 * honest without the derivation reaching for the network.
 *
 * The CHANGED SET inherits that lower-bound property, and for a while nothing
 * said so (#13392). `changed` is diffed against the same possibly-stale
 * snapshot the count is, so files-changed-vs-upstream is a SUPERSET of what
 * this reads: an empty `changed` means "nothing changed that THIS SNAPSHOT can
 * see", never "nothing changed". The measured failure sat exactly in that gap:
 * a run whose snapshot was at most ~13 minutes old read `behind: 1, changed:
 * []` — exact for its visible range — and rendered it as "nothing this answer
 * derives from changed", while upstream landed four surface commits between
 * that reading and the CI run that consumed the answer, one of them carrying
 * the very family whose absence turned CI red. At this repo's landing cadence
 * (a merge-queue landing every few minutes) NO local instrument can earn the
 * unqualified sentence — not even a freshness check on the snapshot, because
 * fresh-at-derivation is not true-at-consumption. So `driftLines` scopes the
 * quiet sentence to the visible range and states the remainder as untellable,
 * rather than gating a reassurance on a freshness reading this function cannot
 * take honestly.
 *
 * Every field degrades to null rather than throwing. No base ref, a shallow
 * clone and no git at all are real states, and none of them is an error here.
 * They are not a NON-EVENT either: `driftLines` renders EVERY degraded field as
 * a stated refusal to measure rather than as the silence a level tree gets, so
 * degrading here costs the caller a reading and never costs it the news.
 *
 * "Every" is load-bearing and was once only "the base ref". This function
 * degrades in THREE places — `base` when the ref does not resolve, `behind`
 * when the ref resolves and the COUNT cannot be read, and `changed` when the
 * count reads and the DIFF does not — and none is a corner of another: a
 * shallow clone reads a distance fine (measured: `--depth=1`, before and after
 * the upstream moves), while an unborn HEAD makes `rev-list --count` fail with
 * a resolvable ref in hand, and that same shallow clone, one shallow fetch
 * later, counts a distance of 1 while `HEAD...ref` dies with `no merge base`
 * (measured, exit 128) because the boundary cut the history the three-dot form
 * needs. The third door used to collapse into `changed: []` — a FAILED read
 * rendered as the quiet visible-range-clear sentence, the least earned
 * reassurance of all (#13392) — so `changed` is now `null` when the diff was
 * not read, and only an ARRAY when it was. `unmeasuredDrift` below is the
 * single predicate all three degraded fields are read through.
 */
export function baseDrift({ cwd = ROOT } = {}) {
  const read = (args) => {
    try {
      const r = runGit(args, cwd);
      return r.status === 0 ? r.stdout.trim() : null;
    } catch {
      return null; // git itself unavailable — the banner degrades, it never throws
    }
  };
  const base = read(['rev-parse', '--short', DEFAULT_BASE_REF]);
  if (base === null) return { base: null, behind: null, changed: null, headDate: null, baseDate: null };
  const counted = read(['rev-list', '--count', `HEAD..${DEFAULT_BASE_REF}`]);
  const behind = /^\d+$/.test(counted ?? '') ? Number(counted) : null;
  // At `behind: 0` the empty set is exact BY CONSTRUCTION — an empty commit
  // range moves no files — so it is a reading without running the diff. With
  // no distance in hand there is no range to read, so `changed` is unread too.
  const names = behind ? read(['diff', '--name-only', `HEAD...${DEFAULT_BASE_REF}`, '--', ...DERIVATION_SURFACE]) : behind === 0 ? '' : null;
  return {
    base,
    behind,
    // `null` = the diff was NOT read (a failed read is not an empty one);
    // an array — even empty — = the diff ran and this is what it said.
    changed: names === null ? null : names.split('\n').filter(Boolean),
    headDate: read(['log', '-1', '--format=%cI', 'HEAD']),
    baseDate: read(['log', '-1', '--format=%cI', DEFAULT_BASE_REF]),
  };
}

/**
 * WHICH step of the measurement failed — or `null` when a reading was taken,
 * whatever its value.
 *
 * `baseDrift` has THREE doors to "no reading was taken", and to a reader they
 * are one state. The base ref may not resolve (`base: null` — a fresh
 * checkout, a clone nobody fetched, a graft), the ref may resolve and the
 * DISTANCE from it be unreadable (`behind: null`): `rev-list --count` fails on
 * an unborn HEAD, which an ordinary fully-fetched clone reaches with one
 * ordinary command, and also on a git that dies mid-run or a count that comes
 * back non-numeric — or the distance may read and the CHANGED SET not
 * (`changed: null`): the three-dot diff needs a merge base the checkout may
 * not hold, which a shallow clone reaches with one shallow fetch.
 *
 * The second door used to fall through to `!drift.behind` and render
 * byte-identically to `behind: 0` — the same collapse the first door was fixed
 * for, one step further along, and the WORSE of the two to be silent about: a
 * base ref that resolves is precisely what makes a reader believe a measurement
 * happened, so the reassurance is stronger while the ground under it is the
 * same absent reading.
 *
 * They share one predicate rather than a hand-written branch each because the
 * sentence they produce differs only in WHICH step failed. A second branch is a
 * second place to keep the "Not zero", the least-trustworthy warning and the
 * remedy in sync, and the whole defect being fixed here is that the first
 * branch was written for one door while the producing side had two.
 *
 * The reading test is `Number.isFinite`, not `!== null`: absent, `NaN` and
 * non-numeric are not readings either, and the only direction this can move a
 * case is from silence toward speech — `behind: 0` IS a reading, and stays
 * silent below.
 */
function unmeasuredDrift(drift) {
  const distanceUnknown = `This tree's distance from ${DEFAULT_BASE_REF} is UNKNOWN. Not zero: no reading was taken.`;
  if (drift.base === null) {
    return {
      what: `${DEFAULT_BASE_REF} does not resolve in this checkout`,
      unknown: distanceUnknown,
      how: 'A fresh checkout, a clone nobody fetched or a graft all reach here.',
      fix: `Run 'git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}' and derive again for a reading.`,
    };
  }
  if (!Number.isFinite(drift.behind)) {
    return {
      what: `${DEFAULT_BASE_REF} resolves here (${drift.base}), but counting from HEAD to it failed`,
      unknown: distanceUnknown,
      how: `An unborn HEAD — 'git checkout --orphan', or a ref fetched into a repo holding no commit of its own — a git that died mid-run, or a non-numeric count all reach here.`,
      fix: `Run 'git rev-list --count HEAD..${DEFAULT_BASE_REF}' here to see which, then derive again for a reading.`,
    };
  }
  // The THIRD door (#13392): the ref resolves, the distance reads, and the diff
  // that names WHICH files moved across it does not. This is the least safe of
  // the three to be silent about, because it used to collapse into
  // `changed: []` and render as the quiet visible-range-clear sentence — a
  // reassurance manufactured from a failed read. It is a state of ordinary
  // working checkouts, not of broken ones: a shallow clone plus one shallow
  // fetch counts a distance fine and has no merge base for the three-dot form
  // (measured — and this fleet's containers clone shallow).
  if (!Array.isArray(drift.changed)) {
    return {
      what: `${DEFAULT_BASE_REF} resolves here (${drift.base}) and HEAD counts at least ${drift.behind} commit(s) behind it, but reading WHICH files changed across that range failed`,
      unknown: `The changed set is UNKNOWN. Not empty: no reading was taken.`,
      how: `A shallow checkout holding no merge base — one shallow fetch after a '--depth' clone — or a git that died mid-run reach here.`,
      fix: `Run 'git diff --name-only HEAD...${DEFAULT_BASE_REF} -- ${DERIVATION_SURFACE.join(' ')}' here to see why, then derive again for a reading.`,
    };
  }
  return null;
}

/**
 * Render the drift. Loud when it can have changed the answer, scoped and
 * self-limiting when the VISIBLE range is clear, and SILENT at zero — the last
 * one for the same reason the banner has no "all paths present" twin: against
 * a base ref nobody refreshed, a clean bill of health is precisely the reading
 * the measured failure would have passed.
 *
 * The quiet branch used to be "quiet when it demonstrably cannot [have changed
 * the answer]", and that classification was measured false (#13392). It
 * printed "nothing this answer derives from changed across that range" from a
 * reading whose range ends at the last-fetched snapshot, and a reader takes
 * "that range" to reach upstream. On the incident run the snapshot was at most
 * ~13 minutes old and the visible reading exact — `behind: 1`, one off-surface
 * commit — yet by the time CI consumed the answer, upstream had landed four
 * derivation-surface commits the sentence had vouched could not exist, one
 * carrying the family whose absence turned CI red. The dev who read the line
 * did not ignore a warning; it COMPLIED with one. That is worse than the loud
 * case being missed: a false reassurance recruits the reader's trust against
 * them. And no local instrument fixes it — a freshness gate on the snapshot
 * would have called that base fresh and reassured anyway, because
 * fresh-at-derivation is not true-at-consumption against a queue that lands
 * every few minutes. So the quiet branch now states exactly what it measured
 * (the VISIBLE commits are surface-clear), states the half it cannot measure
 * as untellable rather than clear, and hands over the fetch. An "I cannot
 * tell" that is true beats a "nothing changed" that is sometimes false — the
 * sentence a reader can safely comply with is the only kind this tool may
 * print.
 *
 * That silence at zero is what makes the UNMEASURABLE case a defect rather
 * than a fourth flavour of quiet. `baseDrift` degrades a field to null in two
 * places — the base ref that will not resolve, and the distance that cannot be
 * counted from a ref that did — so `behind: null` ("no reading was taken") used
 * to render byte-identically to `behind: 0` ("a reading was taken, and it was
 * zero"): nothing at all, from a single `!drift.behind`. The reasoning above
 * defends withholding an ALL-CLEAR; it never defended withholding the fact that
 * no instrument was available. And the two states are not equally safe to be
 * silent about: unmeasured is precisely when the family list below is LEAST
 * trustworthy, because a gate that landed on the base branch after this tree
 * was cut cannot be seen from inside this tree, and here nothing can even say
 * how far back that is. So `unmeasuredDrift` speaks for BOTH doors, zero stays
 * silent, and a reader can finally tell them apart.
 *
 * The unmeasured sentence therefore names the step that failed rather than the
 * conclusion alone. "Not measured" plus a remedy for the wrong step is a lead
 * the reader cannot act on, and the two remedies do not overlap: a fetch buys a
 * base ref and buys nothing at all for a HEAD that has no commit.
 *
 * A drift of `null` — no measurement ATTACHED, because the caller never asked
 * for one — stays silent, deliberately and separately: reporting a missing
 * instrument to a reader who never reached for one would be the fabricated
 * lead this file's header prices as the expensive direction.
 */
export function driftLines(drift) {
  if (!drift) return [];
  const unmeasured = unmeasuredDrift(drift);
  if (unmeasured) {
    return [
      `  ⚠️  STALENESS NOT MEASURED — ${unmeasured.what}. ${unmeasured.unknown}`,
      `    ${unmeasured.how} An unmeasured tree is where the families below are LEAST trustworthy, not most. ${unmeasured.fix}`,
    ];
  }
  if (!drift.behind) return [];
  const { behind, base, changed, headDate, baseDate } = drift;
  const span = `HEAD${headDate ? ` ${headDate}` : ''} vs ${DEFAULT_BASE_REF} ${base}${baseDate ? ` ${baseDate}` : ''}`;
  if (changed.length === 0) {
    return [
      `  At least ${behind} commit(s) behind ${DEFAULT_BASE_REF}, and none of the commit(s) this tree can SEE touched what this answer derives from — ${span}.`,
      `    Whether UNSEEN upstream work did, this run cannot tell: the range above ends at ${DEFAULT_BASE_REF}, a LOCAL snapshot only a fetch moves — not at upstream. Run 'git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}' and derive again for the strongest reading a checkout can take.`,
    ];
  }
  return [
    `  ⚠️  STALE TREE — this answer is derived from a tree at least ${behind} commit(s) behind ${DEFAULT_BASE_REF}, and ${changed.length} file(s) it derives from CHANGED across that range.`,
    `    ${span}`,
    `    Stale here: ${changed.slice(0, 6).join(' ')}${changed.length > 6 ? ` … +${changed.length - 6} more` : ''}`,
    `    Those files ARE the families printed below, so this run read their old copies and still exited 0 — a well-formed answer about a tree nobody is on.`,
    `    "At least": ${DEFAULT_BASE_REF} is a LOCAL ref only a fetch moves. Run 'git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}' and derive again from a tree at ${DEFAULT_BASE_REF}.`,
  ];
}

/**
 * Every flag that takes a VALUE, and what that value is — the one table the
 * split below consults, so a flag added to it cannot be added to the parse
 * incorrectly.
 *
 * The hint is carried here rather than at the refusal site because the refusal
 * used to name the repo flag's value unconditionally. With one value-taking
 * flag that was merely redundant; with two it is a message that LIES about
 * which argument is wrong — the failure shape this file spends itself refusing,
 * in the sentence a caller reads when it is already confused.
 */
const VALUE_FLAGS = new Map([
  [REPO_FLAG, 'the repo this answer must be about, as an owner and a name'],
  [RAN_FLAG, 'the run record to reconcile against, as a readable file path'],
]);

/**
 * Split argv into paths, flags and the value-taking flags' values.
 *
 * A value must not fall through into the path list. The original parse took
 * every non-`--` argument as a path, so a two-token flag added without touching
 * it would have quietly derived gates for a repo NAME read as a file — a new
 * silent wrong answer inside the fix for a silent wrong answer. That prediction
 * came true the moment a SECOND value-taking flag was added, which is why the
 * table above exists and the loop below reads it rather than naming flags.
 * Both spellings are accepted because both get typed.
 */
export function splitArgv(argv) {
  const paths = [];
  const flags = [];
  const values = new Map([...VALUE_FLAGS.keys()].map((flag) => [flag, null]));
  let malformed = null;
  const needsValue = (flag) => {
    malformed = `${flag} needs a value — ${VALUE_FLAGS.get(flag)}`;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (values.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        needsValue(arg);
      } else {
        values.set(arg, value);
        i++;
      }
      continue;
    }
    const joined = [...values.keys()].find((flag) => arg.startsWith(`${flag}=`));
    if (joined) {
      const value = arg.slice(joined.length + 1);
      if (!value) needsValue(joined);
      else values.set(joined, value);
      continue;
    }
    if (arg.startsWith('-')) flags.push(arg);
    else paths.push(arg);
  }
  return { paths, flags, assertion: values.get(REPO_FLAG), runRecord: values.get(RAN_FLAG), malformed };
}

/**
 * Check an assertion against this checkout. `{ ok }` plus the lines to print.
 *
 * Every refusal names BOTH repos — the one asserted and the one this tree
 * actually is — because the whole defect was an answer that named neither.
 */
export function repoAssertionVerdict({ asserted, identity }) {
  const wanted = String(asserted ?? '').trim();
  const here = identity?.slug ?? null;
  // Normalised for COMPARISON only; every message quotes the value as typed.
  const normalized = /^[~.]|^\/|\\/.test(wanted) || wanted.split('/').filter(Boolean).length !== 2
    ? null
    : parseRepoSlug(wanted);

  if (!normalized) {
    return {
      ok: false,
      lines: [
        `dispatch-gates: ${REPO_FLAG} expects an owner and a repository name separated by a slash — got '${wanted}'.`,
        `  This flag ASSERTS which repo the answer must be about; it does not point the derivation at another checkout.`,
        `  Gate families are read from the tree this process runs in${here ? ` (${here})` : ''} and from no other.`,
      ],
    };
  }

  if (!here) {
    return {
      ok: false,
      lines: [
        `dispatch-gates: cannot verify ${REPO_FLAG} '${wanted}' — this checkout's '${DEFAULT_BASE_REMOTE}' remote is unreadable, so its repo identity is UNKNOWN.`,
        `  Refusing rather than assuming the assertion holds: an unverifiable assertion that passes is worth less than no assertion at all.`,
        `  Tree: ${identity?.root ?? 'unknown'}`,
      ],
    };
  }

  if (here.toLowerCase() !== normalized.toLowerCase()) {
    return {
      ok: false,
      lines: [
        `dispatch-gates: REFUSING — asked for '${wanted}', but this checkout is '${here}'.`,
        `  Gate families are derived from the workflows and check scripts of the tree this process runs in, so an answer from here is about '${here}' whatever paths you pass.`,
        `  Repo-relative paths cannot tell the two apart: the same manifest and lockfile names exist in both, which is why a run like this used to return a confident wrong answer instead of this message.`,
        `  Derive '${wanted}' from a checkout OF '${wanted}' — this script exists only in '${here}', so a sister repo's list is hand-derived from its own package manifest and its own workflow files.`,
        // The TIER half is the one question a sister slug CAN be answered from
        // here (`sisterRepoTierRun`), so the refusal says so instead of sending
        // a claim-time caller away to hand-write the line.
        ...(governedSisterRepo(wanted) === null
          ? []
          : [`  The TIER half alone needs no tree: \`--tier ${REPO_FLAG} ${wanted} <path> ...\` answers a governed sister repo from the path globs, and says so.`]),
        `  Tree: ${identity.root}`,
      ],
    };
  }

  return { ok: true, lines: [] };
}

/**
 * The declared paths that are not in this tree.
 *
 * ONE reading, shared by the banner line that counts them and the refusal that
 * ends the run over them, so the two can never name different sets — a refusal
 * listing paths the banner did not count (or the reverse) would put the reader
 * back where the defect started, guessing which line was about their argv.
 *
 * A glob is skipped rather than resolved: it names a PATTERN, not a file, so
 * `existsSync` on one is false for every glob ever passed and counting them as
 * absent would refuse every wildcard dispatch on a tree that holds the matches.
 */
export function absentDeclaredPaths({ identity, paths = [] }) {
  return paths.filter((p) => !p.includes('*') && !existsSync(nodePath.join(identity?.root ?? ROOT, p)));
}

/**
 * The absent-path refusal: an absent path with no `--repo` is NOT MEASURED.
 *
 * The banner alone reported the ambiguity and let the run continue at exit 0.
 * Measured: `--commands skills/objectui/SKILL.md AGENTS.md` (one sister-repo
 * path, one local one, no assertion) exited 0, derived THIS repo's families for
 * the local path and filed the sister-repo path under "apply once this card's
 * changeset exists" — the reading a dispatcher of a not-yet-written path wants,
 * and exactly the wrong one for a path that belongs to another repository. A
 * seat then wrote "it refuses objectui paths by design" into five dispatch
 * texts on the strength of that exit code.
 *
 * So the ambiguity refuses instead of resolving itself toward the harmless
 * reading. The exit is `EXIT_PREREQUISITE_NOT_MET` — this tool's existing NOT
 * MEASURED code — and ⛔ never the `2` a usage error and the wrong-repo refusal
 * carry: a caller that distinguishes them can tell "you asked me something I
 * cannot answer from here" from "that argv is wrong".
 *
 * Both resolving spellings are printed verbatim because the remedy is a copy,
 * not a deduction: assert THIS repo to get today's derivation back, or name the
 * repo the paths really belong to and be refused with both repos named.
 *
 * ⛔ Not reached when `asserted` is non-null: the wrong-repo refusal above runs
 * first and keeps its own exit 2 and its own text, so `--repo <other>` with an
 * absent path answers exactly as it did before this branch existed.
 */
export function absentPathVerdict({ asserted = null, identity, paths = [] }) {
  const missing = absentDeclaredPaths({ identity, paths });
  if (missing.length === 0 || asserted !== null) return { ok: true, missing: [], lines: [] };
  const here = identity?.slug ?? null;
  return {
    ok: false,
    missing,
    lines: [
      'dispatch-gates: NOT MEASURED — an absent path may be another repo\'s'
        + ` — assert ${REPO_FLAG} to derive as a not-yet-written path of THIS repo, or name the other repo to be refused.`,
      `  ${missing.length} of ${paths.length} named path(s) are absent, and no ${REPO_FLAG} says whose tree they are from: ${missing.join(' ')}`,
      '  Two readings, and nothing in a repo-relative path tells them apart. Pick one — copy a line:',
      here
        ? `    ${REPO_FLAG} ${here}   — they are paths of THIS repo that are not written yet; derive as before.`
        : `    ${REPO_FLAG} owner/this-repo   — UNVERIFIABLE from here: this checkout's '${DEFAULT_BASE_REMOTE}' remote could not be read, so an assertion cannot be checked either.`,
      `    ${REPO_FLAG} owner/the-other-repo   — they are another repo's; be refused with both repos named, from a checkout of that repo.`,
      `  (Exit ${EXIT_PREREQUISITE_NOT_MET} = NOT MEASURED, distinct from the 2 a usage error and the wrong-repo refusal carry.`
        + ' Capture it BEFORE any pipe.)',
      `  Tree: ${identity?.root ?? 'unknown'}`,
    ],
  };
}

/**
 * The provenance banner — the first thing every derivation prints.
 *
 * The unplaceable-path count is reported in ONE direction only. Paths missing
 * from this tree are expected for a card whose surface is not written yet, and
 * they are also what a wrong-repo run looks like, so the line says both and
 * claims neither. There is deliberately no "all paths present" line: that would
 * read as a clearance, and it is precisely the reading the measured failure
 * would have passed — its two paths exist in every repo in the family.
 *
 * The banner still only COUNTS. Ending the run over that count is
 * `absentPathVerdict`'s job, one caller down, so the banner stays printable in
 * every mode and the refusal stays one decision in one place.
 */
export function bannerLines({ identity, paths = [], drift = null }) {
  const at = identity?.head ? ` at commit ${identity.head}` : '';
  const who = identity?.slug
    ? `'${identity.slug}'${at} (${identity.root})`
    : `${identity?.root ?? 'this directory'}${at} — repo identity UNVERIFIED, its '${DEFAULT_BASE_REMOTE}' remote could not be read`;
  const lines = [
    `dispatch-gates: gate list derived from the tree of ${who}.`,
    `  Families are a property of THAT repo. A card landing in another repo derives nothing here — assert with ${REPO_FLAG} to make this checkable.`,
  ];
  lines.push(...driftLines(drift));
  const missing = absentDeclaredPaths({ identity, paths });
  if (missing.length > 0) {
    lines.push(
      `  ${missing.length} of ${paths.length} path(s) are absent from this tree: ${missing.slice(0, 6).join(' ')}${missing.length > 6 ? ' …' : ''}`,
      `  Expected for a surface not written yet — and also what a run against another repo's paths looks like. Not evidence either way.`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Self-test — extraction + matching over fixtures.
//
// The extraction and hint cases run over inline fixtures and touch no
// filesystem. The i18n change-kind cases deliberately do: that entry's whole
// content IS a walk of the real `packages/` tree, and a fixture-only test
// passes just as happily when the walk is rooted at the wrong directory or
// skips the wrong entries. So the pure judgments (filename test, owner
// derivation, containment) are pinned offline, and the walk is pinned against
// the tree, in both directions.
// ---------------------------------------------------------------------------

/**
 * Returned by `selfTest()` only after its verdict line is printed, and compared
 * at the dispatch: a `return` that leaves the function above that line prints
 * NOTHING and still exits 0, because the dispatch discarded the result. Measured
 * on this file before this guard existed: an early return took the run from
 * "1288 cases pass" to zero bytes of output and exit 0 — a self-test that never
 * finished, reported as one that passed.
 *
 * The mechanical probe in `scripts/measure-self-test-floor.mjs` READS this file
 * since #14963: its anchor is taken over a comment-and-literal MASK and must
 * begin a line, so it lands on the real definition below rather than on either
 * decoy ahead of it — that phrase quoted in a docblock, then a FIXTURE STRING.
 * Injected there the copy PARSES and RUNS (re-measured on the merge base of
 * this change: exit 1, `selfTest() returned without reaching its verdict`),
 * where the unmasked anchor could only ever produce a SyntaxError. The entry is
 * still hand-read in `ENTRY_BY_HAND` — four self-test-shaped names stand in raw
 * source — and the NOT MEASURED its row keeps is the probe's own artefact
 * (#15515: it writes the copy under `scripts/`, where a single-site sweep
 * refuses the near-duplicate), not a property of this file.
 */
/**
 * The lines ONE self-test case prints — a pure renderer, so both directions can
 * be pinned on fixtures instead of on a run that would have to fail to show the
 * second one (#15539).
 *
 * ## The defect
 *
 * `t` was declared with arity TWO and six call sites passed a THIRD argument
 * carrying the case's diagnostic reading — the hint count before and after an
 * ablation, the residual verdict, the extensionless roster's contents.
 * JavaScript dropped every one of them on the floor. Each of the six sits on a
 * case whose verdict is about the LIVE tree, so the day one goes red the person
 * triaging it gets the sentence and nothing else, while the author had already
 * written the reading they would need. Nothing reds over it and `pnpm lint` is
 * green over it, which is why it survived: the arity and the call sites
 * disagreed silently.
 *
 * ## Why the detail prints on the RED only
 *
 * A green case's line is the same byte string it has always been. That is
 * deliberate twice over: a passing run's log is what every reader has
 * calibrated on, and a reading appended to 1400-odd passing lines is noise that
 * teaches the reader to skim exactly where the six red lines will appear. The
 * reading is owed to whoever is triaging a failure, and that is where it goes.
 */
export function selfTestCaseLines(name, cond, detail = null) {
  const lines = [`  ${cond ? '✓' : '✗'} ${name}`];
  if (cond) return lines;
  if (detail === null || detail === undefined || detail === '') return lines;
  lines.push(`      ↳ reading: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  return lines;
}

export const SELF_TEST_VERDICT = 'dispatch-gates self-test reached its verdict';

/**
 * The self-test lives in `dispatch-gates.self-test.mjs` beside this file — imported by the
 * `--self-test` branch below and nowhere else, so importing this module runs no case. It drives
 * the exported derivation functions and the data rows; `SELF_TEST_VERDICT` above is the handshake
 * it must return, and `--fast` narrows it to the fast tier (see that file's header for the tiers).
 */

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * The entry guard, and the predicate under it, both live in
 * `scripts/invoked-as.mjs` — one implementation for all of `scripts/`.
 *
 * `invokedAs` is re-exported because this module's self-test drives it
 * directly, and because that export was this tree's first landing of the
 * two-comparison shape. The implementation moved; the export did not.
 *
 * Its failure direction is SILENT: an entry guard that wrongly answered
 * `false` would turn every mode of this tool into a no-op that prints nothing
 * and exits 0, and `check:pm-dispatch-gates` holds the child's exit STATUS
 * only (see that gate's header) — so the no-op would report as a pass.
 */
export { invokedAs };

const invokedDirectly = isEntrypoint(import.meta.url);

/**
 * The one usage line, printed on the derivation-failure path — and held to the
 * refusals the argv chain below really enforces (#15036).
 *
 * `--residue` used to sit OUTSIDE the alternation, which is the notation's way
 * of saying it combines with every member of it. Three of the four it really
 * does modify; the fourth it does not: `--tier --residue` exits 2 since
 * #14753, because `--tier` derives no gate family and so leaves `--residue`
 * nothing to list. A usage line that advertises a refused pair as legal costs
 * a reader a second's confusion at exactly the moment the tool has already
 * failed once — so the modifier moves INSIDE, attached to the three modes it
 * still modifies, and `--tier` stands alone as the alternative it is.
 *
 * ⛔ Deleting `[--residue]` instead would understate it — the flag really is
 * legal with the other three, and with the plain human rendering.
 *
 * `--changed` had the mirror-image problem: it sat OUTSIDE the alternation as
 * a whole-invocation alternative, which reads as excluding every member next
 * to it — `--commands`/`--json` included, though `--changed --commands` is
 * legal and answers (it derives the path list `<path> ...` would otherwise
 * supply, and nothing more). Moved to the position `<path> ...` occupies, the
 * other path source it stands in for, so the line no longer implies a refusal
 * the argv chain does not make (#14870).
 *
 * A CONSTANT rather than a literal at the print site, because the pin belongs
 * beside the refusals it mirrors: reaching the print site needs a checkout
 * where `changedPathsFromGit()` refuses, and a pin that cannot be run in the
 * self-test is not a pin.
 */
/**
 * The invariant half of the refusal `--changed` prints on a tree with NO diff.
 *
 * A CONSTANT for USAGE_LINE's reason and for one more that is this file's own
 * subject. The self-test's `--changed --commands` CONTROL has to tell that
 * refusal — which only the derivation can print — apart from an argv-parse
 * refusal, and BOTH exit 2. Matching a retyped copy of the sentence would pin
 * the case to a memory of the message rather than to the message, so the case
 * and the print site read the same constant (#15278).
 */
export const NO_DIFF_REFUSAL = 'changes nothing against';

export const USAGE_LINE =
  'usage: node scripts/pm/dispatch-gates.mjs'
  + ' [--tier | [--residue] [--commands | --json | --ran <file>]]'
  + ' [--repo owner/name] [<path> ... | --changed] | --self-test';

/**
 * Executed only as a CLI. Importing this module must have NO side effect.
 *
 * Everything above this line is exported — the two re-export blocks with their
 * stated rationales, and the derivation functions the self-test drives — and
 * none of it was reachable while this dispatch ran at module top level. An
 * `import { maskComments } from './dispatch-gates.mjs'` ran the TOOL against the
 * IMPORTER's argv and cwd, and on most paths reached `process.exit(2)` before
 * the importer's own first statement: measured here, a bare consumer printed
 * this tool's "nothing to derive" refusal and exited 2, its own `console.log`
 * never having run. On the other branch it is worse than an exit — a consumer
 * running its own `--self-test` fired all of THIS file's assertions inside it,
 * printing a second summary line and putting an unrelated file's failures on
 * the importer's exit code. That is the same defect PR #9897 fixed in
 * `check-governed-merges.mjs`, which carried 77 assertions at that PR; this
 * file carries it at more than ten times that many. That multiple is a FLOOR,
 * and it is written as one on purpose. The live figure is whatever
 * `--self-test` prints from `cases.length`; it moves on most edits to this
 * file, and over this file's history it has never once gone down — so a floor
 * stays true where a reading rots. A reading stood here before and had drifted
 * by more than a factor of three before anyone repaired it, so do not
 * "helpfully" refresh this back into one. A self-test is a mode of the file
 * being RUN, never a side effect of importing it, and a shared module that
 * exits on import is a shared module nobody can share.
 *
 * The guard is ONE site wrapping the whole chain, not a condition repeated per
 * branch: a branch added inside it later cannot forget to carry it.
 */
if (invokedDirectly) {
  const argv = splitArgv(process.argv.slice(2));
  const argvPaths = argv.paths;
  const wantsChanged = process.argv.includes('--changed');
  if (process.argv.includes('--self-test')) {
    // The battery is its own module, loaded here and nowhere else: `--fast` runs the fast tier
    // alone, anything else runs both tiers. Loaded WITHOUT a top-level await on purpose — that
    // module imports this one, so an `await` here would wait on a module that is waiting on this
    // one (an unsettled top-level await, exit 13, nothing printed). The continuation keeps the
    // handshake exactly as it was: the verdict constant, or exit 1 with the sentence below.
    const tier = process.argv.includes('--fast') && !process.argv.includes('--slow') ? 'fast' : 'full';
    import(new URL('./dispatch-gates.self-test.mjs', import.meta.url)).then(({ selfTest }) => {
      if (selfTest({ tier }) !== SELF_TEST_VERDICT) {
        console.error(
          '\n✗ dispatch-gates self-test: selfTest() returned without reaching its verdict,\n'
            + 'so no success line was printed. Exiting 0 here would report a self-test\n'
            + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
      }
    });
  } else if (argv.malformed) {
    console.error(`dispatch-gates: ${argv.malformed}.`);
    process.exit(2);
  } else if (argv.runRecord !== null && (process.argv.includes('--commands') || process.argv.includes('--json'))) {
    // The same rule as the pair below, and it is not a courtesy: `--ran` renders
    // a VERDICT on stdout and those two render the derivation, so blending them
    // would put prose in a stream whose caption promises commands.
    console.error(`dispatch-gates: ${RAN_FLAG} renders a verdict on stdout; --commands and --json render the derivation. Pass one.`);
    process.exit(2);
  } else if (argv.runRecord !== null && process.argv.includes('--tier')) {
    // `--tier` reads no workflow and no check script, so it derives no family —
    // there is nothing for a run record to be reconciled against, and answering
    // with the tier alone would silently drop the flag the caller passed.
    console.error(`dispatch-gates: --tier derives no gate family, so ${RAN_FLAG} would have nothing to reconcile against. Pass one.`);
    process.exit(2);
  } else if (process.argv.includes('--commands') && process.argv.includes('--json')) {
    // Two answers to "what shape is stdout" is no answer. Blending them — or
    // silently preferring one — is the class of failure this whole file is
    // about, and it would be a poor place to commit it: these two flags exist
    // because a consumer could not tell what it was reading. The rule is about
    // how many answers the stream carries, not about which two flags happened
    // to be named when it was written: `--tier` is a THIRD shape of that same
    // stdout, and it is refused against each of these two in the branch below.
    console.error('dispatch-gates: --commands and --json are two spellings of stdout — pass one.');
    process.exit(2);
  } else if (process.argv.includes('--tier') && (process.argv.includes('--commands') || process.argv.includes('--json'))) {
    // The third shape, and the one the pair above did not reach: `mode` was
    // computed from --commands/--json and then DISCARDED by the `--tier` branch
    // at the bottom of this block, so the tier PROSE landed in a stream whose
    // caption promises one runnable command per line, or one JSON document —
    // at exit 0, with nothing on either stream saying the flag had been
    // dropped. That is the silent preference the rule above forbids, committed
    // one flag over from where it is enforced.
    //
    // REFUSED, not re-routed. Sending the tier verdict to stderr whenever a
    // machine-readable mode is asked for is defensible — `--tier` answers a
    // different question and reads no tree — but it changes what `--tier`
    // MEANS when combined, and that is a design call for this file's owner,
    // not a repair to a silent-drop bug. Same shape as the two refusals above
    // it and the `--ran --tier` refusal above them: one line, exit 2, both
    // flags named so the caller never has to guess which one was dropped.
    //
    // Ordered AFTER the pair deliberately: `--tier --commands --json` keeps
    // the message it already had, so this branch adds a refusal and changes
    // none.
    console.error(
      `dispatch-gates: --tier and ${process.argv.includes('--commands') ? '--commands' : '--json'} are two spellings of stdout — pass one.`,
    );
    process.exit(2);
  } else if (process.argv.includes('--tier') && process.argv.includes('--residue')) {
    // The other axis, and the one neither pair above reaches: --residue is not
    // a spelling of stdout, it is a MODIFIER of the derivation — and it is read
    // in exactly ONE place, the `derive(...)` call at the bottom of this block.
    // The `--tier` branch beside that call never makes it, so under --tier the
    // flag was evaluated nowhere: exit 0, the tier verdict printed, and nothing
    // on either stream saying the flag had been dropped. Measured byte-identical
    // stdout with and without it — a reading that means nothing on its own, and
    // means this only because the CONTROL beside it shows the same flag growing
    // the derivation's own output by more than a factor of three when the
    // derivation actually runs.
    //
    // The ground is the `--ran --tier` refusal's, one flag over: --tier reads no
    // workflow and no check script, so it derives no gate family — the same
    // sentence that leaves a run record nothing to reconcile against leaves
    // --residue no residue to list.
    //
    // REFUSED, not re-routed, as the pairs above are. Nothing here is
    // load-bearing for a machine: --residue only ever ADDS accounting to a
    // human-read stream, so a dropped one costs a reader information, never a
    // parse. What it costs is a caller who typed a flag, got exit 0, and has no
    // way to learn the flag did nothing — the same information loss the
    // refusals above prevent, and refusing is the only remedy that does not
    // change what --tier MEANS when combined.
    //
    // Ordered AFTER the stdout-shape pair for the reason that branch states
    // about itself: `--tier --commands --residue` keeps the message it already
    // had, so this branch adds a refusal and rewords none.
    console.error('dispatch-gates: --tier derives no gate family, so --residue would have nothing to list. Pass one.');
    process.exit(2);
  } else if (wantsChanged && argvPaths.length > 0) {
    // The two input modes answer different questions and must never be blended:
    // silently preferring one would make the other's arguments vanish without a
    // word, which is the class of failure this whole file is about.
    console.error('dispatch-gates: --changed derives the paths itself — do not pass paths with it.');
    process.exit(2);
  } else {
    // Whose tree is about to answer? Printed BEFORE the answer and before the
    // change-set provenance, so no run of this tool can be read without reading
    // which repo it is about — the one thing the silent wrong answer never said.
    const identity = repoIdentity();
    // Resolved once, ABOVE the banner: every line the banner and the
    // provenance print goes to stderr in all three modes, so choosing the mode
    // here cannot change what stdout carries later.
    const mode = process.argv.includes('--json')
      ? 'json'
      : process.argv.includes('--commands')
        ? 'commands'
        : argv.runRecord !== null
          ? 'ran'
          : 'human';
    const declaredPaths = argvPaths.map((p) => p.replace(/^\.\//, ''));
    // A GOVERNED sister repo's tier verdict, answered BEFORE the banner: the
    // banner names the tree that produced a gate list, and this run derives
    // none — its provenance is the two glob tables, and the run prints that
    // itself. `null` for every other assertion (this repo, an unknown one, a
    // malformed one), which the assertion verdict below answers as before.
    const sisterTier = process.argv.includes('--tier') && argv.assertion !== null
      ? sisterRepoTierRun({ asserted: argv.assertion, paths: declaredPaths, identity })
      : null;
    if (sisterTier !== null) {
      for (const line of sisterTier.stderr) console.error(line);
      if (!sisterTier.ok) process.exit(2);
      for (const line of sisterTier.stdout) console.log(line);
      process.exit(0);
    }
    for (const line of bannerLines({ identity, paths: declaredPaths, drift: baseDrift() })) console.error(line);
    if (argv.assertion !== null) {
      // An assertion the tree contradicts is the measured failure, caught. It
      // ends the run: a caller that named the repo it needs has stated a
      // requirement, and this checkout cannot meet it by printing anyway.
      const verdict = repoAssertionVerdict({ asserted: argv.assertion, identity });
      if (!verdict.ok) {
        for (const line of verdict.lines) console.error(line);
        process.exit(2);
      }
      console.error(`  ${REPO_FLAG} '${argv.assertion}' checked against this checkout's '${DEFAULT_BASE_REMOTE}' remote — it holds.`);
    }
    // The third branch, at the point where the two facts above meet: paths the
    // banner just counted as absent, and no assertion to say whose tree they
    // are from. Reached only when `argv.assertion` is null — a wrong-repo
    // assertion already ended the run two lines up with its own exit 2, and a
    // satisfied one has just said so — so this refuses exactly the ambiguous
    // run and no other.
    //
    // Placed BEFORE every mode branch, not inside the derivation: `--tier`
    // reads no workflow and derives no family, but the assertion refusal above
    // it already ends a `--tier` run over another repo's slug, so the repo an
    // answer is about is ALREADY load-bearing there. Exempting `--tier` from
    // this half would resolve the same ambiguity silently toward the harmless
    // reading in the one mode a claim comment pastes from.
    //
    // ⛔ Only the paths NAMED on argv reach here. A `--changed` derivation
    // names paths read out of this tree's own diff, which is the one input that
    // cannot be another repo's, and the banner has never counted them either.
    if (argvPaths.length > 0) {
      const absent = absentPathVerdict({ asserted: argv.assertion, identity, paths: declaredPaths });
      if (!absent.ok) {
        for (const line of absent.lines) console.error(line);
        process.exit(EXIT_PREREQUISITE_NOT_MET);
      }
    }
    console.error('');
    // Read BEFORE the derivation, not inside it. A record that cannot be read
    // is an input problem, and #4690's rule is that an unreadable input must
    // never look like an empty answer — reading it after the derivation would
    // also spend a full tree walk to reach a message about a filename. An
    // EMPTY but readable record is NOT an error: it means nothing ran, and
    // saying so is the whole point of the mode.
    let runRecord = [];
    if (argv.runRecord !== null) {
      try {
        runRecord = parseRunRecord(readFileSync(nodePath.resolve(argv.runRecord), 'utf8'));
      } catch (err) {
        console.error(`dispatch-gates: could not read the run record '${argv.runRecord}' — ${err.message}`);
        console.error(
          `  ${RAN_FLAG} takes a file of the commands you ran, one per line, exactly as --commands emits them` +
            ` — optionally with what each ANSWERED: \`<command>${RUN_RECORD_REASON_SEPARATOR}${RUN_RECORD_EXIT_PREFIX}<code>\`, so a refusal is` +
            ' derived rather than declared. Capture them as you run, never by slugging log file names back into family names.',
        );
        process.exit(2);
      }
    }
    let paths;
    // The changed-line reading travels with a DERIVED change set only; an
    // explicit path list carries no diff and prints NOT MEASURED.
    let size = null;
    if (argvPaths.length > 0) {
      paths = declaredPaths;
    } else {
      // No paths: derive them. This is the dev-side form — "the gates my ACTUAL
      // diff implicates" — and it is the default because the caller-supplied
      // list was the thing getting it wrong (#9320). `--changed` spells the same
      // thing out for a caller that would rather say it than imply it.
      let derived;
      try {
        derived = changedPathsFromGit();
      } catch (err) {
        console.error(`dispatch-gates: could not derive the change set — ${err.message}`);
        console.error(USAGE_LINE);
        process.exit(2);
      }
      if (derived.paths.length === 0) {
        // An empty derivation is an input problem far more often than an answer,
        // and "no gates" is the most expensive thing this tool could say wrongly
        // (#4690: an unreadable input must never look like an empty answer).
        console.error(
          `dispatch-gates: this branch ${NO_DIFF_REFUSAL} '${derived.base}' (merge base ${derived.mergeBase.slice(0, 9)}) — ` +
            'nothing to derive. On the base branch already, or in the wrong checkout? Pass explicit paths to ask about a hypothetical surface.',
        );
        process.exit(2);
      }
      for (const line of derivationProvenance(derived)) console.error(line);
      console.error('');
      paths = derived.paths;
      size = derived.size;
    }
    try {
      // `--tier` answers the claim-time question alone: it reads no workflow and
      // no check script, so it still answers on a tree where the gate derivation
      // cannot run — and a claim comment is written before any of that matters.
      if (process.argv.includes('--tier')) {
        for (const line of tierLines(deriveTier(paths))) console.log(line);
        for (const line of changedLineLines(size)) console.log(line);
      } else {
        // The only mode with a VERDICT in it, so the only one whose exit code
        // carries an answer rather than "the derivation completed". A run that
        // names unrun families must not exit 0: this mode exists because a
        // report claiming coverage it did not have read exactly like one that
        // did, and an exit code is the half of that a caller cannot paraphrase.
        const status = derive(paths, { showResidue: process.argv.includes('--residue'), mode, runRecord, size });
        if (status) process.exit(status);
      }
    } catch (err) {
      console.error(`dispatch-gates: derivation failed — ${err.message}`);
      process.exit(2);
    }
  }
}
