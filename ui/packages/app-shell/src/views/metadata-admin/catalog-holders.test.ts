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

describe('readCatalogHolderCount: one holder of a name more than one package holds (objectstack#32537)', () => {
  const TWO = ['com.acme.crm', 'com.acme.sales'];
  const positions = {
    ensureType: async () => [
      // Declared by the holder: reaches its own set.
      { name: 'sales_lead', _packageId: 'com.acme.sales', permissionSets: ['sales_rep'] },
      // Declared by the other holder: reaches that package's set, not this one.
      { name: 'crm_lead', _packageId: 'com.acme.crm', permissionSets: ['sales_rep'] },
      // Declared by a package that holds no set of the name: the server judges
      // it by that package's dependencies, so it is counted.
      { name: 'ops_lead', _packageId: 'com.acme.ops', permissionSets: ['sales_rep'] },
      // An environment position naming a name two packages hold grants nothing.
      { name: 'env_lead', permissionSets: ['sales_rep'] },
    ],
  };

  function recordingSource() {
    const calls: Array<{ object: string; params: unknown }> = [];
    return {
      calls,
      find: async (object: string, params?: Record<string, unknown>) => {
        calls.push({ object, params });
        if (object === 'sys_user_permission_set') {
          return {
            data: [
              { user_id: 'u-sales', permission_set: 'sales_rep', permission_set_package: 'com.acme.sales' },
              { user_id: 'u-crm', permission_set: 'sales_rep', permission_set_package: 'com.acme.crm' },
              // No column under two package holders: the resolver refuses it.
              { user_id: 'u-bare', permission_set: 'sales_rep', permission_set_package: null },
            ],
          };
        }
        return { data: [{ user_id: 'u-pos' }] };
      },
    };
  }

  it("counts the holder's grants and the positions that reach it, through the same reads", async () => {
    const source = recordingSource();
    const out = await readCatalogHolderCount(source, positions, 'permission', 'sales_rep', {
      packageId: 'com.acme.sales',
      holders: TWO,
    });
    expect(out).toEqual({ count: 2, truncated: false, everyone: false });
    expect(source.calls).toEqual([
      { object: 'sys_user_permission_set', params: { $filter: { permission_set: 'sales_rep' }, $top: 1000 } },
      { object: 'sys_user_position', params: { $filter: { position: { $in: ['sales_lead', 'ops_lead'] } }, $top: 1000 } },
    ]);
  });

  it('CONTROL: with no holding every grant and position of the name is counted, by the same requests', async () => {
    const source = recordingSource();
    const out = await readCatalogHolderCount(source, positions, 'permission', 'sales_rep');
    expect(out).toEqual({ count: 4, truncated: false, everyone: false });
    expect(source.calls[1]).toEqual({
      object: 'sys_user_position',
      params: { $filter: { position: { $in: ['sales_lead', 'crm_lead', 'ops_lead', 'env_lead'] } }, $top: 1000 },
    });
  });
});

describe("readCatalogHolderCount: the environment's set, beside a package holder of its name (objectstack#32537)", () => {
  const HOLDERS = [null, 'com.acme.crm'];
  // A position served under a package that holds the name may be that
  // package's shipped position, or an overlay or `.custom` override of it,
  // which the server reads as the environment's reference. The served item
  // does not say which, so it counts for both holders.
  const positions = {
    ensureType: async () => [
      { name: 'crm_lead', _packageId: 'com.acme.crm', permissionSets: ['sales_rep'] },
      { name: 'env_lead', permissionSets: ['sales_rep'] },
    ],
  };
  function source() {
    const calls: Array<{ object: string; params: unknown }> = [];
    return {
      calls,
      find: async (object: string, params?: Record<string, unknown>) => {
        calls.push({ object, params });
        if (object === 'sys_user_permission_set') return { data: [] };
        return { data: [{ user_id: 'u-pos' }] };
      },
    };
  }

  it("counts a package's position for the environment's set, so the confirm never says fewer people than lose access", async () => {
    const env = source();
    await readCatalogHolderCount(env, positions, 'permission', 'sales_rep', { packageId: null, holders: HOLDERS });
    expect(env.calls[1]).toEqual({
      object: 'sys_user_position',
      params: { $filter: { position: { $in: ['crm_lead', 'env_lead'] } }, $top: 1000 },
    });
    // The package's own set: its position, never the environment's.
    const crm = source();
    await readCatalogHolderCount(crm, positions, 'permission', 'sales_rep', { packageId: 'com.acme.crm', holders: HOLDERS });
    expect(crm.calls[1]).toEqual({
      object: 'sys_user_position',
      params: { $filter: { position: { $in: ['crm_lead'] } }, $top: 1000 },
    });
  });
});
