// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16066] The query transport dialect, as the spec declares it.
 *
 * `FindDataRequestSchema.query` declared the canonical QueryAST while the
 * shipped `findData` door also folded a transport dialect no schema named. The
 * ruling declared that dialect here — as the FLATTENED SPELLING of the same
 * AST with a 1:1 alias table, ⛔ never as a second semantics — so the declared
 * INPUT is the AST or its transport spelling and the declared OUTPUT is the AST.
 *
 * ## Three things this file holds apart
 *
 *  1. **What the transport declares** — the `$`-spellings and `filters`, and
 *     nothing else. §1 pins the schema's key set against the alias tables, so
 *     a spelling can neither be declared without a fold nor folded without a
 *     declaration.
 *  2. **What it parses to** — §2 drives every alias through
 *     `QueryWithTransportSchema` and asserts the canonical slot it lands on.
 *  3. **What `QuerySchema` still is** — §4. The AST did NOT grow these keys;
 *     `QuerySchema` is byte-for-byte the schema it was, which is the half of
 *     Prime Directive #12 the ruling kept.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  QUERY_TRANSPORT_ALIAS_SLOTS,
  QUERY_TRANSPORT_DOLLAR_ALIASES,
  QUERY_TRANSPORT_DOLLAR_PARAMS,
  QueryTransportParamsSchema,
  QueryWithTransportSchema,
  RPC_QUERY_ALIAS_SLOTS,
} from './data-engine.zod';
import { QuerySchema } from './query.zod';
import type { QueryAST } from './query.zod';

describe('[#16066] §1 what the transport declares', () => {
  /** Every spelling the two tables touch — both halves of each `$` pair. */
  const foldedSpellings = (): Set<string> => new Set<string>([
    ...QUERY_TRANSPORT_ALIAS_SLOTS.flatMap((slot) => slot.aliases),
    ...QUERY_TRANSPORT_DOLLAR_ALIASES.flatMap(([dollar, bare]) => [dollar, bare]),
  ]);

  /** The canonical keys `QuerySchema` itself declares — read, never transcribed. */
  const canonicalKeys = (): Set<string> =>
    new Set(Object.keys((QuerySchema as unknown as { shape: object }).shape));

  it('declares exactly the folded spellings the AST does not already carry', () => {
    const declared = Object.keys((QueryTransportParamsSchema as unknown as { shape: object }).shape).sort();
    // DERIVED, not transcribed: every spelling the tables fold, less the ones
    // `BaseQuerySchema` already declares (`top`, `orderBy`, `search`,
    // `searchFields`) — re-declaring one of those here would widen a CANONICAL
    // member rather than a transport one. `count` survives the subtraction
    // because it is the one bare half of a `$` pair the AST does not carry.
    const canonical = canonicalKeys();
    const fromTables = [...foldedSpellings()].filter((k) => !canonical.has(k));
    expect(declared).toEqual([...fromTables].sort());
    // …and a literal, so a table that shrank cannot make both sides agree at zero.
    expect(declared).toEqual([
      '$count', '$expand', '$filter', '$orderby', '$search', '$searchFields', '$select', '$skip', '$top',
      'count', 'filter', 'filters', 'populate', 'select', 'skip', 'sort',
    ]);
  });

  it('every spelling it declares is one the alias tables actually fold', () => {
    const folded = foldedSpellings();
    const canonical = canonicalKeys();
    const declared = Object.keys((QueryTransportParamsSchema as unknown as { shape: object }).shape);
    // Both directions: a declared spelling nothing folds would be a promise the
    // door does not keep, and a folded spelling nothing declares is the defect
    // this card was filed about.
    for (const key of declared) expect(folded.has(key), `declared but never folded: ${key}`).toBe(true);
    for (const key of folded) {
      if (canonical.has(key)) continue; // carried by `BaseQuerySchema` itself
      expect(declared.includes(key), `folded but never declared: ${key}`).toBe(true);
    }
  });

  it('extends the RPC table rather than replacing it — same slots, same order', () => {
    expect(QUERY_TRANSPORT_ALIAS_SLOTS.map((s) => s.canonical))
      .toEqual(RPC_QUERY_ALIAS_SLOTS.map((s) => s.canonical));
    for (const [i, slot] of QUERY_TRANSPORT_ALIAS_SLOTS.entries()) {
      expect(slot.aliases.slice(0, RPC_QUERY_ALIAS_SLOTS[i].aliases.length))
        .toEqual([...RPC_QUERY_ALIAS_SLOTS[i].aliases]);
    }
  });

  it('the refusal set is the `$` spellings, in declaration order', () => {
    expect([...QUERY_TRANSPORT_DOLLAR_PARAMS]).toEqual([
      '$top', '$skip', '$orderby', '$select', '$count', '$search', '$searchFields', '$filter', '$expand',
    ]);
  });
});

describe('[#16066] §2 every alias parses to its canonical slot', () => {
  const parse = (query: Record<string, unknown>) => QueryWithTransportSchema.parse(query);

  const CASES: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ['$filter  -> where', { $filter: { status: 'open' } }, { where: { status: 'open' } }],
    ['filters  -> where', { filters: { status: 'open' } }, { where: { status: 'open' } }],
    ['filter   -> where', { filter: { status: 'open' } }, { where: { status: 'open' } }],
    ['$top     -> limit', { $top: 10 }, { limit: 10 }],
    ['$skip    -> offset', { $skip: 20 }, { offset: 20 }],
    ['$orderby -> orderBy', { $orderby: [{ field: 'name', order: 'asc' }] }, { orderBy: [{ field: 'name', order: 'asc' }] }],
    ['sort     -> orderBy', { sort: [{ field: 'name', order: 'asc' }] }, { orderBy: [{ field: 'name', order: 'asc' }] }],
    ['$select  -> fields', { $select: ['name'] }, { fields: ['name'] }],
    ['select   -> fields', { select: ['name'] }, { fields: ['name'] }],
    ['$expand  -> expand', { $expand: { owner: { object: 'owner' } } }, { expand: { owner: { object: 'owner' } } }],
    ['$search  -> search', { $search: 'acme' }, { search: 'acme' }],
    ['$searchFields -> searchFields', { $searchFields: ['name'] }, { searchFields: ['name'] }],
    ['skip     -> offset', { skip: 20 }, { offset: 20 }],
    ['populate -> expand', { populate: ['owner'] }, { expand: { owner: { object: 'owner' } } }],
    ['top      -> limit', { top: 10 }, { limit: 10 }],
  ];

  for (const [label, input, expected] of CASES) {
    it(label, () => {
      expect(parse({ object: 'account', ...input })).toEqual({ object: 'account', ...expected });
    });
  }

  it('the canonical AST parses to itself, untouched', () => {
    const ast = {
      object: 'account',
      where: { status: 'open' },
      orderBy: [{ field: 'name', order: 'desc' }],
      limit: 10,
      offset: 0,
      fields: ['name'],
      expand: { owner: { object: 'owner' } },
    };
    expect(parse(ast)).toEqual(ast);
  });

  it('a bag carrying BOTH spellings of one slot folds when they agree', () => {
    expect(parse({ object: 'account', where: { a: 1 }, $filter: { a: 1 } }))
      .toEqual({ object: 'account', where: { a: 1 } });
  });

  it('a bag mixing spellings of DIFFERENT slots folds all of them', () => {
    expect(parse({ object: 'account', where: { a: 1 }, $top: 5, $select: ['name'] }))
      .toEqual({ object: 'account', where: { a: 1 }, limit: 5, fields: ['name'] });
  });

  it('`$count` folds onto the bare `count` flag — the one target that is not an AST slot', () => {
    // It is the response's total-count flag, read beside the query and declared
    // on the parsed output beside it. `findData` takes its opt-out from
    // `options.count` on this very bag, so folding it and then dropping it would
    // declare a parameter the parse silently discards.
    expect(parse({ object: 'account', $count: true })).toEqual({ object: 'account', count: true });
  });

  it('the bare `count` spelling is declared too, and keeps its value', () => {
    expect(parse({ object: 'account', count: false })).toEqual({ object: 'account', count: false });
  });
});

describe('[#16066] §3 the fold is TOTAL — every admitted value shape lowers, or the parse fails', () => {
  /**
   * THE LOAD-BEARING SECTION, and every assertion in it reads the OUTPUT.
   *
   * "One semantics" is a claim about VALUES, not only about keys. This file's
   * first shape asserted `.success` alone, and under that assertion the
   * transport arm admitted a whole grammar the canonical arm of the SAME schema
   * refuses — `$top: 'abc'` parsed to `limit: 'abc'`, `$orderby: 'name'` to
   * `orderBy: 'name'`, `$filter: 'not json'` to `where: 'not json'`, and a
   * conflicting bag parsed with `$filter` STILL ON THE OUTPUT. Each of those is
   * a `.success === true`. ⛔ A test that asserts success alone cannot catch a
   * wrong output; assert the output.
   *
   * What made them reachable is what the door does with them: `$top: 'abc'`
   * passed POST validation and reached the engine as `limit: null` — an
   * UNBOUNDED read under a 200 — and `$top: ''` as `limit: 0`.
   */
  const parsesTo = (query: Record<string, unknown>, expected: Record<string, unknown>) =>
    expect(QueryWithTransportSchema.parse(query)).toEqual(expected);
  const refuses = (query: Record<string, unknown>) => {
    const result = QueryWithTransportSchema.safeParse(query);
    expect(result.success, `expected a refusal, got ${JSON.stringify(result)}`).toBe(false);
    return result.success ? [] : result.error.issues;
  };

  describe('the shapes that LOWER — the output is the canonical value, never the arrival shape', () => {
    it('a querystring-shaped `$top` becomes the number the AST slot declares', () =>
      parsesTo({ object: 'a', $top: '50' }, { object: 'a', limit: 50 }));
    it('a querystring-shaped `$skip` becomes a number too', () =>
      parsesTo({ object: 'a', $skip: '10' }, { object: 'a', offset: 10 }));
    it('a `{field: direction}` `$orderby` record becomes sort nodes', () =>
      parsesTo({ object: 'a', $orderby: { created_at: 'desc' } },
        { object: 'a', orderBy: [{ field: 'created_at', order: 'desc' }] }));
    it('a `{field: 1 | -1}` `$orderby` record becomes sort nodes', () =>
      parsesTo({ object: 'a', $orderby: { created_at: -1 } },
        { object: 'a', orderBy: [{ field: 'created_at', order: 'desc' }] }));
    it('a comma-list `$select` becomes a field array', () =>
      parsesTo({ object: 'a', $select: 'a,b' }, { object: 'a', fields: ['a', 'b'] }));
    it('a comma-list `$searchFields` becomes an array', () =>
      parsesTo({ object: 'a', $searchFields: 'a,b' }, { object: 'a', searchFields: ['a', 'b'] }));
    it('a comma-list `$expand` becomes an expand map', () =>
      parsesTo({ object: 'a', $expand: 'owner,project' },
        { object: 'a', expand: { owner: { object: 'owner' }, project: { object: 'project' } } }));
    it('a `$count` string becomes the boolean the flag is read as', () =>
      parsesTo({ object: 'a', $count: 'false' }, { object: 'a', count: false }));
    it('an explicit null on a transport key is a withdrawal, not a value', () =>
      parsesTo({ object: 'a', $top: null }, { object: 'a' }));
    it('a leftover key destined for the implicit field filter is dropped, not carried', () =>
      parsesTo({ object: 'a', status: 'open' }, { object: 'a' }));
  });

  describe('the `FilterArray` sugar — accepted on EVERY spelling of the slot, lowered through the one sink', () => {
    /**
     * The door serves the ObjectQL array on the canonical key too: `findData`
     * hands `{where: ['status', '=', 'open']}` to the engine as
     * `{status: 'open'}`. Declaring it on `$filter` alone left `where` refusing
     * at the schema what the door accepts at run time — one slot, two grammars,
     * selected by spelling.
     *
     * ⛔ It is lowered, never admitted: #5158 ruling C keeps `FilterArray`
     * input-only sugar and `parseFilterAST` the one lowering sink. §4 below
     * pins the other half — `QuerySchema.where` still refuses it.
     */
    const LOWERED = { status: 'open' };
    it('`where`', () => parsesTo({ object: 'a', where: ['status', '=', 'open'] }, { object: 'a', where: LOWERED }));
    it('`$filter`', () => parsesTo({ object: 'a', $filter: ['status', '=', 'open'] }, { object: 'a', where: LOWERED }));
    it('`filter`', () => parsesTo({ object: 'a', filter: ['status', '=', 'open'] }, { object: 'a', where: LOWERED }));
    it('`filters`', () => parsesTo({ object: 'a', filters: ['status', '=', 'open'] }, { object: 'a', where: LOWERED }));
    it('a compound group lowers to the logical node', () =>
      parsesTo({ object: 'a', $filter: ['and', ['stage', '=', 'won'], ['amount', '>', 1000]] },
        { object: 'a', where: { $and: [{ stage: 'won' }, { amount: { $gt: 1000 } }] } }));
  });

  describe('the shapes that are REFUSED — because lowering them would mean parsing', () => {
    /**
     * A JSON-encoded filter, an OData sort expression and a non-numeric `$top`
     * cannot be lowered without a parser, and a second parser beside the door's
     * is how one rule ends up with two implementations that disagree. They fail
     * the parse rather than leaving it under the AST type.
     */
    it('a JSON-encoded `$filter` string', () => refuses({ object: 'a', $filter: '{"x":1}' }));
    it('an OData `$orderby` expression string', () => refuses({ object: 'a', $orderby: 'name desc' }));
    it('a `sort` expression string', () => refuses({ object: 'a', sort: '-created_at' }));
    it('a `string[]` `$orderby`', () => refuses({ object: 'a', $orderby: ['name'] }));
    it('a non-numeric `$top` — the unbounded-read case', () => {
      const issues = refuses({ object: 'a', $top: 'abc' });
      // ONE diagnostic, at the canonical path, naming the parameter the caller
      // actually wrote (#4226) — not `limit`, which is absent from the request.
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toEqual(['limit']);
      expect(issues[0].message).toContain("'$top'");
    });
    it('an empty-string `$top` — the `limit: 0` case', () => refuses({ object: 'a', $top: '' }));
    it('a non-numeric `$skip`', () => refuses({ object: 'a', $skip: 'abc' }));
    it('a `$count` that is neither the boolean nor its two spellings', () =>
      refuses({ object: 'a', $count: 'yes' }));
    it('a non-object query', () => expect(QueryWithTransportSchema.safeParse('nope').success).toBe(false));
  });

  describe('a CONFLICT fails the parse and names the spelling the caller wrote', () => {
    /**
     * Left unfolded, a conflict put BOTH spellings on the parsed bag, so the
     * declared AST output carried a transport key — the in-source promise that
     * "a consumer reading a parsed query never sees a transport key" was
     * measured false on exactly this input.
     */
    it('`where` against `$filter`', () => {
      const issues = refuses({ object: 'a', where: { a: 1 }, $filter: { b: 2 } });
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toEqual(['where']);
      expect(issues[0].message).toContain("'$filter'");
    });
    it('`sort` against `$orderby`, quoting the `$` spelling', () => {
      const issues = refuses({ object: 'a', sort: { a: 'asc' }, $orderby: { b: 'desc' } });
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toEqual(['orderBy']);
      expect(issues[0].message).toContain("'$orderby'");
    });
    it('the same value under two spellings is redundant, not a conflict', () =>
      parsesTo({ object: 'a', where: { a: 1 }, $filter: { a: 1 } }, { object: 'a', where: { a: 1 } }));
  });

  describe('the OUTPUT is the AST — by construction', () => {
    /**
     * The transform returns the result of the AST schema's own parse, so the
     * only keys that can leave are the ones that schema declares. These two
     * assertions are what a `.success`-only test could never make.
     */
    it('no transport spelling survives a parse, on any slot', () => {
      const parsed = QueryWithTransportSchema.parse({
        object: 'a', $filter: { s: 1 }, $top: 5, $skip: 1, $orderby: { n: 'asc' },
        $select: 'a', $expand: 'owner', $search: 'x', $searchFields: 'a', $count: true,
      }) as Record<string, unknown>;
      for (const key of QUERY_TRANSPORT_DOLLAR_PARAMS) {
        expect(key in parsed, `${key} survived the fold`).toBe(false);
      }
      for (const key of ['filter', 'filters', 'select', 'sort', 'skip', 'populate', 'top']) {
        expect(key in parsed, `${key} survived the fold`).toBe(false);
      }
      expect(parsed).toEqual({
        object: 'a', where: { s: 1 }, limit: 5, offset: 1,
        orderBy: [{ field: 'n', order: 'asc' }], fields: ['a'],
        expand: { owner: { object: 'owner' } }, search: 'x', searchFields: ['a'], count: true,
      });
    });

    it('every parsed output is itself a valid QueryAST (plus the `count` flag)', () => {
      const INPUTS: Array<Record<string, unknown>> = [
        { object: 'a', $top: '50' },
        { object: 'a', $skip: '10' },
        { object: 'a', $orderby: { n: -1 } },
        { object: 'a', $select: 'a,b' },
        { object: 'a', $expand: 'owner' },
        { object: 'a', $filter: ['status', '=', 'open'] },
        { object: 'a', where: ['status', '=', 'open'] },
        { object: 'a', $searchFields: 'a,b' },
        { object: 'a', $count: 'true' },
      ];
      for (const input of INPUTS) {
        const parsed = QueryWithTransportSchema.parse(input) as Record<string, unknown>;
        const { count, ...ast } = parsed;
        // The canonical schema — the wire/storage contract — must accept the
        // whole of it. Before the fold was total this failed on six of the nine.
        const round = QuerySchema.safeParse(ast);
        expect(round.success, `${JSON.stringify(input)} -> ${JSON.stringify(parsed)}`).toBe(true);
        expect(round.success && round.data).toEqual(ast);
        expect(count === undefined || typeof count === 'boolean').toBe(true);
      }
    });
  });
});

describe('[#16066] §4 `QuerySchema` did not grow the dialect', () => {
  /**
   * The ruling's Prime Directive #12 half: the transport form is declared as a
   * SPELLING of the AST, never admitted into the AST. A `$` key handed to
   * `QuerySchema` is still an unknown key it drops on the floor — which is
   * exactly why the slot, not the AST, is where the union lives.
   */
  it('`QuerySchema` still strips `$filter` instead of reading it', () => {
    expect(QuerySchema.parse({ object: 'account', $filter: { a: 1 } } as never))
      .toEqual({ object: 'account' });
  });

  it('`QuerySchema` still strips `$top` instead of reading it', () => {
    expect(QuerySchema.parse({ object: 'account', $top: 5 } as never)).toEqual({ object: 'account' });
  });

  it('…while the transport-aware slot folds both', () => {
    expect(QueryWithTransportSchema.parse({ object: 'account', $filter: { a: 1 }, $top: 5 }))
      .toEqual({ object: 'account', where: { a: 1 }, limit: 5 });
  });
});

describe('[#16066] §5 the declared OUTPUT type, pinned where a runtime test cannot reach', () => {
  /**
   * `z.infer` of this slot is the canonical AST plus the `count` flag — and
   * nothing else. The slot used to claim the bare `QueryAST` through a cast
   * while the transform emitted whatever the fold produced; the claim is now
   * made by the AST schema's own parse inside that transform, and this is the
   * half of it a value-level assertion cannot see.
   *
   * ⚠️ `count` is part of the output on purpose: it rides inside this slot on
   * the wire and `findData` reads it off the same bag. It is not an AST member
   * and never reaches the engine.
   */
  type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

  it('is `QueryAST & { count?: boolean }`', () => {
    const outputIsAstPlusCount: Exact<
      z.infer<typeof QueryWithTransportSchema>,
      QueryAST & { count?: boolean }
    > = true;
    expect(outputIsAstPlusCount).toBe(true);
  });

  it('…and the INPUT still admits the transport spelling and refuses a bag with no object', () => {
    const transportBag: z.input<typeof QueryWithTransportSchema> = { object: 'a', $top: 5, $filter: { a: 1 } };
    const canonicalAst: z.input<typeof QueryWithTransportSchema> = { object: 'a', where: { a: 1 }, limit: 5 };
    // @ts-expect-error — `object` is required on every spelling of the slot.
    const noObject: z.input<typeof QueryWithTransportSchema> = { $top: 5 };
    expect([transportBag, canonicalAst, noObject].length).toBe(3);
  });
});
