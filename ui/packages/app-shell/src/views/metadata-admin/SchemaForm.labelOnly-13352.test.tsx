// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13352 — a metadata form row shows the field's LABEL only.
 *
 * Setup → Packages → New package rendered `Display name* name`: the default
 * `SchemaForm` row drew the field's machine key in a `<code>` chip beside its
 * label whenever the label did not spell the key. An administrator read a
 * developer identifier beside every such row.
 *
 * The row now shows the label alone. The key is still offered, on demand, as
 * the label's hover tooltip — under the same predicate objectui#8231 fixed
 * (`SchemaForm.machineNameChip-8231.test.tsx` pins when it is offered, alike
 * in every locale), so a row whose label already spells its key offers
 * nothing. These pins read what the row draws, through both roads a label
 * reaches a row: an authored form field label and a raw schema `title`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

/** Shaped after the New package dialog: key `name`, labelled "Display name". */
const PACKAGE_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    version: { type: 'string' },
  },
} as never;

const PACKAGE_FORM = {
  type: 'simple',
  sections: [
    {
      label: 'Package',
      fields: [
        { field: 'name', label: 'Display name' },
        { field: 'version' },
      ],
    },
  ],
} as never;

function labelFor(id: string): HTMLLabelElement {
  const label = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
  expect(label, `no label for ${id}`).not.toBeNull();
  return label!;
}

describe('#13352 · the default row shows the label only', () => {
  it('draws no machine key beside a label that does not spell it', () => {
    render(<SchemaForm schema={PACKAGE_SCHEMA} form={PACKAGE_FORM} value={{}} onChange={() => {}} />);
    const label = labelFor('mdf-name');
    // Label + the visual-only required marker, and nothing else.
    expect(label.textContent).toBe('Display name*');
    expect(label.querySelector('code')).toBeNull();
    expect(document.querySelector('label code')).toBeNull();
    // The control's accessible name is the label alone, not the hint.
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveAttribute('id', 'mdf-name');
  });

  it('offers the key on demand, as the label tooltip', () => {
    render(<SchemaForm schema={PACKAGE_SCHEMA} form={PACKAGE_FORM} value={{}} onChange={() => {}} />);
    const label = labelFor('mdf-name');
    expect(label).toHaveAttribute('title', 'Machine name: name');
    expect(label).toHaveAttribute('data-machine-name', 'name');
  });

  it('offers nothing when the label already spells the key', () => {
    render(<SchemaForm schema={PACKAGE_SCHEMA} form={PACKAGE_FORM} value={{}} onChange={() => {}} />);
    const label = labelFor('mdf-version');
    expect(label.textContent).toBe('Version');
    expect(label).not.toHaveAttribute('title');
    expect(label).not.toHaveAttribute('data-machine-name');
  });

  it('draws no key beside a raw schema title either', () => {
    const schema = {
      type: 'object',
      properties: { source_ref: { type: 'string', title: 'Data source' } },
    } as never;
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    const label = labelFor('mdf-source_ref');
    expect(label.textContent).toBe('Data source');
    expect(document.body.textContent).not.toContain('source_ref');
    expect(label).toHaveAttribute('title', 'Machine name: source_ref');
  });
});
