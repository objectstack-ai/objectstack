/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7895 — the timeline's DUPLICATE query is gated. It was the last
 * member of the set objectui#6482 converged (`ObjectKanban`, `ObjectView`,
 * `ObjectCalendar`, `ObjectTree`; `ObjectGantt` at objectui#7225 ask 2) still
 * carrying the pre-gate shape, and nothing marked it a deliberate exclusion.
 *
 * Before this, `ObjectTimeline` held the object definition in a local
 * `useState` and listed it in the record-fetch effect's dependency array, so a
 * mount issued TWO `find` calls: one before the definition settled, with
 * `buildExpandFields` seeing no fields and therefore NO `$expand` at all, and
 * one after.
 *
 * ⛔ A GREEN RUN WITH NO HOLD IS ZERO EVIDENCE HERE. This container settles the
 * metadata read and the record read together by default, so the defect is
 * invisible unperturbed — that is the reading objectui#7466 paid for. The lever
 * is the METADATA fetch, so `getObjectSchema` is HELD and the writes into an
 * instrumented renderer are counted per SINGLE mount. Measured on this
 * component with that instrument, `ObjectCalendar` and `ObjectGantt` as
 * positive controls in the same vitest run, holds 0/1/2/3/4/5/6/7/8/9/10/15/
 * 25/50/100 ms:
 *
 *   component        hold        paints  late writes  first paint  find calls
 *   ObjectTimeline   before, +3ms and up   4      3        3-7ms        2
 *   ObjectTimeline   before, +0 / +1ms     1      0        5ms          2
 *   ObjectTimeline   after,  every hold    1      0     tracks the hold  1
 *   ObjectCalendar   before and after      1      0     tracks the hold  1
 *   ObjectGantt      before and after      1      0     tracks the hold  1
 *
 * ⭐ "First paint tracks the hold" is the signature that the gate is LIVE, and
 * it is what the last case below pins — not as a wall-clock threshold, which
 * would be a timing test, but as an ORDER: the definition resolves, then the
 * query goes out, then the renderer is written to, exactly once. Before the
 * gate that order was find, paint, definition, find, paint. Measured after:
 * 8ms at a +3ms hold, 19ms at +10, 30ms at +25, 105ms at +100, against a flat
 * 3-7ms at every hold before it.
 *
 * ⚠️ The gate is only safe because the resolution now SETTLES ON EVERY EXIT
 * (objectui#7232, via the shared `useSettledSchema`): the replaced effect
 * returned without settling on `!dataSource`, on a missing `getObjectSchema`,
 * on an absent object name and in its `catch`. That cost nothing while nothing
 * waited on it and would hold a gated query open FOREVER. The two middle cases
 * below are that trap, pinned: a timeline that never loads is the failure this
 * file exists to make impossible.
 *
 * ⛔ GATING IS NOT EXPANDING. objectui#7429 is the separate, non-overlapping
 * concern of whether the `$expand` set this query carries is FLS-gated; this
 * file asserts only HOW MANY queries go out and whether the first one carries
 * its expansion.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectTimeline } from './ObjectTimeline';

/** Every write into the renderer, in order — the paint counter. */
let paints: number[] = [];
/** Definition resolve / query / paint, interleaved in the order they happen. */
let sequence: string[] = [];

vi.mock('./renderer', () => ({
  TimelineRenderer: ({ schema }: any) => {
    const items = schema.items ?? [];
    paints.push(items.length);
    sequence.push('paint');
    return <div data-testid="timeline-renderer" data-item-count={String(items.length)} />;
  },
}));

/** A definition with a lookup, so a gated query has a real `$expand` to carry. */
const OBJECT_SCHEMA = {
  name: 'duly_task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    starts_at: { name: 'starts_at', type: 'datetime' },
    owner: { name: 'owner', type: 'lookup', reference: 'user' },
  },
};

const ROWS = [{ id: '1', subject: 'Ship it', owner: 'u1', starts_at: '2026-01-01T09:00:00Z' }];

const schema: any = {
  type: 'timeline',
  objectName: 'duly_task',
  titleField: 'subject',
  startDateField: 'starts_at',
};

function makeAdapter(getObjectSchema?: any) {
  return {
    find: vi.fn(async () => {
      sequence.push('find');
      return { data: ROWS, total: ROWS.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...(getObjectSchema === undefined ? {} : { getObjectSchema }),
  } as any;
}

/** The expand sets of every issued query, in order. */
function expandSets(adapter: any): Array<unknown> {
  return adapter.find.mock.calls.map(([, params]: [string, any]) => params?.$expand ?? null);
}

beforeEach(() => {
  paints = [];
  sequence = [];
});

describe('objectui#7895 — the timeline waits for the object definition instead of querying twice', () => {
  it('issues ONE query per load, and it already carries the expansion', async () => {
    const adapter = makeAdapter(vi.fn(async () => OBJECT_SCHEMA));

    render(<ObjectTimeline schema={schema} dataSource={adapter} />);

    await waitFor(() => expect(screen.getByTestId('timeline-renderer')).toBeTruthy());
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));

    // The old regime's signature was `[null, ['owner']]`. One expanded call.
    expect(expandSets(adapter)).toEqual([['owner']]);
    expect(adapter.getObjectSchema).toHaveBeenCalledTimes(1);
  });

  it('never issues an UNEXPANDED query for an object that declares a lookup', async () => {
    const adapter = makeAdapter(vi.fn(async () => OBJECT_SCHEMA));

    render(<ObjectTimeline schema={schema} dataSource={adapter} />);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // The discarded round trip — and the raw-id frame it painted — is the thing
    // gating removes. Not "fewer" unexpanded calls: none.
    for (const params of adapter.find.mock.calls.map(([, p]: [string, any]) => p)) {
      expect(params.$expand).toEqual(['owner']);
    }
  });

  it('still queries when the adapter exposes NO `getObjectSchema` — the gate is on SETTLED, not on truthy', async () => {
    // objectui#7232's trap: an exit that returns without settling would hold
    // this query open forever, and the timeline would never load.
    const adapter = makeAdapter(undefined);

    render(<ObjectTimeline schema={schema} dataSource={adapter} />);

    await waitFor(() => expect(screen.getByTestId('timeline-renderer')).toBeTruthy());
    expect(adapter.find).toHaveBeenCalledTimes(1);
    // Nothing to derive an expand set from, so the query is unexpanded — the
    // same query this case produced before the gate.
    expect(expandSets(adapter)).toEqual([null]);
  });

  it('still queries when the definition read REJECTS', async () => {
    const adapter = makeAdapter(
      vi.fn(async () => {
        throw new Error('metadata endpoint down');
      }),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<ObjectTimeline schema={schema} dataSource={adapter} />);

      await waitFor(() => expect(screen.getByTestId('timeline-renderer')).toBeTruthy());
      expect(adapter.find).toHaveBeenCalledTimes(1);
      expect(expandSets(adapter)).toEqual([null]);
      expect(String(error.mock.calls[0]?.[0] ?? '')).toContain('[useSettledSchema]');
    } finally {
      error.mockRestore();
    }
  });

  it('an AUTHORED `items` timeline paints without issuing any record query', async () => {
    const authored: any = {
      ...schema,
      items: [{ title: 'Ship it', time: '2026-01-01T09:00:00Z' }],
    };
    const adapter = makeAdapter(vi.fn(async () => OBJECT_SCHEMA));

    render(<ObjectTimeline schema={authored} dataSource={adapter} />);

    await waitFor(() =>
      expect(screen.getByTestId('timeline-renderer').getAttribute('data-item-count')).toBe('1'),
    );
    expect(adapter.find).not.toHaveBeenCalled();
    // ⛔ The metadata read is NOT disabled on this path, unlike the sibling
    // components' `hasInlineData ? undefined : dataSource`. `effectiveItems`
    // reads `objectDef.fields` for option colours and field labels even when
    // the items were authored, so taking the read away would be a second,
    // unasked-for change riding on a fetch-sequencing fix.
    expect(adapter.getObjectSchema).toHaveBeenCalledTimes(1);
  });

  it('under a HELD definition read: ONE paint, and it arrives AFTER the definition', async () => {
    // ⛔ The hold is the whole instrument. Without it this container settles
    // both reads together and the case passes on the unfixed component too.
    const HOLD_MS = 25;
    const adapter = makeAdapter(
      vi.fn(async () => {
        await new Promise((r) => setTimeout(r, HOLD_MS));
        sequence.push('definition');
        return OBJECT_SCHEMA;
      }),
    );

    render(<ObjectTimeline schema={schema} dataSource={adapter} />);

    await waitFor(() => expect(screen.getByTestId('timeline-renderer')).toBeTruthy());
    // Leave the render MOUNTED and let anything still in flight land — the late
    // writes are only observable on a render that is still there to receive
    // them. Measured before the gate at this hold: 3 of them.
    await act(async () => {
      await new Promise((r) => setTimeout(r, HOLD_MS + 150));
    });

    expect(paints).toEqual([ROWS.length]);
    // The ORDER is the signature, not a wall-clock threshold. Before the gate:
    // find, paint, definition, find, paint (and two more writes after).
    expect(sequence).toEqual(['definition', 'find', 'paint']);
    expect(adapter.find).toHaveBeenCalledTimes(1);
    expect(expandSets(adapter)).toEqual([['owner']]);
  });
});
