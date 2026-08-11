// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5041 → #5222] The `{ $field }` POSITION MATRIX: which spellings of a
 * cross-field comparison this driver compiles, and which it refuses.
 *
 * ## What changed, and what deliberately did not
 *
 * #5041 measured the defect and installed a refusal in every position: pushed
 * down to SQL, the reference object was handed to Knex as a BIND VALUE, so
 * sqlite answered with a bare `TypeError` ("can only bind numbers, strings,
 * bigints, buffers, and null") carrying no `code` and no `status` — outside
 * the ADR-0112 envelope, and therefore an opaque 500 to the client. Inside an
 * `$in` list it did not even crash: the query compiled, ran, and returned ZERO
 * ROWS. The maintainer's adjudication took the minimum path and tracked
 * column-to-column compilation as its own capability.
 *
 * #5222 is that capability, and it NARROWS the refusal rather than removing
 * it. This file is the matrix of the two arms — the same position grid the
 * #5041 suite carried (six scalar operators, array triples symbolic and word,
 * `$and`/`$or`/`$not` nesting, the string family, `$in`/`$between` list
 * members), re-read as supported-vs-refused.
 *
 * **The row semantics are pinned elsewhere, on purpose.** This file asserts
 * that a spelling compiles and which rows it returns for one small fixture;
 * `sql-driver-cross-field-conformance.test.ts` is what proves those rows are
 * the SAME rows the in-memory evaluator returns, over a fixture built to carry
 * every NULL arrangement. Keep the equivalence claims there — a matrix that
 * also tried to be the conformance suite would state the semantics twice and
 * let the two copies drift.
 *
 * **Negative control** for the other half of the contract (the memory path
 * resolves `$field` against the record, dot paths included) lives with that
 * implementation and is untouched by this change:
 * `packages/formula/src/matches-filter.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import { parseFilterAST, type FilterCondition } from '@objectstack/spec/data';

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

async function refusalOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this filter, but it resolved');
}

describe('[#5222] SqlDriver `$field` position matrix — compiled vs refused', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          note: { type: 'text', name: 'note' },
          amount: { type: 'number', name: 'amount' },
          budget: { type: 'number', name: 'budget' },
          organization_id: { type: 'text', name: 'organization_id' },
        },
      } as any,
    ]);
    // `amount > budget` is TRUE for this row and `amount = budget` is FALSE, so
    // a compiled comparison and a dropped predicate are distinguishable — the
    // failure mode stays visible rather than implied.
    await driver.create('deal', {
      id: '1', stage: 'won', note: 'won', amount: 10, budget: 5, organization_id: 'o1',
    });
  });

  const find = (where: unknown) =>
    driver.find('deal', { fields: ['id'], where: where as FilterCondition });
  const ids = async (where: unknown) => (await find(where)).map((r: any) => String(r.id));

  // ── SUPPORTED: the six scalar comparison operators ────────────────────────
  //
  // The issue's repro is the first row. Each expectation is decided by the one
  // seeded row (amount 10, budget 5), so a predicate that compiled to
  // something unrelated — or was dropped entirely — changes the answer.
  describe('the six scalar operators compile to a column-to-column comparison', () => {
    const supported: Array<[string, unknown, string[]]> = [
      ['$gt — the #5041 repro', { amount: { $gt: { $field: 'budget' } } }, ['1']],
      ['$gte', { amount: { $gte: { $field: 'budget' } } }, ['1']],
      ['$lt', { amount: { $lt: { $field: 'budget' } } }, []],
      ['$lte', { amount: { $lte: { $field: 'budget' } } }, []],
      ['$eq', { amount: { $eq: { $field: 'budget' } } }, []],
      ['$ne', { amount: { $ne: { $field: 'budget' } } }, ['1']],
    ];

    for (const [name, where, expected] of supported) {
      it(`${name} → ${expected.length ? 'matches' : 'excludes'} the row`, async () => {
        expect(await ids(where)).toEqual(expected);
      });
    }

    it('a reference object carrying EXTRA keys still resolves, matching the memory path', async () => {
      // `fieldReferenceOf` recognises "an object, not an array, carrying a
      // string `$field`" because `formula`'s `resolveValue` recognises exactly
      // that (`'$field' in raw`) — both ignore any other key, and
      // `FieldReferenceSchema` is a non-strict zod object, so the extra key is
      // stripped rather than rejected. Pinned as SUPPORTED rather than left
      // unstated: a driver that recognised a NARROWER shape than the evaluator
      // would silently bind the remainder as a literal again, which is the
      // #5041 defect returning at one more spelling.
      expect(await ids({ amount: { $gt: { $field: 'budget', extra: 1 } } })).toEqual(['1']);
    });

    it('emits a real column reference, not a bound literal', async () => {
      // The distinguishing measurement, and the reason this assertion exists
      // beside the row-level ones: a compiler that bound the STRING 'budget'
      // would answer `[]` for `$gt` (10 > 'budget' is false in SQLite's
      // storage-class ordering) and would keep answering plausibly for other
      // shapes. Comparing the column to itself can only be satisfied by a
      // genuine identifier on the right-hand side.
      expect(await ids({ amount: { $eq: { $field: 'amount' } } })).toEqual(['1']);
      expect(await ids({ budget: { $lt: { $field: 'amount' } } })).toEqual(['1']);
    });
  });

  // ── SUPPORTED: the authored array-triple dialect, once lowered ───────────
  //
  // #5158 made `FilterArray` INPUT-ONLY authoring sugar: both doors into the
  // runtime lower it before a driver is reached, so the triple is exercised
  // the way it actually arrives. `>` and `gt` lower to `$gt`; the `=` / `equals`
  // spellings lower to the BARE form, which has its own arm below.
  describe('array triples compile once lowered by parseFilterAST (#5158)', () => {
    const triples: Array<[string, unknown]> = [
      ['symbolic op', [['amount', '>', { $field: 'budget' }]]],
      ['word op', [['amount', 'gt', { $field: 'budget' }]]],
    ];

    for (const [name, authored] of triples) {
      it(`${name} → lowers to $gt and matches`, async () => {
        expect(await ids(parseFilterAST(authored as any))).toEqual(['1']);
      });
    }

    it('a raw (unlowered) array still hits the array refusal, unchanged (#5158)', async () => {
      // Not a `$field` refusal — the array never reaches the comparand gate.
      // Pinned so a future reader does not mistake the old suite's passing
      // "array triple" rows for evidence about cross-field support: they were
      // refused for being arrays.
      const err = await refusalOf(() => find([['amount', '>', { $field: 'budget' }]]));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });
  });

  // ── SUPPORTED: nested under every combinator ─────────────────────────────
  describe('the combinators carry a cross-field leaf', () => {
    it('under $and', async () => {
      expect(await ids({ $and: [{ amount: { $gt: { $field: 'budget' } } }] })).toEqual(['1']);
    });
    it('under $or', async () => {
      expect(await ids({ $or: [{ amount: { $gt: { $field: 'budget' } } }] })).toEqual(['1']);
    });
    it('under $not — negated, and the row drops out', async () => {
      expect(await ids({ $not: { amount: { $gt: { $field: 'budget' } } } })).toEqual([]);
    });
    it('under $not with the comparison inverted — the row comes back', async () => {
      expect(await ids({ $not: { amount: { $lt: { $field: 'budget' } } } })).toEqual(['1']);
    });
  });

  // ── REFUSED: the boundary of v1 ──────────────────────────────────────────
  //
  // Every one of these keeps the #5041 envelope. The reasons are recorded with
  // the cases in `cross-field-conformance-cases.ts`, which drives the same
  // list against both SQL drivers; this block pins the ones whose WORDING a
  // caller has to act on, plus the positions unique to this matrix.
  describe('refused positions keep the INVALID_FILTER envelope', () => {
    const refused: Array<[string, unknown, string]> = [
      ['a dotted relation path', { amount: { $gt: { $field: 'a.b' } } }, 'dotted path'],
      ['an undeclared column', { amount: { $gt: { $field: 'nope' } } }, 'not a declared field'],
      ['the tenant column as referent', { stage: { $eq: { $field: 'organization_id' } } }, 'tenant-isolation column'],
      ['the tenant column as target', { organization_id: { $eq: { $field: 'stage' } } }, 'tenant-isolation column'],
      ['a cross-class comparison', { amount: { $gt: { $field: 'stage' } } }, 'stored as'],
      ['$in list member', { amount: { $in: [{ $field: 'budget' }, 1] } }, 'index 0'],
      ['$nin list member', { amount: { $nin: [{ $field: 'budget' }] } }, 'index 0'],
      ['$between lower bound', { amount: { $between: [{ $field: 'budget' }, 100] } }, 'index 0'],
      ['$between upper bound', { amount: { $between: [0, { $field: 'budget' }] } }, 'index 1'],
      ['$startsWith', { stage: { $startsWith: { $field: 'note' } } }, '$field'],
      ['$contains', { stage: { $contains: { $field: 'note' } } }, '$field'],
      ['$endsWith', { stage: { $endsWith: { $field: 'note' } } }, '$field'],
      ['$notContains', { stage: { $notContains: { $field: 'note' } } }, '$field'],
      ['$icontains', { stage: { $icontains: { $field: 'note' } } }, '$field'],
    ];

    for (const [name, where, fragment] of refused) {
      it(`${name} → 400 INVALID_FILTER naming the reason`, async () => {
        const err = await refusalOf(() => find(where));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err).not.toBeInstanceOf(TypeError);
        expect(err.message).not.toContain('can only bind');
        expect(err.message).not.toContain('[sql-driver]');
        expect(err.message).toContain(fragment);
      });
    }

    it('a refused position stays refused INSIDE a combinator', async () => {
      // The gate sits at the comparison emitter, which every combinator
      // recurses into — so nesting is not a way around it. Worth pinning
      // because a validation placed at the top-level entry instead would pass
      // this and refuse only the flat spelling.
      const err = await refusalOf(() =>
        find({ $or: [{ stage: 'won' }, { amount: { $gt: { $field: 'organization_id' } } }] }),
      );
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('tenant-isolation column');
    });

    it('the bare `{ field: { $field } }` spelling names the operator form to use', async () => {
      // HAND-AUTHORED, and that spelling matters (#7597). This used to be
      // derived from `parseFilterAST(['amount', '=', ref])`, because the sink
      // dropped the operator on an equality triple and produced exactly this
      // shape — the defect #7597 fixed. The sink now lowers that triple to
      // `{ $eq: ref }` (pinned in the conformance suite's authoring arm), so
      // the bare form no longer has an authoring route into the driver.
      //
      // The refusal itself is UNCHANGED and stays pinned here on the shape a
      // caller can still write by hand: the in-memory evaluator answers
      // `false` for it rather than reading it as an equality (#6520's
      // unknown-operator posture, deliberately kept), so compiling it would
      // open a divergence — and the message points at the `$eq` spelling that
      // does compile.
      const err = await refusalOf(() => find({ amount: { $field: 'budget' } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$eq');
      expect(err.message).toContain('budget');
    });

    it('the equality TRIPLE no longer lowers to that bare spelling (#7597)', async () => {
      // The other half of the case above, and the reason it had to change:
      // the authoring route that used to reach the bare form now reaches the
      // compiled one. Asserted here — beside the refusal it replaced — so a
      // regression that restores the bare lowering fails next to the pin
      // whose comment explains it, not only in the conformance sweep.
      const lowered = parseFilterAST([['amount', '=', { $field: 'budget' }]] as any);
      expect(lowered).toEqual({ amount: { $eq: { $field: 'budget' } } });
      await expect(find(lowered)).resolves.toBeDefined();
    });
  });

  // ── The general arm #5041 installed, untouched by the narrowing ──────────
  //
  // A KNOWN operator whose comparand is a shape no dialect can bind. These
  // were the same bare `TypeError` before #5041; the `$field` narrowing must
  // not have re-opened any of them, since `fieldReferenceOf` recognises only
  // an object carrying a STRING `$field`.
  describe('non-$field uncompilable comparands stay refused (#5041/#5234)', () => {
    const uncompilable: Array<[string, unknown]> = [
      ['$gt with a plain object', { amount: { $gt: { foo: 1 } } }],
      ['$eq with a plain object', { amount: { $eq: { foo: 1 } } }],
      ['$ne with a plain object', { amount: { $ne: { foo: 1 } } }],
      ['$gt with an array', { amount: { $gt: [1, 2] } }],
      ['$eq with an array', { amount: { $eq: [1, 2] } }],
      ['a field spec with no operators', { amount: {} }],
      ['a $field whose value is not a string', { amount: { $gt: { $field: 42 } } }],
    ];

    for (const [name, where] of uncompilable) {
      it(`${name} → 400 INVALID_FILTER instead of a bare TypeError`, async () => {
        const err = await refusalOf(() => find(where));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err).not.toBeInstanceOf(TypeError);
        expect(err.message).not.toContain('can only bind');
        expect(err.message).not.toContain('[sql-driver]');
      });
    }
  });

  // ── The guard must not narrow what already compiled ─────────────────────
  describe('comparands that legitimately compile are untouched', () => {
    it('a scalar equality still matches', async () => {
      expect(await ids({ stage: 'won' })).toEqual(['1']);
    });

    it('$in with a real value list still matches', async () => {
      expect(await ids({ amount: { $in: [10, 20] } })).toEqual(['1']);
    });

    it('$nin with a real value list still matches', async () => {
      expect(await ids({ amount: { $nin: [99] } })).toEqual(['1']);
    });

    it('$between with a real range still matches', async () => {
      expect(await ids({ amount: { $between: [0, 100] } })).toEqual(['1']);
    });

    it('a Date comparand still binds', async () => {
      await expect(find({ amount: { $gt: new Date(0) } })).resolves.toBeDefined();
    });

    it('a null comparand is still a null predicate, not a refusal', async () => {
      expect(await ids({ budget: { $ne: null } })).toEqual(['1']);
    });

    it('an authored array triple with a scalar still matches, once lowered (#5158)', async () => {
      expect(await ids(parseFilterAST([['amount', '>', 1]]))).toEqual(['1']);
    });

    it('a literal string comparand is never mistaken for a column reference', async () => {
      // The inverse risk of this change: `{ stage: 'note' }` must compare
      // against the TEXT 'note', not against the column of that name — the
      // seeded row has stage 'won' and note 'won', so a compiler that resolved
      // the literal as a column would match it.
      expect(await ids({ stage: 'note' })).toEqual([]);
      expect(await ids({ stage: { $eq: 'note' } })).toEqual([]);
    });

    it('the malformed-$between refusal keeps its own descriptive message', async () => {
      const err = await refusalOf(() => find({ amount: { $between: 5 } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('[min, max]');
    });
  });
});
