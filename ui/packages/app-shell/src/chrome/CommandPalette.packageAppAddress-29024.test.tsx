// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29024 — the ⌘K palette's "Switch app" item opens
 * the app it names, a package's non-first app included.
 *
 * `/apps/PACKAGE_ID` resolves to the package's FIRST app, so switching by the
 * package id opened that first app for every other app of the package (a
 * hidden one, which the palette offers too, included). The item now hands
 * `onAppChange` the app's one address (`appAddressSegment`): the package id
 * where it resolves back to the app, else the app's name.
 *
 * The harness is `CommandPalette.launcherHiddenApps-26838.test.tsx`'s.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

const state = vi.hoisted(() => ({ apps: [] as Array<Record<string, unknown>> }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));
// The provider reads the app list from the metadata cache; the rest of the
// cache is the real (empty) one the palette's other groups read.
vi.mock('../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers/MetadataProvider')>();
  return {
    ...actual,
    useMetadata: () => ({ ...actual.useMetadata(), apps: state.apps, loading: false }),
  };
});

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';
import { LauncherAppsProvider } from '../hooks/useLauncherApps';

const FIRST = { name: 'qsixn_app', label: 'R6 App', _packageId: 'com.qa.r6nav', navigation: [] };
const SECOND = { name: 'qsixn_hidden_app', label: 'R6 Hidden App', hidden: true, _packageId: 'com.qa.r6nav', navigation: [] };
const SOLO = { name: 'solo_app', label: 'Solo', _packageId: 'com.qa.solo', navigation: [] };

function mount(onAppChange: (segment: string) => void) {
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/com.qa.solo?palette=1']}>
        <LauncherAppsProvider endpoint="/me-apps-double" fetcher={(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch}>
          <CommandPaletteProvider>
            <CommandPalette
              apps={state.apps}
              activeApp={SOLO}
              objects={[]}
              onAppChange={onAppChange}
              dataSource={{ find: vi.fn(async () => ({ data: [] })), searchAll: vi.fn(async () => ({ hits: [] })) }}
            />
          </CommandPaletteProvider>
        </LauncherAppsProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  if (!document.querySelector('[cmdk-input]')) throw new Error('the palette did not open');
}

/** The cmdk item of the app labelled `label`. */
function appItem(label: string): Element {
  const item = Array.from(document.querySelectorAll('[cmdk-item][data-value^="app "]')).find(
    (el) => (el.textContent ?? '').replace(/Current$/, '').trim() === label,
  );
  if (!item) throw new Error(`no "Switch app" item for ${label}`);
  return item;
}

beforeEach(() => {
  state.apps = [FIRST, SECOND, SOLO];
});

afterEach(() => cleanup());

describe('the palette switches to the app it names (objectstack-ai/objectstack#29024)', () => {
  it('a package\'s second app is switched to by its name', async () => {
    const onAppChange = vi.fn();
    mount(onAppChange);
    await waitFor(() => appItem('R6 Hidden App'));
    fireEvent.click(appItem('R6 Hidden App'));
    await waitFor(() => expect(onAppChange).toHaveBeenCalledWith('qsixn_hidden_app'));
  });

  it('a package\'s first app keeps its package-id address', async () => {
    const onAppChange = vi.fn();
    mount(onAppChange);
    await waitFor(() => appItem('R6 App'));
    fireEvent.click(appItem('R6 App'));
    await waitFor(() => expect(onAppChange).toHaveBeenCalledWith('com.qa.r6nav'));
  });
});
