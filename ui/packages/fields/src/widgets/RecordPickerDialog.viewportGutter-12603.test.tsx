/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record picker keeps the shared viewport gutter under every width rung
 * (objectui#12603).
 *
 * The picker's width follows its drawn column count (objectui#11903), and its
 * widest rung raises the cap at two breakpoints: `sm:max-w-3xl` and
 * `lg:max-w-5xl`. It reads `DIALOG_VIEWPORT_GUTTER` as an unconditional class,
 * so from `sm` up the dialog is at most the window less 2rem whichever rung
 * the column count picks; below `sm` it stays `95vw`. This pins the widest
 * case, a six-column picker, and the narrowest.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DIALOG_VIEWPORT_GUTTER } from '@object-ui/components';
import { RecordPickerDialog } from './RecordPickerDialog';
import { getCellRenderer } from '../index';

afterEach(cleanup);

type PickerProps = React.ComponentProps<typeof RecordPickerDialog>;

const ROWS = [{ id: 'u01', name: 'User 01', email: 'user01@example.com' }];
const FIELDS: Record<string, { type: string; label: string }> = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'text', label: 'Email' },
  id: { type: 'text', label: 'Id' },
  department: { type: 'text', label: 'Department' },
  title: { type: 'text', label: 'Title' },
  phone: { type: 'text', label: 'Phone' },
};

function renderPicker(props: Partial<PickerProps>) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => ROWS[0]),
    getObjectSchema: vi.fn(async () => ({ name: 'sys_user', fields: FIELDS })),
  } as unknown as PickerProps['dataSource'];
  return render(
    <RecordPickerDialog
      open
      onOpenChange={() => {}}
      dataSource={dataSource}
      objectName="sys_user"
      fieldsMeta={FIELDS}
      cellRenderer={getCellRenderer}
      onSelect={() => {}}
      {...props}
    />,
  );
}

const tokens = () =>
  (screen.getByTestId('record-picker-dialog').getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

describe('RecordPickerDialog keeps the shared viewport gutter (objectui#12603)', () => {
  it('the widest rung keeps 1rem from the window at both of its breakpoints', async () => {
    renderPicker({ columns: ['name', 'email', 'id', 'department', 'title', 'phone'], multiple: false });
    await waitFor(() => expect(screen.getByTestId('record-row-u01')).toBeInTheDocument());
    const classes = tokens();
    expect(classes).toContain('sm:max-w-3xl');
    expect(classes).toContain('lg:max-w-5xl');
    expect(classes).toContain(DIALOG_VIEWPORT_GUTTER);
    // Below `sm` the dialog is still `95vw`, the phone width it always had.
    expect(classes).toContain('w-[95vw]');
  });

  it('the narrowest rung reads the same gutter (a no-op under a cap the window holds)', async () => {
    renderPicker({ columns: ['name'], multiple: false });
    await waitFor(() => expect(screen.getByTestId('record-row-u01')).toBeInTheDocument());
    const classes = tokens();
    expect(classes).toContain('sm:max-w-xl');
    expect(classes).toContain(DIALOG_VIEWPORT_GUTTER);
  });
});
