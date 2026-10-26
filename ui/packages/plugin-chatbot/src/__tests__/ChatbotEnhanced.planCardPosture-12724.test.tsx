/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12724 — the plan card says how the build will land (the AiBuild
 * artboard's last 假设 item, 「首次搭建直接上线；之后的修改先存草稿，由你发布」) from
 * the `planCard.posture` key objectstack-ai/cloud declares (cloud#2924 ruling A;
 * `build-cards.schema.json`, vendored as `fixtures/build-cards.schema.ts`). A plan
 * card without the key says nothing about it.
 *
 * Each message goes through the real mapper (`uiMessageToChatMessage`) from a
 * raw tool part, so the lift is under test, not a hand-built invocation.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessageToChatMessage } from '../mapMessages';
import { planEnvelope } from './fixtures/buildCards.fixtures';

const turn = (output: unknown) =>
  uiMessageToChatMessage({
    id: 'plan',
    role: 'assistant',
    parts: [{ type: 'tool-propose_blueprint', toolCallId: 'plan-0', state: 'output-available', input: {}, output }],
  });

const renderPlan = (envelope: unknown, lang: 'zh' | 'en' = 'zh') =>
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <ChatbotEnhanced messages={[turn(envelope)]} onSendMessage={vi.fn()} />
    </I18nProvider>,
  );

const assumptionItems = () =>
  within(screen.getByTestId('proposed-plan-assumptions'))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('objectui#12724 — the plan card draws `planCard.posture.line`', () => {
  it('zh: a first build`s line is the last assumption item', () => {
    renderPlan(planEnvelope('zh', { posture: 'firstBuild' }));
    expect(assumptionItems()).toEqual([
      '只建这三部分，不建仪表盘、预约、罚款；补充的字段（分类）可以去掉。',
      '归还后状态置为已还；逾期由应还日期已过且未归还判定。',
      '首次搭建直接上线；之后的修改先存草稿，由你发布',
    ]);
    expect(screen.getByTestId('proposed-plan-posture')).toHaveAttribute('data-posture', 'publish');
  });

  it('en: the same line in English', () => {
    renderPlan(planEnvelope('en', { posture: 'firstBuild' }), 'en');
    expect(screen.getByTestId('proposed-plan-posture')).toHaveTextContent(
      /^This first build goes live at once; later changes are saved as drafts for you to publish$/,
    );
  });

  it('a build into a live app draws the producer`s draft line, records included', () => {
    renderPlan(planEnvelope('zh', { posture: 'draft' }));
    const line = screen.getByTestId('proposed-plan-posture');
    expect(line).toHaveTextContent(/^这个应用已上线，有 36 条记录在用；这次的改动先存为草稿，由你在「变更」里核对后发布$/);
    expect(line).toHaveAttribute('data-posture', 'draft');
  });

  it('a plan card with no assumptions still draws the section for the posture line alone', () => {
    const plan = planEnvelope('zh', { posture: 'firstBuild' });
    renderPlan({ ...plan, planCard: { ...plan.planCard, assumptions: [] } });
    expect(assumptionItems()).toEqual(['首次搭建直接上线；之后的修改先存草稿，由你发布']);
  });

  it('CONTROL: a plan card without `posture` draws only the assumptions', () => {
    renderPlan(planEnvelope('zh'));
    expect(screen.queryByTestId('proposed-plan-posture')).not.toBeInTheDocument();
    expect(assumptionItems()).toHaveLength(2);
  });

  it('CONTROL: a posture whose mode the schema does not declare is not drawn', () => {
    const plan = planEnvelope('zh', { posture: 'firstBuild' });
    renderPlan({ ...plan, planCard: { ...plan.planCard, posture: { ...plan.planCard.posture, mode: 'live' } } });
    expect(screen.queryByTestId('proposed-plan-posture')).not.toBeInTheDocument();
  });
});
