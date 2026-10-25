// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Data pillar's grid must not issue a duplicate find() on every render —
 * objectui#4567.
 *
 * Measured on origin/main: driving the pillar and forcing three re-renders that
 * change NOTHING (same object, same fields, same refresh signal) produced one
 * extra `find()` per render — 1 -> 4. The trigger is the IDENTITY of the columns
 * array, not its contents. Three legs, all on the path this suite drives:
 *
 *   1. producer — `StudioDesignSurface`'s object-view schema built
 *      `table.fields` with `readFields(objDraft.fields).entries.map().filter()`
 *      inline, allocating a fresh array on every render;
 *   2. forward — plugin-view's ObjectView hands that array to the
 *      `renderListView` slot as `columns` BY REFERENCE
 *      (plugin-view/src/ObjectView.tsx:997 — no map/filter of its own), and in
 *      design mode there is no saved view, so it falls through to
 *      `schema.table?.fields`;
 *   3. consumer — `ListView` derives `expandFields` from `schema.columns` with
 *      that array in the memo's dep array BY IDENTITY
 *      (plugin-list/src/ListView.tsx:1245-1294), and `expandFields` is itself in
 *      the fetch effect's dep array (:1609). A fresh array therefore refetches.
 *
 * The fix is identity stabilisation at the PRODUCER (leg 1). ListView's
 * by-identity dependency is correct for a real column change and is left
 * untouched — plugin-list is read-only here.
 *
 * This suite drives the REAL producer (`DataPillar`), not a reconstruction of
 * it: the defect is a property of how that component builds its schema, so a
 * harness that built its own array would measure the harness. That is also why
 * it is a separate file from `StudioDesignSurface.gridRefresh.test.tsx`
 * (objectui#4549), which drives the slot directly and hoists its own stable
 * `columns` to work around this very defect — those tests stay as they are.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'status', label: 'Status', type: 'text' },
  ],
};

const mockClient = {
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
};

/**
 * The counting dataSource — `find` is the measurement. It answers one row:
 * with none the list draws its empty state instead of the grid, and the grid's
 * header is where its "+" column (Add field, objectui#12511) lives.
 */
function createDataSource() {
  return {
    find: vi.fn(async () => [{ id: 't1', name: 'Task one', status: 'open' }]),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => objectDef),
  };
}

/**
 * Module-scope so the `useAdapter` mock factory (hoisted) closes over the
 * binding rather than a value, and so the reference handed to the pillar is
 * STABLE across renders — an adapter that changed identity per render would
 * manufacture the very churn these tests measure.
 */
let dataSource = createDataSource();

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { addFieldFromGrid } from './__tests__/dataPillarAddField';

beforeEach(() => {
  dataSource = createDataSource();
  // A grid with a row asks the server for that row's edit verdict
  // (`POST /api/v1/security/explain`); answer it from a double so it never
  // reaches a socket. The answer does not matter here: `find` is the
  // measurement, and the verdict is a separate request.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Long enough for the mount's own fetch to settle before a measurement. */
const SETTLE_MS = 300;
const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

/**
 * Renders the real pillar under a parent that can force a no-op re-render.
 * `DataPillar` is not memoized, so a parent render re-renders it — which is
 * exactly the Studio steady state the card describes (its whole schema is a
 * fresh object literal each time).
 */
function Harness(): React.ReactElement {
  const [, force] = React.useState(0);
  return (
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <button type="button" data-testid="rerender" onClick={() => force((n) => n + 1)}>
        rerender
      </button>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>
  );
}

/** Mount, land on the auto-selected object's grid, and let the first fetch settle. */
async function mountSettledGrid(): Promise<number> {
  render(<Harness />);
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled(), { timeout: 4000 });
  await settle();
  return dataSource.find.mock.calls.length;
}

describe('Studio Data pillar grid — the columns array keeps a stable identity (#4567)', () => {
  it('three no-op re-renders issue NO extra find()', async () => {
    const before = await mountSettledGrid();

    // Nothing changes: same object, same fields, same refresh signal. Before the
    // fix each of these rebuilt `table.fields`, and one find() rode out per render.
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));
    fireEvent.click(screen.getByTestId('rerender'));
    await settle();

    expect(dataSource.find.mock.calls.length).toBe(before);
  });

  /**
   * Identity-churn liveness: the columns dependency must stay LIVE against a
   * FRESH ARRAY — not be defeated by a producer-side memo that freezes the
   * columns or constant-folds them. This pin is green before and after the
   * #4567 fix on purpose; it is a must-not-change, not a red-first case.
   *
   * ⚠️ What this case drives is NOT a content change, and this docstring used
   * to say that it was ("a REAL column change still refetches"). cloud#1652 is
   * what moved it out from under that sentence: `gridColumns` gained a trailing
   * `.filter((n) => publishedFieldNames.has(n))`, and `publishedFieldNames` is
   * read from the SERVER baseline alone (the `layered()` response), never from
   * the draft. "+ Add field" appends an UNPUBLISHED `field_<N>` to
   * `objDraft.fields`, so the memo recomputes — new `fields`, hence a new array
   * — and that same filter then removes `field_<N>` again. What reaches the grid
   * is therefore an array of EQUAL CONTENT carrying a FRESH IDENTITY.
   *
   * Measured on origin/main while correcting this docstring (objectui#6729):
   * across the click `find()` goes 1 -> 2 while `$select` is
   * `["id","name","status"]` both before and after, and no `field_` ever reaches
   * the projection. So the refetch asserted below can only have arrived through
   * the column-IDENTITY dependency chain — and there is no remount to explain it
   * either: the grid's key is `${current.name}:${gridVer}`, and `gridVer` does
   * not move.
   *
   * ⛔ Do not read this as covering "columns whose CONTENT changed must still
   * refetch". That case is real, and it is pinned elsewhere — plugin-list's
   * `ListView.discardedExpandFieldsMemo.test.tsx` (objectui#6697), which moves
   * `$select` while holding `$expand` byte-identical. Taking the old sentence at
   * face value already cost one round: #6697's implementer concluded the content
   * case was covered here, and had to add it there.
   */
  it('a fresh columns array of EQUAL content still refetches — identity-churn liveness', async () => {
    const before = await mountSettledGrid();

    await addFieldFromGrid();

    await waitFor(() => expect(dataSource.find.mock.calls.length).toBeGreaterThan(before), {
      timeout: 4000,
    });
  });
});
