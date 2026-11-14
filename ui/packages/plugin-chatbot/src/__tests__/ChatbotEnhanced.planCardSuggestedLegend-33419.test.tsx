/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * #33419 — the plan card says what its dashed 「· 补充」 (`· suggested`) mark
 * means. A field the user's words did not name arrives with `suggested: true`
 * on `planCard.objects[].fields[]` and is drawn as a dashed chip ending in the
 * mark. When at least one field on the card is suggested, one legend line under
 * the field rows explains it: the AI added the field, the user did not ask for
 * it. The chip's tooltip keeps the field's machine name.
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

type Plan = ReturnType<typeof planEnvelope>;

/** The plan with its card's objects replaced (the envelope is raw tool output, typed `unknown` by the mapper). */
const withObjects = (plan: Plan, objects: readonly unknown[]) => ({ ...plan, planCard: { ...plan.planCard, objects } });

/** One object, one field the user named and one the AI suggested. */
const oneNamedOneSuggested = (lang: 'zh' | 'en') => {
  const plan = planEnvelope(lang);
  const book = plan.planCard.objects[0];
  const title = book.fields.find((f) => f.name === 'title')!;
  const category = book.fields.find((f) => f.name === 'category')!;
  expect('suggested' in title).toBe(false);
  expect(category).toMatchObject({ suggested: true });
  return withObjects(plan, [{ ...book, fields: [title, category] }]);
};

/** Every field on the card with `suggested` taken off. */
const noneSuggested = (lang: 'zh' | 'en') => {
  const plan = planEnvelope(lang);
  return withObjects(
    plan,
    plan.planCard.objects.map((o) => ({
      ...o,
      fields: o.fields.map((f) => {
        if (!('suggested' in f)) return f;
        const { suggested: _s, ...rest } = f;
        return rest;
      }),
    })),
  );
};

const legends = () => screen.queryAllByTestId('proposed-plan-suggested-legend');

describe('#33419 — the plan card explains its suggested-field mark', () => {
  it('zh: one named and one suggested field: one legend line under the field rows, the chip keeps its machine name', () => {
    renderPlan(oneNamedOneSuggested('zh'));
    expect(legends()).toHaveLength(1);
    expect(legends()[0]).toHaveTextContent(/^标「补充」的字段是 AI 自行补充的，你没有要求。$/);
    // Under the field rows: inside the objects block, after its last object row.
    const objects = screen.getByTestId('proposed-plan-objects');
    expect(objects).toContainElement(legends()[0]);
    expect(objects.lastElementChild).toBe(legends()[0]);
    const chips = within(screen.getByTestId('proposed-plan-object-book')).getAllByTestId('proposed-plan-field');
    expect(chips.map((c) => c.getAttribute('title'))).toEqual(['title', 'category']);
    expect(chips[1]).toHaveAttribute('data-suggested', 'true');
    expect(chips[1]).toHaveTextContent(/· 补充$/);
    expect(chips[0]).not.toHaveAttribute('data-suggested');
  });

  it('en: the same legend in English', () => {
    renderPlan(oneNamedOneSuggested('en'), 'en');
    expect(legends()).toHaveLength(1);
    expect(legends()[0]).toHaveTextContent(/^Fields marked “suggested” were added by the AI; you didn’t ask for them\.$/);
  });

  it('two suggested fields on two objects still draw one legend line', () => {
    const plan = planEnvelope('zh');
    const objects = plan.planCard.objects.map((o) =>
      o.name === 'reader'
        ? { ...o, fields: o.fields.map((f) => (f.name === 'phone' ? { ...f, suggested: true } : f)) }
        : o,
    );
    renderPlan(withObjects(plan, objects));
    expect(document.querySelectorAll('[data-suggested="true"]')).toHaveLength(2);
    expect(legends()).toHaveLength(1);
  });

  it('CONTROL: no suggested field on the card draws no legend', () => {
    renderPlan(noneSuggested('zh'));
    expect(screen.getByTestId('proposed-plan-objects')).toBeInTheDocument();
    expect(document.querySelector('[data-suggested]')).toBeNull();
    expect(legends()).toHaveLength(0);
    expect(screen.getByTestId('proposed-plan-objects')).not.toHaveTextContent('补充');
  });
});
