// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27098] A retired filter operator's `400 INVALID_FILTER` keeps its whole
 * prescription inside the 500 characters a client reads.
 *
 * `POST /api/v1/data/:object/query` with `{ title: { $regex: 'acme' } }` over a
 * real `SqlDriver` answered a message cut at 500 characters (`CLIENT_MESSAGE_MAX`
 * in `@objectstack/types`, which truncates with `…`). The refusal prints the
 * spec's `RETIRED_FILTER_OPERATORS.$regex.why` after its own lead-in, and that
 * string opened with the history of the retirement and put the alternatives
 * last: `$contains` for a case-sensitive match, and "match in application code"
 * for a real regex, sat past the cut. Measured on the base (`origin/main`
 * `1900c02c`): message length 500, ending in `…`, no `$contains`.
 *
 * The fix is the prescription's order, in its one source (the spec table), not
 * the cap: the cap and the truncation are untouched, so the same message is
 * still 500 characters ending in `…` — the history is what is cut now. The
 * `having` face (`@objectstack/objectql`) prints the same string and is pinned
 * through the same door.
 *
 * `SqlDriver` shows a `where` refusal's own words only for a subtree marked as
 * the caller's (`'author'`, #7929/#8220) and withholds every other one. A
 * deployment's `SecurityPlugin` stamps that mark on the caller's verbatim
 * `where` (`security-plugin-authz-middleware.ts`, the #8220 merge); the
 * middleware below stamps it the same way, on the same identity check, so the
 * door answers what the QA run read on a full stack.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_retired_op_27098';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 27098',
  fields: {
    title: { name: 'title', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

const ROWS = [
  { id: 'r1', title: 'Acme', amount: 5 },
  { id: 'r2', title: 'acme corp', amount: 12 },
  { id: 'r3', title: 'Globex', amount: 30 },
];

/** What every client-visible cut message looks like: the cap, then `…`. */
const CAP = 500;

/**
 * name · the `where` · the substrings the client must read. Each one is
 * something the author has to WRITE (or do) instead, never the history.
 */
const RETIRED: ReadonlyArray<readonly [string, FilterCondition, readonly string[]]> = [
  ['$regex', { title: { $regex: 'acme' } }, ['"$regex"', '$icontains', '`$contains` for a case-sensitive one', 'match in application code']],
  ['$options alone', { title: { $options: 'i' } }, ['"$options"', 'Delete `$options`', '$icontains']],
];

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

describe('[#27098] a retired filter operator at the public door names every replacement inside the client cap', () => {
  let engine: ObjectQL;
  let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      const where = opCtx.ast?.where;
      if (where && typeof where === 'object' && where === opCtx.options?.where) {
        markFilterSubtreeProvenance(where, 'author');
      }
      await next();
    });
    engine.registry.registerObject(LEDGER as any);
    await engine.syncSchemas();
    // A real `single` install's Default Organization (ADR-0131 D9).
    await installDefaultOrganization(engine);
    for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
    expect(route).toBeDefined();
    query = async (body) => {
      const res = makeRes();
      // What the wire carries: JSON.
      await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)), query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('where: 400 INVALID_FILTER whose client message carries the whole prescription', async () => {
    for (const [name, where, mustRead] of RETIRED) {
      const res = await query({ where });
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, name).toBe('INVALID_FILTER');
      expect(res.body.error.length, `${name}: the cap still bounds it`).toBeLessThanOrEqual(CAP);
      for (const text of mustRead) expect(res.body.error, `${name} reads ${text}`).toContain(text);
    }
  });

  it('having: the same prescription, through the same door', async () => {
    const res = await query({
      groupBy: ['title'],
      aggregations: [{ function: 'count', alias: 'n' }],
      having: { title: { $regex: 'acme' } },
    } satisfies EngineAggregateOptions as Record<string, unknown>);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('INVALID_FILTER');
    expect(res.body.error.length).toBeLessThanOrEqual(CAP);
    for (const text of ['$icontains', '`$contains` for a case-sensitive one', 'match in application code']) {
      expect(res.body.error, `having reads ${text}`).toContain(text);
    }
  });

  it('CONTROL the cap is untouched: the long refusal is still cut at 500 with `…`, and the envelope keeps its keys', async () => {
    const res = await query({ where: { title: { $regex: 'acme' } } });
    expect(res.body.error).toHaveLength(CAP);
    expect(res.body.error.endsWith('…')).toBe(true);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error', 'object']);
  });

  it('CONTROL a short refusal reaches the client whole, and the replacement serves', async () => {
    const short = await query({ where: { amount: { $gt: 'not-a-number', $sounds_like: 1 } } });
    expect(short.status, JSON.stringify(short.body)).toBe(400);
    expect(short.body.error.length).toBeLessThan(CAP);
    expect(short.body.error.endsWith('…')).toBe(false);
    const served = await query({ where: { title: { $icontains: 'acme' } } });
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    expect(served.body.records.map((r: any) => r.id).sort()).toEqual(['r1', 'r2']);
  });
});
