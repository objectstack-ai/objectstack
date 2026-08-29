// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6125, PM ruling 2026-08-07] `undefined` in a comparand position of a READ
 * SCOPE is refused — `READ_SCOPE_COMPILE_FAILED` / 500 — and `null` is not.
 *
 * ## What was wrong
 *
 * #6050 ruled (2026-08-07, ruling B) that `undefined` sitting where a comparand
 * belongs is refused, and landed that on `driver-sql` / `driver-turso`, the two
 * surfaces where the shape was PROVEN reachable (`{ owner_id: ctx.user?.id }`).
 * #6125 measured the rest of the repo in the same round and found five readings
 * of one shape; this compiler was the cell that compiled **legal SQL with an
 * `undefined` in the bind list**. Measured here on `d8e8d9cbc` with the refusal
 * disabled, alias `t`:
 *
 * | read scope | compiled to | bind list |
 * |---|---|---|
 * | `{ d: undefined }`            | `"t"."d" = ?`                                 | `[undefined]` |
 * | `{ d: { $gt: undefined } }`   | `"t"."d" > ?`                                 | `[undefined]` |
 * | `{ d: { $in: [undefined] } }` | `"t"."d" IN (?)`                              | `[undefined]` |
 * | `{ $not: { d: undefined } }`  | `NOT (("t"."d" IS NOT NULL AND "t"."d" = ?))` | `[undefined]` |
 *
 * `applyReadScope` pushes those binds through verbatim, so the driver renders
 * them as NULL, every comparison against NULL is UNKNOWN, and the scope matched
 * ZERO rows — with no log line anywhere. Fail-CLOSED, so unlike #6050 this was
 * never a latent permission bypass; the defect being fixed is that a read scope
 * answering a question nobody asked is indistinguishable from one that worked.
 *
 * ## The two halves of this file, and which one is the change
 *
 * `describe('the four measured cells …')` is the change: run it against
 * pre-#6125 code and all four fail, because all four COMPILE.
 *
 * `describe('the null control group …')` is the risk. `null` is a declared
 * comparand with settled semantics, and the way this change could do harm is by
 * refusing it alongside `undefined` — the two live one `===` apart in every
 * polarity table in the module. Every row there passes both before and after,
 * SQL and binds byte for byte.
 *
 * `describe('what the sweep deliberately leaves alone')` records the boundary of
 * the ruling: the positions that are NOT comparands, and the shapes this module
 * already refuses with a truer diagnosis.
 *
 * ## Scope of the ruling, so a later reader does not "finish the job"
 *
 * ⛔ `@objectstack/formula` reads the same `undefined` as a THIRD semantics —
 * "the key is absent from the record" — which is a meaningful distinction and
 * the open question in #5299. It is deliberately untouched; changing it here
 * would settle #5299 as a side effect. ⚠️ `driver-memory` / `driver-mongodb`
 * were pin-only under the #5499 freeze, so this compiler and `driver-memory`
 * answer this cell differently on purpose — a debt #6125 recorded as owed AT
 * THAW. The thaw has arrived: the freeze dissolved 2026-08-11 (head note of
 * `@objectstack/spec`'s `aggregation-conformance.ts`), so that debt is now DUE
 * rather than deferred, and nothing has been triaged against it yet.
 * The envelope is this module's existing one, NOT #6050's
 * `INVALID_FILTER` / 400: a read scope is compiled by the platform from CEL and
 * stored metadata, so a 400 would bill the caller for something they neither
 * wrote nor can change.
 */

import { describe, it, expect } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

/** The ADR-0112 fields an HTTP boundary classifies on. */
interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

const ALIAS = 't';

function refusalFor(filter: FilterCondition): Refusal | undefined {
  try {
    compileScopedFilterToSql(filter, ALIAS);
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

/**
 * The four cells #6125's table measured — one per comparand POSITION, which is
 * why the list is four and not one. `path` is the only thing the message varies
 * on (#5240: one condition, one wording).
 */
const REFUSED: Array<{ name: string; filter: FilterCondition; path: string; wasSql: string }> = [
  {
    name: 'the DIRECT comparand — { d: undefined }',
    filter: { d: undefined },
    path: '"d"',
    wasSql: '"t"."d" = ?',
  },
  {
    name: "an OPERATOR's comparand — { d: { $gt: undefined } }",
    filter: { d: { $gt: undefined } },
    path: '"d".$gt',
    wasSql: '"t"."d" > ?',
  },
  {
    name: 'a LIST MEMBER — { d: { $in: [undefined] } }',
    filter: { d: { $in: [undefined] } },
    path: '"d".$in[0]',
    wasSql: '"t"."d" IN (?)',
  },
  {
    name: 'a leaf under $not — { $not: { d: undefined } }',
    filter: { $not: { d: undefined } },
    path: '"d"',
    wasSql: 'NOT (("t"."d" IS NOT NULL AND "t"."d" = ?))',
  },
];

/**
 * `null` comparands — the control group, and the reason it is this long.
 *
 * Every one of these is a DECLARED comparand whose meaning is settled, and every
 * one of them sits one `===` away from the value being refused: the module's
 * emitter arms (`$eq`/`$ne`), `operatorIsNullTotal` and
 * `nullValueSatisfiesOperator` all branch on `value === null`. A refusal
 * written one character wider takes this whole table with it, and — because
 * `IS NULL` lowering is what an RLS policy uses to scope unowned rows — it would
 * take it with a 500 on a policy that is correct.
 *
 * The `$not` rows are here for the second failure mode: the #5146 rewrite
 * reaches leaves through `nullSafeNegationOperand`, so a guard placed on the
 * wrong side of it changes the SHAPE rather than throwing, which no
 * throw-assertion would catch.
 */
const NULL_CONTROL: Array<{ name: string; filter: FilterCondition; sql: string; params: unknown[] }> = [
  { name: '{ d: null } — the implicit null predicate', filter: { d: null }, sql: '"t"."d" IS NULL', params: [] },
  { name: '{ $eq: null }', filter: { d: { $eq: null } }, sql: '"t"."d" IS NULL', params: [] },
  { name: '{ $ne: null }', filter: { d: { $ne: null } }, sql: '"t"."d" IS NOT NULL', params: [] },
  { name: '{ $in: [null] } — null is a bindable MEMBER', filter: { d: { $in: [null] } }, sql: '"t"."d" IN (?)', params: [null] },
  {
    name: '{ $nin: [null] } — NULL-safe negative (#5298)',
    filter: { d: { $nin: [null] } },
    sql: '("t"."d" IS NULL OR "t"."d" NOT IN (?))',
    params: [null],
  },
  {
    name: '{ $between: [null, 5] } — null is a bindable BOUND',
    filter: { d: { $between: [null, 5] } },
    sql: '"t"."d" BETWEEN ? AND ?',
    params: [null, 5],
  },
  { name: '{ $not: { d: null } } — already total, no guard added', filter: { $not: { d: null } }, sql: 'NOT ("t"."d" IS NULL)', params: [] },
  {
    name: '{ $not: { d: { $ne: null } } } — the #5146 rewrite still leaves it alone',
    filter: { $not: { d: { $ne: null } } },
    sql: 'NOT ("t"."d" IS NOT NULL)',
    params: [],
  },
  { name: '{ $null: true }', filter: { d: { $null: true } }, sql: '"t"."d" IS NULL', params: [] },
  { name: '{ $exists: false }', filter: { d: { $exists: false } }, sql: '"t"."d" IS NULL', params: [] },
  {
    name: 'a $contains of null still renders %null% (#5526)',
    filter: { d: { $contains: null } },
    sql: '"t"."d" LIKE ? ESCAPE ?',
    params: ['%null%', '\\'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#6125] the four measured cells are REFUSED, in this module’s own envelope', () => {
  for (const c of REFUSED) {
    it(`refuses ${c.name}`, () => {
      const err = refusalFor(c.filter);
      expect(err, `it still COMPILED — pre-#6125 this lowered to ${c.wasSql}`).toBeInstanceOf(Error);
      expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      // 500, not #6050's 400: this filter is compiled by the platform from CEL
      // and stored metadata, so the caller is not its author and cannot fix it.
      expect(err?.status).toBe(500);
      expect(err?.code).not.toBe('INVALID_FILTER');
    });

    it(`names the position it refused: ${c.path}`, () => {
      expect(String(refusalFor(c.filter)?.message)).toContain(`comparand at ${c.path} is undefined`);
    });

    it(`no longer emits its old lowering: ${c.wasSql}`, () => {
      // The other direction of the same fact. A refusal that threw for some
      // unrelated reason would satisfy the assertions above; this one fails if
      // the pre-#6125 SQL ever comes back, whatever else the module does.
      let sql: string | undefined;
      try {
        sql = compileScopedFilterToSql(c.filter, ALIAS).sql;
      } catch {
        sql = undefined;
      }
      expect(sql).toBeUndefined();
    });
  }

  it('says it ONE way — only the path differs (#5240)', () => {
    // Four positions, four `path`s, one sentence. If a later change gives one of
    // them its own bespoke wording, this is the line that objects.
    const skeletons = REFUSED.map((c) =>
      String(refusalFor(c.filter)?.message).replace(`comparand at ${c.path} is`, 'comparand at <path> is'),
    );
    expect(new Set(skeletons).size).toBe(1);
    expect(skeletons[0]).toContain('comparand at <path> is undefined');
  });

  it('the message tells the operator to fix the PRODUCER, not the caller', () => {
    // The disclosure/attribution half of #5367: the message is for the log, and
    // what it must not do is send a tenant to "fix their request".
    const msg = String(refusalFor(REFUSED[0].filter)?.message);
    expect(msg).toContain('never the caller of this query');
    expect(msg).toContain('sharing rule');
  });
});

describe('[#6125] the null control group is UNTOUCHED — SQL and binds, byte for byte', () => {
  for (const c of NULL_CONTROL) {
    it(`still compiles: ${c.name}`, () => {
      const out = compileScopedFilterToSql(c.filter, ALIAS);
      expect(out.sql).toBe(c.sql);
      expect(out.params).toEqual(c.params);
    });
  }

  it('null and undefined are told apart at the SAME position', () => {
    // The pair, side by side, on the one position where confusing them is
    // cheapest: `null` IS the null predicate, `undefined` is refused.
    expect(compileScopedFilterToSql({ d: null }, ALIAS).sql).toBe('"t"."d" IS NULL');
    expect(refusalFor({ d: undefined })?.code).toBe('READ_SCOPE_COMPILE_FAILED');
  });
});

describe('[#6125] what the sweep deliberately leaves alone', () => {
  it('$null / $exists take a declared BOOLEAN — refused by DOMAIN, not by position', () => {
    // ⚠️ [#6387] These are the two lines this block said would change "when it is
    // ruled on", and they have. What #6125 left alone is still exactly what it
    // said it left alone: `undefined` in these two slots is not a COMPARAND
    // POSITION, so `assertDefinedComparands` skips them by name to this day, and
    // the sentence above it in `read-scope-sql.ts` is unchanged.
    //
    // What changed is the OTHER side of that skip. #6125 recorded that
    // `driver-sql`'s twin skips them to a boolean-domain gate (#5347 / #5369)
    // while this module had none, so they lowered by truthiness. #6387 pushed
    // that gate down, so `undefined` is now refused HERE too — as a value
    // outside a declared domain, with the domain's own wording, which is the
    // truer diagnosis for a flag. Two rulings, two reasons, one outcome.
    for (const filter of [{ d: { $null: undefined } }, { d: { $exists: undefined } }] as const) {
      const err = refusalFor(filter);
      expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(String(err?.message)).toContain('is not a boolean');
      // NOT #6125's wording: the position gate is still the one that skipped them.
      expect(String(err?.message)).not.toContain('is undefined');
    }
  });

  it('a bare array keeps its OWN refusal, undefined member or not', () => {
    const err = refusalFor({ d: [1, undefined] });
    expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(String(err?.message)).toContain('bare array value for "d"');
  });

  it('a nested relation keeps its OWN refusal — the truer diagnosis', () => {
    // Relabelling this as "the comparand is undefined" would send the operator
    // to write `null`, and `{ owner: { manager_id: null } }` does not compile
    // either. The one deliberate divergence from `driver-sql`'s twin.
    const err = refusalFor({ owner: { manager_id: undefined } });
    expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(String(err?.message)).toContain('has a nested/relation value');
  });

  it('the boolean identities still reduce — the refusal is not reached through them', () => {
    // `{}`-shaped constants have no comparand at all, so nothing here changes.
    expect(compileScopedFilterToSql({ $and: [] }, ALIAS).sql).toBe('');
    expect(compileScopedFilterToSql({ $or: [] }, ALIAS).sql).toBe('1 = 0');
    expect(compileScopedFilterToSql({ $not: {} }, ALIAS).sql).toBe('1 = 0');
  });

  it('an undefined leaf is still reached when a SIBLING is a boolean identity', () => {
    // The evaluation-order trap #5348 / #5327 named on the driver side: this
    // compiler `.map()`s every child into its own buffer BEFORE applying the
    // `$or` TRUE-absorption, so a `{}` disjunct cannot hide a malformed one.
    expect(refusalFor({ $or: [{}, { d: undefined }] })?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(refusalFor({ $and: [{}, { d: { $in: [undefined] } }] })?.code).toBe('READ_SCOPE_COMPILE_FAILED');
  });
});
