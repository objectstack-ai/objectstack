// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25096] The ObjectQL adapter keeps the primary key better-auth forces on a
 * single-use reservation, so a replayed reservation is refused.
 *
 * better-auth's replay checks (DPoP proof `jti`s, `private_key_jwt` client
 * assertions, SAML assertion ids, SIWE nonces) all go through
 * `internalAdapter.reserveVerificationValue`. It inserts a `verification` row
 * whose `id` is derived from the guarded value (SHA-256 of
 * `reserve:IDENTIFIER`), with `forceAllowId: true`, and reads a failed insert
 * as "already taken" only when a row with THAT id exists. So the whole check
 * rests on one property of the adapter underneath: the forced id must land as
 * the row's primary key. An adapter or engine that swaps in an id of its own
 * lets every insert succeed, and every replay with it.
 *
 * 1.7.8 (better-auth/better-auth#11625) fixed that for `generateId: "uuid"`,
 * where the id field used to replace the non-UUID digest. plugin-auth sets no
 * `generateId`, so better-auth's own generator runs and the forced digest is
 * passed through as base64url (`encodeDeterministicId`). What this file pins is
 * the half better-auth cannot see: that the ObjectQL adapter, the engine and
 * the SQL driver keep it.
 *
 * Real stack: `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, the
 * objects from this plugin's manifest and a real `AuthManager`; the
 * reservation is better-auth's own, read off the instance's `$context`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-at-least-32-chars-long-25096';
const VERIFICATION_OBJECT = 'sys_verification';

type Row = Record<string, unknown>;

interface ReservingContext {
  internalAdapter: {
    reserveVerificationValue(data: { identifier: string; value: string; expiresAt: Date }): Promise<boolean>;
  };
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()!.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<{ engine: ObjectQL; context: ReservingContext }> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();
  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never } as never);
  const auth = (await manager.getAuthInstance()) as unknown as { $context: Promise<ReservingContext> };
  return { engine, context: await auth.$context };
}

/** Rows at DRIVER level, below the engine, with the identifier the reservation stored. */
async function reservationRows(engine: ObjectQL, identifier: string): Promise<Row[]> {
  const driver = (engine as unknown as { getDriver(o: string): { find(o: string, q: unknown): Promise<unknown> } })
    .getDriver(VERIFICATION_OBJECT);
  const found = await driver.find(VERIFICATION_OBJECT, { where: { identifier } });
  return (Array.isArray(found) ? found : [found]).filter(Boolean) as Row[];
}

/** better-auth's deterministic reservation id without a `generateId` strategy: base64url SHA-256, unpadded. */
const reservationId = (identifier: string): string =>
  createHash('sha256').update(`reserve:${identifier}`).digest('base64url');

const expiresAt = () => new Date(Date.now() + 5 * 60_000);

describe('[#25096] a single-use reservation refuses its replay through the ObjectQL adapter', () => {
  it('the first reservation wins and is stored under the id better-auth forced', async () => {
    const { engine, context } = await boot();
    const identifier = 'replay-probe:first';

    expect(await context.internalAdapter.reserveVerificationValue({ identifier, value: 'v', expiresAt: expiresAt() })).toBe(true);

    const rows = await reservationRows(engine, identifier);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id, 'the engine kept the forced primary key').toBe(reservationId(identifier));
  });

  it('the replay of the same value is refused, and leaves one row', async () => {
    const { engine, context } = await boot();
    const identifier = 'replay-probe:replayed';

    expect(await context.internalAdapter.reserveVerificationValue({ identifier, value: 'v', expiresAt: expiresAt() })).toBe(true);
    expect(await context.internalAdapter.reserveVerificationValue({ identifier, value: 'v', expiresAt: expiresAt() })).toBe(false);

    expect(await reservationRows(engine, identifier)).toHaveLength(1);
  });

  it('CONTROL: a different value is its own reservation and wins', async () => {
    const { context } = await boot();

    expect(await context.internalAdapter.reserveVerificationValue({ identifier: 'replay-probe:a', value: 'v', expiresAt: expiresAt() })).toBe(true);
    expect(await context.internalAdapter.reserveVerificationValue({ identifier: 'replay-probe:b', value: 'v', expiresAt: expiresAt() })).toBe(true);
  });
});
