// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14287] Every unsafe-identifier refusal on the Turso REMOTE transport
 * carries the ADR-0112 envelope — `code: 'INVALID_REQUEST'`, `status: 400`.
 *
 * ## The defect
 *
 * `RemoteTransport.assertSafeIdentifier` is the ONE gate for every position
 * where an identifier is INLINED into SQL (SQLite cannot bind one): `object`,
 * `field` and the `groupBy` field / output key in `aggregate`, the table and
 * column names in `syncSchema` / `syncSchemasBatch` / `buildCreateTableSQL`,
 * and the index name and columns in `syncUniqueIndexes`. It threw a bare
 * `Error` — no `code`, no `status` — so `mapDataError`
 * (`packages/rest/src/error-response.ts`) reached none of its classifying
 * branches, fell through to its sanitised terminal and served a **500**. A
 * caller whose own identifier was refused was told the SERVER had faulted, and
 * an SDK reading a 5xx retries a request that can never succeed. Same class as
 * #11455 / #8931, one position over from #14113's alias half.
 *
 * ## What is asserted, and why not `toThrow()`
 *
 * A bare `expect(...).toThrow()` is blind in both directions here — it passed
 * for the whole life of the defect, on the very positions this card is about.
 * The refusal's wire identity is `code` + `status`, so those are what every
 * case below asserts, beside the offending text (#6144).
 *
 * ## The `mapDataError` reading — the benefit survives the boundary
 *
 * Measured by READING `packages/rest/src/error-response.ts` at `d62f990a9`
 * rather than assumed — and deliberately not by importing it: `@objectstack/rest`
 * is not a dependency of this package, and a test reaching outside its own
 * package is the `check:cross-package-test-inputs` shape.
 *
 *   - `mapDataError` → `classifyDataError`. Nine `error?.code === '…'` branches
 *     run first; `'INVALID_REQUEST'` matches none of them, and none of them
 *     reads the MESSAGE, so nothing intercepts this refusal ahead of the
 *     declared-status passthrough.
 *   - `const declaredStatus = declaredHttpStatus(error)` reads `error.status`
 *     (or `statusCode`) and keeps it when `400 <= s < 600`. Our 400 qualifies.
 *   - `declaredServerFaultAnswer` is the 5xx arm — not taken at 400.
 *   - The 4xx arm returns `{ status: 400, body: { error: <message>,
 *     ...thrownCodeFields(error, 400) } }`, and `thrownCodeFields` emits the
 *     closed ADR-0112 member verbatim when the code IS in the union. It is:
 *     `INVALID_REQUEST` is in `ERROR_CODE_LEDGER`, and this package now carries
 *     the provenance row naming itself as an emitter.
 *
 * So the two fields asserted here are exactly the two that door reads, and the
 * 500 becomes a 400 carrying `INVALID_REQUEST`.
 *
 * ## The accept set is UNTOUCHED — pinned, not claimed in prose
 *
 * `SAFE_IDENTIFIER` and every refusal message are byte-identical to before.
 * The last two `describe`s pin both halves: the same inputs are refused, and
 * safe identifiers still compile and run. That is what makes this an envelope
 * change rather than a gating change — the `groupBy` alias GATING question is
 * a separate card and stays open.
 *
 * ## Reverse verification — direction predicted BEFORE it was run
 *
 * Restore the bare `throw new Error(...)` in both `assertSafeIdentifier`
 * helpers (the pre-#14287 line):
 *
 * - every `code` / `status` assertion in this file goes RED on a COMPARISON
 *   (`undefined` vs `'INVALID_REQUEST'` / `400`), never by failing to throw.
 * - the accept-set `describe` stays GREEN in BOTH of its directions, because
 *   neither the predicate nor the prose moved. That asymmetry is the claim: a
 *   change that flipped which inputs are refused would take it red too.
 *
 * MEASURED, and the second prediction was too coarse — recorded rather than
 * quietly rewritten (19 failed / 13 passed across this file and the #14113
 * regression file):
 *
 * - the first prediction held exactly. All 19 failures are `toEqual`
 *   comparisons reading `{ code: undefined, status: undefined }`; not one is a
 *   "expected the transport to refuse …" — every input the gate refuses today
 *   is still refused with the ablated helper.
 * - the accept-set describe went half red, because its REFUSED half asserts
 *   the envelope in the same `toEqual` as the message. Its ACCEPTED half —
 *   the direction that would catch a TIGHTENED gate — stayed green, and the
 *   red half's diff shows the `message` line UNMARKED between `-` and `+`:
 *   only `code` and `status` moved. `still refuses the empty string` is the
 *   worked example, in the PR body.
 *
 * That unmarked message line is the sharper form of what the prediction was
 * reaching for: prose and predicate are provably untouched, so this is an
 * envelope change and not a gating one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import {
  makeLibsqlSqliteStub,
  asLibsqlClient,
  type LibsqlSqliteStub,
} from './libsql-sqlite-stub.testkit.js';
import {
  UNSAFE_IDENTIFIER_CODE,
  UNSAFE_IDENTIFIER_STATUS,
  unsafeIdentifierError,
} from './remote-transport.js';
import {
  assertSafeIdentifier as assertSafeBackfillIdentifier,
  backfillRemoteCanonicalColumn,
  type RemoteBackfillClient,
} from './remote-canonical-backfill.js';

/** The two fields the REST door reads, plus the sentence. */
const envelopeOf = (err: unknown) => ({
  code: (err as { code?: unknown }).code,
  status: (err as { status?: unknown }).status,
  message: (err as { message?: unknown }).message,
});

/** What every refusal in this file must carry. */
const ENVELOPE = { code: 'INVALID_REQUEST', status: 400 };

/**
 * Columns chosen so the accept-set half can EXECUTE: an underscore-leading
 * name, a name with digits and a SCREAMING_SNAKE one are all inside
 * `SAFE_IDENTIFIER`, and a group-by over a column that does not exist would
 * fail for the wrong reason.
 */
const OBJECT_DEF = {
  name: 'envelope_probe',
  fields: {
    id: { type: 'string' },
    region: { type: 'string' },
    amount: { type: 'number' },
    _region: { type: 'string' },
    region2: { type: 'string' },
    AMT_TOTAL: { type: 'number' },
  },
};

/** One payload, so the cases differ only in WHERE it was placed. */
const UNSAFE = 'amount"; DROP TABLE envelope_probe; --';

describe('[#14287] RemoteTransport — an unsafe identifier is a 400 INVALID_REQUEST, not an opaque 500', () => {
  let stub: LibsqlSqliteStub;
  let driver: TursoDriver;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({
      url: 'libsql://envelope-probe.turso.io',
      client: asLibsqlClient(stub),
    });
    await driver.connect();
    // The mode this suite is about — the one with its own hand-written SQL.
    expect(driver.transportMode).toBe('remote');
    await driver.syncSchema(OBJECT_DEF.name, OBJECT_DEF);
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  /** A driver on the same database that records every statement it sends. */
  const capturing = async () => {
    const seen: string[] = [];
    const spy = {
      ...stub,
      execute: async (stmt: unknown) => {
        seen.push((stmt as { sql: string }).sql);
        return stub.execute(stmt);
      },
    };
    const t = new TursoDriver({
      url: 'libsql://envelope-probe.turso.io',
      client: asLibsqlClient(spy),
    });
    await t.connect();
    return { t, seen };
  };

  /** Drive `fn` and hand back the thrown value — loudly, if it resolves. */
  const refusalFrom = async (what: string, fn: () => Promise<unknown>): Promise<unknown> =>
    fn().then(
      () => {
        throw new Error(`expected the transport to refuse the ${what}`);
      },
      (e) => e,
    );

  describe('the QUERY positions — reached by an ordinary aggregate over HTTP', () => {
    it('`object` refuses with the envelope, and sends nothing', async () => {
      const { t, seen } = await capturing();
      const err = await refusalFrom('object', () =>
        t.aggregate(UNSAFE, {
          object: UNSAFE,
          aggregations: [{ function: 'count', alias: 'n' }],
        } as never),
      );
      expect(envelopeOf(err)).toEqual({
        ...ENVELOPE,
        // The OFFENDING TEXT, not merely the sentence (#6144).
        message: `RemoteTransport: unsafe identifier rejected: "${UNSAFE}"`,
      });
      // A refused identifier must not cost a round trip.
      expect(seen).toEqual([]);
    });

    it('the aggregation `field` refuses with the envelope, and sends nothing', async () => {
      const { t, seen } = await capturing();
      const err = await refusalFrom('aggregation field', () =>
        t.aggregate(OBJECT_DEF.name, {
          object: OBJECT_DEF.name,
          // The alias is safe on purpose, so the refusal can only be the field.
          aggregations: [{ function: 'sum', field: UNSAFE, alias: 'n' }],
        } as never),
      );
      expect(envelopeOf(err)).toEqual({
        ...ENVELOPE,
        message: `RemoteTransport: unsafe identifier rejected: "${UNSAFE}"`,
      });
      expect(seen).toEqual([]);
    });

    it('the `groupBy` FIELD refuses with the envelope, and sends nothing', async () => {
      const { t, seen } = await capturing();
      const err = await refusalFrom('groupBy field', () =>
        t.aggregate(OBJECT_DEF.name, {
          object: OBJECT_DEF.name,
          groupBy: [UNSAFE],
          aggregations: [{ function: 'count', alias: 'n' }],
        } as never),
      );
      expect(envelopeOf(err)).toEqual({
        ...ENVELOPE,
        message: `RemoteTransport: unsafe identifier rejected: "${UNSAFE}"`,
      });
      expect(seen).toEqual([]);
    });

    it('the `groupBy` OUT KEY refuses with the envelope — gating unchanged, envelope added', async () => {
      // ⚠️ Deliberate scope line. Whether this position should be ESCAPED
      // rather than refused (as `driver-sql` escapes it post-#13714, and as
      // #14113 changed the aggregation alias to do one position over) is a
      // separate, still-open card: it MOVES the accept set. This case pins that
      // the refusal itself is unchanged and only its envelope is new — so the
      // day that card lands, this is the test that has to be rewritten
      // deliberately rather than found red by surprise.
      const { t, seen } = await capturing();
      const err = await refusalFrom('groupBy alias', () =>
        t.aggregate(OBJECT_DEF.name, {
          object: OBJECT_DEF.name,
          groupBy: [{ field: 'region', alias: 'envelope_probe.region' }],
          aggregations: [{ function: 'count', alias: 'n' }],
        } as never),
      );
      expect(envelopeOf(err)).toEqual({
        ...ENVELOPE,
        message: 'RemoteTransport: unsafe identifier rejected: "envelope_probe.region"',
      });
      expect(seen).toEqual([]);
    });
  });

  describe('the DDL positions — reached by publishing an object on a live server', () => {
    it('`syncSchema` refuses an unsafe TABLE name with the envelope', async () => {
      const { t } = await capturing();
      const err = await refusalFrom('table name', () =>
        t.syncSchema(UNSAFE, { name: UNSAFE, fields: { id: { type: 'string' } } }),
      );
      expect(envelopeOf(err)).toEqual({
        ...ENVELOPE,
        message: `RemoteTransport: unsafe identifier rejected: "${UNSAFE}"`,
      });
    });

    it('`syncSchema` refuses an unsafe COLUMN name with the envelope — the CREATE leg', async () => {
      const { t } = await capturing();
      const err = await refusalFrom('created column name', () =>
        t.syncSchema('envelope_create', {
          name: 'envelope_create',
          fields: { id: { type: 'string' }, [UNSAFE]: { type: 'string' } },
        }),
      );
      expect(envelopeOf(err)).toEqual({
        ...ENVELOPE,
        message: `RemoteTransport: unsafe identifier rejected: "${UNSAFE}"`,
      });
    });

    it('`syncSchema` refuses an unsafe COLUMN name with the envelope — the ALTER leg', async () => {
      // A second sync against a table that already exists takes the
      // `ALTER TABLE … ADD COLUMN` limb, a different call site from the CREATE
      // one above — the same gate reached by a different route.
      const { t } = await capturing();
      const err = await refusalFrom('added column name', () =>
        t.syncSchema(OBJECT_DEF.name, {
          ...OBJECT_DEF,
          fields: { ...OBJECT_DEF.fields, [UNSAFE]: { type: 'string' } },
        }),
      );
      expect(envelopeOf(err)).toEqual({
        ...ENVELOPE,
        message: `RemoteTransport: unsafe identifier rejected: "${UNSAFE}"`,
      });
    });

    it('`syncSchemasBatch` refuses an unsafe object name with the envelope', async () => {
      const { t } = await capturing();
      const err = await refusalFrom('batched object name', () =>
        t.syncSchemasBatch([
          { object: OBJECT_DEF.name, schema: OBJECT_DEF },
          { object: UNSAFE, schema: { name: UNSAFE, fields: { id: { type: 'string' } } } },
        ]),
      );
      expect(envelopeOf(err)).toEqual({
        ...ENVELOPE,
        message: `RemoteTransport: unsafe identifier rejected: "${UNSAFE}"`,
      });
    });
  });

  describe('the BACKFILL producer — same envelope, and what it is worth there', () => {
    it('the free `assertSafeIdentifier` throws the identical envelope', () => {
      // Pinned DIRECTLY because nothing else can see it: both of that module's
      // callers flatten the throw into a report by design (ADR-0053 D-B3), so
      // an indirect assertion would pin the message and silently pin NOTHING
      // about `code`/`status` — the phantom-check shape.
      let thrown: unknown = new Error('expected the backfill helper to refuse');
      try {
        assertSafeBackfillIdentifier(UNSAFE);
      } catch (e) {
        thrown = e;
      }
      expect(envelopeOf(thrown)).toEqual({
        ...ENVELOPE,
        message: `remote canonical backfill: unsafe identifier rejected: "${UNSAFE}"`,
      });
    });

    it('a safe identifier still passes it untouched', () => {
      expect(() => assertSafeBackfillIdentifier('created_at')).not.toThrow();
    });

    it('the backfill still REPORTS rather than throws, and sends no statement', async () => {
      // The observable half on that path, and the reason the envelope above is
      // defence in depth rather than a wire answer: `report.error` is a STRING,
      // so `code`/`status` are dropped here by design. A migration may not take
      // a boot down.
      const neverCalled: RemoteBackfillClient = {
        execute: async () => {
          throw new Error('a refused identifier must not reach the database');
        },
        batch: async () => {
          throw new Error('a refused identifier must not reach the database');
        },
      };
      const report = await backfillRemoteCanonicalColumn(
        neverCalled,
        { table: UNSAFE, field: 'at', kind: 'datetime' },
        (_kind, columnSql) => columnSql,
      );
      expect(report.error).toBe(
        `remote canonical backfill: unsafe identifier rejected: "${UNSAFE}"`,
      );
      expect(report.canonical).toBe(false);
      expect(report).not.toHaveProperty('code');
      expect(report).not.toHaveProperty('status');
    });
  });

  describe('the accept set is UNTOUCHED — this card added an envelope, not a gate', () => {
    // Driven through the `groupBy` FIELD position, which has no `|| '*'`
    // default in front of it, so an empty string reaches the gate rather than
    // being read as "count everything".
    const groupByField = async (name: string) => {
      const { t, seen } = await capturing();
      const run = t.aggregate(OBJECT_DEF.name, {
        object: OBJECT_DEF.name,
        groupBy: [name],
        aggregations: [{ function: 'count', alias: 'n' }],
      } as never);
      return { run, seen };
    };

    it.each([
      ['a quote that would close the identifier', 'amount"'],
      ['a dot — the qualified-reference spelling', 'cube.measure'],
      ['a leading digit', '1region'],
      ['a space', 'my column'],
      ['a hyphen', 'my-column'],
      ['the empty string', ''],
      ['a stringified object, the #6212 shape', '[object Object]'],
    ])('still refuses %s, now with the envelope', async (_why, name) => {
      const { run } = await groupByField(name);
      const err = await run.then(
        () => {
          throw new Error(`expected ${JSON.stringify(name)} to be refused`);
        },
        (e) => e,
      );
      expect(envelopeOf(err)).toEqual({
        ...ENVELOPE,
        message: `RemoteTransport: unsafe identifier rejected: "${name}"`,
      });
    });

    it.each([
      ['a plain snake_case column', 'region'],
      ['a leading underscore', '_region'],
      ['digits after the first character', 'region2'],
      ['SCREAMING_SNAKE', 'AMT_TOTAL'],
    ])('still ACCEPTS %s — the gate did not tighten', async (_why, name) => {
      const { run, seen } = await groupByField(name);
      await run;
      // The proof that nothing became stricter is a statement reaching the
      // database and running, not merely the absence of a throw.
      expect(seen).toEqual([
        `SELECT "${name}", count(*) AS "n" FROM "envelope_probe" GROUP BY "${name}"`,
      ]);
    });
  });

  describe('the envelope constants are the wire vocabulary, not a local spelling', () => {
    it('names the ledger-registered code and the 4xx status once, for both producers', () => {
      // The ledger row under `@objectstack/driver-turso` registers exactly this
      // string; a rename on either side has to move both, which is the pairing
      // `check:error-code-provenance` reads.
      expect(UNSAFE_IDENTIFIER_CODE).toBe('INVALID_REQUEST');
      expect(UNSAFE_IDENTIFIER_STATUS).toBe(400);
      expect(envelopeOf(unsafeIdentifierError('x'))).toEqual({ ...ENVELOPE, message: 'x' });
    });
  });
});
