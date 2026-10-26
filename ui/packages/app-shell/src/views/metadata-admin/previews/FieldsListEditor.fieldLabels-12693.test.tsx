// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12693 — the column manager's rows read the field's label.
 *
 * The Interfaces pillar's LIST VIEW properties draw a view's Columns through
 * this editor, and a list view stores its columns as bare field names. Each row
 * printed that name although the object's field catalog — the one the
 * inspector hands in — carries the field's label. Now:
 *
 *  - a bare-string column's row reads the catalog label, and keeps the field
 *    name reachable on its `title`;
 *  - the stored `columns` stay field names through an edit;
 *  - CONTROL: a name the catalog does not know stays the text, with no
 *    `title`; an object column's own `label` still wins over the catalog's.
 *
 * Mounted the way `ObjectListViewInspector` mounts it: `variantKey="config"`,
 * string columns, the catalog passed as `objectFieldsOverride`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// `useObjectFields` short-circuits the fetch when handed a catalog, but still
// constructs the shared metadata client — stub it so no test reaches the
// network. Same mechanism as FieldsListEditor.retiredAliases.test.tsx.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { FieldsListEditor } from './FieldsListEditor';

afterEach(cleanup);

const CATALOG = [
  { name: 'title', label: 'Widget Name', type: 'text', hidden: false },
  { name: 'owner_ref', label: 'Owner Ref', type: 'lookup', hidden: false },
  { name: 'status', label: 'Status', type: 'select', hidden: false },
];

function mount(columns: unknown[], allStrings = true) {
  const onPatch = vi.fn();
  render(
    <FieldsListEditor
      variantKey="config"
      schema={{ type: 'grid', columns }}
      columns={columns}
      allStrings={allStrings}
      objectName="uxscratch_widget"
      objectFieldsOverride={CATALOG}
      selectedIndex={null}
      onPatch={onPatch}
    />,
  );
  return onPatch;
}

/** The text each row draws as its primary label, in order. */
const rowLabels = () =>
  screen.getAllByRole('button', { pressed: false }).map((row) => row.querySelector('span.font-medium')?.textContent);

describe('the column manager names a column by its field label (objectui#12693)', () => {
  it("draws each bare-string column by the catalog's label, the field name on its title", () => {
    mount(['title', 'owner_ref']);

    expect(rowLabels()).toEqual(['Widget Name', 'Owner Ref']);
    expect(screen.getByText('Widget Name')).toHaveAttribute('title', 'title');
    expect(screen.getByText('Owner Ref')).toHaveAttribute('title', 'owner_ref');
  });

  it('keeps the stored columns as field names through an edit', () => {
    const onPatch = mount(['title', 'owner_ref', 'status']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Owner Ref' }));

    expect(onPatch).toHaveBeenCalledWith({ config: { type: 'grid', columns: ['title', 'status'] } });
  });

  it('CONTROL: a name the catalog does not know stays the text, with no title', () => {
    mount(['title', 'gone_field']);

    expect(rowLabels()).toEqual(['Widget Name', 'gone_field']);
    expect(screen.getByText('gone_field')).not.toHaveAttribute('title');
  });

  it("CONTROL: an object column's own label wins over the catalog's", () => {
    mount([{ field: 'title', label: 'Headline' }, { field: 'owner_ref' }], false);

    expect(rowLabels()).toEqual(['Headline', 'Owner Ref']);
    expect(screen.getByText('Headline')).toHaveAttribute('title', 'title');
  });
});
