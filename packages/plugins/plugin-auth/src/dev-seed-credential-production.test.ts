// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A server that is not in development mode never accepts a development seed
 * credential — pinned at the doors, over a database the development boot
 * seeded.
 *
 * ## The composition
 *
 * The development boot `demo-staff-provisioning.test.ts` pins: a real
 * `ObjectKernel`, a real ObjectQL engine on in-memory SQLite, the real
 * `AuthPlugin` (the development admin seed and one `demoStaff` account) and
 * the real `SecurityPlugin`, booted with `NODE_ENV=development` as `os dev`
 * boots. `NODE_ENV` then leaves development and a second `AuthManager` is
 * built over the same engine: the database a production server serves, as
 * `os start` would serve the file `os dev` wrote.
 *
 * ## What each case reads
 *
 * The answer the door gives (status, code, sentence) and the `sys_session`
 * rows it left. A refusal is asserted by its ADR-0112 `code` and `status`, by
 * the operator reset command its sentence names (the one sentence a client
 * reads to act), and by the session it did not create.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AuthPlugin } from './auth-plugin.js';
import { AuthManager } from './auth-manager.js';
import { recoverInternalFieldsForSystemRead } from './internal-field-readback.js';
import { DEV_SEED_CREDENTIAL_FIELD, devSeedCredentialDigest } from './dev-seed-credential.js';
import { setOperatorPassword } from './operator-password-reset.js';
// Vendor modules paid at module load, never inside a clocked case.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/crypto';
import 'better-auth/plugins';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/custom-session';
import 'better-auth/plugins/organization';
import 'better-auth/plugins/magic-link';
import 'better-auth/plugins/admin';
import 'better-auth/plugins/phone-number';
import '@better-auth/core/context';
import '@better-auth/core/error';

const SYS = { isSystem: true } as const;
const ORIGIN = 'http://localhost:3000';
const AUTH = `${ORIGIN}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-devseed';
const SEED_EMAIL = 'admin@objectos.ai';
const SEED_PASSWORD = 'admin123';
const CUSTOM_SEED_PASSWORD = 'Custom!Seed-Passw0rd-42';
const NEW_PASSWORD = 'Operator!Chosen-Passw0rd-7';
const STAFF_EMAIL = 'staff1@demo.example';
const ADMIN_CREATED_EMAIL = 'colleague@company.example';
const ADMIN_CHOSEN_PASSWORD = 'Admin-Chosen-Pass-29';
const RESET_COMMAND = 'os user set-password';

const ENV_KEYS = [
  'NODE_ENV',
  'OS_SEED_ADMIN',
  'OS_SEED_ADMIN_EMAIL',
  'OS_SEED_ADMIN_PASSWORD',
  'OS_SEED_ADMIN_NAME',
  'OS_MIGRATE_AND_EXIT',
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
  'OS_PLATFORM_OWNER_EMAIL',
] as const;

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

/** A response's Set-Cookie values as one request Cookie header (expired ones dropped). */
const cookieHeader = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? [])
    .filter((c) => !/max-age=0/i.test(c))
    .map((c) => c.split(';')[0])
    .join('; ');

/** The refusal's envelope: status, machine code and sentence. */
const answerOf = async (res: Response) => {
  const text = await res.clone().text();
  let body: { code?: unknown; message?: unknown } = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, code: body.code, message: typeof body.message === 'string' ? body.message : undefined };
};

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let kernel: ObjectKernel | undefined;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(async () => {
  try {
    await kernel?.shutdown();
  } catch {
    /* already down */
  }
  kernel = undefined;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** A manager's doors, driven as `Request`s through `handleRequest`. */
function doorsOf(manager: AuthManager) {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    manager.handleRequest(
      new Request(`${AUTH}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
        body: JSON.stringify(body ?? {}),
      }),
    );
  const get = (url: string, headers: Record<string, string> = {}) =>
    manager.handleRequest(new Request(url.startsWith('http') ? url : `${AUTH}${url}`, { method: 'GET', headers: { origin: ORIGIN, ...headers } }));
  const signIn = (email: string, password: string) => post('/sign-in/email', { email, password });
  /** The session a cookie resolves to: its user id, or `null`. */
  const sessionUser = async (cookie: string): Promise<string | null> => {
    const res = await get('/get-session', { cookie });
    const body = (await res.json().catch(() => null)) as { user?: { id?: string } } | null;
    return body?.user?.id ?? null;
  };
  return { post, get, signIn, sessionUser };
}

/**
 * The development boot: `os dev` seeding the admin and one demo account into a
 * fresh database. `adminPassword` is `os dev --admin-password`.
 */
async function bootDevelopment(options: { adminPassword?: string; adminPlugin?: boolean } = {}) {
  process.env.NODE_ENV = 'development';
  if (options.adminPassword) process.env.OS_SEED_ADMIN_PASSWORD = options.adminPassword;
  kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(sqliteDriverPlugin());
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(
    new AuthPlugin({
      secret: SECRET,
      baseUrl: ORIGIN,
      demoStaff: [{ name: 'Demo Staff 1', email: STAFF_EMAIL }] as never,
      ...(options.adminPlugin ? { plugins: { admin: true } } : {}),
    } as never),
  );
  await kernel.use(new SecurityPlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  const manager = kernel.getService<AuthManager>('auth');
  const rows = async (object: string, where: Record<string, unknown> = {}) =>
    (await ql.find(object, { where, limit: 200, context: SYS })) as Array<Record<string, any>>;
  const userId = async (email: string) => (await rows('sys_user', { email }))[0]?.id as string;
  return { ql, manager, rows, userId, doors: doorsOf(manager) };
}

type Seeded = Awaited<ReturnType<typeof bootDevelopment>>;

/**
 * Leave development: the server that serves the database next. The seed's env
 * is not passed on, as `os start` does not pass it.
 */
function productionServer(seeded: Seeded, options: { mails?: any[]; phoneNumber?: boolean } = {}) {
  process.env.NODE_ENV = 'production';
  delete process.env.OS_SEED_ADMIN_PASSWORD;
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: seeded.ql as never,
    ...(options.phoneNumber ? { plugins: { phoneNumber: true } } : {}),
    ...(options.mails
      ? {
          plugins: { magicLink: true },
          emailService: {
            async sendTemplate(input: any) {
              options.mails!.push(input);
              return { id: 'mail_test', status: 'sent' };
            },
            async send(input: any) {
              options.mails!.push(input);
              return { id: 'mail_test', status: 'sent' };
            },
            isConfigured: () => true,
          },
        }
      : {}),
  } as never);
  return { manager, doors: doorsOf(manager) };
}

/** Whether `userId` carries the seed stamp: matched by the server, as the column is never served. */
async function isStamped(seeded: Seeded, userId: string): Promise<boolean> {
  const found = await seeded.ql.find(
    'sys_user',
    { where: { id: userId, [DEV_SEED_CREDENTIAL_FIELD]: { $null: false } }, fields: ['id'], limit: 1, context: SYS } as never,
  );
  return Array.isArray(found) && found.length === 1;
}

/** The stored password hash of `userId`'s password credential. */
async function storedHash(seeded: Seeded, userId: string): Promise<string> {
  const accounts = await seeded.rows('sys_account', { user_id: userId, provider_id: 'credential' });
  await recoverInternalFieldsForSystemRead(seeded.ql as never, 'sys_account', accounts, ['password']);
  return String(accounts[0]?.password);
}

async function sessionCount(seeded: Seeded, userId: string): Promise<number> {
  return (await seeded.rows('sys_session', { user_id: userId })).length;
}

const expectSeedPasswordRefusal = (answer: { status: number; code: unknown; message?: string }) => {
  expect({ status: answer.status, code: answer.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
  expect(answer.message).toContain(RESET_COMMAND);
};

describe('a server outside development mode refuses a development seed credential', () => {
  it('development mode is unchanged: the seed admin and a demo account sign in with the seed password, and each carries the seed stamp', async () => {
    const seeded = await bootDevelopment();
    const adminId = await seeded.userId(SEED_EMAIL);
    const staffId = await seeded.userId(STAFF_EMAIL);
    expect(await isStamped(seeded, adminId)).toBe(true);
    expect(await isStamped(seeded, staffId)).toBe(true);
    for (const email of [SEED_EMAIL, STAFF_EMAIL]) {
      const res = await seeded.doors.signIn(email, SEED_PASSWORD);
      expect(res.status, `${email}: ${await res.clone().text()}`).toBe(200);
    }
  });

  it('the seed stamp is a digest of the stored password hash, never the password', async () => {
    const seeded = await bootDevelopment();
    const adminId = await seeded.userId(SEED_EMAIL);
    const byDigest = await seeded.ql.find(
      'sys_user',
      { where: { [DEV_SEED_CREDENTIAL_FIELD]: await devSeedCredentialDigest(await storedHash(seeded, adminId)) }, fields: ['id'], context: SYS } as never,
    );
    expect((byDigest as any[]).map((r) => r.id)).toEqual([adminId]);
    const byPassword = await seeded.ql.find(
      'sys_user',
      { where: { [DEV_SEED_CREDENTIAL_FIELD]: SEED_PASSWORD }, fields: ['id'], context: SYS } as never,
    );
    expect(byPassword).toEqual([]);
    // Never served on a read.
    const [row] = await seeded.rows('sys_user', { id: adminId });
    expect(DEV_SEED_CREDENTIAL_FIELD in row).toBe(false);
  });

  it('an account an administrator creates in development carries no seed stamp, and signs in outside development mode', async () => {
    const seeded = await bootDevelopment({ adminPlugin: true });
    const api: any = await seeded.manager.getApi();
    expect(typeof api.createUser, 'the admin plugin serves create-user on this boot').toBe('function');
    // The administrator's create-user, as the `/admin/create-user` route drives it.
    await api.createUser({ body: { email: ADMIN_CREATED_EMAIL, name: 'Admin Created', password: ADMIN_CHOSEN_PASSWORD } });
    const createdId = await seeded.userId(ADMIN_CREATED_EMAIL);
    expect(createdId, 'the administrator-created account exists').toBeTypeOf('string');
    expect(await isStamped(seeded, createdId)).toBe(false);
    // The seed's own accounts on the same boot stay marked.
    expect(await isStamped(seeded, await seeded.userId(SEED_EMAIL))).toBe(true);
    expect(await isStamped(seeded, await seeded.userId(STAFF_EMAIL))).toBe(true);

    const server = productionServer(seeded);
    const res = await server.doors.signIn(ADMIN_CREATED_EMAIL, ADMIN_CHOSEN_PASSWORD);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await server.doors.sessionUser(cookieHeader(res))).toBe(createdId);
  });

  it('refuses a sign-in that submits the seed password to the seed admin, naming the operator reset command, and opens no session', async () => {
    const seeded = await bootDevelopment();
    const adminId = await seeded.userId(SEED_EMAIL);
    const before = await sessionCount(seeded, adminId);
    const server = productionServer(seeded);
    expectSeedPasswordRefusal(await answerOf(await server.doors.signIn(SEED_EMAIL, SEED_PASSWORD)));
    expect(await sessionCount(seeded, adminId)).toBe(before);
  });

  it('refuses a sign-in that submits the seed password to a demo account', async () => {
    const seeded = await bootDevelopment();
    const staffId = await seeded.userId(STAFF_EMAIL);
    const before = await sessionCount(seeded, staffId);
    const server = productionServer(seeded);
    expectSeedPasswordRefusal(await answerOf(await server.doors.signIn(STAFF_EMAIL, SEED_PASSWORD)));
    expect(await sessionCount(seeded, staffId)).toBe(before);
  });

  it('answers the seed password the same for an address no account holds: it is decided on the password alone', async () => {
    const seeded = await bootDevelopment();
    const server = productionServer(seeded);
    const known = await answerOf(await server.doors.signIn(SEED_EMAIL, SEED_PASSWORD));
    const unknown = await answerOf(await server.doors.signIn('nobody@nowhere.example', SEED_PASSWORD));
    expect(unknown).toEqual(known);
  });

  it('refuses the seed password on the phone-number password sign-in, naming the operator reset command', async () => {
    const seeded = await bootDevelopment();
    const server = productionServer(seeded, { phoneNumber: true });
    const answer = await answerOf(await server.doors.post('/sign-in/phone-number', { phoneNumber: '+15555550123', password: SEED_PASSWORD }));
    expectSeedPasswordRefusal(answer);
  });

  it('refuses the seed password on an account that carries no seed stamp, as a database seeded before the stamp does', async () => {
    const seeded = await bootDevelopment();
    const adminId = await seeded.userId(SEED_EMAIL);
    await seeded.ql.update('sys_user', { id: adminId, [DEV_SEED_CREDENTIAL_FIELD]: null }, { context: SYS } as never);
    expect(await isStamped(seeded, adminId)).toBe(false);
    const server = productionServer(seeded);
    expectSeedPasswordRefusal(await answerOf(await server.doors.signIn(SEED_EMAIL, SEED_PASSWORD)));
  });

  it('refuses a stamped account on a custom seed password exactly as a wrong password, and opens no session', async () => {
    const seeded = await bootDevelopment({ adminPassword: CUSTOM_SEED_PASSWORD });
    const adminId = await seeded.userId(SEED_EMAIL);
    // Development: the custom seed password signs in.
    expect((await seeded.doors.signIn(SEED_EMAIL, CUSTOM_SEED_PASSWORD)).status).toBe(200);
    const before = await sessionCount(seeded, adminId);
    const server = productionServer(seeded);
    const refused = await answerOf(await server.doors.signIn(SEED_EMAIL, CUSTOM_SEED_PASSWORD));
    const wrong = await answerOf(await server.doors.signIn(SEED_EMAIL, 'Wr0ng!Guess-Zebra-7731'));
    expect(refused).toEqual(wrong);
    expect(refused.status).toBe(401);
    expect(await sessionCount(seeded, adminId)).toBe(before);
  });

  it('opens no session for a stamped account still on its seed password on a door that takes no password (the emailed sign-in link)', async () => {
    const seeded = await bootDevelopment({ adminPassword: CUSTOM_SEED_PASSWORD });
    const adminId = await seeded.userId(SEED_EMAIL);
    const before = await sessionCount(seeded, adminId);
    const mails: any[] = [];
    const server = productionServer(seeded, { mails });
    const sent = await server.doors.post('/sign-in/magic-link', { email: SEED_EMAIL });
    expect(sent.status, `sign-in/magic-link: ${await sent.clone().text()}`).toBe(200);
    const mail = mails.find((m) => m?.data?.magicLinkUrl);
    expect(mail, 'the sign-in link was mailed').toBeDefined();
    const url = new URL(String(mail.data.magicLinkUrl));
    url.searchParams.delete('callbackURL');
    const answer = await answerOf(await server.doors.get(url.toString()));
    expectSeedPasswordRefusalOnSession(answer);
    expect(await sessionCount(seeded, adminId)).toBe(before);
  });

  it('after `os user set-password`, the new password signs in, the seed stamp is gone, and the development session is ended', async () => {
    const seeded = await bootDevelopment({ adminPassword: CUSTOM_SEED_PASSWORD });
    const adminId = await seeded.userId(SEED_EMAIL);
    const devSignIn = await seeded.doors.signIn(SEED_EMAIL, CUSTOM_SEED_PASSWORD);
    expect(devSignIn.status).toBe(200);
    const devCookie = cookieHeader(devSignIn);
    const server = productionServer(seeded);

    const outcome = await setOperatorPassword(seeded.ql as never, { email: SEED_EMAIL, password: NEW_PASSWORD });
    expect(outcome).toMatchObject({ outcome: 'set', userId: adminId, revocationComplete: true });
    expect(await isStamped(seeded, adminId)).toBe(false);

    const res = await server.doors.signIn(SEED_EMAIL, NEW_PASSWORD);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await server.doors.sessionUser(cookieHeader(res))).toBe(adminId);
    expect(await server.doors.sessionUser(devCookie)).toBeNull();
    // The old seed password stays refused.
    expect((await server.doors.signIn(SEED_EMAIL, CUSTOM_SEED_PASSWORD)).status).toBe(401);
  });

  it('`os user set-password` ends the account\'s outstanding password-reset links before the password lands, and no other account\'s', async () => {
    const seeded = await bootDevelopment();
    const adminId = await seeded.userId(SEED_EMAIL);
    const staffId = await seeded.userId(STAFF_EMAIL);
    const expiresAt = new Date(Date.now() + 3_600_000);
    for (const [identifier, value] of [
      ['reset-password:tok_admin_1', adminId],
      ['reset-password:tok_admin_2', adminId],
      ['reset-password:tok_staff', staffId],
    ] as const) {
      await seeded.ql.insert('sys_verification', { identifier, value, expires_at: expiresAt }, { context: SYS } as never);
    }
    process.env.NODE_ENV = 'production';
    const links = async (userId: string) => (await seeded.rows('sys_verification', { value: userId })).length;
    expect({ admin: await links(adminId), staff: await links(staffId) }).toEqual({ admin: 2, staff: 1 });

    const outcome = await setOperatorPassword(seeded.ql as never, { email: SEED_EMAIL, password: NEW_PASSWORD });
    expect(outcome).toMatchObject({ outcome: 'set', userId: adminId });
    expect({ admin: await links(adminId), staff: await links(staffId) }).toEqual({ admin: 0, staff: 1 });
  });

  it('the operator reset refuses a password a server would refuse, and an address no account holds, and writes nothing', async () => {
    const seeded = await bootDevelopment();
    const adminId = await seeded.userId(SEED_EMAIL);
    process.env.NODE_ENV = 'production';
    const hash = await storedHash(seeded, adminId);
    const refusals = await Promise.all([
      setOperatorPassword(seeded.ql as never, { email: SEED_EMAIL, password: SEED_PASSWORD }),
      setOperatorPassword(seeded.ql as never, { email: SEED_EMAIL, password: 'short1!' }),
      setOperatorPassword(seeded.ql as never, { email: SEED_EMAIL, password: 'x'.repeat(129) }),
      setOperatorPassword(seeded.ql as never, { email: 'nobody@nowhere.example', password: NEW_PASSWORD }),
    ]);
    expect(refusals.map((r) => (r.outcome === 'refused' ? r.reason : r.outcome))).toEqual([
      'dev_seed_password',
      'password_too_short',
      'password_too_long',
      'no_user',
    ]);
    expect(await storedHash(seeded, adminId)).toBe(hash);
    expect(await isStamped(seeded, adminId)).toBe(true);
  });
});

function expectSeedPasswordRefusalOnSession(answer: { status: number; code: unknown; message?: string }) {
  expect({ status: answer.status, code: answer.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
  expect(answer.message).toContain(RESET_COMMAND);
}
