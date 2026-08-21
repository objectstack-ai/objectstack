// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// MEASUREMENT PROBE for #10792 — latency of the refusal. Not a pin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { appendFileSync, writeFileSync } from 'node:fs';

const OUT = process.env.PROBE_OUT ?? '/tmp/probe-10792-timing.txt';
const SYS = { isSystem: true };
const rec = (l: string) => { try { appendFileSync(OUT, l + '\n'); } catch { /* best effort */ } };

describe('#10792 — how long does the erasure-path refusal take?', () => {
  let stack: VerifyStack; let ql: any;
  let adminTok = ''; let memberTok = ''; let uid = '';
  const targets: string[] = [];
  let priorScim: string | undefined;

  beforeAll(async () => {
    writeFileSync(OUT, '===== #10792 TIMING PROBE =====\n');
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(showcaseStack);
    ql = await stack.kernel.getServiceAsync('objectql');
    memberTok = await stack.signUp('p10792c.member@example.com', 'Member-Pass-123');
    await stack.signUp('p10792c.admin@example.com', 'Legacy-Pass-123');
    const [u] = await ql.find('sys_user', { where: { email: 'p10792c.admin@example.com' }, limit: 1 }, { context: SYS });
    uid = String(u.id);
    await ql.update('sys_user', { id: uid, role: 'admin' }, { context: SYS });
    adminTok = await stack.signIn('p10792c.admin@example.com', 'Legacy-Pass-123');
    for (let i = 0; i < 3; i++) {
      const email = `p10792c.t${i}@example.com`;
      await stack.signUp(email, 'Target-Pass-123');
      const [t] = await ql.find('sys_user', { where: { email }, limit: 1 }, { context: SYS });
      targets.push(String(t.id));
    }
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED; else process.env.OS_SCIM_ENABLED = priorScim;
    rec('===== END =====');
  });

  it('times each fire', async () => {
    const timed = async (label: string, tok: string | undefined, verb: string, path: string, body?: unknown) => {
      const t0 = Date.now();
      const res = tok
        ? await stack.apiAs(tok, verb, path, body)
        : await stack.api(path, { method: verb, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const ms = Date.now() - t0;
      const text = await res.text();
      let code: string | undefined;
      try { const p = JSON.parse(text); code = p?.error?.code ?? p?.code; } catch { /* non-JSON */ }
      rec(`${label.padEnd(34)} ${String(ms).padStart(7)}ms  -> ${res.status} ${code ?? ''} ${text.slice(0, 70)}`);
    };

    await timed('admin get-session (control)', adminTok, 'GET', '/auth/get-session');
    await timed('admin admin/list-users (ctrl)', adminTok, 'GET', '/auth/admin/list-users?limit=1');
    await timed('admin admin/update-user (ctrl)', adminTok, 'POST', '/auth/admin/update-user', { userId: targets[0], data: { name: 'T' } });
    await timed('admin admin/remove-user', adminTok, 'POST', '/auth/admin/remove-user', { userId: targets[1] });
    await timed('member admin/remove-user', memberTok, 'POST', '/auth/admin/remove-user', { userId: targets[2] });
    await timed('anon  admin/remove-user', undefined, 'POST', '/auth/admin/remove-user', { userId: targets[2] });
    await timed('member delete-user', memberTok, 'POST', '/auth/delete-user', { password: 'Member-Pass-123' });
    await timed('admin admin/list-users (after)', adminTok, 'GET', '/auth/admin/list-users?limit=1');
    expect(true).toBe(true);
  }, 280_000);
});
