/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27138 — the record edit dialog asks the server whether THIS row
 * is writable, and does not offer an edit the write gate refuses whole.
 *
 * The persona may read and edit `rfa_contract` (the object grant allows edit)
 * and every field is editable at field level; the record is a `public_read`
 * row shared to them for reading only, so the server's record projection
 * answers `writable: false`. Before this card the dialog drew every field live
 * and a Save the server refused as a whole.
 *
 * Rows, for the console's edit dialog (`ModalForm`, as `AppContent` mounts it)
 * and for `DrawerForm`:
 *   - `writable: false` → every field read-only, the record's notice, no Save;
 *   - CONTROL `writable: true` → the `editable` fields stay live, Save offered;
 *   - CONTROL no `writable` key (an older server) → as before;
 *   - an object grant that refuses edit keeps the object's own notice.
 * And for the dialog, the host's approval lock (`lockedBy: 'approval'`, what
 * `AppContent` passes for a record a pending approval locks) → read-only, the
 * record page's lock sentence, no Save — on a data source without the record
 * projection too.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { MePermissionsProvider } from '@object-ui/permissions';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';

registerAllFields();
afterEach(cleanup);

const FIELDS = {
  title: { type: 'text', label: 'Title' },
  summary: { type: 'text', label: 'Summary' },
};

const principal = (allowEdit: boolean): any => ({
  authenticated: true,
  userId: 'u-1',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['rfa_fixture_member'],
  objects: { rfa_contract: { allowCreate: true, allowRead: true, allowEdit, allowDelete: false } },
  fields: {},
});

const RECORD = { id: 'c1', title: 'MSA', summary: 'Shared for reading' };
const PROJECTION = { object: 'rfa_contract', recordId: 'c1', readable: ['id', 'title', 'summary'], editable: ['title', 'summary'] };

function makeDS(access: Record<string, unknown> | null) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'rfa_contract', label: 'Contract', fields: FIELDS }),
    findOne: vi.fn().mockResolvedValue({ ...RECORD }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    update: vi.fn().mockResolvedValue({ ...RECORD }),
    ...(access ? { getRecordFieldAccess: vi.fn().mockResolvedValue(access) } : {}),
  };
}

const schema = (formType: 'modal' | 'drawer') => ({
  type: 'object-form',
  formType,
  objectName: 'rfa_contract',
  mode: 'edit',
  recordId: 'c1',
  fields: Object.keys(FIELDS),
  open: true,
}) as any;

const CONTAINERS: Array<{ container: string; mount: (ds: any, lockedBy?: 'approval') => React.ReactElement }> = [
  {
    container: "the console's edit dialog (ModalForm)",
    mount: (ds, lockedBy) => <ModalForm schema={schema('modal')} dataSource={ds} lockedBy={lockedBy} />,
  },
  {
    container: 'the drawer (DrawerForm)',
    mount: (ds) => <DrawerForm schema={schema('drawer')} dataSource={ds} />,
  },
];

/** Every drawn field → `true` when it kept no enabled control. Read off `document.body`: the overlays portal out. */
function locked(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of document.body.querySelectorAll('[data-field]')) {
    const name = item.getAttribute('data-field') as string;
    out[name] = item.querySelector('input:not([disabled]), textarea:not([disabled])') === null;
  }
  return out;
}

const saveButtons = () => document.body.querySelectorAll('button[type="submit"]').length;
const notice = () => document.body.querySelector('[data-testid="closed-affordance-notice"]');

async function drawn() {
  await waitFor(() => {
    const el = document.querySelector('input[name="title"]') as HTMLInputElement | null;
    if (!el || el.value !== 'MSA') throw new Error('record not on screen yet');
  });
}

describe.each(CONTAINERS)('[#27138] $container', ({ mount }) => {
  it('on a row the caller may read but not write, the record is drawn read-only with its reason and no Save', async () => {
    const ds = makeDS({ ...PROJECTION, writable: false });
    render(<MePermissionsProvider initialPermissions={principal(true)}>{mount(ds)}</MePermissionsProvider>);
    await drawn();
    await waitFor(() => expect(locked()).toEqual({ title: true, summary: true }));
    expect(ds.getRecordFieldAccess).toHaveBeenCalledWith('rfa_contract', 'c1');
    expect(notice()?.getAttribute('data-affordance')).toBe('record');
    expect(notice()?.textContent).toBe("You don't have permission to edit this record. The fields are read-only.");
    expect(saveButtons()).toBe(0);
  });

  it.each([
    ['writable: true', { ...PROJECTION, writable: true }],
    ['no writable key (an older server)', PROJECTION],
  ])('CONTROL — %s keeps the editable fields live and offers Save', async (_label, access) => {
    const ds = makeDS(access);
    render(<MePermissionsProvider initialPermissions={principal(true)}>{mount(ds)}</MePermissionsProvider>);
    await drawn();
    await waitFor(() => expect(ds.getRecordFieldAccess).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(locked()).toEqual({ title: false, summary: false });
    expect(notice()).toBeNull();
    expect(saveButtons()).toBe(1);
  });

  it("an object grant that refuses edit keeps the object's own notice", async () => {
    const ds = makeDS({ ...PROJECTION, writable: false });
    render(<MePermissionsProvider initialPermissions={principal(false)}>{mount(ds)}</MePermissionsProvider>);
    await drawn();
    await waitFor(() => expect(ds.getRecordFieldAccess).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(locked()).toEqual({ title: true, summary: true });
    expect(notice()?.getAttribute('data-affordance')).toBe('edit');
  });
});

describe("[#27138] the console's edit dialog under the host's approval lock", () => {
  it.each([
    ['a writable row', { ...PROJECTION, writable: true }],
    ['a data source without the record projection', null],
  ])('on %s, a record a pending approval locks is drawn read-only with the lock sentence and no Save', async (_label, access) => {
    const ds = makeDS(access);
    render(
      <MePermissionsProvider initialPermissions={principal(true)}>
        <ModalForm schema={schema('modal')} dataSource={ds as any} lockedBy="approval" />
      </MePermissionsProvider>,
    );
    await drawn();
    await waitFor(() => expect(locked()).toEqual({ title: true, summary: true }));
    expect(notice()?.getAttribute('data-affordance')).toBe('approval');
    expect(notice()?.textContent).toBe('This record has a pending approval request; editing is locked');
    expect(saveButtons()).toBe(0);
  });
});
