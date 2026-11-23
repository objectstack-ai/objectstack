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
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'stale literal column DEFAULT (#36245)', measure);
}
