// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21365] The ObjectQL face echoes an offset-only window as a statement the
 * dialect runs: the same window clause the native face executes.
 *
 * ## The shape this closes
 *
 * `ObjectQLStrategy.generateSql` wrote its own window: `LIMIT n` when a limit
 * was set, then `OFFSET n` when an offset was. An offset with no limit
 * therefore echoed a bare `OFFSET`. Measured at `POST /api/v1/analytics/query`
 * and `POST /api/v1/analytics/sql` on `main` `bdd3654f2`, SQLite, a
 * composition narrowed to the engine aggregate, `order { note: 'asc' }`,
 * `offset: 1`:
 *
 * | | rows | echoed `sql` and `/analytics/sql` | that statement on SQLite |
 * |:--|:--|:--|:--|
 * | ObjectQL face | x y z | `… ORDER BY "note" ASC OFFSET 1` | `near "OFFSET": syntax error` |
 * | native face | x y z | `… ORDER BY "note" ASC LIMIT -1 OFFSET 1` (what ran) | x y z |
 *
 * The rows were right; the statement the face printed for them was one SQLite
 * refuses. `generateSql` now ends with `windowClauseSql` (exported from
 * `native-sql-strategy.ts`, not a second spelling table) for the dialect the
 * `sqlDialect` hook names for the base object, so both faces print one window.
 *
 * ## The cells
 *
 *   - **sqlite → EXECUTED** (better-sqlite3), every run.
 *   - **postgres → EXECUTED** where `OS_TEST_POSTGRES_URL` is set, a named skip
 *     otherwise: `OFFSET n` alone, byte-identical to before. CI provisions
 *     that variable for this package in the Temporal Conformance job's step
 *     "Run the non-SQL temporal backends under the skewed process zone"
 *     (`.github/workflows/ci.yml`), so the live cell is red-capable and runs
 *     in CI.
 *   - **unknown (no `sqlDialect` hook) → EXECUTED** on both engines above,
 *     through an `ObjectQLStrategy` whose context names no dialect:
 *     `LIMIT 9223372036854775807 OFFSET n`, the native face's spelling for it.
 *
 * In each cell the echo's window is compared with the statement the native
 * face runs for the same query on the same driver, and the echo is then run
 * itself through the engine's raw-SQL bridge, where it must answer the face's
 * rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import type { StrategyContext } from '../strategies/types.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const DEAL = 'os21365_echo_deal';

const DEAL_OBJECT = {
  name: DEAL,
  label: 'Offset echo deal',
  fields: {
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

// Inserted out of note order, so an answer in note order is the ORDER BY's.
const DEALS = [
  { id: 'd1', note: 'y', amount: 20 },
  { id: 'd2', note: 'w', amount: 7 },
  { id: 'd3', note: 'z', amount: 1 },
  { id: 'd4', note: 'x', amount: 10 },
  { id: 'd5', note: 'x', amount: 5 },
] as const;

const CUBE = 'os21365_echo_cube';
const CUBES = [
  {
    name: CUBE,
    title: 'Offset echo cube',
    sql: DEAL,
    public: true,
    measures: { amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' } },
    dimensions: { note: { type: 'string', sql: 'note', label: 'Note' } },
  },
] as unknown as Cube[];

/** The card's row 4: ordered, an offset, no limit. */
const OFFSET_ONLY = { cube: CUBE, measures: ['amount_sum'], dimensions: ['note'], order: { note: 'asc' }, offset: 1 };
/** Every group after the first, in note order. */
const AFTER_FIRST = [['x', 15], ['y', 20], ['z', 1]];

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
  /** The no-limit spelling the dialect takes in front of `OFFSET`, `''` for none. */
  noLimit: string;
}

const CELLS: readonly Cell[] = [
  {
    id: 'sqlite',
    label: 'sqlite',
    env: null,
    config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    noLimit: ' LIMIT -1',
  },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
    noLimit: '',
  },
];

const FACES = ['native', 'objectql'] as const;
type Face = (typeof FACES)[number];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Row = Record<string, unknown>;

/** Rows as tuples of the named columns, in arrival order; a numeric cell reads as a number on every dialect. */
const tuples = (rows: unknown, columns: readonly string[]) =>
  (rows as Row[]).map((row) => columns.map((c) => (typeof row[c] === 'number' || /^-?\d+(\.\d+)?$/.test(String(row[c])) ? Number(row[c]) : row[c])));

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21365] the ObjectQL face echoes an offset-only window the dialect runs (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Every raw statement the engine ran, in order. */
      const executed: string[] = [];
      const reads = { aggregate: 0 };
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTables = async () => {
        if (cell.id !== 'pg') return;
        await driver?.execute(`drop table if exists ${DEAL}`).catch(() => {});
      };

      /** One `query()` on one face, with the statements and aggregates it caused. */
      const ask = async (face: Face, query: Record<string, unknown>) => {
        const before = { statements: executed.length, aggregate: reads.aggregate };
        const res = await services[face]!.query(query as any);
        return { res, statements: executed.slice(before.statements), aggregate: reads.aggregate - before.aggregate };
      };

      /** Run a statement through the engine's raw-SQL bridge, as the native face does. */
      const run = async (sql: string) => {
        const result = await (engine as any).execute(sql, { object: DEAL });
        return Array.isArray(result) ? result : (result as { rows: Row[] }).rows;
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(DEAL_OBJECT as any);
        await engine.syncSchemas();
        // A real `single` install's Default Organization: the system writes below
        // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
        await installDefaultOrganization(engine);
        for (const row of DEALS) await engine.insert(DEAL, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: unknown) => {
          executed.push(String(sql));
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (...args: unknown[]) => {
          reads.aggregate += 1;
          return (realAggregate as any)(...args);
        };

        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          await new AnalyticsServicePlugin({ cubes: CUBES, debugSql: true, ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
            getService: (name: string) => (name === 'data' ? engine : registered[name]),
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            hook: () => {},
            logger: quiet,
          } as never);
          services[face] = registered.analytics as AnalyticsService;
        }
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it("the card's row — ordered, offset 1, no limit: the echo and /analytics/sql carry the dialect's window, and it runs", async () => {
        const objectql = await ask('objectql', OFFSET_ONLY);
        expect(objectql.statements, 'the ObjectQL face ran no raw statement').toEqual([]);
        expect(objectql.aggregate, 'the ObjectQL face ran the engine aggregate').toBeGreaterThan(0);
        expect(tuples(objectql.res.rows, ['note', 'amount_sum']), 'ObjectQL face').toEqual(AFTER_FIRST);

        const echo = objectql.res.sql!;
        // [#25907] The echo states the NULL placement the face applies, on this dialect.
        expect(echo.endsWith(`ORDER BY "note" ASC NULLS LAST${cell.noLimit} OFFSET 1`), echo).toBe(true);
        // `generateSql` is the body `POST /analytics/sql` answers with.
        const dryRun = await services.objectql!.generateSql!(OFFSET_ONLY as any);
        expect(dryRun.sql).toBe(echo);

        // The window the native face runs for the same query on the same driver.
        // Compared from `ORDER BY` on: on PostgreSQL the native face also casts
        // the summed column, so the two statements differ before it.
        const native = await ask('native', OFFSET_ONLY);
        expect(native.statements, 'the native face ran ONE statement').toHaveLength(1);
        const fromOrderBy = (sql: string) => sql.slice(sql.indexOf(' ORDER BY '));
        expect(fromOrderBy(echo)).toBe(fromOrderBy(native.statements[0]));

        // The echo binds no parameter, so it runs as printed — and answers the face's rows.
        expect(dryRun.params).toEqual([]);
        expect(tuples(await run(echo), ['note', 'amount_sum'])).toEqual(AFTER_FIRST);
      });

      it('a host that wires no sqlDialect hook (the `unknown` arm) echoes the dialect-neutral window, and it runs', async () => {
        const ctx = { getCube: (name: string) => (name === CUBE ? CUBES[0] : undefined) } as unknown as StrategyContext;
        const { sql, params } = await new ObjectQLStrategy().generateSql(OFFSET_ONLY as any, ctx);
        expect(sql.endsWith('ORDER BY "note" ASC LIMIT 9223372036854775807 OFFSET 1'), sql).toBe(true);
        expect(params).toEqual([]);
        expect(tuples(await run(sql), ['note', 'amount_sum'])).toEqual(AFTER_FIRST);
      });

      it('CONTROL: an integer window keeps its bytes — `LIMIT 2 OFFSET 1` — and the echo runs', async () => {
        const query = { ...OFFSET_ONLY, limit: 2 };
        const { res } = await ask('objectql', query);
        expect(res.sql!.endsWith('ORDER BY "note" ASC NULLS LAST LIMIT 2 OFFSET 1'), res.sql).toBe(true);
        expect(tuples(res.rows, ['note', 'amount_sum'])).toEqual([['x', 15], ['y', 20]]);
        expect(tuples(await run(res.sql!), ['note', 'amount_sum'])).toEqual([['x', 15], ['y', 20]]);
      });
    },
  );
}

// ── [#31626] SQL Server ─────────────────────────────────────────────────────

/**
 * [#31626] The echo's window on SQL Server is the one driver-sql's find path
 * runs.
 *
 * A dashboard over a federated SQL Server object runs the engine aggregate —
 * `NativeSQLStrategy.canHandle` declines an object with an `external` binding
 * (ADR-0062 D6) — so `/analytics/sql` is where this package prints a SQL
 * Server statement. Measured on `main` `0105a687` through the plugin's own
 * composition over a `SqlDriver` on knex's `mssql` client: the echo printed
 * `… GROUP BY region LIMIT 10 OFFSET 5`, and `… LIMIT 9223372036854775807
 * OFFSET 5` for an offset alone. SQL Server parses neither.
 *
 * The window's rules now live once, in `@objectstack/core` (`mssqlWindow`),
 * and driver-sql's find path decides with the same function. The expected
 * window here is therefore not restated: it is read off the statement a real
 * `SqlDriver` sends for the same `limit` / `offset` (its knex client is
 * stubbed below the compiler, so it compiles as for a server and sends
 * nothing), with its bound values written in and its case folded. Only the
 * ORDER BY keys differ between the two statements, and they are cut from both.
 *
 * With `OS_TEST_MSSQL_URL` set, the echo is also run on that server and must
 * answer the rows of the window it prints; without it the cell is a named skip.
 */
describe('[#31626] SQL Server: the echo prints the window driver-sql\'s find path runs', () => {
  /** The statement driver-sql's find sends for a window, bound values written in, lower-cased. */
  const driverStatement = async (window: { limit?: number; offset?: number; ordered: boolean }): Promise<string> => {
    const d = new SqlDriver({ client: 'mssql', connection: {}, schemaMode: 'external' } as never);
    d.registerExternalObject({ name: 't', fields: { note: { type: 'text' } }, external: { remoteName: 'Orders' } } as never);
    const client = (d.getKnex() as unknown as { client: Record<string, unknown> }).client;
    const sent: string[] = [];
    client.acquireConnection = async () => ({});
    client.releaseConnection = async () => {};
    client._query = async (_conn: unknown, obj: { sql: string; bindings?: unknown[]; response?: unknown }) => {
      sent.push(obj.sql.replace(/@p(\d+)/g, (_m, i: string) => String((obj.bindings ?? [])[Number(i)])));
      obj.response = [];
      return obj;
    };
    client.processResponse = () => [];
    await d.find(
      't',
      {
        fields: ['note'],
        ...(window.limit !== undefined ? { limit: window.limit } : {}),
        ...(window.offset !== undefined ? { offset: window.offset } : {}),
        ...(window.ordered ? { orderBy: [{ field: 'note', order: 'asc' }] } : {}),
      } as never,
      { bypassTenantAudit: true } as never,
    );
    return sent.at(-1)!.toLowerCase();
  };

  /** The window half of a driver statement: `top (n) ` and the tail after the table, its order key cut. */
  const driverWindow = (sql: string) => ({
    top: /^select (top \(\d+\) )?/.exec(sql)![1] ?? '',
    tail: sql.slice(sql.indexOf(' from [orders]') + ' from [orders]'.length).replace(' order by [note] asc', ''),
  });

  /** The same two halves of an echoed statement, lower-cased, its order key cut. */
  const echoWindow = (sql: string) => {
    const lower = sql.toLowerCase();
    return {
      top: /^select (top \(\d+\) )?/.exec(lower)![1] ?? '',
      tail: lower.slice(lower.indexOf(' group by note') + ' group by note'.length).replace(' order by "note" asc', ''),
    };
  };

  const echo = async (window: { limit?: number; offset?: number; ordered: boolean }, dialect: string) => {
    const ctx = {
      getCube: (name: string) => (name === CUBE ? CUBES[0] : undefined),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      sqlDialect: () => dialect,
    } as unknown as StrategyContext;
    const query = {
      cube: CUBE,
      measures: ['amount_sum'],
      dimensions: ['note'],
      ...(window.ordered ? { order: { note: 'asc' } } : {}),
      ...(window.limit !== undefined ? { limit: window.limit } : {}),
      ...(window.offset !== undefined ? { offset: window.offset } : {}),
    };
    return (await new ObjectQLStrategy().generateSql(query as never, ctx)).sql;
  };

  const WINDOWS: ReadonlyArray<{ limit?: number; offset?: number; ordered: boolean }> = [
    { ordered: false },
    { limit: 10, ordered: false },
    { limit: 0, ordered: false },
    { offset: 5, ordered: false },
    { offset: 0, ordered: false },
    { limit: 10, offset: 5, ordered: false },
    { limit: 10, offset: 0, ordered: false },
    { limit: 0, offset: 5, ordered: false },
    { limit: 10, offset: 5, ordered: true },
    { offset: 5, ordered: true },
    { limit: 10, ordered: true },
  ];

  for (const window of WINDOWS) {
    it(`${JSON.stringify(window)}: the echo's window is the driver's`, async () => {
      const expected = driverWindow(await driverStatement(window));
      expect(echoWindow(await echo(window, 'mssql'))).toEqual(expected);
    });
  }

  it('the measured row: `limit 10, offset 5` with no order prints SQL Server\'s own window, never a LIMIT', async () => {
    const sql = await echo({ limit: 10, offset: 5, ordered: false }, 'mssql');
    expect(sql.endsWith(' GROUP BY note ORDER BY (SELECT NULL) OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY'), sql).toBe(true);
    expect(sql).not.toMatch(/LIMIT/);
  });

  it('CONTROL: sqlite, postgres and mysql echo the window they echoed before, with nothing after SELECT', async () => {
    const before: Record<string, string> = {
      sqlite: ' GROUP BY note ORDER BY "note" ASC NULLS LAST LIMIT -1 OFFSET 5',
      postgres: ' GROUP BY note ORDER BY "note" ASC NULLS LAST OFFSET 5',
      mysql: ' GROUP BY note ORDER BY "note" ASC LIMIT 18446744073709551615 OFFSET 5',
    };
    for (const [dialect, tail] of Object.entries(before)) {
      const offsetOnly = await echo({ offset: 5, ordered: true }, dialect);
      expect(offsetOnly.endsWith(tail), `${dialect}: ${offsetOnly}`).toBe(true);
      expect(offsetOnly.startsWith('SELECT note AS '), dialect).toBe(true);
      expect((await echo({ limit: 10, offset: 5, ordered: false }, dialect)).endsWith(' GROUP BY note LIMIT 10 OFFSET 5'), dialect).toBe(true);
      expect((await echo({ limit: 0, ordered: false }, dialect)).endsWith(' GROUP BY note LIMIT 0'), dialect).toBe(true);
    }
  });

  /** `mssql://user:password@host:port/database?encrypt=…&trustServerCertificate=…` → tedious's connection object. */
  const mssqlConnection = (url: string): Record<string, unknown> => {
    const u = new URL(url);
    const flag = (name: string, fallback: boolean) => (u.searchParams.has(name) ? u.searchParams.get(name) === 'true' : fallback);
    return {
      server: u.hostname,
      port: u.port ? Number(u.port) : 1433,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'master',
      options: { encrypt: flag('encrypt', false), trustServerCertificate: flag('trustServerCertificate', true) },
    };
  };

  const url = process.env.OS_TEST_MSSQL_URL;
  describe.skipIf(!url)(`live SQL Server: the echoed statement runs and answers its window${url ? '' : ' (skipped: set OS_TEST_MSSQL_URL to run this cell)'}`, { timeout: 120_000 }, () => {
    const table = `os_31626_window_${process.pid}`;
    let driver: SqlDriver;
    const liveCube = { ...CUBES[0], name: 'live', sql: table } as unknown as Cube;

    beforeAll(async () => {
      driver = new SqlDriver({ client: 'mssql', connection: mssqlConnection(url!), schemaMode: 'external' } as never);
      const knex = driver.getKnex();
      await knex.raw(`IF OBJECT_ID(N'${table}') IS NOT NULL DROP TABLE [${table}]`);
      await knex.raw(`CREATE TABLE [${table}] ([id] nvarchar(64) NOT NULL PRIMARY KEY, [note] nvarchar(64) NULL, [amount] int NULL)`);
      for (const row of DEALS) await knex(table).insert({ ...row });
    });

    afterAll(async () => {
      await driver?.getKnex().raw(`IF OBJECT_ID(N'${table}') IS NOT NULL DROP TABLE [${table}]`).catch(() => {});
      await driver?.disconnect?.();
    });

    const live = async (window: { limit?: number; offset?: number; ordered: boolean }) => {
      const ctx = {
        getCube: (name: string) => (name === 'live' ? liveCube : undefined),
        queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
        sqlDialect: () => 'mssql',
      } as unknown as StrategyContext;
      const query = {
        cube: 'live',
        measures: ['amount_sum'],
        dimensions: ['note'],
        ...(window.ordered ? { order: { note: 'asc' } } : {}),
        ...(window.limit !== undefined ? { limit: window.limit } : {}),
        ...(window.offset !== undefined ? { offset: window.offset } : {}),
      };
      const { sql, params } = await new ObjectQLStrategy().generateSql(query as never, ctx);
      expect(params).toEqual([]);
      return (await driver.execute(sql)) as Row[];
    };

    it('ordered windows answer the groups the window names', async () => {
      // Groups in note order: w 7, x 15, y 20, z 1.
      expect(tuples(await live({ offset: 1, ordered: true }), ['note', 'amount_sum'])).toEqual(AFTER_FIRST);
      expect(tuples(await live({ limit: 2, offset: 1, ordered: true }), ['note', 'amount_sum'])).toEqual([['x', 15], ['y', 20]]);
      expect(tuples(await live({ limit: 2, ordered: true }), ['note', 'amount_sum'])).toEqual([['w', 7], ['x', 15]]);
    });

    it('an unordered offset runs (ordered by `(SELECT NULL)`), and `limit 0` is no rows', async () => {
      expect(await live({ limit: 2, offset: 1, ordered: false })).toHaveLength(2);
      expect(await live({ offset: 3, ordered: false })).toHaveLength(1);
      expect(await live({ limit: 0, offset: 1, ordered: false })).toEqual([]);
      expect(await live({ limit: 0, ordered: false })).toEqual([]);
    });
  });
});
