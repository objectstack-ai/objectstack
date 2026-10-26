/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * View-level FormField.visibleOn (#2212).
 *
 * A form-view field may declare a CEL `visibleOn` predicate — the wire shape
 * is either a bare string or the spec Expression object `{ dialect, source }`
 * (what the `P` template emits). The form renderer must evaluate it against
 * the live record with the canonical engine, exactly like the field-level
 * `visibleWhen` rules. Pre-fix the predicate was destructured out of the
 * field config and dropped, so conditional fields always rendered.
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
    <Form
      schema={{
        type: 'form',
        showSubmit: false,
        showCancel: false,
        fields,
      }}
    />,
  );
}

describe('form renderer — view-level FormField.visibleOn (#2212)', () => {
  it('hides a field whose `{ dialect, source }` visibleOn is FALSE and shows it when it turns TRUE', async () => {
    renderForm([
      { name: 'priority', label: 'Priority', type: 'input', defaultValue: 'low' },
      {
        name: 'notes',
        label: 'Notes',
        type: 'input',
        visibleOn: { dialect: 'cel', source: "record.priority == 'urgent'" },
      },
    ]);

    // priority = 'low' → notes hidden
    expect(screen.getByLabelText(/priority/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/notes/i)).not.toBeInTheDocument();

    // flip the controlling field → notes appears reactively
    fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: 'urgent' } });
    await waitFor(() => {
      expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
    });

    // and back → hidden again
    fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: 'low' } });
    await waitFor(() => {
      expect(screen.queryByLabelText(/notes/i)).not.toBeInTheDocument();
    });
  });

  it('accepts the bare-string wire shape', () => {
    renderForm([
      { name: 'priority', label: 'Priority', type: 'input', defaultValue: 'low' },
      {
        name: 'notes',
        label: 'Notes',
        type: 'input',
        visibleOn: "record.priority == 'urgent'",
      },
    ]);
    expect(screen.queryByLabelText(/notes/i)).not.toBeInTheDocument();
  });

  it('fails open on a broken predicate (field stays visible)', () => {
    renderForm([
      { name: 'priority', label: 'Priority', type: 'input', defaultValue: 'low' },
      {
        name: 'notes',
        label: 'Notes',
        type: 'input',
        visibleOn: { dialect: 'cel', source: 'this is not (valid CEL' },
      },
    ]);
    expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
  });

  it('combines with field-level visibleWhen (both must allow the field)', () => {
    renderForm([
      { name: 'priority', label: 'Priority', type: 'input', defaultValue: 'urgent' },
      { name: 'status', label: 'Status', type: 'input', defaultValue: 'closed' },
      {
        name: 'notes',
        label: 'Notes',
        type: 'input',
        visibleOn: { dialect: 'cel', source: "record.priority == 'urgent'" },
        visibleWhen: "record.status == 'open'",
      },
    ]);
    // visibleOn passes but visibleWhen fails → hidden
    expect(screen.queryByLabelText(/notes/i)).not.toBeInTheDocument();
  });
});
