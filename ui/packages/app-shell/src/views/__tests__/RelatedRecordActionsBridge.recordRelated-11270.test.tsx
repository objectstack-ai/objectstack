// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11270 — a related list inside a record places its child object's
 * `record_related` actions on each row, and the authored `actions` channel
 * accepts them (the renderer half of objectstack-ai/objectstack#20937's
 * enforce answer, triage `5919625056`).
 *
 * The spec declares the location as "actions on a related list section inside
 * a record". Triage read it as ROW placement (the runtime counts it among the
 * locations that require a record, beside `list_item`), scoped to a parent
 * record: `list_item` shows on the child's rows wherever the child is listed,
 * `record_related` only on the related-list rows inside a parent record.
 *
 * Every case mounts what a record page mounts: the real
 * `RelatedRecordActionsBridge` around the `{ type, properties }` node through
 * the real `SchemaRenderer`, `@object-ui/plugin-detail`'s registration, the
 * real `RelatedList` and the real data table, then opens a row's menu and
 * reads the DOM. The negative half on the child's OWN list view lives in
 * `ObjectView.recordRelatedNotOnOwnList-11270.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import {
  ActionProvider,
  MetadataCtx,
  RecordContextProvider,
  SchemaRenderer,
  type MetadataContextValue,
} from '@object-ui/react';
// Registers `record:related_list` — the block a record page draws a related
// list with. Module scope on purpose (AGENTS.md, test discipline).
import '@object-ui/plugin-detail';

import type { ActionDef } from '@object-ui/core';

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';

/**
 * Desktop, pinned (objectui#8399): under the 768 breakpoint a table-type
 * related list renders a card gallery, and the row menu read here is the data
 * table's.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => {
  cleanup();
  formHandler.mockClear();
});

const CHILD_NAME = 'task';

/**
 * The child object's actions. `log_time` is the showcase's `record_related`
 * specimen reduced to this card's case (a `form` over the child's edit view,
 * placed ONLY by `record_related`); `send_reminder` is the `list_item` control.
 * `archive` declares both, so it must render once.
 */
const CHILD_ACTIONS = [
  { name: 'send_reminder', label: 'Send Reminder', type: 'api', target: '/api/remind', locations: ['list_item'] },
  { name: 'log_time', label: 'Log Time', type: 'form', target: 'task.edit', locations: ['record_related'] },
  { name: 'archive', label: 'Archive', type: 'api', target: '/api/archive', locations: ['list_item', 'record_related'] },
  { name: 'header_only', label: 'Header Only', type: 'api', target: '/api/h', locations: ['record_header'] },
];

const CHILD = {
  name: CHILD_NAME,
  label: 'Task',
  managedBy: 'platform',
  fields: { name: { type: 'text', label: 'Name' } },
  actions: CHILD_ACTIONS,
};

const ROWS = [{ id: 't1', name: 'Write spec' }];

const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' && name === CHILD_NAME ? CHILD : null,
);

/** Module-level: `getItem` is an effect dependency of `useMetadataItem`. */
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [CHILD],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: getItem as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

/**
 * The page's `form` executor, standing in for the console's. The bridge hands
 * a row action to the page's shared runner, and the runner dispatches a
 * registered handler by the action's `type`.
 */
const formHandler = vi.fn(async (_action: ActionDef, _ctx: unknown) => ({ success: true }));
const HANDLERS = { form: formHandler };

const makeDataSource = () => ({
  find: vi.fn(async () => ROWS),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: CHILD.fields })),
  delete: vi.fn(async () => ({})),
});

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (actions: unknown) => ({
  type: 'record:related_list',
  properties: {
    objectName: CHILD_NAME,
    relationshipField: 'project',
    columns: ['name'],
    ...(actions === undefined ? {} : { actions }),
  },
});

/**
 * Mount the related list under the bridge. `parentRecord: false` mounts the
 * bridge the way its props document for "no parent context (e.g. a
 * standalone list)": no parent object, id or record.
 */
function mount(actions?: unknown, { parentRecord = true }: { parentRecord?: boolean } = {}) {
  const dataSource = makeDataSource();
  return render(
    <MetadataCtx.Provider value={METADATA}>
      <ActionProvider handlers={HANDLERS}>
        <MemoryRouter initialEntries={['/apps/demo/project/record/P-1']}>
          <RelatedRecordActionsBridge
            appName="demo"
            objects={[CHILD]}
            dataSource={dataSource}
            {...(parentRecord
              ? {
                  parentObjectName: 'project',
                  parentRecordId: 'P-1',
                  parentTitle: 'Launch',
                  parentRecord: { id: 'P-1', name: 'Launch' },
                }
              : {})}
          >
            <RecordContextProvider objectName="project" recordId="P-1" dataSource={dataSource as never}>
              <SchemaRenderer schema={doc(actions) as never} />
            </RecordContextProvider>
          </RelatedRecordActionsBridge>
        </MemoryRouter>
      </ActionProvider>
    </MetadataCtx.Provider>,
  );
}

const rowTriggers = () => screen.queryAllByLabelText('Row actions');

/**
 * Open the first row's menu (Radix opens on `pointerdown`) and read the child
 * object's actions in it, in order. The built-in Edit / Delete items
 * (`row-action-builtin-*`) are the host's CRUD affordances, not action ids,
 * and are left out.
 */
async function rowMenuNames(): Promise<string[]> {
  await waitFor(() => expect(rowTriggers().length).toBeGreaterThan(0));
  fireEvent.pointerDown(rowTriggers()[0], { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const menu = await screen.findByRole('menu');
  return within(menu)
    .queryAllByTestId(/^row-action-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('row-action-', ''))
    .filter((name) => !name.startsWith('builtin-'));
}

const waitForRow = () => screen.findByText('Write spec');
const refusal = () => screen.queryByTestId('record-related-list-actions-refused');

describe('objectui#11270 — the host bridge places `record_related` on each related-list row inside a record', () => {
  it('a `record_related`-only child action shows in the row menu, beside the `list_item` control, in declared order', async () => {
    mount();
    await waitForRow();
    // `archive` declares both locations and renders ONCE; `header_only` is a
    // record-header action and stays off the rows.
    expect(await rowMenuNames()).toEqual(['send_reminder', 'log_time', 'archive']);
  });

  it('with no parent record in scope the bridge places only `list_item` — `record_related` is a record-page placement', async () => {
    mount(undefined, { parentRecord: false });
    await waitForRow();
    // Control first: the row menu is alive and draws the `list_item` actions,
    // so the absence below is the scope rule's, not a dead menu's.
    expect(await rowMenuNames()).toEqual(['send_reminder', 'archive']);
  });

  it('the placed action runs against the clicked row, retargeted at the child object', async () => {
    mount();
    await waitForRow();
    await rowMenuNames();
    const item = await screen.findByTestId('row-action-log_time');
    expect(item).toHaveTextContent('Log Time');
    fireEvent.click(item);
    await waitFor(() => expect(formHandler).toHaveBeenCalledTimes(1));
    expect(formHandler.mock.calls[0][0]).toMatchObject({
      name: 'log_time',
      target: 'task.edit',
      objectName: CHILD_NAME,
      recordId: 't1',
    });
  });
});

describe('objectui#11270 — the authored `actions` channel accepts a `record_related` id', () => {
  it('a named `record_related` id is placed on each row, and nothing is refused', async () => {
    mount(['log_time']);
    await waitForRow();
    await waitFor(() => expect(rowTriggers()).toHaveLength(ROWS.length));
    expect(await rowMenuNames()).toEqual(['log_time']);
    expect(refusal()).toBeNull();
  });

  it('authored order holds across both row locations', async () => {
    mount(['log_time', 'send_reminder']);
    await waitForRow();
    expect(await rowMenuNames()).toEqual(['log_time', 'send_reminder']);
    expect(refusal()).toBeNull();
  });

  it('the refusal notice for an unplaceable id names the three related-list locations', async () => {
    mount(['header_only', 'log_time']);
    await waitForRow();
    await waitFor(() => expect(refusal()).not.toBeNull());
    const notice = refusal()!;
    expect(notice).toHaveTextContent('header_only');
    expect(notice).toHaveTextContent(/list_toolbar/);
    expect(notice).toHaveTextContent(/list_item/);
    expect(notice).toHaveTextContent(/record_related/);
    // The placeable entry beside it still renders.
    expect(await rowMenuNames()).toEqual(['log_time']);
  });
});
