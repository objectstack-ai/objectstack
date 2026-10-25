/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useSettingsLabel`'s banner helpers read the platform's
 * `settings.NAMESPACE.banners.BANNER_ID.{title,text}` slot (objectui#12671).
 *
 * The slot is declared by objectstack#23886 and read on the platform by
 * `resolveSettingsBannerTitle` / `resolveSettingsBannerText`: the title
 * translates an `info_banner`'s `label`, the text its `bannerText`, and a miss
 * is the manifest literal. The helpers go through the hook's one `resolve()`,
 * the lookup every other helper uses, so they inherit its namespace discovery
 * and its exists-first probe (objectui#11801). `SettingsField`'s own suite
 * (`SettingsField.infoBanner-12671`) pins what the arm draws; this one pins the
 * two paths and their fallbacks at the hook.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  createI18n,
  I18nProvider,
  transformSpecTranslations,
  type SpecTranslationData,
} from '@object-ui/i18n';
import { useSettingsLabel } from '../useSettingsLabel';

afterEach(() => {
  vi.restoreAllMocks();
});

const SERVED: SpecTranslationData = {
  settings: {
    storage: {
      banners: {
        adapter_switch: {
          title: 'Adapter-Wechsel',
          text: 'Beim Wechsel werden vorhandene Dateien **nicht** migriert.',
        },
      },
    },
    knowledge: {
      banners: { adapter_switch: { title: 'Knowledge title', text: 'Knowledge text' } },
    },
  },
};

function instanceFor(served: SpecTranslationData | null) {
  return createI18n({
    defaultLanguage: 'de',
    detectBrowserLanguage: false,
    warnMissingKeys: true,
    resources: served ? { de: transformSpecTranslations(served) } : {},
  });
}

function helpersFor(namespace: string, served: SpecTranslationData | null, instance = instanceFor(served)) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider instance={instance}>{children}</I18nProvider>
  );
  return renderHook(() => useSettingsLabel(namespace), { wrapper }).result.current;
}

describe('useSettingsLabel banner helpers (objectui#12671)', () => {
  it('bannerTitle reads banners.BANNER_ID.title and bannerText reads banners.BANNER_ID.text', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const labels = helpersFor('storage', SERVED);
    expect(labels.bannerTitle('adapter_switch', 'Switching adapter')).toBe('Adapter-Wechsel');
    expect(labels.bannerText('adapter_switch', 'Existing files are not migrated.')).toBe(
      'Beim Wechsel werden vorhandene Dateien **nicht** migriert.',
    );
  });

  it('stays inside its own namespace', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(helpersFor('knowledge', SERVED).bannerTitle('adapter_switch', 'x')).toBe('Knowledge title');
    expect(helpersFor('mail', SERVED).bannerTitle('adapter_switch', 'Literal')).toBe('Literal');
  });

  it('falls back to the manifest literal on a miss, an absent body included', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const labels = helpersFor('storage', SERVED);
    expect(labels.bannerTitle('other_banner', 'Heads up')).toBe('Heads up');
    expect(labels.bannerText('other_banner', 'Literal body')).toBe('Literal body');
    expect(labels.bannerText('other_banner', undefined)).toBeUndefined();
    const bare = helpersFor('storage', null);
    expect(bare.bannerTitle('adapter_switch', 'Heads up')).toBe('Heads up');
    expect(bare.bannerText('adapter_switch', undefined)).toBeUndefined();
  });

  it('a probe that misses by design logs no missing-translation warning (the objectui#11801 property)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bannerMisses = () =>
      warn.mock.calls
        .map((args) => String(args[0]))
        .filter((line) => line.includes('Missing translation') && line.includes('.banners.other_banner.'));
    const instance = instanceFor(SERVED);
    const labels = helpersFor('storage', SERVED, instance);
    labels.bannerTitle('other_banner', 'Heads up');
    labels.bannerText('other_banner', undefined);
    expect(bannerMisses()).toEqual([]);
    // Control: the same key asked with a plain `t()` does warn, so the empty
    // list above is a reading of a live channel, not a muted one.
    instance.t('app.settings.storage.banners.other_banner.title');
    expect(bannerMisses()).toHaveLength(1);
  });
});
