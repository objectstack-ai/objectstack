// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7113] `SkillTriggerConditionSchema.value` is shaped by the condition's
 * OPERATOR — the dormant twin of #6227 (`ViewFilterRuleSchema`, PR #7114).
 *
 * "Dormant" is the whole difference and these pins are written around it. The
 * #6227 shape genuinely failed at query time; this one never failed at all —
 * the sole consumer (`SkillRegistry.evaluateCondition`, cloud
 * `packages/service-ai/src/skill-registry.ts`) coerces the scalar with
 * `Array.isArray(expected) ? expected : [expected]`. So what these pins hold is
 * not a break-fix but the contract-first property: the producer declares the
 * one spelling instead of letting a consumer quietly accept two.
 *
 * Every rejection pin asserts the issue CODE and PATH, not merely that a throw
 * happened: a bare `.toThrow()` cannot tell "refused for the right reason at
 * the right key" from "refused because the value union rejected the type", and
 * those are different defects (#6142).
 *
 * The accept pins matter as much as the reject pins. `contains` keeps BOTH
 * spellings on purpose — the consumer has a live array⊆array branch for it —
 * and #5685 rules that a schema stricter than its runtime is the wrong side of
 * the fix. A pin that only checked rejections would let that regress silently.
 */

import { describe, expect, it } from 'vitest';
import {
  SKILL_TRIGGER_LIST_VALUE_OPERATORS,
  SKILL_TRIGGER_SCALAR_VALUE_OPERATORS,
  SkillSchema,
  SkillTriggerConditionSchema,
} from './skill.zod';

/** Parse helper — the authored object form, exactly as a skill carries it. */
const parse = (condition: Record<string, unknown>) =>
  SkillTriggerConditionSchema.safeParse(condition);

/** The single `value`-path issue a shape refusal must produce. */
function valueIssue(result: ReturnType<typeof parse>) {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('unreachable');
  const issues = result.error.issues.filter((i) => i.path.join('.') === 'value');
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

describe('#7113 — the reported shape is refused at authoring time', () => {
  it('refuses the card example: a set operator carrying a scalar', () => {
    const result = parse({ field: 'userRole', operator: 'in', value: 'admin' });
    const issue = valueIssue(result);

    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['value']);
    expect(issue.message).toContain(
      'Operator "in" on field "userRole" requires an ARRAY of values.',
    );
    // The refusal carries what the author has to DO, not just what is wrong.
    expect(issue.message).toContain('Received a string ("admin")');
    expect(issue.message).toContain('write ["admin"] for a single value');
    expect(issue.message).toContain('or use "eq" to compare against it');
    // And it says the empty list is NOT what is being refused.
    expect(issue.message).toContain('An empty list [] is allowed');
  });

  it('names the consumer-side coercion as the thing being replaced', () => {
    const issue = valueIssue(parse({ field: 'userRole', operator: 'not_in', value: 'admin' }));
    expect(issue.message).toContain('coerces the scalar today');
    expect(issue.message).toContain('#7113');
  });
});

describe('#7113 — list operators require an array', () => {
  it.each(SKILL_TRIGGER_LIST_VALUE_OPERATORS)('%s refuses a scalar', (operator) => {
    const issue = valueIssue(parse({ field: 'objectName', operator, value: 'lead' }));
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['value']);
    expect(issue.message).toContain(`Operator "${operator}"`);
    expect(issue.message).toContain('requires an ARRAY of values');
  });

  it.each(SKILL_TRIGGER_LIST_VALUE_OPERATORS)('%s accepts an array', (operator) => {
    const result = parse({ field: 'objectName', operator, value: ['lead', 'opportunity'] });
    expect(result.success).toBe(true);
  });

  it.each(SKILL_TRIGGER_LIST_VALUE_OPERATORS)(
    '%s accepts an EMPTY array — it is a real predicate, not the defect',
    (operator) => {
      expect(parse({ field: 'objectName', operator, value: [] }).success).toBe(true);
    },
  );

  it('refuses a missing value with ONE issue — the required check, not two', () => {
    // Measured, not assumed: Zod 4 skips a `superRefine` when the object's own
    // shape already failed, so an omitted `value` reports only the required
    // issue. Pinned because the refinement's "no value" wording exists for the
    // case where a future carrier makes `value` optional — this records that
    // today it is unreachable, rather than leaving a reader to guess that a
    // missing value produces two competing complaints at one key.
    const result = parse({ field: 'objectName', operator: 'in' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    const atValue = result.error.issues.filter((i) => i.path.join('.') === 'value');
    expect(atValue).toHaveLength(1);
    expect(atValue[0]!.code).not.toBe('custom');
  });
});

describe('#7113 — identity operators require a string', () => {
  it.each(SKILL_TRIGGER_SCALAR_VALUE_OPERATORS)('%s refuses an array', (operator) => {
    const issue = valueIssue(parse({ field: 'objectName', operator, value: ['lead'] }));
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['value']);
    expect(issue.message).toContain(`Operator "${operator}"`);
    expect(issue.message).toContain('requires a single STRING value');
    // The message must explain the DEAD-predicate mechanism, since nothing
    // errors today — an author has no runtime symptom to reason from.
    expect(issue.message).toContain(operator === 'eq' ? 'never fire' : 'always fire');
    expect(issue.message).toContain(operator === 'eq' ? 'use "in"' : 'use "not_in"');
  });

  it.each(SKILL_TRIGGER_SCALAR_VALUE_OPERATORS)('%s accepts a string', (operator) => {
    expect(parse({ field: 'objectName', operator, value: 'lead' }).success).toBe(true);
  });
});

describe('#7113 — `contains` keeps BOTH shapes (#5685: no stricter than the runtime)', () => {
  it('accepts a string comparand — the substring branch', () => {
    expect(parse({ field: 'viewName', operator: 'contains', value: 'kanban' }).success).toBe(true);
  });

  it('accepts an array comparand — the live array⊆array subset branch', () => {
    // `evaluateCondition`: `expected.every(v => fieldValue.includes(v))` when the
    // context field is an array. `SkillContext` is indexed `[k: string]: unknown`,
    // so that is a shape the cloud runtime is deliberately written for.
    // Refusing it here would un-declare a working capability (an ADR-0049
    // retirement decision), not tighten a contract.
    expect(parse({ field: 'tags', operator: 'contains', value: ['a', 'b'] }).success).toBe(true);
  });

  it('is in neither constrained vocabulary', () => {
    expect(SKILL_TRIGGER_LIST_VALUE_OPERATORS).not.toContain('contains');
    expect(SKILL_TRIGGER_SCALAR_VALUE_OPERATORS).not.toContain('contains');
  });
});

describe('#7113 — the exported vocabularies are the contract, not a copy', () => {
  it('the two vocabularies are disjoint and both subsets of the operator enum', () => {
    const all = [
      ...SKILL_TRIGGER_LIST_VALUE_OPERATORS,
      ...SKILL_TRIGGER_SCALAR_VALUE_OPERATORS,
    ];
    expect(new Set(all).size).toBe(all.length);
    for (const operator of all) {
      // Every declared member must actually be an operator the schema accepts.
      expect(parse({
        field: 'f',
        operator,
        value: (SKILL_TRIGGER_LIST_VALUE_OPERATORS as readonly string[]).includes(operator)
          ? ['x']
          : 'x',
      }).success).toBe(true);
    }
  });

  it('pins the membership so a future operator has to be classified', () => {
    expect([...SKILL_TRIGGER_LIST_VALUE_OPERATORS]).toEqual(['in', 'not_in']);
    expect([...SKILL_TRIGGER_SCALAR_VALUE_OPERATORS]).toEqual(['eq', 'neq']);
  });
});

describe('#7113 — the refinement does not disturb the carrier', () => {
  it('an unrelated operator/value pair still parses through Skill.triggerConditions', () => {
    const skill = SkillSchema.parse({
      name: 'order_management',
      label: 'Order Management',
      instructions: 'Manage orders.',
      tools: ['create_order'],
      triggerConditions: [
        { field: 'objectName', operator: 'eq', value: 'order' },
        { field: 'userRole', operator: 'in', value: ['sales', 'support'] },
      ],
    });
    expect(skill.triggerConditions).toHaveLength(2);
  });

  it('a bad condition inside a skill reports at the nested value path', () => {
    // The path prefix proves the refinement travels with the carrier rather
    // than only firing on a standalone parse.
    const result = SkillSchema.safeParse({
      name: 'order_management',
      label: 'Order Management',
      instructions: 'Manage orders.',
      tools: ['create_order'],
      triggerConditions: [{ field: 'userRole', operator: 'in', value: 'admin' }],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    const issue = result.error.issues.find(
      (i) => i.path.join('.') === 'triggerConditions.0.value',
    );
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('custom');
  });
});
