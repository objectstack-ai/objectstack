#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-adr-0087-registration -- a PR that DECLARES a breaking change must state,
// in writing, what it did about the ADR-0087 migration ledger (#6148).
//
//   node scripts/check-adr-0087-registration.mjs --base <ref-or-sha> [--head <ref>]
//   node scripts/check-adr-0087-registration.mjs              # base defaults to origin/main
//   node scripts/check-adr-0087-registration.mjs --self-test   # verify the checker itself
//   node scripts/check-adr-0087-registration.mjs --list        # audit the whole .changeset stock
//
// `--base` names the BRANCH POINT, not the first commit of the diff: the scan
// always starts at `merge-base(<base>, <head>)`, for the #6129 reason its sibling
// `check-empty-changeset.mjs` documents at length. Fed a frozen `base.sha`, this
// gate would judge an author against changesets main gained while their PR was open.
//
// ## The hole this closes (#6148)
//
// The ADR-0087 ledger (`packages/spec/src/migrations/registry.ts`) had two gates:
// `check:spec-changes` (vs `packages/spec/spec-changes.json`) and
// `check:upgrade-guide` (vs `docs/protocol-upgrade-guide.md`). Both pin ledger
// <-> ARTIFACT SYNCHRONY: change the registry without regenerating and they fail.
//
// NEITHER pins that a retirement which actually happened has a ledger entry at
// all. The artifacts are a pure PROJECTION of the registry, so when an entry was
// never written the registry and its artifacts are perfectly consistent -- every
// gate green, repo-wide. The gate family is structurally blind to OMISSION.
//
// Measured instance: PR #6048 removed the `roles` alias on `ActorUser`
// (`ctx.user.roles` / `req.user.roles`). The ledger got nothing, while three other
// faces of the same ADR-0090 rename WERE registered. CI was green throughout. It
// was caught by a human triage seat comparing by eye (#6011) and backfilled by a
// separate dispatch round (PR #6138). The only detector that has ever fired on
// this class is a person.
//
// Why it matters, precisely: the consequence is not a runtime error but a SILENT
// GAP ON THE UPGRADE PATH. Ledger entries are the sole data source for
// `objectstack migrate meta`, `spec-changes.json` and the generated upgrade guide.
// For a surface with no spec schema at all -- `ctx.user` is only a runtime TS
// interface -- there is no `retiredKey()` tombstone and no schema rejection
// either, so the ledger entry is the ONLY notification channel that exists.
//
// ## What this gate does NOT do, deliberately
//
// It does not detect retirements. "What counts as a retirement that must be
// registered" is undecidable in the case that actually happened -- the removal
// was in `packages/runtime` while the ledger lives in `packages/spec` -- and a
// cross-package retirement detector is exactly the thing the maintainer's ruling
// (2026-08-07, on #6148) routes AROUND rather than through.
//
// The ruling: drive the gate off the changeset's own breaking/major declaration,
// cross-checked against ledger entries. That sidesteps the hard problem because
// THE AUTHOR HAS ALREADY DECLARED "this is breaking". Nothing has to be inferred;
// the gate only notices that a declared-breaking change arrived saying NOTHING
// about the ledger. Silence is the single thing it forbids.
//
// ## The rule
//
// A changeset this PR newly ADDS (or newly turns breaking) that declares a
// breaking change must carry exactly one ADR-0087 disposition marker:
//
//   <!-- adr-0087: registered <id>[, <id>...] -->
//   <!-- adr-0087: not-required (<category> ...) <why> -->
//
// `<category>` is one of `CATEGORIES` below -- not enumerated here. A hand-kept
// copy of that list is the same defect #14378 found in a different file: an
// illustrative restatement that must be kept in step with a real list is the
// worst of both, and it already drifted once (#15915 measured this very
// comment naming five forms while `CATEGORIES` and ADR-0087's addendum both
// held `type-surface-only` as a sixth). Each category's own argument grammar
// (`<id>`, `<path>#<Symbol>`, or none) lives at its assertion site below, not
// here.
//
// The vocabulary is ratified in ADR-0087's addendum of 2026-08-13, and the two
// halves are pinned to each other: `assertInputs` refuses to report a verdict
// unless the categories documented there and the `CATEGORIES` below are the same
// set, in both directions (#8299). A category the ADR does not describe cannot be
// claimed, and a category the ADR describes that this file cannot check is a red
// too -- which is the drift #8299 was filed about, closed at birth.
//
// An HTML comment rather than a visible line, for one reason: a changeset body is
// copied VERBATIM into CHANGELOG.md and shipped to end users. The marker is for
// this repo's authors and reviewers, and it stays fully visible where they read --
// the PR diff, `git grep`, this gate's log, and `--list` -- while rendering as
// nothing in a published changelog. It is not hidden from anyone who reviews.
//
// ## Which diff rows are judged (#7045)
//
// "Newly ADDS (or newly turns breaking)" is a statement about diff STATUS, and
// the enumeration has to name every status a changeset can arrive under:
//
//   A  breaking at head                              -> judged (a new declaration)
//   M  breaking at head, NOT breaking at base        -> judged (turned breaking)
//   M  breaking at head, already breaking at base    -> skipped (inherited stock)
//   R  breaking at head, NOT breaking at the OLD path-> judged (renamed into it)
//   R  breaking at head, already breaking there      -> skipped (stock, moved)
//
// The last two rows arrived late. Git's rename detection is on by default
// (`diff.renames`, since git 2.9), so a changeset renamed AND turned breaking in
// one commit reports as `R`, and this file passed `--diff-filter=AM` until #7045
// -- which drops the `R` row wholesale. A declared-breaking changeset arriving
// that way carried no ADR-0087 disposition and was never asked for one, which is
// #6148 again through a door nobody had checked. Measured on git 2.43.0, renaming
// `.changeset/old.md` to `.changeset/new.md` while adding the breaking declaration
// reports `R077<TAB>.changeset/old.md<TAB>.changeset/new.md`, and the same diff
// under `AM` prints nothing at all.
//
// The fix is `AMR` plus reading the base side at the OLD path -- field 2 of an
// `R` row, not field 3. It costs nothing: a PURE move of an already-breaking
// stock changeset compares breaking-at-base and stays skipped, so no author is
// asked to re-dispose of somebody else's declaration for renaming a file.
// `check-changeset-no-major.mjs` made the same one-letter correction first
// (#7005 / PR #7048); this gate and `check-empty-changeset.mjs` followed in
// #7045, separately, because each of the three owns its own fixtures and its own
// messages.
//
// ## Why the escape hatch is the MAJORITY path, and why that is fine (measured)
//
// Measured over the last 400 first-parent commits on main: 32 newly-added
// changesets declared breaking, and only 5 of them (15.6%) touched an ADR-0087
// registry. Corroborated independently from stock: the v17 train carries 213
// breaking changesets against 29 step-17 semantic entries -- about 1 in 7.
//
// So `not-required` is not an exception here, it is the common answer, and this
// gate is designed for that rather than against it. Its value is NOT precision
// about which change needs an entry; it is that the QUESTION IS ANSWERED IN
// WRITING on every breaking change. #6048 did not answer it -- it said nothing at
// all, and nothing asked. Note the burden is small in absolute terms: ~32
// dispositions per 400 PRs, of which ~27 are one `not-required` line.
//
// ## What keeps `not-required` honest -- re-validated on EVERY run
//
// A bare allow-list nobody re-checks is the failure mode to avoid, so four of the
// five dispositions are checked against facts rather than taken on trust, and the
// fifth is checked against the changeset's own prose:
//
//   registered            -- every id must resolve in the ADR-0087 registries at
//                            HEAD, AND at least one must be NEW in this diff. A
//                            PR cannot claim a registration it did not make.
//   unpublished           -- every package the changeset bumps must be
//                            `private: true` in its workspace manifest. Fully
//                            mechanical; a published package fails it outright.
//   already-registered    -- every named id must resolve at HEAD *and* already
//                            exist at the merge base. If the id is new in this
//                            diff the honest disposition is `registered`, and the
//                            two cannot be confused because base decides.
//   no-migration-prescription
//                         -- REFUSED when the changeset's own body carries a
//                            migration prescription. A changeset that ships
//                            instructions for rewriting a consumer's code cannot
//                            also claim no consumer has to rewrite anything: that
//                            is a self-contradiction, checked
//                            statement-against-statement, not a retirement
//                            detector.
//   runtime-interface-only
//                         -- every named `<path>#<Symbol>` must resolve to an
//                            exported TS declaration at HEAD that is NOT itself a
//                            metadata surface and is referenced IN CODE by none
//                            (comment spans are masked; string literals are not),
//                            so `objectstack migrate meta` provably has nothing to
//                            rewrite. It ALSO inherits the prescription refusal
//                            above; it is a narrowing of it, never an escape from
//                            it. See the next section (#8299).
//
// That last check is the one that reaches #6048: its changeset carries a
// `### 迁移:FROM → TO` section with a worked before/after block, so the catch-all
// exemption is closed to it and the author must either register or name a
// mechanically-verified category. Measured on the same 400 commits: 11 of the 32
// breaking changesets carry such a prescription, and it covers 4 of the 5 that did
// register -- a genuine forcing function, not a blanket demand.
//
// #6419 and #6497 repaired the detector behind it, twice, for one recurring
// reason: the more carefully an author writes a prescription, the less it looks
// like the shape the detector was pattern-matching. #6419 -- it had been matching
// the literal PLACEHOLDER words `FROM`/`TO`, so `迁移:FROM → TO` (the template)
// was caught while `迁移:`aggregate:` → `aggregations:`` (a real prescription) was
// not. #6497 -- both branches then required an ARROW, so a rewrite written as a
// two-column table under `## Migration` read as no prescription at all, and four
// declared-breaking changesets were holding the exemption on that gap. #6559 --
// branch 3 still required a migration HEADING, so a table framed only by its own
// `| Wrote | Write instead |` header row was missed, and eleven declared-breaking
// changesets were holding the exemption on THAT gap. It now reads framing-anchored
// rewrites in both languages, in arrow form and in table form, whether the frame
// comes from a heading or from the table's own header. The full argument, the
// measured numbers and the deliberate residual blind spot are at
// hasMigrationPrescription.
//
// ## The fifth category: `runtime-interface-only` (#8299)
//
// ### The shape the taxonomy had no word for
//
// Every category above reasons about METADATA: a Zod schema, a spec declaration,
// a stored row -- something `objectstack migrate meta` can reach. PR #8277 changed
// a shape outside that taxonomy entirely: a PUBLISHED RUNTIME TYPESCRIPT INTERFACE
// with no metadata surface at all (`PackagePublishResult` in
// `packages/services/service-package/src/index.ts` lost its `error` member). Its
// argument for needing no ledger entry was, in the author's own words in the
// changeset: no Zod schema, no `packages/spec` declaration, no stored
// representation, so nothing exists for `objectstack migrate meta` to rewrite --
// and the channel that actually reaches every affected consumer is the COMPILER
// (`error TS2339: Property 'error' does not exist on type 'PackagePublishResult'`),
// which is strictly more precise than a ledger line.
//
// That argument is correct and it was accepted. It was also PROSE, judged by hand,
// and it rode on `no-migration-prescription` -- an exemption whose one mechanical
// check is "your body carries no prescription". Measured on #8277's real changeset
// (`.changeset/lucky-schools-smash.md`, merged as fc71b84):
// `findMigrationPrescription` returns `null` on it, even though the body does tell
// consumers "read `result.driverFault?.message` where you read `result.error`" --
// there is no arrow and no migration framing, so branches 1-4 all miss it. So the
// exemption was held by a DETECTOR MISS, not by a positive finding. That is the
// #8299 complaint stated precisely: the next author either re-derives the argument
// by hand, or pattern-matches the much looser "no metadata surface => no changeset
// discipline", which is NOT what #8277 argued.
//
// ⚠️ #18745 is that same miss recurring, through a DIFFERENT gap in the detector, on
// a changeset claiming the category this section built. The paragraph above stays as
// written because it records what was measured on #8277; what it must not be read as
// is "the hole is closed". See the `#18745` section above for which gap each of the
// two misses went through and why closing the second does not close the first.
//
// ### What is checked, and why it is a NARROWING
//
// The claim names the symbols it is about, and each one is verified at HEAD:
//
//   1. it RESOLVES -- `<path>#<Symbol>` names an exported `interface`/`type`/
//      `class`/`enum` that really exists at HEAD. An unverifiable claim is refused,
//      never assumed true (#4690).
//   2. its DECLARATION SITE is not a metadata surface -- not a `*.zod.ts`, not a
//      file under `packages/spec/src/contracts/`, not an object definition.
//   3. its declaration is not a PROJECTION of a Zod schema (`z.input<typeof X>` and
//      friends) -- Prime Directive #1 makes that the normal spelling of "this type
//      IS metadata", and it lives in ordinary `.ts` files as well as `*.zod.ts`.
//   4. NO metadata surface REFERENCES it, IN CODE. Steps 2-3 only say where the
//      symbol was born; a plain runtime interface pulled into a schema
//      (`z.custom<Iface>()`) or into an object definition has a metadata surface
//      anyway. Comment spans are masked before this scan -- see the next section.
//
// It ALSO inherits the `no-migration-prescription` refusal, so it is a strict
// NARROWING of that catch-all rather than a fifth way around it: everything the
// prescription detector refuses today stays refused. What the author gains is that
// the exemption now rests on a positive, re-checkable finding instead of on a
// detector finding nothing.
//
// ### Why `<path>#<Symbol>` and not a bare name -- measured, and it decided this
//
// #8299 proposed the predicate as "the touched exported symbol appears in no
// `*.zod.ts`, no spec `contracts/**` entry, and no object definition". Run
// literally against its own worked example, that predicate REFUSES #8277:
//
//   git grep -l '\bPackagePublishResult\b' -- '*.zod.ts'
//     packages/spec/src/system/metadata-persistence.zod.ts
//   git grep -l '\bPackagePublishResult\b' -- 'packages/spec/src/contracts/**'
//     packages/spec/src/contracts/metadata-service.ts
//
// Both hits are a HOMONYM. `packages/spec/src/system/metadata-persistence.zod.ts`
// declares its own, unrelated `PackagePublishResult` (`z.input<typeof
// PackagePublishResultSchema>`), and the contracts file merely imports THAT one
// from `../system/metadata-persistence.zod`. Neither has anything to do with the
// service interface #8277 changed. A bare name is not a symbol identity in this
// repo, so the predicate is path-qualified -- the same `<path>#<Symbol>` notation
// `packages/spec/export-origins/*.json` already uses -- and the reference scan in
// step 4 clears a hit file that either declares the name itself or imports it from
// somewhere other than the declaring module.
//
// The pair is the gate's own accept/refuse fixture, and it is real rather than
// synthetic: the SAME NAME under two paths must come out opposite ways.
//
//   packages/services/service-package/src/index.ts#PackagePublishResult   ACCEPTED
//   packages/spec/src/system/metadata-persistence.zod.ts#PackagePublishResult
//                                                                        REFUSED
//
// ### Step 4 reads CODE, not prose -- and what that costs in each direction
//
// Step 4's scan is a text scan over whole metadata-surface files, so for a while
// it counted any occurrence of the name, a DOCBLOCK SENTENCE included. Measured
// on `cae0e248c`: `packages/spec/src/api/contract.zod.ts` line 164 explains what
// `ObjectStackClient.unwrapResponse` keys on, in one sentence inside
// `BaseResponseSchema`'s docblock. `ObjectStackClient` is not imported there, is
// in no schema, and `objectstack migrate meta` has nothing to reach through a
// sentence -- yet the file was the sole `.zod.ts` in the tree naming it
// (`git grep -ln ObjectStackClient -- '*.zod.ts'`), so a genuine, steps-1-to-3
// clean `runtime-interface-only` claim on `packages/client/src/index.ts` was
// refused as UNRESOLVABLE.
//
// Read what that refusal does to an author. The remaining categories are
// `unpublished`, `already-registered` and `no-migration-prescription`; for a
// published rename carrying a real before/after table the first two are false and
// the third is a self-contradiction that would pass only through a detector miss.
// So the blind spot's effect is to push an honest disposition out and a dishonest
// one in -- the #8299 anti-pattern this very block was written to close, arriving
// through the door #8299 built. Prose is therefore masked
// (`scripts/js-comment-mask.mjs`, the one answer in this tree to "comment or
// code?"; a private stripper here would be the drift `check:comment-mask-adoption`
// exists to refuse).
//
// STRING LITERALS ARE NOT MASKED, on purpose. `maskComments` leaves them standing,
// so a symbol named inside a `.describe()` string still refuses this category. It
// is prose to a reader, but the conservative direction here is to REFUSE (#4690)
// and a string is where an authorable value lives -- a name in one may be doing
// work. That boundary is pinned in the self-test, in both directions, so a future
// widening to `comment || literal` has to be argued rather than slipped in.
//
// The teeth are unchanged, and the self-test pins each half: a `*.zod.ts` that
// IMPORTS the symbol still refuses, one that MENTIONS it in code still refuses,
// and a file whose only code-level hit sits beside a prose mention still refuses
// on the code hit. What stops refusing is prose alone.
//
// The rule applies to the OTHER three reads in the same step too, because a
// commented-out line is not a declaration and not an import. Both directions of
// that follow, and both are right: a file carrying a live code mention plus a
// commented-out `interface Sym` used to be waved through as a HOMONYM and is now
// refused on the code mention (a tightening); a file whose only import of the
// symbol is commented out used to be refused as an IMPORT and is now not a
// reference at all (a loosening -- a commented-out import puts nothing in a
// schema). Scanning masked text in one place and raw text in another is how a
// checker ends up asserting two different things about one file.
//
// A same-named MEMBER declaration is a homonym too (#25293). Measured: retiring
// `@objectstack/plugin-email#renderTemplate` was refused because
// `packages/spec/src/contracts/email-service.ts` declares the method
// `IEmailService.renderTemplate` -- the very door the retirement's TO line names --
// and the top-level homonym test read that signature as an unresolvable mention.
// The cure is narrower than the top-level rule on purpose: a top-level declaration
// clears the whole file (it shadows the name), while a member declaration clears
// only its OWN name (`memberDeclarationOffsets`), because a member shadows nothing.
// A bare call, a value, a member access and a string literal in the same file
// still refuse, and the self-test's MH battery pins each.
//
// ### What it deliberately does NOT check
//
// That the author named EVERY symbol their PR touched. Like `registered`, this
// judges the claim that was made, not its completeness -- inferring the touched
// surface is the cross-package retirement detector the 2026-08-07 ruling routes
// around, and it is no more decidable here. What the category buys is that the
// claim is now a checkable sentence about named symbols, which a reviewer can
// re-run, rather than a paragraph they must re-derive.
//
// ## Absence is never a pass (#4690)
//
// A gate that cannot find its input and exits 0 is worse than no gate. Every input
// is asserted non-empty before any verdict, and three of the assertions exist purely
// to catch this gate rotting into a green no-op:
//
//   * PARSER ROT -- every `migrationId` in `spec-changes.json`, GENERATED at the
//     rev being judged by the package's own generator (`generatedWitness`, #22485;
//     there is no committed copy to read), must be found by the source parser. If
//     the registry is ever refactored to a declaration shape the regex stops
//     matching, the id set silently shrinks and every `registered` claim would
//     start failing; this catches it as parser drift instead. The direction is
//     deliberate (projection is a SUBSET of source). Both sides describe the same
//     rev, so a withdrawn id -- which a committed copy that had stopped being
//     regenerated still carried -- is in neither, and cannot red this.
//   * CONVENTION ROT -- a fixed set of synthetic control texts, one per spelling
//     `breakingDeclaration()` is specified to match plus shapes it must NOT
//     match, is driven through the detector on every invocation. If
//     `**BREAKING**` / `major` / `feat!:` are ever reworded wholesale, this gate
//     would match nothing and pass everything in silence; the controls surface
//     that as detector rot the moment convention and detector diverge. They
//     deliberately never read the live stock: "at least one breaking changeset
//     in stock" asserted repo PHASE -- false on every PR in the post-release
//     window, once `version packages` has consumed the breaking population --
//     not detector health (#8658).
//   * VOCABULARY DRIFT (#8299) -- the categories `CATEGORIES` accepts and the ones
//     ADR-0087 documents must be the SAME SET, checked both ways. A category this
//     file accepts that the ADR never described is an exemption an author cannot
//     look up; a category the ADR describes that this file rejects is a documented
//     exemption nobody can claim. #8299 was filed because the second half of that
//     pair had no home at all -- #8277's argument was correct, and there was no
//     named category anywhere for it to cite.
//
// ONE third-party import, and it is LAZY: `typescript`, which `runtime-export-retired`
// reads exports with (#22918). The line that used to open this paragraph -- "Zero
// third-party IMPORTS" -- is retracted by the ruling that added the category. It is
// loaded through `scripts/import-prerequisite.mjs` only when a changeset in the diff
// names that category (`loadExportReader`), so every other run pays nothing for it.
// Inputs need the install, too: the parser-rot witness is generated by
// `packages/spec/scripts/build-spec-changes.ts` under the installed `tsx` (#22485),
// so the real run needs `pnpm install` first -- every CI site that runs it already
// installs before it -- and reports the missing runner as a red input, never as a
// pass. The `--self-test` drives that generator path through a fixture generator
// under this checkout's `tsx` too, and loads the compiler for the seventh category.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitFreeEnv } from './git-env.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { maskComments, maskCommentsAndLiterals } from './js-comment-mask.mjs';
// #16421 — the DIRECTION ARM, read through the fleet's one declaration reader.
// ⛔ Not re-implemented here: the ruling's condition on the arm is that it has a
// single legal spelling read in a single place, and every reader imports it.
import { readClause2Line, readMetadataProtocolLine } from './pm/clause2-line.mjs';
// #16421 — the staging manifest for this gate's own I1/I2 fixture, derived from
// the module graph rather than typed out. Shared with the OTHER site that copies
// this gate into a sandbox (`objectui-changeset-digest.mjs`), because two hand
// lists for one graph is how one of them goes stale unnoticed.
import { stageFirstPartyClosure } from './first-party-closure.mjs';
// #26220 — the workspace's package globs, through the repo's ONE parse of
// `pnpm-workspace.yaml` rather than a hand-kept list of roots (see
// `workspaceGlobsAt`).
import { WORKSPACE_FILE, WorkspaceEnumerationError, isExclusionGlob, parseWorkspaceGlobs } from './workspace-enumerator.mjs';

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
  'H1 (#15915): the header points at CATEGORIES, never restates it': 7,
  'G1: a non-breaking changeset is not this gate\'s business': 1,
  'R1: THE #6011 SHAPE -- declared breaking, no ledger entry, no marker': 5,
  'R2: the catch-all exemption cannot cover a FROM -> TO prescription': 4,
  'G2: THE RECONCILIATION STEP -- register it and the same input passes': 1,
  'R3: `registered` naming an id that does not exist': 3,
  'R4: `registered` claiming a registration this PR did not make': 3,
  'G3: already-registered, naming a genuinely pre-existing entry': 1,
  'R5: already-registered pointing at an id this diff just added': 3,
  'R6: `unpublished` claimed for a published package': 3,
  'G4: `unpublished` on a genuinely private package': 1,
  'R7: an unknown category is refused (the vocabulary is closed)': 3,
  'R8: an empty justification is refused': 2,
  'G5: the catch-all, on a changeset carrying no prescription': 1,
  'D-E2E (#17357): the denial heading, END TO END through `scan()`': 6,
  'F-E2E (#17864): the framed MENTION, END TO END through `scan()`': 2,
  'L-E2E (#18494): the compound-noun label, END TO END through `scan()`': 4,
  'R9: two markers is ambiguous, not "the first one wins"': 2,
  'R10: THE #6419 SHAPE -- a REAL prescription, written in Chinese with -': 4,
  'R11: the same, framed by a HEADING instead of an inline label': 3,
  'G7: ordinary prose arrows under the catch-all stay GREEN': 1,
  'R12: THE #6497 SHAPE -- a rewrite TABLE with no arrow in it': 4,
  'R13: THE #6559 SHAPE -- the frame is the TABLE\'S OWN HEADER ROW': 4,
  'G8: a CAPABILITY table under the same framing stays GREEN': 1,
  'G9: THE #6967 SHAPE -- a changeset that POINTS AT prescriptions': 1,
  'R14: ...and the SAME sentence with the goods still refuses the catch-all': 4,
  'RM (#18745): a rewrite whose TO side is an INSTRUCTION, not an operand': 9,
  'RM1-RM12 (#18745): the retirement arm, and the class it must not widen past': 12,
  'The #8299 category: `runtime-interface-only`': 12,
  '#12881: a metadata surface that names the symbol only in PROSE': 30,
  'The #13080 category: `type-surface-only`': 26,
  'TSO-6048: THE REGRESSION PIN -- the founding case must never admit': 8,
  'TSO-N: the predicate set is pinned BY NAME, never by count': 3,
  'TSO-U: unit pins on predicate 4\'s readers': 30,
  'TSO-D (#15627): a DOTTED member path resolves through the object-literal nesting': 27,
  'TSO-C (#17279): a DOTTED member path resolves through a CLASS body': 17,
  'The #22918 category: `runtime-export-retired`': 49,
  'REX-N: the predicate set is pinned BY NAME, never by count': 3,
  'REX-U: unit pins on the operand grammar and the FROM-side reader': 24,
  'REX-L: the compiler is loaded only when a marker names the category': 6,
  'WS (#26220): ui workspace packages, `.tsx` modules, aliases and shims': 11,
  'IX (#26220): predicate 4 reads an `any` index signature; the entry may be `src/index.tsx`': 52,
  'WP (#26220): a deleted published package is retired whole, `<package>#*`': 55,
  'G6: a changeset that was ALREADY breaking at base is inherited': 1,
  'R15: a changeset RENAMED AND turned breaking in the same commit': 5,
  'G10: a PURE rename of an ALREADY-breaking stock changeset': 3,
  'R16: an `R` row whose BASE side is README.md inherits NOTHING': 4,
  'Input assertions (#4690)': 5,
  'I2c: the #4690 posture SURVIVES the #8658 repair -- a rev with no': 1,
  'I2d: the synthetic convention-rot controls run on a repo whose stock DOES': 4,
  'V3: the real repository is the case that matters -- this gate\'s own vocabulary': 10,
  'W1-W6 (#22485): the parser-rot witness is GENERATED at head, never read from a committed copy': 9,
  'GR1-GR7 (#22554): the migration ledger is GENERATED at build, read from its template and entry files': 13,
  'Unit pins on the two pattern-shaped judgements': 29,
  'the floors: what the new vocabulary must refuse': 9,
  'the floors: labels that are NOT mentions, and mentions that ARE evidenced': 9,
  'D1-D9 (#17357): a heading that DENIES a prescription is not evidence of one': 9,
  'F1-F9 (#17864): a framing word between the governor and the placeholder is': 9,
  'L1-L13 (#18494): a NOUN-PHRASE label is a label, read from the RIGHT': 13,
  'P51-P60: the HARD-WRAPPED mention, and the floors that keep the cure from': 11,
  'X1-X11 (#18493): a framing word inside an IDENTIFIER is not framing': 11,
  'SS1-SS8 (#18494 + #18493): the two directions of ONE predicate, pinned': 8,
  'P62-P68: the framed region closes at the same or a SHALLOWER heading, not': 7,
  'U1-U12 (#8299): unit pins on the runtime-interface-only primitives': 13,
  'MH1-MH12 (#25293): a same-named MEMBER declaration is a homonym; only its own name clears': 12,
  'S1-S5: the `--audit-stock` classifier (#6350)': 7,
  'PRE1-PRE3: `.changeset/pre/` is CONSUMED stock, not pending stock': 4,
  'PRE3: `entries` stays UNFILTERED. A tree whose changesets have all moved': 4,
  'P9-P14 (#7004): the shapes the old entry anchor hid from signal (1)': 7,
  'I1 (#6566): a bare `import` of this module must NOT run the gate': 3,
  'I2 (#6566): the SAME file, run as the entry point, still dispatches': 4,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 58;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/** The ADR-0087 ledger sources. Order matters only for reporting. */
export const LEDGER_SOURCES = [
  'packages/spec/src/migrations/registry.ts',
  'packages/spec/src/conversions/registry.ts',
];

/**
 * The two committed sources of `LEDGER_SOURCES[0]` since #22554, which took the
 * migration registry out of git: it is GENERATED at build, whole, from the
 * hand-written template and one file per entry under the three entry directories
 * (the generator's `KINDS`, `packages/spec/scripts/build-migration-registry.ts`).
 * A rev of that era tracks these and not the registry; every earlier rev tracks the
 * registry and not the template. A merge base can sit in either era, so the era is
 * read off the rev itself — see `migrationLedgerTextAt`.
 */
export const MIGRATION_LEDGER_TEMPLATE = 'packages/spec/src/migrations/registry.ts.template';
/** What writes `LEDGER_SOURCES[0]` from those two in the generated era; the witness runs it first. */
const MIGRATION_LEDGER_GENERATOR = 'packages/spec/scripts/build-migration-registry.ts';
export const MIGRATION_LEDGER_ENTRY_DIRS = [
  'packages/spec/src/migrations/entries/semantic',
  'packages/spec/src/migrations/entries/retired-keys',
  'packages/spec/src/migrations/entries/retired-defs',
];

/**
 * The generator whose output proves the source parser still matches (#4690), and
 * the inputs it reads, relative to the tree root. Since #22485 there is no
 * committed `spec-changes.json` to read: the witness is GENERATED at the rev being
 * judged, by this generator, through its `--out` entry point (the one the publish
 * lane and the pull-request check run). See `generatedWitness`.
 */
const WITNESS_GENERATOR = 'packages/spec/scripts/build-spec-changes.ts';
const WITNESS_INPUTS = ['packages/spec/src', 'packages/spec/scripts', 'packages/spec/package.json'];


/**
 * The closed disposition vocabulary. Adding a category is a deliberate act.
 *
 * Deliberate in TWO places since #8299: a category added here and nowhere else is
 * an exemption with no written description, so `assertInputs` refuses to report a
 * verdict unless this list and the categories ADR-0087 documents are the same set.
 * The ADR is where an author reads what a category means; this list is where the
 * gate decides. They are one decision with two faces, and they fail together.
 */
export const CATEGORIES = [
  'unpublished',
  'already-registered',
  'no-migration-prescription',
  'runtime-interface-only',
  'type-surface-only',
  'runtime-export-retired',
];

/** The ADR whose disposition vocabulary this gate enforces (#8299). */
const ADR_0087 = 'docs/adr/0087-metadata-protocol-upgrade-contract.md';

// ---------------------------------------------------------------------------
// Changeset reading
// ---------------------------------------------------------------------------

/** `.changeset/README.md` is documentation, never a changeset. */
const isChangesetFile = (p) => p.startsWith('.changeset/') && p.endsWith('.md') && !p.endsWith('/README.md');

/**
 * `.changeset/pre/NAME.md` is a CONSUMED prerelease changeset, not pending stock.
 *
 * New in `@changesets/cli` v3 (changesets#2190): a pre-mode `changeset version`
 * MOVES every changeset it consumes out of `.changeset/` and into
 * `.changeset/pre/`, verbatim, instead of leaving it in place and recording it in
 * `pre.json` the way v2 did. Measured on a v3 cut of this repo (209 pending
 * changesets, 17.0.0 -> 17.1.0-rc.0): all 209 move, git scores every one `R100`,
 * and `git ls-tree -r ... -- .changeset` at the cut lists all 209 under `pre/`.
 *
 * That `-r` is why this predicate exists. `changesetDirAt` below lists the
 * directory RECURSIVELY, so from the first v3 cut onwards the entire consumed
 * stock of the open RC window would flow into `--list` and `--audit-stock` — two
 * surfaces whose whole subject is the PENDING stock ("this gate judges diffs, not
 * stock"), and whose numbers a reader takes as the size of the backlog. Every one
 * of those changesets was judged by the diff scan on the PR that introduced it;
 * re-listing them daily for the length of a window is noise that grows.
 *
 * WHERE THIS DELIBERATELY DOES NOT APPLY: the enforcing scan. It reads the diff
 * through `isChangesetFile`, NOT through this predicate, so a changeset ADDED
 * under `.changeset/pre/` in a PR is still judged like any other. Filtering the
 * audit surfaces is a readability fix; filtering the verdict would be a bypass,
 * and `PRE2` in the self-test pins the difference.
 */
const CONSUMED_PRERELEASE_EXCLUDED = '.changeset/pre/';
const isConsumedPrerelease = (p) => p.startsWith(CONSUMED_PRERELEASE_EXCLUDED);

/**
 * Split a changeset into its frontmatter bump entries and its body.
 *
 * The entry regex is deliberately the SAME shape `check-changeset-no-major.mjs`,
 * `check-empty-changeset.mjs` and `objectui-changeset-digest.mjs` use. Four
 * readers of one block must agree on what counts as a declaration, or one of them
 * is judging a different file than it appears to. `check-empty-changeset.mjs`'s
 * self-test asserts that agreement byte-for-byte across all four (#7004).
 *
 * This parser's stake in #7004 is signal (1) of `breakingDeclaration` below: a
 * `major` carrying a trailing YAML comment (or a quoted bump value) used to read
 * as no bump at all, so the frontmatter signal went missing and only signals (2)
 * `**BREAKING` and (3) the `!` summary could still carry the declaration. A
 * changeset using (1) alone — which the ADR-0087 worklist treats as a full
 * declaration — was invisible to this gate.
 *
 * @param {string} text
 * @returns {{ fenced: boolean, bumps: {pkg: string, bump: string}[], body: string }}
 */
export function parseChangeset(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++; // tolerate leading blank lines
  if (lines[i]?.trim() !== '---') return { fenced: false, bumps: [], body: text };

  const bumps = [];
  let end = -1;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '---') { end = j; break; }
    if (/^\s*#/.test(lines[j])) continue; // a whole-line YAML comment declares nothing
    // "<name>": <bump>   |   '<name>': <bump>   |   <name>: <bump>
    // with an optionally quoted bump value and an optional trailing ` # comment`.
    const m = /^\s*["']?([^"':]+)["']?\s*:\s*["']?([A-Za-z]+)["']?(?:\s+#.*)?\s*$/.exec(lines[j]);
    if (m) bumps.push({ pkg: m[1].trim(), bump: m[2].trim().toLowerCase() });
  }
  if (end < 0) return { fenced: false, bumps: [], body: text };
  return { fenced: true, bumps, body: lines.slice(end + 1).join('\n') };
}

/**
 * Does this changeset DECLARE a breaking change?
 *
 * FIVE spellings are in live use in this repo and all five count, because the
 * gate's subject is the author's own declaration and an author who used any of
 * them has declared it:
 *
 *   1. a `major` bump in the frontmatter                (118 of 1304 in stock)
 *   2. a `**BREAKING` marker in the body                 (52)
 *   3. a conventional-commit `!` in the summary line     (175)
 *   4. a `Clause-②` declaration whose ARM reads `narrowing`   (#16421)
 *   5. a `Metadata-protocol: narrowed` declaration       (ruling A, #25105)
 *
 * The union of the first three is 213. Narrowing to any one of them would drop
 * real declarations: #6048's changeset used (1) and (2) and NOT (3), while the
 * launch-window guard `check-changeset-no-major.mjs` pushes breaking changes to
 * `minor` outside pre-mode, which would leave (2)/(3) carrying the signal alone.
 *
 * ## Signal (4), and the hole it closes (#16421)
 *
 * Signals (1)–(3) are all things an author REMEMBERS to type, and (2) — the one
 * that carries breaking-ness during the launch window, when (1) is forbidden
 * outright — is FREE-FORM PROSE. Measured: **#16296** narrowed
 * `sys_job.timezone` / `sys_report_schedule.timezone` to the IANA value domain
 * and shipped to consumers with no banner, no `major` and no `!`, so this gate
 * classified it non-breaking, asked for no ADR-0087 disposition, and every gate
 * in the repo was green. **#14238** did the same one surface earlier. An
 * accept-set narrowing is exactly the change a consumer needs told about, and it
 * was the change with the weakest carrier.
 *
 * Signal (4) replaces "remember the banner" with the declaration the PM protocol
 * already requires on every card and PR: the direction ARM. The author copies
 * one line they have already written into the changeset body, and the gate reads
 * a CLOSED TOKEN rather than a phrase.
 *
 * ⛔ The arm is read through `readClause2Line`, IMPORTED — there is no second
 * parser here, and the ruling made that a condition rather than a preference:
 * one legal spelling, read in one place, by every reader.
 *
 * ⚠️ `widening` adds NO signal, and that is the half of the arm this gate has to
 * get right. A widening is not a break; classifying both arms as breaking would
 * make the reading indistinguishable from a constant, and the self-test pins
 * both directions for exactly that reason.
 *
 * ⛔ Signal (2) is KEPT, not replaced. Dropping the banner while 52 changesets in
 * stock carry it and nothing else would un-declare every one of them — the same
 * "narrowing to any one of them drops real declarations" this docblock has
 * refused since it was written. Signal (4) is the carrier that does not depend on
 * prose; (2) stays the one that already works where it was used.
 *
 * ## Signal (5): the metadata-protocol kind (maintainer ruling A, 2026-10-21)
 *
 * Ruling A moved the changeset LEVEL onto a second declaration line beside the
 * arm — `Metadata-protocol: added | narrowed | semantic | none` — read by the
 * same module. Of the four kinds exactly one is a break by definition:
 * `narrowed` is "a key removed or tombstoned, a value refused, a requirement
 * tightened", an accept-set narrowing of what an author writes against, and
 * ruling A keeps the BREAKING carriers on it unchanged. So a changeset that
 * declares `narrowed` has declared breaking, and this gate asks it for its
 * ADR-0087 disposition exactly as it asks a changeset carrying the arm — the
 * level gate refuses `narrowed` beside a line with no `(narrowing)` arm, so the
 * two signals ordinarily travel together; this one closes the day they do not.
 * `added`, `semantic` and `none` add NO signal: a new key, a changed default and
 * a non-protocol change are not breaks, and the self-test pins all three.
 *
 * @param {ReturnType<typeof parseChangeset>} parsed
 * @returns {{ breaking: boolean, signals: string[] }}
 */
export function breakingDeclaration(parsed) {
  const signals = [];
  if (parsed.bumps.some((b) => b.bump === 'major')) signals.push('major');
  if (/\*\*BREAKING/i.test(parsed.body) || /^\s*BREAKING[ -]CHANGE/mi.test(parsed.body)) signals.push('BREAKING');
  const summary = (parsed.body.trim().split(/\n/)[0] || '').replace(/^\*\*|^#+\s*/, '');
  if (/^[a-z]+(\([^)]*\))?!:/.test(summary)) signals.push('bang');
  // (4) The direction arm. A `malformed` or `near-miss` reading declares
  // nothing HERE and must not: this gate judges changesets, and the refusal that
  // sends a seat to fix an unreadable declaration is `pm/post-stamped.mjs`'s, at
  // the moment the claim carrying it is written.
  const decl = readClause2Line(parsed.body);
  if (decl?.kind === 'declared' && decl.arm === 'narrowing') signals.push('clause-②-narrowing');
  // (5) The metadata-protocol kind, same reader module, same calibration: only
  // a DECLARED `narrowed` is a signal; a malformed or near-miss line declares
  // nothing here, and the level gate is what refuses it on the PR.
  const kind = readMetadataProtocolLine(parsed.body);
  if (kind?.kind === 'declared' && kind.value === 'narrowed') signals.push('metadata-protocol-narrowed');
  return { breaking: signals.length > 0, signals };
}

// ---------------------------------------------------------------------------
// Migration-prescription detection
//
// ## What went wrong the first time (#6419)
//
// The original detector had an English branch and a Chinese branch, and BOTH
// required the literal uppercase words `FROM` and `TO`:
//
//     迁移:FROM → TO                          (the TEMPLATE PLACEHOLDER)  -> caught
//     迁移:`aggregate:` → `aggregations:`     (a REAL prescription)       -> MISSED
//
// So it detected the SHAPE OF ONE HISTORICAL CHANGESET (#6048's) rather than the
// presence of a prescription, and the failure was worst exactly where it mattered
// most: a prescription is only useful when it names real identifiers, so the
// better an author wrote one, the more invisible it became. That is a gate not
// checking what it claims to check, so it is repaired rather than documented.
//
// ## What replaced it
//
// Four branches, unioned. Branches 2-4 were each ADDED without touching the ones
// before it, so across #6419 / #6497 / #6559 the detector was a strict SUPERSET at
// every step: nothing that used to be refused could slip through, and the
// `no-migration-prescription` exemption could only get harder to claim.
//
// ⚠️ That is no longer true of the WHOLE detector, and saying so is the point:
// #6967 NARROWED branch 1, because a superset-only detector can only ever add false
// positives, and branch 1 had one that hard-blocked its author (see the #6967
// section below for what left and what was measured). The superset property still
// holds among branches 2-4 and is still structural there.
//
//   1. THE LABEL CONVENTION -- `FROM`/`TO` USED as a section label, table header
//      or code comment. Measured: this is a genuine house convention, not one
//      changeset's quirk (`## FROM → TO` x16, `FROM → TO:` x15, `**FROM → TO**`
//      x11, `Migration (FROM → TO):` x4 in the current stock). Since #6967 the
//      word USED is load-bearing: an occurrence that is merely MENTIONED --
//      `carries its FROM → TO guide` -- evidences nothing (see below).
//
//   2. A FRAMING-ANCHORED REWRITE -- a REWRITE (`X → Y` where both sides are
//      code-ish: a backticked span, or a dotted/slashed identifier path) that
//      appears either ON a line carrying migration framing, or ANYWHERE UNDER a
//      heading that carries it -- including under that heading's own SUB-headings,
//      which is #12996. This is the branch that catches
//      `**迁移**:`aggregate:` → `aggregations:`` and every other honestly-written
//      prescription in either language.
//
//   3. A FRAMED REWRITE TABLE -- a markdown table row inside a heading-framed
//      region, carrying an OPERAND in two or more DISTINCT cells (#6497). Branches
//      1 and 2 both require an ARROW, and a large class of this repo's changesets
//      writes its rewrite instructions as a two-column table under `## Migration`
//      with no arrow anywhere:
//
//          ## Migration
//
//          | Wrote                                   | Write instead                 |
//          | ---                                     | ---                           |
//          | `new HttpServer(new HonoHttpServer(p))` | register the `HonoHttpServer` |
//
//      That is `runtime-httpserver-wrapper-retired.md` (#5122), verbatim shape. The
//      arrowless table was read as "no prescription at all", so the changeset
//      landed in the exempt bucket -- and the lesson from #6419 applies word for
//      word one spelling over: a table that spells out "what you wrote / what to
//      write instead" carries MORE information than one arrow line, and was
//      precisely the shape the detector could not read. In a table the CELL
//      BOUNDARY does the arrow's job, which is why the arm asks for the same thing
//      the arrow arm asks for -- code-ish operands on two sides -- and reads the
//      `|` instead of the `→`.
//
//   4. A HEADER-FRAMED REWRITE TABLE -- the same table row, but the framing comes
//      from the table's OWN HEADER CELLS rather than from a heading above it
//      (#6559). Branch 3 still needs a migration heading somewhere; a large class
//      of this repo's changesets never writes one, because the header row already
//      says what the two columns are:
//
//          **Migration.**
//
//          | Wrote                                     | Write instead            |
//          | ---                                       | ---                      |
//          | `await storage.list('attachments/task/')` | query the `sys_file` rows |
//
//      That is `storage-service-list-retired.md` (#5540), verbatim shape -- one of
//      ELEVEN declared-breaking stock changesets that held the
//      `no-migration-prescription` exemption through this gap. The framing here is
//      a closed vocabulary of COLUMN words (OLD_COLUMN_RE / NEW_COLUMN_RE), not the
//      framing words branches 2 and 3 use, and both a column naming what the author
//      HAD and a later one naming what to write INSTEAD are required. That pairing
//      is the whole anchor: this stock is full of two-column tables, and almost all
//      of them compare BEHAVIOUR rather than prescribe a rewrite.
//
// ## What it moved (measured on the stock, every version run over it)
//
// #6419, branch 2 added. 1342 changesets, 235 of them declared-breaking (the only
// population this gate judges). Old detector: 113 hits, 87 of them breaking. New
// detector: 122 hits, 92 breaking. NINE newly flagged, ZERO no longer flagged --
// the superset property is a measurement, not a claim. Seven of the nine are
// prescriptions the old pattern missed (`r.deleted` → `r.success`; `改名
// HttpMethodSchema → HttpMethodSubsetSchema`; `rename `group` → `team``; a `OLD.x`
// → `previous.x` migration table; ...). Two are false positives, both on changesets
// that declare NO breaking change and are therefore never judged -- an error-message
// template diagram (`[ Did you mean `k1` → `canonical`? ]`) and a docs-only
// changeset describing a theme engine's internal token mapping. Verdict impact of
// the false positives on the current tree: zero.
//
// #6497, branch 3 added. 1384 changesets, 241 declared-breaking. Before: 129 hits,
// 97 breaking. After: 133 hits, 101 breaking. FOUR newly flagged, ZERO no longer
// flagged, and the superset property is STRUCTURAL here rather than measured --
// branches 1 and 2 are evaluated first and return on the spot, so the table hit is
// only ever consulted when they found nothing (it is `old(body) ?? table(body)`,
// written as one pass).
//
// #6559, branch 4 added -- the table framed only by its OWN HEADER ROW. 1402
// changesets, 245 declared-breaking. Before: 136 hits, 104 breaking. After: 151
// hits, 115 breaking. FIFTEEN newly flagged, ZERO no longer flagged, and zero
// existing hits changed branch or evidence line. The superset property stays
// STRUCTURAL for the same reason one level down: this arm's hit is held back like
// branch 3's and consulted only after it, so the function is exactly
// `arrowBranches(body) ?? framedTable(body) ?? headerFramedTable(body)`.
//
// Eleven of the fifteen declare breaking, which is the number #6559 set out to
// reach -- but NOT the same eleven it named, and the difference is the honest part.
// Ten of its named eleven are here; `adr-0114-field-error-catalog.md` is not,
// because its header is `| Was | Now |` and admitting `was` costs more than it buys
// (measured below). The eleventh is `script-branch-keys-retired.md`, a spelling
// (`| Retired | Use instead |`) the card had not enumerated. A closed vocabulary
// derived from the stock finds spellings a hand-list misses, and loses ones a
// hand-list assumed.
//
// The arm's FALSE-POSITIVE surface was measured before it was written, IN ISOLATION
// over the whole stock -- every body it fires on, not just the fifteen it newly
// wins, because a future changeset can hit this arm alone. It fires on 22 of 1402,
// 18 of them declared-breaking, and all 22 are genuine rewrite prescriptions on
// inspection. ZERO false positives, breaking or not.
//
// It also collects, for free and without the false positive, the ONE true positive
// #6558 measured for the rejected `MIGRATION_FRAMING_RE`-on-the-header shortcut:
// `filter-icontains-and-regex-retirement.md` (`| 原写法 | 改写为 |`). The shortcut
// bought that row and `rate-limit-config-dual-source-c9.md` with it; a vocabulary
// of COLUMN words rather than framing words reads the first and not the second,
// because `(renamed)` there names a column and never opens one (P34 pins it).
//
// The table arm's FALSE-POSITIVE surface was measured before it was written, on the
// whole stock rather than on the four changesets that motivated it: it fires on 7
// changesets in 1384, ALL SEVEN declared-breaking, and all seven are genuine rewrite
// prescriptions on inspection -- three were already refused via branch 1, and the
// four new ones are `runtime-httpserver-wrapper-retired.md`,
// `etl-author-shape-aliases.md`, `retire-three-deprecated-aliases.md`,
// `unknown-key-strictness-ui-batch15.md`. Zero false positives, breaking or not.
// That is not luck; it is what the framing anchor buys, and the two wider rules
// measured alongside it (below) show what the same table rule costs without it.
//
// ## #12996, the FOURTH spelling -- a framed region that closed at ANY heading
//
// Branches 2 and 3 read a rewrite only INSIDE a framed region, and until #12996 a
// region opened by a framing heading closed at the NEXT HEADING OF ANY LEVEL. So a
// `## Migration` section that organises its rewrite tables under `###` sub-headings
// -- the ordinary way to write a two-part rename -- lost its framing before the
// first table row was read. Measured through the gate's own exported function; A
// and B differ BY ONE LINE:
//
//   A  `## Migration` + a rewrite table                        -> framed-table
//   B  `## Migration` + `### Method namespace` + the same table -> null
//
// The live instance is `.changeset/adr0006-d2-client-environments-namespace.md`,
// which carries a `## Migration` section with two `| before | after |` rewrite
// tables under `###` sub-headings and holds `not-required (runtime-interface-only
// ...)`. Its disposition is honest on its own terms and it passes -- but it passed
// WITHOUT THE PRESCRIPTION ARM EVER BEING CONSULTED, which is not the same as
// passing it, and `runtime-interface-only` inheriting the prescription refusal is
// the whole reason it is a NARROWING of `no-migration-prescription` rather than a
// fifth way around it (#8299).
//
// The fix tracks heading DEPTH: a heading closes every region nested at or outside
// its own level and opens one of its own if it carries framing, so regions
// SHALLOWER than it survive. The superset property is STRUCTURAL rather than
// measured, one level up from where #6497 and #6559 established it: the predicate
// became "some heading on the current path carries framing", and the MOST RECENT
// heading -- the whole of the old predicate -- is always on that path. No body the
// old scan framed can stop being framed.
//
// Measured over the stock at `4d94823a36` (419 changesets, 53 declared-breaking):
// 34 hits / 23 breaking -> 35 / 24. ONE changeset newly flagged, and it is the live
// instance above; ZERO no longer flagged, ZERO changed branch or evidence line. The
// gate is forward-only, so that row -- already on main and already breaking at any
// future merge base -- is never re-judged; what changes is that the next changeset
// written this way is asked the question instead of being waved through.
//
// ⚠️ The card's smaller alternative was measured and REJECTED, and the first half of
// the measurement is the surprising one: widening `OLD_COLUMN_RE` to admit `before`
// buys NOTHING ON ITS OWN (+0 changesets), because `after` is not a NEW column word
// and the header-framed arm needs both. Admitting `after` as well takes it to +3 /
// 2 breaking, and TWO of the three are behaviour comparisons rather than rewrites:
// `compound-meta-door-mode-draft.md` (`| Request | Before | After |`, one request's
// response before and after the change) and `oauth-resource-identifier-sourced-255.md`
// (`| | before (1024) | after (255) |`, two `information_schema` readings) -- the
// second DECLARES BREAKING and holds `not-required (no-migration-prescription)`, so
// the false positive would hard-block an author entitled to their exemption. That
// is exactly the trade #6559 measured and refused for `was`/`now`, which P33 pins;
// `before`/`after` is named in that same paragraph as this repo's
// behaviour-comparison header vocabulary. It also addresses nothing about nesting.
//
// None of the three earlier repairs is subsumed by this one and none is removed:
// #6419 and #6497 added ARMS (a real rewrite under framing; a table with no arrow),
// #6559 added an arm that needs no heading at all, and this changes only WHERE a
// heading-opened region ends. The four are independent, and the recurrence is not
// that the repairs were too small -- it is that framing has more spellings than any
// one of them enumerated.
//
// ## Why anchored on framing rather than on the arrow alone (measured)
//
// An arrow is not a prescription. The current stock carries 933 distinct
// arrow-bearing lines across 480 changesets, and the great majority are ordinary
// prose: pipelines (`analytics→engine`), version steps (`16→17`), request/response
// traces (`→ 200 {...}`), dependency directions (`runtime → objectql`). Requiring
// code-ish operands on both sides removes the numeric and single-word cases but
// still leaves behavioural mappings that nobody has to rewrite anything for
// (`.yml` → `'yaml'` inside a format detector, `test` → `development` inside a
// NODE_ENV normalizer). Framing is what separates "here is what you must rewrite"
// from "here is what the code does".
//
// ## The residual blind spot, stated rather than hidden (measured, re-measured)
//
// ⚠️ The version of this paragraph that shipped with #6419 was WRONG, and #6497 is
// what it cost. It said the residue was the UNFRAMED rewrite table -- which read as
// "everything an author frames is seen". It was not: a table framed by a textbook
// `## Migration` heading was missed too, because both branches required an arrow
// and a table has none. Four declared-breaking changesets were holding the
// `no-migration-prescription` exemption on exactly that gap. A self-description
// that under-states a gate's blind spot is worse than none, because it is what the
// next reader trusts instead of measuring; so the number below is what remains
// AFTER branch 3, and it says which shapes, not just how many.
//
// The two shapes this paragraph listed after #6497 -- FRAMED ONLY BY THE TABLE'S
// OWN HEADER CELLS (14 / 11) and FRAMED BY A LABEL, NOT A HEADING (4 / 2) -- are
// what branch 4 closed in #6559. One correction is owed to whoever reads the old
// numbers: those two were described as overlapping, and on the table arm they turn
// out to be strictly NESTED. Measured on the pre-#6559 baseline, letting a bold
// label open a framed region for the TABLE arm wins 13 changesets / 10 breaking --
// and branch 4 catches every one of the 13 on its own. A changeset that writes
// `**Migration.**` above a rewrite table also writes that table with an old/new
// header row, every time, in this entire stock. So there is no label-framed table
// arm: it would be dead code the day it shipped, and it is not shipped.
//
// What is still missed, re-measured over the 1402-changeset stock AFTER branch 4
// (each number is "changesets / of those, declared-breaking"):
//
//   * NO FRAMING AT ALL -- an `old` → `new` list under a plain heading with no
//     migration word anywhere near it: 131 / 20. Typically the
//     `unknown-key-strictness-*` and `adr-0112-*` batches. This is the honest
//     residue of anchoring on framing, and it is deliberate.
//   * AN UNFRAMED rewrite TABLE -- coded cells on two sides, but neither a framing
//     heading nor an old/new header row: 95 / 18. The table analogue of the line
//     above, and refused for the same measured reason (see the rejected rules).
//     Union of the two, since bodies carry both: 205 / 33.
//   * NO REWRITE PAIR AT ALL -- the IMPERATIVE-SENTENCE prescription: no arrow, no
//     table, just "write `$icontains` for the case-insensitive substring search,
//     `$contains` for a case-sensitive one". Recorded on #6559 (05:06Z) against
//     `.changeset/regex-retirement-icontains-drivers.md`, which is on PR #6549 and
//     not yet on main, so it is not in the 1402 above and has no stock number here.
//     It is not a framing gap -- both branches need a matchable "X becomes Y" and
//     this shape has none -- so widening the vocabulary cannot reach it. It needs a
//     different criterion (2+ replacements in code spans on a line with an
//     imperative verb), whose false-positive surface is intuitively much larger:
//     any changeset enumerating API usage would hit it. Falsify before implementing.
//   * AN ARROWLESS `FROM ... TO ...` LINE -- `- FROM <x> TO <y>`, each side a code span --
//     the convention's two words as a list line with no arrow between them, so branch 1's
//     placeholder pattern never matches it and no branch reads it. Measured at
//     `018b077fb` (417 changesets): 6 carry such a line naming code, 4 of them
//     declared-breaking, and the detector reads none of the 6; one of the four
//     (`15205-email-templates-resolve-registry.md`) held `no-migration-prescription`
//     on exactly this miss. Deliberately left out of reach here -- the ruling on
//     #22918 kept the detector's arrow rule unchanged -- and READ instead by
//     `runtime-export-retired`'s own `readFromBlock`, which is the category such a
//     retirement now claims.
//
// ## #18745 -- the RETIREMENT arm: a rewrite whose TO side is an INSTRUCTION
//
// Every arm above reads a rewrite as a PAIR: an old name and a new one, across an
// arrow or across a cell boundary. That is the shape of a RENAME. A REMOVAL has no
// new name, so an author who writes the most careful possible prescription for one
// writes the only thing there is to write -- an instruction:
//
//     **Migration -- `api: { ... }` -> delete the property.**
//
// That is `.changeset/18318-evalcontext-no-query-api.md` (#18318, PR #18736), and it
// is the same failure this header records against #8277 one section down, arriving
// through a different door. The line carries the framing word, it carries the arrow,
// and its FROM side is a proper backticked operand. It was missed on ONE predicate:
// `REWRITE_RE` requires an OPERAND on BOTH sides, and `delete the property` is an
// instruction, not a name -- so branches 2 and 3 never saw the line, the body read as
// carrying no prescription, and `not-required (runtime-interface-only ...)` was
// verified against a silence. The verdict on that PR was sound -- its author verified
// all four `runtime-interface-only` predicates POSITIVELY and handed the detector miss
// up rather than letting it carry the claim -- and that is exactly why it is worth
// repairing: the next author's claim would have rested on the silence.
//
// THE TWO MISSES ARE DIFFERENT HOLES, and the distinction decides what a repair can
// cover. #8277's prescription is `read `result.driverFault?.message` where you read
// `result.error`` -- no arrow, no table, no pair the vocabulary can match. It is the
// IMPERATIVE-SENTENCE residue listed above, still deliberately out of reach, and this
// arm does not move it one inch (RM11/RM12 pin that, so a later author widening toward
// it has to argue with a red test rather than with prose). #18745's prescription has
// the pair shape and fails only on the RIGHT-HAND operand. Repairing the second does
// not repair the first, and a repair that claimed to would be the over-matching
// criterion the residue paragraph says to falsify before implementing.
//
// Measured before it was written, over every `.changeset/*.md` blob in this
// repository's history -- 5524 unique blobs -- the framed arrow lines whose right side
// is NOT an operand number THREE, and every candidate removal vocabulary tried (the
// bare imperatives; plus `unset`/`omit`; plus `none`/`nothing`; plus the past
// participles; plus the Chinese arm) flags the SAME TWO changesets and no others:
// `18318-evalcontext-no-query-api.md` and `drop-dead-env-template-flag.md`
// (`**Migration.** `os environments create --template <id>` -> drop the flag`). Both
// are genuine removal prescriptions on inspection. Zero false positives at any width
// -- so the class shipped is the NARROW one, because a wider one buys nothing measured
// and each extra word is a claim somebody later has to defend. The third non-operand
// right side in the stock, `lookup-reference-target-gate.md`, is running prose about
// resolution rungs, and this arm leaves it alone.
//
// Over the CURRENT stock (414 changesets) the arm moves exactly one verdict, from
// `null` to `framed-removal`, and the other 413 are byte-identical before and after.
// The one it moves holds `not-required (runtime-interface-only ...)`, so it WOULD be
// refused if a future PR touched that file and the gate re-judged it -- this gate only
// judges changesets a diff adds or modifies, so nothing reds today. That reading was
// handed back rather than acted on: ⛔ a detector repair does not get to edit somebody
// else's changeset on its way past.
//
// One boundary is DELIBERATE and measured rather than assumed: `carriesConcreteRewrite`,
// the corroboration predicate branch 1 consults for a prose-governed placeholder, is NOT
// taught this vocabulary. Over the same history, 298 blobs carry the `FROM`/`TO`
// placeholder at all, and of those ZERO are both missed today and carry a retirement line
// anywhere in the body -- so the widening would buy nothing and would loosen a predicate
// whose whole licence to be loose is that it only ever grants back an occurrence the
// positional rule already found. Re-measure before changing that.
//
// ## #6967 -- the first NARROWING, and why the direction reversed
//
// #6419, #6497 and #6559 all fixed UNDER-matching, and each is written above as a
// strict superset. #6967 is the mirror image: branch 1 read a REFERENCE to a
// prescription as a prescription. The specimen is `.changeset/v17-rc-anchor.md`,
// the v17 version anchor, whose only migration text is
//
//     Migration: each breaking change's own changeset carries its FROM → TO guide
//     (grep the CHANGELOG for `!:` entries)
//
// It retires nothing; it says where the prescriptions live. And unlike a
// false-positive in a reporting tool, this one HARD-BLOCKS: all four dispositions
// were closed to its author at once -- the catch-all refused by the contradiction
// check below, `registered` and `already-registered` with no entry to name, and
// `unpublished` false because `@objectstack/spec` publishes. The author's only
// remaining move was to reword a truthful sentence, which is a gate editing prose.
//
// The rule: an occurrence of the placeholder counts when it is USED as a label --
// nothing but markup, a sentence boundary or a framing word immediately before it
// -- or, when a word DOES govern it, when the body independently carries a concrete
// rewrite (`labelPositioned` / `carriesConcreteRewrite`). Every occurrence is now
// scanned rather than only the first, because a body can cite the convention in one
// paragraph and use it in the next.
//
// Measured over the 1578-changeset stock (264 declared-breaking), old detector vs
// new: 169 hits / 126 breaking -> 167 hits / 125 breaking. TWO changesets leave, ONE
// of them declared-breaking, and both are mentions on inspection:
// `v17-rc-anchor.md` (the specimen) and `direct-mount-follows-apipath.md`
// (`唯一的 FROM → TO 落在部署方自己的代理配置上` -- in a paragraph that says in the same
// breath that ADR-0087 has nothing to register). ZERO changesets newly flagged and
// ZERO changed branch, so no arm added by #6419 / #6497 / #6559 moved at all.
//
// A THIRD count moved and is reported because it is what an author argues with: 50
// hits changed their EVIDENCE LINE, 48 of them from an EMPTY string. Branch 1's
// first alternative may consume the newline ENDING the previous line as its
// `[^A-Za-z]` delimiter, and the old code derived the line number from the match's
// start -- so every placeholder opening a line was evidenced by the line above it,
// blank whenever a paragraph break sat there. `--audit-stock` had been printing
// `prescription (from-to-label):` with nothing after the colon for those rows.
//
// ⚠️ The WIDER narrowing was written first and REJECTED on measurement: "the prefix
// contains no letters at all" reads a label that follows a finished sentence on the
// same line (`it. FROM → TO:`) as prose, and cost FIVE real prescriptions,
// `app-dead-authoring-keys.md` (`**Removed keys and their prescriptions
// (FROM → TO):**`, declared-breaking) among them. Governance is ONE character; "a
// letter appears somewhere to the left" is a whole clause. P42-P45 pin the
// difference.
//
// ⚠️ Also rejected, and it is the card's own first suggestion (#6967): requiring the
// framed region to contain a concrete rewrite pair, full stop. Measured before it
// was written -- 97 of the 133 placeholder-bearing changesets carry NO arrow between
// two coded operands anywhere, and most are ordinary prescriptions
// (`FROM → TO: delete the block. \`os migrate meta --from 16\` removes it
// automatically`). The imperative-sentence prescription named in the residue list
// above is exactly that shape. So corroboration is a FALLBACK for the ambiguous
// case, never the criterion.
//
// That blind spot is CLOSED (#7094). Prose here is HARD-WRAPPED at ~80 columns, so a
// mention that wraps onto a fresh line puts its placeholder at column 0 with its
// governing word on the line above; `labelPositioned` now asks that line the
// question when the placeholder opens its own and the line above is prose (not a
// heading, table row or fence marker). #7078 declined this because "a wrapped LABEL
// is just as common", and it is RIGHT about that for the in-line predicate: reusing
// `GOVERNING_WORD_RE` across the wrap reads every line-final letter as governance
// and turns a label under any ordinary sentence into a mention. That version was
// written first and its own positive control killed it (P52). What separates the two
// shapes is a NARROWER question asked only across the break -- a closed class of
// words that cannot END a segment (`carry their` continues; `ends the line here`
// does not). See `WRAPPED_GOVERNOR_RE`. Measured over the full 1792-changeset stock:
// 176 hits / 132 breaking -> 174 / 132. TWO changesets leave, NEITHER declared
// breaking, and both are mentions on inspection -- `changelog-ships-in-tarball.md`
// (the specimen) and `notification-retirement-evidence-corrected.md` (a docs-only
// correction narrating which commits touched a published FROM → TO). The residue and
// the `--audit-stock` `!` candidate list are UNCHANGED at 97 / 52.
//
// ⚠️ One more correction is owed to this list, in the same spirit as the one above:
// it did NOT name the shape #12996 turned out to be, a rewrite table under a
// SUB-heading of a framing heading. That shape was not a residue anyone had decided
// to accept -- it was invisible, and the list read as though everything a heading
// framed was seen. It is closed now (see the #12996 section), and the lesson for
// whoever writes the next version of this paragraph is that the residue is only as
// honest as the shapes someone thought to try.
//
// Anyone widening this later should start with the first two, with these numbers to
// beat, and should re-measure the false-positive surface FIRST -- as #6419, #6497
// and #6559 all did, and as the six rules below were rejected for failing.
//
// SIX wider rules were measured and REJECTED as noisier than they are useful.
//
//   * (#6419) firing on any line carrying >=2 rewrites takes the declared-breaking
//     hit count 92 -> 102 but adds 35 changesets to hand-check, of which a clear
//     minority are prescriptions.
//   * (#6419) firing on ANY code-to-code arrow takes it to 250 hits / 113 breaking
//     and is plainly a different check (it flags behaviour tables and worked
//     examples).
//   * (#6497) firing on any coded table row with NO framing anchor -- the table
//     analogue of the arrow-alone rule -- newly flags 114 changesets, 33 of them
//     declared-breaking. Changeset bodies use tables for capability matrices,
//     behaviour comparisons and version comparisons far more often than for
//     rewrites, and this rule cannot tell those apart.
//   * (#6497) taking the framing from the TABLE'S OWN HEADER ROW via the existing
//     MIGRATION_FRAMING_RE -- tempting, since it needs no new vocabulary and reads
//     `| 原写法 | 改写为 |` correctly. Measured, it buys ONE true positive with no
//     verdict impact (`filter-icontains-and-regex-retirement.md`, which declares no
//     breaking change and is therefore never judged) and costs ONE false positive:
//     `rate-limit-config-dual-source-c9.md`, whose table is a two-TYPE comparison
//     matrix -- `| | @objectstack/spec/shared (unchanged) | .../integration
//     (renamed) |` -- caught only because the word `renamed` sits in a header cell
//     naming a column, not framing a rewrite. Rejected on that trade alone: nothing
//     gained on the judged population, a new way to be wrong on it. (Branch 4 wins
//     that same true positive with a COLUMN vocabulary and without the false
//     positive -- P34 pins the matrix out.)
//   * (#6559) admitting `was` as an OLD column word, which would read
//     `| Was | Now |` and win `adr-0114-field-error-catalog.md`, a real
//     declared-breaking prescription. Refused: `was`/`now` (with `before`/`after`,
//     `之前`/`之后`, `改前`/`改后`, `修复前`/`修复后`) is this repo's BEHAVIOUR-comparison
//     header vocabulary, not its rewrite vocabulary. The stock carries it on
//     `| route | was | now |` (wire envelopes), `| compiler | was | now |`,
//     `| | was | now |` (a type-inference probe table) and a dozen more, none of
//     which prescribes rewriting anything. One true positive against at least four
//     false ones on the same header spelling, and no way to separate them from the
//     header row -- so `adr-0114-field-error-catalog.md` stays missed ON PURPOSE.
//     P33 pins the refusal so a later author cannot "fix" it without meeting this.
//   * (#6559) letting a bold LABEL line (`**Migration.**`) open a framed region for
//     the ARROW branches as well as the table, rather than for the table alone.
//     Measured: 11 newly flagged / 6 breaking, and at least THREE are plain false
//     positives -- a conformance-case table (`{d: {$null: true}}` → `['3','4']`), an
//     env-normalizer mapping (`production`/`prod` → `production`) and a body whose
//     matched line is unrelated prose about `_packageId`. A label with no closing
//     heading frames the REST OF THE DOCUMENT, which is why. It also relabels 13 of
//     branch 4's hits to `framed-table`, hiding which arm read them. Rejected for
//     both. (The label-framed TABLE arm was rejected separately, as dead code --
//     see the nesting note above.)
//
// An honestly-scoped detector beats a noisy one here because a FALSE POSITIVE has
// no honest escape: the author is refused an exemption they are entitled to and the
// closed vocabulary offers them nothing else -- which is the #6419 shape itself,
// one category over.
//
// Consequence to keep in mind when reading a green run: this branch answers
// "did the author FRAME a rewrite as a migration", not "is a rewrite required".
// It is a contradiction check on one exemption, never a trigger and never a
// retirement detector.
// ---------------------------------------------------------------------------

/** The three arrow spellings this repo's changesets use. */
const ARROW = '(?:→|->|—>)';

/**
 * One side of a rewrite: a backticked code span, or a dotted/slashed identifier
 * path. A BARE word is deliberately not an operand -- `runtime → objectql` is a
 * dependency direction, not a rename -- and neither is a bare number, which is
 * what keeps `16 → 17` and `60 → 3` out.
 */
const OPERAND = '(?:`[^`\\n]+`|[A-Za-z_$][A-Za-z0-9_$]*(?:[./][A-Za-z0-9_$]+)+)';

/** `X → Y`, both sides code-ish. Stateless (no `g`): it is used inside a loop. */
export const REWRITE_RE = new RegExp(`${OPERAND}\\s*${ARROW}\\s*${OPERAND}`);

/** One operand anywhere in the text -- the per-CELL half of the table arm (#6497). */
const OPERAND_RE = new RegExp(OPERAND);

/**
 * The RIGHT-HAND side of a RETIREMENT prescription -- the half of a rewrite whose
 * answer is "there is nothing to write instead" (#18745).
 *
 * `REWRITE_RE` wants a code-ish OPERAND on both sides, and for a RENAME that is
 * exactly right: the author is telling a consumer what to type instead. A REMOVAL
 * has no such operand to name, so the author writes the only thing there is to
 * write -- an instruction:
 *
 *     **Migration -- `api: { ... }` -> delete the property.**
 *
 * That is `.changeset/18318-evalcontext-no-query-api.md`, and it was missed on
 * exactly ONE predicate. It carries the framing word, it carries the arrow, and its
 * FROM side is a proper backticked operand; `delete the property` is not an
 * OPERAND, so `REWRITE_RE` never matched and branches 2 and 3 never saw the line.
 * A prescription saying "delete it" prescribes as much consumer work as one saying
 * "write `x` instead", and it contradicts the same exemption -- which is the whole
 * teeth of `no-migration-prescription` and of the `runtime-interface-only`
 * narrowing that inherits it (#8299).
 *
 * ⚠️ A CLOSED CLASS, and IMPERATIVE only. Derived from the stock rather than
 * invented: measured over every `.changeset/*.md` blob in this repository's history
 * (5524 unique blobs), the framed arrow lines whose right side is NOT an operand
 * number three, and the removal spellings among them are `-> delete the property`
 * (`18318-evalcontext-no-query-api.md`), `-> drop the flag`
 * (`drop-dead-env-template-flag.md`) and `-> remove (never had an effect)`
 * (`remove-dead-metadata-props-2377.md`, already caught by an older branch on
 * another line). The other two non-operand right sides are running prose in
 * `lookup-reference-target-gate.md`, and this class leaves both alone.
 *
 * ⚠️ The Chinese arm is this file's ordinary parity -- `MIGRATION_FRAMING_RE`,
 * `OLD_COLUMN_RE` and `NEW_COLUMN_RE` each carry one -- and it adds ZERO hits over
 * that same 5524-blob history: it buys no measured true positive and introduces no
 * measured false one. It is here so the arm is not shaped by the language the
 * author happened to write in, which is the "the only passing form was to avoid a
 * word" failure `HEADING_DENIAL_RE` documents one rule over.
 *
 * ⚠️ `none` / `nothing` in ARROW position was measured and REFUSED. The stock
 * evidences that spelling only as a table CELL (`| AuditConfigSchema.enabled |
 * none -- ... |`), which branch 4 already reads, and in arrow position it has a
 * competing reading an imperative verb does not: `... -> none of this changes what
 * you write` is a running sentence, not a prescription. Nothing measured gained, a
 * new way to be wrong -- the trade #6559 refused for `was`/`now`.
 *
 * ⚠️ The trailing lookahead is load-bearing in the NARROW direction. Without it
 * `drop` reads `drop-in replacement` and `delete` reads `deletes rows in batches`,
 * and neither is an instruction to remove the thing on the left.
 */
const REMOVAL_INSTRUCTION = '\\**\\s*(?:(?:delete|remove|drop)(?![A-Za-z-])|删除|移除|删掉|去掉)';

/**
 * `X → delete it` -- an operand RETIRED rather than renamed. Stateless (no `g`):
 * it is used inside a loop, exactly as `REWRITE_RE` is.
 *
 * Read ONLY under the same framing branches 2 and 3 require. An unframed
 * `X -> delete ...` stays invisible on purpose: framing is what separates "here is
 * what you must rewrite" from "here is what the code does", and this arm buys no
 * exception to that.
 */
export const RETIREMENT_RE = new RegExp(`${OPERAND}\\s*${ARROW}\\s*${REMOVAL_INSTRUCTION}`);

/**
 * A markdown table's delimiter row (`| --- | :---: |`) -- the line that turns the
 * row above it into a header and everything below it into data. Requiring it is
 * what keeps ordinary prose containing a pipe out of the table arm, and it is why
 * the HEADER row is never reported as evidence: it is scanned before the delimiter
 * has been seen. Two columns minimum, which the arm needs anyway.
 */
const TABLE_DELIM_RE = /^\s{0,3}\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/;

/**
 * A markdown table row. The outer pipes are REQUIRED, which is the narrow
 * direction: GFM permits `a | b` without them, and a rule that accepted it would
 * read every prose line containing a pipe as a table row. Missing a borderless
 * table is a false negative; reading prose as a table is a false positive, and only
 * one of those refuses an author an exemption they are entitled to.
 */
const TABLE_ROW_RE = /^\s{0,3}\|.*\|\s*$/;

/**
 * The cells of a markdown table row.
 *
 * Split on an UNESCAPED pipe: `\|` inside a cell is GFM's escape and does not end
 * it. Over-splitting could only ever make the arms that read this fire MORE often,
 * so getting it right is a false-positive matter, not a cosmetic one.
 *
 * @param {string} line
 * @returns {string[]}
 */
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/);
}

/**
 * Does this table row read as a REWRITE -- an OPERAND in two or more DISTINCT
 * cells?
 *
 * The cell boundary is doing the arrow's job, so the arm asks for exactly what the
 * arrow arm asks for: code-ish operands on two sides. One coded cell is a
 * description, a definition or a capability row (`| `getPort?()` | the real bound
 * port after listen(0) |`), and those are not prescriptions.
 *
 * @param {string} line
 */
function isRewriteRow(line) {
  const cells = tableCells(line);
  if (cells.length < 2) return false;
  return cells.filter((c) => OPERAND_RE.test(c)).length >= 2;
}

/**
 * The OLD column of a rewrite table -- the cell naming what the author HAD.
 *
 * Derived from the stock, not invented (#6559): `| Wrote | …`, `| you wrote | …`,
 * `| You wrote | …`, `| Wrote in `config` | …`, `| Removed | …`,
 * `| Removed (never enforced) | …`, `| Retired | …`, `| 原写法 | …`.
 *
 * ANCHORED AT THE CELL START, which is the narrow direction and is load-bearing:
 * the word has to be what the column IS, not a word that happens to occur inside a
 * longer heading. `| removed page | sections now live on |` (`docs-index-category-keyed.md`)
 * is exactly why -- its second cell contains `now`, but starts with `sections`, so
 * anchoring keeps a docs redirect table out of a rewrite-prescription arm.
 */
const OLD_COLUMN_RE = /^\**\s*(?:(?:you\s+)?wrote|removed|retired)\b|^\**\s*(?:原|旧)写法/i;

/**
 * The NEW column -- the cell naming what the author must write INSTEAD.
 *
 * From the same stock rows: `… | Write instead |`, `… | Use instead |`,
 * `… | Live replacement |`, `… | Use |`, `… | now |`, `… | 改写为 |`.
 *
 * ⚠️ `was` is deliberately NOT an OLD word even though `| Was | Now |` exists
 * (`adr-0114-field-error-catalog.md`), and that omission is measured rather than
 * squeamish -- see the `was`/`now` paragraph in the block comment above.
 */
const NEW_COLUMN_RE =
  /^\**\s*(?:(?:write|use)\s+instead|live\s+replacement|use|now)\b|^\**\s*(?:改写为|改成)/i;

/**
 * Does this table's HEADER ROW frame the table below it as a rewrite?
 *
 * BOTH sides are required, and the NEW column must come AFTER the OLD one. The
 * pairing is the whole anchor: a lone `Removed` heads a forensic table as often as
 * a prescription (`| Removed | Built | Why it 404ed |`, `remove-dead-sdk-surface.md`),
 * and a lone `now` heads a behaviour comparison far more often than a rewrite
 * (`| route | was | now |`). Two columns that say "what you had" then "what to write"
 * is the shape no comparison matrix in this stock accidentally has.
 *
 * @param {string} line
 */
function headerFramesRewrite(line) {
  const cells = tableCells(line).map((c) => c.trim());
  if (cells.length < 2) return false;
  const oldAt = cells.findIndex((c) => OLD_COLUMN_RE.test(c));
  if (oldAt < 0) return false;
  return cells.slice(oldAt + 1).some((c) => NEW_COLUMN_RE.test(c));
}

/**
 * An ATX heading, and its depth in capture group 1.
 *
 * The pattern is `check-adr-0087-registration`'s own, hoisted out of
 * `findMigrationPrescription` unchanged so that what opens a framed region and what
 * closes one are one definition rather than two that can drift. Up to three leading
 * spaces is CommonMark's rule, and the required whitespace after the hashes is what
 * keeps `#!/usr/bin/env` and `#12996` out. Seven hashes is not a heading, and
 * `#{1,6}\s` refuses it for free: the seventh `#` is not the whitespace the pattern
 * needs. Stateless (no `g`): it is used inside a loop.
 */
const HEADING_RE = /^\s{0,3}(#{1,6})\s/;

/**
 * Migration framing, in the spellings THIS repo's changesets actually use.
 *
 * Derived from the stock, not invented: the Chinese side comes from `## 迁移`,
 * `**迁移**:`, `**迁移面**:`, `## 破坏性变更 · 迁移`, `## 作者需要知道的迁移`,
 * `## 升级说明`, `## 升级影响`, `应改写为`, `改名`; the English side from
 * `## Migration`, `## Migrating`, `**Migration.**`, `Migration (FROM → TO):`.
 *
 * The English alternatives are WORD-ANCHORED on purpose. Without `\b` the token
 * matches inside identifiers -- `sys_migration_journal`, `renameConfigKey`,
 * `migrations/registry.ts`, `onUpgrade` -- and those appear in ordinary prose
 * next to arrows. Measured: word-anchoring removed one false positive
 * (`conversion-shadowed-alias-by-value.md`, whose only "framing" was the
 * identifier `renameConfigKey`) and removed no true positive.
 */
export const MIGRATION_FRAMING_RE =
  /迁移|改写|改名|升级|\bmigrat(?:e|es|ed|ing|ion|ions)\b|\brename[sd]?\b|\brewrit(?:e|es|ten|ing)\b|\bupgrade[sd]?\b/i;

/** The `FROM`/`TO` label convention -- branch 1's pattern, unchanged from #6148. */
const FROM_TO_LABEL_RE =
  /(?:^|[^A-Za-z])FROM(?:\s|\*|`|\)|:)[^\n]{0,60}?(?:→|->|—>)[^\n]{0,60}?TO(?![A-Za-z])|^\s*\|?\s*\**FROM\**\s*(?:\(|\|)|^\s*\/\/\s*FROM\b|迁移[^\n]{0,12}FROM\s*(?:→|->)\s*TO/m;

/**
 * The same pattern, scanned over EVERY occurrence rather than the first (#6967).
 *
 * `exec` on the stateless copy answers "where is the first placeholder", which was
 * enough while every occurrence counted. Now that an occurrence can be a MENTION,
 * the first one is no longer the whole answer -- a body may cite the convention in
 * one paragraph and use it as a label in the next
 * (`tool-requires-confirmation-removed.md` does exactly that), and the label is the
 * one that evidences a prescription. Kept as a separate constant because a `g`
 * regex carries `lastIndex` state and the stateless copy above is used inside
 * conditions where that state would be a bug.
 */
const FROM_TO_LABEL_G = new RegExp(FROM_TO_LABEL_RE.source, 'gm');

/**
 * Does an ordinary WORD directly govern the token that follows this prefix?
 *
 * The two spellings are not symmetric, and the asymmetry is the corpus's rather
 * than a simplification. English words are space-delimited, so a governing word
 * leaves an ASCII LETTER as the last character before the token
 * (`carries its ⟦FROM⟧`). Chinese is written without those spaces, but this repo's
 * prose puts one before every Latin token as a matter of typography -- so an
 * adjacent CJK character says nothing at all, and the governing signal is the
 * ATTRIBUTIVE PARTICLE `的`: `唯一的 ⟦FROM → TO⟧ 落在…` ("the only FROM → TO lands
 * on…"). Reading ANY CJK character as governance was measured first and refused:
 * it turns `匹配语义 FROM → TO:` -- a noun-phrase label with a rewrite table under
 * it -- into a mention.
 */
const GOVERNING_WORD_RE = /(?:[A-Za-z]|的)$/;

/**
 * Does a COLON close the placeholder -- is this occurrence INTRODUCING the
 * prescription that follows it? (#18494)
 *
 * `GOVERNING_WORD_RE` above reads the one character to the LEFT, and that is the
 * whole evidence branch 1 had. It is sound for the shapes it was measured on and
 * it is structurally blind to one family: a label whose own words are a NOUN
 * PHRASE. `**Schema Migration FROM -> TO:** delete the block` is a label by every
 * reading a human gives it, and the character left of the framed placeholder is an
 * ordinary letter, so the occurrence read as a MENTION and a changeset shipping no
 * rewrite at all was admitted under `no-migration-prescription` -- the
 * false-NEGATIVE direction, where the cost is not a blocked PR but a break that
 * reaches consumers with no prescription and no ledger entry.
 *
 * The colon is the signal the left side cannot supply, and it is a signal about
 * USE rather than about grammar: `FROM -> TO:` is the convention's own punctuation
 * for "what follows is the mapping". A MENTION is the head of a noun phrase inside
 * a running sentence (`carries its FROM -> TO guide`, `the FROM -> TO is
 * documented elsewhere`) and a running sentence does not put a colon on its
 * object. So the two readings are separable from the RIGHT even where the left is
 * mute, and this predicate is consulted for exactly that case.
 *
 * ⚠️ A CLOSED CLASS, derived from the stock rather than invented. Measured over
 * every tracked `md`/`mdx` file in this repository at `625db0e85` (1322 files, 113
 * of them carrying the placeholder, 1007 occurrences): 321 occurrences are closed
 * by a colon, and the markup that may stand between the placeholder and that colon
 * is exactly three runs -- nothing (295), `)` (25, `Migration (FROM -> TO):`) and
 * `**` (1, `**FROM -> TO**: a direct-engine caller`). Hence at most two characters
 * of closing markup, from the class the stock actually writes.
 *
 * ⚠️ The full-width colon is this file's ordinary Chinese parity, exactly as
 * `MIGRATION_FRAMING_RE`, `OLD_COLUMN_RE`, `NEW_COLUMN_RE` and
 * `REMOVAL_INSTRUCTION` each carry one, and its measured population in this
 * position is ZERO: it buys no measured true positive today and introduces no
 * measured false one. It is here so the arm is not shaped by the language the
 * author happened to write in -- a Chinese author writes the label colon
 * full-width, and a rule that reads only the ASCII one would make the ADR-0087
 * disposition turn on the author's keyboard.
 *
 * ⚠️ DIRECTION, and why this cannot be a weakening: a colon can only ever make an
 * occurrence a LABEL, and a label is what the gate REFUSES the catch-all on. No
 * body that is refused today is admitted because of this predicate, and the
 * contradiction check it feeds still grants everything
 * `carriesConcreteRewrite` grants.
 *
 * ⚠️ Asked AFTER the heading arm, never before it. A heading is judged on polarity
 * (`HEADING_DENIAL_RE`), and a denial is the one shape whose punctuation must not
 * be allowed to overturn its meaning -- reading `## No FROM -> TO: ...` as a label
 * would re-open exactly the #17357 false positive, in the direction this gate must
 * not buy.
 */
const LABEL_COLON_RE = /^[`*)]{0,2}[:：]/;

/**
 * A migration-framing word sitting immediately before the placeholder FRAMES it; it
 * does not govern it (`Migration FROM → TO`, `迁移 FROM → TO`). Anchored at the end
 * because that is the only position where the distinction can arise.
 *
 * ⛔ Never apply this pattern directly — go through `withoutFramingTail` below. On
 * its own it removes the word and LEAVES THE SPACE the word sat behind, which is a
 * prefix no end-anchored predicate can read.
 */
const FRAMING_TAIL_RE =
  /(?:迁移|改写|改名|升级|(?<![A-Za-z0-9_])(?:migrat(?:e|es|ed|ing|ion|ions)|rename[sd]?|rewrit(?:e|es|ten|ing)|upgrade[sd]?))$/i;

/**
 * The prefix with its framing word taken off -- and the SPACE that word sat behind
 * taken off with it, so that what is EXPOSED is the word the framing word was
 * standing in front of.
 *
 * Both readers of `FRAMING_TAIL_RE` ask an END-ANCHORED question of the result
 * (`GOVERNING_WORD_RE`, `HEADING_DENIAL_RE`), and stripping alone leaves a trailing
 * space, which is neither a letter nor `的` nor a negator. The strip therefore does
 * not expose the word behind the framing word; it exposes a space, every
 * end-anchored question answers "no", and the occurrence is read as a LABEL. That
 * is the false-positive direction (#17864 · #6967): inserting a framing word between
 * a governor and the placeholder flipped `the Migration FROM → TO is documented
 * elsewhere` -- a plain MENTION -- into evidence of a prescription, and a false
 * positive on this gate hard-blocks a PR rather than merely misreporting.
 *
 * One definition rather than two that can drift, for the reason `HEADING_RE` is
 * hoisted: the heading arm composed the two replacements correctly and the in-line
 * arm did not, and nothing held them equal. The two arms now differ only in the
 * question they ask of the result.
 *
 * ⚠️ ONE framing word is stripped, deliberately, and the composition is not
 * iterated: `the upgrade migration FROM → TO` exposes `upgrade`, a letter, so it
 * reads as governed -- the same answer the mention reading wants here, by a route
 * that is an accident. No stock occurrence stacks two framing words; a repeated
 * strip is a wider claim and would need its own measurement.
 *
 * ⚠️ The English alternatives are WORD-ANCHORED, for the reason
 * `MIGRATION_FRAMING_RE` states one rule over: without it the token matches inside
 * an IDENTIFIER, and an identifier is not framing. `the sys_migration FROM → TO is
 * documented elsewhere` stripped to `the sys_`, exposed `_` rather than the letter
 * that was really there, and read as a LABEL although `the` plainly governs it
 * (#18493) -- this docblock said so before the anchor existed, and the shape was
 * out of the right-trim's reach because there is no whitespace before a framing
 * word buried in an identifier. A lookbehind rather than a consuming boundary,
 * because the match is fed to `String.replace` and a consumed delimiter would be
 * deleted with the word.
 *
 * ⚠️ Word-anchoring changes WHICH prefixes are stripped, so it is a wider claim
 * than transparency and carries its own measurement: 429 changesets and 1322
 * tracked md/mdx at `625db0e85`, ZERO verdict deltas. The one shape it moves in
 * isolation is `sys_migration FROM → TO:` -- the F9 floor -- which stops being a
 * label by an accident of the strip and stays one by `LABEL_COLON_RE`, the colon
 * that actually closes it. The two directions of this predicate are COUPLED there,
 * and the SS battery in the self-test pins both at once so neither can be traded
 * for the other.
 *
 * ⚠️ The Chinese alternatives stay unanchored, exactly as
 * `MIGRATION_FRAMING_RE` leaves them: a word boundary is an ASCII notion, and CJK
 * text is written without the delimiters it reads.
 *
 * ⚠️ The class is `\b`'s, deliberately, and what that leaves is stated rather
 * than hidden: a framing word after a HYPHEN or a DOT (`the auto-migration FROM
 * → TO is documented elsewhere`, `the config.migration ...`) is still stripped,
 * because `\b` reads both as boundaries too. Measured over the same tree, the
 * population of EVERY in-line framing tail -- of any delimiter -- is 0, so no
 * reading here separates the two classes; and reaching further would widen what
 * the gate ADMITS on a shape nothing has measured, which is the one direction this
 * predicate does not buy on an argument.
 *
 * @param {string} prefix the text left of the placeholder, already right-trimmed
 */
function withoutFramingTail(prefix) {
  return prefix.replace(FRAMING_TAIL_RE, '').replace(/\s+$/, '');
}

/**
 * Does a NEGATOR directly govern the placeholder in this HEADING -- is the heading
 * DENYING that a prescription exists rather than opening one? (#17357)
 *
 * A heading short-circuits the governance test below, because a heading is a label
 * by construction and its words are a title rather than a sentence (P46). That is
 * right for every heading which says what follows it, and exactly wrong for the one
 * shape that says what does NOT follow it:
 *
 *     ## No FROM -> TO mapping, and why this section is not one
 *
 * Read as a label, that heading evidences the very prescription it denies, and the
 * gate then refuses `not-required (no-migration-prescription)` on it -- offering as
 * the remedy `registered <ENTRY_ID>`, which asserts the opposite of what the
 * changeset says. Measured before the repair, through the real CLI on a real temp
 * repo: the heading above is exit 1 with `Evidence (from-to-label)` naming the
 * denial itself, and the IDENTICAL denial reworded off the token is exit 0. The
 * detector was keying on the SPELLING rather than the meaning, and the only passing
 * form was to avoid a word -- a gate shaping prose a human reads, in the direction
 * of not naming the thing being denied.
 *
 * ⚠️ The rule is ADJACENCY, exactly as `GOVERNING_WORD_RE` is: the negator has to be
 * the last word before the placeholder. "A negator appears somewhere in the heading"
 * is a whole clause and a different claim -- `## 升级:不再支持的键的 FROM → TO` is a
 * real prescription heading whose negator modifies a noun three words away, and a
 * loose read turns it into a denial. The class is CLOSED for the same reason
 * `WRAPPED_GOVERNOR_RE`'s is: an open read of "negative-sounding words" cannot be
 * measured, and a false NEGATIVE here is the one direction this gate must not buy.
 *
 * ⚠️ A framing word between the negator and the placeholder is transparent, exactly
 * as it is in-line (`FRAMING_TAIL_RE`): `## No migration FROM → TO` denies as
 * plainly as `## No FROM → TO`, because `migration` FRAMES the placeholder rather
 * than governing it. The second right-trim is what makes that composition work --
 * stripping the framing tail leaves the space that preceded it.
 *
 * ⚠️ Direction, and the whole reason this cannot weaken the gate: a denying heading
 * is NOT an exemption. It is demoted to exactly the status of a governed MENTION, so
 * it falls through to `carriesConcreteRewrite` -- a body that denies in its heading
 * and then SHOWS the goods anywhere is refused precisely as before -- and every
 * other branch of `findMigrationPrescription` still reads the same body afterwards.
 * The narrowing can only ever remove a hit whose SOLE evidence was a heading saying
 * there was nothing to evidence.
 */
const HEADING_DENIAL_RE =
  /(?:^|[^A-Za-z])(?:no|not|none|never|without|lacks?|lacking|zero)$|(?:无|没有|不|未|非)$/i;

/**
 * A line whose sentence CANNOT run on into the line below it -- markdown structure
 * rather than prose. Consulted only by `labelPositioned`'s cross-line arm (#7094):
 * a placeholder opening the line under one of these is opening a segment, so it is
 * read exactly as it was before that arm existed.
 *
 * A bullet or a blockquote is deliberately NOT here: those DO wrap, and their
 * continuation line is exactly the shape the arm exists to read. A blank line needs
 * no entry either -- it governs nothing through the ordinary path.
 */
const STRUCTURAL_LINE_RE = /^\s{0,3}(?:#{1,6}\s|```|~~~|\|)/;

/**
 * Does the line ABOVE end on a word that cannot be the last word of a segment --
 * so the noun phrase it opens must continue on the line below? (#7094)
 *
 * ⚠️ This is deliberately NOT `GOVERNING_WORD_RE`, and the difference is the whole
 * safety of the cross-line arm. WITHIN a line, adjacency is the evidence: a letter
 * immediately left of the placeholder means a word is attached to it, whatever word
 * it is. A LINE BREAK is not adjacency -- it is ambiguous by construction, because
 * a label may perfectly well open the line under a finished thought. So the
 * cross-line test demands a stronger signal than "a word ended here": a CLOSED
 * CLASS of determiners, possessives and complement-taking prepositions, none of
 * which can end an English segment. `carry their` continues; `ends the line here`
 * does not, and neither does `## Migration`.
 *
 * Reusing `GOVERNING_WORD_RE` across the wrap was written first and REJECTED by its
 * own positive control (P52): it reads ANY line-final letter as governance, so
 * every wrapped LABEL under an ordinary sentence became a mention -- the precise
 * failure #7078 predicted when it declined to attempt this at all. The class below
 * is what makes the two shapes separable; over the stock all three wrapped mentions
 * end on `their`, `the` and `a` respectively, and nothing else in 1792 changesets
 * ends a line in this class before a placeholder.
 *
 * The Chinese arm needs no class: `的` is the attributive particle and is already
 * the one-character signal in-line (P40), so it carries across the wrap unchanged.
 */
const WRAPPED_GOVERNOR_RE =
  /(?:^|[^A-Za-z])(?:the|an?|its|their|our|your|his|her|this|these|those|each|every|any|some|no|same|own|another|of|with|for|in|on|by|to|and|or)$|的$/i;

/**
 * The two halves of a VERTICAL `FROM`/`TO` pair -- the placeholder spelled as two
 * consecutive blocks rather than across one arrow. Each must OPEN its line (past a
 * comment marker, bullet or emphasis) and be closed by `:`, `—`, whitespace or the
 * end of the line, so `FROMAGE` and a sentence beginning "To be clear" cannot open
 * one. Used only by `carriesConcreteRewrite`, which grants and never refuses.
 */
const VERTICAL_FROM_RE = /^\s{0,3}(?:(?:\/\/|#|-|\*|>)\s*)*\**FROM\**\s*(?::|—|-|$|\s)/;
const VERTICAL_TO_RE = /^\s{0,3}(?:(?:\/\/|#|-|\*|>)\s*)*\**TO\**\s*(?::|—|-|$|\s)/;

/**
 * Is this placeholder occurrence USED as the convention's label, or merely
 * MENTIONED inside a running sentence? (#6967)
 *
 * `FROM → TO` is a TEMPLATE PLACEHOLDER, and branch 1 is the only branch that
 * accepts a bare-word arrow at all -- every other branch demands code-ish operands,
 * because "an arrow is not a prescription" (see above). What buys branch 1 that
 * exemption is the CONVENTION: in this repo the two uppercase words open a
 * prescription block. That is a claim about how the token is USED, and a token can
 * also be MENTIONED -- talked about rather than deployed:
 *
 *     Migration: each breaking change's own changeset carries its FROM → TO guide
 *
 * That is `.changeset/v17-rc-anchor.md`, the v17 version anchor, which retires
 * nothing and prescribes nothing; it says where the prescriptions live. Read as a
 * prescription it left its author with no legal disposition at all (#6967): the
 * catch-all is refused by the contradiction check, `registered` /
 * `already-registered` have no entry to name, and `@objectstack/spec` is published
 * so `unpublished` is false. A false positive here does not merely misreport -- it
 * hard-blocks a PR, which is why this direction is worth a rule of its own.
 *
 * The distinction is GRAMMATICAL, and it is read off the one character that
 * separates the two readings: whether an ordinary WORD directly governs the
 * placeholder. A label opens its segment, so what stands immediately before it is
 * markup, a sentence boundary or a framing word -- `**FROM → TO`, `## FROM → TO`,
 * `- FROM …`, `| FROM |`, `// FROM`, `Migration (FROM → TO)`,
 * `### Migration — FROM → TO`, `迁移:FROM → TO`, `it. FROM → TO:`,
 * `Corrected names, FROM → TO`. A mention is the HEAD OF A NOUN PHRASE and has a
 * word attached to it: `carries its FROM → TO guide`, `carry their FROM → TO
 * migration because …`, `唯一的 FROM → TO 落在部署方自己的代理配置上`.
 *
 * ⚠️ The WIDER rule -- "no letters anywhere in the prefix" -- was written first and
 * measured before it was believed, which is what killed it. It reads a label that
 * merely follows a finished sentence on the same line as prose, and over the stock
 * it took FIVE real prescriptions with it, `app-dead-authoring-keys.md`
 * (`**Removed keys and their prescriptions (FROM → TO):**`, declared-breaking)
 * among them. Governance is one character; "a letter appears somewhere to the left"
 * is a whole clause, and the two are not the same claim.
 *
 * A markdown HEADING is a label by construction, whatever words it carries, so it
 * short-circuits: `## 升级:翻译包键的 FROM → TO` is a title and not a sentence, and it
 * ends in the very particle the Chinese arm reads as governance.
 *
 * ⚠️ With ONE exception, and it is a polarity one (#17357): a heading whose governing
 * word DENIES the placeholder -- `## No FROM → TO mapping, and why this section is
 * not one` -- is not opening a prescription, it is stating that there is none to
 * open. Read as a label it evidenced the thing it denied, and the author was refused
 * for saying so in the clearest available words. `HEADING_DENIAL_RE` above carries
 * the closed class, the adjacency rule and why a denying heading is demoted to a
 * mention rather than exempted.
 *
 * ⚠️ A FRAMING word between the governor and the placeholder is transparent, and
 * transparency is a claim in BOTH directions (#17864). It does not make an
 * occurrence a label -- `the Migration FROM → TO is documented elsewhere` is the
 * same mention as `the FROM → TO is documented elsewhere`, one framing word apart --
 * and it does not take a label away, because what the strip exposes is asked the
 * ordinary question: `Migration FROM → TO:` exposes nothing at all and stays a
 * label, `it. Migration FROM → TO:` exposes the sentence boundary that already made
 * it one (P43), and `**Migration FROM → TO:**` exposes the markup. Every occurrence
 * this moves is one where an ordinary word governs a framed placeholder, and each of
 * those is still granted back by `carriesConcreteRewrite` the moment the body SHOWS
 * a rewrite (P47). `withoutFramingTail` above carries the mechanism and what the
 * strip deliberately does not reach.
 *
 * ⚠️ Prose in this repo is HARD-WRAPPED at ~80 columns, so "starts its line" is NOT
 * the test and never could be -- `carry their\nFROM → TO migration` puts a mention
 * at column 0 with nothing at all to its left. #7078 left that as a stated blind
 * spot; #7094 closes it. When the placeholder OPENS its line, the word that governs
 * it -- if one does -- is the last word of the line ABOVE, so that is where the
 * question is asked instead.
 *
 * ⚠️ It is a DIFFERENT and narrower question there, and that asymmetry is the point.
 * Adjacency within a line is evidence on its own; a line break is not, because a
 * label may open the line under a finished thought. So the cross-line arm asks
 * `WRAPPED_GOVERNOR_RE` -- a closed class of determiners, possessives and
 * complement-taking prepositions -- where the in-line arm asks `GOVERNING_WORD_RE`.
 * `carry their` continues into the next line; `ends the line here` does not.
 *
 * ⚠️ It is asked ONLY of a line the sentence can actually run on from. A structural
 * line above -- a heading, a table row, a fence marker -- does not wrap into the one
 * below, and a BLANK line above (46 of the stock's 49 line-opening occurrences)
 * opens a paragraph, whose first token is a label by position. In all three the
 * reading is exactly what it was before this arm existed.
 *
 * ⚠️ Measured over the whole 1792-changeset stock before it was believed: of the 49
 * occurrences that open their line, 46 sit under a blank line and are untouched
 * here; of the 3 with prose above, ALL THREE are mentions on inspection, and only
 * TWO change their changeset's verdict --
 * `changelog-ships-in-tarball.md` (the #7094 specimen, `carry their\nFROM → TO
 * migration`) and `notification-retirement-evidence-corrected.md` (`the evidence and
 * the\nFROM → TO), and one on the #4651 app-area entry`). BOTH declare no breaking
 * change. `apimethod-enum-shrink.md` carries the third and keeps its hit on an
 * EARLIER genuine label (`**Migration (FROM → TO).**`) -- it is the positive control
 * for this arm, a body holding a real label and a wrapped mention at once. Zero
 * declared-breaking changesets change state, so the residue and the `!` candidate
 * list are byte-identical before and after.
 *
 * ⚠️ Still out of reach, stated rather than hidden: prose wrapped inside a FENCED
 * block. The fence's opening line is structural and excluded, but a line INSIDE the
 * fence reads as prose, and this predicate is given one line of context rather than
 * the block structure. No stock occurrence has that shape.
 *
 * ⚠️ And from the RIGHT, where the left is mute: a NOUN-PHRASE label
 * (`**Schema Migration FROM → TO:** delete the block`) has an ordinary letter
 * immediately before the placeholder and is a label all the same, so the
 * adjacency question answers "mention" on a shape no human reads that way. It was
 * admitted with no rewrite at all (#18494). The colon that closes the placeholder
 * is what separates the convention's own punctuation from a running sentence, and
 * `LABEL_COLON_RE` above carries the measured class and the direction.
 *
 * @param {string} line the line the `FROM` token sits on
 * @param {number} col  its column within that line
 * @param {string} [prev] the line above it, when there is one (#7094)
 * @param {string} [after] the rest of its line, right of the placeholder (#18494)
 */
function labelPositioned(line, col, prev, after = '') {
  const prefix = line.slice(0, col).replace(/\s+$/, '');
  // A heading is a label by construction, whatever words it carries -- UNLESS the
  // word governing the placeholder denies it (#17357). A denying heading is not
  // granted an exemption here; it is demoted to the status of a governed mention and
  // takes the `carriesConcreteRewrite` path below, so a body that shows the goods
  // anywhere is refused exactly as it was.
  if (/^\s{0,3}#{1,6}\s/.test(line)) {
    return !HEADING_DENIAL_RE.test(withoutFramingTail(prefix));
  }
  // A COLON closes the placeholder, so the occurrence is introducing the mapping
  // that follows it rather than being talked about inside a sentence (#18494).
  // Asked here rather than above, so a DENYING heading keeps its polarity reading:
  // punctuation must not overturn the one shape that says there is nothing to
  // introduce. Asked BEFORE governance, because it is evidence the left side
  // structurally cannot supply -- a label whose own words are a noun phrase has an
  // ordinary letter to its left and is a label anyway.
  if (LABEL_COLON_RE.test(after)) return true;
  // A framing word is transparent HERE exactly as it is in the heading arm above
  // (#17864): it frames the placeholder, so the governance question is asked of
  // whatever stands behind it -- which requires the space it sat behind to come off
  // with it (`withoutFramingTail`). Asked of the bare strip, the question met a
  // trailing space, answered "nothing governs this", and read every governed
  // MENTION carrying a framing word as a label.
  const bare = withoutFramingTail(prefix);
  if (bare !== '') return !GOVERNING_WORD_RE.test(bare);
  // Nothing on THIS line governs the placeholder: either it opens the line -- bare
  // or merely indented, so a wrapped list item counts -- or everything left of it
  // was a framing word, which by the transparency above is not there at all
  // (#18493 W1: `the` ending the line above, `Migration FROM → TO` opening the one
  // below). Either way the governing word, if there is one, is the last word of the
  // line above; and only a line that is prose the sentence can run on from is asked
  // (#7094).
  if (prev === undefined || STRUCTURAL_LINE_RE.test(prev)) return true;
  // Transparent across the wrap exactly as it is within the line and in the heading
  // arm (#18493 W2): a framing word ENDING the line above frames the placeholder
  // below it, so the closed class is asked of the word behind it.
  return !WRAPPED_GOVERNOR_RE.test(withoutFramingTail(prev.replace(/\s+$/, '')));
}

/**
 * Does the body carry a CONCRETE rewrite anywhere -- an arrow between two code-ish
 * operands, a table row reading as a rewrite, or a FROM block answered by a TO
 * block? (#6967)
 *
 * This is the SECOND way a placeholder occurrence qualifies, and it exists so the
 * positional rule above cannot invent false negatives. A prose-governed sentence is
 * ambiguous on its own -- `the FROM → TO mappings baked into it include:`
 * (`unknown-key-strictness-tier-a.md`) is governed by `the` and is a real
 * prescription -- so when the body independently SHOWS the goods, the placeholder is
 * taken at face value wherever it sits.
 *
 * The VERTICAL pair is here because it is how #6048's own changeset was written and
 * how several since have been: the two words head consecutive lines instead of
 * flanking an arrow, in a code fence (`// FROM` … `// TO`) or as a bullet pair
 * (`- **FROM:** …` / `- **TO:** …`, `tool-requires-confirmation-removed.md`).
 * `FROM_TO_LABEL_RE` cannot see that shape -- both its arrow alternatives need one
 * line -- so without this arm a changeset whose ONLY machine-readable prescription
 * is vertical would rest entirely on whatever prose happened to mention the
 * convention, which is precisely the accident #6967 is about.
 *
 * Note the direction: this predicate can only ever ADD a hit back, never take one
 * away, so the looseness that would be unacceptable in a trigger (`REWRITE_RE` alone
 * fires on 480 changesets, per the measurements above) is harmless here. It is
 * consulted only for bodies that ALREADY carry the placeholder -- 133 changesets in
 * the current stock -- and only to grant, never to refuse.
 *
 * @param {string} body
 */
function carriesConcreteRewrite(body) {
  return firstConcreteRewrite(body) !== null;
}

/**
 * `carriesConcreteRewrite`, answering WHICH line -- the same walk, unchanged, so a
 * caller that has to name the rewrite it refuses on (`readFromBlock`, #22918) reads
 * exactly what branch 1's corroboration reads.
 *
 * @param {string} body
 * @returns {{ shape: string, line: string } | null}
 */
function firstConcreteRewrite(body) {
  let inTable = false;
  let fromLine = null;
  for (const line of body.split(/\r?\n/)) {
    if (REWRITE_RE.test(line)) return { shape: 'an arrow rewrite', line: line.trim() };
    if (VERTICAL_FROM_RE.test(line)) fromLine ??= line.trim();
    else if (fromLine !== null && VERTICAL_TO_RE.test(line)) return { shape: 'a vertical FROM / TO pair', line: fromLine };
    if (TABLE_DELIM_RE.test(line)) { inTable = true; continue; }
    if (!TABLE_ROW_RE.test(line)) { inTable = false; continue; }
    if (inTable && isRewriteRow(line)) return { shape: 'a rewrite table row', line: line.trim() };
  }
  return null;
}

/**
 * The prescription this changeset carries, with the LINE that evidences it, or
 * `null`.
 *
 * The evidence is returned rather than a bare boolean because the refusal message
 * is read by an author who believes their changeset has no prescription. "Your
 * body carries one" is unarguable-with; "your body carries one, here it is" is
 * checkable, and it is the only way an author can tell a real contradiction from
 * a detector they should be arguing about (#6419 exists because nobody could see
 * what the old pattern was actually reading).
 *
 * See the block comment above for what each branch reads, what was measured, and
 * which shapes are deliberately out of reach.
 *
 * @param {string} body
 * @returns {{ branch: 'from-to-label' | 'framed-line' | 'framed-section' | 'framed-table'
 *             | 'header-framed-table' | 'framed-removal' | 'framed-section-removal',
 *             line: string } | null}
 */
export function findMigrationPrescription(body) {
  const lines = body.split(/\r?\n/);
  // Branch 1. Every placeholder occurrence is considered, and each one has to be
  // either LABEL-POSITIONED or corroborated by a concrete rewrite elsewhere in the
  // body (#6967) -- a placeholder that is merely talked about evidences nothing.
  // The corroboration is computed at most once, and only if some occurrence needs it.
  let corroborated = null;
  FROM_TO_LABEL_G.lastIndex = 0;
  for (let m = FROM_TO_LABEL_G.exec(body); m; m = FROM_TO_LABEL_G.exec(body)) {
    // The match may open with the delimiter `[^A-Za-z]` consumed before `FROM`
    // (frequently the NEWLINE ending the previous line), so the token's own offset
    // is what locates it. Taking the match's start instead reported the PRECEDING
    // line as evidence whenever that delimiter was a newline -- two stock rows
    // audited with a blank evidence line for exactly that reason.
    const at = m.index + m[0].indexOf('FROM');
    const lineStart = body.lastIndexOf('\n', at - 1) + 1;
    const lineNo = body.slice(0, at).split(/\r?\n/).length - 1;
    // The text RIGHT of the placeholder, on its own line: the match ends on the
    // `TO` token (its trailing lookahead consumes nothing), and every alternative
    // of `FROM_TO_LABEL_RE` is single-line, so the match's end is a column on the
    // same line the token sits on (#18494).
    const after = (lines[lineNo] ?? '').slice(m.index + m[0].length - lineStart);
    if (!labelPositioned(lines[lineNo] ?? '', at - lineStart, lineNo > 0 ? lines[lineNo - 1] : undefined, after)) {
      if (corroborated === null) corroborated = carriesConcreteRewrite(body);
      if (!corroborated) continue;
    }
    return { branch: 'from-to-label', line: (lines[lineNo] ?? m[0]).trim() };
  }

  // A heading carrying migration framing opens a framed region that runs to the
  // next heading OF THE SAME OR A SHALLOWER LEVEL. Without it, the most natural way
  // to write a prescription -- `## 迁移` followed by a list of `old` → `new` lines --
  // would be invisible, which is the #6419 defect in a second spelling. The DEPTH
  // half of that sentence is #12996: closing at the next heading of ANY level meant
  // a `## Migration` section that organised its rewrite tables under `###`
  // sub-headings -- the ordinary way to write a two-part rename -- lost its framing
  // before the first table row was read.
  // Framing is tracked PER HEADING DEPTH rather than as one boolean (#12996). A
  // heading closes every region nested at or outside its own level and opens one of
  // its own if it carries framing; regions SHALLOWER than it survive untouched.
  // Indices are 1..6, so the slot at 0 is never read.
  const framingAtDepth = [false, false, false, false, false, false, false];
  let framedSection = false;
  let inTable = false;
  // The table arm's first hit, held back rather than returned (#6497). The arrow
  // branches above `return` the moment they match, so holding this until the loop
  // ends makes the whole function exactly `arrowBranches(body) ?? tableArm(body)`:
  // every body the old detector flagged is still flagged, on the same branch, with
  // the same evidence line. The superset property is then structural -- it cannot
  // be broken by a future edit that only touches the table arm -- rather than a
  // measurement someone has to remember to repeat.
  let table = null;
  // The header-framed arm's first hit, held back the same way and consulted only
  // after `table` (#6559). Same reasoning one level down: the whole function stays
  // exactly `arrowBranches(body) ?? framedTable(body) ?? headerFramedTable(body)`,
  // so the superset property remains STRUCTURAL -- no edit confined to this arm can
  // take a hit away from an older one, and nothing has to be re-measured to know it.
  let headerTable = null;
  let headerFramed = false;
  // The RETIREMENT arm's first hit (#18745), held back for the reason the two above
  // are and consulted LAST, so the whole function stays exactly
  // `arrowBranches ?? framedTable ?? headerFramedTable ?? framedRemoval`. That keeps
  // the superset property STRUCTURAL one more level down: no body an older arm
  // already reads can change its branch or its evidence line because this arm exists,
  // and nobody has to re-measure the stock to know it.
  let removal = null;
  let prev = '';
  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const depth = heading[1].length;
      for (let d = depth; d < framingAtDepth.length; d++) framingAtDepth[d] = false;
      framingAtDepth[depth] = MIGRATION_FRAMING_RE.test(line);
      framedSection = framingAtDepth.includes(true);
      inTable = false; // a table cannot span a heading
      headerFramed = false;
    }
    if (REWRITE_RE.test(line)) {
      if (MIGRATION_FRAMING_RE.test(line)) return { branch: 'framed-line', line: line.trim() };
      if (framedSection) return { branch: 'framed-section', line: line.trim() };
    }
    // A rewrite whose TO side is an INSTRUCTION rather than an operand -- the
    // author has nothing to name because the answer is "delete it" (#18745). Read
    // under exactly the framing branches 2 and 3 require, and never instead of
    // them: `REWRITE_RE` is tested first above, so a line that is both a rename and
    // a removal keeps the branch and evidence it already had.
    if (removal === null && RETIREMENT_RE.test(line)) {
      if (MIGRATION_FRAMING_RE.test(line)) removal = { branch: 'framed-removal', line: line.trim() };
      else if (framedSection) removal = { branch: 'framed-section-removal', line: line.trim() };
    }
    // Delimiter first: it also matches TABLE_ROW_RE, and it is the row that opens
    // the data region rather than a row inside it. The line ABOVE it is the header,
    // which is why the header row is read here and never reported as evidence.
    if (TABLE_DELIM_RE.test(line)) {
      inTable = true;
      headerFramed = TABLE_ROW_RE.test(prev) && headerFramesRewrite(prev);
      prev = line;
      continue;
    }
    if (!TABLE_ROW_RE.test(line)) { inTable = false; headerFramed = false; prev = line; continue; }
    if (inTable && isRewriteRow(line)) {
      if (framedSection && table === null) table = { branch: 'framed-table', line: line.trim() };
      if (headerFramed && headerTable === null) headerTable = { branch: 'header-framed-table', line: line.trim() };
    }
    prev = line;
  }
  return table ?? headerTable ?? removal;
}

/**
 * Does the changeset carry a migration prescription -- instructions for
 * rewriting a consumer's code?
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasMigrationPrescription(body) {
  return findMigrationPrescription(body) !== null;
}

/**
 * The ADR-0087 disposition marker, or a structured miss.
 *
 * Returns `{ ok: false, reason }` rather than a silent null so "no marker" and
 * "a marker nobody can parse" are reportable as different facts.
 *
 * @param {string} body
 */
export function readDisposition(body) {
  const all = [...body.matchAll(/<!--\s*adr-0087\s*:\s*([\s\S]*?)-->/g)].map((m) => m[1].trim());
  if (all.length === 0) return { ok: false, reason: 'no `adr-0087:` disposition marker' };
  if (all.length > 1) {
    return { ok: false, reason: `${all.length} \`adr-0087:\` markers -- exactly one disposition is expected` };
  }
  const raw = all[0].replace(/\s+/g, ' ').trim();

  const reg = /^registered\s+(.+)$/i.exec(raw);
  if (reg) {
    const ids = reg[1].split(/[,\s]+/).map((s) => s.replace(/^[`'"]|[`'"]$/g, '')).filter(Boolean);
    if (ids.length === 0) return { ok: false, reason: '`registered` names no migration id' };
    return { ok: true, verdict: 'registered', ids, raw };
  }

  const nr = /^not-required\s*\(\s*([a-z-]+)\s*([^)]*)\)\s*(.*)$/i.exec(raw);
  if (nr) {
    const category = nr[1].toLowerCase();
    const ids = nr[2].split(/[,\s]+/).map((s) => s.replace(/^[`'"]|[`'"]$/g, '')).filter(Boolean);
    return { ok: true, verdict: 'not-required', category, ids, why: nr[3].trim(), raw };
  }

  return {
    ok: false,
    reason: `unparseable disposition: "${raw}" -- expected \`registered ...\` or \`not-required (...) ...\``,
  };
}

// ---------------------------------------------------------------------------
// Ledger id extraction
// ---------------------------------------------------------------------------

/**
 * Every migration / conversion id declared in an ADR-0087 registry source.
 *
 * The id character class is `[A-Za-z][A-Za-z0-9._-]*` and the leading capital
 * matters: `object-titleFormat-to-nameField` is a real live id, and a lowercase-only
 * class silently dropped it while extracting a plausible-looking 38 of 39. The
 * `spec-changes.json` cross-check in `assertInputs` exists so a future narrowing of
 * this pattern is caught rather than absorbed.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function extractIds(source) {
  return [...source.matchAll(/^\s*id:\s*['"`]([A-Za-z][A-Za-z0-9._-]*)['"`]\s*,?\s*$/gm)].map((m) => m[1]);
}

/**
 * Every `not-required` category ADR-0087 documents, read from its marker examples.
 *
 * Driven off the literal marker spelling rather than a prose list, for two reasons:
 * the ADR then has to show an author the exact syntax they will type, and a section
 * that merely NAMES a category in passing cannot satisfy the pin by accident.
 *
 * @param {string} adrText
 * @returns {Set<string>}
 */
export function documentedCategories(adrText) {
  const cats = new Set();
  for (const m of adrText.matchAll(/adr-0087\s*:\s*not-required\s*\(\s*([a-z-]+)/g)) cats.add(m[1]);
  return cats;
}

/** Every `migrationId` the generated projection carries. */
export function projectedMigrationIds(specChangesJson) {
  const ids = [];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      if (typeof node.migrationId === 'string') ids.push(node.migrationId);
      Object.values(node).forEach(walk);
    }
  };
  walk(specChangesJson);
  return [...new Set(ids)];
}

/**
 * The parser-rot witness: `spec-changes.json` GENERATED at `head` by the package's
 * own generator (#22485). Never a committed copy — there is none.
 *
 * Until #22485 this read the committed `packages/spec/spec-changes.json` at `head`.
 * Once #22482 stopped regenerating that copy it aged, and an aging copy is a wrong
 * witness in one direction: a migration id WITHDRAWN from the registry stays in it,
 * and this gate then reported parser drift for an id the parser was right not to
 * see. Generating at `head` removes the age, so the witness is what the build sees
 * at the rev being judged — the registry EVALUATED, not regex-parsed — and nothing
 * else.
 *
 * How: `head`'s generator inputs (`WITNESS_INPUTS`) are laid out with `git archive`
 * in a throwaway directory that borrows `toolRoot`'s `node_modules`, and
 * `WITNESS_GENERATOR` writes the projection there with `--out`. So the witness
 * describes `head` whatever the working tree holds, and a local run over an
 * uncommitted registry edit cannot red on it.
 *
 * Every failure is a PROBLEM, never a skip (#4690): no runner, no generator at
 * `head`, a generator that exits non-zero, or one that writes nothing parseable.
 * It needs the installed `tsx` the spec package depends on, which is why this gate
 * is no longer runnable before `pnpm install` (every CI site runs it after).
 *
 * @param {{ cwd: string, head: string, toolRoot?: string }} opts
 *   `toolRoot` is the checkout whose `node_modules` supplies `tsx` and the
 *   generator's dependencies; it defaults to the one this file lives in.
 * @returns {{ json: unknown, problem: null } | { json: null, problem: string }}
 */
export function generatedWitness({ cwd, head, toolRoot = REPO_ROOT }) {
  const fail = (problem) => ({ json: null, problem });
  let tsxCli;
  try {
    tsxCli = createRequire(join(toolRoot, 'packages', 'spec', 'package.json')).resolve('tsx/cli');
  } catch {
    return fail(
      `the witness generator's runner \`tsx\` is not installed under ${toolRoot}.\n` +
      '    fix: run `pnpm install` first. This gate generates its parser-rot witness with\n' +
      `    ${WITNESS_GENERATOR}, and an input it cannot produce is a red, never a skip (#4690).`,
    );
  }
  try {
    git(['cat-file', '-e', `${head}:${WITNESS_GENERATOR}`], cwd);
  } catch {
    return fail(
      `${WITNESS_GENERATOR} not found at ${head}.\n` +
      '    It writes this gate\'s only independent witness that the ledger parser still matches the\n' +
      '    registry\'s declaration shape. Without it the parser could rot unnoticed. If the generator\n' +
      '    moved, update WITNESS_GENERATOR in this script.',
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'adr0087-witness-'));
  try {
    const tar = join(dir, 'head.tar');
    try {
      git(['archive', '--format=tar', '-o', tar, head, ...WITNESS_INPUTS], cwd);
    } catch (e) {
      return fail(
        `could not lay out the witness generator's inputs at ${head} (\`git archive ${head} ${WITNESS_INPUTS.join(' ')}\`):\n` +
        `    ${String(e.stderr || e.message).trim().split('\n').join('\n    ')}`,
      );
    }
    const tree = join(dir, 'tree');
    mkdirSync(tree, { recursive: true });
    const unpacked = spawnSync('tar', ['-xf', tar, '-C', tree], { encoding: 'utf8' });
    if (unpacked.status !== 0) return fail(`could not unpack ${tar}: ${(unpacked.stderr || String(unpacked.error)).trim()}`);
    for (const rel of ['node_modules', join('packages', 'spec', 'node_modules')]) {
      if (existsSync(join(toolRoot, rel)) && !existsSync(join(tree, rel))) symlinkSync(join(toolRoot, rel), join(tree, rel));
    }
    // The generated era (#22554): the archive carries the template and the entry
    // files but no registry, exactly as a fresh checkout does, so the rev's OWN
    // registry generator runs first -- the step `build` and `pnpm install` take. A
    // template with no generator beside it is a red, never a witness of nothing.
    if (existsSync(join(tree, MIGRATION_LEDGER_TEMPLATE))) {
      const registryGenerator = join(tree, MIGRATION_LEDGER_GENERATOR);
      if (!existsSync(registryGenerator)) {
        return fail(
          `${MIGRATION_LEDGER_TEMPLATE} is tracked at ${head} but ${MIGRATION_LEDGER_GENERATOR} is not, so the\n` +
          '    migration registry the witness generator imports cannot be generated. If the generator moved,\n' +
          '    update MIGRATION_LEDGER_GENERATOR in this script.',
        );
      }
      const generated = spawnSync(process.execPath, [tsxCli, registryGenerator], {
        cwd: join(tree, 'packages', 'spec'),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (generated.status !== 0) {
        const said = `${generated.stdout ?? ''}${generated.stderr ?? ''}${generated.error ? String(generated.error) : ''}`.trim();
        return fail(
          `${MIGRATION_LEDGER_GENERATOR} exited ${generated.status ?? 'without a status'} at ${head}, so the migration\n` +
          '    registry the witness generator imports does not exist:\n' +
          `    ${said.split('\n').slice(0, 15).join('\n    ')}`,
        );
      }
    }
    const generator = join(tree, WITNESS_GENERATOR);
    const out = join(dir, 'spec-changes.json');
    const run = spawnSync(process.execPath, [tsxCli, generator, '--out', out], {
      cwd: join(tree, 'packages', 'spec'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (run.status !== 0) {
      const said = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? String(run.error) : ''}`.trim();
      return fail(
        `${WITNESS_GENERATOR} --out exited ${run.status ?? 'without a status'} at ${head}, so there is no witness:\n` +
        // The HEAD of the output: where both the runner's own refusal and an
        // uncaught throw put the cause, before the stack frames.
        `    ${said.split('\n').slice(0, 15).join('\n    ')}`,
      );
    }
    if (!existsSync(out)) return fail(`${WITNESS_GENERATOR} --out exited 0 at ${head} but wrote nothing to ${out}.`);
    try {
      return { json: JSON.parse(readFileSync(out, 'utf8')), problem: null };
    } catch (e) {
      return fail(`the spec-changes.json ${WITNESS_GENERATOR} generated at ${head} does not parse as JSON: ${e.message}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

function git(args, cwd) {
  // `env: gitFreeEnv()` (#16644): every caller of this helper -- the real checkout on a
  // gate run, a mkdtemp fixture in the self-test -- names its repository by `cwd`. An
  // inherited GIT_DIR outranks `cwd`, so without the strip the fixture legs read and
  // write THE REAL REPOSITORY under a hook, silently and with `ok` printed throughout.
  //
  // stderr is PIPED, not inherited: `showOrNull` probes paths that legitimately do
  // not exist at a rev (a ledger file added mid-history, a changeset deleted), and
  // git's "fatal: path ... does not exist" would otherwise print as though the gate
  // had failed while it is in fact answering the question it asked.
  return execFileSync('git', args, { cwd, env: gitFreeEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** File contents at a rev, or `null` when the path does not exist there. */
function showOrNull(rev, path, cwd) {
  try { return git(['show', `${rev}:${path}`], cwd); } catch { return null; }
}

/**
 * Bulk `showOrNull`: every path at one rev, in a SINGLE `git cat-file --batch`.
 *
 * Not a micro-optimisation. The convention-rot assertion has to look at the whole
 * changeset stock, which is ~1300 files; one `git show` per file is ~1300 process
 * spawns and measured at 5.2s per invocation, which is a real cost on a gate that
 * runs on every PR and is paid again by every historical replay. One batched call
 * is ~0.2s.
 *
 * @param {string} rev
 * @param {string[]} paths
 * @param {string} cwd
 * @returns {Map<string, string>} path -> contents, absent when missing at `rev`
 */
function showManyOrNull(rev, paths, cwd) {
  const found = new Map();
  if (paths.length === 0) return found;
  const input = paths.map((p) => `${rev}:${p}`).join('\n') + '\n';
  let out;
  try {
    out = execFileSync('git', ['cat-file', '--batch'], {
      cwd, env: gitFreeEnv(), input, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { return found; }

  // `<oid> <type> <size>\n<contents>\n` per hit; `<request> missing\n` per miss.
  let off = 0;
  for (const path of paths) {
    const nl = out.indexOf(0x0a, off);
    if (nl < 0) break;
    const header = out.subarray(off, nl).toString('utf8');
    if (header.endsWith(' missing')) { off = nl + 1; continue; }
    const size = Number(header.split(' ')[2]);
    if (!Number.isFinite(size)) break;
    found.set(path, out.subarray(nl + 1, nl + 1 + size).toString('utf8'));
    off = nl + 1 + size + 1; // trailing newline after the blob
  }
  return found;
}

function resolveCommit(ref, cwd) {
  try { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd).trim() || null; } catch { return null; }
}

export function mergeBase(base, head, cwd) {
  try { return git(['merge-base', base, head], cwd).trim() || null; } catch { return null; }
}

/**
 * Everything under `.changeset/` at a rev, split into "any entry at all" and
 * "actual PENDING changesets", or `null` when the tree itself cannot be listed.
 *
 * The split is what lets `assertInputs` tell an EMPTY STOCK (zero pending
 * changesets — the legitimate state of main right after a release cut, #8658)
 * apart from a MISSING DIRECTORY (not even the tracked README.md/config.json
 * found — unreadable input, still a #4690 refusal).
 *
 * `entries` stays UNFILTERED on purpose: it answers "is this directory readable
 * at all", and a tree whose changesets have all moved into `.changeset/pre/` is a
 * perfectly readable one. Narrowing it would turn the ordinary post-cut state of
 * main into a #4690 refusal — the exact confusion #8658 removed. `changesets` is
 * the narrowed half (see `isConsumedPrerelease`).
 *
 * @returns {{ entries: string[], changesets: string[] } | null}
 */
function changesetDirAt(rev, cwd) {
  let out;
  try { out = git(['ls-tree', '-r', '--name-only', rev, '--', '.changeset'], cwd); } catch { return null; }
  const entries = out.split('\n').map((s) => s.trim()).filter(Boolean);
  return { entries, changesets: entries.filter((p) => isChangesetFile(p) && !isConsumedPrerelease(p)) };
}

/**
 * Every PENDING changeset path at a rev — the consumed prerelease stock under
 * `.changeset/pre/` excluded (`isConsumedPrerelease`).
 *
 * Exported for `--self-test` S6/S8: the two consumers below print counts, and a
 * count is the one thing an exit code cannot tell apart from "nothing ran".
 */
export function changesetsAt(rev, cwd) {
  return changesetDirAt(rev, cwd)?.changesets ?? [];
}

/**
 * The ADR-0087 id set at a rev, plus the per-source counts the input assertions read.
 * @returns {{ ids: Set<string>, bySource: Record<string, number>, missingSources: string[] }}
 */
export function ledgerAt(rev, cwd) {
  const ids = new Set();
  const bySource = {};
  const missingSources = [];
  for (const path of LEDGER_SOURCES) {
    const src = path === LEDGER_SOURCES[0] ? migrationLedgerTextAt(rev, cwd) : showOrNull(rev, path, cwd);
    if (src === null) { missingSources.push(path); continue; }
    const found = extractIds(src);
    bySource[path] = found.length;
    for (const id of found) ids.add(id);
  }
  return { ids, bySource, missingSources };
}

/**
 * The text of the migration ledger at a rev: what that rev's BUILD reads.
 *
 * In the generated era (#22554: the rev tracks `MIGRATION_LEDGER_TEMPLATE`) that is
 * the template followed by every `.ts` entry file the generator concatenates into
 * it — the generated registry's lines, in another order, which `extractIds` reads as
 * a set. A non-`.ts` file there (the directory's README, whose examples spell
 * id-shaped lines) is not an entry: the generator refuses it, so it is not read. A
 * registry file a rev of this era still tracks is a stale copy, and the template
 * wins over it. In the committed era the registry itself is the text. `null` when a
 * rev has neither: a red in `assertInputs`, never an empty ledger.
 *
 * Exported for the self-test's GR battery.
 *
 * @returns {string | null}
 */
export function migrationLedgerTextAt(rev, cwd) {
  const template = showOrNull(rev, MIGRATION_LEDGER_TEMPLATE, cwd);
  if (template === null) return showOrNull(rev, LEDGER_SOURCES[0], cwd);
  let listed;
  try {
    listed = git(['ls-tree', '-r', '--name-only', rev, '--', ...MIGRATION_LEDGER_ENTRY_DIRS], cwd);
  } catch {
    return null;
  }
  const entries = listed.split('\n').map((p) => p.trim()).filter((p) => p.endsWith('.ts')).sort();
  const texts = showManyOrNull(rev, entries, cwd);
  if (texts.size !== entries.length) return null;
  return [template, ...entries.map((p) => texts.get(p))].join('\n');
}

// ---------------------------------------------------------------------------
// Input assertions -- absence is never a pass (#4690)
// ---------------------------------------------------------------------------

/**
 * Prove every input this gate reasons over is present and non-empty BEFORE any
 * verdict is produced. Each failure here is a red, never a skip.
 *
 * @param {{ cwd: string, head: string, witness?: typeof generatedWitness }} opts
 *   `witness` produces the parser-rot witness; the real gate always runs
 *   `generatedWitness`. The self-test injects one only for fixtures whose subject
 *   is some OTHER input, and drives the real one wherever the witness is the subject.
 * @returns {string[]} problems
 */
export function assertInputs({ cwd, head, witness = generatedWitness }) {
  const problems = [];

  // (1) the subject matter's DIRECTORY is readable at all. Its POPULATION is
  //     repo phase, not an input problem (#8658): right after a release cut,
  //     `version packages` has consumed the whole stock, and this gate's
  //     subject is the DIFF — a PR that introduces no changeset over an empty
  //     stock has nothing to judge and must be clean, not refused. What stays
  //     a refusal is the directory itself being missing or unlistable at HEAD
  //     (the #4690 posture, kept deliberately): `.changeset/README.md` and
  //     `config.json` are tracked, so a rev where `ls-tree` finds NOTHING
  //     under `.changeset/` is a rev this gate cannot trust — the directory
  //     moved, or the read failed.
  const csDir = changesetDirAt(head, cwd);
  if (csDir === null || csDir.entries.length === 0) {
    problems.push(
      '`.changeset/` is missing or unlistable at HEAD — not even its tracked README.md/config.json\n' +
      '    were found. This gate judges changesets; a rev where their directory cannot be read would\n' +
      '    report success while checking nothing (#4690). If the changeset directory genuinely moved,\n' +
      '    this gate moves with it. (An EMPTY stock is NOT this failure: zero pending changesets is\n' +
      '    the legitimate state of main right after a release cut — #8658.)',
    );
  }

  // (2) the ledger exists and is non-empty
  const { ids, bySource, missingSources } = ledgerAt(head, cwd);
  for (const path of missingSources) {
    problems.push(
      `ADR-0087 ledger source not found at HEAD: ${path}` +
      (path === LEDGER_SOURCES[0] ? ` (nor its generated-era source, ${MIGRATION_LEDGER_TEMPLATE})` : '') + '\n' +
      '    fix: if the ledger moved, update LEDGER_SOURCES in this script. A missing ledger is a\n' +
      '    red, never a silent skip -- every `registered` claim would otherwise be unverifiable.',
    );
  }
  for (const [path, n] of Object.entries(bySource)) {
    if (n === 0) {
      problems.push(
        `ADR-0087 ledger source ${path} yielded ZERO ids.\n` +
        '    Either the ledger was emptied, or extractIds() no longer matches its declaration shape.\n' +
        '    Both are red: with no ids, every `registered` disposition would fail and every\n' +
        '    `already-registered` one would too.',
      );
    }
  }

  // (3) PARSER ROT -- the projection GENERATED at `head` is the independent witness
  //     that the source parser still sees what the build sees (#22485: generated,
  //     never read from a committed copy). Projection must be a SUBSET of source.
  //     Both sides now describe the same rev, so the only way they disagree is a
  //     parser that no longer matches the registry's declaration shape.
  const generated = witness({ cwd, head });
  if (generated.problem) {
    problems.push(`no parser-rot witness: ${generated.problem}`);
  } else {
    const projected = projectedMigrationIds(generated.json);
    if (projected.length === 0) {
      problems.push(
        `the spec-changes.json generated at ${head} carries no \`migrationId\` at all.\n` +
        '    The projection is this gate\'s witness for the source parser; an empty witness\n' +
        '    witnesses nothing (#4690).',
      );
    }
    const unseen = projected.filter((id) => !ids.has(id));
    if (unseen.length > 0) {
      problems.push(
        `ledger parser drift: ${unseen.length} id(s) present in the spec-changes.json generated at ${head}\n` +
        `    are NOT found by extractIds() in ${LEDGER_SOURCES[0]}:\n` +
        unseen.slice(0, 8).map((id) => `      - ${id}`).join('\n') +
        (unseen.length > 8 ? `\n      ... and ${unseen.length - 8} more` : '') +
        '\n    The registry\'s declaration shape changed underneath this gate. Left alone, the id\n' +
        '    set shrinks silently and every `registered` disposition starts failing for the wrong\n' +
        '    reason. fix: widen extractIds() to match the new shape, in the same PR that changes it.',
      );
    }
  }

  // (4) CONVENTION ROT -- if `major` / `**BREAKING` / `feat!:` are ever reworded
  //     wholesale, this gate matches nothing and passes everything in silence.
  //     Guarded by SYNTHETIC controls, never by the live stock (#8658): "at
  //     least one breaking changeset in the real stock" asserted repo PHASE,
  //     not detector health -- a release's `version packages` consumes exactly
  //     that population, so the old spelling went red on every post-cut PR
  //     while proving nothing about this checker. These fixtures pin each
  //     spelling `breakingDeclaration()` is specified to match (the three
  //     signals its doc comment names, including the #7004 comment/quoting
  //     dialects), plus shapes that must NOT match, and they run on EVERY
  //     invocation regardless of what the release train last did to
  //     `.changeset/`. A wholesale rewording of the convention now surfaces at
  //     the moment convention and detector are changed apart: whoever rewords
  //     `breakingDeclaration()` must reword these fixtures in the same edit,
  //     or this refusal names the divergence.
  const MUST_MATCH_BREAKING = [
    ['a `major` frontmatter bump', "---\n'@objectstack/spec': major\n---\n\nan ordinary summary\n"],
    ['a quoted `major` bump with a trailing YAML comment (#7004)', '---\n"@objectstack/spec": "major" # keep\n---\n\nan ordinary summary\n'],
    ['a `**BREAKING**` body marker', "---\n'@objectstack/spec': minor\n---\n\na summary\n\n**BREAKING**: something changed\n"],
    ['a `BREAKING CHANGE:` body line', "---\n'@objectstack/spec': minor\n---\n\na summary\n\nBREAKING CHANGE: something changed\n"],
    ['a conventional-commit `!` summary', "---\n'@objectstack/spec': patch\n---\n\nfeat(spec)!: drop a key\n"],
    // #16421, signal (4) — the ARM, pinned in BOTH directions across these two
    // lists. `narrowing` here, `widening` in the inverted list below: an arm
    // reading that classified both as breaking would satisfy this list alone
    // while telling a consumer nothing, so neither fixture means anything
    // without the other. The `minor` bump and the banner-free body are the
    // point — this is the exact shape #16296 shipped in, and the three older
    // signals are all absent from it on purpose.
    ['the `narrowing` ARM with no banner, no `major` and no `!` (#16421)', "---\n'@objectstack/spec': minor\n---\n\na summary\n\nClause-②: no (narrowing)\n"],
    ['the `narrowing` arm beside a `yes` value — a diff that widens AND narrows', "---\n'@objectstack/spec': minor\n---\n\na summary\n\nClause-②: yes (narrowing)\n"],
    // Ruling A, signal (5): the kind alone, with no arm, no banner, no `major`
    // and no `!` — the shape the level gate refuses on the PR body and this
    // gate must not wave through on the changeset body.
    ['the `Metadata-protocol: narrowed` kind with no arm, no banner, no `major` and no `!` (ruling A)', "---\n'@objectstack/spec': minor\n---\n\na summary\n\nMetadata-protocol: narrowed\n"],
  ];
  const MUST_NOT_MATCH_BREAKING = [
    ['a plain `patch` changeset', "---\n'@objectstack/spec': patch\n---\n\nfix a typo\n"],
    ['a `minor` changeset whose prose merely contains the word breaking', "---\n'@objectstack/spec': minor\n---\n\nnothing groundbreaking here\n"],
    // The OTHER direction of signal (4). A widening is not a break.
    ['the `widening` ARM — the arm reads, and reads as NOT breaking (#16421)', "---\n'@objectstack/spec': minor\n---\n\na summary\n\nClause-②: yes (widening)\n"],
    ['a bare `Clause-②: no` — the shape every declaration on the board carries', "---\n'@objectstack/spec': patch\n---\n\na summary\n\nClause-②: no\n"],
    ['a bare `Clause-②: yes` — a widening declared through the value alone', "---\n'@objectstack/spec': minor\n---\n\na summary\n\nClause-②: yes\n"],
    ['prose merely NAMING the arm — the reader takes a token, never a phrase', "---\n'@objectstack/spec': minor\n---\n\nthis is a narrowing of nothing at all\n"],
    // The OTHER three kinds of signal (5): a new key, a changed default and a
    // non-protocol change are not breaks. Without these rows a reader that
    // classified every `Metadata-protocol:` line as breaking would satisfy the
    // list above while telling a consumer nothing.
    ['`Metadata-protocol: added` — a new key is not a break (ruling A)', "---\n'@objectstack/spec': minor\n---\n\na summary\n\nClause-②: yes\n\nMetadata-protocol: added\n"],
    ['`Metadata-protocol: semantic` — a changed default is not a break (ruling A)', "---\n'@objectstack/spec': minor\n---\n\na summary\n\nClause-②: no\n\nMetadata-protocol: semantic\n"],
    ['`Metadata-protocol: none` — a non-protocol change at `patch` (ruling A)', "---\n'@objectstack/rest': patch\n---\n\na summary\n\nClause-②: yes\n\nMetadata-protocol: none\n"],
    ['a MALFORMED kind declares nothing here — the level gate refuses it on the PR', "---\n'@objectstack/spec': minor\n---\n\na summary\n\nMetadata-protocol: narrowed|added\n"],
  ];
  for (const [label, text] of MUST_MATCH_BREAKING) {
    if (!breakingDeclaration(parseChangeset(text)).breaking) {
      problems.push(
        `CONVENTION ROT: ${label} no longer matches the breaking-change detector.\n` +
        '    This gate fires on declared-breaking changesets; a detector that misses a documented\n' +
        '    spelling is a no-op reporting success on exactly those changesets (#4690). If the\n' +
        '    breaking-change convention was deliberately reworded, this gate\'s contract changed with\n' +
        '    it -- update breakingDeclaration() and these control fixtures together, rather than\n' +
        '    leaving a green gate that checks nothing.',
      );
    }
  }
  for (const [label, text] of MUST_NOT_MATCH_BREAKING) {
    if (breakingDeclaration(parseChangeset(text)).breaking) {
      problems.push(
        `CONVENTION ROT (inverted): ${label} now matches the breaking-change detector.\n` +
        '    An over-matching detector demands an ADR-0087 disposition of authors who declared\n' +
        '    nothing breaking, which teaches them to write markers by rote -- the allow-list decay\n' +
        '    this gate exists to avoid. Narrow breakingDeclaration() and these control fixtures\n' +
        '    together.',
      );
    }
  }

  // (5) VOCABULARY DRIFT (#8299) -- the categories this gate accepts and the ones
  //     ADR-0087 documents are ONE decision with two faces. Checked BOTH ways: an
  //     undocumented category is an exemption an author cannot look up, and a
  //     documented one this gate rejects is an exemption nobody can claim. #8299
  //     exists because #8277's correct argument had no named category to cite.
  const adrText = showOrNull(head, ADR_0087, cwd);
  if (adrText === null) {
    problems.push(
      `ADR-0087 not found at HEAD: ${ADR_0087}\n` +
      '    It is where an author reads what each `not-required` category means, and this gate\n' +
      '    refuses to accept a vocabulary whose written half it cannot see. If the record moved,\n' +
      '    update ADR_0087 in this script in the same PR.',
    );
  } else {
    const documented = documentedCategories(adrText);
    const undocumented = CATEGORIES.filter((c) => !documented.has(c));
    const unimplemented = [...documented].filter((c) => !CATEGORIES.includes(c));
    if (undocumented.length > 0) {
      problems.push(
        `category documented nowhere: ${undocumented.join(', ')}\n` +
        `    CATEGORIES accepts ${undocumented.length === 1 ? 'it' : 'them'}, and ${ADR_0087} carries no\n` +
        '    `<!-- adr-0087: not-required (<category>) ... -->` example for it. An exemption an author\n' +
        '    cannot look up gets re-derived by hand or mis-generalised, which is #8299 exactly.\n' +
        '    fix: describe it in the ADR -- when it may be claimed and what this gate checks -- in\n' +
        '    the same PR that adds it here.',
      );
    }
    if (unimplemented.length > 0) {
      problems.push(
        `category documented but not accepted: ${unimplemented.join(', ')}\n` +
        `    ${ADR_0087} describes it and CATEGORIES does not list it, so any author who follows the\n` +
        '    ADR is refused by this gate for writing exactly what the ADR told them to write.\n' +
        '    fix: implement its check here, or remove it from the ADR.',
      );
    }
  }

  // (6) FRAMING-SCAN ROT (#12996) -- the one part of the prescription detector
  //     whose TOTAL FAILURE is indistinguishable from its success. Branches 2 and
  //     3 read a rewrite only inside a framed region, and a region is opened and
  //     closed by `HEADING_RE`. If that scan ever stops seeing headings -- a
  //     rewritten pattern, a heading dialect it cannot read -- every region is
  //     empty, no prescription is ever found, and `no-migration-prescription` and
  //     `runtime-interface-only` become free for everyone, reported as a clean
  //     run. "Zero framed sections" is exactly what a body with no migration
  //     section legitimately produces, so the stock cannot tell the two apart;
  //     synthetic controls can, and they run on every invocation for the #8658
  //     reason (4) gives -- the live stock's prescription population is repo
  //     phase, not detector health.
  //
  //     BOTH directions are controlled, because the cure has its own failure
  //     mode: a framed region that never CLOSES frames the rest of the document,
  //     which is the same over-matching #6559 rejected the label-framed arrow arm
  //     for. The floors below are the half that says the scan is discriminating
  //     rather than merely saying yes.
  const MUST_FRAME = [
    [
      'a rewrite table under a `## Migration` heading',
      '## Migration\n\n| Wrote | Write instead |\n| --- | --- |\n| `a.b` | `a.c` |\n',
      'framed-table',
    ],
    [
      'a rewrite table under a `###` SUB-heading of `## Migration` (#12996)',
      '## Migration\n\n### Method namespace\n\n| before | after |\n| --- | --- |\n| `a.b` | `a.c` |\n',
      'framed-table',
    ],
    ['an arrow rewrite under a `## 迁移` heading', '## 迁移\n\n- `a.b` → `a.c`\n', 'framed-section'],
    // The retirement arm (#18745) reads a rewrite inside the SAME framed region, so
    // it rots with the framing scan and is controlled with it. Without this row a
    // framing scan that stopped seeing headings would take the removal arm down
    // silently and the three rows above would still say the scan is healthy.
    [
      'a REMOVAL prescription under a `## Migration` heading (#18745)',
      '## Migration\n\n- `a.b` → delete the property\n',
      'framed-section-removal',
    ],
  ];
  const MUST_NOT_FRAME = [
    [
      'a rewrite table under a heading carrying no framing at all',
      '## What changed\n\n| Member | Behaviour |\n| --- | --- |\n| `a.b` | now resolves through `c.d` |\n',
    ],
    [
      'a rewrite table under a SIBLING heading that closed the framed region above it',
      '## Migration\n\n- see below\n\n## Notes\n\n| Member | Behaviour |\n| --- | --- |\n| `a.b` | now resolves through `c.d` |\n',
    ],
  ];
  for (const [label, text, branch] of MUST_FRAME) {
    const hit = findMigrationPrescription(text);
    if (hit?.branch !== branch) {
      problems.push(
        `FRAMING-SCAN ROT: ${label} is no longer read as a prescription` +
        `${hit ? ` (reported \`${hit.branch}\`, expected \`${branch}\`)` : ' (reported nothing at all)'}.\n` +
        '    The framed region is what branches 2 and 3 read a rewrite inside. A scan that finds no\n' +
        '    section finds no prescription either, and this gate would then hand out\n' +
        '    `no-migration-prescription` and `runtime-interface-only` to every author while\n' +
        '    reporting a clean run (#4690) -- the success condition and the total-failure condition\n' +
        '    are the same observation. If the framing convention genuinely changed, change\n' +
        '    HEADING_RE / MIGRATION_FRAMING_RE and these controls in one edit.',
      );
    }
  }
  for (const [label, text] of MUST_NOT_FRAME) {
    const hit = findMigrationPrescription(text);
    if (hit) {
      problems.push(
        `FRAMING-SCAN ROT (inverted): ${label} now reads as a prescription (\`${hit.branch}\`).\n` +
        `      ${hit.line.slice(0, 120)}\n` +
        '    A framed region that does not close frames the REST OF THE DOCUMENT, which refuses an\n' +
        '    exemption to authors entitled to it and offers them nothing else -- the #6419 shape,\n' +
        '    one category over. Narrow the scan and these controls together.',
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Workspace manifests -- the `unpublished` precondition
// ---------------------------------------------------------------------------

/**
 * The workspace's package globs at a rev -- `pnpm-workspace.yaml` read from git and
 * parsed by `workspace-enumerator.mjs`, the repo's one parse of it (#26220).
 *
 * This gate used to carry its own `PACKAGE_ROOTS = ['packages', 'apps', 'examples']`.
 * That list predates the objectui import, so every `@object-ui/*` package (the
 * `ui/packages/*`, `ui/apps/*` and `ui/examples/*` globs) had no workspace manifest
 * here, and every disposition that reads one -- `unpublished`, `type-surface-only`
 * predicate 1, `runtime-export-retired` predicate 1 -- refused a true claim about
 * them. A hand-kept copy of the workspace's membership is the same drift #14378
 * found in a different file; the workspace's own declaration cannot drift from
 * itself. Read at the REV being judged, never from the working tree, so the gate
 * stays a pure function of its two revs.
 *
 * A missing file, an empty or duplicate `packages:` block and a glob richer than
 * `<dir>` / `<dir>/*` are REFUSED with `WorkspaceEnumerationError`, never read as an
 * empty workspace: every disposition above would then answer "no workspace
 * manifest" about a package that has one.
 *
 * @returns {string[]} the inclusion globs; an exclusion (`!pattern`) enumerates nothing
 */
export function workspaceGlobsAt(rev, cwd) {
  const source = `${WORKSPACE_FILE} at ${rev.slice(0, 12)}`;
  const text = showOrNull(rev, WORKSPACE_FILE, cwd);
  if (text === null) {
    throw new WorkspaceEnumerationError(
      `${source} is missing -- the workspace's package globs cannot be read, so no package can be\n` +
        '      matched to its manifest. Refused rather than read as an empty workspace (#4690).',
    );
  }
  const globs = parseWorkspaceGlobs(text, { source }).filter((g) => !isExclusionGlob(g));
  for (const g of globs) {
    if (g.replace(/\/\*$/, '').includes('*')) {
      throw new WorkspaceEnumerationError(
        `${source}: pattern ${JSON.stringify(g)} is richer than \`<dir>\` or \`<dir>/*\`, the two shapes\n` +
          '      `workspace-enumerator.mjs` expands. Teach both readers the new shape in one edit;\n' +
          '      matching fewer manifests would refuse true claims about the packages left out.',
      );
    }
  }
  return globs;
}

/**
 * Is `manifest` (a repo-relative `<dir>/package.json`) a workspace member's
 * manifest under `globs`? `<dir>` names that directory; `<dir>/*` names each
 * directory directly under it -- the expansion `expandWorkspaceGlob` performs on a
 * working tree, applied here to a path listed from a rev.
 */
export function isWorkspaceManifest(manifest, globs) {
  if (!manifest.endsWith('/package.json') || manifest.includes('node_modules/')) return false;
  const dir = manifest.slice(0, -'/package.json'.length);
  const parent = posix.dirname(dir);
  const leaf = posix.basename(dir);
  return globs.some((g) => (g.endsWith('/*')
    ? parent === g.slice(0, -2) && !leaf.startsWith('.')
    : dir === g));
}

/**
 * name -> { private, file } for every workspace package at a rev.
 *
 * Read from git rather than the working tree so the whole gate is a pure function
 * of two revs, which is what lets the self-test drive the shipping code path with
 * real temp repositories instead of an imitation of it. The members are the ones
 * the rev's own `pnpm-workspace.yaml` declares (`workspaceGlobsAt`).
 */
export function workspacePackagesAt(rev, cwd) {
  const pkgs = new Map();
  const globs = workspaceGlobsAt(rev, cwd);
  let out;
  try { out = git(['ls-tree', '-r', '--name-only', rev], cwd); } catch { return pkgs; }
  const manifests = out
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => isWorkspaceManifest(p, globs));
  for (const [p, raw] of showManyOrNull(rev, manifests, cwd)) {
    try {
      const json = JSON.parse(raw);
      if (json.name && !pkgs.has(json.name)) pkgs.set(json.name, { private: json.private === true, file: p });
    } catch { /* an unparseable manifest is another gate's problem */ }
  }
  return pkgs;
}

// ---------------------------------------------------------------------------
// `runtime-interface-only` -- the metadata-surface predicate (#8299)
//
// The full argument is in the header section of the same name. This block is the
// mechanism; every rule here has a sentence there and in ADR-0087's addendum of
// 2026-08-13, deliberately in the same words.
// ---------------------------------------------------------------------------

/** Spec's service-contract directory: a declaration here IS a spec declaration. */
const SPEC_CONTRACTS_DIR = 'packages/spec/src/contracts/';

const TS_FILE_RE = /\.[cm]?tsx?$/;
/** A test is not an authoring surface: it consumes metadata, it never declares any. */
const TEST_FILE_RE = /\.(?:test|spec|bench|pin\.test)\.[cm]?tsx?$/;

/**
 * Is this path a metadata surface, and which kind?
 *
 * The three kinds are exactly the three #8299 names -- a Zod schema, a spec
 * `contracts/**` entry, an object definition -- because those are the three ways a
 * symbol becomes something `objectstack migrate meta` can reach. It is a PATH
 * classifier and nothing more; what a file says about a symbol is step 4's job.
 *
 * @param {string} p repo-relative path
 * @returns {string|null} a human-readable kind, or null when it is not a surface
 */
export function metadataSurfaceKind(p) {
  if (!p || p.includes('node_modules/') || !TS_FILE_RE.test(p)) return null;
  if (TEST_FILE_RE.test(p)) return null;
  if (p.endsWith('.zod.ts')) return 'a Zod schema';
  if (p.startsWith(SPEC_CONTRACTS_DIR)) return 'a spec contracts/** entry';
  if (/\.object\.[cm]?ts$/.test(p) || /(?:^|\/)objects\/[^/]+\.[cm]?ts$/.test(p)) return 'an object definition';
  return null;
}

/** Every metadata-surface path present at a rev. */
function metadataSurfaceFilesAt(rev, cwd) {
  let out;
  try { out = git(['ls-tree', '-r', '--name-only', rev], cwd); } catch { return []; }
  return out.split('\n').map((s) => s.trim()).filter((p) => metadataSurfaceKind(p) !== null);
}

const IDENT = '[A-Za-z_$][A-Za-z0-9_$]*';
// A DOTTED MEMBER PATH: `oauth.applications.get`. The leading segments are the
// nesting the member sits in -- an object literal or a class (#17279); the last
// one is the member itself.
const MEMBER_PATH_RE = new RegExp(`^${IDENT}(?:\\.${IDENT})*$`);

/**
 * `<dir>/<file>.ts#<Symbol>` or `<dir>/<file>.ts#<a>.<b>.<member>` -> its halves, or null.
 *
 * ⚠️ The grammar was widened to a dotted member path (#15627), and the widening is
 * only sound because the READER was widened in the same commit. `packages/client/
 * src/index.ts` declares `get` 14 times and `delete` 10 times, and a bare reference
 * resolves to the FIRST same-named definition in the file — so the members PR
 * #15445 and #15451 actually narrowed (`oauth.applications.get` at line 3184,
 * `oauth.applications.delete` at 3243) had NO addressable spelling at all: #15451's
 * whole category was closed by the grammar rather than by a judgement about it.
 * ⛔ A wider grammar over the old first-same-name reader would be strictly worse
 * than that refusal — writable but wrong — so `dotted` references are resolved
 * STRUCTURALLY (`resolveMemberPath`) and refused, never guessed, when the walk
 * finds zero or more than one candidate. A leading segment names an object
 * literal or a CLASS (#17279): reading only the first left the dotted spelling on
 * `packages/objectql/src/engine.ts#ObjectRepository` unwritable, while the bare
 * `packages/objectql/src/engine.ts#delete` answered about `ObjectQL.delete` — a
 * member the diff never touched, which is #15627's own defect surviving its fix on
 * the container kind that fix did not cover. ⛔ A line number is never the
 * disambiguator: this file's line numbers were measured to rot within one day.
 *
 * @returns {{ path: string, symbol: string, segments: string[], dotted: boolean }|null}
 *   `symbol` is the LAST segment — the member's own name; `segments` is the whole
 *   path. A caller that can only read a top-level declaration must branch on
 *   `dotted` rather than silently reading `symbol` out of its nesting.
 */
export function parseSymbolRef(ref) {
  const at = ref.indexOf('#');
  if (at <= 0) return null;
  const path = ref.slice(0, at);
  const spelling = ref.slice(at + 1);
  if (!MEMBER_PATH_RE.test(spelling) || path.includes('#') || spelling.length === 0) return null;
  const segments = spelling.split('.');
  return { path, symbol: segments[segments.length - 1], segments, dotted: segments.length > 1 };
}

/**
 * The EXPORTED type declaration of `symbol` in `text`, or null.
 *
 * Exported, because an unexported symbol reaches no consumer and needs no
 * exemption; `const`/`function` are absent on purpose -- this category is about a
 * TYPE surface the compiler carries, not about runtime values.
 */
export function exportedTypeDeclaration(text, symbol) {
  const re = new RegExp(
    `^[ \\t]*export[ \\t]+(?:declare[ \\t]+)?(?:abstract[ \\t]+)?(interface|type|class|enum)[ \\t]+${symbol}\\b([^\\n]*)`,
    'm',
  );
  const m = re.exec(text);
  if (!m) return null;
  // `restStart` is where `rest` BEGINS in `text`. A caller that walks the
  // declaration's body needs an offset, and `text.indexOf(rest)` is not one: `rest`
  // is the tail of a single LINE, so an identical tail anywhere earlier in the file
  // wins that search and the walk starts inside someone else's declaration.
  return { kind: m[1], rest: m[2], restStart: m.index + m[0].length - m[2].length };
}

/** Any declaration of the name at all, exported or not -- the homonym test. */
function declaresLocally(text, symbol) {
  const re = new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?(?:declare[ \\t]+)?(?:abstract[ \\t]+)?` +
    `(?:interface|type|class|enum|const|let|var|function)[ \\t]+${symbol}\\b`,
    'm',
  );
  return re.test(text);
}

// What may stand between a member's separator and its name: the modifiers a class
// or interface member is written with. Stripped from the END of the text before
// the name, so `readonly x:` and `private static async x(` read like `x`.
const MEMBER_MODIFIERS_TAIL_RE =
  /(?:\b(?:public|private|protected|static|readonly|abstract|declare|override|async|accessor|get|set)\s+|\*\s*)+$/;
// After the name: a signature or a field. `?` / `!` may come first; a generic
// method's `<T>` must be followed by its parameter list.
const MEMBER_TAIL_RE = /^\s*[?!]?\s*(?:[:(;=]|<[^;{}]*?>\s*\()/;

/**
 * The offsets of every occurrence of `symbol` that is the NAME of a member
 * declaration -- a method or property signature in an `interface` body or a type
 * literal, or a method or field declared at the top depth of a `class` body (#25293).
 *
 * A member's name is a homonym, not a reference: `IEmailService.renderTemplate`
 * names a method of the contract, and nothing in it reaches an export of the same
 * name. Only the name's own bytes are returned, so the caller blanks THEM and
 * still reads every other occurrence in the file -- a bare call, a value, a member
 * ACCESS (`svc.renderTemplate(...)`, excluded by the leading dot) and every string
 * literal stay mentions.
 *
 * Regions, all located on the comment- and literal-masked projection (offsets
 * preserved, so a brace inside a string never steers the walk):
 *
 *   interface NAME ... { ... }   every `{` inside is a type literal, any depth
 *   type NAME = ...              the alias RHS, likewise
 *   class NAME ... { ... }       TOP DEPTH only -- a nested `{` is a method body,
 *                                where `name(x);` is a CALL
 *
 * Inside a region the innermost open bracket must be a `{` of that region, so a
 * parameter name (`(name: T) => R`) or a type argument (`Map<K, name>`) never
 * counts. ⛔ A generic constraint on a function (`<T extends { name(): R }>`) and an
 * object literal's key are NOT read: neither is the shape the card names, and the
 * conservative direction here is to refuse (#4690).
 *
 * @returns {number[]} start offsets of the member-name occurrences, in file order
 */
export function memberDeclarationOffsets(text, symbol) {
  const structural = maskCommentsAndLiterals(text);
  const regions = [];
  for (const m of structural.matchAll(new RegExp(`(?:^|[^\\w$.])interface\\s+(${IDENT})\\b`, 'g'))) {
    const open = declarationBodyStart(structural, m.index + m[0].length);
    const close = open === -1 ? -1 : matchBracket(structural, open);
    if (close !== -1) regions.push({ from: open, to: close, topOnly: false });
  }
  for (const m of structural.matchAll(new RegExp(`(?:^|[^\\w$.])type\\s+(${IDENT})\\b`, 'g'))) {
    const eq = aliasEqualsIndex(structural, m.index + m[0].length);
    if (eq !== -1) regions.push({ from: eq, to: aliasRhsEnd(structural, eq), topOnly: false });
  }
  for (const b of classBodiesFor(structural, IDENT, 0, structural.length)) {
    regions.push({ from: b.open, to: b.close, topOnly: true });
  }

  const out = [];
  for (const m of structural.matchAll(new RegExp(`(?<![\\w$.])${symbol}(?![\\w$])`, 'g'))) {
    const at = m.index;
    if (!MEMBER_TAIL_RE.test(structural.slice(at + symbol.length))) continue;
    const before = structural.slice(0, at).replace(MEMBER_MODIFIERS_TAIL_RE, '');
    const prev = before.trimEnd();
    const sep = prev.slice(-1);
    const newlineSeparated = /\n[ \t]*$/.test(before) && !/[&|=:<([?.]$/.test(prev);
    if (!'{;,'.includes(sep) && !newlineSeparated) continue;
    if (regions.some((r) => at > r.from && at < r.to && innermostOpenerIsMemberBrace(structural, r, at))) {
      out.push(at);
    }
  }
  return out;
}

/**
 * Whether the innermost bracket open at `at` (walked from region `r`'s start) is a
 * `{` that holds members: any `{` of a type region, or the class body itself.
 * A closer pops back to its own opener, so a stray `<` -- a comparison inside a
 * method body, the `>` of `=>` -- cannot leave the stack wrong past its block.
 */
function innermostOpenerIsMemberBrace(structural, r, at) {
  const CLOSES = { '}': '{', ')': '(', ']': '[' };
  const stack = [];
  // A type alias's RHS starts at its `=`, not at a brace, so its top depth holds
  // no members; an `interface` / `class` region starts ON its body brace.
  for (let i = r.from; i < at; i++) {
    const c = structural[i];
    if (c === '{' || c === '(' || c === '[' || c === '<') stack.push(c);
    else if (c === '>' && structural[i - 1] !== '=') { if (stack[stack.length - 1] === '<') stack.pop(); }
    else if (CLOSES[c]) {
      while (stack.length > 0 && stack[stack.length - 1] !== CLOSES[c]) stack.pop();
      stack.pop();
    }
  }
  if (stack[stack.length - 1] !== '{') return false;
  return r.topOnly ? stack.length === 1 : true;
}

/**
 * `z.input<typeof XSchema>` and its family: the house spelling of "this type IS
 * metadata" under Prime Directive #1. Checked on the declaration's own tail, not
 * on the whole file, so an unrelated schema elsewhere in the module says nothing.
 */
const ZOD_PROJECTION_RE = /\bz\s*\.\s*(?:input|infer|output)\s*</;

/** Every module specifier that brings `symbol` into `text`. */
export function importSpecifiersFor(text, symbol) {
  const out = [];
  const word = new RegExp(`\\b${symbol}\\b`);
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    if (word.test(m[1])) out.push(m[2]);
  }
  return out;
}

/** The workspace package a path belongs to: the longest manifest prefix wins. */
function owningPackageName(path, pkgs) {
  let best = null;
  for (const [name, info] of pkgs) {
    const dir = info.file.slice(0, -'package.json'.length);
    if (path.startsWith(dir) && (best === null || dir.length > best.dir.length)) best = { name, dir };
  }
  return best?.name ?? null;
}

const stripModuleSuffix = (p) => p.replace(TS_FILE_RE, '').replace(/\/index$/, '');

/**
 * Does `specifier`, written in `fromPath`, name the module that declares `declPath`?
 *
 * Relative specifiers are resolved positionally; a bare one is matched against the
 * declaring path's own workspace package, subpath exports included. The subpath
 * case is deliberately COARSE -- `@objectstack/x/anything` counts as the declaring
 * module -- because the conservative direction here is to REFUSE the exemption.
 */
export function specifierNamesModule(specifier, fromPath, declPath, pkgs) {
  if (specifier.startsWith('.')) {
    return stripModuleSuffix(join(dirname(fromPath), specifier)) === stripModuleSuffix(declPath);
  }
  const owner = owningPackageName(declPath, pkgs);
  if (!owner) return false;
  return specifier === owner || specifier.startsWith(`${owner}/`);
}

/**
 * Verify one `runtime-interface-only` claim.
 *
 * @param {string[]} refs the `<path>#<Symbol>` tokens the marker named
 * @param {{ rev: string, cwd: string, packages: () => Map<string, {private: boolean, file: string}> }} ctx
 * @returns {{ problems: string[], verified: {ref: string, kind: string}[] }}
 */
export function verifyRuntimeInterfaceOnly(refs, { rev, cwd, packages }) {
  const problems = [];
  const verified = [];
  const HOW = (badRef) =>
    '      fix: name the symbol as `<repo-relative-path>#<Symbol>`, e.g.\n' +
    '        <!-- adr-0087: not-required (runtime-interface-only ' +
    'packages/services/service-package/src/index.ts#PackagePublishResult) why -->\n' +
    '      A BARE NAME is refused on purpose: `PackagePublishResult` names two unrelated symbols in\n' +
    '      this repo -- one runtime interface and one Zod projection in `packages/spec` -- and only\n' +
    `      the path tells them apart${badRef ? ` (got: ${badRef})` : ''}.`;

  if (refs.length === 0) {
    problems.push(
      '`not-required (runtime-interface-only)` names no symbol.\n' +
      '      The whole content of this exemption is WHICH symbol has no metadata surface, so an\n' +
      '      unnamed one asserts nothing checkable (#4690).\n' +
      HOW(null),
    );
    return { problems, verified };
  }

  const surfacePaths = metadataSurfaceFilesAt(rev, cwd);
  if (surfacePaths.length === 0) {
    problems.push(
      '`not-required (runtime-interface-only)` cannot be verified: NO metadata-surface file\n' +
      `      (\`*.zod.ts\`, \`${SPEC_CONTRACTS_DIR}**\`, object definitions) was found at HEAD.\n` +
      '      The scan that would refuse this claim has nothing to read, so accepting it would be a\n' +
      '      green no-op (#4690). If those surfaces moved, this gate moves with them.',
    );
    return { problems, verified };
  }
  let surfaceTexts = null;
  const surfaces = () => (surfaceTexts ??= showManyOrNull(rev, surfacePaths, cwd));

  for (const ref of refs) {
    const parsedRef = parseSymbolRef(ref);
    if (!parsedRef) {
      problems.push(`\`runtime-interface-only\` names "${ref}", which is not a \`<path>#<Symbol>\` reference.\n${HOW(ref)}`);
      continue;
    }
    // A DOTTED member path is meaningful only where a MEMBER is read (predicate 4).
    // This category reads an exported `interface` / `type` / `class` / `enum` by
    // NAME, which is top-level by construction, so a nesting walk has nothing to
    // walk -- naming a class as a dotted segment (#17279) reaches its MEMBERS, and
    // this category does not read one. Refused
    // by name rather than silently read as its last segment: `a.b.Result` quietly
    // becoming `Result` is exactly the "writable but wrong" reference #15627's
    // widening exists to prevent.
    if (parsedRef.dotted) {
      problems.push(
        `\`runtime-interface-only\` names "${ref}", a DOTTED member path. This category names an\n` +
        '      exported type declaration, which is top-level -- there is no nesting to\n' +
        '      resolve through. The dotted spelling is accepted only by `type-surface-only`, which\n' +
        `      reads a member.\n${HOW(ref)}`,
      );
      continue;
    }
    const { path, symbol } = parsedRef;

    // (1) it resolves
    const text = showOrNull(rev, path, cwd);
    if (text === null) {
      problems.push(
        `\`runtime-interface-only ${ref}\` names a path that does not exist at HEAD: ${path}\n` +
        '      An exemption whose subject cannot be found is refused, never assumed true (#4690).',
      );
      continue;
    }
    const decl = exportedTypeDeclaration(text, symbol);
    if (!decl) {
      problems.push(
        `\`runtime-interface-only ${ref}\`: ${path} exports no \`${symbol}\` type declaration at HEAD.\n` +
        '      Searched for an exported `interface` / `type` / `class` / `enum` of that name. A symbol\n' +
        '      that is not exported reaches no consumer and needs no exemption; one that is exported\n' +
        '      from somewhere else should be named at ITS path.',
      );
      continue;
    }

    // (2) the declaration site is not itself a metadata surface
    const ownKind = metadataSurfaceKind(path);
    if (ownKind) {
      problems.push(
        `\`runtime-interface-only ${ref}\` is false: ${path} is ${ownKind}.\n` +
        '      This category asserts the symbol has NO metadata surface, and a symbol declared in one\n' +
        '      is the metadata surface. `objectstack migrate meta` reaches exactly these files, so the\n' +
        '      ledger is the channel here, not the compiler.\n' +
        '      fix: register the migration, or name the category that fits (`already-registered`).',
      );
      continue;
    }

    // (3) the declaration is not a projection of a Zod schema
    if (decl.kind === 'type' && ZOD_PROJECTION_RE.test(decl.rest)) {
      problems.push(
        `\`runtime-interface-only ${ref}\` is false: \`${symbol}\` is declared as a projection of a Zod\n` +
        `      schema --${decl.rest.trim().slice(0, 90)}\n` +
        '      Under Prime Directive #1 that is the house spelling of "this type IS metadata": the\n' +
        '      schema it projects is authorable, whatever the file is named.',
      );
      continue;
    }

    // (4) no metadata surface references it
    const hit = metadataSurfaceReference(symbol, path, surfaces(), packages);
    if (hit?.kind === 'import') {
      problems.push(
        `\`runtime-interface-only ${ref}\` is false: ${hit.hitPath} (${metadataSurfaceKind(hit.hitPath)})\n` +
        `      IMPORTS \`${symbol}\` from the module that declares it.\n` +
        '      A runtime interface pulled into a metadata surface HAS a metadata surface, wherever it\n' +
        '      was declared. That is what step 4 of the predicate exists to catch.',
      );
      continue;
    }
    if (hit?.kind === 'mention') {
      problems.push(
        `\`runtime-interface-only ${ref}\` cannot be verified: ${hit.hitPath} (${metadataSurfaceKind(hit.hitPath)})\n` +
        `      mentions \`${symbol}\` IN CODE while neither declaring nor importing it:\n` +
        `        ${hit.line.slice(0, 140)}\n` +
        '      Unresolvable, so refused rather than assumed unrelated (#4690). If it truly is a\n' +
        '      different symbol, the honest disposition is one that can be checked.\n' +
        '      Comment spans were already excluded before this scan, so the line above is not a\n' +
        '      docblock naming the type in prose -- that alone never refuses this category.',
      );
      continue;
    }

    verified.push({ ref, kind: decl.kind });
  }

  return { problems, verified };
}

/**
 * Step 4 of `runtime-interface-only`, as a reading: the first metadata surface that
 * REFERENCES `symbol` in code, or null.
 *
 * Shared, not copied: `runtime-export-retired` (#22918) asks the same question of
 * a retired export at the merge base, and two spellings of "is this a reference?"
 * would drift the way #12881 measured one of them drifting from the other.
 *
 * @param {string} symbol the bare name scanned for
 * @param {string} declPath the repo-relative file that DECLARES it -- the module an
 *   import must name to count, and the one file that is never its own reference
 * @param {Map<string, string>} surfaceTexts path -> text of every metadata surface
 * @param {() => Map<string, {private: boolean, file: string}>} packages workspace
 *   manifests, read only when an import has to be attributed to a package
 * @returns {{ kind: 'import', hitPath: string } | { kind: 'mention', hitPath: string, line: string } | null}
 */
export function metadataSurfaceReference(symbol, declPath, surfaceTexts, packages) {
  const word = new RegExp(`\\b${symbol}\\b`);
  for (const [hitPath, rawText] of surfaceTexts) {
    if (hitPath === declPath || !word.test(rawText)) continue;
    // PROSE IS NOT A REFERENCE. The raw hit above is the cheap filter; the
    // question this step actually asks is about CODE, so every decision below
    // reads the file with its comment spans blanked. `maskComments` (never
    // `stripComments`) because this branch REPORTS a line back to the author, and
    // blanking is the projection that keeps line numbers and offsets aligned with
    // the file on disk. A docblock that NAMES a runtime type is documentation --
    // it puts nothing in a schema and gives `objectstack migrate meta` nothing to
    // reach. Strings are deliberately left standing: see the header.
    const hitText = maskComments(rawText);
    if (!word.test(hitText)) continue;
    // A file that declares the name itself is a HOMONYM, not a reference -- the
    // measured `PackagePublishResult` pair in the header is exactly this case.
    if (declaresLocally(hitText, symbol)) continue;
    // So is a same-named MEMBER declaration (#25293) -- but only its own name is
    // cleared, never the file: a member signature beside a live code mention still
    // refuses on the mention.
    let codeText = hitText;
    for (const at of memberDeclarationOffsets(hitText, symbol)) {
      codeText = codeText.slice(0, at) + ' '.repeat(symbol.length) + codeText.slice(at + symbol.length);
    }
    if (!word.test(codeText)) continue;
    const specifiers = importSpecifiersFor(codeText, symbol);
    if (specifiers.length > 0) {
      const pkgs = packages();
      if (!specifiers.some((s) => specifierNamesModule(s, hitPath, declPath, pkgs))) continue; // imported from elsewhere
      return { kind: 'import', hitPath };
    }
    return { kind: 'mention', hitPath, line: (codeText.split(/\r?\n/).find((l) => word.test(l)) ?? '').trim() };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The sixth category: `type-surface-only` (#13080)
//
// ## The dead end this closes, measured before it was built
//
// A PUBLISHED TYPE-SURFACE NARROWING -- a published SDK method whose declared
// return moves off `any` onto the contract it always answered -- declares
// `**BREAKING**` truthfully: `any` is assignable to everything and admits every
// property read, so a consumer's code can stop compiling. It then finds every
// disposition above closed to it. Measured on the real #12104 shape, driven
// through the shipping `scan()`:
//
//   registered              refused -- no id is new in the diff, and writing one
//                                      would put a prescription in the ledger that
//                                      `objectstack migrate meta`, `spec-changes.json`
//                                      and the upgrade guide cannot project. False
//                                      data in the one ledger this gate keeps true.
//   unpublished             refused -- `@objectstack/client` publishes to npm.
//   already-registered      the gate ADMITS it, and that is the whole problem: it
//                                      verifies that the id RESOLVES and PRE-DATES the
//                                      base, never that the entry COVERS this change.
//                                      The only thing closing it is the author's
//                                      honesty, which is not a mechanism.
//   no-migration-prescription
//                           refused -- the body carries a FROM/TO block. "A changeset
//                                      that ships instructions for rewriting a
//                                      consumer's code cannot also claim that no
//                                      consumer has to rewrite anything."
//   runtime-interface-only  refused -- it inherits that same refusal (#8299).
//
// So the exit the gate names in its own refusal text -- "use a category that can
// be verified (`unpublished`, `already-registered`)" -- is factually false here,
// and the move that remains is to DROP the `**BREAKING**` token. Four changesets
// took it (#8140, #11925, #12034, #12104). That is the erosion #13080 was filed
// about: a whole recurring class of genuinely compile-breaking change nudged away
// from this repo's breaking-change marker, purely because the marker routes it
// into a ledger it does not belong in -- and the erosion is invisible, because
// every gate stays green.
//
// ## What the class is, and why the ledger is the wrong channel
//
// The affected party is a TYPESCRIPT CONSUMER and the delivery channel is the
// COMPILER at their own call site. The ADR-0087 ledger serves METADATA UPGRADERS;
// `objectstack migrate meta` rewrites stored metadata and has nothing to reach
// when the only thing that moved is a type annotation. `no-migration-prescription`
// is not wrong in general -- #6048 is exactly the shape it was built to catch --
// it simply cannot tell "a prescription for a METADATA upgrader" from "a
// prescription for a SOURCE-CODE consumer", and only the first is the ledger's
// business.
//
// ## Why this is a NARROWING and not a hole -- predicate 4 carries all of it
//
// This category is the only one that is EXEMPT from the `no-migration-prescription`
// refusal, so it is the only place in this file where something the detector
// refuses today becomes claimable. That exemption is not free: it is bought
// entirely by predicate 4, and the maintainer's ruling (2026-08-30) says so in as
// many words -- 豁免的安全性由谓词④承载,保持豁免是收窄而非洞.
//
// The ruling's own worked measurement is why predicate 4 exists at all. Predicates
// 1-3 alone were measured against the case this gate was FOUNDED on, and they do
// not separate it: on reconstructed diffs the #12104 shipping half and the #6048
// shape come out IDENTICAL on all three -- published, no `packages/spec` movement,
// no metadata surface -- so both would be admitted. And `no-migration-prescription`
// is the ONLY guard currently holding #6048 out. Exempting a category from it
// while checking only 1-3 hands #6048 a green exit: a measured regression of the
// founding case, not a hypothetical.
//
// Predicate 4 refuses it on a POSITIVE, RE-RUNNABLE READING rather than on a
// detector miss -- the same method #8299 used. #6048's symbol
// (`packages/runtime/src/security/actor-user.ts#ActorUser`) is a concretely typed
// exported interface at the merge base that LOST a runtime member; the narrowing
// class this category serves starts from `any` / `unknown` / no annotation at all.
// Base-side type is the reading that separates them, and it is a reading, not an
// inference. `verifyRuntimeInterfaceOnly` accepts #6048's symbol without a
// complaint, so nothing else in this file was going to.
//
// ⛔ NEVER weaken predicate 4 to make something else pass. It is not one check of
// four; it is the reason the other three are allowed to skip the prescription
// refusal at all.
//
// ## What is deliberately NOT checked here
//
// **Whether the HEAD type is the RIGHT type.** Whether `AnalyticsResult` is what
// the route actually answers is a question about a producer, settled by driving
// it -- which is what the changesets in this class do, and what no diff reader
// could. This gate asks only whether the surface moved OFF an erased type.
//
// **Whether the awaited type resolves to `any` through a chain.** This is a
// SOURCE-TEXT reading. Its neighbour `check:exported-any-returns` judges the same
// question against the BUILT dist, precisely because the erasure is invisible in
// source when a method carries no annotation (`packages/client/exported-any-returns.json`
// carries that argument). The two are complementary and the division is
// deliberate: this predicate reads what the author WROTE at two revs, which is
// what "was it narrowed in this diff" means; the dist-judged census owns "does it
// still resolve to `any`".
//
// **The completeness of the claim.** Like `registered` and `runtime-interface-only`,
// this judges the claim that was MADE. Inferring the whole touched surface is the
// cross-package retirement detector the 2026-08-07 ruling routes around.
//
// **A member that was unannotated at base but INFERRED a concrete type.** Adding
// an annotation that drops a member from such a method is a real break predicate 4
// admits. Stated rather than hidden: predicate 4's subject is the ledger's
// audience, not every possible break, and 1-3 still hold for it -- the compiler is
// still the channel, the ledger still has nothing to rewrite. What predicate 4 is
// specified to refuse is the #6048 shape: a symbol with a CONCRETE NAMED TYPE at
// base. That case reads as concrete and is refused.
// ---------------------------------------------------------------------------

/** `packages/spec/**` -- predicate 2's subject, as a path prefix. */
const SPEC_PACKAGE_DIR = 'packages/spec/';

/**
 * The four predicates, BY NAME.
 *
 * Named rather than counted on purpose. A self-test asserting "4 predicates were
 * checked" goes green the moment one is silently swapped for another, and this
 * tree has catalogued instruments with exactly that defect. Every predicate this
 * category is admitted on appears here, and the self-test pins the SET.
 */
export const TYPE_SURFACE_PREDICATES = [
  'published',
  'no-spec-diff',
  'no-metadata-surface-diff',
  'narrowed-from-erased',
];

/** Every path this diff touches, for predicates 2 and 3. */
export function changedPathsBetween(from, head, cwd) {
  let out;
  try { out = git(['diff', '--name-only', from, head], cwd); } catch { return null; }
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * `Promise< X >` unwrapped to `X`, but ONLY when the wrapper spans the WHOLE type.
 *
 * The whole-string condition is the safe direction and it is not decoration: a
 * greedy `^Promise<(.*)>$` reads `Promise< any > | undefined` as `any> | undefined`
 * and a lazy one reads `Promise< A > | Promise< B >` as `A`. Both are wrong, and
 * one of them is wrong in the ADMITTING direction. A bracket walk that must land
 * exactly on the last character cannot make either mistake.
 */
export function unwrapPromise(text) {
  const m = /^(?:Promise|PromiseLike)\s*</.exec(text);
  if (!m) return null;
  let depth = 0;
  for (let i = m[0].length - 1; i < text.length; i++) {
    if (text[i] === '<') depth++;
    else if (text[i] === '>') {
      depth--;
      if (depth === 0) return i === text.length - 1 ? text.slice(m[0].length, i).trim() : null;
    }
  }
  return null;
}

/**
 * Is this declared type ERASED -- i.e. `any` or `unknown`, awaited?
 *
 * The line is "the type IS `any`", never "the type CONTAINS `any`". That is the
 * same line `packages/client/exported-any-returns.json` and `packages/spec`'s
 * `check:exported-any` draw, and its header states why: admitting the broader
 * question costs those gates their zero-false-positive property. Here the cost
 * would land in the ADMITTING direction as well -- `{ rows: any[] }` at base is a
 * concrete object type, and a change that alters its members is not this
 * category's class.
 */
export function isErasedType(text) {
  if (text === null || text === undefined) return true; // no annotation at all
  let s = String(text).trim().replace(/[;,]$/, '').trim();
  for (;;) {
    const inner = unwrapPromise(s);
    if (inner === null) break;
    s = inner;
  }
  return /^(?:any|unknown)$/.test(s);
}

/**
 * The type text of a `<symbol>(...)` RETURN ANNOTATION, or a stated absence.
 *
 * `exportedTypeDeclaration` reads `export interface|type|class|enum <Symbol>` and
 * nothing else, and MEASURED AGAINST THE POPULATION THIS CATEGORY SERVES that is
 * not enough: three of the four live instances narrow a METHOD RETURN, not an
 * exported type. `b15d260d1` (the #12104 shipping half) is
 * `queryDataset: async (payload) => {` becoming
 * `queryDataset: async (payload): Promise< AnalyticsResult > => {`, and there is no
 * exported type declaration anywhere in that diff. A category that could not read
 * that shape would be born unable to serve its own population -- the #13080 defect
 * one layer down.
 *
 * ⚠️ This is a SIBLING of `exportedTypeDeclaration`, not a diff reader: it reads
 * ONE named symbol in ONE file at ONE rev. The 2026-08-30 ruling forbids giving
 * this gate a TS-aware DIFF reader (predicate A, which would classify every edit
 * in the diff as a type position or not); it does not forbid reading a declaration.
 * Nothing here looks at a diff.
 *
 * The parameter list is walked with brackets balanced over comment- and
 * string-masked text, because a `)` inside a default value is otherwise the end of
 * the list. The return type then runs to the arrow, the body brace or a `;`.
 *
 * @returns {{ annotation: string|null }|null} `null` when no such member is found;
 *   `annotation: null` when it is found and carries NO return annotation.
 */
export function memberReturnAnnotation(text, symbol) {
  const masked = maskCommentsAndLiterals(text);
  const found = memberDefinitionsIn(text, masked, symbol, 0, masked.length);
  return found.length === 0 ? null : { annotation: found[0].annotation };
}

/**
 * Every DEFINITION of `symbol` whose name starts inside `[from, to)`, in file order.
 *
 * The shared core of `memberReturnAnnotation` (whole file, first hit wins — the
 * behaviour bare references have always had) and of the dotted-path reader below,
 * which narrows this ANY-DEPTH result to the region's TOP DEPTH
 * (`definitionsAtTopDepth`) and refuses unless exactly one candidate is left.
 *
 * The declaration shapes it reads, and nothing else:
 *
 * ```text
 *   name(...)              method shorthand / function-ish
 *   name: (...)            an arrow property
 *   name = (...)           a class field holding an arrow
 *   name: async (...)      the `async` spelling of either
 *   name: <T>(...)         a generic type-parameter list ahead of the params
 * ```
 *
 * followed, after the balanced parameter list, by a return annotation (`: T`), an
 * arrow (`=>`) or a body brace (`{`). A `(...)` with none of those after it is a
 * CALL, not a declaration, and the scan moves on — otherwise every consumer of a
 * method would read as a definition of it.
 *
 * @returns {{ index: number, annotation: string|null }[]} `annotation: null` when
 *   the definition is there and carries NO return annotation.
 */
function memberDefinitionsIn(text, masked, symbol, from, to) {
  const out = [];
  // `[^\w$.]` excludes a leading dot, so `client.analytics.query(` -- a CALL --
  // is never mistaken for a declaration of `query`. Group 1 exists so the
  // identifier's own offset is computable: the prefix is `^` (zero-width) on the
  // first byte of the file and one character everywhere else, and a region test
  // that guessed which of the two it got would be off by one at exactly one
  // position in the file.
  const head = new RegExp(`(?:^|[^\\w$.])(${symbol}\\s*(?:[:=]\\s*)?(?:async\\s+)?(?:<[^<>]*>\\s*)?\\()`, 'g');
  for (const m of masked.matchAll(head)) {
    const identStart = m.index + m[0].length - m[1].length;
    if (identStart < from || identStart >= to) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < masked.length; i++) {
      const c = masked[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) continue;
    const tail = masked.slice(close + 1);
    const colon = /^\s*:/.exec(tail);
    if (!colon) {
      // No annotation. It is a DEFINITION only if a body or an arrow follows;
      // otherwise this was a call expression and the next candidate is scanned.
      if (/^\s*(?:=>|\{)/.test(tail)) out.push({ index: identStart, annotation: null });
      continue;
    }
    // Walk the type text to the arrow / body / terminator, at bracket depth 0.
    let d = 0;
    let acc = '';
    for (let i = colon[0].length; i < tail.length; i++) {
      const c = tail[i];
      if (d === 0 && c === '=' && tail[i + 1] === '>') break;
      if (d === 0 && (c === ';' || c === ',')) break;
      if (c === '{' && d === 0 && acc.trim() !== '' && !/[|&<=:]$/.test(acc.trim())) break; // the body brace
      if (c === '(' || c === '[' || c === '{' || c === '<') d++;
      else if (c === ')' || c === ']' || c === '}') d--;
      else if (c === '>' && d > 0) d--;
      acc += c;
    }
    const annotation = acc.trim();
    // Slicing the RAW text at the same offsets returns the author's own bytes:
    // masking preserves offsets, and a masked string literal inside a type
    // (`'a' | 'b'`) would otherwise be reported back as blanks.
    const rawStart = close + 1 + colon[0].length;
    const raw = text.slice(rawStart, rawStart + acc.length).trim();
    out.push({ index: identStart, annotation: raw.length === annotation.length ? raw : annotation });
  }
  return out;
}

/**
 * Every `{ … }` an object-literal property named `name` opens inside `[from, to)`.
 *
 * The two spellings a namespace on this repo's SDK client actually uses:
 * `applications: {` (a property of an object literal) and `oauth = {` (a class
 * field holding one). A leading dot is excluded for the same reason as above --
 * `this.oauth = {` reached through a receiver is an assignment the walk does not
 * claim to read, and claiming it would be guessing.
 *
 * @returns {{ open: number, close: number, kind: 'object literal' }[]}
 */
function objectLiteralBodiesFor(structural, name, from, to) {
  const out = [];
  const key = new RegExp(`(?:^|[^\\w$.])(${name}\\s*[:=]\\s*\\{)`, 'g');
  for (const m of structural.matchAll(key)) {
    const identStart = m.index + m[0].length - m[1].length;
    if (identStart < from || identStart >= to) continue;
    const open = m.index + m[0].length - 1;
    const close = matchBracket(structural, open);
    if (close === -1) continue;
    out.push({ open, close, kind: 'object literal' });
  }
  return out;
}

/**
 * Every `{ … }` a CLASS DECLARATION named `name` opens inside `[from, to)`.
 *
 * The second container a member can sit in, and the one #15724's walker did not
 * read (#17279). A published narrowing on a class method was therefore nameable
 * only BARELY -- `<path>#findOne` -- which resolves to the FIRST same-named
 * definition in the file, so on a file declaring the name twice the member had no
 * addressable spelling at all: measured on `packages/objectql/src/engine.ts`,
 * where `ObjectQL.findOne` is read for a diff that narrowed
 * `ObjectRepository.findOne`. That is #15627's own defect, surviving its fix on
 * the container kind the fix did not cover.
 *
 * Declaration forms only -- `export`, `export default`, `declare` and `abstract`
 * prefixes, with or without `extends` / `implements` / type parameters. A CLASS
 * EXPRESSION (`const X = class { … }`) is deliberately NOT read here: its name is
 * the binding's, not the class's, and reading one would be guessing at which of
 * the two a path's segment meant. The body is located with `declarationBodyStart`
 * rather than by the first `{`, so `class C implements I<{ a: 1 }>` opens on the
 * body and not inside its type arguments.
 *
 * @returns {{ open: number, close: number, kind: 'class' }[]}
 */
function classBodiesFor(structural, name, from, to) {
  const out = [];
  const key = new RegExp(
    `(?:^|[^\\w$.])(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+(${name})\\b`,
    'g',
  );
  for (const m of structural.matchAll(key)) {
    const identStart = m.index + m[0].length - m[1].length;
    if (identStart < from || identStart >= to) continue;
    const open = declarationBodyStart(structural, identStart + m[1].length);
    if (open === -1) continue;
    const close = matchBracket(structural, open);
    if (close === -1) continue;
    out.push({ open, close, kind: 'class' });
  }
  return out;
}

/**
 * Every body a path segment named `name` can name inside `[from, to)`: an object
 * literal or a class (#17279), in file order.
 *
 * ⚠️ The union is what makes the count meaningful. A segment naming BOTH an object
 * literal and a class is AMBIGUOUS in exactly the way two object literals are, and
 * counting the two kinds separately would let one of each through as "one of each
 * kind" -- a silent pick, which is the "writable but wrong" reference the dotted
 * spelling exists to avoid.
 *
 * @returns {{ open: number, close: number, kind: string }[]}
 */
function containerBodiesFor(structural, name, from, to) {
  return [
    ...objectLiteralBodiesFor(structural, name, from, to),
    ...classBodiesFor(structural, name, from, to),
  ].sort((a, b) => a.open - b.open);
}

/** How a refusal names a set of container bodies: by kind when they agree. */
const BODY_PLURALS = Object.freeze({ 'object literal': 'object literals', class: 'classes' });
function describeBodies(bodies) {
  const kinds = new Set(bodies.map((b) => b.kind));
  if (kinds.size === 1) return BODY_PLURALS[[...kinds][0]];
  return 'object literals and class bodies';
}

/**
 * The subset of `defs` that sits at the TOP DEPTH of the region `[from, to)`.
 *
 * A dotted path's leading segments ARE the nesting the member sits in (the
 * `parseSymbolRef` grammar), so a definition that starts inside `[from, to)` but
 * inside a nested CONTAINER -- an object literal or a class (#17279) -- OPENED
 * within that region belongs to the deeper path, ⛔ never to this one. Without this filter a direct member whose name recurs
 * in a nested literal has NO addressable spelling at all: it is counted against
 * itself, refused as AMBIGUOUS, and told to "name a deeper path" -- an instruction
 * it cannot carry out, because it already sits at the depth the path names (#16571).
 *
 * ⚠️ This is a NARROWING of the candidate set, never a tie-break. The direct member
 * resolves because the nested one stopped being a candidate for this path, not
 * because ties are now broken by position -- so a region holding SEVERAL same-named
 * definitions at its own top depth is still refused, loudly, and a "take the first"
 * reading is never reachable from here.
 *
 * `structural` MUST be the comment- and literal-masked projection, for the reason
 * `matchBracket` gives. `IDENT` is passed as the container's NAME because every
 * named container counts: the spans of containers nested inside those are
 * contained in them, so their union is the union of the top-level ones and one
 * pass suffices.
 *
 * @returns {{ index: number, annotation: string|null }[]} in file order, a subset.
 */
function definitionsAtTopDepth(structural, defs, from, to) {
  const nested = containerBodiesFor(structural, IDENT, from, to);
  return defs.filter((d) => !nested.some((b) => d.index > b.open && d.index < b.close));
}

/**
 * The region of `text` a dotted path's LEADING segments narrow the search to.
 *
 * Walked STRUCTURALLY on the comment- and literal-masked projection (offsets
 * preserved), from the top of the file: `oauth` -> `applications` narrows to the
 * bytes between that literal's braces, and the member is then looked for THERE.
 * ⛔ Never a line number, and never "the first same-named definition in the file":
 * both are what #15627 measured as unusable on `packages/client/src/index.ts`.
 *
 * A segment names an object literal OR a class body (#17279). Both are containers
 * a published member actually sits in, and reading only the first left a narrowing
 * on a class method with no spelling at all -- #15627's defect, surviving its own
 * fix on the container kind that fix did not cover.
 *
 * A segment that opens zero or more than one container in the region is REPORTED,
 * never guessed at -- `packages` opens three object literals in that file, and
 * picking one of them would be the "writable but wrong" reference this widening
 * exists to avoid.
 *
 * This returns the REGION only. Which definitions inside it the LAST segment may
 * name is `definitionsAtTopDepth`'s rule: the region's own depth, never deeper.
 *
 * @returns {{ ok: true, from: number, to: number }|{ ok: false, reason: string }}
 */
export function resolveMemberPath(text, segments) {
  const structural = maskCommentsAndLiterals(text);
  let from = 0;
  let to = structural.length;
  const walked = [];
  for (const seg of segments.slice(0, -1)) {
    const where = walked.length === 0 ? 'at the top of the file' : `inside \`${walked.join('.')}\``;
    const bodies = containerBodiesFor(structural, seg, from, to);
    if (bodies.length === 0) {
      return {
        ok: false,
        reason: `no \`${seg}\` object literal or class (\`${seg}: {\`, \`${seg} = {\` or ` +
          `\`class ${seg} {\`) is declared ${where}`,
      };
    }
    if (bodies.length > 1) {
      return {
        ok: false,
        reason: `\`${seg}\` opens ${bodies.length} ${describeBodies(bodies)} ${where}, so the path is AMBIGUOUS`,
      };
    }
    from = bodies[0].open + 1;
    to = bodies[0].close;
    walked.push(seg);
  }
  return { ok: true, from, to };
}

/**
 * The declaration of an exported `interface` -- or a `type` alias whose RHS is ONE
 * object type literal -- split into what predicate 4's index-signature limb
 * compares: its heritage (type parameters, `extends` clause) and its top-level
 * members, each normalised. `null` for any other shape, which the limb refuses.
 *
 * @returns {{ kind: string, heritage: string, members: string[] }|null}
 */
export function structuralDeclarationParts(text, symbol) {
  const masked = maskComments(text);
  const exported = exportedTypeDeclaration(masked, symbol);
  if (!exported || (exported.kind !== 'interface' && exported.kind !== 'type')) return null;
  const structural = maskCommentsAndLiterals(text);
  let open;
  let heritageEnd;
  if (exported.kind === 'interface') {
    open = declarationBodyStart(structural, exported.restStart);
    heritageEnd = open;
  } else {
    const eq = aliasEqualsIndex(structural, exported.restStart);
    if (eq === -1) return null;
    open = eq + 1;
    while (open < structural.length && /\s/.test(structural[open])) open++;
    if (structural[open] !== '{') return null;
    heritageEnd = eq;
    // ONE object type literal and nothing else: `{ ... } & X` is not this shape.
    const close = matchBracket(structural, open);
    if (close === -1 || structural.slice(close + 1, aliasRhsEnd(structural, eq)).trim() !== '') return null;
  }
  if (open === -1) return null;
  const close = matchBracket(structural, open);
  if (close === -1) return null;
  return {
    kind: exported.kind,
    heritage: normaliseSurface(masked.slice(exported.restStart, heritageEnd)),
    members: splitTopLevelMembers(masked.slice(open + 1, close), structural.slice(open + 1, close)),
  };
}

/**
 * The top-level members of a brace body's INSIDE, normalised, separators dropped.
 * Depth is walked on the literal-masked projection, and the `>` of an `=>` is not
 * a closer -- counting it would end a nested literal early and hand a nested index
 * signature to the caller as a top-level one.
 */
function splitTopLevelMembers(inside, structural) {
  const members = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < structural.length; i++) {
    const c = structural[i];
    if (c === '{' || c === '[' || c === '(' || c === '<') depth++;
    else if (c === '}' || c === ']' || c === ')' || (c === '>' && structural[i - 1] !== '=')) { if (depth > 0) depth--; }
    else if (depth === 0 && (c === ';' || c === ',')) {
      const m = normaliseSurface(inside.slice(from, i));
      if (m !== '') members.push(m);
      from = i + 1;
    }
  }
  const last = normaliseSurface(inside.slice(from));
  if (last !== '') members.push(last);
  return members;
}

// `[key: K]: V`, optionally `readonly`: the key part and the value type. A mapped
// type (`[P in K]`) and a computed member name (`[Symbol.iterator]()`) do not match.
const INDEX_SIGNATURE_RE = /^((?:readonly\s+)?\[\s*[A-Za-z_$][\w$]*\s*:\s*[^\]]+\])\s*:\s*([\s\S]+)$/;

/** A normalised member as an index signature `{ key, value }`, or null. */
export function readIndexSignature(member) {
  const m = INDEX_SIGNATURE_RE.exec(member);
  return m ? { key: normaliseSurface(m[1]), value: normaliseSurface(m[2]) } : null;
}

/**
 * Predicate 4's index-signature limb (ADR-0087 D8, amended 2026-10-27, #26220).
 *
 * For a bare reference to an exported `interface`, or a `type` alias whose RHS is
 * one object type literal, the limb holds when ALL of:
 *   1. at the merge base at least one index signature's value type is `any`;
 *   2. at HEAD at least one of THOSE carries another value type (`unknown`
 *      counts as narrowed here, and only here);
 *   3. everything else is identical: the kind, the heritage, and every member,
 *      position by position. Only the value types of base-`any` index signatures
 *      are set aside -- a non-`any` index signature that changes is a re-typed
 *      member like any other, so this reads no wider than the ADR's text.
 * #6048 (a member removed beside a concrete surface) fails 3 and keeps its
 * founding-case refusal. ⛔ Never widen a condition here without the ADR first.
 *
 * @returns {{ ok: true, from: string, to: string } | { ok: false, reason: string }}
 */
export function indexSignatureLimb(baseText, headText, symbol) {
  const before = structuralDeclarationParts(baseText, symbol);
  const after = structuralDeclarationParts(headText, symbol);
  if (!before || !after) {
    return { ok: false, reason: 'it reads only an exported `interface`, or a `type` alias whose right-hand side is one object type literal, at both revs' };
  }
  if (before.kind !== after.kind || before.heritage !== after.heritage) {
    return { ok: false, reason: `the declaration's heritage moved (\`${before.kind}${before.heritage ? ` ${before.heritage}` : ''}\` -> \`${after.kind}${after.heritage ? ` ${after.heritage}` : ''}\`)` };
  }
  if (before.members.length !== after.members.length) {
    return { ok: false, reason: `the member count moved (${before.members.length} -> ${after.members.length}): a member was added or removed` };
  }
  const narrowed = [];
  let anyAtBase = 0;
  for (let i = 0; i < before.members.length; i++) {
    const b = before.members[i];
    const a = after.members[i];
    const bi = readIndexSignature(b);
    if (bi && bi.value === 'any') {
      anyAtBase++;
      const ai = readIndexSignature(a);
      if (ai && ai.key === bi.key) {
        if (ai.value !== 'any') narrowed.push({ from: b, to: a });
        continue;
      }
    }
    if (a !== b) return { ok: false, reason: `member ${i + 1} moved (\`${b}\` -> \`${a}\`)` };
  }
  if (anyAtBase === 0) return { ok: false, reason: 'no index signature is typed `any` at the merge base' };
  if (narrowed.length === 0) return { ok: false, reason: 'every index signature typed `any` at the merge base is still `any` at HEAD' };
  return {
    ok: true,
    from: narrowed.map((n) => n.from).join('; '),
    to: narrowed.map((n) => n.to).join('; '),
  };
}

/**
 * What predicate 4 can read about ONE parsed reference, or why it is refused.
 *
 * A bare reference is `readDeclaredTypeSurface` verbatim -- unchanged behaviour,
 * including its "first same-named definition" reading, which is what every marker
 * written before #15627 means. A DOTTED reference is resolved through the nesting
 * and read only inside it, at that nesting's OWN depth: `organizations.create` is
 * the direct member and `organizations.teams.create` the nested one, and neither
 * spelling can reach the other (#16571). A dotted path's LAST segment is always a
 * MEMBER, never an exported `interface` / `type` / `class` / `enum`, so only the
 * member branch applies to it; its LEADING segments name the containers it sits
 * in, and a class is one of them (#17279) -- `ObjectRepository.findOne` names the
 * method on that class, and `ObjectRepository` itself stays unreachable by this
 * grammar.
 *
 * ⚠️ Every refusal below states something the author can ACT on. "Name a deeper
 * path" is printed only where a deeper path exists to name; where the collision is
 * at the path's own depth the message says THAT instead. A gate whose diagnosis is
 * right but whose remedy cannot be carried out is the failure #16571 recorded.
 *
 * @returns {{ surface: {shape: string, type: string|null, erased: boolean}|null,
 *             refusal: string|null }} at most one of the two is non-null.
 */
export function readTypeSurfaceRef(text, parsed) {
  if (!parsed.dotted) return { surface: readDeclaredTypeSurface(text, parsed.symbol), refusal: null };
  const spelling = parsed.segments.join('.');
  const parent = parsed.segments.slice(0, -1).join('.');
  const region = resolveMemberPath(text, parsed.segments);
  if (!region.ok) return { surface: null, refusal: `\`${spelling}\` does not resolve: ${region.reason}.`, };
  const masked = maskCommentsAndLiterals(text);
  const defs = memberDefinitionsIn(text, masked, parsed.symbol, region.from, region.to);
  if (defs.length === 0) {
    return {
      surface: null,
      refusal: `\`${spelling}\` does not resolve: \`${parent}\` is declared, but no \`${parsed.symbol}\` ` +
        'definition sits inside it.',
    };
  }
  // The path names the member at `parent`'s OWN depth, so only definitions there
  // are candidates for it (#16571). Everything deeper belongs to a deeper path.
  const here = definitionsAtTopDepth(masked, defs, region.from, region.to);
  if (here.length > 1) {
    // ⛔ Not "name a deeper path": these sit at the depth the path already names,
    // so no deeper path exists to write. A gate whose remedy cannot be carried out
    // is the defect #16571 was filed on -- the refusal stays loud, the fix text
    // says what is actually wrong.
    return {
      surface: null,
      refusal: `\`${spelling}\` is AMBIGUOUS: ${here.length} \`${parsed.symbol}\` definitions sit at the TOP ` +
        `DEPTH of \`${parent}\`, so no deeper path distinguishes them.`,
    };
  }
  if (here.length === 0) {
    return {
      surface: null,
      refusal: defs.length > 1
        ? `\`${spelling}\` is AMBIGUOUS: ${defs.length} \`${parsed.symbol}\` definitions sit inside ` +
          `\`${parent}\`, every one of them inside a nested container. Name a deeper path that ` +
          'resolves to exactly one.'
        : `\`${spelling}\` does not resolve: the one \`${parsed.symbol}\` definition inside \`${parent}\` ` +
          'sits inside a nested container, not at the depth this path names. Name the deeper path.',
    };
  }
  const { annotation } = here[0];
  return {
    surface: annotation === null
      ? { shape: `\`${spelling}\`, which carries NO return annotation`, type: null, erased: true }
      : { shape: `the return annotation of \`${spelling}\``, type: annotation, erased: isErasedType(annotation) },
    refusal: null,
  };
}

/** A declared surface as a message prints it: one line, comment spans collapsed. */
const normaliseSurface = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * The index of the bracket matching the one at `open`, or -1.
 *
 * ⚠️ `structural` MUST be the comment- AND literal-masked projection. A `}` inside
 * a string literal is not a closer, and reading one as such is exactly how the
 * lazy `([\s\S]*?);` this file used to carry truncated `type Sep = ';' | ',';`
 * down to a single quote character (#15489).
 */
function matchBracket(structural, open) {
  const CLOSES = { '{': '}', '[': ']', '(': ')', '<': '>' };
  const opener = structural[open];
  const closer = CLOSES[opener];
  if (!closer) return -1;
  let depth = 0;
  for (let i = open; i < structural.length; i++) {
    if (structural[i] === opener) depth++;
    else if (structural[i] === closer && --depth === 0) return i;
  }
  return -1;
}

/**
 * Where the BODY of an `interface` / `class` / `enum` opens at/after `from`, or -1.
 *
 * The first `{` is not the answer on its own: `class C implements I<{ a: 1 }>` opens
 * one inside the type arguments. Only a `{` reached at angle/paren/bracket depth
 * zero is the body, and a `;` at that depth ends a bodiless declaration first.
 */
function declarationBodyStart(structural, from) {
  let angle = 0;
  let paren = 0;
  let square = 0;
  for (let i = from; i < structural.length; i++) {
    const c = structural[i];
    if (c === '<') angle++;
    else if (c === '>') { if (angle > 0) angle--; }
    else if (c === '(') paren++;
    else if (c === ')') { if (paren > 0) paren--; }
    else if (c === '[') square++;
    else if (c === ']') { if (square > 0) square--; }
    else if (angle === 0 && paren === 0 && square === 0) {
      if (c === '{') return i;
      if (c === ';') return -1;
    }
  }
  return -1;
}

/**
 * The declared MEMBER surface of a brace-bodied declaration at/after `from`, or null.
 *
 * Structure is walked on `structural`; the answer is SLICED out of `masked`, so a
 * string literal's own text survives into the surface while its brackets never
 * steer the walk. The braces are kept: the result is a type text a reader can read.
 */
function declaredMemberSurface(masked, structural, from) {
  const open = declarationBodyStart(structural, from);
  if (open === -1) return null;
  const close = matchBracket(structural, open);
  if (close === -1) return null;
  return normaliseSurface(masked.slice(open, close + 1));
}

/**
 * The index of the `=` that opens a `type` alias's RHS at/after `from`, or -1.
 *
 * The type-parameter list is skipped by BRACKET MATCHING rather than by a regex:
 * `type Box<T = string> = ...` carries an `=` inside its own parameter list, and
 * the `(?:<[^=]*>)?` spelling this replaced could not see past it.
 */
function aliasEqualsIndex(structural, from) {
  let i = from;
  while (i < structural.length && /\s/.test(structural[i])) i++;
  if (structural[i] === '<') {
    const close = matchBracket(structural, i);
    if (close === -1) return -1;
    i = close + 1;
    while (i < structural.length && /\s/.test(structural[i])) i++;
  }
  return structural[i] === '=' ? i : -1;
}

// A RHS line that ends on one of these is mid-expression, so the newline after it
// is never the end of the declaration.
const RHS_CONTINUES_RE = /(?:[|&,=:?<([{]|\b(?:extends|keyof|typeof|infer|in|readonly|new)|=>)[ \t]*$/;
// ...and what a following line has to look like for that newline to END the alias.
const NEXT_STATEMENT_RE =
  /^[ \t]*(?:export|import|declare|interface|type|class|enum|const|let|var|function|abstract|async|@)/;

/**
 * The END of the alias RHS that starts just after `eq`.
 *
 * The first `;` at nesting depth ZERO -- never merely the first `;`, which sits
 * inside the very first member of any multi-line object alias and truncated every
 * one of them (#15489). When the alias carries no `;` at all (ASI), the end of the
 * DECLARATION is used rather than the end of the file: a depth-0 newline whose next
 * non-blank line opens a new top-level statement.
 *
 * ⚠️ Angle brackets are deliberately NOT counted. `<` is a type-argument opener but
 * `>` is also the second half of `=>`, so counting them makes every function type in
 * a RHS close a depth nothing opened. Nothing is lost: a `;` cannot reach depth 0
 * inside type arguments without passing through a brace, bracket or paren first.
 */
function aliasRhsEnd(structural, eq) {
  let depth = 0;
  for (let i = eq + 1; i < structural.length; i++) {
    const c = structural[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') {
      if (depth === 0) return i; // ran out of the declaration into an enclosing block
      depth--;
    } else if (depth === 0 && c === ';') return i;
    else if (depth === 0 && c === '\n') {
      const soFar = structural.slice(eq + 1, i);
      if (soFar.trim() === '' || RHS_CONTINUES_RE.test(soFar)) continue;
      const next = structural.slice(i + 1).split('\n').find((line) => line.trim() !== '');
      if (next !== undefined && NEXT_STATEMENT_RE.test(next)) return i;
    }
  }
  return structural.length;
}

/**
 * How many top-level members a brace-delimited member surface declares.
 *
 * SEPARATOR-counted (`;` / `,` at depth 0), which is what a normalised surface has
 * left to count: it is a figure for a truncation notice, not a contract. `null` when
 * the surface is not a brace body at all.
 */
export function countSurfaceMembers(surface) {
  const s = normaliseSurface(String(surface ?? ''));
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  const structural = maskCommentsAndLiterals(s);
  let depth = 0;
  let members = 0;
  let pending = '';
  for (let i = 1; i < s.length - 1; i++) {
    const c = structural[i];
    if (c === '{' || c === '[' || c === '(' || c === '<') depth++;
    else if (c === '}' || c === ']' || c === ')' || c === '>') { if (depth > 0) depth--; }
    else if (depth === 0 && (c === ';' || c === ',')) {
      if (pending.trim() !== '') members++;
      pending = '';
      continue;
    }
    pending += s[i];
  }
  if (pending.trim() !== '') members++;
  return members;
}

/** How much of a declared surface a refusal message prints before it truncates. */
export const SURFACE_PRINT_LIMIT = 160;

/**
 * A declared surface, cut down to something a refusal can print on a few lines.
 *
 * A whole `interface` body is now the reading (it is the thing that narrowed), and
 * the real specimen is over 1,500 characters — long enough to bury the sentence
 * around it. Truncation is explicit rather than silent: an ellipsis, the member
 * count, and the full length, so an author can tell "long" from "all of it".
 */
export function printableSurface(surface) {
  if (surface === null || surface === undefined) return null;
  const s = String(surface);
  if (s.length <= SURFACE_PRINT_LIMIT) return s;
  const members = countSurfaceMembers(s);
  return `${s.slice(0, SURFACE_PRINT_LIMIT).trimEnd()} …` +
    ` (${members === null ? '' : `${members} members, `}${s.length} chars, truncated at ${SURFACE_PRINT_LIMIT})`;
}

/**
 * What this gate can read about `symbol`'s declared type at one rev, from SOURCE.
 *
 * Two shapes, in order: the exported type declaration `exportedTypeDeclaration`
 * already owns, then the member return annotation above. `null` means the symbol
 * is not readable here at all -- which predicate 4 treats as a REFUSAL on the base
 * side, never as "it must have been erased".
 *
 * `type` is the DECLARED SURFACE, never the symbol's own name (#15489): the name is
 * identical on both sides of every diff, so predicate 4's before/after reading of an
 * `interface` used to print `ExportFieldMeta` -> `ExportFieldMeta` across a commit
 * that removed eight of its members. What is compared, and what an author is shown,
 * has to be the thing that can move.
 *
 * @returns {{ shape: string, type: string|null, erased: boolean }|null}
 */
export function readDeclaredTypeSurface(text, symbol) {
  const masked = maskComments(text);
  const exported = exportedTypeDeclaration(masked, symbol);
  if (exported) {
    const structural = maskCommentsAndLiterals(text);
    if (exported.kind !== 'type') {
      // An `interface` / `class` / `enum` is a named STRUCTURAL declaration. It is
      // never `any` -- #6048's symbol is exactly this shape at base -- so `erased`
      // is false by construction here and no reading of the body can move it. The
      // body is what predicate 4 REPORTS, and what a member removal changes.
      return {
        shape: `an exported \`${exported.kind} ${symbol}\``,
        type: declaredMemberSurface(masked, structural, exported.restStart),
        erased: false,
      };
    }
    const eq = aliasEqualsIndex(structural, exported.restStart);
    const rhs = eq === -1 ? '' : normaliseSurface(masked.slice(eq + 1, aliasRhsEnd(structural, eq)));
    const rhsText = rhs === '' ? null : rhs;
    return {
      shape: `the exported \`type ${symbol}\` alias`,
      type: rhsText,
      erased: rhsText === null ? false : isErasedType(rhsText),
    };
  }
  const member = memberReturnAnnotation(text, symbol);
  if (member) {
    return member.annotation === null
      ? { shape: `\`${symbol}\`, which carries NO return annotation`, type: null, erased: true }
      : { shape: `the return annotation of \`${symbol}\``, type: member.annotation, erased: isErasedType(member.annotation) };
  }
  return null;
}

/**
 * Verify one `type-surface-only` claim: the four predicates, all four, by name.
 *
 * Every failure is reported (rather than the first one only) so an author sees the
 * whole answer in one run, and every message NAMES the predicate that refused --
 * which is what makes each red case in the self-test attributable to one predicate.
 *
 * @param {string[]} refs the `<path>#<Symbol>` tokens the marker named
 * @param {{ base: string, head: string, cwd: string, bumps: {pkg: string, bump: string}[],
 *           packages: () => Map<string, {private: boolean, file: string}>,
 *           changedPaths: () => string[]|null }} ctx
 * @returns {{ problems: string[], verified: {ref: string, from: string, to: string}[], checked: string[] }}
 */
export function verifyTypeSurfaceOnly(refs, { base, head, cwd, bumps, packages, changedPaths }) {
  const problems = [];
  const verified = [];
  const checked = [];
  const P = (name) => { checked.push(name); return name; };

  // ---- predicate 1: the package really PUBLISHES ---------------------------
  // The exact inverse of `unpublished`, on the same reading of the same
  // manifests. A private package's break reaches no consumer, so the compiler is
  // not the channel that makes this category honest -- `unpublished` is the
  // truthful disposition there, and it is already checked.
  P('published');
  if (bumps.length === 0) {
    problems.push(
      '`not-required (type-surface-only)` [predicate 1: published] is on a changeset that declares\n' +
      '      no package at all -- there is nothing to verify publishes.',
    );
  } else {
    const pkgs = packages();
    const unresolved = bumps.filter((b) => !pkgs.has(b.pkg)).map((b) => b.pkg);
    if (unresolved.length > 0) {
      problems.push(
        `\`not-required (type-surface-only)\` [predicate 1: published] names package(s) with no\n` +
        `      workspace manifest: ${unresolved.join(', ')}\n` +
        '      The claim cannot be verified, and an unverifiable exemption is refused rather than\n' +
        '      assumed true (#4690).',
      );
    } else {
      const priv = bumps.filter((b) => pkgs.get(b.pkg).private).map((b) => b.pkg);
      if (priv.length > 0) {
        problems.push(
          `\`not-required (type-surface-only)\` [predicate 1: published] is false: ${priv.join(', ')}\n` +
          `      ${priv.length === 1 ? 'is' : 'are'} PRIVATE (\`private: true\` in ${priv.map((p) => pkgs.get(p).file).join(', ')}).\n` +
          '      This category rests on the COMPILER being the channel that reaches consumers. A\n' +
          '      package that ships to nobody has no such consumers, and the honest disposition that\n' +
          '      says so is already checked:\n' +
          '        <!-- adr-0087: not-required (unpublished) why -->',
        );
      }
    }
  }

  // ---- predicates 2 and 3: nothing metadata-shaped moved in this diff -------
  const paths = changedPaths();
  if (paths === null || paths.length === 0) {
    P('no-spec-diff'); P('no-metadata-surface-diff');
    problems.push(
      '`not-required (type-surface-only)` [predicates 2-3] cannot be verified: this diff\'s file\n' +
      '      list could not be read, or is empty. Both predicates are statements ABOUT that list, so\n' +
      '      with no list they assert nothing (#4690).',
    );
  } else {
    P('no-spec-diff');
    const specHits = paths.filter((p) => p.startsWith(SPEC_PACKAGE_DIR));
    if (specHits.length > 0) {
      problems.push(
        `\`not-required (type-surface-only)\` [predicate 2: no-spec-diff] is false: this diff touches\n` +
        `      ${specHits.length} path(s) under \`${SPEC_PACKAGE_DIR}\`:\n` +
        specHits.slice(0, 5).map((p) => `        ${p}`).join('\n') +
        (specHits.length > 5 ? `\n        ... and ${specHits.length - 5} more` : '') +
        '\n      `packages/spec` IS the contract between metadata producers and the runtime, and both\n' +
        '      ADR-0087 registries live inside it. A diff that moves it is not a change the compiler\n' +
        '      alone carries, whatever else it also does.',
      );
    }
    P('no-metadata-surface-diff');
    const surfaceHits = paths.filter((p) => metadataSurfaceKind(p) !== null);
    if (surfaceHits.length > 0) {
      problems.push(
        `\`not-required (type-surface-only)\` [predicate 3: no-metadata-surface-diff] is false: this\n` +
        `      diff moves ${surfaceHits.length} ADR-0087 shape surface(s):\n` +
        surfaceHits.slice(0, 5).map((p) => `        ${p} (${metadataSurfaceKind(p)})`).join('\n') +
        (surfaceHits.length > 5 ? `\n        ... and ${surfaceHits.length - 5} more` : '') +
        '\n      A Zod schema, a spec `contracts/**` entry or an object definition is exactly what\n' +
        '      `objectstack migrate meta` reaches. When one of them moved, the ledger is a channel\n' +
        '      that CAN carry this change, so "the compiler is the only channel" is false.',
      );
    }
  }

  // ---- predicate 4: the named symbol was ERASED at base, CONCRETE at HEAD ---
  //
  // The one that buys the prescription exemption. Read the header above before
  // touching anything below it.
  P('narrowed-from-erased');
  const HOW = (badRef) =>
    '      fix: name the narrowed symbol as `<repo-relative-path>#<Symbol>`, e.g.\n' +
    '        <!-- adr-0087: not-required (type-surface-only ' +
    'packages/client/src/index.ts#queryDataset) why -->\n' +
    '      ...or, when the name is not unique in the file, as a DOTTED MEMBER PATH through the\n' +
    '      nesting the member sits in -- an object literal (#15627) or a class (#17279):\n' +
    '        <!-- adr-0087: not-required (type-surface-only ' +
    'packages/client/src/index.ts#oauth.applications.get) why -->\n' +
    '        <!-- adr-0087: not-required (type-surface-only ' +
    'packages/objectql/src/engine.ts#ObjectRepository.findOne) why -->\n' +
    `      The symbol is what predicate 4 reads at BOTH revs${badRef ? ` (got: ${badRef})` : ''}.`;

  if (refs.length === 0) {
    problems.push(
      '`not-required (type-surface-only)` [predicate 4: narrowed-from-erased] names no symbol.\n' +
      '      The whole content of this exemption is WHICH surface moved off `any`, and predicate 4 is\n' +
      '      what makes the category a narrowing rather than a hole. An unnamed symbol asserts\n' +
      '      nothing checkable (#4690).\n' +
      HOW(null),
    );
    return { problems, verified, checked };
  }

  for (const ref of refs) {
    const parsedRef = parseSymbolRef(ref);
    if (!parsedRef) {
      problems.push(
        `\`type-surface-only\` names "${ref}", which is not a \`<path>#<Symbol>\` reference.\n${HOW(ref)}`,
      );
      continue;
    }
    const { path } = parsedRef;
    // The spelling the author wrote, which is what every message below has to name:
    // `symbol` alone is the LAST segment, and reporting a verdict about `get` when
    // the marker said `oauth.applications.get` is the reading #15627 was filed on.
    const symbol = parsedRef.segments.join('.');

    const headText = showOrNull(head, path, cwd);
    if (headText === null) {
      problems.push(
        `\`type-surface-only ${ref}\` [predicate 4] names a path that does not exist at HEAD: ${path}\n` +
        '      An exemption whose subject cannot be found is refused, never assumed true (#4690).',
      );
      continue;
    }
    const baseText = showOrNull(base, path, cwd);
    if (baseText === null) {
      problems.push(
        `\`type-surface-only ${ref}\` [predicate 4] names a path that does not exist at the merge\n` +
        `      base: ${path}\n` +
        '      "Narrowed" is a claim about a surface that EXISTED before this diff. A path this diff\n' +
        '      creates narrowed nothing, so there is no base-side reading to make, and predicate 4 is\n' +
        '      the only thing holding the prescription exemption open. Refused rather than assumed.',
      );
      continue;
    }

    const read = readTypeSurfaceRef(headText, parsedRef);
    if (read.refusal) {
      problems.push(
        `\`type-surface-only ${ref}\` [predicate 4] cannot be resolved at HEAD in ${path}:\n` +
        `      ${read.refusal}\n` +
        '      A dotted member path is walked through the nesting it names -- an object literal or\n' +
        '      a class body (#17279) -- and a walk that lands on zero or on several candidates is\n' +
        '      REPORTED rather than guessed at -- a reference that resolves to the wrong same-named\n' +
        '      member reads as a true sentence about a member the diff never touched (#15627).\n' +
        HOW(null),
      );
      continue;
    }
    const at = read.surface;
    if (!at) {
      problems.push(
        `\`type-surface-only ${ref}\` [predicate 4]: ${path} declares no readable \`${symbol}\` at HEAD.\n` +
        '      Searched for an exported `interface` / `type` / `class` / `enum` of that name, then for\n' +
        `      a \`${symbol}(...)\` declaration carrying a return annotation.\n` +
        HOW(null),
      );
      continue;
    }
    if (at.erased) {
      problems.push(
        `\`type-surface-only ${ref}\` [predicate 4: narrowed-from-erased] is false at HEAD:\n` +
        `      ${at.shape} is still ${at.type === null ? 'UNANNOTATED' : `\`${printableSurface(at.type)}\``}.\n` +
        '      This category is for a surface that MOVED OFF an erased type. One that is still erased\n' +
        '      narrowed nothing, so nothing about it can be breaking in the way this category\n' +
        '      describes.',
      );
      continue;
    }

    const readBase = readTypeSurfaceRef(baseText, parsedRef);
    if (readBase.refusal) {
      problems.push(
        `\`type-surface-only ${ref}\` [predicate 4] cannot be resolved at the merge base in\n` +
        `      ${path}: ${readBase.refusal}\n` +
        '      Predicate 4 is a comparison, and a base side that cannot be resolved is not evidence\n' +
        '      that the surface was erased -- it is no evidence at all. Refused rather than assumed\n' +
        '      true (#4690). If the nesting was renamed, name the path that existed at the base.',
      );
      continue;
    }
    const before = readBase.surface;
    if (!before) {
      problems.push(
        `\`type-surface-only ${ref}\` [predicate 4] cannot be read at the merge base: ${path} exists\n` +
        `      there, but declares no readable \`${symbol}\`.\n` +
        '      Predicate 4 is a comparison, and an absent base-side reading is not evidence that the\n' +
        '      surface was erased -- it is no evidence at all. Refused rather than assumed true\n' +
        '      (#4690). If the symbol was renamed, name the base-side surface that was actually\n' +
        '      narrowed, or use a disposition that can be checked.',
      );
      continue;
    }
    if (!before.erased) {
      // The 2026-10-27 amendment (#26220): an `any` INDEX SIGNATURE is the one member
      // that can be erased inside a concrete declaration. A bare reference only.
      const limb = parsedRef.dotted ? { ok: false, reason: 'it does not apply to a dotted member path' } : indexSignatureLimb(baseText, headText, parsedRef.symbol);
      if (limb.ok) {
        verified.push({ ref, from: limb.from, to: limb.to });
        continue;
      }
      problems.push(
        `\`type-surface-only ${ref}\` [predicate 4: narrowed-from-erased] is FALSE: at the merge base\n` +
        `      ${before.shape} was already CONCRETE (${before.type === null
          ? 'its declared surface is not readable here'
          : `\`${printableSurface(before.type)}\``}), not \`any\` / \`unknown\` /\n` +
        '      unannotated.\n' +
        '      ⛔ This is the founding case of this whole gate. PR #6048 removed the `roles` member of\n' +
        '      a concretely typed exported interface and the ledger got nothing; the ONLY thing\n' +
        '      holding that shape out is the `no-migration-prescription` refusal, and this category is\n' +
        '      exempt from it. Predicate 4 is what pays for that exemption: a surface that was already\n' +
        '      concrete did not move off `any`, and a member removed from it is exactly the class the\n' +
        '      ledger DOES serve.\n' +
        `      The index-signature limb (ADR-0087 D8, amended 2026-10-27) does not hold either: ${limb.reason}.\n` +
        '      fix: register the migration.',
      );
      continue;
    }

    verified.push({
      ref,
      from: before.type === null ? 'unannotated' : printableSurface(before.type),
      to: at.type === null ? at.shape : printableSurface(at.type),
    });
  }

  return { problems, verified, checked };
}

// ---------------------------------------------------------------------------
// The seventh category: `runtime-export-retired` (#22918)
//
// ## The class, and the dead end it closes
//
// A changeset that RETIRES PUBLISHED RUNTIME EXPORTS -- functions, constants,
// classes and types a published package's entry exported, and members of an
// exported type -- declares `**BREAKING**` truthfully and ships the FROM -> TO line
// a consumer needs for each retired name. The worked example is
// `.changeset/15205-email-templates-resolve-registry.md` (PR #22875, merged as
// `7de0265fc7`): nine exports and two `EmailServicePluginOptions` members of
// `@objectstack/plugin-email`, six arrowless `- FROM ... TO ...` lines. Every
// disposition was closed to it on the facts but one -- `no-migration-prescription`,
// which it held ONLY because the detector reads an arrow and those lines carry
// none. That is the detector-miss shape D7 retires, and its own marker asked for a
// ruling (#22915, ruling A; #22918, the ruling of 2026-10-12).
//
// The ledger is the wrong channel for the reason D7 and D8 give: the affected party
// is a TypeScript consumer, the compiler at their own call site delivers the break
// (`TS2305 ... has no exported member`), and `objectstack migrate meta` has no
// metadata to rewrite.
//
// ## The operands (the ruling's Q1: B, narrowed)
//
//   <package>#<Export>           a retired export of the package's published entry
//   <package>#<Type>.<member>    a retired member of an exported type -- the dotted
//                                spelling `type-surface-only` already uses
//   <package>#*                  a published package DELETED at HEAD, retired whole
//                                (D9, amended 2026-10-27: ruling A on PR #26365,
//                                comment 6439038287)
//
// A deleted package has no entry at HEAD to read an absence from, so the operand
// is the package itself and predicate 1 is proven about the package (see
// `verifyWholePackageRetired`); its FROM -> TO block names the package on one line.
//
// The PACKAGE is named, never a file: "reachable from the published entry" is a
// fact about the package, and a declaration can move between files without the
// export moving. ⛔ A member is addressed by that canonical spelling ONLY. Nothing
// here parses a constructor argument or an object literal: a FROM line written
// `new EmailServicePlugin({ seedTemplates: false })` names `EmailServicePlugin`, an
// operand outside any set that names the member, and is refused as out of range.
// The worked example's lines 29-30 are exactly that, which is why it stays on
// `no-migration-prescription` (merged, never re-graded) and why the member limb
// exists at all.
//
// ## The three predicates, BY NAME, re-verified on every run
//
//   1. retired-from-entry -- an export is reachable from the package's published
//      entry at the merge base and absent at HEAD; a member's type is reachable at
//      the base, the member is present on it there (`getPropertiesOfType`) and
//      absent at HEAD. Read by the TypeScript COMPILER over the package's source
//      entry at each rev (`getExportsOfModule`, so `export *` resolves). The entry
//      is located through the package's `exports` map -- `resolveTypesEntry`,
//      imported from the readme-exports gate, never re-implemented -- and tsup's
//      convention: its declaration entry `dist/index.d.ts` (or the `.d.mts` /
//      `.d.cts` twin tsup writes beside it) is generated from `src/index.ts` -- or,
//      since the 2026-10-27 amendment (#26220), from `src/index.tsx`, the entry
//      vite-plugin-dts builds the `ui/` packages from; exactly one of the two. A
//      published package whose entry cannot be mapped that way is REFUSED, loudly
//      and by name, never guessed.
//   2. no-metadata-surface -- at the merge base no operand is declared in a
//      `*.zod.ts`, under `packages/spec/src/contracts/` or in an object definition,
//      none is a Zod projection, and no metadata surface references it in code: the
//      `runtime-interface-only` primitives, read at the BASE because the operand is
//      gone at HEAD.
//   3. from-operands-named -- the FROM -> TO block names EXACTLY the named
//      operands, each spelled as in the marker (`Type.member` for a member), and the
//      body carries no other prescription the detector can read.
//
// ## The deviation the maintainer accepted
//
// A merge base has no build output (`dist/` is gitignored), so predicate 1 compiles
// the SOURCE entry that generates the published `.d.ts`, not the `.d.ts`. For the
// question "which names does the package export" the two agree.
//
// ## Predicate 3 is a NARROWING of `no-migration-prescription`, never an escape
//
// This category does not skip the prescription refusal the way `type-surface-only`
// does. It reads the FROM side of every rewrite line the body writes -- a
// `FROM ... TO ...` line, an arrow `X -> Y` (or `X -> delete`), the FROM column of a
// `| FROM | TO |` / `| Wrote | Write instead |` table -- requires each FROM operand
// to be a named operand and each named operand to have a FROM side, neutralises
// exactly those lines, and then runs the SAME `findMigrationPrescription` over
// what is left. Anything the detector still reads is refused: a rewrite table with
// no FROM column, a vertical FROM / TO pair, a FROM -> TO label above anything this
// reader did not read. So nothing the detector refuses today becomes claimable
// unless every operand it rests on was positively verified retired by predicates
// 1-2 -- and an arrowless block, invisible to the detector, is READ here rather
// than waved through.
//
// ## What is deliberately NOT checked
//
// **That the claim is complete.** Like `registered` and `runtime-interface-only`,
// this judges the operands the author named, not every export the diff removed:
// inferring that set is the cross-package retirement detector the 2026-08-07 ruling
// routes around.
//
// **A subpath entry (`@scope/pkg/sub`).** Only the root entry is read; a retirement
// from a subpath names no operand this category can verify, so it is refused at the
// mapping step rather than assumed.
//
// **A static member of a class.** A member operand reads the declared (instance)
// type of a class, interface or type alias, and the value type of anything else.
// ---------------------------------------------------------------------------

/**
 * The three predicates, BY NAME -- the same discipline as `TYPE_SURFACE_PREDICATES`:
 * the self-test pins the set and that the shipping function evaluates exactly it.
 */
export const RUNTIME_EXPORT_PREDICATES = [
  'retired-from-entry',
  'no-metadata-surface',
  'from-operands-named',
];

/** An npm package name, scoped or not. */
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** `Export` or `Type.member` -- one level deep, never more. */
const EXPORT_SPELLING_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/;

/**
 * `<package>#<Export>` / `<package>#<Type>.<member>` / `<package>#*` -> its parts,
 * or a refusal.
 *
 * `<package>#*` is a WHOLE package (D9, amended 2026-10-27): its `spelling` is the
 * package name, because that is what its one FROM line names.
 *
 * @param {string} ref
 * @returns {{ pkg: string, spelling: string, exportName: string|null, member: string|null, whole: boolean } | { refusal: string }}
 */
export function parseExportOperand(ref) {
  const at = ref.lastIndexOf('#');
  const pkg = at > 0 ? ref.slice(0, at) : '';
  const spelling = at > 0 ? ref.slice(at + 1) : '';
  if (at <= 0 || !PACKAGE_NAME_RE.test(pkg)) {
    return {
      refusal: /[\\/][^#]*\.[cm]?tsx?(?:#|$)/.test(ref)
        ? `names a FILE (${pkg || ref}). This category names the PACKAGE whose published entry exported the operand,\n` +
          '      because "reachable from the published entry" is a fact about the package, not about a file'
        : 'is not a `<package>#<Export>`, `<package>#<Type>.<member>` or `<package>#*` reference',
    };
  }
  if (spelling === '*') return { pkg, spelling: pkg, exportName: null, member: null, whole: true };
  if (!EXPORT_SPELLING_RE.test(spelling)) {
    return {
      refusal: /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){2,}$/.test(spelling)
        ? `spells a member ${spelling.split('.').length - 1} levels deep. A member is named \`<Type>.<member>\`: the\n` +
          '      exported type it sits on, then the member, and nothing in between'
        : `names \`${spelling}\`, which is not an export name or a canonical \`<Type>.<member>\` spelling`,
    };
  }
  const [exportName, member = null] = spelling.split('.');
  return { pkg, spelling, exportName, member, whole: false };
}

/**
 * The canonical spelling a FROM operand names, or null.
 *
 * An export is spelled by its name; a member as `Type.member`. A CALL of it reads as
 * it -- `createSysEmailTemplateLoader(engine, options?)` names
 * `createSysEmailTemplateLoader`, and `new X(...)` names `X` -- because that is how a
 * consumer writes the thing they must change. The argument list is never read: it is
 * accepted as a trailing `( ... )` and nothing more (the ruling's ⛔ on parsing
 * constructor arguments and object literals). Anything else -- an import statement,
 * a literal, a deeper path, a type argument -- is not canonical.
 *
 * @param {string} text the operand, backticks already stripped
 * @returns {string|null}
 */
export function canonicalFromOperand(text) {
  const m = /^(?:new\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*(?:\([\s\S]*\))?\s*;?$/.exec(text.trim());
  if (!m || m[1] === 'new') return null;
  return m[1];
}

const stripTicks = (s) => s.replace(/^`|`$/g, '');
/** An inline code span on one line. */
const CODE_SPAN_G = /`([^`\n]+)`/g;
/** The convention's two words, as WORDS -- `FROMAGE` and `TOP` are not tokens. */
const CONVENTION_TOKEN_G = /(?<![A-Za-z0-9_$])(FROM|TO)(?![A-Za-z0-9_$])/g;
/** The gap of the bare placeholder: arrows, emphasis and punctuation, no words. */
const PLACEHOLDER_GAP_RE = /^[\s*_()[\]:：,.;|>→—-]*$/;
/** Text left of a FROM token that OPENS a segment: list/quote/emphasis markup or a sentence boundary. */
const OPENS_SEGMENT_RE = /^(?:\s*(?:[-*+>]|\d+[.)])\s+)*\s*(?:\*\*|__|\*|_)?\s*$|[.:;。：](?:\*\*|__|\*|_)?\s*$/;
const ARROW_G = new RegExp(ARROW, 'g');
const LEFT_OPERAND_RE = new RegExp(`(${OPERAND})\\s*$`);
const RIGHT_OF_ARROW_RE = new RegExp(`^\\s*(?:${OPERAND}|${REMOVAL_INSTRUCTION})`);
const OPERAND_G = new RegExp(OPERAND, 'g');
/** The FROM column of a mapping table: `FROM`, or one of `OLD_COLUMN_RE`'s words. */
const FROM_COLUMN_RE = /^\**\s*FROM\b/;
const TO_COLUMN_RE = /^\**\s*TO\b/;

/** The index of a mapping table's FROM column, read off its header row, or -1. */
function fromColumnOf(headerRow) {
  const cells = tableCells(headerRow).map((c) => c.trim());
  const at = cells.findIndex((c) => FROM_COLUMN_RE.test(c) || OLD_COLUMN_RE.test(c));
  if (at < 0) return -1;
  return cells.slice(at + 1).some((c) => TO_COLUMN_RE.test(c) || NEW_COLUMN_RE.test(c)) ? at : -1;
}

/** A line with the convention's words lowercased and its arrows gone: nothing left for the detector. */
const neutraliseLine = (line) => line.replace(ARROW_G, '~').replace(CONVENTION_TOKEN_G, (t) => t.toLowerCase());

/**
 * Every FROM side the body writes, every rewrite shape it writes that this reader
 * does NOT read, and what the detector still finds once the read lines are gone.
 *
 * The FROM sides come from three shapes, read wherever they stand:
 *
 *   - a `FROM ... TO ...` segment on one line: every code span between the two
 *     words is an operand (the worked example's spelling). The bare placeholder --
 *     `FROM -> TO`, nothing but markup between the words -- carries no operand and
 *     is left to the detector, which reads it as a label or a mention exactly as it
 *     always has. A segment that OPENS its line or sentence but spans no code at all
 *     is a prescription naming nothing, and is reported;
 *   - an arrow rewrite or removal -- precisely `REWRITE_RE` / `RETIREMENT_RE`'s
 *     shape -- whose FROM side is the operand left of the arrow;
 *   - a mapping table whose header names a FROM column (`FROM`, or the
 *     `OLD_COLUMN_RE` words) followed by a TO one: each data row's FROM cell.
 *
 * A VERTICAL FROM / TO pair -- the two words opening consecutive blocks -- is not
 * read: its FROM side can span a fenced block, and reading code lines as operands
 * is a parser this category does not need. It is reported, never skipped.
 *
 * @param {string} body
 * @returns {{ sides: {text: string, operand: string, spelling: string|null}[],
 *             unread: {shape: string, text: string}[],
 *             residual: {branch: string, line: string}|null }}
 */
export function readFromBlock(body) {
  const lines = body.split(/\r?\n/);
  const copy = [...lines];
  const sides = [];
  const unread = [];
  const verticalFrom = [];
  let inTable = false;
  let fromCol = -1;
  let prev = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let read = false;
    if (TABLE_DELIM_RE.test(line)) {
      inTable = true;
      fromCol = TABLE_ROW_RE.test(prev) ? fromColumnOf(prev) : -1;
      if (fromCol >= 0) copy[i - 1] = neutraliseLine(lines[i - 1]);
      prev = line;
      continue;
    }
    const isRow = TABLE_ROW_RE.test(line);
    if (!isRow) { inTable = false; fromCol = -1; }
    if (isRow && inTable && fromCol >= 0) {
      const cells = tableCells(line);
      const operands = [...(cells[fromCol] ?? '').matchAll(OPERAND_G)].map((m) => m[0]);
      if (operands.length === 0) unread.push({ shape: 'a FROM cell naming no operand', text: line.trim() });
      for (const o of operands) sides.push({ text: line.trim(), operand: o, spelling: canonicalFromOperand(stripTicks(o)) });
      copy[i] = `|${cells.map(() => ' - ').join('|')}|`;
      prev = line;
      continue;
    }
    if (!isRow) {
      const spans = [...line.matchAll(CODE_SPAN_G)].map((m) => ({ from: m.index, to: m.index + m[0].length, text: m[1] }));
      const tokens = [...line.matchAll(CONVENTION_TOKEN_G)]
        .filter((m) => !spans.some((s) => m.index >= s.from && m.index < s.to))
        .map((m) => ({ tok: m[1], at: m.index, end: m.index + m[1].length }));
      let segment = false;
      for (let k = 0; k < tokens.length; k++) {
        const next = tokens[k + 1];
        if (tokens[k].tok !== 'FROM' || next?.tok !== 'TO') continue;
        segment = true;
        const inGap = spans.filter((s) => s.from >= tokens[k].end && s.to <= next.at);
        if (inGap.length === 0) {
          if (PLACEHOLDER_GAP_RE.test(line.slice(tokens[k].end, next.at))) continue;
          if (OPENS_SEGMENT_RE.test(line.slice(0, tokens[k].at))) {
            unread.push({ shape: 'a `FROM ... TO ...` line naming no operand', text: line.trim() });
          }
          continue;
        }
        read = true;
        for (const s of inGap) sides.push({ text: line.trim(), operand: `\`${s.text}\``, spelling: canonicalFromOperand(s.text) });
      }
      if (!segment && VERTICAL_FROM_RE.test(line)) verticalFrom.push(i);
    }
    for (const m of line.matchAll(ARROW_G)) {
      const left = LEFT_OPERAND_RE.exec(line.slice(0, m.index));
      if (!left || !RIGHT_OF_ARROW_RE.test(line.slice(m.index + m[0].length))) continue;
      read = true;
      sides.push({ text: line.trim(), operand: left[1], spelling: canonicalFromOperand(stripTicks(left[1])) });
    }
    if (read) copy[i] = neutraliseLine(line);
    prev = line;
  }
  for (const i of verticalFrom) {
    if (lines.slice(i + 1).some((l) => VERTICAL_TO_RE.test(l))) {
      unread.push({ shape: 'a vertical FROM / TO pair', text: lines[i].trim() });
    }
  }

  // What the detector still reads once every line above is neutralised. A
  // placeholder LABEL may stand above the block it introduces, so a label hit is
  // let through -- but only when the block exists and NOTHING concrete is left
  // anywhere in the body: branch 1 judges the whole body, and so does this.
  let residual = null;
  for (let guard = 0; guard <= copy.length && residual === null; guard++) {
    const hit = findMigrationPrescription(copy.join('\n'));
    if (!hit) break;
    const at = copy.findIndex((l) => l.trim() === hit.line);
    if (hit.branch !== 'from-to-label' || at < 0) { residual = hit; break; }
    const concrete = firstConcreteRewrite(copy.join('\n'));
    if (sides.length === 0) residual = hit;
    else if (concrete) residual = { branch: `${hit.branch} over ${concrete.shape}`, line: concrete.line };
    else copy[at] = neutraliseLine(copy[at]);
  }
  return { sides, unread, residual };
}

/**
 * The compiler kit predicate 1 reads exports with -- `typescript`, the checked
 * doors of `scripts/ts-parse.mjs` and `resolveTypesEntry` -- or null until loaded.
 *
 * LAZY, deliberately: `scan()` is synchronous and runs on every pull request, and
 * almost none of them names this category, so the import is paid only by a run
 * that needs it (`loadExportReader`, awaited by the entry point when a scan reports
 * `needsExportReader`, and by `--self-test`). A run that reaches the category
 * without it is a RED naming the loader, never a pass.
 */
let exportReaderKit = null;

/**
 * Load the kit once per process. `typescript` goes through `import-prerequisite.mjs`,
 * so an uninstalled tree says so instead of dying on a link error.
 */
export async function loadExportReader() {
  if (exportReaderKit) return exportReaderKit;
  const { requireDefaultExport } = await import('./import-prerequisite.mjs');
  const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url, {
    measures: 'whether each export a `runtime-export-retired` marker names really left the package\'s published entry',
  });
  const { createProgramChecked, parseSourceFile } = await import('./ts-parse.mjs');
  const { resolveTypesEntry } = await import('./check-published-readme-exports.mjs');
  exportReaderKit = { ts, createProgramChecked, parseSourceFile, resolveTypesEntry, libFiles: new Map() };
  return exportReaderKit;
}

/** tsup's declaration entry, and the `.d.mts` / `.d.cts` twins it writes beside it. */
const TSUP_DTS_ENTRY_RE = /^dist\/index\.d\.[cm]?ts$/;
/** The source files that entry may be generated from: exactly one must exist (D9, amended 2026-10-27, #26220). */
const SOURCE_ENTRY_NAMES = Object.freeze(['src/index.ts', 'src/index.tsx']);
/** Where a rev's blobs live inside the compiler's file system. Never a real path. */
const VIRTUAL_ROOT = '/__adr0087__/';
const TS_SOURCE_RE = /\.(?:d\.)?[cm]?tsx?$/;

/**
 * The repo-relative SOURCE entry of a workspace package at a rev, or a refusal.
 *
 * Only the mapping the ruling names: the package's `exports` map, read by
 * `resolveTypesEntry`, lands on `dist/index.d.ts` (or its tsup twin), generated
 * from the package's ONE source entry, `src/index.ts` or `src/index.tsx` (the
 * 2026-10-27 amendment, #26220: vite-plugin-dts builds the `ui/` packages from
 * the `.tsx`). Anything else -- no types entry, another file name, neither
 * source, BOTH sources -- is refused by name rather than guessed. The build tool
 * is never asked: the source file's name is the fact read here.
 */
function sourceEntryAt(rev, cwd, pkgName, pkgs, kit) {
  const info = pkgs.get(pkgName);
  if (!info) return { refusal: `no workspace manifest at ${rev.slice(0, 12)} is named \`${pkgName}\`` };
  if (info.private) {
    return {
      refusal: `\`${pkgName}\` is PRIVATE (\`private: true\` in ${info.file}): it has no published entry to retire an\n` +
        '      export from. The disposition that says so is `not-required (unpublished)`',
    };
  }
  let manifest;
  try { manifest = JSON.parse(showOrNull(rev, info.file, cwd) ?? ''); } catch { return { refusal: `${info.file} does not parse at ${rev.slice(0, 12)}` }; }
  const declared = kit.resolveTypesEntry(manifest, '.').entry?.replace(/^\.\//, '') ?? null;
  const dir = info.file.slice(0, -'package.json'.length);
  const present = SOURCE_ENTRY_NAMES.map((name) => `${dir}${name}`).filter((p) => showOrNull(rev, p, cwd) !== null);
  if (declared !== null && TSUP_DTS_ENTRY_RE.test(declared) && present.length > 1) {
    return {
      refusal: `the published entry of \`${pkgName}\` is AMBIGUOUS at ${rev.slice(0, 12)}: its \`exports\` map names \`${declared}\`,\n` +
        `      and the package carries BOTH ${present.join(' and ')}. The mapping reads ONE source entry\n` +
        '      (ADR-0087 D9, amended 2026-10-27), and which one the build compiles is the build tool\'s\n' +
        '      answer, which this gate never asks. Delete the stale one. Refused, never guessed',
    };
  }
  if (declared === null || !TSUP_DTS_ENTRY_RE.test(declared) || present.length === 0) {
    return {
      refusal: `the published entry of \`${pkgName}\` cannot be mapped to its source at ${rev.slice(0, 12)}: its \`exports\` map\n` +
        `      names ${declared === null ? 'no types entry' : `\`${declared}\``}, and the only mapping this gate reads is\n` +
        `      \`dist/index.d.ts\` (or its \`.d.mts\` / \`.d.cts\` twin) -> \`src/index.ts\` or \`src/index.tsx\`` +
        (declared !== null && TSUP_DTS_ENTRY_RE.test(declared) ? `, and neither ${dir}src/index.ts nor ${dir}src/index.tsx exists there` : '') + '.\n' +
        '      An entry this gate cannot map is refused, never guessed',
    };
  }
  return { entry: present[0], dir };
}

/** The changesets config whose `fixed` group a deleted package must have left. */
const CHANGESET_CONFIG = '.changeset/config.json';

/**
 * Predicate 1 for a WHOLE package, `<package>#*` (D9, amended 2026-10-27: ruling A
 * on PR #26365, comment 6439038287). A deleted package has no HEAD entry to read an
 * absence from, so the proof is about the package itself, in the ruling's words:
 * "in the workspace with a published entry at the merge base; absent from the
 * workspace at HEAD (no `package.json`, not in `pnpm-workspace.yaml`, not in the
 * changesets fixed group)".
 *
 * At the base the package is a workspace member, not private, and its published
 * entry maps (`sourceEntryAt`): an entry this gate cannot map is refused here as it
 * is for any operand. At HEAD all four must hold, and every one that fails is named:
 * its base manifest is gone, no workspace manifest carries its name (a package that
 * moved or was renamed was not deleted), no `pnpm-workspace.yaml` glob names its
 * directory literally, and no `fixed` group in `.changeset/config.json` lists it
 * (a glob entry names no package). A missing or unreadable config is refused,
 * never read as an empty group.
 *
 * @returns {{ refusal: string } | { file: string, dir: string }}
 */
function verifyWholePackageRetired(pkg, { base, head, cwd, packagesAt, kit }) {
  const atBase = packagesAt(base).get(pkg);
  if (!atBase) {
    return { refusal: `\`${pkg}\` is not in the workspace at the merge base: no workspace manifest at ${base.slice(0, 12)} is named it,\n      so nothing this workspace published is retired` };
  }
  if (atBase.private) {
    return {
      refusal: `\`${pkg}\` was never published: it is PRIVATE (\`private: true\` in ${atBase.file}) at the merge base, so it\n` +
        '      has no published entry to retire, and deleting it breaks no consumer outside the workspace',
    };
  }
  const mapped = sourceEntryAt(base, cwd, pkg, packagesAt(base), kit);
  if (mapped.refusal) return { refusal: `\`${pkg}\` has no published entry this gate can read at the merge base:\n      ${mapped.refusal}` };
  const dir = mapped.dir.replace(/\/$/, '');
  const present = [];
  if (showOrNull(head, atBase.file, cwd) !== null) present.push(`${atBase.file} still exists`);
  const atHead = packagesAt(head).get(pkg);
  if (atHead && atHead.file !== atBase.file) {
    present.push(`a workspace manifest at HEAD is still named it (${atHead.file}): a package that moved or was renamed\n` +
      '          was not deleted -- retire its exports by name');
  }
  if (workspaceGlobsAt(head, cwd).includes(dir)) present.push(`${WORKSPACE_FILE} still names its directory, \`${dir}\``);
  const config = showOrNull(head, CHANGESET_CONFIG, cwd);
  let fixed;
  try { fixed = config === null ? undefined : JSON.parse(config).fixed ?? []; } catch { fixed = undefined; }
  if (!Array.isArray(fixed)) {
    present.push(`${CHANGESET_CONFIG} is ${config === null ? 'missing' : 'unreadable (no parseable `fixed` array)'} at HEAD, so the fixed group\n` +
      '          cannot be read -- refused, never read as an empty group');
  } else if (fixed.some((group) => Array.isArray(group) && group.includes(pkg))) {
    present.push(`${CHANGESET_CONFIG} still lists it in a \`fixed\` group`);
  }
  if (present.length > 0) {
    return {
      refusal: `\`${pkg}\` is not absent from the workspace at HEAD -- the proof is no \`package.json\`, not in\n` +
        `      ${WORKSPACE_FILE}, not in the changesets fixed group, and here:\n` +
        present.map((p) => `        - ${p}`).join('\n'),
    };
  }
  return { file: atBase.file, dir };
}

/**
 * Predicate 2 for a whole package: the first metadata surface OUTSIDE `pkgDir` whose
 * CODE names `pkg`, or null -- D9's "no metadata surface references it in code",
 * read as `metadataSurfaceReference` reads an export: comment spans blanked, string
 * literals left standing. A package name can sit in code only inside a string, so
 * any occurrence counts -- a plugin id or package reference held as a VALUE as much
 * as an import. An import specifier (`from '…'`, a bare `import '…'`, `import('…')`,
 * `require('…')`, by the root or a subpath) is the case reported as `import`; every
 * other occurrence is a `mention`. A name that merely starts with `pkg`
 * (`plugin-xy` for `plugin-x`) is not it.
 *
 * @param {string} pkg
 * @param {string} pkgDir the package's directory, no trailing slash
 * @param {Map<string, string>} surfaceTexts path -> text of every metadata surface
 * @returns {{ kind: 'import'|'mention', hitPath: string, line: string } | null}
 */
export function packageReference(pkg, pkgDir, surfaceTexts) {
  const name = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const spec = new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|^\\s*import\\s+)(['"])${name}(?:/[^'"\\n]*)?\\1`, 'm');
  const mention = new RegExp(`(?<![\\w@./-])${name}(?![\\w.-])`);
  // `maskComments` blanks in place, so an offset in `code` is the same offset in the file.
  const lineAt = (raw, code, at) => {
    const end = code.indexOf('\n', at);
    return raw.slice(code.lastIndexOf('\n', at) + 1, end < 0 ? undefined : end).trim();
  };
  for (const [hitPath, rawText] of surfaceTexts) {
    if (hitPath.startsWith(`${pkgDir}/`) || !rawText.includes(pkg)) continue;
    const code = maskComments(rawText);
    const imp = spec.exec(code);
    if (imp) return { kind: 'import', hitPath, line: lineAt(rawText, code, imp.index) };
    const m = mention.exec(code);
    if (m) return { kind: 'mention', hitPath, line: lineAt(rawText, code, m.index) };
  }
  return null;
}

/**
 * What a package's published entry exports at a rev, read by the compiler.
 *
 * A Program is built over the package's source entry with a CompilerHost that
 * serves the rev's BLOBS (never the working tree), so the base and HEAD readings
 * are each a pure function of their rev. Relative imports resolve inside the
 * rev; a re-export (`export ... from`) of another workspace package's ROOT entry
 * resolves through the same mapping, so a cross-package `export *` is followed; any
 * other bare import is left unresolved, which costs nothing for the question asked
 * -- an unresolved `export *` is recorded instead, because a name could hide
 * behind it.
 *
 * @returns {{ refusal: string } | { pkg: string, entry: string, names: Map<string, object>,
 *            unresolvedStars: {file: string, specifier: string}[], checker: object, entryFile: object,
 *            fromVirtual: (f: string) => string|null }}
 */
function readExportSurface(rev, cwd, pkgName, pkgs, kit) {
  const mapped = sourceEntryAt(rev, cwd, pkgName, pkgs, kit);
  if (mapped.refusal) return mapped;
  const { ts } = kit;
  const texts = new Map();
  const loaded = new Set();
  const loadDir = (dir) => {
    if (loaded.has(dir)) return;
    loaded.add(dir);
    let listed = '';
    try { listed = git(['ls-tree', '-r', '--name-only', rev, '--', dir], cwd); } catch { return; }
    const paths = listed.split('\n').map((s) => s.trim()).filter((p) => TS_SOURCE_RE.test(p) && !p.includes('node_modules/'));
    for (const [p, t] of showManyOrNull(rev, paths, cwd)) texts.set(p, t);
  };
  loadDir(mapped.dir);
  const toVirtual = (p) => VIRTUAL_ROOT + p;
  const fromVirtual = (f) => (f.startsWith(VIRTUAL_ROOT) ? f.slice(VIRTUAL_ROOT.length) : null);
  const options = {
    noEmit: true, skipLibCheck: true, types: [], lib: ['lib.es2022.d.ts'],
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const real = ts.createCompilerHost(options, true);
  const extensionOf = (p) => (p.endsWith('.d.ts') ? ts.Extension.Dts : p.endsWith('.tsx') ? ts.Extension.Tsx : ts.Extension.Ts);
  const found = (p) => ({ resolvedModule: { resolvedFileName: toVirtual(p), extension: extensionOf(p), isExternalLibraryImport: false } });
  const resolveIn = (target) => {
    const stem = target.replace(/\.(?:[cm]?js|jsx)$/, '');
    const candidates = [`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`, `${stem}/index.ts`, `${stem}/index.tsx`];
    for (const c of candidates) {
      if (texts.has(c)) return c;
      if (![...loaded].some((d) => c.startsWith(d))) {
        const t = showOrNull(rev, c, cwd);
        if (t !== null) { texts.set(c, t); return c; }
      }
    }
    return null;
  };
  const host = {
    ...real,
    getCurrentDirectory: () => '/',
    writeFile: () => {},
    fileExists: (f) => (fromVirtual(f) === null ? real.fileExists(f) : texts.has(fromVirtual(f))),
    readFile: (f) => (fromVirtual(f) === null ? real.readFile(f) : texts.get(fromVirtual(f))),
    getSourceFile: (f, version, onError, create) => {
      const rel = fromVirtual(f);
      if (rel === null) {
        // A lib file: one parse per process, shared by every Program after it.
        if (!kit.libFiles.has(f)) kit.libFiles.set(f, real.getSourceFile(f, version, onError, create));
        return kit.libFiles.get(f);
      }
      return texts.has(rel) ? kit.parseSourceFile(f, texts.get(rel)) : undefined;
    },
    resolveModuleNameLiterals: (literals, containingFile) => literals.map((lit) => {
      const from = fromVirtual(containingFile);
      const spec = lit.text;
      if (from === null) return { resolvedModule: undefined };
      if (spec.startsWith('.')) {
        const hit = resolveIn(posix.normalize(posix.join(posix.dirname(from), spec)));
        return hit ? found(hit) : { resolvedModule: undefined };
      }
      // Another workspace package, ONLY where this file RE-EXPORTS it: that is the
      // one place its names become this entry's names.
      if (!lit.parent || !ts.isExportDeclaration(lit.parent)) return { resolvedModule: undefined };
      const other = sourceEntryAt(rev, cwd, spec, pkgs, kit);
      if (other.refusal) return { resolvedModule: undefined };
      loadDir(other.dir);
      return texts.has(other.entry) ? found(other.entry) : { resolvedModule: undefined };
    }),
  };
  const program = kit.createProgramChecked([toVirtual(mapped.entry)], options, host);
  const checker = program.getTypeChecker();
  const entryFile = program.getSourceFile(toVirtual(mapped.entry));
  const moduleSymbol = entryFile ? checker.getSymbolAtLocation(entryFile) : undefined;
  const names = new Map((moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []).map((s) => [s.name, s]));
  const unresolvedStars = [];
  const walked = new Set();
  const walk = (sf) => {
    if (!sf || walked.has(sf.fileName)) return;
    walked.add(sf.fileName);
    for (const st of sf.statements) {
      if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || st.exportClause) continue;
      const target = checker.getSymbolAtLocation(st.moduleSpecifier)?.declarations?.find((d) => ts.isSourceFile(d));
      if (target) walk(target);
      else unresolvedStars.push({ file: fromVirtual(sf.fileName) ?? sf.fileName, specifier: st.moduleSpecifier.text });
    }
  };
  walk(entryFile);
  return { pkg: pkgName, entry: mapped.entry, names, unresolvedStars, checker, entryFile, fromVirtual };
}

/** The symbol an export resolves to, through every re-export alias. */
function resolvedExport(surface, name, ts) {
  const s = surface.names.get(name);
  if (!s) return null;
  return s.flags & ts.SymbolFlags.Alias ? surface.checker.getAliasedSymbol(s) : s;
}

/** The repo-relative files declaring a symbol -- empty when it does not resolve. */
const declarationFiles = (surface, symbol) =>
  [...new Set((symbol?.declarations ?? []).map((d) => surface.fromVirtual(d.getSourceFile().fileName)).filter(Boolean))];

/**
 * The members of an exported type at one rev, or why they cannot be read.
 *
 * `unresolved` lists what the type's MEMBER SET depends on and the reader could not
 * resolve -- an `extends` from another package, an intersection with an imported
 * type. A member's own annotation is skipped: it decides the member's type, never
 * whether the member exists. At HEAD a non-empty list means absence cannot be
 * proven, because the member may have moved into what the reader cannot see.
 */
function membersOf(surface, typeName, ts) {
  const symbol = resolvedExport(surface, typeName, ts);
  if (!symbol) return { state: 'not-exported' };
  if (!symbol.declarations?.length) return { state: 'unreadable', why: 'it is re-exported from a module this reader does not follow' };
  const { checker } = surface;
  const type = symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)
    ? checker.getDeclaredTypeOfSymbol(symbol)
    : checker.getTypeOfSymbolAtLocation(symbol, surface.entryFile);
  if (type.flags & ts.TypeFlags.Any) return { state: 'unreadable', why: 'it resolves to `any`' };
  const unresolved = [];
  const visit = (node) => {
    if (ts.isTypeElement(node) || ts.isClassElement(node) || ts.isTypeParameterDeclaration(node) || ts.isFunctionLike(node)) return;
    if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword) return;
    const name = ts.isTypeReferenceNode(node) ? node.typeName
      : ts.isExpressionWithTypeArguments(node) ? node.expression
        : ts.isTypeQueryNode(node) ? node.exprName : null;
    if (name) {
      const s = checker.getSymbolAtLocation(name);
      const target = s && (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
      if (!target?.declarations?.length) unresolved.push(name.getText());
    }
    ts.forEachChild(node, visit);
  };
  for (const d of symbol.declarations) ts.forEachChild(d, visit);
  const props = new Map(checker.getPropertiesOfType(type).map((p) => [p.name, p]));
  return { state: 'ok', symbol, props, unresolved: [...new Set(unresolved)] };
}

/** What predicate 3 reads, said once for every message that refuses on it. */
const FROM_BLOCK_READS =
  '      This category reads the FROM side of a `FROM ... TO ...` line, of an arrow `X -> Y` (or\n' +
  '      `X -> delete it`), and of the FROM column of a `| FROM | TO |` / `| Wrote | Write instead |`\n' +
  '      table. Every FROM operand must be a named operand, spelled as the marker spells it, and\n' +
  '      every named operand must have a FROM side; what the detector still reads after that is\n' +
  '      the `no-migration-prescription` refusal, inherited (ADR-0087, the seventh category).';

/**
 * Verify one `runtime-export-retired` claim: the three predicates, all three, by
 * name, every failure reported (the `verifyTypeSurfaceOnly` discipline).
 *
 * @param {string[]} refs the `<package>#<Export>` / `<package>#<Type>.<member>` operands
 * @param {{ base: string, head: string, cwd: string, body: string,
 *           packagesAt: (rev: string) => Map<string, {private: boolean, file: string}>,
 *           kit?: object }} ctx `kit` defaults to the loaded `exportReaderKit`
 * @returns {{ problems: string[], verified: {ref: string, kind: string, declared: string}[], checked: string[] }}
 */
export function verifyRuntimeExportRetired(refs, { base, head, cwd, body, packagesAt, kit = exportReaderKit }) {
  const problems = [];
  const verified = [];
  const checked = [];
  const P = (name) => { checked.push(name); return name; };
  const HOW =
    '      fix: name each retired operand by the package that published it, e.g.\n' +
    '        <!-- adr-0087: not-required (runtime-export-retired @objectstack/plugin-email#mapTemplateToRow,\n' +
    '             @objectstack/plugin-email#EmailServicePluginOptions.seedTemplates) why -->';
  if (!kit) throw new Error('verifyRuntimeExportRetired: the export reader is not loaded -- await loadExportReader() first');
  const { ts } = kit;

  if (refs.length === 0) {
    problems.push(
      '`not-required (runtime-export-retired)` names no operand.\n' +
      '      The whole content of this exemption is WHICH exports retired, and every predicate is a\n' +
      '      statement about a named one. An unnamed claim asserts nothing checkable (#4690).\n' + HOW,
    );
    return { problems, verified, checked };
  }
  const operands = [];
  for (const ref of refs) {
    const parsed = parseExportOperand(ref);
    if (parsed.refusal) problems.push(`\`runtime-export-retired\` operand "${ref}" ${parsed.refusal}.\n${HOW}`);
    else operands.push({ ref, ...parsed });
  }
  if (operands.length === 0) return { problems, verified, checked };

  // ---- predicate 1: retired from the published entry --------------------------
  P('retired-from-entry');
  const read = new Map();
  const surfaceAt = (rev, pkg) => {
    const key = `${rev} ${pkg}`;
    if (!read.has(key)) read.set(key, readExportSurface(rev, cwd, pkg, packagesAt(rev), kit));
    return read.get(key);
  };
  const tag = (op) => `\`runtime-export-retired ${op.ref}\` [predicate 1: retired-from-entry]`;
  const starNote = (surface) => surface.unresolvedStars.length === 0 ? '' :
    `\n      Its entry re-exports ${surface.unresolvedStars.map((s) => `\`export * from '${s.specifier}'\` (${s.file})`).join(', ')},\n` +
    '      which this reader cannot follow -- a name could sit behind it.';
  const retired = [];
  for (const op of operands) {
    if (op.whole) {
      const proof = verifyWholePackageRetired(op.pkg, { base, head, cwd, packagesAt, kit });
      if (proof.refusal) { problems.push(`${tag(op)} is not proven:\n      ${proof.refusal}.`); continue; }
      retired.push({ op, at: null, symbol: null, member: null, pkgFile: proof.file, pkgDir: proof.dir });
      continue;
    }
    const at = surfaceAt(base, op.pkg);
    if (at.refusal) { problems.push(`${tag(op)} cannot be read at the merge base:\n      ${at.refusal}.`); continue; }
    const now = surfaceAt(head, op.pkg);
    if (now.refusal) {
      const deleted = !packagesAt(head).has(op.pkg);
      problems.push(
        `${tag(op)} cannot be read at HEAD:\n      ${now.refusal}.` +
        (deleted ? `\n      A published package DELETED at HEAD is retired whole, on one operand: \`${op.pkg}#*\`\n` +
          '      (ADR-0087 D9, amended 2026-10-27), with one FROM line naming the package.' : ''),
      );
      continue;
    }
    if (op.member === null) {
      if (!at.names.has(op.exportName)) {
        problems.push(
          `${tag(op)} is false: \`${op.exportName}\` is not exported by ${at.entry} at the merge base, so\n` +
          `      nothing named that was published to retire.${starNote(at)}`,
        );
        continue;
      }
      if (now.unresolvedStars.length > 0) {
        problems.push(`${tag(op)} cannot be proven: absence at HEAD is a claim about every name the entry exports.${starNote(now)}`);
        continue;
      }
      if (now.names.has(op.exportName)) {
        problems.push(
          `${tag(op)} is false: \`${op.exportName}\` is STILL exported by ${now.entry} at HEAD.\n` +
          '      A name that is still published retired nothing; the compiler has no break to deliver.',
        );
        continue;
      }
      retired.push({ op, at, symbol: resolvedExport(at, op.exportName, ts), member: null });
      continue;
    }
    const before = membersOf(at, op.exportName, ts);
    if (before.state !== 'ok') {
      problems.push(before.state === 'not-exported'
        ? `${tag(op)} is false: the type \`${op.exportName}\` is not exported by ${at.entry} at the merge base.${starNote(at)}`
        : `${tag(op)} cannot read the members of \`${op.exportName}\` at the merge base: ${before.why}.`);
      continue;
    }
    if (!before.props.has(op.member)) {
      problems.push(
        `${tag(op)} is false: \`${op.exportName}\` has no member \`${op.member}\` at the merge base.` +
        (before.unresolved.length ? `\n      Its shape there depends on ${before.unresolved.map((n) => `\`${n}\``).join(', ')}, which this reader does not resolve.` : ''),
      );
      continue;
    }
    const after = membersOf(now, op.exportName, ts);
    if (after.state === 'not-exported') {
      problems.push(
        `${tag(op)}: the type \`${op.exportName}\` itself is no longer exported at HEAD. A retired TYPE is\n` +
        `      named as an export (\`${op.pkg}#${op.exportName}\`), not through one of its members.`,
      );
      continue;
    }
    if (after.state !== 'ok') { problems.push(`${tag(op)} cannot read the members of \`${op.exportName}\` at HEAD: ${after.why}.`); continue; }
    if (after.unresolved.length > 0) {
      problems.push(
        `${tag(op)} cannot be proven: at HEAD the members of \`${op.exportName}\` depend on\n` +
        `      ${after.unresolved.map((n) => `\`${n}\``).join(', ')}, which this reader does not resolve -- \`${op.member}\` could have moved there.`,
      );
      continue;
    }
    if (after.props.has(op.member)) {
      problems.push(`${tag(op)} is false: \`${op.exportName}\` still has a member \`${op.member}\` at HEAD.`);
      continue;
    }
    retired.push({ op, at, symbol: before.symbol, member: before.props.get(op.member) });
  }

  // ---- predicate 2: no metadata surface, read at the merge base ----------------
  P('no-metadata-surface');
  let metadataTexts = null;
  const surfacePaths = retired.length > 0 ? metadataSurfaceFilesAt(base, cwd) : [];
  if (retired.length > 0 && surfacePaths.length === 0) {
    problems.push(
      '`not-required (runtime-export-retired)` [predicate 2: no-metadata-surface] cannot be verified: NO\n' +
      `      metadata-surface file (\`*.zod.ts\`, \`${SPEC_CONTRACTS_DIR}**\`, object definitions) exists at the merge\n` +
      '      base, so the scan that would refuse this claim has nothing to read (#4690).',
    );
  }
  for (const r of surfacePaths.length > 0 ? retired : []) {
    const { op, at, symbol, member } = r;
    const t = `\`runtime-export-retired ${op.ref}\` [predicate 2: no-metadata-surface]`;
    if (op.whole) {
      // The same question, asked of the PACKAGE: none of its files is a metadata
      // surface, and no metadata surface outside it names it in code.
      let own = [];
      try { own = git(['ls-tree', '-r', '--name-only', base, '--', `${r.pkgDir}/`], cwd).split('\n').map((s) => s.trim()).filter(Boolean); } catch { /* listed below as none */ }
      const site = own.find((f) => metadataSurfaceKind(f) !== null);
      if (site) {
        problems.push(
          `${t} is false: \`${op.pkg}\` carries ${site} (${metadataSurfaceKind(site)}) at the merge base.\n` +
          '      A metadata surface is what `objectstack migrate meta` reaches, so the ledger IS a channel here.\n' +
          '      fix: register the migration.',
        );
        continue;
      }
      metadataTexts ??= showManyOrNull(base, surfacePaths, cwd);
      const hit = packageReference(op.pkg, r.pkgDir, metadataTexts);
      if (hit) {
        problems.push(
          `${t} is false: ${hit.hitPath} (${metadataSurfaceKind(hit.hitPath)}) ` +
          `${hit.kind === 'import' ? 'IMPORTS' : 'names'} \`${op.pkg}\` IN CODE:\n` +
          `        ${hit.line.slice(0, 140)}\n` +
          '      A package a metadata surface reaches HAS a metadata surface (comment spans are already excluded).',
        );
        continue;
      }
      verified.push({ ref: op.ref, kind: 'package', declared: r.pkgFile });
      continue;
    }
    const files = declarationFiles(at, symbol);
    if (files.length === 0) {
      problems.push(`${t} cannot be verified: the declaration of \`${op.exportName}\` cannot be located at the merge base.`);
      continue;
    }
    const site = [...files, ...declarationFiles(at, member)].find((f) => metadataSurfaceKind(f) !== null);
    if (site) {
      problems.push(
        `${t} is false: \`${op.spelling}\` is declared in ${site} (${metadataSurfaceKind(site)}).\n` +
        '      A metadata surface is what `objectstack migrate meta` reaches, so the ledger IS a channel here.\n' +
        '      fix: register the migration.',
      );
      continue;
    }
    const projection = (symbol.declarations ?? []).find((d) => ts.isTypeAliasDeclaration(d) && ZOD_PROJECTION_RE.test(d.type.getText()));
    if (projection) {
      problems.push(
        `${t} is false: \`${op.exportName}\` is a projection of a Zod schema (${projection.type.getText().slice(0, 90)}).\n` +
        '      Under Prime Directive #1 that is the house spelling of "this type IS metadata".',
      );
      continue;
    }
    metadataTexts ??= showManyOrNull(base, surfacePaths, cwd);
    const hit = metadataSurfaceReference(op.exportName, files[0], metadataTexts, () => packagesAt(base));
    if (hit) {
      problems.push(
        `${t} is false: ${hit.hitPath} (${metadataSurfaceKind(hit.hitPath)}) ` +
        (hit.kind === 'import'
          ? `IMPORTS \`${op.exportName}\` from the module that declares it.`
          : `mentions \`${op.exportName}\` IN CODE while neither declaring nor importing it:\n        ${hit.line.slice(0, 140)}`) +
        '\n      An export a metadata surface reaches HAS a metadata surface (comment spans are already excluded).',
      );
      continue;
    }
    verified.push({ ref: op.ref, kind: op.member === null ? 'export' : 'member', declared: files[0] });
  }

  // ---- predicate 3: the FROM -> TO block names exactly the named operands ------
  P('from-operands-named');
  const t3 = '`not-required (runtime-export-retired)` [predicate 3: from-operands-named]';
  const named = new Set(operands.map((o) => o.spelling));
  const block = readFromBlock(body);
  for (const u of block.unread) {
    problems.push(`${t3}: the body carries ${u.shape}, which this category does not read:\n        ${u.text.slice(0, 160)}\n${FROM_BLOCK_READS}`);
  }
  // A whole package's FROM side is the package name, which is no identifier: read
  // it as that operand's spelling exactly when the marker names it with `#*`.
  const wholeNames = new Set(operands.filter((o) => o.whole).map((o) => o.pkg));
  const wholeNote = wholeNames.size === 0 ? '' :
    '\n      A package retired whole (`<package>#*`) is named on ONE FROM line, by the package name; its\n' +
    '      exports take no line of their own.';
  const seen = new Set();
  const reported = new Set();
  for (const raw of block.sides) {
    const bare = stripTicks(raw.operand).trim();
    const side = raw.spelling === null && wholeNames.has(bare) ? { ...raw, spelling: bare } : raw;
    if (side.spelling === null) {
      if (reported.has(side.operand)) continue;
      reported.add(side.operand);
      problems.push(
        `${t3}: the FROM operand ${side.operand} is not a canonical operand:\n        ${side.text.slice(0, 160)}\n` +
        '      An export is spelled by its name -- a call `name(...)` or `new Name(...)` reads as that name --\n' +
        '      and a member as `<Type>.<member>`. Nothing inside an argument list or an object literal is\n' +
        '      read (the ruling\'s ⛔ on parsing constructor arguments).',
      );
      continue;
    }
    seen.add(side.spelling);
    if (named.has(side.spelling) || reported.has(side.spelling)) continue;
    reported.add(side.spelling);
    problems.push(
      `${t3}: the FROM operand ${side.operand} names \`${side.spelling}\`, which the marker does not name -- out of range:\n` +
      `        ${side.text.slice(0, 160)}\n` +
      '      A prescription for anything but the named operands keeps the `no-migration-prescription` refusal.\n' +
      '      A retired MEMBER is named `<Type>.<member>` in the marker and written the same way on the FROM side.' +
      wholeNote,
    );
  }
  for (const op of operands) {
    if (seen.has(op.spelling)) continue;
    problems.push(
      `${t3}: the named operand \`${op.ref}\` has no FROM side in the body. The block must name EXACTLY the\n` +
      `      named operands: write the one-line fix a consumer needs, a line such as\n` +
      `        - FROM \`${op.spelling}\` TO <what to write instead>\n${FROM_BLOCK_READS}`,
    );
  }
  if (block.residual) {
    problems.push(
      `${t3}: once the named FROM sides are set aside, the body still carries a migration prescription\n` +
      `      (${block.residual.branch}):\n        ${block.residual.line.slice(0, 160)}\n${FROM_BLOCK_READS}`,
    );
  }

  return { problems, verified, checked };
}

const FIXIT = (ids) =>
  [
    '      Add ONE of these lines to the changeset body:',
    '',
    ids && ids.length
      ? `        <!-- adr-0087: registered ${ids.join(', ')} -->`
      : '        <!-- adr-0087: registered SOME-MIGRATION-ID -->',
    '        <!-- adr-0087: not-required (unpublished) why -->',
    '        <!-- adr-0087: not-required (already-registered SOME-MIGRATION-ID) why -->',
    '        <!-- adr-0087: not-required (no-migration-prescription) why -->',
    '        <!-- adr-0087: not-required (runtime-interface-only path/to/file.ts#Symbol) why -->',
    '        <!-- adr-0087: not-required (type-surface-only path/to/file.ts#Symbol) why -->',
    '        <!-- adr-0087: not-required (runtime-export-retired @scope/package#Export) why -->',
    '',
    '      Each category is described in ADR-0087, addendum of 2026-08-13.',
  ].join('\n');

/**
 * Judge the breaking changesets this diff introduces.
 *
 * @param {{ cwd: string, base: string, head?: string }} opts
 * @returns {{ problems: {file: string, message: string}[], judged: object[], skipped: string[], base: string, ledgerAdded: string[] }}
 * @throws when `base` and `head` have no merge base (#4690: not a pass)
 */
export function scan({ cwd, base, head = 'HEAD' }) {
  const from = mergeBase(base, head, cwd);
  if (!from) {
    throw new Error(
      `no merge base between '${base}' and '${head}' -- the diff has no trustworthy starting point. ` +
        'Refusing to fall back to the raw base, which is the #6129 defect.',
    );
  }

  const headLedger = ledgerAt(head, cwd);
  const baseLedger = ledgerAt(from, cwd);
  const ledgerAdded = [...headLedger.ids].filter((id) => !baseLedger.ids.has(id));
  // Lazily resolved: only an `unpublished` claim needs the workspace manifests, and
  // reading ~90 of them on every run is pure cost on the 99% of PRs that make no
  // such claim.
  let pkgsCache = null;
  const packages = () => (pkgsCache ??= workspacePackagesAt(head, cwd));
  // `runtime-export-retired` reads manifests at BOTH revs (#22918); keyed by rev,
  // and the HEAD entry is the same map `packages()` reads.
  const pkgsByRev = new Map();
  const packagesAt = (rev) => {
    if (rev === head) return packages();
    if (!pkgsByRev.has(rev)) pkgsByRev.set(rev, workspacePackagesAt(rev, cwd));
    return pkgsByRev.get(rev);
  };
  // Set when a marker names `runtime-export-retired` in a process that has not
  // loaded the compiler kit; the entry point loads it and scans again (see
  // `exportReaderKit`). Never a pass: the changeset is reported as a problem too.
  let needsExportReader = false;
  // Same lazy posture, and for the same reason: only a `type-surface-only` claim
  // needs the diff's file list. A sentinel rather than `??=`, because
  // `changedPathsBetween` returns null on a failed read and `??=` would re-run it
  // on every symbol -- turning one refusal into N identical ones.
  let changedCache;
  const changedPaths = () => {
    if (changedCache === undefined) changedCache = changedPathsBetween(from, head, cwd);
    return changedCache;
  };

  // `AMR`, not `AM`: see "Which diff rows are judged" in the header (#7045). An
  // `R` row is how a declared-breaking changeset used to arrive unseen.
  const out = git(['diff', '--name-status', '--diff-filter=AMR', from, head, '--', '.changeset/*.md'], cwd);
  const problems = [];
  const judged = [];
  const skipped = [];

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.split('\t');
    // `R` is `R<score>\t<old path>\t<new path>`; `A` and `M` are `<status>\t<path>`.
    // One character wide, because the `R` letter carries a similarity score and
    // `=== 'R'` against the whole field would never match.
    const status = fields[0][0];
    const file = status === 'R' ? fields[2] : fields[1];
    // The path the branch-point side is READ at: the same one for `M`, the
    // PRE-RENAME one for `R`. Field 2 either way.
    const basePath = fields[1];
    if (!file || !isChangesetFile(file)) continue;

    const headText = showOrNull(head, file, cwd);
    if (headText === null) continue; // vanished under us; nothing to judge

    const parsed = parseChangeset(headText);
    const decl = breakingDeclaration(parsed);
    if (!decl.breaking) { skipped.push(file); continue; }

    // A changeset that was ALREADY breaking at the branch point is inherited, not
    // introduced. Same philosophy as check-empty-changeset: this gate judges what a
    // PR brings, never the stock it forked from.
    //
    // `R` is read at `basePath` -- its pre-rename name -- which is the only thing
    // the rename status changes here (#7045). The statuses are spelled out rather
    // than written `!== 'A'` so that widening the filter again some day cannot
    // silently grant an unlisted status the inheritance exemption; an unknown
    // status falls through and gets JUDGED, which is the safe direction.
    //
    // `isChangesetFile(basePath)` because git pairs renames by CONTENT, not by
    // name: an `R` row can arrive as `.changeset/README.md -> .changeset/x.md`,
    // and README is documentation that declares nothing. Inheriting "already
    // breaking" from it would exempt a genuinely new breaking changeset. For `M`
    // the guard is a no-op -- `basePath` is the path already accepted above.
    if ((status === 'M' || status === 'R') && isChangesetFile(basePath)) {
      const baseText = showOrNull(from, basePath, cwd);
      if (baseText !== null && breakingDeclaration(parseChangeset(baseText)).breaking) {
        skipped.push(file);
        continue;
      }
    }

    const push = (message) => problems.push({ file, message });
    const d = readDisposition(parsed.body);

    if (!d.ok) {
      push(
        `declares a breaking change (${decl.signals.join(', ')}) but ${d.reason}.\n` +
        '      A declared-breaking change that says nothing about the ADR-0087 ledger is exactly the\n' +
        '      #6148 hole: the ledger and its generated artifacts stay mutually consistent when an\n' +
        '      entry was NEVER written, so every other gate is green (this is what happened on\n' +
        '      PR #6048 / #6011).\n' +
        FIXIT(ledgerAdded),
      );
      continue;
    }

    if (d.verdict === 'registered') {
      const unknown = d.ids.filter((id) => !headLedger.ids.has(id));
      if (unknown.length > 0) {
        push(
          `claims \`registered ${d.ids.join(', ')}\` but ${unknown.length} of those id(s) do not exist in\n` +
          `      the ADR-0087 registries at HEAD: ${unknown.join(', ')}\n` +
          `      Searched: ${LEDGER_SOURCES.join(', ')}\n` +
          '      fix: correct the id, or add the entry the marker claims exists.',
        );
        continue;
      }
      const fresh = d.ids.filter((id) => ledgerAdded.includes(id));
      if (fresh.length === 0) {
        push(
          `claims \`registered ${d.ids.join(', ')}\`, but none of those ids is NEW in this diff --\n` +
          '      every one of them already existed at the merge base. `registered` asserts that THIS PR\n' +
          '      made the registration.\n' +
          '      fix: if the surface is covered by an entry that already existed, say so instead:\n' +
          `        <!-- adr-0087: not-required (already-registered ${d.ids.join(', ')}) why it covers this change -->`,
        );
        continue;
      }
      judged.push({ file, verdict: 'registered', ids: d.ids, fresh, signals: decl.signals });
      continue;
    }

    // not-required.
    //
    // The verdict is dispatched EXPLICITLY rather than by falling through from the
    // `registered` arm above. Found by ablation while reverse-verifying #6148: with
    // the "a marker is required" branch removed, an unparseable disposition reached
    // here carrying `category === undefined` and was reported as `unknown category
    // "undefined"` -- still red, but for a nonsense reason that named neither the
    // real fault nor its fix. Correctness that depends on an earlier `continue`
    // rather than on a stated condition is one edit away from being wrong.
    if (d.verdict !== 'not-required') {
      push(
        `internal: disposition parsed to an unexpected verdict "${d.verdict}".\n` +
        '      This is a bug in readDisposition() or in this dispatch, not in the changeset.',
      );
      continue;
    }

    if (!CATEGORIES.includes(d.category)) {
      push(
        `unknown \`not-required\` category "${d.category}".\n` +
        `      The vocabulary is closed on purpose: ${CATEGORIES.join(', ')}.\n` +
        '      A free-text category would make the exemption unverifiable, which is the allow-list\n' +
        '      failure mode this gate exists to avoid.\n' +
        FIXIT(ledgerAdded),
      );
      continue;
    }

    if (d.why.length < 40) {
      push(
        `\`not-required (${d.category})\` carries a ${d.why.length}-character justification.\n` +
        '      An exemption with no stated reason cannot be re-judged by the next reader. Write what\n' +
        '      makes this break need no ledger entry (40 characters minimum).',
      );
      continue;
    }

    if (d.category === 'unpublished') {
      if (parsed.bumps.length === 0) {
        push('`not-required (unpublished)` on a changeset that declares no package at all -- nothing to verify.');
        continue;
      }
      const pkgs = packages();
      const unresolved = parsed.bumps.filter((b) => !pkgs.has(b.pkg)).map((b) => b.pkg);
      if (unresolved.length > 0) {
        push(
          `\`not-required (unpublished)\` names package(s) with no workspace manifest: ${unresolved.join(', ')}\n` +
          '      The claim cannot be verified, and an unverifiable exemption is refused rather than\n' +
          '      assumed true (#4690).',
        );
        continue;
      }
      const published = parsed.bumps.filter((b) => !pkgs.get(b.pkg).private).map((b) => b.pkg);
      if (published.length > 0) {
        push(
          `\`not-required (unpublished)\` is false: ${published.join(', ')} ${published.length === 1 ? 'is' : 'are'} PUBLISHED\n` +
          `      (\`private\` is not true in ${published.map((p) => pkgs.get(p).file).join(', ')}).\n` +
          '      A breaking change that reaches a published package reaches consumers, so the\n' +
          '      "nothing ships" exemption does not apply.',
        );
        continue;
      }
      judged.push({ file, verdict: 'not-required', category: d.category, why: d.why, signals: decl.signals });
      continue;
    }

    if (d.category === 'already-registered') {
      if (d.ids.length === 0) {
        push(
          '`not-required (already-registered)` names no migration id.\n' +
          '      The whole content of this exemption is WHICH entry already covers the change, so an\n' +
          '      unnamed one asserts nothing checkable.\n' +
          '      fix: <!-- adr-0087: not-required (already-registered SOME-MIGRATION-ID) why -->',
        );
        continue;
      }
      const unknown = d.ids.filter((id) => !headLedger.ids.has(id));
      if (unknown.length > 0) {
        push(
          `\`not-required (already-registered ${d.ids.join(', ')})\` names id(s) that do not exist in the\n` +
          `      ADR-0087 registries at HEAD: ${unknown.join(', ')}`,
        );
        continue;
      }
      const fresh = d.ids.filter((id) => ledgerAdded.includes(id));
      if (fresh.length === d.ids.length) {
        push(
          `\`already-registered\` names only id(s) this very diff ADDS: ${fresh.join(', ')}\n` +
          '      "already" means it existed at the merge base. If this PR made the registration, the\n' +
          `      honest disposition is:  <!-- adr-0087: registered ${fresh.join(', ')} -->`,
        );
        continue;
      }
      judged.push({ file, verdict: 'not-required', category: d.category, ids: d.ids, why: d.why, signals: decl.signals });
      continue;
    }

    // `no-migration-prescription` and `runtime-interface-only` both assert that no
    // consumer has a metadata rewrite to perform, so BOTH are refused by a body
    // that prescribes one. `runtime-interface-only` inheriting this refusal is what
    // makes it a NARROWING rather than a fifth way around it (#8299).
    //
    // `type-surface-only` is the ONE category exempt from it (#13080, maintainer
    // ruling 2026-08-30), and the exemption is the whole point of the category: a
    // published TYPE-surface narrowing genuinely ships a prescription -- rewrite
    // `(await client.analytics.query(q)).rows` as `.data.rows` -- addressed to a
    // TYPESCRIPT CONSUMER, delivered by the compiler at their own call site. The
    // ledger serves METADATA UPGRADERS and cannot reach them. Without the exemption
    // the gate still refuses the exact class the category was created for; that was
    // measured on the card before this was built.
    //
    // ⛔ The exemption is paid for ENTIRELY by predicate 4 of `verifyTypeSurfaceOnly`
    // (the base-side type reading), never by this line. Predicates 1-3 were measured
    // NOT to separate #6048 from #12104. Read that function's header before widening
    // this condition to a second category.
    //
    // `runtime-export-retired` (#22918) is NOT exempt, and is not dispatched here
    // only because it inherits the refusal more finely: predicate 3 of
    // `verifyRuntimeExportRetired` runs this same detector over the body with ONLY
    // the FROM sides it verified set aside, so what is refused here is refused
    // there, minus exactly the lines naming operands predicates 1-2 proved retired.
    const prescription = d.category === 'type-surface-only' || d.category === 'runtime-export-retired'
      ? null
      : findMigrationPrescription(parsed.body);
    if (prescription) {
      push(
        `\`not-required (${d.category})\` contradicts the changeset's own body, which carries\n` +
        '      a migration prescription.\n' +
        `      Evidence (${prescription.branch}):\n` +
        `        ${prescription.line.slice(0, 160)}\n` +
        '      A changeset that ships instructions for rewriting a consumer\'s code cannot also claim\n' +
        '      that no consumer has to rewrite anything. This is the shape #6048 had: its changeset\n' +
        '      carried a worked `迁移:FROM → TO` block and the ledger got no entry.\n' +
        '      fix: register the migration, or -- if the prescription is genuinely for someone the\n' +
        '      ledger does not serve -- use a category that can be verified (`unpublished`,\n' +
        '      `already-registered`). `runtime-interface-only` is NOT an escape from this line: it\n' +
        '      inherits this same refusal (#8299).\n' +
        '      One category IS exempt, and only on a positive base-side reading: if this is a\n' +
        '      PUBLISHED TYPE-SURFACE NARROWING -- a symbol that was `any` / `unknown` / unannotated\n' +
        '      at the merge base and is concrete at HEAD, in a diff that moves no `packages/spec`\n' +
        '      path and no ADR-0087 shape surface -- then the prescription is addressed to a\n' +
        '      TypeScript consumer and the compiler delivers it (#13080):\n' +
        '        <!-- adr-0087: not-required (type-surface-only path/to/file.ts#Symbol) why -->\n' +
        '      ⛔ Do NOT reach for it by dropping the `**BREAKING**` token instead. That was the only\n' +
        '      move this gate used to leave open and four changesets took it; it is what #13080 was\n' +
        '      filed to stop.\n' +
        '      And if the prescription rewrites only EXPORTS (or members of an exported type) that a\n' +
        '      published package RETIRED -- each one reachable from its entry at the merge base, gone at\n' +
        '      HEAD, no metadata surface -- the compiler delivers it too, and the operands are checked\n' +
        '      (#22918):\n' +
        '        <!-- adr-0087: not-required (runtime-export-retired @scope/package#Export) why -->',
      );
      continue;
    }

    if (d.category === 'runtime-interface-only') {
      const { problems: bad, verified } = verifyRuntimeInterfaceOnly(d.ids, { rev: head, cwd, packages });
      if (bad.length > 0) {
        for (const message of bad) push(message);
        continue;
      }
      judged.push({
        file, verdict: 'not-required', category: d.category, ids: d.ids, why: d.why, signals: decl.signals,
        detail: verified.map((v) => `${v.ref} (${v.kind})`).join(', '),
      });
      continue;
    }

    if (d.category === 'runtime-export-retired') {
      if (!exportReaderKit) {
        needsExportReader = true;
        push(
          '`not-required (runtime-export-retired)` cannot be judged in this process: its export reader (the\n' +
          '      TypeScript compiler) is loaded on demand and was not. The entry point loads it and scans\n' +
          '      again; a caller of `scan()` must `await loadExportReader()` first. Never a pass (#4690).',
        );
        continue;
      }
      const { problems: bad, verified } = verifyRuntimeExportRetired(d.ids, {
        base: from, head, cwd, body: parsed.body, packagesAt,
      });
      if (bad.length > 0) {
        for (const message of bad) push(message);
        continue;
      }
      judged.push({
        file, verdict: 'not-required', category: d.category, ids: d.ids, why: d.why, signals: decl.signals,
        detail: verified.map((v) => `${v.ref} (${v.kind}, ${v.declared})`).join(', '),
      });
      continue;
    }

    if (d.category === 'type-surface-only') {
      const { problems: bad, verified } = verifyTypeSurfaceOnly(d.ids, {
        base: from, head, cwd, bumps: parsed.bumps, packages, changedPaths,
      });
      if (bad.length > 0) {
        for (const message of bad) push(message);
        continue;
      }
      judged.push({
        file, verdict: 'not-required', category: d.category, ids: d.ids, why: d.why, signals: decl.signals,
        detail: verified.map((v) => `${v.ref} (${v.from} -> ${v.to})`).join(', '),
      });
      continue;
    }

    judged.push({ file, verdict: 'not-required', category: d.category, why: d.why, signals: decl.signals });
  }

  return { problems, judged, skipped, base: from, ledgerAdded, needsExportReader };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(problems) {
  console.error(`\n✗ check-adr-0087-registration: ${problems.length} problem(s).\n`);
  for (const { file, message } of problems) console.error(`  • ${file}\n      ${message}\n`);
  console.error(
    [
      'WHY THIS GATE EXISTS (#6148).',
      '',
      '  The ADR-0087 ledger (packages/spec/src/migrations/registry.ts) had two gates and both',
      '  pin ledger <-> ARTIFACT SYNCHRONY. Neither pins that a retirement which actually',
      '  happened has an entry AT ALL -- and because the artifacts are a pure projection of the',
      '  registry, an entry that was never written leaves the two perfectly consistent. Every',
      '  gate goes green, repo-wide. PR #6048 removed `ctx.user.roles` that way; a human triage',
      '  seat caught it by eye (#6011) and a separate round backfilled it (PR #6138).',
      '',
      '  Ledger entries are the sole data source for `objectstack migrate meta`,',
      '  `spec-changes.json` and the generated upgrade guide. For a surface with no spec schema',
      '  -- `ctx.user` is only a runtime TS interface -- there is no tombstone and no schema',
      '  rejection either, so the ledger entry is the ONLY channel that reaches an upgrader.',
      '',
      '  This gate does not decide whether your change needs an entry. It requires that the',
      '  question was ANSWERED IN WRITING. Measured: ~1 declared-breaking change in 7 needs an',
      '  entry, so `not-required` is the ordinary answer and costs one line.',
    ].join('\n'),
  );
  for (const { file } of problems) {
    console.error(
      `::error file=${file}::${file} declares a breaking change with no valid ADR-0087 disposition. Add an \`adr-0087:\` marker to the changeset body (see this step's log). A retirement that never reaches the ledger is invisible to every upgrade channel and to every other gate (#6148).`,
    );
  }
}

/** `--list`: the standing audit surface over the whole stock. */
function list(cwd, head) {
  const stock = changesetsAt(head, cwd);
  const rows = [];
  for (const path of stock) {
    const text = showOrNull(head, path, cwd);
    if (text === null) continue;
    const parsed = parseChangeset(text);
    const decl = breakingDeclaration(parsed);
    if (!decl.breaking) continue;
    const d = readDisposition(parsed.body);
    rows.push({
      path,
      signals: decl.signals.join('+'),
      disposition: d.ok ? (d.verdict === 'registered' ? `registered ${d.ids.join(',')}` : `not-required (${d.category})`) : '-- none --',
      prescription: hasMigrationPrescription(parsed.body),
    });
  }
  for (const r of rows) {
    console.log(`${r.disposition === '-- none --' ? ' ' : '✓'} ${r.path}\n    signals=${r.signals}  prescription=${r.prescription ? 'yes' : 'no'}  disposition=${r.disposition}`);
  }
  const none = rows.filter((r) => r.disposition === '-- none --').length;
  console.log(`\n${rows.length} declared-breaking changeset(s) in stock; ${rows.length - none} carry a disposition, ${none} do not.`);
  console.log('Every one of the above is EXEMPT for any PR that does not touch it -- this gate judges diffs, not stock.');
}

// ---------------------------------------------------------------------------
// `--audit-stock` -- the ONE-OFF backfill audit (#6350)
//
// ## What this is, and what it is deliberately NOT
//
// The gate above is FORWARD-ONLY: it judges the PR's own diff, for the #6129
// reason its sibling `check-empty-changeset.mjs` documents at length. That
// direction is correct and this mode does not overturn it -- judging the stock on
// every PR would turn the whole repo red on adoption day and would hold the
// current author answerable for changesets that landed on main months before their
// branch existed.
//
// The cost of forward-only is that the STOCK was never compared even once. At the
// time #6350 was filed the v17 train carried 227 declared-breaking changesets, none
// of which any version of this logic had ever looked at, and hand-sampling had
// already turned up 2 suspected ledger misses of exactly the #6011 shape. This mode
// runs the gate's OWN judging functions -- `breakingDeclaration`, `readDisposition`,
// `findMigrationPrescription`, `workspacePackagesAt` -- once over that stock, so the
// audit cannot drift from the gate: there is no second copy of the logic here, only
// a different population fed to it.
//
// It is NOT wired into CI, and must not be. `package.json`'s
// `check:adr-0087-registration` and the Check Changeset workflow both invoke the
// gate with no flag; this mode is reachable only by typing it. It is `--list`'s
// neighbour -- a standing audit surface an operator runs on purpose -- not a
// second gate.
//
// ## How it narrows 238 rows to a hand-checkable residue
//
// A stock changeset carries no disposition marker (nothing ever asked it for one),
// so replaying the gate verbatim would report every one of them and say nothing.
// What is informative is which disposition the changeset WOULD have been ENTITLED
// to, judged mechanically:
//
//   answered              -- it already carries a marker (landed after the gate).
//   exempt-unpublished    -- every package it bumps is `private: true`, so nothing
//                            it breaks reaches a consumer. Fully mechanical.
//   exempt-no-prescription-- its body frames no rewrite, so the catch-all is open
//                            to it. This is the gate's own contradiction check,
//                            run in the direction that grants rather than refuses.
//   RESIDUE               -- a published break whose body ships instructions for
//                            rewriting a consumer's code. Both mechanical
//                            exemptions are closed to it, so the only honest
//                            dispositions left are `registered` /
//                            `already-registered` -- and BOTH require a ledger
//                            entry that covers the surface. Whether one does is a
//                            judgment about meaning, which no script makes.
//
// For each residue row the audit adds the one further MECHANICAL fact that
// separates "the author registered it" from "nobody ever asked": did any commit
// that touched this changeset also touch an ADR-0087 registry source? That is the
// signal #6350's hand-sampling used, computed for the whole population instead of
// three spot checks.
//
// The output is a worklist for a human, not a verdict. It exits 0 whatever it
// finds -- a non-zero exit here would be a gate, and this is not one.
// ---------------------------------------------------------------------------

/**
 * Did any commit that touched `path` also touch an ADR-0087 registry source?
 *
 * Every commit in the changeset's history is considered, not just the one that
 * added it: a changeset can be edited into breaking after the fact, and the
 * registration may ride either commit. Cheap because it only runs on the residue.
 *
 * ⚠️ Unusable in a SHALLOW clone, and the failure is silent-and-plausible rather
 * than loud, so it is refused rather than approximated. In a graft-truncated
 * history every pre-graft file reads as "added by the graft commit", and that
 * commit contains the whole tree -- including both ledger sources. Measured on the
 * default CI-shaped checkout of this repo (104 commits, grafted at 2bc187641,
 * 5978 files in that one commit): 91 of 92 residue rows came back "the author
 * registered something", every one of them wrong, and the answer looks entirely
 * reasonable on the page. `git fetch --unshallow` (a `--filter=blob:none` partial
 * fetch is enough -- this reads trees, never blobs) is the fix.
 *
 * @returns {{ available: boolean, shas: string[] }}
 */
function ledgerTouchingCommits(path, head, cwd) {
  let shas;
  try {
    shas = git(['log', '--format=%h', head, '--', path], cwd).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { return { available: true, shas: [] }; }
  const hits = [];
  for (const sha of shas) {
    let names;
    try { names = git(['show', '--name-only', '--format=', sha], cwd); } catch { continue; }
    // The generated era (#22554): a registration commit adds an entry file and
    // touches no registry, so the ledger's two committed sources count too.
    if ([...LEDGER_SOURCES, MIGRATION_LEDGER_TEMPLATE, ...MIGRATION_LEDGER_ENTRY_DIRS].some((src) => names.includes(src))) hits.push(sha);
  }
  return { available: true, shas: hits };
}

/** Is this checkout shallow? A shallow history makes the ledger-touch signal a lie. */
function isShallow(cwd) {
  try { return git(['rev-parse', '--is-shallow-repository'], cwd).trim() === 'true'; } catch { return false; }
}

/**
 * Classify one stock changeset by which disposition it would be ENTITLED to.
 *
 * Exported so the self-test can pin it: this classifier decides which rows a human
 * ever looks at, so a silent widening of `exempt-*` would shrink the worklist
 * invisibly -- the #4690 failure mode wearing an audit's clothes.
 *
 * @param {ReturnType<typeof parseChangeset>} parsed
 * @param {Map<string, {private: boolean, file: string}>} pkgs
 * @returns {{ klass: 'answered'|'exempt-unpublished'|'exempt-no-prescription'|'residue', detail?: string, prescription?: ReturnType<typeof findMigrationPrescription> }}
 */
export function classifyStockChangeset(parsed, pkgs) {
  const d = readDisposition(parsed.body);
  if (d.ok) {
    return { klass: 'answered', detail: d.verdict === 'registered' ? `registered ${d.ids.join(',')}` : `not-required (${d.category})` };
  }
  // `unpublished` first: a private package ships nothing, so the prescription in
  // its body reaches no consumer of a published artifact and the question the
  // ledger answers does not arise. A changeset declaring NO package cannot claim
  // it -- the gate refuses that too ("nothing to verify").
  if (parsed.bumps.length > 0 && parsed.bumps.every((b) => pkgs.get(b.pkg)?.private === true)) {
    return { klass: 'exempt-unpublished', detail: parsed.bumps.map((b) => b.pkg).join(', ') };
  }
  const prescription = findMigrationPrescription(parsed.body);
  if (!prescription) return { klass: 'exempt-no-prescription' };
  return { klass: 'residue', prescription };
}

/** `--audit-stock`: run the gate's judging logic once over the whole stock (#6350). */
function auditStock(cwd, head) {
  const stock = changesetsAt(head, cwd);
  const texts = showManyOrNull(head, stock, cwd);
  const pkgs = workspacePackagesAt(head, cwd);

  const buckets = { answered: [], 'exempt-unpublished': [], 'exempt-no-prescription': [], residue: [] };
  let breaking = 0;
  for (const path of stock) {
    const text = texts.get(path);
    if (text === undefined) continue;
    const parsed = parseChangeset(text);
    const decl = breakingDeclaration(parsed);
    if (!decl.breaking) continue;
    breaking++;
    const c = classifyStockChangeset(parsed, pkgs);
    buckets[c.klass].push({ path, signals: decl.signals.join('+'), ...c });
  }

  console.log(`ADR-0087 stock backfill audit (#6350) -- ${stock.length} changeset(s) in stock, ${breaking} declared breaking.\n`);
  for (const [klass, label] of [
    ['answered', 'ALREADY ANSWERED -- carries an adr-0087 marker (landed after the gate)'],
    ['exempt-unpublished', 'EXEMPT (unpublished) -- every bumped package is private; nothing ships'],
    ['exempt-no-prescription', 'EXEMPT (no-migration-prescription) -- the body frames no rewrite'],
  ]) {
    console.log(`${label}: ${buckets[klass].length}`);
    for (const r of buckets[klass]) {
      if (klass !== 'exempt-no-prescription') console.log(`    ${r.path}${r.detail ? `  [${r.detail}]` : ''}`);
    }
    console.log('');
  }

  console.log(`RESIDUE -- published break + migration prescription, so only \`registered\` /`);
  console.log(`\`already-registered\` remain, and both need a ledger entry: ${buckets.residue.length}\n`);
  const shallow = isShallow(cwd);
  if (shallow) {
    console.log(
      '  ⚠️  SHALLOW CLONE -- the ledger-touch signal is SUPPRESSED, not approximated. Every pre-graft\n' +
      '      file reads as "added by the graft commit", which carries the whole tree including both\n' +
      '      ledger sources, so the signal would report a plausible-looking "registered" for almost\n' +
      '      every row and be wrong on almost every row. Run `git fetch --unshallow --filter=blob:none`\n' +
      '      (trees are enough; no blobs are read) and re-run.\n',
    );
  }
  for (const r of buckets.residue) {
    const touching = shallow ? null : ledgerTouchingCommits(r.path, head, cwd);
    const mark = touching === null ? '?' : touching.shas.length ? '~' : '!';
    console.log(`  ${mark} ${r.path}  [${r.signals}]`);
    console.log(`      prescription (${r.prescription.branch}): ${r.prescription.line.slice(0, 120)}`);
    if (touching === null) {
      console.log('      ledger-touch: UNAVAILABLE (shallow clone)');
    } else if (touching.shas.length) {
      console.log(`      ledger touched by: ${touching.shas.join(', ')} -- the author did register something; check it COVERS this surface`);
    } else {
      console.log('      ledger NEVER touched by any commit that touched this changeset -- the #6011 shape');
    }
  }
  console.log(
    '\nThis is a WORKLIST, not a verdict: `!` rows are candidates for a missing registration, and only a\n' +
    'reader deciding what the surface means can say whether one is owed. This mode exits 0 whatever it\n' +
    'finds -- it audits stock, which the gate deliberately never does (#6129).',
  );
}

// ---------------------------------------------------------------------------
// Self-test -- pins the RED paths so the gate cannot rot into a no-op.
//
// Real temp git repositories driven through the SAME exported scan()/assertInputs(),
// the check-empty-changeset.mjs convention. This gate's whole subject is a diff
// between two commits and a ledger read at two revs, so a fixture that is not two
// real commits would be testing an imitation of the code path that ships.
// ---------------------------------------------------------------------------

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-adr-0087-registration self-test reached its verdict';

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

  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    registerCase();
    checked++;
    if (!cond) failures.push(msg);
  };

  const REG = (ids) =>
    'export const X = {\n  semantic: [\n' +
    ids.map((i) => `    {\n      id: '${i}',\n      surface: 's',\n    },`).join('\n') +
    '\n  ],\n};\n';
  const CONV = (ids) => REG(ids);
  // A registry that ALSO declares `oneLine` on a single line -- an entry the build
  // sees and `extractIds()` does not, which is what parser rot looks like (#22485).
  const ONE_LINE_REG = (ids, oneLine) =>
    REG(ids).replace('\n  ],\n};\n', `\n    { id: '${oneLine}', surface: 's' },\n  ],\n};\n`);
  // The witness generator every fixture carries at WITNESS_GENERATOR (#22485): a
  // stand-in for `build-spec-changes.ts` that projects the fixture registry the way
  // the real one projects the real registry -- by EVALUATING it under tsx, never by
  // parsing its text -- through the same `--out` entry point. `generatedWitness`
  // runs it exactly as it runs the real one.
  const WITNESS_GEN = (body = null) =>
    "import { writeFileSync } from 'node:fs';\n" +
    "import { X } from '../src/migrations/registry';\n" +
    "const out = process.argv[process.argv.indexOf('--out') + 1];\n" +
    (body ??
      'writeFileSync(out, JSON.stringify({ perMajor: [{ to: 17, migrated: ' +
        'X.semantic.map((e: { id: string }) => ({ migrationId: e.id })) }] }));\n');
  // The witness for fixtures whose subject is some OTHER input: it projects exactly
  // what the parser sees, so it adds no problem of its own and spawns nothing. Every
  // case whose subject IS the witness drives the real `generatedWitness` instead
  // (I0, I1, the W battery, and the entry-point run in I2).
  const parserWitness = ({ cwd, head }) => ({
    json: { perMajor: [{ to: 17, migrated: [...ledgerAt(head, cwd).ids].map((id) => ({ migrationId: id })) }] },
    problem: null,
  });

  const CS = (opts = {}) => {
    const bumps = opts.bumps ?? [['@objectstack/spec', 'major']];
    const fm = bumps.map(([p, b]) => `'${p}': ${b}`).join('\n');
    return `---\n${fm}\n---\n\n${opts.body ?? 'a summary line\n\nsome prose that is quite long indeed and explains the change.\n'}`;
  };

  /**
   * Build a two-commit repo: base carries the ledger + a breaking changeset in
   * stock (realistic mid-cycle stock), head adds `files`.
   *
   * `baseFiles` puts extra files on the BASE commit, and a `null` in `files`
   * deletes one at head. Together they are how a RENAME is expressed (#7045):
   * git infers `R` from a delete plus an add of similar content, so the fixture
   * has to be able to say both halves.
   */
  // The ADR half of the #8299 pin. Generated FROM `CATEGORIES` so an ordinary
  // fixture can never fail assertion (5) for an unrelated reason; the cases that
  // give that assertion teeth (V1/V2) override this file deliberately, and the
  // REAL agreement is checked against the real ADR at HEAD on every CI run.
  const ADR_DOC = (cats = CATEGORIES) =>
    '# ADR-0087 (fixture)\n\n' +
    cats.map((c) => `<!-- adr-0087: not-required (${c}) ... -->\n`).join('');

  // The fixture's `pnpm-workspace.yaml` (#26220): the real file's glob shapes,
  // `ui/packages/*` among them, so a fixture package is a member exactly when it
  // would be one in this repository. `workspace: null` writes none.
  const WORKSPACE_YAML =
    'packages:\n  - packages/*\n  - packages/apps/*\n  - packages/drivers/*\n  - packages/plugins/*\n' +
    '  - packages/qa/*\n  - packages/triggers/*\n  - packages/services/*\n  - packages/adapters/*\n' +
    '  - packages/connectors/*\n  - apps/*\n  - examples/*\n' +
    '  # the objectui tree\n  - ui\n  - ui/packages/*\n  - ui/apps/*\n  - ui/examples/*\n';

  const build = ({ baseIds = ['old-entry-one', 'old-entry-two'], headIds = null, files = {}, baseFiles = {}, pkgs = null, workspace = WORKSPACE_YAML }) => {
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-'));
    const w = (rel, text) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);

    w(LEDGER_SOURCES[0], REG(baseIds));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(WITNESS_GENERATOR, WITNESS_GEN());
    w(ADR_0087, ADR_DOC());
    if (workspace !== null) w(WORKSPACE_FILE, workspace);
    // stock: one declared-breaking changeset -- realistic mid-cycle stock for
    // the inherited-changeset cases. (No longer needed to satisfy assertInputs:
    // since #8658 its convention-rot control is synthetic and phase-independent.)
    w('.changeset/stock-breaking.md', CS({ body: 'stock\n\n**BREAKING** something\n' }));
    for (const [name, p] of Object.entries(pkgs ?? { '@objectstack/spec': { dir: 'packages/spec', private: false } })) {
      w(`${p.dir}/package.json`, JSON.stringify({ name, version: '1.0.0', ...(p.private ? { private: true } : {}) }));
    }
    for (const [rel, text] of Object.entries(baseFiles)) w(rel, text);
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'base'], dir);
    const base = git(['rev-parse', 'HEAD'], dir).trim();

    if (headIds) w(LEDGER_SOURCES[0], REG(headIds));
    for (const [rel, text] of Object.entries(files)) {
      if (text === null) rmSync(join(dir, rel));
      else w(rel, text);
    }
    git(['add', '-A'], dir);
    // `--allow-empty`: some cases deliberately add nothing at head (the "this PR
    // touches no changeset" and "inherited changeset" shapes), and an empty commit
    // is the honest way to express that rather than padding the fixture.
    git(['commit', '-q', '--allow-empty', '-m', 'head'], dir);
    return { dir, base };
  };

  const run = ({ dir, base }) => scan({ cwd: dir, base, head: 'HEAD' });
  const cleanup = [];
  const mk = (o) => { const r = build(o); cleanup.push(r.dir); return r; };

  const red = (label, res, wants) => {
    assert(res.problems.length > 0, `${label}: expected RED, got green`);
    const text = res.problems.map((p) => `${p.file} ${p.message}`).join('\n');
    for (const re of wants) assert(re.test(text), `${label}: message must match ${re}\n--- actual ---\n${text}`);
  };
  const green = (label, res) => {
    assert(res.problems.length === 0, `${label}: expected GREEN, got:\n${res.problems.map((p) => p.file + ' ' + p.message).join('\n')}`);
  };

  // ---- H1 (#15915): the header points at CATEGORIES, never restates it ------
  // The header used to hand-enumerate every `not-required (<category>)` form,
  // and it drifted (#15915: five forms listed while `CATEGORIES` and ADR-0087
  // both already held six, `type-surface-only` among the missing). Pointing
  // at `CATEGORIES` instead of restating it only holds if nobody quietly adds
  // a name back in; this reads the gate's own source and refuses that.
  battery('H1 (#15915): the header points at CATEGORIES, never restates it');
  {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const ruleStart = src.indexOf('## The rule');
    const ruleEnd = src.indexOf('## Which diff rows are judged');
    assert(
      ruleStart !== -1 && ruleEnd !== -1 && ruleStart < ruleEnd,
      'H1: the header sections this pin reads by name have moved or been renamed -- update the anchors',
    );
    const header = ruleStart !== -1 && ruleEnd !== -1 ? src.slice(ruleStart, ruleEnd) : '';
    assert(
      header.includes('<!-- adr-0087: not-required (<category> ...) <why> -->'),
      'H1: the header no longer points readers at `CATEGORIES` via the generic `<category>` line',
    );
    for (const cat of CATEGORIES) {
      // `(${cat}` alone, not `(${cat})`: several forms carry an argument before
      // the closing paren (`not-required (already-registered <id>...)`), and a
      // check anchored on an immediate `)` would miss exactly those -- which is
      // how the first version of this pin missed its own reverse-verification.
      assert(
        !header.includes(`(${cat}`),
        `H1: the header names \`${cat}\` again -- a hand-kept enumeration is the #15915 defect returning`,
      );
    }
  }

  // ---- G1: a non-breaking changeset is not this gate's business -------------
  battery('G1: a non-breaking changeset is not this gate\'s business');
  green('G1 non-breaking changeset ignored', run(mk({
    files: { '.changeset/nb.md': CS({ bumps: [['@objectstack/spec', 'patch']], body: 'a patch\n\nprose.\n' }) },
  })));

  // ---- R1: THE #6011 SHAPE -- declared breaking, no ledger entry, no marker --
  // #6048's changeset reconstructed: major + **BREAKING** + a FROM -> TO block,
  // and nothing said about the ledger.
  battery('R1: THE #6011 SHAPE -- declared breaking, no ledger entry, no marker');
  const SIX048 = CS({
    bumps: [['@objectstack/runtime', 'major']],
    body: '**BREAKING**: `ctx.user.roles` removed\n\n### 迁移:FROM → TO\n\n```js\n// FROM\nctx.user.roles;\n// TO\nctx.user.positions;\n```\n',
  });
  red('R1 the #6011 shape (breaking, no disposition)', run(mk({
    files: { '.changeset/tidy-donkeys-yawn.md': SIX048 },
    pkgs: { '@objectstack/runtime': { dir: 'packages/runtime', private: false }, '@objectstack/spec': { dir: 'packages/spec', private: false } },
  })), [/tidy-donkeys-yawn/, /no `adr-0087:` disposition marker/, /#6148/, /adr-0087: registered/]);

  // ---- R2: the catch-all exemption cannot cover a FROM -> TO prescription ----
  battery('R2: the catch-all exemption cannot cover a FROM -> TO prescription');
  red('R2 no-migration-prescription contradicted by the body', run(mk({
    files: {
      '.changeset/tidy-donkeys-yawn.md': SIX048.replace(
        '```\n',
        '```\n\n<!-- adr-0087: not-required (no-migration-prescription) nobody in this repo reads the alias, we grepped -->\n',
      ),
    },
    pkgs: { '@objectstack/runtime': { dir: 'packages/runtime', private: false }, '@objectstack/spec': { dir: 'packages/spec', private: false } },
  })), [/contradicts the changeset's own body/, /Evidence \(from-to-label\)/, /#6048/]);

  // ---- G2: THE RECONCILIATION STEP -- register it and the same input passes --
  battery('G2: THE RECONCILIATION STEP -- register it and the same input passes');
  green('G2 same input, registered by this diff', run(mk({
    headIds: ['old-entry-one', 'old-entry-two', 'actor-user-roles-to-positions'],
    files: {
      '.changeset/tidy-donkeys-yawn.md': SIX048.replace(
        '```\n',
        '```\n\n<!-- adr-0087: registered actor-user-roles-to-positions -->\n',
      ),
    },
    pkgs: { '@objectstack/runtime': { dir: 'packages/runtime', private: false }, '@objectstack/spec': { dir: 'packages/spec', private: false } },
  })));

  // ---- R3: `registered` naming an id that does not exist --------------------
  battery('R3: `registered` naming an id that does not exist');
  red('R3 registered names a nonexistent id', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: registered no-such-entry -->\n' }) },
  })), [/do not exist in/, /no-such-entry/]);

  // ---- R4: `registered` claiming a registration this PR did not make --------
  battery('R4: `registered` claiming a registration this PR did not make');
  red('R4 registered names only pre-existing ids', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: registered old-entry-one -->\n' }) },
  })), [/none of those ids is NEW in this diff/, /already-registered/]);

  // ---- G3: already-registered, naming a genuinely pre-existing entry --------
  battery('G3: already-registered, naming a genuinely pre-existing entry');
  green('G3 already-registered on a base entry', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (already-registered old-entry-one) the same rename this entry already covers, second half -->\n' }),
    },
  })));

  // ---- R5: already-registered pointing at an id this diff just added --------
  battery('R5: already-registered pointing at an id this diff just added');
  red('R5 already-registered names a freshly added id', run(mk({
    headIds: ['old-entry-one', 'old-entry-two', 'brand-new-entry'],
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (already-registered brand-new-entry) this pre-existing entry already covers the change completely -->\n' }),
    },
  })), [/names only id\(s\) this very diff ADDS/, /adr-0087: registered brand-new-entry/]);

  // ---- R6: `unpublished` claimed for a published package --------------------
  battery('R6: `unpublished` claimed for a published package');
  red('R6 unpublished is false', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (unpublished) this is only our internal build tooling and ships to nobody -->\n' }),
    },
  })), [/is PUBLISHED/, /@objectstack\/spec/]);

  // ---- G4: `unpublished` on a genuinely private package ---------------------
  battery('G4: `unpublished` on a genuinely private package');
  green('G4 unpublished on a private package', run(mk({
    files: {
      '.changeset/x.md': CS({
        bumps: [['@objectstack/example-showcase', 'major']],
        body: '**BREAKING** x\n\n<!-- adr-0087: not-required (unpublished) the showcase example is private and publishes to no registry at all -->\n',
      }),
    },
    pkgs: {
      '@objectstack/spec': { dir: 'packages/spec', private: false },
      '@objectstack/example-showcase': { dir: 'examples/showcase', private: true },
    },
  })));

  // ---- R7: an unknown category is refused (the vocabulary is closed) --------
  battery('R7: an unknown category is refused (the vocabulary is closed)');
  red('R7 unknown category', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (whatever-i-like) because I say so and this is a long enough sentence -->\n' }) },
  })), [/unknown `not-required` category/, /vocabulary is closed/]);

  // ---- R8: an empty justification is refused --------------------------------
  battery('R8: an empty justification is refused');
  red('R8 justification too short', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (no-migration-prescription) n/a -->\n' }) },
  })), [/character justification/]);

  // ---- G5: the catch-all, on a changeset carrying no prescription -----------
  battery('G5: the catch-all, on a changeset carrying no prescription');
  green('G5 no-migration-prescription with no FROM/TO in the body', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (no-migration-prescription) an internal error string changed; no key, symbol or stored value moves -->\n' }),
    },
  })));

  // ---- D-E2E (#17357): the denial heading, END TO END through `scan()` --------
  //
  // D1-D9 above pin the detector; these pin the VERDICT, because the detector is
  // only half of what the author meets. Three cases, and the two REDs are the half
  // that keeps this from being a weakening: an author who denies in plain words is
  // admitted, an author who denies in the heading and ships the prescription anyway
  // is still refused, and an author who says NOTHING at all is still refused.
  battery('D-E2E (#17357): the denial heading, END TO END through `scan()`');
  const DENIAL_HEADING = '## No FROM → TO mapping, and why this section is not one';
  const DENIAL_WHY = 'a bare deletion on a non-strict schema refuses nothing and converts nothing';
  green('D-E2E-G the plain-words denial is admitted', run(mk({
    files: {
      '.changeset/x.md': CS({
        body: '**BREAKING** the `x` key is deleted outright.\n\n' + DENIAL_HEADING + '\n\n'
          + 'No metadata upgrader has an edit and `os migrate meta` has nothing to list.\n\n'
          + '<!-- adr-0087: not-required (no-migration-prescription) ' + DENIAL_WHY + ' -->\n',
      }),
    },
  })));
  red('D-E2E-R1 the same denial heading over a body that SHIPS the prescription still refuses', run(mk({
    files: {
      '.changeset/x.md': CS({
        body: '**BREAKING** the `x` key is deleted outright.\n\n' + DENIAL_HEADING + '\n\n'
          + '- `App.x` → `App.y`\n\n'
          + '<!-- adr-0087: not-required (no-migration-prescription) ' + DENIAL_WHY + ' -->\n',
      }),
    },
  })), [/contradicts the changeset's own body/, /Evidence \(from-to-label\)/]);
  red('D-E2E-R2 a SILENT omission is still refused -- the denial is a reading, never an exemption', run(mk({
    files: {
      '.changeset/x.md': CS({
        body: '**BREAKING** the `x` key is deleted outright.\n\n' + DENIAL_HEADING + '\n\n'
          + 'No metadata upgrader has an edit and `os migrate meta` has nothing to list.\n',
      }),
    },
  })), [/no `adr-0087:` disposition marker/]);

  // ---- F-E2E (#17864): the framed MENTION, END TO END through `scan()` -------
  //
  // What the unit pins above read as a verdict, an author reads as a refusal they
  // cannot answer: the catch-all is contradicted by "evidence" that is a sentence
  // saying where the prescriptions live, `registered` has no entry to name, and
  // `@objectstack/spec` is published so `unpublished` is false. Both directions run
  // here, because the narrowing is only worth having if the second one holds.
  battery('F-E2E (#17864): the framed MENTION, END TO END through `scan()`');
  const FRAMED_MENTION = 'The retirement is announced in the release notes; the Migration FROM → TO is documented elsewhere.';
  const FRAMED_WHY = 'a bare deletion on a non-strict schema refuses nothing and converts nothing';
  green('F-E2E-G the framed mention is admitted -- a sentence ABOUT prescriptions is not one', run(mk({
    files: {
      '.changeset/x.md': CS({
        body: '**BREAKING** the `x` key is deleted outright.\n\n' + FRAMED_MENTION + '\n\n'
          + '<!-- adr-0087: not-required (no-migration-prescription) ' + FRAMED_WHY + ' -->\n',
      }),
    },
  })));
  red('F-E2E-R the same sentence over a body that SHIPS the prescription still refuses', run(mk({
    files: {
      '.changeset/x.md': CS({
        body: '**BREAKING** the `x` key is deleted outright.\n\n' + FRAMED_MENTION + '\n\n'
          + '- `App.x` → `App.y`\n\n'
          + '<!-- adr-0087: not-required (no-migration-prescription) ' + FRAMED_WHY + ' -->\n',
      }),
    },
  })), [/contradicts the changeset's own body/, /Evidence \(from-to-label\)/]);

  // ---- L-E2E (#18494): the compound-noun label, END TO END through `scan()` ---
  //
  // #18494's own criterion is a COMMITTED probe changeset, not a unit reading: the
  // body carries `**Schema Migration FROM → TO:** delete the block` and no
  // concrete rewrite, and claims the catch-all. Before the colon arm the gate read
  // that label as a mention, found no prescription to contradict the claim, and
  // admitted a published break with no ledger entry -- exit 0 where exit 1 is owed.
  // The GREEN half runs too, because a narrowing that refused the mention as well
  // would have re-opened #17864 while passing the red.
  battery('L-E2E (#18494): the compound-noun label, END TO END through `scan()`');
  const NOUN_LABEL = '**Schema Migration FROM → TO:** delete the block';
  const NOUN_WHY = 'a bare deletion on a non-strict schema refuses nothing and converts nothing';
  red('L-E2E-R the compound-noun label contradicts the catch-all it claims', run(mk({
    files: {
      '.changeset/x.md': CS({
        body: '**BREAKING** the `x` key is deleted outright.\n\n' + NOUN_LABEL + '\n\n'
          + '<!-- adr-0087: not-required (no-migration-prescription) ' + NOUN_WHY + ' -->\n',
      }),
    },
  })), [/contradicts the changeset's own body/, /Evidence \(from-to-label\)/]);
  green('L-E2E-G the same sentence with no colon closing it is still the admitted mention', run(mk({
    files: {
      '.changeset/x.md': CS({
        body: '**BREAKING** the `x` key is deleted outright.\n\n'
          + 'The Schema Migration FROM → TO is documented in the release notes.\n\n'
          + '<!-- adr-0087: not-required (no-migration-prescription) ' + NOUN_WHY + ' -->\n',
      }),
    },
  })));

  // ---- R9: two markers is ambiguous, not "the first one wins" ---------------
  battery('R9: two markers is ambiguous, not "the first one wins"');
  red('R9 two disposition markers', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: registered old-entry-one -->\n<!-- adr-0087: not-required (unpublished) whatever this says it is ambiguous -->\n' }),
    },
  })), [/markers -- exactly one disposition is expected/]);

  // ---- R10: THE #6419 SHAPE -- a REAL prescription, written in Chinese with -
  // real identifiers, claiming the catch-all exemption.
  //
  // This is the case the gate was blind to on the day it landed: the body ships a
  // worked rewrite (`aggregate:` -> `aggregations:`) and simultaneously claims no
  // consumer has to rewrite anything, and the old detector passed it because the
  // author had written real identifiers instead of the placeholder words FROM/TO.
  // Reverse-verified: restore the old pattern and this case reports "expected RED,
  // got green" -- it is green for the empty reason, which is exactly the defect.
  battery('R10: THE #6419 SHAPE -- a REAL prescription, written in Chinese with -');
  red('R10 the #6419 shape (a real Chinese prescription under the catch-all)', run(mk({
    files: {
      '.changeset/x.md': CS({
        body:
          '**BREAKING**: 驱动 `aggregate()` 的两个宽容分支删除\n\n' +
          '**迁移**:`aggregate:` → `aggregations:`,`func:` → `function:`。\n\n' +
          '<!-- adr-0087: not-required (no-migration-prescription) these keys were never a declared surface anywhere -->\n',
      }),
    },
  })), [/contradicts the changeset's own body/, /Evidence \(framed-line\)/, /aggregations/]);

  // ---- R11: the same, framed by a HEADING instead of an inline label ---------
  // `## 迁移` + a list of rewrites is the other natural spelling; a line-only rule
  // would read the list as unframed prose and pass it.
  battery('R11: the same, framed by a HEADING instead of an inline label');
  red('R11 a prescription under a migration HEADING', run(mk({
    files: {
      '.changeset/x.md': CS({
        body:
          '**BREAKING**: two config keys renamed\n\n' +
          '## 迁移\n\n- `node.config.filters` → `node.config.filter`\n\n' +
          '<!-- adr-0087: not-required (no-migration-prescription) nothing downstream reads either spelling today -->\n',
      }),
    },
  })), [/contradicts the changeset's own body/, /Evidence \(framed-section\)/]);

  // ---- G7: ordinary prose arrows under the catch-all stay GREEN --------------
  // The false-positive floor. Every arrow here is real corpus prose: a pipeline, a
  // version step, a dependency direction, a request trace. None is a prescription,
  // and refusing them would leave an entitled author with no honest disposition --
  // the #6419 shape pointed the other way.
  battery('G7: ordinary prose arrows under the catch-all stay GREEN');
  green('G7 prose arrows are not prescriptions', run(mk({
    files: {
      '.changeset/x.md': CS({
        body:
          '**BREAKING** an internal error string changed\n\n' +
          'The analytics→engine bridge forwards the context; 16 → 17 is already a\n' +
          'substantial migration, and the dependency direction (runtime → objectql)\n' +
          'permits no other home. A bad request now answers → 400 instead of 500.\n\n' +
          '<!-- adr-0087: not-required (no-migration-prescription) an internal error string changed; no key, symbol or stored value moves -->\n',
      }),
    },
  })));

  // ---- R12: THE #6497 SHAPE -- a rewrite TABLE with no arrow in it ----------
  //
  // `runtime-httpserver-wrapper-retired.md` (#5122), reduced to its shape: a
  // textbook `## Migration` heading, a two-column "what you wrote / what to write
  // instead" table, not one arrow in the body, and the catch-all exemption claimed
  // on top. Both pre-#6497 branches required an arrow, so this was read as "no
  // prescription at all" and the exemption was granted. Reverse-verified: delete
  // the table arm and this case reports "expected RED, got green".
  battery('R12: THE #6497 SHAPE -- a rewrite TABLE with no arrow in it');
  const SIX497 = CS({
    bumps: [['@objectstack/runtime', 'major']],
    body:
      '**BREAKING**: the `HttpServer` delegating wrapper is retired\n\n' +
      '## Migration\n\n' +
      '| Wrote | Write instead |\n' +
      '| --- | --- |\n' +
      '| `new HttpServer(new HonoHttpServer(port))` | register the `HonoHttpServer` directly |\n' +
      '| `import { HttpServer }` | remove it — `tsc` reports this one |\n\n' +
      '<!-- adr-0087: not-required (no-migration-prescription) the wrapper had zero constructions anywhere, we grepped -->\n',
  });
  red('R12 the #6497 shape (an arrowless rewrite table under the catch-all)', run(mk({
    files: { '.changeset/x.md': SIX497 },
    pkgs: { '@objectstack/runtime': { dir: 'packages/runtime', private: false }, '@objectstack/spec': { dir: 'packages/spec', private: false } },
  })), [/contradicts the changeset's own body/, /Evidence \(framed-table\)/, /HonoHttpServer/]);

  // ---- R13: THE #6559 SHAPE -- the frame is the TABLE'S OWN HEADER ROW ------
  //
  // `storage-service-list-retired.md` (#5540), reduced to its shape. Identical to
  // R12 except for what is MISSING: there is no `## Migration` heading, so #6497's
  // arm has no framed region to fire in. The author framed the rewrite exactly as
  // this repo's house convention does it -- `| Wrote | Write instead |` -- and
  // claimed the catch-all on top. Eleven declared-breaking stock changesets held
  // the exemption through this gap.
  //
  // Reverse verification: delete the header-framed arm and this case reports
  // "expected RED, got green". It is the ONLY integration case in this file that
  // can move that way, which is why the arm's other assertions (P33-P38) are
  // labelled floors rather than counted as coverage.
  battery('R13: THE #6559 SHAPE -- the frame is the TABLE\'S OWN HEADER ROW');
  const SIX559 = CS({
    bumps: [['@objectstack/spec', 'major']],
    body:
      '**BREAKING**: `IStorageService.list(prefix)` is retired\n\n' +
      'Two adapters answered the same call with two different meanings, and neither\n' +
      'told you. Nothing in the repository called it.\n\n' +
      '**Migration.**\n\n' +
      '| Wrote | Write instead |\n' +
      '| --- | --- |\n' +
      "| `await storage.list('attachments/task/')` | query the `sys_file` rows, which page deterministically |\n" +
      '| `list?(prefix) { … }` on your own adapter | delete the method |\n\n' +
      '<!-- adr-0087: not-required (no-migration-prescription) the method had no caller anywhere, we grepped both repos -->\n',
  });
  red('R13 the #6559 shape (the table\'s own header row is the frame)', run(mk({
    files: { '.changeset/x.md': SIX559 },
  })), [/contradicts the changeset's own body/, /Evidence \(header-framed-table\)/, /sys_file/]);

  // ---- G8: a CAPABILITY table under the same framing stays GREEN ------------
  // The table arm's false-positive floor, and the reason it asks for two coded
  // cells rather than one: this is a real shape from the same changeset -- a member
  // named in column 1, prose about it in column 2. One coded cell is a description,
  // not a prescription, and refusing it would take an exemption from an author who
  // is entitled to it with nothing else in the vocabulary to offer them.
  //
  // NOTE, honestly: this case is green with the table arm and green without it.
  // Deleting an arm can only make a detector match LESS, so no false-positive floor
  // can move under reverse verification. It pins the boundary, not the capability.
  battery('G8: a CAPABILITY table under the same framing stays GREEN');
  green('G8 a one-coded-cell capability table is not a prescription', run(mk({
    files: {
      '.changeset/x.md': CS({
        body:
          '**BREAKING** the delegating wrapper is gone\n\n' +
          '## Migration\n\n' +
          '| Optional member | What wrapping it cost |\n' +
          '| --- | --- |\n' +
          '| `getPort?()` | the real bound port after listening on an ephemeral port |\n' +
          '| `getRawApp?()` | the framework-native escape hatch four consumers feature-detect |\n\n' +
          '<!-- adr-0087: not-required (no-migration-prescription) an internal error string changed; no key, symbol or stored value moves -->\n',
      }),
    },
  })));

  // ---- G9: THE #6967 SHAPE -- a changeset that POINTS AT prescriptions --------
  // The mirror image of R1/R10/R12/R13, and the first case in this family whose
  // failure mode is a hard block rather than a missed entry. The body below is
  // `.changeset/v17-rc-anchor.md`'s migration sentence verbatim: a version anchor
  // that retires nothing and says where the real prescriptions live. Read as a
  // prescription it left the author with no legal disposition at all -- the
  // catch-all refused as a contradiction, `registered` / `already-registered` with
  // no entry to name, `unpublished` false because `@objectstack/spec` publishes.
  //
  // This is the RED set under reverse verification: restore the branch-1 limb
  // (accept every placeholder occurrence) and this case goes red -- verified.
  battery('G9: THE #6967 SHAPE -- a changeset that POINTS AT prescriptions');
  green('G9 the #6967 shape (a POINTER to prescriptions is not a prescription)', run(mk({
    files: {
      '.changeset/v17-anchor.md': CS({
        body:
          'release!: promote the accumulated launch-window train to v17.0.0\n\n' +
          'Anchor changeset for the v17 major. The lockstep group applies the highest\n' +
          'bump across all pending changesets to every package.\n\n' +
          "Migration: each breaking change's own changeset carries its FROM → TO guide\n" +
          '(grep the CHANGELOG for `!:` entries).\n\n' +
          '<!-- adr-0087: not-required (no-migration-prescription) the anchor retires no surface at all; it only moves the version number -->\n',
      }),
    },
  })));

  // ---- R14: ...and the SAME sentence with the goods still refuses the catch-all
  // The floor under G9, and what keeps it from being a hole: a body may both cite
  // the convention AND carry a rewrite, and then the citation is taken at face
  // value. `unknown-key-strictness-tier-a.md` is this shape in the stock (`the
  // FROM → TO mappings baked into it include:` over a list of real renames), so the
  // pair G9/R14 pins that the rule separates POINTERS from PRESCRIPTIONS and not
  // prose from markup.
  battery('R14: ...and the SAME sentence with the goods still refuses the catch-all');
  red('R14 a cited FROM → TO with the rewrites present still contradicts the catch-all', run(mk({
    files: {
      '.changeset/x.md': CS({
        body:
          '**BREAKING** unknown keys are rejected\n\n' +
          'The error message carries the fix; the FROM → TO mappings baked into it include:\n\n' +
          '- Permission set: `objectPermissions` → `objectPermission`\n\n' +
          '<!-- adr-0087: not-required (no-migration-prescription) the rejection message is the whole story and nothing stored has to move -->\n',
      }),
    },
  })), [/contradicts the changeset's own body/, /Evidence \(from-to-label\)/, /mappings baked into it/]);

  // ---- RM: THE #18745 SHAPE -- a rewrite whose TO side is an INSTRUCTION -------
  //
  // `.changeset/18318-evalcontext-no-query-api.md`, reduced to its shape. The line
  // carries the framing word, the arrow and a proper operand on the FROM side, and
  // it was missed on exactly ONE predicate: `REWRITE_RE` wants an OPERAND on BOTH
  // sides, and `delete the property` is an instruction, not a name. So a changeset
  // that PRESCRIBES a removal held an exemption whose one mechanical check is "your
  // body carries no prescription" -- granted by SILENCE rather than by a finding,
  // which is the very failure the #8299 section of this header records against
  // #8277 and which the `runtime-interface-only` narrowing exists to end.
  //
  // RM-E2E1 is the card's own scenario end to end: the real missed text under the
  // real category it rode on. Reverse-verified -- drop the retirement arm and this
  // case reports "expected RED, got green".
  battery('RM (#18745): a rewrite whose TO side is an INSTRUCTION, not an operand');
  const RM_BODY = (marker) =>
    '**BREAKING** for a TypeScript consumer: an `EvalContext` literal carrying `api` stops compiling\n\n' +
    '**Migration — `api: { … }` → delete the property.** There is no replacement key and\n' +
    'nothing to re-point: every implementation ever passed there was discarded before\n' +
    'evaluation.\n\n' +
    `<!-- adr-0087: ${marker} -->\n`;

  // Self-contained rather than borrowing the `#8299` fixture below: this case has to
  // hold the CARD'S symbol (`packages/formula/src/types.ts#EvalContext`), and a
  // fixture shared with another rule is a fixture two rules can quietly move.
  const RM_PKGS = {
    '@objectstack/spec': { dir: 'packages/spec', private: false },
    '@objectstack/formula': { dir: 'packages/formula', private: false },
  };
  // The `.zod.ts` is the #4690 half: predicate 4 refuses a claim it cannot check, so
  // a fixture with NO metadata surface at all is refused for absence rather than
  // judged. It names a different symbol on purpose -- the scan must have something
  // real to read and nothing to find.
  const RM_FILES = {
    'packages/formula/src/types.ts': 'export interface EvalContext {\n  user?: { id: string };\n}\n',
    'packages/spec/src/data/unrelated.zod.ts':
      "import { z } from 'zod';\n\nexport const UnrelatedSchema = z.object({ id: z.string() });\n",
  };

  red('RM-E2E1 the real missed text still rides `runtime-interface-only`', run(mk({
    pkgs: RM_PKGS,
    files: {
      ...RM_FILES,
      '.changeset/x.md': CS({
        bumps: [['@objectstack/formula', 'major']],
        body: RM_BODY('not-required (runtime-interface-only packages/formula/src/types.ts#EvalContext) no Zod schema, no spec declaration, no stored form'),
      }),
    },
  })), [/contradicts the changeset's own body/, /Evidence \(framed-removal\)/, /delete the property/]);

  // The positive control for RM-E2E1's own fixture: the SAME claim on the SAME
  // symbol, with the removal sentence taken out, is ACCEPTED. It is what says the
  // RED above is the prescription refusal rather than a `runtime-interface-only`
  // predicate failing for some unrelated reason in a hand-built fixture.
  green('RM-E2E1b the same runtime-interface-only claim without the removal line is accepted', run(mk({
    pkgs: RM_PKGS,
    files: {
      ...RM_FILES,
      '.changeset/x.md': CS({
        bumps: [['@objectstack/formula', 'major']],
        body:
          '**BREAKING** for a TypeScript consumer: an `EvalContext` literal carrying `api` stops compiling\n\n' +
          'There is no replacement key and nothing to re-point.\n\n' +
          '<!-- adr-0087: not-required (runtime-interface-only packages/formula/src/types.ts#EvalContext) no Zod schema, no spec declaration, no stored form -->\n',
      }),
    },
  })));

  red('RM-E2E2 ...and under the catch-all it rode into, for the same reason', run(mk({
    files: {
      '.changeset/x.md': CS({
        body: RM_BODY('not-required (no-migration-prescription) the member was inert and nothing stored moves'),
      }),
    },
  })), [/contradicts the changeset's own body/, /Evidence \(framed-removal\)/]);

  // The control that makes the two REDs above attributable to the LINE rather than
  // to anything else in the fixture: the identical changeset with the removal
  // sentence taken out is GREEN. Without it, a fixture that reds for an unrelated
  // reason reads exactly like a working detector.
  green('RM-E2E3 the SAME changeset without the removal line keeps its exemption', run(mk({
    files: {
      '.changeset/x.md': CS({
        body:
          '**BREAKING** for a TypeScript consumer: an `EvalContext` literal carrying `api` stops compiling\n\n' +
          'There is no replacement key and nothing to re-point: every implementation ever\n' +
          'passed there was discarded before evaluation.\n\n' +
          '<!-- adr-0087: not-required (no-migration-prescription) the member was inert and nothing stored moves -->\n',
      }),
    },
  })));

  // ---- RM1-RM12: unit pins on the retirement arm and on its CLOSED class -------
  //
  // RM1-RM3 are the arm. RM4-RM9 are the floor: every one of them is a shape that
  // must NOT read as a prescription, and each was a live over-matching candidate
  // rather than a hypothetical. RM10 is the SUPERSET pin -- a body an older arm
  // already reads keeps that arm's branch AND its evidence line, which is what
  // makes "this can only add hits" structural instead of remembered. RM11-RM12 pin
  // the DIFFERENT hole: #8277's imperative-sentence prescription (no arrow, no
  // table) is the residue this header lists as deliberate, and this arm does not
  // and must not reach it -- if a later author widens toward it, these two say so.
  battery('RM1-RM12 (#18745): the retirement arm, and the class it must not widen past');
  assert(findMigrationPrescription('**Migration — `api: { … }` → delete the property.**\n')?.branch === 'framed-removal',
    'RM1: the real missed line reads as a framed removal prescription');
  assert(findMigrationPrescription('## Migration\n\n- `node.config.filters` → remove it\n')?.branch === 'framed-section-removal',
    'RM2: a removal under a migration HEADING reads on the section branch');
  assert(findMigrationPrescription('**迁移** — `api` → 删除该属性。\n')?.branch === 'framed-removal',
    'RM3: the Chinese removal spelling reads the same as the English one');
  assert(findMigrationPrescription('`api: { … }` → delete the property.\n') === null,
    'RM4: an UNFRAMED removal is not a prescription -- framing is still what separates a rewrite from a description');
  assert(findMigrationPrescription('**Migration.** `a.b` → drop-in replacement keeps working\n') === null,
    'RM5: `drop-in` is not the imperative `drop` -- the trailing lookahead is load-bearing');
  assert(findMigrationPrescription('## Migration\n\nthe pipeline `a.b` → deletes rows in batches now\n') === null,
    'RM6: `deletes` is a description of behaviour, not an instruction to remove');
  assert(findMigrationPrescription('**Migration.** runtime → delete the package\n') === null,
    'RM7: a BARE word on the FROM side is not an operand -- the left half is unchanged');
  assert(findMigrationPrescription('**Migration.** `a.b` → none of this changes what you write\n') === null,
    'RM8: `none` in arrow position stays REFUSED -- it is a running sentence as often as a prescription');
  assert(findMigrationPrescription('## What changed\n\n- `a.b` → delete the property\n') === null,
    'RM9: a removal under a heading carrying NO framing is not a prescription');
  assert(
    findMigrationPrescription('## Migration\n\n- `a.b` → delete the property\n- `c.d` → `c.e`\n')?.branch === 'framed-section' &&
    findMigrationPrescription('## Migration\n\n- `a.b` → delete the property\n- `c.d` → `c.e`\n')?.line === '- `c.d` → `c.e`',
    'RM10: a body an OLDER arm already reads keeps that arm\'s branch and evidence line, removal line or not');
  assert(findMigrationPrescription('If you only *call* `publish`, read `result.driverFault?.message` where you read `result.error`.\n') === null,
    'RM11: the #8277 shape -- an imperative SENTENCE with no arrow and no table -- is a DIFFERENT hole and stays out of reach');
  assert(findMigrationPrescription('## Migration\n\nread `result.driverFault?.message` where you read `result.error`.\n') === null,
    'RM12: ...and framing alone does not reach it either -- this arm needs the arrow the #8277 body never had');


  // ---- The #8299 category: `runtime-interface-only` -------------------------
  //
  // The fixture is the REAL shape, in miniature: `PackagePublishResult` names two
  // unrelated symbols in this repo -- the runtime service interface PR #8277
  // changed, and a Zod projection in `packages/spec` that a spec contract imports.
  // Every accept/refuse pair below is driven off that collision on purpose: the
  // predicate is only worth having if the SAME NAME under two paths comes out two
  // different ways, which is what a bare-name grep cannot do.
  battery('The #8299 category: `runtime-interface-only`');
  const RIO_FILES = {
    'packages/services/service-package/src/index.ts':
      'export interface PackagePublishDriverFault { message: string }\n\n' +
      'export interface PackagePublishResult {\n  success: boolean;\n  driverFault?: PackagePublishDriverFault;\n}\n',
    'packages/spec/src/system/metadata-persistence.zod.ts':
      "import { z } from 'zod';\n\n" +
      'export const PackagePublishResultSchema = z.object({ success: z.boolean() });\n' +
      'export type PackagePublishResult = z.input<typeof PackagePublishResultSchema>;\n',
    'packages/spec/src/contracts/metadata-service.ts':
      "import type { PackagePublishResult } from '../system/metadata-persistence.zod';\n\n" +
      'export interface IMetadataService {\n  publishPackage(): Promise<PackagePublishResult>;\n}\n',
  };
  const RIO_PKGS = {
    '@objectstack/spec': { dir: 'packages/spec', private: false },
    '@objectstack/core': { dir: 'packages/core', private: false },
    '@objectstack/service-package': { dir: 'packages/services/service-package', private: false },
  };
  const WHY = 'it has no Zod schema, no spec declaration and no stored form, so the compiler is the channel';
  const RIO_CS = (inParens, extra = '') =>
    CS({
      bumps: [['@objectstack/service-package', 'major']],
      body: `**BREAKING** the publish result drops its \`error\` member\n\n${extra}<!-- adr-0087: not-required (${inParens}) ${WHY} -->\n`,
    });

  // RIO-G1: THE #8277 CASE, ACCEPTED. The claim is path-qualified, so the homonym
  // in `metadata-persistence.zod.ts` and its import in `contracts/metadata-service.ts`
  // are correctly read as a DIFFERENT symbol.
  green('RIO-G1 #8277 accepted: a runtime interface with no metadata surface', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/services/service-package/src/index.ts#PackagePublishResult'),
    },
  })));

  // RIO-R1: THE OTHER HALF OF THE SAME PAIR, REFUSED. Same symbol NAME, declared in
  // a `*.zod.ts` -- exactly what the category may never exempt.
  red('RIO-R1 the same name declared in a *.zod.ts is refused', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/spec/src/system/metadata-persistence.zod.ts#PackagePublishResult'),
    },
  })), [/is false/, /is a Zod schema/]);

  // RIO-R2: declared in a plain runtime file, but a Zod schema IMPORTS it. Steps
  // 2-3 say where a symbol was born; this is why step 4 exists.
  red('RIO-R2 a runtime interface a *.zod.ts imports is refused', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/core/src/ports.ts': 'export interface StoragePort { read(): Promise<string> }\n',
      'packages/spec/src/data/storage.zod.ts':
        "import { z } from 'zod';\nimport type { StoragePort } from '@objectstack/core';\n\n" +
        'export const StorageSchema = z.object({ port: z.custom<StoragePort>() });\n',
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/core/src/ports.ts#StoragePort'),
    },
  })), [/is false/, /IMPORTS `StoragePort`/, /storage\.zod\.ts/]);

  // RIO-R3: an object definition MENTIONS it IN CODE, neither declaring nor
  // importing it. Unresolvable, so refused rather than assumed unrelated (#4690).
  //
  // The mention is a bare identifier in the object literal on purpose. This case
  // was written with the name in a `//` comment, which made it a fixture for TWO
  // rules at once -- "an unresolvable mention refuses" and "a comment is a
  // mention" -- and #12881 retired the second. Pinning them in one case would have
  // meant deleting the first to fix the second; RIO-G2/G3 below now carry the
  // comment half, and this one keeps the rule it was written for.
  const PORTS_TS = 'export interface StoragePort { read(): Promise<string> }\n';
  red('RIO-R3 an unresolvable CODE mention in an object definition is refused', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/core/src/ports.ts': PORTS_TS,
      'examples/app-crm/src/objects/account.object.ts':
        'export const account = {\n  name: "account",\n  shape: StoragePort,\n};\n',
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/core/src/ports.ts#StoragePort'),
    },
  })), [/cannot be verified/, /account\.object\.ts/, /neither declaring nor importing/]);

  // ---- #12881: a metadata surface that names the symbol only in PROSE ---------
  //
  // Every case below is driven off ONE fixture pair -- `StoragePort` declared in
  // an ordinary runtime module, and a metadata surface that names it -- with only
  // WHERE the name sits changing between them. That is the whole content of the
  // rule, so a case that passed for any other reason would not discriminate.
  battery('#12881: a metadata surface that names the symbol only in PROSE');

  // RIO-G2: THE #12881 CASE. A `*.zod.ts` docblock explains what the runtime type
  // keys on. It is a sentence: nothing is declared, nothing is imported, and
  // `objectstack migrate meta` has nothing to reach through it. The fixture is the
  // real one in miniature -- `packages/spec/src/api/contract.zod.ts` line 164,
  // which was the ONLY `.zod.ts` in the tree naming `ObjectStackClient` and
  // single-handedly refused a steps-1-to-3-clean claim on `packages/client`.
  green('RIO-G2 #12881: a docblock sentence in a *.zod.ts is not a reference', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/core/src/ports.ts': PORTS_TS,
      'packages/spec/src/api/contract.zod.ts':
        "import { z } from 'zod';\n\n" +
        '/**\n' +
        ' * The envelope SKELETON.\n' +
        ' *\n' +
        ' * It catches the big one -- a missing `success`, which is what\n' +
        ' * `StoragePort.unwrapResponse` keys on -- but it accepts an empty payload.\n' +
        ' */\n' +
        'export const BaseResponseSchema = z.object({ success: z.boolean() });\n',
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/core/src/ports.ts#StoragePort'),
    },
  })));

  // RIO-G3: the same rule for a `//` line comment in an object definition -- the
  // exact text RIO-R3 used to carry, asserted the other way round now.
  green('RIO-G3 a line comment in an object definition is not a reference', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/core/src/ports.ts': PORTS_TS,
      'examples/app-crm/src/objects/account.object.ts':
        'export const account = {\n  name: "account",\n  // shaped by StoragePort at publish time\n};\n',
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/core/src/ports.ts#StoragePort'),
    },
  })));

  // RIO-R10: THE HALF THAT MUST NOT MOVE. Same docblock sentence, and a real code
  // reference in the same file. Masking must not blind the code half -- without
  // this, a surface could buy the exemption by wrapping its live reference in
  // enough prose, which is the mirror image of the bug being fixed.
  red('RIO-R10 prose does not launder a CODE reference in the same file', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/core/src/ports.ts': PORTS_TS,
      'packages/spec/src/api/contract.zod.ts':
        "import { z } from 'zod';\n\n" +
        '/** `StoragePort` is what `unwrapResponse` keys on. */\n' +
        'export const BaseResponseSchema = z.object({ port: StoragePort });\n',
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/core/src/ports.ts#StoragePort'),
    },
  })), [/cannot be verified/, /contract\.zod\.ts/, /IN CODE/, /z\.object\(\{ port: StoragePort \}\)/]);

  // RIO-R11: the same, with a REAL IMPORT beside the prose. The import branch is
  // the category's sharpest tooth (a runtime interface pulled into a schema HAS a
  // metadata surface), so it gets its own case rather than riding on R10's.
  red('RIO-R11 prose beside a real import still refuses on the import', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/core/src/ports.ts': PORTS_TS,
      'packages/spec/src/data/storage.zod.ts':
        "import { z } from 'zod';\nimport type { StoragePort } from '@objectstack/core';\n\n" +
        '/** Prose that also names `StoragePort`, for good measure. */\n' +
        'export const StorageSchema = z.object({ port: z.custom<StoragePort>() });\n',
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/core/src/ports.ts#StoragePort'),
    },
  })), [/is false/, /IMPORTS `StoragePort`/, /storage\.zod\.ts/]);

  // RIO-R12: THE DELIBERATE BOUNDARY. `maskComments` leaves STRING LITERALS
  // standing, so a name inside a `.describe()` still refuses. It reads as prose to
  // a human, and that is exactly why the case is here: the conservative direction
  // is to refuse (#4690), a string is where an authorable value lives, and the
  // difference between masking comments and masking `comment || literal` is one
  // word in one call. This pins which one was chosen.
  red('RIO-R12 a mention inside a STRING literal is still a reference', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/core/src/ports.ts': PORTS_TS,
      'packages/spec/src/data/storage.zod.ts':
        "import { z } from 'zod';\n\n" +
        "export const StorageSchema = z.object({ port: z.string().describe('as StoragePort declares') });\n",
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/core/src/ports.ts#StoragePort'),
    },
  })), [/cannot be verified/, /storage\.zod\.ts/, /as StoragePort declares/]);

  // RIO-G4: the rule applied to the OTHER reads in step 4. A commented-out import
  // is not an import -- it puts nothing in a schema -- so it cannot be the thing
  // that refuses. Without this the masking would be half-applied: prose excluded
  // from the mention scan, prose still believed by the import scan.
  green('RIO-G4 a commented-out import is not an import', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/core/src/ports.ts': PORTS_TS,
      'packages/spec/src/data/storage.zod.ts':
        "import { z } from 'zod';\n// import type { StoragePort } from '@objectstack/core';\n\n" +
        'export const StorageSchema = z.object({ port: z.unknown() });\n',
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/core/src/ports.ts#StoragePort'),
    },
  })));

  // RIO-R4: a BARE NAME is refused. This is the predicate #8299 proposed, and it is
  // refused precisely because it cannot tell RIO-G1 from RIO-R1.
  red('RIO-R4 a bare symbol name is not a symbol reference', run(mk({
    pkgs: RIO_PKGS,
    files: { ...RIO_FILES, '.changeset/x.md': RIO_CS('runtime-interface-only PackagePublishResult') },
  })), [/not a `<path>#<Symbol>` reference/, /names two unrelated symbols/]);

  // RIO-R5: the claim names no symbol at all -- nothing to verify.
  red('RIO-R5 no symbol named', run(mk({
    pkgs: RIO_PKGS,
    files: { ...RIO_FILES, '.changeset/x.md': RIO_CS('runtime-interface-only') },
  })), [/names no symbol/]);

  // RIO-R6: the path does not exist at HEAD.
  red('RIO-R6 an unresolvable path', run(mk({
    pkgs: RIO_PKGS,
    files: { ...RIO_FILES, '.changeset/x.md': RIO_CS('runtime-interface-only packages/gone/src/index.ts#Ghost') },
  })), [/does not exist at HEAD/]);

  // RIO-R7: the path exists and exports no such type.
  red('RIO-R7 the named symbol is not exported there', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/services/service-package/src/index.ts#NotHere'),
    },
  })), [/exports no `NotHere` type declaration/]);

  // RIO-R8: a Zod projection living in an ordinary `.ts` file. The file name says
  // runtime; the declaration says metadata, and the declaration wins.
  red('RIO-R8 a z.input<> projection outside a *.zod.ts is refused', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/metadata/src/derived.ts':
        "import type { z } from 'zod';\nimport { StoredPackageSchema } from './schemas';\n\n" +
        'export type StoredPackage = z.input<typeof StoredPackageSchema>;\n',
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/metadata/src/derived.ts#StoredPackage'),
    },
  })), [/projection of a Zod\n\s+schema/]);

  // RIO-R9: the category INHERITS the prescription refusal. Without this the new
  // category would be a fifth way around the #6048 forcing function instead of a
  // narrowing of it.
  red('RIO-R9 a migration prescription refuses this category too', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      '.changeset/x.md': RIO_CS(
        'runtime-interface-only packages/services/service-package/src/index.ts#PackagePublishResult',
        '### 迁移\n\n`result.error` → `result.driverFault?.message`\n\n',
      ),
    },
  })), [/contradicts the changeset's own body/, /NOT an escape from this line/]);

  // ---- The #13080 category: `type-surface-only` ------------------------------
  //
  // The fixture is the REAL #12104 shape in miniature: an `@objectstack/client`
  // method that carried NO return annotation (so its published type was
  // `Promise< any >`, inherited from `lib.dom`'s `Response.json()`) and now
  // declares the contract it always answered. Its changeset carries a genuine
  // FROM/TO rewrite table, because the class really does prescribe one -- to a
  // TypeScript consumer, delivered by the compiler.
  //
  // Every red below moves exactly ONE predicate off true, so each case is
  // attributable to the predicate it is named for. The greens and reds share one
  // fixture family for the reason RIO's do: a case that passed for another reason
  // would not discriminate.
  battery('The #13080 category: `type-surface-only`');
  const TSO_BASE_CLIENT =
    'export class ObjectStackClient {\n' +
    '  analytics = {\n' +
    '    queryDataset: async (payload: { selection: { measures: string[] } }) => {\n' +
    "      const res = await this.fetch('/analytics/dataset/query');\n" +
    '      return res.json();\n' +
    '    },\n' +
    '  };\n' +
    '}\n';
  const TSO_HEAD_CLIENT = TSO_BASE_CLIENT.replace(
    'measures: string[] } }) => {',
    'measures: string[] } }): Promise<AnalyticsResult> => {',
  );
  const TSO_PKGS = {
    '@objectstack/spec': { dir: 'packages/spec', private: false },
    '@objectstack/client': { dir: 'packages/client', private: false },
  };
  const TSO_WHY =
    'the only thing that moved is a TypeScript return annotation, so `objectstack migrate meta` ' +
    'has nothing to rewrite and the compiler reaches every affected consumer';
  // A REAL migration prescription, in the shape the live changesets carry. Its
  // presence is the whole point: this is the ONE category exempt from the
  // prescription refusal, and a fixture without one would prove nothing.
  //
  // ⛔ The table must demonstrate the fixture's OWN subject -- `queryDataset`, the
  // symbol `TSO_REF` names and `TSO_BASE_CLIENT` declares. Two independent reasons,
  // either sufficient on its own:
  //
  //   1. A table rewriting some OTHER method prescribes a migration this fixture's
  //      diff does not ship. TSO-G1 would still pass, for a reason unrelated to
  //      what it claims to pin.
  //   2. This is a STRING LITERAL, and `scripts/js-comment-mask.mjs` blanks
  //      comments only -- never literals. So a call-shaped example naming one of
  //      the four methods `packages/client/src/envelope-caller-census.test.ts`
  //      enumerates (`analytics.query` / `analytics.meta` / `analytics.explain`,
  //      `automation.trigger`) is counted THERE as a real SDK call site, and that
  //      census's ledger goes red on a count it has no row for. `queryDataset` is
  //      deliberately outside those four and that census's section 4 pins its
  //      absence.
  //
  // The direction below is the honest one for this method: its route is served
  // BARE by `@objectstack/rest`, so there is no envelope to read through --
  // `.data.rows` is a spelling `Promise< any >` used to permit and the annotation
  // now refuses, which is precisely a prescription the COMPILER delivers.
  const TSO_BODY =
    'fix(client): bind the in-repo `return res.json()` methods, whose published type was `Promise< any >`\n\n' +
    '**BREAKING**: `any` is assignable to everything, so a consumer can stop compiling.\n\n' +
    '## Migration\n\n' +
    '| you wrote | write instead |\n| --- | --- |\n' +
    '| `(await client.analytics.queryDataset(q)).data.rows` | `(await client.analytics.queryDataset(q)).rows` |\n';
  const TSO_CS = (inParens) =>
    CS({ bumps: [['@objectstack/client', 'minor']], body: `${TSO_BODY}\n<!-- adr-0087: not-required (${inParens}) ${TSO_WHY} -->\n` });
  const TSO_REF = 'packages/client/src/index.ts#queryDataset';
  const TSO_FIXTURE = (over = {}) => ({
    pkgs: TSO_PKGS,
    baseFiles: { 'packages/client/src/index.ts': TSO_BASE_CLIENT, ...(over.baseFiles ?? {}) },
    files: {
      'packages/client/src/index.ts': TSO_HEAD_CLIENT,
      '.changeset/x.md': TSO_CS(over.marker ?? `type-surface-only ${TSO_REF}`),
      ...(over.files ?? {}),
    },
    ...(over.pkgs ? { pkgs: over.pkgs } : {}),
  });

  // TSO-G1: ALL FOUR PREDICATES TRUE -- the case the category exists for.
  // Note what this green also proves: the body carries a framed rewrite table
  // (`framed-table`, the #6497 branch) and the claim is admitted anyway. That is
  // the `no-migration-prescription` EXEMPTION, and it is the only one in the file.
  green('TSO-G1 the #12104 shape admitted: published, no spec diff, no metadata surface, narrowed off `any`',
    run(mk(TSO_FIXTURE())));

  // TSO-R1: predicate 1 off. Same everything, private package.
  red('TSO-R1 predicate 1 (published) false: a private package', run(mk(TSO_FIXTURE({
    pkgs: {
      '@objectstack/spec': { dir: 'packages/spec', private: false },
      '@objectstack/client': { dir: 'packages/client', private: true },
    },
  }))), [/predicate 1: published\] is false/, /@objectstack\/client/, /not-required \(unpublished\)/]);

  // TSO-R2: predicate 2 off. The extra path is deliberately NOT a metadata
  // surface, so predicate 3 stays TRUE and this case is attributable to 2 alone.
  red('TSO-R2 predicate 2 (no-spec-diff) false: the diff touches packages/spec', run(mk(TSO_FIXTURE({
    files: { 'packages/spec/src/notes.ts': 'export const note = 1;\n' },
  }))), [/predicate 2: no-spec-diff\] is false/, /packages\/spec\/src\/notes\.ts/]);

  // TSO-R3: predicate 3 off, and predicate 2 still TRUE -- the metadata surface
  // is an object definition OUTSIDE `packages/spec`, which is exactly why the two
  // predicates are separate checks rather than one path test.
  red('TSO-R3 predicate 3 (no-metadata-surface-diff) false: an object definition moved', run(mk(TSO_FIXTURE({
    files: { 'examples/app-crm/src/objects/account.object.ts': 'export const account = { name: "account" };\n' },
  }))), [/predicate 3: no-metadata-surface-diff\] is false/, /account\.object\.ts/, /an object definition/]);

  // TSO-R4: predicate 4 off -- the symbol was ALREADY concrete at the merge base.
  //
  // ⭐ This case also pins the exemption in the OTHER direction. The body carries
  // the same prescription TSO-G1's does, so if the exemption were body-scoped
  // rather than predicate-scoped this would be refused for CONTRADICTING ITS OWN
  // BODY. It must be refused for predicate 4 instead, and the negative assertion
  // below is what says so: the exemption holds, and predicate 4 alone closes it.
  const TSO_R4 = run(mk(TSO_FIXTURE({
    baseFiles: {
      'packages/client/src/index.ts': TSO_BASE_CLIENT.replace(
        'measures: string[] } }) => {',
        'measures: string[] } }): Promise<LegacyDatasetRows> => {',
      ),
    },
  })));
  red('TSO-R4 predicate 4 (narrowed-from-erased) false: concrete at the merge base', TSO_R4,
    [/predicate 4: narrowed-from-erased\] is FALSE/, /LegacyDatasetRows/, /#6048/]);
  assert(
    !/contradicts the changeset's own body/.test(TSO_R4.problems.map((p) => p.message).join('\n')),
    'TSO-R4b: the prescription exemption is PREDICATE-scoped, not body-scoped -- a `type-surface-only` ' +
    'claim that fails predicate 4 must be refused BY PREDICATE 4, never by the prescription refusal ' +
    'it is exempt from',
  );

  // TSO-R5: the exemption is scoped to this ONE category. The identical body
  // under `no-migration-prescription` still refuses -- nothing the detector
  // refuses today became claimable by the existence of a sixth category.
  red('TSO-R5 the exemption does not leak to `no-migration-prescription`',
    run(mk(TSO_FIXTURE({ marker: 'no-migration-prescription' }))),
    [/contradicts the changeset's own body/, /Evidence \(framed-table\)/]);

  // TSO-R6: still erased at HEAD. A surface that did not move off `any` narrowed
  // nothing, so there is nothing for this category to describe.
  red('TSO-R6 predicate 4: still unannotated at HEAD', run(mk({
    pkgs: TSO_PKGS,
    baseFiles: { 'packages/client/src/index.ts': TSO_BASE_CLIENT },
    files: { 'packages/client/src/index.ts': TSO_BASE_CLIENT.replace('return res.json();', 'return res.json(); // unchanged shape'), '.changeset/x.md': TSO_CS(`type-surface-only ${TSO_REF}`) },
  })), [/is false at HEAD/, /still UNANNOTATED/]);

  // TSO-R7: the path is NEW in this diff, so there is no base-side reading at
  // all. "Narrowed" is a claim about a surface that existed before; an absent
  // base side is no evidence, not weak evidence (#4690). This is the door a
  // decoy symbol would otherwise walk through.
  red('TSO-R7 predicate 4: a path this diff CREATES narrowed nothing', run(mk({
    pkgs: TSO_PKGS,
    files: { 'packages/client/src/index.ts': TSO_HEAD_CLIENT, '.changeset/x.md': TSO_CS(`type-surface-only ${TSO_REF}`) },
  })), [/does not exist at the merge\n      base/, /Refused rather than assumed/]);

  // ---- TSO-6048: THE REGRESSION PIN -- the founding case must never admit -----
  //
  // #6048 is what this whole gate was built for: it removed the `roles` member of
  // `ActorUser` and the ledger got nothing, with every gate green. The ONLY thing
  // holding that shape out today is the `no-migration-prescription` refusal --
  // `verifyRuntimeInterfaceOnly` accepts its symbol without a complaint -- and
  // `type-surface-only` is exempt from that refusal. So predicate 4 is the entire
  // guard, and this pin is the assertion that it holds.
  //
  // Built from the REAL symbol, in two layers, because a fixture that drifts from
  // the live shape is how this lane has been bitten before:
  //
  //   (a) a UNIT pin that reads `packages/runtime/src/security/actor-user.ts` out
  //       of THIS repo at HEAD and asserts predicate 4's own reader calls the real
  //       `ActorUser` CONCRETE. It cannot diverge from the tree, because it is the
  //       tree. If the file ever moves, this is a RED that says to re-anchor the
  //       pin -- never a silent skip (#4690).
  //   (b) a SCAN-level pin driving the full shipping `scan()` over a two-commit
  //       reconstruction of the #6048 diff, claiming this category.
  battery('TSO-6048: THE REGRESSION PIN -- the founding case must never admit');
  const REAL_ACTOR_USER = 'packages/runtime/src/security/actor-user.ts';
  let realActorUserText = null;
  try { realActorUserText = readFileSync(join(REPO_ROOT, REAL_ACTOR_USER), 'utf8'); } catch { /* reported below */ }
  assert(
    realActorUserText !== null,
    `TSO-6048a: the founding case's real symbol could not be read at ${REAL_ACTOR_USER}. ` +
    'Predicate 4 is the only guard holding the #6048 shape out of `type-surface-only`, and this pin ' +
    'is what proves it still does. A missing subject is a red, never a skip (#4690) -- re-anchor the ' +
    'pin at the path `ActorUser` moved to, in the PR that moves it.',
  );
  if (realActorUserText !== null) {
    const realRead = readDeclaredTypeSurface(realActorUserText, 'ActorUser');
    assert(
      realRead !== null && realRead.erased === false,
      'TSO-6048b: predicate 4 must read the REAL `ActorUser` as CONCRETE. It is an exported interface, ' +
      'and #6048 removed a member from it -- exactly the class the ledger DOES serve. Reading it as ' +
      `erased would hand the founding case a green exit (got: ${JSON.stringify(realRead)}).`,
    );
    // ...and it must read the MEMBERS. `#6048` removed a member; a reading that
    // answers with the symbol's own NAME is identical on both sides of that diff,
    // so predicate 4's before/after comparison and the message it prints would both
    // be describing something that cannot move (#15489).
    assert(
      realRead !== null && realRead.type !== null &&
        realRead.type.startsWith('{') && /\bpositions\b/.test(realRead.type) &&
        realRead.type !== 'ActorUser',
      'TSO-6048d: predicate 4 must read the REAL `ActorUser` as its declared MEMBER SURFACE -- the ' +
      'brace-balanced body, naming `positions` -- never the string `ActorUser`. The symbol name is ' +
      'the one part of an interface a member removal cannot change, so reading it is a comparison ' +
      `that always says "unchanged" (got type: ${JSON.stringify(realRead && realRead.type)}).`,
    );
  }
  // (b) the same fact, through the shipping scan(). The changeset is #6048's own
  // reconstructed body -- `迁移:FROM → TO` with a worked block -- claiming the one
  // category that is exempt from the refusal that body would otherwise trigger.
  const SIX048_TSO = CS({
    bumps: [['@objectstack/runtime', 'major']],
    body:
      '**BREAKING**: `ctx.user.roles` removed\n\n### 迁移:FROM → TO\n\n```js\n// FROM\nctx.user.roles;\n// TO\nctx.user.positions;\n```\n\n' +
      `<!-- adr-0087: not-required (type-surface-only packages/runtime/src/security/actor-user.ts#ActorUser) ${TSO_WHY} -->\n`,
  });
  const ACTOR_BASE =
    'export interface ActorUser extends EvalUser {\n  id: string;\n  roles: string[];\n  positions: string[];\n}\n';
  red('TSO-6048c THE FOUNDING CASE: #6048 claiming type-surface-only is refused by predicate 4', run(mk({
    pkgs: {
      '@objectstack/spec': { dir: 'packages/spec', private: false },
      '@objectstack/runtime': { dir: 'packages/runtime', private: false },
    },
    baseFiles: { 'packages/runtime/src/security/actor-user.ts': ACTOR_BASE },
    files: {
      'packages/runtime/src/security/actor-user.ts': ACTOR_BASE.replace('  roles: string[];\n', ''),
      '.changeset/tidy-donkeys-yawn.md': SIX048_TSO,
    },
  })), [/predicate 4: narrowed-from-erased\] is FALSE/, /exported `interface ActorUser`/, /#6048/, /register the migration/]);

  // ---- TSO-N: the predicate set is pinned BY NAME, never by count ------------
  //
  // A pin asserting "4 predicates were checked" goes green the moment one is
  // silently swapped for another, and this tree has catalogued instruments with
  // exactly that defect. Both halves are needed: the exported NAMES are the
  // contract, and the second assertion is what proves the exported list is the
  // list the shipping function actually evaluates rather than a decorative one.
  battery('TSO-N: the predicate set is pinned BY NAME, never by count');
  assert(
    JSON.stringify(TYPE_SURFACE_PREDICATES) ===
      JSON.stringify(['published', 'no-spec-diff', 'no-metadata-surface-diff', 'narrowed-from-erased']),
    `TSO-N1: the four predicates are pinned BY NAME. Got: ${JSON.stringify(TYPE_SURFACE_PREDICATES)}. ` +
    'Adding, removing or renaming one is a change to what the prescription exemption is bought with ' +
    '(ADR-0087, addendum 2026-08-30) -- change this pin in the same edit, deliberately.',
  );
  {
    const f = mk(TSO_FIXTURE());
    const seen = verifyTypeSurfaceOnly([TSO_REF], {
      base: f.base,
      head: 'HEAD',
      cwd: f.dir,
      bumps: [{ pkg: '@objectstack/client', bump: 'minor' }],
      packages: () => workspacePackagesAt('HEAD', f.dir),
      changedPaths: () => changedPathsBetween(f.base, 'HEAD', f.dir),
    });
    assert(seen.problems.length === 0, `TSO-N2a: the all-four-true fixture must verify clean, got:\n${seen.problems.join('\n')}`);
    assert(
      JSON.stringify(seen.checked) === JSON.stringify(TYPE_SURFACE_PREDICATES),
      'TSO-N2b: the predicates verifyTypeSurfaceOnly ACTUALLY evaluates must be exactly the exported ' +
      `TYPE_SURFACE_PREDICATES, in order. Got: ${JSON.stringify(seen.checked)}. A name that is exported ` +
      'but never evaluated is a predicate the ADR promises and the gate does not check.',
    );
  }

  // ---- TSO-U: unit pins on predicate 4's readers ------------------------------
  battery('TSO-U: unit pins on predicate 4\'s readers');
  assert(unwrapPromise('Promise<AnalyticsResult>') === 'AnalyticsResult', 'TSO-U1: a whole-string Promise unwraps');
  assert(unwrapPromise('Promise< any >') === 'any', 'TSO-U2: spacing does not defeat the unwrap');
  assert(unwrapPromise('Promise<any> | undefined') === null, 'TSO-U3: a Promise that is only PART of the type does not unwrap -- a greedy match here reads `any> | undefined` and is wrong in the ADMITTING direction');
  assert(unwrapPromise('AnalyticsResult') === null, 'TSO-U4: a non-Promise type does not unwrap');

  assert(isErasedType('any'), 'TSO-U5: `any` is erased');
  assert(isErasedType('unknown'), 'TSO-U6: `unknown` is erased');
  assert(isErasedType('Promise<any>'), 'TSO-U7: an awaited `any` is erased');
  assert(isErasedType(null), 'TSO-U8: NO annotation at all is the erasure this category is named for');
  assert(!isErasedType('AnalyticsResult'), 'TSO-U9: a named type is concrete');
  assert(!isErasedType('{ rows: any[] }'), 'TSO-U10: a type that CONTAINS `any` is not a type that IS `any` -- the same line check:exported-any-returns draws, and here the broader reading would refuse honest claims');

  assert(memberReturnAnnotation(TSO_BASE_CLIENT, 'queryDataset')?.annotation === null, 'TSO-U11: an UNANNOTATED member is found, and reports its missing annotation');
  assert(memberReturnAnnotation(TSO_HEAD_CLIENT, 'queryDataset')?.annotation === 'Promise<AnalyticsResult>', 'TSO-U12: an annotated arrow member reports its return type');
  assert(memberReturnAnnotation('export class C {\n  get(id: string): InstalledPackage {\n    return this.x;\n  }\n}\n', 'get')?.annotation === 'InstalledPackage', 'TSO-U13: the method-shorthand spelling is read too');
  assert(memberReturnAnnotation("const r = await client.analytics.queryDataset({ a: 1 });\n", 'queryDataset') === null, 'TSO-U14: a CALL SITE is not a declaration -- a leading dot is excluded, or every consumer of the method would read as one');
  assert(memberReturnAnnotation('export const f = async (a: string = ")"): Wrapped => a;\n', 'f')?.annotation === 'Wrapped', 'TSO-U15: a `)` inside a string default does not end the parameter list -- literals are masked before the bracket walk');

  assert(readDeclaredTypeSurface(ACTOR_BASE, 'ActorUser')?.erased === false, 'TSO-U16: an exported interface is CONCRETE -- the #6048 reading');
  assert(readDeclaredTypeSurface('export type Row = any;\n', 'Row')?.erased === true, 'TSO-U17: an exported `type X = any` alias is erased');
  assert(readDeclaredTypeSurface('export type Row = { a: string };\n', 'Row')?.erased === false, 'TSO-U18: an exported alias of a real type is concrete');
  assert(readDeclaredTypeSurface('export interface Other { a: 1 }\n', 'Missing') === null, 'TSO-U19: a symbol that is not there reads as null -- never as "it must have been erased"');

  // U20-U30 (#15489): the same readings asserted on `.type`. Until this row the
  // battery asserted `.erased` and nothing else, and `.erased` is the ONE field
  // both misreads left alone -- an `interface` is concrete whatever its body says,
  // and a truncated alias RHS is concrete for the same reason the whole one is. So
  // the gate reported `ExportFieldMeta` -> `ExportFieldMeta` across a commit that
  // removed eight of its members, printed that to an author in a live refusal, and
  // every case here stayed green.
  assert(readDeclaredTypeSurface(ACTOR_BASE, 'ActorUser')?.type === '{ id: string; roles: string[]; positions: string[]; }', 'TSO-U20: an exported interface reads as its declared MEMBER SURFACE -- the brace-balanced body -- never as the symbol name, which is identical on both sides of every diff');
  assert(readDeclaredTypeSurface('export class C {\n  a = 1;\n  b(): number { return 2; }\n}\n', 'C')?.type === '{ a = 1; b(): number { return 2; } }', 'TSO-U21: a `class` body is read the same way, nested braces included');
  assert(readDeclaredTypeSurface('export enum E {\n  A = 1,\n  B = 2,\n}\n', 'E')?.type === '{ A = 1, B = 2, }', 'TSO-U22: an `enum` body is read the same way');
  assert(readDeclaredTypeSurface('export type Row = {\n  a: string;\n  b: number;\n};\n', 'Row')?.type === '{ a: string; b: number; }', 'TSO-U23: a MULTI-LINE object alias survives the `;` that ends its FIRST member -- the lazy `([\\s\\S]*?);` this replaced stopped there and reported `{ a: string`');
  assert(readDeclaredTypeSurface("export type Sep = ';' | ',';\n", 'Sep')?.type === "';' | ','", 'TSO-U24: a `;` INSIDE a string literal does not terminate the RHS -- the walk is string-aware, and the literal\'s own text still reaches the surface');
  assert(readDeclaredTypeSurface('export type Box<T = string> = { value: T; tag: string };\n', 'Box')?.type === '{ value: T; tag: string }', 'TSO-U25: a GENERIC alias keeps its whole RHS, and the `=` of a type-parameter DEFAULT is not mistaken for the alias\'s own -- the parameter list is skipped by bracket matching, not by `(?:<[^=]*>)?`');
  assert(readDeclaredTypeSurface('export type Row = { a: string }\n\nexport const x = 1;\n', 'Row')?.type === '{ a: string }', 'TSO-U26: an alias with NO `;` ends at the END OF THE DECLARATION, not at the next `;` anywhere in the file -- over-reading into the following statement is the same defect pointing the other way');
  assert(readDeclaredTypeSurface('export interface Loose {\n  data: any;\n}\n', 'Loose')?.erased === false, 'TSO-U27: reading the BODY does not move `.erased` -- an interface whose members are `any` is still a CONCRETE declaration, the #6048 reading, and this category is about surfaces that moved OFF an erased type');
  assert(countSurfaceMembers('{ a: string; b: Record<string, number>; c: { d: 1; e: 2 } }') === 3, 'TSO-U28: members are counted at the TOP level only -- the separators inside a member\'s own type are not members');
  assert(countSurfaceMembers('AnalyticsResult') === null, 'TSO-U29: a surface that is not a brace body has no member count, and says so rather than guessing one');
  {
    const wide = `{ ${Array.from({ length: 40 }, (_, i) => `k${i}: string`).join('; ')} }`;
    const shown = printableSurface(wide);
    assert(
      shown.length < wide.length && shown.includes('…') && shown.includes('40 members') && shown.includes(`${wide.length} chars`) &&
      printableSurface('{ a: string }') === '{ a: string }',
      'TSO-U30: a long surface is truncated EXPLICITLY -- an ellipsis, the member count and the full ' +
      `length -- so an author can tell "long" from "all of it"; a short one is printed byte-identical. Got: ${JSON.stringify(shown)}`,
    );
  }

  // ---- TSO-D (#15627): a DOTTED member path, resolved through the nesting ---
  //
  // The grammar and the reader were widened in ONE commit, and this battery is
  // where that pairing is pinned. `packages/client/src/index.ts` declares `get` 14
  // times and `delete` 10 times, so `<path>#get` names the FIRST same-named
  // definition in the file -- a member PR #15445 and PR #15451 never touched --
  // while the members they DID narrow (`oauth.applications.get`,
  // `oauth.applications.delete`) had no addressable spelling at all. #15451's whole
  // category was closed by the grammar rather than by a judgement about the claim.
  //
  // ⛔ The dangerous repair is a wider GRAMMAR over the old first-same-name READER:
  // that reference is writable and wrong, which is strictly worse than the refusal
  // it replaces. TSO-D5/D6 are the pins that a dotted path reads the NESTED
  // definition, and TSO-D5 is the negative control that a BARE name still reads the
  // first one -- both halves, or neither proves anything.
  //
  // ⛔ And a line number is never the disambiguator: the two measurements on this
  // card, one day apart, disagree about every line number in that file.
  battery('TSO-D (#15627): a DOTTED member path resolves through the object-literal nesting');
  const DOT_CLIENT =
    'export class ObjectStackClient {\n' +
    '  packages = {\n' +
    '    get: async (name: string) => {\n' +
    "      const res = await this.fetch('/packages');\n" +
    '      return res.json();\n' +
    '    },\n' +
    '  };\n' +
    '\n' +
    '  oauth = {\n' +
    '    applications: {\n' +
    '      get: async (clientId: string): Promise<OAuthApplication> => {\n' +
    "        const res = await this.fetch('/oauth2/get-client');\n" +
    '        return res.json();\n' +
    '      },\n' +
    '      delete: async (clientId: string) => {\n' +
    "        const res = await this.fetch('/oauth2/delete-client');\n" +
    '        return res.json();\n' +
    '      },\n' +
    '    },\n' +
    '  };\n' +
    '\n' +
    '  organizations = {\n' +
    '    invitations: {\n' +
    '      list: async (): Promise<Invitation[]> => {\n' +
    "        const res = await this.fetch('/invitations');\n" +
    '        return res.json();\n' +
    '      },\n' +
    '    },\n' +
    '    teams: {\n' +
    '      list: async (): Promise<Team[]> => {\n' +
    "        const res = await this.fetch('/teams');\n" +
    '        return res.json();\n' +
    '      },\n' +
    '    },\n' +
    '  };\n' +
    '}\n';
  const readRef = (text, ref) => readTypeSurfaceRef(text, parseSymbolRef(ref));
  const DOT = (spelling) => `packages/client/src/index.ts#${spelling}`;

  // -- the grammar half -------------------------------------------------------
  assert(
    parseSymbolRef(DOT('oauth.applications.get'))?.segments.join('|') === 'oauth|applications|get',
    'TSO-D1: a dotted member path parses into its segments',
  );
  assert(
    parseSymbolRef(DOT('oauth.applications.get'))?.symbol === 'get' && parseSymbolRef(DOT('oauth.applications.get'))?.dotted === true,
    'TSO-D2: `symbol` stays the MEMBER name and `dotted` is set -- a caller that can only read a top-level declaration has to branch on it, never read `symbol` out of its nesting',
  );
  assert(
    parseSymbolRef(DOT('get'))?.dotted === false && parseSymbolRef(DOT('get'))?.symbol === 'get',
    'TSO-D3: a BARE identifier is unchanged -- every marker written before this widening keeps its exact previous meaning',
  );
  assert(
    parseSymbolRef(DOT('a..b')) === null && parseSymbolRef(DOT('a.')) === null && parseSymbolRef(DOT('.a')) === null,
    'TSO-D4: an empty segment is not a member path -- the widening is a dotted IDENT chain, not "anything with a dot in it"',
  );

  // -- the reader half: the nested definition, never the first same-named one --
  {
    const r = readRef(DOT_CLIENT, DOT('get'));
    assert(
      r.refusal === null && r.surface?.type === null && r.surface?.erased === true &&
      r.surface?.shape === '`get`, which carries NO return annotation',
      `TSO-D5: THE NEGATIVE CONTROL -- a BARE \`get\` still reads the FIRST definition in the file (\`packages.get\`, unannotated), NOT the annotated \`oauth.applications.get\` below it. If this moves, the widening silently changed what every marker written before it means. Got: ${JSON.stringify(r)}`,
    );
  }
  assert(
    readRef(DOT_CLIENT, DOT('oauth.applications.get')).surface?.type === 'Promise<OAuthApplication>',
    'TSO-D6: THE VICTIM -- the dotted path reads the NESTED definition, not the first same-named one the bare reference lands on',
  );
  assert(
    readRef(DOT_CLIENT, DOT('oauth.applications.get')).surface?.erased === false,
    'TSO-D7: ...and predicate 4 therefore reads it as CONCRETE at HEAD, which is the whole reading the grammar was blocking',
  );
  {
    const r = readRef(DOT_CLIENT, DOT('oauth.applications.delete'));
    assert(
      r.surface?.type === null && r.surface?.erased === true && r.surface?.shape.includes('`oauth.applications.delete`'),
      `TSO-D8: the #15451 member reads as UNANNOTATED and the verdict NAMES THE DOTTED SPELLING -- a message about \`delete\` when the marker said \`oauth.applications.delete\` is the reading this card was filed on. Got: ${JSON.stringify(r)}`,
    );
  }

  // -- any depth, and two same-named members under DIFFERENT parents (#14314) --
  assert(
    readRef(DOT_CLIENT, DOT('organizations.invitations.list')).surface?.type === 'Promise<Invitation[]>' &&
    readRef(DOT_CLIENT, DOT('organizations.teams.list')).surface?.type === 'Promise<Team[]>',
    'TSO-D9: two same-named members under DIFFERENT parents each resolve to their OWN definition -- this is not a special case for `oauth.applications.*`, and #14313 / #14314 bind exactly this shape',
  );

  // -- and the refusals, which are what make the widening sound ---------------
  {
    const r = readRef(DOT_CLIENT, DOT('oauth.applications.nosuch'));
    assert(
      r.surface === null && /no `nosuch` definition sits inside it/.test(r.refusal ?? ''),
      `TSO-D10: a member that does not exist under a RESOLVED parent is refused with a named finding, never resolved outward to a same-named member elsewhere. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const r = readRef(DOT_CLIENT, DOT('oauth.missing.get'));
    assert(
      r.surface === null && /no `missing` object literal/.test(r.refusal ?? '') && /inside `oauth`/.test(r.refusal ?? ''),
      `TSO-D11: a PARENT segment that does not exist is refused, and the message says which segment and where the walk was. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const twice = DOT_CLIENT.replace('  organizations = {', '  packages = {\n    list: async (): Promise<Row[]> => { return []; },\n  };\n\n  organizations = {');
    const r = readRef(twice, DOT('packages.get'));
    assert(
      r.surface === null && /AMBIGUOUS/.test(r.refusal ?? '') && /opens 2 object literals/.test(r.refusal ?? ''),
      `TSO-D12: a segment opening SEVERAL object literals is refused as AMBIGUOUS -- the real file opens three named \`packages\`, and picking one of them is the "writable but wrong" reference this widening exists to prevent. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const r = readRef(DOT_CLIENT, DOT('organizations.list'));
    assert(
      r.surface === null && /AMBIGUOUS/.test(r.refusal ?? '') && /2 `list` definitions/.test(r.refusal ?? ''),
      `TSO-D13: a member name that resolves to SEVERAL definitions inside the region is refused, with the count -- the fix is a deeper path, not a guess. Got: ${JSON.stringify(r)}`,
    );
  }

  // -- #16571: the LAST segment resolves at the region's TOP DEPTH ------------
  // Numbered after TSO-D17 but written HERE, against the two refusals they bound:
  // TSO-D12/D13 pin what must STILL be refused, TSO-D18..D23 pin what must now
  // RESOLVE and what must not have moved with it. Before this rule a DIRECT member
  // whose name recurs in a nested literal was counted against itself and told to
  // "name a deeper path" -- an instruction unsatisfiable at the depth it already
  // sits at. Measured on the real `packages/client/src/index.ts` at the fix:
  // 5 of #14314's 19 `organizations.*` refs went from refused to resolved, each to
  // its own annotation, and the other 14 did not move.
  // ⚠️ BOTH DIRECTIONS, in one battery. A one-direction pin cannot tell "fixed"
  // from "every spelling now lands on the same definition", so TSO-D20 asserts the
  // two readings are DIFFERENT, not merely that each is non-null.
  {
    // `organizations` now holds a DIRECT `create` and a nested `teams.create` --
    // the #14314 shape. `list` is left alone so TSO-D13 keeps its own fixture.
    const direct = DOT_CLIENT.replace(
      '    teams: {\n',
      '    create: async (): Promise<Organization> => {\n' +
      "      const res = await this.fetch('/organizations');\n" +
      '      return res.json();\n' +
      '    },\n' +
      '    teams: {\n' +
      '      create: async (): Promise<Team> => {\n' +
      "        const res = await this.fetch('/teams');\n" +
      '        return res.json();\n' +
      '      },\n',
    );
    const shallow = readRef(direct, DOT('organizations.create'));
    const deep = readRef(direct, DOT('organizations.teams.create'));
    assert(
      shallow.refusal === null && shallow.surface?.type === 'Promise<Organization>',
      `TSO-D18: a DIRECT member whose name recurs in a NESTED literal resolves to ITSELF -- before #16571 this was refused as AMBIGUOUS against \`organizations.teams.create\` and the printed remedy ("name a deeper path") could not be carried out, because the member already sits at the depth the path names. Got: ${JSON.stringify(shallow)}`,
    );
    assert(
      deep.refusal === null && deep.surface?.type === 'Promise<Team>',
      `TSO-D19: THE OTHER DIRECTION -- the nested spelling still reads the NESTED definition. The top-depth rule narrows what the SHALLOW path may name; it must take nothing away from the deeper one. Got: ${JSON.stringify(deep)}`,
    );
    assert(
      shallow.surface?.type !== deep.surface?.type,
      `TSO-D20: THE PIN THAT MAKES THE PAIR A READING -- the two spellings resolve to DIFFERENT definitions. Two green one-direction assertions are equally green when every path collapses onto one definition; this is the assertion that is not. Got: ${JSON.stringify([shallow, deep])}`,
    );
    {
      const r = readRef(direct, DOT('organizations.list'));
      assert(
        r.surface === null && /AMBIGUOUS/.test(r.refusal ?? '') && /2 `list` definitions/.test(r.refusal ?? ''),
        `TSO-D21: THE FIRING CONTROL -- on the SAME fixture, a name with NO top-depth definition and two nested ones is still refused with its count. The direct member resolves because the nested one stopped being a candidate for its path, ⛔ never because ties are now broken by position; if this ever resolves, the narrowing became "take the first". Got: ${JSON.stringify(r)}`,
      );
    }
    {
      const r = readRef(direct, DOT('organizations.nosuchmember'));
      assert(
        r.surface === null && /no `nosuchmember` definition sits inside it/.test(r.refusal ?? ''),
        `TSO-D22: THE NONSENSE CONTROL -- a member that exists at NO depth is still refused by the same named finding, so TSO-D18's green is a reading of the fixture and not of an unconditionally-resolving reader. Got: ${JSON.stringify(r)}`,
      );
    }
  }
  {
    // TWO definitions at `organizations`'s OWN depth: a class-field arrow and a
    // second property of the same name. No deeper path can tell them apart, so the
    // refusal must NOT print the deeper-path remedy #16571 was filed on.
    const twiceAtTop = DOT_CLIENT.replace(
      '    teams: {\n',
      '    create: async (): Promise<Organization> => { return {} as Organization; },\n' +
      '    create: async (): Promise<Team> => { return {} as Team; },\n' +
      '    teams: {\n',
    );
    const r = readRef(twiceAtTop, DOT('organizations.create'));
    assert(
      r.surface === null && /AMBIGUOUS/.test(r.refusal ?? '') && /2 `create` definitions sit at the TOP/.test(r.refusal ?? '') &&
      !/Name a deeper path/.test(r.refusal ?? ''),
      `TSO-D23: a collision at the path's OWN depth is still refused LOUDLY -- and the message no longer prescribes a deeper path, because there is none to write. An unsatisfiable remedy is the defect #16571 recorded; a silent pick of one of the two would be strictly worse than either. Got: ${JSON.stringify(r)}`,
    );
  }

  // -- end to end, through the shipping scan ----------------------------------
  const DOT_BASE = DOT_CLIENT.replace('(clientId: string): Promise<OAuthApplication> =>', '(clientId: string) =>');
  const DOT_BODY =
    'fix(client): bind the OAuth application reader, whose published type was `Promise< any >`\n\n' +
    '**BREAKING**: `any` is assignable to everything, so a consumer can stop compiling.\n\n' +
    '## Migration\n\n' +
    '| you wrote | write instead |\n| --- | --- |\n' +
    '| `(await client.oauth.applications.get(id)).client` | `(await client.oauth.applications.get(id)).clientId` |\n';
  const DOT_CS = (inParens) =>
    CS({ bumps: [['@objectstack/client', 'minor']], body: `${DOT_BODY}\n<!-- adr-0087: not-required (${inParens}) ${TSO_WHY} -->\n` });
  const DOT_FIXTURE = (marker) => ({
    pkgs: TSO_PKGS,
    baseFiles: { 'packages/client/src/index.ts': DOT_BASE },
    files: { 'packages/client/src/index.ts': DOT_CLIENT, '.changeset/x.md': DOT_CS(marker) },
  });

  green('TSO-D14 the #15451 shape, finally claimable: a dotted marker naming the member that actually narrowed',
    run(mk(DOT_FIXTURE(`type-surface-only ${DOT('oauth.applications.get')}`))));

  // The same diff, named BARELY: `packages.get` is first in the file, is untouched
  // by this diff and is still unannotated -- so the gate answers a TRUE sentence
  // about a member the diff never touched. That refusal is the defect, preserved
  // here as the reason the dotted spelling had to exist.
  red('TSO-D15 the bare spelling still lands on the FIRST same-named definition, which this diff never touched',
    run(mk(DOT_FIXTURE(`type-surface-only ${DOT('get')}`))), [/is still UNANNOTATED/]);

  red('TSO-D16 a dotted path that does not resolve is refused by predicate 4, never guessed at',
    run(mk(DOT_FIXTURE(`type-surface-only ${DOT('oauth.applications.nosuch')}`))),
    [/cannot be resolved at HEAD/, /no `nosuch` definition sits inside it/]);

  // TSO-D17: the widened grammar does NOT leak into the category that reads a
  // top-level type declaration. Refused BY NAME rather than silently read as its
  // last segment -- `a.PackagePublishResult` quietly becoming `PackagePublishResult`
  // is the same "writable but wrong" reference, one category over.
  red('TSO-D17 `runtime-interface-only` refuses a DOTTED path by name -- it reads a top-level type declaration, which has no nesting to walk',
    run(mk({
      pkgs: RIO_PKGS,
      files: {
        ...RIO_FILES,
        '.changeset/x.md': RIO_CS('runtime-interface-only packages/services/service-package/src/index.ts#outer.PackagePublishResult'),
      },
    })),
    [/a DOTTED member path/]);

  // ---- TSO-C (#17279): a DOTTED path resolves through a CLASS body ----------
  //
  // The RESIDUAL of #15627, left by its own fix. #15724 widened the grammar to a
  // dotted member path AND widened the reader to walk it -- but the reader walks
  // OBJECT-LITERAL nesting only, so a published narrowing on a CLASS method was
  // back in the state #15627 was filed about: nameable only BARELY, and a bare
  // name is the FIRST same-named definition in the file.
  //
  // Measured on `packages/objectql/src/engine.ts` (PR #17255, two members narrowed
  // on the exported class `ObjectRepository`):
  //   bare   `…/engine.ts#delete`                  -> `ObjectQL.delete`, a member the
  //                                                  diff never touched
  //   dotted `…/engine.ts#ObjectRepository.delete` -> "no `ObjectRepository` object
  //                                                  literal is declared"
  // Neither spelling could address the member, so the category the PR belonged to
  // was unclaimable BY the PR -- the #16571 failure class, one container kind over.
  //
  // ⚠️ The population was not zero when this landed: 10 of the 42 live
  // `type-surface-only` references in the tree already name a class member
  // (`SqlDriver` and `TursoDriver`, five each), every one of them written BARELY
  // and resolving only because that name happens to be unique in its file. TSO-C2
  // is the pin that those ten did not move.
  battery('TSO-C (#17279): a DOTTED member path resolves through a CLASS body');
  const CLS_ENGINE =
    'export class ObjectQL implements IObjectQLEngine {\n' +
    '  async findOne(objectName: string): Promise<EngineRow | null> {\n' +
    '    return null;\n' +
    '  }\n' +
    '\n' +
    '  helpers = {\n' +
    '    findOne: async (): Promise<HelperRow | null> => {\n' +
    '      return null;\n' +
    '    },\n' +
    '  };\n' +
    '}\n' +
    '\n' +
    'export class ObjectRepository implements IScopedObjectRepository {\n' +
    '  async findOne(query: any = {}): Promise<ScopedRow | null> {\n' +
    '    return null;\n' +
    '  }\n' +
    '}\n';
  const CLS = (spelling) => `packages/objectql/src/engine.ts#${spelling}`;

  // -- the reading the card could not write ----------------------------------
  {
    const r = readRef(CLS_ENGINE, CLS('ObjectRepository.findOne'));
    assert(
      r.refusal === null && r.surface?.type === 'Promise<ScopedRow | null>',
      `TSO-C1: THE CARD'S SHAPE -- a member on the SECOND same-named class resolves through its CLASS body. Before this it read "no \`ObjectRepository\` object literal is declared", and the member had no spelling at all. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const r = readRef(CLS_ENGINE, CLS('findOne'));
    assert(
      r.refusal === null && r.surface?.type === 'Promise<EngineRow | null>',
      `TSO-C2: THE NEGATIVE CONTROL -- a BARE \`findOne\` still reads the FIRST definition in the file (\`ObjectQL.findOne\`), NOT either of the two below it. Ten live references in the tree are exactly this spelling on a class member; if this moves, the widening silently changed what every one of them means. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const shallow = readRef(CLS_ENGINE, CLS('ObjectQL.findOne'));
    const deep = readRef(CLS_ENGINE, CLS('ObjectQL.helpers.findOne'));
    const other = readRef(CLS_ENGINE, CLS('ObjectRepository.findOne'));
    assert(
      shallow.refusal === null && shallow.surface?.type === 'Promise<EngineRow | null>',
      `TSO-C3: the #16571 TOP-DEPTH rule holds inside a CLASS body too -- \`ObjectQL.findOne\` is the class's OWN method, not the same-named one in the \`helpers\` literal nested in it. Got: ${JSON.stringify(shallow)}`,
    );
    assert(
      deep.refusal === null && deep.surface?.type === 'Promise<HelperRow | null>',
      `TSO-C4: THE OTHER DIRECTION -- a class segment followed by an object-literal segment reaches the NESTED member. The widening adds a container kind to the walk; it takes nothing away from the kind already walked. Got: ${JSON.stringify(deep)}`,
    );
    assert(
      new Set([shallow.surface?.type, deep.surface?.type, other.surface?.type]).size === 3,
      `TSO-C5: THE PIN THAT MAKES THE SET A READING -- the three spellings resolve to THREE DIFFERENT definitions. Three green one-direction assertions are equally green when every path collapses onto one definition; this is the assertion that is not. Got: ${JSON.stringify([shallow, deep, other])}`,
    );
  }

  // -- and the refusals, which are what keep the widening sound ---------------
  {
    const r = readRef(CLS_ENGINE, CLS('NoSuchClass.findOne'));
    assert(
      r.surface === null && /no `NoSuchClass` object literal or class/.test(r.refusal ?? '') &&
      /`class NoSuchClass \{`/.test(r.refusal ?? ''),
      `TSO-C6: a segment naming NEITHER container is refused, and the message names BOTH shapes the walk looked for -- an author told only about object literals cannot tell a missing class from an unsupported one. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const r = readRef(CLS_ENGINE, CLS('ObjectRepository.nosuch'));
    assert(
      r.surface === null && /no `nosuch` definition sits inside it/.test(r.refusal ?? ''),
      `TSO-C7: THE NONSENSE CONTROL -- a member absent from a RESOLVED class is still refused by name, never resolved outward to the same-named member on the other class. So TSO-C1's green is a reading of the fixture, not of an unconditionally-resolving reader. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const twoClasses = CLS_ENGINE + 'export class ObjectRepository {\n  async findOne(): Promise<Other> { return {} as Other; }\n}\n';
    const r = readRef(twoClasses, CLS('ObjectRepository.findOne'));
    assert(
      r.surface === null && /AMBIGUOUS/.test(r.refusal ?? '') && /opens 2 classes/.test(r.refusal ?? ''),
      `TSO-C8: two classes of the same name is AMBIGUOUS and the refusal counts them BY KIND -- the same rule TSO-D12 pins for object literals, on the container kind added here. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const both = 'const dual = {\n  findOne: async (): Promise<Lit> => { return {} as Lit; },\n};\n' +
      'export class dual {\n  async findOne(): Promise<Cls> { return {} as Cls; }\n}\n';
    const r = readRef(both, CLS('dual.findOne'));
    assert(
      r.surface === null && /AMBIGUOUS/.test(r.refusal ?? '') && /opens 2 object literals and class bodies/.test(r.refusal ?? ''),
      `TSO-C9: THE UNION PIN -- a segment naming one object literal AND one class is AMBIGUOUS. Counting the two kinds separately would let this through as "one of each", which is a silent pick between two real candidates. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const expr = 'const Boxed = class {\n  async findOne(): Promise<Boxed> { return {} as Boxed; }\n};\n';
    const r = readRef(expr, CLS('Boxed.findOne'));
    assert(
      r.surface === null && /no `Boxed` object literal or class/.test(r.refusal ?? ''),
      `TSO-C10: a CLASS EXPRESSION (\`const X = class { … }\`) is NOT walked -- that name belongs to the binding, not to the class, and reading it would be guessing at which of the two the segment meant. Refused, never guessed. Got: ${JSON.stringify(r)}`,
    );
  }
  {
    const generic = 'export abstract class Repo<T> extends Base<{ a: 1 }> implements IRepo<T> {\n' +
      '  async findOne(): Promise<T | null> { return null; }\n' +
      '}\n';
    const r = readRef(generic, CLS('Repo.findOne'));
    assert(
      r.refusal === null && r.surface?.type === 'Promise<T | null>',
      `TSO-C11: the BODY is located structurally -- \`abstract\`, \`extends Base<{ a: 1 }>\` and \`implements\` do not send the walk into a type argument's braces. Got: ${JSON.stringify(r)}`,
    );
  }

  // -- end to end, through the shipping scan ----------------------------------
  const CLS_BASE = CLS_ENGINE.replace('async findOne(query: any = {}): Promise<ScopedRow | null> {', 'async findOne(query: any = {}) {');
  const CLS_PKGS = {
    '@objectstack/spec': { dir: 'packages/spec', private: false },
    '@objectstack/objectql': { dir: 'packages/objectql', private: false },
  };
  const CLS_BODY =
    'fix(objectql): bind the scoped repository reader, whose published type was inferred\n\n' +
    '**BREAKING**: an unannotated method infers a wider type than the one it returns.\n\n' +
    '## Migration\n\n' +
    '| you wrote | write instead |\n| --- | --- |\n' +
    '| `(await repo.findOne(q)).id as string` | `(await repo.findOne(q))?.id` |\n';
  const CLS_FIXTURE = (marker) => ({
    pkgs: CLS_PKGS,
    baseFiles: { 'packages/objectql/src/engine.ts': CLS_BASE },
    files: {
      'packages/objectql/src/engine.ts': CLS_ENGINE,
      '.changeset/x.md': CS({ bumps: [['@objectstack/objectql', 'minor']], body: `${CLS_BODY}\n<!-- adr-0087: not-required (${marker}) ${TSO_WHY} -->\n` }),
    },
  });

  green('TSO-C12 the #17279 shape, finally claimable: a dotted marker naming the CLASS member that actually narrowed',
    run(mk(CLS_FIXTURE(`type-surface-only ${CLS('ObjectRepository.findOne')}`))));

  // The SAME diff named BARELY lands on `ObjectQL.findOne`, which this diff never
  // touches and which is already annotated -- a true sentence about the wrong
  // member. Preserved here as the reason the class walk had to exist.
  red('TSO-C13 the bare spelling on the same diff still lands on the FIRST same-named definition, which this diff never touched',
    run(mk(CLS_FIXTURE(`type-surface-only ${CLS('findOne')}`))),
    [/narrowed-from-erased/]);

  red('TSO-C14 a class segment that does not resolve is still refused by predicate 4, never guessed at',
    run(mk(CLS_FIXTURE(`type-surface-only ${CLS('NoSuchClass.findOne')}`))),
    [/cannot be resolved at HEAD/, /no `NoSuchClass` object literal or class/]);

  // ---- The #22918 category: `runtime-export-retired` -------------------------
  //
  // The fixture is the worked example in miniature: `@objectstack/plugin-email`
  // with the nine exports and the two `EmailServicePluginOptions` members it
  // retired, six of the nine reached through an `export *` (so predicate 1 is the
  // COMPILER's reading, not a text grep of the entry). The changeset text is the
  // worked example's own, VERBATIM -- lines 23-28 and 29-30 of
  // `.changeset/15205-email-templates-resolve-registry.md` at `7de0265fc` --
  // carried here rather than read from the tree, because the release that consumes
  // that changeset must not take this pin with it.
  battery('The #22918 category: `runtime-export-retired`');
  const REX_PKG = '@objectstack/plugin-email';
  const REX_DIR = 'packages/plugins/plugin-email';
  const rexPath = (rel) => `${REX_DIR}/${rel}`;
  const REX_PKGS = {
    '@objectstack/spec': { dir: 'packages/spec', private: false },
    '@objectstack/platform-objects': { dir: 'packages/platform-objects', private: false },
    [REX_PKG]: { dir: REX_DIR, private: false },
  };
  const REX_MANIFEST = (over = {}) => JSON.stringify({
    name: REX_PKG, version: '1.0.0', main: 'dist/index.js', types: 'dist/index.d.ts',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs', require: './dist/index.js' } },
    ...over,
  });
  const REX_PLUGIN_BASE =
    'export interface EmailServicePluginOptions {\n  transport?: string;\n  seedTemplates?: boolean;\n  templates?: unknown[];\n}\n' +
    'export class EmailServicePlugin {\n  constructor(readonly options: EmailServicePluginOptions = {}) {}\n}\n';
  const REX_PLUGIN_HEAD = REX_PLUGIN_BASE.replace('  seedTemplates?: boolean;\n  templates?: unknown[];\n', '');
  const REX_INDEX_BASE =
    "export { EmailServicePlugin } from './email-plugin.js';\n" +
    "export type { EmailServicePluginOptions } from './email-plugin.js';\n" +
    "export { LogTransport } from './log-transport.js';\n" +
    "export { createSysEmailTemplateLoader, type TemplateLoaderEngine, type CreateTemplateLoaderOptions } from './template-loader.js';\n" +
    "export * from './declared-templates.js';\n";
  const REX_INDEX_HEAD =
    "export { EmailServicePlugin } from './email-plugin.js';\n" +
    "export type { EmailServicePluginOptions } from './email-plugin.js';\n" +
    "export { LogTransport } from './log-transport.js';\n" +
    "export { createRegistryEmailTemplateLoader, type EmailTemplateRegistrySources } from './template-loader.js';\n";
  const REX_BASE_FILES = {
    [rexPath('package.json')]: REX_MANIFEST(),
    [rexPath('src/index.ts')]: REX_INDEX_BASE,
    [rexPath('src/email-plugin.ts')]: REX_PLUGIN_BASE,
    [rexPath('src/log-transport.ts')]: 'export class LogTransport {}\n',
    [rexPath('src/template-loader.ts')]:
      'export interface TemplateLoaderEngine { find(object: string): Promise<unknown[]> }\n' +
      'export interface CreateTemplateLoaderOptions { object?: string }\n' +
      'export function createSysEmailTemplateLoader(engine: TemplateLoaderEngine, options?: CreateTemplateLoaderOptions) {\n' +
      '  return { engine, options };\n}\n',
    [rexPath('src/declared-templates.ts')]:
      "export const EMAIL_TEMPLATE_OBJECT = 'sys_email_template';\n" +
      'export interface BootstrapDeclaredEmailTemplatesResult { written: number }\n' +
      'export function bootstrapDeclaredEmailTemplates(): BootstrapDeclaredEmailTemplatesResult { return { written: 0 }; }\n' +
      'export function upsertDeclaredEmailTemplate(): void {}\n' +
      'export function deactivateDeclaredEmailTemplate(): void {}\n' +
      'export function mapTemplateToRow(tpl: unknown) { return tpl; }\n',
    // A metadata surface, so predicate 2 has something to read (#4690) -- and its
    // docblock NAMES two retired exports in prose, as the real object does at the
    // worked example's base. Prose is not a reference (#12881).
    'packages/platform-objects/src/audit/sys-email-template.object.ts':
      '/** Rows `bootstrapDeclaredEmailTemplates` wrote and `createSysEmailTemplateLoader` read. */\n' +
      "export const SysEmailTemplate = { name: 'sys_email_template' };\n",
  };
  const REX_HEAD_FILES = {
    [rexPath('src/index.ts')]: REX_INDEX_HEAD,
    [rexPath('src/email-plugin.ts')]: REX_PLUGIN_HEAD,
    [rexPath('src/template-loader.ts')]:
      'export interface EmailTemplateRegistrySources { protocol?: unknown; registry?: unknown }\n' +
      'export function createRegistryEmailTemplateLoader(sources: EmailTemplateRegistrySources) {\n  return { sources };\n}\n',
    [rexPath('src/declared-templates.ts')]: null,
  };
  const REX_EXPORT_HALF = [
    '**What moves for consumers.**',
    '',
    '- FROM `createSysEmailTemplateLoader(engine, options?)` TO `createRegistryEmailTemplateLoader(sources)`, where `sources` is `{ protocol?, registry? }` (type `EmailTemplateRegistrySources`) or a function returning it. FROM the types `TemplateLoaderEngine` / `CreateTemplateLoaderOptions` TO `EmailTemplateRegistrySources`.',
    '- FROM `bootstrapDeclaredEmailTemplates(...)`, `upsertDeclaredEmailTemplate(...)` or `deactivateDeclaredEmailTemplate(...)` TO nothing: templates are not copied into rows any more. Delete the call.',
    '- FROM `mapTemplateToRow(tpl)` TO nothing: there is no row projection. To resolve a template the way the mailer does, call `createRegistryEmailTemplateLoader(...).load(name, locale)`.',
    "- FROM `EMAIL_TEMPLATE_OBJECT` TO the literal `'sys_email_template'`, only if you still address the legacy table. FROM the type `BootstrapDeclaredEmailTemplatesResult` TO nothing.",
  ].join('\n');
  const REX_OPTION_LINES = [
    '- FROM `new EmailServicePlugin({ seedTemplates: false })` TO `new EmailServicePlugin()`: there is no seed to switch off. Delete the option.',
    "- FROM `new EmailServicePlugin({ templates: [...] })` TO the stack's `emailTemplates: [...]` (or a `*.email-template.ts` file): declared templates resolve from the registry. Delete the option.",
  ].join('\n');
  const REX_CANONICAL_MEMBER_LINES = [
    '- FROM `EmailServicePluginOptions.seedTemplates` TO nothing: there is no seed to switch off. Delete the option.',
    "- FROM `EmailServicePluginOptions.templates` TO the stack's `emailTemplates: [...]`. Delete the option.",
  ].join('\n');
  const REX_NINE = [
    'createSysEmailTemplateLoader', 'TemplateLoaderEngine', 'CreateTemplateLoaderOptions',
    'bootstrapDeclaredEmailTemplates', 'upsertDeclaredEmailTemplate', 'deactivateDeclaredEmailTemplate',
    'mapTemplateToRow', 'EMAIL_TEMPLATE_OBJECT', 'BootstrapDeclaredEmailTemplatesResult',
  ];
  const REX_MEMBERS = ['EmailServicePluginOptions.seedTemplates', 'EmailServicePluginOptions.templates'];
  const REX_WHY =
    'the retired names are runtime exports of a published package; the compiler reports each at its ' +
    'consumer\'s import, and no stored shape moves';
  const REX_CS = (operands, body, category = 'runtime-export-retired') => CS({
    bumps: [[REX_PKG, 'minor']],
    body:
      'feat(plugin-email)!: templates resolve from the registry\n\n**BREAKING**: retired exports.\n\n' +
      `${body}\n\n<!-- adr-0087: not-required (${category}${operands.map((o) => ` ${REX_PKG}#${o}`).join(',')}) ${REX_WHY} -->\n`,
  });
  const REX_FIXTURE = (operands, body, over = {}) => ({
    pkgs: over.pkgs ?? REX_PKGS,
    baseFiles: { ...REX_BASE_FILES, ...(over.baseFiles ?? {}) },
    files: { ...REX_HEAD_FILES, '.changeset/x.md': REX_CS(operands, body, over.category), ...(over.files ?? {}) },
  });
  const messages = (res) => res.problems.map((p) => p.message).join('\n');

  // REX-G1: THE WORKED EXAMPLE'S EXPORT HALF, under the new marker -- the ruled
  // acceptance case. Six of the nine are reached only through `export *`, so the
  // detail line naming `declared-templates.ts` is the compiler's reading of it.
  const rexG1 = run(mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF)));
  green('REX-G1 the worked example\'s EXPORT HALF (its lines 25-28) is admitted under `runtime-export-retired`', rexG1);
  assert(
    rexG1.judged[0]?.category === 'runtime-export-retired' &&
      /mapTemplateToRow \(export, packages\/plugins\/plugin-email\/src\/declared-templates\.ts\)/.test(rexG1.judged[0]?.detail ?? ''),
    'REX-G1b: the verdict must name each operand\'s DECLARATION as the compiler resolved it -- `mapTemplateToRow` ' +
    `is reached only through \`export *\`. Got: ${JSON.stringify(rexG1.judged[0])}`,
  );
  assert(rexG1.needsExportReader === false, 'REX-G1c: a process that HAS the export reader judges the claim in one scan');

  // REX-R1: a still-present export. Everything else true; predicate 1 alone refuses.
  const rexR1 = run(mk(REX_FIXTURE([...REX_NINE, 'LogTransport'], `${REX_EXPORT_HALF}\n- FROM \`LogTransport\` TO nothing.`)));
  red('REX-R1 a STILL-PRESENT export is refused by predicate 1', rexR1,
    [/predicate 1: retired-from-entry\] is false: `LogTransport` is STILL exported/]);
  assert(rexR1.problems.length === 1, `REX-R1b: only the still-present operand is refused (got ${rexR1.problems.length}):\n${messages(rexR1)}`);

  // REX-R2: a `*.zod.ts` symbol. Retired from the entry like the rest, so predicate
  // 1 holds -- and predicate 2 refuses it on its declaration site.
  red('REX-R2 a `*.zod.ts` symbol is refused by predicate 2', run(mk(REX_FIXTURE(
    [...REX_NINE, 'EmailTemplateRowSchema'],
    `${REX_EXPORT_HALF}\n- FROM \`EmailTemplateRowSchema\` TO nothing.`,
    {
      baseFiles: {
        [rexPath('src/index.ts')]: `${REX_INDEX_BASE}export { EmailTemplateRowSchema } from './template.zod.js';\n`,
        [rexPath('src/template.zod.ts')]: 'export const EmailTemplateRowSchema = { shape: {} };\n',
      },
    },
  ))), [/predicate 2: no-metadata-surface\] is false: `EmailTemplateRowSchema` is declared in .*template\.zod\.ts \(a Zod schema\)/]);

  // REX-R3: a FROM operand outside the named set, both ways it arrives: a name the
  // marker left out, and the worked example's own lines 29-30, which name the
  // still-exported `EmailServicePlugin` -- the ruling's example, verbatim.
  red('REX-R3a a FROM operand the marker does not name is refused as out of range', run(mk(REX_FIXTURE(
    REX_NINE.filter((n) => n !== 'EMAIL_TEMPLATE_OBJECT'), REX_EXPORT_HALF,
  ))), [/FROM operand `EMAIL_TEMPLATE_OBJECT` names `EMAIL_TEMPLATE_OBJECT`, which the marker does not name -- out of range/]);
  red('REX-R3b the worked example in FULL: its lines 29-30 name `EmailServicePlugin`, out of range', run(mk(REX_FIXTURE(
    REX_NINE, `${REX_EXPORT_HALF}\n${REX_OPTION_LINES}`,
  ))), [/`new EmailServicePlugin\(\{ seedTemplates: false \}\)` names `EmailServicePlugin`, which the marker does not name -- out of range/]);

  // REX-R4: a non-canonical member spelling. The marker names the two members
  // canonically; the body writes them as constructor arguments, which are never
  // parsed -- so the FROM side is out of range AND the members have no FROM side.
  red('REX-R4a members written as constructor arguments are not canonical member operands', run(mk(REX_FIXTURE(
    [...REX_NINE, ...REX_MEMBERS], `${REX_EXPORT_HALF}\n${REX_OPTION_LINES}`,
  ))), [/names `EmailServicePlugin`, which the marker does not name/, /`@objectstack\/plugin-email#EmailServicePluginOptions\.seedTemplates` has no FROM side/]);
  red('REX-R4b a member spelled more than one level deep in the marker is refused by its grammar', run(mk(REX_FIXTURE(
    [...REX_NINE, 'EmailServicePluginOptions.seedTemplates.enabled'], REX_EXPORT_HALF,
  ))), [/operand "@objectstack\/plugin-email#EmailServicePluginOptions\.seedTemplates\.enabled" spells a member 2 levels deep/]);

  // REX-G2: the member limb, spelled canonically -- the reason it exists.
  green('REX-G2 the retired members, spelled `<Type>.<member>`, are admitted beside the nine exports', run(mk(REX_FIXTURE(
    [...REX_NINE, ...REX_MEMBERS], `${REX_EXPORT_HALF}\n${REX_CANONICAL_MEMBER_LINES}`,
  ))));

  // REX-R5: an unmappable package is refused by name, never guessed.
  red('REX-R5a an entry that is not tsup\'s `dist/index.d.ts` is refused, not guessed', run(mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF, {
    baseFiles: { [rexPath('package.json')]: REX_MANIFEST({ types: 'dist/main.d.ts', exports: { '.': { types: './dist/main.d.ts' } } }) },
  }))), [/cannot be mapped to its source/, /names `dist\/main\.d\.ts`/, /never guessed/]);
  red('REX-R5b a package with no types entry at all is refused, not guessed', run(mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF, {
    baseFiles: { [rexPath('package.json')]: JSON.stringify({ name: REX_PKG, version: '1.0.0', exports: { '.': './dist/index.js' } }) },
  }))), [/cannot be mapped to its source/, /names no types entry/]);

  // REX-R6: the marker names nothing.
  red('REX-R6 a marker naming no operand is refused', run(mk(REX_FIXTURE([], REX_EXPORT_HALF))),
    [/`not-required \(runtime-export-retired\)` names no operand/]);

  // REX-R7: "exactly" is both directions -- a named operand with no FROM side.
  red('REX-R7 a named operand with NO FROM side is refused: the block names exactly the named set', run(mk(REX_FIXTURE(
    REX_NINE, REX_EXPORT_HALF.split('\n').slice(0, -1).join('\n'),
  ))), [/`@objectstack\/plugin-email#EMAIL_TEMPLATE_OBJECT` has no FROM side/, /BootstrapDeclaredEmailTemplatesResult` has no FROM side/]);

  // REX-R8: a prescription this category does not read keeps the inherited refusal.
  red('REX-R8a a framed rewrite table with no FROM column is still the detector\'s, and refused', run(mk(REX_FIXTURE(
    REX_NINE, `${REX_EXPORT_HALF}\n\n## Migration\n\n| before | after |\n| --- | --- |\n| \`sys_email_template.locale\` | \`email_template.locale\` |\n`,
  ))), [/still carries a migration prescription/, /framed-table/]);
  red('REX-R8b a vertical FROM / TO pair is reported, never skipped', run(mk(REX_FIXTURE(
    REX_NINE, `${REX_EXPORT_HALF}\n\n- **FROM:** \`mapTemplateToRow(tpl)\`\n- **TO:** nothing\n`,
  ))), [/carries a vertical FROM \/ TO pair, which this category does not read/]);

  // REX-G3: the convention's own label above the block is a label, not a refusal.
  green('REX-G3 a `## FROM → TO` heading above the block it introduces is admitted', run(mk(REX_FIXTURE(
    REX_NINE, `## FROM → TO\n\n${REX_EXPORT_HALF}`,
  ))));

  // REX-R9..R13: predicates 1-2 refuse each of the other ways a claim can be false.
  red('REX-R9 a PRIVATE package has no published entry', run(mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF, {
    pkgs: { ...REX_PKGS, [REX_PKG]: { dir: REX_DIR, private: true } },
    baseFiles: { [rexPath('package.json')]: REX_MANIFEST({ private: true }) },
  }))), [/is PRIVATE/, /not-required \(unpublished\)/]);
  red('REX-R10 a metadata surface that IMPORTS the export refuses it (predicate 2)', run(mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF, {
    baseFiles: {
      'packages/spec/src/email/email-row.zod.ts':
        `import { mapTemplateToRow } from '${REX_PKG}';\nexport const EmailRowSchema = mapTemplateToRow({});\n`,
    },
  }))), [/predicate 2: no-metadata-surface\] is false: packages\/spec\/src\/email\/email-row\.zod\.ts \(a Zod schema\) IMPORTS `mapTemplateToRow`/]);
  // REX-G4 / REX-R10b (#25293): the same predicate, END TO END, on a spec contract.
  // A contract METHOD SIGNATURE of the retired export's name is a homonym; a bare
  // call of it in the same contract file is not.
  const REX_CONTRACT = 'packages/spec/src/contracts/email-service.ts';
  green('REX-G4 #25293: a contract method signature of the same name clears predicate 2', run(mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF, {
    baseFiles: { [REX_CONTRACT]: 'export interface IEmailService {\n  mapTemplateToRow(input: unknown): Promise<unknown>;\n}\n' },
  }))));
  red('REX-R10b #25293: a bare call in a contract still refuses predicate 2, beside the signature', run(mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF, {
    baseFiles: { [REX_CONTRACT]: 'export interface IEmailService {\n  mapTemplateToRow(input: unknown): Promise<unknown>;\n}\nexport const ROW = mapTemplateToRow({});\n' },
  }))), [/predicate 2: no-metadata-surface\] is false: packages\/spec\/src\/contracts\/email-service\.ts \(a spec contracts\/\*\* entry\) mentions `mapTemplateToRow` IN CODE/, /export const ROW = mapTemplateToRow\(\{\}\);/]);
  red('REX-R11 a member still present at HEAD is refused (predicate 1)', run(mk(REX_FIXTURE(
    [...REX_NINE, REX_MEMBERS[0]], `${REX_EXPORT_HALF}\n${REX_CANONICAL_MEMBER_LINES.split('\n')[0]}`,
    { files: { [rexPath('src/email-plugin.ts')]: REX_PLUGIN_BASE } },
  ))), [/`EmailServicePluginOptions` still has a member `seedTemplates` at HEAD/]);
  red('REX-R12 a member of a type that is itself gone at HEAD is named as the export, not through the member', run(mk(REX_FIXTURE(
    [...REX_NINE, REX_MEMBERS[0]], `${REX_EXPORT_HALF}\n${REX_CANONICAL_MEMBER_LINES.split('\n')[0]}`,
    { files: { [rexPath('src/index.ts')]: REX_INDEX_HEAD.replace("export type { EmailServicePluginOptions } from './email-plugin.js';\n", '') } },
  ))), [/the type `EmailServicePluginOptions` itself is no longer exported at HEAD/]);
  red('REX-R13 an `export *` the reader cannot follow refuses an absence claim at HEAD', run(mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF, {
    files: { [rexPath('src/index.ts')]: `${REX_INDEX_HEAD}export * from '@objectstack/core';\n` },
  }))), [/cannot be proven: absence at HEAD/, /export \* from '@objectstack\/core'/]);

  // REX-C: the catch-all is UNCHANGED. The merged worked example is not re-graded,
  // and the detector's arrow rule was kept: the same body under
  // `no-migration-prescription` reads exactly as it did before this category.
  green('REX-C the worked example\'s own disposition is unchanged: the catch-all still reads no arrowless line',
    run(mk(REX_FIXTURE([], `${REX_EXPORT_HALF}\n${REX_OPTION_LINES}`, { category: 'no-migration-prescription' }))));

  // ---- REX-N: the predicate set is pinned BY NAME, never by count ------------
  battery('REX-N: the predicate set is pinned BY NAME, never by count');
  assert(
    JSON.stringify(RUNTIME_EXPORT_PREDICATES) ===
      JSON.stringify(['retired-from-entry', 'no-metadata-surface', 'from-operands-named']),
    `REX-N1: the three predicates are pinned BY NAME. Got: ${JSON.stringify(RUNTIME_EXPORT_PREDICATES)}. ` +
    'Changing one changes what the seventh category rests on (ADR-0087, addendum 2026-10-12) -- change this pin deliberately.',
  );
  {
    const f = mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF));
    const seen = verifyRuntimeExportRetired(REX_NINE.map((n) => `${REX_PKG}#${n}`), {
      base: f.base, head: 'HEAD', cwd: f.dir, body: REX_EXPORT_HALF, packagesAt: (rev) => workspacePackagesAt(rev, f.dir),
    });
    assert(seen.problems.length === 0, `REX-N2a: the all-true fixture must verify clean, got:\n${seen.problems.join('\n')}`);
    assert(
      JSON.stringify(seen.checked) === JSON.stringify(RUNTIME_EXPORT_PREDICATES),
      'REX-N2b: the predicates verifyRuntimeExportRetired ACTUALLY evaluates must be exactly the exported ' +
      `RUNTIME_EXPORT_PREDICATES, in order. Got: ${JSON.stringify(seen.checked)}.`,
    );
  }

  // ---- REX-U: unit pins on the operand grammar and the FROM-side reader ------
  battery('REX-U: unit pins on the operand grammar and the FROM-side reader');
  {
    const op = parseExportOperand(`${REX_PKG}#mapTemplateToRow`);
    assert(op.pkg === REX_PKG && op.exportName === 'mapTemplateToRow' && op.member === null, `REX-U1: an export operand parses (${JSON.stringify(op)})`);
    const mem = parseExportOperand(`${REX_PKG}#EmailServicePluginOptions.seedTemplates`);
    assert(mem.exportName === 'EmailServicePluginOptions' && mem.member === 'seedTemplates', `REX-U2: a member operand parses (${JSON.stringify(mem)})`);
    assert(/names a FILE/.test(parseExportOperand(`${rexPath('src/index.ts')}#mapTemplateToRow`).refusal ?? ''),
      'REX-U3: a `<path>#<Symbol>` operand -- the D7 spelling -- is refused with the reason: this category names the PACKAGE');
    assert(/2 levels deep/.test(parseExportOperand(`${REX_PKG}#A.b.c`).refusal ?? ''), 'REX-U4: a member path deeper than `<Type>.<member>` is refused');
    assert(parseExportOperand('mapTemplateToRow').refusal !== undefined, 'REX-U5: a bare name, with no package, is refused');
  }
  const canon = (t, want, label) => assert(canonicalFromOperand(t) === want, `${label}: canonicalFromOperand(${JSON.stringify(t)}) = ${JSON.stringify(canonicalFromOperand(t))}, want ${JSON.stringify(want)}`);
  canon('createSysEmailTemplateLoader(engine, options?)', 'createSysEmailTemplateLoader', 'REX-U6 a CALL names the function it calls');
  canon('new EmailServicePlugin({ seedTemplates: false })', 'EmailServicePlugin', 'REX-U7 THE RULING\'S LINE: `new X({ option })` names `X`, never the option -- the argument list is not read');
  canon('EmailServicePluginOptions.seedTemplates', 'EmailServicePluginOptions.seedTemplates', 'REX-U8 the canonical member spelling');
  canon('bootstrapDeclaredEmailTemplates(...)', 'bootstrapDeclaredEmailTemplates', 'REX-U9 an elided argument list');
  canon("import { organizationIdForMetaWrite } from '@objectstack/metadata-core'", null, 'REX-U10 an import statement is not canonical');
  canon("'sys_email_template'", null, 'REX-U11 a literal is not an operand');
  canon('a.b.c', null, 'REX-U12 a path deeper than `<Type>.<member>` is not canonical');
  canon('mapTemplateToRow(tpl).load', null, 'REX-U13 a member of a CALL\'s result is not canonical');
  canon('new', null, 'REX-U14 the keyword alone names nothing');
  {
    const line25 = REX_EXPORT_HALF.split('\n')[2];
    const r25 = readFromBlock(line25);
    assert(JSON.stringify(r25.sides.map((s) => s.spelling)) === JSON.stringify(['createSysEmailTemplateLoader', 'TemplateLoaderEngine', 'CreateTemplateLoaderOptions']),
      `REX-U15: one line, two FROM ... TO segments, three operands -- the TO sides are never read (got ${JSON.stringify(r25.sides.map((s) => s.spelling))})`);
    const mention = readFromBlock('The body does carry a FROM → TO block for the retired runtime exports and plugin options.');
    assert(mention.sides.length === 0 && mention.unread.length === 0 && mention.residual === null,
      `REX-U16: the bare placeholder MENTIONED in prose (the worked example's own marker sentence) is neither a side nor a refusal (${JSON.stringify(mention)})`);
    assert(/naming no operand/.test(readFromBlock('- FROM the old loader TO the new one').unread[0]?.shape ?? ''),
      'REX-U17: a FROM ... TO line that OPENS its line and names no operand is reported -- a prescription naming nothing');
    assert(readFromBlock('each FROM names an export and each TO its replacement').unread.length === 0,
      'REX-U18: the two words inside a running sentence are a mention, not a segment');
    const removal = readFromBlock('- `mapTemplateToRow` → delete the call');
    assert(removal.sides[0]?.spelling === 'mapTemplateToRow' && removal.residual === null,
      `REX-U19: an arrow REMOVAL (\`X -> delete\`) is read, and leaves nothing for the detector (${JSON.stringify(removal)})`);
    const table = readFromBlock('| FROM | TO |\n| --- | --- |\n| `mapTemplateToRow(tpl)` | nothing |\n');
    assert(table.sides[0]?.spelling === 'mapTemplateToRow' && table.residual === null && table.unread.length === 0,
      `REX-U20: a \`| FROM | TO |\` table is read from its FROM column, and its header is no residue (${JSON.stringify(table)})`);
    const wrote = readFromBlock('| Wrote | Write instead |\n| --- | --- |\n| `a.b` | `a.c` |\n');
    assert(wrote.sides[0]?.spelling === 'a.b', `REX-U21: a header-framed table is read from its OLD column (${JSON.stringify(wrote.sides)})`);
    const framed = readFromBlock('## Migration\n\n| before | after |\n| --- | --- |\n| `a.b` | `a.c` |\n');
    assert(framed.sides.length === 0 && framed.residual?.branch === 'framed-table',
      `REX-U22: a framed table with no FROM column is not read, and the detector's refusal stands (${JSON.stringify(framed)})`);
    const label = readFromBlock('## FROM → TO\n\n- FROM `a` TO `b`\n\n| Member | Behaviour |\n| --- | --- |\n| `x.y` | `z.w` |\n');
    assert(/over a rewrite table row/.test(label.residual?.branch ?? ''),
      `REX-U23: a FROM → TO label judges the WHOLE body, as branch 1 does -- an unread rewrite row anywhere refuses (${JSON.stringify(label.residual)})`);
    assert(readFromBlock('run `SELECT x FROM t TO y` here').sides.length === 0,
      'REX-U24: the two words inside a code span are not convention tokens');
  }

  // ---- REX-L: the compiler is paid for only by a run that needs it ----------
  battery('REX-L: the compiler is loaded only when a marker names the category');
  {
    // (1) A bare import of the gate loads no `typescript`; the loader does. In a
    // CHILD, because this process loaded it before the self-test began.
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', [
      "import { createRequire } from 'node:module';",
      `const g = await import(${JSON.stringify(import.meta.url)});`,
      'const req = createRequire(import.meta.url);',
      "const loaded = () => Object.keys(req.cache).some((k) => /[\\\\/]typescript[\\\\/]lib[\\\\/]typescript\\.js$/.test(k));",
      'const before = loaded();',
      'await g.loadExportReader();',
      'console.log(JSON.stringify({ before, after: loaded() }));',
    ].join('\n')], { cwd: REPO_ROOT, encoding: 'utf8' });
    const seen = (() => { try { return JSON.parse(probe.stdout.trim().split('\n').pop()); } catch { return null; } })();
    assert(seen?.before === false, `REX-L1: importing the gate must not load \`typescript\` (got ${probe.stdout}${probe.stderr})`);
    assert(seen?.after === true, `REX-L2: loadExportReader() must load it -- the positive control for L1 (got ${probe.stdout}${probe.stderr})`);
    // (2) The handshake: a scan without the kit reports itself, never passes.
    const kit = exportReaderKit;
    exportReaderKit = null;
    let unloaded;
    try { unloaded = run(mk(REX_FIXTURE(REX_NINE, REX_EXPORT_HALF))); } finally { exportReaderKit = kit; }
    red('REX-L3 a scan without the export reader is RED and asks for it', unloaded, [/export reader \(the\s+TypeScript compiler\) is loaded on demand and was not/]);
    assert(unloaded.needsExportReader === true, 'REX-L4: ...and sets `needsExportReader`, which is what makes the entry point load and re-scan');
    assert(rexR1.needsExportReader === false && run(mk({ files: {} })).needsExportReader === false,
      'REX-L5: a scan with the reader loaded, or with no such marker, never asks for it');
  }

  // ---- WS (#26220): a ui workspace package, read through the workspace file --
  //
  // The gate's package globs are the rev's own `pnpm-workspace.yaml`, so an
  // `@object-ui/*` package under `ui/packages/*` has a manifest here like any
  // other. And its export reader compiles `.tsx`: the ui entries re-export from
  // `.tsx` modules -- directly, through an alias, and through a `.ts` shim -- and
  // without the `jsx` option every such module failed to resolve (TS6142), so
  // predicate 2 could not locate a single declaration behind one.
  battery('WS (#26220): ui workspace packages, `.tsx` modules, aliases and shims');
  {
    const UI_PKG = '@object-ui/app-shell';
    const UI_DIR = 'ui/packages/app-shell';
    const uiPath = (rel) => `${UI_DIR}/${rel}`;
    const UI_PKGS = {
      '@objectstack/spec': { dir: 'packages/spec', private: false },
      '@objectstack/platform-objects': { dir: 'packages/platform-objects', private: false },
      '@object-ui/console': { dir: 'ui/apps/console', private: true },
    };
    const UI_INDEX_HEAD = "export { AppShell } from './AppShell.js';\n";
    const UI_BASE_FILES = {
      [uiPath('package.json')]: JSON.stringify({
        name: UI_PKG, version: '1.0.0', types: 'dist/index.d.ts',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' } },
      }),
      [uiPath('src/index.ts')]:
        `${UI_INDEX_HEAD}` +
        "export { useExpressionContext } from './providers/ExpressionProvider.js';\n" +
        "export { PageShell as MetadataPageShell } from './views/PageShell.js';\n" +
        "export type { RecentItemInput } from './hooks/useRecentItems.js';\n",
      [uiPath('src/AppShell.tsx')]: 'export const AppShell = () => <div className="shell" />;\n',
      [uiPath('src/providers/ExpressionProvider.tsx')]:
        'export function useExpressionContext() {\n  return <span>{1}</span>;\n}\n',
      [uiPath('src/views/PageShell.tsx')]: 'export function PageShell() {\n  return <main />;\n}\n',
      [uiPath('src/hooks/useRecentItems.ts')]:
        "export { useRecentItems, type RecentItemInput } from '../context/RecentItemsProvider.js';\n",
      [uiPath('src/context/RecentItemsProvider.tsx')]:
        'export interface RecentItemInput { id: string }\nexport function useRecentItems() {\n  return <ul />;\n}\n',
      'packages/platform-objects/src/audit/sys-email-template.object.ts':
        "export const SysEmailTemplate = { name: 'sys_email_template' };\n",
    };
    const UI_OPERANDS = ['useExpressionContext', 'MetadataPageShell', 'RecentItemInput'];
    const UI_CS = CS({
      bumps: [[UI_PKG, 'patch']],
      body:
        'refactor(app-shell)!: retire three root-entry exports\n\n**BREAKING**: retired exports.\n\n' +
        UI_OPERANDS.map((o) => `- FROM \`${o}\` TO nothing: delete the import.`).join('\n') +
        `\n\n<!-- adr-0087: not-required (runtime-export-retired${UI_OPERANDS.map((o) => ` ${UI_PKG}#${o}`).join(',')}) ` +
        'the retired names are runtime exports; the compiler reports each at its importer, and no stored shape moves -->\n',
    });
    const UI_FIXTURE = (over = {}) => ({
      pkgs: UI_PKGS,
      baseFiles: UI_BASE_FILES,
      files: { [uiPath('src/index.ts')]: UI_INDEX_HEAD, '.changeset/x.md': UI_CS },
      ...over,
    });

    const wsG1 = run(mk(UI_FIXTURE()));
    green('WS-G1 a `ui/packages/*` package retires a `.tsx` export, an alias of one and a type behind a `.ts` shim', wsG1);
    const detail = wsG1.judged[0]?.detail ?? '';
    assert(
      /useExpressionContext \(export, ui\/packages\/app-shell\/src\/providers\/ExpressionProvider\.tsx\)/.test(detail) &&
        /MetadataPageShell \(export, ui\/packages\/app-shell\/src\/views\/PageShell\.tsx\)/.test(detail) &&
        /RecentItemInput \(export, ui\/packages\/app-shell\/src\/context\/RecentItemsProvider\.tsx\)/.test(detail),
      'WS-G1b: predicate 2 must locate each declaration where the compiler resolves it -- the `.tsx` module, ' +
      `the ALIASED declaration, and the module BEHIND the shim. Got: ${detail}`,
    );

    // The membership comes from the workspace file and nowhere else: the same tree
    // with the `ui/packages/*` glob dropped has no manifest named the package.
    red('WS-R1 a package whose directory no workspace glob names has no workspace manifest', run(mk(UI_FIXTURE({
      workspace: WORKSPACE_YAML.replace('  - ui/packages/*\n', ''),
    }))), [/no workspace manifest at [0-9a-f]{12} is named `@object-ui\/app-shell`/]);

    let thrown = null;
    try { run(mk(UI_FIXTURE({ workspace: null }))); } catch (e) { thrown = e; }
    assert(thrown instanceof WorkspaceEnumerationError && /pnpm-workspace\.yaml at [0-9a-f]{12} is missing/.test(thrown.message),
      `WS-R2: a rev with no workspace file is REFUSED, never read as an empty workspace (got ${thrown?.message ?? 'no throw'})`);

    green('WS-G2 `unpublished` on a private `ui/apps/*` package', run(mk({
      pkgs: UI_PKGS,
      files: {
        '.changeset/x.md': CS({
          bumps: [['@object-ui/console', 'major']],
          body: '**BREAKING** x\n\n<!-- adr-0087: not-required (unpublished) the console app is private and publishes to no registry -->\n',
        }),
      },
    })));

    const GLOBS = ['packages/*', 'ui', 'ui/packages/*'];
    assert(isWorkspaceManifest('ui/packages/app-shell/package.json', GLOBS), 'WS-U1: `<dir>/*` names a directory directly under `<dir>`');
    assert(isWorkspaceManifest('ui/package.json', GLOBS), 'WS-U2: a bare `<dir>` glob names that directory itself');
    assert(!isWorkspaceManifest('ui/packages/app-shell/test/fixture/package.json', GLOBS),
      'WS-U3: a manifest nested below a member is not a member -- a fixture package.json cannot shadow a real one');
    assert(!isWorkspaceManifest('ui/node_modules/x/package.json', ['ui/*']) && !isWorkspaceManifest('ui/.cache/package.json', ['ui/*']),
      'WS-U4: `node_modules` and dot-directories are never members (the enumerator\'s rule)');
    let rich = null;
    const richDir = mk({ files: {}, workspace: 'packages:\n  - packages/**\n' }).dir;
    try { workspaceGlobsAt('HEAD', richDir); } catch (e) { rich = e; }
    assert(rich instanceof WorkspaceEnumerationError && /richer than/.test(rich.message),
      `WS-U5: a glob richer than \`<dir>\` / \`<dir>/*\` is refused, never matched against nothing (got ${rich?.message ?? 'no throw'})`);
  }

  // ---- IX (#26220): the 2026-10-27 amendments, predicate 4 and the entry -----
  //
  // Two limbs the maintainer's decision A put in ADR-0087 before any code here:
  // D8's predicate 4 reads an `any` INDEX SIGNATURE inside a concrete declaration
  // (#26293's `ComponentRendererProps`), and D9's entry mapping reads ONE source
  // entry, `src/index.ts` or `src/index.tsx` (21 of 38 published ui packages build
  // from the `.tsx`). Every green here has a red beside it that differs in the one
  // thing the limb must not admit.
  battery('IX (#26220): predicate 4 reads an `any` index signature; the entry may be `src/index.tsx`');
  {
    const IX_PKGS = {
      '@objectstack/spec': { dir: 'packages/spec', private: false },
      '@object-ui/types': { dir: 'ui/packages/types', private: false },
    };
    const IX_PATH = 'ui/packages/types/src/base.ts';
    const IX_REF = `${IX_PATH}#ComponentRendererProps`;
    const IX_BASE = 'export interface ComponentRendererProps<TSchema = unknown> {\n  schema: TSchema;\n  [key: string]: any;\n}\n';
    const IX_HEAD = IX_BASE.replace('[key: string]: any;', '[key: string]: unknown;');
    const IX_CS = (ref = IX_REF) => CS({
      bumps: [['@object-ui/types', 'minor']],
      body: 'refactor(types)!: forwarded renderer props are `unknown`\n\n**BREAKING**: narrow a forwarded key before use.\n\n' +
        `<!-- adr-0087: not-required (type-surface-only ${ref}) ${TSO_WHY} -->\n`,
    });
    const ix = (base, head, ref = IX_REF) => run(mk({
      pkgs: IX_PKGS,
      baseFiles: { [IX_PATH]: base },
      files: { [IX_PATH]: head, '.changeset/x.md': IX_CS(ref) },
    }));
    const P4_FALSE = /predicate 4: narrowed-from-erased\] is FALSE/;

    const g1 = ix(IX_BASE, IX_HEAD);
    green('IX-G1 THE #26293 SHAPE: an `any` index signature becomes `unknown`, every other member and the heritage unchanged', g1);
    assert(/ComponentRendererProps \(\[key: string\]: any -> \[key: string\]: unknown\)/.test(g1.judged[0]?.detail ?? ''),
      `IX-G1b: the verdict names the index signature that moved, both sides. Got: ${g1.judged[0]?.detail}`);
    green('IX-G2 an object-literal `type` alias, `readonly` index signature, narrowed to a concrete type', ix(
      'export type ComponentRendererProps = { id: string; readonly [k: string]: any };\n',
      'export type ComponentRendererProps = { id: string; readonly [k: string]: string };\n',
    ));

    red('IX-R1 a member REMOVED beside the narrowed index signature (the #6048 class)', ix(
      IX_BASE, IX_HEAD.replace('  schema: TSchema;\n', ''),
    ), [P4_FALSE, /#6048/, /index-signature limb .* does not hold either: the member count moved \(2 -> 1\)/]);
    red('IX-R2 a member RE-TYPED beside it', ix(IX_BASE, IX_HEAD.replace('schema: TSchema;', 'schema: string;')),
      [P4_FALSE, /member 1 moved \(`schema: TSchema` -> `schema: string`\)/]);
    red('IX-R3 a member made OPTIONAL beside it', ix(IX_BASE, IX_HEAD.replace('schema: TSchema;', 'schema?: TSchema;')),
      [P4_FALSE, /member 1 moved/]);
    red('IX-R4 the HERITAGE moved: a type-parameter default changed', ix(IX_BASE, IX_HEAD.replace('<TSchema = unknown>', '<TSchema = object>')),
      [P4_FALSE, /heritage moved/]);
    red('IX-R5 an `extends` clause added', ix(IX_BASE, IX_HEAD.replace('<TSchema = unknown> {', '<TSchema = unknown> extends Base {')),
      [P4_FALSE, /heritage moved/]);
    red('IX-R6 the base index signature was NOT `any`: a concrete value type re-typed is no narrowing off erased', ix(
      IX_BASE.replace('[key: string]: any;', '[key: string]: string;'), IX_HEAD.replace('[key: string]: unknown;', '[key: string]: number;'),
    ), [P4_FALSE, /member 2 moved/]);
    red('IX-R7 base index signature `unknown` (not `any`) is outside the limb', ix(
      IX_BASE.replace('[key: string]: any;', '[key: string]: unknown;'), IX_HEAD.replace('[key: string]: unknown;', '[key: string]: string;'),
    ), [P4_FALSE, /member 2 moved/]);
    red('IX-R8 still `any` at HEAD: nothing narrowed', ix(IX_BASE, `${IX_BASE}// touched\n`),
      [P4_FALSE, /still `any` at HEAD/]);
    red('IX-R9 the KEY of the index signature moved with it', ix(IX_BASE, IX_HEAD.replace('[key: string]', '[key: number]')),
      [P4_FALSE, /member 2 moved/]);
    red('IX-R10 a `type` alias that is an INTERSECTION is not the shape the limb reads', ix(
      'export type ComponentRendererProps = { id: string; [k: string]: any } & Base;\n',
      'export type ComponentRendererProps = { id: string; [k: string]: unknown } & Base;\n',
    ), [P4_FALSE, /reads only an exported `interface`, or a `type` alias whose right-hand side is one object type literal/]);
    red('IX-R11 a NESTED `any` index signature is a member re-typed, never a top-level one (the `=>` is not a closer)', ix(
      'export interface ComponentRendererProps {\n  meta: { cb: () => void; [k: string]: any; };\n}\n',
      'export interface ComponentRendererProps {\n  meta: { cb: () => void; [k: string]: unknown; };\n}\n',
    ), [P4_FALSE, /member 1 moved/]);
    red('IX-R12 a DOTTED member path keeps reading a return annotation alone', ix(
      'export class Registry {\n  props(): { [k: string]: any } {\n    return {};\n  }\n}\n',
      'export class Registry {\n  props(): { [k: string]: unknown } {\n    return {};\n  }\n}\n',
      `${IX_PATH}#Registry.props`,
    ), [P4_FALSE, /does not apply to a dotted member path/]);

    assert(readIndexSignature('readonly [k: string]: any')?.value === 'any' && readIndexSignature('[key: string]: unknown')?.key === '[key: string]',
      'IX-U1: an index signature reads as its key part and value type, `readonly` kept in the key');
    assert(readIndexSignature('[P in Keys]: string') === null && readIndexSignature('[Symbol.iterator](): Iterator<T>') === null,
      'IX-U2: a mapped type and a computed member name are not index signatures');
    assert(JSON.stringify(structuralDeclarationParts(IX_BASE, 'ComponentRendererProps')) ===
      JSON.stringify({ kind: 'interface', heritage: '<TSchema = unknown>', members: ['schema: TSchema', '[key: string]: any'] }),
    `IX-U3: the parts the limb compares (got ${JSON.stringify(structuralDeclarationParts(IX_BASE, 'ComponentRendererProps'))})`);
    assert(indexSignatureLimb(ACTOR_BASE, ACTOR_BASE.replace('  roles: string[];\n', ''), 'ActorUser').ok === false,
      'IX-U4: THE #6048 SHAPE fails the limb -- it has no `any` index signature and it lost a member');

    // D9: the entry is `src/index.tsx`.
    const TX_PKG = '@object-ui/plugin-x';
    const txPath = (rel) => `ui/packages/plugin-x/${rel}`;
    const TX_INDEX_HEAD = "export { Widget } from './Widget.js';\n";
    const TX_BASE = {
      [txPath('package.json')]: JSON.stringify({
        name: TX_PKG, version: '1.0.0', types: 'dist/index.d.ts',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' } },
      }),
      [txPath('src/index.tsx')]: `${TX_INDEX_HEAD}export { Gone } from './Gone.js';\nexport const Root = () => <div />;\n`,
      [txPath('src/Widget.tsx')]: 'export const Widget = () => <span />;\n',
      [txPath('src/Gone.tsx')]: 'export function Gone() {\n  return <p />;\n}\n',
      'packages/platform-objects/src/audit/sys-email-template.object.ts': "export const SysEmailTemplate = { name: 'sys_email_template' };\n",
    };
    const TX_CS = CS({
      bumps: [[TX_PKG, 'minor']],
      body: 'refactor(plugin-x)!: retire `Gone`\n\n**BREAKING**: retired export.\n\n- FROM `Gone` TO nothing: delete the import.\n\n' +
        `<!-- adr-0087: not-required (runtime-export-retired ${TX_PKG}#Gone) a React component; the compiler reports it at its importer, and no stored shape names it -->\n`,
    });
    const tx = (baseOver = {}, headOver = {}) => run(mk({
      pkgs: { '@objectstack/spec': { dir: 'packages/spec', private: false } },
      baseFiles: { ...TX_BASE, ...baseOver },
      files: { [txPath('src/index.tsx')]: `${TX_INDEX_HEAD}export const Root = () => <div />;\n`, '.changeset/x.md': TX_CS, ...headOver },
    }));
    const t1 = tx();
    green('IX-T1 a package whose ONE source entry is `src/index.tsx` (the vite-plugin-dts shape) retires an export', t1);
    assert(/Gone \(export, ui\/packages\/plugin-x\/src\/Gone\.tsx\)/.test(t1.judged[0]?.detail ?? ''),
      `IX-T1b: the export is read through the \`.tsx\` entry to its declaration. Got: ${t1.judged[0]?.detail}`);
    // The `.ts` twin exports the same names, so a reader that silently PICKED one
    // would read a clean retirement here: only the ambiguity refusal holds it red.
    const TX_TWIN_BASE = `${TX_INDEX_HEAD}export { Gone } from './Gone.js';\n`;
    red('IX-T2 BOTH `src/index.ts` and `src/index.tsx`: ambiguous, refused rather than picked', tx(
      { [txPath('src/index.ts')]: TX_TWIN_BASE },
      { [txPath('src/index.ts')]: TX_INDEX_HEAD },
    ), [/published entry of `@object-ui\/plugin-x` is AMBIGUOUS/, /BOTH ui\/packages\/plugin-x\/src\/index\.ts and ui\/packages\/plugin-x\/src\/index\.tsx/]);
    red('IX-T3 NEITHER source entry: unmappable, by name', tx(
      { [txPath('src/main.tsx')]: TX_BASE[txPath('src/index.tsx')] },
      { [txPath('src/index.tsx')]: null, [txPath('src/main.tsx')]: `${TX_INDEX_HEAD}export const Root = () => <div />;\n` },
    ), [/cannot be mapped to its source/, /neither ui\/packages\/plugin-x\/src\/index\.ts nor ui\/packages\/plugin-x\/src\/index\.tsx exists there/]);
  }

  // ---- WP (#26220): a deleted published package is retired WHOLE ------------
  //
  // D9, amended 2026-10-27 (ruling A on PR #26365, comment 6439038287): when a
  // published package is deleted at HEAD the operand is the package itself,
  // `<package>#*`. Predicate 1 is proven about the package -- a published member at
  // the merge base, absent from the workspace at HEAD (no `package.json`, not in
  // `pnpm-workspace.yaml`, not in the changesets fixed group) -- predicate 2 asks the
  // package, and the FROM -> TO block names it on one line. Every red differs from
  // WP-G1 in the one thing the clause must not admit.
  battery('WP (#26220): a deleted published package is retired whole, `<package>#*`');
  {
    const WP_PKG = '@object-ui/plugin-x';
    const wpPath = (rel) => `ui/packages/plugin-x/${rel}`;
    const WP_MANIFEST = (over = {}) => JSON.stringify({
      name: WP_PKG, version: '1.0.0', types: 'dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' } }, ...over,
    });
    const WP_CONFIG = (names) => `${JSON.stringify({ fixed: [['@objectstack/spec', ...names]] }, null, 2)}\n`;
    const WP_BASE = {
      [wpPath('package.json')]: WP_MANIFEST(),
      [wpPath('src/index.tsx')]: "export { Widget } from './Widget.js';\n",
      [wpPath('src/Widget.tsx')]: 'export const Widget = () => <span />;\n',
      '.changeset/config.json': WP_CONFIG([WP_PKG]),
      'packages/platform-objects/src/audit/sys-email-template.object.ts': "export const SysEmailTemplate = { name: 'sys_email_template' };\n",
    };
    // Deleted the way PR #26365 deletes `@object-ui/plugin-ai`: the directory goes,
    // and the name leaves the fixed group.
    const WP_GONE = {
      [wpPath('package.json')]: null, [wpPath('src/index.tsx')]: null, [wpPath('src/Widget.tsx')]: null,
      '.changeset/config.json': WP_CONFIG([]),
    };
    const WP_LINE = `- FROM \`${WP_PKG}\` TO nothing: the package is deleted; drop the dependency and its imports.`;
    const WP_CS = (lines = WP_LINE, operands = `${WP_PKG}#*`) => CS({
      bumps: [['@objectstack/spec', 'minor']],
      body: `refactor(ui)!: retire \`${WP_PKG}\`\n\n**BREAKING**: the package is deleted.\n\n${lines}\n\n` +
        `<!-- adr-0087: not-required (runtime-export-retired ${operands}) a deleted ui package; the compiler reports it at its importer, and no stored shape names it -->\n`,
    });
    const wp = ({ base = {}, head = {}, cs = WP_CS(), workspace = WORKSPACE_YAML } = {}) => run(mk({
      pkgs: { '@objectstack/spec': { dir: 'packages/spec', private: false } },
      baseFiles: { ...WP_BASE, ...base },
      files: { ...WP_GONE, ...head, '.changeset/x.md': cs },
      workspace,
    }));
    const P1 = /`runtime-export-retired @object-ui\/plugin-x#\*` \[predicate 1: retired-from-entry\] is not proven/;
    const P2 = /`runtime-export-retired @object-ui\/plugin-x#\*` \[predicate 2: no-metadata-surface\] is false/;

    const g1 = wp();
    green('WP-G1 THE #26365 SHAPE: a published `ui/packages/*` package deleted at HEAD, out of the fixed group, one FROM line', g1);
    assert(/@object-ui\/plugin-x#\* \(package, ui\/packages\/plugin-x\/package\.json\)/.test(g1.judged[0]?.detail ?? ''),
      `WP-G1b: the verdict names the package operand and the manifest it was proven from. Got: ${g1.judged[0]?.detail}`);
    green('WP-G2 the one line written as an arrow removal', wp({ cs: WP_CS(`- \`${WP_PKG}\` → delete the dependency and its imports`) }));
    green('WP-G3 a metadata surface that names the package only in a COMMENT does not import it', wp({
      base: { 'packages/spec/src/ui/widget.zod.ts': `// once rendered by '${WP_PKG}'\n/** import { Widget } from '${WP_PKG}'; */\nexport const W = 1;\n` },
    }));

    red('WP-R1 deleted, but STILL in the changesets fixed group', wp({ head: { '.changeset/config.json': WP_CONFIG([WP_PKG]) } }),
      [P1, /\.changeset\/config\.json still lists it in a `fixed` group/]);
    red('WP-R2 never PUBLISHED at the merge base (`private: true`)', wp({ base: { [wpPath('package.json')]: WP_MANIFEST({ private: true }) } }),
      [P1, /was never published: it is PRIVATE \(`private: true` in ui\/packages\/plugin-x\/package\.json\)/]);
    red('WP-R3 not a workspace member at the merge base', wp({ workspace: WORKSPACE_YAML.replace('  - ui/packages/*\n', '') }),
      [P1, /is not in the workspace at the merge base/]);
    red('WP-R4 NOT deleted: the manifest is still there at HEAD', wp({ head: { ...WP_BASE } }),
      [P1, /ui\/packages\/plugin-x\/package\.json still exists/, /still lists it in a `fixed` group/]);
    red('WP-R5 MOVED, not deleted: another directory carries the name at HEAD', wp({ head: { 'ui/packages/plugin-y/package.json': WP_MANIFEST() } }),
      [P1, /a workspace manifest at HEAD is still named it \(ui\/packages\/plugin-y\/package\.json\)/]);
    red('WP-R6 `pnpm-workspace.yaml` still names the directory at HEAD', wp({ head: { [WORKSPACE_FILE]: `${WORKSPACE_YAML}  - ui/packages/plugin-x\n` } }),
      [P1, /pnpm-workspace\.yaml still names its directory, `ui\/packages\/plugin-x`/]);
    red('WP-R7 no changesets config at HEAD: the fixed group is unreadable, never read as empty', wp({ head: { '.changeset/config.json': null } }),
      [P1, /\.changeset\/config\.json is missing at HEAD/]);
    red('WP-R8 a package with no mappable published entry at the merge base', wp({ base: { [wpPath('package.json')]: JSON.stringify({ name: WP_PKG, version: '1.0.0' }) } }),
      [P1, /has no published entry this gate can read at the merge base/, /cannot be mapped to its source/]);
    red('WP-R9 the package carries a metadata surface at the merge base', wp({
      base: { [wpPath('src/widget.zod.ts')]: 'export const WidgetSchema = {};\n' }, head: { [wpPath('src/widget.zod.ts')]: null },
    }), [P2, /carries ui\/packages\/plugin-x\/src\/widget\.zod\.ts \(a Zod schema\)/]);
    red('WP-R10 a metadata surface OUTSIDE the package imports it at the merge base', wp({
      base: { 'packages/spec/src/ui/widget.zod.ts': `import { Widget } from '${WP_PKG}';\nexport const W = Widget;\n` },
    }), [P2, /packages\/spec\/src\/ui\/widget\.zod\.ts \(a Zod schema\) IMPORTS `@object-ui\/plugin-x`/]);
    red('WP-R14 a metadata surface OUTSIDE the package names it as a string VALUE (no import) at the merge base', wp({
      base: { 'packages/platform-objects/src/ui/widget-host.object.ts': `export const WidgetHost = { name: 'widget_host', plugin: '${WP_PKG}' };\n` },
    }), [P2, /packages\/platform-objects\/src\/ui\/widget-host\.object\.ts \(an object definition\) names `@object-ui\/plugin-x` IN CODE/,
      /plugin: '@object-ui\/plugin-x'/]);
    red('WP-R11 no FROM line names the package', wp({ cs: WP_CS('Nothing else to do.') }),
      [/the named operand `@object-ui\/plugin-x#\*` has no FROM side/, /- FROM `@object-ui\/plugin-x` TO/]);
    red('WP-R12 one FROM line per EXPORT instead of the package line', wp({ cs: WP_CS('- FROM `Widget` TO nothing: delete the import.') }),
      [/names `Widget`, which the marker does not name -- out of range/, /named on ONE FROM line, by the package name/,
        /`@object-ui\/plugin-x#\*` has no FROM side/]);
    red('WP-R13 an EXPORT operand on the deleted package points at the whole-package spelling', wp({
      cs: WP_CS('- FROM `Widget` TO nothing: delete the import.', `${WP_PKG}#Widget`),
    }), [/cannot be read at HEAD/, /retired whole, on one operand: `@object-ui\/plugin-x#\*`/]);

    const whole = parseExportOperand(`${WP_PKG}#*`);
    assert(whole.whole === true && whole.pkg === WP_PKG && whole.spelling === WP_PKG && whole.exportName === null,
      `WP-U1: \`<package>#*\` parses as a WHOLE package whose spelling is the package name (${JSON.stringify(whole)})`);
    assert(parseExportOperand('#*').refusal !== undefined && parseExportOperand(`${WP_PKG}#**`).refusal !== undefined,
      'WP-U2: `#*` with no package, and `**`, are refused');
    const texts = new Map([
      ['packages/spec/src/a.zod.ts', `export { X } from '${WP_PKG}/sub';\n`],
      ['packages/spec/src/b.zod.ts', "import { X } from '@object-ui/plugin-xy';\n"],
      ['ui/packages/plugin-x/src/c.zod.ts', `import '${WP_PKG}';\n`],
    ]);
    const u3 = packageReference(WP_PKG, 'ui/packages/plugin-x', texts);
    assert(u3?.hitPath === 'packages/spec/src/a.zod.ts' && u3.kind === 'import',
      `WP-U3: a SUBPATH import is an import of the package; the package's own files are skipped (${JSON.stringify(u3)})`);
    assert(packageReference(WP_PKG, 'ui/packages/plugin-x', new Map([...texts].slice(1))) === null,
      'WP-U4: a package whose name merely STARTS with the name (`plugin-xy`) is not the package');
    const u5 = packageReference(WP_PKG, 'ui/packages/plugin-x', new Map([
      ['packages/spec/src/c.zod.ts', `// '${WP_PKG}' in a comment\nexport const C = { from: 'x' };\n`],
      ['packages/spec/src/d.zod.ts', `export const D = { plugin: '${WP_PKG}' };\n`],
    ]));
    assert(u5?.kind === 'mention' && u5.hitPath === 'packages/spec/src/d.zod.ts' && u5.line === `export const D = { plugin: '${WP_PKG}' };`,
      `WP-U5: a string VALUE naming the package is a reference in code, reported with its line; a comment is not (${JSON.stringify(u5)})`);
  }

  // ---- G6: a changeset that was ALREADY breaking at base is inherited -------
  battery('G6: a changeset that was ALREADY breaking at base is inherited');
  {
    const r = mk({ files: {} });
    // modify the stock breaking changeset -- it was breaking at base, so it is not
    // this PR's declaration to answer for.
    writeFileSync(join(r.dir, '.changeset/stock-breaking.md'), CS({ body: 'stock\n\n**BREAKING** something, now with more prose\n' }));
    git(['commit', '-qam', 'touch stock'], r.dir);
    green('G6 inherited breaking changeset not re-judged', run(r));
  }

  // ---- The `R` rows (#7045) -------------------------------------------------
  //
  // `--diff-filter=AM` -- what this gate passed until #7045 -- drops an `R` row
  // wholesale, so R15 below was GREEN with an undisposed breaking declaration
  // sitting in the diff. Both cases carry a CONTROL asserting that git really
  // emitted `R`: rename detection is a SIMILARITY score, and a short body degrades
  // to add-plus-delete, at which point R15 is an ordinary `A` case that would have
  // been caught before the fix too -- green for a reason that is not the fix.
  const RENAMEABLE_BODY =
    'a summary line, with a body long enough that git scores the move below as a\n' +
    'rename rather than as an add plus a delete. The `R` status is the entire\n' +
    'subject of these two cases, so the fixture may not be allowed to degrade.\n';
  /** The `R` row for `old -> new` in this repo's diff, or null. */
  const renameRow = (dir, base, oldPath, newPath) =>
    git(['diff', '--name-status', base, 'HEAD', '--', '.changeset/*.md'], dir)
      .split('\n')
      .find((l) => new RegExp(`^R\\d+\t${oldPath}\t${newPath}$`).test(l)) ?? null;

  // ---- R15: a changeset RENAMED AND turned breaking in the same commit ------
  // The #7045 shape, and R1's own shape with a `git mv` bolted on: a declaration
  // this PR introduces, arriving at a path that did not exist at the branch point,
  // saying nothing about the ledger.
  battery('R15: a changeset RENAMED AND turned breaking in the same commit');
  {
    const r = mk({
      baseFiles: { '.changeset/pending.md': CS({ bumps: [['@objectstack/spec', 'patch']], body: RENAMEABLE_BODY }) },
      files: {
        '.changeset/pending.md': null,
        '.changeset/pending-renamed.md': CS({ bumps: [['@objectstack/spec', 'major']], body: `**BREAKING** ${RENAMEABLE_BODY}` }),
      },
    });
    assert(
      renameRow(r.dir, r.base, '\\.changeset/pending\\.md', '\\.changeset/pending-renamed\\.md') !== null,
      `R15 control: git must really report this as \`R\`, or the case below is an ordinary \`A\` -- got ${JSON.stringify(git(['diff', '--name-status', r.base, 'HEAD', '--', '.changeset/*.md'], r.dir))}`,
    );
    red('R15 the #7045 shape (renamed AND turned breaking, no disposition)', run(r), [
      /pending-renamed/,
      /no `adr-0087:` disposition marker/,
      /#6148/,
    ]);
  }

  // ---- G10: a PURE rename of an ALREADY-breaking stock changeset ------------
  // The paired control, and the reason `AMR` costs nothing: the declaration was
  // already at the branch point, so moving the file asks nobody to dispose of it
  // again. This case can only be green through the `R` path -- were the rename to
  // degrade to add-plus-delete the new path would arrive as `A`, and `A` never
  // reads the base side at all, so it would be RED.
  battery('G10: a PURE rename of an ALREADY-breaking stock changeset');
  {
    const r = mk({ files: {} });
    git(['mv', '.changeset/stock-breaking.md', '.changeset/stock-breaking-moved.md'], r.dir);
    git(['commit', '-qm', 'move the stock changeset'], r.dir);
    assert(
      renameRow(r.dir, r.base, '\\.changeset/stock-breaking\\.md', '\\.changeset/stock-breaking-moved\\.md') !== null,
      'G10 control: git must really report the move as `R`',
    );
    const res = run(r);
    green('G10 a pure move of an inherited breaking changeset is not re-judged', res);
    assert(
      res.skipped.includes('.changeset/stock-breaking-moved.md'),
      `G10: ...and it is reported as SKIPPED at its new path, not silently absent -- got ${JSON.stringify(res.skipped)}`,
    );
  }

  // ---- R16: an `R` row whose BASE side is README.md inherits NOTHING --------
  // Git pairs renames by CONTENT, not by name, so an `R` row can arrive as
  // `.changeset/README.md -> .changeset/x.md` (measured, git 2.43.0). README is
  // documentation and declares nothing, so reading "already breaking at base" off
  // it would exempt a genuinely new breaking changeset. Delete the
  // `isChangesetFile(basePath)` guard in the scan and this case goes green.
  battery('R16: an `R` row whose BASE side is README.md inherits NOTHING');
  {
    const BREAKING_README = `# Changesets\n\n**BREAKING** ${RENAMEABLE_BODY}`;
    const r = mk({
      baseFiles: { '.changeset/README.md': BREAKING_README },
      files: {
        '.changeset/README.md': null,
        '.changeset/was-the-readme.md': `---\n'@objectstack/spec': major\n---\n\n${BREAKING_README}`,
      },
    });
    assert(
      renameRow(r.dir, r.base, '\\.changeset/README\\.md', '\\.changeset/was-the-readme\\.md') !== null,
      `R16 control: git must really pair the new changeset with README.md -- got ${JSON.stringify(git(['diff', '--name-status', r.base, 'HEAD', '--', '.changeset/*.md'], r.dir))}`,
    );
    red('R16 a breaking changeset paired with README.md by rename detection is still judged', run(r), [
      /was-the-readme/,
      /no `adr-0087:` disposition marker/,
    ]);
  }

  // ---- Input assertions (#4690) --------------------------------------------
  battery('Input assertions (#4690)');
  {
    const r = mk({ files: {} });
    assert(assertInputs({ cwd: r.dir, head: 'HEAD' }).length === 0, 'I0: a well-formed repo must produce no input problems');
  }
  {
    // parser rot: the projection knows an id the source parser cannot see. Since
    // #22485 through the REAL witness path -- the fixture generator EVALUATES a
    // registry that declares one entry on a single line, a shape extractIds() does
    // not match, so the build sees two ids and the parser one.
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-rot-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w(LEDGER_SOURCES[0], ONE_LINE_REG(['seen-one'], 'invisible-to-the-parser'));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(WITNESS_GENERATOR, WITNESS_GEN());
    w('packages/spec/package.json', JSON.stringify({ name: '@objectstack/spec', version: '1.0.0' }));
    w('.changeset/stock-breaking.md', CS({ body: 'stock\n\n**BREAKING** something\n' }));
    git(['add', '-A'], dir); git(['commit', '-qm', 'base'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD' });
    assert(probs.some((p) => /parser drift/.test(p) && /invisible-to-the-parser/.test(p)), `I1: parser rot must be RED, got: ${probs.join('|')}`);
  }
  {
    // FLIPPED by #8658: a stock with nothing breaking in it is the legitimate
    // shape of main between a release cut and the next breaking changeset
    // landing -- repo PHASE, not an input problem, so it is GREEN now. The
    // detector-rot guarantee the old red carried moved onto the synthetic
    // controls inside assertInputs, which run here too (and on every other
    // invocation in this self-test): rot breakingDeclaration() and every one
    // of these fixtures refuses, this one included.
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-conv-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w(LEDGER_SOURCES[0], REG(['seen-one']));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(ADR_0087, ADR_DOC());
    w('.changeset/quiet.md', CS({ bumps: [['@objectstack/spec', 'patch']], body: 'nothing breaking here\n' }));
    git(['add', '-A'], dir); git(['commit', '-qm', 'base'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD', witness: parserWitness });
    assert(probs.length === 0, `I2 (#8658): a stock with no breaking changeset is repo phase, never an input problem -- got: ${probs.join('|')}`);
  }
  {
    // I2b (#8658): the post-cut window proper -- ZERO changesets in stock, only
    // the tracked README/config. `version packages` produces exactly this state
    // on main, so it must be judged (and, with a diff introducing nothing,
    // found clean), never refused.
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-postcut-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w(LEDGER_SOURCES[0], REG(['seen-one']));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(ADR_0087, ADR_DOC());
    w('.changeset/README.md', '# Changesets\n\ndocumentation only\n');
    w('.changeset/config.json', '{}\n');
    git(['add', '-A'], dir); git(['commit', '-qm', 'post-cut base'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD', witness: parserWitness });
    assert(probs.length === 0, `I2b (#8658): an EMPTY stock right after a release cut is a legal repo state -- got: ${probs.join('|')}`);
    const base = git(['rev-parse', 'HEAD'], dir).trim();
    const res = scan({ cwd: dir, base, head: 'HEAD' });
    assert(
      res.problems.length === 0 && res.judged.length === 0,
      `I2b (#8658): ... and a diff introducing no changeset over it scans clean -- got ${JSON.stringify(res.problems)}`,
    );
  }
  {
    // I2c: the #4690 posture SURVIVES the #8658 repair -- a rev with no
    // `.changeset/` at all (not even README/config) is unreadable input, and
    // unreadable input is a refusal, never a pass.
    battery('I2c: the #4690 posture SURVIVES the #8658 repair -- a rev with no');
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-nodir-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w(LEDGER_SOURCES[0], REG(['seen-one']));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(ADR_0087, ADR_DOC());
    git(['add', '-A'], dir); git(['commit', '-qm', 'no changeset dir'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD', witness: parserWitness });
    assert(
      probs.some((p) => /`\.changeset\/` is missing or unlistable/.test(p)),
      `I2c: a missing .changeset directory must still be RED (#4690) -- got: ${probs.join('|')}`,
    );
  }
  {
    // I2d: the synthetic convention-rot controls run on a repo whose stock DOES
    // contain a breaking changeset too -- they are phase-independent in both
    // directions, so a mid-cycle repo gains no problems from them either.
    // (The rot direction itself -- a broken breakingDeclaration() making the
    // controls refuse -- cannot be staged from here without mutating this
    // module; it is verified by ablation: see the reverse-verification record
    // on the PR that introduced the controls, #8658.)
    battery('I2d: the synthetic convention-rot controls run on a repo whose stock DOES');
    const r = mk({ files: {} });
    const probs = assertInputs({ cwd: r.dir, head: 'HEAD', witness: parserWitness });
    assert(probs.length === 0, `I2d: the synthetic breaking-detector controls add no problems on a healthy detector -- got: ${probs.join('|')}`);
  }
  {
    // a missing ledger is a red, never a skip
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-noledger-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w('.changeset/stock-breaking.md', CS({ body: 'stock\n\n**BREAKING** x\n' }));
    git(['add', '-A'], dir); git(['commit', '-qm', 'base'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD', witness: parserWitness });
    assert(probs.some((p) => /ledger source not found/.test(p)), `I3: a missing ledger must be RED, got: ${probs.join('|')}`);
  }
  {
    // V1/V2 (#8299): the vocabulary and its written description are ONE decision.
    // Checked in both directions, because the two failures are different and both
    // are real -- an exemption nobody can look up, and an exemption nobody can claim.
    const r = mk({ files: {} });
    writeFileSync(join(r.dir, ADR_0087), ADR_DOC(CATEGORIES.filter((c) => c !== 'runtime-interface-only')));
    git(['commit', '-qam', 'undocument a category'], r.dir);
    const probs = assertInputs({ cwd: r.dir, head: 'HEAD', witness: parserWitness });
    assert(
      probs.some((p) => /category documented nowhere/.test(p) && /runtime-interface-only/.test(p)),
      `V1: a category CATEGORIES accepts and the ADR omits must be RED, got: ${probs.join('|')}`,
    );

    const r2 = mk({ files: {} });
    writeFileSync(join(r2.dir, ADR_0087), ADR_DOC([...CATEGORIES, 'sounds-plausible']));
    git(['commit', '-qam', 'document a category nothing implements'], r2.dir);
    const probs2 = assertInputs({ cwd: r2.dir, head: 'HEAD', witness: parserWitness });
    assert(
      probs2.some((p) => /category documented but not accepted/.test(p) && /sounds-plausible/.test(p)),
      `V2: a category the ADR describes and CATEGORIES rejects must be RED, got: ${probs2.join('|')}`,
    );

    // V3: the real repository is the case that matters -- this gate's own vocabulary
    // and the real ADR must agree at the tip being tested, not just in fixtures.
    battery('V3: the real repository is the case that matters -- this gate\'s own vocabulary');
    const realAdr = readFileSync(join(REPO_ROOT, ADR_0087), 'utf8');
    const documented = documentedCategories(realAdr);
    for (const c of CATEGORIES) assert(documented.has(c), `V3: ${ADR_0087} must document the \`${c}\` category`);
    for (const c of documented) assert(CATEGORIES.includes(c), `V3: ${ADR_0087} documents \`${c}\`, which CATEGORIES does not accept`);
  }

  // ---- W1-W6 (#22485): the parser-rot witness is GENERATED at head ---------
  //
  // The committed `spec-changes.json` this gate used to read at HEAD is gone. A
  // copy that had stopped being regenerated aged in one direction: an id WITHDRAWN
  // from the registry stayed in it, and this gate then reported parser drift for
  // an id the parser was right not to see. These cases drive the REAL
  // `generatedWitness` (git archive at head, the generator under this checkout's
  // tsx, `--out`) over the fixture generator every `witnessRepo` carries.
  battery('W1-W6 (#22485): the parser-rot witness is GENERATED at head, never read from a committed copy');
  {
    const witnessRepo = ({ registry, generator = WITNESS_GEN(), files = {} }) => {
      const dir = mkdtempSync(join(tmpdir(), 'adr0087-witness-fixture-'));
      cleanup.push(dir);
      const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
      git(['init', '-q', '-b', 'main'], dir);
      git(['config', 'user.email', 't@t'], dir);
      git(['config', 'user.name', 't'], dir);
      w(LEDGER_SOURCES[0], registry);
      w(LEDGER_SOURCES[1], CONV(['a-conversion']));
      w(ADR_0087, ADR_DOC());
      w('packages/spec/package.json', JSON.stringify({ name: '@objectstack/spec', version: '1.0.0' }));
      w('.changeset/stock-breaking.md', CS({ body: 'stock\n\n**BREAKING** something\n' }));
      if (generator !== null) w(WITNESS_GENERATOR, generator);
      for (const [rel, text] of Object.entries(files)) w(rel, text);
      git(['add', '-A'], dir);
      git(['commit', '-qm', 'base'], dir);
      return { dir, w };
    };
    const ids = (witness) => (witness?.json ? projectedMigrationIds(witness.json) : null);

    // W1, THE PIN: a withdrawn id no longer false-reds. HEAD's registry dropped
    // `withdrawn-one`; a stale committed copy -- the shape the deleted file had --
    // still names it. Green, and the witness the gate actually used holds only the
    // kept id. The stale copy is ASSERTED present at HEAD, so green cannot mean
    // the hazard was simply missing from the fixture.
    const stale = `${JSON.stringify({ perMajor: [{ to: 17, migrated: [{ migrationId: 'kept-one' }, { migrationId: 'withdrawn-one' }] }] }, null, 2)}\n`;
    const r1 = witnessRepo({ registry: REG(['kept-one']), files: { 'packages/spec/spec-changes.json': stale } });
    assert(
      /withdrawn-one/.test(showOrNull('HEAD', 'packages/spec/spec-changes.json', r1.dir) ?? ''),
      'W1 control: the fixture must carry a stale committed copy naming the withdrawn id at HEAD',
    );
    let used = null;
    const p1 = assertInputs({ cwd: r1.dir, head: 'HEAD', witness: (o) => (used = generatedWitness(o)) });
    assert(p1.length === 0, `W1: a withdrawn migration id must NOT red the gate -- got: ${p1.join('|')}`);
    assert(
      JSON.stringify(ids(used)) === JSON.stringify(['kept-one']),
      `W1: the gate consulted the GENERATED witness, built from HEAD's registry (only \`kept-one\`), never the stale copy -- got ${used === null ? 'no witness consulted at all' : `${JSON.stringify(ids(used))} ${used.problem ?? ''}`}`,
    );

    // W2: the witness describes HEAD, never the working tree. An uncommitted edit
    // that declares a parser-invisible id stays green; the SAME edit committed is
    // parser drift, named -- so the generator's view really reaches the verdict.
    r1.w(LEDGER_SOURCES[0], ONE_LINE_REG(['kept-one'], 'one-line-entry'));
    const p2 = assertInputs({ cwd: r1.dir, head: 'HEAD' });
    assert(p2.length === 0, `W2: an UNCOMMITTED registry edit must not reach the witness of HEAD -- got: ${p2.join('|')}`);
    git(['commit', '-qam', 'declare an entry the parser cannot see'], r1.dir);
    const p2c = assertInputs({ cwd: r1.dir, head: 'HEAD' });
    assert(
      p2c.some((p) => /parser drift/.test(p) && /one-line-entry/.test(p)),
      `W2: committed, the same edit is parser drift naming the id -- got: ${p2c.join('|')}`,
    );

    // W3: no generator at head is a red input, never a skip (#4690).
    const r3 = witnessRepo({ registry: REG(['kept-one']), generator: null });
    const p3 = assertInputs({ cwd: r3.dir, head: 'HEAD' });
    assert(
      p3.some((p) => /no parser-rot witness/.test(p) && p.includes(`${WITNESS_GENERATOR} not found at HEAD`)),
      `W3: a missing witness generator must be RED -- got: ${p3.join('|')}`,
    );

    // W4: a generator that fails is red, with its own words.
    const r4 = witnessRepo({ registry: REG(['kept-one']), generator: WITNESS_GEN("throw new Error('registry does not project');\n") });
    const p4 = assertInputs({ cwd: r4.dir, head: 'HEAD' });
    assert(
      p4.some((p) => /no parser-rot witness/.test(p) && /--out exited 1/.test(p) && /registry does not project/.test(p)),
      `W4: a generator that exits non-zero must be RED, quoting it -- got: ${p4.join('|')}`,
    );

    // W5: a generator that exits 0 and writes nothing is red too.
    const r5 = witnessRepo({ registry: REG(['kept-one']), generator: WITNESS_GEN('void out;\n') });
    const p5 = assertInputs({ cwd: r5.dir, head: 'HEAD' });
    assert(
      p5.some((p) => /no parser-rot witness/.test(p) && /exited 0 at HEAD but wrote nothing/.test(p)),
      `W5: a generator that writes nothing must be RED -- got: ${p5.join('|')}`,
    );

    // W6: no runner installed is red, naming the remedy -- never a pass.
    const bare = mkdtempSync(join(tmpdir(), 'adr0087-no-tsx-'));
    cleanup.push(bare);
    const w6 = generatedWitness({ cwd: r3.dir, head: 'HEAD', toolRoot: bare });
    assert(
      w6.json === null && /`tsx` is not installed/.test(w6.problem ?? '') && /pnpm install/.test(w6.problem ?? ''),
      `W6: a checkout with no tsx must answer a problem naming \`pnpm install\` -- got: ${JSON.stringify(w6)}`,
    );
  }

  // ---- GR1-GR7 (#22554): the migration ledger is GENERATED at build ---------
  //
  // A generated-era rev tracks `MIGRATION_LEDGER_TEMPLATE` and the entry files and
  // NOT the registry, exactly as `main` does after #22554. These fixtures carry the
  // REAL registry generator, copied from this repository, so the witness runs the
  // step a fresh checkout's install and build run -- never a model of it.
  battery('GR1-GR7 (#22554): the migration ledger is GENERATED at build, read from its template and entry files');
  {
    const realGenerator = readFileSync(join(REPO_ROOT, MIGRATION_LEDGER_GENERATOR), 'utf8');
    const TEMPLATE = 'export const X = {\n  semantic: [\n    // <os-generated semantic:17>\n    // </os-generated semantic:17>\n  ],\n};\n';
    const ENTRY = (id) => `export const entry = {\n  id: '${id}',\n  surface: 's',\n};\n`;
    const entryPath = (id) => `${MIGRATION_LEDGER_ENTRY_DIRS[0]}/17.${id}.ts`;
    // Every entry directory carries a README, the generator's one declared
    // non-entry file: git keeps no empty directory, and the generator refuses a
    // missing one. The semantic README spells an id-shaped example line (GR2).
    const generatedEra = (entryIds) => ({
      [MIGRATION_LEDGER_TEMPLATE]: TEMPLATE,
      [MIGRATION_LEDGER_GENERATOR]: realGenerator,
      [`${MIGRATION_LEDGER_ENTRY_DIRS[0]}/README.md`]: "An entry looks like this:\n\n  id: 'readme-example',\n",
      [`${MIGRATION_LEDGER_ENTRY_DIRS[1]}/README.md`]: 'retired keys\n',
      [`${MIGRATION_LEDGER_ENTRY_DIRS[2]}/README.md`]: 'retired defs\n',
      ...Object.fromEntries(entryIds.map((id) => [entryPath(id), ENTRY(id)])),
    });
    const generatedRepo = (files) => {
      const dir = mkdtempSync(join(tmpdir(), 'adr0087-generated-era-'));
      cleanup.push(dir);
      const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
      git(['init', '-q', '-b', 'main'], dir);
      git(['config', 'user.email', 't@t'], dir);
      git(['config', 'user.name', 't'], dir);
      w(LEDGER_SOURCES[1], CONV(['a-conversion']));
      w(WITNESS_GENERATOR, WITNESS_GEN());
      w(ADR_0087, ADR_DOC());
      w('packages/spec/package.json', JSON.stringify({ name: '@objectstack/spec', version: '1.0.0' }));
      w('.changeset/stock-breaking.md', CS({ body: 'stock\n\n**BREAKING** something\n' }));
      for (const [rel, text] of Object.entries(files)) w(rel, text);
      git(['add', '-A'], dir);
      git(['commit', '-qm', 'generated era'], dir);
      return dir;
    };

    // GR1: the ledger of a generated-era rev is read from its sources, with the
    // registry ABSENT from the tree -- asserted, so the green cannot be a fixture
    // that quietly committed one.
    const g1 = generatedRepo(generatedEra(['alpha', 'beta']));
    assert(showOrNull('HEAD', LEDGER_SOURCES[0], g1) === null, 'GR1 control: the generated-era fixture must not track the registry');
    const l1 = ledgerAt('HEAD', g1);
    assert(l1.missingSources.length === 0, `GR1: a generated-era rev has a ledger -- got missing ${JSON.stringify(l1.missingSources)}`);
    assert(l1.ids.has('alpha') && l1.ids.has('beta'), `GR1: both entry ids are read -- got ${JSON.stringify([...l1.ids])}`);
    assert(l1.bySource[LEDGER_SOURCES[0]] === 2, `GR1: exactly the two entries, counted under the registry's name -- got ${JSON.stringify(l1.bySource)}`);

    // GR2: a non-entry file in an entry directory is not an entry. The README's
    // id-shaped example line is NOT an id, because the generator would not read it.
    assert(!l1.ids.has('readme-example'), 'GR2: an id-shaped line in entries/**/README.md must not be read as a ledger id');

    // GR3: the witness runs the rev's own registry generator first, so a fresh
    // tree with no registry still projects -- and agrees with the parser.
    let used = null;
    const p3 = assertInputs({ cwd: g1, head: 'HEAD', witness: (o) => (used = generatedWitness(o)) });
    assert(p3.length === 0, `GR3: a generated-era HEAD has every input -- got: ${p3.join('|')}`);
    assert(
      JSON.stringify(used?.json ? projectedMigrationIds(used.json) : null) === JSON.stringify(['alpha', 'beta']),
      `GR3: the witness generated the registry and projected both entries -- got ${JSON.stringify(used)}`,
    );

    // GR4: a template with no generator beside it is red, naming what is missing.
    const g4files = generatedEra(['alpha']);
    delete g4files[MIGRATION_LEDGER_GENERATOR];
    const p4 = assertInputs({ cwd: generatedRepo(g4files), head: 'HEAD' });
    assert(
      p4.some((p) => /no parser-rot witness/.test(p) && p.includes(`${MIGRATION_LEDGER_GENERATOR} is not`)),
      `GR4: a generated-era rev with no registry generator must be RED -- got: ${p4.join('|')}`,
    );

    // GR5: a generation that refuses is red in the generator's own words -- here
    // the filename/id correspondence it enforces.
    const g5files = generatedEra(['alpha']);
    g5files[`${MIGRATION_LEDGER_ENTRY_DIRS[0]}/17.misnamed.ts`] = ENTRY('gamma');
    const p5 = assertInputs({ cwd: generatedRepo(g5files), head: 'HEAD' });
    assert(
      p5.some((p) => /no parser-rot witness/.test(p) && /exited 1/.test(p) && /filename does not match/.test(p)),
      `GR5: a generator refusal must be RED, quoting it -- got: ${p5.join('|')}`,
    );

    // GR6: a rev with neither the registry nor its template has no ledger -- red,
    // naming both, never an empty set.
    const g6files = generatedEra(['alpha']);
    delete g6files[MIGRATION_LEDGER_TEMPLATE];
    const p6 = assertInputs({ cwd: generatedRepo(g6files), head: 'HEAD', witness: parserWitness });
    assert(
      p6.some((p) => p.includes(`ledger source not found at HEAD: ${LEDGER_SOURCES[0]}`) && p.includes(MIGRATION_LEDGER_TEMPLATE)),
      `GR6: no registry and no template must be RED, naming both -- got: ${p6.join('|')}`,
    );

    // GR7: THE TRANSITION. The merge base tracks the registry (committed era) and
    // HEAD replaces it with its sources (generated era) -- the shape of the PR that
    // made the change, and of every branch forked before it. An entry carried
    // across is NOT new; an entry added beside it is.
    const transition = (claim) => run(mk({
      baseIds: ['alpha'],
      files: {
        [LEDGER_SOURCES[0]]: null,
        ...generatedEra(['alpha', 'beta']),
        '.changeset/x.md': CS({ body: `**BREAKING** x\n\n<!-- adr-0087: registered ${claim} -->\n` }),
      },
    }));
    green('GR7 transition: an entry added in the generated era is a new registration', transition('beta'));
    red('GR7 transition: an entry carried over from the committed era is not new', transition('alpha'), [/none of those ids is NEW in this diff/]);
  }

  // ---- Unit pins on the two pattern-shaped judgements ----------------------
  //
  // P1-P3 are the LABEL branch, unchanged since #6148 -- the template placeholder
  // must keep matching, or the #6048 shape stops being caught. P4-P5 are the
  // original false-positive floor. P9-P17 are #6419: the branch that reads real
  // prescriptions, and the prose shapes it must still refuse.
  battery('Unit pins on the two pattern-shaped judgements');
  assert(hasMigrationPrescription('### 迁移:FROM → TO\n'), 'P1: the Chinese prescription heading must match');
  assert(hasMigrationPrescription('**FROM → TO**\n'), 'P2: the inline FROM -> TO heading must match');
  assert(hasMigrationPrescription('| FROM (legacy) | TO (primitives) |\n'), 'P3: a FROM/TO table header must match');
  assert(!hasMigrationPrescription('moved from the old value to the new one\n'), 'P4: ordinary lowercase prose must NOT match');
  assert(!hasMigrationPrescription('this is from A to B in prose\n'), 'P5: lowercase "from ... to" must NOT match');

  // #6419 -- REAL prescriptions, which the placeholder-only pattern all missed.
  assert(hasMigrationPrescription('**迁移**:`aggregate:` → `aggregations:`\n'), 'P9: a real Chinese prescription with backticked identifiers must match');
  assert(hasMigrationPrescription('一行修复:把 `ctx.user.roles` 改写成 `ctx.user.positions`(`req.user.roles` → `req.user.positions`)\n'), 'P10: a 改写 prescription must match');
  assert(hasMigrationPrescription('**Migration.** `r.deleted` → `r.success`. That is the whole migration.\n'), 'P11: an English inline Migration prescription must match');
  assert(hasMigrationPrescription('## 迁移\n\n- `node.config.filters` → `node.config.filter`\n'), 'P12: a rewrite under a migration HEADING must match');
  assert(hasMigrationPrescription('## Migration\n\n- `sharedWith.type` → `sharedWith.recipientType`\n'), 'P13: the same, in English');
  // and the prose it must still refuse -- every one of these is real corpus text.
  assert(!hasMigrationPrescription('ceremony — 16→17 is already a substantial, tested migration — to postpone\n'), 'P14: a version step next to the word migration must NOT match');
  assert(!hasMigrationPrescription('dependency direction (runtime → objectql) permits no other home.\n'), 'P15: a dependency direction must NOT match');
  assert(!hasMigrationPrescription('No `sys_migration_journal` registered → the scan is skipped in silence.\n'), 'P16: the framing word inside an identifier must NOT anchor');
  assert(!hasMigrationPrescription('`renameConfigKey`, so `object` → `objectName`, `filters` → `filter`\n'), 'P17: `renameConfigKey` is an identifier, not framing');
  // the evidence line is what makes a refusal checkable rather than assertive
  assert(findMigrationPrescription('**迁移**:`a.b` → `a.c`\n')?.branch === 'framed-line', 'P18: an inline framed rewrite reports the framed-line branch');
  assert(findMigrationPrescription('## 迁移\n\n`a.b` → `a.c`\n')?.branch === 'framed-section', 'P19: a heading-framed rewrite reports the framed-section branch');
  assert(findMigrationPrescription('### 迁移:FROM → TO\n')?.branch === 'from-to-label', 'P20: the placeholder label reports the label branch');
  assert(findMigrationPrescription('nothing here\n') === null, 'P21: a body with no prescription reports null, not a shrug');

  // #6497 -- the REWRITE TABLE, which has no arrow for either arrow branch to read.
  const TABLE_EN = '## Migration\n\n| Wrote | Write instead |\n| --- | --- |\n| `new HttpServer(port)` | register the `HonoHttpServer` directly |\n';
  const TABLE_ZH = '## 破坏性变更 · 迁移\n\n| 旧写法 | 改成 |\n|---|---|\n| `typography.fontWeight: { base }` | `normal` |\n';
  assert(hasMigrationPrescription(TABLE_EN), 'P22: an arrowless rewrite table under `## Migration` must match');
  assert(hasMigrationPrescription(TABLE_ZH), 'P23: the same, in Chinese, with the `|---|---|` delimiter spelling');
  assert(findMigrationPrescription(TABLE_EN)?.branch === 'framed-table', 'P24: a framed table reports the framed-table branch');
  // ...and the two things that keep it narrow. Both are false-positive floors: they
  // are green with the arm and green without it, so reverse verification cannot
  // move them -- they pin where the arm STOPS, which no deletion can widen.
  // ⚠️ P25's FIXTURE was replaced by #6559, and the replacement is the point. It
  // used to re-head TABLE_EN with `## What changed` -- but TABLE_EN's header row is
  // `| Wrote | Write instead |`, which #6559 taught the detector to read as framing
  // in its own right, so the old fixture asserted the exact boundary that change
  // moves and went red on it. The INTENT survives unchanged (a heading with no
  // migration framing does not frame the table under it); only the table had to
  // stop supplying framing of its own, so the header here is neutral.
  assert(
    !hasMigrationPrescription('## What changed\n\n| Member | Behaviour |\n| --- | --- |\n| `a.b` | now resolves through `c.d` |\n'),
    'P25: an unframed heading over a NEUTRALLY-headed table must NOT match -- the anchor is load-bearing',
  );
  assert(
    !hasMigrationPrescription('## Migration\n\n| Member | What it cost |\n| --- | --- |\n| `getPort?()` | the real bound port after listening |\n'),
    'P26: one coded cell is a description, not a rewrite -- two DISTINCT cells are required',
  );
  assert(
    !hasMigrationPrescription('## Migration\n\nprose about `a.b` and `c.d` with a | pipe in it but no table at all\n'),
    'P27: a pipe in prose is not a table -- the delimiter row is what opens one',
  );

  // #6559 -- the table framed ONLY BY ITS OWN HEADER CELLS, no migration heading
  // anywhere. P28-P32 are the arm itself and are the RED set under reverse
  // verification; P33-P38 are false-positive floors, green with the arm and green
  // without it, which is said out loud rather than counted as coverage.
  assert(
    findMigrationPrescription(TABLE_EN.replace('## Migration\n\n', ''))?.branch === 'header-framed-table',
    'P28: `| Wrote | Write instead |` frames its own table with no heading in the body at all',
  );
  assert(
    findMigrationPrescription('| Retired | Use instead |\n| --- | --- |\n| `actionType: \'email\'` | a `notify` node |\n')?.branch === 'header-framed-table',
    'P29: `| Retired | Use instead |` -- the same convention, retirement spelling',
  );
  assert(
    findMigrationPrescription('| Removed (never enforced) | Live replacement |\n| --- | --- |\n| `AuditConfigSchema.enabled` | none — `object.zod` `trackHistory` |\n')?.branch === 'header-framed-table',
    'P30: the OLD word need only OPEN the cell -- `Removed (never enforced)` still heads a removal column',
  );
  assert(
    findMigrationPrescription('| 原写法 | 改写为 |\n|---|---|\n| `{ $regex: \'acme\' }` | `{ $icontains: \'acme\' }` |\n')?.branch === 'header-framed-table',
    'P31: the Chinese spelling of the same two columns',
  );
  assert(
    findMigrationPrescription('| You wrote | Where | Write instead |\n|---|---|---|\n| `object` | `form.subforms[]` | `childObject` |\n')?.branch === 'header-framed-table',
    'P32: a THREE-column table still frames, as long as the new column follows the old one',
  );
  // --- the floors: what the new vocabulary must refuse -----------------------
  battery('the floors: what the new vocabulary must refuse');
  assert(
    !hasMigrationPrescription('| route | was | now |\n|---|---|---|\n| `POST /share-links` | `{ link }` | `{ success: true, data: link }` |\n'),
    'P33: `| was | now |` is this repo\'s BEHAVIOUR-comparison header, not a rewrite -- `was` is deliberately not an OLD word',
  );
  assert(
    !hasMigrationPrescription('| | `@objectstack/spec/shared` (unchanged) | `@objectstack/spec/integration` (renamed) |\n|:--|:--|:--|\n| window | `windowMs` (ms) | `windowSeconds` (s) |\n'),
    'P34: the two-TYPE comparison matrix #6558 measured as the header shortcut\'s false positive stays OUT of the new arm',
  );
  assert(
    !hasMigrationPrescription('| Removed | Built | Why it 404ed |\n|---|---|---|\n| `client.ai.nlq` | `POST /api/v1/ai/nlq` | declared in `DEFAULT_AI_ROUTES` |\n'),
    'P35: a lone `Removed` heads a forensic table as readily as a prescription -- the NEW column is what pairs it',
  );
  assert(
    !hasMigrationPrescription('| removed page | sections now live on |\n| :--- | :--- |\n| `api/core-services` | `api/discovery` |\n'),
    'P36: cell-START anchoring -- `now` inside `sections now live on` names no column, so a docs redirect table stays out',
  );
  assert(
    !hasMigrationPrescription('| Write instead | Wrote |\n| --- | --- |\n| `a.b` | `a.c` |\n'),
    'P37: ORDER is load-bearing -- the new column must follow the old one, not precede it',
  );
  assert(
    !hasMigrationPrescription('| Wrote | Write instead |\n| --- | --- |\n| `a.b` | plain prose with no code in it |\n'),
    'P38: the header frames, but the ROW still has to read as a rewrite -- one coded cell is a description',
  );

  // #6967 -- the placeholder MENTIONED rather than USED. P39-P41 are the RED set
  // under reverse verification (restore the "every occurrence counts" limb and all
  // three go red); P42-P50 are what keeps the rule from over-reaching, and they are
  // the half that cost the most to get right -- the first draft refused a label
  // that merely followed a finished sentence and took five real prescriptions with
  // it, `app-dead-authoring-keys.md` (declared-breaking) among them.
  assert(
    !hasMigrationPrescription("Migration: each breaking change's own changeset carries its FROM → TO guide\n(grep the CHANGELOG for `!:` entries).\n"),
    'P39: THE #6967 SHAPE -- `carries its FROM → TO guide` POINTS AT prescriptions and is not one',
  );
  assert(
    !hasMigrationPrescription('唯一的 FROM → TO 落在部署方自己的代理配置上,而这些部署今天本就是 split-brain。\n'),
    'P40: the Chinese spelling of the same mention -- `的` is the attributive particle, so a word governs it',
  );
  assert(
    !hasMigrationPrescription('The checklist requires breaking changesets to carry their FROM → TO migration.\n'),
    'P41: `their FROM → TO migration` -- a governing word beats the framing word that follows',
  );
  // --- the floors: labels that are NOT mentions, and mentions that ARE evidenced --
  battery('the floors: labels that are NOT mentions, and mentions that ARE evidenced');
  assert(
    findMigrationPrescription('**Removed keys and their prescriptions (FROM → TO):**\n\n- `App.version` → an app is versioned by its package\n')?.branch === 'from-to-label',
    'P42: a parenthesised label is opened by `(`, not governed by `prescriptions` -- `app-dead-authoring-keys.md`',
  );
  assert(
    findMigrationPrescription('The RLS compiler never read it. FROM → TO: a set a policy needs is now supplied\n')?.branch === 'from-to-label',
    'P43: a label that FOLLOWS a finished sentence on the same line is still a label',
  );
  assert(
    findMigrationPrescription('Corrected names, FROM → TO (the fix if you referenced an old `$id`)\n')?.branch === 'from-to-label',
    'P44: ...and one that follows a comma -- punctuation is a boundary, not governance',
  );
  assert(
    findMigrationPrescription('匹配语义 FROM → TO:\n\n| | FROM | TO |\n|:---|:---|:---|\n| `apiKey` | `a` | `b` |\n')?.branch === 'from-to-label',
    'P45: a CJK noun phrase with NO `的` does not govern -- the space before a Latin token is typography',
  );
  assert(
    findMigrationPrescription('## 升级:翻译包键的 FROM → TO\n')?.branch === 'from-to-label',
    'P46: a HEADING is a label by construction, `的` and all -- `views-translation-key-runtime-identity.md`',
  );
  assert(
    findMigrationPrescription('The error carries the fix; the FROM → TO mappings include:\n\n- `objectPermissions` → `objectPermission`\n')?.branch === 'from-to-label',
    'P47: a governed placeholder is taken at face value once the body SHOWS a concrete rewrite',
  );
  assert(
    !hasMigrationPrescription('The error carries the fix; the FROM → TO mappings are baked into the message.\n'),
    'P48: ...and is refused when it does not -- P47 turns on the rewrite, not on the sentence',
  );
  assert(
    findMigrationPrescription('the error carries the FROM → TO above\n\n## Migration\n\n- **FROM:** `requiresConfirmation: true`\n- **TO:** put it behind an action\n')?.branch === 'from-to-label',
    'P49: a VERTICAL `FROM:`/`TO:` block pair corroborates -- `tool-requires-confirmation-removed.md`, and #6048 wrote the same shape in a fence',
  );
  // the evidence line, which is the only thing an author can argue with (#6419)
  assert(
    findMigrationPrescription('prose that wraps at eighty columns and ends the line here\nFROM → TO:\n\n- `a.b` → `a.c`\n')?.line === 'FROM → TO:',
    'P50: the evidence line is the placeholder\'s OWN line -- the match may open on the newline that ends the line above, which used to be reported instead',
  );

  // --- D1-D9 (#17357): a heading that DENIES a prescription is not evidence of one.
  //
  // The heading short-circuit in `labelPositioned` had no polarity, so
  // `## No FROM → TO mapping, and why this section is not one` evidenced the very
  // prescription it denied and `not-required (no-migration-prescription)` was refused
  // on it -- while the IDENTICAL denial reworded off the token passed. Both
  // directions are pinned here, and the RED half is load-bearing: a narrowing that
  // only proves the denial passes has made the gate weaker and measured nothing
  // about it. D2/D4/D6 are the positive controls -- if any of them goes red the arm
  // has stopped seeing rather than started discriminating.
  battery('D1-D9 (#17357): a heading that DENIES a prescription is not evidence of one');
  assert(
    !hasMigrationPrescription('## No FROM → TO mapping, and why this section is not one\n\nA bare deletion on a non-strict schema refuses nothing and converts nothing.\n'),
    'D1: THE #17357 SHAPE -- the denial heading verbatim, in a body that shows no goods',
  );
  assert(
    findMigrationPrescription('## Migration — FROM → TO\n\ndelete the block\n')?.branch === 'from-to-label',
    'D2: POSITIVE CONTROL -- an ordinary label heading, with NO concrete rewrite in the body to fall back on, still matches',
  );
  assert(
    findMigrationPrescription('## No FROM → TO mapping, and why this section is not one\n\n- `a.b` → `a.c`\n')?.branch === 'from-to-label',
    'D3: a denying heading is DEMOTED TO A MENTION, not exempted -- a body that denies and then SHOWS the goods is refused exactly as before',
  );
  assert(
    findMigrationPrescription('## Upgrading the keys that are not yet removed, FROM → TO\n')?.branch === 'from-to-label',
    'D4: POSITIVE CONTROL -- ADJACENCY is the rule; a negator three words away from the placeholder governs a different noun and denies nothing',
  );
  assert(
    !hasMigrationPrescription('## 无 FROM → TO 映射,以及本节为什么不是一份映射\n\n直接删除,什么都不需要改写。\n'),
    'D5: the Chinese spelling of the same denial -- `无` governs the placeholder',
  );
  assert(
    findMigrationPrescription('## 升级:不再支持的键的 FROM → TO\n')?.branch === 'from-to-label',
    'D6: POSITIVE CONTROL -- `不` modifies a noun three words away; the governing token is `的`, so this real prescription heading is untouched',
  );
  assert(
    !hasMigrationPrescription('## No migration FROM → TO is prescribed by this change\n'),
    'D7: a framing word between the negator and the placeholder is transparent -- `migration` FRAMES, it does not govern',
  );
  assert(
    findMigrationPrescription('## No FROM → TO mapping, and why this section is not one\n\n**Migration (FROM → TO).** delete the block\n')?.line === '**Migration (FROM → TO).** delete the block',
    'D8: only the DENYING occurrence is demoted -- a genuine label later in the same body still hits, and the evidence line is that label rather than the denial',
  );
  assert(
    findMigrationPrescription('## Nonstandard keys, FROM → TO is how they are listed\n')?.branch === 'from-to-label',
    'D9: POSITIVE CONTROL -- the closed class is WORD-anchored, so `Nonstandard` is not `no` and this heading keeps its label reading',
  );

  // --- F1-F9 (#17864): a framing word between the governor and the placeholder is
  // --- transparent, IN LINE as well as in a heading.
  //
  // `FRAMING_TAIL_RE` strips the framing word so the governance question reaches the
  // word BEHIND it. In-line, nothing re-trimmed the space that word sat behind, and
  // `GOVERNING_WORD_RE` is end-anchored -- so the question was asked of a trailing
  // space, answered "nothing governs this", and every governed MENTION carrying a
  // framing word read as a LABEL. Inserting one word flipped the verdict, in the
  // #6967 false-positive direction, where the cost is a hard-blocked PR.
  //
  // F1/F3 are the RED set under reverse verification (drop the right-trim in
  // `withoutFramingTail` and both go red). F2 is the positive control the specimen
  // assertions are worthless without -- if it reds with F1 green the label arm has
  // stopped seeing rather than started discriminating. F4 is the control that makes
  // F1 a READING: one framing word is the only difference between them. F5-F9 are
  // the floors in the dangerous direction -- a narrowing that turned a loud wrong
  // answer into a quiet one would show up here, not in F1.
  battery('F1-F9 (#17864): a framing word between the governor and the placeholder is');
  assert(
    !hasMigrationPrescription('the Migration FROM → TO is documented elsewhere\n'),
    'F1: THE #17864 SHAPE -- `the Migration FROM → TO` is the mention `the FROM → TO` is, one framing word apart',
  );
  assert(
    findMigrationPrescription('Migration FROM → TO: delete the block\n')?.branch === 'from-to-label',
    'F2: POSITIVE CONTROL -- a framing word with NO governor in front of it opens a label, with no concrete rewrite in the body to fall back on',
  );
  assert(
    !hasMigrationPrescription('唯一的 迁移 FROM → TO 落在部署方自己的代理配置上。\n'),
    'F3: the Chinese spelling -- `的` governs across the framing word `迁移` exactly as `the` does across `Migration` (P40 framed)',
  );
  assert(
    !hasMigrationPrescription('the FROM → TO is documented elsewhere\n'),
    'F4: THE CONTROL F1 IS A READING AGAINST -- the same sentence without the framing word, which was already a mention',
  );
  assert(
    findMigrationPrescription('The RLS compiler never read it. Migration FROM → TO: a set a policy needs is now supplied\n')?.branch === 'from-to-label',
    'F5: FLOOR -- the strip exposes a sentence boundary, not a word, so a label following a finished sentence stays a label (P43 framed)',
  );
  assert(
    findMigrationPrescription('**Migration FROM → TO:** delete the block\n')?.branch === 'from-to-label',
    'F6: FLOOR -- it exposes MARKUP, which governs nothing',
  );
  assert(
    findMigrationPrescription('- Migration FROM → TO: delete the block\n')?.branch === 'from-to-label',
    'F7: FLOOR -- and a bullet marker, which is structure rather than prose',
  );
  assert(
    findMigrationPrescription('the Migration FROM → TO mappings include:\n\n- `objectPermissions` → `objectPermission`\n')?.branch === 'from-to-label',
    'F8: FLOOR -- a governed framed placeholder is still taken at face value once the body SHOWS a concrete rewrite (P47 framed); the narrowing removes no hit whose body ships the goods',
  );
  assert(
    findMigrationPrescription('sys_migration FROM → TO: delete the block\n')?.branch === 'from-to-label',
    'F9: FLOOR -- the repair keys on the SPACE, so an identifier ending in a framing word strips to `sys_` and reads exactly as it did',
  );

  // --- L1-L13 (#18494): a NOUN-PHRASE label is a label, read from the RIGHT.
  //
  // `GOVERNING_WORD_RE` reads the one character to the LEFT, and a label whose own
  // words are a noun phrase has an ordinary letter there -- so `**Schema Migration
  // FROM → TO:** delete the block` read as a MENTION and a changeset shipping
  // no rewrite at all was admitted under the catch-all. That is the false-NEGATIVE
  // direction: the cost is not a blocked PR but a break reaching consumers with no
  // prescription and no ledger entry.
  //
  // L1-L7 are the RED set under reverse verification (remove the `LABEL_COLON_RE`
  // arm and all seven go red). L8 is the control that makes L1 a READING rather
  // than a specimen: one colon is the only difference between them. L9-L13 are the
  // floors in the dangerous direction -- a widening that read a colon ANYWHERE in
  // the line as a label, or that let punctuation overturn a denial, shows up there
  // and not in L1.
  battery('L1-L13 (#18494): a NOUN-PHRASE label is a label, read from the RIGHT');
  assert(
    findMigrationPrescription('**Schema Migration FROM → TO:** delete the block\n')?.branch === 'from-to-label',
    'L1: THE #18494 SHAPE -- a compound-noun label, with no concrete rewrite in the body to fall back on',
  );
  assert(
    findMigrationPrescription('- Schema Migration FROM → TO: the block goes away\n')?.branch === 'from-to-label',
    'L2: ...and under a bullet marker',
  );
  assert(
    findMigrationPrescription('Key renames FROM → TO: listed below in prose\n')?.branch === 'from-to-label',
    'L3: a PLURAL noun immediately before the framing word reads the same way',
  );
  assert(
    findMigrationPrescription('**Required migration FROM → TO:** delete the block\n')?.branch === 'from-to-label',
    'L4: ...and an ADJECTIVE before it -- the rule is the colon, not a part-of-speech judgement',
  );
  assert(
    findMigrationPrescription('Authoring-key migration FROM → TO:\n')?.branch === 'from-to-label',
    'L5: ...and a hyphenated compound, which no word-anchoring can separate',
  );
  assert(
    findMigrationPrescription('字段的 迁移 FROM → TO: 删除这一块\n')?.branch === 'from-to-label',
    'L6: the Chinese spelling of the same label -- the attributive particle governs the framing word, not the placeholder',
  );
  assert(
    findMigrationPrescription('**Removed keys FROM → TO:**\n')?.branch === 'from-to-label',
    'L7: the same defect ONE WORD SHORTER -- a noun-phrase label with no framing word in it at all (#18494 fairness control)',
  );
  assert(
    !hasMigrationPrescription('the Migration FROM → TO is documented elsewhere\n'),
    'L8: THE CONTROL L1 IS A READING AGAINST -- the same framed placeholder with no colon closing it is still the #17864 mention',
  );
  assert(
    !hasMigrationPrescription('the FROM → TO mapping is documented elsewhere: see the release notes\n'),
    'L9: FLOOR -- ADJACENCY on the right, exactly as on the left: a colon later in the LINE closes a clause, not the placeholder',
  );
  assert(
    !hasMigrationPrescription('The checklist requires breaking changesets to carry their FROM → TO migration.\n'),
    'L10: FLOOR -- P41 unmoved; a governed mention whose line carries no colon at all is untouched by this arm',
  );
  assert(
    findMigrationPrescription('Migration (FROM → TO): delete the block\n')?.branch === 'from-to-label',
    'L11: FLOOR -- the `)` run the stock measures between the placeholder and its colon',
  );
  assert(
    findMigrationPrescription('**FROM → TO**: a direct-engine caller must pass the flag\n')?.branch === 'from-to-label',
    'L12: FLOOR -- and the `**` run, the one occurrence of it in the corpus',
  );
  assert(
    !hasMigrationPrescription('## No FROM → TO: this section prescribes nothing\n'),
    'L13: FLOOR, POLARITY -- a DENYING heading keeps its reading; the colon is asked AFTER the heading arm so punctuation cannot overturn a denial (#17357)',
  );

  // --- P51-P60: the HARD-WRAPPED mention, and the floors that keep the cure from
  // --- being worse than the disease (#7094).
  //
  // Branch 1 reads the ONE character before the placeholder. When the placeholder
  // opens its line there is no such character, and #7078 read that as "a label
  // opens a segment" -- true under a blank line, false under a sentence that simply
  // ran out of columns. These pin BOTH directions: the wrapped MENTION now loses,
  // and every other way of opening a line keeps what it had. P52 is the positive
  // control the specimen assertions are worthless without -- if it ever goes red
  // with P51 green, the arm has stopped seeing rather than started discriminating.
  battery('P51-P60: the HARD-WRAPPED mention, and the floors that keep the cure from');
  assert(
    !hasMigrationPrescription(
      'The AGENTS.md post-task checklist requires breaking changesets to carry their\nFROM → TO migration because "this text ships to consumers as `CHANGELOG.md`\ninside the npm package and is what an upgrading agent greps after the tombstone\nerror."\n',
    ),
    'P51: the #7094 specimen VERBATIM -- `carry their` ends the line above, so the wrap does not make a mention a label (`changelog-ships-in-tarball.md`)',
  );
  assert(
    findMigrationPrescription('prose that wraps at eighty columns and ends the line here\nFROM → TO: delete the block\n')?.branch === 'from-to-label',
    'P52: POSITIVE CONTROL -- a wrapped LABEL under a line ending on a word that governs nothing still matches, with NO concrete rewrite in the body to fall back on',
  );
  assert(
    findMigrationPrescription('The RLS compiler never read it.\nFROM → TO: a set a policy needs is now supplied\n')?.branch === 'from-to-label',
    'P53: ...and so does one under a FINISHED sentence -- punctuation is a boundary across the wrap exactly as it is within the line (P43)',
  );
  assert(
    findMigrationPrescription('an ordinary paragraph about something else\n\nFROM → TO:\n')?.branch === 'from-to-label',
    'P54: a placeholder opening a PARAGRAPH is a label -- 46 of the stock\'s 49 line-opening occurrences are this shape and none of them moved',
  );
  assert(
    findMigrationPrescription('## Migration\nFROM → TO:\n')?.branch === 'from-to-label',
    'P55: a HEADING does not wrap into the line below it, so the placeholder under one still opens a segment',
  );
  assert(
    findMigrationPrescription('| You wrote | Write instead |\nFROM → TO:\n')?.branch === 'from-to-label',
    'P56: nor does a table row -- structure above is not a sentence running on',
  );
  assert(
    !hasMigrationPrescription('这次改动只是把发布说明搬了个地方,真正的\nFROM → TO 落在部署方自己的代理配置上。\n'),
    'P57: the Chinese spelling wraps too -- `的` ending the line above governs the placeholder below it (P40 across a wrap)',
  );
  assert(
    !hasMigrationPrescription('- the checklist requires every breaking changeset to carry its own\n  FROM → TO guide, which is where the prescriptions live\n'),
    'P58: a wrapped BULLET is prose that runs on -- the arm reads the line above whether the placeholder is at column 0 or merely indented',
  );
  assert(
    findMigrationPrescription('- a bullet that ended cleanly\n\n  FROM → TO: delete the block\n')?.branch === 'from-to-label',
    'P59: ...and an INDENTED label under a blank line is still a label -- indentation is not the test, which is the tightening this fix had to avoid',
  );
  assert(
    findMigrationPrescription('the checklist requires each changeset to carry their\nFROM → TO guide\n\n- `objectPermissions` → `objectPermission`\n')?.branch === 'from-to-label',
    'P60: the corroboration floor survives the wrap -- a wrapped mention is still taken at face value once the body SHOWS a concrete rewrite (P47)',
  );
  assert(
    findMigrationPrescription('**Migration (FROM → TO).** Replace each legacy value with the primitive\n\nit is NOT a parse error: `stripLegacyApiMethods` strips it with a\nFROM→TO warning (canonicalize-and-warn)\n')?.line === '**Migration (FROM → TO).** Replace each legacy value with the primitive',
    'P61: a body holding a real label AND a wrapped mention keeps the LABEL as its evidence -- `apimethod-enum-shrink.md`, declared-breaking, the stock\'s own control for this arm',
  );

  // --- X1-X11 (#18493): a framing word inside an IDENTIFIER is not framing, and
  // --- prose WRAPS between the governor and the placeholder.
  //
  // Both are the #17864 transparency rule failing to compose, in the FALSE-POSITIVE
  // direction where a mention is read as a label and the author is refused a
  // rewrite they do not owe. `FRAMING_TAIL_RE` carried no word anchor, so
  // `the sys_migration FROM → TO is documented elsewhere` stripped `migration`
  // out of the identifier, exposed `_` instead of the `n` that was really there and
  // answered "nothing governs this"; and the in-line arm is computed within ONE
  // line, so a markdown hard wrap put the governor out of its reach in both
  // directions (governor above, framed placeholder below -- and framing word above,
  // placeholder below).
  //
  // X1/X4/X5/X10 are the RED set under reverse verification (drop the word anchor
  // for X1, the empty-strip fall-through for X4, the wrap-side strip for X5/X10).
  // X2/X7/X8/X9 are the floors that keep the cure from being the disease: every one
  // of them is a LABEL that this widening must not admit.
  battery('X1-X11 (#18493): a framing word inside an IDENTIFIER is not framing');
  assert(
    !hasMigrationPrescription('the sys_migration FROM → TO is documented elsewhere\n'),
    'X1: THE #18493 TRIGGER 1 -- `the` governs the placeholder across an identifier that merely ENDS in a framing word',
  );
  assert(
    findMigrationPrescription('sys_migration FROM → TO: delete the block\n')?.branch === 'from-to-label',
    'X2: POSITIVE CONTROL and the F9 FLOOR -- the same identifier with a colon closing the placeholder is a label, now for the reason it always was one',
  );
  assert(
    !hasMigrationPrescription('the onUpgrade FROM → TO is documented elsewhere\n'),
    'X3: ...and a camelCase identifier ending in one, which no right-trim could ever have reached',
  );
  assert(
    !hasMigrationPrescription('the\nMigration FROM → TO is documented elsewhere\n'),
    'X4: THE #18493 TRIGGER 2, W1 -- the governor ends the line ABOVE and the framing word opens the one below',
  );
  assert(
    !hasMigrationPrescription('the Migration\nFROM → TO is documented elsewhere\n'),
    'X5: ...and W2, the same sentence wrapped one word later -- the framing word is transparent across the wrap as it is within the line',
  );
  assert(
    !hasMigrationPrescription('The checklist requires breaking changesets to carry their\nFROM → TO migration.\n'),
    'X6: THE #7094 CONTROL -- unaffected, and it must stay that way: the wrap arm it shares is the one being composed with',
  );
  assert(
    findMigrationPrescription('prose that wraps at eighty columns and ends the line here\nFROM → TO: delete the block\n')?.branch === 'from-to-label',
    'X7: FLOOR, W4 -- a wrapped LABEL under a line that governs nothing is still a label (P52 unmoved)',
  );
  assert(
    findMigrationPrescription('## Migration\nFROM → TO: delete the block\n')?.branch === 'from-to-label',
    'X8: FLOOR -- a HEADING does not wrap, so the strip on the line above is never asked (P55 unmoved)',
  );
  assert(
    findMigrationPrescription('Migration FROM → TO: delete the block\n')?.branch === 'from-to-label',
    'X9: FLOOR -- a framing word that is the WHOLE prefix with no line above it still opens a label (F2 unmoved through the new fall-through)',
  );
  assert(
    !hasMigrationPrescription('这次改动只是把发布说明搜了个地方，真正的\n迁移 FROM → TO 落在部署方自己的代理配置上。\n'),
    'X10: the Chinese spelling of W1 -- the attributive particle ends the line above and the framing word opens the one below (P57 framed)',
  );
  assert(
    findMigrationPrescription('- a bullet that ended cleanly\n\n  FROM → TO: delete the block\n')?.branch === 'from-to-label',
    'X11: FLOOR -- an INDENTED label under a blank line is still a label; indentation is not the test (P59 unmoved)',
  );

  // --- SS1-SS8 (#18494 + #18493): the two directions of ONE predicate, pinned
  // --- AGAINST each other so neither can be traded for the other.
  //
  // These two cards are the SAME decision failing in OPPOSITE directions, and the
  // repairs are coupled rather than adjacent: word-anchoring `FRAMING_TAIL_RE`
  // (#18493) is what stops `sys_migration` being stripped, and it takes the F9
  // label with it unless `LABEL_COLON_RE` (#18494) is holding that label up for the
  // reason it is actually a label. Tune either one alone and the other direction
  // re-opens.
  //
  // So they are pinned as MINIMAL PAIRS, in ONE battery, with one floor over both:
  // each pair differs in exactly one character or one line break and asserts
  // OPPOSITE verdicts. A future tuning that buys one direction with the other reds
  // a pair rather than passing a battery that only pins the half it just moved, and
  // deleting half the pairs to make that go away drops the battery under its floor.
  battery('SS1-SS8 (#18494 + #18493): the two directions of ONE predicate, pinned');
  // PAIR 1 -- the colon, and nothing else: noun-phrase LABEL vs governed MENTION.
  assert(
    findMigrationPrescription('Schema Migration FROM → TO: delete the block\n')?.branch === 'from-to-label',
    'SS1: the colon closes the placeholder, so the noun phrase is a LABEL (#18494 direction)',
  );
  assert(
    !hasMigrationPrescription('Schema Migration FROM → TO is documented elsewhere\n'),
    'SS2: PAIRED WITH SS1 -- the same noun phrase with no colon is prose, and prose about a convention is a MENTION',
  );
  // PAIR 2 -- the identifier, and nothing else: the F9 label survives the anchor.
  assert(
    findMigrationPrescription('sys_migration FROM → TO: delete the block\n')?.branch === 'from-to-label',
    'SS3: an identifier before a colon-closed placeholder is a LABEL -- held by the colon, not by a strip accident',
  );
  assert(
    !hasMigrationPrescription('the sys_migration FROM → TO is documented elsewhere\n'),
    'SS4: PAIRED WITH SS3 -- add the governor and drop the colon, and the identical identifier is a MENTION (#18493 direction)',
  );
  // PAIR 3 -- the line break, and nothing else.
  assert(
    !hasMigrationPrescription('the Migration\nFROM → TO is documented elsewhere\n'),
    'SS5: a wrap does not manufacture a label out of a governed framed mention',
  );
  assert(
    findMigrationPrescription('the sentence ended here.\nFROM → TO: delete the block\n')?.branch === 'from-to-label',
    'SS6: PAIRED WITH SS5 -- and does not take one away where the line above governs nothing',
  );
  // PAIR 4 -- the whole point, end to end: what each direction COSTS if traded.
  assert(
    findMigrationPrescription('**Required migration FROM → TO:** delete the block\n')?.branch === 'from-to-label',
    'SS7: trading this away re-admits a published break with no prescription and no ledger entry (the #18494 cost)',
  );
  assert(
    !hasMigrationPrescription('the sys_migration FROM → TO guide lives in the release notes\n'),
    'SS8: PAIRED WITH SS7 -- trading THIS away hard-blocks a PR for a rewrite it does not owe, with an evidence line naming the author\'s own sentence (the #18493 cost)',
  );

  // --- P62-P68: the framed region closes at the same or a SHALLOWER heading, not
  // --- at ANY heading (#12996) -- the FOURTH spelling of the recurring shape whose
  // --- first three repairs are #6419, #6497 and #6559.
  //
  // P62-P64 and P67 are the RED set under reverse verification: restore the
  // `framedSection = MIGRATION_FRAMING_RE.test(line)` limb and all four go red.
  // P65-P66 are false-positive floors -- green with the fix and green without it,
  // which is said out loud rather than counted as coverage, because they pin where
  // a framed region STOPS and a region that never stops frames the whole document.
  battery('P62-P68: the framed region closes at the same or a SHALLOWER heading, not');
  const NESTED_TABLE = '## Migration\n\n### Method namespace\n\n| before | after |\n| --- | --- |\n| `client.projects.list()` | `client.environments.list()` |\n';
  assert(
    findMigrationPrescription(NESTED_TABLE)?.branch === 'framed-table',
    'P62: THE #12996 SHAPE -- a `###` sub-heading inside `## Migration` does not close the section, so the rewrite table under it is still framed',
  );
  assert(
    findMigrationPrescription('## Migration\n\n### Response keys\n\n- `res.project` → `res.environment`\n')?.branch === 'framed-section',
    'P63: the same for the ARROW arm -- branches 2 and 3 read one framed region and both gain the nesting',
  );
  assert(
    hasMigrationPrescription('# Release\n\n## Migration\n\n### Keys\n\n#### Response\n\n- `a.b` → `a.c`\n'),
    'P64: nesting is by DEPTH, not by one level -- a `####` under a `###` under `## Migration` is still inside it',
  );
  assert(
    !hasMigrationPrescription('## Migration\n\n- see below\n\n## Notes\n\n| Member | Behaviour |\n| --- | --- |\n| `a.b` | now resolves through `c.d` |\n'),
    'P65: FLOOR -- a SIBLING heading still closes the region; the fix widens where a region ends, it does not remove the end',
  );
  assert(
    !hasMigrationPrescription('## Migration\n\n- see below\n\n# Appendix\n\n| Member | Behaviour |\n| --- | --- |\n| `a.b` | now resolves through `c.d` |\n'),
    'P66: FLOOR -- a SHALLOWER heading closes it too, so a migration section cannot frame the rest of the document',
  );
  assert(
    hasMigrationPrescription('## Migration\n\n### Method namespace\n\n- prose\n\n### Response keys\n\n| before | after |\n| --- | --- |\n| `res.project` | `res.environment` |\n'),
    'P67: framing is per-DEPTH, not one remembered level -- a second `###` sibling closes only its own level, and the `## Migration` region above it survives',
  );
  assert(
    !hasMigrationPrescription('## Method namespace\n\n### Response keys\n\n| Member | Behaviour |\n| --- | --- |\n| `a.b` | now resolves through `c.d` |\n'),
    'P68: FLOOR -- nesting propagates framing DOWNWARD only; an unframed outer heading frames nothing, whatever sits under it',
  );

  // ---- U1-U12 (#8299): unit pins on the runtime-interface-only primitives ----
  //
  // The path classifier is the half that decides what the reference scan even
  // reads, so a silent narrowing of it would make the exemption easier to hold
  // while every RIO case above stayed green.
  battery('U1-U12 (#8299): unit pins on the runtime-interface-only primitives');
  assert(metadataSurfaceKind('packages/spec/src/ai/agent.zod.ts') === 'a Zod schema', 'U1: a *.zod.ts is a metadata surface');
  assert(metadataSurfaceKind('packages/spec/src/contracts/data-driver.ts') === 'a spec contracts/** entry', 'U2: a spec contract is a metadata surface');
  assert(metadataSurfaceKind('examples/app-crm/src/objects/account.object.ts') === 'an object definition', 'U3: an object definition is a metadata surface');
  assert(metadataSurfaceKind('packages/services/service-package/src/index.ts') === null, 'U4: an ordinary runtime module is NOT a metadata surface');
  assert(metadataSurfaceKind('packages/spec/src/contracts/data-driver.test.ts') === null, 'U5: a test is not an authoring surface');
  assert(metadataSurfaceKind('node_modules/x/y.zod.ts') === null, 'U6: node_modules is never scanned');

  assert(parseSymbolRef('a/b.ts#Sym')?.symbol === 'Sym', 'U7: a path-qualified reference parses');
  assert(parseSymbolRef('PackagePublishResult') === null, 'U8: a bare name is not a symbol reference -- the measured #8277 homonym is why');
  assert(parseSymbolRef('#Sym') === null, 'U9: a reference with no path is refused');

  assert(exportedTypeDeclaration('export interface Foo { a: 1 }\n', 'Foo')?.kind === 'interface', 'U10: an exported interface resolves');
  assert(exportedTypeDeclaration('interface Foo { a: 1 }\n', 'Foo') === null, 'U11: an UNexported declaration reaches no consumer and resolves to nothing');
  {
    const PKGS = new Map([['@objectstack/core', { private: false, file: 'packages/core/package.json' }]]);
    assert(
      specifierNamesModule('@objectstack/core', 'packages/spec/src/x.zod.ts', 'packages/core/src/ports.ts', PKGS),
      'U12: a bare specifier resolves through the declaring path\'s own workspace package',
    );
    assert(
      !specifierNamesModule('../system/metadata-persistence.zod', 'packages/spec/src/contracts/metadata-service.ts', 'packages/services/service-package/src/index.ts', PKGS),
      'U12b: THE #8277 HOMONYM -- an import of the same NAME from another module names another module',
    );
  }

  // ---- MH1-MH12 (#25293): a same-named MEMBER declaration is a homonym ---------
  //
  // MH1 is the measured case in miniature: the spec contract's method signature
  // `IEmailService.renderTemplate` refused the retirement of the plugin's export
  // of the same name. The cure clears the member's own NAME only, so every other
  // shape below -- a call, a value, an access, a string, a parameter, a type
  // argument -- must still refuse, and the member beside a live call refuses on
  // the call (MH9).
  battery('MH1-MH12 (#25293): a same-named MEMBER declaration is a homonym; only its own name clears');
  {
    const SYM = 'renderTemplate';
    const ref = (text) => metadataSurfaceReference(
      SYM, 'packages/plugins/plugin-email/src/template-engine.ts',
      new Map([['packages/spec/src/contracts/email-service.ts', text]]), () => new Map(),
    );
    assert(ref('export interface IEmailService {\n  sendTemplate(input: SendTemplateInput): Promise<SendEmailResult>;\n  renderTemplate(input: RenderTemplateInput): Promise<RenderTemplateResult>;\n}\n') === null,
      'MH1: THE #25293 CASE -- an interface METHOD SIGNATURE of the same name is a homonym, not a reference');
    assert(ref('interface I {\n  readonly renderTemplate?: (body: string) => string;\n}\n') === null,
      'MH2: a PROPERTY signature, with a modifier and `?`, is a homonym');
    assert(ref('export type T = {\n  a: string,\n  renderTemplate: () => void,\n};\n') === null,
      'MH3: a member of a TYPE LITERAL alias is a homonym');
    assert(ref('interface I {\n  x: { renderTemplate(): void };\n}\n') === null,
      'MH4: a member of a type literal NESTED in an interface is a homonym');
    assert(ref('export class C {\n  renderTemplate(x: string): string {\n    return x;\n  }\n}\n') === null,
      'MH5: a CLASS method declared at the body\'s top depth is a homonym');
    assert(ref('export class C {\n  run(x: string) {\n    return renderTemplate(x);\n  }\n}\n')?.kind === 'mention',
      'MH6: FLOOR -- a call INSIDE a class method body is a mention: only the body\'s top depth declares members');
    assert(ref('export const X = renderTemplate("a");\n')?.kind === 'mention',
      'MH7: FLOOR -- a bare call is still a mention');
    assert(ref('interface I { a(): void }\nexport const y = svc.renderTemplate(1);\n')?.kind === 'mention',
      'MH8: FLOOR -- a member ACCESS is still a mention: the cure reads declarations, never uses');
    {
      const hit = ref('interface I {\n  renderTemplate(): void;\n}\nexport const z = renderTemplate("b");\n');
      assert(hit?.kind === 'mention' && /renderTemplate\("b"\)/.test(hit.line),
        `MH9: FLOOR -- a member signature BESIDE a live call refuses, on the call's line (not the file-wide clear a top-level declaration gets). Got: ${JSON.stringify(hit)}`);
    }
    assert(ref('interface I { a: "renderTemplate" }\n')?.kind === 'mention',
      'MH10: FLOOR -- a STRING literal is unchanged: it still refuses (strings are deliberately unmasked)');
    assert(ref('type F = (renderTemplate: string) => void;\n')?.kind === 'mention',
      'MH11: FLOOR -- a PARAMETER name in a function type is not a member declaration');
    assert(ref('interface I { a: Map<string, renderTemplate> }\n')?.kind === 'mention',
      'MH12: FLOOR -- a TYPE ARGUMENT is not a member declaration');
  }

  // ---- S1-S5: the `--audit-stock` classifier (#6350) ------------------------
  //
  // The stock audit's classifier decides which rows a human ever reads, so a
  // silent widening of either `exempt-*` arm shrinks the worklist invisibly --
  // #4690's failure mode wearing an audit's clothes. These pin all four arms plus
  // the one precedence rule between them. They live in the self-test (which CI
  // runs) even though the audit itself is operator-invoked, because the classifier
  // reuses the gate's judging functions and would rot with them.
  battery('S1-S5: the `--audit-stock` classifier (#6350)');
  {
    const PKGS = new Map([
      ['@objectstack/spec', { private: false, file: 'packages/spec/package.json' }],
      ['@objectstack/example-showcase', { private: true, file: 'examples/showcase/package.json' }],
    ]);
    const cls = (text) => classifyStockChangeset(parseChangeset(text), PKGS).klass;
    const PRESCRIPTION = '**BREAKING** x\n\n## 迁移\n\n- `a.b` → `a.c`\n';
    assert(
      cls(CS({ body: `${PRESCRIPTION}\n<!-- adr-0087: not-required (unpublished) whatever it says, a marker means the question was answered -->\n` })) === 'answered',
      'S1: a changeset carrying a parseable marker is ANSWERED, whatever else it contains',
    );
    assert(
      cls(CS({ bumps: [['@objectstack/example-showcase', 'major']], body: PRESCRIPTION })) === 'exempt-unpublished',
      'S2: an all-private bump is exempt even carrying a prescription -- nothing it breaks ships',
    );
    assert(
      cls(CS({ body: '**BREAKING** an internal error string changed; no key or symbol moves\n' })) === 'exempt-no-prescription',
      'S3: a published break that frames no rewrite is exempt',
    );
    assert(cls(CS({ body: PRESCRIPTION })) === 'residue', 'S4: THE #6011 SHAPE -- published break + prescription -- is RESIDUE');
    assert(
      cls(`---\n---\n\n${PRESCRIPTION}`) === 'residue',
      'S5: a changeset declaring NO package cannot buy the unpublished exemption (the gate refuses it too)',
    );
    assert(
      cls(CS({ bumps: [['@objectstack/spec', 'major'], ['@objectstack/example-showcase', 'major']], body: PRESCRIPTION })) === 'residue',
      'S6: ONE published package among the bumps is enough to close the unpublished exemption',
    );
    // S7 (#6497): the four stock changesets this arm moves are moved HERE -- out of
    // `exempt-no-prescription` and into the residue a human reads. Without the table
    // arm this returns `exempt-no-prescription`, which is the audit's half of the
    // same bypass: the worklist silently omitted them.
    const TABLE_PRESCRIPTION = '**BREAKING** x\n\n## Migration\n\n| Wrote | Write instead |\n| --- | --- |\n| `new HttpServer(p)` | register the `HonoHttpServer` |\n';
    assert(cls(CS({ body: TABLE_PRESCRIPTION })) === 'residue', 'S7: THE #6497 SHAPE -- published break + arrowless rewrite TABLE -- is RESIDUE');
  }

  // ---- PRE1-PRE3: `.changeset/pre/` is CONSUMED stock, not pending stock -----
  //
  // `@changesets/cli` v3 MOVES every changeset it consumes into `.changeset/pre/`
  // at the cut that consumes it, and `changesetDirAt` lists `.changeset`
  // RECURSIVELY (`ls-tree -r`). Without `isConsumedPrerelease` the entire consumed
  // stock of an open RC window flows into `--list` and `--audit-stock`, two
  // surfaces whose subject is the PENDING backlog. Measured on a real v3 cut of
  // this repo's stock: 209 consumed changesets, every one of them returned by
  // `git ls-tree -r --name-only <cut> -- .changeset`.
  //
  // PRE2 is the half that must NOT hold, and it is why the filter lives in
  // `changesetsAt` rather than in `isChangesetFile`: the enforcing scan reads the
  // diff through `isChangesetFile`, so a changeset ADDED under `.changeset/pre/`
  // by a PR is judged like any other. Filter the verdict instead of the audit and
  // `.changeset/pre/` becomes the place to put a breaking change you do not want
  // read.
  battery('PRE1-PRE3: `.changeset/pre/` is CONSUMED stock, not pending stock');
  {
    const { dir } = mk({
      files: {
        '.changeset/pre/consumed-one.md': CS({ body: 'consumed at the last cut\n\n**BREAKING** something\n' }),
        '.changeset/pre/consumed-two.md': CS({ body: 'consumed at the last cut\n\n**BREAKING** something else\n' }),
      },
    });
    const stock = changesetsAt('HEAD', dir);
    assert(
      stock.length === 1 && stock[0] === '.changeset/stock-breaking.md',
      `PRE1: the audit surfaces read PENDING stock only -- two consumed changesets under .changeset/pre/ must not appear -- got ${JSON.stringify(stock)}`,
    );
  }

  red('PRE2 a breaking changeset ADDED under .changeset/pre/ is still judged', run(mk({
    files: { '.changeset/pre/smuggled.md': SIX048 },
    pkgs: { '@objectstack/runtime': { dir: 'packages/runtime', private: false }, '@objectstack/spec': { dir: 'packages/spec', private: false } },
  })), [/smuggled/, /no `adr-0087:` disposition marker/]);

  {
    // PRE3: `entries` stays UNFILTERED. A tree whose changesets have all moved
    // into `.changeset/pre/` is the ordinary state of main mid-window; narrowing
    // the readability probe as well would turn it into a #4690 refusal and undo
    // #8658 by a different route. Pending stock is legitimately zero there.
    battery('PRE3: `entries` stays UNFILTERED. A tree whose changesets have all moved');
    const { dir } = mk({
      files: {
        '.changeset/stock-breaking.md': null,
        '.changeset/pre/consumed.md': CS({ body: 'consumed\n\n**BREAKING** something\n' }),
      },
    });
    const probs = assertInputs({ cwd: dir, head: 'HEAD', witness: parserWitness });
    assert(
      probs.length === 0,
      `PRE3: a tree holding ONLY consumed changesets under .changeset/pre/ is readable input, not a #4690 refusal -- got: ${probs.join('|')}`,
    );
    assert(
      changesetsAt('HEAD', dir).length === 0,
      `PRE3: ...and its PENDING stock is legitimately zero -- got ${JSON.stringify(changesetsAt('HEAD', dir))}`,
    );
  }

  assert(breakingDeclaration(parseChangeset(CS({ body: 'feat(spec)!: x\n' }))).breaking, 'P6: a conventional-commit bang is a declaration');
  assert(!breakingDeclaration(parseChangeset(CS({ bumps: [['a', 'patch']], body: 'plain\n' }))).breaking, 'P7: a plain patch is not');

  // ---- P9-P14 (#7004): the shapes the old entry anchor hid from signal (1) ---
  //
  // This gate's stake in #7004 is the PARTIAL miss: `breakingDeclaration` reads
  // three signals, and a `major` wearing a trailing YAML comment (or a quoted
  // bump value) used to vanish from signal (1) — leaving (2) `**BREAKING` and
  // (3) the `!` summary to carry a declaration they may not carry at all. So
  // each fixture below states the bump WITHOUT either of the other two signals:
  // a plain body, so `major` is the only thing that can make it breaking.
  //
  // Predicted direction on reverse verification: restoring the old anchor
  // (`([A-Za-z]+)\s*$`) turns P9-P13 red (breaking goes false, signals loses
  // `major`) and P14 red in the other direction (a phantom `# note` bump).
  battery('P9-P14 (#7004): the shapes the old entry anchor hid from signal (1)');
  const PLAIN = 'a summary line\n\nsome prose that is quite long indeed and explains the change.\n';
  const bumpsOf = (text) => parseChangeset(text).bumps.map((b) => `${b.pkg}=${b.bump}`);
  assert(
    bumpsOf(`---\n'@objectstack/spec': major # keep\n---\n\n${PLAIN}`).join(',') === '@objectstack/spec=major',
    'P9 (#7004): a trailing YAML comment still yields the `major` bump — changesets reads it as one',
  );
  assert(
    breakingDeclaration(parseChangeset(`---\n'@objectstack/spec': major # keep\n---\n\n${PLAIN}`)).signals.includes('major'),
    'P10 (#7004): signal (1) fires on a comment-bearing major, with no `**BREAKING` and no `!` in the body to carry it instead',
  );
  assert(
    breakingDeclaration(parseChangeset(`---\n'@objectstack/spec': "major"\n---\n\n${PLAIN}`)).signals.includes('major'),
    'P11 (#7004): signal (1) fires on a QUOTED bump value',
  );
  assert(
    breakingDeclaration(parseChangeset(`---\n'@objectstack/spec': 'major' # keep\n---\n\n${PLAIN}`)).signals.includes('major'),
    'P12 (#7004): signal (1) fires on a quoted bump value carrying a comment',
  );
  assert(
    !breakingDeclaration(parseChangeset(`---\n'@objectstack/spec': minor # keep\n---\n\n${PLAIN}`)).breaking,
    'P13 (#7004): control — the same comment-bearing shape with `minor` is NOT breaking, so P9-P12 are about the bump word and not about the comment merely being tolerated',
  );
  assert(
    bumpsOf(`---\n# note: major\n'@objectstack/real': patch\n---\n\n${PLAIN}`).join(',') === '@objectstack/real=patch',
    'P14 (#7004): a whole-line comment containing a colon is not a bump — it used to parse as a package named `# note` bumped major, i.e. a phantom breaking declaration',
  );
  assert(extractIds("  id: 'object-titleFormat-to-nameField',\n").length === 1, 'P8: an id with a capital letter must be extracted');

  // ---- I1 (#6566): a bare `import` of this module must NOT run the gate -----
  // The CLI dispatch at the bottom of this file is entry-guarded; importing the
  // module for its pure exports (readDisposition, extractIds, ...) must be
  // side-effect-free. The fixture is a RED-verdict repo (a declared-breaking
  // changeset, no marker) holding a copy of this very script, and the importer
  // is a child process whose only code borrows one pure function. Delete the
  // entry guard and all three assertions go red: the imported copy judges the
  // fixture repo, prints its verdict, `process.exit(1)`s, and the importer's
  // own line never runs -- the behaviour measured in #6566, which forced
  // PR #6556 into a subprocess fixture instead of an import.
  battery('I1 (#6566): a bare `import` of this module must NOT run the gate');
  {
    const { dir, base } = mk({
      files: { '.changeset/unanswered-breaking.md': CS({ body: '**BREAKING** x\n\nno marker here\n' }) },
    });
    // Park `main` back at BASE with the breaking changeset ahead of it on `work`:
    // an unguarded import default-resolves base to `main` and must judge the
    // changeset RED -- the caller-killing shape #6566 measured. With both commits
    // on `main` the ablated gate would see an empty diff and merely print a green
    // verdict, pinning the output leak but not the exit(1).
    git(['checkout', '-q', '-b', 'work'], dir);
    git(['branch', '-f', 'main', base], dir);
    const w = (rel, text) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    const copy = 'scripts/check-adr-0087-registration.mjs';
    // EVERY first-party module this file imports, TRANSITIVELY, travels with the
    // copy, or the fixture dies on ERR_MODULE_NOT_FOUND -- which reads as "I1 is
    // broken" rather than "the fixture is incomplete". `js-comment-mask.mjs`
    // (#12881) is the case that proved the closure has to be computed: it
    // arrived after `invoked-as.mjs` and took both I-cases red on a fixture
    // problem that had nothing to do with what they assert.
    //
    // ⭐ DERIVED, not listed, and derived by a module BOTH staging sites of this
    // gate import (#16421). It was a two-name list here and the same two-name
    // list in `objectui-changeset-digest.mjs`'s `fw-gate` sandbox. Signal (4)
    // added an edge to the clause-② declaration reader, then ten thousand lines
    // of sweep behind it; this site was updated in the same edit and the other was not,
    // and `check:objectui-changeset` went red in CI with an error naming neither
    // the import nor the manifest. One in two is the measured hit rate of "the
    // next author remembers", so neither site holds an opinion about the graph
    // any more. The statement-shaped rule that keeps the walk off quoted fixture
    // specifiers lives in `first-party-closure.mjs`'s header.
    const staged = stageFirstPartyClosure(copy, { root: REPO_ROOT, write: w });
    // ⭐ The derivation is ASSERTED, not trusted. A walk that silently came back
    // with only the entry would stage a runnable-looking fixture that dies the
    // moment signal (4) is reached, and the two I-cases below would again report
    // about the wrong thing. This names the one edge that made the list a graph.
    assert(
      staged.includes(copy) && staged.includes('scripts/pm/clause2-line.mjs'),
      `I1/I2: the staged closure must carry the gate AND the declaration reader it imports — got ${staged.length} file(s): ${staged.join(', ')}`,
    );
    // The staged copy's REPO_ROOT is this fixture, so the parser-rot witness looks
    // for `tsx` here (#22485). Borrowed from this checkout, and left untracked: the
    // fixture's history is the subject, its `node_modules` is not.
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'));
    w(
      'importer.mjs',
      "import { readDisposition } from './scripts/check-adr-0087-registration.mjs';\n" +
        "console.log('IMPORTER_OWN_LINE', JSON.stringify(readDisposition('nothing here')));\n",
    );
    const r = spawnSync(process.execPath, [join(dir, 'importer.mjs')], { cwd: dir, encoding: 'utf8' });
    const all = `${r.stdout}\n${r.stderr}`;
    assert(r.status === 0, `I1: a bare import must not adopt the gate's exit code (got ${r.status})\n${all}`);
    assert(
      r.stdout.includes('IMPORTER_OWN_LINE {"ok":false'),
      `I1: the importer's own code must run and receive the export\n${all}`,
    );
    assert(!all.includes('check-adr-0087-registration:'), `I1: importing must not print a gate verdict\n${all}`);

    // ---- I2 (#6566): the SAME file, run as the entry point, still dispatches --
    // I1 alone is satisfied by deleting the CLI block outright -- it only ever
    // asserts that nothing happens. I2 is its other half over the very same
    // fixture: the guard must let the entry point through, on both a branch that
    // exits non-zero and one that does not. Measured both ways: restore the
    // top-level dispatch and I1's three go red with I2 untouched; strip the CLI
    // block from the copied script and three of I2's four go red with I1
    // untouched.
    //
    // Why each exit-code assertion is PAIRED with an output one: the fourth,
    // `--list` exiting 0, stayed green under that second ablation -- a script
    // with no CLI at all also exits 0. An exit code cannot distinguish "the
    // branch ran and succeeded" from "nothing ran"; only the printed table can.
    battery('I2 (#6566): the SAME file, run as the entry point, still dispatches');
    const cli = (...args) => spawnSync(process.execPath, [join(dir, copy), ...args], { cwd: dir, encoding: 'utf8' });

    const gate = cli();
    assert(gate.status === 1, `I2: the entry point must still run the gate and exit 1 on red (got ${gate.status})\n${gate.stdout}\n${gate.stderr}`);
    assert(
      gate.stderr.includes('unanswered-breaking.md') && gate.stderr.includes('no `adr-0087:` disposition marker'),
      // The EXACT verdict, not merely "it is red": an entry point that died for
      // an unrelated reason also exits 1, and would pin nothing about dispatch.
      `I2: the entry point must report the real verdict\n${gate.stdout}\n${gate.stderr}`,
    );

    const listed = cli('--list');
    assert(listed.status === 0, `I2: --list must still dispatch and exit 0 (got ${listed.status})\n${listed.stdout}\n${listed.stderr}`);
    assert(
      listed.stdout.includes('declared-breaking changeset(s) in stock'),
      `I2: --list must still print its table\n${listed.stdout}\n${listed.stderr}`,
    );
  }

  for (const d of cleanup) rmSync(d, { recursive: true, force: true });

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => {
    failures.push(message);
  };
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

  if (failures.length) {
    console.error(`✗ check-adr-0087-registration --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}\n`);
    process.exit(1);
  }
  console.log(`✓ check-adr-0087-registration --self-test: ${checked} assertions over real temp git repos (real scan()/assertInputs() path)`);

  return SELF_TEST_VERDICT;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
//
// Entry-guarded (#6566): the dispatch below runs ONLY when this file is the
// process entry point (the `objectui-changeset-digest.mjs` pattern). No branch
// is a no-op and four of them `process.exit(1)` on red, so an unguarded top
// level made `import` mean "run the gate against the IMPORTER's repo and adopt
// its verdict as my exit code" -- PR #6556 paid a ~40-line subprocess fixture
// to avoid exactly that. The exported pure functions (readDisposition,
// extractIds, ...) are the module's import surface; the CLI is this block, and
// the I1/I2 self-test assertions pin BOTH halves of the separation -- silent as
// an import, unchanged as an entry point.

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const readFlag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (argv.includes('--self-test')) {
    // The self-test drives `runtime-export-retired` through the shipping `scan()`,
    // which reads exports with the compiler -- loaded here, once, as the gate's own
    // entry point loads it (#22918).
    await loadExportReader();
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-adr-0087-registration self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else if (argv.includes('--list')) {
    list(REPO_ROOT, 'HEAD');
  } else if (argv.includes('--audit-stock')) {
    auditStock(REPO_ROOT, readFlag('--head') ?? 'HEAD');
  } else {
    const head = readFlag('--head') ?? 'HEAD';
    const requested = readFlag('--base');
    let base = requested;
    if (base) {
      if (!resolveCommit(base, REPO_ROOT)) {
        console.error(`⛔ check-adr-0087-registration: --base '${base}' does not resolve to a commit.`);
        console.error('   A base that cannot be resolved is a failure, never a pass (#4690).');
        process.exit(1);
      }
    } else {
      base = ['origin/main', 'main'].find((r) => resolveCommit(r, REPO_ROOT));
      if (!base) {
        console.error('⛔ check-adr-0087-registration: neither origin/main nor main resolves in this checkout.');
        console.error('   Pass one explicitly: --base <ref-or-sha>. Missing input is a failure, never a pass (#4690).');
        process.exit(1);
      }
    }

    const inputProblems = assertInputs({ cwd: REPO_ROOT, head });
    if (inputProblems.length > 0) {
      console.error(`\n✗ check-adr-0087-registration: ${inputProblems.length} input problem(s) -- refusing to report a verdict.\n`);
      for (const p of inputProblems) console.error(`  • ${p}\n`);
      console.error('  A gate that cannot find its input and exits 0 is worse than no gate (#4690).');
      process.exit(1);
    }

    let result;
    try {
      result = scan({ cwd: REPO_ROOT, base, head });
      // Only a PR whose changeset names `runtime-export-retired` pays for the
      // compiler (#22918): load it, then judge the same diff again with it.
      if (result.needsExportReader) {
        await loadExportReader();
        result = scan({ cwd: REPO_ROOT, base, head });
      }
    } catch (e) {
      console.error(`⛔ check-adr-0087-registration: ${e.message}`);
      process.exit(1);
    }

    if (result.problems.length > 0) {
      report(result.problems);
      process.exit(1);
    }

    const n = result.judged.length;
    if (n === 0) {
      console.log(`✓ check-adr-0087-registration: this PR adds no declared-breaking changeset (${result.skipped.length} non-breaking changeset(s) seen).`);
    } else {
      console.log(`✓ check-adr-0087-registration: ${n} declared-breaking changeset(s), each carrying an ADR-0087 disposition.`);
      for (const j of result.judged) {
        const what = j.verdict === 'registered'
          ? `registered ${j.ids.join(', ')} (new here: ${j.fresh.join(', ')})`
          : `not-required (${j.category})${j.detail ? ` -- verified: ${j.detail}` : ''}`;
        console.log(`    ${j.file}  [${j.signals.join('+')}]  ${what}`);
        if (j.why) {
          // Every exemption is printed AND annotated, on every run: an exemption
          // nobody re-reads is the allow-list failure mode this gate exists to avoid.
          console.log(`        reason: ${j.why}`);
          console.log(`::notice file=${j.file}::ADR-0087 exemption (${j.category}): ${j.why}`);
        }
      }
    }
  }
}
