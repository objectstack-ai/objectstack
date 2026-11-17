/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#34740 — every object route answers an object the
 * reader cannot open with ONE sentence that neither asserts nor reveals whether
 * the object exists.
 *
 * The server leaves an object the caller cannot read out of every schema list
 * and answers a describe of it as an absent name (ruling 6787890900, amending
 * ADR-0106), so the console receives both cases as the same absence. Each
 * route's face draws `console.objectView.objectNotFoundDescription` ("does not
 * exist, or you do not have access to it"). The record route's face, the fourth,
 * is pinned in `RecordDetailView.harness.test.tsx` under the same issue number.
 *
 * Two names per route: `crm_lead`, an object the server withheld (absent from the
 * served list while a readable sibling is present), and `no_such_object`, a name
 * that exists nowhere. Both, in en and zh-CN, must read the same sentence with
 * only the name changed.
 *
 * The route cells read the sentence from the pack, so they pin which key each
 * face draws and that both names read alike; the premise cell pins the wording.
 * Measured: the create face put back on `empty.objectNotFoundDescription` reds
 * both create cells (that key is gone, so the raw key renders); the en sentence
 * put back to "does not exist in the current configuration" reds the premise
 * cell and leaves the route cells green.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

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
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null, getAuthConfig: async () => ({ features: {} }) }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));
vi.mock('./CreateViewDialog', () => ({ CreateViewDialog: () => null }));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({}) }));

/** The served list: the readable sibling only. `crm_lead` was withheld by the server. */
const READABLE = { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };
const SERVED = [READABLE];
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => ({ objects: SERVED, loading: false }) }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => null }));

import { ObjectView } from './ObjectView';
import { ObjectDataPage } from './ObjectDataPage';
import { RecordFormPage } from './RecordFormPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';

type Lang = 'en' | 'zh-CN';
const PACK: Record<Lang, 'en' | 'zh-Hans'> = { en: 'en', 'zh-CN': 'zh-Hans' };
const WITHHELD = 'crm_lead';
const MISSING = 'no_such_object';

/** The one sentence, from the pack the reader's language loads. */
function sentence(lang: Lang, objectName: string): string {
  const pack = builtInLocales[PACK[lang]] as { console: { objectView: { objectNotFoundDescription: string } } };
  return pack.console.objectView.objectNotFoundDescription.replace('{{objectName}}', objectName);
}

const dataSource = {
  find: vi.fn(async () => ({ data: [], total: 0 })),
  findOne: vi.fn(async () => null),
  create: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
  getObjectSchema: vi.fn(async () => null),
} as never;

const ROUTES = {
  list: { path: '/apps/:appName/:objectName', url: (o: string) => `/apps/crm/${o}`,
    element: () => <ObjectView dataSource={dataSource} objects={SERVED} onEdit={() => {}} /> },
  data: { path: '/apps/:appName/:objectName/data', url: (o: string) => `/apps/crm/${o}/data`,
    element: () => <ObjectDataPage dataSource={dataSource} objects={SERVED} /> },
  create: { path: '/apps/:appName/:objectName/new', url: (o: string) => `/apps/crm/${o}/new`,
    element: () => <RecordFormPage mode="create" /> },
} as const;

/** The absent-object face's text on `route` for `objectName`, in `lang`. */
async function faceText(route: keyof typeof ROUTES, lang: Lang, objectName: string): Promise<string> {
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  expect(i18n.language).toBe(lang);
  const r = ROUTES[route];
  render(
    <I18nProvider instance={i18n} persistLanguage={false}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'member' }}>
        <MemoryRouter initialEntries={[r.url(objectName)]}>
          <Routes>
            <Route path={r.path} element={r.element()} />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  const face = await screen.findByTestId('object-not-found', {}, { timeout: 5000 });
  const text = face.textContent ?? '';
  cleanup();
  return text;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('objectRouteAbsence-34740 — one neutral sentence on the list, data and create routes', () => {
  it('the premise: the sentence names both readings, in both packs, and no other face key is left', () => {
    expect(sentence('en', 'x')).toBe('The object "x" does not exist, or you do not have access to it.');
    expect(sentence('zh-CN', 'x')).toBe('对象"x"不存在，或者您无权访问它。');
    for (const pack of ['en', 'zh-Hans'] as const) {
      expect((builtInLocales[pack] as { empty: Record<string, unknown> }).empty.objectNotFoundDescription).toBeUndefined();
    }
  });

  for (const route of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
    for (const lang of ['en', 'zh-CN'] as const) {
      it(`${route} · ${lang}: a withheld object and a missing name read the same sentence`, async () => {
        const withheld = await faceText(route, lang, WITHHELD);
        const missing = await faceText(route, lang, MISSING);
        expect(withheld).toContain(sentence(lang, WITHHELD));
        expect(missing).toContain(sentence(lang, MISSING));
        // Byte-identical once the name is taken out: nothing on the face tells the two apart.
        expect(withheld.replaceAll(WITHHELD, 'NAME')).toBe(missing.replaceAll(MISSING, 'NAME'));
      });
    }
  }

  it('CONTROL: the readable sibling draws no absent-object face on the create route', async () => {
    const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    render(
      <I18nProvider instance={i18n} persistLanguage={false}>
        <MemoryRouter initialEntries={[`/apps/crm/${READABLE.name}/new`]}>
          <Routes>
            <Route path={ROUTES.create.path} element={ROUTES.create.element()} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(await screen.findByTestId('object-form')).toBeInTheDocument();
    expect(screen.queryByTestId('object-not-found')).toBeNull();
  });
});
