// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28178] An AI agent connected to MCP over OAuth runs a same-origin
// `type: 'api'` action. The action doors forward it with the caller's OWN
// credentials, and the platform honours an OAuth access token on the MCP
// endpoint only, so the target read the agent as nobody and answered its
// anonymous 401. Ruled B (fable 总监决裁 5, Elon 2026-10-31): refuse by name
// before the forward, from one table of credential kind × target door that
// `run_action` and `list_actions` share, and MARK such an action in the
// listing instead of hiding it. A server-built forward credential that would
// let the agent through is a separate decision (#28367), so the last pin here
// is that the token is still refused when presented to a target directly.
//
// Booted showcase, a REAL OAuth access token (DCR → authorize with the MCP
// resource → consent → token), a session and an API key for the unchanged lanes.
import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import showcaseStack from '@objectstack/example-showcase';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);
const REDIRECT_URI = 'http://127.0.0.1:33418/callback';
const ai = (d: string) => ({ exposed: true, description: d });
let banTarget = '';

const Probe = ObjectSchema.create({
  name: 'probe_fwd_thing',
  label: 'Forward Probe',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name' }) },
  actions: [
    { name: 'probe_get_session', label: 'Get Session', type: 'api', method: 'POST', target: '/api/v1/auth/get-session', locations: ['record_header'], ai: ai('Read the session the forward target sees for this caller.') },
    { name: 'probe_data_patch', label: 'Data Patch', type: 'api', method: 'PATCH', target: '/api/v1/data/probe_fwd_thing/${ctx.recordId}', bodyExtra: { name: 'patched' }, locations: ['record_header'], ai: ai('Patch the probe record through the data door as the caller.') },
    { name: 'probe_ban', label: 'Ban', type: 'api', method: 'POST', target: '/api/v1/auth/admin/ban-user', params: [{ name: 'userId', label: 'User', type: 'text', required: true }], locations: ['record_header'], ai: ai('Ban the probe target user through the better-auth admin endpoint.') },
  ],
} as any);

describe('[#28178] an OAuth-connected agent and api actions: refused by name, marked in list_actions, boundary unmoved', () => {
  let stack: VerifyStack;
  let ql: any;
  let session: string;
  let apiKey: string;
  let oauth: string;
  let recordId: string;
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
    return { http: res.status, isError: parsed?.result?.isError === true, body: content ? JSON.parse(content) : parsed };
  };
  const runAction = (headers: Record<string, string>, actionName: string, args: Record<string, unknown> = {}) =>
    rpc(headers, 'run_action', { actionName, objectName: 'probe_fwd_thing', recordId, ...args });
  const listProbeActions = async (headers: Record<string, string>) => {
    const r = await rpc(headers, 'list_actions', {});
    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    return Object.fromEntries((r.body.actions as any[]).filter((a) => a.objectName === 'probe_fwd_thing').map((a) => [a.name, a]));
  };
  const rowName = async () =>
    rowsOf(await ql.find('probe_fwd_thing', { where: { id: recordId }, limit: 1 }, { context: SYS }))[0]?.name;
  const isBanned = async () =>
    rowsOf(await ql.find('sys_user', { where: { id: banTarget }, limit: 1 }, { context: SYS }))[0]?.banned === true;

  beforeAll(async () => {
    prior = process.env.OS_SCIM_ENABLED;
    priorOidc = process.env.OS_OIDC_PROVIDER_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    process.env.OS_OIDC_PROVIDER_ENABLED = 'true';
    const declared = showcaseStack as unknown as { objects?: unknown[] };
    stack = await bootShowcase(
      { extraPlugins: [new MCPServerPlugin()] },
      { ...(showcaseStack as unknown as Record<string, unknown>), objects: [...(declared.objects ?? []), Probe] },
    );
    session = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const created = await stack.apiAs(session, 'POST', '/data/probe_fwd_thing', { name: 'probe' });
    const cj: any = await created.json();
    recordId = String(cj?.data?.id ?? cj?.id);
    await stack.signUp('fwd.target@example.com', 'Target-Pass-123');
    banTarget = String(rowsOf(await ql.find('sys_user', { where: { email: 'fwd.target@example.com' }, limit: 1 }, { context: SYS }))[0]?.id);
    // API key
    const k = await stack.apiAs(session, 'POST', '/keys', { name: 'fwd-probe' });
    const kj: any = await k.json();
    apiKey = String(kj?.data?.key);
    // OAuth: DCR → authorize → consent → token
    const authSvc: any = await stack.kernel.getServiceAsync('auth');
    const resource = authSvc.getMcpResourceUrl();
    const scope = 'openid profile email offline_access data:read data:write actions:execute';
    const reg = await stack.api('/auth/oauth2/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'fwd probe', redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native', scope }),
    });
    const regBody: any = await reg.json();
    expect(reg.status, JSON.stringify(regBody)).toBe(201);
    const signin = await stack.api('/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }) });
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
    oauth = tj.access_token;
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (prior === undefined) delete process.env.OS_SCIM_ENABLED; else process.env.OS_SCIM_ENABLED = prior;
    if (priorOidc === undefined) delete process.env.OS_OIDC_PROVIDER_ENABLED; else process.env.OS_OIDC_PROVIDER_ENABLED = priorOidc;
  });

  it('list_actions LISTS the api actions for the OAuth agent and marks each with the refusal, code UNAUTHENTICATED', async () => {
    const listed = await listProbeActions({ Authorization: `Bearer ${oauth}` });

    expect(Object.keys(listed).sort()).toEqual(['probe_ban', 'probe_data_patch', 'probe_get_session']);
    expect(listed.probe_data_patch.unavailable?.code).toBe('UNAUTHENTICATED');
    expect(listed.probe_data_patch.unavailable?.reason).toMatch(
      /^Action 'probe_data_patch' forwards to an endpoint \('\/api\/v1\/data\/probe_fwd_thing\/.*'\) that accepts a signed-in session or an API key, and this request was authenticated with an OAuth access token, which is honoured on the MCP endpoint only\. The action was not run\. Connect with an API key/,
    );
    expect(listed.probe_ban.unavailable?.code).toBe('UNAUTHENTICATED');
    expect(listed.probe_ban.unavailable?.reason).toMatch(/identity endpoint \('\/api\/v1\/auth\/admin\/ban-user'\) that accepts a signed-in session only/);
  });

  it('run_action: the OAuth agent gets the named refusal the listing carried, not the target\'s anonymous 401, and the row is untouched', async () => {
    const before = await rowName();
    const listed = await listProbeActions({ Authorization: `Bearer ${oauth}` });

    const r = await runAction({ Authorization: `Bearer ${oauth}` }, 'probe_data_patch');

    expect(r.isError).toBe(true);
    expect(r.body.error).toMatchObject({ code: 'UNAUTHENTICATED', status: 401, message: listed.probe_data_patch.unavailable.reason });
    expect(r.body.error.message).not.toBe('Authentication is required to access this endpoint.');
    expect(await rowName()).toBe(before);
  });

  it('run_action: the OAuth agent running the identity-route Ban action is refused by name and nobody is banned', async () => {
    const r = await runAction({ Authorization: `Bearer ${oauth}` }, 'probe_ban', { params: { userId: banTarget } });

    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
    expect(r.body.error.message).toMatch(/^Action 'probe_ban' forwards to an identity endpoint .* OAuth access token, which is honoured on the MCP endpoint only\. The action was not run\./);
    expect(await isBanned()).toBe(false);
  });

  it('unchanged lanes: a session lists the actions unmarked; an API key is marked on the identity route only and its data-door action is served', async () => {
    const asSession = await listProbeActions({ Authorization: `Bearer ${session}` });
    expect(Object.values(asSession).filter((a: any) => a.unavailable)).toEqual([]);

    const asKey = await listProbeActions({ 'x-api-key': apiKey });
    expect(asKey.probe_ban.unavailable?.code).toBe('UNAUTHENTICATED');
    expect(asKey.probe_data_patch.unavailable).toBeUndefined();

    const r = await runAction({ 'x-api-key': apiKey }, 'probe_data_patch');
    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    expect(await rowName()).toBe('patched');
  });

  it('the boundary is unmoved: the same OAuth token presented to the data door or an identity route directly is still refused', async () => {
    const data = await stack.api(`/data/probe_fwd_thing/${recordId}`, { headers: { Authorization: `Bearer ${oauth}` } });
    expect(data.status).toBe(401);
    const identity = await stack.api('/auth/get-session', { headers: { Authorization: `Bearer ${oauth}` } });
    expect(identity.status).toBe(401);
  });
});
