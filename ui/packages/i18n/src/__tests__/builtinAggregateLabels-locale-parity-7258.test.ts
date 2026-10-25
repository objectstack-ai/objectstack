/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7258 — the bundle-reading half of the built-in aggregate label seam.
 *
 * `all-locales-key-parity` already enforces en ↔ pack key parity generically,
 * so this file is deliberately narrow (the `gantt-quickfilter-locale-parity`
 * shape). It pins the three things that guard cannot express on its own:
 *
 *  1. Every pack carries a non-empty `report.aggregate.*` label for EVERY
 *     member of core's closed `BUILTIN_AGGREGATES` vocabulary. Parity is
 *     symmetric — deleting the block from all ten packs keeps that suite green
 *     while every built-in measure silently reverts to the server's English.
 *  2. `builtinAggregateLabels(tt)` maps the wire spelling to the bundle key
 *     (`count_distinct` → `countDistinct`) for each member and for nothing
 *     else — a member added to core without a line in the seam is a compile
 *     error, and this is its runtime twin.
 *  3. The English fallbacks the seam carries are byte-equal to the `en` pack,
 *     so a provider-less host renders what an `en` session renders.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_AGGREGATES, type BuiltinAggregate } from '@object-ui/core';
import { builtInLocales } from '../locales';
import { builtinAggregateLabels } from '../builtinAggregateLabels';

// Derived from the map rather than left as `string[]` — the same convention as
// `gantt-quickfilter-locale-parity.test.ts` next door (TS7053 otherwise).
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

/** Wire spelling → `report.aggregate.*` leaf. The ONLY mapping the seam does. */
const BUNDLE_KEY: Record<BuiltinAggregate, string> = {
  count: 'count',
  count_distinct: 'countDistinct',
  sum: 'sum',
  avg: 'avg',
  min: 'min',
  max: 'max',
};

/** The pack's `report.aggregate` block, reached through the one shape this file reads. */
const aggregateOf = (lang: LocaleCode) =>
  (builtInLocales[lang] as { report?: { aggregate?: Record<string, string> } }).report?.aggregate;

/**
 * A `useSafeTranslate()` stand-in bound to one pack: a real, non-empty pack
 * value wins, anything else falls back — the hook's own contract.
 */
const ttFrom = (lang: LocaleCode) => (key: string, fallback: string): string => {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], builtInLocales[lang]);
  return typeof value === 'string' && value !== '' ? value : fallback;
};

describe('report.aggregate.* covers the built-in aggregate vocabulary in every pack (objectui#7258)', () => {
  it('covers all ten built-in packs', () => {
    expect(LANGS).toHaveLength(10);
  });

  it.each(LANGS)('%s defines a non-empty label for every built-in aggregate', (lang) => {
    const block = aggregateOf(lang);
    expect(block, `${lang} has no report.aggregate block`).toBeTruthy();
    for (const aggregate of BUILTIN_AGGREGATES) {
      const leaf = BUNDLE_KEY[aggregate];
      expect(typeof block![leaf], `${lang}.report.aggregate.${leaf}`).toBe('string');
      expect(block![leaf].trim().length, `${lang}.report.aggregate.${leaf} is empty`).toBeGreaterThan(0);
    }
  });
});

describe('builtinAggregateLabels — the seam between the wire spelling and the bundle', () => {
  it('maps every member of the closed vocabulary, and nothing else', () => {
    const labels = builtinAggregateLabels(ttFrom('en'));
    expect(Object.keys(labels).sort()).toEqual([...BUILTIN_AGGREGATES].sort());
  });

  it.each(LANGS)('%s: each label IS that pack`s report.aggregate value', (lang) => {
    const labels = builtinAggregateLabels(ttFrom(lang));
    for (const aggregate of BUILTIN_AGGREGATES) {
      expect(labels[aggregate], `${lang}:${aggregate}`).toBe(aggregateOf(lang)![BUNDLE_KEY[aggregate]]);
    }
  });

  it('zh: the card`s own strings — a built-in count reads 计数', () => {
    expect(builtinAggregateLabels(ttFrom('zh'))).toEqual({
      count: '计数',
      count_distinct: '去重计数',
      sum: '求和',
      avg: '平均',
      min: '最小值',
      max: '最大值',
    });
  });

  it('en: reads the en pack', () => {
    expect(builtinAggregateLabels(ttFrom('en'))).toEqual({
      count: 'Count',
      count_distinct: 'Distinct Count',
      sum: 'Sum',
      avg: 'Average',
      min: 'Min',
      max: 'Max',
    });
  });

  it('provider-less: the inline English fallbacks are byte-equal to the en pack', () => {
    // A `tt` that misses every key is what a host with no I18nProvider gets;
    // its output must not drift from what an `en` session renders.
    const missEverything = (_key: string, fallback: string) => fallback;
    expect(builtinAggregateLabels(missEverything)).toEqual(builtinAggregateLabels(ttFrom('en')));
  });
});
