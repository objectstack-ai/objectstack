/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An edit form's `select` values must survive the record landing (#2968).
 *
 * The reported failure: a record loads after first paint, the form resets to
 * the loaded defaults, and every rendered `select` comes back EMPTY — the
 * hidden native mirror Radix keeps for form submission reported `''` for a
 * value it had no `<option>` for yet, and that `''` was written into
 * react-hook-form. When the wiped field is the one a `visibleWhen` predicate
 * reads, the predicate flips back to false, the conditional fields hide again,
 * and the form latches broken: Update then fails validation (or submits an
 * empty enum) on a form the user never touched.
 *
 * The invariant these tests pin: nothing writes into a `select`-backed form
 * value except the user. A value the option list does not (yet) offer is left
 * alone rather than blanked.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

const CATEGORY_OPTIONS = [
  { label: '00 Production', value: 'production' },
  { label: '01 Quality', value: 'quality' },
];

const fields = [
  { name: 'category', label: 'Category', type: 'select', options: CATEGORY_OPTIONS },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Done', value: 'done' },
    ],
  },
  // Reads `category`, so a wipe of `category` is self-latching: the field hides
  // again and never comes back.
  {
    name: 'need_quality',
    label: 'Need quality check',
    type: 'checkbox',
    visibleWhen: 'record.category == "production"',
  },
];

/**
 * Build the form element. A plain factory (not a component) so the renderer is
 * pulled from the registry once the `beforeAll` import has run, without
 * resolving a component type during render.
 */
function formElement(
  defaults: Record<string, unknown>,
  onChange?: (data: Record<string, unknown>) => void,
) {
  const Form = ComponentRegistry.get('form')!;
  return (
    <Form
      schema={{ type: 'form', showSubmit: false, showCancel: false, fields, defaultValues: defaults }}
      onAction={(action: { type?: string; data?: Record<string, unknown> }) => {
        if (action?.type === 'form_change') onChange?.(action.data ?? {});
      }}
    />
  );
}

describe('form renderer — select values survive a late record (#2968)', () => {
  it('keeps both selects and reveals the conditional field when the record lands', async () => {
    const { rerender, container } = render(formElement({}));

    // The record arrives after first paint (edit modal, findOne still in flight
    // when the form first rendered).
    rerender(formElement({ category: 'production', status: 'pending' }));

    await waitFor(() => {
      const mirrors = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
      const byName = Object.fromEntries(mirrors.map((s) => [s.name, s.value]));
      expect(byName.category).toBe('production');
      expect(byName.status).toBe('pending');
    });

    // The predicate now holds, so the conditional field is rendered.
    expect(container.querySelector('[data-field="need_quality"]')).not.toBeNull();
  });

  it('never writes an empty string over a value the option list does not offer', async () => {
    const changes: Array<Record<string, unknown>> = [];
    const push = (d: Record<string, unknown>) => { changes.push(d); };
    const { rerender } = render(formElement({}, push));

    // A value outside the offered set is the deterministic form of the race:
    // the mirror has no matching <option>, so Radix used to echo `''` back and
    // react-hook-form recorded the wipe as a user edit.
    rerender(formElement({ category: 'not-offered', status: 'pending' }, push));

    await waitFor(() => {});

    // No change event at all — the form is pristine, so the modal's dirty guard
    // stays quiet and nothing was blanked behind the user's back.
    expect(changes).toEqual([]);
  });
});
