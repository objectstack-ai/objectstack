// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26674 — the inspector no longer offers an `External ID` switch,
 * and a field that already carries `externalId: true` keeps it.
 *
 * `field.externalId` is graded `dead` (`packages/spec/liveness/field.json`):
 * no upsert, import or seed matches on it, so the switch only invited an
 * author to rely on it. The key is NOT retired — `FieldSchema` still parses
 * it — so removing the control must never strip a stored value: the write
 * path (`{ ...def, ...patch }`) carries it through every edit.
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

describe('ObjectFieldInspector · no External ID switch (objectstack#26674)', () => {
  it('renders no External ID control, while its ADVANCED siblings still render', () => {
    renderField({ code: { type: 'text', label: 'Code' } }, 'code');

    expect(screen.queryByText('External ID')).toBeNull();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByText('Track history')).toBeInTheDocument();
  });

  it('a stored externalId does not resurrect the control', () => {
    renderField({ code: { type: 'text', label: 'Code', externalId: true } }, 'code');
    expect(screen.queryByText('External ID')).toBeNull();
  });

  it('an edit-and-save round-trip keeps a stored externalId: true', () => {
    const { savedFields } = renderField(
      { code: { type: 'text', label: 'Code', externalId: true } },
      'code',
    );

    fireEvent.change(screen.getByTestId('field-label-input'), { target: { value: 'Code x' } });

    const fields = savedFields();
    // Falsification: the edit itself landed.
    expect(fields.code.label).toBe('Code x');
    expect(fields.code.externalId).toBe(true);
  });
});
