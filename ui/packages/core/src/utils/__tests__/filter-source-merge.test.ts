/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Merging the filter sources a view can carry.
 *
 * Three shapes are in circulation and all are legitimate — a spec
 * `ViewFilterRule[]`, an AST node, and a MongoDB-style object. Renderers merged
 * them by hand and got two things wrong, both silent:
 *
 *   1. They tested `source.length > 0` before using it. That is `undefined > 0`
 *      for an object, so a `table.defaultFilters` (declared `Record<string,
 *      any>`) was DROPPED and the view returned every record.
 *   2. They SPREAD a source into the `and` (`['and', ...rules]`). That is only
 *      correct when the source is an array of nodes; for a `ViewFilterRule[]`
 *      it puts bare rule objects where the AST expects nodes. `isFilterAST`
 *      rejects that (a 400 since objectstack#4121) and `parseFilterAST` reads
 *      the rule as a Mongo condition — filtering on columns literally named
 *      `field`, `operator` and `value`.
 *
 * The emitted shape is asserted against the server's own `isFilterAST` rather
 * than a restated literal wherever the result is an AST.
 *
 * objectui#3431 — the third mistake, and the one this file used to certify.
 * `toFilterNode` returned EVERY array verbatim, so a saved view's
 * `ViewFilterRule[]` reached `$filter` as bare rule objects. The old case here
 * ("passes a non-empty array source through unchanged") asserted exactly that,
 * and the note below it explained it away with "the adapter translates it on
 * the way out". No adapter does. Measured against a real backend
 * (`@objectstack/*@17.0.0-rc.2`, the showcase app, the SHIPPED
 * `showcase_task.in_progress` view):
 *
 *   $filter=[{"field":"status","operator":"equals","value":"in_progress"}]
 *     -> HTTP 400 {"error":"Request failed","code":"INVALID_FILTER"}
 *   $filter=[["status","equals","in_progress"]]
 *     -> HTTP 200, total=2, every row status=in_progress
 *
 * so every saved view carrying a filter was a failed list. The rule cases below
 * now pin the lowering; reverting `toFilterNode`'s fold turns them RED (they
 * assert a produced value and `isFilterAST(...) === true`, not the absence of
 * something).
 */

import { describe, it, expect } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import { toFilterNode, mergeFilterNodes, convertFiltersToAST, FilterOperatorError } from '../filter-converter';

const RULES = [{ field: 'stage', operator: 'eq', value: 'won' }];
/** `RULES` after the fold — `eq` canonicalised by the spec's own normalizer. */
const RULES_AS_AST = [['stage', 'equals', 'won']];
const TUPLE = ['owner', '=', 'me'];

describe('toFilterNode', () => {
  it('lowers a spec ViewFilterRule[] to AST nodes', () => {
    expect(toFilterNode(RULES)).toEqual(RULES_AS_AST);
  });

  it('passes an array of AST nodes through unchanged', () => {
    expect(toFilterNode([TUPLE])).toEqual([TUPLE]);
    // Same reference: nothing is rebuilt when there is no rule object to fold.
    const nodes = [TUPLE, ['amount', '>', 1]];
    expect(toFilterNode(nodes)).toBe(nodes);
  });

  it('converts a MongoDB-style object into an AST node', () => {
    expect(toFilterNode({ status: 'active' })).toEqual(['status', '=', 'active']);
  });

  it('treats absent and empty sources as nothing', () => {
    for (const empty of [undefined, null, [], {}, '', 0]) {
      expect(toFilterNode(empty)).toBeUndefined();
    }
  });
});

describe('lowering a ViewFilterRule — the operator vocabulary (objectui#3431)', () => {
  /**
   * The write side (`app-shell/views/viewFilterFold.ts`) canonicalises through
   * the spec's `normalizeFilterOperator`; so does the read side now. One exit,
   * so the two directions cannot become two dialects — the failure the Studio
   * inspector's private table already demonstrated (four operators behind).
   */
  it('canonicalises legacy shorthand and camelCase spellings already in storage', () => {
    expect(toFilterNode([{ field: 'a', operator: 'eq', value: 1 }])).toEqual([['a', 'equals', 1]]);
    expect(toFilterNode([{ field: 'a', operator: 'nin', value: [1] }])).toEqual([['a', 'not_in', [1]]]);
    expect(toFilterNode([{ field: 'a', operator: 'greaterThan', value: 1 }]))
      .toEqual([['a', 'greater_than', 1]]);
    expect(toFilterNode([{ field: 'a', operator: 'startsWith', value: 'x' }]))
      .toEqual([['a', 'starts_with', 'x']]);
  });

  it('emits no value slot for a rule that carries none', () => {
    // `is_empty` takes its direction from the operator NAME. A third element
    // would be an invented `null` once the array is serialised — a real
    // `{a: null}` predicate the author never wrote.
    const node = toFilterNode([{ field: 'a', operator: 'is_empty' }]);
    expect(node).toEqual([['a', 'is_empty']]);
    expect(isFilterAST(node)).toBe(true);
    // What the server reads the 2-tuple AS. It read `$null: true` until
    // `@objectstack/spec` 17.6.0, whose `parseFilterAST` lowers `is_empty` to
    // the emptiness operator instead (objectstack#20570, objectui#11094). The
    // assertion's job is unchanged: the server reads the rule's own predicate,
    // keyed on the operator NAME, and not an equality on a `null` nobody wrote.
    expect(parseFilterAST(node)).toEqual({ a: { $empty: true } });
  });

  it('passes an operator the spec does not know through VERBATIM', () => {
    // Not coerced to `equals`. The server's own gate then refuses it, which is
    // the whole point: a misspelling must fail loudly, not silently widen the
    // result set.
    const node = toFilterNode([{ field: 'a', operator: 'sounds_like', value: 'x' }]);
    expect(node).toEqual([['a', 'sounds_like', 'x']]);
    expect(isFilterAST(node)).toBe(false);
  });

  it('folds the ObjectView concat element-wise, leaving URL triples byte-identical', () => {
    // `ObjectView` builds `[...viewDef.filter, ...urlFilters]` — stored rules
    // and `?filter[<field>]=<value>` triples in ONE array. Only the rules fold.
    const urlTriple = ['account_id', '=', 'acct_1'];
    const mixed = toFilterNode([{ field: 'stage', operator: 'equals', value: 'won' }, urlTriple]);
    expect(mixed).toEqual([['stage', 'equals', 'won'], urlTriple]);
    expect((mixed as unknown[])[1]).toBe(urlTriple);
    expect(isFilterAST(mixed)).toBe(true);
    expect(parseFilterAST(mixed)).toEqual({ $and: [{ stage: 'won' }, { account_id: 'acct_1' }] });
  });

  it('does NOT lower a blank-field rule — a loud 400 beats a silently-empty list', () => {
    // Measured on a live backend: `[["","equals","x"]]` passes `isFilterAST`
    // and answers `200` with `total: 0`. Left as an object it is refused with
    // `400 INVALID_FILTER`, which names the element. Same blank-row predicate
    // the write side applies.
    const blank = [{ field: '', operator: 'equals', value: 'x' }];
    expect(toFilterNode(blank)).toEqual(blank);
    expect(isFilterAST(toFilterNode(blank))).toBe(false);
    expect(isFilterAST([['', 'equals', 'x']])).toBe(true); // the shape NOT produced
  });
});

describe('mergeFilterNodes', () => {
  it('returns undefined when every source is empty', () => {
    expect(mergeFilterNodes(undefined, [], {})).toBeUndefined();
  });

  it('returns a lone source as-is rather than wrapping it in a pointless and', () => {
    expect(mergeFilterNodes([TUPLE], undefined)).toEqual([TUPLE]);
  });

  it('wraps each source as its own child — never spreads it', () => {
    // The regression. Spreading would give ['and', {field…}, 'owner', '=', 'me'].
    expect(mergeFilterNodes(RULES, TUPLE)).toEqual(['and', RULES_AS_AST, TUPLE]);
  });

  it('keeps an object source instead of dropping it', () => {
    // `table.defaultFilters` is declared `Record<string, any>`; the old
    // `.length > 0` guard read false and the whole filter disappeared.
    expect(mergeFilterNodes({ status: 'active' }, TUPLE))
      .toEqual(['and', ['status', '=', 'active'], TUPLE]);
  });
});

describe('what reaches the server', () => {
  /**
   * `isFilterAST` / `parseFilterAST` are imported from `@objectstack/spec/data`
   * — the SAME code the backend runs — so these are not a restatement of what
   * we hope the server does. Every source shape must clear them, rule arrays
   * included: there is no later adapter.
   */
  it('produces a node the server accepts, whichever shape the source had', () => {
    expect(isFilterAST(mergeFilterNodes([TUPLE], ['amount', '>', 1]))).toBe(true);
    expect(isFilterAST(mergeFilterNodes({ status: 'active' }, ['amount', '>', 1]))).toBe(true);
    expect(isFilterAST(mergeFilterNodes({ status: 'active' }))).toBe(true);
    expect(isFilterAST(mergeFilterNodes(RULES))).toBe(true);
    expect(isFilterAST(mergeFilterNodes(RULES, TUPLE))).toBe(true);
  });

  /**
   * The issue's own repro, byte-for-byte: the showcase ships
   * `showcase_task.in_progress` with this exact `filter`, and it is what the
   * `/meta/view` response hands ObjectView today.
   */
  it('lowers the shipped saved-view filter into the payload the backend answered 200 for', () => {
    const shipped = [{ field: 'status', operator: 'equals', value: 'in_progress' }];
    // Before the fold this was the wire payload, and the server refused it.
    expect(isFilterAST(shipped)).toBe(false);
    expect(parseFilterAST(shipped)).toBeUndefined();
    // After: the payload a live backend answered with total=2.
    const sent = mergeFilterNodes(shipped);
    expect(sent).toEqual([['status', 'equals', 'in_progress']]);
    expect(isFilterAST(sent)).toBe(true);
    expect(parseFilterAST(sent)).toEqual({ status: 'in_progress' });
  });

  it('a rule source survives the round trip to a real predicate', () => {
    expect(parseFilterAST(mergeFilterNodes(RULES))).toEqual({ stage: 'won' });
    expect(parseFilterAST(mergeFilterNodes(RULES, TUPLE)))
      .toEqual({ $and: [{ stage: 'won' }, { owner: 'me' }] });
  });

  it('an object source survives the round trip to a real predicate', () => {
    const merged = mergeFilterNodes({ status: 'active' }, ['amount', '>', 1]);
    expect(parseFilterAST(merged)).toEqual({
      $and: [{ status: 'active' }, { amount: { $gt: 1 } }],
    });
  });

  it('the spread shape it replaces was NOT acceptable — pinning why', () => {
    // What `['and', ...rules, ...tuples]` produced. Kept as executable evidence
    // that the wrapping above is not a stylistic preference.
    const spread = ['and', ...RULES, TUPLE];
    expect(isFilterAST(spread)).toBe(false);
    // Worse than rejected: read as a predicate over three columns that do not exist.
    expect(parseFilterAST(spread)).toEqual({
      $and: [{ field: 'stage', operator: 'eq', value: 'won' }, { owner: 'me' }],
    });
  });
});

describe('operators this layer will not translate', () => {
  it('refuses $regex instead of silently answering with `contains`', () => {
    // `$regex: 'a.c'` matches "abc"; `contains 'a.c'` matches only the literal
    // three characters. Neither result looks wrong on screen, which is exactly
    // why the old `console.warn` + rewrite was the wrong shape of handling —
    // a warning is not an error channel in a deployed app.
    expect(() => convertFiltersToAST({ name: { $regex: 'a.c' } }))
      .toThrow(/regex/i);
  });

  it('refuses an unknown operator', () => {
    expect(() => convertFiltersToAST({ name: { $bogus: 1 } })).toThrow(/\$bogus/);
  });

  it('carries the code that classifies it as a rejected request, not a network fault', () => {
    // A bare Error reads as "check your connection" in the list error panel
    // (#3066). Both refusals above are the server-understood-and-refused kind.
    for (const bad of [{ n: { $regex: 'x' } }, { n: { $bogus: 1 } }]) {
      try {
        convertFiltersToAST(bad as any);
        throw new Error('expected a refusal');
      } catch (e: any) {
        expect(e).toBeInstanceOf(FilterOperatorError);
        expect(e.code).toBe('INVALID_FILTER');
        expect(e.httpStatus).toBe(400);
      }
    }
  });

  it('still translates every operator it does support', () => {
    expect(convertFiltersToAST({ a: { $gte: 1 } })).toEqual(['a', '>=', 1]);
    expect(convertFiltersToAST({ a: { $contains: 'x' } })).toEqual(['a', 'contains', 'x']);
    expect(convertFiltersToAST({ a: { $null: true } })).toEqual(['a', 'is_null', true]);
  });
});
