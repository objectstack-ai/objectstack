/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9050 step 2 — a related list whose authored `filter` does not lower
 * renders a malformed-filter state that NAMES the operator, and sends nothing.
 *
 * ## Why this file mounts `RelatedList` DIRECTLY
 *
 * Measured on this tree: `SchemaRenderer` wraps every rendered node in a
 * per-component `SchemaErrorBoundary`, so on the schema-rendered path a
 * render-time throw was already contained and already printed `error.message`.
 * `RelatedList` is ALSO exported from `@object-ui/plugin-detail`'s entry and is
 * mounted directly by `RecordRelatedListBody` and by any host embedding the
 * package outside the console — and there is no boundary of its own in this
 * package (0 non-test `ErrorBoundary` hits in `plugin-grid` / `plugin-form`
 * either). A direct mount is therefore the case where the throw escaped to the
 * host, and it is the case this file pins: before this card the render below
 * THREW out of `useMemo`, so "an alert is on screen" is not a property the old
 * tree had.
 *
 * ## The two halves, pinned apart
 *
 * 1. The state is VISIBLE and names the operator — a banner that said only
 *    "something is wrong" would satisfy containment and lose the repair.
 * 2. NOTHING was sent. The refusal must not be collapsed to `undefined`, which
 *    reads as "no filter" and would run this list unconstrained — the failure
 *    objectui#9001 closed, and the reason the ruling refuses option A.
 *
 * The positive control at the foot keeps a "fix" that refuses every filter from
 * passing: a well-formed filter still renders rows and still queries.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

// The list BODY is irrelevant here — only the panel's own state is. Same mock
// the sibling `RelatedList.addPickerFilter` test uses, for the same reason.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, SchemaRenderer: () => null };
});

const childSchema = {
  name: 'invoice_line',
  fields: {
    tags: { type: 'text', label: 'Tags' },
    qty: { type: 'number', label: 'Qty' },
  },
};

function makeDataSource() {
  return {
    getObjectSchema: vi.fn(async () => childSchema),
    find: vi.fn(async () => ({ data: [{ id: 'l1', qty: 2 }], total: 1 })),
  } as any;
}

function mount(filter: unknown, ds: any) {
  return render(
    <RelatedList
      title="Lines"
      type="table"
      api="invoice_line"
      objectName="invoice_line"
      referenceField="invoice"
      parentId="inv-1"
      columns={[{ accessorKey: 'qty', header: 'Qty' }]}
      dataSource={ds}
      filter={filter as any}
    />,
  );
}

/**
 * A STORED VIEW rule the converter refuses: `equals` is single-valued, so an
 * array comparand cannot be lowered (objectui#8557). Chosen over a `$`-dialect
 * shape because this prop is declared `ViewFilterRule[] | FilterNode` — this is
 * the shape an absent author actually saved.
 */
const REFUSED_FILTER = [{ field: 'tags', operator: 'equals', value: ['a', 'b'] }];

describe('objectui#9050 — RelatedList renders a malformed-filter state', () => {
  it('names the operator instead of throwing out of render', async () => {
    const ds = makeDataSource();
    mount(REFUSED_FILTER, ds);

    const alert = await screen.findByRole('alert');
    // The OPERATOR, asserted on the HEADLINE, ⛔ not on the banner as a whole.
    // Measured, not assumed: the technical line under the headline is the
    // converter's own message and it repeats the token, so a whole-banner
    // assertion stays GREEN when the name is removed from the headline —
    // exactly the decoration this card was told not to ship. Ablation leg B
    // (`filterRefusalSubject` returns undefined) reds THIS line and leaves the
    // two below green, which is what makes the two halves separable.
    const headline = await screen.findByTestId('related-list-malformed-filter-subject');
    expect(headline.textContent).toContain('equals');
    // …and the sentence that says what kind of problem it is. Matched on a
    // stable fragment rather than the whole copy, which is translated.
    expect(alert.textContent).toMatch(/filter is malformed/i);
  });

  it('sends no query at all — the refusal is never read as "no filter"', async () => {
    const ds = makeDataSource();
    mount(REFUSED_FILTER, ds);
    await screen.findByRole('alert');
    // Settle any effect that would have fetched.
    await waitFor(() => expect(ds.find).not.toHaveBeenCalled());
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('positive control — a well-formed filter still queries and shows no alert', async () => {
    const ds = makeDataSource();
    mount([{ field: 'tags', operator: 'equals', value: 'a' }], ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
