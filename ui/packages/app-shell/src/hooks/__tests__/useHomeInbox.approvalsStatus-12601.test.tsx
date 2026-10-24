// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12601 — `useHomeInbox` hands Home the approvals count WITH its
 * status, so the line under the greeting can tell an answer from a read that
 * has not answered.
 *
 * The line says "Nothing is waiting for you today" at zero. Said over a read
 * that is still in flight or has failed, that is a denial arriving dressed as
 * good news (the #4235 class), so Home states it only on `ready`. That rests on
 * this hook passing the approvals feed's own status through, which is what
 * these cases pin, over the real shared store and a stubbed `fetch`:
 *
 *   - while the approvals request is in flight: `loading`, not `ready`;
 *   - a 200 answer: `ready`, with the count;
 *   - a failed read (500): `error`, not `ready`;
 *   - a 404 (no approvals plugin on this deployment): `ready` with 0 — the
 *     store's ruled reading of a missing resource, an answer (#4235).
 *
 * The inbox and activity feeds need an adapter; none is given here, so they
 * stay `idle` and only the approvals request goes out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', email: 'u1@example.com' } }),
}));
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => null }));
vi.mock('../../utils/authToken', () => ({ bearerAuthHeaders: () => ({}) }));

import { useHomeInbox } from '../useHomeInbox';
import { __resetSharedUserFeeds, __markFirstPainted } from '../sharedUserFeeds';

/**
 * What the approvals route answers (objectui#13027): asked for a page
 * (`limit`), the first `limit` rows plus the exact `total`; unpaged, every row
 * and no `total` — the route's two shapes, so the fixture is the server's.
 */
function approvalsPage(rows: unknown[], url: string): { data: unknown[]; total?: number } {
  const limit = new URL(url, 'http://localhost').searchParams.get('limit');
  return limit == null ? { data: rows } : { data: rows.slice(0, Number(limit)), total: rows.length };
}

/** How the approvals endpoint answers this case; `pending` never settles. */
let answer: 'pending' | { status: number; ids?: string[] } = 'pending';
let requested: string[] = [];

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

beforeEach(() => {
  requested = [];
  answer = 'pending';
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      requested.push(String(url));
      if (answer === 'pending') return new Promise<Response>(() => {});
      const { status, ids = [] } = answer;
      return Promise.resolve(
        new Response(JSON.stringify(approvalsPage(ids.map((id) => ({ id })), String(url))), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
});

describe('useHomeInbox passes the approvals status through (objectui#12601)', () => {
  it('is `loading`, not `ready`, while the approvals read is in flight', async () => {
    const { result } = renderHook(() => useHomeInbox());
    await settle();
    expect(requested.some((u) => u.includes('/api/v1/approvals/requests'))).toBe(true);
    expect(result.current.pendingApprovalsStatus).toBe('loading');
    expect(result.current.pendingApprovalsCount).toBe(0);
  });

  it('is `ready` with the count once the read answers', async () => {
    answer = { status: 200, ids: ['a1', 'a2'] };
    const { result } = renderHook(() => useHomeInbox());
    await settle();
    expect(result.current.pendingApprovalsStatus).toBe('ready');
    expect(result.current.pendingApprovalsCount).toBe(2);
  });

  it('is `error`, not `ready`, when the read fails', async () => {
    answer = { status: 500 };
    const { result } = renderHook(() => useHomeInbox());
    await settle();
    expect(result.current.pendingApprovalsStatus).toBe('error');
  });

  it('a 404 — no approvals plugin here — is the store’s answer: `ready` with 0', async () => {
    answer = { status: 404 };
    const { result } = renderHook(() => useHomeInbox());
    await settle();
    expect(result.current.pendingApprovalsStatus).toBe('ready');
    expect(result.current.pendingApprovalsCount).toBe(0);
  });
});
