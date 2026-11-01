/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28370 — a stored view filter list's any-of group element,
 * `{ or: [rule, ...] }` (`@objectstack/spec/ui` `ViewFilterOrGroupSchema`), is
 * LOWERED by the console's one sink, `toFilterNode`, to an `or` node of its
 * rules inside the list's AND.
 *
 * Before it, `toFilterNode` passed a group through untouched: an object in AST
 * position, which `isFilterAST` refuses, so the server answered
 * `400 INVALID_FILTER` and the list showed no rows. Every assertion here is the
 * node that reaches the wire put through the spec's own doors
 * (`isFilterAST` / `parseFilterAST`), or the ROW SET a real `ValueDataSource`
 * returns for it — never the source text.
 */

import { describe, it, expect } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import { ViewFilterElementSchema } from '@objectstack/spec/ui';
import {
  builderRulesOfSpecFilter,
  FilterOperatorError,
  mergeFilterNodes,
  toFilterNode,
  toFilterNodeSafely,
} from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

const OPEN = { field: 'status', operator: 'equals', value: 'open' } as const;
const BLOCKED = { field: 'status', operator: 'equals', value: 'blocked' } as const;
const MINE = { field: 'owner', operator: 'equals', value: 'u1' } as const;

type Row = { id: string; status: string; owner: string; done_at: number };
const ROWS: Row[] = [
  { id: 'a', status: 'open', owner: 'u1', done_at: 0 },
  { id: 'b', status: 'blocked', owner: 'u1', done_at: 0 },
  { id: 'c', status: 'done', owner: 'u1', done_at: 9 },
  { id: 'd', status: 'done', owner: 'u1', done_at: 1 },
  { id: 'e', status: 'open', owner: 'u2', done_at: 0 },
];
const ALL_IDS = ROWS.map((r) => r.id);

async function selectedIds(filter: unknown): Promise<string[]> {
  const ds = new ValueDataSource<Row>({ items: ROWS });
  const res = await ds.find('t', { $filter: filter as never });
  return (res.data as Row[]).map((r) => r.id);
}

describe('toFilterNode lowers an any-of group to an `or` node (objectstack#28370)', () => {
  it('the fixtures are spec-valid elements, so the cases below are what an author can store', () => {
    for (const element of [{ or: [OPEN, BLOCKED] }, MINE]) {
      const parsed = ViewFilterElementSchema.safeParse(element);
      expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
    }
  });

  it('a list that is one group lowers to one `or` node of its rules', () => {
    const node = toFilterNode([{ or: [OPEN, BLOCKED] }]);
    expect(node).toEqual([['or', ['status', 'equals', 'open'], ['status', 'equals', 'blocked']]]);
    expect(isFilterAST(node)).toBe(true);
    expect(parseFilterAST(node as never)).toEqual({
      $or: [{ status: 'open' }, { status: 'blocked' }],
    });
  });

  it('a group beside a plain rule is one child of the list AND', () => {
    const node = toFilterNode([{ or: [OPEN, BLOCKED] }, MINE]);
    expect(node).toEqual([
      ['or', ['status', 'equals', 'open'], ['status', 'equals', 'blocked']],
      ['owner', 'equals', 'u1'],
    ]);
    expect(isFilterAST(node)).toBe(true);
    expect(parseFilterAST(node as never)).toEqual({
      $and: [{ $or: [{ status: 'open' }, { status: 'blocked' }] }, { owner: 'u1' }],
    });
  });

  it('the HotCRM shape — open, or completed in the last 7 days — lowers each member like a top-level rule', () => {
    const node = toFilterNode([
      { or: [OPEN, { field: 'completed_at', operator: 'after', value: '{7_days_ago}' }] },
    ]);
    // `after` is canonical already, so the member is lowered verbatim beside its sibling.
    expect(node).toEqual([['or', ['status', 'equals', 'open'], ['completed_at', 'after', '{7_days_ago}']]]);
    expect(isFilterAST(node)).toBe(true);
  });

  it('a group of one rule lowers to that rule', () => {
    expect(toFilterNode([{ or: [OPEN] }])).toEqual([['status', 'equals', 'open']]);
  });

  it('a member is refused for what it says, exactly as at the top level', () => {
    const arrayOnScalar = { field: 'status', operator: 'equals', value: ['open'] };
    expect(() => toFilterNode([arrayOnScalar])).toThrow(FilterOperatorError);
    expect(() => toFilterNode([{ or: [OPEN, arrayOnScalar] }])).toThrow(FilterOperatorError);
    // The render-time door answers the refusal as a value, not as no filter.
    const safe = toFilterNodeSafely([{ or: [OPEN, arrayOnScalar] }]);
    expect(safe.ok).toBe(false);
  });

  it('a shape the spec refuses is not repaired: it stays an object the wire door refuses', () => {
    for (const refused of [
      [{ or: [] }],
      [{ or: 'status' }],
      [{ or: [{ field: '', operator: 'equals', value: 'x' }, OPEN] }],
      [{ or: [{ or: [OPEN] }, BLOCKED] }],
    ]) {
      const node = toFilterNode(refused);
      expect(isFilterAST(node), JSON.stringify(refused)).toBe(false);
    }
  });

  it('mergeFilterNodes keeps the lowered view filter its own child beside a user filter', () => {
    const merged = mergeFilterNodes([{ or: [OPEN, BLOCKED] }], ['owner', '=', 'u1']);
    expect(merged).toEqual([
      'and',
      [['or', ['status', 'equals', 'open'], ['status', 'equals', 'blocked']]],
      ['owner', '=', 'u1'],
    ]);
    expect(isFilterAST(merged)).toBe(true);
  });
});

describe('the lowered group selects the any-of row set (ValueDataSource, objectstack#28370)', () => {
  it('one group: the rows matching ANY member', async () => {
    const ids = await selectedIds([{ or: [OPEN, BLOCKED] }]);
    expect(ids).toEqual(['a', 'b', 'e']);
    expect(ids).not.toEqual(ALL_IDS);
  });

  it('a group ANDed with a rule: the any-of rows that also match the rule', async () => {
    const ids = await selectedIds([{ or: [OPEN, { field: 'done_at', operator: 'greater_than', value: 5 }] }, MINE]);
    expect(ids).toEqual(['a', 'c']);
  });
});

describe('builderRulesOfSpecFilter — what the one-level builder can show', () => {
  it('a list of plain rules is an AND group of them', () => {
    expect(builderRulesOfSpecFilter([OPEN, MINE])).toEqual({ logic: 'and', rules: [OPEN, MINE] });
    expect(builderRulesOfSpecFilter(undefined)).toEqual({ logic: 'and', rules: [] });
  });

  it('a list that is exactly one group is an OR group of its rules', () => {
    expect(builderRulesOfSpecFilter([{ or: [OPEN, BLOCKED] }])).toEqual({ logic: 'or', rules: [OPEN, BLOCKED] });
  });

  it('a group beside anything else cannot be shown as one logic, so it is null', () => {
    expect(builderRulesOfSpecFilter([{ or: [OPEN, BLOCKED] }, MINE])).toBeNull();
    expect(builderRulesOfSpecFilter([{ or: [OPEN] }, { or: [BLOCKED] }])).toBeNull();
    expect(builderRulesOfSpecFilter([{ or: 'status' }])).toBeNull();
  });
});
