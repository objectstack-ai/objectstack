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

/**
 * objectstack#36922 — a fetch that joined a read a change overtook does not
 * answer with that read: it settles on a count the store holds. A caller reads
 * "resolved and nothing cached" as a failed read (`useRelatedCounts`), so an
 * overtaken answer marked a related badge failed after a row action, and every
 * later write left it on its old number.
 */
describe('RelatedCountStore.fetch across an overtaking change (objectstack#36922)', () => {
  beforeEach(() => RelatedCountStore._reset());

  function heldProbe() {
    const releases: Array<(total: number) => void> = [];
    const probe = vi.fn(
      () => new Promise<{ total: number }>((resolve) => releases.push((total) => resolve({ total }))),
    );
    return { probe, releases };
  }

  it('an invalidation while the read is out: the fetch reads again and resolves with the installed count', async () => {
    const { probe, releases } = heldProbe();
    const fetched = RelatedCountStore.fetch(probe as never, 'task', 'project', 'P1');
    await Promise.resolve();
    RelatedCountStore.invalidate('task');
    releases[0](9);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    releases[1](8);
    expect(await fetched).toBe(8);
    expect(RelatedCountStore.get('task', 'project', 'P1')).toBe(8);
  });

  it('joins the read a newer caller already sent rather than sending a third', async () => {
    const { probe, releases } = heldProbe();
    const first = RelatedCountStore.fetch(probe as never, 'task', 'project', 'P1');
    await Promise.resolve();
    RelatedCountStore.invalidateAll();
    const second = RelatedCountStore.fetch(probe as never, 'task', 'project', 'P1');
    releases[0](9);
    releases[1](8);
    expect(await first).toBe(8);
    expect(await second).toBe(8);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('a read that fails without being overtaken still answers 0 with nothing cached', async () => {
    const probe = vi.fn(async () => {
      throw new Error('refused');
    });
    expect(await RelatedCountStore.fetch(probe, 'task', 'project', 'P1')).toBe(0);
    expect(RelatedCountStore.get('task', 'project', 'P1')).toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
