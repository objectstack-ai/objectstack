/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6677 — an object-bound grid whose rows arrive from a HOST must still
 * render the object-schema default-columns policy, not the row payload's keys.
 *
 * ## The defect
 *
 * `generateColumns()` has three default paths and used to check them in this
 * order: authored `columns` → the inline-data path → the object-schema path.
 * The inline-data path is gated on `hasInlineData` (`dataConfig.provider ===
 * 'value'`), and `dataConfig` is built as `provider: 'value'` from the `data`
 * PROP before anything else. Its projection is `schemaFields ||
 * Object.keys(inlineData[0])` — the FIRST ROW'S KEYS.
 *
 * A fetching host always passes `data`. `ListView` with no authored columns
 * sends `{ objectName, fields: undefined, columns: undefined }` alongside the
 * rows it fetched, so `schemaFields` is absent and the projection fell all the
 * way through to the payload keys. The object-schema path — the one carrying
 * the documented policy (`highlightFields` first; else drop `hidden`, drop
 * readonly system-managed, push the remaining system/ownership columns to the
 * end) — was unreachable for EVERY object-bound grid reached through a host.
 * The branch that knows the object was the one that never ran.
 *
 * Measured on the same page / source / object with one variable — who fetches:
 *
 *   grid fetches  → 5 columns: Opportunity Name / Stage / Amount / Close Date / Owner
 *   host fetches  → 10 columns: Id, …, Created At, Created By, Updated At, Updated By
 *
 * `id` was `hidden: true` and the bookkeeping fields `system` — exactly what
 * the policy exists to keep off a default list.
 *
 * ## What is asserted, and why the absence half is load-bearing
 *
 * The extras are APPENDED to a superset, not substituted for the five. A test
 * that only checked "the five are present" passes on the broken build too, so
 * the `id`/audit ABSENCE assertions are what make this pin discriminate.
 *
 * ## RED-FIRST — measured on the merge-base (98188c284), this file only
 *
 * 3 red / 4 green. The reds:
 *
 *   ✗ renders the schema policy's five columns, not the payload's ten
 *       → AssertionError: expected [ 'Id', 'Opportunity Name', …(8) ] to
 *         deeply equal [ 'Opportunity Name', 'Stage', …(3) ]
 *   ✗ never appends the payload-only keys once the schema has loaded
 *       → AssertionError: expected [ 'Id', 'Opportunity Name', …(8) ] to have
 *         a length of 5 but got 10
 *   ✗ TRANSITION: the policy takes over once the schema resolves
 *       → AssertionError: expected [ 'Id', 'Opportunity Name', …(8) ] to
 *         deeply equal [ 'Opportunity Name', 'Stage', …(3) ]
 *
 * The elided members are the ten of `PAYLOAD_COLUMNS_LABELLED` below. After the
 * fix, 7 green in the same file.
 *
 * The four greens are boundaries the reorder must not cross — controls, not a
 * restatement of the fix:
 *
 *   - inline data with NO object behind it still derives from the row keys
 *     (the "Legacy support" path is reordered, never deleted);
 *   - an authored `fields` projection is still honoured verbatim when the rows
 *     come from a host — including a key the object schema does not declare.
 *     It is the row-key FALLBACK that yields to the policy, not the whole
 *     path, so an author who asks for an audit column or a host-joined key by
 *     name still gets it;
 *   - first paint with the schema still IN FLIGHT renders the row-key columns
 *     rather than an empty header row. This is the case the naive reorder
 *     (gate the legacy path on `objectName` alone) gets wrong: `objectSchema`
 *     is `null` until an async fetch lands, so that gate falls through to
 *     `if (!objectSchema) return []` and paints ZERO data columns first — a
 *     worse defect than the one being fixed. Pinned in both directions: the
 *     control above holds the first paint, the third red holds the flip.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

/**
 * The object from the measurement. Declaration order is the POLICY's output
 * order (`Object.keys(fields)`), which is deliberately NOT the payload's key
 * order below — that difference is what lets the two column sets be told apart
 * by content rather than by luck.
 *
 * `owner_id` is the interesting one: framework-injected and `system`, but NOT
 * readonly (ownership is reassignable), so the policy KEEPS it and pushes it to
 * the end rather than dropping it. That is why the expected set is five, not
 * four.
 */
const OPPORTUNITY_SCHEMA = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    name: { type: 'text', label: 'Opportunity Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'proposal', label: 'Proposal' },
        { value: 'won', label: 'Won' },
      ],
    },
    amount: { type: 'currency', label: 'Amount', currency: 'USD' },
    close_date: { type: 'date', label: 'Close Date' },
    owner_id: { type: 'lookup', label: 'Owner', reference: 'user', system: true },
    id: { type: 'text', label: 'Id', hidden: true, system: true, readonly: true },
    created_at: { type: 'datetime', label: 'Created At', system: true, readonly: true },
    created_by: { type: 'lookup', label: 'Created By', reference: 'user', system: true, readonly: true },
    updated_at: { type: 'datetime', label: 'Updated At', system: true, readonly: true },
    updated_by: { type: 'lookup', label: 'Updated By', reference: 'user', system: true, readonly: true },
  },
};

/** The policy's answer for `OPPORTUNITY_SCHEMA` — business fields, ownership last. */
const POLICY_COLUMNS = ['Opportunity Name', 'Stage', 'Amount', 'Close Date', 'Owner'];

/**
 * What the payload's keys derive to once the schema HAS loaded — the legacy
 * path labels each key from `objectSchema.fields[key].label`, so this is the
 * ten-column set the issue measured on screen.
 */
const PAYLOAD_COLUMNS_LABELLED = [
  'Id', 'Opportunity Name', 'Amount', 'Stage', 'Close Date', 'Owner',
  'Created At', 'Created By', 'Updated At', 'Updated By',
];

/**
 * The same keys with NO schema to label them — the legacy path's own
 * humanisation (`charAt(0).toUpperCase() + slice(1).replace(/_/g, ' ')`).
 * This is what "no object behind the data" and "schema still in flight" look
 * like, and it is how those two cases are told apart from the labelled one.
 */
const PAYLOAD_COLUMNS_HUMANISED = [
  'Id', 'Name', 'Amount', 'Stage', 'Close date', 'Owner id',
  'Created at', 'Created by', 'Updated at', 'Updated by',
];

/** The five the policy exists to keep off a default list. */
const EXCLUDED_BY_POLICY = ['Id', 'Created At', 'Created By', 'Updated At', 'Updated By'];

/** Rows exactly as a fetching host hands them down — every stored key present. */
const HOST_ROWS = [
  {
    id: 'opp-1',
    name: 'Acme expansion',
    amount: 42000,
    stage: 'proposal',
    close_date: '2026-09-30',
    owner_id: 'u-1',
    created_at: '2026-08-01T10:00:00Z',
    created_by: 'u-9',
    updated_at: '2026-08-20T10:00:00Z',
    updated_by: 'u-9',
  },
];

function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    // A host owns the fetch, so the grid must never call this. Asserted below.
    find: vi.fn(async () => ({ data: [], total: 0 })),
    getObjectSchema: vi.fn(async () => OPPORTUNITY_SCHEMA),
    ...overrides,
  } as any;
}

/**
 * The DATA columns' header labels, in render order.
 *
 * Two kinds of furniture are dropped: cells with no header text (selection
 * checkbox, row-action kebab) and the row-index column, whose header is a
 * literal `#`. What is left is exactly the derived data columns.
 */
function dataHeaders(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('thead th'))
    .map((th) => (th.textContent ?? '').trim())
    .filter((text) => text.length > 0 && text !== '#');
}

function renderHostFedGrid(schemaOverrides: Record<string, unknown> = {}, dataSource?: any) {
  const ds = dataSource ?? makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: 'opportunity',
    ...schemaOverrides,
  };
  const utils = render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds} data={HOST_ROWS} />
    </ActionProvider>,
  );
  return { ...utils, ds };
}

describe('ObjectGrid — host-fetched rows still get the object-schema policy (#6677)', () => {
  it('renders the schema policy\'s five columns, not the payload\'s ten', async () => {
    const { container, ds } = renderHostFedGrid();

    await waitFor(() => expect(screen.getByText('Acme expansion')).toBeInTheDocument());
    await waitFor(() => expect(dataHeaders(container)).toEqual(POLICY_COLUMNS));

    // The absence half. The broken build APPENDS the excluded five to a
    // superset, so a presence-only check passes there too.
    const headers = dataHeaders(container);
    for (const excluded of EXCLUDED_BY_POLICY) {
      expect(headers).not.toContain(excluded);
    }

    // The host owns the fetch; the grid must not have gone looking for rows.
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('never appends the payload-only keys once the schema has loaded', async () => {
    const { container, ds } = renderHostFedGrid();

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('opportunity'));
    await waitFor(() => expect(dataHeaders(container)).toHaveLength(POLICY_COLUMNS.length));
    expect(dataHeaders(container)).not.toEqual(expect.arrayContaining(EXCLUDED_BY_POLICY));
    expect(dataHeaders(container)).not.toEqual(PAYLOAD_COLUMNS_LABELLED);
  });

  it('TRANSITION: the policy takes over once the schema resolves', async () => {
    let releaseSchema: ((schema: unknown) => void) | undefined;
    const pending = new Promise((resolve) => { releaseSchema = resolve; });
    const ds = makeDataSource({ getObjectSchema: vi.fn(() => pending) });

    const { container } = renderHostFedGrid({}, ds);
    // objectui#10657: with the schema in flight an untyped column is WITHHELD
    // (drawn as the mask, never as text), so the row is waited for by its mask,
    // not by the raw name it used to print.
    await waitFor(() => expect(container.querySelector('tbody')?.textContent ?? '').toContain('••••••'));
    expect(screen.queryByText('Acme expansion')).toBeNull();

    releaseSchema!(OPPORTUNITY_SCHEMA);

    await waitFor(() => expect(dataHeaders(container)).toEqual(POLICY_COLUMNS));
  });

  /* ---------------------------------------------------------------- *
   * Boundaries — green in BOTH worlds. Controls, not restatements.    *
   * ---------------------------------------------------------------- */

  it('CONTROL: inline data with no object behind it still derives from the row keys', async () => {
    const { container } = render(
      <ActionProvider>
        <ObjectGrid schema={{ type: 'object-grid' } as any} data={HOST_ROWS} />
      </ActionProvider>,
    );

    await waitFor(() => expect(screen.getByText('Acme expansion')).toBeInTheDocument());
    // No `objectName`, so no schema can outrank anything: the "Legacy support"
    // path is still the right answer and still runs.
    expect(dataHeaders(container)).toEqual(PAYLOAD_COLUMNS_HUMANISED);
  });

  it('CONTROL: an authored `fields` projection is honoured verbatim over host rows', async () => {
    const { container, ds } = renderHostFedGrid({ fields: ['name', 'created_at'] });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Acme expansion')).toBeInTheDocument());

    // The author asked for an audit column BY NAME. The policy drops that field
    // from its DEFAULTS; it must not veto an explicit request.
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name', 'Created At']));
  });

  it('CONTROL: an authored `fields` key the object schema does not declare survives', async () => {
    const { container, ds } = renderHostFedGrid({ fields: ['name', 'computed_score'] });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Acme expansion')).toBeInTheDocument());

    // A host may join or derive keys that are not object fields. The row-key
    // FALLBACK is what yields to the policy — an authored projection does not,
    // and the schema path would silently drop `computed_score` (`if (!field)
    // return;`). That is why the reorder is gated on `!schemaFields`.
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name', 'Computed score']));
  });

  it('CONTROL: first paint with the schema in flight shows the row keys, never zero columns', async () => {
    const pending = new Promise(() => { /* never resolves */ });
    const ds = makeDataSource({ getObjectSchema: vi.fn(() => pending) });

    const { container } = renderHostFedGrid({}, ds);
    // objectui#10657: with the schema in flight an untyped column is WITHHELD
    // (drawn as the mask, never as text), so the row is waited for by its mask,
    // not by the raw name it used to print.
    await waitFor(() => expect(container.querySelector('tbody')?.textContent ?? '').toContain('••••••'));
    expect(screen.queryByText('Acme expansion')).toBeNull();

    // `objectSchema` is still `null`. Gating the legacy path on `objectName`
    // alone would fall through to `if (!objectSchema) return []` and paint an
    // empty header row here.
    expect(dataHeaders(container).length).toBeGreaterThan(0);
    expect(dataHeaders(container)).toEqual(PAYLOAD_COLUMNS_HUMANISED);
  });
});
