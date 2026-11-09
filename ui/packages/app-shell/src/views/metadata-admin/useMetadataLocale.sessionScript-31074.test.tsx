// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31074 — Studio's designer locale follows the session's Chinese script.
 *
 * `useMetadataLocale()` collapsed every `zh*` language to `'zh-CN'`, so a
 * Traditional Chinese session designed in Simplified: the nav designer listed
 * `{ en, zh: '简体项目', 'zh-TW': '繁體專案' }` as 简体项目 while the sidebar of
 * the same session showed 繁體專案, and a rename there overwrote the Simplified
 * `zh` text. The hook now resolves the session language through the console's
 * own resolution (`resolveBuiltInLanguage`), so a session the console serves
 * in `zh-Hant` designs as `'zh-Hant'`.
 *
 * Pinned through the real hook under a real `I18nProvider`, and through the
 * two things a designer does with its answer: read the label, rename it.
 * Chrome is the other half: the studio namespace ships one Chinese catalogue,
 * so a Traditional designer reads Simplified chrome, never English.
 */

import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { I18nLabel } from '@objectstack/spec/ui';

import { isZhLocale, t, useMetadataLocale } from './i18n';
import { navItemLabelText, renamedLabel } from './previews/navItemLabel';

afterEach(cleanup);

const MAP: I18nLabel = { en: 'Proj EN', zh: '简体项目', 'zh-TW': '繁體專案' };

function Probe() {
  const locale = useMetadataLocale();
  return (
    <output data-testid="probe" data-locale={locale}>
      {navItemLabelText(MAP, locale)}
    </output>
  );
}

function designerLocaleIn(lang: string): string {
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <Probe />
    </I18nProvider>,
  );
  return screen.getByTestId('probe').getAttribute('data-locale') ?? '';
}

describe('useMetadataLocale follows the session script (#31074)', () => {
  it.each(['zh-Hant', 'zh-TW', 'zh-HK'])('a %s session designs as zh-Hant and reads the Traditional entry', (lang) => {
    expect(designerLocaleIn(lang)).toBe('zh-Hant');
    expect(screen.getByTestId('probe').textContent).toBe('繁體專案');
  });

  it('a rename in that designer locale replaces zh-TW and leaves zh untouched', () => {
    const locale = designerLocaleIn('zh-Hant');
    expect(renamedLabel(MAP, '改名後', locale)).toEqual({ en: 'Proj EN', zh: '简体项目', 'zh-TW': '改名後' });
  });

  it('a rename in that designer locale over a Simplified-only map adds zh-Hant', () => {
    const locale = designerLocaleIn('zh-Hant');
    expect(renamedLabel({ en: 'Proj EN', zh: '简体项目' }, '改名後', locale)).toEqual({
      en: 'Proj EN',
      zh: '简体项目',
      'zh-Hant': '改名後',
    });
  });

  it.each(['zh-Hans', 'zh-CN', 'zh'])('CONTROL: a %s session designs as zh-CN and reads the Simplified entry', (lang) => {
    expect(designerLocaleIn(lang)).toBe('zh-CN');
    expect(screen.getByTestId('probe').textContent).toBe('简体项目');
  });

  it.each(['en', 'de', 'ja'])('CONTROL: a %s session designs as en-US', (lang) => {
    expect(designerLocaleIn(lang)).toBe('en-US');
  });

  it('a zh-Hant designer reads Chinese chrome (the Simplified catalogue), never English', () => {
    expect(isZhLocale('zh-Hant')).toBe(true);
    expect(t('engine.studio.cancel', 'zh-Hant')).toBe(t('engine.studio.cancel', 'zh-CN'));
  });
});
