// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — one showcase boot for the whole file, its auth and data doors driven in process; no timer is waited out

/**
 * [ADR-0151 D6] An AI service account's lifecycle, over HTTP on the real
 * showcase stack: its key is judged at the data door after every act.
 *
 *   POST /api/v1/auth/service-account/{suspend,resume,set-owner,retire,revoke-key,restore-key}
 *
 * - The owner suspends it: its key is refused on the next call exactly as an
 *   unknown key is refused. The owner cannot resume it; an administrator can,
 *   and the same key works again.
 * - An administrator revokes one key: that key is refused as every revoked key
 *   is (`403 API_KEY_REVOKED`), the account's other
 *   key still works; the owner cannot restore an administrator's stop, the
 *   administrator can.
 * - The owner leaves the organization (the vendor's remove-member): the
 *   account is suspended; it is not resumed until an administrator names a
 *   new owner.
 * - Retire: every key is revoked, and no key mints or is restored after.
 * - A caller carrying only an API key never reaches these doors.
 *
 * The access matrix is pinned on a real engine in plugin-auth
 * `service-account-lifecycle.test.ts`.
 */

import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } };
const PASSWORD = 'Member-Pass-123';
const OBJECT = 'showcase_private_note';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.value) ? r.value : []);

let stack: VerifyStack;
let ql: any;
let adminToken: string;
let ownerSession: string;
let ownerId: string;
let secondId: string;
let organizationId: string;
let accountId: string;
let keyA: { id: string; key: string };
let keyB: { id: string; key: string };
let priorScim: string | undefined;
const madeUpKey = `osk_${randomBytes(32).toString('base64url')}`;

const userIdOf = async (session: string): Promise<string> => {
  const me = await stack.apiAs(session, 'GET', '/auth/get-session');
  return String(((await me.json()) as any)?.user?.id ?? '');
};

const answerOf = async (res: Response) => {
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = undefined; }
  return { status: res.status, code: body?.error?.code ?? body?.code };
};

const readAs = (key: string) => stack.api(`/data/${OBJECT}`, { headers: { 'x-api-key': key } });
const refusedLikeMadeUp = async (key: string) =>
  expect(await answerOf(await readAs(key))).toEqual(await answerOf(await readAs(madeUpKey)));
/** A revoked key is answered as the platform answers every revoked key. */
const revoked = async (key: string) =>
  expect(await answerOf(await readAs(key))).toEqual({ status: 403, code: 'API_KEY_REVOKED' });
const admitted = async (key: string) => expect((await answerOf(await readAs(key))).status).not.toBe(401);

const act = async (session: string, door: string, body: Record<string, unknown>) =>
  answerOf(await stack.apiAs(session, 'POST', `/auth/service-account/${door}`, body));

const mint = async (session: string): Promise<{ id: string; key: string }> => {
  const res = await stack.apiAs(session, 'POST', '/auth/service-account/create-key', { userId: accountId, name: 'k' });
  const body: any = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(201);
  return { id: String(body.data.id), key: String(body.data.key) };
};

beforeAll(async () => {
  // The admin plugin (OS_SCIM_ENABLED forces it on) serves the vendor
  // remove-member path this file drives; read when the auth manager is built.
  priorScim = process.env.OS_SCIM_ENABLED;
  process.env.OS_SCIM_ENABLED = 'true';
  stack = await bootShowcase();
  ql = await stack.kernel.getServiceAsync('objectql');
  adminToken = await stack.signIn();
  ownerSession = await stack.signUp('service-account.lifecycle.owner@verify.test', PASSWORD);
  ownerId = await userIdOf(ownerSession);
  secondId = await userIdOf(await stack.signUp('service-account.lifecycle.second@verify.test', PASSWORD));
  const adminSession: any = await (await stack.apiAs(adminToken, 'GET', '/auth/get-session')).json();
  organizationId = String(adminSession?.session?.activeOrganizationId ?? '');
  expect(organizationId).not.toBe('');

  const reg = await stack.apiAs(adminToken, 'POST', '/auth/service-account/register', { name: 'Lifecycle bot', ownerId });
  const body: any = await reg.json();
  expect(reg.status, JSON.stringify(body)).toBe(201);
  accountId = String(body.data.userId);
  keyA = await mint(ownerSession);
  keyB = await mint(ownerSession);
}, 300_000);

afterAll(async () => {
  await stack?.stop?.();
  if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
  else process.env.OS_SCIM_ENABLED = priorScim;
});

describe('[ADR-0151 D6] the AI service account\'s lifecycle, judged at the data door', () => {
  it('a caller carrying only an API key never reaches the lifecycle doors', async () => {
    for (const door of ['suspend', 'resume', 'revoke-key']) {
      const res = await stack.api(`/auth/service-account/${door}`, {
        method: 'POST',
        headers: { 'x-api-key': keyA.key, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: accountId, keyId: keyA.id }),
      });
      expect(await answerOf(res), door).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
    }
    await admitted(keyA.key);
  });

  it('the owner suspends it and its keys are refused; the owner cannot resume it, an administrator can', async () => {
    await admitted(keyA.key);
    expect(await act(ownerSession, 'suspend', { userId: accountId })).toMatchObject({ status: 200 });
    await refusedLikeMadeUp(keyA.key);
    await refusedLikeMadeUp(keyB.key);

    expect(await act(ownerSession, 'resume', { userId: accountId })).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    await refusedLikeMadeUp(keyA.key);

    expect(await act(adminToken, 'resume', { userId: accountId })).toMatchObject({ status: 200 });
    await admitted(keyA.key);
    await admitted(keyB.key);
  });

  it('an administrator revokes one key: that key alone stops; the owner cannot restore it, the administrator can', async () => {
    expect(await act(adminToken, 'revoke-key', { keyId: keyA.id })).toMatchObject({ status: 200 });
    await revoked(keyA.key);
    await admitted(keyB.key);

    expect(await act(ownerSession, 'restore-key', { keyId: keyA.id })).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    await revoked(keyA.key);
    expect(await act(adminToken, 'restore-key', { keyId: keyA.id })).toMatchObject({ status: 200 });
    await admitted(keyA.key);
  });

  it('the owner leaves the organization: the account is suspended until an administrator names a new owner', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/organization/remove-member', {
      memberIdOrEmail: 'service-account.lifecycle.owner@verify.test', organizationId,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(rowsOf(await ql.find('sys_member', { where: { user_id: ownerId, organization_id: organizationId }, ...SYS }))).toEqual([]);
    await refusedLikeMadeUp(keyB.key);

    expect(await act(adminToken, 'resume', { userId: accountId })).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
    expect(await act(adminToken, 'set-owner', { userId: accountId, ownerId: secondId })).toMatchObject({ status: 200 });
    await refusedLikeMadeUp(keyB.key);
    expect(await act(adminToken, 'resume', { userId: accountId })).toMatchObject({ status: 200 });
    await admitted(keyB.key);
  });

  it('retire: every key is refused, and no key mints after', async () => {
    expect(await act(adminToken, 'retire', { userId: accountId })).toMatchObject({ status: 200 });
    await revoked(keyA.key);
    await revoked(keyB.key);
    expect(await act(adminToken, 'create-key', { userId: accountId })).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
    expect(await act(adminToken, 'restore-key', { keyId: keyB.id })).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    const [row] = rowsOf(await ql.find('sys_user', { where: { id: accountId }, ...SYS }));
    expect(row).toMatchObject({ principal_kind: 'agent' });
  });
});
