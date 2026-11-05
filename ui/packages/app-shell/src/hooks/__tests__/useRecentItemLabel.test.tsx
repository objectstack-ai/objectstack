/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useRecentItemLabel` — each kind of recent entry is labelled by the resolver
 * the console already has for that kind, and nothing is minted (objectui#11678).
 *
 * The dashboard / page / zh-CN roads are pinned through the real Home cards in
 * `console/home/__tests__/RecentApps.labelAtRender-11678.test.tsx`; this file
 * covers the kinds Home does not list (a report) and the two kinds that carry
 * their own text.
 */

import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { useRecentItemLabel } from '../useRecentItemLabel';
import { DraftTargetLabels, useNavTargetLabel } from '../useNavTargetLabel';
import type { RecentItem } from '../../context/RecentItemsProvider';
import { recentViewId } from '../useTrackRouteAsRecent';

/**
 * The served lists, per language: the server translates what it serves under
 * the request's language, so a zh-CN session holds the zh-CN answer
 * (`MetadataProvider` remounts on a language switch and reads again).
 */
const SERVED_REPORT = { en: 'Q3 Results', 'zh-CN': '第三季度结果' } as const;

type Served = {
  reports?: unknown[];
  pages?: unknown[];
  dashboards?: unknown[];
  /** The object list as the console composes it: served objects, served views merged in. */
  objects?: unknown[];
  /** `getItemsByType`: the `/meta/view` and `/meta/object` reads as served, before the merge. */
  byType?: { view?: unknown[]; object?: unknown[] };
  /** The names-only scope read (`readObjectScope`), answered while the object list is idle. */
  scope?: { objects: unknown[]; served: unknown[]; views: unknown[] };
};

function metadata(language = 'en', served: Served = {}) {
  return {
    apps: [],
    objects: served.objects ?? [
      {
        name: 'showcase_task',
        label: 'Tasks',
        // `MetadataProvider` merges each served view into its object, keyed and
        // named by the composer's qualified name.
        listViews: { 'showcase_task.open_tasks': { name: 'showcase_task.open_tasks', label: 'Open tasks' } },
      },
    ],
    dashboards: served.dashboards ?? [],
    reports: served.reports ?? [{ name: 'q3_results', label: SERVED_REPORT[language as keyof typeof SERVED_REPORT] ?? 'Q3 Results' }],
    pages: served.pages ?? [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'view' || type === 'object' ? served.byType?.[type] : undefined) ?? [],
    getTypeStatus: (type?: string) => (served.scope && type === 'object' ? ('idle' as const) : ('ready' as const)),
    ...(served.scope
      ? { readObjectScope: () => ({ ...served.scope, missing: [], settled: true }) }
      : {}),
  };
}

/** The packaged catalog, as the console loads it from `/i18n/translations`. */
const CATALOG = {
  'zh-CN': {
    showcase: {
      reports: { q3_results: { label: '第三季度结果' } },
      pages: { welcome_tour: { label: '欢迎' } },
      dashboards: { ops_board: { label: '运营看板' } },
      objects: {
        showcase_task: { label: '任务', pluralLabel: '任务列表', _views: { open_tasks: { label: '未完成任务' } } },
        showcase_draft: { label: '草稿对象' },
      },
    },
  },
};

function wrapper(language: string, served?: Served, drafts: Array<{ type: string; name: string; label?: unknown }> = []) {
  const i18n = createI18n({ defaultLanguage: language, detectBrowserLanguage: false, resources: CATALOG });
  return ({ children }: { children: ReactNode }) => (
    <I18nProvider instance={i18n} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata(language, served) as never}>
        <DraftTargetLabels.Provider value={drafts}>{children}</DraftTargetLabels.Provider>
      </MetadataCtx.Provider>
    </I18nProvider>
  );
}

const at = '2026-10-06T09:00:00.000Z';
const REPORT: RecentItem = { id: 'report:q3_results', type: 'report', name: 'q3_results', href: '/r', visitedAt: at };

describe('useRecentItemLabel (objectui#11678)', () => {
  it('a report: its served label, in each language the server served it in', () => {
    const en = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('en') });
    expect(en.result.current(REPORT)).toBe('Q3 Results');
    const zh = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('zh-CN') });
    expect(zh.result.current(REPORT)).toBe('第三季度结果');
  });

  it('an object: its current metadata label', () => {
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('en') });
    expect(
      result.current({ id: 'object:showcase_task', type: 'object', name: 'showcase_task', href: '/o', visitedAt: at }),
    ).toBe('Tasks');
  });

  it('an item with no metadata label shows its machine name — never a titleized one', () => {
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('en') });
    expect(
      result.current({ id: 'page:welcome_tour', type: 'page', name: 'welcome_tour', href: '/p', visitedAt: at }),
    ).toBe('welcome_tour');
  });

  it('a record and a Studio metadata item show the text they carry', () => {
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('zh-CN') });
    expect(
      result.current({ id: 'record:showcase_task:t1', type: 'record', label: 'Write the brief', href: '/x', visitedAt: at }),
    ).toBe('Write the brief');
    expect(
      result.current({ id: 'metadata:object:sys_user', type: 'metadata', label: 'sys_user', href: '/m', visitedAt: at }),
    ).toBe('sys_user');
  });
});

describe('useRecentItemLabel — a Studio package (objectui#11863)', () => {
  const PKG: RecentItem = { id: 'package:com.acme.crm', type: 'package', name: 'com.acme.crm', href: '/studio/com.acme.crm', visitedAt: at };

  it('is labelled by its row in the package list the surface hands in, read on each render', () => {
    let packages = [{ id: 'com.acme.crm', name: 'Acme CRM' }];
    const { result, rerender } = renderHook(() => useRecentItemLabel({ packages }), { wrapper: wrapper('en') });
    expect(result.current(PKG)).toBe('Acme CRM');

    // A rename reaches the next render: nothing about the name was stored.
    packages = [{ id: 'com.acme.crm', name: 'Acme Sales' }];
    rerender();
    expect(result.current(PKG)).toBe('Acme Sales');
  });

  it('a package the list does not have, or a call with no list, shows the machine name, as a missing page does', () => {
    const missing = renderHook(() => useRecentItemLabel({ packages: [{ id: 'com.acme.hr', name: 'Acme HR' }] }), {
      wrapper: wrapper('en'),
    });
    expect(missing.result.current(PKG)).toBe('com.acme.crm');
    const noList = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('en') });
    expect(noList.result.current(PKG)).toBe('com.acme.crm');
  });
});

describe('useRecentItemLabel — a list view (objectui#12604)', () => {
  const view = (name: string): RecentItem => ({
    id: recentViewId('showcase_task', name),
    type: 'view',
    object: 'showcase_task',
    name,
    href: `/apps/showcase/showcase_task/view/${name}`,
    visitedAt: at,
  });

  it('is labelled with the view’s label from its object’s cached list views, on the render', () => {
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('en') });
    expect(result.current(view('showcase_task.open_tasks'))).toBe('Open tasks');
  });

  it('a view the cache does not hold (one a user saved) is drawn as the list it opens: the object’s', () => {
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('en') });
    expect(result.current(view('my_saved_view'))).toBe('Tasks');
  });
});

/**
 * objectstack#30244 — a served report, page or dashboard is named as served.
 *
 * An override (a `.custom` package's, or a published edit) renamed each one,
 * and the `/meta` read serves the new name by the server's label order for an
 * overridden item. The entry re-applied the packaged catalog's translation of
 * the old name over it, because the served label reached the catalog lookup
 * only as its fallback.
 *
 * Directions, written before the run: the renamed cells RED before the change
 * (the packaged zh-CN string), GREEN after; the not-served controls GREEN on
 * both sides.
 */
describe('useRecentItemLabel — a served report, page or dashboard is named as served (objectstack#30244)', () => {
  const item = (type: 'report' | 'page' | 'dashboard', name: string): RecentItem => ({
    id: `${type}:${name}`,
    type,
    name,
    href: `/${type}/${name}`,
    visitedAt: at,
  });
  const RENAMED = {
    reports: [{ name: 'q3_results', label: 'Quarter Review (renamed-30244)' }],
    pages: [{ name: 'welcome_tour', label: 'Getting Started (renamed-30244)' }],
    dashboards: [{ name: 'ops_board', label: 'Ops Cockpit (renamed-30244)', widgets: [] }],
  };

  it.each([
    ['report', 'q3_results', 'Quarter Review (renamed-30244)'],
    ['page', 'welcome_tour', 'Getting Started (renamed-30244)'],
    ['dashboard', 'ops_board', 'Ops Cockpit (renamed-30244)'],
  ] as const)('zh-CN: a renamed %s shows the served label, not the packaged translation', (type, name, served) => {
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('zh-CN', RENAMED) });
    expect(result.current(item(type, name))).toBe(served);
  });

  it('zh-CN: control — an item the read did not serve, or served with no label, is named by the bundle', () => {
    const { result } = renderHook(() => useRecentItemLabel(), {
      wrapper: wrapper('zh-CN', { reports: [{ name: 'q3_results' }], pages: [], dashboards: [] }),
    });
    expect(result.current(item('report', 'q3_results'))).toBe('第三季度结果');
    expect(result.current(item('page', 'welcome_tour'))).toBe('欢迎');
    expect(result.current(item('dashboard', 'ops_board'))).toBe('运营看板');
  });

  it('en: control — no served label and no catalogue entry shows the machine name', () => {
    const { result } = renderHook(() => useRecentItemLabel(), {
      wrapper: wrapper('en', { reports: [], pages: [], dashboards: [] }),
    });
    expect(result.current(item('report', 'q3_results'))).toBe('q3_results');
    expect(result.current(item('dashboard', 'ops_board'))).toBe('ops_board');
  });
});

/**
 * objectstack#30311 — a served object or list view is named as served, in the
 * sidebar's unlabelled entries (`useNavTargetLabel`) and the recent list.
 *
 * A `.custom` override renamed the object and its view, and the `/meta` read
 * serves the new names by the server's label order for an overridden item.
 * The object and view rungs re-applied the packaged catalog's translation of
 * the old names over them, because the served label reached the catalog
 * lookup only as its fallback.
 *
 * Directions, written before the run: the renamed cells RED before the change
 * (the packaged zh-CN string), GREEN after; the controls (a view the client
 * derived, an object the cache does not hold, a pending draft, en) GREEN on
 * both sides.
 */
describe('useRecentItemLabel / useNavTargetLabel — a served object or list view is named as served (objectstack#30311)', () => {
  const VIEW_ID = 'showcase_task.open_tasks';
  const RENAMED_VIEW = { name: VIEW_ID, object: 'showcase_task', label: 'Still to do (renamed-30311)' };
  // The object as served (the `/meta/object` document), and as the console
  // composes it (the served view merged into its `listViews`).
  const servedObject = (extra: Record<string, unknown> = {}) => ({ name: 'showcase_task', label: 'Work items (renamed-30311)', ...extra });
  const RENAMED: Served = {
    objects: [{ ...servedObject(), listViews: { [VIEW_ID]: RENAMED_VIEW } }],
    byType: { view: [RENAMED_VIEW], object: [servedObject()] },
  };
  const objectEntry: RecentItem = { id: 'object:showcase_task', type: 'object', name: 'showcase_task', href: '/o', visitedAt: at };
  const viewEntry: RecentItem = {
    id: recentViewId('showcase_task', VIEW_ID),
    type: 'view',
    object: 'showcase_task',
    name: VIEW_ID,
    href: `/apps/showcase/showcase_task/view/${VIEW_ID}`,
    visitedAt: at,
  };

  it('zh-CN: a renamed object shows the served label in the recent list and an unlabelled sidebar entry', () => {
    const recent = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('zh-CN', RENAMED) });
    expect(recent.result.current(objectEntry)).toBe('Work items (renamed-30311)');
    const nav = renderHook(() => useNavTargetLabel({ byName: true }), { wrapper: wrapper('zh-CN', RENAMED) });
    expect(nav.result.current({ kind: 'object', objectName: 'showcase_task' })).toBe('Work items (renamed-30311)');
  });

  it('zh-CN: a recent object row reads the served plural first', () => {
    const served: Served = { objects: [servedObject({ pluralLabel: 'All work items (renamed-30311)' })] };
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('zh-CN', served) });
    expect(result.current(objectEntry)).toBe('All work items (renamed-30311)');
  });

  it('zh-CN: a renamed served view shows the served label in the recent list and an unlabelled sidebar entry', () => {
    const recent = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('zh-CN', RENAMED) });
    expect(recent.result.current(viewEntry)).toBe('Still to do (renamed-30311)');
    const nav = renderHook(() => useNavTargetLabel({ byName: true }), { wrapper: wrapper('zh-CN', RENAMED) });
    expect(nav.result.current({ kind: 'view', objectName: 'showcase_task', viewName: 'open_tasks' })).toBe('Still to do (renamed-30311)');
  });

  it('zh-CN: by name, the served reads are the names-only scope’s own', () => {
    const scoped: Served = {
      objects: [],
      byType: { view: [], object: [] },
      scope: { objects: RENAMED.objects!, served: [servedObject()], views: [RENAMED_VIEW] },
    };
    const nav = renderHook(() => useNavTargetLabel({ byName: true }), { wrapper: wrapper('zh-CN', scoped) });
    expect(nav.result.current({ kind: 'view', objectName: 'showcase_task', viewName: 'open_tasks' })).toBe('Still to do (renamed-30311)');
    expect(nav.result.current({ kind: 'object', objectName: 'showcase_task' })).toBe('Work items (renamed-30311)');
  });

  it('zh-CN: a view the served object document embeds in its own listViews is served too', () => {
    const embedded = { [VIEW_ID]: { label: 'Still to do (renamed-30311)' } };
    const served: Served = {
      objects: [servedObject({ listViews: embedded })],
      byType: { view: [], object: [servedObject({ listViews: embedded })] },
    };
    const nav = renderHook(() => useNavTargetLabel(), { wrapper: wrapper('zh-CN', served) });
    expect(nav.result.current({ kind: 'view', objectName: 'showcase_task', viewName: VIEW_ID })).toBe('Still to do (renamed-30311)');
  });

  it('zh-CN: control — a view the client derived (no served read names it) is named by the bundle', () => {
    const derived: Served = {
      objects: [{ ...servedObject(), listViews: { [VIEW_ID]: { name: VIEW_ID, label: 'Open tasks' } } }],
      byType: { view: [], object: [servedObject()] },
    };
    const { result } = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('zh-CN', derived) });
    expect(result.current(viewEntry)).toBe('未完成任务');
  });

  it('zh-CN: control — an object the cache does not hold is named by the bundle', () => {
    const empty: Served = { objects: [], byType: { view: [], object: [] } };
    const recent = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('zh-CN', empty) });
    expect(recent.result.current(objectEntry)).toBe('任务列表');
    const nav = renderHook(() => useNavTargetLabel(), { wrapper: wrapper('zh-CN', empty) });
    expect(nav.result.current({ kind: 'object', objectName: 'showcase_task' })).toBe('任务');
  });

  it('zh-CN: control — a pending draft object’s label, which no server translated, still goes through the bundle', () => {
    const drafts = [
      { type: 'object', name: 'showcase_draft', label: 'Draft object' },
      { type: 'object', name: 'showcase_other_draft', label: 'Other draft' },
    ];
    const { result } = renderHook(() => useNavTargetLabel(), { wrapper: wrapper('zh-CN', { objects: [] }, drafts) });
    expect(result.current({ kind: 'object', objectName: 'showcase_draft' })).toBe('草稿对象');
    expect(result.current({ kind: 'object', objectName: 'showcase_other_draft' })).toBe('Other draft');
  });

  it('en: unchanged — the served object and view labels', () => {
    const recent = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('en', RENAMED) });
    expect(recent.result.current(objectEntry)).toBe('Work items (renamed-30311)');
    expect(recent.result.current(viewEntry)).toBe('Still to do (renamed-30311)');
    const plain = renderHook(() => useRecentItemLabel(), { wrapper: wrapper('en') });
    expect(plain.result.current(objectEntry)).toBe('Tasks');
    expect(plain.result.current(viewEntry)).toBe('Open tasks');
  });
});
