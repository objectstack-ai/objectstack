/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3909 — `QueryParams.$filter` declares BOTH shapes the data sources
 * accept, and binds the array half to `@objectstack/spec`'s `FilterArray`
 * rather than restating it.
 *
 * ## Why this file exists at all
 *
 * The defect it pins was invisible to every runtime suite, and had to be: the
 * declaration was `Record< string, any >`, which **structurally accepts arrays**
 * (they satisfy its string index). So the two producers that have fed ObjectQL
 * AST arrays through this slot all along — `plugin-list`'s
 * `buildEffectiveFilter` (grid and export) and `plugin-view`'s `ObjectView`
 * (calendar / kanban / gallery / timeline) — type-checked, ran, and shipped
 * correct results. Nothing was broken at runtime and nothing could go red.
 *
 * The cost was paid on the type face instead, in both directions:
 *
 * 1. The type **blocked nothing while describing one legal shape as if it were
 *    the only one**. objectui#3831 is what that buys: a `Record< string, any >`
 *    slot accepted a rule array, an object spread flattened it to
 *    `{"0": {...}}`, types stayed green, and the query filtered on a column
 *    literally named `0`.
 * 2. Someone writing a new consumer reads the type and its `@example`,
 *    concludes only the record form is legal, and adds a tolerant conversion
 *    for the array path — the "widen the consumer to tolerate the producer"
 *    shape AGENTS.md #0.1 forbids.
 *
 * Both failure modes are compile-time by nature, so the pins are too. Reverting
 * `$filter` to `Record< string, any >` leaves every runtime suite green and
 * turns THIS FILE red under `tsc -p tsconfig.test.json` (the `type-check`
 * script) — the drift's own signature, reproduced deliberately.
 *
 * ## What is NOT pinned here
 *
 * That the union is the *authoritative* accepted set. It is not: the authority
 * is `translateFilterToAST` (`@object-ui/data-objectstack`), which enumerates
 * five input shapes. A second list here would be a third place to drift from —
 * which is exactly how two operator vocabularies came apart in #3948. The
 * binding below is to the spec's `FilterArray`, so the array half cannot fork
 * locally.
 */

import { describe, it, expect } from 'vitest';
import type { FilterArray } from '@objectstack/spec/data';
import type { QueryParams } from '../data';

type Assert< T extends true > = T;
/** True when `V` is accepted by the `$filter` slot. */
type AcceptsFilter< V > = V extends QueryParams['$filter'] ? true : false;
/** Exact type identity — NOT mutual assignability. See the note below. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;

describe('QueryParams.$filter — declares the union it actually accepts (#3909)', () => {
  it('accepts the MongoDB-style field-keyed record', () => {
    type _Record = Assert< AcceptsFilter< { age: { $gt: number } } > >;
    const params: QueryParams = { $filter: { age: { $gt: 18 }, status: 'active' } };
    expect(params.$filter).toEqual({ age: { $gt: 18 }, status: 'active' });
  });

  it('accepts a bare AST comparison tuple with no cast', () => {
    // The shape `buildEffectiveFilter` returns for a single condition. Before
    // #3909 this compiled only because arrays satisfy `Record`'s string index —
    // accepted by accident rather than by declaration.
    const params: QueryParams = { $filter: ['status', '=', 'active'] };
    expect(params.$filter).toEqual(['status', '=', 'active']);
  });

  it('accepts a logical AST group with no cast', () => {
    // What `mergeFilterNodes` returns once more than one source is active.
    const params: QueryParams = {
      $filter: ['and', ['age', '>=', 18], ['status', '=', 'active']],
    };
    expect(Array.isArray(params.$filter)).toBe(true);
  });

  it('accepts the legacy bare list, combined with implicit AND', () => {
    const params: QueryParams = {
      $filter: [['stage', '=', 'won'], ['amount', '>', 1000]],
    };
    expect(Array.isArray(params.$filter)).toBe(true);
  });

  it('binds the array half to the spec, by IDENTITY not assignability', () => {
    // ## Why this pin is an identity check, and why nothing weaker works
    //
    // Every assignment-shaped pin in this file is, on its own, VACUOUS as a
    // regression guard — measured, not assumed. Reverting the declaration to
    // `Record< string, any >` and re-running `type-check` leaves it GREEN
    // (exit 0), because assignability cannot separate the two: arrays satisfy
    // `Record< string, any >`'s string index, so `FilterArray extends
    // QueryParams['$filter']` holds under BOTH declarations, and the old
    // declaration is itself assignable to the new union. A guard that passes
    // equally before and after the fix is a phantom check — it reads like
    // enforcement and enforces nothing.
    //
    // Identity is the property that actually differs. This assertion goes red
    // on a revert to the bare record, AND on the subtler regression: someone
    // re-declaring a local `FilterNode` fork instead of binding the spec's
    // type. That fork would satisfy every assignment above while being free to
    // drift from the vocabulary the servers parse — the exact failure two
    // hand-written operator lists had in #3948.
    type _Bound = Assert<
      Equal< NonNullable< QueryParams['$filter'] >, Record< string, any > | FilterArray >
    >;
    const fromSpec: FilterArray = ['status', '=', 'active'];
    const params: QueryParams = { $filter: fromSpec };
    expect(params.$filter).toBe(fromSpec);
  });

  it('still refuses a value that is neither shape', () => {
    // The union documents; it must not have become `any` on the way. When this
    // was written the slot sat on an interface that also carried
    // `[key: string]: any`, and these pins proved the declared property still
    // won over that index signature; the signature is gone (objectui#7497 —
    // see `query-params-closed-keys-7497.test.ts`), and the pins still hold.
    // @ts-expect-error a number is not a filter
    const bad: QueryParams = { $filter: 42 };
    // @ts-expect-error a string is not a filter
    const alsoBad: QueryParams = { $filter: 'status eq active' };
    expect(bad.$filter).toBe(42);
    expect(alsoBad.$filter).toBe('status eq active');
  });
});
