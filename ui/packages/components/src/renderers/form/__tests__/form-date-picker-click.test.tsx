/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Click-anywhere-to-open for native date/time inputs.
 *
 * Native `<input type="date|datetime-local|time">` only open their picker when
 * the user clicks the tiny calendar/clock icon. The form renderer wires an
 * onClick that calls `showPicker()` so clicking anywhere in the box opens the
 * picker — matching how the other field widgets behave. Plain inputs must not
 * trigger a picker.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />,
  );
}

describe('form renderer — native date/time picker opens on click', () => {
  it('calls showPicker() when a datetime-local field is clicked anywhere', () => {
    const showPicker = vi.fn();
    // jsdom does not implement showPicker; install a spy on the prototype.
    (HTMLInputElement.prototype as any).showPicker = showPicker;

    renderForm([
      { name: 'endAt', label: 'End', type: 'input', inputType: 'datetime-local' },
    ]);

    fireEvent.click(screen.getByLabelText(/end/i));
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('does not call showPicker() for a plain text field', () => {
    const showPicker = vi.fn();
    (HTMLInputElement.prototype as any).showPicker = showPicker;

    renderForm([{ name: 'title', label: 'Title', type: 'input' }]);

    fireEvent.click(screen.getByLabelText(/title/i));
    expect(showPicker).not.toHaveBeenCalled();
  });
});
