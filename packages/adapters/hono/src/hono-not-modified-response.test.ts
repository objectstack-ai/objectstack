// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25785] A dispatcher `304` reaches the caller as a body-less `304` with
 * the route's own headers, through `toResponse`'s `response` arm.
 *
 * The `/i18n/translations` domain answers a matching `If-None-Match` with
 * `{ status: 304, headers }` and no `body` (`runtime/src/domains/i18n.ts`,
 * `translationsAnswer`). `toResponse` writes a `response` with `c.json(body,
 * status)`; a `304` must reach the wire with NO body — a `Response` with a
 * null-body status and a body throws in the Fetch constructor, and a body of
 * `"null"` or `"undefined"` is not a `304` at all. This file pins that the
 * body-less answer survives this adapter, and that the domain is handed the
 * request headers it reads the validator from.
 *
 * The standalone server's half, over a real socket and the real domain, is
 * `packages/runtime/src/i18n-translations-etag.hono.integration.test.ts`. This
 * package's vitest config aliases `@objectstack/runtime` to a stub, so the
 * dispatcher here is a fixture.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Hono } from 'hono';

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(),
  dispatch: vi.fn(),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

const PREFIX = '/api/v1';
const PATH = `${PREFIX}/i18n/translations/fr`;
const ETAG = 'W/"validator-of-the-served-bundle"';
const HEADERS = { ETag: ETAG, 'Cache-Control': 'private, no-cache' };

const kernel = { name: 'test-kernel' } as any;
const bootApp = (): Hono => createHonoApp({ kernel, prefix: PREFIX });

describe('#25785: a body-less dispatcher 304 stays a body-less 304', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatcher.handleAuth.mockResolvedValue({ handled: false });
  });

  it('is written as 304 with an empty body and the route\'s ETag and Cache-Control', async () => {
    mockDispatcher.dispatch.mockResolvedValue({ handled: true, response: { status: 304, headers: HEADERS } });

    const res = await bootApp().request(`http://localhost${PATH}`, { headers: { 'If-None-Match': ETAG } });

    expect(res.status).toBe(304);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
    expect(res.headers.get('etag')).toBe(ETAG);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('hands the domain the request it reads If-None-Match from', async () => {
    mockDispatcher.dispatch.mockResolvedValue({ handled: true, response: { status: 304, headers: HEADERS } });

    await bootApp().request(`http://localhost${PATH}`, { headers: { 'If-None-Match': ETAG } });

    expect(mockDispatcher.dispatch).toHaveBeenCalledTimes(1);
    const context = mockDispatcher.dispatch.mock.calls[0][4];
    expect(context.request.headers.get('if-none-match')).toBe(ETAG);
  });

  it('the 200 beside it still carries its JSON body and the same headers (control)', async () => {
    const body = { success: true, data: { locale: 'fr', translations: { objects: {} } } };
    mockDispatcher.dispatch.mockResolvedValue({ handled: true, response: { status: 200, body, headers: HEADERS } });

    const res = await bootApp().request(`http://localhost${PATH}`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(body);
    expect(res.headers.get('etag')).toBe(ETAG);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
  });
});
