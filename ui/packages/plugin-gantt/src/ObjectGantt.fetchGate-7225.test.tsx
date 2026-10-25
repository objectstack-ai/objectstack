/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7225 ask 2 — the gantt's DUPLICATE query is gated (maintainer
 * ruling B, 2026-09-02; objectui#6482's undischarged gating half).
 *
 * Before this, `reload` listed `objectSchema` in its dependency list, so a
 * mount issued TWO `find` calls: one before the object schema settled, with
 * `buildExpandFields` seeing no fields and therefore NO `$expand` at all, and
 * one after. Measured on this component with an instrumented adapter over
 * three latency profiles — invariably 2 `find` and 1 `getObjectSchema` per
 * load, expand sets `[null, ['owner']]`.
 *
 * ⭐ Why gating pays HERE, per #6482's own per-component standard (it measured
 * three profiles and found the cost differs by component, so the table is not
 * an argument on its own): the gantt is not the mild kanban-style "round trip
 * bought and thrown away". Whenever the metadata read is the slower of the two
 * — the common case on a cold `MetadataCache` — the user sees the full
 * THREE-STEP PAINT: raw foreign-key ids, back to the loading placeholder, then
 * the expanded rows.
 *
 * ⛔ GATING IS NOT CAPPING. objectui#7210's ruling a' put a row ceiling on
 * these queries and that is a different change on the same lines; this file
 * asserts only HOW MANY queries go out and whether the first one carries its
 * expansion. The ceiling has its own pin
 * (`ObjectGantt.rowCeiling-7210.test.tsx`).
 *
 * ⚠️ The gate is only safe because the schema resolution now SETTLES ON EVERY
 * EXIT (objectui#7232): the component's own effect used to return without
 * settling on `!effectiveDataSource`, on `!resource` and in its `catch`, which
 * cost nothing while nothing waited on it — and would hold a gated query open
 * FOREVER. `useSettledSchema` settles on all three, and the last two cases
 * below are that trap, pinned: a chart that never loads is the failure this
 * file exists to make impossible.
 *
 * REVERSE VERIFICATION — prediction MISSED, reported rather than adjusted.
 * Predicted before running: deleting
 * `if (recordQueryDerivesExpand && !objectSchemaReady) return;` from
 * `ObjectGantt` turns the first two cases red and leaves the two
 * settle-on-every-exit cases green — 2 failed / 3 passed. OBSERVED:
 * **4 failed / 1 passed**. Direction as predicted, magnitude higher, and the
 * reason is worth writing down: the prediction assumed the second query came
 * from `objectSchema`'s identity changing, so a definition that settles as
 * `null` (no `getObjectSchema`, or a read that threw) would still produce one
 * query. It does not. The second query comes from `objectSchemaReady` being in
 * the effect's DEPENDENCY LIST — it flips `false` to `true` on every path,
 * including both settle-with-nothing paths, so with the early return deleted
 * the effect re-runs and reloads a second time in all four adapter cases. The
 * inline-`value` case is the one that stays green, since it never queries at
 * all. The gate line and the dependency are two halves of one mechanism, and
 * the ablation only removed one of them.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view" data-task-count={String(tasks.length)} />
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

const ROWS = [
  { id: '1', subject: 'Renewal', owner: 'u1', visible_from: '2026-01-01', due_date: '2026-01-05' },
];

/** A definition with a lookup, so a gated query has a real `$expand` to carry. */
const OBJECT_DEF = {
  name: 'task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    owner: { name: 'owner', type: 'lookup', reference: 'user' },
    visible_from: { name: 'visible_from', type: 'date' },
    due_date: { name: 'due_date', type: 'date' },
  },
};

function makeAdapter(getObjectSchema?: any) {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...(getObjectSchema === undefined ? {} : { getObjectSchema }),
  } as any;
}

const schema: any = {
  type: 'object-gantt',
  objectName: 'task',
  gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' },
};

/** The expand sets of every issued query, in order. */
function expandSets(adapter: any): Array<unknown> {
  return adapter.find.mock.calls.map(([, params]: [string, any]) => params?.$expand ?? null);
}

describe('objectui#7225 ask 2 — the gantt waits for the object schema instead of querying twice', () => {
  it('issues ONE query per load, and it already carries the expansion', async () => {
    const adapter = makeAdapter(vi.fn(async () => OBJECT_DEF));

    render(<ObjectGantt schema={schema} dataSource={adapter} />);

    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));

    // The old regime's signature was `[null, ['owner']]`. One expanded call.
    expect(expandSets(adapter)).toEqual([['owner']]);
    expect(adapter.getObjectSchema).toHaveBeenCalledTimes(1);
  });

  it('never issues an UNEXPANDED query for an object that declares a lookup', async () => {
    const adapter = makeAdapter(vi.fn(async () => OBJECT_DEF));

    render(<ObjectGantt schema={schema} dataSource={adapter} />);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // The discarded round trip — and the raw-id frame it painted — is the
    // thing gating removes. Not "fewer" unexpanded calls: none.
    for (const params of adapter.find.mock.calls.map(([, p]: [string, any]) => p)) {
      expect(params.$expand).toEqual(['owner']);
    }
  });

  it('still queries when the adapter exposes NO `getObjectSchema` — the gate is on SETTLED, not on truthy', async () => {
    // objectui#7232's trap: an exit that returns without settling would hold
    // this query open forever, and the chart would never load.
    const adapter = makeAdapter(undefined);

    render(<ObjectGantt schema={schema} dataSource={adapter} />);

    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    expect(adapter.find).toHaveBeenCalledTimes(1);
    // Nothing to derive an expand set from, so the query is unexpanded — which
    // is the same query this case produced before the gate.
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
      render(<ObjectGantt schema={schema} dataSource={adapter} />);

      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      expect(adapter.find).toHaveBeenCalledTimes(1);
      expect(expandSets(adapter)).toEqual([null]);
      expect(String(error.mock.calls[0]?.[0] ?? '')).toContain('[useSettledSchema]');
    } finally {
      error.mockRestore();
    }
  });

  it('an inline `value` data set paints without waiting for any metadata read', async () => {
    const inline: any = {
      ...schema,
      data: { provider: 'value', items: ROWS },
    };
    const adapter = makeAdapter(vi.fn(async () => OBJECT_DEF));

    render(<ObjectGantt schema={inline} dataSource={adapter} />);

    await waitFor(() =>
      expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe('1'),
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });
});
