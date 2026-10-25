/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectTimeline` reads its `find()` answer as `QueryResult` DECLARES it — and
 * does NOT read `records` (objectui#6839).
 *
 * ## Why per module, when the read lives in ONE shared helper
 *
 * objectui#6726 repaired seven consumers that each carried their OWN copy of
 * the read, so its per-module pins answered "were all seven repaired". Here
 * there is one read site (`extractRecords`, `@object-ui/core`), and the
 * per-module question is a different one: does THIS module actually route its
 * answer through the helper? A module that unwrapped the envelope itself — as
 * `plugin-list`'s `ListView` still does — would inherit nothing from the
 * helper's own pin, and a repo-wide "nothing reads `records`" assertion would
 * pass over it in silence. This file measures the route, at the rows.
 *
 * MEASURED for this module: no `find()` in `plugin-timeline`, nor in any app or
 * example that mounts a timeline, emits a `records` envelope. CONTROL, so the
 * zero is a reading — the same sweep finds `records` envelopes at other seams,
 * including one live `find()` double (`plugin-list`'s ObjectGallery) and the
 * record-visibility batch route stubs in this repo's own sibling packages.
 *
 * ⚠️ The refusal case below is ALSO satisfied by an `extractRecords` that
 * returns `[]` for everything — an implementation strictly worse than the bug.
 * The `data` and bare-array cases are the ones that refuse it: they push the
 * SAME rows through the SAME mount, so an arm that delivers nothing delivered
 * nothing because the envelope was refused.
 *
 * ## What this file's wait used to STAND ON without saying so (objectui#8709)
 *
 * The wait named `data-item-count` and did not gate on it. `getByTestId`
 * THROWING inside `waitFor` was the entire gate; by the time the attribute was
 * read the node existed and the renderer double writes the attribute
 * unconditionally, so `.not.toBeNull()` could never be the clause that failed.
 * ⭐ That is worse than no clause: it reads like a row-count gate and is a
 * mount signal, satisfied the instant the renderer appears — `"0"` included.
 *
 * MEASURED, not argued: with `setFetchedData` deferred by 50ms and the
 * `records` arm restored to `extractRecords`, the wait was satisfied at
 * `data-item-count="0"` and the refusal case PASSED while the settled timeline
 * drew two rows. `itemsThrough` now gates on the count the wait names AND on
 * that count surviving a settle window, with the loading skeleton observed
 * first so a renderer mounted empty on the first paint is not read as a
 * settled zero.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor, cleanup, screen } from '@testing-library/react';
import React from 'react';

// The timeline's own visualisation is orthogonal to what this file observes
// (how many rows reached it), and rendering it pulls a chart's worth of DOM
// per case. The rows arrive as `schema.items`.
vi.mock('./renderer', () => ({
  TimelineRenderer: ({ schema }: any) => (
    <div data-testid="timeline-renderer" data-item-count={String((schema.items ?? []).length)} />
  ),
}));

import { ObjectTimeline } from './ObjectTimeline';

const OBJECT = 'duty_task';
const ROWS = [
  { id: 't1', subject: 'Ship it', starts_at: '2026-01-01T09:00:00Z' },
  { id: 't2', subject: 'Ship it again', starts_at: '2026-01-02T09:00:00Z' },
];

/**
 * The window held open AFTER the renderer reports the expected count, to prove
 * no further rows arrive behind it.
 *
 * ⚠️ 50ms, not 0ms. RTL's `asyncWrapper` drains one macrotask before it
 * returns, so a commit scheduled with `setTimeout(…, 0)` lands INSIDE that
 * drain window — a 0ms window cannot tell a deferred commit from a same-commit
 * one, and reports "stable" for both (measured on objectui#8664).
 */
const POST_SETTLE_MS = 50;

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

const schema: any = {
  type: 'timeline',
  objectName: OBJECT,
  titleField: 'subject',
  startDateField: 'starts_at',
};

/**
 * Mount the timeline over a `find()` answering `envelope`, return rows drawn.
 *
 * `expectedItems` is the count this arm claims the envelope produces, and it is
 * what the wait GATES on — see the comments in the body for why the count has
 * to be named here rather than merely read at the end.
 */
async function itemsThrough(envelope: Envelope, expectedItems: number): Promise<number> {
  const ds: Record<string, any> = {
    find: vi.fn(async () => envelope(ROWS)),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: {
        id: { type: 'text', label: 'Id' },
        subject: { type: 'text', label: 'Subject' },
        starts_at: { type: 'datetime', label: 'Start' },
      },
    })),
  };
  render(<ObjectTimeline schema={schema} dataSource={ds as any} />);
  // ① The transition's START, observed. Without it a component that mounts the
  // renderer EMPTY on its first paint and fetches afterwards clears every bar
  // below on the refusal arm — `"0"`, stable, forever. The skeleton is the
  // proof that this mount actually went through a loading phase.
  //
  // ⚠️ `toBeTruthy`, not `toBeInTheDocument`: this package's
  // `tsconfig.test.json` does not name `@testing-library/jest-dom` in `types`
  // (the sibling `plugin-map` one does), so that matcher is green under vitest
  // and TS2339 under `tsc -p tsconfig.test.json`. `getByTestId` THROWING when
  // the skeleton is absent is the assertion either way; the matcher only
  // attaches the message.
  expect(
    screen.getByTestId('timeline-loading'),
    'the loading skeleton must be on screen first — a renderer mounted empty from the first paint is not a settled zero',
  ).toBeTruthy();
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  // `find`'s OWN answer, settled — a pure read of the mock's call record that
  // touches no DOM. Without it the assertion can be satisfied by the mount's
  // initial empty state, which every arm renders identically.
  await ds.find.mock.results[0].value;
  // ② Gate on the count this wait NAMES, at the value this arm claims.
  //
  // The clause here used to be `.not.toBeNull()`, and it was INERT: the
  // attribute is written unconditionally by the renderer double, so once
  // `getByTestId` stops throwing the attribute is always a string. The THROW
  // was the whole gate, which made this a bare mount signal wearing the
  // vocabulary of a row count — `"0"` satisfied it, so an arm expecting rows
  // and an arm expecting none waited on exactly the same event.
  await waitFor(() =>
    expect(
      screen.getByTestId('timeline-renderer').getAttribute('data-item-count'),
      'the renderer must report the row count this envelope produces, not merely exist',
    ).toBe(String(expectedItems)),
  );
  // ③ … and it must STILL be that count after the settle window. This is the
  // half ② cannot supply on the refusal arm, where the expected value is `"0"`
  // and `"0"` is also what an unpopulated renderer reports. MEASURED: with
  // `setFetchedData` deferred by 50ms and the `records` arm restored to
  // `extractRecords`, the old wait was satisfied at `data-item-count="0"` and
  // the refusal case PASSED while the settled timeline drew two rows
  // (objectui#8709 leg A).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, POST_SETTLE_MS));
  });
  const settled = screen.getByTestId('timeline-renderer').getAttribute('data-item-count');
  expect(
    settled,
    'rows must not arrive AFTER the count was read — a count that moves in the settle window was an intermediate state',
  ).toBe(String(expectedItems));
  return Number(settled);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectTimeline — the find() envelope it reads (objectui#6839)', () => {
  it("still reads the contract's `data` member", async () => {
    // ⛔ Never call `itemsThrough` from inside a `waitFor` predicate
    // (objectui#7802): it renders, and `waitFor` re-runs its callback on DOM
    // mutations, so the predicate feeds itself and leaks a container div per
    // run. The render happens once, out here, and the case reads its answer.
    expect(await itemsThrough(asData, 2), 'the declared rows member must still draw').toBe(2);
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    expect(await itemsThrough(asBareArray, 2), 'the bare-array arm must still draw').toBe(2);
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    // Before the fix these two rows drew off a key `QueryResult` does not
    // declare, and did so AHEAD of `data`.
    expect(
      await itemsThrough(asRecords, 0),
      'a `records` envelope must reach the rail as zero rows, not as the rows it names',
    ).toBe(0);
  });
});
