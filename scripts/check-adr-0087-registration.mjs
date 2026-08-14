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
//   <!-- adr-0087: not-required (unpublished) <why> -->
//   <!-- adr-0087: not-required (already-registered <id>[, <id>...]) <why> -->
//   <!-- adr-0087: not-required (no-migration-prescription) <why> -->
//   <!-- adr-0087: not-required (runtime-interface-only <path>#<Symbol>[, ...]) <why> -->
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
//                            metadata surface and is referenced by none, so
//                            `objectstack migrate meta` provably has nothing to
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
//   4. NO metadata surface REFERENCES it. Steps 2-3 only say where the symbol was
//      born; a plain runtime interface pulled into a schema (`z.custom<Iface>()`)
//      or into an object definition has a metadata surface anyway.
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
//   * PARSER ROT -- every `migrationId` in the generated `spec-changes.json` must
//     be found by the source parser. If the registry is ever refactored to a
//     declaration shape the regex stops matching, the id set silently shrinks and
//     every `registered` claim would start failing; this catches it as parser drift
//     instead. The direction is deliberate (projection is a SUBSET of source): a
//     new entry not yet regenerated is `check:spec-changes`'s red, not this one's,
//     so the two gates never double-report the same fact.
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
// Zero third-party dependencies, so it can run in a minimal CI environment before
// `pnpm install` -- the same constraint its neighbours in the Check Changeset job
// carry.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/** The ADR-0087 ledger sources. Order matters only for reporting. */
export const LEDGER_SOURCES = [
  'packages/spec/src/migrations/registry.ts',
  'packages/spec/src/conversions/registry.ts',
];

/** The generated projection used to prove the source parser still matches (#4690). */
const SPEC_CHANGES = 'packages/spec/spec-changes.json';

/** Package roots holding workspace manifests, for the `unpublished` precondition. */
const PACKAGE_ROOTS = ['packages', 'apps', 'examples'];

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
];

/** The ADR whose disposition vocabulary this gate enforces (#8299). */
const ADR_0087 = 'docs/adr/0087-metadata-protocol-upgrade-contract.md';

// ---------------------------------------------------------------------------
// Changeset reading
// ---------------------------------------------------------------------------

/** `.changeset/README.md` is documentation, never a changeset. */
const isChangesetFile = (p) => p.startsWith('.changeset/') && p.endsWith('.md') && !p.endsWith('/README.md');

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
 * Three spellings are in live use in this repo and all three count, because the
 * gate's subject is the author's own declaration and an author who used any of
 * them has declared it:
 *
 *   1. a `major` bump in the frontmatter                (118 of 1304 in stock)
 *   2. a `**BREAKING` marker in the body                 (52)
 *   3. a conventional-commit `!` in the summary line     (175)
 *
 * The union is 213. Narrowing to any one of them would drop real declarations:
 * #6048's changeset used (1) and (2) and NOT (3), while the launch-window guard
 * `check-changeset-no-major.mjs` pushes breaking changes to `minor` outside
 * pre-mode, which would leave (2)/(3) carrying the signal alone.
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
//      heading that carries it. This is the branch that catches
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
 * A migration-framing word sitting immediately before the placeholder FRAMES it; it
 * does not govern it (`Migration FROM → TO`, `迁移 FROM → TO`). Anchored at the end
 * because that is the only position where the distinction can arise.
 */
const FRAMING_TAIL_RE =
  /(?:迁移|改写|改名|升级|migrat(?:e|es|ed|ing|ion|ions)|rename[sd]?|rewrit(?:e|es|ten|ing)|upgrade[sd]?)$/i;

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
 * @param {string} line the line the `FROM` token sits on
 * @param {number} col  its column within that line
 * @param {string} [prev] the line above it, when there is one (#7094)
 */
function labelPositioned(line, col, prev) {
  if (/^\s{0,3}#{1,6}\s/.test(line)) return true;
  const prefix = line.slice(0, col).replace(/\s+$/, '');
  if (prefix !== '') return !GOVERNING_WORD_RE.test(prefix.replace(FRAMING_TAIL_RE, ''));
  // The placeholder OPENS its line -- bare or merely indented, so a wrapped list
  // item counts. There is no character to its left, so the governing word, if there
  // is one, is the last word of the line above; and only a line that is prose the
  // sentence can run on from is asked (#7094).
  if (prev === undefined || STRUCTURAL_LINE_RE.test(prev)) return true;
  return !WRAPPED_GOVERNOR_RE.test(prev.replace(/\s+$/, ''));
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
  let inTable = false;
  let sawFromBlock = false;
  for (const line of body.split(/\r?\n/)) {
    if (REWRITE_RE.test(line)) return true;
    if (VERTICAL_FROM_RE.test(line)) sawFromBlock = true;
    else if (sawFromBlock && VERTICAL_TO_RE.test(line)) return true;
    if (TABLE_DELIM_RE.test(line)) { inTable = true; continue; }
    if (!TABLE_ROW_RE.test(line)) { inTable = false; continue; }
    if (inTable && isRewriteRow(line)) return true;
  }
  return false;
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
 * @returns {{ branch: 'from-to-label' | 'framed-line' | 'framed-section' | 'framed-table' | 'header-framed-table', line: string } | null}
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
    if (!labelPositioned(lines[lineNo] ?? '', at - lineStart, lineNo > 0 ? lines[lineNo - 1] : undefined)) {
      if (corroborated === null) corroborated = carriesConcreteRewrite(body);
      if (!corroborated) continue;
    }
    return { branch: 'from-to-label', line: (lines[lineNo] ?? m[0]).trim() };
  }

  // A heading carrying migration framing opens a framed region that runs to the
  // next heading. Without it, the most natural way to write a prescription --
  // `## 迁移` followed by a list of `old` → `new` lines -- would be invisible,
  // which is the #6419 defect in a second spelling.
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
  let prev = '';
  for (const line of lines) {
    if (/^\s{0,3}#{1,6}\s/.test(line)) {
      framedSection = MIGRATION_FRAMING_RE.test(line);
      inTable = false; // a table cannot span a heading
      headerFramed = false;
    }
    if (REWRITE_RE.test(line)) {
      if (MIGRATION_FRAMING_RE.test(line)) return { branch: 'framed-line', line: line.trim() };
      if (framedSection) return { branch: 'framed-section', line: line.trim() };
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
  return table ?? headerTable;
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

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

function git(args, cwd) {
  // stderr is PIPED, not inherited: `showOrNull` probes paths that legitimately do
  // not exist at a rev (a ledger file added mid-history, a changeset deleted), and
  // git's "fatal: path ... does not exist" would otherwise print as though the gate
  // had failed while it is in fact answering the question it asked.
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
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
      cwd, input, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
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
 * "actual changesets", or `null` when the tree itself cannot be listed.
 *
 * The split is what lets `assertInputs` tell an EMPTY STOCK (zero pending
 * changesets — the legitimate state of main right after a release cut, #8658)
 * apart from a MISSING DIRECTORY (not even the tracked README.md/config.json
 * found — unreadable input, still a #4690 refusal).
 *
 * @returns {{ entries: string[], changesets: string[] } | null}
 */
function changesetDirAt(rev, cwd) {
  let out;
  try { out = git(['ls-tree', '-r', '--name-only', rev, '--', '.changeset'], cwd); } catch { return null; }
  const entries = out.split('\n').map((s) => s.trim()).filter(Boolean);
  return { entries, changesets: entries.filter(isChangesetFile) };
}

/** Every changeset path present at a rev. */
function changesetsAt(rev, cwd) {
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
    const src = showOrNull(rev, path, cwd);
    if (src === null) { missingSources.push(path); continue; }
    const found = extractIds(src);
    bySource[path] = found.length;
    for (const id of found) ids.add(id);
  }
  return { ids, bySource, missingSources };
}

// ---------------------------------------------------------------------------
// Input assertions -- absence is never a pass (#4690)
// ---------------------------------------------------------------------------

/**
 * Prove every input this gate reasons over is present and non-empty BEFORE any
 * verdict is produced. Each failure here is a red, never a skip.
 *
 * @param {{ cwd: string, head: string }} opts
 * @returns {string[]} problems
 */
export function assertInputs({ cwd, head }) {
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
      `ADR-0087 ledger source not found at HEAD: ${path}\n` +
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

  // (3) PARSER ROT -- the generated projection is the independent witness that the
  //     source parser still sees what the build sees. Projection must be a SUBSET of
  //     source: a new entry not yet regenerated is `check:spec-changes`'s red, not
  //     ours, so the two gates never double-report one fact.
  const rawSpecChanges = showOrNull(head, SPEC_CHANGES, cwd);
  if (rawSpecChanges === null) {
    problems.push(
      `${SPEC_CHANGES} not found at HEAD.\n` +
      '    It is this gate\'s only independent witness that the ledger parser still matches the\n' +
      '    registry\'s declaration shape. Without it the parser could rot unnoticed.',
    );
  } else {
    let parsed = null;
    try { parsed = JSON.parse(rawSpecChanges); } catch (e) {
      problems.push(`${SPEC_CHANGES} does not parse as JSON: ${e.message}`);
    }
    if (parsed) {
      const projected = projectedMigrationIds(parsed);
      if (projected.length === 0) {
        problems.push(
          `${SPEC_CHANGES} carries no \`migrationId\` at all.\n` +
          '    The projection is this gate\'s witness for the source parser; an empty witness\n' +
          '    witnesses nothing (#4690).',
        );
      }
      const unseen = projected.filter((id) => !ids.has(id));
      if (unseen.length > 0) {
        problems.push(
          `ledger parser drift: ${unseen.length} id(s) present in the generated ${SPEC_CHANGES}\n` +
          `    are NOT found by extractIds() in ${LEDGER_SOURCES[0]}:\n` +
          unseen.slice(0, 8).map((id) => `      - ${id}`).join('\n') +
          (unseen.length > 8 ? `\n      ... and ${unseen.length - 8} more` : '') +
          '\n    The registry\'s declaration shape changed underneath this gate. Left alone, the id\n' +
          '    set shrinks silently and every `registered` disposition starts failing for the wrong\n' +
          '    reason. fix: widen extractIds() to match the new shape, in the same PR that changes it.',
        );
      }
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
  ];
  const MUST_NOT_MATCH_BREAKING = [
    ['a plain `patch` changeset', "---\n'@objectstack/spec': patch\n---\n\nfix a typo\n"],
    ['a `minor` changeset whose prose merely contains the word breaking', "---\n'@objectstack/spec': minor\n---\n\nnothing groundbreaking here\n"],
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

  return problems;
}

// ---------------------------------------------------------------------------
// Workspace manifests -- the `unpublished` precondition
// ---------------------------------------------------------------------------

/**
 * name -> { private, file } for every workspace package at a rev.
 *
 * Read from git rather than the working tree so the whole gate is a pure function
 * of two revs, which is what lets the self-test drive the shipping code path with
 * real temp repositories instead of an imitation of it.
 */
export function workspacePackagesAt(rev, cwd) {
  const pkgs = new Map();
  let out;
  try { out = git(['ls-tree', '-r', '--name-only', rev], cwd); } catch { return pkgs; }
  const manifests = out
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p.endsWith('/package.json') && !p.includes('node_modules/') && PACKAGE_ROOTS.some((r) => p.startsWith(`${r}/`)));
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
const IDENT_RE = new RegExp(`^${IDENT}$`);

/** `path/to/file.ts#Symbol` -> its two halves, or null when it is not that shape. */
export function parseSymbolRef(ref) {
  const at = ref.indexOf('#');
  if (at <= 0) return null;
  const path = ref.slice(0, at);
  const symbol = ref.slice(at + 1);
  if (!IDENT_RE.test(symbol) || path.includes('#') || symbol.length === 0) return null;
  return { path, symbol };
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
  return m ? { kind: m[1], rest: m[2] } : null;
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
    const word = new RegExp(`\\b${symbol}\\b`);
    let refused = false;
    for (const [hitPath, hitText] of surfaces()) {
      if (hitPath === path || !word.test(hitText)) continue;
      // A file that declares the name itself is a HOMONYM, not a reference -- the
      // measured `PackagePublishResult` pair in the header is exactly this case.
      if (declaresLocally(hitText, symbol)) continue;
      const specifiers = importSpecifiersFor(hitText, symbol);
      const pkgs = packages();
      if (specifiers.length > 0) {
        if (!specifiers.some((s) => specifierNamesModule(s, hitPath, path, pkgs))) continue; // imported from elsewhere
        problems.push(
          `\`runtime-interface-only ${ref}\` is false: ${hitPath} (${metadataSurfaceKind(hitPath)})\n` +
          `      IMPORTS \`${symbol}\` from the module that declares it.\n` +
          '      A runtime interface pulled into a metadata surface HAS a metadata surface, wherever it\n' +
          '      was declared. That is what step 4 of the predicate exists to catch.',
        );
        refused = true;
        break;
      }
      const line = (hitText.split(/\r?\n/).find((l) => word.test(l)) ?? '').trim();
      problems.push(
        `\`runtime-interface-only ${ref}\` cannot be verified: ${hitPath} (${metadataSurfaceKind(hitPath)})\n` +
        `      mentions \`${symbol}\` while neither declaring nor importing it:\n` +
        `        ${line.slice(0, 140)}\n` +
        '      Unresolvable, so refused rather than assumed unrelated (#4690). If it truly is a\n' +
        '      different symbol, the honest disposition is one that can be checked.',
      );
      refused = true;
      break;
    }
    if (refused) continue;

    verified.push({ ref, kind: decl.kind });
  }

  return { problems, verified };
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

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

    // The two remaining categories both assert that no consumer has a metadata
    // rewrite to perform, so BOTH are refused by a body that prescribes one.
    // `runtime-interface-only` inheriting this refusal is what makes it a NARROWING
    // of `no-migration-prescription` rather than a fifth way around it (#8299):
    // nothing the detector refuses today becomes claimable by renaming the category.
    const prescription = findMigrationPrescription(parsed.body);
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
        '      inherits this same refusal (#8299).',
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

    judged.push({ file, verdict: 'not-required', category: d.category, why: d.why, signals: decl.signals });
  }

  return { problems, judged, skipped, base: from, ledgerAdded };
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
    if (LEDGER_SOURCES.some((src) => names.includes(src))) hits.push(sha);
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

function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    checked++;
    if (!cond) failures.push(msg);
  };

  const REG = (ids) =>
    'export const X = {\n  semantic: [\n' +
    ids.map((i) => `    {\n      id: '${i}',\n      surface: 's',\n    },`).join('\n') +
    '\n  ],\n};\n';
  const CONV = (ids) => REG(ids);
  const SPEC_CHANGES_JSON = (ids) =>
    JSON.stringify({ perMajor: [{ to: 17, migrated: ids.map((id) => ({ migrationId: id })) }] }, null, 2);

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

  const build = ({ baseIds = ['old-entry-one', 'old-entry-two'], headIds = null, files = {}, baseFiles = {}, pkgs = null }) => {
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
    w(SPEC_CHANGES, SPEC_CHANGES_JSON(baseIds));
    w(ADR_0087, ADR_DOC());
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

    if (headIds) {
      w(LEDGER_SOURCES[0], REG(headIds));
      w(SPEC_CHANGES, SPEC_CHANGES_JSON(headIds));
    }
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

  // ---- G1: a non-breaking changeset is not this gate's business -------------
  green('G1 non-breaking changeset ignored', run(mk({
    files: { '.changeset/nb.md': CS({ bumps: [['@objectstack/spec', 'patch']], body: 'a patch\n\nprose.\n' }) },
  })));

  // ---- R1: THE #6011 SHAPE -- declared breaking, no ledger entry, no marker --
  // #6048's changeset reconstructed: major + **BREAKING** + a FROM -> TO block,
  // and nothing said about the ledger.
  const SIX048 = CS({
    bumps: [['@objectstack/runtime', 'major']],
    body: '**BREAKING**: `ctx.user.roles` removed\n\n### 迁移:FROM → TO\n\n```js\n// FROM\nctx.user.roles;\n// TO\nctx.user.positions;\n```\n',
  });
  red('R1 the #6011 shape (breaking, no disposition)', run(mk({
    files: { '.changeset/tidy-donkeys-yawn.md': SIX048 },
    pkgs: { '@objectstack/runtime': { dir: 'packages/runtime', private: false }, '@objectstack/spec': { dir: 'packages/spec', private: false } },
  })), [/tidy-donkeys-yawn/, /no `adr-0087:` disposition marker/, /#6148/, /adr-0087: registered/]);

  // ---- R2: the catch-all exemption cannot cover a FROM -> TO prescription ----
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
  red('R3 registered names a nonexistent id', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: registered no-such-entry -->\n' }) },
  })), [/do not exist in/, /no-such-entry/]);

  // ---- R4: `registered` claiming a registration this PR did not make --------
  red('R4 registered names only pre-existing ids', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: registered old-entry-one -->\n' }) },
  })), [/none of those ids is NEW in this diff/, /already-registered/]);

  // ---- G3: already-registered, naming a genuinely pre-existing entry --------
  green('G3 already-registered on a base entry', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (already-registered old-entry-one) the same rename this entry already covers, second half -->\n' }),
    },
  })));

  // ---- R5: already-registered pointing at an id this diff just added --------
  red('R5 already-registered names a freshly added id', run(mk({
    headIds: ['old-entry-one', 'old-entry-two', 'brand-new-entry'],
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (already-registered brand-new-entry) this pre-existing entry already covers the change completely -->\n' }),
    },
  })), [/names only id\(s\) this very diff ADDS/, /adr-0087: registered brand-new-entry/]);

  // ---- R6: `unpublished` claimed for a published package --------------------
  red('R6 unpublished is false', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (unpublished) this is only our internal build tooling and ships to nobody -->\n' }),
    },
  })), [/is PUBLISHED/, /@objectstack\/spec/]);

  // ---- G4: `unpublished` on a genuinely private package ---------------------
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
  red('R7 unknown category', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (whatever-i-like) because I say so and this is a long enough sentence -->\n' }) },
  })), [/unknown `not-required` category/, /vocabulary is closed/]);

  // ---- R8: an empty justification is refused --------------------------------
  red('R8 justification too short', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (no-migration-prescription) n/a -->\n' }) },
  })), [/character justification/]);

  // ---- G5: the catch-all, on a changeset carrying no prescription -----------
  green('G5 no-migration-prescription with no FROM/TO in the body', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (no-migration-prescription) an internal error string changed; no key, symbol or stored value moves -->\n' }),
    },
  })));

  // ---- R9: two markers is ambiguous, not "the first one wins" ---------------
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

  // ---- The #8299 category: `runtime-interface-only` -------------------------
  //
  // The fixture is the REAL shape, in miniature: `PackagePublishResult` names two
  // unrelated symbols in this repo -- the runtime service interface PR #8277
  // changed, and a Zod projection in `packages/spec` that a spec contract imports.
  // Every accept/refuse pair below is driven off that collision on purpose: the
  // predicate is only worth having if the SAME NAME under two paths comes out two
  // different ways, which is what a bare-name grep cannot do.
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

  // RIO-R3: an object definition MENTIONS it, neither declaring nor importing it.
  // Unresolvable, so refused rather than assumed unrelated (#4690).
  red('RIO-R3 an unresolvable mention in an object definition is refused', run(mk({
    pkgs: RIO_PKGS,
    files: {
      ...RIO_FILES,
      'packages/core/src/ports.ts': 'export interface StoragePort { read(): Promise<string> }\n',
      'examples/app-crm/src/objects/account.object.ts':
        'export const account = {\n  name: "account",\n  // shaped by StoragePort at publish time\n};\n',
      '.changeset/x.md': RIO_CS('runtime-interface-only packages/core/src/ports.ts#StoragePort'),
    },
  })), [/cannot be verified/, /account\.object\.ts/, /neither declaring nor importing/]);

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

  // ---- G6: a changeset that was ALREADY breaking at base is inherited -------
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
  {
    const r = mk({ files: {} });
    assert(assertInputs({ cwd: r.dir, head: 'HEAD' }).length === 0, 'I0: a well-formed repo must produce no input problems');
  }
  {
    // parser rot: the projection knows an id the source parser cannot see
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-rot-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w(LEDGER_SOURCES[0], REG(['seen-one']));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(SPEC_CHANGES, SPEC_CHANGES_JSON(['seen-one', 'invisible-to-the-parser']));
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
    w(SPEC_CHANGES, SPEC_CHANGES_JSON(['seen-one']));
    w(ADR_0087, ADR_DOC());
    w('.changeset/quiet.md', CS({ bumps: [['@objectstack/spec', 'patch']], body: 'nothing breaking here\n' }));
    git(['add', '-A'], dir); git(['commit', '-qm', 'base'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD' });
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
    w(SPEC_CHANGES, SPEC_CHANGES_JSON(['seen-one']));
    w(ADR_0087, ADR_DOC());
    w('.changeset/README.md', '# Changesets\n\ndocumentation only\n');
    w('.changeset/config.json', '{}\n');
    git(['add', '-A'], dir); git(['commit', '-qm', 'post-cut base'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD' });
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
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-nodir-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w(LEDGER_SOURCES[0], REG(['seen-one']));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(SPEC_CHANGES, SPEC_CHANGES_JSON(['seen-one']));
    w(ADR_0087, ADR_DOC());
    git(['add', '-A'], dir); git(['commit', '-qm', 'no changeset dir'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD' });
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
    const r = mk({ files: {} });
    const probs = assertInputs({ cwd: r.dir, head: 'HEAD' });
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
    const probs = assertInputs({ cwd: dir, head: 'HEAD' });
    assert(probs.some((p) => /ledger source not found/.test(p)), `I3: a missing ledger must be RED, got: ${probs.join('|')}`);
  }
  {
    // V1/V2 (#8299): the vocabulary and its written description are ONE decision.
    // Checked in both directions, because the two failures are different and both
    // are real -- an exemption nobody can look up, and an exemption nobody can claim.
    const r = mk({ files: {} });
    writeFileSync(join(r.dir, ADR_0087), ADR_DOC(CATEGORIES.filter((c) => c !== 'runtime-interface-only')));
    git(['commit', '-qam', 'undocument a category'], r.dir);
    const probs = assertInputs({ cwd: r.dir, head: 'HEAD' });
    assert(
      probs.some((p) => /category documented nowhere/.test(p) && /runtime-interface-only/.test(p)),
      `V1: a category CATEGORIES accepts and the ADR omits must be RED, got: ${probs.join('|')}`,
    );

    const r2 = mk({ files: {} });
    writeFileSync(join(r2.dir, ADR_0087), ADR_DOC([...CATEGORIES, 'sounds-plausible']));
    git(['commit', '-qam', 'document a category nothing implements'], r2.dir);
    const probs2 = assertInputs({ cwd: r2.dir, head: 'HEAD' });
    assert(
      probs2.some((p) => /category documented but not accepted/.test(p) && /sounds-plausible/.test(p)),
      `V2: a category the ADR describes and CATEGORIES rejects must be RED, got: ${probs2.join('|')}`,
    );

    // V3: the real repository is the case that matters -- this gate's own vocabulary
    // and the real ADR must agree at the tip being tested, not just in fixtures.
    const realAdr = readFileSync(join(REPO_ROOT, ADR_0087), 'utf8');
    const documented = documentedCategories(realAdr);
    for (const c of CATEGORIES) assert(documented.has(c), `V3: ${ADR_0087} must document the \`${c}\` category`);
    for (const c of documented) assert(CATEGORIES.includes(c), `V3: ${ADR_0087} documents \`${c}\`, which CATEGORIES does not accept`);
  }

  // ---- Unit pins on the two pattern-shaped judgements ----------------------
  //
  // P1-P3 are the LABEL branch, unchanged since #6148 -- the template placeholder
  // must keep matching, or the #6048 shape stops being caught. P4-P5 are the
  // original false-positive floor. P9-P17 are #6419: the branch that reads real
  // prescriptions, and the prose shapes it must still refuse.
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

  // ---- U1-U12 (#8299): unit pins on the runtime-interface-only primitives ----
  //
  // The path classifier is the half that decides what the reference scan even
  // reads, so a silent narrowing of it would make the exemption easier to hold
  // while every RIO case above stayed green.
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

  // ---- S1-S5: the `--audit-stock` classifier (#6350) ------------------------
  //
  // The stock audit's classifier decides which rows a human ever reads, so a
  // silent widening of either `exempt-*` arm shrinks the worklist invisibly --
  // #4690's failure mode wearing an audit's clothes. These pin all four arms plus
  // the one precedence rule between them. They live in the self-test (which CI
  // runs) even though the audit itself is operator-invoked, because the classifier
  // reuses the gate's judging functions and would rot with them.
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
    w(copy, readFileSync(fileURLToPath(import.meta.url), 'utf8'));
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

  if (failures.length) {
    console.error(`✗ check-adr-0087-registration --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}\n`);
    process.exit(1);
  }
  console.log(`✓ check-adr-0087-registration --self-test: ${checked} assertions over real temp git repos (real scan()/assertInputs() path)`);
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

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const readFlag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (argv.includes('--self-test')) {
    selfTest();
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
