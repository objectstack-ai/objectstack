/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11253 — the Field Designer offers no choice type until it has an
 * options editor.
 *
 * The drawer has no control for `options`, and `MetadataFieldsPage` saves every
 * change at once. A `select` created here could only ever be a choice with
 * nothing to choose: the object write guard holds it client-side, and the
 * maintainer's ruling A on objectstack#20827 refuses it at the `FieldSchema`
 * door. So the drawer's type `<select>` stops offering the choice types.
 *
 * What is read here is the `type` control's `options` on the schema the REAL
 * `FieldDesigner` hands its drawer form: the choices an author is actually
 * offered. The form itself is the shared recorder mock, so nothing about the
 * drawer's rendering is under test, only what it is told to offer.
 *
 * Every absence is paired with a presence in the same reading (`text`, and the
 * existing picklist's own type), so an empty or unrendered option list cannot
 * pass as a result.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { DesignerFieldDefinition } from '@object-ui/types';
import { CHOICE_TYPES_REQUIRING_OPTIONS } from '@object-ui/data-objectstack';
import { FieldDesigner } from '../FieldDesigner';

/** The slice of the drawer schema this file reads. */
interface DrawerSchemaSlice {
  sections: Array<{ name: string; fields: Array<{ name: string; options?: Array<{ value: string }> }> }>;
}

/** The last schema `FieldDesigner` handed its drawer form. */
let drawerSchema: DrawerSchemaSlice | null = null;

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-grid')),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const mocks = await import('./__mocks__/plugin-form');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    ...mocks,
    DrawerForm: (props: { schema: DrawerSchemaSlice }) => {
      drawerSchema = props.schema;
      return React.createElement(mocks.DrawerForm, props);
    },
  };
});

const FIELDS: DesignerFieldDefinition[] = [
  { id: 'title', name: 'title', label: 'Title', type: 'text' },
  {
    id: 'stage',
    name: 'stage',
    label: 'Stage',
    type: 'select',
    options: [{ label: 'Open', value: 'open' }],
  },
];

afterEach(() => {
  cleanup();
  drawerSchema = null;
});

/** The type values the open drawer offers. */
function offeredTypes(): string[] {
  const basic = drawerSchema?.sections.find((s) => s.name === 'basic');
  const typeField = basic?.fields.find((f) => f.name === 'type');
  expect(typeField?.options, 'the drawer rendered no type control: the harness is dead').toBeDefined();
  return (typeField?.options ?? []).map((o) => o.value);
}

async function openEdit(name: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(`grid-edit-${name}`));
  await waitFor(() => expect(screen.getByTestId('drawer-mode').textContent).toBe('edit'));
}

describe('FieldDesigner — the drawer offers no choice type without an options editor (objectui#11253)', () => {
  it('the create drawer offers no choice type', async () => {
    render(<FieldDesigner objectName="deal" fields={FIELDS} onFieldsChange={() => {}} />);
    fireEvent.click(screen.getByTestId('grid-add-btn'));
    await waitFor(() => expect(screen.getByTestId('drawer-mode').textContent).toBe('create'));

    const offered = offeredTypes();
    expect(offered).toContain('text');
    expect(offered).toContain('boolean');
    expect(CHOICE_TYPES_REQUIRING_OPTIONS.length).toBeGreaterThan(0);
    for (const choice of CHOICE_TYPES_REQUIRING_OPTIONS) expect(offered).not.toContain(choice);
  });

  it('editing a non-choice field cannot turn it into one', async () => {
    render(<FieldDesigner objectName="deal" fields={FIELDS} onFieldsChange={() => {}} />);
    await openEdit('title');

    const offered = offeredTypes();
    expect(offered).toContain('text');
    expect(offered).not.toContain('select');
  });

  it('an existing picklist keeps its own type, and a save writes it back with its options', async () => {
    // The must-not-change half: hiding the type from NEW fields must not strip
    // it from the drawer of a field that already is one.
    const changed = vi.fn();
    render(<FieldDesigner objectName="deal" fields={FIELDS} onFieldsChange={changed} />);
    await openEdit('stage');

    expect(offeredTypes()).toContain('select');
    fireEvent.click(screen.getByTestId('drawer-submit'));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const stage = (changed.mock.calls[0][0] as DesignerFieldDefinition[]).find((f) => f.name === 'stage');
    expect(stage?.type).toBe('select');
    expect(stage?.options).toEqual([{ label: 'Open', value: 'open' }]);
  });

  it('the list FILTER still lists every type, so existing picklists stay findable', async () => {
    render(<FieldDesigner objectName="deal" fields={FIELDS} onFieldsChange={() => {}} />);
    // The filter is the shared Select (objectui#11865): its options are read
    // from the open list, by label — `select` is listed as "Picklist".
    fireEvent.keyDown(screen.getByTestId('field-designer-type-filter'), { key: 'ArrowDown' });
    const labels = within(await screen.findByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toContain('Picklist');
    expect(labels).toContain('Text');
  });
});
