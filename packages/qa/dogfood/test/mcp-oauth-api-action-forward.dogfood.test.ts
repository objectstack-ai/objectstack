// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28178 → #28367] An AI agent connected to MCP over OAuth runs a same-origin
// `type: 'api'` action. The action doors forward it in-process, and the
// platform honours an OAuth access token on the MCP endpoint only.
//
// #28178 (ruled B) made the gap loud: one table of credential kind × target
// door, shared by `run_action` and `list_actions`, refuses such a forward by
// name before the target is called. #28367 (ADR-0090 D10 rule 5, ruled A,
// records 6545950368 and 6548923676) is the other branch: at exactly two cells
// of that table, `oauth` × `identity` and `oauth` × `platform`, the forward
// carries a credential the server mints for that one forward instead of the
// agent's token, and the target resolves it to the SAME agent principal. The
// platform cell is bounded by the scope-family rule. Every other cell keeps
// its answer, `api_key` × `identity` included.
//
// What this file pins, against a booted showcase and REAL OAuth access tokens
// (DCR → authorize with the MCP resource → consent → token):
//
//   - each flipped cell served for a real agent, and the audit row of each
//     write naming both the agent (`performed_by`) and its user (`on_behalf_of`);
//   - the kept refusals, by name: `api_key` × `identity`, a state-changing
//     metadata-door forward, and the scope-family refusals of a read-only
//     agent at an identity target and at a platform target;
//   - no session: a forward leaves no `sys_session` row and no credential
//     header in the tool result, and what the identity route was shown cannot
//     be presented from outside;
//   - the credential's outside face: a request from the network presenting the
//     header is nobody;
//   - the boundary, unmoved: the same OAuth token presented to the data door
//     or an identity route directly is still refused.
//
// The credential's per-forward properties (replay, method or route mismatch,
// expiry) are pinned on the module that mints it
// (`packages/rest/src/forward-credential.test.ts`); the intersection at the
// target (a plain member's agent refused by the identity route itself) beside
// the system-object actions (`mcp-system-object-action-exposure.dogfood.test.ts`).

import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { AuditPlugin } from '@objectstack/plugin-audit';
import showcaseStack from '@objectstack/example-showcase';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);
const REDIRECT_URI = 'http://127.0.0.1:33418/callback';
const ai = (d: string) => ({ exposed: true, description: d });
const FULL_SCOPE = 'openid profile email offline_access data:read data:write actions:execute';
const READ_SCOPE = 'openid profile email offline_access data:read actions:execute';
const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
/** `@objectstack/rest` `FORWARD_CREDENTIAL_HEADER`, spelled here as a caller from outside would send it. */
const FORWARD_CREDENTIAL_HEADER = 'x-objectstack-forward-credential';

const Probe = ObjectSchema.create({
  name: 'probe_fwd_thing',
  label: 'Forward Probe',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name' }) },
  actions: [
    { name: 'probe_update_me', label: 'Update Me', type: 'api', method: 'POST', target: '/api/v1/auth/update-user', bodyExtra: { name: 'Renamed By Agent' }, locations: ['record_header'], ai: ai('Rename the signed-in user through the identity route as the caller.') },
    { name: 'probe_data_patch', label: 'Data Patch', type: 'api', method: 'PATCH', target: '/api/v1/data/probe_fwd_thing/${ctx.recordId}', bodyExtra: { name: 'patched' }, locations: ['record_header'], ai: ai('Patch the probe record through the data door as the caller.') },
    { name: 'probe_ban', label: 'Ban', type: 'api', method: 'POST', target: '/api/v1/auth/admin/ban-user', params: [{ name: 'userId', label: 'User', type: 'text', required: true }], locations: ['record_header'], ai: ai('Ban the probe target user through the better-auth admin endpoint.') },
    { name: 'probe_meta_put', label: 'Meta Put', type: 'api', method: 'PUT', target: '/api/v1/meta/object/probe_fwd_thing', locations: ['record_header'], ai: ai('Rewrite the probe object definition through the metadata door.') },
  ],
} as any);

describe('[#28367] an OAuth-connected agent and api actions: the two flipped cells served as the agent, every kept refusal by name, boundary unmoved', () => {
  let stack: VerifyStack;
  let ql: any;
  let session: string;
  let apiKey: string;
  let oauth: string;
  let oauthRead: string;
  let clientId: string;
  let adminId: string;
  let recordId: string;
  let banTarget = '';
  let memberBanTarget = '';
  let prior: string | undefined;
  let priorOidc: string | undefined;

  const rpc = async (headers: Record<string, string>, name: string, args: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const text = await res.text();
    const parsed: any = JSON.parse(text);
    const content = parsed?.result?.content?.[0]?.text;
    return { http: res.status, text, isError: parsed?.result?.isError === true, body: content ? JSON.parse(content) : parsed };
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const runAction = (headers: Record<string, string>, actionName: string, args: Record<string, unknown> = {}) =>
    rpc(headers, 'run_action', { actionName, objectName: 'probe_fwd_thing', recordId, ...args });
  const listProbeActions = async (headers: Record<string, string>) => {
    const r = await rpc(headers, 'list_actions', {});
    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    return Object.fromEntries((r.body.actions as any[]).filter((a) => a.objectName === 'probe_fwd_thing').map((a) => [a.name, a]));
  };
  const rowName = async () =>
    rowsOf(await ql.find('probe_fwd_thing', { where: { id: recordId }, limit: 1 }, { context: SYS }))[0]?.name;
  const setRowName = (name: string) => ql.update('probe_fwd_thing', { id: recordId, name }, { context: SYS });
  const isBanned = async (id: string) =>
    rowsOf(await ql.find('sys_user', { where: { id }, limit: 1 }, { context: SYS }))[0]?.banned === true;
  const idOf = async (email: string) =>
    String(rowsOf(await ql.find('sys_user', { where: { email }, limit: 1 }, { context: SYS }))[0]?.id);
  const sessionCount = async () => rowsOf(await ql.find('sys_session', { context: SYS })).length;
  /**
   * The dual attribution on the WRITE's audit row for `record` on `object` —
   * not the action-invocation row the door also records (that one carries a
   * `surface`, and is written whatever the target does).
   */
  const agentWriteAttribution = async (object: string, record: string) => {
    let found: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const rows = rowsOf(await ql.find('sys_audit_log', { where: { object_name: object, record_id: record }, context: SYS }));
      const metas = rows
        .map((r) => { try { return JSON.parse(String(r.metadata)); } catch { return undefined; } })
        .filter((m) => m && typeof m === 'object' && 'performed_by' in m && !('surface' in m));
      found = metas[metas.length - 1];
      expect(found, `a write audit row naming the agent for ${object}/${record}`).toBeDefined();
    }, { timeout: 10_000 });
    return found;
  };

  const mintAgentToken = async (who: { email: string; password: string }, scope: string): Promise<{ token: string; clientId: string }> => {
    const authSvc: any = await stack.kernel.getServiceAsync('auth');
    const resource = authSvc.getMcpResourceUrl();
    const reg = await stack.api('/auth/oauth2/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'fwd probe', redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native', scope }),
    });
    const regBody: any = await reg.json();
    expect(reg.status, JSON.stringify(regBody)).toBe(201);
    const signin = await stack.api('/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who) });
    const cookie = ((signin.headers as any).getSetCookie() as string[]).map((c) => c.split(';')[0]).join('; ');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const qs = new URLSearchParams({ client_id: regBody.client_id, redirect_uri: REDIRECT_URI, response_type: 'code', scope, state: 'st', code_challenge: challenge, code_challenge_method: 'S256', resource });
    const az = await stack.api(`/auth/oauth2/authorize?${qs}`, { headers: { cookie }, redirect: 'manual' });
    const loc = az.headers.get('location') ?? '';
    let code = new URL(loc, 'http://localhost:3000').searchParams.get('code');
    if (!code) {
      const consent = await stack.api('/auth/oauth2/consent', { method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:3000' }, body: JSON.stringify({ accept: true, oauth_query: loc.slice(loc.indexOf('?')) }) });
      const cb: any = await consent.json().catch(() => null);
      code = new URL(cb?.redirect_uri ?? cb?.url).searchParams.get('code');
    }
    const tok = await stack.api('/auth/oauth2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT_URI, client_id: regBody.client_id, code_verifier: verifier, resource }).toString(),
    });
    const tj: any = await tok.json();
    expect(tok.status, JSON.stringify(tj)).toBe(200);
    return { token: tj.access_token, clientId: regBody.client_id };
  };

  beforeAll(async () => {
    prior = process.env.OS_SCIM_ENABLED;
    priorOidc = process.env.OS_OIDC_PROVIDER_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    process.env.OS_OIDC_PROVIDER_ENABLED = 'true';
    const declared = showcaseStack as unknown as { objects?: unknown[] };
    stack = await bootShowcase(
      { extraPlugins: [new MCPServerPlugin(), new AuditPlugin()] },
      { ...(showcaseStack as unknown as Record<string, unknown>), objects: [...(declared.objects ?? []), Probe] },
    );
    session = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await idOf(ADMIN.email);
    const created = await stack.apiAs(session, 'POST', '/data/probe_fwd_thing', { name: 'probe' });
    const cj: any = await created.json();
    recordId = String(cj?.data?.id ?? cj?.id);
    await stack.signUp('fwd.target@example.com', 'Target-Pass-123');
    banTarget = await idOf('fwd.target@example.com');
    await stack.signUp('fwd.member.target@example.com', 'Target-Pass-123');
    memberBanTarget = await idOf('fwd.member.target@example.com');
    const k = await stack.apiAs(session, 'POST', '/keys', { name: 'fwd-probe' });
    const kj: any = await k.json();
    apiKey = String(kj?.data?.key);
    ({ token: oauth, clientId } = await mintAgentToken(ADMIN, FULL_SCOPE));
    ({ token: oauthRead } = await mintAgentToken(ADMIN, READ_SCOPE));
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (prior === undefined) delete process.env.OS_SCIM_ENABLED; else process.env.OS_SCIM_ENABLED = prior;
    if (priorOidc === undefined) delete process.env.OS_OIDC_PROVIDER_ENABLED; else process.env.OS_OIDC_PROVIDER_ENABLED = priorOidc;
  });

  it('anti-vacuity: the admin, the agent\'s client and the probe row all exist', () => {
    for (const v of [adminId, clientId, recordId, banTarget, memberBanTarget]) {
      expect(v).toMatch(/\S/);
      expect(v).not.toBe('undefined');
    }
  });

  it('list_actions: the full agent sees the flipped cells unmarked, and only the metadata-door write marked by name', async () => {
    const listed = await listProbeActions(bearer(oauth));

    expect(Object.keys(listed).sort()).toEqual(['probe_ban', 'probe_data_patch', 'probe_meta_put', 'probe_update_me']);
    for (const name of ['probe_ban', 'probe_data_patch', 'probe_update_me']) {
      expect(listed[name].unavailable, name).toBeUndefined();
    }
    expect(listed.probe_meta_put.unavailable?.code).toBe('PERMISSION_DENIED');
    expect(listed.probe_meta_put.unavailable?.reason).toMatch(/^Action 'probe_meta_put' sends a PUT request to the metadata endpoint .* does not change metadata through an action\. The action was not run\./);
  });

  it('oauth × platform: the agent\'s data-door write is served as the agent, and its audit row names both the agent and its user', async () => {
    await setRowName('probe');

    const r = await runAction(bearer(oauth), 'probe_data_patch');

    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    expect(await rowName()).toBe('patched');
    expect(await agentWriteAttribution('probe_fwd_thing', recordId)).toEqual({ performed_by: clientId, on_behalf_of: adminId });
  });

  it('oauth × identity: the agent\'s identity write is served for the delegating user, attributed to both, from a view that leaves no session of record', async () => {
    const before = await sessionCount();

    const r = await runAction(bearer(oauth), 'probe_update_me');

    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    const me = rowsOf(await ql.find('sys_user', { where: { id: adminId }, limit: 1 }, { context: SYS }))[0];
    expect(me?.name).toBe('Renamed By Agent');
    expect(await sessionCount()).toBe(before);
    expect(await agentWriteAttribution('sys_user', adminId)).toEqual({ performed_by: clientId, on_behalf_of: adminId });
    // No credential header rides back in the tool result.
    expect(r.text).not.toMatch(/set-auth-token|set-cookie|set-admin-session-token/i);
  });

  it('oauth × identity: the admin\'s agent bans through the admin route, attributed to the agent and the admin, with no session left behind', async () => {
    const before = await sessionCount();

    const r = await runAction(bearer(oauth), 'probe_ban', { params: { userId: banTarget } });

    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    expect(await isBanned(banTarget)).toBe(true);
    expect(await sessionCount()).toBeLessThanOrEqual(before);
    expect(await agentWriteAttribution('sys_user', banTarget)).toEqual({ performed_by: clientId, on_behalf_of: adminId });
  });

  // An `api` action's method is POST, PATCH, PUT or DELETE (the action schema
  // admits no other), so every forward an action can make changes state: a
  // read-consented agent runs none of them outside MCP. The rule's safe-method
  // clause is pinned on the predicate itself (`api-action-forward.test.ts`).
  it('the scope-family rule: a read-only agent is refused by name at a state-changing platform and identity target, before anything is sent', async () => {
    const listed = await listProbeActions(bearer(oauthRead));
    for (const name of ['probe_data_patch', 'probe_ban', 'probe_update_me']) {
      expect(listed[name].unavailable?.code, name).toBe('PERMISSION_DENIED');
      expect(listed[name].unavailable?.reason, name).toMatch(/which an AI agent may run only with the 'data:write' scope, and this connection was not granted it\. The action was not run\./);
    }

    await setRowName('untouched');
    const patch = await runAction(bearer(oauthRead), 'probe_data_patch');
    expect(patch.isError).toBe(true);
    expect(patch.body.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, message: listed.probe_data_patch.unavailable.reason });
    expect(await rowName()).toBe('untouched');

    const ban = await runAction(bearer(oauthRead), 'probe_ban', { params: { userId: memberBanTarget } });
    expect(ban.isError).toBe(true);
    expect(ban.body.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, message: listed.probe_ban.unavailable.reason });
    expect(await isBanned(memberBanTarget)).toBe(false);
  });

  it('kept refusal: a state-changing metadata-door forward stays outside the flip and is refused by name, whatever the scopes', async () => {
    const r = await runAction(bearer(oauth), 'probe_meta_put');

    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe('PERMISSION_DENIED');
    expect(r.body.error.message).toMatch(/^Action 'probe_meta_put' sends a PUT request to the metadata endpoint/);
  });

  it('kept refusal: an API key is still refused by name at the identity route, and its data-door action is still served', async () => {
    const asSession = await listProbeActions(bearer(session));
    expect(Object.entries(asSession).filter(([, a]: [string, any]) => a.unavailable).map(([n]) => n)).toEqual([]);

    const asKey = await listProbeActions({ 'x-api-key': apiKey });
    expect(asKey.probe_ban.unavailable?.code).toBe('UNAUTHENTICATED');
    expect(asKey.probe_ban.unavailable?.reason).toMatch(/identity endpoint/);
    expect(asKey.probe_data_patch.unavailable).toBeUndefined();
    const ban = await runAction({ 'x-api-key': apiKey }, 'probe_ban', { params: { userId: memberBanTarget } });
    expect(ban.isError).toBe(true);
    expect(ban.body.error.code).toBe('UNAUTHENTICATED');
    expect(await isBanned(memberBanTarget)).toBe(false);

    await setRowName('probe');
    const r = await runAction({ 'x-api-key': apiKey }, 'probe_data_patch');
    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    expect(await rowName()).toBe('patched');
  });

  it('the credential from outside the process is nobody: the header presented over the network resolves as no caller', async () => {
    const forged = randomBytes(32).toString('base64url');
    const data = await stack.api(`/data/probe_fwd_thing/${recordId}`, { headers: { [FORWARD_CREDENTIAL_HEADER]: forged } });
    expect(data.status).toBe(401);
    const identity = await stack.api('/auth/get-session', { headers: { [FORWARD_CREDENTIAL_HEADER]: forged } });
    const body: any = await identity.json().catch(() => null);
    expect(body?.user ?? null).toBeNull();
    const ban = await stack.api('/auth/admin/ban-user', {
      method: 'POST', headers: { 'content-type': 'application/json', [FORWARD_CREDENTIAL_HEADER]: forged },
      body: JSON.stringify({ userId: memberBanTarget }),
    });
    expect(ban.status).toBeGreaterThanOrEqual(400);
    expect(await isBanned(memberBanTarget)).toBe(false);
  });

  it('the boundary is unmoved: the same OAuth token presented to the data door or an identity route directly is still refused', async () => {
    const data = await stack.api(`/data/probe_fwd_thing/${recordId}`, { headers: bearer(oauth) });
    expect(data.status).toBe(401);
    const identity = await stack.api('/auth/get-session', { headers: bearer(oauth) });
    expect(identity.status).toBe(401);
  });
});
