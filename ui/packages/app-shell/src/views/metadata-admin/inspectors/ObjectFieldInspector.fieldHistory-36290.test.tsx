// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#36290 (ruling 7076513167 point 1) — the field
 * inspector writes a field's `fieldHistory`: Default (removes the key, and
 * says what it resolves to for this field on this object), On, Off. It used to
 * draw a "Track history" box over `trackHistory`, which no longer turns values
 * off; that box is gone, and a stored `trackHistory` is kept, never written.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
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

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/formula';
import '@objectstack/lint';
import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

beforeAll(() => {
  // Radix Select reads pointer capture and scrolls the open item into view; jsdom has neither.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

function renderField(
  fields: Record<string, Record<string, unknown>>,
  selectedId: string,
  object: Record<string, unknown> = {},
) {
  const onPatch = vi.fn();
  render(
    <ObjectFieldInspector
      type="object"
      name="probe_widget"
      draft={{ name: 'probe_widget', ...object, fields }}
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

const choice = () => screen.getByRole('combobox', { name: 'Field change values' });

async function pick(name: string) {
  fireEvent.keyDown(choice(), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name }));
}

describe('ObjectFieldInspector · Field change values (#36290)', () => {
  it('draws an unset key as Default, naming what it resolves to for a one-line type', () => {
    renderField({ notes: { type: 'textarea', label: 'Notes' } }, 'notes');
    expect(choice()).toHaveTextContent('Default (On)');
  });

  it('names Default (Off) for a media, JSON or credential type, and Default (On) once trackHistory opts one in', () => {
    for (const type of ['image', 'json', 'password']) {
      renderField({ f: { type, label: 'F' } }, 'f');
      expect(choice(), type).toHaveTextContent('Default (Off)');
      cleanup();
    }
    renderField({ f: { type: 'json', label: 'F', trackHistory: true } }, 'f');
    expect(choice()).toHaveTextContent('Default (On)');
  });

  it('Off writes fieldHistory: false and On writes true', async () => {
    const first = renderField({ notes: { type: 'textarea', label: 'Notes' } }, 'notes');
    await pick('Off');
    expect(first.savedField()).toMatchObject({ fieldHistory: false });
    cleanup();
    const second = renderField({ photo: { type: 'image', label: 'Photo' } }, 'photo');
    await pick('On');
    expect(second.savedField()).toMatchObject({ fieldHistory: true });
  });

  it('a stored false goes back to Default: the key is removed, not written', async () => {
    const { savedField } = renderField({ notes: { type: 'textarea', label: 'Notes', fieldHistory: false } }, 'notes');
    expect(choice()).toHaveTextContent(/^Off$/);
    await pick('Default (On)');
    expect(savedField()).not.toHaveProperty('fieldHistory');
  });

  it('draws no Track history box, writes no trackHistory, and keeps a stored one', async () => {
    const { savedField } = renderField({ doc: { type: 'json', label: 'Doc', trackHistory: true } }, 'doc');
    expect(screen.queryByRole('checkbox', { name: /track history/i })).toBeNull();
    await pick('Off');
    expect(savedField()).toEqual({ type: 'json', label: 'Doc', trackHistory: true, fieldHistory: false });
    cleanup();
    const plain = renderField({ notes: { type: 'textarea', label: 'Notes' } }, 'notes');
    await pick('On');
    expect(plain.savedField()).not.toHaveProperty('trackHistory');
  });

  it("resolves Default against the object: the object's own off makes it Default (Off), and says so", () => {
    renderField({ notes: { type: 'textarea', label: 'Notes' } }, 'notes', { enable: { fieldHistory: false } });
    expect(choice()).toHaveTextContent('Default (Off)');
    expect(screen.getByTestId('field-history-object-off')).toHaveTextContent(/turns field change values off for every field/);
  });

  it('CONTROL: an object that leaves it unset shows no object-off note', () => {
    renderField({ notes: { type: 'textarea', label: 'Notes' } }, 'notes', { enable: { feeds: false } });
    expect(screen.queryByTestId('field-history-object-off')).toBeNull();
  });
});
