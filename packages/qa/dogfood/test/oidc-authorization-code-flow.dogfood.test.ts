// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * OIDC authorization-code flow — end-to-end against a REAL kernel.
 *
 * Regression proof for the @better-auth/oauth-provider 1.7 schema drift that
 * broke platform SSO: the token exchange 500'd with `table
 * sys_oauth_access_token has no column named authorizationCodeId` because the
 * 1.7 models gained fields the sys_oauth_* platform objects (and the
 * snake_case mappings in plugin-auth's auth-schema-config.ts) did not carry.
 * The static parity gate (plugin-auth's oauth-provider-schema-parity.test.ts)
 * catches missing columns at schema level; THIS test proves the actual wiring
 * — authorize → code → token — issues a token and lands the row, exactly the
 * hop that died in production.
 *
 * The client row mirrors what the cloud control plane seeds for per-project
 * platform SSO (`seedPlatformSsoClient`): confidential client,
 * client_secret_basic, skip_consent, hashed secret (SHA-256 → base64url — the
 * oauth-provider defaultHasher format).
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

// Must be on before the AuthPlugin builds its plugin list (kernel.use during
// bootStack) — this is the same switch cloud/objectstack dev deployments use.
process.env.OS_OIDC_PROVIDER_ENABLED = 'true';

const CLIENT_ID = 'project_dogfood_env';
const CLIENT_SECRET = 'dogfood-plaintext-secret';
// better-auth ≥ 1.7 mounts genericOAuth RPs through the core social flow, so
// the env-side callback is /api/v1/auth/callback/<provider> (the pre-1.7 form
// was /api/v1/auth/oauth2/callback/<provider>).
const REDIRECT_URI = 'https://env.example.com/api/v1/auth/callback/objectstack-cloud';

/** SHA-256 → base64url (no padding) — @better-auth/oauth-provider defaultHasher. */
function hashSecret(plaintext: string): string {
  return createHash('sha256').update(plaintext)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

describe('OIDC authorization-code flow (oauth-provider 1.7)', () => {
  let stack: VerifyStack;
  let cookie: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});

    // Seed the OAuth client the way cloud's seedPlatformSsoClient does.
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const nowIso = new Date().toISOString();
    await ql.insert('sys_oauth_application', {
      id: 'oauthc_dogfood_env',
      name: 'Dogfood Project',
      client_id: CLIENT_ID,
      client_secret: hashSecret(CLIENT_SECRET),
      type: 'web',
      redirect_uris: JSON.stringify([REDIRECT_URI]),
      grant_types: JSON.stringify(['authorization_code', 'refresh_token']),
      response_types: JSON.stringify(['code']),
      scopes: JSON.stringify(['openid', 'email', 'profile']),
      token_endpoint_auth_method: 'client_secret_basic',
      require_pkce: false,
      skip_consent: true,
      disabled: false,
      subject_type: 'public',
      created_at: nowIso,
      updated_at: nowIso,
    }, { context: { isSystem: true } });

    // Browser-style session: sign in and carry the session COOKIE (the
    // authorize endpoint is hit by a redirected browser, not a bearer client).
    const res = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    expect(res.ok).toBe(true);
    cookie = res.headers.getSetCookie?.().map((c: string) => c.split(';')[0]).join('; ')
      ?? (res.headers.get('set-cookie') ?? '').split(';')[0];
    expect(cookie).toBeTruthy();
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  let code: string;

  it('authorize: skip_consent client gets an immediate code redirect', async () => {
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid email profile',
      state: 'dogfood-state',
    });
    const res = await stack.api(`/auth/oauth2/authorize?${qs}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    expect([302, 303]).toContain(res.status);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith(REDIRECT_URI)).toBe(true);
    const url = new URL(location);
    expect(url.searchParams.get('state')).toBe('dogfood-state');
    expect(url.searchParams.get('error')).toBeNull();
    code = url.searchParams.get('code') ?? '';
    expect(code).toBeTruthy();
  });

  it('token exchange succeeds and persists the access-token row (the 1.7-drift 500)', async () => {
    const res = await stack.api('/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });
    const body: any = await res.json();
    // Pre-fix this was a 500: `table sys_oauth_access_token has no column
    // named authorizationCodeId`.
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.access_token).toBeTruthy();
    expect(body.id_token).toBeTruthy();

    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const rows = await ql.find('sys_oauth_access_token', {
      // `where`, not the wire spelling `filters` — that key was silently
      // dropped (#4371), so this assertion used to scan the whole table.
      where: { client_id: CLIENT_ID },
      context: { isSystem: true },
    });
    const list = Array.isArray(rows) ? rows : (rows?.records ?? []);
    expect(list.length).toBeGreaterThan(0);
    // The drift column: better-auth writes authorizationCodeId on every
    // code-grant issuance; the mapping must land it in snake_case.
    expect(list[0].authorization_code_id).toBeTruthy();
  });

  it('userinfo answers with the signed-in subject', async () => {
    const tokenRes = await stack.api('/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        // Single-use code was consumed above — mint a fresh one.
        code: await (async () => {
          const qs = new URLSearchParams({
            response_type: 'code',
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            scope: 'openid email profile',
          });
          const res = await stack.api(`/auth/oauth2/authorize?${qs}`, {
            headers: { Cookie: cookie },
            redirect: 'manual',
          });
          return new URL(res.headers.get('location') ?? '').searchParams.get('code') ?? '';
        })(),
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });
    const { access_token } = (await tokenRes.json()) as any;
    expect(access_token).toBeTruthy();

    const res = await stack.api('/auth/oauth2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const info: any = await res.json();
    expect(res.status, JSON.stringify(info)).toBe(200);
    expect(info.email).toBe('admin@objectos.ai');
  });
});
