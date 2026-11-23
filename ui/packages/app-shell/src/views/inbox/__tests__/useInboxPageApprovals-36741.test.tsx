// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inbox page's approvals read (objectstack#36741). What these pin:
 *  - it reads the waiting requests, and again when the shared count moves;
 *  - a write on `sys_approval_request` (a decision in the right pane) asks the
 *    shared feed to read again, ONCE per write: a later re-read for another
 *    reason (the shared count moving because of that very refresh) does not
 *    ask again, so the two reads cannot feed each other.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const bus = vi.hoisted(() => ({ nonce: 0 }));
const feeds = vi.hoisted(() => ({
  fetchPage: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', email: 'u1@example.com' } }),
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDataInvalidation: () => bus.nonce,
}));
vi.mock('../../../hooks/sharedUserFeeds.js', () => ({
  approverIdentities: () => ['u1'],
  fetchPendingApprovalPage: (...args: unknown[]) => feeds.fetchPage(...args),
  refreshSharedPendingApprovals: () => feeds.refresh(),
}));

import { useInboxPageApprovals } from '../useInboxPageApprovals';

const page = (ids: string[]) => ({
  status: 'ok' as const,
  page: { requests: ids.map((id) => ({ id, processLabel: 'P', recordTitle: id, createdAt: '', row: { id } })), total: ids.length },
});

beforeEach(() => {
  bus.nonce = 0;
  feeds.fetchPage.mockReset();
  feeds.refresh.mockReset();
  feeds.fetchPage.mockResolvedValue(page(['r1', 'r2']));
});
afterEach(() => cleanup());

describe('useInboxPageApprovals (objectstack#36741)', () => {
  it('reads the waiting requests, and again when the shared count moves', async () => {
    const view = renderHook(({ total }) => useInboxPageApprovals(total), { initialProps: { total: 2 } });
    await act(async () => {});
    expect(view.result.current).toMatchObject({ total: 2, status: 'ready' });
    expect(feeds.fetchPage).toHaveBeenCalledTimes(1);
    feeds.fetchPage.mockResolvedValue(page(['r2']));
    view.rerender({ total: 1 });
    await act(async () => {});
    expect(feeds.fetchPage).toHaveBeenCalledTimes(2);
    expect(view.result.current.requests.map((r) => r.id)).toEqual(['r2']);
    expect(feeds.refresh).not.toHaveBeenCalled();
  });

  it('asks the shared feed to read again once per decision, not on every later re-read', async () => {
    const view = renderHook(({ total }) => useInboxPageApprovals(total), { initialProps: { total: 2 } });
    await act(async () => {});
    // A decision lands on the bus.
    bus.nonce = 1;
    view.rerender({ total: 2 });
    await act(async () => {});
    expect(feeds.refresh).toHaveBeenCalledTimes(1);
    // The shared feed answers with a new count, twice: re-reads, no new asks.
    view.rerender({ total: 1 });
    await act(async () => {});
    view.rerender({ total: 0 });
    await act(async () => {});
    expect(feeds.fetchPage).toHaveBeenCalledTimes(4);
    expect(feeds.refresh).toHaveBeenCalledTimes(1);
    // A second decision asks once more.
    bus.nonce = 2;
    view.rerender({ total: 0 });
    await act(async () => {});
    expect(feeds.refresh).toHaveBeenCalledTimes(2);
  });
});
