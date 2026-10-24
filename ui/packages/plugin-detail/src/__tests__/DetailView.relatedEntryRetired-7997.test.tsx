/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7997 — the RUNTIME half of the retirement: `DetailView` no longer
 * renders a related section from `schema.related`, and `record:related_list`
 * still renders one through the very same component.
 *
 * ## Why both halves live in one file
 *
 * A retirement pinned only by absence is equally green against a tree where the
 * whole feature was deleted, or where the renderer failed to mount. The
 * maintainer retired a DOOR, not the capability:
 *
 * > 关掉详情页那个入口（推荐）
 *
 * So absence alone is the wrong shape of evidence. Every absence row here is
 * paired with a positive on the SAME `RelatedList` component the retired branch
 * used to feed — `renderers/record-related-list.tsx` renders it — which is what
 * makes "the door closed" separable from "the room is gone".
 *
 * ## The casts are load-bearing
 *
 * `DetailViewSchema.related` is a `?: never` tombstone, so these fixtures
 * cannot be authored without a cast — that IS the TypeScript half of the
 * refusal, pinned in `packages/types`. They are cast anyway so the RUNTIME half
 * is read: a host that ignores `tsc`, or a plain JSON document that reaches the
 * renderer without passing the zod mirror, still gets nothing rendered rather
 * than a silently honoured second door.
 *
 * ## The firing control, MEASURED — this file reddens when the entry is open
 *
 * An absence pin that cannot fail is decoration. The retirement was ablated ON
 * DISK by restoring `DetailView.tsx` from the pre-retirement commit — the entry
 * open again, everything else on the branch unchanged — proved present by blob
 * hash and by an on-disk marker count (`effectiveRelated`: 0 -> 6), and this
 * file was run against it. Result: **3 failed | 2 passed**.
 *
 * WHAT FIRED — every absence row, and only those:
 *
 *   - `renders no related section, no heading and no rows` —
 *     `expected document not to contain element, found SPAN`
 *   - `grows no Related TAB either, under autoTabs` —
 *     `expected document not to contain element, found BUTTON` (the tab trigger)
 *   - `with ONLY the retired key authored, autoTabs renders no tab strip at all` —
 *     `expected [ BUTTON, …(1) ] to have a length of +0 but got 2`
 *
 * WHAT STAYED GREEN, correctly — the two CONTROL rows. "the rest of the node
 * renders" and "the SAME RelatedList component still renders a related list"
 * are true on both sides of the ablation, which is exactly what makes them
 * controls rather than firing rows: they separate "the door closed" from "the
 * component broke" and from "the room is gone".
 *
 * The file was restored from the saved retired blob and the restoration was
 * verified by HASH (⛔ not by an exit code, and ⛔ not by `git diff HEAD`, which
 * is non-empty here by construction — the retirement is the diff).
 *
 * ## Desktop, pinned rather than inherited (objectui#8399)
 *
 * `RelatedList` reads `useIsMobile` (breakpoint 768): above it a `type="table"`
 * list renders a real `data-table` with header cells, below it a card layout
 * with neither. The positive rows read rendered text either way, but the width
 * is set explicitly rather than inherited from happy-dom's ambient 1024.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { DetailViewSchema } from '@object-ui/types';
import { DetailView } from '../DetailView';
import { RelatedList } from '../RelatedList';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const RELATED_ROWS = [
  { id: 'c1', name: 'Ada Lovelace', status: 'planned' },
  { id: 'c2', name: 'Alan Turing', status: 'running' },
];

const fields = {
  name: { type: 'text', label: 'Full Name' },
  status: {
    type: 'select',
    label: 'Stage',
    options: [
      { value: 'planned', label: 'Planned' },
      { value: 'running', label: 'Running' },
    ],
  },
};

const makeDS = () => ({
  find: vi.fn(async () => RELATED_ROWS),
  getObjectSchema: vi.fn(async () => ({ name: 'contact', fields })),
});

/** The retired authoring shape, exactly as the README and the docs taught it. */
const withRelated = {
  type: 'detail-view',
  title: 'Account Details',
  data: { name: 'Acme Corp' },
  fields: [{ name: 'name', label: 'Name' }],
  related: [
    {
      title: 'Contacts',
      type: 'table',
      data: RELATED_ROWS,
      columns: [{ accessorKey: 'name', header: 'Full Name' }],
    },
  ],
} as unknown as DetailViewSchema;

describe('objectui#7997 — the detail-view `related` entry is closed', () => {
  it('renders no related section, no heading and no rows', () => {
    render(<DetailView schema={withRelated} />);

    expect(screen.queryByText('Contacts')).not.toBeInTheDocument();
    expect(screen.queryByText('Related')).not.toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.queryByText('Full Name')).not.toBeInTheDocument();
  });

  it('CONTROL — the rest of the node renders, so the absences are readings', () => {
    // Without this, every assertion above would be equally green against a
    // component that threw during mount.
    render(<DetailView schema={withRelated} />);
    expect(screen.getByText('Account Details')).toBeInTheDocument();
  });

  it('grows no Related TAB either, under `autoTabs`', () => {
    // The retired branch had TWO render sites: the flat section covered above,
    // and an `autoTabs` tab with its own trigger and count badge. Retiring one
    // and leaving the other is the half-landing this row exists to catch.
    const autoTabbed = {
      ...(withRelated as unknown as Record<string, unknown>),
      autoTabs: true,
    } as unknown as DetailViewSchema;

    render(<DetailView schema={autoTabbed} />);

    expect(screen.queryByRole('tab', { name: /Related/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Contacts')).not.toBeInTheDocument();
  });

  it('with ONLY the retired key authored, `autoTabs` renders no tab strip at all', () => {
    // The tab strip is skipped when Details would be the only tab. Before this
    // card `related` alone was enough to raise a strip; it must not be now, or
    // the retirement would leave an empty second tab behind.
    const onlyRelated = {
      type: 'detail-view',
      title: 'Account Details',
      data: { name: 'Acme Corp' },
      fields: [{ name: 'name', label: 'Name' }],
      autoTabs: true,
      related: [{ title: 'Contacts', type: 'table', data: RELATED_ROWS }],
    } as unknown as DetailViewSchema;

    render(<DetailView schema={onlyRelated} />);

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByText('Account Details')).toBeInTheDocument();
  });
});

describe('objectui#7997 — the capability survives on the entry that kept it', () => {
  it('the SAME RelatedList component still renders a related list', () => {
    // THE ROW THAT MAKES THE ABSENCES MEAN "the door closed" RATHER THAN "the
    // room is gone". `renderers/record-related-list.tsx` renders exactly this
    // component, with `columns` spelled the protocol way — an array of field
    // names — which is what an author migrating off the retired key writes.
    render(
      <RelatedList
        title="Contacts"
        type="table"
        api="contact"
        objectName="contact"
        columns={['name', 'status']}
        data={RELATED_ROWS}
        dataSource={makeDS() as never}
      />,
    );

    return waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
      // Header derived from the object schema's field label, and the cell
      // rendered through the field's type — the behaviour the surviving entry
      // keeps, read here so the migration advice in the tombstone is testable
      // rather than aspirational.
      expect(screen.getByText('Stage')).toBeInTheDocument();
      expect(screen.getByText('Planned')).toBeInTheDocument();
    });
  });
});
