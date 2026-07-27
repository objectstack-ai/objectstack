// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  rebucketCrossObject,
  RESTRICTED_BUCKET,
  type CrossObjectDim,
  type MeasureRecombine,
} from '../strategies/cross-object-rebucket.js';

const fkToRegion = new Map<unknown, unknown>([
  ['acc_w1', 'West'],
  ['acc_w2', 'West'],
  ['acc_e1', 'East'],
]);

describe('rebucketCrossObject (#3654)', () => {
  it('merges FK sub-buckets that resolve to the same attribute (sum)', () => {
    const base = [
      { account: 'acc_w1', revenue: 100 },
      { account: 'acc_w2', revenue: 50 },
      { account: 'acc_e1', revenue: 20 },
    ];
    const dims: CrossObjectDim[] = [{ outputName: 'region', fkField: 'account', fkToAttr: fkToRegion }];
    const measures: MeasureRecombine[] = [{ alias: 'revenue', method: 'sum' }];

    const out = rebucketCrossObject(base, [], dims, measures);
    // West = 100 + 50, East = 20 — the two West accounts collapse into one region.
    expect(out).toEqual([
      { region: 'West', revenue: 150 },
      { region: 'East', revenue: 20 },
    ]);
  });

  it('buckets an unreadable FK under RESTRICTED, preserving the grand total', () => {
    const base = [
      { account: 'acc_w1', revenue: 100 },
      { account: 'acc_hidden', revenue: 999 }, // not in the map ⇒ referenced record hidden
    ];
    const dims: CrossObjectDim[] = [{ outputName: 'region', fkField: 'account', fkToAttr: fkToRegion }];
    const out = rebucketCrossObject(base, [], dims, [{ alias: 'revenue', method: 'sum' }]);

    expect(out).toEqual([
      { region: 'West', revenue: 100 },
      { region: RESTRICTED_BUCKET, revenue: 999 },
    ]);
    // Grand total is conserved (100 + 999) — no row silently dropped.
    expect(out.reduce((s, r) => s + Number(r.revenue), 0)).toBe(1099);
    // The hidden account's attribute value never appears.
    expect(out.map((r) => r.region)).not.toContain('acc_hidden');
  });

  it('recombines count by adding, min/max by extremum', () => {
    const base = [
      { account: 'acc_w1', cnt: 3, lo: 10, hi: 7 },
      { account: 'acc_w2', cnt: 2, lo: 4, hi: 12 },
      { account: 'acc_e1', cnt: 5, lo: 1, hi: 1 },
    ];
    const dims: CrossObjectDim[] = [{ outputName: 'region', fkField: 'account', fkToAttr: fkToRegion }];
    const measures: MeasureRecombine[] = [
      { alias: 'cnt', method: 'count' },
      { alias: 'lo', method: 'min' },
      { alias: 'hi', method: 'max' },
    ];
    const out = rebucketCrossObject(base, [], dims, measures);
    expect(out).toEqual([
      { region: 'West', cnt: 5, lo: 4, hi: 12 }, // 3+2, min(10,4), max(7,12)
      { region: 'East', cnt: 5, lo: 1, hi: 1 },
    ]);
  });

  it('keeps a base dimension alongside the cross-object dimension', () => {
    const base = [
      { stage: 'won', account: 'acc_w1', revenue: 100 },
      { stage: 'won', account: 'acc_w2', revenue: 50 },
      { stage: 'lost', account: 'acc_w1', revenue: 5 },
    ];
    const dims: CrossObjectDim[] = [{ outputName: 'region', fkField: 'account', fkToAttr: fkToRegion }];
    const out = rebucketCrossObject(base, ['stage'], dims, [{ alias: 'revenue', method: 'sum' }]);
    expect(out).toEqual([
      { stage: 'won', region: 'West', revenue: 150 },
      { stage: 'lost', region: 'West', revenue: 5 },
    ]);
  });

  it('handles two cross-object dimensions', () => {
    const fkToTier = new Map<unknown, unknown>([['acc_w1', 'gold'], ['acc_w2', 'silver'], ['acc_e1', 'gold']]);
    const base = [
      { account: 'acc_w1', revenue: 100 },
      { account: 'acc_w2', revenue: 50 },
      { account: 'acc_e1', revenue: 20 },
    ];
    const dims: CrossObjectDim[] = [
      { outputName: 'region', fkField: 'account', fkToAttr: fkToRegion },
      { outputName: 'tier', fkField: 'account', fkToAttr: fkToTier },
    ];
    const out = rebucketCrossObject(base, [], dims, [{ alias: 'revenue', method: 'sum' }]);
    // (West,gold)=100, (West,silver)=50, (East,gold)=20 — no merge (all distinct pairs).
    expect(out).toEqual([
      { region: 'West', tier: 'gold', revenue: 100 },
      { region: 'West', tier: 'silver', revenue: 50 },
      { region: 'East', tier: 'gold', revenue: 20 },
    ]);
  });

  it('a null attribute value is distinct from RESTRICTED', () => {
    const map = new Map<unknown, unknown>([['a1', null]]); // resolvable, but the attribute IS null
    const base = [
      { account: 'a1', revenue: 10 }, // resolves to null region
      { account: 'a2', revenue: 20 }, // unresolvable ⇒ restricted
    ];
    const out = rebucketCrossObject(base, [], [{ outputName: 'region', fkField: 'account', fkToAttr: map }], [
      { alias: 'revenue', method: 'sum' },
    ]);
    expect(out).toEqual([
      { region: null, revenue: 10 },
      { region: RESTRICTED_BUCKET, revenue: 20 },
    ]);
  });
});
