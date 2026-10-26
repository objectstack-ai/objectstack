/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9309 — `ObjectGallerySchema.filter` is typed as the destination its
 * own docblock names, on both faces; and the `filter` census that sentence used
 * to be argued from is re-derived here instead of written down.
 *
 * ## The defect
 *
 * The declaration read `filter?: unknown` under the docblock "Query filter,
 * forwarded verbatim as `$filter`". `$filter` is `QueryParams['$filter']`
 * (`../data.ts`) — `Record<string, any> | FilterArray`. So the declaration
 * named a destination it did not type: an author told to forward the value
 * verbatim got a type error on the key the docblock had just told them to
 * forward, and the only way through was `as`, which un-checks the destination's
 * real type at that call site too. The repo's own direction is the opposite one
 * (AGENTS.md #0.1 — fix the declaration, do not widen the consumer).
 *
 * The mirror carried the same gap one layer down, and worse: `z.unknown()`
 * admitted `filter: 'stage=won'` at RUNTIME, and `zod-mirror-parity`'s
 * `Unconstrained< T >` predicate excludes an `unknown` mirror slot from the
 * `WiderThanDeclared` comparison BY DEFINITION, so nothing in the suite would
 * have reported the split once the TS face narrowed. Both faces move together
 * here for that reason.
 *
 * ## The comparative claim the card was argued from, and why it is not repeated
 *
 * objectui#9309 called this "the one view schema of six that is not `any[]`".
 * Measured on the tree this test runs against, that framing does not survive:
 * the file declares NINE optional `filter` members in FOUR spellings, and one
 * of the six `any[]` owners is `NamedListView` — the named-view interface, not
 * a view schema at all. ⛔ So the number is not restated in prose anywhere. The
 * census below re-derives owner and spelling from the AST on every run, which
 * is the only form of that claim that cannot rot (AGENTS.md #9). Two docblocks
 * in `../objectql.ts` and `../zod/objectql.zod.ts` that used to state the count
 * now point here.
 *
 * ## Instruments
 *
 * Ownership is resolved by the TypeScript PARSER — every `filter` property
 * signature is charged to the nearest enclosing `interface` declaration in the
 * AST. ⛔ Never by proximity to the nearest preceding `export interface` LINE:
 * that rule is wrong, and `it('charges a member to its AST owner…')` below is
 * the firing control that shows it is wrong on a fixture where the two answers
 * differ. Line numbers are deliberately NOT pinned — two landings moved this
 * file by +241 lines on the day the card was taken, and a line pin would only
 * record the day it was written.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import ts from 'typescript';

import { ObjectGallerySchema } from '../zod/index.zod';
import type { ObjectGallerySchema as TsObjectGallerySchema } from '../objectql';
import type { QueryParams } from '../data';

/** Root the read on THIS FILE, never on `process.cwd()` (AGENTS.md). */
const HERE = dirname(fileURLToPath(import.meta.url));
const OBJECTQL_TS = join(HERE, '..', 'objectql.ts');

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends (1 & T) ? true : false;
/** An object with no keys is assignable to `Pick<T, K>` only when `K` is optional on `T`. */
type IsOptional<T, K extends keyof T> = Record<string, never> extends Pick<T, K> ? true : false;

/**
 * The member IS the destination, by indexed access — not a copy of its arms.
 * Re-spell the arms in `../objectql.ts` and this stays green only while the two
 * agree, which is the whole reason the declaration points at the slot instead.
 */
export type _GalleryFilterIsTheDestination =
  Expect<Equal<TsObjectGallerySchema['filter'], QueryParams['$filter']>>;
/** Still optional — the narrowing is about the VALUE, not about requiredness. */
export type _GalleryFilterIsOptional = Expect<IsOptional<TsObjectGallerySchema, 'filter'>>;
/**
 * FIRING CONTROLS for the pin above, in both directions it can be wrong.
 * `unknown` is what the member held before this card: reverting the declaration
 * turns the first of these false and the file red. `IsAny` caught the other
 * reversion while `BaseSchema` carried `[key: string]: any` — deleting the
 * member entirely dropped the indexed access through that signature and would
 * otherwise have read as a pass; since objectui#8347 a deletion makes the
 * indexed access fail to compile.
 */
export type _GalleryFilterIsNotUnknownAnyMore =
  Expect<Equal<Equal<TsObjectGallerySchema['filter'], unknown>, false>>;
export type _GalleryFilterIsNotAny = Expect<Equal<IsAny<TsObjectGallerySchema['filter']>, false>>;

/** The TS face ACCEPTS both documented arms of the destination… */
const galleryArrayArm: TsObjectGallerySchema =
  { type: 'object-gallery', filter: [['status', '=', 'active']] };
const galleryRecordArm: TsObjectGallerySchema =
  { type: 'object-gallery', filter: { age: { $gt: 18 } } };

// …and REFUSES what `unknown` used to admit. Each directive goes UNUSED —
// TS2578, a hard type-check failure — the moment the member widens back.
// @ts-expect-error — `filter` is `QueryParams['$filter']`; a string clause is neither arm
const galleryStringFilter: TsObjectGallerySchema = { type: 'object-gallery', filter: 'stage=won' };
// @ts-expect-error — `filter` is `QueryParams['$filter']`; a number is neither arm
const galleryNumberFilter: TsObjectGallerySchema = { type: 'object-gallery', filter: 42 };

/**
 * The objectui#7927 ceiling was pinned here rather than claimed away: while
 * `BaseSchema` ended in `[key: string]: any`, a MISSPELLED key resolved to `any`
 * and compiled. objectui#8347 removed the signature, so the misspelling is no
 * member, and a fresh literal carrying it is refused.
 */
export type _MisspellingIsNoMember = Expect<Equal<'filtr' extends keyof TsObjectGallerySchema ? true : false, false>>;
// Lit control for the detector: `IsAny` does answer `true`, so `_GalleryFilterIsNotAny` is a reading.
export type _IsAnyCanAnswerTrue = Expect<IsAny<any>>;
// @ts-expect-error — `filtr` is no member of `ObjectGallerySchema`; the key is `filter`
const galleryMisspelledFilter: TsObjectGallerySchema = { type: 'object-gallery', filtr: 'stage=won' };

/* ── The mirror, at runtime ───────────────────────────────────────────────── */

const NODE = { type: 'object-gallery', objectName: 'account' } as const;

describe('objectui#9309 — the mirror refuses what the declaration refuses', () => {
  it('accepts both arms of the destination', () => {
    expect(ObjectGallerySchema.safeParse({ ...NODE, filter: [['status', '=', 'active']] }).success).toBe(true);
    expect(ObjectGallerySchema.safeParse({ ...NODE, filter: { age: { $gt: 18 } } }).success).toBe(true);
  });

  it('refuses the shapes `z.unknown()` used to wave through', () => {
    for (const bad of ['stage=won', 42, true]) {
      const r = ObjectGallerySchema.safeParse({ ...NODE, filter: bad });
      expect(r.success, `filter: ${JSON.stringify(bad)} should be refused`).toBe(false);
    }
  });

  it('CONTROL — the bare node still parses, so the refusals above are about the VALUE', () => {
    expect(ObjectGallerySchema.safeParse(NODE).success).toBe(true);
  });

  it('CONTROL — the objectui#7927 ceiling stands: a misspelled key still rides through', () => {
    expect(ObjectGallerySchema.safeParse({ ...NODE, filtr: 'stage=won' }).success).toBe(true);
  });
});

/* ── The census: owner and spelling, re-derived from the AST ──────────────── */

interface FilterRow {
  owner: string | undefined;
  type: string;
}

/** Charge every `filter` property signature to its nearest enclosing interface. */
function filterCensus(source: string, fileName = 'census.ts'): FilterRow[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const rows: FilterRow[] = [];
  const walk = (node: ts.Node, owner: string | undefined): void => {
    const next = ts.isInterfaceDeclaration(node) ? node.name.text : owner;
    if (
      ts.isPropertySignature(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'filter'
      && node.questionToken
    ) {
      rows.push({ owner: next, type: node.type ? node.type.getText(sf) : '(none)' });
    }
    node.forEachChild((child) => walk(child, next));
  };
  walk(sf, undefined);
  return rows;
}

/**
 * The population, in file order. ⛔ No line numbers: the file moved +241 lines
 * on the day this card was taken and would move again.
 *
 * ⚠️ Several spellings, not one (the table below is the count; AGENTS.md #9) — so "match the siblings, one vocabulary" is not
 * an argument available to anyone editing any of these. Whatever this table
 * grows into, it is a reading and not a restatement, because it is compared
 * against the parser on every run.
 */
const EXPECTED_CENSUS: readonly FilterRow[] = [
  // objectui#6152 round 8 — the grid, calendar and kanban rows take their
  // `ComponentPropsMap` row's own member by reference (the `ViewFilterRule` array).
  { owner: 'ObjectGridSchema', type: "SpecObjectGridProps['filter']" },
  { owner: 'NamedListView', type: 'any[]' },
  // objectui#6152 round 10 — the flat map and gantt mirrors take their rows' member too.
  { owner: 'ObjectMapSchema', type: "SpecObjectMapProps['filter']" },
  // objectui#9549 — declared in the shape this card settled.
  { owner: 'ObjectTreeSchema', type: "QueryParams['$filter']" },
  { owner: 'ObjectGanttSchema', type: "SpecObjectGanttProps['filter']" },
  { owner: 'ObjectCalendarSchema', type: "SpecObjectCalendarProps['filter']" },
  { owner: 'ObjectKanbanSchema', type: "SpecObjectKanbanProps['filter']" },
  { owner: 'ObjectChartSchema', type: 'any[] | Record<string, any>' },
  { owner: 'ObjectGallerySchema', type: "QueryParams['$filter']" },
  { owner: 'ObjectDataTableSchema', type: 'any' },
];

describe('objectui#9309 — the `filter` population of objectql.ts is derived, not prose', () => {
  const census = filterCensus(readFileSync(OBJECTQL_TS, 'utf8'), 'objectql.ts');

  it('the reader can actually see the file (non-vacuity)', () => {
    expect(census.length).toBeGreaterThan(0);
  });

  it('every `filter` declaration, with its owner and its spelling', () => {
    expect(census).toEqual([...EXPECTED_CENSUS]);
  });

  it('this card owns exactly one of them, and it is the gallery', () => {
    const gallery = census.filter((r) => r.owner === 'ObjectGallerySchema');
    expect(gallery).toEqual([{ owner: 'ObjectGallerySchema', type: "QueryParams['$filter']" }]);
  });

  it('`ObjectViewSchema` declares none — the category error two in-repo comments made', () => {
    expect(census.map((r) => r.owner)).not.toContain('ObjectViewSchema');
  });

  it('charges a member to its AST owner, ⛔ not to the nearest preceding `export interface` line', () => {
    // `Alpha`'s block is CLOSED before `filter` appears, and its name also
    // appears in prose in between. A proximity rule answers `Alpha` for the
    // first row; the parser answers `undefined`, and `Gamma` for a member
    // nested one object deep. If this ever reports `Alpha`, every number this
    // file derives is charged to the wrong interface.
    const fixture = [
      'export interface Alpha { a?: string; }',
      '// prose that says `export interface Alpha` and declares nothing',
      'export type Beta = { filter?: number };',
      'export interface Gamma { nested?: { filter?: boolean } }',
    ].join('\n');
    expect(filterCensus(fixture)).toEqual([
      { owner: undefined, type: 'number' },
      { owner: 'Gamma', type: 'boolean' },
    ]);
  });
});

/* Keep the type-face literals referenced so `noUnusedLocals` cannot drop them. */
describe('objectui#9309 — the type-face literals above are real', () => {
  it('both accepted arms build a node', () => {
    expect(galleryArrayArm.type).toBe('object-gallery');
    expect(galleryRecordArm.type).toBe('object-gallery');
    expect(galleryStringFilter.type).toBe('object-gallery');
    expect(galleryNumberFilter.type).toBe('object-gallery');
    expect(galleryMisspelledFilter.type).toBe('object-gallery');
  });
});
