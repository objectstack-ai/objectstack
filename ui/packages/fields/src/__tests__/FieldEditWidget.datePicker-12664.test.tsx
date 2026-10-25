/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12664 — `FieldEditWidget`, the inline factory the grid cell editor
 * and the kanban required-fields dialog render, draws the platform date
 * picker for `date` / `datetime`, as the record form and the dialogs already
 * do (objectui#12622, objectui#12642). The picker loads lazily, so the factory
 * shows a placeholder with no input until its chunk arrives.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { FieldEditWidget } from '../FieldEditWidget';

afterEach(() => cleanup());

const pickerBox = (container: HTMLElement) =>
  container.querySelector('[data-slot="date-picker"] input') as HTMLInputElement | null;

async function settled(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('[data-testid="field-edit-widget-loading"]')).toBeNull());
}

describe('FieldEditWidget — date / datetime draw the platform picker (objectui#12664)', () => {
  it('date: a placeholder with no input while loading, then the picker, never input[type=date]', async () => {
    const { container } = render(
      <FieldEditWidget field={{ name: 'due', type: 'date' } as never} value="2026-10-16" onChange={() => {}} />,
    );
    const loading = container.querySelector('[data-testid="field-edit-widget-loading"]');
    if (loading) expect(loading.querySelector('input')).toBeNull();
    await settled(container);
    const input = pickerBox(container)!;
    expect(input).toBeTruthy();
    expect(input.type).toBe('text');
    expect(input.value).toBe('10/16/2026');
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('datetime: the picker, never input[type=datetime-local], writing the local instant', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <FieldEditWidget field={{ name: 'at', type: 'datetime' } as never} value="" onChange={onChange} />,
    );
    await settled(container);
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    const input = pickerBox(container)!;
    fireEvent.change(input, { target: { value: '10/20/2026 14:30' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 20, 14, 30).toISOString());
  });

  it('readonly keeps the read-only face, with no picker', async () => {
    const { container } = render(
      <FieldEditWidget field={{ name: 'due', type: 'date' } as never} value="2026-10-16" onChange={() => {}} readonly />,
    );
    await settled(container);
    expect(container.querySelector('[data-slot="date-picker"]')).toBeNull();
  });
});
