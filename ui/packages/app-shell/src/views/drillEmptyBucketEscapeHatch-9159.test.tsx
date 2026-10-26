/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9159 — the drill escape hatch can finally SPELL "this dimension is
 * empty", and these assert it end to end.
 *
 * `buildDatasetDrillFilter`'s output has three consumers. Two lower it through
 * `convertFiltersToAST`, where objectui#9085's `{ field: { $null: true } }`
 * becomes `[field, 'is_null', true]` and the empty bucket selects its own rows.
 * The third is this one — the host's `openRecordList`, which serializes the same
 * object into `filter[...]` params for the ADR-0055 bare data surface. That
 * dialect had equality plus four range bounds and nothing else, so the condition
 * simply vanished: the empty-bucket drill and the non-empty one produced
 * BYTE-IDENTICAL query strings, and escalating an empty bucket to the list page
 * landed on a SUPERSET — silently, with chips that showed only the conditions
 * that survived, so the page looked correctly scoped
 * (`drillEmptyBucketNavHost-9085.test.ts` recorded that boundary; it now records
 * the repair).
 *
 * ## Why the observation point is the DESTINATION SCOPE, not the serializer
 *
 * The defect's whole signature was that every layer looked healthy — the widget
 * rendered, the navigation happened, the list loaded, and only the row set was
 * wrong. So the escape hatch is driven for real (`useOpenRecordList` inside a
 * router, the same harness `useOpenRecordList.placeholderScope-9022.test.tsx`
 * uses) and the assertion is on the triples the bare data surface reads back out
 * of the URL via this repo's own `parseUrlFilterTriples` — a round trip, never
 * the two operator maps in isolation. A map-only assertion passes on a dialect
 * that still cannot express the condition end to end.
 *
 * The filter under test is built by the real `buildDatasetDrillFilter`, so these
 * pin the shape a producer actually hands over rather than a hand-written
 * literal no caller emits.
 *
 * ## The param is not data, and its value is the DIRECTION
 *
 * `filter[<field>][null]` carries no comparand: only its exact spellings are
 * conditions. When this card shipped, `true` was the only one — `...[null]=false`
 * was NOT "is not null", because the write side could not spell that operator
 * and a read-side operator with no producer would have been a second contract.
 * ⚠️ objectui#9508 supplied that producer and `false` IS now the is-not-null
 * operator, so the assertion below records the spelling this card left
 * unspecified rather than the refusal it shipped. The is-not-null obligations
 * themselves live in `drillNotNullDialect-9508.test.tsx`; what stays here is
 * this card's own boundary — that a value which is NEITHER spelling is still
 * dropped like an unknown suffix.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { buildDatasetDrillFilter } from '@object-ui/core';
import { FilterScopeProvider } from '@object-ui/react';
import {
  parseUrlFilterTriples,
  parseUrlEqualityFilterTriples,
  groupFilterChips,
  NULL_FILTER,
} from './drillUrlFilters';
import { useOpenRecordList } from './useOpenRecordList';

/** The dimension-to-field map a dataset widget passes the drill builder. */
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

/** The handler under test, plus wherever it took the browser. */
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

describe('the drill escape hatch and the empty bucket (objectui#9159)', () => {
  it('an empty bucket clicked alongside a non-empty dimension reaches the list as BOTH conditions', () => {
    // What the widget hands over for "stage = won, owner is empty".
    const filter = buildDatasetDrillFilter(
      { stage: 'won', owner: '' },
      ['stage', 'owner'],
      DIMENSION_FIELDS,
    );
    expect(filter).toEqual({ stage: 'won', owner: { $null: true } });

    const { pathname, search } = drillTo('opportunity', filter);
    expect(pathname).toBe('/apps/crm/opportunity/data');
    // The defect: this used to be `filter[stage]=won` and nothing else, so the
    // list landed scoped by everything EXCEPT the thing the user clicked.
    expect(destinationScope(search)).toEqual([
      ['stage', '=', 'won'],
      ['owner', 'is_null', true],
    ]);
  });

  it('an empty-bucket-ONLY drill is no longer an empty query string', () => {
    const filter = buildDatasetDrillFilter({ owner: '' }, ['owner'], DIMENSION_FIELDS);
    const { search } = drillTo('opportunity', filter);

    // It used to serialize to nothing at all, which is the widest possible
    // answer: every row in the object.
    expect(search).not.toBe('');
    expect(destinationScope(search)).toEqual([['owner', 'is_null', true]]);
  });

  it('the flag is spelled `filter[<field>][null]=true` in the URL the user can share', () => {
    const filter = buildDatasetDrillFilter({ owner: '' }, ['owner'], DIMENSION_FIELDS);
    const { search } = drillTo('opportunity', filter);

    // Decoded rather than compared against the percent-encoded form, so this
    // pins the CONTRACT (the param key and its value) and not URLSearchParams'
    // encoding of square brackets.
    expect(decodeURIComponent(search)).toBe('?filter[owner][null]=true');
    // ⚠️ The record grew its inverse half in objectui#9508; the five members
    // this card shipped are asserted BY NAME and unchanged, which is the claim
    // that matters here — a published URL surface may gain a spelling and may
    // not move one.
    expect(NULL_FILTER.param).toBe('null');
    expect(NULL_FILTER.flag).toBe('true');
    expect(NULL_FILTER.op).toBe('is_null');
    expect(NULL_FILTER.key).toBe('$null');
    expect(NULL_FILTER.labelKey).toBe('filterBuilder.operators.is_null');
  });

  it('the chip the list renders names the condition instead of showing a bare `true`', () => {
    const filter = buildDatasetDrillFilter(
      { stage: 'won', owner: '' },
      ['stage', 'owner'],
      DIMENSION_FIELDS,
    );
    const { search } = drillTo('opportunity', filter);
    const chips = groupFilterChips(destinationScope(search));

    // The chip grouper renders anything that is not a range as `= VALUE`, so
    // without its own arm this read `= true` — a condition the user never wrote
    // against a value the object does not hold. That arm hands out the filter
    // builder's operator KEY rather than a finished English string, because the
    // text is prose rather than the user's own comparand; the render site
    // resolves it, pinned in a real non-English render by
    // `ObjectDataPage.filterChipI18n-9159.test.tsx`.
    expect(chips).toEqual([
      { field: 'stage', text: '= won' },
      { field: 'owner', textKey: NULL_FILTER.labelKey },
    ]);
    expect(chips[1].text).toBeUndefined();
  });

  it('a value that is NEITHER spelling still produces no condition at all', () => {
    // This card's boundary, kept at the input it was written about: the param
    // is not a truthiness test, so a third value is dropped exactly like an
    // unknown suffix — never downgraded to `is_null false`, never to an
    // equality against the string it holds.
    expect(parseUrlFilterTriples(new URLSearchParams('filter[owner][null]=1'))).toEqual([]);
    expect(parseUrlFilterTriples(new URLSearchParams('filter[owner][null]=yes'))).toEqual([]);
    // An empty value was already dropped before this card (a param whose value
    // is `''` never reaches the suffix arm), so equality-to-empty-string stays
    // what it always was: no condition.
    expect(parseUrlFilterTriples(new URLSearchParams('filter[owner][null]='))).toEqual([]);
    expect(parseUrlFilterTriples(new URLSearchParams('filter[owner]='))).toEqual([]);
    // ⚠️ `false` is NO LONGER in this set — objectui#9508 made it the
    // is-not-null operator. Asserted here, in the file that used to pin the
    // refusal, so the two cards cannot both be believed at once.
    expect(parseUrlFilterTriples(new URLSearchParams('filter[owner][null]=false')))
      .toEqual([['owner', 'is_not_null', true]]);
  });

  it('CONTROL: a NON-empty drill still reaches the URL unchanged', () => {
    const filter = buildDatasetDrillFilter({ owner: 'alice' }, ['owner'], DIMENSION_FIELDS);
    const { search } = drillTo('opportunity', filter);
    expect(destinationScope(search)).toEqual([['owner', '=', 'alice']]);
  });

  it('CONTROL: the object route still executes NO operator suffix, this flag included (objectui#9196)', () => {
    // `/apps/:app/:object` implements equality and nothing else on purpose:
    // teaching it operators would widen an addressable public surface, which is
    // a behaviour addition and not this card. It drops the flag, as it drops
    // every other suffixed form — it does not answer it at the wrong operator.
    expect(parseUrlEqualityFilterTriples(new URLSearchParams('filter[owner][null]=true'))).toEqual(
      [],
    );
    expect(parseUrlEqualityFilterTriples(new URLSearchParams('filter[owner][gte]=1'))).toEqual([]);
    // LIT CONTROL: the unsuffixed form still works there, so the empty results
    // above are the route's boundary and not a broken parser.
    expect(parseUrlEqualityFilterTriples(new URLSearchParams('filter[owner]=alice'))).toEqual([
      ['owner', '=', 'alice'],
    ]);
  });
});
