// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the shared functional-completeness predicate (ADR-0078 Phase 1).
 *
 * Two disciplines from the #4001 campaign carry over:
 *
 * 1. Every rule is proven to GO RED on the inert shape it exists for — a
 *    completeness gate that cannot fail on a known-inert instance is the
 *    hollow-probe defect reproduced in the instrument built against it.
 * 2. The deliberate NON-rules are pinned as hard as the rules. `multiselect`
 *    without options is runtime-blessed free-form (`record-validator.ts:471`,
 *    verbatim: "free-form (tags without options)") — if someone "completes"
 *    this module by flagging it, that is a false prescription, and this test
 *    is where the attempt fails first.
 */

import { describe, expect, it } from 'vitest';

import {
  checkFieldCompleteness,
  checkViewCompleteness,
  FUNCTIONAL_COMPLETENESS_RULES,
  FIELD_SUMMARY_WITHOUT_OPERATIONS,
  FIELD_FORMULA_WITHOUT_EXPRESSION,
  FIELD_RELATIONSHIP_WITHOUT_REFERENCE,
  FIELD_CHOICE_WITHOUT_OPTIONS,
  VIEW_LAYOUT_WITHOUT_BINDING,
} from './functional-completeness';

const only = (findings: ReturnType<typeof checkFieldCompleteness>) => {
  expect(findings).toHaveLength(1);
  return findings[0];
};

describe('checkFieldCompleteness — the verified inert shapes go red', () => {
  it('flags a bare summary as an ERROR (the cloud#687 founding case)', () => {
    const f = only(checkFieldCompleteness({ type: 'summary' }));
    expect(f.rule).toBe(FIELD_SUMMARY_WITHOUT_OPERATIONS);
    expect(f.severity).toBe('error');
    expect(f.fix).toContain('summaryOperations');
    // The message must carry the runtime evidence — a prescription with no
    // "why" is the kind this campaign shipped four wrong ones of.
    expect(f.message).toContain('engine.ts');
  });

  it('is silent on a complete summary', () => {
    expect(checkFieldCompleteness({
      type: 'summary',
      summaryOperations: { object: 'order_line', field: 'amount', function: 'sum' },
    })).toEqual([]);
  });

  it('flags a bare formula as an ERROR', () => {
    const f = only(checkFieldCompleteness({ type: 'formula' }));
    expect(f.rule).toBe(FIELD_FORMULA_WITHOUT_EXPRESSION);
    expect(f.severity).toBe('error');
  });

  it('is silent on a formula with an expression — either input form', () => {
    expect(checkFieldCompleteness({ type: 'formula', expression: 'record.a * record.b' })).toEqual([]);
    expect(checkFieldCompleteness({
      type: 'formula',
      expression: { dialect: 'cel', source: 'record.a * record.b' },
    })).toEqual([]);
  });

  it.each(['lookup', 'master_detail'])('flags a %s without reference as an ERROR', (type) => {
    const f = only(checkFieldCompleteness({ type }));
    expect(f.rule).toBe(FIELD_RELATIONSHIP_WITHOUT_REFERENCE);
    expect(f.severity).toBe('error');
    expect(checkFieldCompleteness({ type, reference: 'account' })).toEqual([]);
  });

  it('does NOT flag `user` — its target is implicitly sys_user', () => {
    expect(checkFieldCompleteness({ type: 'user' })).toEqual([]);
  });

  it.each(['select', 'radio'])('flags a %s without options as an ERROR', (type) => {
    const f = only(checkFieldCompleteness({ type }));
    expect(f.rule).toBe(FIELD_CHOICE_WITHOUT_OPTIONS);
    expect(f.severity).toBe('error');
    expect(checkFieldCompleteness({ type, options: [] })).toHaveLength(1);
    expect(checkFieldCompleteness({
      type,
      options: [{ label: 'Open', value: 'open' }],
    })).toEqual([]);
  });

  it('flags checkboxes without options as a WARNING, not an error', () => {
    // Shares the validator's free-form multi branch, so it MAY be deliberate —
    // but a zero-box checkbox group almost never is. ADR-0078 §1: degrades → warning.
    const f = only(checkFieldCompleteness({ type: 'checkboxes' }));
    expect(f.rule).toBe(FIELD_CHOICE_WITHOUT_OPTIONS);
    expect(f.severity).toBe('warning');
  });

  it('does NOT flag multiselect without options — the pinned NON-rule', () => {
    // record-validator.ts:471, verbatim: "free-form (tags without options)".
    // The runtime blesses this as a mode; flagging it would be a false
    // prescription. If product direction ever changes, change the runtime
    // first — this pin makes the lint follow the code, never lead it.
    expect(checkFieldCompleteness({ type: 'multiselect' })).toEqual([]);
  });

  it('never throws on junk — a lint must not be what crashes a build', () => {
    for (const junk of [undefined, null, 42, 'x', [], {}, { type: 7 }, { type: 'nonsense' }]) {
      expect(() => checkFieldCompleteness(junk)).not.toThrow();
      expect(checkFieldCompleteness(junk)).toEqual([]);
    }
  });
});

describe('checkViewCompleteness — layout bindings', () => {
  it.each(['kanban', 'calendar', 'gantt'])('flags a %s view missing its block as a WARNING', (type) => {
    const f = only(checkViewCompleteness({ type }) as never);
    expect(f.rule).toBe(VIEW_LAYOUT_WITHOUT_BINDING);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe(type);
  });

  it('is silent when the block is present', () => {
    expect(checkViewCompleteness({
      type: 'calendar',
      calendar: { startDateField: 'due_at', titleField: 'title' },
    })).toEqual([]);
  });

  it('is silent on grid and on the unverified types (timeline, tree)', () => {
    // timeline/tree have config schemas too, but their renderer behaviour has
    // not had its verification pass — verify-then-enforce, one shape at a time.
    for (const type of ['grid', 'gallery', 'timeline', 'tree', 'map']) {
      expect(checkViewCompleteness({ type })).toEqual([]);
    }
  });
});

describe('registry hygiene', () => {
  it('pins the rule-id list — ids are API for suppressions and dashboards', () => {
    expect([...FUNCTIONAL_COMPLETENESS_RULES].sort()).toEqual([
      'field/choice-without-options',
      'field/formula-without-expression',
      'field/relationship-without-reference',
      'field/summary-without-operations',
      'view/layout-without-binding',
    ]);
  });

  it('every emitted finding carries a fix — the prescription IS the payload', () => {
    const all = [
      ...checkFieldCompleteness({ type: 'summary' }),
      ...checkFieldCompleteness({ type: 'formula' }),
      ...checkFieldCompleteness({ type: 'lookup' }),
      ...checkFieldCompleteness({ type: 'select' }),
      ...checkFieldCompleteness({ type: 'checkboxes' }),
      ...checkViewCompleteness({ type: 'kanban' }),
    ];
    expect(all).toHaveLength(6);
    for (const f of all) {
      expect(f.fix.length).toBeGreaterThan(8);
      expect(f.message.length).toBeGreaterThan(60);
    }
  });
});
