// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * F1 — the pillar Studio must follow the app's ACTIVE locale, not a hardcoded
 * one. Previously StudioDesignSurface pinned `const locale = 'zh-CN'`, so the
 * builder always rendered Chinese even when the console ran in English. The fix
 * threads the live `useObjectTranslation().language` through `useMetadataLocale`
 * and extracts every inline string into the `engine.studio.*` / `engine.appNav.*`
 * catalog.
 *
 * This pins two things so the regression can't come back:
 *   1. The new catalog keys resolve in BOTH locales (no raw-key fallback, and
 *      English ≠ Chinese) — a proxy for the whole StudioDesignSurface, whose
 *      pillars share the exact same `t()` + `useMetadataLocale` wiring.
 *   2. AppNavCanvas (which calls `useMetadataLocale()` the same way the pillars
 *      do) renders English under an English provider and Chinese under a Chinese
 *      one — i.e. the Studio surface follows the active i18n language.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { t } from './i18n';
import { AppNavCanvas } from './previews/AppNavCanvas';

afterEach(cleanup);

// Representative keys spanning shared chrome, every pillar, and AppNavCanvas.
// Each must exist in both locale tables and read differently per locale.
const SAMPLE_KEYS = [
  'engine.studio.publish',
  'engine.studio.saveDraft',
  'engine.studio.cancel',
  'engine.studio.pillar.data',
  'engine.studio.pillar.access',
  'engine.studio.app.create',
  'engine.studio.pkg.new',
  'engine.studio.data.newObject',
  'engine.studio.data.tab.records',
  'engine.studio.auto.heading',
  'engine.studio.access.title',
  'engine.appNav.heading',
  'engine.appNav.addItem',
  'engine.appNav.removeItem',
] as const;

describe('Studio locale catalog — F1', () => {
  it('every sampled key resolves in both locales (no raw-key fallback)', () => {
    for (const key of SAMPLE_KEYS) {
      const en = t(key, 'en-US');
      const zh = t(key, 'zh-CN');
      // `t()` returns the key itself when a table is missing the entry.
      expect(en, `EN missing ${key}`).not.toBe(key);
      expect(zh, `ZH missing ${key}`).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
      expect(zh.length).toBeGreaterThan(0);
    }
  });

  it('translations actually differ between English and Chinese', () => {
    // A few where EN and ZH are guaranteed distinct (pure-ASCII vs CJK).
    expect(t('engine.studio.publish', 'en-US')).toBe('Publish');
    expect(t('engine.studio.publish', 'zh-CN')).toBe('发布');
    expect(t('engine.appNav.addItem', 'en-US')).toBe('Add nav item');
    expect(t('engine.appNav.addItem', 'zh-CN')).toBe('添加导航项');
  });
});

function renderNav(language: 'en' | 'zh') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <AppNavCanvas
        draft={{ navigation: [] }}
        rootKey="navigation"
        onPatch={() => {}}
        selection={null}
        onSelectionChange={() => {}}
      />
    </I18nProvider>,
  );
}

describe('AppNavCanvas follows the active i18n locale — F1', () => {
  it('renders English strings under an English provider', () => {
    renderNav('en');
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add nav item/i })).toBeInTheDocument();
    // The Chinese counterpart must NOT be on screen.
    expect(screen.queryByText('添加导航项')).not.toBeInTheDocument();
  });

  it('renders Chinese strings under a Chinese provider', () => {
    renderNav('zh');
    expect(screen.getByText('导航')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /添加导航项/ })).toBeInTheDocument();
    // The English counterpart must NOT be on screen.
    expect(screen.queryByText('Add nav item')).not.toBeInTheDocument();
  });

  // The core of the bug report: switching the language at RUNTIME must re-render
  // the Studio surface. A shared i18next instance is switched via changeLanguage
  // (exactly what the LocaleSwitcher calls) and the DOM must flip in place — no
  // remount, no reload.
  it('flips in place when the active language is switched at runtime', async () => {
    const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    render(
      <I18nProvider instance={i18n}>
        <AppNavCanvas
          draft={{ navigation: [] }}
          rootKey="navigation"
          onPatch={() => {}}
          selection={null}
          onSelectionChange={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Navigation')).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage('zh');
    });

    await waitFor(() => expect(screen.getByText('导航')).toBeInTheDocument());
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /添加导航项/ })).toBeInTheDocument();
  });
});
