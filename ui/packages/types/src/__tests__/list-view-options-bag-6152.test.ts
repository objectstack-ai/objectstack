/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25923 — a list view's legacy `options` bag is RETIRED, and the
 * mirror takes the `@objectstack/spec` list overlay's tombstone BY REFERENCE.
 *
 * From objectui#6152 round 12 until #25923 the bag was the list overlay's own
 * judged underlay: a strict object of the eight kinds that name a block, each
 * judged by its list-view slot with every key optional, and this mirror took it
 * by reference (objectui#8327 forbids accepting what that door refuses). The
 * spec retired the bag: the overlay member is a `retiredKey()` tombstone that
 * refuses `options` by name with the move-to-the-top-level prescription, and a
 * stored bag is folded onto the top-level blocks by the ADR-0087 D2 conversion
 * `list-view-options-bag-folded` before a row is served. The readers retired in
 * the same change. The blocks below:
 *
 *   1. the overlay's `options`, on the INSTALLED spec: a tombstone;
 *   2. the mirror IS that tombstone, by reference;
 *   3. every door refuses a bag at `options`, whatever it holds, with the
 *      spec's text — and the same blocks written top-level parse;
 *   4. each named refusal that used to apply under `options.KIND` applies at the
 *      top-level block, the one nesting left, with its canonical hint;
 *   5. the TypeScript face: no bag compiles.
 */
import { describe, it, expect } from 'vitest';

import { ListViewSchema as SpecListViewSchema, VIEW_METADATA_MEMBERS } from '@objectstack/spec/ui';
import type { ListViewSchema as TsListViewSchema, ListViewTimelineConfig } from '../objectql';
import { ListViewSchema } from '../zod/objectql.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';
import { onPageSpelling } from './list-view-page-node';
// @ts-expect-error — `ListViewGalleryConfig` is retired (objectui#6152 round 12): write the spec's `GalleryConfig`.
import type { ListViewGalleryConfig } from '../index';

/** Compile-time half of the retirement above: the import fails, so this is `any`. */
export type RetiredGalleryConfig = ListViewGalleryConfig;

/* ── Instruments ─────────────────────────────────────────────────────────────── */

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };
type Parsed = { success: boolean; data?: unknown; error?: { issues: readonly Issue[] } };
type Parse = (doc: unknown) => Parsed;
type Zod = {
  safeParse: Parse;
  unwrap: () => Zod;
  description?: string;
  shape: Record<string, Zod>;
  _zod: { def: { type: string; innerType?: Zod } };
};

const codeAndPath = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.') })));

const SPEC_SLOTS = (SpecListViewSchema as unknown as Zod).shape;
/** The spec's list overlay `options` member (the overlay's own schema is module-private). */
const SPEC_OPTIONS = (VIEW_METADATA_MEMBERS.listOverlay as unknown as Zod).shape.options;
const MIRROR_OPTIONS = (ListViewSchema as unknown as Zod).shape.options;
/** The tombstone's refusal text, read off the spec. */
const REFUSAL = SPEC_OPTIONS.safeParse({}).error!.issues[0].message;

const NODE = { type: 'list-view', objectName: 'deal' };
/**
 * The mirror is the `ListView` component's props; the three published faces
 * judge the authored PAGE node since objectui#12670, its props in the
 * `properties` bag, so each re-spells the node and reads its paths relative to
 * the bag (`onPageSpelling`).
 */
const DOORS: ReadonlyArray<readonly [string, Parse]> = [
  ['the list-view mirror', (d) => ListViewSchema.safeParse(d)],
  ['the tolerant face', onPageSpelling((d) => AnyComponentSchema.safeParse(d) as Parsed)],
  ['the strict face', onPageSpelling((d) => StrictAnyComponentSchema.safeParse(d) as Parsed)],
  ['safeValidateSchema', onPageSpelling((d) => safeValidateSchema(d) as Parsed)],
];

/** The blocks app-shell's object page relays, each in full. */
const RELAYED_BLOCKS: Record<string, Record<string, unknown>> = {
  kanban: { groupByField: 'stage', titleField: 'name', columns: ['name'] },
  calendar: { startDateField: 'starts_at' },
  timeline: { startDateField: 'starts_at', titleField: 'name' },
  map: { locationField: 'address', titleField: 'name' },
  gallery: { coverField: 'logo', titleField: 'name' },
  gantt: { startDateField: 'starts_at', endDateField: 'ends_at', titleField: 'name' },
  tree: { parentField: 'parent', labelField: 'name' },
  chart: { chartType: 'bar', dataset: 'deal_ds', dimensions: ['stage'], values: ['total'] },
};

/* ── 1. The overlay's `options`, on the installed protocol (the precondition) ── */

describe('#25923 — the installed list overlay\'s `options` is a tombstone', () => {
  it('is `optional` around `never`, described `[REMOVED]`, and refuses a bag with the move-to-the-top-level prescription', () => {
    expect(SPEC_OPTIONS._zod.def.type).toBe('optional');
    expect(SPEC_OPTIONS.unwrap()._zod.def.type).toBe('never');
    expect(SPEC_OPTIONS.description).toMatch(/^\[REMOVED\] /);
    expect(REFUSAL).toMatch(/^A list view's `options` bag was removed in @objectstack\/spec /);
    expect(REFUSAL).toContain('Move each `options.KIND` block to `KIND`');
  });

  it('the authoring list view declares no bag at all', () => {
    expect('options' in SPEC_SLOTS).toBe(false);
  });
});

/* ── 2. The mirror IS the tombstone ──────────────────────────────────────────── */

describe('#25923 — `ListViewSchema.options` takes the overlay\'s tombstone by reference', () => {
  it('is the very member the spec declares', () => {
    expect(MIRROR_OPTIONS).toBe(SPEC_OPTIONS);
  });
});

/* ── 3. Every door refuses a bag, whatever it holds ──────────────────────────── */

const BAGS: ReadonlyArray<readonly [string, unknown]> = [
  ['an empty bag', {}],
  ['the bag app-shell\'s object page used to relay', RELAYED_BLOCKS],
  ['partial blocks', { kanban: { titleField: 'name' }, chart: { chartType: 'bar' } }],
  ['`options.grid`', { grid: {} }],
  ['a bag that is not an object', 'kanban'],
];

describe('#25923 — every door refuses `options` at `options`, with the spec\'s text', () => {
  for (const [door, parse] of DOORS) {
    it.each(BAGS)(`${door}: %s`, (_label, options) => {
      const r = parse({ ...NODE, options });
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.path.join('.') === 'options');
      expect(issue, JSON.stringify(r.error!.issues)).toBeDefined();
      expect(issue!.message).toBe(REFUSAL);
    });

    it(`${door}: LIT CONTROL — the same blocks written top-level parse`, () => {
      const r = parse({ ...NODE, ...RELAYED_BLOCKS });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    });
  }
});

/* ── 4. The named refusals, at the top-level block ───────────────────────────── */

const REFUSED: ReadonlyArray<readonly [string, string, string | null]> = [
  ['kanban', 'groupField', 'groupByField'],
  ['kanban', 'cardFields', 'columns'],
  ['kanban', 'groupBy', 'groupByField'],
  ['gallery', 'imageField', 'coverField'],
  ['timeline', 'dateField', 'startDateField'],
  ['calendar', 'dateField', 'startDateField'],
  ['calendar', 'endField', 'endDateField'],
  ['calendar', 'defaultView', null],
];
const VALUE: Record<string, unknown> = { cardFields: ['name'], defaultView: 'week' };
const valueOf = (key: string) => VALUE[key] ?? 'stage';
/** A top-level block each slot accepts in full, so only the refused key answers there. */
const TOP_BASE: Record<string, Record<string, unknown>> = {
  kanban: { groupByField: 'stage', columns: ['name'] },
  calendar: { startDateField: 'starts_at' },
  gallery: {},
  timeline: { startDateField: 'starts_at', titleField: 'name' },
};

describe('#25923 — every named refusal the bag carried applies at the top-level block', () => {
  for (const [door, parse] of DOORS) {
    it.each(REFUSED)(`${door}: %s.%s is refused at that key (canonical: %s)`, (k, key, canonical) => {
      const r = parse({ ...NODE, [k]: { ...TOP_BASE[k], [key]: valueOf(key) } });
      expect(r.success).toBe(false);
      expect(codeAndPath(r)).toContainEqual({ code: 'invalid_type', path: `${k}.${key}` });
      const issue = r.error!.issues.find((i) => i.path.join('.') === `${k}.${key}`);
      if (canonical) expect(issue?.message).toContain(`Did you mean \`${key}\` → \`${canonical}\`?`);
    });
  }
});

/* ── 5. The TypeScript face ──────────────────────────────────────────────────── */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

describe('#25923 — the TypeScript face carries no bag', () => {
  it('no bag compiles on a list view, and the same block compiles top-level', () => {
    const live: TsListViewSchema = { type: 'list-view', objectName: 'deal', kanban: { groupByField: 'stage', columns: ['name'] } };
    const refused: TsListViewSchema[] = [
      // @ts-expect-error — the bag is retired: write the block top-level.
      { type: 'list-view', objectName: 'deal', options: { kanban: { groupByField: 'stage', columns: ['name'] } } },
      // @ts-expect-error — even an empty bag.
      { type: 'list-view', objectName: 'deal', options: {} },
    ];
    expect(live.kanban?.groupByField).toBe('stage');
    expect(refused).toHaveLength(2);
  });

  it('`ListViewTimelineConfig` is the list view\'s own `timeline` block, closed, with `dateField` refused', () => {
    const same: Equal<ListViewTimelineConfig, NonNullable<TsListViewSchema['timeline']>> = true;
    const closed: string extends keyof ListViewTimelineConfig ? 'open' : 'closed' = 'closed';
    // @ts-expect-error — `dateField` is refused by name: write `startDateField`.
    const alias: ListViewTimelineConfig = { dateField: 'starts_at' };
    expect([same, closed, alias.titleField]).toEqual([true, 'closed', undefined]);
  });
});
