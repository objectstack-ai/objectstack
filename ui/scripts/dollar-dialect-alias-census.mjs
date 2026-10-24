#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `$`-dialect lowercase-alias census (objectui#8568).
 *
 * ## What this answers, and what it deliberately does not
 *
 * objectui#8568 records that two files in `@object-ui/core` answer the same
 * `$`-dialect with two different acceptance sets, and that both answers are
 * deliberate. `convertFiltersToAST` (`packages/core/src/utils/filter-converter.ts`)
 * accepts four lowercase alias spellings "for tolerance"; `ValueDataSource`
 * refuses them by name as "non-canonical spellings", on objectui#8447's stated
 * reasoning that alias arms "would fossilise a second dialect".
 *
 * The card names three directions -- retire the converter's aliases, teach the
 * matcher the aliases, or keep both and document the split -- and rules on
 * none of them. It says the choice needs one number first:
 *
 *   > option 1's cost is entirely a function of how many authors are relying
 *   > on the tolerance, and nobody has measured that.
 *
 * THIS SCRIPT IS THAT MEASUREMENT AND NOTHING ELSE. It prints counts. It
 * repairs nothing, it changes no acceptance set, it is not wired into CI, and
 * it takes no position on which direction the number favours. That ruling is
 * reserved to objectui#8568 and to the maintainer.
 *
 * ## Why a `census:*` script and not a `check:*` gate
 *
 * The same reasoning `cross-file-line-citation-census.mjs` records for
 * objectui#8875, and for the same reason: `census:*` is this tree's existing
 * spelling for "runnable, reported, not blocking", so choosing it keeps the
 * change report-only without a reader having to take that on trust. A `check:*`
 * name invites the next sweep to wire it into a workflow and thereby to make
 * an undecided question blocking.
 *
 * ## The alias set is DERIVED, never listed here
 *
 * Writing the four spellings into this file would rebuild objectui#8568's own
 * defect one level up: a third hand-maintained copy of the dialect, which then
 * has to be edited whenever the map changes -- the edit everybody makes without
 * reading. So:
 *
 *   - the accepted set is read out of `operatorMap` in `filter-converter.ts`'s
 *     SOURCE (the same technique `readme-filter-operator-table.test.ts` uses,
 *     and for the same reason: the map is not exported);
 *   - the canonical set is read out of `@objectstack/spec`'s `FILTER_OPERATORS`;
 *   - the ALIASES are the difference.
 *
 * This matters most for the direction the card calls option 1. On a tree where
 * the aliases have been retired, the derived set is EMPTY and this census says
 * so, instead of going on grepping four spellings that no longer mean anything.
 *
 * ## The conflation this census exists to avoid
 *
 * There are TWO filter dialects in this repo and they are easy to read as one.
 *
 *   - the `$`-DIALECT -- `{ email: { $startsWith: 'a' } }` -- MongoDB-shaped
 *     operator KEYS, lowered by `convertFiltersToAST`. This is objectui#8568's
 *     subject and the only dialect this census counts.
 *   - the OBJECT-FORM / view-filter dialect -- `{ field, operator: 'startswith',
 *     value }` -- whose table is `FILTER_OPERATOR_ALIASES` in
 *     `packages/data-objectstack/src/index.ts`. That table is tolerant BY
 *     DESIGN and case-FOLDING by construction (`normalizeFilterOperator` calls
 *     `op.toLowerCase()` before the lookup), and it carries the bare spellings
 *     `startswith`, `endswith`, `notcontains`, `notin` as first-class members.
 *
 * A grep for `startswith` cannot tell the two apart, and the second dialect is
 * where nearly all of this repo's authored filters actually live. Reading its
 * rows as `$`-dialect reliance would make option 1 look expensive for filters
 * option 1 does not touch. So this census requires the `$` and requires an
 * operator-KEY position, and ships a control (`sibling-dialect`) that fails if
 * a bare row from that table is ever counted.
 *
 * ## Payload versus mention, because only one of them is an author
 *
 * Each occurrence is classified on two independent axes.
 *
 *   SHAPE. A PAYLOAD is the spelling in operator-key position -- `$notin:`,
 *   `'$notin':`, `"$notin":` -- or handed to the converter as its whole
 *   argument, `convertOperatorToAST('$notin')`. That is somebody writing a
 *   filter. A MENTION is every other occurrence: a backticked span in prose, a
 *   table cell, a comment, an `it.each([...])` roster. A mention is a claim
 *   ABOUT the dialect, not a use of it.
 *
 *   ROLE, from the path. `authored-corpus` is the population the card is
 *   asking about; `implementation` is the map itself; `converter-ledger` and
 *   `refusal-ledger` are the tests and READMEs that exist BECAUSE of the
 *   aliases and would have to be edited by whoever retires them -- real work,
 *   but not an author relying on tolerance; `release-notes` are dated records.
 *
 * Conflating the two axes is how a census of this shape over-reads: every
 * alias spelling in the tree today is either the map or something pointing at
 * the map, and a flat grep total makes that look like adoption.
 *
 * ## What this census CANNOT see -- which bounds every option's cost
 *
 * ⚠️ The number below is CONSUMER-LOCAL, not seam-wide. objectui#6839
 * established that distinction after "no producer emits X" was found true of
 * one helper's ten call sites and false of `ListView`. This repo is a
 * RENDERER: the filters it lowers are authored as METADATA, and the metadata
 * store is not in this tree. Specifically invisible from here:
 *
 *   - view / list-view / sharing-rule criteria stored in a deployment's
 *     database. `FilterConditionField` writes `criteria_json` into exactly such
 *     a store, and nothing in this repo can enumerate what is already in one;
 *   - seed, demo and app metadata that ships from `objectstack-ai/objectstack`
 *     or from any other producer repo;
 *   - filters assembled at runtime by application code outside this monorepo,
 *     including anything published `@object-ui/*` consumers write;
 *   - any filter whose operator key is COMPUTED (`{ [op]: value }`), which no
 *     static scan can resolve.
 *
 * A zero here therefore means "this repo's own authored corpus does not rely on
 * the tolerance". It does NOT mean "no author relies on the tolerance", and it
 * must not be quoted as if it did.
 *
 * Usage:
 *   node scripts/dollar-dialect-alias-census.mjs
 *   node scripts/dollar-dialect-alias-census.mjs --json
 *   node scripts/dollar-dialect-alias-census.mjs --list-all
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';
import { uiRoot } from './ui-root.mjs';

/** The file whose `operatorMap` defines the accepted `$`-dialect. */
export const CONVERTER_PATH = 'packages/core/src/utils/filter-converter.ts';

/** Files this census reads. Anything else is NOT SCANNED, which it says. */
export const SCANNED_EXT = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'md', 'mdx', 'yml', 'yaml',
]);

/**
 * The instrument itself, carved out by name -- and the two entries are NOT the
 * same carve-out, which is what this comment used to average away.
 *
 *   THIS FILE carries the BAIT the `impossible` negative control is aimed at:
 *   `IMPOSSIBLE_SPELLING` is a string LITERAL here and, measured, nowhere else
 *   in the tree. Scanning it makes that control fire on its own declaration and
 *   `main` exits non-zero saying the run is NOT a reading. So this entry is
 *   CONTROL-BACKED: if it ever stops matching -- a rename, a move -- the census
 *   does not print a quietly wrong number, it refuses to print one at all. The
 *   suite pins that by ABLATION rather than by assertion.
 *
 *   THE SUITE carries the alias and canonical spellings as fixture text, and it
 *   deliberately does NOT carry the impossible spelling: it hands the imported
 *   `IMPOSSIBLE_SPELLING` binding to `scanText` instead. ⚠️ So no control fires
 *   if THIS entry drifts -- dropping it changes only which canonical rows
 *   `canonicalTotals` counts. Its reason is the plain one: a suite rehearsing
 *   the dialect is not an author using it. Stated separately because the two
 *   entries are justified by two different things, and only one of them has a
 *   control underneath it.
 *
 * The number of occurrences skipped is printed rather than hidden, so a reader
 * can see the carve-out is these two files and not a silent filter.
 *
 * ## ⛔ Why this list is NOT the by-name drift objectui#9865 ruled against
 *
 * objectui#9891 asked whether `cross-file-line-citation-census.mjs`'s
 * `fixture-address: <reason>` class -- a class DECLARED per address by the
 * citing file, reason required, every declared row printed -- should replace
 * this list. Measured, it should not, and the reasons are about THIS population
 * rather than about the class:
 *
 *   - THE CLASS DID NOT REPLACE THE SELF-LIST WHERE IT LANDED. The citation
 *     census still declares its own `SELF_FILES` and still carves those whole
 *     files out by name. The class exists for addresses sitting in OTHER files
 *     among genuine pointers, where a whole-file carve-out would hide real rot.
 *     objectui#9865's ⛔ is against NAMING MORE FILES in such a list, ⛔ not
 *     against a self-list existing.
 *   - THERE IS NOTHING HERE FOR A PER-ROW DECLARATION TO PRESERVE. Both files
 *     are role `other`, and `other` is never the number objectui#8568 asked for
 *     -- `authored-corpus` is. A spelling written inside this instrument cannot
 *     be an author relying on the tolerance, so a whole-file carve-out hides no
 *     row anybody wants back. That is the exact property the declared class was
 *     invented because the citation population does NOT have.
 *   - THE DRIFT DIRECTION IS INVERTED for the first entry. A declaration buys
 *     travel-with-the-file; the `impossible` control already buys
 *     announce-on-drift, which is the property a report-only instrument needs,
 *     because its failure mode is a confident wrong number rather than a missed
 *     repair.
 *
 * ⚠️ That third argument does ⛔ NOT cover the second entry, and this comment
 * says so above rather than letting one entry's control vouch for both.
 */
export const SELF_FILES = new Set([
  'scripts/dollar-dialect-alias-census.mjs',
  'scripts/__tests__/dollar-dialect-alias-census.test.ts',
]);

/** Generated or vendored text nothing authors by hand. */
export const SKIP_PATHS = [
  'pnpm-lock.yaml',
  'node_modules/',
  '/dist/',
  '.turbo/',
];

/**
 * Path prefix -> role. FIRST match wins, so the specific entries precede the
 * tree-wide ones. The roles are the reason a flat total misleads: see the
 * "Payload versus mention" section above.
 */
export const ROLES = [
  [CONVERTER_PATH, 'implementation'],
  ['packages/core/src/utils/__tests__/', 'converter-ledger'],
  ['packages/data-objectstack/README.md', 'converter-ledger'],
  ['packages/data-objectstack/src/readme-filter-operator-table.test.ts', 'converter-ledger'],
  ['packages/core/src/adapters/', 'refusal-ledger'],
  ['.changeset/', 'release-notes'],
  ['examples/', 'authored-corpus'],
  ['apps/', 'authored-corpus'],
  ['content/', 'authored-corpus'],
  ['docs/', 'authored-corpus'],
  ['e2e/', 'authored-corpus'],
  ['skills/', 'authored-corpus'],
];

/** The roles whose count is the number objectui#8568 asked for. */
export const AUTHORED_ROLE = 'authored-corpus';

export function roleOf(path) {
  for (const [prefix, role] of ROLES) if (path === prefix || path.startsWith(prefix)) return role;
  return 'other';
}

/**
 * A test living inside an authored tree is still a test. It stays in the
 * authored-corpus population -- a filter payload written in `apps/console`'s
 * own suite is real evidence about the shapes that app code produces -- but the
 * `authored-reach` control refuses to be satisfied by one, because a scanner
 * that reaches only the tests has not shown it reaches the metadata.
 */
export function isTestPath(path) {
  return /(?:^|\/)__tests__\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/**
 * The `operatorMap` keys, read out of the converter's SOURCE.
 *
 * The map is a module-local `const`, so there is no import that would show its
 * lowercase arms. `readme-filter-operator-table.test.ts` solves the same
 * problem the same way; keeping the two techniques identical is deliberate, so
 * a change to the map's shape breaks both instruments at once rather than
 * leaving this one quietly reading an empty set.
 */
export function operatorMapKeysFromSource(source) {
  const start = source.indexOf('const operatorMap');
  if (start === -1) {
    throw new Error(
      `${CONVERTER_PATH} no longer declares \`const operatorMap\` (objectui#8568): re-point this census `
      + 'rather than letting it read an empty map, which would print a confident zero.',
    );
  }
  const open = source.indexOf('{', start);
  const close = source.indexOf('};', open);
  if (open === -1 || close === -1) throw new Error(`${CONVERTER_PATH}: could not delimit the operatorMap literal`);
  const body = source.slice(open + 1, close);
  const keys = [...body.matchAll(/^\s*'?(\$[A-Za-z]+)'?\s*:/gm)].map((m) => m[1]);
  if (keys.length === 0) throw new Error(`${CONVERTER_PATH}: operatorMap parsed to zero keys`);
  return keys;
}

/**
 * The alias set: accepted by the converter, absent from the spec's canonical
 * vocabulary. Derived, never listed -- see the header.
 */
export function deriveAliases(mapKeys, specOperators) {
  const canonical = new Set(specOperators);
  return mapKeys.filter((k) => !canonical.has(k));
}

/**
 * The canonical spelling an alias is the lowercase form OF, when one exists.
 * Used only by the positive control: the twin must be visible to the same
 * scanner, or a zero for the alias is blindness rather than a reading.
 */
export function canonicalTwin(alias, specOperators) {
  const lower = alias.toLowerCase();
  return specOperators.find((op) => op.toLowerCase() === lower) ?? null;
}

/**
 * Every occurrence of `spelling` in `text`, with its SHAPE.
 *
 * `payload` requires operator-KEY position or a whole-argument converter call.
 * Everything else is `mention`. The `$` is mandatory and the match is
 * case-sensitive and boundary-anchored, which together are what keep the
 * `$`-free sibling dialect out (see the header, and the `sibling-dialect`
 * control below).
 */
const RE_CACHE = new Map();

function regexesFor(spelling) {
  let cached = RE_CACHE.get(spelling);
  if (cached) return cached;
  const esc = spelling.replace(/[$]/g, '\\$');
  cached = {
    // Operator-key position: bare, single- or double-quoted, then optional space, then `:`.
    keyRe: new RegExp(`(?<![A-Za-z0-9_$])(?:'${esc}'|"${esc}"|${esc})\\s*:`, 'g'),
    // The whole argument of a converter call: convertOperatorToAST('$notin').
    argRe: new RegExp(`convert(?:Operator|Filters)ToAST\\(\\s*(?:'${esc}'|"${esc}")\\s*\\)`, 'g'),
    // Any occurrence at all, as a token.
    anyRe: new RegExp(`(?<![A-Za-z0-9_$])${esc}(?![A-Za-z0-9_])`, 'g'),
  };
  RE_CACHE.set(spelling, cached);
  return cached;
}

export function scanText(text, spelling) {
  // Cheap literal prefilter. `indexOf` is case-SENSITIVE, which is the same
  // discipline the regexes below keep, so it can never hide a hit the regexes
  // would have found — a case-folding prefilter here would have been a silent
  // way to drop the whole population.
  if (text.indexOf(spelling) === -1) return [];
  const { keyRe, argRe, anyRe } = regexesFor(spelling);

  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const payloadCols = new Set();
    for (const m of line.matchAll(keyRe)) payloadCols.add(m.index);
    for (const m of line.matchAll(argRe)) payloadCols.add(m.index);
    const hasPayload = payloadCols.size > 0;
    let n = 0;
    for (const _m of line.matchAll(anyRe)) n += 1;
    if (n === 0) continue;
    // A line carrying a payload is counted as a payload once, and any further
    // occurrences on the same line are mentions of it rather than new filters.
    if (hasPayload) {
      out.push({ spelling, line: i + 1, shape: 'payload', text: line.trim().slice(0, 200) });
      for (let k = 1; k < n; k += 1) out.push({ spelling, line: i + 1, shape: 'mention', text: line.trim().slice(0, 200) });
    } else {
      for (let k = 0; k < n; k += 1) out.push({ spelling, line: i + 1, shape: 'mention', text: line.trim().slice(0, 200) });
    }
  }
  return out;
}

/** Every tracked path, as git sees them. */
export function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function scannable(rel) {
  // ⚠️ Belt and braces, ⛔ not a second judgement site: `runCensus` diverts the
  // SELF_FILES rows above the only call to this function, so this arm is
  // unreachable from there today. It stays so that a future caller inherits the
  // carve-out instead of having to remember it -- read as a live duplicate of
  // the predicate, it is the thing objectui#9891 was filed about.
  if (SELF_FILES.has(rel)) return false;
  if (SKIP_PATHS.some((p) => rel === p || rel.includes(p))) return false;
  const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.') + 1).toLowerCase() : '';
  return SCANNED_EXT.has(ext);
}

/**
 * The controls. A zero with no lit positive control is not a reading, and a
 * count with no dead negative control is not a reading either -- this is a
 * recorded lane rule in this repo, and objectui#8568's own filing seat could
 * make no dedup claim for exactly this reason.
 *
 *   positive `canonical-twin`   the camelCase twin of each alias must be seen
 *                               by THIS scanner. Zero twins means the scanner
 *                               is blind to the whole dialect.
 *   positive `authored-reach`   a canonical `$`-operator must be seen as a
 *                               PAYLOAD inside a NON-TEST authored file.
 *                               Without this, "no aliases in the authored
 *                               corpus" cannot be told apart from "the scanner
 *                               never reaches the authored corpus".
 *   negative `impossible`       a spelling that cannot exist must read zero.
 *   negative `sibling-dialect`  the `$`-FREE row `startswith:` really present
 *                               in `FILTER_OPERATOR_ALIASES` must NOT be
 *                               counted. This is the conflation the census
 *                               exists to avoid; if it ever fires, every
 *                               number above it is about the wrong dialect.
 *
 * ⚠️ The negative controls also measure that their BAIT still exists.
 * `sibling-dialect` counts the `$`-free rows in that file with a deliberately
 * `$`-less probe and fails when it finds NONE, because "the census counted zero
 * sibling rows" and "there are no sibling rows left to count" are the same
 * reading otherwise -- a check that passes because nothing is produced.
 *
 * ⚠️ What this control does NOT witness, measured by ablation rather than
 * assumed. The `$`-strictness lives in TWO layers: the literal prefilter in
 * `scanText` and the regexes it guards. Loosening the REGEX alone leaves this
 * control GREEN, because the prefilter has already excluded the file before the
 * regex runs. So the runtime control witnesses the COMPOSED scanner; the
 * `$`-strictness and case-sensitivity of the regexes themselves are pinned
 * directly on `scanText` in the suite, which is where a one-layer regression is
 * actually caught.
 */
export const SIBLING_DIALECT_FILE = 'packages/data-objectstack/src/index.ts';
export const IMPOSSIBLE_SPELLING = '$startswithzzz';

/**
 * The `$`-free sibling rows in `FILTER_OPERATOR_ALIASES`, counted with a probe
 * that deliberately does NOT require the `$`. This is the bait the
 * `sibling-dialect` control is aimed at, and a control whose bait has vanished
 * is not a control.
 */
export function siblingDialectBait(source) {
  return [...source.matchAll(/^\s*(?:startswith|endswith|notcontains|notin):\s*'/gm)].length;
}

export function evaluateControls({ aliases, specOperators, byRole, authoredPayloadCanonical, siblingHits, siblingBait, impossibleHits }) {
  const controls = [];

  const twins = aliases.map((a) => canonicalTwin(a, specOperators)).filter(Boolean);
  const twinSeen = twins.filter((t) => (byRole.canonicalTotals[t] ?? 0) > 0);
  controls.push({
    id: 'canonical-twin',
    kind: 'positive',
    want: 'lit',
    ok: aliases.length === 0 ? true : twinSeen.length > 0,
    detail: aliases.length === 0
      ? 'no aliases derived, so there is no twin to light -- see "the derived set is empty" below'
      : `${twinSeen.length}/${twins.length} twins visible: ${twins.map((t) => `${t}=${byRole.canonicalTotals[t] ?? 0}`).join(', ')}`,
    why: 'the same scanner must be able to see the camelCase spellings, or a zero for the lowercase ones is blindness',
  });

  controls.push({
    id: 'authored-reach',
    kind: 'positive',
    want: 'lit',
    ok: authoredPayloadCanonical.length > 0,
    detail: authoredPayloadCanonical.length > 0
      ? `${authoredPayloadCanonical.length} canonical $-operator payload(s) in NON-TEST authored files, e.g. `
        + authoredPayloadCanonical.slice(0, 3).map((h) => `${h.file}:${h.line} ${h.spelling}`).join('; ')
      : 'NONE -- the scanner found no $-dialect payload in a non-test authored file at all',
    why: 'without this the authored-corpus zero is indistinguishable from a scanner that never looked there; '
      + 'tests are excluded because reaching only the suites is not reaching the metadata',
  });

  controls.push({
    id: 'impossible',
    kind: 'negative',
    want: 'dead',
    ok: impossibleHits === 0,
    detail: `${IMPOSSIBLE_SPELLING}: ${impossibleHits} hit(s)`,
    why: 'a scanner that matches a spelling nobody wrote is matching something other than the spelling',
  });

  controls.push({
    id: 'sibling-dialect',
    kind: 'negative',
    want: 'dead',
    ok: siblingHits === 0 && siblingBait > 0,
    detail: siblingBait === 0
      ? `NO BAIT LEFT -- ${SIBLING_DIALECT_FILE} carries no $-free rows for this control to decline, so its zero says nothing`
      : `${siblingBait} $-free row(s) present in ${SIBLING_DIALECT_FILE}; counted as $-dialect: ${siblingHits}`,
    why: 'FILTER_OPERATOR_ALIASES is a DIFFERENT, deliberately tolerant dialect; counting it would price option 1 against filters it does not touch',
  });

  return controls;
}

function tally(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

async function loadSpecOperators() {
  const mod = await import('@objectstack/spec/data');
  const ops = mod.FILTER_OPERATORS;
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('@objectstack/spec/data exported no FILTER_OPERATORS: the canonical set cannot be derived');
  }
  return [...ops];
}

export async function runCensus(root) {
  const converterSource = readFileSync(join(root, CONVERTER_PATH), 'utf8');
  const mapKeys = operatorMapKeysFromSource(converterSource);
  const specOperators = await loadSpecOperators();
  const aliases = deriveAliases(mapKeys, specOperators);

  const tracked = trackedFiles(root);
  const rows = [];
  const canonicalRows = [];
  let impossibleHits = 0;
  let scanned = 0;
  let selfCarved = 0;

  for (const rel of tracked) {
    if (SELF_FILES.has(rel)) {
      try {
        const own = readFileSync(join(root, rel), 'utf8');
        for (const alias of aliases) selfCarved += scanText(own, alias).length;
      } catch { /* a missing self file is not a reading problem */ }
      continue;
    }
    if (!scannable(rel)) continue;
    let text;
    try {
      if (statSync(join(root, rel)).size > 4 * 1024 * 1024) continue;
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    const role = roleOf(rel);
    for (const alias of aliases) {
      for (const h of scanText(text, alias)) rows.push({ ...h, file: rel, role });
    }
    for (const op of specOperators) {
      for (const h of scanText(text, op)) canonicalRows.push({ ...h, file: rel, role });
    }
    impossibleHits += scanText(text, IMPOSSIBLE_SPELLING).length;
  }

  const canonicalTotals = {};
  for (const r of canonicalRows) canonicalTotals[r.spelling] = (canonicalTotals[r.spelling] ?? 0) + 1;

  const authoredPayloadCanonical = canonicalRows
    .filter((r) => r.role === AUTHORED_ROLE && r.shape === 'payload' && !isTestPath(r.file));
  const siblingHits = rows.filter((r) => r.file === SIBLING_DIALECT_FILE).length;
  const siblingBait = siblingDialectBait(readFileSync(join(root, SIBLING_DIALECT_FILE), 'utf8'));

  const controls = evaluateControls({
    aliases,
    specOperators,
    byRole: { canonicalTotals },
    authoredPayloadCanonical,
    siblingHits,
    siblingBait,
    impossibleHits,
  });

  return { mapKeys, specOperators, aliases, tracked, scanned, selfCarved, rows, canonicalRows, canonicalTotals, authoredPayloadCanonical, controls };
}

async function main(argv) {
  const root = uiRoot();
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const asJson = argv.includes('--json');
  const listAll = argv.includes('--list-all');

  const r = await runCensus(root);
  const authored = r.rows.filter((x) => x.role === AUTHORED_ROLE);
  const authoredPayload = authored.filter((x) => x.shape === 'payload');
  const payloads = r.rows.filter((x) => x.shape === 'payload');

  if (asJson) {
    console.log(JSON.stringify({
      head,
      scannedFiles: r.scanned,
      trackedFiles: r.tracked.length,
      operatorMapKeys: r.mapKeys,
      specOperators: r.specOperators,
      aliases: r.aliases,
      total: r.rows.length,
      payloads: payloads.length,
      authoredCorpusTotal: authored.length,
      authoredCorpusPayloads: authoredPayload.length,
      carvedOutSelf: r.selfCarved,
      byRole: Object.fromEntries(tally(r.rows, 'role')),
      byShape: Object.fromEntries(tally(r.rows, 'shape')),
      bySpelling: Object.fromEntries(tally(r.rows, 'spelling')),
      controls: r.controls,
      rows: listAll ? r.rows : authored,
    }, null, 2));
  } else {
    console.log(`# $-dialect lowercase-alias census -- objectui#8568 (HEAD ${head})\n`);
    console.log(`Scanned ${r.scanned} of ${r.tracked.length} tracked files (extension whitelist; anything else is NOT SCANNED, which is not the same as zero).\n`);

    console.log('## The alias set, derived rather than listed\n');
    console.log(`operatorMap keys (${r.mapKeys.length}) : ${r.mapKeys.join(' ')}`);
    console.log(`spec FILTER_OPERATORS (${r.specOperators.length}) : ${r.specOperators.join(' ')}`);
    console.log(`ALIASES = accepted but not canonical (${r.aliases.length}) : ${r.aliases.join(' ') || '(none)'}`);
    console.log('');

    console.log('## Controls -- all four must hold, or this run is not a reading\n');
    for (const c of r.controls) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id} (${c.kind}, want ${c.want})`);
      console.log(`      ${c.detail}`);
      console.log(`      why: ${c.why}`);
    }
    console.log('');

    console.log('## The number objectui#8568 asked for\n');
    console.log(`Alias occurrences, whole tree              : ${r.rows.length}`);
    console.log(`  of which in operator-key position        : ${payloads.length}`);
    console.log(`Excluded, this census and its own suite     : ${r.selfCarved}`);
    console.log(`Alias occurrences in the AUTHORED CORPUS   : ${authored.length}`);
    console.log(`  of which in operator-key position        : ${authoredPayload.length}`);
    console.log('  ^ this is the population option 1 would break. It is a reading only');
    console.log('    because the two positive controls above fired.');
    console.log('');

    console.log('## By role -- why the whole-tree total is not the cost\n');
    console.log(`${'role'.padEnd(20)}${'total'.padStart(7)}${'payload'.padStart(9)}${'mention'.padStart(9)}`);
    for (const [role] of tally(r.rows, 'role')) {
      const rows = r.rows.filter((x) => x.role === role);
      console.log(
        `${role.padEnd(20)}${String(rows.length).padStart(7)}`
        + `${String(rows.filter((x) => x.shape === 'payload').length).padStart(9)}`
        + `${String(rows.filter((x) => x.shape === 'mention').length).padStart(9)}`,
      );
    }
    console.log('');

    console.log('## By spelling\n');
    for (const a of r.aliases) {
      const rows = r.rows.filter((x) => x.spelling === a);
      const twin = canonicalTwin(a, r.specOperators);
      console.log(
        `  ${a.padEnd(16)} ${String(rows.length).padStart(3)} total, `
        + `${String(rows.filter((x) => x.role === AUTHORED_ROLE).length).padStart(3)} authored`
        + (twin ? `   (canonical twin ${twin}: ${r.canonicalTotals[twin] ?? 0})` : ''),
      );
    }
    console.log('');

    console.log(`## Every alias occurrence in the authored corpus (${authored.length})\n`);
    if (authored.length === 0) {
      console.log('  (none)\n');
    } else {
      for (const x of authored.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
        console.log(`  ${x.file}:${x.line}  [${x.shape}] ${x.spelling}`);
        console.log(`      ${x.text}`);
      }
      console.log('');
    }

    if (listAll) {
      console.log(`## Every alias occurrence in the tree (${r.rows.length})\n`);
      for (const x of r.rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
        console.log(`  ${x.file}:${x.line}  ${x.role.padEnd(18)} [${x.shape}] ${x.spelling}`);
      }
      console.log('');
    }

    console.log('## What this census CANNOT see\n');
    console.log('⚠️ The authored-corpus number is CONSUMER-LOCAL, not seam-wide (objectui#6839).');
    console.log('   Invisible from this repo, and therefore NOT in any count above:');
    console.log('     - view / list-view / sharing-rule criteria stored in a deployment database');
    console.log('       (`FilterConditionField` writes `criteria_json` into exactly such a store);');
    console.log('     - seed, demo and app metadata shipped from objectstack or any other producer repo;');
    console.log('     - filters assembled at runtime by published `@object-ui/*` consumers;');
    console.log('     - any filter whose operator key is COMPUTED (`{ [op]: value }`).');
    console.log('   A zero above means "this repo does not rely on the tolerance", never');
    console.log('   "no author relies on the tolerance".\n');
  }

  const failed = r.controls.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.error(`\n✗ ${failed.length} control(s) failed -- this run is NOT a reading.`);
    return 1;
  }
  if (r.aliases.length > 0 && r.rows.length === 0) {
    console.error('\n✗ Aliases were derived but not one occurrence was found anywhere -- not even');
    console.error('  the map that defines them. That is a blind scanner, not a clean tree, so');
    console.error('  this exits non-zero rather than printing a silent zero.');
    return 1;
  }
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
