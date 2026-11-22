// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Leaving development mode retires what the development seed issued — pinned
 * across two real boots over one database.
 *
 * ## The composition
 *
 * A real `ObjectKernel`, a real ObjectQL engine on a SQLite FILE, the real
 * `AuthPlugin` (the development admin seed, one `demoStaff` account and the
 * admin plugin) and the real `SecurityPlugin`. The first boot runs with
 * `NODE_ENV=development`, as `os dev` boots: it seeds, and the seed's admin, a
 * demo account and an account an administrator creates (no seed stamp) are
 * each issued a session, an API key and a password-reset link. The server
 * stops, and boots again over the same file, as `os start` serves the database
 * `os dev` wrote.
 *
 * ## What each case reads
 *
 * What each credential answers on the second boot: the session through
 * `/get-session` (a retired one resolves no user, as a revoked one does), the
 * key through the key-admission seam (`API_KEY_REVOKED`, as a revoked one
 * does), and the reset links left in `sys_verification`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, hashApiKey, resolveApiKeyAdmission, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';
import { DEV_SEED_CREDENTIAL_FIELD } from './dev-seed-credential.js';
import { retireDevSeedCredentials } from './dev-seed-credential-retirement.js';
import { setOperatorPassword } from './operator-password-reset.js';
// Vendor modules paid at module load, never inside a clocked case.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/crypto';
import 'better-auth/plugins';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/custom-session';
import 'better-auth/plugins/organization';
import 'better-auth/plugins/admin';
import '@better-auth/core/context';
import '@better-auth/core/error';

const SYS = { isSystem: true } as const;
const ORIGIN = 'http://localhost:3000';
const AUTH = `${ORIGIN}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-devseed';
const SEED_EMAIL = 'admin@objectos.ai';
const SEED_PASSWORD = 'admin123';
const STAFF_EMAIL = 'staff1@demo.example';
const CONTROL_EMAIL = 'colleague@company.example';
const CONTROL_PASSWORD = 'Admin-Chosen-Pass-29';
const OPERATOR_PASSWORD = 'Operator!Chosen-Passw0rd-7';
const PRODUCTION = 'production';

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

type Who = 'admin' | 'staff' | 'control';
type SecondaryStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
};

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let kernel: ObjectKernel | undefined;
let dir: string | undefined;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'os-dev-seed-retire-'));
});

afterEach(async () => {
  try {
    await kernel?.shutdown();
  } catch {
    /* already down */
  }
  kernel = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** A store shared by both boots, as a host's Redis outlives a restart. */
function sharedSecondaryStorage(): SecondaryStorage & { keys(): string[] } {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

function sqliteFilePlugin(filename: string): Plugin {
  return {
    name: 'test.driver.sqlite-file',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true }),
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

/** One boot of the real composition over the test's database file, in `nodeEnv`. */
async function boot(nodeEnv: string, options: { secondaryStorage?: SecondaryStorage } = {}) {
  process.env.NODE_ENV = nodeEnv;
  kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(sqliteFilePlugin(join(dir!, 'app.sqlite')));
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(
    new AuthPlugin({
      secret: SECRET,
      baseUrl: ORIGIN,
      demoStaff: [{ name: 'Demo Staff 1', email: STAFF_EMAIL }] as never,
      // The OIDC provider refuses a `secondaryStorage` that holds the sessions
      // (`session-of-record.test.ts`), so a host that supplies one turns it off.
      plugins: { admin: true, ...(options.secondaryStorage ? { oidcProvider: false } : {}) },
      ...(options.secondaryStorage ? { secondaryStorage: options.secondaryStorage } : {}),
    } as never),
  );
  await kernel.use(new SecurityPlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  const manager = kernel.getService<AuthManager>('auth');
  const rows = async (object: string, where: Record<string, unknown> = {}) =>
    (await ql.find(object, { where, limit: 200, context: SYS })) as Array<Record<string, any>>;
  const post = (path: string, body: unknown) =>
    manager.handleRequest(
      new Request(`${AUTH}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify(body ?? {}),
      }),
    );
  /** The user a session cookie resolves to, or `null`. */
  const sessionUser = async (cookie: string): Promise<string | null> => {
    const res = await manager.handleRequest(new Request(`${AUTH}/get-session`, { method: 'GET', headers: { origin: ORIGIN, cookie } }));
    const body = (await res.json().catch(() => null)) as { user?: { id?: string } } | null;
    return body?.user?.id ?? null;
  };
  /** The key-admission seam's verdict for a raw key: `admitted`, or the refusal's code. */
  const keyAnswer = async (raw: string): Promise<string> => {
    const admission = await resolveApiKeyAdmission(ql, { 'x-api-key': raw }, Date.now(), undefined, undefined, undefined);
    return admission.outcome === 'lifecycle' ? admission.refusal.code : admission.outcome;
  };
  /** Mint a key the way `POST /api/v1/keys` writes the row (system context, hash only); answers the raw key. */
  const mintKey = async (userId: string, name: string): Promise<string> => {
    const raw = `osk_${name}_${'x'.repeat(24)}`;
    await ql.insert(
      'sys_api_key',
      { id: `key_${name}`, name, key: hashApiKey(raw), prefix: raw.slice(0, 12), user_id: userId, revoked: false },
      { context: SYS } as never,
    );
    return raw;
  };
  const idOf = async (email: string) => (await rows('sys_user', { email }))[0]?.id as string;
  const signIn = async (email: string, password: string): Promise<string> => {
    const res = await post('/sign-in/email', { email, password });
    expect(res.status, `${email}: ${await res.clone().text()}`).toBe(200);
    return cookieHeader(res);
  };
  return { ql, manager, rows, post, sessionUser, keyAnswer, mintKey, idOf, signIn };
}

type Server = Awaited<ReturnType<typeof boot>>;

async function stop(): Promise<void> {
  await kernel?.shutdown();
  kernel = undefined;
}

/** Whether `userId` carries the seed stamp, matched by the server, as the column is never served. */
async function isStamped(server: Server, userId: string): Promise<boolean> {
  const found = await server.ql.find(
    'sys_user',
    { where: { id: userId, [DEV_SEED_CREDENTIAL_FIELD]: { $null: false } }, fields: ['id'], limit: 1, context: SYS } as never,
  );
  return Array.isArray(found) && found.length === 1;
}

/**
 * The development boot: the seed, an administrator-created control account,
 * and a session, an API key and a reset link issued to each of the three.
 * `beforeStop` runs on the development database before the server stops.
 */
async function seedInDevelopment(options: { secondaryStorage?: SecondaryStorage; beforeStop?: (dev: Server, ids: Record<Who, string>) => Promise<void> } = {}) {
  const dev = await boot('development', options);
  const api: any = await dev.manager.getApi();
  // The administrator's create-user, as the `/admin/create-user` route drives it.
  await api.createUser({ body: { email: CONTROL_EMAIL, name: 'Admin Created', password: CONTROL_PASSWORD } });
  const ids: Record<Who, string> = { admin: await dev.idOf(SEED_EMAIL), staff: await dev.idOf(STAFF_EMAIL), control: await dev.idOf(CONTROL_EMAIL) };
  expect({ admin: await isStamped(dev, ids.admin), staff: await isStamped(dev, ids.staff), control: await isStamped(dev, ids.control) })
    .toEqual({ admin: true, staff: true, control: false });

  const cookies: Record<Who, string> = {
    admin: await dev.signIn(SEED_EMAIL, SEED_PASSWORD),
    staff: await dev.signIn(STAFF_EMAIL, SEED_PASSWORD),
    control: await dev.signIn(CONTROL_EMAIL, CONTROL_PASSWORD),
  };
  const keys: Record<Who, string> = {
    admin: await dev.mintKey(ids.admin, 'admin'),
    staff: await dev.mintKey(ids.staff, 'staff'),
    control: await dev.mintKey(ids.control, 'control'),
  };
  const expiresAt = new Date(Date.now() + 3_600_000);
  for (const who of ['admin', 'staff', 'control'] as const) {
    await dev.ql.insert('sys_verification', { identifier: `reset-password:tok_${who}`, value: ids[who], expires_at: expiresAt }, { context: SYS } as never);
  }
  await options.beforeStop?.(dev, ids);
  await stop();
  return { ids, cookies, keys };
}

type Issued = Awaited<ReturnType<typeof seedInDevelopment>>;

/** What `who`'s development credentials answer on `server`. */
async function answers(server: Server, issued: Issued, who: Who) {
  return {
    session: await server.sessionUser(issued.cookies[who]),
    key: await server.keyAnswer(issued.keys[who]),
    resetLinks: (await server.rows('sys_verification', { value: issued.ids[who] })).length,
  };
}

const RETIRED = { session: null, key: 'API_KEY_REVOKED', resetLinks: 0 };

describe('leaving development mode retires what the development seed issued', () => {
  it('a boot outside development mode retires the seed accounts\' sessions, API keys and reset links, each answering as revoked; an administrator-created account is untouched', async () => {
    const issued = await seedInDevelopment();
    const server = await boot(PRODUCTION);
    for (const who of ['admin', 'staff'] as const) {
      expect({ who, ...(await answers(server, issued, who)) }).toEqual({ who, ...RETIRED });
      const sessions = await server.rows('sys_session', { user_id: issued.ids[who] });
      expect(sessions.length, `${who} had a session row`).toBeGreaterThan(0);
      for (const session of sessions) {
        expect({ who, reason: session.revoke_reason, revoked: Boolean(session.revoked_at) }).toEqual({ who, reason: 'admin_password_reset', revoked: true });
      }
    }
    expect(await answers(server, issued, 'control')).toEqual({ session: issued.ids.control, key: 'admitted', resetLinks: 1 });
    // The stamp stays: the account opens no session until an operator sets a password.
    expect(await isStamped(server, issued.ids.admin)).toBe(true);
  });

  it('a boot in development mode retires nothing', async () => {
    const issued = await seedInDevelopment();
    const server = await boot('development');
    for (const who of ['admin', 'staff', 'control'] as const) {
      expect({ who, ...(await answers(server, issued, who)) }).toEqual({ who, session: issued.ids[who], key: 'admitted', resetLinks: 1 });
    }
  });

  it('an account whose password was set since the seed is untouched: by the operator\'s reset, or by an administrator', async () => {
    let afterOperatorReset = '';
    const issued = await seedInDevelopment({
      async beforeStop(dev, ids) {
        // The operator's reset clears the stamp and ends what the account held; a key minted after it is the operator era's.
        expect(await setOperatorPassword(dev.ql as never, { email: SEED_EMAIL, password: OPERATOR_PASSWORD })).toMatchObject({ outcome: 'set' });
        afterOperatorReset = await dev.mintKey(ids.admin, 'after_operator_reset');
        // The write `/admin/set-user-password` makes, with its revocation switch off: the stamp stays and stops
        // matching. The write itself ends the account's reset links, as every password write does.
        const context: any = await dev.manager.getAuthContext();
        await context.internalAdapter.updatePassword(ids.staff, await context.password.hash(CONTROL_PASSWORD));
      },
    });
    const server = await boot(PRODUCTION);
    expect(await server.keyAnswer(afterOperatorReset)).toBe('admitted');
    expect(await server.sessionUser(await server.signIn(SEED_EMAIL, OPERATOR_PASSWORD))).toBe(issued.ids.admin);
    expect(await isStamped(server, issued.ids.staff)).toBe(true);
    expect(await answers(server, issued, 'staff')).toEqual({ session: issued.ids.staff, key: 'admitted', resetLinks: 0 });
  });

  it('a second boot outside development mode is a no-op', async () => {
    const issued = await seedInDevelopment();
    const first = await boot(PRODUCTION);
    const tombstones = async (server: Server) =>
      (await server.rows('sys_session', { user_id: issued.ids.admin })).map((row) => [row.id, String(row.revoked_at)]);
    const afterFirst = await tombstones(first);
    await stop();
    const second = await boot(PRODUCTION);
    expect(await tombstones(second)).toEqual(afterFirst);
    // The same retirement, run once more, finds the two seed accounts and ends nothing.
    const outcome = await retireDevSeedCredentials({ engine: second.ql as never, authContext: () => second.manager.getAuthContext() });
    expect(outcome).toMatchObject({ mode: 'production', stampedAccounts: 2 });
    const retired = outcome.mode === 'production' ? outcome.retired : [];
    expect(retired.map((r) => r.userId).sort()).toEqual([issued.ids.admin, issued.ids.staff].sort());
    for (const account of retired) {
      expect(account).toMatchObject({ sessions: 0, cachedSessions: 0, apiKeys: 0, signInAccounts: 0, authorizedApps: 0, ownedApps: 0, scimCredentials: 0 });
    }
    expect(await answers(second, issued, 'control')).toEqual({ session: issued.ids.control, key: 'admitted', resetLinks: 1 });
  });

  it('with a host secondaryStorage holding the sessions, the boot ends them there', async () => {
    const storage = sharedSecondaryStorage();
    const issued = await seedInDevelopment({ secondaryStorage: storage });
    // No `sys_session` row is written: the store is the session of record.
    expect(storage.keys().filter((k) => k === `active-sessions-${issued.ids.admin}`)).toHaveLength(1);
    const server = await boot(PRODUCTION, { secondaryStorage: storage });
    expect(await server.sessionUser(issued.cookies.admin)).toBeNull();
    expect(await server.sessionUser(issued.cookies.staff)).toBeNull();
    expect(await server.sessionUser(issued.cookies.control)).toBe(issued.ids.control);
  });
});
