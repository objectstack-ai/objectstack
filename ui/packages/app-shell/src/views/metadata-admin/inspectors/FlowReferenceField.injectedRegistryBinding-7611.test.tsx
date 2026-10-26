// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7611 Q3b — the designer's FALLBACK, under the spec the console
 * objectstack ships is bundled with.
 *
 * objectstack builds its console with its own `packages/spec` injected
 * (`OBJECTSTACK_SPEC_DIST`), and that spec binds `position` to the registry
 * (objectstack#22710). Its `APPROVER_VALUE_SOURCES.position` is therefore
 * `{ source: 'registry', type: 'position' }`, so the spec-derived
 * `KIND_TO_RECORD_LOOKUP` carries no `position` — and with no published
 * `xRef.sources` entry to read, the approver Value cell had nothing left but a
 * plain text box. This file mocks the spec into that shape: the projection is
 * the bundled spec's own object, so this is what the shipped bundle evaluates.
 *
 * Pinned: the fallback reads the bundled binding's registry member and renders
 * the registry select, while the record kinds keep their lookups.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => {
  const metaList = vi.fn(async (_type: string) => [] as unknown[]);
  return { metaList, metadataClient: { list: metaList } };
});

vi.mock('@objectstack/spec/automation', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const sources = actual.APPROVER_VALUE_SOURCES as Record<string, unknown>;
  return {
    ...actual,
    // objectstack#22710's projection of `position` — the injected spec's shape.
    APPROVER_VALUE_SOURCES: { ...sources, position: { source: 'registry', type: 'position' } },
  };
});
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({ find: async () => ({ data: [] }) }),
  // @object-ui/components wires this at module scope (related-count-store).
  subscribeDataChanges: () => () => {},
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  LookupField: (props: { field?: { reference?: string } }) => (
    <div data-testid="record-lookup" data-object={props.field?.reference} />
  ),
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [] }),
}));

import { ReferenceCombobox, KIND_TO_RECORD_LOOKUP, KIND_TO_REGISTRY_TYPE } from './FlowReferenceField';

afterEach(() => {
  cleanup();
  state.metaList.mockReset();
  state.metaList.mockImplementation(async () => []);
});

describe('the approver Value fallback under a registry-binding spec (objectui#7611 Q3b)', () => {
  it('derives position into the registry table and out of the record table', () => {
    expect(KIND_TO_REGISTRY_TYPE).toEqual({ position: 'position' });
    expect(KIND_TO_RECORD_LOOKUP.position).toBeUndefined();
    // The record arm is untouched.
    expect(Object.keys(KIND_TO_RECORD_LOOKUP).sort()).toEqual(['department', 'team', 'user']);
  });

  it('renders the registry select for a position with no published source', async () => {
    state.metaList.mockImplementation(async () => [{ name: 'manager', label: 'Manager' }]);
    render(<ReferenceCombobox resolved={{ kind: 'position' }} value="manager" onCommit={vi.fn()} />);
    const cell = await screen.findByTestId('registry-pick');
    expect(cell.getAttribute('data-registry-type')).toBe('position');
    await vi.waitFor(() => expect(cell.getAttribute('data-mode')).toBe('select'));
    expect(state.metaList).toHaveBeenCalledWith('position');
    expect(screen.getByRole('combobox').textContent).toContain('Manager (manager)');
    expect(screen.queryByTestId('record-lookup')).toBeNull();
  });

  it('keeps the record lookup for a directory kind', () => {
    render(<ReferenceCombobox resolved={{ kind: 'team' }} value="" onCommit={vi.fn()} />);
    expect(screen.getByTestId('record-lookup').getAttribute('data-object')).toBe('sys_team');
    expect(screen.queryByTestId('registry-pick')).toBeNull();
  });
});
