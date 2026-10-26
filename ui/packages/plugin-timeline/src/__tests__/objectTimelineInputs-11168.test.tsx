/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 slice 5 — what `object-timeline` PUBLISHES, and what its
 * renderer does with each key the spec row declares.
 *
 * `@objectstack/spec` 17.5.0 gave `object-timeline` a `ComponentPropsMap` row,
 * and the repo-wide parity guard
 * (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`) now loads
 * this plugin, so it judges the registration in both directions. Under
 * objectui#11111 decision 3 = B every key is decided by its own measurement.
 * The judgment found ten row keys the registration did not publish —
 * `timeline`, `limit`, `data`, `items`, `dateFormat`, `rowLabel`, `minDate`,
 * `maxDate`, `descriptionField` and `mapping` — and the renderer honours all
 * ten, so they are declared, on both tags (`object-timeline` and
 * `view:timeline`, which is the same renderer). `objectName` is no longer
 * required: the page validator raised `missing-required-prop` on timelines
 * drawn from `items` or `data`, which the row and the renderer both accept.
 * Two values the row refuses are now reported where they were not (an
 * off-list `dateFormat`, a non-array `data`); the `NARROWS` row holds both.
 *
 * The guard also owes a member pin for every structured key the block
 * publishes. This file carries six of them: `timeline`, `data`, `items`,
 * `mapping`, `filter` and `sort`. `navigation` is
 * `timelineNavigationMembers-8654.test.tsx`, and `dataSource` is
 * `../ObjectTimeline.elementDataSource.test.tsx`.
 *
 * Every behavioural row mounts the block the way a page does: the AUTHORED
 * node, `{ type: 'object-timeline', properties: { … } }`, through the REAL
 * `SchemaRenderer` and this package's own registration, over a data source
 * that records every query. A row that composes a FLAT key on the node does so
 * because the authored node cannot carry it (the row refuses the flat field
 * spellings by name), and those rows say so.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { LocalizationProvider } from '@object-ui/i18n';
import {
  FilterScopeProvider,
  PredicateScopeProvider,
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import { safeValidateSchema } from '@object-ui/types/zod';
import { ComponentPropsMap } from '@objectstack/spec/ui';
// Registers `object-timeline` and `view:timeline` through this package's own
// entry, at module scope (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../index';

const TYPE = 'object-timeline';
const TAGS = [
  { type: 'object-timeline', namespace: 'plugin-timeline' },
  { type: 'timeline', namespace: 'view' },
] as const;

const OBJECT = 'evt';

type Row = Record<string, unknown>;

/** Two records, a month apart. Every field a row below names is on both. */
const RECORDS: Row[] = [
  { id: 1, name: 'Kickoff', code: 'K-1', start: '2024-01-05', finish: '2024-01-09', status: 'open', summary: 'Sum one', description: 'Desc one', kind: 'success', variant: 'danger', color: '#ff0000' },
  { id: 2, name: 'Review', code: 'R-2', start: '2024-02-10', finish: '2024-02-12', status: 'closed', summary: 'Sum two', description: 'Desc two', kind: 'warning', variant: 'info', color: '#00ff00' },
];

/** The smallest block the spec accepts: `startDateField` and `titleField` are required members. */
const TL = { startDateField: 'start', titleField: 'name' };

/** One authored feed entry. */
const ITEMS = [{ title: 'Literal A', time: '2024-01-05', description: 'Lit desc' }];

/** One authored gantt row with one bar in February 2024. */
const GANTT_ROWS = [{ label: 'Plan', items: [{ title: 'Bar', startDate: '2024-02-05', endDate: '2024-02-20' }] }];

function makeDataSource(rows: Row[] = RECORDS, fields: Record<string, unknown> = {}) {
  return {
    find: vi.fn(async (_object: string, _query?: Record<string, unknown>) => ({ data: rows })),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields })),
  };
}

interface MountOptions {
  rows?: Row[];
  fields?: Record<string, unknown>;
  /** A `PredicateScopeProvider` scope, for `bind`. */
  scope?: Record<string, unknown>;
  host?: RelatedRecordActionsValue;
  currentUserId?: string;
  /** Text to wait for before reading anything. */
  waitFor?: string;
}

/** Mount one node through the real `SchemaRenderer`, in en-US. */
async function mount(node: Row, options: MountOptions = {}) {
  const dataSource = makeDataSource(options.rows, options.fields);
  let tree: React.ReactElement = (
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <SchemaRendererProvider dataSource={dataSource as never}>
        <SchemaRenderer schema={node as never} />
      </SchemaRendererProvider>
    </LocalizationProvider>
  );
  if (options.scope) tree = <PredicateScopeProvider scope={options.scope}>{tree}</PredicateScopeProvider>;
  if (options.currentUserId) tree = <FilterScopeProvider currentUserId={options.currentUserId}>{tree}</FilterScopeProvider>;
  if (options.host) tree = <RelatedRecordActionsProvider value={options.host}>{tree}</RelatedRecordActionsProvider>;
  render(tree);
  if (options.waitFor) await screen.findByText(options.waitFor, {}, { timeout: 4000 });
  await settle();
  return { dataSource };
}

/** Give a render (or a query) every chance to have happened before asserting it did not. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

/** The authored node: every prop in the spec's `properties` bag. */
const bag = (props: Row, type: string = TYPE) => ({ type, properties: props });

const texts = (selector: string) => Array.from(document.querySelectorAll(selector)).map((el) => el.textContent);
/** Entry titles, in the order drawn. */
const titles = () => texts('h3');
/** Entry descriptions, in the order drawn. */
const descriptions = () => texts('p');
/** Each entry's printed date (and the end after it, when there is one). */
const dates = () => texts('time');
/** The group headers of a grouped rail. */
const groups = () => texts('header > span:first-child');
/** Each marker's variant class and its inline border colour. */
const markers = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.rounded-full.border-2')).map((el) => ({
    variant: el.className.match(/bg-[a-z]+-200/)?.[0],
    color: el.style.borderColor,
  }));
/** The gantt's axis headers. */
const axis = () => texts('.border-r.text-xs.font-medium.text-center');
const refusal = () => screen.queryByTestId('timeline-unusable-date-range');

type FindCall = [string, Record<string, unknown> | undefined];
const queries = (dataSource: ReturnType<typeof makeDataSource>) => dataSource.find.mock.calls as unknown as FindCall[];

const inputsOf = (type: string, namespace: string) =>
  new Map(
    (((ComponentRegistry.getConfig(type, namespace) as { inputs?: Array<Record<string, unknown>> } | undefined)?.inputs) ?? [])
      .map((input) => [String(input.name), input]),
  );

type SpecRow = { safeParse: (value: unknown) => { success: boolean } };
const specRow = (ComponentPropsMap as unknown as Record<string, SpecRow>)[TYPE];

/** The installed row's own describe for one member (read through `_def`, as `objectGanttInputs-11168` does). */
function rowDescribe(key: string): string {
  type Member = { description?: string };
  const def = (ComponentPropsMap as unknown as Record<string, { _def: { shape: Record<string, Member> | (() => Record<string, Member>) } }>)[TYPE]._def;
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  const describe = shape[key]?.description;
  expect(describe, `the installed row carries no describe for \`${key}\``).toBeTruthy();
  return describe as string;
}

/** The diagnostics the page validator raises, over the manifest the registry publishes. */
const diagnose = (node: Row) =>
  validateTree(
    node as never,
    manifestFromConfigs(
      ComponentRegistry.getKnownTypes().map((type) => {
        const meta = ComponentRegistry.getMeta(type);
        return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
      }) as unknown as Parameters<typeof manifestFromConfigs>[0],
    ),
  ).diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message]);

/** Every key this slice declares, one authored value each. */
const AUTHORED = {
  timeline: { ...TL, endDateField: 'finish', groupByField: 'status', colorField: 'color', scale: 'week' },
  limit: 5,
  data: RECORDS,
  items: ITEMS,
  dateFormat: 'long',
  rowLabel: 'Team',
  minDate: '2024-01-01',
  maxDate: '2024-03-01',
  descriptionField: 'summary',
  mapping: { title: 'code', date: 'start', description: 'summary', variant: 'kind' },
};

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── The registration ────────────────────────────────────────────────────────

describe('object-timeline publishes the ten spec keys its renderer honours (objectui#11168)', () => {
  it.each(TAGS)('$type — declares every row key with the row\'s kind, and `objectName` is not required', ({ type, namespace }) => {
    const inputs = inputsOf(type, namespace);
    expect([...inputs.keys()].filter((name) => name !== 'dataSource').sort()).toEqual([
      'data', 'dateFormat', 'descriptionField', 'filter', 'items', 'limit', 'mapping', 'maxDate',
      'minDate', 'navigation', 'objectName', 'rowLabel', 'sort', 'timeline', 'variant',
    ]);
    expect(inputs.get('objectName')?.required).toBeUndefined();
    expect(inputs.get('timeline')?.type).toBe('object');
    expect(inputs.get('mapping')?.type).toBe('object');
    expect(inputs.get('data')?.type).toBe('array');
    expect(inputs.get('items')?.type).toBe('array');
    expect(inputs.get('limit')?.type).toBe('number');
    expect(inputs.get('dateFormat')?.type).toBe('enum');
    expect(inputs.get('dateFormat')?.enum).toEqual(['short', 'long', 'iso']);
    for (const key of ['rowLabel', 'minDate', 'maxDate', 'descriptionField']) {
      expect(inputs.get(key)?.type, key).toBe('string');
    }
  });

  it.each(TAGS)('$type — the page validator accepts a timeline on `items` alone, on `data` alone, and every key authored', ({ type }) => {
    // Before this slice: `missing-required-prop` on `objectName` (an error)
    // and `unknown-prop` on `items` / `timeline`, for timelines that draw.
    expect(diagnose({ type, items: ITEMS })).toEqual([]);
    expect(diagnose({ type, timeline: TL, data: RECORDS })).toEqual([]);
    expect(diagnose({ type, objectName: OBJECT, ...AUTHORED })).toEqual([]);
  });

  it.each(TAGS)('$type — CONTROL: a bogus key is still reported', ({ type }) => {
    expect(diagnose({ type, objectName: OBJECT, bogusProp: 1 })).toEqual([
      ['unknown-prop', `<${type}> has no prop "bogusProp"`],
    ]);
  });

  it.each(TAGS)('$type — what NARROWS: an off-list `dateFormat` is now an error and a non-array `data` a warning, values the row refuses', ({ type }) => {
    // Before this slice the first was an `unknown-prop` warning and the second
    // drew nothing (`data` is a base prop wherever it is undeclared).
    expect(diagnose({ type, objectName: OBJECT, dateFormat: 'medium' })).toEqual([
      ['invalid-enum', `<${type}> prop "dateFormat"="medium" is not one of ["short","long","iso"]`],
    ]);
    expect(diagnose({ type, objectName: OBJECT, data: { x: 1 } })).toEqual([
      ['type-mismatch', `<${type}> prop "data" expected an array`],
    ]);
    expect(specRow.safeParse({ objectName: OBJECT, dateFormat: 'medium' }).success).toBe(false);
    expect(specRow.safeParse({ objectName: OBJECT, data: { x: 1 } }).success).toBe(false);
  });

  it('the installed spec row accepts every value the rows below author, and refuses a bogus key', () => {
    expect(specRow.safeParse({ objectName: OBJECT, ...AUTHORED }).success).toBe(true);
    expect(specRow.safeParse({ items: ITEMS }).success).toBe(true);
    expect(specRow.safeParse({ timeline: TL, data: RECORDS }).success).toBe(true);
    expect(specRow.safeParse({ objectName: OBJECT, bogusProp: 1 }).success).toBe(false);
  });

  it('where the row\'s own describe is true of this renderer, the description starts with it word for word', () => {
    // Each sentence after it is what the rows below measured.
    const inputs = inputsOf(TYPE, 'plugin-timeline');
    for (const key of ['objectName', 'timeline', 'limit', 'data', 'items', 'dateFormat', 'rowLabel', 'minDate', 'maxDate', 'mapping']) {
      expect(String(inputs.get(key)?.description).startsWith(rowDescribe(key)), key).toBe(true);
    }
  });

  it('`descriptionField` keeps only the describe\'s first sentence: `mapping.description` is a second spelling', () => {
    // The row's describe ends "it is the only spelling this binding has"; the
    // `mapping.description` rows below measure a second spelling that wins.
    const describe = rowDescribe('descriptionField');
    const firstSentence = describe.slice(0, describe.indexOf('. ') + 1);
    expect(firstSentence).toBe('Field rendered as each entry\'s description (renderer default `description`).');
    const description = String(inputsOf(TYPE, 'plugin-timeline').get('descriptionField')?.description);
    expect(description.startsWith(firstSentence)).toBe(true);
    expect(description).not.toContain('only spelling');
    expect(description).toContain('`mapping.description` outranks it');
  });

  it('the tolerant authoring face accepts the same timelines, by reference to the row', () => {
    // No mirror edit is owed: `ObjectTimelineBlockSchema` takes the 17.5.0 row
    // by reference (objectui#10859 batch 3), where `objectName` is optional.
    expect(safeValidateSchema({ type: TYPE, properties: { items: ITEMS } }).success).toBe(true);
    expect(safeValidateSchema({ type: TYPE, properties: { timeline: TL, data: RECORDS } }).success).toBe(true);
    expect(safeValidateSchema({ type: TYPE, properties: { objectName: OBJECT, ...AUTHORED } }).success).toBe(true);
  });
});

// ── objectName and the record source ────────────────────────────────────────

describe('`object-timeline.objectName` — optional: `items`, `data` and `bind` draw without it (objectui#11168)', () => {
  it('CONTROL: `objectName` is queried, with the default row cap', async () => {
    const { dataSource } = await mount(bag({ objectName: OBJECT, timeline: TL }), { waitFor: 'Kickoff' });
    expect(queries(dataSource).map(([object, query]) => [object, query?.$top])).toEqual([[OBJECT, 100]]);
  });

  it.each(TAGS)('$type — `items` alone draws, and queries nothing', async ({ type }) => {
    const { dataSource } = await mount(bag({ items: ITEMS }, type), { waitFor: 'Literal A' });
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it.each(TAGS)('$type — `data` alone draws every record, and queries nothing', async ({ type }) => {
    const { dataSource } = await mount(bag({ timeline: TL, data: RECORDS }, type), { waitFor: 'Kickoff' });
    expect(titles()).toEqual(['Kickoff', 'Review']);
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('a `bind` path alone draws the bound rows and queries nothing, with `objectName` beside it too', async () => {
    const scope = { rows: [{ id: 9, name: 'Bound', start: '2024-03-01' }] };
    let mounted = await mount({ type: TYPE, bind: 'rows', properties: { timeline: TL } }, { scope, waitFor: 'Bound' });
    expect(mounted.dataSource.find).not.toHaveBeenCalled();
    cleanup();
    mounted = await mount({ type: TYPE, bind: 'rows', properties: { objectName: OBJECT, timeline: TL } }, { scope, waitFor: 'Bound' });
    expect(mounted.dataSource.find).not.toHaveBeenCalled();
  });

  it('a `dataSource` binding supplies the object when the node names none', async () => {
    const { dataSource } = await mount({ type: TYPE, dataSource: { object: OBJECT }, properties: { timeline: TL } }, { waitFor: 'Kickoff' });
    expect(queries(dataSource).map(([object]) => object)).toEqual([OBJECT]);
  });
});

// ── data / items ────────────────────────────────────────────────────────────

describe('`object-timeline.data` — the members are RECORDS, read first (objectui#11168)', () => {
  it('each record is composed into an entry through the `timeline` bindings, and `objectName` beside it is never queried', async () => {
    const { dataSource } = await mount(bag({ objectName: OBJECT, timeline: TL, data: RECORDS }), { waitFor: 'Kickoff' });
    expect(titles()).toEqual(['Kickoff', 'Review']);
    expect(dates()).toEqual(['1/5/2024', '2/10/2024']);
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('it is read ahead of a `bind` path; the same bind alone draws its own rows (the control)', async () => {
    const scope = { rows: [{ id: 9, name: 'Bound', start: '2024-03-01' }] };
    await mount({ type: TYPE, bind: 'rows', properties: { timeline: TL, data: RECORDS } }, { scope, waitFor: 'Kickoff' });
    expect(titles()).toEqual(['Kickoff', 'Review']);
  });

  it('`items` beside it wins: the records are not drawn', async () => {
    await mount(bag({ timeline: TL, data: RECORDS, items: ITEMS }), { waitFor: 'Literal A' });
    expect(titles()).toEqual(['Literal A']);
  });
});

describe('`object-timeline.items` — the members are ENTRIES, drawn as written (objectui#11168)', () => {
  it('a feed entry is drawn as written, ahead of `objectName`, which is never queried', async () => {
    const { dataSource } = await mount(bag({ objectName: OBJECT, timeline: TL, items: ITEMS }), { waitFor: 'Literal A' });
    expect(titles()).toEqual(['Literal A']);
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('the `timeline` field bindings, `mapping` and `descriptionField` do not apply to an entry', async () => {
    await mount(
      bag({ items: [{ ...ITEMS[0], code: 'ZZ', summary: 'Not this' }], timeline: { ...TL, titleField: 'code' }, mapping: { title: 'code', description: 'code' }, descriptionField: 'summary' }),
      { waitFor: 'Literal A' },
    );
    expect(titles()).toEqual(['Literal A']);
    expect(descriptions()).toEqual(['Lit desc']);
  });

  it('under `variant: "gantt"` the members are rows, each drawn with its bars', async () => {
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt' }), { waitFor: 'Plan' });
    expect(screen.getByText('Bar')).toBeTruthy();
    expect(axis()).toEqual(['Feb 2024']);
  });
});

// ── timeline ────────────────────────────────────────────────────────────────

describe('`object-timeline.timeline` — the members name record fields, and `scale` the gantt axis (objectui#11168)', () => {
  it('`startDateField`, `endDateField` and `titleField` give an entry its date, the end printed after it, and its title', async () => {
    await mount(bag({ timeline: { startDateField: 'start', endDateField: 'finish', titleField: 'code' }, data: RECORDS }), { waitFor: 'K-1' });
    expect(titles()).toEqual(['K-1', 'R-2']);
    expect(dates()).toEqual(['1/5/2024 → 1/9/2024', '2/10/2024 → 2/12/2024']);
  });

  it('CONTROL: naming other fields moves the title and the date', async () => {
    await mount(bag({ timeline: { startDateField: 'finish', titleField: 'name' }, data: RECORDS }), { waitFor: 'Kickoff' });
    expect(titles()).toEqual(['Kickoff', 'Review']);
    expect(dates()).toEqual(['1/9/2024', '2/12/2024']);
  });

  it('`groupByField` names the field whose value heads each group; without it, entries group into date buckets', async () => {
    await mount(bag({ timeline: { ...TL, groupByField: 'status' }, data: RECORDS }), { waitFor: 'Kickoff' });
    expect(groups()).toEqual(['open', 'closed']);
    cleanup();
    await mount(bag({ timeline: TL, data: RECORDS }), { waitFor: 'Kickoff' });
    expect(groups()).toEqual(['Earlier']);
  });

  it('`colorField` paints the marker with the value itself when it is a colour literal; without it, no colour is painted', async () => {
    await mount(bag({ timeline: { ...TL, colorField: 'color' }, data: RECORDS }), { waitFor: 'Kickoff' });
    expect(markers().map((marker) => marker.color)).toEqual(['#ff0000', '#00ff00']);
    cleanup();
    await mount(bag({ timeline: TL, data: RECORDS }), { waitFor: 'Kickoff' });
    expect(markers().map((marker) => marker.color)).toEqual(['', '']);
  });

  it('…and with the option colour the named field declares for the record\'s value', async () => {
    const fields = { status: { type: 'select', options: [{ value: 'open', label: 'Open', color: '#123456' }, { value: 'closed', label: 'Closed' }] } };
    await mount(bag({ objectName: OBJECT, timeline: { ...TL, colorField: 'status' } }), { fields, waitFor: 'Kickoff' });
    expect(markers().map((marker) => marker.color)).toEqual(['#123456', '']);
  });

  it.each([
    ['startDateField', { startDateField: 'finish' }, {}, () => expect(dates()).toEqual(['1/5/2024', '2/10/2024'])],
    ['titleField', { titleField: 'code' }, {}, () => expect(titles()).toEqual(['Kickoff', 'Review'])],
    ['endDateField', { endDateField: 'start' }, { endDateField: 'finish' }, () => expect(dates()).toEqual(['1/5/2024 → 1/9/2024', '2/10/2024 → 2/12/2024'])],
    ['groupByField', { groupByField: 'kind' }, { groupByField: 'status' }, () => expect(groups()).toEqual(['open', 'closed'])],
    ['colorField', { colorField: 'kind' }, { colorField: 'color' }, () => expect(markers().map((marker) => marker.color)).toEqual(['#ff0000', '#00ff00'])],
  ] as const)('`%s` outranks the flat key of the same binding (composed on the node: the authored node cannot carry it)', async (_key, flat, member, assert) => {
    await mount({ type: TYPE, ...flat, properties: { timeline: { ...TL, ...member }, data: RECORDS } }, { waitFor: 'Kickoff' });
    assert();
  });

  it('`titleField` and `startDateField` outrank `mapping`\'s `title` and `date`', async () => {
    await mount(bag({ timeline: TL, data: RECORDS, mapping: { title: 'code', date: 'finish' } }), { waitFor: 'Kickoff' });
    expect(titles()).toEqual(['Kickoff', 'Review']);
    expect(dates()).toEqual(['1/5/2024', '2/10/2024']);
  });

  it('`scale` sets the gantt axis unit on authored rows; without it the axis is the renderer\'s own', async () => {
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt', timeline: { ...TL, scale: 'week' } }), { waitFor: 'Plan' });
    expect(axis()).toEqual(['Week 1', 'Week 2', 'Week 3']);
    cleanup();
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt', timeline: TL }), { waitFor: 'Plan' });
    expect(axis()).toEqual(['Feb 2024']);
  });
});

// ── mapping / descriptionField ──────────────────────────────────────────────

describe('`object-timeline.mapping` — the members are `{ title, date, description, variant }` field names (objectui#11168)', () => {
  it('`title` and `date` name the fields an entry is titled and dated by, where no `timeline` block names them', async () => {
    await mount(bag({ data: RECORDS, mapping: { title: 'code', date: 'start' } }), { waitFor: 'K-1' });
    expect(titles()).toEqual(['K-1', 'R-2']);
    expect(dates()).toEqual(['1/5/2024', '2/10/2024']);
  });

  it('they outrank the flat keys of the same bindings (composed on the node: the authored node cannot carry them)', async () => {
    await mount({ type: TYPE, titleField: 'name', startDateField: 'start', properties: { data: RECORDS, mapping: { title: 'code', date: 'finish' } } }, { waitFor: 'K-1' });
    expect(titles()).toEqual(['K-1', 'R-2']);
    expect(dates()).toEqual(['1/9/2024', '2/12/2024']);
  });

  it('`description` outranks `descriptionField`', async () => {
    await mount(bag({ timeline: TL, data: RECORDS, descriptionField: 'summary', mapping: { description: 'code' } }), { waitFor: 'Kickoff' });
    expect(descriptions()).toEqual(['K-1', 'R-2']);
  });

  it('`variant` names the field whose value picks the marker colour; without it the record\'s own `variant` field does', async () => {
    await mount(bag({ timeline: TL, data: RECORDS, mapping: { variant: 'kind' } }), { waitFor: 'Kickoff' });
    expect(markers().map((marker) => marker.variant)).toEqual(['bg-emerald-200', 'bg-amber-200']);
    cleanup();
    await mount(bag({ timeline: TL, data: RECORDS }), { waitFor: 'Kickoff' });
    expect(markers().map((marker) => marker.variant)).toEqual(['bg-red-200', 'bg-purple-200']);
  });

  it('on the vertical rail a colour `timeline.colorField` resolves outranks that marker colour', async () => {
    await mount(bag({ timeline: { ...TL, colorField: 'color' }, data: RECORDS, mapping: { variant: 'kind' } }), { waitFor: 'Kickoff' });
    expect(markers()).toEqual([
      { variant: 'bg-blue-200', color: '#ff0000' },
      { variant: 'bg-blue-200', color: '#00ff00' },
    ]);
  });
});

describe('`object-timeline.descriptionField` — the field an entry is described by (objectui#11168)', () => {
  it('it names the field; without it the record\'s `description` field is read', async () => {
    await mount(bag({ timeline: TL, data: RECORDS, descriptionField: 'summary' }), { waitFor: 'Kickoff' });
    expect(descriptions()).toEqual(['Sum one', 'Sum two']);
    cleanup();
    await mount(bag({ timeline: TL, data: RECORDS }), { waitFor: 'Kickoff' });
    expect(descriptions()).toEqual(['Desc one', 'Desc two']);
  });
});

// ── limit / filter / sort ───────────────────────────────────────────────────

describe('`object-timeline.limit` — the row cap on the query (objectui#11168)', () => {
  it('it is lowered to `$top`; without it the cap is 100', async () => {
    let mounted = await mount(bag({ objectName: OBJECT, timeline: TL, limit: 5 }), { waitFor: 'Kickoff' });
    expect(queries(mounted.dataSource).map(([, query]) => query?.$top)).toEqual([5]);
    cleanup();
    mounted = await mount(bag({ objectName: OBJECT, timeline: TL }), { waitFor: 'Kickoff' });
    expect(queries(mounted.dataSource).map(([, query]) => query?.$top)).toEqual([100]);
  });

  it.each([0, 2.5])('`%s`, not a positive integer, is ignored with a warning, and the default cap applies', async (limit) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { dataSource } = await mount(bag({ objectName: OBJECT, timeline: TL, limit }), { waitFor: 'Kickoff' });
    expect(queries(dataSource).map(([, query]) => query?.$top)).toEqual([100]);
    expect(warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes(`limit: ${limit}`))).toHaveLength(1);
  });
});

describe('`object-timeline.filter` — the members are `{ field, operator, value }` rules (objectui#11168)', () => {
  const RULE = [{ field: 'status', operator: 'equals', value: 'open' }];

  it('a rule reaches `$filter` with its members unchanged; a node with no `filter` sends none (the control)', async () => {
    let mounted = await mount(bag({ objectName: OBJECT, timeline: TL, filter: RULE }), { waitFor: 'Kickoff' });
    expect(queries(mounted.dataSource)[0][1]?.$filter).toEqual(RULE);
    cleanup();
    mounted = await mount(bag({ objectName: OBJECT, timeline: TL }), { waitFor: 'Kickoff' });
    expect(queries(mounted.dataSource)[0][1]?.$filter).toBeUndefined();
  });

  it('a `{current_user_id}` token in `value` is resolved before the query', async () => {
    const { dataSource } = await mount(
      bag({ objectName: OBJECT, timeline: TL, filter: [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }] }),
      { currentUserId: 'u-1', waitFor: 'Kickoff' },
    );
    expect(queries(dataSource)[0][1]?.$filter).toEqual([{ field: 'owner', operator: 'equals', value: 'u-1' }]);
  });

  it('beside `data` it narrows nothing: the records are drawn whole and nothing is queried', async () => {
    const { dataSource } = await mount(bag({ objectName: OBJECT, timeline: TL, data: RECORDS, filter: RULE }), { waitFor: 'Kickoff' });
    expect(titles()).toEqual(['Kickoff', 'Review']);
    expect(dataSource.find).not.toHaveBeenCalled();
  });
});

describe('`object-timeline.sort` — the members are `{ field, order }`, and they order the QUERY (objectui#11168)', () => {
  it('each member lowers to `field -> direction` on `$orderby`, in authored order, an omitted `order` reading ascending', async () => {
    const { dataSource } = await mount(bag({ objectName: OBJECT, timeline: TL, sort: [{ field: 'status', order: 'desc' }, { field: 'name' }] }), { waitFor: 'Kickoff' });
    const orderby = queries(dataSource)[0][1]?.$orderby as Record<string, string>;
    expect(orderby).toEqual({ status: 'desc', name: 'asc' });
    expect(Object.keys(orderby)).toEqual(['status', 'name']);
  });

  it('the rail draws the fetched entries by start date whatever the order; with no `sort` the query carries none (the control)', async () => {
    // The adapter answers latest-first, as a `name desc` query would.
    let mounted = await mount(bag({ objectName: OBJECT, timeline: TL, sort: [{ field: 'name', order: 'desc' }] }), { rows: [RECORDS[1], RECORDS[0]], waitFor: 'Kickoff' });
    expect(queries(mounted.dataSource)[0][1]?.$orderby).toEqual({ name: 'desc' });
    expect(titles()).toEqual(['Kickoff', 'Review']);
    cleanup();
    mounted = await mount(bag({ objectName: OBJECT, timeline: TL }), { waitFor: 'Kickoff' });
    expect(queries(mounted.dataSource)[0][1]?.$orderby).toBeUndefined();
  });
});

// ── dateFormat / rowLabel / minDate / maxDate ───────────────────────────────

describe('`object-timeline.dateFormat` — how an entry\'s date is printed (objectui#11168)', () => {
  it.each([
    [undefined, '1/5/2024'],
    ['short', '1/5/2024'],
    ['long', 'January 5, 2024'],
    ['iso', '2024-01-05'],
  ] as const)('`%s` prints %s on the vertical rail', async (dateFormat, printed) => {
    await mount(bag({ items: ITEMS, ...(dateFormat ? { dateFormat } : {}) }), { waitFor: 'Literal A' });
    expect(dates()).toEqual([printed]);
  });

  it('the horizontal rail, and entries composed from records, print the same way', async () => {
    await mount(bag({ items: ITEMS, variant: 'horizontal', dateFormat: 'long' }), { waitFor: 'Literal A' });
    expect(dates()).toEqual(['January 5, 2024']);
    cleanup();
    await mount(bag({ timeline: TL, data: RECORDS, dateFormat: 'iso' }), { waitFor: 'Kickoff' });
    expect(dates()).toEqual(['2024-01-05', '2024-02-10']);
  });
});

describe('`object-timeline.rowLabel` — the gantt row column\'s header (objectui#11168)', () => {
  it('it heads the row column of a gantt; without it the default label does', async () => {
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt', rowLabel: 'Team' }), { waitFor: 'Plan' });
    expect(screen.getByText('Team')).toBeTruthy();
    cleanup();
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt' }), { waitFor: 'Plan' });
    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.getByText('Items')).toBeTruthy();
  });

  it('the feed rails read it nowhere', async () => {
    await mount(bag({ items: ITEMS, rowLabel: 'Team' }), { waitFor: 'Literal A' });
    expect(screen.queryByText('Team')).toBeNull();
  });
});

describe('`object-timeline.minDate` / `maxDate` — pin the gantt axis (objectui#11168)', () => {
  it('CONTROL: with neither, the axis is derived from the rows', async () => {
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt' }), { waitFor: 'Plan' });
    expect(axis()).toEqual(['Feb 2024']);
  });

  it('a pinned start and end replace the derived ones, each on its own', async () => {
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt', minDate: '2024-01-01', maxDate: '2024-03-01' }), { waitFor: 'Plan' });
    expect(axis()).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    cleanup();
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt', maxDate: '2024-04-01' }), { waitFor: 'Plan' });
    expect(axis()).toEqual(['Feb 2024', 'Mar 2024', 'Apr 2024']);
  });

  it.each(['minDate', 'maxDate'] as const)('an empty `%s` is not honoured: the axis stays derived', async (key) => {
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt', [key]: '' }), { waitFor: 'Plan' });
    expect(axis()).toEqual(['Feb 2024']);
  });

  it.each(['minDate', 'maxDate'] as const)('a `%s` that is not a date refuses the chart, naming it', async (key) => {
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt', [key]: 'whenever' }));
    expect(refusal()?.textContent).toContain(`${key} is "whenever"`);
    expect(screen.queryByText('Bar')).toBeNull();
  });

  it('a `minDate` after `maxDate` refuses the chart, naming both', async () => {
    await mount(bag({ items: GANTT_ROWS, variant: 'gantt', minDate: '2024-03-01', maxDate: '2024-01-01' }));
    expect(refusal()?.textContent).toContain('minDate "2024-03-01" is after maxDate "2024-01-01"');
  });
});

// ── navigation: the ABSENT key against the mode-less block ─────────────────

describe('an ABSENT `navigation` is not a `page` block (objectui#11168, the `ObjectTimelineProps.navigation` JSDoc)', () => {
  function recordNavigatorHost() {
    const openRecord = vi.fn();
    const value: RelatedRecordActionsValue = {
      resolve: () => ({}),
      recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${recordId}`,
      openRecord,
    };
    return { value, openRecord };
  }

  it('under a host that publishes a record navigator, the absent key opens nothing, where `{ size: "lg" }` (mode-less, so `page`) opens the record page through it', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const absent = recordNavigatorHost();
    await mount(bag({ objectName: OBJECT, timeline: TL, data: RECORDS }), { host: absent.value, waitFor: 'Kickoff' });
    fireEvent.click(screen.getByText('Kickoff'));
    await settle();
    expect(absent.openRecord).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    cleanup();
    const modeless = recordNavigatorHost();
    await mount(bag({ objectName: OBJECT, timeline: TL, data: RECORDS, navigation: { size: 'lg' } }), { host: modeless.value, waitFor: 'Kickoff' });
    fireEvent.click(screen.getByText('Kickoff'));
    await settle();
    expect(modeless.openRecord).toHaveBeenCalledWith(OBJECT, 1);
    expect(open).not.toHaveBeenCalled();
  });
});
