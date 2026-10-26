/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#6730 — what the bell's Activity tab and Home's card actually
 * receive, end to end through the shared feed.
 *
 * The pure pins live in `layout/__tests__/activityItemType-6730.test.ts`; this
 * suite is the other half, and it exists because the defect was never in the
 * table — it was in the reading `mapActivityRows` did INLINE around it. A pin
 * on a table that the producer does not call is the objectui#5896 failure mode
 * (the constructor drifting while the tables agreed), so this file asserts the
 * items the hook hands its consumers, not the map.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 *   - restore the old `: 'update'` catch-all in `mapActivityRows` ⇒ the
 *     `scheduled` and author-extended cases here go RED, and so does the
 *     warn-once case (nothing warns) — the pure suite goes red too;
 *   - keep the catch-all but leave the table in place ⇒ the pure suite stays
 *     GREEN (the table is fine, nobody reads it) and only this file goes red.
 *     That asymmetry is why both files are here.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));

/**
 * One row per branch of the reading, plus the two the card names by hand.
 * `summary` is non-blank everywhere: a blank one is a DIFFERENT rejection and
 * is pinned in the pure suite.
 */
const ACTIVITY_ROWS = [
  { id: 'r1', type: 'created', summary: 'created the lead', object_name: 'crm_lead',
    actor_name: 'Li Si', timestamp: '2026-08-20T10:00:00Z' },
  { id: 'r2', type: 'updated', summary: 'changed the stage', object_name: 'crm_lead',
    actor_name: 'Li Si', timestamp: '2026-08-20T10:01:00Z' },
  { id: 'r3', type: 'deleted', summary: 'deleted the note', object_name: 'crm_lead',
    actor_name: 'Li Si', timestamp: '2026-08-20T10:02:00Z' },
  { id: 'r4', type: 'mentioned', summary: 'mentioned you', object_name: 'crm_lead',
    actor_name: 'Li Si', timestamp: '2026-08-20T10:03:00Z' },
  // The value objectui#5878 gave the console record page and never gave this
  // surface. HotCRM's `schedule_meeting` action writes it.
  { id: 'r5', type: 'scheduled', summary: 'scheduled a meeting', object_name: 'crm_lead',
    actor_name: 'Li Si', timestamp: '2026-08-20T10:04:00Z' },
  // An author-extended value under the objectstack#11507 direction-4 ruling.
  { id: 'r6', type: 'contract_countersigned', summary: 'countersigned', object_name: 'crm_contract',
    actor_name: 'Li Si', timestamp: '2026-08-20T10:05:00Z' },
  // The `"NOW()"` sentinel: plugin-audit writes the unevaluated default
  // through on some paths, and `new Date('NOW()')` is `Invalid Date`.
  { id: 'r7', type: 'system', summary: 'ran the nightly rollup', object_name: 'crm_lead',
    actor_name: 'System', timestamp: 'NOW()', created_at: '2026-08-19T23:00:00Z' },
];

const fakeAdapter = {
  find: (object: string) =>
    object === 'sys_activity'
      ? Promise.resolve({ data: ACTIVITY_ROWS })
      : Promise.resolve({ data: [] }),
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

import { useSharedActivityFeed, __resetSharedUserFeeds, __markFirstPainted } from '../sharedUserFeeds';
import { resetUnmappedActivityTypeWarnings } from '../../layout/activityItemType';
// The feed reads only the objects an app lists (objectui#12530); these rows'
// objects are on the default roster, so the mapping is all this file sees.
import { withRoster } from './activityRoster';

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

/** Every `console.warn` this suite provokes, as text — a typed array rather
 *  than a spy handle so the assertions read as the messages they are. */
const warnings: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  resetUnmappedActivityTypeWarnings();
  warnings.length = 0;
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(' '));
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** id -> type, so a failure names the row rather than an array index. */
async function typesByRow(): Promise<Record<string, string>> {
  const { result } = renderHook(() => useSharedActivityFeed(), { wrapper: withRoster() });
  await settle();
  return Object.fromEntries(result.current.value.map((a) => [a.id, a.type]));
}

describe('objectui#6730 — the shared activity feed no longer calls everything an update', () => {
  it('gives each row the presentation its type earns', async () => {
    expect(await typesByRow()).toEqual({
      r1: 'create',
      r2: 'update',
      r3: 'delete',
      r4: 'comment',
      // Both of these were `update` before this PR — the silent widening the
      // card is filed for. A scheduled meeting is not a record update, and
      // neither is an author's countersignature.
      r5: 'system',
      r6: 'system',
      r7: 'system',
    });
  });

  it('keeps the unrecognised row rather than dropping it, and says so once', async () => {
    const { result } = renderHook(() => useSharedActivityFeed(), { wrapper: withRoster() });
    await settle();

    // A bucket, not a drop: every row that named an action and said something
    // still reaches the surface. (objectui#5840's failure mode was the drop.)
    expect(result.current.value.map((a) => a.id)).toEqual(ACTIVITY_ROWS.map((r) => r.id));

    const unmapped = result.current.value.find((a) => a.id === 'r6');
    expect(unmapped?.description).toBe('countersigned');
    expect(unmapped?.objectName).toBe('crm_contract');

    // One diagnostic, for the one value nobody has ruled on — not for
    // `scheduled` or `system`, which the table maps on purpose.
    const named = warnings.filter((m) => m.includes('sys_activity row with type'));
    expect(named).toHaveLength(1);
    expect(named[0]).toContain('contract_countersigned');
    expect(named[0]).not.toContain('"scheduled"');
  });

  it('resolves the `"NOW()"` sentinel to `created_at` on this surface', async () => {
    const { result } = renderHook(() => useSharedActivityFeed(), { wrapper: withRoster() });
    await settle();

    const nowRow = result.current.value.find((a) => a.id === 'r7');
    // The fold is behaviour-preserving: the same answer the inline copy gave,
    // now produced by the one reading this package owns. Pinned against
    // plugin-detail's folded copy value-for-value in the pure suite.
    expect(nowRow?.timestamp).toBe('2026-08-19T23:00:00Z');
    expect(nowRow?.timestamp).not.toBe('NOW()');

    // Unchanged rows keep their own timestamp — the fallback is a fallback.
    expect(result.current.value.find((a) => a.id === 'r1')?.timestamp).toBe('2026-08-20T10:00:00Z');
  });
});
