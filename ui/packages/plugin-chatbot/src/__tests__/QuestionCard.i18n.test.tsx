/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `QuestionCard` speaks the session locale and lays out right-to-left in
 * Arabic.
 *
 * The zh-Hans and ar legs are the ones that discriminate a pack lookup from a
 * hard-coded string: the `en` values are byte-identical to the defaults map,
 * so an English render is green either way. Every pack defining every key is
 * `all-locales-key-parity.test.ts`'s job, not this file's.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { QuestionCard, type QuestionCardQuestion } from '../QuestionCard';

afterEach(cleanup);

const QUESTIONS: QuestionCardQuestion[] = [
  { header: '区域', question: '统计哪个区域？', options: [{ label: '全部', recommended: true }, { label: '华东' }] },
  { question: '哪个时间段？', options: [{ label: '本月' }, { label: '本季度' }] },
];

function renderIn(language: string, onAnswer: (text: string) => void = () => {}) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <QuestionCard questions={QUESTIONS} onAnswer={onAnswer} onSkip={() => {}} announce />
    </I18nProvider>,
  );
}

describe('QuestionCard in the session locale', () => {
  it('zh-Hans: every string on the card, and the full-width colon in the answer', async () => {
    const onAnswer = vi.fn<(text: string) => void>();
    renderIn('zh-Hans', onAnswer);
    await waitFor(() => expect(screen.getByText('第 1/2 题')).toBeTruthy());
    expect(screen.getByText('AI 问：')).toBeTruthy();
    expect(screen.getByText('推荐')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '自己输入…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '跳过' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一题' })).toBeTruthy();
    expect(screen.getByText('有一个问题待回答')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /华东/ }));
    expect(screen.getByText('第 2/2 题')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一题' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /本季度/ }));
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onAnswer).toHaveBeenCalledWith('区域：华东\n哪个时间段？：本季度');
  });

  it('ar: the card is right-to-left and translated', async () => {
    const { container } = renderIn('ar');
    await waitFor(() => expect(screen.getByText('السؤال 1 من 2')).toBeTruthy());
    expect(container.querySelector('[data-testid="question-card"]')!.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('button', { name: 'تخطٍّ' })).toBeTruthy();
  });

  it('en: left-to-right', async () => {
    const { container } = renderIn('en');
    await waitFor(() => expect(screen.getByText('Question 1 of 2')).toBeTruthy());
    expect(container.querySelector('[data-testid="question-card"]')!.getAttribute('dir')).toBe('ltr');
  });
});
