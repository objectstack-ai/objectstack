/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 slice 4 — what `object-gantt` PUBLISHES, and what its renderer
 * does with each key the spec row declares.
 *
 * `@objectstack/spec` 17.5.0 gave `object-gantt` a `ComponentPropsMap` row, and
 * the repo-wide parity guard
 * (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`) now loads
 * this plugin, so it judges the registration in both directions. Under
 * objectui#11111 decision 3 = B every key is decided by its own measurement.
 * The judgment found eleven row keys the registration did not publish —
 * `navigation`, `label`, `skipWeekends`, `holidays`, `persistLayout`,
 * `viewName`, `markers`, `criticalPath`, `showBaselines`, `readOnly` and
 * `mobileReadOnly` — and the renderer honours all eleven, so they are declared.
 *
 * The guard also owes a member pin for every structured key the block
 * publishes. This file carries seven of them: `gantt`, `filter`, `sort`,
 * `navigation`, `holidays`, `markers` and `label` (its locale-map arm).
 * `data` and `staticData` are `recordSourceInputs-10394.test.tsx`, and
 * `dataSource` is `../ObjectGantt.elementDataSource.test.tsx`.
 *
 * Every behavioural row mounts the block the way a page does: the AUTHORED
 * node, `{ type: 'object-gantt', properties: { … } }`, through the REAL
 * `SchemaRenderer`, this package's own registration and the REAL `GanttView`.
 * Only the record panel inside an overlay is a stand-in, so a row can read
 * which record opened and whether it opened writable.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import {
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import { ComponentPropsMap } from '@objectstack/spec/ui';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// The record panel an overlay draws, reduced to what a row reads: WHICH record
// opened, and whether it opened writable (`onFieldSave` handed to it).
vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailPanel: (props: { recordId?: unknown; objectName?: string; onFieldSave?: unknown }) => (
    <div
      data-testid="record-panel"
      data-record={String(props.recordId)}
      data-object={props.objectName}
      data-writable={String(!!props.onFieldSave)}
    />
  ),
}));

// Registers `object-gantt` through this package's own entry, at module scope.
import '../index';

const TYPE = 'object-gantt';
const OBJECT = 'task';
const GANTT = { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' };

/** Two tasks, Monday to Friday of two consecutive weeks. */
const ROWS = [
  { id: 't1', name: 'Design', code: 'D-1', start_date: '2026-03-02', end_date: '2026-03-06', base_start: '2026-03-02', base_end: '2026-03-04', status: 'open', alt_start: '2026-04-06', alt_end: '2026-04-10' },
  { id: 't2', name: 'Build', code: 'B-2', start_date: '2026-03-09', end_date: '2026-03-13', base_start: '2026-03-09', base_end: '2026-03-11', status: 'closed', alt_start: '2026-04-13', alt_end: '2026-04-17' },
];

/** The scheduling fixture: t2 depends on t1 but starts before t1 ends. */
const DEP_GANTT = { ...GANTT, dependenciesField: 'deps' };
const DEP_ROWS = [
  { id: 't1', name: 'Design', start_date: '2026-03-02', end_date: '2026-03-06', deps: [] },
  { id: 't2', name: 'Build', start_date: '2026-03-03', end_date: '2026-03-04', deps: ['t1'] },
];

function makeDataSource(rows: Array<Record<string, unknown>> = ROWS, objectLabel?: string) {
  return {
    find: vi.fn().mockResolvedValue({ data: rows }),
    findOne: vi.fn().mockResolvedValue(rows[0]),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      label: objectLabel,
      fields: {
        name: { type: 'text' },
        code: { type: 'text' },
        status: { type: 'text' },
        start_date: { type: 'date' },
        end_date: { type: 'date' },
        base_start: { type: 'date' },
        base_end: { type: 'date' },
        deps: { type: 'json' },
      },
    }),
  };
}

/** The authored node: every prop in the spec's `properties` bag. */
const bag = (props: Record<string, unknown>, base: Record<string, unknown> = { objectName: OBJECT, gantt: GANTT }) => ({
  type: TYPE,
  properties: { ...base, ...props },
});

interface MountOptions {
  host?: RelatedRecordActionsValue;
  locale?: string;
  dataSource?: ReturnType<typeof makeDataSource>;
}

/** Mount one node through the real `SchemaRenderer` and wait for the chart's first row. */
async function mount(node: Record<string, unknown>, options: MountOptions = {}) {
  const dataSource = options.dataSource ?? makeDataSource();
  const tree = (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: options.locale }}>
        <SchemaRendererProvider dataSource={dataSource as never}>
          <SchemaRenderer schema={node as never} />
        </SchemaRendererProvider>
      </LocalizationProvider>
    </I18nProvider>
  );
  const view = render(options.host ? <RelatedRecordActionsProvider value={options.host}>{tree}</RelatedRecordActionsProvider> : tree);
  await screen.findByTestId('gantt-row-open-t1', {}, { timeout: 4000 });
  return { dataSource, ...view };
}

/** Give a click (or a query) every chance to have happened before asserting it did not. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

const inputOf = (name: string) =>
  ((ComponentRegistry.getConfig(TYPE, 'plugin-gantt') as { inputs?: Array<Record<string, unknown>> } | undefined)
    ?.inputs ?? []).find((input) => input.name === name);

const specRow = (ComponentPropsMap as unknown as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ code: string; path: unknown[]; keys?: string[] }> } } }>)[TYPE];

/**
 * The installed row's own describe for one member. Read through `_def` for the
 * reason `ObjectMap.dataArmSpecRow-8348` gives: the row is a lazy schema, and
 * `_def` is the internal the spec publishes no type for.
 */
function rowDescribe(key: string): string {
  type Member = { description?: string };
  const def = (ComponentPropsMap as unknown as Record<string, { _def: { shape: Record<string, Member> | (() => Record<string, Member>) } }>)[TYPE]._def;
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  const describe = shape[key]?.description;
  expect(describe, `the installed row carries no describe for \`${key}\``).toBeTruthy();
  return describe as string;
}

/** The diagnostics the page validator raises, over the manifest the registry publishes. */
const diagnose = (node: Record<string, unknown>) =>
  validateTree(
    node as never,
    manifestFromConfigs(
      ComponentRegistry.getKnownTypes().map((type) => {
        const meta = ComponentRegistry.getMeta(type);
        return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
      }) as unknown as Parameters<typeof manifestFromConfigs>[0],
    ),
  ).diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message]);

/** Every authored value the rows below write, one per declared key. */
const AUTHORED = {
  navigation: { mode: 'drawer', size: 'lg' },
  label: { en: 'Shift Plan', 'zh-CN': '排班计划' },
  skipWeekends: true,
  holidays: ['2026-03-04'],
  persistLayout: false,
  viewName: 'board',
  markers: [{ date: '2026-03-05', label: 'Deadline', color: 'red' }],
  criticalPath: true,
  showBaselines: false,
  readOnly: true,
  mobileReadOnly: false,
};

const spyOnPush = () => vi.spyOn(window.history, 'pushState');
const spyOnOpen = () => vi.spyOn(window, 'open').mockReturnValue(null);
let pushSpy: ReturnType<typeof spyOnPush>;
let openSpy: ReturnType<typeof spyOnOpen>;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  // An object view route, so the record-page address the gantt derives is the
  // record page; the off-route rows park elsewhere themselves.
  window.history.replaceState({}, '', `/console/${OBJECT}/views/all`);
  pushSpy = spyOnPush();
  openSpy = spyOnOpen();
  try { window.localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── The registration ────────────────────────────────────────────────────────

describe('object-gantt publishes the eleven spec keys its renderer honours (objectui#11168)', () => {
  it('declares each key with the spec row\'s kind', () => {
    expect(inputOf('navigation')?.type).toBe('object');
    expect(inputOf('label')?.type).toEqual(['string', 'object']);
    expect(inputOf('holidays')?.type).toBe('array');
    expect(inputOf('holidays')?.of).toBe('string');
    expect(inputOf('markers')?.type).toBe('array');
    expect(inputOf('viewName')?.type).toBe('string');
    for (const key of ['skipWeekends', 'persistLayout', 'criticalPath', 'showBaselines', 'readOnly', 'mobileReadOnly']) {
      expect(inputOf(key)?.type, key).toBe('boolean');
    }
  });

  it('the page validator accepts all eleven, and a bogus key is still reported (the control)', () => {
    // Before this slice each of the eleven was an `unknown-prop` warning.
    expect(diagnose({ type: TYPE, objectName: OBJECT, gantt: GANTT, ...AUTHORED })).toEqual([]);
    expect(diagnose({ type: TYPE, objectName: OBJECT, gantt: GANTT, bogusProp: 1 })).toEqual([
      ['unknown-prop', `<${TYPE}> has no prop "bogusProp"`],
    ]);
  });

  it('the installed spec row accepts every value the rows below author, and refuses a bogus key', () => {
    const parsed = specRow.safeParse({ objectName: OBJECT, gantt: { ...DEP_GANTT, baselineStartField: 'base_start', baselineEndField: 'base_end', exportFileName: 'Explicit' }, ...AUTHORED });
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(specRow.safeParse({ objectName: OBJECT, label: 'Plain', navigation: { mode: 'page' }, markers: [{ date: '2026-03-05' }] }).success).toBe(true);
    expect(specRow.safeParse({ staticData: ROWS, gantt: GANTT }).success).toBe(true);
    expect(specRow.safeParse({ objectName: OBJECT, bogusProp: 1 }).success).toBe(false);
  });

  it('where the row\'s own describe is true of this renderer, the description starts with it word for word', () => {
    // Each sentence after it is what the rows below measured.
    for (const key of ['gantt', 'label', 'skipWeekends', 'holidays', 'persistLayout', 'viewName', 'markers', 'criticalPath', 'showBaselines', 'readOnly', 'mobileReadOnly']) {
      expect(String(inputOf(key)?.description).startsWith(rowDescribe(key)), key).toBe(true);
    }
  });
});

// ── gantt ───────────────────────────────────────────────────────────────────

describe('`object-gantt.gantt` — the members are field names, and the block is taken whole (objectui#11168)', () => {
  // The Start / End faces name a date's year when it is not the current one
  // (objectui#12110 item 5), so the fixtures' 2026 dates are pinned to a 2026
  // clock (Date only): these legs read which FIELDS the dates come from, and
  // must not change meaning on New Year's Day.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 2, 15, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const titleOf = (id: string) => screen.getByTestId(`gantt-row-title-${id}`).textContent;
  const startOf = (id: string) => screen.getByTestId(`gantt-row-start-${id}`).textContent;
  const endOf = (id: string) => screen.getByTestId(`gantt-row-end-${id}`).textContent;

  it('`titleField`, `startDateField` and `endDateField` name the fields a bar is titled by, starts at and ends at', async () => {
    await mount(bag({}));
    expect(titleOf('t1')).toBe('Design');
    expect(startOf('t1')).toBe('3/2');
    expect(endOf('t1')).toBe('3/6');
  });

  it('CONTROL: naming other fields moves the title and the dates', async () => {
    await mount(bag({ gantt: { startDateField: 'alt_start', endDateField: 'alt_end', titleField: 'code' } }));
    expect(titleOf('t1')).toBe('D-1');
    expect(startOf('t1')).toBe('4/6');
    expect(endOf('t1')).toBe('4/10');
  });

  it('the block is taken WHOLE: flat keys composed on the node beside it are ignored', async () => {
    // A node composed in code (the authored node cannot carry the flat keys:
    // the row refuses them by name).
    await mount({ type: TYPE, startDateField: 'alt_start', endDateField: 'alt_end', titleField: 'code', properties: { objectName: OBJECT, gantt: GANTT } });
    expect(titleOf('t1')).toBe('Design');
    expect(startOf('t1')).toBe('3/2');
  });

  it('the spec requires the trio, and refuses a member nothing reads (`percentageField`, which this description used to name)', () => {
    const missing = specRow.safeParse({ objectName: OBJECT, gantt: { startDateField: 'start_date', endDateField: 'end_date' } });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((issue) => issue.path.join('.'))).toContain('gantt.titleField');
    const stray = specRow.safeParse({ objectName: OBJECT, gantt: { ...GANTT, percentageField: 'pct' } });
    expect(stray.success).toBe(false);
    expect(stray.error?.issues.flatMap((issue) => issue.keys ?? [])).toContain('percentageField');
    expect(String(inputOf('gantt')?.description)).not.toContain('percentageField');
  });
});

// ── filter / sort ───────────────────────────────────────────────────────────

describe('`object-gantt.filter` — the members are `{ field, operator, value }` rules (objectui#11168)', () => {
  const titles = () => Array.from(document.querySelectorAll('[data-testid^="gantt-row-title-"]')).map((el) => el.textContent);

  it('a rule narrows the inline rows charted, and `operator` is read (`not_equals` charts the complement)', async () => {
    await mount(bag({ filter: [{ field: 'status', operator: 'equals', value: 'open' }] }, { staticData: ROWS, gantt: GANTT }));
    expect(titles()).toEqual(['Design']);
    cleanup();
    // `mount` waits for `t1`, which this rule removes, so the complement waits for `t2`.
    render(
      <SchemaRendererProvider dataSource={makeDataSource() as never}>
        <SchemaRenderer schema={bag({ filter: [{ field: 'status', operator: 'not_equals', value: 'open' }] }, { staticData: ROWS, gantt: GANTT }) as never} />
      </SchemaRendererProvider>,
    );
    await screen.findByTestId('gantt-row-title-t2', {}, { timeout: 4000 });
    expect(titles()).toEqual(['Build']);
  });

  it('on the object query the rule reaches `$filter` unchanged, and a node with no `filter` sends none (the control)', async () => {
    const rule = [{ field: 'status', operator: 'equals', value: 'open' }];
    const { dataSource } = await mount(bag({ filter: rule }));
    expect(dataSource.find.mock.calls[0][1]?.$filter).toEqual(rule);
    cleanup();
    const control = await mount(bag({}));
    expect(control.dataSource.find.mock.calls[0][1]?.$filter).toBeUndefined();
  });
});

describe('`object-gantt.sort` — the members are `{ field, order }` (objectui#11168)', () => {
  it('each member lowers to `field -> direction` on `$orderby`, in authored order, an omitted `order` reading ascending', async () => {
    const { dataSource } = await mount(bag({ sort: [{ field: 'status', order: 'desc' }, { field: 'name' }] }));
    const orderby = dataSource.find.mock.calls[0][1]?.$orderby as Record<string, string>;
    expect(orderby).toEqual({ status: 'desc', name: 'asc' });
    expect(Object.keys(orderby)).toEqual(['status', 'name']);
  });

  it('the members order inline rows too, and with no `sort` the query carries none (the control)', async () => {
    await mount(bag({ sort: [{ field: 'name', order: 'asc' }] }, { staticData: ROWS, gantt: GANTT }));
    const titles = Array.from(document.querySelectorAll('[data-testid^="gantt-row-title-"]')).map((el) => el.textContent);
    expect(titles).toEqual(['Build', 'Design']);
    cleanup();
    const control = await mount(bag({}));
    expect(control.dataSource.find.mock.calls[0][1]?.$orderby).toBeUndefined();
  });
});

// ── navigation ──────────────────────────────────────────────────────────────

/** A host publishing its record navigator the way the console does (`RelatedRecordActionsContext`). */
function recordNavigatorHost() {
  const openRecord = vi.fn();
  const value: RelatedRecordActionsValue = {
    resolve: () => ({}),
    recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${recordId}`,
    openRecord,
  };
  return { value, openRecord };
}

/** Mount one gantt with an authored `navigation` (or none) and click its first task's open button. */
async function clickTask(
  navigation: Record<string, unknown> | undefined,
  options: { host?: RelatedRecordActionsValue; base?: Record<string, unknown> } = {},
) {
  await mount(bag(navigation ? { navigation } : {}, options.base), { host: options.host });
  fireEvent.click(screen.getByTestId('gantt-row-open-t1'));
  await settle();
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const panel = () => screen.queryByTestId('record-panel');
const pushed = () => pushSpy.mock.calls.map((call) => call[2]);
const opened = () => openSpy.mock.calls.map((call) => call.slice(0, 2));

function expectNothingOpened(why: string) {
  expect(panel(), `${why}: a record opened`).toBeNull();
  expect(dialog(), `${why}: an overlay opened`).toBeNull();
  expect(pushed(), `${why}: the page navigated`).toEqual([]);
  expect(opened(), `${why}: a tab was opened`).toEqual([]);
}

/** The resolved overlay width, read off the `--ov-w` custom property the shared shell publishes. */
function panelWidth(): string {
  expect(dialog(), 'overlay panel').not.toBeNull();
  return dialog()!.style.getPropertyValue('--ov-w').trim();
}

const RECORD_PAGE = `/console/${OBJECT}/record/t1`;

describe('`object-gantt.navigation` — the members decide what a task click opens (objectui#11168)', () => {
  it('LIT CONTROL: with the key ABSENT a click opens the task\'s record in a drawer, writable', async () => {
    await clickTask(undefined);
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panel()?.getAttribute('data-record')).toBe('t1');
    expect(panel()?.getAttribute('data-writable')).toBe('true');
    expect(pushed()).toEqual([]);
  });

  it.each(['drawer', 'modal', 'popover'] as const)('`mode: "%s"` opens the task\'s record in that overlay', async (mode) => {
    await clickTask({ mode });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panel()?.getAttribute('data-record')).toBe('t1');
    expect(pushed()).toEqual([]);
    expect(opened()).toEqual([]);
  });

  it('`mode: "split"` opens the record BESIDE the chart, which stays drawn', async () => {
    await clickTask({ mode: 'split' });
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(panel()?.getAttribute('data-record')).toBe('t1');
    expect(screen.getByTestId('gantt-body')).toBeTruthy();
    expect(dialog()).toBeNull();
  });

  it('`mode: "none"` and `preventNavigation: true` open nothing, the flag outranking an overlay mode', async () => {
    await clickTask({ mode: 'none' });
    expectNothingOpened('none');
    cleanup();
    await clickTask({ mode: 'drawer', preventNavigation: true });
    expectNothingOpened('preventNavigation');
  });

  it('`page`, and a block without `mode`, open the record page in the same tab', async () => {
    await clickTask({ mode: 'page' });
    expect(pushed()).toEqual([RECORD_PAGE]);
    expect(window.location.pathname).toBe(RECORD_PAGE);
    expect(dialog()).toBeNull();
    cleanup();
    pushSpy.mockClear();
    window.history.replaceState({}, '', `/console/${OBJECT}/views/all`);
    await clickTask({ size: 'lg' });
    expect(pushed()).toEqual([RECORD_PAGE]);
    expect(dialog()).toBeNull();
  });

  it('`new_window` opens the record page in a new tab, and `openNewTab` outranks `page` and `drawer` but not `none`', async () => {
    await clickTask({ mode: 'new_window' });
    expect(opened()).toEqual([[RECORD_PAGE, '_blank']]);
    expect(pushed()).toEqual([]);
    cleanup();
    openSpy.mockClear();
    await clickTask({ mode: 'drawer', openNewTab: true });
    expect(opened()).toEqual([[RECORD_PAGE, '_blank']]);
    expect(dialog()).toBeNull();
    cleanup();
    openSpy.mockClear();
    await clickTask({ mode: 'page', openNewTab: true });
    expect(opened()).toEqual([[RECORD_PAGE, '_blank']]);
    expect(pushed()).toEqual([]);
    cleanup();
    openSpy.mockClear();
    await clickTask({ mode: 'none', openNewTab: true });
    expectNothingOpened('none beside openNewTab');
  });

  it('`size` and `width` are one width decision: `width` wins, a bucket resolves, `auto` lands on the default', async () => {
    await clickTask({ mode: 'drawer' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    const unsized = panelWidth();
    cleanup();
    await clickTask({ mode: 'drawer', size: 'lg' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).not.toBe(unsized);
    cleanup();
    await clickTask({ mode: 'drawer', size: 'sm', width: '720px' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).toContain('720px');
    cleanup();
    await clickTask({ mode: 'drawer', size: 'auto' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).toBe(unsized);
  });

  it('the object is `data.object` when `data` is the object provider and the node names no `objectName`', async () => {
    await clickTask({ mode: 'page' }, { base: { data: { provider: 'object', object: OBJECT }, gantt: GANTT } });
    expect(pushed()).toEqual([RECORD_PAGE]);
  });

  it('on inline rows that name no object every mode opens nothing, the default drawer included', async () => {
    for (const navigation of [undefined, { mode: 'drawer' }, { mode: 'page' }, { mode: 'new_window' }]) {
      await clickTask(navigation, { base: { staticData: ROWS, gantt: GANTT } });
      expectNothingOpened(`inline rows, ${JSON.stringify(navigation ?? 'absent')}`);
      cleanup();
    }
  });
});

describe('`object-gantt.navigation` does not use the host\'s record navigator (objectui#11168, objectui#11293)', () => {
  it('LIT CONTROL: under a host that publishes its navigator, `drawer` still opens the drawer and reaches no navigator', async () => {
    const { value, openRecord } = recordNavigatorHost();
    await clickTask({ mode: 'drawer' }, { host: value });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openRecord).not.toHaveBeenCalled();
  });

  it('under that host, `page` and a block without `mode` open the gantt\'s OWN derived address, never `openRecord`', async () => {
    const { value, openRecord } = recordNavigatorHost();
    await clickTask({ mode: 'page' }, { host: value });
    expect(pushed()).toEqual([RECORD_PAGE]);
    cleanup();
    pushSpy.mockClear();
    window.history.replaceState({}, '', `/console/${OBJECT}/views/all`);
    await clickTask({ size: 'lg' }, { host: value });
    expect(pushed()).toEqual([RECORD_PAGE]);
    expect(openRecord).not.toHaveBeenCalled();
  });

  it('under that host, an ABSENT key still opens the drawer', async () => {
    const { value, openRecord } = recordNavigatorHost();
    await clickTask(undefined, { host: value });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openRecord).not.toHaveBeenCalled();
  });

  it('MEASURED, NOT ENDORSED: off the object\'s own route the derived address is the current one with `/OBJECT/record/ID` appended, host or not', async () => {
    // What the description states, pinned so it stays true. On a console
    // custom page this address matches no route; the report of this slice
    // carries it as a finding rather than this file fixing it.
    for (const host of [undefined, recordNavigatorHost().value]) {
      window.history.replaceState({}, '', '/console/page/plan');
      pushSpy.mockClear();
      await clickTask({ mode: 'page' }, { host });
      expect(pushed()).toEqual([`/console/page/plan/${OBJECT}/record/t1`]);
      cleanup();
    }
  });
});

// ── label ───────────────────────────────────────────────────────────────────

// The real export path rasterizes an SVG through `new Image()` and a canvas,
// which happy-dom decodes neither of; both are stubbed down to what the path
// reads, as `ObjectGantt.exportFileName.i18n.test.tsx` does. The FILENAME is
// under test, read off the download anchor's `download` attribute.
async function exportedFileName(node: Record<string, unknown>, options: { locale?: string; objectLabel?: string } = {}) {
  class StubImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 100;
    height = 100;
    set src(_value: string) { setTimeout(() => this.onload?.(), 0); }
  }
  vi.stubGlobal('Image', StubImage);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback) {
    callback(new Blob(['png'], { type: 'image/png' }));
  });
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  await mount(node, { locale: options.locale, dataSource: makeDataSource(ROWS, options.objectLabel) });
  fireEvent.click(screen.getByTestId('gantt-export-png'));
  await waitFor(() => expect(downloads).toHaveLength(1));
  vi.unstubAllGlobals();
  return downloads[0];
}

/** `<base>-yyyyMMdd-HHmm.png` — the stamp is the wall clock, so it is matched, not pinned. */
const named = (base: string) => new RegExp(`^${base}-\\d{8}-\\d{4}\\.png$`);
const LOCALE_MAP = { en: 'Shift Plan', 'zh-CN': '排班计划' };

describe('`object-gantt.label` — a string, or an inline locale map whose members are locale entries (objectui#11168)', () => {
  it('a string names the exported file as written', async () => {
    expect(await exportedFileName(bag({ label: 'Plan A' }), { locale: 'en' })).toMatch(named('Plan A'));
  });

  it('the locale map gives the display locale\'s entry: `zh-CN` for a zh-CN audience, `en` for an en one', async () => {
    expect(await exportedFileName(bag({ label: LOCALE_MAP }), { locale: 'zh-CN' })).toMatch(named('排班计划'));
    cleanup();
    expect(await exportedFileName(bag({ label: LOCALE_MAP }), { locale: 'en' })).toMatch(named('Shift Plan'));
  });

  it('a `label` written on the node itself, as the spec\'s page component allows, reads the same', async () => {
    expect(await exportedFileName({ ...bag({}), label: LOCALE_MAP }, { locale: 'zh-CN' })).toMatch(named('排班计划'));
  });

  it('it is the SECOND link: `gantt.exportFileName` outranks it, and it outranks the object\'s label, then `objectName`', async () => {
    expect(await exportedFileName(bag({ label: 'Plan A', gantt: { ...GANTT, exportFileName: 'Explicit' } }))).toMatch(named('Explicit'));
    cleanup();
    expect(await exportedFileName(bag({ label: 'Plan A' }), { objectLabel: 'Task Object' })).toMatch(named('Plan A'));
    cleanup();
    expect(await exportedFileName(bag({}), { objectLabel: 'Task Object' })).toMatch(named('Task Object'));
    cleanup();
    expect(await exportedFileName(bag({}))).toMatch(named(OBJECT));
  });

  it('the chart draws it nowhere else', async () => {
    await mount(bag({ label: 'Plan A' }));
    expect(screen.queryByText('Plan A')).toBeNull();
  });
});

// ── the working calendar: skipWeekends, holidays ──────────────────────────

/** The day columns of the axis header, as their captions (`2M` is Monday the 2nd). */
const dayColumns = () =>
  Array.from(document.querySelector('[data-testid="gantt-header-units"]')?.children ?? []).map((el) => (el.textContent ?? '').trim());

/** Run auto-schedule on the dependency fixture, confirm it, and return the write it made. */
async function autoScheduledWrite(props: Record<string, unknown>) {
  const dataSource = makeDataSource(DEP_ROWS);
  await mount(bag(props, { objectName: OBJECT, gantt: DEP_GANTT }), { dataSource });
  await act(async () => { fireEvent.click(screen.getByTestId('gantt-auto-schedule')); });
  await act(async () => { fireEvent.click(document.querySelector('[data-testid="gantt-autoschedule-confirm"]') as HTMLElement); });
  await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
  return dataSource.update.mock.calls[0];
}

describe('`object-gantt.skipWeekends` — WORKING-day math, and a folded day axis (objectui#11168)', () => {
  it('auto-schedule moves a successor by working days: past the weekend with it, onto Saturday without it (the control)', async () => {
    expect(await autoScheduledWrite({})).toEqual([OBJECT, 't2', { start_date: '2026-03-07', end_date: '2026-03-08' }]);
    cleanup();
    expect(await autoScheduledWrite({ skipWeekends: true })).toEqual([OBJECT, 't2', { start_date: '2026-03-09', end_date: '2026-03-10' }]);
  });

  it('the day view folds the Saturday and Sunday columns out of its axis', async () => {
    await mount(bag({ gantt: { ...GANTT, viewMode: 'day' } }));
    const unfolded = dayColumns();
    expect(unfolded).toContain('7S');
    cleanup();
    await mount(bag({ gantt: { ...GANTT, viewMode: 'day' }, skipWeekends: true }));
    const folded = dayColumns();
    expect(folded).not.toContain('7S');
    expect(folded).not.toContain('8S');
    expect(folded).toContain('6F');
    expect(folded).toContain('9M');
  });
});

describe('`object-gantt.holidays` — the members are ISO `yyyy-mm-dd` dates (objectui#11168)', () => {
  it('a listed date is a non-working day for auto-schedule, and a non-empty list needs no `skipWeekends`', async () => {
    expect(await autoScheduledWrite({ holidays: ['2026-03-07'] })).toEqual([OBJECT, 't2', { start_date: '2026-03-08', end_date: '2026-03-09' }]);
    cleanup();
    expect(await autoScheduledWrite({ skipWeekends: true, holidays: ['2026-03-09'] })).toEqual([OBJECT, 't2', { start_date: '2026-03-10', end_date: '2026-03-11' }]);
  });

  it('the day view folds each listed date\'s column out of its axis, and an empty list folds nothing (the control)', async () => {
    await mount(bag({ gantt: { ...GANTT, viewMode: 'day' }, holidays: ['2026-03-04'] }));
    expect(dayColumns()).not.toContain('4W');
    expect(dayColumns()).toContain('3T');
    expect(dayColumns()).toContain('7S');
    cleanup();
    await mount(bag({ gantt: { ...GANTT, viewMode: 'day' }, holidays: [] }));
    expect(dayColumns()).toContain('4W');
  });
});

// ── persistence: persistLayout, viewName ──────────────────────────────────

function storedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) keys.push(window.localStorage.key(i) as string);
  return keys.sort();
}

async function saveLayout(node: Record<string, unknown>) {
  await mount(node);
  const button = screen.queryByTestId('gantt-save-layout');
  if (button) fireEvent.click(button);
  return { button: !!button, keys: storedKeys() };
}

describe('`object-gantt.persistLayout` and `viewName` — the `objectName:viewName` storage key (objectui#11168)', () => {
  it('absent, the layout and the filter chips are saved under `objectName:default`', async () => {
    expect(await saveLayout(bag({}))).toEqual({ button: true, keys: [`gantt-layout:${OBJECT}:default`, `gantt-layout:${OBJECT}:default:filters`] });
  });

  it('`persistLayout: false` takes the save-layout button away and stores nothing, `viewName` or not', async () => {
    expect(await saveLayout(bag({ persistLayout: false }))).toEqual({ button: false, keys: [] });
    cleanup();
    expect(await saveLayout(bag({ persistLayout: false, viewName: 'board' }))).toEqual({ button: false, keys: [] });
  });

  it('`viewName` is the second half of the key, and inline rows that name no object use `gantt` for the first', async () => {
    expect((await saveLayout(bag({ viewName: 'board' }))).keys).toContain(`gantt-layout:${OBJECT}:board`);
    cleanup();
    window.localStorage.clear();
    expect((await saveLayout(bag({ viewName: 'board' }, { staticData: ROWS, gantt: GANTT }))).keys).toContain('gantt-layout:gantt:board');
  });

  it('a gantt restores only the layout saved under its own name', async () => {
    window.localStorage.setItem(`gantt-layout:${OBJECT}:board`, JSON.stringify({ viewMode: 'month', columnWidth: null, taskListCollapsed: false, taskListWidth: null, collapsedIds: [] }));
    await mount(bag({ viewName: 'board' }));
    expect(screen.getByTestId('gantt-view-mode-month').getAttribute('aria-pressed')).toBe('true');
    cleanup();
    await mount(bag({}));
    expect(screen.getByTestId('gantt-view-mode-month').getAttribute('aria-pressed')).toBe('false');
  });
});

// ── markers ─────────────────────────────────────────────────────────────────

describe('`object-gantt.markers` — the members are `{ date, label?, color? }` (objectui#11168)', () => {
  it('`date` places a line, `label` is drawn against it, and `color` paints it', async () => {
    await mount(bag({ markers: [{ date: '2026-03-05', label: 'Deadline', color: 'red' }] }));
    const marker = screen.getByTestId('gantt-marker-0');
    expect(marker.getAttribute('aria-label')).toBe('Deadline');
    expect(marker.textContent).toBe('Deadline');
    expect(marker.style.backgroundColor).toBe('red');
  });

  it('an omitted `color` paints the theme\'s primary colour, and an omitted `label` draws a bare line', async () => {
    await mount(bag({ markers: [{ date: '2026-03-05' }] }));
    const marker = screen.getByTestId('gantt-marker-0');
    expect(marker.style.backgroundColor).toBe('hsl(var(--primary))');
    expect(marker.textContent).toBe('');
  });

  it('a date outside the chart\'s range draws none, and with no `markers` there is none (the control)', async () => {
    await mount(bag({ markers: [{ date: '2031-03-05', label: 'Far' }] }));
    expect(screen.queryByTestId('gantt-marker-0')).toBeNull();
    cleanup();
    await mount(bag({}));
    expect(screen.queryByTestId('gantt-marker-0')).toBeNull();
  });
});

// ── criticalPath, showBaselines ─────────────────────────────────────────────

describe('`object-gantt.criticalPath` — seeds the highlight ON, the toggle stays (objectui#11168)', () => {
  it('true seeds the toggle pressed and highlights the critical bars; absent leaves it off (the control)', async () => {
    await mount(bag({ criticalPath: true }));
    expect(screen.getByTestId('gantt-critical-path').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('gantt-task-bar-t1').getAttribute('data-critical')).toBe('true');
    fireEvent.click(screen.getByTestId('gantt-critical-path'));
    expect(screen.getByTestId('gantt-critical-path').getAttribute('aria-pressed')).toBe('false');
    cleanup();
    await mount(bag({}));
    expect(screen.getByTestId('gantt-critical-path').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('gantt-task-bar-t1').getAttribute('data-critical')).toBeNull();
  });
});

describe('`object-gantt.showBaselines` — ON unless an explicit `false` (objectui#11168)', () => {
  const BASELINE_GANTT = { ...GANTT, baselineStartField: 'base_start', baselineEndField: 'base_end' };
  it('absent draws the baseline bar, `false` draws none', async () => {
    await mount(bag({ gantt: BASELINE_GANTT }));
    expect(screen.queryByTestId('gantt-baseline-t1')).not.toBeNull();
    cleanup();
    await mount(bag({ gantt: BASELINE_GANTT, showBaselines: false }));
    expect(screen.queryByTestId('gantt-baseline-t1')).toBeNull();
  });

  it('`true` draws nothing for a block that maps no baseline fields', async () => {
    await mount(bag({ showBaselines: true }));
    expect(screen.queryByTestId('gantt-baseline-t1')).toBeNull();
  });
});

// ── readOnly, mobileReadOnly ────────────────────────────────────────────────

async function writePaths(node: Record<string, unknown>, width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  const { container } = await mount(node);
  return {
    readOnly: container.querySelector('[data-readonly="true"]') !== null,
    badge: screen.queryByTestId('gantt-readonly-badge') !== null,
    resize: screen.queryByTestId('gantt-task-resize-right-t1') !== null,
    undo: screen.queryByTestId('gantt-undo') !== null,
  };
}
const LOCKED = { readOnly: true, badge: true, resize: false, undo: false };
const EDITABLE = { readOnly: false, badge: false, resize: true, undo: true };

describe('`object-gantt.readOnly` — every write path off, the drawer locked (objectui#11168)', () => {
  it('true locks the chart; absent leaves it editable (the control)', async () => {
    expect(await writePaths(bag({ readOnly: true }), 1280)).toEqual(LOCKED);
    cleanup();
    expect(await writePaths(bag({}), 1280)).toEqual(EDITABLE);
  });

  it('a task click still opens the record, read-only', async () => {
    await clickTask(undefined, { base: { objectName: OBJECT, gantt: GANTT, readOnly: true } });
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(panel()?.getAttribute('data-writable')).toBe('false');
  });

  it('auto-schedule is not offered', async () => {
    await mount(bag({ readOnly: true }, { objectName: OBJECT, gantt: DEP_GANTT }), { dataSource: makeDataSource(DEP_ROWS) });
    expect(screen.queryByTestId('gantt-auto-schedule')).toBeNull();
  });
});

describe('`object-gantt.mobileReadOnly` — the chart read-only under 640px, ON unless an explicit `false`; the drawer is `readOnly`\'s (objectui#11168)', () => {
  it('absent, 639px is locked and 640px is editable', async () => {
    expect(await writePaths(bag({}), 639)).toEqual(LOCKED);
    cleanup();
    expect(await writePaths(bag({}), 640)).toEqual(EDITABLE);
  });

  it('`false` keeps a narrow gantt editable, and `readOnly: true` still locks it', async () => {
    expect(await writePaths(bag({ mobileReadOnly: false }), 420)).toEqual(EDITABLE);
    cleanup();
    expect(await writePaths(bag({ mobileReadOnly: false, readOnly: true }), 420)).toEqual(LOCKED);
  });

  /**
   * Open the first task's record the way a narrow chart offers it once its task
   * list has auto-collapsed: the bar's context menu, "View details". Returns
   * whether the record opened writable (`onFieldSave` handed to its panel).
   */
  async function openFromBarMenu(node: Record<string, unknown>, width: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    const { container } = await mount(node);
    fireEvent.contextMenu(screen.getByTestId('gantt-task-bar-t1'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByTestId('gantt-context-menu-view'));
    await waitFor(() => expect(panel()).not.toBeNull());
    return {
      chartLocked: container.querySelector('[data-readonly="true"]') !== null,
      record: panel()?.getAttribute('data-record'),
      writable: panel()?.getAttribute('data-writable'),
    };
  }

  it('the record drawer is locked by `readOnly` alone: on a narrow chart a task\'s record still opens WRITABLE', async () => {
    // Measured, not endorsed: whether the drawer SHOULD lock on a narrow chart
    // is not this file's question. The chart is locked and the drawer is not.
    expect(await openFromBarMenu(bag({}), 420)).toEqual({ chartLocked: true, record: 't1', writable: 'true' });
    cleanup();
    // CONTROL: `readOnly` locks the same drawer, through the same click.
    expect(await openFromBarMenu(bag({ readOnly: true }), 420)).toEqual({ chartLocked: true, record: 't1', writable: 'false' });
  });

  it('narrow is the chart\'s own measured width when there is one, the viewport\'s until then', async () => {
    const measuring = (width: number) =>
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width, height: 600, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 600, toJSON: () => ({}),
      } as DOMRect);
    measuring(420);
    expect(await writePaths(bag({}), 1280)).toEqual(LOCKED);
    cleanup();
    vi.restoreAllMocks();
    measuring(1280);
    expect(await writePaths(bag({}), 420)).toEqual(EDITABLE);
  });
});
