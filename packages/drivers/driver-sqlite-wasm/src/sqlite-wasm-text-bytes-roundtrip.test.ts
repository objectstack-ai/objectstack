// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19978] A text value round-trips through `SqliteWasmDriver` byte-for-byte —
 * an embedded U+0000 and a leading U+FEFF included — the way it does through
 * `SqlDriver` on better-sqlite3.
 *
 * Before the fix, sql.js lost bytes at two separate seams (measured, sql.js
 * 1.14.1): its text BIND cut a value at its first U+0000 (`'a'` + U+0000 +
 * `'b'` stored as the one byte `61`), and its text READ both stopped at a
 * stored NUL byte and dropped a leading U+FEFF. Neither raised. The mechanism
 * and the fix are documented in `sqljs-exact-text.ts`.
 *
 * Each seam is pinned on its own, because one can hide the other:
 *
 * - the WRITE is judged on `hex(v)` — ASCII, so the read decode under test
 *   cannot repair or mask what was stored;
 * - the READ is judged on cells planted by a SQL literal (`cast(x'…' as text)`),
 *   so no bind is involved — the shape of a database file a native SQLite wrote
 *   and this driver then opens;
 * - the round trip and the filters are judged through the public driver doors.
 *
 * Every expected value is the value written, and every expected hex is the
 * written string's own UTF-8 — the standard better-sqlite3 was measured to meet
 * on every case below.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions } from '@objectstack/spec/data';
import { SqliteWasmDriver } from './index.js';
import { exactTextBindings, readExactRow } from './sqljs-exact-text.js';

const NUL = String.fromCharCode(0x00);
const BOM = String.fromCharCode(0xfeff);

const BYPASS: DriverOptions = { bypassTenantAudit: true };
const TABLE = 'text_bytes_roundtrip';

/** label → the exact string written. `plain` is the control that always worked. */
const CASES: Readonly<Record<string, string>> = {
  nul_mid: 'a' + NUL + 'b',
  nul_trail: 'ab' + NUL,
  bom_lead: BOM + 'hello',
  bom_mid: 'he' + BOM + 'llo',
  // Longer than 16 bytes: sql.js's debug build decodes short strings by hand
  // and only longer ones through its BOM-stripping TextDecoder.
  bom_lead_long: BOM + 'a value longer than sixteen bytes',
  plain: 'plain',
};

const utf8Hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

describe('[#19978] driver-sqlite-wasm — text values round-trip byte-for-byte', () => {
  let driver: SqliteWasmDriver;

  const storedHex = async (label: string) => {
    const rows = (await driver.execute(`select hex(v) as h from ${TABLE} where label = ?`, [
      label,
    ])) as Array<{ h: string }>;
    expect(rows, `one stored row for ${label}`).toHaveLength(1);
    return rows[0].h;
  };

  const labelsWhere = async (where: Record<string, unknown>) => {
    const rows = (await driver.find(TABLE, { where } as any, BYPASS)) as Array<{ label: string }>;
    return rows.map((r) => r.label).sort();
  };

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: TABLE, fields: { label: { type: 'string' }, v: { type: 'text' } } },
    ]);
    for (const [label, v] of Object.entries(CASES)) {
      await driver.create(TABLE, { label, v }, BYPASS);
    }
  }, 60_000);

  afterAll(async () => {
    await driver.disconnect();
  });

  describe('create → findOne', () => {
    for (const [label, wrote] of Object.entries(CASES)) {
      it(`${label}: the stored bytes are the written string's UTF-8`, async () => {
        expect(await storedHex(label)).toBe(utf8Hex(wrote));
      });

      it(`${label}: reads back as the string written`, async () => {
        const row = (await driver.findOne(TABLE, { where: { label } } as any, BYPASS)) as {
          v: unknown;
        } | null;
        expect(typeof row?.v).toBe('string');
        expect(row?.v).toStrictEqual(wrote);
      });
    }
  });

  describe('update', () => {
    it('an update to a value holding U+0000 and a leading U+FEFF stores and reads it whole', async () => {
      const wrote = BOM + 'x' + NUL + 'y' + NUL;
      await driver.create(TABLE, { label: 'upd', v: 'before' }, BYPASS);
      const [{ id }] = (await driver.find(TABLE, { where: { label: 'upd' } } as any, BYPASS)) as Array<{
        id: string;
      }>;
      // Removed whatever the verdict: a row left behind would answer the
      // filter pins below and fail them for a reason that is not theirs.
      try {
        const returned = (await driver.update(TABLE, id, { v: wrote }, BYPASS)) as { v: unknown };
        expect(returned.v).toStrictEqual(wrote);
        expect(await storedHex('upd')).toBe(utf8Hex(wrote));
        const read = (await driver.findOne(TABLE, { where: { label: 'upd' } } as any, BYPASS)) as {
          v: unknown;
        };
        expect(read.v).toStrictEqual(wrote);
      } finally {
        await driver.delete(TABLE, id, BYPASS);
      }
    });
  });

  describe('filters on the value', () => {
    for (const [label, wrote] of Object.entries(CASES)) {
      it(`equality on ${label}'s exact value selects that row and no other`, async () => {
        expect(await labelsWhere({ v: wrote })).toEqual([label]);
      });
    }

    it('equality on a NUL-bearing value does not match its prefix — the stored value is whole', async () => {
      // Before the fix the stored `nul_mid` was `a`, and a comparand bound
      // through the same truncating bind was `a` too — so this read matched.
      expect(await labelsWhere({ v: 'a' })).toEqual([]);
    });

    it('$in places each NUL-bearing comparand at its own placeholder', async () => {
      expect(await labelsWhere({ v: { $in: ['plain', CASES.nul_trail, CASES.nul_mid] } })).toEqual([
        'nul_mid',
        'nul_trail',
        'plain',
      ]);
    });

    it('$contains U+FEFF selects every row holding one, and reads each back whole', async () => {
      const rows = (await driver.find(TABLE, { where: { v: { $contains: BOM } } } as any, BYPASS)) as Array<{
        label: string;
        v: string;
      }>;
      expect(rows.map((r) => r.label).sort()).toEqual(['bom_lead', 'bom_lead_long', 'bom_mid']);
      for (const r of rows) expect(r.v).toStrictEqual(CASES[r.label]);
    });

    it('$startsWith U+FEFF selects exactly the rows that begin with one', async () => {
      expect(await labelsWhere({ v: { $startsWith: BOM } })).toEqual(['bom_lead', 'bom_lead_long']);
    });
  });

  describe('the read seam alone — cells no bind ever touched', () => {
    const PLANTED: Readonly<Record<string, { hex: string; reads: string }>> = {
      planted_nul: { hex: '610062', reads: 'a' + NUL + 'b' },
      planted_bom: { hex: 'EFBBBF78', reads: BOM + 'x' },
      planted_bom_long: {
        hex: 'EFBBBF' + utf8Hex('a value longer than sixteen bytes'),
        reads: BOM + 'a value longer than sixteen bytes',
      },
      planted_plain: { hex: utf8Hex('plain'), reads: 'plain' },
    };

    beforeAll(async () => {
      for (const [label, { hex }] of Object.entries(PLANTED)) {
        await driver.execute(
          `insert into ${TABLE} (id, label, v) values ('${label}', '${label}', cast(x'${hex}' as text))`,
        );
      }
    });

    for (const [label, { hex, reads }] of Object.entries(PLANTED)) {
      it(`a stored ${hex} reads back as its exact text`, async () => {
        expect(await storedHex(label)).toBe(hex);
        const row = (await driver.findOne(TABLE, { where: { label } } as any, BYPASS)) as { v: unknown };
        expect(row.v).toStrictEqual(reads);
      });
    }
  });

  describe('the rewritten placeholder behaves as the bound text it replaces', () => {
    it('it carries no affinity: an integer still sorts below a text, as against a bound text', async () => {
      // SQLite orders INTEGER below TEXT when neither operand has affinity, so
      // `5 < <any text>` is 1 for a bound text. A bare `CAST(? AS TEXT)` has
      // TEXT affinity, turns 5 into '5', and answers 0 for a text starting
      // below '5' — which is why the placeholder is `+CAST(? AS TEXT)`.
      const rows = (await driver.execute('select 5 < ? as r', [' ' + NUL])) as Array<{ r: number }>;
      expect(rows).toEqual([{ r: 1 }]);
    });

    it('a statement with no NUL-bearing text binding is run exactly as compiled', () => {
      const sql = 'select * from t where a = ? and b = ?';
      const bindings = ['x', BOM + 'y'];
      const out = exactTextBindings(sql, bindings);
      expect(out.sql).toBe(sql);
      expect(out.bindings).toBe(bindings);
    });

    it('only the NUL-bearing binding is moved, into its own placeholder, past quoted and commented ?', () => {
      // None of `'it''s ?'`, `` `a?` ``, `[b?]`, `"?"`, the two comments or the
      // identifier `c$d` holds a parameter, as SQLite tokenizes them.
      const sql =
        "select 'it''s ?' as q, `a?`, [b?], c$d from t /* ? :x */ where a = ? -- ? @y\n and b = ? and c = \"?\" and d = ?";
      const out = exactTextBindings(sql, ['x', 'y' + NUL, 'z']);
      expect(out.sql).toBe(
        "select 'it''s ?' as q, `a?`, [b?], c$d from t /* ? :x */ where a = ? -- ? @y\n and b = +CAST(? AS TEXT) and c = \"?\" and d = ?",
      );
      expect(out.bindings[0]).toBe('x');
      expect(Array.from(out.bindings[1] as Uint8Array)).toEqual([0x79, 0x00]);
      expect(out.bindings[2]).toBe('z');
    });
  });

  describe('parameters numbered or named — the binding lands where SQLite numbers it', () => {
    it('?NNN: the value bound to index 2 reaches ?2, whatever its position in the text', async () => {
      const wrote = 'a' + NUL + 'b';
      const rows = (await driver.execute('select ?2 as first, ?1 as second', ['plain', wrote])) as Array<{
        first: unknown;
        second: unknown;
      }>;
      expect(rows).toEqual([{ first: wrote, second: 'plain' }]);
    });

    it(':name: the value bound to a named parameter reaches it', async () => {
      const wrote = BOM + 'x' + NUL;
      // knex counts `?` against the array, so the named parameter takes index
      // 1 and the trailing `?` index 2, which nothing binds (SQL NULL).
      const rows = (await driver.execute('select :v as named, ? as unbound', [wrote])) as Array<{
        named: unknown;
        unbound: unknown;
      }>;
      expect(rows).toEqual([{ named: wrote, unbound: null }]);
    });

    it('every form is numbered as SQLite numbers it, and each occurrence of a NUL-bearing index is wrapped', () => {
      // SQLite: ?2 → 2 (largest 2), ? → 3, :n → 4, ?1 → 1, :n → 4 again.
      const sql = 'select ?2 as a, ? as b, :n as c, ?1 as d, :n as e';
      const out = exactTextBindings(sql, ['p', 'q' + NUL, 'r', 's' + NUL]);
      expect(out.sql).toBe(
        'select +CAST(?2 AS TEXT) as a, ? as b, +CAST(:n AS TEXT) as c, ?1 as d, +CAST(:n AS TEXT) as e',
      );
      expect(out.bindings[0]).toBe('p');
      expect(Array.from(out.bindings[1] as Uint8Array)).toEqual([0x71, 0x00]);
      expect(out.bindings[2]).toBe('r');
      expect(Array.from(out.bindings[3] as Uint8Array)).toEqual([0x73, 0x00]);
    });

    it('a NUL-bearing binding no parameter receives is left for sql.js to answer as before', () => {
      const out = exactTextBindings('select ? as a', ['x', 'y' + NUL]);
      expect(out.sql).toBe('select ? as a');
      expect(out.bindings).toEqual(['x', 'y' + NUL]);
    });
  });

  describe('the read refuses rather than falls back', () => {
    it('a sql.js build without Statement.getBlob refuses the read instead of decoding through getString', () => {
      const withoutGetBlob = { get: () => ['a'] };
      expect(() => readExactRow(withoutGetBlob as any, ['v'])).toThrow(/getBlob/);
    });
  });
});
