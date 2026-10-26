/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9022 — drawer / navigate PARITY: one drill, one scope.
 *
 * The card's discriminator is that the two arms of the SAME drill disagreed.
 * The drawer arm renders `object-data-table`, whose fetch resolves the filter
 * placeholders itself, so it has always queried the RESOLVED scope. The
 * navigate arm — and the "Open in list →" button in the drawer's own header —
 * went through the host's `openRecordList`, which wrote the authored literal
 * into the URL. So `{current_user_id}` meant "my records" in the drawer and
 * meant a string nobody owns on the list page, decided only by
 * `drillDown.target`.
 *
 * These mount the REAL `DrillDownDrawer` (plugin-dashboard) over the REAL
 * `useOpenRecordList`, wired the way `DashboardView` / `ReportView` wire them,
 * and compare the two arms' DESTINATION SCOPES:
 *
 *   - drawer   → the `$filter` handed to `dataSource.find`;
 *   - navigate → the triples the bare data surface reads back out of the URL;
 *   - header   → the same, via `OpenInListButton`.
 *
 * ## Why the comparison runs through the URL codec
 *
 * The two arms speak different dialects — an ObjectQL filter object and
 * `filter[...]` params. They are compared by pushing the drawer arm's object
 * through the repo's OWN encoder/parser pair, which is the dialect the
 * destination already speaks and is pinned separately in `drillUrlFilters.test.ts`.
 *
 * ⚠️ Equality alone would also hold if BOTH arms carried the literal, which is
 * exactly the state before the fix. So every parity case additionally asserts
 * the resolved value is present — the two assertions are not redundant, they
 * fail in different worlds.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { DrillNavigationProvider, FilterScopeProvider } from '@object-ui/react';
import { DrillDownDrawer } from '@object-ui/plugin-dashboard';
// Registers the renderers at module scope, NOT inside a hook — a cold dynamic
// transform billed to `hookTimeout` is this repo's standing flake cause.
import '@object-ui/components';
import { parseUrlFilterTriples, serializeDrillFilterParams, type FilterTriple } from './drillUrlFilters';
import { useOpenRecordList } from './useOpenRecordList';

const SCOPE = { currentUserId: 'usr_42', currentOrgId: 'org_7' };

/** A drill whose scope is a QUESTION about the session, not a constant. */
const PLACEHOLDER_FILTER = {
  owner_id: '{current_user_id}',
  close_date: { $gte: '{current_quarter_start}' },
};

/** The same drill with every value already a constant — the live control. */
const LITERAL_FILTER = {
  owner_id: 'usr_42',
  close_date: { $gte: '2026-04-01' },
};

/**
 * Where the router currently is, rendered rather than captured into a module
 * variable: a render-phase write to an outer binding is a lint error here, and
 * an effect-based capture would need its own settling window on top of the one
 * `waitFor` already gives us.
 */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <span data-testid="router-location">{`${pathname}${search}`}</span>;
}

/** The probe's current reading, or the empty string before anything mounted. */
function currentLocation(): string {
  return screen.queryByTestId('router-location')?.textContent ?? '';
}

/** The host wiring `DashboardView` and `ReportView` both use, verbatim. */
function Host({ children }: { children: React.ReactNode }) {
  const openRecordList = useOpenRecordList();
  return <DrillNavigationProvider value={{ openRecordList }}>{children}</DrillNavigationProvider>;
}

function makeDataSource() {
  const find = vi.fn(async () => ({ data: [] }));
  return { find, getObjectSchema: async () => ({ fields: {} }) };
}

/**
 * One arm, mounted alone. Each helper below calls this, so the previous arm is
 * torn down first: two live drawers would put two `drill-open-in-list` buttons
 * in the same document and the header case could not address either.
 */
function mount(
  target: 'drawer' | 'navigate',
  filter: Record<string, unknown>,
  ds: ReturnType<typeof makeDataSource>,
) {
  cleanup();
  return render(
    <MemoryRouter initialEntries={['/apps/crm/dashboard/pipeline']}>
      <FilterScopeProvider currentUserId={SCOPE.currentUserId} currentOrgId={SCOPE.currentOrgId}>
        <Routes>
          <Route
            path="/apps/:appName/*"
            element={
              <Host>
                <LocationProbe />
                <DrillDownDrawer
                  open
                  onClose={vi.fn()}
                  title="Won × Web"
                  target={target}
                  objectName="opportunity"
                  filter={filter}
                  dataSource={ds}
                />
              </Host>
            }
          />
        </Routes>
      </FilterScopeProvider>
    </MemoryRouter>,
  );
}

/** The scope the DRAWER arm queries: what the table actually asked the source for. */
async function drawerScope(filter: Record<string, unknown>): Promise<FilterTriple[]> {
  const ds = makeDataSource();
  mount('drawer', filter, ds);
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  const queried = (ds.find.mock.calls[0] as unknown as [string, { $filter: Record<string, unknown> }])[1].$filter;
  // Expressed in the dialect the destination list speaks, so the two arms are
  // comparable at all. The codec itself is pinned in `drillUrlFilters.test.ts`.
  return parseUrlFilterTriples(serializeDrillFilterParams(queried));
}

/** The scope the NAVIGATE arm lands on: what the list page will read back. */
async function navigateScope(filter: Record<string, unknown>): Promise<FilterTriple[]> {
  const ds = makeDataSource();
  mount('navigate', filter, ds);
  await waitFor(() => expect(currentLocation()).toMatch(/^\/apps\/crm\/opportunity\/data/));
  return parseUrlFilterTriples(new URLSearchParams(currentLocation().split('?')[1] ?? ''));
}

/** The scope the drawer's own header button lands on (`OpenInListButton`). */
async function openInListScope(filter: Record<string, unknown>): Promise<FilterTriple[]> {
  const ds = makeDataSource();
  mount('drawer', filter, ds);
  fireEvent.click(await screen.findByTestId('drill-open-in-list'));
  await waitFor(() => expect(currentLocation()).toMatch(/^\/apps\/crm\/opportunity\/data/));
  return parseUrlFilterTriples(new URLSearchParams(currentLocation().split('?')[1] ?? ''));
}

afterEach(cleanup);

describe('drill parity — the navigate arm lands where the drawer arm queries (objectui#9022)', () => {
  it('navigate lands on the same scope the drawer queries, with the session token expanded', async () => {
    const viaDrawer = await drawerScope(PLACEHOLDER_FILTER);
    const viaNavigate = await navigateScope(PLACEHOLDER_FILTER);

    // Both arms agree…
    expect(viaNavigate).toEqual(viaDrawer);
    // …and they agree on the RESOLVED value, not on the literal they used to
    // share in the other direction.
    expect(viaNavigate).toContainEqual(['owner_id', '=', 'usr_42']);
    expect(JSON.stringify(viaNavigate)).not.toContain('current_user_id');
  });

  it('the date macro lands as a real date on both arms', async () => {
    const viaDrawer = await drawerScope(PLACEHOLDER_FILTER);
    const viaNavigate = await navigateScope(PLACEHOLDER_FILTER);

    const bound = (triples: FilterTriple[]) =>
      String(triples.find(([field, op]) => field === 'close_date' && op === '>=')?.[2]);

    expect(bound(viaNavigate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bound(viaNavigate)).toBe(bound(viaDrawer));
  });

  it('the drawer header escape hatch lands on that same scope', async () => {
    const viaDrawer = await drawerScope(PLACEHOLDER_FILTER);
    const viaButton = await openInListScope(PLACEHOLDER_FILTER);

    expect(viaButton).toEqual(viaDrawer);
    expect(viaButton).toContainEqual(['owner_id', '=', 'usr_42']);
  });

  it('CONTROL — a placeholder-free drill is unchanged on every arm', async () => {
    const expected: FilterTriple[] = [
      ['owner_id', '=', 'usr_42'],
      ['close_date', '>=', '2026-04-01'],
    ];

    expect(await drawerScope(LITERAL_FILTER)).toEqual(expected);
    expect(await navigateScope(LITERAL_FILTER)).toEqual(expected);
    expect(await openInListScope(LITERAL_FILTER)).toEqual(expected);
  });
});
