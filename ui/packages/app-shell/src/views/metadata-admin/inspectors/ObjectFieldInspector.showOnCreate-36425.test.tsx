// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#36425 — the field inspector's "Show on create"
 * switch (`showOnCreate`). On is the default and is stored as no key; off
 * writes `showOnCreate: false`, which leaves the field out of a create; a
 * required field is always asked for on create, so its switch stays on and
 * locked, and says why.
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

afterEach(cleanup);

function renderField(fields: Record<string, Record<string, unknown>>, selectedId: string) {
  const onPatch = vi.fn();
  render(
    <ObjectFieldInspector
      type="object"
      name="probe_widget"
      draft={{ name: 'probe_widget', fields }}
      selection={{ kind: 'field', id: selectedId }}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={'en-US'}
    />,
  );
  const savedField = () =>
    (onPatch.mock.calls.at(-1)![0].fields as Record<string, Record<string, unknown>>)[selectedId];
  return { onPatch, savedField };
}

const box = () => screen.getByRole('checkbox', { name: 'Show on create' }) as HTMLInputElement;

describe('ObjectFieldInspector · Show on create (#36425)', () => {
  it('is on by default; turning it off writes showOnCreate: false', () => {
    const { savedField } = renderField({ notes: { type: 'textarea', label: 'Notes' } }, 'notes');
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(false);
    fireEvent.click(box());
    expect(savedField()).toMatchObject({ showOnCreate: false });
  });

  it('turning it back on removes the key rather than writing true', () => {
    const { savedField } = renderField({ notes: { type: 'textarea', label: 'Notes', showOnCreate: false } }, 'notes');
    expect(box().checked).toBe(false);
    fireEvent.click(box());
    expect(savedField()).not.toHaveProperty('showOnCreate');
  });

  it('a required field: the switch stays on, locked, and the reason is shown', () => {
    renderField({ name: { type: 'text', label: 'Name', required: true } }, 'name');
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(true);
    expect(screen.getByTestId('field-show-on-create-required')).toHaveTextContent(/always asked for/);
  });

  it('CONTROL: an optional field shows no required note', () => {
    renderField({ notes: { type: 'textarea', label: 'Notes' } }, 'notes');
    expect(screen.queryByTestId('field-show-on-create-required')).toBeNull();
  });
});
