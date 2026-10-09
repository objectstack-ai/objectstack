// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] The storage door's in-process `auth.api.getSession` read
 * (`buildGetSession`, behind the upload session resolver and the ADR-0104 D3
 * download authorizer alike) hands better-auth the in-process session-read
 * rule's input (`inProcessSessionReadInput`, `@objectstack/types`).
 *
 * A request carrying a session cookie reads with `query.disableRefresh`: these
 * routes answer with their own response, so a renewal here would move the
 * session's expiry while its renewed cookie is discarded — the browser's
 * cookie would then die before its session (a split session). A bearer-only
 * request reads exactly as before, renewal included. What that input DOES
 * against real better-auth is pinned end to end in
 * `packages/runtime/src/in-process-session-renewal.pin.test.ts` and
 * `packages/plugins/plugin-auth/src/in-process-session-renewal.pin.test.ts`.
 *
 * Driven through the public host door (`mountStorageRoutes`) on a real
 * `ObjectKernel`, as `mount-storage-routes.test.ts` drives it; the route is
 * `GET /upload/chunked/:uploadId/progress`, whose first act is the session
 * read. No engine is registered, so `sys_file` metadata is in memory and the
 * unknown upload id answers 404 right after the read.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectKernel } from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { mountStorageRoutes } from './mount-storage-routes.js';

const BASE = '/api/v1/storage';
const PROGRESS = `GET:${BASE}/upload/chunked/:uploadId/progress`;
const SESSION_COOKIE = 'better-auth.session_token=tok_22258.c2lnbmF0dXJl';
const BEARER = 'Bearer tok_22258.c2lnbmF0dXJl';

async function readProgress(headers: Record<string, string>) {
  const calls: any[] = [];
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as never);
  // The progress route never touches the adapter: nothing is written here.
  kernel.registerService('storage', new LocalStorageAdapter({ rootDir: join(tmpdir(), 'os-22258-never-written') }));
  kernel.registerService('auth', {
    api: {
      getSession: async (input: any) => {
        calls.push(input);
        return { user: { id: 'usr_22258' }, session: {} };
      },
    },
  });
  const routes = new Map<string, RouteHandler>();
  const http: any = {
    get: (path: string, h: RouteHandler) => { routes.set(`GET:${path}`, h); },
    post: (path: string, h: RouteHandler) => { routes.set(`POST:${path}`, h); },
    put: (path: string, h: RouteHandler) => { routes.set(`PUT:${path}`, h); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };
  const report = mountStorageRoutes(http, kernel, { basePath: BASE, logger: { info: () => {}, warn: () => {} } });
  expect(report.sessionResolver, 'the upload gate is bound to the auth service').toBe(true);

  const handler = routes.get(PROGRESS);
  if (!handler) throw new Error(`fixture: no handler registered for ${PROGRESS}`);
  const state: { status: number; body?: any } = { status: 200 };
  const res: any = {
    json(data: any) { state.body = data; return res; },
    send() { return res; },
    status(code: number) { state.status = code; return res; },
    header() { return res; },
  };
  const req = {
    params: { uploadId: 'upl_22258_absent' },
    query: {},
    headers,
    method: 'GET',
    path: `${BASE}/upload/chunked/upl_22258_absent/progress`,
  } as unknown as IHttpRequest;
  await handler(req, res as IHttpResponse);
  return { calls, status: state.status, code: state.body?.error?.code };
}

describe('[#22258] the storage door reads the session by the in-process rule', () => {
  it('a request carrying a session cookie reads without renewal', async () => {
    const { calls, status, code } = await readProgress({ cookie: SESSION_COOKIE });
    // Admitted past the gate: the read resolved the caller (a refusal would be 401).
    expect(status).toBe(404);
    expect(code).toBe('UPLOAD_SESSION_NOT_FOUND');
    expect(calls).toHaveLength(1);
    expect(calls[0].query, 'a cookie request renewed in-process').toEqual({ disableRefresh: true });
    expect(calls[0].headers.get('cookie')).toBe(SESSION_COOKIE);
  });

  it('the console sends cookie AND bearer — still no renewal in-process', async () => {
    const { calls } = await readProgress({ cookie: SESSION_COOKIE, authorization: BEARER });
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toEqual({ disableRefresh: true });
  });

  it('a bearer-only request reads exactly as before — renewal stays on, no query at all', async () => {
    const { calls, status } = await readProgress({ authorization: BEARER });
    expect(status).toBe(404);
    expect(calls).toHaveLength(1);
    expect('query' in calls[0], 'a bearer-only read lost its renewal').toBe(false);
    expect(calls[0].headers.get('authorization')).toBe(BEARER);
  });
});
