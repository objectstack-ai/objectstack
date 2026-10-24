/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A view's `bulkActions` name must reach the ActionRunner as a real action
 * DEF, applied to every selected record (objectui#3002).
 *
 * Before this, `bulkActions: ['push_down']` dispatched the action NAME in the
 * runner's `type` slot — `{ type: 'push_down', params: { records } }` — which
 * matches no built-in type and no handler, so it fell through the runner's
 * schema fallback (green success toast pre-#2996, a loud failure after it).
 * Either way the action never ran, and the button carried none of the def's
 * label / icon / params: `bulkActionDefs` was passed through from view JSON
 * verbatim, never resolved against `objectDef.actions`.
 *
 * Naming the action in the view is the ONLY way to declare a bulk action —
 * spec 17 retired `action.bulkEnabled` as a tombstone (framework#4054) and
 * prescribes exactly this. See `resolveBulkActions`.
 *
 * These drive the REAL ObjectGrid through a real ActionProvider and assert the
 * user-visible outcome: selecting rows and clicking the button issues one
 * request per selected record.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ isLoaded: false, checkField: () => true, getObjectApiOperations: () => undefined, can: () => true }),
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'os_prod_plan';
const ROWS = [
  { id: 'r1', name: 'Plan A' },
  { id: 'r2', name: 'Plan B' },
];

/**
 * The object's declared action. The label is deliberately NOT the humanization
 * of the name ("Push Down"), so an assertion on it distinguishes the resolved
 * def from the by-name path — which could only ever render
 * `formatActionLabel`.
 */
const PUSH_DOWN = {
  name: 'push_down',
  label: '下推',
  type: 'api',
  target: '/api/v1/plans/push',
  recordIdParam: 'planId',
};

let fetchMock: ReturnType<typeof vi.fn>;

function renderGrid(opts: {
  objectActions?: unknown[];
  schema?: Record<string, unknown>;
  handlers?: Record<string, any>;
  /** Override the seed records — e.g. to give a `visible` predicate something to bite on. */
  rows?: Array<Record<string, unknown>>;
}) {
  const rows = opts.rows ?? ROWS;
  const dataSource: any = {
    find: vi.fn(async () => ({ data: rows.map(r => ({ ...r })), total: rows.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, done: { type: 'boolean' } },
      ...(opts.objectActions ? { actions: opts.objectActions } : {}),
    }),
  };
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [{ field: 'name', label: 'Name' }],
    pagination: { pageSize: 50 },
    ...opts.schema,
  };
  render(
    <ActionProvider handlers={opts.handlers ?? {}}>
      <ObjectGrid schema={schema} dataSource={dataSource} />
    </ActionProvider>,
  );
  return dataSource;
}

/** Render, wait for rows + the async schema fetch, then select every row. */
async function renderAndSelectAll(opts: Parameters<typeof renderGrid>[0]) {
  const ds = renderGrid(opts);
  await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
  // The derivation depends on `getObjectSchema`, so an assertion taken before
  // it lands would read the pre-fetch (underived) state.
  await waitFor(() => expect(document.querySelector('thead [role="checkbox"]')).toBeTruthy());
  fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
  return ds;
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('view-declared bulk actions (objectui#3002)', () => {
  it('renders the declared action label, not the humanized name', async () => {
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: { bulkActions: ['push_down'] },
    });

    const button = await screen.findByTestId('bulk-action-push_down');
    // The object action's own label, not `formatActionLabel('push_down')`.
    expect(button).toHaveTextContent('下推');
  });

  it('surfaces nothing for an object action the view never names', async () => {
    // `action.bulkEnabled` is a spec-17 tombstone, so there is no object-level
    // opt-in: an unnamed action must not reach the selection bar.
    renderGrid({ objectActions: [{ ...PUSH_DOWN, bulkEnabled: true }] });
    await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());

    expect(screen.queryByTestId('bulk-action-push_down')).not.toBeInTheDocument();
  });

  it('issues one request per selected record instead of no-opping', async () => {
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: { bulkActions: ['push_down'] },
    });

    fireEvent.click(await screen.findByTestId('bulk-action-push_down'));
    // No params on this action → the dialog opens straight on confirm.
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/plans/push');
    // Each dispatch carries ITS OWN record under `_rowRecord` — the same
    // row-context key the list_item path attaches, which is what lets the
    // host's api handler perform `recordIdParam` injection unchanged.
    const sentIds = fetchMock.mock.calls
      .map(c => JSON.parse((c[1] as any).body)._rowRecord.id)
      .sort();
    expect(sentIds).toEqual(['r1', 'r2']);
  });

  it('reports per-record failures instead of counting them as successes', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'precondition not met' }),
    });
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: { bulkActions: ['push_down'] },
    });

    fireEvent.click(await screen.findByTestId('bulk-action-push_down'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // The result panel attributes a failure to each record — a runAction that
    // resolved regardless would report "Succeeded 2 / 2", the #2960 lie in bulk
    // form (and exactly what `operation: 'custom'` did before it could run).
    await waitFor(() => expect(screen.getByText(/Succeeded 0 \/ 2/)).toBeInTheDocument());
    expect(screen.getByTestId('bulk-error-row-r1')).toHaveTextContent('HTTP 422');
    expect(screen.getByTestId('bulk-error-row-r2')).toBeInTheDocument();
    // A promoted def re-dispatches for one record, so the row keeps its Retry.
    expect(screen.getByTestId('bulk-error-retry-r1')).toBeInTheDocument();
  });

  it('renders one button for a repeated name', async () => {
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: { bulkActions: ['push_down', 'push_down'] },
    });

    await waitFor(() => expect(screen.getAllByTestId('bulk-action-push_down')).toHaveLength(1));
  });

  it('keeps an unresolvable name alongside the promoted defs', async () => {
    // A name the object never declared may still have a runner handler
    // registered under it; hiding it because some OTHER def exists dropped
    // half the bar's buttons.
    const handler = vi.fn(async () => ({ success: true }));
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: { bulkActions: ['push_down', 'crm_only_handler'] },
      handlers: { crm_only_handler: handler },
    });

    expect(await screen.findByTestId('bulk-action-push_down')).toBeInTheDocument();
    const legacy = await screen.findByTestId('bulk-action-crm_only_handler');
    fireEvent.click(legacy);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  });
});

/**
 * `execution: 'aggregate'` (objectui#3139): the whole selection in ONE
 * dispatch, pinned side by side with the per-record semantics above. The
 * authored def names the object action; the dispatch carries every selected
 * id under `params._selectedIds` so the server can produce a single
 * aggregate artifact (zip of QR codes, merged PDF…).
 */
describe('aggregate bulk actions (objectui#3139)', () => {
  const AGGREGATE_VIEW = {
    bulkActionDefs: [{ name: 'push_down', operation: 'custom', execution: 'aggregate' }],
  };

  it('issues exactly ONE request carrying every selected id under _selectedIds', async () => {
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: AGGREGATE_VIEW,
    });

    const button = await screen.findByTestId('bulk-action-push_down');
    // The authored def resolved the object action, so it carries its label.
    expect(button).toHaveTextContent('下推');
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/plans/push');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body._selectedIds).toEqual(['r1', 'r2']);
    // The per-record row-context key must NOT ride along — this is the
    // aggregate shape, not a per-record dispatch that happens to be first.
    expect(body._rowRecord).toBeUndefined();
    await waitFor(() => expect(screen.getByText(/Succeeded 2 \/ 2/)).toBeInTheDocument());
  });

  it('attributes a failed aggregate call to every record, with no per-row Retry', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'zip generation failed' }),
    });
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: AGGREGATE_VIEW,
    });

    fireEvent.click(await screen.findByTestId('bulk-action-push_down'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    // ONE call — a failed aggregate run must not fan out per-record dispatches
    // against an endpoint written for a single `_selectedIds` call.
    await waitFor(() => expect(screen.getByText(/Succeeded 0 \/ 2/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Each record shows the one real error (the builtin api executor
    // formats a non-2xx response as `HTTP <status>`, same as the
    // per-record pin above)…
    expect(screen.getByTestId('bulk-error-row-r1')).toHaveTextContent('HTTP 500');
    expect(screen.getByTestId('bulk-error-row-r2')).toHaveTextContent('HTTP 500');
    // …but there is no per-row slice to re-attempt: the whole-run re-run is
    // the retry (a total failure keeps the selection for exactly that).
    expect(screen.queryByTestId('bulk-error-retry-r1')).not.toBeInTheDocument();
  });

  it('a per-record def with the same shape still fans out — mode lives on the def', async () => {
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: { bulkActions: ['push_down'] },
    });

    fireEvent.click(await screen.findByTestId('bulk-action-push_down'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const bodies = fetchMock.mock.calls.map(c => JSON.parse((c[1] as any).body));
    expect(bodies.every(b => b._selectedIds === undefined)).toBe(true);
  });
});

/**
 * `visible` is evaluated per selected record, with that record in scope
 * (objectui#3067). Before this the bar evaluated it with NO record bound, and
 * the lenient path returned `true` for every row-scoped predicate — so an
 * authored gate was not weakened but inverted for half its inputs.
 */
describe('per-record `visible` on a bulk action (objectui#3067)', () => {
  /** Row-scoped gate: only r1 is un-done, so only r1 may be acted on. */
  const GATED = { ...PUSH_DOWN, visible: '!record.done' };

  it('runs on the eligible records only, and says how many it skipped', async () => {
    await renderAndSelectAll({
      objectActions: [GATED],
      schema: { bulkActions: ['push_down'] },
      rows: [
        { id: 'r1', name: 'Plan A', done: false },
        { id: 'r2', name: 'Plan B', done: true },
      ],
    });

    fireEvent.click(await screen.findByTestId('bulk-action-push_down'));
    // The confirm step owns up to the shrunken selection.
    expect(await screen.findByTestId('bulk-skipped-notice')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    // One request, for the one eligible record — not two.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as any).body)._rowRecord.id).toBe('r1');
  });

  it('hides the button when no selected record qualifies', async () => {
    await renderAndSelectAll({
      objectActions: [GATED],
      schema: { bulkActions: ['push_down'] },
      rows: [
        { id: 'r1', name: 'Plan A', done: true },
        { id: 'r2', name: 'Plan B', done: true },
      ],
    });

    // The bar is up (rows are selected) but this action has nothing to act on.
    expect(await screen.findByTestId('bulk-actions-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-push_down')).not.toBeInTheDocument();
  });

  it('leaves an ungated action acting on the whole selection', async () => {
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: { bulkActions: ['push_down'] },
      rows: [
        { id: 'r1', name: 'Plan A', done: true },
        { id: 'r2', name: 'Plan B', done: true },
      ],
    });

    fireEvent.click(await screen.findByTestId('bulk-action-push_down'));
    expect(screen.queryByTestId('bulk-skipped-notice')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
