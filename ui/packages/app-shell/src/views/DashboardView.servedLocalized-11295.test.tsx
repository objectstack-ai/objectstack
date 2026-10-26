/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11295 — the console's dashboard page draws a SERVED dashboard as
 * served: the page header, and every widget the real `DashboardRenderer`
 * draws under it.
 *
 * `DashboardView` is where the signal is set. Its document is the `/meta`
 * read's (`useMetadata().dashboards`), already translated by the server for
 * this language, with a published edit kept over the packaged catalog. The page
 * header looked the catalog up a second time (`dashboards.<name>.label` /
 * `.description`), and the renderer did the same per widget — so a published
 * edit drew as the shipped string, in `en` as well as `zh-CN`, because the
 * platform's own `en` bundle repeats the shipped English (measured in a browser
 * on objectstack#20730).
 *
 * Harness: `DashboardView.rootTitleRetired.test.tsx`'s mocks, minus its
 * renderer stub and its `@object-ui/i18n` pass-through — the real renderer and
 * the real bundle lookup are the subject here.
 *
 * Directions, written before the run: the edited cells RED before the change
 * (the bundle answered), GREEN after; the unedited cells GREEN on both sides.
 *
 * The widget's retired sub-caption (objectui#11389, ruling C) stays in the
 * fixtures — an `options.description` on the served widget and the bundle's
 * `subCaption` entries — and every case pins that none of it draws on the
 * console page.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';

const meta = vi.hoisted(() => ({ value: null as any }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: 'system_overview' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboards/system_overview', search: '' }),
}));

vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));

import { DashboardView } from './DashboardView';

afterEach(cleanup);

/** The packaged catalog the console loads into `I18nProvider`. */
const BUNDLE = {
  en: {
    platform: {
      dashboards: {
        system_overview: {
          label: 'System Overview',
          description: 'Platform health at a glance',
          // `subCaption` is refused by the installed spec; kept to pin that it draws nothing.
          widgets: { widget_total_users: { title: 'Total Users', description: 'Active accounts', subCaption: 'Across all organizations' } },
        },
      },
    },
  },
  'zh-CN': {
    platform: {
      dashboards: {
        system_overview: {
          label: '系统概览',
          description: '平台健康一览',
          widgets: { widget_total_users: { title: '用户总数', description: '活跃账户', subCaption: '覆盖所有组织' } },
        },
      },
    },
  },
};

interface Texts {
  label: string;
  description: string;
  title: string;
  widgetDescription: string;
}

/** The retired sub-caption, authored and bundled: none of it may draw. */
const RETIRED_SUB_CAPTION = 'All orgs (edited-11295)';
const RETIRED_TEXTS = [RETIRED_SUB_CAPTION, 'Across all organizations', '覆盖所有组织'];

const EDITED: Texts = {
  label: 'Operations board (edited-11295)',
  description: 'What the ops team watches (edited-11295)',
  title: 'Total Users (edited-11295)',
  widgetDescription: 'Accounts (edited-11295)',
};

const SERVED_UNEDITED: Record<'en' | 'zh-CN', Texts> = {
  en: {
    label: 'System Overview',
    description: 'Platform health at a glance',
    title: 'Total Users',
    widgetDescription: 'Active accounts',
  },
  'zh-CN': {
    label: '系统概览',
    description: '平台健康一览',
    title: '用户总数',
    widgetDescription: '活跃账户',
  },
};

/** The `/meta/dashboard` answer for this language. */
function served(texts: Texts) {
  return {
    name: 'system_overview',
    label: texts.label,
    description: texts.description,
    widgets: [
      {
        id: 'widget_total_users',
        type: 'kpi',
        title: texts.title,
        description: texts.widgetDescription,
        options: { value: 42, description: RETIRED_SUB_CAPTION },
      },
    ],
  };
}

async function mountIn(language: 'en' | 'zh-CN', dashboard: Record<string, unknown>) {
  meta.value = {
    apps: [],
    objects: [],
    dashboards: [dashboard],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
  const { container } = render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: BUNDLE }}>
      <MetadataCtx.Provider value={meta.value as any}>
        <DashboardView />
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  // A skeleton first; the header exists once loading ends.
  await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
  return container.querySelector('h1')!;
}

describe('DashboardView — a served dashboard is drawn as served (objectui#11295)', () => {
  it.each(['en', 'zh-CN'] as const)('%s: a published edit renders as served — header and widget', async (language) => {
    const h1 = await mountIn(language, served(EDITED));

    expect(h1.textContent).toBe(EDITED.label);
    for (const text of Object.values(EDITED)) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    for (const text of Object.values(SERVED_UNEDITED[language])) expect(screen.queryByText(text)).toBeNull();
    for (const text of RETIRED_TEXTS) expect(screen.queryByText(text)).toBeNull();
  });

  it.each(['en', 'zh-CN'] as const)('%s: an unedited dashboard shows the translation the server put in', async (language) => {
    const texts = SERVED_UNEDITED[language];
    const h1 = await mountIn(language, served(texts));

    expect(h1.textContent).toBe(texts.label);
    for (const text of Object.values(texts)) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    for (const text of RETIRED_TEXTS) expect(screen.queryByText(text)).toBeNull();
  });
});
