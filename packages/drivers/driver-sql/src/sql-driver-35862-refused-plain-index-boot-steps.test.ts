// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #35862 — a PLAIN index MySQL refuses to key no longer throws away the
 * object's remaining boot steps.
 *
 * ## The defect this pins
 *
 * MySQL refuses a TEXT column in a key without a key length
 * (`ER_BLOB_KEY_WITHOUT_LENGTH`), and refuses a key part wider than 3072 bytes
 * (`ER_TOO_LONG_KEY`). The hash-shadow route (#11627) carries a UNIQUE index
 * past that refusal; a PLAIN index has no such route, by decision (a digest
 * serves no lookup). Before this change `syncDeclaredIndexes` logged the
 * refusal and then THREW it. Nothing between it and the objectql per-object
 * loop caught the throw, so on every boot:
 *
 * - every index declared after the refused one was never attempted;
 * - `initObjects` left the object before the old-key index retirement, the
 *   drift reconcile and report, the canonical datetime/time/json/boolean
 *   backfills and the MySQL datetime/time widenings.
 *
 * The shape that reaches it is an UPGRADE: a column created as TEXT before its
 * field declared a `maxLength` stays TEXT (the additive sync never rewrites a
 * column's type), so a release that adds the bound and a plain index over it
 * (the `sys_inbox_message (user_id, created_at)` case) hits the refusal.
 *
 * ## The disposition this pins
 *
 * The refused plain index is still refused: not created, not substituted by a
 * prefix or a shadow, and reported once at `error` on the durability channel
 * with the field-level remedy. The sync goes on.
 *
 * ## The layers
 *
 * - Everywhere (SQLite): the server refusal is FAKED at the one DDL seam,
 *   `knex.schema.alterTable`, with MySQL's own error shape, so the
 *   continuation is proven on every runner, Test Core included.
 * - Live MySQL: the real refusal, on the real upgrade. Runs in the
 *   `Temporal Conformance (live PG + MySQL)` job, whose driver-sql leg runs
 *   this whole package with `OS_TEST_MYSQL_URL` set.
 * - Live PostgreSQL and SQLite: the controls. They never refuse, so the same
 *   upgrade builds the index directly, exactly as before.
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *     pnpm --filter @objectstack/driver-sql exec vitest run sql-driver-35862
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { buildIndexName, isHashShadowColumn } from './schema-drift.js';
import { DIALECT_CELLS, MYSQL_CELL, dialectCell, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  meta?: unknown;
}

/** The logger double: every channel, with the structured meta kept. */
function attachLogSpy(driver: SqlDriver): LogLine[] {
  const logs: LogLine[] = [];
  (driver as any).logger = {
    debug: (msg: string, meta?: unknown) => logs.push({ level: 'debug', msg, meta }),
    info: (msg: string, meta?: unknown) => logs.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: unknown) => logs.push({ level: 'warn', msg, meta }),
    error: (msg: string, meta?: unknown) => logs.push({ level: 'error', msg, meta }),
  };
  return logs;
}

const existingIndexNames = (driver: SqlDriver, table: string): Promise<Set<string>> =>
  (driver as any).getExistingIndexNames(table);

/** MySQL 8.0's own refusal objects, as mysql2 hands them to knex. */
const REFUSALS = {
  ER_BLOB_KEY_WITHOUT_LENGTH: {
    code: 'ER_BLOB_KEY_WITHOUT_LENGTH',
    errno: 1170,
    message: "BLOB/TEXT column 'user_id' used in key specification without a key length",
  },
  ER_TOO_LONG_KEY: {
    code: 'ER_TOO_LONG_KEY',
    errno: 1071,
    message: 'Specified key was too long; max key length is 3072 bytes',
  },
} as const;

/**
 * Make the DDL seam refuse the named indexes with `refusal`, and pass every
 * other statement to the real knex. The refusal is decided by the index the
 * `alterTable` callback declares, read with a recording stand-in for the table
 * builder, so the real builder only ever sees statements that go through.
 */
function refuseIndexes(driver: SqlDriver, refused: ReadonlySet<string>, refusal: { code: string; errno: number; message: string }): void {
  const real = (driver as any).knex;
  const schemaFor = () => {
    const schema = real.schema;
    return new Proxy(schema, {
      get(target, prop) {
        if (prop === 'alterTable') {
          return (table: string, build: (t: unknown) => void) => {
            const named: string[] = [];
            const recorder: any = new Proxy(
              {},
              {
                get: (_t, method) => (...args: any[]) => {
                  if (method === 'index' && typeof args[1] === 'string') named.push(args[1]);
                  if (method === 'unique' && typeof args[1]?.indexName === 'string') named.push(args[1].indexName);
                  return recorder;
                },
              },
            );
            build(recorder);
            if (named.some((n) => refused.has(n))) {
              return Promise.reject(Object.assign(new Error(refusal.message), { code: refusal.code, errno: refusal.errno }));
            }
            return target.alterTable(table, build);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  (driver as any).knex = new Proxy(real, {
    get(target, prop) {
      if (prop === 'schema') return schemaFor();
      return Reflect.get(target, prop, target);
    },
  });
}

/** The steps `initObjects` runs for an existing table after its indexes. */
const LATER_STEPS = [
  'retireIndexesNamedForOldKeys',
  'reconcileAndWarnDrift',
  'backfillCanonicalDatetimes',
  'backfillCanonicalTimes',
  'backfillCanonicalJsonEncoding',
  'backfillCanonicalBooleans',
  'migrateMysqlDatetimeColumns',
  'migrateMysqlTimeColumns',
] as const;

const spyLaterSteps = (driver: SqlDriver) =>
  Object.fromEntries(LATER_STEPS.map((step) => [step, vi.spyOn(driver as any, step)])) as Record<
    (typeof LATER_STEPS)[number],
    ReturnType<typeof vi.spyOn>
  >;

// ── Everywhere: the refusal faked at the DDL seam ───────────────────────────

describe('a refused PLAIN index does not skip the object’s remaining boot steps (#35862)', () => {
  const T = 'os35862_fake';
  const REFUSED = buildIndexName(T, ['user_id', 'created_at'], false);
  const AFTER = buildIndexName(T, ['status'], false);

  /** The release before the bound: `user_id` is created TEXT, no index. */
  const before = () => ({
    name: T,
    fields: { user_id: { type: 'text' }, status: { type: 'text', maxLength: 32 }, seen_at: { type: 'datetime' } },
  });
  /** The release that adds the bound and the plain index over it, then one more index. */
  const after = (unique: boolean) => ({
    name: T,
    fields: {
      user_id: { type: 'text', maxLength: 255 },
      status: { type: 'text', maxLength: 32 },
      seen_at: { type: 'datetime' },
    },
    indexes: [
      { fields: ['user_id', 'created_at'], unique },
      { fields: ['status'], unique: false },
    ],
  });

  let driver: SqlDriver;
  afterEach(async () => {
    vi.restoreAllMocks();
    await driver?.disconnect().catch(() => {});
  });

  it.each(Object.keys(REFUSALS) as Array<keyof typeof REFUSALS>)(
    '%s on a plain index: logged at error, the next index is built, and every later step runs',
    async (code) => {
      driver = new SqlDriver(dialectCell('sqlite').config());
      await driver.initObjects([before()]);

      const logs = attachLogSpy(driver);
      refuseIndexes(driver, new Set([REFUSED]), REFUSALS[code]);
      const steps = spyLaterSteps(driver);

      await expect(driver.initObjects([after(false)])).resolves.toBeUndefined();

      // Reported once, at error, naming the object and the index it refused.
      const lines = logs.filter((l) => l.msg.includes(`'${REFUSED}'`));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.level).toBe('error');
      expect(lines[0]!.msg).toContain(`"${T}"`);

      // Still refused: nothing was built under that name.
      const indexes = await existingIndexNames(driver, T);
      expect(indexes.has(REFUSED)).toBe(false);
      // The loop went on: the index declared after the refused one exists.
      expect(indexes.has(AFTER)).toBe(true);

      // And `initObjects` went on: every later step ran for this table.
      for (const step of LATER_STEPS) {
        expect(steps[step].mock.calls.some((c) => c[0] === T), `${step} ran for ${T}`).toBe(true);
      }
    },
  );

  /**
   * CONTROL: a UNIQUE index refused the same way keeps today's disposition.
   * On SQLite the hash-shadow route is not offered (it is MySQL's), so the
   * refusal is thrown carrying the field-level fix and the server's code.
   */
  it('CONTROL: the same refusal on a UNIQUE index still throws the named refusal', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([before()]);
    attachLogSpy(driver);
    const refusedUnique = buildIndexName(T, ['user_id', 'created_at'], true);
    refuseIndexes(driver, new Set([refusedUnique]), REFUSALS.ER_BLOB_KEY_WITHOUT_LENGTH);

    const rejected: any = await driver.initObjects([after(true)]).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(rejected).toBeInstanceOf(Error);
    expect(rejected.code).toBe('ER_BLOB_KEY_WITHOUT_LENGTH');
    expect(String(rejected.message)).toContain(`cannot create index '${refusedUnique}'`);
  });
});

// ── Live: the real upgrade, on every dialect cell ───────────────────────────

const LIVE_TABLE = 'os35862_inbox';
const LIVE_REFUSED = buildIndexName(LIVE_TABLE, ['user_id', 'created_at'], false);
const LIVE_AFTER = buildIndexName(LIVE_TABLE, ['seen_at'], false);

const liveBefore = () => ({
  name: LIVE_TABLE,
  fields: { user_id: { type: 'text' }, seen_at: { type: 'datetime' } },
});
const liveAfter = () => ({
  name: LIVE_TABLE,
  fields: { user_id: { type: 'text', maxLength: 255 }, seen_at: { type: 'datetime' } },
  indexes: [
    { fields: ['user_id', 'created_at'], unique: false },
    { fields: ['seen_at'], unique: false },
  ],
});

/** CONTROL object: a UNIQUE index over a keyed TEXT column, the #11627 shape. */
const SHADOW_TABLE = 'os35862_shadow';
const SHADOW_INDEX = buildIndexName(SHADOW_TABLE, ['token'], true);
const shadowObject = () => ({
  name: SHADOW_TABLE,
  fields: { token: { type: 'text', maxLength: 1024 } },
  indexes: [{ fields: ['token'], unique: true }],
});

function declareUpgradeSuite(cell: DialectCell): void {
  describe(`the inbox-shaped upgrade — ${cell.label} (#35862)`, () => {
    let driver: SqlDriver;
    afterEach(async () => {
      for (const t of [LIVE_TABLE, SHADOW_TABLE]) {
        await driver?.execute(`drop table if exists ${t}`).catch(() => {});
      }
      await driver?.disconnect().catch(() => {});
    });

    it('boots the release that adds the bound and a plain index over the old TEXT column', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${LIVE_TABLE}`).catch(() => {});
      await driver.initObjects([liveBefore()]);
      if (cell.id === 'mysql') {
        // A table from before #3942: the datetime field on a legacy TIMESTAMP.
        // Its widening is the LAST step `initObjects` runs for the table, so
        // finding it widened proves the steps after the refusal ran.
        await driver.execute(`alter table ${LIVE_TABLE} modify column seen_at timestamp null`);
      }
      const logs = attachLogSpy(driver);

      await driver.initObjects([liveAfter()]);

      const indexes = await existingIndexNames(driver, LIVE_TABLE);
      // The index declared after the plain one is built on every dialect.
      expect(indexes.has(LIVE_AFTER)).toBe(true);

      if (cell.id === 'mysql') {
        // The premise, measured: the column is still TEXT after the upgrade.
        const knex = (driver as any).knex;
        const cols: any[] = await knex
          .select('COLUMN_NAME', 'COLUMN_TYPE')
          .from('information_schema.COLUMNS')
          .where({ TABLE_SCHEMA: knex.client.database(), TABLE_NAME: LIVE_TABLE });
        const typeOf = (c: string) => String(cols.find((r) => r.COLUMN_NAME === c)?.COLUMN_TYPE).toLowerCase();
        expect(typeOf('user_id')).toBe('text');
        // The refused plain index: still refused, and never substituted.
        expect(indexes.has(LIVE_REFUSED)).toBe(false);
        expect(cols.filter((r) => isHashShadowColumn(r.COLUMN_NAME))).toEqual([]);
        const lines = logs.filter((l) => l.msg.includes(`'${LIVE_REFUSED}'`));
        expect(lines).toHaveLength(1);
        expect(lines[0]!.level).toBe('error');
        // The last boot step ran: the legacy TIMESTAMP was widened.
        expect(typeOf('seen_at')).toBe('datetime(3)');
      } else {
        // CONTROL: PostgreSQL and SQLite never refuse; the index is built directly.
        expect(indexes.has(LIVE_REFUSED)).toBe(true);
        expect(logs.filter((l) => l.level === 'error')).toEqual([]);
      }
    }, 60_000);
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'refused plain index boot steps (#35862)', declareUpgradeSuite);
}

// ── Live MySQL CONTROL: a UNIQUE index over keyed TEXT keeps its shadow ─────

declareDialectCell(MYSQL_CELL, 'refused plain index boot steps (#35862)', (cell) => {
  describe('UNIQUE over a keyed TEXT column on live MySQL keeps the hash shadow (#35862 control)', () => {
    let driver: SqlDriver;
    afterEach(async () => {
      await driver?.execute(`drop table if exists ${SHADOW_TABLE}`).catch(() => {});
      await driver?.disconnect().catch(() => {});
    });

    it('carries the UNIQUE index on a shadow column, not refused and not a prefix', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${SHADOW_TABLE}`).catch(() => {});
      await driver.initObjects([shadowObject()]);
      const knex = (driver as any).knex;
      const idx: any[] = await knex
        .select('INDEX_NAME', 'COLUMN_NAME', 'SUB_PART', 'NON_UNIQUE')
        .from('information_schema.STATISTICS')
        .where({ TABLE_SCHEMA: knex.client.database(), TABLE_NAME: SHADOW_TABLE, INDEX_NAME: SHADOW_INDEX });
      expect(idx).toHaveLength(1);
      expect(isHashShadowColumn(String(idx[0].COLUMN_NAME))).toBe(true);
      expect(idx[0].SUB_PART ?? null).toBeNull();
      expect(Number(idx[0].NON_UNIQUE)).toBe(0);
    }, 60_000);
  });
});
