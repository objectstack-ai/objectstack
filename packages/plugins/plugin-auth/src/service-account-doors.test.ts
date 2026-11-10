// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D1/D4] The AI service account's registration and key mint
 * (`service-account-doors.ts`), on a REAL ObjectQL engine over better-sqlite3
 * `:memory:` with the real `sys_user` row rules registered
 * (`registerServiceAccountRowGuard`), so the engine dispatches the hooks the
 * registration's insert must pass. The vendor's `addMember` is the one
 * double: it writes the membership row (or refuses, where a pin says so).
 *
 * What is pinned, each refusal beside its CONTROL:
 *
 *  - who may register (an organization administrator, a platform
 *    administrator) and who may not (a plain member; no current organization);
 *  - what register writes, in one act: the agent row with its owner, an
 *    undeliverable placeholder address and `env_native`, and one plain
 *    membership; a membership the vendor refuses leaves no row behind;
 *  - the owner: a member of the organization, never another account;
 *  - who may mint a key (the owner, an administrator of the account's
 *    organization, a platform administrator) and who may not (another member,
 *    an administrator of another organization);
 *  - what the key is: the account's, in the account's organization, signed
 *    under the lifecycle policy, its secret returned once and stored hashed;
 *  - a person's id, and a retired account, get no key;
 *  - an unreadable membership is an outage (503), never a verdict;
 *  - [ADR-0151 D7] a refusal a hook or middleware DECLARES on either write
 *    (the user row, the membership) is answered with its own status, the
 *    closed code in `code` and its own spelling in `declaredCode` (ADR-0112
 *    D4), and nothing is written; an undeclared throw still fails.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthzStoreUnavailableError, hashApiKey, isAuthzStoreUnavailableError } from '@objectstack/core';

import {
  runCreateServiceAccountKey, runRegisterServiceAccount,
  type ServiceAccountCaller, type ServiceAccountDoorDeps,
} from './service-account-doors.js';
import { registerServiceAccountRowGuard } from './service-account-identity.js';
import { isPlaceholderEmail } from './placeholder-email.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYSTEM = { context: { isSystem: true } } as const;
const ORG = 'org_a';
const OTHER_ORG = 'org_b';
const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-11-09T12:00:00.000Z');

const text = (name: string) => ({ name, type: 'text' as const });
const OBJECTS = [
  {
    name: 'sys_user',
    label: 'User',
    fields: {
      id: { ...text('id'), primaryKey: true },
      name: text('name'),
      email: text('email'),
      email_verified: { name: 'email_verified', type: 'boolean' as const },
      principal_kind: text('principal_kind'),
      accountable_user_id: text('accountable_user_id'),
      source: text('source'),
    },
  },
  {
    name: 'sys_member',
    label: 'Member',
    fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), organization_id: text('organization_id'), role: text('role') },
  },
  {
    name: 'sys_api_key',
    label: 'API Key',
    fields: {
      id: { ...text('id'), primaryKey: true },
      name: text('name'),
      key: text('key'),
      prefix: text('prefix'),
      user_id: text('user_id'),
      revoked: { name: 'revoked', type: 'boolean' as const },
      expires_at: text('expires_at'),
      active_organization_id: text('active_organization_id'),
    },
  },
];

let engine: ObjectQL;
let refuseMembership: Error | undefined;
let failMemberReads = false;

const POLICY = { defaultExpiryDays: 90, maxExpiryDays: 365, inactivityDays: 90 } as any;

type FindArgs = Parameters<ObjectQL['find']>;
type InsertArgs = Parameters<ObjectQL['insert']>;

const deps = (): ServiceAccountDoorDeps => ({
  getDataEngine: () => ({
    find: (object, query, options) => {
      if (failMemberReads && object === 'sys_member') return Promise.reject(new Error('sys_member is unreachable'));
      return engine.find(object, query as FindArgs[1], options as FindArgs[2]);
    },
    insert: (object, data, options) => engine.insert(object, data, options as InsertArgs[2]),
  }),
  addMember: async ({ userId, organizationId }) => {
    if (refuseMembership) throw refuseMembership;
    await engine.insert('sys_member', { user_id: userId, organization_id: organizationId, role: 'member' }, SYSTEM);
  },
  runAtomically: (work) => engine.transaction(async () => work()),
  resolveApiKeyLifecyclePolicy: () => POLICY,
  now: () => NOW,
});

const caller = (id: string, opts: Partial<ServiceAccountCaller> = {}): ServiceAccountCaller => ({
  id, isPlatformAdmin: false, activeOrganizationId: ORG, ...opts,
});

const post = (body: unknown) =>
  new Request('http://localhost/api/v1/auth/service-account/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const rows = async (object: string, where: Record<string, unknown> = {}) =>
  (await engine.find(object, { where, ...SYSTEM })) as Array<Record<string, any>>;

beforeEach(async () => {
  refuseMembership = undefined;
  failMemberReads = false;
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const o of OBJECTS) engine.registry.registerObject(o as never);
  await engine.syncSchemas();
  await relaxTenantColumns(engine, ['sys_user', 'sys_member', 'sys_api_key']);
  registerServiceAccountRowGuard(engine, { packageId: 'test.service-account-doors' });

  for (const id of ['usr_admin', 'usr_owner', 'usr_member', 'usr_other_admin', 'usr_platform']) {
    await engine.insert('sys_user', { id, name: id, email: `${id}@a.example`, email_verified: true, principal_kind: 'human' }, SYSTEM);
  }
  const members: Array<[string, string, string]> = [
    ['usr_admin', ORG, 'admin'],
    ['usr_owner', ORG, 'member'],
    ['usr_member', ORG, 'member'],
    ['usr_other_admin', OTHER_ORG, 'owner'],
  ];
  for (const [user_id, organization_id, role] of members) {
    await engine.insert('sys_member', { user_id, organization_id, role }, SYSTEM);
  }
});

afterEach(async () => {
  try { await engine.destroy(); } catch { /* noop */ }
});

/** Register an account owned by `usr_owner`, as the organization administrator. */
async function registered(name = 'Invoice bot'): Promise<string> {
  const r = await runRegisterServiceAccount(deps(), caller('usr_admin'), post({ name, ownerId: 'usr_owner' }));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return String(r.body.data!.userId);
}

describe('[ADR-0151 D1] register: who may, and what one act writes', () => {
  it('an organization administrator registers an account: the agent row, its owner, an undeliverable address, and one plain membership', async () => {
    const r = await runRegisterServiceAccount(deps(), caller('usr_admin'), post({ name: 'Invoice bot', ownerId: 'usr_owner' }));
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ name: 'Invoice bot', principalKind: 'agent', organizationId: ORG, ownerId: 'usr_owner' });
    const id = String(r.body.data!.userId);

    const [row] = await rows('sys_user', { id });
    expect(row).toMatchObject({ name: 'Invoice bot', principal_kind: 'agent', accountable_user_id: 'usr_owner', source: 'env_native' });
    expect(isPlaceholderEmail(row.email)).toBe(true);
    expect(await rows('sys_member', { user_id: id })).toEqual([
      expect.objectContaining({ organization_id: ORG, role: 'member' }),
    ]);
  });

  it('the placeholder address never repeats: two accounts get two distinct undeliverable addresses', async () => {
    const a = await registered('Bot A');
    const b = await registered('Bot B');
    const [ra] = await rows('sys_user', { id: a });
    const [rb] = await rows('sys_user', { id: b });
    expect(ra.email).not.toBe(rb.email);
    for (const email of [ra.email, rb.email]) {
      expect(isPlaceholderEmail(email)).toBe(true);
      expect(email).toMatch(/@placeholder\.invalid$/);
    }
  });

  it('the owner defaults to the caller', async () => {
    const r = await runRegisterServiceAccount(deps(), caller('usr_admin'), post({ name: 'Bot' }));
    expect(r.status).toBe(201);
    const [row] = await rows('sys_user', { id: String(r.body.data!.userId) });
    expect(row.accountable_user_id).toBe('usr_admin');
  });

  it('a platform administrator registers one too', async () => {
    const r = await runRegisterServiceAccount(
      deps(), caller('usr_platform', { isPlatformAdmin: true }), post({ name: 'Bot', ownerId: 'usr_owner' }),
    );
    expect(r.status).toBe(201);
  });

  it('a plain member is refused 403 and nothing is written', async () => {
    const before = (await rows('sys_user')).length;
    const r = await runRegisterServiceAccount(deps(), caller('usr_member'), post({ name: 'Bot', ownerId: 'usr_member' }));
    expect(r).toMatchObject({ status: 403, body: { error: { code: 'PERMISSION_DENIED' } } });
    expect((await rows('sys_user')).length).toBe(before);
  });

  it('an administrator of another organization is refused 403 in this one', async () => {
    const r = await runRegisterServiceAccount(deps(), caller('usr_other_admin'), post({ name: 'Bot', ownerId: 'usr_owner' }));
    expect(r).toMatchObject({ status: 403, body: { error: { code: 'PERMISSION_DENIED' } } });
  });

  it('no current organization is refused 400', async () => {
    const r = await runRegisterServiceAccount(deps(), caller('usr_admin', { activeOrganizationId: null }), post({ name: 'Bot' }));
    expect(r).toMatchObject({ status: 400, body: { error: { code: 'INVALID_REQUEST' } } });
  });

  it('a name is required', async () => {
    const r = await runRegisterServiceAccount(deps(), caller('usr_admin'), post({ ownerId: 'usr_owner' }));
    expect(r).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED', fields: [{ field: 'name', code: 'required' }] } } });
  });

  it('an owner who is not a member of the organization is refused at ownerId', async () => {
    const r = await runRegisterServiceAccount(deps(), caller('usr_admin'), post({ name: 'Bot', ownerId: 'usr_other_admin' }));
    expect(r).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED', fields: [{ field: 'ownerId', code: 'invalid_value' }] } } });
  });

  it('another account is never an owner: the row rules refuse it, and no row is written', async () => {
    const bot = await registered();
    const before = (await rows('sys_user')).length;
    const r = await runRegisterServiceAccount(deps(), caller('usr_admin'), post({ name: 'Bot 2', ownerId: bot }));
    expect(r).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED', fields: [{ field: 'accountable_user_id', code: 'invalid_value' }] } } });
    expect((await rows('sys_user')).length).toBe(before);
  });

  it('a membership the vendor refuses rolls the row back: no account exists without its organization', async () => {
    refuseMembership = Object.assign(new Error('limit'), {
      statusCode: 403, body: { code: 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED', message: 'Organization membership limit reached' },
    });
    const before = (await rows('sys_user')).length;
    const r = await runRegisterServiceAccount(deps(), caller('usr_admin'), post({ name: 'Bot', ownerId: 'usr_owner' }));
    expect(r).toMatchObject({ status: 403, body: { error: { code: 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED' } } });
    expect((await rows('sys_user')).length).toBe(before);
    expect(await rows('sys_user', { principal_kind: 'agent' })).toEqual([]);
  });

  it('an unreadable membership is an outage, never a verdict on the caller', async () => {
    failMemberReads = true;
    await expect(runRegisterServiceAccount(deps(), caller('usr_admin'), post({ name: 'Bot' })))
      .rejects.toSatisfy(isAuthzStoreUnavailableError);
  });
});

describe('[ADR-0151 D4] create-key: who may mint, and what the key is', () => {
  it('the owner mints a key: the account\'s, in its organization, under the default life; the secret once, stored hashed', async () => {
    const bot = await registered();
    const r = await runCreateServiceAccountKey(deps(), caller('usr_owner'), post({ userId: bot, name: 'prod' }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const data = r.body.data as Record<string, any>;
    expect(data).toMatchObject({ name: 'prod', user_id: bot, active_organization_id: ORG });
    expect(data.expires_at).toBe(new Date(NOW + 90 * DAY_MS).toISOString());
    expect(typeof data.key).toBe('string');

    const [key] = await rows('sys_api_key', { id: data.id });
    expect(key).toMatchObject({ user_id: bot, active_organization_id: ORG, key: hashApiKey(data.key), prefix: data.prefix });
    expect(JSON.stringify(key)).not.toContain(data.key);
  });

  it('an administrator of the account\'s organization mints one, and so does a platform administrator', async () => {
    const bot = await registered();
    expect((await runCreateServiceAccountKey(deps(), caller('usr_admin'), post({ userId: bot }))).status).toBe(201);
    expect((await runCreateServiceAccountKey(
      deps(), caller('usr_platform', { isPlatformAdmin: true, activeOrganizationId: null }), post({ userId: bot }),
    )).status).toBe(201);
  });

  it('the organization is the account\'s, never the caller\'s current one', async () => {
    const bot = await registered();
    const r = await runCreateServiceAccountKey(
      deps(), caller('usr_admin', { activeOrganizationId: OTHER_ORG }), post({ userId: bot }),
    );
    expect(r.body.data).toMatchObject({ active_organization_id: ORG });
  });

  it('another member is refused 403, and so is an administrator of another organization; no key is written', async () => {
    const bot = await registered();
    for (const who of ['usr_member', 'usr_other_admin']) {
      const r = await runCreateServiceAccountKey(deps(), caller(who), post({ userId: bot }));
      expect(r).toMatchObject({ status: 403, body: { error: { code: 'PERMISSION_DENIED' } } });
    }
    expect(await rows('sys_api_key')).toEqual([]);
  });

  it('a person\'s id is answered as unknown: this door never mints a person\'s key', async () => {
    const r = await runCreateServiceAccountKey(deps(), caller('usr_admin'), post({ userId: 'usr_member' }));
    expect(r).toMatchObject({ status: 404, body: { error: { code: 'RESOURCE_NOT_FOUND' } } });
    expect(await rows('sys_api_key')).toEqual([]);
  });

  it('a retired account (no membership) gets no key', async () => {
    const bot = await registered();
    await engine.delete('sys_member', { where: { user_id: bot }, multi: true, ...SYSTEM });
    const r = await runCreateServiceAccountKey(deps(), caller('usr_admin'), post({ userId: bot }));
    expect(r).toMatchObject({ status: 409, body: { error: { code: 'RESOURCE_CONFLICT' } } });
  });

  it('the owner who has left the organization is no longer admitted as owner', async () => {
    const bot = await registered();
    await engine.delete('sys_member', { where: { user_id: 'usr_owner' }, multi: true, ...SYSTEM });
    const r = await runCreateServiceAccountKey(deps(), caller('usr_owner'), post({ userId: bot }));
    expect(r).toMatchObject({ status: 403, body: { error: { code: 'PERMISSION_DENIED' } } });
  });

  it('the same lifecycle policy as POST /keys: a date past the ceiling is refused, exactly the ceiling is signed', async () => {
    const bot = await registered();
    const tooFar = await runCreateServiceAccountKey(
      deps(), caller('usr_owner'), post({ userId: bot, expires_at: new Date(NOW + 400 * DAY_MS).toISOString() }),
    );
    expect(tooFar).toMatchObject({
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED', fields: [{ field: 'expires_at', code: 'invalid_value' }] } },
    });
    const ceiling = new Date(NOW + 365 * DAY_MS).toISOString();
    const ok = await runCreateServiceAccountKey(deps(), caller('usr_owner'), post({ userId: bot, expires_at: ceiling }));
    expect(ok.body.data).toMatchObject({ expires_at: ceiling });
    const past = await runCreateServiceAccountKey(deps(), caller('usr_owner'), post({ userId: bot, expires_at: '2020-01-01' }));
    expect(past).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
  });

  it('userId is required', async () => {
    const r = await runCreateServiceAccountKey(deps(), caller('usr_admin'), post({}));
    expect(r).toMatchObject({ status: 400, body: { error: { code: 'INVALID_REQUEST' } } });
  });
});

describe('[ADR-0151 D7] register: a licence refusal declared on either write keeps its status and code', () => {
  const PACKAGE = 'test.licence-plugin';
  /** What cloud's AI-seat cap throws: a numeric `statusCode` and its own string `code`. */
  const seatCap = (extra: Record<string, unknown> = {}) =>
    Object.assign(new Error('AI-seat cap reached: 5 of 5 seats are in use.'), {
      statusCode: 402, code: 'ai_seat_limit_reached', ...extra,
    });
  const refuseUserInsert = (error: () => unknown) =>
    engine.registerHook('beforeInsert', async (ctx: any) => {
      if (ctx.input?.data?.principal_kind === 'agent') throw error();
    }, { object: 'sys_user', packageId: PACKAGE });
  const refuseMemberInsert = (error: () => unknown) =>
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.operation === 'insert') throw error();
      await next();
    }, { object: 'sys_member' });

  const agents = () => rows('sys_user', { principal_kind: 'agent' });
  const register = () => runRegisterServiceAccount(deps(), caller('usr_admin'), post({ name: 'Bot', ownerId: 'usr_owner' }));

  it('a 402 thrown by a hook on the user row: 402, the closed code beside ai_seat_limit_reached, its message, and nothing written', async () => {
    refuseUserInsert(() => seatCap());
    const members = (await rows('sys_member')).length;
    const r = await register();
    expect(r).toEqual({
      status: 402,
      body: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          declaredCode: 'ai_seat_limit_reached',
          message: 'AI-seat cap reached: 5 of 5 seats are in use.',
        },
      },
    });
    expect(await agents()).toEqual([]);
    expect((await rows('sys_member')).length).toBe(members);
  });

  it('a 402 thrown by middleware on the membership insert: 402 with ai_seat_limit_reached, and the user row is rolled back', async () => {
    refuseMemberInsert(() => seatCap());
    const users = (await rows('sys_user')).length;
    const members = (await rows('sys_member')).length;
    const r = await register();
    expect(r).toMatchObject({
      status: 402,
      body: { success: false, error: { code: 'VALIDATION_ERROR', declaredCode: 'ai_seat_limit_reached' } },
    });
    expect(String(r.body.error!.message)).toMatch(/could not be added to the organization.*AI-seat cap reached/);
    expect(await agents()).toEqual([]);
    expect((await rows('sys_user')).length).toBe(users);
    expect((await rows('sys_member')).length).toBe(members);
  });

  it('a registered code travels in code itself, with no declaredCode beside it', async () => {
    refuseUserInsert(() => Object.assign(new Error('Licence refuses this kind.'), { statusCode: 403, code: 'PERMISSION_DENIED' }));
    const r = await register();
    expect(r).toEqual({
      status: 403,
      body: { success: false, error: { code: 'PERMISSION_DENIED', message: 'Licence refuses this kind.' } },
    });
    expect(await agents()).toEqual([]);
  });

  it('a declared 503 keeps its status and code; its message is withheld unless the producer declared it a refusal', async () => {
    const unknown = (extra: Record<string, unknown> = {}) =>
      Object.assign(new Error('seat ledger at db-7.internal timed out'), { statusCode: 503, code: 'ai_seat_cap_unknown', ...extra });
    refuseUserInsert(() => unknown());
    const withheld = await register();
    expect(withheld).toEqual({
      status: 503,
      body: {
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', declaredCode: 'ai_seat_cap_unknown', message: 'The request could not be completed.' },
      },
    });

    engine.unregisterHooksByPackage(PACKAGE);
    refuseUserInsert(() => Object.assign(new Error('The AI-seat count cannot be read right now. Try again shortly.'), {
      statusCode: 503, code: 'ai_seat_cap_unknown', refusal: true,
    }));
    const addressed = await register();
    expect(addressed).toMatchObject({
      status: 503,
      body: { error: { code: 'SERVICE_UNAVAILABLE', declaredCode: 'ai_seat_cap_unknown', message: 'The AI-seat count cannot be read right now. Try again shortly.' } },
    });
    expect(await agents()).toEqual([]);
  });

  it('a throw that declares only one half, or a status outside 400-599, is not a refusal: it still fails as before', async () => {
    const undeclared: Array<[string, () => unknown]> = [
      ['no code', () => Object.assign(new Error('seat check failed'), { statusCode: 402 })],
      ['no status', () => Object.assign(new Error('seat check failed'), { code: 'ai_seat_limit_reached' })],
      ['a status outside 400-599', () => Object.assign(new Error('seat check failed'), { statusCode: 700, code: 'ai_seat_limit_reached' })],
      ['an empty code', () => Object.assign(new Error('seat check failed'), { statusCode: 402, code: '' })],
      ['a plain error', () => new Error('seat check failed')],
    ];
    for (const [label, error] of undeclared) {
      engine.unregisterHooksByPackage(PACKAGE);
      refuseUserInsert(error);
      await expect(register(), label).rejects.toThrow('seat check failed');
    }
    expect(await agents()).toEqual([]);
  });

  it('an unreadable authorization store inside the write is still the route\'s outage, not a declared refusal', async () => {
    refuseUserInsert(() => new AuthzStoreUnavailableError('sys_member', new Error('down')));
    await expect(register()).rejects.toSatisfy(isAuthzStoreUnavailableError);
  });
});
