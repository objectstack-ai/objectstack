// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Multi-currency M1-2 (epic #8345): a finance team loads a year of exchange
 * rates from one CSV through the GENERIC async import door
 * (`POST /data/sys_exchange_rate/import/jobs`, `sys_import_job`) — no importer
 * of its own. This file pins that the generic door serves the platform's real
 * `sys_exchange_rate` (`@objectstack/platform-objects`, not a mirror), on a
 * real sqlite engine, end to end:
 *
 * - a CSV of `currency, rate, effective_date` lands one row per line, with the
 *   rate's twelve decimals intact and `source` at its declared default;
 * - a `source` column, when the file carries one, is written as given — which
 *   is how an imported row says it was imported;
 * - a line repeating a `(currency, effective_date)` already on file is refused
 *   for that row alone (`UNIQUE_VIOLATION`, the object's organization-scoped
 *   unique key) while the other lines of the same file still land.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { SysExchangeRate } from '@objectstack/platform-objects/system';
import { RestServer } from './rest-server';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot() {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(SysExchangeRate as any);
  engine.registry.registerObject(SysImportJob as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'finance-admin', organizationId: DEFAULT_ORGANIZATION_ID });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const find = (method: string, path: string) => {
    const route = routes.find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`route not registered: ${method} ${path}`);
    return route;
  };
  return {
    engine,
    create: find('POST', '/api/v1/data/:object/import/jobs'),
    progress: find('GET', '/api/v1/data/import/jobs/:jobId'),
    results: find('GET', '/api/v1/data/import/jobs/:jobId/results'),
  };
}

type Booted = Awaited<ReturnType<typeof boot>>;

/** POST the CSV to the async door and wait for the job's terminal state. */
async function importCsv(ctx: Booted, csv: string): Promise<{ job: any; results: any[] }> {
  const res = makeRes();
  await ctx.create.handler({ params: { object: 'sys_exchange_rate' }, body: { format: 'csv', csv } } as any, res);
  expect(res._status).toBe(201);
  const jobId = res._json.jobId;
  for (let i = 0; i < 200; i++) {
    const p = makeRes();
    await ctx.progress.handler({ params: { jobId }, query: {} } as any, p);
    if (['succeeded', 'failed', 'cancelled'].includes(p._json?.status)) {
      const r = makeRes();
      await ctx.results.handler({ params: { jobId }, query: {} } as any, r);
      return { job: p._json, results: r._json.results };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`import job ${jobId} did not finish`);
}

const rates = async (ctx: Booted) =>
  (await ctx.engine.find('sys_exchange_rate', {}))
    .map((r: any) => ({ currency: r.currency, rate: Number(r.rate), effective_date: String(r.effective_date).slice(0, 10), source: r.source }))
    .sort((a: any, b: any) => `${a.currency}${a.effective_date}`.localeCompare(`${b.currency}${b.effective_date}`));

describe('sys_exchange_rate — CSV through the generic async import door (multi-currency M1-2)', () => {
  let ctx: Booted;
  beforeEach(async () => {
    ctx = await boot();
  });

  it('lands one rate per CSV line, twelve decimals intact, source at its default', async () => {
    const { job } = await importCsv(ctx, [
      'currency,rate,effective_date',
      'EUR,0.92,2026-01-01',
      'JPY,149.123456789012,2026-01-01',
      'GBP,0.79,2026-02-01',
    ].join('\n'));

    expect(job).toMatchObject({ status: 'succeeded', total: 3, created: 3, errors: 0 });
    expect(await rates(ctx)).toEqual([
      { currency: 'EUR', rate: 0.92, effective_date: '2026-01-01', source: 'manual' },
      { currency: 'GBP', rate: 0.79, effective_date: '2026-02-01', source: 'manual' },
      { currency: 'JPY', rate: 149.123456789012, effective_date: '2026-01-01', source: 'manual' },
    ]);
  });

  it('writes a source column as given, so a file can mark its rows imported', async () => {
    const { job } = await importCsv(ctx, 'currency,rate,effective_date,source\nCHF,0.88,2026-01-01,import\n');

    expect(job).toMatchObject({ status: 'succeeded', created: 1, errors: 0 });
    expect(await rates(ctx)).toEqual([{ currency: 'CHF', rate: 0.88, effective_date: '2026-01-01', source: 'import' }]);
  });

  it('refuses a line repeating a (currency, effective_date) already on file, and lands the rest of the file', async () => {
    await importCsv(ctx, 'currency,rate,effective_date\nEUR,0.92,2026-01-01\n');

    const { job, results } = await importCsv(ctx, [
      'currency,rate,effective_date',
      'EUR,0.93,2026-01-01', // same currency, same date: refused
      'EUR,0.94,2026-02-01', // same currency, next month: a new rate
    ].join('\n'));

    expect(job).toMatchObject({ status: 'succeeded', total: 2, created: 1, errors: 1 });
    expect(results[0]).toMatchObject({ row: 1, ok: false, code: 'UNIQUE_VIOLATION' });
    expect(results[1]).toMatchObject({ row: 2, ok: true, action: 'created' });
    // The stored January rate is the first file's, untouched by the refused line.
    expect(await rates(ctx)).toEqual([
      { currency: 'EUR', rate: 0.92, effective_date: '2026-01-01', source: 'manual' },
      { currency: 'EUR', rate: 0.94, effective_date: '2026-02-01', source: 'manual' },
    ]);
  });
});
