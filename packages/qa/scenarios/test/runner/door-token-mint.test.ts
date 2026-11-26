// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Door mode's token (`mintAuthoringToken`): OAuth 2.1 + PKCE against a
 * loopback stand-in for the app's authorization server. The authorize step
 * answers in either of the two shapes the server sends a redirect in — a 302
 * with a `Location`, or a 200 `{ redirect: true, url }`, which is what a
 * fetch from Node gets (it sends `sec-fetch-mode: cors`) — and the runner must
 * reach the consent step and the token from both. The bodies are the ones a
 * booted `examples/app-starter` answers with `OS_OIDC_PROVIDER_ENABLED=true`.
 * No network beyond 127.0.0.1.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { mintAuthoringToken } from '../../src/runner/app.js';

const CALLBACK = 'http://127.0.0.1:33419/callback';
const COOKIE = 'better-auth.session_token=admin-session';

type AuthorizeShape = 'location' | 'json' | 'json-error' | 'json-no-url';

describe('mintAuthoringToken — both shapes of the authorize redirect', () => {
  let server: Server;
  let base = '';
  let shape: AuthorizeShape = 'location';
  const seen: Array<{ method?: string; path: string; headers: IncomingMessage['headers']; body: string }> = [];

  /** The consent page's query, as the authorization server signs it onto the redirect. */
  const consentQuery = (search: URLSearchParams) => {
    const q = new URLSearchParams(search);
    q.set('exp', '1796277600');
    q.set('sig', 'c2lnbmVkLXF1ZXJ5');
    return q.toString();
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', base);
        seen.push({ method: req.method, path: url.pathname, headers: req.headers, body: raw });
        const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
        switch (url.pathname) {
          case '/.well-known/oauth-protected-resource':
            return json(200, { resource: `${base}/api/v1/mcp`, authorization_servers: [`${base}/api/v1/auth`] });
          case '/api/v1/auth/oauth2/register':
            return json(201, { client_id: 'door-client', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' });
          case '/api/v1/auth/oauth2/authorize': {
            if (req.headers.cookie !== COOKIE) return json(401, { code: 'UNAUTHORIZED', message: 'no session' });
            const consentPage = `${base}/_console/oauth/consent?${consentQuery(url.searchParams)}`;
            if (shape === 'location') return res.writeHead(302, { location: consentPage }).end();
            if (shape === 'json') return json(200, { redirect: true, url: consentPage });
            if (shape === 'json-error') {
              const denied = `${CALLBACK}?error=invalid_scope&error_description=${encodeURIComponent('The following scopes are invalid: metadata:write')}&state=scenario`;
              return json(200, { redirect: true, url: denied });
            }
            return json(200, { session: { userId: 'u1' } });
          }
          case '/api/v1/auth/oauth2/consent': {
            const body = JSON.parse(raw) as { accept?: boolean; oauth_query?: string };
            if (req.headers.cookie !== COOKIE || body.accept !== true || !body.oauth_query?.includes('client_id=door-client')) return json(400, { error: 'invalid_request' });
            return json(200, { redirect: true, url: `${CALLBACK}?code=code-1&state=scenario&iss=${encodeURIComponent(`${base}/api/v1/auth`)}` });
          }
          case '/api/v1/auth/oauth2/token': {
            const form = new URLSearchParams(raw);
            if (form.get('code') !== 'code-1' || !form.get('code_verifier')) return json(400, { error: 'invalid_grant', error_description: 'invalid code' });
            return json(200, { access_token: 'door-token', token_type: 'Bearer', expires_in: 3600, scope: 'openid metadata:write' });
          }
          default:
            return json(404, { code: 'NOT_FOUND' });
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  beforeEach(() => {
    seen.length = 0;
  });

  const consentCall = () => seen.find((s) => s.path === '/api/v1/auth/oauth2/consent');

  it('follows a 302 Location to the consent step and trades the code for the token', async () => {
    shape = 'location';
    const r = await mintAuthoringToken(base, COOKIE, 'openid metadata:write');
    expect(r).toMatchObject({ ok: true, status: 200, token: 'door-token', body: { scope: 'openid metadata:write' } });
    // The consent carries the signed query the redirect named, unchanged.
    const oauthQuery = JSON.parse(consentCall()!.body).oauth_query as string;
    expect(new URLSearchParams(oauthQuery).get('sig')).toBe('c2lnbmVkLXF1ZXJ5');
    expect(new URLSearchParams(oauthQuery).get('client_id')).toBe('door-client');
  });

  it('follows a 200 { redirect: true, url } to the same consent step and the same token', async () => {
    shape = 'json';
    const r = await mintAuthoringToken(base, COOKIE, 'openid metadata:write');
    expect(r).toMatchObject({ ok: true, status: 200, token: 'door-token', body: { scope: 'openid metadata:write' } });
    // What makes the server answer this shape: Node's fetch sends sec-fetch-mode: cors.
    expect(seen.find((s) => s.path === '/api/v1/auth/oauth2/authorize')?.headers['sec-fetch-mode']).toBe('cors');
    const oauthQuery = JSON.parse(consentCall()!.body).oauth_query as string;
    expect(new URLSearchParams(oauthQuery).get('sig')).toBe('c2lnbmVkLXF1ZXJ5');
    expect(seen.map((s) => s.path)).toEqual([
      '/.well-known/oauth-protected-resource',
      '/api/v1/auth/oauth2/register',
      '/api/v1/auth/oauth2/authorize',
      '/api/v1/auth/oauth2/consent',
      '/api/v1/auth/oauth2/token',
    ]);
  });

  it('records a redirect that carries an error as the refusal of the authorization step, without consenting', async () => {
    shape = 'json-error';
    const r = await mintAuthoringToken(base, COOKIE, 'openid metadata:write');
    expect(r).toMatchObject({ ok: false, status: 200, code: 'invalid_scope' }); // adr0112-ok: RFC 6749 OAuth error the authorization server redirects with, not an error.code
    expect(r.message).toBe('authorization: The following scopes are invalid: metadata:write');
    expect(r.token).toBeUndefined();
    expect(consentCall()).toBeUndefined();
  });

  it('records a 200 that names no redirect as the refusal of the authorization step', async () => {
    shape = 'json-no-url';
    const r = await mintAuthoringToken(base, COOKIE, 'openid metadata:write');
    expect(r).toMatchObject({ ok: false, status: 200 });
    expect(r.message).toMatch(/^authorization: /);
    expect(consentCall()).toBeUndefined();
  });

  it('records an unauthenticated authorize as the refusal of the authorization step, with its code', async () => {
    shape = 'json';
    const r = await mintAuthoringToken(base, 'nope', 'openid metadata:write');
    expect(r).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' });
    expect(r.message).toMatch(/^authorization: /);
  });
});
