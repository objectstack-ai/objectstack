/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9559, ruling B (ratified): `FilterOperatorSchema` is DERIVED from
 * `@objectstack/spec`'s declared operator set and normalises aliases on parse
 * exactly as `ViewFilterRuleSchema` does.
 *
 * Before: a 14-member local literal, six members behind the protocol
 * (`icontains`, `is_empty`, `is_not_empty`, `before`, `after`, `between`) and
 * refusing every alias the protocol normalises — so the authoring gate refused
 * operators the protocol and the runtime both accept.
 *
 * Every refusal below carries a lit control that is accepted by the same
 * schema in the same run, and every acceptance carries a refusal, so neither
 * direction can pass by the schema answering one way for everything.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_OPERATOR_ALIASES,
  ViewFilterRuleSchema,
  normalizeFilterOperator,
  type ViewFilterOperator,
} from '@objectstack/spec/ui';
import {
  FilterBuilderConditionSchema,
  FilterBuilderSchema,
  FilterOperatorSchema,
} from '../zod/complex.zod.js';
import { safeValidateSchema } from '../zod/index.zod.js';
import type { FilterBuilderCondition } from '../complex.js';
import type * as Barrel from '../index.js';

/**
 * The TS face is the authored row's `operator` member, typed by the spec's own
 * name. This package used to publish the same set as `FilterBuilderOperator`;
 * that name retired here (objectui#6349, batch 12) and means
 * `@object-ui/components`' builder vocabulary only.
 */
type RowOperator = FilterBuilderCondition['operator'];

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(_: T = true as T): void { /* compile-time only */ }

// Both faces state the protocol's canonical set, by reference. Fails to compile
// if either drifts back to a local list.
expectType<Equal<RowOperator, ViewFilterOperator>>();
// The retired name is not published from this package's root. The
// `@ts-expect-error` IS the assertion: export the name again and this line
// stops erroring, which fails the compile.
// @ts-expect-error `FilterBuilderOperator` is not a name of @object-ui/types (objectui#6349)
type _RetiredOperatorName = Barrel.FilterBuilderOperator;
expectType<Equal<z.output<typeof FilterOperatorSchema>, ViewFilterOperator>>();

/** The spec rule's own operator member — the side this mirror must agree with. */
const PROTOCOL = ViewFilterRuleSchema.shape.operator;

/**
 * The filter-builder dropdown's ids as `FILTER_BUILDER_OPERATORS` spelled them
 * when objectui#9559 landed — the camelCase ids that objectui#9306 then retired
 * in favour of the protocol's own spellings. They stay the corpus here because
 * they are exactly what a filter stored before objectui#9306 still carries, so
 * "which of them does the mirror accept" is still the question worth pinning.
 * (The dropdown's CURRENT ids are the 20 canonical members plus `exists` /
 * `notExists`; `@object-ui/components` pins those against the spec.)
 */
const DROPDOWN_IDS = [
  'equals', 'notEquals', 'contains', 'containsCaseInsensitive', 'notContains',
  'isEmpty', 'isNotEmpty', 'greaterThan', 'lessThan', 'greaterOrEqual', 'lessOrEqual',
  'before', 'after', 'between', 'in', 'notIn', 'startsWith', 'endsWith',
  'isNull', 'isNotNull', 'exists', 'notExists',
] as const;

/** Spellings the protocol refuses, including three the builder draws. */
const REFUSED_PROBES = ['qqzz_absent', 'containsCaseInsensitive', 'exists', 'notExists', '', 'like', 'eq ', 42, null, undefined, {}] as const;

const CORPUS: readonly unknown[] = [
  ...VIEW_FILTER_OPERATORS,
  ...Object.keys(VIEW_FILTER_OPERATOR_ALIASES),
  ...DROPDOWN_IDS,
  ...REFUSED_PROBES,
];

describe('objectui#9559 — the mirror is the protocol operator set (pin a)', () => {
  it('the TS face is canonical-only (compile-time: refused by `tsc` when it is not)', () => {
    // A legacy alias is a read-side bridge, not a spelling a new producer may type.
    // @ts-expect-error — `lessThan` is a deprecated alias, not a canonical member
    const aliasTyped: RowOperator = 'lessThan';
    const canonicalTyped: RowOperator = 'less_than';
    expect([aliasTyped, canonicalTyped].length).toBe(2);
  });

  it('is the spec rule\'s own operator member, not a copy of it', () => {
    // Reference identity is the only check that tells a derivation from a
    // faithful copy — a copy passes every value comparison below.
    expect(FilterOperatorSchema).toBe(PROTOCOL);
    expect([...FilterOperatorSchema.out.options].sort()).toEqual([...VIEW_FILTER_OPERATORS].sort());
  });

  it('accepts every one of the protocol\'s canonical members, each as itself', () => {
    expect(VIEW_FILTER_OPERATORS.length).toBeGreaterThan(14);
    for (const op of VIEW_FILTER_OPERATORS) {
      const r = FilterOperatorSchema.safeParse(op);
      expect(r.success, `canonical \`${op}\` refused`).toBe(true);
      expect(r.success && r.data).toBe(op);
    }
    // The six the hand-kept literal lacked, named so a narrowing reads as such.
    for (const op of ['icontains', 'is_empty', 'is_not_empty', 'before', 'after', 'between']) {
      expect(FilterOperatorSchema.safeParse(op).success, op).toBe(true);
    }
  });

  it('accepts every alias the protocol\'s table carries, NORMALISED to its canonical member', () => {
    const aliases = Object.entries(VIEW_FILTER_OPERATOR_ALIASES);
    expect(aliases.length).toBeGreaterThan(0);
    for (const [alias, canonical] of aliases) {
      const r = FilterOperatorSchema.safeParse(alias);
      expect(r.success, `alias \`${alias}\` refused`).toBe(true);
      expect(r.success && r.data, alias).toBe(canonical);
      // Anti-vacuity: the alias really is a different spelling from its target.
      expect(alias).not.toBe(canonical);
    }
  });

  it('refuses what the protocol refuses — and the refusal is the enum\'s own verdict', () => {
    for (const probe of REFUSED_PROBES) {
      const r = FilterOperatorSchema.safeParse(probe);
      expect(r.success, `probe ${JSON.stringify(probe)} accepted`).toBe(false);
    }
    // The refusal path is live and speaks with the enum's code, after the fold
    // ran: an unknown spelling reaches the enum unchanged and is refused there.
    const unknown = FilterOperatorSchema.safeParse('qqzz_absent');
    expect(unknown.success).toBe(false);
    expect(unknown.success ? null : unknown.error.issues[0]?.code).toBe('invalid_value');
    expect(normalizeFilterOperator('qqzz_absent')).toBe('qqzz_absent');
    // Lit control in the same run: a spelling one character away is accepted.
    expect(FilterOperatorSchema.safeParse('in').success).toBe(true);
  });

  it('answers exactly as the protocol answers, over every spelling in play', () => {
    let accepted = 0;
    let refused = 0;
    let normalised = 0;
    for (const input of CORPUS) {
      const mine = FilterOperatorSchema.safeParse(input);
      const theirs = PROTOCOL.safeParse(input);
      expect(mine.success, `verdict differs for ${JSON.stringify(input)}`).toBe(theirs.success);
      if (mine.success && theirs.success) {
        expect(mine.data, `output differs for ${JSON.stringify(input)}`).toBe(theirs.data);
        accepted += 1;
        if (mine.data !== input) normalised += 1;
      } else {
        refused += 1;
      }
    }
    // The differential exercised all three outcomes, so it is not vacuous.
    expect(accepted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    expect(normalised).toBeGreaterThan(0);
  });

  it('the dropdown\'s pre-objectui#9306 ids: 19 of 22 are accepted, and the 3 refusals are the protocol\'s gaps', () => {
    // A reading, not a target: it moves only with the protocol's table. The
    // three are recorded upstream-blocked in `OPT_IN_OPERATORS` (exists /
    // notExists) or lack a spec alias row (containsCaseInsensitive -> icontains).
    const refusedIds = DROPDOWN_IDS.filter((id) => !FilterOperatorSchema.safeParse(id).success);
    expect(refusedIds).toEqual(['containsCaseInsensitive', 'exists', 'notExists']);
  });
});

describe('objectui#9559 — the authored document round-trips to canonical (the one visible change)', () => {
  const node = {
    type: 'filter-builder',
    fields: [{ value: 'amount', label: 'Amount', type: 'number' }],
    value: {
      id: 'root',
      logic: 'and',
      conditions: [
        { id: 'c1', field: 'amount', operator: 'greaterOrEqual', value: 10 },
        { id: 'c2', field: 'amount', operator: 'lt', value: 99 },
        { id: 'c3', field: 'amount', operator: 'isNull' },
        { id: 'c4', field: 'amount', operator: 'between', value: [1, 2] },
      ],
    },
  };

  it('a camelCase / shorthand authored operator validates, and parses to the canonical spelling', () => {
    const r = FilterBuilderSchema.safeParse(node);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    const ops = (r.success ? r.data.value.conditions : []).map((c: { operator: string }) => c.operator);
    expect(ops).toEqual(['greater_than_or_equal', 'less_than', 'is_null', 'between']);
    // Anti-vacuity: the authored spellings differ from what came out.
    expect(node.value.conditions.map((c) => c.operator)).toEqual(['greaterOrEqual', 'lt', 'isNull', 'between']);
    // The whole-document gate agrees.
    expect(safeValidateSchema(node).success).toBe(true);
  });

  it('a value-less operator needs no value (pin e, mirror side)', () => {
    expect(FilterBuilderConditionSchema.safeParse({ id: 'c', field: 'a', operator: 'is_not_null' }).success).toBe(true);
    expect(FilterBuilderConditionSchema.safeParse({ id: 'c', field: 'a', operator: 'isNotEmpty' }).success).toBe(true);
  });

  it('an operator the protocol refuses still refuses the document, at the operator', () => {
    const bad = {
      ...node,
      value: { ...node.value, conditions: [{ id: 'c1', field: 'amount', operator: 'exists' }] },
    };
    const r = FilterBuilderSchema.safeParse(bad);
    expect(r.success).toBe(false);
    // `value` was `union([condition, group])` until objectui#10825, so this
    // refusal came back as one `invalid_union` at `value`. The union is gone
    // (a bare condition is refused by name), and the refusal is now reported
    // where it is: at the operator.
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['value.conditions.0.operator']);
  });
});

