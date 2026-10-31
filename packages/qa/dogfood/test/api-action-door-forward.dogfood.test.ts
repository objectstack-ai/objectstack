// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27506] A `type: 'api'` packaged action switched off in the ADR-0126 §8
// ledger must STOP — pinned at the layer the card names: the real HTTP stack
// of a booted showcase with better-auth's admin plugin on, the real
// `/admin/*` targets, and the live MCP transport.
//
// ## The defect, and the ruling this file encodes
//
// Before #27506 the console fetched an api action's `target` directly and the
// two action doors refused the type outright, so the activation consult never
// saw a "Ban User" click: the panel showed the action off, the click banned.
// Ruling 6499781492 (option C): a SAME-ORIGIN api action is dispatched through
// `POST /actions/:object/:action` and the MCP `run_action` bridge, which run
// their gates and then forward the request in-process to the declared target
// with the caller's own credentials. An OFF-ORIGIN api action stays
// browser-only and cannot be switched at all.
//
// ## What each case pins
//
//   - the switch: `ban_user` off → 409 ACTION_DISABLED through the door and
//     `sys_user.banned` stays false; on → 200 and the user IS banned;
//     `unban_user` through the same door un-bans;
//   - the body the declaration assembles reaches the target:
//     `set_user_password` (params + `recordIdParam` + `bodyExtra`) really
//     changes the password — the target user signs in with the new one;
//   - the credential lanes of `impersonate_user`, the hardest target (it
//     mints a session INSIDE better-auth's endpoint context): a cookie caller
//     gets every `Set-Cookie` line back, one per line; a bearer caller gets
//     `set-auth-token` + `set-admin-session-token` and its old token dies;
//   - the target still authorizes: a plain member is refused by ban-user's
//     own 403 through the door; an anonymous caller meets the 401 floor;
//   - the off-origin case: the activation write door refuses to flip it, and
//     the action door refuses to run it;
//   - MCP: the type gate is open — `run_action` on a same-origin api action
//     now reaches the exposure gate instead of "cannot be invoked via MCP";
//   - the API-key lane (#28217): an identity route reads only its own
//     signed-in session, so a key caller of `ban_user` is refused BY NAME at
//     the door (the target's anonymous "Sign in first" was the defect) and
//     nobody is banned, while a key caller of an api action whose target is
//     the data door is still forwarded and served.
//
// `OS_SCIM_ENABLED=true` precedes the boot because `/admin/*` 501s without
// better-auth's admin plugin, and that env knob is the one that reaches it
// (see `admin-platform-admin-standing.dogfood.test.ts`). The file is
// ISOLATED (an env toggle + a derived configuration), per the vitest config.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import showcaseStack from '@objectstack/example-showcase';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);
const activation = (object: string, action: string) => `/actions/_activation/${object}/${action}`;

const TARGET_EMAIL = 'door.forward.target@example.com';
const TARGET_PASS = 'Target-Pass-123';
const MEMBER_EMAIL = 'door.forward.member@example.com';

/**
 * The two api actions this file needs and no shipped app declares, on a probe
 * object added to the showcase for this boot only. `ping_remote`'s `target`
 * names a host the platform never sees, which is exactly the case the ruling
 * keeps browser-only. `rename_probe` targets the data door, which admits an
 * API key: the API-key lane's control against the identity-route refusal.
 */
const RemoteProbe = ObjectSchema.create({
  name: 'probe_remote_thing',
  label: 'Remote Probe',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name' }) },
  actions: [
    {
      name: 'ping_remote',
      label: 'Ping Remote',
      type: 'api',
      target: 'https://example.invalid/ping',
      locations: ['record_header'],
    },
    {
      name: 'rename_probe',
      label: 'Rename Probe',
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/probe_remote_thing/${ctx.recordId}',
      bodyExtra: { name: 'renamed-through-the-door' },
      locations: ['record_header'],
    },
  ],
} as any);

type Answer = { status: number; text: string; json: any; headers: Headers };

describe('[#27506] a same-origin api action is dispatched through the action doors, so its switch holds', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;
  let targetUserId: string;
  let priorScim: string | undefined;

  const call = async (
    auth: { token?: string; cookie?: string; key?: string } | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Answer> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
    if (auth?.cookie) headers.Cookie = auth.cookie;
    if (auth?.key) headers['x-api-key'] = auth.key;
    const res = await stack.api(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, text, json, headers: res.headers };
  };
  const flip = async (object: string, action: string, enabled: boolean) => {
    const res = await call({ token: admin }, 'POST', activation(object, action), { enabled });
    expect(res.status, res.text).toBe(200);
  };
  const targetRow = async () =>
    rowsOf(await ql.find('sys_user', { where: { id: targetUserId }, limit: 1 }, { context: SYS }))[0];
  const isBanned = async () => {
    const row = await targetRow();
    return row?.banned === true || row?.banned === 1;
  };
  /** `tools/call run_action` over the live MCP transport; the tool's text content, parsed. */
  const runActionTool = async (actionName: string, args: Record<string, unknown> = {}) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${admin}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_action', arguments: { actionName, ...args } } }),
    });
    expect(res.status).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    // A refusal with an envelope is JSON; a bare thrown sentence is text.
    const text: string = String(rpc.result?.content?.[0]?.text ?? '');
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { isError: rpc.result?.isError === true, payload };
  };
  /** A cookie-authenticated admin: the sign-in route's own `Set-Cookie`, replayed as `Cookie`. */
  const adminCookie = async (): Promise<string> => {
    const res = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    expect(res.status).toBe(200);
    const cookies: string[] = (res.headers as any).getSetCookie();
    expect(cookies.length, 'sign-in set no cookie').toBeGreaterThan(0);
    return cookies.map((c) => c.split(';')[0]).join('; ');
  };

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    const declared = showcaseStack as unknown as { objects?: unknown[] };
    stack = await bootShowcase(
      { extraPlugins: [new MCPServerPlugin()] },
      { ...(showcaseStack as unknown as Record<string, unknown>), objects: [...(declared.objects ?? []), RemoteProbe] },
    );
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    await stack.signUp(TARGET_EMAIL, TARGET_PASS);
    const [target] = rowsOf(await ql.find('sys_user', { where: { email: TARGET_EMAIL }, limit: 1 }, { context: SYS }));
    targetUserId = String(target.id);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  it('the switch holds: ban_user OFF answers 409 ACTION_DISABLED through the door and the user is NOT banned', async () => {
    expect(await isBanned(), 'setup: target already banned').toBe(false);
    await flip('sys_user', 'ban_user', false);

    const refused = await call({ token: admin }, 'POST', '/actions/sys_user/ban_user', {
      recordId: targetUserId, params: { banReason: 'dogfood' },
    });

    expect(refused.status, refused.text).toBe(409);
    expect(refused.json?.error?.code).toBe('ACTION_DISABLED');
    // [#27842] The sentence is the end user's: it names where an administrator
    // turns the action back on, and no system table (the code is the machine half).
    const message = String(refused.json?.error?.message);
    expect(message).toMatch(/^This action is turned off for this deployment\. /);
    expect(message).toContain('An administrator can turn it on again under Setup › Packaged automation');
    expect(message).not.toContain('sys_metadata_activation');
    expect(await isBanned(), 'a switched-off Ban User still banned — the #27506 defect').toBe(false);
  }, 120_000);

  it('switched back ON, the same request is forwarded to ban-user and the user IS banned; unban_user un-bans', async () => {
    await flip('sys_user', 'ban_user', true);

    const banned = await call({ token: admin }, 'POST', '/actions/sys_user/ban_user', {
      recordId: targetUserId, params: { banReason: 'dogfood' },
    });
    expect(banned.status, banned.text).toBe(200);
    // The target's `data`, unwrapped — what the console's direct fetch handed `result.data`.
    expect(banned.json?.data).toMatchObject({ userId: targetUserId, banned: true });
    expect(await isBanned()).toBe(true);

    const unbanned = await call({ token: admin }, 'POST', '/actions/sys_user/unban_user', { recordId: targetUserId });
    expect(unbanned.status, unbanned.text).toBe(200);
    expect(await isBanned()).toBe(false);
  }, 120_000);

  it('the declaration\'s body reaches the target: set_user_password through the door changes the password', async () => {
    const res = await call({ token: admin }, 'POST', '/actions/sys_user/set_user_password', {
      recordId: targetUserId, params: { newPassword: 'Target-New-Pass-456', mustChangePassword: false },
    });
    expect(res.status, res.text).toBe(200);

    // The proof is the sign-in, not the 200.
    const token = await stack.signIn(TARGET_EMAIL, 'Target-New-Pass-456');
    expect(token).toBeTruthy();
    await expect(stack.signIn(TARGET_EMAIL, TARGET_PASS)).rejects.toThrow(/signIn failed/);
  }, 120_000);

  it('the target still authorizes: a plain member is refused by ban-user\'s own 403; anonymous meets the 401 floor', async () => {
    const member = await stack.signUp(MEMBER_EMAIL, 'Member-Pass-123');
    const refused = await call({ token: member }, 'POST', '/actions/sys_user/ban_user', { recordId: targetUserId });
    expect(refused.status, refused.text).toBe(403);
    expect(await isBanned()).toBe(false);

    const anonymous = await call(null, 'POST', '/actions/sys_user/ban_user', { recordId: targetUserId });
    expect(anonymous.status, anonymous.text).toBe(401);
  }, 120_000);

  it('API-key lane: ban_user is refused by name at the door, before its identity route is called, and nobody is banned', async () => {
    // `ban_user` was switched back on above, and the admin's session lane is
    // served (that case). The key is the SAME admin's.
    const minted = await call({ token: admin }, 'POST', '/keys', { name: 'door-forward-key' });
    expect(minted.status, minted.text).toBe(201);
    const key = String(minted.json?.data?.key);

    const refused = await call({ key }, 'POST', '/actions/sys_user/ban_user', {
      recordId: targetUserId, params: { banReason: 'dogfood-key' },
    });

    expect(refused.status, refused.text).toBe(401);
    expect(refused.json?.error?.code).toBe('UNAUTHENTICATED');
    const message = String(refused.json?.error?.message);
    // The door's sentence, not the identity route's anonymous "Sign in first".
    expect(message).toContain("Action 'ban_user' forwards to an identity endpoint ('/api/v1/auth/admin/ban-user')");
    expect(message).toContain('accepts a signed-in session only');
    expect(message).toContain('authenticated with an API key');
    expect(message).not.toContain('Sign in first');
    expect(await isBanned()).toBe(false);
  }, 120_000);

  it('API-key lane: an api action whose target is the data door is still forwarded with the key and served', async () => {
    const minted = await call({ token: admin }, 'POST', '/keys', { name: 'door-forward-data-key' });
    expect(minted.status, minted.text).toBe(201);
    const key = String(minted.json?.data?.key);
    const created = await call({ token: admin }, 'POST', '/data/probe_remote_thing', { name: 'before' });
    expect(created.status, created.text).toBe(201);
    const id = String(created.json?.data?.id ?? created.json?.id);

    const res = await call({ key }, 'POST', '/actions/probe_remote_thing/rename_probe', { recordId: id });

    expect(res.status, res.text).toBe(200);
    const [row] = rowsOf(await ql.find('probe_remote_thing', { where: { id }, limit: 1 }, { context: SYS }));
    expect(row?.name).toBe('renamed-through-the-door');
  }, 120_000);

  it('off-origin: the write door refuses to switch `ping_remote`, and the action door refuses to run it', async () => {
    const flipAttempt = await call({ token: admin }, 'POST', activation('probe_remote_thing', 'ping_remote'), { enabled: false });
    expect(flipAttempt.status, flipAttempt.text).toBe(409);
    expect(String(flipAttempt.json?.error?.message)).toContain('never sees the request');
    const rows: any[] = await ql.find('sys_metadata_activation', { where: { metadata_type: 'action' }, context: SYS });
    expect(rows.filter((r) => r.name === 'ping_remote'), 'a refused flip wrote a ledger row').toHaveLength(0);

    const run = await call({ token: admin }, 'POST', '/actions/probe_remote_thing/ping_remote', {});
    expect(run.status, run.text).toBe(400);
    expect(String(run.json?.error?.message)).toContain('off-origin');
  }, 120_000);

  it('MCP: the type gate is open — run_action on a same-origin api action reaches the exposure gate, not a type refusal', async () => {
    // `showcase_recalc_estimate` is a same-origin api action on a non-system
    // object that does NOT opt into AI. Before #27506 the bridge answered
    // "cannot be invoked via MCP (type='api')" ahead of every other gate.
    const refused = await runActionTool('showcase_recalc_estimate');
    expect(refused.isError).toBe(true);
    const message = String(refused.payload?.error?.message ?? refused.payload?.message ?? JSON.stringify(refused.payload));
    expect(message).not.toContain('cannot be invoked via MCP');
    expect(message).toContain('not exposed to AI');
  }, 120_000);

  it('impersonate_user, cookie lane: every Set-Cookie line the target mints comes back through the door', async () => {
    const cookie = await adminCookie();

    const res = await call({ cookie }, 'POST', '/actions/sys_user/impersonate_user', { recordId: targetUserId });

    expect(res.status, res.text).toBe(200);
    expect(res.json?.data?.session?.userId).toBe(targetUserId);
    const cookies: string[] = (res.headers as any).getSetCookie();
    // Measured 2026-10-29 against the target directly: six lines. One
    // comma-joined `Set-Cookie` would be one unparseable cookie — the shape
    // the array relay exists to prevent.
    expect(cookies.length, cookies.join('\n')).toBeGreaterThanOrEqual(2);
    expect(cookies.some((c) => c.startsWith('better-auth.admin_session='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('better-auth.session_token='))).toBe(true);
    expect(cookies.every((c) => !c.includes(', better-auth.'))).toBe(true);
  }, 120_000);

  it('impersonate_user, bearer lane: the rotation headers come back and the caller\'s old token dies (#8243)', async () => {
    // Ordered LAST on purpose: this rotates `admin`.
    const res = await call({ token: admin }, 'POST', '/actions/sys_user/impersonate_user', { recordId: targetUserId });

    expect(res.status, res.text).toBe(200);
    expect(res.json?.data?.session?.userId).toBe(targetUserId);
    expect(res.headers.get('set-auth-token'), 'no set-auth-token relayed').toBeTruthy();
    expect(res.headers.get('set-admin-session-token'), 'no set-admin-session-token relayed').toBeTruthy();

    const stale = await stack.apiAs(admin, 'GET', '/auth/get-session');
    expect(stale.status).toBe(401);
    admin = await stack.signIn();
  }, 120_000);
});
