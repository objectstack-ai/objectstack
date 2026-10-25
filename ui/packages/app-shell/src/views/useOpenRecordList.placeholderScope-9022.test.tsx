/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9022 — the drill escape hatch resolves filter placeholders, so ONE
 * drill has ONE scope whatever `drillDown.target` says.
 *
 * Every widget composes its drill filter from the RAW authored `schema.filter`
 * (`ObjectChart`'s `drillFilter` memo; `DrillDownDrawer`'s `filter` prop), so
 * `{current_user_id}` and the relative-date macros are still literals when they
 * reach the host handler. The drawer arm never had the defect — the
 * `object-data-table` it renders resolves `schema.filter` in its own fetch — so
 * the navigate arm was the only one writing a placeholder into the URL, where
 * the READ side parses it back as an ordinary string comparand and the list
 * matches nothing.
 *
 * ## What these assert, and why it is the URL rather than the helper
 *
 * The defect's whole signature is that every layer looked fine: the widget
 * rendered, the navigation happened, the list page loaded, and only the
 * comparand was wrong. So the observation point is the DESTINATION SCOPE — the
 * filter triples the bare data surface will read back out of the URL, via the
 * repo's own `parseUrlFilterTriples` — not the return value of any helper.
 *
 * The composed shape under test is built with the real `composeDrillFilter`,
 * which is what `ObjectChart` hands the handler (pinned on the chart's side of
 * the seam by its own drill-navigate and drill-composition tests). Feeding the
 * handler a hand-written literal would pin a shape no caller actually produces.
 *
 * ## The controls
 *
 * A placeholder-free drill must be unchanged, and it is asserted as the exact
 * URL string rather than "no placeholder remains" — an assertion that a
 * resolver rewriting values in some other way would still pass. The same-kind
 * pre-existing control is `drillUrlFilters.test.ts`, which pins the encoder
 * this hook delegates to and is untouched by this change.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { composeDrillFilter } from '@object-ui/core';
import { FilterScopeProvider } from '@object-ui/react';
import { parseUrlFilterTriples } from './drillUrlFilters';
import { useOpenRecordList } from './useOpenRecordList';

/**
 * Noon UTC in the middle of Q2 2026, so the quarter-start macro has ONE right
 * answer and it can be pinned as a literal. Only `Date` is faked — the RTL
 * timers this file's `act` relies on stay real (the convention already used in
 * `plugin-timeline` / `plugin-map` / `dataset-format.date`), and the suite pins
 * `TZ=UTC`, so a `Z` instant and the local calendar day cannot disagree.
 */
const NOW = new Date('2026-05-15T12:00:00Z');
const QUARTER_START = '2026-04-01';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

function wrapperFor(scope: { currentUserId?: string | null; currentOrgId?: string | null }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={['/apps/crm/dashboard/pipeline']}>
        <FilterScopeProvider currentUserId={scope.currentUserId} currentOrgId={scope.currentOrgId}>
          <Routes>
            <Route path="/apps/:appName/*" element={<>{children}</>} />
          </Routes>
        </FilterScopeProvider>
      </MemoryRouter>
    );
  };
}

/** The handler under test, plus wherever it took the browser. */
function useHarness() {
  const openRecordList = useOpenRecordList();
  const { pathname, search } = useLocation();
  return { openRecordList, pathname, search };
}

function drillTo(
  scope: { currentUserId?: string | null; currentOrgId?: string | null },
  objectName: string,
  filter?: Record<string, unknown>,
) {
  const { result } = renderHook(useHarness, { wrapper: wrapperFor(scope) });
  act(() => result.current.openRecordList(objectName, filter));
  return result;
}

/** The scope the destination list will actually run under. */
function destinationScope(search: string) {
  return parseUrlFilterTriples(new URLSearchParams(search));
}

describe('useOpenRecordList — the drilled URL carries the RESOLVED scope (objectui#9022)', () => {
  it('resolves {current_user_id} inside the filter the chart composes', () => {
    // Exactly what ObjectChart hands over: widget filter ∧ click context.
    const composed = composeDrillFilter({ owner_id: '{current_user_id}' }, { stage: 'won' });
    const result = drillTo({ currentUserId: 'usr_42', currentOrgId: 'org_7' }, 'opportunity', composed);

    expect(result.current.pathname).toBe('/apps/crm/opportunity/data');
    expect(destinationScope(result.current.search)).toEqual([
      ['owner_id', '=', 'usr_42'],
      ['stage', '=', 'won'],
    ]);
    // The literal is what shipped, and it is what a list page matches nothing on.
    expect(result.current.search).not.toContain('current_user_id');
  });

  it('resolves a relative-date macro in a range bound to a real ISO date', () => {
    const result = drillTo({ currentUserId: 'usr_42' }, 'opportunity', {
      close_date: { $gte: '{current_quarter_start}' },
    });

    expect(destinationScope(result.current.search)).toEqual([
      ['close_date', '>=', QUARTER_START],
    ]);
  });

  it('resolves both vocabularies in one drill, and {current_org_id} too', () => {
    const result = drillTo({ currentUserId: 'usr_42', currentOrgId: 'org_7' }, 'opportunity', {
      owner_id: '{current_user_id}',
      org_id: '{current_org_id}',
      close_date: { $gte: '{current_quarter_start}' },
    });

    expect(destinationScope(result.current.search)).toEqual([
      ['owner_id', '=', 'usr_42'],
      ['org_id', '=', 'org_7'],
      ['close_date', '>=', QUARTER_START],
    ]);
  });

  it('CONTROL — a placeholder-free drill produces the same URL it always did', () => {
    const result = drillTo({ currentUserId: 'usr_42', currentOrgId: 'org_7' }, 'opportunity', {
      stage: 'won',
      close_date: { $gte: '2026-04-01', $lt: '2026-07-01' },
    });

    // Pinned as the whole string, not as "no token survives": a resolver that
    // rewrote ordinary comparands would pass the weaker assertion.
    expect(`${result.current.pathname}${result.current.search}`).toBe(
      '/apps/crm/opportunity/data?filter%5Bstage%5D=won&filter%5Bclose_date%5D%5Bgte%5D=2026-04-01&filter%5Bclose_date%5D%5Blt%5D=2026-07-01',
    );
  });

  it('CONTROL — a drill with no filter at all still navigates bare', () => {
    const { result } = renderHook(useHarness, {
      wrapper: wrapperFor({ currentUserId: 'usr_42' }),
    });
    act(() => result.current.openRecordList('opportunity'));

    expect(`${result.current.pathname}${result.current.search}`).toBe('/apps/crm/opportunity/data');
  });

  it('leaves a token it cannot resolve as a literal — narrowing, never widening', () => {
    // Signed out: the resolver deliberately keeps the token rather than dropping
    // the clause, because an empty result is far safer than a widened one.
    const result = drillTo({ currentUserId: null, currentOrgId: null }, 'opportunity', {
      owner_id: '{current_user_id}',
    });

    expect(destinationScope(result.current.search)).toEqual([
      ['owner_id', '=', '{current_user_id}'],
    ]);
  });
});
