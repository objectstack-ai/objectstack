/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Changing the ⌘K query from one set of record groups to another keeps the
 * palette and the console up (objectui#13387).
 *
 * The palette draws its record hits as one `CommandGroup` per object. With
 * cmdk's own filter on, a new query that no longer found an object unmounted
 * that object's group, and cmdk's sort, scheduled by the new hits' values,
 * still walked the group ids its last filter saw: it read the removed group,
 * threw `Cannot read properties of undefined (reading 'forEach')` in a layout
 * effect, and the throw unmounted the whole console. The palette now turns
 * cmdk's filter and sort off (it already decides both), and sits behind its
 * own error boundary.
 *
 * Pinned through the real `CommandPaletteProvider` (opened by its `?palette=1`
 * deep link) and the real cmdk, with a `searchAll` stub standing in for the
 * server search:
 *
 *  - with the Project group on screen for `Website`, typing `Contoso` over a
 *    selected query, or after deleting it key by key, swaps it for the
 *    Account group, and the palette stays open with no error reported (the
 *    two sequences the card reproduced; on the unfixed palette both throw);
 *  - an error thrown inside the palette closes it and leaves the console
 *    mounted, and the next ⌘K opens a working palette.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

// An icon that throws while `fault.on` is set: the stand-in for any error
// raised inside the palette.
const fault = vi.hoisted(() => ({ on: false }));
vi.mock('../utils/getIcon', () => ({
  getIcon: (name: string) =>
    function StubIcon(props: { className?: string }) {
      if (name === 'faulty' && fault.on) throw new Error('palette fault');
      return <svg data-glyph={name} className={props.className} />;
    },
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

const APP = {
  name: 'showcase_app',
  label: 'Showcase',
  navigation: [
    { id: 'nav_projects', type: 'object', objectName: 'showcase_project', label: 'Projects' },
    { id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts' },
    { id: 'nav_deals', type: 'object', objectName: 'showcase_deal', label: 'Deals' },
  ],
};

const OBJECTS = [
  { name: 'showcase_project', label: 'Project', icon: 'folder' },
  { name: 'showcase_account', label: 'Account', icon: 'building' },
  { name: 'showcase_deal', label: 'Deal', icon: 'faulty' },
];

/** The records the server search knows, found by a plain substring of their title. */
const RECORDS = [
  { object: 'showcase_project', id: 'p1', title: 'Website Relaunch' },
  { object: 'showcase_account', id: 'a1', title: 'Contoso Ltd' },
  { object: 'showcase_deal', id: 'd1', title: 'Fabrikam renewal' },
];

/** Where the router is, so a test can read whether `?palette=1` is still set. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function mount() {
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    searchAll: vi.fn(async (q: string) => ({
      hits: RECORDS.filter((r) => r.title.toLowerCase().includes(q.toLowerCase())),
    })),
  };
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/showcase_app?palette=1']}>
        <CommandPaletteProvider>
          <main data-testid="console-shell">console</main>
          <LocationProbe />
          <CommandPalette
            apps={[APP]}
            activeApp={APP}
            objects={OBJECTS}
            onAppChange={() => {}}
            dataSource={dataSource}
          />
        </CommandPaletteProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  return dataSource;
}

function type(query: string) {
  const input = document.querySelector('[cmdk-input]');
  if (!input) throw new Error('the palette is not open');
  fireEvent.change(input, { target: { value: query } });
}

/** Types `text` one key at a time after `prefix`, the way a person does. */
function typeKeys(prefix: string, text: string) {
  for (let i = 1; i <= text.length; i++) type(prefix + text.slice(0, i));
}

/** Deletes `text` one Backspace at a time, down to the empty query. */
function backspaceAll(text: string) {
  for (let i = text.length - 1; i >= 0; i--) type(text.slice(0, i));
}

/** The visible text of every record hit cmdk rendered. */
function recordHits(): string[] {
  return Array.from(document.querySelectorAll('[cmdk-item][data-value^="record "]')).map((el) =>
    (el.textContent ?? '').trim(),
  );
}

/** Waits until the record hits on screen are exactly `expected` (the hook debounces 250ms). */
async function hitsBecome(expected: string[]) {
  await waitFor(() => expect(recordHits()).toEqual(expected), { timeout: 4000 });
}

afterEach(() => {
  fault.on = false;
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#13387 — changing the ⌘K query keeps the palette and the console up', () => {
  it('`Website`, then `Contoso` typed over the selected query, swaps the Project group for the Account group', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();

    type('Website');
    await hitsBecome(['Website Relaunch']);

    // Select-all, then type: the first key replaces the whole query.
    typeKeys('', 'Contoso');
    await hitsBecome(['Contoso Ltd']);

    expect(screen.getByTestId('console-shell')).toBeTruthy();
    expect(document.querySelector('[cmdk-input]')).not.toBeNull();
    expect(screen.getByTestId('location').textContent).toContain('palette=1');
    // No error reached a boundary or React's uncaught-error report.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('`Website`, deleted key by key and followed by `Contoso`, does the same', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();

    type('Website');
    await hitsBecome(['Website Relaunch']);

    backspaceAll('Website');
    typeKeys('', 'Contoso');
    await hitsBecome(['Contoso Ltd']);

    expect(document.querySelector('[cmdk-input]')).not.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('an error inside the palette closes it and leaves the console mounted; the next ⌘K opens a working palette', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();

    fault.on = true;
    type('fabrikam');
    await waitFor(() => expect(document.querySelector('[cmdk-input]')).toBeNull(), { timeout: 4000 });

    expect(screen.getByTestId('console-shell').textContent).toBe('console');
    // The palette's boundary caught and reported it.
    expect(consoleError.mock.calls.some((call) => call.includes('[ErrorBoundary] Caught error:'))).toBe(true);
    await waitFor(() => expect(screen.getByTestId('location').textContent).not.toContain('palette=1'));

    fault.on = false;
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => expect(document.querySelector('[cmdk-input]')).not.toBeNull());

    type('fabrikam');
    await hitsBecome(['Fabrikam renewal']);
  });
});
