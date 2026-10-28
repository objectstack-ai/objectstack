// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26838 — the ⌘K palette's "Switch app" group offers no app the
 * user's permission sets hide (`tabPermissions: hidden`): it is narrowed by
 * the same `GET /me/apps` answer as Home's tiles and the app switcher. The
 * palette keeps its own rule otherwise — every active app, a `hidden` one
 * (the avatar-menu kind) included.
 *
 * Under the real `LauncherAppsProvider` fed a `/me/apps` double, the real
 * `CommandPaletteProvider` opened by its `?palette=1` deep link, and a real
 * `I18nProvider` in `en` — the `CommandPalette.navMatch-11812` harness.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
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

const SHOWCASE = { name: 'showcase_app', label: 'Showcase', navigation: [] };
const CRM = { name: 'crm_app', label: 'CRM', navigation: [] };
const OPS = { name: 'ops_app', label: 'Ops', navigation: [] };
const ACCOUNT = { name: 'account', label: 'Account', hidden: true, navigation: [] };

/** A `/me/apps` double: the listed names, or a bare status. */
function meApps(answer: string[] | number) {
  return vi.fn(async (_url: unknown) =>
    typeof answer === 'number'
      ? new Response('{}', { status: answer })
      : new Response(JSON.stringify({ apps: answer.map((name) => ({ name })) }), { status: 200 }),
  );
}

function mount(fetcher: ReturnType<typeof meApps>) {
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/showcase_app?palette=1']}>
        <LauncherAppsProvider endpoint="/me-apps-double" fetcher={fetcher as unknown as typeof fetch}>
          <CommandPaletteProvider>
            <CommandPalette
              apps={state.apps}
              activeApp={SHOWCASE}
              objects={[]}
              onAppChange={() => {}}
              dataSource={{ find: vi.fn(async () => ({ data: [] })), searchAll: vi.fn(async () => ({ hits: [] })) }}
            />
          </CommandPaletteProvider>
        </LauncherAppsProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  if (!document.querySelector('[cmdk-input]')) throw new Error('the palette did not open');
}

/** The visible text of every app item cmdk rendered. */
function shownApps(): string[] {
  return Array.from(document.querySelectorAll('[cmdk-item][data-value^="app "]')).map((el) =>
    (el.textContent ?? '').replace(/Current$/, '').trim(),
  );
}

beforeEach(() => {
  state.apps = [SHOWCASE, CRM, OPS, ACCOUNT];
});

afterEach(() => cleanup());

describe('objectstack#26838 — the palette offers no app a permission set hides', () => {
  it('an app /me/apps does not list is not a "Switch app" item', async () => {
    const fetcher = meApps(['showcase_app', 'crm_app', 'account']);
    mount(fetcher);
    await waitFor(() => expect(shownApps()).toEqual(['Showcase', 'CRM', 'Account']));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('CONTROL — a 404 (no security plugin) offers every active app, as before', async () => {
    const fetcher = meApps(404);
    mount(fetcher);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(shownApps()).toEqual(['Showcase', 'CRM', 'Ops', 'Account']));
  });
});
