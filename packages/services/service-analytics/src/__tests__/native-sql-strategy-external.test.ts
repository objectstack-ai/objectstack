// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0062 D6 — the NativeSQLStrategy must DECLINE federated (external-datasource)
// objects: its hand-compiled `FROM "<object>"` / bare column refs bypass the
// driver's physical-table resolution (remoteName/remoteSchema/columnMap) and
// would query the wrong table. Declining routes the query to the lower-priority
// ObjectQL aggregate path, which goes through the driver's getBuilder (correct).

import { describe, it, expect } from 'vitest';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import type { StrategyContext } from '../strategies/types.js';

const baseCaps = { nativeSql: true, objectqlAggregate: true, inMemory: false };

function ctxFor(cube: any, isExternalObject?: (o: string) => boolean): StrategyContext {
  return {
    getCube: () => cube,
    queryCapabilities: () => baseCaps,
    executeRawSql: async () => [],
    ...(isExternalObject ? { isExternalObject } : {}),
  } as unknown as StrategyContext;
}

const query = { cube: 'c', measures: ['cnt'], dimensions: ['region'] } as any;

describe('NativeSQLStrategy external-object gate (ADR-0062 D6)', () => {
  const strategy = new NativeSQLStrategy();

  it('DECLINES when the base object is external', () => {
    const cube = { name: 'c', sql: 'ext_customer', dimensions: {}, measures: {} };
    const ctx = ctxFor(cube, (o) => o === 'ext_customer');
    expect(strategy.canHandle(query, ctx)).toBe(false);
  });

  it('ACCEPTS a managed object (native-SQL still used)', () => {
    const cube = { name: 'c', sql: 'account', dimensions: {}, measures: {} };
    const ctx = ctxFor(cube, () => false);
    expect(strategy.canHandle(query, ctx)).toBe(true);
  });

  it('DECLINES when a JOINED object is external (the join would hit the wrong table)', () => {
    const cube = { name: 'c', sql: 'orders', joins: { customer: { name: 'ext_customer' } }, dimensions: {}, measures: {} };
    const ctx = ctxFor(cube, (o) => o === 'ext_customer');
    expect(strategy.canHandle(query, ctx)).toBe(false);
  });

  it('is purely additive — with no isExternalObject hook it behaves as before (accept)', () => {
    const cube = { name: 'c', sql: 'ext_customer', dimensions: {}, measures: {} };
    const ctx = ctxFor(cube); // no hook
    expect(strategy.canHandle(query, ctx)).toBe(true);
  });
});
