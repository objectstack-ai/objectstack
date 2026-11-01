// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27681, #27900] An action on a `sys_*` object is reachable over MCP only
// when the action itself declares `ai: { exposed: true, description }`
// (ADR-0011) — pinned on the platform's OWN identity declarations, through the
// live MCP transport of a booted showcase with better-auth's admin plugin on
// and the real identity targets.
//
// ## The rulings this file encodes
//
// Maintainer ruling 6513869839 on #27681 (letter B): the runtime's `sys_*` name
// refusal yields to the action's own opt-in at both MCP sites (`list_actions`,
// `run_action`), and every gate behind it runs unchanged.
//
// Maintainer ruling 6523087116 on #27900 (letter A+): the platform identity
// actions are assessed in three buckets, recorded in ADR-0011's 2026-10-30
// addendum — E exposed by plain declaration, C exposed with
// `requiresConfirmation: true`, H with no `ai` block. This file drives ONE
// action per bucket. It is not a pin over the table: the ruling struck any
// automatic check of it, and the table lives in the ADR only.
//
// ## Two callers
//
//   - The administrator's SESSION bearer pins the #27681 mechanism on
//     `ban_user` (C): listed and attested, refused 428 unconfirmed, the
//     ADR-0126 §8 switch, the target's own authorization, and the confirmed
//     call that bans. The human-only `impersonate_user` (H) on the SAME object
//     is the control: never listed, refused by name.
//   - An OAUTH-connected agent — the caller the #27900 ruling exposes these
//     actions to — drives the three bucket cases: `update_my_profile` (E)
//     listed and run, `ban_user` (C) refused until confirmed, and
//     `impersonate_user` (H) absent. Its token is minted by the embedded
//     authorization server the way an MCP client connects: dynamic client
//     registration, authorize with the MCP resource and PKCE, consent, token.
//
// ## The agent's runs are served as the agent (ADR-0090 D10 rule 5, #28367)
//
// Every one of these actions is `type: 'api'`: the door forwards the call to
// its identity route. An identity route accepts a signed-in session only, so
// until #28367 the agent's forward was refused by name (#28178). Now the
// forward carries a credential the server mints for that one forward, and the
// identity mount shows better-auth a request-scoped view of the delegating
// user: the agent's E call and its confirmed C call are SERVED, and a plain
// member's agent is refused by the identity route itself (the intersection at
// the target). ⛔ No session is minted for the agent, and its token never
// reaches the target.
//
// `OS_SCIM_ENABLED=true` precedes the boot because `/admin/*` 501s without
// better-auth's admin plugin (see `api-action-door-forward.dogfood.test.ts`),
// and `OS_OIDC_PROVIDER_ENABLED=true` mounts the embedded authorization server.
// The file is ISOLATED (env toggles).

import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { SysUser } from '@objectstack/platform-objects/identity';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

const ADMIN_EMAIL = 'admin@objectos.ai';
const ADMIN_PASSWORD = 'admin123';
const TARGET_EMAIL = 'mcp.sys.exposure.target@example.com';
const AGENT_TARGET_EMAIL = 'mcp.sys.exposure.agent-target@example.com';
const MEMBER_EMAIL = 'mcp.sys.exposure.member@example.com';
const REDIRECT_URI = 'http://127.0.0.1:33419/callback';
const AGENT_SCOPE = 'openid profile email offline_access data:read data:write actions:execute';

const declarationOf = (name: string): any => {
  const found = ((SysUser as any).actions ?? []).find((a: any) => a?.name === name);
  if (!found) throw new Error(`sys_user no longer declares '${name}' — the fixture moved`);
  return found;
};

describe('[#27681, #27900] sys_user identity actions over MCP: what each bucket\'s declaration lets an agent reach', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;
  let member: string;
  let agent: string;
  let memberAgent: string;
  let adminUserId: string;
  let targetUserId: string;
  let agentTargetUserId: string;
  let priorScim: string | undefined;
  let priorOidc: string | undefined;

  /** One `tools/call` over the live MCP transport; the tool's text content, parsed. */
  const tool = async (token: string, name: string, args: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    expect(res.status).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    const text: string = String(rpc.result?.content?.[0]?.text ?? '');
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { isError: rpc.result?.isError === true, payload, text };
  };
  const messageOf = (r: { payload: any; text: string }) => String(r.payload?.error?.message ?? r.payload?.message ?? r.text);
  const userRow = async (id: string) =>
    rowsOf(await ql.find('sys_user', { where: { id }, limit: 1 }, { context: SYS }))[0];
  const isBanned = async (id: string) => {
    const row = await userRow(id);
    return row?.banned === true || row?.banned === 1;
  };
  const listedOnUser = async (token: string) => {
    const listed = await tool(token, 'list_actions', {});
    expect(listed.isError, listed.text).toBe(false);
    return (listed.payload.actions as any[]).filter((a) => a.objectName === 'sys_user');
  };
  const flip = async (enabled: boolean) => {
    const res = await stack.apiAs(admin, 'POST', '/actions/_activation/sys_user/ban_user', { enabled });
    expect(res.status, await res.clone().text()).toBe(200);
  };

  /**
   * An access token for the MCP resource, minted by the embedded authorization
   * server for the administrator, the way an MCP client connects (a public
   * client, PKCE S256, `resource` = the MCP URL).
   */
  const mintAgentToken = async (email = ADMIN_EMAIL, password = ADMIN_PASSWORD): Promise<string> => {
    const authSvc: any = await stack.kernel.getServiceAsync('auth');
    const resource = authSvc.getMcpResourceUrl();
    const reg = await stack.api('/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'sys-action exposure agent',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        scope: AGENT_SCOPE,
      }),
    });
    const client: any = await reg.json();
    expect(reg.status, JSON.stringify(client)).toBe(201);
    const signIn = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const cookie = ((signIn.headers as any).getSetCookie() as string[]).map((c) => c.split(';')[0]).join('; ');
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: AGENT_SCOPE,
      state: 'st',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource,
    });
    const authorize = await stack.api(`/auth/oauth2/authorize?${query}`, { headers: { cookie }, redirect: 'manual' });
    const location = authorize.headers.get('location') ?? '';
    let code = new URL(location, 'http://localhost:3000').searchParams.get('code');
    if (!code) {
      const consent = await stack.api('/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:3000' },
        body: JSON.stringify({ accept: true, oauth_query: location.slice(location.indexOf('?')) }),
      });
      const answer: any = await consent.json();
      expect(consent.status, JSON.stringify(answer)).toBe(200);
      code = new URL(answer?.redirect_uri ?? answer?.url).searchParams.get('code');
    }
    expect(code, `authorize answered ${authorize.status} ${location}`).toBeTruthy();
    const token = await stack.api('/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: client.client_id,
        code_verifier: verifier,
        resource,
      }).toString(),
    });
    const issued: any = await token.json();
    expect(token.status, JSON.stringify(issued)).toBe(200);
    return String(issued.access_token);
  };

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    priorOidc = process.env.OS_OIDC_PROVIDER_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    process.env.OS_OIDC_PROVIDER_ENABLED = 'true';
    // The premise, read off the platform's own declarations (ADR-0011's
    // 2026-10-30 addendum): one action per bucket, nothing mutated here.
    expect(declarationOf('ban_user').ai).toMatchObject({ exposed: true, requiresConfirmation: true });
    expect(declarationOf('update_my_profile').ai).toMatchObject({ exposed: true });
    expect(declarationOf('update_my_profile').ai.requiresConfirmation).toBeUndefined();
    expect(declarationOf('impersonate_user').ai).toBeUndefined();
    stack = await bootShowcase({ extraPlugins: [new MCPServerPlugin()] });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    await stack.signUp(TARGET_EMAIL, 'Target-Pass-123');
    await stack.signUp(AGENT_TARGET_EMAIL, 'Target-Pass-123');
    member = await stack.signUp(MEMBER_EMAIL, 'Member-Pass-123');
    const idOf = async (email: string) =>
      String(rowsOf(await ql.find('sys_user', { where: { email }, limit: 1 }, { context: SYS }))[0]?.id);
    adminUserId = await idOf(ADMIN_EMAIL);
    targetUserId = await idOf(TARGET_EMAIL);
    agentTargetUserId = await idOf(AGENT_TARGET_EMAIL);
    agent = await mintAgentToken();
    memberAgent = await mintAgentToken(MEMBER_EMAIL, 'Member-Pass-123');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
    if (priorOidc === undefined) delete process.env.OS_OIDC_PROVIDER_ENABLED;
    else process.env.OS_OIDC_PROVIDER_ENABLED = priorOidc;
  });

  // ── The administrator's session: the #27681 mechanism on a C action ──────

  it('list_actions lists the declared ban_user (attested, confirmation-gated) and not the human-only impersonate_user', async () => {
    const onUser = await listedOnUser(admin);
    const names = onUser.map((a) => a.name);
    expect(names).toContain('ban_user');
    expect(names).not.toContain('impersonate_user');
    expect(onUser.find((a) => a.name === 'ban_user')).toMatchObject({ aiExposed: true, requiresConfirmation: true, requiresRecord: true });
  }, 120_000);

  it('the human-only impersonate_user is refused by name, with and without objectName', async () => {
    const scoped = await tool(admin, 'run_action', { actionName: 'impersonate_user', objectName: 'sys_user', recordId: targetUserId });
    expect(scoped.isError).toBe(true);
    expect(messageOf(scoped)).toContain('system object "sys_user" is not exposed via MCP');

    const byName = await tool(admin, 'run_action', { actionName: 'impersonate_user', recordId: targetUserId });
    expect(byName.isError).toBe(true);
    expect(messageOf(byName)).toContain("is on a system object ('sys_user') and is not exposed via MCP");
  }, 120_000);

  it('HITL: an unconfirmed ban_user is refused 428 ACTION_CONFIRMATION_REQUIRED and the user is NOT banned', async () => {
    const refused = await tool(admin, 'run_action', {
      actionName: 'ban_user', objectName: 'sys_user', recordId: targetUserId, params: { banReason: 'dogfood' },
    });
    expect(refused.isError).toBe(true);
    expect(refused.payload?.error).toMatchObject({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
    expect(await isBanned(targetUserId), 'an unconfirmed agent call banned the user').toBe(false);
  }, 120_000);

  it('the packaged-action switch holds over MCP: ban_user OFF answers 409 ACTION_DISABLED even confirmed', async () => {
    await flip(false);
    try {
      const refused = await tool(admin, 'run_action', {
        actionName: 'ban_user', objectName: 'sys_user', recordId: targetUserId, confirm: true,
      });
      expect(refused.isError).toBe(true);
      expect(refused.payload?.error).toMatchObject({ code: 'ACTION_DISABLED', status: 409 });
      expect(await isBanned(targetUserId)).toBe(false);
    } finally {
      await flip(true);
    }
  }, 120_000);

  it('the target still authorizes: a plain member\'s confirmed call is refused and the user is NOT banned', async () => {
    const refused = await tool(member, 'run_action', {
      actionName: 'ban_user', objectName: 'sys_user', recordId: targetUserId, confirm: true,
    });
    expect(refused.isError).toBe(true);
    expect(await isBanned(targetUserId)).toBe(false);
  }, 120_000);

  it('the confirmed administrator call runs through every gate and bans the user', async () => {
    const ran = await tool(admin, 'run_action', {
      actionName: 'ban_user', objectName: 'sys_user', recordId: targetUserId, params: { banReason: 'dogfood' }, confirm: true,
    });
    expect(ran.isError, ran.text).toBe(false);
    expect(ran.payload).toMatchObject({ ok: true, action: 'ban_user', objectName: 'sys_user', recordId: targetUserId });
    expect(await isBanned(targetUserId)).toBe(true);
  }, 120_000);

  // ── The OAuth-connected agent: one case per bucket ───────────────────────

  it('E: the agent lists update_my_profile, attested and not confirmation-gated', async () => {
    const onUser = await listedOnUser(agent);
    expect(onUser.find((a) => a.name === 'update_my_profile')).toMatchObject({
      aiExposed: true, requiresConfirmation: false, requiresRecord: true,
    });
  }, 120_000);

  it('E, served as the agent (#28367): the agent\'s update_my_profile run renames its delegating user through the identity route', async () => {
    const ran = await tool(agent, 'run_action', {
      actionName: 'update_my_profile', objectName: 'sys_user', recordId: adminUserId, params: { name: 'Renamed By Agent' },
    });
    expect(ran.isError, ran.text).toBe(false);
    expect(ran.payload).toMatchObject({ ok: true, action: 'update_my_profile', objectName: 'sys_user', recordId: adminUserId });
    expect((await userRow(adminUserId))?.name).toBe('Renamed By Agent');
  }, 120_000);

  it('E, the session lane unchanged: the same update_my_profile run from the administrator\'s session is served', async () => {
    const ran = await tool(admin, 'run_action', {
      actionName: 'update_my_profile', objectName: 'sys_user', recordId: adminUserId, params: { name: 'Renamed By Session' },
    });
    expect(ran.isError, ran.text).toBe(false);
    expect(ran.payload).toMatchObject({ ok: true, action: 'update_my_profile', objectName: 'sys_user', recordId: adminUserId });
    expect((await userRow(adminUserId))?.name).toBe('Renamed By Session');
  }, 120_000);

  it('the intersection at the target: a plain member\'s agent, confirmed, passes the action door and is refused by the identity route itself; nobody is banned', async () => {
    const refused = await tool(memberAgent, 'run_action', {
      actionName: 'ban_user', objectName: 'sys_user', recordId: agentTargetUserId, params: { banReason: 'member agent' }, confirm: true,
    });
    expect(refused.isError, refused.text).toBe(true);
    expect(refused.payload?.error?.status, refused.text).toBe(403);
    expect(messageOf(refused)).not.toMatch(/OAuth access token|scope/);
    expect(await isBanned(agentTargetUserId)).toBe(false);
  }, 120_000);

  it('C: the agent\'s unconfirmed ban_user is refused 428 before any forward; confirmed, it is served as the agent (#28367) and bans the user', async () => {
    const unconfirmed = await tool(agent, 'run_action', {
      actionName: 'ban_user', objectName: 'sys_user', recordId: agentTargetUserId, params: { banReason: 'agent' },
    });
    expect(unconfirmed.isError).toBe(true);
    expect(unconfirmed.payload?.error).toMatchObject({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
    expect(await isBanned(agentTargetUserId)).toBe(false);

    const confirmed = await tool(agent, 'run_action', {
      actionName: 'ban_user', objectName: 'sys_user', recordId: agentTargetUserId, params: { banReason: 'agent' }, confirm: true,
    });
    expect(confirmed.isError, confirmed.text).toBe(false);
    expect(confirmed.payload).toMatchObject({ ok: true, action: 'ban_user', objectName: 'sys_user', recordId: agentTargetUserId });
    expect(await isBanned(agentTargetUserId)).toBe(true);
  }, 120_000);

  it('H: impersonate_user is absent from the agent\'s listing and refused by name', async () => {
    const onUser = await listedOnUser(agent);
    expect(onUser.map((a) => a.name)).not.toContain('impersonate_user');
    const refused = await tool(agent, 'run_action', { actionName: 'impersonate_user', objectName: 'sys_user', recordId: agentTargetUserId });
    expect(refused.isError).toBe(true);
    expect(messageOf(refused)).toContain('system object "sys_user" is not exposed via MCP');
  }, 120_000);
});
