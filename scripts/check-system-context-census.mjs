#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-system-context-census -- holds `content/docs/permissions/system-context.mdx`
 * to the code it claims to enumerate.
 *
 *   node scripts/check-system-context-census.mjs
 *   node scripts/check-system-context-census.mjs --self-test
 *   node scripts/check-system-context-census.mjs --fix   # regenerates declared COUNTS; anchors still need a human -- see below
 *
 * That page declares itself "the authority" for every platform behaviour keyed off
 * `ExecutionContext.isSystem`, and says it is "built by census over the whole repo,
 * not by recall". Nothing held it to either claim. Measured over the 19 days after
 * its census was written:
 *
 *   111 anchors on the page          101 pointed at a line that no longer held
 *                                    what the row named; 10 were still correct
 *   read sites in the code            83 -> 109; 28 arrived, 2 were deleted
 *   the page's headline               "80 sites across 18 packages", while its own
 *                                     tables anchored 77 and the code held 109
 *
 * ## ⭐ Why the POPULATION check is the mandatory half
 *
 * The obvious gate resolves every anchor the page writes. That gate would have been
 * ALL GREEN at the commit above -- while the page was missing 32 sites and its
 * headline was 29 too low.
 *
 *   ⭐ A gate that only checks what the page already says can never find what the
 *      page failed to say.
 *
 * So the load-bearing direction is CENSUS -> PAGE: every read site in the code must
 * carry an anchor. The other direction (PAGE -> CENSUS) is worth having and cheap,
 * but it is the second gate, not the first.
 *
 * Deletions are caught here by the counts, which are census-derived: lose a site
 * and the page's declared total stops being true.
 *
 * ## ⭐ Why the anchors are `path#symbol` and no longer `path:line` (#15921)
 *
 * A line number is not an anchor form anywhere in this repo any more. The
 * `docs/adr/**` migration measured 243 of 337 live line anchors broken -- 72.1%,
 * a one-way lower bound -- and ruled the whole class out; this page joins that
 * ruling as a CORPUS REGISTRATION against the same resolver, never a second
 * implementation of it. `CORPUS` below is a `defineCorpus` call and nothing else;
 * the grammar, the extractor and the resolution rule live in
 * `scripts/symbol-anchors.mjs`, whose header is authoritative.
 *
 * ⛔ The resolver is deliberately NOT widened to understand spans. That was the
 * other option on the ruling (a span-aware resolver plus per-read disambiguation
 * in the colliding files) and it is its own card, to be taken if the gap below is
 * ever measured to have let a deletion through.
 *
 * ## ⚠️ What that costs, measured rather than asserted
 *
 * A symbol anchor cannot say WHICH read inside a symbol it means. Measured on the
 * tree this migration ran against: 106 read sites live in 89 distinct symbols
 * across 45 files, and 9 of those files hold more than one read inside a single
 * symbol (`packages/objectql/src/engine.ts` and `packages/rest/src/rest-server.ts`
 * are the widest, at 10
 * reads in 9 symbols and 6 reads in 2). So:
 *
 *   ⭐ Delete a whole symbol and this gate REDS -- twice over: the anchor stops
 *      resolving, and the census's symbol set for that file stops matching the
 *      page's.
 *   ⚠️ Delete ONE of several reads inside a symbol that keeps at least one, and
 *      the symbol set does not move, so this gate may NOT red.
 *
 * That second line is the precision the line numbers had and these anchors do
 * not. It is the reason the page carries the same warning where a reader meets
 * the anchors: a gap stated on the instrument and not on the artifact is a gap
 * only the instrument's author knows about. ⛔ It is NOT closed by adding a
 * count of reads per file -- a count of reads cannot be satisfied by a page whose
 * anchors are symbols, which is precisely why the population rule is per file and
 * per symbol.
 *
 * ## The four checks
 *
 *   A  RESOLUTION   delegated WHOLE to `sweepCorpus` over the `CORPUS`
 *                   registration below: every anchor names a tracked file, every
 *                   `#symbol` has a declaration site in it, and a surviving line
 *                   number is a hard finding. ⛔ This gate re-implements none of
 *                   that -- a sweep that could not run is a refusal here, never a
 *                   skip.
 *   B  POPULATION   per FILE, at SYMBOL granularity: every file the census finds
 *                   a read in carries at least one anchor here, and the set of
 *                   symbols this page cites into that file EQUALS the set the
 *                   census plus `NON_READ_ANCHORS` require -- so the two counts
 *                   are equal by construction and a difference names the symbol
 *                   rather than only the number. ⭐ This is the mandatory one.
 *   C  COUNTS       every CENSUS-DERIVED number the page states equals the census.
 *                   A pattern that matches NOTHING is an error, so a reworded page
 *                   cannot silently stop being checked. The page's whole-corpus
 *                   TEXT counts are deliberately NOT compared -- see the next
 *                   section -- but they are still required to be present and dated.
 *   D  CLASSIFICATION  a symbol anchor the census does not call an elevation read
 *                   must be a declared `NON_READ_ANCHORS` row, and that row's
 *                   symbol must still be declared by its file.
 *
 * ## ⭐ What is enforced, and why the text decomposition is NOT
 *
 * The page carries two kinds of number and they behave nothing alike.
 *
 *   CENSUS-DERIVED    properties of the population this page certifies: the
 *                     elevation read sites, their packages and files, the total
 *                     property reads the census subtracts from, the documented
 *                     collision subtraction, and the page's own split of the sites
 *                     into behaviour-bearing and carry-onward rows. These move
 *                     only when the elevation contract moves -- which is precisely
 *                     when this page must be edited anyway. ⭐ ALL of these stay
 *                     enforced.
 *
 *   WHOLE-CORPUS TEXT how many LINES carry the string `isSystem` anywhere under
 *                     `packages/` and `examples/` (tests included), how many times
 *                     the bare identifier appears, how many of those the parser
 *                     puts in an object-literal key, and the prose remainder.
 *                     ⛔ NOT enforced: `UNENFORCED_TEXT_COUNTS` carries the six,
 *                     with the measurement that moved them there.
 *
 * The split is not a tolerance. Nothing about the CONTRACT stopped being checked:
 * a read site with no row, a deleted site, a rotted anchor and an empty census all
 * still fail. What stopped being checked is a set of numbers about a population
 * the page does not certify -- and whose churn, measured, was blocking the page
 * from ever landing.
 *
 * ## Why `NON_READ_ANCHORS` is keyed by SYMBOL
 *
 * Some of the page's anchors are deliberately not read sites: the four unrelated
 * `isSystem` declarations, the `sys_`-prefix name helpers, a guard a row cites as
 * the thing being skipped, and the prose targets in the "what it does NOT do"
 * table. They need an allow-list -- and an allow-list of LINE NUMBERS would rot
 * exactly like the anchors this gate exists to stop rotting, silently, because a
 * stale row still excuses an anchor. So did the `needle` this ledger used before
 * #15921: a literal of source text, which every reformatting moved.
 *
 * Each row now names `{ file, symbol }`, the same pair the page writes, and the
 * gate asks the SHARED resolver whether that file still declares that symbol. A
 * row whose symbol is gone is an error naming the row, so the ledger stays
 * self-retiring; and there is nothing left in it that a whitespace change can
 * break.
 *
 * `symbol: null` is the FILE-LEVEL row and it is honest, not a shrug: the citation
 * lands in a module docblock with no declaration around it, and a file-level
 * anchor is what the grammar provides for exactly that. One row is like this today
 * (`plugin-auth/src/last-admin-guard.ts`).
 *
 * ⭐ `collapsesOntoRead` is the declaration this migration made necessary. Under
 * symbol granularity a citation can share its symbol with a census read site -- the
 * `owner_id` guard block and the short-circuit that skips it are both inside
 * `packages/plugins/plugin-security/src/security-plugin.ts#start` -- so the row
 * stops EXCUSING anything while its `why`
 * and its `rowSeams` are still worth keeping. The field says so, and the gate
 * refuses when the declaration and the census disagree in EITHER direction: an
 * undeclared overlap reads as a row that excuses an anchor when it does not, and a
 * declared overlap that has ended is a row nobody re-examined.
 *
 * ## ⛔ `--fix` no longer rewrites anything, and that is the point
 *
 * It used to re-anchor a pure line shift, which was the common repair: a file grew
 * an import, every anchor into it moved by one, and a mechanical remap was both
 * safe and necessary. Symbol anchors do not shift, so that repair has no subject.
 * ⛔ The flag is NOT silently accepted -- a `--fix` that writes nothing and exits 0
 * reads exactly like a repair that worked. It prints what it did not do and why,
 * and then returns this gate's ordinary verdict, so `gen:system-context-census`
 * stays wired and stays honest.
 *
 * ⇒ Every red here is now a HUMAN edit: a symbol was renamed (update the anchor),
 * a read arrived or vanished (write or delete the row), or a citation moved out of
 * the symbol that held it.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * A page that cannot be read, a census with no sites, zero anchors found, a corpus
 * of zero files, a declared-count pattern that matches nothing, an UNENFORCED row
 * that vanished or lost its date, and a ledger row that locates nothing are all
 * exit 1 naming what could not be read.
 *
 * ## ⭐ Wiring, and why the self-test asserts it (#13646)
 *
 * This gate IS the "regenerate and diff" instrument for the page: it re-derives the
 * census from the tree and reddens when the committed anchors disagree. That makes
 * it the only thing standing between the page and the failure mode that has no
 * other signal -- an anchor going stale because the file it CITES moved, in a merge
 * that produced no conflict at all.
 *
 * Measured on `cc837dbfec` by shifting `plugin-sharing/src/sharing-service.ts` down
 * 29 lines (main's real delta in the #13625 window) with the page untouched, which
 * is the branch-never-touched-that-file case git merges clean and silent:
 *
 *   gate on the shifted tree   exit 1, 16 findings, naming every one of the five
 *                              sharing-service anchors and the ledger row
 *   `--fix` then the gate      109 sites re-anchored, exit 0
 *
 * So the anchors are recoverable and the loss is loud -- PROVIDED the gate is
 * scheduled. Nothing asserted that it was. `check-self-test-wired` is conditional
 * in the wrong direction here: it requires that a script CI runs also has its
 * `--self-test` run, so deleting BOTH invocations from `lint.yml` retires this gate
 * with every check still green. The self-test therefore reads the workflow text and
 * asserts both legs, the way `check-doc-frontmatter`, `check-aggregator-roster` and
 * `check-ci-filter-parity` each assert their own -- a gate that exists and is not
 * scheduled is the dormant shape seen from the other side.
 *
 * ⚠️ The pin deliberately needs NO workflow edit: `lint.yml` already invokes both
 * legs, in the required `Lint & Repo Gates` job, on a trigger set that includes
 * `merge_group` and with no `paths:` filter. It is the repo's busiest file and the
 * assertion reads it rather than adding to it.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitFreeEnv } from './git-env.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { CORPUS_ROOTS, runCensus, symbolPopulation } from './isystem-census.mjs';
import {
  ANCHOR_GRAMMAR,
  defineCorpus,
  extractAnchors,
  formatFindings,
  symbolResolutionClass,
  sweepCorpus,
} from './symbol-anchors.mjs';

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
  'the GREEN control: a page that is correct': 2,
  '⭐ the RED that matters: a site the page never mentions': 2,
  'the deletion shape: the row stands, the site is gone': 3,
  '⭐ RESOLUTION is delegated, and a sweep that did not run is a REFUSAL': 3,
  'ledger': 5,
  'counts': 6,
  '⭐ CRITERION: enforced means CENSUS-DERIVED, pinned over the REAL lists': 2,
  'the same criterion, behaviourally, on one page': 3,
  '⛔ and the half that must NOT have moved: the contract still reds': 2,
  'absence is loud': 1,
  '⛔ --fix regenerates declared COUNTS only, never anchors, and says so': 8,
  '⭐ THE RULED RED-FIRST PAIR: a symbol rename REDS, a pure line move does NOT': 5,
  '⭐ the precision this trades away, pinned so nobody rediscovers it as a bug': 2,
  'the refusal has to SHOW its work (both counts, the symbol, the file)': 2,
  '⭐ CORPUS REGISTRATION: one resolver, not a second implementation': 3,
  'WIRING: this gate, and its self-test, really run in CI': 2,
  'POPULATION DECLARATION: what the dispatch derivation is told this gate reads': 6,
  '⭐ ROW REFERENCES: held by seam, and the insertion that was silent (#15869)': 23,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 18;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const PAGE = 'content/docs/permissions/system-context.mdx';
const PAGE_DIR = 'content/docs/permissions';
const PAGE_FILE = /^system-context\.mdx$/;

/**
 * ── The corpus registration (#15921) ────────────────────────────────────────
 *
 * ⚠️ THE MECHANISM IS NOT HERE. This is a `defineCorpus` call and nothing else,
 * exactly like `scripts/check-adr-symbol-anchors.mjs#CORPUS`: the grammar, the
 * extractor and the resolution rule are `scripts/symbol-anchors.mjs`'s, shared
 * with `docs/adr/**` and with the `scripts/**` gate-header corpus. The ruling
 * that put line anchors out of this repo said 「共享同一个 resolver,⛔ 不造第
 * 二套」, and a corpus is how a body of documents joins it.
 *
 * `docPattern` names ONE file rather than the directory: the other 22 pages under
 * `content/docs/permissions` are hand-written prose that nobody has migrated, and
 * sweeping them here would red this gate for citations it was never given the
 * ledger to explain. Widening the pattern is its own decision with its own
 * cleanup, not a side effect of this one.
 *
 * `checkBarePaths` is ON, which `docs/adr/**` cannot afford (1,056 findings there)
 * and this page can: it carries 45 anchored files and a handful of prose
 * citations, every one of them spelled in full from the repository root, so a
 * bare path that resolves to nothing is a real finding and not a corpus-wide
 * cleanup.
 *
 * ⚠️ For anyone registering the NEXT corpus: `sweepCorpus` resolves through
 * `git ls-files` and passes no environment of its own, so a sweep of a SYNTHETIC
 * root inherits whatever `GIT_DIR` / `GIT_INDEX_FILE` the caller was launched
 * with. In-repo callers are unaffected (the inherited values name this
 * repository, which is the right answer); a test that builds a throwaway tree is
 * not. This gate's self-test detaches from those variables before its first case
 * — see `buildRedFirstCorpus`, which carries the measured incident.
 */
export const CORPUS = defineCorpus({
  id: 'system-context',
  label: 'content/docs/permissions/system-context.mdx (the isSystem census page)',
  docRoots: [PAGE_DIR],
  docPattern: PAGE_FILE,
  checkBarePaths: true,
});

/**
 * ── The population this gate READS, declared where the dispatch tool looks ───
 *
 * `extractWatchHints` in `scripts/pm/dispatch-gates.mjs` reads a gate's module
 * body for path literals and treats them as the population that gate watches.
 * This gate spelled 29 of them -- the page, the four colliding declarations, the
 * `NON_READ_ANCHORS` citations -- and every one of them names an ARTIFACT it
 * maintains. Its real population is the corpus `isystem-census.mjs` walks:
 * `CORPUS_ROOTS`, today 109 elevation read sites in 20 packages across 45 files
 * held by 145 anchors.
 *
 * ⭐ The failure that produced this declaration is not a missed red. It is a
 * GREEN that was true and insufficient. A diff that merely SHIFTS a cited line
 * -- an added import, a widened docblock -- reds this gate in CI while the
 * derivation places it in the `silent` bucket, which reads as a clearance and is
 * not: "this gate names paths, none of them yours" is the same sentence for a
 * gate that cannot see your diff and for one whose whole verdict turns on it.
 * Measured three times in one night on three unrelated PRs; each cost a CI lap
 * plus a repair dispatch, and each dev had honestly run its derived families.
 *
 * ## Why the subtree and not the 45 cited files
 *
 * A roster of the files that carry a read site TODAY can never name the file
 * that grows one TOMORROW -- and a NEW read site is precisely the finding this
 * gate exists for (POPULATION, check B above, the mandatory half). A narrow
 * declaration would derive green for the one case that most needs the lead, so
 * it re-introduces this defect wearing the shape of a fix.
 *
 * ## The cost of the wide form, measured rather than asserted (at a39b02a6b)
 *
 * Families derived per probe path, before -> after this declaration:
 *
 *   packages/lint/src/authoring-rules.ts                 19 -> 20
 *   packages/plugins/plugin-auth/src/auth-plugin.ts      22 -> 23
 *   packages/metadata-protocol/src/protocol.ts           21 -> 22
 *   packages/spec/src/data/object.zod.ts                 42 -> 42   (already named)
 *   examples/app-crm/package.json                        17 -> 18
 *   content/docs/permissions/access-matrix.mdx           30 -> 30   (unchanged)
 *   scripts/check-nul-bytes.mjs                          14 -> 14   (unchanged)
 *   .github/workflows/lint.yml                           23 -> 23   (unchanged)
 *
 * So the price is ONE family, on cards under the two subtrees only, against a
 * gate that runs in about 3s and is run by CI on every PR regardless. What the
 * lead buys is the CI lap it replaces.
 *
 * ## Provenance, never a lookup key
 *
 * Nothing here reads this array: `collectCorpus` walks `CORPUS_ROOTS`, and the
 * glob form would name directories that do not exist. The self-test derives both
 * directions FROM `CORPUS_ROOTS` rather than re-spelling the roots, so a corpus
 * root added or dropped reddens here instead of silently outrunning the
 * declaration. It has to be written out as a literal array: assembling it from
 * `CORPUS_ROOTS` at runtime would put it out of reach of the very text scan it
 * exists for -- identical runtime value, zero hints extracted, the defect
 * preserved behind a tidier line (`check-watch-hint-literal` holds this shape).
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**', 'examples/**'];

/**
 * ⛔ SHRINK-ONLY. Anchors the page writes that are deliberately NOT elevation read
 * sites, keyed the way the page writes them: `{ file, symbol }`.
 *
 * `symbol` must have a declaration site in `file` by the SHARED resolver's rule
 * (`scripts/symbol-anchors.mjs#symbolResolutionClass`), and the page must anchor
 * exactly that pair. `symbol: null` is a FILE-LEVEL row -- the citation lands
 * somewhere no declaration encloses, and the page anchors the bare path.
 *
 * `collapsesOntoRead: true` declares that this row's symbol is ALSO a symbol the
 * census finds an elevation read in, so the row no longer excuses an anchor and is
 * kept for its `why` and its `rowSeams`. The gate holds the declaration to the
 * census in both directions.
 */
export const NON_READ_ANCHORS = [
  // ── The four declarations that share the identifier ──────────────────────────
  {
    file: 'packages/spec/src/kernel/execution-context.zod.ts',
    symbol: 'isSystem',
    why: 'the elevation flag itself -- a declaration, not a read',
  },
  {
    file: 'packages/spec/src/data/object.zod.ts',
    symbol: 'isSystem',
    why: 'Object.isSystem -- an unrelated metadata field the page names to defuse the collision',
  },
  {
    file: 'packages/spec/src/system/email-template.zod.ts',
    symbol: 'isSystem',
    why: 'EmailTemplate.isSystem -- unrelated metadata field',
  },
  // `Environment.isSystem` (`packages/spec/src/cloud/environment.zod.ts`) was the
  // fourth row until #16325 removed the `@objectstack/spec/cloud` subpath; the
  // declaration lives in the cloud repo now and is outside this census.
  // ── The `sys_` name-prefix family, cited to keep it apart from the flag ──────
  {
    file: 'packages/runtime/src/action-execution.ts',
    symbol: 'isSystemObjectName',
    why: 'keys on the `sys_` NAME PREFIX, not on any flag',
  },
  {
    file: 'packages/mcp/src/mcp-http-tools.ts',
    symbol: 'isSystemObject',
    why: 'the same name-prefix helper, MCP side',
  },
  // ── Constructs a table row deliberately cites alongside its read ─────────────
  {
    file: 'packages/plugins/plugin-security/src/security-plugin.ts',
    symbol: 'start',
    collapsesOntoRead: true,
    why: 'row 2 -- the `owner_id` guard block that the row-1 short-circuit skips; both are inside `start`',
    rowSeams: ['`owner_id` is not auto-stamped on INSERT', 'The whole security middleware short-circuits'],
  },
  {
    file: 'packages/objectql/src/engine.ts',
    symbol: 'buildDriverOptions',
    collapsesOntoRead: true,
    why: 'row 24 -- the early return the tenant-audit read feeds, and where `bypassTenantAudit` is threaded to the driver',
    rowSeams: ['Tenant-audit warning silenced'],
  },
  {
    file: 'packages/objectql/src/engine.ts',
    symbol: 'insert',
    collapsesOntoRead: true,
    why: 'row 22 -- the strict-drop refusal that never fires under elevation, and the strip-before-validation block the validation row cites',
    rowSeams: ['Strict-drop refusal never fires'],
  },
  {
    file: 'packages/objectql/src/readonly-strict-errors.ts',
    symbol: 'READONLY_CLASS_REASONS',
    why: 'row 22 -- the reason set the silent refusal would have used',
    rowSeams: ['Strict-drop refusal never fires'],
  },
  {
    file: 'packages/plugins/plugin-security/src/system-write-guard.ts',
    symbol: 'assertEngineOwnedWriteAllowed',
    why: 'row 25 -- the bypass expressed through a helper rather than a direct read',
    rowSeams: ['append-only write guard bypassed'],
  },
  {
    file: 'packages/plugins/plugin-sharing/src/sharing-service.ts',
    symbol: 'revoke',
    collapsesOntoRead: true,
    why: 'row 35 -- the CONFLICT guard `revoke()` deletes in front of, in the same function',
    rowSeams: ['`revoke()` deletes directly'],
  },
  {
    file: 'packages/services/service-automation/src/builtin/crud-nodes.ts',
    symbol: 'registerCrudNodes',
    why: 'row 61 -- the call site of the compensating owner stamp',
    rowSeams: ['Automation flow data nodes re-add the `owner_id` stamp'],
  },
  {
    file: 'packages/objectql/src/registry.ts',
    symbol: 'applySystemFields',
    why: 'rough edge 5 -- named as if it read the flag; it reads it zero times',
  },
  // ── Prose targets: "what `isSystem` does NOT do", and the rough edges ────────
  {
    file: 'packages/metadata-protocol/src/seed-loader.ts',
    symbol: 'writeDeferredReference',
    why: 'the rationale comment the triggers row cites -- `isSystem` does NOT suppress trigger dispatch',
  },
  {
    file: 'packages/metadata-protocol/src/seed-loader.ts',
    symbol: 'SEED_OPTIONS',
    why: 'the seed options that carry BOTH flags -- a producer, not a read',
  },
  {
    file: 'packages/spec/src/automation/flow.zod.ts',
    symbol: 'runAs',
    why: 'the flow-side declaration of the same distinction',
  },
  {
    file: 'packages/spec/src/data/field.zod.ts',
    symbol: 'readonly',
    why: '`preserveAudit` is the separate opt-in -- this is the `readonly` declaration',
  },
  {
    file: 'packages/services/service-automation/src/runtime-identity.ts',
    symbol: 'stampSystemInsertOwner',
    collapsesOntoRead: true,
    why: 'audit stamping reads `userId`, not the flag, and the user-less system write stamps nothing',
  },
  {
    file: 'packages/plugins/plugin-auth/src/last-admin-guard.ts',
    symbol: null,
    why: 'the guard that is NOT bypassed -- cited to refute "it bypasses every guard". The claim lives in the module docblock, which no declaration encloses, so this is the one FILE-LEVEL row',
  },
  {
    file: 'packages/rest/src/rest-server.ts',
    symbol: 'enforceAuth',
    collapsesOntoRead: true,
    why: 'inbound HTTP cannot set the flag -- stated in the docblock and again inside the seam',
  },
  {
    file: 'packages/runtime/src/domains/actions.ts',
    symbol: 'handleActionsRequest',
    collapsesOntoRead: true,
    why: 'nor can an action body',
  },
];

/* ─────────── Row references: the page's OTHER hand-maintained claim ─────────── */

/**
 * ── Holding every `row N` to the row it points at (#15869) ───────────────────
 *
 * The anchors above hold every `file:line` on this page to the tree. Two more
 * hand-maintained claims sit on the same page and were held by NOTHING:
 *
 *   1. the page's own prose row references -- `Row 34 is correct for the rule`,
 *      `row 50's doors`, `what row 30 is skipping`, `rows 1–61 above`;
 *   2. the `why:` strings in `NON_READ_ANCHORS` above, which name a row by number.
 *
 * A row INSERTED into the behaviour table renumbers every row below it, so every
 * reference past the insertion point becomes false -- with this gate GREEN, because
 * nothing compared a number to a row. Measured, not argued: PR #15687 inserted one
 * row and three references went stale at once (the page's `Row 34` sentence and the
 * `why:` strings for rows 34 and 60); PR #15395 removed one row and all three became
 * true again. ⭐ Neither the breaking nor the repair was observed by anything -- and
 * a defect that repairs itself by coincidence is one whose next occurrence is
 * unobserved too.
 *
 * ⚠️ A falsified row reference is worse than a dangling one, BECAUSE IT RESOLVES.
 * After #15687 row 34 was `grant()` -- a seam whose rule is the opposite of the
 * sentence pointing at it (`grant()` is explicitly not a bare skip) -- so a reader
 * following the pointer landed on a row that contradicted the sentence, on a page
 * that declares itself the authority.
 *
 * ## ⭐ The key is the SEAM, never the number
 *
 * A ledger that recorded "the reference at line L says row 34" would rot exactly
 * like an anchor ledger: the renumbering that falsifies the reference makes the
 * ledger stale in the same edit, so the two would agree while both were wrong.
 *
 * So each reference declares the SEAM it is talking about -- a literal that must
 * occur in exactly one numbered row of the page's tables. The gate resolves the
 * seam, reads the number the reference actually carries, and refuses when they
 * disagree, naming the reference, the number it carries and the row the key
 * resolves to. ⭐ Renumbering moves the seam's row and the refusal names the new
 * number: the ledger itself never has to be renumbered, which is the whole point.
 *
 * Seams are taken from the referring sentence's OWN subject, never picked to make a
 * number come out right: `**`revoke()` skips its own conflict guard.** Row 34` keys
 * on `` `revoke()` deletes directly ``, the row that IS the `revoke()` seam. Where a
 * sentence names no seam that picks exactly one row, the reference is declared
 * UNHELD with its reason -- an honest hole, listed, rather than a guess that
 * resolves. `unheld` entries are still LOCATED, so one cannot decay into "not there".
 *
 * ## Population, not just resolution
 *
 * ⭐ A ledger of the references that exist today can never see the reference someone
 * writes tomorrow -- the same asymmetry that makes CENSUS -> PAGE the mandatory
 * direction above. So every `row N` spelling ON the page must be claimed by exactly
 * one entry below, and an unclaimed one is a refusal naming the line. Likewise every
 * `row N` inside a `why:` must carry its seam, or the ledger row is refused.
 *
 * ## ⛔ Why `--fix` does not renumber prose
 *
 * `--fix` rewrites ANCHORS, which live on the page this gate maintains. Renumbering
 * prose would mean writing `content/docs/permissions/system-context.mdx` as well --
 * a `merge=os-regen` routed file held by several open PRs at the time this check was
 * written. Refuse-only here, deliberately: the repair is a human edit, and the
 * `--fix` leg for prose is a follow-up once the page is free.
 */

/**
 * Every spelling either side uses: `Row 34`, `row 2's`, `row-1`, `rows 62–65`.
 * Built fresh per call -- a shared `/g` regex carries `lastIndex` between scans.
 */
function rowReferenceRe() {
  return /\b([Rr]ows?)[  -](\d+)(?:\s*[-–—]\s*(\d+))?/g;
}

/**
 * The page's numbered table rows, with the section each belongs to.
 *
 * The behaviour rows are split across five markdown tables that share one numbering
 * run, so a "table" is not the unit -- the SECTION is: everything at or below the
 * `### 6.` heading is the carry-onward table, everything above it is behaviour.
 *
 * @param {string} pageText
 * @returns {{ number: number, docLine: number, text: string, section: string }[]}
 */
export function extractTableRows(pageText) {
  const lines = pageText.split('\n');
  const carryAt = lines.findIndex((line) => line.startsWith('### 6.'));
  const rows = [];
  lines.forEach((line, i) => {
    const m = /^\|\s*(\d+)\s*\|/.exec(line);
    if (!m) return;
    rows.push({
      number: Number(m[1]),
      docLine: i + 1,
      text: line,
      section: carryAt !== -1 && i > carryAt ? 'carry-onward' : 'behaviour',
    });
  });
  return rows;
}

/**
 * Every `row N` reference in a body of text, one entry per occurrence.
 *
 * @param {string} text
 * @returns {{ docLine: number, raw: string, first: number, last: number|null, isRange: boolean }[]}
 */
export function extractRowReferences(text) {
  const refs = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(rowReferenceRe())) {
      refs.push({
        docLine: i + 1,
        raw: m[0],
        first: Number(m[2]),
        last: m[3] === undefined ? null : Number(m[3]),
        isRange: m[3] !== undefined,
      });
    }
  });
  return refs;
}

/** A row's own text, trimmed to something a refusal can quote on one line. */
function rowExcerpt(row) {
  const cells = row.text.split('|').map((c) => c.trim());
  const body = cells.slice(2).find((c) => c.length > 0) ?? row.text.trim();
  return body.length > 90 ? `${body.slice(0, 87)}…` : body;
}

/**
 * The page's prose row references, each keyed to the row it is ABOUT.
 *
 * `context` is a number-free literal that must occur on exactly one line of the
 * page -- number-free on purpose: a context carrying the number would stop matching
 * in the very edit this check exists to catch, and the refusal would name a missing
 * ledger row instead of a falsified sentence. That line must carry exactly one row
 * reference; if it grows a second, the entry says so rather than silently claiming
 * whichever came first.
 *
 * Then exactly one of:
 *   `seam`     a literal occurring in exactly one numbered row -- the row this
 *              reference is about, derived from the sentence's own subject.
 *   `section`  for a RANGE (`rows 1–61`): the section whose extent it states. No
 *              seam pair is invented for these; the endpoints are the section's own
 *              min and max, which is mechanical rather than editorial.
 *   `unheld`   the reason no key is derivable. ⛔ Listed, never guessed.
 */
export const PAGE_ROW_REFERENCES = [
  {
    context: 'at once — this is the single largest behaviour on the page',
    unheld:
      'a RANGE whose endpoints the sentence never names -- it says only that row 1 costs you "all of" ' +
      'them at once. Nothing in it picks a first or a last row, and the two are not a section extent.',
  },
  {
    context: 'the step 3.5 anchor guard is inside the block',
    seam: 'The whole security middleware short-circuits',
    why: 'the guard sits inside THE BLOCK, and the row that skips a whole block is the short-circuit row',
  },
  {
    context: 'doors consult answers yes before any capability is examined',
    seam: '`manage_metadata` bypassed on metadata writes',
    why: 'the doors this shared verdict backs are the `manage_metadata` metadata-write doors',
  },
  {
    context: 'gap is compensated inline',
    seam: '`owner_id` is not auto-stamped on INSERT',
    why: 'the compensated gap is the `owner_id` stamp this same cell re-adds',
  },
  {
    context: 'is a real gap; the platform repairs it twice',
    seam: '`owner_id` is not auto-stamped on INSERT',
    why: 'the rough edge names the `owner_id` gap in its own bolded subject',
  },
  {
    context: 'is now the `afterDelete` skip alone',
    seam: 'on the record-`afterDelete` hook',
    why: 'the sentence names the `afterDelete` hook, which is the row',
  },
  {
    context: '**Strict write observability is inert under elevation.**',
    seam: 'Strict-drop refusal never fires',
    why: 'the rough edge is about the STRICT-DROP refusal, told nothing because nothing was dropped',
  },
  {
    context: '**`revoke()` skips its own conflict guard.**',
    seam: '`revoke()` deletes directly',
    why: 'the bolded subject is `revoke()`, and exactly one row is the `revoke()` seam',
  },
  {
    context: 'people attribute to it is row',
    seam: '`owner_id` is not auto-stamped on INSERT',
    why: 'the write-time OWNERSHIP behaviour being redirected is the `owner_id` stamp row',
  },
  {
    context: 'behaviour-bearing (rows',
    section: 'behaviour',
    why: 'the extent of the behaviour-bearing rows -- everything above the carry-onward section',
  },
  {
    context: 'carry the flag onward only (rows',
    section: 'carry-onward',
    why: 'the extent of section 6, the carry-onward table',
  },
  {
    context: 'is skipping',
    unheld:
      'the bullet\'s only subject is the linked doc title "Sharing Rules", and several rows are about ' +
      'sharing rules. No key in the sentence picks one of them, so this one is declared, not guessed.',
  },
];

/**
 * E. ROW REFERENCES -- resolve every `row N` against the row its key names.
 *
 * @returns {{ problems: string[], held: { page: number, why: number, unheld: number } }}
 */
export function checkRowReferences({ pageText, ledger = NON_READ_ANCHORS, pageRefs = PAGE_ROW_REFERENCES }) {
  const problems = [];
  const held = { page: 0, why: 0, unheld: 0 };
  const wheres = ledger.flatMap((row) => (row.rowSeams ?? []).length);
  if (pageRefs.length === 0 && wheres.every((n) => n === 0)) return { problems, held };

  const rows = extractTableRows(pageText);
  if (rows.length === 0) {
    problems.push(
      '[no-table-rows] the page yielded ZERO numbered table rows, so every `row N` reference ' +
        'below would resolve to nothing and this check would pass by finding no table -- ' +
        'refusing instead. The tables were renamed, reformatted, or the page was truncated.'
    );
    return { problems, held };
  }

  /** @returns {{ row: object }|{ error: string, matches: object[] }} */
  const resolve = (seam) => {
    const matches = rows.filter((row) => row.text.includes(seam));
    if (matches.length === 1) return { row: matches[0] };
    return { error: matches.length === 0 ? 'unresolved' : 'ambiguous', matches };
  };
  const numbered = (n) => {
    const row = rows.find((r) => r.number === n);
    return row ? `row ${n} is \`${rowExcerpt(row)}\` (${PAGE}:${row.docLine})` : `there is no row ${n}`;
  };

  const pageLines = pageText.split('\n');
  const allRefs = extractRowReferences(pageText);
  const claimed = new Set();

  for (const entry of pageRefs) {
    const kinds = ['seam', 'section', 'unheld'].filter((k) => entry[k] !== undefined);
    if (kinds.length !== 1) {
      problems.push(
        `[row-ref-declaration] PAGE_ROW_REFERENCES entry \`${entry.context}\` declares ` +
          `${kinds.length === 0 ? 'no' : kinds.join(' + ')} key -- exactly one of \`seam\`, ` +
          '`section` or `unheld` is required, so an unkeyed entry cannot read as a held one.'
      );
      continue;
    }
    const hits = [];
    pageLines.forEach((line, i) => {
      if (line.includes(entry.context)) hits.push(i + 1);
    });
    if (hits.length !== 1) {
      problems.push(
        `[row-ref-context-${hits.length === 0 ? 'stale' : 'ambiguous'}] PAGE_ROW_REFERENCES context ` +
          `\`${entry.context}\` matches ${hits.length} line(s) of ${PAGE}` +
          `${hits.length > 1 ? ` (${hits.join(', ')}) -- lengthen it until it is unique` : ' -- the sentence was reworded or removed; update or drop the entry'}.`
      );
      continue;
    }
    const docLine = hits[0];
    const onLine = allRefs.filter((ref) => ref.docLine === docLine);
    if (onLine.length !== 1) {
      problems.push(
        `[row-ref-line-drifted] ${PAGE}:${docLine} is claimed by the entry \`${entry.context}\` but ` +
          `carries ${onLine.length} row reference(s) (${onLine.map((r) => r.raw).join(', ') || 'none'}) -- ` +
          'one entry holds one reference, so split the entry or fix the sentence.'
      );
      continue;
    }
    claimed.add(docLine);
    const ref = onLine[0];

    if (entry.unheld !== undefined) {
      held.unheld += 1;
      continue;
    }
    if (entry.seam !== undefined) {
      if (ref.isRange) {
        problems.push(
          `[row-ref-shape] ${PAGE}:${docLine} now writes the RANGE \`${ref.raw}\`, but its entry ` +
            `declares a single-row \`seam\` (\`${entry.seam}\`) -- a seam names one row and cannot ` +
            'certify a range.'
        );
        continue;
      }
      const found = resolve(entry.seam);
      if ('error' in found) {
        problems.push(
          `[row-ref-key-${found.error}] ${PAGE}:${docLine} writes \`${ref.raw}\` and its key ` +
            `\`${entry.seam}\` matches ${found.matches.length} numbered row(s)` +
            `${found.matches.length > 1 ? ` (rows ${found.matches.map((r) => r.number).join(', ')}) -- lengthen the seam` : ' -- the row it names was reworded or deleted, so the reference is now held by nothing'}.`
        );
        continue;
      }
      if (found.row.number !== ref.first) {
        problems.push(
          `[row-ref-falsified] ${PAGE}:${docLine} says \`${ref.raw}\`, but the seam that sentence is ` +
            `about (\`${entry.seam}\`) is row ${found.row.number} (${PAGE}:${found.row.docLine}). ` +
            `The table was renumbered under the sentence, so ${numbered(ref.first)} -- a DIFFERENT ` +
            'seam. ⚠️ The reference still resolves, which is why nothing noticed: a reader who ' +
            'follows it is told something false by a row that exists.'
        );
        continue;
      }
      held.page += 1;
      continue;
    }
    // section: a RANGE, held to the extent of the section it states
    if (!ref.isRange) {
      problems.push(
        `[row-ref-shape] ${PAGE}:${docLine} now writes \`${ref.raw}\`, a single row, but its entry ` +
          `declares the extent of the \`${entry.section}\` section -- a range was expected.`
      );
      continue;
    }
    const inSection = rows.filter((row) => row.section === entry.section);
    if (inSection.length === 0) {
      problems.push(
        `[row-ref-section-empty] ${PAGE}:${docLine} states the extent of the \`${entry.section}\` ` +
          'section, which now holds ZERO numbered rows -- the section was renamed or emptied and the ' +
          'range is checked against nothing.'
      );
      continue;
    }
    const first = Math.min(...inSection.map((row) => row.number));
    const last = Math.max(...inSection.map((row) => row.number));
    if (first !== ref.first || last !== ref.last) {
      problems.push(
        `[row-ref-falsified] ${PAGE}:${docLine} says \`${ref.raw}\`, but the \`${entry.section}\` ` +
          `section runs rows ${first}–${last} (${inSection.length} rows). A row was inserted or ` +
          'removed and the stated extent was not followed.'
      );
      continue;
    }
    held.page += 1;
  }

  for (const ref of allRefs) {
    if (claimed.has(ref.docLine)) continue;
    problems.push(
      `[row-ref-undeclared] ${PAGE}:${ref.docLine} writes \`${ref.raw}\`, which no ` +
        'PAGE_ROW_REFERENCES entry claims. ⭐ A row reference nobody declared is held by nothing ' +
        'and goes stale on the next insertion: declare it with the seam it is about, or with ' +
        '`unheld` and the reason no key is derivable.'
    );
  }

  // ── the ledger's own `why:` strings, held the same way ──────────────────────
  for (const row of ledger) {
    const mentions = extractRowReferences(row.why ?? '');
    const seams = row.rowSeams ?? [];
    if (mentions.length !== seams.length) {
      problems.push(
        `[why-row-unkeyed] NON_READ_ANCHORS row for ${row.file} (\`#${row.symbol ?? '<file-level>'}\`) writes ` +
          `${mentions.length} row reference(s) in its \`why\` (${row.why}) but declares ${seams.length} ` +
          '`rowSeams`. Every `row N` in a `why` needs the seam it is about, in the order it is ' +
          'written -- an unkeyed number is held by nothing and reads as current forever.'
      );
      continue;
    }
    mentions.forEach((ref, i) => {
      const found = resolve(seams[i]);
      if ('error' in found) {
        problems.push(
          `[why-row-key-${found.error}] NON_READ_ANCHORS row for ${row.file} says \`${ref.raw}\` and ` +
            `its key \`${seams[i]}\` matches ${found.matches.length} numbered row(s)` +
            `${found.matches.length > 1 ? ` (rows ${found.matches.map((r) => r.number).join(', ')}) -- lengthen the seam` : ' -- the row it names was reworded or deleted'}.`
        );
        return;
      }
      if (found.row.number !== ref.first) {
        problems.push(
          `[why-row-falsified] NON_READ_ANCHORS row for ${row.file} says \`${ref.raw}\` in its \`why\` ` +
            `(${row.why}), but the seam it keys on (\`${seams[i]}\`) is row ${found.row.number} ` +
            `(${PAGE}:${found.row.docLine}). The table was renumbered under the ledger, so ` +
            `${numbered(ref.first)}.`
        );
        return;
      }
      held.why += 1;
    });
  }

  return { problems, held };
}

/**
 * Numbers the page states ABOUT THE CURRENT TREE, each tied to the census value it
 * must equal.
 *
 * ⚠️ Deliberately excluded: every figure describing the PREVIOUS edition (111
 * anchors, 101 rotted, 41 ambiguous, the `grep -c` 64, "80 sites across 18
 * packages"). Those are history, they are true of a tree that no longer exists, and
 * a gate that "corrected" them would be rewriting the record.
 *
 * ⛔ Also deliberately excluded, and for a different reason: the six WHOLE-CORPUS
 * TEXT counts, which live in `UNENFORCED_TEXT_COUNTS` below. Everything that
 * remains here is CENSUS-DERIVED -- it changes only when the elevation population
 * changes. ⭐ That invariant is pinned by a self-test case (`CRITERION`), which
 * drifts a fixture census's text figures and requires every entry in this list to
 * hold still: re-add a text count here and the self-test names it.
 *
 * `pattern` must have exactly one capture group -- the number -- and must match at
 * least once. A pattern that matches nothing is an ERROR: it means the page was
 * reworded out from under the check, which is how a counts gate goes quietly
 * vacuous.
 */
/**
 * How many distinct symbols the census's read sites live in — the population the
 * page can actually ANCHOR, which is smaller than the site count wherever several
 * reads share a symbol.
 */
function distinctSymbolCount(census) {
  let total = 0;
  for (const entry of symbolPopulation(census).values()) total += entry.symbols.size;
  return total;
}

/**
 * How many files hold more than one read inside a single symbol — the size of the
 * precision this page trades away, kept enforced so the sentence that prices it
 * cannot quietly stop being true in either direction.
 */
function collapsingFileCount(census) {
  let files = 0;
  for (const entry of symbolPopulation(census).values()) {
    if (entry.symbols.size + (entry.fileLevel ? 1 : 0) !== entry.sites) files += 1;
  }
  return files;
}

export const DECLARED_COUNTS = [
  {
    id: 'headline-sites',
    pattern: /a single boolean read at \*\*(\d+)\s*\n?\s*distinct sites/,
    value: (c) => c.sites.length,
    why: 'the headline claim in the opening section',
  },
  {
    id: 'headline-packages',
    pattern: /distinct sites across (\d+) packages\*\*/,
    value: (c) => c.packages.length,
    why: 'the headline package count',
  },
  {
    id: 'sharing-share',
    pattern: /The largest single consumer — \*\*(\d+) of the \d+ sites\*\*/,
    value: (c) => c.sites.filter((s) => s.package.endsWith('plugin-sharing')).length,
    why: "section 3's claim about plugin-sharing's share",
  },
  {
    id: 'sharing-total',
    pattern: /The largest single consumer — \*\*\d+ of the (\d+) sites\*\*/,
    value: (c) => c.sites.length,
    why: 'the denominator of the same claim',
  },
  {
    id: 'table-declarations',
    pattern: /\| — parsed as a declaration \|\s*(\d+) \|/,
    value: (c) => c.roleCounts.declaration,
    why: 'the decomposition table: declarations',
  },
  {
    id: 'table-reads',
    pattern: /\| — parsed as a property \*\*read\*\* \|\s*(\d+) \|/,
    value: (c) => c.roleCounts.read,
    why: 'the decomposition table: property reads',
  },
  {
    id: 'table-other',
    pattern: /\| — parsed in some other syntactic position[^|]*\|\s*(\d+) \|/,
    value: (c) => c.roleCounts.other,
    why: 'the decomposition table: everything else the parser saw',
  },
  {
    id: 'table-unrelated-reads',
    pattern: /\| Of those reads: reads of one of the unrelated metadata fields \|\s*(\d+) \|/,
    value: (c) => c.nonElevationReads.length,
    why: 'the decomposition table: the collision subtraction',
  },
  {
    id: 'table-elevation-reads',
    pattern: /\| Of those reads: reads of `ExecutionContext.isSystem` \|\s*\*\*(\d+)\*\* \|/,
    value: (c) => c.sites.length,
    why: 'the decomposition table: the census answer',
  },
  {
    id: 'table-carry-onward',
    pattern: /\| — carry the flag onward only \(rows \d+–\d+ above\) \|\s*(\d+) \|/,
    value: (c, page) => carryOnwardRowCount(page),
    why: "the decomposition table: how many sites only propagate the flag — held to section 6's own row count",
  },
  {
    id: 'table-behaviour-bearing',
    pattern: /\| — behaviour-bearing \(rows \d+–\d+ above\) \|\s*(\d+) \|/,
    value: (c, page) => c.sites.length - carryOnwardRowCount(page),
    why: 'the decomposition table: the remaining sites, derived so the two halves must sum to the census',
  },
  {
    id: 'table-packages',
    pattern: /\| Packages containing at least one elevation read \|\s*\*\*(\d+)\*\* \|/,
    value: (c) => c.packages.length,
    why: 'the decomposition table: package count',
  },
  {
    id: 'table-files',
    pattern: /\| Files containing at least one elevation read \|\s*(\d+) \|/,
    value: (c) => c.files.length,
    why: 'the decomposition table: file count',
  },
  {
    id: 'table-symbols',
    pattern: /\| — the distinct symbols those reads live in — what this page anchors \|\s*(\d+) \|/,
    value: (c) => distinctSymbolCount(c),
    why: 'the decomposition table: what this page can actually anchor, after the collapse',
  },
  {
    id: 'table-collapsing-files',
    pattern: /\| — of those files, the ones holding more than one read in one symbol \|\s*(\d+) \|/,
    value: (c) => collapsingFileCount(c),
    why: 'the decomposition table: the size of the declared precision loss',
  },
  {
    id: 'precision-collapsing-files',
    pattern: /\*\*(\d+)\*\* of the \*\*\d+\*\*\s*\n?\s*anchored files hold more than one read/,
    value: (c) => collapsingFileCount(c),
    why: 'the prose that prices the precision loss where a reader meets the anchors',
  },
  {
    id: 'precision-anchored-files',
    pattern: /\*\*\d+\*\* of the \*\*(\d+)\*\*\s*\n?\s*anchored files hold more than one read/,
    value: (c) => c.files.length,
    why: 'the denominator of that same sentence',
  },
  {
    id: 'ruling-sites',
    pattern: /`isSystem` is a published contract with (\d+) read sites/,
    value: (c) => c.sites.length,
    why: "the #4707 ruling's premise -- it is quoted as a live count, so it must stay one",
  },
  {
    id: 'ruling-packages',
    pattern: /read sites\s*\n?\s*in (\d+) packages\./,
    value: (c) => c.packages.length,
    why: "the ruling's package count",
  },
];

/**
 * The WRITE half of `DECLARED_COUNTS` (#16919 direction 1).
 *
 * `evaluate()`'s COUNTS check (below) already computes, for every declared
 * sentence, exactly the value it should hold — `declared.value(census, page)`
 * — and only ever uses it to compare. Two branches independently hand-typing
 * the same freshly-computed number into the same sentence text-merge clean and
 * silently wrong on the SUM: main and a sibling PR each bumped the same seven
 * sentences 106 → 107 for two different new reads, and the merged tree held
 * 108. The fix in that shape is never "type the right number" — it is "stop
 * typing it": this function performs the identical `pattern`/`value` lookup
 * COUNTS already runs, and writes the result back instead of only comparing.
 *
 * Pure — a text in, a text out, plus what changed and what could not be
 * derived. The caller decides whether to persist `text` or to refuse on a
 * non-empty `errors`; nothing here touches the filesystem, so `--self-test`
 * can drive it on a fixture exactly as it drives `evaluate()`.
 *
 * ⛔ Deliberately narrow, same rule as `check:generated --fix` elsewhere in
 * this repo (see AGENTS.md, "Touched `packages/spec`?"): only a MISMATCHED
 * count is rewritten, so a page where every count already agrees with the
 * census comes back byte-identical — idempotent by construction, not merely
 * in practice (`--self-test`'s IDEMPOTENCE case proves it on the real page).
 * `UNENFORCED_TEXT_COUNTS` is deliberately NOT in scope: those six rows count
 * whole-corpus TEXT, not the elevation contract, and are unenforced by design
 * (see that export) — regenerating them would silently start enforcing a
 * population this gate has already measured and rejected as noise.
 *
 * @param {{ pageText: string, census: object, declaredCounts?: typeof DECLARED_COUNTS }} args
 * @returns {{ text: string, rewrites: {id: string, from: string, to: string}[], errors: string[] }}
 */
export function regenerateDeclaredCounts({ pageText, census, declaredCounts = DECLARED_COUNTS }) {
  let text = pageText;
  const rewrites = [];
  const errors = [];
  for (const declared of declaredCounts) {
    // `d` adds match INDICES (Node >=16) so only the captured digits are
    // spliced out -- never the surrounding sentence, which stays hand-written
    // prose and must survive byte-for-byte on every run that changes nothing.
    const flags = declared.pattern.flags.includes('d') ? declared.pattern.flags : `${declared.pattern.flags}d`;
    const re = new RegExp(declared.pattern.source, flags);
    const match = re.exec(text);
    if (!match) {
      errors.push(
        `[count-pattern-unmatched] the page no longer carries the \`${declared.id}\` sentence ` +
          `(${declared.why}) -- nothing was rewritten for it. Update the pattern together with the wording.`
      );
      continue;
    }
    const actual = declared.value(census, text);
    if (!Number.isInteger(actual) || actual < 0) {
      errors.push(
        `[count-underivable] \`${declared.id}\` could not be derived (${declared.why}) -- the page ` +
          'structure it reads is gone; nothing was rewritten for it.'
      );
      continue;
    }
    const stated = match[1];
    const replacement = String(actual);
    if (stated === replacement) continue;
    const [start, end] = match.indices[1];
    text = text.slice(0, start) + replacement + text.slice(end);
    rewrites.push({ id: declared.id, from: stated, to: replacement });
  }
  return { text, rewrites, errors };
}

/**
 * ⛔ The six numbers this gate deliberately does NOT hold to the census, listed
 * here so that stays a decision instead of an omission.
 *
 * Each one counts WHOLE-CORPUS TEXT: lines carrying the string `isSystem`
 * anywhere under `packages/` and `examples/` (tests included), appearances of the
 * bare identifier in non-test sources, the object-literal keys among them, and the
 * prose remainder. None of them is a property of the elevation contract the page
 * certifies -- a test that mentions the flag, a seed object carrying
 * `isSystem: true`, or a comment moves them.
 *
 * ## Why they are here rather than in `DECLARED_COUNTS`, measured
 *
 * They were enforced, and enforcement did not survive contact with the repo. CI
 * scores a pull request's MERGE with `main`, and the merge queue re-derives that
 * merge against a NEWER `main` on every attempt -- so a page carrying whole-corpus
 * text counts races a target that moves roughly eighteen times a working day, and
 * can be reddened by a merge it never touched. Measured on this page's own branch,
 * over one night, by three unrelated merges to `main`:
 *
 *   base 8cb96ec41b34 -> db39dfc1c9   linesTotal 1804 -> 1810, linesInTests 1010 ->
 *                                     1012, linesInSources 794 -> 798, appearances
 *                                     809 -> 813, keys 308 -> 310, prose 356 -> 358
 *   db39dfc1c9 -> 8a483b38b8          linesTotal 1810 -> 1811, linesInTests 1012 ->
 *                                     1013
 *
 * ⭐ And the control, over the SAME refs and the same corpus: every census-derived
 * figure held flat -- 109 sites, 20 packages, 45 files, 6 ledger subtractions, and
 * the role counts 21 declarations / 115 reads / 9 other -- across db39dfc1c9,
 * 8a483b38b8, ca1965f2b5 and the merged tree. The population did not move once
 * while the text counts moved eight times. That is the whole argument: the
 * enforced set is the one that changes when the CONTRACT changes.
 *
 * ## ⛔ What this is NOT
 *
 * It is not a tolerance and it is not a narrowing of the contract. The POPULATION
 * check (every elevation read must be anchored), the RESOLUTION check, the
 * CLASSIFICATION check and the census-derived counts are untouched, and an empty
 * census still refuses. What narrows is the set of numbers the page DECLARES about
 * a population it does not certify.
 *
 * Each row is still required to MATCH: a pattern that stops matching is an error
 * exactly as it is for an enforced count, so the rows cannot be reworded off the
 * page and quietly disappear. What is dropped is only the comparison.
 */
export const UNENFORCED_TEXT_COUNTS = [
  {
    id: 'table-lines-total',
    pattern: /\| Lines carrying `isSystem` in the corpus \|\s*(\d+) \|/,
    value: (c) => c.text.linesTotal,
    why: 'the decomposition table: text lines, tests included',
  },
  {
    id: 'table-lines-tests',
    pattern: /\| — in tests \|\s*(\d+) \|/,
    value: (c) => c.text.linesInTests,
    why: 'the decomposition table: text lines in tests',
  },
  {
    id: 'table-lines-sources',
    pattern: /\| — in non-test sources \|\s*(\d+) \|/,
    value: (c) => c.text.linesInSources,
    why: 'the decomposition table: text lines in sources',
  },
  {
    id: 'table-appearances',
    pattern: /\| Appearances of the bare identifier `isSystem` in non-test sources \|\s*(\d+) \|/,
    value: (c) => c.text.identifierAppearances,
    why: 'the decomposition table: identifier appearances',
  },
  {
    id: 'table-keys',
    pattern: /\| — parsed as an object-literal \/ type key[^|]*\|\s*(\d+) \|/,
    value: (c) => c.roleCounts.key,
    why: 'the decomposition table: producers and option objects',
  },
  {
    id: 'table-prose',
    pattern: /\| — the remainder: text inside comments and string literals \|\s*(\d+) \|/,
    value: (c) => c.text.inCommentsAndStrings,
    why: 'the decomposition table: the prose remainder',
  },
];

/**
 * The page must DATE its unenforced decomposition, and the gate holds it to that.
 *
 * ⚠️ A number nothing enforces rots silently -- which is the disease this whole
 * page exists to treat, one level down. Six bare numbers that read as current and
 * are checked by nothing would be a worse page than six numbers that say when they
 * were true. So the marker is required: no marker, no unenforced table.
 *
 * ⛔ The DATE and the REF are deliberately not compared to anything. Requiring
 * them to be recent would re-introduce exactly the churn this split removes; their
 * job is to tell a reader how old the numbers are, not to be fresh.
 */
export const UNENFORCED_MEASURED_AT = {
  pattern: /measured on (\d{4}-\d{2}-\d{2}) at `([0-9a-f]{7,40})`/,
  why: 'the dated marker on the unenforced decomposition',
};

/**
 * How many numbered rows section 6 ("Reads that only carry the flag onward") has.
 *
 * The page splits its 109 sites into behaviour-bearing rows and carry-onward rows.
 * Neither number is derivable from the census alone -- which row is which is the
 * page's own editorial call -- so the split is anchored to the thing that IS
 * mechanical: the size of that table. Zero rows is a refusal, not a zero: it means
 * the section was renamed and the split stopped being checked.
 *
 * @param {string} pageText
 * @returns {number}
 */
export function carryOnwardRowCount(pageText) {
  const start = pageText.indexOf('### 6.');
  if (start === -1) return -1;
  const rest = pageText.slice(start);
  const end = rest.indexOf('\n---');
  const section = end === -1 ? rest : rest.slice(0, end);
  const rows = section.split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line));
  return rows.length;
}

/**
 * Resolve every `NON_READ_ANCHORS` row against its file, through the SHARED
 * resolution rule.
 *
 * A row is stale when its file cannot be read, or when the file no longer
 * declares its symbol -- the same predicate `sweepCorpus` applies to the page's
 * own anchors, so the ledger and the page can never mean different things by
 * "the symbol is there". A `symbol: null` row only requires its file to exist.
 *
 * @param {{ file: string, symbol: string|null, why: string, collapsesOntoRead?: boolean }[]} rows
 * @param {(relPath: string) => string} readFile
 * @param {Map<string, { symbols: Set<string> }>} population  the census, by file
 * @returns {{ declared: Map<string, object[]>, problems: string[] }} keyed `file#symbol`, or `file`
 */
export function resolveNonReadAnchors(rows, readFile, population = new Map()) {
  /** @type {Map<string, object[]>} */
  const declared = new Map();
  const problems = [];
  for (const row of rows) {
    let body;
    try {
      body = readFile(row.file);
    } catch {
      problems.push(
        `[ledger-unreadable] NON_READ_ANCHORS names ${row.file}, which cannot be read -- ` +
          'the file moved or was deleted; update or drop the row.'
      );
      continue;
    }
    if (row.symbol !== null && row.symbol !== undefined) {
      if (!symbolResolutionClass(body, row.file, row.symbol)) {
        problems.push(
          `[ledger-stale] NON_READ_ANCHORS row for ${row.file} names \`#${row.symbol}\`, which that ` +
            `file no longer declares -- the construct it excuses was renamed or removed (${row.why}).`
        );
        continue;
      }
      /* ⭐ The overlap is DECLARED, never inferred. A row whose symbol is also a
       * census read symbol excuses nothing (POPULATION already requires that
       * anchor); saying so in the row is what stops the next reader from taking
       * it for a live exclusion, and holding the declaration to the census in
       * BOTH directions is what stops the declaration itself from rotting. */
      const collapses = population.get(row.file)?.symbols.has(row.symbol) === true;
      if (collapses && row.collapsesOntoRead !== true) {
        problems.push(
          `[ledger-undeclared-collapse] NON_READ_ANCHORS row for ${row.file}#${row.symbol} shares its ` +
            'symbol with a census elevation read, so it no longer excuses an anchor. Declare ' +
            '`collapsesOntoRead: true` on the row, or re-key it to the symbol it is really about.'
        );
        continue;
      }
      if (!collapses && row.collapsesOntoRead === true) {
        problems.push(
          `[ledger-stale-collapse] NON_READ_ANCHORS row for ${row.file}#${row.symbol} declares ` +
            '`collapsesOntoRead`, but the census finds no elevation read in that symbol any more -- ' +
            'the read moved or was deleted, and this row is excusing an anchor again without anyone ' +
            'having re-read it.'
        );
        continue;
      }
    }
    const key = row.symbol === null || row.symbol === undefined ? row.file : `${row.file}#${row.symbol}`;
    if (!declared.has(key)) declared.set(key, []);
    declared.get(key).push(row);
  }
  return { declared, problems };
}

/**
 * The whole verdict, as data. Pure, so `--self-test` can drive it on fixtures.
 *
 * @returns {{ problems: string[], stats: object }}
 */
export function evaluate({
  pageText,
  census,
  readFile,
  sweep,
  ledger = NON_READ_ANCHORS,
  declaredCounts = DECLARED_COUNTS,
  unenforcedCounts = UNENFORCED_TEXT_COUNTS,
  measuredAt = UNENFORCED_MEASURED_AT,
  pageRowReferences = PAGE_ROW_REFERENCES,
}) {
  const problems = [];

  const { anchors } = extractAnchors(pageText);
  if (anchors.length === 0) {
    problems.push(
      '[no-anchors] the page yielded ZERO anchors -- the reader stopped ' +
        'recognising the page rather than the page being clean.'
    );
    return { problems, stats: { anchors: 0 } };
  }
  if (census.sites.length === 0) {
    problems.push('[empty-census] the census found ZERO read sites -- refusing to compare against nothing.');
    return { problems, stats: { anchors: anchors.length } };
  }
  for (const row of census.staleLedgerRows) {
    problems.push(
      `[stale-ledger-row] isystem-census NON_ELEVATION_READS names ${row.file} (receiver ` +
        `\`${row.receiver}\`) but no such read exists -- delete the row.`
    );
  }

  // ── A. RESOLUTION — delegated whole to the shared resolver ──────────────────
  //
  // ⭐ Not re-implemented here, and not optional either. `sweepCorpus` over
  // `CORPUS` is what decides that a path is tracked, that a `#symbol` has a
  // declaration site, and that a surviving line number is a finding. A sweep this
  // gate could not run is a REFUSAL: "could not check" reported as "checked and
  // clean" is the silently-degrading verifier this repo refuses on principle.
  if (!sweep || !Array.isArray(sweep.findings)) {
    problems.push(
      '[no-sweep] the shared symbol-anchor resolver was not run over this page, so NOTHING here ' +
        'resolved an anchor. Run `sweepCorpus(CORPUS, root)` and pass its result -- a missing sweep ' +
        'is a failure, never a skip.'
    );
    return { problems, stats: { anchors: anchors.length } };
  }
  for (const finding of sweep.findings) {
    if (finding.soft) continue;
    problems.push(`[${finding.kind}] ${finding.doc}:${finding.line}  ${finding.raw} -- ${finding.detail}`);
  }

  // ── the page's own citations, as SETS ───────────────────────────────────────
  /** @type {Map<string, Set<string>>} path -> the symbols the page cites into it */
  const pageSymbols = new Map();
  /** @type {Set<string>} paths the page cites with NO symbol -- file-level anchors */
  const pageFileLevel = new Set();
  for (const anchor of anchors) {
    if (anchor.repo) continue; // cross-repo: reported by the sweep, resolved nowhere here
    if (!anchor.symbol) {
      pageFileLevel.add(anchor.path);
      continue;
    }
    if (!pageSymbols.has(anchor.path)) pageSymbols.set(anchor.path, new Set());
    pageSymbols.get(anchor.path).add(anchor.symbol);
  }

  const population = symbolPopulation(census);
  const { declared, problems: ledgerProblems } = resolveNonReadAnchors(ledger, readFile, population);
  problems.push(...ledgerProblems);

  /** The symbols the page is REQUIRED to cite, per file: census ∪ ledger. */
  /** @type {Map<string, Set<string>>} */
  const required = new Map();
  const requireSymbol = (file, symbol) => {
    if (!required.has(file)) required.set(file, new Set());
    required.get(file).add(symbol);
  };
  for (const [file, entry] of population) for (const symbol of entry.symbols) requireSymbol(file, symbol);
  for (const key of declared.keys()) {
    const at = key.indexOf('#');
    if (at !== -1) requireSymbol(key.slice(0, at), key.slice(at + 1));
  }

  // ── B. POPULATION — ⭐ the mandatory direction, per FILE ─────────────────────
  //
  // Two halves, and the second is what makes the first more than "the file is
  // mentioned somewhere": every file with a read must be anchored, and the SET of
  // symbols cited into it must equal the set required. Reporting the set
  // difference rather than only the counts is deliberate -- the counts are equal
  // exactly when the sets are, and a count alone cannot tell an author WHICH
  // symbol to write.
  const missing = [];
  for (const [file, entry] of [...population].sort()) {
    const cited = pageSymbols.get(file) ?? new Set();
    const need = required.get(file) ?? new Set();
    if (cited.size === 0 && !pageFileLevel.has(file)) {
      missing.push(file);
      problems.push(
        `[file-without-a-row] ${file} holds ${entry.sites} elevation read site(s) in ` +
          `${entry.symbols.size} symbol(s) (${[...entry.symbols].join(', ') || 'none nameable'}) and NO ` +
          'anchor on the page points into it at all. Either the page is missing this file entirely, ' +
          'or every row that cited it rotted off.'
      );
      continue;
    }
    for (const symbol of [...entry.symbols].sort()) {
      if (cited.has(symbol)) continue;
      const sites = census.sites.filter((site) => site.file === file && site.symbol === symbol);
      missing.push(`${file}#${symbol}`);
      problems.push(
        `[site-without-a-row] ${file}#${symbol} holds ${sites.length} elevation read(s) ` +
          `(\`${(sites[0]?.text ?? '').slice(0, 90)}\`) and no row on the page anchors it. ` +
          `This file cites ${cited.size} symbol(s), the census and the ledger require ${need.size}. ` +
          'Either the page is missing this elevation behaviour, or a row rotted off it.'
      );
    }
    /* A read with no nameable enclosing declaration is anchored at FILE level --
     * the grammar's own fallback, and the only honest anchor for it. Today the
     * census produces none of these; the branch is here so that the first one to
     * arrive is a named refusal rather than a shape nothing considered. */
    if (entry.fileLevel && !pageFileLevel.has(file)) {
      missing.push(file);
      problems.push(
        `[site-without-a-file-anchor] ${file} holds an elevation read inside no nameable declaration, ` +
          'so it needs a FILE-LEVEL anchor here (the bare path, no `#symbol`) and the page carries none.'
      );
    }
  }

  // ── D. CLASSIFICATION ───────────────────────────────────────────────────────
  const unexplained = [];
  for (const [file, cited] of [...pageSymbols].sort()) {
    const need = required.get(file) ?? new Set();
    for (const symbol of [...cited].sort()) {
      if (need.has(symbol)) continue;
      unexplained.push(`${file}#${symbol}`);
      problems.push(
        `[anchor-is-not-a-read-site] the page anchors ${file}#${symbol}, which the census does not ` +
          'call an elevation read and NON_READ_ANCHORS does not declare. Either the symbol was ' +
          'renamed under the row, or the citation is deliberate and needs a ledger row.'
      );
    }
  }
  for (const [key, rows] of declared) {
    const at = key.indexOf('#');
    const used = at === -1 ? pageFileLevel.has(key) : pageSymbols.get(key.slice(0, at))?.has(key.slice(at + 1));
    if (used) continue;
    problems.push(
      `[ledger-row-unused] NON_READ_ANCHORS excuses ${key} (${rows.map((r) => r.why).join('; ')}) but no ` +
        `anchor on the page points there -- the row outlived the citation, or the anchor was re-keyed.`
    );
  }

  // ── C. COUNTS ───────────────────────────────────────────────────────────────
  for (const declared of declaredCounts) {
    const match = declared.pattern.exec(pageText);
    if (!match) {
      problems.push(
        `[count-pattern-unmatched] the page no longer carries the \`${declared.id}\` sentence ` +
          `(${declared.why}) -- this gate stopped checking a number nobody removed. Update the ` +
          'pattern together with the wording.'
      );
      continue;
    }
    const stated = Number(match[1]);
    const actual = declared.value(census, pageText);
    if (!Number.isInteger(actual) || actual < 0) {
      problems.push(
        `[count-underivable] \`${declared.id}\` could not be derived (${declared.why}) -- the page ` +
          'structure it reads is gone. Fix the reader together with the page.'
      );
      continue;
    }
    if (stated !== actual) {
      problems.push(
        `[declared-count] \`${declared.id}\` says ${stated}, the census says ${actual} (${declared.why}).`
      );
    }
  }

  // ── C2. THE UNENFORCED DECOMPOSITION: present and dated, never compared ──────
  // ⛔ The values below are NOT checked against the census -- see
  // UNENFORCED_TEXT_COUNTS for the measurement that put them there. What IS
  // checked is that the rows still exist and still say when they were true, so
  // "not enforced" cannot decay into "not there" or "undated".
  for (const row of unenforcedCounts) {
    if (!row.pattern.exec(pageText)) {
      problems.push(
        `[unenforced-count-missing] the page no longer carries the \`${row.id}\` row ` +
          `(${row.why}). It is deliberately not held to the census, but it is still ` +
          'required to be there -- delete it from UNENFORCED_TEXT_COUNTS if it is ' +
          'really gone, rather than leaving a row nobody can find.'
      );
    }
  }
  if (unenforcedCounts.length > 0 && measuredAt && !measuredAt.pattern.exec(pageText)) {
    problems.push(
      `[unenforced-counts-undated] the page states ${unenforcedCounts.length} number(s) this gate ` +
        'does not enforce and no longer says when they were measured ' +
        `(${measuredAt.why}). An unenforced number without a date reads as current ` +
        'and is checked by nothing -- restore the marker or delete the numbers.'
    );
  }

  // ── E. ROW REFERENCES: the numbers that point INTO the table (#15869) ───────
  // Held by their SEAM, never by the number they carry -- see PAGE_ROW_REFERENCES.
  const rowRefs = checkRowReferences({ pageText, ledger, pageRefs: pageRowReferences });
  problems.push(...rowRefs.problems);

  let citedSymbols = 0;
  for (const cited of pageSymbols.values()) citedSymbols += cited.size;
  let requiredSymbols = 0;
  for (const need of required.values()) requiredSymbols += need.size;
  let censusSymbols = 0;
  let collapsingFiles = 0;
  for (const entry of population.values()) {
    censusSymbols += entry.symbols.size;
    if (entry.symbols.size + (entry.fileLevel ? 1 : 0) !== entry.sites) collapsingFiles += 1;
  }

  return {
    problems,
    stats: {
      anchors: anchors.length,
      citedSymbols,
      requiredSymbols,
      censusSymbols,
      collapsingFiles,
      fileLevelAnchors: pageFileLevel.size,
      sites: census.sites.length,
      packages: census.packages.length,
      files: census.files.length,
      nonReadAnchors: declared.size,
      missing: missing.length,
      unexplained: unexplained.length,
      rowRefsHeld: rowRefs.held.page + rowRefs.held.why,
      rowRefsUnheld: rowRefs.held.unheld,
    },
  };
}

function readFileAt(root) {
  return (relPath) => readFileSync(join(root, relPath), 'utf8');
}

/**
 * ⛔ ANCHORS have nothing to repair, and `--fix` says so instead of exiting 0 in
 * silence about that half.
 *
 * Before #15921 this rewrote line numbers after a pure shift, which was the
 * common repair and a real one. Symbol anchors encode no position, so the shift
 * that repair existed for cannot happen: an edit above a site moves nothing this
 * page writes. A remaining anchor red is a human edit -- a rename, an arrived
 * read, a vanished one -- and none of them is mechanically derivable from the
 * tree. COUNTS are the other half, and `run()` handles those separately below
 * (#16919) -- this function is deliberately scoped to what stays a human edit.
 *
 * ⭐ The flag stays RECOGNISED on purpose. `gen:system-context-census` and
 * `scripts/regen-artifacts.mjs` both name it, and a flag that silently became a
 * no-op would leave both reading as a working regeneration path. This prints what
 * it did not do, then returns the ordinary verdict.
 */
function reportNoAnchorFix() {
  process.stdout.write(
    'check-system-context-census --fix: anchors have nothing to rewrite — this page carries no line\n' +
      '  numbers. Anchors are `path#symbol` (scripts/symbol-anchors.mjs), so an unrelated edit above a\n' +
      '  site cannot rot one and there is no mechanical repair to apply there. A remaining anchor red is\n' +
      '  a human edit: a renamed symbol, a read that arrived, or a read that vanished (add its row).\n'
  );
}

function run({ fix = false } = {}) {
  const readFile = readFileAt(ROOT);
  let pageText;
  try {
    pageText = readFile(PAGE);
  } catch (error) {
    process.stderr.write(`::error::[unreadable-page] ${PAGE} could not be read -- ${error.message}\n`);
    return 1;
  }

  const census = runCensus({ root: ROOT });
  /* RESOLUTION is the shared resolver's, run once, over this gate's corpus
   * registration. `evaluate` reports what it found and re-decides none of it. */
  const sweep = sweepCorpus(CORPUS, ROOT);
  if (sweep.counts.docs === 0) {
    process.stderr.write(
      `::error::[corpus-empty] the \`${CORPUS.id}\` corpus swept ZERO documents -- ${PAGE} moved out ` +
        'from under this gate, which would otherwise report a clean sweep over nothing.\n'
    );
    return 1;
  }

  if (fix) {
    // ── COUNTS: the one half of `--fix` that IS mechanical (#16919 direction 1) ──
    //
    // Reuses the exact `DECLARED_COUNTS` computation the COUNTS check below
    // runs, as a write instead of a comparison -- see `regenerateDeclaredCounts`.
    // A count that cannot be derived or located refuses loudly (`errors`) rather
    // than writing a partial page: a generator that writes six of seven numbers
    // and silently skips the seventh is worse than one that writes none.
    const { text, rewrites, errors } = regenerateDeclaredCounts({ pageText, census });
    if (errors.length > 0) {
      for (const error of errors) process.stderr.write(`::error::${error}\n`);
      process.stderr.write(
        `\ncheck-system-context-census --fix: ${errors.length} declared count(s) could not be ` +
          'regenerated -- the page wording changed out from under the pattern that reads it. Fix the ' +
          'wording and the pattern together (by hand), then re-run --fix.\n'
      );
      return 1;
    }
    if (rewrites.length > 0) {
      writeFileSync(join(ROOT, PAGE), text, 'utf8');
      pageText = text;
      process.stdout.write(
        `check-system-context-census --fix: regenerated ${rewrites.length} declared count(s) from the ` +
          `census: ${rewrites.map((r) => `${r.id} ${r.from}->${r.to}`).join(', ')}.\n`
      );
    } else {
      process.stdout.write(
        'check-system-context-census --fix: every declared count already matches the census -- nothing ' +
          'to rewrite there.\n'
      );
    }
    reportNoAnchorFix();
  }

  const { problems, stats } = evaluate({ pageText, census, readFile, sweep });
  for (const problem of problems) process.stderr.write(`::error::${problem}\n`);
  if (problems.length > 0) {
    process.stderr.write(
      `\ncheck-system-context-census: ${problems.length} problem(s) over ${stats.anchors} anchors ` +
        `and ${stats.sites} census sites.\n` +
        'Re-run the census with `node scripts/isystem-census.mjs --json`. A `[declared-count]` mismatch ' +
        'is mechanical -- `pnpm gen:system-context-census` (`--fix`) rewrites it from the census. ' +
        '⛔ Everything else here is a human edit.\n' +
        `\nThe anchor grammar:\n  ${ANCHOR_GRAMMAR}\n`
    );
    return 1;
  }
  process.stdout.write(
    `check-system-context-census: OK — ${stats.sites} elevation read sites in ${stats.packages} ` +
      `packages across ${stats.files} files, living in ${stats.censusSymbols} symbol(s); the page ` +
      `cites ${stats.citedSymbols} symbol(s) against ${stats.requiredSymbols} required, over ` +
      `${stats.anchors} anchors and ${stats.fileLevelAnchors} file-level citation(s); ` +
      `${stats.nonReadAnchors} declared non-read; ${stats.collapsingFiles} file(s) hold more than one ` +
      `read in one symbol (the declared precision loss); ${stats.rowRefsHeld} row reference(s) resolve ` +
      `to their keyed row, ${stats.rowRefsUnheld} declared unheld.\n`
  );
  return 0;
}

/* ────────────────────────────── self-test ────────────────────────────────── */

const FIXTURE_SOURCE = [
  'export function handler(ctx: ExecutionContext) {', // 1
  '  if (ctx.isSystem) return ALLOW;', // 2
  '  const other = obj.isSystem;', // 3
  '  return DENY;', // 4
  '}', // 5
  '// the sys_ prefix helper lives here', // 6
  'export function isSystemObjectName(name: string) { return name.startsWith("sys_"); }', // 7
  'export function unrelated() { return 1; }', // 8
].join('\n');

const FIXTURE_CENSUS = {
  sites: [
    { file: 'pkg/a.ts', line: 2, receiver: 'ctx', package: 'pkg', symbol: 'handler', text: 'if (ctx.isSystem) return ALLOW;' },
  ],
  nonElevationReads: [{ file: 'pkg/a.ts', line: 3, receiver: 'obj', field: 'Object.isSystem' }],
  roleCounts: { read: 2, declaration: 0, key: 0, other: 0 },
  packages: ['pkg'],
  files: ['pkg/a.ts'],
  staleLedgerRows: [],
  scannedFiles: 1,
  text: { linesTotal: 3, linesInTests: 0, linesInSources: 3, identifierAppearances: 3, classified: 2, inCommentsAndStrings: 1 },
};

const FIXTURE_LEDGER = [
  { file: 'pkg/a.ts', symbol: 'isSystemObjectName', why: 'name-prefix helper, not a read' },
];

function fixtureRead(relPath) {
  if (relPath === 'pkg/a.ts') return FIXTURE_SOURCE;
  throw new Error(`no fixture for ${relPath}`);
}

/**
 * A sweep result that found nothing. RESOLUTION is delegated to `sweepCorpus`,
 * which walks a real tree; the fixtures below drive POPULATION, CLASSIFICATION and
 * COUNTS, and hand `evaluate` the shape a clean sweep returns.
 *
 * ⭐ It is passed EXPLICITLY, never defaulted: `evaluate` refuses a missing sweep,
 * and a default would let that refusal be forgotten by every caller at once.
 */
const CLEAN_SWEEP = { findings: [], counts: { docs: 1, anchors: 2 } };

/** A one-row stand-in for `DECLARED_COUNTS`, so the fixtures need one sentence. */
const FIXTURE_COUNTS = [
  {
    id: 'headline-sites',
    pattern: /a single boolean read at \*\*(\d+)\s*\n?\s*distinct sites/,
    value: (c) => c.sites.length,
    why: 'fixture headline',
  },
];

function fixturePage({ anchor = 'pkg/a.ts#handler', helper = 'pkg/a.ts#isSystemObjectName' } = {}) {
  return [
    '---',
    'title: fixture',
    '---',
    '',
    'read at `' + anchor + '` and the name helper at `' + helper + '`.',
    '',
    '```bash',
    'grep -rn "isSystem" packages   # not an anchor: fenced material is quoted, not cited',
    '```',
    '',
  ].join('\n');
}

/**
 * ── The RED-FIRST corpus, as a real git tree ────────────────────────────────
 *
 * ⭐ The ruled headline pair — a symbol rename REDS, a pure line move does NOT —
 * cannot be shown on an in-memory fixture: `sweepCorpus` resolves against
 * `git ls-files` and reads the target from disk, so a fixture that skipped either
 * would be pinning something other than the gate. This builds a two-file tree,
 * `git init`s it and stages it, which is the whole of what the resolver needs.
 *
 * ⛔ Nothing here ever touches the real repository. Every case reads back what it
 * wrote and the temp dir is removed in a `finally`.
 *
 * ## ⛔ Why every `git` call below runs with a STRIPPED environment (measured)
 *
 * This self-test shells out to `git` -- here, and one frame down inside
 * `sweepCorpus`, which asks `git ls-files` what a corpus's tracked files are.
 * From a plain shell that is harmless. From INSIDE A GIT HOOK it is not: git
 * exports `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE`, every child `git`
 * inherits them, and then the throwaway corpus's `git init` creates nothing
 * while its `git add -A` writes THE REPOSITORY'S INDEX.
 *
 * ⭐ That is not hypothetical and it is not a rare path: `check-regen-pending`
 * runs this gate from `pre-commit`, which is precisely where an os-regen merge
 * lap lands. Measured once, on this file's own branch, during exactly that lap:
 * 8,190 paths staged as deleted and the fixture's own `pkg/a.ts` staged into the
 * real index, from a self-test whose every case still printed `ok`.
 *
 * ⛔ The failure is SILENT in the direction that matters -- the self-test passes,
 * and the damage is to a tree nobody was looking at. So the environment is
 * stripped for the duration of the self-test AND passed stripped to each child
 * here, rather than relying on either one alone.
 *
 * ⭐ The strip itself now lives in `scripts/git-env.mjs`, so the rule this gate
 * discovered has ONE spelling for the whole repo rather than a copy per gate
 * that learns it (#16624). The local copy that used to sit here is gone; what
 * stays here is the pin below, because the pin is about THIS gate's children.
 *
 * @param {{ symbol?: string, pad?: number }} shape
 * @returns {{ dir: string, sourceLine: number }}
 */
function buildRedFirstCorpus({ symbol = 'handler', pad = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'system-context-corpus-'));
  mkdirSync(join(dir, 'content', 'docs', 'permissions'), { recursive: true });
  mkdirSync(join(dir, 'pkg'), { recursive: true });
  const head = Array.from({ length: pad }, (_, i) => `// padding line ${i + 1}`);
  const body = [
    `export function ${symbol}(ctx: ExecutionContext) {`,
    '  if (ctx.isSystem) return ALLOW;',
    '  return DENY;',
    '}',
  ];
  writeFileSync(join(dir, 'pkg', 'a.ts'), [...head, ...body].join('\n'));
  writeFileSync(
    join(dir, 'content', 'docs', 'permissions', 'system-context.mdx'),
    ['---', 'title: red-first fixture', '---', '', 'the elevation read lives at `pkg/a.ts#handler`.', ''].join('\n')
  );
  const env = gitFreeEnv();
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  execFileSync('git', ['add', '-A'], { cwd: dir, env });
  return { dir, sourceLine: pad + 2 };
}

/**
 * ── The ROW REFERENCE fixture (#15869) ──────────────────────────────────────
 *
 * A miniature of the real page's shape, and only its shape: one behaviour table
 * whose numbering runs on into a `### 6.` carry-onward table, then the four
 * spellings the real page uses to point back into them -- `Row N`,
 * `row N's`, `row N`, and the two `rows N–M` extents.
 *
 * ⛔ Deliberately NOT a copy of the real page: the cases below drive one edit at
 * a time, and a fixture small enough to read whole is the only way a reader can
 * see that the edit is the only difference. The real page is exercised too, in
 * the same battery, by the ablation.
 */
const ROW_FIXTURE_PAGE = [
  '---',
  'title: row fixture',
  '---',
  '',
  '| # | Behaviour | Anchor |',
  '|:--|:---|:---|',
  '| 1 | **The short-circuit** runs first | `pkg/a.ts#handler` |',
  '| 2 | **`owner_id` is not stamped** on INSERT | `pkg/a.ts#stamp` |',
  '| 3 | `revoke()` deletes directly, before the guard | `pkg/a.ts#revoke` |',
  '',
  '### 6. Reads that only carry the flag onward',
  '',
  '| # | Site | What it does |',
  '|:--|:---|:---|',
  '| 4 | `pkg/b.ts#carry` | Propagates the flag onward |',
  '| 5 | `pkg/b.ts#rebuild` | Rebuilds the context |',
  '',
  '1. **`revoke()` skips its own conflict guard.** Row 3 is correct for the rule.',
  "2. The shared verdict is the one function all of row 2's doors consult.",
  '3. The step 3.5 guard is inside the block row 1 skips.',
  '',
  '| — behaviour-bearing (rows 1–3 above) | 9 |',
  '| — carry the flag onward only (rows 4–5 above) | 2 |',
  '',
].join('\n');

/** The fixture's own `PAGE_ROW_REFERENCES`: one entry per reference above. */
const ROW_FIXTURE_REFS = [
  {
    context: '**`revoke()` skips its own conflict guard.**',
    seam: '`revoke()` deletes directly',
    why: 'the bolded subject is `revoke()`',
  },
  { context: 'doors consult', seam: '**`owner_id` is not stamped**', why: 'the doors are the stamp doors' },
  { context: 'is inside the block', seam: '**The short-circuit** runs first', why: 'the block is the short-circuit' },
  { context: 'behaviour-bearing (rows', section: 'behaviour', why: 'the behaviour extent' },
  { context: 'carry the flag onward only (rows', section: 'carry-onward', why: 'the carry-onward extent' },
];

/**
 * The fixture's own `NON_READ_ANCHORS`, carrying all three `why:` shapes: a plain
 * `row N`, a `why` naming TWO rows in one string, and the hyphenated `row-N`.
 */
const ROW_FIXTURE_LEDGER = [
  {
    file: 'pkg/a.ts',
    symbol: 'handler',
    why: 'row 3 -- the guard `revoke()` deletes in front of',
    rowSeams: ['`revoke()` deletes directly'],
  },
  {
    file: 'pkg/a.ts',
    symbol: 'isSystemObjectName',
    why: 'row 2 -- the stamp guard the row-1 short-circuit skips',
    rowSeams: ['**`owner_id` is not stamped**', '**The short-circuit** runs first'],
  },
  { file: 'pkg/a.ts', symbol: 'unrelated', why: 'rough edge 5 -- names no row at all', rowSeams: [] },
];

/**
 * Insert one numbered row above row `n` and renumber every row at or below it --
 * the edit PR #15687 made, which this gate used to be green through.
 *
 * @returns {{ text: string, inserted: boolean }}
 */
function insertRowAbove(pageText, n, cell) {
  let inserted = false;
  const out = [];
  for (const line of pageText.split('\n')) {
    const m = /^\|\s*(\d+)\s*\|(.*)$/.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const number = Number(m[1]);
    if (number === n && !inserted) {
      out.push(`| ${n} |${cell}`);
      inserted = true;
    }
    out.push(number >= n ? `| ${number + 1} |${m[2]}` : line);
  }
  return { text: out.join('\n'), inserted };
}

/**
 * The page's UNENFORCED decomposition, as a fixture: the six rows plus the dated
 * marker. Every knob is a way the page could decay -- a number going stale, a row
 * reworded away, the date dropped -- so the criterion can be driven from both sides.
 */
function fixtureUnenforcedTable({ linesTotal = 6, dropTestsRow = false, dated = true } = {}) {
  return [
    '',
    '| Measurement | Count | CI |',
    '|:---|--:|:--:|',
    '| Lines carrying `isSystem` in the corpus | ' + linesTotal + ' | — |',
    ...(dropTestsRow ? [] : ['| — in tests | 1 | — |']),
    '| — in non-test sources | 5 | — |',
    '| Appearances of the bare identifier `isSystem` in non-test sources | 5 | — |',
    '| — parsed as an object-literal / type key (producers) | 1 | — |',
    '| — the remainder: text inside comments and string literals | 2 | — |',
    '',
    dated
      ? 'The rows marked — were measured on 2026-08-29 at `ca1965f2b5` and are not enforced.'
      : 'The rows marked — are not enforced.',
    '',
  ].join('\n');
}

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

function selfTest() {
  /* ⛔ Detach from any inherited git environment BEFORE the first case. See
   * `buildRedFirstCorpus`'s header for the measured incident: under `pre-commit`
   * this function's children would otherwise write the REPOSITORY's index. This
   * covers `sweepCorpus`'s own `git ls-files` too, which lives in the shared
   * resolver and is not this gate's to change. Restored before the return, so an
   * in-process caller gets its environment back. */
  const savedGitEnv = Object.fromEntries(
    Object.keys(process.env).filter((key) => key.startsWith('GIT_')).map((key) => [key, process.env[key]])
  );
  for (const key of Object.keys(savedGitEnv)) delete process.env[key];

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
    if (!ok) failures += 1;
    process.stdout.write(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` -- ${detail}` : ''}\n`);
  };
  const run = (page, census = FIXTURE_CENSUS, declaredCounts = [], unenforcedCounts = [], extra = {}) =>
    evaluate({
      pageText: page,
      census,
      readFile: fixtureRead,
      sweep: CLEAN_SWEEP,
      ledger: FIXTURE_LEDGER,
      declaredCounts,
      unenforcedCounts,
      measuredAt: UNENFORCED_MEASURED_AT,
      // The row-reference ledger is about the REAL page's tables; these fixtures
      // carry no table at all. The battery below drives that check on its own
      // fixtures and on the real page.
      pageRowReferences: [],
      ...extra,
    });

  // ── the GREEN control: a page that is correct ───────────────────────────────
  battery('the GREEN control: a page that is correct');
  const green = run(fixturePage());
  t('green control: a correct page reports nothing', green.problems.length === 0, green.problems.join(' | '));
  t(
    'green control: the page cites exactly the symbols the census and the ledger require',
    green.stats.citedSymbols === 2 && green.stats.requiredSymbols === 2 && green.stats.censusSymbols === 1,
    JSON.stringify(green.stats)
  );

  // ── ⭐ the RED that matters: a site the page never mentions ──────────────────
  battery('⭐ the RED that matters: a site the page never mentions');
  const arrived = {
    ...FIXTURE_CENSUS,
    sites: [
      ...FIXTURE_CENSUS.sites,
      { file: 'pkg/a.ts', line: 8, receiver: 'ctx', package: 'pkg', symbol: 'unrelated', text: 'export function unrelated() { return 1; }' },
    ],
  };
  const missing = run(fixturePage(), arrived);
  t(
    'POPULATION: a read in a symbol no row anchors is a finding, naming the symbol',
    missing.problems.some((p) => p.startsWith('[site-without-a-row] pkg/a.ts#unrelated')),
    missing.problems.join(' | ')
  );
  const wholeFileMissing = run(fixturePage({ anchor: 'pkg/a.ts#unrelated', helper: 'pkg/a.ts#isSystemObjectName' }), {
    ...FIXTURE_CENSUS,
    sites: [{ file: 'pkg/b.ts', line: 1, receiver: 'ctx', package: 'pkg', symbol: 'guard', text: 'x' }],
    files: ['pkg/b.ts'],
  });
  t(
    'POPULATION: a whole FILE with reads and no anchor at all is its own finding',
    wholeFileMissing.problems.some((p) => p.startsWith('[file-without-a-row] pkg/b.ts')),
    wholeFileMissing.problems.join(' | ')
  );

  // ── the deletion shape: the row stands, the site is gone ────────────────────
  battery('the deletion shape: the row stands, the site is gone');
  const deleted = { ...FIXTURE_CENSUS, sites: [] };
  const gone = run(fixturePage(), deleted);
  t('POPULATION: an empty census refuses rather than passing', gone.problems.some((p) => p.startsWith('[empty-census]')));

  const shrunk = {
    ...FIXTURE_CENSUS,
    sites: [{ file: 'pkg/a.ts', line: 8, receiver: 'ctx', package: 'pkg', symbol: 'unrelated', text: 'export function unrelated() { return 1; }' }],
  };
  const stale = run(fixturePage(), shrunk);
  t(
    'DELETION: a row anchoring a symbol that is no longer a read site is a finding',
    stale.problems.some((p) => p.startsWith('[anchor-is-not-a-read-site]') && p.includes('pkg/a.ts#handler')),
    stale.problems.join(' | ')
  );
  t(
    'DELETION: and the arrived symbol is named on the other side in the same run',
    stale.problems.some((p) => p.startsWith('[site-without-a-row] pkg/a.ts#unrelated')),
    stale.problems.join(' | ')
  );

  // ── ⭐ RESOLUTION is DELEGATED, and a sweep that did not run is a REFUSAL ────
  //
  // ⛔ This gate must not re-decide what "the symbol is in that file" means --
  // two copies of that rule drift silently, each green on its own corpus. So the
  // only thing asserted here is the delegation itself: the sweep's findings are
  // surfaced verbatim, and its ABSENCE is a refusal rather than a quiet pass.
  battery('⭐ RESOLUTION is delegated, and a sweep that did not run is a REFUSAL');
  const noSweep = run(fixturePage(), FIXTURE_CENSUS, [], [], { sweep: undefined });
  t(
    'RESOLUTION: a missing sweep REFUSES -- "could not check" never reports as "checked and clean"',
    noSweep.problems.some((p) => p.startsWith('[no-sweep]')),
    noSweep.problems.join(' | ')
  );
  const brokenSweep = run(fixturePage(), FIXTURE_CENSUS, [], [], { sweep: { counts: {} } });
  t(
    'RESOLUTION: a sweep object with no findings ARRAY is refused too, not read as zero findings',
    brokenSweep.problems.some((p) => p.startsWith('[no-sweep]')),
    brokenSweep.problems.join(' | ')
  );
  const sweptRed = run(fixturePage(), FIXTURE_CENSUS, [], [], {
    sweep: {
      findings: [
        { kind: 'unresolved-symbol', doc: PAGE, line: 5, raw: '`pkg/a.ts#handler`', detail: '`handler` has no declaration site' },
        { kind: 'cross-repo-skipped', doc: PAGE, line: 5, raw: '`objectui:x.ts`', detail: 'no checkout', soft: true },
      ],
    },
  });
  t(
    "RESOLUTION: the sweep's hard findings are surfaced verbatim and its soft ones are not",
    sweptRed.problems.some((p) => p.startsWith('[unresolved-symbol]')) &&
      !sweptRed.problems.some((p) => p.includes('cross-repo-skipped')),
    sweptRed.problems.join(' | ')
  );

  // ── ledger ─────────────────────────────────────────────────────────────────
  battery('ledger');
  const ledgerRun = (ledger, page = fixturePage()) =>
    evaluate({
      pageRowReferences: [],
      pageText: page,
      census: FIXTURE_CENSUS,
      readFile: fixtureRead,
      sweep: CLEAN_SWEEP,
      ledger,
      unenforcedCounts: [],
      declaredCounts: [],
    });
  t(
    'LEDGER: a symbol the file no longer declares is a finding',
    ledgerRun([{ file: 'pkg/a.ts', symbol: 'noSuchSymbol', why: 'x' }]).problems.some((p) =>
      p.startsWith('[ledger-stale]')
    )
  );
  t(
    'LEDGER: a file that cannot be read is a finding, not a skipped row',
    ledgerRun([{ file: 'pkg/gone.ts', symbol: 'x', why: 'x' }]).problems.some((p) =>
      p.startsWith('[ledger-unreadable]')
    )
  );
  t(
    'LEDGER: a row no anchor uses is a finding',
    ledgerRun(FIXTURE_LEDGER, fixturePage({ helper: 'pkg/a.ts#handler' })).problems.some((p) =>
      p.startsWith('[ledger-row-unused]')
    )
  );
  t(
    '⭐ LEDGER: an UNDECLARED overlap with a census read symbol is a finding — a row that excuses ' +
      'nothing must say so',
    ledgerRun([{ file: 'pkg/a.ts', symbol: 'handler', why: 'x' }]).problems.some((p) =>
      p.startsWith('[ledger-undeclared-collapse]')
    )
  );
  t(
    '⭐ LEDGER: and a DECLARED overlap that has ended is a finding too — the declaration cannot rot ' +
      'in the safe direction either',
    ledgerRun([{ file: 'pkg/a.ts', symbol: 'isSystemObjectName', collapsesOntoRead: true, why: 'x' }]).problems.some(
      (p) => p.startsWith('[ledger-stale-collapse]')
    )
  );

  // ── counts ─────────────────────────────────────────────────────────────────
  battery('counts');
  const countSentence = '\nit is a single boolean read at **1\ndistinct sites across 1 packages**.\n';
  const countPage = fixturePage() + countSentence;
  const countsOk = run(countPage, FIXTURE_CENSUS, FIXTURE_COUNTS);
  t(
    'COUNTS: a matching declared count is silent',
    !countsOk.problems.some((p) => p.startsWith('[declared-count] `headline-sites`'))
  );
  const countBad =
    fixturePage() + '\nit is a single boolean read at **7\ndistinct sites across 1 packages**.\n';
  const countsRed = run(countBad, FIXTURE_CENSUS, FIXTURE_COUNTS);
  t(
    'COUNTS: a wrong declared count is a finding',
    countsRed.problems.some((p) => p.includes('`headline-sites` says 7, the census says 1'))
  );
  t(
    'COUNTS: a pattern that matches nothing is a finding, not a silent skip',
    run(fixturePage(), FIXTURE_CENSUS, FIXTURE_COUNTS).problems.some((p) =>
      p.startsWith('[count-pattern-unmatched]')
    )
  );

  const sectionPage = [
    '### 6. Reads that only carry the flag onward',
    '',
    '| # | Site |',
    '|:--|:---|',
    '| 62 | `pkg/a.ts#handler` |',
    '| 63 | `pkg/a.ts#handler` |',
    '',
    '---',
    '',
    '| — carry the flag onward only (rows 62–63 above) | 2 |',
  ].join('\n');
  t('COUNTS: the carry-onward split is read from section 6 itself', carryOnwardRowCount(sectionPage) === 2);
  t('COUNTS: a renamed section 6 is underivable, not zero', carryOnwardRowCount('nothing here') === -1);
  const underivable = evaluate({
    pageRowReferences: [],
    pageText: fixturePage(),
    census: FIXTURE_CENSUS,
    readFile: fixtureRead,
    sweep: CLEAN_SWEEP,
    ledger: FIXTURE_LEDGER,
    unenforcedCounts: [],
    declaredCounts: [
      { id: 'x', pattern: /helper at `pkg\/a\.ts#(\w+)`/, value: () => carryOnwardRowCount('gone'), why: 'fixture' },
    ],
  });
  t(
    'COUNTS: an underivable value is a finding, never compared as -1',
    underivable.problems.some((p) => p.startsWith('[count-underivable]'))
  );

  // ── ⭐ CRITERION: enforced means CENSUS-DERIVED, pinned over the REAL lists ──
  //
  // The drift below is what an unrelated merge to `main` does to this repo: one
  // test line that mentions the flag, one non-test source line carrying an
  // `isSystem: true` key, one comment that names it. Nothing about the elevation
  // population changes -- same sites, same packages, same files, same ledger.
  //
  // ⭐ These two cases run over `DECLARED_COUNTS` and `UNENFORCED_TEXT_COUNTS`
  // THEMSELVES, not over a fixture stand-in. That is the point: move a text count
  // back into the enforced list and the first case names it by id.
  battery('⭐ CRITERION: enforced means CENSUS-DERIVED, pinned over the REAL lists');
  const textDrifted = {
    ...FIXTURE_CENSUS,
    roleCounts: { ...FIXTURE_CENSUS.roleCounts, key: FIXTURE_CENSUS.roleCounts.key + 1 },
    text: { linesTotal: 6, linesInTests: 1, linesInSources: 5, identifierAppearances: 5, classified: 3, inCommentsAndStrings: 2 },
  };
  const driftPage = fixturePage();
  const driftedEnforced = DECLARED_COUNTS.filter(
    (d) => d.value(FIXTURE_CENSUS, driftPage) !== d.value(textDrifted, driftPage)
  );
  t(
    'CRITERION: every ENFORCED count holds still under whole-corpus text drift',
    driftedEnforced.length === 0,
    driftedEnforced.map((d) => d.id).join(', ')
  );
  const stuckUnenforced = UNENFORCED_TEXT_COUNTS.filter(
    (d) => d.value(FIXTURE_CENSUS, driftPage) === d.value(textDrifted, driftPage)
  );
  t(
    'CRITERION: all six UNENFORCED text counts DO move under that same drift',
    UNENFORCED_TEXT_COUNTS.length === 6 && stuckUnenforced.length === 0,
    `${UNENFORCED_TEXT_COUNTS.length} row(s); unmoved: ${stuckUnenforced.map((d) => d.id).join(', ')}`
  );

  // ── the same criterion, behaviourally, on one page ──────────────────────────
  battery('the same criterion, behaviourally, on one page');
  const okPage = fixturePage() + countSentence;
  const staleText = run(
    okPage + fixtureUnenforcedTable({ linesTotal: 999 }),
    textDrifted,
    FIXTURE_COUNTS,
    UNENFORCED_TEXT_COUNTS
  );
  t(
    'CRITERION: a stale whole-corpus text count is NOT a finding',
    staleText.problems.length === 0,
    staleText.problems.join(' | ')
  );
  const rowGoneCase = run(
    okPage + fixtureUnenforcedTable({ dropTestsRow: true }),
    textDrifted,
    FIXTURE_COUNTS,
    UNENFORCED_TEXT_COUNTS
  );
  t(
    'CRITERION: an unenforced row reworded off the page IS a finding',
    rowGoneCase.problems.some((p) => p.startsWith('[unenforced-count-missing]') && p.includes('`table-lines-tests`')),
    rowGoneCase.problems.join(' | ')
  );
  const undated = run(
    okPage + fixtureUnenforcedTable({ dated: false }),
    textDrifted,
    FIXTURE_COUNTS,
    UNENFORCED_TEXT_COUNTS
  );
  t(
    'CRITERION: unenforced numbers with no date are a finding, not a quiet pass',
    undated.problems.some((p) => p.startsWith('[unenforced-counts-undated]')),
    undated.problems.join(' | ')
  );

  // ── ⛔ and the half that must NOT have moved: the contract still reds ────────
  battery('⛔ and the half that must NOT have moved: the contract still reds');
  const rottedToo = run(
    fixturePage({ anchor: 'pkg/a.ts#unrelated' }) + countSentence + fixtureUnenforcedTable({ linesTotal: 999 }),
    FIXTURE_CENSUS,
    FIXTURE_COUNTS,
    UNENFORCED_TEXT_COUNTS
  );
  t(
    'CRITERION: a re-keyed ANCHOR still reds on the very page whose text counts are stale',
    rottedToo.problems.some((p) => p.startsWith('[site-without-a-row]')) &&
      rottedToo.problems.some((p) => p.startsWith('[anchor-is-not-a-read-site]')),
    rottedToo.problems.join(' | ')
  );
  const grewToo = run(
    okPage + fixtureUnenforcedTable({ linesTotal: 999 }),
    arrived,
    FIXTURE_COUNTS,
    UNENFORCED_TEXT_COUNTS
  );
  t(
    'CRITERION: a POPULATION change still reds on that same page',
    grewToo.problems.some((p) => p.startsWith('[site-without-a-row] pkg/a.ts#unrelated')) &&
      grewToo.problems.some((p) => p.includes('`headline-sites` says 1, the census says 2')),
    grewToo.problems.join(' | ')
  );

  // ── absence is loud ────────────────────────────────────────────────────────
  battery('absence is loud');
  const noAnchors = run('---\ntitle: x\n---\n\nnothing here.\n');
  t('ABSENCE: a page with no anchors refuses', noAnchors.problems.some((p) => p.startsWith('[no-anchors]')));

  // ── ⛔ --fix regenerates declared COUNTS only, never anchors, and says so ───
  //
  // ⭐ Two failures this pins, in opposite directions. `gen:system-context-census`
  // and `scripts/regen-artifacts.mjs` both invoke `--fix`; a flag that silently
  // went back to being a no-op (the pre-#16919 shape) leaves both reading as a
  // working regeneration path while every count red still needs a human. And a
  // `--fix` that goes the OTHER way -- resurrecting the retired line-shift
  // repair, or writing the page on a count it could not actually derive -- is
  // exactly the "mechanical repair" this gate explicitly does not offer for
  // anchors. Both directions are pinned on the SAME source read.
  battery('⛔ --fix regenerates declared COUNTS only, never anchors, and says so');
  let ownSourceForFix = null;
  try {
    ownSourceForFix = readFileSync(join(ROOT, 'scripts/check-system-context-census.mjs'), 'utf8');
  } catch (err) {
    t('--fix: this gate can read its own source', false, err.code ?? err.message);
  }
  if (ownSourceForFix !== null) {
    t(
      '--fix: no anchor line-shift repair survives -- symbol anchors still encode no position to fix',
      !/\bfixAnchors\b/.test(ownSourceForFix),
      'the retired line-shift repair is back in this file'
    );
    t(
      '--fix: the count-regenerating function is exported, not inlined where nothing else can reach it',
      /export function regenerateDeclaredCounts\(/.test(ownSourceForFix)
    );
    t(
      '--fix: the write is gated on there being something to write -- a no-op run must not touch the page',
      /if \(rewrites\.length > 0\) \{/.test(ownSourceForFix) &&
        /writeFileSync\(\s*join\(ROOT, PAGE\)/.test(ownSourceForFix)
    );
    t(
      '--fix: the flag is still RECOGNISED and explains BOTH halves, so the wiring cannot go quiet',
      /argv\.includes\('--fix'\)/.test(ownSourceForFix) &&
        /anchors have nothing to rewrite/.test(ownSourceForFix) &&
        /regenerated \$\{rewrites\.length\} declared count/.test(ownSourceForFix)
    );
  }

  // ⭐ Behavioural, not textual: drive `regenerateDeclaredCounts` itself on the
  // same fixtures the 'counts' battery already uses to pin the CHECK, so the
  // WRITE can never define "correct" any differently than the comparison does.
  const mismatched = fixturePage() + '\nit is a single boolean read at **7\ndistinct sites across 1 packages**.\n';
  const regenerated = regenerateDeclaredCounts({ pageText: mismatched, census: FIXTURE_CENSUS, declaredCounts: FIXTURE_COUNTS });
  t(
    '--fix REGENERATES: a mismatched declared count is rewritten to the census value, and reported',
    regenerated.errors.length === 0 &&
      regenerated.rewrites.length === 1 &&
      regenerated.rewrites[0].id === 'headline-sites' &&
      regenerated.rewrites[0].from === '7' &&
      regenerated.rewrites[0].to === '1',
    JSON.stringify(regenerated.rewrites)
  );
  t(
    '--fix REGENERATES: the rewritten text carries the new digit and NOT the old one, surrounding prose untouched',
    regenerated.text.includes('read at **1\ndistinct sites') && !regenerated.text.includes('**7\ndistinct sites'),
    regenerated.text
  );
  t(
    '⭐ IDEMPOTENCE: a page that already agrees with the census comes back BYTE-IDENTICAL, zero rewrites',
    (() => {
      const already = fixturePage() + '\nit is a single boolean read at **1\ndistinct sites across 1 packages**.\n';
      const first = regenerateDeclaredCounts({ pageText: already, census: FIXTURE_CENSUS, declaredCounts: FIXTURE_COUNTS });
      const second = regenerateDeclaredCounts({ pageText: first.text, census: FIXTURE_CENSUS, declaredCounts: FIXTURE_COUNTS });
      return (
        first.rewrites.length === 0 &&
        first.text === already &&
        second.rewrites.length === 0 &&
        second.text === first.text
      );
    })()
  );
  t(
    '--fix REFUSES rather than writes a partial page: an unmatched or underivable count surfaces as an error',
    (() => {
      const unmatched = regenerateDeclaredCounts({
        pageText: fixturePage(),
        census: FIXTURE_CENSUS,
        declaredCounts: FIXTURE_COUNTS,
      });
      const underivable = regenerateDeclaredCounts({
        pageText: fixturePage() + '\nhelper at `pkg/a.ts#isSystemObjectName`\n',
        census: FIXTURE_CENSUS,
        declaredCounts: [
          { id: 'x', pattern: /helper at `pkg\/a\.ts#(\w+)`/, value: () => carryOnwardRowCount('gone'), why: 'fixture' },
        ],
      });
      return (
        unmatched.errors.some((e) => e.startsWith('[count-pattern-unmatched]')) &&
        unmatched.text === fixturePage() &&
        underivable.errors.some((e) => e.startsWith('[count-underivable]'))
      );
    })()
  );

  // ── ⭐ THE RULED RED-FIRST PAIR, on a real tree ─────────────────────────────
  //
  // The two headline behaviours the migration was ruled on, proved rather than
  // asserted: a SYMBOL RENAME reds, a PURE LINE MOVE does not. Both run the real
  // `sweepCorpus` over a real `git` tree, because that is the only place the
  // resolver's inputs -- `git ls-files` and the target's own bytes -- exist.
  battery('⭐ THE RULED RED-FIRST PAIR: a symbol rename REDS, a pure line move does NOT');
  const corpora = [];
  try {
    const control = buildRedFirstCorpus();
    corpora.push(control.dir);
    const controlSweep = sweepCorpus(CORPUS, control.dir);
    t(
      'RED-FIRST control: the unmutated tree sweeps clean and really found the anchor',
      controlSweep.findings.filter((f) => !f.soft).length === 0 && controlSweep.counts.symbol === 1,
      JSON.stringify(controlSweep.counts) + ' ' + formatFindings(controlSweep.findings)
    );

    const renamed = buildRedFirstCorpus({ symbol: 'handleRequest' });
    corpora.push(renamed.dir);
    t(
      'RED-FIRST: the rename really reached disk -- the old name is gone from the target',
      !readFileSync(join(renamed.dir, 'pkg', 'a.ts'), 'utf8').includes('function handler(') &&
        readFileSync(join(renamed.dir, 'pkg', 'a.ts'), 'utf8').includes('function handleRequest(')
    );
    const renamedSweep = sweepCorpus(CORPUS, renamed.dir);
    t(
      '⭐ RED-FIRST: a RENAMED symbol turns the sweep RED, naming the anchor that no longer resolves',
      renamedSweep.findings.some((f) => f.kind === 'unresolved-symbol' && f.raw.includes('#handler')),
      formatFindings(renamedSweep.findings)
    );

    const moved = buildRedFirstCorpus({ pad: 40 });
    corpora.push(moved.dir);
    const movedSweep = sweepCorpus(CORPUS, moved.dir);
    t(
      '⭐ RED-FIRST: a PURE LINE MOVE (the read is 40 lines lower) is NOT red -- the property the ' +
        'line numbers did not have',
      moved.sourceLine === 42 &&
        control.sourceLine === 2 &&
        movedSweep.findings.filter((f) => !f.soft).length === 0,
      `read moved ${control.sourceLine} -> ${moved.sourceLine}; ` + formatFindings(movedSweep.findings)
    );
    /* ⛔ THE REGRESSION PIN for the measured incident above, and it pins the WRITE
     * side, which is the side that did the damage: a hook's exported `GIT_DIR`
     * must not reach `git init` / `git add -A`, or the throwaway corpus is never
     * created and the REPOSITORY's index is written instead.
     *
     * A bogus `GIT_DIR` is injected, the corpus is built under it, and the temp
     * tree is then read back with a stripped environment: two files staged, in
     * ITS OWN repository. If the builder had leaked, `git init` would have
     * created nothing there and `git ls-files` would answer with someone else's
     * tree — or with nothing at all.
     *
     * ⚠️ Deliberately NOT sweeping under the injected variable. `sweepCorpus`
     * asks `git ls-files` through the shared resolver, which passes no
     * environment of its own, so a sweep is protected by the process-level strip
     * at the top of this function rather than by anything here — and that strip
     * is what the second half of this case asserts. Hardening the shared
     * resolver is not this gate's to do. */
    const priorGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = join(tmpdir(), 'a-git-dir-that-does-not-exist');
    let staged = null;
    try {
      const guarded = buildRedFirstCorpus();
      corpora.push(guarded.dir);
      staged = execFileSync('git', ['ls-files'], { cwd: guarded.dir, encoding: 'utf8', env: gitFreeEnv() })
        .split('\n')
        .filter(Boolean)
        .sort();
    } catch (err) {
      staged = err;
    } finally {
      if (priorGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = priorGitDir;
    }
    t(
      '⛔ ENV LEAK: an inherited GIT_DIR (what `pre-commit` exports) never reaches the corpus builder, ' +
        'and the self-test itself runs detached — measured incident: 8,190 paths staged as deleted in ' +
        'the REAL index by a self-test whose every case still printed ok',
      Array.isArray(staged) &&
        staged.join(' ') === 'content/docs/permissions/system-context.mdx pkg/a.ts' &&
        Object.keys(process.env).filter((key) => key.startsWith('GIT_')).length === 0,
      staged instanceof Error ? String(staged.message).slice(0, 200) : JSON.stringify(staged)
    );
  } finally {
    for (const dir of corpora) rmSync(dir, { recursive: true, force: true });
  }

  // ── ⭐ the precision this trades away, pinned so nobody rediscovers it as a bug ─
  //
  // ⛔ Written as a PASSING case on purpose. The gap is real and declared -- on the
  // page and in this file's header -- and a self-test that quietly omitted it
  // would leave the next reader to find it as a defect and "fix" it by weakening
  // something else. Two reads inside ONE symbol, one of them deleted: the symbol
  // set does not move, and this gate does not red.
  battery('⭐ the precision this trades away, pinned so nobody rediscovers it as a bug');
  const twoInOne = {
    ...FIXTURE_CENSUS,
    sites: [
      ...FIXTURE_CENSUS.sites,
      { file: 'pkg/a.ts', line: 4, receiver: 'ctx', package: 'pkg', symbol: 'handler', text: 'return DENY;' },
    ],
  };
  const bothPresent = run(fixturePage(), twoInOne);
  const oneDeleted = run(fixturePage(), FIXTURE_CENSUS);
  t(
    '⛔ THE DECLARED GAP: deleting one of two reads inside one symbol does NOT red -- stated here ' +
      'rather than discovered later',
    bothPresent.problems.length === 0 && oneDeleted.problems.length === 0,
    `${bothPresent.problems.join(' | ')} // ${oneDeleted.problems.join(' | ')}`
  );
  t(
    '⭐ and the half that DOES hold: deleting the whole symbol reds, so the gap is bounded',
    run(fixturePage(), { ...FIXTURE_CENSUS, sites: [{ file: 'pkg/a.ts', line: 8, receiver: 'ctx', package: 'pkg', symbol: 'unrelated', text: 'x' }] })
      .problems.some((p) => p.startsWith('[anchor-is-not-a-read-site]') && p.includes('#handler'))
  );

  // ── the refusal has to SHOW its work (both counts, the symbol, the file) ─────
  battery('the refusal has to SHOW its work (both counts, the symbol, the file)');
  const refusal = missing.problems.find((p) => p.startsWith('[site-without-a-row]')) ?? '';
  t(
    'REFUSAL: the population refusal names the file, the symbol and how many reads live in it',
    refusal.includes('pkg/a.ts#unrelated') && refusal.includes('1 elevation read(s)'),
    refusal
  );
  t(
    'REFUSAL: and BOTH counts it compared, so the reader is not sent to run the census by hand',
    refusal.includes('cites 2 symbol(s), the census and the ledger require 3'),
    refusal
  );

  // ── ⭐ CORPUS REGISTRATION: one resolver, not a second implementation ────────
  battery('⭐ CORPUS REGISTRATION: one resolver, not a second implementation');
  t(
    'CORPUS: the registration names THIS page and only this page',
    CORPUS.docRoots.length === 1 &&
      PAGE.startsWith(`${CORPUS.docRoots[0]}/`) &&
      CORPUS.docPattern.test(PAGE.slice(CORPUS.docRoots[0].length + 1)) &&
      !CORPUS.docPattern.test('access-matrix.mdx'),
    JSON.stringify({ docRoots: CORPUS.docRoots, docPattern: String(CORPUS.docPattern) })
  );
  t(
    'CORPUS: bare paths ARE judged here -- this page spells every path in full',
    CORPUS.checkBarePaths === true
  );
  if (ownSourceForFix !== null) {
    t(
      '⛔ CORPUS: the resolution rule is imported, never restated -- no local symbol matcher, no ' +
        'second grammar',
      /import \{[\s\S]*?\} from '\.\/symbol-anchors\.mjs';/.test(ownSourceForFix) &&
        !/function\s+symbolResolutionClass\b/.test(ownSourceForFix) &&
        (ownSourceForFix.match(/defineCorpus\(/g) ?? []).length === 1
    );
  }

  // ── ⭐ ROW REFERENCES: held by SEAM, and the insertion that used to be silent ─
  //
  // The shape this battery exists for (#15869): a row INSERTED into the behaviour
  // table renumbers every row below it, so every `row N` past the insertion point
  // becomes false while this gate stays green -- because nothing compared a number
  // to a row. It happened (#15687, three references), and it un-happened by
  // coincidence (#15395, the same three), with nothing observing either event.
  //
  // ⭐ The ablation is run on a COPY of the REAL page, in a temp dir, because a
  // toy fixture cannot show that the check reaches the references that actually
  // rotted. The real page is never written -- asserted below, by bytes.
  battery('⭐ ROW REFERENCES: held by seam, and the insertion that was silent (#15869)');

  const rowRefs = (page, refs = ROW_FIXTURE_REFS, ledger = ROW_FIXTURE_LEDGER) =>
    checkRowReferences({ pageText: page, ledger, pageRefs: refs });
  const codes = (result) => result.problems.map((p) => p.slice(0, p.indexOf(']') + 1));

  const rowGreen = rowRefs(ROW_FIXTURE_PAGE);
  t(
    '⭐ POSITIVE CONTROL: every reference whose number MATCHES its keyed row passes',
    rowGreen.problems.length === 0,
    rowGreen.problems.join(' | ')
  );
  t(
    'the control really exercised all five page references and both `why:` mentions',
    rowGreen.held.page === 5 && rowGreen.held.why === 3 && rowGreen.held.unheld === 0,
    JSON.stringify(rowGreen.held)
  );

  // ── one case per SPELLING the page uses ────────────────────────────────────
  const falsified = (page, expect) => {
    const result = rowRefs(page);
    return (
      result.problems.some((p) => p.startsWith('[row-ref-falsified]') && p.includes(expect)) &&
      result.problems.length === 1
    );
  };
  t(
    'SPELLING `Row N` (sentence-initial): a number that no longer matches its seam is falsified',
    falsified(ROW_FIXTURE_PAGE.replace('Row 3 is correct', 'Row 2 is correct'), '`Row 2`')
  );
  t(
    "SPELLING `row N's` (possessive): same",
    falsified(ROW_FIXTURE_PAGE.replace("row 2's doors", "row 1's doors"), '`row 1`')
  );
  t(
    'SPELLING `row N` (lowercase, mid-sentence): same',
    falsified(ROW_FIXTURE_PAGE.replace('the block row 1 skips', 'the block row 3 skips'), '`row 3`')
  );
  t(
    'SPELLING `rows N–M` (range): the behaviour extent is held to the section, not to a seam',
    falsified(ROW_FIXTURE_PAGE.replace('(rows 1–3 above)', '(rows 1–4 above)'), '`rows 1–4`')
  );
  t(
    'SPELLING `rows N–M` (range): and the carry-onward extent to ITS section',
    falsified(ROW_FIXTURE_PAGE.replace('(rows 4–5 above)', '(rows 4–6 above)'), '`rows 4–6`')
  );

  // ── the incident shape, on the fixture: ONE insertion, several falsehoods ───
  const inserted = insertRowAbove(ROW_FIXTURE_PAGE, 3, ' **An inserted row** | `pkg/a.ts#inserted` |');
  const afterInsert = rowRefs(inserted.text);
  t(
    '⭐ THE INCIDENT SHAPE: inserting one row above row 3 falsifies every reference below it, ' +
      'and the refusal names the reference, its number and the row the key resolves to',
    inserted.inserted &&
      afterInsert.problems.filter((p) => p.startsWith('[row-ref-falsified]')).length === 3 &&
      afterInsert.problems.some((p) => p.includes('`Row 3`') && p.includes('is row 4')),
    afterInsert.problems.join(' | ')
  );

  // ── keys that stop resolving ───────────────────────────────────────────────
  t(
    'a key that resolves to NO row is a refusal, not a pass -- the reference is now held by nothing',
    codes(rowRefs(ROW_FIXTURE_PAGE.replace('`revoke()` deletes directly, before the guard', 'reworded'))).includes(
      '[row-ref-key-unresolved]'
    )
  );
  t(
    'a key that resolves to TWO rows refuses and names both candidates',
    (() => {
      const twice = ROW_FIXTURE_PAGE.replace(
        '| 2 | **`owner_id` is not stamped** on INSERT | `pkg/a.ts#stamp` |',
        '| 2 | **`owner_id` is not stamped** and `revoke()` deletes directly | `pkg/a.ts#stamp` |'
      );
      const result = rowRefs(twice);
      return result.problems.some((p) => p.startsWith('[row-ref-key-ambiguous]') && p.includes('rows 2, 3'));
    })()
  );
  t(
    'a context that no longer matches any line refuses rather than dropping the reference',
    codes(rowRefs(ROW_FIXTURE_PAGE, [{ context: 'a sentence nobody wrote', seam: 'x', why: 'y' }])).includes(
      '[row-ref-context-stale]'
    )
  );

  // ── POPULATION: the reference nobody declared ──────────────────────────────
  t(
    '⭐ POPULATION: a `row N` the ledger does not claim is a refusal -- a ledger of what exists ' +
      'today cannot see the reference someone writes tomorrow',
    (() => {
      const grown = `${ROW_FIXTURE_PAGE}\n4. And a brand new sentence about row 2.\n`;
      const result = rowRefs(grown);
      return result.problems.some((p) => p.startsWith('[row-ref-undeclared]') && p.includes('`row 2`'));
    })()
  );
  t(
    'an `unheld` entry is tolerated -- but still LOCATED, so it cannot decay into "not there"',
    (() => {
      const grown = `${ROW_FIXTURE_PAGE}\n4. And a sentence with no derivable key about row 2.\n`;
      const declared = [...ROW_FIXTURE_REFS, { context: 'no derivable key about', unheld: 'no key' }];
      const ok = rowRefs(grown, declared).problems.length === 0;
      const gone = rowRefs(ROW_FIXTURE_PAGE, declared).problems;
      return ok && gone.some((p) => p.startsWith('[row-ref-context-stale]'));
    })()
  );
  t(
    'ZERO numbered rows refuses instead of passing over a table it could not find',
    codes(rowRefs(ROW_FIXTURE_PAGE.replace(/^\| \d+ \|/gm, '| x |'))).includes('[no-table-rows]')
  );

  // ── the ledger's own `why:` strings ────────────────────────────────────────
  t(
    "a `why:` string whose row number disagrees with its seam is falsified, naming the `why`",
    (() => {
      const drifted = ROW_FIXTURE_LEDGER.map((row) =>
        row.why.startsWith('row 3') ? { ...row, why: 'row 2 -- the guard `revoke()` deletes in front of' } : row
      );
      const result = rowRefs(ROW_FIXTURE_PAGE, ROW_FIXTURE_REFS, drifted);
      return result.problems.some((p) => p.startsWith('[why-row-falsified]') && p.includes('is row 3'));
    })()
  );
  t(
    "SPELLING `row-N` (hyphenated, inside a `why:`): held by its own seam like any other",
    rowGreen.problems.length === 0 &&
      ROW_FIXTURE_LEDGER.some((row) => row.why.includes('row-1')) &&
      (() => {
        const drifted = ROW_FIXTURE_LEDGER.map((row) =>
          row.why.includes('row-1') ? { ...row, why: row.why.replace('row-1', 'row-3') } : row
        );
        return rowRefs(ROW_FIXTURE_PAGE, ROW_FIXTURE_REFS, drifted).problems.some((p) =>
          p.startsWith('[why-row-falsified]')
        );
      })()
  );
  t(
    'a `why:` that names a row and declares NO seam is refused -- an unkeyed number reads as current forever',
    (() => {
      const unkeyed = [{ file: 'pkg/a.ts', symbol: 'handler', why: 'row 3 -- unkeyed' }];
      return codes(rowRefs(ROW_FIXTURE_PAGE, ROW_FIXTURE_REFS, unkeyed)).includes('[why-row-unkeyed]');
    })()
  );

  // ── ⭐ THE REAL PAGE, and the ablation on a COPY of it ──────────────────────
  let realPage = null;
  try {
    realPage = readFileSync(join(ROOT, PAGE), 'utf8');
  } catch (err) {
    t('⭐ the real page is readable', false, err.code ?? err.message);
  }
  if (realPage !== null) {
    const realResult = checkRowReferences({ pageText: realPage });
    t(
      "⭐ TODAY'S TREE: every row reference on the real page and in the real ledger resolves to its keyed row",
      realResult.problems.length === 0,
      realResult.problems.join(' | ')
    );
    t(
      'and the real run really resolved them (10 page references + 8 `why:` mentions, 2 declared unheld)',
      realResult.held.page === 10 && realResult.held.why === 8 && realResult.held.unheld === 2,
      JSON.stringify(realResult.held)
    );

    // ⛔ The ablation is written to a TEMP DIR and read back from disk. The real
    // page is never opened for writing -- the byte assertion below is the proof.
    const before = createHash('sha256').update(realPage).digest('hex');
    const dir = mkdtempSync(join(tmpdir(), 'census-row-ablation-'));
    try {
      const mutated = insertRowAbove(
        realPage,
        34,
        ' **An inserted row, for the ablation** | plugin-sharing | Get: nothing | ' +
          '`packages/plugins/plugin-sharing/src/sharing-service.ts#grant` |'
      );
      const copy = join(dir, 'system-context.mdx');
      writeFileSync(copy, mutated.text);
      const readBack = readFileSync(copy, 'utf8');
      t(
        'ABLATION: the mutated COPY really reached the disk, one row heavier and renumbered',
        mutated.inserted &&
          readBack !== realPage &&
          extractTableRows(readBack).length === extractTableRows(realPage).length + 1,
        `${extractTableRows(realPage).length} -> ${extractTableRows(readBack).length} rows`
      );
      const ablated = checkRowReferences({ pageText: readBack });
      const falsifiedRefs = ablated.problems.filter((p) => p.startsWith('[row-ref-falsified]'));
      const falsifiedWhy = ablated.problems.filter((p) => p.startsWith('[why-row-falsified]'));
      t(
        '⭐ ABLATION: one row inserted above row 34 turns the gate RED, naming the falsified page ' +
          'references -- this is the exact edit #15687 made under a green gate',
        falsifiedRefs.some((p) => p.includes('`Row 35`') && p.includes('is row 36')) &&
          falsifiedRefs.some((p) => p.includes('`rows 1–63`')),
        ablated.problems.join(' | ')
      );
      t(
        '⭐ ABLATION: and the `why:` strings for the two `why:` references #15687 falsified ' +
          '(the seams #15687 knew as rows 34 and 60; the page has since grown a row above them)',
        falsifiedWhy.some((p) => p.includes('`row 35`') && p.includes('is row 36')) &&
          falsifiedWhy.some((p) => p.includes('`row 61`') && p.includes('is row 62')),
        falsifiedWhy.join(' | ')
      );
      t(
        '⛔ ABLATION SAFETY: the REAL page was never written -- same bytes before and after',
        createHash('sha256').update(readFileSync(join(ROOT, PAGE), 'utf8')).digest('hex') === before
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  battery('WIRING: this gate, and its self-test, really run in CI');
  const SELF = 'scripts/check-system-context-census.mjs';
  let lintYml = null;
  try {
    lintYml = readFileSync(join(ROOT, '.github/workflows/lint.yml'), 'utf8');
  } catch (err) {
    t(`WIRING: .github/workflows/lint.yml is readable`, false, err.code ?? err.message);
  }
  if (lintYml !== null) {
    t(
      'WIRING: lint.yml invokes this gate directly (the GATE INVOCATION IDIOM, not a package.json fence)',
      lintYml.includes(`node ${SELF}\n`)
    );
    t('WIRING: lint.yml runs the --self-test leg too', lintYml.includes(`node ${SELF} --self-test`));
  }

  // ── POPULATION DECLARATION: what the dispatch derivation is told this gate reads ──
  //
  // Nothing in this file can ENFORCE these: `ROOT_DIR_WATCH_HINTS` is read by
  // another tool entirely (`extractWatchHints` in `scripts/pm/dispatch-gates.mjs`),
  // so a stale or wrong declaration runs green here forever and pays itself out as
  // a dev dispatched on a `packages/` card with this gate absent from the brief --
  // the exact round this declaration was added to end. Both directions are derived
  // from `CORPUS_ROOTS`, never re-spelled: a corpus root added or dropped there has
  // to move this declaration or fail here.
  battery('POPULATION DECLARATION: what the dispatch derivation is told this gate reads');
  const declaredRoots = ROOT_DIR_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
  t(
    'POPULATION DECLARATION: every root the census walks is declared',
    CORPUS_ROOTS.every((r) => ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)),
    JSON.stringify({ CORPUS_ROOTS, ROOT_DIR_WATCH_HINTS })
  );
  t(
    'POPULATION DECLARATION: and it declares no root the census does not walk (a declaration that can '
      + 'drift from the walk is worse than none -- it replaces a silent gate with a lying one)',
    declaredRoots.every((r) => CORPUS_ROOTS.includes(r)),
    JSON.stringify(declaredRoots)
  );
  t(
    'POPULATION DECLARATION: each declared literal carries a separator -- a bare root word is refused as '
      + 'too generic by the consumer and would reach nothing',
    ROOT_DIR_WATCH_HINTS.every((h) => h.includes('/'))
  );
  t(
    'POPULATION DECLARATION: the repo root is NOT declared -- naming it would put this gate in every '
      + "card's brief to reach the two subtrees whose edits can turn it red",
    !declaredRoots.some((r) => r === '' || r === '.')
  );
  t(
    'POPULATION DECLARATION: the declared form is NOT the walk root itself (provenance, never a lookup '
      + 'key -- the glob form handed to the census would name directories that do not exist)',
    !CORPUS_ROOTS.some((r) => ROOT_DIR_WATCH_HINTS.includes(r))
  );
  // The literal SPELLING is the whole mechanism: the consumer scans source text,
  // so `CORPUS_ROOTS.map((r) => `${r}/**`)` would keep the runtime value, keep
  // every assertion above green, and contribute ZERO hints. `check-watch-hint-literal`
  // owns that rule fleet-wide; this pin is the own-source half, statement-scoped so
  // a second mention in prose or in a neighbouring assertion cannot satisfy it.
  let ownSource = null;
  try {
    ownSource = readFileSync(join(ROOT, SELF), 'utf8');
  } catch (err) {
    t('POPULATION DECLARATION: this gate can read its own source', false, err.code ?? err.message);
  }
  if (ownSource !== null) {
    const declSites = [...ownSource.matchAll(/\bconst\s+ROOT_DIR_WATCH_HINTS\s*=\s*([^;]*);/g)];
    t(
      'POPULATION DECLARATION: declared exactly once, as an array of quoted literals the text scan can read',
      declSites.length === 1 &&
        ROOT_DIR_WATCH_HINTS.every((h) => declSites[0][1].includes(`'${h}'`)) &&
        !/[A-Za-z_$][\w$]*\s*\./.test(declSites[0][1]),
      JSON.stringify(declSites.map((d) => d[1].replace(/\s+/g, ' ')))
    );
  }

  Object.assign(process.env, savedGitEnv);
  process.stdout.write(
    failures === 0
      ? '\ncheck-system-context-census --self-test: all cases passed\n'
      : `\ncheck-system-context-census --self-test: ${failures} case(s) FAILED\n`
  );
  selfTestReachedVerdict = true;
  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => {
    failures += 1;
      process.stdout.write(`  FAIL ${message}\n`);
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

  return failures === 0 ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
      const selfTestCode = selfTest();
      if (!selfTestReachedVerdict) {
          console.error(
              '\n✗ check-system-context-census self-test: selfTest() returned without reaching its verdict,\n'
                  + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                  + 'that never finished as a self-test that passed.\n',
          );
          process.exit(1);
      }
      process.exit(selfTestCode);
  }
  process.exit(run({ fix: argv.includes('--fix') }));
}
