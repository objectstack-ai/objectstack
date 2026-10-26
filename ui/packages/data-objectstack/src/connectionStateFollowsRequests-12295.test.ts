/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12295 — after the first successful connect, the connection state
 * follows the outcome of the requests the host already makes.
 *
 * Every `setConnectionState` call used to sit inside `connect()` and its retry
 * helper, so once discovery had answered, no failed request could move the
 * state again: a backend stopped mid-session left the header chip hidden over
 * stale rows. These pins drive the REAL client through a fake fetch, so the
 * seam they exercise is the one a browser takes:
 *
 * - a request with no HTTP answer moves the state to `reconnecting`, and to
 *   `error` once the adapter's own retry window (`autoReconnect` ×
 *   `maxReconnectAttempts`) is spent;
 * - the next answered request moves it back to `connected`;
 * - an answered HTTP error (4xx, 5xx) moves nothing: the server is reachable;
 * - a caller's own abort moves nothing, and before the first connect
 *   `connect()` alone owns the state.
 *
 * No timer is involved: the state moves with the request that carried the news.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ObjectStackAdapter,
  ConnectionError,
  clearSharedDiscoveryCache,
  type ConnectionStateEvent,
} from './index';

type Mode = 'answer' | 'refuse' | 'abort' | { status: number };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A fake ObjectStack server behind the adapter's injected fetch. Discovery
 * follows `discovery`; every other request follows `mode`.
 */
function fakeServer() {
  const server: { mode: Mode; discovery: 'answer' | 'refuse' } = {
    mode: 'answer',
    discovery: 'answer',
  };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/discovery')) {
      if (server.discovery === 'refuse') throw new TypeError('Failed to fetch');
      return json({ success: true, data: { name: 'fake', routes: {} } });
    }
    if (server.mode === 'refuse') throw new TypeError('Failed to fetch');
    if (server.mode === 'abort') {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    if (typeof server.mode === 'object') {
      return json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'server said no' } },
        server.mode.status,
      );
    }
    return json({ success: true, data: { records: [{ id: '1' }], total: 1 } });
  });
  return { server, fetch };
}

async function connectedAdapter(options: { autoReconnect?: boolean; maxReconnectAttempts?: number } = {}) {
  const { server, fetch } = fakeServer();
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://fake-12295.test',
    fetch,
    ...options,
  });
  const events: ConnectionStateEvent[] = [];
  adapter.onConnectionStateChange((event) => events.push(event));
  await adapter.connect();
  expect(adapter.getConnectionState()).toBe('connected');
  events.length = 0;
  return { adapter, server, fetch, events };
}

describe('connection state follows request outcomes after the first connect (objectui#12295)', () => {
  beforeEach(() => {
    clearSharedDiscoveryCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a refused data request after a successful connect moves the state to reconnecting', async () => {
    const { adapter, server, events } = await connectedAdapter({ maxReconnectAttempts: 3 });

    server.mode = 'refuse';
    // The rejection reaches the caller unchanged.
    await expect(adapter.find('task')).rejects.toBeInstanceOf(TypeError);

    expect(adapter.getConnectionState()).toBe('reconnecting');
    expect(adapter.isConnected()).toBe(false);
    expect(events.map((e) => e.state)).toEqual(['reconnecting']);
    // Moved by the request itself — nothing was scheduled to move it.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the next answered request returns the state to connected', async () => {
    const { adapter, server, events } = await connectedAdapter({ maxReconnectAttempts: 3 });

    server.mode = 'refuse';
    await expect(adapter.find('task')).rejects.toBeInstanceOf(TypeError);
    server.mode = 'answer';
    await expect(adapter.find('task')).resolves.toMatchObject({ total: 1 });

    expect(adapter.getConnectionState()).toBe('connected');
    expect(adapter.isConnected()).toBe(true);
    expect(events.map((e) => e.state)).toEqual(['reconnecting', 'connected']);
  });

  it.each([500, 403])('an answered HTTP %i leaves the state at connected', async (status) => {
    const { adapter, server, events } = await connectedAdapter();

    server.mode = { status };
    await expect(adapter.find('task')).rejects.toMatchObject({ httpStatus: status });

    expect(adapter.getConnectionState()).toBe('connected');
    expect(events).toEqual([]);
  });

  it('an answered HTTP error ends an outage like any other answer', async () => {
    const { adapter, server, events } = await connectedAdapter({ maxReconnectAttempts: 3 });

    server.mode = 'refuse';
    await expect(adapter.find('task')).rejects.toBeInstanceOf(TypeError);
    server.mode = { status: 500 };
    await expect(adapter.find('task')).rejects.toMatchObject({ httpStatus: 500 });

    expect(adapter.getConnectionState()).toBe('connected');
    expect(events.map((e) => e.state)).toEqual(['reconnecting', 'connected']);
  });

  it('past the adapter\'s retry window the state moves to error, and an answer still restores it', async () => {
    const { adapter, server, events } = await connectedAdapter({ maxReconnectAttempts: 2 });

    server.mode = 'refuse';
    for (let i = 0; i < 2; i++) {
      await expect(adapter.find(`task_${i}`)).rejects.toBeInstanceOf(TypeError);
      expect(adapter.getConnectionState()).toBe('reconnecting');
    }
    await expect(adapter.find('task_2')).rejects.toBeInstanceOf(TypeError);
    expect(adapter.getConnectionState()).toBe('error');
    // Further unanswered requests repeat nothing to the listeners.
    await expect(adapter.find('task_3')).rejects.toBeInstanceOf(TypeError);

    expect(events.map((e) => e.state)).toEqual(['reconnecting', 'error']);
    const errorEvent = events[1];
    expect(errorEvent.error).toBeInstanceOf(ConnectionError);
    expect((errorEvent.error as ConnectionError).code).toBe('CONNECTION_ERROR');
    expect(vi.getTimerCount()).toBe(0);

    server.mode = 'answer';
    await expect(adapter.find('task')).resolves.toMatchObject({ total: 1 });
    expect(adapter.getConnectionState()).toBe('connected');

    // The window is spent per outage, not per adapter lifetime.
    server.mode = 'refuse';
    await expect(adapter.find('task_4')).rejects.toBeInstanceOf(TypeError);
    expect(adapter.getConnectionState()).toBe('reconnecting');
  });

  it('with autoReconnect off there is no window: the first unanswered request is an error', async () => {
    const { adapter, server, events } = await connectedAdapter({ autoReconnect: false });

    server.mode = 'refuse';
    await expect(adapter.find('task')).rejects.toBeInstanceOf(TypeError);

    expect(events.map((e) => e.state)).toEqual(['error']);
  });

  it('a request its caller aborted moves nothing', async () => {
    const { adapter, server, events } = await connectedAdapter();

    server.mode = 'abort';
    await expect(adapter.find('task')).rejects.toMatchObject({ name: 'AbortError' });

    expect(adapter.getConnectionState()).toBe('connected');
    expect(events).toEqual([]);
  });

  it('before the first connect, connect() alone owns the state', async () => {
    const { server, fetch } = fakeServer();
    server.discovery = 'refuse';
    const adapter = new ObjectStackAdapter({
      baseUrl: 'http://fake-12295.test',
      fetch,
      autoReconnect: false,
    });
    const states: string[] = [];
    adapter.onConnectionStateChange((event) => states.push(event.state));

    await expect(adapter.connect()).rejects.toBeInstanceOf(ConnectionError);

    // The refused discovery passed through the same fetch, and recorded nothing
    // of its own on top of what connect() reports.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['connecting', 'error']);
  });
});
