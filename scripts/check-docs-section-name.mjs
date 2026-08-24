#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-docs-section-name (#10830) -- every form-section object literal in a
 * TypeScript fence under `content/docs/**` must carry a `name`.
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
 * ## The scope boundary is DECLARED, not silent
 *
 * TS-family fences only (see `TS_FENCE_LANGS`) -- the bracket matcher reads
 * object literals, and a YAML `sections:` block is a different syntax that the
 * matcher would misread rather than judge. YAML fences carrying `sections:` are
 * COUNTED and PRINTED in the verdict as a declared out-of-scope population, so
 * the boundary is a measurement rather than a silence. (Today: a real
 * population, filed separately -- widening this gate to YAML is a different
 * parser, not a bigger regex.)
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
 * Fence languages that carry `sections:` in a syntax this matcher does not
 * read. COUNTED and reported, never judged -- see the header's scope note.
 */
export const OUT_OF_SCOPE_LANGS = new Set(['yaml', 'yml']);

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

/* ──────────────────────────────── the sweep ───────────────────────────────── */

/**
 * @param {string} root
 * @returns {{
 *   files: string[], tsFences: number, outOfScopeFences: {file:string,line:number}[],
 *   arrays: number, literals: number, nonObjectEntries: number,
 *   sites: {file:string,line:number,label:string|null,named:boolean}[],
 *   findings: {file:string,line:number,label:string|null,excerpt:string}[],
 * }}
 */
export function sweep(root) {
  const files = docsFiles(root);
  let tsFences = 0;
  let arrays = 0;
  let literals = 0;
  let nonObjectEntries = 0;
  const outOfScopeFences = [];
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
      if (OUT_OF_SCOPE_LANGS.has(block.lang) && /(^|[^A-Za-z0-9_$.])sections\s*:/m.test(block.body)) {
        outOfScopeFences.push({ file, line: block.line });
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
            findings.push({ file, line, label, excerpt: firstLine(block.body, entry.start, entry.end) });
          }
        }
      }
    }
  }
  return { files, tsFences, outOfScopeFences, arrays, literals, nonObjectEntries, sites, findings };
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
  const judgedFiles = new Set(result.sites.map((s) => s.file));
  for (const anchor of CENSUS_ANCHORS) {
    if (!judgedFiles.has(anchor)) {
      failures.push(
        `census anchor contributed nothing to the sweep: ${anchor} `
        + `(the defect was measured and repaired there -- if it no longer contributes, the selector moved, not the docs).`,
      );
    }
  }
  return failures;
}

/* ──────────────────────────────── the gate ────────────────────────────────── */

const CONVENTION =
  "add `name: '<snake_case>'` as the literal's first key, derived from its label "
  + '(`label: \'Basic Information\'` -> `name: \'basic_information\'`)';

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
    + ` · ${result.outOfScopeFences.length} YAML fence(s) declared out of scope`;

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
      log(`    fix: ${CONVENTION}`);
      log('');
    }
    log('  ⛔ Do NOT "fix" this by making `name` required in packages/spec — a nameless');
    log('     section is legal metadata (settled in #10709). This rule is about EXAMPLES.');
    log(`  ${census}`);
    return EXIT_VIOLATIONS;
  }

  log(`✓ check-docs-section-name: 0 nameless form-section examples — ${census}`);
  log(
    `  ⚠️ The violating population is empty, but ${result.literals} section literal(s) were JUDGED`,
  );
  log('     across ' + new Set(result.sites.map((s) => s.file)).size + ' page(s) — run --list to see every one.');
  log('     A zero that names its population reads differently from a zero that names nothing;');
  log('     non-vacuity is carried by --self-test, which drives this same sweep RED on disk.');
  if (result.outOfScopeFences.length > 0) {
    log(
      `  ⚠️ ${result.outOfScopeFences.length} YAML fence(s) carry \`sections:\` and are NOT judged — a YAML`,
    );
    log('     block is a different syntax, not a bigger regex. Declared, counted, and out of scope.');
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
  log(`violations              : ${result.findings.length}`);
  log(`YAML fences out of scope: ${result.outOfScopeFences.length}`);
  log('');
  log('every section object literal this gate judged:');
  let current = '';
  for (const site of result.sites) {
    if (site.file !== current) {
      current = site.file;
      log(`  ${current}`);
    }
    log(`    :${site.line}  ${site.named ? '✓ named' : '✗ NAMELESS'}  ${site.label ? `label=${JSON.stringify(site.label)}` : '(no label key)'}`);
  }
  if (result.outOfScopeFences.length > 0) {
    log('');
    log('YAML fences carrying `sections:` — declared out of scope, counted so the boundary is visible:');
    for (const fence of result.outOfScopeFences) log(`  ${fence.file}:${fence.line}`);
  }
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

    // ── a YAML fence is counted, never judged ──────────────────────────────
    const yaml = tree(
      baseFixtureFiles({
        [`${DOCS_ROOT}/extra/e.mdx`]: `# e\n\n${FENCE}yaml\nform:\n  sections:\n    - label: Nameless\n${FENCE}\n`,
      }),
    );
    const yamlSweep = sweep(yaml);
    t('a YAML `sections:` fence is counted out of scope', yamlSweep.outOfScopeFences.length, 1);
    t('...and produces no finding', yamlSweep.findings.length, 0);

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
    + '(real temp trees on disk; both historical misses reproduced as RED, every refusal exercised).',
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  else if (process.argv.includes('--list')) process.exit(list());
  else process.exit(run());
}
