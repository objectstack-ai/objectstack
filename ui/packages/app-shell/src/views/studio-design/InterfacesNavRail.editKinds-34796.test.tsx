// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34796 — in Studio's navigation edit mode each entry's kind badge
 * reads the kind the navigation list tags it with (`navKindName`), not the raw
 * `type`: an object, a view (an object entry naming a kanban view), a
 * dashboard and a page. The Setup designer passes no kind names, so its badges
 * keep the raw type (the CONTROL).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';

import { AppNavCanvas } from '../metadata-admin/previews/AppNavCanvas';
import { navKindName } from './InterfacesNavRail';
// The zh rows live in the lazy `studio` namespace; resident before any case.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

afterEach(cleanup);

const METADATA = {
  apps: [],
  objects: [{ name: 'meeting', label: 'Meeting' }],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

const NAV = [
  { id: 'nav_meeting', type: 'object', label: 'Meetings', objectName: 'meeting' },
  { id: 'nav_board', type: 'object', label: 'Todo board', objectName: 'meeting', viewName: 'kanban' },
  { id: 'nav_dash', type: 'dashboard', label: 'Overview', dashboardName: 'overview' },
  { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
];

function renderCanvas(language: 'en' | 'zh', locale: string, withKindNames: boolean) {
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MetadataCtx.Provider value={METADATA as never}>
        <AppNavCanvas
          draft={{ navigation: NAV }}
          rootKey="navigation"
          onPatch={vi.fn()}
          selection={null}
          onSelectionChange={vi.fn()}
          kindLabel={
            withKindNames
              ? (item) => navKindName({ type: item.type, viewName: typeof item.viewName === 'string' ? item.viewName : undefined }, locale)
              : undefined
          }
        />
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

/** The kind badge on the card whose label is `label`. */
function badgeOf(label: string): string {
  const card = screen.getByText(label).closest('[draggable], [role="button"], li, div[class*="rounded"]') as HTMLElement;
  const badge = [...card.querySelectorAll('div, span')].find((el) => el.className.includes('h-5') && el.className.includes('px-1.5'));
  return badge?.textContent ?? '';
}

describe("Studio's navigation edit mode names each kind as the navigation list does (objectstack#34796)", () => {
  it('zh: object, view (a kanban entry), dashboard and page read 对象 / 视图 / 仪表盘 / 页面, and no badge reads `object`', () => {
    renderCanvas('zh', 'zh-CN', true);
    expect(badgeOf('Meetings')).toBe(navKindName(NAV[0], 'zh-CN'));
    expect(badgeOf('Todo board')).toBe(navKindName(NAV[1], 'zh-CN'));
    expect(badgeOf('Overview')).toBe(navKindName(NAV[2], 'zh-CN'));
    expect(badgeOf('Home')).toBe(navKindName(NAV[3], 'zh-CN'));
    expect([badgeOf('Meetings'), badgeOf('Todo board'), badgeOf('Overview'), badgeOf('Home')]).toEqual([
      '对象',
      '视图',
      '仪表盘',
      '页面',
    ]);
    expect(screen.queryByText('object', { exact: true })).toBeNull();
  });

  it('en reads the same kinds in English words', () => {
    renderCanvas('en', 'en-US', true);
    expect(badgeOf('Todo board')).toBe(navKindName(NAV[1], 'en-US'));
    expect(badgeOf('Todo board')).not.toBe('object');
  });

  it('CONTROL: without kind names (the Setup designer) the badge keeps the raw type', () => {
    renderCanvas('en', 'en-US', false);
    expect(badgeOf('Meetings')).toBe('object');
    expect(badgeOf('Todo board')).toBe('object');
  });
});
