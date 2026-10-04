// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20446] N2 on an analytics host: a stored 「is empty」 rule reaches
 * `AnalyticsService` as `$empty` (the spec's `parseFilterAST` lowers the view
 * operators `is_empty` / `is_not_empty` to it since #20446; it lowered them to
 * `$null` before), and `$empty` is answered by the field's DECLARED type, which
 * the host supplies through `sourceFieldMeta`.
 *
 * - A host constructed directly WITHOUT `sourceFieldMeta` (the shape the
 *   package README showed before #20446) cannot name the type, so it REFUSES
 *   the rule — loudly, `INVALID_FILTER` / 400, prescribing `$null` — and runs
 *   no SQL. It compiled `IS NULL` under the old lowering: this is the
 *   narrowing the changeset declares.
 * - The same host WITH `sourceFieldMeta` (the shape `AnalyticsServicePlugin`
 *   builds, and the README now shows) answers the declared row.
 * - `is_null` is untouched on both.
 */

import { describe, it, expect } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';

import { AnalyticsService } from '../analytics-service.js';

const CUBE: Cube = {
  name: 'orders',
  title: 'Orders',
  sql: 'orders',
  public: true,
  measures: { count: { label: 'Count', type: 'count', sql: '*' } },
  dimensions: {
    status: { label: 'Status', type: 'string', sql: 'status' },
  },
} as unknown as Cube;

const q = (where: unknown): AnalyticsQuery =>
  ({ cube: 'orders', measures: ['count'], dimensions: ['status'], timezone: 'UTC', where }) as AnalyticsQuery;

function host(withFieldMeta: boolean) {
  const executed: string[] = [];
  const service = new AnalyticsService({
    cubes: [CUBE],
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_object: string, sql: string) => {
      executed.push(sql);
      return [];
    },
    ...(withFieldMeta
      ? { sourceFieldMeta: (object: string, field: string) => (object === 'orders' && field === 'status' ? { type: 'text' } : undefined) }
      : {}),
  });
  return { service, executed };
}

type Refusal = { code?: string; status?: number; message: string };
async function refusalOf(run: () => Promise<unknown>): Promise<Refusal | 'answered'> {
  try {
    await run();
    return 'answered';
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    return { code: e.code, status: e.status, message: String(e.message) };
  }
}

describe('[#20446] N2 — a stored 「is empty」 rule on an analytics host', () => {
  it('a host built WITHOUT sourceFieldMeta refuses it with the $null prescription, and runs no SQL', async () => {
    const { service, executed } = host(false);
    for (const op of ['is_empty', 'is_not_empty']) {
      for (const run of [() => service.generateSql(q(['status', op, true])), () => service.query(q(['status', op, true]))]) {
        const got = await refusalOf(run);
        expect(got, op).not.toBe('answered');
        const r = got as Refusal;
        expect({ code: r.code, status: r.status }, op).toEqual({ code: 'INVALID_FILTER', status: 400 });
        expect(r.message, op).toContain('Operator "$empty" is answered by the field\'s DECLARED type');
        expect(r.message, op).toContain('no field metadata is wired');
        expect(r.message, op).toContain('use "$null" for "has no value"');
      }
    }
    expect(executed).toEqual([]);
  });

  it('the same host WITH sourceFieldMeta answers the declared text row', async () => {
    const { service } = host(true);
    const empty = await service.generateSql(q(['status', 'is_empty', true]));
    expect(empty.sql).toMatch(/WHERE \(status IS NULL OR status = \$1\)/);
    expect(empty.params).toContain('');
    const full = await service.generateSql(q(['status', 'is_not_empty', true]));
    expect(full.sql).toMatch(/WHERE \(status IS NOT NULL AND status <> \$1\)/);
  });

  it('is_null is untouched on both hosts', async () => {
    for (const withFieldMeta of [false, true]) {
      const { sql } = await host(withFieldMeta).service.generateSql(q(['status', 'is_null', true]));
      expect(sql, String(withFieldMeta)).toMatch(/WHERE status IS NULL/);
    }
  });
});
