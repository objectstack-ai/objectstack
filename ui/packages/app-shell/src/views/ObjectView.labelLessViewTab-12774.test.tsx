/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12774 — a view stored with no `label` is named by its object's
 * plural label, never by its qualified name.
 *
 * ## The defect
 *
 * The spec declares a view's `label` optional with no default, and since
 * objectstack PR #24013 the server no longer invents one from the view's
 * `name`. `viewTabLabel` fell back to `view.name || view.id`, so a label-less
 * view's tab drew the machine name: measured on objectstack#23967, the only
 * tab of `/_console/apps/com.example.showcase/recheck_gate` read
 * `recheck_gate.default` under a header reading "QA Gates".
 *
 * ## The rule
 *
 * A label-less view is called what a list of the object's records is called —
 * `objectPluralLabel`, the same string the record page's way back already
 * falls back to (objectui#11733), so the tab and the link agree. A catalogue
 * entry for the view (`_views.<key>.label`) still names a view only the client
 * derived; a served view's label is still drawn as served (objectui#11295).
 *
 * Harness: `ObjectView.servedViewLabel-11295`'s, with the REAL `ViewTabBar`,
 * the real `useObjectLabel` under a real `I18nProvider`, and a real
 * `MetadataCtx` carrying the `/meta/view` and `/meta/object` answers. Each tab
 * is read through its own frame (`data-view-tab-frame`), since the page header
 * draws the plural label too.
 *
 * Directions, written before the run: the label-less cells RED before the
 * change (the tab drew the qualified name or the bare key), GREEN after; the
 * authored-label and catalogue-translated controls GREEN on both sides.
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

const OBJECT_NAME = 'recheck_gate';
const PLURAL = { en: 'QA Gates', 'zh-CN': '质检关卡' } as const;
/** The served `/meta/view` item, stored with no `label`. */
const DEFAULT_VIEW_ID = 'recheck_gate.default';
/** An entry the served object document embeds with no `label`. */
const EMBEDDED_KEY = 'pending';
/** An entry the served object document embeds with an authored label. */
const AUTHORED = 'Everything else';
/** A stack container's expansions — derived by the client, served by no read. */
const BARE_VIEW_ID = 'recheck_gate.board';
const CATALOGUED_VIEW_ID = 'recheck_gate.timeline';
const CATALOGUED = { en: 'Timeline', 'zh-CN': '时间线' } as const;

/** The packaged catalog, as the console loads it into `I18nProvider`. */
const BUNDLE = {
  en: { showcase: { objects: { recheck_gate: { label: 'QA Gate', pluralLabel: PLURAL.en, _views: { timeline: { label: CATALOGUED.en } } } } } },
  'zh-CN': { showcase: { objects: { recheck_gate: { label: '质检关', pluralLabel: PLURAL['zh-CN'], _views: { timeline: { label: CATALOGUED['zh-CN'] } } } } } },
};

/** The `/meta/object` answer, BEFORE the merge: its own `listViews`. */
function servedObject() {
  return {
    name: OBJECT_NAME,
    label: 'QA Gate',
    pluralLabel: 'QA Gates',
    fields: { name: { type: 'text', label: 'Name' } },
    listViews: {
      [EMBEDDED_KEY]: { type: 'grid', columns: ['name'] },
      other: { type: 'grid', columns: ['name'], label: AUTHORED },
    },
  };
}

/**
 * `viewItem` world: the `/meta/view` answer serves one label-less view item,
 * merged under its qualified id beside the object document's own `listViews`.
 *
 * `container` world: the `/meta/view` answer is a stack container whose two
 * entries the console expands itself — `board` with no label and no catalogue
 * entry, `timeline` with no label and a catalogue entry.
 */
function world(source: 'viewItem' | 'container') {
  const doc = servedObject();
  const viewItem = { name: DEFAULT_VIEW_ID, object: OBJECT_NAME, viewKind: 'list', config: { type: 'grid', columns: ['name'] } };
  const container = {
    name: OBJECT_NAME,
    listViews: { board: { type: 'grid', columns: ['name'] }, timeline: { type: 'grid', columns: ['name'] } },
  };
  const fromViews = source === 'viewItem'
    ? { [DEFAULT_VIEW_ID]: { type: 'grid', columns: ['name'], name: DEFAULT_VIEW_ID, isDefault: true } }
    : {
        [BARE_VIEW_ID]: { type: 'grid', columns: ['name'], name: BARE_VIEW_ID },
        [CATALOGUED_VIEW_ID]: { type: 'grid', columns: ['name'], name: CATALOGUED_VIEW_ID },
      };
  const objects = [{ ...doc, listViews: { ...fromViews, ...doc.listViews } }];
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

async function renderIn(language: 'en' | 'zh-CN', source: 'viewItem' | 'container') {
  const { objects, metadata } = world(source);
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
  // The authored tab is drawn alike in every world and on both sides of the
  // change, so its arrival says the tab bar rendered.
  await waitFor(() => expect(tabText('other')).toBe(AUTHORED));
}

/** The text one view's tab frame draws. */
function tabText(viewId: string): string | null {
  const frame = document.querySelector(`[data-view-tab-frame="${viewId}"]`);
  return frame ? (frame.textContent ?? '').trim() : null;
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

describe('ObjectView — a view stored with no label is named by the object (objectui#12774)', () => {
  it.each(LANGUAGES)('%s: a served view item with no label reads the plural label, not its qualified name', async (language) => {
    await renderIn(language, 'viewItem');

    expect(tabText(DEFAULT_VIEW_ID)).toBe(PLURAL[language]);
    expect(screen.queryAllByText(DEFAULT_VIEW_ID)).toHaveLength(0);
  });

  it.each(LANGUAGES)('%s: an embedded view with no label reads the plural label, not its key', async (language) => {
    await renderIn(language, 'viewItem');

    expect(tabText(EMBEDDED_KEY)).toBe(PLURAL[language]);
  });

  it.each(LANGUAGES)('%s: a client-derived view with no label and no catalogue entry reads the plural label', async (language) => {
    await renderIn(language, 'container');

    expect(tabText(BARE_VIEW_ID)).toBe(PLURAL[language]);
    expect(screen.queryAllByText(BARE_VIEW_ID)).toHaveLength(0);
  });

  it.each(LANGUAGES)('%s: control — a client-derived view the catalogue names keeps the catalogue label', async (language) => {
    await renderIn(language, 'container');

    expect(tabText(CATALOGUED_VIEW_ID)).toBe(CATALOGUED[language]);
  });

  it.each(LANGUAGES)('%s: control — an authored label is drawn as authored', async (language) => {
    await renderIn(language, 'viewItem');

    expect(tabText('other')).toBe(AUTHORED);
  });
});
