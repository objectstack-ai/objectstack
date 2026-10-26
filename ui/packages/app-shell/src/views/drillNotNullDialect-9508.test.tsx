/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9508 — the drill URL dialect can finally spell IS NOT NULL, and its
 * three sibling producer spellings stop vanishing on the escape hatch.
 *
 * `convertFiltersToAST` lowers four producer spellings onto two operators:
 * `{ $null: true }` / `{ $exists: false }` to `is_null`, and `{ $null: false }`
 * / `{ $exists: true }` to `is_not_null`. objectui#9159 taught this dialect the
 * first of them. The other three had no spelling, so a drill carrying one
 * VANISHED here and the list page opened scoped by everything except the
 * condition the user clicked — a silent superset, the same shape objectui#9159
 * measured, for the sibling spellings.
 *
 * ## Why the observation point is the DESTINATION SCOPE
 *
 * Same reason objectui#9159 gave: the defect's whole signature is that every
 * layer looks healthy — the widget renders, the navigation happens, the list
 * loads, and only the row set is wrong. So the escape hatch is driven for real
 * (`useOpenRecordList` inside a router) and the assertion is on the triples the
 * bare data surface reads back out of the URL. A map-only assertion passes on a
 * dialect that still cannot express the condition end to end.
 *
 * ## The two routes deliver DIFFERENT spellings — measured, not assumed
 *
 * ⭐ This is why the write side reads both producer keys rather than only the
 * canonical one:
 *
 *   - COMPOSED: `composeDrillFilter` lowers `widget.filter ∧ click context`
 *     through the spec's `parseFilterAST`, which canonicalises `is_not_null`
 *     back to `{ $null: false }`. An authored `$exists` therefore never
 *     survives this route, and the card's own table reads as if it does.
 *   - UNCOMPOSED: a widget that hands its OWN resolved filter straight to the
 *     escape hatch passes through no canonicaliser at all, so `$exists`
 *     reaches the serializer verbatim. `ObjectMetricWidget` is that widget —
 *     it gives `DrillDownDrawer` its `resolvedFilter`, which the drawer's
 *     `OpenInListButton` hands to `openRecordList` unchanged.
 *
 * ⇒ reading only `$null` would have closed the composed route and left the
 * uncomposed one degrading exactly as before, for an author who picked "is not
 * empty" in the dataset filter inspector, which wrote the `$exists` pair until
 * objectui#10813; a filter stored before then still carries it, and the row
 * now writes `{ $empty: false }` instead, which this dialect carries on its
 * `[empty]` arm (objectui#11547).
 *
 * ## What this card did NOT change
 *
 * ⚠️ `buildDatasetDrillFilter` — the DATASET drill's own click context — still
 * emits `{ $null: true }` and nothing else, so no machine producer on that path
 * reaches the new spellings. That is re-measured below with a lit control
 * rather than inherited from the card, and it is why this is a latent-surface
 * repair: the reachable route is an AUTHORED widget filter, not a click.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { buildDatasetDrillFilter, composeDrillFilter, convertFiltersToAST } from '@object-ui/core';
import { FilterScopeProvider, DrillNavigationProvider } from '@object-ui/react';
import { DrillDownDrawer } from '@object-ui/plugin-dashboard';
import { parseUrlFilterTriples, groupFilterChips, NULL_FILTER } from './drillUrlFilters';
import { useOpenRecordList } from './useOpenRecordList';

const DIMENSION_FIELDS = { stage: 'stage', owner: 'owner' };

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/apps/crm/dashboard/pipeline']}>
      <FilterScopeProvider currentUserId={null} currentOrgId={null}>
        <Routes>
          <Route path="/apps/:appName/*" element={<>{children}</>} />
        </Routes>
      </FilterScopeProvider>
    </MemoryRouter>
  );
}

function useHarness() {
  const openRecordList = useOpenRecordList();
  const { pathname, search } = useLocation();
  return { openRecordList, pathname, search };
}

/** Drive the real escape hatch and hand back the URL it navigated to. */
function drillTo(objectName: string, filter?: Record<string, unknown>) {
  const { result } = renderHook(useHarness, { wrapper: Wrapper });
  act(() => result.current.openRecordList(objectName, filter));
  return result.current;
}

/** The scope the destination list will actually run under. */
const destinationScope = (search: string) => parseUrlFilterTriples(new URLSearchParams(search));

describe('the drill escape hatch and IS NOT NULL (objectui#9508)', () => {
  it.each([
    ['{ $exists: false }', { $exists: false }, 'is_null'],
    ['{ $null: false }', { $null: false }, 'is_not_null'],
    ['{ $exists: true }', { $exists: true }, 'is_not_null'],
  ] as const)(
    'a drill carrying %s reaches the destination list as the condition it lowers to',
    (_label, ops, op) => {
      const { pathname, search } = drillTo('opportunity', { stage: 'won', amount: ops });
      expect(pathname).toBe('/apps/crm/opportunity/data');
      // The defect: this used to be `filter[stage]=won` and nothing else, so
      // the list landed scoped by everything EXCEPT the clicked condition.
      expect(destinationScope(search)).toEqual([
        ['stage', '=', 'won'],
        ['amount', op, true],
      ]);
    },
  );

  it('sends each spelling to the same condition the AST converter lowers it to', () => {
    // The obligation is AGREEMENT with the lowering, so the expectation is
    // computed by `convertFiltersToAST` rather than transcribed from it — the
    // two drill sinks agreeing is the whole point of this dialect.
    for (const ops of [{ $null: true }, { $exists: false }, { $null: false }, { $exists: true }]) {
      const { search } = drillTo('opportunity', { amount: ops });
      expect(destinationScope(search)).toEqual([convertFiltersToAST({ amount: ops })]);
    }
  });

  it('an is-not-null-ONLY drill is no longer an empty query string', () => {
    const { search } = drillTo('opportunity', { amount: { $exists: true } });
    // It used to serialize to nothing at all, which is the widest possible
    // answer: every row in the object.
    expect(search).not.toBe('');
    expect(decodeURIComponent(search)).toBe('?filter[amount][null]=false');
  });

  it('draws a chip naming the condition, and NOT the same one as is-null', () => {
    const { search } = drillTo('opportunity', { stage: 'won', amount: { $exists: true } });
    const chips = groupFilterChips(destinationScope(search));
    expect(chips).toEqual([
      { field: 'stage', text: '= won' },
      { field: 'amount', textKey: NULL_FILTER.notLabelKey },
    ]);
    // Without its own arm the param fell to the `= <value>` default and read
    // `= true`; with a SHARED key it would read "Is null" on a condition that
    // means the opposite — a wrong answer wearing a right answer's shape.
    expect(chips[1].text).toBeUndefined();
    expect(NULL_FILTER.notLabelKey).not.toBe(NULL_FILTER.labelKey);
  });
});

/**
 * The COMPOSED route, driven through the real sink rather than a literal.
 *
 * `composeDrillFilter` is what every widget's drill seam funnels through, and
 * it lowers back through the spec's `parseFilterAST` — so what arrives at the
 * serializer is the CANONICAL spelling, whatever the author wrote.
 */
describe('a composed widget filter reaches the list with its emptiness condition', () => {
  it.each([
    ['{ $null: false }', { $null: false }],
    ['{ $exists: true }', { $exists: true }],
  ] as const)('%s composed with a click context survives to the destination', (_label, ops) => {
    const composed = composeDrillFilter({ amount: ops }, { stage: 'won' });
    const { search } = drillTo('opportunity', composed);
    expect(destinationScope(search)).toEqual([
      ['amount', 'is_not_null', true],
      ['stage', '=', 'won'],
    ]);
  });

  it('records WHY the write side also reads `$exists`: composition erases it', () => {
    // Measured, and it is the half of the card's table that does not hold: an
    // authored `$exists` is already `$null` by the time a COMPOSED filter
    // reaches the serializer. The uncomposed route below is the one that
    // delivers `$exists` verbatim, so both keys are genuinely needed.
    expect(composeDrillFilter({ amount: { $exists: true } }, { stage: 'won' })).toEqual({
      $and: [{ amount: { $null: false } }, { stage: 'won' }],
    });
    expect(composeDrillFilter({ amount: { $exists: false } }, { stage: 'won' })).toEqual({
      $and: [{ amount: { $null: true } }, { stage: 'won' }],
    });
  });
});

/**
 * The UNCOMPOSED route, driven through the real escape-hatch BUTTON.
 *
 * `ObjectMetricWidget` hands `DrillDownDrawer` its own resolved filter — no
 * canonicaliser anywhere on that path. This drives that drawer for real, wired
 * to the real `useOpenRecordList`, so the assertion covers the seam a literal
 * call to the hook would skip. `target: 'navigate'` is the drawer's own escape
 * hatch and needs no data source, which is why it is the arm driven here.
 */
describe('an UNCOMPOSED widget filter keeps its authored spelling all the way', () => {
  function EscapeHatchHost({ filter }: { filter: Record<string, unknown> }) {
    const openRecordList = useOpenRecordList();
    const { search } = useLocation();
    return (
      <DrillNavigationProvider value={{ openRecordList }}>
        <DrillDownDrawer
          open
          onClose={() => {}}
          title="Details"
          target="navigate"
          objectName="opportunity"
          filter={filter}
        />
        <output data-testid="search">{search}</output>
      </DrillNavigationProvider>
    );
  }

  /** Render the real drawer and hand back the URL it navigated to. */
  function escapeTo(filter: Record<string, unknown>) {
    render(
      <Wrapper>
        <EscapeHatchHost filter={filter} />
      </Wrapper>,
    );
    return destinationScope(screen.getByTestId('search').textContent ?? '');
  }

  it('an authored `$exists: true` reaches the list as is-not-null, verbatim route', () => {
    // The dispatch's ablation input: the one the two dialects disagree about.
    // The old dialect dropped this condition entirely and the list opened
    // unscoped; the new one carries it.
    expect(escapeTo({ amount: { $exists: true } })).toEqual([['amount', 'is_not_null', true]]);
  });

  it('CONTROL: the same route still carries an ordinary equality unchanged', () => {
    // Lights the harness, so the assertion above is the dialect answering and
    // not a drawer that happens to navigate somewhere with a filter.
    expect(escapeTo({ stage: 'won' })).toEqual([['stage', '=', 'won']]);
  });
});

/**
 * The card's own NON-URGENCY measurement, re-taken here rather than inherited.
 *
 * If a machine producer on the dataset drill path ever starts emitting one of
 * the three spellings, this card stops being a latent-surface repair — so the
 * claim is pinned where it will redden instead of being restated in prose.
 */
describe('the dataset drill path still produces only `{ $null: true }`', () => {
  it.each([
    ['an empty string', ''],
    ['a SQL NULL arriving over the wire as null', null],
    ['an absent grouped value', undefined],
  ] as const)('an empty bucket from %s is still the canonical spelling', (_label, raw) => {
    expect(buildDatasetDrillFilter({ stage: 'won', owner: raw }, ['stage', 'owner'], DIMENSION_FIELDS))
      .toEqual({ stage: 'won', owner: { $null: true } });
  });

  it('CONTROLS: the other two shapes it emits are unchanged and are not emptiness', () => {
    // Lit in the same block: a builder that had stopped emitting anything would
    // satisfy the assertions above.
    expect(buildDatasetDrillFilter({ owner: 'ada' }, ['owner'], DIMENSION_FIELDS))
      .toEqual({ owner: 'ada' });
    expect(
      buildDatasetDrillFilter({}, [], {}, undefined, {
        d: { field: 'close_date', gte: 'a', lt: 'b' },
      } as never),
    ).toEqual({ close_date: { $gte: 'a', $lt: 'b' } });
  });
});
