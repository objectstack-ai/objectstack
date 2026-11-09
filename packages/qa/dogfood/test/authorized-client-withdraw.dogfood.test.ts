// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31048] Withdrawing an authorized AI assistant, over HTTP on the real
 * showcase stack: the assistant's token is refused at the MCP door on its very
 * next call, and its refresh grant mints nothing.
 *
 * The consent page tells a person they can withdraw an assistant's access at
 * any time. The console lists the assistants a person authorized
 * (`GET /auth/authorized-clients`, and `GET /auth/admin/authorized-clients` for
 * an administrator); these pins hold the two withdraws beside them:
 *
 *  - `POST /auth/authorized-clients/withdraw { id }`: the person withdraws
 *    their own. Another member naming that id gets the same 404 as an id that
 *    names nothing, and the assistant keeps working.
 *  - `POST /auth/admin/authorized-clients/withdraw { userId, id }`: a platform
 *    administrator withdraws a person's; a member is refused 403 and nothing
 *    moves.
 *
 * Each withdraw deletes the consent through better-auth's own adapter, so
 * plugin-audit's generic writer records it exactly as it records the grant:
 * a `create` row when the consent page writes the consent, a `delete` row when
 * the withdraw removes it, credited to whoever withdrew it (the person on the
 * own door, the administrator on the admin door). The access
 * matrix (unknown ids, foreign keys, every non-admin caller) is pinned on the
 * real plugin in `plugin-auth` `authorized-clients-read.real-plugin.test.ts`.
 */

import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } };
const PASSWORD = 'Member-Pass-123';
const REDIRECT_URI = 'http://127.0.0.1:33420/callback';
const SCOPE = 'openid profile email offline_access data:read';

const OWNER_EMAIL = 'withdraw.owner.31048@verify.test';
const OTHER_EMAIL = 'withdraw.other.31048@verify.test';

interface AgentGrant {
  clientId: string;
  accessToken: string;
  refreshToken: string;
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.value) ? r.value : (r?.records ?? []));

// The one showcase boot every describe below shares, and the helpers that drive the
// real routes: DCR, consent, the MCP door and the token endpoint.
let stack: VerifyStack;
let adminToken: string;
let ql: any;
let resource: string;
let priorOidc: string | undefined;
let ownerId: string;
let ownerSession: string;
let otherSession: string;

const tokenEndpoint = (form: Record<string, string>) =>
  stack.api('/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });

/**
 * DCR → sign-in → authorize with the MCP resource → consent → code exchange.
 * Hand it a `clientId` to authorize a client already registered instead.
 */
const consentAgent = async (email: string, clientId?: string): Promise<AgentGrant> => {
  const regBody: any = clientId ? { client_id: clientId } : await registerAgent();
  return authorizeAgent(email, regBody.client_id);
};

/** Dynamic client registration of a public native client. */
const registerAgent = async (): Promise<any> => {
  const reg = await stack.api('/auth/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'withdraw pin',
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
  return regBody;
};

const authorizeAgent = async (email: string, registeredClientId: string): Promise<AgentGrant> => {
  const regBody = { client_id: registeredClientId };
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

const initialize = (token: string) =>
  stack.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'withdraw-pin', version: '0.0.0' } },
    }),
  });

const refresh = (grant: AgentGrant) =>
  tokenEndpoint({ grant_type: 'refresh_token', refresh_token: grant.refreshToken, client_id: grant.clientId, resource });

/** The consent id the own read answers for `clientId`. */
const consentIdOf = async (session: string, clientId: string): Promise<string> => {
  const res = await stack.apiAs(session, 'GET', '/auth/authorized-clients');
  const body: any = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  const row = body.data.clients.find((c: any) => c.clientId === clientId);
  expect(row, `the own read lists ${clientId}`).toBeDefined();
  return String(row.id);
};

const consentRows = async (id: string) => rowsOf(await ql.find('sys_oauth_consent', { where: { id }, limit: 5, ...SYS }));

/** plugin-audit's rows for one consent, polled: generic rows land after the response. */
const auditRowsFor = async (id: string, action: string): Promise<any[]> => {
  let rows: any[] = [];
  for (let i = 0; i < 40; i++) {
    rows = rowsOf(
      await ql.find('sys_audit_log', { where: { object_name: 'sys_oauth_consent', record_id: id, action }, limit: 10, ...SYS }),
    );
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return rows;
};

beforeAll(async () => {
  // The OAuth authorization server is opt-in, read when the auth manager is
  // constructed, so it precedes the boot. plugin-audit is what turns the
  // adapter's consent writes into generic audit rows.
  priorOidc = process.env.OS_OIDC_PROVIDER_ENABLED;
  process.env.OS_OIDC_PROVIDER_ENABLED = 'true';
  stack = await bootShowcase({ extraPlugins: [new MCPServerPlugin(), new AuditPlugin()] });
  adminToken = await stack.signIn();
  ql = await stack.kernel.getServiceAsync('objectql');
  resource = ((await stack.kernel.getServiceAsync('auth')) as any).getMcpResourceUrl();

  ownerSession = await stack.signUp(OWNER_EMAIL, PASSWORD);
  const me = await stack.apiAs(ownerSession, 'GET', '/auth/get-session');
  ownerId = String(((await me.json()) as any)?.user?.id ?? '');
  expect(ownerId).not.toBe('');
  otherSession = await stack.signUp(OTHER_EMAIL, PASSWORD);
}, 300_000);

afterAll(async () => {
  await stack?.stop?.();
  if (priorOidc === undefined) delete process.env.OS_OIDC_PROVIDER_ENABLED;
  else process.env.OS_OIDC_PROVIDER_ENABLED = priorOidc;
});

describe('#31048 withdrawing an authorized AI assistant refuses its token on the next call', () => {
  it('the own door: another member\'s attempt is the same 404 as an unknown id and moves nothing; the person\'s own withdraw refuses the token and its refresh', async () => {
    const grant = await consentAgent(OWNER_EMAIL);
    const id = await consentIdOf(ownerSession, grant.clientId);
    const served = await initialize(grant.accessToken);
    expect(served.status, `precondition: the token is served ${await served.clone().text()}`).toBe(200);
    expect((await auditRowsFor(id, 'create')).length, 'the grant is audited by the generic writer').toBeGreaterThan(0);

    const others = await stack.apiAs(otherSession, 'POST', '/auth/authorized-clients/withdraw', { id });
    const unknown = await stack.apiAs(otherSession, 'POST', '/auth/authorized-clients/withdraw', { id: 'consent_nobody_31048' });
    const othersText = await others.text();
    expect(others.status, othersText).toBe(404);
    expect(JSON.parse(othersText).error.code).toBe('RESOURCE_NOT_FOUND');
    expect(othersText, 'the refusal says nothing about whether the id exists').toBe(await unknown.text());
    expect(await consentRows(id), 'the owner\'s consent stays').toHaveLength(1);
    const stillServed = await initialize(grant.accessToken);
    expect(stillServed.status, await stillServed.clone().text()).toBe(200);

    const withdrawn = await stack.apiAs(ownerSession, 'POST', '/auth/authorized-clients/withdraw', { id });
    const withdrawnBody: any = await withdrawn.json();
    expect(withdrawn.status, JSON.stringify(withdrawnBody)).toBe(200);
    expect(withdrawnBody).toEqual({ success: true, data: { id } });

    expect(await consentRows(id)).toEqual([]);
    const refused = await initialize(grant.accessToken);
    expect(refused.status, `the withdrawn token is refused on its next call ${await refused.clone().text()}`).toBe(401);
    const renewed = await refresh(grant);
    const renewedBody: any = await renewed.json();
    expect(renewed.status, `the refresh grant mints nothing ${JSON.stringify(renewedBody)}`).toBe(400);
    expect(renewedBody?.error).toBe('invalid_grant');

    const deletes = await auditRowsFor(id, 'delete');
    expect(deletes, 'the withdraw is audited as the grant is: a generic delete row').toHaveLength(1);
    expect(deletes[0].user_id, 'credited to the person who withdrew it').toBe(ownerId);
  });

  it('the admin door: a member is refused 403 and nothing moves; a platform administrator withdraws the person\'s grant', async () => {
    const grant = await consentAgent(OWNER_EMAIL);
    const id = await consentIdOf(ownerSession, grant.clientId);

    const member = await stack.apiAs(otherSession, 'POST', '/auth/admin/authorized-clients/withdraw', { userId: ownerId, id });
    const memberText = await member.text();
    expect(member.status, memberText).toBe(403);
    expect(JSON.parse(memberText).error.code).toBe('PERMISSION_DENIED');
    expect(await consentRows(id)).toHaveLength(1);

    const admin = await stack.apiAs(adminToken, 'POST', '/auth/admin/authorized-clients/withdraw', { userId: ownerId, id });
    const adminBody: any = await admin.json();
    expect(admin.status, JSON.stringify(adminBody)).toBe(200);
    expect(adminBody).toEqual({ success: true, data: { id } });
    expect(await consentRows(id)).toEqual([]);
    const refused = await initialize(grant.accessToken);
    expect(refused.status, await refused.clone().text()).toBe(401);

    const adminMe = await stack.apiAs(adminToken, 'GET', '/auth/get-session');
    const adminId = String(((await adminMe.json()) as any)?.user?.id ?? '');
    expect(adminId).not.toBe('');
    expect(adminId).not.toBe(ownerId);
    const deletes = await auditRowsFor(id, 'delete');
    expect(deletes, 'the admin withdraw is audited as the own one is: a generic delete row').toHaveLength(1);
    expect(deletes[0].user_id, 'credited to the administrator who withdrew it, not the person').toBe(adminId);
  });
});

describe('[objectstack-ai/cloud#3820, card 2] disabling an AI assistant\'s client refuses its token on the next call', () => {
  /** `POST /auth/admin/oauth2/toggle-disabled`: the route the Disable / Enable actions of `sys_oauth_application` call. */
  const toggle = (session: string, clientId: string, disabled: boolean) =>
    stack.apiAs(session, 'POST', '/auth/admin/oauth2/toggle-disabled', { client_id: clientId, disabled });

  it('⭐ the token minted before the disable is refused 401 and its refresh mints nothing; enabled again, the grant is served and a new authorization works', async () => {
    const grant = await consentAgent(OWNER_EMAIL);
    const id = await consentIdOf(ownerSession, grant.clientId);
    const served = await initialize(grant.accessToken);
    expect(served.status, `precondition: the token is served ${await served.clone().text()}`).toBe(200);

    const member = await toggle(otherSession, grant.clientId, true);
    const memberText = await member.text();
    expect(member.status, memberText).toBe(403);
    expect(JSON.parse(memberText).error.code).toBe('PERMISSION_DENIED');
    const stillServed = await initialize(grant.accessToken);
    expect(stillServed.status, `a refused toggle moves nothing ${await stillServed.clone().text()}`).toBe(200);

    const off = await toggle(adminToken, grant.clientId, true);
    const offBody: any = await off.json();
    expect(off.status, JSON.stringify(offBody)).toBe(200);
    expect(offBody).toEqual({ success: true, data: { client_id: grant.clientId, disabled: true } });

    const refused = await initialize(grant.accessToken);
    expect(refused.status, `the token minted before the disable is refused on its next call ${await refused.clone().text()}`).toBe(401);
    const renewed = await refresh(grant);
    const renewedBody: any = await renewed.json();
    expect(renewed.status, JSON.stringify(renewedBody)).toBe(400);
    expect(renewedBody?.error).toBe('invalid_client');
    expect(await consentRows(id), 'a pause, not a withdraw: the grant itself stays').toHaveLength(1);

    const on = await toggle(adminToken, grant.clientId, false);
    expect(on.status, await on.clone().text()).toBe(200);

    const resumed = await initialize(grant.accessToken);
    expect(resumed.status, `enabled again, the same grant is served ${await resumed.clone().text()}`).toBe(200);
    const fresh = await refresh(grant);
    const freshBody: any = await fresh.json();
    expect(fresh.status, JSON.stringify(freshBody)).toBe(200);
    expect((await initialize(freshBody.access_token)).status).toBe(200);
    const again = await consentAgent(OTHER_EMAIL, grant.clientId);
    expect((await initialize(again.accessToken)).status, 'a new person\'s consent and token work on the enabled client').toBe(200);
  });
});
