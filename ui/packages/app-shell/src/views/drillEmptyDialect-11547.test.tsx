/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11547 — a composed drill whose widget filter says "is empty" keeps
 * that condition on the way to the list page.
 *
 * `composeDrillFilter` merges the widget filter with the clicked bucket and
 * lowers the result through the spec's `parseFilterAST`. From
 * `@objectstack/spec` 17.6.0 that lowering spells the view operators
 * `is_empty` / `is_not_empty` as `{ $empty: true | false }`; before it, all
 * four empty spellings lowered to `$null`, which this dialect already carried
 * as `filter[<field>][null]`. `$empty` had no spelling at all, so the condition
 * VANISHED from the drill URL and the list opened on a superset of what the
 * widget counted — silently, the objectui#9159 / objectui#9508 shape.
 *
 * ## Why the observation point is the DESTINATION SCOPE
 *
 * Same reason objectui#9159 gave: the defect's signature is that every layer
 * looks healthy and only the row set is wrong. So the escape hatch is driven for
 * real (`useOpenRecordList` inside a router) with a filter built by the real
 * `composeDrillFilter`, and the assertions are on what the bare data surface
 * reads back out of the URL — and, one step further, on what the data sink
 * lowers that to.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { composeDrillFilter, convertFiltersToAST, mergeFilterNodes } from '@object-ui/core';
import { FilterScopeProvider } from '@object-ui/react';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import { parseUrlFilterTriples, groupFilterChips, EMPTY_FILTER } from './drillUrlFilters';
import { useOpenRecordList } from './useOpenRecordList';

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

/** Both directions, as the widget author writes them and as the URL spells them. */
const DIRECTIONS = [
  ['is_empty', true, 'true'],
  ['is_not_empty', false, 'false'],
] as const;

describe('a composed "is empty" widget filter reaches the drill URL (objectui#11547)', () => {
  it.each(DIRECTIONS)(
    'a widget filter `%s` composed with a click context survives to the destination',
    (op, flag, param) => {
      const composed = composeDrillFilter([['owner', op, true]], { stage: 'won' });
      // The spec's 17.6.0 lowering, recorded where it will redden if it moves:
      // this is the spelling the serializer has to carry.
      expect(composed).toEqual({ $and: [{ owner: { $empty: flag } }, { stage: 'won' }] });

      const { pathname, search } = drillTo('opportunity', composed);
      expect(pathname).toBe('/apps/crm/opportunity/data');
      // The defect: this used to be `?filter[stage]=won` and nothing else.
      expect(decodeURIComponent(search)).toBe(`?filter[owner][empty]=${param}&filter[stage]=won`);
      expect(destinationScope(search)).toEqual([
        ['owner', op, true],
        ['stage', '=', 'won'],
      ]);
    },
  );

  it.each(DIRECTIONS)(
    'the same holds for a widget filter authored as a ViewFilterRule `%s`',
    (op, _flag, param) => {
      // The other shape a widget's `filter` arrives in: a stored rule list.
      const composed = composeDrillFilter([{ field: 'owner', operator: op }], { stage: 'won' });
      const { search } = drillTo('opportunity', composed);
      expect(decodeURIComponent(search)).toContain(`filter[owner][empty]=${param}`);
      expect(destinationScope(search)).toContainEqual(['owner', op, true]);
    },
  );

  it('an "is empty"-only drill is no longer an empty query string', () => {
    // It used to serialize to nothing at all, the widest possible answer: every
    // row in the object.
    const { search } = drillTo('opportunity', composeDrillFilter([['owner', 'is_empty', true]], undefined));
    expect(decodeURIComponent(search)).toBe('?filter[owner][empty]=true');
  });

  it('CONTROL: a 17.5.0-shaped `$null` composition still writes `[null]`, unchanged', () => {
    // What the same widget produced before the bump. Lights the harness: the
    // `[empty]` answers above are the new arm, not a serializer that now writes
    // something for every operator object.
    const { search } = drillTo('opportunity', { $and: [{ owner: { $null: true } }, { stage: 'won' }] });
    expect(decodeURIComponent(search)).toBe('?filter[owner][null]=true&filter[stage]=won');
    expect(destinationScope(search)).toEqual([
      ['owner', 'is_null', true],
      ['stage', '=', 'won'],
    ]);
  });

  it('CONTROL: an `is_null` widget filter still composes to `$null` and writes `[null]`', () => {
    // 17.6.0 split the lowering: the null pair kept `$null`, only the empty pair
    // moved. Both arms are therefore live at once.
    const composed = composeDrillFilter([['owner', 'is_null', true]], { stage: 'won' });
    expect(composed).toEqual({ $and: [{ owner: { $null: true } }, { stage: 'won' }] });
    expect(decodeURIComponent(drillTo('opportunity', composed).search))
      .toBe('?filter[owner][null]=true&filter[stage]=won');
  });
});

describe('the drilled list filters the way the widget counted (objectui#11547)', () => {
  it.each(DIRECTIONS)('agrees with `convertFiltersToAST` for %s (`$empty: %s`)', (_op, flag) => {
    // Agreement with the converter the other two drill sinks use, read from the
    // converter itself rather than transcribed from it.
    const { search } = drillTo('opportunity', { owner: { $empty: flag } });
    expect(destinationScope(search)).toEqual([convertFiltersToAST({ owner: { $empty: flag } })]);
  });

  it.each(DIRECTIONS)(
    'the `/data` list hands the data sink a filter it lowers back to `$empty` (%s)',
    (_op, flag) => {
      // The list composes its base filter through `mergeFilterNodes` (ListView's
      // `buildEffectiveFilter`) and the sink lowers that with `parseFilterAST`.
      // So the URL round trip ends where the widget's count began: `$empty`.
      const { search } = drillTo('opportunity', { owner: { $empty: flag } });
      const node = mergeFilterNodes(destinationScope(search));
      expect(isFilterAST(node)).toBe(true);
      expect(parseFilterAST(node)).toEqual({ owner: { $empty: flag } });
    },
  );

  it('draws a chip carrying the operator KEY for each direction, never `= true`', () => {
    const { search } = drillTo('opportunity', { owner: { $empty: true }, region: { $empty: false } });
    const chips = groupFilterChips(destinationScope(search));
    expect(chips).toEqual([
      { field: 'owner', textKey: EMPTY_FILTER.labelKey },
      { field: 'region', textKey: EMPTY_FILTER.notLabelKey },
    ]);
    expect(chips.map((c) => c.text)).toEqual([undefined, undefined]);
  });
});
