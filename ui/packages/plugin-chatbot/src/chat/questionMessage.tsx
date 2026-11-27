/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import type { AskQuestionEnvelopeParsed } from '@objectstack/spec/ai';
import { cn } from '@object-ui/components';
import { useQuestionCardTranslation } from '../useQuestionCardTranslation';

export interface QuestionMessageProps {
  envelope: AskQuestionEnvelopeParsed;
  /** The question waits for its answer: the card holds the options, so the message does not repeat them. */
  pending: boolean;
}

/**
 * An AI question as the conversation shows it, drawn from the question's
 * envelope rather than from its plain-text `reply` (whose bullets are model
 * history, never parsed back).
 *
 * Pending: the lead-in and the question only; the options are on the card in
 * the composer's place. Past (answered or skipped, which read the same): the
 * lead-in and a collapsed 「AI asks: QUESTION」 per question that expands to
 * its options.
 */
export function QuestionMessage({ envelope, pending }: QuestionMessageProps) {
  const { t } = useQuestionCardTranslation();
  const aiAsks = t('chatbot.questionCard.aiAsks');
  return (
    <div
      data-testid="question-message"
      data-state={pending ? 'pending' : 'past'}
      className="flex min-w-0 flex-col gap-2 text-sm"
    >
      {envelope.preface ? <p className="break-words">{envelope.preface}</p> : null}
      {envelope.questions.map((question, index) =>
        pending ? (
          <p key={index} className="break-words">
            <span className="text-muted-foreground">{aiAsks}</span>{' '}
            <span className="font-medium">{question.question}</span>
          </p>
        ) : (
          <details key={index} className="group min-w-0 rounded-lg border px-3 py-2">
            <summary
              className={cn(
                'flex cursor-pointer list-none items-start gap-1.5 break-words [&::-webkit-details-marker]:hidden',
                'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <ChevronRight
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90"
              />
              <span className="min-w-0">
                <span className="text-muted-foreground">{aiAsks}</span>{' '}
                <span className="font-medium">{question.question}</span>
              </span>
            </summary>
            <ul className="mt-2 flex flex-col gap-1 ps-6">
              {question.options.map((option, optionIndex) => (
                <li key={optionIndex} className="break-words">
                  <span>{option.label}</span>
                  {option.description ? (
                    <span className="block text-xs text-muted-foreground">{option.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ),
      )}
    </div>
  );
}
