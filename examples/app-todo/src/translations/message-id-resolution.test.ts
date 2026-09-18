// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { FileI18nAdapter } from '@objectstack/service-i18n';
import type { TranslationData } from '@objectstack/spec/system';
import { en } from './en';
import { zhCN } from './zh-CN';
import { jaJP } from './ja-JP';

/**
 * Message-id reachability (#18566).
 *
 * This app's `messages` ids were authored dot-separated (`'common.save'`), and
 * that spelling is unreachable rather than merely unconventional: `t()` resolves
 * a key by `key.split('.')` and walking segment by segment — the same code in
 * both shipped implementations — while `messages` is a FLAT
 * `Record<string, string>`. `t('messages.common.save', locale)` therefore looks
 * for a nested `common` object, finds none, and returns the key string.
 *
 * A reference example is what an author copies, so the repair is not asserted
 * here, it is demonstrated: the real bundle is loaded into BOTH real providers
 * and every id is resolved through the public `t()` contract. The last suite is
 * the control — it drives the OLD spelling through the same call and pins that
 * it returns the key itself, so a green run above cannot be a green run of an
 * assertion that could not fail.
 */

const BUNDLES: [string, TranslationData][] = [
  ['en', en],
  ['zh-CN', zhCN],
  ['ja-JP', jaJP],
];

/** Minimal read surface — both providers implement `II18nService`. */
interface Provider {
  t(key: string, locale: string, params?: Record<string, unknown>): string;
  loadTranslations(locale: string, data: Record<string, unknown>): void;
}

/**
 * Both shipped `II18nService` implementations, each loaded with this app's real
 * bundle. Constructed per call so no suite can observe another's writes.
 */
function providers(): [string, Provider][] {
  const built: [string, Provider][] = [
    ['memory-i18n (core fallback)', createMemoryI18n() as unknown as Provider],
    ['FileI18nAdapter (service-i18n)', new FileI18nAdapter({ defaultLocale: 'en' }) as unknown as Provider],
  ];
  for (const [, provider] of built) {
    for (const [locale, data] of BUNDLES) {
      provider.loadTranslations(locale, data as unknown as Record<string, unknown>);
    }
  }
  return built;
}

/** Every authored id of a locale, paired with the string it must resolve to. */
function idsOf(data: TranslationData): [string, string][] {
  return Object.entries(data.messages ?? {});
}

describe.each(BUNDLES)('%s — authored `messages` ids', (locale, data) => {
  const ids = idsOf(data);

  it('authors at least one message id', () => {
    // Guards the whole file against the zero-population reading: every
    // `it.each` below would pass vacuously on an empty `messages` block.
    expect(ids.length).toBeGreaterThan(0);
  });

  it.each(ids.map(([id]) => id))('`%s` is single-segment', (id) => {
    expect(
      id.includes('.'),
      `[${locale}] message id "${id}" contains a dot, so t('messages.${id}', '${locale}') walks into a nested object that does not exist and returns the key`,
    ).toBe(false);
  });
});

describe.each(providers())('%s', (_providerName, provider) => {
  describe.each(BUNDLES)('%s', (locale, data) => {
    it.each(idsOf(data))('t("messages.%s") resolves', (id, expected) => {
      expect(provider.t(`messages.${id}`, locale)).toBe(expected);
    });
  });

  it('resolves a nested group key too (positive control on the walk itself)', () => {
    expect(provider.t('objects.todo_task.label', 'en')).toBe('Task');
    expect(provider.t('objects.todo_task.label', 'zh-CN')).toBe('任务');
  });

  it.each([
    'messages.common.save',
    'messages.success.saved',
    'messages.error.load_failed',
  ])('the retired dotted spelling `%s` still resolves to nothing', (key) => {
    // The control. `t()` returns the key string when the walk finds no leaf, so
    // this is the exact symptom the dotted ids shipped with — and it is why the
    // suite above is capable of going red if anyone re-introduces one.
    expect(provider.t(key, 'en')).toBe(key);
  });
});
