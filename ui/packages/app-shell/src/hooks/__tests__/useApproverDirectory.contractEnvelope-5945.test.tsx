/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useApproverDirectory` reads a `find()` answer as `QueryResult` DECLARES it
 * — and rejects the two spellings it does not (objectui#5945).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one rows member: `data`.
 * Before this pin the module's `asArray` read
 *
 *     Array.isArray(res) ? res : res?.records ?? res?.items ?? res?.data ?? []
 *
 * — trying `records` and `items` FIRST and the contract's `data` only third.
 * Measured on this tree, no producer emits either at this seam
 * (`ObjectStackAdapter.normalizeQueryResult` maps the server's `records`
 * envelope to `data` before returning; `items` has no producer at all), so the
 * two arms bought nothing and cost the contract its authority: a raw SDK client
 * handed in where a `DataSource` belongs would have kept working, unnoticed and
 * unrejected, as a second de-facto contract (AGENTS.md #0.1).
 *
 * The bare-array arm is NOT removed and is pinned here too, because it is live:
 * fakes at this seam answer with a plain array (`AssignedUsersSection.test.tsx`
 * is one). Live and dead is the whole distinction — this file measures both
 * directions so neither can drift.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { AdapterCtx } from '@object-ui/react';

import { useApproverDirectory, resetApproverDirectoryCache } from '../useApproverDirectory';

/**
 * The reference under test — `position` is the kind with BOTH legs. Since
 * `@objectstack/spec` 18 binds `position` to the metadata registry
 * (objectstack#22710, objectui#12030), its LABEL leg reads the registry
 * through the console's metadata store, not `find()`; its STAFFING leg (the
 * `sys_user_position` junction, then `sys_user`) is still `find()` answers, and
 * that is the leg this file measures the envelope on.
 */
const REF = 'position:sales_manager';

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });
const asItems: Envelope = (rows) => ({ items: rows, total: rows.length });

/**
 * A directory that resolves `sales_manager` to a label AND a holder — through
 * whichever envelope the case is measuring. Every leg answers, so a case that
 * reads NOTHING back read nothing because the envelope was refused, not
 * because the directory was empty.
 */
function directory(envelope: Envelope) {
  return {
    find: vi.fn(async (object: string) => {
      if (object === 'sys_user_position') {
        return envelope([{ id: 'up_1', position: 'sales_manager', user_id: 'u_1' }]);
      }
      if (object === 'sys_user') {
        return envelope([{ id: 'u_1', full_name: 'Ada Holder' }]);
      }
      return envelope([]);
    }),
  };
}

async function resolveThrough(envelope: Envelope) {
  const adapter = directory(envelope);
  const { result } = renderHook(() => useApproverDirectory([REF]), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <AdapterCtx.Provider value={adapter as never}>{children}</AdapterCtx.Provider>
    ),
  });
  // Both legs have run and the slate has been written back to the cache.
  await waitFor(() => expect(result.current[REF]).toBeDefined());
  return result.current[REF];
}

beforeEach(() => {
  resetApproverDirectoryCache();
});

afterEach(() => {
  cleanup();
});

describe('useApproverDirectory — the find() envelope it accepts (objectui#5945)', () => {
  it("reads the contract's `data` member", async () => {
    const answer = await resolveThrough(asData);
    expect(answer.holders).toEqual(['Ada Holder']);
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    const answer = await resolveThrough(asBareArray);
    expect(answer.holders).toEqual(['Ada Holder']);
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    const answer = await resolveThrough(asRecords);
    // Nothing resolved: a staffing leg that probed and found no assignment.
    // Before the fix this read `['Ada Holder']`.
    expect(answer.holders).toEqual([]);
  });

  it('does NOT read `items` — not a QueryResult member', async () => {
    const answer = await resolveThrough(asItems);
    expect(answer.holders).toEqual([]);
  });
});
