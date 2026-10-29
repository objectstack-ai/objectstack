/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26674 — the Field Designer drawer offers no `External ID`
 * switch, and a field already carrying `externalId: true` keeps it.
 *
 * `field.externalId` is graded `dead` (`packages/spec/liveness/field.json`):
 * no upsert, import or seed matches on it. The key is NOT retired —
 * `FieldSchema` still parses it — so removing the control must never strip a
 * stored value. Before this card the update path wrote
 * `externalId: data.externalId === true`; with the control gone that line
 * would have turned every stored `true` into `false` on the next save.
 *
 * Each absence is paired with a positive control from the same section and
 * testid channel, so a drawer that never rendered cannot pass as a result.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { DesignerFieldDefinition } from '@object-ui/types';
import { FieldDesigner } from '../FieldDesigner';

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-grid')),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-form')),
}));

const FIELDS: DesignerFieldDefinition[] = [
  { id: 'code', name: 'code', label: 'Code', type: 'text', externalId: true },
  { id: 'title', name: 'title', label: 'Title', type: 'text' },
];

afterEach(cleanup);

function renderDesigner(onFieldsChange?: (f: DesignerFieldDefinition[]) => void) {
  render(<FieldDesigner objectName="invoice" fields={FIELDS} onFieldsChange={onFieldsChange} />);
}

async function openEditDrawer(fieldName: string) {
  const row = await screen.findByTestId(`grid-edit-${fieldName}`);
  fireEvent.click(row);
  await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());
}

describe('objectstack#26674 · the drawer offers no External ID switch', () => {
  it('renders no `externalId` field in the create drawer', async () => {
    renderDesigner();
    fireEvent.click(screen.getByTestId('grid-add-btn'));
    await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());

    // POSITIVE CONTROL: a sibling of the same ADVANCED section.
    expect(screen.getByTestId('drawer-field-trackHistory')).toBeTruthy();
    expect(screen.queryByTestId('drawer-field-externalId')).toBeNull();
  });

  it('renders no `externalId` field when editing a field that carries it', async () => {
    renderDesigner();
    await openEditDrawer('code');

    expect(screen.getByTestId('drawer-mode').textContent).toBe('edit');
    expect(screen.getByTestId('drawer-field-trackHistory')).toBeTruthy();
    expect(screen.queryByTestId('drawer-field-externalId')).toBeNull();
  });
});

describe('objectstack#26674 · a stored externalId survives an edit-and-save', () => {
  it('keeps `externalId: true` through the update path', async () => {
    // The mock submits `schema.initialValues` back into the real
    // `handleFormSuccess`, so this exercises the edit seed and the update
    // write path together.
    const changed = vi.fn();
    renderDesigner(changed);
    await openEditDrawer('code');
    fireEvent.click(screen.getByTestId('drawer-submit'));

    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const emitted: DesignerFieldDefinition[] = changed.mock.calls[0][0];
    const code = emitted.find((f) => f.name === 'code')!;

    expect(code.externalId).toBe(true);
    // Falsification: the round-trip happened and kept the field's identity.
    expect(code.label).toBe('Code');
    expect(code.type).toBe('text');
  });

  it('a created field carries no externalId key at all', async () => {
    const changed = vi.fn();
    renderDesigner(changed);
    fireEvent.click(screen.getByTestId('grid-add-btn'));
    await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());
    fireEvent.click(screen.getByTestId('drawer-submit'));

    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const emitted: DesignerFieldDefinition[] = changed.mock.calls[0][0];
    expect(emitted).toHaveLength(FIELDS.length + 1);
    expect('externalId' in emitted[emitted.length - 1]).toBe(false);
  });
});
