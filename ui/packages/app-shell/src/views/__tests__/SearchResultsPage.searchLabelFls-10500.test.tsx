/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The full-page search (`/apps/:app/search?q=`) labels a record hit from the
 * record as the viewer may READ it (objectui#10500).
 *
 * `useRecordSearch` labels each hit with `getRecordDisplayName`. It used to be
 * handed the raw served row, so on a backend that does not strip denied
 * fields, a `titleFormat` token or declared `nameField` the loaded policy
 * denies printed as the hit's label. The hook now removes the denied fields
 * (`id` kept) before any resolver reads the row, when the caller passes the
 * policy, and this page passes `usePermissions()`. The resolver then falls
 * through to its next rung, the label ObjectStack's `FieldMasker` row already
 * yields.
 *
 * Unlike `SearchResultsPage.records.test.tsx`, which stubs the hook to cover
 * the page's layout, this file runs the REAL `useRecordSearch` under the real
 * `PermissionProvider`, over both of the hook's data paths (the per-object
 * `find` fanout, and `searchAll` hits that carry the record but no server
 * title):
 *
 *  - a denied `titleFormat` token or `nameField` never reaches the DOM, and the
 *    label falls through to the derived `name` field;
 *  - CONTROLS: a loaded policy denying a field the label does not read, and no
 *    provider at all (`isLoaded` false), print the served row's label.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdapterCtx, MetadataCtx } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { SearchResultsPage } from '../SearchResultsPage';

const OBJECT = 'contact_10500';
const REC = 'K1';
const DENIED_VALUE = 'ada@example.com';

const FIELDS = {
  name: { label: 'Name', type: 'text' },
  email: { label: 'Email', type: 'text' },
  phone: { label: 'Phone', type: 'text' },
};

const RECORD = { id: REC, name: 'Ada Lovelace', email: DENIED_VALUE, phone: '555-0100' };

type Wrap = (node: React.ReactElement) => React.ReactElement;
const bare: Wrap = (node) => node;

/** The real role-based provider, denying the named fields of the object to `viewer`. */
function denying(...fields: string[]): Wrap {
  const permissions = [
    {
      object: OBJECT,
      roles: {
        viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
      },
    },
  ];
  return (node) => (
    <PermissionProvider roles={[]} userRoles={['viewer']} permissions={permissions as never}>
      {node}
    </PermissionProvider>
  );
}

/** The two data paths `useRecordSearch` labels a hit on. Neither strips a denied field. */
const ADAPTERS: Array<[string, () => Record<string, unknown>]> = [
  ['the per-object `find` fanout', () => ({ find: vi.fn(async () => ({ data: [{ ...RECORD }] })) })],
  [
    '`searchAll` hits with no server title',
    () => ({
      find: vi.fn(async () => ({ data: [] })),
      searchAll: vi.fn(async () => ({ hits: [{ object: OBJECT, id: REC, record: { ...RECORD } }] })),
    }),
  ],
];

function metadata(objectSchema: Record<string, unknown>) {
  const objects = [{ name: OBJECT, label: 'Contact', fields: FIELDS, ...objectSchema }];
  const apps = [
    {
      name: 'crm',
      label: 'CRM',
      navigation: [{ id: 'n1', type: 'object', objectName: OBJECT, label: 'Contacts' }],
    },
  ];
  return {
    apps, objects, dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null,
    getItemsByType: () => [], getTypeStatus: () => 'ready' as const,
  };
}

/** Deep-link the page with the query already in the URL, as a shared search link does. */
function mount(adapter: () => Record<string, unknown>, objectSchema: Record<string, unknown>, wrap: Wrap) {
  const META = metadata(objectSchema);
  const ds = adapter();
  render(
    wrap(
      <MemoryRouter initialEntries={['/apps/crm/search?q=ada']}>
        <AdapterCtx.Provider value={ds as never}>
          <MetadataCtx.Provider value={META as never}>
            <Routes>
              <Route path="/apps/:appName/search" element={<SearchResultsPage />} />
            </Routes>
          </MetadataCtx.Provider>
        </AdapterCtx.Provider>
      </MemoryRouter>,
    ),
  );
}

/** The label of the one record hit, once it is on screen (the hook debounces 250ms). */
async function hitLabel(): Promise<string> {
  const link = await waitFor(
    () => {
      const a = document.querySelector(`a[href="/apps/crm/${OBJECT}/record/${REC}"]`);
      if (!a) throw new Error('the record hit is not on screen yet');
      return a;
    },
    { timeout: 4000 },
  );
  return link.querySelector('p.font-medium')?.textContent ?? '';
}

afterEach(() => cleanup());

describe.each(ADAPTERS)('objectui#10500 — the search results page labels a hit from the readable row, over %s', (_path, adapter) => {
  it('a denied `titleFormat` token does not print; the label falls through to `name`', async () => {
    mount(adapter, { titleFormat: '{email}' }, denying('email'));
    expect(await hitLabel()).toBe('Ada Lovelace');
    expect(document.body.innerHTML).not.toContain(DENIED_VALUE);
  });

  it('a denied `nameField` does not print; the label falls through to `name`', async () => {
    mount(adapter, { nameField: 'email' }, denying('email'));
    expect(await hitLabel()).toBe('Ada Lovelace');
    expect(document.body.innerHTML).not.toContain(DENIED_VALUE);
  });

  it('CONTROL: a policy denying a field the label does not read prints the allowed field', async () => {
    mount(adapter, { titleFormat: '{email}' }, denying('phone'));
    expect(await hitLabel()).toBe(DENIED_VALUE);
  });

  it('CONTROL: with no provider (`isLoaded` false) the served row labels the hit', async () => {
    mount(adapter, { nameField: 'email' }, bare);
    expect(await hitLabel()).toBe(DENIED_VALUE);
  });
});
