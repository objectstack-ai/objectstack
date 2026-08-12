// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { RemoteTransport } from './remote-transport.js';

/**
 * Regression: the VALUE half of #1004 (#1058).
 *
 * `buildWhereSQL` bound every KNOWN operator's comparand through
 * `serializeValue`, which `JSON.stringify`s any object. So a comparison value
 * this transport cannot compile — the spec's cross-field marker
 * `{ $field: 'budget' }` being the sample that found it — became a string
 * literal:
 *
 *   { amount: { $gt: { $field: 'budget' } } }
 *     → SELECT * FROM "deal" WHERE "amount" > ?   args ["{\"$field\":\"budget\"}"]
 *
 * Valid SQL, zero rows, zero errors. In SQLite's type ordering every number
 * sorts below every string, so the predicate is false for EVERY row, and the
 * caller cannot tell that from "nothing matched".
 *
 * #1004 closed the same failure mode in the OPERATOR position — an operator the
 * transport cannot compile throws instead of degrading to an equality. It left
 * the VALUE position open, so the identical mistake threw or went silent purely
 * by nesting depth: `{ amount: { $field: 'x' } }` threw (the `$field` key is not
 * an operator), while `{ amount: { $gt: { $field: 'x' } } }` returned an empty
 * page. These tests pin BOTH halves closed, and pin the write path — where an
 * object IS a JSON column's value — as deliberately unchanged.
 */
function transportWithCapturingClient() {
  const calls: Array<{ sql: string; args: any[] }> = [];
  const client = {
    execute: vi.fn(async (stmt: any) => {
      calls.push({ sql: stmt.sql ?? String(stmt), args: stmt.args ?? [] });
      return { rows: [], columns: [] };
    }),
    close: vi.fn(),
  };
  const t = new RemoteTransport();
  t.setClient(client as any);
  return { t, calls };
}

describe('RemoteTransport comparand refusal — the value half of #1004', () => {
  describe('control: comparands the transport CAN bind still compile', () => {
    it('binds a literal range comparand', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { amount: { $gt: 1000 } } });
      expect(calls[0].sql).toMatch(/"amount"\s*>\s*\?/);
      expect(calls[0].args).toEqual([1000]);
    });

    it('binds string, boolean and bigint comparands', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { name: 'Alice', is_open: true, seq: { $lte: 9n } } });
      expect(calls[0].args).toEqual(['Alice', true, 9n]);
    });

    it('keeps the declared `Date` → ISO 8601 conversion', async () => {
      const { t, calls } = transportWithCapturingClient();
      const at = new Date('2026-04-29T08:30:00.000Z');
      await t.find('deal', { where: { closed_at: { $gte: at }, seen_at: { $eq: at } } });
      expect(calls[0].args).toEqual(['2026-04-29T08:30:00.000Z', '2026-04-29T08:30:00.000Z']);
    });

    it('keeps null equality on `IS NULL` / `IS NOT NULL` (no bind to gate)', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('sys_metadata', { where: { organization_id: null, a: { $eq: null }, b: { $ne: null } } });
      expect(calls[0].sql).toMatch(/"organization_id"\s+IS NULL/i);
      expect(calls[0].sql).toMatch(/"a"\s+IS NULL/i);
      expect(calls[0].sql).toMatch(/"b"\s+IS NOT NULL/i);
      expect(calls[0].args).toEqual([]);
    });

    it('keeps `$in` / `$nin` arrays — the array is the operator shape, its ELEMENTS are the comparands', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { id: { $in: ['a', 'b'] }, stage: { $nin: ['lost'] } } });
      expect(calls[0].sql).toMatch(/"id"\s+IN\s*\(\?,\s*\?\)/i);
      expect(calls[0].sql).toMatch(/"stage"\s+NOT IN\s*\(\?\)/i);
      expect(calls[0].args).toEqual(['a', 'b', 'lost']);
    });

    it('keeps the text family compiling a string comparand', async () => {
      // [#6518] `GLOB`, not `LIKE`: the family is case-SENSITIVE by contract
      // (#4706 Q2 = A) and SQLite's `LIKE` folds ASCII, so both the operator
      // and its wildcard character changed. What this case controls for is
      // unchanged — a legitimate string comparand still compiles rather than
      // being caught by the refusal this file is about.
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { name: { $startsWith: 'Alp' } } });
      expect(calls[0].sql).toMatch(/"name"\s+GLOB\s+\?/i);
      expect(calls[0].args).toEqual(['Alp*']);
    });
  });

  describe('the probe from #1058: a cross-field marker in value position', () => {
    // Every scalar comparison operator, each with the marker as its comparand.
    const markerCases: Array<[string, any]> = [
      ['$gt', { amount: { $gt: { $field: 'budget' } } }],
      ['$gte', { amount: { $gte: { $field: 'budget' } } }],
      ['$lt', { amount: { $lt: { $field: 'budget' } } }],
      ['$lte', { amount: { $lte: { $field: 'budget' } } }],
      ['$eq', { amount: { $eq: { $field: 'budget' } } }],
      ['$ne', { amount: { $ne: { $field: 'budget' } } }],
    ];

    it.each(markerCases)('refuses %s { $field } by name instead of binding its JSON text', async (_op, where) => {
      const { t, calls } = transportWithCapturingClient();
      await expect(t.find('deal', { where })).rejects.toThrow(/Cross-field comparison is not supported/i);
      // Nothing reached the database: a refused filter must not run a query at all.
      expect(calls).toHaveLength(0);
    });

    it('[#7929] names the operator, the columns and the value to the LOG — never to the caller', async () => {
      // This case is the inversion of what it used to assert, and the
      // inversion IS the change. It pinned `'deal.amount' $gt
      // {"$field":"budget"}` in the message a caller receives; measured on
      // #7929, that predicate is routinely an ADMINISTRATOR's — the security
      // middleware ANDs a compiled CEL sharing rule into the same `where`, and
      // this transport cannot tell the two apart. So the operands moved to the
      // diagnostic sink `TursoDriver` wires to its logger, and what the caller
      // gets keeps `INVALID_FILTER` / 400 and the capability sentence.
      //
      // BOTH halves are asserted here: a refusal that said nothing at all
      // would pass the disclosure half alone, and the old message would pass
      // the diagnostic half alone.
      const { t } = transportWithCapturingClient();
      const logged: string[] = [];
      t.setDiagnosticSink((m) => { logged.push(m); });
      const err = await t.find('deal', { where: { amount: { $gt: { $field: 'budget' } } } }).catch((e) => e);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).not.toContain('budget');
      expect(err.message).not.toContain('amount');
      expect(logged.join('\n')).toMatch(/'deal\.amount' \$gt \{"\$field":"budget"\}/);
    });

    it('[#7929] the withheld text is not reachable by serialising the error', async () => {
      // The carrier is a symbol key, and this is what that buys: an error
      // mapper that spreads or stringifies the error — the ordinary way an
      // envelope is built — cannot put the operands back on the wire, so the
      // withhold cannot be undone downstream by code that never heard of it.
      const { t } = transportWithCapturingClient();
      const err = await t.find('deal', { where: { amount: { $gt: { $field: 'budget' } } } }).catch((e) => e);
      expect(JSON.stringify({ ...err, message: err.message })).not.toContain('budget');
      expect(Object.keys(err)).not.toContain('diagnostic');
    });

    it('says what to do instead — not "try another operator", which fails identically', async () => {
      const { t } = transportWithCapturingClient();
      const err = await t.find('deal', { where: { amount: { $gt: { $field: 'budget' } } } }).catch((e) => e);
      expect(err.message).toMatch(/Compare against a literal/i);
      expect(err.message).toMatch(/matches nothing/i);
    });

    it('still refuses the BARE marker via the #1004 unknown-operator arm', async () => {
      const { t, calls } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { amount: { $field: 'budget' } } })).rejects.toThrow(
        /\$field/,
      );
      expect(calls).toHaveLength(0);
    });

    it('refuses the marker inside the LIKE family too (`String(marker)` is "[object Object]")', async () => {
      const { t, calls } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { name: { $contains: { $field: 'code' } } } })).rejects.toThrow(
        /Cross-field comparison is not supported/i,
      );
      expect(calls).toHaveLength(0);
    });

    it('refuses the marker as an `$in` element, naming which element — in the log (#7929)', async () => {
      // Which ELEMENT is as much the policy's shape as the column names are:
      // a read scope's `$in` list is the administrator's, so the index goes to
      // the same place the operands went. Still refused, still `INVALID_FILTER`.
      const { t } = transportWithCapturingClient();
      const logged: string[] = [];
      t.setDiagnosticSink((m) => { logged.push(m); });
      const err = await t
        .find('deal', { where: { id: { $in: ['a', { $field: 'other_id' }] } } })
        .catch((e) => e);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).not.toContain('other_id');
      expect(logged.join('\n')).toMatch(/'deal\.id' \$in\[1\]/);
    });
  });

  describe('any other comparand the transport cannot bind', () => {
    it('refuses a plain object under $eq, naming its form', async () => {
      const { t, calls } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { payload: { $eq: { a: 1 } } } })).rejects.toThrow(
        /Filter comparand 'deal\.payload' \$eq \{"a":1\} is an object, which this transport cannot bind/,
      );
      expect(calls).toHaveLength(0);
    });

    it('refuses an array comparand under $eq', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { tags: { $eq: ['a', 'b'] } } })).rejects.toThrow(
        /'deal\.tags' \$eq \["a","b"\] is an array/,
      );
    });

    it('refuses an array in implicit-equality position, the same as under $eq', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { tags: ['a', 'b'] } })).rejects.toThrow(
        /'deal\.tags' \$eq \["a","b"\] is an array/,
      );
    });

    it('lists the comparand forms it DOES accept', async () => {
      const { t } = transportWithCapturingClient();
      const err = await t.find('deal', { where: { payload: { $eq: { a: 1 } } } }).catch((e) => e);
      expect(err.message).toMatch(/must be a string, number, bigint, boolean, null or Date/);
      expect(err.message).toMatch(/#1004, #1058/);
    });

    it('truncates a large comparand rather than pasting it into the log', async () => {
      const { t } = transportWithCapturingClient();
      const big = { blob: 'x'.repeat(5_000) };
      const err = await t.find('deal', { where: { payload: { $eq: big } } }).catch((e) => e);
      expect(err.message).toContain('…');
      expect(err.message.length).toBeLessThan(600);
    });

    it('refuses through `$or` / `$and` — a sub-clause cannot degrade quietly either', async () => {
      const { t, calls } = transportWithCapturingClient();
      await expect(
        t.find('deal', {
          where: { $or: [{ amount: { $gt: 1 } }, { amount: { $gt: { $field: 'budget' } } }] },
        }),
      ).rejects.toThrow(/Cross-field comparison/i);
      expect(calls).toHaveLength(0);
    });

    it('refuses on every write path that takes a filter, not just `find`', async () => {
      const { t } = transportWithCapturingClient();
      const where = { amount: { $gt: { $field: 'budget' } } };
      await expect(t.count('deal', { where })).rejects.toThrow(/Cross-field comparison/i);
      await expect(t.updateMany('deal', { where }, { stage: 'won' })).rejects.toThrow(/Cross-field comparison/i);
      await expect(t.deleteMany('deal', { where })).rejects.toThrow(/Cross-field comparison/i);
    });
  });

  describe('the write path is deliberately NOT gated', () => {
    it('still stores an object payload as JSON text', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.create('deal', { id: 'd1', payload: { a: 1 }, tags: ['x'] });
      const insert = calls[0];
      expect(insert.sql).toMatch(/^INSERT INTO "deal"/);
      expect(insert.args).toEqual(['d1', '{"a":1}', '["x"]']);
    });

    it('still stores an object payload as JSON text on update', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.update('deal', 'd1', { payload: { a: 1 } });
      expect(calls[0].sql).toMatch(/^UPDATE "deal"/);
      expect(calls[0].args).toEqual(['{"a":1}', 'd1']);
    });
  });
});
