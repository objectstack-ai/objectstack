// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5347 / #5348] Out-of-contract filter input is refused at the door, in both
 * positions a filter has.
 *
 * The two issues are one shape seen twice. `FilterConditionSchema` declares what
 * may sit at a NODE (three combinators, then field names) and
 * `FieldOperatorsSchema` declares what each operator's COMPARAND may be; this
 * driver checked neither, and in both positions the un-refused input produced an
 * ANSWER rather than an error.
 *
 * ## #5348 — the node position
 *
 * A `$`-key that is not `$and`/`$or`/`$not` was compiled as a COLUMN of that
 * name. Measured on better-sqlite3 before the fix, against one row:
 *
 * ```
 * WHERE {"$where":"return true"}        => RESOLVED []
 * WHERE {"$nor":[{"stage":"won"}]}      => RESOLVED []
 * WHERE {"$or":[{"$where":"x"}]}        => RESOLVED []
 * ```
 *
 * SQLite degrades a double-quoted name that resolves to no column into a string
 * literal, so the query compiled, ran, and matched nothing — indistinguishable
 * from "no rows matched". The FIELD position had answered the same class of
 * input with `INVALID_FILTER` / 400 since #3948/#4436, so one driver gave two
 * answers depending on depth — the internal contradiction #5240 closed for
 * `{ field: {} }`.
 *
 * ## #5347 — the comparand position
 *
 * `$null`'s comparand is declared `z.boolean()`. A non-boolean was read by
 * DEFAULT BRANCHES hung on opposite sides, so the same filter meant opposite
 * things per backend. Measured against one row with `stage: 'won'` (id 1) and
 * one with `stage: null` (id 2), on `{ stage: { $null: 'yes' } }`:
 *
 * | backend | answer |
 * |---|---|
 * | driver-sql, driver-sqlite-wasm, Turso local | `["2"]` — IS NULL |
 * | driver-memory query path, driver-mongodb | `["1"]` — IS NOT NULL |
 * | driver-memory reference matcher | `["1","2"]` — no constraint at all |
 *
 * Ruled REFUSED on all four (#5347): a non-boolean has no reading here that is
 * not a guess at intent, and the string `"false"` — truthy — lands on the side
 * opposite the `false` it was written to mean.
 *
 * ## Why both gates sit on the reduction walk
 *
 * `reduceFilterKey`, not the emitter. The emitter is skipped wholesale by a
 * boolean identity, so `{ $or: [ {}, { $where: '…' } ] }` would be refused or
 * ignored depending on its SIBLINGS — the "gate conditional on evaluation
 * order" `reduceFilterNode`'s own doc comment warns against, and the same
 * placement argument #5327 made for `{ field: {} }`. The `$or`/`$and` cases
 * below are the ones that would fail if either gate moved into the emitter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import type { FilterCondition } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

describe('[#5347/#5348] SqlDriver refuses out-of-contract filter input', () => {
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
          score: { type: 'number', name: 'score' },
        },
      } as any,
    ]);
    await driver.create('deal', { id: '1', stage: 'won', score: 10 });
    await driver.create('deal', { id: '2', stage: null, score: 20 });
  });

  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', {
      object: 'deal',
      fields: ['id'],
      where: where as FilterCondition,
    });
    return (rows as any[]).map((r) => String(r.id)).sort();
  };

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    try {
      await ids(where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  // ── #5348: the node position ───────────────────────────────────────────────

  describe('[#5348] a $-key in a node position that is not a declared combinator', () => {
    // `$where` / `$expr` are named rather than invented: driver-mongodb's own
    // refusal comment calls them P0 because a backend that EVALUATES them
    // bypasses query intent. `$nor` and `$elemMatch` are the shapes a
    // Mongo-fluent author reaches for that the Filter Protocol never declared.
    const UNDECLARED: Array<[label: string, where: unknown, key: string, path: string]> = [
      ['$where at the top level', { $where: 'return true' }, '$where', 'filter.$where'],
      ['$nor at the top level', { $nor: [{ stage: 'won' }] }, '$nor', 'filter.$nor'],
      ['$expr at the top level', { $expr: { $eq: ['$stage', 'won'] } }, '$expr', 'filter.$expr'],
      ['$elemMatch at the top level', { $elemMatch: { stage: 'won' } }, '$elemMatch', 'filter.$elemMatch'],
      ['$where inside $or', { $or: [{ $where: 'x' }] }, '$where', 'filter.$or[0].$where'],
      ['$nor inside $and', { $and: [{ $nor: [{ stage: 'won' }] }] }, '$nor', 'filter.$and[0].$nor'],
      ['$expr inside $not', { $not: { $expr: 1 } }, '$expr', 'filter.$not.$expr'],
    ];

    for (const [label, where, key, path] of UNDECLARED) {
      it(`refuses ${label} with INVALID_FILTER / 400`, async () => {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        // The caller must be able to see WHICH key, and WHERE.
        expect(err.message).toContain(`"${key}"`);
        expect(err.message).toContain(path);
        expect(err.message).toContain('$and, $or and $not');
        // #3867 — no driver-internal prefix on the wire.
        expect(err.message).not.toContain('[sql-driver]');
      });
    }

    // The placement proof. `{ stage: 'won' }` is a satisfiable disjunct, so an
    // emitter-side gate would compile the `$or` from that branch alone and
    // never look at the malformed sibling. Before the fix this whole filter
    // RESOLVED — and to `[]`, not even to the row the good disjunct matches.
    it('refuses a malformed disjunct even when a sibling disjunct is satisfiable', async () => {
      const err = await refusalOf({ $or: [{ stage: 'won' }, { $where: 'x' }] });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('filter.$or[1].$where');
    });

    // The other half of the same argument: an identity that resolves the whole
    // node TRUE before the malformed sibling is reached.
    it('refuses a malformed disjunct beside the TRUE identity `{}`', async () => {
      const err = await refusalOf({ $or: [{}, { $nor: [{ stage: 'won' }] }] });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('filter.$or[1].$nor');
    });

    it('the three DECLARED combinators are untouched', async () => {
      // Each spelling, alone and nested, still compiles and answers.
      expect(await ids({ $and: [{ stage: 'won' }] })).toEqual(['1']);
      expect(await ids({ $or: [{ stage: 'won' }, { score: 20 }] })).toEqual(['1', '2']);
      expect(await ids({ $not: { stage: 'won' } })).toEqual(['2']);
      expect(await ids({ $and: [{ $or: [{ stage: 'won' }] }, { $not: { stage: 'lost' } }] })).toEqual(['1']);
      // The boolean identities #5134 settled are unchanged by the new gate.
      expect(await ids({ $and: [] })).toEqual(['1', '2']);
      expect(await ids({ $or: [] })).toEqual([]);
    });
  });

  // ── #5347: the comparand position ──────────────────────────────────────────

  describe('[#5347] $null with a non-boolean comparand', () => {
    // Every non-boolean the issue enumerated, plus the truthy-string trap.
    const NON_BOOLEAN: Array<[label: string, value: unknown]> = [
      ["the string 'yes'", 'yes'],
      ['the number 1', 1],
      ['the number 0', 0],
      ['null', null],
      ['undefined', undefined],
      ['an object', {}],
      // The one that matters most in practice: `"false"` is TRUTHY, so under
      // the old rule it compiled IS NULL on SQL and IS NOT NULL on the JS
      // backends — the exact opposite of what its author wrote it to mean. A
      // JSON round-trip or an AI-authored scope produces it readily.
      ["the STRING 'false'", 'false'],
    ];

    for (const [label, value] of NON_BOOLEAN) {
      it(`refuses ${label} with INVALID_FILTER / 400`, async () => {
        const err = await refusalOf({ stage: { $null: value } });
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain('Operator "$null" on field "stage" requires a boolean comparand');
        expect(err.message).toContain('filter.stage.$null');
        expect(err.message).not.toContain('[sql-driver]');
      });
    }

    it('refuses inside a combinator, and inside $not', async () => {
      // `$not` matters on its own: its operand goes through the #5146 NULL-safe
      // rewrite, which SYNTHESISES `{ $null: false }` / `{ $null: true }` nodes.
      // The reduction runs on the ORIGINAL operand, so the refusal fires before
      // the rewrite and the synthesised booleans are never confused with the
      // caller's comparand.
      for (const where of [
        { $and: [{ stage: { $null: 'yes' } }] },
        { $or: [{ stage: 'won' }, { stage: { $null: 1 } }] },
        { $not: { stage: { $null: 'yes' } } },
      ]) {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.message).toContain('requires a boolean comparand');
      }
    });

    it('true and false are unchanged, line by line', async () => {
      expect(await ids({ stage: { $null: true } })).toEqual(['2']);
      expect(await ids({ stage: { $null: false } })).toEqual(['1']);
      // …including under the #5146 NULL-safe negation rewrite, whose synthesised
      // guards are themselves `{ $null: <boolean> }` nodes.
      expect(await ids({ $not: { stage: { $null: true } } })).toEqual(['1']);
      expect(await ids({ $not: { stage: 'won' } })).toEqual(['2']);
    });

  });

  describe('[#5369] $exists with a non-boolean comparand', () => {
    /**
     * FLIPPED CARVE-OUT. This block used to be titled "$exists is deliberately
     * NOT tightened here" and pinned the answers `['1']` for `$exists: 'yes'`
     * and `$exists: 0` — #5347 ruled on `$null` alone, and what "exists" means
     * for a null-valued key was still #5299's open question, so tightening it
     * as a rider would have been settling a second ruling silently.
     *
     * The 2026-08-06 ruling on #5298 closed that question ("has a value") and
     * applied #5347's disposition A to `$exists` by name. So the carve-out
     * becomes the gate, with the same envelope and the same wording shape.
     *
     * What did NOT change with it: the emitter's `opValue === false` arm and
     * the polarity table's `value === false` arm. Both are exhaustive two-way
     * choices once only booleans reach them, and #5369's suggestion to tighten
     * the latter to `=== true` points the wrong way — that table answers
     * "does a NULL column SATISFY the operator", and a NULL column satisfies
     * `$exists` when the caller asked for `false`.
     */
    const NON_BOOLEAN: Array<[label: string, value: unknown]> = [
      ["the string 'yes'", 'yes'],
      ['the number 1', 1],
      ['the number 0', 0],
      ['null', null],
      ['undefined', undefined],
      ['an object', {}],
      ["the STRING 'false'", 'false'],
    ];

    for (const [label, value] of NON_BOOLEAN) {
      it(`refuses ${label} with INVALID_FILTER / 400`, async () => {
        const err = await refusalOf({ stage: { $exists: value } });
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain('Operator "$exists" on field "stage" requires a boolean comparand');
        expect(err.message).toContain('filter.stage.$exists');
        expect(err.message).not.toContain('[sql-driver]');
      });
    }

    it('refuses inside a combinator, and inside $not', async () => {
      for (const where of [
        { $and: [{ stage: { $exists: 'yes' } }] },
        { $or: [{ stage: 'won' }, { stage: { $exists: 1 } }] },
        { $not: { stage: { $exists: 'yes' } } },
      ]) {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.message).toContain('requires a boolean comparand');
      }
    });

    it('true and false are unchanged, line by line', async () => {
      expect(await ids({ stage: { $exists: true } })).toEqual(['1']);
      expect(await ids({ stage: { $exists: false } })).toEqual(['2']);
      expect(await ids({ $not: { stage: { $exists: true } } })).toEqual(['2']);
      // The complement `$null` answers the mirror image, on every comparand —
      // the invariant #5298 made the platform-wide reading of these two.
      expect(await ids({ stage: { $exists: true } })).toEqual(await ids({ stage: { $null: false } }));
      expect(await ids({ stage: { $exists: false } })).toEqual(await ids({ stage: { $null: true } }));
    });
  });

  // ── Both gates: the legal shapes are untouched ─────────────────────────────

  describe('legal filters compile exactly as before', () => {
    it('the ordinary vocabulary still answers', async () => {
      expect(await ids({ stage: 'won' })).toEqual(['1']);
      expect(await ids({ stage: { $in: ['won'] } })).toEqual(['1']);
      // [#5298] NULL-safe: row 2's `stage` is NULL, and "not won" is true of a
      // value that is not there. This line read `[]` before that ruling.
      expect(await ids({ stage: { $ne: 'won' } })).toEqual(['2']);
      expect(await ids({ score: { $between: [5, 15] } })).toEqual(['1']);
      expect(await ids({ score: { $gte: 10 } })).toEqual(['1', '2']);
      expect(await ids({ stage: { $startsWith: 'w' } })).toEqual(['1']);
      expect(await ids({})).toEqual(['1', '2']);
      // A `$field` REFERENCE is still refused by #5041's comparand gate, with
      // its own wording — the new gates did not swallow it.
      const crossField = await refusalOf({ stage: { $eq: { $field: 'score' } } });
      expect(crossField.message).toContain('Cross-field comparison');
    });

    it('the regex family keeps its non-string comparands (explicitly out of scope)', async () => {
      // #5347 measured this family as AGREEING across backends and fail-closed,
      // and #5041 left it out of the comparand guard on the same evidence. It
      // is not tightened here, and this pins that it was not tightened by
      // accident.
      expect(await ids({ stage: { $contains: 1 } })).toEqual([]);
      expect(await ids({ stage: { $startsWith: {} } })).toEqual([]);
    });
  });
});
