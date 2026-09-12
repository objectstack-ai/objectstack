// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15989] The ADR-0104 file-family COLUMN step, executed — per dialect, for
 * BOTH encodings, across the window. The ruling on #15041 step 2, and the
 * director ruling on this card (decision batch #120 item 1).
 *
 * `sql-driver-15989-file-family-bare-id.test.ts` pins what the two ARMS store
 * and read. This file pins the act that takes a deployment from one arm to the
 * other: the statements run against a real server, the pre-check that stops
 * them, and the reverse verification that the moved column serves the driver
 * afterwards.
 *
 * ## §1 is the measurement this card exists for
 *
 * The #15041 addendum prescribed `ALTER … USING (col #>> '{}')` with nothing in
 * front of it, and required the step to abort *"on the first cell that is not a
 * JSON string"*. Those two sentences contradict each other, and which one was
 * wrong was settled by running it: `#>> '{}'` extracts ANY json type as text, so
 * on live PostgreSQL 16.13 the statement was ACCEPTED over a row holding an
 * inline metadata blob and flattened that object to its own literal text in a
 * `varchar` column. §1 reproduces the destructive form beside the guarded one,
 * in the same run, on the same fixture — ⛔ it is a standing ablation, not a
 * historical note, because a future edit that drops the pre-check would
 * otherwise leave every other case in this file green.
 *
 * ## Dialect coverage, stated rather than implied
 *
 * SQLite always runs. Postgres runs when `OS_TEST_POSTGRES_URL` is provisioned
 * and is a NAMED SKIP otherwise. ⛔ MySQL is deliberately NOT a cell here: the
 * column step has no MySQL statements at all (#17788 owns them, and owns them
 * on a real instance because the addendum leaves the statement ORDER
 * unsettled), so a MySQL cell would be a pin over a refusal. §5 asserts that
 * refusal instead, with no server.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import {
  mediaColumnMoveDialect,
  mediaColumnMovePlan,
  type MediaColumnMovePlan,
} from './media-column-move.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

// ⛔ Not `as any`: `check:query-options-erasure` counts every erased options
// bag, tests included, and this one is squarely ON contract.
const OPTS: DriverOptions = { bypassTenantAudit: true };

/**
 * An unconverted inline blob — exactly what the backfill has NOT yet touched.
 *
 * ⚠️ Deliberately NOT canonical JSON. A blob whose text already equals its own
 * re-serialisation makes the SQLite half of §1's ablation VACUOUS: measured,
 * `json_extract('{"a":1}','$')` hands back byte-identical text, so the
 * unguarded unquote looks harmless on a fixture that was formatted the way
 * SQLite would format it. The spacing below is what makes "this row was
 * rewritten" observable in bytes rather than only in the column's type.
 */
const BLOB = '{ "url" : "https://x/y.png",  "size": 12 }';

class MoveProbe extends SqlDriver {
  get raw() {
    return (this as unknown as { knex: any }).knex;
  }
  get sqlite(): boolean {
    return (this as unknown as { isSqlite: boolean }).isSqlite;
  }
  get postgres(): boolean {
    return (this as unknown as { isPostgres: boolean }).isPostgres;
  }
}

const objectDef = (table: string) => ({
  name: table,
  fields: {
    cover: { type: 'image' },
    label: { type: 'string' },
  },
} as any);

/** The bytes the SERVER holds, read around every client-side json decode. */
async function storedText(d: MoveProbe, table: string, column: string, id: string): Promise<string | null> {
  if (d.sqlite) {
    const row = await d.raw(table).where('id', id).first();
    return row?.[column] == null ? null : String(row[column]);
  }
  const res: any = await d.raw.raw(`select "${column}"::text as t from "${table}" where id = ?`, [id]);
  const rows = Array.isArray(res) ? res[0] : res.rows;
  return rows[0]?.t == null ? null : String(rows[0].t);
}

/** The column's physical type, as the server reports it. */
async function columnType(d: MoveProbe, table: string, column: string): Promise<string> {
  const info: any = await d.raw(table).columnInfo();
  return String(info[column]?.type ?? '').toLowerCase();
}

async function count(d: MoveProbe, sql: string): Promise<number> {
  const res: any = await d.raw.raw(sql);
  const rows = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : (res?.rows ?? []);
  const raw = rows[0]?.n ?? rows[0]?.N ?? Object.values(rows[0] ?? {})[0];
  return Number(raw);
}

/** Write a cell around the driver, so the bytes on disk are the fixture's. */
async function writeRaw(d: MoveProbe, table: string, id: string, patch: Record<string, unknown>) {
  await d.raw(table).where('id', id).update(patch);
}

function measure(cell: DialectCell): void {
  // One table per section: these run inside one file, and a shared table would
  // let a section's DDL decide another's starting state.
  const T_ABLATION = 'os15989m_ablation';
  const T_GUARD = 'os15989m_guard';
  const T_MOVE = 'os15989m_move';
  const T_UNQUOTE = 'os15989m_unquote';

  /**
   * The cell's config, made shareable between TWO driver instances.
   *
   * §3 is the reverse verification, and it needs the two arms of the window to
   * be two drivers over ONE database — which is the window's own shape, since
   * the arm is a per-deployment fact rather than a build. The live cells
   * already are (a real server, one per-file schema), but the SQLite cell is
   * `:memory:`, where a second driver opens a second, EMPTY database. ⛔ That
   * failure is silent in exactly the direction that matters: the second driver
   * creates its own table, its own writes read back perfectly, and the rows the
   * first driver migrated are simply absent — a green §3 that measured nothing
   * about the move. A file-backed database is the smallest change that makes
   * the two drivers share bytes.
   */
  const SQLITE_FILE = join(
    mkdtempSync(join(tmpdir(), 'os15989-colmove-')),
    'shared.sqlite',
  );
  const sharedConfig = () => {
    const base = cell.config() as Record<string, unknown>;
    if (base.client !== 'better-sqlite3') return base as ReturnType<DialectCell['config']>;
    return { ...base, connection: { filename: SQLITE_FILE } } as ReturnType<DialectCell['config']>;
  };

  describe(`#15989 — the column step, executed (${cell.label})`, () => {
    let unmoved: MoveProbe;
    let dialect: 'postgres' | 'sqlite';

    beforeAll(async () => {
      unmoved = new MoveProbe(sharedConfig());
      await unmoved.initObjects([
        objectDef(T_ABLATION),
        objectDef(T_GUARD),
        objectDef(T_MOVE),
        objectDef(T_UNQUOTE),
      ]);
      const named = mediaColumnMoveDialect(unmoved.dialectName);
      expect(named, `${cell.label} must be a dialect this step serves`).not.toBeNull();
      dialect = named as 'postgres' | 'sqlite';
    });

    afterAll(async () => {
      await unmoved?.disconnect().catch(() => {});
      rmSync(dirname(SQLITE_FILE), { recursive: true, force: true });
    });

    /** The plan for `table.cover`, classified the way `planMediaColumnMove` classifies. */
    async function planFor(table: string): Promise<MediaColumnMovePlan> {
      const physical = await columnType(unmoved, table, 'cover');
      return mediaColumnMovePlan(dialect, /json/.test(physical) ? 'retype' : 'unquote', table, 'cover');
    }

    // ── §1 the ablation: the superseded clause beside this PR's ─────────────

    it('§1 the SUPERSEDED clause rewrites an unconverted row; THIS clause refuses to run at all', async () => {
      // The fixture the ruling was measured on: one converted cell, one the
      // backfill has not reached.
      await unmoved.create(T_ABLATION, { id: 'converted', cover: 'file_01CONVERTED', label: 'a' }, OPTS);
      await unmoved.create(T_ABLATION, { id: 'unconverted', cover: 'file_placeholder', label: 'a' }, OPTS);
      await writeRaw(unmoved, T_ABLATION, 'unconverted', { cover: BLOB });

      const before = await storedText(unmoved, T_ABLATION, 'cover', 'unconverted');
      expect(before).toBe(BLOB);

      const plan = await planFor(T_ABLATION);
      const typeBefore = await columnType(unmoved, T_ABLATION, 'cover');

      // ── the guarded form: the pre-check answers NON-ZERO and nothing runs.
      const blocking = await count(unmoved, plan.precheck);
      expect(blocking, 'the abort pre-check must SEE the unconverted row').toBeGreaterThan(0);

      // Not running the statement is the whole behaviour, so what is asserted
      // is that the bytes and the column are untouched after the refusal.
      expect(await storedText(unmoved, T_ABLATION, 'cover', 'unconverted')).toBe(before);
      // The converted cell is still in its legacy encoding too — the refusal is
      // total, not per row.
      expect(await storedText(unmoved, T_ABLATION, 'cover', 'converted')).toBe('"file_01CONVERTED"');

      // ── the superseded form: run it, and watch the unconverted row change.
      // ⛔ This is the ablation. It is executed, on the same fixture, so the
      // difference between the two clauses is a measurement in this run rather
      // than a claim in a comment.
      const destructive =
        plan.kind === 'retype'
          ? `alter table "${T_ABLATION}" alter column "cover" type varchar(2048) using ("cover" #>> '{}')`
          : dialect === 'sqlite'
            ? `update "${T_ABLATION}" set "cover" = json_extract("cover", '$') where "cover" is not null and json_valid("cover")`
            : `update "${T_ABLATION}" set "cover" = ("cover"::json #>> '{}') where "cover" is not null`;
      await unmoved.raw.raw(destructive);

      const after = await storedText(unmoved, T_ABLATION, 'cover', 'unconverted');
      const typeAfter = await columnType(unmoved, T_ABLATION, 'cover');

      // The statement was ACCEPTED — no throw, no warning — over exactly the
      // row the ruling requires it to refuse. That much is common to both
      // dialects, and it is the whole defect: a successful-looking migration.
      expect(after).not.toBeNull();

      // ⚠️ WHAT is lost differs by dialect, and the two are stated separately
      // rather than averaged into one claim, because averaging them is how a
      // pin ends up asserting the weaker of the two.
      if (dialect === 'postgres') {
        // MEASURED, and the reason this defect is invisible to a byte diff:
        // Postgres's `json` type stores the input text verbatim and
        // `#>> '{}'` hands that same text back, so the BYTES survive. What
        // does not survive is the TYPE — the column is no longer json, so an
        // object that was a JSON object is now a plain string sitting in a
        // column whose declared contents are bare `sys_file` ids. Every
        // consumer that read it as an object now reads a string, and nothing
        // in the database records that it ever happened.
        expect(typeBefore).toContain('json');
        expect(typeAfter).not.toContain('json');
        expect(after).toContain('"url"');
        expect(after, 'Postgres preserves the bytes — the loss is the type').toBe(before);
      } else {
        // SQLite has no type to lose, so the loss IS in the bytes: the blob is
        // re-serialised by `json_extract` and whatever formatting the row
        // carried is gone. The row was rewritten, which is what the
        // requirement forbids, and the column stays `text` throughout.
        expect(before).toContain('  ');
        expect(after).not.toContain('  ');
        expect(after, 'SQLite rewrites the bytes').not.toBe(before);
      }

      // …and the converted row came out as the bare id, which is why the
      // superseded form looks like it worked.
      expect(await storedText(unmoved, T_ABLATION, 'cover', 'converted')).toBe('file_01CONVERTED');
    });

    // ── §2 the CONTROL: the same pre-check passes on a clean column ─────────

    it('§2 CONTROL — with no unconverted cell the same pre-check answers zero and the move runs', async () => {
      await unmoved.create(T_GUARD, { id: 'a', cover: 'file_01A', label: 'a' }, OPTS);
      await unmoved.create(T_GUARD, { id: 'b', cover: 'file_01B', label: 'a' }, OPTS);
      await unmoved.create(T_GUARD, { id: 'nullcell', label: 'a' }, OPTS);

      const plan = await planFor(T_GUARD);
      // ⛔ Without this the §1 reading is void: a pre-check that is always
      // non-zero would produce §1's abort for the wrong reason.
      expect(await count(unmoved, plan.precheck)).toBe(0);

      await unmoved.raw.raw(plan.statement);

      expect(await storedText(unmoved, T_GUARD, 'cover', 'a')).toBe('file_01A');
      expect(await storedText(unmoved, T_GUARD, 'cover', 'b')).toBe('file_01B');
      // A NULL must survive as a NULL — the failure mode `manualJsonConversionSql`
      // records for its own dialect arm (`json_build_array(NULL)` is `[null]`).
      expect(await storedText(unmoved, T_GUARD, 'cover', 'nullcell')).toBeNull();
      expect(await columnType(unmoved, T_GUARD, 'cover')).not.toContain('json');
    });

    it('§2b the move is IDEMPOTENT — a re-run changes nothing and still refuses nothing', async () => {
      const plan = await planFor(T_GUARD);
      expect(await count(unmoved, plan.precheck)).toBe(0);
      await unmoved.raw.raw(plan.statement);
      expect(await storedText(unmoved, T_GUARD, 'cover', 'a')).toBe('file_01A');
      expect(await storedText(unmoved, T_GUARD, 'cover', 'nullcell')).toBeNull();
    });

    // ── §3 the reverse verification the card names ─────────────────────────

    it('§3 after the move, a MOVED driver writes the bare id and reads it back unchanged', async () => {
      // Move the column while the deployment is still on the JSON arm — which
      // is the real order: the operator runs the migration, and the arm flips
      // on the next boot because the ledger now says so.
      await unmoved.create(T_MOVE, { id: 'pre', cover: 'file_01PRE', label: 'a' }, OPTS);
      const plan = await planFor(T_MOVE);
      expect(await count(unmoved, plan.precheck)).toBe(0);
      await unmoved.raw.raw(plan.statement);
      expect(await storedText(unmoved, T_MOVE, 'cover', 'pre')).toBe('file_01PRE');

      // The "next boot": a driver whose deployment has moved.
      const moved = new MoveProbe({ ...sharedConfig(), fileColumnsMoved: true });
      try {
        await moved.initObjects([objectDef(T_MOVE)]);

        // ⭐ A bare id written under the moved arm reads back UNCHANGED, and
        // the bytes on disk are that same id.
        await moved.create(T_MOVE, { id: 'post', cover: 'file_01POST', label: 'a' }, OPTS);
        expect(await storedText(moved, T_MOVE, 'cover', 'post')).toBe('file_01POST');
        const back: any = await moved.findOne(T_MOVE, { where: { id: 'post' } } as DriverQuery, OPTS);
        expect(back?.cover).toBe('file_01POST');

        // …and the row the move itself converted reads the same way.
        const converted: any = await moved.findOne(T_MOVE, { where: { id: 'pre' } } as DriverQuery, OPTS);
        expect(converted?.cover).toBe('file_01PRE');
      } finally {
        await moved.disconnect().catch(() => {});
      }
    });

    it('§3b ⛔ and the UNMOVED half of the window still reads its legacy encoding', async () => {
      // The other side of "both encodings across the window": a deployment
      // that has NOT run the column step reads the JSON-quoted id it stored.
      await unmoved.create(T_UNQUOTE, { id: 'legacy', cover: 'file_01LEGACY', label: 'a' }, OPTS);
      const stored = await storedText(unmoved, T_UNQUOTE, 'cover', 'legacy');
      expect(stored, 'an unmoved deployment still stores the JSON-quoted id').toBe('"file_01LEGACY"');
      const row: any = await unmoved.findOne(T_UNQUOTE, { where: { id: 'legacy' } } as DriverQuery, OPTS);
      expect(row?.cover).toBe('file_01LEGACY');
    });

    // ── §4 the planner sees the real columns ───────────────────────────────

    it('§4 planMediaColumnMove names every single-value media column, and nothing else', async () => {
      const scan = await unmoved.planMediaColumnMove();
      expect(scan.refusals, JSON.stringify(scan.refusals)).toEqual([]);
      const named = scan.plans.map((p) => `${p.table}.${p.column}`);
      for (const table of [T_ABLATION, T_GUARD, T_MOVE, T_UNQUOTE]) {
        expect(named, table).toContain(`${table}.cover`);
      }
      // The control, in the same reading: a plain string field is NOT a media
      // column, so a planner that swept every column would be caught here.
      expect(named.some((n) => n.endsWith('.label'))).toBe(false);
      expect(named.some((n) => n.endsWith('.id'))).toBe(false);

      // …and the kind is read off the physical column, not off the dialect:
      // the tables §2/§3 already moved are now `unquote`, the untouched ones
      // are whatever this dialect's JSON arm built.
      const moveKind = scan.plans.find((p) => p.table === T_MOVE)?.kind;
      expect(moveKind).toBe('unquote');
    });
  });
}

for (const cell of DIALECT_CELLS) {
  // ⛔ MySQL has no statements here — see §5 and #17788.
  if (cell.label.toLowerCase().includes('mysql')) continue;
  declareDialectCell(cell, 'file-family column move (#15989)', measure);
}

// ── §5 the refusal, with no server ────────────────────────────────────────

describe('#15989 §5 — MySQL is refused by NAME, not attempted', () => {
  it('the step names no MySQL statement at all', () => {
    // ⛔ #17788 (`pm:on-hold`, `Restart-when: a MySQL 8.x instance is reachable
    // from the dispatch environment`) owns the MySQL leg, and owns it on a real
    // instance because the addendum leaves its statement ORDER unsettled. This
    // is what stops a later edit from "completing the matrix" by transcribing a
    // MySQL form nobody has run — the same move that produced the Postgres
    // clause this card had to overturn.
    expect(mediaColumnMoveDialect('mysql')).toBeNull();
    // The control, in the same assertion: the two dialects that ARE served.
    expect(mediaColumnMoveDialect('postgres')).toBe('postgres');
    expect(mediaColumnMoveDialect('sqlite')).toBe('sqlite');
  });
});
