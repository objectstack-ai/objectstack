/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7243 — the CONTROL of the three-renderer fixture set.
 *
 * `plugin-timeline` was already the reference implementation: it built a
 * value -> option map off `objectSchema.fields[colorField].options` and read
 * `option.color`. This file pins that observable behaviour so the resolver can
 * be LIFTED into `@object-ui/core#createFieldColorResolver` without moving it
 * — every case below is green BEFORE the lift and green AFTER, which is what
 * makes gantt's and calendar's red-to-green readings mean something.
 *
 * The one deliberate widening the lift carries is recorded here too: the hex
 * literal test accepts the 8-digit `#rrggbbaa` spelling, which the timeline's
 * private regex (3 or 6 digits) did not. `plugin-calendar`'s own hex test
 * already accepted 8 digits, so the two in-repo spellings disagreed; the
 * shared rung takes the wider one because the narrow one is the only spelling
 * under which a VALID CSS colour could fall through to a derived colour in
 * gantt. It can only turn "no colour" into the author's colour — never the
 * reverse.
 *
 * The assertions read the items `ObjectTimeline` composes for
 * `TimelineRenderer`; that `color` is what the renderer turns into the
 * marker's `borderColor` / translucent `backgroundColor`.
 *
 * objectui#7521 — `colorsFor` used to leave every render mounted and wait on
 * `lastItems.length` alone. Two components then shared one module-level
 * `lastItems`, and the predicate could not say which of them had written it, so
 * an `it` that called `colorsFor` twice read the FIRST call's colour back out
 * of the second under load. See the two comments in `colorsFor`: the unmount
 * removes the second writer, the title-token predicate removes the blind spot.
 *
 * objectui#7466 — the same failure re-measured, because "it stopped failing"
 * is not a mechanism. ⛔ Do not delete a guard below without re-running this;
 * on an idle machine EVERY variant is green, so a passing run is not evidence.
 *
 * The lever is the METADATA fetch, not machine load. `ObjectTimeline`'s data
 * effect lists `objectDef` in its deps and `objectDef` is set by a separate
 * `getObjectSchema()`, so a mount paints ONCE if the two settle together and
 * TWICE if they do not. This container settles them together — measured, one
 * write per call — which is why plain repetition reproduces nothing. Holding
 * `getObjectSchema` by 25ms splits them and makes the second paint appear:
 *
 *   pre-#7521 harness, unperturbed              0 fail / 32 runs
 *   pre-#7521 harness, getObjectSchema +25ms    3 fail /  3 runs  <- the card's
 *                                                 exact signature, rung 2:
 *                                                 expected ['#abc'] to equal
 *                                                 ['#123456']
 *   this file, getObjectSchema +25ms            0 fail /  6 runs
 *   this file MINUS unmount+DOM guard, +25ms    3 fail /  8 runs  <- the token
 *                                                 predicate ALONE is not enough
 *   ...plus the bound capture below, +25ms      0 fail / 16 runs
 *
 * The last two rows are why `settled` exists: they are the same tree, and the
 * only difference is whether the returned array is the one the predicate
 * accepted or a fresh read of the module global.
 */

import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectTimeline } from './ObjectTimeline';

let lastItems: any[] = [];

vi.mock('./renderer', () => ({
  TimelineRenderer: ({ schema }: any) => {
    lastItems = schema.items ?? [];
    return <div data-testid="timeline-renderer" data-item-count={String(lastItems.length)} />;
  },
}));

/** The authored option colours — identical to the gantt and calendar fixtures. */
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open', color: '#7c3aed' },
  { value: 'done', label: 'Done', color: '#059669' },
];

const OBJECT_SCHEMA = {
  name: 'duly_task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    starts_at: { name: 'starts_at', type: 'datetime' },
    status: { name: 'status', type: 'select', options: STATUS_OPTIONS },
    accent: { name: 'accent', type: 'text' },
  },
};

const ROW = {
  id: '1',
  subject: 'Ship it',
  status: 'open',
  accent: '#123456',
  starts_at: '2026-01-01T09:00:00Z',
};

function makeDataSource(rows: any[]) {
  return {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
  } as any;
}

/** Distinguishes one `colorsFor` render from the next. See `token` below. */
let renderSeq = 0;

async function colorsFor(colorField: string, rows: any[] = [ROW]) {
  // objectui#7521 — a STRUCTURAL guard, deliberately not a timing one. RTL's
  // auto-cleanup runs in `afterEach`, never between two renders inside one
  // `it`, so before the `unmount()` below existed this read 1 on the second
  // call of every multi-render `it` — a settled fact about the DOM at a
  // synchronous point, not a race that has to be caught in the act.
  expect(screen.queryAllByTestId('timeline-renderer')).toHaveLength(0);

  // A token this call OWNS. `ObjectTimeline` composes `title` from
  // `titleField`, so it rides through to `lastItems` untouched — and it is NOT
  // the value under test, so the predicate below can tell "THIS render is
  // ready" from "something else wrote again" without asserting the colour the
  // caller is about to assert.
  const token = `render-${++renderSeq}`;
  const stampedRows = rows.map((row, i) => ({ ...row, subject: `${token}-${i}` }));

  lastItems = [];
  const schema: any = {
    type: 'timeline',
    objectName: 'duly_task',
    titleField: 'subject',
    startDateField: 'starts_at',
    colorField,
  };
  const { unmount } = render(
    <ObjectTimeline schema={schema} dataSource={makeDataSource(stampedRows)} />,
  );
  try {
    // Identify the AUTHOR, not just the arity. `lastItems.length` alone cannot
    // separate "the component I just mounted has painted" from "an earlier one
    // painted again", because both leave length === rows.length.
    //
    // objectui#7466 — and RETURN THE ARRAY THE PREDICATE ACCEPTED. `lastItems`
    // is module-level and mutable, so reading it again on the next line asks a
    // SECOND question, and asks it after React's `act` has yielded to the
    // macrotask queue on its way out of `waitFor` — a real window, in which a
    // still-live writer can answer it. Capturing inside the predicate makes
    // "the value asserted" and "the value validated" the same object by
    // construction, so this line no longer depends on the `unmount()` below
    // having removed every other writer. Measured: 3/8 -> 0/16 (see header).
    let settled: typeof lastItems = [];
    await waitFor(() => {
      const items = lastItems;
      expect(items.map((i) => i.title)).toEqual(stampedRows.map((r) => r.subject));
      settled = items;
    });
    return settled.map((i) => i.color);
  } finally {
    // Tear THIS render down before returning. `ObjectTimeline` still has a
    // second `find()` in flight when the predicate goes green: its data effect
    // lists `objectDef`, which the separate metadata fetch sets a beat later,
    // so every mount fetches twice. A component left mounted here re-renders
    // when that second fetch lands — during the NEXT call, after it has reset
    // `lastItems`.
    unmount();
  }
}

describe('objectui#7243 — timeline colorField ladder (control: green before and after)', () => {
  it('rung 1: a select field paints the AUTHORED option colour', async () => {
    expect(await colorsFor('status')).toEqual(['#7c3aed']);
  });

  it('rung 1: an unmatched value in an optioned field takes no option colour', async () => {
    const rows = [{ ...ROW, status: 'archived' }];
    expect(await colorsFor('status', rows)).toEqual([undefined]);
  });

  it('rung 2: 3- and 6-digit hex literals pass through', async () => {
    expect(await colorsFor('accent', [{ ...ROW, accent: '#abc' }])).toEqual(['#abc']);
    expect(await colorsFor('accent', [{ ...ROW, accent: '#123456' }])).toEqual(['#123456']);
  });

  it('rung 2: rgb() and hsl() literals pass through', async () => {
    expect(await colorsFor('accent', [{ ...ROW, accent: 'rgb(1, 2, 3)' }])).toEqual(['rgb(1, 2, 3)']);
    expect(await colorsFor('accent', [{ ...ROW, accent: 'hsl(1 2% 3%)' }])).toEqual(['hsl(1 2% 3%)']);
  });

  it('a value that is neither an option nor a colour literal yields no colour', async () => {
    expect(await colorsFor('accent', [{ ...ROW, accent: 'in_progress' }])).toEqual([undefined]);
  });

  it('an empty value yields no colour', async () => {
    expect(await colorsFor('accent', [{ ...ROW, accent: '' }])).toEqual([undefined]);
  });
});

/**
 * The ONE case in this file that is not a control: it was red before the lift
 * and is green after. Kept separate so the block above can be read as the pure
 * before/after control it is.
 */
describe('objectui#7243 — the lift widens the hex spelling by one form', () => {
  it('rung 2: an 8-digit #rrggbbaa literal now passes through too', async () => {
    expect(await colorsFor('accent', [{ ...ROW, accent: '#aabbccdd' }])).toEqual(['#aabbccdd']);
  });
});
