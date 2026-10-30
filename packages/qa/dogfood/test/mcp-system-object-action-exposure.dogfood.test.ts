// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27681] An action on a `sys_*` object is reachable over MCP only when the
// action itself declares `ai: { exposed: true, description }` (ADR-0011) —
// pinned on a `sys_user` identity action, through the live MCP transport of a
// booted showcase with better-auth's admin plugin on and the real
// `/admin/ban-user` target.
//
// ## The ruling this file encodes
//
// Maintainer ruling 6513869839 (letter B). Before it, the runtime refused every
// action on a `sys_*` object by name, ahead of the exposure check, and the MCP
// tool layer hid and refused them again — while `POST /actions/sys_user/…`
// served the same action to the same administrator. Now the name refusal
// yields to the action's own opt-in at both MCP sites (`list_actions`,
// `run_action`), and every gate behind it runs unchanged.
//
// ## The declaration here is TEST-ONLY
//
// No platform `sys_*` action declares an `ai` block (ruling parameter 2, as
// amended: the declarations follow their own decision card). `ban_user` is
// given one for THIS boot only — set on the imported `SysUser` before the boot
// registers it, removed in `afterAll` — with `requiresConfirmation: true`, the
// shape the ruling requires for a destructive identity act. Its sibling
// `unban_user` keeps no `ai` block and is the unflagged control on the SAME
// object.
//
// ## What each case pins
//
//   - `list_actions` lists `ban_user` (attested `aiExposed`) and not
//     `unban_user`: the agent that lists sees exactly what it may run;
//   - the unflagged `unban_user` is refused by name over MCP, with and
//     without `objectName`;
//   - HITL: an unconfirmed `ban_user` is refused 428 and the user stays
//     unbanned;
//   - the ADR-0126 §8 switch: off ⇒ 409 ACTION_DISABLED over MCP even when
//     confirmed, user unbanned;
//   - the target still authorizes: a plain member's confirmed call is refused
//     and the user stays unbanned;
//   - and the confirmed administrator call bans the user.
//
// `OS_SCIM_ENABLED=true` precedes the boot because `/admin/*` 501s without
// better-auth's admin plugin (see `api-action-door-forward.dogfood.test.ts`).
// The file is ISOLATED (an env toggle + a mutated platform declaration).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { SysUser } from '@objectstack/platform-objects/identity';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

const TARGET_EMAIL = 'mcp.sys.exposure.target@example.com';
const MEMBER_EMAIL = 'mcp.sys.exposure.member@example.com';

/** The test-only opt-in, the shape the ruling requires on a destructive identity act. */
const TEST_ONLY_AI = {
  exposed: true,
  description: 'Ban a user so they cannot sign in (dogfood test-only declaration).',
  requiresConfirmation: true,
};

const banUserDeclaration = (): any => {
  const found = ((SysUser as any).actions ?? []).find((a: any) => a?.name === 'ban_user');
  if (!found) throw new Error("sys_user no longer declares 'ban_user' — the fixture moved");
  return found;
};

describe('[#27681] a sys_user action the author exposed to AI is listed and run over MCP, behind every gate', () => {
  let stack: VerifyStack;
  let ql: any;
  let admin: string;
  let member: string;
  let targetUserId: string;
  let priorScim: string | undefined;
  let priorAi: unknown;

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
  const isBanned = async () => {
    const [row] = rowsOf(await ql.find('sys_user', { where: { id: targetUserId }, limit: 1 }, { context: SYS }));
    return row?.banned === true || row?.banned === 1;
  };
  const flip = async (enabled: boolean) => {
    const res = await stack.apiAs(admin, 'POST', '/actions/_activation/sys_user/ban_user', { enabled });
    expect(res.status, await res.clone().text()).toBe(200);
  };

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    const ban = banUserDeclaration();
    priorAi = ban.ai;
    expect(priorAi, 'the platform now declares an ai block on ban_user — this fixture would mask it').toBeUndefined();
    ban.ai = TEST_ONLY_AI;
    stack = await bootShowcase({ extraPlugins: [new MCPServerPlugin()] });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    await stack.signUp(TARGET_EMAIL, 'Target-Pass-123');
    member = await stack.signUp(MEMBER_EMAIL, 'Member-Pass-123');
    const [target] = rowsOf(await ql.find('sys_user', { where: { email: TARGET_EMAIL }, limit: 1 }, { context: SYS }));
    targetUserId = String(target.id);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    const ban = banUserDeclaration();
    if (priorAi === undefined) delete ban.ai;
    else ban.ai = priorAi;
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  it('list_actions lists the flagged ban_user (attested, confirmation-gated) and not the unflagged unban_user', async () => {
    const listed = await tool(admin, 'list_actions', {});
    expect(listed.isError, listed.text).toBe(false);
    const onUser = (listed.payload.actions as any[]).filter((a) => a.objectName === 'sys_user');
    expect(onUser.map((a) => a.name)).toEqual(['ban_user']);
    expect(onUser[0]).toMatchObject({ aiExposed: true, requiresConfirmation: true, requiresRecord: true });
  }, 120_000);

  it('the unflagged unban_user stays refused by name, with and without objectName', async () => {
    const scoped = await tool(admin, 'run_action', { actionName: 'unban_user', objectName: 'sys_user', recordId: targetUserId });
    expect(scoped.isError).toBe(true);
    expect(messageOf(scoped)).toContain('system object "sys_user" is not exposed via MCP');

    const byName = await tool(admin, 'run_action', { actionName: 'unban_user', recordId: targetUserId });
    expect(byName.isError).toBe(true);
    expect(messageOf(byName)).toContain("is on a system object ('sys_user') and is not exposed via MCP");
  }, 120_000);

  it('HITL: an unconfirmed ban_user is refused 428 ACTION_CONFIRMATION_REQUIRED and the user is NOT banned', async () => {
    const refused = await tool(admin, 'run_action', {
      actionName: 'ban_user', objectName: 'sys_user', recordId: targetUserId, params: { banReason: 'dogfood' },
    });
    expect(refused.isError).toBe(true);
    expect(refused.payload?.error).toMatchObject({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
    expect(await isBanned(), 'an unconfirmed agent call banned the user').toBe(false);
  }, 120_000);

  it('the packaged-action switch holds over MCP: ban_user OFF answers 409 ACTION_DISABLED even confirmed', async () => {
    await flip(false);
    try {
      const refused = await tool(admin, 'run_action', {
        actionName: 'ban_user', objectName: 'sys_user', recordId: targetUserId, confirm: true,
      });
      expect(refused.isError).toBe(true);
      expect(refused.payload?.error).toMatchObject({ code: 'ACTION_DISABLED', status: 409 });
      expect(await isBanned()).toBe(false);
    } finally {
      await flip(true);
    }
  }, 120_000);

  it('the target still authorizes: a plain member\'s confirmed call is refused and the user is NOT banned', async () => {
    const refused = await tool(member, 'run_action', {
      actionName: 'ban_user', objectName: 'sys_user', recordId: targetUserId, confirm: true,
    });
    expect(refused.isError).toBe(true);
    expect(await isBanned()).toBe(false);
  }, 120_000);

  it('the confirmed administrator call runs through every gate and bans the user', async () => {
    const ran = await tool(admin, 'run_action', {
      actionName: 'ban_user', objectName: 'sys_user', recordId: targetUserId, params: { banReason: 'dogfood' }, confirm: true,
    });
    expect(ran.isError, ran.text).toBe(false);
    expect(ran.payload).toMatchObject({ ok: true, action: 'ban_user', objectName: 'sys_user', recordId: targetUserId });
    expect(await isBanned()).toBe(true);
  }, 120_000);
});
