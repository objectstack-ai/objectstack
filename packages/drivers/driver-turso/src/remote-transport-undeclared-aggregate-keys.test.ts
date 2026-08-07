// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6321] The remote half of the same deletion: `RemoteTransport.aggregate` no
 * longer reads `query.aggregate` or `agg.func`.
 *
 * ```ts
 * const aggregations = query?.aggregations || query?.aggregate || [];
 * const func         = String(agg.function || agg.func || '');
 * ```
 *
 * Neither key is declared anywhere in `packages/spec`. The twin note in
 * `driver-sql`'s `sql-driver-aggregate-undeclared-keys.test.ts` carries the
 * measurement and the ADR-0049 reasoning; this file exists because `TursoDriver`
 * picks its face from `url`, so a deletion done on one face and not the other is
 * the #5907 / #6203 fork all over again — one query, two answers, decided by a
 * connection string.
 *
 * # The `|| ''` went with it, and that is a wording change worth naming
 *
 * The third limb only ever fired when NEITHER key was written. It coalesced the
 * missing name to `''`, so this face quoted `""` back at the caller while the
 * local driver — reading `agg.function || agg.func`, then interpolating — quoted
 * `"undefined"`. Same off-contract input, two messages. It was unreachable in
 * practice while `agg.func` was read (a `func:`-spelling caller landed on the
 * alias limb, not here); deleting the alias is exactly what makes it reachable,
 * so it is closed in the same breath rather than left as a new fork (#5240).
 *
 * # Reverse verification — direction predicted BEFORE it was run, per channel
 *
 * Restore both limbs on this face only:
 *
 * - `pnpm test`: the two runtime cases go RED — the `aggregate:` case because
 *   the transport emits a `count(...)` column it should not, the `func:` case
 *   through `refusalOf`'s "it compiled" branch. The PARITY case goes red as
 *   well, failing on its own `expected the transport to refuse`.
 * - `pnpm typecheck`: unchanged, green. Excess-property checking does not care
 *   what the body reads.
 *
 * Restore both limbs on BOTH faces and the parity case stays RED — which is
 * worth stating explicitly, because the sibling parity block in
 * `remote-transport-aggregate-function-refusal.test.ts` behaves the OPPOSITE
 * way and its PR recorded the surprise. That one compares two error identities
 * and nothing else, so reverting both faces leaves them agreeing on
 * `undefined`/`undefined` and it goes green: a parity test measures AGREEMENT,
 * not correctness. This one asserts each face REFUSES before it compares
 * anything, so the correctness half fires first on whichever face drifted — and
 * the failure names it (`expected the transport to refuse` vs `expected the
 * local driver to refuse`). It therefore cannot be satisfied by breaking both
 * faces equally, and the `toContain('"undefined"')` at the end guards the
 * remaining hole: two faces agreeing on the WRONG spelling.
 *
 * Measured after writing the above, with both limbs restored on both faces —
 * 3 failed / 4 passed of 7, and the parity case among the three, as predicted:
 *
 * ```
 * drops an `aggregate:` list -> expected 'SELECT "stage" FROM "deal" GROUP BY "stage"'
 *                              received 'SELECT "stage", count("stage") AS "n" …'
 * refuses a `func:`-spelled  -> expected the transport to refuse, but it compiled to […]
 * local/remote parity        -> expected the transport to refuse
 * ```
 *
 * `pnpm typecheck` was clean under that revert, and went red only when the
 * signature itself was put back to `any`:
 * `remote-transport-undeclared-aggregate-keys.test.ts(106,7)` and `(112,7)`,
 * `error TS2578: Unused '@ts-expect-error' directive.`
 */

import { describe, it, expect, vi } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { RemoteTransport } from './remote-transport.js';
import type { DriverQuery } from '@objectstack/spec/contracts';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** The narrowed door, read off the signature rather than restated. */
type AggregateQuery = Parameters<RemoteTransport['aggregate']>[1];

/** See the twin's note: `as unknown as DriverQuery`, never `as any`. */
const offContract = (q: Record<string, unknown>) => q as unknown as DriverQuery;

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

/** The other face of `TursoDriver`: local/replica, which inherits `SqlDriver`. */
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
      },
    } as any,
  ]);
  return d;
}

describe('[#6321] RemoteTransport.aggregate reads only the declared aggregation keys', () => {
  describe('the undeclared spellings do not compile', () => {
    it('rejects `aggregate:` where the protocol declares `aggregations:`', () => {
      // @ts-expect-error [#6321] `aggregate` is not a key of QueryAST.
      const undeclaredList: AggregateQuery = { aggregate: [{ function: 'count', field: 'stage', alias: 'n' }] };
      expect(Object.keys(undeclaredList)).toEqual(['aggregate']);
    });

    it('rejects `func:` where the protocol declares `function:`', () => {
      // @ts-expect-error [#6321] `func` is not a key of AggregationNode.
      const undeclaredFunc: AggregateQuery = { aggregations: [{ func: 'count', field: 'stage', alias: 'n' }] };
      expect(Object.keys(undeclaredFunc)).toEqual(['aggregations']);
    });

    it('admits the declared spelling — the pin is not green because nothing fits', () => {
      const declared: AggregateQuery = {
        groupBy: ['stage'],
        aggregations: [{ function: 'count', field: 'stage', alias: 'n' }],
      };
      expect(declared.aggregations).toHaveLength(1);
    });
  });

  describe('an off-contract caller that writes them anyway', () => {
    const refusalOf = async (query: DriverQuery): Promise<WireBearingError> => {
      const { t, calls } = transportWithCapturingClient();
      try {
        await t.aggregate('deal', query);
      } catch (e) {
        // A refused aggregation must not have reached the database on its way
        // to throwing — the same guard the function-refusal twin makes.
        expect(calls).toEqual([]);
        return e as WireBearingError;
      }
      throw new Error(`expected the transport to refuse, but it compiled to ${JSON.stringify(calls)}`);
    };

    it('drops an `aggregate:` list — no aggregate column reaches the SQL', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate(
        'deal',
        offContract({ groupBy: ['stage'], aggregate: [{ function: 'count', field: 'stage', alias: 'n' }] }),
      );

      // The grouping still compiles; the undeclared key contributes nothing.
      expect(calls[0].sql).toBe('SELECT "stage" FROM "deal" GROUP BY "stage"');
      expect(calls[0].sql).not.toContain('count(');
    });

    it('refuses a `func:`-spelled aggregation with INVALID_QUERY / 400', async () => {
      const err = await refusalOf(
        offContract({ aggregations: [{ func: 'count', field: 'stage', alias: 'n' }] }),
      );
      expect(err.code).toBe('INVALID_QUERY');
      expect(err.status).toBe(400);
      expect(err.message).toContain('is not a declared aggregate function');
    });
  });

  // ── The cross-package half: one condition, one wording ─────────────────────

  describe('local/remote parity (#5240)', () => {
    it('answers a `func:`-spelled aggregation identically on both faces', async () => {
      // Compared as RUNTIME messages from the two packages, never as two copies
      // of a literal: a shared constant agrees with itself however far the two
      // faces drift. This is also the case that pins the deleted `|| ''` —
      // before it went, this face said `""` and the local one said `"undefined"`.
      const query = offContract({ aggregations: [{ func: 'count', field: 'stage', alias: 'n' }] });

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
      expect(remote.message).toBe(local.message);
      expect(remote.message).toContain('"undefined"');
    });
  });

  // ── Control: the compiled vocabulary is untouched ──────────────────────────

  it('emits the same SQL as ever for the declared spelling', async () => {
    const { t, calls } = transportWithCapturingClient();
    await t.aggregate('deal', {
      groupBy: ['stage'],
      aggregations: [{ function: 'count', field: 'stage', alias: 'n' }],
    });
    expect(calls[0].sql).toBe('SELECT "stage", count("stage") AS "n" FROM "deal" GROUP BY "stage"');
  });
});
