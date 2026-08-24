// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11535] A field that becomes MULTI-VALUE over an existing database keeps its
 * old `varchar`/`text` column, and until this suite existed nothing said so.
 *
 * User-filed production report: a `lookup` gained `multiple: true` on a
 * long-lived Postgres database, the column stayed `character varying`, and the
 * next write stored the array as the literal string `["id1","id2"]`. Reads hand
 * that string back verbatim, so a hook copying the value into a child record's
 * single-lookup column wrote the whole string as ONE id — silent data
 * corruption, repaired by hand in production.
 *
 * ## What distinguishes this defect, and therefore what this suite must pin
 *
 * The shape produced **silence**, not a wrong answer. `detectManagedDrift()`
 * returned `[]` and the boot logged nothing — measured on live Postgres 16.13
 * and MySQL 8.0.46 on the pre-fix tree. So "a finding was produced" is a weak
 * assertion here; every case below pins the finding on the RIGHT COLUMN with the
 * RIGHT DIAGNOSIS, and the neighbouring shapes that must stay silent are pinned
 * as silent in the same breath.
 *
 * ## The detection half only
 *
 * ObjectStack does NOT migrate the column. Whether it should is the other half
 * of #11535 and a live maintainer decision — a migration over existing rows plus
 * an index drop/rebuild is destructive and hard to roll back. This suite pins
 * the reporting, and pins that the reporting changes no deployment's ability to
 * boot (see the category case, which is not a tautology — read its comment).
 *
 * ## Three dialects, and SQLite's absence is a MEASUREMENT
 *
 * SQLite never exposed this: its read path `JSON.parse`s regardless of what the
 * column calls itself. So the same stale column corrupts on Postgres and MySQL
 * and does not on SQLite, and the live half asserts BOTH — including that
 * SQLite's silence sits next to a value that round-trips correctly, which is
 * what makes the silence right rather than a missed detection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { diffManagedTable, manualJsonConversionSql, type PhysicalColumn, type SqlDialectName } from './schema-drift.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'multi-value base-type drift';

/** The column a stale database still carries, per dialect's own spelling. */
const staleColumn = (type: string, maxLength?: number): PhysicalColumn[] => [
  { name: 'tags', type, nullable: true, maxLength },
];

const diffTags = (field: Record<string, unknown>, columns: PhysicalColumn[], dialect: SqlDialectName) =>
  diffManagedTable({ table: 'proj_task', fields: { tags: field }, columns, dialect });

// ── Half 1: the differ, on every dialect's own type spelling ────────────────

describe('diffManagedTable — multi-value field over a stale textual column (#11535)', () => {
  it('names the column, the declared type and the physical type — Postgres spelling', () => {
    const out = diffTags({ type: 'lookup', multiple: true }, staleColumn('character varying', 255), 'postgres');

    // Not `toHaveLength(1)` alone: the defect is a MISSING report, so what is
    // asserted is that the report identifies the right column and says the
    // right thing about it.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      table: 'proj_task',
      column: 'tags',
      kind: 'type_mismatch',
      expected: 'json',
      actual: 'character varying',
      op: { type: 'manual_column_type_change', table: 'proj_task', column: 'tags', to: 'json', from: 'character varying' },
    });
  });

  it('fires on MySQL too, carrying MySQL’s own type word', () => {
    const out = diffTags({ type: 'lookup', multiple: true }, staleColumn('varchar', 255), 'mysql');
    expect(out).toHaveLength(1);
    expect(out[0].actual).toBe('varchar');
  });

  it('fires on a stale TEXT column, not only varchar — a text column takes the stringified literal just as happily', () => {
    const out = diffTags({ type: 'string', multiple: true }, staleColumn('text'), 'postgres');
    expect(out).toHaveLength(1);
    expect(out[0].actual).toBe('text');
  });

  it('the message names the table, the column, both types and the hand-run remedy', () => {
    const [entry] = diffTags({ type: 'lookup', multiple: true }, staleColumn('character varying', 255), 'postgres');
    // An operator reading one log line has to be able to act without opening
    // the source, so every element of the diagnosis is pinned individually.
    expect(entry.message).toContain('proj_task.tags');
    expect(entry.message).toContain('json');
    expect(entry.message).toContain('character varying');
    expect(entry.message).toContain('#11535');
    // The remedy is the real statement, not a gesture at one.
    expect(entry.message).toContain(manualJsonConversionSql('postgres', 'proj_task', 'tags'));
    // The orphaned single-value index is part of the same picture: a json
    // column cannot carry a plain btree, so the remedy has to mention it.
    expect(entry.message).toMatch(/btree/i);
  });

  it('the MySQL remedy is MySQL’s, not Postgres’ statement with different quotes', () => {
    const [entry] = diffTags({ type: 'lookup', multiple: true }, staleColumn('varchar', 255), 'mysql');
    expect(entry.message).toContain(manualJsonConversionSql('mysql', 'proj_task', 'tags'));
    // MySQL will not cast text to json implicitly — the row rewrite has to come
    // first or the ALTER dies on the first legacy value.
    expect(entry.message).toContain('JSON_ARRAY');
    expect(entry.message).not.toContain('json_build_array');
  });

  // ── the shapes that must stay SILENT ─────────────────────────────────────

  it('says nothing when the column is already `json` — the healthy database', () => {
    expect(diffTags({ type: 'lookup', multiple: true }, staleColumn('json'), 'postgres')).toEqual([]);
    expect(diffTags({ type: 'lookup', multiple: true }, staleColumn('json'), 'mysql')).toEqual([]);
  });

  it('says nothing on SQLite, where the same stale column corrupts nothing', () => {
    // Not a scoping convenience: the live half below measures that the value
    // round-trips as a real array on SQLite. Reporting here would put a
    // permanent `error` finding on every long-lived SQLite dev database for a
    // divergence that changes no value.
    expect(diffTags({ type: 'lookup', multiple: true }, staleColumn('varchar', 255), 'sqlite')).toEqual([]);
  });

  it('says nothing about a stale INTEGER column — the server already refuses that write loudly', () => {
    // The finding exists to break a SILENCE. A column that rejects
    // `'["a","b"]'` outright (Postgres 22P02, MySQL ER_TRUNCATED_WRONG_VALUE)
    // is not silent, so there is no silence to break.
    expect(diffTags({ type: 'integer', multiple: true }, staleColumn('integer'), 'postgres')).toEqual([]);
    expect(diffTags({ type: 'datetime', multiple: true }, staleColumn('timestamp with time zone'), 'postgres')).toEqual([]);
  });

  it('leaves the single-value varchar-width branch (#11431) exactly where it was', () => {
    // The guard added for multi-value fields must not have cost the neighbouring
    // branch its reach — a fix that silences the thing next to it is a
    // regression wearing a green suite.
    const out = diffTags({ type: 'string', maxLength: 50 }, staleColumn('character varying', 255), 'postgres');
    expect(out).toHaveLength(1);
    expect(out[0].op.type).toBe('narrow_varchar');
  });

  it('a MULTI-VALUE field with a maxLength reports the base type ONCE, never `narrow_varchar`', () => {
    // Measured on the pre-fix tree: this shape produced `narrow_varchar` at
    // severity `error`, category DESTRUCTIVE on both enforcing dialects — a
    // finding that refuses the artifact-pinned boot and invites
    // `os migrate apply --allow-destructive` to rewrite the column to
    // `varchar(50)`, the exact opposite of the repair it needs. `createColumn`
    // returns at its `multiple` branch before `maxLength` is read, so the
    // emitter never asks for that width and the differ must not either.
    for (const dialect of ['postgres', 'mysql'] as const) {
      const out = diffTags({ type: 'string', multiple: true, maxLength: 50 }, staleColumn('character varying', 255), dialect);
      expect(out.map((d) => d.op.type)).toEqual(['manual_column_type_change']);
    }
  });

  // ── the severity/category pin — the one that keeps deployments booting ────

  it('is severity `error` but category `needs_confirm`, so it reports loudly and refuses NO boot', () => {
    const [entry] = diffTags({ type: 'lookup', multiple: true }, staleColumn('character varying', 255), 'postgres');

    expect(entry.severity).toBe('error');

    // ⛔ This is not a style assertion, and `needs_confirm` is not a softer way
    // of saying `destructive`. Measured downstream, on the real consumers:
    //
    //   - `runArtifactBootMigrationGate` (packages/cli, runs on `kernel:ready`
    //     BEFORE the HTTP socket opens, and its refusal is a thrown boot
    //     failure) refuses the boot for `category === 'destructive'` and for
    //     nothing else — `severity` it never reads. Measured: a `destructive`
    //     entry returns `ok=false`, this entry returns `ok=true`.
    //   - Dev auto-reconcile applies `category === 'safe'` only, so this is
    //     never applied unattended either.
    //
    // Every database this finding describes is ALREADY SERVING — that is the
    // premise of the report it came from. Flipping this to `destructive` would
    // turn a running (if corrupt) deployment into a crash-loop on its next
    // restart, i.e. the report of the corruption would become the outage.
    expect(entry.category).toBe('needs_confirm');
    expect(entry.category).not.toBe('destructive');
  });
});

// ── Half 2: end to end, on every provisioned dialect ────────────────────────

const TABLE = 'os11535_task';
const singleValueMeta = [{ name: TABLE, fields: { name: { type: 'string' }, tags: { type: 'string' } } }];
const multiValueMeta = [{ name: TABLE, fields: { name: { type: 'string' }, tags: { type: 'string', multiple: true } } }];

class DriftProbeDriver extends SqlDriver {
  columnsOf(table: string) {
    return this.introspectColumns(table);
  }
}

function declareBaseTypeDriftSuite(cell: DialectCell): void {
  describe(`multi-value base-type drift — ${cell.label} (#11535)`, () => {
    const corrupts = cell.id !== 'sqlite';
    let driver: DriftProbeDriver;
    let physicalType: string;
    let readBack: unknown;

    beforeAll(async () => {
      driver = new DriftProbeDriver(cell.config());
      await driver.connect();
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});

      // 1. the OLD database: the field is single-value, so the column is textual
      await driver.initObjects(singleValueMeta as any);
      await driver.create(TABLE, { name: 'legacy', tags: 'a' });

      // 2. the metadata change + reboot. `initObjects` is additive-only: nothing
      //    is missing, so nothing is added, and the column is never revisited.
      await driver.initObjects(multiValueMeta as any);

      physicalType = (await driver.columnsOf(TABLE)).find((c) => c.name === 'tags')!.type;

      // 3. the write that corrupts (or, on SQLite, does not)
      await driver.create(TABLE, { name: 'multi', tags: ['x', 'y'] });
      const rows = await driver.find(TABLE, { filters: [] } as any);
      readBack = rows.find((r: any) => r.name === 'multi')!.tags;
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect().catch(() => {});
    });

    it('the fixture is real: the column stayed textual while metadata declares a json column', async () => {
      // Non-vacuity first. Every assertion below is about a STALE column; if the
      // sync had migrated it, they would all pass for the wrong reason.
      expect(physicalType).toMatch(/char|text/i);

      // And a table built from the SAME metadata on a fresh database gets json —
      // which is what makes the column above stale rather than simply correct.
      const fresh = `${TABLE}_fresh`;
      await driver.execute(`drop table if exists ${fresh}`).catch(() => {});
      await driver.initObjects([{ name: fresh, fields: { tags: { type: 'string', multiple: true } } }] as any);
      const freshType = (await driver.columnsOf(fresh)).find((c) => c.name === 'tags')!.type;
      expect(freshType).toMatch(/json/i);
      expect(freshType).not.toBe(physicalType);
      await driver.execute(`drop table if exists ${fresh}`).catch(() => {});
    });

    it(corrupts
      ? 'the value IS corrupted here — it reads back as the stringified literal, not an array'
      : 'the value is NOT corrupted here — it reads back as a real array', () => {
      // This is the fact the finding exists to describe, asserted against the
      // server rather than assumed from the dialect's name. It is also what
      // makes SQLite's silence correct instead of a missed detection.
      if (corrupts) {
        expect(typeof readBack).toBe('string');
        expect(Array.isArray(readBack)).toBe(false);
        expect(readBack).toBe('["x","y"]');
      } else {
        expect(Array.isArray(readBack)).toBe(true);
        expect(readBack).toEqual(['x', 'y']);
      }
    });

    it(corrupts
      ? 'detectManagedDrift() reports the stale column, naming it and both types'
      : 'detectManagedDrift() stays silent, because there is nothing here to corrupt', async () => {
      const drift = await driver.detectManagedDrift();
      const found = drift.filter((d) => d.op.type === 'manual_column_type_change');

      if (!corrupts) {
        expect(found).toEqual([]);
        return;
      }

      expect(found).toHaveLength(1);
      expect(found[0].table).toBe(TABLE);
      expect(found[0].column).toBe('tags');
      expect(found[0].expected).toBe('json');
      expect(found[0].actual).toBe(physicalType);
      expect(found[0].severity).toBe('error');
      expect(found[0].category).toBe('needs_confirm');
    });

    it.skipIf(!corrupts)('the remedy the finding prints actually works, and clears the finding', async () => {
      // An operator-facing remedy nobody runs is a remedy that drifts into being
      // wrong. This runs the emitted statement verbatim against the live server,
      // over rows in every state a stale column holds.
      const dialect = cell.id === 'pg' ? 'postgres' : 'mysql';
      await driver.execute(
        cell.id === 'pg'
          ? `insert into ${TABLE} (id, name, tags) values ('e', 'empty', '')`
          : `insert into ${TABLE} (id, name, tags) values ('e', 'empty', '')`,
      );
      await driver.execute(`insert into ${TABLE} (id, name) values ('n', 'nulled')`);

      for (const stmt of manualJsonConversionSql(dialect, TABLE, 'tags').split(';').map((s) => s.trim()).filter(Boolean)) {
        await driver.execute(stmt);
      }

      expect((await driver.columnsOf(TABLE)).find((c) => c.name === 'tags')!.type).toMatch(/json/i);

      // The finding is GONE — the report is not a permanent nag once the
      // operator has acted.
      const after = await driver.detectManagedDrift();
      expect(after.filter((d) => d.op.type === 'manual_column_type_change')).toEqual([]);

      // And the data is in the shape the declaration promises, for every row
      // state: the corrupted array is an array again, a legacy single value has
      // become a one-element array, and NULL/'' stay empty rather than becoming
      // `[null]` (which `json_build_array(NULL)` would have produced).
      const rows = await driver.find(TABLE, { filters: [] } as any);
      const byName = new Map(rows.map((r: any) => [r.name, r.tags]));
      expect(byName.get('multi')).toEqual(['x', 'y']);
      expect(byName.get('legacy')).toEqual(['a']);
      expect(byName.get('empty') ?? null).toBeNull();
      expect(byName.get('nulled') ?? null).toBeNull();
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareBaseTypeDriftSuite);
}
