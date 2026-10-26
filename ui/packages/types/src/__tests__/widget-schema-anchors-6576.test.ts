/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6576 — the two widget prop types that declared their `schema` as a
 * hand-rolled inline object literal are anchored to NAMED schema types that
 * `extends BaseSchema` (maintainer ruling 2026-08-31, option A). Folds
 * objectui#6914: `ObjectDataTableSchema` declares the two keys the widget was
 * reading behind casts.
 *
 * ## What was wrong
 *
 * `ObjectGalleryProps.schema` (plugin-list) and `ObjectDataTableProps.schema`
 * (plugin-dashboard) were the ONLY two `Object*Props` in the repo whose
 * `schema` member anchored to no named type at all. Because nothing in their
 * ancestry reached `BaseSchema`, none of its declared members existed on them —
 * every base key an author may legitimately write had to be hand-copied into
 * the literal (`bind`, `className` were), and the two literals disagreed on
 * strictness: the gallery had no index signature and REJECTED `visibleWhen`,
 * a real base member, as an unknown key; the data-table carried its own
 * `[key: string]: any` and had already drifted — it read `drillDown` and
 * `onRowClick` and declared neither (objectui#6914).
 *
 * ## What this file pins, and where the rest lives
 *
 * 1. TYPE-LEVEL, on the two new declarations in this package: both extend
 *    `BaseSchema`, carry the widget's registry key as their `type` literal,
 *    inherit the base members with their DECLARED types (not `any`), and
 *    `ObjectDataTableSchema` declares `drillDown` / `onRowClick` with the exact
 *    types measured where they were declared before (`DrillDownConfig` on
 *    `ChartSchema` / `PivotTableSchema`; `onRowClick` on `DataTableSchema`).
 *    `tsconfig.test.json` compiles this file, so these are real enforcement.
 * 2. SOURCE-LEVEL, on the two widget files: `schema:` anchors to the named type,
 *    no inline `schema: {` literal remains, the local `bind` re-declaration and
 *    the data-table's own index signature are gone, and the two #6914 casts are
 *    gone with them. Read off disk the way `base-bind-declared.test.ts` reads
 *    its readers — this package cannot import the plugins.
 * 3. DRIFT, the objectui#6170 / #6357 class the inline shape invited: every key
 *    a widget reads off `schema` is a key its zod mirror declares — both
 *    widgets in ONE run so each is the other's control. The single deliberate
 *    exception is ledgered by name below and in `zod-mirror-parity.test.ts`.
 *
 * The anchoring of each PROP type to its schema type is pinned where it can be
 * compiled — beside the widget:
 * `plugin-list/src/__tests__/ObjectGallery.schemaAnchor-6576.test.ts` and
 * `plugin-dashboard/src/__tests__/ObjectDataTable.schemaAnchor-6576.test.ts`.
 *
 * ## The ceiling, stated rather than assumed (objectui#5155)
 *
 * While `BaseSchema` carried `[key: string]: any`, anchoring bought DECLARED
 * members their declared types (`visible: 42` is refused on both widgets now)
 * but did NOT buy rejection of a misspelling: `visibleWhn` compiled on both.
 * The ruling accepted that cost knowingly, and the counter-probe below pinned
 * it honestly so nobody read the anchor as more than it was. objectui#8347
 * landed that objectui#5155 phase and the expectation was revisited: the
 * counter-probe now pins the refusal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { BaseSchema } from '../base.js';
import type { ObjectDataTableDrillDownConfig } from '../data-display.js';
import type { ObjectGallerySchema, ObjectDataTableSchema } from '../objectql.js';
import {
  ObjectGallerySchema as ObjectGalleryMirror,
  ObjectDataTableSchema as ObjectDataTableMirror,
} from '../zod/objectql.zod.js';
import type { ExpressionWire } from '../expression';
import type { EvaluatedExpressionInput } from '@objectstack/spec/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/* ── Type-level pins (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** Tuple-wrapped so a union declared type is judged whole, not limb by limb. */
type ExtendsBase<T> = [T] extends [BaseSchema] ? true : false;

export type assertionGalleryExtendsBase = Expect<ExtendsBase<ObjectGallerySchema>>;
export type assertionDataTableExtendsBase = Expect<ExtendsBase<ObjectDataTableSchema>>;
export type assertionGalleryTypeIsRegistryKey = Expect<Equal<ObjectGallerySchema['type'], 'object-gallery'>>;
export type assertionDataTableTypeIsRegistryKey = Expect<Equal<ObjectDataTableSchema['type'], 'object-data-table'>>;
/**
 * objectui#6914 — declared with the types measured at their prior homes.
 * `drillDown` has since moved to this block's own shape, the shared
 * `DrillDownConfig` with `filter` / `maxRows` / `report` refused and `target`
 * narrowed (objectui#10685); `Equal` keeps it from drifting back to the shared type.
 */
export type assertionDrillDownDeclared = Expect<Equal<ObjectDataTableSchema['drillDown'], ObjectDataTableDrillDownConfig | undefined>>;
/**
 * ⭐ STILL measured at its prior home, which is the point of leaving this pin
 * `Equal` rather than relaxing it: objectui#6576 declared `onRowClick` here with
 * the spelling `DataTableSchema` carried, objectui#9462 widened THAT twin to two
 * parameters, and objectui#9799 brought this one back into step. The pin moved
 * with the measurement, ⛔ not ahead of it — an `extends` check would have been
 * green through all three states, since `(row) => void` and `(row, event?) => void`
 * satisfy each other in both directions.
 */
export type assertionOnRowClickDeclared = Expect<Equal<ObjectDataTableSchema['onRowClick'], ((row: any, event?: any) => void) | undefined>>;
/**
 * Inherited members resolve to their DECLARED types. `Equal`, not `extends`:
 * through the index signature a missing member read `any` until objectui#8347
 * (it fails to compile now), which a one-way check would accept (the
 * objectui#7087 disabled-twin lesson).
 */
// `string` until objectui#8347 typed it as the spec's evaluated-slot input, by reference.
export type assertionGalleryInheritsVisibleWhen = Expect<Equal<ObjectGallerySchema['visibleWhen'], EvaluatedExpressionInput | undefined>>;
export type assertionGalleryInheritsBind = Expect<Equal<ObjectGallerySchema['bind'], string | undefined>>;
// `boolean | string` until objectui#7530 declared the CEL envelope on the base union.
export type assertionDataTableInheritsVisible = Expect<Equal<ObjectDataTableSchema['visible'], boolean | ExpressionWire | undefined>>;
export type assertionDataTableInheritsBind = Expect<Equal<ObjectDataTableSchema['bind'], string | undefined>>;
/** The widget-local members keep their measured spellings. */
export type assertionGalleryDataStaysTyped = Expect<Equal<ObjectGallerySchema['data'], Record<string, unknown>[] | undefined>>;
export type assertionDataTableDataStaysTyped = Expect<Equal<ObjectDataTableSchema['data'], any[] | undefined>>;
/** The helpers can FAIL — synthetic controls. */
export type assertionExtendsBaseCanFail = Expect<Equal<ExtendsBase<{ objectName: string }>, false>>;
export type assertionEqualCanFail = Expect<Equal<Equal<any, string | undefined>, false>>;

describe('ObjectGallerySchema / ObjectDataTableSchema — compile-time pins (objectui#6576)', () => {
  it('refuses a wrong-typed inherited base member on BOTH new types', () => {
    // Before this card: the gallery literal had no `visible` key at all (an
    // unknown-key error, for the wrong reason); the data-table literal's own
    // index signature typed it `any` and ACCEPTED 42. Now both refuse it for
    // the declared reason. Each directive fails the build (TS2578) the moment
    // the member is widened to accept a number; since objectui#8347 an
    // undeclared `visible` is refused as excess, so a deletion is caught by the
    // inherited-member `Equal` rows instead.

    // @ts-expect-error — `visible` is `boolean | ExpressionWire | undefined` through `BaseSchema`.
    const gallery: ObjectGallerySchema = { type: 'object-gallery', visible: 42 };
    // @ts-expect-error — same member, same reason, on the type that used to absorb it.
    const table: ObjectDataTableSchema = { type: 'object-data-table', visible: 42 };

    expect([gallery.visible, table.visible]).toEqual([42, 42]);
  });

  it('accepts a real base member the gallery literal used to refuse', () => {
    const gallery: ObjectGallerySchema = { type: 'object-gallery', objectName: 'account', visibleWhen: '${data.ready}' };
    expect(gallery.visibleWhen).toBe('${data.ready}');
  });

  it('declares the two keys the data-table reads (objectui#6914) — the row is contextually typed, no cast', () => {
    const table: ObjectDataTableSchema = {
      type: 'object-data-table',
      objectName: 'account',
      drillDown: { enabled: true, mode: 'record', target: 'dialog' },
      onRowClick: (row) => { void row; },
    };
    expect(table.drillDown?.mode).toBe('record');
    expect(typeof table.onRowClick).toBe('function');
  });

  it('refuses a MISSPELLING — the ceiling this row pinned is gone (objectui#8347)', () => {
    // This row was the counter-probe against reading the anchor as more than it
    // was: `BaseSchema`'s inherited `[key: string]: any` let `visibleWhn` compile
    // on both, and closing that was left to the removal of the signature, which
    // landed as objectui#8347.
    // @ts-expect-error — `visibleWhn` is no member; the key is `visibleWhen`
    const gallery: ObjectGallerySchema = { type: 'object-gallery', visibleWhn: 'typo' };
    // @ts-expect-error — `visibleWhn` is no member; the key is `visibleWhen`
    const table: ObjectDataTableSchema = { type: 'object-data-table', visibleWhn: 'typo' };
    expect([gallery.type, table.type]).toEqual(['object-gallery', 'object-data-table']);
  });
});

/* ── Source-level pins on the two widget files ─────────────────────────────── */

const WIDGETS = [
  {
    file: 'packages/plugin-list/src/ObjectGallery.tsx',
    props: 'ObjectGalleryProps',
    anchor: 'ObjectGallerySchema',
    registryKey: 'object-gallery' satisfies ObjectGallerySchema['type'],
    /** Where `ComponentRegistry.register(...)` for this widget lives. */
    registrationFile: 'packages/plugin-list/src/ObjectGallery.tsx',
    mirror: ObjectGalleryMirror,
    /** Keys read off `schema` that the mirror deliberately does not declare. */
    unmirroredReads: [] as readonly string[],
    retiredCasts: [] as readonly string[],
  },
  {
    file: 'packages/plugin-dashboard/src/ObjectDataTable.tsx',
    props: 'ObjectDataTableProps',
    anchor: 'ObjectDataTableSchema',
    registryKey: 'object-data-table' satisfies ObjectDataTableSchema['type'],
    /** The dashboard plugin registers its widgets from the barrel, not the widget file. */
    registrationFile: 'packages/plugin-dashboard/src/index.tsx',
    mirror: ObjectDataTableMirror,
    // `drillDown` was listed here while it was ledgered as unmirrored in
    // `zod-mirror-parity.test.ts` (`UnmirroredDeclared`, LOCAL — the same
    // reading as `ChartSchema.drillDown`). objectui#7352 minted
    // `DrillDownConfigSchema` and wired it into this mirror, so the key is now
    // DECLARED by the mirror and needs no exception: the census below reads it
    // out of `mirror.shape`. An exception left standing here would be a hole —
    // it widens `declared` for a key nothing checks any more.
    unmirroredReads: [] as readonly string[],
    /** The two objectui#6914 casts the declaration makes unnecessary. */
    retiredCasts: ['schema.drillDown as DrillDownConfig', '(schema as any).onRowClick'] as readonly string[],
  },
] as const;

/** The `export interface <Props> { … }` block, up to its column-0 closing brace. */
function propsInterface(src: string, props: string): string {
  const start = src.indexOf(`export interface ${props} {`);
  if (start < 0) return '';
  const end = src.indexOf('\n}', start);
  return end < 0 ? '' : src.slice(start, end + 2);
}

/** Every key read off `schema`, cast-aware: `schema.x`, `schema?.x`, `(schema as any).x`, `schema['x']`. */
function schemaReads(src: string): Set<string> {
  const re = /\bschema(?:\?)?\.([A-Za-z_$][\w$]*)|\(schema as any\)\.([A-Za-z_$][\w$]*)|\bschema\[['"]([A-Za-z_$][\w$]*)['"]\]/g;
  const out = new Set<string>();
  for (const m of src.matchAll(re)) out.add(m[1] ?? m[2] ?? m[3]);
  return out;
}

describe('the two widget prop types anchor `schema` to the named type (objectui#6576)', () => {
  it.each(WIDGETS)('$file — the `schema` member of $props is `$anchor`, with no inline literal, local `bind` or index signature left', ({ file, props, anchor }) => {
    const iface = propsInterface(readFileSync(join(REPO_ROOT, file), 'utf8'), props);
    // Non-vacuity: the block must exist and must still declare a `schema` member.
    expect(iface, `${file} no longer declares \`export interface ${props}\``).not.toBe('');
    expect(iface).toMatch(/\bschema:/);

    expect(iface).toMatch(new RegExp(`\\bschema:\\s*${anchor};`));
    expect(iface, 'the hand-rolled inline literal is back').not.toMatch(/\bschema:\s*\{/);
    expect(iface, 'a local `bind` re-declaration is back — it is inherited from BaseSchema (objectui#6357)').not.toMatch(/\bbind\?:/);
    expect(iface, 'a local index signature is back').not.toMatch(/\[key: string\]: any/);
  });

  it.each(WIDGETS)('$registrationFile — the `type` literal on $anchor is the key the widget registers', ({ registrationFile, registryKey }) => {
    const src = readFileSync(join(REPO_ROOT, registrationFile), 'utf8');
    // `register(` is split across lines in plugin-dashboard; a line-anchored grep misses it.
    expect(src).toMatch(new RegExp(`ComponentRegistry\\.register\\(\\s*'${registryKey}'`));
  });

  it.each(WIDGETS)('$file — every key read off `schema` is declared by the mirror (or ledgered), and the #6914 casts are gone', ({ file, mirror, unmirroredReads, retiredCasts }) => {
    const src = readFileSync(join(REPO_ROOT, file), 'utf8');
    const reads = schemaReads(src);
    // Non-vacuity: a widget that reads nothing off `schema` would pass vacuously.
    expect(reads.size).toBeGreaterThan(3);
    expect(reads.has('objectName')).toBe(true);

    const declared = new Set([...Object.keys(mirror.shape), ...unmirroredReads]);
    const readNotDeclared = [...reads].filter((k) => !declared.has(k)).sort();
    expect(readNotDeclared, `${file} reads keys its schema type does not declare (objectui#6914 class)`).toEqual([]);

    // Each ledgered exception must still be READ — a stale exception is a hole.
    for (const key of unmirroredReads) expect(reads.has(key), `${key} is ledgered as unmirrored but no longer read`).toBe(true);
    for (const cast of retiredCasts) expect(src, `${cast} — the declaration made this cast unnecessary`).not.toContain(cast);
  });

  it('the read census can see a drifted key (non-vacuity control)', () => {
    // A census that returned an empty set for any input would pass the pin above
    // while measuring nothing. Feed it a source with one undeclared read.
    const reads = schemaReads("const a = schema.objectName; const b = (schema as any).drillDwon; const c = schema?.filter; const d = schema['data'];");
    expect([...reads].sort()).toEqual(['data', 'drillDwon', 'filter', 'objectName']);
    const declared = new Set(Object.keys(ObjectDataTableMirror.shape));
    expect([...reads].filter((k) => !declared.has(k))).toEqual(['drillDwon']);
  });
});
