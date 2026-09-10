// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15989] The file family is stored as the BARE `sys_file` id in a string
 * column — per dialect, and for BOTH encodings across the ADR-0104 window.
 *
 * Maintainer ruling on #15041, verbatim: 「15041 应该改为实际 id 保存。选A，其他
 * 同意」. The physical column for `file` / `image` / `avatar` / `video` /
 * `audio` holds the actual id, not a JSON-quoted id in a JSON column. The
 * generator already emits `VARCHAR(2048)` for the family and does not move; the
 * DRIVER is the side that moves, and it moves PER DEPLOYMENT — keyed on
 * `sys_migration.columns_moved_at`, reaching this driver as
 * `SqlDriverConfig.fileColumnsMoved`.
 *
 * ## What "across the window" means, and why every case is run twice
 *
 * During the window a moved and an unmoved deployment coexist, so there are two
 * correct behaviours at once and a suite that measured one of them would be
 * silent about the more dangerous half. Every section below therefore runs on
 * BOTH arms of the same dialect and asserts what each one stores and reads:
 *
 *   - §1 UNMOVED — the JSON arm, byte for byte what this driver has always
 *     done. This is the assertion that the change is inert on every deployment
 *     that exists today.
 *   - §2 MOVED — the ruled end-state: the id on disk is the id, in a
 *     `varchar(2048)` that matches the generator's own column.
 *   - §3 BOTH ENCODINGS on the moved arm — a legacy JSON-quoted cell left by a
 *     partial or not-yet-run column step still reads back as the id.
 *   - §4 the #15771 repair on the UNMOVED arm — MEASURED on live PG 16.13
 *     before this change: a JSON-quoted id in a generator-shaped `varchar`
 *     column read back WITH ITS QUOTES. This is the one answer the JSON arm
 *     changes, and the answer it changes it to is the id that was written.
 *   - §5 `multiple: true` media, the member the arm must NOT move.
 *
 * ## Dialect coverage, stated rather than implied
 *
 * SQLite always runs. Postgres and MySQL run when `OS_TEST_POSTGRES_URL` /
 * `OS_TEST_MYSQL_URL` are provisioned and are a NAMED SKIP otherwise —
 * `declareDialectCell` makes an unprovisioned cell visible instead of silently
 * absent, and the `Temporal Conformance (live PG + MySQL)` CI job runs this
 * package's whole suite against both servers.
 *
 * ⚠️ The dual-encoding read arm is a PG/MySQL problem and not a three-dialect
 * one, for a reason worth not rediscovering: SQLite's JSON arm already read
 * both encodings, because `formatOutput`'s `JSON.parse` is wrapped in a `catch`
 * that keeps the raw string. `file_RAWBARE` does not parse, so it survives. The
 * server dialects had no arm at all.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FILE_REFERENCE_TYPES } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const OPTS = { bypassTenantAudit: true } as any;

/** The width the SQL generator emits for the family, transcribed once. */
const GENERATOR_WIDTH = 2048;

/** `varcharColumnChars` and `isJsonField` are protected — the emitter's own judgments. */
class ArmProbe extends SqlDriver {
  asksJson(type: string, field: Record<string, unknown> = {}): boolean {
    return this.isJsonField(type, field);
  }
  varcharChars(field: Record<string, unknown>): number | null {
    return this.varcharColumnChars(field);
  }
}

const objectDef = (table: string) => ({
  name: table,
  fields: {
    cover: { type: 'image' },
    doc: { type: 'file' },
    gallery: { type: 'image', multiple: true },
    label: { type: 'string' },
  },
} as any);

/** Write a cell around the driver, so the bytes on disk are the fixture's. */
async function writeRaw(driver: SqlDriver, table: string, id: string, patch: Record<string, unknown>) {
  await (driver as any).knex(table).where('id', id).update(patch);
}

/**
 * `findOne`, with the row's absence made an ASSERTION rather than a cast.
 *
 * Every case here is about the VALUE a media column reads back, so a missing
 * row must fail as a missing row: casting the null away would let a fixture
 * that never landed report as a value that never moved.
 */
async function readField(driver: SqlDriver, table: string, id: string, field: string): Promise<unknown> {
  const row = await driver.findOne(table, { where: { id } } as any, OPTS);
  expect(row, `${table}#${id} was not found`).not.toBeNull();
  return (row as Record<string, unknown>)[field];
}

async function columnTypeOf(driver: SqlDriver, table: string, column: string) {
  const info: any = await (driver as any).knex(table).columnInfo();
  return info[column];
}

/**
 * The TEXT the server itself holds in this cell, read around every client-side
 * decode.
 *
 * ⚠️ A plain `select` is NOT this measurement on the server dialects:
 * node-postgres and mysql2 decode a native `json` column before the value
 * reaches the test, so a raw row read hands back the DECODED JS value and the
 * quotes — the very thing under test — are invisible. Casting to text on the
 * server is what makes the storage form legible on all three dialects in the
 * same shape.
 */
async function storedText(driver: SqlDriver, table: string, column: string, id: string): Promise<string> {
  const knex = (driver as any).knex;
  if ((driver as any).isSqlite) {
    const row = await knex(table).where('id', id).first();
    return String(row[column]);
  }
  const cast = (driver as any).isPostgres
    ? `"${column}"::text`
    : `cast(\`${column}\` as char)`;
  const quoted = (driver as any).isPostgres ? `"${table}"` : `\`${table}\``;
  const res: any = await knex.raw(`select ${cast} as t from ${quoted} where id = ?`, [id]);
  const rows = Array.isArray(res) ? res[0] : res.rows;
  return String(rows[0].t);
}

function measure(cell: DialectCell): void {
  const T_UNMOVED = 'os15989_unmoved';
  const T_MOVED = 'os15989_moved';

  describe(`#15989 — the file family's stored form, both arms (${cell.label})`, () => {
    let unmoved: ArmProbe;
    let moved: ArmProbe;

    beforeAll(async () => {
      // Two drivers against the SAME database, one per arm — which is exactly
      // the window's own shape: the arm is a per-deployment fact, not a build.
      unmoved = new ArmProbe(cell.config());
      await unmoved.initObjects([objectDef(T_UNMOVED)]);

      moved = new ArmProbe({ ...cell.config(), fileColumnsMoved: true });
      await moved.initObjects([objectDef(T_MOVED)]);
    });

    afterAll(async () => {
      await unmoved?.disconnect().catch(() => {});
      await moved?.disconnect().catch(() => {});
    });

    // ── §1 the UNMOVED arm is byte-for-byte today's driver ──────────────────

    it('§1 an unmoved deployment keeps the JSON column and the JSON-quoted encoding', async () => {
      expect(unmoved.asksJson('image', { type: 'image' })).toBe(true);
      expect(unmoved.asksJson('file', { type: 'file' })).toBe(true);
      // A json column has no varchar width to mirror.
      expect(unmoved.varcharChars({ type: 'image' })).toBeNull();

      await unmoved.create(T_UNMOVED, { id: 'u1', cover: 'file_01UNMOVED', label: 'a' }, OPTS);
      expect(await readField(unmoved, T_UNMOVED, 'u1', 'cover')).toBe('file_01UNMOVED');

      // …and what the SERVER holds is the JSON encoding of that id — the same
      // sentence on all three dialects, read past the client's own json decode.
      expect(await storedText(unmoved, T_UNMOVED, 'cover', 'u1')).toBe('"file_01UNMOVED"');

      // The column really is the json one on the enforcing dialects, so the
      // quoting above is the column's doing and not an incidental string.
      if (!(unmoved as any).isSqlite) {
        const col = await columnTypeOf(unmoved, T_UNMOVED, 'cover');
        expect(String(col.type).toLowerCase()).toContain('json');
      }
    });

    // ── §2 the MOVED arm is the ruled end-state ─────────────────────────────

    it('§2 a moved deployment stores the BARE id, in the generator\'s own column', async () => {
      expect(moved.asksJson('image', { type: 'image' })).toBe(false);
      expect(moved.asksJson('file', { type: 'file' })).toBe(false);
      expect(moved.varcharChars({ type: 'image' })).toBe(GENERATOR_WIDTH);

      const col = await columnTypeOf(moved, T_MOVED, 'cover');
      expect(String(col.type).toLowerCase()).not.toContain('json');
      if (!(moved as any).isSqlite) {
        // The enforcing dialects carry the width, and it is the generator's.
        expect(col.maxLength).toBe(GENERATOR_WIDTH);
      }

      await moved.create(T_MOVED, { id: 'm1', cover: 'file_01MOVED', label: 'a' }, OPTS);

      // ⭐ The reverse verification the card names: a bare id written under the
      // flag reads back UNCHANGED, and the bytes on disk are that same id.
      expect(await readField(moved, T_MOVED, 'm1', 'cover')).toBe('file_01MOVED');
      const stored = await storedText(moved, T_MOVED, 'cover', 'm1');
      expect(stored).toBe('file_01MOVED');
      expect(stored).not.toContain('"');
    });

    // ── §3 both encodings, on the moved arm ─────────────────────────────────

    it('§3 a moved deployment still reads a LEGACY JSON-quoted cell as the id', async () => {
      await moved.create(T_MOVED, { id: 'm2', cover: 'file_placeholder', label: 'a' }, OPTS);
      // The cell a column step has not converted yet — or one an older driver
      // wrote after the retype. Written around the driver on purpose.
      await writeRaw(moved, T_MOVED, 'm2', { cover: '"file_01LEGACY"' });
      expect(await storedText(moved, T_MOVED, 'cover', 'm2')).toBe('"file_01LEGACY"');

      expect(await readField(moved, T_MOVED, 'm2', 'cover')).toBe('file_01LEGACY');

      // The other encoding in the same run, so the pin discriminates rather
      // than unquoting everything it is handed.
      await writeRaw(moved, T_MOVED, 'm2', { cover: 'file_01BARE' });
      expect(await readField(moved, T_MOVED, 'm2', 'cover')).toBe('file_01BARE');
    });

    it('§3b the repair cannot eat an id, a URL or an unparseable cell', async () => {
      await moved.create(T_MOVED, { id: 'm3', cover: 'file_x', label: 'a' }, OPTS);
      // ⛔ Anti-vacuity for the delimiter test in `formatOutput`. An all-digit
      // id would `JSON.parse` to a NUMBER and `null`/`true` to non-strings, so
      // "try parsing every string" is the version of this repair that corrupts
      // data. None of these begins with `"`, `{` or `[`, so none is touched.
      for (const value of ['12345', 'null', 'true', 'false', 'https://cdn/x.png', '/api/v1/files/f_1']) {
        await writeRaw(moved, T_MOVED, 'm3', { cover: value });
        const back = await readField(moved, T_MOVED, 'm3', 'cover');
        expect(back, value).toBe(value);
        expect(typeof back, value).toBe('string');
      }
      // A cell that DOES begin with a delimiter but is not JSON keeps its raw
      // string — the same posture the SQLite json arm has always taken.
      await writeRaw(moved, T_MOVED, 'm3', { cover: '"unterminated' });
      expect(await readField(moved, T_MOVED, 'm3', 'cover')).toBe('"unterminated');
    });

    // ── §4 the #15771 repair, on the UNMOVED arm ────────────────────────────

    it('§4 an unmoved deployment on a generator-shaped varchar column reads the id, not its quotes', async () => {
      // The population: a database built by `os generate migration --format
      // sql` (which emits VARCHAR(2048) for the family) and served by a driver
      // still on the JSON arm. Reproduced here by pointing the UNMOVED driver
      // at the table the MOVED one created — the additive sync never retypes a
      // column, so the varchar survives and the writer stays on the JSON arm.
      await unmoved.initObjects([objectDef(T_MOVED)]);
      expect(unmoved.asksJson('image', { type: 'image' })).toBe(true);
      const col = await columnTypeOf(unmoved, T_MOVED, 'cover');
      expect(String(col.type).toLowerCase()).not.toContain('json');

      await unmoved.create(T_MOVED, { id: 'x1', cover: 'file_01CORRUPT', label: 'a' }, OPTS);

      // The WRITE is unchanged — the JSON arm still quotes, which is what makes
      // this a read repair rather than a second, undeclared encoding flip.
      expect(await storedText(unmoved, T_MOVED, 'cover', 'x1')).toBe('"file_01CORRUPT"');

      // MEASURED on live PG 16.13 before this change: this answered
      // `"file_01CORRUPT"`, quotes included.
      expect(await readField(unmoved, T_MOVED, 'x1', 'cover')).toBe('file_01CORRUPT');
    });

    // ── §5 the member the arm must not move ─────────────────────────────────

    it('§5 `multiple: true` media is a json column on BOTH arms', async () => {
      for (const driver of [unmoved, moved]) {
        expect(driver.asksJson('image', { type: 'image', multiple: true })).toBe(true);
        expect(driver.varcharChars({ type: 'image', multiple: true })).toBeNull();
      }
      await moved.create(T_MOVED, { id: 'm5', gallery: ['file_a', 'file_b'], label: 'a' }, OPTS);
      expect(await readField(moved, T_MOVED, 'm5', 'gallery')).toEqual(['file_a', 'file_b']);

      await unmoved.create(T_UNMOVED, { id: 'u5', gallery: ['file_a', 'file_b'], label: 'a' }, OPTS);
      expect(await readField(unmoved, T_UNMOVED, 'u5', 'gallery')).toEqual(['file_a', 'file_b']);
    });

    // ── §6 the whole family, not just the two the fixture names ─────────────

    it('§6 every member of the family moves together, and nothing else moves at all', () => {
      expect(FILE_REFERENCE_TYPES.size).toBe(5);
      for (const type of FILE_REFERENCE_TYPES) {
        expect(unmoved.asksJson(type, { type }), type).toBe(true);
        expect(moved.asksJson(type, { type }), type).toBe(false);
        expect(unmoved.varcharChars({ type }), type).toBeNull();
        expect(moved.varcharChars({ type }), type).toBe(GENERATOR_WIDTH);
      }
      // The neighbours the arm must leave alone, in the same run.
      for (const type of ['json', 'location', 'record', 'multiselect']) {
        expect(unmoved.asksJson(type, { type }), type).toBe(true);
        expect(moved.asksJson(type, { type }), type).toBe(true);
      }
      for (const type of ['string', 'integer', 'lookup']) {
        expect(unmoved.asksJson(type, { type }), type).toBe(false);
        expect(moved.asksJson(type, { type }), type).toBe(false);
      }
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'file-family bare id (#15989)', measure);
}
