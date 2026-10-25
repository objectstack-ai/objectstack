/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Recently Accessed" shows each item's OWN label, resolved when it is
 * rendered, in the current language (objectui#11678).
 *
 * The card measured /home after visiting the showcase's Delivery Operations
 * dashboard, its Team Schedule page and its Capability Map page: the list read
 * "Showcase Ops Dashboard", "Showcase Task Schedule", "Showcase Capability
 * Map" — `titleize` run over the route's machine names at visit time, stored
 * in `ui.recent`, and still English after switching to 中文.
 *
 * Driven end to end with real parts: the route tracker records the three
 * visits, the real `RecentItemsProvider` stores them, and both list surfaces
 * render them through `useRecentItemLabel` over a real
 * `MetadataCtx` and a real i18next instance: the /home rail (`HomeContinue`,
 * which `HomePage` hands the resolver as `labelOf`) and the `RecentApps` cards
 * (which call it themselves). The metadata is what the `/meta`
 * read serves in each language (the console re-reads it on a language switch,
 * `MetadataProvider key={language}`), and the zh-CN bundle carries one page
 * label, so the three entries take three different roads to their zh-CN text:
 *
 *  - the dashboard: its served label, translated by the server;
 *  - Team Schedule: its served label is English, the client bundle's
 *    `pages.<name>.label` key translates it;
 *  - Capability Map: translated nowhere — it shows its own label, which is
 *    what its own page shows, and never the minted name.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { createI18n, I18nProvider, useObjectTranslation } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, isAuthenticated: true, isLoading: false }),
}));

import { RecentApps } from '../RecentApps.js';
import { HomeContinue } from '../HomeRail.js';
import { recentItemTypeLabel } from '../recentItemTypeLabel.js';
import { useRecentItemLabel } from '../../../hooks/useRecentItemLabel.js';
import { RecentItemsProvider, useRecentItems } from '../../../context/RecentItemsProvider.js';
import { UserStateAdaptersProvider } from '../../../context/UserStateAdapters.js';
import { useTrackRouteAsRecent } from '../../../hooks/useTrackRouteAsRecent.js';

const APP = 'showcase_app';
const DASHBOARD = `/apps/${APP}/dashboard/showcase_ops_dashboard`;
const SCHEDULE = `/apps/${APP}/page/showcase_task_schedule`;
const CAPABILITY_MAP = `/apps/${APP}/page/showcase_capability_map`;

/** What the `/meta` read serves, per language — labels as the showcase authors them. */
const SERVED = {
  en: {
    dashboards: [{ name: 'showcase_ops_dashboard', label: 'Delivery Operations' }],
    pages: [
      { name: 'showcase_task_schedule', label: 'Team Schedule (Gantt)' },
      { name: 'showcase_capability_map', label: 'Capability Map' },
    ],
    objects: [{ name: 'showcase_task', label: 'Tasks' }],
  },
  'zh-CN': {
    dashboards: [{ name: 'showcase_ops_dashboard', label: '交付运营' }],
    pages: [
      { name: 'showcase_task_schedule', label: 'Team Schedule (Gantt)' },
      { name: 'showcase_capability_map', label: 'Capability Map' },
    ],
    objects: [{ name: 'showcase_task', label: '任务' }],
  },
} as const;

/** The minted text the old tracker stored — none of it may reach the screen. */
const MINTED = ['Showcase Ops Dashboard', 'Showcase Task Schedule', 'Showcase Capability Map'];

function metadata(language: keyof typeof SERVED) {
  const served = SERVED[language];
  return {
    apps: [{ name: APP, label: 'Showcase' }],
    objects: served.objects,
    dashboards: served.dashboards,
    reports: [],
    pages: served.pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
}

function newI18n() {
  return createI18n({
    defaultLanguage: 'en',
    detectBrowserLanguage: false,
    resources: {
      // The app bundle's page-label key (`useObjectLabel().pageLabel`).
      'zh-CN': { showcase: { pages: { showcase_task_schedule: { label: '团队排期' } } } },
    },
  });
}

function Visit({ pathname }: { pathname: string }) {
  useTrackRouteAsRecent({ pathname, appName: APP, objects: [...SERVED.en.objects] });
  return null;
}

function Home() {
  const { recentItems } = useRecentItems();
  return <RecentApps items={recentItems} />;
}

/** The /home rail, wired as `HomePage` wires it. */
function Rail() {
  const { recentItems } = useRecentItems();
  const { t } = useObjectTranslation();
  const labelOf = useRecentItemLabel();
  return (
    <HomeContinue
      items={recentItems}
      onOpen={() => {}}
      t={t}
      labelOf={labelOf}
      describe={(it) => ({ context: recentItemTypeLabel(t, it.type) })}
    />
  );
}

function tree(
  i18n: ReturnType<typeof newI18n>,
  language: keyof typeof SERVED,
  pathname: string,
  Surface: ComponentType = Home,
) {
  return (
    <I18nProvider instance={i18n} persistLanguage={false}>
      <MemoryRouter>
        <MetadataCtx.Provider value={metadata(language) as never}>
          <UserStateAdaptersProvider>
            <RecentItemsProvider>
              <Visit pathname={pathname} />
              <Surface />
            </RecentItemsProvider>
          </UserStateAdaptersProvider>
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>
  );
}

/** The rail's row labels, most recent first. */
function railLabels(): string[] {
  return screen
    .getAllByRole('button')
    .map((row) => (row.querySelector('span.truncate')?.textContent ?? '').trim());
}

/** The card titles, most recent first. */
function shownLabels(): string[] {
  return screen
    .getAllByTestId(/^recent-item-/)
    .map((card) => (card.querySelector('h3')?.textContent ?? '').trim());
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => cleanup());

describe('"Recently Accessed" labels each item when it is rendered (objectui#11678)', () => {
  it('the three measured pages show their own labels in en, then in zh-CN — the same stored entries', async () => {
    const i18n = newI18n();
    const view = render(tree(i18n, 'en', DASHBOARD));
    view.rerender(tree(i18n, 'en', SCHEDULE));
    view.rerender(tree(i18n, 'en', CAPABILITY_MAP));

    expect(shownLabels()).toEqual(['Capability Map', 'Team Schedule (Gantt)', 'Delivery Operations']);

    const stored = localStorage.getItem('objectui-recent-items:u:u1') ?? '';
    // Instrument check: the visits were stored, so the next read is of a real list.
    expect(stored).toContain('showcase_ops_dashboard');
    // What is stored is identity: no label of any language, and no minted text.
    for (const text of [...MINTED, 'Delivery Operations', 'Team Schedule', 'Capability Map']) {
      expect(stored).not.toContain(text);
    }

    // Switch to 中文. Nothing is re-visited: the stored list is unchanged and
    // only the render's language (and the metadata served in it) moved.
    await act(async () => {
      await i18n.changeLanguage('zh-CN');
    });
    view.rerender(tree(i18n, 'zh-CN', CAPABILITY_MAP));

    expect(shownLabels()).toEqual(['Capability Map', '团队排期', '交付运营']);
    expect(localStorage.getItem('objectui-recent-items:u:u1')).toBe(stored);
  });

  it('the /home rail shows the same labels, in en then zh-CN', async () => {
    const i18n = newI18n();
    const view = render(tree(i18n, 'en', DASHBOARD, Rail));
    view.rerender(tree(i18n, 'en', SCHEDULE, Rail));
    view.rerender(tree(i18n, 'en', CAPABILITY_MAP, Rail));
    expect(railLabels()).toEqual(['Capability Map', 'Team Schedule (Gantt)', 'Delivery Operations']);

    await act(async () => {
      await i18n.changeLanguage('zh-CN');
    });
    view.rerender(tree(i18n, 'zh-CN', CAPABILITY_MAP, Rail));
    expect(railLabels()).toEqual(['Capability Map', '团队排期', '交付运营']);
    for (const text of MINTED) expect(screen.queryByText(text)).toBeNull();
  });

  it('a list stored before the identity shape shows the items’ current labels, not the minted text', () => {
    localStorage.setItem(
      'objectui-recent-items:u:u1',
      JSON.stringify([
        { id: 'page:showcase_capability_map', label: 'Showcase Capability Map', href: CAPABILITY_MAP, type: 'page', visitedAt: '2026-10-06T09:02:00.000Z' },
        { id: 'page:showcase_task_schedule', label: 'Showcase Task Schedule', href: SCHEDULE, type: 'page', visitedAt: '2026-10-06T09:01:00.000Z' },
        { id: 'dashboard:showcase_ops_dashboard', label: 'Showcase Ops Dashboard', href: DASHBOARD, type: 'dashboard', visitedAt: '2026-10-06T09:00:00.000Z' },
        // Renamed since the visit: the stored "Task" is stale, the object is "Tasks" now.
        { id: 'object:showcase_task', label: 'Task', href: `/apps/${APP}/showcase_task`, type: 'object', visitedAt: '2026-10-06T08:59:00.000Z' },
      ]),
    );
    // `/home` — the tracker records nothing here.
    render(tree(newI18n(), 'en', '/home'));

    expect(shownLabels()).toEqual(['Capability Map', 'Team Schedule (Gantt)', 'Delivery Operations', 'Tasks']);
    for (const text of MINTED) expect(screen.queryByText(text)).toBeNull();
  });

  it('an item whose metadata has not loaded shows its machine name, then its label once it arrives', () => {
    const i18n = newI18n();
    const empty = { ...metadata('en'), dashboards: [], pages: [] };
    const ui = (value: unknown) => (
      <I18nProvider instance={i18n} persistLanguage={false}>
        <MemoryRouter>
          <MetadataCtx.Provider value={value as never}>
            <UserStateAdaptersProvider>
              <RecentItemsProvider>
                <Visit pathname={DASHBOARD} />
                <Home />
              </RecentItemsProvider>
            </UserStateAdaptersProvider>
          </MetadataCtx.Provider>
        </MemoryRouter>
      </I18nProvider>
    );
    const view = render(ui(empty));
    // The navigation renderer's backstop, not a titleized guess.
    expect(shownLabels()).toEqual(['showcase_ops_dashboard']);

    view.rerender(ui(metadata('en')));
    expect(shownLabels()).toEqual(['Delivery Operations']);
  });
});
