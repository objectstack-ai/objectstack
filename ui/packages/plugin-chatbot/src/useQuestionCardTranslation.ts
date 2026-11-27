/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSafeTranslation } from '@object-ui/i18n';

/**
 * Locale wiring for `QuestionCard`.
 *
 * A module of its own so the defaults map is importable by the test that
 * compares it against the `en` pack, and so the component file exports only
 * components (`react-refresh/only-export-components`).
 *
 * `createSafeTranslation` serves these rows when no `I18nProvider` is mounted,
 * so a provider-less render shows English rather than raw keys. Every row is
 * byte-identical to its `en` pack value; `__tests__/QuestionCard.test.tsx`
 * holds the two equal row by row.
 *
 * Exported from this MODULE, not from the package barrel, so it stays off the
 * published API surface.
 */
export const QUESTION_CARD_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'chatbot.questionCard.aiAsks': 'AI asks:',
  'chatbot.questionCard.progress': 'Question {{current}} of {{total}}',
  'chatbot.questionCard.typeYourOwn': 'Type something else…',
  'chatbot.questionCard.recommended': 'Recommended',
  'chatbot.questionCard.skip': 'Skip',
  'chatbot.questionCard.back': 'Back',
  'chatbot.questionCard.next': 'Next',
  'chatbot.questionCard.send': 'Send',
  'chatbot.questionCard.pending': 'A question is waiting for your answer',
  'chatbot.questionCard.answerLine': '{{header}}: {{answer}}',
};

/**
 * Safe wrapper for `useObjectTranslation` that falls back to the map above when
 * no `I18nProvider` is mounted. The factory form, because the card interpolates
 * `{{current}}`, `{{total}}`, `{{header}}` and `{{answer}}`.
 */
export const useQuestionCardTranslation = createSafeTranslation(
  QUESTION_CARD_DEFAULT_TRANSLATIONS,
  'chatbot.questionCard.skip',
);
