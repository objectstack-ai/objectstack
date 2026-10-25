/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11943 — the Sort picker's field list applies the same field-level
 * read check as the list's columns and the Filter panel's list.
 *
 * The columns drop a field the user may not read through
 * `perms.checkField(objectName, field, 'read')`, and objectui#11925 gave the
 * Filter panel the same read. The Sort picker was built from the object
 * definition with no read check, so it offered a field the grid had dropped,
 * and choosing it sent a sort the server refuses, blanking the list. Both
 * lists now ask one predicate, `canReadField`.
 *
 * Everything here is read off the REAL `SortBuilder` dropdown, through the
 * provider the console mounts (`MePermissionsProvider`, with a
 * `/me/permissions`-shaped answer keyed `"object.field"`).
 *
 * The fixture is synthetic: one object, one field (`secret_note`) the
 * restricted answer marks unreadable, and one lookup (`secret_owner`) used only
 * by the relational-hint case.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { ListView } from '../ListView';

const OBJECT = 'fls_ticket';

/** The object definition, in declaration order. `priority` is no column. */
const FIELDS: Record<string, Record<string, unknown>> = {
  title: { type: 'text', label: 'Title' },
  status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
  secret_note: { type: 'textarea', label: 'Secret Note' },
  priority: { type: 'number', label: 'Priority' },
};

const COLUMNS = ['title', 'status', 'secret_note'];

/** Today's Sort picker for a user who may read every field. */
const FULL_READ_LABELS = ['Title', 'Status', 'Secret Note', 'Priority'];

function answer(fields: MePermissionsResponse['fields']): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: [],
    permissionSets: ['fls_member'],
    objects: { [OBJECT]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
    fields,
  };
}

const RESTRICTED = answer({
  [`${OBJECT}.secret_note`]: { readable: false, editable: false },
  [`${OBJECT}.secret_owner`]: { readable: false, editable: false },
});
const FULL_READ = answer({});

function makeDataSource(fields: Record<string, Record<string, unknown>> = FIELDS) {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT, fields }),
  };
}

function listFor(sort: Array<{ field: string; order: 'asc' | 'desc' }>, dataSource: ReturnType<typeof makeDataSource>) {
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: COLUMNS.map((field) => ({ field })),
    sort,
  } as unknown as ListViewSchema;
  return <ListView schema={schema} dataSource={dataSource} />;
}

function mount(
  { perms, sort = [{ field: 'title', order: 'asc' }], fields = FIELDS }: {
    perms?: MePermissionsResponse;
    sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
    fields?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const dataSource = makeDataSource(fields);
  const list = listFor(sort, dataSource);
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      {perms ? <MePermissionsProvider initialPermissions={perms}>{list}</MePermissionsProvider> : list}
    </SchemaRendererProvider>,
  );
  return dataSource;
}

function sortPanel(): HTMLElement {
  const dialog = screen.getByText('Sort Records').closest('[role="dialog"]');
  if (!dialog) throw new Error('no popover content around "Sort Records"');
  return dialog as HTMLElement;
}

/** The field triggers of the sort rows: each row is `[field select, direction select]`. */
function sortRowTriggers(): HTMLElement[] {
  return within(sortPanel())
    .getAllByRole('combobox')
    .filter((_, i) => i % 2 === 0);
}

/** The labels a sort row's field dropdown offers (Radix renders items only once opened). */
async function optionsOf(trigger: HTMLElement): Promise<string[]> {
  fireEvent.click(trigger);
  const listbox = await screen.findByRole('listbox');
  const labels = within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent?.trim() ?? '');
  fireEvent.keyDown(listbox, { key: 'Escape' });
  return labels;
}

/**
 * Open the Sort popover and return the first row's options once the object
 * definition has built them (`priority` is no column, so seeing it proves the
 * definition, not the columns-only fallback, built the list).
 */
async function openSortOptions(): Promise<string[]> {
  fireEvent.click(await screen.findByRole('button', { name: /^sort/i }));
  await screen.findByText('Sort Records');
  let labels: string[] = [];
  await waitFor(async () => {
    labels = await optionsOf(sortRowTriggers()[0]);
    expect(labels).toContain('Priority');
  });
  return labels;
}

afterEach(() => {
  cleanup();
});

describe('the Sort picker field list asks the column read check (objectui#11943)', () => {
  it('does not offer a field the user may not read, and offers every readable one', async () => {
    mount({ perms: RESTRICTED });
    const labels = await openSortOptions();
    expect(labels).not.toContain('Secret Note');
    expect(labels).toEqual(['Title', 'Status', 'Priority']);
  });

  it('control: a user who may read every field gets today’s list, the same as with no permission answer', async () => {
    mount({ perms: FULL_READ });
    expect(await openSortOptions()).toEqual(FULL_READ_LABELS);
    cleanup();
    mount();
    expect(await openSortOptions()).toEqual(FULL_READ_LABELS);
  });

  it('before the permission answer is loaded nothing is filtered, as the columns defer', async () => {
    // The real "not loaded" state with children mounted: the provider is
    // refetching. It still holds the RESTRICTED answer, so `checkField` would
    // deny `secret_note`, but `isLoaded` is false, and the column gate skips
    // its filter on exactly that flag. The Sort picker must agree.
    const dataSource = makeDataSource();
    let calls = 0;
    const fetcher = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(new Response(JSON.stringify(RESTRICTED), { status: 200 }))
        : new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const tree = (endpoint: string) => (
      <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
        <MePermissionsProvider endpoint={endpoint} fetcher={fetcher} maxRetries={0}>
          {listFor([{ field: 'title', order: 'asc' }], dataSource)}
        </MePermissionsProvider>
      </SchemaRendererProvider>
    );
    const { rerender } = render(tree('/me/permissions?first'));
    // Loaded, restricted: the field is withheld.
    expect(await openSortOptions()).toEqual(['Title', 'Status', 'Priority']);
    // A refetch that never settles: the provider keeps its data, `isLoaded` drops.
    rerender(tree('/me/permissions?second'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(async () => {
      expect(await optionsOf(sortRowTriggers()[0])).toEqual(FULL_READ_LABELS);
    });
  });

  it('a field the current sort already names stays listed, so its row is named', async () => {
    // objectui#11943's ruling keeps such a field listed so its row is not
    // blank and can be removed. It is listed as removable only: disabled, so
    // no other row and no "Add sort" can choose it. That half is pinned, for
    // each reason the picker keeps a field, in
    // `ListView.sortRemovableOnly-11943.test.tsx`.
    mount({ perms: RESTRICTED, sort: [{ field: 'secret_note', order: 'asc' }] });
    const labels = await openSortOptions();
    expect(labels).toContain('Secret Note');
    expect(labels).toEqual(FULL_READ_LABELS);
    expect(sortRowTriggers()[0]).toHaveTextContent('Secret Note');
  });

  it('an unreadable lookup does not raise the relational hint; a readable one still does', async () => {
    const withLookup = { ...FIELDS, secret_owner: { type: 'lookup', label: 'Secret Owner', reference: 'sys_user' } };
    mount({ perms: RESTRICTED, fields: withLookup });
    await openSortOptions();
    expect(screen.queryByTestId('sort-relational-info')).toBeNull();
    cleanup();
    mount({ perms: FULL_READ, fields: withLookup });
    await openSortOptions();
    expect(screen.getByTestId('sort-relational-info')).toBeInTheDocument();
  });
});
