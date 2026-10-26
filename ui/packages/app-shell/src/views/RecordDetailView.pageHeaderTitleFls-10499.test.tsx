/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page's H1, drawn by `page:header`, reads the record as the viewer
 * may read it (objectui#10499).
 *
 * `PageHeaderRenderer` builds the H1 from `RecordContext.data`, and
 * `@object-ui/components` has no permission source. `RecordDetailView` handed
 * that context the raw served row, so on a backend that does not strip denied
 * fields a `titleFormat` token or declared `nameField` the policy denies
 * printed in the H1. The host now hands the page the row with the denied
 * fields removed (`id` kept), the row ObjectStack's `FieldMasker` already
 * serves, so every rung of the header's title ladder reads a denied field
 * exactly as an absent one. It is the same row the breadcrumb title reads
 * (objectui#10434).
 *
 * What is pinned, through the real record page (default composition:
 * `page:header` over `record:details`) and the real `PermissionProvider`:
 *
 *  - a denied `titleFormat` token, a denied declared `nameField` and a denied
 *    token inside a composite template never reach the H1, nor anywhere else
 *    on the page;
 *  - the interim cost objectui#10434 left open: under a denied single-field
 *    title, `record:details` hides the `name` row as the title's duplicate,
 *    and the readable name now IS the H1, so it is on screen;
 *  - CONTROLS: a loaded policy denying a field the title does not read, and no
 *    provider at all (`isLoaded` false, the objectui#10411 rule), render the
 *    served row's title.
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
// Orthogonal chrome: this file observes the page's H1 and body rows only.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';
import { NavigationProvider } from '../context/NavigationContext';

const OBJECT = 'contact_10499';
const REC = 'K1';
const EMAIL = 'ada@example.com';

const FIELDS = {
  id: { label: 'Id', type: 'text' },
  name: { label: 'Name', type: 'text' },
  email: { label: 'Email', type: 'text' },
  phone: { label: 'Phone', type: 'text' },
  city: { label: 'City', type: 'text' },
};

const RECORD = { id: REC, name: 'Ada Lovelace', email: EMAIL, phone: '555-0100', city: 'London' };

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

function makeDataSource(objectDef: Record<string, unknown>) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    // A backend that does NOT strip denied fields: the row arrives whole.
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

/** The text of every H1 on the page. */
const h1Texts = () => Array.from(document.querySelectorAll('h1')).map((h) => h.textContent ?? '');

/**
 * Mount the standalone record page and wait for its `page:header` H1 to read
 * `expected` and for `record:details` to have painted a body row (the `city`
 * value, which no case here denies or titles by).
 */
async function renderRecordPage(objectSchema: Record<string, unknown>, wrap: Wrap, expected: string) {
  const objectDef = { name: OBJECT, label: 'Contact', managedBy: 'platform', fields: FIELDS, ...objectSchema };
  const ds = makeDataSource(objectDef);
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
        </NavigationProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
  await waitFor(() => expect(h1Texts()).toEqual([expected]));
  await waitFor(() => expect(document.body.textContent).toContain('London'));
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  // Unrelated chrome (approvals, row-level verdicts) reaches for the platform
  // API; happy-dom would resolve those relative URLs to a real socket, which
  // the repo's network-escape guard fails the file for (objectui#6640).
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

describe('RecordDetailView — `page:header` builds the H1 from the fields the viewer may read (#10499)', () => {
  it('a denied `titleFormat` token never reaches the H1; the H1 falls through to `name`', async () => {
    await renderRecordPage({ titleFormat: '{email}' }, denying('email'), 'Ada Lovelace');
    expect(document.body.textContent).not.toContain(EMAIL);
  });

  it('a denied declared `nameField` never reaches the H1; the H1 falls through to `name`', async () => {
    // A withheld pointer reads as a blank one, so the resolver walks on to
    // its type-aware derivation, exactly as on a backend that strips `email`.
    await renderRecordPage({ nameField: 'email' }, denying('email'), 'Ada Lovelace');
    expect(document.body.textContent).not.toContain(EMAIL);
  });

  it('a denied token inside a composite `titleFormat` never reaches the H1', async () => {
    await renderRecordPage({ titleFormat: '{name} - {email}' }, denying('email'), 'Ada Lovelace');
    expect(document.body.textContent).not.toContain(EMAIL);
  });

  it('the interim cost of objectui#10434: the readable name is on screen under a denied single-field title', async () => {
    // `record:details` hides the row its dedupe reads as the H1's duplicate,
    // and that dedupe already read the gated row (objectui#10434). So under
    // `titleFormat: '{email}'` it hid `name` while the H1 printed the denied
    // email, and the readable name was on screen nowhere. The H1 now reads the
    // same row: it shows the name, and the hidden `name` row is its duplicate,
    // as on a backend that strips `email`. The name is on the page once, in
    // the H1; it does not come back as a body row.
    await renderRecordPage({ titleFormat: '{email}' }, denying('email'), 'Ada Lovelace');
    const text = document.body.textContent ?? '';
    expect(text.split('Ada Lovelace').length - 1).toBe(1);
    expect(text).toContain('555-0100');
  });

  it('BLAST RADIUS — every block reads the same row, so the default `record:highlights` strip stops printing a denied value too', async () => {
    // The host hands ONE row to the whole page. The default composition's
    // highlight strip gates by field only when a page opts into
    // `enforceFieldSecurity`, so on the served row it printed the denied
    // email even with no title reading it. It now reads the gated row, as it
    // reads a stripping backend's.
    await renderRecordPage({}, denying('email'), 'Ada Lovelace');
    expect(document.body.textContent).not.toContain(EMAIL);
  });

  it('CONTROL — a loaded policy denying a field the title does not read renders the served row’s title', async () => {
    await renderRecordPage({ titleFormat: '{email}' }, denying('phone'), EMAIL);
  });

  it('CONTROL — with no provider (policy not loaded) nothing is filtered, per the objectui#10411 rule', async () => {
    await renderRecordPage({ titleFormat: '{email}' }, bare, EMAIL);
  });
});
