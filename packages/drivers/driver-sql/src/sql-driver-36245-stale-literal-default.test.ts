// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36245] A column's literal DEFAULT follows the field's declaration on a
 * database an earlier release created, not only on a fresh one.
 *
 * # The defect
 *
 * `createColumn` emits a field's literal `defaultValue` as the column DEFAULT,
 * once, when it builds the column. The additive sync never revisits an
 * existing column, and the differ read the declared default only for runtime
 * tokens (#4560). So when a field dropped its `defaultValue: 'none'` between
 * two boots, the table the first boot created kept `DEFAULT 'none'`: an insert
 * that omitted the field stored `'none'` there and NULL on a fresh database,
 * and `detectManagedDrift` answered `[]`. A changed literal behaved the same.
 * Measured at d463c46f on SQLite, PostgreSQL 16 and MariaDB 10.11: the stale
 * DEFAULT stored on an unset insert after the second boot, with
 * `autoMigrate: 'safe'` and without, and no drift entry on any of them.
 *
 * # What is asserted
 *
 * §1 (no server): which physical DEFAULT spellings are literals, and when a
 * literal already says what the declaration says — the two questions the
 * differ asks before it reports anything.
 *
 * §2, one cell per dialect: two boots over one database. The removed default
 * stores NULL on an unset insert after the second boot; a kept default is
 * neither reported nor changed; a changed literal stores the new value; a row
 * stored before is not rewritten; and with no auto-reconcile the two entries
 * are reported `safe` and applied by the explicit apply door.
 *
 * [#36596] §3, one cell per dialect: the same removal on a NOT NULL column.
 * #36245 first shipped a MySQL `DROP DEFAULT`, which on MySQL 8 leaves even a
 * NULLABLE column with no default at all, so §2's unset insert was refused
 * ("Field 'digest' doesn't have a default value", ER 1364) — MariaDB 10.11,
 * where it was measured, stores NULL. §2 now holds on MySQL 8 as it stands. On
 * a NOT NULL column the drop never travels alone, since an omitting insert
 * would then be refused: where the declaration does not hold the column NOT
 * NULL it is paired with the `relax_not_null` (`needs_confirm`, both applied by
 * the explicit apply door, and by the publish when the field says `storage:
 * { notNull: false }` in words), after which an unset insert stores NULL;
 * where it does, the column is left alone and the entry reported `destructive`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from './index.js';
import { physicalDefaultLiteral, physicalLiteralMatches } from './schema-drift.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

describe('#36245 §1 — reading a physical DEFAULT', () => {
  it.each([
    // [raw as columnInfo() reports it, expected]
    ["'none'", { kind: 'literal', text: 'none' }],
    ["'none'::character varying", { kind: 'literal', text: 'none' }],
    ["'it''s'", { kind: 'literal', text: "it's" }],
    ["''::character varying", { kind: 'literal', text: '' }],
    ["'42'::numeric", { kind: 'literal', text: '42' }],
    ['42.000000000000000000000000000000', { kind: 'literal', text: '42.000000000000000000000000000000' }],
    ['(-5)', { kind: 'literal', text: '-5' }],
    ['true', { kind: 'literal', text: 'true' }],
    ["'1'", { kind: 'literal', text: '1' }],
    ["'2024-01-02'::date", { kind: 'literal', text: '2024-01-02' }],
    ["'https://x.y/(z)'", { kind: 'literal', text: 'https://x.y/(z)' }],
    ['none', { kind: 'literal', text: 'none' }],
    [null, { kind: 'none' }],
    [undefined, { kind: 'none' }],
    ['NULL::character varying', { kind: 'none' }],
    ["strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", { kind: 'expression' }],
    ['CURRENT_TIMESTAMP', { kind: 'expression' }],
    ['current_timestamp(3)', { kind: 'expression' }],
    ["nextval('seq'::regclass)", { kind: 'expression' }],
    ["('x' || 'y')", { kind: 'expression' }],
  ])('%j → %j', (raw, expected) => {
    expect(physicalDefaultLiteral(raw)).toEqual(expected);
  });

  it.each([
    // [physical literal text, declared, field type, expected]
    ['none', 'none', 'string', true],
    ['none', 'weekly', 'string', false],
    ['42', 42, 'number', true],
    ['42.000000000000000000000000000000', 42, 'number', true],
    ['7.000000000000000000000000000000', '7', 'number', true],
    ['3.5', 4, 'number', false],
    ['1', true, 'boolean', true],
    ['true', true, 'boolean', true],
    ['0', true, 'boolean', false],
    ['f', false, 'boolean', true],
    // The dialect renders a temporal literal its own way: never judged.
    ['09:30:00.000', '09:30:00', 'time', null],
    ['2024-01-02 03:04:05+00', '2024-01-02T03:04:05.000Z', 'datetime', null],
    ['2024-01-02', '2024-01-02', 'date', true],
  ] as const)('%j vs declared %j (%s) → %j', (text, declared, type, expected) => {
    expect(physicalLiteralMatches(text, declared, type)).toBe(expected);
  });
});

const TABLE = 'os36245_pref';

/** The first release's declaration: three literal defaults. */
const FIRST = {
  name: TABLE,
  fields: {
    title: { type: 'string' },
    digest: { type: 'string', defaultValue: 'none' },
    channel: { type: 'string', defaultValue: 'inbox' },
    batch: { type: 'number', defaultValue: 10 },
  },
} as any;

/** The second: `digest` declares no default, `batch` another literal, `channel` unchanged. */
const SECOND = {
  name: TABLE,
  fields: {
    title: { type: 'string' },
    digest: { type: 'string' },
    channel: { type: 'string', defaultValue: 'inbox' },
    batch: { type: 'number', defaultValue: 25 },
  },
} as any;

const quietLogger = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() });

function measure(cell: DialectCell): void {
  describe(`#36245 §2 — a literal DEFAULT follows the declaration across two boots (${cell.label})`, () => {
    const open: SqlDriver[] = [];
    let dir: string | undefined;

    /** One cell's connection — a FILE for SQLite, so the second boot sees the first one's table. */
    const config = (): Record<string, any> => {
      if (cell.id !== 'sqlite') return cell.config();
      dir ??= mkdtempSync(join(tmpdir(), 'os36245-'));
      return { ...cell.config(), connection: { filename: join(dir, 'db.sqlite') } };
    };

    const boot = async (obj: any, opts: Record<string, any> = {}): Promise<SqlDriver> => {
      const driver = new SqlDriver({ ...config(), ...opts } as any);
      (driver as any).logger = quietLogger();
      open.push(driver);
      await driver.initObjects([obj]);
      return driver;
    };

    const insertUnset = async (driver: SqlDriver, id: string) => {
      await driver.create(TABLE, { id, title: id }, { bypassTenantAudit: true } as any);
      return (driver as any).knex(TABLE).where('id', id).first();
    };

    afterEach(async () => {
      const last = open[open.length - 1];
      if (last) await (last as any).knex.schema.dropTableIfExists(TABLE);
      for (const d of open.splice(0)) await d.disconnect();
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    });

    it('the second boot drops the removed default and restates the changed one; the kept one is untouched', async () => {
      const first = await boot(FIRST);
      await (first as any).knex.schema.dropTableIfExists(TABLE);
      await first.initObjects([FIRST]);
      const before = await insertUnset(first, 'before');
      expect(before.digest).toBe('none');
      await first.disconnect();
      open.splice(open.indexOf(first), 1);

      const second = await boot(SECOND, { autoMigrate: 'safe', schemaMode: 'managed' });
      const after = await insertUnset(second, 'after');

      // The removed default: an unset insert stores NULL, as on a fresh database.
      expect(after.digest).toBeNull();
      // The changed literal: the declared value, not the first release's.
      expect(Number(after.batch)).toBe(25);
      // The kept default: still stored, and never reported.
      expect(after.channel).toBe('inbox');
      expect(await second.detectManagedDrift([SECOND])).toEqual([]);

      // The row stored before the repair keeps what it holds.
      const kept = await (second as any).knex(TABLE).where('id', 'before').first();
      expect(kept.digest).toBe('none');
      expect(Number(kept.batch)).toBe(10);
    });

    it('without auto-reconcile the divergence is reported `safe` and the explicit apply door repairs it', async () => {
      const first = await boot(FIRST);
      await (first as any).knex.schema.dropTableIfExists(TABLE);
      await first.initObjects([FIRST]);
      await first.disconnect();
      open.splice(open.indexOf(first), 1);

      const second = await boot(SECOND);
      expect((await insertUnset(second, 'unrepaired')).digest).toBe('none');

      const drift = await second.detectManagedDrift([SECOND]);
      expect(drift.map((d) => [d.column, d.op.type, d.category, d.kind]).sort()).toEqual([
        ['batch', 'set_column_default', 'safe', 'default_mismatch'],
        ['digest', 'drop_column_default', 'safe', 'default_mismatch'],
      ]);

      const { applied, skipped } = await second.applyMigrationEntries(drift, { allowDestructive: false });
      expect(skipped).toEqual([]);
      expect(applied).toHaveLength(2);

      const repaired = await insertUnset(second, 'repaired');
      expect(repaired.digest).toBeNull();
      expect(Number(repaired.batch)).toBe(25);
      expect(repaired.channel).toBe('inbox');
      expect(await second.detectManagedDrift([SECOND])).toEqual([]);
    });
  });

  describe(`#36596 §3 — a stale literal DEFAULT on a NOT NULL column (${cell.label})`, () => {
    const NN = 'os36596_pref';
    const open: SqlDriver[] = [];
    let dir: string | undefined;

    const config = (): Record<string, any> => {
      if (cell.id !== 'sqlite') return cell.config();
      dir ??= mkdtempSync(join(tmpdir(), 'os36596-'));
      return { ...cell.config(), connection: { filename: join(dir, 'db.sqlite') } };
    };

    const boot = async (obj: any, opts: Record<string, any> = {}): Promise<SqlDriver> => {
      const driver = new SqlDriver({ ...config(), ...opts } as any);
      (driver as any).logger = quietLogger();
      open.push(driver);
      await driver.initObjects([obj]);
      return driver;
    };

    const insertUnset = async (driver: SqlDriver, id: string) => {
      await driver.create(NN, { id, title: id }, { bypassTenantAudit: true } as any);
      return (driver as any).knex(NN).where('id', id).first();
    };

    /** The first release: `code` is NOT NULL, with a literal default. */
    const FIRST_NN = {
      name: NN,
      fields: {
        title: { type: 'string' },
        code: { type: 'string', defaultValue: 'none', storage: { notNull: true } },
      },
    } as any;
    const second = (code: Record<string, any>) => ({ name: NN, fields: { title: { type: 'string' }, code: { type: 'string', ...code } } }) as any;

    /** Create the first release's table, then boot the second declaration over it. */
    const upgrade = async (next: any, opts: Record<string, any> = {}): Promise<SqlDriver> => {
      const first = await boot(FIRST_NN);
      await (first as any).knex.schema.dropTableIfExists(NN);
      await first.initObjects([FIRST_NN]);
      await first.disconnect();
      open.splice(open.indexOf(first), 1);
      return boot(next, opts);
    };

    const nullable = async (driver: SqlDriver): Promise<boolean> =>
      (await (driver as any).knex(NN).columnInfo())?.code?.nullable === true;

    afterEach(async () => {
      const last = open[open.length - 1];
      if (last) await (last as any).knex.schema.dropTableIfExists(NN);
      for (const d of open.splice(0)) await d.disconnect();
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    });

    it('no default, no storage declaration, not required: the drop is paired with the relax and an unset insert then stores NULL', async () => {
      const next = second({});
      const driver = await upgrade(next, { autoMigrate: 'safe', schemaMode: 'managed' });

      const drift = await driver.detectManagedDrift([next]);
      expect(drift.map((d) => [d.column, d.op.type, d.category]).sort()).toEqual([
        ['code', 'drop_column_default', 'needs_confirm'],
        ['code', 'relax_not_null', 'needs_confirm'],
      ]);
      // Dev auto-reconcile applies neither (ADR-0113 D5): the column is left as
      // it was, so an unset insert still stores the old default, never refused.
      expect(await nullable(driver)).toBe(false);
      expect((await insertUnset(driver, 'unrepaired')).code).toBe('none');

      const { applied, skipped } = await driver.applyMigrationEntries(drift, { allowDestructive: false });
      expect(skipped).toEqual([]);
      expect(applied).toHaveLength(2);
      expect(await nullable(driver)).toBe(true);
      expect((await insertUnset(driver, 'repaired')).code).toBeNull();
      expect(await driver.detectManagedDrift([next])).toEqual([]);
      // The row stored before keeps what it holds.
      expect((await (driver as any).knex(NN).where('id', 'unrepaired').first()).code).toBe('none');
    });

    it('`storage: { notNull: false }` declared: the publish applies the relax and the drop together', async () => {
      const next = second({ storage: { notNull: false } });
      const driver = await upgrade(next);
      expect((await insertUnset(driver, 'unrepaired')).code).toBe('none');

      const { applied, skipped } = await driver.applyPublishedColumnChanges(next);
      expect(skipped).toEqual([]);
      expect(applied.map((d) => d.op.type).sort()).toEqual(['drop_column_default', 'relax_not_null']);
      expect((await insertUnset(driver, 'repaired')).code).toBeNull();
      expect(await driver.detectManagedDrift([next])).toEqual([]);
    });

    it('a declaration that still holds the column NOT NULL: the column is left alone and the entry reported `destructive`', async () => {
      const next = second({ storage: { notNull: true } });
      const driver = await upgrade(next, { autoMigrate: 'safe', schemaMode: 'managed' });

      const drift = await driver.detectManagedDrift([next]);
      expect(drift.map((d) => [d.column, d.op.type, d.category])).toEqual([['code', 'drop_column_default', 'destructive']]);
      expect(drift[0].message).toMatch(/Left as it is/);

      // Neither the boot, the publish nor the non-destructive apply door touches it.
      expect((await driver.applyPublishedColumnChanges(next)).applied).toEqual([]);
      const { applied } = await driver.applyMigrationEntries(drift, { allowDestructive: false });
      expect(applied).toEqual([]);
      expect(await nullable(driver)).toBe(false);
      expect((await insertUnset(driver, 'kept')).code).toBe('none');
    });

    it('a `required` field over the NOT NULL column (no storage declaration): left alone and reported `destructive`', async () => {
      const next = second({ required: true });
      const driver = await upgrade(next);

      const drift = await driver.detectManagedDrift([next]);
      // The relax stays silent for a legacy `required` field (ADR-0113); the
      // stale default is reported, never applied by a non-destructive door.
      expect(drift.map((d) => [d.column, d.op.type, d.category])).toEqual([['code', 'drop_column_default', 'destructive']]);
      expect((await driver.applyMigrationEntries(drift, { allowDestructive: false })).applied).toEqual([]);
      expect(await nullable(driver)).toBe(false);
      await driver.create(NN, { id: 'r', title: 'r', code: 'given' }, { bypassTenantAudit: true } as any);
      expect((await (driver as any).knex(NN).where('id', 'r').first()).code).toBe('given');
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'stale literal column DEFAULT (#36245)', measure);
}
