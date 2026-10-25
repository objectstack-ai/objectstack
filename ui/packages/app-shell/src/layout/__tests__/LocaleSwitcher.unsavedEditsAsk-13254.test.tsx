// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The language menu asks before a switch drops a page's unsaved edits
 * (objectui#13254).
 *
 * ## What was broken
 *
 * Measured in Chromium on a dirty `/apps/crm/system/settings/localization`:
 * avatar › Language › 中文 asked nothing, and the edit was gone. The console
 * shell remounts every page on a language change (`MetadataProvider
 * key={language}` in `ConnectedShellInner`, deliberately: it relabels the
 * labels the server translates), so a switch is a departure from the page's
 * edits even though the URL stays. Every other header entry that drops them
 * already asked through `confirmUnsavedLeave` (objectui#13231); the language
 * menu did not.
 *
 * ## What is driven here
 *
 * The real `LocaleSwitcher` with the real Radix menu, the real `I18nProvider`
 * and the real `useLanguageSelection`, signed in, over a fake `sys_user` row,
 * so each case reads what the user sees (the language, the menu, the draft)
 * and what the column holds. The page is a draft input that registers its
 * edits through `useRegisterUnsavedEdits`, the way a settings page does, under
 * a `key={language}` that stands in for the shell's remount.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';

const session = vi.hoisted(() => ({ adapter: null as unknown }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'usr_1' }, isAuthenticated: true, isLoading: false }),
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => session.adapter,
}));

import { LocaleSwitcher } from '../LocaleSwitcher';
import { useRegisterUnsavedEdits } from '../../chrome/unsavedEdits';

const QUESTION = 'You have unsaved changes. Are you sure you want to leave?';
const STORED = 'YYYY-MM-DD';
const EDITED = 'DD/MM/YYYY';

/** The `sys_user` row behind the adapter; `update` writes it, so a case reads the column. */
function fakeUserAdapter() {
  const row: { id: string; locale: string | null } = { id: 'usr_1', locale: null };
  return {
    row,
    findOne: vi.fn(async () => ({ ...row })),
    update: vi.fn(async (_object: string, _id: string, patch: { locale?: string | null }) => {
      row.locale = patch.locale ?? null;
      return { ...row };
    }),
  };
}
let adapter: ReturnType<typeof fakeUserAdapter>;

/** A settings-like page: one field whose edit is held until saved, registered while dirty. */
function DraftPage() {
  const [draft, setDraft] = useState(STORED);
  useRegisterUnsavedEdits(draft !== STORED, QUESTION);
  return <input aria-label="Date format" value={draft} onChange={(e) => setDraft(e.target.value)} />;
}

/** The shell's remount on a language change, and the language the UI renders in. */
function Shell() {
  const { language } = useObjectTranslation();
  return (
    <>
      <span data-testid="language">{language}</span>
      <DraftPage key={language} />
    </>
  );
}

function mount(props: { loadLanguage?: (lang: string) => Promise<Record<string, unknown>> } = {}) {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} {...props}>
      <Shell />
      <LocaleSwitcher />
    </I18nProvider>,
  );
}

const language = () => screen.getByTestId('language').textContent;
const draft = () => (screen.getByLabelText('Date format') as HTMLInputElement).value;
const edit = () => fireEvent.change(screen.getByLabelText('Date format'), { target: { value: EDITED } });

/** Open the globe menu the way a pointer does, then pick an entry by its native name. */
function pick(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: /^(Language|语言)$/ }), { button: 0, pointerType: 'mouse' });
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) }));
}

/** The prompt, answered by the case: Cancel unless it says OK. happy-dom's window has no `confirm` to spy on. */
function stubConfirm() {
  const spy = vi.fn((_message?: string): boolean => false);
  vi.stubGlobal('confirm', spy);
  return spy;
}
let confirmSpy: ReturnType<typeof stubConfirm>;

beforeEach(() => {
  window.localStorage.clear();
  adapter = fakeUserAdapter();
  session.adapter = adapter;
  confirmSpy = stubConfirm();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the language menu asks before a switch drops unsaved edits (objectui#13254)', () => {
  it('another language asks the page’s question; Cancel keeps the language, the edit and the column, and closes the menu', async () => {
    mount();
    edit();

    pick('中文');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    // Settle anything a switch would have started before reading what stayed.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(language()).toBe('en');
    expect(draft()).toBe(EDITED);
    expect(adapter.update).not.toHaveBeenCalled();
    expect(adapter.row.locale).toBeNull();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('OK switches to that language and writes it to `sys_user.locale`', async () => {
    mount();
    edit();
    confirmSpy.mockReturnValue(true);

    pick('中文');
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    await waitFor(() => expect(language()).toBe('zh'));
    await waitFor(() => expect(adapter.row.locale).toBe('zh'));
    expect(adapter.update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('OK: the tab-close guard does not ask a second time while the switch loads', async () => {
    let unloadHeldDuringSwitch: boolean | undefined;
    mount({
      // Runs inside the switch, before the language changes and the page remounts.
      loadLanguage: async () => {
        const unload = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(unload);
        unloadHeldDuringSwitch = unload.defaultPrevented;
        return {};
      },
    });
    edit();
    confirmSpy.mockReturnValue(true);

    pick('中文');
    await waitFor(() => expect(language()).toBe('zh'));
    expect(unloadHeldDuringSwitch).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('the entry already checked asks too: picking it rewrites the column, so Cancel writes nothing', async () => {
    mount();
    edit();

    pick('English');
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(adapter.update).not.toHaveBeenCalled();
    expect(draft()).toBe(EDITED);

    // Why it asks: OK on the checked entry is not a no-op. If a later change
    // makes it one, this half goes red, and the checked entry may stop asking.
    confirmSpy.mockReturnValue(true);
    pick('English');
    await waitFor(() => expect(adapter.row.locale).toBe('en'));
    expect(language()).toBe('en');
  });
});

describe('CONTROL: nothing registered, nothing asked (objectui#13254)', () => {
  it('a clean page switches at once', async () => {
    mount();

    pick('中文');
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(language()).toBe('zh'));
    await waitFor(() => expect(adapter.row.locale).toBe('zh'));
  });
});
