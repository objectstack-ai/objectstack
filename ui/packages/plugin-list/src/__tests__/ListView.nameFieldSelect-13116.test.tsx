/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13116 — an ungrouped list asks for the object's declared
 * `nameField`.
 *
 * The bulk confirm step (`plugin-grid` `BulkActionDialog`, objectui#13107)
 * names each affected record from the rows the grid holds: the declared
 * `nameField` value when the row carries it, else the resolver's
 * `Record #ID` floor. An ungrouped list's rows come from `ListView`'s own
 * fetch, and its `$select` harvest had no arm for `nameField`, so a list whose
 * columns omit it fetched rows without it and the step listed `Record #ID`.
 *
 * A grouped grid that owns its fetch projects through `ObjectGrid`'s
 * `getSelectFields`, pinned with the real dialog in plugin-grid's
 * `bulkConfirmNameField-13107.test.tsx`. plugin-list does not depend on
 * plugin-grid, so a stub grid stands in here and the confirm step's name is
 * asked of the rule that step applies, against the rows the grid is handed:
 * the declared value via `recordDisplayValueAt(row, declaredNameField(def))`,
 * then `getRecordDisplayName`.
 *
 * What is pinned:
 *   - a formula `nameField` that is not a column is in `$select`, is not drawn
 *     as a column, and the rows handed to the grid name each record;
 *   - control: an object with no `nameField` sends the same `$select` as
 *     before;
 *   - control: a `nameField` that is a column is sent once.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry, declaredNameField, getRecordDisplayName, recordDisplayValueAt } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const CONTACT = 'crm_contact';
const NOTE = 'crm_note';

const contactDef = {
  name: CONTACT,
  label: 'Contact',
  nameField: 'full_name',
  fields: {
    id: { name: 'id', type: 'text' },
    first_name: { name: 'first_name', type: 'text', label: 'First Name' },
    last_name: { name: 'last_name', type: 'text', label: 'Last Name' },
    title: { name: 'title', type: 'text', label: 'Title' },
    full_name: { name: 'full_name', type: 'formula', label: 'Full Name', expression: "first_name + ' ' + last_name" },
  },
};

// The same shape with no declared pointer: the control.
const noteDef = {
  name: NOTE,
  label: 'Note',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    body: { name: 'body', type: 'text', label: 'Body' },
    full_name: { name: 'full_name', type: 'text', label: 'Full Name' },
  },
};

const CONTACT_ROWS = [
  { id: 'c1', first_name: 'John', last_name: 'Smith', title: 'VP of Engineering', full_name: 'John Smith' },
  { id: 'c2', first_name: 'Marcus', last_name: 'Reed', title: 'Director of Commercial Systems', full_name: 'Marcus Reed' },
];
const NOTE_ROWS = [{ id: 'n1', subject: 'Kickoff', body: 'Agenda', full_name: 'unused' }];

let lastGridProps: any = null;
let prevObjectGrid: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});

/** Honours `$select` the way a server does: a row carries the selected keys only. */
const makeDataSource = (def: Record<string, unknown>, rows: Array<Record<string, unknown>>) =>
  ({
    find: vi.fn(async (_object: string, params: Record<string, any>) => {
      const select = params?.$select as string[] | undefined;
      const data = rows.map((row) =>
        select ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]])) : { ...row },
      );
      return { data, total: data.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => (name === def.name ? def : null)),
  }) as any;

async function mount(def: Record<string, unknown>, rows: Array<Record<string, unknown>>, columns: string[]) {
  const dataSource = makeDataSource(def, rows);
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: def.name as string, viewType: 'grid', columns } as any}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  const raw = (dataSource.find.mock.calls.at(-1)?.[1]?.$select as string[] | undefined) ?? [];
  return { raw, select: [...raw].sort() };
}

/** The rows the grid was handed, once it has been handed some. */
async function gridRows(): Promise<Array<Record<string, unknown>>> {
  await waitFor(() => expect(Array.isArray(lastGridProps?.data) && lastGridProps.data.length > 0).toBe(true));
  return lastGridProps.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  lastGridProps = null;
});
afterEach(() => {
  cleanup();
  lastGridProps = null;
});

describe('ListView — an ungrouped list asks for the declared nameField (objectui#13116)', () => {
  it('asks for a formula nameField no column shows, does not draw it, and the rows name each record', async () => {
    const { select } = await mount(contactDef, CONTACT_ROWS, ['first_name', 'last_name', 'title']);
    expect(select).toEqual(['first_name', 'full_name', 'id', 'last_name', 'title']);

    // Fetched, never drawn: the grid's columns are the authored three.
    const drawn = (lastGridProps?.columns ?? lastGridProps?.fields ?? []) as unknown[];
    expect(JSON.stringify(drawn)).not.toContain('full_name');

    // The confirm step's rule: the declared value when the row carries it.
    const rows = await gridRows();
    expect(rows.map((row) => recordDisplayValueAt(row, declaredNameField(contactDef)))).toEqual(['John Smith', 'Marcus Reed']);
    expect(rows.map((row) => getRecordDisplayName(contactDef, row))).toEqual(['John Smith', 'Marcus Reed']);
  });

  it('control: an object with no nameField sends the same $select as before', async () => {
    const { select } = await mount(noteDef, NOTE_ROWS, ['subject', 'body']);
    expect(select).toEqual(['body', 'id', 'subject']);
  });

  it('control: a nameField that is a column is sent once', async () => {
    const { raw } = await mount(contactDef, CONTACT_ROWS, ['full_name', 'title']);
    expect(raw.filter((f) => f === 'full_name')).toHaveLength(1);
    expect([...raw].sort()).toEqual(['full_name', 'id', 'title']);
  });
});
