// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A SCIM PATCH that changes only the name PARTS (`name.givenName`,
 * `name.familyName`) moves the user's display name when that display name was
 * derived from the parts, end to end through `@better-auth/scim`.
 *
 * ## The defect
 *
 * `@better-auth/scim` 1.7.12 `setNamePart` stores the part and never
 * recomposes `name.formatted` or `displayName`; its `composeName` helper is
 * used only by the `name.formatted` remove path. The vendor writes
 * `sys_user.name` from its own stored `displayName` on every profile PATCH, so
 * an identity provider whose mapping sends only the name parts left the
 * console on the old name indefinitely, and a host write of `sys_user.name`
 * was put back by the next unrelated PATCH.
 *
 * ## The fix this pins, and when it goes
 *
 * Maintainer ruling record 6845302116 (option C): a temporary pnpm patch,
 * `patches/@better-auth__scim@1.7.12.patch`, makes `setNamePart` recompose
 * `name.formatted` (and through the vendor's own `setFormattedName`,
 * `displayName`) when `name.formatted` equalled `composeName` of the parts
 * before the part changed: the same derived test `setFormattedName` already
 * makes for `displayName`. An administrator- or IdP-set name that was not
 * composed from the parts is never overwritten. The patch is removed in the
 * upgrade PR to the vendor release that ships the recompose; this file stays.
 *
 * ## Faces
 *
 *  (a) the two shapes identity providers send — Entra ID's path-addressed
 *      `Replace` pair and Okta's path-less `replace` with dotted keys — move
 *      `displayName`, `name.formatted` and `sys_user.name` together; and an
 *      unrelated PATCH afterwards does not put the old name back.
 *  (b) CONTROLS, so (a) cannot pass by overwriting every name: a display
 *      name that was set explicitly survives a part change (both when the
 *      formatted name was explicit too, and when only `displayName` was), and
 *      a `displayName` sent in the same PATCH as the parts wins in either
 *      operation order.
 *
 * Every case drives `AuthManager.handleRequest()` with a real SCIM bearer on a
 * real `ObjectQL` over better-sqlite3, the harness
 * `scim-manager-projection.test.ts` boots: the vendor's PATCH handler, its
 * `sys_user` write and its stored SCIM row are inside the system under test.
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { mintScimConnectionCredential } from './scim-connection-service.js';
import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { registerIdentityWriteGuard, registerManagedUpdateWhitelist } from './identity-write-guard.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { sqliteEnginePool, type BootedSqliteEngine } from './__tests__/sqlite-engine-pool.testkit.js';
// better-auth's first module load is paid at module load, not inside the first
// case (AGENTS.md, Build & Test: clocked windows measure behaviour, never loading).
import 'better-auth';
import 'better-auth/api';
import 'better-auth/db';
import 'better-auth/plugins';
import 'better-auth/plugins/admin';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/organization';
import 'better-auth/plugins/organization/access';
import '@better-auth/core/context';
import '@better-auth/core/error';
import '@better-auth/oauth-provider';
import '@better-auth/scim';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-scim-name';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

const SYSTEM = { context: { isSystem: true } } as const;
const ORG = 'org_acme_scim_name';
const CONNECTION = 'entra-scim-name';
const DEFAULT_ORG = 'org_default';

// The grant tables a SCIM deployment registers beside the identity objects;
// the last-administrator guard reads them on every user update.
const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
  },
};

const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    permission_set: { name: 'permission_set', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};

async function bootEngine(): Promise<BootedSqliteEngine> {
  const engine = new ObjectQL();
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of [...authIdentityObjects, sysPermissionSet, sysUserPermissionSet]) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default Organization', slug: 'default' }, SYSTEM);
  bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS }] });
  registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
  registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard' });
  return { engine, driver };
}

const enginePool = sqliteEnginePool(bootEngine, { keepBootOrganizations: true });
afterEach(enginePool.release);
afterAll(enginePool.destroy);

interface Harness {
  engine: ObjectQL;
  token: string;
  send: (request: Request) => Promise<Response>;
}

async function boot(): Promise<Harness> {
  const engine = await enginePool.take();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { scim: true, organization: true },
  } as never);
  const { token } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: CONNECTION,
    organizationId: ORG,
  });
  return { engine, token, send: (request) => manager.handleRequest(request) };
}

function scimRequest(h: Harness, method: string, path: string, body?: unknown): Request {
  return new Request(`${AUTH}/scim/v2${path}`, {
    method,
    headers: {
      origin: BASE,
      authorization: `Bearer ${h.token}`,
      ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

interface Provisioned {
  scimId: string;
  userId: string;
}

interface NameReading {
  displayName: string | undefined;
  formatted: string | undefined;
  givenName: string | undefined;
  familyName: string | undefined;
  /** `sys_user.name`, what the console shows. */
  userName: string | undefined;
}

/** `POST /Users`; `displayName` / `formatted` are sent only when the case gives them. */
async function provision(
  h: Harness,
  local: string,
  name: { givenName: string; familyName: string; formatted?: string },
  displayName?: string,
): Promise<Provisioned> {
  const email = `${local}@acme.com`;
  const res = await h.send(scimRequest(h, 'POST', '/Users', {
    schemas: [USER_SCHEMA],
    userName: email,
    externalId: `ext-${local}`,
    name,
    ...(displayName !== undefined ? { displayName } : {}),
    emails: [{ value: email, type: 'work', primary: true }],
    active: true,
  }));
  expect(res.status, `create ${local} failed: ${await res.clone().text()}`).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const rows = (await h.engine.find('sys_user', { where: { email }, fields: ['id'] }, SYSTEM)) as Array<{ id: string }>;
  expect(rows).toHaveLength(1);
  return { scimId: id, userId: rows[0].id };
}

async function patchUser(h: Harness, user: Provisioned, operations: unknown[]): Promise<void> {
  const res = await h.send(scimRequest(h, 'PATCH', `/Users/${user.scimId}`, {
    schemas: [PATCH_SCHEMA],
    Operations: operations,
  }));
  expect(res.status, `PATCH failed: ${await res.clone().text()}`).toBe(200);
}

/** The SCIM resource as the IdP reads it back, plus the `sys_user.name` the console shows. */
async function readName(h: Harness, user: Provisioned): Promise<NameReading> {
  const res = await h.send(scimRequest(h, 'GET', `/Users/${user.scimId}`));
  expect(res.status, `GET failed: ${await res.clone().text()}`).toBe(200);
  const body = (await res.json()) as {
    displayName?: string;
    name?: { formatted?: string; givenName?: string; familyName?: string };
  };
  const row = (await h.engine.findOne('sys_user', { where: { id: user.userId }, fields: ['name'] }, SYSTEM)) as {
    name?: string;
  } | null;
  return {
    displayName: body.displayName,
    formatted: body.name?.formatted,
    givenName: body.name?.givenName,
    familyName: body.name?.familyName,
    userName: row?.name,
  };
}

/** Entra ID: one path-addressed `Replace` per part. */
const ENTRA_PARTS = [
  { op: 'Replace', path: 'name.givenName', value: 'Entra' },
  { op: 'Replace', path: 'name.familyName', value: 'Style' },
];

/** Okta: one path-less `replace` whose value carries dotted keys. */
const OKTA_PARTS = [
  { op: 'replace', value: { 'name.givenName': 'Entra', 'name.familyName': 'Style' } },
];

const RECOMPOSED: NameReading = {
  displayName: 'Entra Style',
  formatted: 'Entra Style',
  givenName: 'Entra',
  familyName: 'Style',
  userName: 'Entra Style',
};

describe('SCIM name parts: a part-only PATCH recomposes a derived display name', () => {
  for (const [shape, operations] of [['Entra path-addressed', ENTRA_PARTS], ['Okta path-less', OKTA_PARTS]] as const) {
    it(`(a) ${shape}: displayName, name.formatted and sys_user.name move with the parts`, async () => {
      const h = await boot();
      const user = await provision(h, `derived-${shape.split(' ')[0].toLowerCase()}`, {
        givenName: 'Renamed',
        familyName: 'InOkta',
      });
      // The starting point is the derived one: nothing but the parts was sent.
      expect(await readName(h, user)).toEqual({
        displayName: 'Renamed InOkta',
        formatted: 'Renamed InOkta',
        givenName: 'Renamed',
        familyName: 'InOkta',
        userName: 'Renamed InOkta',
      });

      await patchUser(h, user, [...operations]);
      expect(await readName(h, user)).toEqual(RECOMPOSED);

      // The vendor rewrites sys_user.name from its own stored displayName on a
      // profile PATCH, so an unrelated change must not bring the old name back.
      await patchUser(h, user, [{ op: 'replace', path: 'title', value: 'Engineer' }]);
      expect(await readName(h, user)).toEqual(RECOMPOSED);
    });
  }

  it('(b) CONTROL: an explicit displayName (and the formatted name it seeded) survives a part change', async () => {
    const h = await boot();
    // The create rule: name.formatted falls back to displayName, so neither is
    // composed from the parts.
    const user = await provision(h, 'explicit', { givenName: 'Robert', familyName: 'Smith' }, 'Bob B');
    await patchUser(h, user, [...ENTRA_PARTS]);
    expect(await readName(h, user)).toEqual({
      displayName: 'Bob B',
      formatted: 'Bob B',
      givenName: 'Entra',
      familyName: 'Style',
      userName: 'Bob B',
    });
  });

  it('(b) CONTROL: an explicit name.formatted survives a part change, and so does the displayName derived from it', async () => {
    const h = await boot();
    const user = await provision(h, 'formatted', {
      givenName: 'Robert',
      familyName: 'Smith',
      formatted: 'Dr. Robert Smith',
    });
    await patchUser(h, user, [...OKTA_PARTS]);
    expect(await readName(h, user)).toEqual({
      displayName: 'Dr. Robert Smith',
      formatted: 'Dr. Robert Smith',
      givenName: 'Entra',
      familyName: 'Style',
      userName: 'Dr. Robert Smith',
    });
  });

  it('(b) CONTROL: a displayName set by an earlier PATCH survives; only the derived formatted name moves', async () => {
    const h = await boot();
    const user = await provision(h, 'later', { givenName: 'Renamed', familyName: 'InOkta' });
    await patchUser(h, user, [{ op: 'replace', path: 'displayName', value: 'Custom Name' }]);
    await patchUser(h, user, [...ENTRA_PARTS]);
    expect(await readName(h, user)).toEqual({
      displayName: 'Custom Name',
      formatted: 'Entra Style',
      givenName: 'Entra',
      familyName: 'Style',
      userName: 'Custom Name',
    });
  });

  for (const order of ['displayName first', 'displayName last'] as const) {
    it(`(b) CONTROL: a displayName sent with the parts wins (${order})`, async () => {
      const h = await boot();
      const user = await provision(h, `wins-${order.split(' ')[1]}`, { givenName: 'Renamed', familyName: 'InOkta' });
      const displayName = { op: 'replace', path: 'displayName', value: 'Chosen Name' };
      await patchUser(h, user, order === 'displayName first' ? [displayName, ...ENTRA_PARTS] : [...ENTRA_PARTS, displayName]);
      expect(await readName(h, user)).toEqual({
        displayName: 'Chosen Name',
        formatted: 'Entra Style',
        givenName: 'Entra',
        familyName: 'Style',
        userName: 'Chosen Name',
      });
    });
  }
});
