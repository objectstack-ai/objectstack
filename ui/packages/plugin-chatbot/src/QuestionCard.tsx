/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The card the AI's clarifying question is answered on: the question in bold,
 * its options (each with an optional grey second line and a "recommended"
 * tag), a last "type something else" row, and Skip / Back / Next · Send.
 *
 * A pure component: questions in, `onAnswer(text)` / `onSkip()` out. It does
 * not detect the question, decide when it shows, or send anything itself; the
 * host does all three and passes the questions it parsed from the tool result.
 *
 * Invariants:
 * - One question: picking an option answers at once. More than one: picking on
 *   an earlier question moves to the next one; the last question never answers
 *   on its own, it waits on Send with a one-line summary of every answer.
 * - The answer text is one plain line for one question, and one
 *   `header: answer` line per question otherwise (the question text stands in
 *   for a missing header), so the AI reads which answer belongs to which ask.
 * - Choices live in this component's state and survive any re-render with new
 *   props, so a host that re-renders after a failed send keeps them. A new
 *   question is a new card: the host remounts it with a new `key`.
 * - Focus is never moved into the card from outside it. Keys act only while
 *   focus is inside: 1–4 pick, ↑/↓ move, Enter in the text row and
 *   Ctrl/⌘+Enter anywhere go to the next question or send.
 */
import * as React from 'react';
import {
  ASK_QUESTION_LIMITS,
  type AskQuestionOptionParsed,
  type AskQuestionParsed,
} from '@objectstack/spec/ai';
import { Badge, Button, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useQuestionCardTranslation } from './useQuestionCardTranslation';

/**
 * One option of a question: the envelope's option
 * (`AskQuestionOptionParsed`, `@objectstack/spec/ai`) — a label, an optional
 * grey second line, an optional "recommended" tag.
 */
export type QuestionCardOption = AskQuestionOptionParsed;

/**
 * One question: the envelope's question (`AskQuestionParsed`) — an optional
 * short header that labels its line in a multi-question answer, the question,
 * and its options, taken read-only.
 */
export type QuestionCardQuestion = Omit<AskQuestionParsed, 'options'> & {
  options: readonly QuestionCardOption[];
};

export interface QuestionCardProps {
  /** The questions to ask, in order. */
  questions: readonly QuestionCardQuestion[];
  /** Called with the composed answer text when the user answers. */
  onAnswer: (text: string) => void;
  /** Called when the user skips the question. */
  onSkip: () => void;
  /**
   * Puts the "a question is waiting" sentence into the card's polite live
   * region. The host turns it on when the card appears, so a screen reader
   * hears about a question that arrived while focus stayed in the composer.
   */
  announce?: boolean;
  className?: string;
}

/** An option index, the typed text row, or nothing chosen yet. */
type Choice = number | 'text' | null;

/** One digit key per option the envelope allows: `1` picks the first option. */
const DIGIT_KEYS: readonly string[] = Array.from(
  { length: ASK_QUESTION_LIMITS.maxOptions },
  (_, i) => String(i + 1),
);

export function QuestionCard({ questions, onAnswer, onSkip, announce = false, className }: QuestionCardProps) {
  const { t } = useQuestionCardTranslation();
  const { direction } = useObjectTranslation();
  const baseId = React.useId();
  const total = questions.length;

  const [page, setPage] = React.useState(0);
  const [choices, setChoices] = React.useState<Choice[]>(() => questions.map(() => null));
  const [texts, setTexts] = React.useState<string[]>(() => questions.map(() => ''));

  const groupRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const focusAfterPageChange = React.useRef(false);

  React.useEffect(() => {
    if (!focusAfterPageChange.current) return;
    focusAfterPageChange.current = false;
    groupRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, [page]);

  const current = questions[page];
  const choice = choices[page] ?? null;
  const isLast = page === total - 1;

  const answerOf = (index: number, cs: Choice[], ts: string[]): string | null => {
    const c = cs[index];
    if (typeof c === 'number') return questions[index]?.options[c]?.label ?? null;
    if (c === 'text') {
      const typed = (ts[index] ?? '').trim();
      return typed === '' ? null : typed;
    }
    return null;
  };

  const lineOf = (index: number, cs: Choice[], ts: string[]): string | null => {
    const answer = answerOf(index, cs, ts);
    if (answer === null) return null;
    const q = questions[index];
    return t('chatbot.questionCard.answerLine', { header: q?.header || q?.question || '', answer });
  };

  /** The answer text, or `null` while any question is unanswered. */
  const compose = (cs: Choice[], ts: string[]): string | null => {
    if (total === 1) return answerOf(0, cs, ts);
    const lines: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const line = lineOf(i, cs, ts);
      if (line === null) return null;
      lines.push(line);
    }
    return lines.join('\n');
  };

  const goTo = (next: number) => {
    focusAfterPageChange.current = true;
    setPage(next);
  };

  const advance = () => {
    if (answerOf(page, choices, texts) === null) return;
    if (!isLast) {
      goTo(page + 1);
      return;
    }
    const text = compose(choices, texts);
    if (text !== null) onAnswer(text);
  };

  const pick = (optionIndex: number) => {
    const nextChoices = choices.slice();
    nextChoices[page] = optionIndex;
    setChoices(nextChoices);
    if (total === 1) {
      const text = compose(nextChoices, texts);
      if (text !== null) onAnswer(text);
      return;
    }
    if (!isLast) goTo(page + 1);
  };

  const type = (value: string) => {
    const nextTexts = texts.slice();
    nextTexts[page] = value;
    setTexts(nextTexts);
    const nextChoices = choices.slice();
    nextChoices[page] = 'text';
    setChoices(nextChoices);
  };

  /** Option buttons of the current question, then the text row's input. */
  const focusables = (): HTMLElement[] => {
    const radios = Array.from(groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
    return inputRef.current ? [...radios, inputRef.current] : radios;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    const inText = e.target === inputRef.current;

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || inText)) {
      e.preventDefault();
      advance();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = focusables();
      const at = list.indexOf(e.target as HTMLElement);
      if (at === -1) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      list[(at + step + list.length) % list.length]?.focus();
      return;
    }
    if (!inText && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const digit = DIGIT_KEYS.indexOf(e.key);
      if (digit !== -1 && current && digit < current.options.length) {
        e.preventDefault();
        pick(digit);
      }
    }
  };

  if (!current) return null;

  const tabStop = typeof choice === 'number' ? choice : 0;
  const progressId = `${baseId}-progress`;
  const questionId = `${baseId}-question`;
  const summary = isLast && total > 1 ? compose(choices, texts) : null;
  const canAdvance = answerOf(page, choices, texts) !== null;

  return (
    <div
      dir={direction}
      data-testid="question-card"
      onKeyDown={onKeyDown}
      className={cn(
        'flex max-h-[60vh] w-full flex-col overflow-hidden rounded-xl border bg-background text-start shadow-sm',
        className,
      )}
    >
      <div aria-live="polite" className="sr-only">
        {announce ? t('chatbot.questionCard.pending') : ''}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t('chatbot.questionCard.aiAsks')}</span>
          {total > 1 && (
            <span id={progressId}>
              {t('chatbot.questionCard.progress', { current: page + 1, total })}
            </span>
          )}
        </div>
        <p id={questionId} className="mb-3 text-sm font-semibold">
          {current.question}
        </p>

        <div
          ref={groupRef}
          role="radiogroup"
          aria-labelledby={total > 1 ? `${progressId} ${questionId}` : questionId}
          className="flex flex-col gap-2"
        >
          {current.options.map((option, i) => {
            const checked = choice === i;
            return (
              <button
                key={`${page}-${i}`}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={i === tabStop ? 0 : -1}
                onClick={() => pick(i)}
                className={cn(
                  'flex min-h-11 w-full items-start gap-3 rounded-lg border px-3 py-2 text-start text-sm transition-colors',
                  'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  checked && 'border-primary bg-primary/5',
                )}
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-xs text-muted-foreground"
                >
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words font-medium">{option.label}</span>
                    {option.recommended && (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        {t('chatbot.questionCard.recommended')}
                      </Badge>
                    )}
                  </span>
                  {option.description && (
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <label
          className={cn(
            'mt-2 flex min-h-11 cursor-text items-center gap-3 rounded-lg border px-3 py-2 text-sm',
            choice === 'text' && 'border-primary bg-primary/5',
          )}
        >
          <span aria-hidden="true" className="size-5 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={texts[page] ?? ''}
            onChange={(e) => type(e.target.value)}
            aria-label={t('chatbot.questionCard.typeYourOwn')}
            placeholder={t('chatbot.questionCard.typeYourOwn')}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      {summary !== null && (
        <p data-testid="question-card-summary" className="shrink-0 truncate border-t px-3 pt-2 text-xs text-muted-foreground">
          {summary.split('\n').join(' · ')}
        </p>
      )}

      <div className="flex shrink-0 items-center gap-2 p-2">
        <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
          {t('chatbot.questionCard.skip')}
        </Button>
        <span className="flex-1" />
        {page > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => goTo(page - 1)}>
            {t('chatbot.questionCard.back')}
          </Button>
        )}
        <Button type="button" size="sm" disabled={!canAdvance} onClick={advance}>
          {isLast ? t('chatbot.questionCard.send') : t('chatbot.questionCard.next')}
        </Button>
      </div>
    </div>
  );
}
