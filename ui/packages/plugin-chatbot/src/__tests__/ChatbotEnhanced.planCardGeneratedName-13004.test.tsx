/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13004 — the plan card draws a composed record title's line (the
 * AiBuild artboard's 「名称：自动生成「{图书} · {读者} · {借出日期}」，表单里不出现」)
 * from the `planCard.objects[].nameField.generated` key objectstack-ai/cloud
 * declares (`build-cards.schema.json`, vendored as `fixtures/build-cards.schema.ts`),
 * in place of the plain 「名称：LABEL」 line. An object without the key draws as before.
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

const nameLineOf = (objectName: string) =>
  within(screen.getByTestId(`proposed-plan-object-${objectName}`)).queryByTestId('proposed-plan-name-field');

describe('objectui#13004 — the plan card draws a generated record title`s line', () => {
  it('zh: the loan draws the producer`s line, not 「名称：借阅标题」', () => {
    renderPlan(planEnvelope('zh', { generatedTitle: true }));
    const line = nameLineOf('loan');
    expect(line).toHaveTextContent(/^名称：自动生成「\{图书\} · \{读者\} · \{借出日期\}」，表单里不出现$/);
    expect(line).toHaveAttribute('data-generated', 'true');
    expect(line).not.toHaveTextContent('借阅标题');
  });

  it('en: the same line in English', () => {
    renderPlan(planEnvelope('en', { generatedTitle: true }), 'en');
    expect(nameLineOf('loan')).toHaveTextContent(/^Name: generated as “\{Book\} · \{Reader\} · \{Loan date\}”, not on the form$/);
  });

  it('the chips are drawn from `fields[]` as given: the producer left the title field out', () => {
    renderPlan(planEnvelope('zh', { generatedTitle: true }));
    const chips = within(screen.getByTestId('proposed-plan-object-loan')).getAllByTestId('proposed-plan-field');
    expect(chips.map((c) => c.getAttribute('title'))).toEqual(['book', 'reader', 'loan_date', 'due_date', 'return_date', 'status']);
  });

  it('CONTROL: an object whose `nameField` has no `generated` draws its plain 「名称：LABEL」 line', () => {
    renderPlan(planEnvelope('zh', { generatedTitle: true }));
    expect(nameLineOf('book')).toHaveTextContent(/^名称：书名$/);
    expect(nameLineOf('book')).not.toHaveAttribute('data-generated');
    expect(nameLineOf('reader')).toHaveTextContent(/^名称：姓名$/);
  });

  it('CONTROL: the same loan `nameField` without `generated` draws 「名称：借阅标题」', () => {
    const plan = planEnvelope('zh', { generatedTitle: true });
    const objects = plan.planCard.objects.map((o) => {
      if (!('nameField' in o) || !o.nameField || !('generated' in o.nameField)) return o;
      const { generated: _g, ...nameField } = o.nameField;
      return { ...o, nameField };
    });
    renderPlan({ ...plan, planCard: { ...plan.planCard, objects } });
    expect(nameLineOf('loan')).toHaveTextContent(/^名称：借阅标题$/);
    expect(nameLineOf('loan')).not.toHaveAttribute('data-generated');
  });
});
