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
import { resetUndeclaredActionNamesWarnings } from '../undeclaredActionNames';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { createServerActionHandler } from '@object-ui/core';

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
  /** `'absent'`: the data source has no `getObjectSchema`; `'fails'`: it rejects. */
  schemaRead?: 'absent' | 'fails';
  /** Mount under React StrictMode, as the Console does. */
  strict?: boolean;
}) {
  const rows = opts.rows ?? ROWS;
  const dataSource: any = {
    find: vi.fn(async () => ({ data: rows.map(r => ({ ...r })), total: rows.length, hasMore: false, pageSize: 50 })),
  };
  if (opts.schemaRead === 'fails') {
    dataSource.getObjectSchema = async () => { throw new Error('schema read refused'); };
  } else if (opts.schemaRead !== 'absent') {
    dataSource.getObjectSchema = async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, done: { type: 'boolean' } },
      ...(opts.objectActions ? { actions: opts.objectActions } : {}),
    });
  }
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [{ field: 'name', label: 'Name' }],
    pagination: { pageSize: 50 },
    ...opts.schema,
  };
  const tree = (
    <ActionProvider handlers={opts.handlers ?? {}}>
      <ObjectGrid schema={schema} dataSource={dataSource} />
    </ActionProvider>
  );
  const result = render(opts.strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
  dataSource.unmount = result.unmount;
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
  resetUndeclaredActionNamesWarnings();
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

  it('draws no button for a name the object does not declare, even with a runner handler under it (objectstack#30169)', async () => {
    // Trigger objectstack#30169. The spec says a bare `bulkActions` name "names
    // an action the object declares", and lint `action-name-undefined` refuses
    // any other. A runner handler registered under the name is client code,
    // not a declaration, so it does not bring the button back.
    const handler = vi.fn(async () => ({ success: true }));
    await renderAndSelectAll({
      objectActions: [PUSH_DOWN],
      schema: { bulkActions: ['push_down', 'crm_only_handler'] },
      handlers: { crm_only_handler: handler },
    });

    expect(await screen.findByTestId('bulk-action-push_down')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-crm_only_handler')).not.toBeInTheDocument();
    expect(handler).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#30169 — the selection bar and a disabled package. With the
 * package disabled the server withholds its actions: they leave the served
 * object's `actions`, exactly as if never declared. The view still names one
 * in `bulkActions` as a bare string (the spec accepts it). Before the fix the
 * bar drew it anyway, under its humanized name ("Create Campaign"), and the
 * click toasted "not executable". Now the bar draws only what the object
 * declares: withheld, no button and one development warning naming it;
 * served, the button under the action's own label.
 */
describe('a bulk action a disabled package withholds (objectstack#30169)', () => {
  /** The package's action. Its label is NOT the humanized name, on purpose. */
  const CREATE_CAMPAIGN = {
    name: 'create_campaign',
    label: 'Add to Campaign',
    type: 'api',
    target: '/api/v1/campaigns/add',
  };
  const VIEW = { bulkActions: ['push_down', 'create_campaign'] };

  const bulkActionWarnings = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes('ObjectGrid bulkActions'));

  it('withheld: the served object lacks it, so the bar draws no button and warns once naming it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await renderAndSelectAll({ objectActions: [PUSH_DOWN], schema: VIEW });

      // The declared sibling is drawn, so the bar is up and populated.
      expect(await screen.findByTestId('bulk-action-push_down')).toBeInTheDocument();
      expect(screen.queryByTestId('bulk-action-create_campaign')).not.toBeInTheDocument();
      expect(screen.queryByText('Create Campaign')).not.toBeInTheDocument();
      await waitFor(() => expect(bulkActionWarnings(warn)).toHaveLength(1));
      expect(bulkActionWarnings(warn)[0]).toContain("'create_campaign'");
      expect(bulkActionWarnings(warn)[0]).not.toContain("'push_down'");
    } finally {
      warn.mockRestore();
    }
  });

  it('served: the same view draws it under the action label, and stays quiet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await renderAndSelectAll({ objectActions: [PUSH_DOWN, CREATE_CAMPAIGN], schema: VIEW });

      expect(await screen.findByTestId('bulk-action-create_campaign')).toHaveTextContent('Add to Campaign');
      expect(bulkActionWarnings(warn)).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('an object named only through `data.object` waits for that object, and the warning names it', async () => {
    // The grid's object is `resolveRecordSourceObjectName(schema, data)`, not
    // `schema.objectName`. Keyed on the top-level key, readiness was true on
    // the first render, before the schema landed, so the DECLARED `push_down`
    // was reported too, under "no objectName".
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await renderAndSelectAll({
        objectActions: [PUSH_DOWN],
        schema: { ...VIEW, objectName: undefined, data: { provider: 'object', object: OBJECT } },
      });

      expect(await screen.findByTestId('bulk-action-push_down')).toBeInTheDocument();
      await waitFor(() => expect(bulkActionWarnings(warn)).toHaveLength(1));
      expect(bulkActionWarnings(warn)[0]).toContain(`objectName: '${OBJECT}'`);
      expect(bulkActionWarnings(warn)[0]).toContain("'create_campaign'");
      expect(bulkActionWarnings(warn)[0]).not.toContain("'push_down'");
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ['has no getObjectSchema', 'absent'],
    ['rejects the schema read', 'fails'],
  ] as const)('inline rows whose data source %s still report the names, as unread', async (_label, schemaRead) => {
    // Nothing will ever land, so nothing is awaited: the names are reported,
    // and the message says the object's actions are unknown rather than that
    // the names are undeclared. Before, readiness never flipped and the drop
    // was silent.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // (No wait on the rows: with a failed read their columns stay masked,
      // objectui#10657, so 'Plan A' is never drawn in the `fails` leg.)
      renderGrid({ schemaRead, schema: { ...VIEW, data: { provider: 'value', items: ROWS } } });

      await waitFor(() => expect(bulkActionWarnings(warn)).toHaveLength(1));
      expect(bulkActionWarnings(warn)[0]).toContain('could not be read');
      expect(bulkActionWarnings(warn)[0]).toContain("'push_down', 'create_campaign'");
      expect(screen.queryByTestId('bulk-action-create_campaign')).not.toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
  });

  it('warns once under StrictMode and across a remount of the same list', async () => {
    // StrictMode runs every mount effect setup → cleanup → setup; this shape is
    // ready on its first render, so an effect-only guard said it twice.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const opts = { schemaRead: 'absent', strict: true, schema: { ...VIEW, data: { provider: 'value', items: ROWS } } } as const;
      const ds = renderGrid(opts);
      await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
      await waitFor(() => expect(bulkActionWarnings(warn).length).toBeGreaterThan(0));
      ds.unmount();
      renderGrid(opts);
      await waitFor(() => expect(screen.getByText('Plan A')).toBeInTheDocument());
      expect(bulkActionWarnings(warn)).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
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

  it('reports a failed aggregate call once for the selection, with no per-row list and no Retry', async () => {
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
    await waitFor(() => expect(screen.getByTestId('bulk-aggregate-rejection')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The one real error (the builtin api executor formats a non-2xx response
    // as `HTTP <status>`), once — not attributed to each record
    // (objectstack#34173): the one call cannot say which records it wrote.
    expect(screen.getByTestId('bulk-aggregate-rejection-message')).toHaveTextContent('HTTP 500');
    expect(screen.queryByTestId('bulk-error-row-r1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-error-row-r2')).not.toBeInTheDocument();
    // There is no per-row slice to re-attempt: the whole-run re-run is the
    // retry (a failed run keeps the selection for exactly that).
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

/**
 * An aggregate action that REJECTS (objectstack#34173). The handler is one
 * call for the whole selection; a non-transactional body can move some rows
 * and then reject once, and nothing in the rejection says which rows moved.
 * So the result is ONE outcome for the selection — the rejection's
 * producer-marked `userMessage`, once, with no per-row count and no per-row
 * list — and the grid re-reads its rows when the dialog closes, whether the
 * call resolved or rejected. Driven through the console's real `script`
 * dispatch (`createServerActionHandler`) and the `/actions` door's refusal
 * envelope, which carries `userMessage` beside `message` on `error` for a
 * script body and a server action's handler alike.
 */
describe('an aggregate rejection is one outcome for the selection (objectstack#34173)', () => {
  const MOVE = { name: 'mass_update_stage', label: 'Update Stage', type: 'script' };
  const AGGREGATE = { bulkActionDefs: [{ name: 'mass_update_stage', operation: 'custom', execution: 'aggregate' }] };
  const USER_TEXT = 'Plan B is Closed Won and was not moved.';
  const PLATFORM_TEXT = 'mass_update_stage: plan_b stage is closed_won';
  const refusal = (error: Record<string, unknown>) => ({
    ok: false,
    status: 400,
    json: async () => ({ success: false, error: { code: 'HOOK_ABORTED', httpStatus: 400, message: PLATFORM_TEXT, ...error } }),
  });
  const accepted = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { moved: 2 } }) });

  async function runAndClose(actionsFetch: ReturnType<typeof vi.fn>, schema: Record<string, unknown> = AGGREGATE) {
    const script = createServerActionHandler({ fetch: actionsFetch as any, baseUrl: '' });
    const ds = await renderAndSelectAll({ objectActions: [MOVE], schema, handlers: { script } });
    fireEvent.click(await screen.findByTestId('bulk-action-mass_update_stage'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    await screen.findByRole('button', { name: 'Done' });
    return ds;
  }

  /** Close the result and count the grid's re-reads: the refresh is exactly one. */
  async function refreshesOnClose(ds: any): Promise<number> {
    const before = ds.find.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(before));
    await new Promise(r => setTimeout(r, 50));
    return ds.find.mock.calls.length - before;
  }

  it('shows the rejection’s userMessage once, with no per-row list and no "0 / N" count', async () => {
    const actionsFetch = vi.fn(async () => refusal({ userMessage: USER_TEXT }));
    await runAndClose(actionsFetch);

    expect(actionsFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('bulk-aggregate-rejection')).toHaveTextContent(
      'The action did not complete for the selected records.',
    );
    // The client cannot know whether the handler kept any write (a
    // transactional body keeps none), so the sentence is modal — it never
    // asserts that changed records keep their changes.
    expect(screen.getByTestId('bulk-aggregate-rejection')).toHaveTextContent(
      'Some records may already have been changed; the list shows their current values when you close this.',
    );
    expect(screen.queryByText(/keep their changes/)).not.toBeInTheDocument();
    expect(screen.getAllByText(USER_TEXT)).toHaveLength(1);
    expect(screen.queryByText(PLATFORM_TEXT, { exact: false })).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="bulk-error-row-"]')).toHaveLength(0);
    expect(screen.queryByText(/Succeeded/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 \/ 2/)).not.toBeInTheDocument();
  });

  it('falls back to the rejection’s message when it carries no userMessage', async () => {
    await runAndClose(vi.fn(async () => refusal({})));

    expect(screen.getByTestId('bulk-aggregate-rejection-message')).toHaveTextContent(PLATFORM_TEXT);
    expect(screen.getAllByText(PLATFORM_TEXT)).toHaveLength(1);
  });

  it('re-reads the grid once when the dialog closes after a rejection', async () => {
    const ds = await runAndClose(vi.fn(async () => refusal({ userMessage: USER_TEXT })));
    expect(await refreshesOnClose(ds)).toBe(1);
  });

  it('re-reads the grid once when the dialog closes after the call resolved', async () => {
    const ds = await runAndClose(vi.fn(async () => accepted()));
    expect(screen.getByText(/Succeeded 2 \/ 2/)).toBeInTheDocument();
    expect(await refreshesOnClose(ds)).toBe(1);
  });

  // CONTROL: the per-record dispatch keeps its per-row display — a failing
  // row is listed under its record, with the run's count. The row reads the
  // refusal's userMessage (objectstack#34215, pinned in its own block below).
  it('CONTROL: a per-record dispatch with one failing row still lists that row', async () => {
    const actionsFetch = vi.fn(async (_url: string, init: { body: string }) =>
      JSON.parse(init.body).recordId === 'r2' ? refusal({ userMessage: USER_TEXT }) : accepted());
    await runAndClose(actionsFetch, { bulkActions: ['mass_update_stage'] });

    expect(actionsFetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('bulk-aggregate-rejection')).not.toBeInTheDocument();
    expect(screen.getByText(/Succeeded 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByTestId('bulk-error-row-r2')).toHaveTextContent(USER_TEXT);
    expect(screen.queryByTestId('bulk-error-row-r1')).not.toBeInTheDocument();
  });
});

/**
 * A per-record dispatch's failed row speaks the handler's words
 * (objectstack#34215): the row lists the refusal's producer-marked
 * `userMessage`, while the error CSV keeps the failure's whole text — the
 * record of what the platform answered. A refusal with no `userMessage`
 * keeps the platform text on the row.
 */
describe('a per-record failed row shows the refusal\'s userMessage (objectstack#34215)', () => {
  const MOVE = { name: 'mass_update_stage', label: 'Update Stage', type: 'script' };
  const USER_TEXT = 'Plan B is Closed Won and was not moved.';
  const PLATFORM_TEXT = 'mass_update_stage: plan_b stage is closed_won';
  const refusal = (error: Record<string, unknown>) => ({
    ok: false,
    status: 400,
    json: async () => ({ success: false, error: { code: 'HOOK_ABORTED', httpStatus: 400, message: PLATFORM_TEXT, ...error } }),
  });
  const accepted = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { moved: 1 } }) });

  /** Run the per-record action over both rows; only r2 is refused, with `error`. */
  async function runWithRefusedR2(error: Record<string, unknown>) {
    const actionsFetch = vi.fn(async (_url: string, init: { body: string }) =>
      JSON.parse(init.body).recordId === 'r2' ? refusal(error) : accepted());
    const script = createServerActionHandler({ fetch: actionsFetch as any, baseUrl: '' });
    await renderAndSelectAll({ objectActions: [MOVE], schema: { bulkActions: ['mass_update_stage'] }, handlers: { script } });
    fireEvent.click(await screen.findByTestId('bulk-action-mass_update_stage'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    await screen.findByRole('button', { name: 'Done' });
    expect(actionsFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Succeeded 1 \/ 2/)).toBeInTheDocument();
  }

  /** Click "Download error CSV" and read the text of the file it builds. */
  async function downloadedCsv(): Promise<string> {
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { blob = b as Blob; return 'blob:errors'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Download error CSV' }));
    expect(blob).toBeDefined();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob!);
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the userMessage on the row, and the error CSV keeps the whole text', async () => {
    await runWithRefusedR2({ userMessage: USER_TEXT });

    const row = screen.getByTestId('bulk-error-row-r2');
    expect(row).toHaveTextContent(USER_TEXT);
    expect(row).not.toHaveTextContent(PLATFORM_TEXT);
    expect(screen.queryByTestId('bulk-error-row-r1')).not.toBeInTheDocument();

    const lines = (await downloadedCsv()).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith('r2,"')).toBe(true);
    expect(lines[1]).toContain(PLATFORM_TEXT);
    expect(lines[1]).not.toContain(USER_TEXT);
  });

  it('CONTROL: a refusal without a userMessage keeps the platform text on the row', async () => {
    await runWithRefusedR2({});

    expect(screen.getByTestId('bulk-error-row-r2')).toHaveTextContent(PLATFORM_TEXT);
    expect(screen.queryByText(USER_TEXT, { exact: false })).not.toBeInTheDocument();
  });
});

/**
 * An aggregate action that RESOLVES with a per-row answer: the handler's own
 * return value, read as a `BulkActionResult` (`{ succeeded, failed }`,
 * `@objectstack/spec/ui`) against the dispatched selection. Driven through
 * the console's real `script` dispatch and the `/actions` door's success
 * envelope, so the pins see the value the grid's dispatcher hands the
 * executor, not a value injected below it.
 */
describe('an aggregate run reports its BulkActionResult per row', () => {
  const MOVE = { name: 'mass_update_stage', label: 'Update Stage', type: 'script' };
  const AGGREGATE = { bulkActionDefs: [{ name: 'mass_update_stage', operation: 'custom', execution: 'aggregate' }] };
  const resolving = (data?: unknown) => vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => (data === undefined ? { success: true } : { success: true, data }),
  }));

  async function runAndClose(actionsFetch: ReturnType<typeof vi.fn>) {
    const script = createServerActionHandler({ fetch: actionsFetch as any, baseUrl: '' });
    const ds = await renderAndSelectAll({ objectActions: [MOVE], schema: AGGREGATE, handlers: { script } });
    fireEvent.click(await screen.findByTestId('bulk-action-mass_update_stage'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    await screen.findByRole('button', { name: 'Done' });
    expect(actionsFetch).toHaveBeenCalledTimes(1);
    return ds;
  }

  async function refreshesOnClose(ds: any): Promise<number> {
    const before = ds.find.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(before));
    await new Promise(r => setTimeout(r, 50));
    return ds.find.mock.calls.length - before;
  }

  it('lists the moved count and each failed row with the handler\'s message, with no Retry', async () => {
    await runAndClose(resolving({
      succeeded: ['r1'],
      failed: [{ id: 'r2', message: 'Plan B is Closed Won and was not moved.' }],
    }));

    expect(screen.getByText(/Succeeded 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/Failed 1/)).toBeInTheDocument();
    expect(screen.getByTestId('bulk-error-row-r2')).toHaveTextContent('Plan B is Closed Won and was not moved.');
    expect(screen.queryByTestId('bulk-error-row-r1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-error-retry-r2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-aggregate-rejection')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-unconfirmed-records')).not.toBeInTheDocument();
  });

  it('reports a selected row the result names in neither list as not confirmed, never as succeeded', async () => {
    await runAndClose(resolving({ succeeded: ['r1'], failed: [] }));

    expect(screen.getByText(/Succeeded 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/Not confirmed 1/)).toBeInTheDocument();
    expect(screen.getByTestId('bulk-unconfirmed-records')).toHaveTextContent('Plan B');
    expect(screen.getByTestId('bulk-succeeded-records')).toHaveTextContent('Plan A');
    expect(screen.getByTestId('bulk-succeeded-records')).not.toHaveTextContent('Plan B');
  });

  it('re-reads the grid once when the dialog closes after a run that left every row unconfirmed', async () => {
    const ds = await runAndClose(resolving({ succeeded: [], failed: [] }));
    expect(screen.getByText(/Succeeded 0 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/Not confirmed 2/)).toBeInTheDocument();
    expect(await refreshesOnClose(ds)).toBe(1);
  });

  it('reports a succeeded/failed value that does not parse as unreadable, never as full success', async () => {
    const ds = await runAndClose(resolving({ succeeded: 2, failed: 0 }));

    expect(screen.getByTestId('bulk-aggregate-unreadable')).toHaveTextContent(
      'The action finished, but its result could not be read',
    );
    expect(screen.queryByText(/Succeeded/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="bulk-error-row-"]')).toHaveLength(0);
    expect(await refreshesOnClose(ds)).toBe(1);
  });

  it('CONTROL: a handler that returns nothing keeps today\'s report', async () => {
    await runAndClose(resolving());

    expect(screen.getByText(/Succeeded 2 \/ 2/)).toBeInTheDocument();
    expect(screen.queryByText(/Failed/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-unconfirmed-records')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-aggregate-unreadable')).not.toBeInTheDocument();
  });
});
