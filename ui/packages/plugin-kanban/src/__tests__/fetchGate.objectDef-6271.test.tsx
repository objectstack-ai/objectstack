/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6271 — the object definition GATES `ObjectKanban`'s record query.
 *
 * ## What this replaces
 *
 * The board ran its fetch effect twice on every standalone mount, because
 * `objectDef` was in that effect's dependency list while being resolved by a
 * SEPARATE effect. Captured from a real render, the two argument sets in order:
 *
 *     ['deal', { $top: 100 }]
 *     ['deal', { $top: 100, $expand: ['owner'] }]
 *
 * The first ran before the definition resolved, so `buildExpandFields` saw no
 * fields and the query carried no `$expand` at all.
 *
 * ## Why gating, and not "make the unexpanded first paint deliberate"
 *
 * Both were live options and the choice was made on measurement, not taste.
 *
 *   1. That first response never reached the screen in the regimes that
 *      matter. With the schema resolving no slower than the row query
 *      (measured profiles schema/find = 30/30, 30/60, 5/30 ms), the definition
 *      lands first, the effect re-runs, its cleanup flips `isMounted` false —
 *      and the unexpanded rows are DISCARDED on arrival. A probe watching the
 *      DOM every 2ms for a title only the first response carried never fired
 *      once. So the extra round trip bought no earlier paint; it bought a
 *      query whose answer was thrown away.
 *   2. What the gate costs is one schema resolution ahead of the query, and a
 *      schema read is cheap and shared: one small GET behind the same
 *      discovery call `find` already awaits, served thereafter from
 *      `MetadataCache` (5-minute TTL, concurrent readers coalesced onto ONE
 *      request). Measured against the real `ObjectStackAdapter` over loopback
 *      HTTP: 22 reads of the same object produced exactly one metadata
 *      request, and every read after the first returned in 0.01ms.
 *   3. End to end the board is not slower for it. Same harness, before/after:
 *      the fully-populated board landed at 156.9 → 145.2ms (30/30),
 *      119.8 → 110.6ms (30/60), 54.7 → 52.4ms (5/30) — one query instead of
 *      two, and nothing left to overwrite.
 *
 * ## ⚠️ What "gated" must mean — the trap this file exists to hold shut
 *
 * The gate is on the definition read having **settled**, NOT on `objectDef`
 * being truthy. Those differ for exactly the boards least able to report it:
 * an adapter that exposes no `getObjectSchema`, and a schema read that throws.
 * Under a truthy-value gate both wait forever and the board renders empty, with
 * no error and no request — the third and fourth tests below are red the moment
 * anyone writes that. They are also the control the first test needs: a
 * query-count assertion that would pass with ZERO fetches is decoration, so
 * every count here is reached only after waiting for a real call.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`.
import '../index';
// The cards asserted below render INSIDE `KanbanRenderer`'s `React.lazy`
// boundary. Importing the chunk at module scope bills the cold transform to the
// import phase (unbounded) instead of racing a `waitFor` budget under full
// parallelism — the objectui#3010 rule, same specifier as `index.tsx`'s factory
// so ESM's module cache makes that factory resolve immediately.
import '../KanbanImpl';

const DEAL_SCHEMA = {
  name: 'deal',
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'text', label: 'Status' },
    // The only expandable member, so `$expand` has one predictable entry.
    owner: { type: 'lookup', reference: 'user', label: 'Owner' },
  },
};

const ROWS = [{ id: 'd1', name: 'Q3 renewal', status: 'open', owner: { id: 'u1', name: 'Jane Ops' } }];

/**
 * `getObjectSchema` deliberately resolves a tick LATER than a bare
 * `mockResolvedValue` would, so a board that queries before the definition
 * settles is caught rather than accidentally passing on scheduling luck.
 */
function makeAdapter(
  getObjectSchema?: () => Promise<unknown>,
): Record<string, any> {
  const order: string[] = [];
  const adapter: Record<string, any> = {
    order,
    find: vi.fn(async (_object: string, _params: any) => {
      order.push('find');
      return { data: ROWS };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  if (getObjectSchema) {
    adapter.getObjectSchema = vi.fn(async () => {
      order.push('schema:issued');
      try {
        return await getObjectSchema();
      } finally {
        order.push('schema:settled');
      }
    });
  }
  return adapter;
}

const resolvesSchema = () =>
  makeAdapter(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return DEAL_SCHEMA;
  });

function renderBoard(adapter: Record<string, any>) {
  return render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer
        schema={
          {
            type: 'object-kanban',
            objectName: 'deal',
            groupBy: 'status',
            columns: [{ id: 'open', title: 'Open' }],
          } as any
        }
      />
    </SchemaRendererProvider>,
  );
}

const paramsOf = (adapter: Record<string, any>) =>
  adapter.find.mock.calls.map((c: any[]) => c[1] ?? {});
const unexpandedCalls = (adapter: Record<string, any>) =>
  paramsOf(adapter).filter((p: any) => !Array.isArray(p.$expand) || p.$expand.length === 0);

describe('ObjectKanban gates its record query on the object definition (objectui#6271)', () => {
  it('issues ONE query, and it carries the object’s `$expand`', async () => {
    const adapter = resolvesSchema();
    renderBoard(adapter);

    // Wait for the EXPANDED query specifically. This is the control that keeps
    // the two assertions under it from being vacuous: if the gate ever stops
    // opening, no call is recorded, this times out, and the file goes red —
    // "0 queries" can never read as success here.
    await waitFor(() =>
      expect(paramsOf(adapter).filter((p: any) => p.$expand?.includes('owner'))).toHaveLength(1),
    );

    // RED before the fix: the board also issued `['deal', { $top: 100 }]`
    // before the definition resolved.
    expect(unexpandedCalls(adapter)).toEqual([]);
    expect(adapter.find).toHaveBeenCalledTimes(1);
    expect(adapter.find.mock.calls[0][0]).toBe('deal');
  });

  it('issues that query only AFTER the definition read settles', async () => {
    const adapter = resolvesSchema();
    renderBoard(adapter);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // Ordering, not just counting: a fix that merely deduplicated the second
    // query would satisfy the test above while still querying too early.
    expect(adapter.order).toEqual(['schema:issued', 'schema:settled', 'find']);
  });

  it('still queries — and paints — when the adapter exposes NO `getObjectSchema`', async () => {
    // The gate is on the read having settled, not on a truthy definition. An
    // adapter without the method settles with nothing to report, and the board
    // must fall through to an unexpanded query rather than wait forever.
    const adapter = makeAdapter();
    const { container } = renderBoard(adapter);

    await waitFor(() => expect(container.textContent).toContain('Q3 renewal'));
    expect(adapter.find).toHaveBeenCalledTimes(1);
    // Nothing declared any field, so there is no expand set to derive.
    expect(unexpandedCalls(adapter)).toHaveLength(1);
  });

  it('still queries — and paints — when the definition read REJECTS', async () => {
    const adapter = makeAdapter(async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('metadata endpoint down');
    });
    // ⚠️ The CHANNEL moved with objectui#7225's migration and this spy moved
    // with it (maintainer ruling B, 2026-09-02, which names exactly this):
    // the hand copy this component used to carry logged the rejected read on
    // `console.warn`; `useSettledSchema` logs it on `console.error` with a
    // bracketed prefix. Silencing the wrong channel here would have let the
    // rejection print through the suite while this file still read as green,
    // so the spy is ASSERTED on, not merely installed — a silenced channel
    // nobody checks is how a moved log goes unnoticed.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = renderBoard(adapter);
      await waitFor(() => expect(container.textContent).toContain('Q3 renewal'));
      expect(adapter.find).toHaveBeenCalledTimes(1);
      expect(unexpandedCalls(adapter)).toHaveLength(1);
      expect(adapter.order).toEqual(['schema:issued', 'schema:settled', 'find']);
      expect(error).toHaveBeenCalled();
      expect(String(error.mock.calls[0]?.[0] ?? '')).toContain('[useSettledSchema]');
    } finally {
      error.mockRestore();
    }
  });

  it('a parent-fed board still reads the definition and issues no query of its own', async () => {
    // `data` from a parent has always suppressed the internal fetch; the gate
    // must not have turned that into a suppressed SCHEMA read, which is what
    // the lane titles and card labels are built from.
    const adapter = resolvesSchema();
    render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer
          schema={
            {
              type: 'object-kanban',
              objectName: 'deal',
              groupBy: 'status',
              columns: [{ id: 'open', title: 'Open' }],
              data: ROWS,
            } as any
          }
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalled());
    expect(adapter.find).not.toHaveBeenCalled();
  });
});
