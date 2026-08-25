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
 * `code` moved with `richtext`. `signature` and `qrcode` did NOT move in
 * #11794, and this file asserted that half out loud as an OPEN defect.
 *
 * An unbounded TEXT column is correct for a type exactly when the WRITE SEAM
 * enforces that type's declared `maxLength` — the invariant `schema-drift.ts`
 * already states ("A TEXT column refuses nothing a `maxLength` allows … the
 * bound is enforced at the write seam"). At #11794 objectql's record-validator
 * applied its `max_length` branch to `text` / `textarea` / `email` / `url` /
 * `phone` / `password` / `markdown` / `html` / `richtext` / `code` — and to no
 * other type — so for `signature` / `qrcode` an unbounded column would have
 * accepted values the declaration forbids: a physical surface WIDER than the
 * contract, where `richtext` and `code` were a restoration of it.
 *
 * ## #11875 closed that half (maintainer ruling 2026-08-25, option 1)
 *
 * `signature` and `qrcode` joined the spec's BOUNDED_STRING_FIELD_TYPES, the
 * authoring seam admits `maxLength` on them, and the record-validator's
 * `max_length` branch reads that same set — so the write seam now enforces
 * their declared bound and the invariant above licenses their TEXT column.
 * The former "STILL-OPEN half" cases below are the same measurements in their
 * CLOSED shape: the data-URI that was refused `22001` / `ER_DATA_TOO_LONG` at
 * varchar(255) is accepted and round-trips byte-identically, and the #11374
 * keyed-and-bounded rule applies to them the way it applies to every other
 * text-family member (keyed + bounded ⇒ varchar(maxLength), physically
 * enforced at exactly the declared bound; otherwise TEXT, bound enforced at
 * the write seam).
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

/** The types the two cards move, their siblings, and the stay-put controls. */
const FIELDS = {
  // Moved by #11794: varchar(255) → TEXT.
  body_rich: { type: 'richtext' },
  body_code: { type: 'code' },
  // Positive controls: TEXT before and after this change — the grouping was
  // already honoured for two of the three Rich Content members.
  body_md: { type: 'markdown' },
  body_html: { type: 'html' },
  // Moved by #11875, once the write seam gained their declared bound
  // (BOUNDED_STRING_FIELD_TYPES): varchar(255) → TEXT.
  body_sig: { type: 'signature' },
  body_qr: { type: 'qrcode' },
  // Negative controls: the catch-all and the string family. `color` and
  // `secret` are the #11875 ruling's explicit carve-outs (short by
  // construction; opaque `sys_secret` ref per ADR-0100).
  c_string: { type: 'string' },
  c_select: { type: 'select' },
  c_color: { type: 'color' },
  c_secret: { type: 'secret' },
};

const OPTS = { bypassTenantAudit: true } as any;

/** A rich-text body nobody would call exotic — four times the old cap. */
const LONG_BODY = `<p>${'a rich-text body well past the old varchar(255) cap — '.repeat(20)}</p>`;

/** The value the #11875 half is about: an ordinary data-URI signature. */
const DATA_URI = `data:image/png;base64,${'A'.repeat(1000)}`;

const MOVED = ['body_rich', 'body_code'] as const;
const SIBLINGS = ['body_md', 'body_html'] as const;
const MOVED_11875 = ['body_sig', 'body_qr'] as const;
const NOT_MOVED = ['c_string', 'c_select', 'c_color', 'c_secret'] as const;

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
  // invariant in this file's header. `signature`/`qrcode` joined at #11875,
  // when the write seam gained their declared bound.
  'text', 'textarea', 'html', 'markdown', 'richtext', 'code',
  'signature', 'qrcode',
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

  it('lands richtext/code and signature/qrcode as TEXT beside markdown/html — and moves nothing else', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([{ name: T, fields: FIELDS }]);
    // The PRAGMA, not the emitter: knex's columnInfo() reads table_info.
    const info: ColumnInfo = await (driver as any).knex(T).columnInfo();

    for (const moved of [...MOVED, ...MOVED_11875]) {
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

  it('round-trips a >255-character data-URI signature/qrcode byte-identically (#11875)', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([{ name: T, fields: FIELDS }]);
    expect(DATA_URI.length).toBeGreaterThan(255);
    await driver.create(T, { id: 's1', body_sig: DATA_URI, body_qr: DATA_URI }, OPTS);
    const [row] = await driver.find(T, { where: { id: 's1' } }, OPTS);
    expect(row.body_sig).toBe(DATA_URI);
    expect(row.body_qr).toBe(DATA_URI);
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
    // #11875: the two former wideners moved once the write seam gained their
    // bound — TEXT when unkeyed, like every other text-family member.
    for (const t of ['signature', 'qrcode']) expect(mirror(t)).toBeNull();
    // The ruling's explicit carve-outs stay bounded in the catch-all.
    for (const t of ['color', 'secret']) expect(mirror(t)).toBe(255);
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
    // #11875: the same four corners for the two new members. The declared
    // bound's ENFORCEMENT never depends on the index — the write seam holds it
    // in every corner — the index only decides whether the COLUMN also
    // enforces it (varchar(n) keyed, TEXT otherwise), exactly as for `code`.
    for (const type of ['signature', 'qrcode']) {
      expect(mirror({ type })).toBeNull();
      expect(mirror({ type, maxLength: 64 })).toBeNull();
      expect(mirror({ type, maxLength: 64 }, { unique: true })).toBe(64);
      expect(mirror({ type }, { unique: true })).toBeNull();
    }
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
        for (const moved of [...MOVED, ...MOVED_11875]) {
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

      it('closes the formerly-open half (#11875): an oversized data-URI signature/qrcode is accepted and round-trips', async () => {
        // The #11794 version of this case asserted the COST of leaving
        // `signature`/`qrcode` at varchar(255) out loud: the data-URI below
        // was refused BY THE SERVER (`ER_DATA_TOO_LONG` / `22001`). The write
        // seam has since gained their declared bound (#11875,
        // BOUNDED_STRING_FIELD_TYPES), the column is TEXT, and the same value
        // is accepted — this is that red turned green, not a deleted control.
        // Non-vacuity for this cell is carried by the c_color refusal in the
        // test above: the same session refuses an oversized write into a
        // column that stayed varchar(255).
        driver = new SqlDriver(cell.config());
        await driver.execute(`drop table if exists ${T}`).catch(() => {});
        await driver.initObjects([{ name: T, fields: FIELDS }]);
        await driver.create(T, { id: 's1', body_sig: DATA_URI, body_qr: DATA_URI }, OPTS);
        const [row] = await driver.find(T, { where: { id: 's1' } }, OPTS);
        expect(row.body_sig).toBe(DATA_URI);
        expect(row.body_qr).toBe(DATA_URI);
      });

      it('keeps #11374 keyed-and-bounded semantics live for the new members (#11875)', async () => {
        // A KEYED bounded signature/qrcode column is varchar(maxLength) — the
        // physical catalog says so — and the server enforces EXACTLY the
        // declared bound: the boundary value fits, one past it is refused.
        // The declared bound's enforcement therefore never diverges by shape:
        // unkeyed columns are TEXT with the same bound enforced at the write
        // seam (record-validator, pinned in objectql), keyed columns enforce
        // it physically too. Both directions measured, boundary included.
        const KT = `${T}_keyed`;
        // Hoisted (not an inline literal) the way #11374's `boundedObject()`
        // is: `indexes` rides through `initObjects` beyond its narrow
        // parameter type, exactly as the platform objects declare it.
        const keyedObject = {
          name: KT,
          fields: {
            sig: { type: 'signature', maxLength: 64 },
            qr: { type: 'qrcode', maxLength: 64 },
          },
          indexes: [
            { fields: ['sig'], unique: true },
            { fields: ['qr'], unique: false },
          ],
        };
        driver = new SqlDriver(cell.config());
        await driver.execute(`drop table if exists ${KT}`).catch(() => {});
        await driver.initObjects([keyedObject]);
        const info: ColumnInfo = await (driver as any).knex(KT).columnInfo();
        for (const col of ['sig', 'qr']) {
          expect(
            /varchar|character varying/i.test(String(info[col]?.type)),
            `${col} landed ${String(info[col]?.type)}`,
          ).toBe(true);
          expect(Number(info[col]?.maxLength)).toBe(64);
        }
        // Boundary value: exactly maxLength characters is ACCEPTED.
        await driver.create(KT, { id: 'b1', sig: 'x'.repeat(64), qr: 'y'.repeat(64) }, OPTS);
        const [row] = await driver.find(KT, { where: { id: 'b1' } }, OPTS);
        expect(row.sig).toBe('x'.repeat(64));
        // One past the boundary: refused by the SERVER at the declared bound.
        const refusal = await driver
          .create(KT, { id: 'b2', qr: 'y'.repeat(65) }, OPTS)
          .then(() => null)
          .catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(Error);
        const said = `${String((refusal as { code?: string })?.code ?? '')} ${String((refusal as Error).message)}`;
        expect(said).toMatch(/ER_DATA_TOO_LONG|22001|too long/i);
        await driver.execute(`drop table if exists ${KT}`).catch(() => {});
      });
    });
  });
}
