// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5239] An empty `$and` / `$or` / `$not` group translates to its BOOLEAN
 * IDENTITY — and a non-node operand is refused before any identity is applied.
 *
 * # What was wrong
 *
 * `translateCondition` passed the combinator arrays through verbatim. MongoDB
 * answers an empty one with neither TRUE nor FALSE but a THIRD behaviour: it
 * refuses the query outright (`$and/$or/$nor must be a nonempty array`). So
 * `{ $and: [] }` and `{ $or: [] }` reached `find` / `countDocuments` /
 * `updateMany` / `deleteMany` as a server error carrying no ADR-0112 code,
 * while `driver-sql` (#5134 / PR #5243), `driver-memory` and `formula` all
 * answered them as identities. Measured on `main` before this change:
 *
 * | filter             | boolean algebra          | old translation      |
 * |--------------------|--------------------------|----------------------|
 * | `{$and: []}`       | TRUE  -> every document  | `{$and: []}` -> ERROR|
 * | `{$or:  []}`       | FALSE -> zero documents  | `{$or: []}`  -> ERROR|
 * | `{$or:[{a},{}]}`   | `{}` is a TRUE disjunct  | already correct      |
 * | `{$not: {}}`       | NOT TRUE = zero documents| already correct      |
 *
 * The last two rows are why the reduction is STRUCTURAL rather than a special
 * case for the empty array: MongoDB happens to agree with boolean algebra about
 * `{}` and about `$nor: [{}]`, so a fix that only looked at `length === 0`
 * would have been right by luck on half the table and silent about the rest.
 *
 * # Why the shape rejection is part of the SAME change
 *
 * Identity reduction reads "this node has no predicates" as "matches every
 * document", so it is sound only once an empty node has exactly ONE cause.
 * Before it, this translator's handling of a non-node operand was worse than
 * driver-sql's ever was — measured on `main`:
 *
 * - `{ $or: [new Date()] }` -> `{ $or: [{}] }`  — a TRUE disjunct, i.e. EVERY
 *   document. Not "silently ignored": silently WIDENED, already.
 * - `{ $or: 'x' }` and `{ $not: null }` -> `{}` — the absent filter, i.e. every
 *   document.
 * - `{ $or: ['x'] }` -> `{ $or: [{ '0': 'x' }] }` — a predicate on a field
 *   named `0` that no document has.
 *
 * `find` is not the only consumer: `updateMany` and `deleteMany` translate the
 * same `where`. A filter that widens to every document there is not a wrong row
 * count, it is data loss. So non-nodes are refused loudly (ADR-0112
 * `INVALID_FILTER`, `status: 400`) BEFORE any identity is applied — the same
 * discipline as #5134 in `driver-sql` and cloud#1073 in Turso's
 * `RemoteTransport.buildWhereSQL`. `Date` / `RegExp` / class instances all
 * satisfy `typeof x === 'object'` while enumerating to nothing, so the gate
 * judges by PROTOTYPE, not by `typeof`.
 *
 * # Where these cases do NOT yet live
 *
 * They belong in `FILTER_LOGIC_CASES` (`@objectstack/spec/data`) so every
 * backend is held to them at once — that is #5239's headline. They are not
 * there yet: two of the table's enrolled backends (`read-scope-sql` and the
 * analytics `filter-normalizer`, both in `packages/services/service-analytics`)
 * answer the empty combinators by THROWING fail-closed, which is a deliberate,
 * pinned position that contradicts the identity ruling. Adding the rows today
 * turns those two suites red. The conflict is filed as #5322, with the measured
 * matrix in `filter-logic-conformance.ts`. This file is the pin until then.
 *
 * # The two halves
 *
 * Translation-level assertions always run — the emitted document IS the
 * semantics for these four filters (`{}` is "every document", `{_id:{$in:[]}}`
 * is "no document", both unambiguous). The real-mongod half below answers the
 * question a translator test cannot — whether the SERVER agrees — and skips
 * when the binary cannot be fetched, the convention every suite in this package
 * follows. **A skip is not a pass**: on a machine without the binary the
 * translation half is the whole proof, which is why it carries the load.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { translateFilter } from './mongodb-filter.js';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** "Every document" — MongoDB's absent filter. */
const MATCH_ALL = {};
/** "No document" — the FALSE constant this translator emits. */
const MATCH_NONE = { _id: { $in: [] } };

const refusalOf = (where: unknown): WireBearingError => {
  try {
    translateFilter(where);
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the translator to refuse this filter, but it returned a document');
};

// ── Half 1: the emitted document, always run ────────────────────────────────

describe('[#5239] translateFilter reduces empty combinators to their boolean identity', () => {
  describe('the identity batch', () => {
    it('empty $and is TRUE — the absent filter, which MongoDB reads as every document', () => {
      expect(translateFilter({ $and: [] })).toEqual(MATCH_ALL);
    });

    it('empty $or is FALSE — a real zero-document condition, never the absent filter', () => {
      // The distinction this assertion exists for: emitting NOTHING would be
      // `{}`, which `find` / `updateMany` / `deleteMany` all read as EVERY
      // document — the opposite answer.
      expect(translateFilter({ $or: [] })).toEqual(MATCH_NONE);
      expect(translateFilter({ $or: [] })).not.toEqual(MATCH_ALL);
    });

    it('empty $not is FALSE — NOT TRUE, so zero documents', () => {
      expect(translateFilter({ $not: {} })).toEqual(MATCH_NONE);
    });
  });

  it('an RLS read scope whose disjunct list came out empty hides every document', () => {
    // The production shape #5134 reports: a scope builder looped over zero
    // grants and handed the driver `{$or: []}`.
    expect(translateFilter({ $or: [] })).toEqual(MATCH_NONE);
  });

  it('a scope that ANDs a real predicate with an empty $or still hides everything', () => {
    // FALSE dominates the node's own AND, so the whole tree reduces before any
    // document is built — `owner = u1` is never emitted at all. That is the
    // reduction being STRUCTURAL rather than a post-hoc filter over emitted
    // clauses, and it is why the result is the bare FALSE constant.
    expect(translateFilter({ owner: 'u1', $or: [] })).toEqual(MATCH_NONE);
  });

  // ── `{}` is a TRUE operand wherever it appears ────────────────────────────

  it('an empty branch makes the whole $or TRUE (it is a TRUE disjunct)', () => {
    expect(translateFilter({ $or: [{ stage: 'won' }, {}] })).toEqual(MATCH_ALL);
  });

  it('an empty branch inside $and is the AND identity — siblings still apply', () => {
    expect(translateFilter({ $and: [{ stage: 'won' }, {}] })).toEqual({
      $and: [{ stage: 'won' }],
    });
  });

  it('an empty $or branch is dropped as the OR identity, siblings survive', () => {
    // The emitted `$or` must stay NON-EMPTY: an empty one is the shape MongoDB
    // refuses, so "drop the FALSE member" and "emit `$or: []`" are not the same
    // thing even though both start by removing the branch.
    expect(translateFilter({ $or: [{ stage: 'won' }, { $or: [] }] })).toEqual({
      $or: [{ stage: 'won' }],
    });
  });

  // ── The identities compose through nesting ───────────────────────────────

  it('a FALSE branch makes the enclosing $and FALSE', () => {
    expect(translateFilter({ $and: [{ stage: 'won' }, { $or: [] }] })).toEqual(MATCH_NONE);
  });

  it('$not of a FALSE group is TRUE', () => {
    expect(translateFilter({ $not: { $or: [] } })).toEqual(MATCH_ALL);
  });

  it('$not of a TRUE group is FALSE', () => {
    expect(translateFilter({ $not: { $and: [] } })).toEqual(MATCH_NONE);
  });

  it('a nested empty $not still collapses to FALSE under $and', () => {
    expect(translateFilter({ $and: [{ stage: 'won' }, { $not: {} }] })).toEqual(MATCH_NONE);
  });

  it('an empty $not as a $or branch is dropped, not promoted', () => {
    expect(translateFilter({ $or: [{ stage: 'won' }, { $not: {} }] })).toEqual({
      $or: [{ stage: 'won' }],
    });
  });

  // ── Shape rejection: an empty translation must have exactly ONE cause ─────

  describe('non-filter-node operands are refused loudly, never reduced', () => {
    const cases: Array<[string, unknown, string]> = [
      ['null element', { $or: [null] }, 'filter.$or[0]'],
      ['string element', { $or: ['x'] }, 'filter.$or[0]'],
      ['array element', { $or: [[{ stage: 'won' }]] }, 'filter.$or[0]'],
      ['Date element', { $or: [new Date()] }, 'filter.$or[0]'],
      ['number element in $and', { $and: [42] }, 'filter.$and[0]'],
      ['non-node deeper in the list', { $or: [{ stage: 'won' }, null] }, 'filter.$or[1]'],
      ['nested under a good branch', { $and: [{ $or: [null] }] }, 'filter.$and[0].$or[0]'],
      ['$not operand is an array', { $not: [] }, 'filter.$not'],
      ['$not operand is null', { $not: null }, 'filter.$not'],
      ['$not operand is a string', { $not: 'x' }, 'filter.$not'],
      ['$or is not an array at all', { $or: 'x' }, 'filter.$or'],
      ['$and is not an array at all', { $and: { stage: 'won' } }, 'filter.$and'],
    ];

    for (const [name, where, position] of cases) {
      it(`${name} -> 400 INVALID_FILTER naming ${position}`, () => {
        const err = refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(position);
        // #3867 — driver-internal wording never reaches the wire.
        expect(err.message).not.toContain('[mongodb]');
      });
    }

    it('garbage is NOT upgraded to match-all by the identity reduction', () => {
      // The exact regression the gate exists to prevent, and it is not
      // hypothetical here: on `main` these two ALREADY translated to every
      // document, before any identity rule was added.
      expect(() => translateFilter({ $or: [new Date()] })).toThrow();
      expect(() => translateFilter({ $or: 'x' })).toThrow();
      expect(() => translateFilter({ $not: null })).toThrow();
    });

    it('a class instance is not a filter node either', () => {
      // `Object.entries(new Foo())` can be empty, which would reduce to TRUE and
      // match every document. Prototype identity is what separates a filter node
      // from an arbitrary object.
      class NotAFilter {
        stage = 'won';
      }
      expect(refusalOf({ $or: [new NotAFilter()] }).code).toBe('INVALID_FILTER');
    });

    it('the shape gate runs even when a sibling already decided the verdict', () => {
      // The walk does not short-circuit: `$or: []` alone would settle the node
      // as FALSE, but a malformed node further along must still be refused, or
      // the gate would depend on key order.
      expect(() => translateFilter({ $or: [], $and: [null] })).toThrow(/filter\.\$and\[0\]/);
    });
  });

  // ── Nothing that worked before changes ───────────────────────────────────

  describe('existing translation is untouched', () => {
    it('a plain $or still ORs its branches', () => {
      expect(translateFilter({ $or: [{ stage: 'won' }, { stage: 'lost' }] })).toEqual({
        $or: [{ stage: 'won' }, { stage: 'lost' }],
      });
    });

    it('a $or branch still ANDs its own keys (#3774)', () => {
      expect(translateFilter({ $or: [{ stage: 'won', owner: 'u1' }, { stage: 'nope' }] })).toEqual({
        $or: [{ stage: 'won', owner: 'u1' }, { stage: 'nope' }],
      });
    });

    it('a non-empty $not still leaves as $nor (MongoDB has no document-level $not)', () => {
      expect(translateFilter({ $not: { stage: 'won' } })).toEqual({ $nor: [{ stage: 'won' }] });
    });

    it('$not still ANDs with its sibling keys', () => {
      expect(translateFilter({ $not: { stage: 'won' }, owner: 'u1' })).toEqual({
        $and: [{ owner: 'u1' }, { $nor: [{ stage: 'won' }] }],
      });
    });

    it('an absent filter is not a failed filter', () => {
      expect(translateFilter({})).toEqual(MATCH_ALL);
      expect(translateFilter(undefined)).toEqual(MATCH_ALL);
    });

    it('operators inside a branch still translate', () => {
      expect(translateFilter({ $or: [{ amount: { $gte: 25 } }, { stage: 'lost' }] })).toEqual({
        $or: [{ amount: { $gte: 25 } }, { stage: 'lost' }],
      });
    });

    it('query-level keys are still skipped, and still carry no predicate', () => {
      expect(translateFilter({ limit: 5, offset: 2 })).toEqual(MATCH_ALL);
      expect(translateFilter({ stage: 'won', limit: 5 })).toEqual({ stage: 'won' });
    });

    it('a field constrained by zero operators is now REFUSED (#5240 / #5376)', () => {
      // This pin used to read "still not ruled on", and asserted that
      // `{ stage: {} }` translated to an exact-match on an empty document as it
      // always did — #5239 deliberately declined to decide #5240 from inside a
      // reduction change, and recorded the non-decision here.
      //
      // #5376 is that decision arriving: #5240 ruled REFUSE, #5327 gated the
      // four other backends, and this driver was the fifth and last still
      // answering. What #5239 was careful about is still true and still pinned
      // below — the VERDICT did not change. The key is classified `'clause'`
      // exactly as before; a refusal was added in front of it, not a
      // reclassification to TRUE, which is the one direction that would have
      // turned the shape into match-all.
      const err = refusalOf({ stage: {} });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('Field constraint at filter.stage carries zero operators');

      // And inside a combinator, where the emitter would never have reached it.
      const nested = refusalOf({ $or: [{ stage: {} }, { owner: 'u1' }] });
      expect(nested.code).toBe('INVALID_FILTER');
      expect(nested.status).toBe(400);
      expect(nested.message).toContain('filter.$or[0].stage');
    });

    it('an ARRAY where is outside the reduction entirely (#5158/#5329)', () => {
      // This pin used to hold the legacy array dialect steady; #5329 deleted
      // that dialect on main and refuses a non-empty array at the door, so the
      // reduction never sees one (the refusal itself is pinned in
      // `mongodb-filter.test.ts`). What is still THIS file's to pin: `[]` means
      // the ABSENT filter — match-all `{}` — not the `$or: []` zero-row
      // identity. Absence of a filter and an empty disjunction are different
      // facts, and only the second one is #5239's.
      expect(() => translateFilter([['stage', '=', 'won']])).toThrow(
        /A filter ARRAY reached the driver/,
      );
      expect(translateFilter([])).toEqual(MATCH_ALL);
    });
  });
});

// ── Half 2: does the SERVER agree? ─────────────────────────────────────────

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('boolean identity');

describe.skipIf(!sharedMongod)('[#5239] a real mongod returns the identity row sets', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  const FIXTURE = [
    { id: '1', stage: 'won', owner: 'u1' },
    { id: '2', stage: 'lost', owner: 'u2' },
    { id: '3', stage: 'open', owner: 'u1' },
  ];
  const ALL = ['1', '2', '3'];

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'boolean_identity' });
    await driver.connect();
    await driver.syncSchema('deal', {
      name: 'deal',
      fields: { stage: { type: 'string' }, owner: { type: 'string' } },
    } as never);
    for (const row of FIXTURE) await driver.create('deal', { ...row });
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (sharedMongod) await sharedMongod.stop();
  });

  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', { where } as never);
    return (rows as Record<string, unknown>[]).map((r) => String(r.id)).sort();
  };

  it('the fixture really is all three rows', async () => {
    expect(await ids(undefined)).toEqual(ALL);
  });

  it('empty $and is every document (it used to be a server error)', async () => {
    expect(await ids({ $and: [] })).toEqual(ALL);
  });

  it('empty $or is ZERO documents (it used to be a server error)', async () => {
    expect(await ids({ $or: [] })).toEqual([]);
  });

  it('empty $not is ZERO documents', async () => {
    expect(await ids({ $not: {} })).toEqual([]);
  });

  it('an empty branch makes the whole $or every document', async () => {
    expect(await ids({ $or: [{ stage: 'won' }, {}] })).toEqual(ALL);
  });

  it('a surviving $or branch is never emitted as an empty array', async () => {
    // The regression this guards: dropping the FALSE member down to `$or: []`
    // is the very shape the server refuses.
    expect(await ids({ $or: [{ stage: 'won' }, { $or: [] }] })).toEqual(['1']);
  });

  it('the FALSE constant really selects nothing on the server', async () => {
    expect(await ids({ $and: [{ stage: 'won' }, { $or: [] }] })).toEqual([]);
  });

  it('a non-empty $not still negates', async () => {
    expect(await ids({ $not: { stage: 'won' } })).toEqual(['2', '3']);
  });
});
