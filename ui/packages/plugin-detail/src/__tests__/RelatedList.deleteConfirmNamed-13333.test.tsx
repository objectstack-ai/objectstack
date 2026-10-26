/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13333 — the related list's row Delete asks a sentence that names
 * the row by its title, the ONE ADR-0079 resolver (`getRecordDisplayName`)
 * over the list's object schema, instead of "Are you sure you want to delete
 * this record?". A grant row (a user's permission-set assignment) declares a
 * `nameField` formula that names the grant and its user, so the sentence says
 * which grant goes and from whom.
 *
 * The data-table is captured rather than rendered (as
 * `RelatedList.rowactions.test.tsx` does): the case drives the row Delete the
 * list hands the table, then reads the in-app AlertDialog the list draws.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

const nativeConfirm = vi.fn(() => true);
beforeEach(() => {
  h.schema = null;
  nativeConfirm.mockClear();
  vi.stubGlobal('confirm', nativeConfirm);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(nativeConfirm).not.toHaveBeenCalled();
});

/** The grant junction object as its schema declares it: a `nameField` formula. */
const GRANT_SCHEMA = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  nameField: 'display_title',
  fields: {
    display_title: { name: 'display_title', type: 'formula', label: 'Title' },
    permission_set: { name: 'permission_set', type: 'text', label: 'Permission Set' },
  },
};

function grantDataSource() {
  return {
    getObjectSchema: vi.fn(async () => GRANT_SCHEMA),
    find: vi.fn(async () => ({ data: [] })),
  } as any;
}

async function openDelete(props: Partial<React.ComponentProps<typeof RelatedList>>, row: any) {
  render(
    <RelatedList
      title="Permission Sets"
      type="table"
      columns={[{ accessorKey: 'permission_set', header: 'Permission Set' }]}
      {...(props as any)}
    />,
  );
  await waitFor(() => expect(typeof h.schema?.onRowDelete).toBe('function'));
  act(() => {
    h.schema.onRowDelete(row);
  });
  return await screen.findByRole('alertdialog');
}

describe('RelatedList — the row delete confirm names the row (objectui#13333)', () => {
  it('a grant row is named by its declared title, which names the grant and its user', async () => {
    const row = { id: 'g1', display_title: 'Ada Lovelace → sales_manager', permission_set: 'sales_manager' };
    const onRowDelete = vi.fn();
    const dialog = await openDelete(
      { api: 'sys_user_permission_set', objectName: 'sys_user_permission_set', dataSource: grantDataSource(), data: [row], onRowDelete },
      row,
    );
    await waitFor(() =>
      expect(dialog.textContent).toContain('Are you sure you want to delete "Ada Lovelace → sales_manager"?'),
    );
    expect(dialog.textContent).not.toContain('delete this record');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onRowDelete).toHaveBeenCalledWith(row));
  });

  it('with no object schema, the resolver still reads the row`s own name', async () => {
    const row = { id: 'c1', name: 'Alice' };
    const dialog = await openDelete(
      { api: 'contact', objectName: 'contact', data: [row], onRowDelete: vi.fn() },
      row,
    );
    expect(dialog.textContent).toContain('Are you sure you want to delete "Alice"?');
  });

  it('CONTROL: Cancel deletes nothing', async () => {
    const row = { id: 'c1', name: 'Alice' };
    const onRowDelete = vi.fn();
    const dialog = await openDelete({ api: 'contact', objectName: 'contact', data: [row], onRowDelete }, row);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onRowDelete).not.toHaveBeenCalled();
  });
});
