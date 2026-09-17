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
import {
  QUERY_TRANSPORT_ALIAS_SLOTS,
  QUERY_TRANSPORT_DOLLAR_ALIASES,
  QUERY_TRANSPORT_DOLLAR_PARAMS,
  QueryTransportParamsSchema,
  QueryWithTransportSchema,
  RPC_QUERY_ALIAS_SLOTS,
} from './data-engine.zod';
import { QuerySchema } from './query.zod';

describe('[#16066] §1 what the transport declares', () => {
  it('declares exactly the `$`-spellings and the plural `filters`', () => {
    const declared = Object.keys((QueryTransportParamsSchema as unknown as { shape: object }).shape).sort();
    expect(declared).toEqual([
      '$count', '$expand', '$filter', '$orderby', '$search', '$searchFields', '$select', '$skip', '$top',
      'filters',
    ]);
  });

  it('every `$` spelling it declares is one the alias tables actually fold', () => {
    const folded = new Set<string>([
      ...QUERY_TRANSPORT_DOLLAR_ALIASES.map(([dollar]) => dollar),
      ...QUERY_TRANSPORT_ALIAS_SLOTS.flatMap((slot) => slot.aliases),
    ]);
    const declared = Object.keys((QueryTransportParamsSchema as unknown as { shape: object }).shape);
    // Both directions: a declared spelling nothing folds would be a promise the
    // door does not keep, and a folded `$` spelling nothing declares is the
    // defect this card was filed about.
    for (const key of declared) expect(folded.has(key), `declared but never folded: ${key}`).toBe(true);
    for (const key of folded) {
      if (!key.startsWith('$') && key !== 'filters') continue;
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
    ['top      -> limit', { top: 10 }, { limit: 10 }],
    ['$skip    -> offset', { $skip: 20 }, { offset: 20 }],
    ['skip     -> offset', { skip: 20 }, { offset: 20 }],
    ['$orderby -> orderBy', { $orderby: [{ field: 'name', order: 'asc' }] }, { orderBy: [{ field: 'name', order: 'asc' }] }],
    ['sort     -> orderBy', { sort: [{ field: 'name', order: 'asc' }] }, { orderBy: [{ field: 'name', order: 'asc' }] }],
    ['$select  -> fields', { $select: ['name'] }, { fields: ['name'] }],
    ['select   -> fields', { select: ['name'] }, { fields: ['name'] }],
    ['$expand  -> expand', { $expand: { owner: { object: 'owner' } } }, { expand: { owner: { object: 'owner' } } }],
    ['$search  -> search', { $search: 'acme' }, { search: 'acme' }],
    ['$searchFields -> searchFields', { $searchFields: ['name'] }, { searchFields: ['name'] }],
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

  it('`$count` is consumed, not smuggled into the AST — the AST has no count slot', () => {
    expect(parse({ object: 'account', $count: true })).toEqual({ object: 'account' });
  });
});

describe('[#16066] §3 the widening cannot narrow what already parsed', () => {
  /**
   * The canonical arm of the union is `QuerySchema` itself, unchanged, so
   * anything that parsed before still parses — including shapes the transport
   * arm declines. ⛔ This is the property that makes the declaration safe to
   * land as a `minor`: it records what the door accepts and refuses nothing new.
   */
  const stillParses = (query: Record<string, unknown>) =>
    expect(QueryWithTransportSchema.safeParse(query).success).toBe(true);

  it('a querystring-shaped `$top` (a string) still parses', () => stillParses({ object: 'a', $top: '50' }));
  it('a JSON-encoded `$filter` string still parses', () => stillParses({ object: 'a', $filter: '{"x":1}' }));
  it('a `{field: direction}` `$orderby` record still parses', () => stillParses({ object: 'a', $orderby: { created_at: 'desc' } }));
  it('a comma-list `$select` still parses', () => stillParses({ object: 'a', $select: 'a,b' }));
  it('a comma-list `$expand` still parses', () => stillParses({ object: 'a', $expand: 'owner' }));
  it('a leftover key destined for the implicit field filter still parses', () => stillParses({ object: 'a', status: 'open' }));
  it('conflicting spellings of one slot still parse — the DOOR refuses them, where it can name the parameter the caller wrote', () =>
    stillParses({ object: 'a', where: { a: 1 }, $filter: { b: 2 } }));

  it('a non-object query is still refused', () => {
    expect(QueryWithTransportSchema.safeParse('nope').success).toBe(false);
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
