/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSafeTranslation } from '@object-ui/i18n';

/**
 * Locale wiring for the three AI components — objectui#10232.
 *
 * The package used to have no `@object-ui/i18n` dependency at all: every string
 * was hard-coded English and the `nl-query` history date was formatted in the
 * MACHINE's locale. Wiring it as a whole — strings and display locale together —
 * also puts the package inside the repo-wide machine-locale census
 * (`packages/i18n/src/__tests__/machineLocaleCensus-9909.test.ts`), whose
 * population is every package whose manifest names `@object-ui/i18n`.
 *
 * A module of its own, the shape `plugin-chatbot`'s `useAiApprovalsTranslation.ts`
 * uses: the defaults map has to be importable by the test that compares it
 * against the `en` pack, and exporting a non-component from a component file
 * trips `react-refresh/only-export-components`. It is not exported from the
 * package barrel, so it stays off the published API surface.
 *
 * English fallbacks for every key the components read. `createSafeTranslation`
 * serves these when no `I18nProvider` is mounted, so a provider-less render
 * shows English rather than raw keys. Every row is byte-identical to its `en`
 * pack value — `aiComponents.i18n-10232.test.tsx` holds it there.
 *
 * The count rows are i18next count families (objectui#11445): the components
 * pass `count`, and the provider-less path reads the `_one` / `_other` row for
 * a numeric count, in the order i18next reads the `en` pack.
 */
export const AI_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'ai.nlQuery.placeholder': 'Ask a question about your data…',
  'ai.nlQuery.ask': 'Ask',
  'ai.nlQuery.results': 'Results',
  'ai.nlQuery.match': '{{percent}} match',
  'ai.nlQuery.simulatedSummary': 'Results for: {{query}}',
  'ai.nlQuery.noResults': 'No matching records found',
  'ai.nlQuery.recentQueries': 'Recent Queries',
  'ai.formAssist.title': 'AI Suggestions',
  'ai.formAssist.suggestionCount': '{{count}} suggestions',
  'ai.formAssist.suggestionCount_one': '{{count}} suggestion',
  'ai.formAssist.suggestionCount_other': '{{count}} suggestions',
  'ai.formAssist.applyAll': 'Apply All',
  'ai.formAssist.confidence': '{{percent}} confidence',
  'ai.formAssist.appliedCount': '{{count}} suggestions applied',
  'ai.formAssist.appliedCount_one': '{{count}} suggestion applied',
  'ai.formAssist.appliedCount_other': '{{count}} suggestions applied',
  'ai.recommendations.title': 'Recommendations',
  'ai.recommendations.generating': 'Generating recommendations…',
  'ai.recommendations.empty': 'No recommendations available',
};

/**
 * Safe wrapper for `useObjectTranslation` that falls back to the map above when
 * no `I18nProvider` is mounted — the factory form, because the components
 * interpolate `{{count}}`, `{{percent}}` and `{{query}}`.
 */
export const useAiTranslation = createSafeTranslation(AI_DEFAULT_TRANSLATIONS, 'ai.nlQuery.ask');

/**
 * A 0–1 score as a whole percentage in the DISPLAY locale (`useDisplayLocale()`),
 * so `de` reads `85 %` rather than `85%` — the number face the
 * `{{percent}}` holes above receive, already formatted.
 */
export function formatPercent(score: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(score);
}
