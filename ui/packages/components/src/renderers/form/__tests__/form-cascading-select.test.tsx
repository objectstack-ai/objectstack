/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Cascading `select` options in the inline form renderer (#2284).
 *
 * The form renderer's builtin `case 'select'` must narrow a dependent field's
 * options by each option's `visibleWhen` and gate the whole control (a "select
 * the parent first" hint) while its `dependsOn` controlling field is empty —
 * re-evaluating live as the user edits the parent. We drive the controlling
 * field through a plain text `input` (Radix Select can't be driven by synthetic
 * DOM events) and assert the gate transition on the dependent select.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const cascadeFields = [
  { name: 'country', label: 'Country', type: 'input', defaultValue: '' },
  {
    name: 'province',
    label: 'Province',
    type: 'select',
    dependsOn: 'country',
    options: [
      { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
      { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
    ],
  },
];

describe('form renderer — cascading select (#2284)', () => {
  it('gates the dependent select until the controlling field is set, then unlocks', async () => {
    renderForm(cascadeFields);

    // Country empty → province is gated with a parent-first hint (no combobox).
    expect(screen.getByText(/select country first/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    // Pick a country → the gate lifts and the dependent select becomes usable.
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'cn' } });
    await waitFor(() => {
      expect(screen.queryByText(/select country first/i)).not.toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
  });
});
