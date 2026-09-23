// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19514] `object-grid`'s `defaultFilters` carries the SAME declaration as its
 * `filter` sibling.
 *
 * The key is described as "read only when `filter` is absent" — the same value
 * in the same role — and objectui's `ObjectGrid` reads it through the same
 * lowering sink. `filter` converged on the `ViewFilterRule` array with the rest
 * of its family; this key was not named by that ruling and kept the
 * pre-convergence `z.unknown()`, so the block had one declared door and one
 * undeclared door onto one seam: a bare string, a number, a MongoDB-style
 * record, an ObjectQL AST tuple array and a list of malformed rules all parsed
 * here. At the objectui `.objectui-sha` pin `87af769e9a` the lowering
 * treats them three ways, per shape: the record form and the tuple array are
 * lowered and APPLIED as declared; a bare string or a number is DROPPED, so the
 * grid sends no filter and lists its rows unfiltered; and a list of malformed
 * rules is REFUSED, on the wire or by the client before any request.
 *
 * These pins hold the two keys EQUAL rather than transcribing a list of shapes
 * — the equality is the rule, and a list would go stale the next time `filter`
 * moves. Both directions are pinned at each key: the newly-refused shapes
 * REFUSE and the shape that must keep working ACCEPTS, because an ACCEPT-only
 * suite passes just as well against a door that has been narrowed to refuse
 * everything.
 *
 * ⛔ Narrowed, NOT retired. Refusing the key outright is a REMOVAL of an
 * accepted shape and needs its own ruling; the deprecation already stated in
 * the description is unchanged. The pin below says so in the one way a test
 * can: a well-formed `defaultFilters` still parses.
 */

import { describe, expect, it } from 'vitest';

import { ComponentPropsMap } from './component.zod';

const GRID = ComponentPropsMap['object-grid'];

/** A valid grid node with one key under test swapped in. */
const node = (extra: Record<string, unknown>) => ({ objectName: 'account', ...extra });

/** The rule array both keys take. */
const RULES = [{ field: 'status', operator: 'equals', value: 'active' }] as const;

/** The shapes the `z.unknown()` door used to receipt as valid. */
const REFUSED_SHAPES: readonly (readonly [string, unknown])[] = [
  ['a bare string', 'status = active'],
  ['a number', 42],
  ['a boolean', true],
  ['the MongoDB-style record form', { status: 'active' }],
  ['an operator-object record form', { amount: { $gt: 100 } }],
  ['an ObjectQL AST tuple array', [['owner_id', '=', '{current_user_id}']]],
  ['an array of malformed rules', [{ nonsense: true }]],
];

describe('#19514 — defaultFilters refuses what filter refuses', () => {
  it.each(REFUSED_SHAPES.map(([label, value]) => [label, value] as const))(
    'refuses %s at the defaultFilters path',
    (_label, value) => {
      const result = GRID.safeParse(node({ defaultFilters: value }));
      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      const under = result.error.issues.filter((i) => String(i.path[0]) === 'defaultFilters');
      expect(under.length).toBeGreaterThan(0);
    },
  );

  it('the two keys agree shape for shape — the rule, not a transcribed list', () => {
    // If `filter` is narrowed or widened again, this is what holds the fallback
    // to it. A list of literals here would silently stop tracking.
    for (const [label, value] of REFUSED_SHAPES) {
      const onFilter = GRID.safeParse(node({ filter: value })).success;
      const onFallback = GRID.safeParse(node({ defaultFilters: value })).success;
      expect(onFallback, `${label}: defaultFilters`).toBe(onFilter);
    }
    expect(GRID.safeParse(node({ filter: RULES })).success).toBe(true);
    expect(GRID.safeParse(node({ defaultFilters: RULES })).success).toBe(true);
  });

  it('the record form gets the conversion table, naming the key that was written', () => {
    const result = GRID.safeParse(node({ defaultFilters: { status: 'active' } }));
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    const issue = result.error.issues.find((i) => i.path.join('.') === 'defaultFilters')!;
    expect(issue.message).toContain('`defaultFilters`');
    expect(issue.message).toContain('[{ field, operator, value }, ...]');
    // The rewrite is computed from the author's own keys, as at every sibling door.
    expect(issue.message).toContain("[{ field: 'status', operator: 'equals', value: 'active' }]");
    expect(issue.message).toContain('migration `object-grid-default-filters-rule-array`');
  });

  it.each([
    ['the rule array', RULES],
    ['an empty rule array', []],
    ['a multi-rule array', [
      { field: 'status', operator: 'equals', value: 'active' },
      { field: 'stage', operator: 'in', value: ['won', 'lost'] },
    ]],
  ])('NEGATIVE CONTROL — still accepts %s', (_label, value) => {
    expect(GRID.safeParse(node({ defaultFilters: value })).success).toBe(true);
  });

  it('NEGATIVE CONTROL — absence is still absence, and the key is still optional', () => {
    const result = GRID.safeParse(node({}));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect('defaultFilters' in (result.data as Record<string, unknown>)).toBe(false);
  });

  it('NEGATIVE CONTROL — both keys together still parse, as the fallback contract allows', () => {
    // The key is read only when `filter` is absent; authoring both has never
    // been an error and this narrowing does not make it one.
    expect(GRID.safeParse(node({ filter: RULES, defaultFilters: RULES })).success).toBe(true);
  });

  it('ENVELOPE CONTROL — the door refuses an unrelated thing, so it is reachable', () => {
    // The card's own discriminating control. If this reads ACCEPT, the block is
    // not being parsed at all and every REFUSE above is a phantom.
    const result = GRID.safeParse({ objectName: 42 });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues.some((i) => i.path.join('.') === 'objectName')).toBe(true);
  });

  it('the element-level issues of an array author are still their own', () => {
    // The fall-through `ruleArrayFilterError` protects: a blanket message at the
    // key would overwrite the diagnosis an array author actually needs.
    const result = GRID.safeParse(node({ defaultFilters: [{ field: 'status', operator: 'nope', value: 'a' }] }));
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    const under = result.error.issues.filter((i) => i.path.join('.').startsWith('defaultFilters.'));
    expect(under.length).toBeGreaterThan(0);
    for (const issue of under) expect(issue.message).not.toContain('migration `');
    expect(result.error.issues.filter((i) => i.path.join('.') === 'defaultFilters')).toHaveLength(0);
  });

  it('the rule-level narrowings reach THIS key too — one schema, every carrier', () => {
    // The scalar arm and the icontains comparand door are `ViewFilterRuleSchema`'s,
    // so they arrive here by construction. Pinned because "the fallback is the
    // same declaration" is the whole claim of this file.
    expect(GRID.safeParse(node({
      defaultFilters: [{ field: 'tags', operator: 'equals', value: ['a'] }],
    })).success).toBe(false);
    expect(GRID.safeParse(node({
      defaultFilters: [{ field: 'name', operator: 'icontains', value: '' }],
    })).success).toBe(false);
  });
});
