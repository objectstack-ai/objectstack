// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';

/**
 * Regression: the MIRROR of #1058 — a predicate that vanishes (#1066).
 *
 * `buildWhereSQL` decided "this field's comparand is an operator map" with
 * `typeof value === 'object' && !Array.isArray(value)`. A `Date` passes that
 * test, and `Object.entries(new Date())` is EMPTY (a Date carries no own
 * enumerable properties) — so the operator loop ran zero times and pushed zero
 * clauses:
 *
 *   { closed_at: someDate }  → SELECT * FROM "deal"                 args []
 *   { closed_at: { $gte: someDate } }
 *                            → SELECT * FROM "deal" WHERE "closed_at" >= ?
 *                                                                   args [ISO]
 *
 * The same comparand, one nesting level apart, and the bare spelling compiled
 * to a FULL TABLE SCAN. #1004 (unknown operator) and #1058 (unbindable
 * comparand) both closed "valid SQL, silent ZERO rows"; this is the other face
 * of that family — "valid SQL, silent ALL rows" — and it is the more dangerous
 * one, because the caller does not get an empty page it can notice: it gets
 * back exactly the rows the filter was written to exclude.
 *
 * A bare `Date` is not an unsupported value form. It is fully compilable —
 * `serializeComparand`'s allow-list admits it as this transport's ONE declared
 * object conversion (→ ISO 8601, the storage form `toRemoteWriteForms` wrote).
 * It was MIS-ROUTED: sent to the operator-map branch when it belongs to the
 * implicit-equality branch, where `{ $eq: date }` already worked.
 *
 * The fix is one routing predicate, and the point of these tests is that the
 * routing question and the binding question now read the SAME list
 * (`isBindableObjectComparand`), so no object form can ever again be "a value"
 * to the serializer and "an operator map" to the router.
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

const AT = '2026-04-29T08:30:00.000Z';

describe('RemoteTransport bare-Date comparand routing (#1066)', () => {
  describe('(a) a bare Date compiles to an equality, not to nothing', () => {
    it('emits `col = ?` binding the ISO string', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { closed_at: new Date(AT) } });
      const { sql, args } = calls[0];
      expect(sql).toMatch(/WHERE\s+"closed_at"\s*=\s*\?/i);
      expect(args).toEqual([AT]);
    });

    it('never compiles a bare Date to a bare table scan', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { closed_at: new Date(AT) } });
      // The pre-fix output verbatim: `SELECT * FROM "deal"` with zero args.
      expect(calls[0].sql).not.toBe('SELECT * FROM "deal"');
      expect(calls[0].args.length).toBeGreaterThan(0);
    });

    it('answers identically to the explicit `$eq` spelling of the same comparand', async () => {
      const bare = transportWithCapturingClient();
      const explicit = transportWithCapturingClient();
      await bare.t.find('deal', { where: { closed_at: new Date(AT) } });
      await explicit.t.find('deal', { where: { closed_at: { $eq: new Date(AT) } } });
      expect(bare.calls[0]).toEqual(explicit.calls[0]);
    });

    it('composes with other predicates, in argument order', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { stage: 'won', closed_at: new Date(AT), amount: { $gt: 10 } } });
      const { sql, args } = calls[0];
      expect(sql).toMatch(/"stage"\s*=\s*\?\s+AND\s+"closed_at"\s*=\s*\?\s+AND\s+"amount"\s*>\s*\?/i);
      expect(args).toEqual(['won', AT, 10]);
    });

    it('routes a bare Date the same way inside `$and` / `$or`', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', {
        where: { $or: [{ closed_at: new Date(AT) }, { stage: 'lost' }] },
      });
      const { sql, args } = calls[0];
      expect(sql).toMatch(/"closed_at"\s*=\s*\?/i);
      expect(sql).toMatch(/OR/i);
      expect(args).toEqual([AT, 'lost']);
    });

    it('reaches the same routing through the other WHERE-building entry points', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.count('deal', { where: { closed_at: new Date(AT) } });
      await t.deleteMany('deal', { where: { closed_at: new Date(AT) } });
      // `count` and `deleteMany` share `buildWhereSQL`; a predicate that
      // vanished on a DELETE would empty the table rather than widen a read.
      expect(calls[0].sql).toMatch(/COUNT\(\*\).+WHERE\s+"closed_at"\s*=\s*\?/i);
      expect(calls[0].args).toEqual([AT]);
      expect(calls[1].sql).toMatch(/DELETE FROM "deal"\s+WHERE\s+"closed_at"\s*=\s*\?/i);
      expect(calls[1].args).toEqual([AT]);
    });
  });

  describe('(b) every already-working spelling is byte-identical', () => {
    it('keeps `$gte` on a Date compiling as before', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { closed_at: { $gte: new Date(AT) } } });
      expect(calls[0].sql).toBe('SELECT * FROM "deal" WHERE "closed_at" >= ?');
      expect(calls[0].args).toEqual([AT]);
    });

    it('keeps a Date inside `$in` — the array is the operator shape, the Date is an element', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { closed_at: { $in: [new Date(AT), '2026-07-28'] } } });
      expect(calls[0].sql).toMatch(/"closed_at"\s+IN\s*\(\?,\s*\?\)/i);
      expect(calls[0].args).toEqual([AT, '2026-07-28']);
    });

    it('keeps the operator-map branch for a real operator map on the same field', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', { where: { closed_at: { $gte: new Date(AT), $lt: new Date('2026-07-28T00:00:00.000Z') } } });
      expect(calls[0].sql).toMatch(/"closed_at"\s*>=\s*\?\s+AND\s+"closed_at"\s*<\s*\?/i);
      expect(calls[0].args).toEqual([AT, '2026-07-28T00:00:00.000Z']);
    });

    it('keeps #1058 tight — an unbindable object comparand is still refused, not re-admitted as a value', async () => {
      const { t } = transportWithCapturingClient();
      await expect(
        t.find('deal', { where: { amount: { $gt: { $field: 'budget' } } } }),
      ).rejects.toThrow(/Cross-field comparison is not supported/);
    });

    it('keeps #1004 tight — a plain object in bare position is still an operator map, and a bad one throws', async () => {
      const { t } = transportWithCapturingClient();
      // The narrowing must be `Date`-shaped, not "any object with no $ keys":
      // a typo'd operator must still reach the `default:` arm rather than
      // becoming an implicit-equality comparand.
      await expect(t.find('deal', { where: { amount: { $gtt: 10 } } })).rejects.toThrow(
        /Unsupported filter operator "\$gtt"/,
      );
      await expect(t.find('deal', { where: { amount: { budget: 10 } } })).rejects.toThrow(
        /key "budget" is not an operator/,
      );
    });

    it('keeps arrays refused in bare position', async () => {
      const { t } = transportWithCapturingClient();
      // An array is the one object form the router still leaves alone, so it
      // reaches the comparand gate and is refused there by FORM (#1058).
      // [#8197] Marked author-written: the gate's naming half is now withheld
      // from a predicate no boundary vouched, and the FORM is what this case
      // asks about.
      await expect(
        t.find('deal', { where: markFilterSubtreeProvenance({ tags: ['a', 'b'] }, 'author') }),
      ).rejects.toThrow(/is an array/);
    });

    it('keeps a binary buffer refused — by whichever gate it reaches first', async () => {
      const { t } = transportWithCapturingClient();
      // A `Uint8Array` DOES have own enumerable keys (its indices), so it is
      // routed to the operator map and refused there for carrying a key that is
      // not an operator. Unchanged by this fix, and pinned so the narrowing
      // above is never widened from "Date" to "any object that binds": it must
      // still throw, and it must still be THIS gate that says so.
      await expect(t.find('deal', { where: { blob: new Uint8Array([1]) } })).rejects.toThrow(
        /key "0" is not an operator/,
      );
      // An EMPTY buffer has no keys at all — pre-fix it vanished exactly like a
      // Date did; now it is the zero-clause refusal.
      await expect(t.find('deal', { where: { blob: new Uint8Array([]) } })).rejects.toThrow(
        /compiles to NO predicate/,
      );
    });

    it('keeps null equality on `IS NULL` — null never reaches the comparand gate', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('sys_metadata', { where: { organization_id: null } });
      expect(calls[0].sql).toMatch(/"organization_id"\s+IS NULL/i);
      expect(calls[0].args).toEqual([]);
    });

    it('keeps an absent / empty top-level filter meaning "no WHERE"', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', {});
      await t.find('deal', { where: {} });
      // A top-level `{}` is "no filter", which is a different statement from a
      // FIELD whose filter is `{}` — see the empty-operator-map suite below.
      expect(calls[0].sql).toBe('SELECT * FROM "deal"');
      expect(calls[1].sql).toBe('SELECT * FROM "deal"');
    });
  });

  describe('(c) an operator map that compiles to no predicate throws', () => {
    it('refuses `{ field: {} }` rather than dropping the filter', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { closed_at: {} } })).rejects.toThrow(
        /compiles to NO predicate/,
      );
    });

    it('names the object and field, and echoes the comparand', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { closed_at: {} } })).rejects.toThrow(
        /'deal\.closed_at'/,
      );
    });

    it('refuses an object with no own enumerable keys whatever its prototype', async () => {
      const { t } = transportWithCapturingClient();
      // `Object.create(null)` and a class instance are the other two ways to
      // arrive at "an object, zero entries" — the shape that made a Date
      // disappear in the first place. None of them may compile to nothing.
      await expect(
        t.find('deal', { where: { closed_at: Object.create(null) } }),
      ).rejects.toThrow(/compiles to NO predicate/);
      await expect(
        t.find('deal', { where: { closed_at: new (class Marker {})() } }),
      ).rejects.toThrow(/compiles to NO predicate/);
    });

    it('refuses it in every WHERE-building entry point, including the writing ones', async () => {
      const { t } = transportWithCapturingClient();
      // A vanished predicate on `deleteMany` deletes the whole table. This is
      // the arm where "throw loudly" is not a style preference.
      await expect(t.deleteMany('deal', { where: { closed_at: {} } })).rejects.toThrow(
        /compiles to NO predicate/,
      );
      await expect(
        t.updateMany('deal', { where: { closed_at: {} } }, { stage: 'lost' }),
      ).rejects.toThrow(/compiles to NO predicate/);
      await expect(t.count('deal', { where: { closed_at: {} } })).rejects.toThrow(
        /compiles to NO predicate/,
      );
    });

    it('refuses it nested inside `$and` / `$or` too', async () => {
      const { t } = transportWithCapturingClient();
      await expect(
        t.find('deal', { where: { $and: [{ stage: 'won' }, { closed_at: {} }] } }),
      ).rejects.toThrow(/compiles to NO predicate/);
    });

    it('does not execute any statement when it refuses', async () => {
      const { t, calls } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { closed_at: {} } })).rejects.toThrow();
      expect(calls).toEqual([]);
    });
  });
});

/**
 * (d) The temporal seam is untouched.
 *
 * `TursoDriver.toRemoteFieldSpec` sends a bare comparand through
 * `temporalFilterValue` BEFORE the filter reaches this transport, so a `Date`
 * on a `datetime`/`date`/`time` column arrives already converted to its
 * canonical STRING — which is why the common path never showed the bug, and
 * why it must keep compiling exactly as it did. The blast radius was columns
 * with no temporal metadata, where `temporalFilterValue` passes the value
 * through unchanged (framework pins that: `temporalFilterValue(T, 'title',
 * 'hello') === 'hello'`).
 *
 * These are ROW-level assertions against a real SQLite-backed libsql stub,
 * because a dropped predicate is invisible to a SQL-string assertion: the SQL
 * stays valid, just wider (the blind spot framework#4081 found one layer up).
 */
describe('TursoDriver remote — bare Date through the driver (#1066)', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;
  let calls: Array<{ sql: string; args: any[] }>;

  const EARLY = '2026-04-29T08:30:00.000Z';
  const LATE = '2026-07-28T08:30:00.000Z';

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    calls = [];
    const recording = {
      ...stub,
      execute: async (stmt: any) => {
        calls.push({ sql: stmt?.sql ?? String(stmt), args: stmt?.args ?? [] });
        return stub.execute(stmt);
      },
    };
    driver = new TursoDriver({ url: 'libsql://routing.turso.io', client: recording as never });
    await driver.connect();
    expect(driver.transportMode).toBe('remote');
    // `at`/`on` carry temporal metadata; `noted_at` deliberately does NOT — an
    // untyped column is what the issue's blast radius is made of (an object
    // with no registered field metadata, an external/unmanaged table, or a
    // caller holding `RemoteTransport` directly).
    await driver.syncSchema('deal', {
      name: 'deal',
      fields: {
        at: { type: 'datetime' },
        on: { type: 'date' },
        noted_at: { type: 'string' },
        stage: { type: 'string' },
      },
    });
    await driver.create('deal', {
      id: 'd_early',
      at: EARLY,
      on: '2026-04-29',
      noted_at: EARLY,
      stage: 'won',
    });
    await driver.create('deal', {
      id: 'd_late',
      at: LATE,
      on: '2026-07-28',
      noted_at: LATE,
      stage: 'lost',
    });
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  it('a bare Date on a NON-temporal column selects one row, not the whole table', async () => {
    const rows = (await driver.find('deal', { where: { noted_at: new Date(EARLY) } })) as any[];
    // Pre-fix this returned BOTH rows — the predicate vanished entirely.
    expect(rows.map((r) => r.id)).toEqual(['d_early']);
  });

  it('a bare Date on a TEMPORAL column still resolves through the temporal seam', async () => {
    const rows = (await driver.find('deal', { where: { at: new Date(LATE) } })) as any[];
    expect(rows.map((r) => r.id)).toEqual(['d_late']);
  });

  it('the temporal comparand still arrives PRE-converted — the seam owns it, not this fix', async () => {
    // The distinguishing column is `date`, not `datetime`: the seam's canonical
    // form for a `Field.date` is the bare day (`toDateOnly`), while this
    // transport's own `Date` conversion is full ISO. If the driver ever stopped
    // pre-converting — or if this fix started converting AHEAD of it — the bound
    // arg would flip to `2026-07-28T08:30:00.000Z` and stop matching the stored
    // `2026-07-28`. On `datetime` the two conversions agree, so that column
    // could not tell the difference.
    calls.length = 0;
    const rows = (await driver.find('deal', { where: { on: new Date(LATE) } })) as any[];
    expect(calls[0].args).toEqual(['2026-07-28']);
    expect(rows.map((r) => r.id)).toEqual(['d_late']);
  });

  it('a range window on the temporal column is unchanged', async () => {
    const rows = (await driver.find('deal', {
      where: { at: { $gte: new Date(EARLY), $lte: new Date(LATE) } },
    })) as any[];
    expect(rows.map((r) => r.id).sort()).toEqual(['d_early', 'd_late']);
  });

  it('an empty operator map is refused through the driver too', async () => {
    await expect(driver.find('deal', { where: { at: {} } })).rejects.toThrow(
      /compiles to NO predicate/,
    );
  });
});
