// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6212] `groupBy` is a UNION, and this transport used to read it as `string[]`.
 *
 * ```ts
 * const groupBy: string[] = Array.isArray(query?.groupBy) ? query.groupBy : [];
 * ```
 *
 * `GroupByNodeSchema` is `z.union([z.string(), z.object({ field,
 * dateGranularity?, alias? })])`. Under `query: any` that mismatch was invisible;
 * narrowing the signature to `DriverQuery` made `tsc` state it outright:
 *
 * ```
 * remote-transport.ts(826,11): error TS2322: Type '(string | { field: string;
 *   dateGranularity?: … ; alias?: string })[]' is not assignable to type 'string[]'
 * ```
 *
 * The two halves of the union were in very different shape, which is why this is
 * a behaviour change and not a cast:
 *
 * # A PLAIN structured item was a live remote/local fork
 *
 * `{ field: 'stage' }` with no granularity is spec-valid and reaches drivers
 * today: objectql's aggregate dispatch treats it as supported by everyone
 * ("plain {field} object is fine" — `engine.ts`) and pushes it down, and
 * `secret-fields.test.ts` puts exactly that shape through `engine.aggregate`.
 * The LOCAL face of this driver compiles it as a plain `GROUP BY "stage"`
 * (`SqlDriver.aggregate` reads `g.field`). This face interpolated the object,
 * got `"[object Object]"`, and died in `assertSafeIdentifier` — a SQL-injection
 * message for a query the sibling face answers. One query, two answers, decided
 * by a connection string: the #6203 shape.
 *
 * # A DATE-BUCKETED item genuinely cannot be compiled here
 *
 * That half is guarded, and honestly so: remote mode publishes
 * `queryDateGranularity: {}` (see `TursoDriver.supports`), the engine reads that
 * record and buckets in memory for every granularity absent from it, so nothing
 * bucketed is pushed down. What was missing was an answer for the caller that
 * goes around the bit — it also got `"[object Object]"`. It now gets the
 * ADR-0112 envelope the aggregate door already uses for a declared-but-
 * uncompilable name (#5907 / PR #6204): NOT_IMPLEMENTED / 501, because
 * `DateGranularity` declares the name and this backend simply cannot emit it.
 *
 * The local face carried the same condition with a BARE `Error` (`code`/`status`
 * both `undefined` → an opaque 500 from `mapDataError`). Giving only this face an
 * envelope would have been a new fork, so both faces were moved together and the
 * parity block below compares their runtime messages.
 *
 * # `alias` IS read — as of #6401
 *
 * This section used to read "`alias` is deliberately NOT read", and the reason
 * it gave was sound: `GroupByNodeSchema.alias` was honoured by the in-memory
 * path (`in-memory-aggregation.ts` projects `g.alias ?? g.field`) and ignored
 * by `SqlDriver.aggregate`, so reading it HERE alone would have made this
 * transport the only SQL face that did — a new divergence dressed as a fix. The
 * disagreement was filed separately instead (#6401).
 *
 * That issue resolved to ENFORCE, and moved all three SQL faces in one change:
 * `driver-sql`, this transport, and `driver-sqlite-wasm` (which inherits
 * `SqlDriver`'s compiler). The projected column is `alias ?? field` everywhere;
 * GROUP BY still keys on the FIELD. So the deferral is discharged rather than
 * reversed — the condition it named ("only one face would read it") is what
 * stopped being true.
 *
 * # `alias` is ESCAPED, not gated — as of #14235
 *
 * `RemoteTransport.aggregate` emits a caller-supplied output NAME in exactly
 * two positions. #13714 routed BOTH of `driver-sql`'s through
 * `SqlDriver.aliasIdentifierSql`; #14113 moved this transport's AGGREGATION
 * alias to the same escaping and deliberately left the groupBy alias alone,
 * because the groupBy position carried the landed #6401 pin below asserting the
 * refusal. #14235 is the card that reverses that pin on the record: an
 * output-column key is a NAME — quoted and escaped — and a column REFERENCE is
 * grammar, so `field` keeps `assertSafeIdentifier` and `outKey` no longer has
 * it. `GroupByNodeSchema.alias` is the same class of key as
 * `AggregationNodeSchema.alias`, and the in-memory face projects
 * `g.alias ?? g.field` verbatim, so this face was the last one refusing names
 * the contract permits — with a bare `Error` before #14287, an opaque 500 after
 * `mapDataError`, and a 400 `INVALID_REQUEST` since.
 *
 * ⚠️ The `[#6401] refuses an unsafe identifier in \`alias\`` case named in the
 * #6212 record below **no longer exists** — it is replaced in place by
 * `[#14235] ESCAPES an alias that would close the quoting`, on the same input.
 * The record is left as it was measured rather than rewritten to match today's
 * cases: it is the #6212 ablation, not this one.
 *
 * ## Reverse verification (#14235) — direction predicted BEFORE it was run
 *
 * Restore the two pre-#14235 lines at the groupBy select site —
 * `this.assertSafeIdentifier(outKey)` above the push, and
 * `` `"${field}" AS "${outKey}"` `` as the aliased emission:
 *
 * - the two capture cases (`ESCAPES an alias that would close the quoting`,
 *   `a dotted or spaced alias round-trips`) go RED by THROWING inside the call
 *   — `unsafe identifier rejected: "bucket"; DROP TABLE deal; --"` /
 *   `"Region Name"` — not on a comparison.
 * - both executing cases go RED the same way, inside `driver.aggregate`.
 * - the `field`-position control (`still refuses an unsafe identifier inside a
 *   structured entry`) stays GREEN — untouched by this change, and that is
 *   exactly what it is here to hold.
 * - `projects \`alias\` as the column name` and `an alias equal to the field
 *   name emits no self-rename` stay GREEN: `bucket` and `stage` pass
 *   `SAFE_IDENTIFIER` either way, so they pin byte-identical emission across
 *   the change.
 * - every date-bucket, parity and string-form case stays GREEN.
 *
 * MEASURED: see the PR body for the run.
 *
 * # Reverse verification (#6212) — direction predicted BEFORE it was run, per case
 *
 * Restore `const groupBy: string[] = Array.isArray(query?.groupBy) ? … : []`
 * (with a cast, since the narrowed signature no longer permits it):
 *
 * - the two PLAIN-structured cases go RED, and NOT on a comparison: the
 *   transport throws `unsafe identifier rejected: "[object Object]"`, so they
 *   fail inside the call.
 * - the date-bucket refusal case goes RED on `err.code` → `undefined`, having
 *   thrown the identifier error instead of the refusal — it fails on the first
 *   assertion, not through the "it compiled" branch, because the old code threw
 *   for this input too, just anonymously.
 * - the PARITY case goes RED for the same reason — `remote.code` is `undefined`
 *   where `local.code` is `NOT_IMPLEMENTED`.
 * - the `'month'` asymmetry case goes RED on its remote half only: the local
 *   half still resolves (it is not touched by this revert), the remote half
 *   throws the identifier error instead of the refusal sentence.
 * - the unsafe-identifier case stays GREEN on its first assertion and goes RED
 *   on the second — see the note on the case itself: the old code threw the
 *   same SENTENCE for the wrong REASON, which is why the offending text is
 *   asserted rather than the sentence alone.
 * - the string-form control, and the case that pins what the LOCAL face lists,
 *   stay GREEN: the string half of the union never moved and the local face is
 *   not part of this revert.
 *
 * Measured after writing the above — **11 failed / 2 passed of 13**, case for
 * case as predicted:
 *
 * ```
 * structured, no granularity (2)  Error: RemoteTransport: unsafe identifier
 *                                 rejected: "[object Object]"   (thrown IN the call)
 * unsafe identifier               expected 'RemoteTransport: unsafe identifier re…'
 *                                 to contain 'stage"; DROP TABLE deal; --'
 *                                 (first assertion green, second red — the point)
 * date-bucket refusals (5)        expected undefined to be 'NOT_IMPLEMENTED'
 * "Bucketed here: none"           expected '…unsafe identifier re…' to contain it
 * parity 'week'                   expected undefined to be 'NOT_IMPLEMENTED'
 * 'month' asymmetry               remote half only: expected […] to throw
 *                                 "Date bucketing by 'month' …" but got
 *                                 "RemoteTransport: unsafe identifier re…"
 * ── green ──
 * string entry compiles to GROUP BY
 * the local face lists day, month, quarter, year
 * ```
 *
 * Not one failure came through an "it compiled" branch: the un-narrowed
 * transport threw for every one of these inputs too, just with the wrong
 * message and no wire identity. That is the #6144 shape restated as evidence,
 * and it is why every case here asserts `code`/`status` or the offending TEXT
 * rather than merely that something was thrown.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, asLibsqlClient, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** The first sentence, spelled out rather than imported — #5240's contract. */
const REFUSAL_SENTENCE = (g: string) =>
  `Date bucketing by '${g}' is not supported by this backend.`;

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

async function localDriver(): Promise<SqlDriver> {
  const d = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await d.initObjects([
    {
      name: 'deal',
      fields: {
        id: { type: 'text', name: 'id' },
        stage: { type: 'text', name: 'stage' },
        closed_at: { type: 'datetime', name: 'closed_at' },
      },
    } as any,
  ]);
  return d;
}

describe('[#6212] RemoteTransport compiles the GroupByNode union', () => {
  describe('a plain field name — the half that never moved', () => {
    it('compiles a string entry to GROUP BY, as it always did', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', {
        groupBy: ['stage'],
        aggregations: [{ function: 'count', field: 'stage', alias: 'n' }],
      });
      expect(calls[0].sql).toBe('SELECT "stage", count("stage") AS "n" FROM "deal" GROUP BY "stage"');
    });
  });

  describe('a structured entry with no granularity', () => {
    it('compiles to the SAME statement as the string spelling', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', {
        groupBy: [{ field: 'stage' }],
        aggregations: [{ function: 'count', field: 'stage', alias: 'n' }],
      });
      expect(calls[0].sql).toBe('SELECT "stage", count("stage") AS "n" FROM "deal" GROUP BY "stage"');
    });

    it('[#6401] projects `alias` as the column name, and still GROUPS BY the field', async () => {
      // Flipped from 'ignores `alias`, in step with the local face'. That pin
      // was correct when written — at #6212 this transport was the only face
      // that could have started reading the key, and doing so alone would have
      // been a new divergence. #6401 moved all three SQL faces together, so the
      // step it was keeping is now a step toward the alias, not away from it.
      //
      // The old assertion is REPLACED, not dropped: it claimed the alias never
      // reaches the statement; the new truth is the exact statement that
      // carries it — projection renamed, grouping untouched.
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', {
        groupBy: [{ field: 'stage', alias: 'bucket' }],
        aggregations: [{ function: 'count', field: 'stage', alias: 'n' }],
      });
      expect(calls[0].sql).toBe(
        'SELECT "stage" AS "bucket", count("stage") AS "n" FROM "deal" GROUP BY "stage"',
      );
      // ⛔ The grouping key is the FIELD. SQLite resolves output names in
      // GROUP BY, so a face that grouped by the alias would return identical
      // rows here and diverge on a dialect that does not.
      expect(calls[0].sql).not.toContain('GROUP BY "bucket"');
    });

    it('[#6401] an alias equal to the field name emits no self-rename', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', {
        groupBy: [{ field: 'stage', alias: 'stage' }],
        aggregations: [{ function: 'count', field: 'stage', alias: 'n' }],
      });
      // Byte-identical to the string spelling above — the degenerate alias must
      // not start rewriting statements on every dialect for no gain.
      expect(calls[0].sql).toBe('SELECT "stage", count("stage") AS "n" FROM "deal" GROUP BY "stage"');
    });

    it('[#14235] ESCAPES an alias that would close the quoting — one inert name, one statement', async () => {
      // ⚠️ This case REPLACES the #6401 pin that asserted the same input is
      // REFUSED (`unsafe identifier rejected`, naming the offending text). That
      // pin was the deliberate call when the alias was newly read here, and
      // reversing it is a recorded, non-silent reversal rather than a rider:
      // #13714 routed BOTH of driver-sql's output-name positions through
      // `aliasIdentifierSql`, #14113 moved this transport's aggregation alias
      // to escaping, and #14235 brings the second output-name position of the
      // same method to the same line. An output-column key is a NAME: it is
      // quoted and escaped, never gated.
      //
      // The old assertion is REPLACED, not dropped — the exact input it named
      // is the input here, and what is pinned now is the statement it produces.
      const { t, calls } = transportWithCapturingClient();
      const rows = await t.aggregate('deal', {
        groupBy: [{ field: 'stage', alias: 'bucket"; DROP TABLE deal; --' }],
        aggregations: [{ function: 'count', alias: 'n' }],
      });
      expect(rows).toEqual([]);
      // The whole payload is ONE column name, the quote doubled — the standard
      // escape inside a quoted SQL identifier. It is data, never grammar.
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toBe(
        'SELECT "stage" AS "bucket""; DROP TABLE deal; --", count("stage") AS "n" FROM "deal" GROUP BY "stage"',
      );
      // ⛔ Not two statements: a payload that had broken out of its quoting
      // would appear as a second one here.
      expect(calls[0].sql).not.toContain('DROP TABLE deal;"');
      // And the grouping key is still the FIELD, exactly as for a bare alias.
      expect(calls[0].sql.endsWith('GROUP BY "stage"')).toBe(true);
    });

    it('[#14235] a dotted or spaced alias round-trips as one quoted output column', async () => {
      // The reachable population the card measured: a caller writing
      // `groupBy: [{ field, alias }]` through the Query Protocol directly.
      // Both spellings work on the in-memory, MongoDB and SQL faces and were an
      // opaque 500 on this one — no `code`, no `status`, out of `mapDataError`.
      for (const alias of ['Region Name', 'deal.stage_bucket']) {
        const { t, calls } = transportWithCapturingClient();
        await t.aggregate('deal', {
          groupBy: [{ field: 'stage', alias }],
          aggregations: [{ function: 'count', field: 'stage', alias: 'n' }],
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toBe(
          `SELECT "stage" AS "${alias}", count("stage") AS "n" FROM "deal" GROUP BY "stage"`,
        );
        // ⛔ The dot stays INSIDE the quotes. The failure this rules out is a
        // face that reads an output NAME as a qualified REFERENCE.
        expect(calls[0].sql).not.toContain('"deal"."stage_bucket"');
      }
    });

    it('still refuses an unsafe identifier inside a structured entry', async () => {
      // Unwrapping the union must not unwrap the injection guard with it.
      //
      // The assertion names the OFFENDING TEXT rather than only the sentence,
      // and that is load-bearing: the un-narrowed transport also threw
      // `unsafe identifier rejected` here — for `"[object Object]"`, because it
      // garbled the whole entry — so a case matching only the sentence would be
      // green before and after, for opposite reasons (the #6144 shape).
      const { t, calls } = transportWithCapturingClient();
      const err = await t
        .aggregate('deal', {
          groupBy: [{ field: 'stage"; DROP TABLE deal; --' }],
          aggregations: [{ function: 'count', alias: 'n' }],
        })
        .then(
          () => { throw new Error('expected the transport to refuse an unsafe identifier'); },
          (e) => e as Error,
        );
      expect(err.message).toContain('unsafe identifier rejected');
      expect(err.message).toContain('stage"; DROP TABLE deal; --');
      expect(err.message).not.toContain('[object Object]');
      expect(calls).toEqual([]);
    });
  });

  describe('a date-bucketed entry — the half this backend cannot compile', () => {
    const refusalOf = async (granularity: 'day' | 'week' | 'month' | 'quarter' | 'year') => {
      const { t, calls } = transportWithCapturingClient();
      try {
        await t.aggregate('deal', {
          groupBy: [{ field: 'closed_at', dateGranularity: granularity }],
          aggregations: [{ function: 'count', alias: 'n' }],
        });
      } catch (e) {
        expect(calls).toEqual([]);
        return e as WireBearingError;
      }
      throw new Error(`expected a refusal for '${granularity}', but it compiled to ${JSON.stringify(calls)}`);
    };

    for (const granularity of ['day', 'week', 'month', 'quarter', 'year'] as const) {
      it(`refuses '${granularity}' with NOT_IMPLEMENTED / 501`, async () => {
        // ⚠️ Asserts `code` AND `status`, never merely "it threw" (#6144): the
        // un-narrowed transport threw for this input too — with an unsafe-
        // identifier message — so `rejects.toThrow()` would have been green
        // before and after, blind to the whole change.
        const err = await refusalOf(granularity);
        expect(err.code).toBe('NOT_IMPLEMENTED');
        expect(err.status).toBe(501);
        expect(err.message.startsWith(REFUSAL_SENTENCE(granularity))).toBe(true);
        expect(err.message).toContain('capability gap');
        expect(err.message).toContain('supports.queryDateGranularity');
        expect(err.message).not.toContain('[object Object]');
        expect(err.message).not.toContain('unsafe identifier');
        // #1116's note: driver-internal wording is not the caller's business.
        expect(err.message).not.toContain('[RemoteTransport]');
      });
    }

    it('names every granularity it declines, so the message cannot claim a false capability', async () => {
      const err = await refusalOf('month');
      expect(err.message).toContain('Bucketed here: none');
    });
  });

  // ── The cross-package half: one condition, one wording ─────────────────────

  /**
   * ⚠️ What this block pins is not "the wording is right today" — it is that a
   * FUTURE PR cannot move one face and leave the other.
   *
   * Both sides are RUNTIME messages, produced by two different packages and
   * compared to each other. Neither side reads a shared constant: a pin written
   * that way agrees with itself however far the two implementations drift, which
   * is the one failure mode a parity test exists to rule out. `REFUSAL_SENTENCE`
   * above is a third, independent copy of the bytes — so the block fails if
   * either face moves, and also if both move together.
   *
   * The condition is literally one condition stated twice
   * (`supports.queryDateGranularity[g] !== true`), which is why the envelope had
   * to land on both faces in one PR rather than on the remote one alone: giving
   * only the new refusal a `code`/`status` would have shipped the exact
   * "one condition, two wire identities" shape #5907 spent an issue closing.
   */
  describe('local/remote parity (#5240 — one condition, one wording)', () => {
    it("answers 'week' identically on both faces", async () => {
      // `week` is the granularity BOTH faces decline: SQLite buckets
      // day/month/quarter/year and leaves week to the in-memory path (strftime
      // %V landed only in SQLite 3.46), and this transport buckets nothing. So
      // it is the one input on which the two messages are comparable at all.
      const query = {
        groupBy: [{ field: 'closed_at', dateGranularity: 'week' as const }],
        aggregations: [{ function: 'count' as const, alias: 'n' }],
      };

      const { t } = transportWithCapturingClient();
      const remote = await t.aggregate('deal', query).then(
        () => { throw new Error('expected the transport to refuse'); },
        (e) => e as WireBearingError,
      );

      const d = await localDriver();
      const local = await d.aggregate('deal', query).then(
        () => { throw new Error('expected the local driver to refuse'); },
        (e) => e as WireBearingError,
      );

      expect(remote.code).toBe(local.code);
      expect(remote.status).toBe(local.status);
      // First sentence is the contract; the tails differ on purpose — each face
      // reports what IT buckets, which is the whole content of the asymmetry
      // below.
      expect(remote.message.split('. ')[0]).toBe(local.message.split('. ')[0]);
      expect(remote.message.split('. ')[0]).toBe(REFUSAL_SENTENCE('week').replace(/\.$/, ''));
    });

    it("'month' is declined here and compiled there — a DECLARED asymmetry, not a fork", async () => {
      // The two faces publish different `supports.queryDateGranularity`, and the
      // engine reads it. `month` on the local face must therefore compile, not
      // refuse: a parity test that demanded identical behaviour here would be
      // demanding the capability bit mean nothing.
      const d = await localDriver();
      await expect(
        d.aggregate('deal', {
          groupBy: [{ field: 'closed_at', dateGranularity: 'month' }],
          aggregations: [{ function: 'count', alias: 'n' }],
        }),
      ).resolves.toBeDefined();

      const { t } = transportWithCapturingClient();
      await expect(
        t.aggregate('deal', {
          groupBy: [{ field: 'closed_at', dateGranularity: 'month' }],
          aggregations: [{ function: 'count', alias: 'n' }],
        }),
      ).rejects.toThrow(REFUSAL_SENTENCE('month'));
    });

    it('the local face lists the granularities it DOES bucket', async () => {
      const d = await localDriver();
      const err = await d
        .aggregate('deal', {
          groupBy: [{ field: 'closed_at', dateGranularity: 'week' }],
          aggregations: [{ function: 'count', alias: 'n' }],
        })
        .then(
          () => { throw new Error('expected the local driver to refuse'); },
          (e) => e as WireBearingError,
        );
      expect(err.code).toBe('NOT_IMPLEMENTED');
      expect(err.status).toBe(501);
      expect(err.message).toContain('Bucketed here: day, month, quarter, year');
      expect(err.message).toContain("dialect 'better-sqlite3'");
    });
  });

  // ── [#14235] Executed, not merely emitted ─────────────────────────────────

  /**
   * ⚠️ Only EXECUTING the statement tells "escaped" apart from "broke out" —
   * #14113's reasoning one position over, and the reason its pin is backed by a
   * real database rather than a captured string. A capture assertion alone
   * passes on an alias that terminates the quoting, because the text still
   * *looks* like a select list. libsql IS SQLite, so the stub runs exactly what
   * this transport emits: an alias that escaped its quoting is a syntax error
   * (or a second statement better-sqlite3 refuses to prepare), and reading the
   * value back under the literal alias is the proof that it did not.
   */
  describe('[#14235] the escaped groupBy alias is inert against a real database', () => {
    const DEAL = {
      name: 'deal',
      fields: { id: { type: 'string' }, stage: { type: 'string' }, amount: { type: 'number' } },
    };
    let driver: TursoDriver;
    let stub: LibsqlSqliteStub;

    beforeAll(async () => {
      stub = makeLibsqlSqliteStub();
      driver = new TursoDriver({ url: 'libsql://groupby-alias.turso.io', client: asLibsqlClient(stub) });
      await driver.connect();
      // The mode this block is about — the one with its own hand-written SQL.
      expect(driver.transportMode).toBe('remote');
      await driver.syncSchema(DEAL.name, DEAL);
      for (const row of [
        { id: '1', stage: 'won', amount: 10 },
        { id: '2', stage: 'won', amount: 20 },
        { id: '3', stage: 'lost', amount: 30 },
      ]) {
        await driver.create(DEAL.name, { ...row });
      }
    });

    afterAll(async () => {
      await driver.disconnect();
      stub.close();
    });

    it('a dotted alias comes back under the result key the caller asked for, on rows', async () => {
      const rows = (await driver.aggregate(DEAL.name, {
        object: DEAL.name,
        groupBy: [{ field: 'stage', alias: 'deal.stage_bucket' }],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'deal.total' }],
      } as never)) as Array<Record<string, unknown>>;
      const byBucket = Object.fromEntries(rows.map((r) => [r['deal.stage_bucket'], r['deal.total']]));
      // A dot is inert inside a quoted identifier — the whole claim of the card.
      expect(byBucket).toEqual({ won: 30, lost: 30 });
    });

    it('an alias that tries to close the quoting and append a statement leaves the table standing', async () => {
      const alias = 'bucket"; DROP TABLE deal; --';
      const rows = (await driver.aggregate(DEAL.name, {
        object: DEAL.name,
        groupBy: [{ field: 'stage', alias }],
        aggregations: [{ function: 'count', alias: 'n' }],
      } as never)) as Array<Record<string, unknown>>;
      // The payload came back as a COLUMN NAME — it was data, never grammar.
      expect(rows.map((r) => r[alias]).sort()).toEqual(['lost', 'won']);
      // And the table it named is still there, with every row.
      expect(stub.raw.prepare('select count(*) as c from deal').all()).toEqual([{ c: 3 }]);
    });
  });
});
