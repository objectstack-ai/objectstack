/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13004 — `liftPlanCard` lifts an object's `nameField.generated` as the
 * line the card draws (`{ line }`) when it is a well-formed object with a string
 * line, and drops a malformed one like any other undeclared value.
 */
import { describe, expect, it } from 'vitest';
import { detectProposedPlan } from '../mapMessages';
import { planEnvelope } from './fixtures/buildCards.fixtures';

/** The generated-title plan envelope with the loan's `nameField.generated` replaced by `value`. */
function withGenerated(value: unknown) {
  const plan = planEnvelope('zh', { generatedTitle: true });
  const objects = plan.planCard.objects.map((o) =>
    o.name === 'loan' ? { ...o, nameField: { name: 'title', label: '借阅标题', generated: value } } : o,
  );
  return { ...plan, planCard: { ...plan.planCard, objects } };
}

const loanNameOf = (envelope: unknown) => detectProposedPlan(envelope)!.planCard!.objects[2].nameField;

describe('liftPlanCard lifts a name field`s generated line (objectui#13004)', () => {
  it('lifts the line the card draws, and not the producer`s template', () => {
    expect(loanNameOf(planEnvelope('zh', { generatedTitle: true }))).toEqual({
      name: 'title',
      label: '借阅标题',
      generated: { line: '名称：自动生成「{图书} · {读者} · {借出日期}」，表单里不出现' },
    });
  });

  it('a name field without the key lifts none', () => {
    const objects = detectProposedPlan(planEnvelope('zh', { generatedTitle: true }))!.planCard!.objects;
    expect(objects[0].nameField).toEqual({ name: 'title', label: '书名' });
    expect(objects[1].nameField).toEqual({ name: 'full_name', label: '姓名' });
  });

  it.each([
    ['a string', '名称：自动生成'],
    ['an array', [{ line: '名称：自动生成' }]],
    ['null', null],
    ['an object without a line', { template: '{图书}' }],
    ['an object with an empty line', { template: '{图书}', line: '' }],
    ['an object with a non-string line', { template: '{图书}', line: 3 }],
  ])('drops %s without throwing', (_what, value) => {
    expect(loanNameOf(withGenerated(value))).toEqual({ name: 'title', label: '借阅标题' });
  });
});
