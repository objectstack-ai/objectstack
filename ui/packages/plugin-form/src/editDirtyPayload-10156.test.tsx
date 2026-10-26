/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An edit save writes only the fields that differ from the record the form
 * read (objectui#10156).
 *
 * ## The risk these rows are shaped around
 *
 * This is the most-used write path in the product, and the defect a dirty diff
 * can introduce is silent: a field wrongly judged CLEAN is not sent, the server
 * answers 200, and the user's edit is gone. So the rows come in two kinds, and
 * they fail for opposite reasons:
 *
 * - "only that field" rows assert the EXACT payload. They go red if the diff
 *   stops filtering.
 * - "is sent" rows (type drift, a field the form moved itself) assert only
 *   that a field IS on the payload. They go red if the diff drops something it
 *   could not prove unchanged, and they stay green when the diff sends too much.
 *
 * Every component row drives a real renderer with real widgets, so the drift
 * is the drift a user produces: retyping `5` into a number input whose stored
 * value arrived as the string `'5'`, or typing into a textarea whose stored
 * value is `null` and clearing it again.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';

import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { MasterDetailForm } from './MasterDetailForm';
import {
  dirtyEditPayload,
  isSameStoredValue,
  snapshotLoadedRecord,
  advanceLoadedRecord,
} from './sanitize';

registerAllFields();

const VERSION = '2026-09-25 00:00:00.000';
const NEWER_VERSION = '2026-09-25 00:05:00.000';

const DEAL_SCHEMA = {
  name: 'deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    qty: { type: 'number', label: 'Qty' },
    remark: { type: 'textarea', label: 'Remark' },
    stage: { type: 'text', label: 'Stage' },
    amount: { type: 'currency', label: 'Amount' },
    owner_id: { type: 'lookup', label: 'Owner', system: true },
    updated_at: { type: 'datetime', label: 'Updated', system: true },
  },
};

/**
 * The record as the server returns it. `qty` arrives as a numeric STRING, the
 * way a decimal column often does, and `remark` as `null`.
 */
const STORED = {
  id: 'd1',
  name: 'Mine',
  qty: '5',
  remark: null,
  stage: 'open',
  amount: 10.5,
  owner_id: 'u9',
  updated_at: VERSION,
};

/** What `sanitizeFormData` keeps of {@link STORED}: every business column. */
const STORED_BUSINESS = { name: 'Mine', qty: '5', remark: null, stage: 'open', amount: 10.5 };

const conflictError = () =>
  Object.assign(new Error('Record was modified by another user'), {
    code: 'CONCURRENT_UPDATE',
    httpStatus: 409,
    currentVersion: NEWER_VERSION,
  });

function makeDS(update?: any) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(DEAL_SCHEMA),
    findOne: vi.fn().mockResolvedValue({ ...STORED }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async (_o: string, d: any) => ({ id: 'new1', ...d })),
    update:
      update ??
      vi.fn(async (_o: string, _id: string, d: any, _opts?: { ifMatch?: string }) => ({
        ...STORED,
        ...d,
      })),
  };
}

const fieldEl = (root: HTMLElement, tag: 'input' | 'textarea', name: string) =>
  waitFor(() => {
    const el = root.querySelector(`${tag}[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

const change = async (el: HTMLElement, value: string) => {
  await act(async () => {
    fireEvent.change(el, { target: { value } });
  });
};

const submit = async (root: HTMLElement) => {
  await act(async () => {
    fireEvent.submit(root.querySelector('form') as HTMLFormElement);
  });
};

const editSchema = (extra: Record<string, unknown> = {}) =>
  ({ type: 'object-form', objectName: 'deal', mode: 'edit', recordId: 'd1', ...extra }) as any;

describe('the one comparison — every pair the rule states', () => {
  const t = Date.UTC(2026, 0, 2);
  const rows: Array<{ label: string; a: unknown; b: unknown; same: boolean }> = [
    { label: 'the same string', a: 'x', b: 'x', same: true },
    { label: 'null and undefined (one blank)', a: null, b: undefined, same: true },
    { label: 'null and an empty string', a: null, b: '', same: false },
    { label: 'undefined and an empty string', a: undefined, b: '', same: false },
    { label: 'a number and its numeric string', a: 1, b: '1', same: false },
    { label: 'a lookup id and its expanded object', a: 'a1', b: { id: 'a1', name: 'Acme' }, same: false },
    { label: 'two identical expanded lookups', a: { id: 'a1' }, b: { id: 'a1' }, same: true },
    { label: 'an object with its keys reordered', a: { a: 1, b: 2 }, b: { b: 2, a: 1 }, same: false },
    { label: 'an array reordered', a: ['x', 'y'], b: ['y', 'x'], same: false },
    { label: 'two identical arrays', a: ['x'], b: ['x'], same: true },
    { label: 'two Dates holding the same time', a: new Date(t), b: new Date(t), same: true },
    { label: 'a Date and its ISO string', a: new Date(t), b: new Date(t).toISOString(), same: false },
    { label: 'two date strings in different formats', a: '2026-01-02', b: '2026-01-02T00:00:00Z', same: false },
    { label: 'NaN against itself', a: NaN, b: NaN, same: false },
  ];

  it.each(rows)('$label → same: $same', ({ a, b, same }) => {
    expect(isSameStoredValue(a, b)).toBe(same);
    expect(isSameStoredValue(b, a)).toBe(same);
  });
});

describe('dirtyEditPayload — what an edit writes', () => {
  const target = { mode: 'edit', objectName: 'deal', recordId: 'd1' };
  const snapshot = snapshotLoadedRecord(target, STORED);

  it('writes the changed fields only', () => {
    const payload = { ...STORED_BUSINESS, name: 'Mine v2' };
    expect(dirtyEditPayload(payload, snapshot, target)).toEqual({ name: 'Mine v2' });
  });

  it('sends every field it cannot prove unchanged: 5 over "5", "" over null, an id over an expanded lookup', () => {
    const snap = snapshotLoadedRecord(target, { ...STORED, account: { id: 'a1', name: 'Acme' } });
    const payload = { ...STORED_BUSINESS, qty: 5, remark: '', account: 'a1' };
    expect(dirtyEditPayload(payload, snap, target)).toEqual({ qty: 5, remark: '', account: 'a1' });
  });

  it('an empty diff sends the payload it was given, unchanged', () => {
    const payload = { ...STORED_BUSINESS };
    expect(dirtyEditPayload(payload, snapshot, target)).toBe(payload);
  });

  it('no snapshot, or one read for another record or object, sends everything', () => {
    const payload = { ...STORED_BUSINESS, name: 'Mine v2' };
    expect(dirtyEditPayload(payload, null, target)).toBe(payload);
    expect(dirtyEditPayload(payload, snapshot, { ...target, recordId: 'd2' })).toBe(payload);
    expect(dirtyEditPayload(payload, snapshot, { ...target, objectName: 'lead' })).toBe(payload);
  });

  it('a create never diffs, even against a matching snapshot', () => {
    const payload = { ...STORED_BUSINESS };
    expect(dirtyEditPayload(payload, snapshot, { ...target, mode: 'create' })).toBe(payload);
  });

  it('after a save the baseline carries what was written, and only for its own record', () => {
    const advanced = advanceLoadedRecord(snapshot, target, { name: 'Mine v2' });
    expect(advanced?.record).toMatchObject({ name: 'Mine v2', stage: 'open' });
    expect(advanceLoadedRecord(snapshot, { ...target, recordId: 'd2' }, { name: 'x' })).toBe(snapshot);
  });
});

describe('ObjectForm edit — the plain record PATCH', () => {
  it('changing one field sends only that field — nothing server-managed — with the OCC token it read', async () => {
    const ds = makeDS();
    const { container } = render(<ObjectForm schema={editSchema()} dataSource={ds as any} />);

    await change(await fieldEl(container, 'input', 'name'), 'Mine v2');
    await submit(container);

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('deal', 'd1', { name: 'Mine v2' }, { ifMatch: VERSION });
  });

  it('type drift is sent: a retyped 5 over the stored "5", and "" over the stored null', async () => {
    const ds = makeDS();
    const { container } = render(<ObjectForm schema={editSchema()} dataSource={ds as any} />);

    await change(await fieldEl(container, 'input', 'name'), 'Mine v2');
    const qty = await fieldEl(container, 'input', 'qty');
    await change(qty, '6');
    await change(qty, '5');
    const remark = await fieldEl(container, 'textarea', 'remark');
    await change(remark, 'x');
    await change(remark, '');
    await submit(container);

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    const payload = ds.update.mock.calls[0][2];
    // Preconditions that make these rows a TYPE drift, not a value change.
    expect(STORED.qty).toBe('5');
    expect(STORED.remark).toBeNull();
    expect(payload).toHaveProperty('qty', 5);
    expect(payload).toHaveProperty('remark', '');
    expect(payload).toHaveProperty('name', 'Mine v2');
  });

  it('a save with nothing changed is the request it has always been: the full sanitized payload', async () => {
    const onSuccess = vi.fn();
    const ds = makeDS();
    const { container } = render(<ObjectForm schema={editSchema({ onSuccess })} dataSource={ds as any} />);

    await fieldEl(container, 'input', 'name');
    await submit(container);

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('deal', 'd1', STORED_BUSINESS, { ifMatch: VERSION });
    // Success is the server's answer to a request that was made.
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' })));
  });

  it('a second save from the same mounted form diffs against what the first save wrote', async () => {
    const ds = makeDS();
    const { container } = render(<ObjectForm schema={editSchema()} dataSource={ds as any} />);

    const name = await fieldEl(container, 'input', 'name');
    await change(name, 'Mine v2');
    await submit(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ name: 'Mine v2' });

    // Back to the value FIRST read, plus a second change. Against the first
    // read, `name` would compare clean and be dropped while the server holds
    // 'Mine v2'.
    await change(await fieldEl(container, 'input', 'name'), 'Mine');
    await change(await fieldEl(container, 'input', 'stage'), 'won');
    await submit(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    expect(ds.update.mock.calls[1][2]).toEqual({ name: 'Mine', stage: 'won' });
  });

  it('"Overwrite" after a 409 re-sends the changed fields only, re-keyed to the server version', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(conflictError())
      .mockImplementation(async (_o: string, _id: string, d: any) => ({ ...STORED, ...d }));
    const ds = makeDS(update);
    const { container } = render(<ObjectForm schema={editSchema()} dataSource={ds as any} />);

    await change(await fieldEl(container, 'input', 'name'), 'Mine v2');
    await submit(container);
    fireEvent.click(await screen.findByText('Overwrite'));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenNthCalledWith(1, 'deal', 'd1', { name: 'Mine v2' }, { ifMatch: VERSION });
    expect(update).toHaveBeenNthCalledWith(2, 'deal', 'd1', { name: 'Mine v2' }, { ifMatch: NEWER_VERSION });
  });

  it('CREATE is unchanged (control): a seeded value the user never touched is still posted', async () => {
    const ds = makeDS();
    const { container } = render(
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'deal',
          mode: 'create',
          initialValues: { name: 'Seed', stage: 'open' },
        } as any}
        dataSource={ds as any}
      />,
    );

    await change(await fieldEl(container, 'input', 'name'), 'New deal');
    await submit(container);

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.update).not.toHaveBeenCalled();
    expect(ds.findOne).not.toHaveBeenCalled();
    expect(ds.create.mock.calls[0][1]).toMatchObject({ name: 'New deal', stage: 'open' });
  });
});

describe.each([
  ['modal', 'ModalForm'],
  ['drawer', 'DrawerForm'],
])('ObjectForm formType %s (%s) edit', (formType) => {
  it('changing one field sends only that field, with the OCC token it read', async () => {
    const ds = makeDS();
    const { baseElement } = render(
      <ObjectForm schema={editSchema({ formType, open: true })} dataSource={ds as any} />,
    );

    await change(await fieldEl(baseElement, 'input', 'name'), 'Mine v2');
    await submit(baseElement);

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('deal', 'd1', { name: 'Mine v2' }, { ifMatch: VERSION });
  });

  it('type drift is sent: a retyped 5 over the stored "5"', async () => {
    const ds = makeDS();
    const { baseElement } = render(
      <ObjectForm schema={editSchema({ formType, open: true })} dataSource={ds as any} />,
    );

    await change(await fieldEl(baseElement, 'input', 'name'), 'Mine v2');
    const qty = await fieldEl(baseElement, 'input', 'qty');
    await change(qty, '6');
    await change(qty, '5');
    await submit(baseElement);

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toHaveProperty('qty', 5);
  });
});

describe('master-detail — the parent operation', () => {
  const PO_SCHEMA = {
    name: 'po',
    fields: {
      ref: { type: 'text', label: 'Ref' },
      status: { type: 'text', label: 'Status' },
      note: { type: 'text', label: 'Note' },
      owner_id: { type: 'lookup', label: 'Owner', system: true },
      updated_at: { type: 'datetime', label: 'Updated', system: true },
    },
  };
  const PO = { id: 'po1', ref: 'PO-1', status: 'draft', note: 'n', owner_id: 'u9', updated_at: VERSION };

  const renderEdit = () => {
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] });
    const ds: any = {
      getObjectSchema: vi.fn().mockResolvedValue(PO_SCHEMA),
      findOne: vi.fn().mockResolvedValue({ ...PO }),
      find: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      batchTransaction,
    };
    const view = render(
      <MasterDetailForm
        schema={{
          objectName: 'po',
          mode: 'edit',
          recordId: 'po1',
          fields: ['ref', 'status', 'note'],
          details: [
            { childObject: 'po_line', relationshipField: 'po', columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any] },
          ],
        } as any}
        dataSource={ds}
      />,
    );
    return { ...view, ds, batchTransaction };
  };

  it('changing one parent field sends only that field in the parent operation', async () => {
    const { container, batchTransaction } = renderEdit();

    await change(await fieldEl(container, 'input', 'ref'), 'PO-2');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    const ops = batchTransaction.mock.calls[0][0];
    expect(ops[0]).toEqual({ object: 'po', action: 'update', id: 'po1', data: { ref: 'PO-2' } });
  });

  it('a save with nothing changed keeps the parent operation as the full sanitized payload', async () => {
    const { container, batchTransaction } = renderEdit();

    await fieldEl(container, 'input', 'ref');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    const ops = batchTransaction.mock.calls[0][0];
    expect(ops[0]).toEqual({
      object: 'po',
      action: 'update',
      id: 'po1',
      data: { ref: 'PO-1', status: 'draft', note: 'n' },
    });
  });
});

describe('a field the FORM moved after the load is a change, and is sent', () => {
  /** `gold` is offered only under `emea`, `silver` only under `apac`. */
  const REGIONAL_OPTIONS = [
    { label: 'Gold', value: 'gold', visibleWhen: "record.region == 'emea'" },
    { label: 'Silver', value: 'silver', visibleWhen: "record.region == 'apac'" },
  ];
  const TASK_SCHEMA = {
    name: 'task',
    fields: {
      region: { type: 'text', label: 'Region' },
      tier: { type: 'select', label: 'Tier', dependsOn: ['region'], options: REGIONAL_OPTIONS },
    },
  };

  it('a cascade clear: the user moves `region`, the form empties `tier`, and `tier: null` is written', async () => {
    const ds: any = {
      getObjectSchema: vi.fn().mockResolvedValue(TASK_SCHEMA),
      findOne: vi.fn().mockResolvedValue({ id: 't1', region: 'emea', tier: 'gold', updated_at: VERSION }),
      create: vi.fn(),
      update: vi.fn(async (_o: string, _id: string, d: any) => ({ id: 't1', ...d })),
    };
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'task', mode: 'edit', recordId: 't1' } as any}
        dataSource={ds}
      />,
    );
    const region = await fieldEl(container, 'input', 'region');
    await waitFor(() => {
      expect(container.querySelector('[data-testid="select-trigger-tier"]')).toBeTruthy();
    });

    await change(region, 'apac');
    await submit(container);

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    const payload = ds.update.mock.calls[0][2];
    // The user touched `region` only; `tier` moved because the form moved it.
    expect(payload).toHaveProperty('tier', null);
    expect(payload).toHaveProperty('region', 'apac');
  });
});
