// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22790 — under a search, a paged list's `total` is the number of matching
 * records, counted, never a page-local estimate.
 *
 * Before: `findData` skipped the COUNT whenever a `search` rode the query
 * (`engine.count()` took `where` only) and reported `offset + page + 1`, so
 * `?$top=25&$search=Line` over 75 matches answered `total: 26`, and the last
 * page claimed `hasMore: true`. Now `engine.count()` takes the query's
 * `search` / `searchFields` and expands them through the one ADR-0061 expander
 * `find` runs, so `total` is the count of exactly the rows `find` would page.
 *
 * Real chain: `RestServer` route handler → `findData` → `ObjectQL` → sqlite
 * `SqlDriver`. A middleware stands in for a member's read scope, so the count
 * is shown to compose with an injected read filter exactly as the rows do.
 *
 * Fixture (90 rows): `title` holds "Line" on rows 0–59, `notes` on 60–74, and
 * the `internal: true` column `hint` on 75–89 — so the default search matches
 * 75, `searchFields: ['title']` 60, and a count that scanned `hint` would say
 * 90. The member owns every third row (25 of the 75 matches, 30 of the 90).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'ticket';
const MEMBER = 'member_user';
const ROWS = Array.from({ length: 90 }, (_, i) => ({
  id: `t${String(i).padStart(2, '0')}`,
  title: i < 60 ? `Line ${i}` : `Row ${i}`,
  notes: i >= 60 && i < 75 ? 'see Line' : 'n/a',
  hint: i >= 75 ? 'Line secret' : 'x',
  owner: i % 3 === 0 ? MEMBER : 'admin_user',
}));

type Body = { records?: unknown[]; total?: number; hasMore?: boolean; code?: string };
type Route = { method: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> };

let engine: ObjectQL;
let listRoute: Route;
let queryRoute: Route;
let principal = 'admin_user';
/** The `where` each driver face last received for {@link OBJECT}. */
const driverWhere: { find?: unknown; count?: unknown } = {};

beforeAll(async () => {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  for (const face of ['find', 'count'] as const) {
    const native = (driver as any)[face].bind(driver);
    (driver as any)[face] = (object: string, ast: any, options?: unknown) => {
      if (object === OBJECT) driverWhere[face] = ast?.where;
      return native(object, ast, options);
    };
  }
  engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registry.registerObject({
    name: OBJECT, label: 'Ticket', systemFields: false, nameField: 'title',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      title: { name: 'title', type: 'text' },
      notes: { name: 'notes', type: 'text' },
      hint: { name: 'hint', type: 'text', internal: true },
      owner: { name: 'owner', type: 'text' },
    },
  } as never);
  await engine.syncSchemas();
  await engine.insert(OBJECT, ROWS);
  // The member's read scope, injected the way the security middlewares do it.
  engine.registerMiddleware(async (ctx, next) => {
    if (ctx.ast && ctx.object === OBJECT && (ctx.context as any)?.userId === MEMBER) {
      ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, { owner: MEMBER }] } : { owner: MEMBER };
    }
    await next();
  });

  const rest = new RestServer(
    { get() {}, post() {}, put() {}, delete() {}, patch() {}, use() {}, listen: async () => {}, close: async () => {} } as never,
    new ObjectStackProtocolImplementation(engine as never) as never,
    { api: { requireAuth: false } } as never,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: principal });
  rest.registerRoutes();
  const routes = rest.getRoutes() as Route[];
  listRoute = routes.find((r) => r.method === 'GET' && r.path === '/api/v1/data/:object')!;
  queryRoute = routes.find((r) => r.method === 'POST' && r.path === '/api/v1/data/:object/query')!;
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* best-effort */ }
});

async function call(route: Route, req: Record<string, unknown>, as = 'admin_user'): Promise<Body> {
  principal = as;
  let status: number | undefined;
  let body: Body = {};
  const res: any = { write: () => true, end() {}, header: () => res };
  res.status = (code: number) => { status = code; return res; };
  res.json = (b: Body) => { body = b; return res; };
  await route.handler({ params: { object: OBJECT }, headers: {}, ...req }, res);
  expect(status, `door refused: ${JSON.stringify(body)}`).toBeUndefined();
  return body;
}
const list = (query: Record<string, string>, as?: string) => call(listRoute, { method: 'GET', query }, as);
const post = (body: Record<string, unknown>, as?: string) => call(queryRoute, { method: 'POST', body }, as);

describe('[#22790] a paged search reports the counted total', () => {
  // 75, not 90: neither the rows nor the count scan the `internal: true` column.
  it('GET ?$top&$search: total is the match count on every page, and hasMore agrees', async () => {
    const unpaged = await list({ $search: 'Line' });
    expect(unpaged.records).toHaveLength(75);

    const first = await list({ $top: '25', $search: 'Line' });
    expect(first).toMatchObject({ total: 75, hasMore: true });
    expect(first.records).toHaveLength(25);

    const last = await list({ $top: '25', $skip: '50', $search: 'Line' });
    expect(last).toMatchObject({ total: 75, hasMore: false });
    expect(last.records).toHaveLength(25);
  });

  it('POST …/query: the same, and a `searchFields` narrowing narrows the count with the rows', async () => {
    expect(await post({ search: 'Line', limit: 25 })).toMatchObject({ total: 75, hasMore: true });

    const narrowed = await post({ search: 'Line', searchFields: ['title'], limit: 25 });
    expect(narrowed).toMatchObject({ total: 60, hasMore: true });
    expect((await post({ search: 'Line', searchFields: ['title'] })).records).toHaveLength(60);
  });

  it('one expander: the driver COUNT receives the same `where` the driver FIND does', async () => {
    await list({ $top: '25', $search: 'Line notes' });
    expect(driverWhere.count).toBeDefined();
    expect(driverWhere.count).toEqual(driverWhere.find);
  });

  it('a member counts only the matches it can read', async () => {
    expect(await list({ $top: '10', $search: 'Line' }, MEMBER)).toMatchObject({ total: 25, hasMore: true });
    expect((await list({ $search: 'Line' }, MEMBER)).records).toHaveLength(25);
  });

  it('CONTROL — a paged list with no search is unchanged, for both principals', async () => {
    expect(await list({ $top: '25' })).toMatchObject({ total: 90, hasMore: true });
    expect(await list({ $top: '10' }, MEMBER)).toMatchObject({ total: 30, hasMore: true });
  });

  it('CONTROL — `$count=false` with a search still omits total', async () => {
    const body = await list({ $top: '25', $search: 'Line', $count: 'false' });
    expect('total' in body).toBe(false);
    expect(body.hasMore).toBe(true);
  });
});
