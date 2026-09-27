// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19757] An ARRAY in the EQUALITY slot is refused at the shared face BEFORE
 * `translateFilter` sees it — this driver's pin on the 2026-09-23 ruling.
 *
 * ## What this driver did with the shape, measured
 *
 * `parseFilterAST([['tags', 'equals', ['a']]])` lowers to the implicit form
 * `{ tags: ['a'] }` (so do `=`, `==` and `eq`). Until the ruling that shape
 * passed both shared comparand doors, and this driver was the one backend that
 * ANSWERED it rather than refusing: `translateFilter` has no gate for the slot
 * and emits it unchanged (the reverse-direction pin at the bottom keeps that
 * visible), and `MongoDBDriver.find()` hands its output to the server with
 * nothing in between. On the server that is MongoDB's equality on an array
 * operand, which selects a stored array EQUAL to `['a']` or HOLDING `['a']` as
 * one of its elements — never a row storing the scalar `'a'`.
 *
 * That server reading is taken through **mingo 7.2.4, the named proxy** (the
 * MongoDB query-semantics library `driver-memory` hands its filters to), over
 * the rows `['a']`, `'a'`, `['a','b']`, `['b','a']`, `[['a'],'x']`,
 * `[['a']]`, `'b'` and `[]`: `{ tags: ['a'] }` and `{ tags: { $eq: ['a'] } }`
 * each selected `['a']`, `[['a'],'x']` and `[['a']]`, and `{ tags: [] }`
 * selected `[]`. ⚠️ **A live `mongod` is NOT MEASURED** — this fleet cannot
 * fetch a mongod binary (#5517), and mingo is not a dependency of this package,
 * so the proxy reading was taken outside this suite, recorded here and in the
 * PR, and is not re-run by it. Every other backend refused the same shape
 * (`driver-sql`, `driver-memory`) or excluded every row (`@objectstack/formula`),
 * so one stored filter answered silently on exactly this backend.
 *
 * ## What the ruling changed, and what it deliberately did not
 *
 * The comparand-SHAPE face (`@objectstack/spec/data`, `assertListComparandShapes`)
 * now refuses the shape — implicit and `$eq` — with `INVALID_FILTER` / 400, and
 * it runs inside `parseFilterAST` and at the engine's lowering seam on both
 * engine doors. ⛔ This driver's source is NOT edited: the ruling's point is
 * that the one shared door answers for every driver at once, so a second,
 * driver-local copy of the rule would be the "one declared contract, one
 * implementation per backend" shape the face exists to end.
 *
 * ## Why the translator and a recording engine, not a live mongod
 *
 * The same reason as `mongodb-null-comparand-refusal.test.ts`: `translateFilter`
 * is a pure function whose output IS the query document MongoDB receives, and a
 * suite that needs `mongodb-memory-server` is skipped whenever its download is
 * blocked — a test of a ruling that can be skipped is not a test of the ruling.
 * The measurement here is at the compile face: every door a query crosses
 * refuses the shape, and `translateFilter` is never called.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { translateFilter } from './mongodb-filter.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const deal = {
  name: 'deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    stage: { name: 'stage', type: 'text' as const },
    tags: { name: 'tags', type: 'text' as const },
  },
};

/**
 * A driver whose read path is THIS package's translator and nothing else: every
 * `where` the engine hands it is passed to `translateFilter`, and every call is
 * counted. "translateFilter never saw it" is therefore a count, not an
 * inference from a thrown error.
 */
function makeTranslatingDriver() {
  const translated: unknown[] = [];
  const translate = (ast: { where?: unknown } | undefined): unknown => {
    const doc = translateFilter(ast?.where);
    translated.push(doc);
    return doc;
  };
  const driver = {
    name: 'translating-mongodb-double',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(_o: string, ast: { where?: unknown }) { translate(ast); return []; },
    async findOne(_o: string, ast: { where?: unknown }) { translate(ast); return null; },
    async count(_o: string, ast: { where?: unknown }) { translate(ast); return 0; },
    async aggregate(_o: string, ast: { where?: unknown }) { translate(ast); return []; },
    async create(_o: string, data: Record<string, unknown>) { return { ...data }; },
    async update() { return null; },
    async updateMany(_o: string, ast: { where?: unknown }) { translate(ast); return 0; },
    async delete() { return true; },
    async deleteMany(_o: string, ast: { where?: unknown }) { translate(ast); return 0; },
    async bulkCreate(_o: string, rows: Record<string, unknown>[]) { return rows; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };
  return { driver, translated };
}

const refusalOf = async (p: Promise<unknown>): Promise<WireBearingError | null> =>
  p.then(() => null, (e: unknown) => e as WireBearingError);

describe('[#19757] the shared face refuses an array in the equality slot BEFORE translateFilter', () => {
  describe('the face a direct caller composes: parseFilterAST, then translateFilter', () => {
    const composed = (where: unknown): { translated: boolean; error: WireBearingError | null } => {
      let translated = false;
      try {
        const lowered = parseFilterAST(where);
        translated = true;
        translateFilter(lowered);
        return { translated, error: null };
      } catch (e) {
        return { translated, error: e as WireBearingError };
      }
    };

    it.each([
      ['the FilterArray sugar on "equals"', [['tags', 'equals', ['a']]], 'where.tags'],
      ['the FilterArray sugar on "="', [['tags', '=', ['a', 'b']]], 'where.tags'],
      ['the implicit object form', { tags: ['a'] }, 'where.tags'],
      ['an EMPTY array', { tags: [] }, 'where.tags'],
      ['explicit $eq', { tags: { $eq: ['a'] } }, 'where.tags.$eq'],
      ['nested under $or', { $or: [{ stage: 'won' }, { tags: ['a'] }] }, 'where.$or[1].tags'],
    ])('%s — refused with INVALID_FILTER / 400, translateFilter never reached', (_label, where, path) => {
      const { translated, error } = composed(where);
      expect(translated).toBe(false);
      expect(error?.code).toBe('INVALID_FILTER');
      expect(error?.status).toBe(400);
      expect(error?.message).toContain(`at ${path}.`);
      expect(error?.message).toContain('{"$in": […]}');
      expect(error?.message).toContain('{"$contains": "…"}');
    });

    it('LIT CONTROL — a scalar, $in and $eq: null still reach translateFilter and translate as before', () => {
      expect(translateFilter(parseFilterAST([['tags', 'equals', 'a']]))).toEqual({ tags: 'a' });
      expect(translateFilter(parseFilterAST([['tags', 'in', ['a', 'b']]]))).toEqual({ tags: { $in: ['a', 'b'] } });
      expect(translateFilter(parseFilterAST({ tags: { $eq: null } }))).toEqual({ tags: { $eq: null } });
    });
  });

  describe('both engine doors, with this driver\'s translator as the only read path', () => {
    let engine: ObjectQL;
    let translated: unknown[];

    beforeEach(async () => {
      const double = makeTranslatingDriver();
      translated = double.translated;
      engine = new ObjectQL();
      engine.registerDriver(double.driver as never, true);
      await engine.init();
      engine.registry.registerObject(deal as never, 'test');
    });

    it.each([
      // Door 2 carrying the FilterArray sugar — lowered by `parseFilterAST`.
      ['Door 2, the FilterArray form', () => engine.find('deal', { where: [['tags', 'equals', ['a']]] } as never)],
      // The OBJECT form: what Door 1 (the protocol face) hands the engine after
      // its own lowering, and what a direct object-form engine call carries.
      ['the object form (Door 1\'s hand-off)', () => engine.find('deal', { where: { tags: ['a'] } } as never)],
      ['the object form under $eq', () => engine.find('deal', { where: { tags: { $eq: ['a'] } } } as never)],
      ['count, nested under $or', () => engine.count('deal', { where: { $or: [{ tags: ['a'] }] } } as never)],
    ])('%s — refused at the engine seam, translateFilter called ZERO times', async (_label, run) => {
      const err = await refusalOf(run());
      expect(err?.code).toBe('INVALID_FILTER');
      expect(err?.status).toBe(400);
      expect(err?.message).toMatch(/^(find|count)\('deal'\): /);
      expect(translated).toHaveLength(0);
    });

    it('LIT CONTROL — the same doors hand a scalar and an $in list to translateFilter', async () => {
      await engine.find('deal', { where: [['tags', 'equals', 'a']] } as never);
      await engine.find('deal', { where: { tags: { $in: ['a'] } } } as never);
      expect(translated).toEqual([{ tags: 'a' }, { tags: { $in: ['a'] } }]);
    });
  });

  it('REVERSE DIRECTION — handed the shape directly, translateFilter still emits it unchanged', () => {
    // Kept visible on purpose, as `mongodb-comparand-type-conformance.test.ts`
    // keeps the raw silent-edit visible: this driver has NO gate of its own for
    // the slot (⛔ no driver source edit, by the ruling), so the shared face is
    // the only thing standing between an embedder's filter and MongoDB's array
    // equality. If this ever throws, a driver-local copy of the rule landed —
    // read that as a second implementation to reconcile, not as a pass.
    expect(translateFilter({ tags: ['a'] })).toEqual({ tags: ['a'] });
    expect(translateFilter({ tags: { $eq: ['a'] } })).toEqual({ tags: { $eq: ['a'] } });
  });
});
