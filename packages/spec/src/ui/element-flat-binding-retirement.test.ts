// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11509 (v18, ruling A-narrow) — the element layer's flat data-binding keys
 * and `object-grid.defaultFilters` RETIRED; an element binds data through the
 * node-level `dataSource` only.
 *
 * Retired: `element:record_picker` `object` / `filter` / `sort` / `limit`,
 * `element:number` `object` / `filter`, `element:repeater` `object` / `filter`
 * / `sort` / `limit` — each the same query as a key of
 * `ElementDataSourceSchema`, resolved per renderer by three contradictory rules
 * (the picker let the binding win, `element:number` AND-combined the two
 * filters, the repeater read the flat keys alone) — and `object-grid`'s
 * `defaultFilters`, the legacy second spelling of `filter`. objectui moved the
 * three renderers onto the binding first (objectui#11880), the order the
 * ruling set.
 *
 * Bookkeeping shapes, pinned below:
 *   1. `retiredKey()` tombstones carrying the prescription; the input type of
 *      each key is `never`. `PageComponentSchema.properties` is an open bag, so
 *      the props rows are reached by the component-props lint, never by the
 *      page parse.
 *   2. D2 conversions `element-flat-data-binding-to-data-source` and
 *      `object-grid-default-filters-removed` (step 18), retired from the load
 *      path, ordered BEFORE `page-component-filter-record-to-rule-array`.
 *   3. Eleven `RETIRED_KEYS_BY_MAJOR[18]` rows and one D3 entry per family; the
 *      three step-18 narrowings of these keys are absorbed.
 *   4. A tree-scoped absence walk over the radius this package declares.
 *
 * The lint half — the missing-binding refusal that replaced the type-blind
 * waiver, and the repeater trap — is pinned in
 * `packages/lint/src/validate-component-props.test.ts`.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` — no HTTP door parses these rows.
 * So each refusal is pinned by the issue `code`, the `path` naming the key, and
 * the prescription's first sentence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { applyConversions, collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import type { ConversionNotice, ConversionTodoNotice } from '../conversions/types';
import { applyMetaMigrations } from '../migrations/chain';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { normalizeStackInput } from '../shared/metadata-collection.zod';
import {
  ComponentPropsMap,
  ElementNumberPropsSchema,
  ElementRecordPickerPropsSchema,
  ElementRepeaterPropsSchema,
  ObjectGridPropsSchema,
} from './component.zod';
import { PageComponentSchema } from './page.zod';

type Dict = Record<string, unknown>;

const ELEMENT_CONVERSION = 'element-flat-data-binding-to-data-source';
const GRID_CONVERSION = 'object-grid-default-filters-removed';
const RECORD_FORM_CONVERSION = 'page-component-filter-record-to-rule-array';
const MIGRATE_SENTENCE =
  'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/** The retired keys, per element — what the ruling names, written out. */
const RETIRED: Readonly<Record<string, readonly string[]>> = {
  'element:record_picker': ['object', 'filter', 'sort', 'limit'],
  'element:number': ['object', 'filter'],
  'element:repeater': ['object', 'filter', 'sort', 'limit'],
};
/** Each element's smallest clean props bag, the binding aside. */
const MINIMAL: Readonly<Record<string, Dict>> = {
  'element:record_picker': {},
  'element:number': { aggregate: 'count' },
  'element:repeater': {},
};
/** A legal value of each retired key — what the binding takes at the same key. */
const VALUE: Readonly<Record<string, unknown>> = {
  object: 'deal',
  filter: [{ field: 'stage', operator: 'equals', value: 'open' }],
  sort: [{ field: 'amount', order: 'desc' }],
  limit: 20,
};
const CASES = Object.entries(RETIRED).flatMap(([type, keys]) => keys.map((key) => [type, key] as const));

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parse = { success: boolean; data?: unknown; error?: { issues: Issue[] } };
const row = (type: string) => ComponentPropsMap[type as keyof typeof ComponentPropsMap] as unknown as {
  safeParse: (v: unknown) => Parse;
  shape: Dict;
};

/** A one-component page, the component under test at `regions[0].components[0]`. */
const pageWith = (component: Dict): Dict => ({ pages: [{ name: 'probe', regions: [{ name: 'main', components: [component] }] }] });
const componentOf = (stack: Dict): Dict =>
  ((((stack.pages as Dict[])[0]!.regions as Dict[])[0]!.components as Dict[])[0]!);

/** The whole chain, retired entries included — as the data-at-rest seams replay it. */
function convert(stack: Dict): { stack: Dict; notices: ConversionNotice[]; todos: ConversionTodoNotice[] } {
  const notices: ConversionNotice[] = [];
  const todos: ConversionTodoNotice[] = [];
  const out = applyConversions(structuredClone(stack), {
    includeRetired: true,
    onNotice: (n) => notices.push(n),
    onTodo: (t) => todos.push(t),
  });
  return { stack: out, notices, todos };
}
const brief = (n: ConversionNotice) => [n.conversionId, n.path, n.from, n.to];

describe('the element tombstones — refused at the key, with the prescription', () => {
  it.each(CASES)('%s `%s`', (type, key) => {
    const r = row(type).safeParse({ ...MINIMAL[type], [key]: VALUE[key] });
    expect(r.success).toBe(false);
    const issues = r.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_type');
    expect(issues[0]!.path).toEqual([key]);
    const message = issues[0]!.message;
    // House convention 1 + 2: the qualified key opens it, then the release and ADR.
    expect(message.startsWith(`\`${type}\` property \`${key}\` was removed in @objectstack/spec 18 (ADR-0087 D2) — `)).toBe(true);
    // The live mechanism, named at its own key on the node.
    expect(message).toContain(`Use \`dataSource.${key}\` on the component node, a sibling of \`type\``);
    expect(message.endsWith(MIGRATE_SENTENCE)).toBe(true);
  });

  it('each element\'s prescription says what to do with a key the binding already sets — by that element\'s old rule', () => {
    const message = (type: string, key: string) =>
      row(type).safeParse({ ...MINIMAL[type], [key]: VALUE[key] }).error!.issues[0]!.message;
    expect(message('element:record_picker', 'limit')).toContain('delete this one, since the binding\'s value always won');
    expect(message('element:number', 'object')).toContain('delete this one, since the binding\'s value always won');
    expect(message('element:number', 'filter')).toContain('append these to it, since the two always AND-combined');
    expect(message('element:repeater', 'sort')).toContain('keep the value written here, which is the one the list honoured');
  });

  it('refuses by the TOMBSTONE, not by the strict unknown-key arm — the two are different answers', () => {
    const retired = row('element:number').safeParse({ aggregate: 'count', object: 'deal' });
    expect(retired.error!.issues.map((i) => i.code)).not.toContain('unrecognized_keys');
    // CONTROL: an undeclared sibling comes back as `unrecognized_keys`.
    const undeclared = row('element:number').safeParse({ aggregate: 'count', zzzNotAKey: 'deal' });
    expect(undeclared.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('the walked shapes keep each tombstone as a key — the authorable-surface `[RETIRED]` rows', () => {
    for (const [type, keys] of Object.entries(RETIRED)) {
      for (const key of keys) expect(Object.keys(row(type).shape), `${type}.${key}`).toContain(key);
    }
  });

  it('fails tsc at the authoring site: the input type of each flat `object` is `never`', () => {
    // @ts-expect-error — `object` is a retiredKey() tombstone on `element:number`.
    const number: z.input<typeof ElementNumberPropsSchema> = { aggregate: 'count', object: 'deal' };
    // @ts-expect-error — `object` is a retiredKey() tombstone on `element:record_picker`.
    const picker: z.input<typeof ElementRecordPickerPropsSchema> = { object: 'deal' };
    // @ts-expect-error — `object` is a retiredKey() tombstone on `element:repeater`.
    const repeater: z.input<typeof ElementRepeaterPropsSchema> = { object: 'deal' };
    // The parse channel agrees with the type channel on the same literals.
    for (const [schema, value] of [[ElementNumberPropsSchema, number], [ElementRecordPickerPropsSchema, picker], [ElementRepeaterPropsSchema, repeater]] as const) {
      expect((schema as unknown as { safeParse: (v: unknown) => Parse }).safeParse(value).success).toBe(false);
    }
  });

  it.each([
    ['objectName', 'object'],
    ['filters', 'filter'],
    ['where', 'filter'],
    ['orderBy', 'sort'],
    ['sortBy', 'sort'],
    ['top', 'limit'],
    ['pageSize', 'limit'],
  ])('the repeater\'s `%s` spelling is pointed at the binding\'s `%s`, never at the tombstone', (spelling, key) => {
    const r = row('element:repeater').safeParse({ [spelling]: VALUE[key] });
    const issue = r.error!.issues.find((i) => i.code === 'unrecognized_keys')!;
    expect(issue.message).toContain(`Write it as \`dataSource.${key}\` on the component node`);
    expect(issue.message).not.toContain(`Did you mean \`${key}\``);
  });
});

describe('the binding — the one door the three elements read', () => {
  it.each(Object.keys(RETIRED))('%s: the node with its query on `dataSource` parses, and its props grow no retired key', (type) => {
    const binding = type === 'element:number'
      ? { object: 'deal', view: 'won_deals', filter: VALUE.filter }
      : { object: 'deal', view: 'hot_deals', filter: VALUE.filter, sort: VALUE.sort, limit: 20 };
    const r = PageComponentSchema.safeParse({ type, dataSource: binding, properties: MINIMAL[type] });
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    const props = row(type).safeParse(MINIMAL[type]);
    expect(props.success).toBe(true);
    for (const key of RETIRED[type]!) expect(props.data as Dict).not.toHaveProperty(key);
  });

  it('never hard-refuses an existing page: the page parse still accepts a node carrying a flat key', () => {
    // The open `properties` bag is the props lint's to judge (advisory), not the page parse's.
    const r = PageComponentSchema.safeParse({ type: 'element:repeater', properties: { object: 'deal' } });
    expect(r.success).toBe(true);
  });
});

describe('`object-grid.defaultFilters` — refused at the key, with the prescription', () => {
  it.each([
    ['a rule array', [{ field: 'status', operator: 'equals', value: 'open' }]],
    ['the record form', { status: 'open' }],
    ['an empty array', []],
  ])('refuses %s', (_label, value) => {
    const r = (ObjectGridPropsSchema as unknown as { safeParse: (v: unknown) => Parse })
      .safeParse({ objectName: 'deal', defaultFilters: value });
    expect(r.success).toBe(false);
    const at = r.error!.issues.filter((i) => i.path[0] === 'defaultFilters');
    expect(at).toHaveLength(1);
    expect(at[0]!.code).toBe('invalid_type');
    expect(at[0]!.path).toEqual(['defaultFilters']);
    expect(at[0]!.message.startsWith('`object-grid` property `defaultFilters` was removed in @objectstack/spec 18 (ADR-0087 D2) — ')).toBe(true);
    expect(at[0]!.message).toContain('Use `filter`.');
    expect(at[0]!.message.endsWith(MIGRATE_SENTENCE)).toBe(true);
  });

  it('CONTROL: the live mechanism, `filter`, takes the same rule array', () => {
    const rules = [{ field: 'status', operator: 'equals', value: 'open' }];
    const r = (ObjectGridPropsSchema as unknown as { safeParse: (v: unknown) => Parse }).safeParse({ objectName: 'deal', filter: rules });
    expect(r.success).toBe(true);
    expect(r.data as Dict).not.toHaveProperty('defaultFilters');
  });
});

describe('`element-flat-data-binding-to-data-source` — each element\'s old rule, made mechanical', () => {
  it('no binding: every flat key moves onto a new one, unchanged', () => {
    for (const [type, keys] of Object.entries(RETIRED)) {
      const flat = Object.fromEntries(keys.map((k) => [k, VALUE[k]]));
      const { stack, notices, todos } = convert(pageWith({ type, properties: { ...MINIMAL[type], ...flat } }));
      const component = componentOf(stack);
      expect(component.properties, type).toEqual(MINIMAL[type]);
      expect(component.dataSource, type).toEqual(flat);
      expect(notices.map(brief), type).toEqual(keys.map((k) => [
        ELEMENT_CONVERSION, `pages[0].regions[0].components[0].dataSource.${k}`, `properties.${k}`, `dataSource.${k}`,
      ]));
      expect(todos, type).toEqual([]);
      // What the conversion writes is what the node door takes.
      expect(PageComponentSchema.safeParse(component).success, type).toBe(true);
      expect(row(type).safeParse(component.properties).success, type).toBe(true);
    }
  });

  it('the record picker: a key the binding already set is DELETED (the binding always won), a missing one moves', () => {
    const { stack, notices } = convert(pageWith({
      type: 'element:record_picker',
      dataSource: { object: 'deal', limit: 10 },
      properties: { object: 'lead', limit: 50, sort: VALUE.sort, labelField: 'name' },
    }));
    const component = componentOf(stack);
    expect(component.dataSource).toEqual({ object: 'deal', limit: 10, sort: VALUE.sort });
    expect(component.properties).toEqual({ labelField: 'name' });
    expect(notices.map((n) => [n.path, n.to])).toEqual([
      ['pages[0].regions[0].components[0].properties.object', '(removed)'],
      ['pages[0].regions[0].components[0].dataSource.sort', 'dataSource.sort'],
      ['pages[0].regions[0].components[0].properties.limit', '(removed)'],
    ]);
  });

  it('the record picker beside a saved `view`: a key the binding lacks is a TODO, left as stored', () => {
    const before = pageWith({
      type: 'element:record_picker',
      id: 'picker',
      dataSource: { object: 'deal', view: 'hot_deals' },
      properties: { filter: VALUE.filter, limit: 20 },
    });
    const { stack, notices, todos } = convert(before);
    expect(componentOf(stack)).toEqual(componentOf(before));
    expect(notices).toEqual([]);
    expect(todos.map((t) => [t.conversionId, t.path])).toEqual([
      [ELEMENT_CONVERSION, 'pages[0].regions[0].components[0].properties.filter'],
      [ELEMENT_CONVERSION, 'pages[0].regions[0].components[0].properties.limit'],
    ]);
    expect(todos[0]!.reason).toMatch(/^On the `element:record_picker` block `picker`, this flat `filter` sits beside `dataSource\.view: 'hot_deals'`/);
    expect(todos[0]!.reason.endsWith('Left as stored, this key reaches no query.')).toBe(true);
    // …while its `object` is decided whatever the view says: the binding names one.
    const objectToo = convert(pageWith({
      type: 'element:record_picker',
      dataSource: { object: 'deal', view: 'hot_deals' },
      properties: { object: 'deal' },
    }));
    expect(objectToo.todos).toEqual([]);
    expect(componentOf(objectToo.stack).properties).toEqual({});
  });

  it('`element:number`: the two filters AND-combined, so the flat rules are APPENDED to the binding\'s', () => {
    const own = [{ field: 'stage', operator: 'equals', value: 'won' }];
    const { stack, notices } = convert(pageWith({
      type: 'element:number',
      dataSource: { object: 'deal', filter: own, view: 'this_quarter' },
      properties: { aggregate: 'count', object: 'lead', filter: VALUE.filter },
    }));
    const component = componentOf(stack);
    expect(component.dataSource).toEqual({ object: 'deal', view: 'this_quarter', filter: [...own, ...(VALUE.filter as Dict[])] });
    expect(component.properties).toEqual({ aggregate: 'count' });
    expect(notices.map((n) => n.to)).toEqual(['(removed)', 'dataSource.filter (rules appended; they AND)']);
  });

  it('`element:number`: a filter pair that is not two rule arrays is a TODO, left as stored', () => {
    const before = pageWith({
      type: 'element:number',
      dataSource: { object: 'deal', filter: [['stage', '=', 'won']] },
      properties: { aggregate: 'count', filter: VALUE.filter },
    });
    const { stack, todos } = convert(before);
    expect((componentOf(stack).properties as Dict).filter).toEqual(VALUE.filter);
    expect(todos.filter((t) => t.conversionId === ELEMENT_CONVERSION).map((t) => t.path)).toEqual([
      'pages[0].regions[0].components[0].properties.filter',
    ]);
  });

  it('the repeater: it read the flat keys alone, so an EQUAL binding value is deleted, a DIFFERENT one or a `view` is a TODO', () => {
    const { stack, notices, todos } = convert(pageWith({
      type: 'element:repeater',
      dataSource: { object: 'deal', view: 'open_deals', limit: 5 },
      properties: { object: 'deal', limit: 10, filter: VALUE.filter, titleField: 'name' },
    }));
    const component = componentOf(stack);
    expect(component.dataSource).toEqual({ object: 'deal', view: 'open_deals', limit: 5 });
    expect(component.properties).toEqual({ limit: 10, filter: VALUE.filter, titleField: 'name' });
    expect(notices.map((n) => [n.path, n.to])).toEqual([['pages[0].regions[0].components[0].properties.object', '(removed)']]);
    expect(todos.map((t) => t.path)).toEqual([
      'pages[0].regions[0].components[0].properties.filter',
      'pages[0].regions[0].components[0].properties.limit',
    ]);
    expect(todos[0]!.reason.startsWith('On the `element:repeater` block, the binding names the saved view `open_deals`')).toBe(true);
    expect(todos[1]!.reason.startsWith('On the `element:repeater` block, `dataSource.limit` is set to a different value')).toBe(true);
  });

  it('is scoped by component TYPE: the same keys on another element are not this entry\'s', () => {
    const before = pageWith({ type: 'element:metadata_viewer', properties: { type: 'flow', name: 'approve', object: 'deal' } });
    const { stack, notices } = collectConversionNotices(before, { includeRetired: true });
    expect(notices).toEqual([]);
    expect(stack).toBe(before);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ELEMENT_CONVERSION)!;
    const once = collectConversionNotices(structuredClone(entry.fixture.before), { includeRetired: true });
    const twice = collectConversionNotices(once.stack, { includeRetired: true });
    expect(twice.notices).toEqual([]);
    expect(twice.stack).toBe(once.stack);
  });

  it('the list it moves is the spec\'s own: exactly the keys `ComponentPropsMap` tombstones onto `dataSource.<key>`', () => {
    const tombstoned: string[] = [];
    const moved: string[] = [];
    for (const type of Object.keys(ComponentPropsMap)) {
      for (const key of ['object', 'filter', 'sort', 'limit']) {
        const r = row(type).safeParse({ [key]: VALUE[key] });
        const at = r.success ? [] : r.error!.issues.filter((i) => i.path.length === 1 && i.path[0] === key);
        if (at.some((i) => i.message.includes('was removed') && i.message.includes(`\`dataSource.${key}\``))) {
          tombstoned.push(`${type}:${key}`);
        }
        const { stack } = convert(pageWith({ type, properties: { [key]: VALUE[key] } }));
        if ((componentOf(stack).dataSource as Dict | undefined)?.[key] !== undefined) moved.push(`${type}:${key}`);
      }
    }
    expect(tombstoned.sort()).toEqual(CASES.map(([t, k]) => `${t}:${k}`).sort());
    expect(moved.sort()).toEqual(tombstoned.sort());
  });
});

describe('`object-grid-default-filters-removed` — the shape `defaultSort`\'s retirement took', () => {
  const RULES = [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }];
  const grid = (properties: Dict) => pageWith({ type: 'object-grid', id: 'g', properties: { objectName: 'deal', ...properties } });

  it.each([
    ['absent', {}],
    ['null', { filter: null }],
    ['an empty rule array', { filter: [] }],
    ['an empty record', { filter: {} }],
  ])('`filter` %s — the fallback WAS the filter, so it moves', (_label, filter) => {
    const { stack, notices } = convert(grid({ ...filter, defaultFilters: RULES }));
    expect(componentOf(stack).properties).toEqual({ objectName: 'deal', filter: RULES });
    expect(notices.map(brief)).toEqual([[GRID_CONVERSION, 'pages[0].regions[0].components[0].properties.filter', 'defaultFilters', 'filter']]);
  });

  it.each([
    ['a rule array', [{ field: 'status', operator: 'equals', value: 'open' }]],
    ['the record form', { status: 'open' }],
  ])('`filter` with content (%s) — the fallback was never read, so it is deleted', (_label, filter) => {
    const { stack, notices } = convert(grid({ filter, defaultFilters: RULES }));
    expect(componentOf(stack).properties).not.toHaveProperty('defaultFilters');
    expect(notices.filter((n) => n.conversionId === GRID_CONVERSION).map((n) => [n.path, n.to])).toEqual([
      ['pages[0].regions[0].components[0].properties.defaultFilters', '(removed)'],
    ]);
  });

  it('an empty fallback carries nothing, so it is deleted whatever `filter` holds', () => {
    const { stack } = convert(grid({ defaultFilters: [] }));
    expect(componentOf(stack).properties).toEqual({ objectName: 'deal' });
  });

  it('`filter` a value no lowering reads — a TODO, left as stored, never overwritten', () => {
    const before = grid({ filter: 'status = open', defaultFilters: RULES });
    const { stack, notices, todos } = convert(before);
    expect(componentOf(stack)).toEqual(componentOf(before));
    expect(notices).toEqual([]);
    expect(todos.map((t) => [t.conversionId, t.path])).toEqual([[GRID_CONVERSION, 'pages[0].regions[0].components[0].properties.defaultFilters']]);
  });

  it('runs BEFORE the record-form conversion: a record-form fallback moves onto `filter` and is converted there', () => {
    const order = CONVERSIONS_BY_MAJOR[18]!.map((c) => c.id);
    expect(order.indexOf(GRID_CONVERSION)).toBeLessThan(order.indexOf(RECORD_FORM_CONVERSION));
    expect(order.indexOf(ELEMENT_CONVERSION)).toBeLessThan(order.indexOf(RECORD_FORM_CONVERSION));
    const { stack, notices } = convert(grid({ defaultFilters: { owner_id: '{current_user_id}' } }));
    expect(componentOf(stack).properties).toEqual({ objectName: 'deal', filter: RULES });
    expect(notices.map((n) => n.conversionId)).toEqual([GRID_CONVERSION, RECORD_FORM_CONVERSION]);
  });

  it('is scoped by component TYPE: `defaultFilters` on another block is not this entry\'s', () => {
    const before = pageWith({ type: 'object-kanban', properties: { objectName: 'deal', defaultFilters: RULES } });
    const { stack } = collectConversionNotices(before, { includeRetired: true });
    expect(stack).toBe(before);
  });
});

describe('the jurisdiction — retired from authoring, replayed at rest and by the chain', () => {
  const page = {
    name: 'deal_desk',
    regions: [{
      name: 'main',
      components: [
        { type: 'element:repeater', properties: { object: 'deal', limit: 5 } },
        { type: 'object-grid', properties: { objectName: 'deal', defaultFilters: [{ field: 'stage', operator: 'equals', value: 'open' }] } },
      ],
    }],
  };

  it('⛔ the authoring funnel does not replay either — an author is refused at the parse instead', () => {
    const notices: ConversionNotice[] = [];
    const out = normalizeStackInput({ pages: [structuredClone(page)] }, { onConversionNotice: (n) => notices.push(n) });
    expect((out.pages as Dict[])[0]).toEqual(page);
    expect(notices.filter((n) => n.conversionId === ELEMENT_CONVERSION || n.conversionId === GRID_CONVERSION)).toEqual([]);
  });

  it('the stored-row seam replays both', () => {
    const stored = applyConversionsToStoredItem('page', structuredClone(page)) as typeof page;
    const [repeater, gridNode] = stored.regions[0]!.components as Dict[];
    expect(repeater).toEqual({ type: 'element:repeater', properties: {}, dataSource: { object: 'deal', limit: 5 } });
    expect(gridNode!.properties).toEqual({ objectName: 'deal', filter: [{ field: 'stage', operator: 'equals', value: 'open' }] });
  });

  it('`os migrate meta --from 17` replays both and lists the edits', () => {
    const result = applyMetaMigrations({ pages: [structuredClone(page)] }, 17, 18);
    const applied = result.applied.map((a) => a.conversionId);
    expect(applied.filter((id) => id === ELEMENT_CONVERSION)).toHaveLength(2);
    expect(applied.filter((id) => id === GRID_CONVERSION)).toHaveLength(1);
  });
});

describe('the ADR-0087 ledger rows', () => {
  it('declares the eleven keys under major 18, and no other major', () => {
    const keys = [
      ...CASES.map(([type, key]) => {
        const def = { 'element:record_picker': 'ElementRecordPickerProps', 'element:number': 'ElementNumberProps', 'element:repeater': 'ElementRepeaterProps' }[type]!;
        return `ui/${def}:${key}`;
      }),
      'ui/ObjectGridProps:defaultFilters',
    ];
    expect(keys).toHaveLength(11);
    for (const key of keys) {
      expect(RETIRED_KEYS_BY_MAJOR[18], key).toContain(key);
      for (const [major, list] of Object.entries(RETIRED_KEYS_BY_MAJOR)) {
        if (major !== '18') expect(list, `${key} @ ${major}`).not.toContain(key);
      }
    }
  });

  it('wires both D2 conversions into step 18 as retired, stamped entries', () => {
    for (const id of [ELEMENT_CONVERSION, GRID_CONVERSION]) {
      expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(id);
      const conversion = ALL_CONVERSIONS.find((c) => c.id === id)!;
      expect(conversion.toMajor).toBe(18);
      expect(conversion.retiredFromLoadPath).toBe(true);
    }
  });

  it('carries one D3 entry per family, naming its D2 conversion — and the absorbed narrowings are gone', () => {
    const semantic = MIGRATIONS_BY_MAJOR[18]!.semantic;
    for (const [id, conversion] of [['element-flat-data-binding-retired', ELEMENT_CONVERSION], ['object-grid-default-filters-retired', GRID_CONVERSION]] as const) {
      const entries = semantic.filter((s) => s.id === id);
      expect(entries, id).toHaveLength(1);
      expect(entries[0]!.conversionIds).toEqual([conversion]);
      expect(entries[0]!.reason).toContain(`\`${conversion}\``);
      expect(entries[0]!.acceptanceCriteria.length).toBeGreaterThan(0);
    }
    const everyId = Object.values(MIGRATIONS_BY_MAJOR).flatMap((step) => step.semantic.map((s) => s.id));
    for (const absorbed of ['object-grid-default-filters-rule-array', 'element-number-filter-rule-array', 'element-record-picker-filter-rule-array']) {
      expect(everyId, absorbed).not.toContain(absorbed);
    }
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps only TYPED authoring sites, and a page component's `properties`
// is an open bag, so it does not reach a node authored through
// `definePage` / `defineStack`, a YAML fence or a JSON export at all. This walk
// covers every text file under the repo roots `scripts/cross-package-test-inputs.mjs`
// declares for `@objectstack/spec#test` (mirrored in `turbo.json`) — the radius
// the sibling retirement pins walk — plus the example apps' own `src/` trees.
//
// The matchers judge the AUTHORING SHAPE, never a mention:
//   - an element node — `type` naming one of the three elements — whose
//     `properties` carries a retired key at its own level: in an object
//     literal or JSON (shorthand included), in YAML by indentation, and in a
//     JSX / HTML tag's attributes;
//   - `defaultFilters` in key position with a literal value (`[`, `{`, or a
//     YAML block), or as a tag attribute.
// The keys themselves are four of the most common words in metadata, so a
// bare-key matcher would be noise: the element node is the anchor. Inline code
// spans are prose and are stripped before judging; fenced examples are judged.
// The bound, stated: a node whose `type` is not a literal, or whose
// `properties` is built elsewhere and spread in, and the `docs/**`,
// `.claude/**`, `.github/**` and repo-root files, are outside what this walk
// sees.
describe('tree-scoped absence: nothing inside the declared radius still authors a retired key', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml', '.html']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const ELEMENT = 'element:(?:record_picker|number|repeater)';
  const KEYS = '(?:object|filter|sort|limit)';
  /** `type: 'element:…'` in an object literal or JSON. */
  const LITERAL_TYPE = new RegExp(`(^|[^\\w.$])["']?type["']?[ \\t]*:[ \\t]*["']${ELEMENT}["']`, 'gm');
  /** `type: element:…` as a YAML mapping key, its indentation captured (a list dash counts as indent). */
  const YAML_TYPE = new RegExp(`^([ \\t]*(?:-[ \\t]+)?)type:[ \\t]*["']?${ELEMENT}["']?[ \\t]*$`, 'gm');
  /** A JSX / HTML tag naming one of the three elements. */
  const TAG = new RegExp(`<[A-Za-z][\\w.:-]*\\b[^<>]*\\btype=["']${ELEMENT}["'][^<>]*>`, 'g');
  /** A retired key at a literal's own level: `key:` (quoted or bare), or a shorthand `key`. */
  const OWN_LEVEL_KEY = new RegExp(`(^|[^\\w.$])["']?${KEYS}["']?[ \\t]*:|(^|,)[ \\t\\n]*${KEYS}[ \\t\\n]*(?=,|$)`);
  const DEFAULT_FILTERS = /(^|[^\w.$])["']?defaultFilters["']?[ \t]*:[ \t]*(\[|\{|$)|\sdefaultFilters=/m;

  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');

  /** The `{` that opens the object literal enclosing `at`, or -1. */
  const literalStart = (text: string, at: number): number => {
    for (let i = at - 1, depth = 0; i >= 0; i -= 1) {
      const c = text[i];
      if (c === '}' || c === ']') depth += 1;
      else if (c === '{' || c === '[') {
        if (depth === 0) return c === '{' ? i : -1;
        depth -= 1;
      }
    }
    return -1;
  };
  /** The index of the bracket closing the one opened at `open`, or the text's end. */
  const groupEnd = (text: string, open: number): number => {
    for (let i = open + 1, depth = 0; i < text.length; i += 1) {
      const c = text[i];
      if (c === '{' || c === '[') depth += 1;
      else if (c === '}' || c === ']') {
        if (depth === 0) return i;
        depth -= 1;
      }
    }
    return text.length;
  };
  /**
   * A group's own level: its text with every nested `{…}` / `[…]` removed, and
   * every quoted VALUE emptied (a quoted string not followed by `:`), so a
   * string that merely contains `filter:` is not read as the key.
   */
  const ownLevel = (text: string, open: number): string => {
    const end = groupEnd(text, open);
    let own = '';
    for (let i = open + 1, depth = 0; i < end; i += 1) {
      const c = text[i]!;
      if (c === '{' || c === '[') depth += 1;
      else if (c === '}' || c === ']') depth -= 1;
      else if (depth === 0) own += c;
    }
    return own.replace(/(["'])(?:\\.|(?!\1)[^\n])*\1(?![ \t]*:)/g, "''");
  };
  /** The `properties` group of the literal opened at `start`, judged at its own level. */
  const literalPropsAuthorRetired = (text: string, start: number): boolean => {
    const end = groupEnd(text, start);
    const PROPS = /["']?properties["']?[ \t]*:[ \t]*\{/g;
    for (let depth = 0, i = start + 1; i < end; i += 1) {
      const c = text[i];
      if (c === '{' || c === '[') { depth += 1; continue; }
      if (c === '}' || c === ']') { depth -= 1; continue; }
      if (depth !== 0) continue;
      PROPS.lastIndex = i;
      const m = PROPS.exec(text);
      if (m && m.index === i && /[^\w.$]/.test(text[i - 1] ?? ' ')) {
        return OWN_LEVEL_KEY.test(ownLevel(text, i + m[0].length - 1));
      }
    }
    return false;
  };
  /** In YAML, the `properties` mapping beside the `type` line, judged by indentation. */
  const yamlPropsAuthorRetired = (lines: readonly string[], typeLine: number, keyIndent: number): boolean => {
    for (let i = typeLine + 1; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (line.trim() === '') continue;
      const indent = line.length - line.trimStart().length;
      if (indent < keyIndent) return false;
      if (indent !== keyIndent) continue;
      const props = /^properties:[ \t]*(.*)$/.exec(line.trimStart());
      if (!props) continue;
      if (props[1]!.startsWith('{')) return OWN_LEVEL_KEY.test(ownLevel(props[1]!, 0));
      for (let j = i + 1, child = -1; j < lines.length; j += 1) {
        const inner = lines[j]!;
        if (inner.trim() === '') continue;
        const innerIndent = inner.length - inner.trimStart().length;
        if (innerIndent <= keyIndent) return false;
        if (child < 0) child = innerIndent;
        if (innerIndent === child && new RegExp(`^${KEYS}:`).test(inner.trimStart())) return true;
      }
      return false;
    }
    return false;
  };

  const judge = (raw: string): string | null => {
    const text = stripInlineCode(raw);
    for (const m of text.matchAll(LITERAL_TYPE)) {
      const start = literalStart(text, m.index! + m[1]!.length);
      if (start >= 0 && literalPropsAuthorRetired(text, start)) return m[0].trim();
    }
    const lines = text.split('\n');
    for (const m of text.matchAll(YAML_TYPE)) {
      const typeLine = text.slice(0, m.index!).split('\n').length - 1;
      if (yamlPropsAuthorRetired(lines, typeLine, m[1]!.length)) return m[0].trim();
    }
    for (const m of text.matchAll(TAG)) {
      if (new RegExp(`\\s${KEYS}=`).test(m[0])) return m[0];
    }
    const grid = DEFAULT_FILTERS.exec(text);
    return grid ? grid[0].trim() : null;
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell a retired key.
   */
  const EXCLUDED = new Set([
    // This pin authors the keys to assert their refusal and their conversion.
    THIS_FILE,
    // The props-lint pin authors them to assert the finding an author meets.
    'packages/lint/src/validate-component-props.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversions' fixtures and tests author the pre-retirement shapes on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output, reached only because this is a FILESYSTEM walk.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matchers recognise an authoring in every syntax, and ignore a mention, a binding and a declaration (anti-vacuity)', () => {
    // Offenders.
    expect(judge("{ type: 'element:record_picker', properties: { object: 'deal', labelField: 'name' } }")).not.toBeNull();
    expect(judge("{\n  type: 'element:number',\n  id: 'kpi',\n  properties: {\n    aggregate: 'count',\n    filter: [],\n  },\n}")).not.toBeNull();
    expect(judge("{ properties: { limit, titleField: 'name' }, type: 'element:repeater' }")).not.toBeNull();
    expect(judge('{ "type": "element:repeater", "properties": { "sort": [] } }')).not.toBeNull();
    expect(judge('components:\n  - type: element:number\n    properties:\n      aggregate: count\n      object: deal\n')).not.toBeNull();
    expect(judge('  - type: element:repeater\n    properties: { object: deal }\n')).not.toBeNull();
    expect(judge('<Block type="element:repeater" object="deal" />')).not.toBeNull();
    expect(judge("{ type: 'object-grid', properties: { objectName: 'deal', defaultFilters: [] } }")).not.toBeNull();
    expect(judge('object-grid:\n  defaultFilters:\n    - field: stage\n')).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge("{ type: 'element:record_picker', dataSource: { object: 'deal', limit: 50 }, properties: { labelField: 'name' } }")).toBeNull();
    expect(judge("{ type: 'element:number', properties: { aggregate: 'count', format: 'number' }, dataSource: { object: 'deal', filter: [] } }")).toBeNull();
    expect(judge("{ type: 'element:repeater', properties: { fields: [{ field: 'object' }], emptyText: 'filter: none' } }")).toBeNull();
    expect(judge("{ type: 'element:metadata_viewer', properties: { type: 'flow', name: 'x', object: 'deal' } }")).toBeNull();
    expect(judge("{ type: 'object-grid', properties: { objectName: 'deal', filter: [], sort: [], limit: 5 } }")).toBeNull();
    expect(judge('a flat `properties: { object: deal }` on an `element:number` is refused')).toBeNull();
    expect(judge('  - type: element:number\n    dataSource:\n      object: deal\n    properties:\n      aggregate: count\n')).toBeNull();
    expect(judge('defaultFilters: retiredKey(\n')).toBeNull();
    expect(judge("const { defaultFilters, ...rest } = properties;")).toBeNull();
    expect(judge('"ui/ObjectGridProps:defaultFilters",')).toBeNull();
  });

  it('no retired key is authored inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        if (EXAMPLE_APP_SRC_TS.test(rel)) exampleSources += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        const hit = judge(text);
        if (hit) offenders.push(`${rel} authors \`${hit.replace(/\s+/g, ' ').slice(0, 120)}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree and the example apps' sources.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(offenders, 'an authored retired key means the retirement is being undone').toEqual([]);
  });
});
