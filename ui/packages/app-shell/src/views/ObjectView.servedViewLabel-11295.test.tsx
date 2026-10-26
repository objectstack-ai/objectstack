/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11295 / objectui#11336 — the object page's view tab draws a SERVED
 * view's label as served.
 *
 * ## The defect
 *
 * A view read from `/meta/view` is already translated for the request's locale,
 * and since objectstack#20731 the server keeps a published edit over the
 * packaged catalog. Every switcher tab then went through `viewLabel` with that
 * served label as the FALLBACK, so the packaged `_views.<key>.label` won it
 * back: measured on objectstack#20730, the `zh-CN` tab drew `进行中` over a
 * served `In Progress (edited-20730)`.
 *
 * ## The object document's own views (objectui#11336)
 *
 * Since objectstack#21072 (`@objectstack/spec` 17.6.0) the server translates
 * the `listViews` an OBJECT document embeds as well (`translateObject`, from
 * `objects.<object>._views.<key>`, an explicit override kept over the catalog),
 * so a tab the served `/meta/object` document carries is drawn as served too.
 *
 * ## Why not every tab
 *
 * A view only the client derived — a stack container's expansion — was
 * translated by no server, so the client bundle is that tab's only
 * translation. The tab asks the two serving reads whether they served the view
 * (`useServedViewItems`); the container tab below is the control that it still
 * translates.
 *
 * Harness: the sibling relay pins' mocks (`ObjectView.viewDescriptionRelay-7199`),
 * with the REAL `ViewTabBar`, the real `useObjectLabel` under a real
 * `I18nProvider`, and a real `MetadataCtx` carrying the `/meta/view` and
 * `/meta/object` answers.
 *
 * Directions, written before the run: the served-edit cells RED before the
 * change (the bundle answered) — for objectui#11336, the embedded-edit cells
 * RED with the object-document branch of `isServedView` removed — GREEN after;
 * the unedited-served, the no-catalogue and the container cells GREEN on both
 * sides.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      isLoaded: false,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

// The list body is not the subject: stubbed, so only the tab bar draws text.
// The stand-in draws the page's `toolbarLeading` node, where the tab strip
// rides since objectui#12440 (the list's own toolbar row).
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: { toolbarLeading?: React.ReactNode }) => <>{props.toolbarLeading ?? null}</>,
}));

// `ViewTabBar` stays REAL — it is what draws the label under test.
vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: (props: any) =>
    props.renderListView?.({
      schema: props.schema ?? {},
      dataSource: props.dataSource,
      onEdit: props.onEdit,
      className: '',
      refreshKey: 0,
    }) ?? null,
  ManageViewsDialog: () => null,
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'showcase_task';
const VIEW_ID = 'showcase_task.in_progress';
const EDITED = 'In Progress (edited-11295)';
const PACKAGED = { en: 'In Progress', 'zh-CN': '进行中' } as const;
const EMBEDDED = { en: 'My Tasks', 'zh-CN': '我的任务' } as const;
const EMBEDDED_EDITED = 'My Tasks (edited-11336)';
/** An embedded view the catalogue carries no entry for: served as authored. */
const UNCATALOGUED = 'Everything else';
const CONTAINER_VIEW_ID = 'showcase_task.board';
const CONTAINER = { authored: 'Board', en: 'Board View', 'zh-CN': '看板' } as const;

/** The packaged catalog, as the console loads it into `I18nProvider`. */
const BUNDLE = {
  en: { showcase: { objects: { showcase_task: { label: 'Task', _views: { in_progress: { label: PACKAGED.en }, mine: { label: EMBEDDED.en }, board: { label: CONTAINER.en } } } } } },
  'zh-CN': { showcase: { objects: { showcase_task: { label: '任务', _views: { in_progress: { label: PACKAGED['zh-CN'] }, mine: { label: EMBEDDED['zh-CN'] }, board: { label: CONTAINER['zh-CN'] } } } } } },
};

/**
 * The `/meta/object` answer: the object document as served, BEFORE the merge —
 * its own `listViews`, `mine` with the label the server put in and `other`,
 * which no catalogue entry translates.
 */
function servedObject(mineLabel: string) {
  return {
    name: OBJECT_NAME,
    label: 'Task',
    fields: { name: { type: 'text', label: 'Name' } },
    listViews: {
      mine: { type: 'grid', columns: ['name'], label: mineLabel },
      other: { type: 'grid', columns: ['name'], label: UNCATALOGUED },
    },
  };
}

/**
 * The two serving reads and the object as `MetadataProvider` merges them.
 *
 * `viewItem` world: the `/meta/view` answer serves one view item, merged under
 * its qualified id beside the object document's own `listViews`.
 *
 * `container` world: the `/meta/view` answer is a stack container instead, whose
 * `board` the console expands itself (`<object>.board`) — served translated by
 * neither read.
 */
function world(servedLabel: string, mineLabel: string, source: 'viewItem' | 'container') {
  const doc = servedObject(mineLabel);
  const viewItem = { name: VIEW_ID, object: OBJECT_NAME, viewKind: 'list', label: servedLabel, config: { type: 'grid', columns: ['name'] } };
  const container = { name: OBJECT_NAME, listViews: { board: { type: 'grid', columns: ['name'], label: CONTAINER.authored } } };
  const fromViews = source === 'viewItem'
    ? { [VIEW_ID]: { type: 'grid', columns: ['name'], name: VIEW_ID, label: servedLabel, isDefault: true } }
    : { [CONTAINER_VIEW_ID]: { type: 'grid', columns: ['name'], name: CONTAINER_VIEW_ID, label: CONTAINER.authored } };
  const objects = [{ ...doc, listViews: { ...fromViews, ...doc.listViews } }];
  // One array per read, as the provider's cache holds it.
  const viewAnswer = [source === 'viewItem' ? viewItem : container];
  const objectAnswer = [doc];
  const metadata = {
    apps: [],
    objects,
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'view' ? viewAnswer : type === 'object' ? objectAnswer : []),
    getTypeStatus: () => 'ready' as const,
  };
  return { objects, metadata };
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/**
 * `mineLabel` is what the object read served for `mine` — by default the
 * catalogue's translation in `language`, as the server puts it in.
 */
async function renderIn(
  language: 'en' | 'zh-CN',
  servedLabel: string,
  mineLabel: string = EMBEDDED[language],
  source: 'viewItem' | 'container' = 'viewItem',
) {
  const { objects, metadata } = world(servedLabel, mineLabel, source);
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: BUNDLE }}>
      <MetadataCtx.Provider value={metadata as any}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
          <MemoryRouter initialEntries={[`/apps/showcase_app/${OBJECT_NAME}`]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName"
                element={<ObjectView dataSource={makeDataSource()} objects={objects} onEdit={() => {}} />}
              />
            </Routes>
          </MemoryRouter>
        </ExpressionProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  // The uncatalogued embedded tab is drawn alike in every world and on both
  // sides of either change, so its arrival says the tab bar rendered — waiting
  // on a label under test would hang on a regression.
  await waitFor(() => expect(screen.getAllByText(UNCATALOGUED).length).toBeGreaterThan(0));
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const LANGUAGES = ['en', 'zh-CN'] as const;

describe('ObjectView — a served view tab is drawn as served (objectui#11295)', () => {
  it.each(LANGUAGES)('%s: a published edit renders as served, not as the packaged string', async (language) => {
    await renderIn(language, EDITED);

    expect(screen.getAllByText(EDITED).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(PACKAGED[language])).toHaveLength(0);
  });

  it.each(LANGUAGES)('%s: an unedited served view shows the translation the server put in', async (language) => {
    await renderIn(language, PACKAGED[language]);

    expect(screen.getAllByText(PACKAGED[language]).length).toBeGreaterThan(0);
  });

  it.each(LANGUAGES)('%s: control — a view only the client derived (a container expansion) is still named by the bundle', async (language) => {
    await renderIn(language, EDITED, undefined, 'container');

    expect(screen.getAllByText(CONTAINER[language]).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(CONTAINER.authored)).toHaveLength(0);
  });
});

describe('ObjectView — a tab the object document embeds is drawn as served (objectui#11336)', () => {
  it('zh-CN: the tab draws the string the object read served', async () => {
    await renderIn('zh-CN', PACKAGED['zh-CN']);

    expect(screen.getAllByText(EMBEDDED['zh-CN']).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(EMBEDDED.en)).toHaveLength(0);
  });

  it.each(LANGUAGES)('%s: a published edit the object read served renders as served, not as the packaged string', async (language) => {
    await renderIn(language, PACKAGED[language], EMBEDDED_EDITED);

    expect(screen.getAllByText(EMBEDDED_EDITED).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(EMBEDDED[language])).toHaveLength(0);
  });

  it.each(LANGUAGES)('%s: control — an embedded view with no catalogue entry keeps its authored label', async (language) => {
    await renderIn(language, PACKAGED[language]);

    // `renderIn` already waited for it; nothing else names that tab.
    expect(screen.getAllByText(UNCATALOGUED).length).toBeGreaterThan(0);
  });
});
