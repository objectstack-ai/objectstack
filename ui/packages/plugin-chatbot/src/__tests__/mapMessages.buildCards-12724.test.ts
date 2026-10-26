/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12724, phase 2 — the lifts behind the build cards' v2 rows. Each
 * reads one declared key of objectstack-ai/cloud's `build-cards.schema.json`
 * (vendored as `fixtures/build-cards.schema.ts`) and keeps only what a card
 * draws; a value that is not the declared shape lifts nothing, so the card
 * keeps its earlier rows.
 */
import { describe, expect, it } from 'vitest';
import { detectBuildChecklist, detectProposedPlan } from '../mapMessages';
import { applyEnvelope, planEnvelope, verifyEnvelope } from './fixtures/buildCards.fixtures';

describe('detectProposedPlan lifts planCard and viewIntents (objectui#12724)', () => {
  it('keeps the drawn keys of planCard and nothing else', () => {
    const plan = detectProposedPlan(planEnvelope('zh'))!;
    expect(plan.planCard!.objects[0]).toEqual({
      name: 'book',
      label: '图书',
      fields: [
        { name: 'title', label: '书名' },
        { name: 'author', label: '作者' },
        { name: 'isbn', label: 'ISBN', format: { label: '13 位数字' } },
        { name: 'copies', label: '馆藏数量' },
        { name: 'category', label: '分类', suggested: true },
      ],
      nameField: { name: 'title', label: '书名' },
    });
    expect(plan.planCard!.objects[2].nameField).toBeUndefined();
    // A view keeps its name, object, label and line; layout, filters, sort and
    // fields are the producer's, not drawn here.
    expect(plan.planCard!.views[1]).toEqual({
      view: 'overdue_loans',
      object: 'loan',
      label: '逾期未还记录',
      line: '列表 · 筛选 状态 = 逾期 且 归还日期 为空 · 按应还日期升序',
    });
    expect(plan.planCard!.sampleData).toEqual({ line: '示例数据 12 条/对象' });
  });

  it('reads the assumptions from planCard, and from the blueprint without one', () => {
    expect(detectProposedPlan(planEnvelope('zh'))!.assumptions).toEqual(planEnvelope('zh').planCard.assumptions);
    const { planCard: _c, ...older } = planEnvelope('zh');
    expect(detectProposedPlan(older)!.assumptions).toEqual(['blueprint assumption the plan card does not repeat']);
    expect(detectProposedPlan(older)!.planCard).toBeUndefined();
  });

  it('lifts viewIntents as sent', () => {
    expect(detectProposedPlan(planEnvelope('zh'))!.viewIntents!.map((v) => v.view)).toEqual([
      'loan_board',
      'overdue_loans',
      'all_books',
    ]);
  });

  it('a planCard missing a required list is not a plan card', () => {
    const plan = planEnvelope('zh');
    const { views: _v, ...noViews } = plan.planCard;
    expect(detectProposedPlan({ ...plan, planCard: noViews })!.planCard).toBeUndefined();
    expect(detectProposedPlan({ ...plan, planCard: 'card' })!.planCard).toBeUndefined();
  });
});

describe('detectBuildChecklist reads the result card`s checklist (objectui#12724)', () => {
  it('on apply_blueprint`s drafted envelope', () => {
    expect(detectBuildChecklist(applyEnvelope('zh'))).toEqual({
      status: 'passed',
      passed: 7,
      total: 7,
      lines: [
        { kind: 'object', status: 'passed', line: '图书 · 5 个字段 · 12 条示例' },
        { kind: 'object', status: 'passed', line: '读者 · 3 个字段 · 12 条示例' },
        { kind: 'object', status: 'passed', line: '借阅记录 · 6 个字段 · 12 条示例' },
        { kind: 'view', status: 'passed', line: '借阅看板 · 按状态分组 · 5 / 4 / 3' },
        { kind: 'view', status: 'passed', line: '逾期未还记录 · 筛选生效 · 命中 3 条' },
        { kind: 'view', status: 'passed', line: '图书 · 显示全部记录 · 12 条' },
        { kind: 'sampleData', status: 'passed', line: '示例数据 · 无重复 · ISBN / 邮箱格式通过' },
      ],
      app: { name: 'library_app', label: '图书借阅管理' },
      packageId: 'app.hcpl',
    });
  });

  it('on verify_build`s envelope, wrapped as the SDK delivers a text tool output', () => {
    const wrapped = { type: 'text', value: JSON.stringify(verifyEnvelope('en', { failedView: true })) };
    const checklist = detectBuildChecklist(wrapped)!;
    expect([checklist.status, checklist.passed, checklist.total]).toEqual(['failed', 6, 7]);
  });

  it('nothing without a checklist, or with one missing a required key', () => {
    const { checklist, ...older } = applyEnvelope('zh');
    expect(detectBuildChecklist(older)).toBeUndefined();
    const { lines: _l, ...noLines } = checklist;
    expect(detectBuildChecklist({ ...older, checklist: noLines })).toBeUndefined();
    expect(detectBuildChecklist({ ...older, checklist: { ...checklist, passed: -1 } })).toBeUndefined();
  });
});
