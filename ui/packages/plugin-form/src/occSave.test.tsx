/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * OCC on the form edit save (occSave.tsx wired through ObjectForm/ModalForm).
 *
 * The forms read the record with `findOne` and used to write it back with an
 * unguarded `dataSource.update` — two racing editors both got a 200 and the
 * later save silently erased the earlier one. These tests pin the guarded
 * behaviour: the save carries `ifMatch` = the `updated_at` the form read, and
 * a 409 CONCURRENT_UPDATE surfaces the conflict dialog whose two exits are
 * "keep editing" (nothing written, success path skipped) and "overwrite"
 * (retry re-keyed to the server's currentVersion).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import React from 'react';

import { ObjectForm } from './ObjectForm';
import { ModalForm } from './ModalForm';
import { registerAllFields } from '@object-ui/fields';
import { occVersionOf, isConcurrentUpdateError } from './occSave';

registerAllFields();

const VERSION = '2026-07-30 10:00:00.000';
const NEWER_VERSION = '2026-07-30 10:05:00.000';

const objectSchema = {
  name: 'device',
  fields: { name: { type: 'text', label: 'Name' } },
};

/** Error shaped like the platform's 409 CONCURRENT_UPDATE. */
const conflictError = () =>
  Object.assign(new Error('Record was modified by another user'), {
    code: 'CONCURRENT_UPDATE',
    httpStatus: 409,
    currentVersion: NEWER_VERSION,
    currentRecord: { id: 'r1', name: 'Theirs', updated_at: NEWER_VERSION },
  });

// The stub declares the FOURTH parameter because that is the one under test:
// `DataSource.update` is `(resource, id, data, opts?: { ifMatch?: string })`
// (packages/types/src/data.ts), and the whole point of these cases is which
// `ifMatch` the save carries. A stub with three parameters still records the
// real fourth argument at runtime — vitest does — so `mock.calls[0][3]` passed
// while the compiler was told the call tuple has length 3, and the assertion
// that the unguarded write sends NO options was reading past the end of a
// declared tuple rather than checking the declared option bag (#4040).
const makeDS = (
  update = vi.fn(
    async (_o: string, _id: string, d: any, _opts?: { ifMatch?: string }) => ({ id: 'r1', ...d }),
  ),
) => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  findOne: vi.fn().mockResolvedValue({ id: 'r1', name: 'Mine', updated_at: VERSION }),
  create: vi.fn(),
  update,
});

const waitInput = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

const submitEdit = async (container: HTMLElement) => {
  const input = await waitInput(container, 'name');
  fireEvent.change(input, { target: { value: 'Mine v2' } });
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
};

describe('occSave helpers', () => {
  it('occVersionOf: string updated_at only; anything else downgrades to unguarded', () => {
    expect(occVersionOf({ updated_at: VERSION })).toBe(VERSION);
    expect(occVersionOf({ updated_at: '' })).toBeUndefined();
    expect(occVersionOf({ updated_at: 1234 })).toBeUndefined();
    expect(occVersionOf({})).toBeUndefined();
    expect(occVersionOf(null)).toBeUndefined();
  });

  it('isConcurrentUpdateError: matches wire code and class name, nothing else', () => {
    expect(isConcurrentUpdateError(conflictError())).toBe(true);
    expect(isConcurrentUpdateError({ name: 'ConcurrentUpdateError' })).toBe(true);
    expect(isConcurrentUpdateError(new Error('boom'))).toBe(false);
    expect(isConcurrentUpdateError({ httpStatus: 409 })).toBe(false);
    expect(isConcurrentUpdateError(null)).toBe(false);
  });
});

describe('ObjectForm edit — OCC guarded save', () => {
  it('sends ifMatch = the updated_at the form read', async () => {
    const ds = makeDS();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'device', mode: 'edit', recordId: 'r1' } as any}
        dataSource={ds as any}
      />,
    );
    await submitEdit(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith(
      'device', 'r1', expect.objectContaining({ name: 'Mine v2' }), { ifMatch: VERSION },
    );
  });

  it('record without updated_at degrades to an unguarded write (old behaviour)', async () => {
    const ds = makeDS();
    ds.findOne.mockResolvedValue({ id: 'r1', name: 'Mine' });
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'device', mode: 'edit', recordId: 'r1' } as any}
        dataSource={ds as any}
      />,
    );
    await submitEdit(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][3]).toBeUndefined();
  });

  it('409 → conflict dialog; "keep editing" writes nothing more and skips the success path', async () => {
    const update = vi.fn().mockRejectedValue(conflictError());
    const ds = makeDS(update);
    const onSuccess = vi.fn();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'device', mode: 'edit', recordId: 'r1', onSuccess } as any}
        dataSource={ds as any}
      />,
    );
    await submitEdit(container);

    const keep = await screen.findByText('Keep editing');
    // The dialog is the only exit — nothing was toasted or closed meanwhile.
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(keep);

    await waitFor(() => expect(screen.queryByText('Keep editing')).toBeNull());
    expect(update).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    // The form is still there with the draft — the user keeps editing.
    expect((container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('Mine v2');
  });

  it('409 → "overwrite" retries re-keyed to the server currentVersion and completes the save', async () => {
    const update = vi.fn()
      .mockRejectedValueOnce(conflictError())
      .mockImplementation(async (_o: string, _id: string, d: any) => ({ id: 'r1', ...d }));
    const ds = makeDS(update);
    const onSuccess = vi.fn();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'device', mode: 'edit', recordId: 'r1', onSuccess } as any}
        dataSource={ds as any}
      />,
    );
    await submitEdit(container);

    fireEvent.click(await screen.findByText('Overwrite'));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenNthCalledWith(1,
      'device', 'r1', expect.anything(), { ifMatch: VERSION });
    expect(update).toHaveBeenNthCalledWith(2,
      'device', 'r1', expect.objectContaining({ name: 'Mine v2' }), { ifMatch: NEWER_VERSION });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('non-conflict errors still reject through the normal error path', async () => {
    const update = vi.fn().mockRejectedValue(Object.assign(new Error('validation'), { code: 'VALIDATION_ERROR' }));
    const ds = makeDS(update);
    const onError = vi.fn();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'device', mode: 'edit', recordId: 'r1', onError } as any}
        dataSource={ds as any}
      />,
    );
    await submitEdit(container);
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Keep editing')).toBeNull();
  });
});

describe('ModalForm edit — OCC guarded save', () => {
  it('409 → "keep editing" leaves the modal open; overwrite closes it', async () => {
    const update = vi.fn()
      .mockRejectedValueOnce(conflictError())
      .mockRejectedValueOnce(conflictError())
      .mockImplementation(async (_o: string, _id: string, d: any) => ({ id: 'r1', ...d }));
    const ds = makeDS(update);
    const onOpenChange = vi.fn();
    const { baseElement } = render(
      <ModalForm
        schema={{
          type: 'object-form', formType: 'modal', objectName: 'device',
          mode: 'edit', recordId: 'r1', open: true, onOpenChange,
        } as any}
        dataSource={ds as any}
      />,
    );

    const input = await waitFor(() => {
      const el = baseElement.querySelector('input[name="name"]') as HTMLInputElement | null;
      if (!el) throw new Error('not ready');
      return el;
    });
    fireEvent.change(input, { target: { value: 'Mine v2' } });
    fireEvent.submit(baseElement.querySelector('form') as HTMLFormElement);

    // First conflict: keep editing → modal must stay open.
    fireEvent.click(await screen.findByText('Keep editing'));
    await waitFor(() => expect(screen.queryByText('Keep editing')).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(update).toHaveBeenCalledTimes(1);

    // Second attempt: overwrite → save lands and the modal closes.
    fireEvent.submit(baseElement.querySelector('form') as HTMLFormElement);
    fireEvent.click(await screen.findByText('Overwrite'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    expect(update).toHaveBeenNthCalledWith(3,
      'device', 'r1', expect.anything(), { ifMatch: NEWER_VERSION });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
