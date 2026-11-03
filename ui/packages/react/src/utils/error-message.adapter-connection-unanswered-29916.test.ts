/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConnectionError,
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
  createErrorFromResponse,
  type ConnectionStateEvent,
} from '@object-ui/data-objectstack';
import { answeredLoadFailure, classifyLoadError } from './error-message';

/**
 * objectstack#29916 — a `ConnectionError` for a request nothing answered,
 * read by the shared load-failure rule, pinned where the two meet.
 *
 * The `ConnectionError` constructor used to stamp `statusCode: 503` on every
 * error built without a status. `connect()`'s catch (a discovery `fetch` that
 * rejected) and the post-connect "the server did not answer" state both build
 * it that way, and every data method opens with `await this.connect()`, so a
 * list read against a down backend rejected with an error that looked
 * answered: `answeredLoadFailure` takes any numeric status for the server's
 * answer and showed "Connection error: Failed to fetch" as the server's own
 * words. Same defect as objectstack#29885 for `createErrorFromResponse`.
 */
describe('a ConnectionError that nothing answered reads as no answer (objectstack#29916)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  const discoveryOk = () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true, data: { version: 'v1', routes: {} } }),
  });

  function adapterWith(discovery: () => unknown, data: () => unknown = () => { throw new TypeError('Failed to fetch'); }) {
    const fetchImpl = vi.fn(async (url: unknown) => {
      if (String(url).includes('/api/v1/discovery')) return discovery();
      return data();
    });
    return new ObjectStackAdapter({
      baseUrl: 'http://connection-unanswered-29916.test',
      autoReconnect: false,
      fetch: fetchImpl as any,
    });
  }

  it('connect() over a fetch that rejects: a ConnectionError with no status, no answered failure, a network kind', async () => {
    const adapter = adapterWith(() => {
      throw new TypeError('Failed to fetch');
    });

    const err: any = await adapter.connect().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.code).toBe('CONNECTION_ERROR');
    expect(err.statusCode).toBeUndefined();
    expect(answeredLoadFailure(err)).toBeNull();
    expect(classifyLoadError(err)).toBe('network');
  });

  it('a data read before connect, discovery unreachable: the read rejects as no answer', async () => {
    const adapter = adapterWith(() => {
      throw new TypeError('Failed to fetch');
    });

    const err: any = await adapter.find('account').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.statusCode).toBeUndefined();
    expect(answeredLoadFailure(err)).toBeNull();
    expect(classifyLoadError(err)).toBe('network');
  });

  it('an unanswered request after connect: the error-state ConnectionError carries no status', async () => {
    const adapter = adapterWith(discoveryOk);
    await adapter.connect();
    const events: ConnectionStateEvent[] = [];
    adapter.onConnectionStateChange((event) => events.push(event));

    await expect(adapter.find('account')).rejects.toBeInstanceOf(TypeError);

    expect(events.map((e) => e.state)).toEqual(['error']);
    const err: any = events[0].error;
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.statusCode).toBeUndefined();
    expect(answeredLoadFailure(err)).toBeNull();
    expect(classifyLoadError(err)).toBe('network');
  });

  it('CONTROL: an answered 503 through createErrorFromResponse keeps its status and reads as answered', () => {
    const err: any = createErrorFromResponse({ status: 503, message: 'The metadata store is down.' }, 'find(account)');

    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.statusCode).toBe(503);
    expect(answeredLoadFailure(err)).not.toBeNull();
  });

  it('CONTROL: a discovery the server answered with 503 keeps that status and reads as answered', async () => {
    const adapter = adapterWith(() => ({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) }));

    const err: any = await adapter.connect().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.statusCode).toBe(503);
    expect(answeredLoadFailure(err)).not.toBeNull();
  });

  it('a discovery the server answered with 401 carries 401, not an invented 503', async () => {
    const adapter = adapterWith(() => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) }));

    const err: any = await adapter.connect().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.statusCode).toBe(401);
    expect(classifyLoadError(err)).toBe('unauthorized');
  });
});
