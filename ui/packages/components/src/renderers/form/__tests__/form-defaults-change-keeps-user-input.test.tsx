/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `defaultValues` change must not throw away what the user typed (#2982).
 *
 * The renderer adopts a changed `defaultValues` with `form.reset()`, which
 * replaces the WHOLE react-hook-form record. Any field the incoming defaults do
 * not mention is therefore blanked — including one the user just filled in. The
 * caught case was the wizard: it reuses ONE inner form across steps and feeds it
 * `defaultValues={formData}`, the merged data of the steps SUBMITTED SO FAR. So
 * on every step boundary the incoming defaults are missing exactly the fields of
 * the step now on screen, and the create POST went out without them:
 *
 *     RESET to {"name":"Alice"}   (values before: {"name":"Alice","note":"hello"})
 *     -> create {"name":"Alice"}  — the last step is gone
 *
 * (The reset runs in a passive effect, one commit after the new step's inputs
 * are painted, so a real user can type inside that window too — and paste or
 * autofill lands there in a single tick.)
 *
 * The rule pinned here: the caller's defaults stay authoritative for every field
 * the caller has an opinion about — a landing record, a swapped record, a
 * dropped field all overwrite freely, exactly as before. Only a value the caller
 * has NEVER carried (absent from both the outgoing and the incoming defaults)
 * and that the user actually changed survives the reset.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

const fields = [
  { name: 'name', label: 'Name', type: 'input' },
  { name: 'note', label: 'Note', type: 'input' },
];

function formElement(
  defaults: Record<string, unknown>,
  onSubmit?: (data: Record<string, unknown>) => void,
) {
  const Form = ComponentRegistry.get('form')!;
  return (
    <Form
      schema={{
        type: 'form',
        fields,
        defaultValues: defaults,
        showSubmit: false,
        showCancel: false,
        onSubmit,
      }}
    />
  );
}

const input = (c: HTMLElement, name: string) =>
  c.querySelector(`input[name="${name}"]`) as HTMLInputElement;

describe('form renderer — a defaultValues change keeps user input (#2982)', () => {
  it('keeps a field the incoming defaults never mention, and submits it', async () => {
    const onSubmit = vi.fn();
    const { rerender, container } = render(formElement({}, onSubmit));

    // The user fills the field that is on screen now. The caller does not model
    // it yet — for the wizard, `note` belongs to the step being filled.
    fireEvent.change(input(container, 'note'), { target: { value: 'hello' } });

    // The caller's defaults change to what it HAS collected (step 1's `name`).
    rerender(formElement({ name: 'Alice' }, onSubmit));

    expect(input(container, 'note').value).toBe('hello');
    expect(input(container, 'name').value).toBe('Alice');

    // The harm was on the wire, not just on screen: the create body lost a step.
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: 'Alice', note: 'hello' }),
    );
  });

  it('still adopts a record that lands after first paint (edit mode)', () => {
    // The load-bearing case the reset exists for: an edit form paints before
    // `findOne` resolves, and every field must take the record's values.
    const { rerender, container } = render(formElement({}));

    rerender(formElement({ name: 'Alice', note: 'from the record' }));

    expect(input(container, 'name').value).toBe('Alice');
    expect(input(container, 'note').value).toBe('from the record');
  });

  it('does not leak an unsaved edit into a different record swapped in place', () => {
    // Split/drawer/modal forms re-fetch on a `recordId` change WITHOUT going
    // back through their loading branch, so record B lands in the still-mounted
    // form. B's values must win outright — carrying A's abandoned edit across
    // would silently write it to the wrong record.
    const { rerender, container } = render(formElement({ name: 'A', note: 'note A' }));

    fireEvent.change(input(container, 'note'), { target: { value: 'unsaved edit' } });
    rerender(formElement({ name: 'B', note: 'note B' }));

    expect(input(container, 'name').value).toBe('B');
    expect(input(container, 'note').value).toBe('note B');
  });

  it('still lets the caller take back a field it drops from its defaults', () => {
    // The caller previously carried `note` and no longer does: that is the
    // caller withdrawing the value, so the user's edit does not survive it.
    // (react-hook-form reverts a dropped key to the default it last had, rather
    // than blanking it — the point asserted here is only that the caller, not
    // the abandoned edit, decides.)
    const { rerender, container } = render(formElement({ name: 'Alice', note: 'note A' }));

    fireEvent.change(input(container, 'note'), { target: { value: 'unsaved edit' } });
    rerender(formElement({ name: 'Alice' }));

    expect(input(container, 'note').value).toBe('note A');
  });
});
