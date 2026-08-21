// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// MEASUREMENT PROBE for #10792 — mechanism narrowing only. Not a pin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { appendFileSync, writeFileSync } from 'node:fs';

const OUT = process.env.PROBE_OUT ?? '/tmp/probe-10792-txn.txt';
const SYS = { isSystem: true };
const rec = (l: string) => { try { appendFileSync(OUT, l + '\n'); } catch { /* best effort */ } };

const answer = async (r: Response) => {
  const body = await r.text();
  let code: string | undefined;
  try { code = JSON.parse(body)?.error?.code ?? JSON.parse(body)?.code; } catch { /* non-JSON */ }
  return `${r.status} ${code ?? ''} ${body.slice(0, 90)}`;
};

describe('#10792 — is a better-auth session read blind inside ANY ambient transaction?', () => {
  let stack: VerifyStack; let ql: any; let token = ''; let uid = '';
  let priorScim: string | undefined;

  beforeAll(async () => {
    writeFileSync(OUT, '===== #10792 TXN-READ PROBE =====\n');
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(showcaseStack);
    ql = await stack.kernel.getServiceAsync('objectql');
    await stack.signUp('p10792b.admin@example.com', 'Legacy-Pass-123');
    const [u] = await ql.find('sys_user', { where: { email: 'p10792b.admin@example.com' }, limit: 1 }, { context: SYS });
    uid = String(u.id);
    await ql.update('sys_user', { id: uid, role: 'admin' }, { context: SYS });
    token = await stack.signIn('p10792b.admin@example.com', 'Legacy-Pass-123');
    rec('setup: fixture legacy-admin ready');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED; else process.env.OS_SCIM_ENABLED = priorScim;
    rec('===== END =====');
  });

  it('reads the same session inside and outside an engine transaction', async () => {
    const cap = <T,>(label: string, p: Promise<T>): Promise<T | string> =>
      Promise.race([p, new Promise<string>((r) => setTimeout(() => r(`TIMEOUT(20s) ${label}`), 20_000))]);
    const show = async (v: unknown) => (typeof v === 'string' ? v : await answer(v as Response));

    rec(`OUTSIDE get-session      -> ${await answer(await stack.apiAs(token, 'GET', '/auth/get-session'))}`);
    rec(`OUTSIDE admin/list-users -> ${await answer(await stack.apiAs(token, 'GET', '/auth/admin/list-users?limit=1'))}`);

    let threw = '';
    try {
      await ql.transaction(async (_c: any, info: any) => {
        rec(`INSIDE  transaction opened, owned=${info?.owned}`);
        const uf = await cap('sys_user find', ql.find('sys_user', { where: { id: uid }, limit: 1 }, { context: SYS }));
        rec(`INSIDE  sys_user find      -> ${typeof uf === 'string' ? uf : `rows=${(uf as any[]).length}`}`);
        const sf = await cap('sys_session find', ql.find('sys_session', { where: { user_id: uid } }, { context: SYS }));
        rec(`INSIDE  sys_session find   -> ${typeof sf === 'string' ? sf : `rows=${(sf as any[]).length}`}`);
        const gs = await cap('get-session', stack.apiAs(token, 'GET', '/auth/get-session'));
        rec(`INSIDE  get-session        -> ${await show(gs)}`);
        const lu = await cap('list-users', stack.apiAs(token, 'GET', '/auth/admin/list-users?limit=1'));
        rec(`INSIDE  admin/list-users   -> ${await show(lu)}`);
      });
      rec('INSIDE  transaction committed');
    } catch (err) {
      threw = `${(err as any)?.name}: ${(err as any)?.message}`.slice(0, 220);
      rec(`INSIDE  transaction threw   -> ${threw}`);
    }
    expect(true).toBe(true);
  }, 280_000);
});
