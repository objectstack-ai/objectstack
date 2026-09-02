// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14157] The dev-admin seed fires on a database that has PEOPLE but no
 * LOGIN — pinned end to end over a REAL `ObjectQL` engine.
 *
 * ## What shipped, and why every existing suite stayed green
 *
 * `objectstack dev` declares a known, loginable dev admin. The gate that
 * implemented it asked "does any human `sys_user` row exist?", which is the
 * same question only while every user row carries a credential. An app that
 * declares people in `defineStack({ data })` breaks that equivalence: the
 * declarative seed is awaited inside `AppPlugin.start()`, so it always lands
 * before the seed's own `kernel:ready` hook, the database is non-zero-user
 * before the check, and the admin is never minted — on that boot or any later
 * one. Measured on a real app: 13 `sys_user` rows, **zero** `sys_account`
 * rows, sign-in 401. Every unit suite stayed green because every fixture
 * started from an empty table, which is the one population where the two
 * predicates agree.
 *
 * ## Why the gate is only HALF the fix, and why case ⓪ is here
 *
 * The seed provisions through better-auth's real `signUpEmail`, and that call
 * has to be ADMITTED. Its admission rode on the audience gate's bootstrap
 * bypass — "zero HUMAN users" — which the same 13 rows also answer
 * "populated". Case ⓪ measures that directly: with the seeded people in
 * place and no operator ticket staged, the seed's own lane comes back
 * `SELF_REGISTRATION_CLOSED` under the default `invite_only` posture. So a fix
 * that moved only the gate would have produced a seed that decides to run and
 * a gate that then refuses it. ⓪ is what keeps every case below non-vacuous:
 * it proves the refusal is real, so ① is not passing for some unrelated reason.
 *
 * The second half is a DECLARED ticket (`stageOperatorProvisioning`), not a
 * wider bootstrap probe — case ④ is that decision's pin: the public
 * self-registration door must be exactly where it was, on exactly the
 * population that made this card, before and after the seed runs.
 *
 * ## `bootstrap-status` (cases ⑦–⑧)
 *
 * The card flagged `hasOwner` as a look-alike. Measured, it is a real
 * disagreement of its own: the handler counted `sys_user` rows with NO filter,
 * so it was the one call site out of step with the three `isHumanUserRow`
 * consumers — on a database carrying the legacy `usr_system` service row it
 * answered "an owner exists" while the admission gate and plugin-security's
 * first-user detection both stood ready to admit and promote the first human.
 * It now reads the same bootstrap-window question the admission gate answers,
 * so the console can never offer a first-run creation the platform refuses,
 * nor withhold one it would allow. Driven through the REAL route, because the
 * console reads the route and not the predicate.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { SELF_REGISTRATION_CLOSED } from './audience-posture.js';
import { decideDevAdminSeedGate } from './dev-admin-seed-gate.js';
import { recoverInternalFieldsForSystemRead } from './internal-field-readback.js';
import {
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
} from '@objectstack/platform-objects';

const BASE = 'http://localhost:3000';
const AUTH_BASE = '/api/v1/auth';
const SECRET = 'test-secret-at-least-32-chars-long-14157';
const SEED_EMAIL = 'admin@objectos.ai';
const SEED_PASSWORD = 'admin123';
const SYSTEM = { context: { isSystem: true } } as never;

const AUTH_OBJECTS = [
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
];

/** The env the seed is HARD-gated on (`isDevAdminSeedArmed`). */
const SEED_ENV_KEYS = [
  'NODE_ENV',
  'OS_SEED_ADMIN',
  'OS_SEED_ADMIN_EMAIL',
  'OS_SEED_ADMIN_PASSWORD',
  'OS_SEED_ADMIN_NAME',
] as const;
let savedEnv: Record<string, string | undefined> = {};

const engines: ObjectQL[] = [];

beforeEach(() => {
  savedEnv = Object.fromEntries(SEED_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of SEED_ENV_KEYS) delete process.env[k];
  process.env.NODE_ENV = 'development';
});

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  for (const object of AUTH_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return engine;
}

/** The population that makes this card: people, no credentials. */
async function seedPeople(engine: ObjectQL, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await engine.insert(
      'sys_user',
      { name: `Person ${i}`, email: `person${i}@demo.example` },
      SYSTEM,
    );
  }
}

function makeManager(engine: ObjectQL, config: Record<string, unknown> = {}): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    ...config,
  } as never);
}

interface SeedRun {
  plugin: AuthPlugin;
  manager: AuthManager;
  logs: { level: string; message: string }[];
}

/**
 * Run exactly what `kernel:ready` runs — `AuthPlugin.maybeSeedDevAdmin` — over
 * a real engine and a real `AuthManager`. Private by design (it is a boot
 * step, not an API); reached the way the hook reaches it.
 */
async function runDevAdminSeed(engine: ObjectQL, manager?: AuthManager): Promise<SeedRun> {
  const mgr = manager ?? makeManager(engine);
  const logs: { level: string; message: string }[] = [];
  const record = (level: string) => (message: unknown) =>
    logs.push({ level, message: String(message) });
  const ctx = {
    getService: (name: string) => (name === 'objectql' ? engine : undefined),
    logger: {
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
    },
  } as unknown as PluginContext;

  const plugin = new AuthPlugin({ secret: SECRET });
  (plugin as unknown as { authManager: AuthManager }).authManager = mgr;
  await (
    plugin as unknown as { maybeSeedDevAdmin(c: PluginContext): Promise<void> }
  ).maybeSeedDevAdmin(ctx);
  return { plugin, manager: mgr, logs };
}

async function readRows(engine: ObjectQL, object: string): Promise<Record<string, unknown>[]> {
  const raw = await engine.find(object, { limit: 200 }, SYSTEM);
  return (Array.isArray(raw) ? raw : []) as Record<string, unknown>[];
}

/**
 * Every `sys_account` row INCLUDING the credential hash — `password` is
 * `internal: true`, so a system read arrives without it (#8676) and a
 * "nothing changed" assertion that skipped it would be blind to exactly the
 * column an overwrite would rewrite.
 */
async function readAccountsWithSecrets(engine: ObjectQL): Promise<Record<string, unknown>[]> {
  const rows = await readRows(engine, 'sys_account');
  await recoverInternalFieldsForSystemRead(engine as never, 'sys_account', rows, ['password']);
  return rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** A stranger's PUBLIC self-registration — the door that must not move. */
function httpSignUp(manager: AuthManager, email: string): Promise<Response> {
  return manager.handleRequest(
    new Request(`${BASE}${AUTH_BASE}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: 'S3cure!Passw0rd-14157', name: 'Stranger' }),
    }),
  );
}

/** The real `GET /auth/bootstrap-status` route, mounted the way the plugin mounts it. */
function mountBootstrapStatus(manager: AuthManager): Hono {
  const app = new Hono();
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn(() => undefined),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  } as unknown as PluginContext;
  const plugin = new AuthPlugin({ secret: SECRET });
  (plugin as unknown as { authManager: AuthManager }).authManager = manager;
  (
    plugin as unknown as {
      registerAuthRoutes(s: unknown, c: PluginContext): void;
    }
  ).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  return app;
}

async function bootstrapStatus(app: Hono): Promise<{ hasOwner: boolean }> {
  const res = await app.request(`http://localhost${AUTH_BASE}/bootstrap-status`);
  expect(res.status).toBe(200);
  return (await res.json()) as { hasOwner: boolean };
}

describe('[#14157] the dev-admin seed gates on a LOGIN, not on user rows', () => {
  it('⓪ THE MECHANISM: with people seeded and no ticket, the seed lane is REFUSED — so the gate alone could never have fixed this', async () => {
    const engine = await bootEngine();
    await seedPeople(engine, 13);
    const manager = makeManager(engine);

    // Exactly the call `maybeSeedDevAdmin` makes, with no operator ticket
    // staged: the audience gate's bootstrap bypass reads these 13 rows as a
    // populated environment and the default `invite_only` posture refuses.
    const api = (await manager.getApi()) as unknown as {
      signUpEmail(input: { body: Record<string, unknown> }): Promise<unknown>;
    };
    let code = '';
    await expect(
      api
        .signUpEmail({ body: { email: SEED_EMAIL, password: SEED_PASSWORD, name: 'Dev Admin' } })
        .catch((e: { body?: { code?: string } }) => {
          code = e?.body?.code ?? '';
          throw e;
        }),
    ).rejects.toBeTruthy();
    expect(code).toBe(SELF_REGISTRATION_CLOSED);
    expect(await readRows(engine, 'sys_account')).toEqual([]);
  });

  it('① THE DEFECT: 13 seeded people and zero accounts — the dev admin IS provisioned, with a real credential', async () => {
    const engine = await bootEngine();
    await seedPeople(engine, 13);

    const { manager } = await runDevAdminSeed(engine);

    const accounts = await readRows(engine, 'sys_account');
    expect(
      accounts.map((a) => a.provider_id),
      'the seed must create exactly one local password login',
    ).toEqual(['credential']);
    const users = await readRows(engine, 'sys_user');
    const seeded = users.find((u) => String(u.email).toLowerCase() === SEED_EMAIL);
    expect(seeded, 'the seed address must exist as a user').toBeTruthy();
    expect(accounts[0].user_id).toBe(seeded!.id);
    // …and the row the account belongs to is stamped verified (#11343).
    expect(seeded!.email_verified).toBeTruthy();
    // The banner the CLI prints reads this.
    expect(manager.devSeedResult).toEqual({ email: SEED_EMAIL, password: SEED_PASSWORD });
    // The people the app seeded are untouched.
    expect(users.filter((u) => String(u.email).endsWith('@demo.example')).length).toBe(13);
  });

  it('① (b) the provisioned admin can actually SIGN IN — the whole point of "loginable"', async () => {
    const engine = await bootEngine();
    await seedPeople(engine, 13);
    const { manager } = await runDevAdminSeed(engine);

    const res = await manager.handleRequest(
      new Request(`${BASE}${AUTH_BASE}/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
      }),
    );

    expect(res.status, `sign-in failed: ${await res.clone().text()}`).toBeLessThan(300);
  });

  it('② NEVER OVERWRITE: a later boot leaves the existing account byte-identical, hash included', async () => {
    const engine = await bootEngine();
    await seedPeople(engine, 13);
    await runDevAdminSeed(engine);
    const before = await readAccountsWithSecrets(engine);
    expect(before.length).toBe(1);
    expect(before[0].password, 'the hash must be readable, or this pin is blind').toBeTruthy();

    // A second boot against the same persistent database.
    const second = await runDevAdminSeed(engine);

    const after = await readAccountsWithSecrets(engine);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    // …and the credential hint is re-armed for the banner, not re-minted.
    expect(second.manager.devSeedResult).toEqual({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    });
  });

  it('② (b) NEVER OVERWRITE: the seed address claimed by a FEDERATED account is left alone too', async () => {
    const engine = await bootEngine();
    const user = (await engine.insert(
      'sys_user',
      { name: 'Imported Admin', email: SEED_EMAIL },
      SYSTEM,
    )) as Record<string, unknown>;
    await engine.insert(
      'sys_account',
      { user_id: user.id, account_id: 'idp-123', provider_id: 'sso-oidc' },
      SYSTEM,
    );

    const { logs } = await runDevAdminSeed(engine);

    const accounts = await readRows(engine, 'sys_account');
    expect(accounts.map((a) => a.provider_id)).toEqual(['sso-oidc']);
    expect(logs.some((l) => l.message.includes('seed-address-claimed'))).toBe(true);
  });

  it('③ CONTROL: a zero-user database still behaves exactly as it did', async () => {
    const engine = await bootEngine();

    const { manager } = await runDevAdminSeed(engine);

    expect((await readRows(engine, 'sys_account')).map((a) => a.provider_id)).toEqual([
      'credential',
    ]);
    expect(manager.devSeedResult).toEqual({ email: SEED_EMAIL, password: SEED_PASSWORD });
  });

  it('③ (b) CONTROL: an existing LOCAL login elsewhere still stops the seed — no second known-credential admin', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);
    // A real operator signed up first, with their own address and password.
    const api = (await manager.getApi()) as unknown as {
      signUpEmail(input: { body: Record<string, unknown> }): Promise<unknown>;
    };
    await api.signUpEmail({
      body: { email: 'boss@corp.example', password: 'S3cure!Passw0rd-14157', name: 'Boss' },
    });
    const before = await readAccountsWithSecrets(engine);

    const { logs } = await runDevAdminSeed(engine, makeManager(engine));

    expect(await readAccountsWithSecrets(engine)).toEqual(before);
    expect(
      (await readRows(engine, 'sys_user')).some(
        (u) => String(u.email).toLowerCase() === SEED_EMAIL,
      ),
    ).toBe(false);
    expect(logs.some((l) => l.message.includes('local-login-exists'))).toBe(true);
  });

  it('④ CONTROL: the PUBLIC door did not move — a stranger is still refused on the same population', async () => {
    const engine = await bootEngine();
    await seedPeople(engine, 13);

    // Before the seed runs…
    const cold = makeManager(engine);
    const coldRes = await httpSignUp(cold, 'stranger-before@example.com');
    expect(coldRes.status).toBe(403);
    expect(((await coldRes.json()) as { code?: string }).code).toBe(SELF_REGISTRATION_CLOSED);

    const { manager } = await runDevAdminSeed(engine);
    expect((await readRows(engine, 'sys_account')).length).toBe(1);

    // …and after it. The ticket admitted exactly one address, once.
    const warmRes = await httpSignUp(manager, 'stranger-after@example.com');
    expect(warmRes.status).toBe(403);
    expect(((await warmRes.json()) as { code?: string }).code).toBe(SELF_REGISTRATION_CLOSED);
    expect((await readRows(engine, 'sys_account')).length).toBe(1);
  });

  it('⑤ NO RESIDUE: the operator ticket is gone once the seed returns', async () => {
    const engine = await bootEngine();
    await seedPeople(engine, 13);

    const { manager } = await runDevAdminSeed(engine);

    expect(manager.isOperatorProvisioning(SEED_EMAIL)).toBe(false);
    expect(manager.isOperatorProvisioning(SEED_EMAIL.toUpperCase())).toBe(false);
  });

  it('⑤ (b) the ticket is cleared even when the provisioning call THROWS', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);
    // A user already holds the address but has no account at all, so the gate
    // says "act" and better-auth then refuses the duplicate email.
    await engine.insert('sys_user', { name: 'Ghost', email: SEED_EMAIL }, SYSTEM);

    const { logs } = await runDevAdminSeed(engine, manager);

    expect(manager.isOperatorProvisioning(SEED_EMAIL)).toBe(false);
    expect(await readRows(engine, 'sys_account')).toEqual([]);
    // The failure is reported rather than swallowed.
    expect(logs.some((l) => l.level === 'warn')).toBe(true);
  });

  it('⑥ the gate predicate itself: people are not logins, and an unreadable store is its own verdict', async () => {
    const engine = await bootEngine();
    await seedPeople(engine, 13);

    expect(await decideDevAdminSeedGate(engine as never, SEED_EMAIL)).toEqual({ act: true });
    expect(await decideDevAdminSeedGate(undefined, SEED_EMAIL)).toEqual({
      act: false,
      reason: 'unanswerable',
    });
    const throwing = {
      find: () => Promise.reject(new Error('store unavailable')),
    };
    expect(await decideDevAdminSeedGate(throwing, SEED_EMAIL)).toEqual({
      act: false,
      reason: 'unanswerable',
    });
  });

  it('⑦ bootstrap-status agrees with the admission gate — a legacy usr_system row is NOT an owner', async () => {
    const engine = await bootEngine();
    // The service account an older runtime provisioned. It is not a human, and
    // the admission gate still stands ready to admit the first one.
    await engine.insert(
      'sys_user',
      { id: 'usr_system', email: 'system@localhost', name: 'System', role: 'system' },
      SYSTEM,
    );
    const manager = makeManager(engine);
    const app = mountBootstrapStatus(manager);

    // The expression the handler used to evaluate — non-vacuity for this pin.
    expect(await engine.count('sys_user', {} as never, SYSTEM)).toBe(1);

    expect(await bootstrapStatus(app)).toEqual({ hasOwner: false });
    expect(await manager.hasBootstrapWindow()).toBe(true);
  });

  it('⑧ bootstrap-status: a human owner closes it, and a seeded dev admin IS that owner', async () => {
    const engine = await bootEngine();
    const app0 = mountBootstrapStatus(makeManager(engine));
    expect(await bootstrapStatus(app0), 'an empty install offers first-run setup').toEqual({
      hasOwner: false,
    });

    const { manager } = await runDevAdminSeed(engine);

    expect(await bootstrapStatus(mountBootstrapStatus(manager))).toEqual({ hasOwner: true });
  });
});
