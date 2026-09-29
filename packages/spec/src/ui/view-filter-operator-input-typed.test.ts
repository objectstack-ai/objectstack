// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two-half pin for `ViewFilterRule.operator`'s typed input.
 *
 * `operator` is a `z.preprocess` over the alias fold, and zod types a
 * preprocess's INPUT from its function's parameter. While that parameter was
 * `normalizeFilterOperator`'s `unknown`, `ViewFilterRule` (a `z.input`) typed
 * `operator` as `unknown`: `{ field: 'status', operator: 42 }` compiled as a rule
 * on every carrier and was refused only at parse time. The typed input is now
 * the canonical `ViewFilterOperator`, and the runtime fold is untouched.
 *
 * The two halves pin different facts, and neither implies the other:
 *
 * 1. COMPILE TIME: the type refuses an alias spelling and a non-string, on the
 *    rule and on its carriers. These `@ts-expect-error` lines are real checks
 *    only because `tsconfig.test.json` compiles this file and
 *    `check:test-typecheck` gives it no ledger entry: a directive that stops
 *    applying is a TS2578, and that is red.
 * 2. RUN TIME: the door still folds every alias the table declares, so stored
 *    `sys_metadata` rows and plain-JS producers keep parsing, and it still
 *    refuses a non-string with the enum's own issue. `.parse` takes `unknown`,
 *    which is the deliberate escape: these fixtures exercise the fold, so they
 *    are never respelled to canonical to satisfy the type.
 */

import { describe, expect, it } from 'vitest';
import type { InterfacePageConfig } from './page.zod';
import {
  VIEW_FILTER_LIST_VALUE_OPERATORS,
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_OPERATOR_ALIASES,
  VIEW_FILTER_PAIR_VALUE_OPERATORS,
  ViewFilterRuleSchema,
  type ListView,
  type ViewFilterOperator,
  type ViewFilterRule,
  type ViewTab,
} from './view.zod';

type ListViewFilterRule = NonNullable<ListView['filter']>[number];
type TabFilterRule = NonNullable<ViewTab['filter']>[number];
type PageFilterRule = NonNullable<InterfacePageConfig['filterBy']>[number];

// Lit control: the canonical spelling compiles on the rule and on each carrier,
// so the directives below fail on the OPERATOR, not on some other key.
const canonical: ViewFilterRule = { field: 'status', operator: 'equals', value: 'open' };
const canonicalOnListView: ListViewFilterRule = { field: 'status', operator: 'equals', value: 'open' };
const canonicalOnTab: TabFilterRule = { field: 'status', operator: 'equals', value: 'open' };
const canonicalOnPage: PageFilterRule = { field: 'status', operator: 'equals', value: 'open' };

// @ts-expect-error an alias spelling is not the typed input (the runtime still folds it)
const alias: ViewFilterRule = { field: 'status', operator: 'eq', value: 'open' };
// @ts-expect-error a non-string is not the typed input (the runtime refuses it)
const numeric: ViewFilterRule = { field: 'status', operator: 42, value: 'open' };
// @ts-expect-error the carrier inherits the rule's input: an alias is refused on ListView.filter
const aliasOnListView: ListViewFilterRule = { field: 'status', operator: 'eq', value: 'open' };
// @ts-expect-error the carrier inherits the rule's input: a non-string is refused on ListView.filter
const numericOnListView: ListViewFilterRule = { field: 'status', operator: 42, value: 'open' };
// @ts-expect-error the carrier inherits the rule's input: an alias is refused on a tab filter
const aliasOnTab: TabFilterRule = { field: 'status', operator: 'eq', value: 'open' };
// @ts-expect-error the carrier inherits the rule's input: an alias is refused on Page.filterBy
const aliasOnPage: PageFilterRule = { field: 'status', operator: 'eq', value: 'open' };

/** The value shape the door's value check wants for a canonical operator. */
function valueFor(operator: ViewFilterOperator): { value?: string | string[] } {
  if ((VIEW_FILTER_LIST_VALUE_OPERATORS as readonly string[]).includes(operator)) return { value: ['open'] };
  if ((VIEW_FILTER_PAIR_VALUE_OPERATORS as readonly string[]).includes(operator)) return { value: ['a', 'z'] };
  return { value: 'open' };
}

describe('ViewFilterRule.operator: the typed input is canonical, the runtime fold is not narrowed', () => {
  it('compiles the canonical spelling on the rule and its carriers, and the door accepts it', () => {
    for (const rule of [canonical, canonicalOnListView, canonicalOnTab, canonicalOnPage]) {
      expect(ViewFilterRuleSchema.parse(rule).operator).toBe('equals');
    }
  });

  it('folds an alias the type refuses to the canonical id the alias table names', () => {
    const expected = VIEW_FILTER_OPERATOR_ALIASES.eq;
    // The table's answer is itself a canonical member, so this is not vacuous.
    expect((VIEW_FILTER_OPERATORS as readonly string[]).includes(expected ?? '')).toBe(true);
    for (const rule of [alias, aliasOnListView, aliasOnTab, aliasOnPage]) {
      expect(ViewFilterRuleSchema.parse(rule).operator).toBe(expected);
    }
  });

  it('folds EVERY declared alias at run time', () => {
    const entries = Object.entries(VIEW_FILTER_OPERATOR_ALIASES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [spelling, target] of entries) {
      const rule = { field: 'status', operator: spelling, ...valueFor(target) };
      expect(ViewFilterRuleSchema.parse(rule).operator, spelling).toBe(target);
    }
  });

  it('still reaches the case-folded branch of the fold (`GT`, `NotIn`)', () => {
    // The fold lower-cases a spelling the table does not hold verbatim; the
    // expected ids are read off the table under the lower-cased key.
    const cases = [['GT', 'gt'], ['NotIn', 'notin']] as const;
    for (const [spelling, key] of cases) {
      const target = VIEW_FILTER_OPERATOR_ALIASES[key];
      expect(target, key).toBeDefined();
      const rule = { field: 'status', operator: spelling, ...valueFor(target as ViewFilterOperator) };
      expect(ViewFilterRuleSchema.parse(rule).operator, spelling).toBe(target);
    }
  });

  it("refuses a non-string the type refuses, with the enum's own issue at `operator`", () => {
    for (const rule of [numeric, numericOnListView]) {
      const result = ViewFilterRuleSchema.safeParse(rule);
      expect(result.success).toBe(false);
      const issues = result.error?.issues ?? [];
      expect(issues).toHaveLength(1);
      const [issue] = issues;
      expect(issue).toMatchObject({ code: 'invalid_value', path: ['operator'] });
      expect(issue && 'values' in issue ? issue.values : undefined).toEqual([...VIEW_FILTER_OPERATORS]);
    }
  });
});
