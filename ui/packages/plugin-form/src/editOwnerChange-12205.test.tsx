/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An owner the user changes or clears in a record's Edit form is written; an
 * owner the user did not touch is not (objectui#12205).
 *
 * ## What the base commit did
 *
 * `sanitizeFormData` dropped `owner_id` from every form payload twice over: by
 * name (`SERVER_OWNED_FIELD_NAMES`) and, with a definition in hand, by the spec
 * `system` flag the registry stamps on it. An Edit dialog whose layout renders
 * the owner therefore offered a live input whose value never left the browser:
 * the user reassigned or cleared it, Save answered 200 and closed the dialog,
 * and the record kept its old owner. When the owner was the only change, the
 * dirty diff (objectui#10156) found nothing else and sent the whole unchanged
 * payload, which is exactly the request the card measured.
 *
 * ## The two failure directions, and the rows shaped around each
 *
 * - DROPPED (this card): a changed or cleared owner is not sent. The
 *   "is sent" rows assert the exact payload of a reassign and of a clear.
 * - ECHOED (objectui#10108): an UNCHANGED owner is sent back, and the platform,
 *   which cannot tell a round-trip from a transfer, refuses it with a 403 for
 *   every role without the transfer grant. The "is not sent" rows assert the
 *   owner's absence beside a control that proves the payload is not empty:
 *   another field's change, or the full payload of a save with no change.
 *
 * Only a change judged against the record the form READ may carry the owner.
 * With no such record (a create, a caller-supplied record, a record swap in
 * flight) nothing can prove the owner changed, so it stays off the wire as it
 * always has.
 *
 * The object definition below is the one the platform serves: `owner_id` is
 * the spec's `OWNER_FIELD_DEF` (`system: true`, `readonly: false`, "ownership
 * is transferable, so it stays editable in forms"), while the business-unit
 * and tenant anchors beside it are `readonly` and stay unwritable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, screen, act, cleanup } from '@testing-library/react';
import React from 'react';

import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererContext } from '@object-ui/react';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';
import { ObjectForm } from './ObjectForm';
import { MasterDetailForm } from './MasterDetailForm';
import { dirtyEditPayload, sanitizeFormData, snapshotLoadedRecord } from './sanitize';
import { formWritePayload } from './writePayload';

registerAllFields();
afterEach(cleanup);

const VERSION = '2026-10-12 00:00:00.000';

const CASE_SCHEMA = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    status: { type: 'text', label: 'Status' },
    owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user', required: false, readonly: false, system: true },
    owning_business_unit_id: {
      type: 'lookup', label: 'Owning Business Unit', reference: 'sys_business_unit', hidden: true, readonly: true, system: true,
    },
    organization_id: { type: 'lookup', label: 'Organization', reference: 'sys_organization', hidden: true, readonly: true, system: true },
    created_by: { type: 'lookup', label: 'Created By', reference: 'sys_user', readonly: true, system: true },
    updated_at: { type: 'datetime', label: 'Updated', readonly: true, system: true },
  },
};

/** The record exactly as `dataSource.findOne` returns it. */
const STORED = {
  id: 'c1',
  subject: 'Printer jam',
  status: 'open',
  owner_id: 'u1',
  owning_business_unit_id: 'bu1',
  organization_id: 'org1',
  created_by: 'u1',
  updated_at: VERSION,
};

/** What a save with nothing changed sends: the business columns, no owner. */
const STORED_BUSINESS = { subject: 'Printer jam', status: 'open' };

const USERS = [
  { id: 'u1', name: 'Ada Lovelace' },
  { id: 'u2', name: 'Grace Hopper' },
];

const USER_SCHEMA = { name: 'sys_user', nameField: 'name', fields: { name: { type: 'text', label: 'Name' } } };

function makeDS(update?: any) {
  return {
    getObjectSchema: vi.fn(async (objectName: string) => (objectName === 'sys_user' ? USER_SCHEMA : CASE_SCHEMA)),
    findOne: vi.fn(async (objectName: string, id: string) => {
      if (objectName === 'sys_user') {
        const u = USERS.find((x) => x.id === id);
        return u ? { ...u } : null;
      }
      return { ...STORED };
    }),
    find: vi.fn(async (objectName: string, params?: any) => {
      if (objectName !== 'sys_user') return { data: [], total: 0 };
      const wanted: unknown[] | undefined = params?.$filter?.id?.$in;
      const rows = wanted ? USERS.filter((u) => wanted.includes(u.id)) : USERS;
      return { data: rows.map((u) => ({ ...u })), total: rows.length };
    }),
    create: vi.fn(async (_o: string, d: any) => ({ id: 'n1', ...d })),
    update:
      update ??
      vi.fn(async (_o: string, _id: string, d: any, _opts?: { ifMatch?: string }) => ({ ...STORED, ...d })),
  };
}

/**
 * Mounted the way the console mounts a form: under the renderer context that
 * hands field widgets the data source, so the owner lookup labels its value.
 */
const mount = (ui: React.ReactElement, ds: unknown) =>
  render(<SchemaRendererContext.Provider value={{ dataSource: ds } as never}>{ui}</SchemaRendererContext.Provider>);

/** The layout the console's form view declares: the owner is a rendered member. */
const SECTIONS = [{ name: 'main', label: 'Main', fields: ['subject', 'status', 'owner_id'] }];

const editSchema = (extra: Record<string, unknown> = {}) =>
  ({
    type: 'object-form',
    objectName: 'crm_case',
    mode: 'edit',
    recordId: 'c1',
    open: true,
    sections: SECTIONS,
    ...extra,
  }) as any;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const input = (name: string) =>
  waitFor(() => {
    const el = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

const change = async (el: HTMLElement, value: string) => {
  await act(async () => {
    fireEvent.change(el, { target: { value } });
  });
};

/** The owner chip the stored value hydrates to — the record is on screen. */
const ownerShown = (label: string) =>
  waitFor(() => expect(screen.getByRole('button', { name: `Remove ${label}` })).toBeTruthy());

/** Reassign through the real lookup: open its dropdown and pick a user. */
async function pickOwner(label: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger-owner_id'));
  });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(2));
  const option = screen.getAllByRole('option').find((o) => (o.getAttribute('title') ?? o.textContent ?? '').includes(label));
  if (!option) throw new Error(`no option ${label}`);
  await act(async () => {
    fireEvent.click(option);
  });
  await settle();
}

/** Clear through the real lookup: the selected chip's remove control. */
async function clearOwner(label: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: `Remove ${label}` }));
  });
  await settle();
}

const submit = async () => {
  await act(async () => {
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
  });
  await settle();
};

describe('dirtyEditPayload — the owner rides an edit only when the user changed it (objectui#12205)', () => {
  const target = { mode: 'edit', objectName: 'crm_case', recordId: 'c1' };
  const snapshot = snapshotLoadedRecord(target, STORED);
  /** What every form passes: the values it holds, and the strip's own inputs. */
  const ownerFrom = (values: Record<string, unknown>, canEdit?: (f: string) => boolean) => ({
    values,
    objectSchema: CASE_SCHEMA,
    canEdit,
  });
  const save = (values: Record<string, unknown>, opts: { canEdit?: (f: string) => boolean; snap?: any; tgt?: any } = {}) => {
    const payload = sanitizeFormData(values, CASE_SCHEMA, { canEdit: opts.canEdit });
    const snap = 'snap' in opts ? opts.snap : snapshot;
    return dirtyEditPayload(payload, snap, opts.tgt ?? target, ownerFrom(values, opts.canEdit));
  };

  it('a reassigned owner is sent, and alone when it is the only change', () => {
    expect(save({ ...STORED, owner_id: 'u2' })).toEqual({ owner_id: 'u2' });
  });

  it('a cleared owner is sent as null', () => {
    expect(save({ ...STORED, owner_id: null })).toEqual({ owner_id: null });
  });

  it('an owner change rides beside the other changed fields', () => {
    expect(save({ ...STORED, subject: 'Printer fixed', owner_id: 'u2' })).toEqual({
      subject: 'Printer fixed',
      owner_id: 'u2',
    });
  });

  it('an untouched owner is not sent: beside another change, and in a save with nothing changed', () => {
    expect(save({ ...STORED, subject: 'Printer fixed' })).toEqual({ subject: 'Printer fixed' });
    // Control: the nothing-changed save still sends its full payload.
    expect(save({ ...STORED })).toEqual(STORED_BUSINESS);
  });

  it('an untouched EXPANDED owner is not sent either — it is the same value the record holds', () => {
    const expanded = { ...STORED, owner_id: { id: 'u1', name: 'Ada Lovelace' } };
    const snap = snapshotLoadedRecord(target, expanded);
    expect(save({ ...expanded, subject: 'Printer fixed' }, { snap })).toEqual({ subject: 'Printer fixed' });
  });

  it('with no record read for this edit, a changed owner stays off the wire (objectui#10108)', () => {
    const values = { ...STORED, subject: 'Printer fixed', owner_id: 'u2' };
    // No snapshot: everything else is sent, the owner is not.
    expect(save(values, { snap: null })).toEqual({ subject: 'Printer fixed', status: 'open' });
    // A snapshot read for another record (a swap in flight): the same.
    expect(save(values, { tgt: { ...target, recordId: 'c2' } })).toEqual({ subject: 'Printer fixed', status: 'open' });
  });

  it('a create never carries the owner, even against a matching snapshot', () => {
    expect(save({ ...STORED, owner_id: 'u2' }, { tgt: { ...target, mode: 'create' } })).toEqual(STORED_BUSINESS);
  });

  it('the caller\'s field-level security still refuses it', () => {
    const canEdit = (f: string) => f !== 'owner_id';
    expect(save({ ...STORED, subject: 'Printer fixed', owner_id: 'u2' }, { canEdit })).toEqual({
      subject: 'Printer fixed',
    });
  });

  it('an object that declares its owner readonly still refuses it', () => {
    const schema = { ...CASE_SCHEMA, fields: { ...CASE_SCHEMA.fields, owner_id: { ...CASE_SCHEMA.fields.owner_id, readonly: true } } };
    const values = { ...STORED, subject: 'Printer fixed', owner_id: 'u2' };
    const payload = sanitizeFormData(values, schema);
    expect(dirtyEditPayload(payload, snapshot, target, { values, objectSchema: schema })).toEqual({
      subject: 'Printer fixed',
    });
  });

  it('a value the form does not hold (undefined) is not a clear', () => {
    const values: Record<string, unknown> = { ...STORED, subject: 'Printer fixed', owner_id: undefined };
    expect(save(values)).toEqual({ subject: 'Printer fixed' });
  });

  it('the rest of the transfer-grant family and the audit columns stay refused even when they differ', () => {
    const values = {
      ...STORED,
      subject: 'Printer fixed',
      owning_business_unit_id: 'bu2',
      organization_id: 'org2',
      tenant_id: 't2',
      created_by: 'u2',
      updated_at: '2026-10-13 00:00:00.000',
    };
    expect(save(values)).toEqual({ subject: 'Printer fixed' });
  });

  it('without the owner source, the diff is what it always was', () => {
    const values = { ...STORED, owner_id: 'u2' };
    const payload = sanitizeFormData(values, CASE_SCHEMA);
    expect(dirtyEditPayload(payload, snapshot, target)).toBe(payload);
  });
});

describe('formWritePayload — the layouts ObjectForm routes to (objectui#12205)', () => {
  const form = { mode: 'edit', objectName: 'crm_case', recordId: 'c1' };
  const snapshot = snapshotLoadedRecord(form, STORED);

  it('writes a changed owner; `payload` (the record as held, stripped) never carries it', () => {
    const { payload, writePayload } = formWritePayload({ ...STORED, owner_id: 'u2' }, form, {
      objectSchema: CASE_SCHEMA,
      canEdit: undefined,
      snapshot,
      createBaseline: null,
    });
    expect(writePayload).toEqual({ owner_id: 'u2' });
    expect(payload).toEqual(STORED_BUSINESS);
  });

  it('does not write an untouched one', () => {
    const { writePayload } = formWritePayload({ ...STORED, status: 'closed' }, form, {
      objectSchema: CASE_SCHEMA,
      canEdit: undefined,
      snapshot,
      createBaseline: null,
    });
    expect(writePayload).toEqual({ status: 'closed' });
  });

  it('inline members keep the roster-only strip, and the owner rule with it', () => {
    const inline = { ...form, customFields: [{ name: 'subject', type: 'text' }] };
    const { writePayload } = formWritePayload({ ...STORED, owner_id: null }, inline, {
      objectSchema: CASE_SCHEMA,
      canEdit: undefined,
      snapshot,
      createBaseline: null,
    });
    expect(writePayload).toEqual({ owner_id: null });
  });
});

describe.each([
  ['ModalForm (the console\'s Edit dialog)', ModalForm],
  ['DrawerForm', DrawerForm],
])('%s — edit', (_label, Form: any) => {
  it('a reassigned owner is sent, with the OCC token it read', async () => {
    const ds = makeDS();
    mount(<Form schema={editSchema({ formType: Form === ModalForm ? 'modal' : 'drawer' })} dataSource={ds as any} />, ds);
    await ownerShown('Ada Lovelace');

    await pickOwner('Grace Hopper');
    await submit();

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('crm_case', 'c1', { owner_id: 'u2' }, { ifMatch: VERSION });
  });

  it('a cleared owner is sent as null', async () => {
    const ds = makeDS();
    mount(<Form schema={editSchema({ formType: Form === ModalForm ? 'modal' : 'drawer' })} dataSource={ds as any} />, ds);
    await ownerShown('Ada Lovelace');

    await clearOwner('Ada Lovelace');
    await submit();

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('crm_case', 'c1', { owner_id: null }, { ifMatch: VERSION });
  });

  it('an untouched owner is not sent beside another change', async () => {
    const ds = makeDS();
    mount(<Form schema={editSchema({ formType: Form === ModalForm ? 'modal' : 'drawer' })} dataSource={ds as any} />, ds);
    await ownerShown('Ada Lovelace');

    await change(await input('subject'), 'Printer fixed');
    await submit();

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('crm_case', 'c1', { subject: 'Printer fixed' }, { ifMatch: VERSION });
  });

  it('an untouched owner is not sent by a save with nothing changed', async () => {
    const ds = makeDS();
    mount(<Form schema={editSchema({ formType: Form === ModalForm ? 'modal' : 'drawer' })} dataSource={ds as any} />, ds);
    await ownerShown('Ada Lovelace');

    await submit();

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('crm_case', 'c1', STORED_BUSINESS, { ifMatch: VERSION });
  });
});

describe('ModalForm — the server stays the authority (objectui#12205)', () => {
  it('a refused owner change surfaces as the form\'s error, and the dialog stays open', async () => {
    const refusal = Object.assign(new Error("'owner_id' is system-managed"), { httpStatus: 403, code: 'FORBIDDEN' });
    const update = vi.fn().mockRejectedValue(refusal);
    const ds = makeDS(update);
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    mount(<ModalForm schema={editSchema({ formType: 'modal', onSuccess, onOpenChange })} dataSource={ds as any} />, ds);
    await ownerShown('Ada Lovelace');

    await pickOwner('Grace Hopper');
    await submit();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2]).toEqual({ owner_id: 'u2' });
    expect(await screen.findAllByText("You don't have permission to save this record.")).not.toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('an auto-laid-out dialog still renders no owner, and so never writes one', async () => {
    const ds = makeDS();
    mount(<ModalForm schema={editSchema({ formType: 'modal', sections: undefined })} dataSource={ds as any} />, ds);

    await change(await input('subject'), 'Printer fixed');
    expect(screen.queryByTestId('lookup-trigger-owner_id')).toBeNull();
    await submit();

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ subject: 'Printer fixed' });
  });
});

describe('ObjectForm simple — the page-mode Edit (objectui#12205)', () => {
  const schema = () =>
    ({ type: 'object-form', objectName: 'crm_case', mode: 'edit', recordId: 'c1', sections: SECTIONS }) as any;

  it('a reassigned owner is sent', async () => {
    const ds = makeDS();
    mount(<ObjectForm schema={schema()} dataSource={ds as any} />, ds);
    await ownerShown('Ada Lovelace');

    await pickOwner('Grace Hopper');
    await submit();

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('crm_case', 'c1', { owner_id: 'u2' }, { ifMatch: VERSION });
  });

  it('an untouched owner is not sent', async () => {
    const ds = makeDS();
    mount(<ObjectForm schema={schema()} dataSource={ds as any} />, ds);
    await ownerShown('Ada Lovelace');

    await change(await input('subject'), 'Printer fixed');
    await submit();

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('crm_case', 'c1', { subject: 'Printer fixed' }, { ifMatch: VERSION });
  });
});

describe('master-detail — an untouched owner stays off every operation of the batch (objectui#10108)', () => {
  const LINE_SCHEMA = {
    name: 'crm_case_line',
    fields: {
      case: { type: 'master_detail', label: 'Case', reference: 'crm_case' },
      qty: { type: 'number', label: 'Qty' },
      owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user', readonly: false, system: true },
    },
  };
  const LINES = [
    { id: 'l1', case: 'c1', qty: 1, owner_id: 'u1' },
    { id: 'l2', case: 'c1', qty: 2, owner_id: 'u1' },
  ];

  it('the header renders the owner, a header field changes, and no operation carries owner_id', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'c1' }, { id: 'l1' }] });
    const base = makeDS();
    const ds: any = {
      ...base,
      getObjectSchema: vi.fn(async (o: string) => (o === 'crm_case_line' ? LINE_SCHEMA : o === 'sys_user' ? USER_SCHEMA : CASE_SCHEMA)),
      find: vi.fn(async (o: string, params?: any) => (o === 'crm_case_line' ? { data: LINES.map((l) => ({ ...l })) } : base.find(o, params))),
      delete: vi.fn(),
      batchTransaction,
    };
    const { container } = mount(
      <MasterDetailForm
        schema={{
          objectName: 'crm_case',
          mode: 'edit',
          recordId: 'c1',
          sections: SECTIONS,
          details: [{ childObject: 'crm_case_line', relationshipField: 'case', columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any] }],
        } as any}
        dataSource={ds}
      />,
      ds,
    );
    await ownerShown('Ada Lovelace');
    await waitFor(() => {
      if (!container.querySelector('input[name="subject"]')) throw new Error('header not ready');
    });
    await change(container.querySelector('input[name="subject"]') as HTMLInputElement, 'Printer fixed');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    const ops = batchTransaction.mock.calls[0][0];
    for (const op of ops) expect(op.data ?? {}).not.toHaveProperty('owner_id');
    // Control: the header's change is on the wire.
    expect(ops[0]).toEqual({ object: 'crm_case', action: 'update', id: 'c1', data: { subject: 'Printer fixed' } });
  });
});
