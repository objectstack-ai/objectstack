/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12194 — the record page draws the lifecycle badge
 * (`ManagedByBadge`) for an authoring caller only.
 *
 * The record page draws the badge in its own chrome, above the page tree, so
 * no assigned page could leave it out: an end user opening a `better-auth`
 * record (the cloud workspace page's `sys_organization`) read "Identity" — in
 * zh-CN 「身份」 — a word about how the object is built. Triage ruled it an
 * authoring aid (option a): it renders only for a caller who can author
 * metadata, read through `useCanAuthorMetadata` (the server's
 * `manage_metadata` answer), and no new key.
 *
 * Measured through the real record page and the real `MePermissionsProvider`,
 * fed the `/me/permissions` answer the case names (`initialPermissions`), so the
 * chain under test is the shipped one: badge → `useCanAuthorMetadata` →
 * `usePermissions` → the provider's `hasCapabilities`.
 *
 *  - an end user (a reported set without `manage_metadata`) sees no badge;
 *  - an authoring caller sees it, naming the object's bucket;
 *  - CONTROL: an object with no `managedBy` (and one declaring `platform`)
 *    draws no badge for anyone, the author included;
 *  - the doctrine the hook keeps, read through, not changed here: a deployment
 *    whose answer carries no `systemPermissions` is unknown, fails open, and
 *    the badge draws as before.
 *
 * Every absence is read after the record has painted (its `city` value is on
 * screen), and the authoring case draws the badge in the same harness, so an
 * absence cannot pass for a page that never rendered.
 *
 * Direction, written before the run: with the gate taken out of
 * `ManagedByBadge`, the end-user case goes RED (the badge draws) and every
 * other case stays GREEN.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

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
// Orthogonal chrome: this file observes the badge and one body row only.
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

const OBJECT = 'org_12194';
const REC = 'O1';

const FIELDS = {
  id: { label: 'Id', type: 'text' },
  name: { label: 'Name', type: 'text' },
  city: { label: 'City', type: 'text' },
};

const RECORD = { id: REC, name: 'Acme Workspace', city: 'London' };

/** A `/me/permissions` answer; `systemPermissions` omitted when `held` is `undefined`. */
function answer(held: string[] | undefined): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: [],
    permissionSets: [],
    ...(held === undefined ? {} : { systemPermissions: held }),
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: {},
  };
}

/** An end user: the server reported the set, and it lacks `manage_metadata`. */
const END_USER = answer(['setup.access']);
/** An authoring caller. */
const AUTHOR = answer(['manage_metadata']);
/** A deployment whose answer carries no `systemPermissions`: unknown. */
const UNREPORTED = answer(undefined);

function makeDataSource(objectDef: Record<string, unknown>) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async () => ({ ...RECORD })),
    create: vi.fn(async (_o: string, row: Record<string, unknown>) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async () => objectDef,
  };
}

function makeMetadata() {
  const pages: unknown[] = [];
  return {
    objects: [], pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null,
    getItemsByType: () => pages,
  } as never;
}

const badges = () => Array.from(document.querySelectorAll('[data-testid="managed-by-badge"]'));

/**
 * Mount the standalone record page for an object declaring `managedBy` (none
 * when `undefined`) under the given `/me/permissions` answer, and wait for the
 * record body to paint. Returns the bucket of every badge on the page.
 */
async function badgeBuckets(managedBy: string | undefined, perms: MePermissionsResponse) {
  const objectDef = {
    name: OBJECT,
    label: 'Organization',
    fields: FIELDS,
    ...(managedBy === undefined ? {} : { managedBy }),
  };
  const ds = makeDataSource(objectDef);
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT}/${REC}`]}>
      <MetadataCtx.Provider value={makeMetadata()}>
        <NavigationProvider>
          <MePermissionsProvider initialPermissions={perms}>
            <RecordDetailView
              dataSource={ds as never}
              objects={[objectDef] as never}
              onEdit={() => {}}
              objectNameOverride={OBJECT}
              recordIdOverride={REC}
            />
          </MePermissionsProvider>
        </NavigationProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
  await waitFor(() => expect(document.body.textContent).toContain('London'));
  return badges().map((b) => b.getAttribute('data-bucket'));
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

describe('RecordDetailView — the lifecycle badge is an authoring aid (objectui#12194)', () => {
  it('an end user opening a better-auth record sees no badge', async () => {
    expect(await badgeBuckets('better-auth', END_USER)).toEqual([]);
  });

  it('an authoring caller opening the same record sees the badge, naming its bucket', async () => {
    expect(await badgeBuckets('better-auth', AUTHOR)).toEqual(['better-auth']);
  });

  it('CONTROL — an object with no managedBy draws no badge, for an authoring caller or an end user', async () => {
    expect(await badgeBuckets(undefined, AUTHOR)).toEqual([]);
    cleanup();
    expect(await badgeBuckets(undefined, END_USER)).toEqual([]);
  });

  it('CONTROL — an object declaring `platform` draws no badge, even for an authoring caller', async () => {
    expect(await badgeBuckets('platform', AUTHOR)).toEqual([]);
  });

  it('the hook’s own doctrine, unchanged: an answer with no `systemPermissions` is unknown and fails open', async () => {
    expect(await badgeBuckets('better-auth', UNREPORTED)).toEqual(['better-auth']);
  });
});
