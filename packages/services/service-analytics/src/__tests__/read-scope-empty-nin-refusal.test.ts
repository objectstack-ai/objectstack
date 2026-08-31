// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13571] The empty-`$nin` compile refusal, exercised on the path that made it
 * matter — a NON-RLS `getReadScope` provider — plus the over-denial control
 * that bounds the fix.
 *
 * ## Why a non-RLS provider, and not an RLS regression
 *
 * In-repo, the only scope producer is the RLS compiler, and since PR #13570 its
 * polarity-aware guard drops every emptied-membership shape at widening
 * polarity before it is emitted — so an RLS-path regression for `$nin: []`
 * would exercise a route that cannot reach this compiler at all and would test
 * nothing. But `StrategyContext.getReadScope` is a spec contract
 * (`packages/spec/src/contracts/analytics-service.ts` — its doc carries a
 * hand-written example), fillable by ANY provider. The provider below is that
 * contract filled by hand, which is exactly the surface the #13571 card named.
 *
 * ## The two controls
 *
 * 1. **Refusal (the fix).** A provider handing `{ owner: { $nin: [] } }` used
 *    to get a scope clause of constant TRUE (`1 = 1`) — on the read-scope
 *    lowering, the WHOLE TABLE, an ADR-0021 over-reach. It now gets the
 *    module's one refusal envelope: `READ_SCOPE_COMPILE_FAILED` / 500.
 *    MEASURED pre-fix (this file run against the pre-#13571 compiler, see the
 *    PR): the same case admitted every fixture row.
 *
 * 2. **Over-denial (the bound — the reason #13571 is NOT a uniform throw).**
 *    The RLS compiler deliberately emits an emptied POSITIVE membership inside
 *    a composite — `{ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] }`,
 *    pinned by #13570's `rls-empty-membership-polarity.test.ts` as "own rows
 *    keep flowing" — and that filter reaches this compiler through
 *    `security.getReadFilter`. The refusal must NOT catch it: the scope still
 *    compiles and still admits exactly the own row. A uniform throw at both
 *    arms fails this block, which is the availability regression the #13571
 *    verdict rejected.
 *
 * `$in: []` under `$not` from a non-RLS provider (constant TRUE via inversion)
 * is the verdict's DECLARED residue, deliberately not asserted here either way
 * as a contract — `read-scope-not-null-safe.test.ts` pins its current
 * behaviour next to the ruling's reasoning.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';

const FIXTURE = [
  { id: 'r1', owner: 'u_me' },
  { id: 'r2', owner: 'u_other' },
  { id: 'r3', owner: null },
];

const CUBE: Cube = {
  name: 'deals',
  title: 'Deals',
  sql: 'deal',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: Object.fromEntries(
    ['id', 'owner'].map((n) => [n, { name: n, label: n, type: 'string', sql: n }]),
  ),
  public: false,
} as unknown as Cube;

/** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    const dir = dirname(pkgJsonPath);
    return (file: string) => join(dir, 'dist', file);
  } catch {
    return undefined;
  }
}

describe('[#13571] empty `$nin` on the read-scope lowering — non-RLS provider control', () => {
  let db: any;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`CREATE TABLE "deal" ("id" TEXT PRIMARY KEY, "owner" TEXT);`);
    const insert = db.prepare(`INSERT INTO "deal" ("id","owner") VALUES (?,?)`);
    for (const r of FIXTURE) insert.run([r.id, r.owner]);
    insert.free();
  });

  afterAll(() => {
    db?.close();
  });

  /**
   * A `StrategyContext` whose `getReadScope` is filled BY HAND — the spec
   * contract's own authoring mode, and deliberately not the RLS compiler.
   */
  const ctxWithScope = (scope: unknown): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'deals' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      getReadScope: () => scope,
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
        const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        stmt.bind(params as any[]);
        const out: Record<string, unknown>[] = [];
        while (stmt.step()) out.push(stmt.getAsObject());
        stmt.free();
        return out;
      },
    }) as StrategyContext;

  const QUERY: AnalyticsQuery = {
    cube: 'deals',
    measures: ['total'],
    dimensions: ['id'],
    timezone: 'UTC',
  } as AnalyticsQuery;

  /** Run the query under `scope`; return either the refusal or the admitted ids. */
  const outcome = async (
    scope: unknown,
  ): Promise<{ refusal?: Error & { code?: unknown; status?: unknown }; admitted?: string[] }> => {
    try {
      const result = await new NativeSQLStrategy().execute(QUERY, ctxWithScope(scope));
      return { admitted: result.rows.map((r) => String(r.id)).sort((x, y) => x.localeCompare(y)) };
    } catch (e) {
      return { refusal: e as Error & { code?: unknown; status?: unknown } };
    }
  };

  it('a provider handing `{ owner: { $nin: [] } }` is REFUSED in the module envelope — it used to get the whole table', async () => {
    const { refusal, admitted } = await outcome({ owner: { $nin: [] } });
    // Pre-#13571 this assertion's diff read `admitted: ['r1','r2','r3']` — the
    // whole fixture, from a scope clause of constant TRUE.
    expect(admitted).toBeUndefined();
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(refusal?.status).toBe(500);
    expect(String(refusal?.message)).toContain('$nin for "owner" is empty');
  });

  it('OVER-DENIAL CONTROL: the #13570-pinned RLS composite still compiles and still admits exactly the own row', async () => {
    // `{ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] }` is what
    // `RLSCompiler.compileFilter` returns for an emptied membership set beside
    // an own-rows grant ("own rows keep flowing"), and it arrives here through
    // `security.getReadFilter`. The empty-`$nin` refusal must not touch it:
    // this block red under a uniform empty-membership throw is the
    // availability regression the #13571 verdict exists to avoid.
    const { refusal, admitted } = await outcome({ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] });
    expect(refusal).toBeUndefined();
    expect(admitted).toEqual(['r1']);
  });

  it('the composite denies-by-itself shape stays working too: a lone empty `$in` arm inside `$and`', async () => {
    // The other composite #13570's guard deliberately passes through: as an
    // `$and` arm the emptied positive membership is constant FALSE — the whole
    // scope denies. Zero rows, not a refusal and not the whole table.
    const { refusal, admitted } = await outcome({ $and: [{ owner: { $in: [] } }, { owner: 'u_me' }] });
    expect(refusal).toBeUndefined();
    expect(admitted).toEqual([]);
  });
});
