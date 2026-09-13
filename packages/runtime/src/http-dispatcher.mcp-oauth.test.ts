// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * OAuth 2.1 bearer authentication on the MCP surface (#2698).
 *
 * Driven through `dispatch()` (not `handleMcp` directly) so the full
 * per-request pipeline runs: resolveExecutionContext with the MCP-only
 * `acceptOAuthAccessToken` opt-in → shared resolveAuthzContext → handleMcp's
 * WWW-Authenticate / scope enforcement. The token VERIFIER is faked (that
 * half lives in @objectstack/plugin-auth and has its own tests); what these
 * tests pin down is the dispatcher's fail-closed contract around it:
 *
 *  - anonymous → 401, advertising resource_metadata ONLY when the OAuth
 *    track is live (API-key-only deployments keep the plain 401)
 *  - verified token → principal-bound ExecutionContext + grantedScopes
 *    forwarded to the MCP runtime
 *  - token with no MCP scope → 403 insufficient_scope
 *  - presented-but-invalid JWT bearer → 401 even when a cookie session
 *    exists (no ambient-session fallback for a dead credential)
 *  - a refused JWT bearer assembles NO execution context at all (#16418)
 *  - the API-key track is byte-for-byte unchanged (regression)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hashApiKey } from '@objectstack/core';

import { HttpDispatcher } from './http-dispatcher.js';

const VALID_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1NDIifQ.sig'; // shape only — verifier is faked
// Shape only, and deliberately NOT VALID_JWT: the harness's fake verifier
// answers `null` for anything else, which is exactly the verdict the real
// verifier now returns for a client_credentials token (#16418).
const M2M_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJtMm0tY2xpZW50In0.sig';
const RAW_API_KEY = 'osk_test_regression_key';

interface HarnessOptions {
  /** Scopes the fake verifier grants for VALID_JWT; null = verification fails. */
  oauthScopes?: string[] | null;
  /** Whether the auth service advertises the OAuth track (resource metadata). */
  oauthAdvertised?: boolean;
  /** Session returned by api.getSession (cookie path). */
  session?: any;
}

function makeHarness(opts: HarnessOptions = {}) {
  const recorded: any[] = [];
  const apiKeyHash = hashApiKey(RAW_API_KEY);

  const ql = {
    insert: async (_o: string, data: any, o: any) => {
      recorded.push(o?.context);
      return { id: 'new1', ...data };
    },
    find: async (object: string, q: any) => {
      if (object === 'sys_api_key' && q?.where?.key === apiKeyHash && q?.where?.revoked === false) {
        return [{ id: 'k1', key: apiKeyHash, user_id: 'keyUser', revoked: false }];
      }
      return [];
    },
    update: async () => ({}),
    delete: async () => ({}),
  };

  const metadata = {
    listObjects: async () => [{ name: 'task', fields: { title: {} } }],
    getObject: async (n: string) => (n === 'task' ? { name: 'task', fields: {} } : null),
  };

  const mcpService: any = {
    lastOpts: undefined,
    handleHttpRequest: async (_req: Request, o: any) => {
      mcpService.lastOpts = o;
      const created = await o.bridge.create('task', { title: 'x' });
      return new Response(JSON.stringify({ ok: true, created }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };

  const authService: any = {
    api: { getSession: async () => opts.session },
    verifyMcpAccessToken: async (token: string) =>
      token === VALID_JWT && opts.oauthScopes != null
        ? { userId: 'u42', scopes: opts.oauthScopes, clientId: 'client-1' }
        : null,
  };
  if (opts.oauthAdvertised !== false) {
    authService.getMcpResourceMetadataUrl = () =>
      'https://env.example.com/.well-known/oauth-protected-resource';
  }

  const services: Record<string, any> = { metadata, objectql: ql, mcp: mcpService, auth: authService };
  const kernel: any = {
    getService: (n: string) => services[n],
    getServiceAsync: async (n: string) => services[n],
  };
  const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
  return { dispatcher, mcpService, recorded, services };
}

function requestWithHeaders(headers: Record<string, string>) {
  return {
    method: 'POST',
    url: '/api/v1/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      host: 'env.example.com',
      ...headers,
    },
  };
}

const BODY = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

async function dispatchMcp(dispatcher: HttpDispatcher, headers: Record<string, string>) {
  return dispatcher.dispatch('POST', '/mcp', BODY, {}, { request: requestWithHeaders(headers) } as any, '/api/v1');
}

describe('HttpDispatcher — OAuth bearer on /mcp (#2698)', () => {
  const prev = process.env.OS_MCP_SERVER_ENABLED;
  beforeEach(() => {
    process.env.OS_MCP_SERVER_ENABLED = 'true';
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prev;
  });

  it('anonymous → 401 with WWW-Authenticate advertising resource metadata (OAuth track live)', async () => {
    const { dispatcher } = makeHarness({ oauthScopes: null });
    const res = await dispatchMcp(dispatcher, {});
    expect(res.response!.status).toBe(401);
    const www = res.response!.headers?.['WWW-Authenticate'];
    expect(www).toContain('Bearer');
    expect(www).toContain('resource_metadata="https://env.example.com/.well-known/oauth-protected-resource"');
  });

  it('anonymous → plain 401 without WWW-Authenticate when the OAuth track is off (API-key-only)', async () => {
    const { dispatcher } = makeHarness({ oauthScopes: null, oauthAdvertised: false });
    const res = await dispatchMcp(dispatcher, {});
    expect(res.response!.status).toBe(401);
    expect(res.response!.headers?.['WWW-Authenticate']).toBeUndefined();
  });

  it('verified bearer → runs as the token principal with grantedScopes forwarded', async () => {
    const { dispatcher, mcpService, recorded } = makeHarness({ oauthScopes: ['data:read', 'data:write'] });
    const res = await dispatchMcp(dispatcher, { authorization: `Bearer ${VALID_JWT}` });
    expect(res.response!.status).toBe(200);
    expect(mcpService.lastOpts.toolOptions?.grantedScopes).toEqual(['data:read', 'data:write']);
    // The bridge ran under the token's principal — not system, not anonymous.
    expect(recorded[0]?.userId).toBe('u42');
    expect(recorded[0]?.isSystem).toBe(false);
    expect(recorded[0]?.oauthScopes).toEqual(['data:read', 'data:write']);
  });

  it('verified bearer with NO MCP scope → 403 insufficient_scope', async () => {
    const { dispatcher, mcpService } = makeHarness({ oauthScopes: ['openid', 'profile'] });
    const res = await dispatchMcp(dispatcher, { authorization: `Bearer ${VALID_JWT}` });
    expect(res.response!.status).toBe(403);
    expect(res.response!.headers?.['WWW-Authenticate']).toContain('insufficient_scope');
    expect(mcpService.lastOpts).toBeUndefined(); // never reached the MCP runtime
  });

  it('invalid/expired JWT bearer → 401 even when a cookie session exists (fail-closed, no fallback)', async () => {
    const { dispatcher } = makeHarness({
      oauthScopes: null, // verifier rejects everything
      session: { user: { id: 'cookieUser' } },
    });
    const res = await dispatchMcp(dispatcher, {
      authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.ZGVhZA.sig',
      cookie: 'better-auth.session=abc',
    });
    expect(res.response!.status).toBe(401);
  });

  it('a non-JWT bearer (opaque session token) still resolves through the session path', async () => {
    const { dispatcher, mcpService, recorded } = makeHarness({
      oauthScopes: null,
      session: { user: { id: 'cookieUser' } },
    });
    const res = await dispatchMcp(dispatcher, { authorization: 'Bearer opaque-session-token' });
    expect(res.response!.status).toBe(200);
    expect(recorded[0]?.userId).toBe('cookieUser');
    // Session provenance is NOT scope-limited.
    expect(mcpService.lastOpts.toolOptions).toBeUndefined();
    expect(recorded[0]?.oauthScopes).toBeUndefined();
  });

  it('[#16418] a JWT bearer the verifier refuses (client_credentials / M2M) → 401 and NO context assembled', async () => {
    // The verifier's own half — that a minted `client_credentials` token
    // verifies to `null` — is pinned in @objectstack/plugin-auth against a
    // real authorization server. What this door owes is the other half: a
    // `null` verdict must stop the request BEFORE any execution context
    // reaches the MCP runtime or the data bridge. A bare status assertion is
    // not enough here — "still 401" was never the doubt; "did anything run"
    // is.
    const { dispatcher, mcpService, recorded } = makeHarness({
      oauthScopes: null, // the verifier refuses this credential
    });
    const res = await dispatchMcp(dispatcher, {
      authorization: `Bearer ${M2M_JWT}`,
    });
    expect(res.response!.status).toBe(401);
    expect(mcpService.lastOpts, 'the MCP runtime must never be reached').toBeUndefined();
    expect(recorded, 'no execution context may be assembled for a refused credential').toEqual([]);
  });

  it('REGRESSION: the API-key track is unchanged — x-api-key resolves the key principal, unscoped', async () => {
    const { dispatcher, mcpService, recorded } = makeHarness({ oauthScopes: ['data:read'] });
    const res = await dispatchMcp(dispatcher, { 'x-api-key': RAW_API_KEY });
    expect(res.response!.status).toBe(200);
    expect(recorded[0]?.userId).toBe('keyUser');
    expect(mcpService.lastOpts.toolOptions).toBeUndefined();
    expect(recorded[0]?.oauthScopes).toBeUndefined();
  });

  it('REGRESSION: Bearer osk_-prefixed API key still routes to the API-key path, not OAuth', async () => {
    const { dispatcher, recorded } = makeHarness({ oauthScopes: null });
    const res = await dispatchMcp(dispatcher, { authorization: `Bearer ${RAW_API_KEY}` });
    expect(res.response!.status).toBe(200);
    expect(recorded[0]?.userId).toBe('keyUser');
  });
});
