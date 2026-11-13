/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32627 — what is typed right after ⌘K is the palette's query.
 *
 * Opening the palette is a URL change (`?palette=1`), so its input mounts a
 * render after the shortcut. Measured on a hosted tenant: typing "Acme"
 * straight after ⌘K left the input empty, because those keys went to the page.
 *
 * The window is reproduced here by dispatching the shortcut and the keys in
 * ONE `act`: React renders nothing until the act ends, so every key arrives
 * while the input does not exist yet, exactly the moment the tenant lost them.
 *
 * Pins, through the real `CommandPaletteProvider` and `CommandPalette`:
 *  - ⌘K, then "Acme" before the input mounts: the query reads "Acme", and the
 *    page never saw the keys;
 *  - Backspace in that window edits the held query;
 *  - CONTROL: with no open asked for, a key reaches the page untouched and the
 *    palette stays closed;
 *  - CONTROL: once the input has focus, its own keys are not intercepted.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

const APP = {
  name: 'showcase_app',
  label: 'Showcase',
  navigation: [{ id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts' }],
};
const OBJECTS = [{ name: 'showcase_account', label: 'Account', icon: 'building' }];

/** Every typed key the PAGE received, i.e. that the palette did not hold (the shortcut is not typing). */
const pageKeys: string[] = [];
const recordPageKey = (e: KeyboardEvent) => {
  if (e.metaKey || e.ctrlKey) return;
  if (e.key.length === 1 || e.key === 'Backspace') pageKeys.push(e.key);
};

function mount() {
  pageKeys.length = 0;
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/showcase_app']}>
        <CommandPaletteProvider>
          <main data-testid="console-shell" tabIndex={-1} onKeyDown={(e) => recordPageKey(e.nativeEvent)}>
            console
          </main>
          <CommandPalette
            apps={[APP]}
            activeApp={APP}
            objects={OBJECTS}
            onAppChange={() => {}}
            dataSource={{ find: vi.fn(async () => ({ data: [] })), searchAll: vi.fn(async () => ({ hits: [] })) } as any}
          />
        </CommandPaletteProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** A key pressed while focus is on the page (the palette's input does not exist yet). */
function pressOnPage(key: string, mods: KeyboardEventInit = {}): KeyboardEvent {
  const page = document.querySelector('[data-testid="console-shell"]')!;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
  page.dispatchEvent(event);
  return event;
}

const input = () => document.querySelector('[cmdk-input]') as HTMLInputElement | null;

afterEach(() => cleanup());

describe('the keys typed while the palette opens are its query (objectstack#32627)', () => {
  it('⌘K then "Acme" before the input mounts: the query reads "Acme" and the page saw none of it', async () => {
    mount();
    expect(input()).toBeNull();

    act(() => {
      pressOnPage('k', { metaKey: true });
      for (const key of 'Acme') pressOnPage(key);
      // Still the same act: nothing has rendered, the input is not there yet.
      expect(input()).toBeNull();
    });

    await waitFor(() => expect(input()?.value).toBe('Acme'));
    expect(pageKeys).toEqual([]);
  });

  it('Backspace in that window edits the held query', async () => {
    mount();
    act(() => {
      pressOnPage('k', { ctrlKey: true });
      for (const key of 'Acmx') pressOnPage(key);
      pressOnPage('Backspace');
      pressOnPage('e');
    });
    await waitFor(() => expect(input()?.value).toBe('Acme'));
  });

  it('CONTROL: with no open asked for, a key reaches the page and the palette stays closed', async () => {
    mount();
    let event!: KeyboardEvent;
    act(() => {
      event = pressOnPage('a');
    });
    expect(event.defaultPrevented).toBe(false);
    expect(pageKeys).toEqual(['a']);
    expect(input()).toBeNull();
  });

  it('CONTROL: once the input has focus, its own keys are not held', async () => {
    mount();
    act(() => {
      pressOnPage('k', { metaKey: true });
    });
    await waitFor(() => expect(input()).not.toBeNull());
    const field = input()!;
    field.focus();
    const event = new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true });
    act(() => {
      field.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(field.value).toBe('');
  });
});
