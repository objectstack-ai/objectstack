/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12530 — the bell's Activity tab and Home's activity card read
 * business activity only.
 *
 * Measured on HotCRM after a fresh seed: the feed opened on 「Created JWKS Key」,
 * two 「Created Data Migration "adr-0104-…"」 rows and the admin's own
 * 「Updated User」 sign-in stamp, ahead of any lead. The read was
 * `find('sys_activity', top 20)` with no object filter.
 *
 * The feed now reads the objects the user's apps list — derived from the app
 * list and the sidebar's member gates, never a hand-written name list — as an
 * `object_name` `$in` filter IN THE QUERY, so `$top` counts business rows. A
 * sign-in stamp on `sys_user` is dropped even when an app lists `sys_user`.
 *
 * The fake adapter answers the filter the way the server does, over a table
 * holding the measured platform rows beside the business ones.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { appListing, rosterRegistry, withRoster } from './activityRoster';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_admin' } }),
}));

const at = (minute: number) => `2026-10-15T14:${String(minute).padStart(2, '0')}:00Z`;

/** The sign-in stamp as plugin-audit writes it: `metadata` is the JSON diff. */
const LOGIN_ROW = {
  id: 'a_login',
  type: 'updated',
  summary: 'Updated User "Dev Admin"',
  object_name: 'sys_user',
  record_id: 'u_admin',
  actor_name: 'Dev Admin',
  timestamp: at(59),
  metadata: JSON.stringify({ old: { last_login_at: null }, new: { last_login_at: at(59), last_login_ip: '10.0.0.1' } }),
};

/** An admin editing a user record: a real change, not a sign-in. */
const USER_EDIT_ROW = {
  id: 'a_user_edit',
  type: 'updated',
  summary: 'Updated User "Li Si"',
  object_name: 'sys_user',
  record_id: 'u_lisi',
  actor_name: 'Dev Admin',
  timestamp: at(58),
  metadata: JSON.stringify({ old: { name: 'Li' }, new: { name: 'Li Si' } }),
};

const TABLE = [
  LOGIN_ROW,
  { id: 'a_jwks', type: 'created', summary: 'Created JWKS Key "QdKJl6LTc2jHmOx3"', object_name: 'sys_jwks_key',
    actor_name: 'Dev Admin', timestamp: at(57) },
  { id: 'a_migration', type: 'created', summary: 'Created Data Migration "adr-0104-value-shapes"',
    object_name: 'sys_data_migration', actor_name: 'Dev Admin', timestamp: at(56) },
  USER_EDIT_ROW,
  { id: 'a_article', type: 'updated', summary: 'Owner: ∅ → Dev Admin', object_name: 'knowledge_article',
    actor_name: 'Dev Admin', timestamp: at(55) },
  { id: 'a_lead', type: 'created', summary: 'Created Lead "Acme"', object_name: 'crm_lead',
    actor_name: 'Li Si', timestamp: at(54) },
  { id: 'a_account', type: 'updated', summary: 'Stage: Prospect → Customer', object_name: 'crm_account',
    actor_name: 'Li Si', timestamp: at(53) },
];

type FindOptions = { $filter?: { object_name?: { $in?: string[] } }; $top?: number; $orderby?: unknown };

/** Every `sys_activity` read's options, so the query itself is observable. */
const reads: FindOptions[] = [];
const fakeAdapter = {
  find: (object: string, options: FindOptions = {}) => {
    if (object !== 'sys_activity') return Promise.resolve({ data: [] });
    reads.push(options);
    // The server's answer to the filter: `$in` narrows, `$top` caps after it.
    const allowed = options.$filter?.object_name?.$in;
    const rows = TABLE.filter((r) => !allowed || allowed.includes(r.object_name));
    return Promise.resolve({ data: rows.slice(0, options.$top ?? rows.length) });
  },
  // objectui#13044 — the real MetadataProvider reads an object by name through
  // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
  getObjectSchema(this: { getClient(): any }, name: string) {
    return this.getClient()
      .meta.getItem('object', name)
      .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
  },
  getClient: () => undefined,
};
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

const { useSharedActivityFeed, activityObjectRoster, isLoginStampRow, __resetSharedUserFeeds, __markFirstPainted } = await import(
  '../sharedUserFeeds'
);

/** The app-list parameter, for hand-written navigation literals. */
type RosterApps = Parameters<typeof activityObjectRoster>[0];

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

async function mountFeed(ctx: MetadataContextValue) {
  const view = renderHook(() => useSharedActivityFeed(), { wrapper: withRoster(ctx) });
  await settle();
  return view;
}

const ids = (items: Array<{ id: string }>) => items.map((a) => a.id);

beforeEach(() => {
  vi.useFakeTimers();
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  reads.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the feed reads the objects the user’s apps list, in the query (objectui#12530)', () => {
  it('a roster of two app objects ⇒ the filter names exactly those, and no sys_* row is mapped', async () => {
    const { result } = await mountFeed(
      rosterRegistry([appListing('sales', ['crm_lead']), appListing('service', ['crm_account'])]),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0].$filter).toEqual({ object_name: { $in: ['crm_account', 'crm_lead'] } });
    // `$top` rides on the filtered read: the server caps business rows.
    expect(reads[0].$top).toBe(20);
    expect(result.current.status).toBe('ready');
    expect(result.current.value.filter((a) => a.objectName.startsWith('sys_'))).toEqual([]);
    // CONTROL: the business rows show.
    expect(ids(result.current.value)).toEqual(['a_lead', 'a_account']);
  });

  it('an app the user cannot open lends the roster nothing: hidden and inactive apps are skipped', async () => {
    await mountFeed(
      rosterRegistry([
        appListing('sales', ['crm_lead']),
        { ...appListing('account', ['sys_session']), hidden: true },
        { ...appListing('retired', ['legacy_ticket']), active: false },
      ]),
    );
    expect(reads[0].$filter).toEqual({ object_name: { $in: ['crm_lead'] } });
  });

  it('an object entry the member may not read lends the roster nothing (the sidebar’s own prune)', async () => {
    const perms: MePermissionsResponse = {
      authenticated: true,
      userId: 'u_admin',
      tenantId: null,
      roles: [],
      permissionSets: [],
      objects: { sys_activity: { allowRead: true }, crm_lead: { allowRead: true } },
      fields: {},
    };
    const Roster = withRoster(rosterRegistry([appListing('sales', ['crm_lead', 'crm_account'])]));
    renderHook(() => useSharedActivityFeed(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <Roster>
          <MePermissionsProvider initialPermissions={perms}>{children}</MePermissionsProvider>
        </Roster>
      ),
    });
    await settle();
    expect(reads[0].$filter).toEqual({ object_name: { $in: ['crm_lead'] } });
  });
});

describe('the sign-in stamp is never feed material (objectui#12530)', () => {
  it('excluded even when an app lists sys_user; an edit to a user record still shows', async () => {
    const { result } = await mountFeed(
      rosterRegistry([appListing('sales', ['crm_lead']), appListing('setup', ['sys_user'])]),
    );
    expect(reads[0].$filter).toEqual({ object_name: { $in: ['crm_lead', 'sys_user'] } });
    expect(ids(result.current.value)).not.toContain('a_login');
    // CONTROL: the same object, a real change.
    expect(ids(result.current.value)).toEqual(['a_user_edit', 'a_lead']);
  });

  it.each([
    ['the stamp (JSON text)', LOGIN_ROW, true],
    ['the stamp (parsed metadata)', { ...LOGIN_ROW, metadata: { new: { last_login_at: at(1) } } }, true],
    ['a user edit', USER_EDIT_ROW, false],
    ['a stamp riding with another change',
      { ...LOGIN_ROW, metadata: JSON.stringify({ new: { last_login_at: at(1), name: 'x' } }) }, false],
    ['the stamp columns on another object', { ...LOGIN_ROW, object_name: 'crm_lead' }, false],
    ['a created sys_user row', { ...LOGIN_ROW, type: 'created' }, false],
    ['no metadata', { ...LOGIN_ROW, metadata: undefined }, false],
    ['unreadable metadata', { ...LOGIN_ROW, metadata: '{not json' }, false],
    ['an empty change', { ...LOGIN_ROW, metadata: JSON.stringify({ new: {} }) }, false],
  ])('isLoginStampRow: %s ⇒ %s', (_label, row, expected) => {
    expect(isLoginStampRow(row)).toBe(expected);
  });
});

describe('never an unfiltered read (objectui#12530)', () => {
  it('the app list not settled yet ⇒ nothing asked, nothing claimed', async () => {
    const { result } = await mountFeed(rosterRegistry([appListing('sales', ['crm_lead'])], { status: 'loading' }));
    expect(reads).toEqual([]);
    expect(result.current.status).toBe('idle');
  });

  it('an empty roster ⇒ an empty feed, answered without a request', async () => {
    const { result } = await mountFeed(rosterRegistry([appListing('home', [])]));
    expect(reads).toEqual([]);
    expect(result.current).toMatchObject({ status: 'ready', value: [] });
  });

  it('the roster is part of the feed’s identity: a new app re-reads under the new filter', async () => {
    let ctx = rosterRegistry([appListing('sales', ['crm_lead'])]);
    const { result, rerender } = renderHook(() => useSharedActivityFeed(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <MetadataCtx.Provider value={ctx}>{children}</MetadataCtx.Provider>
      ),
    });
    await settle();
    expect(ids(result.current.value)).toEqual(['a_lead']);

    ctx = rosterRegistry([appListing('sales', ['crm_lead']), appListing('service', ['crm_account'])]);
    rerender();
    await settle();
    expect(reads.map((r) => r.$filter?.object_name?.$in)).toEqual([['crm_lead'], ['crm_account', 'crm_lead']]);
    expect(ids(result.current.value)).toEqual(['a_lead', 'a_account']);
  });
});

describe('activityObjectRoster — derived from the navigation, at every depth (objectui#12530)', () => {
  const allow = {
    evaluateVisibility: () => true,
    checkPermission: () => true,
    checkCapability: () => true,
    can: () => true,
  };

  it('reads object entries in groups and areas, sorted and de-duplicated; other entry kinds name no object', () => {
    const apps = [
      {
        name: 'crm',
        navigation: [
          { id: 'g', type: 'group', label: 'Sales', children: [{ id: 'o1', type: 'object', objectName: 'crm_lead' }] },
          { id: 'd', type: 'dashboard', dashboardName: 'sales_overview' },
        ],
        areas: [{ navigation: [{ id: 'o2', type: 'object', objectName: 'crm_account' },
          { id: 'o3', type: 'object', objectName: 'crm_lead' }] }],
      },
    ];
    expect(activityObjectRoster(apps as unknown as RosterApps, allow)).toEqual(['crm_account', 'crm_lead']);
  });

  it('no app list ⇒ an empty roster', () => {
    expect(activityObjectRoster(undefined, allow)).toEqual([]);
  });
});
