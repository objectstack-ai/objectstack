// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13253 — a palette command that leaves the page asks first while the
 * page holds unsaved edits.
 *
 * The palette navigates from an item, which no page's link guard sees, so it
 * left a dirty page with no question and the edit was lost (measured on a
 * dirty settings page: Search, "Accounts", Enter). Every departure the palette
 * starts now goes through the shell's seam, `confirmUnsavedLeave`: the palette
 * closes as before, then the page's question is asked. Cancel keeps the page
 * and its edit; OK goes.
 *
 * The REAL `CommandPalette` + `CommandPaletteProvider` in a `MemoryRouter`
 * (the harness `CommandPalette.closesOnCommand-12683.test.tsx` uses), beside a
 * page that registers its edit with `useRegisterUnsavedEdits` exactly as a
 * real page does. Only `useAuth` and `window.confirm` are replaced.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { CommandPalette } from './CommandPalette';
import { ThemeProvider } from './ThemeProvider';
import { useRegisterUnsavedEdits } from './unsavedEdits';
import { CommandPaletteProvider, useCommandPalette } from '../context/CommandPaletteProvider';

const SHOWCASE = {
  name: 'showcase_app',
  label: 'Showcase',
  navigation: [
    { id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts' },
  ],
};
const OTHER_APP = { name: 'other_app', label: 'Other', navigation: [] };
const OBJECTS = [{ name: 'showcase_account', label: 'Account' }];

const PAGE = '/apps/showcase_app/system/settings/localization';
const ACCOUNTS = '/apps/showcase_app/showcase_account';
const THEME_KEY = 'objectui-13253-theme';
const QUESTION = 'Leave this page and drop your edit?';

/** A settings-like page: one input, registered with the seam while it differs from what was loaded. */
function EditingPage() {
  const [value, setValue] = React.useState('en');
  useRegisterUnsavedEdits(value !== 'en', QUESTION);
  return <input aria-label="Default locale" value={value} onChange={(e) => setValue(e.target.value)} />;
}

function Probe() {
  const location = useLocation();
  const { openCommandPalette } = useCommandPalette();
  return (
    <>
      <span data-testid="location" data-path={location.pathname} />
      <button type="button" data-testid="open-palette" onClick={openCommandPalette} />
    </>
  );
}

const onAppChange = vi.fn();

function mount() {
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <ThemeProvider defaultTheme="light" storageKey={THEME_KEY}>
        <MemoryRouter initialEntries={[PAGE]}>
          <CommandPaletteProvider>
            <Probe />
            <Routes>
              <Route path={PAGE} element={<EditingPage />} />
              <Route path={ACCOUNTS} element={<div>Accounts list</div>} />
            </Routes>
            <CommandPalette
              apps={[SHOWCASE, OTHER_APP]}
              activeApp={SHOWCASE}
              objects={OBJECTS}
              onAppChange={onAppChange}
            />
          </CommandPaletteProvider>
        </MemoryRouter>
      </ThemeProvider>
    </I18nProvider>,
  );
}

const path = () => screen.getByTestId('location').getAttribute('data-path');
const paletteMounted = () => document.querySelector('[data-testid="overlay:command-palette"]') !== null;
const input = () => screen.getByRole('textbox', { name: 'Default locale' }) as HTMLInputElement;

function edit() {
  fireEvent.change(input(), { target: { value: 'fr' } });
}

/** Open the palette, type `query`, and pick the item whose value starts with `prefix`. */
function pick(query: string, prefix: string) {
  fireEvent.click(screen.getByTestId('open-palette'));
  const box = document.querySelector('[cmdk-input]');
  if (!box) throw new Error('the palette is not open');
  fireEvent.change(box, { target: { value: query } });
  const item = document.querySelector(`[cmdk-item][data-value^="${prefix}"]`);
  if (!item) throw new Error(`no rendered item starts with "${prefix}"`);
  fireEvent.click(item);
}

const confirmSpy = vi.fn((_message?: string) => false);

beforeEach(() => {
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(false);
  onAppChange.mockReset();
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(THEME_KEY);
  document.documentElement.classList.remove('light', 'dark');
});

describe('a palette departure asks before dropping the page\'s unsaved edit (objectui#13253)', () => {
  it('choosing "Accounts" on a dirty page asks; Cancel closes the palette and keeps the page and its edit', () => {
    mount();
    edit();

    pick('Accounts', 'object Accounts');

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    expect(paletteMounted()).toBe(false);
    expect(path()).toBe(PAGE);
    expect(input().value).toBe('fr');
    expect(screen.queryByText('Accounts list')).toBeNull();
  });

  it('choosing "Accounts" on a dirty page and answering OK navigates', async () => {
    mount();
    edit();
    confirmSpy.mockReturnValue(true);

    pick('Accounts', 'object Accounts');

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Accounts list')).toBeTruthy();
    expect(path()).toBe(ACCOUNTS);
  });

  it('switching app from the palette on a dirty page asks; Cancel never switches, OK does', () => {
    mount();
    edit();

    pick('Other', 'app Other');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onAppChange).not.toHaveBeenCalled();
    expect(input().value).toBe('fr');

    confirmSpy.mockReturnValue(true);
    pick('Other', 'app Other');
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(onAppChange).toHaveBeenCalledWith('other_app');
  });

  it('CONTROL: on a clean page the same choices never ask', async () => {
    mount();

    pick('Other', 'app Other');
    expect(onAppChange).toHaveBeenCalledWith('other_app');

    pick('Accounts', 'object Accounts');
    expect(await screen.findByText('Accounts list')).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
