/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12622 — a record form's `date` / `datetime` fields draw the
 * platform date picker, not the browser's native input.
 *
 * Through the real `ObjectForm` and the real field registry
 * (`registerAllFields`): the date rows carry the picker's text box and no
 * `input[type=date]` / `input[type=datetime-local]`, typing into them submits
 * the ISO shapes the native inputs submitted, and the form's other field types
 * render the controls they rendered before (the CONTROL).
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const OBJECT_SCHEMA = {
  name: 'opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    close_date: { type: 'date', label: 'Close date' },
    remind_at: { type: 'datetime', label: 'Remind at' },
  },
};

const makeDS = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    create: vi.fn().mockResolvedValue({ id: 'o1' }),
    update: vi.fn().mockResolvedValue({ id: 'o1' }),
    findOne: vi.fn().mockResolvedValue({ id: 'o1' }),
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  }) as any;

const row = (name: string) => document.body.querySelector<HTMLElement>(`[data-field="${name}"]`);

afterEach(() => cleanup());

describe('record form date fields draw the date picker (objectui#12622)', () => {
  it('date and datetime rows carry the picker; the other rows are unchanged', async () => {
    render(<ObjectForm schema={{ type: 'object-form', objectName: 'opportunity', mode: 'create' } as any} dataSource={makeDS()} />);
    await waitFor(() => {
      if (!row('close_date')?.querySelector('[data-slot="date-picker"]')) throw new Error('date picker not rendered');
      if (!row('remind_at')?.querySelector('[data-slot="date-picker"]')) throw new Error('datetime picker not rendered');
    });

    expect(document.body.querySelector('input[type="date"]')).toBeNull();
    expect(document.body.querySelector('input[type="datetime-local"]')).toBeNull();
    // The label still names the text box: the host id reached it.
    const dateInput = row('close_date')!.querySelector('[data-slot="date-picker"] input') as HTMLInputElement;
    expect(dateInput.type).toBe('text');
    expect(document.body.querySelector(`label[for="${dateInput.id}"]`)?.textContent).toContain('Close date');

    // CONTROL: the form's other field types render the controls they did.
    await waitFor(() => {
      if (!row('name')?.querySelector('input') || !row('amount')?.querySelector('input')) throw new Error('rows not rendered');
    });
    expect((row('name')!.querySelector('input') as HTMLInputElement).type).toBe('text');
    expect((row('amount')!.querySelector('input') as HTMLInputElement).type).toBe('number');
    expect(row('name')!.querySelector('[data-slot="date-picker"]')).toBeNull();
    expect(row('amount')!.querySelector('[data-slot="date-picker"]')).toBeNull();
  });

  it('typed dates submit the ISO day and the ISO instant', async () => {
    const ds = makeDS();
    render(<ObjectForm schema={{ type: 'object-form', objectName: 'opportunity', mode: 'create' } as any} dataSource={ds} />);
    const picker = (name: string) => row(name)?.querySelector('[data-slot="date-picker"] input') as HTMLInputElement | null;
    await waitFor(() => {
      if (!picker('close_date') || !picker('remind_at')) throw new Error('pickers not rendered');
    });

    fireEvent.change(picker('close_date')!, { target: { value: '10/20/2026' } });
    fireEvent.blur(picker('close_date')!);
    fireEvent.change(picker('remind_at')!, { target: { value: '10/20/2026 14:30' } });
    fireEvent.blur(picker('remind_at')!);

    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const payload = ds.create.mock.calls[0][1];
    expect(payload.close_date).toBe('2026-10-20');
    expect(payload.remind_at).toBe(new Date(2026, 9, 20, 14, 30).toISOString());
  });
});
