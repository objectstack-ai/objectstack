/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `QuestionCard` behaviour, provider-less: what each click and key does, and
 * the answer text the host receives.
 *
 * No `I18nProvider` is mounted anywhere in this file, so every string is the
 * defaults map's English. The provider legs (other languages, right-to-left)
 * live in `QuestionCard.i18n.test.tsx`: once a provider has mounted in a file,
 * react-i18next's module-level global answers later provider-less renders in
 * that same file, so the two legs cannot share one.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { en } from '@object-ui/i18n';
import { QuestionCard, type QuestionCardQuestion } from '../QuestionCard';
import { QUESTION_CARD_DEFAULT_TRANSLATIONS } from '../useQuestionCardTranslation';

afterEach(cleanup);

const REGION: QuestionCardQuestion = {
  header: 'Region',
  question: 'Which region should the total cover?',
  options: [
    { label: 'All regions', description: 'Every region added together', recommended: true },
    { label: 'East only' },
    { label: 'West only' },
  ],
};

const PERIOD: QuestionCardQuestion = {
  question: 'Which period?',
  options: [{ label: 'This month' }, { label: 'This quarter' }],
};

function renderCard(questions: readonly QuestionCardQuestion[], extra: { announce?: boolean } = {}) {
  const onAnswer = vi.fn<(text: string) => void>();
  const onSkip = vi.fn<() => void>();
  const view = render(<QuestionCard questions={questions} onAnswer={onAnswer} onSkip={onSkip} {...extra} />);
  return { onAnswer, onSkip, view };
}

const radios = () => screen.getAllByRole('radio');
const textRow = () => screen.getByRole('textbox', { name: 'Type something else…' });
const button = (name: string) => screen.getByRole('button', { name });

describe('QuestionCard — one question', () => {
  it('sends the option label on a single click', () => {
    const { onAnswer } = renderCard([REGION]);
    fireEvent.click(screen.getByRole('radio', { name: /East only/ }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('East only');
  });

  it('shows the description as a second line and tags the recommended option', () => {
    renderCard([REGION]);
    const first = screen.getByRole('radio', { name: /All regions/ });
    expect(within(first).getByText('Every region added together')).toBeTruthy();
    expect(within(first).getByText('Recommended')).toBeTruthy();
    expect(within(screen.getByRole('radio', { name: /West only/ })).queryByText('Recommended')).toBeNull();
  });

  it('shows no progress line for a single question', () => {
    renderCard([REGION]);
    expect(screen.queryByText(/^Question \d/)).toBeNull();
    expect(screen.getByText('AI asks:')).toBeTruthy();
  });

  it('sends typed text on Enter, and typing clears the picked option', () => {
    const { onAnswer } = renderCard([REGION]);
    fireEvent.keyDown(radios()[0]!, { key: '2' });
    expect(onAnswer).toHaveBeenLastCalledWith('East only');
    fireEvent.change(textRow(), { target: { value: '  North and South  ' } });
    expect(radios().every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    fireEvent.keyDown(textRow(), { key: 'Enter' });
    expect(onAnswer).toHaveBeenLastCalledWith('North and South');
  });

  it('does not send blank typed text', () => {
    const { onAnswer } = renderCard([REGION]);
    fireEvent.change(textRow(), { target: { value: '   ' } });
    fireEvent.keyDown(textRow(), { key: 'Enter' });
    expect(onAnswer).not.toHaveBeenCalled();
    expect((button('Send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onSkip and never onAnswer on Skip', () => {
    const { onAnswer, onSkip } = renderCard([REGION]);
    fireEvent.click(button('Skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('keeps the picked option across a re-render with new props, so Send can retry', () => {
    const { onAnswer, view } = renderCard([REGION]);
    fireEvent.click(screen.getByRole('radio', { name: /West only/ }));
    const retry = vi.fn<(text: string) => void>();
    view.rerender(<QuestionCard questions={[{ ...REGION }]} onAnswer={retry} onSkip={() => {}} />);
    expect(screen.getByRole('radio', { name: /West only/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(button('Send'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith('West only');
  });
});

describe('QuestionCard — two questions', () => {
  it('moves on after question 1, stops on Send after question 2, and composes one line each', () => {
    const { onAnswer } = renderCard([REGION, PERIOD]);
    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /East only/ }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText('Question 2 of 2')).toBeTruthy();
    expect(screen.getByText('Which period?')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /This quarter/ }));
    expect(onAnswer).not.toHaveBeenCalled();
    // The header names the first line; the question text stands in for the missing one.
    expect(screen.getByTestId('question-card-summary').textContent).toBe(
      'Region: East only · Which period?: This quarter',
    );

    fireEvent.click(button('Send'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('Region: East only\nWhich period?: This quarter');
  });

  it('Back keeps the choices of both questions', () => {
    const { onAnswer } = renderCard([REGION, PERIOD]);
    fireEvent.click(screen.getByRole('radio', { name: /West only/ }));
    fireEvent.click(screen.getByRole('radio', { name: /This month/ }));
    fireEvent.click(button('Back'));
    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /West only/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(button('Next'));
    expect(screen.getByRole('radio', { name: /This month/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(button('Send'));
    expect(onAnswer).toHaveBeenCalledWith('Region: West only\nWhich period?: This month');
  });

  it('Next is disabled until the current question is answered', () => {
    renderCard([REGION, PERIOD]);
    expect((button('Next') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('carries typed text on either question into the answer', () => {
    const { onAnswer } = renderCard([REGION, PERIOD]);
    fireEvent.change(textRow(), { target: { value: 'Central' } });
    fireEvent.keyDown(textRow(), { key: 'Enter' });
    expect(screen.getByText('Question 2 of 2')).toBeTruthy();
    expect((textRow() as HTMLInputElement).value).toBe('');
    fireEvent.change(textRow(), { target: { value: 'Last 30 days' } });
    fireEvent.keyDown(textRow(), { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith('Region: Central\nWhich period?: Last 30 days');
  });
});

describe('QuestionCard — keyboard and screen reader', () => {
  it('does not move focus into the card when it appears', () => {
    const outside = document.createElement('textarea');
    document.body.appendChild(outside);
    outside.focus();
    renderCard([REGION, PERIOD], { announce: true });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('digits pick options; a digit typed in the text row stays text', () => {
    const { onAnswer } = renderCard([REGION, PERIOD]);
    fireEvent.keyDown(radios()[0]!, { key: '3' });
    expect(screen.getByText('Question 2 of 2')).toBeTruthy();
    fireEvent.keyDown(textRow(), { key: '1' });
    expect(radios().every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    fireEvent.keyDown(radios()[0]!, { key: '9' });
    expect(radios().every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    fireEvent.keyDown(radios()[0]!, { key: '1' });
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(radios()[0]!, { key: 'Enter', ctrlKey: true });
    expect(onAnswer).toHaveBeenCalledWith('Region: West only\nWhich period?: This month');
  });

  it('Cmd+Enter goes to the next question once the current one is answered', () => {
    renderCard([REGION, PERIOD]);
    fireEvent.keyDown(radios()[0]!, { key: 'Enter', metaKey: true });
    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
    fireEvent.change(textRow(), { target: { value: 'Central' } });
    fireEvent.keyDown(textRow(), { key: 'Enter', metaKey: true });
    expect(screen.getByText('Question 2 of 2')).toBeTruthy();
  });

  it('ignores Enter while an input method is composing', () => {
    const { onAnswer } = renderCard([REGION]);
    fireEvent.change(textRow(), { target: { value: '华东' } });
    fireEvent.keyDown(textRow(), { key: 'Enter', isComposing: true });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('↑/↓ move focus through the options and the text row, wrapping', () => {
    renderCard([REGION]);
    const [a, b, c] = radios();
    a!.focus();
    fireEvent.keyDown(a!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(textRow());
    fireEvent.keyDown(textRow(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(textRow());
  });

  it('moving to the next question keeps keyboard focus inside the card', () => {
    renderCard([REGION, PERIOD]);
    const first = radios()[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: '1' });
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /This month/ }));
  });

  it('is one tab stop per radiogroup, on the checked option', () => {
    renderCard([REGION]);
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('labels the radiogroup with the progress and the question', () => {
    renderCard([REGION, PERIOD]);
    expect(screen.getByRole('radiogroup', { name: 'Question 1 of 2 Which region should the total cover?' })).toBeTruthy();
  });

  it('announces a waiting question only when the host asks', () => {
    const { view } = renderCard([REGION]);
    const live = () => view.container.querySelector('[aria-live="polite"]')!;
    expect(live().textContent).toBe('');
    view.rerender(<QuestionCard questions={[REGION]} onAnswer={() => {}} onSkip={() => {}} announce />);
    expect(live().textContent).toBe('A question is waiting for your answer');
  });
});

describe('QuestionCard — defaults map', () => {
  it('serves English byte-identical to the en pack', () => {
    const pack = (en as { chatbot: { questionCard: Record<string, string> } }).chatbot.questionCard;
    const fromPack = Object.fromEntries(Object.entries(pack).map(([k, v]) => [`chatbot.questionCard.${k}`, v]));
    expect(QUESTION_CARD_DEFAULT_TRANSLATIONS).toEqual(fromPack);
  });
});
