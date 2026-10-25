// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11581: the Create View dialog has two persisting doors, and both
 * build the view they persist through ONE builder (`buildNewViewSpec`).
 *
 * ## The defect this pins
 *
 * "Save as view" (`ObjectDataPage.buildSaveAsViewSpec`) and the add-view door
 * (`ObjectView.handleViewCreate`, now `buildAddViewSpec`) assembled the spec
 * separately from the same dialog payload. Only the add-view door mirrored the
 * resolved columns into the type blocks that carry their own field list
 * (`kanban.columns`, `gallery.visibleFields`). `@objectstack/spec`'s
 * `KanbanConfigSchema.columns` is required, so a kanban saved through "Save as
 * view" was refused by the view write door (`invalid_type` at
 * `kanban.columns`), and a gallery saved there drew no card body while the
 * same payload through the tab bar drew one. Two doors, two bodies.
 *
 * ## The enumeration pin (the card's acceptance)
 *
 * For every view type the dialog offers (`offeredViewTypes()`, the rows its
 * picker renders), the dialog itself is rendered and submitted, and the payload
 * it hands `onCreate` is run through BOTH doors' spec builders and wrapped by
 * `viewEnvelope`, as each door does before `createRuntimeMetadata`. Each body
 * must parse against the installed `ListViewSchema` (the envelope's `config`)
 * and `ViewItemSchema` (the envelope), and the two doors, given the same
 * columns, must persist the same body. A type the dialog offers with no row in
 * `PARSE_ROWS` turns the pin red.
 *
 * The last describe drives the "Save as view" door through its page, with the
 * installed spec's view gate replayed at the network boundary. The add-view
 * door's page is pinned next door, in `ObjectView.createKanbanView-11581.test.tsx`.
 *
 * Direction, written before the first run (on the tree before the builder,
 * with the add-view door's body moved unchanged into `buildAddViewSpec`): the
 * kanban row and the "Save as view" page case go RED (refused at
 * `kanban.columns`, a 422 at the door); the gallery row goes RED on the doors'
 * disagreement (only one mirrors `visibleFields`); every other type row and the
 * enumeration rows stay GREEN in both worlds. The builder's own pins (the
 * mirrors, read straight off `buildNewViewSpec`) arrived with the builder.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ListViewSchema, ViewItemSchema } from '@objectstack/spec/ui';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { MetadataClient } from '@object-ui/data-objectstack';

/** A served dataset over THIS view's object, for the chart row. */
const DEAL_METRICS = {
  name: 'deal_metrics',
  label: 'Deal metrics',
  object: 'crm_deal',
  dimensions: [{ name: 'stage', label: 'Stage', field: 'stage' }],
  measures: [
    { name: 'total_amount', label: 'Total amount', aggregate: 'sum', field: 'amount' },
    { name: 'deal_count', label: 'Deals', aggregate: 'count' },
  ],
};

const puts: Array<{ url: string; body: any; status: number }> = [];

/**
 * The metadata wire, replayed: `GET …/meta/dataset` lists the served dataset,
 * `GET …/meta/dataset/NAME` answers it, and `PUT …/meta/view/NAME` runs the
 * installed spec's view gate, answering the dispatcher's 422 `INVALID_METADATA`
 * envelope on refusal, as the platform's write door does.
 */
function wire() {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (init?.method === 'PUT' && path.includes('/meta/view/')) {
      const body = JSON.parse(String(init.body));
      const verdict = getMetadataTypeSchema('view')!.safeParse(body);
      puts.push({ url: input, body, status: verdict.success ? 200 : 422 });
      return verdict.success
        ? json({ success: true })
        : json(
            {
              success: false,
              error: { code: 'INVALID_METADATA', message: 'view failed validation', details: { code: 'INVALID_METADATA', issues: verdict.error.issues } },
            },
            422,
          );
    }
    if (path.endsWith('/meta/dataset')) return json([DEAL_METRICS]);
    const one = path.match(/\/meta\/dataset\/([^/]+)$/);
    if (one) {
      const hit = decodeURIComponent(one[1]) === DEAL_METRICS.name;
      return json(hit ? DEAL_METRICS : null, hit ? 200 : 404);
    }
    return json({ data: [] });
  });
}
/** One client per test, as `useMetadataClient` memoises one per mount. */
let client: MetadataClient;

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }), checkField: () => true, getFieldPermissions: () => [],
      getRowFilter: () => undefined, getObjectApiOperations: () => undefined, roles: [], isLoaded: false,
      hasCapabilities: () => true, can: () => true, cannot: () => false,
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { CreateViewDialog, offeredViewTypes } from './CreateViewDialog';
import { ObjectDataPage, buildSaveAsViewSpec } from './ObjectDataPage';
import { buildAddViewSpec, defaultListColumnsFromObject } from './ObjectView';
import { viewEnvelope } from './runtime-metadata-persistence';
import { buildNewViewSpec } from './newViewSpec';
import { ExpressionProvider } from '../providers/ExpressionProvider';

/** An object with an eligible field for every pick the dialog offers. */
const DEAL = {
  name: 'crm_deal',
  label: 'Deal',
  managedBy: 'platform',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }] },
    amount: { type: 'number', label: 'Amount' },
    start_date: { type: 'date', label: 'Start' },
    end_date: { type: 'date', label: 'End' },
    photo: { type: 'image', label: 'Photo' },
    latitude: { type: 'number', label: 'Latitude' },
    longitude: { type: 'number', label: 'Longitude' },
    parent: { type: 'lookup', label: 'Parent deal', reference: 'crm_deal' },
  },
};

/**
 * The columns both doors resolve to here. The add-view door derives its own
 * from the object (`defaultListColumnsFromObject`); "Save as view" is handed
 * the page's, and is handed that same list so the two bodies are comparable.
 */
const COLUMNS = defaultListColumnsFromObject(DEAL, 5);

interface ParseRow {
  /** The picks to make, in order: the picker's key and the label of the option to choose. */
  picks: Array<[key: string, label: string]>;
  /** The block the dialog writes under the type's key (`undefined`: none). */
  block?: Record<string, unknown>;
}

/**
 * One row per view type the dialog offers. A type `offeredViewTypes()` lists
 * with no row here turns the enumeration red; so does a row for a type the
 * dialog no longer offers.
 */
const PARSE_ROWS: Record<string, ParseRow> = {
  grid: { picks: [] },
  kanban: { picks: [['groupByField', 'Stage']], block: { groupByField: 'stage' } },
  calendar: {
    picks: [['startDateField', 'Start'], ['titleField', 'Name']],
    block: { startDateField: 'start_date', titleField: 'name' },
  },
  gallery: { picks: [['coverField', 'Photo']], block: { coverField: 'photo' } },
  timeline: {
    picks: [['startDateField', 'Start'], ['titleField', 'Name']],
    block: { startDateField: 'start_date', titleField: 'name' },
  },
  gantt: {
    picks: [['startDateField', 'Start'], ['endDateField', 'End'], ['titleField', 'Name']],
    block: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' },
  },
  map: {
    picks: [['latitudeField', 'Latitude'], ['longitudeField', 'Longitude']],
    block: { latitudeField: 'latitude', longitudeField: 'longitude' },
  },
  chart: {
    picks: [
      ['chartType', 'console.objectView.chartTypeBar'],
      ['dataset', 'Deal metrics (deal_metrics)'],
      ['values', 'Total amount'],
      ['dimensions', 'Stage'],
    ],
    block: { chartType: 'bar', dataset: 'deal_metrics', values: ['total_amount'], dimensions: ['stage'] },
  },
  tree: { picks: [['parentField', 'Parent deal']], block: { parentField: 'parent' } },
};

/**
 * The type card for `type`. Read by tag, not by test id alone: the `grid` card's
 * id, `create-view-type-grid`, is also the id of the grid that holds the cards.
 */
const typeCards = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-testid^="create-view-type-"]'));
const typeCard = (type: string) =>
  typeCards().find((b) => b.getAttribute('data-testid') === `create-view-type-${type}`);
/** The config pick for `key`: the shared Select's trigger, which shows the option it holds (objectui#11865). */
const picker = (key: string) => screen.getByTestId(`create-view-required-${key}`);
const submitButton = () => screen.getByTestId('create-view-submit') as HTMLButtonElement;

/** Pick `type` in the open dialog, make the row's picks, name it, and press Create. */
async function pickAndCreate(type: string, picks: ParseRow['picks']) {
  await waitFor(() => expect(typeCard(type)?.disabled).toBe(false));
  fireEvent.click(typeCard(type)!);
  for (const [key, label] of picks) {
    await waitFor(() => expect(picker(key)).toBeEnabled());
    fireEvent.keyDown(picker(key), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    const option = within(listbox).getAllByRole('option').find((o) => o.textContent === label);
    if (!option) throw new Error(`${type}: ${key} lists no "${label}"`);
    fireEvent.click(option);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await waitFor(() => expect(picker(key).textContent).toBe(label));
  }
  fireEvent.change(screen.getByTestId('create-view-name-input'), { target: { value: `New ${type}` } });
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  fireEvent.click(submitButton());
}

/** Render the dialog alone, submit `type`, and return the payload it handed `onCreate`. */
async function dialogPayload(type: string, picks: ParseRow['picks']): Promise<Record<string, any>> {
  const onCreate = vi.fn(async () => true);
  render(<CreateViewDialog open onOpenChange={() => {}} onCreate={onCreate} objectDef={DEAL} />);
  await pickAndCreate(type, picks);
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  return (onCreate.mock.calls[0] as unknown as [Record<string, any>])[0];
}

/**
 * Assert the spec accepts `body`, surfacing its issues when it does not. Soft,
 * so one row reports every door the spec refuses rather than the first.
 */
function expectAccepted(schema: { safeParse: (v: unknown) => any }, body: unknown, where: string) {
  const verdict = schema.safeParse(body);
  expect.soft(
    verdict.success,
    `${where}: refused by the spec: ${JSON.stringify(verdict.error?.issues)}\nbody=${JSON.stringify(body)}`,
  ).toBe(true);
}

beforeEach(() => {
  cleanup();
  puts.length = 0;
  client = new MetadataClient({ baseUrl: 'http://localhost', fetch: wire() as any });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the enumeration: every view type the dialog offers has a parse row (objectui#11581)', () => {
  it('the fixture object gives both doors a non-empty column list (control)', () => {
    expect(COLUMNS.length).toBeGreaterThan(0);
  });

  it('PARSE_ROWS names exactly the types offeredViewTypes() lists', () => {
    expect(Object.keys(PARSE_ROWS).sort()).toEqual([...offeredViewTypes()].sort());
  });

  it('offeredViewTypes() is the type grid the dialog renders', () => {
    render(<CreateViewDialog open onOpenChange={() => {}} onCreate={vi.fn()} objectDef={DEAL} />);
    const cards = typeCards().map((b) => b.getAttribute('data-testid')!.replace(/^create-view-type-/, ''));
    expect(cards).toEqual(offeredViewTypes());
  });
});

describe('each offered type: both doors persist ONE body from the dialog payload, and the spec accepts it (objectui#11581)', () => {
  it.each(offeredViewTypes())('%s', async (type) => {
    const row = PARSE_ROWS[type];
    expect(row, `no parse row for the offered view type "${type}"`).toBeDefined();
    const payload = await dialogPayload(type, row.picks);
    expect(payload.type).toBe(type);
    expect(payload[type]).toEqual(row.block);

    const opts = { name: payload.name, label: payload.label };
    const doors = {
      'DOOR 1, "Save as view" (buildSaveAsViewSpec)': viewEnvelope(DEAL.name, buildSaveAsViewSpec(payload, COLUMNS, []), opts),
      'DOOR 2, add view (buildAddViewSpec)': viewEnvelope(DEAL.name, buildAddViewSpec(payload, DEAL), opts),
    };
    for (const [door, env] of Object.entries(doors)) {
      expectAccepted(ListViewSchema, env.config, `${type}, ${door}, ListViewSchema on the envelope's config`);
      expectAccepted(ViewItemSchema, env, `${type}, ${door}, ViewItemSchema on the envelope`);
    }
    const [door1, door2] = Object.values(doors);
    expect(door1, `${type}: the two doors built different bodies from one payload`).toEqual(door2);
  });
});

describe('the one builder owns the type-specific mirrors (objectui#11581)', () => {
  it('writes the resolved columns into `kanban.columns`, which the spec requires', () => {
    const spec = buildNewViewSpec({ type: 'kanban', kanban: { groupByField: 'stage' } }, { fallbackColumns: ['name', 'amount'] });
    expect(spec.kanban).toEqual({ groupByField: 'stage', columns: ['name', 'amount'] });
  });

  it('mirrors the payload\'s own columns over the door\'s fallback', () => {
    const spec = buildNewViewSpec({ type: 'kanban', columns: ['stage'], kanban: { groupByField: 'stage' } }, { fallbackColumns: ['name'] });
    expect(spec.columns).toEqual(['stage']);
    expect(spec.kanban).toEqual({ groupByField: 'stage', columns: ['stage'] });
  });

  it('writes them into `gallery.visibleFields` only when the payload carries none', () => {
    const fallbackColumns = ['name', 'amount'];
    expect(buildNewViewSpec({ type: 'gallery', gallery: { coverField: 'photo' } }, { fallbackColumns }).gallery)
      .toEqual({ coverField: 'photo', visibleFields: ['name', 'amount'] });
    expect(buildNewViewSpec({ type: 'gallery', gallery: { visibleFields: ['stage'] } }, { fallbackColumns }).gallery)
      .toEqual({ visibleFields: ['stage'] });
  });

  it('mirrors nothing for a type with no field list of its own, nor for a name off the prototype chain', () => {
    expect(buildNewViewSpec({ type: 'calendar', calendar: { startDateField: 'start_date' } }, { fallbackColumns: ['name'] }))
      .toEqual({ type: 'calendar', calendar: { startDateField: 'start_date' }, columns: ['name'] });
    expect(buildNewViewSpec({ type: 'toString' }, { fallbackColumns: ['name'] })).toEqual({ type: 'toString', columns: ['name'] });
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

describe('"Save as view" with Kanban answers 2xx at the view write door (objectui#11581)', () => {
  it('PUTs a kanban body the spec view gate accepts, its card fields mirrored from the columns', async () => {
    render(
      <ExpressionProvider user={{ id: 'u1', name: 'Ada' }}>
        <MemoryRouter initialEntries={['/apps/demo/crm_deal/data']}>
          <Routes>
            <Route path="/apps/:appName/:objectName/data" element={<ObjectDataPage dataSource={{ find: vi.fn(async () => ({ data: [] })) }} objects={[DEAL]} />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>,
    );
    fireEvent.click(screen.getByTestId('object-data-save-as-view'));
    await pickAndCreate('kanban', PARSE_ROWS.kanban.picks);
    await waitFor(() => expect(puts).toHaveLength(1));
    // The door's verdict first: before this card it answered 422 here.
    expect(puts[0].status, JSON.stringify(puts[0].body)).toBe(200);
    const config = puts[0].body.config;
    expect(config.columns.length).toBeGreaterThan(0);
    expect(config.kanban).toEqual({ groupByField: 'stage', columns: config.columns });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/\/view\/crm_deal\.new_kanban\?preview=draft$/));
  });
});
