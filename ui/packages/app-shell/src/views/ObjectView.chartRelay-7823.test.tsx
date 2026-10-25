/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7823 — the object-view relay handed `ListView` a SIX-KEY PROJECTION
 * of the authored `chart:` block.
 *
 * ## The defect this pins
 *
 * `renderListView` builds `fullSchema` by spreading the OBJECT's `listSchema`
 * and then relaying the active view's visualization blocks under `options`.
 * Every sibling block is relayed WHOLE — `gantt: ganttViewOptions(viewDef)`,
 * `timeline: timelineViewOptions(viewDef)`, `tree`/`gallery` by spread — but
 * `chart` was a hand-listed copy of exactly six keys:
 *
 *     chart: {
 *       chartType, xAxisField, yAxisFields, aggregation, series, config
 *     }
 *
 * That list is the PRE-ADR-0021 key set, frozen. `dataset`, `dimensions` and
 * `values` — the whole ADR-0021 (#1890) authoring shape — plus the legacy
 * `categoryField` / `valueField` spelling had no rung, so they were dropped
 * here and could not reach the renderer at all on this route.
 *
 * ## Why it became load-bearing
 *
 * objectui#7544 gave `ListView.availableViews` a chart capability check that
 * asks `resolveListChartBinding` — the render branch's own resolver — whether
 * the block it was handed binds to names the author wrote. Through this
 * projection an ADR-0021 block arrived as six `undefined` keys, so the gate
 * correctly answered "nothing declared" about a view whose author declared
 * everything: no Chart toggle, no diagnostic. The legacy
 * `xAxisField` / `yAxisFields` spelling survived the projection and did
 * resolve, so the two authoring shapes behaved differently on this route for
 * reasons that lived entirely in this one object literal.
 *
 * ## The fix is a POINTER, not a wider copy
 *
 * Widening the list from six keys to nine would buy ADR-0021's correctness and
 * re-arm the identical trap for the next block key — and nothing would fire
 * then either, because `viewDef` is `Record<string, any>` and a missing rung is
 * invisible to `tsc` (that mechanism is objectui#7559's, and #7559 explicitly
 * disclaims the census this card belongs to). A hand-listed key projection is a
 * COPY of a schema's key set, and copies rot silently. So the relay forwards
 * the authored block itself.
 *
 * The whole relay is safe to write because `ListView` never SPREADS this block:
 * `resolveListChartBinding` and `case 'chart'` both read it BY NAME
 * (`dataset` / `dimensions` / `values` / `chartType`; the legacy `xAxisField` /
 * `yAxisFields` / `categoryField` / `valueField` / `aggregation` / `series`
 * were read too until objectui#6152 round 15 retired them).
 * Extra authored keys arrive and are ignored, exactly as they are for `gantt`
 * and `tree`, so no key this relay stops dropping can collide downstream.
 *
 * ## Why the REAL `ListView` renders here
 *
 * The sibling relay tests in this directory stub `ListView` and inspect the
 * captured schema, which answers "what does this file hand down". This card's
 * claim is about the CAPABILITY GATE one seam further on, so the real component
 * renders and the assertion is the Chart toggle's presence in the DOM — the
 * objectui#6318 standard, that it renders differently. The captured schema is
 * asserted too, as the more precise statement of the same fact.
 *
 * ## Direction, written before the run (reverse verification)
 *
 * The six-key literal was PREDICTED to turn the four `THE FIX` arms RED (no
 * Chart tab, and `options.chart` carrying six `undefined` keys) while leaving
 * every CONTROL's behaviour assertion GREEN — the legacy `xAxisField` arm,
 * whose keys the projection already carried, and the three negative controls,
 * which declare no usable binding and must be offered nothing in either world.
 *
 * MEASURED on the unmodified tree, before the fix was written: 5 failed, 3
 * passed. Four of the five are the `THE FIX` arms. The fifth is the SCHEMA half
 * of the first negative control (`options.chart` was the six-`undefined`-key
 * husk, not absent) — its DOM half, the toggle, was green there as predicted
 * and stayed green after. After the fix: 8 passed.
 *
 * That asymmetry is the point: the old relay emitted a permanently truthy block
 * for EVERY view, so a "fix" that merely added three keys to the husk would
 * still hand the gate an object for a view that declared nothing. The negative
 * controls are what refuse that shape.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      isLoaded: false,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

/**
 * The list schema this page hands down — captured on the way INTO the real
 * `ListView`, which then renders. Both halves of the evidence come from one
 * mount: what the relay emitted, and what the capability gate did with it.
 */
let captured: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const { createElement } = await import('react');
  return {
    ...actual,
    ListView: (props: any) => {
      captured = props.schema;
      return createElement(actual.ListView as any, props);
    },
  };
});

vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: (props: any) =>
    props.renderListView?.({
      schema: { ...(props.schema ?? {}) },
      dataSource: props.dataSource,
      onEdit: props.onEdit,
      className: '',
      refreshKey: 0,
    }) ?? null,
  ViewTabBar: () => null,
  ManageViewsDialog: () => null,
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';

/** The ADR-0021 (#1890) authoring shape — a semantic dataset selected BY NAME. */
const ADR_0021_BLOCK = {
  dataset: 'task_throughput',
  dimensions: ['status'],
  values: ['hours'],
  chartType: 'bar',
};

function objectsWith(view: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        status: { type: 'text', label: 'Status' },
        hours: { type: 'number', label: 'Hours' },
      },
      listViews: {
        by_unit: { label: 'By business unit', type: 'grid', columns: ['name'], ...view },
      },
    },
  ];
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT_NAME, fields: {} })),
  } as any;
}

/** Mount the object list for one authored view and wait for the relay to run. */
async function mountObjectList(view: Record<string, unknown>) {
  captured = null;
  const dataSource = makeDataSource();
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName"
            element={<ObjectView dataSource={dataSource} objects={objectsWith(view)} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  // `options` is built unconditionally by the same object literal as the rung
  // under test, so its arrival is the signal that the relay actually ran —
  // waiting on `options.chart` itself would hang rather than fail.
  await waitFor(() => {
    expect(captured?.options).toBeTruthy();
  });
}

/**
 * Find a visualization option by accessible name, in either switcher form —
 * two-to-four resolvable types render an inline segmented control exposing
 * `role="tab"`, five or more collapse into a dropdown of plain buttons.
 * Mirrors the helper in `plugin-list`'s `ListView.chart-capability-7544`.
 */
const queryViewOption = (name: string) =>
  screen.queryByRole('tab', { name }) ?? screen.queryByRole('button', { name });

/**
 * Is the Chart toggle offered for a view whitelisting exactly
 * `['grid', 'chart']`? The whitelist alone never suffices — ADR-0047
 * intersects it with what the capability gate finds RESOLVABLE, which is the
 * question this relay's output answers.
 */
async function chartOffered(view: Record<string, unknown>): Promise<boolean> {
  await mountObjectList({ appearance: { allowedVisualizations: ['grid', 'chart'] }, ...view });
  // objectui#12423 — the switcher is the Display panel's Layout row by default.
  const display = screen.queryByTestId('toolbar-display-trigger');
  if (display) {
    fireEvent.click(display);
    await screen.findByTestId('view-settings-content');
  }
  const trigger = screen.queryByTestId('view-switcher-dropdown');
  if (trigger) fireEvent.click(trigger);
  return Boolean(queryViewOption('Chart'));
}

beforeEach(() => {
  cleanup();
  captured = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the object-view relay forwards the authored chart block WHOLE (objectui#7823)', () => {
  it('THE FIX: an ADR-0021 view is offered the Chart toggle', async () => {
    // THE DISCRIMINATING ARM, and the card's whole report in one line. Before
    // the fix this read `false`: the six-key projection dropped `dataset` /
    // `dimensions` / `values`, the gate found nothing declared, and ADR-0047
    // filtered the author's own whitelist down to `['grid']`.
    expect(await chartOffered({ chart: ADR_0021_BLOCK })).toBe(true);
  });

  it('THE FIX: the ADR-0021 keys arrive at the renderer, not six undefined ones', async () => {
    // The precise statement of the same fact. `toEqual` against the authored
    // object pins BOTH directions: no declared key is dropped, and no key the
    // author did not write is invented on the way through.
    await mountObjectList({ chart: ADR_0021_BLOCK });
    expect(captured.options.chart).toEqual(ADR_0021_BLOCK);
  });

  it('THE FIX: the pointer carries a retired `categoryField` / `valueField` block whole; the gate offers it no toggle', async () => {
    // Absent from the six-key list exactly as the ADR-0021 keys were. One
    // projection dropped both; one pointer carries both — that half stands.
    // TURNED (objectui#6152 round 15): the toggle half read `true` while the
    // resolver had a legacy leg. Nothing reads these axes now, so the block
    // arrives whole and is offered nothing.
    expect(await chartOffered({ chart: { categoryField: 'status', valueField: 'hours' } })).toBe(false);
    await mountObjectList({ chart: { categoryField: 'status', valueField: 'hours' } });
    expect(captured.options.chart).toEqual({ categoryField: 'status', valueField: 'hours' });
  });

  it('THE FIX: keys beyond the block are relayed verbatim, not whitelisted', async () => {
    // The rot this card is about is a key set frozen at a moment in time. A
    // relay that carried today's nine keys would fail this the day the block
    // grows a tenth, which is precisely the trap being closed.
    const block = { ...ADR_0021_BLOCK, filter: [{ field: 'status', op: 'eq', value: 'open' }], config: { stacked: true } };
    await mountObjectList({ chart: block });
    expect(captured.options.chart).toEqual(block);
  });

  it('CONTROL: the retired `xAxisField` / `yAxisFields` block resolves no toggle (objectui#6152 round 15)', async () => {
    // TURNED (objectui#6152 round 15). This read `true`: the old projection
    // carried these keys and the resolver's legacy leg bound them. The leg
    // retired, so both legacy spellings now answer alike — no toggle — which
    // still pins that the two behave the same on this route.
    expect(await chartOffered({ chart: { xAxisField: 'status', yAxisFields: ['hours'] } })).toBe(false);
  });

  it('NEGATIVE CONTROL: a view declaring no chart block is offered no toggle', async () => {
    // GREEN in either world, and the reason the relay must forward `undefined`
    // rather than a permanently truthy husk: the old projection was ALWAYS a
    // truthy object, and a fix that kept that shape while adding the three keys
    // would still be handing the gate an object for a view that declared
    // nothing. `resolveListChartBinding` reads no binding out of either, so the
    // observable answer is the same — this pins that it stays the same.
    expect(await chartOffered({})).toBe(false);
    await mountObjectList({});
    expect(captured.options.chart).toBeUndefined();
  });

  it('NEGATIVE CONTROL: an EMPTY chart block is offered no toggle', async () => {
    // The half-written declaration: `allowedVisualizations: ['grid','chart']`
    // with nothing under `chart:`. It must stay half-written all the way down —
    // the gate offers only blocks that render from names the author wrote.
    expect(await chartOffered({ chart: {} })).toBe(false);
  });

  it('NEGATIVE CONTROL: a block with no binding at all is offered no toggle', async () => {
    // `chartType` alone chooses a shape, not a binding. Offering this would
    // route into the legacy branch's invented `'name'` / `'value'` floors —
    // the objectui#7547 / #7029 / #7070 family, deliberately untouched here.
    expect(await chartOffered({ chart: { chartType: 'pie' } })).toBe(false);
  });
});
