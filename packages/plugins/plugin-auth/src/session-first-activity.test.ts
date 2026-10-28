// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A sign-in through the real stack — a kernel with the SQL driver, ObjectQL
 * (whose own `beforeInsert` stamps `created_at`), the auth and security
 * plugins — stores the session row Setup › Sessions prints:
 *
 *  - `last_activity_at` equal to the `created_at` the row is stored with
 *    (`session-first-activity.ts`), and the heartbeat's first write still
 *    waits out its one-minute throttle;
 *  - `ip_address` the client address in its RFC 5952 text
 *    (`client-address-canonical.ts`), handed over as the transport's peer.
 *
 * The memory-engine half (every row of a sign-in, the forwarded and mapped
 * forms) is `session-client-address-capture.test.ts`; this file is the one
 * that runs ObjectQL's stamp, which an engine double does not.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';

const SYS = { isSystem: true } as const;
const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-at-least-32-chars-long-26638';
const SEED_EMAIL = 'admin@objectos.ai';
const SEED_PASSWORD = 'admin123';

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

const at = (v: unknown) => new Date(v as string).getTime();

describe('[#26638] on the real stack, a session row is born with last_activity_at and a canonical client address', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let manager: AuthManager;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // The development boot seeds the admin this file signs in as.
    process.env.NODE_ENV = 'development';
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuthPlugin({ secret: SECRET, baseUrl: BASE }));
    await kernel.use(new SecurityPlugin());
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    manager = kernel.getService<AuthManager>('auth');
  }, 30_000);

  afterAll(async () => {
    try {
      await kernel?.shutdown();
    } catch {
      /* a refused boot leaves the kernel stopped */
    }
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  /** Sign the seeded admin in from `peer`; the session row it minted. */
  const signInFrom = async (peer: string) => {
    const before = new Set(
      ((await ql.find('sys_session', { limit: 500, context: SYS })) as Array<{ id: string }>).map((r) => r.id),
    );
    const res = await manager.handleRequest(
      new Request(`${BASE}/api/v1/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
      }),
      { remoteAddress: peer },
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const minted = ((await ql.find('sys_session', { limit: 500, context: SYS })) as Array<Record<string, any>>)
      .filter((r) => !before.has(r.id));
    expect(minted, 'one session minted by the sign-in').toHaveLength(1);
    return minted[0]!;
  };

  it('the session the development admin seed mints at boot is born with it too', async () => {
    const atBoot = (await ql.find('sys_session', { limit: 500, context: SYS })) as Array<Record<string, any>>;
    expect(atBoot.length, 'the seed signs the admin up, which mints a session').toBeGreaterThan(0);
    for (const row of atBoot) {
      expect(row.last_activity_at, `session ${row.id}`).toBeTruthy();
      expect(at(row.last_activity_at)).toBe(at(row.created_at));
    }
  });

  it('a sign-in from ::1 stores ::1, and last_activity_at equal to the stored created_at', async () => {
    const session = await signInFrom('::1');

    expect(session.ip_address).toBe('::1');
    expect(session.created_at).toBeTruthy();
    expect(session.last_activity_at).toBeTruthy();
    expect(at(session.last_activity_at)).toBe(at(session.created_at));
  });

  it('the heartbeat\'s first write still waits out its one-minute throttle', async () => {
    const session = await signInFrom('203.0.113.7');
    expect(session.ip_address).toBe('203.0.113.7');
    const born = at(session.last_activity_at);
    const read = async () =>
      at(((await ql.findOne('sys_session', { where: { id: session.id }, context: SYS })) as any).last_activity_at);
    const enforce = () =>
      (manager as never as { enforceSessionControls(s: string, c: unknown): Promise<void> })
        .enforceSessionControls(session.id, undefined);

    // A request inside the first minute: not written.
    await enforce();
    expect(await read()).toBe(born);

    // Past the minute (the per-process read memo is a minute too): advanced.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(born + 61_000);
      await enforce();
    } finally {
      vi.useRealTimers();
    }
    expect(await read()).toBe(born + 61_000);
  });
});
