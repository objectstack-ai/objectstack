/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#13010 part 4 — the store's half of the shared read: a claim turns
 * the badge's probe into the card's read, and the rows it holds are a hand-off
 * for this record open, never a cache that outlives a change.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RelatedCountStore } from '../hooks/related-count-store';

const rowsOf = (n: number, tag = 'r') => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}` }));

describe('RelatedCountStore shared read (objectui#13010)', () => {
  beforeEach(() => RelatedCountStore._reset());

  it('with no claim the badge probe is the one-row count it always was', async () => {
    const probe = vi.fn(async () => ({ total: 4, data: rowsOf(1) }));
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account', 'A1')).toBe(4);
    expect(probe).toHaveBeenCalledWith('contact', { $filter: { account: 'A1' }, $top: 1, $count: true });
  });

  it('a claim makes the probe ask for the claimed rows, and the card takes them once', async () => {
    RelatedCountStore.claimRows('contact', 'account', 'A1', 3);
    const probe = vi.fn(async (_o: string, q: any) => ({ total: 4, data: rowsOf(q.$top) }));
    expect(await RelatedCountStore.fetch(probe, 'contact', 'account', 'A1')).toBe(4);
    expect(probe).toHaveBeenCalledWith('contact', { $filter: { account: 'A1' }, $top: 3, $count: true });
    expect(await RelatedCountStore.fetchRows(probe, 'contact', 'account', 'A1', 3)).toEqual({ total: 4, rows: rowsOf(3) });
    expect(probe).toHaveBeenCalledTimes(1);
    // Taken once: a second ask reads again rather than replaying the rows.
    await RelatedCountStore.fetchRows(probe, 'contact', 'account', 'A1', 3);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('a claim never reaches a probe with a declared filter', async () => {
    RelatedCountStore.claimRows('task', 'deal', 'D1', 3);
    const probe = vi.fn(async () => ({ total: 2, data: rowsOf(1) }));
    await RelatedCountStore.fetch(probe, 'task', 'deal', 'D1', [{ field: 'status', operator: 'equals', value: 'open' }]);
    expect((probe.mock.calls[0] as any[])[1].$top).toBe(1);
  });

  it('an invalidation drops the held rows: the card reads the changed list', async () => {
    RelatedCountStore.claimRows('contact', 'account', 'A1', 3);
    let tag = 'old';
    const probe = vi.fn(async (_o: string, q: any) => ({ total: 4, data: rowsOf(q.$top, tag) }));
    await RelatedCountStore.fetch(probe, 'contact', 'account', 'A1');
    tag = 'new';
    RelatedCountStore.invalidate('contact');
    const res = await RelatedCountStore.fetchRows(probe, 'contact', 'account', 'A1', 3);
    expect(res.rows).toEqual(rowsOf(3, 'new'));
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('an invalidation while the probe is out: its rows are not held, and a later ask does not join it', async () => {
    RelatedCountStore.claimRows('contact', 'account', 'A1', 3);
    let release!: () => void;
    let tag = 'old';
    const probe = vi.fn((_o: string, q: any) => {
      const answer = { total: 4, data: rowsOf(q.$top, tag) };
      return probe.mock.calls.length === 1
        ? new Promise((r) => { release = () => r(answer); })
        : Promise.resolve(answer);
    });
    const first = RelatedCountStore.fetch(probe as never, 'contact', 'account', 'A1');
    await Promise.resolve();
    RelatedCountStore.invalidate('contact');
    tag = 'new';
    const card = RelatedCountStore.fetchRows(probe as never, 'contact', 'account', 'A1', 3);
    release();
    await first;
    expect((await card).rows).toEqual(rowsOf(3, 'new'));
    expect(probe).toHaveBeenCalledTimes(2);
    // Nothing from the read that predates the change is left to hand out.
    await RelatedCountStore.fetchRows(probe as never, 'contact', 'account', 'A1', 3);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('a read an invalidation overtook installs no count over the fresh one', async () => {
    let release!: () => void;
    let total = 2;
    const probe = vi.fn((_o: string, _q: any) => {
      const answer = { total, data: rowsOf(1) };
      return probe.mock.calls.length === 1
        ? new Promise((r) => { release = () => r(answer); })
        : Promise.resolve(answer);
    });
    const stale = RelatedCountStore.fetch(probe as never, 'contact', 'account', 'A1');
    await Promise.resolve();
    RelatedCountStore.invalidate('contact');
    total = 5;
    expect(await RelatedCountStore.fetch(probe as never, 'contact', 'account', 'A1')).toBe(5);
    release();
    await stale;
    // The pre-change read (it answered 2) landed last and did not overwrite.
    expect(RelatedCountStore.get('contact', 'account', 'A1')).toBe(5);
  });

  it('a released claim takes its held rows with it', async () => {
    RelatedCountStore.claimRows('contact', 'account', 'A1', 3);
    const probe = vi.fn(async (_o: string, q: any) => ({ total: 4, data: rowsOf(q.$top) }));
    await RelatedCountStore.fetch(probe, 'contact', 'account', 'A1');
    RelatedCountStore.releaseRows('contact', 'account', 'A1');
    await RelatedCountStore.fetchRows(probe, 'contact', 'account', 'A1', 3);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('a failed shared read rejects for the card and reads 0 for the badge', async () => {
    const probe = vi.fn(async () => { throw new Error('boom'); });
    const card = RelatedCountStore.fetchRows(probe, 'contact', 'account', 'A1', 3);
    const badge = RelatedCountStore.fetch(probe, 'contact', 'account', 'A1');
    await expect(card).rejects.toThrow('boom');
    expect(await badge).toBe(0);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(RelatedCountStore.get('contact', 'account', 'A1')).toBeUndefined();
  });
});
