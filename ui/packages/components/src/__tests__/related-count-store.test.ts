/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RelatedCountStore } from '../hooks/related-count-store';

describe('RelatedCountStore', () => {
  beforeEach(() => {
    RelatedCountStore._reset();
  });

  it('fetches a count via the supplied probe and caches it', async () => {
    const probe = vi.fn(async () => ({ total: 7, data: [{}] }));
    const n = await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1');
    expect(n).toBe(7);
    expect(probe).toHaveBeenCalledWith('contact', { $filter: { account_id: 'A1' }, $top: 1, $count: true });
    expect(RelatedCountStore.get('contact', 'account_id', 'A1')).toBe(7);
  });

  it('deduplicates concurrent probes for the same key', async () => {
    let calls = 0;
    const probe = vi.fn(async () => {
      calls += 1;
      await new Promise(r => setTimeout(r, 5));
      return { total: 3 };
    });
    const [a, b, c] = await Promise.all([
      RelatedCountStore.fetch(probe, 'task', 'opp_id', 'O1'),
      RelatedCountStore.fetch(probe, 'task', 'opp_id', 'O1'),
      RelatedCountStore.fetch(probe, 'task', 'opp_id', 'O1'),
    ]);
    expect([a, b, c]).toEqual([3, 3, 3]);
    expect(calls).toBe(1);
  });

  it('returns the cached value on a subsequent fetch without re-probing', async () => {
    const probe = vi.fn(async () => ({ total: 5 }));
    await RelatedCountStore.fetch(probe, 'note', 'opp_id', 'O1');
    await RelatedCountStore.fetch(probe, 'note', 'opp_id', 'O1');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('invalidates per-object and re-probes on next fetch', async () => {
    const probe = vi.fn().mockResolvedValueOnce({ total: 2 }).mockResolvedValueOnce({ total: 9 });
    await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1');
    expect(RelatedCountStore.get('contact', 'account_id', 'A1')).toBe(2);
    RelatedCountStore.invalidate('contact');
    expect(RelatedCountStore.get('contact', 'account_id', 'A1')).toBeUndefined();
    const n = await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1');
    expect(n).toBe(9);
  });

  it('invalidate with parentId only clears matching parent entries', async () => {
    const probe = vi.fn(async () => ({ total: 1 }));
    await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A1');
    await RelatedCountStore.fetch(probe, 'contact', 'account_id', 'A2');
    RelatedCountStore.invalidate('contact', 'A1');
    expect(RelatedCountStore.get('contact', 'account_id', 'A1')).toBeUndefined();
    expect(RelatedCountStore.get('contact', 'account_id', 'A2')).toBe(1);
  });

  it('falls back to data.length / array length when total is absent', async () => {
    const probeWithData = vi.fn(async () => ({ data: [{}, {}, {}] }));
    expect(await RelatedCountStore.fetch(probeWithData, 'foo', 'p', 'X')).toBe(3);

    const probeRawArray = vi.fn(async () => [{}, {}]);
    expect(await RelatedCountStore.fetch(probeRawArray, 'bar', 'p', 'Y')).toBe(2);
  });

  it('returns 0 and does not cache on probe failure', async () => {
    const probe = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ total: 4 });
    expect(await RelatedCountStore.fetch(probe, 'lead', 'owner_id', 'U1')).toBe(0);
    expect(RelatedCountStore.get('lead', 'owner_id', 'U1')).toBeUndefined();
    expect(await RelatedCountStore.fetch(probe, 'lead', 'owner_id', 'U1')).toBe(4);
  });

  it('skips the filter clause when no relField is supplied', async () => {
    const probe = vi.fn(async () => ({ total: 11 }));
    await RelatedCountStore.fetch(probe, 'global_task', undefined, undefined);
    expect(probe).toHaveBeenCalledWith('global_task', { $filter: {}, $top: 1, $count: true });
  });
});
