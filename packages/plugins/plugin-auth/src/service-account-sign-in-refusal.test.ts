// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0151 D2] An AI service account never signs in: every sign-in method,
// impersonation and every server-minted session refuse an `agent` row, and
// the account never holds a password or a sign-in provider link.
//
// The refusal lives in ONE place, better-auth's `session.create.before`
// database hook, because every session better-auth creates goes through
// `internalAdapter.createSession` (better-auth 1.7.12 `db/internal-adapter.mjs`:
// `createWithHooks(…, "session", …)`, secondary storage included). So the
// cases below drive that one seam through several of its doors, each a real
// request through `AuthManager.handleRequest` or the real mint:
//
//   - password sign-in (`/sign-in/email`);
//   - magic link (`/sign-in/magic-link` then `/magic-link/verify`);
//   - impersonation (`/admin/impersonate-user`) by a platform administrator;
//   - the principal-session mint, handed a context that CLAIMS `human`;
//   - `internalAdapter.createSession` itself, the call social, SSO, passkey,
//     one-time code, device and one-time-token sign-in all make.
//
// And the credential half, `account.create.before`: `internalAdapter.createAccount`
// / `linkAccount`, the two calls every password set and provider link makes.
//
// The account row is staged by turning a signed-up person's row into an
// `agent` row directly in the engine double, which runs no hooks. That is the
// state a registration produces (an `agent` row, here holding a password a
// registration never writes), and it is the hardest case for the refusal: the
// password is right, so only the kind refuses. Each refusal is asserted as
// `status` AND `code` (ADR-0112), and on its effect: no session row was
// written, and the bearer resolves nobody. Each has a CONTROL on the same
// rig: a person signs in, is impersonated, and links a credential as before.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import {
  AGENT_ACCOUNT_CREDENTIAL_REFUSAL,
  AGENT_ACCOUNT_SESSION_REFUSAL,
  refuseAgentAccountCredential,
  refuseAgentAccountSession,
} from './service-account-identity';
// [#23184] Vendor modules paid at module load, never inside a clocked case.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/admin';
import 'better-auth/plugins/magic-link';
import '@better-auth/core/context';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-31739';
const BASE = 'http://localhost:3000/api/v1/auth';
const PS_ADMIN = 'ps_admin_full_access';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    plugins: { admin: true, magicLink: true },
  } as any);

const post = (manager: AuthManager, path: string, body: unknown, bearer?: string) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    }),
  );

const signUp = async (manager: AuthManager, email: string, name: string) => {
  const invitationId = await inviteForAudienceGate(manager, email);
  return post(manager, '/sign-up/email', { email, password: PASSWORD, name, invitationId });
};

const signIn = (manager: AuthManager, email: string) => post(manager, '/sign-in/email', { email, password: PASSWORD });

const bearerFrom = (response: Response): string => {
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error(`no set-auth-token on the response (status ${response.status})`);
  return token;
};

const rowsOf = (engine: any, table: string) => (engine.tables.get(table) ?? []) as any[];

const userIdFor = (engine: any, email: string): string => {
  const row = rowsOf(engine, 'sys_user').find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

const sessionsOf = (engine: any, userId: string) => rowsOf(engine, 'sys_session').filter((r) => r.user_id === userId);

const grantPlatformAdmin = async (engine: any, userId: string) => {
  let org = rowsOf(engine, 'sys_organization').find((r) => r.slug === 'default');
  if (!org) {
    await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' });
    org = { id: 'org_default' };
  }
  if (!rowsOf(engine, 'sys_permission_set').some((r) => r.id === PS_ADMIN)) {
    await engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS });
  }
  await engine.insert('sys_user_permission_set', {
    user_id: userId,
    permission_set_id: PS_ADMIN,
    permission_set: 'admin_full_access',
    organization_id: org.id,
  });
};

/** Turn a person's row into an AI service account row, as a registration leaves it. */
const makeAgentAccount = (engine: any, userId: string, ownerId: string) => {
  const row = rowsOf(engine, 'sys_user').find((r) => String(r.id) === userId);
  row.principal_kind = 'agent';
  row.accountable_user_id = ownerId;
};

const jsonOf = async (res: Response) => JSON.parse(await res.text());

/** The sign-ups every case starts from, made once per file (#23184). */
let signedUpTables: Promise<Map<string, any[]>> | undefined;
const signedUpOnce = (): Promise<Map<string, any[]>> =>
  (signedUpTables ??= (async () => {
    const template = createMemoryEngine();
    const manager = makeManager(template);
    await signUp(manager, 'padmin@example.com', 'Platform Admin');
    await signUp(manager, 'agent@example.com', 'Agent Account');
    await signUp(manager, 'person@example.com', 'A Person');
    return template.tables as Map<string, any[]>;
  })());

const arrange = async () => {
  const engine = createMemoryEngine();
  for (const [name, rows] of await signedUpOnce()) engine.tables.set(name, structuredClone(rows));
  const manager = makeManager(engine);
  const adminId = userIdFor(engine, 'padmin@example.com');
  const agentId = userIdFor(engine, 'agent@example.com');
  const personId = userIdFor(engine, 'person@example.com');
  await grantPlatformAdmin(engine, adminId);
  makeAgentAccount(engine, agentId, adminId);
  // The sign-ups gave every user a session; the cases count what comes after.
  engine.tables.set('sys_session', rowsOf(engine, 'sys_session').filter((r) => r.user_id !== agentId && r.user_id !== personId));
  return { engine, manager, adminId, agentId, personId };
};

const expectSessionRefusal = async (res: Response) => {
  expect(res.status).toBe(403);
  const body = await jsonOf(res);
  expect(body.code).toBe(AGENT_ACCOUNT_SESSION_REFUSAL.code);
  expect(body.message).toBe(AGENT_ACCOUNT_SESSION_REFUSAL.message);
  expect(res.headers.get('set-auth-token')).toBeNull();
};

const expectRejectedWith = async (promise: Promise<unknown>, refusal: { code: string; message: string }) => {
  const err: any = await promise.then(() => undefined, (e) => e);
  expect(err, 'the call was refused').toBeDefined();
  expect(err.statusCode ?? err.status).toBe(403);
  expect(err.body?.code).toBe(refusal.code);
  expect(err.body?.message).toBe(refusal.message);
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

describe.concurrent('ADR-0151 D2 — no sign-in method gives an AI service account a session', () => {
  it('password sign-in is refused, though the password is right, and writes no session', async () => {
    const { engine, manager, agentId } = await arrange();
    await expectSessionRefusal(await signIn(manager, 'agent@example.com'));
    expect(sessionsOf(engine, agentId)).toHaveLength(0);
  });

  it('CONTROL: a person signs in with a password as before', async () => {
    const { engine, manager, personId } = await arrange();
    const res = await signIn(manager, 'person@example.com');
    expect(res.status).toBe(200);
    bearerFrom(res);
    expect(sessionsOf(engine, personId)).toHaveLength(1);
  });

  it('a magic link is refused at verification and writes no session', async () => {
    const { engine, manager, agentId } = await arrange();
    const warn = vi.mocked(console.warn);
    const sent = await post(manager, '/sign-in/magic-link', { email: 'agent@example.com' });
    expect(sent.status).toBe(200);
    // No email service is wired, so the development fallback prints the link.
    const line = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('agent@example.com') && m.includes('URL: '));
    expect(line, 'the magic link was printed').toBeDefined();
    const token = new URL(line!.slice(line!.indexOf('URL: ') + 5).trim()).searchParams.get('token');
    expect(token).toBeTruthy();
    const verified = await manager.handleRequest(
      new Request(`${BASE}/magic-link/verify?token=${encodeURIComponent(token!)}`, { method: 'GET' }),
    );
    // The vendor redirects a failed verification when a callback is set; with
    // none it answers the refusal itself.
    expect([302, 403]).toContain(verified.status);
    expect(verified.headers.get('set-auth-token')).toBeNull();
    expect(sessionsOf(engine, agentId)).toHaveLength(0);
  });

  it('a platform administrator impersonating an account is refused, and no impersonation session exists', async () => {
    const { engine, manager, agentId } = await arrange();
    const adminBearer = bearerFrom(await signIn(manager, 'padmin@example.com'));
    await expectSessionRefusal(await post(manager, '/admin/impersonate-user', { userId: agentId }, adminBearer));
    expect(sessionsOf(engine, agentId)).toHaveLength(0);
    expect(rowsOf(engine, 'sys_session').filter((r) => r.impersonated_by)).toHaveLength(0);
  });

  it('CONTROL: the same administrator impersonates a person as before', async () => {
    const { engine, manager, personId } = await arrange();
    const adminBearer = bearerFrom(await signIn(manager, 'padmin@example.com'));
    const res = await post(manager, '/admin/impersonate-user', { userId: personId }, adminBearer);
    expect(res.status).toBe(200);
    expect(sessionsOf(engine, personId).filter((r) => r.impersonated_by)).toHaveLength(1);
  });

  it('the principal-session mint is refused for an account even when the context claims a person', async () => {
    const { engine, manager, agentId } = await arrange();
    await expectRejectedWith(
      manager.mintPrincipalSession({ userId: agentId, principalKind: 'human' } as any),
      AGENT_ACCOUNT_SESSION_REFUSAL,
    );
    expect(sessionsOf(engine, agentId)).toHaveLength(0);
  });

  it('internalAdapter.createSession, the call every other sign-in method makes, is refused', async () => {
    const { engine, manager, agentId } = await arrange();
    const ctx: any = await (await manager.getAuthInstance() as any).$context;
    await expectRejectedWith(ctx.internalAdapter.createSession(agentId, false), AGENT_ACCOUNT_SESSION_REFUSAL);
    expect(sessionsOf(engine, agentId)).toHaveLength(0);
  });

  it('CONTROL: internalAdapter.createSession for a person creates the session', async () => {
    const { engine, manager, personId } = await arrange();
    const ctx: any = await (await manager.getAuthInstance() as any).$context;
    const session = await ctx.internalAdapter.createSession(personId, false);
    expect(session?.userId).toBe(personId);
    expect(sessionsOf(engine, personId)).toHaveLength(1);
  });
});

describe.concurrent('ADR-0151 D2 — an AI service account holds no password and no provider link', () => {
  it('createAccount (a password) and linkAccount (a provider) are refused and write no sys_account row', async () => {
    const { engine, manager, agentId } = await arrange();
    const ctx: any = await (await manager.getAuthInstance() as any).$context;
    const before = rowsOf(engine, 'sys_account').filter((r) => r.user_id === agentId).length;
    await expectRejectedWith(
      ctx.internalAdapter.createAccount({ userId: agentId, providerId: 'credential', accountId: agentId, password: 'x' }),
      AGENT_ACCOUNT_CREDENTIAL_REFUSAL,
    );
    await expectRejectedWith(
      ctx.internalAdapter.linkAccount({ userId: agentId, providerId: 'github', accountId: 'gh-31739' }),
      AGENT_ACCOUNT_CREDENTIAL_REFUSAL,
    );
    expect(rowsOf(engine, 'sys_account').filter((r) => r.user_id === agentId)).toHaveLength(before);
  });

  it('CONTROL: a person links a provider as before', async () => {
    const { engine, manager, personId } = await arrange();
    const ctx: any = await (await manager.getAuthInstance() as any).$context;
    await ctx.internalAdapter.linkAccount({ userId: personId, providerId: 'github', accountId: 'gh-person' });
    expect(rowsOf(engine, 'sys_account').some((r) => r.user_id === personId && r.provider_id === 'github')).toBe(true);
  });
});

describe.concurrent('ADR-0151 D2 — a read of the row that fails refuses', () => {
  // The kind lives on the row, so a read that fails cannot tell a person from
  // an account. Both refusals treat it as an account: a sign-in fails closed.
  const brokenEngine = { find: vi.fn(async () => { throw new Error('db down'); }) };

  it('a session whose user row cannot be read is refused', async () => {
    await expectRejectedWith(refuseAgentAccountSession(brokenEngine, { userId: 'u_any' }), AGENT_ACCOUNT_SESSION_REFUSAL);
  });

  it('a credential whose user row cannot be read is refused', async () => {
    await expectRejectedWith(refuseAgentAccountCredential(brokenEngine, { userId: 'u_any' }), AGENT_ACCOUNT_CREDENTIAL_REFUSAL);
  });

  it('CONTROL: a readable person row passes both', async () => {
    const engine = { find: vi.fn(async () => [{ id: 'u_any', principal_kind: 'human' }]) };
    await expect(refuseAgentAccountSession(engine, { userId: 'u_any' })).resolves.toBeUndefined();
    await expect(refuseAgentAccountCredential(engine, { userId: 'u_any' })).resolves.toBeUndefined();
  });
});
