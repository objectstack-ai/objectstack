#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-docs-spec-enumerations (#17388) -- the hand-written `@objectstack/spec`
 * enumerations under `content/docs/` are held equal to what the package's
 * `exports` map declares.
 *
 *   node scripts/check-docs-spec-enumerations.mjs              # scan the tree
 *   node scripts/check-docs-spec-enumerations.mjs --list       # the derived sets and where they are enumerated
 *   node scripts/check-docs-spec-enumerations.mjs --self-test  # verify the checker itself
 *
 * ## The measurement, not the theory (#16325 step 3, PR #17372)
 *
 * Deleting the `./cloud` exports entry and adding `./marketplace` moved every
 * MECHANICAL counter of that set with it -- the anti-vacuity floor pin, the
 * alias-coverage pin, `export-origins`, `root-meta`, `llms.txt` via
 * `check:llms-txt`, `quick-reference.mdx` via `check:quick-reference-counts`,
 * around 25 in all -- because each of them went red and pointed at itself.
 *
 * Three PROSE enumerations moved only because a human swept for them: they had
 * kept advertising `cloud` and had never listed `marketplace`. Step 2 of the
 * same chain was FAILed in review by exactly this class of unlisted counter.
 * Prose is where the class hides, because nothing reads it.
 *
 * The pages are correct today. This gate is not the repair -- it is what keeps
 * the repair true, so its acceptance test is that it goes RED on a deliberately
 * stale enumeration, which is what battery 2 below reproduces.
 *
 * ## TWO SETS, NOT ONE -- the single most likely way this gate ships broken
 *
 * The exports map's bare `./<name>` entries are the SUBPATH set. The protocol
 * NAMESPACE set is smaller: `meta-spelling` is an importable subpath and is not
 * a protocol. A gate that conflates them is wrong on its first run in both
 * directions -- it would demand `meta-spelling` in the namespace lists and
 * accept a namespace list that has lost a member.
 *
 * The split is DERIVED, not typed here.
 * `packages/spec/scripts/lib/category-title.ts#CATEGORY_TITLES` declares one
 * display title per `packages/spec/src/` module directory, and it is total over
 * that directory listing in both directions
 * (`packages/spec/scripts/lib/category-title.ts#categoryTitleCoverage`, which
 * stops `gen:docs`). Everything with a schema closure is titled `... Protocol`;
 * `meta-spelling` is titled `Meta-Spelling Vocabulary` for precisely this
 * reason, recorded there and in
 * `packages/spec/scripts/lib/schema-closure.ts#CATEGORIES_WITHOUT_SCHEMA_CLOSURE`.
 * So:
 *
 *     SUBPATHS   = the bare `./<name>` keys of the exports map
 *     NAMESPACES = the SUBPATHS whose declared title ends in ` Protocol`
 *     display    = that title with ` Protocol` removed -- `AI`, `QA`, `UI`
 *
 * Deriving the display name from the same declaration is what makes the
 * abbreviations right without a second abbreviation list. A guessed title is
 * the #5853 `Qa Protocol` defect, which shipped to three surfaces at once and
 * no gate could see it, because a wrong title is a STABLE one.
 *
 * The conflation is caught by this gate on a real tree, today, with no extra
 * machinery: the namespace lists hold one fewer entry than the subpath
 * sentence, so a build of this gate that used one set for both reds on the
 * pages themselves. Battery 5 pins that property so it cannot be lost.
 *
 * ## What is compared, and where
 *
 *   1. `content/docs/deployment/troubleshooting.mdx` -- the `Available subpaths`
 *      sentence. Compared with SUBPATHS as an ORDERED list: the sentence itself
 *      claims "in its order", so the order is part of the declaration.
 *   2. `content/docs/plugins/packages.mdx` -- the parenthesised
 *      `Protocol namespaces (...)` list. Compared with NAMESPACES as a set.
 *   3. `content/docs/getting-started/glossary.mdx`, three times over: the
 *      `protocol namespaces:` sentence, the union of the layers table's
 *      `Namespaces it includes` column, and the `### <X> Protocol` sections
 *      under the `## The N Protocol Namespaces` heading. Sets, plus the table's
 *      own no-duplicate rule -- a namespace listed in two layers is a finding
 *      in its own right, because that table is a partition.
 *   4. Every numeric namespace-count CLAIM in PROSE. `content/docs/**` is swept
 *      for the strict phrasing (a number immediately before
 *      `protocol namespaces`); the three governed pages are additionally swept
 *      for the loose phrasing (`the N namespaces`), which is too weak to run
 *      over the whole corpus without meeting sentences about some other kind of
 *      namespace. Fenced code blocks are NOT prose and are skipped -- see below.
 *
 * Every one of those is INDEPENDENTLY load-bearing, and battery 4 mutates them
 * one at a time to prove it: a gate that reads five enumerations and reports
 * one verdict can lose four of them and stay green.
 *
 * ## What this gate does NOT cover -- read this before trusting it
 *
 *  - **Prose that DESCRIBES a namespace instead of listing it.** The glossary's
 *    own `Tenant` entry says the `tenant` schema left the package "with the
 *    `./cloud` subpath" -- true, deliberate, and invisible here. A sentence that
 *    mentions a namespace, explains one, or links to one is not an enumeration
 *    and is held to nothing.
 *  - **A page that starts enumerating somewhere new.** Only the anchors above
 *    are read. The count sweep is the one part that widens with the corpus, and
 *    it only ever sees a NUMBER, never a list.
 *  - **`content/docs/releases/`**, excluded from the count sweep. Release notes
 *    are a historical record written at release time, and AGENTS.md forbids
 *    editing them in a code PR -- a gate able to demand an edit there would be a
 *    trap, not a guard.
 *  - **Anything inside a fenced code block**, excluded from the count sweep for
 *    the same reason and a sharper one: the DOCUMENTATION FOR THIS GATE quotes
 *    the gate's own output, and so does any troubleshooting page showing a real
 *    terminal session. `OK spec: 16 protocol namespaces exported` pasted from a
 *    run last quarter is a transcript, not a claim about today's package, and a
 *    gate that reds on quoted output teaches people to route around it. A
 *    repo-wide gate people route around is worse than no gate. This is the count
 *    sweep ONLY: the five enumerations read specific anchored lines and keep
 *    their scope, so a fence cannot hide one of them.
 *
 *    INDENTED code blocks are deliberately NOT skipped. Measured on this corpus:
 *    387 swept pages, zero indented code blocks outside a fence -- so skipping
 *    them would buy nothing, and it cannot be done correctly by a line-based
 *    reader. Four leading spaces under a list item is list CONTINUATION, not
 *    code, and CommonMark decides between them with block context this gate does
 *    not build. The error would be the expensive direction: a real stale total
 *    silently unread.
 *
 *    An unterminated fence would hide the rest of a page from the sweep, so on
 *    the three governed pages it is a structural REFUSAL rather than a page read
 *    short. Elsewhere in the corpus it is not policed -- this gate is not a
 *    markdown linter for 387 pages, and every live count claim is on a governed
 *    page.
 *  - **Display spelling outside these enumerations.** `Data` in a heading this
 *    gate does not read is compared with nothing.
 *  - **Whether a subpath RESOLVES.** That is the alias-coverage pin's job. This
 *    gate reads text and imports nothing.
 *
 * ## The one coupling worth knowing about
 *
 * The derivation reads a declaration inside `packages/spec/`. If that constant
 * is renamed or moved, this gate REFUSES: it prints the file and the symbol it
 * expected and exits non-zero, rather than deriving an empty set and reporting
 * the cleanest green it has. Battery 8 observes that refusal.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
import { parseSourceFile } from './ts-parse.mjs';
import { isEntrypoint } from './invoked-as.mjs';

// -- The self-test's own battery roster and floor --------------------------
//
// `failures.length === 0` is not a success condition on its own: "every case
// held" and "the cases never ran" print the same line. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count. A pinned TOTAL is not the
// repair -- a battery dropping from 9 cases to 3 keeps a total "right" the
// moment a sibling grows. The counts are a FLOOR: adding cases is ordinary work
// and must not red.
//
// A floor is the battery's REAL case count, not a round number under it. A
// floor set below what the battery registers is slack the battery can lose
// cases into silently: battery 8 declared 12 while registering 16, and a whole
// `refused(...)` block could be deleted with the self-test still exiting 0 and
// still printing that its structural cases held. Cases below the floor is the
// only signal there is, so the floor has to sit against the count. Adding cases
// raises the floor in the same edit.
//
// A `refused(...)` with an `expectIn` argument registers TWO cases, which is
// where that slack came from -- count the assertions, not the calls.
const BATTERY_REFUSALS = '8. STRUCTURAL refusals. Each must be RED, none may read as clean.';

const SELF_TEST_BATTERIES = Object.freeze({
  '1. The derivation: two sets, and the split is READ, not typed.': 9,
  '2. THE POSITIVE CONTROL: a stale tree reds on every enumeration.': 8,
  '3. The corrected tree is green, and every enumeration was really read.': 6,
  '4. Each enumeration is load-bearing ON ITS OWN.': 10,
  '5. The CONFLATION pin: the two sets are not interchangeable.': 4,
  '6. Order belongs to the subpath sentence, and only to that one.': 3,
  '7. Count claims: digits, words, drift, fenced code, and the drain refusal.': 15,
  [BATTERY_REFUSALS]: 20,
  '9. The layers table carries its own no-duplicate rule.': 2,
  '10. A finding NAMES the real shape, not a nonsense entry.': 2,
});

// Deleting an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 10;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// -- The two declarations everything else is derived from ------------------

const SPEC_PKG = 'packages/spec/package.json';
const TITLES_FILE = 'packages/spec/scripts/lib/category-title.ts';
const TITLES_CONST = 'CATEGORY_TITLES';

/** A title ending in this is a protocol namespace; `Meta-Spelling Vocabulary` is not. */
const NAMESPACE_TITLE_SUFFIX = ' Protocol';

/** A bare subpath key: `./data`, `./meta-spelling`. Never `./openapi.json`. */
const SUBPATH_KEY = /^\.\/([a-z][a-z0-9-]*)$/;
/** A data-file key the package publishes for reading rather than importing. */
const DATA_KEY = /^\.\/[a-z][a-z0-9-]*\.[a-z]+$/;

// -- The pages, and the anchor each enumeration is found by ----------------

const PAGE_TROUBLESHOOTING = 'content/docs/deployment/troubleshooting.mdx';
const PAGE_PACKAGES = 'content/docs/plugins/packages.mdx';
const PAGE_GLOSSARY = 'content/docs/getting-started/glossary.mdx';

/** The pages whose prose this gate governs, in the order the verdict reports them. */
const GOVERNED_PAGES = [PAGE_TROUBLESHOOTING, PAGE_PACKAGES, PAGE_GLOSSARY];

/** Opens the ordered subpath sentence. Pinned: if it moves, the gate goes red. */
const SUBPATH_SENTENCE_PREFIX = 'Available subpaths';
/** Ends that sentence's parenthetical aside; the enumeration is everything after. */
const SUBPATH_LIST_SEPARATOR = '): ';
/** Opens the parenthesised namespace list on the packages page. */
const NAMESPACE_PAREN_PREFIX = 'Protocol namespaces (';
/** Opens the glossary's colon-delimited namespace sentence. */
const NAMESPACE_COLON_PREFIX = 'protocol namespaces:';
/** The layers table's column of namespaces. A rename or a reorder is a finding. */
const COL_NAMESPACES = 'Namespaces it includes';
/** The h2 that owns the per-namespace sections. Its number is a count claim too. */
const SECTIONS_HEADING = /^##\s+The\s+(\S+)\s+Protocol\s+Namespaces\s*$/i;
/** A per-namespace section heading inside that h2. */
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
/** Any h2 -- what ends the sections block. */
const ANY_H2 = /^##\s+/;

const TABLE_DIVIDER = /^\|[\s:|-]+\|\s*$/;
const TABLE_LINE = /^\s*\|/;

/** A backticked token inside a sentence. */
const BACKTICKED = /`([^`]*)`/g;

/** The count sweep's root, and the subtree it must never be able to demand an edit in. */
const DOCS_ROOT = 'content/docs';
const DOCS_RELEASES = 'content/docs/releases';

/**
 * A run of three or more backticks or tildes, indented by at most three spaces:
 * a fenced code block's opening or closing line. Group 1 is the run itself,
 * group 2 everything after it (the info string on an opener).
 */
const FENCE_RUN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** `15 protocol namespaces` -- specific enough to sweep the whole corpus with. */
const COUNT_CLAIM_STRICT = /\b([A-Za-z0-9-]+)\s+protocol\s+namespaces\b/gi;
/** `The 15 namespaces` -- only run over the governed pages; too weak elsewhere. */
const COUNT_CLAIM_LOOSE = /\bthe\s+([A-Za-z0-9-]+)\s+namespaces\b/gi;

/**
 * How many numeric count claims the glossary must still carry.
 *
 * The page states its total in several places. A claim set that drains to
 * nothing is a check that passes by having nothing left to read, which is the
 * phantom-check failure this gate exists to prevent, one level up.
 */
const GLOSSARY_COUNT_CLAIM_FLOOR = 3;

// -------------------------------------------------------------------------
// Number words, so an evasion by spelling is still a claim
// -------------------------------------------------------------------------

const ONES_WORDS = new Map([
  ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
  ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14],
  ['fifteen', 15], ['sixteen', 16], ['seventeen', 17], ['eighteen', 18],
  ['nineteen', 19],
]);
const TENS_WORDS = new Map([
  ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50],
]);

/**
 * A count token as a number, or `null` when the token is not a count at all.
 *
 * `null` is not a failure. `across all protocol namespaces` is a real sentence
 * on a real page and says nothing about how many there are; only a token that
 * IS a number becomes a claim this gate holds.
 *
 * @param {string} token
 * @returns {number | null}
 */
export function parseCountToken(token) {
  const raw = String(token).trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (ONES_WORDS.has(raw)) return ONES_WORDS.get(raw);
  if (TENS_WORDS.has(raw)) return TENS_WORDS.get(raw);
  const compound = raw.match(/^([a-z]+)-([a-z]+)$/);
  if (compound && TENS_WORDS.has(compound[1]) && ONES_WORDS.has(compound[2])) {
    const units = ONES_WORDS.get(compound[2]);
    if (units >= 1 && units <= 9) return TENS_WORDS.get(compound[1]) + units;
  }
  return null;
}

// -------------------------------------------------------------------------
// Derivation side -- the exports map
// -------------------------------------------------------------------------

/**
 * The bare `./<name>` subpaths the package publishes, in the map's own order.
 *
 * @param {string} text `packages/spec/package.json` as text.
 * @param {string} [fileLabel]
 * @returns {{ subpaths: string[], findings: Array<{kind: string, message: string}> }}
 *   A non-empty `findings` means the map could not be read honestly. It is
 *   never "read what we could and carry on".
 */
export function readSubpaths(text, fileLabel = SPEC_PKG) {
  const findings = [];
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (err) {
    return {
      subpaths: [],
      findings: [{ kind: 'structure', message: `${fileLabel} is not readable JSON: ${err.message}` }],
    };
  }
  const exportsMap = manifest === null ? undefined : manifest.exports;
  if (exportsMap === null || typeof exportsMap !== 'object' || Array.isArray(exportsMap)) {
    return {
      subpaths: [],
      findings: [{ kind: 'structure', message: `${fileLabel} has no \`exports\` OBJECT to derive the subpath set from.` }],
    };
  }

  const subpaths = [];
  for (const key of Object.keys(exportsMap)) {
    if (key === '.') continue;
    if (DATA_KEY.test(key)) continue;
    const match = key.match(SUBPATH_KEY);
    if (match === null) {
      findings.push({
        kind: 'structure',
        message: `${fileLabel} exports \`${key}\`, which is neither the root entry, a data file, nor a bare \`./<name>\` subpath -- this gate cannot tell which set it belongs to.`,
      });
      continue;
    }
    subpaths.push(match[1]);
  }
  if (findings.length === 0 && subpaths.length === 0) {
    findings.push({
      kind: 'structure',
      message: `${fileLabel} declares no \`./<name>\` subpaths at all -- an empty population makes every enumeration below vacuously correct.`,
    });
  }
  return { subpaths, findings };
}

// -------------------------------------------------------------------------
// Derivation side -- the declared titles, by AST
// -------------------------------------------------------------------------

/**
 * `CATEGORY_TITLES` as a `directory -> title` map, read by AST.
 *
 * By AST rather than by regex for the same reason the constant is declared
 * rather than derived: the literal carries comment lines between its entries,
 * and a line-shaped regex reads a commented-out entry as a live one.
 *
 * @param {string} text
 * @param {string} [fileLabel]
 * @returns {{ titles: Map<string, string>,
 *             findings: Array<{kind: string, message: string, line: number}> }}
 */
export function readCategoryTitles(text, fileLabel = TITLES_FILE) {
  const source = parseSourceFile(fileLabel, text, ts.ScriptKind.TS);
  const findings = [];
  const titles = new Map();
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  let literal = null;
  const findDecl = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === TITLES_CONST) {
      literal = node.initializer === undefined ? null : node.initializer;
      return;
    }
    ts.forEachChild(node, findDecl);
  };
  findDecl(source);

  if (literal === null) {
    findings.push({
      kind: 'structure',
      line: 1,
      message: `${fileLabel} declares no \`${TITLES_CONST}\` -- this gate derives the protocol/vocabulary split from it and cannot proceed. If the declaration moved, re-point TITLES_FILE / TITLES_CONST in this gate in the same change.`,
    });
    return { titles, findings };
  }
  if (!ts.isObjectLiteralExpression(literal)) {
    findings.push({
      kind: 'structure',
      line: lineOf(literal),
      message: `\`${TITLES_CONST}\` is not an object literal, so its entries cannot be read.`,
    });
    return { titles, findings };
  }

  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      findings.push({
        kind: 'structure',
        line: lineOf(prop),
        message: `\`${TITLES_CONST}\` carries an entry this gate cannot read (a spread or a shorthand), so the map it derives would be silently short.`,
      });
      continue;
    }
    const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (name === null) {
      findings.push({
        kind: 'structure',
        line: lineOf(prop),
        message: `\`${TITLES_CONST}\` carries an entry whose KEY is computed, so the directory it titles is not knowable from the source.`,
      });
      continue;
    }
    if (!ts.isStringLiteral(prop.initializer)) {
      findings.push({
        kind: 'structure',
        line: lineOf(prop),
        message: `\`${TITLES_CONST}.${name}\` is not a plain string title, so the \`${NAMESPACE_TITLE_SUFFIX.trim()}\` test cannot be applied to it.`,
      });
      continue;
    }
    if (titles.has(name)) {
      findings.push({ kind: 'structure', line: lineOf(prop), message: `\`${TITLES_CONST}\` declares \`${name}\` twice.` });
      continue;
    }
    titles.set(name, prop.initializer.text);
  }
  if (findings.length === 0 && titles.size === 0) {
    findings.push({
      kind: 'structure',
      line: lineOf(literal),
      message: `\`${TITLES_CONST}\` is empty -- every namespace list below would be vacuously correct.`,
    });
  }
  return { titles, findings };
}

/**
 * The namespace half of the split, and the display name of each member.
 *
 * @param {string[]} subpaths in the exports map's order
 * @param {Map<string, string>} titles
 * @returns {{ namespaces: Array<{dir: string, title: string, display: string}>,
 *             findings: Array<{kind: string, message: string}> }}
 */
export function deriveSets(subpaths, titles) {
  const findings = [];
  const namespaces = [];
  for (const dir of subpaths) {
    const title = titles.get(dir);
    if (title === undefined) {
      findings.push({
        kind: 'structure',
        message: `\`${dir}\` is a published subpath with no \`${TITLES_CONST}\` entry in ${TITLES_FILE}, so this gate cannot tell whether it is a protocol namespace or a vocabulary entry.`,
      });
      continue;
    }
    if (!title.endsWith(NAMESPACE_TITLE_SUFFIX)) continue;
    namespaces.push({ dir, title, display: title.slice(0, -NAMESPACE_TITLE_SUFFIX.length) });
  }
  if (findings.length === 0 && namespaces.length === 0) {
    findings.push({
      kind: 'structure',
      message: `no published subpath carries a \`...${NAMESPACE_TITLE_SUFFIX}\` title -- the namespace set is empty and every namespace list below would be vacuously correct.`,
    });
  }
  return { namespaces, findings };
}

// -------------------------------------------------------------------------
// Page side -- the enumerations
// -------------------------------------------------------------------------

/** Split a comma-and-`and` separated prose list into its items. */
export function splitProseList(text) {
  return text
    .split(',')
    .flatMap((part) => part.split(/\band\b/))
    .map((item) => item.replace(/\*\*/g, '').replace(/`/g, '').trim())
    .filter((item) => item.length > 0);
}

/** `| a | b |` -> `['a', 'b']`. */
export function splitCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * The ONE line an anchor may appear on, or a structural refusal.
 *
 * Zero and two are both refusals, and for the same reason: a gate that silently
 * picks the first of two enumerations holds one of them and lets the other rot.
 */
function soleLine(lines, predicate, what, fileLabel) {
  const hits = [];
  lines.forEach((line, index) => {
    if (predicate(line)) hits.push({ line: index + 1, text: line });
  });
  if (hits.length === 1) return { hit: hits[0], findings: [] };
  return {
    hit: null,
    findings: [{
      kind: 'structure',
      line: hits.length === 0 ? 1 : hits[1].line,
      message: hits.length === 0
        ? `${fileLabel} no longer carries ${what} -- the enumeration this gate holds equal is gone, moved or reworded, and a gate that cannot find its input must not print a clean line.`
        : `${fileLabel} carries ${what} ${hits.length} times (lines ${hits.map((h) => h.line).join(', ')}) -- this gate would hold only one of them.`,
    }],
  };
}

/** The ORDERED subpath list from the troubleshooting page. */
export function readSubpathSentence(text, fileLabel = PAGE_TROUBLESHOOTING) {
  const lines = text.split('\n');
  const { hit, findings } = soleLine(
    lines,
    (l) => l.startsWith(SUBPATH_SENTENCE_PREFIX),
    `an \`${SUBPATH_SENTENCE_PREFIX}\` sentence`,
    fileLabel,
  );
  if (hit === null) return { line: 1, items: [], findings };

  const cut = hit.text.indexOf(SUBPATH_LIST_SEPARATOR);
  if (cut < 0) {
    return {
      line: hit.line,
      items: [],
      findings: [{
        kind: 'structure',
        line: hit.line,
        message: `the \`${SUBPATH_SENTENCE_PREFIX}\` sentence has no \`${SUBPATH_LIST_SEPARATOR.trim()}\` separating its aside from its list, so the enumeration cannot be told apart from the words describing it.`,
      }],
    };
  }
  const tail = hit.text.slice(cut + SUBPATH_LIST_SEPARATOR.length);
  const items = [...tail.matchAll(BACKTICKED)].map((m) => m[1].trim()).filter((s) => s.length > 0);
  if (items.length === 0) {
    return {
      line: hit.line,
      items: [],
      findings: [{
        kind: 'structure',
        line: hit.line,
        message: `the \`${SUBPATH_SENTENCE_PREFIX}\` sentence lists nothing -- an empty enumeration compares equal to nothing and would pass.`,
      }],
    };
  }
  return { line: hit.line, items, findings: [] };
}

/** The parenthesised namespace list from the packages page. */
export function readNamespaceParenList(text, fileLabel = PAGE_PACKAGES) {
  const lines = text.split('\n');
  const { hit, findings } = soleLine(
    lines,
    (l) => l.includes(NAMESPACE_PAREN_PREFIX),
    `a \`${NAMESPACE_PAREN_PREFIX}...)\` list`,
    fileLabel,
  );
  if (hit === null) return { line: 1, items: [], findings };

  const start = hit.text.indexOf(NAMESPACE_PAREN_PREFIX) + NAMESPACE_PAREN_PREFIX.length;
  const end = hit.text.indexOf(')', start);
  if (end < 0) {
    return {
      line: hit.line,
      items: [],
      findings: [{ kind: 'structure', line: hit.line, message: `the \`${NAMESPACE_PAREN_PREFIX}\` list is never closed, so its end cannot be found.` }],
    };
  }
  const items = splitProseList(hit.text.slice(start, end));
  if (items.length === 0) {
    return {
      line: hit.line,
      items: [],
      findings: [{
        kind: 'structure',
        line: hit.line,
        message: `the \`${NAMESPACE_PAREN_PREFIX}\` list is empty -- an empty enumeration compares equal to nothing and would pass.`,
      }],
    };
  }
  return { line: hit.line, items, findings: [] };
}

/** The colon-delimited namespace sentence from the glossary. */
export function readNamespaceColonList(text, fileLabel = PAGE_GLOSSARY) {
  const lines = text.split('\n');
  const { hit, findings } = soleLine(
    lines,
    (l) => l.includes(NAMESPACE_COLON_PREFIX),
    `a \`${NAMESPACE_COLON_PREFIX}\` sentence`,
    fileLabel,
  );
  if (hit === null) return { line: 1, items: [], findings };

  const start = hit.text.indexOf(NAMESPACE_COLON_PREFIX) + NAMESPACE_COLON_PREFIX.length;
  const items = splitProseList(hit.text.slice(start).replace(/\.\s*$/, ''));
  if (items.length === 0) {
    return {
      line: hit.line,
      items: [],
      findings: [{
        kind: 'structure',
        line: hit.line,
        message: `the \`${NAMESPACE_COLON_PREFIX}\` sentence lists nothing -- an empty enumeration compares equal to nothing and would pass.`,
      }],
    };
  }
  return { line: hit.line, items, findings: [] };
}

/**
 * The union of the layers table's namespace column, plus any name listed twice.
 *
 * That table is a PARTITION: each namespace belongs to exactly one layer, so a
 * name appearing in two rows is a finding of its own rather than a set that
 * happens to compare equal.
 */
export function readLayersTable(text, fileLabel = PAGE_GLOSSARY) {
  const lines = text.split('\n');
  const findings = [];
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!TABLE_LINE.test(lines[i])) continue;
    if (!lines[i].includes(COL_NAMESPACES)) continue;
    if (i + 1 >= lines.length || !TABLE_DIVIDER.test(lines[i + 1])) continue;
    if (headerIndex >= 0) {
      findings.push({
        kind: 'structure',
        line: i + 1,
        message: `${fileLabel} carries more than one \`${COL_NAMESPACES}\` table; this gate would hold only one of them.`,
      });
      return { line: headerIndex + 1, items: [], duplicates: [], findings };
    }
    headerIndex = i;
  }
  if (headerIndex < 0) {
    findings.push({
      kind: 'structure',
      line: 1,
      message: `${fileLabel} has no table with a \`${COL_NAMESPACES}\` column -- renamed, reordered away or deleted, and a gate that cannot find its input must not print a clean line.`,
    });
    return { line: 1, items: [], duplicates: [], findings };
  }

  const column = splitCells(lines[headerIndex]).findIndex((cell) => cell === COL_NAMESPACES);
  const items = [];
  const seen = new Map();
  const duplicates = [];
  for (let i = headerIndex + 2; i < lines.length && TABLE_LINE.test(lines[i]); i += 1) {
    const cells = splitCells(lines[i]);
    if (column >= cells.length) {
      findings.push({
        kind: 'structure',
        line: i + 1,
        message: `a row of the layers table has no \`${COL_NAMESPACES}\` cell, so its namespaces are unreadable.`,
      });
      continue;
    }
    for (const name of splitProseList(cells[column])) {
      if (seen.has(name)) {
        duplicates.push({
          kind: 'duplicate',
          line: i + 1,
          message: `the layers table lists \`${name}\` in two layers (also line ${seen.get(name)}) -- the table is a partition, so one of the two rows is wrong.`,
        });
        continue;
      }
      seen.set(name, i + 1);
      items.push(name);
    }
  }
  if (findings.length === 0 && items.length === 0) {
    findings.push({
      kind: 'structure',
      line: headerIndex + 1,
      message: `the layers table has no rows -- an empty enumeration compares equal to nothing and would pass.`,
    });
  }
  return { line: headerIndex + 1, items, duplicates, findings };
}

/**
 * The `### <X> Protocol` sections under the `## The N Protocol Namespaces` h2.
 *
 * Scoped to that h2 deliberately: the page carries an unrelated
 * `### Protocol Namespace` definition further up, and a document-wide sweep of
 * `###` headings would read it as one more namespace.
 *
 * `items` are full TITLES (`Data Protocol`), compared with the declared titles.
 */
export function readProtocolSections(text, fileLabel = PAGE_GLOSSARY) {
  const lines = text.split('\n');
  const { hit, findings } = soleLine(
    lines,
    (l) => SECTIONS_HEADING.test(l),
    'a `## The N Protocol Namespaces` heading',
    fileLabel,
  );
  if (hit === null) return { line: 1, items: [], findings };

  const items = [];
  for (let i = hit.line; i < lines.length; i += 1) {
    if (ANY_H2.test(lines[i])) break;
    const match = lines[i].match(SECTION_HEADING);
    if (match) items.push(match[1].trim());
  }
  if (items.length === 0) {
    return {
      line: hit.line,
      items: [],
      findings: [{
        kind: 'structure',
        line: hit.line,
        message: `the \`${hit.text.trim()}\` section carries no \`###\` subsections -- an empty enumeration compares equal to nothing and would pass.`,
      }],
    };
  }
  return { line: hit.line, items, findings: [] };
}

/**
 * Which lines of a page sit inside a fenced code block, and whether a fence was
 * left open at the end of it.
 *
 * The fence lines themselves count as fenced: an opener's info string is not
 * prose either. CommonMark's two rules that matter here are both load-bearing
 * and both cheap -- a backtick opener's info string may not contain a backtick,
 * and a closer must be the same character, at least as long as its opener, and
 * carry nothing but whitespace after it. The second is what lets the gate's own
 * documentation quote a fenced session inside a longer fence.
 *
 * @param {string} text
 * @returns {{ fenced: boolean[], unterminated: { line: number, run: string } | null }}
 */
export function readFences(text) {
  const lines = text.split('\n');
  const fenced = new Array(lines.length).fill(false);
  let open = null;
  lines.forEach((line, index) => {
    const match = line.match(FENCE_RUN);
    if (open === null) {
      if (match === null) return;
      if (match[1][0] === '`' && match[2].includes('`')) return;
      open = { line: index + 1, run: match[1] };
      fenced[index] = true;
      return;
    }
    fenced[index] = true;
    if (match === null) return;
    if (match[1][0] !== open.run[0]) return;
    if (match[1].length < open.run.length) return;
    if (match[2].trim() !== '') return;
    open = null;
  });
  return { fenced, unterminated: open };
}

/**
 * Every numeric namespace-count claim in the PROSE of one page.
 *
 * Fenced code blocks are skipped, and that exclusion belongs to the count sweep
 * alone: quoted tool output and pasted terminal sessions are transcripts, not
 * claims about today's package. The five enumerations read specific anchored
 * lines and are unaffected.
 *
 * @param {string} text
 * @param {boolean} loose also read the weak `the N namespaces` phrasing
 * @returns {Array<{line: number, token: string, value: number}>}
 */
export function readCountClaims(text, loose) {
  const claims = [];
  const patterns = loose === true ? [COUNT_CLAIM_STRICT, COUNT_CLAIM_LOOSE] : [COUNT_CLAIM_STRICT];
  const seen = new Set();
  const { fenced } = readFences(text);
  text.split('\n').forEach((line, index) => {
    if (fenced[index]) return;
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        const value = parseCountToken(match[1]);
        if (value === null) continue;
        const key = `${index}:${match.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        claims.push({ line: index + 1, token: match[1], value });
      }
    }
  });
  return claims;
}

// -------------------------------------------------------------------------
// Comparison
// -------------------------------------------------------------------------

/**
 * One enumeration against one derived set.
 *
 * @param {string[]} expected
 * @param {string[]} actual
 * @param {{ ordered?: boolean, line: number, what: string }} opts
 * @returns {Array<{kind: string, line: number, message: string}>}
 */
export function compareEnumeration(expected, actual, opts) {
  const findings = [];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const reported = new Set();
  for (const item of actual) {
    if (actual.indexOf(item) === actual.lastIndexOf(item)) continue;
    if (reported.has(item)) continue;
    reported.add(item);
    findings.push({ kind: 'duplicate', line: opts.line, message: `${opts.what} lists \`${item}\` twice.` });
  }
  for (const item of expected) {
    if (actualSet.has(item)) continue;
    findings.push({
      kind: 'missing',
      line: opts.line,
      message: `${opts.what} does not list \`${item}\`, which the exports map publishes.`,
    });
  }
  for (const item of actualSet) {
    if (expectedSet.has(item)) continue;
    // A subpath is `[a-z][a-z0-9-]*` and a display name comes from a declared
    // title; neither can contain a sentence break. So an item carrying one is
    // never a misspelt entry -- it is the last real entry with the following
    // sentence stuck to it, and saying "the page lists <that>" sends the reader
    // hunting for an entry the page does not have.
    findings.push(item.includes('. ')
      ? {
        kind: 'unknown',
        line: opts.line,
        message: `${opts.what} runs on into the sentence after it: the last item reads \`${item}\`. The list and the sentence share a line, so the enumeration cannot be told from the prose -- end the list, then start the sentence.`,
      }
      : {
        kind: 'unknown',
        line: opts.line,
        message: `${opts.what} lists \`${item}\`, which the exports map does not publish (retired, misspelt, or never there).`,
      });
  }
  if (opts.ordered === true && findings.length === 0 && expected.join(' ') !== actual.join(' ')) {
    findings.push({
      kind: 'order',
      line: opts.line,
      message: `${opts.what} holds the right names in the wrong ORDER, and the sentence claims the exports map's order. Expected ${expected.join(', ')}; found ${actual.join(', ')}.`,
    });
  }
  return findings;
}

/** Count claims against the derived namespace total. */
export function compareCountClaims(claims, expected, what) {
  return claims
    .filter((claim) => claim.value !== expected)
    .map((claim) => ({
      kind: 'count-drift',
      line: claim.line,
      message: `${what} claims ${claim.token} protocol namespace(s); the exports map publishes ${expected}.`,
    }));
}

// -------------------------------------------------------------------------
// The whole comparison over text -- shared by main() and the self-test
// -------------------------------------------------------------------------

/**
 * @param {{ pkg: string, titles: string, troubleshooting: string,
 *           packages: string, glossary: string,
 *           sweep?: Array<{file: string, text: string}> }} tree
 */
export function run(tree) {
  const structural = [];
  const sub = readSubpaths(tree.pkg);
  structural.push(...sub.findings.map((f) => ({ ...f, file: SPEC_PKG, line: 1 })));
  const cat = readCategoryTitles(tree.titles);
  structural.push(...cat.findings.map((f) => ({ ...f, file: TITLES_FILE })));

  const derived = deriveSets(sub.subpaths, cat.titles);
  structural.push(...derived.findings.map((f) => ({ ...f, file: TITLES_FILE, line: 1 })));

  const subpaths = sub.subpaths;
  const displays = derived.namespaces.map((n) => n.display);
  const titles = derived.namespaces.map((n) => n.title);

  if (structural.length > 0) {
    return { structural, findings: [], subpaths, namespaces: derived.namespaces, claims: [], read: null };
  }

  const sentence = readSubpathSentence(tree.troubleshooting);
  const paren = readNamespaceParenList(tree.packages);
  const colon = readNamespaceColonList(tree.glossary);
  const table = readLayersTable(tree.glossary);
  const sections = readProtocolSections(tree.glossary);
  const read = { sentence, paren, colon, table, sections };

  structural.push(
    ...sentence.findings.map((f) => ({ ...f, file: PAGE_TROUBLESHOOTING })),
    ...paren.findings.map((f) => ({ ...f, file: PAGE_PACKAGES })),
    ...colon.findings.map((f) => ({ ...f, file: PAGE_GLOSSARY })),
    ...table.findings.map((f) => ({ ...f, file: PAGE_GLOSSARY })),
    ...sections.findings.map((f) => ({ ...f, file: PAGE_GLOSSARY })),
  );

  // The count sweep skips fenced code, so a fence left open swallows every
  // claim below it. On the governed pages that is refused rather than read
  // short: a page the sweep can only read half of must not be reported clean.
  const openFences = new Map([
    [PAGE_TROUBLESHOOTING, readFences(tree.troubleshooting).unterminated],
    [PAGE_PACKAGES, readFences(tree.packages).unterminated],
    [PAGE_GLOSSARY, readFences(tree.glossary).unterminated],
  ]);
  for (const [file, open] of openFences) {
    if (open === null) continue;
    structural.push({
      kind: 'structure',
      file,
      line: open.line,
      message: `the \`${open.run}\` code fence opened here is never closed, so the count sweep cannot read a single line below it -- close the fence, or this page reports the cleanest green it has.`,
    });
  }

  const glossaryClaims = readCountClaims(tree.glossary, true);
  // Reported only when the claims are genuinely absent. With a fence left open
  // above them the shortfall is a SYMPTOM, and the refusal above already names
  // the cause; two findings for one defect send the reader to the wrong line.
  if (openFences.get(PAGE_GLOSSARY) === null && glossaryClaims.length < GLOSSARY_COUNT_CLAIM_FLOOR) {
    structural.push({
      kind: 'structure',
      file: PAGE_GLOSSARY,
      line: 1,
      message: `only ${glossaryClaims.length} numeric namespace-count claim(s) found, below the floor of ${GLOSSARY_COUNT_CLAIM_FLOOR} -- the page states its total in several places, and a claim set that drains to nothing is a check that passes by having nothing left to read.`,
    });
  }

  if (structural.length > 0) {
    return { structural, findings: [], subpaths, namespaces: derived.namespaces, claims: [], read };
  }

  const findings = [];
  const at = (file, list) => findings.push(...list.map((f) => ({ ...f, file })));

  at(PAGE_TROUBLESHOOTING, compareEnumeration(subpaths, sentence.items, {
    ordered: true, line: sentence.line, what: `the \`${SUBPATH_SENTENCE_PREFIX}\` sentence`,
  }));
  at(PAGE_PACKAGES, compareEnumeration(displays, paren.items, {
    line: paren.line, what: `the \`${NAMESPACE_PAREN_PREFIX}...)\` list`,
  }));
  at(PAGE_GLOSSARY, compareEnumeration(displays, colon.items, {
    line: colon.line, what: `the \`${NAMESPACE_COLON_PREFIX}\` sentence`,
  }));
  at(PAGE_GLOSSARY, table.duplicates);
  at(PAGE_GLOSSARY, compareEnumeration(displays, table.items, {
    line: table.line, what: `the layers table's \`${COL_NAMESPACES}\` column`,
  }));
  at(PAGE_GLOSSARY, compareEnumeration(titles, sections.items, {
    line: sections.line, what: 'the `### <X> Protocol` sections',
  }));
  at(PAGE_GLOSSARY, compareCountClaims(glossaryClaims, displays.length, 'the glossary'));

  const claims = glossaryClaims.map((c) => ({ ...c, file: PAGE_GLOSSARY }));
  for (const page of tree.sweep === undefined ? [] : tree.sweep) {
    const pageClaims = readCountClaims(page.text, GOVERNED_PAGES.includes(page.file));
    claims.push(...pageClaims.map((c) => ({ ...c, file: page.file })));
    at(page.file, compareCountClaims(pageClaims, displays.length, page.file));
  }

  return { structural: [], findings, subpaths, namespaces: derived.namespaces, claims, read };
}

/**
 * Every `.mdx` under `content/docs/` the count sweep reads.
 *
 * The glossary is excluded because `run()` reads it directly (with the loose
 * phrasing enabled); the release notes are excluded because they are a
 * historical record this gate must never be able to demand an edit in.
 */
export function sweepPages(root = ROOT) {
  const pages = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, rel))) {
      const child = `${rel}/${entry}`;
      if (child === DOCS_RELEASES) continue;
      if (statSync(join(root, child)).isDirectory()) {
        walk(child);
        continue;
      }
      if (!entry.endsWith('.mdx')) continue;
      if (child === PAGE_GLOSSARY) continue;
      pages.push({ file: child, text: readFileSync(join(root, child), 'utf8') });
    }
  };
  walk(DOCS_ROOT);
  return pages;
}

// -------------------------------------------------------------------------
// Fixtures -- a miniature of the real tree, with its own two sets
// -------------------------------------------------------------------------

// Four namespaces and one vocabulary subpath, so the two sets DIFFER by exactly
// the same one member they differ by on the real tree. A fixture whose sets
// coincide cannot tell a conflating gate from a correct one.
const FIXTURE_PKG = JSON.stringify({
  name: '@objectstack/spec',
  exports: {
    '.': {},
    './data': {},
    './ui': {},
    './ai': {},
    './marketplace': {},
    './meta-spelling': {},
    './openapi.json': {},
    './package.json': {},
  },
}, null, 2);

// `cloud` is titled but NOT exported, which pins the direction of the
// intersection: the population is the exports map, and a title outliving its
// subpath must not put the name back into either set.
const FIXTURE_TITLES = [
  "export const CATEGORY_TITLES: Readonly<Record<string, string>> = {",
  "  cloud: 'Cloud Protocol',",
  "  data: 'Data Protocol',",
  "  // fictitious: 'Fictitious Protocol',",
  "  marketplace: 'Marketplace Protocol',",
  "  'meta-spelling': 'Meta-Spelling Vocabulary',",
  "  ai: 'AI Protocol',",
  "  ui: 'UI Protocol',",
  "};",
  "",
].join('\n');

const FIXTURE_TROUBLESHOOTING = [
  '### Bundle size is too large',
  '',
  "Available subpaths (the `./*` entries of the package's `exports` map, in its order): `data`, `ui`, `ai`, `marketplace`, `meta-spelling`.",
  '',
].join('\n');

const FIXTURE_PACKAGES = [
  '### @objectstack/spec',
  '',
  '- **Exports**: Builder functions from the root entry. Protocol namespaces (Data, UI, AI, Marketplace) are not re-exported from the top-level entry for tree-shaking reasons.',
  '',
].join('\n');

const FIXTURE_GLOSSARY = [
  '## Core Concepts',
  '',
  'It is organized into **4 protocol namespaces** grouped into three architectural layers.',
  '',
  '### Protocol Namespace',
  'A logical grouping of related schemas. ObjectStack has 4 protocol namespaces: Data, UI, AI, and Marketplace.',
  '',
  '## The Three Architectural Layers',
  '',
  'The 4 namespaces collapse into three top-level layers:',
  '',
  '| Layer | Also called | Namespaces it includes | Purpose |',
  '| :--- | :--- | :--- | :--- |',
  '| **ObjectQL** | Data Layer | Data | Objects and fields |',
  '| **Kernel** | Control Layer | AI, Marketplace | Runtime and packages |',
  '| **ObjectUI** | View Layer | UI | Apps and views |',
  '',
  '## The 4 Protocol Namespaces',
  '',
  '### Data Protocol',
  'Defines the core business data model.',
  '',
  '### UI Protocol',
  'Server-Driven UI specification.',
  '',
  '### AI Protocol',
  'Quality assurance contracts.',
  '',
  '### Marketplace Protocol',
  'The package and marketplace format.',
  '',
  '## Other Terms',
  '',
  '### Tenant',
  'Its `tenant` schema left `@objectstack/spec` with the `./cloud` subpath, so it is not one of the protocol namespaces above.',
  '',
].join('\n');

/** The fixture tree, with any page swapped out. */
function tree(overrides = {}) {
  return {
    pkg: FIXTURE_PKG,
    titles: FIXTURE_TITLES,
    troubleshooting: FIXTURE_TROUBLESHOOTING,
    packages: FIXTURE_PACKAGES,
    glossary: FIXTURE_GLOSSARY,
    ...overrides,
  };
}

/** The #17372 defect, reproduced: the map moved on and the prose did not. */
const staleOf = (text) => text.replace(/marketplace/g, 'cloud').replace(/Marketplace/g, 'Cloud');

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 -- a self-test that never finished, reported as one that
// passed. The self-test's own exit code stays load-bearing, so the handshake is
// a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery === null ? UNATTRIBUTED_BATTERY : openBattery;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  const failures = [];
  const check = (name, ok, detail = '') => {
    registerCase();
    if (!ok) failures.push(`${name}${detail ? ` -- ${detail}` : ''}`);
  };
  const kindsOn = (result, file) => result.findings.filter((f) => f.file === file).map((f) => f.kind).sort();

  // ---- 1. The derivation.
  battery('1. The derivation: two sets, and the split is READ, not typed.');
  const sub = readSubpaths(FIXTURE_PKG);
  const cat = readCategoryTitles(FIXTURE_TITLES, 'fixture-category-title.ts');
  const derived = deriveSets(sub.subpaths, cat.titles);
  check('derivation/clean', sub.findings.length === 0 && cat.findings.length === 0 && derived.findings.length === 0,
    JSON.stringify([sub.findings, cat.findings, derived.findings]));
  // Spelled as ONE joined literal rather than an array of bare names, and that
  // is not style. The dispatch-gates tool re-anchors a bare single-segment
  // literal in a gate's source against the gate's own directory when it
  // resolves to a tracked one, so a lone directory-shaped name in a code span
  // here hands this gate a phantom watch hint on a directory it never reads,
  // named on every card that touches it. Measured on this tree: it happens, and
  // it is why the fixture's subpath names above are picked against the tracked
  // listing of this gate's own directory rather than after the real ones.
  check('subpaths drop the root entry and the two data files',
    sub.subpaths.join(' ') === 'data ui ai marketplace meta-spelling',
    JSON.stringify(sub.subpaths));
  check('subpaths keep the exports map ORDER', sub.subpaths[0] === 'data' && sub.subpaths[3] === 'marketplace');
  check('the vocabulary subpath IS a subpath', sub.subpaths.includes('meta-spelling'));
  const dirs = derived.namespaces.map((n) => n.dir);
  check('the vocabulary subpath is NOT a namespace', !dirs.includes('meta-spelling'), JSON.stringify(dirs));
  check('a title whose subpath is unpublished stays out of both sets',
    !dirs.includes('cloud') && !sub.subpaths.includes('cloud'), JSON.stringify(dirs));
  check('THE TWO COUNTS DIFFER', sub.subpaths.length === 5 && derived.namespaces.length === 4,
    `${sub.subpaths.length} vs ${derived.namespaces.length}`);
  check('display names come from the declared titles, abbreviations intact',
    JSON.stringify(derived.namespaces.map((n) => n.display)) === JSON.stringify(['Data', 'UI', 'AI', 'Marketplace']),
    JSON.stringify(derived.namespaces.map((n) => n.display)));
  check('the AST does not read the commented-out entry as live', !cat.titles.has('fictitious'),
    JSON.stringify([...cat.titles.keys()]));

  // ---- 2. THE POSITIVE CONTROL.
  battery('2. THE POSITIVE CONTROL: a stale tree reds on every enumeration.');
  const stale = run(tree({
    troubleshooting: staleOf(FIXTURE_TROUBLESHOOTING),
    packages: staleOf(FIXTURE_PACKAGES),
    glossary: staleOf(FIXTURE_GLOSSARY),
  }));
  check('stale/structure-clean', stale.structural.length === 0, JSON.stringify(stale.structural));
  check('stale/reds', stale.findings.length > 0, `got ${stale.findings.length}`);
  const staleFiles = [...new Set(stale.findings.map((f) => f.file))].sort();
  check('stale/names all three pages', JSON.stringify(staleFiles) === JSON.stringify([...GOVERNED_PAGES].sort()),
    JSON.stringify(staleFiles));
  check('stale/names the subpath that went missing',
    stale.findings.some((f) => f.kind === 'missing' && f.message.includes('`marketplace`')));
  check('stale/names the subpath that should be gone',
    stale.findings.some((f) => f.kind === 'unknown' && f.message.includes('`cloud`')));
  check('stale/names the namespace that went missing',
    stale.findings.some((f) => f.kind === 'missing' && f.message.includes('`Marketplace`')));
  check('stale/names the namespace that should be gone',
    stale.findings.some((f) => f.kind === 'unknown' && f.message.includes('`Cloud`')));
  // Five enumerations, each producing one `missing` and one `unknown`.
  check('stale/exactly ten divergences, two per enumeration', stale.findings.length === 10,
    JSON.stringify(stale.findings.map((f) => `${f.file}:${f.kind}`)));

  // ---- 3. The corrected tree.
  battery('3. The corrected tree is green, and every enumeration was really read.');
  const ok = run(tree());
  check('ok/structure-clean', ok.structural.length === 0, JSON.stringify(ok.structural));
  check('ok/no divergences', ok.findings.length === 0, JSON.stringify(ok.findings));
  check('ok/the subpath sentence really held 5 items', ok.read.sentence.items.length === 5,
    JSON.stringify(ok.read.sentence.items));
  check('ok/the paren list really held 4', ok.read.paren.items.length === 4, JSON.stringify(ok.read.paren.items));
  check('ok/the layers table really held 4', ok.read.table.items.length === 4, JSON.stringify(ok.read.table.items));
  check('ok/the sections really held 4', ok.read.sections.items.length === 4, JSON.stringify(ok.read.sections.items));

  // ---- 4. Each enumeration alone.
  battery('4. Each enumeration is load-bearing ON ITS OWN.');
  const onlyTrouble = run(tree({ troubleshooting: staleOf(FIXTURE_TROUBLESHOOTING) }));
  check('alone/troubleshooting reds', onlyTrouble.findings.length === 2, JSON.stringify(onlyTrouble.findings));
  check('alone/troubleshooting reds ONLY there',
    onlyTrouble.findings.every((f) => f.file === PAGE_TROUBLESHOOTING),
    JSON.stringify(onlyTrouble.findings.map((f) => f.file)));
  const onlyPackages = run(tree({ packages: staleOf(FIXTURE_PACKAGES) }));
  check('alone/packages reds', onlyPackages.findings.length === 2, JSON.stringify(onlyPackages.findings));
  check('alone/packages reds ONLY there', onlyPackages.findings.every((f) => f.file === PAGE_PACKAGES));
  // Inside the glossary the three enumerations are separated one at a time,
  // because a single stale word there moves all three at once.
  const colonOnly = FIXTURE_GLOSSARY.replace(
    'ObjectStack has 4 protocol namespaces: Data, UI, AI, and Marketplace.',
    'ObjectStack has 4 protocol namespaces: Data, UI, AI, and Cloud.',
  );
  const g1 = run(tree({ glossary: colonOnly }));
  check('alone/the colon sentence reds by itself', g1.findings.length === 2, JSON.stringify(g1.findings));
  check('alone/and names the colon sentence', g1.findings.every((f) => f.message.includes(NAMESPACE_COLON_PREFIX)),
    JSON.stringify(g1.findings.map((f) => f.message)));
  const tableOnly = FIXTURE_GLOSSARY.replace('| AI, Marketplace |', '| AI, Cloud |');
  const g2 = run(tree({ glossary: tableOnly }));
  check('alone/the layers table reds by itself', g2.findings.length === 2, JSON.stringify(g2.findings));
  check('alone/and names the table column', g2.findings.every((f) => f.message.includes(COL_NAMESPACES)),
    JSON.stringify(g2.findings.map((f) => f.message)));
  const sectionsOnly = FIXTURE_GLOSSARY.replace('### Marketplace Protocol', '### Cloud Protocol');
  const g3 = run(tree({ glossary: sectionsOnly }));
  check('alone/the sections red by themselves', g3.findings.length === 2, JSON.stringify(g3.findings));
  check('alone/and name the sections', g3.findings.every((f) => f.message.includes('### <X> Protocol')),
    JSON.stringify(g3.findings.map((f) => f.message)));

  // ---- 5. The conflation pin.
  battery('5. The CONFLATION pin: the two sets are not interchangeable.');
  const displays = derived.namespaces.map((n) => n.display);
  const titlesList = derived.namespaces.map((n) => n.title);
  const conflated = compareEnumeration(sub.subpaths, ok.read.paren.items, { line: 1, what: 'x' });
  check('a namespace list judged against the SUBPATH set reds', conflated.length > 0, JSON.stringify(conflated));
  check('and names the vocabulary subpath as the difference',
    conflated.some((f) => f.kind === 'missing' && f.message.includes('`meta-spelling`')), JSON.stringify(conflated));
  const inverted = compareEnumeration(displays, ok.read.sentence.items, { line: 1, what: 'x' });
  check('the subpath sentence judged against the NAMESPACE set reds', inverted.length > 0, JSON.stringify(inverted));
  check('the section titles are a third population, not the display names',
    JSON.stringify(titlesList) !== JSON.stringify(displays), JSON.stringify(titlesList));

  // ---- 6. Order.
  battery('6. Order belongs to the subpath sentence, and only to that one.');
  const reordered = FIXTURE_TROUBLESHOOTING.replace('`data`, `ui`', '`ui`, `data`');
  const orderRun = run(tree({ troubleshooting: reordered }));
  check('order/exactly one finding', orderRun.findings.length === 1, JSON.stringify(orderRun.findings));
  check('order/its kind is `order`', orderRun.findings[0]?.kind === 'order', JSON.stringify(orderRun.findings));
  const shuffledParen = FIXTURE_PACKAGES.replace('(Data, UI, AI, Marketplace)', '(Marketplace, AI, UI, Data)');
  check('order/a reordered namespace list is NOT a finding -- it claims no order',
    run(tree({ packages: shuffledParen })).findings.length === 0);

  // ---- 7. Count claims.
  battery('7. Count claims: digits, words, drift, fenced code, and the drain refusal.');
  const drifted = FIXTURE_GLOSSARY.replace('**4 protocol namespaces**', '**5 protocol namespaces**');
  const driftRun = run(tree({ glossary: drifted }));
  check('count/a stale digit reds', driftRun.findings.some((f) => f.kind === 'count-drift'),
    JSON.stringify(driftRun.findings));
  check('count/and only that', driftRun.findings.length === 1, JSON.stringify(driftRun.findings));
  const spelled = FIXTURE_GLOSSARY.replace('**4 protocol namespaces**', '**four protocol namespaces**');
  check('count/a correct NUMBER WORD is green', run(tree({ glossary: spelled })).findings.length === 0);
  const spelledWrong = FIXTURE_GLOSSARY.replace('**4 protocol namespaces**', '**fifteen protocol namespaces**');
  check('count/a stale number WORD reds too',
    run(tree({ glossary: spelledWrong })).findings.some((f) => f.kind === 'count-drift'));
  check('count/`all protocol namespaces` is not a claim', parseCountToken('all') === null);
  check('count/compounds parse', parseCountToken('twenty-one') === 21, String(parseCountToken('twenty-one')));
  check('count/the heading number is a claim', readCountClaims(FIXTURE_GLOSSARY, true).some((c) => c.line === 18),
    JSON.stringify(readCountClaims(FIXTURE_GLOSSARY, true)));
  check('count/the loose phrasing is read on a governed page',
    readCountClaims(FIXTURE_GLOSSARY, true).length > readCountClaims(FIXTURE_GLOSSARY, false).length,
    `${readCountClaims(FIXTURE_GLOSSARY, true).length} vs ${readCountClaims(FIXTURE_GLOSSARY, false).length}`);

  // A wrong count QUOTED from a run is a transcript, not a claim about today's
  // package. Every case below pairs with the bare-prose leg two lines down: the
  // point is that the fence moved the verdict, not that the line is harmless.
  const QUOTED_WRONG = 'OK spec: 16 protocol namespaces exported';
  const quoting = (...block) => [FIXTURE_GLOSSARY, '## Verifying', '', 'A green run prints:', '', ...block, ''].join('\n');
  const fencedRun = (...block) => run(tree({ glossary: quoting(...block) }));
  check('count/a wrong count QUOTED inside a fenced block is not a claim',
    fencedRun('```text', QUOTED_WRONG, '```').findings.length === 0,
    JSON.stringify(fencedRun('```text', QUOTED_WRONG, '```').findings));
  check('count/THE PAIRED LEG: the same line as bare prose still reds',
    fencedRun(QUOTED_WRONG).findings.some((f) => f.kind === 'count-drift'),
    JSON.stringify(fencedRun(QUOTED_WRONG).findings));
  check('count/a tilde fence hides a claim too',
    fencedRun('~~~text', QUOTED_WRONG, '~~~').findings.length === 0,
    JSON.stringify(fencedRun('~~~text', QUOTED_WRONG, '~~~').findings));
  // This gate's own documentation quotes a fenced session inside a longer
  // fence. A closer shorter than its opener must not end the block.
  check('count/a longer fence is not closed by the shorter session inside it',
    fencedRun('````markdown', '```text', QUOTED_WRONG, '```', '````').findings.length === 0,
    JSON.stringify(fencedRun('````markdown', '```text', QUOTED_WRONG, '```', '````').findings));
  check('count/a run carrying an info string does not CLOSE a fence',
    fencedRun('```text', 'first session', '```js', QUOTED_WRONG, '```').findings.length === 0,
    JSON.stringify(fencedRun('```text', 'first session', '```js', QUOTED_WRONG, '```').findings));
  check('count/the opener line is not prose either -- its info string is skipped',
    fencedRun('```text 16 protocol namespaces follow', 'a session', '```').findings.length === 0,
    JSON.stringify(fencedRun('```text 16 protocol namespaces follow', 'a session', '```').findings));
  // The exclusion has to reach the corpus sweep, not just the glossary that
  // `run()` reads directly -- the sweep is where the 350 fenced pages are.
  const swept = (text) => run(tree({ sweep: [{ file: 'content/docs/plugins/authoring.mdx', text }] }));
  check('count/the SWEEP skips fenced code too, and still reds on the bare line',
    swept(['# Authoring', '', '```text', QUOTED_WRONG, '```', ''].join('\n')).findings.length === 0
    && swept(['# Authoring', '', QUOTED_WRONG, ''].join('\n')).findings.some((f) => f.kind === 'count-drift'),
    JSON.stringify([swept(['```text', QUOTED_WRONG, '```'].join('\n')).findings, swept(QUOTED_WRONG).findings]));

  // ---- 8. Structural refusals.
  battery(BATTERY_REFUSALS);
  const refused = (label, overrides, expectIn) => {
    const result = run(tree(overrides));
    check(`refuse/${label}`, result.structural.length > 0 && result.findings.length === 0,
      JSON.stringify({ structural: result.structural.length, findings: result.findings.length }));
    if (expectIn !== undefined) {
      check(`refuse/${label} names its input`, result.structural.some((f) => f.message.includes(expectIn)),
        JSON.stringify(result.structural.map((f) => f.message)));
    }
  };
  refused('the titles constant was renamed', { titles: FIXTURE_TITLES.replace(TITLES_CONST, 'CATEGORY_NAMES') }, TITLES_CONST);
  refused('a published subpath has no title', {
    pkg: FIXTURE_PKG.replace('"./data": {}', '"./unlisted": {},\n    "./data": {}'),
  }, '`unlisted`');
  refused('the exports map is gone', { pkg: JSON.stringify({ name: 'x' }) });
  refused('the exports map is empty', { pkg: JSON.stringify({ exports: { '.': {} } }) });
  refused('the subpath sentence is gone', { troubleshooting: '### Bundle size is too large\n' });
  refused('the subpath sentence is duplicated', {
    troubleshooting: `${FIXTURE_TROUBLESHOOTING}\n${FIXTURE_TROUBLESHOOTING}`,
  });
  refused('the subpath sentence lists nothing', {
    troubleshooting: FIXTURE_TROUBLESHOOTING.replace(/`data`.*meta-spelling`\./, 'none.'),
  });
  refused('the paren list is gone', { packages: '### @objectstack/spec\n' });
  refused('the colon sentence is gone', {
    glossary: FIXTURE_GLOSSARY.replace('protocol namespaces: Data, UI, AI, and Marketplace.', 'several namespaces.'),
  });
  refused('the layers column was renamed', {
    glossary: FIXTURE_GLOSSARY.replace(COL_NAMESPACES, 'Namespaces'),
  }, COL_NAMESPACES);
  refused('the sections heading is gone', {
    glossary: FIXTURE_GLOSSARY.replace('## The 4 Protocol Namespaces', '## The Namespaces'),
  });
  refused('the count claims drained away', {
    glossary: FIXTURE_GLOSSARY
      .replace('**4 protocol namespaces**', '**several protocol namespaces**')
      .replace('has 4 protocol namespaces:', 'has these protocol namespaces:')
      .replace('The 4 namespaces collapse', 'The namespaces collapse'),
  }, `floor of ${GLOSSARY_COUNT_CLAIM_FLOOR}`);
  // Skipping fenced code buys a way to hide claims: open a fence and never
  // close it. On a governed page that is refused, on BOTH the page that holds
  // the claims and one that does not -- otherwise the guard reads as
  // glossary-only and the next fence lands on a page nothing refuses.
  const neverClosed = (page) => [page, '```text', 'a session that never ends', ''].join('\n');
  refused('the glossary opens a code fence it never closes',
    { glossary: neverClosed(FIXTURE_GLOSSARY) }, 'never closed');
  refused('the troubleshooting page opens a code fence it never closes',
    { troubleshooting: neverClosed(FIXTURE_TROUBLESHOOTING) }, 'never closed');

  // ---- 9. The partition rule.
  battery('9. The layers table carries its own no-duplicate rule.');
  const doubled = run(tree({ glossary: FIXTURE_GLOSSARY.replace('| **ObjectUI** | View Layer | UI |', '| **ObjectUI** | View Layer | UI, AI |') }));
  check('partition/a namespace in two layers reds',
    doubled.findings.some((f) => f.kind === 'duplicate'), JSON.stringify(doubled.findings));
  check('partition/and it is reported against the glossary',
    JSON.stringify(kindsOn(doubled, PAGE_GLOSSARY)).includes('duplicate'), JSON.stringify(doubled.findings));

  // ---- 10. What a finding SAYS.
  battery('10. A finding NAMES the real shape, not a nonsense entry.');
  const runOn = run(tree({
    glossary: FIXTURE_GLOSSARY.replace(
      'protocol namespaces: Data, UI, AI, and Marketplace.',
      'protocol namespaces: Data, UI, AI, and Marketplace. Each is importable from its own subpath.',
    ),
  }));
  check('message/a run-on list item is reported as a run-on, not as an entry the page lists',
    runOn.findings.some((f) => f.kind === 'unknown' && f.message.includes('runs on into the sentence after it')),
    JSON.stringify(runOn.findings.map((f) => f.message)));
  check('message/and the name the sentence swallowed is still reported missing',
    runOn.findings.some((f) => f.kind === 'missing' && f.message.includes('`Marketplace`')),
    JSON.stringify(runOn.findings.map((f) => f.message)));

  // -- The floor: every declared battery RAN, and ran its cases -------------
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
      `${SELF_TEST_BATTERY_FLOOR} -- a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    failures.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
      'SELF_TEST_BATTERIES -- an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} -- cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    failures.push(
      'A battery at or below its floor means cases STOPPED RUNNING -- the battery is the bug, not the ' +
      'number. Find what stopped registering (an early return, a deleted block, a guard that now skips).',
    );
  }

  if (failures.length > 0) {
    console.error('\nx check-docs-spec-enumerations self-test failed:\n');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    process.exit(1);
  }

  const cases = [...batterySeen.values()].reduce((a, b) => a + b, 0);
  // Read from the run rather than typed here. A second hardcoded number is a
  // second thing to keep true, and this one was already false: the sentence
  // claimed 12 structural cases while the battery registered 16.
  const refusalCases = batterySeen.get(BATTERY_REFUSALS) ?? 0;
  console.log(
    `OK check-docs-spec-enumerations self-test: ${cases} cases over ${declaredBatteries.length} batteries. ` +
    'The positive control reproduces the #17372 defect as 10 divergences across all three pages; each of the ' +
    'five enumerations reds on its own; the subpath set (5) and the namespace set (4) are pinned different and ' +
    'non-interchangeable; order is held on the sentence that claims it and nowhere else; count claims read ' +
    'digits and number words in prose and skip fenced code, which is refused when left open; ' +
    `and ${refusalCases} cases hold the structural refusals, each malformed shape refused rather than read as clean.`,
  );
  selfTestReachedVerdict = true;
}

// -------------------------------------------------------------------------
// main
// -------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\nx check-docs-spec-enumerations self-test: selfTest() returned without reaching its verdict,\n' +
        'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
        'finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }

  const result = run({
    pkg: readFileSync(join(ROOT, SPEC_PKG), 'utf8'),
    titles: readFileSync(join(ROOT, TITLES_FILE), 'utf8'),
    troubleshooting: readFileSync(join(ROOT, PAGE_TROUBLESHOOTING), 'utf8'),
    packages: readFileSync(join(ROOT, PAGE_PACKAGES), 'utf8'),
    glossary: readFileSync(join(ROOT, PAGE_GLOSSARY), 'utf8'),
    sweep: sweepPages(),
  });

  if (result.structural.length > 0) {
    console.error('\nx the spec enumerations could not be READ -- refusing to report a verdict:\n');
    for (const f of result.structural) console.error(`  ${f.file}:${f.line}  [${f.kind}] ${f.message}`);
    console.error(
      '\nA gate that cannot read its input must not print a clean line: that is exactly the\n' +
      'failure this gate exists to prevent, one level up. Re-point the gate, or restore the\n' +
      'shape it reads.\n',
    );
    process.exit(1);
  }

  const subpaths = result.subpaths;
  const namespaces = result.namespaces;

  if (process.argv.includes('--list')) {
    console.log(`${SPEC_PKG} -- ${subpaths.length} subpath(s): ${subpaths.join(', ')}\n`);
    console.log(`${TITLES_FILE} -- ${namespaces.length} protocol namespace(s):`);
    for (const n of namespaces) console.log(`  ${n.dir.padEnd(16)} ${n.title}`);
    const vocabulary = subpaths.filter((s) => !namespaces.some((n) => n.dir === s));
    console.log(`\n  subpath(s) that are NOT namespaces: ${vocabulary.join(', ') || '(none)'}\n`);
    console.log('enumerations held:');
    console.log(`  ${PAGE_TROUBLESHOOTING}:${result.read.sentence.line}  subpaths, ORDERED`);
    console.log(`  ${PAGE_PACKAGES}:${result.read.paren.line}  namespaces`);
    console.log(`  ${PAGE_GLOSSARY}:${result.read.colon.line}  namespaces`);
    console.log(`  ${PAGE_GLOSSARY}:${result.read.table.line}  namespaces (layers table)`);
    console.log(`  ${PAGE_GLOSSARY}:${result.read.sections.line}  namespaces (### sections)`);
    console.log(`\n  ${result.claims.length} count claim(s): ${result.claims.map((c) => `${c.file}:${c.line}="${c.token}"`).join(', ')}\n`);
  }

  if (result.findings.length === 0) {
    console.log(
      `OK the hand-written spec enumerations agree with ${SPEC_PKG} -- ` +
      `${subpaths.length} subpath(s) held ORDERED in ${PAGE_TROUBLESHOOTING}; ` +
      `${namespaces.length} protocol namespace(s) [${namespaces.map((n) => n.display).join(', ')}] held in ` +
      `${PAGE_PACKAGES} and three times over in ${PAGE_GLOSSARY} (sentence, layers table, sections); ` +
      `${result.claims.length} numeric count claim(s) across ${DOCS_ROOT}/** agree with ${namespaces.length}. ` +
      'The two sets differ by ' +
      `${subpaths.filter((s) => !namespaces.some((n) => n.dir === s)).join(', ') || '(nothing)'}.`,
    );
    return;
  }

  console.error(`\nx the hand-written spec enumerations disagree with ${SPEC_PKG}:\n`);
  for (const file of [...new Set(result.findings.map((f) => f.file))]) {
    const forFile = result.findings.filter((f) => f.file === file);
    console.error(`  ${file} -- ${forFile.length} divergence(s)`);
    for (const f of forFile) console.error(`    ${file}:${f.line}  [${f.kind}] ${f.message}`);
    console.error('');
  }
  console.error(`VERDICT: ${result.findings.length} DIVERGENCE(S)

Fix the PROSE, not the exports map. The map is what the package actually
publishes; these pages are hand-written copies of it, and this gate is the
only thing making them true. #16325 moved ~25 mechanical counters of this set
and left all three of these pages stale, because nothing read them.

  [missing]      the exports map publishes a subpath/namespace the page never
                 names -> add it. This is the \`marketplace\` shape: invisible
                 to any check that only looks at what is already written down.
  [unknown]      the page names something the map does not publish -> the
                 subpath was retired and the prose outlived it (the \`cloud\`
                 shape), or it is misspelt. Display names come from
                 ${TITLES_FILE}, so \`Qa\` is a finding and \`QA\` is not.
  [order]        right names, wrong order, on the one sentence that claims the
                 exports map's order.
  [duplicate]    the same name listed twice -- in the layers table that also
                 means two layers claim it, and the table is a partition.
  [count-drift]  a sentence states a namespace total the map no longer bears.
`);
  process.exit(1);
}

// Exports bindings, so an import for those exports alone must run nothing.
if (isEntrypoint(import.meta.url)) {
  main();
}
