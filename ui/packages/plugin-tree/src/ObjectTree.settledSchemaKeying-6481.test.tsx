/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectTree — the settled-schema gate must be KEYED to the bound object
 * (objectui#6481), and must still settle on EVERY exit (objectui#6014).
 *
 * These two properties pull in opposite directions and that is the whole
 * point of the file: one of them says "do not query until the schema is in",
 * the other says "never wait for a schema that is not coming". A latch that
 * satisfies only the first hangs forever on an adapter with no
 * `getObjectSchema`; a latch that satisfies only the second — the bare
 * boolean this card replaces — queries the NEW object with the OLD object's
 * `$expand`.
 *
 * Measured on THIS component before the fix, not transferred from
 * objectui#6453 / #6419: `ObjectTree`'s record effect has its own dependency
 * set (`dataConfig`, `dataSource`, `schema.filter`, the schema resolution,
 * `(rest as any).data`), and its gate sits INSIDE the object-provider branch
 * rather than at the top of the effect.
 */

import React from 'react';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ObjectTree } from './ObjectTree';

afterEach(cleanup);

interface FindCall {
  object: string;
  options: any;
}

/** A promise a test resolves by hand, so "not settled yet" is a real state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Two self-referencing objects whose EXPANDABLE field sets are disjoint apart
 * from the parent pointer. `head` exists only on `business_unit` and `region`
 * only on `territory`, so an `$expand` naming the wrong one is unambiguous
 * evidence of which object's schema built it.
 */
const SCHEMAS: Record<string, any> = {
  business_unit: {
    name: 'business_unit',
    fields: {
      name: { type: 'text' },
      parent_id: { type: 'tree', reference: 'business_unit' },
      head: { type: 'lookup', reference: 'users' },
    },
  },
  territory: {
    name: 'territory',
    fields: {
      name: { type: 'text' },
      parent_id: { type: 'tree', reference: 'territory' },
      region: { type: 'lookup', reference: 'regions' },
    },
  },
};

function treeSchema(objectName: string) {
  return {
    type: 'object-tree',
    objectName,
    parentField: 'parent_id',
    labelField: 'name',
    fields: ['name'],
  } as any;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The rejected-read path logs; keep the suite output honest without
  // swallowing a real unexpected error (asserted on in that test).
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe('ObjectTree settled-schema gate is keyed to the bound object (objectui#6481)', () => {
  it('never queries a switched-to object with the previous object\'s $expand', async () => {
    const findCalls: FindCall[] = [];
    const gates: Record<string, ReturnType<typeof deferred<any>>> = {
      business_unit: deferred<any>(),
      territory: deferred<any>(),
    };
    const schemaRequests: string[] = [];

    const dataSource: any = {
      getObjectSchema: (objectName: string) => {
        schemaRequests.push(objectName);
        return gates[objectName].promise;
      },
      find: async (object: string, options: any) => {
        findCalls.push({ object, options });
        return [];
      },
    };

    const { rerender } = render(
      <ObjectTree schema={treeSchema('business_unit')} dataSource={dataSource} />,
    );

    // Leg 1 — the first object settles and queries with ITS OWN expand set.
    await act(async () => {
      gates.business_unit.resolve(SCHEMAS.business_unit);
      await gates.business_unit.promise;
    });
    await waitFor(() => expect(findCalls.length).toBe(1));
    expect(findCalls[0].object).toBe('business_unit');
    expect([...findCalls[0].options.$expand].sort()).toEqual(['head', 'parent_id']);

    // Leg 2 — the host swaps the bound object. `territory`'s schema has NOT
    // settled yet, so nothing is entitled to build an `$expand` for it.
    await act(async () => {
      rerender(<ObjectTree schema={treeSchema('territory')} dataSource={dataSource} />);
    });

    // The defect, stated as the query it emits: with an unkeyed boolean latch
    // the gate reads "settled" from `business_unit`'s settle and the previous
    // resolution is still in state, so this fires
    //   find('territory', { $expand: ['parent_id', 'head'] })
    // — `head` is not a field `territory` declares.
    const territoryCalls = findCalls.filter((c) => c.object === 'territory');
    const strayExpands = territoryCalls
      .map((c) => (c.options?.$expand ?? []) as string[])
      .filter((expand) => expand.some((f) => !(f in SCHEMAS.territory.fields)));
    expect(strayExpands).toEqual([]);

    // Stated the second way: no query at all may go out for an object whose
    // schema has not settled. (The two assertions fail together on the bare
    // boolean; keeping both says WHICH property broke if they ever diverge.)
    expect(territoryCalls).toEqual([]);

    // Leg 3 — once the new schema lands, the correct query follows. The gate
    // must close, not deadlock.
    await act(async () => {
      gates.territory.resolve(SCHEMAS.territory);
      await gates.territory.promise;
    });
    await waitFor(() => {
      const calls = findCalls.filter((c) => c.object === 'territory');
      expect(calls.length).toBeGreaterThan(0);
    });
    const settled = findCalls.filter((c) => c.object === 'territory');
    expect([...settled[settled.length - 1].options.$expand].sort()).toEqual([
      'parent_id',
      'region',
    ]);
    // Exactly one query per object — the switch must not re-query the object
    // it left, and must not double-query the one it arrived at.
    expect(findCalls.map((c) => c.object)).toEqual(['business_unit', 'territory']);
    expect(schemaRequests).toEqual(['business_unit', 'territory']);
  });

  it('still queries when the adapter exposes no getObjectSchema (every exit settles)', async () => {
    const findCalls: FindCall[] = [];
    // No `getObjectSchema` at all: the resolution has no source to read from.
    // It must SETTLE with no definition rather than stay pending, or the gated
    // record query waits forever — objectui#6014's `finally`, which this card
    // must not trade away.
    const dataSource: any = {
      find: async (object: string, options: any) => {
        findCalls.push({ object, options });
        return [];
      },
    };

    render(<ObjectTree schema={treeSchema('business_unit')} dataSource={dataSource} />);

    await waitFor(() => expect(findCalls.length).toBe(1));
    expect(findCalls[0].object).toBe('business_unit');
    // No schema means no expand set to derive — the key must be absent, not
    // an empty array.
    expect('$expand' in findCalls[0].options).toBe(false);
  });

  it('still queries when the schema read rejects (every exit settles)', async () => {
    const findCalls: FindCall[] = [];
    const dataSource: any = {
      getObjectSchema: async () => {
        throw new Error('metadata endpoint down');
      },
      find: async (object: string, options: any) => {
        findCalls.push({ object, options });
        return [];
      },
    };

    render(<ObjectTree schema={treeSchema('business_unit')} dataSource={dataSource} />);

    await waitFor(() => expect(findCalls.length).toBe(1));
    expect(findCalls[0].object).toBe('business_unit');
    expect('$expand' in findCalls[0].options).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });
});
