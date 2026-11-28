// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `CreateItemDialog` previews the name an item is SAVED under when its caller
 * supplies that rule (objectui#11792).
 *
 * Measured on the card: Studio → Data → *New object* showed the identifier
 * `repair_ticket` and created `repairs_repair_ticket`, because the Data pillar
 * prefixes the name with the package namespace on save. The dialog now takes
 * the caller's own rule as an optional prop and shows its output; the first
 * block drives the dialog with the same `prefixObjectName` the create saves
 * with, and the second pins that a caller passing nothing — the app,
 * automation and access dialogs — renders exactly as before.
 * objectstack#36904 — the end-to-end half is the list create dialog's
 * (`MetadataListCreateDialog.pairCreate-36897.test.tsx`), the object designer
 * having no 「新建」 of its own.
 */

// Warmed at module top so the first load of the console's lazily loaded
// authoring code is paid during collection, not inside a test's clock.
import '@objectstack/lint';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CreateItemDialog } from './CreateItemDialog';

import { prefixObjectName } from './packages-io';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

function renderDialog(props: Partial<React.ComponentProps<typeof CreateItemDialog>> = {}) {
  const onSubmit = vi.fn();
  render(
    <CreateItemDialog
      open
      onOpenChange={vi.fn()}
      title="New object"
      labelFieldLabel="Object name"
      idFieldLabel="Identifier"
      submitLabel="Save as draft"
      locale="en-US"
      onSubmit={onSubmit}
      {...props}
    />,
  );
  const dialog = screen.getByRole('dialog');
  const [labelInput, idInput] = Array.from(dialog.querySelectorAll('input'));
  return { dialog, labelInput, idInput, onSubmit };
}

describe('CreateItemDialog — saved-name preview (objectui#11792)', () => {
  const prefixed = (identifier: string) => prefixObjectName(identifier, 'repairs');

  it('shows the prefixed name for the identifier it derived from the label', () => {
    const { labelInput } = renderDialog({ storedName: prefixed });
    fireEvent.change(labelInput, { target: { value: 'Repair Ticket' } });
    expect(screen.getByTestId('create-item-stored-name')).toHaveTextContent('Saved as repairs_repair_ticket');
  });

  it('follows the rule it is handed: no double prefix, `sys_` left alone', () => {
    const { labelInput, idInput } = renderDialog({ storedName: prefixed });
    fireEvent.change(labelInput, { target: { value: 'Ticket' } });
    fireEvent.change(idInput, { target: { value: 'repairs_ticket' } });
    expect(screen.getByTestId('create-item-stored-name')).toHaveTextContent('repairs_ticket');
    expect(screen.getByTestId('create-item-stored-name')).not.toHaveTextContent('repairs_repairs_ticket');
    fireEvent.change(idInput, { target: { value: 'sys_note' } });
    expect(screen.getByTestId('create-item-stored-name')).toHaveTextContent('Saved as sys_note');
  });

  it('still hands the caller the identifier, not the preview — the caller applies its rule', () => {
    const { dialog, labelInput, onSubmit } = renderDialog({ storedName: prefixed });
    fireEvent.change(labelInput, { target: { value: 'Repair Ticket' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));
    expect(onSubmit).toHaveBeenCalledWith({ label: 'Repair Ticket', name: 'repair_ticket' });
  });

  it('shows nothing while there is no usable identifier yet', () => {
    renderDialog({ storedName: prefixed });
    expect(screen.queryByTestId('create-item-stored-name')).toBeNull();
  });
});

describe('CreateItemDialog — callers that pass no rule are unchanged (objectui#11792)', () => {
  it('renders no preview, and the same inputs, for an app / automation / access caller', () => {
    const { dialog, labelInput } = renderDialog();
    fireEvent.change(labelInput, { target: { value: 'Repair Ticket' } });
    expect(screen.queryByTestId('create-item-stored-name')).toBeNull();
    expect(dialog.querySelectorAll('input')).toHaveLength(2);
  });
});
