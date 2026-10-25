/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Legacy `FormField.condition` ({ field, equals/notEquals/in }) — issue #1584.
 *
 * The bespoke JSON `condition` branch is retired: the form renderer now
 * translates it to an equivalent CEL visible-when predicate and evaluates it on
 * the canonical engine (over the seeded live record), exactly like `visibleWhen`
 * / `visibleOn`. This locks the translated semantics and reactivity.
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

describe('form renderer — legacy condition → CEL (#1584)', () => {
  it('equals: shows the field only when the sibling equals the value, reactively', async () => {
    renderForm([
      { name: 'type', label: 'Type', type: 'input', defaultValue: 'text' },
      { name: 'referenceTo', label: 'Reference To', type: 'input', condition: { field: 'type', equals: 'lookup' } },
    ]);

    // type = 'text' → hidden
    expect(screen.queryByLabelText(/reference to/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'lookup' } });
    await waitFor(() => {
      expect(screen.getByLabelText(/reference to/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'formula' } });
    await waitFor(() => {
      expect(screen.queryByLabelText(/reference to/i)).not.toBeInTheDocument();
    });
  });

  it('notEquals: hidden when the sibling matches, shown otherwise', async () => {
    renderForm([
      { name: 'status', label: 'Status', type: 'input', defaultValue: 'draft' },
      { name: 'reason', label: 'Reason', type: 'input', condition: { field: 'status', notEquals: 'draft' } },
    ]);
    // Drive explicit values (a field default doesn't populate the record until
    // the control registers a value). status == 'draft' → notEquals false → hidden.
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'draft' } });
    await waitFor(() => expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument());
    // non-draft → shown
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'final' } });
    await waitFor(() => expect(screen.getByLabelText(/reason/i)).toBeInTheDocument());
  });

  it('in: shown when the sibling value is in the list, hidden otherwise', async () => {
    renderForm([
      { name: 'kind', label: 'Kind', type: 'input', defaultValue: 'a' },
      { name: 'extra', label: 'Extra', type: 'input', condition: { field: 'kind', in: ['b', 'c'] } },
    ]);
    // 'a' not in list → hidden
    expect(screen.queryByLabelText(/extra/i)).not.toBeInTheDocument();
    // 'b' in list → shown
    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: 'b' } });
    await waitFor(() => expect(screen.getByLabelText(/extra/i)).toBeInTheDocument());
    // 'x' not in list → hidden
    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: 'x' } });
    await waitFor(() => expect(screen.queryByLabelText(/extra/i)).not.toBeInTheDocument());
  });
});
