// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that the field designer no longer offers an `Indexed` control, and that
 * a draft already carrying the key stops blocking saves (objectui#4644).
 *
 * Measured on `@objectstack/console` 17.0.0 GA: the ADVANCED section rendered
 * `Read-only · Hidden · Indexed · External ID · Track history`, `Indexed` was
 * enabled on a plain field, and ticking it produced
 *
 *   PUT /api/v1/meta/object/probe_widget?mode=draft → HTTP 422
 *   {"code":"INVALID_METADATA","error":"… fields.owner_id: Unrecognized
 *     key(s) on this field: `indexed`. …"}
 *
 * The draft did not save and the toggle stayed ticked, so every later save of
 * the object stayed blocked. `FieldSchema` has no field-level index flag at
 * all — the real surface is object-level `indexes: [{ name, fields, unique }]`.
 *
 * Two directions are pinned, because removing the control is only half of it:
 *   - the ADVANCED section's control set, so the toggle cannot quietly return;
 *   - an edit-and-save round-trip of an ALREADY-poisoned draft, which the
 *     inspector's write path (`{ ...def, ...patch }`) would otherwise carry
 *     back out verbatim — with no control left on screen to clear it.
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
  /** The fields map the host's Save would persist after the last edit. */
  const savedFields = () =>
    onPatch.mock.calls.at(-1)![0].fields as Record<string, Record<string, unknown>>;
  return { onPatch, savedFields };
}

describe('ObjectFieldInspector · the Indexed toggle is retired (objectui#4644)', () => {
  it('renders no Indexed control on a plain field', () => {
    renderField({ owner_id: { type: 'lookup', label: 'Owner' } }, 'owner_id');

    expect(screen.queryByText('Indexed')).toBeNull();
    // The siblings that share the ADVANCED row are still there — this is a
    // targeted retirement, not a section that failed to render.
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByText('External ID')).toBeInTheDocument();
    expect(screen.getByText('Track history')).toBeInTheDocument();
  });

  it('renders no Indexed control even on a draft that already carries the key', () => {
    // The GA symptom was a ticked toggle the author had to find and clear.
    // A stored value must not resurrect the control that wrote it.
    renderField({ owner_id: { type: 'lookup', indexed: true } }, 'owner_id');
    expect(screen.queryByText('Indexed')).toBeNull();
  });

  it('an edit-and-save round-trip of a poisoned draft comes out clean', () => {
    const { savedFields } = renderField(
      { owner_id: { type: 'lookup', label: 'Owner', indexed: true } },
      'owner_id',
    );

    // Any edit re-emits the whole fields map; the label is the cheapest.
    fireEvent.change(screen.getByTestId('field-label-input'), { target: { value: 'Owner x' } });

    const fields = savedFields();
    expect('indexed' in fields.owner_id).toBe(false);
    // Falsification: the edit itself still landed, and the live keys survived.
    expect(fields.owner_id.label).toBe('Owner x');
    expect(fields.owner_id.type).toBe('lookup');
  });

  it('clears the key on a field the author never opened', () => {
    // One 422 names one field, but the whole object is re-serialised on save:
    // a poisoned sibling would keep the save blocked after the named one was
    // fixed, which is the loop the GA report describes.
    const { savedFields } = renderField(
      {
        owner_id: { type: 'lookup', label: 'Owner', indexed: true },
        code: { type: 'text', label: 'Code', indexed: true },
      },
      'owner_id',
    );

    fireEvent.change(screen.getByTestId('field-label-input'), { target: { value: 'Owner x' } });

    const fields = savedFields();
    expect('indexed' in fields.owner_id).toBe(false);
    expect('indexed' in fields.code).toBe(false);
    expect(fields.code.label).toBe('Code');
  });
});
