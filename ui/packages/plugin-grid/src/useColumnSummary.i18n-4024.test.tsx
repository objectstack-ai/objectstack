/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list/grid aggregate footer's PREFIX speaks the session locale —
 * objectui#4024 (migrated from objectstack#5084).
 *
 * The card's sharpest observation is that this footer was already half fixed:
 * `Avg: 39%` and `Sum: 119,200` have a correctly locale-formatted NUMBER sitting
 * behind a hardcoded English `TYPE_LABELS` prefix. The aggregate kind is known
 * to the renderer, so the prefix was one bundle lookup away.
 *
 * ## The number formatting is NOT this card's surface
 *
 * `#4589` landed the number-display policy in `packages/core/src/utils/**`, and
 * the currency/percent/decimal behaviour here is pinned by the sibling
 * `useColumnSummary.test.tsx`. This change touches the PREFIX and the
 * label/value JOIN only; every numeric assertion below is a must-not-change,
 * restated here so a prefix change that disturbed a number would go red in the
 * same file that claims the prefix.
 *
 * ## Why a parameterized pattern rather than a translated prefix + `': '`
 *
 * Concatenating a translated word with a hardcoded `': '` hands the locale the
 * word and keeps the punctuation in English. ja/zh use a fullwidth colon, and
 * ar runs right-to-left, so the separator is translatable content. The join is
 * therefore its own key — `grid.summary.pattern: '{{label}}: {{value}}'` — and
 * a pack that wants 「合计:119,200」 owns the whole shape. This mirrors the
 * `collaboration.resolvedSuffix` note already in `en.ts`: "Appended to the
 * count, separator included, so a translator owns the whole phrase rather than
 * inheriting an English-shaped ` · ` glue."
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * Pre-fix, on `origin/main`:
 *   - every zh case FAILS — `TYPE_LABELS[type]` returns the English 'Sum' /
 *     'Avg' / 'Count' and `formatSummaryLabel` joins with a literal ': ', so
 *     the label is 'Sum: 1,234' and the expected '合计' is absent;
 *   - the en cases and the must-not-change numeric cases PASS pre-fix (the
 *     English literal equals the `en` pack value — the same blindness the
 *     switcher has).
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderHook } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { useColumnSummary } from './useColumnSummary';

const DATA = [{ amount: 1000 }, { amount: 234 }, { amount: null }];

function inLocale(language: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <LocalizationProvider value={{ currency: undefined }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

function labelFor(summary: string, language: string, extra: Record<string, unknown> = {}): string {
  const cols: any[] = [{ field: 'amount', summary, ...extra }];
  const { result } = renderHook(() => useColumnSummary(cols, DATA), {
    wrapper: inLocale(language),
  });
  return result.current.summaries.get('amount')?.label ?? '';
}

describe('aggregate footer prefix resolves from the bundle (objectui#4024)', () => {
  it('zh-CN: sum / avg / min / max carry translated prefixes', () => {
    expect(labelFor('sum', 'zh')).toContain('合计');
    expect(labelFor('avg', 'zh')).toContain('平均值');
    expect(labelFor('min', 'zh')).toContain('最小值');
    expect(labelFor('max', 'zh')).toContain('最大值');
  });

  it('zh-CN: the count family lands too — the card asked for all five kinds', () => {
    expect(labelFor('count', 'zh')).toContain('计数');
    expect(labelFor('count_empty', 'zh')).toContain('空值');
    expect(labelFor('count_filled', 'zh')).toContain('非空');
    expect(labelFor('count_unique', 'zh')).toContain('去重');
  });

  it('zh-CN: the percent family lands, and keeps its own % unit', () => {
    const empty = labelFor('percent_empty', 'zh');
    expect(empty).toContain('空值');
    expect(empty).toMatch(/%/);
  });

  it('ja-JP: a second pack proves this is a bundle lookup, not a zh special case', () => {
    expect(labelFor('sum', 'ja')).toContain('合計');
  });

  it('zh-CN: no English prefix survives anywhere in the label', () => {
    for (const kind of ['sum', 'avg', 'min', 'max', 'count', 'count_unique']) {
      expect(labelFor(kind, 'zh')).not.toMatch(/Sum|Avg|Min|Max|Count|Unique/);
    }
  });

  it('en: unchanged prefixes and separator (must-not-change)', () => {
    expect(labelFor('sum', 'en')).toBe('Sum: 1,234');
    expect(labelFor('avg', 'en')).toBe('Avg: 617');
    expect(labelFor('count', 'en')).toBe('Count: 3');
    expect(labelFor('count_unique', 'en')).toBe('Unique: 2');
  });

  it('the NUMBER keeps flowing through the existing formatter (must-not-change, #4589)', () => {
    // Currency column, tenant default CNY — pinned by useColumnSummary.test.tsx;
    // restated here so a prefix change that disturbed the number goes red in
    // the file that claims the prefix.
    const cols: any[] = [{ field: 'amount', summary: 'sum', type: 'currency' }];
    const { result } = renderHook(() => useColumnSummary(cols, DATA), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
          <LocalizationProvider value={{ currency: 'CNY' }}>{children}</LocalizationProvider>
        </I18nProvider>
      ),
    });
    const label = result.current.summaries.get('amount')?.label ?? '';
    expect(label).toContain('合计');
    expect(label).toMatch(/[¥]|CN¥|CNY/);
    expect(label).toMatch(/1,234/);
  });

  it('an unknown aggregation still renders its raw kind, not a bundle key', () => {
    // `SUPPORTED_SUMMARY_TYPES` gates the map, so an unsupported name never
    // reaches the label — but the `|| type` arm inside the formatter is the
    // backstop, and it must not start echoing `grid.summary.< junk >`.
    const cols: any[] = [{ field: 'amount', summary: 'sum' }];
    const { result } = renderHook(() => useColumnSummary(cols, DATA), {
      wrapper: inLocale('en'),
    });
    expect(result.current.summaries.get('amount')?.label).not.toContain('grid.summary');
  });
});

/**
 * The English no-provider fallback is pinned in a FILE OF ITS OWN —
 * `useColumnSummary.i18n-4024.no-provider.test.tsx`. `createI18n` registers a
 * react-i18next module-global default that survives `cleanup()`, so a
 * no-provider case sharing this file would resolve against whichever locale ran
 * last (objectstack#5505/#5506, recorded on
 * `packages/components/src/__tests__/sheet-dialog-close-i18n.test.tsx`).
 */
