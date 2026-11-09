/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectStackAdapter, clearSharedDiscoveryCache } from '@object-ui/data-objectstack';
import { answeredLoadFailure, classifyLoadError } from './error-message';

/**
 * objectstack#29885 — what the adapter throws for a request that got no
 * answer, read by the shared load-failure rule, pinned where the two meet.
 *
 * `ObjectStackAdapter.getObjectSchema` rewraps a non-404 failure through
 * `createErrorFromResponse`, which used to stamp `statusCode: 500` on an error
 * that carried no status (a dropped connection: `fetch` rejects with a bare
 * `TypeError`). `answeredLoadFailure` reads any numeric status as the server's
 * answer, so every reader of that wrapper showed the browser's "Failed to
 * fetch" as if the server had said it, instead of its "check your connection"
 * sentence. The adapter cannot import this reader (this package depends on
 * that one), so neither side's unit tests can pin the pair alone.
 */
describe('a getObjectSchema read that got no answer reads as no answer (objectstack#29885)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  function adapterAnswering(byName: () => unknown) {
    const fetchImpl = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/v1/discovery')) {
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) };
      }
      if (u.includes('/api/v1/meta/object/')) return byName();
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
    });
    return new ObjectStackAdapter({ baseUrl: 'http://unanswered-29885.test', autoReconnect: false, fetch: fetchImpl as any });
  }

  const answered = (status: number, body: unknown) => () => ({ ok: false, status, statusText: 'Error', json: async () => body });

  it('a fetch that rejects with a TypeError: no answered failure, and a network kind', async () => {
    const adapter = adapterAnswering(() => {
      throw new TypeError('Failed to fetch');
    });

    const err: any = await adapter.getObjectSchema('account').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBeUndefined();
    expect(answeredLoadFailure(err)).toBeNull();
    expect(classifyLoadError(err)).toBe('network');
  });

  it('CONTROL: an answered 500 keeps its status and reads as answered', async () => {
    const adapter = adapterAnswering(answered(500, { error: 'Database connection refused.', code: 'INTERNAL_ERROR' }));

    const err: any = await adapter.getObjectSchema('account').catch((e: unknown) => e);

    expect(err.statusCode).toBe(500);
    expect(answeredLoadFailure(err)).toMatchObject({ message: 'Database connection refused.' });
  });

  it('CONTROL: an answered 503 keeps its status and reads as answered', async () => {
    const adapter = adapterAnswering(
      answered(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'The metadata store is down.' } }),
    );

    const err: any = await adapter.getObjectSchema('account').catch((e: unknown) => e);

    expect(err.statusCode).toBe(503);
    expect(answeredLoadFailure(err)).not.toBeNull();
  });
});
