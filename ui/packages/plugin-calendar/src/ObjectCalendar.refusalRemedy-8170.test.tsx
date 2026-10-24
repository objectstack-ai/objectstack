/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8170 — the refusal screen's SECOND clause: the remedy.
 *
 * objectui#7029 made this screen REACHABLE and deliberately left its copy
 * alone; `ObjectCalendar.unconfiguredRefusal-7029.test.tsx` next door pins
 * that reachability with `/Calendar configuration required/i`, the FIRST
 * clause, and nothing else. This file owns the second clause, which is the
 * half that was wrong twice over:
 *
 *   1. it demanded `titleField`, which `@objectstack/spec`'s
 *      `CalendarConfigSchema` does not require and this component does not
 *      read when it is absent; and
 *   2. it named two keys as things to "specify" without saying WHERE, which is
 *      unactionable on the interface-page door — that surface has no calendar
 *      slot at all, and its only lever is `sourceView`.
 *
 * ## Why the copy is door-COMPLETE rather than door-AWARE
 *
 * Measured on the branch base: two producers emit an `object-calendar` node —
 * the calendar branch of `plugin-list`'s `ListView` and the one in
 * `plugin-view`'s `ObjectView` — and app-shell reaches the first from both
 * `ObjectView` (the object-view door) and `InterfaceListPage` (the
 * interface-page door). All of them hand this component the same shared
 * `baseProps` bag plus whichever declared binding keys exist. Nothing on the
 * node names the door, so this component cannot branch on it without a new
 * declared prop threaded through four packages. The screen therefore names the
 * one place every door reads the binding from, and states the page door's
 * indirection outright.
 *
 * ## What this file can and cannot prove
 *
 * ⛔ It does NOT re-measure the spec. `@objectstack/spec` is not a runtime
 * dependency of this package, and `@object-ui/types`' local mirror of the
 * calendar block is `.partial()`, so asking it whether `titleField` is
 * required would return a confident answer to a different question. The three
 * legs live in the changeset and are reproducible with
 * `CalendarConfigSchema.safeParse` from `@objectstack/spec/ui`.
 *
 * ⭐ What it DOES prove is the half this package owns and the screen now
 * asserts to the user: a calendar with a date binding and NO `titleField`
 * renders real titles, through `resolveTitle`'s ADR-0079 display-name chain.
 * Without that case the new sentence would be an unbacked promise.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ObjectCalendar } from './ObjectCalendar';

afterEach(cleanup);

/** The clause objectui#8170 deliberately did NOT move — five suites pin it. */
const REFUSAL = /Calendar configuration required/i;

const today = new Date();
const dayInThisMonth = (d: number) =>
  new Date(today.getFullYear(), today.getMonth(), Math.min(d, 28), 9, 0, 0, 0);

const ROWS = [
  { id: 'r1', name: 'Ada out', start_date: dayInThisMonth(10).toISOString() },
  { id: 'r2', name: 'Grace out', start_date: dayInThisMonth(12).toISOString() },
];

const objectDef = {
  name: 'crm_leave_request',
  fields: {
    id: { type: 'text' },
    name: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
  },
};

const makeDataSource = () =>
  ({
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    getObjectSchema: vi.fn().mockResolvedValue(objectDef),
  }) as any;

/**
 * The whole refusal block as one whitespace-normalised string. The copy spans
 * two paragraphs, so a single `getByText` would only ever see one of them.
 */
async function readRefusalScreen(): Promise<string> {
  const { container } = render(
    <ObjectCalendar
      schema={{ type: 'object-calendar', objectName: 'crm_leave_request' } as any}
      dataSource={makeDataSource()}
    />,
  );
  await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('ObjectCalendar refusal screen — the remedy it states (objectui#8170)', () => {
  it('still opens with the clause every sibling suite pins', async () => {
    // The guard on this card's own blast radius. Reword the FIRST clause and
    // five other suites go red at once; this case is here so that failure has
    // a named owner instead of arriving as five unexplained reds.
    expect(await readRefusalScreen()).toContain('Calendar configuration required');
  });

  it('⛔ no longer demands `titleField` alongside the date key', async () => {
    const text = await readRefusalScreen();
    // The exact shape of the retired sentence. This is the assertion that
    // fails against the pre-card wording and passes against the new one.
    expect(text).not.toMatch(/startDateField\s+and\s+titleField/i);
    // …and it is a REWORDING, not a deletion: the one key the spec requires is
    // still named, so an author still knows what to write.
    expect(text).toContain('startDateField');
    // The claim the screen now makes about the optional key is stated, not
    // merely implied by its absence — the CONTROL case below is its proof.
    expect(text).toMatch(/resolves without titleField/i);
  });

  it('names a remedy the INTERFACE-PAGE door can actually act on', async () => {
    const text = await readRefusalScreen();
    // `InterfaceListPage` reads no calendar key off `interfaceConfig` at all,
    // so "specify startDateField" is not something a page author can do. The
    // lever that door does have is `sourceView`.
    expect(text).toContain('sourceView');
  });

  it('names the place the OBJECT-VIEW door writes the binding', async () => {
    const text = await readRefusalScreen();
    // The shared half: both doors resolve the binding out of the view's
    // `calendar` block, which is why one sentence can serve both.
    expect(text).toMatch(/calendar block/i);
  });

  it('CONTROL: a configured calendar still renders and shows no refusal', async () => {
    // Without this, a change that refused everything — or one that broke the
    // component outright — would satisfy every assertion above.
    render(
      <ObjectCalendar
        schema={
          {
            type: 'object-calendar',
            objectName: 'crm_leave_request',
            startDateField: 'start_date',
            titleField: 'name',
          } as any
        }
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it('⭐ CONTROL: the screen’s claim is true — no `titleField`, real titles', async () => {
    // This is the runtime half of "the event title resolves without
    // titleField". `resolveTitle` takes the explicit key when present and
    // otherwise goes through `getRecordDisplayName`, the ADR-0079 chain. If
    // that ever regresses, the sentence on the refusal screen becomes a lie
    // and this case is what says so.
    render(
      <ObjectCalendar
        schema={
          {
            type: 'object-calendar',
            objectName: 'crm_leave_request',
            startDateField: 'start_date',
          } as any
        }
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    expect(screen.getByText('Grace out')).toBeTruthy();
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});
