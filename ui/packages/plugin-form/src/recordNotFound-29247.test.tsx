/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An edit `DrawerForm`, `TabbedForm` or `WizardForm` whose record does not
 * exist shows the record not-found state, never an empty editable form
 * (objectstack#29247; `ModalForm` got the same state in objectstack#29157).
 *
 * `DataSource.findOne` answers `null` for a record that is not there (the
 * ObjectStack adapter maps the server's 404 to it). Each of these layouts used
 * to seed its form with `{}` from that answer: a blank form with an enabled
 * Update button, whose submit then failed against the missing record.
 *
 * Pinned per layout: a `null` edit read draws the not-found state (the
 * console's shared `empty.recordNotFound` copy) with no field and no Update
 * button, on the first read and on a background re-read that finds the record
 * deleted. Controls: a found record and a create still draw the form.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { notifyDataChanged } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { DrawerForm } from './DrawerForm';
import { TabbedForm } from './TabbedForm';
import { WizardForm } from './WizardForm';

registerAllFields();

afterEach(() => cleanup());

const NOT_FOUND_TITLE = 'Record not found';
const NOT_FOUND_DESCRIPTION =
  'The record you are looking for does not exist, may have been deleted, or you may not have access to it.';

function makeDS(record: Record<string, unknown> | null) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'task',
      fields: { title: { type: 'text', label: 'Title' } },
    }),
    findOne: vi.fn().mockResolvedValue(record),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'n1', ...d })),
    update: vi.fn(async (_o: string, id: string, d: Record<string, unknown>) => ({ id, ...d })),
  };
}

/**
 * The layouts under test, as one type. They share no props base (each schema
 * is pinned to its own `formType` literal), so the parametrised surface is
 * named here: the same two props against each, `schema` deliberately `any`,
 * with the `formType` each case passes checked by the tuple below. The same
 * shape and reason as `recordSwapLoading.test.tsx`.
 */
type RecordFormLayout = React.ComponentType<{ schema: any; dataSource?: DataSource }>;

const LAYOUTS: ReadonlyArray<readonly [string, RecordFormLayout, 'drawer' | 'tabbed' | 'wizard']> = [
  ['DrawerForm', DrawerForm, 'drawer'],
  ['TabbedForm', TabbedForm, 'tabbed'],
  // A wizard step is a section, so the one section is its one step.
  ['WizardForm', WizardForm, 'wizard'],
];

function open(
  Form: RecordFormLayout,
  formType: 'drawer' | 'tabbed' | 'wizard',
  ds: ReturnType<typeof makeDS>,
  mode: 'edit' | 'create',
  recordId?: string,
) {
  const schema = {
    type: 'object-form',
    formType,
    objectName: 'task',
    mode,
    recordId,
    sections: [{ name: 'basics', label: 'Basics', fields: ['title'] }],
    // The drawer only.
    open: true,
    onOpenChange: vi.fn(),
  };
  render(<Form schema={schema} dataSource={ds as unknown as DataSource} />);
}

const titleBox = () =>
  document.body.querySelector<HTMLInputElement>('[data-field="title"] input');
const button = (label: string) => screen.queryByRole('button', { name: label });

describe.each(LAYOUTS)('%s — an edit read that finds no record (objectstack#29247)', (_name, Form, formType) => {
  it('draws the not-found state with no field and no Update button', async () => {
    const ds = makeDS(null);
    open(Form, formType, ds, 'edit', 'NOPE_x');

    expect(await screen.findByText(NOT_FOUND_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByTestId(`${formType}-form-record-not-found`)).toBeInTheDocument();
    expect(ds.findOne).toHaveBeenCalledWith('task', 'NOPE_x');
    expect(titleBox()).toBeNull();
    expect(button('Update')).toBeNull();
    // Not the generic load-failure screen: nothing failed to load.
    expect(screen.queryByText('Error loading form')).toBeNull();
  });

  it('draws the not-found state when a background re-read finds the record deleted', async () => {
    const ds = makeDS({ id: 't1', title: 'Write report' });
    open(Form, formType, ds, 'edit', 't1');
    await waitFor(() => expect(titleBox()?.value).toBe('Write report'));

    ds.findOne.mockResolvedValue(null);
    await act(async () => {
      notifyDataChanged({ objectName: 'task', recordId: 't1' });
    });

    expect(await screen.findByText(NOT_FOUND_TITLE)).toBeInTheDocument();
    expect(titleBox()).toBeNull();
    expect(button('Update')).toBeNull();
  });

  it('control: a found record still draws its form and the Update button', async () => {
    const ds = makeDS({ id: 't1', title: 'Write report' });
    open(Form, formType, ds, 'edit', 't1');

    await waitFor(() => expect(titleBox()?.value).toBe('Write report'));
    expect(button('Update')).not.toBeNull();
    expect(screen.queryByText(NOT_FOUND_TITLE)).toBeNull();
  });

  it('control: a create draws an empty form, with no read', async () => {
    const ds = makeDS(null);
    open(Form, formType, ds, 'create');

    await waitFor(() => expect(titleBox()).not.toBeNull());
    expect(titleBox()?.value).toBe('');
    expect(button('Create')).not.toBeNull();
    expect(ds.findOne).not.toHaveBeenCalled();
    expect(screen.queryByText(NOT_FOUND_TITLE)).toBeNull();
  });
});
