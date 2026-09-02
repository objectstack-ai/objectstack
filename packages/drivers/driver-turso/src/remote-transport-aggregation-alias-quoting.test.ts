// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14113] The aggregation ALIAS is escaped, not gated — TursoDriver's REMOTE
 * transport.
 *
 * ## The defect
 *
 * `RemoteTransport.aggregate` held the aggregation `alias` to
 * `SAFE_IDENTIFIER` (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`). A dot fails that regex.
 * Every analytics measure is named `<cube>.<measure>` on the wire and
 * `ObjectQLStrategy` uses that name verbatim as the aggregation `alias`
 * (`objectql-strategy.ts`, `{ field, method, alias: measure }`), so EVERY cube
 * query that reached this face threw:
 *
 * ```
 * RemoteTransport: unsafe identifier rejected: "showcase_delivery.count"
 * ```
 *
 * a bare `Error` with no `code` and no `status`, which `mapDataError` then
 * serves as an opaque 500 — the #11455 / #8931 shape.
 *
 * ## Why the fix is escaping and NOT dropping the check
 *
 * The alias is interpolated RAW into `AS "${alias}"`, so an alias containing a
 * `"` would close the quoting and continue as grammar. The repair is the
 * standard doubled-quote escape inside a quoted SQL identifier (`"` → `""`) —
 * the ALIAS half of the distinction #13714 drew one face over, where
 * `SqlDriver.aliasIdentifierSql` routes the same position through knex's
 * `wrapIdentifier`. A qualified REFERENCE must be validated; a single output
 * NAME must be quoted and escaped. `AggregationNodeSchema` declares
 * `alias: z.string()` — an output-column key — and the in-memory, MongoDB and
 * (post-#13714) SQL faces all project it verbatim. This face was the outlier.
 *
 * ## Why a SQLite-backed client stub rather than a mocked `execute`
 *
 * Only EXECUTING the statement tells "escaped" apart from "broke out". A
 * string assertion alone would pass on an alias that terminates the quoting,
 * because the text still *looks* like a select list. libsql IS SQLite, so
 * `makeLibsqlSqliteStub` runs what this transport emits: an alias that escaped
 * its quoting is a syntax error (or a second statement better-sqlite3 refuses
 * to prepare), and a green read of the value back under the literal alias is
 * the proof. The emitted SQL is pinned too, so a future reader can see the
 * doubled quote rather than infer it.
 *
 * ## Reverse verification — direction predicted BEFORE it was run
 *
 * Restore `this.assertSafeIdentifier(alias)` above the `selectParts.push` and
 * emit `AS "${alias}"` again (the pre-#14113 two lines):
 *
 * - the dotted-alias cases (repro, emitted SQL, the un-bucketed cube shape)
 *   go RED by THROWING inside the call — `unsafe identifier rejected:
 *   "showcase_delivery.count"` — not on a comparison.
 * - the quote-escape cases go RED by throwing the same sentence, naming
 *   `won"count` / the `DROP TABLE` text. They cannot go red on a broken-out
 *   statement, because the restored guard refuses that input before any SQL is
 *   built — which is exactly why the guard could not simply be deleted.
 * - the `field`-position control and the groupBy-alias control stay GREEN:
 *   neither position is touched by this card, and that is what they are here
 *   to hold.
 * - the default-alias case stays GREEN: `count_all` passes `SAFE_IDENTIFIER`
 *   either way, so it pins the byte-identical emission across the change.
 *
 * Measured after writing the above — see the PR body for the run.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, asLibsqlClient, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

/**
 * Named for the cube in the field report the card was filed from, so the alias
 * under test (`showcase_delivery.count`) is the real wire spelling rather than
 * a stand-in.
 */
const DELIVERY_OBJECT = {
  name: 'showcase_delivery',
  fields: {
    id: { type: 'string' },
    region: { type: 'string' },
    amount: { type: 'number' },
  },
};

const ROWS = [
  { id: '1', region: 'west', amount: 10 },
  { id: '2', region: 'west', amount: 20 },
  { id: '3', region: 'east', amount: 30 },
];

describe('[#14113] RemoteTransport — the aggregation alias is escaped, not gated', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({ url: 'libsql://alias-quoting.turso.io', client: asLibsqlClient(stub) });
    await driver.connect();
    // The mode this suite is about — the one with its own hand-written SQL.
    expect(driver.transportMode).toBe('remote');
    await driver.syncSchema(DELIVERY_OBJECT.name, DELIVERY_OBJECT);
    for (const row of ROWS) await driver.create(DELIVERY_OBJECT.name, { ...row });
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  /**
   * A transport backed by the same database, capturing the statements it sends
   * AND executing them — the capture alone would not prove the statement runs.
   */
  const capturing = async () => {
    const seen: string[] = [];
    const spy = {
      ...stub,
      execute: async (stmt: unknown) => {
        seen.push((stmt as { sql: string }).sql);
        return stub.execute(stmt);
      },
    };
    const t = new TursoDriver({ url: 'libsql://alias-quoting.turso.io', client: asLibsqlClient(spy) });
    await t.connect();
    return { t, seen };
  };

  describe('direction 1 — a dotted `CUBE.MEASURE` alias now reaches the database', () => {
    it('the exact alias the card measured is served, on rows', async () => {
      const rows = await driver.aggregate(DELIVERY_OBJECT.name, {
        object: DELIVERY_OBJECT.name,
        aggregations: [{ function: 'count', alias: 'showcase_delivery.count' }],
      } as never);
      // The value comes back under the caller's own key — a dot is inert
      // inside a quoted identifier, which is the whole claim of this card.
      expect(rows).toHaveLength(1);
      expect((rows as Array<Record<string, unknown>>)[0]['showcase_delivery.count']).toBe(3);
    });

    it('compiles to ONE quoted identifier, dot and all', async () => {
      const { t, seen } = await capturing();
      await t.aggregate(DELIVERY_OBJECT.name, {
        object: DELIVERY_OBJECT.name,
        aggregations: [{ function: 'count', alias: 'showcase_delivery.count' }],
      } as never);
      expect(seen).toEqual([
        'SELECT count(*) AS "showcase_delivery.count" FROM "showcase_delivery"',
      ]);
      // ⛔ Not two segments. The failure this replaces is a face that treats an
      // alias as a qualified reference; the dot must stay INSIDE the quotes.
      expect(seen[0]).not.toContain('"showcase_delivery"."count"');
    });

    it('the un-bucketed cube shape — a grouped measure — is served end to end', async () => {
      // The path that actually reaches `driver.aggregate`: remote mode
      // publishes `queryDateGranularity: {}` (see `TursoDriver.supports`), so a
      // BUCKETED query falls back to `find()` + in-memory bucketing and never
      // arrives here. The UN-bucketed cube query is the one that ate the
      // refusal, and it carries a dimension in `groupBy` beside the measure.
      //
      // ⭐ The groupBy FIELD is a bare column name here, not a dotted one, and
      // that is measured rather than assumed: `ObjectQLStrategy.resolveFieldName`
      // resolves a dimension to `member.sql` or `member.split('.')[1]`, so only
      // the MEASURE arrives dotted. That asymmetry is why this card is confined
      // to the alias position of `aggregations`.
      const rows = await driver.aggregate(DELIVERY_OBJECT.name, {
        object: DELIVERY_OBJECT.name,
        groupBy: ['region'],
        aggregations: [
          { function: 'count', alias: 'showcase_delivery.count' },
          { function: 'sum', field: 'amount', alias: 'showcase_delivery.total_amount' },
        ],
      } as never);
      const byRegion = Object.fromEntries(
        (rows as Array<Record<string, unknown>>).map((r) => [
          r.region,
          [r['showcase_delivery.count'], r['showcase_delivery.total_amount']],
        ]),
      );
      expect(byRegion).toEqual({ west: [2, 30], east: [1, 30] });
    });
  });

  describe('direction 2 — an alias carrying a `"` is ESCAPED, not let through', () => {
    it('doubles the quote and still runs, returning the value under the literal alias', async () => {
      const alias = 'won"count';
      const { t, seen } = await capturing();
      const rows = await t.aggregate(DELIVERY_OBJECT.name, {
        object: DELIVERY_OBJECT.name,
        aggregations: [{ function: 'count', alias }],
      } as never);
      expect(seen).toEqual(['SELECT count(*) AS "won""count" FROM "showcase_delivery"']);
      // Executed, not merely emitted: an alias that broke out of its quoting
      // would be a syntax error here rather than a row.
      expect((rows as Array<Record<string, unknown>>)[0][alias]).toBe(3);
    });

    it('an alias that tries to close the quoting and append a statement stays one name', async () => {
      const alias = 'bucket"; DROP TABLE showcase_delivery; --';
      const { t, seen } = await capturing();
      const rows = await t.aggregate(DELIVERY_OBJECT.name, {
        object: DELIVERY_OBJECT.name,
        aggregations: [{ function: 'count', alias }],
      } as never);
      expect(seen).toEqual([
        'SELECT count(*) AS "bucket""; DROP TABLE showcase_delivery; --" FROM "showcase_delivery"',
      ]);
      // The whole payload came back as a COLUMN NAME — it was data, never
      // grammar.
      expect((rows as Array<Record<string, unknown>>)[0][alias]).toBe(3);
      // And the table it named is still there, with every row.
      expect(
        stub.raw.prepare('select count(*) as c from showcase_delivery').all(),
      ).toEqual([{ c: 3 }]);
    });
  });

  describe('regression controls — the positions this card did NOT touch', () => {
    /**
     * [#14287] Every control below asserts the ADR-0112 envelope beside the
     * sentence, because "still refuses" was the half that was true all along
     * and the half that was WRONG was invisible to it: these positions threw a
     * bare `Error`, which `mapDataError` served as an opaque 500. #14287 gave
     * the one producer `code: 'INVALID_REQUEST'` / `status: 400`. Asserting
     * `message` alone here would let a regression to the bare `Error` land
     * green through the very controls written to hold this shape.
     */
    const envelopeOf = (err: unknown) => ({
      code: (err as { code?: unknown }).code,
      status: (err as { status?: unknown }).status,
    });
    const ENVELOPE = { code: 'INVALID_REQUEST', status: 400 };

    it('the `field` position still refuses an unsafe identifier, and sends nothing', async () => {
      // `SAFE_IDENTIFIER` is doing real work here: `field` becomes a column
      // REFERENCE, which is grammar. Escaping is the answer for a NAME only.
      const { t, seen } = await capturing();
      const err = await t
        .aggregate(DELIVERY_OBJECT.name, {
          object: DELIVERY_OBJECT.name,
          aggregations: [{ function: 'sum', field: 'amount"; DROP TABLE showcase_delivery; --', alias: 'n' }],
        } as never)
        .then(
          () => { throw new Error('expected the transport to refuse an unsafe field'); },
          (e) => e as Error,
        );
      // The OFFENDING TEXT, not just the sentence (#6144) — an alias that is
      // itself safe is what makes this case reach the `field` check at all.
      expect(err.message).toContain('unsafe identifier rejected');
      expect(err.message).toContain('amount"; DROP TABLE showcase_delivery; --');
      // [#14287] …and it is a 400 the caller can act on, not an opaque 500.
      expect(envelopeOf(err)).toEqual(ENVELOPE);
      expect(seen).toEqual([]);
    });

    it('the `object` position still refuses an unsafe identifier', async () => {
      const { t, seen } = await capturing();
      const err = await t
        .aggregate('showcase_delivery"; DROP TABLE showcase_delivery; --', {
          object: 'showcase_delivery"; DROP TABLE showcase_delivery; --',
          aggregations: [{ function: 'count', alias: 'n' }],
        } as never)
        .then(
          () => { throw new Error('expected the transport to refuse an unsafe object') },
          (e) => e as Error,
        );
      expect(err.message).toContain('unsafe identifier rejected');
      expect(envelopeOf(err)).toEqual(ENVELOPE);
      expect(seen).toEqual([]);
    });

    it('the groupBy alias position is UNCHANGED — still refused, and that is a separate card', async () => {
      // ⚠️ Deliberate scope line, pinned so it cannot drift silently. The
      // groupBy `alias` is the same class of thing (an output NAME) and
      // `driver-sql` escapes it post-#13714 (`aliasIdentifierSql` at its
      // groupBy select site), so this face diverges there too — but that
      // position carries a LANDED pin (#6401, `remote-transport-groupby-node`)
      // asserting the refusal, so reversing it is a judgement this card was not
      // dispatched to make. Filed separately rather than patched inline; this
      // control records the state it was left in.
      //
      // It is also NOT on the reproducing path: `ObjectQLStrategy` resolves a
      // dimension to a bare column name, so no analytics query sends a dotted
      // groupBy alias.
      const { t, seen } = await capturing();
      const err = await t
        .aggregate(DELIVERY_OBJECT.name, {
          object: DELIVERY_OBJECT.name,
          groupBy: [{ field: 'region', alias: 'showcase_delivery.region' }],
          aggregations: [{ function: 'count', alias: 'showcase_delivery.count' }],
        } as never)
        .then(
          () => { throw new Error('expected the groupBy alias to still be refused') },
          (e) => e as Error,
        );
      expect(err.message).toContain('unsafe identifier rejected');
      expect(err.message).toContain('showcase_delivery.region');
      // [#14287] The GATING is what this control holds; the ENVELOPE is what
      // that card added to it. Both are pinned, so the open gating card cannot
      // be mistaken for having landed.
      expect(envelopeOf(err)).toEqual(ENVELOPE);
      expect(seen).toEqual([]);
    });

    it('the default alias is byte-identical to what it was before', async () => {
      // A caller who omits `alias` reads the result under `count_all` exactly
      // as they did pre-#14113 — this change moves no default.
      const { t, seen } = await capturing();
      const rows = await t.aggregate(DELIVERY_OBJECT.name, {
        object: DELIVERY_OBJECT.name,
        aggregations: [{ function: 'count' }],
      } as never);
      expect(seen).toEqual(['SELECT count(*) AS "count_all" FROM "showcase_delivery"']);
      expect((rows as Array<Record<string, unknown>>)[0].count_all).toBe(3);
    });
  });
});
