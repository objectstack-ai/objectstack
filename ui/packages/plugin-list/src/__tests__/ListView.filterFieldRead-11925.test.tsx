/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11925 — the Filter panel's field list applies the same field-level
 * read check as the list's columns.
 *
 * The columns drop a field the user may not read through
 * `perms.checkField(objectName, field, 'read')`; the Filter panel's field list
 * was built from the object definition (or, before it loads, the declared
 * columns) with no read check at all, so a field the grid had dropped could
 * still be picked as a filter condition. These pins hold the two lists to one
 * answer, through the provider the console mounts (`MePermissionsProvider`,
 * hydrated with a `/me/permissions`-shaped answer keyed `"object.field"`).
 *
 * The fixture is synthetic: one object, one field (`secret_note`) the
 * restricted answer marks unreadable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

type Candidate = { value: string; label: string; type: string };

// Every field list `ListView` hands the builder, while the REAL builder still
// renders.
const captured = vi.hoisted(() => ({ fields: [] as Candidate[][] }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...actual,
    FilterBuilder: (props: React.ComponentProps<typeof actual.FilterBuilder>) => {
      captured.fields.push((props.fields ?? []) as Candidate[]);
      return <actual.FilterBuilder {...props} />;
    },
  };
});

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

/** Today's list for a user who may read every field: the columns, then the other business field. */
const FULL_READ_LIST = ['title', 'status', 'secret_note', 'priority'];

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

const RESTRICTED = answer({ [`${OBJECT}.secret_note`]: { readable: false, editable: false } });
const FULL_READ = answer({});

interface MountOptions {
  perms?: MePermissionsResponse;
  schemaExtra?: Record<string, unknown>;
  props?: Record<string, unknown>;
  /** The definition is served with no `fields` map, so the list falls back to the declared columns. */
  noDefinitionFields?: boolean;
}

function mount({ perms, schemaExtra = {}, props = {}, noDefinitionFields = false }: MountOptions = {}) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(
      noDefinitionFields ? { name: OBJECT } : { name: OBJECT, fields: FIELDS },
    ),
  };
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: COLUMNS.map((field) => ({ field })),
    ...schemaExtra,
  } as unknown as ListViewSchema;
  const list = <ListView schema={schema} dataSource={dataSource} {...props} />;
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      {perms ? <MePermissionsProvider initialPermissions={perms}>{list}</MePermissionsProvider> : list}
    </SchemaRendererProvider>,
  );
  return dataSource;
}

/**
 * Open the Filter popover and return the field list once the object
 * definition has loaded (`priority` is no column, so seeing it proves the
 * definition — not the columns-only fallback — built the list).
 */
async function openFilterFieldList(): Promise<string[]> {
  fireEvent.click(screen.getByRole('button', { name: /^filter/i }));
  await screen.findByText('Filter Records');
  await waitFor(() => {
    const latest = captured.fields[captured.fields.length - 1] ?? [];
    expect(latest.some((f) => f.value === 'priority')).toBe(true);
  });
  return captured.fields[captured.fields.length - 1].map((f) => f.value);
}

afterEach(() => {
  cleanup();
  captured.fields.length = 0;
});

describe('the Filter panel field list asks the column read check (objectui#11925)', () => {
  it('does not offer a field the user may not read, and offers every readable one', async () => {
    mount({ perms: RESTRICTED });
    const list = await openFilterFieldList();
    expect(list).not.toContain('secret_note');
    expect(list).toEqual(['title', 'status', 'priority']);
  });

  it('agrees with the column gate: the field the grid projection drops is the one the filter list drops', async () => {
    const dataSource = mount({ perms: RESTRICTED });
    const list = await openFilterFieldList();
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const calls = dataSource.find.mock.calls;
    const select = calls[calls.length - 1]?.[1]?.$select as string[] | undefined;
    expect(select).toBeDefined();
    expect(select).not.toContain('secret_note');
    expect(select).toEqual(expect.arrayContaining(['title', 'status']));
    for (const column of COLUMNS) {
      expect(list.includes(column), column).toBe(select!.includes(column));
    }
  });

  it('control: a user who may read every field gets today’s list, the same as with no permission answer', async () => {
    mount({ perms: FULL_READ });
    expect(await openFilterFieldList()).toEqual(FULL_READ_LIST);
    cleanup();
    captured.fields.length = 0;
    mount();
    expect(await openFilterFieldList()).toEqual(FULL_READ_LIST);
  });

  // objectui#13118 — this row read "the `filterableFields` whitelist does not
  // bring an unreadable field back", and the list was the whitelist minus the
  // unreadable field (`title`, `priority`). The spec retired the key
  // (objectstack#24640, ruling C) and no per-view whitelist replaces it, so the
  // read check is now the only narrowing: a stored view that still carries the
  // key gets exactly the list a view without it gets.
  it('a stored view still carrying the retired `filterableFields` gets the read-checked list, no narrower and no wider (objectui#13118)', async () => {
    mount({ perms: RESTRICTED, schemaExtra: { filterableFields: ['secret_note', 'priority', 'title'] } });
    const list = await openFilterFieldList();
    expect(list).not.toContain('secret_note');
    expect(list).toEqual(['title', 'status', 'priority']);
  });

  it('a held condition on an unreadable field does not bring it back', async () => {
    mount({
      perms: RESTRICTED,
      props: {
        initialFilters: { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'secret_note', operator: 'equals', value: '' }] },
      },
    });
    const list = await openFilterFieldList();
    expect(list).not.toContain('secret_note');
  });

  it('the declared-columns fallback (no fields in the definition) drops it too', async () => {
    mount({ perms: RESTRICTED, noDefinitionFields: true });
    fireEvent.click(screen.getByRole('button', { name: /^filter/i }));
    await screen.findByText('Filter Records');
    await waitFor(() => {
      const latest = (captured.fields[captured.fields.length - 1] ?? []).map((f) => f.value);
      expect(latest).toEqual(['title', 'status']);
    });
  });

  it('control: the declared-columns fallback still offers every column to a user who may read them all', async () => {
    mount({ perms: FULL_READ, noDefinitionFields: true });
    fireEvent.click(screen.getByRole('button', { name: /^filter/i }));
    await screen.findByText('Filter Records');
    await waitFor(() => {
      const latest = (captured.fields[captured.fields.length - 1] ?? []).map((f) => f.value);
      expect(latest).toEqual(COLUMNS);
    });
  });
});
