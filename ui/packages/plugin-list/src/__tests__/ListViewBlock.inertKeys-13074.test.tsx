/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13074 — two keys of the spec's `list-view` row that objectui#13047
 * measured inert on a page node:
 *
 *  - `requiredPermissions`, now honoured by `ListViewBlock` and published: the
 *    audience gate, read the way the record blocks read it (`hasCapabilities`
 *    over the reported `systemPermissions`), with the same
 *    insufficient-permissions notice in place of the list and no query sent.
 *  - `addRecord`, routed: the Add button calls the `onCreate` a
 *    `RelatedRecordActionsContext` provider serves for the listed object
 *    (`resolve({ objectName })`), and is withheld under a provider that serves
 *    none. The rows below pin the block's contract against a provider, not a
 *    console page; objectui#13089 published the key once the console's page
 *    host served that `onCreate` (`PageView.listViewAddRecord-13089.test.tsx`
 *    in `@object-ui/app-shell`).
 *
 * The third key the card names, `sharing`, stays inert and unpublished: the
 * spec declares no action for its Share button. Its control row is below.
 *
 * Every node is authored the way the spec authors it, in a `properties` bag
 * the spec's own `list-view` row accepts, and rendered through the REAL
 * `SchemaRenderer` and this package's `list-view` registration. Permissions
 * come from a real stock `MePermissionsProvider`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import {
  SchemaRenderer,
  SchemaRendererProvider,
  RelatedRecordActionsProvider,
  type RelatedRecordActionsValue,
  type RelatedRecordHandlers,
} from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { ComponentPropsMap } from '@objectstack/spec/ui';
// Registers the REAL `list-view`.
import '../index';

const OBJECT = 'crm_task';

type Row = Record<string, unknown>;

const ROWS: Row[] = [
  { id: 't-1', name: 'Draft the brief', stage: 'todo' },
  { id: 't-2', name: 'Ship the fold', stage: 'doing' },
];

const OBJECT_DEF = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    stage: { name: 'stage', type: 'text', label: 'Stage' },
  },
};

// The child grid is a stand-in, as in this package's other `list-view` tests:
// `plugin-grid` is not a dependency of this one.
ComponentRegistry.register(
  'object-grid',
  () => <div data-testid="object-grid-standin" />,
  { namespace: 'test', label: 'object-grid stand-in', category: 'view' },
);

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => ROWS.length),
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  };
}
type Adapter = ReturnType<typeof makeDataSource>;

/** A page `list-view` node whose `properties` the spec's own row accepts. */
function node(properties: Row = {}): Row {
  const bag = { data: { provider: 'object', object: OBJECT }, columns: ['name', 'stage'], ...properties };
  const parsed = (ComponentPropsMap as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }>)[
    'list-view'
  ].safeParse(bag);
  if (!parsed.success) {
    throw new Error(`fixture refused by the spec's list-view row: ${JSON.stringify(parsed.error)}`);
  }
  return { type: 'list-view', properties: bag };
}

/** A `/me/permissions` payload; the object may be read, never created. */
function me(systemPermissions: string[] | undefined): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 't1',
    roles: [],
    permissionSets: [],
    ...(systemPermissions === undefined ? {} : { systemPermissions }),
    objects: {
      [OBJECT]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
    fields: {},
  } as MePermissionsResponse;
}

interface MountOptions {
  /** The viewer's capabilities; `undefined` = a provider that reports none; absent key = no provider. */
  held?: string[] | undefined;
  /** A `RelatedRecordActionsContext` provider; absent = no provider at all. */
  host?: RelatedRecordActionsValue;
}

function mount(properties: Row, options: MountOptions = {}) {
  const dataSource = makeDataSource();
  let tree = (
    <SchemaRendererProvider dataSource={dataSource as never}>
      <SchemaRenderer schema={node(properties) as never} />
    </SchemaRendererProvider>
  );
  if (options.host) tree = <RelatedRecordActionsProvider value={options.host}>{tree}</RelatedRecordActionsProvider>;
  if ('held' in options) tree = <MePermissionsProvider initialPermissions={me(options.held)}>{tree}</MePermissionsProvider>;
  return { dataSource, ...render(tree) };
}

/** A provider value whose `resolve` answers `handlers` for any object, and records what it was asked. */
function makeHost(handlers: RelatedRecordHandlers) {
  const resolve = vi.fn(() => handlers);
  return { resolve, host: { resolve } as RelatedRecordActionsValue };
}

async function listDrawn(dataSource: Adapter): Promise<void> {
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  await screen.findByTestId('object-grid-standin');
}

/** Lets the gate, the object load and any query settle, so an absence is not an unfinished load. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function refused(dataSource: Adapter): Promise<void> {
  const notice = await screen.findByTestId('list-view-insufficient-permissions');
  expect(notice.getAttribute('role')).toBe('status');
  expect(notice.textContent).toBe('Insufficient permissions to view list.');
  await settle();
  expect(dataSource.find).not.toHaveBeenCalled();
  expect(screen.queryByTestId('object-grid-standin')).toBeNull();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#13074 — `requiredPermissions` gates a page `list-view` node the way the record blocks do', () => {
  it('a viewer without the capability sees the insufficient-permissions notice, and no `find` is sent', async () => {
    const { dataSource } = mount({ requiredPermissions: ['crm.manage'] }, { held: [] });
    await refused(dataSource);
  });

  it('a viewer holding the capability sees the list, queried', async () => {
    const { dataSource } = mount({ requiredPermissions: ['crm.manage'] }, { held: ['crm.manage'] });
    await listDrawn(dataSource);
    expect(screen.queryByTestId('list-view-insufficient-permissions')).toBeNull();
  });

  it('ALL are required: a partial grant on a two-entry list is refused', async () => {
    const { dataSource } = mount({ requiredPermissions: ['crm.manage', 'crm.export'] }, { held: ['crm.manage'] });
    await refused(dataSource);
  });

  it('CONTROL for the partial row: the full grant draws the list', async () => {
    const { dataSource } = mount(
      { requiredPermissions: ['crm.manage', 'crm.export'] },
      { held: ['crm.manage', 'crm.export'] },
    );
    await listDrawn(dataSource);
  });

  it('an empty list is no gate', async () => {
    const { dataSource } = mount({ requiredPermissions: [] }, { held: [] });
    await listDrawn(dataSource);
  });

  it('CONTROL: a node without the key draws and queries for a viewer who holds nothing', async () => {
    const { dataSource } = mount({}, { held: [] });
    await listDrawn(dataSource);
    expect(screen.queryByTestId('list-view-insufficient-permissions')).toBeNull();
  });

  it('a provider that reports no `systemPermissions` fails open (objectui#4656)', async () => {
    const { dataSource } = mount({ requiredPermissions: ['crm.manage'] }, { held: undefined });
    await listDrawn(dataSource);
  });
});

describe('objectui#13074 — `addRecord` on a page `list-view` node calls the `onCreate` a provider serves', () => {
  it('under a provider serving `onCreate`, clicking the Add button calls it for the listed object', async () => {
    const onCreate = vi.fn();
    const { resolve, host } = makeHost({ onCreate });
    const { dataSource } = mount({ addRecord: { enabled: true } }, { host });
    await listDrawn(dataSource);
    fireEvent.click(screen.getByTestId('add-record-button'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ objectName: OBJECT });
    expect(dataSource.create).not.toHaveBeenCalled();
  });

  it('`position: \'both\'` under a provider serving `onCreate` draws two buttons, and each calls it', async () => {
    const onCreate = vi.fn();
    const { host } = makeHost({ onCreate });
    const { dataSource } = mount({ addRecord: { enabled: true, position: 'both' } }, { host });
    await listDrawn(dataSource);
    const buttons = screen.getAllByTestId('add-record-button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) fireEvent.click(button);
    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it('a provider that serves no `onCreate` for the object (no create grant) gets no Add button, rather than a dead one', async () => {
    const { host } = makeHost({ onView: vi.fn() });
    const { dataSource } = mount({ addRecord: { enabled: true } }, { host });
    await listDrawn(dataSource);
    await settle();
    expect(screen.queryByTestId('add-record-button')).toBeNull();
  });

  it('an `onCreate` the provider greys (`createDisabled`) is withheld too: the list draws no greyed Add button', async () => {
    const onCreate = vi.fn();
    const { host } = makeHost({ onCreate, createDisabled: true });
    const { dataSource } = mount({ addRecord: { enabled: true } }, { host });
    await listDrawn(dataSource);
    await settle();
    expect(screen.queryByTestId('add-record-button')).toBeNull();
  });

  it('with no provider at all (a designer preview, a standalone embed) the button is withheld', async () => {
    const { dataSource } = mount({ addRecord: { enabled: true } });
    await listDrawn(dataSource);
    await settle();
    expect(screen.queryByTestId('add-record-button')).toBeNull();
  });

  it('CONTROL: a node without `addRecord` draws no Add button and asks the provider nothing', async () => {
    const onCreate = vi.fn();
    const { resolve, host } = makeHost({ onCreate });
    const { dataSource } = mount({}, { host });
    await listDrawn(dataSource);
    await settle();
    expect(screen.queryByTestId('add-record-button')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('objectui#13074 — `sharing` stays inert and unpublished (CONTROL)', () => {
  it('the Share button still carries no click handler: a click changes nothing on the page', async () => {
    const { dataSource } = mount({ sharing: { type: 'personal' } });
    await listDrawn(dataSource);
    await settle();
    const share = screen.getByTestId('share-button');
    const before = document.body.innerHTML;
    fireEvent.click(share);
    await settle();
    expect(document.body.innerHTML).toBe(before);
  });

  it('the registration publishes `requiredPermissions` and `addRecord` (objectui#13089), and not `sharing`', () => {
    const inputs = (ComponentRegistry.getConfig('list-view')?.inputs ?? []).map((input: { name: string }) => input.name);
    expect(inputs).toContain('requiredPermissions');
    // Published once the console's page host served the create its Add button
    // opens (`PageView.listViewAddRecord-13089.test.tsx` in `@object-ui/app-shell`).
    expect(inputs).toContain('addRecord');
    expect(inputs).not.toContain('sharing');
  });
});
