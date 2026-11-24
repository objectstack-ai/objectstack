// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35416 — the app bar's package list read leaves after the page's.
 *
 * `fetchSessionPackages` (the read behind the app → Studio entries) reads
 * `GET /api/v1/packages`, the largest response an app page reads. Started in
 * the commit that drew the app bar, it shared the link with the record or list
 * the page was opening. It now waits until the page's counted requests
 * (`settleSignal`, the data layer's in-flight count) have stayed at zero for
 * `SESSION_PACKAGE_READ_QUIET_MS`, at most `SESSION_PACKAGE_READ_MAX_WAIT_MS`.
 *
 * CONTROLs: with nothing ever counted (no data layer, a host without one) it
 * reads at once; a read already on the wire is joined at once; a held list
 * answers with no read and no wait.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PAYLOAD = { success: true, data: { packages: [{ manifest: { id: 'app.crm', name: 'CRM' }, writable: true }] } };

type SettleModule = typeof import('../../observability/settleSignal');
type PackagesModule = typeof import('./packages-io');

let settle: SettleModule;
let io: PackagesModule;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  // Fresh modules per case: the in-flight count, its "ever counted" flag and
  // the held list are module state.
  vi.resetModules();
  settle = await import('../../observability/settleSignal');
  io = await import('./packages-io');
  fetchMock = vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const packagesReads = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/packages')).length;

describe('objectstack#35416 — the session package list waits for the page to go quiet', () => {
  it('waits while a page request is in flight, then for the quiet window, then reads once', async () => {
    settle.beginRequest(); // the record page's own read, on the wire
    const answer = io.fetchSessionPackages('s1', 'app.crm');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(packagesReads()).toBe(0);

    settle.endRequest();
    await vi.advanceTimersByTimeAsync(io.SESSION_PACKAGE_READ_QUIET_MS - 1);
    expect(packagesReads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(packagesReads()).toBe(1);
    await expect(answer).resolves.toEqual([expect.objectContaining({ id: 'app.crm', writable: true })]);
  });

  it('a request that starts inside the quiet window starts the window again', async () => {
    settle.beginRequest();
    void io.fetchSessionPackages('s1', 'app.crm');
    settle.endRequest();
    await vi.advanceTimersByTimeAsync(io.SESSION_PACKAGE_READ_QUIET_MS - 100);
    settle.beginRequest(); // the page's next wave (its related lists)
    await vi.advanceTimersByTimeAsync(50);
    settle.endRequest();
    await vi.advanceTimersByTimeAsync(io.SESSION_PACKAGE_READ_QUIET_MS - 1);
    expect(packagesReads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(packagesReads()).toBe(1);
  });

  it('a page that never goes quiet still gets its list after the longest wait', async () => {
    settle.beginRequest(); // a request that never ends
    void io.fetchSessionPackages('s1', 'app.crm');
    await vi.advanceTimersByTimeAsync(io.SESSION_PACKAGE_READ_MAX_WAIT_MS - 1);
    expect(packagesReads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(packagesReads()).toBe(1);
  });

  it('readers asked in one commit share the one read after the wait', async () => {
    settle.beginRequest();
    const a = io.fetchSessionPackages('s1', 'app.crm');
    const b = io.fetchSessionPackages('s1', 'app.crm');
    settle.endRequest();
    await vi.advanceTimersByTimeAsync(io.SESSION_PACKAGE_READ_QUIET_MS);
    await Promise.all([a, b]);
    expect(packagesReads()).toBe(1);
  });

  it('CONTROL: with nothing ever counted it reads at once', async () => {
    void io.fetchSessionPackages('s1', 'app.crm');
    await vi.advanceTimersByTimeAsync(0);
    expect(packagesReads()).toBe(1);
  });

  it('CONTROL: a read already on the wire is joined at once, not waited behind', async () => {
    let answerWire: () => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => {
        answerWire = () => resolve(new Response(JSON.stringify(PAYLOAD), { status: 200 }));
      }),
    );
    settle.beginRequest(); // the page is still loading, and never goes quiet here
    const listed = io.fetchListedPackageIds(); // a Studio-side read, which does not wait
    await vi.advanceTimersByTimeAsync(0);
    expect(packagesReads()).toBe(1);
    const answer = io.fetchSessionPackages('s1', 'app.crm');
    answerWire();
    await vi.advanceTimersByTimeAsync(0);
    await expect(answer).resolves.toEqual([expect.objectContaining({ id: 'app.crm' })]);
    await listed;
    expect(packagesReads()).toBe(1);
  });

  it('CONTROL: a held list answers with no read and no wait', async () => {
    void io.fetchSessionPackages('s1', 'app.crm');
    await vi.advanceTimersByTimeAsync(0);
    expect(packagesReads()).toBe(1);
    settle.beginRequest();
    const again = io.fetchSessionPackages('s1', 'app.crm');
    await vi.advanceTimersByTimeAsync(0);
    await expect(again).resolves.toEqual([expect.objectContaining({ id: 'app.crm' })]);
    expect(packagesReads()).toBe(1);
  });
});
