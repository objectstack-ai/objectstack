/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list` names the authored actions it cannot draw because no
 * host executor can run them (objectui#12870).
 *
 * An authored action is handed to the list only beside the host's executor for
 * its surface (`onToolbarAction` / `onRowAction`): an action offered with
 * nothing to run it would be a dead button. On a custom page whose list has no
 * parent in scope, the page serves no executor, and the list used to draw
 * nothing and say nothing. It now names the entries in a `role="status"`
 * notice beside the refusal notice, for the refusal notice's audience.
 *
 * Every case mounts the node the way a page does: the `{ type, properties }`
 * document through the real `SchemaRenderer`, this package's registration and
 * the real `RelatedList`, and reads the DOM.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  MetadataCtx,
  RecordContextProvider,
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type MetadataContextValue,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
// Registers `record:related_list`, the block under test.
import '../../index';

/** Desktop (objectui#8399): the row menu trigger read below is the data table's. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => cleanup());

const PARENT = 'sys_organization';
const CHILD_ACTIONS = [
  { name: 'invite_user', label: 'Invite user', type: 'api', locations: ['list_toolbar'] },
  { name: 'change_role', label: 'Change role', type: 'api', locations: ['record_related'] },
];
const CHILD = { name: 'sys_member', label: 'Member', actions: CHILD_ACTIONS };

const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' && name === CHILD.name ? CHILD : null,
);
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
  find: vi.fn(async (object: string) =>
    object === PARENT
      ? { data: [{ id: 'org-1', name: 'Acme' }], total: 1 }
      : { data: [{ id: 'm-1', name: 'Alice', organization_id: 'org-1' }], total: 1 },
  ),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
  onMutation: () => () => {},
});

const doc = (extra: Record<string, unknown>) => ({
  type: 'record:related_list',
  properties: { objectName: CHILD.name, relationshipField: 'organization_id', columns: ['name'], ...extra },
});

/** What a custom page serves a list it does not serve: navigation only, no handler. */
const PAGE_HOST_NO_HANDLERS: RelatedRecordActionsValue = { resolve: () => ({}) };

/** What the record page's bridge serves: both executors (the default actions are irrelevant once authored). */
const RECORD_PAGE_HOST: RelatedRecordActionsValue = {
  resolve: () => ({ onToolbarAction: () => {}, onRowAction: () => {} }),
};

function mount(node: object, { host, recordPage = false }: { host?: RelatedRecordActionsValue; recordPage?: boolean }) {
  const ds = makeDataSource();
  let tree: React.ReactNode = <SchemaRenderer schema={node as never} />;
  if (host) tree = <RelatedRecordActionsProvider value={host}>{tree}</RelatedRecordActionsProvider>;
  if (recordPage) {
    tree = (
      <RecordContextProvider objectName={PARENT} recordId="org-1" dataSource={ds as never}>
        {tree}
      </RecordContextProvider>
    );
  }
  return render(
    <MetadataCtx.Provider value={METADATA}>
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>{tree}</SchemaRendererProvider>
    </MetadataCtx.Provider>,
  );
}

const unserved = () => screen.queryByTestId('record-related-list-actions-unserved');
const toolbarNames = () => screen.queryAllByTestId(/^related-toolbar-action-/);
const rowTriggers = () => screen.queryAllByLabelText('Row actions');

describe('record:related_list — authored actions no executor can run are named, never dropped silently (objectui#12870)', () => {
  it('on an app page with no parent in scope, the notice names each entry and points at `parentDataSource`', async () => {
    mount(doc({ actions: ['invite_user', 'change_role'] }), { host: PAGE_HOST_NO_HANDLERS });
    await waitFor(() => expect(unserved()).not.toBeNull());
    const notice = unserved()!;
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent('"invite_user"');
    expect(notice).toHaveTextContent('"change_role"');
    expect(notice).toHaveTextContent('parentDataSource');
    expect(toolbarNames()).toHaveLength(0);
    // The refusal notice is a different fact (an id that does not resolve) and stays absent.
    expect(screen.queryByTestId('record-related-list-actions-refused')).toBeNull();
  });

  it('with the parent bound but no executor served, the notice names the missing executor instead', async () => {
    mount(doc({ actions: ['invite_user'], parentDataSource: { object: PARENT, limit: 1 } }), {
      host: PAGE_HOST_NO_HANDLERS,
    });
    await screen.findByText('Alice');
    await waitFor(() => expect(unserved()).not.toBeNull());
    expect(unserved()).toHaveTextContent('"invite_user"');
    expect(unserved()).toHaveTextContent('No host on this page offers an executor');
  });

  it('CONTROL: an app-page list that authors no `actions` draws no notice', async () => {
    mount(doc({ parentDataSource: { object: PARENT, limit: 1 } }), { host: PAGE_HOST_NO_HANDLERS });
    await screen.findByText('Alice');
    expect(unserved()).toBeNull();
    expect(toolbarNames()).toHaveLength(0);
  });

  it('CONTROL: under the record page’s executors the authored actions draw, and no notice', async () => {
    mount(doc({ actions: ['invite_user', 'change_role'] }), { host: RECORD_PAGE_HOST, recordPage: true });
    await screen.findByText('Alice');
    await waitFor(() => expect(toolbarNames()).toHaveLength(1));
    await waitFor(() => expect(rowTriggers()).toHaveLength(1));
    expect(unserved()).toBeNull();
  });
});
