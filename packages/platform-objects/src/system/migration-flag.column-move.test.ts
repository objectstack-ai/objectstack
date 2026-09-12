// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15989] The `columns_moved_at` half of the `sys_migration` ledger — the
 * READ that carries it, the WRITE that stamps it, and the write that must NOT
 * disturb it.
 *
 * `sys-migration.column-move.pin.test.ts` (#16185) pinned the column's
 * declaration and said, in its own words, that no read of it was pinned there
 * because "the writer and the reader are the blocked driver card's". This is
 * that card, and these are those.
 */

import { describe, it, expect } from 'vitest';
import { FILE_REFERENCES_MIGRATION_ID, hasMovedFileColumns } from '@objectstack/spec/system';

import {
  readDataMigrationFlag,
  recordDataMigrationRun,
  recordFileColumnMove,
  type MigrationFlagEngine,
} from './migration-flag.js';

const NOW = '2026-09-12T04:00:00.000Z';

/** An engine over one in-memory `sys_migration` table. */
function engineOver(rows: Array<Record<string, unknown>>, opts: { registered?: boolean } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const engine: MigrationFlagEngine = {
    getObject: (name: string) => (opts.registered === false ? undefined : { name }),
    async find(_object, options) {
      const where = (options as { where?: Record<string, unknown> }).where ?? {};
      return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    },
    async insert(_object, data) {
      inserts.push(data);
      rows.push({ ...data });
      return data;
    },
    async update(_object, data) {
      updates.push(data);
      const row = rows.find((r) => r.id === data.id);
      if (row) Object.assign(row, data);
      return data;
    },
  };
  return { engine, rows, updates, inserts };
}

const verifiedRow = (over: Record<string, unknown> = {}) => ({
  id: FILE_REFERENCES_MIGRATION_ID,
  last_run_at: NOW,
  verified_at: NOW,
  applied_at: NOW,
  blocking: 0,
  advisory: 0,
  details: null,
  deviation_observed_at: null,
  deviation_detail: null,
  columns_moved_at: null,
  ...over,
});

describe('#15989 — readDataMigrationFlag carries columns_moved_at', () => {
  it('reads the stamp through, so a caller can tell a MOVED deployment from an unmoved one', async () => {
    const { engine } = engineOver([verifiedRow({ columns_moved_at: NOW })]);
    const flag = await readDataMigrationFlag(engine, FILE_REFERENCES_MIGRATION_ID);
    expect(flag?.columns_moved_at).toBe(NOW);
    expect(hasMovedFileColumns(flag)).toBe(true);
  });

  it('a row written before the column existed reads as NOT moved', async () => {
    // ⛔ The control that matters: this is every row in the world today, and
    // the answer has to be the JSON arm.
    const legacy = verifiedRow();
    delete (legacy as Record<string, unknown>).columns_moved_at;
    const { engine } = engineOver([legacy]);
    const flag = await readDataMigrationFlag(engine, FILE_REFERENCES_MIGRATION_ID);
    expect(flag?.columns_moved_at).toBeNull();
    expect(hasMovedFileColumns(flag)).toBe(false);
  });

  it('an unreadable ledger answers null, which answers "not moved"', async () => {
    const { engine } = engineOver([verifiedRow({ columns_moved_at: NOW })], { registered: false });
    expect(await readDataMigrationFlag(engine, FILE_REFERENCES_MIGRATION_ID)).toBeNull();
    expect(hasMovedFileColumns(null)).toBe(false);
  });
});

describe('#15989 — recordFileColumnMove', () => {
  it('stamps the row and returns what it wrote', async () => {
    const { engine, rows, updates } = engineOver([verifiedRow()]);
    const at = await recordFileColumnMove(engine, FILE_REFERENCES_MIGRATION_ID);
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rows[0]!.columns_moved_at).toBe(at);
    expect(updates).toHaveLength(1);
    // ⛔ It writes the stamp and nothing else. Re-dating `verified_at` or
    // `last_run_at` here would have the column move claim to be a self-check.
    expect(Object.keys(updates[0]!).sort()).toEqual(['columns_moved_at', 'id', 'updated_at']);
    expect(rows[0]!.verified_at).toBe(NOW);
    expect(rows[0]!.last_run_at).toBe(NOW);
  });

  it('⛔ REFUSES when there is no verified row — the gate, not a convenience', async () => {
    // Reaching here without a verified row means a path that skipped the
    // backfill's own gate. Stamping would certify a column move whose values
    // were never shown converted, and the driver would then write bare ids on
    // the strength of it.
    const { engine, updates } = engineOver([verifiedRow({ verified_at: null })]);
    await expect(recordFileColumnMove(engine, FILE_REFERENCES_MIGRATION_ID)).rejects.toThrow(
      /no VERIFIED/i,
    );
    expect(updates, 'a refusal writes nothing').toHaveLength(0);
  });

  it('⛔ REFUSES when the row reports blocking findings', async () => {
    const { engine, updates } = engineOver([verifiedRow({ blocking: 2 })]);
    await expect(recordFileColumnMove(engine, FILE_REFERENCES_MIGRATION_ID)).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });

  it('⛔ REFUSES when there is no row at all', async () => {
    const { engine, updates } = engineOver([]);
    await expect(recordFileColumnMove(engine, FILE_REFERENCES_MIGRATION_ID)).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });
});

describe('#15989 — a backfill re-run must not disturb the stamp', () => {
  it('recordDataMigrationRun leaves columns_moved_at exactly where it was', async () => {
    // The two attest different facts: a re-run of the backfill says nothing
    // about the physical columns, so it must neither set the stamp nor clear
    // it. A moved deployment that re-verifies its values stays moved.
    const { engine, rows, updates } = engineOver([verifiedRow({ columns_moved_at: NOW })]);
    await recordDataMigrationRun(engine, {
      migrationId: FILE_REFERENCES_MIGRATION_ID,
      passed: true,
      blocking: 0,
      applied: true,
    });
    expect(rows[0]!.columns_moved_at).toBe(NOW);
    expect(
      Object.prototype.hasOwnProperty.call(updates[0]!, 'columns_moved_at'),
      'the key must be ABSENT from the update, not merely equal — see the comment at the write',
    ).toBe(false);
  });

  it('…and a FAILING re-run does not clear it either', async () => {
    // A failing self-check closes the verification gate (`verified_at: null`),
    // which is already enough to put the driver back on the JSON arm through
    // `hasMovedFileColumns`. Clearing the stamp as well would lose the record
    // that the columns are physically converted, which is still true.
    const { engine, rows } = engineOver([verifiedRow({ columns_moved_at: NOW })]);
    await recordDataMigrationRun(engine, {
      migrationId: FILE_REFERENCES_MIGRATION_ID,
      passed: false,
      blocking: 4,
      applied: true,
    });
    expect(rows[0]!.verified_at).toBeNull();
    expect(rows[0]!.columns_moved_at).toBe(NOW);
    // …and the composite arbiter answers "not moved" anyway, which is the
    // safe direction and the reason clearing it is unnecessary.
    const flag = await readDataMigrationFlag(engine, FILE_REFERENCES_MIGRATION_ID);
    expect(hasMovedFileColumns(flag)).toBe(false);
  });

  it('a run recorded when the LEDGER READ FAILS still cannot null the stamp', async () => {
    // The failure mode that makes omission the only safe spelling: if
    // `readDataMigrationFlag` answers null because the read failed rather than
    // because the row is absent, a write carrying `columns_moved_at: existing
    // ?? null` would demote a moved deployment back onto the JSON arm.
    const rows = [verifiedRow({ columns_moved_at: NOW })];
    const { engine } = engineOver(rows);
    const failing: MigrationFlagEngine = {
      ...engine,
      async find() {
        throw new Error('ledger unreadable');
      },
    };
    await recordDataMigrationRun(failing, {
      migrationId: FILE_REFERENCES_MIGRATION_ID,
      passed: true,
      blocking: 0,
    });
    expect(rows[0]!.columns_moved_at).toBe(NOW);
  });
});
