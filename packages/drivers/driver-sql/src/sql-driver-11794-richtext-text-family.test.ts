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
 * (MySQL `ER_DATA_TOO_LONG` under `STRICT_TRANS_TABLES`, Postgres `22001`)
 * while the same body in a `markdown` field on the same table was accepted.
 *
 * `code` / `signature` / `qrcode` moved with it — measured, not by analogy:
 * each is a `STRING_VALUE_TYPES` member storing the author's own value as an
 * unbounded plain string (field-zoo writes a data-URI PNG for `signature`
 * and the editor's contents for `code`; neither fits in 255 characters).
 *
 * ## What each block is worth
 *
 * The SQLite block runs everywhere (Test Core included) and reads the
 * PHYSICAL column type back from the PRAGMA (`columnInfo()`), never the
 * emitter: the four moved types land TEXT; the `markdown` / `html` positive
 * controls were TEXT before this change and stay TEXT (the grouping was
 * already honoured for two of three); and the catch-all / string-family
 * controls (`string` / `select` / `color` / `secret`) stay varchar(255) —
 * together proving the change moved exactly what it claims and nothing else.
 *
 * The live cells are the enforcing half: the same table on a real MySQL /
 * Postgres, the column type read back from information_schema, a
 * 1000-character body accepted and round-tripped — made non-vacuous by the
 * control write, where the SAME oversized value into a column this change
 * deliberately left at varchar(255) is refused BY THE SERVER, proving the
 * cell enforces declared widths in this very run.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { MYSQL_CELL, PG_CELL, dialectCell, declareDialectCell } from './live-dialect-matrix.testkit.js';

const T = 'os11794_text_family';

/** The moved four, their two already-TEXT siblings, and the stay-put controls. */
const FIELDS = {
  // Moved by #11794: varchar(255) → TEXT.
  body_rich: { type: 'richtext' },
  body_code: { type: 'code' },
  body_sig: { type: 'signature' },
  body_qr: { type: 'qrcode' },
  // Positive controls: TEXT before and after this change.
  body_md: { type: 'markdown' },
  body_html: { type: 'html' },
  // Negative controls: deliberately NOT moved (see createColumn's catch-all
  // note — `secret` stores an opaque ref, `color` a color code, and the
  // string family sizes from its own declaration).
  c_string: { type: 'string' },
  c_select: { type: 'select' },
  c_color: { type: 'color' },
  c_secret: { type: 'secret' },
};

const OPTS = { bypassTenantAudit: true } as any;

/** A rich-text body nobody would call exotic — four times the old cap. */
const LONG_BODY = `<p>${'a rich-text body well past the old varchar(255) cap — '.repeat(20)}</p>`;

const MOVED = ['body_rich', 'body_code', 'body_sig', 'body_qr'] as const;
const SIBLINGS = ['body_md', 'body_html'] as const;
const CONTROLS = ['c_string', 'c_select', 'c_color', 'c_secret'] as const;

/** TEXT and not any varchar — `longtext`/`mediumtext` would satisfy it too. */
const isTexty = (t: unknown) => /text/i.test(String(t)) && !/varchar/i.test(String(t));

type ColumnInfo = Record<string, { type?: string; maxLength?: number | string }>;

describe('richtext joins the TEXT family (#11794) — physical shape on SQLite', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  it('lands richtext/code/signature/qrcode as TEXT beside markdown/html — and moves nothing else', async () => {
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
    for (const still of CONTROLS) {
      expect(/varchar/i.test(String(info[still]?.type)), `${still} landed ${String(info[still]?.type)}`).toBe(true);
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

  it('keeps #11374 keyed-and-bounded semantics for the new members', () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    const mirror = (field: any, keyed?: { unique: boolean }) =>
      (driver as any).varcharColumnChars(field, keyed) as number | null;
    // Unkeyed: TEXT, bound or not — a column no index keys on gains nothing
    // from a width.
    expect(mirror({ type: 'richtext' })).toBeNull();
    expect(mirror({ type: 'qrcode', maxLength: 64 })).toBeNull();
    // Keyed and bounded: varchar(maxLength) — the #11374 rule, so a declared
    // index on a bounded barcode still keys on MySQL.
    expect(mirror({ type: 'qrcode', maxLength: 64 }, { unique: true })).toBe(64);
    // Keyed and unbounded: still TEXT — MySQL then refuses the key BY NAME
    // (explainUnkeyableTextColumn), never a silently weaker constraint.
    expect(mirror({ type: 'signature' }, { unique: true })).toBeNull();
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
        for (const still of CONTROLS) {
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
          {
            id: 'r1',
            body_rich: LONG_BODY,
            body_code: LONG_BODY,
            body_sig: `data:image/png;base64,${'A'.repeat(1000)}`,
            body_md: LONG_BODY,
          },
          OPTS,
        );
        const [row] = await driver.find(T, { where: { id: 'r1' } }, OPTS);
        expect(row.body_rich).toBe(LONG_BODY);
        expect(String(row.body_sig).length).toBeGreaterThan(1000);

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
    });
  });
}
