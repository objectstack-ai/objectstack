// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: one showcase boot for the whole file, two DCR-to-token flows driven against its MCP door and token endpoint, and one timed ban waited out to its expiry; 13.13 s of tests, the slower of two local runs on a shared agent box, x 1.25, rounded up, no CI reading yet, re-measure on CI

/**
 * A banned user's OAuth access tokens and refresh grants are refused while the
 * ban holds.
 *
 * A ban ends the user's sessions, refuses their sign-in and refuses their API
 * keys. An OAuth access token the user consented to, and the refresh token
 * that renews it, are credentials of that same user, so while the ban holds:
 *
 *  - at the MCP door, the user's access token answers exactly as a token that
 *    does not verify: `initialize`, a read tool and a write tool all get the
 *    same status, body and `WWW-Authenticate` header a made-up token gets, and
 *    the refused write lands nothing;
 *  - at the token endpoint, the user's refresh grant answers exactly as an
 *    invalid refresh token does (`400 invalid_grant`, the same description and
 *    headers), and mints nothing.
 *
 * Both are read where the credential becomes its user, with the one ban
 * predicate the sign-in, session and API-key refusals share: the ban flag, and
 * its expiry. A ban with an expiry stops binding once it expires.
 *
 * ⛔ Not a revocation: no token row is written. Once the ban is lifted the SAME
 * access token is served again and the SAME refresh token renews, with nothing
 * reissued.
 *
 * Controls, which keep today's answer: before the ban the token initializes,
 * reads, writes and renews; another user's token keeps working during the ban;
 * after the unban, and after a timed ban expires, the same credentials work.
 * The read cost and the store-fault answer are pinned on the resolver
 * (`packages/runtime/src/security/resolve-execution-context.test.ts`) and the
 * grant refusal on its own module (`plugin-auth` `oauth-grant-ban-refusal`).
 */

import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const OBJECT = 'showcase_private_note';
const SYS = { context: { isSystem: true } };
const PASSWORD = 'Member-Pass-123';
const REDIRECT_URI = 'http://127.0.0.1:33419/callback';
const SCOPE = 'openid profile email offline_access data:read data:write';

/** One door's answer, reduced to what a caller can tell apart. */
interface DoorAnswer {
  status: number;
  body: unknown;
  wwwAuthenticate: string | null;
  cacheControl: string | null;
}

interface AgentGrant {
  clientId: string;
  accessToken: string;
  refreshToken: string;
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.value) ? r.value : []);

describe('a banned user\'s OAuth access tokens and refresh grants are refused while the ban holds', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let ql: any;
  let resource: string;
  let priorScim: string | undefined;
  let priorOidc: string | undefined;

  const BANNED_EMAIL = 'oauth.banned.subject@verify.test';
  const PEER_EMAIL = 'oauth.banned.peer@verify.test';
  let bannedUserId: string;
  let banned: AgentGrant;
  let peer: AgentGrant;
  /** A JWS-shaped bearer nothing signed — the answer every MCP refusal is compared to. */
  const madeUpToken = [randomBytes(24), randomBytes(48), randomBytes(32)].map((b) => b.toString('base64url')).join('.');

  const answerOf = async (res: Response): Promise<DoorAnswer> => {
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    return {
      status: res.status,
      body,
      wwwAuthenticate: res.headers.get('www-authenticate'),
      cacheControl: res.headers.get('cache-control'),
    };
  };

  /** DCR → sign-in → authorize with the MCP resource → consent → code exchange. */
  const consentAgent = async (email: string): Promise<AgentGrant> => {
    const reg = await stack.api('/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'banned-subject pin',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        scope: SCOPE,
      }),
    });
    const regBody: any = await reg.json();
    expect(reg.status, JSON.stringify(regBody)).toBe(201);
    const signIn = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const cookie = ((signIn.headers as any).getSetCookie() as string[]).map((c) => c.split(';')[0]).join('; ');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const qs = new URLSearchParams({
      client_id: regBody.client_id,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPE,
      state: 'st',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource,
    });
    const az = await stack.api(`/auth/oauth2/authorize?${qs}`, { headers: { cookie }, redirect: 'manual' });
    const loc = az.headers.get('location') ?? '';
    let code = new URL(loc, 'http://localhost:3000').searchParams.get('code');
    if (!code) {
      const consent = await stack.api('/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:3000' },
        body: JSON.stringify({ accept: true, oauth_query: loc.slice(loc.indexOf('?')) }),
      });
      const cb: any = await consent.json().catch(() => null);
      code = new URL(cb?.redirect_uri ?? cb?.url).searchParams.get('code');
    }
    const tok = await tokenEndpoint({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: regBody.client_id,
      code_verifier: verifier,
      resource,
    });
    const tj: any = await tok.json();
    expect(tok.status, JSON.stringify(tj)).toBe(200);
    expect(tj.refresh_token, 'offline_access yields a refresh token').toBeTruthy();
    return { clientId: regBody.client_id, accessToken: tj.access_token, refreshToken: tj.refresh_token };
  };

  const tokenEndpoint = (form: Record<string, string>) =>
    stack.api('/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  const refresh = (grant: AgentGrant, refreshToken = grant.refreshToken, clientId = grant.clientId) =>
    tokenEndpoint({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource });

  const mcp = (token: string, method: string, params?: unknown) =>
    stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params !== undefined ? { params } : {}) }),
    });
  const initialize = (token: string) =>
    mcp(token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'banned-subject-pin', version: '0.0.0' },
    });
  const queryRecords = (token: string) =>
    mcp(token, 'tools/call', { name: 'query_records', arguments: { objectName: OBJECT } });
  const createRecord = (token: string, title: string) =>
    mcp(token, 'tools/call', { name: 'create_record', arguments: { objectName: OBJECT, data: { title } } });

  const notesTitled = async (title: string): Promise<any[]> =>
    rowsOf(await ql.find(OBJECT, { where: { title }, limit: 5, ...SYS }));

  const ban = async (body: Record<string, unknown>) => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/ban-user', { userId: bannedUserId, ...body });
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const unban = async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/unban-user', { userId: bannedUserId });
    expect(res.status, await res.clone().text()).toBe(200);
  };

  /** The token initializes, reads, writes (as its user) at the MCP door. */
  const expectAccessTokenServed = async (grant: AgentGrant, userId: string | undefined, label: string) => {
    const init = await initialize(grant.accessToken);
    expect(init.status, `${label}: initialize ${await init.clone().text()}`).toBe(200);
    const read = await queryRecords(grant.accessToken);
    const readBody: any = await read.json();
    expect(read.status, `${label}: query_records`).toBe(200);
    expect(readBody?.result?.isError, `${label}: query_records ${JSON.stringify(readBody)}`).not.toBe(true);
    const title = `served-${randomBytes(4).toString('hex')}`;
    const write = await createRecord(grant.accessToken, title);
    const writeBody: any = await write.json();
    expect(write.status, `${label}: create_record`).toBe(200);
    expect(writeBody?.result?.isError, `${label}: create_record ${JSON.stringify(writeBody)}`).not.toBe(true);
    const [row] = await notesTitled(title);
    expect(row, `${label}: the write landed`).toBeDefined();
    if (userId) expect(row.created_by, `${label}: written as the token's user`).toBe(userId);
  };

  /** Every MCP call answers the banned user's token exactly as it answers a made-up token. */
  const expectAccessTokenAnsweredAsMadeUp = async (label: string) => {
    const init = await answerOf(await initialize(banned.accessToken));
    const initControl = await answerOf(await initialize(madeUpToken));
    expect(initControl.status, `${label}: a made-up token's initialize is refused`).toBe(401);
    expect(init, `${label}: initialize`).toEqual(initControl);

    const read = await answerOf(await queryRecords(banned.accessToken));
    const readControl = await answerOf(await queryRecords(madeUpToken));
    expect(readControl.status, `${label}: a made-up token's read is refused`).toBe(401);
    expect(read, `${label}: query_records`).toEqual(readControl);

    const title = `refused-${randomBytes(4).toString('hex')}`;
    const write = await answerOf(await createRecord(banned.accessToken, title));
    const writeControl = await answerOf(await createRecord(madeUpToken, `${title}-control`));
    expect(writeControl.status, `${label}: a made-up token's write is refused`).toBe(401);
    expect(write, `${label}: create_record`).toEqual(writeControl);
    expect(await notesTitled(title), `${label}: the refused write landed nothing`).toEqual([]);
  };

  /**
   * The banned user's refresh grant answers exactly as an invalid refresh
   * token does. The control is a real refresh token presented by a client it
   * was not issued to, which the endpoint answers as an invalid refresh token.
   */
  const expectRefreshAnsweredAsInvalid = async (label: string) => {
    const refused = await answerOf(await refresh(banned));
    const control = await answerOf(await refresh(peer, peer.refreshToken, banned.clientId));
    expect(control.status, `${label}: the invalid refresh token is refused`).toBe(400);
    expect((control.body as any)?.error, `${label}: control`).toBe('invalid_grant');
    expect(refused, `${label}: refresh grant`).toEqual(control);
  };

  /** A refresh that renews: a new access token, and the rotated refresh token kept for the next call. */
  const expectRefreshServed = async (grant: AgentGrant, label: string) => {
    const res = await refresh(grant);
    const body: any = await res.json();
    expect(res.status, `${label}: refresh ${JSON.stringify(body)}`).toBe(200);
    expect(body.access_token, `${label}: a new access token`).toBeTruthy();
    if (body.refresh_token) grant.refreshToken = body.refresh_token;
    grant.accessToken = body.access_token;
  };

  beforeAll(async () => {
    // The ban routes answer 501 unless better-auth's admin plugin is on (SCIM
    // forces it on), and the OAuth authorization server is opt-in. Both are
    // read when the auth manager is constructed, so they precede the boot.
    priorScim = process.env.OS_SCIM_ENABLED;
    priorOidc = process.env.OS_OIDC_PROVIDER_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    process.env.OS_OIDC_PROVIDER_ENABLED = 'true';
    stack = await bootShowcase({
      extraPlugins: [new MCPServerPlugin()],
      security: showcaseAppDefaultSecurity(),
    });
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    resource = ((await stack.kernel.getServiceAsync('auth')) as any).getMcpResourceUrl();

    const bannedSession = await stack.signUp(BANNED_EMAIL, PASSWORD);
    const me = await stack.apiAs(bannedSession, 'GET', '/auth/get-session');
    expect(me.status).toBe(200);
    bannedUserId = String(((await me.json()) as any)?.user?.id ?? '');
    expect(bannedUserId).not.toBe('');
    await stack.signUp(PEER_EMAIL, PASSWORD);

    banned = await consentAgent(BANNED_EMAIL);
    peer = await consentAgent(PEER_EMAIL);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
    if (priorOidc === undefined) delete process.env.OS_OIDC_PROVIDER_ENABLED;
    else process.env.OS_OIDC_PROVIDER_ENABLED = priorOidc;
  });

  it('control: before the ban, the access token initializes, reads and writes as its user, and the refresh grant renews it', async () => {
    await expectAccessTokenServed(banned, bannedUserId, 'before the ban');
    await expectRefreshServed(banned, 'before the ban');
    await expectAccessTokenServed(banned, bannedUserId, 'renewed, before the ban');
  });

  it('while the ban holds, the access token answers as a token that does not verify, and the refresh grant as an invalid refresh token', async () => {
    const accessBefore = banned.accessToken;
    const refreshBefore = banned.refreshToken;
    await ban({ banReason: 'oauth-credential-pin' });
    try {
      await expectAccessTokenAnsweredAsMadeUp('banned');
      await expectRefreshAnsweredAsInvalid('banned');

      // Another user's token and refresh are not touched by this user's ban.
      await expectAccessTokenServed(peer, undefined, 'peer during the ban');
      await expectRefreshServed(peer, 'peer during the ban');
    } finally {
      await unban();
    }
    // Nothing was reissued in between: the credentials are the ones held before the ban.
    expect(banned.accessToken).toBe(accessBefore);
    expect(banned.refreshToken).toBe(refreshBefore);
  });

  it('the ban revokes nothing: once lifted, the same access token is served and the same refresh token renews', async () => {
    await expectAccessTokenServed(banned, bannedUserId, 'after the unban');
    await expectRefreshServed(banned, 'after the unban');
  });

  it('a ban with an expiry binds until it expires, and not after', async () => {
    await ban({ banReason: 'timed-oauth-credential-pin', banExpiresIn: 3 });
    try {
      await expectAccessTokenAnsweredAsMadeUp('timed ban, before expiry');
      await expectRefreshAnsweredAsInvalid('timed ban, before expiry');
      await new Promise((r) => setTimeout(r, 3_500));
      // No sign-in lapses the ban on the row first: the expiry alone decides.
      await expectAccessTokenServed(banned, bannedUserId, 'timed ban, after expiry');
      await expectRefreshServed(banned, 'timed ban, after expiry');
    } finally {
      await unban();
    }
  }, 60_000);
});
