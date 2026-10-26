/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `SettingsView`'s framing copy speaks the session locale — objectui#4024,
 * the SettingsView unit recorded in the card's comment.
 *
 * ## Why this screen is one item rather than nine
 *
 * Its immediate sibling already does the right thing. `SettingsHub.tsx`, in the
 * same directory, resolves through `t('console.settingsHub.*')` against the same
 * bundle that ships all ten packs. So this was never a missing capability or an
 * unwired screen — it was one file written against a different convention than
 * the file next to it, and converting it half-way would have left a single
 * translated string among a dozen hardcoded ones. `useSettingsLabel` already
 * translates the manifest-authored CONTENT (title, description, field labels),
 * so a zh-CN admin saw translated field labels sitting inside an English save
 * bar, with no key a plugin author could reach.
 *
 * The convention matched is therefore the sibling's, exactly: `useObjectTranslation`
 * from `@object-ui/i18n` + a `console.settingsView.*` namespace placed beside
 * `console.settingsHub.*` in every pack.
 *
 * ## The save-bar counter goes through i18next's real PLURAL mechanism
 *
 * `{dirtyKeys.length} unsaved change{dirtyKeys.length > 1 ? 's' : ''}` is an
 * ENGLISH plural rule executing in every locale. Translating it as
 * "N unsaved change(s)" would only translate the defect, so the counter is a
 * plural family: base + `_one` + `_other`, in all ten packs.
 *
 * i18next asks `Intl.PluralRules` for the ONE suffix a language needs for that
 * number and, finding no such slot, walks `fallbackLng` to `en`. `ru` has four
 * categories (one/few/many/other) and `ar` six. When this landed no pack
 * enumerated `_few`/`_many`/`_two`/`_zero`, so the base key was what kept `ru`
 * out of ENGLISH at counts 2-20 (objectui#3863, measured on
 * `detail.showEmptyRelated`); since objectui#11432 every pack spells out every
 * category its language selects. `all-locales-key-parity.test.ts` owns both
 * rules. The `ru` cases below at counts 1/2/5 are what prove the mechanism
 * actually reaches a plural-rich pack rather than merely type-checking.
 *
 * The alternative convention in this repo — two sibling keys `xxxCount` /
 * `xxxCountOne` (`common.itemCount`, `collaboration.commentCount`) — was
 * deliberately NOT used: its stated rationale is a parity fear that objectui#3863's
 * base-key fix has since answered, and it hard-codes a two-form (English-shaped)
 * split that `ru` and `ar` do not have.
 *
 * ## The #4514 provider-less trap, and what was decided per test
 *
 * The existing settings suites mount no `I18nProvider` and assert raw English;
 * `t()` outside a provider returns the KEY. This file mounts a provider in every
 * case, because interpolation is the thing under test: with no provider,
 * `t('console.settingsView.lockedByEnv', { key })` returns the bare key and the
 * `{{key}}` hole is never filled, so a provider-less assertion could not tell a
 * working interpolation from a broken one. The sibling suites' own disposition
 * is recorded in their headers.
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * Pre-fix, on `origin/main`: 7 failed, 2 passed.
 *   - every zh/ru case FAILS — the component renders the English literal, so
 *     `findByText('全部设置')` and friends match nothing;
 *   - the `en` framing cases (`All settings`, `Save changes`) PASS pre-fix —
 *     the literal equals the value the pack is about to gain, which is exactly
 *     why nothing caught this.
 *
 * ONE PREDICTION IN THIS FILE WAS WRONG, and it is recorded rather than
 * quietly corrected. The header first claimed the counter cases would go red in
 * BOTH languages including `en`, on the reasoning that the bundle has no
 * `console.settingsView.unsavedCount` yet. The `en` counter case PASSED pre-fix
 * — because the concatenation it replaces (`change{n > 1 ? 's' : ''}`) IS the
 * English plural rule, so English is precisely the one language whose output
 * cannot change. That is the defect stated exactly: the screen was correct in
 * English and could not be correct anywhere else. The `en` counter case is
 * therefore a must-not-change pin, and `ru`/`zh` carry the evidence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

// `vi.mock` is hoisted above every `const`, so the spies it closes over must be
// created inside `vi.hoisted` — a plain top-level `const` is in the temporal
// dead zone when the factory runs.
const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

import { SettingsView } from '../SettingsView';

const PAYLOAD = {
  manifest: {
    namespace: 'localization',
    version: 1,
    label: 'Localization',
    specifiers: [
      { type: 'text', key: 'timezone', label: 'Timezone' },
      { type: 'text', key: 'language', label: 'Language' },
      { type: 'text', key: 'region', label: 'Region' },
    ],
  },
  values: {
    timezone: { value: 'Asia/Shanghai', source: 'default', locked: false },
    language: { value: 'zh-CN', source: 'default', locked: false },
    region: { value: 'CN', source: 'default', locked: false },
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true, data: PAYLOAD }),
  } as unknown as Response);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderInLocale(language: string, path = '/settings/localization') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Type into the Nth text input so the save bar appears with N dirty keys. */
async function dirty(n: number) {
  const inputs = await screen.findAllByRole('textbox');
  for (let i = 0; i < n; i++) {
    fireEvent.change(inputs[i], { target: { value: `edited-${i}` } });
  }
}

describe('SettingsView framing copy resolves from the bundle (objectui#4024)', () => {
  it('zh-CN: the navigation button reads 全部设置', async () => {
    renderInLocale('zh');
    expect(await screen.findByText('全部设置')).toBeTruthy();
    expect(screen.queryByText('All settings')).toBeNull();
  });

  it('zh-CN: the save bar reads 放弃 / 保存更改', async () => {
    renderInLocale('zh');
    await dirty(1);
    expect(await screen.findByText('放弃')).toBeTruthy();
    expect(screen.getByText('保存更改')).toBeTruthy();
    expect(screen.queryByText('Discard')).toBeNull();
    expect(screen.queryByText('Save changes')).toBeNull();
  });

  it('en: the save bar is unchanged (must-not-change)', async () => {
    renderInLocale('en');
    await dirty(1);
    expect(await screen.findByText('Discard')).toBeTruthy();
    expect(screen.getByText('Save changes')).toBeTruthy();
    expect(screen.getByText('All settings')).toBeTruthy();
  });

  it('zh-CN: the empty-route state reads 未选择命名空间。', async () => {
    renderInLocale('zh', '/settings');
    expect(await screen.findByText('未选择命名空间。')).toBeTruthy();
  });
});

describe('SettingsView save-bar counter pluralizes through i18next (objectui#4024)', () => {
  it('en: 1 change is singular, 2 and 5 are plural', async () => {
    renderInLocale('en');
    await dirty(1);
    expect(await screen.findByText('1 unsaved change')).toBeTruthy();

    await dirty(2);
    expect(await screen.findByText('2 unsaved changes')).toBeTruthy();

    await dirty(3);
    expect(await screen.findByText('3 unsaved changes')).toBeTruthy();
    // The English-only `(s)` rule this replaced must be gone entirely.
    expect(screen.queryByText(/change\(s\)/)).toBeNull();
  });

  it('ru: the counter is Russian at 1, 2 AND 5 — one, few and many', async () => {
    // ru's CLDR categories are one/few/many/other, each with its own slot since
    // objectui#11432 (`few` and `many` landed on the BASE key before it). Without
    // either, 2 and 5 fall through `fallbackLng` to English — objectui#3863.
    renderInLocale('ru');
    await dirty(1);
    const one = await screen.findByTestId('settings-unsaved-count');
    expect(one.textContent).toMatch(/[А-Яа-я]/);
    expect(one.textContent).not.toMatch(/unsaved/);

    await dirty(2);
    await waitFor(() => {
      const few = screen.getByTestId('settings-unsaved-count');
      expect(few.textContent).toMatch(/[А-Яа-я]/);
      expect(few.textContent).not.toMatch(/unsaved/);
    });

    await dirty(3);
    await waitFor(() => {
      const many = screen.getByTestId('settings-unsaved-count');
      expect(many.textContent).toMatch(/[А-Яа-я]/);
      expect(many.textContent).not.toMatch(/unsaved/);
    });
  });

  it('zh-CN: the counter is Chinese and carries the number', async () => {
    renderInLocale('zh');
    await dirty(2);
    const node = await screen.findByTestId('settings-unsaved-count');
    expect(node.textContent).toContain('2');
    expect(node.textContent).toMatch(/[一-鿿]/);
    expect(node.textContent).not.toMatch(/unsaved/);
  });
});

describe('SettingsView refusal toasts interpolate through the bundle (objectui#4024)', () => {
  it('zh-CN: SETTINGS_LOCKED names the key inside a translated sentence', async () => {
    renderInLocale('zh');
    await dirty(1);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({
        success: false,
        error: { code: 'SETTINGS_LOCKED', message: 'locked', details: { key: 'timezone' } },
      }),
    } as unknown as Response);

    fireEvent.click(await screen.findByText('保存更改'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const calls = toastError.mock.calls;
    const msg = String(calls[calls.length - 1]?.[0] ?? '');
    // Interpolation is the thing under test: the key must be spliced INTO a
    // translated sentence, not concatenated onto an English prefix.
    expect(msg).toContain('timezone');
    expect(msg).toMatch(/[一-鿿]/);
    expect(msg).not.toContain('Locked by environment');
    expect(msg).not.toContain('console.settingsView');
  });

  it('zh-CN: the crypto refusal panel heading is translated (#4579 deferred it here)', async () => {
    renderInLocale('zh');
    await dirty(1);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({
        success: false,
        error: {
          code: 'SETTINGS_CRYPTO_UNAVAILABLE',
          message: 'Wire a cryptoProvider.',
          details: { namespace: 'localization', key: 'api_key' },
        },
      }),
    } as unknown as Response);

    fireEvent.click(await screen.findByText('保存更改'));

    const panel = await screen.findByRole('alert');
    expect(panel.textContent).toMatch(/[一-鿿]/);
    expect(panel.textContent).not.toContain('This deployment cannot encrypt secrets');
    // The server's own prescription is rendered VERBATIM — the server owns that
    // copy, and a second wording is how the two drift apart.
    expect(panel.textContent).toContain('Wire a cryptoProvider.');
  });
});
