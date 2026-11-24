/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#36290 (ruling 7076513167 point 1) — the Field
 * Designer drawer writes a field's `fieldHistory` with the Studio's three
 * choices (Default removes the key and names what it resolves to for the
 * type; On; Off) and never writes `trackHistory`, which it used to set to
 * `data.trackHistory === true` on every save.
 *
 * The drawer draws the choice twice, one row per resolved default, each shown
 * by `visibleWhen` for its types; the save reads the row shown for the saved
 * type. This captures the schema the real `FieldDesigner` hands its drawer and
 * calls its own `onSuccess` with the values a form would submit.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { DESIGNER_FIELD_TYPES, type DesignerFieldDefinition } from '@object-ui/types';
import { evalFieldPredicate } from '@object-ui/core';
import { resolveFieldHistory } from '@objectstack/spec/data';
import { FieldDesigner } from '../FieldDesigner';

/** The parts of the drawer schema this file reads. */
interface DrawerRow {
  name: string;
  label?: string;
  options?: Array<{ label: string; value: string }>;
  visibleWhen?: string;
}
interface SeenDrawerSchema {
  open?: boolean;
  initialValues: Record<string, unknown>;
  onSuccess: (values: Record<string, unknown>) => void;
  sections: Array<{ name: string; fields: DrawerRow[] }>;
}

const drawer = vi.hoisted(() => ({ schema: undefined as undefined | SeenDrawerSchema }));

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-grid')),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DrawerForm: ({ schema }: { schema: SeenDrawerSchema }) => {
    drawer.schema = schema;
    return schema.open === false ? null : <div data-testid="mock-drawer-form" />;
  },
}));

const ON_ROW = 'fieldHistoryDefaultOn';
const OFF_ROW = 'fieldHistoryDefaultOff';

const FIELDS: DesignerFieldDefinition[] = [
  { id: 'notes', name: 'notes', label: 'Notes', type: 'textarea' },
  { id: 'photo', name: 'photo', label: 'Photo', type: 'image', trackHistory: true },
  { id: 'muted', name: 'muted', label: 'Muted', type: 'text', fieldHistory: false },
];

afterEach(() => {
  cleanup();
  drawer.schema = undefined;
});

function renderDesigner() {
  const changed = vi.fn();
  render(<FieldDesigner objectName="invoice" fields={FIELDS} onFieldsChange={changed} />);
  return changed;
}

async function openEdit(name: string) {
  fireEvent.click(await screen.findByTestId(`grid-edit-${name}`));
  await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());
}

async function openCreate() {
  fireEvent.click(screen.getByTestId('grid-add-btn'));
  await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());
}

function advancedRows(): DrawerRow[] {
  return drawer.schema!.sections.find((s) => s.name === 'advanced')!.fields;
}

function row(name: string): DrawerRow {
  return advancedRows().find((f) => f.name === name)!;
}

/** Submit the drawer with its initial values, overridden by `values`; the field the save emitted. */
function submit(changed: ReturnType<typeof vi.fn>, name: string, values: Record<string, unknown> = {}) {
  act(() => {
    drawer.schema!.onSuccess({ ...drawer.schema!.initialValues, ...values });
  });
  const emitted: DesignerFieldDefinition[] = changed.mock.calls.at(-1)![0];
  return emitted.find((f) => f.name === name)!;
}

describe('FieldDesigner · Field Change Values rows (#36290)', () => {
  it('draws two Field Change Values rows in Advanced and no Track History row', async () => {
    renderDesigner();
    await openCreate();
    const names = advancedRows().map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining([ON_ROW, OFF_ROW]));
    expect(names).not.toContain('trackHistory');
    expect(row(ON_ROW).label).toBe('Field Change Values');
    expect(row(ON_ROW).options!.map((o) => o.label)).toEqual(['Default (On)', 'On', 'Off']);
    expect(row(OFF_ROW).options!.map((o) => o.label)).toEqual(['Default (Off)', 'On', 'Off']);
  });

  it('for every designer type exactly one row shows, and it is the one resolveFieldHistory names', async () => {
    renderDesigner();
    await openCreate();
    for (const type of DESIGNER_FIELD_TYPES) {
      const defaultOn = resolveFieldHistory({ type }, undefined);
      const onShown = evalFieldPredicate(row(ON_ROW).visibleWhen, { type }, false);
      const offShown = evalFieldPredicate(row(OFF_ROW).visibleWhen, { type }, true);
      expect([type, onShown, offShown]).toEqual([type, defaultOn, !defaultOn]);
    }
  });

  it("a field's stored trackHistory: true moves a media type to the Default (On) row", async () => {
    renderDesigner();
    await openEdit('photo');
    expect(evalFieldPredicate(row(ON_ROW).visibleWhen, { type: 'image' }, false)).toBe(true);
    expect(evalFieldPredicate(row(OFF_ROW).visibleWhen, { type: 'image' }, true)).toBe(false);
  });
});

describe('FieldDesigner · what a save writes (#36290)', () => {
  it('an untouched edit writes no fieldHistory and no trackHistory', async () => {
    const changed = renderDesigner();
    await openEdit('notes');
    const saved = submit(changed, 'notes');
    expect(saved.fieldHistory).toBeUndefined();
    expect(saved).not.toHaveProperty('trackHistory');
    expect(saved.label).toBe('Notes');
  });

  it('Off on a one-line type writes fieldHistory: false; On on a media type writes true', async () => {
    const changed = renderDesigner();
    await openEdit('notes');
    expect(submit(changed, 'notes', { [ON_ROW]: 'off' }).fieldHistory).toBe(false);
    cleanup();
    const again = renderDesigner();
    await openCreate();
    const created = submit(again, 'new_field_4', { name: 'new_field_4', type: 'file', [OFF_ROW]: 'on' });
    expect(created.fieldHistory).toBe(true);
    expect(created).not.toHaveProperty('trackHistory');
  });

  it('a stored false opens as Off, and Default removes it', async () => {
    const changed = renderDesigner();
    await openEdit('muted');
    expect(drawer.schema!.initialValues[ON_ROW]).toBe('off');
    expect(submit(changed, 'muted').fieldHistory).toBe(false);
    expect(submit(changed, 'muted', { [ON_ROW]: 'default' }).fieldHistory).toBeUndefined();
  });

  it('keeps a stored trackHistory through an edit', async () => {
    const changed = renderDesigner();
    await openEdit('photo');
    expect(submit(changed, 'photo').trackHistory).toBe(true);
  });

  it('reads the row shown for the SAVED type: a type changed in the drawer saves what is on screen', async () => {
    const changed = renderDesigner();
    await openEdit('notes');
    // Off was picked while the type was textarea, then the type became file:
    // the row on screen is now the Default (Off) one, still at Default.
    const saved = submit(changed, 'notes', { [ON_ROW]: 'off', type: 'file' });
    expect(saved.type).toBe('file');
    expect(saved.fieldHistory).toBeUndefined();
  });

  it('a created field at Default carries neither key', async () => {
    const changed = renderDesigner();
    await openCreate();
    const created = submit(changed, 'new_field_4', { name: 'new_field_4' });
    expect(created.fieldHistory).toBeUndefined();
    expect(created).not.toHaveProperty('trackHistory');
  });
});
