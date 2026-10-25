/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The chips on a settings row's header speak the session locale
 * (objectui#12821, the family after objectui#12694).
 *
 * ## What was broken
 *
 * `EnvLockBadge` drew its chip text and its fallback title as JSX literals, and
 * `FieldHeader` drew the `Deprecated` chip (and its `→ replacedBy` arrow) the
 * same way. So an administrator on a zh-CN session read "Locked by env" beside
 * a row that otherwise read in zh. All three now read `console.settingsView.*`.
 *
 * ## What stays as served
 *
 * A served `lockedReason` (the server's "Set via env: NAME") is the server's
 * text and is shown verbatim as the title; only the fallback title, used when
 * the server names no reason, is the page's own copy.
 *
 * ## The `Deprecated` chip has no producer today
 *
 * No platform settings manifest declares a deprecated specifier, so nothing
 * draws this chip in a running console. It is the same class on the same row,
 * so a fixture specifier draws it here.
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * On unchanged `main`: the zh cases and the every-pack case FAIL (the chip
 * carries the English literal; no pack defines the keys); the en cases PASS,
 * because English is the one language whose output must not change.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { SettingsField } from '../SettingsField';
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

const DEPRECATED: Specifier = { ...COUNTRY, deprecated: true };
const DEPRECATED_REPLACED: Specifier = { ...COUNTRY, deprecated: true, replacedBy: 'country_code' };

/** Pinned by env, the server naming no reason: the chip shows the fallback title. */
const LOCKED_NO_REASON: ResolvedSettingValue = { value: 'CN', source: 'env', locked: true };

/** Pinned by env with a served reason: the server's text is the title, verbatim. */
const LOCKED_WITH_REASON: ResolvedSettingValue = {
  value: 'CN',
  source: 'env',
  locked: true,
  lockedReason: 'Set via env: OS_LOCALIZATION_DEFAULT_COUNTRY',
};

type Lang = 'en' | 'zh-CN';

function renderRow(language: Lang, spec: Specifier, resolved?: ResolvedSettingValue) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <SettingsField spec={spec} resolved={resolved} value="CN" onChange={() => {}} />
    </I18nProvider>,
  );
}

const view = builtInLocales.zh.console.settingsView as unknown as Record<string, string>;
const viewEn = builtInLocales.en.console.settingsView as unknown as Record<string, string>;
const LATIN = /\p{Script=Latin}/u;

/** The row header's one chip whose text is `text`, once the catalogue has landed. */
async function chip(text: string) {
  return waitFor(() => screen.getByText(text, { selector: 'div,span' }));
}

describe('the env-lock chip under zh-CN reads in zh (objectui#12821)', () => {
  it('the chip text and its fallback title are the zh strings', async () => {
    renderRow('zh-CN', COUNTRY, LOCKED_NO_REASON);
    const el = await chip(view.envLockBadge);
    expect(el.textContent).not.toMatch(LATIN);
    expect(el).toHaveAttribute('title', view.envLockBadgeTitle);
    expect(el.getAttribute('title')).not.toMatch(LATIN);
  });

  it("a served reason is the server's text, shown as served", async () => {
    renderRow('zh-CN', COUNTRY, LOCKED_WITH_REASON);
    const el = await chip(view.envLockBadge);
    expect(el).toHaveAttribute('title', 'Set via env: OS_LOCALIZATION_DEFAULT_COUNTRY');
  });
});

describe('the Deprecated chip under zh-CN reads in zh (objectui#12821)', () => {
  it('without a replacement', async () => {
    renderRow('zh-CN', DEPRECATED);
    const el = await chip(view.deprecatedBadge);
    expect(el.textContent).not.toMatch(LATIN);
  });

  it('with a replacement, the key spliced into the zh sentence', async () => {
    renderRow('zh-CN', DEPRECATED_REPLACED);
    const expected = view.deprecatedBadgeReplacedBy.replace('{{replacedBy}}', 'country_code');
    const el = await chip(expected);
    // The replacement key is a key, not copy: the rest of the chip is zh.
    expect(el.textContent!.replace('country_code', '')).not.toMatch(LATIN);
  });
});

describe('the chips under en read exactly as they did (objectui#12821, must-not-change)', () => {
  it('Locked by env, with the old fallback title', async () => {
    renderRow('en', COUNTRY, LOCKED_NO_REASON);
    const el = await chip('Locked by env');
    expect(el.textContent).toBe('Locked by env');
    expect(el).toHaveAttribute('title', 'Pinned by environment variable — cannot be edited from the UI.');
  });

  it('Deprecated, and Deprecated → replacedBy', async () => {
    renderRow('en', DEPRECATED);
    expect((await chip('Deprecated')).textContent).toBe('Deprecated');
    cleanup();
    renderRow('en', DEPRECATED_REPLACED);
    expect((await chip('Deprecated → country_code')).textContent).toBe('Deprecated → country_code');
  });

  it('the unsupported-type row reads as it did', async () => {
    renderRow('en', { ...COUNTRY, type: 'not_a_type' } as unknown as Specifier);
    expect((await chip('Unsupported specifier type: not_a_type')).textContent).toBe(
      'Unsupported specifier type: not_a_type',
    );
  });
});

describe('every pack carries the row chips, translated (objectui#12821)', () => {
  const PLAIN = ['envLockBadge', 'envLockBadgeTitle', 'deprecatedBadge'] as const;
  const HOLED = [
    ['deprecatedBadgeReplacedBy', '{{replacedBy}}'],
    ['unsupportedSpecifierType', '{{type}}'],
  ] as const;

  it.each(Object.keys(builtInLocales))('%s: each chip key is a string, not an English copy', (code) => {
    const pack = builtInLocales[code as keyof typeof builtInLocales] as unknown as {
      console?: { settingsView?: Record<string, unknown> };
    };
    const at = (key: string) => pack.console?.settingsView?.[key];
    for (const key of PLAIN) {
      expect(typeof at(key), `${code} console.settingsView.${key}`).toBe('string');
      if (code !== 'en') expect(at(key), `${code} ${key}`).not.toBe(viewEn[key]);
    }
    for (const [key, hole] of HOLED) {
      expect(typeof at(key), `${code} console.settingsView.${key}`).toBe('string');
      expect((at(key) as string).split(hole), `${code} ${key} holes`).toHaveLength(2);
      if (code !== 'en') expect(at(key), `${code} ${key}`).not.toBe(viewEn[key]);
    }
  });
});
