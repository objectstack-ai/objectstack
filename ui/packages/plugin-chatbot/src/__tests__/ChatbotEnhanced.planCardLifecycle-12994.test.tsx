/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12994 — the plan card draws a stage field's lifecycle on its chip
 * (the AiBuild artboard's 「借出 · 已还 ✓完成 · 逾期 ⚠」), from the
 * `planCard.objects[].fields[].lifecycle` key objectstack-ai/cloud declares
 * (`build-cards.schema.json`, vendored as `fixtures/build-cards.schema.ts`).
 * A chip without the key draws as before.
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

const chipsOf = (objectName: string) =>
  within(screen.getByTestId(`proposed-plan-object-${objectName}`)).getAllByTestId('proposed-plan-field');

describe('objectui#12994 — the plan card draws a stage field`s lifecycle', () => {
  it('zh: the stage field`s chip draws its lifecycle beside its label', () => {
    renderPlan(planEnvelope('zh'));
    const status = chipsOf('loan')[5];
    expect(status).toHaveAttribute('title', 'status');
    expect(within(status).getByTestId('proposed-plan-field-lifecycle')).toHaveTextContent(/^借出 · 已还 ✓完成 · 逾期 ⚠$/);
    expect(status.textContent).toBe('状态借出 · 已还 ✓完成 · 逾期 ⚠');
    expect(screen.getAllByTestId('proposed-plan-field-lifecycle')).toHaveLength(1);
  });

  it('en: the same line in English', () => {
    renderPlan(planEnvelope('en'), 'en');
    expect(within(chipsOf('loan')[5]).getByTestId('proposed-plan-field-lifecycle')).toHaveTextContent(
      /^Borrowed · Returned ✓done · Overdue ⚠$/,
    );
  });

  it('CONTROL: a chip without the key draws as before', () => {
    renderPlan(planEnvelope('zh'));
    expect(chipsOf('loan').slice(0, 5).map((c) => c.textContent)).toEqual(['图书', '读者', '借出日期', '应还日期', '归还日期']);
    for (const chip of chipsOf('book')) {
      expect(within(chip).queryByTestId('proposed-plan-field-lifecycle')).not.toBeInTheDocument();
    }
  });

  it('CONTROL: the same stage field without `lifecycle` draws its plain label', () => {
    const plan = planEnvelope('zh');
    const loan = plan.planCard.objects[2];
    const fields = loan.fields.map((f) => {
      if (!('lifecycle' in f)) return f;
      const { lifecycle: _l, ...rest } = f;
      return rest;
    });
    const objects = [...plan.planCard.objects.slice(0, 2), { ...loan, fields }];
    renderPlan({ ...plan, planCard: { ...plan.planCard, objects } });
    expect(chipsOf('loan')[5].textContent).toBe('状态');
    expect(screen.queryByTestId('proposed-plan-field-lifecycle')).not.toBeInTheDocument();
  });
});
