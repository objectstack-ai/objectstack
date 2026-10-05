// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// ─── [#20126] the currency-mode family: its one enumerating closure pin ────────
//
// The contract. `CurrencyConfigSchema` (`./field.zod.ts`) declares
// `currencyMode: 'dynamic' | 'fixed'`, default `'dynamic'`. Only a `fixed` field
// has a currency of its own, `defaultCurrency`; a `dynamic` field displays the
// tenant default currency and its `defaultCurrency` is not read. A currency
// VALUE is a bare number either way (ADR-0104 D1). The date / datetime record
// never names currency, so citing it for the currency chain is wrong.
//
// The family is one class-closure card (maintainer ruling on #20088: one card,
// one enumerating pin, a test in the owning package, ⛔ no new `check-*` gate).
// Every site it found was fixed by the PRs that landed it; this file keeps the
// CLASS closed. It enumerates the corpus rather than the sites, so a new site
// anywhere inside the radius reddens here, not only a regression of an old one.
//
// ## The two text rules (the card's definition)
//
//   A. Every `defaultCurrency` in `skills/**/*.md` and `content/docs/**/*.mdx`
//      sits in a unit that also carries `fixed`, or that says it is not the
//      displayed currency (or not read) under `dynamic`.
//   B. The date record's number (spelled `ADR-0053`, `ADR 0053`, or as its
//      `adr/0053-` file link) within five physical lines of `currenc` (any case)
//      counts 0 under `skills/**`, `content/docs/**`,
//      `packages/services/service-analytics/src/**` — and, per the family's
//      appended sites 5-10, `packages/spec/src/**`, `packages/spec/liveness/**`
//      and `examples/**` (non-code files anywhere, `.ts` under `examples/*/src/**`).
//
// The runtime member — the measure-currency resolver reads `defaultCurrency`
// only under `currencyMode === 'fixed'` — is its own pin,
// `packages/services/service-analytics/src/__tests__/currency-mode-relay.test.ts`.
// It boots the plugin over a real engine; this file only checks that it still
// stands, and ⛔ never re-asserts the resolver.
//
// ## Outside the corpus, and why
//
//   - Released entries: every `CHANGELOG.md` and `content/docs/releases/**`.
//     Four released 17.0.0 entries still call the chain by the date record's
//     number (the family's sites 11-14, `packages/spec/CHANGELOG.md` and
//     `packages/services/service-analytics/CHANGELOG.md`). The seat ruled them
//     accepted history: a released entry records what shipped, and a code PR
//     never edits one. The two package CHANGELOGs sit outside every root by
//     construction; `examples/*/CHANGELOG.md` is inside a root and skipped by name.
//   - This file: it quotes both rules and their fabricated controls.
//
// ## Three design facts, each answered deliberately
//
//   1. A test TITLE naming the nested form (`field.test.ts`'s `it` that
//      "names the declarable nested form, `currencyConfig` / `defaultCurrency`")
//      was judged a pass by hand. Rule A reads published prose only (`.md` /
//      `.mdx`), so no test title is ever judged by it: a title labels what its
//      assertions check, and the assertions are the authority. Rule B DOES read
//      test files inside its roots — a title or comment there that cites the
//      date record for currency reddens like any other line.
//   2. A count cannot tell a negation from a citation. Rule B does not try: a
//      negation within the window counts too. Currency text has no reason to
//      name the date record at all — cite ADR-0104 — so the count stays 0 by
//      writing neither, and a date citation that happens to sit near currency
//      text is moved apart rather than exempted.
//   3. A line grep misses a key wrapped across lines (`default-` / `Currency`).
//      Both rules read logical text: a camelCase key hyphen-wrapped at a line
//      end rejoins (`default-` + `Currency`, `ADR-` + `0053`), after the next
//      line's comment prefix is stripped.
//
// ## What a "unit" is for rule A (the line is NOT the unit)
//
// A line-based rule reds on correct text that states the condition across a
// wrapped sentence (`skills/objectstack-data/rules/field-types.md`, accepted).
// So the unit is what a reader takes in as one statement:
//   - prose: the SENTENCE, across wrapped lines, within its paragraph or list item;
//   - a table row: the row;
//   - a fenced code comment: the sentence of its comment run (a trailing
//     comment plus the comment-only lines continuing it);
//   - fenced code: the innermost object literal enclosing the key, or for YAML
//     (no braces) the mapping of sibling keys — so one `fixed` field in a fence
//     never vouches for a neighbour's bare `defaultCurrency`.
// One exemption, by shape: a parenthesised list of bare key names that also
// names `currencyMode` — `(currencyMode, defaultCurrency)` — names the keys and
// teaches no reading.

const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

// ─── the corpus ─────────────────────────────────────────────────────────────────

/** Walked roots — each declared for `@objectstack/spec` in `scripts/cross-package-test-inputs.mjs`. */
const WALK_ROOTS = ['skills', 'content/docs', 'packages/services/service-analytics/src', 'packages/spec/src', 'packages/spec/liveness', 'examples'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
const TEXT_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
/** Under `examples/`: the non-code extensions anywhere, `.ts` only under an app's `src/` (the declared radius). */
const EXAMPLES_NON_CODE = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
const EXAMPLES_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
const RELEASES = 'content/docs/releases/';

function walk(rel: string, out: string[]): void {
  const abs = path.join(REPO_ROOT, rel);
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(child, out);
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
}

function inCorpusB(rel: string): boolean {
  const ext = path.extname(rel);
  if (!TEXT_EXT.has(ext)) return false;
  if (rel === THIS_FILE || path.basename(rel) === 'CHANGELOG.md' || rel.startsWith(RELEASES)) return false;
  if (rel.startsWith('examples/')) return EXAMPLES_NON_CODE.has(ext) || EXAMPLES_SRC_TS.test(rel);
  return true;
}

function inCorpusA(rel: string): boolean {
  if (rel.startsWith(RELEASES)) return false;
  return (rel.startsWith('skills/') && rel.endsWith('.md')) || (rel.startsWith('content/docs/') && rel.endsWith('.mdx'));
}

const ALL_FILES: string[] = [];
for (const root of WALK_ROOTS) walk(root, ALL_FILES);
const CORPUS_A = ALL_FILES.filter(inCorpusA);
const CORPUS_B = ALL_FILES.filter(inCorpusB);
const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─── logical text: wrapped keys rejoin (design fact 3) ──────────────────────────

/** Strip a comment / quote prefix from a continuation line. */
const contentOf = (line: string): string => line.replace(/^\s*(?:\/\/+|\/?\*+\/?|#+|>)?\s*/, '');

/** Join two physical lines the way a reader does. */
function joinPair(left: string, right: string): string {
  const l = left.replace(/\s+$/, '');
  const r = right.replace(/^\s+/, '');
  if (/[a-z]-$/.test(l) && /^[A-Z]/.test(r)) return l.slice(0, -1) + r; // `default-` + `Currency`
  if (/[A-Za-z0-9]-$/.test(l) && r) return l + r; // `ADR-` + `0053`, `tenant-` + `level`
  return `${l} ${r}`;
}

function joinLines(parts: string[]): string {
  let out = '';
  for (const p of parts) out = out ? joinPair(out, p) : p.trim();
  return out;
}

// ─── rule A ─────────────────────────────────────────────────────────────────────

const FENCE = /^\s*(?:```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const LIST_START = /^\s*(?:[-*+]|\d+[.)])\s+/;
const JSX_OR_RULE = /^\s*(?:<\/?[A-Za-z][^>]*>|\{\/\*.*\*\/\}|---|\*\*\*|___)\s*$/;
const CODE_COMMENT = /(?:^|\s)(\/\/|#)\s?(.*)$/;
const KEY_ENUMERATION = /\(\s*`?[A-Za-z_]\w*`?(?:\s*,\s*`?[A-Za-z_]\w*`?)+\s*\)/g;

/** The sentence of `text` that holds `offset`; a period inside backticks or parentheses ends nothing. */
function sentenceAt(text: string, offset: number): string {
  const masked = text
    .replace(/`[^`]*`/g, (m) => `\`${'x'.repeat(m.length - 2)}\``)
    .replace(/\([^()]*\)/g, (m) => `(${'x'.repeat(m.length - 2)})`);
  const bounds = [0];
  for (const m of masked.matchAll(/(?<!\b(?:e\.g|i\.e|etc|vs|cf))[.!?](?=\s+[A-Z`*_[(])/g)) bounds.push((m.index ?? 0) + 1);
  bounds.push(text.length);
  const at = Math.max(0, Math.min(offset, text.length - 1));
  for (let k = 0; k < bounds.length - 1; k++) {
    if (at >= bounds[k] && at < bounds[k + 1]) return text.slice(bounds[k], bounds[k + 1]).trim();
  }
  return text;
}

function proseUnit(lines: string[], kinds: string[], i: number, col: number): string {
  const line = lines[i];
  if (HEADING.test(line) || JSX_OR_RULE.test(line)) return line;
  const boundary = (k: number): boolean =>
    k < 0 || k >= lines.length || kinds[k] !== 'prose' || !lines[k].trim()
    || TABLE_ROW.test(lines[k]) || HEADING.test(lines[k]) || JSX_OR_RULE.test(lines[k]);
  let start = i;
  while (!LIST_START.test(lines[start]) && !boundary(start - 1)) start--;
  let end = i;
  while (!boundary(end + 1) && !LIST_START.test(lines[end + 1])) end++;
  const unquote = (s: string): string => s.replace(/^\s*>\s?/, '');
  const parts = lines.slice(start, end + 1).map(unquote);
  const dropped = line.length - unquote(line).length;
  const before = joinLines([...parts.slice(0, i - start), unquote(line).slice(0, Math.max(0, col - dropped))]);
  return sentenceAt(joinLines(parts), before.length);
}

function codeUnit(lines: string[], kinds: string[], i: number, col: number): string {
  const commentAt = (k: number): { start: number; text: string } | null => {
    if (k < 0 || k >= lines.length || kinds[k] !== 'code') return null;
    const m = CODE_COMMENT.exec(lines[k]);
    return m ? { start: lines[k].indexOf(m[1], m.index), text: m[2] } : null;
  };
  const commentOnly = (k: number): boolean => kinds[k] === 'code' && /^\s*(?:\/\/|#)/.test(lines[k]);
  const own = commentAt(i);
  if (own && col >= own.start) {
    // A comment run: this comment, the ones it continues, and the comment-only lines continuing it.
    let s = i;
    while (commentOnly(s) && commentAt(s - 1)) s--;
    let e = i;
    while (commentOnly(e + 1)) e++;
    const parts: string[] = [];
    for (let k = s; k <= e; k++) parts.push(commentAt(k)?.text ?? '');
    const before = joinLines([...parts.slice(0, i - s), lines[i].slice(own.start, col).replace(/^(?:\/\/|#)\s?/, '')]);
    return sentenceAt(joinLines(parts), before.length);
  }
  // Code: the innermost object literal enclosing the key; comments inside it are part of what is read.
  let fs0 = i;
  while (fs0 > 0 && kinds[fs0 - 1] === 'code') fs0--;
  let fe = i;
  while (fe + 1 < lines.length && kinds[fe + 1] === 'code') fe++;
  const codeOnly = (k: number): string => {
    const c = commentAt(k);
    return c ? lines[k].slice(0, c.start) : lines[k];
  };
  const flat: string[] = [];
  for (let k = fs0; k <= fe; k++) flat.push(codeOnly(k));
  let offset = col;
  for (let k = fs0; k < i; k++) offset += flat[k - fs0].length + 1;
  const joined = flat.join('\n');
  let depth = 0;
  let open = -1;
  for (let p = offset; p >= 0; p--) {
    if (joined[p] === '}') depth++;
    else if (joined[p] === '{') {
      if (depth === 0) { open = p; break; }
      depth--;
    }
  }
  if (open >= 0) {
    depth = 0;
    let close = joined.length - 1;
    for (let p = open; p < joined.length; p++) {
      if (joined[p] === '{') depth++;
      else if (joined[p] === '}' && --depth === 0) { close = p; break; }
    }
    const first = fs0 + joined.slice(0, open).split('\n').length - 1;
    const last = fs0 + joined.slice(0, close).split('\n').length - 1;
    return lines.slice(first, last + 1).join('\n');
  }
  // YAML: the contiguous siblings at this key's indentation (and deeper).
  const indent = (k: number): number => (/^\s*/.exec(lines[k]) ?? [''])[0].length;
  const own0 = indent(i);
  let s = i;
  while (s - 1 >= fs0 && lines[s - 1].trim() && indent(s - 1) >= own0) s--;
  let e = i;
  while (e + 1 <= fe && lines[e + 1].trim() && indent(e + 1) >= own0) e++;
  return lines.slice(s, e + 1).join('\n');
}

/** Rule A's verdict on one unit. */
function conditioned(unit: string): boolean {
  const names = unit.split('defaultCurrency').length - 1;
  const enumerated = [...unit.matchAll(KEY_ENUMERATION)]
    .map((m) => m[0])
    .filter((list) => list.includes('currencyMode'))
    .reduce((n, list) => n + list.split('defaultCurrency').length - 1, 0);
  if (names > 0 && enumerated === names) return true; // `(currencyMode, defaultCurrency)`: names keys, teaches no reading
  if (/\bfixed\b/.test(unit)) return true;
  return /\bdynamic\b/.test(unit) && /\bnot (?:the displayed currency|read)\b/i.test(unit);
}

interface Judged { line: number; unit: string; ok: boolean }

/** Every `defaultCurrency` in a markdown / MDX text, with its unit and verdict. */
function judgeRuleA(text: string): Judged[] {
  const lines = text.split('\n');
  const kinds: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) { kinds.push('fence'); inFence = !inFence; continue; }
    kinds.push(inFence ? 'code' : 'prose');
  }
  const out: Judged[] = [];
  lines.forEach((line, i) => {
    const cols = [...line.matchAll(/defaultCurrency/g)].map((m) => m.index ?? 0);
    const wrap = /default-\s*$/.exec(line);
    if (wrap && /^Currency/.test(contentOf(lines[i + 1] ?? ''))) cols.push(wrap.index);
    for (const col of cols) {
      let unit: string;
      if (kinds[i] === 'code') unit = codeUnit(lines, kinds, i, col);
      else if (TABLE_ROW.test(line)) unit = line;
      else unit = proseUnit(lines, kinds, i, col);
      // The unit is judged on logical text, so a key wrapped inside it still counts as the key.
      out.push({ line: i + 1, unit, ok: conditioned(joinLines(unit.split('\n'))) });
    }
  });
  return out;
}

// ─── rule B ─────────────────────────────────────────────────────────────────────

const DATE_RECORD = /\bADR[-\s]?0053\b|adr\/0053-/i;

/** 1-based lines that name the date record within five lines of `currenc`. */
function judgeRuleB(text: string): { hits: number[]; dateRecordLines: number } {
  const lines = text.split('\n');
  const logical = (k: number): string => {
    const line = lines[k] ?? '';
    const next = lines[k + 1];
    return next !== undefined && /[A-Za-z0-9]-\s*$/.test(line) ? joinPair(line, contentOf(next)) : line;
  };
  const names = lines.map((_, k) => DATE_RECORD.test(logical(k)));
  const currency = lines.map((_, k) => /currenc/i.test(logical(k)));
  const hits: number[] = [];
  names.forEach((named, k) => {
    if (!named) return;
    for (let j = Math.max(0, k - 5); j <= Math.min(lines.length - 1, k + 5); j++) {
      if (currency[j]) { hits.push(k + 1); return; }
    }
  });
  return { hits, dateRecordLines: names.filter(Boolean).length };
}

// ─── the family's sites, each mapped to the leg that guards it ─────────────────

type Leg = 'A' | 'B';
/** Paths only — line numbers drift. `legs: []` = deliberately outside the corpus. */
const SITES: { site: string; file: string; legs: Leg[] }[] = [
  { site: '1, 9: the `currencyMode` / `defaultCurrency` describes, as generated', file: 'content/docs/references/data/field.mdx', legs: ['A', 'B'] },
  { site: '1, 9: the describes at their source', file: 'packages/spec/src/data/field.zod.ts', legs: ['B'] },
  { site: '2: the dashboards skill', file: 'skills/objectstack-ui/rules/dashboards.md', legs: ['A', 'B'] },
  { site: '3: the data API page', file: 'content/docs/api/data-api.mdx', legs: ['A', 'B'] },
  { site: '4: the analytics plugin comments', file: 'packages/services/service-analytics/src/plugin.ts', legs: ['B'] },
  { site: '4: the analytics service comments', file: 'packages/services/service-analytics/src/analytics-service.ts', legs: ['B'] },
  { site: '5: the AnalyticsResult currency TSDoc', file: 'packages/spec/src/contracts/analytics-service.ts', legs: ['B'] },
  { site: '6: the percent-scale header', file: 'packages/spec/src/data/percent-scale.ts', legs: ['B'] },
  { site: '7: the analytics API docblock', file: 'packages/spec/src/api/analytics.zod.ts', legs: ['B'] },
  { site: '8: the dataset liveness row', file: 'packages/spec/liveness/dataset.json', legs: ['B'] },
  { site: '8: the field liveness row', file: 'packages/spec/liveness/field.json', legs: ['B'] },
  { site: '10: the chart-gallery comment', file: 'examples/app-showcase/src/ui/datasets/chart-gallery.dataset.ts', legs: ['B'] },
  { site: 'field-types skill (landed before the card)', file: 'skills/objectstack-data/rules/field-types.md', legs: ['A', 'B'] },
  { site: 'field-types page (landed before the card)', file: 'content/docs/data-modeling/field-types.mdx', legs: ['A', 'B'] },
  { site: 'fields page (landed before the card)', file: 'content/docs/data-modeling/fields.mdx', legs: ['A', 'B'] },
  { site: '11-14: released 17.0.0 entries, accepted history', file: 'packages/spec/CHANGELOG.md', legs: [] },
  { site: '11-14: released 17.0.0 entries, accepted history', file: 'packages/services/service-analytics/CHANGELOG.md', legs: [] },
];
const RUNTIME_PIN = 'packages/services/service-analytics/src/__tests__/currency-mode-relay.test.ts';

describe('currency-mode family — the enumerating closure pin: `defaultCurrency` holds only under `fixed`', () => {
  it('the corpus reaches every family site, and the released entries sit outside it', () => {
    for (const { site, file, legs } of SITES) {
      expect(fs.existsSync(path.join(REPO_ROOT, file)), `site ${site}: ${file} must exist`).toBe(true);
      expect(CORPUS_A.includes(file), `site ${site}: ${file} in rule A's corpus`).toBe(legs.includes('A'));
      expect(CORPUS_B.includes(file), `site ${site}: ${file} in rule B's corpus`).toBe(legs.includes('B'));
    }
    expect(CORPUS_B.includes(THIS_FILE), 'this file quotes both rules, so it is outside its own corpus').toBe(false);
    expect(CORPUS_B.filter((f) => path.basename(f) === 'CHANGELOG.md')).toEqual([]);
    // Anti-vacuity: the walk covered the roots, not a stub of them.
    expect(CORPUS_A.length, 'rule A reads the published skills and docs').toBeGreaterThan(300);
    expect(CORPUS_B.length, 'rule B reads every root').toBeGreaterThan(1500);
    expect(ALL_FILES.some((f) => f.startsWith('examples/') && f.endsWith('/CHANGELOG.md')), 'the by-name CHANGELOG skip is live').toBe(true);
  });

  it('rule A: every `defaultCurrency` unit in the published skills and docs carries the `fixed` condition', () => {
    const offenders: string[] = [];
    let judged = 0;
    for (const file of CORPUS_A) {
      for (const j of judgeRuleA(read(file))) {
        judged++;
        if (!j.ok) offenders.push(`${file}:${j.line} — ${JSON.stringify(j.unit)}`);
      }
    }
    expect(
      offenders,
      'a `defaultCurrency` taught without `fixed`: under `dynamic` (the default) it is not read and the tenant default currency displays. '
        + 'State the condition in the same sentence (or the same code object), e.g. `currencyConfig: { currencyMode: \'fixed\', defaultCurrency: \'USD\' }`.',
    ).toEqual([]);
    expect(judged, 'anti-vacuity: rule A judged real units').toBeGreaterThan(20);
  });

  it('rule B: the date record is never named within five lines of currency text', () => {
    const offenders: string[] = [];
    let dateRecordLines = 0;
    for (const file of CORPUS_B) {
      const r = judgeRuleB(read(file));
      dateRecordLines += r.dateRecordLines;
      for (const line of r.hits) offenders.push(`${file}:${line}`);
    }
    expect(
      offenders,
      'the date / datetime record never names currency: cite ADR-0104 for a currency value, and move a genuine date citation away from currency text — a negation counts too.',
    ).toEqual([]);
    // Anti-vacuity: the matcher reads real citations — the date uses that stay outside the window.
    expect(dateRecordLines, 'anti-vacuity: rule B saw the date record where it belongs').toBeGreaterThan(10);
  });

  it('the runtime member is the resolver\'s own pin, which still stands', () => {
    const pin = read(RUNTIME_PIN);
    expect(pin).toMatch(/currencyMode: 'fixed'/);
    expect(pin).toMatch(/currencyMode: 'dynamic'/);
  });
});

describe('currency-mode closure controls — each rule can fail, and passes what it must', () => {
  const ruleA = (text: string): boolean[] => judgeRuleA(text).map((j) => j.ok);
  const ruleB = (text: string): number[] => judgeRuleB(text).hits;
  const DATE = ['ADR', '0053'].join('-');

  it('LIT: fabricated violations fail', () => {
    expect(ruleA('Set `currencyConfig.defaultCurrency` to choose the currency the column displays.\n')).toEqual([false]);
    expect(ruleA("```ts\nprice: { type: 'currency', currencyConfig: { defaultCurrency: 'EUR' } },\n```\n")).toEqual([false]);
    // A fixed neighbour in the same fence vouches for nothing.
    expect(ruleA("```ts\na: { currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },\nb: { currencyConfig: { defaultCurrency: 'EUR' } },\n```\n"))
      .toEqual([true, false]);
    // Design fact 3: the key wrapped across lines is still the key.
    expect(ruleA('The column displays the field\'s default-\nCurrency code.\n')).toEqual([false]);
    expect(ruleB(`// resolves the measure currency by the ${DATE} chain\n`)).toEqual([1]);
    // Design fact 2: a negation counts.
    expect(ruleB(`// the currency chain is not ${DATE}\n`)).toEqual([1]);
    expect(ruleB(`// the chain (ADR-\n// 0053) resolves the currency\n`)).toEqual([1]);
  });

  it('DARK: conforming text passes', () => {
    // The accepted field-types.md shape: the condition stated across a wrapped sentence.
    expect(ruleA("The displayed symbol: under `'fixed'`,\n`currencyConfig.defaultCurrency`; under `'dynamic'` (default), the tenant\nsetting, not `defaultCurrency`.\n"))
      .toEqual([true, true]);
    expect(ruleA("```ts\ncurrencyConfig: {\n  currencyMode: 'fixed',\n  defaultCurrency: 'USD',  // ISO 4217\n},\n```\n")).toEqual([true]);
    expect(ruleA('```yaml\ncurrencyConfig:\n  currencyMode: fixed\n  defaultCurrency: USD\n```\n')).toEqual([true]);
    expect(ruleA('| `currency` | Monetary amounts | `currencyConfig` (currencyMode, defaultCurrency) |\n')).toEqual([true]);
    expect(ruleA('Under `dynamic`, `defaultCurrency` is not the displayed currency.\n')).toEqual([true]);
    // A date citation six lines from currency text is outside the window.
    expect(ruleB(`// dates bucket by ${DATE}\n\n\n\n\n\n// the currency column\n`)).toEqual([]);
  });
});
