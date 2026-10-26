// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inspector does not COMMIT an erase (objectui#9372).
 *
 * ## Why this file exists next to the pure one
 *
 * `datasetFilterCondition.unmappedInert-9372.test.ts` pins the decision —
 * {@link isClearedGroup} tells the author's CLEAR gesture apart from a
 * serialization that produced nothing. A decision nobody consults is a channel
 * with no reader, and the pure file cannot tell the difference: it would stay
 * green with the guard sitting unused beside the old `onCommit(...)` call.
 *
 * This file drives the real component, with the real `FilterBuilder` mounted
 * inside it, and watches the ONE thing that caused the data loss — the patch.
 *
 * ## The gesture, and why it is the value and not the operator menu
 *
 * The card's route is an operator pick, but the same defect is reachable by
 * blanking the VALUE of the only row, with no operator involved at all: the
 * incomplete-row `continue` drops it, the last part goes, and the commit is
 * `undefined`. The host applies patches as `{ ...draft, ...patch }`, so that
 * commit SETS `filter` to `undefined` — the patch shape `objectChangePatch`
 * uses deliberately to erase it. Blanking a text input is also the one gesture
 * that needs no Radix listbox interaction, so this pin holds without driving a
 * select open in a headless DOM.
 *
 * ## The control
 *
 * "`onPatch` was not called" is also what an unopened popover, a mis-queried
 * input and a dead handler all look like. So the same file types a REAL value
 * through the same input and asserts the patch that produces — if that control
 * stops firing, the absence below stops meaning anything.
 */
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Stub the catalog hooks so the inspector renders without a MetadataClient /
// network, but with ONE text field so the filter popover has something to draw.
vi.mock('./useDatasetFields', () => ({
  useObjectOptions: () => ({ options: [], loading: false }),
  useDatasetFieldCatalog: () => ({
    relationships: [],
    fieldOptions: [{ value: 'name', label: 'Name', type: 'text' }],
    loading: false,
  }),
  useDatasetUsage: () => ({ reports: 0, dashboards: 0, loading: false }),
  fieldTypeToDimensionType: (t: string) => (t === 'date' ? 'date' : 'string'),
}));

import { DatasetDefaultInspector } from './DatasetDefaultInspector';

afterEach(cleanup);

const baseProps = { type: 'dataset', name: 'sales', locale: 'en-US' as const };

/** A dataset whose filter is ALREADY stored — the thing that got destroyed. */
const draft = {
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  include: [],
  dimensions: [],
  measures: [],
  filter: { name: { $eq: 'acme' } },
};

/** The inspector's patch channel, typed as the component declares it. */
type PatchSpy = Mock<(patch: Record<string, unknown>) => void>;
const patchSpy = (): PatchSpy => vi.fn<(patch: Record<string, unknown>) => void>();

/** Render, open the Scope filter popover, and hand back the row's value input. */
function openScopeFilter(onPatch: PatchSpy) {
  render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={onPatch} readOnly={false} />);
  // The trigger summarises the stored filter; seeing it at all is already a
  // reading that `conditionToGroup` found the stored shape representable.
  fireEvent.click(screen.getByText('1 condition'));
  return screen.getByDisplayValue('acme') as HTMLInputElement;
}

describe('DatasetDefaultInspector — a filter edit that cannot be stored commits nothing (objectui#9372)', () => {
  it('CONTROL: typing a real value still commits it, so the absence below is about the blank', () => {
    const onPatch = patchSpy();
    const input = openScopeFilter(onPatch);
    fireEvent.change(input, { target: { value: 'contoso' } });
    expect(onPatch).toHaveBeenCalledWith({ filter: { name: { $eq: 'contoso' } } });
  });

  it('THE DEFECT: blanking the only row\'s value does NOT patch `filter` to undefined', () => {
    const onPatch = patchSpy();
    const input = openScopeFilter(onPatch);
    fireEvent.change(input, { target: { value: '' } });
    // Before the repair this called `onPatch({ filter: undefined })`, which the
    // host spreads over the draft — the stored filter destroyed, nothing shown
    // to the author, and `JSON.stringify` then omits the key on save.
    for (const [patch] of onPatch.mock.calls) {
      expect(
        patch,
        'the inspector committed a patch carrying `filter`; if it is undefined, that ERASES the stored filter',
      ).not.toHaveProperty('filter');
    }
  });

  it('and the author\'s own CLEAR gesture still reaches the draft', () => {
    // The other half: "Clear all" empties the group, which IS the clear
    // gesture, and must still commit `undefined`. Without this the repair
    // could have been a blanket "never commit undefined", stranding the filter
    // an author asked to remove.
    const onPatch = patchSpy();
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={onPatch} readOnly={false} />);
    fireEvent.click(screen.getByText('1 condition'));
    fireEvent.click(screen.getByText('Clear all'));
    expect(onPatch).toHaveBeenCalledWith({ filter: undefined });
  });
});
