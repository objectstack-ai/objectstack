// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13063 — a `type: 'form'` action placed at `record_related` and fired
 * from a related-list row opens the clicked row's edit form, not a blank
 * create form.
 *
 * The record page's runner context names the PAGE: the parent record and the
 * parent object. `executeForm` reads the record and its object from that
 * context only, and ignores `action.objectName` on purpose (objectui#4292). So
 * while the bridge retargeted a row action through the DEFINITION alone, the
 * showcase's "Log Time" (`target: 'showcase_task.form'`) compared a task view
 * against the project and navigated to the bare `/forms/:name`. The bridge now
 * hands the row as the dispatch's execution context.
 *
 * Every case mounts what a record page mounts for a related list: the real
 * `ActionProvider` with the record page's context shape (`record` +
 * `objectName`), the real `RelatedRecordActionsBridge`, the real
 * `SchemaRenderer` and `RelatedList`, and the runner's own `form` executor (no
 * `form` handler is registered, as on the record page). The navigation handler
 * is the observation point.
 *
 * Controls, green before and after: the same action fired from the child's
 * own record page, a page-level form action on the parent, and a non-form row
 * action (`api`) that still reaches its handler addressed to the clicked row.
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
  useAction,
  type MetadataContextValue,
} from '@object-ui/react';
// Registers `record:related_list`. Module scope on purpose (AGENTS.md, test
// discipline).
import '@object-ui/plugin-detail';

import type { ActionDef, ActionResult } from '@object-ui/core';

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';

/** Desktop, pinned (objectui#8399): the row menu read here is the data table's. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const navigateHandler = vi.fn();
const apiHandler = vi.fn(async (_action: ActionDef, _ctx: unknown): Promise<ActionResult> => ({ success: true }));

afterEach(() => {
  cleanup();
  navigateHandler.mockClear();
  apiHandler.mockClear();
});

const CHILD_NAME = 'task';
const PARENT_NAME = 'project';

/**
 * `log_time` is the showcase specimen reduced to this card: a `form` over the
 * child's own view, placed by `record_related`. `archive` is the non-form row
 * control.
 */
const LOG_TIME = { name: 'log_time', label: 'Log Time', type: 'form', target: 'task.edit', locations: ['record_related'] };
const CHILD_ACTIONS = [
  LOG_TIME,
  { name: 'archive', label: 'Archive', type: 'api', target: '/api/archive', locations: ['record_related'] },
];

const CHILD = {
  name: CHILD_NAME,
  label: 'Task',
  managedBy: 'platform',
  fields: { name: { type: 'text', label: 'Name' } },
  actions: CHILD_ACTIONS,
};

const ROW = { id: 't1', name: 'Write spec' };
const PARENT_RECORD = { id: 'P-1', name: 'Launch' };

/** The record page's runner context: the page record and the page object. */
const PARENT_CONTEXT = { record: PARENT_RECORD, objectName: PARENT_NAME };

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

const makeDataSource = () => ({
  find: vi.fn(async () => [ROW]),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: CHILD.fields })),
  delete: vi.fn(async () => ({})),
});

const doc = {
  type: 'record:related_list',
  properties: { objectName: CHILD_NAME, relationshipField: PARENT_NAME, columns: ['name'] },
};

type Execute = (action: ActionDef) => Promise<ActionResult>;

/** Hands a provider's page-level `execute` to the test (a header button's door). */
function ExecuteProbe({ onExecute }: { onExecute: (execute: Execute) => void }) {
  onExecute(useAction().execute);
  return null;
}

let pageExecute: Execute | null = null;

/** A record page of the PARENT, with the child's related list on it. */
function mountParentPage() {
  const dataSource = makeDataSource();
  return render(
    <MetadataCtx.Provider value={METADATA}>
      <ActionProvider context={PARENT_CONTEXT} onNavigate={navigateHandler} handlers={{ api: apiHandler }}>
        <ExecuteProbe onExecute={(execute) => { pageExecute = execute; }} />
        <MemoryRouter initialEntries={['/apps/demo/project/record/P-1']}>
          <RelatedRecordActionsBridge
            appName="demo"
            objects={[CHILD]}
            dataSource={dataSource}
            parentObjectName={PARENT_NAME}
            parentRecordId="P-1"
            parentTitle="Launch"
            parentRecord={PARENT_RECORD}
          >
            <RecordContextProvider objectName={PARENT_NAME} recordId="P-1" dataSource={dataSource as never}>
              <SchemaRenderer schema={doc as never} />
            </RecordContextProvider>
          </RelatedRecordActionsBridge>
        </MemoryRouter>
      </ActionProvider>
    </MetadataCtx.Provider>,
  );
}

/** Open the row's menu (Radix opens on `pointerdown`) and click `name`. */
async function clickRowAction(name: string) {
  await screen.findByText('Write spec');
  await waitFor(() => expect(screen.queryAllByLabelText('Row actions').length).toBeGreaterThan(0));
  fireEvent.pointerDown(screen.getAllByLabelText('Row actions')[0], { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByTestId(`row-action-${name}`));
}

describe('objectui#13063 — a `form` row action on a related list opens the clicked row', () => {
  it('navigates with the row id and the CHILD object', async () => {
    mountParentPage();
    await clickRowAction('log_time');
    await waitFor(() => expect(navigateHandler).toHaveBeenCalledTimes(1));
    // RED before the fix: `/forms/task.edit`, the blank create form. The page
    // context named the project, so the boundary check refused the id.
    expect(navigateHandler).toHaveBeenCalledWith('/forms/task.edit?recordId=t1&recordObject=task', { external: false });
  });
});

describe('objectui#13063 — controls', () => {
  it('the same action from the child record page is unchanged', async () => {
    let childExecute: Execute | null = null;
    render(
      <ActionProvider context={{ record: ROW, objectName: CHILD_NAME }} onNavigate={navigateHandler}>
        <ExecuteProbe onExecute={(execute) => { childExecute = execute; }} />
      </ActionProvider>,
    );
    await childExecute!(LOG_TIME as ActionDef);
    expect(navigateHandler).toHaveBeenCalledWith('/forms/task.edit?recordId=t1&recordObject=task', { external: false });
  });

  it('a page-level form action on the parent still opens the parent, after a row dispatch too', async () => {
    mountParentPage();
    await clickRowAction('log_time');
    await waitFor(() => expect(navigateHandler).toHaveBeenCalledTimes(1));
    // The row dispatch did not leave its context on the page's runner.
    await pageExecute!({ type: 'form', target: 'project.edit' } as ActionDef);
    expect(navigateHandler).toHaveBeenLastCalledWith('/forms/project.edit?recordId=P-1&recordObject=project', { external: false });
    // A page-level action at a child view crosses the boundary and stays a create.
    await pageExecute!({ type: 'form', target: 'task.edit' } as ActionDef);
    expect(navigateHandler).toHaveBeenLastCalledWith('/forms/task.edit', { external: false });
  });

  it('a non-form row action (`api`) still targets the clicked row', async () => {
    mountParentPage();
    await clickRowAction('archive');
    await waitFor(() => expect(apiHandler).toHaveBeenCalledTimes(1));
    const [action, ctx] = apiHandler.mock.calls[0];
    // The definition the record page's handlers read: unchanged.
    expect(action).toMatchObject({
      name: 'archive',
      objectName: CHILD_NAME,
      recordId: 't1',
      params: { _rowRecord: ROW },
    });
    // The context it runs in now names the row too.
    expect(ctx).toMatchObject({ record: ROW, objectName: CHILD_NAME });
  });
});
