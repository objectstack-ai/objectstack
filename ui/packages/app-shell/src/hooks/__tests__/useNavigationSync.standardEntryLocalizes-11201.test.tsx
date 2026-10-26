/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11201 (ruling B, stage 1) — a navigation entry the platform's sync
 * writes is a STANDARD entry: it is stored with no `label`, and it still
 * renders its target's localized label, under en and under zh.
 *
 * Ruling B keeps one rule, the spec's: a present label renders verbatim, and an
 * absent one inherits its target's current label at render time, which is the
 * text that localises. So a producer that stored the target's machine name
 * would be relying on the renderer's translate-if-equal-to-name convention,
 * which B retires. This pins the other half, end to end on the real code:
 *
 *   1. the writer — `NavigationSyncEffect`, the console's one caller of the
 *      sync — stores the new dashboard's entry with NO `label` key;
 *   2. that STORED entry, handed to the sidebar's `NavigationRenderer` wired as
 *      `UnifiedSidebar` wires it (`useNavTargetLabel` plus the active
 *      `language` as `locale`, objectui#11299), under a real `I18nProvider`
 *      carrying the app's zh-CN translation bundle the way the console loads
 *      it, shows the dashboard's label in each language.
 *
 * The entry rendered is the one the writer stored, read back from the save
 * call, not a hand-written copy of what it should be.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TranslationData } from '@objectstack/spec/system';

// Module scope, never a `beforeAll` (AGENTS.md, objectui#3010).
import '@object-ui/components';
import { SidebarProvider } from '@object-ui/components';
import { MetadataCtx, AdapterCtx, type MetadataContextValue } from '@object-ui/react';
import { NavigationRenderer } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import {
  createI18n,
  I18nProvider,
  isSpecTranslationData,
  transformSpecTranslations,
  useObjectTranslation,
} from '@object-ui/i18n';
import { NavigationSyncEffect } from '../useNavigationSync';
import { __markFirstPainted } from '../sharedUserFeeds';
import { useNavTargetLabel } from '../useNavTargetLabel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/** The dashboard a user creates. Its metadata label is the en text. */
const DASHBOARD = { name: 'pipeline_health', label: 'Pipeline Health' };

/**
 * The app's zh-CN bundle, as the server serves it. `objects` is there because
 * `isSpecTranslationData` keys off it, as the console's loader does.
 */
const ZH_CN: TranslationData = {
  objects: { account: { label: '客户' } },
  dashboards: { pipeline_health: { label: '管道健康' } },
} as TranslationData;

const crm = { name: 'crm', label: 'CRM', navigation: [] as NavigationItem[] };

function metaValue(dashboards: unknown[]): MetadataContextValue {
  return {
    apps: [crm],
    objects: [],
    dashboards,
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Drive the real writer through a dashboard creation; return the entry it stored. */
async function syncedDashboardEntry(): Promise<Record<string, unknown>> {
  const saveItem = vi.fn().mockResolvedValue({});
  const adapter = { getClient: () => ({ meta: { saveItem } }) } as unknown as React.ComponentProps<
    typeof AdapterCtx.Provider
  >['value'];
  const tree = (dashboards: unknown[]) => (
    <AdapterCtx.Provider value={adapter}>
      <MetadataCtx.Provider value={metaValue(dashboards)}>
        <NavigationSyncEffect />
      </MetadataCtx.Provider>
    </AdapterCtx.Provider>
  );
  // objectui#12980 — the effect reads nothing before the console's first
  // paint; this case is about the stored entry, so it starts past it.
  __markFirstPainted();
  const { rerender, unmount } = render(tree([]));
  await flush();
  rerender(tree([DASHBOARD]));
  await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
  unmount();
  const [type, name, schema] = saveItem.mock.calls[0];
  expect([type, name]).toEqual(['app', 'crm']);
  const navigation = (schema as { navigation: Record<string, unknown>[] }).navigation;
  expect(navigation).toHaveLength(1);
  return navigation[0];
}

/** An i18next instance in `language`, loaded with the zh-CN bundle the way the console loads it. */
function i18nIn(language: string) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  const raw = ZH_CN as Record<string, unknown>;
  expect(isSpecTranslationData(raw)).toBe(true);
  instance.addResourceBundle('zh-CN', 'translation', transformSpecTranslations(raw), true, true);
  return instance;
}

/** The sidebar surface, wired the way `UnifiedSidebar` wires `NavigationRenderer`. */
function Sidebar({ items }: { items: NavigationItem[] }) {
  const { language } = useObjectTranslation();
  const resolveTargetLabel = useNavTargetLabel();
  return (
    <SidebarProvider defaultOpen>
      <nav aria-label="Sidebar">
        <NavigationRenderer
          items={items}
          basePath="/apps/crm"
          resolveTargetLabel={resolveTargetLabel}
          locale={language}
        />
      </nav>
    </SidebarProvider>
  );
}

function renderSidebar(entry: Record<string, unknown>, language: string) {
  render(
    <I18nProvider instance={i18nIn(language)} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/crm']}>
        <MetadataCtx.Provider value={metaValue([DASHBOARD])}>
          <Sidebar items={[entry as unknown as NavigationItem]} />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
  return within(screen.getByRole('navigation', { name: 'Sidebar' }));
}

let stored: Record<string, unknown>;

beforeAll(async () => {
  stored = await syncedDashboardEntry();
  cleanup();
});

describe('objectui#11201 — a synced standard entry is stored label-less and renders its target’s localized label', () => {
  it('the sync stores the new dashboard’s entry with NO `label` key (not the machine name, not `\'\'`)', () => {
    expect(stored).toMatchObject({ type: 'dashboard', dashboardName: 'pipeline_health' });
    expect(stored).not.toHaveProperty('label');
  });

  it('under en, the stored entry renders the dashboard’s label', () => {
    const sidebar = renderSidebar(stored, 'en');
    expect(sidebar.getByRole('link', { name: 'Pipeline Health' })).toBeInTheDocument();
    expect(sidebar.queryByText('pipeline_health')).toBeNull();
    cleanup();
  });

  it('under zh-CN, the stored entry renders the dashboard’s zh label from the app bundle', () => {
    const sidebar = renderSidebar(stored, 'zh-CN');
    expect(sidebar.getByRole('link', { name: '管道健康' })).toBeInTheDocument();
    expect(sidebar.queryByText('Pipeline Health')).toBeNull();
    cleanup();
  });
});
