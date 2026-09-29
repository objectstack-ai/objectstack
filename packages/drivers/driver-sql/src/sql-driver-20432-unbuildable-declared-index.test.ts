// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20432] A declared index that can never be built is loud: logged at
 * `error` on the durability channel, and reported in drift.
 *
 * ## The defect this pins
 *
 * An object declaring `indexes: [{ fields: ['statsu'], unique: true }]` on a
 * table whose only column is `status` synced with the whole index skipped and
 * one `warn` line. `expectedIndexes` then dropped the index from the expected
 * set, so `detectManagedDrift` (what `os migrate plan` renders) answered `[]`.
 * Measured on SQLite before the fix, the log read
 * `[sql-driver] skipping declared index on "…" — column(s) not materialized: statsu`
 * at `warn`, and the drift report was empty. The declared uniqueness was
 * unenforced, and every instrument an operator would reach for said nothing
 * was wrong. That is the AGENTS.md durability-degradation shape: "does the
 * system still look normal from the outside while something it claims has
 * not landed? Yes → error". The duplicate-row arms of the same loop already
 * answered their version of it at `error`, through `logDurabilityFailure`.
 *
 * Step 1 closed the build doors: the lint rule refuses a misspelt index
 * column at `os validate` / `os build`. The Studio save door
 * (`ObjectSchema.safeParse`) still admits one, and a virtual `formula` field
 * is a real field that passes the lint existence check yet has no column. So
 * the driver's own answer still matters.
 *
 * ## The seam
 *
 * `logDurabilityFailure` writes to the driver's `logger.error`, the same
 * channel its duplicate-row siblings are pinned through
 * (`sql-driver-14902-plain-unique-duplicate-preflight.test.ts`). Every
 * assertion reads the logger double: the level, the structured meta
 * (`index`, `missing`, `unique`), and the named subjects in the line. The
 * prose is not pinned beyond what names the subject, and the one word that
 * says which kind of index was skipped.
 *
 * ## The matrix
 *
 * The skip is a pure column-presence check, and the report-only op never
 * reaches a dialect's DDL. The fixture still runs on every cell, because what
 * `initObjects` materializes (and so what is physically absent) is a
 * per-dialect fact, and so is the index introspection the drift report reads.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import {
  buildIndexName,
  describeMissingIndexColumns,
  diffUnbuildableIndexes,
  expectedIndexes,
  type ManagedDriftEntry,
} from './schema-drift.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'unbuildable declared index';

interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  meta?: any;
}

/** The logger double: every channel, with the structured meta kept. */
function attachLogSpy(driver: SqlDriver): LogLine[] {
  const logs: LogLine[] = [];
  (driver as any).logger = {
    debug: (msg: string, meta?: any) => logs.push({ level: 'debug', msg, meta }),
    info: (msg: string, meta?: any) => logs.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: any) => logs.push({ level: 'warn', msg, meta }),
    error: (msg: string, meta?: any) => logs.push({ level: 'error', msg, meta }),
  };
  return logs;
}

const existingIndexNames = (driver: SqlDriver, table: string): Promise<Set<string>> =>
  (driver as any).getExistingIndexNames(table);

function declareUnbuildableIndexSuite(cell: DialectCell): void {
  describe(`a declared index that can never be built is loud — ${cell.label} (#20432)`, () => {
    let driver: SqlDriver;
    let logs: LogLine[];
    const created: string[] = [];

    beforeEach(() => {
      driver = new SqlDriver(cell.config());
      logs = attachLogSpy(driver);
    });

    afterEach(async () => {
      for (const t of created.splice(0)) {
        await driver.execute(`drop table if exists ${t}`).catch(() => {});
      }
      await driver.disconnect().catch(() => {});
    });

    /** Fresh table per test, dropped first in case a previous run left it. */
    const syncFresh = async (obj: { name: string; [k: string]: any }) => {
      await driver.execute(`drop table if exists ${obj.name}`).catch(() => {});
      created.push(obj.name);
      await driver.initObjects([obj as any]);
    };

    describe('a misspelt column in a UNIQUE index', () => {
      const T = 'os20432_misspelt';
      const INDEX = buildIndexName(T, ['statsu'], true);
      const obj = {
        name: T,
        tenancy: { enabled: false },
        fields: { status: { type: 'text', maxLength: 64 } },
        indexes: [{ fields: ['statsu'], unique: true as const }],
      };

      it('logs the skip once, at error, naming the object, the index, the column and UNIQUE', async () => {
        await syncFresh(obj);

        const lines = logs.filter((l) => l.meta?.index === INDEX);
        expect(lines).toHaveLength(1);
        expect(lines[0]!.level).toBe('error');
        expect(lines[0]!.meta).toMatchObject({ tableName: T, index: INDEX, missing: ['statsu'], unique: true });
        expect(lines[0]!.msg).toContain(`"${T}"`);
        expect(lines[0]!.msg).toContain(`'${INDEX}'`);
        expect(lines[0]!.msg).toContain(`'statsu' (not a field of the object)`);
        expect(lines[0]!.msg).toContain('UNIQUE');

        // The level MOVED; it did not gain a second line. Before the fix the
        // only trace of this skip was a warn naming the column.
        expect(logs.filter((l) => l.level === 'warn' && l.msg.includes('statsu'))).toEqual([]);
        // And the consequence the line reports is real: nothing was built.
        expect((await existingIndexNames(driver, T)).has(INDEX)).toBe(false);
      });

      it('is reported in drift as a report-only unbuildable_index entry, and apply skips it', async () => {
        await syncFresh(obj);

        const drift = await driver.detectManagedDrift([obj]);
        const unbuildable = drift.filter((d) => d.op.type === 'unbuildable_index');
        expect(unbuildable).toHaveLength(1);
        expect(unbuildable[0]).toMatchObject({
          kind: 'index_mismatch',
          table: T,
          column: 'statsu',
          actual: '(absent)',
          severity: 'error',
          category: 'needs_confirm',
          op: { type: 'unbuildable_index', table: T, indexName: INDEX, unique: true, missingColumns: ['statsu'] },
        });
        // No second finding claims a remedy for the same index: a
        // `create_index` here would name a DDL that can never run.
        expect(drift.filter((d) => d !== unbuildable[0] && (d.op as any).indexName === INDEX)).toEqual([]);

        // The apply path: the flags `os migrate apply` and the artifact boot
        // gate pass. Skipped, never applied, on every dialect…
        const { applied, skipped } = await driver.applyMigrationEntries(unbuildable, { allowDestructive: false });
        expect(applied).toEqual([]);
        expect(skipped).toEqual(unbuildable);
        // …and nothing changed, so the next plan reports it again. Only a
        // metadata edit clears it.
        expect((await existingIndexNames(driver, T)).has(INDEX)).toBe(false);
        const again = await driver.detectManagedDrift([obj]);
        expect(again.filter((d) => d.op.type === 'unbuildable_index').map((d) => (d.op as any).indexName)).toEqual([
          INDEX,
        ]);
      });
    });

    describe('a virtual formula field in a plain index (the step-1 boundary)', () => {
      const T = 'os20432_formula';
      const INDEX = buildIndexName(T, ['doubled'], false);
      const obj = {
        name: T,
        tenancy: { enabled: false },
        fields: {
          amount: { type: 'number' },
          doubled: { type: 'formula', expression: 'amount * 2' },
        },
        indexes: [{ fields: ['doubled'] }],
      };

      it('is not materialized, and the error names it as a formula field and says the index is not UNIQUE', async () => {
        await syncFresh(obj);

        const lines = logs.filter((l) => l.meta?.index === INDEX);
        expect(lines).toHaveLength(1);
        expect(lines[0]!.level).toBe('error');
        expect(lines[0]!.meta).toMatchObject({ tableName: T, index: INDEX, missing: ['doubled'], unique: false });
        expect(lines[0]!.msg).toContain(`'doubled' (a formula field`);
        expect(lines[0]!.msg).not.toContain('UNIQUE');
        expect((await existingIndexNames(driver, T)).has(INDEX)).toBe(false);
      });

      it('is reported in drift at warning severity, since no uniqueness is lost', async () => {
        await syncFresh(obj);

        const unbuildable = (await driver.detectManagedDrift([obj])).filter((d) => d.op.type === 'unbuildable_index');
        expect(unbuildable).toHaveLength(1);
        expect(unbuildable[0]).toMatchObject({
          severity: 'warning',
          category: 'needs_confirm',
          op: { indexName: INDEX, unique: false, missingColumns: ['doubled'] },
        });
      });
    });

    describe('control: a buildable declared index', () => {
      const T = 'os20432_control';
      const INDEX = buildIndexName(T, ['status'], true);
      const obj = {
        name: T,
        tenancy: { enabled: false },
        fields: { status: { type: 'text', maxLength: 64 } },
        indexes: [{ fields: ['status'], unique: true as const }],
      };

      it('is built and enforced, with no error line and no unbuildable_index entry', async () => {
        await syncFresh(obj);

        expect(logs.filter((l) => l.level === 'error')).toEqual([]);
        expect((await existingIndexNames(driver, T)).has(INDEX)).toBe(true);
        // The fixture can express a UNIQUE on this cell: it is enforced.
        await driver.execute(`insert into ${T} (id, status) values ('r1', 'same')`);
        await expect(driver.execute(`insert into ${T} (id, status) values ('r2', 'same')`)).rejects.toThrow();

        const drift = await driver.detectManagedDrift([obj]);
        expect(drift.filter((d) => d.op.type === 'unbuildable_index')).toEqual([]);
      });
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareUnbuildableIndexSuite);
}

// ── The pure differ: which missing columns make an index unbuildable ────────

describe('diffUnbuildableIndexes — only a column that will NEVER materialize (#20432)', () => {
  const T = 'os20432_pure';
  const physical = (...cols: string[]) => new Set(['id', 'created_at', 'updated_at', ...cols]);
  const ops = (entries: ManagedDriftEntry[]) => entries.map((e) => e.op as any);

  it('a declared field whose column is merely not added yet is pending work, not this finding', () => {
    const fields = { status: { type: 'text' }, code: { type: 'text' } };
    const entries = diffUnbuildableIndexes({
      table: T,
      fields,
      tenantField: null,
      declaredIndexes: [{ fields: ['code'], unique: true }],
      physicalColumns: physical('status'),
    });
    expect(entries).toEqual([]);
  });

  it('names only the never-materializing columns when an index mixes both kinds', () => {
    const fields = { status: { type: 'text' }, code: { type: 'text' } };
    const entries = diffUnbuildableIndexes({
      table: T,
      fields,
      tenantField: null,
      declaredIndexes: [{ fields: ['code', 'statsu'] }],
      physicalColumns: physical('status'),
    });
    expect(ops(entries)).toEqual([
      {
        type: 'unbuildable_index',
        table: T,
        column: 'statsu',
        indexName: buildIndexName(T, ['code', 'statsu'], false),
        unique: false,
        missingColumns: ['statsu'],
      },
    ]);
  });

  it('covers a field-level unique on a formula field, the other route into the same sync', () => {
    const fields = { amount: { type: 'number' }, doubled: { type: 'formula', unique: true } };
    const entries = diffUnbuildableIndexes({
      table: T,
      fields,
      tenantField: null,
      physicalColumns: physical('amount'),
    });
    expect(ops(entries)).toEqual([
      expect.objectContaining({ indexName: buildIndexName(T, ['doubled'], true), unique: true, missingColumns: ['doubled'] }),
    ]);
    expect(entries[0]!.severity).toBe('error');
  });

  it('splits the declared set with expectedIndexes: each index lands on exactly one side, or is pending', () => {
    const fields = { status: { type: 'text' }, code: { type: 'text' }, doubled: { type: 'formula' } };
    const declaredIndexes = [
      { fields: ['status'], unique: true as const },
      { fields: ['statsu'], unique: true as const },
      { fields: ['doubled'] },
      { fields: ['code'] },
    ];
    const args = { table: T, fields, tenantField: null, declaredIndexes, physicalColumns: physical('status') };
    expect(expectedIndexes(args).map((i) => i.name)).toEqual([buildIndexName(T, ['status'], true)]);
    expect(ops(diffUnbuildableIndexes(args)).map((o) => o.indexName)).toEqual([
      buildIndexName(T, ['statsu'], true),
      buildIndexName(T, ['doubled'], false),
    ]);
  });

  it('gives each column its own reason kind when the fields are known, and only the name when they are not', () => {
    const fields = { code: { type: 'text' }, doubled: { type: 'formula' } };
    const said = describeMissingIndexColumns(['statsu', 'doubled', 'code'], fields);
    expect(said).toContain(`'statsu' (not a field`);
    expect(said).toContain(`'doubled' (a formula field`);
    expect(said).toContain(`'code' (a declared field`);
    // The drift-op apply path passes no fields, so it cannot claim a reason.
    expect(describeMissingIndexColumns(['statsu'])).toBe(`'statsu'`);
  });
});
