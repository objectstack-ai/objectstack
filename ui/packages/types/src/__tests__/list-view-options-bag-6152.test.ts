/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6152 round 12 — a list view's legacy `options` bag is the
 * `@objectstack/spec` list overlay's own bag, BY REFERENCE.
 *
 * The spec's authoring list view declares no `options`. Its one home is the
 * flattened LIST OVERLAY on the view write door (`VIEW_METADATA_MEMBERS.listOverlay`):
 * a strict object of the eight kinds that name a block, each judged by its own
 * list-view slot with every key optional. `ListViewSchema.options` was a record
 * of `any` with three named refusals, so every door and the TypeScript face
 * accepted what that door refuses. objectui#8327 forbids that, and the seat
 * answered the round's census Q1 → A (objectui#6152, 6070475966). The blocks below:
 *
 *   1. the overlay's bag, measured on the INSTALLED spec — its key set derived
 *      by the spec's own rule, each kind strict and fully optional, so a spec bump
 *      that moves any of that reds here by name;
 *   2. the mirror IS that bag: strict, the same key set and error map, each kind
 *      the slot `.partial()`, with this package's round-11 blocks (and only their
 *      named refusal arms) in four of them;
 *   3. verdict equality with the spec's bag over accepted and refused documents,
 *      and the sanctioned differences, each named;
 *   4. every named refusal under `options.KIND`, through every door, with ONE
 *      message in both nestings;
 *   5. undeclared keys and kinds, through every door (`options.grid` with the
 *      spec's guidance);
 *   6. the TypeScript face, closed the same way, and the two config types.
 *
 * ⛔ The READERS are not this round's: `ListView` still merges and spreads the
 * bag. Nothing here asserts them.
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
  shape: Record<string, Zod>;
  _zod: { def: { type: string; innerType?: Zod; catchall?: Zod; error?: unknown; values?: unknown[]; entries?: Record<string, unknown> } };
};

const verdict = (r: Parsed) => ({
  success: r.success,
  issues: r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path, message: i.message, keys: i.keys })),
});
const codeAndPath = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.') })));
const catchallOf = (object: Zod) => object._zod.def.catchall?._zod.def.type;
/** The members an object REQUIRES: those whose schema refuses `undefined`. */
const requiredOf = (object: Zod) => Object.keys(object.shape).filter((k) => !object.shape[k].safeParse(undefined).success).sort();

const SPEC_SLOTS = (SpecListViewSchema as unknown as Zod).shape;
/** The spec's list overlay bag, read off the overlay member (the bag's own schema is module-private). */
const SPEC_BAG_OPTIONAL = (VIEW_METADATA_MEMBERS.listOverlay as unknown as Zod).shape.options;
const SPEC_BAG = SPEC_BAG_OPTIONAL.unwrap();
const MIRROR_BAG_OPTIONAL = (ListViewSchema as unknown as Zod).shape.options;
const MIRROR_BAG = MIRROR_BAG_OPTIONAL.unwrap();

/** The spec's own rule for the bag's key set: a value of the list view's `type` enum that also names a block. */
const typeValues = (): string[] => {
  let cur: Zod | undefined = SPEC_SLOTS.type;
  while (cur && !cur._zod.def.entries) cur = cur._zod.def.innerType;
  return Object.keys(cur!._zod.def.entries!);
};
const KINDS = typeValues().filter((t) => t in SPEC_SLOTS).sort();

/** The four kinds that are this package's round-11 blocks, with their named refusal arms. */
const ARMS: Record<string, readonly string[]> = {
  kanban: ['groupField', 'cardFields', 'groupBy'],
  calendar: ['defaultView', 'dateField', 'endField'],
  gallery: ['imageField'],
  timeline: ['dateField'],
};

const NODE = { type: 'list-view', objectName: 'deal' };
/**
 * The mirror is the `ListView` component's props; the three published faces
 * judge the authored PAGE node since objectui#12670, its props in the
 * `properties` bag, so each re-spells the node and reads its paths relative to
 * the bag (`onPageSpelling`). The bag's `options` is the mirror's, by reference.
 */
const DOORS: ReadonlyArray<readonly [string, Parse]> = [
  ['the list-view mirror', (d) => ListViewSchema.safeParse(d)],
  ['the tolerant face', onPageSpelling((d) => AnyComponentSchema.safeParse(d) as Parsed)],
  ['the strict face', onPageSpelling((d) => StrictAnyComponentSchema.safeParse(d) as Parsed)],
  ['safeValidateSchema', onPageSpelling((d) => safeValidateSchema(d) as Parsed)],
];

/* ── 1. The overlay's bag, on the installed protocol (the precondition) ──────── */

describe('objectui#6152 round 12 — the installed list overlay\'s `options` bag', () => {
  it('is `optional` around a STRICT object whose keys are exactly the kinds that name a block', () => {
    expect(SPEC_BAG_OPTIONAL._zod.def.type).toBe('optional');
    expect(SPEC_BAG._zod.def.type).toBe('object');
    expect(catchallOf(SPEC_BAG)).toBe('never');
    expect(KINDS).toEqual(['calendar', 'chart', 'gallery', 'gantt', 'kanban', 'map', 'timeline', 'tree']);
    expect(Object.keys(SPEC_BAG.shape).sort()).toEqual(KINDS);
  });

  it.each(KINDS)('%s is the list-view slot with every key optional, strict', (k) => {
    const block = SPEC_BAG.shape[k].unwrap();
    expect(catchallOf(block)).toBe('never');
    expect(Object.keys(block.shape).sort()).toEqual(Object.keys(SPEC_SLOTS[k].unwrap().shape).sort());
    expect(requiredOf(block)).toEqual([]);
  });

  it('the authoring list view declares no bag at all', () => {
    expect('options' in SPEC_SLOTS).toBe(false);
  });
});

/* ── 2. The mirror IS the bag ────────────────────────────────────────────────── */

describe('objectui#6152 round 12 — `ListViewSchema.options` takes the overlay\'s bag by reference', () => {
  it('is `optional` around a STRICT object with the bag\'s key set and the bag\'s own error map', () => {
    expect(MIRROR_BAG_OPTIONAL._zod.def.type).toBe('optional');
    expect(catchallOf(MIRROR_BAG)).toBe('never');
    expect(Object.keys(MIRROR_BAG.shape).sort()).toEqual(KINDS);
    expect(MIRROR_BAG._zod.def.error).toBe(SPEC_BAG._zod.def.error);
  });

  it.each(KINDS)('%s: strict, fully optional, every slot member present, nothing beside them but refusal arms', (k) => {
    const block = MIRROR_BAG.shape[k].unwrap();
    expect(catchallOf(block)).toBe('never');
    expect(requiredOf(block)).toEqual([]);
    const slotKeys = Object.keys(SPEC_SLOTS[k].unwrap().shape);
    expect(slotKeys.filter((key) => !(key in block.shape))).toEqual([]);
    const local = Object.keys(block.shape).filter((key) => !slotKeys.includes(key)).sort();
    expect(local).toEqual([...(ARMS[k] ?? [])].sort());
    for (const key of local) {
      expect(block.shape[key].safeParse(undefined).success).toBe(true);
      for (const value of ['x', 1, true, ['x'], {}]) expect(block.shape[key].safeParse(value).success).toBe(false);
    }
  });

  it('kanban, gallery and timeline ARE this package\'s top-level blocks; calendar is its block made partial', () => {
    const top = (ListViewSchema as unknown as Zod).shape;
    for (const k of ['kanban', 'gallery', 'timeline']) expect(MIRROR_BAG.shape[k].unwrap(), k).toBe(top[k].unwrap());
    expect(Object.keys(MIRROR_BAG.shape.calendar.unwrap().shape).sort()).toEqual(Object.keys(top.calendar.unwrap().shape).sort());
    expect(requiredOf(top.calendar.unwrap())).toEqual(['startDateField']);
  });
});

/* ── 3. Verdict equality with the spec's bag ─────────────────────────────────── */

/** Bag documents none of which names a refusal arm (section 4 is where the faces differ on purpose). */
const EQUALITY: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['an empty bag', {}],
  ['the bag app-shell\'s object page relays', {
    kanban: { groupByField: 'stage', titleField: 'name', columns: ['name'] },
    calendar: { startDateField: 'starts_at' },
    timeline: { startDateField: 'starts_at', titleField: 'name' },
    map: { locationField: 'address', titleField: 'name' },
    gallery: { coverField: 'logo', titleField: 'name' },
    gantt: { startDateField: 'starts_at', endDateField: 'ends_at', titleField: 'name' },
    tree: { parentField: 'parent', labelField: 'name' },
    chart: { chartType: 'bar', dataset: 'deal_ds', dimensions: ['stage'], values: ['total'] },
  }],
  ['partial blocks (no required member asked)', { kanban: { titleField: 'name' }, timeline: { titleField: 'name' }, calendar: { titleField: 'name' }, chart: { chartType: 'bar' } }],
  ['`options.grid`', { grid: {} }],
  ['a key that is no kind', { zzqxNotAKind: true }],
  ['kanban: an undeclared key', { kanban: { swimlaneField: 'owner' } }],
  ['gallery: an undeclared key', { gallery: { zzqxNoSuchField: 1 } }],
  ['timeline: `descriptionField`', { timeline: { descriptionField: 'notes' } }],
  ['timeline: `endField`', { timeline: { endField: 'ends_at' } }],
  ['tree: `titleField`', { tree: { titleField: 'name' } }],
  ['chart: the legacy axes', { chart: { chartType: 'bar', xAxisField: 'stage', yAxisFields: ['amount'], aggregation: 'sum' } }],
  ['map: an undeclared key', { map: { locationField: 'address', zzqxNoSuchField: 1 } }],
  ['gantt: an undeclared key', { gantt: { startDateField: 's', zzqxNoSuchField: 1 } }],
  ['a kind that is not an object', { kanban: 42 }],
  ['a field name that is a number', { kanban: { groupByField: 5 } }],
  ['an unknown gallery card size', { gallery: { cardSize: 'huge' } }],
  ['an unknown timeline scale', { timeline: { scale: 'decade' } }],
];

describe('objectui#6152 round 12 — verdict equality: the mirror answers as the spec\'s bag does', () => {
  it.each(EQUALITY)('%s', (_label, bag) => {
    expect(verdict(MIRROR_BAG.safeParse(bag))).toEqual(verdict(SPEC_BAG.safeParse(bag)));
  });

  it('LIT CONTROL: the table holds accepted AND refused rows', () => {
    const outcomes = EQUALITY.map(([, bag]) => SPEC_BAG.safeParse(bag).success);
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
  });

  it('SANCTIONED DIFFERENCE: the mirror writes no default into a bag that did not carry it', () => {
    // The spec's chart slot defaults `chartType`; this package strips imported
    // defaults at its boundary (objectui#8317), so the parse returns the bag as written.
    expect(SPEC_BAG.safeParse({ chart: {} }).data).toEqual({ chart: { chartType: 'bar' } });
    expect(MIRROR_BAG.safeParse({ chart: {} }).data).toEqual({ chart: {} });
  });
});

/* ── 4. The named refusals, under `options.KIND` ─────────────────────────────── */

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

describe('objectui#6152 round 12 — every named refusal applies under `options.KIND`, with ONE message', () => {
  it.each(REFUSED)('%s.%s: the spec\'s bag refuses it as an unrecognized key', (k, key) => {
    const r = SPEC_BAG.safeParse({ [k]: { [key]: valueOf(key) } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), keys: i.keys }))).toEqual([
      { code: 'unrecognized_keys', path: k, keys: [key] },
    ]);
  });

  it.each(REFUSED)('%s.%s: the mirror refuses it at its own path, with the top-level block\'s message (canonical: %s)', (k, key, canonical) => {
    const nested = ListViewSchema.safeParse({ ...NODE, options: { [k]: { [key]: valueOf(key) } } }) as Parsed;
    const issue = nested.error?.issues.find((i) => i.path.join('.') === `options.${k}.${key}`);
    expect(issue?.code).toBe('invalid_type');
    const topLevel = ListViewSchema.safeParse({ ...NODE, [k]: { ...TOP_BASE[k], [key]: valueOf(key) } }) as Parsed;
    const top = topLevel.error?.issues.find((i) => i.path.join('.') === `${k}.${key}`);
    expect(top?.code).toBe('invalid_type');
    expect(issue?.message).toBe(top?.message);
    if (canonical) expect(issue?.message).toContain(`Did you mean \`${key}\` → \`${canonical}\`?`);
  });

  for (const [door, parse] of DOORS) {
    it.each(REFUSED)(`${door}: a list-view node with options.%s.%s is refused at that key`, (k, key) => {
      const r = parse({ ...NODE, options: { [k]: { [key]: valueOf(key) } } });
      expect(r.success).toBe(false);
      expect(codeAndPath(r)).toContainEqual({ code: 'invalid_type', path: `options.${k}.${key}` });
    });

    it(`${door}: LIT CONTROL — the bag app-shell's object page relays parses`, () => {
      const r = parse({ ...NODE, options: EQUALITY[1][1] });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    });
  }
});

/* ── 5. Undeclared keys and kinds, through every door ────────────────────────── */

describe('objectui#6152 round 12 — what the bag does not declare is refused with the spec\'s own `unrecognized_keys`', () => {
  const UNDECLARED: ReadonlyArray<readonly [string, Record<string, unknown>, string, string]> = [
    ['`options.grid`', { grid: {} }, 'options', 'grid'],
    ['a key that is no kind', { zzqxNotAKind: true }, 'options', 'zzqxNotAKind'],
    ['kanban.swimlaneField', { kanban: { swimlaneField: 'owner' } }, 'options.kanban', 'swimlaneField'],
    ['timeline.descriptionField', { timeline: { descriptionField: 'notes' } }, 'options.timeline', 'descriptionField'],
    ['tree.titleField', { tree: { titleField: 'name' } }, 'options.tree', 'titleField'],
    ['chart.xAxisField', { chart: { xAxisField: 'stage' } }, 'options.chart', 'xAxisField'],
  ];
  for (const [door, parse] of DOORS) {
    it.each(UNDECLARED)(`${door}: %s`, (_label, bag, path, key) => {
      const r = parse({ ...NODE, options: bag });
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.path.join('.') === path);
      expect({ code: issue?.code, keys: issue?.keys }).toEqual({ code: 'unrecognized_keys', keys: [key] });
    });
  }

  it('`options.grid` is refused with the spec\'s guidance: a grid has no per-kind block', () => {
    const r = ListViewSchema.safeParse({ ...NODE, options: { grid: {} } }) as Parsed;
    const message = r.error?.issues.find((i) => i.path.join('.') === 'options')?.message ?? '';
    expect(message).toContain('A grid has no per-kind block');
    expect(message).toBe(SPEC_BAG.safeParse({ grid: {} }).error!.issues[0].message);
  });
});

/* ── 6. The TypeScript face ──────────────────────────────────────────────────── */

type Bag = NonNullable<TsListViewSchema['options']>;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

describe('objectui#6152 round 12 — the TypeScript face is closed the same way', () => {
  it('the bag type has the eight kinds and no index signature', () => {
    const closed: string extends keyof Bag ? 'open' : 'closed' = 'closed';
    const kinds: Equal<keyof Bag, 'kanban' | 'calendar' | 'gallery' | 'timeline' | 'gantt' | 'map' | 'chart' | 'tree'> = true;
    expect([closed, kinds]).toEqual(['closed', true]);
  });

  it('refuses each narrowed key at the authoring site, and compiles the lit control', () => {
    const live: Bag = {
      kanban: { groupByField: 'stage', columns: ['name'], titleField: 'name' },
      calendar: { titleField: 'name' },
      gallery: { coverField: 'logo' },
      timeline: { titleField: 'name' },
      map: { locationField: 'address' },
      chart: { chartType: 'bar' },
    };
    const refused: Bag[] = [
      // @ts-expect-error — `grid` is not a kind of the bag.
      { grid: {} },
      // @ts-expect-error — `cardFields` is a refusal arm.
      { kanban: { cardFields: ['name'] } },
      // @ts-expect-error — `groupField` is a refusal arm.
      { kanban: { groupField: 'stage' } },
      // @ts-expect-error — `imageField` is a refusal arm.
      { gallery: { imageField: 'logo' } },
      // @ts-expect-error — `descriptionField` is not a member of the timeline block.
      { timeline: { descriptionField: 'notes' } },
      // @ts-expect-error — the chart block is dataset-bound; the legacy axes are not members.
      { chart: { xAxisField: 'stage' } },
      // @ts-expect-error — `titleField` is not a member of the tree block.
      { tree: { titleField: 'name' } },
    ];
    expect(live.kanban?.groupByField).toBe('stage');
    expect(refused).toHaveLength(7);
  });

  it('`ListViewTimelineConfig` is the list view\'s own `timeline` block, closed, with `dateField` refused', () => {
    const same: Equal<ListViewTimelineConfig, NonNullable<TsListViewSchema['timeline']>> = true;
    const closed: string extends keyof ListViewTimelineConfig ? 'open' : 'closed' = 'closed';
    // @ts-expect-error — `dateField` is refused by name: write `startDateField`.
    const alias: ListViewTimelineConfig = { dateField: 'starts_at' };
    expect([same, closed, alias.titleField]).toEqual([true, 'closed', undefined]);
  });
});
