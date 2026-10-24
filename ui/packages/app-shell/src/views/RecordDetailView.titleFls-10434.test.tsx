/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page's title, which the breadcrumb, the favourite and the
 * "Recently Accessed" rail carry, is built from the record as the viewer may
 * read it (objectui#10434).
 *
 * `RecordDetailView` resolves that title with `getRecordDisplayName` over the
 * loaded page record. It passed the raw served row, so on a backend that does
 * not strip denied fields, a `titleFormat` token or declared `nameField` the
 * policy denies printed in the breadcrumb while the field's row was hidden on
 * the page. The title is now resolved from the row with the denied fields
 * removed (`id` kept), so the resolver falls through to its next rung, the
 * title ObjectStack's `FieldMasker` row already yields.
 *
 * What is pinned, against the real `PermissionProvider` and the real
 * `NavigationProvider` the breadcrumb reads:
 *
 *  - a denied `titleFormat` token or declared `nameField` never reaches the
 *    published title, which falls through to the derived `name` field;
 *  - CONTROLS: a loaded policy denying a field the title does not read, and
 *    no provider at all (`isLoaded` false), publish the served row's title.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
// Orthogonal chrome — this file observes the published record title only.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';
import { NavigationProvider, useNavigationContext } from '../context/NavigationContext';

const OBJECT = 'contact_10434';
const REC = 'K1';

const FIELDS = {
  id: { label: 'Id', type: 'text' },
  name: { label: 'Name', type: 'text' },
  email: { label: 'Email', type: 'text' },
  phone: { label: 'Phone', type: 'text' },
};

const RECORD = { id: REC, name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-0100' };

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
  const userRoles = ['viewer'];
  return (node) => (
    <PermissionProvider roles={[]} userRoles={userRoles} permissions={permissions as never}>
      {node}
    </PermissionProvider>
  );
}

function makeDataSource(objectDef: Record<string, unknown>) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async () => ({ ...RECORD })),
    create: vi.fn(async (_o: string, row: any) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async () => objectDef,
  } as Record<string, any>;
}

function makeMetadata() {
  const pages: any[] = [];
  return {
    objects: [], pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null,
    getItemsByType: () => pages,
  } as any;
}

/** Every record title the page published to the breadcrumb, in order. */
function TitleProbe({ seen }: { seen: Array<string | undefined> }) {
  const { recordTitle } = useNavigationContext();
  if (seen[seen.length - 1] !== recordTitle) seen.push(recordTitle);
  return <span data-testid="crumb-title">{recordTitle ?? ''}</span>;
}

/**
 * Mount the standalone record page (not embedded: an embedded page leaves the
 * breadcrumb to its host) and wait for the title it publishes to settle on
 * `expected`. Returns every title it published on the way.
 */
async function publishedTitles(
  objectSchema: Record<string, unknown>,
  wrap: Wrap,
  expected: string,
): Promise<Array<string | undefined>> {
  const objectDef = { name: OBJECT, label: 'Contact', managedBy: 'platform', fields: FIELDS, ...objectSchema };
  const ds = makeDataSource(objectDef);
  const seen: Array<string | undefined> = [];
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT}/${REC}`]}>
      <MetadataCtx.Provider value={makeMetadata()}>
        <NavigationProvider>
          {wrap(
            <RecordDetailView
              dataSource={ds as never}
              objects={[objectDef] as never}
              onEdit={() => {}}
              objectNameOverride={OBJECT}
              recordIdOverride={REC}
            />,
          )}
          <TitleProbe seen={seen} />
        </NavigationProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector('[data-testid="crumb-title"]')?.textContent).toBe(expected));
  return seen;
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  // Unrelated chrome (approvals, row-level verdicts) reaches for the platform
  // API; happy-dom would resolve those relative URLs to a real socket, which
  // the repo's network-escape guard fails the file for (objectui#6640). Serve
  // them from a double: none of it is what this file observes.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true, data: [] }),
    text: async () => '{}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RecordDetailView — the published record title reads only the fields the viewer may read (#10434)', () => {
  it('a denied `titleFormat` token never reaches the breadcrumb; the title falls through to `name`', async () => {
    const seen = await publishedTitles({ titleFormat: '{email}' }, denying('email'), 'Ada Lovelace');
    expect(seen).not.toContain('ada@example.com');
  });

  it('a denied declared `nameField` never reaches the breadcrumb; the title falls through to `name`', async () => {
    const seen = await publishedTitles({ nameField: 'email' }, denying('email'), 'Ada Lovelace');
    expect(seen).not.toContain('ada@example.com');
  });

  it('CONTROL — a loaded policy denying a field the title does not read publishes the served row’s title', async () => {
    await publishedTitles({ titleFormat: '{email}' }, denying('phone'), 'ada@example.com');
  });

  it('CONTROL — with no provider nothing is filtered, and the served row’s title is published', async () => {
    await publishedTitles({ titleFormat: '{email}' }, bare, 'ada@example.com');
  });
});
