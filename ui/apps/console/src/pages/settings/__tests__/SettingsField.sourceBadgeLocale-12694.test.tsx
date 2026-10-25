/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A settings row's source badge speaks the session locale, verb included
 * (objectui#12694).
 *
 * ## What was broken
 *
 * `InheritanceBadges` drew its two sentences as an English verb beside a
 * translated noun: `Inherited from {sourceText(...)}` and
 * `Overrides {sourceText(...)}`. The noun is the layer's label, which the
 * server translates under `settingsCommon.sourceLabels`; the verb was a JSX
 * literal no bundle could reach. So a zh-CN admin who saved a tenant value
 * under Settings, Localization read "Overrides 默认".
 *
 * ## Where the verb lives now
 *
 * The two verbs are the settings screen's own chrome, so they sit in the
 * console bundle beside the rest of that screen's copy
 * (`console.settingsView.*`, every pack). Each badge is ONE sentence with the
 * layer's label interpolated as `{{source}}`, never a translated verb glued to
 * a translated noun: a language puts the layer where its grammar wants it
 * (Japanese reads the layer first).
 *
 * `settingsCommon` is not where they went: the spec declares that branch
 * closed, `sourceLabels` its one member, so a verb key there would be refused
 * by the schema that serves it.
 *
 * ## How the served labels reach the hook
 *
 * Through `transformSpecTranslations`, the transform `loadLanguage.ts` applies
 * to the server's translations, so the tree lands under `app` as it does in the
 * running console. The labels below are the ones the platform's settings
 * service ships for `en` and `zh-CN`.
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * On unchanged `main`: the two zh cases and the every-pack case FAIL (the badge
 * carries the English verb; no pack defines the keys); the two en cases PASS,
 * because English is the one language whose output cannot change. They are
 * must-not-change pins, and the zh cases carry the evidence.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  I18nProvider,
  transformSpecTranslations,
  type SpecTranslationData,
} from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { SettingsField } from '../SettingsField';
import { useSettingsLabel } from '../useSettingsLabel';
import type { ResolvedSettingValue, Specifier } from '../types';

afterEach(cleanup);
// A language a previous case persisted would outrank `defaultLanguage`.
beforeEach(() => {
  window.localStorage.clear();
});

const COUNTRY: Specifier = {
  type: 'text',
  key: 'default_country',
  label: 'Default country',
  required: false,
};

/** A tenant value over the manifest default: the badge names the default layer. */
const OVERRIDES: ResolvedSettingValue = {
  value: 'CN',
  source: 'tenant',
  locked: false,
  cascadeChain: [
    { scope: 'tenant', value: 'CN', effective: true },
    { scope: 'default', value: 'US' },
  ],
};

/** A value only the global layer carries: the badge names that layer. */
const INHERITED: ResolvedSettingValue = {
  value: 'GB',
  source: 'global',
  locked: false,
  cascadeChain: [
    { scope: 'tenant', value: null },
    { scope: 'global', value: 'GB', effective: true },
    { scope: 'default', value: 'US' },
  ],
};

const SOURCE_LABELS = {
  en: { env: 'Env', global: 'Global', tenant: 'Tenant', user: 'User', default: 'Default' },
  zh: { env: '环境变量', global: '全局', tenant: '租户', user: '用户', default: '默认' },
} as const;

/** What the server serves for a locale: its source labels and the row's label. */
function served(language: 'en' | 'zh'): SpecTranslationData {
  return {
    settingsCommon: { sourceLabels: { ...SOURCE_LABELS[language] } },
    settings: {
      localization: {
        keys: {
          default_country: { label: language === 'zh' ? '默认国家/地区' : 'Default country' },
        },
      },
    },
  } as SpecTranslationData;
}

function Row({ resolved }: { resolved: ResolvedSettingValue }) {
  const labels = useSettingsLabel('localization');
  return (
    <SettingsField
      spec={COUNTRY}
      resolved={resolved}
      value={resolved.value}
      onChange={() => {}}
      labels={labels}
    />
  );
}

function renderRow(language: 'en' | 'zh', resolved: ResolvedSettingValue) {
  return render(
    <I18nProvider
      config={{
        defaultLanguage: language,
        detectBrowserLanguage: false,
        resources: { [language]: transformSpecTranslations(served(language)) },
      }}
    >
      <Row resolved={resolved} />
    </I18nProvider>,
  );
}

/**
 * The row's header, and in it the badge: the one element whose own text holds
 * the layer's label and more than the label. The trailing source chip holds
 * the effective layer's label alone, so it is never the match.
 */
function headerAndBadge(rowLabel: string, layerLabel: string) {
  const label = screen.getByText(rowLabel, { selector: 'label' });
  const header = label.closest('div') as HTMLElement;
  const hits = within(header).getAllByText((_, el) => {
    const text = el?.textContent ?? '';
    // `within` offers the container itself too, and its text holds the badge's.
    // The Overrides row's "Reset to default" action (objectui#13145) is a
    // button, never the badge; zh spells it with the default layer's word.
    if (el?.closest('button')) return false;
    return el !== header && el !== label && text.includes(layerLabel) && text !== layerLabel;
  });
  expect(hits).toHaveLength(1);
  return { header, badge: hits[0] };
}

/**
 * Asserts once the session's catalogue has landed: `I18nProvider` loads a
 * non-English pack after the first render, and until then i18next renders
 * through `en`.
 */
async function expectRow(rowLabel: string, layerLabel: string, check: (header: HTMLElement, badge: HTMLElement) => void) {
  await screen.findByText(rowLabel, { selector: 'label' });
  await waitFor(() => {
    const { header, badge } = headerAndBadge(rowLabel, layerLabel);
    check(header, badge);
  });
}

const LATIN = /\p{Script=Latin}/u;

describe('the source badge under zh-CN reads entirely in zh (objectui#12694)', () => {
  it('Overrides: a tenant value over the default names the default layer in a zh sentence', async () => {
    renderRow('zh', OVERRIDES);
    await expectRow('默认国家/地区', '默认', (header, badge) => {
      expect(badge.textContent).not.toMatch(LATIN);
      expect(header.textContent).not.toMatch(LATIN);
    });
  });

  it('Inherited: a value from the global layer names that layer in a zh sentence', async () => {
    renderRow('zh', INHERITED);
    await expectRow('默认国家/地区', '全局', (header, badge) => {
      expect(badge.textContent).not.toMatch(LATIN);
      expect(header.textContent).not.toMatch(LATIN);
    });
  });
});

describe('the source badge under en reads exactly as it did (objectui#12694, must-not-change)', () => {
  it('Overrides Default', async () => {
    renderRow('en', OVERRIDES);
    await expectRow('Default country', 'Default', (_header, badge) => {
      expect(badge.textContent).toBe('Overrides Default');
    });
  });

  it('Inherited from Global', async () => {
    renderRow('en', INHERITED);
    await expectRow('Default country', 'Global', (_header, badge) => {
      expect(badge.textContent).toBe('Inherited from Global');
    });
  });
});

describe('every pack carries both badge sentences, translated (objectui#12694)', () => {
  const KEYS = ['sourceBadgeInherited', 'sourceBadgeOverrides'] as const;

  it.each(Object.keys(builtInLocales))('%s: one {{source}} hole per sentence, not an English copy', (code) => {
    const pack = builtInLocales[code as keyof typeof builtInLocales] as unknown as {
      console?: { settingsView?: Record<string, unknown> };
    };
    const en = builtInLocales.en.console.settingsView as unknown as Record<string, unknown>;
    for (const key of KEYS) {
      const value = pack.console?.settingsView?.[key];
      expect(typeof value, `${code} console.settingsView.${key}`).toBe('string');
      expect((value as string).split('{{source}}'), `${code} ${key} holes`).toHaveLength(2);
      if (code !== 'en') expect(value, `${code} ${key}`).not.toBe(en[key]);
    }
  });
});
