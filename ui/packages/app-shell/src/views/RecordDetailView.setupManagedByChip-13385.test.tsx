/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13385 — a Setup record page draws no floating `ManagedByBadge`;
 * the header's object-label chip carries the badge's note instead.
 *
 * The maintainer's ruling on objectui#13385 (option B) amends objectui#12194
 * option a for Setup record pages only: inside the Setup app the record page
 * leaves the badge out of its chrome and hands the badge's tooltip title
 * (`managedByBadge.<key>.title`, under the same `useCanAuthorMetadata` gate)
 * to the header chip as `RecordContext.objectLabelNote`. Setup is read off
 * the route's `:appName` (`isSetupAppSegment`: the package id or the name).
 * Every record page outside Setup — a `sys_*` object opened in another app
 * included — keeps the badge exactly as before.
 *
 * Measured through the real record page, the real `page:header` and the real
 * `MePermissionsProvider`. Each case waits for the record body and the H1 to
 * paint, so an absence cannot pass for a page that never rendered.
 *
 * Direction, written before the run: with the Setup condition removed from
 * `RecordDetailView` (badge always drawn, no note handed over), the two Setup
 * cases go RED and the controls stay GREEN.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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

const OBJECT = 'sys_organization';
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

const badges = () =>
  Array.from(document.querySelectorAll('[data-testid="managed-by-badge"]')).map((b) =>
    b.getAttribute('data-bucket'),
  );

/** The header's object-label chip, when it carries a note: its text and its description. */
function headerNote(): { label: string | null; note: string | null } | null {
  const trigger = document.querySelector('[data-object-label-note]');
  if (!trigger) return null;
  const id = trigger.getAttribute('aria-describedby');
  return { label: trigger.textContent, note: id ? document.getElementById(id)?.textContent ?? null : null };
}

/**
 * Mount the record page under `/apps/<app>/sys_organization/record/O1` — the
 * route the console mounts it on, so the page reads `:appName` the way it does
 * in the console — for an object declaring `managedBy`, under `perms`, and
 * wait for the record body and the header's object label to paint.
 */
async function mountRecord(app: string, managedBy: string | undefined, perms: MePermissionsResponse) {
  const objectDef = {
    name: OBJECT,
    label: 'Organization',
    fields: FIELDS,
    ...(managedBy === undefined ? {} : { managedBy }),
  };
  const ds = makeDataSource(objectDef);
  render(
    <MemoryRouter initialEntries={[`/apps/${app}/${OBJECT}/record/${REC}`]}>
      <MetadataCtx.Provider value={makeMetadata()}>
        <NavigationProvider>
          <MePermissionsProvider initialPermissions={perms}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/record/:recordId"
                element={
                  <RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}} />
                }
              />
            </Routes>
          </MePermissionsProvider>
        </NavigationProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
  await waitFor(() => expect(document.body.textContent).toContain('London'));
  await waitFor(() => expect(document.querySelector('h1')?.textContent).toContain('Acme Workspace'));
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

describe('RecordDetailView — Setup record pages carry the managed-by note on the header chip (objectui#13385)', () => {
  it('a Setup sys_organization record page draws no floating badge, and its header chip carries the note', async () => {
    await mountRecord('com.objectstack.setup', 'better-auth', AUTHOR);

    expect(badges()).toEqual([]);
    expect(headerNote()).toEqual({ label: 'Organization', note: 'Managed by the identity provider' });
  });

  it('Setup addressed by its app name (`setup`) reads the same', async () => {
    await mountRecord('setup', 'better-auth', AUTHOR);

    expect(badges()).toEqual([]);
    expect(headerNote()).toEqual({ label: 'Organization', note: 'Managed by the identity provider' });
  });

  it('CONTROL — a business-app record page still draws the floating badge for an author, and no chip note', async () => {
    await mountRecord('crm', 'better-auth', AUTHOR);

    expect(badges()).toEqual(['better-auth']);
    expect(headerNote()).toBeNull();
  });

  it('CONTROL — the gate is kept: an end user in Setup sees neither the badge nor the note', async () => {
    await mountRecord('com.objectstack.setup', 'better-auth', END_USER);

    expect(badges()).toEqual([]);
    expect(headerNote()).toBeNull();
  });

  it('CONTROL — a `platform` object in Setup draws no note, as the badge draws nothing for it', async () => {
    await mountRecord('com.objectstack.setup', 'platform', AUTHOR);

    expect(badges()).toEqual([]);
    expect(headerNote()).toBeNull();
  });
});
