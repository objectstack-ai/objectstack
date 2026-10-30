// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Changing an API key through the generic data door requires a signed-in
 * session, as minting one through `/api/v1/keys` does.
 *
 * An API key acts as its owner for data, automation and MCP; managing the
 * owner's keys stays with the owner's own sign-in. The `sys_api_key` rows are
 * reachable through `/api/v1/data/sys_api_key`, so that door gives the same
 * answer: a write to `sys_api_key` from a request an API key authenticated is
 * refused `403 PERMISSION_DENIED`, nothing is written, and reads are
 * unchanged. The rule is `@objectstack/core`'s
 * `apiKeyManagementCredentialRefusal`, asked at each data door's per-object
 * gate (RestServer's `enforceApiAccess` serves this composition; the runtime
 * dispatcher's twin is pinned in `packages/runtime`).
 *
 * Persona: a plain member (`stack.signUp`), so every case runs on the owner
 * path the API Keys list renders, never the administrator's.
 *
 * Every refusal asserts status AND `code` (ADR-0112) AND the row afterwards:
 * a 403 that still wrote is the defect wearing a refusal.
 *
 * Controls, which must keep today's answer:
 *  - the owner's SESSION revokes and restores a key from the list (200);
 *  - a key revoked with the forced-reset reason stays administrator-only for
 *    the owner's session (the restore guard, 403);
 *  - the mint, and the `last_used_at` stamp the key-admission seam writes,
 *    are system-context writes and still land.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } };

describe('sys_api_key on the data door: changing a key requires a signed-in session', () => {
  let stack: VerifyStack;
  let memberToken: string;

  const MEMBER_EMAIL = 'apikey.datadoor.session@verify.test';

  /** Mint through the one mint path, as the member's session. */
  const mintKey = async (name: string): Promise<{ id: string; raw: string }> => {
    const res = await stack.apiAs(memberToken, 'POST', '/keys', { name });
    expect(res.status, await res.clone().text()).toBe(201);
    const body: any = await res.json();
    return { id: String(body.data.id), raw: String(body.data.key) };
  };

  /** A request authenticated by the key alone: no cookie, no bearer. */
  const asKey = (raw: string, method: string, path: string, body?: unknown) =>
    stack.api(path, {
      method,
      headers: { 'x-api-key': raw, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  /** Does this key still authenticate? Asked on an object that is not the one under test. */
  const keyAuthenticates = async (raw: string): Promise<boolean> => {
    const res = await stack.api('/data/showcase_task?$top=1', { headers: { 'x-api-key': raw } });
    if (res.status === 200) return true;
    if (res.status === 403) {
      const body: any = await res.json();
      expect(body?.error?.code, 'a 403 on the key probe must be the key\'s own revocation').toBe('API_KEY_REVOKED');
      return false;
    }
    expect(res.status).toBe(401);
    return false;
  };

  /** The row, read back by the owner's session. */
  const readKey = async (id: string) => {
    const res = await stack.apiAs(memberToken, 'GET', `/data/sys_api_key/${id}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const body: any = await res.json();
    return (body.record ?? body.data ?? {}) as Record<string, any>;
  };

  const expectRefused = async (res: Response, status: number, code: string) => {
    const text = await res.clone().text();
    expect(res.status, text).toBe(status);
    const body: any = await res.json();
    expect(body.code ?? body.error?.code, text).toBe(code);
  };

  beforeAll(async () => {
    stack = await bootShowcase({});
    await stack.signIn();
    memberToken = await stack.signUp(MEMBER_EMAIL);
  }, 180_000);

  afterAll(async () => { await stack?.stop?.(); });

  // ── refused for a request an API key authenticated ───────────────────────

  it('refuses `revoked: false` on a revoked key — 403 PERMISSION_DENIED, row unchanged', async () => {
    const caller = await mintKey('dd-caller-restore');
    const sibling = await mintKey('dd-sibling-revoked');
    const off = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${sibling.id}`, { revoked: true });
    expect(off.status).toBe(200);
    expect(await keyAuthenticates(sibling.raw)).toBe(false);

    await expectRefused(
      await asKey(caller.raw, 'PATCH', `/data/sys_api_key/${sibling.id}`, { revoked: false }),
      403, 'PERMISSION_DENIED',
    );
    expect((await readKey(sibling.id)).revoked).toBe(true);
    expect(await keyAuthenticates(sibling.raw)).toBe(false);
  });

  it('refuses `revoked: true` on another key — 403 PERMISSION_DENIED, row unchanged', async () => {
    const caller = await mintKey('dd-caller-revoke');
    const sibling = await mintKey('dd-sibling-live');
    expect(await keyAuthenticates(sibling.raw)).toBe(true);

    await expectRefused(
      await asKey(caller.raw, 'PATCH', `/data/sys_api_key/${sibling.id}`, { revoked: true }),
      403, 'PERMISSION_DENIED',
    );
    expect((await readKey(sibling.id)).revoked).toBe(false);
    expect(await keyAuthenticates(sibling.raw)).toBe(true);
  });

  it('refuses `revoked: true` on the calling key — 403 PERMISSION_DENIED, row unchanged', async () => {
    const caller = await mintKey('dd-caller-self');
    await expectRefused(
      await asKey(caller.raw, 'PATCH', `/data/sys_api_key/${caller.id}`, { revoked: true }),
      403, 'PERMISSION_DENIED',
    );
    expect((await readKey(caller.id)).revoked).toBe(false);
    expect(await keyAuthenticates(caller.raw)).toBe(true);
  });

  it('refuses a `name` change — 403 PERMISSION_DENIED, row unchanged', async () => {
    const caller = await mintKey('dd-caller-rename');
    const sibling = await mintKey('dd-sibling-name');
    await expectRefused(
      await asKey(caller.raw, 'PATCH', `/data/sys_api_key/${sibling.id}`, { name: 'renamed' }),
      403, 'PERMISSION_DENIED',
    );
    expect((await readKey(sibling.id)).name).toBe('dd-sibling-name');
  });

  it('create and delete keep the method gate\'s 405, ahead of the credential rule', async () => {
    const caller = await mintKey('dd-caller-method');
    const sibling = await mintKey('dd-sibling-method');
    await expectRefused(await asKey(caller.raw, 'POST', '/data/sys_api_key', { name: 'forged' }), 405, 'OBJECT_API_METHOD_NOT_ALLOWED');
    await expectRefused(await asKey(caller.raw, 'DELETE', `/data/sys_api_key/${sibling.id}`), 405, 'OBJECT_API_METHOD_NOT_ALLOWED');
    expect(await keyAuthenticates(sibling.raw)).toBe(true);
  });

  it('reads are unchanged: the key lists and reads its owner\'s keys, and the stored hash is never served', async () => {
    const caller = await mintKey('dd-caller-read');
    const list = await asKey(caller.raw, 'GET', '/data/sys_api_key');
    expect(list.status, await list.clone().text()).toBe(200);
    const records: any[] = ((await list.json()) as any).records ?? [];
    expect(records.some((r) => r.id === caller.id)).toBe(true);
    for (const r of records) expect(Object.prototype.hasOwnProperty.call(r, 'key')).toBe(false);

    const one = await asKey(caller.raw, 'GET', `/data/sys_api_key/${caller.id}`);
    expect(one.status).toBe(200);
  });

  // ── controls: unchanged for the session and the system ────────────────────

  it('[control] the owner\'s session still revokes and restores a key from the list (200)', async () => {
    const key = await mintKey('dd-control-session');
    const off = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${key.id}`, { revoked: true });
    expect(off.status, await off.clone().text()).toBe(200);
    expect(await keyAuthenticates(key.raw)).toBe(false);

    const on = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${key.id}`, { revoked: false });
    expect(on.status, await on.clone().text()).toBe(200);
    expect(await keyAuthenticates(key.raw)).toBe(true);
  });

  it('[control] a key the forced reset revoked stays administrator-only for the owner\'s session (403 PERMISSION_DENIED)', async () => {
    const key = await mintKey('dd-control-forced-reset');
    // The stored state the forced reset writes (`forced-reset-revocation.ts`):
    // `revoked: true` with its reason, written in the system context.
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    await ql.update('sys_api_key', { id: key.id, revoked: true, revoked_reason: 'admin_password_reset' }, SYS);
    expect(await keyAuthenticates(key.raw)).toBe(false);

    await expectRefused(
      await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${key.id}`, { revoked: false }),
      403, 'PERMISSION_DENIED',
    );
    const row = await readKey(key.id);
    expect(row.revoked).toBe(true);
    expect(row.revoked_reason).toBe('admin_password_reset');
  });

  it('[control] the mint and the key-admission `last_used_at` stamp, both system-context writes, still land', async () => {
    const key = await mintKey('dd-control-system');
    expect((await readKey(key.id)).last_used_at ?? null).toBeNull();
    expect(await keyAuthenticates(key.raw)).toBe(true);
    expect((await readKey(key.id)).last_used_at).toBeTruthy();
  });
});
