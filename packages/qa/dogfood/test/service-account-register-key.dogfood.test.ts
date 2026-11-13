// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — one showcase boot for the whole file, its auth and data doors driven in process; no timer is waited out

/**
 * [ADR-0151 D1/D4] Registering an AI service account and minting its key,
 * over HTTP on the real showcase stack.
 *
 *   POST /api/v1/auth/service-account/register
 *   POST /api/v1/auth/service-account/create-key
 *
 * Both doors read the caller from a signed-in session: anonymous is 401, and
 * so is a caller carrying only an API key (a key never reaches them, so an
 * account can never register another or mint its own). Registration is an
 * organization or platform administrator's act; a key is minted by the
 * account's accountable owner or an administrator. The key the owner receives
 * is admitted at the data door as the account, and the account's ban (the
 * existing platform-admin door, until the lifecycle doors land) refuses it on
 * its next call exactly as an unknown key is refused, and lifting the ban
 * lets it through again. The access matrix and the one-act write are pinned
 * on a real engine in plugin-auth `service-account-doors.test.ts`.
 *
 * [ADR-0151 D3 rule 3] The key, at the REST action door: an AI service account
 * does not confirm an action for itself, so an action declaring
 * `ai.requiresConfirmation: true` refuses it whatever the request carries,
 * while its owner, a person, runs the same action. The other doors, and that a
 * refusal runs nothing, reads no record and writes no invocation row, are
 * pinned in `@objectstack/runtime` (`action-dispatch.test.ts`,
 * `mcp-resume-run.test.ts`).
 */

import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } };
const PASSWORD = 'Member-Pass-123';
const OBJECT = 'showcase_private_note';
const OWNER_EMAIL = 'service-account.owner@verify.test';
const MEMBER_EMAIL = 'service-account.member@verify.test';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.value) ? r.value : []);

let stack: VerifyStack;
let ql: any;
let adminToken: string;
let ownerSession: string;
let ownerId: string;
let memberSession: string;
let organizationId: string;
let accountId: string;
let accountKey: string;
let priorScim: string | undefined;
/** A well-formed key no row holds: the answer a refused key is compared to. */
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

const postWithKey = (path: string, key: string, body: unknown) =>
  stack.api(path, {
    method: 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const readAs = (key: string) => stack.api(`/data/${OBJECT}`, { headers: { 'x-api-key': key } });

beforeAll(async () => {
  // The ban routes answer 501 unless better-auth's admin plugin is on;
  // `OS_SCIM_ENABLED` forces it on and is read when the auth manager is
  // constructed, so it must precede the boot (as in the banned-owner pin).
  priorScim = process.env.OS_SCIM_ENABLED;
  process.env.OS_SCIM_ENABLED = 'true';
  stack = await bootShowcase();
  ql = await stack.kernel.getServiceAsync('objectql');
  adminToken = await stack.signIn();
  ownerSession = await stack.signUp(OWNER_EMAIL, PASSWORD);
  ownerId = await userIdOf(ownerSession);
  memberSession = await stack.signUp(MEMBER_EMAIL, PASSWORD);
  const adminSession: any = await (await stack.apiAs(adminToken, 'GET', '/auth/get-session')).json();
  organizationId = String(adminSession?.session?.activeOrganizationId ?? '');
  expect(organizationId).not.toBe('');
  expect(ownerId).not.toBe('');
}, 300_000);

afterAll(async () => {
  await stack?.stop?.();
  if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
  else process.env.OS_SCIM_ENABLED = priorScim;
});

describe('[ADR-0151 D1] registering an AI service account', () => {
  it('anonymous is 401, a plain member is 403, and neither writes a row', async () => {
    const before = rowsOf(await ql.find('sys_user', { where: { principal_kind: 'agent' }, ...SYS })).length;
    const anonymous = await stack.api('/auth/service-account/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Anonymous bot' }),
    });
    expect(await answerOf(anonymous)).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
    const member = await stack.apiAs(memberSession, 'POST', '/auth/service-account/register', { name: 'Member bot' });
    expect(await answerOf(member)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    expect(rowsOf(await ql.find('sys_user', { where: { principal_kind: 'agent' }, ...SYS })).length).toBe(before);
  });

  it('an administrator registers one: an agent row owned by the named person, and one plain membership of the organization', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/service-account/register', { name: 'Invoice bot', ownerId });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201);
    accountId = String(body.data.userId);
    expect(body.data).toMatchObject({ principalKind: 'agent', organizationId, ownerId });

    const [row] = rowsOf(await ql.find('sys_user', { where: { id: accountId }, ...SYS }));
    expect(row).toMatchObject({ name: 'Invoice bot', principal_kind: 'agent', accountable_user_id: ownerId, source: 'env_native' });
    expect(String(row.email)).toMatch(/@placeholder\.invalid$/);
    const members = rowsOf(await ql.find('sys_member', { where: { user_id: accountId }, ...SYS }));
    expect(members.map((m) => [m.organization_id, m.role])).toEqual([[organizationId, 'member']]);
  });

  it('a caller carrying only an API key never reaches the door', async () => {
    const minted: any = await (await stack.apiAs(adminToken, 'POST', '/keys', { name: 'admin script' })).json();
    const res = await postWithKey('/auth/service-account/register', String(minted.data.key), { name: 'Key bot' });
    expect(await answerOf(res)).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
  });
});

describe('[ADR-0151 D4] minting the account\'s key', () => {
  it('another member is refused 403; the owner mints the key, the account\'s, in its organization', async () => {
    expect(accountId).toBeTruthy();
    const other = await stack.apiAs(memberSession, 'POST', '/auth/service-account/create-key', { userId: accountId, name: 'x' });
    expect(await answerOf(other)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });

    const res = await stack.apiAs(ownerSession, 'POST', '/auth/service-account/create-key', { userId: accountId, name: 'prod' });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data).toMatchObject({ user_id: accountId, active_organization_id: organizationId });
    expect(body.data.expires_at).toBeTruthy();
    accountKey = String(body.data.key);

    const [key] = rowsOf(await ql.find('sys_api_key', { where: { id: body.data.id }, ...SYS }));
    expect(key).toMatchObject({ user_id: accountId, active_organization_id: organizationId });
  });

  it('the key is admitted at the data door as the account, where a made-up key is not', async () => {
    const made = await answerOf(await readAs(madeUpKey));
    expect(made.status).toBe(401);
    const read = await answerOf(await readAs(accountKey));
    expect(read.status, JSON.stringify(read)).not.toBe(401);
  });

  it('the account\'s own key mints nothing: not here, and not at POST /keys', async () => {
    const here = await postWithKey('/auth/service-account/create-key', accountKey, { userId: accountId });
    expect(await answerOf(here)).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
    const keys = await postWithKey('/keys', accountKey, { name: 'self' });
    expect(keys.status).toBe(403);
    expect(rowsOf(await ql.find('sys_api_key', { where: { user_id: accountId }, ...SYS })).length).toBe(1);
  });

  it('a person\'s id is answered as unknown: the door never mints a person\'s key', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/service-account/create-key', { userId: ownerId });
    expect(await answerOf(res)).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
  });

  it('banning the account refuses its key on the next call as a made-up key is refused; lifting the ban lets it through', async () => {
    const ban = await stack.apiAs(adminToken, 'POST', '/auth/admin/ban-user', { userId: accountId });
    expect(ban.status, await ban.clone().text()).toBe(200);
    expect(await answerOf(await readAs(accountKey))).toEqual(await answerOf(await readAs(madeUpKey)));

    const unban = await stack.apiAs(adminToken, 'POST', '/auth/admin/unban-user', { userId: accountId });
    expect(unban.status, await unban.clone().text()).toBe(200);
    expect((await answerOf(await readAs(accountKey))).status).not.toBe(401);
  });
});

describe('[ADR-0151 D3 rule 3] the account does not confirm an action for itself', () => {
  /** A platform identity action its author gated on a person's confirmation. */
  const GATED = '/actions/sys_session/revoke_my_other_sessions';

  it('the account\'s key is refused 428 at REST /actions with the confirmation member and without it', async () => {
    expect(accountKey).toBeTruthy();
    for (const body of [{}, { confirm: true }]) {
      const res = await postWithKey(GATED, accountKey, body);
      const text = await res.text();
      let error: any;
      try { error = JSON.parse(text)?.error; } catch { error = undefined; }
      expect({ status: res.status, code: error?.code }, text).toEqual({ status: 428, code: 'ACTION_CONFIRMATION_REQUIRED' });
      expect(String(error?.message)).toContain('An AI service account does not confirm an action for itself');
      expect(String(error?.message)).not.toMatch(/retry/i);
    }
  });

  it('CONTROL: the account\'s owner, a person, runs the same action at REST', async () => {
    const res = await stack.apiAs(ownerSession, 'POST', GATED, {});
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
