// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `CreateItemDialog` previews the name an item is SAVED under when its caller
 * supplies that rule (objectui#11792).
 *
 * Measured on the card: Studio → Data → *New object* showed the identifier
 * `repair_ticket` and created `repairs_repair_ticket`, because the Data pillar
 * prefixes the name with the package namespace on save. The dialog now takes
 * the caller's own rule as an optional prop and shows its output; the first
 * block drives the dialog with the same `prefixObjectName` the pillar saves
 * with, the second pins that a caller passing nothing — the app, automation
 * and access dialogs — renders exactly as before, and the third drives the
 * REAL Data pillar end to end.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CreateItemDialog } from './CreateItemDialog';
import type { PkgEntry } from './packages-io';

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: null, code: null })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

let packagesFixture: PkgEntry[] = [];
vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => packagesFixture) };
});

import { prefixObjectName } from './packages-io';
import { DataPillar } from './StudioDesignSurface';

beforeEach(() => {
  vi.clearAllMocks();
  packagesFixture = [];
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

describe('Data pillar — New object previews the name it saves (objectui#11792)', () => {
  async function openAndType(label: string) {
    render(
      <MemoryRouter initialEntries={['/studio/com.test.repairs/data']}>
        <DataPillar packageId="com.test.repairs" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId('empty-state-new-object'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: label } });
    return dialog;
  }

  function savedName(): string {
    const call = mockClient.save.mock.calls.at(-1) as unknown as [string, string];
    return call[1];
  }

  it('previews `<namespace>_<identifier>` and saves exactly that name', async () => {
    packagesFixture = [{ id: 'com.test.repairs', name: 'Repairs', writable: true, namespace: 'repairs' }];
    const dialog = await openAndType('Repair Ticket');
    await waitFor(() =>
      expect(screen.getByTestId('create-item-stored-name')).toHaveTextContent('repairs_repair_ticket'),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: /save as draft|存为草稿/i }));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled());
    expect(savedName()).toBe('repairs_repair_ticket');
  });

  it('previews the bare identifier when the package has no namespace — and that is what it saves', async () => {
    packagesFixture = [{ id: 'com.test.repairs', name: 'Repairs', writable: true, namespace: null }];
    const dialog = await openAndType('Repair Ticket');
    expect(await screen.findByTestId('create-item-stored-name')).toHaveTextContent('repair_ticket');
    fireEvent.click(within(dialog).getByRole('button', { name: /save as draft|存为草稿/i }));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled());
    expect(savedName()).toBe('repair_ticket');
  });
});
