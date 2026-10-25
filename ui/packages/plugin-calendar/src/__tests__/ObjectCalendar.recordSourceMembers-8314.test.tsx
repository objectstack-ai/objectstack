/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8314 — what `object-calendar` reads INSIDE a member of `data` and of
 * `staticData`, and where each of the two keys is honoured.
 *
 * ## Why this file exists
 *
 * objectui#8314 declares `data`, `staticData` and `loading` on both
 * `plugin-calendar` registrations. That is the DECLARATION half, pinned next
 * door in `dataKeysAreDeclaredAndHonoured-8314.test.ts`, which asserts the keys
 * are discoverable — the html tier accepts them, the registry publishes them,
 * and `ComponentPropsMap` does not reject them. It says nothing about what is
 * INSIDE either array, and it cannot: its spec row is a KEY verdict, the right
 * assertion for discoverability and the wrong one for a member claim.
 *
 * The member direction is objectui#8068's, turned on for this block by
 * objectui#8176 and required of both array-armed keys by
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`, which
 * registers this file as the member pin for `object-calendar.data` and for
 * `object-calendar.staticData`.
 *
 * The spec cannot supply any of it. MEASURED on the installed
 * `@objectstack/spec` 17.3.0: both rows are `z.array(z.unknown()).optional()`,
 * so every coarse member kind parses (`['a', 1, true, [], {}, null]` is
 * accepted whole) and the member contract constrains NOTHING. The read site is
 * the entire member contract there is — the same reading the `filter` and
 * `sort` entries on this block already record, and the reason neither key
 * declares an `of`.
 *
 * ## ⛔ THE FALSE GREEN THIS FILE WAS WRITTEN AROUND — measured, not inherited
 *
 * objectui#8328 found `object-kanban`'s `data` DOUBLY guarded, with the obvious
 * guard the one that never runs, and warned that a pin written from the read
 * that looks right cannot fail. The same two-carrier arrangement exists here
 * and it produces a DIFFERENT false green, so the warning was re-derived on
 * this block rather than ported:
 *
 *   `SchemaRenderer` spreads every non-metadata node key as a React prop, so an
 *   authored `data` array arrives BOTH as `rest.data` at this package's
 *   renderer boundary (`index.tsx` — `resolveExternalData`, forwarded as the
 *   component's `data` prop, where `Array.isArray` makes `hasExternalData`) AND
 *   as `schema.data` inside `ObjectCalendar`, where the shared record-source
 *   ladder's rung 1 returns it VERBATIM as a record-source config.
 *
 *   A bare array carries no `provider`. So on a tree where the boundary drops
 *   `data` entirely, the fetch effect still matches no branch and STILL ISSUES
 *   NO QUERY. "Authoring `data` skips the calendar's own fetch" is therefore
 *   true of the broken tree as well as the working one — an assertion resting
 *   on it CANNOT FAIL, which is the same defect one layer in.
 *
 * Confirmed by ablation for this card: with `data={externalData}` removed from
 * the boundary, `no query is issued` stayed GREEN while every row below that
 * asserts the authored rows are DRAWN went red. The rows are the claim; the
 * absent query is kept only as a companion observation, and is labelled as one.
 *
 * ## The rows, and what makes each a reading
 *
 * `data` (sink: the PROPS channel, `index.tsx`'s `resolveExternalData`):
 *
 *   1. THE MEMBER IS A RECORD — the keys read inside one are the fields the
 *      declared `calendar` config names (`startDateField`, `endDateField`,
 *      `titleField`) plus `id`. The positive claim, and the one an author
 *      checks their metadata against. Every member arrives, in authored order.
 *   2. AN ABSENT END VALUE IS ALL-DAY, per member: two members differing only
 *      in `endDateField` get different `allDay` verdicts, so the read is
 *      per-member rather than per-block.
 *   3. A MEMBER WITH NO START VALUE IS NOT DROPPED AND NOT DATED — it leaves
 *      the grid and is counted in the unscheduled area (objectui#7071 at the
 *      member level). The description says so, so it is pinned.
 *   4. A MEMBER WITH NO `id` STILL BECOMES AN EVENT, with a synthesised id
 *      rather than being discarded: `id` is READ, and its absence is not fatal.
 *   5. THE COMPANION OBSERVATION — no query is issued. ⛔ NOT load-bearing; see
 *      the false-green note above. It is asserted because the description
 *      claims it, and paired here with row 1 which is what discriminates.
 *   6. THE CONTROL — with no `data` and no `staticData` the calendar issues its
 *      own query and draws THAT row instead, through the same wait. Without it
 *      rows 1-5 could be satisfied by a calendar that draws whatever it holds,
 *      and every "no query" reading would be a claim about a wait too short to
 *      have seen one.
 *
 * `staticData` (sink: the SCHEMA channel, the shared ladder inside
 * `ObjectCalendar`):
 *
 *   7. THE MEMBERS ARE READ EXACTLY AS `data`'s ARE — same record keys, same
 *      unscheduled treatment — which is the whole of what its description
 *      claims about members.
 *   8. POSITION, RUNG 2 — authored beside `data`, `data` wins and `staticData`
 *      contributes nothing. The half of the ladder an author most easily gets
 *      backwards.
 *   9. POSITION, ABOVE `objectName` — authored beside a live `objectName`, the
 *      inline rows are drawn and the object is never queried, proven through
 *      the same wait row 6 shows a real query completing in.
 *
 * `loading` (scalar, so it owes no member pin — but its declared description
 * makes a POSITION claim, and slice 1 held the key back on a reasoned rather
 * than measured version of it):
 *
 *  10. HONOURED ALONGSIDE `data` — `loading: true` replaces a calendar that was
 *      handed rows with its loading placeholder.
 *  11. INERT WITHOUT `data` — the IDENTICAL `loading: true`, on a calendar fed
 *      by `staticData`, changes nothing and the rows are drawn. The pair is one
 *      controlled experiment: only the row-carrier differs, and the verdicts
 *      are opposite. This is the measurement objectui#8201 reasoned to and
 *      objectui#8314 owed.
 *
 * Every row that observes an absent query waits for a REAL, COMPLETED render
 * first, and row 6 proves that wait is long enough by making a real query
 * observable through exactly it — so "zero queries" can never read as success
 * here.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// The month grid is orthogonal to everything this file observes (which records
// became events, with which member-derived properties), and rendering it costs
// a month of DOM per case. Same stub idiom as the `sortMembersReachTheWire-8171`
// and `filterIsNotAConfigSlot-7711` pins next door.
vi.mock('../CalendarView', () => ({
  CalendarView: ({ events }: any) => (
    <div
      data-testid="calendar-view"
      data-event-titles={events.map((e: any) => e.title).join('|')}
      data-event-ids={events.map((e: any) => String(e.id)).join('|')}
      data-event-allday={events.map((e: any) => String(e.allDay)).join('|')}
    />
  ),
}));

import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module scope, not a hook: this import IS the registration this file renders
// through (AGENTS.md's test-discipline section).
import '../index';

afterEach(cleanup);

const OBJECT = 'visit';

/**
 * The flat calendar config, declaring an END field as well as a start — row 2
 * needs a declared `endDateField` for "this member has no end value" to be a
 * statement about the MEMBER rather than about the config.
 */
const CALENDAR = { startDateField: 'starts_at', endDateField: 'ends_at', titleField: 'name' };

const today = new Date();
const inThisMonth = (d: number) =>
  new Date(today.getFullYear(), today.getMonth(), Math.min(d, 28), 9, 0, 0, 0).toISOString();

/**
 * Two authored members that differ in exactly one read key: the second carries
 * a value in the declared end field and the first does not.
 */
const AUTHORED = [
  { id: 'r1', name: 'Authored member one', starts_at: inThisMonth(10) },
  { id: 'r2', name: 'Authored member two', starts_at: inThisMonth(12), ends_at: inThisMonth(13) },
];

/** The row only a real query can put on screen — row 6's discriminator. */
const FETCHED = [{ id: 'q1', name: 'Fetched by the query', starts_at: inThisMonth(20) }];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: FETCHED }),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        starts_at: { type: 'datetime' },
        ends_at: { type: 'datetime' },
      },
    }),
  } as any;
}

/**
 * A node for the `plugin-calendar:object-calendar` registration, always
 * carrying a live `objectName` so every "no query was issued" reading is about
 * the authored record source rather than about a calendar with nothing to
 * fetch.
 */
const node = (extra: Record<string, unknown>) =>
  ({
    type: 'plugin-calendar:object-calendar',
    id: 'n',
    objectName: OBJECT,
    calendar: CALENDAR,
    ...extra,
  }) as never;

/**
 * Render through the REAL `SchemaRenderer`, which is what makes this a pin
 * about an AUTHORED key: `data` and `loading` are read off the props channel
 * that `SchemaRenderer` fills, so rendering `<ObjectCalendar data={…} />`
 * directly would pin the component's prop and say nothing about the node key.
 */
function renderNode(schema: unknown, dataSource: any) {
  return render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );
}

/** Wait for the calendar to finish rendering its grid, then read one attribute. */
async function grid(): Promise<Element> {
  await waitFor(() => expect(screen.getByTestId('calendar-view')).toBeTruthy());
  return screen.getByTestId('calendar-view');
}

const readList = (el: Element, name: string) =>
  (el.getAttribute(name) ?? '').split('|').filter(Boolean);

const titlesOf = (el: Element) => readList(el, 'data-event-titles');
const idsOf = (el: Element) => readList(el, 'data-event-ids');
const allDayOf = (el: Element) => readList(el, 'data-event-allday');

/** The unscheduled containment area's own label, or `null` when it is absent. */
const unscheduledLabel = () =>
  document.body.querySelector('[data-calendar-unscheduled]')?.textContent ?? null;

/**
 * The placeholder `ObjectCalendar` renders instead of everything else.
 *
 * ⚠️ U+2026, not three ASCII full stops (objectui#10031). This sentence now
 * comes from the `calendar.loading` pack value rather than from a literal in
 * the component, and `ellipsis-glyph-3878.test.ts` holds every pack value to
 * the typographic ellipsis — so the glyph moved when the string moved into the
 * pack. The placeholder itself is unchanged in every other respect.
 */
const LOADING_PLACEHOLDER = 'Loading calendar…';

describe('objectui#8314 — `object-calendar` reads records inside `data` and `staticData`', () => {
  it('draws every `data` member as an event, titled and identified from the keys the config names', async () => {
    const dataSource = makeDataSource();

    renderNode(node({ data: AUTHORED }), dataSource);
    const view = await grid();

    // Row 1: the member is a RECORD; `titleField` and `id` are read inside it,
    // every member arrives, and the authored order is kept.
    expect(titlesOf(view)).toEqual(['Authored member one', 'Authored member two']);
    expect(idsOf(view)).toEqual(['r1', 'r2']);
  });

  it('reads the end field PER MEMBER — an absent end value is all-day, a present one is not', async () => {
    // Row 2. The two members differ in exactly one read key, so this cannot be
    // satisfied by a block-level inference: `allDay` is derived inside each
    // member from the field the declared config names.
    const dataSource = makeDataSource();

    renderNode(node({ data: AUTHORED }), dataSource);
    const view = await grid();

    expect(allDayOf(view)).toEqual(['true', 'false']);
  });

  it('counts a `data` member with no start value as unscheduled rather than dropping it', async () => {
    // Row 3, and the member-level half of objectui#7071: a record with no value
    // in the declared start field is not given a fabricated date and does not
    // vanish either — it leaves the grid and is counted.
    const dataSource = makeDataSource();

    renderNode(
      node({ data: [AUTHORED[0], { id: 'r3', name: 'No date at all' }] }),
      dataSource,
    );
    const view = await grid();

    expect(titlesOf(view)).toEqual(['Authored member one']);
    expect(unscheduledLabel()).toContain('Unscheduled (1)');
  });

  it('gives a `data` member with no `id` a synthesised one instead of discarding it', async () => {
    // Row 4: the negative half of row 1's `id` claim. `id` is READ — but a
    // member that carries none still becomes an event, so an author is not
    // silently required to supply one.
    const dataSource = makeDataSource();

    renderNode(node({ data: [{ name: 'Idless', starts_at: inThisMonth(11) }] }), dataSource);
    const view = await grid();

    expect(titlesOf(view)).toEqual(['Idless']);
    expect(idsOf(view)).toEqual(['event-0']);
  });

  it('COMPANION (not load-bearing): an authored `data` array leaves the query unissued', async () => {
    // Row 5. ⛔ This assertion CANNOT FAIL on its own — see the false-green note
    // in this file's header: a bare array under `schema.data` matches no fetch
    // branch either, so the query stays unissued on a tree where the boundary
    // drops `data` completely. Measured by ablation, and kept only because the
    // declared description claims it. The row above it is what discriminates.
    const dataSource = makeDataSource();

    renderNode(node({ data: AUTHORED }), dataSource);
    const view = await grid();

    // Ordered query-first DELIBERATELY: on the ablated tree this line still
    // passes and the one below it is what reds, which is how the false green
    // was measured rather than argued.
    expect(dataSource.find).not.toHaveBeenCalled();
    expect(titlesOf(view)).toEqual(['Authored member one', 'Authored member two']);
  });

  it('CONTROL: with neither key authored the calendar issues its own query, through the same wait', async () => {
    // Row 6, and the reason every "not called" above is a verdict rather than a
    // race. The wait is IDENTICAL — `grid()` — and a real query completes
    // inside it, putting a row on screen that no authored member could supply.
    const dataSource = makeDataSource();

    renderNode(node({}), dataSource);
    const view = await grid();

    expect(dataSource.find).toHaveBeenCalledTimes(1);
    expect(titlesOf(view)).toEqual(['Fetched by the query']);
  });

  it('reads a `staticData` member exactly as it reads a `data` member', async () => {
    // Row 7: same record keys, same per-member unscheduled treatment. The two
    // keys share one sink for the member question even though they arrive on
    // different channels, which is what its description claims.
    const dataSource = makeDataSource();

    renderNode(
      node({ staticData: [...AUTHORED, { id: 'r3', name: 'No date at all' }] }),
      dataSource,
    );
    const view = await grid();

    expect(titlesOf(view)).toEqual(['Authored member one', 'Authored member two']);
    expect(idsOf(view)).toEqual(['r1', 'r2']);
    expect(allDayOf(view)).toEqual(['true', 'false']);
    expect(unscheduledLabel()).toContain('Unscheduled (1)');
  });

  it('POSITION: `data` wins over `staticData`, which then contributes nothing', async () => {
    // Row 8 — rung 1 beats rung 2. Both keys carry a DIFFERENT member, so a
    // renderer that merged them, or read the wrong one, names itself.
    const dataSource = makeDataSource();

    renderNode(node({ data: [AUTHORED[0]], staticData: [AUTHORED[1]] }), dataSource);
    const view = await grid();

    expect(titlesOf(view)).toEqual(['Authored member one']);
  });

  it('POSITION: `staticData` is read BEFORE `objectName`, so the object is never queried', async () => {
    // Row 9 — rung 2 beats rung 3. The node carries a live `objectName` and the
    // data source would answer it (row 6 shows exactly that, through this same
    // wait), so an unissued query here is the ladder's ordering and not an
    // absent binding.
    const dataSource = makeDataSource();

    renderNode(node({ staticData: AUTHORED }), dataSource);
    const view = await grid();

    expect(titlesOf(view)).toEqual(['Authored member one', 'Authored member two']);
    expect(dataSource.find).not.toHaveBeenCalled();
  });

  it('`loading` is honoured alongside an array `data` — the placeholder replaces the grid', async () => {
    // Row 10. The rows were handed over and are still not drawn, which is the
    // whole of what an external loading state means on this block.
    const dataSource = makeDataSource();

    renderNode(node({ data: AUTHORED, loading: true }), dataSource);

    await waitFor(() =>
      expect(document.body.textContent ?? '').toContain(LOADING_PLACEHOLDER),
    );
    expect(screen.queryByTestId('calendar-view')).toBeNull();
  });

  it('`loading` is INERT without `data` — the identical flag changes nothing on a `staticData` calendar', async () => {
    // Row 11, and the measurement objectui#8201 reasoned to rather than took.
    // Only the row-carrier differs from the row above; the verdict is the
    // opposite one, so the coupling the description states is a reading.
    const dataSource = makeDataSource();

    renderNode(node({ staticData: AUTHORED, loading: true }), dataSource);
    const view = await grid();

    expect(titlesOf(view)).toEqual(['Authored member one', 'Authored member two']);
    expect(document.body.textContent ?? '').not.toContain(LOADING_PLACEHOLDER);
  });
});
