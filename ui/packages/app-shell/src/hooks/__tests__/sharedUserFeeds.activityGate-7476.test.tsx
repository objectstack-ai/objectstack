/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7476 — a tenant environment has no `sys_activity`, so opening the
 * home page (or 系统概览) fired `GET /api/v1/data/sys_activity` and took a 404,
 * every load.
 *
 * The card offered two remedies. "Handle the absence quietly" was already done
 * — four layers of it, and none of them changes here. So this is the other
 * one: consult the object registry the shell loads anyway and DON'T ASK when
 * the environment does not declare the object.
 *
 * The risk is entirely one-sided, so the assertions are too. A missed skip
 * costs one request that already degrades correctly; a wrong skip costs a real
 * deployment its activity feed with no error anywhere. Hence four of the six
 * cases below are "still reads" — no-provider, empty registry, still-loading,
 * present — and only one is "does not read".
 *
 * The empty-registry case is the one that would actually have shipped broken:
 * `useMetadata()` outside a `<MetadataProvider>` returns a frozen no-op whose
 * `getTypeStatus` says `'ready'` and whose `getItemsByType` says `[]`, which
 * reads exactly like "the registry answered and your object is not in it".
 * Every existing test in this directory mounts the hook that way.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue, type MetadataTypeStatus } from '@object-ui/react';
import { DEFAULT_APPS } from './activityRoster';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));

const ACTIVITY_ROWS = [
  {
    id: 'r1',
    type: 'created',
    summary: 'created the lead',
    object_name: 'crm_lead',
    actor_name: 'Li Si',
    timestamp: '2026-08-20T10:00:00Z',
  },
];

/** Every `find` the hook issues, so "did not ask" is directly observable. */
const finds: string[] = [];
const fakeAdapter = {
  find: (object: string) => {
    finds.push(object);
    return Promise.resolve({ data: object === 'sys_activity' ? ACTIVITY_ROWS : [] });
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
const { objectPresence } = await import('../useObjectPresence');

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

/**
 * A metadata context that answers `object` with exactly these items/status,
 * and `app` with an app listing `crm_lead` at the same status: since
 * objectui#12530 the feed reads only the objects an app lists, so this file's
 * question (is `sys_activity` declared?) needs a roster to be asked at all.
 */
function registry(status: MetadataTypeStatus, objects: Array<{ name: string }>): MetadataContextValue {
  return {
    apps: DEFAULT_APPS,
    objects,
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => objects,
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'object' ? objects : []),
    getTypeStatus: () => status,
  } as unknown as MetadataContextValue;
}

/** Mount the feed under a given registry — or under none at all. */
async function activityReads(ctx: MetadataContextValue | null): Promise<string[]> {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    ctx ? <MetadataCtx.Provider value={ctx}>{children}</MetadataCtx.Provider> : <>{children}</>;
  renderHook(() => useSharedActivityFeed(), { wrapper });
  await settle();
  return finds.filter((o) => o === 'sys_activity');
}

const TENANT_OBJECTS = [{ name: 'crm_lead' }, { name: 'crm_account' }, { name: 'sys_user' }];
const WITH_AUDIT = [...TENANT_OBJECTS, { name: 'sys_activity' }];

beforeEach(() => {
  vi.useFakeTimers();
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  finds.length = 0;
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the activity feed does not ask for an object the environment does not declare (objectui#7476)', () => {
  it('a tenant registry without sys_activity ⇒ no request at all', async () => {
    expect(await activityReads(registry('ready', TENANT_OBJECTS))).toEqual([]);
  });

  it('the same registry WITH sys_activity ⇒ the read happens', async () => {
    expect(await activityReads(registry('ready', WITH_AUDIT))).toEqual(['sys_activity']);
  });
});

describe('every uncertainty still reads — a wrong skip is the expensive mistake (objectui#7476)', () => {
  it('no MetadataProvider at all ⇒ no app roster, so no read (objectui#12530)', async () => {
    // The frozen no-op fallback answers `ready` + `[]`. For PRESENCE that is
    // still `unknown`, never `absent` (pinned in the objectPresence cases
    // below). But it lists no app either, and since objectui#12530 the feed
    // reads only the objects an app lists: an empty roster is an empty feed,
    // never an unfiltered read of every platform write.
    expect(await activityReads(null)).toEqual([]);
  });

  it('a registry that is ready but lists NOTHING ⇒ reads', async () => {
    expect(await activityReads(registry('ready', []))).toEqual(['sys_activity']);
  });

  it('a registry that has errored ⇒ reads', async () => {
    expect(await activityReads(registry('error', []))).toEqual(['sys_activity']);
  });

  it('a registry still loading ⇒ asks nothing YET, and claims nothing', async () => {
    // Not the same as "absent": no key, so the feed has asked nothing. The
    // request arrives (or does not) when the registry answers.
    expect(await activityReads(registry('loading', []))).toEqual([]);
  });
});

describe('objectPresence — absence has to be earned (objectui#7476)', () => {
  it.each([
    ['idle' as const, [{ name: 'crm_lead' }], 'unknown'],
    ['loading' as const, [{ name: 'crm_lead' }], 'unknown'],
    ['error' as const, [{ name: 'crm_lead' }], 'unknown'],
    ['ready' as const, [], 'unknown'],
    ['ready' as const, [{ name: 'crm_lead' }], 'absent'],
    ['ready' as const, [{ name: 'sys_activity' }], 'present'],
  ])('status=%s objects=%j ⇒ %s', (status, objects, expected) => {
    expect(objectPresence('sys_activity', status, objects)).toBe(expected);
  });

  it('an absent `getTypeStatus` (hand-rolled context) reads as ready', () => {
    // The context type documents the optional member as "absent means always
    // ready"; honouring that is what lets a hand-rolled test context still gate.
    expect(objectPresence('sys_activity', undefined, [{ name: 'crm_lead' }])).toBe('absent');
    expect(objectPresence('sys_activity', undefined, [])).toBe('unknown');
  });

  it('ignores malformed registry entries rather than throwing', () => {
    expect(objectPresence('sys_activity', 'ready', [null, undefined, 'x', { name: 'sys_activity' }])).toBe(
      'present',
    );
  });
});
