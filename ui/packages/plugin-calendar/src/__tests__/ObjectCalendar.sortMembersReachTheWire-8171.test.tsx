/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8171 — the MEMBER shape of `object-calendar`'s `sort` is
 * `{ field, order }`, and those two keys are the whole of what this renderer
 * reads inside a member.
 *
 * ## Why this file exists
 *
 * objectui#8171 declares `sort` on both `plugin-calendar` registrations
 * (`{ name: 'sort', type: 'array' }`). That is the DECLARATION half, pinned
 * next door in `filterIsDeclaredInput-7712.test.ts`, which asserts the key is
 * discoverable — the html tier accepts it, the registry publishes it, and
 * `ComponentPropsMap` does not reject it. It says nothing about what is INSIDE
 * the array, and it cannot: its spec row is a KEY verdict, the right assertion
 * for discoverability and the wrong one for a member claim.
 *
 * The member direction is objectui#8068's, turned on for this block by
 * objectui#8176 and required of this key by
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`, which
 * registers this file as `object-calendar.sort`'s member pin.
 *
 * ## ⚠️ How this key differs from `filter`, which is the neighbouring pin
 *
 * `object-calendar.filter` and `object-kanban.filter` are pinned BY IDENTITY:
 * `ObjectCalendar.tsx` writes `$filter: schema.filter`, so the authored array
 * IS the array on the wire and `toBe` is the strongest available claim.
 *
 * ⛔ That assertion is not available here and must not be copied across.
 * `ObjectCalendar.tsx:479` writes `$orderby:
 * convertSortToQueryParams(schema.sort)`, and that sink BUILDS A NEW VALUE — a
 * `field -> direction` map, never the authored array. An identity assertion on
 * `$orderby` could not pass at any point in this file's history, and writing
 * one would pin a claim that is simply false about this key.
 *
 * The difference is not a weakening; it is what makes the member claim here
 * SHARPER than a pass-through. `filter`'s members are opaque to this renderer,
 * so its pin says "nothing is read inside". `sort`'s members are read, member
 * by member, so this pin says exactly WHICH keys are read, what an omitted
 * `order` means, and what happens to a member the sink cannot use. That is the
 * criterion objectui#8068 sets — constrain the member shape the RENDERER
 * READS — answered for a key that genuinely reads its members.
 *
 * The spec cannot supply any of it: `ComponentPropsMap['object-calendar']`'s
 * `sort` row is unconstrained (measured on `@objectstack/spec` 17.2.0 — an
 * array, a bare string and a bare number all parse), so the wire is the whole
 * member contract there is. Same reasoning the two `filter` entries record.
 *
 * ## The rows, and what makes each a reading
 *
 *   1. THE MEMBER KEYS — `{ field, order }` lowers to `{ [field]: order }`.
 *      The positive claim, and the one an author checks their metadata against.
 *   2. AN OMITTED `order` IS ASCENDING, not a dropped member. The private copy
 *      this sink replaced required both keys and silently dropped the entry
 *      (objectui#4022); that regression is member-level and invisible to every
 *      other direction of the parity gate.
 *   3. EVERY MEMBER ARRIVES, in authored order, so the read is per-member
 *      rather than first-wins.
 *   4. A MEMBER WITH NO USABLE `field` IS DROPPED, NEVER GUESSED — the sink
 *      invents no field name, and its siblings still arrive. The negative half
 *      of row 1: `field` is READ, not merely carried.
 *   5. NO MEMBER SPELLING IS CONFIGURATION — a sort on a field literally named
 *      `calendar` (this block's own configuration container) stays a sort, and
 *      the config still comes from the declared `calendar` key. objectui#7711's
 *      core case transposed from `filter` to `sort`: one authored key must
 *      never be read twice with two incompatible meanings.
 *   6. THE CONTROL — an unauthored `sort` reaches the wire as `undefined`
 *      rather than as a fabricated default. Without it, rows 1-4 could be
 *      satisfied by a calendar that forwards whatever it holds, including
 *      something it invented, and a member claim would be indistinguishable
 *      from a coincidence.
 *
 * Every row waits for a REAL `find` call before asserting, so "zero queries"
 * can never read as success here.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// The month grid is orthogonal to everything this file observes (what reached
// `$orderby`, and which config placed the events), and rendering it costs a
// month of DOM per case. Same stub idiom as the `filterIsNotAConfigSlot-7711`
// pin next door.
vi.mock('../CalendarView', () => ({
  CalendarView: ({ events }: any) => (
    <div
      data-testid="calendar-view"
      data-event-titles={events.map((e: any) => e.title).join('|')}
    />
  ),
}));

import { ObjectCalendar } from '../ObjectCalendar';

afterEach(cleanup);

const OBJECT = 'visit';

const today = new Date();
const inThisMonth = (d: number) =>
  new Date(today.getFullYear(), today.getMonth(), Math.min(d, 28), 9, 0, 0, 0).toISOString();

/** One row, dated by the field the DECLARED config names, so row 5 is legible. */
const ROWS = [{ id: 'r1', name: 'Placed by starts_at', starts_at: inThisMonth(10) }];

const CANONICAL = { startDateField: 'starts_at', titleField: 'name' };

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        starts_at: { type: 'datetime' },
        // A field whose NAME collides with this block's own configuration key,
        // so row 5 can put a legitimate sort on it.
        calendar: { type: 'text' },
      },
    }),
  } as any;
}

const BASE = { type: 'object-calendar', objectName: OBJECT, calendar: CANONICAL };

/** Render with an authored `sort`, or with none at all when it is omitted. */
function renderCalendar(dataSource: any, sort?: unknown) {
  const schema: any = sort === undefined ? { ...BASE } : { ...BASE, sort };
  return render(<ObjectCalendar schema={schema} dataSource={dataSource} />);
}

/** The parameters of the most recent `find`, after waiting for one. */
async function lastFindParams(dataSource: any): Promise<any> {
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  const calls = dataSource.find.mock.calls;
  return calls[calls.length - 1][1] ?? {};
}

const titles = () =>
  (screen.getByTestId('calendar-view').getAttribute('data-event-titles') ?? '')
    .split('|')
    .filter(Boolean);

describe('objectui#8171 — `object-calendar` reads `field` and `order` inside a `sort` member', () => {
  it('lowers `{ field, order }` to the `field -> direction` map on `$orderby`', async () => {
    const dataSource = makeDataSource();
    const authoredSort = [{ field: 'starts_at', order: 'desc' }];

    renderCalendar(dataSource, authoredSort);
    const params = await lastFindParams(dataSource);

    expect(params.$orderby).toEqual({ starts_at: 'desc' });
    // ⛔ Stated as an assertion so the divergence from the `filter` pins is
    // pinned rather than merely described in prose above: this key is LOWERED,
    // not forwarded, so an identity claim on `$orderby` is false about it and a
    // future edit copying `toBe` across from the filter pin fails here first.
    expect(params.$orderby).not.toBe(authoredSort);
  });

  it('reads an omitted `order` as ascending instead of dropping the member', async () => {
    // objectui#4022: the private copy this sink replaced required BOTH member
    // keys and silently dropped the entry, sending a map missing a field the
    // author had ordered by. A member-level regression no other direction of
    // the parity gate can see.
    const dataSource = makeDataSource();

    renderCalendar(dataSource, [{ field: 'starts_at' }]);
    const params = await lastFindParams(dataSource);

    expect(params.$orderby).toEqual({ starts_at: 'asc' });
  });

  it('carries every member, in authored order', async () => {
    const dataSource = makeDataSource();

    renderCalendar(dataSource, [
      { field: 'starts_at', order: 'asc' },
      { field: 'name', order: 'desc' },
    ]);
    const params = await lastFindParams(dataSource);

    expect(params.$orderby).toEqual({ starts_at: 'asc', name: 'desc' });
    // The map is per-member, not first-wins: both keys are present, and their
    // order is the authored one.
    expect(Object.keys(params.$orderby)).toEqual(['starts_at', 'name']);
  });

  it('drops a member with no usable `field` rather than inventing one', async () => {
    // The negative half of row 1. `field` is READ — a member that does not
    // carry a usable one contributes nothing, and no field name is fabricated
    // to stand in for it — while its siblings still arrive.
    const dataSource = makeDataSource();

    renderCalendar(dataSource, [{ order: 'desc' }, { field: 'name', order: 'desc' }]);
    const params = await lastFindParams(dataSource);

    expect(params.$orderby).toEqual({ name: 'desc' });
    expect(Object.keys(params.$orderby)).toEqual(['name']);
  });

  it('treats a sort on a field named `calendar` as a SORT, never as configuration', async () => {
    // objectui#7711's core case, transposed from `filter` to `sort`: one
    // authored key must not be read twice with two incompatible meanings.
    // `calendar` is this block's own configuration container, so a probe that
    // looked inside sort members for it would have exactly the retired
    // `filter.calendar` / `filter.map` shape.
    const dataSource = makeDataSource();

    renderCalendar(dataSource, [{ field: 'calendar', order: 'asc' }]);
    const params = await lastFindParams(dataSource);

    expect(params.$orderby).toEqual({ calendar: 'asc' });
    // The configuration half: the calendar still reads its DECLARED `calendar`
    // container, so the sort member was never offered to a configuration read.
    // Were it, `startDateField` would be missing and the refusal screen would
    // stand here instead of a placed event.
    await waitFor(() => expect(screen.getByTestId('calendar-view')).toBeTruthy());
    expect(titles()).toEqual(['Placed by starts_at']);
  });

  it('CONTROL: an unauthored `sort` reaches the wire as `undefined`, not as a fabricated default', async () => {
    // Without this row every assertion above could be satisfied by a calendar
    // that forwards whatever it holds — including a default it invented — and
    // the member claim would not be distinguishable from a coincidence.
    const dataSource = makeDataSource();

    renderCalendar(dataSource);
    const params = await lastFindParams(dataSource);

    expect(params.$orderby).toBeUndefined();
    // Non-vacuity for the line above: the call really happened and really
    // carried the row cap, so `undefined` is a verdict about `$orderby` rather
    // than a read of an empty parameter object.
    expect(params.$top).toBeGreaterThan(0);
  });
});
