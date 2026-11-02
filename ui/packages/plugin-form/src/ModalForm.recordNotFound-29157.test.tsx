/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An edit `ModalForm` whose record does not exist shows the record not-found
 * state, never an empty editable form (objectstack#29157).
 *
 * The console's `?form=ID` overlay mounts this dialog with `mode: 'edit'` and
 * the id from the URL. `DataSource.findOne` answers `null` for a record that is
 * not there (the ObjectStack adapter maps the server's 404 to it), and the
 * dialog used to seed the form with `{}` from that answer: a blank form with an
 * enabled Update button, whose submit then failed against the missing record.
 *
 * Pinned here: a `null` edit read draws the not-found state (the console's
 * shared `empty.recordNotFound` copy) with no field and no Update button, both
 * on the first read and on a background re-read that finds the record deleted.
 * Controls: a create and a found record still draw the form.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm, type ModalFormProps, type ModalFormSchema } from './ModalForm';

registerAllFields();

function makeDS(record: Record<string, unknown> | null) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'showcase_category',
      fields: { name: { type: 'text', label: 'Name' } },
    }),
    findOne: vi.fn().mockResolvedValue(record),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'n1', ...d })),
    update: vi.fn(async (_o: string, id: string, d: Record<string, unknown>) => ({ id, ...d })),
  };
}

function open(ds: ReturnType<typeof makeDS>, mode: 'edit' | 'create', recordId?: string) {
  const schema: ModalFormSchema = {
    type: 'object-form',
    formType: 'modal',
    objectName: 'showcase_category',
    mode,
    recordId,
    title: mode === 'edit' ? 'Edit Category' : 'New Category',
    open: true,
  };
  render(<ModalForm schema={schema} dataSource={ds as unknown as ModalFormProps['dataSource']} />);
}

const nameBox = () => document.body.querySelector('input[name="name"]') as HTMLInputElement | null;
const submitButton = (label: string) => screen.queryByRole('button', { name: label });

describe('ModalForm — an edit read that finds no record (objectstack#29157)', () => {
  it('draws the not-found state with no field and no Update button', async () => {
    const ds = makeDS(null);
    open(ds, 'edit', 'NOPE_x');

    expect(await screen.findByText('Record not found')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The record you are looking for does not exist, may have been deleted, or you may not have access to it.',
      ),
    ).toBeInTheDocument();
    expect(ds.findOne).toHaveBeenCalledWith('showcase_category', 'NOPE_x');
    expect(nameBox()).toBeNull();
    expect(submitButton('Update')).toBeNull();
    // Not the generic load-failure screen: nothing failed to load.
    expect(screen.queryByText('Error loading form')).toBeNull();
  });

  it('draws the not-found state when a background re-read finds the record deleted', async () => {
    const ds = makeDS({ id: 'c1', name: 'Books' });
    open(ds, 'edit', 'c1');
    await waitFor(() => expect(nameBox()?.value).toBe('Books'));

    ds.findOne.mockResolvedValue(null);
    await act(async () => {
      notifyDataChanged({ objectName: 'showcase_category', recordId: 'c1' });
    });

    expect(await screen.findByText('Record not found')).toBeInTheDocument();
    expect(nameBox()).toBeNull();
    expect(submitButton('Update')).toBeNull();
  });

  it('control: a found record still draws its form and the Update button', async () => {
    const ds = makeDS({ id: 'c1', name: 'Books' });
    open(ds, 'edit', 'c1');

    await waitFor(() => expect(nameBox()?.value).toBe('Books'));
    expect(submitButton('Update')).not.toBeNull();
    expect(screen.queryByText('Record not found')).toBeNull();
  });

  it('control: a create draws an empty form and the Create button, with no read', async () => {
    const ds = makeDS(null);
    open(ds, 'create');

    await waitFor(() => expect(nameBox()).not.toBeNull());
    expect(submitButton('Create')).not.toBeNull();
    expect(ds.findOne).not.toHaveBeenCalled();
    expect(screen.queryByText('Record not found')).toBeNull();
  });
});
