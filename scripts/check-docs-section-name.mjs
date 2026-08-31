#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-docs-section-name (#10830, YAML arm #11887) -- every form-section
 * example under `content/docs/**` must carry a `name`, whether it is written
 * as a TypeScript object literal or as a YAML `sections:` mapping.
 *
 *   node scripts/check-docs-section-name.mjs              # the gate
 *   node scripts/check-docs-section-name.mjs --list       # the census it judged
 *   node scripts/check-docs-section-name.mjs --self-test  # prove it can go red
 *
 * ## The defect
 *
 * A form section without `name` has no i18n anchor: the heading resolves
 * through `objects.<object>._sections.<name>.label`, so a nameless section
 * renders its authored label in EVERY locale. `packages/spec` declares the key
 * `.optional()` on purpose (`src/ui/component.zod.ts`) -- a nameless section is
 * LEGAL and that is settled (#10709). What is not settled is the docs corpus:
 * the pages that TEACH the convention are the one surface where nothing
 * enforces it.
 *
 * Two mechanisms look like they would catch a nameless example and neither can:
 *
 *   1. `packages/lint`'s `translation-section-name-missing`
 *      (`packages/lint/src/validate-translatable-sections.ts`) walks APP
 *      METADATA -- `collectionEntries`, `walkPageComponents`,
 *      `viewContainerSites`. It never sees an `.mdx` code fence, and its
 *      severity is `'warning'` in any case.
 *   2. `{/* os:check *\/}` fences ARE type-checked against the live spec by
 *      `packages/spec/scripts/check-skill-examples.ts`. But `name` is
 *      `.optional()`, so a nameless section TYPE-CHECKS CLEAN.
 *      `content/docs/ui/forms.mdx`'s first block carries an `os:check` marker
 *      and still shipped a nameless section for months.
 *
 * ## Why a gate rather than a fourth sweep
 *
 * The same population has been hand-counted THREE times and produced THREE
 * numbers, each pass correcting its predecessor's instrument and introducing a
 * subtler version of the same error:
 *
 *   #10579     "three of five over four `ui/` pages"  -- single-line scan;
 *              missed `forms.mdx` entirely.
 *   #10709     "7 of 15 across 5 pages"               -- multi-line, but
 *              required `{` to begin a fresh line, so it missed `forms.mdx`'s
 *              inline `sections: [{`.
 *   PR #10827  "8 of 16 across 5 pages" (at b6bb2ee454^) -- bracket-matching,
 *              and the figure this card carried forward.
 *
 * ⭐ All three shared a fourth error none of them noticed, and this gate
 * measured it on its landing tree: **all three scoped to `content/docs/ui/**`.**
 * `sections: [` object literals live in TS fences under `content/docs/concepts/`
 * and `content/docs/protocol/objectui/` too, and every one of those was
 * nameless. So the instrument error class here is not only "how do you match a
 * literal" but "where did you look", and a hand-derived scope is defeated the
 * same way a hand-derived matcher is. That is the case a mechanical check pays
 * for: it settles the count ONCE, over a scope nobody re-guesses per card.
 *
 * ## ⛔ This gate does NOT touch the contract
 *
 * `name` stays `.optional()` in `packages/spec`. A nameless section is legal
 * metadata and this gate says nothing about metadata -- it rules on DOCS
 * EXAMPLES only, because an example is a teaching artifact and a teaching
 * artifact that contradicts the convention it teaches is the defect. Anyone
 * reading this file as licence to tighten the schema has read it backwards.
 *
 * ## What is judged, and what is deliberately not
 *
 * PRESENCE of a `name` key at the literal's own top level. Nothing else:
 *
 *   - NOT snake_case casing. Zero occurrences of a camelCase `name` were
 *     measured in this corpus, and a rule with no population is a rule whose
 *     first red will be against work that is not the defect.
 *   - NOT a non-empty value. Same reason.
 *
 * Both are cheap to add the day a real occurrence appears. Adding them now
 * would widen the verification surface with no measurement behind it.
 *
 * ## Two arms, two parsers -- and the boundary between them is DECLARED
 *
 * TS-family fences (`TS_FENCE_LANGS`) are bracket-matched as object literals.
 * YAML fences (`YAML_FENCE_LANGS`) are handed to the `yaml` package -- the
 * SAME parser the docs build resolves -- and judged on its AST. That is the
 * whole reason the YAML arm is a separate limb rather than a wider regex: the
 * bracket matcher would MISREAD a YAML block rather than judge it, and a gate
 * that fabricates findings out of a syntax it does not parse is worse than no
 * gate.
 *
 * ⛔ The AST is walked, NOT `toJS()`. A projection to plain JS silently
 * collapses DUPLICATE KEYS, and duplicate keys are the normal shape of a
 * teaching fence: `concept.mdx` and `index.mdx` each concatenate two or three
 * snippets into one fence, so `layout:` appears twice. Judging the JS
 * projection would have hidden 4 real nameless sections behind a key that
 * "won". The AST keeps both pairs; the JS object cannot.
 *
 * ## ⭐ What an UNPARSEABLE fence means -- the decision #10830 deferred
 *
 * `yaml` is a RECOVERING parser: it returns a tree for almost any input,
 * including one it had to guess at. So "did it throw" is not the question.
 * The question is whether the tree it returned is the author's tree, and the
 * error CODES answer it:
 *
 *   SEMANTIC error (`SEMANTIC_ERROR_CODES` -- today `DUPLICATE_KEY` alone)
 *     The parse is COMPLETE and unambiguous; nothing was guessed. The document
 *     is simply not a valid mapping. => JUDGED, and counted separately so the
 *     recovery is visible rather than invisible.
 *
 *   SYNTAX error (everything else: MISSING_CHAR, BAD_INDENT, TAB_AS_INDENT, …)
 *     The parser recovered by GUESSING, so a finding drawn from that tree
 *     could be fabricated -- exactly the failure this file refuses to commit.
 *     => NOT judged. COUNTED and PRINTED as a declared skip, the same posture
 *     this file already uses for a population it will not rule on.
 *
 * ⚠️ That skip population is EMPTY on the tree this arm landed against, so
 * `--self-test` carries it as a fixture. A boundary with no live population is
 * exactly the kind that rots unnoticed.
 *
 * ## ⚠️ The census this arm was built on, and why the card's number moved
 *
 * #11887 measured 21 nameless mappings across 16 YAML fences at `4019e16cd`,
 * and warned that its own first instrument (a hand-rolled indentation walker)
 * had returned 51. Re-derived here with the parser: `4019e16cd` really does
 * hold 21 under the card's own strict reading, so the card's arithmetic was
 * sound. What the card got WRONG is the shape of its two non-parsing fences --
 * it called them "elided fragments"; they are duplicate-key fences, and this
 * arm judges them (which is why the strict reading of that same ref yields 25,
 * not 21). By `787d75740` the population had fallen to 13 nameless across 10
 * fences -- #13337 and #13532 rewrote `layout-dsl.mdx` out from under the card
 * -- and #11887's sweep took that to 0. Do not re-derive by hand.
 *
 * ## ⛔ A zero here must be a MEASUREMENT, not a silence
 *
 * This gate's own subject is a defect that survived three counts because each
 * count's silence read as a clean bill of health. A verdict line reading
 * "0 violations" and nothing else would be this gate committing the sin it
 * exists to catch. Three things are done about that, and none is a promise:
 *
 *   1. The verdict prints the POPULATION IT JUDGED -- files, TS fences,
 *      `sections:` arrays, section object literals -- not just the verdict.
 *   2. `run()` REFUSES (exit EXIT_REFUSED, never 0) when a broken selector
 *      would otherwise wear a pass: the docs root missing, zero files scanned,
 *      zero TS fences in a corpus that has hundreds, a `sections:` array count
 *      or a literal count below its floor, or a census anchor -- a page the
 *      defect was actually repaired in -- absent from the judged population.
 *      Same shape as `check-react-page-adapter-contract.mjs` (#4932) and
 *      `check-agent-test-spelling.mjs` (#11667).
 *   3. `--self-test` drives the REAL sweep over a REAL temp tree on disk, so
 *      what is proven red is the file walk plus the fence extractor plus the
 *      bracket matcher plus the verdict -- not a predicate called with a
 *      string.
 *
 * ## Why bracket-matching, and why the masker is borrowed
 *
 * Line-matching is exactly what defeated #10579 and #10709. `sections: [{` puts
 * the opening brace on the same line as the array; a literal can span ten lines
 * or none. So the array is bracket-matched and split into depth-1 entries.
 *
 * Comment and string spans come from `scripts/js-comment-mask.mjs`, this tree's
 * ONE answer to "is this span code or prose", rather than a private
 * `stripComments`: a `[` inside a string and a `sections: [` inside a docblock
 * are both ways to defeat a hand-rolled matcher, and that module has already
 * been diffed against a real TS parser over 4,739 files. Two projections of the
 * same scan are used, and they share byte offsets:
 *
 *   codeOnly    comments AND literal CONTENT blanked -- the bracket matcher
 *   flags       the raw comment/literal bit arrays   -- key-token recognition
 *
 * A QUOTED key (`'name':`) is recognised through the flags rather than the
 * masked text, because blanking literal content erases a quoted key's spelling
 * -- and "rename the key to a quoted form" would otherwise be a silent escape.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { fencedBlocks } from './check-react-page-adapter-contract.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

export const EXIT_CLEAN = 0;
export const EXIT_VIOLATIONS = 1;
export const EXIT_REFUSED = 2;

/** The one corpus this gate rules on. */
export const DOCS_ROOT = 'content/docs';

/**
 * Fence languages whose bodies are read as TypeScript/JavaScript object
 * literals.
 *
 * `js`/`jsx`/`javascript` carry no `sections:` array today. They are in the set
 * anyway: a fence relabelled from `ts` to `js` must not become a way out of the
 * rule, and a language that contributes nothing cannot produce a false red.
 */
export const TS_FENCE_LANGS = new Set(['ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript', 'mts', 'cts']);

/**
 * Fence languages read by the YAML arm (#11887) -- parsed with the `yaml`
 * package and judged on its AST, never on a regex.
 */
export const YAML_FENCE_LANGS = new Set(['yaml', 'yml']);

/**
 * Parser error codes that leave a COMPLETE, unguessed tree behind.
 *
 * A duplicate key is a semantic complaint about a document the parser read in
 * full -- the normal shape of a teaching fence that concatenates two snippets.
 * Every OTHER code means the parser recovered by guessing, and a finding drawn
 * from a guessed tree is a fabricated finding. See the header.
 */
export const SEMANTIC_ERROR_CODES = new Set(['DUPLICATE_KEY']);

/**
 * Pages the defect was actually repaired in, pinned so a selector that stops
 * reaching them fails loudly instead of reporting a clean corpus.
 *
 * `forms.mdx` is the page BOTH earlier hand-passes missed, and it is the page
 * carrying an `os:check` marker over a nameless section -- the card's whole
 * point. `views.mdx` is where PR #10827's remaining two sites lived.
 * `architecture.mdx` is outside `content/docs/ui/**` and is the anchor that
 * fails if anyone re-narrows this gate's scope to the directory all three
 * hand-passes assumed.
 */
export const CENSUS_ANCHORS = [
  `${DOCS_ROOT}/ui/forms.mdx`,
  `${DOCS_ROOT}/ui/views.mdx`,
  `${DOCS_ROOT}/concepts/architecture.mdx`,
];

/**
 * Floors on the population, set BELOW the measured figure on the landing tree
 * so that ordinary docs editing cannot red the gate, and far enough above zero
 * that an evaporated corpus cannot read as a clean one.
 *
 * Measured on the tree this landed against: see `--list`. The floors are the
 * blunt instrument; `CENSUS_ANCHORS` is the sharp one -- deleting every example
 * from one page still clears a count floor and still fails its anchor.
 */
export const FLOOR_FILES = 200;
export const FLOOR_TS_FENCES = 200;
export const FLOOR_SECTION_ARRAYS = 8;
export const FLOOR_SECTION_LITERALS = 16;

/**
 * Pages the YAML arm's own population lives on, pinned for the same reason as
 * `CENSUS_ANCHORS`: the whole nameless-YAML population #11887 measured sat on
 * these three, so a selector that stops reaching one of them has moved, and
 * must say so instead of reporting a clean corpus.
 */
export const YAML_CENSUS_ANCHORS = [
  `${DOCS_ROOT}/protocol/objectui/concept.mdx`,
  `${DOCS_ROOT}/protocol/objectui/index.mdx`,
  `${DOCS_ROOT}/protocol/objectui/layout-dsl.mdx`,
];

/**
 * Floors on the YAML population. Measured on the tree this arm landed against:
 * 10 fences carrying `sections:`, 19 section mappings, 0 skipped on a syntax
 * error. Set below those so ordinary docs editing cannot red the gate, and far
 * enough above zero that an evaporated YAML corpus cannot read as a clean one.
 */
export const FLOOR_YAML_FENCES = 6;
export const FLOOR_YAML_SECTIONS = 12;

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'build', '.turbo', 'coverage', '.git']);

/**
 * `sections` as an object KEY introducing an ARRAY.
 *
 * The leading class is what keeps `_sections` (the i18n translation MAP in
 * `content/docs/protocol/kernel/i18n-standard.mdx`) and any `.sections`
 * member access out of the population. The `\[` is the second, independent
 * reason that same site is not judged -- it introduces `{`, not `[`.
 */
const SECTIONS_KEY = /(^|[^A-Za-z0-9_$.'"`])(['"`]?)sections\2\s*:\s*\[/g;

/** An identifier that can be an unquoted object key. */
const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/y;

/* ─────────────────────────── corpus collection ────────────────────────────── */

/**
 * Every `.mdx` file under the docs root, repo-relative and sorted.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function docsFiles(root) {
  const files = [];
  /** @param {string} dir */
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) files.push(relative(root, full));
    }
  };
  const full = join(root, DOCS_ROOT);
  if (existsSync(full) && statSync(full).isDirectory()) walk(full);
  return files.sort();
}

/* ──────────────────────────── the bracket matcher ─────────────────────────── */

/**
 * The two projections of one scan. Both share byte offsets with `body`.
 *
 * @param {string} body
 * @returns {{ codeOnly: string, comment: Uint8Array, literal: Uint8Array }}
 */
export function project(body) {
  const { comment, literal } = scanSource(body);
  const both = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) both[i] = comment[i] || literal[i] ? 1 : 0;
  return { codeOnly: blank(body, both), comment, literal };
}

/**
 * The index just past the bracket opened at `open`, or -1 when unbalanced.
 *
 * Reads `codeOnly`, so brackets inside strings and comments are already spaces.
 *
 * @param {string} codeOnly
 * @param {number} open  index of the opening bracket
 * @returns {number}
 */
export function matchBracket(codeOnly, open) {
  const PAIRS = { '[': ']', '{': '}', '(': ')' };
  const stack = [PAIRS[codeOnly[open]]];
  for (let i = open + 1; i < codeOnly.length; i++) {
    const c = codeOnly[i];
    if (PAIRS[c]) {
      stack.push(PAIRS[c]);
      continue;
    }
    if (c === ']' || c === '}' || c === ')') {
      if (stack[stack.length - 1] !== c) return -1;
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Every `sections: [ … ]` array in one fence body.
 *
 * @param {string} body
 * @param {{ codeOnly: string, literal: Uint8Array }} proj
 * @returns {{ keyAt: number, open: number, close: number }[]}
 */
export function sectionArrays(body, proj) {
  const found = [];
  SECTIONS_KEY.lastIndex = 0;
  let m;
  while ((m = SECTIONS_KEY.exec(body)) !== null) {
    const quote = m[2];
    const keyAt = m.index + m[1].length + quote.length;
    // A bare key is CODE. A quoted key's spelling is literal CONTENT, and that
    // is the only literal span allowed to name the key -- otherwise `sections:
    // [` written inside a template string would be judged as an array.
    const isCode = proj.literal[keyAt] === 0;
    const isQuotedKey = quote !== '' && proj.literal[keyAt] === 1 && proj.literal[m.index + m[1].length] === 0;
    if (!isCode && !isQuotedKey) continue;
    const open = body.indexOf('[', keyAt + 'sections'.length + quote.length);
    if (open < 0 || proj.codeOnly[open] !== '[') continue;
    const close = matchBracket(proj.codeOnly, open);
    if (close < 0) continue;
    found.push({ keyAt, open, close });
    SECTIONS_KEY.lastIndex = open + 1;
  }
  return found;
}

/**
 * The depth-1 entries of the array spanning `[open, close)`.
 *
 * An entry that is an object literal comes back with its `{ … }` span; anything
 * else (a spread, an identifier, an elided `[/* … *\/]`) comes back spanless and
 * is counted but never judged -- it carries no key to require.
 *
 * @param {{ codeOnly: string }} proj
 * @param {number} open
 * @param {number} close
 * @returns {{ start: number, end: number, isObject: boolean }[]}
 */
export function arrayEntries(proj, open, close) {
  const entries = [];
  let depth = 0;
  let start = -1;
  const flush = (end) => {
    if (start < 0) return;
    let s = start;
    let e = end;
    while (s < e && /\s/.test(proj.codeOnly[s])) s++;
    while (e > s && /\s/.test(proj.codeOnly[e - 1])) e--;
    if (s < e) entries.push({ start: s, end: e, isObject: proj.codeOnly[s] === '{' });
    start = -1;
  };
  for (let i = open + 1; i < close - 1; i++) {
    const c = proj.codeOnly[i];
    if (c === '[' || c === '{' || c === '(') {
      if (depth === 0 && start < 0) start = i;
      depth++;
      continue;
    }
    if (c === ']' || c === '}' || c === ')') {
      depth--;
      continue;
    }
    if (depth === 0 && c === ',') {
      flush(i);
      continue;
    }
    if (depth === 0 && start < 0 && !/\s/.test(c)) start = i;
  }
  flush(close - 1);
  return entries;
}

/**
 * Top-level key names of the object literal spanning `[start, end)`.
 *
 * Walks the ORIGINAL body and consults the flags, so a quoted key keeps its
 * spelling (blanking literal content would erase it) while a `name:` inside a
 * nested literal, a string or a comment is never counted.
 *
 * @param {string} body
 * @param {{ codeOnly: string, comment: Uint8Array, literal: Uint8Array }} proj
 * @param {number} start  index of `{`
 * @param {number} end    index just past `}`
 * @returns {string[]}
 */
export function topLevelKeys(body, proj, start, end) {
  const keys = [];
  let depth = 0;
  let i = start + 1;
  while (i < end - 1) {
    const c = proj.codeOnly[i];
    if (c === '[' || c === '{' || c === '(') {
      depth++;
      i++;
      continue;
    }
    if (c === ']' || c === '}' || c === ')') {
      depth--;
      i++;
      continue;
    }
    if (depth !== 0) {
      i++;
      continue;
    }
    // A quoted key: the DELIMITER is code, the spelling is literal content.
    if ((c === "'" || c === '"' || c === '`') && proj.literal[i] === 0) {
      let j = i + 1;
      while (j < end && proj.literal[j] === 1) j++;
      const name = body.slice(i + 1, j);
      i = j + 1;
      if (nextCodeChar(proj, i, end) === ':') keys.push(name);
      continue;
    }
    if (c !== ' ' && c !== '\n' && c !== '\t' && c !== '\r') {
      IDENT.lastIndex = i;
      const m = IDENT.exec(proj.codeOnly);
      if (m) {
        i = IDENT.lastIndex;
        if (nextCodeChar(proj, i, end) === ':') keys.push(m[0]);
        continue;
      }
    }
    i++;
  }
  return keys;
}

/**
 * The next non-space character of `codeOnly` in `[from, end)`, or ''.
 *
 * @param {{ codeOnly: string }} proj
 * @param {number} from
 * @param {number} end
 */
function nextCodeChar(proj, from, end) {
  for (let i = from; i < end; i++) {
    const c = proj.codeOnly[i];
    if (c !== ' ' && c !== '\n' && c !== '\t' && c !== '\r') return c;
  }
  return '';
}

/* ───────────────────────────────── the YAML arm ───────────────────────────── */

/**
 * Parse one YAML fence body and decide whether its tree may be judged.
 *
 * `yaml` recovers from nearly everything, so `docs.length > 0` proves nothing.
 * The verdict is taken from the error CODES -- see the header.
 *
 * @param {string} body
 * @returns {{ judged: boolean, docs: import('yaml').Document[], codes: string[], syntaxCodes: string[] }}
 */
export function classifyYamlFence(body) {
  /** @type {import('yaml').Document[]} */
  let docs;
  try {
    docs = YAML.parseAllDocuments(body);
  } catch {
    // Not reachable through the documented API today, but a throw must land as
    // a SKIP rather than as an exception that takes the whole sweep down.
    return { judged: false, docs: [], codes: ['THREW'], syntaxCodes: ['THREW'] };
  }
  const codes = docs.flatMap((doc) => doc.errors.map((e) => e.code));
  const syntaxCodes = codes.filter((code) => !SEMANTIC_ERROR_CODES.has(code));
  const empty = docs.length === 0 || docs.every((doc) => doc.contents == null);
  return {
    judged: !empty && syntaxCodes.length === 0,
    docs,
    codes: [...new Set(codes)],
    syntaxCodes: [...new Set(empty && syntaxCodes.length === 0 ? ['NO_DOCUMENT'] : syntaxCodes)],
  };
}

/**
 * Visit every node of a `yaml` AST, pairs included.
 *
 * @param {unknown} node
 * @param {(pair: import('yaml').Pair) => void} visit
 */
function walkYaml(node, visit) {
  if (node == null || typeof node !== 'object') return;
  if (YAML.isDocument(node)) {
    walkYaml(node.contents, visit);
    return;
  }
  if (YAML.isSeq(node)) {
    for (const item of node.items) walkYaml(item, visit);
    return;
  }
  if (YAML.isMap(node)) {
    for (const pair of node.items) {
      visit(pair);
      walkYaml(pair.key, visit);
      walkYaml(pair.value, visit);
    }
    return;
  }
  if (YAML.isPair(node)) {
    visit(node);
    walkYaml(node.key, visit);
    walkYaml(node.value, visit);
  }
}

/**
 * The 1-based line of `offset` within `body`.
 *
 * @param {string} body
 * @param {number} offset
 */
function yamlLine(body, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < body.length; i++) if (body[i] === '\n') line++;
  return line;
}

/**
 * Every section MAPPING under every `sections:` sequence in one parsed fence.
 *
 * A `sections:` whose value is not a sequence is not this shape and is passed
 * over. A sequence ITEM that is not a mapping -- a scalar, an alias, a nested
 * sequence -- is COUNTED and never judged: it carries no key to require, the
 * same treatment `arrayEntries` gives a spread or an elision on the TS side.
 *
 * @param {string} body
 * @param {import('yaml').Document[]} docs
 * @returns {{ mappings: {offset:number,line:number,named:boolean,label:string|null,excerpt:string}[], nonMappingItems: number }}
 */
export function yamlSectionMappings(body, docs) {
  const mappings = [];
  let nonMappingItems = 0;
  for (const doc of docs) {
    walkYaml(doc, (pair) => {
      const key = pair.key;
      if (!key || typeof key !== 'object' || key.value !== 'sections') return;
      if (!YAML.isSeq(pair.value)) return;
      for (const item of pair.value.items) {
        if (!YAML.isMap(item)) {
          nonMappingItems++;
          continue;
        }
        const keys = item.items.map((p) => (p.key && typeof p.key === 'object' ? p.key.value : undefined));
        const labelPair = item.items.find((p) => p.key && typeof p.key === 'object' && p.key.value === 'label');
        const labelValue = labelPair && labelPair.value && typeof labelPair.value === 'object' ? labelPair.value.value : null;
        const offset = Array.isArray(item.range) ? item.range[0] : 0;
        mappings.push({
          offset,
          line: yamlLine(body, offset),
          named: keys.includes('name'),
          label: typeof labelValue === 'string' ? labelValue : null,
          excerpt: yamlExcerpt(body, offset),
        });
      }
    });
  }
  return { mappings, nonMappingItems };
}

/**
 * The mapping's first line, widened left to its `- ` bullet so the excerpt
 * reads like the source rather than starting mid-item.
 */
function yamlExcerpt(body, offset) {
  let start = offset;
  while (start > 0 && body[start - 1] !== '\n') start--;
  const nl = body.indexOf('\n', offset);
  const stop = nl < 0 ? body.length : nl;
  const text = body.slice(start, stop).trim();
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

/* ──────────────────────────────── the sweep ───────────────────────────────── */

/**
 * `sections` as a YAML KEY. The same leading class as `SECTIONS_KEY` keeps
 * `_sections:` and a `.sections` member out; it only decides whether a fence is
 * worth PARSING, and the AST -- never this regex -- decides what is judged.
 */
const YAML_SECTIONS_KEY = /(^|[^A-Za-z0-9_$.])sections\s*:/m;

/**
 * @param {string} root
 * @returns {{
 *   files: string[], tsFences: number,
 *   arrays: number, literals: number, nonObjectEntries: number,
 *   yamlFences: number, yamlJudgedFences: number, yamlNonMappingItems: number,
 *   yamlSkipped: {file:string,line:number,codes:string[]}[],
 *   yamlRecovered: {file:string,line:number,codes:string[]}[],
 *   yamlSites: {file:string,line:number,label:string|null,named:boolean}[],
 *   sites: {file:string,line:number,label:string|null,named:boolean}[],
 *   findings: {file:string,line:number,label:string|null,excerpt:string,kind:'ts'|'yaml'}[],
 * }}
 */
export function sweep(root) {
  const files = docsFiles(root);
  let tsFences = 0;
  let arrays = 0;
  let literals = 0;
  let nonObjectEntries = 0;
  let yamlFences = 0;
  let yamlJudgedFences = 0;
  let yamlNonMappingItems = 0;
  const yamlSkipped = [];
  const yamlRecovered = [];
  const yamlSites = [];
  const sites = [];
  const findings = [];

  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const block of fencedBlocks(text)) {
      if (YAML_FENCE_LANGS.has(block.lang)) {
        if (!YAML_SECTIONS_KEY.test(block.body)) continue;
        yamlFences++;
        const parsed = classifyYamlFence(block.body);
        if (!parsed.judged) {
          yamlSkipped.push({ file, line: block.line, codes: parsed.syntaxCodes });
          continue;
        }
        yamlJudgedFences++;
        if (parsed.codes.length > 0) yamlRecovered.push({ file, line: block.line, codes: parsed.codes });
        const { mappings, nonMappingItems } = yamlSectionMappings(block.body, parsed.docs);
        yamlNonMappingItems += nonMappingItems;
        for (const mapping of mappings) {
          const line = block.line + mapping.line - 1;
          yamlSites.push({ file, line, label: mapping.label, named: mapping.named });
          if (!mapping.named) {
            findings.push({ file, line, label: mapping.label, excerpt: mapping.excerpt, kind: 'yaml' });
          }
        }
        continue;
      }
      if (!TS_FENCE_LANGS.has(block.lang)) continue;
      tsFences++;
      if (!block.body.includes('sections')) continue;
      const proj = project(block.body);
      for (const array of sectionArrays(block.body, proj)) {
        arrays++;
        for (const entry of arrayEntries(proj, array.open, array.close)) {
          if (!entry.isObject) {
            nonObjectEntries++;
            continue;
          }
          literals++;
          const keys = topLevelKeys(block.body, proj, entry.start, entry.end);
          const line = block.line + countNewlines(block.body, entry.start);
          const label = literalKeyValue(block.body, proj, entry.start, entry.end, 'label');
          const named = keys.includes('name');
          sites.push({ file, line, label, named });
          if (!named) {
            findings.push({ file, line, label, excerpt: firstLine(block.body, entry.start, entry.end), kind: 'ts' });
          }
        }
      }
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return {
    files, tsFences, arrays, literals, nonObjectEntries,
    yamlFences, yamlJudgedFences, yamlNonMappingItems, yamlSkipped, yamlRecovered, yamlSites,
    sites, findings,
  };
}

/** Newlines in `body` before `index` -- a 0-based offset onto a fence's start line. */
function countNewlines(body, index) {
  let n = 0;
  for (let i = 0; i < index; i++) if (body[i] === '\n') n++;
  return n;
}

/** The literal's first line, trimmed and clipped, for a readable finding. */
function firstLine(body, start, end) {
  const nl = body.indexOf('\n', start);
  const stop = nl < 0 || nl > end ? end : nl;
  const text = body.slice(start, stop).trim();
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

/**
 * The string value of a top-level `key`, when it is a plain string literal.
 * Best-effort and presentational -- it feeds the finding text, never a verdict.
 */
function literalKeyValue(body, proj, start, end, key) {
  const re = new RegExp(`(^|[^A-Za-z0-9_$.])(['"\`]?)${key}\\2\\s*:\\s*(['"\`])`, 'g');
  const slice = body.slice(start, end);
  let m;
  while ((m = re.exec(slice)) !== null) {
    const quoteAt = start + m.index + m[0].length - 1;
    let j = quoteAt + 1;
    while (j < end && proj.literal[j] === 1) j++;
    return body.slice(quoteAt + 1, j);
  }
  return null;
}

/* ───────────────────────────── census refusals ────────────────────────────── */

/**
 * Every reason this sweep's verdict would be about a population nobody
 * configured. Non-empty means REFUSE, never "clean".
 *
 * @param {ReturnType<typeof sweep>} result
 * @returns {string[]}
 */
export function censusFailures(result) {
  const failures = [];
  if (result.files.length < FLOOR_FILES) {
    failures.push(
      `scanned ${result.files.length} docs file(s); floor is ${FLOOR_FILES}. `
      + `A sweep over a corpus that shrank by an order of magnitude is not this repo's docs tree.`,
    );
  }
  if (result.tsFences < FLOOR_TS_FENCES) {
    failures.push(
      `found ${result.tsFences} TS-family fence(s); floor is ${FLOOR_TS_FENCES}. `
      + `The fence extractor stopped reaching the corpus -- a language tag changed, or the fence walker broke.`,
    );
  }
  if (result.arrays < FLOOR_SECTION_ARRAYS) {
    failures.push(
      `found ${result.arrays} \`sections: [\` array(s); floor is ${FLOOR_SECTION_ARRAYS}. `
      + `This is the selector that both earlier hand-passes got wrong; a collapse here means it broke again.`,
    );
  }
  if (result.literals < FLOOR_SECTION_LITERALS) {
    failures.push(
      `judged ${result.literals} section object literal(s); floor is ${FLOOR_SECTION_LITERALS}. `
      + `A green over an evaporated corpus is the exact failure this gate exists to make impossible.`,
    );
  }
  if (result.yamlFences < FLOOR_YAML_FENCES) {
    failures.push(
      `found ${result.yamlFences} YAML fence(s) carrying \`sections:\`; floor is ${FLOOR_YAML_FENCES}. `
      + `The YAML arm stopped reaching its corpus -- a language tag changed, or the fence walker broke.`,
    );
  }
  if (result.yamlSites.length < FLOOR_YAML_SECTIONS) {
    failures.push(
      `judged ${result.yamlSites.length} YAML section mapping(s); floor is ${FLOOR_YAML_SECTIONS}. `
      + `A YAML arm that parses fences and finds nothing in them is the failure this gate exists to make impossible: `
      + `the parse succeeded, so a silent zero here reads exactly like a clean corpus.`,
    );
  }
  const judgedFiles = new Set(result.sites.map((s) => s.file));
  for (const anchor of CENSUS_ANCHORS) {
    if (!judgedFiles.has(anchor)) {
      failures.push(
        `census anchor contributed nothing to the sweep: ${anchor} `
        + `(the defect was measured and repaired there -- if it no longer contributes, the selector moved, not the docs).`,
      );
    }
  }
  const yamlFiles = new Set(result.yamlSites.map((s) => s.file));
  for (const anchor of YAML_CENSUS_ANCHORS) {
    if (!yamlFiles.has(anchor)) {
      failures.push(
        `YAML census anchor contributed no section mapping: ${anchor} `
        + `(#11887's whole population lived on this page -- if it no longer contributes, the YAML arm moved, not the docs).`,
      );
    }
  }
  return failures;
}

/* ──────────────────────────────── the gate ────────────────────────────────── */

const CONVENTION =
  "add `name: '<snake_case>'` as the literal's first key, derived from its label "
  + '(`label: \'Basic Information\'` -> `name: \'basic_information\'`)';

const CONVENTION_YAML =
  'add `name: <snake_case>` as the mapping\'s first key, derived from its label '
  + '(`label: Basic Information` -> `name: basic_information`)';

/**
 * @param {string} root
 * @param {(s: string) => void} log
 * @returns {number} exit code
 */
export function run(root = REPO_ROOT, log = console.error) {
  if (!existsSync(join(root, DOCS_ROOT))) {
    log(`✗ check-docs-section-name: declared root \`${DOCS_ROOT}\` is absent — REFUSING to report a verdict`);
    log('  A verdict over a corpus that did not resolve is a verdict about nothing.');
    return EXIT_REFUSED;
  }
  const result = sweep(root);
  const census =
    `${result.files.length} docs file(s) · ${result.tsFences} TS-family fence(s) · `
    + `${result.arrays} \`sections: [\` array(s) · ${result.literals} section literal(s) JUDGED`
    + (result.nonObjectEntries ? ` · ${result.nonObjectEntries} non-object entry(ies) skipped` : '')
    + ` · ${result.yamlFences} YAML fence(s) (${result.yamlJudgedFences} parsed, `
    + `${result.yamlSkipped.length} skipped on a syntax error) · `
    + `${result.yamlSites.length} YAML section mapping(s) JUDGED`
    + (result.yamlNonMappingItems ? ` · ${result.yamlNonMappingItems} non-mapping item(s) skipped` : '');

  const problems = censusFailures(result);
  if (problems.length > 0) {
    log(`✗ check-docs-section-name: REFUSING to report a verdict — ${census}`);
    log('');
    for (const problem of problems) log(`  ${problem}`);
    log('');
    log('  This is not a finding about the docs. It is this gate declining to call an');
    log('  unreachable population clean — the failure mode #10830 is about, one level up.');
    return EXIT_REFUSED;
  }

  if (result.findings.length > 0) {
    log(`✗ check-docs-section-name: ${result.findings.length} form-section example(s) in content/docs/** have no \`name\``);
    log('');
    for (const finding of result.findings) {
      log(`  ${finding.file}:${finding.line}`);
      log(`    ${finding.excerpt}`);
      log(
        `    a nameless section has no i18n anchor — its heading resolves through`
        + ` \`objects.<object>._sections.<name>.label\`, so it renders`,
      );
      log(`    ${finding.label ? `"${finding.label}"` : 'its authored label'} in EVERY locale.`);
      log(`    fix: ${finding.kind === 'yaml' ? CONVENTION_YAML : CONVENTION}`);
      log('');
    }
    log('  ⛔ Do NOT "fix" this by making `name` required in packages/spec — a nameless');
    log('     section is legal metadata (settled in #10709). This rule is about EXAMPLES.');
    log(`  ${census}`);
    return EXIT_VIOLATIONS;
  }

  log(`✓ check-docs-section-name: 0 nameless form-section examples — ${census}`);
  log(
    `  ⚠️ The violating population is empty, but ${result.literals} section literal(s) and `
    + `${result.yamlSites.length} YAML`,
  );
  log(
    '     section mapping(s) were JUDGED across '
    + new Set([...result.sites, ...result.yamlSites].map((s) => s.file)).size
    + ' page(s) — run --list to see every one.',
  );
  log('     A zero that names its population reads differently from a zero that names nothing;');
  log('     non-vacuity is carried by --self-test, which drives this same sweep RED on disk.');
  if (result.yamlRecovered.length > 0) {
    log(
      `  ⚠️ ${result.yamlRecovered.length} YAML fence(s) carry a SEMANTIC parser error and were judged anyway —`,
    );
    log('     a duplicate key is a complete tree, not a guessed one (teaching fences concatenate snippets).');
  }
  if (result.yamlSkipped.length > 0) {
    log(
      `  ⚠️ ${result.yamlSkipped.length} YAML fence(s) carry \`sections:\` and are NOT judged — the parser`,
    );
    log('     recovered by guessing, so any finding drawn from that tree could be fabricated.');
    for (const fence of result.yamlSkipped) log(`       ${fence.file}:${fence.line}  [${fence.codes.join(',')}]`);
  } else {
    log('  ⚠️ 0 YAML fence(s) skipped on a syntax error — that boundary has NO live population,');
    log('     so it is carried by --self-test rather than by this corpus.');
  }
  return EXIT_CLEAN;
}

/* ──────────────────────────────── --list ──────────────────────────────────── */

function list(root = REPO_ROOT, log = console.log) {
  const result = sweep(root);
  log(`docs files scanned      : ${result.files.length}`);
  log(`TS-family fences        : ${result.tsFences}`);
  log(`\`sections: [\` arrays    : ${result.arrays}`);
  log(`section literals JUDGED : ${result.literals}`);
  log(`non-object entries      : ${result.nonObjectEntries}   (spreads / elisions — no key to require)`);
  log(`YAML fences w/ sections : ${result.yamlFences}   (${result.yamlJudgedFences} parsed, ${result.yamlSkipped.length} skipped on a syntax error)`);
  log(`YAML mappings JUDGED    : ${result.yamlSites.length}`);
  log(`YAML non-mapping items  : ${result.yamlNonMappingItems}   (scalars / aliases — no key to require)`);
  log(`violations              : ${result.findings.length}`);
  log('');
  log('every section object literal this gate judged (TS arm):');
  let current = '';
  for (const site of result.sites) {
    if (site.file !== current) {
      current = site.file;
      log(`  ${current}`);
    }
    log(`    :${site.line}  ${site.named ? '✓ named' : '✗ NAMELESS'}  ${site.label ? `label=${JSON.stringify(site.label)}` : '(no label key)'}`);
  }
  log('');
  log('every YAML section mapping this gate judged (YAML arm):');
  current = '';
  for (const site of result.yamlSites) {
    if (site.file !== current) {
      current = site.file;
      log(`  ${current}`);
    }
    log(`    :${site.line}  ${site.named ? '✓ named' : '✗ NAMELESS'}  ${site.label ? `label=${JSON.stringify(site.label)}` : '(no label key)'}`);
  }
  if (result.yamlRecovered.length > 0) {
    log('');
    log('YAML fences judged despite a SEMANTIC parser error (complete tree, nothing guessed):');
    for (const fence of result.yamlRecovered) log(`  ${fence.file}:${fence.line}  [${fence.codes.join(',')}]`);
  }
  log('');
  log(`YAML fences SKIPPED on a syntax error — counted so the boundary is visible (${result.yamlSkipped.length}):`);
  for (const fence of result.yamlSkipped) log(`  ${fence.file}:${fence.line}  [${fence.codes.join(',')}]`);
  return EXIT_CLEAN;
}

/* ─────────────────────────────── --self-test ──────────────────────────────── */

/**
 * A fixture tree with enough real shape to clear every floor, so the self-test
 * exercises the VERDICT and not just the refusals.
 *
 * @param {Record<string, string>} files
 * @returns {string} the temp root
 */
function makeFixtureTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-section-name-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const FENCE = '```';

/** One page carrying `count` named section literals in a TS fence. */
function namedPage(count) {
  const literals = Array.from({ length: count }, (_, i) => `      { name: 's${i}', label: 'S${i}', fields: ['a'] },`).join('\n');
  return `# page\n\n${FENCE}ts\nexport const v = defineView({\n  form: {\n    sections: [\n${literals}\n    ],\n  },\n});\n${FENCE}\n`;
}

/**
 * One page carrying `count` NAMED section mappings in each of two YAML fences
 * -- one at the document root, one nested under `layout:`, so the fixture
 * exercises the AST walk rather than a top-level lookup.
 */
function yamlPage(count) {
  const items = (p, indent) =>
    Array.from({ length: count }, (_, i) => `${indent}- name: ${p}${i}\n${indent}  label: ${p.toUpperCase()}${i}\n${indent}  fields: [a]`).join('\n');
  return `# page\n\n${FENCE}yaml\nsections:\n${items('a', '  ')}\n${FENCE}\n\n`
    + `${FENCE}yaml\nlayout:\n  sections:\n${items('b', '    ')}\n${FENCE}\n`;
}

/** Filler pages so the file and fence floors are cleared by REAL files. */
function fillerPages(from, to) {
  /** @type {Record<string,string>} */
  const out = {};
  for (let i = from; i < to; i++) {
    out[`${DOCS_ROOT}/filler/p${i}.mdx`] = `# f${i}\n\n${FENCE}ts\nexport const x${i} = 1;\n${FENCE}\n`;
  }
  return out;
}

/**
 * @param {Record<string,string>} [extra]
 * @returns {Record<string,string>}
 */
function baseFixtureFiles(extra = {}) {
  return {
    ...fillerPages(0, FLOOR_FILES + 8),
    [CENSUS_ANCHORS[0]]: namedPage(6),
    [CENSUS_ANCHORS[1]]: namedPage(6),
    [CENSUS_ANCHORS[2]]: namedPage(6),
    [YAML_CENSUS_ANCHORS[0]]: yamlPage(3),
    [YAML_CENSUS_ANCHORS[1]]: yamlPage(3),
    [YAML_CENSUS_ANCHORS[2]]: yamlPage(3),
    [`${DOCS_ROOT}/extra/a.mdx`]: namedPage(3),
    [`${DOCS_ROOT}/extra/b.mdx`]: namedPage(3),
    [`${DOCS_ROOT}/extra/c.mdx`]: namedPage(3),
    [`${DOCS_ROOT}/extra/d.mdx`]: namedPage(3),
    [`${DOCS_ROOT}/extra/e.mdx`]: namedPage(3),
    ...extra,
  };
}

export function selfTest() {
  const cases = [];
  const trees = [];
  /** @param {string} name @param {unknown} actual @param {unknown} expected */
  const t = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const tree = (files) => {
    const root = makeFixtureTree(files);
    trees.push(root);
    return root;
  };
  const quiet = () => {};

  // ⛔ Never index a finding without a fallback. Under ablation the findings
  // array goes EMPTY, and `findings[0].file` then throws a TypeError — a red
  // that reads exactly like proof while proving only that the harness crashed.
  // Measured: the first ablation run of this gate reddened all three legs by
  // TypeError, and not one of them exercised the assertion it was written for.
  const NONE = '(no finding — the sweep returned an EMPTY set)';
  const at = (f) => (f ? `${f.file}:${f.line}` : NONE);

  try {
    // ── the happy path: a real tree, real fences, real floors ───────────────
    const clean = tree(baseFixtureFiles());
    t('a clean corpus passes', run(clean, quiet), EXIT_CLEAN);
    const cleanSweep = sweep(clean);
    t('...and it judged the literals rather than skipping them', cleanSweep.literals, 33);
    t('...over the anchors plus the extras', new Set(cleanSweep.sites.map((s) => s.file)).size, 8);

    // ── THE case: one planted nameless section reds the real sweep ──────────
    const planted = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/a.mdx`]:
          `# a\n\n${FENCE}ts\nexport const v = defineView({\n  form: {\n    sections: [\n      { name: 's0', label: 'S0' },\n      { label: 'Nameless' },\n      { name: 's2', label: 'S2' },\n    ],\n  },\n});\n${FENCE}\n`,
      }),
    );
    t('a planted nameless section reds', run(planted, quiet), EXIT_VIOLATIONS);
    const plantedSweep = sweep(planted);
    t('...naming exactly one site', plantedSweep.findings.length, 1);
    t('...at the right file and line', at(plantedSweep.findings[0]), `${DOCS_ROOT}/extra/a.mdx:8`);
    t('...carrying its label into the message', plantedSweep.findings[0]?.label ?? NONE, 'Nameless');

    // ── the spelling that defeated #10709: `sections: [{` on one line ───────
    const inline = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/b.mdx`]: `# b\n\n${FENCE}ts\nconst f = { sections: [{ label: 'Inline' }, { name: 'ok', label: 'Ok' }] };\n${FENCE}\n`,
      }),
    );
    t('an inline `sections: [{` is judged (the #10709 miss)', sweep(inline).findings.length, 1);
    t('...and the inline page reds', run(inline, quiet), EXIT_VIOLATIONS);

    // ── the spelling that defeated #10579: a multi-line literal ─────────────
    const multi = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/c.mdx`]:
          `# c\n\n${FENCE}ts\nconst f = {\n  sections: [\n    {\n      label: 'Spread',\n      fields: [\n        'a',\n      ],\n    },\n  ],\n};\n${FENCE}\n`,
      }),
    );
    t('a multi-line literal is judged (the #10579 miss)', sweep(multi).findings.length, 1);

    // ── negative controls: the population must NOT grow by fabrication ──────
    const negatives = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/d.mdx`]:
          `# d\n\n${FENCE}ts\n`
          + `const t = { _sections: { basic_info: { label: 'x' } } };\n`
          + `const u = view.sections;\n`
          + `const w = { mySections: [{ label: 'not a section array' }] };\n`
          + `// sections: [{ label: 'commented out' }]\n`
          + `const s = "sections: [{ label: 'in a string' }]";\n`
          + `${FENCE}\n`,
      }),
    );
    const negSweep = sweep(negatives);
    t('`_sections`, `.sections`, `mySections`, a comment and a string contribute nothing', negSweep.findings.length, 0);
    t('...and no array either', negSweep.arrays, cleanSweep.arrays - 1);

    // ── the YAML arm (#11887) — the two cases that used to sit here, INVERTED
    //
    // Until #11887 this exact fixture pinned `outOfScopeFences === 1` and
    // `findings === 0`: a YAML `sections:` fence was COUNTED and never judged.
    // The arm makes both of those wrong by design. They are REPLACED rather
    // than deleted, in place, so the inversion is legible to the next reader
    // instead of looking like coverage that quietly went missing.
    t('the base fixture clears the YAML floors', cleanSweep.yamlSites.length, 18);
    t('...over two fences per anchor page', cleanSweep.yamlFences, 6);
    t('...and the nested `layout: sections:` mappings are reached too', cleanSweep.yamlSites.filter((s) => /^b/.test(String(s.label ?? '').toLowerCase())).length, 9);

    const yamlNameless = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/yaml-case.mdx`]: `# e\n\n${FENCE}yaml\nform:\n  sections:\n    - label: Nameless\n      fields: [a]\n${FENCE}\n`,
      }),
    );
    const yamlNamelessSweep = sweep(yamlNameless);
    t('a YAML `sections:` fence is now PARSED, not declared out of scope', yamlNamelessSweep.yamlFences, cleanSweep.yamlFences + 1);
    t('...and its nameless mapping is JUDGED', yamlNamelessSweep.yamlSites.length, cleanSweep.yamlSites.length + 1);
    t('...producing exactly one finding', yamlNamelessSweep.findings.length, 1);
    t('...at the right file and line', at(yamlNamelessSweep.findings[0]), `${DOCS_ROOT}/extra/yaml-case.mdx:6`);
    t('...carrying its label into the message', yamlNamelessSweep.findings[0]?.label ?? NONE, 'Nameless');
    t('...tagged `yaml` so the fix text is YAML-shaped', yamlNamelessSweep.findings[0]?.kind ?? NONE, 'yaml');
    t('...and the real sweep goes RED on it', run(yamlNameless, quiet), EXIT_VIOLATIONS);

    const yamlNamed = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/yaml-case.mdx`]: `# e\n\n${FENCE}yaml\nform:\n  sections:\n    - name: ok\n      label: Ok\n${FENCE}\n`,
      }),
    );
    t('a NAMED YAML mapping satisfies the rule', run(yamlNamed, quiet), EXIT_CLEAN);

    // ── ⭐ a DUPLICATE-KEY fence: a complete tree, judged anyway ─────────────
    // The shape a teaching page produces when it concatenates two snippets
    // into one fence. A `toJS()` walk would collapse these to ONE `layout:`
    // and never see the second block; the AST keeps both pairs. On the real
    // corpus this is not hypothetical — two pages do it.
    const dupKey = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/yaml-case.mdx`]:
          `# e\n\n${FENCE}yaml\n# snippet one\nlayout:\n  sections:\n    - label: First\n      fields: [a]\n\n`
          + `# snippet two\nlayout:\n  sections:\n    - label: Second\n      fields: [b]\n${FENCE}\n`,
      }),
    );
    const dupSweep = sweep(dupKey);
    t('a duplicate-key fence is a SEMANTIC error, so it is judged', dupSweep.yamlSkipped.length, 0);
    t('...and reported as a recovered fence rather than silently', dupSweep.yamlRecovered.length, 1);
    t('...with BOTH snippets judged (a `toJS()` walk sees one)', dupSweep.findings.length, 2);
    t('...naming the snippet a collapsing walk would have lost', dupSweep.findings[1]?.label ?? NONE, 'Second');
    t('...and the gate reds on both', run(dupKey, quiet), EXIT_VIOLATIONS);

    // ── ⭐ a SYNTAX-error fence: counted, printed, NEVER judged ──────────────
    // This is the decision #10830 deferred and #11887 made. It has NO live
    // population on the tree the arm landed against, so this fixture is the
    // only thing holding the boundary — which is exactly why it is here.
    const badYaml = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/yaml-case.mdx`]:
          `# e\n\n${FENCE}yaml\nlayout:\n  sections:\n    - label: Elided\n      …\n    - label: Also nameless\n${FENCE}\n`,
      }),
    );
    const badSweep = sweep(badYaml);
    t('a fence the parser had to GUESS at is skipped', badSweep.yamlSkipped.length, 1);
    t('...and the skip names the parser code, not just a count', badSweep.yamlSkipped[0]?.codes?.[0] ?? NONE, 'MISSING_CHAR');
    t('...it contributes no finding, however nameless it looks', badSweep.findings.length, 0);
    t('...but IS counted, so the boundary is a measurement not a silence', badSweep.yamlFences, cleanSweep.yamlFences + 1);
    t('...and the gate stays clean rather than fabricating from a guessed tree', run(badYaml, quiet), EXIT_CLEAN);

    // ── negative controls: the YAML population must not grow by fabrication ─
    const yamlNegatives = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/yaml-case.mdx`]:
          `# e\n\n${FENCE}yaml\n`
          + `_sections:\n  basic_info:\n    label: x\n`
          + `mySections:\n  - label: not a section list\n`
          + `sections: a scalar, not a sequence\n`
          + `${FENCE}\n`,
      }),
    );
    const yamlNegSweep = sweep(yamlNegatives);
    t('`_sections`, `mySections` and a scalar `sections:` contribute no finding', yamlNegSweep.findings.length, 0);
    t('...and no YAML mapping either', yamlNegSweep.yamlSites.length, cleanSweep.yamlSites.length);

    const yamlScalarItems = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/yaml-case.mdx`]:
          `# e\n\n${FENCE}yaml\nsections:\n  - just_a_string\n  - name: ok\n    label: Ok\n${FENCE}\n`,
      }),
    );
    const scalarSweep = sweep(yamlScalarItems);
    t('a scalar `sections:` item is counted, never judged', scalarSweep.yamlNonMappingItems, 1);
    t('...and produces no finding — it carries no key to require', scalarSweep.findings.length, 0);

    // ── classifyYamlFence, directly ────────────────────────────────────────
    t('a clean fence is judged', classifyYamlFence('sections:\n  - name: a\n').judged, true);
    t('a duplicate key is judged', classifyYamlFence('a:\n  b: 1\na:\n  b: 2\n').judged, true);
    t('a tab indent is NOT judged', classifyYamlFence('a:\n\tb: 1\n').judged, false);
    t('an empty fence is NOT judged', classifyYamlFence('').judged, false);

    // ── the YAML refusals ──────────────────────────────────────────────────
    t(
      'a corpus whose YAML fences evaporated refuses',
      run(
        tree(baseFixtureFiles(Object.fromEntries(YAML_CENSUS_ANCHORS.map((a) => [a, '# gone\n'])))),
        quiet,
      ),
      EXIT_REFUSED,
    );
    t(
      'a YAML anchor kept as a file but emptied of mappings refuses',
      run(tree(baseFixtureFiles({ [YAML_CENSUS_ANCHORS[1]]: `# kept\n\n${FENCE}yaml\nfoo: bar\n${FENCE}\n` })), quiet),
      EXIT_REFUSED,
    );

    // ── a quoted key cannot escape the rule ────────────────────────────────
    const quoted = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/a.mdx`]: `# a\n\n${FENCE}ts\nconst f = { 'sections': [{ 'label': 'Quoted' }, { 'name': 'ok', 'label': 'Ok' }] };\n${FENCE}\n`,
      }),
    );
    const quotedSweep = sweep(quoted);
    t('a quoted `sections` key is still an array', quotedSweep.arrays, cleanSweep.arrays);
    t('a quoted `name` key still satisfies the rule', quotedSweep.findings.length, 1);
    t('...and it is the unnamed one', quotedSweep.findings[0]?.label ?? NONE, 'Quoted');

    // ── the refusals: each is a broken selector wearing a pass ──────────────
    t('a missing docs root refuses', run(join(tree({}), 'nowhere'), quiet), EXIT_REFUSED);
    t('an empty docs root refuses', run(tree({ [`${DOCS_ROOT}/.keep`]: '' }), quiet), EXIT_REFUSED);
    t(
      'a corpus with files but no TS fences refuses',
      run(
        tree(
          Object.fromEntries(
            Array.from({ length: FLOOR_FILES + 8 }, (_, i) => [`${DOCS_ROOT}/p${i}.mdx`, `# p${i}\n\ntext only\n`]),
          ),
        ),
        quiet,
      ),
      EXIT_REFUSED,
    );
    t(
      'a corpus whose section arrays evaporated refuses',
      run(tree({ ...fillerPages(0, FLOOR_FILES + 8) }), quiet),
      EXIT_REFUSED,
    );
    t(
      'a corpus that clears the floors but drops an anchor refuses',
      run(tree(baseFixtureFiles({ [CENSUS_ANCHORS[2]]: '# moved\n' })), quiet),
      EXIT_REFUSED,
    );
    t(
      'an anchor kept as a file but emptied of literals still refuses',
      run(tree(baseFixtureFiles({ [CENSUS_ANCHORS[0]]: `# kept\n\n${FENCE}ts\nconst x = 1;\n${FENCE}\n` })), quiet),
      EXIT_REFUSED,
    );

    // ── the matcher, directly ──────────────────────────────────────────────
    const src = "const a = { s: ['[', {x: 1}] };";
    t('a bracket inside a string does not move the match', matchBracket(project(src).codeOnly, src.indexOf('[')), src.lastIndexOf(']') + 1);
    t('an unbalanced array returns -1', matchBracket(project('const a = [1, 2').codeOnly, 10), -1);
  } finally {
    for (const root of trees) rmSync(root, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) if (!c.ok) console.error(`  ✗ ${c.name} — ${c.detail}`);
  if (failed.length) {
    console.error(`✗ check-docs-section-name self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-docs-section-name self-test: ${cases.length} cases pass `
    + '(real temp trees on disk; both historical misses reproduced as RED, both arms driven RED, '
    + 'the duplicate-key and syntax-error boundaries pinned, every refusal exercised).',
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  else if (process.argv.includes('--list')) process.exit(list());
  else process.exit(run());
}
