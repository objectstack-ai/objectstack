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
 *   node scripts/pm/dispatch-gates.mjs --self-test
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
 * COMMAND THIS TOOL PRINTED, as it runs, byte for byte.
 *
 *     node scripts/pm/dispatch-gates.mjs --commands > gates.list
 *     while IFS= read -r cmd; do
 *       eval "$cmd" > "logs/$n" 2>&1
 *       printf '%s\n' "$cmd" >> ran.list      # what RAN — pass or fail
 *     done < gates.list
 *     node scripts/pm/dispatch-gates.mjs --ran ran.list      # exit 1 if any family is unrun
 *
 * Both sides of that comparison are then strings this file emitted from one
 * expression, so there is nothing to normalise and no shape for a matcher to
 * be lenient about. ⛔ Do not build the record from log FILE NAMES: that is the
 * step that needs a slug, and the slug is where the first hand-built
 * reconciliation went wrong.
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
 * `.github/workflows/*.yml`, resolves each `check:*` script through
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
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  anyConfigExtractsMetadataForms,
  findExtractConfigs,
  findMetadataFormModules,
  flagsExtractMetadataForms,
  isExtractConfigPath,
  isMetadataFormModulePath,
} from '../i18n-bundle-surface.mjs';
import { blank, maskComments, scanSource } from '../js-comment-mask.mjs';
import { invokedAs, isEntrypoint } from '../invoked-as.mjs';

// Re-exported so this tool's self-test drives the SAME predicates the gate
// runs, not copies of them. They used to be written twice — see the shared
// module's header, and the i18n entry in CHANGE_KIND_GATES below.
export { isExtractConfigPath, isMetadataFormModulePath };

const ROOT = new URL('../..', import.meta.url).pathname;

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
// dispatch-gates: inherited-population .github/workflows -- the workflow directory this tool readdirs; every other module-body literal here is a package-manifest join base or a tier glob, not a path this file opens (#11556)

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
    if (!BLOCK_SCALAR_HEADER.test(inline.trim())) {
      out.push(inline.trim());
      continue;
    }
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
    out.push(body.filter((l) => !/^[ \t]*#/.test(l)).join('\n'));
    i = j - 1;
  }
  return out;
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
 * of the refusal on this tree: `apps/!(docs)/**` in ci.yml's `core` filter, one
 * entry of six — the other five (`packages/**`, `examples/**`, `package.json`,
 * `pnpm-lock.yaml`, `tsconfig.json`, plus the workflow file itself) carry the
 * filter. A dropped POSITIVE entry can only narrow what is claimed; a dropped
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
 * Every job in one workflow that resolves to a path population, with the check
 * families it invokes: `[{ job, name, outputs, paths, dropped, checks }]`.
 */
export function jobPathPopulations(workflowText, workflowFile) {
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
    const checks = [...new Set(extractCheckInvocations(job.text, workflowFile).map((i) => i.check))];
    if (!checks.length) continue;
    out.push({ job: job.id, name: job.name, ...population, checks });
  }
  return out;
}

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
  /node[ \t]+(scripts\/[\w./-]+\.mjs)(?:[ \t]+-{1,2}[A-Za-z0-9][\w-]*)*[ \t]+--self-test\b/g;

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
 * ## Why a `check-` basename is skipped here rather than re-keyed
 *
 * 21 of the 30 scripts invoked this way on this tree already have a `check-`
 * basename and are therefore already families under their BARE path key. Admitting them again under a `… --self-test` key would SPLIT each into
 * two families and move its matches to the new key — a re-attribution reported
 * as a gain, which is the error this repo keeps catching. Skipping them makes
 * zero re-attribution a property of the code rather than a number that happened
 * to come out right (measured: 0 of the 52774 existing pairs changed key).
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
export function extractCheckInvocations(workflowText, workflowFile) {
  const out = [];
  for (const cmd of runCommandTexts(workflowText)) {
    for (const m of cmd.matchAll(/pnpm\s+(?:--filter\s+(\S+)\s+)?(?:run\s+)?(check:[\w:-]+)/g)) {
      out.push({ check: m[2], filter: m[1] ?? null, workflow: workflowFile });
    }
    for (const m of cmd.matchAll(/node\s+(scripts\/[\w./-]*check-[\w.-]+\.mjs)/g)) {
      out.push({ check: m[1], script: m[1], filter: null, workflow: workflowFile, direct: true });
    }
    for (const m of cmd.matchAll(SELF_TEST_INVOCATION)) {
      const script = m[1];
      // Already admitted above, under its bare path key. See the docblock.
      if (basename(script).includes('check-')) continue;
      out.push({
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
      });
    }
  }
  return out;
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
 */
const NO_CHECK_FAMILIES_MARKER = /^[ \t]*#[ \t]*dispatch-gates:[ \t]*no-check-families[ \t]*--[ \t]*(\S.*)$/m;

export function declaredNoCheckFamiliesReason(workflowText) {
  const m = NO_CHECK_FAMILIES_MARKER.exec(workflowText);
  return m ? m[1].trim() : null;
}

/**
 * A GATE SCRIPT's own declaration that it deliberately has no path population —
 * a whole-line comment anywhere in the script's source:
 *
 *   // dispatch-gates: no-path-population -- <reason>
 *   #  dispatch-gates: no-path-population -- <reason>      (shell gates)
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
const NO_PATH_POPULATION_MARKER =
  /^[ \t]*(?:\/\/|#)[ \t]*dispatch-gates:[ \t]*no-path-population[ \t]*--[ \t]*(\S.*)$/m;

export function declaredNoPathPopulation(scriptSource) {
  const m = NO_PATH_POPULATION_MARKER.exec(String(scriptSource));
  return m ? m[1].trim() : null;
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
  const body = maskSelfTests(maskComments(String(scriptSource)));
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
 * Returns `{ population, reason }`, or null when the module declares nothing.
 */
const INHERITED_POPULATION_MARKER =
  /^[ \t]*(?:\/\/|#)[ \t]*dispatch-gates:[ \t]*inherited-population[ \t]+(\S.*?)[ \t]+--[ \t]+(\S.*)$/m;

export function declaredInheritedPopulation(moduleSource, hints = null) {
  const source = String(moduleSource);
  const m = INHERITED_POPULATION_MARKER.exec(source);
  if (!m) return null;
  // The path list is non-empty by construction: the marker pattern requires a
  // non-space before the ` -- `, so a marker carrying only a reason does not
  // parse as a declaration at all — it reads as no marker, which is the safe
  // direction (inherit everything) rather than a silent blanket opt-out.
  const population = m[1].trim().split(/[ \t]+/).filter(Boolean);
  const reason = m[2].trim();
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
    if (declaredNoCheckFamiliesReason(text)) continue;
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
    const tracked = join(dir, m[1]);
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
 *   scripts/check-test-completeness.mjs:576
 *   scripts/measure-position-name-fold-census.mjs:689
 *       both `function selfTest({ quiet = false } = {})`
 *   scripts/workspace-enumerator.mjs:328
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
const ANCHOR_CENSUS_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;

/**
 * The bare name this tree's self-test convention spells. Every other name the
 * anchor matches is COMPOUND, and a compound name is the only place the anchor
 * can be wrong in either direction.
 */
const BARE_ENTRY_POINT_NAME = 'selfTest';

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
 * 209 code-position matches over the tracked JS/TS corpus. 187 are the bare
 * `selfTest`; the remaining 22 carry compound names over 21 distinct spellings,
 * and they are the rows below. Fifteen are genuine self-test batteries — the
 * anchor firing on them is the anchor working. SEVEN are production code:
 *
 *   scripts/check-self-test-wired.mjs            carriesSelfTest
 *   scripts/check-self-test-workflow-commands.mjs runSelfTest
 *   scripts/check-step-collectors.mjs            selfTestTargets
 *   scripts/check-step-collectors.mjs            selfTestDiscoveries
 *   scripts/measure-self-test-floor.mjs          selfTestDefs
 *   scripts/pm/dispatch-gates.mjs                selfTestOnlyCallables
 *   scripts/pm/dispatch-gates.mjs                maskSelfTests
 *
 * Every one of them is a gate that REASONS ABOUT self-tests, which is why they
 * cluster: a tool that finds, spawns, counts or masks other scripts' self-tests
 * names its functions after the thing it handles, and the anchor cannot tell
 * "runs a self-test" from "is one".
 *
 * ## What it costs today: nothing, MEASURED, and that is the whole point
 *
 * Neutralising each of the seven one at a time and re-extracting moves no hint
 * in any of the four files. The claim is therefore live rather than recalled —
 * and it is exactly the kind of claim that stops being true without anything
 * going red, which is what the pin in this module's self-test exists to catch.
 *
 * The same measurement over the fifteen genuine rows is NOT zero, and that
 * asymmetry is what makes the classification load-bearing rather than
 * decorative: `fixtureSelfTest` drops `packages/spec/spec-changes.json` and
 * `prePushIsArmedSelfTest` drops `.githooks/pre-push`, both fixture paths in
 * `scripts/check-regen-pending.mjs`, both correctly refused. So "no
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
 *   - **Special-casing this module's own path fixes two rows of seven.** The
 *     other five live in three other files, so the objection that a rename
 *     "fixes one instance and leaves the class" applies to it too, one file
 *     wider — and it would make the tool's self-scan differ from every other
 *     scan, which is a hazard of its own.
 *
 * ⇒ What ships is neither. The anchor keeps firing on all 22, the mask keeps
 * blanking all 22, and the cost of the seven accidental ones is MEASURED on
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
 */
const COMPOUND_ANCHOR_LEDGER = [
  ['packages/lint/scripts/check-doc-formula-expressions.mjs', 'specSelfTest', false],
  ['packages/lint/scripts/check-doc-formula-expressions.mjs', 'fieldRuleSelfTest', false],
  ['scripts/check-comment-mask-corpus.mjs', 'runSelfTestCases', false],
  ['scripts/check-doc-authoring.mjs', 'selfTestRule3', false],
  ['scripts/check-doc-authoring.mjs', 'selfTestPackagesProse', false],
  ['scripts/check-durability-degradation-log-level.mjs', 'selfTestReadSeams', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestTrapVocabulary', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestProvisioningUse', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestUnreferencedRecipes', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestMetaCallSpelling', false],
  ['scripts/check-platform-checklist.mjs', 'selfTestSourceLineCitations', false],
  ['scripts/check-regen-pending.mjs', 'fixtureSelfTest', false],
  ['scripts/check-regen-pending.mjs', 'prePushIsArmedSelfTest', false],
  ['scripts/check-regen-pending.mjs', 'decisionTableSelfTest', false],
  ['scripts/check-turbo-task-graph.mjs', 'runSelfTest', false],
  ['scripts/check-self-test-wired.mjs', 'carriesSelfTest', true],
  ['scripts/check-self-test-workflow-commands.mjs', 'runSelfTest', true],
  ['scripts/check-step-collectors.mjs', 'selfTestTargets', true],
  ['scripts/check-step-collectors.mjs', 'selfTestDiscoveries', true],
  ['scripts/measure-self-test-floor.mjs', 'selfTestDefs', true],
  ['scripts/pm/dispatch-gates.mjs', 'selfTestOnlyCallables', true],
  ['scripts/pm/dispatch-gates.mjs', 'maskSelfTests', true],
];

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
  const decommented = maskComments(source);
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
  const rel = relative(root, resolve(join(root, dirname(scriptPath)), literal));
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
 *   packages/spec/scripts/build-docs.ts:61             path.resolve(__dirname, '../src')
 *   packages/spec/scripts/build-skill-references.ts:35 path.resolve(__dirname, '../src')
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
 * was a repo path" about targets that are on disk.
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
  const moduleBody = maskSelfTests(maskComments(scriptSource));
  const hints = new Set();
  for (const m of moduleBody.matchAll(/['"`]([^'"`\n]{2,120})['"`]/g)) {
    const raw = m[1];
    if (/^(https?:|[A-Z_]+=|-{1,2}\w)/.test(raw)) continue;
    if (!/^[\w.@][\w.@/*-]*$/.test(raw)) continue;
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
  return [...hints];
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
 */
const IMPORT_FROM_SPECIFIER = /(?:^|[;\n])[ \t]*(?:import|export)\b[^;]*?\bfrom[ \t]*(['"])([^'"\n]+)\1/g;
const SIDE_EFFECT_IMPORT = /(?:^|[;\n])[ \t]*import[ \t]*(['"])([^'"\n]+)\1/g;

export function firstPartyImportTargets(scriptPath, source, { root = ROOT } = {}) {
  // The same masking hint extraction uses, for the same reason: an import
  // written out in a docblock, or one inside a self-test fixture, is a
  // specifier this script NAMES rather than one it loads.
  const body = maskSelfTests(maskComments(String(source)));
  const specifiers = new Set();
  for (const m of body.matchAll(IMPORT_FROM_SPECIFIER)) specifiers.add(m[2]);
  for (const m of body.matchAll(SIDE_EFFECT_IMPORT)) specifiers.add(m[2]);
  const here = dirname(join(root, scriptPath));
  const targets = new Set();
  for (const specifier of specifiers) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    const rel = relative(root, resolve(here, specifier));
    // One test, three refusals: a path that escapes the repo, one that lands
    // at the root, and one in any other tree all fail to start with scripts/.
    if (!rel.startsWith('scripts/')) continue;
    if (rel.split('/').includes('node_modules')) continue;
    const abs = join(root, rel);
    // A specifier that resolves to nothing is a specifier, not a module: the
    // extension-less spellings ESM does not resolve, and the ../<rel> shapes a
    // module body carries as illustration, both land here.
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    targets.add(rel);
  }
  return [...targets].sort();
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
export function runnableInvocation({ check, filter, direct }) {
  if (direct) return `node ${check}`; // already a script path, never a pnpm script
  if (filter) return `pnpm --filter ${filter} run ${check}`;
  return `pnpm ${check}`;
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
 * ## A glob in a NON-FINAL segment is not collapsible, and must not be collapsed
 *
 * Collapse-by-deletion is sound for a glob in the LAST segment, which is every
 * shape the idioms above use: `packages/**` → `packages`, `packages/spec/src/**`
 * → `packages/spec/src`, `packages/client*` → `packages/client`. Each names a
 * subtree root the tree really has, and `ROOT_DIR_WATCH_HINTS` depends on
 * exactly that reduction (`scripts/check-published-files.mjs:215-248` declares
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
  // `hint`, not `plain`: glob collapse destroys the separator this refusal is
  // deciding on, and a declared subtree is not a bare word. See the docblock.
  if (!hint.includes('/') && !plain.startsWith('.')) return false;
  return (
    inputPath === plain ||
    inputPath.startsWith(`${plain}/`) ||
    plain.startsWith(`${inputPath}/`) ||
    // EQUALITY, never a prefix: a dropped extension can only name the ONE file
    // the specifier resolves to, and the extension list is the shared
    // `MODULE_SPECIFIER_EXTENSIONS` rather than a second copy of it. See the
    // section above for the price and for what this deliberately cannot do.
    MODULE_SPECIFIER_EXTENSIONS.some((ext) => inputPath === plain + ext)
  );
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
 * parent, and an empty one is a literal that never was a repo path.
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
    return { key: read, via: by && by !== read ? `program text read by ${by}` : 'program text read' };
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
  const masked = maskComments(String(source));
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

/** Program text, as opposed to data a gate parses — see the docblock above. */
export const PROGRAM_TEXT_TARGET = /\.(?:[cm]?[jt]sx?|sh)$/;

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

/** Every TRACKED file the source opens at a path anchored to its own location. */
export function anchoredReadTargets(rel, source, isTracked) {
  const masked = maskComments(String(source));
  const { literal } = scanSource(masked);
  const ctx = {
    fileSegs: rel.split('/'),
    names: nameInitialisers(masked),
    returns: singleReturnExpressions(masked),
    params: singleCallSiteParameters(masked),
    seen: new Set(),
  };
  const out = [];
  for (const m of masked.matchAll(SOURCE_READ_CALL)) {
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
  const masked = maskSelfTests(maskComments(String(source)));
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
 * The three follows above all end at a PROGRAM — a module the gate imports, a
 * file whose program text it opens, a program it spawns — and inherit that
 * program's declared population. This one ends at DATA: a workspace package's
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
 * own declaration — the `declaredInheritedPopulation` discipline the other
 * three follows take, one file kind over — and never a regex over the gate's
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
  const masked = maskSelfTests(maskComments(String(source)));
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
      source = readFileSync(join(cwd, rel), 'utf8');
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
 * The longest leading run of a hint's segments that the tree still has, or ''
 * when even its first segment names nothing.
 *
 * This is the "why" half of the verdict, and it is the one distinction the
 * tree can actually answer (#9883 H2). It separates three populations that
 * would otherwise print identically as "matched nothing":
 *
 *   ''                  the literal was never a repo path — a MIME type, a
 *                       remote ref, a package or repo specifier that survived
 *                       the extractor. Nothing moved; it was never live;
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
 * to chase. Resolving the literal against its writing script (the producer-side
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
 *   by construction   the literal was never a repo path (no tracked path under
 *                     even its first segment — a package specifier, a cross-repo
 *                     slug), or the tree HAS the population and the covering
 *                     rule refuses the literal as too generic. Neither is a
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
      // First, because it is the strongest statement available: the sweep knows
      // the actual file. Every other branch reasons from a PREFIX, and for this
      // shape every one of them lands on something false.
      if (target) {
        return `'${hint}' — the tree HAS ${target}; the literal is that file's extensionless module spelling, which no whole-segment comparison reaches`;
      }
      if (!deepest) return `'${hint}' — no tracked path under its first segment; never was a repo path`;
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
      if (deepest === form) {
        return `'${hint}' — the tree HAS it; the covering rule refuses the literal as too generic (no path separator)`;
      }
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
const ESCAPABLE_LITERAL_LEDGER = new Set([
  // EMPTY — a verdict, not an absence. Every gate this derivation can SEE
  // spelling a bare top-level root has been discharged. Both instances are
  // recorded here because they took the two DIFFERENT remedies the idiom
  // allows, and a future FRESH row has to CHOOSE between them rather than
  // reach for the first one it is offered:
  //
  //   DISCHARGED (#10784): `check:parse-guard scripts`. That gate really does
  //   walk the repo's scripts/ tree, so declaring the subtree spelling beside
  //   the literal was TRUE. The row then failed as STALE by name and came out —
  //   the shrink the docblock above describes, walked once end to end.
  //
  //   DISCHARGED (#10875): `check:published-files scripts`. That gate reached
  //   `scripts` through a package-relative predicate over would-be tarball
  //   contents, NOT through the repo root it appeared to name, so the escape
  //   hatch was the wrong remedy for it: a `scripts/**` declaration would have
  //   been false, and would have named the gate for every repo-root scripts/
  //   edit it does not read — a fabricated lead, which `hintCovers`' docblock
  //   prices above a missing one. It took the OTHER remedy the idiom allows,
  //   stop spelling a bare root, and the row discharged by CONSTRUCTION rather
  //   than by declaration: nothing was added to this list to make it happen,
  //   which is the shape a shrink-only list wants.
  //
  // ⚠️ An empty ledger is NOT "the species is gone", and must not be read as
  // one. This list only ever saw the half the derivation can see — a literal
  // that reaches the HINT SET, which needs a separator somewhere in the source
  // spelling. #10840 measures the other half at ~33 gates whose population
  // literal carries no separator at all; those are invisible to the derivation
  // AND to this ledger, and emptying this list moves none of them.
]);

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
 * The four predicates around this one answer questions about a path: is it a
 * test file, does its package own an extract config, is it a gate script, is it
 * in the root program. This one cannot, and the reason is recorded elsewhere in
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
    return readFileSync(join(ROOT, path), 'utf8');
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
  const masked = maskComments(source);
  return CODE_STAMP_POSITION.test(masked) || CODE_CONSTANT_BINDING.test(masked);
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
  i18nConfigs ??= findExtractConfigs(join(ROOT, 'packages'), 'packages');
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
  formModules ??= findMetadataFormModules(join(ROOT, 'packages'), 'packages');
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
  const raw = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
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
export const CHANGE_KIND_GATES = [
  {
    kind: 'adds or edits a test file',
    matches: isTestFilePath,
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
    matches: (path) => isInI18nBundlePackage(path, i18nBundlePackageDirs()),
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
    matches: (path) => metadataFormsSurfaceIsExtracted() && reachesMetadataFormModule(path, metadataFormModulePaths()),
    gates: [
      {
        name: 'check:i18n',
        why: "the metadataForms half of the bundles is registry-driven, so a form's sections, field labels, helpText or placeholder are extracted into ONE package's committed bundles — platform-objects today — and a form edit drifts them from a package your diff never touches. This is the edge PR #9113 paid a CI round for. Same repair as the entry above: regenerate with `node scripts/check-i18n-bundles.mjs --write` and commit the moved bundles",
      },
    ],
  },
  {
    kind: 'adds or edits a GATE SCRIPT (a file some discovered check family runs)',
    matches: (path) => isGateScriptPath(path, gateFamilyFiles()),
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
    matches: (path) => isInRootTsProgram(path, rootTsProgramExcludedDirs()),
    gates: [
      {
        name: 'check:type-check-debt',
        why: 'the ROOT ledger entry (@objectstack/spec-monorepo) IS this program, so a file here moves its raw tsc count even though your diff touches no package — measured, one added bench file put it 19 over and cost a CI round. It is a shrink-only ratchet: the repair is to make the file typecheck, and raising the entry is maintainer-only, never the co-equal option. Most of this class is one missing setting rather than real breakage — the root config carries lib ES2020 and no types, so process and console are absent unless the file declares them ambiently. Needs the workspace closure BUILT — on an unbuilt worktree it refuses outright, and that throw means NOT MEASURED, never `not applicable to me`. Build first, exactly as lint.yml does: pnpm exec turbo run build --filter=./packages/* --filter=./packages/*/* (quote the filter values for your shell)',
      },
    ],
  },
  {
    kind: 'adds or edits a file carrying an ADR-0112 error or notice CODE (judged from CONTENT — no path derivation can name this gate)',
    matches: stampsAnErrorCodeLiteral,
    gates: [
      {
        name: 'check:dispatcher-error-vocabulary',
        why: 'it sweeps the non-test TypeScript sources under the package root for every site that stamps an error code, and reports each value the registered vocabulary (StandardErrorCode joined with ERROR_CODE_LEDGER) does not contain — so a code arriving through a quoted literal, a SCREAMING_SNAKE constant, a typeof reference to one, or a template moves it. This is the gate no path derivation can name: it computes its own population from a bare top-level root, which the bare-root ledger records as REFUSE-WIDE at 39% of the tracked tree, so it scores the same quiet silence for every card and #12843 paid a CI round trip for that silence. It needs NO build — a source scan, one pass, whole tree, and it names the file and line. Repair by REGISTERING the code where the vocabulary is declared, never by widening a consumer to tolerate it; reconciliation runs BOTH ways, so a table row whose site is gone fails too, and a pending-registration row whose code has since been registered fails as the discharge it is. ⚠ This lead is deliberately WIDE — it fires on a file that merely carries a code-shaped value, not only one that adds a new one — because the wasted run is one cheap gate and the miss is a CI round trip',
      },
    ],
  },
];

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
    `Once a changeset exists, ${pending.length} more famil(ies) apply — write one unless this card is docs-only:`,
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

export function residueLines(
  {
    discovered, matched, undetermined, silent, unfiltered, unreachable, swept,
    artifactRosters, invertedRosters, documentedNoPopulation,
  },
  kinds = CHANGE_KIND_GATES,
) {
  const placed = matched + undetermined + silent;
  if (placed !== discovered) {
    throw new Error(
      `residue accounting is short: ${placed} famil(ies) placed of ${discovered} discovered ` +
        '(matched + undetermined + silent must cover every discovered family)',
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
      ` · ${silent} silent (their sources name paths, none of which cover yours).`,
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
 *     surfaces is `claude-fable-5` — the pm-dispatch SKILL.md main file, every
 *     file carrying an enforced copy of the decision frame (the COPIES table
 *     of check:skill-frame-sync), and the dev-agent definition. Narrowed from
 *     "the whole skill tree, references included" by the maintainer's
 *     2026-08-20 ruling (「接受你的建议」— fable 当审计师用,不当施工队用):
 *     references-only surfaces carry NO path mandate any more (opus execution,
 *     compensated by the skill-face review at CONTRACT_REVIEW_TIER). Still a
 *     file-surface predicate, and exactly what this script takes as argv;
 *   - clause ②, NOT encoded and deliberately not: a card that changes contract
 *     accept/reject behaviour or widens the public surface is also
 *     `claude-fable-5`. That is judged from the card's CONTENT — what the change
 *     does to the contract — and a path cannot answer it. An ordinary-looking
 *     surface (one package's source file) is the NORMAL shape of a clause-②
 *     card. The closest a path can honestly get is SUSPICION:
 *     SUSPECT_TIER_GLOBS below marks the contract surface itself, and `--tier`
 *     prints a hint for it — never a verdict. The enforcement lives one step
 *     later, in the PM skill's enqueue gate over the PR's ACTUAL diff.
 *
 * A path derivation that pretended to cover clause ② would produce the failure
 * this whole file is written against, one level up: a "no mandate" line read as
 * a clearance. So the no-mandate output says which clause it checked and which
 * it cannot reach, every time, rather than leaving the reader to remember there
 * were two. The output is a FLOOR, never a ceiling.
 *
 * The sanctioned exits from a mandate — the one-line-class mechanical-edit
 * downgrade (a card CONTENT judgment, like clause ②), the measured quota
 * exemption (fable unavailable ⇒ opus, never lower) and the proactive
 * low-headroom downgrade — are claim-time judgments, not properties of the
 * file surface. This tool states the mandate; the seat records any exit and
 * its reason in the claim comment.
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
 * (1023 of that is the suspect glob's contract surface).
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
 * narrowed to protocol semantics by the 2026-08-20 ruling quoted there).
 * This table is a machine-readable copy of ONE predicate from it, not a second
 * statement of the policy: when they disagree, the skill wins and this table is
 * the thing to fix. The frame-copy half of the predicate is DEFINED by another
 * gate's table — check:skill-frame-sync's COPIES — and the self-test pins this
 * table as covering every file listed there, so a copy added to that gate
 * cannot silently fall out of the mandate.
 */
export const MANDATORY_TIER_GLOBS = [
  {
    glob: '.claude/skills/pm-dispatch/SKILL.md',
    tier: 'claude-fable-5',
    why: 'clause ① of the model-tiering ruling (narrowed to protocol semantics, 2026-08-20): the PM dispatch skill MAIN file is the lane\'s own operating protocol and a wrong edit propagates to every later dispatch — references/** dropped out of the path mandate that day',
  },
  {
    glob: '.claude/agents/os-dev.md',
    tier: 'claude-fable-5',
    why: 'clause ① (2026-08-20 narrowing): the dev-agent definition is protocol semantics — every dispatched dev runs under it, and it carries an enforced copy of the decision frame',
  },
  {
    glob: 'skills/objectstack-pm-dispatch/SKILL.md',
    tier: 'claude-fable-5',
    why: 'clause ① (2026-08-20 narrowing): the published PM skill carries two enforced copies of the decision frame (check:skill-frame-sync COPIES) and ships verbatim to third-party projects',
  },
];

/**
 * Clause ②'s single source of truth for the CONTRACT-REVIEW tier: the tier a
 * card that changes contract accept/reject behaviour or widens the public
 * surface must be dispatched at, and the tier the `needs:contract-review`
 * re-review sub-round must itself be running at (its opening self-check reads
 * this). Declared HERE and only here, as a constant, so a model upgrade is a
 * one-line change in one file. The review label deliberately names WHAT is
 * reviewed, never a model (maintainer, 2026-08-16: 「needs:fable-review 这个标
 * 签不好,下次模型升级怎么办」), and the PM skill's prose points at this
 * constant instead of spelling a model name.
 * Rulebook: `.claude/skills/pm-dispatch/SKILL.md` 「入队与落地」 — the clause-② gate and the `needs:contract-review` review-chain bullets.
 */
export const CONTRACT_REVIEW_TIER = 'claude-fable-5';

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
 */
export const SUSPECT_TIER_GLOBS = [
  {
    glob: 'packages/spec/src/**',
    why: 'the contract surface (error-code ledger, *.zod.ts contract schemas) — the normal landing zone of a clause-② card',
  },
];

/** The tier floor for a card with no mandate — the ruling's 最低下限. */
export const TIER_FLOOR = 'sonnet';

/** The default judgment tier for a card with no mandate — the ruling's 默认判断档. */
export const TIER_DEFAULT = 'opus';

/**
 * Place a card's file surface against the mandatory globs. Pure over its
 * inputs, so the self-test can drive every branch offline.
 *
 * Throws when two globs covering the same surface mandate DIFFERENT tiers:
 * this file encodes no ordering over tiers, so choosing between them would be a
 * guess printed as a derivation.
 */
export function deriveTier(paths, globs = MANDATORY_TIER_GLOBS, suspectGlobs = SUSPECT_TIER_GLOBS) {
  const hits = [];
  const suspects = [];
  for (const p of paths) {
    for (const g of globs) {
      if (hintCovers(g.glob, p)) hits.push({ path: p, glob: g.glob, tier: g.tier, why: g.why });
    }
    for (const g of suspectGlobs) {
      if (hintCovers(g.glob, p)) suspects.push({ path: p, glob: g.glob, why: g.why });
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
    '  Clause ② is NOT reachable from paths: a card that changes contract accept/reject behaviour or widens the public' +
    ' surface is fable-mandatory too, judged from the card CONTENT. This line is a FLOOR, never a clearance.';
  // The suspicion tail prints only on a hit — unlike the clause-② note above,
  // which prints always: "no suspicion" and "no suspect table" must not share a
  // spelling, and the note is what keeps silence from reading as a clearance.
  const suspicion = suspects.length === 0
    ? []
    : [
        `  Clause ② SUSPECT surface — a hint, not a verdict: judge the tier from the card CONTENT as best you can` +
          ` (a card changing contract accept/reject behaviour or widening the public surface is ${CONTRACT_REVIEW_TIER});` +
          ` whichever tier is dispatched, the PR's actual diff passes the clause-② enqueue gate before the card may enqueue.`,
        ...suspects.map((s) => `    - ${s.path} ⇢ '${s.glob}' — ${s.why}`),
      ];
  if (!mandatory) {
    return [
      `Model tier — no path-derived mandate: the surface hits none of the ${declared} declared glob(s), derived here, not recalled.`,
      `  The tier stays the PM's per-card judgment call (floor ${TIER_FLOOR} · default ${TIER_DEFAULT} · ceiling fable).`,
      clause2,
      ...suspicion,
    ];
  }
  return [
    `Model tier — MANDATORY: ${tier} (derived from the file surface, not recalled).`,
    ...hits.map((h) => `  - ${h.path} ⇢ '${h.glob}' — ${h.why}`),
    '  Exits, each recorded with its reason in the claim comment\'s `Container & model` line: a one-line-class' +
      ' mechanical governed edit drops to opus execution (sonnet floor for pure one-liners at PM discretion,' +
      ` compensated by the skill-face review at ${CONTRACT_REVIEW_TIER}) — judged from the card CONTENT, never from` +
      ' paths; the measured quota exemption (fable unavailable ⇒ opus, never lower); the proactive low-headroom downgrade.',
    clause2,
    ...suspicion,
  ];
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
export function discoverFamilies({ tree = watchHintTree() } = {}) {
  const wfDir = join(ROOT, '.github/workflows');
  const workflows = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
  if (workflows.length === 0) throw new Error('no workflow files found under .github/workflows');
  const rootScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};

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
  for (const wf of workflows) {
    const text = readFileSync(join(wfDir, wf), 'utf8');
    workflowEntries.push({ file: wf, text });
    invocations.push(...extractCheckInvocations(text, wf));
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

  // Dedupe by (check, workflow); resolve each to script files + watch hints.
  const byCheck = new Map();
  for (const inv of invocations) {
    const key = inv.check;
    if (!byCheck.has(key)) byCheck.set(key, { ...inv, workflows: new Set(), files: [], hints: [] });
    byCheck.get(key).workflows.add(inv.workflow);
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
    if (entry.filter) {
      // package-scoped check: resolve through that package's manifest when findable
      const pkgDirGuess = entry.filter.replace(/^@objectstack\//, '');
      for (const base of ['packages', 'packages/plugins', 'packages/drivers', 'packages/services']) {
        const p = join(ROOT, base, pkgDirGuess, 'package.json');
        if (existsSync(p)) {
          const pkgScripts = JSON.parse(readFileSync(p, 'utf8')).scripts ?? {};
          // The manifest's own directory goes IN, and tracked paths come back
          // out — a package script may climb out of its package
          // (`tsx ../../scripts/x.mts`), and prefixing the result here instead
          // was measured to misattribute exactly that spelling to the package
          // (#12107; resolveCheckToFiles' docblock carries the measurement).
          files = files.concat(
            resolveCheckToFiles(entry.check, pkgScripts, { dir: join(base, pkgDirGuess) }),
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
  const moduleHints = new Map();
  const hintsOfModule = (rel) => {
    if (!moduleHints.has(rel)) {
      // ONE read, two answers — the module's literals and its own declaration of
      // which of them a caller INHERITS — so the pair cannot describe different
      // revisions of a file, the same discipline the trigger paths take above.
      // A module that declares nothing contributes everything it spells, which
      // is the behaviour every followed module had before the marker existed.
      const source = readFileSync(join(ROOT, rel), 'utf8');
      const spelled = extractWatchHints(source, rel, { tree });
      const declared = declaredInheritedPopulation(source, spelled);
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
        const manifest = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
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
    entry.runs = [];
    entry.manifests = [];
    entry.reads = [];
    entry.readOrigin = new Map();
    entry.hintOrigin = new Map();
    entry.hintEdge = new Map();
    for (const f of entry.files) {
      const abs = join(ROOT, f);
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
      }
      entry.noPopulationReason ??= declaredNoPathPopulation(source);
      // ONE read, SIX answers now (#14004). The payload dependence is read off
      // the SAME source text as the five above, so this classification cannot
      // describe a different revision of the gate than the hints printed beside
      // it — the discipline every other reader in this loop follows.
      entry.payloadEnv ??= payloadEnvDependence(source);
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
      for (const mod of firstPartyImportTargets(f, source)) {
        if (gateFiles.has(mod) || entry.imports.includes(mod)) continue;
        entry.imports.push(mod);
      }
      // The SECOND edge to another program, under the same two refusals as the
      // first and for the same reasons (#13511). It sits BELOW the self-test
      // guard deliberately: the narrowing above is invocation-shaped — an
      // inherited population describes the gate's WORK — and that argument does
      // not change with the edge it arrives over. One rule, not two. Cost of
      // placing it here, measured on this tree: zero, because no `--self-test`
      // family reaches an in-tree program by spawn at all.
      for (const ran of spawnedProgramTargets(f, source, (t) => trackedSet.has(t))) {
        if (gateFiles.has(ran) || entry.runs.includes(ran)) continue;
        entry.runs.push(ran);
      }
      // The THIRD edge under the same self-test guard, for the same
      // invocation-shaped reason the spawn follow states (#13518). The
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
    // Read from the gate's own files only, exactly like the declaration above
    // it: a followed module cannot make its caller CI-only, and a family that
    // reached no file at all reaches no classification either.
    entry.payloadEnv ??= null;
    entry.ciOnly = ciOnlyMeasurement(entry, rootScripts);
  }
  return { byCheck, workflows, workflowEntries };
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
export function ciOnlyCommandSet(matchedRows = []) {
  return new Set(matchedRows.filter((row) => row.ciOnly).map((row) => row.command));
}

export function commandsFor({ matchedRows = [], kindGroups = [] } = {}) {
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
  const ciOnly = ciOnlyCommandSet(matchedRows);
  for (const row of matchedRows) if (!row.ciOnly) commands.add(row.command);
  for (const group of kindGroups) {
    // The exclusion follows the COMMAND, not the section it was reached
    // through: a family named by change KIND as well as by path is one family,
    // and it is no more runnable from the second section than from the first.
    // Reachable only in a corner today — no CI-measured family is in
    // CHANGE_KIND_GATES — but a rule that held in one section and not the
    // other is exactly the two-renderings drift this file keeps closing.
    for (const gate of group.gates) if (gate.command && !ciOnly.has(gate.command)) commands.add(gate.command);
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
 * The pending-changeset families, the unreachable listing and the always-runs
 * tail are each outside it, each with its own count printed under its own
 * heading. That is the same disclosure `machineReadableOutput` makes on stderr,
 * and it is made here for the same reason: a new number that reads as "the
 * complete account of what CI runs" would reproduce this card's own defect one
 * layer up.
 *
 * `staleRows` and the row/family gap are surfaced rather than smoothed. A
 * consumer counting PRINTED rows in the convention block and comparing them
 * with `convention` here would otherwise find a discrepancy with no
 * explanation — a STALE row prints and contributes no command, and one family
 * hit by two kinds prints twice. Both are stated in the rendering.
 */
export function familyReconciliation({ matchedRows = [], kindGroups = [] } = {}) {
  const commands = commandsFor({ matchedRows, kindGroups });
  // The SAME expression commandsFor uses for its matched half. Written as a
  // second traversal it would be a second answer to a question this file
  // already answers once.
  const runnableRows = matchedRows.filter((row) => !row.ciOnly);
  const ciOnlyRows = matchedRows.filter((row) => row.ciOnly);
  const matchedCommands = new Set(runnableRows.map((row) => row.command));
  // Counted, never folded into the total: the total is the RUNNABLE answer and
  // a CI-measured family is outside it by construction. Kept as its own term so
  // the omission is a number the reader gets rather than a difference they have
  // to notice (#14004).
  const ciOnlyCommands = ciOnlyCommandSet(matchedRows);
  const conventionCommands = new Set();
  let conventionRows = 0;
  let staleRows = 0;
  let ciOnlyConventionRows = 0;
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
      else conventionCommands.add(gate.command);
    }
  }
  const both = [...conventionCommands].filter((command) => matchedCommands.has(command)).length;
  const recon = {
    total: commands.length,
    matched: matchedCommands.size,
    matchedRows: runnableRows.length,
    ciOnly: ciOnlyCommands.size,
    ciOnlyRows: ciOnlyRows.length,
    convention: conventionCommands.size,
    conventionRows,
    conventionOnly: conventionCommands.size - both,
    both,
    staleRows,
    ciOnlyConventionRows,
  };
  if (recon.matched + recon.convention - recon.both !== recon.total) {
    throw new Error(
      'dispatch-gates: the family reconciliation does not close — ' +
        `${recon.matched} matched + ${recon.convention} convention − ${recon.both} both ≠ ${recon.total} distinct. ` +
        'The parts and the union came from different structures, which is the drift this line exists to detect. ' +
        'Refusing rather than printing a total that cannot be trusted (#4690).',
    );
  }
  return recon;
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
  if (recon.total === 0) {
    return [
      'Reconciliation — 0 famil(ies): this card\'s whole runnable answer, and the derivation COMPLETED to reach it.',
      '  0 named by PATH (the matched block) + 0 named by change KIND (the convention block). An empty answer, not a missing one.',
      ...(ciOnlyLine ? [ciOnlyLine] : []),
      '  ⇒ --commands prints nothing for these paths and exits 0. The always-runs tail below still applies and is NOT covered by this number.',
    ];
  }
  const lines = [
    `Reconciliation — ${recon.total} famil(ies): this card's WHOLE runnable answer, and the number to assert a harvest against.`,
    `  ${recon.matched} named by PATH (the matched block) + ${recon.convention} named by change KIND (the convention block)` +
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
    if (recon.conventionRows - recon.staleRows - ciOnlyConventionRows > recon.convention) {
      notes.push(`${recon.conventionRows - recon.staleRows - ciOnlyConventionRows - recon.convention} a repeat of a family another kind already hit`);
    }
    lines.push(
      `  (the convention block prints ${recon.conventionRows} rows for those ${recon.convention}: ${notes.join('; ')}.)`,
    );
  }
  lines.push(
    `  ⛔ ${recon.total} is what THIS CARD owes by path and kind — NOT a complete account of what CI runs on the PR.` +
      ' The pending-changeset families, the unreachable listing and the always-runs tail below are each OUTSIDE it, each with its own count.',
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
        entries.push({ command: rest, claim: 'not-measured', reason: null, line, raw, malformed: `no '${RUN_RECORD_REASON_SEPARATOR.trim()}' and no reason after it` });
        continue;
      }
      const reason = rest.slice(at + RUN_RECORD_REASON_SEPARATOR.length).trim();
      entries.push({
        command: rest.slice(0, at),
        claim: 'not-measured',
        reason: reason || null,
        line,
        raw,
        malformed: reason ? null : 'an empty reason',
      });
      continue;
    }
    entries.push({ command: raw, claim: 'ran', reason: null, line, raw, malformed: null });
  }
  return entries;
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
 * subtracts by design, and a pending-changeset family, derived against a path
 * that did not exist at derivation time. Both are matched byte-exactly against
 * sets this same derivation produced.
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
  pendingCommands = new Set(),
  record = [],
} = {}) {
  const derivedSet = new Set(derived);
  const ranClaims = new Set();
  const unmeasuredClaims = new Map();
  const malformed = [];
  for (const entry of record) {
    if (entry.claim === 'ran') {
      ranClaims.add(entry.command);
      continue;
    }
    if (entry.malformed) malformed.push({ line: entry.line, raw: entry.raw, why: entry.malformed });
    if (!unmeasuredClaims.has(entry.command)) unmeasuredClaims.set(entry.command, entry);
  }
  // A command claimed BOTH ways is read as run — running it is the stronger
  // fact — and the contradiction is reported rather than resolved silently.
  const conflicts = [...unmeasuredClaims.keys()].filter((command) => ranClaims.has(command)).sort();

  const ran = [];
  const unrun = [];
  const notMeasured = [];
  for (const command of [...derivedSet].sort()) {
    if (ranClaims.has(command)) {
      ran.push(command);
      continue;
    }
    const claim = unmeasuredClaims.get(command);
    if (claim && claim.reason) {
      notMeasured.push({ command, reason: claim.reason, line: claim.line });
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
    explainedPending: explainedPending.sort(),
    extra: extra.sort(),
    nearMiss,
    malformed,
    conflicts,
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
 */
export function runReconciliationLines(recon) {
  const lines = [];
  const marker = RUN_RECORD_UNMEASURED_MARKER;
  lines.push(
    `Run reconciliation — ${recon.derivedTotal} derived, ${recon.ran.length} run, ${recon.notMeasured.length} ${marker}, ${recon.unrun.length} UNRUN.`,
  );
  lines.push(
    `  The ${recon.derivedTotal} is THIS tree's derivation, recomputed in this process from the same expression --commands prints —` +
      ' never read back from your record. A family you never wrote down is still counted, which is what an arithmetic over your own list cannot do.',
  );
  if (recon.unrun.length > 0) {
    lines.push(`  ⛔ UNRUN (${recon.unrun.length}) — derived for these paths, and the record does not account for them:`);
    for (const { command, why } of recon.unrun) lines.push(`    - ${command}   [${why}]`);
  }
  if (recon.notMeasured.length > 0) {
    lines.push(
      `  ${marker} (${recon.notMeasured.length}) — the RUNNER's claim, recorded with a reason. ⛔ This tool did not measure them and cannot verify the reason:`,
    );
    for (const { command, reason } of recon.notMeasured) lines.push(`    - ${command}   [${reason}]`);
    lines.push(
      `    ⚠️ ${marker} is for a gate that REFUSES with its own stated prerequisite. A run the OS killed is not that —` +
        ' a cap kill (exit 143) leaves no verdict and the family is simply unrun. The two are easy to conflate under time pressure, and one of them was.',
    );
  }
  if (recon.explainedCiOnly.length > 0) {
    lines.push(
      `  Classified by this tool, no explanation owed (${recon.explainedCiOnly.length}) — CI-MEASURED ONLY, and outside the derived total by design:`,
    );
    for (const command of recon.explainedCiOnly) lines.push(`    - ${command}`);
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
  for (const { line, raw, why } of recon.malformed) {
    lines.push(`  ⚠️ line ${line} claims ${marker} with ${why}: '${raw}'. Spelling: ${marker} <command>${RUN_RECORD_REASON_SEPARATOR}<reason>.`);
  }
  for (const command of recon.conflicts) {
    lines.push(`  ⚠️ '${command}' is recorded BOTH as run and as ${marker}. Read as run; fix the record so it states one thing.`);
  }
  lines.push(
    '  ⛔ This answers ONE link: what this card DERIVES against what you RAN. It is not a complete account of what CI runs on the PR —' +
      ' the always-runs tail, the unreachable listing and the pending-changeset families are each outside the derived total, each printed under its own heading by a run without --ran.',
  );
  lines.push(
    recon.ok
      ? `✓ dispatch-gates --ran: ${recon.derivedTotal} derived famil(ies) accounted for — ${recon.ran.length} run, ${recon.notMeasured.length} ${marker}.`
      : `✗ dispatch-gates --ran: ${recon.unrun.length} of ${recon.derivedTotal} derived famil(ies) UNRUN.`,
  );
  return lines;
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
export function derivationJson({ paths, matchedRows, kindGroups, pending, counts, identity }) {
  const commands = commandsFor({ matchedRows, kindGroups });
  const { otherCommands, ...spelling } = spellingSplit(commands);
  return {
    tool: 'dispatch-gates',
    repo: identity?.slug ?? null,
    commit: identity?.head ?? null,
    paths: [...paths],
    commands,
    spelling: otherCommands.length ? { ...spelling, otherCommands } : spelling,
    matched: matchedRows,
    convention: kindGroups,
    pendingChangeset: {
      probePath: CHANGESET_PROBE_PATH,
      families: pending.map(({ check, entry }) => ({
        check,
        command: runnableInvocation(entry),
        workflows: [...entry.workflows],
      })),
    },
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
 * The stderr accounting exists so the two things stdout deliberately omits —
 * the pending-changeset families and the always-runs tail — are omitted OUT
 * LOUD. A quiet omission is the defect this mode was added to fix, and adding a
 * new one inside the fix is how that defect reproduces itself one layer up.
 */
function machineReadableOutput(mode, { paths, matchedRows, kindGroups, pending, counts }) {
  const identity = repoIdentity();
  const commands = commandsFor({ matchedRows, kindGroups });
  const split = spellingSplit(commands);

  if (mode === 'json') {
    console.log(JSON.stringify(derivationJson({ paths, matchedRows, kindGroups, pending, counts, identity }), null, 2));
  } else {
    for (const command of commands) console.log(command);
  }

  const conventionCount = kindGroups.reduce((n, g) => n + g.gates.filter((x) => x.command).length, 0);
  const ciOnlyRows = matchedRows.filter((row) => row.ciOnly);
  console.error(
    `dispatch-gates --${mode}: ${commands.length} command(s) — ${split.pnpm} pnpm, ${split.node} direct node` +
      `${split.other ? `, ${split.other} neither` : ''} (${matchedRows.length - ciOnlyRows.length} matched by path, ${conventionCount} by change KIND).`,
  );
  // The THIRD thing stdout deliberately omits, omitted OUT LOUD for the reason
  // this function's header gives for the other two: a quiet omission is the
  // defect this mode exists to fix (#14004).
  if (ciOnlyRows.length) {
    console.error(
      `  + ${ciOnlyRows.length} famil(ies) matched by path are CI-MEASURED ONLY and are ${mode === 'json' ? 'flagged as ciOnly on their matched row, not in commands' : 'NOT above'} — ` +
        'they read the workflow event payload, so no local run of them can produce a verdict. Run without --commands/--json to see them named.',
    );
  }
  if (pending.length) {
    console.error(
      `  + ${pending.length} famil(ies) apply once this card's changeset exists and are ${mode === 'json' ? 'under pendingChangeset, not in commands' : 'NOT above'} — ` +
        'they are derived against a path that does not exist yet. Write the changeset, then derive again.',
    );
  }
  console.error(
    '  ⛔ Not a complete account of what CI runs on this PR: the always-runs tail (workflows with no path filter) is NOT here. Run without --commands/--json for it.',
  );
}

function derive(paths, { showResidue = false, mode = 'human', runRecord = [] } = {}) {
  // The reachability sweep runs BEFORE a line is printed, so its refusals
  // (#4690: an empty corpus, or an all-unreachable answer) come out as a
  // failed derivation rather than as a footnote under an answer that already
  // looks complete. It reads the tree only; it moves no verdict above.
  //
  // It is read here, above the discovery, because the extractor needs the same
  // corpus to judge a single-segment directory literal — one listing, so the
  // hints and the sweep that grades them cannot be taken from different trees.
  const swept = trackedFiles();
  // Held in a name rather than built inline: the artifact-roster split needs
  // the SAME bundle the discovery was handed. Built twice it would be two
  // readings of one listing, which is the drift `watchHintTree`'s own docblock
  // refuses ("the pair is meaningless apart").
  const tree = watchHintTree(swept);
  const { byCheck, workflows, workflowEntries } = discoverFamilies({ tree });
  // ONE per-hint sweep feeds both readers of dead literals: the unreachable
  // listing (whole-family grain) and the residue annotations (per-hint grain,
  // #13312) — so the two cannot disagree about which literals are dead.
  const sweep = deadHintSweep([...byCheck], swept);
  const unreachable = unreachableFamilies([...byCheck], swept, sweep);

  const matched = new Map();
  const undetermined = [];
  const silent = [];
  for (const [check, entry] of byCheck) {
    const { verdict, hits } = classifyEntry(entry, paths);
    if (verdict === 'matched') matched.set(check, { entry, hits });
    else if (verdict === 'undetermined') undetermined.push([check, entry]);
    else silent.push([check, entry]);
  }
  const rosters = silent.map(([, entry]) => artifactOnlySilence(entry, paths, tree)).filter(Boolean);

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
  }));
  const kindGroups = changeKindGates(paths, resolveInvocation);
  // The pending-changeset section is derived in BOTH input modes and is gated
  // on nothing but the answer itself: the PM's paths are a hypothesis with no
  // changeset in it, and a dev's real diff has none either until the changeset
  // is written. Where one already exists, the families are in `matched` above
  // and this comes back empty. See pendingChangesetFamilies for the round of
  // five dispatches that measured the gap.
  const pending = pendingChangesetFamilies([...byCheck], new Set(matched.keys()));

  if (mode === 'ran') {
    // Built from the SAME three expressions the other renderings read, in this
    // process, on this tree: the union `--commands` prints, the CI-measured set
    // that union subtracts, and the pending families it holds back. A second
    // traversal here would be a second answer to a question this file already
    // answers once — and it would be the answer the reconciliation is judged
    // against, which is the worst possible place to keep a duplicate.
    const recon = runReconciliation({
      derived: commandsFor({ matchedRows, kindGroups }),
      ciOnlyCommands: ciOnlyCommandSet(matchedRows),
      pendingCommands: new Set(pending.map(({ entry }) => runnableInvocation(entry))),
      record: runRecord,
    });
    for (const line of runReconciliationLines(recon)) console.log(line);
    return recon.ok ? 0 : 1;
  }

  if (mode !== 'human') {
    machineReadableOutput(mode, {
      paths,
      matchedRows,
      kindGroups,
      pending,
      counts: {
        discovered: byCheck.size,
        workflows: workflows.length,
        matched: matched.size,
        undetermined: undetermined.length,
        silent: silent.length,
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
  const recon = familyReconciliation({ matchedRows, kindGroups });

  console.log(`dispatch-gates: ${byCheck.size} check famil(ies) discovered across ${workflows.length} workflow file(s) — derived at runtime, nothing listed in this script.\n`);
  // The tier verdict prints on EVERY run, hit or not. Printing it only on a hit
  // would make its absence mean two things at once — "no mandate" and "this
  // build has no tier derivation" — and the claim comment is written from
  // whatever the run said.
  for (const line of tierLines(deriveTier(paths))) console.log(line);
  console.log('');
  // The block a dev PASTES carries only families a dev can run (#14004). The
  // CI-measured ones are not dropped — they get their own heading below, past
  // the blank line the published harvest stops at, so the family stays named
  // and named ONCE, and no harvest of this block can pick up a command whose
  // only local outcome is a nonzero exit.
  const runnableRows = matchedRows.filter((row) => !row.ciOnly);
  const ciOnlyRows = matchedRows.filter((row) => row.ciOnly);
  const viaText = (hits) => hits.map((h) => `${h.path} ⇢ ${h.via} '${h.hint}'`).join('; ');
  if (runnableRows.length) {
    console.log('Local gates for this card (paste into the dispatch prompt):');
    for (const { command, workflows: wfs, via: hits } of runnableRows) {
      console.log(`  - ${command}   [${wfs.join(', ')}]   matched via ${viaText(hits)}`);
    }
    // The blank line FIRST, and it is not cosmetic: the published harvest ends
    // the block at the first empty line, so a footer butted against the rows
    // would be harvested AS rows. See spellingFooterLines.
    console.log('');
    for (const line of spellingFooterLines(spellingSplit(runnableRows.map((r) => r.command)), recon)) {
      console.log(line);
    }
  } else if (ciOnlyRows.length) {
    // ⛔ NOT the "nothing matched" sentence below: families DID match, and
    // saying otherwise would hide the one row this card is about behind a
    // claim the run just measured as false.
    console.log('No LOCALLY runnable check family names the given paths — every family they matched is CI-measured only; see the heading below.');
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
  const kindLines = changeKindLines(paths, resolveInvocation);
  if (kindLines.length) {
    console.log('\nConvention-triggered gates (this change KIND moves them; no path derivation can name them):');
    for (const line of kindLines) console.log(line);
  }

  // Directly BELOW the last section that feeds it, and above everything the
  // total deliberately excludes. Placed at the top it would state a figure
  // before the sections it reconciles had been printed; placed under the
  // residue it would sit past the point a harvesting consumer stops reading.
  // Here it closes the runnable answer and the section boundary is the claim.
  console.log('');
  for (const line of familyReconciliationLines(recon)) console.log(line);

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
          console.log(`      ↳ declared no path population — ${entry.noPopulationReason}`);
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
const DEFAULT_BASE_REMOTE = 'origin';
const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_BASE_REF = `${DEFAULT_BASE_REMOTE}/${DEFAULT_BASE_BRANCH}`;

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
  return { paths, base, baseSha, mergeBase, counts: { committed: committed.length, worktree: worktree.length, untracked: untracked.length } };
}

/**
 * Provenance for a derived run, on STDERR.
 *
 * `--tier` output is pasted verbatim into a claim comment, so stdout has to
 * stay the answer and nothing else. The reader still needs to know which range
 * produced the list — a derived run that looked identical to an explicit-path
 * run would just move the unverifiable claim one level up.
 */
function derivationProvenance({ paths, base, mergeBase, counts }) {
  return [
    `dispatch-gates: change set derived from git — ${paths.length} path(s) vs merge base ${mergeBase.slice(0, 9)} of '${base}' and HEAD`,
    `  (committed ${counts.committed}, working tree ${counts.worktree}, untracked ${counts.untracked}; three-dot semantics, never '${base}..HEAD')`,
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
const REPO_FLAG = '--repo';

/**
 * The run-record flag (#13774). Same spelling rule as the assertion above: the
 * leading dashes keep it out of this file's own hint set, and its VALUE is a
 * path this tool reads at runtime rather than a literal it declares.
 */
const RAN_FLAG = '--ran';

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
export const DERIVATION_SURFACE = ['.github/workflows', 'package.json', 'scripts'];

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
        `  Tree: ${identity.root}`,
      ],
    };
  }

  return { ok: true, lines: [] };
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
  const missing = paths.filter((p) => !p.includes('*') && !existsSync(join(identity?.root ?? ROOT, p)));
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

function selfTest() {
  const cases = [];
  const t = (name, cond) => cases.push([name, cond]);

  const wf = [
    'jobs:',
    '  lint:',
    '    steps:',
    '      - name: A',
    '        run: pnpm check:engine-double-contract',
    '      - name: B',
    '        run: pnpm --filter @objectstack/spec check:authorable-surface',
    '      - name: C',
    '        run: node scripts/check-nul-bytes.mjs',
    '      - name: not-a-check',
    '        run: pnpm build',
  ].join('\n');
  const invs = extractCheckInvocations(wf, 'lint.yml');
  t('extracts plain pnpm check', invs.some((i) => i.check === 'check:engine-double-contract' && i.filter === null));
  t('extracts filtered check with its package', invs.some((i) => i.check === 'check:authorable-surface' && i.filter === '@objectstack/spec'));
  t('extracts direct node scripts/check-*.mjs', invs.some((i) => i.check === 'scripts/check-nul-bytes.mjs' && i.direct));
  t('ignores non-check runs', !invs.some((i) => String(i.check).includes('build')));

  // Block-scalar bodies (#8410). A step written `run: |` keeps its commands on
  // the following lines; reading only the `run:` line collected "|" and missed
  // every gate invoked this way. Both scalar styles and both invocation shapes
  // are pinned, plus the two directions in which the body must END.
  const blockWf = [
    'jobs:',
    '  changeset-check:',
    '    steps:',
    '      - name: Literal block, two commands',
    '        env:',
    '          MERGE_BASE: abc',
    '        run: |',
    '          node scripts/check-adr-0087-registration.mjs --self-test',
    '          node scripts/check-adr-0087-registration.mjs --base "$MERGE_BASE"',
    '',
    '      # A YAML comment BETWEEN steps naming `pnpm check:invented-by-prose`.',
    '      - name: Folded block with a pnpm check',
    '        run: >-',
    '          pnpm --filter @objectstack/spec check:folded-surface',
    '      - name: Body carrying a shell comment',
    '        run: |',
    '          # first run node scripts/check-mentioned-only.mjs, they said',
    '          pnpm check:really-invoked',
    '      - name: Back to a one-liner',
    '        run: node scripts/check-nul-bytes.mjs',
  ].join('\n');
  const blockInvs = extractCheckInvocations(blockWf, 'pr-automation.yml');
  const blockNames = blockInvs.map((i) => i.check);
  t('extracts a direct script from a literal block body', blockNames.includes('scripts/check-adr-0087-registration.mjs'));
  t('extracts a pnpm check from a folded block body, with its filter', blockInvs.some((i) => i.check === 'check:folded-surface' && i.filter === '@objectstack/spec'));
  t('a dedented step ends the block body (the one-liner after it still parses)', blockNames.includes('scripts/check-nul-bytes.mjs'));
  t('a blank line does NOT end the block body', blockNames.includes('check:folded-surface'));
  // The over-match guard: discovery must report what a step RUNS, never what a
  // comment mentions. Measured on this tree — four families (check:adr-links,
  // check:empty-changeset, check:platform-checklist, check:skill-frame-freshness)
  // appear in workflow prose only, and a naive any-token scan invents all four.
  t('a gate named only in a YAML comment between steps is not discovered', !blockNames.includes('check:invented-by-prose'));
  t('a gate named only in a shell comment inside a body is not discovered', !blockNames.includes('scripts/check-mentioned-only.mjs'));
  t('a real command in the same body as a comment is still discovered', blockNames.includes('check:really-invoked'));

  // ── The self-test invocation matcher (#11404) ─────────────────────────────
  //
  // A gate whose script follows neither naming convention was not a family at
  // all — absent from the matched list, the convention list, the unreachable
  // list and all three residue buckets, because it never entered the universe
  // those partition. The specimen is the one that shipped the red on PR #11397
  // over a diff whose seven derived families were all green.
  const selfTestWf = [
    'jobs:',
    '  gates:',
    '    steps:',
    '      - name: Bare-root worklist self-test',
    '        run: node scripts/pm/bare-root-worklist.mjs --self-test',
    '      - name: Release tooling, not a gate',
    '        run: node scripts/release-github-releases.mjs',
    '      - name: A wrapper whose WRAPPED command carries the flag',
    '        run: node scripts/run-with-stall-guard.mjs --log "/tmp/x.log" --stall-minutes 10 -- pnpm test',
    '      - name: Two commands, one body, only the second is a self-test',
    '        run: |',
    '          node scripts/docs-audit/affected-docs.mjs --json base > affected.json',
    '          node scripts/pm/git-history.mjs --self-test',
  ].join('\n');
  const stInvs = extractCheckInvocations(selfTestWf, 'lint.yml');
  const stNames = stInvs.map((i) => i.check);
  // Absent rather than thrown: with the matcher ablated these lookups return
  // nothing, and a self-test that CRASHES instead of naming its failing case
  // reports "something is broken" where the whole value is "this exact case
  // went red". Measured — the first ablation run of this change died on a
  // destructure here and printed no case name at all.
  const stFind = (name) => stInvs.find((i) => i.check === name) ?? { check: '(not discovered)', direct: true };
  t(
    'the gate that shipped the red on PR #11397 is discovered, flag included',
    stNames.includes('scripts/pm/bare-root-worklist.mjs --self-test'),
  );
  t(
    '…as a DIRECT family resolving to the script file, not to the flagged key',
    stFind('scripts/pm/bare-root-worklist.mjs --self-test').script
      === 'scripts/pm/bare-root-worklist.mjs',
  );
  t(
    '…and it prints as a command a dev can paste, flag included — the bare path exits 0 without testing anything',
    runnableInvocation(stFind('scripts/pm/bare-root-worklist.mjs --self-test'))
      === 'node scripts/pm/bare-root-worklist.mjs --self-test',
  );
  // The refusal, which is the half that keeps this from being the widening
  // `hintCovers` prices at +139084 pairs: a `scripts/**` script in a `run:`
  // step is NOT a gate unless it says so.
  t(
    'a scripts/ script invoked WITHOUT the flag is not a family',
    !stNames.some((n) => String(n).includes('release-github-releases')),
  );
  // The over-match guard, both live shapes. A command text is one whole `run:`
  // body, so the flag must not travel backwards across a separator or a value.
  t(
    'a wrapper does not absorb the flag of the command it wraps — the `--` separator and the quoted --log value both stop the match',
    !stNames.some((n) => String(n).includes('run-with-stall-guard')),
  );
  t(
    'the FIRST command in a two-command body does not take the SECOND command\'s flag',
    !stNames.some((n) => String(n).includes('affected-docs')),
  );
  t(
    '…while the second command, which really carries it, is discovered',
    stNames.includes('scripts/pm/git-history.mjs --self-test'),
  );
  // The no-re-attribution property, held by construction rather than measured
  // and hoped for: a `check-` basename is already a family under its BARE path
  // key, and admitting it again under a flagged key would SPLIT it in two.
  const dualWf = [
    'jobs:',
    '  j:',
    '    steps:',
    '      - run: node scripts/check-adr-0087-registration.mjs --self-test',
  ].join('\n');
  const dualNames = extractCheckInvocations(dualWf, 'x.yml').map((i) => i.check);
  t(
    'a check- script invoked with the flag stays ONE family under its bare path key',
    dualNames.length === 1 && dualNames[0] === 'scripts/check-adr-0087-registration.mjs',
  );

  // The live halves. Fixtures cannot prove the tree changed; these read it.
  const liveSelfTestFamilies = [...discoverFamilies().byCheck].filter(([, e]) => e.selfTest);
  t(
    `the live tree really has self-test families (${liveSelfTestFamilies.length}), so the cases above judge something`,
    liveSelfTestFamilies.length > 0,
  );
  t(
    'the PR #11397 gate is one of them, on the real workflows',
    liveSelfTestFamilies.some(([c]) => c === 'scripts/pm/bare-root-worklist.mjs --self-test'),
  );
  t(
    '…and it resolves to a file that EXISTS, which is what a flagged key would have broken',
    liveSelfTestFamilies
      .filter(([c]) => c === 'scripts/pm/bare-root-worklist.mjs --self-test')
      .every(([, e]) => (e.files ?? []).length === 1 && existsSync(join(ROOT, e.files[0]))),
  );
  // The import narrowing, proven NON-VACUOUS: the module this gate imports
  // really does declare literals, and they really would have reached the tree.
  // Without that half the case below is satisfied by a module with nothing in
  // it, which is the shape a green-over-nothing pin takes.
  const bareRootEntry = liveSelfTestFamilies.find(([c]) => c === 'scripts/pm/bare-root-worklist.mjs --self-test')?.[1];
  const importedByBareRoot = firstPartyImportTargets(
    'scripts/pm/bare-root-worklist.mjs',
    readFileSync(join(ROOT, 'scripts/pm/bare-root-worklist.mjs'), 'utf8'),
  );
  const wouldHaveInherited = importedByBareRoot.flatMap((m) =>
    extractWatchHints(readFileSync(join(ROOT, m), 'utf8'), m),
  );
  t(
    `the refused inheritance is real — the modules this gate imports declare ${wouldHaveInherited.length} literal(s)`,
    wouldHaveInherited.length > 0,
  );
  t(
    'a self-test family inherits NONE of them — those literals are join bases and tier globs, the fabrication #8162 already refused by spawning',
    (bareRootEntry?.hints ?? []).length === 0 && (bareRootEntry?.hintOrigin?.size ?? 0) === 0,
  );

  // The SECOND guard, on the same live specimen (#11556). The narrowing above
  // is invocation-shaped: it holds for a `--self-test` family and nothing else,
  // so a `check-` gate importing the same modules was untouched by it. What
  // covers that caller is the module's OWN inherited-population declaration,
  // and this measures it through the follow's rule rather than through the raw
  // extractor the case above uses.
  const inheritableFromImports = importedByBareRoot.flatMap((m) => {
    const src = readFileSync(join(ROOT, m), 'utf8');
    const spelled = extractWatchHints(src, m);
    return declaredInheritedPopulation(src, spelled)?.population ?? spelled;
  });
  t(
    `a gate that IMPORTS the same modules inherits ${inheritableFromImports.length} of those ${wouldHaveInherited.length} literal(s)`,
    inheritableFromImports.length > 0 && inheritableFromImports.length < wouldHaveInherited.length,
  );
  const inhSweep = trackedFiles();
  const inhCovered = (hs) => inhSweep.filter((f) => hs.some((h) => hintCovers(h, f))).length;
  t(
    `and the price of that import drops from ${inhCovered(wouldHaveInherited)} tracked files to ${inhCovered(inheritableFromImports)}`,
    inhCovered(inheritableFromImports) < inhCovered(wouldHaveInherited),
  );
  // The direction that could SUBTRACT, asserted rather than argued: a
  // declaration is a narrowing, and a narrowing that took the real population
  // with it would read exactly like this one — fewer pairs, every gate green.
  // The tool DOES readdir the workflow tree, so every file in it must stay
  // reachable through what a follower inherits.
  t(
    'and it is not a coverage cut — every workflow file the tool really readdirs is still reachable through the declaration',
    inhSweep.filter((f) => f.startsWith('.github/workflows/')).length > 0
      && inhSweep
        .filter((f) => f.startsWith('.github/workflows/'))
        .every((f) => inheritableFromImports.some((h) => hintCovers(h, f))),
  );

  // The direction that could SUBTRACT, and the reason it is asserted rather
  // than argued: admitting these nine makes six previously-followable modules
  // GATE FILES, and `discoverFamilies` refuses to follow a gate file. Any
  // family that used to inherit a hint from one of them would silently stop —
  // and a lead that stops appearing is indistinguishable from a lead that was
  // never earned, so nothing in the output would say so. Measured here: the
  // only newly-promoted module that declares a literal at all is pr-labels.mjs
  // (`.github/labeler.yml`), and no family imports it.
  const promoted = liveSelfTestFamilies.flatMap(([, e]) => e.files ?? []);
  const subtracted = [];
  for (const [check, entry] of discoverFamilies().byCheck) {
    if (entry.selfTest) continue;
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      const src = readFileSync(join(ROOT, f), 'utf8');
      for (const mod of firstPartyImportTargets(f, src)) {
        if (!promoted.includes(mod)) continue;
        const lost = extractWatchHints(readFileSync(join(ROOT, mod), 'utf8'), mod);
        if (lost.length > 0) subtracted.push(`${check} <- ${mod} (${lost.join(', ')})`);
      }
    }
  }
  t(
    `promoting ${promoted.length} module(s) to gate files subtracts no inherited hint from any other family`
      + `${subtracted.length ? ` — LOST: ${subtracted.join(' · ')}` : ''}`,
    subtracted.length === 0,
  );

  // ── The refused fifth key, kept honest (#13126) ────────────────────────────
  // `coveringKey`'s docblock refuses an IDENTITY key over these same import
  // edges, and that refusal is a MEASUREMENT rather than a preference: it holds
  // only while the class stays concentrated in the shared utilities nearly
  // every gate links. Prose cannot notice the tree flattening under it, so the
  // price is re-derived here on every run and asserted. A red in this block is
  // not a broken derivation — it says the refusal is due a re-pricing.
  const importClassFamilies = [...discoverFamilies().byCheck];
  const importClassEdges = new Map();
  for (const [check, e] of importClassFamilies) {
    const edges = new Set();
    for (const f of e.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      for (const mod of firstPartyImportTargets(f, readFileSync(join(ROOT, f), 'utf8'))) {
        if ((e.files ?? []).includes(mod)) continue;
        edges.add(mod);
      }
    }
    importClassEdges.set(check, edges);
  }
  const importNovel = [];
  let importCoveredElsewhere = 0;
  for (const [check, e] of importClassFamilies) {
    for (const mod of importClassEdges.get(check) ?? []) {
      if (coveringKey(e, mod)) importCoveredElsewhere++;
      else importNovel.push([check, mod]);
    }
  }
  t(
    `the refused import-edge class is real and NOVEL — ${importNovel.length} (family, imported module)`
      + ` pair(s) no key reaches, of ${importNovel.length + importCoveredElsewhere}`,
    importNovel.length > 0,
  );
  t(
    `…and the split the refusal quotes is not invented: ${importCoveredElsewhere} pair(s) another key`
      + ' already answers, so the novel half is a measurement and not the raw count',
    importCoveredElsewhere > 0,
  );
  // The card's own witness, and the single lead this refusal is KNOWN to cost.
  // Asserted in both halves: the import edge exists, and no key names it.
  const bareRootKey = 'scripts/pm/bare-root-worklist.mjs --self-test';
  const bareRootImportFamily = importClassFamilies.find(([c]) => c === bareRootKey)?.[1];
  t(
    'the witness holds — bare-root-worklist --self-test imports THIS file, and no key names that'
      + ' family for a card editing it',
    (importClassEdges.get(bareRootKey)?.has('scripts/pm/dispatch-gates.mjs') ?? false)
      && !!bareRootImportFamily
      && coveringKey(bareRootImportFamily, 'scripts/pm/dispatch-gates.mjs') === null,
  );
  // Why it is refused, re-derived rather than recalled: the worst module would
  // print a list nobody reads. The bound is the header's own "22 leads is the
  // same as none", doubled — green through ordinary drift, red only if the
  // concentration genuinely collapses and the class is worth re-pricing.
  const importAddPerModule = new Map();
  for (const [, mod] of importNovel) importAddPerModule.set(mod, (importAddPerModule.get(mod) ?? 0) + 1);
  const importWorst = [...importAddPerModule]
    .map(([mod, add]) => ({
      mod,
      add,
      after: add + importClassFamilies.filter(([, e]) => coveringKey(e, mod)).length,
    }))
    .sort((a, b) => b.after - a.after);
  t(
    `the refusal is still earned — a card editing ${importWorst[0]?.mod} would name`
      + ` ${importWorst[0]?.after} families under the refused key`,
    (importWorst[0]?.after ?? 0) > 44,
  );
  const importTop5 = importWorst.slice(0, 5).reduce((s, r) => s + r.add, 0);
  t(
    `…and the class is still concentrated: ${importTop5} of ${importNovel.length} novel pair(s) land`
      + ` on ${Math.min(5, importWorst.length)} module(s)`,
    importTop5 * 2 > importNovel.length,
  );
  // The PRICE the refusal states is an AVERAGE (#13467). "The miss costs one CI
  // round" holds for a novel pair whose family some UNFILTERED workflow runs —
  // CI opens the module on that PR regardless — and does not hold for one whose
  // family no every-PR workflow runs at all: nothing on the PR repays that
  // miss. Prose cannot notice the split moving and this one has moved three
  // times, so the docblock states the SHAPE and these three assertions print
  // the sizes. A red here re-prices the paragraph; it does not fault the
  // derivation.
  const everyPRWorkflow = new Map();
  for (const wf of readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f))) {
    const wfText = readFileSync(join(ROOT, '.github/workflows', wf), 'utf8');
    // No `paths:` on a workflow that declares `pull_request` is the same
    // reading `discoverFamilies` makes when it drops such a workflow from
    // `triggers` — an unfiltered workflow discriminates nothing, which is
    // exactly why it runs on every PR.
    everyPRWorkflow.set(wf, declaresPullRequestTrigger(wfText) && extractTriggerPaths(wfText).length === 0);
  }
  const runsOnEveryPR = (e) => [...(e?.workflows ?? [])].some((wf) => everyPRWorkflow.get(wf));
  const importFamilyByCheck = new Map(importClassFamilies);
  const importDeferred = importNovel.filter(([check]) => !runsOnEveryPR(importFamilyByCheck.get(check)));
  const importDeferredWorkflows = [...new Set(
    importDeferred.flatMap(([check]) => [...(importFamilyByCheck.get(check)?.workflows ?? [])]),
  )].sort();
  t(
    `the "one CI round" price is an average, not a uniform one — ${importDeferred.length} of`
      + ` ${importNovel.length} novel pair(s) sit in families no every-PR workflow runs`
      + ` (${importDeferredWorkflows.join(', ') || 'none'}), so no CI round on the PR repays that miss`,
    importDeferred.length > 0 && importDeferred.length * 4 < importNovel.length,
  );
  // The half that keeps the exception from being over-read: a deferred pair is
  // a deferred LEAD, never a silent load break. Every module carrying one is
  // imported by every-PR families too, so a module that fails to LOAD reddens
  // the PR through a sibling; what defers is the narrower break.
  const importLoadBreakSilent = importDeferred.filter(([, mod]) =>
    !importClassFamilies.some(([c2, e2]) => runsOnEveryPR(e2) && (importClassEdges.get(c2)?.has(mod) ?? false)));
  t(
    'a deferred pair defers the LEAD, not the load break — every module carrying one is imported by'
      + ' an every-PR family as well, so failing to load still reddens the PR'
      + `${importLoadBreakSilent.length ? ` — SILENT: ${importLoadBreakSilent.map(([c, m]) => `${c} <- ${m}`).join(' · ')}` : ''}`,
    importLoadBreakSilent.length === 0,
  );
  // And they are not spread thin: the deferred pairs land on the shared heads
  // this key is refused FOR — the modules most likely to be edited into a
  // break. `fan-in <= 3` is the tail boundary the aggregate paragraph uses.
  const importFanIn = (mod) => importClassFamilies.filter(([c2]) => importClassEdges.get(c2)?.has(mod)).length;
  const importDeferredOnHeads = importDeferred.filter(([, mod]) => importFanIn(mod) > 3);
  t(
    `…and the deferred pair(s) concentrate on the heads rather than the tail:`
      + ` ${importDeferredOnHeads.length} of ${importDeferred.length} land on a module more than 3`
      + ` families import`,
    importDeferredOnHeads.length * 2 > importDeferred.length,
  );

  // #12107, the live half — three claims about THIS tree, each one a thing the
  // fix buys that a fixture cannot show.
  const tsLiveFamilies = [...discoverFamilies().byCheck];

  // 1. No gate file the derivation NAMES is a path that does not exist. This is
  //    the invariant the package-relative normalisation buys, and it is the one
  //    that catches the near-miss: widening the extensions WITHOUT normalising
  //    produced `packages/client/scripts/check-exported-any-returns.mts` — a
  //    phantom identity key that `coveringKey` would print as a `gate script`
  //    match while `existsSync` kept the file closed and the family kept
  //    reading zero hints. Measured on this tree at the fix: 0 phantoms.
  const phantomGateFiles = tsLiveFamilies.flatMap(([check, e]) =>
    (e.files ?? []).filter((f) => !existsSync(join(ROOT, f))).map((f) => `${check} -> ${f}`),
  );
  t(
    `every gate file the derivation names exists on disk${phantomGateFiles.length ? ` — PHANTOM: ${phantomGateFiles.join(' · ')}` : ''}`,
    phantomGateFiles.length === 0,
  );

  // 2. The TypeScript families really do resolve now, on the live tree rather
  //    than through a fixture — and the climbing one resolves to the ROOT path.
  const anyReturns = tsLiveFamilies.find(([c]) => c === 'check:exported-any-returns')?.[1];
  t(
    'the live TypeScript gate that climbs out of its package resolves to the tracked root path',
    (anyReturns?.files ?? []).join() === 'scripts/check-exported-any-returns.mts',
  );
  const tsFamilies = tsLiveFamilies.filter(([, e]) =>
    (e.files ?? []).some((f) => /\.(?:ts|mts|cts)$/.test(f)),
  );
  t(`the live tree resolves TypeScript-authored gates at all (${tsFamilies.length} families)`, tsFamilies.length >= 20);

  // 3. What is LEFT zero-file, and why it must stay that way. `resolveCheckToFiles`
  //    reads PATHS out of a command string; a family whose script names a package
  //    and a script NAME instead (`pnpm --filter @objectstack/cli run check:…`)
  //    carries no path for any extension list to match. It is a different
  //    mechanism and a different card, so the assertion is that every remaining
  //    zero-file family is one of those composites — never that the count is
  //    zero, which would mean this fix had absorbed a family it cannot honestly
  //    resolve.
  const rootScriptsMap = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  const zeroFile = tsLiveFamilies.filter(([, e]) => (e.files ?? []).length === 0);
  const unexplained = zeroFile
    .map(([check]) => [check, rootScriptsMap[check] ?? ''])
    .filter(([, cmd]) => !/\bpnpm\b[^&|]*?(?:--filter|--recursive|-r)\b[^&|]*?\brun\b/.test(cmd))
    .map(([check, cmd]) => `${check} (${cmd || 'no root script'})`);
  t(
    `every zero-file family left is a pnpm workspace composite, not an unmatched extension${unexplained.length ? ` — UNEXPLAINED: ${unexplained.join(' · ')}` : ''}`,
    unexplained.length === 0,
  );
  t('and there is still at least one, so the assertion above is not vacuous', zeroFile.length > 0);

  // 4. The SUBTRACTION direction, asserted the way the self-test families'
  //    promotion above asserts its own: admitting these sources makes them GATE
  //    FILES, and `discoverFamilies` refuses to follow a gate file. A family
  //    that used to inherit a hint from one of them would silently stop, and a
  //    lead that stops appearing is indistinguishable from one never earned.
  //    Measured on this tree: none of the newly admitted sources is imported by
  //    any gate at all — all 12 modules this tree follows live in the root
  //    `scripts/` dir, and 22 of the 23 admitted sources live under
  //    `packages/spec/scripts/`. The 23rd (`scripts/check-exported-any-returns.mts`)
  //    is imported by nothing.
  const admittedTs = tsLiveFamilies.flatMap(([, e]) => (e.files ?? []).filter((f) => /\.(?:ts|mts|cts)$/.test(f)));
  const tsSubtracted = [];
  for (const [check, entry] of tsLiveFamilies) {
    if (entry.selfTest) continue;
    for (const f of entry.files ?? []) {
      if (/\.(?:ts|mts|cts)$/.test(f)) continue;
      if (!existsSync(join(ROOT, f))) continue;
      for (const mod of firstPartyImportTargets(f, readFileSync(join(ROOT, f), 'utf8'))) {
        if (!admittedTs.includes(mod)) continue;
        const lost = extractWatchHints(readFileSync(join(ROOT, mod), 'utf8'), mod);
        if (lost.length > 0) tsSubtracted.push(`${check} <- ${mod} (${lost.join(', ')})`);
      }
    }
  }
  t(
    `admitting ${admittedTs.length} TypeScript gate source(s) subtracts no inherited hint from any other family`
      + `${tsSubtracted.length ? ` — LOST: ${tsSubtracted.join(' · ')}` : ''}`,
    tsSubtracted.length === 0,
  );

  // `runCommandTexts` on its own: one entry per step, in file order.
  const texts = runCommandTexts(blockWf);
  t('one command text per run step', texts.length === 4);
  t('a block body keeps its lines joined', texts[0].split('\n').filter((l) => l.trim()).length === 2);
  t('a one-line run yields its command verbatim', texts[3] === 'node scripts/check-nul-bytes.mjs');

  // The compact step form (#9203): `- run: …`, a block-sequence entry with the
  // key on the dash line. Before it was read, every command in a step written
  // this way was invisible to the derivation.
  //
  // The `env:` values are the load-bearing part of the fixture, not padding.
  // They name gates the steps do NOT run, positioned exactly where a body walk
  // that mis-reads `indent` swallows them — the compact one sits in the columns
  // the `- ` marker occupies, which is the only place the two candidate
  // readings disagree. Pinning the classic form's `env:` too keeps the two step
  // shapes asserted against the same trap, so a future edit cannot fix one
  // reading by breaking the other.
  const compactWf = [
    'jobs:',
    '  smoke:',
    '    steps:',
    '      - name: Classic block, sibling key after the body',
    '        run: |',
    '          pnpm check:classic-body',
    '        env:',
    '          NOTE: "we do not run pnpm check:phantom-classic here"',
    '      - run: pnpm --filter @objectstack/spec check:compact-one-liner',
    '      - run: |',
    '          pnpm check:compact-body',
    '          node scripts/check-compact-direct.mjs',
    '        env:',
    '          NOTE: "we do not run pnpm check:phantom-compact here"',
    '      - run: node scripts/check-compact-tail.mjs',
    '      - name: Back to the named form',
    '        run: pnpm check:after-compact',
  ].join('\n');
  const compactInvs = extractCheckInvocations(compactWf, 'showcase-smoke.yml');
  const compactNames = compactInvs.map((i) => i.check);
  // Leg 1 — the form is now REACHED. Each of these was zero before #9203.
  t('a compact `- run:` one-liner is discovered, with its filter', compactInvs.some((i) => i.check === 'check:compact-one-liner' && i.filter === '@objectstack/spec'));
  t('a compact `- run: |` block body is discovered', compactNames.includes('check:compact-body'));
  t('a direct script in a compact block body is discovered', compactNames.includes('scripts/check-compact-direct.mjs'));
  t('a compact step after a compact block body still parses', compactNames.includes('scripts/check-compact-tail.mjs'));
  // Leg 2 — the widening bought no over-consumption. `indent` counts the `- `,
  // so a compact block body ends at its own sibling keys exactly as the named
  // form's does; both directions of the mis-read fabricate a gate here.
  t('a compact block body ends at the `env:` key of its own step', !compactNames.includes('check:phantom-compact'));
  t('the named form still ends its block body at the `env:` key', !compactNames.includes('check:phantom-classic'));
  t('the step after a compact block body is not swallowed by it', compactNames.includes('check:after-compact'));
  const compactTexts = runCommandTexts(compactWf);
  // Indexed reads are defaulted rather than asserted-then-dereferenced: under a
  // parser that drops the compact form entirely there is no element 2, and a
  // bare `compactTexts[2].split(…)` THROWS out of the whole self-test — the
  // reverse-verification run for this card hit exactly that and got one stack
  // trace where it needed a list of named failures. A gate that cannot say
  // which case broke is a worse gate, even when it is correctly red.
  t('one command text per compact step too', compactTexts.length === 5);
  t('a compact block body keeps both of its lines', (compactTexts[2] ?? '').split('\n').filter((l) => l.trim()).length === 2);
  t('a compact one-liner yields its command verbatim', compactTexts[1] === 'pnpm --filter @objectstack/spec check:compact-one-liner');
  // A `-` that is not a list marker must not be read as one: `-run:` is a key
  // named `-run`, and `- name:` is a step whose `run:` comes later on its own
  // line (already covered above, but the negative half needs its own pin).
  t('a bare `-run:` is not read as a compact step', runCommandTexts('      -run: pnpm check:not-a-step').length === 0);

  // #7440: the printed line must be runnable as-is. The three shapes come from
  // the same three fixtures above, so the sample workflow and the print site
  // cannot drift apart.
  const inv = (name) => invs.find((i) => i.check === name);
  t('prints a package-scoped check as its full --filter invocation', runnableInvocation(inv('check:authorable-surface')) === 'pnpm --filter @objectstack/spec run check:authorable-surface');
  t('prints a root-scoped check unchanged', runnableInvocation(inv('check:engine-double-contract')) === 'pnpm check:engine-double-contract');
  t('prints a direct script as a node invocation', runnableInvocation(inv('scripts/check-nul-bytes.mjs')) === 'node scripts/check-nul-bytes.mjs');

  const scripts = { 'check:foo': 'node scripts/check-foo.mjs --self-test && node scripts/check-foo.mjs' };
  t('resolves script file from package.json', resolveCheckToFiles('check:foo', scripts).join() === 'scripts/check-foo.mjs');
  t('unknown check resolves to nothing', resolveCheckToFiles('check:bar', scripts).length === 0);

  // #12107 — the extension list. Each of the three TypeScript spellings is a
  // case the OLD alternation (`mjs|cjs|js|sh`) resolved to nothing, which is
  // why they are pinned separately rather than as one representative: the
  // defect was an alternation, and an alternation regresses one branch at a
  // time.
  const tsScripts = {
    'check:ts': 'tsx scripts/check-generated.ts',
    'check:mts': 'tsx scripts/check-variant-docs.mts',
    'check:cts': 'tsx scripts/check-legacy.cts',
    'check:mixed': 'node scripts/pre.mjs && tsx scripts/check-generated.ts',
  };
  t('resolves a .ts gate script — zero-file under the old alternation', resolveCheckToFiles('check:ts', tsScripts).join() === 'scripts/check-generated.ts');
  t('resolves a .mts gate script', resolveCheckToFiles('check:mts', tsScripts).join() === 'scripts/check-variant-docs.mts');
  t('resolves a .cts gate script', resolveCheckToFiles('check:cts', tsScripts).join() === 'scripts/check-legacy.cts');
  t('a command naming both an .mjs and a .ts file yields both', resolveCheckToFiles('check:mixed', tsScripts).join() === 'scripts/pre.mjs,scripts/check-generated.ts');
  // The negative half of the alternation: widening it must not admit every
  // extension. A `.json` argument is data the gate READS, not a file it runs,
  // and the hint scan is what places those.
  t('a data file argument is still not a gate script', resolveCheckToFiles('check:x', { 'check:x': 'tsx scripts/check-x.mts scripts/fixtures/pins.json' }, { dir: '' }).join() === 'scripts/check-x.mts');
  t('nor a .tsx file, the one this widening would newly have mis-matched as .ts', resolveCheckToFiles('check:x', { 'check:x': 'tsx scripts/render.tsx' }).length === 0);
  t('while the extension it is a prefix of still resolves', resolveCheckToFiles('check:x', { 'check:x': 'tsx scripts/render.ts' }).join() === 'scripts/render.ts');

  // #12107 point 1 — a package manifest spells its script relative to ITSELF,
  // so the manifest's directory is an input to the resolution, not a prefix
  // the caller staples on afterwards.
  const pkgScripts = {
    'check:in-package': 'tsx scripts/build-docs.ts --check',
    'check:climbing': 'tsx ../../scripts/check-exported-any-returns.mts --self-test && tsx ../../scripts/check-exported-any-returns.mts --package packages/client',
    'check:escaping': 'tsx ../../../../scripts/check-elsewhere.mjs',
  };
  t('a package-local spelling lands under the package that declares it', resolveCheckToFiles('check:in-package', pkgScripts, { dir: 'packages/spec' }).join() === 'packages/spec/scripts/build-docs.ts');
  t('a spelling that climbs out of its package normalises to the tracked repo path', resolveCheckToFiles('check:climbing', pkgScripts, { dir: 'packages/client' }).join() === 'scripts/check-exported-any-returns.mts');
  // The regression this normalisation exists for, stated as the wrong answer
  // rather than only as the right one: with the extensions widened and the
  // climb prefix dropped, this resolved to a path that does not exist, and the
  // family left the honest `undetermined` bucket while still reading no hints.
  t('and never to the package-prefixed path that does not exist', !resolveCheckToFiles('check:climbing', pkgScripts, { dir: 'packages/client' }).includes('packages/client/scripts/check-exported-any-returns.mts'));
  t('the twice-named climbing script is ONE file, deduped on the normalised path', resolveCheckToFiles('check:climbing', pkgScripts, { dir: 'packages/client' }).length === 1);
  t('a spelling that climbs clear of the repo root is dropped, not returned unnameable', resolveCheckToFiles('check:escaping', pkgScripts, { dir: 'packages/client' }).length === 0);
  t('an absent dir leaves a root-manifest spelling exactly as it was', resolveCheckToFiles('check:foo', scripts).join() === 'scripts/check-foo.mjs');

  const src = [
    "const DIR = '.claude/agents';",
    "const GLOB = 'packages/spec/src/**/*.zod.ts';",
    "const URL2 = 'https://example.com/x';",
    "const FLAG = '--self-test';",
    "const WORD = 'hello';",
  ].join('\n');
  const hints = extractWatchHints(src);
  t('finds dotted-dir hint', hints.includes('.claude/agents'));
  t('finds glob hint', hints.some((h) => h.startsWith('packages/spec/src')));
  t('skips urls', !hints.some((h) => h.includes('example.com')));
  t('skips flags and bare words', !hints.includes('--self-test') && !hints.includes('hello'));

  // ── What a gate READS vs what its source MENTIONS (#8478) ─────────────────
  //
  // Both halves are pinned in both directions, because both directions are the
  // product: a path in prose or in a fixture must NOT be a hint, and a path the
  // module body really opens must still be one. The fabricated half is the
  // expensive one — a false lead is pasted into every dispatch prompt whose
  // surface brushes it — but a narrowing that also drops the real inputs would
  // just move the dishonesty.
  // Every path a comment case names is QUOTED inside that comment, because the
  // scan only ever reads quoted spans: an unquoted path in prose is invisible
  // to it with or without masking, so a fixture spelling one bare would assert
  // nothing and pass forever. Measured — the first draft of the two cases below
  // did exactly that, and only the reverse-verification run that removed the
  // comment mask showed them staying green through it.
  const commented = [
    '/**',
    ' * Reads `packages/spec/src` and `.changeset/x.md` — prose, not inputs.',
    ' */',
    "const REAL = 'packages/rest/src';   // twin of 'packages/core/src', says the comment",
    "const U = 'https://example.com/a/b'; const AFTER_URL = 'packages/metadata/src';",
    "const RE = /['\"`]/;",
    "const AFTER_REGEX = 'packages/client/src';",
  ].join('\n');
  const commentHints = extractWatchHints(commented);
  t('a backticked path in a block comment is not a hint', !commentHints.includes('packages/spec/src'));
  t('a dotted path in a block comment is not a hint', !commentHints.some((h) => h.startsWith('.changeset')));
  t('a path in a trailing line comment is not a hint', !commentHints.includes('packages/core/src'));
  t('the module-body literal on that same line still is', commentHints.includes('packages/rest/src'));
  // The two traps that make this a scan and not a regex: `//` inside a URL is
  // not a comment, and a quote character inside a regex literal does not open a
  // string. Either mistake blanks real code — silently, and only downstream.
  t('a `//` inside a string does not start a comment', commentHints.includes('packages/metadata/src'));
  t('a quote inside a regex literal does not open a string', commentHints.includes('packages/client/src'));
  t('masking preserves every offset', maskComments(commented).length === commented.length);

  // ...and the re-export of that masker is CODE, not comment text (#9640). The
  // statement sits at the end of the longest docblock in this file, and a
  // missing `*/` swallows it into prose that still parses: the module then has
  // no `maskComments` export while its header says it has one, and nothing goes
  // red — every gate stayed green over it until someone parsed for it. Asked of
  // this file's own source with this file's own masker, which is what the
  // docblock claims. Column 0 only, and a match the scan flags as literal is
  // rejected, so no fixture spelling in this self-test can stand in for the
  // statement.
  const ownSource = readFileSync(new URL(import.meta.url), 'utf8');
  const ownScan = scanSource(ownSource);
  t(
    'the maskComments re-export is code, not comment text',
    [...ownSource.matchAll(/^export \{ maskComments \};$/gm)].some(
      (m) => !ownScan.comment[m.index] && !ownScan.literal[m.index],
    ),
  );

  // The self-test boundary. The fixture puts a column-0 `}` inside a template
  // literal on purpose: that is the shape this tree really has (a check script
  // whose self-test embeds TS sources as fixtures), and a boundary that stopped
  // at the first column-0 `}` would end the mask there and leak every fixture
  // after it — measured on `scripts/check-engine-double-contract.mjs`, whose
  // self-test carries 24 such braces and whose last fixture path sits 400 lines
  // past the first one.
  const withSelfTest = [
    "const REAL = 'packages/runtime/src';",
    'function selfTest() {',
    "  const FIXTURE = 'packages/spec/src/data/filter.zod.ts';",
    '  const embedded = `',
    '}',
    "  const AFTER_BRACE = 'packages/objectql/src';",
    '  `;',
    '}',
    "const TAIL = 'docs/adr';",
  ].join('\n');
  const bodyHints = extractWatchHints(withSelfTest);
  t('a fixture path inside the self-test is not a hint', !bodyHints.includes('packages/spec/src/data/filter.zod.ts'));
  t('a column-0 brace inside a fixture does not end the self-test', !bodyHints.includes('packages/objectql/src'));
  t('the module body before the self-test still hints', bodyHints.includes('packages/runtime/src'));
  t('the module body after the self-test still hints', bodyHints.includes('docs/adr'));
  const otherSpellings = [
    'async function selfTest() {',
    "  const A = 'packages/aaa/src';",
    '}',
    'function fixtureSelfTest() {',
    "  const B = 'packages/bbb/src';",
    '}',
    'const box = {',
    '  run() {',
    "    const NESTED = 'packages/ccc/src';",
    '  },',
    '};',
  ].join('\n');
  const spellingHints = extractWatchHints(otherSpellings);
  t('an async self-test is masked too', !spellingHints.includes('packages/aaa/src'));
  t('a compound self-test name is masked too', !spellingHints.includes('packages/bbb/src'));
  t('an ordinary nested function is NOT masked', spellingHints.includes('packages/ccc/src'));
  // Composition order: comments are masked first, so a self-test declaration
  // QUOTED in a docblock (this file is full of them) cannot anchor a mask over
  // real code below it.
  const declInComment = [
    '/*',
    'function selfTest() {',
    '*/',
    "const REAL = 'packages/ddd/src';",
  ].join('\n');
  t('a self-test declaration inside a comment anchors nothing', extractWatchHints(declInComment).includes('packages/ddd/src'));

  // ── The helpers the self-test CALLS ──────────────────────────────────────
  //
  // `SELF_TEST_DECL` finds the ENTRY POINT by name, and a fixture builder is
  // named for what it builds, so its body used to survive the mask whole.
  // Measured specimen, live on this tree:
  // `scripts/pm/release-rehearsal-clone.mjs` commits a fixture `.changeset`
  // tree inside `makeSource`, and its two entries were read as paths that gate
  // OPENS — the residue printed "the tree stops at .changeset; the layout moved
  // under it" for them, a directory rename that never happened.
  //
  // The safety half is pinned beside it: a helper the module body can also
  // reach is a path the gate really reads, and must survive.
  const helperFixtures = [
    "const REAL = 'packages/runtime/src';",
    'function makeFixture(root) {',
    "  write(root, 'packages/fixture-only/one.ts');",
    '}',
    'function shared() {',
    "  return 'packages/shared/src';",
    '}',
    'function unreferenced() {',
    "  return 'packages/dead/src';",
    '}',
    'export function alsoExported() {',
    "  return 'packages/exported/src';",
    '}',
    'function selfTest() {',
    '  makeFixture(tmp);',
    '  shared();',
    '  alsoExported();',
    '}',
    'function run() {',
    '  return shared();',
    '}',
    'run();',
  ].join('\n');
  const helperHints = extractWatchHints(helperFixtures);
  t(
    'a fixture literal in a helper only the self-test calls is not a hint',
    !helperHints.includes('packages/fixture-only/one.ts'),
  );
  t('…but a helper the module body also reaches keeps its literal', helperHints.includes('packages/shared/src'));
  t('…and a declaration nothing references at all is left alone', helperHints.includes('packages/dead/src'));
  t('…and an exported helper is reachable from outside this file, so it stays', helperHints.includes('packages/exported/src'));
  t('the module body around them still hints', helperHints.includes('packages/runtime/src'));

  // Transitive, and through a signature that carries braces. Counting the
  // SIGNATURE's braces closes the body before it opens — the mask then covers
  // 29 characters and reports success, which is how
  // `function makeSource(root, name, { branch = 'main', … } = {})` reads.
  const transitiveHelpers = [
    'function writeOne(root, rel) {',
    "  return rel === 'packages/leaf/fixture.ts';",
    '}',
    'function buildTree(root, { depth = 0 } = {}) {',
    "  writeOne(root, 'packages/branch/fixture.ts');",
    '}',
    'function selfTest() {',
    '  buildTree(root);',
    '}',
  ].join('\n');
  const transitiveHints = extractWatchHints(transitiveHelpers);
  t('a helper reached only THROUGH another helper is masked too', !transitiveHints.includes('packages/leaf/fixture.ts'));
  t(
    'a destructured default in the signature does not end the body early',
    !transitiveHints.includes('packages/branch/fixture.ts'),
  );

  // ── The anchor fires on NAMES, so it also fires on production code ───────
  //
  // Live, over the tracked tree, against `COMPOUND_ANCHOR_LEDGER`. The census
  // and the argument for measuring rather than narrowing are at that table;
  // what runs here is the half that can go red.
  //
  // Read the three assertions as one instrument. The first says the population
  // has not moved under the table. The second says masking the accidental half
  // still costs no hint — the claim the ledger makes in prose, re-measured on
  // every run, so the day someone writes a path literal into `maskSelfTests`,
  // `carriesSelfTest` or any other accidental row, THIS goes red and names the
  // hint instead of dropping it in silence. The third is the control that makes
  // the second mean anything: a counterfactual that silently failed to rename
  // would report "no hint moves" for every row, which is indistinguishable from
  // a pass, so at least one GENUINE row must be seen to move a hint.
  {
    const census = new Map();
    for (const rel of trackedFiles()) {
      if (!ANCHOR_CENSUS_EXTENSIONS.test(rel)) continue;
      let text;
      try {
        text = readFileSync(join(ROOT, rel), 'utf8');
      } catch {
        continue;
      }
      if (!/[Ss]elf[_]?[Tt]est/.test(text)) continue;
      for (const decl of compoundAnchorDecls(text)) census.set(`${rel}::${decl.name}`, rel);
    }
    const unlisted = [...census.keys()].filter((k) => !COMPOUND_ANCHOR_KEYS.has(k)).sort();
    const stale = [...COMPOUND_ANCHOR_KEYS.keys()].filter((k) => !census.has(k)).sort();
    t(
      `every compound self-test NAME the anchor matches is classified in COMPOUND_ANCHOR_LEDGER` +
        (unlisted.length ? ` — unlisted: ${unlisted.join(', ')}` : '') +
        (stale.length ? ` — listed but gone: ${stale.join(', ')}` : ''),
      unlisted.length === 0 && stale.length === 0,
    );

    const costly = [];
    const movers = [];
    for (const [key, accidental] of COMPOUND_ANCHOR_KEYS) {
      const rel = census.get(key);
      if (!rel) continue;
      const name = key.slice(rel.length + 2);
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const alt = withoutAnchor(src, name);
      if (alt === null || compoundAnchorDecls(alt).length !== compoundAnchorDecls(src).length - 1) {
        costly.push(`${key} (the counterfactual rename did not land — this row was NOT measured)`);
        continue;
      }
      const before = extractWatchHints(src, rel);
      const after = extractWatchHints(alt, rel);
      const dropped = after.filter((h) => !before.includes(h));
      if (dropped.length === 0) continue;
      if (accidental) costly.push(`${key} now hides ${JSON.stringify(dropped)}`);
      else movers.push(key);
    }
    t(
      'masking an ACCIDENTAL name match still costs this tree no watch hint' +
        (costly.length ? ` — ${costly.join('; ')}` : ''),
      costly.length === 0,
    );
    t(
      'control: at least one GENUINE self-test battery is seen to lose a fixture hint, so the ' +
        'measurement above is an instrument and not a broken rename reporting zero everywhere',
      movers.length > 0,
    );
  }

  // The card's own specimen, pinned by identity: this module's masker and the
  // helper predicate beside it are both named into the anchor's population, so a
  // rename that "fixes" either one has to move the ledger row rather than the
  // problem.
  {
    const selfCensus = compoundAnchorDecls(readFileSync(join(ROOT, 'scripts/pm/dispatch-gates.mjs'), 'utf8'));
    const names = selfCensus.map((d) => d.name);
    t("this module's own masker is in the anchor's population", names.includes('maskSelfTests'));
    t('…and so is the reachability helper beside it', names.includes('selfTestOnlyCallables'));
  }

  // A population DECLARED for this very scanner is referenced by no executing
  // code — being unreferenced is what such a declaration IS. Extending the mask
  // to value declarations was implemented and REFUSED on this evidence: over
  // the 204 scripts this derivation scans it took 175 hints from 36 files
  // instead of 104 from 9, and the 71 extra were the declared populations of
  // eight gates (`ROOT_DIR_WATCH_HINTS` and its spellings).
  const declaredPopulation = [
    "const ROOT_DIR_WATCH_HINTS = ['packages/drivers/**'];",
    'function selfTest() {',
    '  return ROOT_DIR_WATCH_HINTS;',
    '}',
  ].join('\n');
  t(
    'a declaration constant only the self-test names is still a declaration',
    extractWatchHints(declaredPopulation).includes('packages/drivers/**'),
  );

  // `${…}` is CODE, and reading it as string text is not academic: the live
  // specimen names its own path only from inside template literals, so a scan
  // blind to interpolations finds that constant unreferenced and masks the one
  // hint the file really declares.
  const interpolatedReference = [
    'function banner() {',
    "  return 'scripts/pm/thing.mjs';",
    '}',
    'function usage() {',
    '  return `node ${banner()} --help`;',
    '}',
    'function selfTest() {',
    '  banner();',
    '}',
    'usage();',
  ].join('\n');
  t(
    'a reference from inside a template interpolation keeps a helper alive',
    extractWatchHints(interpolatedReference).includes('scripts/pm/thing.mjs'),
  );

  // The specimen itself, on the live tree rather than in a fixture — both
  // directions, so a future edit that deletes the file or empties its
  // declaration cannot leave this green by vacuity.
  const rehearsalPath = 'scripts/pm/release-rehearsal-clone.mjs';
  const rehearsalAbs = join(ROOT, rehearsalPath);
  t('the fixture-in-helper specimen is still on the tree', existsSync(rehearsalAbs));
  if (existsSync(rehearsalAbs)) {
    const rehearsalHints = extractWatchHints(readFileSync(rehearsalAbs, 'utf8'), rehearsalPath);
    t(
      'the fixture changesets it commits are not hints',
      !rehearsalHints.some((h) => /^\.changeset\/(one|two)\.md$/.test(h)),
    );
    t('…while the population it really declares survives', rehearsalHints.includes('.changeset/*.md'));
    t('…and so does its own path', rehearsalHints.includes(rehearsalPath));
  }
  // Module-relative spellings: `new URL('../../x', import.meta.url)` is how
  // these scripts name a repo path, and the leading segments are the script's
  // own depth, not part of what it watches.
  const relative = ["const P = new URL('../../.claude/agents/os-dev.md', import.meta.url);", "const R = '../..';"].join('\n');
  const relHints = extractWatchHints(relative);
  t('a module-relative path is normalised to repo-relative', relHints.includes('.claude/agents/os-dev.md'));
  t('a literal that is nothing but dots names no file', !relHints.some((h) => h.startsWith('..')));

  // ── The literal is RESOLVED against its writer, never stripped (#12371) ───
  //
  // The strip assumed the writer sits at the depth its own `../` run climbs to.
  // That holds for `scripts/*.mjs` and FAILS for a gate inside a package, whose
  // `'./lib/x'` came out as the top-level `lib/x` — a string this tree has no
  // `lib/` for, while the file it names is on disk. Both directions are pinned:
  // what MUST convert, and what must NOT.
  const insideAPackage = "import { f } from './lib/dist-freshness';\nconst S = '../src/kernel/protocol-version';";
  const pkgHints = extractWatchHints(insideAPackage, 'packages/spec/scripts/check-x.ts');
  t(
    'a gate inside a package resolves its own-directory literal against ITSELF',
    pkgHints.includes('packages/spec/scripts/lib/dist-freshness'),
  );
  t(
    '…and a `../` literal against its parent, not against the repo root',
    pkgHints.includes('packages/spec/src/kernel/protocol-version'),
  );
  t(
    'the top-level spelling the strip used to produce is GONE, not merely joined',
    !pkgHints.includes('lib/dist-freshness') && !pkgHints.includes('src/kernel/protocol-version'),
  );
  // The no-op half, and the reason the widening is cheap: a writer that really
  // does sit at the depth it climbs gets the same hint it always got.
  t(
    'a literal already spelled from the root by a writer at that depth is unchanged',
    extractWatchHints("const P = '../../packages/spec/src';", 'scripts/pm/x.mjs').includes('packages/spec/src'),
  );
  t(
    'a literal carrying no relative prefix is untouched by the resolve',
    extractWatchHints("const P = 'packages/spec/src';", 'packages/spec/scripts/check-x.ts').includes('packages/spec/src'),
  );
  // MUST NOT convert. Admission still reads the literal as the author wrote it,
  // so a single-segment sibling specifier is no hint at all — the same refusal
  // `hintCovers`' docblock states for a bare filename. Admitting it would hand
  // every gate its own import specifiers as a watched population, a second and
  // unpriced answer to the question `firstPartyImportTargets` owns.
  //
  // Both are asserted WITH the live tree, never without one. The refusal is
  // cheap to pass for the wrong reason — a call with no tree refuses every
  // single-segment literal — so a pin that omitted it would be green whatever
  // `moduleRelativeDirectoryHint` did.
  const hintTree = watchHintTree();
  const isTrackedDir = (p) => hintTree.prefixes.has(p) && !hintTree.files.has(p);
  t(
    'a single-segment sibling specifier does NOT convert into a hint',
    extractWatchHints("import { invokedAs } from './invoked-as.mjs';", 'scripts/check-x.mjs', { tree: hintTree })
      .length === 0,
  );
  t(
    '…and it is refused because the resolve lands on a tracked FILE, not for want of a tree',
    hintTree.files.has('scripts/invoked-as.mjs') && !isTrackedDir('scripts/invoked-as.mjs'),
  );
  t(
    '…nor does a bare sibling manifest name',
    extractWatchHints("const P = './package.json';", 'scripts/check-x.mjs', { tree: hintTree }).length === 0,
  );

  // ── ONE class IS admitted back: a single-segment literal whose resolve lands
  // ── on a tracked DIRECTORY (#12470)
  //
  // `moduleRelativeDirectoryHint` carries the split of the 53 hints the naive
  // widening adds and the judgement that puts this class apart from the two
  // `hintCovers` refuses. Pinned here as the four things a reader needs to be
  // able to break: that it FIRES, WHERE the admitted hint lands, and the two
  // structural refusals that keep it from becoming either of its neighbours.
  const specDirLiteral = "const SRC_DIR = path.resolve(__dirname, '../src');";
  t(
    'a single-segment literal resolving to a tracked directory DOES convert',
    extractWatchHints(specDirLiteral, 'packages/spec/scripts/build-docs.ts', { tree: hintTree }).join() ===
      'packages/spec/src',
    extractWatchHints(specDirLiteral, 'packages/spec/scripts/build-docs.ts', { tree: hintTree }).join(),
  );
  t(
    '…and without a tree the same call keeps the standing refusal — a missing lead, never a fabricated one',
    extractWatchHints(specDirLiteral, 'packages/spec/scripts/build-docs.ts').length === 0,
  );
  // ARRIVAL, not departure. That the literal left the refused set says nothing
  // about which family it reaches or which files: both live gates are named,
  // and each is shown to reach a real file under the directory that NO other
  // hint of that family reaches — so the pair is this rule's, not a coincidence
  // of some other hint already covering the tree there.
  const dirLanding = discoverFamilies({ tree: hintTree }).byCheck;
  const specSrcFile = trackedFiles().find((f) => f.startsWith('packages/spec/src/'));
  for (const check of ['check:docs', 'check:skill-refs']) {
    const entry = dirLanding.get(check);
    t(
      `${check} carries the admitted directory hint`,
      (entry?.hints ?? []).includes('packages/spec/src'),
    );
    t(
      `…and it is what reaches ${specSrcFile} for ${check} — no other hint of that family does`,
      Boolean(specSrcFile) &&
        (entry?.hints ?? []).filter((h) => hintCovers(h, specSrcFile)).join() === 'packages/spec/src',
    );
  }
  // The BLAST RADIUS, both directions, over the live fleet: which families this
  // rule changes at all. Read as the difference between the discovery WITH the
  // tree and the same discovery WITHOUT one, so it measures the rule and not
  // the tree — `packages/spec/src` is already a hint several other gates spell
  // from the root, and asking "who carries it" would count those too.
  const withoutTree = discoverFamilies({ tree: null }).byCheck;
  const dirGained = [];
  const dirLost = [];
  for (const [check, entry] of dirLanding) {
    const before = new Set(withoutTree.get(check)?.hints ?? []);
    for (const h of entry.hints ?? []) if (!before.has(h)) dirGained.push(`${check} +${h}`);
    for (const h of before) if (!(entry.hints ?? []).includes(h)) dirLost.push(`${check} -${h}`);
  }
  t(
    'the rule changes exactly the two gates that walk packages/spec/src, and adds exactly the directory they walk',
    dirGained.join(' · ') === 'check:docs +packages/spec/src · check:skill-refs +packages/spec/src',
    dirGained.join(' · '),
  );
  t(
    'and it takes NOTHING away — a widening that also subtracted would read exactly like this one',
    dirLost.length === 0,
    dirLost.join(' · '),
  );

  // REFUSAL 1 — module-relative ONLY. `resolve` treats a bare word exactly like
  // a `./` one, so without this the rule reads any bare word against its
  // writer's directory and becomes the bare-word class one gate at a time. The
  // specimen is the sharpest one on the tree: a member of
  // check-error-status-conformance's SKIP_DIRS, a directory the gate DECLARES
  // it does not read, which the tree happens to have under `scripts/`.
  t(
    'a BARE word is not resolved against its writer, even when that lands on a tracked directory',
    extractWatchHints("const SKIP = new Set(['fixtures']);", 'scripts/check-x.mjs', { tree: hintTree }).length === 0,
  );
  t(
    '…and that refusal is non-vacuous: scripts/fixtures IS a tracked directory the resolve would have found',
    isTrackedDir('scripts/fixtures'),
  );
  // REFUSAL 2 — the resolved form must carry a SEPARATOR. A bare root would
  // build a hint `hintCovers` refuses on its own bare-word rule, reaching
  // nothing and landing as a fresh row in the SHRINK-ONLY escapable-literal
  // ledger. Refusing it here makes that structural rather than lucky.
  t(
    'a single-segment literal that resolves to a bare ROOT is refused',
    extractWatchHints("const P = '../../skills';", 'scripts/pm/x.mjs', { tree: hintTree }).length === 0,
  );
  t(
    '…non-vacuously: skills IS a tracked directory, and a hint spelling it would reach nothing anyway',
    isTrackedDir('skills') && !trackedFiles().some((f) => hintCovers('skills', f)),
  );
  // The #12794 boundary, asserted as the structural exclusion it is rather than
  // as a count. `extensionlessModuleTarget` refuses any hint the tree has as a
  // prefix, and this rule admits ONLY hints the tree has as a prefix — so no
  // literal can be both a tracked-directory hint and an extensionless module
  // target, on this tree or any other.
  t(
    'a single-segment literal whose target the tree has only under a dropped extension is NOT admitted',
    extractWatchHints("import { invokedAs } from './invoked-as';", 'scripts/check-x.mjs', { tree: hintTree })
      .length === 0,
  );
  t(
    '…non-vacuously: had it been admitted, hintCovers would have matched the file through the extension rule',
    hintCovers('scripts/invoked-as', 'scripts/invoked-as.mjs'),
  );
  t(
    'the two rules are mutually exclusive by construction — an admitted directory is a tracked prefix, which extensionlessModuleTarget refuses',
    extensionlessModuleTarget('packages/spec/src', hintTree.files, hintTree.prefixes) === null &&
      isTrackedDir('packages/spec/src'),
  );
  t(
    'a literal that climbs out of the repo names nothing',
    extractWatchHints("const P = '../../../elsewhere/x/y';", 'scripts/check-x.mjs').length === 0,
  );
  t(
    'and one that resolves to the repo root itself names nothing — it would cover the tree',
    resolveModuleRelativeHint('../..', 'scripts/pm/x.mjs') === null,
  );
  // A caller with no path keeps the strip: not every caller has a writer to
  // resolve against, and a missing lead is the direction this file errs in.
  t(
    'a caller that passes no script path still gets the stripped spelling',
    extractWatchHints("import { f } from './lib/dist-freshness';").includes('lib/dist-freshness'),
  );
  // One resolver, not two. `firstPartyImportTargets` answers the same question
  // for the import follow; if they could disagree, one of them is the copy
  // nobody re-measured.
  t(
    'the hint resolve and the import follow agree on a shared specimen',
    resolveModuleRelativeHint('./invoked-as.mjs', 'scripts/check-doc-anchors.mjs') ===
      firstPartyImportTargets('scripts/check-doc-anchors.mjs', "import { invokedAs } from './invoked-as.mjs';")[0],
  );
  // LIVE, on this tree: the specimen the card was filed for, driven through
  // `hintCovers` — never through `collapseHint` and never re-implemented.
  const liveSchemaHints = extractWatchHints(
    readFileSync(join(ROOT, 'packages/spec/scripts/build-schemas.ts'), 'utf8'),
    'packages/spec/scripts/build-schemas.ts',
  );
  t(
    'the live spec builder names its own src subtree, resolved',
    liveSchemaHints.includes('packages/spec/src/data'),
  );
  t(
    '…and that hint really reaches a tracked file, which the stripped spelling never did',
    hintCovers('packages/spec/src/data', 'packages/spec/src/data/field.zod.ts') &&
      !hintCovers('src/data', 'packages/spec/src/data/field.zod.ts'),
  );
  // The residue's claim stops being false: a resolved literal HAS a tracked
  // prefix, so `unreachableReason` no longer files it as "never was a repo path"
  // about a file that exists.
  //
  // ⚠️ This case asserted ONLY `Boolean(deepest)` — that the hint had LEFT the
  // "never" branch — and leaving that branch is precisely what puts a hint into
  // the "layout moved" one, so it stayed green through a false reason it never
  // looked at (#12299). A departure pin cannot see an arrival: both ends are
  // asserted here now, on the same live specimen.
  const distFreshnessFiles = trackedFiles();
  const distFreshnessDead = [
    {
      hint: 'packages/spec/scripts/lib/dist-freshness',
      deepest: deepestTrackedPrefix('packages/spec/scripts/lib/dist-freshness', trackedPrefixes(distFreshnessFiles)),
      target: extensionlessModuleTarget(
        'packages/spec/scripts/lib/dist-freshness',
        new Set(distFreshnessFiles),
        trackedPrefixes(distFreshnessFiles),
      ),
    },
  ];
  t(
    'a resolved dead hint has a tracked prefix, so the residue stops calling it "never a repo path"',
    Boolean(distFreshnessDead[0].deepest) && !/never was a repo path/.test(unreachableReason(distFreshnessDead)),
  );
  t(
    '...and it does NOT arrive at "the layout moved" instead — the tree HAS the file, named',
    !/layout moved/.test(unreachableReason(distFreshnessDead)) &&
      unreachableReason(distFreshnessDead).includes('packages/spec/scripts/lib/dist-freshness.ts'),
  );
  t(
    '...so the family carrying it is a standing fact, not a miss worth triaging',
    unreachableClass(distFreshnessDead) === 'by construction',
  );
  // The extension list is a NARROWING, and the price of a narrowing is what it
  // refuses. Pinned as an AGREEMENT rather than as a count, so it survives the
  // tree moving: over every inert hint in the live fleet, resolving through
  // MODULE_SPECIFIER_EXTENSIONS and resolving through "any suffix in the same
  // directory" must pick the same file. Today both pick 38 hints and all 38
  // land on `.ts`. The day they disagree, some gate imports a specifier whose
  // only sibling is not a module — and whether to name that file is a decision
  // for whoever is standing there, not a drift for nobody to notice.
  const agreeFiles = trackedFiles();
  const agreeFileSet = new Set(agreeFiles);
  const agreePrefixes = trackedPrefixes(agreeFiles);
  const agreeHints = new Set();
  for (const [, entry] of discoverFamilies().byCheck) for (const h of entry.hints ?? []) agreeHints.add(h);
  const looseTarget = (hint) => {
    const plain = collapseHint(hint);
    if (!plain || agreePrefixes.has(plain)) return null;
    return agreeFiles.find((f) => f.startsWith(`${plain}.`) && !f.slice(plain.length + 1).includes('/')) ?? null;
  };
  // POPULATION: every distinct hint in the fleet, not just the inert ones.
  // #12514 made the matcher follow a dropped extension, so the 38 hints this
  // trade was measured over are LIVE now and an `inert`-scoped population would
  // have emptied — taking three green cases with it while asserting nothing.
  // Both `looseTarget` and `extensionlessModuleTarget` already refuse a hint
  // whose collapsed form the tree HAS as a path, so widening the population
  // adds no candidate; measured, it still selects the same 38.
  const agreeCandidates = [...agreeHints];
  const strictOf = (h) => extensionlessModuleTarget(h, agreeFileSet, agreePrefixes);
  const refusedByNarrowing = agreeCandidates.filter((h) => !strictOf(h) && looseTarget(h));
  t(
    `the extension narrowing costs no lead — every hint the loose rule resolves, this one resolves too (refused: ${refusedByNarrowing.join(', ') || 'none'})`,
    refusedByNarrowing.length === 0,
  );
  t(
    'and it invents nothing: every file it names is a tracked file',
    agreeCandidates.every((h) => !strictOf(h) || agreeFileSet.has(strictOf(h))),
  );
  // The reason the list is explicit rather than "any suffix", held to the tree
  // so the justification cannot quietly evaporate: somewhere in the fleet the
  // loose rule picks a `.test.ts` sibling over the module the import means. If
  // those test files are ever removed, re-point this case at whatever pair the
  // tree then has rather than deleting it — the trade is decided, not stale.
  t(
    'the loose alternative really would name the wrong file, which is why it is refused',
    agreeCandidates.some((h) => strictOf(h) && looseTarget(h) && strictOf(h) !== looseTarget(h)),
  );
  // ⚠️ And the trade is now load-bearing in a second place. It used to decide
  // one SENTENCE in a listing; since #12514 the same list decides which files
  // the MATCHED column names, so the loose rule would put a gate's `.test.ts`
  // sibling into dispatch prompts. Re-measured here: 4 of the 38 (the four
  // named in MODULE_SPECIFIER_EXTENSIONS' docblock), and the matcher reaches
  // the module rather than the test for every one of them.
  const trapped = agreeCandidates.filter((h) => strictOf(h) && looseTarget(h) && strictOf(h) !== looseTarget(h));
  t(
    `the matcher reaches the module, never the test sibling the loose rule would have named (${trapped.length} such hints)`,
    trapped.length > 0 &&
      trapped.every((h) => hintCovers(h, strictOf(h)) && !hintCovers(h, looseTarget(h))),
  );

  // ── A dropped extension is followed, at COMPARISON time (#12514) ──────────
  //
  // Nine `packages/spec` families were unreachable ENTIRELY because a gate
  // spells an imported module without its extension, so no path derivation
  // could name them and a dev editing the file was never told they owed them.
  // Silent under-derivation, exit 0. The pins below are ARRIVAL pins: where a
  // hint lands, never merely that it left the branch it used to be in.
  t(
    'the matcher follows the extension an ESM specifier drops',
    hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry.ts'),
  );
  // The live specimen the card was filed for, driven end to end through the
  // real fleet: the family, the hint and the file are all read from the tree.
  const extlessLive = discoverFamilies().byCheck.get('check:spec-changes');
  t(
    'check:spec-changes really declares the extensionless specifier',
    (extlessLive?.hints ?? []).includes('packages/spec/src/migrations/registry'),
  );
  t(
    '...and a card touching that file now MATCHES it — the silent under-derivation this card names',
    (extlessLive?.hints ?? []).some((h) => hintCovers(h, 'packages/spec/src/migrations/registry.ts')),
  );
  // EQUALITY, not a prefix. The rule may name the one file the specifier
  // resolves to and nothing else — not a subtree under it, not a sibling that
  // merely starts the same way, and not a second extension stacked on the
  // first. Each of these would be a fabricated lead, which this file prices
  // above a missing one.
  t('the extension follow does not become a subtree claim', !hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry.ts/inner.ts'));
  t('nor reach a sibling that merely shares the stem', !hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry-v2.ts'));
  t('nor a doubled extension', !hintCovers('packages/spec/src/migrations/registry', 'packages/spec/src/migrations/registry.ts.ts'));
  t('and it stays inside the segment rule — a bare word is still refused, extension or not', !hintCovers('registry', 'registry.ts'));
  // The dotted-suffix sibling trade (#8534) is what a LOOSE suffix rule would
  // have taken back. Pinned here as well as above, because this card is the one
  // that would have broken it: `.base.json` is not a module extension.
  t('the sibling-file refusal survives the extension follow', !hintCovers('packages/spec/authorable-surface', 'packages/spec/authorable-surface.base.json'));

  // COHERENCE: the matcher and the residue cannot disagree about a file the
  // tree HAS. `extensionlessModuleTarget` exists to say "the tree has this
  // file" about a hint the sweep calls dead; after this change no hint that
  // carries a separator can be in both states at once, so the residue can never
  // print that sentence about a hint the derivation is silently missing.
  const stillDead = agreeCandidates.filter((h) => h.includes('/') && !hintReachesTree(h, agreeFiles));
  t(
    'no separator-carrying hint is both dead to the matcher and resolvable to a tracked file',
    stillDead.every((h) => !strictOf(h)),
  );

  // ── The fabrication direction, re-homed from #12299 ───────────────────────
  //
  // This widening is root-agnostic: it follows an extension wherever the hint
  // points, INCLUDING at a top-level root the tree does not have. The tree
  // grows a `src/` or a `data/` and inert hints become MATCHED pairs for gates
  // that never read those files — the fabricated-lead direction this file
  // prices above a missing one. The requirement adopted on #12299 was that this
  // cannot happen SILENTLY, so the roots are held out by name here and their
  // arrival reds THIS case instead of quietly minting pairs into prompts.
  const fabTopLevel = new Set(agreeFiles.map((f) => f.split('/')[0]));
  const fabRoots = new Set();
  for (const h of agreeCandidates) {
    if (hintReachesTree(h, agreeFiles)) continue;
    const root = collapseHint(h).split('/')[0];
    if (root && !fabTopLevel.has(root)) fabRoots.add(root);
  }
  // The mechanism, shown rather than argued — a synthetic pair, so the reader
  // can see exactly what the guard below is holding out.
  t('a hint under an absent root WOULD convert the day that root appears', hintCovers('src/kernel/protocol-version', 'src/kernel/protocol-version.ts'));
  t(
    `and today none of the ${fabRoots.size} roots one directory away is in the tree — ` +
      'if this reds, a new top-level directory just converted inert hints into MATCHED pairs; ' +
      'check each against the gate that declares it before accepting the leads',
    [...fabRoots].every((r) => !fabTopLevel.has(r)),
  );
  // The two the #12299 requirement names, held explicitly so the guard cannot
  // evaporate if the derived set above ever empties for an unrelated reason.
  t('`src` is not a tracked top-level entry — 20 inert hints are rooted there', !fabTopLevel.has('src') && fabRoots.has('src'));
  t('`data` is not a tracked top-level entry — 9 inert hints are rooted there', !fabTopLevel.has('data') && fabRoots.has('data'));

  t('hint covers deeper path', hintCovers('.claude/agents', '.claude/agents/os-dev.md'));
  t('collapsed glob prefix covers', hintCovers('packages/spec/src/**', 'packages/spec/src/data/filter.zod.ts'));
  t('input dir covers hint below it', hintCovers('packages/spec/scripts/check-x.mjs', 'packages/spec'));
  t('unrelated path does not match', !hintCovers('.claude/agents', 'packages/rest/src/server.ts'));

  // ── Segment boundaries, not string prefixes (#8534) ───────────────────────
  //
  // Every case above is one the raw-prefix rule also passed; they stay to prove
  // the narrowing kept them. The cases below are the ones it failed.
  t('a hint equal to the input path covers it', hintCovers('docs/adr', 'docs/adr'));
  t('a sibling sharing a name prefix is NOT covered', !hintCovers('packages/client', 'packages/client-react/src/index.ts'));
  t('nor in the other direction', !hintCovers('packages/spec-extra/x.ts', 'packages/spec'));
  // The live specimen this is measured on: a real FILE sitting beside a real
  // directory of the same name stem. The filed census called the rule dormant
  // after probing package DIRECTORIES; it was live all along, on a file. The
  // original specimen was `content/docs` + `content/docs.site.json`; that file
  // was deleted as dead config (#12489) and this case was re-pointed, per the
  // standing instruction kept here: if `packages/spec/authorable-surface.base.json`
  // is ever removed, re-point this case at whatever sibling pair the tree then
  // has rather than deleting it.
  t('the live sibling FILE is no longer claimed by the directory hint', !hintCovers('packages/spec/authorable-surface', 'packages/spec/authorable-surface.base.json'));
  t('while the directory it names is still covered', hintCovers('packages/spec/authorable-surface', 'packages/spec/authorable-surface/ai.json'));
  // The collapsed-glob reach trade, pinned in BOTH directions so the decision
  // reads as an assertion. Refusing the sibling reach is the DECIDED loss (see
  // hintCovers' docblock): measured, no repo-path hint of this shape exists —
  // the only two live partial-segment globs are npm specifiers.
  t('a collapsed partial-segment glob does NOT reach the sibling it would match as a glob', !hintCovers('packages/client*', 'packages/client-react/src/index.ts'));
  t('the same glob still covers the package it names', hintCovers('packages/client*', 'packages/client/src/index.ts'));
  t('a segment-boundary glob is untouched by the trade', hintCovers('packages/client/**', 'packages/client/src/index.ts'));

  // ── A glob in a NON-FINAL segment is matched, not collapsed (#12246) ──────
  //
  // Collapse-by-deletion mangles this one shape into a double separator no tree
  // can hold, so the hint matched nothing BY CONSTRUCTION and its family was
  // then misfiled as "THE LAYOUT MOVED". Both halves are pinned: what the rule
  // now reaches, and — the larger half — everything it deliberately does NOT
  // disturb, because the refused alternative (matching ALL whole-segment globs)
  // breaks the ROOT_DIR_WATCH_HINTS idiom by −7404 pairs on each of three gates.
  t('the predicate reads the LAST segment, so a trailing glob is not this case', !globInNonFinalSegment('packages/**'));
  t('nor is a partial-segment glob in the last segment', !globInNonFinalSegment('packages/client*'));
  t('a glob in a middle segment IS', globInNonFinalSegment('skills/*/references/_index.md'));
  t('and a `**` in a middle segment IS', globInNonFinalSegment('packages/**/*.ts'));
  // The live specimen: `packages/spec/scripts/build-skill-references.ts` emits
  // these nine files and the derivation reached zero of them. If the skills
  // layout ever changes, re-point this case at whatever mid-segment glob the
  // fleet then declares rather than deleting it.
  t('a mid-segment glob reaches the file it names', hintCovers('skills/*/references/_index.md', 'skills/objectstack-formula/references/_index.md'));
  t('and does NOT claim the rest of the subtree it passes through', !hintCovers('skills/*/references/_index.md', 'skills/objectstack-formula/SKILL.md'));
  t('a `**` crosses separators, a single `*` does not', hintCovers('packages/**/*.ts', 'packages/spec/src/data/filter.zod.ts'));
  t('so a single `*` segment matches exactly one segment', !hintCovers('skills/*/references/_index.md', 'skills/a/b/references/_index.md'));
  t('the extension the glob names is honoured', !hintCovers('packages/**/*.object.ts', 'packages/spec/src/index.ts'));
  // Reverse containment, the direction a coarse card surface needs: the literal
  // prefix before the first wildcard still reaches back to a directory surface,
  // exactly as the collapsed form used to.
  t('a directory surface above the glob still derives the gate', hintCovers('skills/*/references/_index.md', 'skills'));
  t('but an unrelated root does not', !hintCovers('skills/*/references/_index.md', 'packages'));
  // ⛔ The refused alternative, pinned as the loss it would be. Each of these
  // is a trailing glob and MUST keep going through the collapse.
  t('a trailing `**` still collapses to the root it names', hintCovers('packages/**', 'packages/spec/src/index.ts'));
  t('the ROOT_DIR_WATCH_HINTS idiom is untouched', hintCovers('skills/**', 'skills/objectstack-formula/SKILL.md'));
  t('and so is a trailing single `*`', hintCovers('examples/*', 'examples/app-showcase/src/x.ts'));
  t('the DECIDED partial-segment trade still refuses the sibling', !hintCovers('packages/client*', 'packages/client-react/src/index.ts'));

  // ── `**` covers ZERO segments too (#12329) ───────────────────────────────
  //
  // The branch above judges these hints with `triggerCovers`, i.e. with
  // GitHub's filter-pattern language, where `**` is a CHARACTER wildcard and
  // the `/` written after it is a literal that must still appear. That makes
  // `**` mean ONE OR MORE segments, so the natural spelling for a top-level
  // population reaches none of it. Read from the real corpus, not a fixture: a
  // fixture cannot show that the tree still has the shape the trap needs.
  const topLevelMirrors = trackedFiles().filter((f) => /^scripts\/[^/]+\.d\.mts$/.test(f));
  t('the tree really does hold top-level `.d.mts` files under a root', topLevelMirrors.length >= 3);
  t('a `**` root reaches the top-level files under it', topLevelMirrors.every((f) => hintCovers('scripts/**/*.d.mts', f)));
  t('and claims nothing else in the whole tree', trackedFiles().filter((f) => hintCovers('scripts/**/*.d.mts', f)).length === topLevelMirrors.length);
  t('the ONE-OR-MORE reading it used to have is still there', hintCovers('scripts/**/*.d.mts', 'scripts/pm/x.d.mts'));
  t('at any depth', hintCovers('scripts/**/*.d.mts', 'scripts/a/b/x.d.mts'));
  t('the extension the glob names is still honoured at the top level', !hintCovers('scripts/**/*.d.mts', 'scripts/invoked-as.mjs'));
  t('and a directory surface above it still derives the gate', hintCovers('scripts/**/*.d.mts', 'scripts'));
  // The forms are itself first, then the reductions — the original spelling is
  // never lost, which is what keeps the one-or-more cases above passing.
  t('the forms of a `**` hint are the hint and its zero-segment reduction', zeroSegmentForms('scripts/**/*.d.mts').join(' ') === 'scripts/**/*.d.mts scripts/*.d.mts');
  t('each `**` drops independently, so two of them give the power set', zeroSegmentForms('a/**/b/**/c').join(' ') === 'a/**/b/**/c a/b/**/c a/**/b/c a/b/c');
  t('a hint with no `**` segment has exactly one form', zeroSegmentForms('skills/*/references/_index.md').join(' ') === 'skills/*/references/_index.md');
  t('and so does a hint with no glob at all', zeroSegmentForms('packages/spec/src/index.ts').join(' ') === 'packages/spec/src/index.ts');
  t('a hint above the cap keeps its written and fully-reduced forms only', zeroSegmentForms('a/**/**/**/**/**/**/**/**/**/z').length === 2);
  // ⛔ Deliberately NOT droppable — three refusals that keep this narrow.
  t('a single `*` segment is not a zero-segment wildcard', !hintCovers('skills/*/references/_index.md', 'skills/references/_index.md'));
  t('nor is a `**` that is only PART of a segment', zeroSegmentForms('packages/a**/b.ts').join(' ') === 'packages/a**/b.ts');
  t('and a trailing `**` never reaches this rule at all', hintCovers('packages/**', 'packages/spec/src/index.ts') && !globInNonFinalSegment('packages/**'));
  // The CI mirror is untouched, which is the whole reason the repair lives in
  // `hintCovers` and not in `triggerPatternRegex`: a hint is a glob a gate
  // author wrote, a trigger is a filter GitHub will evaluate, and this file
  // must keep saying what GitHub does. `validate-deps.yml` declares
  // `'**/package.json'` and is the live specimen.
  t('the trigger language still reads `**` as the character wildcard GitHub documents', !triggerCovers('**/package.json', 'package.json'));
  t('while the same spelling as a HINT covers the root file', hintCovers('**/package.json', 'package.json'));
  // The sibling spelling used to be dead by the OLDER route and is repaired by
  // `globCarriesLiteralSuffix` (#13448). The collapse still mangles it — that
  // is the whole reason it must not be judged by the collapse — so BOTH halves
  // are pinned: the mangle is still what deletion produces, and the hint no
  // longer goes through it.
  t('the collapse of a final-segment glob with a literal suffix is still a splice', collapseHint('scripts/*.d.mts') === 'scripts/.d.mts');
  t('...so the hint is judged as a pattern instead', judgedAsPattern('scripts/*.d.mts') && globCarriesLiteralSuffix('scripts/*.d.mts'));
  t('...and now reaches every one of the files it names', topLevelMirrors.every((f) => hintCovers('scripts/*.d.mts', f)));
  t('...and claims nothing else in the whole tree', trackedFiles().filter((f) => hintCovers('scripts/*.d.mts', f)).length === topLevelMirrors.length);
  t('a single `*` still never crosses a separator', !hintCovers('scripts/*.d.mts', 'scripts/pm/x.d.mts'));

  // ── A final-segment glob with a literal SUFFIX is a splice too (#13448) ───
  //
  // The species `zeroSegmentForms` recorded and left. Deletion-collapse mangles
  // `.changeset/*.md` into `.changeset/.md`, so the hint reached ZERO of 548
  // tracked changesets while reading as an ordinary literal, and the residue
  // then named a directory rename as the cause. Read from the REAL corpus: a
  // fixture cannot show that the tree still holds the population the trap needs,
  // and this one grows with every merged PR.
  const suffixCorpus = trackedFiles();
  const changesetPop = suffixCorpus.filter((f) => /^\.changeset\/[^/]+\.md$/.test(f));
  t('the tree really does hold a large `.changeset/*.md` population', changesetPop.length >= 100);
  t('the live specimen reaches every changeset it names', changesetPop.every((f) => hintCovers('.changeset/*.md', f)));
  t('and claims nothing else in the whole tree', suffixCorpus.filter((f) => hintCovers('.changeset/*.md', f)).length === changesetPop.length);
  t('so it is nobody\'s dead literal any more', hintReachesTree('.changeset/*.md', suffixCorpus));
  t('the extension the glob names is honoured', !hintCovers('.changeset/*.md', '.changeset/config.json'));
  t('a single `*` matches exactly one segment here too', !hintCovers('.changeset/*.md', '.changeset/pre/x.md'));
  t('a directory surface above it still derives the gate', hintCovers('.changeset/*.md', '.changeset'));
  t('but an unrelated root does not', !hintCovers('.changeset/*.md', 'packages'));
  // The predicate, both directions. What decides it is a LITERAL behind the
  // glob, never a literal in front of one.
  t('a glob with a literal behind it in the last segment is the splice case', globCarriesLiteralSuffix('.changeset/*.md'));
  t('a literal PREFIX before the glob is not what decides it', globCarriesLiteralSuffix('scripts/check-*.mjs') && !globCarriesLiteralSuffix('scripts/check-*'));
  t('a TRAILING glob is not this case — deletion truncates it to a real prefix', !globCarriesLiteralSuffix('packages/**') && !globCarriesLiteralSuffix('packages/*') && !globCarriesLiteralSuffix('packages/client*'));
  t('nor is a hint with no glob at all', !globCarriesLiteralSuffix('packages/spec/src/index.ts'));
  // ⛔ The refusals, pinned as the losses they would be. Each of these MUST
  // keep going through the collapse: the alternative was measured at −7404
  // pairs on each of three gates (see zeroSegmentForms' docblock).
  t('the ROOT_DIR_WATCH_HINTS idiom is bit-for-bit untouched',
    hintCovers('skills/**', 'skills/objectstack-formula/SKILL.md') &&
      hintCovers('examples/*', 'examples/app-showcase/src/x.ts') &&
      hintCovers('packages/**', 'packages/spec/src/index.ts'));
  t('the DECIDED partial-segment trade still refuses the sibling', !hintCovers('packages/client*', 'packages/client-react/src/index.ts'));
  t('...and still covers the package it names', hintCovers('packages/client*', 'packages/client/src/index.ts'));
  // ⛔ `?`, `+` and `[…]` are NOT admitted. `collapseHint` never deleted them,
  // so they are not a mangle — they are an ordinary literal that fails to
  // match, which is the MISSING-lead direction this file errs in. Measured at
  // zero live instances; pinned so their arrival is a decision somebody makes
  // rather than a fabricated-pair widening nobody sees.
  const finalSegmentShapes = new Set();
  for (const [, entry] of discoverFamilies().byCheck) for (const h of entry.hints ?? []) finalSegmentShapes.add(h.split('/').pop());
  t('no hint in the fleet carries a `?`, `+` or character class', ![...finalSegmentShapes].some((s) => /[?+[]/.test(s)));
  t('and such a hint is still judged by the collapse, exactly as before', !judgedAsPattern('scripts/check-?.mjs'));

  // The trailing-separator strip is ONE call, not two: `/\/+$/` is greedy and
  // anchored, so nothing survives for a second `/\/$/` to remove. Measured at
  // zero of 754 hints; pinned on the probes that could tell them apart, so a
  // future reader does not restore the redundant call as defence-in-depth.
  t('the greedy trailing strip removes every trailing separator', collapseHint('a///') === 'a');
  t('including the one a trailing `**` leaves behind', collapseHint('a/**/') === 'a');
  t('and a hint that is nothing but separators collapses to empty', collapseHint('**/') === '');
  t('what it cannot touch is a separator left in the MIDDLE', collapseHint('skills/*/references/_index.md') === 'skills//references/_index.md');

  // ── A declared SUBTREE is not a bare word (#9626) ─────────────────────────
  //
  // The genericity refusal reads the hint as the author wrote it. Both
  // directions, because the whole value of the rule is the pair: the word is
  // still refused, the declaration is now honoured. Collapsing `content/**`
  // yields the same `content` the bare word yields, which is precisely why the
  // refusal cannot be decided on the collapsed copy.
  t('a single-segment root declared as a subtree covers the tree it names', hintCovers('content/**', 'content/docs/any-page.mdx'));
  t('the same declaration covers the OTHER subtree under that root', hintCovers('content/**', 'content/blog/a-post.mdx'));
  t('a bare top-level directory WORD is still refused as too generic', !hintCovers('packages', 'packages/spec/src/index.ts'));
  t('a bare root that lost its separator to the trailing trim is still refused', !hintCovers(extractWatchHints("const D = 'examples/';")[0] ?? 'examples', 'examples/app-showcase/src/x.ts'));
  t('a declared subtree does not reach a sibling root', !hintCovers('content/**', 'contentious/x.md'));
  // A top-level FILE stays out of reach on purpose: accepting a bare filename
  // would admit every `package.json` basename a gate joins with a package dir.
  // Pinned so the loss reads as a decision, not an oversight. What is refused
  // is the LITERAL, never the file — a gate whose population really is a root
  // file reaches it by declaring the subtree spelling, which is what the
  // rootFileDeclarations cases below pin.
  t('a bare top-level FILE name is refused, the decided loss', !hintCovers('README.md', 'README.md'));

  // The three live declarations the refusal used to swallow, read from the real
  // gates rather than fixtures — a fixture cannot show that the tree still has
  // the shape. If one of these gates stops declaring its root, re-point the
  // case at whatever gate then does; deleting one deletes the evidence.
  // Re-pointed at the module that DECLARES the table (#11511): it moved out of
  // check-cross-package-test-inputs.mjs into a plain module precisely so the
  // follow below could reach it, and this read is of the declaration, not of
  // the gate. Exactly what the paragraph above asks for -- "if one of these
  // gates stops declaring its root, re-point the case at whatever gate then
  // does". Left pointing at the gate it would have gone green over an empty
  // hint list, which is the vacuous-pass shape these cases exist to refuse.
  const crossPkgHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/cross-package-test-inputs.mjs'), 'utf8'), 'scripts/cross-package-test-inputs.mjs');
  // NOT `scripts/check-nul-bytes.mjs`: that gate names that file explicitly
  // too, so the case would pass with the declaration still refused — measured,
  // it survived the ablation. Pick a scripts path reachable ONLY through the
  // declared subtree, or the case pins nothing.
  t('the cross-package declaration table reaches the root scripts dir it declares', crossPkgHints.some((h) => hintCovers(h, 'scripts/pm/dispatch-gates.mjs')));
  t('and the content tree it declares', crossPkgHints.some((h) => hintCovers(h, 'content/docs/getting-started/index.mdx')));
  const governedHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/pm/check-governed-merges.mjs'), 'utf8'), 'scripts/pm/check-governed-merges.mjs');
  t('the governed-merge gate reaches the published skills catalog it declares', governedHints.some((h) => hintCovers(h, 'skills/objectstack-upgrade/SKILL.md')));

  // The card this landed for: the ONLY fragment coverage in the repo, which
  // scored `silent` for every content card while being REQUIRED in lint.yml.
  const anchorHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-doc-anchors.mjs'), 'utf8'), 'scripts/check-doc-anchors.mjs');
  t('the doc-anchors gate reaches the content page population it declares', anchorHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  t('and does not thereby claim a path outside that population', !anchorHints.some((h) => hintCovers(h, 'packages/spec/src/index.ts')));

  // The sixth instance of the class (#10648), and the worst-shaped one: three
  // of check-doc-authoring's four roots were bare words (`.claude` survived on
  // the dotted-dir arm alone), while its SKIP_PATHS carried separators and were
  // taken. Five of the six paths it declared were therefore EXCLUSIONS, and 383
  // of its 389 walked files were declared by nothing. The failure printed as a
  // populated `names:` column, which reads as "declared, just not relevant to
  // you" rather than as a blind spot — the reason it survived five same-class
  // fixes without being noticed.
  const docAuthoringHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-doc-authoring.mjs'), 'utf8'), 'scripts/check-doc-authoring.mjs');
  // One case per declared root, because a single one passes for a declaration
  // that dropped the other three — which is the exact shape being fixed. Each
  // path is reachable ONLY through its root's subtree spelling, never through a
  // SKIP_PATHS literal.
  t('the doc-authoring gate reaches the live docs corpus it declares', docAuthoringHints.some((h) => hintCovers(h, 'docs/qa/platform-checklist/RUNNER.md')));
  t('and the top-level docs guides, which are files rather than a subtree', docAuthoringHints.some((h) => hintCovers(h, 'docs/protocol-upgrade-guide.md')));
  // ⚠️ This one case does NOT pin the declaration, and says so rather than
  // reading as though it does: `.claude` is a top-level DOTTED dir, which
  // `looksPathy` admits and `hintCovers` does not refuse, so the bare ROOTS
  // entry reaches this path on its own. Measured — deleting `.claude/**` from
  // the gate leaves this case green, exactly the way check-nul-bytes survives
  // the ablation above. What it pins is that `.claude` stays reachable AT ALL;
  // the declaration itself is pinned in the gate's own self-test, which
  // requires a subtree spelling for every separator-less ROOT.
  t('and the agent operating manual it took in for the same reason', docAuthoringHints.some((h) => hintCovers(h, '.claude/agents/os-dev.md')));
  t('and the published skills catalog', docAuthoringHints.some((h) => hintCovers(h, 'skills/objectstack-upgrade/SKILL.md')));
  t('and the content tree', docAuthoringHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  // Rule 3's root, added when the gate took in the spec's customer-facing zod
  // refusal messages. It is NOT one of ROOTS — the Markdown rules never walk it
  // — so the gate's own self-test (which derives its declaration from ROOTS)
  // cannot pin it and this case is the only place that does.
  t('and the spec refusal-message population Rule 3 walks', docAuthoringHints.some((h) => hintCovers(h, 'packages/spec/src/ui/action.zod.ts')));
  // #13297 widened Rule 3's root: the cross-package prose-id leg walks every
  // sibling package's non-test sources against a pinned baseline, so the gate
  // now genuinely reads any package edit and declares `packages/**`. The
  // narrow claim these cases used to pin ("spec/src and nothing else under
  // packages/") is the boundary the #13179 deferral drew, and the deferral's
  // own codified revival condition retired it — a sibling package source is
  // now POSITIVE coverage, not an over-claim.
  t('and the sibling-package prose population the ledgered leg walks', docAuthoringHints.some((h) => hintCovers(h, 'packages/runtime/src/index.ts')));
  // The residual over-claim is bounded and known: `packages/**` subsumes
  // spec's non-src files and every test file, which the leg's own walk skips
  // (spec belongs to the position-based rule; test bodies are out). That is
  // the tolerated carve-out-inside-a-walked-root case — the same shape as
  // check:slot-lookup-ratchet declaring the whole of `packages/**` — pinned
  // here so it stays a recorded residual rather than an accident.
  t('spec outside its source tree rides the bounded packages/** over-claim', docAuthoringHints.some((h) => hintCovers(h, 'packages/spec/package.json')));
  // The negative half that SURVIVES the widening, still load-bearing: a gate
  // named on EVERY card is the louder version of naming none, and the leg
  // walks packages/ only — never apps/ or examples/.
  t('and claims nothing under apps/', !docAuthoringHints.some((h) => hintCovers(h, 'apps/console/src/main.tsx')));
  t('nor under examples/', !docAuthoringHints.some((h) => hintCovers(h, 'examples/crm/objects/account.object.ts')));

  // The second gate of that class (#9700): a whole-tree ESLint ratchet whose
  // only literals were its own baseline artifact and the ref it diffs against,
  // so it scored `silent` for every card in the tree while being REQUIRED in
  // lint.yml — twice at the cost of a p0's CI round (#9391, PR #9695). It now
  // declares the subtree it lints. Read from the real gate, not a fixture: what
  // is being pinned is that the tree still HAS the declaration.
  const slotHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-slot-lookup-ratchet.mjs'), 'utf8'), 'scripts/check-slot-lookup-ratchet.mjs');
  t('the slot-lookup ratchet reaches the package source population it declares', slotHints.some((h) => hintCovers(h, 'packages/services/service-datasource/src/admin-routes.ts')));
  // The negative half is the load-bearing one for a declaration this broad: a
  // gate named on EVERY card is the louder version of naming none. `packages/**`
  // must reach nothing outside `packages/`, and these three roots are where a
  // widened extractor would have leaked it (measured in hintCovers' docblock:
  // the rejected alternative takes one card from 7 matched families to 34).
  t('and claims nothing under apps/', !slotHints.some((h) => hintCovers(h, 'apps/console/src/main.tsx')));
  t('nor under examples/', !slotHints.some((h) => hintCovers(h, 'examples/crm/objects/account.object.ts')));
  t('nor a content page', !slotHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));

  // The third gate of that class (#9964), and the one nothing above could
  // reach: the pm line ratchet's population includes the repo-ROOT AGENTS.md,
  // and a root file carries no separator for `looksPathy` to find — so its
  // eighteen ceilings produced seventeen hints and an AGENTS.md card derived
  // zero gates, on the largest ceiling in that map at headroom 0. It declares
  // the subtree spelling instead. Read from the real gate, not a fixture: what
  // is pinned is that the tree still HAS the declaration.
  const lineRatchetHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/pm/check-skill-line-ratchet.mjs'), 'utf8'), 'scripts/pm/check-skill-line-ratchet.mjs');
  t('the pm line ratchet reaches the repo-root instruction file it declares', lineRatchetHints.some((h) => hintCovers(h, 'AGENTS.md')));
  // The negative half, and the reason this is a DECLARATION rather than an
  // extractor change. Widening the extractor to admit bare top-level `*.md`
  // literals was measured on the same corpus as the refusal above — 114
  // families x 6326 tracked files — and costs only 17 pairs, but 8 of them are
  // fabricated: gates spell `README.md` and `CHANGELOG.md` as basenames they
  // join with a package directory, so a README.md card gains six leads of which
  // five name a gate that never reads it. The class stays refused; these pin
  // that this declaration bought no part of it.
  t('and claims no other repo-root file', !lineRatchetHints.some((h) => hintCovers(h, 'README.md')));
  t('nor a same-named file inside a directory', !lineRatchetHints.some((h) => hintCovers(h, 'examples/AGENTS.md')));
  t('a bare top-level file literal is still no hint at all', extractWatchHints("const F = 'README.md';").length === 0);

  // The rest of that class (#9979). The ratchet above was one of SIX families
  // whose population genuinely includes a repo-root instruction file; the other
  // five were measured still invisible, so an AGENTS.md card derived ONE gate
  // out of six and a README.md / ARCHITECTURE.md card derived NONE at all —
  // while `check:doc-anchors` is REQUIRED in lint.yml and is this repo's only
  // fragment coverage. Each declares the subtree spelling in its own source.
  //
  // Read from the real gates, not fixtures: what is pinned is that the tree
  // still HAS the declarations. If one of these gates stops reading its root
  // file, delete its case with the declaration — never keep a case green by
  // re-pointing it at a gate that never read the file.
  const rootFileDeclarations = [
    ['the pm skill-id lint', 'scripts/pm/check-skill-id-lint.mjs', 'AGENTS.md'],
    ['the governed-merge register', 'scripts/pm/check-governed-merges.mjs', 'AGENTS.md'],
    ['the governed-merge register (CLAUDE.md half)', 'scripts/pm/check-governed-merges.mjs', 'CLAUDE.md'],
    ['the governed-prose gate', 'scripts/pm/check-governed-prose.mjs', 'AGENTS.md'],
    ['the docs-audit scope gate', 'scripts/docs-audit/check-audit-scope.mjs', 'AGENTS.md'],
    ['the required-context pin', 'scripts/check-required-contexts.mjs', 'AGENTS.md'],
    ['the doc-anchors gate', 'scripts/check-doc-anchors.mjs', 'README.md'],
    ['the doc-anchors gate (ARCHITECTURE.md half)', 'scripts/check-doc-anchors.mjs', 'ARCHITECTURE.md'],
  ];
  for (const [what, gate, rootFile] of rootFileDeclarations) {
    const gateHints = extractWatchHints(readFileSync(join(ROOT, gate), 'utf8'), gate);
    t(`${what} reaches the repo-root file it declares (${rootFile})`, gateHints.some((h) => hintCovers(h, rootFile)));
    // The negative half, and the reason each of these is a DECLARATION rather
    // than an extractor change: a declaration must buy its own file and NOT the
    // bare-`*.md` class the extractor still refuses. `examples/AGENTS.md` is
    // the live specimen — a real tracked file, same basename, not read by any
    // of these gates (check-governed-merges' own near-miss case names it).
    t(`${what} claims no same-named file inside a directory`, !gateHints.some((h) => hintCovers(h, `examples/${rootFile}`)));
  }
  // …and the root files stay separated from each other: the governed-merge
  // register is the only one of the six that declares two, and nothing here may
  // reach a root file its gate does not read.
  const proseHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/pm/check-governed-prose.mjs'), 'utf8'), 'scripts/pm/check-governed-prose.mjs');
  t('a one-root declaration does not reach the other root file', !proseHints.some((h) => hintCovers(h, 'CLAUDE.md')));
  const anchorRootHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-doc-anchors.mjs'), 'utf8'), 'scripts/check-doc-anchors.mjs');
  t('and the doc-anchors pair claims neither instruction file', !anchorRootHints.some((h) => hintCovers(h, 'AGENTS.md') || hintCovers(h, 'CLAUDE.md')));

  // A THIRD shape of the same class, and the one with the worst failure
  // direction (#13207): a gate whose declared population was its OWN GUARDED
  // ARTIFACT. `check:llms-txt` re-derives the claims of `packages/spec/llms.txt`
  // against trees elsewhere — the `*.zod.ts` counts under `packages/spec/src`,
  // the `api-surface/` shards, the manifest `exports` keys, and the non-private
  // `@objectstack/*` workspace set — but reached every one of them through
  // `join(PKG, ...)`, so the only literal it spelled was `llms.txt` itself.
  //
  // The derivation could therefore name the gate only AFTER the artifact had
  // been edited, while the edits that FALSIFY it land in those other trees.
  // Measured on PR #13186 across two rounds of one branch: deleting a `src/`
  // schema module moved `src/kernel/` 32 -> 31 and the summed total 208 -> 207,
  // the derived family did not contain the gate, and the red reached CI. That
  // is UNDER-matching — silent, and invisible in the tool's own output, where an
  // omitted gate looks exactly like a gate that does not apply.
  //
  // Read from the real gate, not a fixture: what is pinned is that the tree
  // still HAS the declaration. If this gate stops reading one of these trees,
  // delete the case together with the literal — never keep it green by
  // re-pointing it at a tree the gate never reads.
  const llmsHints = extractWatchHints(
    readFileSync(join(ROOT, 'packages/spec/scripts/check-llms-txt.ts'), 'utf8'),
    'packages/spec/scripts/check-llms-txt.ts',
  );
  const llmsReaches = (f) => llmsHints.some((h) => hintCovers(h, f));
  // The reproduction, as a case: the falsifying edit alone names the gate.
  t('check:llms-txt reaches the schema tree its counts are derived from', llmsReaches('packages/spec/src/kernel/cluster.zod.ts'));
  // …and by a route that is NOT the artifact hint. This is the reproduction
  // itself: before this declaration the only hint covering anything was
  // `packages/spec/llms.txt`, so a src-only diff derived nothing.
  t('and by a route that is not the guarded artifact — the #13207 reproduction', llmsHints.some((h) => h !== 'packages/spec/llms.txt' && hintCovers(h, 'packages/spec/src/kernel/cluster.zod.ts')));
  t('it still reaches the artifact it guards', llmsReaches('packages/spec/llms.txt'));
  t('it reaches the api-surface shards every NAMED claim resolves against', llmsReaches('packages/spec/api-surface/data.json'));
  t('it reaches the manifest whose exports keys the SUBPATH claims resolve against', llmsReaches('packages/spec/package.json'));
  t('it reaches the repo-root workspace file it opens', llmsReaches('pnpm-workspace.yaml'));
  t('and the workspace manifests whose set is the package-ecosystem denominator', llmsReaches('packages/drivers/driver-mongodb/package.json'));
  // The negative half, and the load-bearing one. A population this broad is
  // one respelling away from the "22 leads is the same as none" failure the
  // header prices: `packages/spec` or `packages/**` would have bought the flip
  // too, and named this gate on nearly every card in the repo. These pin that
  // it bought the four trees it reads and NOTHING else — including the sibling
  // directories inside its own package.
  t('but claims no other file in its own package', !llmsReaches('packages/spec/docs/anything.md'));
  t('nor a sibling package source', !llmsReaches('packages/rest/src/analytics-dataset-dimension-gate.test.ts'));
  t('nor a content page', !llmsReaches('content/docs/deployment/cli.mdx'));
  t('nor an app source', !llmsReaches('apps/docs/components/ui/card.tsx'));
  t('nor an example', !llmsReaches('examples/app-crm/src/objects/lead.object.ts'));
  // A workspace manifest is reached; a workspace SOURCE file is not. This is
  // the pair that separates `packages/**\/package.json` from `packages/**`.
  t('and a package manifest is reached where its source is not', llmsReaches('packages/qa/dogfood/package.json') && !llmsReaches('packages/qa/dogfood/test/two-factor-lockout.dogfood.test.ts'));

  // The DIRECTORY half of the same class (#10107). A gate whose population is a
  // top-level DIRECTORY spelled as a bare word is invisible for the same reason
  // a root file is — `looksPathy` finds no separator, so the extractor builds no
  // hint at all — and it is the more expensive half, because the word names a
  // whole subtree rather than one file. `check:role-word` walks
  // `['content/docs', 'skills']`: the first is a hint, the second was nothing,
  // so a skills-only card derived the content half and scored this gate
  // `silent`. PR #10038 paid for it — a green local union, then
  // `role-word count grew 2 → 3` in CI. It declares the subtree spelling now.
  //
  // Read from the real gate, not a fixture: what is pinned is that the tree
  // still HAS the declaration. If this gate stops walking that root, delete the
  // declaration and these cases together — never keep them green by re-pointing
  // at a gate that never read it.
  const roleWordHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-role-word.mjs'), 'utf8'), 'scripts/check-role-word.mjs');
  t('the role-word ratchet reaches the published skills catalog it declares', roleWordHints.some((h) => hintCovers(h, 'skills/objectstack-platform/SKILL.md')));
  t('and still reaches the content half it always named', roleWordHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  // The negative halves, and the reason this is a DECLARATION and not an
  // extractor change. `.claude/skills/` is the live specimen: a real tracked
  // tree whose last segment IS the declared root, which this gate does not walk
  // — a widened extractor accepting the bare word `skills` would not tell them
  // apart, and the collapsed subtree does.
  t('and claims nothing under the internal .claude skills tree it never walks', !roleWordHints.some((h) => hintCovers(h, '.claude/skills/pm-dispatch/SKILL.md')));
  t('nor a package source file', !roleWordHints.some((h) => hintCovers(h, 'packages/spec/src/index.ts')));
  // CONSTRUCTED path, deliberately: `content/docs.site.json` was a live file
  // until it was deleted as dead config (#12489), and `content/` now holds only
  // the two collection directories, so the tree offers no sibling beside the
  // content root to name. The probe stays spelled against the `content/docs`
  // hint anyway — that hint is the one with bite here, and re-pointing at a
  // path some far-away gate names would keep this green while testing nothing.
  t('nor a sibling FILE beside the content root', !roleWordHints.some((h) => hintCovers(h, 'content/docs.site.json')));
  // The pair that makes the declaration worth having: the bare word this gate
  // actually spells in its ROOTS array stays refused, so the coverage above is
  // bought by the declaration and by nothing else.
  t('the bare root word the gate spells in ROOTS is still refused as too generic', !hintCovers('skills', 'skills/objectstack-platform/SKILL.md'));
  t('while the declared subtree covers that same path', hintCovers('skills/**', 'skills/objectstack-platform/SKILL.md'));

  // The seventh instance of the same directory class (#10664), in a
  // PACKAGE-scoped gate — `pnpm --filter @objectstack/lint run
  // check:doc-formula-expressions`, REQUIRED in lint.yml — so the source this
  // reads is resolved through that package's manifest rather than the root one.
  //
  // Its ROOTS were `['.claude', 'docs', 'skills', 'content']`, three bare words
  // and one dotted dir, while its SKIP_PATHS spelled five exclusions WITH
  // separators. Measured on this tree: of the 1388 files it walks, 396 (28.5%)
  // were declared by nothing — every file under `docs` (156), `skills` (48) and
  // `content` (192). Inside the `docs` root the shape was inverted rather than
  // merely absent: `docs/plans/` derived the gate (an exclusion, via its own
  // SKIP_PATHS literal) while `docs/qa/` derived nothing.
  //
  // Read from the real gate, not a fixture: what is pinned is that the tree
  // still HAS the declaration.
  const docFormulaHints = extractWatchHints(readFileSync(join(ROOT, 'packages/lint/scripts/check-doc-formula-expressions.mjs'), 'utf8'), 'packages/lint/scripts/check-doc-formula-expressions.mjs');
  // One case per declared root, because a single one passes for a declaration
  // that dropped the other two. Each path is reachable ONLY through its root's
  // subtree spelling, never through a SKIP_PATHS literal.
  t('the doc-formula gate reaches the live docs corpus it declares', docFormulaHints.some((h) => hintCovers(h, 'docs/qa/platform-checklist/RUNNER.md')));
  t('and the published skills catalog', docFormulaHints.some((h) => hintCovers(h, 'skills/objectstack-upgrade/SKILL.md')));
  t('and the content tree', docFormulaHints.some((h) => hintCovers(h, 'content/docs/deployment/cli.mdx')));
  // ⚠️ These two do NOT pin the declaration, and say so rather than reading as
  // though they do. `.claude` is a top-level DOTTED dir, which `looksPathy`
  // admits and `hintCovers` does not refuse; `packages/spec/src` (the gate's
  // SPEC_ROOT, its second surface — 972 files) already carries a separator.
  // Both reach their paths on the bare literal alone — measured: deleting the
  // declaration outright leaves both green. What they pin is that those two
  // surfaces stay reachable AT ALL; the declaration itself is pinned in the
  // gate's own self-test, which requires a subtree spelling for every
  // separator-less ROOT and a separator in SPEC_ROOT.
  t('and the agent operating manual it walks for the same reason', docFormulaHints.some((h) => hintCovers(h, '.claude/agents/os-dev.md')));
  t('and its second surface, the spec TSDoc population', docFormulaHints.some((h) => hintCovers(h, 'packages/spec/src/index.ts')));
  // The negative half, load-bearing for a declaration spanning four roots: a
  // gate named on EVERY card is the louder version of naming none. `packages/`
  // must be probed OUTSIDE `packages/spec/src`, which the gate really does read
  // — a case using a spec path would pass on SPEC_ROOT and pin nothing.
  t('and claims nothing elsewhere under packages/', !docFormulaHints.some((h) => hintCovers(h, 'packages/core/src/index.ts')));
  t('nor under apps/', !docFormulaHints.some((h) => hintCovers(h, 'apps/console/src/main.tsx')));
  t('nor under examples/', !docFormulaHints.some((h) => hintCovers(h, 'examples/crm/objects/account.object.ts')));
  // The bounded residual, pinned as pre-existing rather than as a cost of this
  // declaration. `hintCovers` cannot subtract, so `docs/**` necessarily claims
  // the exempt `docs/plans` — but that subtree ALREADY derived the gate through
  // its own SKIP_PATHS literal, so the declaration adds nothing on that side.
  // Asserted with the declaration removed from the hint set, which is what makes
  // it a measurement instead of a restatement.
  const withoutDeclaration = docFormulaHints.filter((h) => !['docs/**', 'skills/**', 'content/**', '.claude/**'].includes(h));
  t('the exempt subtree derived the gate before this declaration, and still does — the over-claim is bounded, not new', withoutDeclaration.some((h) => hintCovers(h, 'docs/plans/x.md')));
  t('while the live corpus derived nothing without it — the gap this closes', !withoutDeclaration.some((h) => hintCovers(h, 'docs/qa/platform-checklist/RUNNER.md')));
  // The pair that makes the declaration worth having: the bare words this gate
  // spells in its ROOTS array stay refused, so the coverage above is bought by
  // the declaration and by nothing else.
  t('the bare root words the gate spells in ROOTS are still refused as too generic', !hintCovers('docs', 'docs/qa/platform-checklist/RUNNER.md') && !hintCovers('content', 'content/docs/deployment/cli.mdx'));
  t('while the declared subtrees cover those same paths', hintCovers('docs/**', 'docs/qa/platform-checklist/RUNNER.md') && hintCovers('content/**', 'content/docs/deployment/cli.mdx'));

  // ── The escapable-literal ledger (#10705) ────────────────────────────────
  //
  // Every case above pins ONE gate that took the escape. What none of them can
  // say is who still has not — and that is the whole finding: six instances
  // were found one at a time, on six unrelated cards, the sixth a re-discovery
  // of the fourth by an agent who did not know the enumeration existed. These
  // cases turn that into a bounded list with a verdict.
  //
  // The predicate is pinned on FIXTURES first, because a tree-only assertion
  // cannot show which of its conditions is doing the work; the live halves
  // follow.
  const fx = (hints) => [['check:fixture', { hints }]];
  const fxPrefixes = new Set(['scripts', 'scripts/pm', 'examples', 'skills']);
  t(
    'a bare root literal the tree HAS, undeclared, is a ledger row',
    escapableLiteralRows(fx(['scripts']), fxPrefixes).length === 1,
  );
  t(
    'the same literal beside its subtree spelling is NOT — that gate escaped',
    escapableLiteralRows(fx(['scripts', 'scripts/**']), fxPrefixes).length === 0,
  );
  // The live distinction `check:published-files` forced: a hint that reaches
  // INTO the root covers the bare directory through hintCovers' reverse
  // containment, while covering no other file under it. If this case ever goes
  // green the ledger has started retiring rows for gates that are still
  // unnameable.
  t(
    'a hint that merely reaches into the root does not escape it',
    escapableLiteralRows(fx(['scripts', 'scripts/check-x.mjs']), fxPrefixes).length === 1,
  );
  t(
    'a literal the covering rule never refused is no part of the species',
    escapableLiteralRows(fx(['scripts/pm']), fxPrefixes).length === 0,
  );
  t(
    'nor is a dotted root, which hintCovers admits as written',
    escapableLiteralRows(fx(['.claude']), new Set(['.claude'])).length === 0,
  );
  // The other species the residue block names, kept out by exactly the test
  // `unreachableReason` uses to tell them apart: no declaration can fix a
  // literal the tree does not have, so it is not a debt anyone can pay.
  t(
    'a bare word the tree does NOT have is the genuinely-dead species, not this one',
    escapableLiteralRows(fx(['node_modules']), fxPrefixes).length === 0,
  );

  // The live halves, over the real tree and through the SAME discovery pass
  // `derive` runs — a second pass built here could enumerate a population no
  // dispatch prompt is derived from.
  const ledgerSwept = trackedFiles();
  const ledgerPrefixes = trackedPrefixes(ledgerSwept);
  const ledgerFamilies = [...discoverFamilies().byCheck];
  const ledgerRows = escapableLiteralRows(ledgerFamilies, ledgerPrefixes);
  const ledgerKeys = ledgerRows.map(escapableLiteralKey);
  // #4690 at ZERO ROWS: a quiet sweep must still prove it can SPEAK.
  //
  // This guard used to be `ledgerRows.length > 0` — a live-tree count, which
  // read the right rule off the wrong quantity. It conflated two separable
  // claims: "the recognizer still works" and "the tree still owes a row".
  // While a debt existed the two moved together, so the conflation was
  // invisible; paying the LAST row (#10875) is what pulled them apart, and the
  // guard then failed on a clean tree — a shrink-only ledger that could not be
  // allowed to reach zero, which is the one end state it exists to reach.
  //
  // So the recognizer is asked directly instead: splice ONE synthetic family
  // spelling a bare root into the LIVE corpus and require the sweep to find
  // exactly it, and exactly one more row than the tree really owes. That holds
  // at zero live rows and at any other count, it fails loudly if the recognizer
  // or the prefix set goes dead, and unlike the fixture cases above it runs on
  // the live prefixes the real sweep runs on.
  const probeKey = 'check:escapable-literal-probe';
  const probedRows = escapableLiteralRows([...ledgerFamilies, [probeKey, { hints: ['scripts'] }]], ledgerPrefixes);
  const probedKeys = probedRows.map(escapableLiteralKey);
  t(
    'the live sweep still RECOGNISES this species — a probe family spelling a bare root is found,' +
      ' so a quiet sweep means a clean tree rather than a broken recognizer (#4690)',
    probedKeys.filter((k) => k === `${probeKey} scripts`).length === 1 &&
      probedRows.length === ledgerRows.length + 1,
  );
  const freshRows = ledgerKeys.filter((k) => !ESCAPABLE_LITERAL_LEDGER.has(k));
  const staleRows = [...ESCAPABLE_LITERAL_LEDGER].filter((k) => !ledgerKeys.includes(k)).sort();
  t(
    'no gate has NEWLY joined the escapable-literal species' +
      (freshRows.length
        ? ` — FRESH: ${freshRows.join(' · ')}. Unnameable by any dispatch derivation as spelled,` +
          ' so it lands already invisible. TWO remedies, and which one is right depends on what the' +
          ' gate actually READS — pick, do not reach for the first one:' +
          ' (a) it really does walk that repo root ⇒ declare the subtree spelling beside the literal,' +
          ' the ROOT_DIR_WATCH_HINTS idiom (see check-role-word.mjs and check-examples-live-imports.mjs);' +
          ' (b) it does NOT ⇒ stop spelling a bare root, respelling the literal to say what the predicate' +
          ' means (check-published-files.mjs is the worked instance: its predicate is package-relative,' +
          ' over tarball contents, so it took (b) and the row discharged by construction).' +
          ' ⛔ Declaring a root the gate does not read is a FABRICATED lead — worse than the row,' +
          ' at the price hintCovers puts on one. ⛔ The ledger is SHRINK-ONLY: a new line is not a remedy.'
        : ''),
    freshRows.length === 0,
  );
  t(
    'and no ledger row is stale' +
      (staleRows.length
        ? ` — STALE: ${staleRows.join(' · ')}. Good news, and the list must say so:` +
          ' delete each one from ESCAPABLE_LITERAL_LEDGER. A stale line is how this would start' +
          ' drifting into an allowlist nobody re-reads.'
        : ''),
    staleRows.length === 0,
  );
  // The spelling rule the ledger's docblock states, held mechanically rather
  // than remembered: a row keyed by a direct script path would enter THIS
  // file's own hint set as a path it does not read.
  //
  // Carried on a WITNESS PAIR rather than on the ledger alone. The ledger is
  // empty now, and `[].every(...)` is a pass that proves nothing — precisely
  // the vacuous shape #10784's ablation caught one case over, where a fixture
  // with no subtree hint to strip compared silent to silent and read green. The
  // sample row keeps the positive half exercised at zero rows; the negative
  // witness is what gives the case teeth at all, since the live key format
  // (\`${check} ${hint}\`) always carries a space and the extractor refuses a
  // span with one — so a key in that format cannot build a hint whatever it
  // names, and only the bare-path spelling the docblock warns against can.
  const asHints = (row) => extractWatchHints(`const L = ${JSON.stringify(row)};`);
  t(
    'no ledger row enters this file\'s own declared population as a path',
    [...ESCAPABLE_LITERAL_LEDGER, 'check:sample-gate someroot'].every((row) => asHints(row).length === 0),
  );
  t(
    '…and that rule can FAIL: the direct-script spelling it forbids does build a hint',
    asHints('scripts/check-x.mjs').length === 1,
  );
  // The ledger describes the derivation, so it must agree with what the
  // derivation actually reports: every row must name a root the tree HAS and
  // the covering rule refuses — the pair that puts a row in this species rather
  // than in the dead one beside it in the residue block. Asserted over whatever
  // the ledger holds, never over a remembered count of it.
  //
  // Run over the PROBED rows, which are the live rows plus the one synthetic
  // row spliced in above. Two things fall out of that and both are wanted: the
  // property is still checked on every real row, and the case can never go
  // vacuous now that the live half is legitimately empty — the probe row is a
  // row of exactly this species, so `.every` always has something to judge.
  t(
    'every ledger row names a root the tree HAS and the covering rule refuses',
    probedRows.length > 0 &&
      probedRows.every(
        ({ hint, plain }) =>
          // refused: the gate cannot be named for anything under the root
          !hintCovers(hint, `${plain}/any-file-under-it.mjs`) &&
          // …and the root is really there, which is what separates this species
          // from the dead literals beside it in the residue block
          ledgerPrefixes.has(plain) &&
          deepestTrackedPrefix(hint, ledgerPrefixes) === plain,
      ),
  );

  // ── The scripts/** blind spot, closed at the source (#10784) ──────────────
  //
  // BOTH gates that walk `scripts/` were invisible to this derivation, by two
  // opposite routes: `check:parse-guard` declared a bare root the covering rule
  // refuses as too generic, and `check:entry-guard` declared its baseline
  // ROSTER — the files that already violate its import-safety half — so a newly
  // added script could never be in the declared population, BY CONSTRUCTION.
  // Anyone adding a script got neither gate named, and one CI round was paid.
  //
  // Pinned against the LIVE tree through the same discovery pass `derive` runs:
  // a hand-built fixture here could pass while the real gates stayed
  // unnameable, which is the exact failure this case exists to prevent from
  // recurring. The probe path deliberately does not exist — "a file nobody has
  // written yet" is the one input a roster of current members can never contain.
  const scriptsFamilies = discoverFamilies().byCheck;
  const unwrittenScript = 'scripts/the-one-nobody-has-written-yet.mjs';
  for (const gate of ['check:entry-guard', 'check:parse-guard']) {
    const entry = scriptsFamilies.get(gate);
    t(`${gate} is discovered at all — the pin below means nothing without this`, Boolean(entry));
    const verdict = entry ? classifyEntry(entry, [unwrittenScript]) : null;
    t(
      `${gate} is MATCHED for a brand-new scripts/ file, not silent and not unreachable`,
      verdict?.verdict === 'matched',
      JSON.stringify({ verdict: verdict?.verdict, hints: entry?.hints }),
    );
    // The ablation, run in-place: strip the declared SUBTREE from the live hint
    // set and the verdict must fall back to what it was before this landed.
    // Without it the case above could pass through any hint that happened to
    // cover the probe, and the reader could not tell which half was load-bearing.
    const undeclared = entry ? { ...entry, hints: entry.hints.filter((h) => !h.includes('/*')) } : null;
    t(
      `…and it is the subtree declaration doing it: strip it and ${gate} goes back to silent`,
      // The length check is what stops this passing VACUOUSLY. With no subtree
      // hint to remove, `undeclared` is the entry itself and `silent === silent`
      // reads as a pass — measured, on the ablation run that removed both
      // declarations: this case stayed green while the two above went red.
      Boolean(undeclared) &&
        undeclared.hints.length < entry.hints.length &&
        classifyEntry(undeclared, [unwrittenScript]).verdict === 'silent',
      JSON.stringify({ before: entry?.hints?.length, after: undeclared?.hints?.length }),
    );
  }

  // ── The bare root this gate must NOT spell (#10875) ───────────────────────
  //
  // `check:published-files` asks whether a published package ships a scripts/
  // directory OF ITS OWN — a package-relative predicate over would-be tarball
  // contents. Written as a quoted literal it read to this derivation as a
  // declaration of the repo's own scripts/ tree, which the gate never opens:
  // the last row of ESCAPABLE_LITERAL_LEDGER, discharged by respelling the
  // predicate rather than by declaring a subtree that would have been FALSE.
  //
  // ⛔ The remedy the FRESH message offers first — declare the subtree — is the
  // WRONG one here, and it is the one a reader reaches for. The ledger cannot
  // say so, because by design it says nothing at all once a row is out. So the
  // correct verdict is pinned here, in both directions, against the live tree.
  const publishedFiles = scriptsFamilies.get('check:published-files');
  t(
    'check:published-files is discovered at all — the pins below mean nothing without it',
    Boolean(publishedFiles),
  );
  t(
    'check:published-files declares no bare repo root it does not open',
    Boolean(publishedFiles) && !publishedFiles.hints.includes('scripts'),
    JSON.stringify({ hints: publishedFiles?.hints }),
  );
  t(
    '…so a brand-new repo-root scripts/ file does NOT name it — a fabricated lead is the costlier error',
    Boolean(publishedFiles) && classifyEntry(publishedFiles, [unwrittenScript]).verdict !== 'matched',
    JSON.stringify({ verdict: publishedFiles && classifyEntry(publishedFiles, [unwrittenScript]).verdict }),
  );
  // Non-vacuity for the case above, and the whole difference between a verdict
  // that is CORRECT and one that is merely quiet: it must be passing because
  // the gate reads a different population, never because the gate went dark.
  // Its own source is a population it really does have, and still names it.
  t(
    '…and it is not silent everywhere: the population it really has still names it',
    Boolean(publishedFiles) &&
      classifyEntry(publishedFiles, ['scripts/check-published-files.mjs']).verdict === 'matched',
    JSON.stringify({
      verdict: publishedFiles && classifyEntry(publishedFiles, ['scripts/check-published-files.mjs']).verdict,
    }),
  );

  // ── Telling a WEAK silence from an INVERTED one (#10784) ──────────────────
  //
  // The residue said the same words for a gate that genuinely does not read
  // your file and for one whose declared literals are a census of the files it
  // already has. These pin the split as a property of the HINT SET, so a gate
  // of that shape reports itself rather than waiting to be noticed.
  t('a common directory is found on segment boundaries', commonDirectory(['scripts/a.mjs', 'scripts/pm/b.mjs']) === 'scripts');
  t('a sibling whose name merely shares a prefix does not invent one', commonDirectory(['packages/spec/a.ts', 'packages/species/b.ts']) === 'packages');
  t('files with nothing above the repo root share no directory', commonDirectory(['README.md', 'AGENTS.md']) === '');
  t('one file is its own directory', commonDirectory(['scripts/pm/a.mjs']) === 'scripts/pm');

  const rosterTree = watchHintTree(['scripts/a.mjs', 'scripts/b.mjs', 'scripts/pm/c.mjs']);
  const rosterFam = (hints) => ({ hints, files: [], workflows: new Set(['lint.yml']) });
  const roster = artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/b.mjs']), [unwrittenScript], rosterTree);
  t('a population of nothing but tracked FILES is an artifact roster', roster?.artifacts.length === 2 && roster.dir === 'scripts');
  t('…and it is flagged when the card edits the directory the roster sits in', roster?.coversYourPath === true);
  t(
    'the same roster is NOT flagged for a card somewhere else — it is a standing fact there, not a lead',
    artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/b.mjs']), ['packages/spec/src/index.ts'], rosterTree)?.coversYourPath === false,
  );
  t(
    'one declared DIRECTORY is a population, so the family is not a roster however many files sit beside it',
    artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/pm']), [unwrittenScript], rosterTree) === null,
  );
  t(
    'a literal the tree does not track is not an artifact either — that is the unreachable species',
    artifactOnlySilence(rosterFam(['scripts/gone.mjs']), [unwrittenScript], rosterTree) === null,
  );
  t('a family that declares nothing at all is undetermined, never a roster', artifactOnlySilence(rosterFam([]), [unwrittenScript], rosterTree) === null);
  const rosterNote = artifactOnlyNote(roster).join('\n');
  t('the note states the shape', rosterNote.includes('artifact roster') && rosterNote.includes('2 declared'));
  t(
    'and STOPS SHORT of claiming the gate reads your file — the half the tree cannot answer, and a fabricated lead if asserted',
    !/reads your file|very likely reads/.test(rosterNote),
    rosterNote,
  );
  t('names the remedy as the subtree spelling of the roster\'s OWN root', rosterNote.includes('scripts/**'));
  t('and hands over the discriminator instead of deciding intent', rosterNote.includes('If it really reads only those files'));
  t(
    'a roster that does not touch the card prints the standing fact, not the warning',
    artifactOnlyNote(artifactOnlySilence(rosterFam(['scripts/a.mjs', 'scripts/b.mjs']), ['packages/spec/src/index.ts'], rosterTree))
      .join('\n')
      .includes('ordinary one'),
  );

  // ── The classifier returned a plausible WRONG CATEGORY (#13520) ───────────
  //
  // ⚠️ Every case below asserts the CATEGORY, never "it did not crash" and
  // never "it still classifies". This defect threw nothing and printed no
  // error — it answered `null` where the answer is a roster, so a case that
  // only checked for an answer would have been GREEN against the bug. Each
  // assertion therefore names the bucket AND its contents: which tracked files,
  // under which directory, and for the negatives, `null` exactly.
  const extlessTree = watchHintTree([
    'packages/spec/scripts/lib/dist-freshness.ts',
    'packages/spec/scripts/lib/sharded-artifacts.ts',
    'packages/spec/scripts/lib/notes.md',
    'packages/spec/src/index.ts',
  ]);
  const extlessRoster = artifactOnlySilence(
    rosterFam(['packages/spec/scripts/lib/dist-freshness', 'packages/spec/scripts/lib/sharded-artifacts']),
    ['packages/spec/scripts/lib/dist-freshness.ts'],
    extlessTree,
  );
  t(
    'a roster spelled as extensionless module specifiers is an artifact ROSTER, not an ordinary silence',
    extlessRoster !== null,
    JSON.stringify(extlessRoster),
  );
  t(
    '…and the CATEGORY is pinned by its contents: the tracked files those specifiers name',
    JSON.stringify(extlessRoster?.artifacts) ===
      JSON.stringify(['packages/spec/scripts/lib/dist-freshness.ts', 'packages/spec/scripts/lib/sharded-artifacts.ts']),
    JSON.stringify(extlessRoster?.artifacts),
  );
  t(
    '…under the directory those files really sit in, not the one the specifier stops short at',
    extlessRoster?.dir === 'packages/spec/scripts/lib',
    String(extlessRoster?.dir),
  );
  t(
    '…and for a card in that directory it is the INVERTED silence, which is the whole point of the split',
    extlessRoster?.coversYourPath === true,
  );
  t(
    'a roster mixing both spellings of the same claim resolves to the same category',
    JSON.stringify(
      artifactOnlySilence(
        rosterFam(['packages/spec/scripts/lib/dist-freshness', 'packages/spec/scripts/lib/notes.md']),
        [],
        extlessTree,
      )?.artifacts,
    ) === JSON.stringify(['packages/spec/scripts/lib/dist-freshness.ts', 'packages/spec/scripts/lib/notes.md']),
  );
  // The negatives, which are what stop the widening from becoming a second
  // defect pointing the other way: a POPULATION must still refuse the roster
  // category however resolvable its siblings are.
  t(
    'a declared DIRECTORY beside resolvable specifiers is still a population, not a roster',
    artifactOnlySilence(
      rosterFam(['packages/spec/scripts/lib/dist-freshness', 'packages/spec/scripts/lib']),
      [],
      extlessTree,
    ) === null,
  );
  t(
    'a specifier that resolves to nothing is not an artifact — that is still the unreachable species',
    artifactOnlySilence(rosterFam(['packages/spec/scripts/lib/gone']), [], extlessTree) === null,
  );
  t(
    'a PATTERN whose collapse would land on a tracked file is refused before the file branch',
    declaredFileTarget('packages/spec/scripts/lib/dist-freshness*.ts', extlessTree) === null &&
      extlessTree.files.has(collapseHint('packages/spec/scripts/lib/dist-freshness*.ts')),
  );
  t(
    '…non-vacuously: that hint really is judged as a pattern, and the same literal without the glob resolves',
    judgedAsPattern('packages/spec/scripts/lib/dist-freshness*.ts') &&
      declaredFileTarget('packages/spec/scripts/lib/dist-freshness', extlessTree) ===
        'packages/spec/scripts/lib/dist-freshness.ts',
  );
  // The bare file set is the OLD parameter, and it is the one input that
  // reproduces the defect exactly. It must not be readable as an empty answer.
  let rosterRefusedBareSet = false;
  try {
    artifactOnlySilence(rosterFam(['scripts/a.mjs']), [], new Set(['scripts/a.mjs']));
  } catch {
    rosterRefusedBareSet = true;
  }
  t('a bare file set is REFUSED, never answered — it is the shape that mis-categorises silently', rosterRefusedBareSet);

  // ⭐ THE CLASS GUARD, and the reason this card is not "nine gate names added
  // to a table". The defect was ONE PREDICATE holding a private, weaker copy of
  // the covering rule; the copy is gone, and this holds the two instruments
  // EQUAL over the LIVE fleet, at FAMILY grain:
  //
  //   for every discovered family — `artifactOnlySilence` returns a roster
  //   exactly when every declared literal of that family names exactly one
  //   tracked file under `hintCovers`, and the roster IS those files.
  //
  // ⚠️ Family grain, not literal grain, and the difference was measured rather
  // than reasoned. Written against `declaredFileTarget` this case was GREEN
  // against the very bug it exists to catch: the ablation that put the old rule
  // back inside `artifactOnlySilence` left the resolver untouched, so a guard
  // comparing resolver to covering rule saw nothing wrong. A guard on the OWNER
  // does not hold the CALLER to it. Stated over the classifier's own output it
  // reds, because the classifier is what the reader is shown.
  //
  // Non-tautological in both directions: the right side is computed by sweeping
  // the whole tracked corpus through `hintCovers`, which shares no code with the
  // membership test and resolver the classifier composes. Measured while
  // writing this — before the repair the two disagreed about 40 of 754 declared
  // literals and 9 of 192 families; after it, 0 and 0. The day someone teaches
  // `hintCovers` a further spelling (the way #12514 taught it the extension
  // list) and forgets this reader, or reintroduces a private test in the
  // classifier, this reds for whatever family happens to carry it. No gate name
  // appears in it, which is the whole point.
  const classFiles = trackedFiles();
  const classTree = watchHintTree(classFiles);
  const classFams = [...discoverFamilies({ tree: classTree }).byCheck];
  const isTrackedDirHint = (h) => {
    const plain = collapseHint(h);
    return classTree.prefixes.has(plain) && !classTree.files.has(plain);
  };
  // The covering rule's own answer to "this literal names exactly one tracked
  // FILE": swept, not resolved. A pattern and a directory are declared
  // POPULATIONS and are excluded before the sweep — `apps/*/package.json`
  // reaches exactly one file on this tree only because the repo has one app.
  const coveringRuleFile = (h) => {
    if (judgedAsPattern(h) || isTrackedDirHint(h)) return null;
    const reached = classFiles.filter((f) => hintCovers(h, f));
    return reached.length === 1 ? reached[0] : null;
  };
  const ruleRoster = (entry) => {
    const declaredHints = [...new Set(entry.hints ?? [])];
    if (declaredHints.length === 0) return null;
    const named = declaredHints.map(coveringRuleFile);
    return named.every(Boolean) ? named : null;
  };
  const classSplit = classFams.map(([check, entry]) => [
    check,
    JSON.stringify(artifactOnlySilence(entry, [], classTree)?.artifacts ?? null),
    JSON.stringify(ruleRoster(entry)),
  ]);
  const classDisagreements = classSplit.filter(([, mine, rule]) => mine !== rule);
  t(
    `the roster classifier and the covering rule agree about every family in the fleet (${classFams.length} families)`,
    classDisagreements.length === 0,
    classDisagreements.slice(0, 5).map(([c, mine, rule]) => `${c}: classifier=${mine} rule=${rule}`).join(' · '),
  );
  // Non-vacuity for the case above — an agreement over an empty or all-null
  // population asserts nothing, and the fleet really does carry both the shape
  // this card was filed for and rosters that predate it.
  t(
    '…non-vacuously: the fleet carries families whose roster is named only through a dropped extension',
    classFams.some(([, entry]) => {
      const r = artifactOnlySilence(entry, [], classTree);
      return r && r.artifacts.some((a, i) => a !== collapseHint([...new Set(entry.hints ?? [])][i]));
    }),
  );

  // ── A trailing sentence period is not part of the path (#8534, half two) ──
  //
  // Coupled to the rule above: the raw-prefix comparison reached the real file
  // THROUGH the stray period, so the boundary rule alone would have taken this
  // hint from covering its own file to covering nothing. Both directions pinned.
  const dotted = extractWatchHints("const CITED = ['scripts/check-x.mjs.'];");
  t('a hint ending in a sentence period is trimmed to the path it names', dotted.includes('scripts/check-x.mjs'));
  t('no extracted hint ends in a dot', !dotted.some((h) => h.endsWith('.')));
  t('and the trimmed hint still reaches its file under the segment rule', dotted.some((h) => hintCovers(h, 'scripts/check-x.mjs')));
  t('trimming does not eat a leading dotted directory', extractWatchHints("const D = '.claude/agents';").includes('.claude/agents'));
  t('trimming does not eat a trailing glob', extractWatchHints("const G = 'packages/spec/src/**';").some((h) => h.includes('**')));

  // Change-kind derivation. The predicate is pinned in BOTH directions against
  // what the two gates themselves count: filename infix, never directory — a
  // helper inside `__tests__/` is in their non-test population.
  t('test file by .test infix', isTestFilePath('packages/objectql/src/engine.test.ts'));
  t('test file by .spec infix', isTestFilePath('packages/rest/src/server.spec.tsx'));
  t('test file with an mts extension', isTestFilePath('packages/spec/src/x.test.mts'));
  t('a __tests__ helper is NOT a test file to these gates', !isTestFilePath('packages/core/src/__tests__/fixtures.ts'));
  t('a plain source file is not a test file', !isTestFilePath('packages/objectql/src/engine.ts'));
  t('a non-TS file named test is not a test file', !isTestFilePath('docs/how.test.md'));

  const resolved = (name) => `pnpm ${name}`;
  const kindHit = changeKindLines(['packages/objectql/src/engine.test.ts'], resolved);
  // Seven: the kind's own heading plus its six gates (#10542 added
  // check:cross-package-test-inputs, whose judged population is exactly this
  // kind rather than a subtree any path hint can name).
  t('a test path emits the convention section', kindHit.length === 7 && kindHit[0].includes('adds or edits a test file'));
  // All three halves anchor on the rendered DELIMITERS (`- pnpm x   —`), for the
  // reason the i18n entry's pins below state at length: a bare `includes` is
  // satisfied by every name that merely STARTS WITH the expected one, so a
  // prefix-preserving rename is invisible to it — the single rot class the STALE
  // branch exists to report. Measured on this entry rather than inherited from
  // that one: renaming these gates to `check:query-options-erasure-v2` and
  // `check:type-check-coverage-v2` in CHANGE_KIND_GATES left the substring form
  // green at 61/61 while the live run printed both as STALE; anchored, the same
  // rename fails this case. The two conventions in this file now agree.
  //
  // The coverage/debt PAIR is pinned as a pair on purpose (#8545): they are two
  // invocations of one script, and the anchored form is what tells them apart —
  // `includes('pnpm check:type-check-coverage')` is satisfied by the debt line's
  // absence AND by a `-v2` rename, which is how a rationale describing the
  // ratchet went on naming the invocation that never runs it.
  t('the section names all five convention gates, runnably', kindHit.some((l) => l.includes('- pnpm check:query-options-erasure   —')) && kindHit.some((l) => l.includes('- pnpm check:type-check-coverage   —')) && kindHit.some((l) => l.includes('- pnpm check:type-check-debt   —')) && kindHit.some((l) => l.includes('- pnpm check:engine-double-contract   —')) && kindHit.some((l) => l.includes('- pnpm check:where-matcher   —')));
  // The two ratchets this entry gained (#8632), pinned apart from the pair
  // above because they arrived for a different reason: they were handed to the
  // PM's judgment in this file's closing prose while a structurally identical
  // ratchet sat in this table. Their `why` must carry the repair direction —
  // fix the double / refuse the unsupported shape — because both baselines are
  // shrink-only and a seat that raises one turns a caught defect into a pinned
  // one.
  const doubleLine = kindHit.find((l) => l.includes('- pnpm check:engine-double-contract   —')) ?? '';
  const whereLine = kindHit.find((l) => l.includes('- pnpm check:where-matcher   —')) ?? '';
  t('the engine-double line states the guard it wants and refuses the baseline raise', /assertEngineDeleteDispatch/.test(doubleLine) && /shrink-only/.test(doubleLine));
  t('the where-matcher line states that refusing is the conforming repair', /refus/i.test(whereLine) && /shrink-only/.test(whereLine));
  // The ratchet line's prerequisite is part of the product, not decoration: a
  // seat that runs `--re-measure` on an unbuilt worktree gets a throw, and an
  // unexplained throw reads as "not applicable to me" — which is a green report
  // over a gate that never ran. So the printed line must carry both the
  // condition and a command that satisfies it.
  const debtLine = kindHit.find((l) => l.includes('- pnpm check:type-check-debt   —')) ?? '';
  t('the ratchet line states its built-closure prerequisite', /closure BUILT|BUILT closure/.test(debtLine) && debtLine.includes('turbo run build'));
  t('a non-test path in no other kind emits nothing — a .mjs is outside the root tsc program too', changeKindLines(['scripts/pm/dispatch-gates.mjs'], resolved).length === 0);

  // ── The ROOT tsc program entry (#9873) ────────────────────────────────────
  //
  // The one gate population no path literal can describe: the root program is
  // declared by EXCLUSION, so this entry derives the complement from the root
  // tsconfig's own list. These pin the predicate, the config read under it, the
  // rendered line, and the property the entry was added for — the path from the
  // PR that paid for this now derives the ratchet.
  const rootExcl = rootTsProgramExcludedDirs();
  t('the root exclude list is read from the config and is not empty', rootExcl.length > 0);
  t('and it really names the three source trees tsc skips', ['packages', 'apps', 'examples'].every((d) => rootExcl.includes(d)));
  t('a new script in the root tree is in the root program — the PR #9853 case', isInRootTsProgram('scripts/bench/runtime-publish-gate.bench.mts', rootExcl));
  t('so is a top-level config file', isInRootTsProgram('tsup.config.ts', rootExcl));
  t('so is a declaration file in the same tree', isInRootTsProgram('scripts/check-regen-pending.d.mts', rootExcl));
  t('a leading ./ does not hide one', isInRootTsProgram('./scripts/check-test-typecheck.mts', rootExcl));
  t('a package source is NOT in the root program', !isInRootTsProgram('packages/rest/src/rest-server.ts', rootExcl));
  t('nor an app source', !isInRootTsProgram('apps/console/src/main.ts', rootExcl));
  t('nor an example source — imports can still pull one in, which the entry note states as its limit', !isInRootTsProgram('examples/app-showcase/src/data/objects/index.ts', rootExcl));
  // The extension half, which is what keeps this entry from firing on nearly
  // every card that touches tooling. The root config sets no `allowJs`, so the
  // tree's checker scripts are outside the program: 117 tracked JS files sit in
  // these same directories against 11 TypeScript files that are really in it,
  // so a bare "outside those directories" test would fire on 128 paths to reach
  // 11 — and send each of them to a ratchet that needs a built closure.
  t('a checker script is NOT in the root program — the root config sets no allowJs', !isInRootTsProgram('scripts/check-type-check-coverage.mjs', rootExcl));
  t('nor is this deriver itself', !isInRootTsProgram('scripts/pm/dispatch-gates.mjs', rootExcl));
  t('nor a non-TS file that merely lives there', !isInRootTsProgram('scripts/pm/README.md', rootExcl));

  // The exclude-SHAPE guard. This complement can only judge plain directory
  // names and silently drops anything else; dropping WIDENS the kind, so the
  // rot would be quiet by construction. This pair is what makes it loud.
  t('plain directory names are judged', isPlainTopLevelDir('packages') && isPlainTopLevelDir('.github'));
  t('a nested path is not a plain directory name', !isPlainTopLevelDir('packages/objectql/src/engine.test.ts'));
  t('nor is a pattern form', !isPlainTopLevelDir('*.test.ts') && !isPlainTopLevelDir('[abc]'));
  t('nor an empty or non-string entry', !isPlainTopLevelDir('') && !isPlainTopLevelDir(null));
  t('the LIVE root tsconfig still consists only of the shape this reads', rootTsconfigExcludeEntries().every(isPlainTopLevelDir));

  // The rendered line, anchored on the delimiters for the reason the pair
  // above states at length: a bare `includes` survives a prefix-preserving
  // rename, which is the one rot class the STALE branch exists to report.
  const rootKind = changeKindLines(['scripts/bench/runtime-publish-gate.bench.mts'], resolved);
  t('a root-program path emits the convention section', rootKind.length === 2 && rootKind[0].includes('ROOT tsc program'));
  t('and it names the RATCHET half — the invocation that re-measures', rootKind.some((l) => l.includes('- pnpm check:type-check-debt   —')));
  const rootLine = rootKind.find((l) => l.includes('- pnpm check:type-check-debt   —')) ?? '';
  t('the root-program line refuses the baseline raise and states the real repair', /shrink-only/.test(rootLine) && /maintainer-only/.test(rootLine));
  t('and carries the built-closure prerequisite, like the other ratchet line', /closure BUILT/.test(rootLine) && rootLine.includes('turbo run build'));
  // Re-pointed rather than deleted (#12074). This case pinned one property —
  // a `.mjs` checker script is NOT in the ROOT tsc program, unlike the `.mts`
  // bench file above — and the gate-script kind below now makes the same path
  // emit a DIFFERENT section. So the property is asserted where it still lives:
  // the root-program heading and its ratchet stay absent, and what does render
  // is named, so a future kind that starts firing here reddens instead of
  // hiding inside a `length` this case no longer checks.
  const checkerKind = changeKindLines(['scripts/check-type-check-coverage.mjs'], resolved);
  t('a checker script is still outside the ROOT tsc program', !checkerKind.some((l) => l.includes('ROOT tsc program')));
  t('…and the root ratchet is not named for it', !checkerKind.some((l) => l.includes('- pnpm check:type-check-debt   —')));
  t('…and the ONE section it does emit is the gate-script kind', checkerKind.length === 3 && checkerKind[0].includes('GATE SCRIPT'));

  // -- The GATE SCRIPT entry (#12074) --------------------------------------
  //
  // The card: a new gate carries LANDING OBLIGATIONS that no derivation
  // enumerates, so they are learned from red CI after the dev has already
  // reported -- which costs the reviewing seat a correction on a verdict it had
  // issued. Measured at four devs and two obligations, twice inside one hour.
  //
  // The obligations are real gates that already know how to detect their own
  // omission; what was missing is a pre-CI channel that ASKS them. This entry is
  // that channel, and it is a KIND rather than a path derivation for the reason
  // #10542 gives for check:cross-package-test-inputs: neither gate declares the
  // population it judges. Both DISCOVER it -- they open exactly the files the
  // families resolve to -- so the honest trigger is that same identity, and the
  // precision is 100% by construction rather than by estimate.
  const gateFiles = gateFamilyFiles();
  t('the gate-script population is derived and non-empty (this kind is not vacuous)', gateFiles.size > 50);
  t('a gate script is one', isGateScriptPath('scripts/check-type-check-coverage.mjs', gateFiles));
  t('a leading ./ does not hide one', isGateScriptPath('./scripts/check-type-check-coverage.mjs', gateFiles));
  t('an ordinary source file is not', !isGateScriptPath('packages/objectql/src/engine.ts', gateFiles));
  // The two directions that make the FILENAME spelling wrong, pinned as
  // directions rather than as counts, so they redden if someone swaps the
  // identity test for the `check-*` regex the card proposed. Both were measured
  // on this tree: the regex fabricates 10 leads and misses 31 real gate scripts,
  // 93.3% precision and 81.8% recall against 100/100 here.
  t('a name-shaped script no family runs is NOT a gate script — the fabrication direction',
    !isGateScriptPath('scripts/check-dts-emitted.mjs', gateFiles));
  t('…and a real gate that is not called check-anything IS one — the recall direction',
    isGateScriptPath('packages/spec/scripts/build-schemas.ts', gateFiles));
  // The two instances this card measured. They are the whole reason the entry
  // exists, so they are pinned as paths rather than described.
  t('the first measured CI red is in the kind', isGateScriptPath('scripts/check-objectql-double-limit.mjs', gateFiles));
  t('the second measured CI red is in the kind', isGateScriptPath('scripts/check-i18n-stale-fill.mjs', gateFiles));

  // The rendered section, anchored on the delimiters for the reason the entries
  // above state at length: a bare `includes` survives a prefix-preserving
  // rename, the one rot class the STALE branch exists to report.
  const gateKind = changeKindLines(['scripts/check-objectql-double-limit.mjs'], resolved);
  t('a gate-script path emits the convention section', gateKind.length === 3 && gateKind[0].includes('GATE SCRIPT'));
  t('and it names the bare-root self-test, runnably',
    gateKind.some((l) => l.includes('- pnpm scripts/pm/bare-root-worklist.mjs --self-test   —')));
  t('and it names this tool own gate too — the SECOND obligation, which no path derivation reaches',
    gateKind.some((l) => l.includes('- pnpm check:pm-dispatch-gates   —')));
  // Each `why` has to carry the half a dev cannot re-derive, or the lead is a
  // command with no obligation attached to it.
  const bareLine = gateKind.find((l) => l.includes('bare-root-worklist')) ?? '';
  const escLine = gateKind.find((l) => l.includes('- pnpm check:pm-dispatch-gates   —')) ?? '';
  t('the bare-root line states that an EDIT counts, by naming all three directions',
    /FRESH/.test(bareLine) && /STALE/.test(bareLine) && /CONTRADICTED/.test(bareLine));
  t('…and refuses the two wrong repairs the failure text warns about',
    /shrink-only/.test(bareLine) && /costlier error/.test(bareLine));
  t('the escapable-literal line states that identity is its ONLY route, so the silence is not a clearance',
    /artifact roster/.test(escLine) && /IDENTITY/.test(escLine));
  t('…and refuses reaching for the declare remedy by default', /shrink-only/.test(escLine) && /by default/.test(escLine));
  // Both names pinned individually beside the census guard's own reasoning: a
  // count alone stays green if one is dropped and another added.
  t('the bare-root self-test is a live family, so naming it is not a guess',
    [...discoverFamilies().byCheck.keys()].includes('scripts/pm/bare-root-worklist.mjs --self-test'));
  // A non-gate script in no other kind still emits nothing — the genuine zero
  // this block took over from the re-pointed case above. Read FROM THE TREE
  // rather than spelled, so it cannot rot into a path that quietly became a
  // gate and turned this case vacuous.
  const nonGate = trackedFiles().find((f) => f.startsWith('scripts/') && f.endsWith('.mjs') && !gateFiles.has(f));
  t('a non-gate script exists to probe the zero with', Boolean(nonGate));
  t('…and it emits no convention section at all', changeKindLines([nonGate], resolved).length === 0);


  // i18n change-kind derivation — the pure judgments first, each mirroring one
  // line of the gate's own `findConfigs`.
  t('an extract config under scripts/ is one', isExtractConfigPath('packages/services/service-messaging/scripts/i18n-extract.config.ts'));
  t('the same filename OUTSIDE scripts/ is not', !isExtractConfigPath('packages/services/service-messaging/src/i18n-extract.config.ts'));
  t('another config under scripts/ is not', !isExtractConfigPath('packages/platform-objects/scripts/build-docs.config.ts'));
  t('owner is the package above scripts/', owningPackageOfExtractConfig('packages/plugins/plugin-audit/scripts/i18n-extract.config.ts') === 'packages/plugins/plugin-audit');
  t('an owner collapsing to a bare top-level dir is refused', owningPackageOfExtractConfig('packages/scripts/i18n-extract.config.ts') === null);

  const owners = ['packages/platform-objects', 'packages/services/service-messaging'];
  t('a deep path inside an owning package qualifies', isInI18nBundlePackage('packages/services/service-messaging/src/objects/http-delivery.object.ts', owners));
  t('the config file itself qualifies (whole package, not just objects)', isInI18nBundlePackage('packages/services/service-messaging/scripts/i18n-extract.config.ts', owners));
  t('the package directory itself qualifies', isInI18nBundlePackage('packages/platform-objects', owners));
  t('a path in a package WITHOUT a config does not', !isInI18nBundlePackage('packages/objectql/src/engine.ts', owners));
  t('a sibling sharing a name prefix does not', !isInI18nBundlePackage('packages/services/service-messaging-extra/src/x.ts', owners));
  t('a parent directory does not drag in owners below it', !isInI18nBundlePackage('packages/services', owners));

  // The walk itself, against the real tree — the half no fixture can prove.
  const liveOwners = i18nBundlePackageDirs();
  t('the live walk discovers owning packages', liveOwners.length > 0 && liveOwners.every((d) => d.startsWith('packages/')));
  t('the live walk finds no duplicate owners', new Set(liveOwners).size === liveOwners.length);
  t('the live walk excludes a package that owns no config', !liveOwners.includes('packages/objectql'));
  // Regression pin for the measured miss (PR #8348): this exact path derived no
  // check:i18n. If service-messaging ever stops owning a bundle, this case fails
  // and the answer is to re-point it at a package that does, not to delete it.
  t('the measured incident path now derives the kind', isInI18nBundlePackage('packages/services/service-messaging/src/objects/http-delivery.object.ts', liveOwners));

  // The name assertions below anchor on the rendered DELIMITERS (`- pnpm x   —`,
  // `⚠ x: STALE`), not on a bare substring. Measured while reverse-verifying this
  // entry: renaming the gate to `check:i18n-renamed-probe` made the live run
  // print STALE exactly as designed, and a `includes('pnpm check:i18n')` pin
  // stayed green through it — every prefix-preserving rename is invisible to a
  // substring, which is the one class of rot the STALE branch exists to catch.
  const i18nHit = changeKindLines(['packages/services/service-messaging/src/objects/http-delivery.object.ts'], resolved);
  // One kind line plus one line per gate in the entry — TWO gates since #11671
  // added the stale-fill ratchet to the same file surface. The count is pinned
  // (not `>= 1`) so a gate silently dropped from the entry fails here.
  t('an owning-package path emits the i18n convention section', i18nHit.length === 3 && i18nHit[0].includes('owns an i18n-extract.config.ts'));
  t('the i18n section names check:i18n exactly, runnably', i18nHit.some((l) => l.includes('- pnpm check:i18n   —')));
  // #11671: the two gates answer DIFFERENT moves on the same surface — check:i18n
  // sees a key set change, this one sees a source string REVISED under a stale
  // translated leaf. The delimiter anchor keeps the check:i18n pin above from
  // matching this line by prefix, and vice versa.
  t('the i18n section also names check:i18n-stale-fill, runnably', i18nHit.some((l) => l.includes('- pnpm check:i18n-stale-fill   —')));
  t('a path outside every owning package emits no i18n section', !changeKindLines(['packages/objectql/src/engine.ts'], resolved).some((l) => l.includes('check:i18n')));

  // ── The error-code CONTENT kind (#12850) ─────────────────────────────────
  //
  // The only entry in this table judged from a file's CONTENT rather than its
  // path, so its cases are shaped differently: the limbs are driven through an
  // INJECTED reader (offline, no tree), and the tree itself is used only for
  // the two properties a fixture cannot pin — that the predicate still reaches
  // the real specimen, and that it still DISCRIMINATES.
  const codeSrc = (text) => (_path) => text;
  const stamps = (text, path = 'packages/x/src/a.ts') => stampsAnErrorCodeLiteral(path, codeSrc(text));
  t('a quoted code literal in a stamp position is a hit', stamps("const e = { code: 'NOT_CREATABLE' };"));
  t('a SCREAMING_SNAKE constant in a stamp position is a hit', stamps('const e = { code: NOT_CREATABLE };'));
  t('an assigned code is a hit', stamps("err.code = 'FLOW_FAILED';"));
  t('an optional code FIELD TYPE is a hit', stamps("interface E { code?: 'FLOW_FAILED' }"));
  // The specimen shape from #12843, spelled out: without the `typeof` limb this
  // case is the one that fails, and it is the exact form that cost the round
  // trip — a literal `code` type reached through a named constant.
  t('a typeof reference to a code constant is a hit — the #12843 shape',
    stamps('interface N { code: typeof CONVERSION_NOTICE_CODE; }'));
  // The declaration half of that same shape, which carries no `code` token at
  // all and is therefore invisible to every `code`-anchored limb.
  t('a SCREAMING_SNAKE constant bound to a SCREAMING_SNAKE string is a hit',
    stamps("export const CONVERSION_NOTICE_CODE = 'OS_METADATA_CONVERTED' as const;"));
  t('a file with neither shape is not a hit', !stamps('export function add(a: number, b: number) { return a + b; }'));
  // Masking is load-bearing in the cheap direction only: a code the gate would
  // never report because it is not in source cannot cost a run here either.
  t('a code discussed only in a comment is not a hit', !stamps("// code: 'NOT_CREATABLE' is stamped elsewhere\nexport const x = 1;"));
  t('a lowercase constant binding is not a hit', !stamps("const notACode = 'lowercase';"));
  // Population: the gate does not read tests, declaration files or non-TS, so
  // neither does the lead. Each is driven with content that WOULD hit, so the
  // case fails if the population half stops being consulted.
  t('a test file carrying a stamp is not a hit', !stamps("const e = { code: 'X_Y' };", 'packages/x/src/a.test.ts'));
  t('a d.ts carrying a stamp is not a hit', !stamps("const e = { code: 'X_Y' };", 'packages/x/src/a.d.ts'));
  t('a non-TS file carrying a stamp is not a hit', !stamps("const e = { code: 'X_Y' };", 'packages/x/src/a.md'));
  // The unreadable branch, pinned as its own case because it is the one this
  // entry deliberately does NOT close: at dispatch time the card's surface is a
  // hypothesis, and a file with no content on disk answers false rather than
  // falling back to a path match. A regression here would be silent.
  t('a path with nothing to read is not a hit, and does not throw', !stampsAnErrorCodeLiteral('packages/x/src/a.ts', () => null));
  t('…and the live reader answers the same way for a path the tree does not have',
    !stampsAnErrorCodeLiteral('packages/there-is-no-such-package/src/a.ts'));

  // Anti-vacuity, against the REAL tree: the shape that cost #12843 a CI round
  // trip must still be reached. Spelled rather than discovered because it IS
  // the specimen — a derived probe would answer about some other file.
  const CODE_SPECIMEN = 'packages/spec/src/conversions/types.ts';
  t('the live tree still carries the #12843 specimen shape, and the predicate reaches it',
    stampsAnErrorCodeLiteral(CODE_SPECIMEN));
  // The discrimination pin, and the one case that holds this card's ruling
  // mechanically: a content trigger is only worth having while it names the
  // gate for SOME cards and not for most. The path spelling this entry refuses
  // would have scored 39%; if a future widening pushes this predicate up there,
  // the entry has become the thing it was written against and this case fails.
  const codeCorpus = trackedFiles().filter((f) => /\.[cm]?tsx?$/.test(f) && !/\.d\.[cm]?ts$/.test(f) && !isTestFilePath(f));
  const codeHits = codeCorpus.filter((f) => stampsAnErrorCodeLiteral(f));
  t(`the content trigger discriminates: ${codeHits.length} of ${codeCorpus.length} non-test TS files (neither vacuous nor tree-wide)`,
    codeCorpus.length > 500 && codeHits.length > 20 && codeHits.length < codeCorpus.length / 4);

  // The rendered section, driven through THIS entry alone so the count is a
  // statement about the entry rather than about which other kinds happen to
  // fire for the specimen path.
  const codeEntry = CHANGE_KIND_GATES.filter((k) => k.gates.some((g) => g.name === 'check:dispatcher-error-vocabulary'));
  t('exactly one entry in the table names the vocabulary gate', codeEntry.length === 1);
  const codeKind = changeKindLines([CODE_SPECIMEN], resolved, codeEntry);
  t('a code-carrying path emits the convention section', codeKind.length === 2 && codeKind[0].includes('judged from CONTENT'));
  t('and it names the vocabulary gate runnably, anchored on the delimiter',
    codeKind.some((l) => l.includes('- pnpm check:dispatcher-error-vocabulary   —')));
  const codeLine = codeKind.find((l) => l.includes('- pnpm check:dispatcher-error-vocabulary   —')) ?? '';
  // The `why` owes the three halves a dev cannot re-derive from the command:
  // why no path derivation names it, what the repair direction is, and that it
  // needs no build (unlike the two ratchets in this same table).
  t('the vocabulary line states why no path derivation reaches it', /REFUSE-WIDE/.test(codeLine));
  t('…and pushes the repair to registration rather than to a tolerant consumer',
    /REGISTERING/.test(codeLine) && /never by widening a consumer/.test(codeLine));
  t('…and says it needs no build, unlike the ratchets in this table', /needs NO build/.test(codeLine));
  // The card's second ruling, pinned: the over-broad direction is the chosen
  // one and the trade is written where the next reader will meet it. A silent
  // narrowing that drops this sentence fails here.
  t('…and writes the false-positive trade down, so nobody assumes narrowing is free',
    /deliberately WIDE/.test(codeLine) && /CI round trip/.test(codeLine));

  // ── The metadata-form edge (#9116) ────────────────────────────────────────
  //
  // The bundles' OTHER producer, and the half no owning-package test can reach:
  // the metadataForms surface is registry-driven, its source lives in
  // packages/spec, and packages/spec owns no extract config. Pure judgments
  // first, then the live tree, then both rendering directions.
  t('a form module is one', isMetadataFormModulePath('packages/spec/src/data/object.form.ts'));
  t('its sibling schema is not', !isMetadataFormModulePath('packages/spec/src/data/object.zod.ts'));
  t('a bare .form.ts with no name is not one', !isMetadataFormModulePath('packages/spec/src/data/.form.ts'));
  t('a form module test file is not one', !isMetadataFormModulePath('packages/spec/src/data/object.form.test.ts'));

  const formMods = ['packages/spec/src/data/object.form.ts', 'packages/spec/src/ui/view.form.ts'];
  t('the module itself reaches', reachesMetadataFormModule('packages/spec/src/data/object.form.ts', formMods));
  t('a directory CONTAINING one reaches (a card surface is named before its files exist)', reachesMetadataFormModule('packages/spec/src/ui', formMods));
  t('a sibling sharing a name prefix does not', !reachesMetadataFormModule('packages/spec/src/dat', formMods));
  t('an unrelated package does not', !reachesMetadataFormModule('packages/objectql/src/engine.ts', formMods));
  // The over-broad direction, the expensive one: a bare top-level directory
  // covers the whole tree below it, so it must not drag every form module in.
  t('a bare top-level directory is refused', !reachesMetadataFormModule('packages', formMods));

  // Applicability is READ from the configs, not assumed — the flag that decides
  // whether any package still commits the shared baseline at all.
  t('a config with no opt-out extracts the metadata-form surface', flagsExtractMetadataForms(['--locales=zh-CN', '--fill=default']));
  t('the opt-out flag removes it', !flagsExtractMetadataForms(['--objects-only', '--no-metadata-forms']));

  // The live tree — the half no fixture can prove.
  const liveForms = metadataFormModulePaths();
  t('the live walk discovers form modules', liveForms.length > 0 && liveForms.every((f) => f.endsWith('.form.ts')));
  t('the live walk finds no duplicates', new Set(liveForms).size === liveForms.length);
  // If this flips, the entry stops firing BY DESIGN (every package opted out of
  // the shared baseline) — read the entry's deletion criterion before "fixing" it.
  t('some package still commits the shared metadata-form baseline', metadataFormsSurfaceIsExtracted());

  // Regression pin for the measured incident (PR #9113): these two exact paths
  // moved four platform-objects bundles, reddened check:i18n on CI, and derived
  // NOTHING — the family appeared in neither half of the output. Anchored on the
  // rendered delimiters for the reason the entry above states: a bare substring
  // stays green through a prefix-preserving rename, the one rot the STALE branch
  // exists to catch.
  const formHit = changeKindLines(['packages/spec/src/data/object.form.ts', 'packages/spec/src/data/field.form.ts'], resolved);
  // The `?? ''` is not defensive noise: reverse-verifying this block by making
  // every config opt out emptied `formHit`, and the bare index CRASHED the whole
  // self-test on a TypeError — one stack in place of 180-odd named verdicts. A
  // case that stopped holding must fail BY NAME, with its reason, the way the
  // i18n gate's own self-test says it (its `staleForDetail` fallback exists for
  // exactly this). Ablating the entry now reddens these three and nothing else.
  const formKindLine = formHit[0] ?? '';
  t('the measured incident paths now emit the metadata-form section', formHit.length === 2 && formKindLine.includes('metadata form module'));
  t('that section names check:i18n exactly, runnably', formHit.some((l) => l.includes('- pnpm check:i18n   —')));
  t('and it names both incident paths, not just the first', formKindLine.includes('object.form.ts') && formKindLine.includes('field.form.ts'));
  // The over-trigger direction, which the card demanded in its own right: a spec
  // change that touches no form must NOT be pushed into this gate. Both a schema
  // beside a real form module and an unrelated package are pinned, because the
  // first is the one a filename convention could plausibly over-reach into.
  t('a spec schema next door to a form emits no i18n section', !changeKindLines(['packages/spec/src/data/filter.zod.ts'], resolved).some((l) => l.includes('check:i18n')));
  t('an unrelated package still emits no i18n section', !changeKindLines(['packages/rest/src/rest-server.ts'], resolved).some((l) => l.includes('check:i18n')));
  const formStale = changeKindLines(['packages/spec/src/data/object.form.ts'], () => null);
  t('an undiscoverable check:i18n renders STALE for this entry too', formStale.filter((l) => l.includes('⚠ check:i18n: STALE')).length === 1);

  // The measured incident (#8410 / PR #8399), pinned against the REAL workflow
  // rather than a fixture: a fixture proves the parser, only the live file
  // proves that THIS repo's changeset gate is reachable. `Check Changeset`
  // invokes check-adr-0087-registration.mjs from a block-scalar body, and that
  // is the gate PR #8399's declared-breaking changeset went red on after a
  // fully green local loop. If the step is ever rewritten as a one-liner this
  // case still passes (it asserts discovery, not the YAML style); if the gate
  // moves out of pr-automation.yml, re-point the case at its new home rather
  // than deleting it.
  const liveWf = readFileSync(join(ROOT, '.github/workflows/pr-automation.yml'), 'utf8');
  const liveInvs = extractCheckInvocations(liveWf, 'pr-automation.yml').map((i) => i.check);
  t('the live Check Changeset job discovers its ADR-0087 gate', liveInvs.includes('scripts/check-adr-0087-registration.mjs'));
  t('the live Check Changeset job discovers its empty-changeset gate', liveInvs.includes('scripts/check-empty-changeset.mjs'));
  t('the live one-line gate in that file still discovers', liveInvs.includes('scripts/check-changeset-no-major.mjs'));
  // The end-to-end direction: a `.changeset/` path must now REACH the ADR-0087
  // gate through the ordinary watch-hint match. That gate names `.changeset` in
  // its own source, so this asserts the whole chain (discover -> resolve ->
  // hint -> cover) rather than the parser alone.
  const adrHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-adr-0087-registration.mjs'), 'utf8'), 'scripts/check-adr-0087-registration.mjs');
  t('a .changeset path is covered by the ADR-0087 gate own hints', adrHints.some((h) => hintCovers(h, '.changeset/some-breaking-change.md')));

  // ── The measured population (#8478), against the REAL scripts ─────────────
  //
  // A fixture proves the boundary; only these files prove that THIS tree's
  // gates land on the right side of it. Each pin names a path the card measured
  // before the narrowing, so a regression reads as the specific claim it broke
  // rather than as a count. If a gate is renamed or moves, re-point the case at
  // its new home — deleting one deletes the evidence, not the problem.
  //
  // Measured on this branch's base (commit 3208222) and after, coverage-capable
  // hints per script: dispatch-gates 46 -> 5, check-empty-changeset 36 -> 3,
  // check-adr-0087-registration 34 -> 6, check-skill-id-lint 2 -> 2 (already
  // clean, the control). Across all 66 discoverable gate scripts: 1144 hints ->
  // 473, with no hint gained that any repo path can reach.
  const readHints = (rel) => extractWatchHints(readFileSync(join(ROOT, rel), 'utf8'), rel);
  const covers = (hs, p) => hs.some((h) => hintCovers(h, p));

  t(
    'the ADR-0087 gate no longer claims a runtime path through its own fixtures',
    !covers(adrHints, 'packages/runtime/src/index.ts'),
  );
  const emptyHints = readHints('scripts/check-empty-changeset.mjs');
  t('the empty-changeset gate still reaches a .changeset path', covers(emptyHints, '.changeset/anything.md'));
  t(
    'the empty-changeset gate no longer claims a skills path through its own fixtures',
    !covers(emptyHints, 'skills/demo/SKILL.md'),
  );
  // The load-bearing survivor: this gate's real literals are the per-file
  // ceiling keys (repo-relative paths in its CEILINGS map) — before the
  // narrowing it reached SKILL.md only through a path copy in its own header,
  // a real input carried by prose.
  const ratchetHints = readHints('scripts/pm/check-skill-line-ratchet.mjs');
  t('the skill ratchet still reaches the SKILL.md it counts', covers(ratchetHints, '.claude/skills/pm-dispatch/SKILL.md'));
  t('the skill ratchet reaches the references files it now counts', covers(ratchetHints, '.claude/skills/pm-dispatch/references/dispatch-runbook.md'));
  t(
    'the skill ratchet claims only its covered files, not all of references/',
    !covers(ratchetHints, '.claude/skills/pm-dispatch/references/facts.md'),
  );
  // The control the card called "what a clean one looks like": two hints, both
  // real, unchanged by the narrowing.
  const idLintHints = readHints('scripts/pm/check-skill-id-lint.mjs');
  t('the skill-id lint keeps both of its real inputs', covers(idLintHints, '.claude/skills/pm-dispatch/SKILL.md') && covers(idLintHints, '.claude/agents/os-dev.md'));
  // This tool's own gate: its thin gate file's one literal is the tool, so a
  // card editing the tool must still derive it.
  t('the dispatch-gates gate still reaches the tool it runs', covers(readHints('scripts/pm/check-dispatch-gates.mjs'), 'scripts/pm/dispatch-gates.mjs'));
  // And this file, the worst specimen in the card's table: the directory it
  // really reads survives, the fixtures naming other packages do not. The spec
  // contract surface DOES hint now — via the declared module-body suspect glob
  // (a real constant, not a fixture; inert for gate matching for the reason the
  // MANDATORY_TIER_GLOBS docblock records) — so the fixture-masking claim is
  // pinned on a path only fixtures name.
  const ownHints = readHints('scripts/pm/dispatch-gates.mjs');
  t('this tool still hints the workflow directory it reads', covers(ownHints, '.github/workflows/lint.yml'));
  t('this tool hints the spec contract surface via the DECLARED suspect glob', covers(ownHints, 'packages/spec/src/data/filter.zod.ts'));
  t('this tool still does not hint the paths only its fixtures name', !covers(ownHints, 'packages/objectql/src'));
  // The LIVE trailing-dot specimen (#8534): this gate spells its own filename as
  // the last word of a sentence, in a module-body array element that comment
  // masking cannot reach, so the hint carried the period. Pinned live because
  // the fixture above proves the trimming and only this file proves the tree
  // still contains the shape. If that sentence is ever rewritten, re-point the
  // case at whatever file then carries a trailing-dot literal — or, if none
  // does, delete it together with the trim, never ahead of it.
  const compatHints = readHints('scripts/check-skill-compatibility-version.mjs');
  t('the live trailing-dot hint is trimmed to the file it names', compatHints.includes('scripts/check-skill-compatibility-version.mjs'));
  t('so it still reaches that file under the segment rule', covers(compatHints, 'scripts/check-skill-compatibility-version.mjs'));

  // ── The one DECLARED coupling (#8551) ─────────────────────────────────────
  //
  // The narrowing above is about gates that MENTION a path without reading it.
  // This is its mirror image: a gate that really does move with a path it never
  // opens. The type-check ledgers ratchet a count for the workspace root, whose
  // program is the scripts tree, and one script accounts for 29 of that entry's
  // 80 errors — so editing it moves a number this farm holds. The coupling was
  // written down all along, inside the ledger note's prose, where whole-literal
  // extraction discards it: the family then scored `silent` — neither matched
  // nor undetermined, printed nowhere — and a card editing that script was told
  // no family names its paths.
  //
  // The remedy is per-coupling and manual (a bare, whole-literal constant in
  // the gate's own module body), which is exactly the kind of declaration that
  // rots quietly. So it is pinned LIVE, against both real files: delete the
  // constant and this gate reddens instead of the silence coming back. If the
  // ledger's coupling genuinely ends, delete the constant AND these cases in
  // the same change — the evidence goes with the claim, never ahead of it.
  //
  // This does NOT retire the test-file entry in CHANGE_KIND_GATES, whose
  // deletion criterion is a discoverable literal for that KIND: the constant
  // names one script carrying no `.test.` infix, while that entry answers for
  // every test file in the tree.
  const coverageHints = readHints('scripts/check-type-check-coverage.mjs');
  t(
    'the type-check ledger gate declares the root-program script whose errors it ratchets',
    covers(coverageHints, 'scripts/check-test-typecheck.mts'),
  );
  const coupledVerdict = classifyEntry(
    { files: ['scripts/check-type-check-coverage.mjs'], hints: coverageHints },
    ['scripts/check-test-typecheck.mts'],
  );
  t(
    'so a card editing that script is MATCHED through that constant, not dropped as silent',
    coupledVerdict.verdict === 'matched' && coupledVerdict.hits[0]?.hint === 'scripts/check-test-typecheck.mts',
  );

  // The same coupling, for the module this file now IMPORTS its i18n walks from
  // (#9116). Sharing one enumeration between the gate and this tool removed a
  // mirror, and it would have opened a smaller hole of exactly the kind this
  // card is about: an import specifier is not a discoverable hint, so a card
  // editing the shared module could move two gates while deriving neither.
  // Both are pinned LIVE against the real files — delete either constant and
  // this reddens instead of the silence coming back.
  const SHARED = 'scripts/i18n-bundle-surface.mjs';
  t(
    'the i18n gate declares the module its population is enumerated by',
    covers(readHints('scripts/check-i18n-bundles.mjs'), SHARED),
  );
  t(
    'the dispatch-gates gate declares it too, since the tool self-test drives those functions',
    covers(readHints('scripts/pm/check-dispatch-gates.mjs'), SHARED),
  );
  t(
    'and that gate still reaches the tool it runs — the new constant displaces nothing',
    covers(readHints('scripts/pm/check-dispatch-gates.mjs'), 'scripts/pm/dispatch-gates.mjs'),
  );
  // The shared module is a real file, so the two claims above are live rather
  // than a pair of matching strings.
  t('the declared shared module exists', existsSync(join(ROOT, SHARED)));

  // The same coupling once more, for the frame-sync gate whose COPIES table
  // the 2026-08-20 clause-① narrowing made a DEFINING input of the tier
  // mandate. The tool's self-test reaches it through a spawned import — not a
  // discoverable hint — so the gate declares it as a constant, and this pin
  // keeps that declaration live: delete it and this reddens instead of a
  // COPIES edit moving the gate's verdict while deriving nothing.
  const FRAME = 'scripts/check-skill-frame-sync.mjs';
  t(
    'the dispatch-gates gate declares the frame-sync module the tier mandate is defined against',
    covers(readHints('scripts/pm/check-dispatch-gates.mjs'), FRAME),
  );
  t('the declared frame-sync module exists', existsSync(join(ROOT, FRAME)));

  // The same shape again, for the TYPE-registry edge of walkMetadataForms
  // (#9144) — two specific, known files rather than a runtime-enumerated
  // population, so they are closed as coupling constants in
  // check-i18n-bundles.mjs rather than a third CHANGE_KIND_GATES entry. Both
  // directions pinned LIVE: delete either constant and this reddens instead
  // of the derivation going silently blind on that edge again.
  const TYPE_REGISTRY = 'packages/spec/src/kernel/metadata-plugin.zod.ts';
  const FORM_REGISTRY = 'packages/spec/src/system/metadata-form-registry.ts';
  const i18nGateHints = readHints('scripts/check-i18n-bundles.mjs');
  t('the i18n gate declares the type-level metadata registry module', covers(i18nGateHints, TYPE_REGISTRY));
  t('the i18n gate declares the form registry module too (not just its *.form.ts leaves)', covers(i18nGateHints, FORM_REGISTRY));
  const typeRegistryVerdict = classifyEntry({ files: ['scripts/check-i18n-bundles.mjs'], hints: i18nGateHints }, [TYPE_REGISTRY]);
  const formRegistryVerdict = classifyEntry({ files: ['scripts/check-i18n-bundles.mjs'], hints: i18nGateHints }, [FORM_REGISTRY]);
  t(
    'so a card editing the type registry is MATCHED through that constant, not dropped as silent',
    typeRegistryVerdict.verdict === 'matched' && typeRegistryVerdict.hits[0]?.hint === TYPE_REGISTRY,
  );
  t(
    'and a card editing the form registry module is MATCHED through its own constant',
    formRegistryVerdict.verdict === 'matched' && formRegistryVerdict.hits[0]?.hint === FORM_REGISTRY,
  );
  // Both declared paths are real files, so the four claims above are live
  // rather than a pair of matching strings.
  t('the declared type registry module exists', existsSync(join(ROOT, TYPE_REGISTRY)));
  t('the declared form registry module exists', existsSync(join(ROOT, FORM_REGISTRY)));

  // ── A family's OWN script files as match keys (#8509) ─────────────────────
  //
  // Both directions are the product, and both are pinned: a card editing a
  // gate's script must derive that gate, and a card that touches nothing of the
  // gate's must gain nothing from the new key. The over-match direction is the
  // expensive one here — this key is added to EVERY discovered family at once,
  // so a key that covered too much would fabricate leads across the whole farm
  // rather than in one gate.
  const identityEntry = { files: ['scripts/check-empty-changeset.mjs'], hints: [] };
  t(
    'a gate script derives its own family, with the file path itself as provenance',
    coveringKey(identityEntry, 'scripts/check-empty-changeset.mjs')?.key === 'scripts/check-empty-changeset.mjs',
  );
  t('an unrelated path gains nothing from the identity key', coveringKey(identityEntry, 'packages/rest/src/server.ts') === null);
  t('another gate script does not match through this one identity', coveringKey(identityEntry, 'scripts/check-adr-0087-registration.mjs') === null);
  t('a family that resolves to no file at all matches nothing by identity', coveringKey({ files: [], hints: [] }, 'scripts/check-empty-changeset.mjs') === null);
  // Precedence, in both of its directions. One answer per path either way — the
  // question is only which provenance a reader is shown when both keys fire.
  const bothKeys = { files: ['scripts/pm/check-x.mjs'], hints: ['scripts/pm'] };
  t('identity outranks a scanned hint that also covers', coveringKey(bothKeys, 'scripts/pm/check-x.mjs')?.key === 'scripts/pm/check-x.mjs');
  t('a scanned hint still answers a path identity does not cover', coveringKey(bothKeys, 'scripts/pm/other.mjs')?.key === 'scripts/pm');
  // The live thin-gate-file specimen, both directions. This tool's own gate is
  // one file whose single module-body constant is the tool it runs, so the two
  // keys answer DIFFERENT inputs and neither displaces the other. If that gate
  // is renamed or its file moves, re-point these cases rather than deleting
  // them — they are the evidence that the two keys compose.
  const gateEntry = { files: ['scripts/pm/check-dispatch-gates.mjs'], hints: readHints('scripts/pm/check-dispatch-gates.mjs') };
  t('the gate FILE now derives its own family', coveringKey(gateEntry, 'scripts/pm/check-dispatch-gates.mjs')?.key === 'scripts/pm/check-dispatch-gates.mjs');
  t('the TOOL it runs still derives it through the module-body constant', coveringKey(gateEntry, 'scripts/pm/dispatch-gates.mjs')?.key === 'scripts/pm/dispatch-gates.mjs');
  // The card's own specimen, resolved through the REAL root package.json: the
  // gate whose entire job is running that script's self-test names the script
  // there and nowhere in the script's source, which is why the identity key is
  // the only thing that can reach it.
  const liveRootScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  const selfTestGateFiles = resolveCheckToFiles('check:changeset-gate-self-tests', liveRootScripts);
  t('the changeset self-test gate really resolves to the script the card named', selfTestGateFiles.includes('scripts/check-empty-changeset.mjs'));
  t(
    'so a card editing that script now derives that gate end to end',
    coveringKey({ files: selfTestGateFiles, hints: [] }, 'scripts/check-empty-changeset.mjs')?.key === 'scripts/check-empty-changeset.mjs',
  );

  // The bucket the one-line spelling would empty. A family whose source names
  // no path still resolves to a script file, so identity must decide matching
  // WITHOUT being allowed to answer "does this gate's source name a path?".
  const noLiterals = { files: ['scripts/check-silent.mjs'], hints: [] };
  t('a family with no scanned hints stays undetermined for an unrelated card', classifyEntry(noLiterals, ['packages/rest/src/server.ts']).verdict === 'undetermined');
  t('the same family is MATCHED, not undetermined, for a card editing its script', classifyEntry(noLiterals, ['scripts/check-silent.mjs']).verdict === 'matched');
  t('a family whose scanned hints all miss is neither matched nor undetermined', classifyEntry({ files: [], hints: ['packages/spec/src'] }, ['docs/adr/0112-x.md']).verdict === 'silent');
  const identityHits = classifyEntry(noLiterals, ['scripts/check-silent.mjs', 'packages/rest/src/server.ts']).hits;
  t('an identity hit carries the path and the key that covered it, once', identityHits.length === 1 && identityHits[0].path === 'scripts/check-silent.mjs' && identityHits[0].hint === 'scripts/check-silent.mjs');

  // ── CI's own trigger as a match key (#9171) ───────────────────────────────
  //
  // The incident: a workflow declares the paths CI schedules its job on, and
  // nothing here read them. The gates of the whole `Spec property liveness` job
  // read a registry rather than a path, so they carry no watch hint and sat in
  // the `undetermined` bucket for every card — including a card editing
  // `packages/spec/**`, the job's own first trigger. A dev following the
  // dispatch instruction exactly therefore never ran them.
  //
  // The extraction first. `paths` belongs to `pull_request` inside `on:` and
  // nowhere else: the fixtures below put a decoy list under another event and
  // under a job, because a walk that scooped either would widen every family in
  // the file to paths CI never filters on.
  const triggerWf = [
    'name: Fixture',
    'on:',
    '  pull_request:',
    '    types: [opened, synchronize]',
    '    paths:',
    "      - 'packages/spec/**'",
    '      # a comment between entries',
    '      - docs/audits/**',
    '  merge_group:',
    '  schedule:',
    '    - cron: 0 3 * * 1',
    'jobs:',
    '  build:',
    '    paths:',
    '      - never/read/**',
    '',
  ].join('\n');
  const triggerPaths = extractTriggerPaths(triggerWf);
  t('the pull_request paths list is read in declaration order', triggerPaths.join('|') === 'packages/spec/**|docs/audits/**');
  t('a decoy paths list outside the on: mapping is NOT read', !triggerPaths.some((p) => p.includes('never/read')));
  t('a workflow with no paths filter yields an empty list, not a match-nothing list', extractTriggerPaths('on:\n  pull_request:\n    branches: [main]\njobs: {}\n').length === 0);
  t('the flow-sequence spelling is read too', extractTriggerPaths("on:\n  pull_request:\n    paths: ['a/**', \"b/c\"]\n").join('|') === 'a/**|b/c');
  t('pull_request_target is not mistaken for pull_request', extractTriggerPaths("on:\n  pull_request_target:\n    paths:\n      - 'x/**'\n").length === 0);

  // ── The population a job `if:` names one hop away (#12956) ────────────────
  //
  // The card: an `.objectui-sha` diff derived NO pin-critical gate, because
  // ci.yml declares no workflow `paths:` at all — its filtering lives in a
  // `filter` job's dorny/paths-filter step, read by every other job's `if:`.
  // The fixture carries every shape that must be READ and every shape that must
  // be REFUSED, because the refusals are the half that keeps a widening from
  // fabricating leads across a whole workflow at once.
  const jobFilterWf = [
    'name: Fixture',
    'on:',
    '  pull_request:',
    '    branches: [main]',
    'jobs:',
    '  filter:',
    '    runs-on: ubuntu-latest',
    '    outputs:',
    "      console: ${{ steps.changes.outputs.console || 'true' }}",
    // The indirection is real: the job output NAME and the filter name differ.
    "      area: ${{ steps.changes.outputs.core || 'true' }}",
    '    steps:',
    '      - uses: dorny/paths-filter@v4',
    '        id: changes',
    '        with:',
    '          filters: |',
    '            console:',
    "              - '.objectui-sha'",
    '            core:',
    "              - 'packages/**'",
    '              # a comment between entries',
    "              - 'apps/!(docs)/**'",
    '  console-pin:',
    '    name: Console Pin Gate',
    '    needs: filter',
    "    if: ${{ !cancelled() && needs.filter.outputs.console != 'false' }}",
    '    steps:',
    '      - run: pnpm check:console-sha',
    '  both:',
    '    name: Two Areas',
    "    if: ${{ !cancelled() && (needs.filter.outputs.console != 'false' || needs.filter.outputs.area != 'false') }}",
    '    steps:',
    '      - run: pnpm check:two',
    '  always-on:',
    '    name: Always',
    '    steps:',
    '      - run: pnpm check:always',
    '  intersected:',
    '    name: Intersected',
    "    if: ${{ needs.filter.outputs.console != 'false' && needs.filter.outputs.area != 'false' }}",
    '    steps:',
    '      - run: pnpm check:intersected',
    '',
  ].join('\n');

  const fixtureJobs = extractJobBlocks(jobFilterWf);
  t(
    'every job under jobs: is segmented, and nothing above it is',
    fixtureJobs.map((j) => j.id).join('|') === 'filter|console-pin|both|always-on|intersected',
  );
  t(
    "a job's declared name is read, and an unnamed job falls back to its id",
    fixtureJobs.find((j) => j.id === 'console-pin')?.name === 'Console Pin Gate'
      && fixtureJobs.find((j) => j.id === 'filter')?.name === 'filter',
  );
  t(
    'a job block keeps its own steps and NOT the next job\'s',
    fixtureJobs.find((j) => j.id === 'console-pin')?.text.includes('check:console-sha')
      && !fixtureJobs.find((j) => j.id === 'console-pin').text.includes('check:two'),
  );
  const fixtureSteps = extractPathsFilterSteps(jobFilterWf);
  t('the paths-filter step is keyed by the id downstream references use', fixtureSteps.has('changes'));
  t(
    'its filters block scalar is parsed into named glob lists',
    fixtureSteps.get('changes')?.get('console')?.join('|') === '.objectui-sha'
      && fixtureSteps.get('changes')?.get('core')?.join('|') === 'packages/**|apps/!(docs)/**',
  );
  t(
    "the job's outputs: mapping is resolved to the STEP output each value reads, not assumed to share its name",
    (() => {
      const src = extractJobOutputSources(fixtureJobs.find((j) => j.id === 'filter').text);
      return src.get('console')?.output === 'console' && src.get('area')?.output === 'core'
        && src.get('area')?.step === 'changes';
    })(),
  );

  // The `if:` whitelist, in both directions. Everything the live tree spells is
  // read; everything else is refused rather than approximated.
  t(
    "the live spelling reads: !cancelled() is stripped and != 'false' is the run condition",
    jobFilterOutputRefs("${{ !cancelled() && needs.filter.outputs.console != 'false' }}")
      ?.map((r) => `${r.job}.${r.output}`).join('|') === 'filter.console',
  );
  t(
    'an OR of two outputs reads as BOTH, in declaration order',
    jobFilterOutputRefs("${{ !cancelled() && (needs.filter.outputs.core != 'false' || needs.filter.outputs.crosspkg != 'false') }}")
      ?.map((r) => r.output).join('|') === 'core|crosspkg',
  );
  t("the == 'true' spelling of the same condition reads too", jobFilterOutputRefs("${{ needs.filter.outputs.core == 'true' }}")?.length === 1);
  t('an AND of two filter outputs is REFUSED — that is an intersection this does not compute', jobFilterOutputRefs("${{ needs.f.outputs.a != 'false' && needs.f.outputs.b != 'false' }}") === null);
  t('an INVERTED comparison is refused, not read as its opposite', jobFilterOutputRefs("${{ needs.f.outputs.a == 'false' }}") === null);
  t('a term this cannot read refuses the WHOLE expression', jobFilterOutputRefs("${{ github.event_name == 'push' || needs.f.outputs.a != 'false' }}") === null);
  t('an if: naming no filter output at all yields no population', jobFilterOutputRefs("${{ github.ref == 'refs/heads/main' }}") === null);
  t('an absent if: is not an expression', jobFilterOutputRefs(null) === null);

  const fixturePops = jobPathPopulations(jobFilterWf, 'fixture.yml');
  t(
    'only the jobs whose if: RESOLVED and that invoke a check family contribute a population',
    fixturePops.map((p) => p.job).join('|') === 'console-pin|both',
  );
  t(
    'the console job resolves to the globs its filter declares, and names the check it runs',
    fixturePops[0].paths.join('|') === '.objectui-sha' && fixturePops[0].checks.join('|') === 'check:console-sha',
  );
  t(
    'a two-output if: takes the UNION of both filters',
    fixturePops[1].paths.join('|') === '.objectui-sha|packages/**',
  );
  t(
    'the extglob entry is DROPPED and COUNTED, never translated with a language that lacks it',
    fixturePops[1].dropped === 1 && !fixturePops[1].paths.some((p) => p.includes('!(')),
  );
  t(
    'a job CI schedules unconditionally contributes nothing — it discriminates no path',
    !fixturePops.some((p) => p.job === 'always-on'),
  );
  t(
    'and the AND-joined job contributes nothing rather than an over-claimed union',
    !fixturePops.some((p) => p.job === 'intersected'),
  );
  t(
    'an extglob NEGATION refuses the whole population — dropping it would WIDEN what is claimed',
    jobFilterPopulation(
      { if: "${{ needs.f.outputs.a != 'false' }}" },
      new Map([['f.a', ['packages/**', '!(vendor)/**']]]),
    ) === null,
  );
  t(
    'a workflow with no paths-filter step at all yields no job populations',
    jobPathPopulations("on:\n  pull_request:\n    branches: [main]\njobs:\n  a:\n    steps:\n      - run: pnpm check:x\n", 'x.yml').length === 0,
  );

  // Matching, and the precedence question the new key raises. A job filter is a
  // DECLARATION CI obeys, so it outranks a literal scanned out of a script and
  // sits under the workflow trigger, which decides whether the job runs at all.
  const jfEntry = {
    files: [], hints: ['scripts/somewhere'], triggers: [],
    jobFilters: [{ workflow: 'ci.yml', job: 'console-pin', name: 'Console Pin Gate', outputs: ['filter.console'], paths: ['.objectui-sha'], dropped: 0 }],
  };
  t(
    'a job filter matches its path and names the JOB a dev will see go red',
    coveringKey(jfEntry, '.objectui-sha')?.via === "CI job filter for 'Console Pin Gate' in ci.yml",
  );
  t('a path the job filter does not cover gains nothing from it', coveringKey(jfEntry, 'packages/spec/src/x.ts') === null);
  t(
    'the workflow trigger still outranks the job filter where both fire',
    coveringKey({ ...jfEntry, triggers: [{ workflow: 'ci.yml', paths: ['.objectui-sha'] }] }, '.objectui-sha')?.via
      === 'CI trigger in ci.yml',
  );
  t(
    'and the job filter outranks a scanned hint that also covers',
    coveringKey({ ...jfEntry, hints: ['.objectui-sha'] }, '.objectui-sha')?.via
      === "CI job filter for 'Console Pin Gate' in ci.yml",
  );
  t(
    'a family with no job filters is unchanged by the new key',
    coveringKey({ files: [], hints: ['scripts/somewhere'], triggers: [] }, 'scripts/somewhere/x.mjs')?.via === 'gate source',
  );

  // ── LIVE: the card's acceptance criterion, pinned against the real ci.yml ──
  //
  // Pinned rather than left to the fixture, because the whole finding was that
  // the FIXTURE-shaped question ("can it follow an indirection?") had a
  // different answer from the LIVE one. If the console job is renamed or its
  // filter re-spelled, re-point these cases — do not delete them: they are the
  // measured statement that a pin bump derives its own gates.
  const liveCiPops = jobPathPopulations(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'), 'ci.yml');
  const livePinJob = liveCiPops.find((p) => p.checks.includes('check:console-sha'));
  t('the live console job is found by the gate it runs', Boolean(livePinJob));
  t('and it is named Console Pin Gate — the name branch protection and the Checks tab use', livePinJob?.name === 'Console Pin Gate');
  t(
    'its derived population covers the pin file, which is the whole acceptance criterion',
    Boolean(livePinJob && triggerListCovers(livePinJob.paths, '.objectui-sha')),
  );
  t(
    'both console gates are reached, not just the one the card named',
    Boolean(livePinJob?.checks.includes('check:console-sha') && livePinJob?.checks.includes('check:console-injection')),
  );
  // The NEGATIVE control, and it is the half that keeps the widening honest: a
  // path in none of the four filters must derive nothing extra. AGENTS.md is a
  // repo-root file no filter names.
  t(
    'a path none of the live filters covers matches NO job filter — the widening is not a blanket',
    !liveCiPops.some((p) => triggerListCovers(p.paths, 'AGENTS.md')),
  );
  t(
    'and the same sweep DOES cover a packages/ path, so that zero is a reading rather than a broken instrument',
    liveCiPops.some((p) => triggerListCovers(p.paths, 'packages/spec/src/index.ts')),
  );

  // The pattern language. `*` must not cross a slash and `**` must, or a
  // trigger reads as narrower or wider than the one CI obeys.
  t('a double-star trigger covers a file any depth below it', triggerCovers('packages/spec/**', 'packages/spec/src/data/filter.zod.ts'));
  t('a single star does NOT cross a path separator', !triggerCovers('packages/*', 'packages/spec/src/index.ts'));
  t('the same single star still covers a direct child', triggerCovers('packages/*', 'packages/spec'));
  t('a leading double-star reaches a nested file', triggerCovers('**/package.json', 'packages/spec/package.json'));
  t('an exact-file trigger covers exactly that file', triggerCovers('pnpm-workspace.yaml', 'pnpm-workspace.yaml'));
  t('an unrelated path is not covered', !triggerCovers('packages/spec/**', 'packages/rest/src/server.ts'));
  t('a dot in a trigger is a literal dot, not a wildcard', !triggerCovers('pnpm-lock.yaml', 'pnpm-lockXyaml'));
  // The directory-surface reach and the reach deliberately refused — a card's
  // file surface is often given as a directory, but a pattern whose literal
  // prefix is empty could sit under ANY directory and must not claim one.
  t('a directory surface derives a trigger that reaches into it', triggerCovers('packages/spec/**', 'packages/spec'));
  t('a leading-wildcard trigger does NOT claim an arbitrary directory surface', !triggerCovers('**/package.json', 'packages/spec'));
  t('nor a sibling directory sharing a name prefix', !triggerCovers('packages/spec/**', 'packages/spec-extra'));

  // Ordered negation, both directions — CI evaluates the list in order and so
  // must this, or an excluded path derives a job that will never run on it.
  t('a plain list answers with the pattern that covered', triggerListCovers(['docs/**', 'packages/spec/**'], 'packages/spec/x.ts') === 'packages/spec/**');
  t('a later negation excludes what an earlier pattern included', triggerListCovers(['packages/**', '!packages/spec/**'], 'packages/spec/x.ts') === null);
  t('a later positive re-includes it', triggerListCovers(['packages/**', '!packages/spec/**', 'packages/spec/src/**'], 'packages/spec/src/x.ts') === 'packages/spec/src/**');
  t('a list of negations alone covers nothing', triggerListCovers(['!packages/**'], 'packages/spec/x.ts') === null);
  t('an empty list covers nothing — no filter is not a filter that matches all', triggerListCovers([], 'packages/spec/x.ts') === null);

  // Precedence and the bucket. A trigger match must outrank a scanned literal
  // (a declaration beats an inference) and must never be allowed to answer the
  // bucket's question, which is about the gate's SOURCE.
  const triggered = { files: [], hints: [], triggers: [{ workflow: 'spec-liveness-check.yml', paths: ['packages/spec/**'] }] };
  t('a family with no hints at all is MATCHED when CI schedules it', classifyEntry(triggered, ['packages/spec/src/x.ts']).verdict === 'matched');
  // Read defensively: a regression here produces NO hit, and an assertion that
  // indexed straight into `hits[0]` would throw and abort the whole self-test
  // run — every case below it, the live liveness pins included, would then stop
  // reporting. A gate that fails must still say what else it checked.
  t('and its provenance says the claim came from CI, not from a string in a script', Boolean(classifyEntry(triggered, ['packages/spec/src/x.ts']).hits[0]?.via?.includes('spec-liveness-check.yml')));
  t('the same family is still undetermined for a card the workflow does not schedule', classifyEntry(triggered, ['packages/rest/src/server.ts']).verdict === 'undetermined');
  const allThreeKeys = {
    files: ['scripts/check-x.mjs'],
    hints: ['packages/spec/src'],
    triggers: [{ workflow: 'w.yml', paths: ['packages/spec/**'] }],
  };
  t('identity still outranks CI trigger', coveringKey(allThreeKeys, 'scripts/check-x.mjs')?.via === 'gate script');
  t('CI trigger outranks a scanned literal that also covers', coveringKey(allThreeKeys, 'packages/spec/src/x.ts')?.via === 'CI trigger in w.yml');
  t('a scanned literal still answers where no trigger covers', coveringKey({ hints: ['packages/rest/src'], triggers: [{ workflow: 'w.yml', paths: ['packages/spec/**'] }] }, 'packages/rest/src/x.ts')?.via === 'gate source');
  t('an entry with no triggers at all behaves exactly as before', coveringKey({ files: [], hints: ['packages/spec/src'] }, 'packages/spec/src/x.ts')?.via === 'gate source');

  // The card's own specimen, end to end against the LIVE workflow: the trigger
  // is read off the file rather than inferred from the one hit that surfaced
  // this (a `packages/objectql/**` path, which is NOT in the list at all — the
  // job ran because that PR also touched a path that is). If this workflow is
  // renamed or its gates move, re-point these cases; do not delete them.
  const livenessWf = readFileSync(join(ROOT, '.github/workflows/spec-liveness-check.yml'), 'utf8');
  const livenessTriggers = extractTriggerPaths(livenessWf);
  t('the liveness workflow really declares a path filter', livenessTriggers.length > 0);
  const livenessFamilies = extractCheckInvocations(livenessWf, 'spec-liveness-check.yml').map((i) => i.check);
  t('check:liveness really is one of that workflow\'s families', livenessFamilies.includes('check:liveness'));
  const livenessEntry = { files: [], hints: [], triggers: [{ workflow: 'spec-liveness-check.yml', paths: livenessTriggers }] };
  t('so a card editing the spec now derives it', classifyEntry(livenessEntry, ['packages/spec/src/data/filter.zod.ts']).verdict === 'matched');
  t('a dogfood proof edit derives it too — the ADR-0054 half of the same job', classifyEntry(livenessEntry, ['packages/qa/dogfood/src/some.test.ts']).verdict === 'matched');
  t('and a hand-written doc page, which is why the trigger is read and not guessed at packages/spec', classifyEntry(livenessEntry, ['content/docs/reference/apps.mdx']).verdict === 'matched');
  t('while an unrelated package still derives nothing from it', classifyEntry(livenessEntry, ['packages/rest/src/server.ts']).verdict === 'undetermined');

  // The table's own rot detector: a name no live run discovers must say so,
  // never disappear quietly.
  const stale = changeKindLines(['a.test.ts'], () => null);
  // Seven, not six, since #10542 added check:cross-package-test-inputs to the
  // test-file kind. `a.test.ts` is a root-level TypeScript file, so it is BOTH
  // a test file and inside the root tsc program and legitimately hits two
  // kinds. The ratchet therefore renders twice, under a different `why` each
  // time — pinned just below, because a bare count cannot tell that apart from
  // one kind rotting away.
  t('an undiscoverable gate renders as STALE', stale.filter((l) => l.includes('STALE')).length === 7);
  t('a root-level test file hits both kinds, so the ratchet renders STALE under each', stale.filter((l) => l.includes('\u26a0 check:type-check-debt: STALE')).length === 2);
  // Per NAME, anchored on both sides of the rendered name (`⚠ x: STALE`), so the
  // pair that shares one script is reported apart: a count alone stays green if
  // one of the two is dropped from the table and something else is added, and a
  // leading substring stays green through a `-v2` rename — the two ways this
  // table has actually rotted.
  t('the coverage half renders STALE under its own name', stale.some((l) => l.includes('⚠ check:type-check-coverage: STALE')));
  t(
    'and so does the cross-package-inputs entry, anchored on both sides of its own name',
    stale.some((l) => l.includes('⚠ check:cross-package-test-inputs: STALE')),
  );
  t('the ratchet half renders STALE under its own name', stale.some((l) => l.includes('⚠ check:type-check-debt: STALE')));
  t('the engine-double ratchet renders STALE under its own name', stale.some((l) => l.includes('⚠ check:engine-double-contract: STALE')));
  t('the where-matcher ratchet renders STALE under its own name', stale.some((l) => l.includes('⚠ check:where-matcher: STALE')));
  const i18nStale = changeKindLines(['packages/services/service-messaging/scripts/i18n-extract.config.ts'], () => null);
  t('an undiscoverable check:i18n renders as STALE', i18nStale.filter((l) => l.includes('⚠ check:i18n: STALE')).length === 1);
  t('every declared convention gate carries a reason', CHANGE_KIND_GATES.every((k) => k.gates.every((g) => g.name && g.why)));

  // ── The census guard (#8632) ──────────────────────────────────────────────
  //
  // CHANGE_KIND_GATES is the one enumerable list in this file, so it is the one
  // list a guard can hold. The STALE branch reports a rotted name to whoever
  // reads the output; this case makes the same rot fail CI, against the REAL
  // workflow tree rather than a fixture. Discovery is repeated here rather than
  // borrowed from `derive`, which prints instead of returning — the assertion is
  // "every name in the table is a family the workflows really run", and it needs
  // the live population to mean anything.
  const liveFamilies = new Set();
  for (const wf of readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f))) {
    for (const i of extractCheckInvocations(readFileSync(join(ROOT, '.github/workflows', wf), 'utf8'), wf)) {
      liveFamilies.add(i.check);
    }
  }
  t('the live workflows discover a farm at all (the guard is not vacuous)', liveFamilies.size > 20);
  const declared = CHANGE_KIND_GATES.flatMap((k) => k.gates.map((g) => g.name));
  const missing = declared.filter((n) => !liveFamilies.has(n));
  t(`every convention gate named in the table is a live family (missing: ${missing.join(', ') || 'none'})`, missing.length === 0);
  // The two gates this card moved out of the closing prose, pinned individually
  // — a count alone stays green if one is dropped and another added.
  t('check:engine-double-contract is a live family, so naming it in the table is not a guess', liveFamilies.has('check:engine-double-contract'));
  t('check:where-matcher is a live family too — the gate the prose never named', liveFamilies.has('check:where-matcher'));
  t(
    'check:cross-package-test-inputs is a live family (#10542 moved it here from a path derivation that could name it at 49.6% precision at best)',
    liveFamilies.has('check:cross-package-test-inputs'),
  );
  // #12850's entry, pinned here for the same reason and with one of its own:
  // this is the only gate in the table reached by a CONTENT predicate, so the
  // census guard above is the only thing standing between a rename and a lead
  // that renders STALE on a card nobody re-reads.
  t('check:dispatcher-error-vocabulary is a live family, so naming it is not a guess',
    liveFamilies.has('check:dispatcher-error-vocabulary'));

  // ── The test-file entry's deletion criterion, MEASURED (#11199) ───────────
  //
  // The card behind these cases reported that no local derivation ever named
  // `check:cross-package-test-inputs` for an edited test file. That is closed —
  // the entry above has been in the table since #10542 — and the reason these
  // cases exist rather than a seventh entry is what the re-measurement found:
  // the entry now READS redundant against its own stated deletion criterion,
  // and it is not. The full measurement is in that criterion's bullet in this
  // table's docblock; what is pinned here is every load-bearing half of it, so
  // the claim reddens instead of ageing.
  //
  // Both directions matter. The positive case keeps the redundancy honest (the
  // hint route really does reach an ordinary packages test file — Zone rule:
  // two routes to one gate is redundancy, never a bug, and neither may be
  // deleted BECAUSE of the other). The negative cases are the residue: a class
  // the hint route cannot reach in principle, with live tracked specimens.
  const XPKG = 'check:cross-package-test-inputs';
  const xpkgEntry = discoverFamilies().byCheck.get(XPKG);
  // Live specimens, one per residue reason. If either file is ever deleted or
  // renamed, re-point the case at another member of its class — and if a class
  // ever EMPTIES, that is the measurement to redo, not a case to drop.
  const OUTSIDE_PACKAGES = 'examples/app-crm/test/smoke.test.ts';   // not under packages/**
  const TSX_TEST = 'packages/client-react/src/realtime-hooks.test.tsx'; // not *.ts
  const APPS_TEST = 'apps/docs/src/x.test.ts';                      // no tracked member today
  t('the gate is discovered with hints at all, so these cases are not vacuous', (xpkgEntry?.hints ?? []).length > 0);
  t('both residue specimens are real tracked files, so the negatives are live rather than a pair of matching strings',
    existsSync(join(ROOT, OUTSIDE_PACKAGES)) && existsSync(join(ROOT, TSX_TEST)));
  t('the hint route really does reach an ordinary packages test file — the redundancy #12300 recovered is real',
    covers(xpkgEntry.hints, 'packages/spec/src/x.test.ts'));
  t('but no hint of this gate reaches a test file outside packages/**', !covers(xpkgEntry.hints, OUTSIDE_PACKAGES));
  t('nor a .tsx test file inside it', !covers(xpkgEntry.hints, TSX_TEST));
  t('nor one under apps/**, the class with no tracked member to lose', !covers(xpkgEntry.hints, APPS_TEST));
  // The entry itself, anchored on both sides of the rendered name the way the
  // STALE cases above are: a bare substring test stays green if some other
  // gate's `why` ever quotes this gate's name.
  t('the KIND names the gate for every one of them — delete the entry and this reddens',
    [OUTSIDE_PACKAGES, TSX_TEST, APPS_TEST].every((p) =>
      changeKindLines([p], (n) => n).some((l) => l.includes(`- ${XPKG}   —`))));
  // The fragility half: the covering hint is INHERITED from the declaration
  // table this gate imports (one package's declared turbo `inputs` glob), not
  // declared by the gate as its own population. `hintOrigin` carries exactly
  // that provenance, and it is what the output prints as `gate source via …`.
  const xpkgCovering = xpkgEntry.hints.find((h) => hintCovers(h, 'packages/spec/src/x.test.ts'));
  t('and that covering hint is inherited from a module the gate imports, not a population the gate declares',
    Boolean(xpkgEntry.hintOrigin?.get(xpkgCovering)));
  // The class-level claim, against the real corpus rather than two specimens:
  // while ANY tracked test file is unreachable by every hint this gate has, the
  // entry's deletion criterion is unmet. The day this reddens, re-measure the
  // criterion and either retire the entry with these cases or re-point them.
  const xpkgResidue = trackedFiles().filter((f) => isTestFilePath(f) && !covers(xpkgEntry.hints, f));
  t(`the tree still holds test files no hint of this gate reaches (${xpkgResidue.length}), so the entry is not redundant`,
    xpkgResidue.length > 0);

  // ── The test-file entry's hint-set prose, re-derived (#13232) ─────────────
  //
  // This entry's docblock used to TRANSCRIBE the three ratchets' hint sets and
  // conclude from the copy that all three score `silent`. Both halves went
  // false without anything editing this file — one ratchet grew a real
  // population literal (#13231), and the git ref two of the rows named stopped
  // being admitted as a hint at all — so the transcription is gone and what it
  // asserted is re-derived here instead. A red in this block means the prose
  // above is due a re-reading, not that the derivation broke.
  const WM = 'check:where-matcher';
  const QOE = 'check:query-options-erasure';
  const EDC = 'check:engine-double-contract';
  const ratchetEntries = new Map([WM, QOE, EDC].map((c) => [c, discoverFamilies().byCheck.get(c)]));
  t('all three ratchets are still discovered with hints, so nothing below is vacuous',
    [...ratchetEntries.values()].every((e) => (e?.hints ?? []).length > 0));
  // The half that survived: two of the three still name only artifacts, so
  // `silent` for every card in the tree is still the right description of them.
  const ORDINARY_TEST = 'packages/spec/src/x.test.ts';
  t(`${QOE} still names nothing that can cover a card's test file — the surviving half of the old paragraph`,
    !covers(ratchetEntries.get(QOE).hints, ORDINARY_TEST) && !covers(ratchetEntries.get(QOE).hints, OUTSIDE_PACKAGES));
  t(`…and so does ${EDC}`,
    !covers(ratchetEntries.get(EDC).hints, ORDINARY_TEST) && !covers(ratchetEntries.get(EDC).hints, OUTSIDE_PACKAGES));
  // The half that broke, pinned in the direction that broke it: the moment this
  // reddens, `check:where-matcher` is silent again and the ⚠ paragraph is wrong.
  t(`${WM} IS reached by the ordinary path derivation for a packages test file — the exception the prose states`,
    covers(ratchetEntries.get(WM).hints, ORDINARY_TEST));
  t('…and that covering hint is the gate\'s OWN declared population, not one inherited from a module it imports',
    !ratchetEntries.get(WM).hintOrigin?.get(ratchetEntries.get(WM).hints.find((h) => hintCovers(h, ORDINARY_TEST))));
  // Why it stays in the table regardless — the same two-direction argument the
  // #11199 block above makes for check:cross-package-test-inputs.
  t(`but no hint of ${WM} reaches a test file outside its scan root, while the KIND does`,
    !covers(ratchetEntries.get(WM).hints, OUTSIDE_PACKAGES)
      && changeKindLines([OUTSIDE_PACKAGES], (n) => n).some((l) => l.includes(`- ${WM}   —`)));
  const wmResidue = trackedFiles().filter((f) => isTestFilePath(f) && !covers(ratchetEntries.get(WM).hints, f));
  t(`the tree still holds test files no hint of ${WM} reaches (${wmResidue.length}), so its line is not redundant either`,
    wmResidue.length > 0);
  // The drift the deleted transcription could not report, closed at the source
  // rather than by re-copying: both sources still SPELL the ref, and neither
  // yields it as a hint. This is the case that reddens if the refusal is ever
  // relaxed and a row naming `origin/main` becomes writable again.
  const REF = ['origin', 'main'].join('/');
  const refSpellers = [ratchetEntries.get(QOE), ratchetEntries.get(WM)]
    .flatMap((e) => e.files ?? [])
    .filter((f) => existsSync(join(ROOT, f)) && readFileSync(join(ROOT, f), 'utf8').includes(`'${REF}'`));
  t(`both ratchet sources still spell ${REF} (${refSpellers.length}), so the next case is about the extractor and not a missing literal`,
    refSpellers.length === 2);
  t(`…and not one of them yields it as a hint, which is why no row here may name it`,
    refSpellers.every((f) => !extractWatchHints(readFileSync(join(ROOT, f), 'utf8'), f).includes(REF)));

  // ── The check-family coverage guard (#9187) ───────────────────────────────
  //
  // `docs-drift-check.yml` declared a `paths:` filter and ran a real self-test
  // (`node scripts/docs-audit/affected-docs.mjs --self-test`) that discovery
  // could never see, because the naming convention every OTHER family follows
  // — `check:NAME` or `check-NAME.mjs` — is enforced nowhere: the tree just
  // happened to comply 103 times running up to this card. This section rules
  // it normative: a paths-filtered workflow with no discovered family is now
  // a CI failure, not a lead nobody could see. Fixture cases pin the shape;
  // the live case at the end pins it against the real tree, the same pairing
  // the census guard above uses.
  //
  // #11404 RE-BASED THE FIXTURE, and the reason is the card itself. This
  // section's original invisible-step fixture was verbatim the shape #9187
  // measured — `node scripts/some-mapper.mjs --self-test` — and the third
  // matcher in extractCheckInvocations now DISCOVERS that shape, so the
  // fixture stopped being an example of the thing it illustrates. The
  // invisible step here is now a `node scripts/…` command that is neither a
  // `check-` basename nor a self-test, which is what genuinely has no family
  // today; the retired shape is pinned as discovered two cases below, so the
  // pair records the move rather than losing it.
  const noFamilyWf = [
    'name: X',
    'on:',
    '  pull_request:',
    '    paths:',
    "      - 'packages/**'",
    'jobs:',
    '  j:',
    '    steps:',
    '      - name: Run the mapper',
    '        run: node scripts/some-mapper.mjs --emit',
  ].join('\n');
  t(
    'a paths-filtered workflow discovering no check family is a coverage gap',
    checkFamilyCoverageGaps([{ file: 'x.yml', text: noFamilyWf }]).includes('x.yml'),
  );
  const familyWf = noFamilyWf.replace(
    'node scripts/some-mapper.mjs --emit',
    'pnpm check:some-mapper',
  );
  t(
    'a paths-filtered workflow that DOES discover a family is not a gap',
    checkFamilyCoverageGaps([{ file: 'x.yml', text: familyWf }]).length === 0,
  );
  // The retired fixture, kept as the pin for what #11404 changed: the exact
  // step #9187 recorded as undiscoverable is a family now, so the same
  // workflow is no longer a coverage gap.
  const selfTestFamilyWf = noFamilyWf.replace(
    'node scripts/some-mapper.mjs --emit',
    'node scripts/some-mapper.mjs --self-test',
  );
  t(
    "the step #9187 measured as invisible is discovered now, so its workflow is no longer a gap",
    checkFamilyCoverageGaps([{ file: 'x.yml', text: selfTestFamilyWf }]).length === 0,
  );
  const unfilteredNoFamilyWf = [
    'name: X',
    'on:',
    '  pull_request: {}',
    'jobs:',
    '  j:',
    '    steps:',
    '      - name: Run the mapper',
    '        run: node scripts/some-mapper.mjs --emit',
  ].join('\n');
  t(
    'an UNFILTERED workflow with no family is not a gap — it runs on every PR regardless, the residue bucket already accounts for it',
    checkFamilyCoverageGaps([{ file: 'x.yml', text: unfilteredNoFamilyWf }]).length === 0,
  );
  t(
    'the declared opt-out reads its reason back',
    declaredNoCheckFamiliesReason('# dispatch-gates: no-check-families -- e2e build, no named verification (#9187)\n')
      === 'e2e build, no named verification (#9187)',
  );
  t('no marker present reads as no declared reason', declaredNoCheckFamiliesReason('# just a comment\n') === null);
  t('the marker with no reason text does not count as declared', declaredNoCheckFamiliesReason('# dispatch-gates: no-check-families\n') === null);
  const exemptedWf = noFamilyWf.replace(
    'jobs:',
    '# dispatch-gates: no-check-families -- fixture, not a real verification step\njobs:',
  );
  t(
    "a paths-filtered, zero-family workflow carrying the marker is NOT a gap — the declared opt-out this card's route requires",
    checkFamilyCoverageGaps([{ file: 'x.yml', text: exemptedWf }]).length === 0,
  );

  // ── The gate-level no-population declaration (#10542) ─────────────────────
  //
  // The workflow-level marker above says "this workflow names no gate"; this
  // one says "this gate names no path, and here is why". Both directions are
  // pinned, and so is the live tree, because the whole value of the second is
  // that it separates families that have been READ from families nobody has
  // looked at — and a marker that quietly stopped parsing would merge them back
  // together while every count still printed.
  t(
    'a gate-level no-population declaration reads its reason back',
    declaredNoPathPopulation('// dispatch-gates: no-path-population -- CI runs the self-test only\n')
      === 'CI runs the self-test only',
  );
  t(
    'the shell comment spelling is read too (shell gates carry # comments, and the derivation discovers them)',
    declaredNoPathPopulation('#!/usr/bin/env bash\n# dispatch-gates: no-path-population -- a shell gate reason\n')
      === 'a shell gate reason',
  );
  t('no marker present reads as no declared no-population', declaredNoPathPopulation('// just a comment\n') === null);
  t(
    'the marker with no reason text does not count as declared (an opt-out with no reason reads exactly like a placeholder nobody will revisit)',
    declaredNoPathPopulation('// dispatch-gates: no-path-population\n') === null,
  );
  t(
    'the marker must be its OWN line — a mention inside prose is a discussion of the convention, not a declaration under it',
    declaredNoPathPopulation('// see the dispatch-gates: no-path-population -- marker for how to opt out\n') === null,
  );

  // ── The followed-module inherited-population declaration (#11556) ─────────
  //
  // The two markers above are a GATE's declarations about itself. This one is a
  // followed MODULE's declaration about what a gate inherits by importing it —
  // the half that had no mechanism at all, only prose in the one caller that
  // remembered to spawn instead of import.
  const inhFixture = [
    "const WF = '.github/workflows';",
    "const BASE = 'packages/plugins';",
    '// dispatch-gates: inherited-population .github/workflows -- the only tree this module opens',
  ].join('\n');
  t(
    'a followed module declares the population a caller inherits, and the reason reads back',
    (() => {
      const d = declaredInheritedPopulation(inhFixture);
      return d.population.length === 1
        && d.population[0] === '.github/workflows'
        && d.reason === 'the only tree this module opens';
    })(),
  );
  t(
    'and the literal it did NOT declare stops being inheritable, while still being a literal it spells',
    extractWatchHints(inhFixture).includes('packages/plugins')
      && !declaredInheritedPopulation(inhFixture).population.includes('packages/plugins'),
  );
  t(
    'the shell comment spelling is read too (a followed module can be a shell helper)',
    declaredInheritedPopulation("X='.github/workflows'\n# dispatch-gates: inherited-population .github/workflows -- shell reason\n")
      ?.reason === 'shell reason',
  );
  t(
    'several paths may be declared, space separated',
    (() => {
      const src = ["const A = '.github/workflows';", "const B = 'packages/spec/src/**';",
        '// dispatch-gates: inherited-population .github/workflows packages/spec/src/** -- two real reads'].join('\n');
      return declaredInheritedPopulation(src).population.length === 2;
    })(),
  );
  t('no marker present reads as no declaration — the module contributes everything it spells', declaredInheritedPopulation("const A = '.github/workflows';\n") === null);
  t(
    'a marker carrying only a reason does not parse as a declaration (it reads as no marker, so the module keeps contributing — never a silent blanket opt-out)',
    declaredInheritedPopulation("const A = '.github/workflows';\n// dispatch-gates: inherited-population -- everything here is a join base\n") === null,
  );
  t(
    'the marker must be its OWN line here too — a mention inside prose is a discussion of the convention, not a declaration under it',
    declaredInheritedPopulation("const A = '.github/workflows';\n// see dispatch-gates: inherited-population .github/workflows -- for how a module opts out\n") === null,
  );
  // NARROWING ONLY. This is the load-bearing invariant: an opt-out that could
  // also opt IN would be the hand-written path map this file's contract exists
  // to refuse, and it would be invisible — a declared path nothing spells reads
  // exactly like a real one in the MATCHED column.
  t(
    'a declared path the module does not spell is REFUSED, not silently inherited',
    (() => {
      try {
        declaredInheritedPopulation("const A = '.github/workflows';\n// dispatch-gates: inherited-population packages/spec/src/** -- invented\n");
        return false;
      } catch (e) {
        return /may only NARROW/.test(String(e.message));
      }
    })(),
  );
  t(
    'and the refusal names every invented path, not just the first',
    (() => {
      try {
        declaredInheritedPopulation("const A = '.github/workflows';\n// dispatch-gates: inherited-population packages/a packages/b -- invented\n");
        return false;
      } catch (e) {
        return /packages\/a, packages\/b/.test(String(e.message));
      }
    })(),
  );
  // The `--` separator is SPACE-delimited on purpose: a bare `--` would split a
  // path that legitimately carries one.
  t(
    'a declared path containing a double dash survives the reason separator',
    (() => {
      const src = ["const A = 'packages/a--b/src';", '// dispatch-gates: inherited-population packages/a--b/src -- a real subtree'].join('\n');
      const d = declaredInheritedPopulation(src);
      return d.population.length === 1 && d.population[0] === 'packages/a--b/src' && d.reason === 'a real subtree';
    })(),
  );
  // ── LIVE: this file's own declaration ─────────────────────────────────────
  //
  // Pinned against the real source, because the whole value of the marker is
  // that it holds for THIS module — the one measured specimen. Delete the
  // marker line and these cases redden instead of 2632 fabricated pairs coming
  // back silently for the next gate that imports the tool.
  const ownToolSource = readFileSync(join(ROOT, 'scripts/pm/dispatch-gates.mjs'), 'utf8');
  const ownDeclared = declaredInheritedPopulation(ownToolSource);
  // Read through `?.` on purpose: deleting the marker line must render as a
  // NAMED failing case, not as a TypeError that aborts the run and takes every
  // case after this one with it — a self-test that crashes reports one defect
  // where the tree may hold several.
  const ownPopulation = ownDeclared?.population ?? [];
  t('this module declares what a follower inherits', (ownDeclared?.reason ?? '').length > 0);
  t(
    'it declares exactly the workflow tree it readdirs',
    ownPopulation.length === 1 && ownPopulation[0] === '.github/workflows',
  );
  t('so a follower still reaches the workflow files this tool really opens', covers(ownPopulation, '.github/workflows/lint.yml'));
  // The four fabricating classes the card measured, each pinned as SPELLED but
  // NOT INHERITED — the two halves have to be asserted together, because the
  // literal disappearing from the file would also pass "not inherited" while
  // silently deleting the tier declaration this table is.
  for (const fabricated of ['packages/plugins', 'packages/drivers', 'packages/services', 'packages/spec/src/**']) {
    t(
      `the module still spells ${fabricated} (join base / tier glob) but no follower inherits it`,
      ownHints.includes(fabricated) && !ownPopulation.includes(fabricated),
    );
  }
  t(
    'and the tier-table file globs are not inheritable either',
    ownPopulation.length > 0
      && !ownPopulation.includes('.claude/agents/os-dev.md')
      && !ownPopulation.includes('skills/objectstack-pm-dispatch/SKILL.md'),
  );
  // Cost of the mechanism on this tree, pinned so it cannot grow unnoticed: the
  // marker is an opt-out, and an opt-out that spreads is how a real population
  // goes quiet. TWO modules in the scripts tree declare one today, and this
  // case NAMES them rather than counting them — a bare count reddens for a
  // third module without saying which ones were already priced, and the price
  // is the whole admission criterion:
  //
  //   scripts/pm/dispatch-gates.mjs         2632 pairs — join bases and tier
  //                                         globs, nothing this tool opens
  //   scripts/cli-build-prerequisite.mjs    216 pairs — 108 files x 2 gates,
  //                                         each charging the card that touched
  //                                         one a full CLI closure build to
  //                                         measure gates it could not move
  //                                         (#12500)
  //
  // A third entry is not forbidden; it is required to arrive with its own
  // measured price, which is what re-pointing this case costs an author.
  const declaringModules = trackedFiles()
    .filter((f) => f.startsWith('scripts/') && /\.(mjs|mts|js|sh)$/.test(f))
    // Read from the MODULE BODY, so the fixture markers above — which live
    // inside this very self-test — are not counted as live declarations.
    .filter((f) => INHERITED_POPULATION_MARKER.test(maskSelfTests(readFileSync(join(ROOT, f), 'utf8'))))
    .sort();
  t(
    `exactly the two priced modules in the scripts tree carry the declaration (${declaringModules.join(' · ') || 'none'})`,
    declaringModules.join(' · ') === 'scripts/cli-build-prerequisite.mjs · scripts/pm/dispatch-gates.mjs',
  );
  // The residue count that carries it refuses a missing or impossible value in
  // the same shape as every other count in that line: a subset that could go
  // absent quietly renders as `undefined` in the one line a reader needs.
  const residueArgs = {
    discovered: 3, matched: 1, undetermined: 1, silent: 1, unfiltered: 0,
    unreachable: 0, swept: 10, artifactRosters: 0, invertedRosters: 0,
  };
  t(
    'the residue REFUSES an omitted documented-no-population count',
    (() => {
      try {
        residueLines({ ...residueArgs });
        return false;
      } catch {
        return true;
      }
    })(),
  );
  t(
    'and refuses one larger than the undetermined bucket it is a subset of',
    (() => {
      try {
        residueLines({ ...residueArgs, documentedNoPopulation: 2 });
        return false;
      } catch {
        return true;
      }
    })(),
  );
  t(
    'and renders the count when it is derivable',
    residueLines({ ...residueArgs, documentedNoPopulation: 1 })
      .some((l) => /1 of those 1 undetermined famil\(ies\) DECLARE/.test(l)),
  );

  // The live half. A marker is a claim about a gate, so it is held against the
  // real derivation: a family that DOES name paths must not be carrying one.
  // Without this the marker rots in the direction that costs — a gate grows a
  // real population, keeps its old declaration, and the residue keeps vouching
  // that its emptiness was examined.
  // ONE tree for the discovery and for the reconstruction below. The extractor
  // judges a single-segment directory literal against the tracked corpus, so a
  // reconstruction that read a different corpus — or none — would report the
  // rule as a mismatch rather than checking it.
  const liveTree = watchHintTree();
  const liveDiscovery = discoverFamilies({ tree: liveTree });
  const declaredEmpty = [...liveDiscovery.byCheck].filter(([, e]) => e.noPopulationReason);
  t(
    `the live tree carries at least one no-population declaration (the guard is not vacuous; found ${declaredEmpty.length})`,
    declaredEmpty.length > 0,
  );
  const contradicted = declaredEmpty.filter(([, e]) => (e.hints ?? []).length > 0).map(([c]) => c);
  t(
    `no family both DECLARES no path population and names paths anyway (contradicted: ${contradicted.join(', ') || 'none'})`,
    contradicted.length === 0,
  );
  t(
    'every live declaration carries a non-empty reason',
    declaredEmpty.every(([, e]) => typeof e.noPopulationReason === 'string' && e.noPopulationReason.length > 0),
  );

  // ── The CI-MEASURED-ONLY shape (#14004) ───────────────────────────────────
  //
  // The two markers above are DECLARATIONS a gate carries. This one is the
  // opposite kind of reading and the difference is the point: nothing is
  // declared anywhere, the classification is a SHAPE read off the gate's own
  // source, so a family added tomorrow classifies itself with nothing here to
  // update. What it buys is that a row whose only possible local outcome is a
  // nonzero exit stops being advertised as a runnable command.
  t('limb 1 reads the payload access in its dotted spelling', payloadEnvDependence('const p = process.env.GITHUB_EVENT_PATH;') === 'GITHUB_EVENT_PATH');
  t('and in the bracketed spelling, and through a local `env` alias — one read, two ways to write it', payloadEnvDependence("const env = process.env;\nconst p = env['GITHUB_EVENT_PATH'];") === 'GITHUB_EVENT_PATH');
  // What a gate SAYS is not what it READS, and the direction of this mistake
  // is the expensive one: a false positive here SUBTRACTS a real command from
  // --commands, silently.
  t('a gate that only MENTIONS the variable in a comment is not classified by its prose', payloadEnvDependence('// this gate does not read process.env.GITHUB_EVENT_PATH\nconst x = 1;\n') === null);
  t('nor is one that only names it in a message string', payloadEnvDependence('throw new Error("could not read GITHUB_EVENT_PATH");') === null);
  t('nor is one whose --self-test body stages it as a fixture (the self-test is not the gate\'s work)', payloadEnvDependence('function selfTest() {\n  process.env.GITHUB_EVENT_PATH = "/tmp/e.json";\n}\n') === null);
  t('an unrelated env read is not a payload dependence', payloadEnvDependence('const x = process.env.OS_LOG_LEVEL;') === null);
  // LIVE, against the real specimen the card was filed on: a fixture-only pin
  // would stay green if the gate were rewritten to read the payload some other
  // way, and the whole classification is about THAT file.
  t(
    'LIVE: the queue guard\'s own source still carries the payload dependence this reads',
    payloadEnvDependence(readFileSync(join(ROOT, 'scripts/pm/check-governed-queue-guard.mjs'), 'utf8')) === 'GITHUB_EVENT_PATH',
  );

  // limb 2, both directions. It selects 43 families on this tree ALONE, so
  // every case below is about the conjunction: limb 1 is what discriminates,
  // limb 2 only ever refuses.
  const ciEntry = (over = {}) => ({
    direct: true,
    files: ['scripts/pm/check-a-payload-gate.mjs'],
    payloadEnv: 'GITHUB_EVENT_PATH',
    ...over,
  });
  t('both limbs together classify a direct, payload-reading family as CI-measured', ciOnlyMeasurement(ciEntry(), {})?.env === 'GITHUB_EVENT_PATH');
  t(
    'limb 2 REFUSES when a root manifest script names the gate\'s file — someone can run it here, so nothing may be subtracted',
    ciOnlyMeasurement(ciEntry(), { 'check:a-payload-gate': 'node scripts/pm/check-a-payload-gate.mjs' }) === null,
  );
  t(
    'and refuses a `check:*` family outright — an npm-script name IS a local invocation, whatever the gate reads',
    ciOnlyMeasurement(ciEntry({ direct: false, files: ['scripts/pm/check-a-payload-gate.mjs'] }), {}) === null,
  );
  t(
    'limb 1 is REQUIRED — without it limb 2 alone would subtract every directly-invoked gate in the repo',
    ciOnlyMeasurement(ciEntry({ payloadEnv: null }), {}) === null,
  );

  // LIVE: the classification against the real derivation, in BOTH directions.
  // The positive alone would pass on a rule that classified everything; the
  // negative alone would pass on a rule that classified nothing.
  const liveCiOnly = [...liveDiscovery.byCheck].filter(([, e]) => e.ciOnly);
  t(
    `LIVE: exactly one family classifies CI-measured, and it is the queue guard (got: ${liveCiOnly.map(([c]) => c).join(', ') || 'none'})`,
    liveCiOnly.length === 1 && liveCiOnly[0][0] === 'scripts/pm/check-governed-queue-guard.mjs',
  );
  t(
    'LIVE: an ordinary local family on the same card is NOT classified — the rule discriminates rather than sweeping',
    liveDiscovery.byCheck.get('check:nul-bytes') && !liveDiscovery.byCheck.get('check:nul-bytes').ciOnly,
  );
  t(
    'LIVE: and neither is a directly-invoked gate that reads no payload (limb 2 is not the classifier)',
    [...liveDiscovery.byCheck].some(([, e]) => e.direct && !e.ciOnly),
  );

  // The renderings, driven off rows of the shape `derive` builds. Each is the
  // half a consumer actually reads, and they must agree.
  {
    const ciRow = { check: 'g', command: 'node scripts/pm/check-a-payload-gate.mjs', workflows: ['w.yml'], via: [], ciOnly: { env: 'GITHUB_EVENT_PATH' } };
    const localRow = { check: 'check:b', command: 'pnpm check:b', workflows: ['lint.yml'], via: [], ciOnly: null };
    t('--commands omits the CI-measured row and keeps the runnable one', commandsFor({ matchedRows: [ciRow, localRow] }).join('|') === 'pnpm check:b');
    // The exclusion follows the COMMAND, not the section it arrived through.
    // Unreachable today — no CI-measured family sits in CHANGE_KIND_GATES —
    // and pinned anyway, because a rule that held in one section and not the
    // other would re-emit the row through the block the published snippet
    // cannot even harvest.
    {
      const kindEcho = [{ kind: 'a kind', gates: [{ name: 'g', why: 'because', command: ciRow.command }] }];
      t(
        'and it stays omitted when a change KIND names the same family, which is the other section it could arrive through',
        commandsFor({ matchedRows: [ciRow, localRow], kindGroups: kindEcho }).join('|') === 'pnpm check:b',
      );
      const kindRecon = familyReconciliation({ matchedRows: [ciRow, localRow], kindGroups: kindEcho });
      t('the reconciliation still CLOSES on that input rather than counting a term the union does not have', kindRecon.total === 1 && kindRecon.convention === 0);
      t(
        'and the rows-versus-commands note names that reason instead of charging it to a repeat',
        familyReconciliationLines(kindRecon).some((l) => l.includes('1 CI-measured only, contributing no runnable command')),
      );
    }
    const recon = familyReconciliation({ matchedRows: [ciRow, localRow] });
    t('the reconciliation total is the RUNNABLE answer — the CI-measured row is outside it', recon.total === 1 && recon.matched === 1);
    t('and the omission is a term it carries rather than a difference the reader has to notice', recon.ciOnly === 1 && recon.ciOnlyRows === 1);
    t(
      'the rendered reconciliation states that term out loud',
      familyReconciliationLines(recon).some((l) => l.includes('CI-MEASURED ONLY') && l.includes('omitted from --commands')),
    );
    // The reading that must not come out as a bare "nothing matched": a card
    // whose ONLY matched family is CI-measured.
    const ciAlone = familyReconciliation({ matchedRows: [ciRow] });
    t(
      'a card whose only match is CI-measured still says so at a total of zero',
      ciAlone.total === 0 && familyReconciliationLines(ciAlone).some((l) => l.includes('CI-MEASURED ONLY')),
    );
  }

  // ── Hints come from the COMMAND's named scripts AND, one level down, from
  //    the first-party modules those scripts import (#11190) ─────────────────
  //
  // Load-bearing, and pinned here because a decision rests on it (#10542).
  // Until #11190 this section asserted the OPPOSITE — "a family's hints are
  // exactly those of the scripts its COMMAND names" — and that was true:
  // `resolveCheckToFiles` reads script paths out of the npm script's COMMAND
  // STRING and `discoverFamilies` scanned exactly those files, so moving a
  // population declaration into a shared enumerator DELETED it from every gate
  // that imports it. That is the blocker #11190 removed, so the assertion is
  // INVERTED here rather than deleted: what a later author must measure is now
  // that imports ARE followed, exactly one level, and never into a module that
  // is itself a gate.
  //
  // ⚠️ The old pin did NOT go red on the change that falsified it, and that is
  // why every case below names its specimen with a COUNT. It took "the first
  // single-file family that imports a sibling" as its specimen; measured on
  // this tree, 80 families answer that description, only 3 of them would have
  // failed it, and the one it picks (`scripts/check-adr-links.mjs`, importing
  // `invoked-as.mjs`, which declares no path literal at all) is not among them.
  // A pin whose specimen is chosen by iteration order can be true of the tree
  // and silent about the rule.
  const liveGateFiles = new Set([...liveDiscovery.byCheck.values()].flatMap((e) => e.files ?? []));
  const liveSource = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  // A followed module's hints AS A FOLLOWER RECEIVES THEM. `discoverFamilies`
  // reads `declaredInheritedPopulation` at this seam (`hintsOfModule`), so a
  // reconstruction that re-scanned the raw literals instead would redden for
  // every family importing a module that narrows — while the case it feeds
  // asserts, in its own name, that a shared enumerator CAN carry a population
  // declaration for its callers. It was raw until #12500 put the second live
  // declaration in the tree, and the two i18n families are what found it.
  const liveModuleHints = (rel) => {
    const source = liveSource(rel);
    const spelled = extractWatchHints(source, rel, { tree: liveTree });
    return declaredInheritedPopulation(source, spelled)?.population ?? spelled;
  };
  const liveTargets = (rel) => firstPartyImportTargets(rel, liveSource(rel));
  // The THIRD followed edge (#13518). Its population comes from the manifest's
  // own `exports` declaration rather than from a module's literals, so the
  // reconstruction reads it the same way `discoverFamilies` does instead of
  // routing it through `liveModuleHints`, which would ask a JSON file for
  // JavaScript literals.
  const liveManifestHints = (rel) => {
    const dir = rel.slice(0, Math.max(0, rel.length - 'package.json'.length - 1));
    if (!dir) return [];
    let exportsMap;
    try {
      exportsMap = JSON.parse(liveSource(rel))?.exports;
    } catch {
      return [];
    }
    if (!exportsMap || typeof exportsMap !== 'object' || Object.keys(exportsMap).length === 0) return [];
    const src = `${dir}/src`;
    return liveTree.prefixes.has(src) && !liveTree.files.has(src) ? [src] : [];
  };

  // The recogniser, on fixture source: one line per refusal, so a widening or
  // a narrowing of the rule fails HERE with its reason named, rather than as a
  // pair count nobody can attribute afterwards.
  const importFixture = [
    "import { isEntrypoint } from './invoked-as.mjs';", // followed
    "export { blank } from './js-comment-mask.mjs';", // export-from is the same edge
    "import './pm/git-history.mjs';", // so is the side-effect form
    "import { readFileSync } from 'node:fs';", // bare: a package, not a repo path
    "import { z } from '@objectstack/spec';", // bare, workspace link: node_modules
    "import pkg from '../package.json';", // first-party, but outside scripts/
    "import { x } from './does-not-exist.mjs';", // a specifier, not a module
    '// import { y } from "./adr-anchors.mjs";', // named in a comment, loaded by nobody
    'function selfTest() {',
    '  const fixture = "import { z } from \'./regen-artifacts.mjs\';";',
    '}',
  ].join('\n');
  t(
    'the follow reads the three static import forms, and refuses bare, out-of-tree, unresolvable, commented and self-test spellings',
    firstPartyImportTargets('scripts/fixture.mjs', importFixture).join(' · ') ===
      'scripts/invoked-as.mjs · scripts/js-comment-mask.mjs · scripts/pm/git-history.mjs',
    firstPartyImportTargets('scripts/fixture.mjs', importFixture).join(' · '),
  );

  // The live halves. Counts in the names: a case that can only be read as
  // "something was found" is the shape the old pin failed in.
  const inheriting = [...liveDiscovery.byCheck].filter(([, e]) => (e.hintOrigin?.size ?? 0) > 0);
  const inheritedHints = inheriting.reduce((n, [, e]) => n + e.hintOrigin.size, 0);
  t(
    `the live tree inherits hints through a FOLLOWED program at all (${inheriting.length} famil(ies), ${inheritedHints} hint(s):` +
      ` ${inheriting.map(([c, e]) => `${c} +${e.hintOrigin.size}`).join(', ') || 'none'})`,
    inheriting.length > 0,
  );

  const offReconstruction = [];
  const deeperOnly = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    const own = [];
    const direct = [];
    const manifests = [];
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      const source = liveSource(f);
      own.push(...extractWatchHints(source, f, { tree: liveTree }));
      for (const mod of firstPartyImportTargets(f, source)) {
        if (liveGateFiles.has(mod) || direct.includes(mod)) continue;
        direct.push(mod);
      }
      // The second followed edge (#13511), reconstructed here for the same
      // reason as the first: the invariant is "own PLUS what the gate reaches",
      // and a reconstruction that models only one edge stops describing the
      // derivation the moment the other one fires.
      for (const ran of spawnedProgramTargets(f, source, (x) => liveTree.files.has(x))) {
        if (liveGateFiles.has(ran) || direct.includes(ran)) continue;
        direct.push(ran);
      }
      // The third followed edge (#13518), reconstructed for the same reason as
      // the other two. It is kept in its OWN list because its population is
      // read from the followed file's `exports` map, not from its literals.
      for (const pkg of packageManifestTargets(f, source, (x) => liveTree.files.has(x))) {
        if (manifests.includes(pkg)) continue;
        manifests.push(pkg);
      }
    }
    // A `--self-test` family follows NO edge at all (#11404, #13511, #13518),
    // so its expectation is its own hints and nothing else. Reconstructed from
    // the same `selfTest` flag `discoverFamilies` reads, never from a list here.
    const expected = new Set(
      entry.selfTest
        ? own
        : [...own, ...direct.flatMap(liveModuleHints), ...manifests.flatMap(liveManifestHints)],
    );
    const actual = new Set(entry.hints ?? []);
    if (expected.size !== actual.size || [...actual].some((h) => !expected.has(h))) offReconstruction.push(check);
    // The depth bound, family by family: a module reached only through another
    // module is not in the followed set. Non-vacuous wherever a followed
    // module imports something the family does not import itself.
    const twoHop = direct.flatMap((m) => liveTargets(m)).filter((m) => !direct.includes(m));
    if (twoHop.length > 0 && (entry.imports ?? []).some((m) => twoHop.includes(m))) deeperOnly.push(check);
  }
  t(
    "a family's hints are exactly those of the scripts its COMMAND names PLUS those of the first-party modules" +
      ' those scripts import AND the in-tree programs they run AND the export surface of the packages whose' +
      ' manifest they read — so a shared enumerator CAN carry a population' +
      ` declaration for its callers (off: ${offReconstruction.join(', ') || 'none'})`,
    offReconstruction.length === 0,
  );
  t(
    `and one level only: nothing a followed module imports in turn reaches the family (offenders: ${deeperOnly.join(', ') || 'none'})`,
    deeperOnly.length === 0,
  );
  const twoHopChains = [...new Set([...liveDiscovery.byCheck.values()].flatMap((e) => e.imports ?? []))]
    .map((m) => [m, liveTargets(m)])
    .filter(([, deeper]) => deeper.length > 0);
  t(
    `the depth bound is not vacuous: ${twoHopChains.length} followed module(s) import first-party modules of their own` +
      ` (${twoHopChains.map(([m, d]) => `${m} -> ${d.join(' · ')}`).join(' | ') || 'none'})`,
    twoHopChains.length > 0,
  );

  // The exclusion that decides the NUMBER. Measured on this tree: following
  // gate modules too takes the sweep from +893 (gate, file) pairs to +4907,
  // and 3065 of the extra 4014 are check:examples-live-imports inheriting the
  // repo-wide declaration table of a gate it imports one string helper from.
  // A gate module needs no caller to reach the tree — its own family declares
  // that population — so the follow leaves it to that family.
  const gateModuleEdges = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      for (const mod of liveTargets(f)) {
        if (liveGateFiles.has(mod) && !(entry.files ?? []).includes(mod)) gateModuleEdges.push([check, mod]);
      }
    }
  }
  t(
    `the live tree HAS a gate script importing another gate's file, so the exclusion is not vacuous (${gateModuleEdges.length}:` +
      ` ${gateModuleEdges.map(([c, m]) => `${c} -> ${m}`).join(' · ') || 'none'})`,
    gateModuleEdges.length > 0,
  );
  t(
    'and not one of those edges is followed — a gate module is left to its OWN family, which already declares that population',
    gateModuleEdges.every(([check, mod]) => !(liveDiscovery.byCheck.get(check)?.imports ?? []).includes(mod)),
  );

  // Provenance travels with an inherited hint, for the reason `coveringKey`'s
  // docblock gives for the other two keys: "this gate declares that path" and
  // "a module this gate imports declares it" are different claims, and the
  // column that justifies a lead has to say which.
  // The specimen has to be a hint that DECIDES a lead. An inherited path that
  // the family's own gate script covers answers through the IDENTITY key
  // first, one CI schedules answers through the TRIGGER key, and one a
  // resolvable job `if:` reaches answers through the JOB-FILTER key (#12956) —
  // all correct, all silent about this label — so the specimen is picked from
  // the pairs where none of those can answer. (The third exclusion surfaced
  // when #13312's @-scope refusal thinned the inherited pairs and the find
  // landed on a job-filtered family first.)
  const inheritedLead = inheriting
    .flatMap(([, entry]) => [...entry.hintOrigin].map(([hint, mod]) => [entry, hint, mod]))
    .find(
      ([entry, hint]) =>
        // IMPORT-edge only. The run edge (#13511) renders a label of its own and
        // is pinned in its own section below; letting the find drift onto it
        // would silently turn this case into a test of the other edge.
        entry.hintEdge?.get(hint) !== 'run' &&
        !(entry.files ?? []).some((f) => hintCovers(f, hint)) &&
        !coveringTrigger(entry, hint) &&
        !coveringJobFilter(entry, hint) &&
        coveringKey(entry, hint)?.key === hint,
    );
  t(
    `an inherited hint reaches the matched column as a lead of its own (${inheritedLead ? `${inheritedLead[1]} from ${inheritedLead[2]}` : 'none'})`,
    Boolean(inheritedLead),
  );
  if (inheritedLead) {
    const [entry, hint, mod] = inheritedLead;
    t(
      `…and the via column names the module it came from, not the gate (${coveringKey(entry, hint)?.via})`,
      coveringKey(entry, hint)?.via === `gate source via ${mod}`,
    );
  }

  // ── The PROGRAM a gate opens by path (#13000) ─────────────────────────────
  //
  // The second undeclared dependency, beside the import above: a gate that
  // opens another script's source at a path anchored to its own location. The
  // card's instance is a STAGED COPY — the digest writes the ADR-0087 gate into
  // a throwaway repo and runs it — and the three shapes (stage it, execute it,
  // assert on it) are one dependency, so the recogniser reads the READ.
  //
  // The recogniser, on fixture source: one line per refusal, for the reason the
  // import fixture above gives — a widening or a narrowing fails HERE with its
  // reason named, rather than as a pair count nobody can attribute afterwards.
  const readFixture = [
    'const __dirname = dirname(fileURLToPath(import.meta.url));',
    "const staged = readFileSync(join(__dirname, 'invoked-as.mjs'), 'utf8');", // followed
    "copyFileSync(new URL('./js-comment-mask.mjs', import.meta.url), dest);", // copy, URL anchor
    "const up = readFileSync(join(__dirname, '..', 'eslint.config.mjs'), 'utf8');", // climbs, still tracked
    "const data = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');", // DATA, not program text
    "const gone = readFileSync(join(__dirname, 'does-not-exist.mjs'), 'utf8');", // resolves, untracked
    "const self = readFileSync(join(__dirname, 'fixture.mjs'), 'utf8');", // itself: the identity key owns it
    "const out = readFileSync(join(tmpdir(), 'x.mjs'), 'utf8');", // outside the tree
    "const cwd = readFileSync('scripts/check-nul-bytes.mjs', 'utf8');", // bare literal, cwd unknown
    "// readFileSync(join(__dirname, 'check-doc-anchors.mjs'), 'utf8');", // a comment
    'const src = "readFileSync(join(__dirname, \'check-role-word.mjs\'), \'utf8\')";', // inside a string
    "const loop = ['bump-objectui.sh'].map((f) => readFileSync(join(__dirname, f), 'utf8'));", // loop variable
  ].join('\n');
  const readFixtureOut = readProgramTargetsInSource('scripts/fixture.mjs', readFixture, (f) =>
    liveTree.files.has(f),
  );
  t(
    'the read scan follows a directory-anchored read and a URL-anchored copy, and refuses data, untracked, self,' +
      ' out-of-tree, bare-literal, commented, string-literal and loop-variable spellings',
    readFixtureOut.join(' · ') === 'scripts/invoked-as.mjs · scripts/js-comment-mask.mjs · eslint.config.mjs',
    readFixtureOut.join(' · '),
  );

  // The live halves. Counts and names in every case, for the reason the import
  // section states: a case that can only be read as "something was found" is
  // the shape a pin fails in.
  const readEdges = [...liveDiscovery.byCheck]
    .flatMap(([check, e]) => (e.reads ?? []).map((r) => [check, r, e.readOrigin.get(r)]));
  t(
    `the live tree HAS a gate reading another script's source, so this key is not vacuous (${readEdges.length}:` +
      ` ${readEdges.map(([c, r, by]) => `${c} <- ${r} via ${by}`).join(' · ') || 'none'})`,
    readEdges.length > 0,
  );

  // The card's own specimen, end to end and by name. ⛔ Not "some family
  // matches": the miss was THIS family scoring `silent` for THIS path.
  const digestEntry = liveDiscovery.byCheck.get('check:objectui-changeset');
  const STAGED_GATE = 'scripts/check-adr-0087-registration.mjs';
  t(
    `the staged gate reaches the family that runs a copy of it (${coveringKey(digestEntry, STAGED_GATE)?.via ?? 'no key'})`,
    coveringKey(digestEntry, STAGED_GATE)?.key === STAGED_GATE &&
      coveringKey(digestEntry, STAGED_GATE)?.via === 'program text read by scripts/objectui-changeset-digest.mjs',
  );
  // …and green for the RIGHT reason. `extractWatchHints` masks self-tests, so
  // the staging literal is not a hint and cannot supply this lead — the case
  // above would otherwise pass on a key it is not testing.
  t(
    'and no watch hint of that family covers it, which is why the key was needed',
    !(digestEntry.hints ?? []).some((h) => hintCovers(h, STAGED_GATE)) &&
      !(digestEntry.files ?? []).some((f) => hintCovers(f, STAGED_GATE)),
  );

  // Reconstruction: `entry.reads` is what the scan says over the family's own
  // files, never a list kept here.
  const offReads = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    const expected = [];
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      for (const r of readProgramTargetsInSource(f, liveSource(f), (x) => liveTree.files.has(x))) {
        if (!expected.includes(r)) expected.push(r);
      }
    }
    if (expected.join(' · ') !== (entry.reads ?? []).join(' · ')) offReads.push(check);
  }
  t(
    `a family's reads are exactly what the scan finds in the scripts its COMMAND names (off: ${offReads.join(', ') || 'none'})`,
    offReads.length === 0,
  );

  // Additive BY CONSTRUCTION — the claim `coveringKey`'s comment makes. For
  // every read target, the family either had no key at all before, or keeps the
  // exact key and label it had: this one is consulted last and can only fill a
  // hole.
  const reattributed = [];
  for (const [check, entry, target] of readEdges.map(([c, r]) => [c, liveDiscovery.byCheck.get(c), r])) {
    const withKey = coveringKey(entry, target);
    const saved = entry.reads;
    entry.reads = [];
    const without = coveringKey(entry, target);
    entry.reads = saved;
    // Both halves, because only the pair is the claim. Without the first, a
    // derivation that answers NOTHING for every read edge satisfies "nothing
    // was re-attributed" perfectly.
    if (!withKey) reattributed.push(`${check} ${target}: no key at all`);
    else if (without && (without.key !== withKey.key || without.via !== withKey.via)) {
      reattributed.push(`${check} ${target}: ${without.via} -> ${withKey.via}`);
    }
  }
  t(
    `every read edge earns a key, and none is re-attributed — this key only fills a hole (${reattributed.join(' | ') || 'none'})`,
    readEdges.length > 0 && reattributed.length === 0,
  );

  // The DATA refusal, priced rather than asserted: the live tree really does
  // have gates reading tracked NON-program files at anchored paths, and none of
  // them is here. That is the boundary this card declined to cross, and a
  // future card widening it should red this case rather than discover it.
  const dataReads = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      for (const r of anchoredReadTargets(f, liveSource(f), (x) => liveTree.files.has(x))) {
        if (!PROGRAM_TEXT_TARGET.test(r)) dataReads.push(`${check} <- ${r}`);
      }
    }
  }
  t(
    `the program-text restriction is not vacuous: ${dataReads.length} anchored read(s) of tracked DATA are refused` +
      ` (${dataReads.slice(0, 4).join(' · ')}${dataReads.length > 4 ? ` · +${dataReads.length - 4} more` : ''})`,
    dataReads.length > 0 && dataReads.every((d) => !readEdges.some(([c, r]) => `${c} <- ${r}` === d)),
  );

  // ── The PROGRAM a gate RUNS (#13511) ──────────────────────────────────────
  //
  // The third of the three spellings the section above names — "stage it,
  // execute it, assert on it" — and the one nothing recognised. Its live
  // instance is this card's: `check:pm-dispatch-gates` RUNS this very tool, and
  // running it reads every workflow file in the tree, but the derivation scored
  // that family `silent` for a workflows-only diff. A dev derived with the tool,
  // ran every family it named green, and reddened `Lint & Repo Gates` on the one
  // gate that judges the file the PR added.
  //
  // ⛔ Every case below pins the FAMILY BEING PRESENT FOR THE SURFACE, never
  // that a derivation ran. The defect does not crash and does not report
  // nothing: it hands a dev a coherent, plausible, INCOMPLETE list, and every
  // "it derived something" assertion passes straight through it.
  const runFixture = [
    "const ROOT = new URL('..', import.meta.url).pathname;", // the fixture sits one level down, so ONE hop up is the root
    "const TOOL = 'scripts/pm/dispatch-gates.mjs';",
    "const r1 = spawnSync(process.execPath, [join(ROOT, TOOL), '--self-test'], { stdio: 'inherit' });", // followed: argv array, component NAMED
    "const r2 = execFileSync('node', [join(ROOT, 'scripts/invoked-as.mjs')]);", // followed: component written out
    "const r3 = spawnSync('git', ['ls-files'], { cwd: ROOT });", // a program that is not in this tree
    'const r4 = execSync(`pnpm -s ${script}`);', // shell form: a command STRING, never scanned
    "const r5 = spawnSync(process.execPath, [join(ROOT, 'package.json')]);", // tracked, but not program text
    "const r6 = spawnSync(process.execPath, [join(ROOT, 'scripts/does-not-exist.mjs')]);", // resolves, untracked
    "const r7 = spawnSync(process.execPath, [join(ROOT, 'scripts/fixture.mjs')]);", // itself: the identity key owns it
    'const r8 = spawnSync(process.execPath, args);', // argv is a binding, not an array literal
    "let PICK = 'scripts/invoked-as.mjs';", // a REBOUND component has no single reading
    "PICK = 'scripts/js-comment-mask.mjs';",
    'const r9 = spawnSync(process.execPath, [join(ROOT, PICK)]);',
    "// spawnSync(process.execPath, [join(ROOT, 'scripts/check-nul-bytes.mjs')]);", // a comment
    'const src = "spawnSync(process.execPath, [join(ROOT, \'scripts/check-role-word.mjs\')])";', // inside a string
  ].join('\n');
  const runFixtureOut = spawnedProgramTargets('scripts/fixture.mjs', runFixture, (f) => liveTree.files.has(f));
  t(
    'the run scan follows an argv-array spawn whose program is a NAMED constant and one written out, and refuses the' +
      ' shell form, data, untracked, self, a bound argv, a rebound component, commented and string-literal spellings',
    runFixtureOut.join(' · ') === 'scripts/pm/dispatch-gates.mjs · scripts/invoked-as.mjs',
    runFixtureOut.join(' · '),
  );
  // The hop READS a binding; it never invents one. The fixture above already
  // isolates the hop itself — r1 names its program through a constant and r2
  // writes it out, so removing the hop reds that case while leaving r2 — and
  // this one pins the refusal side, which no count can show.
  t(
    'and an unbound component name is refused rather than guessed at',
    spawnedProgramTargets(
      'scripts/fixture.mjs',
      "const ROOT = new URL('..', import.meta.url).pathname;\nspawnSync(process.execPath, [join(ROOT, NOT_BOUND_HERE)]);",
      (f) => liveTree.files.has(f),
    ).length === 0,
  );
  t(
    'a spawn written inside a self-test body is a fixture the self-test drives, not the gate reaching a program',
    spawnedProgramTargets(
      'scripts/fixture.mjs',
      [
        "const ROOT = new URL('..', import.meta.url).pathname;",
        'function selfTest() {',
        "  spawnSync(process.execPath, [join(ROOT, 'scripts/invoked-as.mjs')]);",
        '}',
      ].join('\n'),
      (f) => liveTree.files.has(f),
    ).length === 0,
  );

  // ── LIVE: the card's own specimen, by name, on the surface that missed ─────
  const PM_GATE = 'check:pm-dispatch-gates';
  const pmEntry = liveDiscovery.byCheck.get(PM_GATE);
  const PM_TOOL = 'scripts/pm/dispatch-gates.mjs';
  const liveWorkflowFiles = [...liveTree.files].filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)).sort();
  t(
    `the tree has workflow files to derive for (${liveWorkflowFiles.length})`,
    liveWorkflowFiles.length > 0 && Boolean(pmEntry),
  );
  t(
    `${PM_GATE} reaches the tool it runs over the RUN edge (runs: ${(pmEntry?.runs ?? []).join(' · ') || 'none'})`,
    (pmEntry?.runs ?? []).includes(PM_TOOL),
  );
  // ⭐ The regression itself. Not "a family matched" and not "the derivation
  // produced 18 rows": THIS family, MATCHED, for a workflow file.
  const pmSurface = liveWorkflowFiles.slice(0, 1);
  t(
    `⭐ a workflows-only surface derives ${PM_GATE} — the gate whose run reads that surface` +
      ` (${classifyEntry(pmEntry, pmSurface).verdict} for ${pmSurface[0]})`,
    classifyEntry(pmEntry, pmSurface).verdict === 'matched',
  );
  t(
    'and for EVERY workflow file in the tree, not just the one sampled',
    liveWorkflowFiles.every((f) => classifyEntry(pmEntry, [f]).verdict === 'matched'),
  );
  t(
    `and it is derived RUNNABLY, which is what a dev pastes (${runnableInvocation(pmEntry)})`,
    runnableInvocation(pmEntry) === 'pnpm check:pm-dispatch-gates',
  );
  t(
    `and the via column names the program it runs, not a population this gate declares` +
      ` (${coveringKey(pmEntry, pmSurface[0])?.via})`,
    coveringKey(pmEntry, pmSurface[0])?.key === '.github/workflows' &&
      coveringKey(pmEntry, pmSurface[0])?.via === `gate source via the program it runs, ${PM_TOOL}`,
  );
  // …and green for the RIGHT reason. Without this half the case above passes on
  // any key at all, including one the gate already had — which is exactly the
  // reading that would let someone "fix" this by widening an unrelated literal.
  t(
    'and no hint this gate spells ITSELF covers a workflow file, which is why the edge was needed',
    pmEntry.hints.filter((h) => !pmEntry.hintOrigin.has(h)).every((h) => !liveWorkflowFiles.some((f) => hintCovers(h, f))) &&
      !(pmEntry.files ?? []).some((f) => liveWorkflowFiles.includes(f)) &&
      !coveringTrigger(pmEntry, pmSurface[0]) &&
      !coveringJobFilter(pmEntry, pmSurface[0]),
  );
  // The narrowing on THIS edge, proven non-vacuous in both directions: the tool
  // really does spell more than a follower inherits, and what it does inherit
  // really does still reach every workflow file. A declaration that took the
  // real population with it would read exactly like a working one — fewer
  // pairs, every gate green.
  t(
    `the run target spells ${ownHints.length} literal(s) and a follower inherits ${ownPopulation.length} of them,` +
      ' so the declaration narrows rather than waves through',
    ownHints.length > ownPopulation.length && ownPopulation.length > 0,
  );
  t(
    'and the narrowing is not a coverage cut — every workflow file stays reachable through what is inherited',
    liveWorkflowFiles.every((f) => ownPopulation.some((h) => hintCovers(h, f))),
  );

  // Reconstruction: `entry.runs` is what the scan says over the family's own
  // files, never a list kept here — the same invariant the two edges above hold.
  const offRuns = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    const expected = [];
    if (!entry.selfTest) {
      for (const f of entry.files ?? []) {
        if (!existsSync(join(ROOT, f))) continue;
        for (const r of spawnedProgramTargets(f, liveSource(f), (x) => liveTree.files.has(x))) {
          if (!liveGateFiles.has(r) && !expected.includes(r)) expected.push(r);
        }
      }
    }
    if (expected.join(' · ') !== (entry.runs ?? []).join(' · ')) offRuns.push(check);
  }
  t(
    `a family's run targets are exactly what the scan finds in the scripts its COMMAND names (off: ${offRuns.join(', ') || 'none'})`,
    offRuns.length === 0,
  );

  // The gate-file exclusion, on THIS edge, priced rather than assumed. It is
  // the same refusal the import follow makes and it is live here: two families
  // spawn `scripts/docs-audit/affected-docs.mjs`, which IS a discovered gate
  // file, so its population is left to its own family instead of inherited
  // twice under weaker provenance.
  const runGateEdges = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      for (const r of spawnedProgramTargets(f, liveSource(f), (x) => liveTree.files.has(x))) {
        if (liveGateFiles.has(r) && !(entry.files ?? []).includes(r)) runGateEdges.push([check, r]);
      }
    }
  }
  t(
    `the live tree HAS a gate spawning another gate's file, so the exclusion is not vacuous (${runGateEdges.length}:` +
      ` ${runGateEdges.map(([c, r]) => `${c} -> ${r}`).join(' · ') || 'none'})`,
    runGateEdges.length > 0,
  );
  t(
    'and not one of those edges is followed — a gate script is left to its OWN family, exactly as on the import edge',
    runGateEdges.every(([check, r]) => !(liveDiscovery.byCheck.get(check)?.runs ?? []).includes(r)),
  );

  // Additive BY CONSTRUCTION, the claim the wiring comment makes: the run edge
  // appends AFTER own and imported hints, so it can only fill a hole. Both
  // halves again — "nothing was re-attributed" is satisfied perfectly by a
  // derivation that answers nothing at all.
  const runInherited = [...liveDiscovery.byCheck]
    .flatMap(([check, e]) => [...(e.hintEdge ?? new Map())].filter(([, kind]) => kind === 'run').map(([h]) => [check, e, h]));
  t(
    `the run edge contributes ${runInherited.length} inherited hint(s), so the cases below are not vacuous` +
      ` (${runInherited.map(([c, , h]) => `${c} <- ${h}`).join(' · ') || 'none'})`,
    runInherited.length > 0,
  );
  const runReattributed = [];
  for (const [check, entry, hint] of runInherited) {
    const ownAnswer = (entry.hints ?? []).find((h) => !entry.hintOrigin.has(h) && hintCovers(h, hint));
    if (ownAnswer) runReattributed.push(`${check}: ${hint} was already answered by ${ownAnswer}`);
  }
  t(
    `and no run-edge hint duplicates a population the gate already declared (${runReattributed.join(' | ') || 'none'})`,
    runReattributed.length === 0,
  );

  // ── The PACKAGE a gate re-derives from (#13518) ────────────────────────────
  //
  // Six gates re-derive their population from `@objectstack/spec`'s public
  // export surface, and every one of them was ABSENT from the derivation for
  // `packages/spec/src/index.ts` — the entry point that IS their subject. One
  // shape, one hole: the population is computed through the manifest's
  // `exports` map into an untracked `dist/`, so no literal carries it.
  //
  // ⛔ Every case below pins the FAMILY BEING PRESENT FOR THE SURFACE, never
  // that a derivation ran, and the class-level case pins a gate that is in no
  // table anywhere — because "the six now derive" is satisfied perfectly by six
  // names in a list, which is the repair this lane has ruled against three
  // times.
  const manifestFixture = [
    "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
    "const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));",
    'for (const sub of Object.keys(pkg.exports ?? {})) entries[sub] = sub;', // the `exports` read that makes it this class
    "readFileSync(resolve(PKG_DIR, 'dual-source-exports.baseline.json'), 'utf8');", // tracked, not a manifest
    "readFileSync(join(ROOT, 'packages/does-not-exist/package.json'), 'utf8');", // resolves, untracked
  ].join('\n');
  const manifestOut = packageManifestTargets(
    'packages/spec/scripts/fixture.ts',
    manifestFixture,
    (f) => liveTree.files.has(f),
  );
  t(
    'the manifest scan follows a package manifest read through a resolved package-root binding, and refuses a' +
      ` non-manifest read and an untracked one (${manifestOut.join(' · ') || 'none'})`,
    manifestOut.join(' · ') === 'packages/spec/package.json',
  );
  // The narrowing that decides the number, on fixture source: the SAME manifest
  // read, with the `exports` read removed, contributes nothing. No count can
  // show this — a rule that admitted it would simply look more generous.
  t(
    'and the identical manifest read with no `exports` read is refused — a version or scripts reader is not this class',
    packageManifestTargets(
      'packages/spec/scripts/fixture.ts',
      [
        "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
        "const version = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')).version;",
      ].join('\n'),
      (f) => liveTree.files.has(f),
    ).length === 0,
  );
  t(
    'and a manifest read inside a self-test body is a fixture the self-test builds, not the gate reaching a package',
    packageManifestTargets(
      'packages/spec/scripts/fixture.ts',
      [
        "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
        'function selfTest() {',
        "  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));",
        '  return pkg.exports;',
        '}',
      ].join('\n'),
      (f) => liveTree.files.has(f),
    ).length === 0,
  );
  // The parameter hop, isolated. The fixture above reaches the manifest through
  // a CONSTANT; this one reaches it only through a parameter, which is the
  // spelling `build-export-origins.ts` uses and the one member of the six that
  // no other rule here could reach.
  const paramFixture = (calls) =>
    [
      "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
      'function collect(pkgDir: string) {',
      "  const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));",
      '  return pkg.exports;',
      '}',
      ...calls,
    ].join('\n');
  t(
    'a package root held in a PARAMETER resolves when the function has exactly one call site',
    packageManifestTargets(
      'packages/spec/scripts/fixture.ts',
      paramFixture(['const entries = collect(PKG_DIR);']),
      (f) => liveTree.files.has(f),
    ).join(' · ') === 'packages/spec/package.json',
  );
  t(
    'and TWO call sites contribute nothing rather than a pick — a parameter with two values has no single reading',
    packageManifestTargets(
      'packages/spec/scripts/fixture.ts',
      paramFixture(['const a = collect(PKG_DIR);', "const b = collect('/somewhere/else');"]),
      (f) => liveTree.files.has(f),
    ).length === 0,
  );

  // ── LIVE: the card's six, by name, on the surface that missed ──────────────
  const SPEC_ENTRY = 'packages/spec/src/index.ts';
  const EXPORT_SURFACE_SIX = [
    'check:api-surface',
    'check:export-origins',
    'check:entry-nameability',
    'check:exported-any',
    'check:dual-source-exports',
    'check:browser-reachable-entries',
  ];
  // The positive control the card carried, and it is load-bearing: it is what
  // makes the six an ABSENCE rather than a dead query.
  const SPEC_CONTROL = 'check:strictness-ledger';
  t(
    `the tree still has ${SPEC_ENTRY} and all six families plus the control`,
    liveTree.files.has(SPEC_ENTRY) &&
      Boolean(liveDiscovery.byCheck.get(SPEC_CONTROL)) &&
      EXPORT_SURFACE_SIX.every((c) => liveDiscovery.byCheck.get(c)),
  );
  const sixVerdicts = EXPORT_SURFACE_SIX.map(
    (c) => [c, classifyEntry(liveDiscovery.byCheck.get(c), [SPEC_ENTRY]).verdict],
  );
  t(
    `⭐ the spec entry point derives every gate that re-derives from it (${sixVerdicts.map(([c, v]) => `${c}=${v}`).join(' · ')})`,
    sixVerdicts.every(([, v]) => v === 'matched'),
  );
  t(
    `and the control still derives, so the six are a reading and not a broken probe`,
    classifyEntry(liveDiscovery.byCheck.get(SPEC_CONTROL), [SPEC_ENTRY]).verdict === 'matched',
  );
  // …and green for the RIGHT reason. Without this half every case above passes
  // on a key the gate already had — the reading that would let someone "fix"
  // this by widening an unrelated literal.
  const sixOnOwn = EXPORT_SURFACE_SIX.filter((c) => {
    const e = liveDiscovery.byCheck.get(c);
    return (
      (e.files ?? []).some((f) => hintCovers(f, SPEC_ENTRY)) ||
      coveringTrigger(e, SPEC_ENTRY) ||
      coveringJobFilter(e, SPEC_ENTRY) ||
      (e.hints ?? []).some((h) => !e.hintOrigin.has(h) && hintCovers(h, SPEC_ENTRY))
    );
  });
  t(
    `and not one of the six reaches the entry point on anything it spells ITSELF, which is why the edge was needed` +
      ` (${sixOnOwn.join(', ') || 'none'})`,
    sixOnOwn.length === 0,
  );
  t(
    'and each of the six is derived RUNNABLY, which is what a dev pastes',
    EXPORT_SURFACE_SIX.every((c) => runnableInvocation(liveDiscovery.byCheck.get(c)).includes(c)),
  );
  t(
    'and the via column names the export surface it re-derives from, not a population the gate declares',
    EXPORT_SURFACE_SIX.every((c) => {
      const k = coveringKey(liveDiscovery.byCheck.get(c), SPEC_ENTRY);
      return (
        k?.key === 'packages/spec/src' &&
        k?.via === 'gate source via the export surface declared by packages/spec/package.json'
      );
    }),
  );

  // ⭐ THE CLASS, not the six. A SEVENTH gate of the same shape, written here
  // and named in no table in this file, reaches the same surface through the
  // same edge — which is the question the triage ruling asked and the one a
  // list of six names cannot answer. Deleting the edge reds this case exactly
  // as it reds the six above.
  const seventhGate = [
    "const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');",
    "const manifest = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));",
    'const entries = Object.keys(manifest.exports);',
  ].join('\n');
  const seventhManifests = packageManifestTargets(
    'packages/spec/scripts/check-invented-for-this-case.ts',
    seventhGate,
    (f) => liveTree.files.has(f),
  );
  const seventhPopulation = seventhManifests.flatMap(liveManifestHints);
  t(
    `⭐ a SEVENTH gate of the class, in no table anywhere, inherits the same population automatically` +
      ` (${seventhManifests.join(' · ') || 'none'} -> ${seventhPopulation.join(' · ') || 'nothing'})`,
    seventhPopulation.some((h) => hintCovers(h, SPEC_ENTRY)),
  );

  // Reconstruction: `entry.manifests` is what the scan says over the family's
  // own files, never a list kept here — the invariant both other edges hold.
  const offManifests = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    const expected = [];
    if (!entry.selfTest) {
      for (const f of entry.files ?? []) {
        if (!existsSync(join(ROOT, f))) continue;
        for (const p of packageManifestTargets(f, liveSource(f), (x) => liveTree.files.has(x))) {
          if (!expected.includes(p)) expected.push(p);
        }
      }
    }
    if (expected.join(' · ') !== (entry.manifests ?? []).join(' · ')) offManifests.push(check);
  }
  t(
    `a family's manifest targets are exactly what the scan finds in the scripts its COMMAND names` +
      ` (off: ${offManifests.join(', ') || 'none'})`,
    offManifests.length === 0,
  );

  // The `exports` narrowing, live and in both directions. The refusal is only
  // meaningful if the tree really HAS gates that read a manifest for something
  // else — and it has three, each verified at its own declaration site.
  const manifestReaders = [];
  const manifestNonReaders = [];
  for (const [check, entry] of liveDiscovery.byCheck) {
    for (const f of entry.files ?? []) {
      if (!existsSync(join(ROOT, f))) continue;
      const source = liveSource(f);
      const bare = anchoredReadTargets(f, maskSelfTests(source), (x) => liveTree.files.has(x)).filter((x) =>
        /(?:^|\/)package\.json$/.test(x),
      );
      if (bare.length === 0) continue;
      if (packageManifestTargets(f, source, (x) => liveTree.files.has(x)).length > 0) manifestReaders.push(check);
      else manifestNonReaders.push(check);
    }
  }
  t(
    `the live tree HAS gates reading a manifest WITHOUT reading its exports, so the narrowing is not vacuous` +
      ` (${manifestNonReaders.length}: ${[...new Set(manifestNonReaders)].join(' · ') || 'none'})`,
    manifestNonReaders.length > 0,
  );
  t(
    'and not one of them inherits a package source — a version or scripts reader stays where it was',
    [...new Set(manifestNonReaders)].every(
      (c) => (liveDiscovery.byCheck.get(c)?.manifests ?? []).length === 0,
    ),
  );
  // ⚠️ The follow set is BROADER than the six and that is not a leak: a gate
  // reading the ROOT manifest's `exports`-shaped keys follows the edge and
  // inherits nothing (the root declares no `exports`), and two gates that read
  // the spec manifest already SPELL `packages/spec/src` themselves, so the edge
  // has nothing left to add for them. What must be exact is the population, not
  // the follow — so this asserts the six are all IN, and the count that moved
  // is checked against the six by name below.
  t(
    `every one of the six follows the edge (${[...new Set(manifestReaders)].join(' · ') || 'none'})`,
    EXPORT_SURFACE_SIX.every((c) => manifestReaders.includes(c)),
  );
  const manifestInherited = [...liveDiscovery.byCheck].flatMap(([check, e]) =>
    [...(e.hintEdge ?? new Map())].filter(([, kind]) => kind === 'manifest').map(([h]) => [check, e, h]),
  );
  // ⭐ THE CLASS, live. The edge gives a population to the six AND to one gate
  // the card never named: `check:dual-build-cjs-loads`, which walks the same
  // `exports` map and `require()`s every published entry (#12971), so the spec
  // export surface is its subject too. It is here because it re-derives from
  // that surface, not because anything lists it — which is the triage ruling's
  // question ("修完之后第七个同类 gate 会不会自动被覆盖") answered by a live
  // family rather than by an argument. It gains no PAIRS, because its CI job
  // filter is `packages/**` and already covered them; it gains the right
  // PROVENANCE, and it is what this case exists to keep honest.
  const CLASS_SEVENTH = 'check:dual-build-cjs-loads';
  t(
    `and every family the edge gives a population to really re-derives from an export surface` +
      ` (${[...new Set(manifestInherited.map(([c]) => c))].join(' · ') || 'none'})`,
    manifestInherited.every(([c]) => EXPORT_SURFACE_SIX.includes(c) || c === CLASS_SEVENTH),
  );
  t(
    `⭐ and a SEVENTH live gate the card never named is covered by the same edge (${CLASS_SEVENTH})`,
    manifestInherited.some(([c]) => c === CLASS_SEVENTH),
  );

  // Additive BY CONSTRUCTION, the claim the wiring comment makes: the manifest
  // edge appends AFTER own, imported and run hints, so it can only fill a hole.
  // Both halves again — "nothing was re-attributed" is satisfied perfectly by a
  // derivation that answers nothing at all.
  t(
    `the manifest edge contributes ${manifestInherited.length} inherited hint(s), so the cases here are not vacuous`,
    manifestInherited.length > 0,
  );
  const manifestReattributed = [];
  for (const [check, entry, hint] of manifestInherited) {
    const ownAnswer = (entry.hints ?? []).find((h) => !entry.hintOrigin.has(h) && hintCovers(h, hint));
    if (ownAnswer) manifestReattributed.push(`${check}: ${hint} was already answered by ${ownAnswer}`);
  }
  t(
    `and no manifest-edge hint duplicates a population the gate already declared (${manifestReattributed.join(' | ') || 'none'})`,
    manifestReattributed.length === 0,
  );

  // ── A followed module's JOIN BASE is not a population (#12500) ─────────────
  //
  // `cli-build-prerequisite.mjs` spells `packages/cli` because it joins paths
  // from it and writes it into every rerun command its two consumers print.
  // Inherited whole it reads as a subtree claim, and it handed check:i18n and
  // check:i18n-coverage all 322 tracked files of that package — 210 of them
  // (the 100-file test suite, the package docs, the vitest config, the sibling
  // app-nav gate script) unable to change a byte of the `dist/` those gates
  // spawn. The gates' refusal text is exemplary, so the cost was never a false
  // green: it was a full CLI closure build per card, bought to measure two
  // gates the diff provably could not move. Measured at the narrowing:
  // 322 -> 214 covered files per gate (108 x 2 = 216 fabricated pairs
  // withdrawn), and all 112 files the gates really read still named.
  //
  // BOTH directions, against real files. A narrowing that also dropped the CLI
  // source would be the under-naming mirror this card's pair exists to keep
  // apart — the source compiled into the spawned command must still derive.
  const CLI_PREREQ = 'scripts/cli-build-prerequisite.mjs';
  const cliPrereqSource = liveSource(CLI_PREREQ);
  const cliPrereqSpelled = extractWatchHints(cliPrereqSource, CLI_PREREQ, { tree: liveTree });
  const cliPrereqPopulation = declaredInheritedPopulation(cliPrereqSource, cliPrereqSpelled)?.population ?? [];
  t(
    `the CLI build-prerequisite module declares what its callers inherit (${cliPrereqPopulation.join(' ') || 'nothing'})`,
    cliPrereqPopulation.length === 3,
  );
  t(
    'and it still SPELLS the whole-package join base — the declaration narrows a live literal, not a deleted one',
    // The `length > 0` is not decoration: without it a DELETED marker satisfies
    // this case by the empty set (nothing is inherited, so nothing inherits the
    // join base) — the shape a pin that only asserts an absence always has.
    cliPrereqPopulation.length > 0
      && cliPrereqSpelled.includes('packages/cli')
      && !cliPrereqPopulation.includes('packages/cli'),
  );
  // Specimens, not classes: the extractor module whose edit really does move
  // the committed bundles, and a test file that compiles into nothing either
  // gate runs. Both live, so neither direction can pass over an empty set.
  const CLI_SRC_SPECIMEN = 'packages/cli/src/utils/i18n-extract.ts';
  const CLI_TEST_SPECIMEN = 'packages/cli/test/authoring-rule-command-parity.test.ts';
  t(
    'both CLI specimens are real tracked files, so the two directions below are live',
    existsSync(join(ROOT, CLI_SRC_SPECIMEN)) && existsSync(join(ROOT, CLI_TEST_SPECIMEN)),
  );
  for (const check of ['check:i18n', 'check:i18n-coverage']) {
    const cliEntry = liveDiscovery.byCheck.get(check);
    t(
      `${check} still derives the CLI source compiled into the command it spawns`,
      Boolean(cliEntry) && coveringKey(cliEntry, CLI_SRC_SPECIMEN)?.key === 'packages/cli/src',
    );
    t(
      `${check} no longer derives a CLI test file, which compiles into nothing it runs`,
      Boolean(cliEntry) && coveringKey(cliEntry, CLI_TEST_SPECIMEN) === null,
    );
  }

  // The live guard: every REAL paths-filtered workflow either discovers a
  // family or declares why not. This is what actually fails CI the day a new
  // paths-filtered workflow adds an undiscoverable verification step and
  // forgets both halves of the fix.
  const liveWfDir = join(ROOT, '.github/workflows');
  const liveWorkflowEntries = readdirSync(liveWfDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => ({ file, text: readFileSync(join(liveWfDir, file), 'utf8') }));
  t('the live tree has at least one paths-filtered workflow (the guard is not vacuous)', liveWorkflowEntries.some((e) => extractTriggerPaths(e.text).length > 0));
  const liveGaps = checkFamilyCoverageGaps(liveWorkflowEntries);
  t(`every real paths-filtered workflow discovers a check family or declares why not (gaps: ${liveGaps.join(', ') || 'none'})`, liveGaps.length === 0);

  // ── The reachability sweep — the third verdict (#9883) ────────────────────
  //
  // The verdict answers a question about the TREE, so both halves are pinned:
  // the judgment over a fixture corpus, and the corpus reader against the real
  // one. A fixture-only test passes just as happily when the reader is asking
  // git the wrong question — which is the defect the verdict exists to expose,
  // one level up.
  const treeFixture = [
    'AGENTS.md',
    'packages/spec/package.json',
    'packages/spec/src/index.ts',
    'examples/app-showcase/src/ui/view.ts',
  ];
  const fam = (hints, extra = {}) => ({ hints, files: [], workflows: new Set(['lint.yml']), ...extra });
  const sweepEntries = [
    // one dead literal and one live one: a family is only unreachable when its
    // WHOLE declared population is dead.
    ['check:reaches', fam(['application/json', 'packages/spec/src'])],
    ['check:moved', fam(['packages/spec/src/legacy/**'])],
    ['check:never-was', fam(['application/json'])],
    ['check:too-generic', fam(['examples'])],
    // `packages/spec/src/index.ts` is in the corpus; the gate spells it the way
    // an import does. Dead to `hintCovers`, and NOT a layout move.
    ['check:extensionless', fam(['packages/spec/src/index'])],
    ['check:declares-nothing', fam([], { files: ['scripts/check-declares-nothing.mjs'] })],
  ];
  const sweep = unreachableFamilies(sweepEntries, treeFixture);
  const sweptNames = sweep.map((u) => u.check);
  const reasonOf = (name) => unreachableReason(sweep.find((u) => u.check === name)?.dead ?? []);
  t('a family whose whole declared population is absent from the tree is unreachable', sweptNames.includes('check:never-was'));
  t('one live hint clears a family, however many dead ones it also names', !sweptNames.includes('check:reaches'));

  // ── The per-hint sweep: a live sibling no longer hides its dead ones (#13312) ──
  //
  // check:query-options-erasure printed three fixture filenames that have
  // never existed in this tree, verbatim and unannotated, because its live
  // baseline kept the family out of the unreachable listing — the survivor
  // class isNonPathNamespace's docblock names as the expensive direction.
  // These pin the finer grain: the dead literal is swept per family, the live
  // one is untouched, and a family with nothing dead earns no row at all.
  const perHint = deadHintSweep(sweepEntries, treeFixture);
  const mixedRow = perHint.byCheck.get('check:reaches');
  t('a dead literal is swept out of a REACHABLE family, not only an unreachable one', mixedRow?.dead.map((d) => d.hint).join() === 'application/json');
  t('...with the family total beside it, so the note can say N of M', mixedRow?.declared === 2);
  t('a fully-dead family carries the same row shape at both grains', perHint.byCheck.get('check:never-was')?.dead.length === 1);
  t('a family whose hints all reach earns no per-hint row', !perHint.byCheck.has('check:extensionless'));
  t('a family declaring nothing earns no per-hint row — that is undetermined, a different fact', !perHint.byCheck.has('check:declares-nothing'));
  t(
    'the family sweep answers the same from an injected per-hint sweep — one sweep, two grains, no disagreement',
    unreachableFamilies(sweepEntries, treeFixture, perHint).map((u) => u.check).join() === sweptNames.join(),
  );
  let perHintEmpty = false;
  try {
    deadHintSweep(sweepEntries, []);
  } catch {
    perHintEmpty = true;
  }
  t('the per-hint sweep refuses an empty corpus like the family sweep it feeds', perHintEmpty);

  // The renderer half, driven by a PLANTED dead literal in a reachable family
  // — the delivery control #13312's triage names: the planted literal is
  // marked where it is shown, the real hint beside it is NOT (the annotation
  // must not eat the hint set), and the note counts the dead against the
  // declared total in the unreachable listing's own voice.
  const planted = ['packages/spec/src', 'scripts/__planted_never_existed__.mjs'];
  const plantedRow = deadHintSweep([['check:planted', fam(planted)]], treeFixture).byCheck.get('check:planted');
  t('a planted dead literal in a reachable family IS swept', plantedRow?.dead.map((d) => d.hint).join() === 'scripts/__planted_never_existed__.mjs');
  const plantedNames = residueNames(planted, new Set(plantedRow.dead.map((d) => d.hint)));
  t('the names line marks the planted literal as dead', plantedNames.includes('scripts/__planted_never_existed__.mjs ✗'));
  t('...and leaves the real hint beside it unmarked', plantedNames.startsWith('packages/spec/src,') && !plantedNames.includes('packages/spec/src ✗'));
  const plantedNote = deadNamesNote(plantedRow);
  t('the note counts the dead against the declared total', plantedNote.includes('1 of 2 declared literal(s)'));
  t("...and names WHY in the unreachable listing's own voice", /never was a repo path/.test(plantedNote));
  t(
    'the note is capped like the listing it sits under, never an inventory',
    /…$/.test(deadNamesNote({ declared: 9, dead: [1, 2, 3, 4].map((n) => ({ hint: `no/such/p-${n}`, deepest: '' })) })),
  );
  t('a dead literal hidden behind the names cap is still counted, never silently dropped', residueNames(['a/b', 'c/d', 'e/f', 'g/h'], new Set(['g/h'])) === 'a/b, c/d, e/f, …');
  t(
    'a family that declares NO population is NOT unreachable — that is the undetermined verdict, a different fact',
    !sweptNames.includes('check:declares-nothing'),
  );
  t('the sweep names WHY: a literal no tracked path begins with was never a repo path', /never was a repo path/.test(reasonOf('check:never-was')));
  t('the sweep names WHY: the tree stops at a shorter prefix, so the layout moved under it', /stops at packages\/spec\/src/.test(reasonOf('check:moved')));
  // The third cause is the one a bare "matched nothing" would send a reader
  // hunting a directory that is sitting in front of them: the population is
  // right there and hintCovers refuses the literal as too generic. It is also
  // the pin that the sweep judges with hintCovers itself rather than with a
  // faster second rule that would answer this case differently.
  t('the sweep names WHY: the tree HAS the population and the covering rule refuses the literal', /the tree HAS it/.test(reasonOf('check:too-generic')));
  // The FOURTH cause used to be reached from HERE, and #12514 took that away on
  // purpose: `hintCovers` now follows a dropped extension, so a specifier that
  // names a file the tree HAS is MATCHED and never enters `dead` to be
  // described. That is the fix, so the pin asserts the ARRIVAL rather than
  // being deleted for going quiet — a departure pin cannot see an arrival, and
  // this section learned that the expensive way one card ago.
  t(
    'an extensionless specifier whose file the tree HAS is no longer unreachable at all — it is MATCHED',
    !sweptNames.includes('check:extensionless'),
  );
  t('...because the covering rule reaches the file itself', hintCovers('packages/spec/src/index', 'packages/spec/src/index.ts'));
  // The renderer is a pure function over `dead`, so it is still pinned — just
  // no longer from the live sweep for a hint that carries a separator. Handed
  // the entry the sweep used to build, it must still say the true thing; that
  // sentence is #12780's and this card does not move it.
  const extlessDead = [
    {
      hint: 'packages/spec/src/index',
      deepest: deepestTrackedPrefix('packages/spec/src/index', trackedPrefixes(treeFixture)),
      target: extensionlessModuleTarget('packages/spec/src/index', new Set(treeFixture), trackedPrefixes(treeFixture)),
    },
  ];
  t('the renderer still names WHY: the tree HAS the file under the extension the specifier drops', /extensionless module spelling/.test(unreachableReason(extlessDead)));
  t('...and it names the FILE, so the reader has no prefix to guess from', unreachableReason(extlessDead).includes('packages/spec/src/index.ts'));
  t('...never reporting the short prefix as a layout move', !/layout moved/.test(unreachableReason(extlessDead)));
  t(
    'a family whose only dead hints are extensionless specifiers is BY CONSTRUCTION, not a miss to triage',
    unreachableClass(extlessDead) === 'by construction',
  );
  // ...and the exception is exactly that narrow: a hint with no such file in
  // the tree is a layout move exactly as before.
  t('a genuine short prefix is still a layout move', unreachableClass(sweep.find((u) => u.check === 'check:moved').dead) === 'layout moved');
  // The predicate itself, both directions, over the same fixture corpus.
  const extlessFiles = new Set(treeFixture);
  const extlessPrefixes = trackedPrefixes(treeFixture);
  t(
    'the predicate finds the file an extensionless specifier names',
    extensionlessModuleTarget('packages/spec/src/index', extlessFiles, extlessPrefixes) === 'packages/spec/src/index.ts',
  );
  t(
    '...refuses a hint the tree already HAS as a path, leaving the too-generic message its case',
    extensionlessModuleTarget('examples', extlessFiles, extlessPrefixes) === null,
  );
  t(
    '...and invents nothing for a literal that never was a path',
    extensionlessModuleTarget('application/json', extlessFiles, extlessPrefixes) === null,
  );
  t('...and that case really is a population the tree has', trackedPrefixes(treeFixture).has('examples'));
  t('the reason list is capped rather than printed as an inventory', /…$/.test(unreachableReason([1, 2, 3, 4].map((n) => ({ hint: `no/such/path-${n}`, deepest: '' })))));
  // The verdict is CROSS-CUTTING, never a fourth bucket: an unreachable family
  // classifies exactly as it did before, including MATCHED for a card whose
  // surface is a file that does not exist yet.
  const unreachableFam = fam(['packages/spec/src/legacy/**']);
  t('an unreachable family is still silent for an unrelated card — the sweep moves no verdict', classifyEntry(unreachableFam, ['packages/rest/src/server.ts']).verdict === 'silent');
  t('and still MATCHED for a card surface that does not exist yet', classifyEntry(unreachableFam, ['packages/spec/src/legacy/new.ts']).verdict === 'matched');
  // #4690 one level up: the sweep must not report a broken scan as a clean
  // repo. Three refusals, at the corpus, at the answer, and at the summary.
  let emptyCorpus = false;
  try {
    unreachableFamilies(sweepEntries, []);
  } catch {
    emptyCorpus = true;
  }
  t('a sweep over an EMPTY corpus is refused, never answered as "nothing unreachable"', emptyCorpus);
  let allDead = false;
  try {
    unreachableFamilies([['check:never-was', fam(['application/json'])]], treeFixture);
  } catch {
    allDead = true;
  }
  t('an all-unreachable answer is refused as a broken recognizer, not printed as a defect count', allDead);
  // The corpus reader, against the real tree — a wrong git invocation is
  // invisible to every fixture above.
  const liveCorpus = trackedFiles();
  t('the corpus reader really reads this tree', liveCorpus.length > 1000 && liveCorpus.includes('AGENTS.md'));
  t('and reads it null-separated, so a non-ASCII path is not quoted into a name nothing can match', !liveCorpus.some((f) => f.startsWith('"')));
  t('the collapse the reason speaks in is the one hintCovers judges by', collapseHint('packages/spec/**') === 'packages/spec' && hintCovers('packages/spec/**', 'packages/spec/src/index.ts'));

  // ── The reason must speak in the form the COMPARISON used (#13448) ────────
  //
  // Every branch above used to reason from `collapseHint` unconditionally,
  // including for the hints `hintCovers` had already stopped judging that way.
  // A pattern-judged hint can never equal its own collapsed splice —
  // `.changeset` is not `.changeset/.md` — so "the tree stops at X; the layout
  // moved under it" was the ONLY reachable sentence for that whole shape class:
  // a specific wrong cause, printed under the heading that tells a reader to go
  // chase it. Repairing `hintCovers` alone would have retired the five live
  // instances and left the derivation that mints them intact, which is trading
  // one error for a better-hidden one.
  t('the form a pattern hint is judged by is its literal prefix, not its splice',
    comparedForm('.changeset/*.md') === '.changeset' && collapseHint('.changeset/*.md') === '.changeset/.md');
  t('...and a collapse-judged hint still speaks in the collapse', comparedForm('packages/spec/**') === 'packages/spec');
  t('...for the mid-segment shape too', comparedForm('skills/*/references/_index.md') === 'skills');
  t('...and it stops at the FIRST glob segment, however many follow', comparedForm('src/**/*') === 'src');
  t('...leaving nothing at all when the very first segment is the glob', comparedForm('**/package.json') === '');
  const patternRootPresent = [{ hint: '.changeset/*.md', deepest: '.changeset', target: null }];
  t('a dead glob pattern whose root is right there is NOT a layout move', unreachableClass(patternRootPresent) === 'by construction');
  t('...and never asserts a directory rename that never happened', !/layout moved/.test(unreachableReason(patternRootPresent)));
  t('...while the reason it does give is one the reader can check for themselves',
    /GLOB PATTERN and nothing under that root matches/.test(unreachableReason(patternRootPresent)) &&
      unreachableReason(patternRootPresent).includes("git ls-files '.changeset/*.md'"));
  // ...and the exception is exactly that narrow: a pattern whose own literal
  // prefix has gone IS a move, and still reads as one.
  const patternPrefixGone = [{ hint: 'packages/gone-away/*.ts', deepest: 'packages', target: null }];
  t('a glob pattern whose literal prefix is gone is still a layout move', unreachableClass(patternPrefixGone) === 'layout moved');
  t('...and its reason names the prefix that went missing', unreachableReason(patternPrefixGone).includes('packages/gone-away'));
  // The live half: the specimen is gone from the residue entirely, which is
  // what the card was filed for. A fixture cannot show that.
  t('the live specimen is not a dead literal on this tree at all', hintReachesTree('.changeset/*.md', trackedFiles()));

  // ── A slash is not proof of a path (#10097, option C) ─────────────────────
  //
  // Two families declared a population that was never a population: a literal
  // scraped out of their operational constants and read as the corpus they
  // watch. Both directions are pinned, because a refusal this broad is only
  // safe if it can be shown NOT to eat real paths.
  t('a MIME type is not a path population', isNonPathNamespace('application/json'));
  t('nor is any of the other nine IANA top-level types', ['text/plain', 'image/png', 'font/woff2', 'video/mp4', 'multipart/form-data'].every(isNonPathNamespace));
  t('a full git ref is not a path population', isNonPathNamespace('refs/remotes/origin/main'));
  t('nor is the remote-tracking shorthand for one', isNonPathNamespace('origin/main'));
  // The negative half. These are the shapes a careless rule would take with it,
  // and each is a real spelling this repo's gates use.
  t('an ordinary package path is untouched', !isNonPathNamespace('packages/spec/src/index.ts'));
  t('a dotted top-level dir is untouched', !isNonPathNamespace('.claude/agents'));
  t('a declared subtree is untouched', !isNonPathNamespace('content/**'));
  t('a THREE-segment literal headed by a media type is a path, not a MIME type', !isNonPathNamespace('application/json/schema.ts'));
  t('a media-type head with a DOTTED second segment is a path, not a MIME type', !isNonPathNamespace('image/logo.png'));
  t('a bare word is left to the too-generic rule that already owns it', !isNonPathNamespace('examples'));
  t('a directory merely STARTING with a refused word is untouched', !isNonPathNamespace('origins/data.ts') && !isNonPathNamespace('refspec/x.ts'));
  // The third shape (#13312): an @-headed first segment is a scope marker —
  // npm's grammar, not this repo's layout — and 353 of the 598 dead literals
  // riding unannotated in reachable families were exactly this, package
  // specifiers scraped out of dependency ledgers and read as watched paths.
  t('an npm package specifier is not a path population', isNonPathNamespace('@objectstack/spec'));
  t('nor with a version suffix on it', isNonPathNamespace('@objectstack/spec@*'));
  t('nor a bundler alias whose bare @ is the whole first segment', isNonPathNamespace('@/lib/i18n'));
  t('nor the bare scope name a trailing-slash literal trims down to', isNonPathNamespace('@objectstack'));
  t('an owner/repo slug is NOT refusable by shape — two bare words are what a path looks like', !isNonPathNamespace('objectstack-ai/objectstack'));
  t('a LATER @-segment is untouched — only the first segment carries the namespace claim', !isNonPathNamespace('packages/@scope/x'));
  t('the extractor drops a scraped package specifier', extractWatchHints("const PKG = '@objectstack/driver-memory';").length === 0);
  t('while a real path beside a package specifier survives', extractWatchHints("const PKG = '@objectstack/spec'; const P = 'packages/spec/src';").join() === 'packages/spec/src');
  // Through the extractor, which is where it actually bites.
  t('the extractor drops a scraped MIME type', !extractWatchHints("const H = {'content-type': 'application/json'};").includes('application/json'));
  t('the extractor drops a scraped git ref', extractWatchHints("const R = 'refs/remotes/origin/main';").length === 0);
  t('while a real path beside it in the same source survives', extractWatchHints("const H = 'application/json'; const P = 'packages/spec/src';").includes('packages/spec/src'));
  // The two families the card named, read from the REAL sources. A fixture
  // cannot show that these particular gates were repaired — the literal has to
  // be gone from the file the derivation actually reads.
  const misparsedFamilySources = ['scripts/release-github-releases.mjs', 'scripts/check-skill-frame-freshness.mjs'];
  for (const rel of misparsedFamilySources) {
    const famHints = extractWatchHints(readFileSync(join(ROOT, rel), 'utf8'), rel);
    t(`${rel} no longer declares a phantom population`, !famHints.some(isNonPathNamespace));
  }
  // The live pin that the repair CHANGED the verdict: neither family may sit in
  // the real tree's unreachable set any more. Measured, not assumed — both
  // turned out to have had the phantom as their ONLY hint, so both land in
  // `undetermined` ("names no path at all"), which is the honest bucket.
  const liveSweepEntries = [];
  for (const rel of misparsedFamilySources) {
    liveSweepEntries.push([rel, fam(extractWatchHints(readFileSync(join(ROOT, rel), 'utf8'), rel))]);
  }
  t('the repaired families declare no population at all, so the sweep skips them', unreachableFamilies([...liveSweepEntries, ['check:anchor', fam(['packages/spec/src'])]], liveCorpus).length === 0);
  // The same live pin for the @-scope refusal (#13312): the two families whose
  // ENTIRE population was a package-name ledger — the shape os-elon's comment
  // measured — must be out of the unreachable listing, landed in `undetermined`
  // rather than renamed into a different phantom.
  const packageLedgerFamilySources = ['scripts/check-driver-memory-census.mjs', 'scripts/check-test-completeness.mjs'];
  const ledgerSweepEntries = [];
  for (const rel of packageLedgerFamilySources) {
    const famHints = extractWatchHints(readFileSync(join(ROOT, rel), 'utf8'), rel);
    t(`${rel} no longer declares a phantom package-name population`, !famHints.some((h) => h.startsWith('@')));
    ledgerSweepEntries.push([rel, fam(famHints)]);
  }
  t(
    'the package-ledger families left the unreachable listing — the phantom is gone, not renamed',
    unreachableFamilies([...ledgerSweepEntries, ['check:anchor', fam(['packages/spec/src'])]], liveCorpus).length === 0,
  );

  // ── The unreachable listing prints by DEFAULT (#10097, option A) ──────────
  //
  // The disclosure existed; the reason to look did not. These pin the shape of
  // the default section and the class split that keeps a real miss from being
  // buried among the standing facts.
  t('a population that never was a path is unreachable BY CONSTRUCTION', unreachableClass([{ hint: 'application/json', deepest: '' }]) === 'by construction');
  t('so is one the covering rule refuses as too generic', unreachableClass([{ hint: 'examples', deepest: 'examples' }]) === 'by construction');
  t('a tree that stops at a shorter prefix is a LAYOUT MOVE — a real miss, not a standing fact', unreachableClass([{ hint: 'packages/spec/src/legacy/**', deepest: 'packages/spec/src' }]) === 'layout moved');
  t('one moved hint among by-construction ones still reads as a layout move', unreachableClass([{ hint: 'application/json', deepest: '' }, { hint: 'packages/spec/src/legacy/**', deepest: 'packages/spec/src' }]) === 'layout moved');

  const listed = unreachableLines(sweep, treeFixture.length);
  const listedText = listed.join('\n');
  // Three, not four: the fixture's extensionless family stopped being
  // unreachable when #12514 taught the matcher to follow a dropped extension.
  // The corpus size beside it is `treeFixture.length` and did not move.
  t('the listing heading carries the count and the corpus it swept', /3 famil\(ies\).*swept over 4 tracked file\(s\)/.test(listed[0]));
  // Re-pointed by #12956, not weakened: the ⛔ correction is still asserted, and
  // so is the sentence that used to carry it. What moved is that "CI runs these
  // on every pull request" became a per-entry fact once a job filter could
  // schedule an unreachable family — see the two cases below for the split.
  t('⛔ and states plainly that this is not a skip list — the one wrong reading', /NOT a skip list/.test(listedText));
  t('and that CI still schedules them on every PR, which is what makes the wrong reading wrong', /CI schedules (?:those|it) on EVERY pull request/.test(listedText));
  t(
    'with no job filter in the fixture, the listing says so of EVERY entry rather than counting exceptions',
    /Every one of them also sits outside any path filter/.test(listedText)
      && !/Nonetheless SCHEDULED/.test(listedText),
  );
  // The other branch: an unreachable family whose JOB carries a resolvable
  // filter is scheduled from a path population, so the blanket claim above is
  // false of it. Both halves are pinned — the count line and the per-entry mark
  // — because a count with no marked entry sends a reader looking for one.
  const scheduledSweep = sweep.map((u, i) => (i === 0
    ? { ...u, entry: { ...u.entry, jobFilters: [{ workflow: 'ci.yml', job: 'test', name: 'Test Core', outputs: ['filter.core'], paths: ['packages/**'], dropped: 0 }] } }
    : u));
  const scheduledText = unreachableLines(scheduledSweep, treeFixture.length).join('\n');
  t('a scheduled unreachable family is COUNTED as the exception it is', /Nonetheless SCHEDULED from a path population: 1 of the 3/.test(scheduledText));
  t('and the entry itself says which job schedules it', /SCHEDULED by 'Test Core' in ci\.yml/.test(scheduledText));
  t('while the blanket every-PR claim is withdrawn for the set that has one', !/Every one of them also sits outside any path filter/.test(scheduledText));
  t('the layout-moved family prints under its own heading', /THE LAYOUT MOVED under a gate that still spells the old path/.test(listedText));
  t('and the by-construction families under theirs', /unreachable BY CONSTRUCTION/.test(listedText));
  t('the real miss sorts BEFORE the standing facts, never buried among them', listedText.indexOf('THE LAYOUT MOVED') < listedText.indexOf('BY CONSTRUCTION'));
  t('every swept family is named in the listing, runnably', sweep.every((u) => listedText.includes(runnableInvocation(u.entry))));
  t('each entry still carries the reason it could not reach', /never was a repo path/.test(listedText) && /the tree HAS it/.test(listedText));
  // The empty case must not print as a missing section, and the corpus size is
  // required for the #4690 reason one level down.
  const emptyListing = unreachableLines([], 4).join('\n');
  t('an EMPTY unreachable set still prints a section, saying so in words', /0 famil\(ies\)/.test(emptyListing) && /every declaring family reaches something/.test(emptyListing));
  let listingNeedsCorpus = false;
  try {
    unreachableLines([], 0);
  } catch {
    listingNeedsCorpus = true;
  }
  t('the listing refuses to render without the corpus it swept', listingNeedsCorpus);

  // ── The residue accounting (#8632) ────────────────────────────────────────
  //
  // Two properties, both of which the deleted prose lacked: it accounts for
  // every discovered family, and it names no gate. The second is the one that
  // rots — a hand-written list of gate names in this paragraph is exactly what
  // was wrong with it — so it is asserted directly rather than by inspection.
  const residue = residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
  t('the residue summary states the discovered total', residue.some((l) => l.includes('98')));
  t('the residue summary states each bucket', residue.some((l) => l.includes('35 undetermined')) && residue.some((l) => l.includes('55 silent')));
  t('the residue summary points at the flag that lists the unplaced families', residue.some((l) => l.includes('--residue') && l.includes('90')));
  t('the residue summary names NO gate — the property the deleted prose lacked', !/check:[\w:-]+/.test(residue.join('\n')));
  // The silence split (#10784). The summary must SIZE the inverted part of
  // `silent`, not only describe the weak part in prose, and it must say so
  // differently when none of the rosters touches the caller's paths — a
  // constant sentence would be a line the reader learns to skip.
  t('the residue summary sizes the artifact rosters inside silent', residue.some((l) => l.includes('4 of those 55')));
  t('and calls out the ones whose roster sits where the card is', residue.some((l) => l.includes('For 1 of them') && l.includes('EITHER direction')));
  const noInverted = residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 0 });
  t('with none of them there it says THAT instead, rather than printing the warning at zero', noInverted.some((l) => l.includes('None of their rosters')) && !noInverted.join('\n').includes('EITHER direction'));
  // The same rot, one noun over (#10012). The top-level-FILE clause used to
  // illustrate the unreachable class with `README.md`, which was honest until
  // that gate declared `README.md/**` — after which the sentence offered, as
  // its example of a population nothing can reach, the one root file in this
  // repo that a card DOES derive. A specimen here is a claim about the tree
  // that this function has no way to keep true; the escape hatch is the half
  // that cannot go stale, because it restates the rule rather than the tree.
  // The first pin holds only the literal that actually rotted — a future
  // specimen spelled some other way would slip it, which is why the second
  // pin, that the durable half is present at all, is the load-bearing one.
  t('the residue names no repo-root file as an unreachable specimen', !residue.join('\n').includes('README.md'));
  t('and states the escape hatch instead, which restates the rule and cannot rot', residue.some((l) => l.includes('subtree spelling')));
  t('the residue summary still names the convention KINDS it derives', residue.some((l) => l.includes('adds or edits a test file')));
  // The schedule half (#9171). The count is the size of the answer this
  // derivation cannot give — families CI runs on every PR — and printing it is
  // what stops that from being an absence the reader never sees.
  t('the residue summary sizes the unfiltered-workflow families', residue.some((l) => l.includes('80 of the 98')));
  t('and says what their bucket verdict does NOT mean', residue.some((l) => l.includes('EVERY pull request')));
  // The partition must be a partition. A fourth bucket added to classifyEntry
  // and not wired into the summary would otherwise shrink the residue silently,
  // which is the failure class this whole card is about.
  let refused = false;
  try {
    residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 54, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
  } catch {
    refused = true;
  }
  t('a partition that does not account for every discovered family is REFUSED', refused);
  // ...and the schedule count is not allowed to go missing quietly either: an
  // omitted count would render as a line with `undefined` in it, which reads as
  // a derivation rather than as the absent measurement it is.
  let refusedUnfiltered = false;
  try {
    residueLines({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 1 });
  } catch {
    refusedUnfiltered = true;
  }
  t('an omitted unfiltered-workflow count is REFUSED, never printed as undefined', refusedUnfiltered);
  // The third verdict is held to the same standard, and its corpus size with
  // it: "0 unreachable" and "the sweep matched nothing at all" print alike
  // unless the number of files swept is beside the count (#4690).
  t('the residue summary sizes the unreachable families', residue.some((l) => l.includes('5 of the 98') && l.includes('reaches NOTHING')));
  t('and states the corpus it swept, so a zero can be told from a broken scan', residue.some((l) => l.includes('6000 tracked file(s)')));
  const refusedFor = (args) => {
    try {
      residueLines(args);
      return false;
    } catch {
      return true;
    }
  };
  t(
    'an omitted unreachable count is REFUSED, never printed as undefined',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, swept: 6000, artifactRosters: 4, invertedRosters: 1 }),
  );
  t(
    'an unreachable count with NO corpus size is REFUSED — the number is unreadable without it',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, artifactRosters: 4, invertedRosters: 1 }),
  );
  t(
    'a sweep that swept zero files is REFUSED at the summary too, not printed as a clean repo',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 0, swept: 0, artifactRosters: 4, invertedRosters: 1 }),
  );
  t(
    'zero unreachable over a real corpus is a legitimate answer, not a refusal',
    !refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 0, swept: 6000, artifactRosters: 4, invertedRosters: 1 }),
  );
  // The silence split is held to the same standard as the counts above: it is
  // a SUBSET count, so both directions of the subsetting are refused rather
  // than trusted, and an omitted one must not print as `undefined`.
  t(
    'an omitted artifact-roster count is REFUSED, never printed as undefined',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, invertedRosters: 0 }),
  );
  t(
    'a roster count larger than the silent bucket it subsets is REFUSED',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 56, invertedRosters: 0 }),
  );
  t(
    'and an inverted count larger than the rosters it subsets is REFUSED',
    refusedFor({ discovered: 98, documentedNoPopulation: 0, matched: 8, undetermined: 35, silent: 55, unfiltered: 80, unreachable: 5, swept: 6000, artifactRosters: 4, invertedRosters: 5 }),
  );

  // ── The families a changeset will add (#10309) ────────────────────────────
  //
  // The measured defect: over one round of five dispatches, every dev's
  // re-derivation was longer than the PM's list by the SAME five families, and
  // on two of the five cards those five were the whole delta. They are
  // changeset-triggered, and the changeset does not exist when the PM derives.
  //
  // These cases pin the property rather than the five names. The fixtures below
  // invent gates this repo does not have — including a SIXTH changeset-
  // triggered family — because the one thing this section must never become is
  // a table: a hand-maintained list would pass a test written against today's
  // five and go quietly wrong on the day a sixth lands, which is the failure
  // mode the whole file is built against. A fixture family the script has never
  // heard of appearing in the output is the only assertion that can tell a
  // probe from a list.
  const csFam = (check, hints, extra = {}) => [
    check,
    { check, filter: null, direct: false, workflows: new Set(['lint.yml']), files: [], hints, triggers: [], ...extra },
  ];
  const csEntries = [
    csFam('check:invented-changeset-gate', ['.changeset']),
    csFam('check:invented-sixth-changeset-gate', ['.changeset/**']),
    csFam('check:invented-pre-mode-gate', ['.changeset/pre.json']),
    csFam('check:invented-unrelated-gate', ['packages/objectql/src']),
    csFam('check:invented-undetermined-gate', []),
  ];
  const pending = pendingChangesetFamilies(csEntries, new Set());
  const pendingNames = pending.map((p) => p.check);
  t('a family whose source names the changeset dir is pending for a card that has none yet', pendingNames.includes('check:invented-changeset-gate'));
  t(
    'a SIXTH changeset-triggered family the script has never heard of is pending too — the section is a probe, not a list',
    pendingNames.includes('check:invented-sixth-changeset-gate'),
  );
  // Coverage, not a name match: a gate that reads only the pre-mode file lives
  // in the changeset directory and is NOT moved by a new changeset. Widening
  // the probe to "mentions the changeset dir" would fabricate this lead in the
  // section a dispatch prompt pastes.
  t('a family naming only the pre-mode file is NOT pending — a new changeset is not that file', !pendingNames.includes('check:invented-pre-mode-gate'));
  t('a family naming an unrelated tree is NOT pending', !pendingNames.includes('check:invented-unrelated-gate'));
  t('nor is one whose source names no path at all — undetermined is not pending', !pendingNames.includes('check:invented-undetermined-gate'));
  t('and the probe path itself is the hypothetical one, never a file on disk', !existsSync(join(ROOT, CHANGESET_PROBE_PATH)));
  // The subtraction: when the input really carries a changeset these families
  // are in the matched list already, and printing them twice would make two
  // sections claim different things about the same lead.
  const pendingAfterMatch = pendingChangesetFamilies(csEntries, new Set(['check:invented-changeset-gate']));
  t(
    'a family the matched list already printed is subtracted, never printed twice',
    !pendingAfterMatch.map((p) => p.check).includes('check:invented-changeset-gate'),
  );
  t('and subtraction leaves exactly the remainder, not the whole section', pendingAfterMatch.map((p) => p.check).includes('check:invented-sixth-changeset-gate'));
  // CI's own trigger reaches the probe too — the section asks the same question
  // of both authorities the matched list does, not of watch hints alone.
  const csTriggered = pendingChangesetFamilies(
    [csFam('check:invented-trigger-gate', [], { triggers: [{ workflow: 'invented.yml', paths: ['.changeset/**'] }] })],
    new Set(),
  );
  t('a family CI SCHEDULES for a changeset is pending on the trigger alone, with no watch hint', csTriggered.length === 1);
  // Optional-chained on purpose: an implementation that stops finding this
  // family must REDDEN this case, not throw out of the harness before the rest
  // of the suite runs (measured while ablating the probe into a hand list).
  t('and its provenance says so, rather than claiming a source literal', csTriggered[0]?.hits?.[0]?.via?.startsWith('CI trigger in') === true);
  // Rendering.
  const pendingOut = pendingChangesetLines(pending);
  t('the section heading counts the families and carries the docs-only escape', /^Once a changeset exists, 2 more famil\(ies\) apply — write one unless this card is docs-only:$/.test(pendingOut[0]));
  t('every row is a RUNNABLE invocation, the same as the matched list', pendingOut.filter((l) => l.startsWith('  - ')).every((l) => l.startsWith('  - pnpm ') || l.startsWith('  - node ')));
  t('every row prints the hypothetical path it would match, so the lead cannot read as a real one', pendingOut.filter((l) => l.startsWith('  - ')).every((l) => l.includes(CHANGESET_PROBE_PATH)));
  t('the section says out loud that it is not a fourth bucket', pendingOut.some((l) => l.includes('NOT a fourth bucket')));
  t('and that the dev writes the changeset AFTER this derivation runs — the temporal gap is the point', pendingOut.some((l) => l.includes('written by the DEV, after this derivation runs')));
  t('an empty pending set renders NOTHING — no zero heading to send a reader looking', pendingChangesetLines([]).length === 0);

  // ── The model-tier derivation (#8640) ─────────────────────────────────────
  //
  // The incident these originally pinned: a surface containing a pm-dispatch
  // REFERENCES file was claimed as "not under the fable-mandatory roots" and
  // dispatched at opus — nothing mechanical compared the claim to the globs.
  // The 2026-08-20 narrowing then made references paths genuinely non-mandatory
  // (opus execution, compensated by the fable-tier skill-face review), so the
  // references pin is now asserted in the OPPOSITE direction; the incident's
  // lesson — derive, never recall — is what survives unchanged. Every
  // direction is asserted: each protocol-semantic file, the references half
  // that dropped out, a mixed surface where ordinary paths must not dilute the
  // mandate, and the ordinary surface that must NOT be mandated (a tool that
  // mandates everything is ignored, which loses the guardrail by the other road).
  const fableOf = (paths) => deriveTier(paths);
  t('the pm-dispatch SKILL.md MAIN file is fable-mandatory', fableOf(['.claude/skills/pm-dispatch/SKILL.md']).tier === 'claude-fable-5');
  t('the dev-agent definition is fable-mandatory', fableOf(['.claude/agents/os-dev.md']).tier === 'claude-fable-5');
  t('the published PM skill (two enforced frame copies) is fable-mandatory', fableOf(['skills/objectstack-pm-dispatch/SKILL.md']).tier === 'claude-fable-5');
  t('a pm-dispatch REFERENCES path carries NO path mandate — the 2026-08-20 narrowing, inverted from the pre-narrowing pin', fableOf(['.claude/skills/pm-dispatch/references/review-checklist.md']).mandatory === false);
  const mixed = fableOf(['packages/spec/src/data/filter.zod.ts', '.claude/agents/os-dev.md']);
  t('a MIXED surface is mandatory — one mandatory path decides, ordinary paths do not dilute it', mixed.mandatory && mixed.tier === 'claude-fable-5');
  t('the mixed verdict reports the offending path, not just the verdict', mixed.hits.length === 1 && mixed.hits[0].path.endsWith('.claude/agents/os-dev.md'));
  t('an ordinary surface carries no path-derived mandate', fableOf(['packages/spec/src/data/filter.zod.ts']).mandatory === false);
  t("this tool's own file is not mandatory — the card that added this section reads itself correctly", fableOf(['scripts/pm/dispatch-gates.mjs']).mandatory === false);
  // Segment boundaries, both directions of the shared matcher's asymmetry.
  t('a sibling directory sharing a name PREFIX is not mandated', fableOf(['.claude/skills/pm-dispatchers/notes.md']).mandatory === false);
  t('a bare string PREFIX of a mandatory file is not an ancestor of it, and is not mandated', fableOf(['.claude/skills/pm-disp']).mandatory === false);
  t('a surface declared as an ANCESTOR of a mandatory file IS mandated — the safe direction here', fableOf(['.claude/skills']).mandatory === true);
  t('the pm-dispatch DIRECTORY (ancestor of its SKILL.md) is mandated — a card declaring the directory may touch the main file', fableOf(['.claude/skills/pm-dispatch']).mandatory === true);
  t('another skill under the same parent is not mandated', fableOf(['.claude/skills/verify/SKILL.md']).mandatory === false);
  // The rendering is where the invariant is actually delivered: the claim
  // comment quotes THESE lines.
  const mandLines = tierLines(mixed).join('\n');
  t('the mandatory rendering names the tier', mandLines.includes('claude-fable-5'));
  t('the mandatory rendering says MANDATORY in a word a reader cannot skim past', mandLines.includes('MANDATORY'));
  t('the mandatory rendering shows its provenance — the path and the glob that covered it', mandLines.includes("- .claude/agents/os-dev.md ⇢ '.claude/agents/os-dev.md'"));
  t('the mandatory rendering names every sanctioned exit, so a downgrade needs a stated reason', mandLines.includes('quota exemption') && mandLines.includes('opus, never lower') && mandLines.includes('one-line-class') && mandLines.includes('proactive low-headroom'));
  t('the mechanical-edit exit names its compensating control from the single-source constant', mandLines.includes(`skill-face review at ${CONTRACT_REVIEW_TIER}`));
  const plainLines = tierLines(fableOf(['packages/spec/src/data/filter.zod.ts'])).join('\n');
  t('the no-mandate rendering claims no mandate', !plainLines.includes('MANDATORY'));
  t('the no-mandate rendering names the floor and the default, so the judgment call has its band', plainLines.includes(TIER_FLOOR) && plainLines.includes(TIER_DEFAULT));
  t('BOTH renderings state that clause ② is out of reach of paths — a no-mandate line is not a clearance', plainLines.includes('Clause ②') && mandLines.includes('Clause ②'));
  t('the no-mandate rendering says how many globs it checked, so an empty table cannot read as a clearance', plainLines.includes(`${MANDATORY_TIER_GLOBS.length} declared glob`));
  // Refusals: a contradiction is not printed, and an ambiguity is not guessed.
  let tierRefused = false;
  try {
    tierLines({ mandatory: false, tier: null, hits: [{ path: 'x', glob: 'y', why: 'z' }], declared: 1 });
  } catch {
    tierRefused = true;
  }
  t('a verdict with a hit but no mandate is REFUSED, never rendered', tierRefused);
  let ambiguityRefused = false;
  try {
    deriveTier(['.claude/skills/pm-dispatch/SKILL.md'], [
      { glob: '.claude/skills/pm-dispatch/**', tier: 'claude-fable-5', why: 'a' },
      { glob: '.claude/skills/**', tier: 'opus', why: 'b' },
    ]);
  } catch {
    ambiguityRefused = true;
  }
  t('two globs mandating DIFFERENT tiers for one surface are REFUSED, not guessed between', ambiguityRefused);
  // Live guards. A glob naming a path this tree does not have is dead data that
  // mandates nothing while reading as protection — the incident class itself.
  t('the mandatory table is not empty (the guard below is not vacuous)', MANDATORY_TIER_GLOBS.length > 0);
  const deadGlobs = MANDATORY_TIER_GLOBS.filter(
    (g) => !existsSync(join(ROOT, g.glob.replace(/\*\*?/g, '').replace(/\/+$/, ''))),
  );
  t(`every declared mandatory glob names a path this tree really has (dead: ${deadGlobs.map((g) => g.glob).join(', ') || 'none'})`, deadGlobs.length === 0);
  t('every declared glob carries the tier it mandates and a reason', MANDATORY_TIER_GLOBS.every((g) => g.glob && g.tier && g.why));
  t('the incident file is a real file, so the references NON-mandate is a live claim and not a fixture', existsSync(join(ROOT, '.claude/skills/pm-dispatch/references/review-checklist.md')));
  // The frame-copy half of the mandate is DEFINED by check:skill-frame-sync's
  // COPIES table (the 2026-08-20 ruling's own wording), so the coupling is
  // pinned mechanically: a copy added to that gate without a matching mandate
  // glob here would be exactly the prose-recall drift this section exists
  // against. Spawned rather than imported — selfTest is synchronous, and the
  // probe also proves the module stays import-safe from a cold process.
  const frameProbe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'scripts/check-skill-frame-sync.mjs')).href)}); console.log(JSON.stringify([...new Set(m.COPIES.map((c) => c.file))]));`,
    ],
    { encoding: 'utf8', cwd: ROOT },
  );
  let frameFiles = [];
  try {
    frameFiles = JSON.parse((frameProbe.stdout ?? '').trim());
  } catch {
    /* frameFiles stays empty and the cases below fail loudly */
  }
  t('the frame-sync COPIES table is readable and non-empty, so the pin below is not vacuous', frameProbe.status === 0 && Array.isArray(frameFiles) && frameFiles.length > 0);
  t(`every frame-sync-enforced copy is fable-mandated (unmandated: ${frameFiles.filter((f) => !deriveTier([f]).mandatory).join(', ') || 'none'})`, frameFiles.length > 0 && frameFiles.every((f) => deriveTier([f]).tier === 'claude-fable-5'));
  t('the SKILL.md main file and the dev-agent definition are declared in their own right, not only via the frame table', MANDATORY_TIER_GLOBS.some((g) => g.glob === '.claude/skills/pm-dispatch/SKILL.md') && MANDATORY_TIER_GLOBS.some((g) => g.glob === '.claude/agents/os-dev.md'));

  // ── Clause-② suspicion (the enqueue-gate card): hit / no hit / wording ────
  //
  // The wording cases are not decoration — the suspicion line is quoted into
  // claim comments, and its one invariant is that a HINT must not be readable
  // as a verdict (nor harden the no-mandate line into a clearance).
  const suspectHit = fableOf(['packages/spec/src/api/error-code-ledger.zod.ts']);
  t('a spec contract path is a clause-② SUSPECT, with its provenance recorded', suspectHit.suspects.length === 1 && suspectHit.suspects[0].glob === 'packages/spec/src/**');
  t('a suspect is NOT a mandate — suspicion must not harden into a path verdict', suspectHit.mandatory === false && suspectHit.tier === null);
  const suspectRendered = tierLines(suspectHit).join('\n');
  t('the suspicion rendering says SUSPECT and names the offending path', suspectRendered.includes('SUSPECT') && suspectRendered.includes('packages/spec/src/api/error-code-ledger.zod.ts'));
  t('the suspicion rendering is a hint, not a verdict, in those words', suspectRendered.includes('a hint, not a verdict'));
  t('the suspicion rendering sends the seat to the card CONTENT for the tier call', suspectRendered.includes('judge the tier from the card CONTENT'));
  t('the suspicion rendering routes EVERY dispatch through the enqueue gate on the ACTUAL diff', suspectRendered.includes('whichever tier is dispatched') && suspectRendered.includes('enqueue gate'));
  t('the suspicion rendering names the contract-review tier from its single-source constant', suspectRendered.includes(CONTRACT_REVIEW_TIER));
  const noSuspicion = fableOf(['packages/runtime/src/kernel.ts']);
  t('an ordinary non-contract surface raises no suspicion', noSuspicion.suspects.length === 0);
  t('no suspicion ⇒ no suspect line — absence and clearance must not share a spelling with a hit', !tierLines(noSuspicion).join('\n').includes('SUSPECT'));
  const mandatedAndSuspect = fableOf(['.claude/skills/pm-dispatch/SKILL.md', 'packages/spec/src/data/filter.zod.ts']);
  t('a mandated surface still prints its suspect paths — the enqueue gate reads diffs, not dispatch tiers', mandatedAndSuspect.mandatory && mandatedAndSuspect.suspects.length === 1 && tierLines(mandatedAndSuspect).join('\n').includes('SUSPECT'));
  t('a verdict built without a suspects field still renders (suspicion defaults empty)', tierLines({ mandatory: false, tier: null, hits: [], declared: 1 }).length === 3);
  // Same liveness guards as the mandatory table: dead data reading as
  // protection is the incident class itself.
  const deadSuspects = SUSPECT_TIER_GLOBS.filter(
    (g) => !existsSync(join(ROOT, g.glob.replace(/\*\*?/g, '').replace(/\/+$/, ''))),
  );
  t(`every declared suspect glob names a path this tree really has (dead: ${deadSuspects.map((g) => g.glob).join(', ') || 'none'})`, deadSuspects.length === 0);
  t('the suspect table is not empty and every entry carries its reason', SUSPECT_TIER_GLOBS.length > 0 && SUSPECT_TIER_GLOBS.every((g) => g.glob && g.why));
  t('the contract-review tier constant is a non-empty model id — the single source the PM skill points at', typeof CONTRACT_REVIEW_TIER === 'string' && CONTRACT_REVIEW_TIER.length > 0);

  // ── The change set derived from git (#9320) ───────────────────────────────
  //
  // These build a real repository and run the real derivation over it. A
  // fixture cannot stand in: the whole claim is about what a git RANGE means
  // when history moved underneath a branch, and that is a property of git, not
  // of a string this file could parse. Each scenario is built once and the
  // cases read from it, so the git cost is three small repos, not one per case.
  //
  // The control case is the load-bearing one. Asserting only that the sibling's
  // file is absent from the derived set would pass just as happily against a
  // fixture that never reproduced the incident — so the same tree is diffed the
  // WRONG way in the same breath, and the sibling has to show up there.
  const gitTmp = mkdtempSync(join(tmpdir(), 'dispatch-gates-git-'));
  try {
    const g = (args, cwd) => {
      const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
        cwd,
        encoding: 'utf8',
      });
      if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
      return (r.stdout ?? '').trim();
    };
    const write = (repo, rel, text) => {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), text);
    };
    const commit = (repo, rel, msg) => {
      write(repo, rel, `${msg}\n`);
      g(['add', '-A'], repo);
      g(['commit', '-m', msg], repo);
    };

    // Scenario: branch cut, THEN a sibling PR lands on the base branch.
    const up = join(gitTmp, 'up');
    mkdirSync(up, { recursive: true });
    g(['init', '--initial-branch=main', '.'], up);
    commit(up, 'packages/spec/base.ts', 'root');
    commit(up, 'packages/spec/branch-point.ts', 'branch point');
    g(['checkout', '-b', 'feature'], up);
    commit(up, 'packages/objectql/mine.ts', 'my own work');
    g(['checkout', 'main'], up);
    commit(up, 'packages/runtime/sibling-landed.ts', 'a sibling PR lands after the cut');
    const mainSha = g(['rev-parse', 'main'], up);
    g(['checkout', 'feature'], up);
    // A local ref named like the remote-tracking one, so the derivation runs
    // against the exact ref name it uses in anger without needing a network.
    g(['update-ref', 'refs/remotes/origin/main', mainSha], up);

    const derived = changedPathsFromGit({ cwd: up });
    const twoDot = g(['diff', '--name-only', 'origin/main..HEAD'], up).split('\n').filter(Boolean);

    t(
      'the CONTROL reproduces the incident: the two-dot range really does claim the sibling PR file',
      twoDot.includes('packages/runtime/sibling-landed.ts'),
    );
    t(
      'the derived change set names this branch own commit',
      derived.paths.includes('packages/objectql/mine.ts'),
    );
    t(
      'the derived change set drops the sibling file the two-dot range attributed to us',
      !derived.paths.includes('packages/runtime/sibling-landed.ts'),
    );
    t('the derived set reports the merge base it measured from', /^[0-9a-f]{40}$/.test(derived.mergeBase));

    // Uncommitted and untracked work counts: a dev re-deriving before the
    // commit must not be handed a SHORT list.
    write(up, 'packages/spec/base.ts', 'edited, not committed\n');
    write(up, 'packages/ddd/brand-new.ts', 'never added\n');
    const withDirty = changedPathsFromGit({ cwd: up });
    t('an uncommitted edit to a tracked file joins the change set', withDirty.paths.includes('packages/spec/base.ts'));
    t('an untracked new file joins the change set', withDirty.paths.includes('packages/ddd/brand-new.ts'));
    t('the sibling file stays out once the tree is dirty too', !withDirty.paths.includes('packages/runtime/sibling-landed.ts'));

    // A branch that changes nothing derives an EMPTY set rather than the
    // base branch history — the CLI turns that into a refusal, not "no gates".
    const onBase = join(gitTmp, 'on-base');
    mkdirSync(onBase, { recursive: true });
    g(['init', '--initial-branch=main', '.'], onBase);
    commit(onBase, 'packages/spec/only.ts', 'root');
    g(['update-ref', 'refs/remotes/origin/main', g(['rev-parse', 'main'], onBase)], onBase);
    t('a branch level with its base derives nothing at all', changedPathsFromGit({ cwd: onBase }).paths.length === 0);

    // The shallow boundary. Measured, not assumed: with the true base below the
    // graft, merge-base exits 1 EMPTY and the three-dot diff exits 128, while
    // the two-dot form exits 0 with the inflated list. So the derivation must
    // refuse — and must not quietly become the two-dot form it replaced.
    const shallow = join(gitTmp, 'shallow');
    spawnSync('git', ['clone', '--quiet', '--no-single-branch', '--depth', '1', `file://${up}`, shallow], { encoding: 'utf8' });
    let shallowErr = null;
    if (existsSync(join(shallow, '.git'))) {
      g(['checkout', '-B', 'feature', 'origin/feature'], shallow);
      t('the shallow fixture really is a shallow checkout', g(['rev-parse', '--is-shallow-repository'], shallow) === 'true');
      try {
        changedPathsFromGit({ cwd: shallow });
      } catch (err) {
        shallowErr = err;
      }
      t('a shallow checkout with no reachable merge base REFUSES instead of answering', shallowErr !== null);
      t(
        'and the refusal names the shallow cause and the deepen remedy',
        !!shallowErr && /SHALLOW/.test(shallowErr.message) && /unshallow|deepen/.test(shallowErr.message),
      );
      t(
        'and it says why it will not fall back to the two-dot range',
        !!shallowErr && /two-dot/.test(shallowErr.message),
      );
    }

    // An unresolvable base ref is the other input failure, and it must be told
    // apart from "no merge base" — the remedies are different commands.
    let missingBaseErr = null;
    try {
      changedPathsFromGit({ cwd: up, base: 'refs/remotes/origin/no-such-branch' });
    } catch (err) {
      missingBaseErr = err;
    }
    t('an unresolvable base ref is refused on its own terms', !!missingBaseErr && /does not resolve/.test(missingBaseErr.message));

    // ── A leftover in-tree test fixture must not reach the change set (#12632)
    //
    // The derivation reads untracked files on purpose, so `.gitignore` is the
    // only thing standing between a killed test run's leftover fixture and
    // every seat's gate list. `packages/cli` creates four fixtures inside the
    // tracked tree; the one that used to root in `packages/cli/test/` needed an
    // ignore entry written for it alone, and now roots at `packages/cli/tmp/`
    // with the other three, under the repo-wide `tmp/` rule.
    //
    // The CONTROL is the load-bearing half and it runs the SAME derivation on
    // the SAME repo: asserting only that the covered path is absent would pass
    // just as happily against a `.gitignore` that ignores the whole tree, or
    // against a fixture that never planted anything. So an UNCOVERED in-tree
    // path is planted alongside it and has to come back VISIBLE, and it has to
    // come back carrying gate families — a leftover that reached the change set
    // is not inert. Measured on the tree at the time of writing: a two-file
    // leftover (the `package.json` and `objectstack.config.ts` that fixture
    // writes) named 20 families the branch's own diff does not implicate.
    // The count is not asserted — the family inventory grows same-day, which is
    // this whole tool's premise — only that it is non-empty.
    //
    // The uncovered path is deliberately the fixture's FORMER root, so this
    // control also fails if the bespoke ignore entry is ever restored: a rule
    // covering a root nothing uses would make the control silently green and
    // take the pin with it.
    //
    // The repo's REAL `.gitignore` is copied in rather than an excerpt written
    // here: an excerpt would pin the excerpt.
    const ignoreRepo = join(gitTmp, 'ignore-coverage');
    mkdirSync(ignoreRepo, { recursive: true });
    g(['init', '--initial-branch=main', '.'], ignoreRepo);
    write(ignoreRepo, '.gitignore', readFileSync(join(ROOT, '.gitignore'), 'utf8'));
    g(['add', '-A'], ignoreRepo);
    g(['commit', '-m', 'the real ignore rules'], ignoreRepo);
    g(['update-ref', 'refs/remotes/origin/main', g(['rev-parse', 'main'], ignoreRepo)], ignoreRepo);

    const leftoverAtCoveredRoot = 'packages/cli/tmp/tmp-node-env-default-selftest/objectstack.config.ts';
    const leftoverAtUncoveredRoot = 'packages/cli/test/tmp-node-env-default-selftest/objectstack.config.ts';
    for (const rel of [leftoverAtCoveredRoot, leftoverAtUncoveredRoot]) {
      write(ignoreRepo, rel, "import { AuthPlugin } from '@objectstack/plugin-auth';\n");
      write(ignoreRepo, join(dirname(rel), 'package.json'), '{ "private": true, "type": "module" }\n');
    }
    const leftovers = changedPathsFromGit({ cwd: ignoreRepo });

    t(
      'the CONTROL reproduces the hazard: a leftover fixture at an UNCOVERED in-tree root does reach the change set',
      leftovers.paths.includes(leftoverAtUncoveredRoot),
    );
    t(
      'and reaching it is not free — the uncovered leftover names gate families of its own',
      [...discoverFamilies().byCheck.values()].some((e) => classifyEntry(e, [leftoverAtUncoveredRoot]).verdict === 'matched'),
    );
    t(
      'a leftover fixture at packages/cli/tmp/ is invisible to the derivation, under the same rules in the same repo',
      !leftovers.paths.includes(leftoverAtCoveredRoot),
    );
    t(
      'and it is the repo-wide tmp/ rule doing it, with no bespoke entry for the fixture former root',
      !readFileSync(join(ROOT, '.gitignore'), 'utf8').includes('packages/cli/test/tmp-node-env-default'),
    );
    // ── The CLASS the pin above does not hold (#12749) ──────────────────────
    //
    // Everything above names TWO paths. A fifth fixture author who creates a
    // directory in the tracked tree at a root the ignore rules do not cover
    // reproduces the hazard exactly, and every case above stays green — not one
    // of them ever looks at their file. The cases below hold the class: the
    // tree's own sources are swept for the directories they create, and each is
    // asked about against the repo's REAL ignore rules.
    //
    // ⛔ No count is asserted below. The same hazard has three recorded readings
    // (17 / 18 / 20 families) because the family inventory grows same-day, and a
    // guard pinning a number reds on an unrelated Tuesday. What IS asserted is
    // NON-EMPTINESS: a sweep that found nothing satisfies "every root is
    // covered" perfectly, and would take the whole class-level guard with it.

    // The reader, on sources containing nothing else — hermetic, so a failure
    // here is the reader and not the tree.
    const seededFixtureSource = [
      'const HERE = path.dirname(fileURLToPath(import.meta.url));',
      "const SCRATCH = path.resolve(HERE, '../scratch');",
      'fs.mkdirSync(SCRATCH, { recursive: true });',
      "const dir = fs.mkdtempSync(path.join(SCRATCH, 'case-'));",
    ].join('\n');
    const seededScan = scratchDirSitesInSource('packages/thing/test/a.test.ts', seededFixtureSource);
    t(
      'the scan reads an in-tree fixture root through the binding that seeds it',
      seededScan.inTree.some((s) => s.call === 'mkdirSync' && s.dir === 'packages/thing/scratch'),
    );
    t(
      'and reads the mkdtemp child as a directory of its own, not as its base',
      seededScan.inTree.some((s) => s.call === 'mkdtempSync' && s.dir.startsWith('packages/thing/scratch/case-')),
    );
    t('nothing in that source is left unclassified', seededScan.unresolved.length === 0);

    const systemTempSource = [
      "const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'case-'));",
      "fs.mkdirSync(path.join(scratchDir, 'nested'), { recursive: true });",
    ].join('\n');
    const systemScan = scratchDirSitesInSource('packages/thing/test/b.test.ts', systemTempSource);
    t(
      'a fixture in the system temp directory is no in-tree root, and is not unresolved either',
      systemScan.inTree.length === 0 && systemScan.unresolved.length === 0,
    );

    // The third answer, and the reason silence from this scan can be read at
    // all: a base it cannot resolve is REPORTED. A detector that dropped what
    // it could not read would be this card's own defect one level up — green
    // over the sites nobody measured.
    const opaqueScan = scratchDirSitesInSource(
      'packages/thing/test/c.test.ts',
      "const dir = fs.mkdtempSync(path.join(rootFromSomewhereElse, 'case-'));",
    );
    t(
      'a base the scan cannot read comes back UNRESOLVED, never silently skipped',
      opaqueScan.inTree.length === 0 && opaqueScan.unresolved.length === 1,
    );
    t(
      'and a commented-out call is not a site at all',
      scratchDirSitesInSource('packages/thing/test/d.test.ts', "// fs.mkdtempSync(path.join(HERE, 'case-'));\n").scanned === 0,
    );
    t(
      'nor is one spelled inside a string — which is what this very self-test plants',
      scratchDirSitesInSource('packages/thing/test/e.test.ts', 'const src = "fs.mkdtempSync(join(HERE, x))";\n').scanned === 0,
    );

    // The CONTROL for the whole verdict, on a repo carrying the REAL ignore file
    // — an excerpt would pin the excerpt. Two fixture sources are planted, one
    // at a covered root and one at an uncovered one, and the uncovered one has
    // to come back EXPOSED. Without this arm every live-tree case below passes
    // just as happily against a verdict function that returns an empty list.
    const classRepo = join(gitTmp, 'fixture-root-class');
    mkdirSync(classRepo, { recursive: true });
    g(['init', '--initial-branch=main', '.'], classRepo);
    const realIgnoreRules = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    write(classRepo, '.gitignore', realIgnoreRules);
    const fixtureSourceRootedAt = (rel) =>
      [
        'const HERE = path.dirname(fileURLToPath(import.meta.url));',
        `const SCRATCH = path.resolve(HERE, '${rel}');`,
        'fs.mkdirSync(SCRATCH, { recursive: true });',
        "const dir = fs.mkdtempSync(path.join(SCRATCH, 'case-'));",
      ].join('\n');
    write(classRepo, 'packages/cli/test/covered.test.ts', fixtureSourceRootedAt('../tmp'));
    write(classRepo, 'packages/cli/test/uncovered.test.ts', fixtureSourceRootedAt('../scratch-fixtures'));
    g(['add', '-A'], classRepo);
    g(['commit', '-m', 'two fixture sources under the real ignore rules'], classRepo);

    const uncoveredInControl = (r) => r.exposed.some((s) => s.dir.startsWith('packages/cli/scratch-fixtures'));
    const classControl = exposedScratchDirs({ cwd: classRepo });
    t(
      'the CONTROL reproduces the hazard at CLASS level: a fixture root no ignore rule covers is EXPOSED',
      uncoveredInControl(classControl),
    );
    t(
      'and the covered root beside it is not, under the same rules in the same repo',
      !classControl.exposed.some((s) => s.dir.startsWith('packages/cli/tmp'))
        && classControl.covered.some((s) => s.dir.startsWith('packages/cli/tmp')),
    );

    // A rule in `.git/info/exclude` covers the clone it lives in and nothing
    // else, so it is not coverage: the leftover still joins the change set on
    // every other machine, CI included. `git check-ignore` answers the same
    // either way, which is exactly why the SOURCE of the rule is read.
    write(classRepo, '.git/info/exclude', 'scratch-fixtures/\n');
    t(
      'a rule living only in .git/info/exclude is not coverage — the root stays EXPOSED',
      uncoveredInControl(exposedScratchDirs({ cwd: classRepo })),
    );

    // ... and the same instrument clears it once a TRACKED rule covers it, so
    // what the live cases below read is a reading and not a constant.
    write(classRepo, '.git/info/exclude', '');
    write(classRepo, '.gitignore', `${realIgnoreRules}\nscratch-fixtures/\n`);
    g(['add', '-A'], classRepo);
    g(['commit', '-m', 'cover the new root in the tracked ignore file'], classRepo);
    t(
      'a TRACKED rule covering it clears it, so the verdict moves in both directions',
      exposedScratchDirs({ cwd: classRepo }).exposed.length === 0,
    );

    // The live tree — the half a fifth fixture author's PR reds on.
    const liveScratch = exposedScratchDirs({});
    t(
      `the sweep really read this tree (${liveScratch.sites} directory-creating site(s) across ${liveScratch.scannedFiles} tracked source(s))`,
      liveScratch.sites > 0,
    );
    t(
      `and it really found in-tree fixture roots (${liveScratch.inTree.length}), so the coverage case below judges something`,
      liveScratch.inTree.length > 0,
    );
    t(
      `every in-tree directory this tree's sources create is covered by a tracked ignore rule, or is tracked itself${
        liveScratch.exposed.length
          ? ` — EXPOSED: ${liveScratch.exposed.map((s) => `${s.dir} (${s.file}:${s.line})`).join(', ')}`
          : ''
      }`,
      liveScratch.exposed.length === 0,
    );
    const unreadableTempSites = liveScratch.unresolved.filter((s) => s.call === 'mkdtempSync');
    t(
      `no mkdtempSync site in this tree takes a base the scan cannot read${
        unreadableTempSites.length
          ? ` — UNRESOLVED: ${unreadableTempSites.map((s) => `${s.file}:${s.line} (${s.why})`).join(', ')}`
          : ''
      }`,
      unreadableTempSites.length === 0,
    );
  } finally {
    rmSync(gitTmp, { recursive: true, force: true });
  }

  // ── Whose repo the answer is about — the cross-repo guard ─────────────────
  //
  // The defect this pins is an answer that was RIGHT about the wrong tree, so
  // both directions have to be measured on the real CLI, not reasoned about:
  // a matching assertion must leave the answer byte-identical (otherwise the
  // guard taxes every correct dispatch), and a mismatching one must end the run
  // (otherwise it is the warning that was already measured as ignorable).
  t('a remote in URL form yields its owner and name', parseRepoSlug('https://github.com/an-owner/a-repo.git') === 'an-owner/a-repo');
  t('and in the SCP-like form git also writes', parseRepoSlug('git@github.com:an-owner/a-repo.git') === 'an-owner/a-repo');
  t('a suffixless URL with a trailing slash reads the same', parseRepoSlug('https://github.com/an-owner/a-repo/') === 'an-owner/a-repo');
  t('a remote that does not end in two name segments is UNKNOWN, never a guess', parseRepoSlug('some-bare-word') === null && parseRepoSlug('') === null);

  const splitWithValue = splitArgv([REPO_FLAG, 'an-owner/a-repo', 'packages/spec/src/index.ts', '--residue']);
  t('the assertion value never falls through into the path list', splitWithValue.paths.length === 1 && splitWithValue.paths[0] === 'packages/spec/src/index.ts');
  t('and the assertion and the other flags both survive the split', splitWithValue.assertion === 'an-owner/a-repo' && splitWithValue.flags.includes('--residue'));
  t('the joined spelling parses to the same thing', splitArgv([`${REPO_FLAG}=an-owner/a-repo`]).assertion === 'an-owner/a-repo');
  t('a valueless assertion is malformed, not silently dropped', !!splitArgv([REPO_FLAG]).malformed && !!splitArgv([REPO_FLAG, '--tier']).malformed);
  t('no assertion passed stays null, so the unasserted run is untouched', splitArgv(['packages/spec/src/index.ts']).assertion === null);

  const hereIdentity = { root: '/tmp/x', head: 'abc1234', remote: 'r', slug: 'an-owner/a-repo' };
  t('an assertion this checkout satisfies passes', repoAssertionVerdict({ asserted: 'an-owner/a-repo', identity: hereIdentity }).ok);
  t('and it passes case-insensitively, as repo slugs compare', repoAssertionVerdict({ asserted: 'An-Owner/A-Repo', identity: hereIdentity }).ok);
  const mismatch = repoAssertionVerdict({ asserted: 'other-owner/other-repo', identity: hereIdentity });
  t('an assertion this checkout contradicts is REFUSED', !mismatch.ok);
  const mismatchText = mismatch.lines.join('\n');
  t('and the refusal names BOTH repos — the defect was an answer that named neither', mismatchText.includes('other-owner/other-repo') && mismatchText.includes('an-owner/a-repo'));
  t('the refusal says repo-relative paths cannot tell the two apart', mismatchText.includes('Repo-relative paths cannot tell the two apart'));
  t('and it sends the reader to a checkout of the repo they asked about', mismatchText.includes('hand-derived'));
  const unverifiable = repoAssertionVerdict({ asserted: 'an-owner/a-repo', identity: { root: '/tmp/x', head: null, remote: null, slug: null } });
  t('an assertion that cannot be VERIFIED refuses too — an unverifiable pass is worth less than none', !unverifiable.ok && unverifiable.lines.join('\n').includes('UNKNOWN'));
  const retargetAttempt = repoAssertionVerdict({ asserted: '../a-sister-checkout', identity: hereIdentity });
  t('a value shaped like a checkout PATH is refused, so the retarget misreading fails loudly', !retargetAttempt.ok && retargetAttempt.lines.join('\n').includes('does not point the derivation at another checkout'));
  t('and so is a three-segment value', !repoAssertionVerdict({ asserted: 'a/b/c', identity: hereIdentity }).ok);

  const bannerHit = bannerLines({ identity: hereIdentity, paths: [] });
  t('the banner names the repo and the commit the answer came from', bannerHit[0].includes('an-owner/a-repo') && bannerHit[0].includes('abc1234'));
  t('and it points at the assertion flag, so the tell is actionable', bannerHit.join('\n').includes(REPO_FLAG));
  t('an unreadable remote reads as UNVERIFIED in the banner, never as a repo name', bannerLines({ identity: { root: '/tmp/x', head: null, remote: null, slug: null }, paths: [] }).join('\n').includes('UNVERIFIED'));
  const bannerAbsent = bannerLines({ identity: { ...hereIdentity, root: ROOT }, paths: ['packages/spec/src/index.ts', 'packages/this-repo-has-no-such-package/src/index.ts'] });
  t('paths absent from this tree are counted and named', bannerAbsent.join('\n').includes('1 of 2 path(s) are absent'));
  t('and the count claims nothing in either direction', bannerAbsent.join('\n').includes('Not evidence either way'));
  const bannerPresent = bannerLines({ identity: { ...hereIdentity, root: ROOT }, paths: ['packages/spec/src/index.ts'] });
  t('all paths present prints NO clearance line — absence and clearance must not share a spelling', !bannerPresent.join('\n').includes('absent from this tree') && bannerPresent.length === 2);

  // ── Base drift (#11540) ───────────────────────────────────────────────────
  // The banner names the commit an answer came from; on a stale checkout that
  // reads as ordinary provenance. These pin the loudness, and pin that the
  // quiet cases stay quiet — a warning on every honest run is a warning nobody
  // reads.
  // Unmeasured is not silence (#12411). These pin the ARRIVAL — the sentence a
  // reader actually gets — not merely that the old silence is gone: a pin
  // asserting "the output is not empty" passes against any garbage. The
  // previous assertion here read "no measurable base ref prints nothing rather
  // than guessing" and was green on the defect itself, which is what a
  // departure pin buys you.
  const level = driftLines({ base: 'aaaaaaa', behind: 0, changed: [] });
  const unmeasured = driftLines({ base: null, behind: null, changed: [], headDate: null, baseDate: null });
  const unmeasuredText = unmeasured.join('\n');
  t('an unresolvable base ref SAYS staleness was not measured, and names the ref it could not resolve',
    unmeasuredText.includes('STALENESS NOT MEASURED') && unmeasuredText.includes(DEFAULT_BASE_REF));
  t('and it spells the reading UNKNOWN, so the reader cannot land on zero by default',
    unmeasuredText.includes('UNKNOWN') && unmeasuredText.includes('Not zero'));
  t('it hands over the one action that would produce a reading',
    unmeasuredText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`));
  t('and it does NOT cry stale — a tree nobody measured is not a tree measured stale',
    !unmeasuredText.includes('STALE TREE'));
  t('a tree level with the base prints NO clearance — the failure would have passed one', level.length === 0);
  t('so the two readings no longer share one output — the defect, stated as the comparison that used to hold',
    unmeasuredText !== level.join('\n'));
  t('and a drift of null — no measurement ATTACHED, the caller never asked — still prints nothing', driftLines(null).length === 0);
  // The SECOND door to "no reading was taken" (#12815). The base ref resolves
  // and the DISTANCE is what could not be read, so this reached `!drift.behind`
  // carrying `behind: null` and printed nothing — byte-identical to the level
  // tree above, the same collapse as the case above it, one step further along.
  // These pin the arrival, and pin that ONE predicate serving both doors did
  // not flatten them into one sentence: the remedies do not overlap, so a
  // reader handed the other door's remedy is handed a lead they cannot act on.
  const uncounted = driftLines({ base: 'aaaaaaa', behind: null, changed: [], headDate: null, baseDate: null });
  const uncountedText = uncounted.join('\n');
  t('a base ref that RESOLVES but yields no distance also SAYS staleness was not measured',
    uncountedText.includes('STALENESS NOT MEASURED') && uncountedText.includes('UNKNOWN') && uncountedText.includes('Not zero'));
  t('and it names the base it DID resolve, so a reader can tell WHICH step failed', uncountedText.includes('aaaaaaa'));
  t('its remedy is the count, not the fetch — a fetch buys a base ref and buys nothing for a HEAD with no commit',
    uncountedText.includes(`git rev-list --count HEAD..${DEFAULT_BASE_REF}`)
      && !uncountedText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`));
  // The two assertions below carry a length conjunct on purpose. Both are
  // otherwise satisfied by the DEFECT — an empty list contains no 'STALE TREE'
  // and differs from state A's sentence — which is the species #12411 deleted
  // here: instrument intact, aimed at nothing. Measured under ablation: without
  // the conjunct they stay green with the fix reverted.
  t('and it does NOT cry stale either — a tree nobody counted is not a tree counted stale',
    uncounted.length === 2 && !uncountedText.includes('STALE TREE'));
  t('so this reading no longer shares one output with the level tree — the defect, stated as the comparison that used to hold',
    uncountedText !== level.join('\n'));
  t('and the two unmeasured doors are told apart rather than flattened by the shared predicate',
    uncounted.length === 2 && unmeasured.length === 2 && uncountedText !== unmeasuredText);
  t('a drift carrying no distance FIELD at all reads unmeasured too — absent is not a reading either',
    driftLines({ base: 'aaaaaaa', changed: [] }).join('\n').includes('STALENESS NOT MEASURED'));
  const benign = driftLines({ base: 'aaaaaaa', behind: 7, changed: [], headDate: '2026-01-01T00:00:00Z', baseDate: '2026-01-02T00:00:00Z' });
  const benignText = benign.join('\n');
  t('behind with the VISIBLE surface untouched states the distance, and scopes the claim to what the tree can see',
    benign.length === 2 && benign[0].includes('7 commit(s) behind') && benign[0].includes('can SEE'));
  t('and it states the unseen half as untellable instead of clear — the sentence a reader may safely comply with',
    benignText.includes('cannot tell') && benignText.includes('LOCAL snapshot'));
  // The departure pin for the measured false reassurance (#13392). The old
  // spelling asserted "nothing this answer derives from changed across that
  // range" from a reading whose range ends at the last fetch; a dev complied
  // with it and CI reddened on a family that landed upstream inside the gap
  // the sentence had vouched empty. The length-and-content conjunct is what
  // keeps this from passing vacuously — an empty render also contains no
  // reassurance, and that species of green pin is the one this block already
  // buried once.
  t('the reassurance spelling is GONE — no quiet line asserts that nothing this answer derives from changed',
    benign.length === 2 && benign[0].includes('none of the commit(s)') && !benignText.includes('nothing this answer derives from changed'));
  t('it hands over the fetch, the one action that strengthens the reading', benignText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`));
  t('and the quiet spelling still does not cry stale, so the loud spelling stays rare', !benignText.includes('STALE TREE'));
  // The THIRD unmeasured door (#13392): distance reads, changed set does not.
  // Under the old shape this state collapsed into `changed: []` and rendered
  // as the quiet clear sentence — a reassurance manufactured from a FAILED
  // read, the least earned of all.
  const unreadSet = driftLines({ base: 'aaaaaaa', behind: 7, changed: null, headDate: '2026-01-01T00:00:00Z', baseDate: '2026-01-02T00:00:00Z' });
  const unreadSetText = unreadSet.join('\n');
  t('a distance that READS beside a changed set that does NOT refuses as a third unmeasured door, never as quiet',
    unreadSet.length === 2 && unreadSetText.includes('STALENESS NOT MEASURED') && unreadSetText.includes('Not empty'));
  t('it names the base it resolved AND the distance it counted, so a reader can tell WHICH step failed this time',
    unreadSetText.includes('aaaaaaa') && unreadSetText.includes('7 commit(s)'));
  t('its remedy is the diff — not the fetch, not the count',
    unreadSetText.includes(`git diff --name-only HEAD...${DEFAULT_BASE_REF}`)
      && !unreadSetText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`)
      && !unreadSetText.includes('git rev-list --count'));
  t('and it neither reassures nor cries stale — no reading, no claim in either direction',
    unreadSet.length === 2 && !unreadSetText.includes('can SEE') && !unreadSetText.includes('STALE TREE'));
  t('so the three unmeasured doors are told apart rather than flattened by the shared predicate',
    new Set([unmeasuredText, uncountedText, unreadSetText]).size === 3);
  t('a drift carrying no changed FIELD at all reads unmeasured too — absent is not a reading either',
    driftLines({ base: 'aaaaaaa', behind: 7 }).join('\n').includes('STALENESS NOT MEASURED'));
  const loud = driftLines({ base: 'aaaaaaa', behind: 120, changed: ['scripts/pm/dispatch-gates.mjs', '.github/workflows/lint.yml'], headDate: '2026-01-01T00:00:00Z', baseDate: '2026-01-08T00:00:00Z' });
  const loudText = loud.join('\n');
  t('a changed derivation surface is LOUD, and names what it compared', loudText.includes('STALE TREE') && loudText.includes('HEAD') && loudText.includes(DEFAULT_BASE_REF) && loudText.includes('120 commit(s)'));
  t('it names the stale files themselves, not just a count', loudText.includes('scripts/pm/dispatch-gates.mjs') && loudText.includes('.github/workflows/lint.yml'));
  t('it says the exit code is no defence — the measured failure exited 0', loudText.includes('exited 0'));
  t('the count is a LOWER bound, because the base ref is local and only a fetch moves it', loudText.includes('At least') && loudText.includes(`git fetch ${DEFAULT_BASE_REMOTE} ${DEFAULT_BASE_BRANCH}`));
  t('drift reaches the banner, and stays behind the repo line that must come first', bannerLines({ identity: hereIdentity, paths: [], drift: { base: 'aaaaaaa', behind: 9, changed: ['scripts/x.mjs'] } })[0].includes('gate list derived from the tree of'));
  t('and a banner given no drift is byte-identical to before the flag existed', bannerLines({ identity: hereIdentity, paths: [], drift: null }).join('\n') === bannerLines({ identity: hereIdentity, paths: [] }).join('\n'));

  const driftTmp = mkdtempSync(join(tmpdir(), 'dispatch-gates-drift-'));
  try {
    const gd = (args, cwd) => spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
    const up = join(driftTmp, 'upstream');
    mkdirSync(up, { recursive: true });
    gd(['init', '-q', '-b', DEFAULT_BASE_BRANCH], up);
    writeFileSync(join(up, 'seed.txt'), 'seed\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'seed'], up);
    const clone = join(driftTmp, 'clone');
    gd(['clone', '-q', up, clone], driftTmp);
    // Positive control: a clone level with its base must read zero, or a
    // non-zero reading below proves nothing.
    t('a checkout level with its base measures zero drift (positive control)', baseDrift({ cwd: clone }).behind === 0);
    // The other end of the distinction, measured rather than hand-built: `up`
    // was `git init`-ed and has no remote at all, so the base ref genuinely
    // does not resolve there — the fresh-checkout state the object literals
    // above only describe. Its reading must not be the zero the clone reads.
    const unresolvableRepo = baseDrift({ cwd: up });
    t('a checkout with no such remote measures NO base, and does not fall back to zero',
      unresolvableRepo.base === null && unresolvableRepo.behind === null && unresolvableRepo.changed === null);
    t('and from a real repo too it arrives as a sentence, not as the silence the level clone gets',
      driftLines(unresolvableRepo).join('\n').includes('STALENESS NOT MEASURED')
        && driftLines(baseDrift({ cwd: clone })).length === 0);
    // The OTHER door, also measured rather than hand-built (#12815): a checkout
    // whose base ref is fetched and RESOLVES, but whose own HEAD is unborn, so
    // `rev-list --count HEAD..<ref>` cannot answer. The literals above describe
    // that state; only a repo shows it is reachable, which is the whole reason
    // this fixture exists beside them.
    const unborn = join(driftTmp, 'unborn');
    mkdirSync(unborn, { recursive: true });
    gd(['init', '-q', '-b', DEFAULT_BASE_BRANCH], unborn);
    gd(['remote', 'add', DEFAULT_BASE_REMOTE, up], unborn);
    gd(['fetch', '-q', DEFAULT_BASE_REMOTE, `${DEFAULT_BASE_BRANCH}:refs/remotes/${DEFAULT_BASE_REF}`], unborn);
    const unbornRepo = baseDrift({ cwd: unborn });
    t('a checkout whose base ref RESOLVES but whose own HEAD is unborn measures a base, NO distance and NO changed set',
      typeof unbornRepo.base === 'string' && unbornRepo.behind === null && unbornRepo.changed === null);
    t('and that door speaks from a real repo too, rather than reading as the silence the level clone gets',
      driftLines(unbornRepo).join('\n').includes('STALENESS NOT MEASURED')
        && driftLines(baseDrift({ cwd: clone })).length === 0);
    t('so the three REAL readings — level, no ref, no distance — no longer share one output',
      new Set([
        driftLines(baseDrift({ cwd: clone })).join('\n'),
        driftLines(unresolvableRepo).join('\n'),
        driftLines(unbornRepo).join('\n'),
      ]).size === 3);
    // Arrival, not just rendering: a sentence `driftLines` returns and the
    // banner drops is a sentence nobody reads, and the banner is the only
    // consumer there is. Pinned from the REAL reading rather than a literal,
    // because that is the half a literal cannot vouch for.
    t('and the banner a reader actually sees carries it, from that real reading',
      bannerLines({ identity: hereIdentity, paths: [], drift: unbornRepo }).join('\n').includes('STALENESS NOT MEASURED'));
    // Upstream moves in a file the answer is NOT derived from.
    writeFileSync(join(up, 'seed.txt'), 'seed2\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'unrelated'], up);
    gd(['fetch', '-q', DEFAULT_BASE_REMOTE], clone);
    const offSurface = baseDrift({ cwd: clone });
    t('drift against a real repo is measured from git, never assumed', offSurface.behind === 1 && !!offSurface.base);
    t('and a commit outside the derivation surface stays off the loud list — and the quiet render says what it can see',
      offSurface.changed.length === 0 && driftLines(offSurface).length === 2 && driftLines(offSurface)[0].includes('can SEE'));
    // Now upstream moves a file the answer IS derived from — the measured shape.
    mkdirSync(join(up, 'scripts'), { recursive: true });
    writeFileSync(join(up, 'scripts', 'check-thing.mjs'), 'export const a = 1;\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'change a check script'], up);
    gd(['fetch', '-q', DEFAULT_BASE_REMOTE], clone);
    const onSurface = baseDrift({ cwd: clone });
    t('a commit INSIDE the derivation surface is caught and named', onSurface.behind === 2 && onSurface.changed.includes('scripts/check-thing.mjs'));
    t('and that is the case that goes loud', driftLines(onSurface).join('\n').includes('STALE TREE'));
    // Reachability from an ORDINARY checkout, which is what makes the door
    // above a state of working clones and not only of repos built to show it:
    // `clone` is fully fetched and has just measured a real distance, and one
    // ordinary command leaves its HEAD unborn with the base ref still
    // resolving. It runs last because it mutates `clone`; nothing below reads it.
    gd(['checkout', '-q', '--orphan', 'a-branch-with-no-commit'], clone);
    const orphaned = baseDrift({ cwd: clone });
    t('one ordinary command reaches the no-distance state in a fully fetched clone',
      typeof orphaned.base === 'string' && orphaned.behind === null);
    t('and the clone that measured a distance one command ago says so instead of falling silent',
      driftLines(orphaned).join('\n').includes('STALENESS NOT MEASURED'));
    // The THIRD door, measured from a real repo rather than hand-built
    // (#13392): a SHALLOW clone. Depth-1 cloning is how this fleet's own
    // containers arrive, which is what makes this door a state of production
    // checkouts and not of repos built to show it. One shallow fetch after
    // upstream moves leaves the distance countable — the fetched tip is
    // visible — while the three-dot diff dies with no merge base, because the
    // shallow boundary cut it out of the checkout. Under the pre-fix shape
    // this exact state collapsed into `changed: []` and rendered the quiet
    // clear sentence from a FAILED read — so the last assertion here is the
    // required red: it fails if a reassurance can ever again be manufactured
    // without an established reading.
    const shallow = join(driftTmp, 'shallow');
    gd(['clone', '-q', '--depth', '1', `file://${up}`, shallow], driftTmp);
    t('a fresh shallow clone still counts a distance fine — shallowness alone breaks nothing (positive control)',
      baseDrift({ cwd: shallow }).behind === 0);
    writeFileSync(join(up, 'scripts', 'check-thing.mjs'), 'export const a = 3;\n');
    gd(['add', '-A'], up); gd(['commit', '-qm', 'move a check script beyond the shallow boundary'], up);
    gd(['fetch', '-q', '--depth', '1', DEFAULT_BASE_REMOTE], shallow);
    const shallowRepo = baseDrift({ cwd: shallow });
    t('one shallow fetch later the distance still READS and the changed set does NOT — null, never an empty array',
      shallowRepo.behind >= 1 && shallowRepo.changed === null);
    const shallowText = driftLines(shallowRepo).join('\n');
    t('and that run REFUSES from the real repo too, naming the changed set as the step that failed',
      shallowText.includes('STALENESS NOT MEASURED') && shallowText.includes('Not empty'));
    t('with an upstream SURFACE commit sitting in the unreadable range right now, no line reassures — not the visible-range sentence, not the retired unqualified one',
      !shallowText.includes('can SEE') && !shallowText.includes('nothing this answer derives from changed'));
  } finally {
    rmSync(driftTmp, { recursive: true, force: true });
  }

  const idTmp = mkdtempSync(join(tmpdir(), 'dispatch-gates-id-'));
  try {
    const gi = (args, cwd) => spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
    gi(['init', '-q', '-b', 'main', 'named'], idTmp);
    const named = join(idTmp, 'named');
    gi(['remote', 'add', DEFAULT_BASE_REMOTE, 'https://github.com/an-owner/a-repo.git'], named);
    const namedIdentity = repoIdentity({ cwd: named });
    t('a checkout with a readable remote identifies itself from git, never from a constant', namedIdentity.slug === 'an-owner/a-repo');
    gi(['init', '-q', '-b', 'main', 'anonymous'], idTmp);
    const anonymous = repoIdentity({ cwd: join(idTmp, 'anonymous') });
    t('a checkout with no such remote degrades to unverified and still names its tree', anonymous.slug === null && !!anonymous.root);
  } finally {
    rmSync(idTmp, { recursive: true, force: true });
  }

  // End to end, on the real CLI. The one card path is arbitrary; what is under
  // test is the guard around the answer, not the answer.
  const CLI = fileURLToPath(import.meta.url);
  const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ROOT });
  const plainRun = runCli(['--tier', 'packages/spec/src/index.ts']);
  t('an unasserted explicit-path run still answers', plainRun.status === 0 && (plainRun.stdout ?? '').trim().length > 0);
  t('and it opens with the banner, on the FIRST line of stderr', (plainRun.stderr ?? '').split('\n')[0].includes('gate list derived from the tree of'));
  t('the banner stays OFF stdout, which is pasted verbatim into claim comments', !(plainRun.stdout ?? '').includes('gate list derived from the tree of'));
  const liveSlug = repoIdentity().slug;
  const assertedRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG, liveSlug ?? 'an-owner/a-repo']);
  t(
    liveSlug
      ? 'asserting the repo this checkout really is leaves the run green'
      : 'with no readable remote, ANY assertion refuses rather than passing unverified',
    liveSlug ? assertedRun.status === 0 : assertedRun.status === 2,
  );
  t('a satisfied assertion changes the answer not at all', !liveSlug || (assertedRun.stdout ?? '') === (plainRun.stdout ?? ''));
  const refusedRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG, 'not-an-owner/not-a-repo']);
  t('asserting a repo this checkout is not ENDS the run', refusedRun.status === 2);
  t('and it prints no answer at all — a refusal must not also be pasteable', (refusedRun.stdout ?? '').trim() === '');
  t('and the refusal names the repo that was asked for', (refusedRun.stderr ?? '').includes('not-an-owner/not-a-repo'));
  const wrongShapeRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG, '../a-sister-checkout']);
  t('and pointing the flag at a checkout refuses instead of retargeting', wrongShapeRun.status === 2 && (wrongShapeRun.stdout ?? '').trim() === '');
  const valuelessRun = runCli(['--tier', 'packages/spec/src/index.ts', REPO_FLAG]);
  t('a valueless assertion refuses rather than deriving as though it were absent', valuelessRun.status === 2);

  // ── The entry guard (#9757) ───────────────────────────────────────────────
  //
  // Both directions are measured by really spawning node, because the guard's
  // own failure direction is silent in BOTH of them. If the predicate wrongly
  // answered false, every CLI mode would print nothing and exit 0, and
  // `check:pm-dispatch-gates` — which holds the child's exit status only —
  // would report that no-op as a pass. If it wrongly answered true, the defect
  // this guard exists to remove is simply still here. Reasoning about argv
  // cannot tell those apart on the invocation forms that actually occur; a
  // child process can.
  const SELF = fileURLToPath(import.meta.url);
  t('the entry predicate answers true for this module named by its own path', invokedAs(SELF, SELF));
  t('and for the same file named relatively from the repo root, as the gate spells it', invokedAs(join(ROOT, 'scripts/pm/dispatch-gates.mjs'), SELF));
  t('a different file in the same directory is not this module', !invokedAs(join(ROOT, 'scripts/pm/check-dispatch-gates.mjs'), SELF));
  t('an absent argv[1] is not this module — the `node --eval` importer', !invokedAs(undefined, SELF) && !invokedAs('', SELF));

  const entryTmp = mkdtempSync(join(tmpdir(), 'dispatch-gates-entry-'));
  try {
    // RUN DIRECTLY the modes must all still reach their branches. `--tier`
    // stands in for every one of them: the guard is a SINGLE site wrapping the
    // whole chain, so a form that reaches this branch reaches `--self-test`
    // too — and spawning `--self-test` from inside `--self-test` would recurse.
    const direct = spawnSync(process.execPath, [SELF, '--tier', 'packages/spec/src/data/filter.zod.ts'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    t(
      'invoked directly, --tier still answers rather than exiting 0 in silence',
      direct.status === 0 && (direct.stdout ?? '').trim().length > 0,
    );

    // #10097 option A, pinned END TO END. Every assertion above this one tests
    // `unreachableLines` in ISOLATION, and all of them stay green if the call
    // site drifts back behind `--residue` — which is the entire defect the
    // option was ruled to fix. Only a real run of the DEFAULT invocation, with
    // no flag, can tell the two apart.
    const plainRun = spawnSync(process.execPath, [SELF, 'packages/spec/src/data/filter.zod.ts'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    const plainOut = plainRun.stdout ?? '';
    t('the DEFAULT run answers at all', plainRun.status === 0 && plainOut.trim().length > 0);
    t('the DEFAULT run — no --residue — names the unreachable families itself', /^Unreachable — the \d+ famil\(ies\)/m.test(plainOut));
    t('and carries the ⛔ correction into the default output, where the wrong reading would be made', /NOT a skip list/.test(plainOut) && /CI schedules (?:those|it) on EVERY pull request/.test(plainOut));
    t('and the default run stays free of the residue listings the flag owns', !/^Silent \(source names paths/m.test(plainOut));
    // The two repaired families must not be named as unreachable by a REAL run.
    const unreachableBlock = plainOut.slice(plainOut.indexOf('Unreachable — the'), plainOut.indexOf('Residue — all'));
    t('a real default run no longer reports check:release-body as unreachable', !unreachableBlock.includes('check:release-body'));
    t('nor check-skill-frame-freshness.mjs', !unreachableBlock.includes('check-skill-frame-freshness.mjs'));
    t('and no phantom namespace literal survives into the printed reasons', !/'application\/json'|'refs\/remotes\/|'origin\/main'/.test(unreachableBlock));

    // #10309, pinned END TO END for the same reason #10097 is: every case above
    // drives `pendingChangesetFamilies`/`pendingChangesetLines` in isolation and
    // all of them stay green if the call site is dropped from `derive`, or hidden
    // behind a flag no dispatch brief tells anyone to pass. Only a real DEFAULT
    // run over a real non-changeset surface can tell those apart — and this is
    // also the one case that proves the LIVE tree still has such families at all,
    // so a probe that silently stopped reaching them cannot pass as "none
    // pending".
    t('the DEFAULT run names the families a changeset will add', /^Once a changeset exists, \d+ more famil\(ies\) apply/m.test(plainOut));
    const pendingBlock = plainOut.slice(plainOut.indexOf('Once a changeset exists,'), plainOut.indexOf('Unreachable — the'));
    t('and the live tree really has some — the probe reaching nothing must not read as "none pending"', /^ {2}- (pnpm|node) \S/m.test(pendingBlock));
    // `every` over an empty list is true, so the row count is asserted BESIDE
    // it: without that, dropping the call site leaves this case green on a slice
    // containing nothing at all (measured — it was the one live case ablating
    // the call site did not redden).
    const pendingRows = pendingBlock.split('\n').filter((l) => l.startsWith('  - '));
    t('every live row is runnable and carries the hypothetical path', pendingRows.length > 0 && pendingRows.every((l) => /^ {2}- (pnpm|node) /.test(l) && l.includes(CHANGESET_PROBE_PATH)));
    // The negative half: hand the SAME run a diff that already carries a
    // changeset. Those families must move into the matched list and the section
    // must stop printing — the double-print is the shape this section would be
    // worst as, since the two headings make different claims about time.
    const withChangeset = spawnSync(
      process.execPath,
      [SELF, 'packages/spec/src/data/filter.zod.ts', `.${'changeset'}/pinned-by-the-self-test.md`],
      { encoding: 'utf8', cwd: ROOT },
    );
    const withOut = withChangeset.stdout ?? '';
    t('a run whose surface ALREADY carries a changeset answers at all', withChangeset.status === 0 && withOut.trim().length > 0);
    t('and prints no pending section — there is no temporal gap left to disclose', !/^Once a changeset exists,/m.test(withOut));
    t(
      'because those families are in the MATCHED list instead, each one exactly once',
      withOut.split('\n').filter((l) => l.startsWith('  - ') && l.includes('check-empty-changeset')).length === 1,
    );

    // REACHED THROUGH A SYMLINK — the form a plain path equality gets wrong.
    // Node resolves the link for the module graph, so `import.meta.url` names
    // the real file while argv[1] names the link. Under the precedent's
    // one-comparison spelling this run goes inert, exit 0, no output: the
    // false-green the gate cannot see.
    const link = join(entryTmp, 'linked-dispatch-gates.mjs');
    symlinkSync(SELF, link);
    const viaLink = spawnSync(process.execPath, [link, '--tier', 'packages/spec/src/data/filter.zod.ts'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    t(
      'invoked through a symlink to this file, --tier still answers',
      viaLink.status === 0 && (viaLink.stdout ?? '').trim().length > 0,
    );
    t('and it answers the SAME thing as the direct invocation', (viaLink.stdout ?? '') === (direct.stdout ?? ''));

    // IMPORTED the module must do nothing at all. The importer's argv carries
    // this tool's own flags on purpose: that is the shape that fired an
    // unrelated file's assertions inside the importer's self-test.
    const consumer = join(entryTmp, 'consumer.mjs');
    const REACHED = 'CONSUMER-REACHED function function function';
    writeFileSync(
      consumer,
      `const m = await import(${JSON.stringify(pathToFileURL(SELF).href)});\n` +
        `console.log('CONSUMER-REACHED', typeof m.maskComments, typeof m.isExtractConfigPath, typeof m.deriveTier);\n`,
    );
    const imported = spawnSync(process.execPath, [consumer, '--self-test', '--tier', 'packages/spec/src/index.ts'], {
      encoding: 'utf8',
      cwd: entryTmp,
    });
    t(
      'imported, the importer reaches its own first statement and the re-exports are there',
      imported.status === 0 && (imported.stdout ?? '').trim() === REACHED,
    );
    t('imported, this module prints nothing of its own on either stream', (imported.stderr ?? '').trim() === '');
    t(
      "imported by a consumer whose own argv says --self-test, THIS file's self-test does not fire",
      !(imported.stdout ?? '').includes('dispatch-gates self-test:'),
    );
  } finally {
    rmSync(entryTmp, { recursive: true, force: true });
  }

  // ── The always-runs tail (#13333) ────────────────────────────────────────
  //
  // Two halves, and the SECOND is the one that answers the card. The fixtures
  // pin the walk; the live pins below assert that the tail reaches the CLASS on
  // this tree — that it names a second member, invisible for a DIFFERENT reason
  // than the gate the card was filed about. A fix demonstrated only on
  // `check-reference-carrier-shape` is the instance fix triage refused, and the
  // way to keep that from rotting back in is to make the class assertion a
  // case, derived live, rather than a sentence in a docblock.
  const tailWf = [
    'name: Fixture',
    'on:',
    '  pull_request:',
    '    branches:',
    '      - main',
    'jobs:',
    '  gates:',
    '    steps:',
    '      - name: Setup',
    '        uses: actions/checkout@v4',
    '      - name: A discoverable family',
    '        run: pnpm check:engine-double-contract',
    '      - name: A package-local gate invoked by path',
    '        run: |',
    '          node packages/lint/scripts/check-fixture-shape.mjs --self-test',
    '          node packages/lint/scripts/check-fixture-shape.mjs',
    '      - name: A gate run by another interpreter',
    '        run: bash scripts/pm/os-fixture-lock.sh --self-test',
    '      - name: Conditional, so no claim is made about it',
    '        if: github.event_name == \'push\'',
    '        run: pnpm exec turbo run build',
    '      - name: A body carrying a dash line',
    '        run: |',
    '          printf \'%s\\n\' "- not a step"',
    '          pnpm lint',
    '  conditional-job:',
    '    if: needs.filter.outputs.console == \'true\'',
    '    steps:',
    '      - name: Never claimed as always-run',
    '        run: pnpm check:console-pin',
  ].join('\n');

  t('a pull_request trigger is distinguished from no trigger at all', declaresPullRequestTrigger(tailWf));
  t(
    'a workflow with no pull_request trigger is not read as unfiltered',
    !declaresPullRequestTrigger('on:\n  push:\n    branches:\n      - main\njobs:\n  x:\n    steps: []'),
  );

  const tailJob = extractJobBlocks(tailWf).find((j) => j.id === 'gates');
  const tailSteps = extractStepBlocks(tailJob.text);
  t('every step of the job is found, and only the steps', tailSteps.length === 6);
  t('a step name is read from its own key column', tailSteps[1].name === 'A discoverable family');
  t('a step `if:` is read', tailSteps[4].if === "github.event_name == 'push'");
  t('a step without an `if:` is not given one', tailSteps[2].if === null);
  t(
    'a dash line INSIDE a block-scalar body is not read as a step',
    tailSteps[5].name === 'A body carrying a dash line' && tailSteps[5].text.includes('- not a step'),
  );

  const tail = alwaysRunSteps([{ file: 'fixture.yml', text: tailWf }]);
  const tailNames = tail.rows.map((r) => r.step);
  t('a step whose family the derivation names is NOT in the tail', !tailNames.includes('A discoverable family'));
  t('a package-local gate invoked by path IS in the tail', tailNames.includes('A package-local gate invoked by path'));
  t('a gate run by another interpreter IS in the tail', tailNames.includes('A gate run by another interpreter'));
  t('a conditional STEP is excluded and counted', !tailNames.includes('Conditional, so no claim is made about it') && tail.counts.conditionalSteps === 1);
  t('a conditional JOB is excluded and counted', !tailNames.includes('Never claimed as always-run') && tail.counts.conditionalJobs === 1);
  t('a `uses:` step with no command is neither counted nor listed', !tailNames.includes('Setup') && tail.counts.unconditional === 4);
  t('the tail accounts for every unconditional step it counted', tail.counts.accounted + tail.counts.unaccounted === tail.counts.unconditional);
  t(
    'a workflow CI can narrow by path is excluded from the tail entirely',
    alwaysRunSteps([{ file: 'f.yml', text: tailWf.replace('    branches:\n      - main', "    paths:\n      - 'packages/**'") }]).counts
      .filteredWorkflows === 1,
  );

  const tailLines = alwaysRunLines(tail.rows, tail.counts);
  t('the rendered tail sizes itself against the unconditional total', tailLines[0].includes(`${tail.counts.unaccounted} of the ${tail.counts.unconditional}`));
  t('the rendered tail refuses to be read as a per-card list', tailLines.some((l) => l.includes('EVERY pull request whatever your diff is')));
  t('the rendered tail refuses to classify its rows into gates and setup', tailLines.some((l) => l.includes('NOT classified into gates and setup')));

  const dedupeRows = [
    { workflow: 'a.yml', job: 'One', step: 'Install dependencies', commands: ['pnpm install --frozen-lockfile'] },
    { workflow: 'a.yml', job: 'Two', step: 'Install dependencies', commands: ['pnpm install --frozen-lockfile'] },
    { workflow: 'a.yml', job: 'Two', step: 'Install dependencies', commands: ['pnpm install --offline'] },
  ];
  const dedupeLines = alwaysRunLines(dedupeRows, { unconditional: 4, accounted: 1, unaccounted: 3, conditionalSteps: 0, conditionalJobs: 0 });
  t('rows are deduplicated by COMMAND, never by step name', dedupeLines.filter((l) => l.startsWith('  - ')).length === 2);
  t('a repeated command names how many other jobs also run it', dedupeLines.some((l) => l.includes('also run by 1 other job(s)')));

  const longRow = [{ workflow: 'a.yml', job: 'J', step: 'S', commands: Array.from({ length: 30 }, (_, i) => `line ${i}`) }];
  const longLines = alwaysRunLines(longRow, { unconditional: 2, accounted: 1, unaccounted: 1, conditionalSteps: 0, conditionalJobs: 0 });
  t('a long step is elided to a pointer rather than transcribed', longLines.some((l) => l.includes(`${30 - ALWAYS_RUN_COMMAND_CAP} more line(s) — read the step in a.yml`)));
  t('the elision still prints the capped head of the command', longLines.filter((l) => /^ {6}line \d+$/.test(l)).length === ALWAYS_RUN_COMMAND_CAP);

  const refusedTail = (rows, counts) => {
    try {
      alwaysRunLines(rows, counts);
      return false;
    } catch {
      return true;
    }
  };
  t('a tail that found NO unconditional step refuses rather than reads as a clean farm (#4690)', refusedTail([], { unconditional: 0, accounted: 0, unaccounted: 0 }));
  t('a tail whose counts do not add up refuses', refusedTail([], { unconditional: 5, accounted: 1, unaccounted: 1 }));
  t('a tail whose row count contradicts its own total refuses', refusedTail([], { unconditional: 5, accounted: 4, unaccounted: 1 }));

  // ── LIVE, on this tree: does the tail reach the CLASS? ────────────────────
  //
  // Re-derived on every run, so these fail when the workflows move rather than
  // when someone remembers to re-read them. ⛔ No count is pinned: the number
  // of unconditional steps moves with every workflow edit and a frozen one
  // would go stale with nothing failing — which is the defect this whole file
  // is about.
  const liveTail = alwaysRunSteps(
    readdirSync(join(ROOT, '.github/workflows'))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => ({ file: f, text: readFileSync(join(ROOT, '.github/workflows', f), 'utf8') })),
  );
  const liveCommands = liveTail.rows.flatMap((r) => r.commands);
  t('the live tail is not empty — an empty one would mean the walk broke, not that CI runs nothing', liveTail.rows.length > 0);
  t(
    'the live tail names the INSTANCE the card was filed about: a package-local gate invoked by path',
    liveCommands.some((c) => /^node\s+packages\/\S+\/check-[\w.-]+\.mjs/.test(c)),
  );
  // The class assertion. The instance above is invisible because its path is
  // not under `scripts/`; this one is invisible because its INTERPRETER is not
  // `node` at all. Two different structural reasons, so a fix that reached only
  // the first would fail here.
  const otherInterpreter = liveCommands.filter((c) => /^(?:bash|sh|python3?)\s+\S+/.test(c));
  t(
    'the live tail reaches the CLASS: a second member invisible for a DIFFERENT reason (another interpreter)',
    otherInterpreter.length > 0,
  );
  t(
    'and that second member is not the card\'s own gate wearing a different name',
    otherInterpreter.some((c) => !c.includes('reference-carrier')),
  );
  // The partition. Every row is a step the family derivation names NOTHING for,
  // so a row that yields an invocation would mean the tail and the family list
  // are double-counting the same step — the two halves have to be disjoint for
  // either count to mean anything.
  t(
    'no row in the live tail yields a check invocation — the tail and the family list are disjoint',
    liveTail.rows.every((r) => extractCheckInvocations(r.commands.join('\n'), r.workflow).length === 0),
  );
  t(
    'every live row really sits in a workflow CI cannot narrow by path',
    liveTail.rows.every((r) => {
      const text = readFileSync(join(ROOT, '.github/workflows', r.workflow), 'utf8');
      return declaresPullRequestTrigger(text) && extractTriggerPaths(text).length === 0;
    }),
  );
  t('the live tail renders without refusing', alwaysRunLines(liveTail.rows, liveTail.counts).length > 0);

  // ── The seam between this tool and its caller (#13462) ────────────────────
  //
  // Unit half first: the split and the footer are pure, so their edge cases are
  // cheap to pin here rather than hunted for in a live tree that may not have
  // one today. The END TO END half below is the part that cannot be faked —
  // both remedies are about what a real run puts on a real stream.
  // The filtered fixture names a REAL workspace package on purpose.
  // `check-pnpm-filter-targets` scans the whole tree for `pnpm --filter TARGET`
  // and requires the target to be a live package — it does NOT mask self-tests,
  // so an invented one here reddens that gate from inside this file's fixtures
  // (measured: `@x` did exactly that). A fixture is still a literal in the tree.
  const mixedSplit = spellingSplit([
    'pnpm check:a',
    'pnpm --filter @objectstack/lint run check:b',
    'node scripts/check-c.mjs',
  ]);
  t('spellingSplit counts both spellings', mixedSplit.total === 3 && mixedSplit.pnpm === 2 && mixedSplit.node === 1);
  // A third interpreter must be COUNTED, not folded into either side. The gate
  // corpus already runs steps under bash and python3, and a split that answered
  // "0 direct node" for one of those would be a confident zero about a spelling
  // it cannot see — the same failure the footer exists to prevent.
  const thirdSplit = spellingSplit(['pnpm check:a', 'bash scripts/os-verify-lock.sh --self-test']);
  t('a third interpreter lands in `other` rather than being miscounted', thirdSplit.other === 1 && thirdSplit.node === 0 && thirdSplit.pnpm === 1);
  t('and the footer names it rather than dropping it', spellingFooterLines(thirdSplit)[0].includes('1 neither'));
  // ⭐ CONTROL 3, as a pin: the footer must not hardcode "there is always a
  // direct form". On an all-pnpm block it has to SAY `0 direct node`.
  const pureFooter = spellingFooterLines(spellingSplit(['pnpm check:a', 'pnpm check:b', 'pnpm check:c']));
  t('the footer prints the direct-node term at ZERO on a pure-pnpm block', pureFooter[0] === '3 matched families — 3 pnpm, 0 direct node.');
  // ⭐ #13642: the heading names its SCOPE. This count is the matched block
  // alone, and spelled as a bare `N families` it was a subtotal in the
  // vocabulary of a total, printed directly under the rows a consumer
  // harvests — the line the two devs who dropped the convention block
  // reconciled against, successfully, on the wrong list.
  t('and it names the block it counts rather than claiming to be the total', pureFooter[0].startsWith('3 matched families'));
  t('and no line of it claims a bare `N families` total any more', !pureFooter.some((l) => /^\d+ families /.test(l)));
  // ...and the ⛔ warning is the half that must NOT fire there: on a block with
  // no direct row a one-spelling grep really does lose nothing, and a warning
  // that fires anyway trains the reader on a claim this run measured as false.
  t('and it does not warn about a shortfall that this block does not have', !pureFooter.some((l) => l.includes('⛔')));
  t('while a mixed block DOES warn, with both figures in it', spellingFooterLines(mixedSplit).some((l) => l.includes('⛔') && l.includes('2 of the 3')));
  t('an empty block gets no footer at all — a zero heading invites a hunt for rows that do not exist', spellingFooterLines(spellingSplit([])).length === 0);
  // The published snippet must not become a fabricated watch hint in this
  // file's OWN source. Both lines carry spaces, so the admission test rejects
  // them whole; this pins the property instead of trusting the reading.
  t('the published harvest snippet contributes no watch hint to this file', extractWatchHints(HARVEST_SNIPPET.join('\n')).length === 0);

  // commandsFor: matched UNION convention, deduped, sorted, nulls dropped.
  const cfRows = [{ command: 'pnpm check:b' }, { command: 'node scripts/check-a.mjs' }];
  const cfKinds = [{ kind: 'k', hits: ['f'], gates: [{ name: 'check:b', why: 'w', command: 'pnpm check:b' }, { name: 'check:gone', why: 'w', command: null }] }];
  const cfOut = commandsFor({ matchedRows: cfRows, kindGroups: cfKinds });
  t('commandsFor unions matched with convention-triggered gates', cfOut.length === 2 && cfOut.includes('pnpm check:b'));
  t('and deduplicates a family reached BOTH ways rather than listing it twice', cfOut.filter((c) => c === 'pnpm check:b').length === 1);
  t('and emits NOTHING for a STALE kind entry no workflow runs — never a fabricated command', !cfOut.some((c) => c.includes('gone')));
  t('and sorts, so two harvests of one tree are byte-comparable', cfOut.join('\n') === [...cfOut].sort().join('\n'));

  // ── The count reconciliation (#13642) ────────────────────────────────────
  //
  // The card: the human rendering places this answer in TWO differently shaped
  // sections, and two independent devs each harvested one of them, ran it
  // green, and reddened CI on a family the other section named. The remedy is
  // a total a consumer can ASSERT against — so what has to be pinned is not
  // that a line prints, but that its numbers cannot drift from the sections
  // they claim to reconcile. A count computed independently of those sections
  // would be an instrument that cannot fail toward its own target.
  {
    const rRows = [{ command: 'pnpm check:b' }, { command: 'node scripts/check-a.mjs' }];
    const rKinds = [
      { kind: 'k', hits: ['f'], gates: [{ name: 'check:b', why: 'w', command: 'pnpm check:b' }, { name: 'check:k1', why: 'w', command: 'pnpm check:k1' }] },
    ];
    const r = familyReconciliation({ matchedRows: rRows, kindGroups: rKinds });
    // ⭐ THE identity: the total is commandsFor's own answer, not a second count.
    t('the reconciliation total IS the commandsFor union, not a recount of it', r.total === commandsFor({ matchedRows: rRows, kindGroups: rKinds }).length);
    t('and its parts close against that total', r.matched + r.convention - r.both === r.total && r.total === 3);
    t('and a family reached BOTH ways is disclosed rather than double-counted', r.both === 1 && r.conventionOnly === 1);

    // ⭐ BOTH DIRECTIONS, which is what makes this a reconciliation rather than
    // a decoration: a family added to either input must move the section's own
    // term AND the total together. Pinned by moving one input at a time.
    const plusKind = familyReconciliation({
      matchedRows: rRows,
      kindGroups: [{ kind: 'k', hits: ['f'], gates: [...rKinds[0].gates, { name: 'check:k2', why: 'w', command: 'pnpm check:k2' }] }],
    });
    t('adding a convention family moves the convention term AND the total', plusKind.convention === r.convention + 1 && plusKind.total === r.total + 1);
    const plusMatched = familyReconciliation({ matchedRows: [...rRows, { command: 'pnpm check:m2' }], kindGroups: rKinds });
    t('adding a matched family moves the matched term AND the total', plusMatched.matched === r.matched + 1 && plusMatched.total === r.total + 1);
    // ...and SUPPRESSING a section is the direction the card was filed on.
    const noKinds = familyReconciliation({ matchedRows: rRows, kindGroups: [] });
    t('suppressing the convention section moves the convention term AND the total', noKinds.convention === 0 && noKinds.total === 2);
    const noMatched = familyReconciliation({ matchedRows: [], kindGroups: rKinds });
    t('suppressing the matched section moves the matched term AND the total', noMatched.matched === 0 && noMatched.total === 2);

    // A STALE kind row prints and contributes no command. The gap between rows
    // printed and families counted is DISCLOSED, because a consumer counting
    // printed rows against this total would otherwise find a discrepancy with
    // no explanation — which is the failure mode this line exists to remove.
    const staleRecon = familyReconciliation({
      matchedRows: [],
      kindGroups: [{ kind: 'k', hits: ['f'], gates: [{ name: 'check:live', why: 'w', command: 'pnpm check:live' }, { name: 'check:gone', why: 'w', command: null }] }],
    });
    t('a STALE convention row is counted in rows but not in families', staleRecon.conventionRows === 2 && staleRecon.convention === 1 && staleRecon.staleRows === 1);
    t('and the rendering DISCLOSES that gap rather than leaving the reader to find it', familyReconciliationLines(staleRecon).some((l) => l.includes('prints 2 rows for those 1') && l.includes('STALE')));

    // The invariant is meant to be unreachable by construction — the parts are
    // built from the SAME two expressions commandsFor unions. This drives that
    // claim over every shape the two inputs can take rather than asserting it
    // once: any future refactor that replaces either set with a second
    // traversal reddens here, which is the only way this line can go wrong.
    const pool = ['pnpm check:x', 'pnpm check:y', 'node scripts/check-z.mjs'];
    let closures = 0;
    for (let m = 0; m < 8; m += 1) {
      for (let k = 0; k < 8; k += 1) {
        const rows = pool.filter((_, i) => m & (1 << i)).map((command) => ({ command }));
        const gates = pool.filter((_, i) => k & (1 << i)).map((command) => ({ name: command, why: 'w', command }));
        const got = familyReconciliation({ matchedRows: rows, kindGroups: gates.length ? [{ kind: 'k', hits: ['f'], gates }] : [] });
        if (got.matched + got.convention - got.both === got.total && got.total === commandsFor({ matchedRows: rows, kindGroups: gates.length ? [{ kind: 'k', hits: ['f'], gates }] : [] }).length) closures += 1;
      }
    }
    t('the total and its parts close over EVERY overlap of the two inputs — 64 of 64', closures === 64);

    // The line's SPELLING, pinned because a consumer may come to assert against
    // it — the very migration this line is asking readers to make.
    const rl = familyReconciliationLines(r);
    t('the reconciliation line leads with the total in an assertable shape', /^Reconciliation — 3 famil\(ies\): this card's WHOLE runnable answer/.test(rl[0]));
    t('and spells the arithmetic that ties it to both sections', /^ {2}2 named by PATH \(the matched block\) \+ 2 named by change KIND \(the convention block\), 1 of them the same family reached both ways ⇒ 3 distinct\.$/.test(rl[1]));
    t('and names the machine-readable escape hatch inline, where a harvesting consumer is looking', rl.some((l) => l.includes('--commands prints exactly these 3')));
    // ⛔ The new number must not become a second "complete account of what CI
    // runs" — that would reproduce this card's own defect one layer up. Same
    // disclosure machineReadableOutput already makes on stderr.
    t('and disclaims the three sections it deliberately excludes', rl.some((l) => l.includes('NOT a complete account of what CI runs') && l.includes('always-runs tail')));
    // ...and the SHORT-harvest warning is conditional, on the rule the ⛔
    // spelling warning already follows: on a card with no convention-only
    // family, a warning that one section is short is a claim this run measured
    // as false.
    t('the short-harvest warning fires where a section really is droppable', rl.some((l) => l.includes('A harvest that ends at ONE section')));
    t('and NOT on a card whose whole answer is one section', !familyReconciliationLines(noKinds).some((l) => l.includes('A harvest that ends at ONE section')));

    // ⭐ Printed at ZERO, deliberately unlike spellingFooterLines. An absent
    // number is not assertable, and its absence would mean two things at once:
    // "this card owes no gates" and "this build has no reconciliation line".
    const zero = familyReconciliationLines(familyReconciliation({ matchedRows: [], kindGroups: [] }));
    t('the reconciliation prints at ZERO rather than falling silent', zero.length > 0 && zero[0].startsWith('Reconciliation — 0 famil(ies)'));
    t('and says the derivation COMPLETED, so an empty answer cannot read as a missing one', zero[0].includes('COMPLETED'));

    // The footer's forward pointer is fed the SAME structure, so the two
    // renderings cannot disagree about how many families sit outside the block.
    const fwd = spellingFooterLines(spellingSplit(['pnpm check:b', 'node scripts/check-a.mjs']), r);
    t('the matched footer names the whole total and the families outside its block', fwd.some((l) => l.includes('is 2 of the 3 this card owes') && l.includes('1 more famil(ies)')));
    t('and stays silent about a convention block that this card does not have', !spellingFooterLines(spellingSplit(['pnpm check:b']), noKinds).some((l) => l.includes('this card owes')));
  }

  // changeKindLines must be a RENDERING of changeKindGates, not a second walk.
  {
    const kinds = [{ kind: 'a kind', matches: (x) => x.endsWith('.ts'), gates: [{ name: 'check:x', why: 'because' }] }];
    const resolve = () => 'pnpm check:x';
    const groups = changeKindGates(['a.ts'], resolve, kinds);
    const rendered = changeKindLines(['a.ts'], resolve, kinds);
    t('changeKindGates and changeKindLines agree on the gate rows', groups[0].gates.length === rendered.filter((l) => l.startsWith('    - ')).length);
    t('and a STALE name still renders its warning through the shared shape', changeKindLines(['a.ts'], () => null, kinds).some((l) => l.includes('STALE')));
  }

  // ── END TO END, on the real CLI and the real tree ─────────────────────────
  //
  // Everything above drives the pure halves, and all of it stays green if the
  // call site in `derive` is dropped or hidden behind a flag no brief tells
  // anyone to pass — which is the whole defect. Only a real run can tell them
  // apart, and only a real run can measure the two REMEDIES against each other.
  {
    const seamCard = 'scripts/measure-durability-swallow-family.mjs';
    const humanRun = runCli([seamCard]);
    const humanOut = humanRun.stdout ?? '';
    t('the seam card still derives at all', humanRun.status === 0 && humanOut.trim().length > 0);
    // 形 2, in the DEFAULT output. No flag: the footer is the control for
    // consumers who have not migrated, so it is worth nothing behind a flag.
    const footerLine = humanOut.split('\n').find((l) => /^\d+ matched families — \d+ pnpm, \d+ direct node\.$/.test(l));
    t('the DEFAULT run prints the spelling distribution in its own footer', Boolean(footerLine));
    t('and the distribution is a SPLIT, not a bare count — the count alone signs off on the wrong list', /\d+ pnpm, \d+ direct node/.test(footerLine ?? ''));

    // ⭐ The published snippet must SURVIVE the footer. It ends the block at the
    // first empty line, so a footer butted against the rows would be harvested
    // as rows — the remedy breaking the transition it exists to cover. Driven
    // with the real awk and sed, because a reimplementation in JS would be
    // pinning this file's idea of the snippet rather than the snippet.
    // The snippet reads `gates.txt`; feed it the same bytes under that name.
    const harvestTmp = mkdtempSync(join(tmpdir(), 'dg-harvest-'));
    try {
      writeFileSync(join(harvestTmp, 'gates.txt'), humanOut);
      const real = spawnSync('bash', ['-c', HARVEST_SNIPPET.join('\n')], { encoding: 'utf8', cwd: harvestTmp });
      const harvestedRows = (real.stdout ?? '').split('\n').filter(Boolean);
      t('the published snippet still runs against a real rendering', real.status === 0 && harvestedRows.length > 0);
      t(
        'and the footer did NOT leak into it — every harvested row is a runnable command',
        harvestedRows.every((l) => /^(pnpm|node) \S/.test(l)),
      );
      // 形 1 vs the transition, measured against each other on one input.
      const cmdRun = runCli(['--commands', seamCard]);
      const cmdRows = (cmdRun.stdout ?? '').split('\n').filter(Boolean);
      t('--commands answers', cmdRun.status === 0 && cmdRows.length > 0);
      t('and stdout is commands and NOTHING else — no heading, no annotation, no blank-line block to parse', cmdRows.every((l) => /^(pnpm|node) \S/.test(l)));
      t('and it agrees exactly with the published snippet on this card', [...cmdRows].sort().join('\n') === [...harvestedRows].sort().join('\n'));
      // ⭐ CONTROL 1 and CONTROL 2 as ONE assertion pair, on ONE input. A new
      // mode returning the full list proves nothing on its own if the old
      // harvest would have too — the defect has to still be there for the
      // bypass to be the thing that fixed it.
      const blockRows = harvestedRows.length;
      const oldHarvest = harvestedRows.filter((l) => l.startsWith('pnpm check:')).length;
      t('CONTROL: the OLD one-spelling harvest is still SHORT on this input — the defect is real and untouched', oldHarvest < blockRows);
      t('CONTROL: and --commands returns the FULL list on that same input', cmdRows.length === blockRows);
      t('and the rows the old harvest drops are exactly the ones spelled the other way', blockRows - oldHarvest === harvestedRows.filter((l) => l.startsWith('node ')).length);
    } finally {
      rmSync(harvestTmp, { recursive: true, force: true });
    }

    // ⭐ Where --commands is strictly BETTER than the snippet, not merely equal:
    // the snippet reads the matched block alone and drops the convention block
    // printed beneath it. Driven on a card KIND that really hits.
    const testCard = 'packages/spec/scripts/authorable-defaults.test.ts';
    const convCmd = (runCli(['--commands', testCard]).stdout ?? '').split('\n').filter(Boolean);
    const convHuman = runCli([testCard]).stdout ?? '';
    const convBlock = convHuman
      .slice(convHuman.indexOf('Local gates for this card'))
      .split('\n\n')[0]
      .split('\n')
      .filter((l) => l.startsWith('  - '))
      .map((l) => l.replace(/^ {2}- (.*) {3}\[.*$/, '$1'));
    t('a convention-triggered card is really convention-triggered', /^Convention-triggered gates/m.test(convHuman));
    t('--commands carries the convention gates the block-only harvest drops', convCmd.length > convBlock.length);
    t('and every one of the extra rows is runnable', convCmd.every((l) => /^(pnpm|node) \S/.test(l)));

    // ── The reconciliation, END TO END on that same card (#13642) ───────────
    //
    // Everything in the unit half stays green if the call site in `derive` is
    // dropped, printed behind a flag, or fed a structure the sections did not
    // come from. Only a real run can tell those apart, and this is the card
    // shape the two incidents happened on: a matched block AND a convention
    // block, with the answer split across them.
    const reconLine = convHuman.split('\n').find((l) => l.startsWith('Reconciliation — '));
    t('the DEFAULT run prints the reconciliation — no flag, because a control behind a flag is worth nothing', Boolean(reconLine));
    const reconTotal = Number((reconLine ?? '').match(/^Reconciliation — (\d+) famil/)?.[1] ?? NaN);
    // ⭐ THE assertion the card asks for: the stated total is the SAME number
    // --commands answers with. If the human block and the machine-readable
    // mode can disagree, the line is a second answer rather than a control.
    t('and its total is exactly what --commands returns for the same card', reconTotal === convCmd.length);
    // ...and each term is the section it names, counted off the REAL rendering.
    const reconParts = (convHuman.split('\n').find((l) => /named by PATH \(the matched block\)/.test(l)) ?? '').match(
      /^ {2}(\d+) named by PATH .* \+ (\d+) named by change KIND/,
    );
    t('the PATH term equals the rows the published snippet harvests from the matched block', Number(reconParts?.[1]) === convBlock.length);
    const convSectionCommands = new Set(
      convHuman
        .slice(convHuman.indexOf('Convention-triggered gates'))
        .split('\n')
        .filter((l) => /^ {4}- (pnpm|node) /.test(l))
        .map((l) => l.replace(/^ {4}- (.*?) {3}— .*$/, '$1')),
    );
    t('and the change-KIND term equals the distinct runnable rows the convention block really printed', Number(reconParts?.[2]) === convSectionCommands.size);

    // ⭐ CONTROL: the defect is STILL THERE and the line is what detects it.
    // A one-section harvest of this card is short — that is the untouched
    // defect — and the number a consumer would now assert against does not
    // match it. Both halves on one input: without the first, the second proves
    // nothing; without the second, the first is only a restatement of the bug.
    t('CONTROL: a matched-block-only harvest of this card is STILL short — the defect is real and untouched', convBlock.length < convCmd.length);
    // `Number.isInteger` is not decoration. Measured while ablating the call
    // site out of `derive`: with no line printed `reconTotal` is NaN, and
    // `NaN !== convBlock.length` is TRUE — so this case passed while the
    // remedy was absent, which is the instrument-cannot-fail-toward-its-target
    // shape the whole card is about. The detector has to have READ a number
    // before it can claim to have detected anything with it.
    t(
      'CONTROL: and the reconciliation total DETECTS that harvest as short rather than agreeing with it',
      Number.isInteger(reconTotal) && reconTotal !== convBlock.length,
    );
    // The same detection offered at the harvest SITE, where a consumer who
    // never scrolls past the matched block still meets it.
    t('the matched footer forward-points to that total from inside the block being harvested', convHuman.includes(`this card owes`) && convHuman.includes(`carries the ${reconTotal}`));
    // ⛔ ...and the footer must no longer spell its own subtotal as a total.
    t('and the footer no longer prints a bare `N families` line for a harvest to reconcile against', !/^\d+ families /m.test(convHuman));

    // --json: one document, and the omission it makes is DISCLOSED rather than
    // silent — which is the card's own subject matter.
    const jsonRun = runCli(['--json', seamCard]);
    let doc = null;
    try {
      doc = JSON.parse(jsonRun.stdout ?? '');
    } catch {
      doc = null;
    }
    t('--json puts a single parseable document on stdout', jsonRun.status === 0 && doc !== null);
    t('and it carries the runnable list, agreeing with --commands', Boolean(doc) && doc.commands.join('\n') === (runCli(['--commands', seamCard]).stdout ?? '').trim());
    t('and the spelling split travels with it', Boolean(doc) && doc.spelling.total === doc.commands.length);
    t('and it names the tree it is about, as the banner does', Boolean(doc) && doc.commit !== null);
    t(
      'the pending-changeset families are DISCLOSED under their own key rather than silently missing',
      Boolean(doc) && Array.isArray(doc.pendingChangeset.families),
    );
    t(
      'and they are kept OUT of commands — they name a path that does not exist yet',
      Boolean(doc) && doc.pendingChangeset.families.every((f) => !doc.commands.includes(f.command)),
    );
    // The machine modes must keep stdout clean in BOTH directions: the banner
    // and the accounting belong on stderr, or a consumer redirecting stdout
    // gets prose back and is filtering again — the hazard, reintroduced.
    const cmdRun2 = runCli(['--commands', seamCard]);
    t('the banner stays off stdout in --commands', !(cmdRun2.stdout ?? '').includes('gate list derived from the tree of'));
    t('and the accounting of what was left out is on stderr, where it cannot corrupt the harvest', (cmdRun2.stderr ?? '').includes('always-runs tail'));
    t('and that accounting names the pending families too, so the omission is out loud', (cmdRun2.stderr ?? '').includes("once this card's changeset exists"));
    // Two answers to "what shape is stdout" is no answer.
    const bothRun = runCli(['--commands', '--json', seamCard]);
    t('passing both stdout spellings refuses instead of silently preferring one', bothRun.status === 2 && (bothRun.stdout ?? '').trim() === '');
  }

  // ── END TO END: the CI-measured family, on the card it was measured on (#14004)
  //
  // Everything in the unit half above stays green if the split in `derive` is
  // dropped, or if the row is filtered out of `--commands` but left in the
  // block a dev pastes. Only a real run on a real card can tell those apart,
  // and this is the card the defect was measured on: `.claude/agents/**` is the
  // highest-traffic governed surface here, so every dev on it met the row.
  {
    const guardCard = '.claude/agents/os-dev.md';
    const guardCommand = 'node scripts/pm/check-governed-queue-guard.mjs';
    const run = runCli([guardCard]);
    const out = run.stdout ?? '';
    t('the card still derives at all', run.status === 0 && out.includes('Local gates for this card'));
    // ⭐ CONTROL: the family is still MATCHED — the fix is a marking, not a
    // disappearance. Without this case, a rule that dropped the family from the
    // derivation entirely would pass every case below it.
    t('CONTROL: the queue-guard family is still derived for this card', out.includes(guardCommand));
    // The block a dev pastes, harvested with the REAL published snippet, must
    // no longer contain it.
    // ONE `--commands` run, read by three cases below. Each CLI spawn is a
    // full derivation of this tree (~30s on a contended box), so a second run
    // for a second reading would be a minute of fleet compute to answer a
    // question this run already answered — and two runs could disagree.
    const cmdRun = runCli(['--commands', guardCard]);
    const harvestTmp = mkdtempSync(join(tmpdir(), 'dg-cionly-'));
    try {
      writeFileSync(join(harvestTmp, 'gates.txt'), out);
      const harvested = (spawnSync('bash', ['-c', HARVEST_SNIPPET.join('\n')], { encoding: 'utf8', cwd: harvestTmp }).stdout ?? '')
        .split('\n')
        .filter(Boolean);
      t('the published harvest of the pasted block no longer yields the CI-measured command', harvested.length > 0 && !harvested.includes(guardCommand));
      const cmdRows = (cmdRun.stdout ?? '').split('\n').filter(Boolean);
      t('--commands omits it too, and the two renderings still agree exactly', !cmdRows.includes(guardCommand) && [...cmdRows].sort().join('\n') === [...harvested].sort().join('\n'));
      t('and every command still on the list is one a dev can actually run here', cmdRows.length > 0 && cmdRows.every((l) => /^(pnpm|node) \S/.test(l)));
      t('the stderr accounting says the omission out loud, where it cannot corrupt the harvest', (cmdRun.stderr ?? '').includes('CI-MEASURED ONLY'));
    } finally {
      rmSync(harvestTmp, { recursive: true, force: true });
    }
    // ...and the family is still NAMED, under its own heading, with the reason
    // a reader can check against the gate. Dropping a gate quietly is the
    // failure this whole file refuses; marking it is the remedy.
    const ciSection = out.slice(out.indexOf('CI-measured only —'));
    t('the human rendering names it under its own CI-measured heading', out.includes('CI-measured only — matched by path'));
    t('with its command, its workflow and its matched-via provenance intact', ciSection.includes(guardCommand) && ciSection.includes('governed-surface-guard.yml') && ciSection.includes(`matched via ${guardCard}`));
    t('and the reason names the payload variable the classification was read from', ciSection.includes('GITHUB_EVENT_PATH'));
    // --json: the same row, flagged rather than absent.
    const jsonRun = runCli(['--json', guardCard]);
    let guardDoc = null;
    try {
      guardDoc = JSON.parse(jsonRun.stdout ?? '');
    } catch {
      guardDoc = null;
    }
    const guardRow = guardDoc?.matched?.find((r) => r.command === guardCommand);
    t('--json carries the family as a matched row rather than dropping it', Boolean(guardRow));
    t('and flags it, so a machine consumer reads the omission instead of inferring it', guardRow?.ciOnly?.env === 'GITHUB_EVENT_PATH');
    t('and keeps it out of the runnable list, which is the same list --commands prints', Boolean(guardDoc) && !guardDoc.commands.includes(guardCommand));
  }


  // ── The RUN reconciliation: harvested ⟶ EXECUTED (#13774) ─────────────────
  //
  // Three measured mechanisms produced three confident, well-formed, FALSE
  // claims of complete coverage, and each one has cases here: no comparison at
  // all, a fuzzy comparison, and an arithmetic over the runner's own counter.
  // The unit half below drives the pure functions; the end-to-end half at the
  // bottom builds the record BY CONSTRUCTION from a real `--commands` run,
  // which is the property the whole design rests on.
  {
    const marker = RUN_RECORD_UNMEASURED_MARKER;
    const sep = RUN_RECORD_REASON_SEPARATOR;

    // ── The record format: what is decoded, and what is content ─────────────
    const parsed = parseRunRecord(
      [
        'pnpm check:a',
        '',
        '   ',
        '# a comment the runner left for itself',
        'node scripts/check-b.mjs\r',
        `${marker} pnpm check:c${sep}refuses without a built dist — its own stated prerequisite`,
      ].join('\n'),
    );
    t('a plain line is a ran claim, byte for byte', parsed[0].command === 'pnpm check:a' && parsed[0].claim === 'ran');
    t('blank and whitespace-only lines carry no command and are skipped', parsed.length === 3);
    t('a comment line is skipped — no runnable invocation starts with a hash', !parsed.some((e) => e.raw.startsWith('#')));
    t(
      'a CRLF line loses its terminator and NOTHING else',
      parsed[1].command === 'node scripts/check-b.mjs' && !parsed[1].command.includes('\r'),
    );
    t(
      `a ${marker} claim parses into its command and its reason`,
      parsed[2].claim === 'not-measured' && parsed[2].command === 'pnpm check:c' && parsed[2].reason.startsWith('refuses without'),
    );
    // ⭐ The exactness rule, in the parser: whitespace INSIDE a line is content,
    // and trimming it would be a normalisation applied to one side of the
    // comparison only — the fuzzy shape wearing a smaller hat.
    t('leading whitespace is NOT trimmed away into a match', parseRunRecord('  pnpm check:a')[0].command === '  pnpm check:a');
    t(
      `the ${marker} marker is exact and case-sensitive — a command merely containing the word is a ran claim`,
      parseRunRecord('pnpm check:not-measured-things')[0].claim === 'ran'
        && parseRunRecord(`not-measured pnpm check:a${sep}x`)[0].claim === 'ran',
    );
    const unreasoned = parseRunRecord([`${marker} pnpm check:a`, `${marker} pnpm check:b${sep}   `].join('\n'));
    t(
      `a ${marker} claim with no reason, and one with an empty reason, are both MALFORMED and still name their command`,
      unreasoned.every((e) => e.malformed && e.reason === null) && unreasoned[0].command === 'pnpm check:a' && unreasoned[1].command === 'pnpm check:b',
    );

    // ── The classes ────────────────────────────────────────────────────────
    const derived = ['node scripts/check-b.mjs', 'pnpm check:a', 'pnpm check:c'];
    const full = runReconciliation({ derived, record: parseRunRecord(derived.join('\n')) });
    t('a complete record reconciles green, with every derived family run', full.ok && full.ran.length === 3 && full.unrun.length === 0);
    const short = runReconciliation({ derived, record: parseRunRecord(['pnpm check:a', 'node scripts/check-b.mjs'].join('\n')) });
    t('a record missing one family NAMES it rather than counting it', !short.ok && short.unrun.length === 1 && short.unrun[0].command === 'pnpm check:c');
    t('and the reason it gives is the absence itself', short.unrun[0].why.includes('absent from the run record'));

    // ⭐ MECHANISM 3, at its limit: the denominator is this tree's derivation,
    // so an EMPTY record cannot balance against it. An arithmetic over the
    // runner's own list would have reported 0 of 0 and closed.
    const nothingRan = runReconciliation({ derived, record: parseRunRecord('') });
    t(
      'an EMPTY record over a non-empty derivation reports EVERY family unrun, never a balanced nothing',
      !nothingRan.ok && nothingRan.unrun.length === 3 && nothingRan.derivedTotal === 3,
    );
    const junkOnly = runReconciliation({ derived, record: parseRunRecord(['pnpm check:something-else', '# note'].join('\n')) });
    t(
      'and a record of entries that name nothing derived does the same — the total cannot be lowered from the record side',
      junkOnly.derivedTotal === 3 && junkOnly.unrun.length === 3 && junkOnly.extra.length === 1,
    );
    t('an entry outside the derivation is reported and is NOT an error on its own', junkOnly.extra[0] === 'pnpm check:something-else');

    // ⭐ MECHANISM 2, structurally: no prefix, substring or whitespace
    // relation is ever a pairing.
    const prefixish = runReconciliation({
      derived: ['pnpm check:foo'],
      record: parseRunRecord(['pnpm check:foo-extra', 'check:foo', 'pnpm check:fo'].join('\n')),
    });
    t(
      'a prefix, a substring and a truncation of a derived command pair with NOTHING',
      !prefixish.ok && prefixish.unrun.length === 1 && prefixish.extra.length === 3,
    );
    const nearMiss = runReconciliation({ derived: ['pnpm check:foo'], record: parseRunRecord('pnpm check:foo  ') });
    t(
      'a whitespace-only difference is REPORTED and still leaves the family unrun — the diagnostic can never move a verdict',
      !nearMiss.ok && nearMiss.unrun[0].command === 'pnpm check:foo' && nearMiss.nearMiss.length === 1,
    );
    t('and the near-miss names both spellings, so the repair is mechanical', nearMiss.nearMiss[0].recorded === 'pnpm check:foo  ' && nearMiss.nearMiss[0].derived === 'pnpm check:foo');

    // ── NOT-MEASURED is its own class, and it costs a reason ────────────────
    const claimed = runReconciliation({
      derived: ['pnpm check:a', 'pnpm check:b'],
      record: parseRunRecord(['pnpm check:a', `${marker} pnpm check:b${sep}refuses without a built dist`].join('\n')),
    });
    t(
      `a reasoned ${marker} family is neither run nor unrun — it is its own class, and the verdict stays green`,
      claimed.ok && claimed.ran.length === 1 && claimed.unrun.length === 0 && claimed.notMeasured.length === 1,
    );
    t('and the reason travels with it, because the report is what it is for', claimed.notMeasured[0].reason === 'refuses without a built dist');
    // ⭐ The cap-kill conflation, mechanically refused: the category exists for
    // a gate that refuses with its own prerequisite, and it is exactly where a
    // family you merely did not FINISH running goes to hide.
    const unexplained = runReconciliation({ derived: ['pnpm check:a'], record: parseRunRecord(`${marker} pnpm check:a`) });
    t(
      `an unexplained ${marker} claim is read as UNRUN, not as a refusal`,
      !unexplained.ok && unexplained.unrun.length === 1 && unexplained.notMeasured.length === 0,
    );
    t('and the run says why, naming the cap kill it would otherwise absorb', unexplained.unrun[0].why.includes('cap-killed'));
    t('the malformed line is reported against its line number too', unexplained.malformed.length === 1 && unexplained.malformed[0].line === 1);

    // ── What the TOOL classifies, so no prose has to ────────────────────────
    const explained = runReconciliation({
      derived: ['pnpm check:a'],
      ciOnlyCommands: new Set(['node scripts/check-payload-guard.mjs']),
      pendingCommands: new Set(['pnpm check:changeset-shape']),
      record: parseRunRecord(['pnpm check:a', 'node scripts/check-payload-guard.mjs', 'pnpm check:changeset-shape'].join('\n')),
    });
    t(
      'a CI-measured-only entry and a pending-changeset entry are classified by the tool, not dumped into the remainder',
      explained.ok && explained.explainedCiOnly.length === 1 && explained.explainedPending.length === 1 && explained.extra.length === 0,
    );

    // ── Bookkeeping the classes cannot lose ─────────────────────────────────
    const dupes = runReconciliation({ derived: ['pnpm check:a'], record: parseRunRecord(['pnpm check:a', 'pnpm check:a'].join('\n')) });
    t('a duplicated record line cannot double-count a family', dupes.ok && dupes.ran.length === 1 && dupes.derivedTotal === 1);
    const contradicted = runReconciliation({
      derived: ['pnpm check:a'],
      record: parseRunRecord(['pnpm check:a', `${marker} pnpm check:a${sep}also claimed`].join('\n')),
    });
    t('a family claimed BOTH ways reads as run and the contradiction is reported, not resolved silently', contradicted.ok && contradicted.conflicts.length === 1);
    const zero = runReconciliation({ derived: [], record: parseRunRecord('') });
    t('an empty derivation and an empty record is a green EMPTY answer, not a missing one', zero.ok && zero.derivedTotal === 0);

    // ⭐ The closure assertion, driven: the three classes partition the derived
    // set, and an instrument that could not fail toward its own target is the
    // defect this file keeps finding one level up.
    for (const n of [0, 1, 5]) {
      const many = Array.from({ length: n }, (_, i) => `pnpm check:g${i}`);
      const half = many.filter((_, i) => i % 2 === 0);
      const r = runReconciliation({ derived: many, record: parseRunRecord(half.join('\n')) });
      t(
        `the classes partition the derived set exactly (${n} derived, ${half.length} recorded)`,
        r.ran.length + r.unrun.length + r.notMeasured.length === r.derivedTotal && r.derivedTotal === n,
      );
    }

    // ── The rendering, and the ONE bit at the end of it ─────────────────────
    const redLines = runReconciliationLines(short);
    const redText = redLines.join('\n');
    t('the rendering leads with the four counts in an assertable shape', /^Run reconciliation — 3 derived, 2 run, 0 NOT-MEASURED, 1 UNRUN\.$/.test(redLines[0]));
    t('it states where the denominator came from — the claim an arithmetic cannot make', redText.includes('recomputed in this process'));
    t('every unrun family is NAMED, never just counted', short.unrun.every(({ command }) => redText.includes(command)));
    t('the verdict is one line and it is the LAST one', redLines[redLines.length - 1].startsWith('✗ dispatch-gates --ran:'));
    const greenText = runReconciliationLines(full).join('\n');
    t('and the green verdict is the same line in the same place', greenText.trim().endsWith('3 derived famil(ies) accounted for — 3 run, 0 NOT-MEASURED.'));
    t('the rendering discloses what this number does NOT cover', greenText.includes('always-runs tail'));
    t(
      `the ${marker} block warns about the cap kill the category absorbs`,
      runReconciliationLines(claimed).join('\n').includes('exit 143'),
    );
    t(
      'the near-miss line refuses the pairing out loud rather than quietly',
      runReconciliationLines(nearMiss).join('\n').includes('is NOT paired with it'),
    );

    // ── argv: a two-token flag's value must not become a path ───────────────
    const ranSplit = splitArgv([RAN_FLAG, 'ran.list', 'packages/spec/src/index.ts', '--residue']);
    t('the run record value never falls through into the path list', ranSplit.paths.length === 1 && ranSplit.runRecord === 'ran.list');
    t('and the two value-taking flags coexist', splitArgv([RAN_FLAG, 'ran.list', REPO_FLAG, 'an-owner/a-repo']).assertion === 'an-owner/a-repo');
    t('the joined spelling parses to the same thing', splitArgv([`${RAN_FLAG}=ran.list`]).runRecord === 'ran.list');
    t('no run record passed stays null, so every other run is untouched', splitArgv(['packages/spec/src/index.ts']).runRecord === null);
    // ⭐ The message that would LIE: with one value-taking flag the hint was a
    // constant, and a second flag turned that constant into a sentence naming
    // the wrong argument.
    const ranMalformed = splitArgv([RAN_FLAG]).malformed ?? '';
    t('a valueless run record is malformed, and the message names THIS flag', ranMalformed.includes(RAN_FLAG) && !ranMalformed.includes('repo'));
    t('and the assertion keeps its own hint', (splitArgv([REPO_FLAG]).malformed ?? '').includes('owner'));
  }

  // ── END TO END: the record built BY CONSTRUCTION from --commands (#13774) ──
  //
  // Everything above stays green if `--ran` is never wired into the CLI, or if
  // the mode reads a derivation of its own rather than the one `--commands`
  // prints. Only a real run can tell those apart — and only a real run can
  // demonstrate the property the whole design rests on: the two sides of the
  // comparison are the SAME strings, because the record is this tool's own
  // output copied line for line. That is what makes the comparison exact
  // without a normaliser, which is the condition triage attached to this shape.
  {
    const ranCard = 'scripts/measure-durability-swallow-family.mjs';
    const ranTmp = mkdtempSync(join(tmpdir(), 'dg-ran-'));
    try {
      const cmdRun = runCli(['--commands', ranCard]);
      const rows = (cmdRun.stdout ?? '').split('\n').filter(Boolean);
      t('CONTROL: the card derives a runnable union at all', cmdRun.status === 0 && rows.length >= 2);

      const completePath = join(ranTmp, 'ran-complete.list');
      writeFileSync(completePath, `${rows.join('\n')}\n`);
      const green = runCli([RAN_FLAG, completePath, ranCard]);
      const greenOut = green.stdout ?? '';
      t(
        '⭐ a record that is --commands output copied verbatim reconciles GREEN and exits 0',
        green.status === 0 && greenOut.includes(`${rows.length} derived famil(ies) accounted for`),
      );
      t('and it needed no normalisation to do it — the two lists are the same strings', greenOut.includes(`${rows.length} derived, ${rows.length} run`));

      const dropped = rows[rows.length - 1];
      const shortPath = join(ranTmp, 'ran-short.list');
      writeFileSync(shortPath, `${rows.slice(0, -1).join('\n')}\n`);
      const red = runCli([RAN_FLAG, shortPath, ranCard]);
      const redOut = red.stdout ?? '';
      t('⭐ dropping ONE line from that record exits 1 — a verdict a report cannot paraphrase', red.status === 1);
      t('and the run names exactly the family that was dropped', redOut.includes('UNRUN (1)') && redOut.includes(dropped));

      // The refusals, and the unreadable input. All three exit before the tree
      // walk, so they cost nothing to assert.
      t(
        'combining the verdict mode with a derivation mode is REFUSED, not blended',
        runCli([RAN_FLAG, completePath, '--commands', ranCard]).status === 2
          && runCli([RAN_FLAG, completePath, '--json', ranCard]).status === 2,
      );
      t('and so is asking for a tier verdict there is nothing to reconcile against', runCli([RAN_FLAG, completePath, '--tier', ranCard]).status === 2);
      const missing = runCli([RAN_FLAG, join(ranTmp, 'no-such-record.list'), ranCard]);
      t('an unreadable record REFUSES rather than reconciling against nothing (#4690)', missing.status === 2 && (missing.stdout ?? '').trim() === '');
      t('and the refusal names the file it could not read', (missing.stderr ?? '').includes('no-such-record.list'));
      const valueless = runCli([RAN_FLAG]);
      t('a valueless run record refuses, and its message does not name the OTHER flag', valueless.status === 2 && !(valueless.stderr ?? '').includes('as an owner and a name'));
    } finally {
      rmSync(ranTmp, { recursive: true, force: true });
    }
  }

  let failed = 0;
  for (const [name, cond] of cases) {
    if (!cond) failed++;
    console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  }
  if (failed) {
    console.error(`✗ dispatch-gates self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ dispatch-gates self-test: ${cases.length} cases pass.`);
}

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
    selfTest();
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
    // because a consumer could not tell what it was reading.
    console.error('dispatch-gates: --commands and --json are two spellings of stdout — pass one.');
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
        runRecord = parseRunRecord(readFileSync(resolve(argv.runRecord), 'utf8'));
      } catch (err) {
        console.error(`dispatch-gates: could not read the run record '${argv.runRecord}' — ${err.message}`);
        console.error(
          `  ${RAN_FLAG} takes a file of the commands you ran, one per line, exactly as --commands emits them.` +
            ' Capture them as you run, never by slugging log file names back into family names.',
        );
        process.exit(2);
      }
    }
    let paths;
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
        console.error('usage: node scripts/pm/dispatch-gates.mjs [--residue] [--tier] [--commands | --json | --ran <file>] [--repo owner/name] [<path> ...] | --changed | --self-test');
        process.exit(2);
      }
      if (derived.paths.length === 0) {
        // An empty derivation is an input problem far more often than an answer,
        // and "no gates" is the most expensive thing this tool could say wrongly
        // (#4690: an unreadable input must never look like an empty answer).
        console.error(
          `dispatch-gates: this branch changes nothing against '${derived.base}' (merge base ${derived.mergeBase.slice(0, 9)}) — ` +
            'nothing to derive. On the base branch already, or in the wrong checkout? Pass explicit paths to ask about a hypothetical surface.',
        );
        process.exit(2);
      }
      for (const line of derivationProvenance(derived)) console.error(line);
      console.error('');
      paths = derived.paths;
    }
    try {
      // `--tier` answers the claim-time question alone: it reads no workflow and
      // no check script, so it still answers on a tree where the gate derivation
      // cannot run — and a claim comment is written before any of that matters.
      if (process.argv.includes('--tier')) {
        for (const line of tierLines(deriveTier(paths))) console.log(line);
      } else {
        // The only mode with a VERDICT in it, so the only one whose exit code
        // carries an answer rather than "the derivation completed". A run that
        // names unrun families must not exit 0: this mode exists because a
        // report claiming coverage it did not have read exactly like one that
        // did, and an exit code is the half of that a caller cannot paraphrase.
        const status = derive(paths, { showResidue: process.argv.includes('--residue'), mode, runRecord });
        if (status) process.exit(status);
      }
    } catch (err) {
      console.error(`dispatch-gates: derivation failed — ${err.message}`);
      process.exit(2);
    }
  }
}
