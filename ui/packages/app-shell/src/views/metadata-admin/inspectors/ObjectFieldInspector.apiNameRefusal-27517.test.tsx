// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectFieldInspector — the API name box refuses a name another field holds
 * and normalises trailing punctuation (objectstack#27517).
 *
 * Measured on the release-candidate walkthrough: selecting all of an Estimated
 * Hours field's API name and typing `status` (another field's name) left the
 * box reading `statu` with no message, and `statu` was saved; typing
 * `Estimated Hours!` saved `estimated_hours_`. The box now shows what the
 * author typed, refuses a taken name in the Add field popover's own sentence,
 * keeps the name the field had when the edit began, and writes the name the
 * new-object dialog's rule derives.
 *
 * Every case types ONE CHARACTER AT A TIME through a host that feeds each
 * patch back in and follows the rename with the selection, as the Studio host
 * does: the dropped keystroke only exists in that loop.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { fieldNameTakenRefusal } from '../../studio-design/AddFieldPopover';

afterEach(cleanup);

type Fields = Record<string, Record<string, unknown>>;

const WORK_ORDER: Fields = {
  estimated_hours: { type: 'number', label: 'Estimated Hours' },
  status: { type: 'select', label: 'Status', options: [{ value: 'new', label: 'New Request' }] },
};

/** The host's draft as last patched, read by the assertions. */
let saved: Fields = {};

function Host({ fields: initial, id }: { fields: Fields; id: string }) {
  const [fields, setFields] = React.useState(initial);
  const [selection, setSelection] = React.useState<any>({ kind: 'field', id });
  return (
    <ObjectFieldInspector
      type="object"
      name="work_order"
      draft={{ name: 'work_order', fields }}
      selection={selection}
      onPatch={(patch: any) => {
        saved = patch.fields;
        setFields(patch.fields);
      }}
      onClearSelection={() => {}}
      onSelectionChange={(next: any) => next && setSelection(next)}
      readOnly={false}
      locale={'en-US'}
    />
  );
}

function apiNameBox(): HTMLInputElement {
  return screen.getByTestId('field-apiname-input') as HTMLInputElement;
}

/** Select all, then one `change` event per character — a person at a keyboard. */
function typeOver(text: string): void {
  fireEvent.focus(apiNameBox());
  for (let i = 1; i <= text.length; i += 1) {
    fireEvent.change(apiNameBox(), { target: { value: text.slice(0, i) } });
  }
}

function renderWorkOrder(): void {
  saved = WORK_ORDER;
  render(<Host fields={WORK_ORDER} id="estimated_hours" />);
}

describe('ObjectFieldInspector — API name box refuses a taken name (#27517)', () => {
  it('shows every keystroke and the Add field popover refusal, and keeps the previous name', () => {
    renderWorkOrder();
    typeOver('status');
    // Pre-fix the box read `statu`: the refused keystroke was dropped silently.
    expect(apiNameBox()).toHaveValue('status');
    const refusal = screen.getByTestId('field-apiname-refusal');
    // The same sentence the Add field popover says for the same name.
    expect(refusal.textContent).toBe(fieldNameTakenRefusal('status', ['status'], 'en-US'));
    expect(apiNameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(apiNameBox().getAttribute('aria-describedby')).toBe(refusal.id);
    // Saves nothing: the field still carries the name it had before the edit,
    // not the last free prefix (`statu`) of the refused one.
    expect(Object.keys(saved).sort()).toEqual(['estimated_hours', 'status']);
  });

  it('takes the name once the author types past the refusal', () => {
    renderWorkOrder();
    typeOver('status_2');
    expect(apiNameBox()).toHaveValue('status_2');
    expect(screen.queryByTestId('field-apiname-refusal')).toBeNull();
    expect(Object.keys(saved).sort()).toEqual(['status', 'status_2']);
  });

  it('shows the name the field carries once the author leaves a refused box', () => {
    renderWorkOrder();
    typeOver('status');
    fireEvent.blur(apiNameBox());
    expect(apiNameBox()).toHaveValue('estimated_hours');
    expect(screen.queryByTestId('field-apiname-refusal')).toBeNull();
  });

  it('saves nothing for an emptied box', () => {
    renderWorkOrder();
    fireEvent.focus(apiNameBox());
    fireEvent.change(apiNameBox(), { target: { value: '' } });
    expect(apiNameBox()).toHaveValue('');
    expect(Object.keys(saved).sort()).toEqual(['estimated_hours', 'status']);
    fireEvent.blur(apiNameBox());
    expect(apiNameBox()).toHaveValue('estimated_hours');
  });
});

describe('ObjectFieldInspector — API name box normalises as the new-object dialog does (#27517)', () => {
  it('saves `Estimated Hours!` as estimated_hours, without the trailing underscore', () => {
    saved = {};
    render(<Host fields={{ field_3: { type: 'number', label: '' } }} id="field_3" />);
    typeOver('Estimated Hours!');
    // While typing, the box keeps the `_` so the next letter can follow it.
    expect(apiNameBox()).toHaveValue('estimated_hours_');
    // Pre-fix this read `estimated_hours_`.
    expect(Object.keys(saved)).toEqual(['estimated_hours']);
    fireEvent.blur(apiNameBox());
    expect(apiNameBox()).toHaveValue('estimated_hours');
  });

  it('still lets an underscore be typed mid-word', () => {
    saved = {};
    render(<Host fields={{ field_4: { type: 'text', label: '' } }} id="field_4" />);
    typeOver('repair_ticket');
    expect(apiNameBox()).toHaveValue('repair_ticket');
    expect(Object.keys(saved)).toEqual(['repair_ticket']);
  });
});
