/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9304 — no consumer may bind `useRecordContext()` through a
 * whole-context type assertion.
 *
 * ## What this pins, and why the read sites were not enough
 *
 * objectui#9197 retyped `RecordContextValue.dataSource` from an id to the
 * `DataSource` adapter and removed the assertion at every site that READS the
 * member. That claim is true and it landed. But in `record-activity.tsx` the
 * `const ctx` binding itself was already asserted to `any` one scope above, so
 * removing the narrower assertion on the read changed nothing the compiler
 * answers: `ctx.dataSource` was `any` before and `any` after. A file can be
 * cast-free at every read site and still be untyped.
 *
 * ⇒ the discriminant is the BINDING, not the identifier and not the read.
 * The card carries the measurement that forces this: a cast list keyed on the
 * NAME `ctx` produced a count that matched the real one by coincidence while
 * overlapping on only six of eleven entries. An equal total is not an equal
 * set, so this pin never counts — it enumerates call sites and classifies each
 * one.
 *
 * ## Why a text scan, and what carries the type half
 *
 * A cast removal leaves no runtime trace: the value was always complete at
 * runtime, which is objectui#9197's own argument. Nothing observable through
 * rendering distinguishes the repaired tree from the broken one, so a
 * behavioural test here would be green either way — the disease this card
 * describes. The two halves below are therefore split on purpose:
 *
 *  - the RUNTIME half classifies every `useRecordContext(...)` call site in the
 *    monorepo and reds on any that is immediately asserted. It is the half that
 *    reddens when an assertion comes back.
 *  - the COMPILE-TIME half proves the declaration really resolves here rather
 *    than degrading to `any` — the characteristic dead instrument on a
 *    type-only card. `Equal` distinguishes `any` from every other type, and the
 *    `@ts-expect-error` control fails as an UNUSED directive (TS2578) if the
 *    checker stops refusing a misspelled member. Both run under
 *    `packages/react`'s `tsconfig.test.json`, never at runtime.
 *
 * Every control below can fire: the matcher is proven on a synthetic asserted
 * binding, the comment mask is proven on a commented one, and the population is
 * proven non-empty and to contain the known consumers before any absence is
 * believed.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSource } from '@object-ui/types';
import type { useRecordContext, RecordContextValue } from '../RecordContext';
import { uiRoot } from '../../../../../scripts/ui-root.mjs';

/* ------------------------------------------------------------------ *
 * Compile-time half — erased at runtime; `tsc -p tsconfig.test.json`
 * is the only thing that executes it.
 * ------------------------------------------------------------------ */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type HookReturn = ReturnType<typeof useRecordContext>;

/**
 * The hook's answer is the declaration, not `any`. `Equal` is the form that
 * can tell those apart — a plain `extends` check passes for `any` in both
 * directions and would pin nothing, which is why the "not any" clause is
 * written first and separately.
 */
type _HookReturnIsNotAny = Expect<Equal<Equal<HookReturn, any>, false>>;
type _HookReturnAdmitsNull = Expect<Equal<Extract<HookReturn, null>, null>>;
type _HookReturnIsTheContextValue = Expect<
  NonNullable<HookReturn> extends RecordContextValue<any, any> ? true : false
>;

/**
 * The member the removed assertions used to hide. `DataSource | undefined`,
 * not `string` and not `any` — objectui#9197's retype, read through the
 * declaration a consumer now gets for free.
 */
type _DataSourceIsTheAdapter = Expect<
  Equal<RecordContextValue['dataSource'], DataSource | undefined>
>;

/**
 * Control: the checker is live in this file. If module resolution ever handed
 * `RecordContextValue` back as `any`, this directive would become UNUSED and
 * `tsc` would fail with TS2578 — which is the point of writing the control as
 * an expected error rather than as another assertion.
 */
// @ts-expect-error `objectNam` is not a declared member of RecordContextValue
type _MisspelledMemberIsRefused = RecordContextValue['objectNam'];

/* ------------------------------------------------------------------ *
 * Runtime half — the binding-keyed census.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/react/src/context/__tests__  ->  repo root
const repoRoot = path.resolve(here, '../../../../..');

/** Top-level directories that can hold a TypeScript consumer of the hook. */
const SCAN_ROOTS = ['packages', 'apps', 'examples', 'e2e', 'scripts'];

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.vite',
  '.git',
]);

/**
 * Mask `//` and block comments with spaces, leaving every other byte — string
 * contents included — in place. Quoted spans are walked rather than blanked,
 * purely so a `//` inside a URL literal is not read as a comment start.
 */
function maskComments(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && d === '*') {
      out[i++] = ' ';
      out[i++] = ' ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) {
        out[i++] = ' ';
        out[i++] = ' ';
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Every `useRecordContext(...)` call, asserted or not. */
const CALL = /useRecordContext\s*(?:<[^<>()]*>)?\s*\([^()]*\)/g;
/** The same call, immediately followed by a type assertion. */
const CALL_THEN_AS = /useRecordContext\s*(?:<[^<>()]*>)?\s*\([^()]*\)\s*as\b/g;

interface Site {
  /** Repo-relative path of the citing file. */
  file: string;
  /** 1-based line of the call inside that file. */
  line: number;
  /** The matched text, trimmed. */
  text: string;
}

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

function matchSites(file: string, masked: string, re: RegExp): Site[] {
  const found: Site[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    found.push({ file, line: lineOf(masked, m.index), text: m[0].replace(/\s+/g, ' ') });
  }
  return found;
}

function collectSourceFiles(): string[] {
  const files: string[] = [];
  // Not annotated, deliberately: `ReturnType<typeof readdirSync>` picks the
  // LAST overload of an overloaded declaration, which is the Buffer one.
  const readDir = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const walk = (dir: string) => {
    for (const e of readDir(dir)) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile() && /\.tsx?$/.test(e.name)) {
        files.push(path.join(dir, e.name));
      }
    }
  };
  for (const root of SCAN_ROOTS) walk(path.join(repoRoot, root));
  return files;
}

/** Files, call sites and asserted call sites — computed once. */
const SOURCE_FILES = collectSourceFiles();

const ALL_SITES: Site[] = [];
const ASSERTED_SITES: Site[] = [];
for (const abs of SOURCE_FILES) {
  const raw = readFileSync(abs, 'utf8');
  if (!raw.includes('useRecordContext')) continue;
  const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
  const masked = maskComments(raw);
  ALL_SITES.push(...matchSites(rel, masked, CALL));
  ASSERTED_SITES.push(...matchSites(rel, masked, CALL_THEN_AS));
}

/**
 * Consumers that must be inside the population for any absence below to be a
 * reading rather than a collapsed scan. All four bind the hook today; the two
 * this card repaired are named first.
 */
const KNOWN_CONSUMERS = [
  'packages/plugin-detail/src/renderers/record-activity.tsx',
  'packages/plugin-form/src/LineItemsPanel.tsx',
  'packages/plugin-detail/src/renderers/record-history.tsx',
  'packages/components/src/renderers/layout/containers.tsx',
];

describe('the instrument can fire (controls)', () => {
  it('anchors on this file, not on the cwd', () => {
    expect(repoRoot).toBe(uiRoot());
    expect(existsSync(path.join(repoRoot, 'packages/react/src/context/RecordContext.tsx'))).toBe(
      true,
    );
  });

  it('flags an asserted binding', () => {
    // Assembled from fragments so this control is not itself a hit when the
    // census below walks this file — which it does, like any other source.
    const asserted = 'const ctx = useRecordContext()' + ' as ' + 'any;';
    expect(matchSites('synthetic.ts', maskComments(asserted), CALL_THEN_AS)).toHaveLength(1);
  });

  it('flags an asserted binding written with explicit type arguments', () => {
    const asserted =
      'const ctx = useRecordContext<Row, Schema>()' + ' as ' + 'Record<string, unknown>;';
    expect(matchSites('synthetic.ts', maskComments(asserted), CALL_THEN_AS)).toHaveLength(1);
  });

  it('does not flag a plain binding', () => {
    const plain = 'const ctx = useRecordContext();';
    expect(matchSites('synthetic.ts', maskComments(plain), CALL)).toHaveLength(1);
    expect(matchSites('synthetic.ts', maskComments(plain), CALL_THEN_AS)).toHaveLength(0);
  });

  it('masks comments, so prose about the defect is not a defect', () => {
    const commented = '// const ctx = useRecordContext()' + ' as ' + 'any;\nconst x = 1;';
    expect(matchSites('synthetic.ts', maskComments(commented), CALL_THEN_AS)).toHaveLength(0);
    const blockCommented = '/* useRecordContext()' + ' as ' + 'any */\nconst x = 1;';
    expect(matchSites('synthetic.ts', maskComments(blockCommented), CALL_THEN_AS)).toHaveLength(0);
  });

  it('does not mistake a URL inside a string for a comment', () => {
    const withUrl =
      "const url = 'https://example.test/x';\nconst ctx = useRecordContext()" + ' as ' + 'any;';
    expect(matchSites('synthetic.ts', maskComments(withUrl), CALL_THEN_AS)).toHaveLength(1);
  });

  it('walked a real population, not an empty one', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(500);
    // A floor, never an exact count: an equal total is not an equal set, so the
    // assertion that matters is the membership read below.
    expect(ALL_SITES.length).toBeGreaterThanOrEqual(10);
  });

  it('reached every known consumer of the hook', () => {
    const filesWithSites = new Set(ALL_SITES.map((s) => s.file));
    for (const consumer of KNOWN_CONSUMERS) {
      expect(
        existsSync(path.join(repoRoot, consumer)),
        `${consumer} is gone — update KNOWN_CONSUMERS rather than deleting the control`,
      ).toBe(true);
      expect(filesWithSites.has(consumer), `${consumer} carries no scanned call site`).toBe(true);
    }
  });
});

describe('useRecordContext bindings are typed by the declaration (objectui#9304)', () => {
  it('no call site is bound through a type assertion', () => {
    const offenders = ASSERTED_SITES.map((s) => `${s.file}  line ${s.line}  ${s.text}`);
    expect(
      offenders,
      [
        'A `useRecordContext()` call is bound through a type assertion.',
        'The declaration (`RecordContextValue | null`) already types every member a',
        'record renderer reads, so an assertion here only hides what the compiler',
        'would have answered — and it keeps hiding it at every read below,',
        'whether or not those reads carry casts of their own (objectui#9304).',
        'Read the members off the binding instead; if one is genuinely missing,',
        'declare it on `RecordContextValue`.',
      ].join('\n'),
    ).toEqual([]);
  });
});
