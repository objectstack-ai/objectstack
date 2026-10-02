// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21345] The real-driver half of the residue the engine-boundary cut (#21274)
 * did not reach. The unit pins, over shapes mirroring these faults, are
 * `packages/objectql/src/driver-fault-redaction-residue.test.ts`.
 *
 *  1. **The raw-statement door.** `ObjectQL.execute` over a real `SqlDriver`,
 *     with a synthetic sentinel bound into a raw statement that opens with a
 *     word the shared leak predicate does not list (a common-table-expression
 *     form, a dialect's upsert or merge verb) and fails with a diagnostic that
 *     matches none of its dialect phrasings. Before the fix the declared
 *     `DATABASE_ERROR` envelope carried the statement, and the sentinel, on its
 *     `cause`'s `message` and `stack`, and the default `inspect` rendering any
 *     logger uses printed them. Each cell also runs the same door with a
 *     statement opening with a listed verb, the control #21274 already cut.
 *  2. **The lifecycle Archiver.** A real cold store refuses the copy of a row
 *     whose value is the sentinel. The sweep's WARN line and its
 *     `report.errors` entry name the object and the database's diagnostic,
 *     and carry no value.
 *
 * ⛔ Asserted here: every carrier of the error the ENGINE propagates, and every
 * line the ENGINE's logger receives. Not asserted here: `driver-sql`'s own
 * server-log line for a refused raw statement, which writes the statement and
 * the dialect message before the driver composes its envelope. That line is a
 * position of its own in `driver-sql`, outside this card's two positions, and
 * it is captured silently below so the run prints nothing.
 *
 * SQLite always runs. The PostgreSQL and MySQL cells of position 1 run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise. Each live cell owns one schema (Postgres) or database (MySQL),
 * named from this file, created before and dropped after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { ObjectQL, LifecycleService, assertEngineDeleteDispatch, type LifecycleObjectLike } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

/** The caller's value. Synthetic; asserted ABSENT from every carrier. */
const S = 'SENTINEL-21345-BOUND-VALUE';

/** The live cells' namespace, derived from this file's name. */
const LIVE_NAMESPACE = `os_lv_${basename(fileURLToPath(import.meta.url)).replace(/\.test\.ts$/, '').replace(/[^a-z0-9]+/gi, '_')}`;

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const MYSQL_URL = process.env.OS_TEST_MYSQL_URL;

function mysqlUrlFor(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A logger that renders every call, so each line can be searched. */
function recordingLogger() {
  const lines: string[] = [];
  const push = () => (...args: unknown[]) =>
    void lines.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 8, showHidden: true }))).join(' '));
  const logger: any = {
    lines,
    trace: push(), fatal: push(), debug: push(), info: push(), warn: push(), error: push(),
    child: () => logger,
  };
  return logger;
}

/** Every path at which the sentinel is reachable through OWN properties (hidden ones included). */
function sentinelCarriers(value: unknown, path = 'error', seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return value.includes(S) ? [path] : [];
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const hits: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    let v: unknown;
    try {
      v = 'value' in descriptor ? descriptor.value : (value as Record<PropertyKey, unknown>)[key];
    } catch {
      continue;
    }
    hits.push(...sentinelCarriers(v, `${path}.${String(key)}`, seen));
  }
  return hits;
}

/** The renderings a logger can produce of an error, by name, that carry the sentinel. */
function renderingsCarrying(error: unknown): string[] {
  let json = '';
  try {
    json = JSON.stringify(error) ?? '';
  } catch {
    json = '';
  }
  const renderings: Record<string, string> = {
    inspect: inspect(error),
    inspectHidden: inspect(error, { depth: 8, showHidden: true }),
    string: String(error),
    json,
  };
  return Object.entries(renderings).filter(([, text]) => text.includes(S)).map(([carrier]) => carrier);
}

interface Statement {
  readonly id: string;
  /** One placeholder, bound to the sentinel. */
  readonly sql: string;
  /** Run before, in the cell's own namespace. */
  readonly setup?: string;
  /** Whether the shared predicate lists the leading verb: the control rows. */
  readonly listed: boolean;
}

interface Cell {
  readonly id: 'sqlite' | 'pg' | 'mysql';
  readonly env: string | null;
  readonly url: string | undefined;
  readonly statements: readonly Statement[];
  readonly provision: () => Promise<Record<string, unknown>>;
  readonly teardown: () => Promise<void>;
}

async function adminRaw(config: Record<string, unknown>, statements: string[]): Promise<void> {
  const admin = new SqlDriver(config as never);
  (admin as unknown as { logger: unknown }).logger = recordingLogger();
  try {
    for (const statement of statements) await admin.execute(statement);
  } finally {
    await admin.disconnect();
  }
}

const CELLS: readonly Cell[] = [
  {
    id: 'sqlite',
    env: null,
    url: 'sqlite',
    statements: [
      { id: 'common-table-expression form', sql: 'with probe(v) as (select ?) select nosuch_fn_21345(v) from probe', listed: false },
      { id: 'dialect upsert verb', sql: 'replace into probe_t (zzz) values (?)', setup: 'create table probe_t (id text)', listed: false },
      { id: 'listed verb (control)', sql: 'select nosuch_fn_21345(?)', listed: true },
    ],
    provision: async () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    teardown: async () => {},
  },
  {
    id: 'pg',
    env: 'OS_TEST_POSTGRES_URL',
    url: PG_URL,
    statements: [
      { id: 'common-table-expression form', sql: 'with probe(v) as (select ?::int) select v from probe', listed: false },
      {
        id: 'dialect merge verb',
        sql: 'merge into probe_t t using (select ?::int as v) s on false when not matched then insert (id) values (s.v)',
        setup: 'create table probe_t (id int)',
        listed: false,
      },
      { id: 'listed verb (control)', sql: 'select ?::int', listed: true },
    ],
    provision: async () => {
      await adminRaw({ client: 'pg', connection: PG_URL }, [
        `drop schema if exists ${LIVE_NAMESPACE} cascade`,
        `create schema ${LIVE_NAMESPACE}`,
      ]);
      return { client: 'pg', connection: PG_URL, searchPath: [LIVE_NAMESPACE] };
    },
    teardown: async () => {
      await adminRaw({ client: 'pg', connection: PG_URL }, [`drop schema if exists ${LIVE_NAMESPACE} cascade`]);
    },
  },
  {
    id: 'mysql',
    env: 'OS_TEST_MYSQL_URL',
    url: MYSQL_URL,
    statements: [
      { id: 'common-table-expression form', sql: 'with probe(v) as (select ?) select nosuch_fn_21345(v) from probe', listed: false },
      { id: 'dialect upsert verb', sql: 'replace into probe_t (id) values (?)', setup: 'create table probe_t (id int)', listed: false },
      { id: 'listed verb (control)', sql: 'select nosuch_fn_21345(?)', listed: true },
    ],
    provision: async () => {
      await adminRaw({ client: 'mysql2', connection: MYSQL_URL }, [
        `drop database if exists ${LIVE_NAMESPACE}`,
        `create database ${LIVE_NAMESPACE}`,
      ]);
      return { client: 'mysql2', connection: mysqlUrlFor(MYSQL_URL!, LIVE_NAMESPACE) };
    },
    teardown: async () => {
      await adminRaw({ client: 'mysql2', connection: MYSQL_URL }, [`drop database if exists ${LIVE_NAMESPACE}`]);
    },
  },
];

for (const cell of CELLS) {
  describe.skipIf(!cell.url)(
    `[#21345] a raw statement's fault leaves the engine with no bound value on any carrier — ${cell.id}${cell.url ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: SqlDriver;
      let engine: ObjectQL;
      let engineLog: ReturnType<typeof recordingLogger>;

      beforeAll(async () => {
        driver = new SqlDriver((await cell.provision()) as never);
        (driver as unknown as { logger: unknown }).logger = recordingLogger();
        engineLog = recordingLogger();
        engine = new ObjectQL({ logger: engineLog } as never);
        engine.registerDriver(driver, true);
        await engine.init();
        for (const statement of cell.statements) {
          if (statement.setup) await driver.execute(statement.setup);
        }
      });

      afterAll(async () => {
        await driver?.disconnect();
        await cell.teardown();
      });

      for (const statement of cell.statements) {
        it(`${statement.id}: no carrier holds the value, and the class and codes survive`, async () => {
          const linesBefore = engineLog.lines.length;
          let error: unknown;
          try {
            await engine.execute(statement.sql, { args: [S] });
          } catch (e) {
            error = e;
          }
          expect(error, 'the database refused the statement').toBeDefined();
          expect(sentinelCarriers(error)).toEqual([]);
          expect(renderingsCarrying(error)).toEqual([]);
          expect(engineLog.lines.slice(linesBefore).filter((l: string) => l.includes(S))).toEqual([]);

          const out = error as Error & { code?: unknown; status?: unknown; cause?: Error & { code?: unknown } };
          expect(out.code).toBe('DATABASE_ERROR');
          expect(out.status).toBe(500);
          expect(Object.getOwnPropertyDescriptor(out, 'cause')?.enumerable).toBe(false);
          expect(typeof out.cause?.code).toBe('string');
          const causeMessage = out.cause?.message ?? '';
          expect(causeMessage.includes('[statement and bound values redacted] - ')).toBe(true);
          if (!statement.listed) expect(causeMessage.startsWith('[statement and bound values redacted] - ')).toBe(true);
        });
      }
    },
  );
}

// ── Position 2: the Archiver on real stores ────────────────────────────────

const ARCHIVED: LifecycleObjectLike = {
  name: 'probe_archive_21345',
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    payload: { name: 'payload', type: 'text' },
  },
  tenancy: { enabled: false },
  lifecycle: {
    class: 'audit',
    retention: { maxAge: '90d' },
    archive: { after: '90d', to: 'archive' },
  } as never,
};

describe('[#21345] a cold store refusing the Archiver\'s copy reaches neither the sweep log nor its report with the row\'s value — sqlite', () => {
  let hot: SqlDriver;
  let cold: SqlDriver;

  beforeAll(async () => {
    const config = { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true };
    hot = new SqlDriver(config as never);
    cold = new SqlDriver(config as never);
    for (const d of [hot, cold]) (d as unknown as { logger: unknown }).logger = recordingLogger();
    for (const d of [hot, cold]) await d.syncSchema(ARCHIVED.name, ARCHIVED);
    await hot.create(ARCHIVED.name, { id: 'r1', payload: S });
    // The cold store refuses every row: a trigger aborts the insert half of the upsert.
    await cold.execute(
      `create trigger probe_archive_21345_refuse before insert on ${ARCHIVED.name} ` +
        "begin select raise(abort, 'archive store refused the row'); end",
    );
  });

  afterAll(async () => {
    await hot?.disconnect();
    await cold?.disconnect();
  });

  it('the sweep reports and logs the diagnostic, never the value, and deletes nothing hot', async () => {
    const warnings: string[] = [];
    const engine = {
      registry: { getAllObjects: () => [ARCHIVED] },
      async delete(_object: string, options?: Record<string, unknown>) {
        assertEngineDeleteDispatch(options);
        return { deletedCount: 0 };
      },
      getDriverForObject: () => hot,
      datasource: (name: string) => {
        if (name !== 'archive') throw new Error(`[ObjectQL] Datasource '${name}' not found`);
        return cold;
      },
    };
    const service = new LifecycleService({
      getEngine: () => engine as never,
      logger: { info: () => {}, debug: () => {}, warn: (msg: string) => void warnings.push(String(msg)) },
      // Far enough ahead that the row is past every window.
      now: () => Date.now() + 10 * 365 * 86_400_000,
      initialDelayMs: 1,
      sweepIntervalMs: 10,
    });

    const report = await service.sweep();

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].object).toBe(ARCHIVED.name);
    expect(report.errors[0].error.includes(S)).toBe(false);
    expect(report.errors[0].error).toContain('archive store refused the row');
    expect(report.errors[0].error).toContain('[statement and bound values redacted]');
    const line = warnings.filter((w) => w.includes(`sweep of ${ARCHIVED.name} failed`));
    expect(line).toHaveLength(1);
    expect(warnings.filter((w) => w.includes(S))).toEqual([]);
    expect(line[0]).toContain('archive store refused the row');

    // The Archiver's safety rule: the row the cold store did not take stays hot.
    expect((await hot.find(ARCHIVED.name, {} as never)).map((r) => r.id)).toEqual(['r1']);
  });
});
