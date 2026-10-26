/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11475 — the enumeration pin over every caller of the percent
 * scaling: `formatPercent` (`@object-ui/fields`), `percentDisplayValue`
 * (`@object-ui/core`) and `summaryChipPercentPoints` (`plugin-detail`).
 *
 * Each of them takes the STORAGE as a required argument now. The type checker
 * already refuses a call that omits it; what this pin adds is the POPULATION:
 * every call in every package's source is listed below with the storage
 * expression it passes and where that storage comes from. A new caller, a
 * moved one, or one that starts passing a literal it did not hold before goes
 * red here by name, so the question "does this face read the field's declared
 * storage, or state one it knows?" is answered in review rather than in a
 * card.
 *
 * The population is enumerated from the disk, every `src` tree under
 * `packages/` and `apps/`, never from this table, so the table cannot hide a
 * caller by leaving it out. Comments are stripped before matching, so a quoted
 * historical call in a comment is not a caller. It lives here, beside the other
 * repo-wide source pins, because it reads every package's tree; no single
 * package's test program can type the `node:` modules it needs.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type Source = 'field in hand' | 'stated: no field';

interface Call {
  fn: 'formatPercent' | 'percentDisplayValue' | 'summaryChipPercentPoints';
  storage: string;
  source: Source;
  why: string;
}

/** Every caller, by file, in source order within each file. */
const CALLERS: Record<string, Call[]> = {
  'packages/core/src/utils/dataset-format.ts': [
    { fn: 'percentDisplayValue', storage: "percentScale ?? 'fraction'", source: 'stated: no field', why: 'formatMeasure: the server annotation, else the `%` pattern (numeral: a fraction)' },
  ],
  'packages/fields/src/index.tsx': [
    { fn: 'percentDisplayValue', storage: 'percentScale', source: 'stated: no field', why: 'formatPercent body: its caller states the storage' },
    { fn: 'percentDisplayValue', storage: 'percentScale', source: 'field in hand', why: 'PercentCellRenderer bar: percentCellScale(field)' },
    { fn: 'formatPercent', storage: 'percentScale', source: 'field in hand', why: 'PercentCellRenderer text: percentCellScale(field)' },
  ],
  'packages/plugin-dashboard/src/MetricWidget.tsx': [
    { fn: 'formatPercent', storage: "'fraction'", source: 'stated: no field', why: 'a metric tile holds a value and a numeral `%` pattern, which multiplies by 100' },
  ],
  'packages/plugin-dashboard/src/ObjectMetricWidget.tsx': [
    { fn: 'formatPercent', storage: 'percentCellScale(valueFieldDef)', source: 'field in hand', why: 'an aggregate over a percent field is stored the way the field stores' },
  ],
  'packages/plugin-dashboard/src/recordFields.tsx': [
    { fn: 'formatPercent', storage: 'percentScale', source: 'field in hand', why: 'percentCellScale(fieldMeta) for percent/progress, else the `%` pattern (a fraction)' },
  ],
  'packages/plugin-detail/src/DetailView.tsx': [
    { fn: 'formatPercent', storage: 'percentScale', source: 'field in hand', why: 'summary chip text: percentCellScale over the merged field bag' },
    { fn: 'summaryChipPercentPoints', storage: 'percentScale', source: 'field in hand', why: 'summary chip bar: the same answer as its text' },
  ],
  'packages/plugin-detail/src/summaryChipPercent.ts': [
    { fn: 'percentDisplayValue', storage: 'percentScale', source: 'field in hand', why: 'the chip bar: its caller passes the field storage' },
  ],
  'packages/plugin-gantt/src/ObjectGantt.tsx': [
    { fn: 'formatPercent', storage: 'percentCellScale(def)', source: 'field in hand', why: 'tooltip `percent` row' },
  ],
  'packages/plugin-grid/src/ObjectGrid.tsx': [
    { fn: 'formatPercent', storage: 'percentCellScale(percentDef)', source: 'field in hand', why: 'mobile card slot, for a `percent` field only' },
  ],
  'packages/plugin-grid/src/useColumnSummary.ts': [
    { fn: 'formatPercent', storage: 'percentCellScale(column)', source: 'field in hand', why: 'footer aggregate of a percent column' },
  ],
};

/**
 * Files that call a DIFFERENT function spelled `formatPercent`, named so the
 * exclusion is a decision rather than a blind spot: `plugin-ai` formats a 0–1
 * model confidence through its own module-local helper in
 * `useAiTranslation.ts`, imported from there, not from `@object-ui/fields`.
 */
const OTHER_FORMAT_PERCENT = new Set([
  'packages/plugin-ai/src/useAiTranslation.ts',
  'packages/plugin-ai/src/AIFormAssist.tsx',
  'packages/plugin-ai/src/AIRecommendations.tsx',
  'packages/plugin-ai/src/NLQueryInput.tsx',
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '__mocks__', 'coverage']);
const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/;
const NOT_SOURCE = /\.(test|spec|stories)\.[cm]?tsx?$|\.d\.ts$/;

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SOURCE_FILE.test(name) && !NOT_SOURCE.test(name)) out.push(full);
  }
}

/** Every `src` tree under `packages/*` and `apps/*`. */
function sourceFiles(): string[] {
  const out: string[] = [];
  for (const top of ['packages', 'apps']) {
    for (const pkg of readdirSync(path.join(repoRoot, top))) {
      walk(path.join(repoRoot, top, pkg, 'src'), out);
    }
  }
  return out.map((f) => path.relative(repoRoot, f).split(path.sep).join('/'));
}

/** Blank out comments, keeping string and template literals intact. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

/** The top-level arguments of the call whose `(` sits at `open`. */
function argumentsAt(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') {
      depth += 1;
      if (depth === 1) continue;
    } else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) {
        if (current.trim() !== '') args.push(current.trim());
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  throw new Error(`unbalanced call at offset ${open}`);
}

const CALL = /\b(formatPercent|percentDisplayValue|summaryChipPercentPoints)\s*\(/g;

function callsIn(file: string): Array<{ fn: Call['fn']; args: string[] }> {
  const src = stripComments(readFileSync(path.join(repoRoot, file), 'utf8'));
  const calls: Array<{ fn: Call['fn']; args: string[] }> = [];
  for (const m of src.matchAll(CALL)) {
    const before = src.slice(Math.max(0, m.index! - 9), m.index!);
    if (/function\s+$/.test(before)) continue; // the definition, not a call
    const open = m.index! + m[0].length - 1;
    calls.push({ fn: m[1] as Call['fn'], args: argumentsAt(src, open) });
  }
  return calls;
}

describe('every caller of the percent scaling states its storage (objectui#11475)', () => {
  const files = sourceFiles();

  it('the walk found the source trees (a control: an empty walk would pass everything)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('packages/fields/src/index.tsx');
    expect(files).toContain('packages/core/src/utils/dataset-format.ts');
  });

  const found: Record<string, Array<{ fn: Call['fn']; args: string[] }>> = {};
  for (const file of files) {
    if (OTHER_FORMAT_PERCENT.has(file)) continue;
    const calls = callsIn(file);
    if (calls.length > 0) found[file] = calls;
  }

  it('the population on disk is exactly the table: no caller is unlisted, none is stale', () => {
    expect(Object.keys(found).sort()).toEqual(Object.keys(CALLERS).sort());
  });

  it.each(Object.entries(CALLERS))('%s passes the storage the table names, call by call', (file, expected) => {
    const calls = found[file] ?? [];
    expect(
      calls.map((c) => ({ fn: c.fn, storage: c.args[1] })),
      `calls in ${file}: ${JSON.stringify(calls)}`,
    ).toEqual(expected.map((c) => ({ fn: c.fn, storage: c.storage })));
  });

  it('no call is the storage-less form: every one passes a second argument', () => {
    const bare = Object.entries(found).flatMap(([file, calls]) =>
      calls.filter((c) => c.args.length < 2).map((c) => `${file}: ${c.fn}(${c.args.join(', ')})`),
    );
    expect(bare).toEqual([]);
  });

  it('the excluded `formatPercent` really is a different function, imported from its own module', () => {
    const helper = readFileSync(path.join(repoRoot, 'packages/plugin-ai/src/useAiTranslation.ts'), 'utf8');
    expect(helper).toMatch(/export function formatPercent\(score: number, locale: string\)/);
    for (const file of OTHER_FORMAT_PERCENT) {
      if (file.endsWith('useAiTranslation.ts')) continue;
      const src = readFileSync(path.join(repoRoot, file), 'utf8');
      expect(src, file).toMatch(/import \{[^}]*\bformatPercent\b[^}]*\} from '\.\/useAiTranslation'/);
      expect(src, file).not.toMatch(/from '@object-ui\/fields'[^\n]*formatPercent|formatPercent[^\n]*from '@object-ui\/fields'/);
    }
  });
});
