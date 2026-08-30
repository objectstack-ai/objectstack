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
 * ## Detection, and the remedy it now points at
 *
 * ObjectStack still does NOT migrate the column on its own. That is the ruling,
 * not a gap: ruled C on #11700 (maintainer, 2026-08-24) — the platform warns and
 * ships an explicit, operator-run migration, and never runs it at boot.
 * Unattended auto-migration was rejected as the only route that alters a
 * customer's production table with nobody watching.
 *
 * What changed since the detection half landed is that the migration now EXISTS:
 * `os migrate multi-value-columns` (#11733). So the message stopped describing a
 * problem and started naming the way out, and this suite pins the naming in both
 * directions — the shapes that must carry the recommendation and the shapes that
 * must not, including a live database re-booted after the repair.
 *
 * It also pins that none of this changes a deployment's ability to boot (see the
 * category case, which is not a tautology — read its comment).
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
import {
  diffManagedTable,
  manualJsonConversionSql,
  MULTI_VALUE_COLUMN_REMEDY_COMMAND,
  type PhysicalColumn,
  type SqlDialectName,
} from './schema-drift.js';
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

  // ── the message NAMES the remedy command (#11535, remaining half) ────────
  //
  // When the detection half landed there was no command to name, so the message
  // handed the operator raw SQL and opened with "ObjectStack will NOT change
  // this column for you". `os migrate multi-value-columns` (#11733) both
  // falsified that sentence and gave the message something better to say.

  it('names `os migrate multi-value-columns`, and names it BEFORE the hand-run SQL', () => {
    for (const dialect of ['postgres', 'mysql'] as const) {
      const [entry] = diffTags({ type: 'lookup', multiple: true }, staleColumn('character varying', 255), dialect);

      expect(entry.message).toContain(MULTI_VALUE_COLUMN_REMEDY_COMMAND);

      // Order is the assertion, not decoration. Both routes repair the column;
      // only one of them dry-runs first, prompts, and re-checks the finding
      // afterwards. An operator who stops reading at the first `ALTER TABLE`
      // they see should have already passed the command.
      const commandAt = entry.message.indexOf(MULTI_VALUE_COLUMN_REMEDY_COMMAND);
      const sqlAt = entry.message.indexOf(manualJsonConversionSql(dialect, 'proj_task', 'tags'));
      expect(commandAt).toBeGreaterThanOrEqual(0);
      expect(sqlAt).toBeGreaterThan(commandAt);

      // The dry run is the default and is worth a full sentence: an operator who
      // reads "run this" on a production database needs to know it writes
      // nothing until they ask again.
      expect(entry.message).toMatch(/dry run/i);
      expect(entry.message).toContain('--apply');
      expect(entry.message).toMatch(/backup/i);
    }
  });

  it('no longer claims ObjectStack will not migrate the column — that became false when #11733 landed', () => {
    // A regression guard on a specific false sentence, kept because the failure
    // it describes is invisible: the message would still be loud, still name the
    // right column, and still print working SQL, while telling the operator that
    // the command two lines below it does not exist.
    const [entry] = diffTags({ type: 'lookup', multiple: true }, staleColumn('character varying', 255), 'postgres');
    expect(entry.message).not.toMatch(/will NOT change this column/i);

    // What IS still true, and must stay said: nothing migrates the column
    // unattended. Ruled C on #11700 — the platform warns and ships an
    // operator-run command; it never runs it at boot.
    expect(entry.message).toMatch(/never migrates this column on its own/i);
  });

  it('keeps the statement VERBATIM, because the CLI recovers the dialect by containment', () => {
    // ⚠️ Cross-package contract, pinned from the emitting side. A
    // `ManagedDriftEntry` carries no dialect, so `planStaleColumnTargets`
    // (packages/cli/.../migrate/multi-value-columns.ts) identifies one by asking
    // which dialect's statement the MESSAGE contains. A reword that paraphrases
    // the SQL, wraps it, or breaks it across a line makes every finding
    // `remedy_not_recognized` — the command this message now points at would
    // refuse to run, and nothing in driver-sql's own suite would notice.
    // This reproduces that probe rather than describing it.
    const probe = (message: string) =>
      (['postgres', 'mysql'] as const).filter((d) => message.includes(manualJsonConversionSql(d, 'proj_task', 'tags')));

    for (const dialect of ['postgres', 'mysql'] as const) {
      const [entry] = diffTags({ type: 'lookup', multiple: true }, staleColumn('character varying', 255), dialect);
      // Exactly one — a message matching both would make the probe's answer
      // depend on array order.
      expect(probe(entry.message)).toEqual([dialect]);
    }
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

  it('the remedy command is named by THIS finding and by nothing else', () => {
    // The other half of the non-vacuity pair. `os migrate multi-value-columns`
    // converts a column to `json`; a message that recommended it for a healthy
    // column, a single-value field, or a plain width difference would be
    // pointing an operator at a type change nothing here asked for. A signal
    // that fires on everything reads exactly as green as one that fires
    // correctly, so the shapes that must NOT carry it are enumerated.
    const mustNotName: Array<[string, Parameters<typeof diffTags>[0], PhysicalColumn[], SqlDialectName]> = [
      // already migrated — the repair has been done
      ['migrated json column', { type: 'lookup', multiple: true }, staleColumn('json'), 'postgres'],
      // never multi-value — the column is right and always was
      ['single-value field', { type: 'string' }, staleColumn('character varying', 255), 'postgres'],
      // a real finding, but a WIDTH one: `os migrate apply` handles it
      ['single-value width drift', { type: 'string', maxLength: 50 }, staleColumn('character varying', 255), 'postgres'],
      ['single-value width widen', { type: 'string', maxLength: 500 }, staleColumn('character varying', 255), 'postgres'],
      // dialects/types where the stale column corrupts nothing
      ['sqlite', { type: 'lookup', multiple: true }, staleColumn('varchar', 255), 'sqlite'],
      ['stale integer column', { type: 'integer', multiple: true }, staleColumn('integer'), 'postgres'],
    ];

    for (const [label, field, columns, dialect] of mustNotName) {
      const out = diffTags(field, columns, dialect);
      for (const entry of out) {
        expect(entry.message, `${label} must not recommend the column-type migration`)
          .not.toContain(MULTI_VALUE_COLUMN_REMEDY_COMMAND);
        expect(entry.op.type, label).not.toBe('manual_column_type_change');
      }
    }

    // And the fixture is not vacuous in the other direction: two of those rows
    // DO produce a finding, so the loop above is reading real messages rather
    // than passing over empty arrays.
    expect(diffTags({ type: 'string', maxLength: 50 }, staleColumn('character varying', 255), 'postgres')).toHaveLength(1);
    expect(diffTags({ type: 'string', maxLength: 500 }, staleColumn('character varying', 255), 'postgres')).toHaveLength(1);
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
  /**
   * Every line the boot path logged — the operator's ACTUAL view.
   *
   * `detectManagedDrift()` returns objects; what an operator meets on a restart
   * is `reconcileAndWarnDrift` putting `d.message` through the logger. Asserting
   * only on the returned object would leave the delivery unpinned, which is the
   * half this card is about: the finding was already correct, and still told the
   * operator to go write SQL by hand.
   */
  public logged: string[] = [];

  constructor(config: ConstructorParameters<typeof SqlDriver>[0]) {
    super(config);
    (this as unknown as { logger: { warn: (m: string) => void; error: (m: string) => void } }).logger = {
      warn: (m: string) => this.logged.push(m),
      error: (m: string) => this.logged.push(m),
    };
  }

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
    /** Exactly what the boot in step 2 logged — snapshotted before anything else runs. */
    let bootLines: string[] = [];

    beforeAll(async () => {
      driver = new DriftProbeDriver(cell.config());
      await driver.connect();
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});

      // 1. the OLD database: the field is single-value, so the column is textual
      await driver.initObjects(singleValueMeta as any);
      await driver.create(TABLE, { name: 'legacy', tags: 'a' });

      // 2. the metadata change + reboot. `initObjects` is additive-only: nothing
      //    is missing, so nothing is added, and the column is never revisited.
      driver.logged = [];
      await driver.initObjects(multiValueMeta as any);
      bootLines = [...driver.logged];

      physicalType = (await driver.columnsOf(TABLE)).find((c) => c.name === 'tags')!.type;

      // 3. the write that corrupts (or, on SQLite, does not)
      await driver.create(TABLE, { name: 'multi', tags: ['x', 'y'] });
      const rows = await driver.find(TABLE, {});
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

      // And a table built from the SAME metadata on a fresh database gets the
      // JSON column type FOR THIS DIALECT — which is what makes the column above
      // stale rather than simply correct.
      const fresh = `${TABLE}_fresh`;
      await driver.execute(`drop table if exists ${fresh}`).catch(() => {});
      await driver.initObjects([{ name: fresh, fields: { tags: { type: 'string', multiple: true } } }] as any);
      const freshType = (await driver.columnsOf(fresh)).find((c) => c.name === 'tags')!.type;

      // [#12738] INVERTED on SQLite only, and the inversion REINFORCES this
      // suite rather than weakening it. `createColumn` used to emit `json` on
      // every dialect; it now emits the dialect-correct type, and SQLite — which
      // has no JSON type — gets `text`. So on SQLite a fresh column and the
      // stale one below are now the same AFFINITY CLASS, differing only in
      // spelling (`TEXT` vs `varchar(255)`).
      //
      // That is exactly why `multiValueColumnTypeIsLoadBearing()` excludes
      // SQLite and why the next case asserts SQLite does NOT corrupt: on this
      // dialect the column type was never load-bearing, and after #12738 the
      // emitter agrees with the differ instead of merely being excused by it.
      // ⛔ Do not "restore" `/json/i` here — that would assert SQLite declares a
      // type it does not have.
      expect(freshType).toMatch(cell.id === 'sqlite' ? /char|clob|text/i : /json/i);

      // Still a real difference on every dialect — on the enforcing ones it is a
      // difference of TYPE, on SQLite only of spelling.
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

    it(corrupts
      ? 'the BOOT tells the operator to run `os migrate multi-value-columns`'
      : 'the BOOT says nothing at all, so no operator is sent to migrate a healthy column', () => {
      // The delivery, not the detection. This is the line a restart actually
      // prints — `reconcileAndWarnDrift` handing `d.message` to the logger —
      // captured from the real boot in step 2 rather than reconstructed.
      const driftLines = bootLines.filter((l) => l.includes('[schema-drift]'));

      if (!corrupts) {
        // SQLite: the value round-trips as a real array (pinned above), so a
        // recommendation to convert the column would send an operator to alter
        // a database that has nothing wrong with it.
        expect(driftLines.filter((l) => l.includes(MULTI_VALUE_COLUMN_REMEDY_COMMAND))).toEqual([]);
        return;
      }

      const named = driftLines.filter((l) => l.includes(MULTI_VALUE_COLUMN_REMEDY_COMMAND));
      expect(named).toHaveLength(1);

      // One line has to carry the whole diagnosis AND the way out: an operator
      // reading a boot log is not going to go find the source.
      expect(named[0]).toContain(`${TABLE}.tags`);
      expect(named[0]).toContain(physicalType);
      expect(named[0]).toMatch(/dry run/i);
      expect(named[0]).toContain('--apply');

      // And the statement survived the trip through the logger intact — this is
      // the string the CLI matches on to recover the dialect.
      const dialect = cell.id === 'pg' ? 'postgres' : 'mysql';
      expect(named[0]).toContain(manualJsonConversionSql(dialect, TABLE, 'tags'));
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

      // …and so is the BOOT LINE. The negative direction on a live database, and
      // the one an operator actually experiences: having run the command the
      // message recommended, the next restart must stop recommending it. A
      // signal that keeps firing after the repair trains operators to ignore it,
      // which costs exactly as much as never firing.
      //
      // ⚠️ A SECOND DRIVER, not another `initObjects` on this one. `driftWarned`
      // is a per-instance throttle keyed by `driftKey(d)` — the same instance
      // stays silent on its second boot whether or not the drift is still there,
      // so re-booting `driver` would assert nothing at all. A fresh instance is
      // what a restart actually is.
      const rebooted = new DriftProbeDriver(cell.config());
      try {
        await rebooted.connect();
        await rebooted.initObjects(multiValueMeta as any);
        expect(rebooted.logged.filter((l) => l.includes(MULTI_VALUE_COLUMN_REMEDY_COMMAND))).toEqual([]);
      } finally {
        await rebooted.disconnect().catch(() => {});
      }

      // Non-vacuity: a fresh instance booting the SAME metadata against the
      // stale column did name it (`bootLines`, step 2 above), so the silence
      // belongs to the repair rather than to a fixture that stopped booting.
      expect(bootLines.filter((l) => l.includes(MULTI_VALUE_COLUMN_REMEDY_COMMAND))).toHaveLength(1);

      // And the data is in the shape the declaration promises, for every row
      // state: the corrupted array is an array again, a legacy single value has
      // become a one-element array, and NULL/'' stay empty rather than becoming
      // `[null]` (which `json_build_array(NULL)` would have produced).
      const rows = await driver.find(TABLE, {});
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
