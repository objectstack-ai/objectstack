// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11794 — `richtext` joins its declared "Rich Content" siblings in the TEXT
 * family, taking an unbounded column instead of knex's varchar(255).
 *
 * ## The defect
 *
 * `createColumn`'s text-family case listed `text` / `textarea` / `html` /
 * `markdown`. `richtext` — the third member of the spec's own "Rich Content"
 * grouping (`field.zod.ts`) — was not in it, and not in `JSON_COLUMN_TYPES`
 * either, so it fell through to the catch-all's `table.string(name)`:
 * varchar(255). That width is a hard cap on both enforcing dialects, so an
 * ordinary rich-text body over 255 characters was REFUSED at write time
 * (measured at 1000 characters on live MySQL 8.0.46 — `ER_DATA_TOO_LONG`
 * under `STRICT_TRANS_TABLES` — and Postgres 16 — `22001`) while the same
 * body in a `markdown` field on the same table was accepted.
 *
 * ## Which types moved, and the test that decided it
 *
 * `code` moved with `richtext`. `signature` and `qrcode` did NOT, and that is
 * the load-bearing half of this file rather than an omission.
 *
 * An unbounded TEXT column is correct for a type exactly when the WRITE SEAM
 * enforces that type's declared `maxLength` — the invariant `schema-drift.ts`
 * already states ("A TEXT column refuses nothing a `maxLength` allows … the
 * bound is enforced at the write seam"). objectql's record-validator applies
 * its `max_length` branch to `text` / `textarea` / `email` / `url` / `phone` /
 * `password` / `markdown` / `html` / `richtext` / `code` — and to no other
 * type. Measured: a `maxLength: 64` field of each of those refuses a
 * 100-character value; the same field declared `signature` or `qrcode`
 * ACCEPTS it. So for those two an unbounded column would accept values the
 * declaration forbids — a physical surface WIDER than the contract, where
 * `richtext` and `code` are a restoration of it. Their own defect (a data-URI
 * signature capped at 255) is real and is asserted here as an open one, so
 * this file records the state rather than hiding it.
 *
 * ## What each block is worth
 *
 * The SQLite blocks run everywhere (Test Core included) and read the PHYSICAL
 * column type back from the PRAGMA (`columnInfo()`), never the emitter. The
 * live cells are the enforcing half: the same table on a real MySQL /
 * Postgres, column types read from information_schema, a 1000-character body
 * accepted and round-tripped — made non-vacuous by the control write, where
 * the SAME oversized value into a column this change deliberately left at
 * varchar(255) is refused BY THE SERVER, proving the cell enforces declared
 * widths in this very run.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FieldType } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';
import { MYSQL_CELL, PG_CELL, dialectCell, declareDialectCell } from './live-dialect-matrix.testkit.js';

const T = 'os11794_text_family';

/** The two this card moves, their siblings, and the stay-put controls. */
const FIELDS = {
  // Moved by #11794: varchar(255) → TEXT.
  body_rich: { type: 'richtext' },
  body_code: { type: 'code' },
  // Positive controls: TEXT before and after this change — the grouping was
  // already honoured for two of the three Rich Content members.
  body_md: { type: 'markdown' },
  body_html: { type: 'html' },
  // Measured and deliberately NOT moved: no write seam enforces their
  // `maxLength`, so TEXT would accept what the declaration forbids.
  body_sig: { type: 'signature' },
  body_qr: { type: 'qrcode' },
  // Negative controls: the catch-all and the string family.
  c_string: { type: 'string' },
  c_select: { type: 'select' },
  c_color: { type: 'color' },
  c_secret: { type: 'secret' },
};

const OPTS = { bypassTenantAudit: true } as any;

/** A rich-text body nobody would call exotic — four times the old cap. */
const LONG_BODY = `<p>${'a rich-text body well past the old varchar(255) cap — '.repeat(20)}</p>`;

const MOVED = ['body_rich', 'body_code'] as const;
const SIBLINGS = ['body_md', 'body_html'] as const;
const NOT_MOVED = ['body_sig', 'body_qr', 'c_string', 'c_select', 'c_color', 'c_secret'] as const;

/**
 * Every FieldType that takes an UNBOUNDED column when no index keys it —
 * pinned as a SET rather than left to the switch.
 *
 * The root cause this card names is that the case list is hand-maintained, so
 * one member of a three-member spec group diverged from the other two without
 * anything going red. A membership pin is what makes that impossible: adding a
 * type to `createColumn`'s text family, or to `JSON_COLUMN_TYPES`, fails here
 * until someone states the new membership on purpose.
 */
const UNBOUNDED_UNKEYED = [
  // text family (`createColumn`) — every member must satisfy the write-seam
  // invariant in this file's header.
  'text', 'textarea', 'html', 'markdown', 'richtext', 'code',
  // JSON columns and the virtual/non-varchar types: not a varchar either, for
  // reasons that have nothing to do with this card.
  'multiselect', 'checkboxes', 'tags', 'composite', 'repeater', 'record', 'json',
  'location', 'address', 'vector', 'image', 'file', 'avatar', 'video', 'audio',
  'formula', 'number', 'currency', 'percent', 'rating', 'slider', 'progress',
  'summary', 'boolean', 'toggle', 'date', 'datetime', 'time',
].sort();

/** TEXT and not any varchar — `longtext`/`mediumtext` would satisfy it too. */
const isTexty = (t: unknown) => /text/i.test(String(t)) && !/varchar/i.test(String(t));

type ColumnInfo = Record<string, { type?: string; maxLength?: number | string }>;

describe('richtext joins the TEXT family (#11794) — physical shape on SQLite', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  it('lands richtext/code as TEXT beside markdown/html — and moves nothing else', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([{ name: T, fields: FIELDS }]);
    // The PRAGMA, not the emitter: knex's columnInfo() reads table_info.
    const info: ColumnInfo = await (driver as any).knex(T).columnInfo();

    for (const moved of MOVED) {
      expect(isTexty(info[moved]?.type), `${moved} landed ${String(info[moved]?.type)}`).toBe(true);
    }
    for (const sibling of SIBLINGS) {
      expect(isTexty(info[sibling]?.type), `${sibling} landed ${String(info[sibling]?.type)}`).toBe(
        true,
      );
    }
    for (const still of NOT_MOVED) {
      expect(
        /varchar/i.test(String(info[still]?.type)),
        `${still} landed ${String(info[still]?.type)}`,
      ).toBe(true);
      expect(Number(info[still]?.maxLength)).toBe(255);
    }
  });

  it('round-trips a >255-character richtext body byte-identically', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([{ name: T, fields: FIELDS }]);
    expect(LONG_BODY.length).toBeGreaterThan(255);
    await driver.create(T, { id: 'r1', body_rich: LONG_BODY, body_md: LONG_BODY }, OPTS);
    const [row] = await driver.find(T, { where: { id: 'r1' } }, OPTS);
    expect(row.body_rich).toBe(LONG_BODY);
    expect(row.body_md).toBe(LONG_BODY); // the sibling that always worked
  });

  it('pins the whole unbounded-when-unkeyed SET, so the case list cannot drift again', () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    const mirror = (type: string) =>
      (driver as any).varcharColumnChars({ type }, undefined) as number | null;
    const types = FieldType.options as readonly string[];
    expect(types.length).toBeGreaterThan(40); // the registry really was read
    const unbounded = types.filter((t) => mirror(t) === null).sort();
    expect(unbounded.length).toBeGreaterThan(20); // and the filter really matched
    expect(unbounded).toEqual(UNBOUNDED_UNKEYED);
    // The card's minimum, spelled out: the spec's three-member "Rich Content"
    // group is whole again.
    for (const t of ['markdown', 'html', 'richtext']) expect(mirror(t)).toBeNull();
    // And the two that measured as wideners stay bounded.
    for (const t of ['signature', 'qrcode']) expect(mirror(t)).toBe(255);
  });

  it('keeps #11374 keyed-and-bounded semantics for the new members', () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    const mirror = (field: any, keyed?: { unique: boolean }) =>
      (driver as any).varcharColumnChars(field, keyed) as number | null;
    // Unkeyed: TEXT, bound or not — a column no index keys on gains nothing
    // from a width.
    expect(mirror({ type: 'richtext' })).toBeNull();
    expect(mirror({ type: 'code', maxLength: 64 })).toBeNull();
    // Keyed and bounded: varchar(maxLength) — the #11374 rule, so a declared
    // index on a bounded code field still keys on MySQL.
    expect(mirror({ type: 'code', maxLength: 64 }, { unique: true })).toBe(64);
    // Keyed and unbounded: still TEXT — MySQL then refuses the key BY NAME
    // (explainUnkeyableTextColumn), never a silently weaker constraint.
    expect(mirror({ type: 'richtext' }, { unique: true })).toBeNull();
  });
});

// ── The half only an enforcing dialect can measure ──────────────────────────

for (const liveCell of [PG_CELL, MYSQL_CELL]) {
  declareDialectCell(liveCell, 'richtext TEXT family (#11794)', (cell) => {
    describe(`richtext TEXT family on live ${cell.label} (#11794)`, () => {
      let driver: SqlDriver;

      afterEach(async () => {
        await driver?.execute(`drop table if exists ${T}`).catch(() => {});
        await driver?.disconnect().catch(() => {});
      });

      it('accepts a >255-char richtext body, and the column really is TEXT (information_schema)', async () => {
        driver = new SqlDriver(cell.config());
        await driver.execute(`drop table if exists ${T}`).catch(() => {});
        await driver.initObjects([{ name: T, fields: FIELDS }]);

        // information_schema.columns, not the emitter: that is what knex's
        // columnInfo() reads on both of these dialects.
        const info: ColumnInfo = await (driver as any).knex(T).columnInfo();
        for (const moved of MOVED) {
          expect(isTexty(info[moved]?.type), `${moved} landed ${String(info[moved]?.type)}`).toBe(
            true,
          );
        }
        for (const still of NOT_MOVED) {
          expect(
            /varchar|character varying/i.test(String(info[still]?.type)),
            `${still} landed ${String(info[still]?.type)}`,
          ).toBe(true);
          expect(Number(info[still]?.maxLength)).toBe(255);
        }

        // The write this card is about: refused before this change
        // (ER_DATA_TOO_LONG / 22001), accepted now, byte-identical back.
        await driver.create(
          T,
          { id: 'r1', body_rich: LONG_BODY, body_code: LONG_BODY, body_md: LONG_BODY },
          OPTS,
        );
        const [row] = await driver.find(T, { where: { id: 'r1' } }, OPTS);
        expect(row.body_rich).toBe(LONG_BODY);
        expect(row.body_code).toBe(LONG_BODY);

        // Non-vacuity control: the SAME oversized value into a column this
        // change deliberately left at varchar(255) is refused BY THE SERVER.
        // Without this, a mis-provisioned lenient session (MySQL without
        // STRICT_TRANS_TABLES) would pass the acceptance above while
        // measuring nothing.
        const refusal = await driver
          .create(T, { id: 'r2', c_color: LONG_BODY }, OPTS)
          .then(() => null)
          .catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(Error);
        const said = `${String((refusal as { code?: string })?.code ?? '')} ${String((refusal as Error).message)}`;
        expect(said).toMatch(/ER_DATA_TOO_LONG|22001|too long/i);
      });

      it('records the STILL-OPEN half: an oversized signature is refused by the server', async () => {
        // ⛔ Not a wish and not a quarantine — the current, deliberate state.
        // `signature` stays varchar(255) because nothing enforces its declared
        // `maxLength` at the write seam, so TEXT would accept what the
        // declaration forbids. This asserts the cost of that choice out loud:
        // a data-URI signature IS refused today. When the write seam gains a
        // bound for it, this test is what turns red and gets updated.
        driver = new SqlDriver(cell.config());
        await driver.execute(`drop table if exists ${T}`).catch(() => {});
        await driver.initObjects([{ name: T, fields: FIELDS }]);
        const dataUri = `data:image/png;base64,${'A'.repeat(1000)}`;
        const refusal = await driver
          .create(T, { id: 's1', body_sig: dataUri }, OPTS)
          .then(() => null)
          .catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(Error);
        const said = `${String((refusal as { code?: string })?.code ?? '')} ${String((refusal as Error).message)}`;
        expect(said).toMatch(/ER_DATA_TOO_LONG|22001|too long/i);
      });
    });
  });
}
