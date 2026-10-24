// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13338 — `readCatalogHolderCount`, the count the deactivation
 * confirm names: one person once, a longer-than-one-read answer as a lower
 * bound, and a refused read or a missing data source as a rejection.
 */
import { describe, it, expect } from 'vitest';
import { readCatalogHolderCount } from './catalog-holders';

const noPositions = { ensureType: async () => [] as unknown[] };

describe('readCatalogHolderCount (objectui#13338)', () => {
  it('counts a position holder once however many rows they hold', async () => {
    const source = {
      find: async () => ({ data: [{ user_id: 'u1' }, { user_id: 'u1' }, { user_id: 'u2' }] }),
    };
    await expect(readCatalogHolderCount(source, noPositions, 'position', 'p')).resolves.toEqual({
      count: 2,
      truncated: false,
      everyone: false,
    });
  });

  it('says an answer the server reports as longer than one read as a lower bound', async () => {
    const source = { find: async () => ({ data: [{ user_id: 'u1' }], hasMore: true }) };
    const out = await readCatalogHolderCount(source, noPositions, 'permission', 's');
    expect(out).toEqual({ count: 1, truncated: true, everyone: false });
    // CONTROL: the same rows with no `hasMore` are the whole answer.
    const whole = { find: async () => ({ data: [{ user_id: 'u1' }] }) };
    expect((await readCatalogHolderCount(whole, noPositions, 'permission', 's')).truncated).toBe(false);
  });

  it('rejects with no data source, and on a refused read', async () => {
    await expect(readCatalogHolderCount(null, noPositions, 'position', 'p')).rejects.toThrow();
    const refused = {
      find: async () => {
        throw new Error('refused');
      },
    };
    await expect(readCatalogHolderCount(refused, noPositions, 'position', 'p')).rejects.toThrow('refused');
  });
});
