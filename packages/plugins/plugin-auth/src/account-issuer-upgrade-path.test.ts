// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17440] The EXISTING-DATA upgrade, driven end to end over one real database.
 *
 * ## What "existing data" means here, precisely
 *
 * A deployment that ran better-auth 1.7.0–1.7.2 has a `sys_account` table with
 * an `issuer` COLUMN carrying values. After this change the platform no longer
 * declares that column — but the physical column does not vanish when the code
 * ships. Dropping it is a DESTRUCTIVE change, and `os migrate apply` skips
 * destructive work without `--allow-destructive`, so between the deploy and the
 * operator's migration window every such deployment runs the new code against
 * the OLD physical table.
 *
 * ⇒ That window is the state this file pins, and it is the one nothing else
 * covers: `showcase-demo-personas-loginable.dogfood.test.ts` proves a FRESH
 * install signs in, and a fresh install never has the column.
 *
 * ## How it is built, and why two engines over one file
 *
 * One SQLite FILE, two engines:
 *
 *   • engine A registers a `sys_account` that still DECLARES `issuer` — the
 *     pre-upgrade shape. A real `AuthManager` signs a user up through the real
 *     HTTP route, so the password hash is better-auth's own, and the row is then
 *     stamped with the issuer a 1.7.2 runtime wrote — read off the derivation
 *     this branch retires, 2026-09-10, and ⛔ NOT re-measured: 1.7.2 is a
 *     version this tree no longer installs, which is the whole premise here.
 *   • engine B, on the SAME file, registers the objects as they ship TODAY. It
 *     is the upgraded deployment: new code, old table.
 *
 * The alternative — hand-writing a password hash — would have pinned this
 * suite's idea of better-auth's hash format rather than better-auth's.
 *
 * ⛔ Nothing here asserts a status alone: a sign-in is judged by the session it
 * installs, because a 200 that resolves to nobody is what a broken sign-in
 * looks like from the outside.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { probeAccountIdentityCollisions, assertNoAccountIdentityCollisions } from './account-identity-preflight.js';

const SECRET = 'test-secret-at-least-32-chars-long-17440';
const BASE = 'http://localhost:3000';
const AUTH_BASE = '/api/v1/auth';
const EMAIL = 'legacy.account@example.com';
const PASSWORD = 'S3cure!Passw0rd-17440';
const SYSTEM = { context: { isSystem: true } } as never;

/** The value a 1.7.2 runtime stamped on a local password account. */
const LEGACY_CREDENTIAL_ISSUER = 'local:credential';

const engines: ObjectQL[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
});

function newDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-17440-upgrade-'));
  dirs.push(dir);
  return join(dir, 'identity.sqlite');
}

async function bootEngine(filename: string, objects: unknown[]): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of objects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return engine;
}

/**
 * The objects as they shipped BEFORE this change: today's set, with
 * `sys_account` swapped for one that still declares `issuer`. Built by
 * TRANSFORMING the live object rather than by re-spelling it, so the pre-upgrade
 * fixture cannot drift away from the shape it is supposed to be one field from.
 */
function preUpgradeObjects(): unknown[] {
  return authIdentityObjects.map((object: any) => {
    if (object?.name !== 'sys_account') return object;
    return {
      ...object,
      fields: {
        ...object.fields,
        issuer: { name: 'issuer', type: 'text', label: 'Issuer', maxLength: 2048 },
      },
    };
  });
}

const manager = (engine: ObjectQL) =>
  new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never } as never);

const post = (m: AuthManager, path: string, body: unknown) =>
  m.handleRequest(
    new Request(`${BASE}${AUTH_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify(body),
    }),
  );

const cookieHeader = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

/** Who does this session resolve to? A token alone proves only that a route answered. */
async function principalFor(m: AuthManager, cookie: string): Promise<string | null> {
  const res = await m.handleRequest(
    new Request(`${BASE}${AUTH_BASE}/get-session`, { headers: { cookie, origin: BASE } }),
  );
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { user?: { id?: unknown } } | null;
  const id = body?.user?.id;
  return typeof id === 'string' && id ? id : null;
}

const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : []);

/**
 * Build the pre-upgrade database: a real account minted by better-auth, then
 * stamped with the issuer a 1.7.2 runtime wrote beside it.
 */
async function arrangeLegacyDatabase(file: string): Promise<{ userId: string }> {
  const legacy = await bootEngine(file, preUpgradeObjects());
  const legacyManager = manager(legacy);

  const signedUp = await post(legacyManager, '/sign-up/email', {
    email: EMAIL,
    password: PASSWORD,
    name: 'Legacy Account',
  });
  expect(signedUp.status, `sign-up: ${await signedUp.clone().text()}`).toBeLessThan(300);

  const users = rowsOf(await legacy.find('sys_user', { where: { email: EMAIL }, limit: 1 }, SYSTEM));
  const userId = String(users[0]?.id ?? '');
  expect(userId, 'the sign-up produced a sys_user row').toBeTruthy();

  const accounts = rowsOf(
    await legacy.find('sys_account', { where: { user_id: userId }, limit: 5 }, SYSTEM),
  );
  expect(accounts.length, 'the sign-up produced exactly one account row').toBe(1);

  // Stamp it the way a 1.7.2 runtime did. On the pre-upgrade object this is an
  // ordinary declared write; it is what makes the row "existing data" rather
  // than a row this test merely says is old.
  await legacy.update('sys_account', { id: accounts[0]!.id, issuer: LEGACY_CREDENTIAL_ISSUER }, SYSTEM);
  const stamped = rowsOf(
    await legacy.find('sys_account', { where: { user_id: userId }, limit: 1 }, SYSTEM),
  );
  expect(
    stamped[0]?.issuer,
    'PREMISE: the pre-upgrade database really carries a populated issuer column',
  ).toBe(LEGACY_CREDENTIAL_ISSUER);

  return { userId };
}

describe('#17440 existing-data upgrade — new code against the OLD physical table', () => {
  it('a 1.7.2-era account still SIGNS IN over the real auth route after the column is undeclared', async () => {
    const file = newDbFile();
    const { userId } = await arrangeLegacyDatabase(file);

    // The upgraded deployment: today's objects, yesterday's table.
    const upgraded = await bootEngine(file, authIdentityObjects);
    const upgradedManager = manager(upgraded);

    const signedIn = await post(upgradedManager, '/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(signedIn.status, `sign-in after upgrade: ${await signedIn.clone().text()}`).toBeLessThan(300);

    // Ends at the principal, never at the status.
    expect(
      await principalFor(upgradedManager, cookieHeader(signedIn)),
      "the session resolves to the legacy account's own user",
    ).toBe(userId);
  });

  it('the undeclared column is NOT silently dropped by schema sync — the drop stays the operator\'s deliberate act', async () => {
    const file = newDbFile();
    await arrangeLegacyDatabase(file);

    const upgraded = await bootEngine(file, authIdentityObjects);

    // Read the physical table, not the metadata: booting the new code must not
    // have destroyed a column that still holds data. ADR-0131 D10's whole
    // posture is that a destructive change is an operator ceremony, never a
    // boot step, and this is that posture measured on the identity table.
    const driver: any = (upgraded as any).drivers?.values?.().next?.().value
      ?? (upgraded as any).defaultDriver
      ?? (upgraded as any).driver;
    const knex = driver?.knex ?? driver?.db ?? driver?.client;
    expect(typeof knex, 'reached the driver\'s SQL handle').toBe('function');
    const columns = await knex.raw('PRAGMA table_info(sys_account)');
    const names = (Array.isArray(columns) ? columns : columns?.rows ?? []).map((c: any) => String(c.name));
    expect(names, 'CONTROL: the PRAGMA really read this table').toContain('provider_id');
    expect(names, 'the physical column survived the upgrade boot').toContain('issuer');
  });

  it('the pre-flight reads CLEAN on that database, which is what authorises the drop', async () => {
    const file = newDbFile();
    await arrangeLegacyDatabase(file);
    const upgraded = await bootEngine(file, authIdentityObjects);

    const report = await probeAccountIdentityCollisions(upgraded as never);
    expect(report.scanned, 'the one legacy account was read').toBe(1);
    expect(report.ok).toBe(true);
    expect(() => assertNoAccountIdentityCollisions(report)).not.toThrow();
  });

  it('and sign-in still works once the column is actually GONE — the far side of the ceremony', async () => {
    const file = newDbFile();
    const { userId } = await arrangeLegacyDatabase(file);

    const upgraded = await bootEngine(file, authIdentityObjects);
    const driver: any = (upgraded as any).drivers?.values?.().next?.().value
      ?? (upgraded as any).defaultDriver
      ?? (upgraded as any).driver;
    const knex = driver?.knex ?? driver?.db ?? driver?.client;
    expect(typeof knex, 'reached the driver\'s SQL handle').toBe('function');

    // What `os migrate apply --allow-destructive` does, after the pre-flight
    // has read clean.
    await knex.raw('ALTER TABLE sys_account DROP COLUMN issuer');
    const after = await knex.raw('PRAGMA table_info(sys_account)');
    const names = (Array.isArray(after) ? after : after?.rows ?? []).map((c: any) => String(c.name));
    // ⛔ The control is not optional here: `not.toContain` passes VACUOUSLY on
    // an empty array, so a PRAGMA that read nothing would read as "the column
    // is gone" — the one reading this case must never produce by accident.
    expect(names, 'CONTROL: the PRAGMA really read this table').toContain('provider_id');
    expect(names, 'PREMISE: the column is really gone').not.toContain('issuer');

    // A fresh manager on the migrated table — the state every deployment ends in.
    const migratedManager = manager(upgraded);
    const signedIn = await post(migratedManager, '/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(signedIn.status, `sign-in after the drop: ${await signedIn.clone().text()}`).toBeLessThan(300);
    expect(
      await principalFor(migratedManager, cookieHeader(signedIn)),
      'the same user, on the far side of the migration',
    ).toBe(userId);
  });
});
