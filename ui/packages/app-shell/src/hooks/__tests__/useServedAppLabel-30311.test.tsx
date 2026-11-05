// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30311 — an app the server served is named as served.
 *
 * Since objectstack#30353 `/meta/app` serves an overridden app (a `.custom`
 * pair) under the ruled label order: the override's own text over the base
 * package's translation. Every console surface that names an app handed that
 * served label to `useObjectLabel().appLabel` as its FALLBACK, and the bundle's
 * `apps.<name>.label` — the base package's string — won it back. Now the served
 * label is drawn as given, and the bundle is asked only for text no server
 * translated.
 *
 * Subject: the real `useServedAppLabel` over the real `useObjectLabel`, inside a
 * real `I18nProvider` holding the packaged catalogue, as the console loads it.
 *
 * Directions, written before the run: the renamed cells RED before the change
 * (the bundle's packaged string in both languages), GREEN after; the unedited,
 * draft, keyed, unlabelled and description-only cells GREEN on both sides.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { useServedAppLabel } from '../useServedAppLabel';

/** The packaged catalogue: the base package translates its app. */
const BUNDLE = {
  en: { crm: { apps: { crm: { label: 'CRM', description: 'Sell more' } } } },
  'zh-CN': { crm: { apps: { crm: { label: '客户管理', description: '多卖一点' } } } },
};
const PACKAGED = { en: 'CRM', 'zh-CN': '客户管理' } as const;
const PACKAGED_DESCRIPTION = { en: 'Sell more', 'zh-CN': '多卖一点' } as const;
const RENAMED = 'Pipeline Desk (renamed-30311)';
const LANGUAGES = ['en', 'zh-CN'] as const;

function labelsIn(language: 'en' | 'zh-CN') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: BUNDLE }} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
  return renderHook(() => useServedAppLabel(), { wrapper }).result.current;
}

describe('useServedAppLabel — a served app label is drawn as served (objectstack#30311)', () => {
  it.each(LANGUAGES)('%s: an overridden app shows the label the server served, not the base package\'s', (language) => {
    const { appLabel } = labelsIn(language);
    expect(appLabel({ name: 'crm', label: RENAMED })).toBe(RENAMED);
  });

  it.each(LANGUAGES)('%s: an unedited app shows the translation the server put in', (language) => {
    const { appLabel } = labelsIn(language);
    expect(appLabel({ name: 'crm', label: PACKAGED[language] })).toBe(PACKAGED[language]);
  });

  it('zh-CN: an inline locale map is resolved in the active language', () => {
    const { appLabel } = labelsIn('zh-CN');
    expect(appLabel({ name: 'crm', label: { en: 'Pipeline Desk', 'zh-CN': '管道台' } })).toBe('管道台');
  });

  it.each(LANGUAGES)('%s: control — a pending draft under ?preview=draft is named by the bundle', (language) => {
    const { appLabel } = labelsIn(language);
    expect(appLabel({ name: 'crm', label: RENAMED, _draft: true })).toBe(PACKAGED[language]);
  });

  it.each(LANGUAGES)('%s: control — a keyed label is not served text and keeps the bundle', (language) => {
    const { appLabel } = labelsIn(language);
    const keyed = { key: 'crm.unknown_key', defaultValue: 'Fallback' };
    expect(appLabel({ name: 'crm', label: keyed })).toBe(PACKAGED[language]);
    // With no bundle entry for the app, the key's defaultValue names it, as before.
    expect(appLabel({ name: 'other', label: keyed })).toBe('Fallback');
  });

  it.each(LANGUAGES)('%s: control — an app with no label is named by the bundle, else its machine name', (language) => {
    const { appLabel } = labelsIn(language);
    expect(appLabel({ name: 'crm' })).toBe(PACKAGED[language]);
    expect(appLabel({ name: 'other' })).toBe('other');
    expect(appLabel({ name: 'crm', label: '' })).toBe(PACKAGED[language]);
  });
});

describe('useServedAppLabel — a served app description is drawn as served (objectstack#30311)', () => {
  it.each(LANGUAGES)('%s: an overridden description shows as served', (language) => {
    const { appDescription } = labelsIn(language);
    expect(appDescription({ name: 'crm', description: 'Deals, fast (renamed-30311)' })).toBe('Deals, fast (renamed-30311)');
  });

  it.each(LANGUAGES)('%s: control — a translation-only description still comes from the bundle', (language) => {
    const { appDescription } = labelsIn(language);
    expect(appDescription({ name: 'crm' })).toBe(PACKAGED_DESCRIPTION[language]);
    expect(appDescription({ name: 'crm', description: 'Draft text', _draft: true })).toBe(PACKAGED_DESCRIPTION[language]);
    expect(appDescription({ name: 'other' })).toBeUndefined();
  });
});

/**
 * The census that keeps the class closed: no app-shell source names an app
 * through the bundle's `appLabel` / `appDescription` directly — every surface
 * goes through `useServedAppLabel`, which asks the bundle only for text no
 * server translated. Read by name, not by intent: a surface that reaches the
 * bundle another way is left to review.
 */
describe('useServedAppLabel — no app-shell surface names an app through the bundle directly (objectstack#30311)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const SRC = resolve(HERE, '../..');
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  const BUNDLE_APP_READ = /\{[^}]*\bapp(?:Label|Description)\b[^}]*\}\s*=\s*useObjectLabel\(\)/;

  it('reads every source file under app-shell/src', () => {
    // Positive control: the walk reaches the hook itself and a known caller.
    const files = sources(SRC).map((p) => relative(SRC, p));
    expect(files).toContain(join('hooks', 'useServedAppLabel.ts'));
    expect(files).toContain(join('layout', 'AppSwitcher.tsx'));
  });

  it('none destructures appLabel or appDescription from useObjectLabel()', () => {
    // The hook itself is the one reader of the bundle's app lookups.
    const offenders = sources(SRC)
      .map((p) => relative(SRC, p))
      .filter((p) => p !== join('hooks', 'useServedAppLabel.ts'))
      .filter((p) => BUNDLE_APP_READ.test(readFileSync(join(SRC, p), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('control — the pattern matches the shape it bans', () => {
    expect(BUNDLE_APP_READ.test('const { appLabel } = useObjectLabel();')).toBe(true);
    expect(BUNDLE_APP_READ.test('const { objectLabel, appDescription } = useObjectLabel();')).toBe(true);
    expect(BUNDLE_APP_READ.test('const { objectLabel } = useObjectLabel();')).toBe(false);
    // The hook's own read is the shape too, which is why it alone is exempt.
    const hook = readFileSync(join(SRC, 'hooks', 'useServedAppLabel.ts'), 'utf8');
    expect(BUNDLE_APP_READ.test(hook)).toBe(true);
  });
});
