/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26594 (ruling B) — the record form's edit dialog asks the server
 * for THIS record's field projection and disables only what that answer locks.
 *
 * The persona is the contract app's finance role: `summary` is locked from
 * `approved` onward (`FieldPermissionSchema.when`). `/auth/me/permissions`
 * holds no row, so it serves that entry as its lock, and before this card the
 * dialog disabled `summary` on the draft the server lets the caller save.
 * `ref_no` is locked on every row: the control that a lock the server keeps
 * stays locked.
 *
 * Rows, each for the console's edit dialog (`ModalForm` rendered directly, the
 * way `AppContent` mounts it) and for `ObjectForm`'s edit page:
 *   - a draft the server unlocks → `summary` drawn live, `ref_no` locked, and
 *     the save sends `summary` (the outbound gate reads the same answer);
 *   - an approved row → both locked, the save withholds both;
 * and the controls:
 *   - a create form holds no stored row and asks nothing;
 *   - a data source without the method keeps the row-blind lock.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';

import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { ModalForm } from './ModalForm';

registerAllFields();
afterEach(cleanup);

const FIELDS = {
  title: { type: 'text', label: 'Title' },
  summary: { type: 'text', label: 'Summary' },
  ref_no: { type: 'text', label: 'Reference number' },
};

const PRINCIPAL: any = {
  authenticated: true,
  userId: 'u-1',
  tenantId: null,
  roles: ['finance'],
  permissionSets: ['rfa_fixture_member'],
  objects: { rfa_contract: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false } },
  // As `/auth/me/permissions` serves them: the conditioned entry as its lock.
  fields: {
    'rfa_contract.summary': { readable: true, editable: false },
    'rfa_contract.ref_no': { readable: true, editable: false },
  },
};

const ROWS = {
  draft: {
    record: { id: 'c1', title: 'MSA', summary: 'Draft terms', ref_no: 'R-1' },
    access: { object: 'rfa_contract', recordId: 'c1', readable: ['id', 'title', 'summary', 'ref_no'], editable: ['title', 'summary'] },
  },
  approved: {
    record: { id: 'c1', title: 'MSA', summary: 'Final terms', ref_no: 'R-1' },
    access: { object: 'rfa_contract', recordId: 'c1', readable: ['id', 'title', 'summary', 'ref_no'], editable: ['title'] },
  },
};

function makeDS(row: (typeof ROWS)[keyof typeof ROWS], withMethod = true) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'rfa_contract', fields: FIELDS }),
    findOne: vi.fn().mockResolvedValue({ ...row.record }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn().mockResolvedValue({ ...row.record }),
    update: vi.fn().mockImplementation(async (_o: string, _id: string, data: any) => ({ ...row.record, ...data })),
    ...(withMethod ? { getRecordFieldAccess: vi.fn().mockResolvedValue(row.access) } : {}),
  };
}

/** Every drawn field → `true` when it kept no enabled control. Read off `document.body`: the modal portals out. */
function locked(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of document.body.querySelectorAll('[data-field]')) {
    const name = item.getAttribute('data-field') as string;
    out[name] = item.querySelector('input:not([disabled]), textarea:not([disabled])') === null;
  }
  return out;
}

const CONTAINERS: Array<{ container: string; mount: (ds: any, mode: 'edit' | 'create') => React.ReactElement }> = [
  {
    container: "the console's edit dialog (ModalForm)",
    mount: (ds, mode) => (
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'rfa_contract',
          mode,
          ...(mode === 'edit' ? { recordId: 'c1' } : {}),
          fields: Object.keys(FIELDS),
          open: true,
        } as any}
        dataSource={ds}
      />
    ),
  },
  {
    container: 'the edit page (ObjectForm)',
    mount: (ds, mode) => (
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'rfa_contract',
          mode,
          ...(mode === 'edit' ? { recordId: 'c1' } : {}),
          fields: Object.keys(FIELDS),
        } as any}
        dataSource={ds}
      />
    ),
  },
];

async function drawn(mode: 'edit' | 'create') {
  await waitFor(() => {
    const el = document.querySelector('input[name="title"]') as HTMLInputElement | null;
    if (!el) throw new Error('form not drawn yet');
    if (mode === 'edit' && el.value !== 'MSA') throw new Error('record not on screen yet');
  });
}

describe.each(CONTAINERS)('[#26594] $container', ({ mount }) => {
  it("on a draft the server unlocks, the conditioned field is live and the unconditioned lock holds", async () => {
    const ds = makeDS(ROWS.draft);
    render(<MePermissionsProvider initialPermissions={PRINCIPAL}>{mount(ds, 'edit')}</MePermissionsProvider>);
    await drawn('edit');
    await waitFor(() => expect(locked()).toEqual({ title: false, summary: false, ref_no: true }));
    expect(ds.getRecordFieldAccess).toHaveBeenCalledWith('rfa_contract', 'c1');
    expect(ds.getRecordFieldAccess).toHaveBeenCalledTimes(1);
  });

  it('the save sends what the record answer leaves writable, and withholds what it locks', async () => {
    const ds = makeDS(ROWS.draft);
    render(<MePermissionsProvider initialPermissions={PRINCIPAL}>{mount(ds, 'edit')}</MePermissionsProvider>);
    await drawn('edit');
    await waitFor(() => expect(locked().summary).toBe(false));
    const summary = document.querySelector('input[name="summary"]') as HTMLInputElement;
    fireEvent.change(summary, { target: { value: 'Revised terms' } });
    const form = document.body.querySelector('form') as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });
    await waitFor(() => expect(ds.update).toHaveBeenCalled());
    const sent = ds.update.mock.calls[0][2];
    expect(sent.summary).toBe('Revised terms');
    expect(sent).not.toHaveProperty('ref_no');
  });

  it('on a row the condition names, the field stays locked', async () => {
    const ds = makeDS(ROWS.approved);
    render(<MePermissionsProvider initialPermissions={PRINCIPAL}>{mount(ds, 'edit')}</MePermissionsProvider>);
    await drawn('edit');
    await waitFor(() => expect(ds.getRecordFieldAccess).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(locked()).toEqual({ title: false, summary: true, ref_no: true });
  });

  it('a create form holds no stored row and asks nothing', async () => {
    const ds = makeDS(ROWS.draft);
    render(<MePermissionsProvider initialPermissions={PRINCIPAL}>{mount(ds, 'create')}</MePermissionsProvider>);
    await drawn('create');
    expect(ds.getRecordFieldAccess).not.toHaveBeenCalled();
    expect(locked()).toEqual({ title: false, summary: true, ref_no: true });
  });

  it('a data source without the method keeps the row-blind lock', async () => {
    const ds = makeDS(ROWS.draft, false);
    render(<MePermissionsProvider initialPermissions={PRINCIPAL}>{mount(ds, 'edit')}</MePermissionsProvider>);
    await drawn('edit');
    expect(locked()).toEqual({ title: false, summary: true, ref_no: true });
  });
});
