/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35727 — the data page opened with an address condition (a
 * record's related tab 「↗」 lands here with `filter[account]=<id>`) draws
 * that condition ONCE: as its own 「Filtered by」 tag. The list under it still
 * filters on the condition, and draws no second, locked chip for it and no
 * 「Reset」 of its own while the reader has added nothing.
 *
 * The real `ListView` renders here — the defect lived where the two surfaces
 * meet, so a stand-in list would pin nothing.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// One answer object per hook, held for the file: the page keys its address
// conditions on `canRead`, so a fresh function every render would rebuild the
// list's schema every render and re-read the records without end — a stand-in
// artefact, not the page's behaviour (the real hooks answer stable values).
const permissionAnswers = vi.hoisted(() => ({
  permissions: {
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
  },
  fields: { canRead: () => true, canWrite: () => true, permissions: [] },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => permissionAnswers.permissions,
    useFieldPermissions: () => permissionAnswers.fields,
  };
});

const authAnswer = vi.hoisted(() => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => authAnswer,
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));
vi.mock('./CreateViewDialog', () => ({ CreateViewDialog: () => null }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({}) }));

import { I18nProvider } from '@object-ui/i18n';
// The page reaches a dynamic `import('@objectstack/lint')`; its first load is
// paid here, at collection, never inside a clocked test window.
import '@objectstack/lint';
import { ObjectDataPage } from './ObjectDataPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const h = React.createElement;
const OBJECT_NAME = 'contact_35727';
const ACCOUNT = 'account_35727';

const CONTACT = {
  name: OBJECT_NAME,
  label: 'Contact',
  managedBy: 'platform',
  fields: {
    name: { type: 'text', label: 'Name' },
    account: { type: 'lookup', label: 'Account', reference: ACCOUNT },
  },
};
const OBJECTS = [CONTACT, { name: ACCOUNT, label: 'Account', fields: { name: { type: 'text', label: 'Name' } } }];

function makeDataSource() {
  return {
    find: vi.fn(async (object: string) =>
      object === ACCOUNT
        ? { data: [{ id: 'acc_1', name: 'Globex' }], total: 1 }
        : { data: [{ id: 'c1', name: 'Ada', account: 'acc_1' }], total: 1 },
    ),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (object: string) => structuredClone(OBJECTS.find((o) => o.name === object))),
  } as any;
}

// Module constants: `I18nProvider` re-boots on a new `config` identity.
const ZH = { defaultLanguage: 'zh-Hans', detectBrowserLanguage: false };
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

function renderAt(config: typeof ZH, search: string) {
  const dataSource = makeDataSource();
  const page = h(
    MemoryRouter,
    { initialEntries: [`/apps/demo/${OBJECT_NAME}/data?${search}`] },
    h(
      Routes,
      null,
      h(Route, {
        path: '/apps/:appName/:objectName/data',
        element: h(ObjectDataPage, { dataSource, objects: OBJECTS }),
      }),
    ),
  );
  render(
    h(I18nProvider, {
      config,
      children: h(ExpressionProvider, { user: { id: 'u1', name: 'Ada', profile: 'admin' }, children: page }),
    }),
  );
  return dataSource;
}

const recordReads = (ds: { find: ReturnType<typeof vi.fn> }) =>
  ds.find.mock.calls.filter((call: unknown[]) => call[0] === OBJECT_NAME);

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('a sourced open of the data page draws each condition once (objectstack#35727)', () => {
  it.each([
    ['zh', ZH],
    ['en', EN],
  ])('%s: one page tag, no locked chip, no list Reset — and the records are still filtered', async (_lang, config) => {
    const ds = renderAt(config, 'filter[account]=acc_1');
    const row = await screen.findByTestId('list-condition-row');
    await waitFor(() => expect(recordReads(ds).length).toBeGreaterThan(0));
    await act(async () => {});

    const tags = screen.getByTestId('object-data-filter-chips');
    expect(within(tags).getAllByTestId(/^object-data-remove-filter-/)).toHaveLength(1);
    expect(screen.queryAllByTestId('view-condition-chip')).toHaveLength(0);
    expect(within(row).queryByTestId('condition-reset')).toBeNull();
    expect(JSON.stringify(recordReads(ds).at(-1)![1])).toContain('acc_1');
  });

  it('CONTROL: with no address condition there is no page tag and the list reads unfiltered', async () => {
    const ds = renderAt(EN, '');
    await screen.findByTestId('list-condition-row');
    await waitFor(() => expect(recordReads(ds).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('object-data-filter-chips')).toBeNull();
    expect(JSON.stringify(recordReads(ds).at(-1)![1])).not.toContain('acc_1');
  });
});
