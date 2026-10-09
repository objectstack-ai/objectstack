// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] The datasource-admin family's in-process `auth.api.getSession` read
 * (`buildGetSession`, behind every route's `requireDatasourceAdmin`) hands
 * better-auth the in-process session-read rule's input
 * (`inProcessSessionReadInput`, `@objectstack/types`).
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
 * Driven through the real registrar on a real Hono server, as
 * `admin-routes-authz-outage-envelope.test.ts` drives it. The caller resolves
 * to an identity holding no grant, so the answer is the capability refusal
 * (403) — which is itself the proof the read resolved someone: an unresolved
 * caller is refused 401 instead.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';

const SESSION_COOKIE = 'better-auth.session_token=tok_22258.c2lnbmF0dXJl';
const BEARER = 'Bearer tok_22258.c2lnbmF0dXJl';

async function readDrivers(headers: Record<string, string>) {
  const calls: any[] = [];
  const ctx = {
    getService: vi.fn((name: string) => {
      if (name === 'auth') {
        return {
          api: {
            getSession: async (input: any) => {
              calls.push(input);
              return { user: { id: 'usr_22258' }, session: {} };
            },
          },
        };
      }
      if (name === 'objectql' || name === 'data') return { find: async () => [] };
      return undefined;
    }),
    getKernel: () => ({ getServiceAsync: async () => ({ getTenancyPosture: () => 'single' }) }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as PluginContext;

  const server = new HonoHttpServer(0);
  server.setLogger({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() } as any);
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  const res = await server.getRawApp().fetch(new Request('http://local/api/v1/datasources/drivers', { headers }));
  const body: any = await res.json().catch(() => undefined);
  return { calls, status: res.status, code: body?.error?.code };
}

describe('[#22258] the datasource-admin family reads the session by the in-process rule', () => {
  it('a request carrying a session cookie reads without renewal', async () => {
    const { calls, status, code } = await readDrivers({ cookie: SESSION_COOKIE });
    expect(status).toBe(403);
    expect(code).toBe('PERMISSION_DENIED');
    expect(calls).toHaveLength(1);
    expect(calls[0].query, 'a cookie request renewed in-process').toEqual({ disableRefresh: true });
    expect(calls[0].headers.get('cookie')).toBe(SESSION_COOKIE);
  });

  it('the console sends cookie AND bearer — still no renewal in-process', async () => {
    const { calls } = await readDrivers({ cookie: SESSION_COOKIE, authorization: BEARER });
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toEqual({ disableRefresh: true });
  });

  it('a bearer-only request reads exactly as before — renewal stays on, no query at all', async () => {
    const { calls, status } = await readDrivers({ authorization: BEARER });
    expect(status).toBe(403);
    expect(calls).toHaveLength(1);
    expect('query' in calls[0], 'a bearer-only read lost its renewal').toBe(false);
    expect(calls[0].headers.get('authorization')).toBe(BEARER);
  });
});
