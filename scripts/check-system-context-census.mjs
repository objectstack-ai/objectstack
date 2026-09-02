#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-system-context-census -- holds `content/docs/permissions/system-context.mdx`
 * to the code it claims to enumerate.
 *
 *   node scripts/check-system-context-census.mjs
 *   node scripts/check-system-context-census.mjs --self-test
 *   node scripts/check-system-context-census.mjs --fix   # re-anchor rotted lines
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
 * The two deletions are the reason a symbol-name anchor is not sufficient either.
 * Both were the `isSystem` propagation inside a `callerContext()` helper; both
 * helpers still exist under the same name. **A symbol anchor would still resolve
 * and would still be green** while the protection the row described was gone.
 * Deletions are caught here by the counts, which are census-derived: lose a site
 * and the page's declared 109 stops being true.
 *
 * ## The four checks
 *
 *   A  RESOLUTION   every anchor resolves to exactly one tracked file, at a line
 *                   that file has. Ambiguity is an error, never a guess: the
 *                   previous edition had 41 of 111 anchors whose bare basename
 *                   matched two files and could only be placed by reading the
 *                   row's prose.
 *   B  POPULATION   every elevation read site the census finds is anchored at its
 *                   exact `file:line`. Zero omissions. ⭐ This is the mandatory one.
 *   C  COUNTS       every CENSUS-DERIVED number the page states equals the census.
 *                   A pattern that matches NOTHING is an error, so a reworded page
 *                   cannot silently stop being checked. The page's whole-corpus
 *                   TEXT counts are deliberately NOT compared -- see the next
 *                   section -- but they are still required to be present and dated.
 *   D  CLASSIFICATION  an anchor that is not a read site must be a declared
 *                   `NON_READ_ANCHORS` row, and that row must still locate the line.
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
 * ## Why `NON_READ_ANCHORS` carries needles instead of line numbers
 *
 * 28 of the page's anchors are deliberately not read sites: the four unrelated
 * `isSystem` declarations, the `sys_`-prefix name helpers, a guard block a row
 * cites as the thing being skipped, and the prose targets in the "what it does NOT
 * do" table. They need an allow-list -- and an allow-list of LINE NUMBERS would rot
 * exactly like the anchors this gate exists to stop rotting, silently, because a
 * stale row still excuses an anchor.
 *
 * So each row carries a `needle`: a literal that must appear on exactly one line of
 * the file. The gate LOCATES the line and requires the page's anchor to name it.
 * That makes every anchor on the page enforced and mechanically repairable, and it
 * makes the ledger self-retiring -- a needle that matches zero lines, or more than
 * one, is an error naming the row.
 *
 * ## `--fix` repairs rot and REFUSES to repair population
 *
 * Per file, when the page's DISTINCT anchor count equals the number of lines the
 * file offers to be anchored -- its census read sites AND its `NON_READ_ANCHORS`
 * citations, as one union -- the two are mapped in line order and the numbers
 * rewritten: that is a pure shift, the shape an unrelated edit produces. When the
 * counts differ, the population changed -- a site arrived or vanished -- and no
 * mechanical mapping is honest. `--fix` leaves those alone and the gate stays red
 * until a human writes the row.
 *
 * ⭐ The union is load-bearing, not tidiness: subtracting the ledger by LINE
 * compares a pre-shift page with a post-shift ledger and reports a POPULATION
 * change over a population that never moved (#13490). `fixAnchors` carries the two
 * measured occurrences and why the union is the safer shape.
 *
 * ⇒ So the repair for a line-shift red is `--fix` and never a hand-edited line
 * number, and the repairing PR should state that `--fix` REFUSED ZERO files. That
 * sentence is what separates a pure re-anchor from a population change that
 * happened to be shifted at the same time: the refusal is the gate's only signal
 * that a site arrived or vanished, and a `--fix` run reporting refusals leaves
 * rows a human still has to write.
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

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { CORPUS_ROOTS, runCensus, siteKeys } from './isystem-census.mjs';
import { extractLineAnchors, extractPathCitations, resolveAnchorFile } from './doc-line-anchors.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const PAGE = 'content/docs/permissions/system-context.mdx';

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
 * sites. `needle` must appear on exactly ONE line of `file`; that line is where the
 * page's anchor has to point.
 */
export const NON_READ_ANCHORS = [
  // ── The four declarations that share the identifier ──────────────────────────
  {
    file: 'packages/spec/src/kernel/execution-context.zod.ts',
    needle: 'isSystem: z.boolean().default(false),',
    why: 'the elevation flag itself -- a declaration, not a read',
  },
  {
    file: 'packages/spec/src/data/object.zod.ts',
    needle: "isSystem: z.boolean().optional().default(false).describe('Is system object",
    why: 'Object.isSystem -- an unrelated metadata field the page names to defuse the collision',
  },
  {
    file: 'packages/spec/src/system/email-template.zod.ts',
    needle: 'isSystem: z.boolean().default(false),',
    why: 'EmailTemplate.isSystem -- unrelated metadata field',
  },
  {
    file: 'packages/spec/src/cloud/environment.zod.ts',
    needle: "isSystem: z.boolean().default(false).describe('Whether this is a system environment",
    why: 'Environment.isSystem -- unrelated metadata field',
  },
  // ── The `sys_` name-prefix family, cited to keep it apart from the flag ──────
  {
    file: 'packages/runtime/src/action-execution.ts',
    needle: 'export function isSystemObjectName(name: string): boolean {',
    why: 'keys on the `sys_` NAME PREFIX, not on any flag',
  },
  {
    file: 'packages/mcp/src/mcp-http-tools.ts',
    needle: 'function isSystemObject(name: string): boolean {',
    why: 'the same name-prefix helper, MCP side',
  },
  // ── Constructs a table row deliberately cites alongside its read ─────────────
  {
    file: 'packages/plugins/plugin-security/src/security-plugin.ts',
    needle: '3.5. [#3004]',
    why: 'row 2 -- the `owner_id` guard block that the row-1 short-circuit skips',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    needle: 'if (!hasTx && !hasTenant && !isSystem && !hasTz && !preserveAudit) return base;',
    why: 'row 24 -- the early return the tenant-audit read feeds',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    needle: 'if (isSystem && opts.bypassTenantAudit === undefined && !isTenantAuditInScope) {',
    why: 'row 24 -- where `bypassTenantAudit` is threaded to the driver',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    needle: 'if (options?.strictReadonlyWrites === true) {',
    why: 'row 22 -- the strict-drop refusal that never fires under elevation',
  },
  {
    file: 'packages/objectql/src/readonly-strict-errors.ts',
    needle: 'const READONLY_CLASS_REASONS',
    why: 'row 22 -- the reason set the silent refusal would have used',
  },
  {
    file: 'packages/plugins/plugin-security/src/system-write-guard.ts',
    needle: 'if (!isUserContextWrite(context)) return;',
    why: 'row 25 -- the bypass expressed through a helper rather than a direct read',
  },
  {
    file: 'packages/plugins/plugin-sharing/src/sharing-service.ts',
    needle: "if (row.source != null && row.source !== 'manual') {",
    why: 'row 34 -- the CONFLICT guard `revoke()` deletes in front of',
  },
  {
    file: 'packages/services/service-automation/src/builtin/crud-nodes.ts',
    needle: 'stampSystemInsertOwner(fields, dataCtx, data, objectName);',
    why: 'row 60 -- the call site of the compensating owner stamp',
  },
  {
    file: 'packages/objectql/src/registry.ts',
    needle: 'export function applySystemFields(',
    why: 'rough edge 5 -- named as if it read the flag; it reads it zero times',
  },
  // ── Prose targets: "what `isSystem` does NOT do", and the rough edges ────────
  {
    file: 'packages/metadata-protocol/src/seed-loader.ts',
    needle: 'so it must carry `skipTriggers` too.',
    why: 'the rationale comment the triggers row cites',
  },
  {
    file: 'packages/metadata-protocol/src/seed-loader.ts',
    needle: 'does NOT suppress trigger dispatch, only `skipTriggers` does',
    why: 'end of that rationale comment',
  },
  {
    file: 'packages/metadata-protocol/src/seed-loader.ts',
    needle: 'SEED_OPTIONS = { context: { isSystem: true, skipTriggers: true',
    why: 'the seed options that carry BOTH flags -- a producer, not a read',
  },
  {
    file: 'packages/spec/src/automation/flow.zod.ts',
    needle: 'Declare `system` to make the elevation explicit.',
    why: 'the flow-side declaration of the same distinction',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    needle: '// Runs BEFORE validation on purpose: a value the caller was never',
    why: 'start of the strip-before-validation block the validation row cites',
  },
  {
    file: 'packages/spec/src/data/field.zod.ts',
    needle: "readonly: z.boolean().default(false).describe(",
    why: '`preserveAudit` is the separate opt-in -- this is the `readonly` declaration',
  },
  {
    file: 'packages/services/service-automation/src/runtime-identity.ts',
    needle: 'const userId = (dataCtx as RunIdentityContext).userId;',
    why: 'audit stamping reads `userId`, not the flag',
  },
  {
    file: 'packages/services/service-automation/src/runtime-identity.ts',
    needle: 'if (!userId) return;',
    why: 'the user-less system write that stamps nothing',
  },
  {
    file: 'packages/plugins/plugin-auth/src/last-admin-guard.ts',
    needle: 'applies to EVERY context, `isSystem` included',
    why: 'the guard that is NOT bypassed -- cited to refute "it bypasses every guard"',
  },
  {
    file: 'packages/rest/src/rest-server.ts',
    needle: '"authenticated". `isSystem` flags are never set on inbound HTTP',
    why: 'inbound HTTP cannot set the flag',
  },
  {
    file: 'packages/rest/src/rest-server.ts',
    needle: '`isSystem` is never set on inbound HTTP, so it cannot bypass.',
    why: 'the second inbound seam',
  },
  {
    file: 'packages/runtime/src/domains/actions.ts',
    needle: '`isSystem` is never settable from the wire; internal',
    why: 'an action body cannot set the flag',
  },
];

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

/** Tracked files, for anchor resolution. */
export function trackedFiles(root = ROOT) {
  const files = execFileSync('git', ['-C', root, 'ls-files'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\n')
    .filter(Boolean);
  if (files.length === 0) throw new Error('check-system-context-census: `git ls-files` listed nothing');
  return files;
}

/**
 * Locate every `NON_READ_ANCHORS` row by its needle.
 *
 * @returns {{ located: Map<string, object>, problems: string[] }} keyed `file:line`
 */
export function locateNonReadAnchors(rows, readFile) {
  const located = new Map();
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
    const hits = [];
    body.split('\n').forEach((line, i) => {
      if (line.includes(row.needle)) hits.push(i + 1);
    });
    if (hits.length === 0) {
      problems.push(
        `[ledger-stale] NON_READ_ANCHORS row for ${row.file} no longer finds its needle ` +
          `\`${row.needle}\` -- the construct it excuses is gone or reworded (${row.why}).`
      );
      continue;
    }
    if (hits.length > 1) {
      problems.push(
        `[ledger-ambiguous] NON_READ_ANCHORS needle \`${row.needle}\` matches ${hits.length} ` +
          `lines of ${row.file} (${hits.join(', ')}) -- lengthen it until it is unique.`
      );
      continue;
    }
    located.set(`${row.file}:${hits[0]}`, row);
  }
  return { located, problems };
}

/**
 * The whole verdict, as data. Pure, so `--self-test` can drive it on fixtures.
 *
 * @returns {{ problems: string[], stats: object }}
 */
export function evaluate({
  pageText,
  census,
  tracked,
  readFile,
  ledger = NON_READ_ANCHORS,
  declaredCounts = DECLARED_COUNTS,
  unenforcedCounts = UNENFORCED_TEXT_COUNTS,
  measuredAt = UNENFORCED_MEASURED_AT,
}) {
  const problems = [];

  const anchors = extractLineAnchors(pageText);
  if (anchors.length === 0) {
    problems.push(
      '[no-anchors] the page yielded ZERO `file:line` anchors -- the reader stopped ' +
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

  // ── A. RESOLUTION ───────────────────────────────────────────────────────────
  /** @type {Map<string, object[]>} `file:line` -> anchors pointing there */
  const anchored = new Map();
  const fileLengths = new Map();
  for (const anchor of anchors) {
    const resolved = resolveAnchorFile(anchor.spelling, tracked);
    if ('error' in resolved) {
      problems.push(
        resolved.error === 'ambiguous'
          ? `[ambiguous-anchor] ${PAGE}:${anchor.docLine} spells \`${anchor.spelling}\`, which ` +
            `matches ${resolved.matches.length} tracked files (${resolved.matches.join(', ')}) -- ` +
            'lengthen the spelling until it is unique.'
          : `[unresolved-anchor] ${PAGE}:${anchor.docLine} spells \`${anchor.spelling}\`, which ` +
            'matches no tracked file -- the file moved or was deleted.'
      );
      continue;
    }
    const path = resolved.path;
    if (!fileLengths.has(path)) {
      try {
        fileLengths.set(path, readFile(path).split('\n').length);
      } catch {
        fileLengths.set(path, -1);
      }
    }
    const length = fileLengths.get(path);
    if (length === -1) {
      problems.push(`[unreadable-anchor-target] ${path} cannot be read (anchored at ${PAGE}:${anchor.docLine}).`);
      continue;
    }
    if (anchor.line < 1 || anchor.line > length) {
      problems.push(
        `[out-of-range-anchor] ${PAGE}:${anchor.docLine} anchors ${path}:${anchor.line}, ` +
          `but that file has ${length} lines.`
      );
      continue;
    }
    const key = `${path}:${anchor.line}`;
    if (!anchored.has(key)) anchored.set(key, []);
    anchored.get(key).push(anchor);
  }

  for (const citation of extractPathCitations(pageText)) {
    const resolved = resolveAnchorFile(citation.spelling, tracked);
    if ('error' in resolved) {
      problems.push(
        `[unresolved-citation] ${PAGE}:${citation.docLine} cites \`${citation.spelling}\`, ` +
          `which ${resolved.error === 'ambiguous' ? 'matches several tracked files' : 'matches no tracked file'}.`
      );
    }
  }

  // ── B. POPULATION — ⭐ the mandatory direction ───────────────────────────────
  const sites = siteKeys(census);
  const missing = [...sites].filter((key) => !anchored.has(key)).sort();
  for (const key of missing) {
    const site = census.sites.find((s) => `${s.file}:${s.line}` === key);
    problems.push(
      `[site-without-a-row] ${key} reads \`${site.receiver}.isSystem\` and NO row on the page ` +
        `anchors it — \`${site.text.slice(0, 90)}\`. ` +
        'Either the page is missing this elevation behaviour, or an existing row rotted off it.'
    );
  }

  // ── D. CLASSIFICATION ───────────────────────────────────────────────────────
  const { located, problems: ledgerProblems } = locateNonReadAnchors(ledger, readFile);
  problems.push(...ledgerProblems);
  const unexplained = [...anchored.keys()].filter((key) => !sites.has(key) && !located.has(key)).sort();
  for (const key of unexplained) {
    problems.push(
      `[anchor-is-not-a-read-site] the page anchors ${key}, which the census does not call an ` +
        'elevation read and NON_READ_ANCHORS does not declare. Either the line rotted, or the ' +
        'citation is deliberate and needs a ledger row with a needle.'
    );
  }
  const unusedLedger = [...located.entries()].filter(([key]) => !anchored.has(key));
  for (const [key, row] of unusedLedger) {
    problems.push(
      `[ledger-row-unused] NON_READ_ANCHORS excuses ${key} (${row.why}) but no anchor on the page ` +
        'points there -- the row outlived the citation, or the anchor rotted off it.'
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

  return {
    problems,
    stats: {
      anchors: anchors.length,
      anchorTargets: anchored.size,
      sites: sites.size,
      packages: census.packages.length,
      files: census.files.length,
      nonReadAnchors: located.size,
      missing: missing.length,
    },
  };
}

/** A line list for a refusal message, capped so one bad file cannot flood the log. */
function fmtLines(lines, cap = 14) {
  if (lines.length === 0) return '(none)';
  const shown = lines.slice(0, cap).join(', ');
  return lines.length > cap ? `${shown}, … (+${lines.length - cap} more)` : shown;
}

/**
 * The refusal, with everything it compared -- BOTH counts, BOTH target classes,
 * and the set difference.
 *
 * ⭐ Why the sets and not just the counts. Twice now this refusal has been read as
 * "your diff added or removed an elevation read site" when nothing of the sort had
 * happened, and the output gave the author no way to tell which case they were in
 * short of running `isystem-census.mjs --json` in two trees by hand. The last line
 * settles it mechanically: if NOTHING is already anchored the page is uniformly
 * displaced and some citation is unaccounted for; if everything but one target is
 * already anchored, that one target is the site that arrived.
 */
function describeRefusal({ path, pageLines, censusLines, ledgerLines, targets, located }) {
  const anchoredSet = new Set(pageLines);
  const targetSet = new Set(targets);
  const alreadyAnchored = targets.filter((line) => anchoredSet.has(line));
  const unanchored = targets.filter((line) => !anchoredSet.has(line));
  const stray = pageLines.filter((line) => !targetSet.has(line));
  const why = ledgerLines
    .map((line) => `${line} (${located.get(`${path}:${line}`)?.why ?? 'declared non-read'})`)
    .join('; ');
  return (
    `${path}: the page anchors ${pageLines.length} distinct line(s) into this file, but the tree ` +
    `holds ${targets.length} anchorable line(s) -- ${censusLines.length} census read site(s) plus ` +
    `${ledgerLines.length} NON_READ_ANCHORS citation(s). The POPULATION changed, this is not a ` +
    'shift. A row has to be written or deleted by hand.\n' +
    `       page anchors ......... ${fmtLines(pageLines)}\n` +
    `       census read sites .... ${fmtLines(censusLines)}\n` +
    `       ledger-excused ....... ${why || '(none)'}\n` +
    `       already anchored ..... ${alreadyAnchored.length} of ${targets.length} target(s)\n` +
    `       target, NO anchor .... ${fmtLines(unanchored)}\n` +
    `       anchor, NO target .... ${fmtLines(stray)}`
  );
}

/**
 * Rewrite rotted read-site anchors and ledger anchors in place.
 *
 * Only pure shifts. Per file the page's DISTINCT anchor lines are compared with the
 * union of the two classes of line this page is allowed to anchor -- the census's
 * read sites and the `NON_READ_ANCHORS` citations -- and rewritten by order when
 * the two counts agree. A population change is left for a human.
 *
 * ## ⛔ Why the ledger cannot be subtracted by LINE (#13490)
 *
 * The obvious partition -- "a page anchor is a read anchor unless it sits on a
 * ledger line" -- compares two DIFFERENT coordinate systems. The page's anchors are
 * pre-shift, by construction: rot is the only reason `--fix` is running. The ledger
 * lines are post-shift, because a row locates itself by NEEDLE in the current tree.
 * So a file whose ledger-excused citation also moved has that citation counted as a
 * read anchor, and the gate reports a POPULATION change over a population that
 * never moved. Measured twice, in two lanes, on two different files:
 *
 *   security-plugin.ts  7 read sites + 1 ledger citation, all displaced +20/+19 by
 *                       an unrelated bootstrap edit; zero `isSystem` lines added or
 *                       removed. Refusal: "page anchors 8 distinct read line(s),
 *                       census finds 7". (PR #13514, cost a patch round.)
 *   rest-server.ts      6 read sites + 2 ledger citations, displaced +3/+11 by a
 *                       merge. Refusal: "page anchors 7 ... census finds 6", with
 *                       the contradicting `[ledger-row-unused]` line in the SAME
 *                       run's output.
 *
 * ⚠️ And it is wrong in the other direction too, which is the dangerous one: a
 * stale READ anchor that happens to land on a line the ledger now occupies was
 * SUBTRACTED, so the counts could agree by cancellation and the rewrite would map
 * the surviving anchors onto each other's rows -- a page that is wrong and GREEN,
 * because both classes stay covered. That crossing is real: on the second
 * occurrence `rest-server.ts:1267` was simultaneously the second inbound seam's new
 * home and a read row's stale anchor.
 *
 * ⭐ Comparing the UNION removes both directions at once, and buys a postcondition
 * the per-class comparison cannot state: the rewrite is a BIJECTION from the page's
 * distinct anchor lines onto the file's anchorable lines, so every census site is
 * anchored, every ledger row is used and no anchor is unexplained -- for every file
 * `--fix` touches, `evaluate` is clean by construction. That is why the union is
 * the safer of the two shapes, and it is the one taken: it also refuses when a
 * ledger citation was added or dropped without the page following, which comparing
 * reads alone would have rewritten straight past.
 *
 * ⛔ What it still cannot see, stated rather than papered over: alignment is by
 * ORDER, so a pure displacement is reconstructed exactly, but a REORDERING that
 * moves a cited construct past another one inside the same file is indistinguishable
 * from a shift on line numbers alone. No line-only tool can tell those apart -- and
 * `evaluate` cannot either, since both classes stay covered. Rows are matched to
 * lines by a human there, as they always were.
 *
 * @returns {{ text: string, rewrites: string[], refused: string[] }}
 */
export function fixAnchors({ pageText, census, tracked, readFile, ledger = NON_READ_ANCHORS }) {
  const anchors = extractLineAnchors(pageText);
  const { located } = locateNonReadAnchors(ledger, readFile);
  /** ledger target lines, per file */
  const ledgerByFile = new Map();
  for (const key of located.keys()) {
    const at = key.lastIndexOf(':');
    const file = key.slice(0, at);
    if (!ledgerByFile.has(file)) ledgerByFile.set(file, []);
    ledgerByFile.get(file).push(Number(key.slice(at + 1)));
  }

  /** @type {Map<object, string>} anchor -> resolved path */
  const paths = new Map();
  for (const anchor of anchors) {
    const resolved = resolveAnchorFile(anchor.spelling, tracked);
    if ('path' in resolved) paths.set(anchor, resolved.path);
  }

  /** @type {Map<object, number>} anchor -> new line */
  const newLine = new Map();
  const refused = [];
  const byFile = new Map();
  for (const anchor of anchors) {
    const path = paths.get(anchor);
    if (!path) continue;
    if (!byFile.has(path)) byFile.set(path, []);
    byFile.get(path).push(anchor);
  }
  for (const [path, fileAnchors] of byFile) {
    const ledgerLines = [...new Set(ledgerByFile.get(path) ?? [])].sort((a, b) => a - b);
    const censusLines = [...new Set(census.sites.filter((s) => s.file === path).map((s) => s.line))].sort(
      (a, b) => a - b
    );
    // ⭐ The comparison is against the UNION of both target classes, in one pass.
    // A row cites the same line more than once (`:274` appears in the table AND in
    // the rough edges), so the comparable unit is a DISTINCT line, not an anchor.
    const targets = [...new Set([...censusLines, ...ledgerLines])].sort((a, b) => a - b);
    const pageLines = [...new Set(fileAnchors.map((a) => a.line))].sort((a, b) => a - b);
    if (pageLines.length !== targets.length) {
      refused.push(describeRefusal({ path, pageLines, censusLines, ledgerLines, targets, located }));
      continue;
    }
    const shift = new Map(pageLines.map((line, i) => [line, targets[i]]));
    for (const anchor of fileAnchors) {
      const to = shift.get(anchor.line);
      if (to !== undefined && to !== anchor.line) newLine.set(anchor, to);
    }
  }

  // Apply, latest anchor first, so earlier offsets stay valid.
  const rewrites = [];
  let text = pageText;
  const ordered = [...newLine.keys()].sort((a, b) => b.docLine - a.docLine || b.raw.length - a.raw.length);
  for (const anchor of ordered) {
    const to = newLine.get(anchor);
    const from = anchor.raw;
    const replacement =
      anchor.kind === 'full' ? `${anchor.spelling}:${to}` : anchor.kind === 'continuation' ? `:${to}` : `${to}`;
    const needle = `\`${from}\``;
    const at = text.indexOf(needle, offsetOfDocLine(text, anchor.docLine));
    if (at === -1) {
      refused.push(`could not re-find \`${from}\` at ${PAGE}:${anchor.docLine}`);
      continue;
    }
    text = `${text.slice(0, at)}\`${replacement}\`${text.slice(at + needle.length)}`;
    rewrites.push(`${PAGE}:${anchor.docLine}  \`${from}\` -> \`${replacement}\``);
  }
  return { text, rewrites, refused };
}

function offsetOfDocLine(text, docLine) {
  let offset = 0;
  for (let n = 1; n < docLine; n += 1) {
    const at = text.indexOf('\n', offset);
    if (at === -1) return offset;
    offset = at + 1;
  }
  return offset;
}

function readFileAt(root) {
  return (relPath) => readFileSync(join(root, relPath), 'utf8');
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
  const tracked = trackedFiles(ROOT);

  if (fix) {
    const { text, rewrites, refused } = fixAnchors({ pageText, census, tracked, readFile });
    if (rewrites.length > 0) writeFileSync(join(ROOT, PAGE), text);
    for (const line of rewrites) process.stdout.write(`  re-anchored ${line}\n`);
    for (const line of refused) process.stdout.write(`  ⛔ NOT fixable: ${line}\n`);
    process.stdout.write(`check-system-context-census --fix: ${rewrites.length} anchor(s) rewritten\n`);
    pageText = text;
  }

  const { problems, stats } = evaluate({ pageText, census, tracked, readFile });
  for (const problem of problems) process.stderr.write(`::error::${problem}\n`);
  if (problems.length > 0) {
    process.stderr.write(
      `\ncheck-system-context-census: ${problems.length} problem(s) over ${stats.anchors} anchors ` +
        `and ${stats.sites} census sites.\n` +
        `Re-run the census with \`node scripts/isystem-census.mjs --json\`; pure line rot is ` +
        `repaired by \`node scripts/check-system-context-census.mjs --fix\`.\n`
    );
    return 1;
  }
  process.stdout.write(
    `check-system-context-census: OK — ${stats.sites} elevation read sites in ${stats.packages} ` +
      `packages across ${stats.files} files, all anchored; ${stats.anchors} anchors resolve, ` +
      `${stats.nonReadAnchors} declared non-read.\n`
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
].join('\n');

const FIXTURE_CENSUS = {
  sites: [{ file: 'pkg/a.ts', line: 2, receiver: 'ctx', package: 'pkg', text: 'if (ctx.isSystem) return ALLOW;' }],
  nonElevationReads: [{ file: 'pkg/a.ts', line: 3, receiver: 'obj', field: 'Object.isSystem' }],
  roleCounts: { read: 2, declaration: 0, key: 0, other: 0 },
  packages: ['pkg'],
  files: ['pkg/a.ts'],
  staleLedgerRows: [],
  scannedFiles: 1,
  text: { linesTotal: 3, linesInTests: 0, linesInSources: 3, identifierAppearances: 3, classified: 2, inCommentsAndStrings: 1 },
};

const FIXTURE_LEDGER = [
  { file: 'pkg/a.ts', needle: 'export function isSystemObjectName', why: 'name-prefix helper, not a read' },
];

/**
 * ⭐ The CROSSING fixture (#13490). `pkg/a.ts` puts its read ABOVE its ledger
 * citation, which is the easy order: a stale read anchor can never land on the
 * ledger's line. Here the citation sits BELOW the read site, so a displacement
 * walks the citation onto ground a read anchor used to hold -- and the ledger was
 * subtracted by LINE, so that read anchor was subtracted with it. The counts then
 * agreed by cancellation and the rewrite mapped the two surviving anchors onto
 * each other's rows: a page that is WRONG and GREEN, because both classes stay
 * covered and nothing downstream compares a row to its meaning. That crossing is
 * not hypothetical -- `rest-server.ts:1267` was simultaneously the second inbound
 * seam's new home and a read row's stale anchor on the second occurrence.
 */
const CROSSING_SOURCE = [
  'export function guard(ctx: ExecutionContext) {', // 1
  '  const kind = classify(ctx);', // 2
  '  if (isSystemObjectName(ctx.objectName)) return SKIP;', // 3  <- ledger needle
  '  audit(kind);', // 4
  '  if (ctx.isSystem) return ALLOW;', // 5  <- the elevation read
  '  return DENY;', // 6
  '}', // 7
].join('\n');

const CROSSING_CENSUS = {
  ...FIXTURE_CENSUS,
  sites: [{ file: 'pkg/b.ts', line: 5, receiver: 'ctx', package: 'pkg', text: 'if (ctx.isSystem) return ALLOW;' }],
  files: ['pkg/b.ts'],
};

const CROSSING_LEDGER = [
  {
    file: 'pkg/b.ts',
    needle: 'isSystemObjectName(ctx.objectName)',
    why: 'the sys_ name-prefix helper call, not a read',
  },
];

function fixtureRead(relPath) {
  if (relPath === 'pkg/a.ts') return FIXTURE_SOURCE;
  if (relPath === 'pkg/b.ts') return CROSSING_SOURCE;
  throw new Error(`no fixture for ${relPath}`);
}

const FIXTURE_TRACKED = ['pkg/a.ts', 'other/a.ts', 'pkg/b.ts'];

/**
 * One anchor per line, so the two slots can be told apart AFTER a rewrite: the
 * question these cases ask is not "are both lines covered" -- the buggy fixer
 * covered both -- but "did each ROW keep its own line".
 */
function crossingPage({ read = 'pkg/b.ts:5', helper = 'pkg/b.ts:3' } = {}) {
  return [
    '---',
    'title: crossing fixture',
    '---',
    '',
    'the elevation read at `' + read + '`.',
    '',
    'the name helper at `' + helper + '`.',
    '',
  ].join('\n');
}

/** A one-row stand-in for `DECLARED_COUNTS`, so the fixtures need one sentence. */
const FIXTURE_COUNTS = [
  {
    id: 'headline-sites',
    pattern: /a single boolean read at \*\*(\d+)\s*\n?\s*distinct sites/,
    value: (c) => c.sites.length,
    why: 'fixture headline',
  },
];

function fixturePage({ anchor = 'pkg/a.ts:2', helper = 'pkg/a.ts:7' } = {}) {
  return [
    '---',
    'title: fixture',
    '---',
    '',
    'read at `' + anchor + '` and the name helper at `' + helper + '`.',
    '',
    '```bash',
    'grep -rn "isSystem" packages   # `pkg/a.ts:999` inside a fence is not an anchor',
    '```',
    '',
  ].join('\n');
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

function selfTest() {
  let failures = 0;
  const t = (name, ok, detail = '') => {
    if (!ok) failures += 1;
    process.stdout.write(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` -- ${detail}` : ''}\n`);
  };
  const run = (page, census = FIXTURE_CENSUS, declaredCounts = [], unenforcedCounts = []) =>
    evaluate({
      pageText: page,
      census,
      tracked: FIXTURE_TRACKED,
      readFile: fixtureRead,
      ledger: FIXTURE_LEDGER,
      declaredCounts,
      unenforcedCounts,
      measuredAt: UNENFORCED_MEASURED_AT,
    });

  // ── the GREEN control: a page that is correct ───────────────────────────────
  const green = run(fixturePage());
  t('green control: a correct page reports nothing', green.problems.length === 0, green.problems.join(' | '));
  t('green control: the fenced `pkg/a.ts:999` is not read as an anchor', green.stats.anchors === 2);

  // ── ⭐ the RED that matters: a site the page never mentions ──────────────────
  const arrived = {
    ...FIXTURE_CENSUS,
    sites: [...FIXTURE_CENSUS.sites, { file: 'pkg/a.ts', line: 4, receiver: 'ctx', package: 'pkg', text: 'return DENY;' }],
  };
  const missing = run(fixturePage(), arrived);
  t(
    'POPULATION: a read site with no row is a finding',
    missing.problems.some((p) => p.startsWith('[site-without-a-row] pkg/a.ts:4'))
  );

  // ── the deletion shape: the row stands, the site is gone ────────────────────
  const deleted = { ...FIXTURE_CENSUS, sites: [] };
  const gone = run(fixturePage(), deleted);
  t('POPULATION: an empty census refuses rather than passing', gone.problems.some((p) => p.startsWith('[empty-census]')));

  const shrunk = {
    ...FIXTURE_CENSUS,
    sites: [{ file: 'pkg/a.ts', line: 4, receiver: 'ctx', package: 'pkg', text: 'return DENY;' }],
  };
  const stale = run(fixturePage(), shrunk);
  t(
    'DELETION: a row anchoring a line that is no longer a read site is a finding',
    stale.problems.some((p) => p.startsWith('[anchor-is-not-a-read-site]') && p.includes('pkg/a.ts:2'))
  );

  // ── rot ────────────────────────────────────────────────────────────────────
  const rotted = run(fixturePage({ anchor: 'pkg/a.ts:4' }));
  t('ROT: a shifted anchor is caught from both sides', rotted.problems.length === 2, rotted.problems.join(' | '));

  // ── resolution ─────────────────────────────────────────────────────────────
  const ambiguous = run(fixturePage({ anchor: 'a.ts:2' }));
  t('RESOLUTION: a bare basename matching two files is refused', ambiguous.problems.some((p) => p.startsWith('[ambiguous-anchor]')));
  const gonefile = run(fixturePage({ anchor: 'pkg/nope.ts:2' }));
  t('RESOLUTION: an anchor to a file that does not exist is refused', gonefile.problems.some((p) => p.startsWith('[unresolved-anchor]')));
  const overrun = run(fixturePage({ anchor: 'pkg/a.ts:999' }));
  t('RESOLUTION: a line past end of file is refused', overrun.problems.some((p) => p.startsWith('[out-of-range-anchor]')));

  // ── ledger ─────────────────────────────────────────────────────────────────
  const ledgerStale = evaluate({
    pageText: fixturePage(),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: [{ file: 'pkg/a.ts', needle: 'no such text anywhere', why: 'x' }],
    unenforcedCounts: [],
    declaredCounts: [],
  });
  t('LEDGER: a needle that matches nothing is a finding', ledgerStale.problems.some((p) => p.startsWith('[ledger-stale]')));
  const ledgerAmbig = evaluate({
    pageText: fixturePage(),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: [{ file: 'pkg/a.ts', needle: 'return', why: 'x' }],
    unenforcedCounts: [],
    declaredCounts: [],
  });
  t('LEDGER: a needle matching two lines is a finding', ledgerAmbig.problems.some((p) => p.startsWith('[ledger-ambiguous]')));
  const ledgerUnused = evaluate({
    pageText: fixturePage({ helper: 'pkg/a.ts:2' }),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
    unenforcedCounts: [],
    declaredCounts: [],
  });
  t('LEDGER: a row no anchor uses is a finding', ledgerUnused.problems.some((p) => p.startsWith('[ledger-row-unused]')));

  // ── counts ─────────────────────────────────────────────────────────────────
  const countPage =
    fixturePage() + '\nit is a single boolean read at **1\ndistinct sites across 1 packages**.\n';
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
    '| 62 | `pkg/a.ts:2` |',
    '| 63 | `pkg/a.ts:2` |',
    '',
    '---',
    '',
    '| — carry the flag onward only (rows 62–63 above) | 2 |',
  ].join('\n');
  t('COUNTS: the carry-onward split is read from section 6 itself', carryOnwardRowCount(sectionPage) === 2);
  t('COUNTS: a renamed section 6 is underivable, not zero', carryOnwardRowCount('nothing here') === -1);
  const underivable = evaluate({
    pageText: fixturePage(),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
    unenforcedCounts: [],
    declaredCounts: [
      { id: 'x', pattern: /helper at `pkg\/a\.ts:(\d+)`/, value: () => carryOnwardRowCount('gone'), why: 'fixture' },
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
  // back into the enforced list and the first case names it by id. A criterion
  // change with nothing watching it is how the next reader undoes it.
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
  const countSentence = '\nit is a single boolean read at **1\ndistinct sites across 1 packages**.\n';
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
  const rowGone = run(
    okPage + fixtureUnenforcedTable({ dropTestsRow: true }),
    textDrifted,
    FIXTURE_COUNTS,
    UNENFORCED_TEXT_COUNTS
  );
  t(
    'CRITERION: an unenforced row reworded off the page IS a finding',
    rowGone.problems.some((p) => p.startsWith('[unenforced-count-missing]') && p.includes('`table-lines-tests`')),
    rowGone.problems.join(' | ')
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
  const rottedToo = run(
    fixturePage({ anchor: 'pkg/a.ts:4' }) + countSentence + fixtureUnenforcedTable({ linesTotal: 999 }),
    FIXTURE_CENSUS,
    FIXTURE_COUNTS,
    UNENFORCED_TEXT_COUNTS
  );
  t(
    'CRITERION: a rotted ANCHOR still reds on the very page whose text counts are stale',
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
    grewToo.problems.some((p) => p.startsWith('[site-without-a-row] pkg/a.ts:4')) &&
      grewToo.problems.some((p) => p.includes('`headline-sites` says 1, the census says 2')),
    grewToo.problems.join(' | ')
  );

  // ── absence is loud ────────────────────────────────────────────────────────
  const noAnchors = run('---\ntitle: x\n---\n\nnothing here.\n');
  t('ABSENCE: a page with no anchors refuses', noAnchors.problems.some((p) => p.startsWith('[no-anchors]')));

  // ── --fix ──────────────────────────────────────────────────────────────────
  const fixed = fixAnchors({
    pageText: fixturePage({ anchor: 'pkg/a.ts:4' }),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
  });
  t('FIX: a pure shift is rewritten', fixed.text.includes('`pkg/a.ts:2`'), fixed.rewrites.join(' | '));
  const refusedFix = fixAnchors({
    pageText: fixturePage(),
    census: arrived,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
  });
  t(
    'FIX: a population change is REFUSED, never guessed',
    refusedFix.rewrites.length === 0 && refusedFix.refused.length === 1,
    JSON.stringify(refusedFix.refused)
  );

  // ── ⭐ #13490: the incident shape -- reads AND ledger citations BOTH shift ────
  //
  // The pre-existing case above shifts the read only, which is why it never caught
  // this: a page anchor is pre-shift by construction, a ledger line is located by
  // needle in the CURRENT tree, and subtracting one from the other counts the
  // displaced citation as a read anchor. Measured on two files in two lanes --
  // `security-plugin.ts` (7 reads + 1 citation, all +20/+19, zero `isSystem` lines
  // added or removed) refused with "page anchors 8 distinct read line(s), census
  // finds 7", and `rest-server.ts` (6 + 2) with "7 ... finds 6".
  const bothShifted = fixAnchors({
    pageText: fixturePage({ anchor: 'pkg/a.ts:1', helper: 'pkg/a.ts:6' }),
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
  });
  t(
    'FIX #13490: a shift that moves the LEDGER citation too is a shift, not a population change',
    bothShifted.refused.length === 0 &&
      bothShifted.text.includes('`pkg/a.ts:2`') &&
      bothShifted.text.includes('`pkg/a.ts:7`'),
    `refused=${JSON.stringify(bothShifted.refused)} rewrites=${JSON.stringify(bothShifted.rewrites)}`
  );

  // ⭐ The postcondition the union buys: the rewrite is a BIJECTION from the page's
  // distinct anchor lines onto the file's anchorable lines, so a file `--fix`
  // touched cannot come back with a missing site, an unexplained anchor or an
  // unused ledger row. Pinned behaviourally rather than argued in a comment.
  const afterFix = evaluate({
    pageText: bothShifted.text,
    census: FIXTURE_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
    declaredCounts: [],
    unenforcedCounts: [],
  });
  t(
    'FIX #13490: what --fix rewrote evaluates clean -- every site anchored, every ledger row used',
    afterFix.problems.length === 0,
    afterFix.problems.join(' | ')
  );

  // ── ⛔ the dangerous direction: the citation crosses onto a read anchor's line ─
  //
  // Subtracting the ledger by LINE removed the stale READ anchor here (it sits on
  // `:3`, the citation's new home), the counts agreed by cancellation, and the one
  // surviving anchor was mapped onto the read site -- leaving the page GREEN with
  // the two rows pointing at each other's lines. Both spellings survive either
  // way, so this case asserts which ROW holds which line.
  const crossed = fixAnchors({
    pageText: crossingPage({ read: 'pkg/b.ts:3', helper: 'pkg/b.ts:2' }),
    census: CROSSING_CENSUS,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: CROSSING_LEDGER,
  });
  t(
    'FIX #13490: a citation crossing a read anchor keeps each ROW on its own line, not merely covered',
    crossed.refused.length === 0 &&
      crossed.text.includes('the elevation read at `pkg/b.ts:5`') &&
      crossed.text.includes('the name helper at `pkg/b.ts:3`'),
    `refused=${JSON.stringify(crossed.refused)} rewrites=${JSON.stringify(crossed.rewrites)}`
  );

  // ── ⭐ and the safety property, on the shape that now ACCEPTS ────────────────
  //
  // ⛔ The fix must not buy acceptance with the refusal. A read site ARRIVES while
  // the ledger citation shifts: the old counting arm and the new one both refuse
  // here, and that must stay true, or #13490 was closed by deleting the guard.
  const grewWhileShifting = fixAnchors({
    pageText: fixturePage({ anchor: 'pkg/a.ts:2', helper: 'pkg/a.ts:6' }),
    census: arrived,
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: FIXTURE_LEDGER,
  });
  t(
    'FIX #13490: a site that ARRIVES while the citation shifts is still REFUSED',
    grewWhileShifting.rewrites.length === 0 && grewWhileShifting.refused.length === 1,
    JSON.stringify(grewWhileShifting.refused)
  );

  const vanished = fixAnchors({
    pageText: crossingPage(),
    census: { ...CROSSING_CENSUS, sites: [...CROSSING_CENSUS.sites, { file: 'pkg/b.ts', line: 6, receiver: 'ctx', package: 'pkg', text: 'return DENY;' }] },
    tracked: FIXTURE_TRACKED,
    readFile: fixtureRead,
    ledger: CROSSING_LEDGER,
  });
  t(
    'FIX #13490: an unanchored site in the crossing file is REFUSED too',
    vanished.rewrites.length === 0 && vanished.refused.length === 1,
    JSON.stringify(vanished.refused)
  );

  // ── the refusal has to SHOW its work (both counts, both classes, the diff) ────
  //
  // Twice this refusal was read as "your diff added or removed an elevation read
  // site" when nothing had, and the output gave no way to tell which case you were
  // in short of running the census in two trees by hand. `already anchored 8 of 9`
  // + one named target settles it; `0 of 9` says uniform displacement.
  const refusalText = grewWhileShifting.refused[0] ?? '';
  t(
    'FIX #13490: the refusal states BOTH counts it compared and the ledger it set aside',
    refusalText.includes('the page anchors 2 distinct line(s)') &&
      refusalText.includes('holds 3 anchorable line(s)') &&
      refusalText.includes('2 census read site(s)') &&
      refusalText.includes('1 NON_READ_ANCHORS citation(s)') &&
      refusalText.includes('name-prefix helper, not a read'),
    refusalText
  );
  t(
    'FIX #13490: the refusal names the set difference, not just a count',
    refusalText.includes('already anchored') &&
      refusalText.includes('target, NO anchor') &&
      refusalText.includes('anchor, NO target'),
    refusalText
  );

  // ── WIRING: this gate, and its self-test, really run in CI ──────────────────
  //
  // ⭐ The half a clean tree cannot show, and the reason this block exists. Every
  // other case above judges the RULES; this one judges whether anything runs them.
  // `check-self-test-wired` is conditional in the wrong direction for that -- it
  // requires "if CI runs the script, CI runs its --self-test too", so deleting BOTH
  // lines from `lint.yml` leaves it green and silently retires the only instrument
  // that catches a stale anchor. Measured: the census is what reddens when a cited
  // file moves underneath a page nobody edited, so its scheduling is load-bearing,
  // not incidental.
  //
  // Asserted against the workflow TEXT, following the precedent `check-doc-frontmatter`,
  // `check-aggregator-roster` and `check-ci-filter-parity` set -- and, like the second
  // docs root that gate added, this needed NO workflow edit: `lint.yml` already invokes
  // both legs, and it is the repo's busiest file.
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

  process.stdout.write(
    failures === 0
      ? '\ncheck-system-context-census --self-test: all cases passed\n'
      : `\ncheck-system-context-census --self-test: ${failures} case(s) FAILED\n`
  );
  return failures === 0 ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.exit(argv.includes('--self-test') ? selfTest() : run({ fix: argv.includes('--fix') }));
}
