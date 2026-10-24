/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11733 — what the object list page hands OUT names the list with the
 * object's PLURAL label, as its own title does since objectui#11696.
 *
 * The hand-off is read here from a real `ObjectView` mount inside a real
 * i18next instance booted in the language under test (the
 * `ObjectView.listTitlePlural-11696` harness):
 *
 *  - the record page's way back (`location.state.from.label`), when the open
 *    view has no label of its own. Both builders are driven: the list schema's
 *    `onNavigate` (the plugin list's row open) and the record-link bridge's
 *    `openRecord` (the grid's link column), which reach the record route by two
 *    different callbacks.
 *
 * The `zh-CN` plural differs from the `zh-CN` label on purpose, so each
 * assertion can tell which key was read. The no-plural object is the control:
 * an object that declares no plural is named by its label everywhere.
 *
 * Direction, written before the run: with the three sites put back to
 * `objectLabel`, every plural cell RED (`Project` / `项目`), the controls
 * GREEN on both sides.
 *
 * The favorite the header's star button saved was a second hand-off here. The
 * list page draws no star since objectui#12423 (the one-row header is icon,
 * title, description and actions), so what is pinned of it now is its absence.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  const perms = {
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
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
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

// The list body is a probe: two buttons that open a record through the two
// callbacks the page hands its list — the schema's `onNavigate` and the
// record-link bridge's `openRecord`.
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const { useRelatedRecordActions } = await import('@object-ui/react');
  const ListProbe = ({ schema }: { schema: { objectName: string; onNavigate: (id: string, mode: 'view') => void } }) => {
    const bridge = useRelatedRecordActions();
    return (
      <>
        <button type="button" data-testid="open-by-schema" onClick={() => schema.onNavigate('r1', 'view')} />
        <button type="button" data-testid="open-by-bridge" onClick={() => bridge?.openRecord?.(schema.objectName, 'r2')} />
      </>
    );
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    ObjectView: ListProbe,
    ViewTabBar: () => null,
    ManageViewsDialog: () => null,
  };
});

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

type Lang = 'en' | 'zh-CN';

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
};

/**
 * Each object declares one list view with NO label, so the way back has no
 * view name to use and falls back to the object's name — the case under test.
 * (With no declared view the console's own "All records" tab is the open view,
 * and its label is used instead.)
 */
const UNLABELLED_VIEW = { grid: { type: 'grid', columns: ['name'] } };

const OBJECTS = [
  { name: 'showcase_project', label: 'Project', pluralLabel: 'Projects', fields: FIELDS, listViews: UNLABELLED_VIEW },
  { name: 'showcase_note', label: 'Note', fields: FIELDS, listViews: UNLABELLED_VIEW },
];

/** The catalog as the console loads it: `zh-CN` translates both scalars. */
const BUNDLE: Record<Lang, Record<string, unknown>> = {
  en: {},
  'zh-CN': { showcase: { objects: { showcase_project: { label: '项目', pluralLabel: '项目清单' } } } },
};

/** The record route: shows the way-back label the list page handed over. */
function OriginProbe() {
  const state = useLocation().state as { from?: { label?: string } } | null;
  return <div data-testid="origin-label">{state?.from?.label ?? '(none)'}</div>;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mountList(lang: Lang, objectName: string): Promise<void> {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  i18n.addResourceBundle(lang, 'translation', BUNDLE[lang], true, true);
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${objectName}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName"
              element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
            />
            <Route path="/apps/:appName/:objectName/record/:recordId" element={<OriginProbe />} />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  // The page is up once its title is.
  await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
}

/** The way-back label the record page receives, opened through `probe`. */
async function originLabel(lang: Lang, objectName: string, probe: 'open-by-schema' | 'open-by-bridge'): Promise<string> {
  await mountList(lang, objectName);
  fireEvent.click(await screen.findByTestId(probe));
  return (await screen.findByTestId('origin-label')).textContent ?? '';
}

describe('ObjectView — the list page header draws no favorite star (objectui#12423)', () => {
  it('the header holds the title and no favorite button', async () => {
    await mountList('en', 'showcase_project');
    // Control: the header is up and titled with the plural.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Projects');
    expect(screen.queryByTestId('object-favorite-btn-showcase_project')).toBeNull();
    expect(screen.queryByRole('button', { name: /favorites/i })).toBeNull();
  });
});

describe.each(['open-by-schema', 'open-by-bridge'] as const)(
  'ObjectView — the record page\'s way back names the list with the plural, opened %s (objectui#11733)',
  (probe) => {
    it('en: "Projects"', async () => {
      expect(await originLabel('en', 'showcase_project', probe)).toBe('Projects');
    });

    it('zh-CN: the translated plural', async () => {
      expect(await originLabel('zh-CN', 'showcase_project', probe)).toBe('项目清单');
    });

    it('control: an object that declares no plural is named by its label', async () => {
      expect(await originLabel('en', 'showcase_note', probe)).toBe('Note');
    });
  },
);
