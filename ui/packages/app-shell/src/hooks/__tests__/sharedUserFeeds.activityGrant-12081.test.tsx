/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12081 item 8 — the shared activity feed asks `sys_activity` only of
 * a caller who may read it, and says whether its rows are an answer.
 *
 * The `403` every non-admin took on every page load is OBJECT-level:
 * objectstack's `member_default` set names `sys_activity` deliberately NOT, and
 * the server already narrows an admitted read to the rows whose record the
 * caller can open. So the feed decides from the caller's object grant BEFORE
 * asking — `usePermissions().can('sys_activity', 'read')` — the way it already
 * decides from object presence (objectui#7476).
 *
 * The risk is one-sided, as it was for presence, and so are most of the cases
 * below: a missed skip costs one refused request that now reads as `error`; a
 * wrong skip costs a caller who CAN read their feed, with no error anywhere.
 * So every uncertainty reads — no provider, and the anonymous payload — and
 * only a LOADED refusal does not.
 *
 * Real `MePermissionsProvider` with the `/auth/me/permissions` payload shape;
 * the adapter is a fake that counts its reads.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
// The feed reads only the objects an app lists (objectui#12530); `crm_lead` is
// on the default roster, so the grant is all this file varies.
import { withRoster } from './activityRoster';

/** Who is signed in — mutable so the cache-key case can switch users in one tab. */
let currentUser: { id: string } | null = { id: 'u1' };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: currentUser }),
}));

const rowFor = (who: string) => ({
  id: `act_${who}`,
  type: 'updated',
  summary: `updated a record ${who} can open`,
  object_name: 'crm_lead',
  record_id: `lead_${who}`,
  actor_name: 'Li Si',
  timestamp: '2026-10-10T08:00:00Z',
});

/** Every `sys_activity` read, tagged with the user signed in when it went out. */
const reads: string[] = [];
/** When set, the `sys_activity` read rejects with it instead of answering. */
let readError: unknown = null;
const fakeAdapter = {
  find: (object: string) => {
    if (object !== 'sys_activity') return Promise.resolve({ data: [] });
    const who = currentUser?.id ?? 'anonymous';
    reads.push(who);
    // The server narrows the rows per caller, so each user gets their own.
    return readError ? Promise.reject(readError) : Promise.resolve({ data: [rowFor(who)] });
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

const { useSharedActivityFeed, __resetSharedUserFeeds, __markFirstPainted } = await import('../sharedUserFeeds');

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

const payload = (over: Partial<MePermissionsResponse>): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u1',
  tenantId: null,
  roles: [],
  permissionSets: [],
  objects: {},
  fields: {},
  ...over,
});

/** `member_default` as it ships: the two inbox reads, no wildcard, no `sys_activity`. */
const MEMBER = payload({
  permissionSets: ['member_default'],
  objects: {
    sys_inbox_message: { allowRead: true },
    sys_notification_receipt: { allowRead: true },
  },
});

/** Mount the feed under these permissions — or under no provider at all. */
async function mountFeed(perms: MePermissionsResponse | null) {
  const Roster = withRoster();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Roster>
      {perms ? <MePermissionsProvider initialPermissions={perms}>{children}</MePermissionsProvider> : children}
    </Roster>
  );
  const view = renderHook(() => useSharedActivityFeed(), { wrapper });
  await settle();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  reads.length = 0;
  readError = null;
  currentUser = { id: 'u1' };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('a loaded refusal sends nothing, and says so (objectui#12081)', () => {
  it('a member whose sets name no sys_activity: no request, readable false, and no answer claimed', async () => {
    const { result } = await mountFeed(MEMBER);
    expect(reads).toEqual([]);
    expect(result.current.readable).toBe(false);
    // Not `ready`: nothing was asked, so nothing is asserted about the rows.
    expect(result.current.status).toBe('idle');
  });

  it('an explicit allowRead false on sys_activity is a refusal, whatever the wildcard says', async () => {
    const { result } = await mountFeed(
      payload({ objects: { '*': { allowRead: true }, sys_activity: { allowRead: false } } }),
    );
    expect(reads).toEqual([]);
    expect(result.current.readable).toBe(false);
  });
});

describe('every uncertainty still reads — a wrong skip is the expensive mistake (objectui#12081)', () => {
  it('a caller holding the grant reads and gets the rows (the control)', async () => {
    const { result } = await mountFeed(payload({ objects: { sys_activity: { allowRead: true }, crm_lead: { allowRead: true } } }));
    expect(reads).toEqual(['u1']);
    expect(result.current).toMatchObject({ readable: true, status: 'ready' });
    expect(result.current.value.map((a) => a.id)).toEqual(['act_u1']);
  });

  it('no permission provider at all (a standalone embed) ⇒ unchanged behaviour', async () => {
    const { result } = await mountFeed(null);
    expect(reads).toEqual(['u1']);
    expect(result.current.readable).toBe(true);
  });

  it('the anonymous payload (no resolvable permissions by design) ⇒ reads', async () => {
    const { result } = await mountFeed(payload({ authenticated: false, userId: null }));
    expect(reads).toEqual(['u1']);
    expect(result.current.readable).toBe(true);
  });
});

describe('a read that is refused anyway is not an empty feed (objectui#12081)', () => {
  it('a 403 under a grant the client believed (stale) reads as error, never ready', async () => {
    readError = Object.assign(new Error("operation 'find' on object 'sys_activity' is not permitted"), {
      httpStatus: 403,
      code: 'PERMISSION_DENIED',
    });
    const { result } = await mountFeed(payload({ objects: { sys_activity: { allowRead: true }, crm_lead: { allowRead: true } } }));
    expect(reads).toEqual(['u1']);
    expect(result.current).toMatchObject({ readable: true, status: 'error', value: [] });
  });
});

describe("the next user in the tab is not served the previous user's rows (objectui#12081)", () => {
  it('re-keys on the signed-in user: no cached rows cross a sign-in, and the new caller is asked', async () => {
    // A sign-out keeps the SPA — and this module-level store — running, and the
    // server narrows these rows per caller, so an adapter-only key served the
    // first user's rows to the second inside the 30s freshness window.
    const first = await mountFeed(null);
    expect(first.result.current.value.map((a) => a.id)).toEqual(['act_u1']);
    first.unmount();

    currentUser = { id: 'u2' };
    const second = renderHook(() => useSharedActivityFeed(), { wrapper: withRoster() });
    // Before the second read lands: nothing of u1's on screen.
    expect(second.result.current.value.map((a) => a.id)).not.toContain('act_u1');
    await settle();
    expect(reads).toEqual(['u1', 'u2']);
    expect(second.result.current.value.map((a) => a.id)).toEqual(['act_u2']);
  });
});
