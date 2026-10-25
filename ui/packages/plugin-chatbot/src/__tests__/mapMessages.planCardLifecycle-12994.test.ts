/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12994 — `liftPlanCard` lifts a field chip's `lifecycle` (the words
 * the chip draws, `lifecycle.label`) when it is a well-formed object with a
 * string label, and drops a malformed one like any other undeclared value.
 */
import { describe, expect, it } from 'vitest';
import { detectProposedPlan } from '../mapMessages';
import { planEnvelope } from './fixtures/buildCards.fixtures';

/** The plan envelope with the loan `status` field's `lifecycle` replaced by `value`. */
function withLifecycle(value: unknown) {
  const plan = planEnvelope('zh');
  const loan = plan.planCard.objects[2];
  const fields = loan.fields.map((f) => (f.name === 'status' ? { ...f, lifecycle: value } : f));
  return { ...plan, planCard: { ...plan.planCard, objects: [...plan.planCard.objects.slice(0, 2), { ...loan, fields }] } };
}

const statusOf = (envelope: unknown) => detectProposedPlan(envelope)!.planCard!.objects[2].fields[5];

describe('liftPlanCard lifts a field`s lifecycle (objectui#12994)', () => {
  it('lifts the label the chip draws, and not the producer`s options', () => {
    expect(statusOf(planEnvelope('zh'))).toEqual({
      name: 'status',
      label: '状态',
      lifecycle: { label: '借出 · 已还 ✓完成 · 逾期 ⚠' },
    });
  });

  it('a field without the key lifts none', () => {
    const fields = detectProposedPlan(planEnvelope('zh'))!.planCard!.objects[2].fields;
    expect(fields.slice(0, 5).every((f) => !('lifecycle' in f))).toBe(true);
  });

  it.each([
    ['a string', '借出 · 已还'],
    ['an array', [{ label: '借出' }]],
    ['null', null],
    ['an object without a label', { options: [] }],
    ['an object with an empty label', { options: [], label: '' }],
    ['an object with a non-string label', { options: [], label: 3 }],
  ])('drops %s without throwing', (_what, value) => {
    expect(statusOf(withLifecycle(value))).toEqual({ name: 'status', label: '状态' });
  });
});
