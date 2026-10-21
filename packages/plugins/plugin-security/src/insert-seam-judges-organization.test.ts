// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24822] Step 3.7 declares, on an insert's stored-image seam, that the seam
 * judges the insert's organization (`judgesOrganization`), and it declares
 * that nowhere else.
 *
 * ## Why the member exists
 *
 * The engine's static-`readonly` strip took a caller's explicit
 * `organization_id` (the platform's tenant column declares `readonly: true`)
 * after the Layer 0 wall had admitted it, and the driver stamped the active
 * organization in its place: a 2xx, with the row in another organization than
 * the one the caller named and the wall admitted. The engine cannot tell on
 * its own where the wall judged the column. The seam it holds
 * (`OperationContext.postHookWriteImageCheck`) is also installed by a business
 * `check` alone, and by a platform operator who crosses the wall. So the wall
 * says so, on the seam, and the engine reads that member and nothing else.
 *
 * ## What this file pins
 *
 * Real `ObjectQL` (source), real `SqlDriver`, real `SecurityPlugin`; an
 * innermost probe middleware reads the seam once every other middleware ran.
 *
 * - SET: a walled insert, under `isolated` and `group`, alone or composed with
 *   a business `check`. The value is then stored as sent. With no
 *   organizations runtime in this composition, an absent value is the
 *   driver's stamp, as before.
 * - UNSET: the seam a business `check` installs under `single`, where no wall
 *   exists; a platform operator's seam that crosses the wall with no active
 *   organization (#24821); and an update's seam, whose organization this
 *   member is not about.
 * - NO SEAM: a platform operator crossing on a private object with an active
 *   organization, and a system context.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const OWN_ORG = 'org_a';
const SISTER_ORG = 'org_c';

const FIELDS = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
};

const OBJECTS = [
  { name: 'qa_account', label: 'Account', fields: FIELDS },
  { name: 'qa_checked', label: 'Checked', fields: FIELDS },
  { name: 'qa_vault', label: 'Vault', access: { default: 'private' }, fields: FIELDS },
];

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  rowLevelSecurity: [
    {
      name: 'checked_not_forbidden',
      object: 'qa_checked',
      operation: 'all',
      using: "record.name != 'forbidden'",
      check: "record.name != 'forbidden'",
    },
  ],
} as unknown as PermissionSet;

const PLATFORM_ADMIN: PermissionSet = {
  name: 'admin_full_access',
  label: 'Platform Administrator',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
  },
  systemPermissions: ['manage_platform_settings', 'manage_metadata'],
} as unknown as PermissionSet;

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: OWN_ORG };
const MEMBER_CTX = { userId: 'usr_a', tenantId: OWN_ORG, positions: [], permissions: [], posture: 'MEMBER' };
const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };
const ADMIN_CTX = { userId: 'usr_admin', tenantId: OWN_ORG, positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };
const ADMIN_NO_ORG_CTX = { userId: 'usr_admin', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN' };

type Posture = 'isolated' | 'group' | 'single';

interface Sighting { operation: string; installed: boolean; judgesOrganization: unknown }

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: Posture) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.insert-seam-judges-organization',
    name: 'The insert seam declares the organization judged',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER, PLATFORM_ADMIN],
    },
  };
  if (posture !== 'single') {
    services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
    services.tenancy = { posture };
  }
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  // Registered LAST, so it runs innermost and reads the seam as installed.
  const sightings: Sighting[] = [];
  engine.registerMiddleware((async (
    opCtx: { operation: string; postHookWriteImageCheck?: { judgesOrganization?: unknown } },
    next: () => Promise<void>,
  ) => {
    if (opCtx.operation === 'insert' || opCtx.operation === 'update') {
      sightings.push({
        operation: opCtx.operation,
        installed: opCtx.postHookWriteImageCheck !== undefined,
        judgesOrganization: opCtx.postHookWriteImageCheck?.judgesOrganization,
      });
    }
    await next();
  }) as never);

  await engine.insert('qa_account', { id: 'r1', name: 'one', organization_id: OWN_ORG }, { context: SYS_CTX } as never);
  sightings.length = 0;

  const table = async (name: string) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(name);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(name).select('id', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { engine, sightings, table };
}

interface Outcome { ok: boolean; code?: string; status?: number; message?: string }
const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status, message: String(err.message ?? e) };
  }
};

const JUDGED = { operation: 'insert', installed: true, judgesOrganization: true };

describe('[#24822] step 3.7 declares the insert\'s organization judged only where the wall\'s parts are composed in', () => {
  it('`isolated` member insert on a walled object: SET, and the active organization it names is stored as sent', async () => {
    const b = await boot('isolated');

    const outcome = await attempt(() => b.engine.insert('qa_account', { id: 'r2', name: 'two', organization_id: OWN_ORG }, { context: MEMBER_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([JUDGED]);
    expect(await b.table('qa_account')).toEqual([
      { id: 'r1', organization_id: OWN_ORG },
      { id: 'r2', organization_id: OWN_ORG },
    ]);
  });

  it('`group` member insert naming a sister organization: SET, and the row is stored there, single and array', async () => {
    const b = await boot('group');

    const single = await attempt(() => b.engine.insert('qa_account', { id: 'r2', name: 'two', organization_id: SISTER_ORG }, { context: GROUP_CTX } as never));
    const bulk = await attempt(() => b.engine.insert('qa_account', [{ id: 'r3', name: 'three', organization_id: SISTER_ORG }], { context: GROUP_CTX } as never));

    expect(single.ok, single.message).toBe(true);
    expect(bulk.ok, bulk.message).toBe(true);
    expect(b.sightings).toEqual([JUDGED, JUDGED]);
    expect(await b.table('qa_account')).toEqual([
      { id: 'r1', organization_id: OWN_ORG },
      { id: 'r2', organization_id: SISTER_ORG },
      { id: 'r3', organization_id: SISTER_ORG },
    ]);
  });

  it('a walled insert under a business `check`: the composed seam carries the member, and the check still runs', async () => {
    const b = await boot('isolated');

    const admitted = await attempt(() => b.engine.insert('qa_checked', { id: 'r2', name: 'fine', organization_id: OWN_ORG }, { context: MEMBER_CTX } as never));
    const refused = await attempt(() => b.engine.insert('qa_checked', { id: 'r3', name: 'forbidden', organization_id: OWN_ORG }, { context: MEMBER_CTX } as never));

    expect(admitted.ok, admitted.message).toBe(true);
    expect(refused.ok, 'the business check still refuses its own row').toBe(false);
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(refused.status).toBe(403);
    expect(b.sightings).toEqual([JUDGED, JUDGED]);
    expect(await b.table('qa_checked')).toEqual([{ id: 'r2', organization_id: OWN_ORG }]);
  });

  it('`single` with a business `check`: the seam is installed and the member is UNSET, because no wall exists to judge the organization', async () => {
    const b = await boot('single');

    const outcome = await attempt(() => b.engine.insert('qa_checked', { id: 'r2', name: 'fine', organization_id: SISTER_ORG }, { context: MEMBER_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([{ operation: 'insert', installed: true, judgesOrganization: undefined }]);
    expect(await b.table('qa_checked'), 'taken by the strip, and the context\'s organization stamped').toEqual([
      { id: 'r2', organization_id: OWN_ORG },
    ]);
  });

  it('a platform operator crossing on a private object with NO active organization: its seam is installed with the member UNSET, and the insert is refused', async () => {
    const b = await boot('isolated');

    const outcome = await attempt(() => b.engine.insert('qa_vault', { id: 'r2', name: 'two', organization_id: SISTER_ORG }, { context: ADMIN_NO_ORG_CTX } as never));

    expect(b.sightings).toEqual([{ operation: 'insert', installed: true, judgesOrganization: undefined }]);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('PERMISSION_DENIED');
    expect(outcome.status).toBe(403);
    expect(outcome.message).toContain('has no active organization');
    expect(await b.table('qa_vault')).toEqual([]);
  });

  it('a platform operator crossing on a private object with an active organization: no seam at all, and the value is taken', async () => {
    const b = await boot('isolated');

    const outcome = await attempt(() => b.engine.insert('qa_vault', { id: 'r2', name: 'two', organization_id: SISTER_ORG }, { context: ADMIN_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([{ operation: 'insert', installed: false, judgesOrganization: undefined }]);
    expect(await b.table('qa_vault')).toEqual([{ id: 'r2', organization_id: OWN_ORG }]);
  });

  it('an update\'s seam does not carry the member: it declares an INSERT\'s organization only', async () => {
    const b = await boot('isolated');

    const outcome = await attempt(() => b.engine.update('qa_account', { id: 'r1', name: 'renamed' } as never, { context: MEMBER_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([{ operation: 'update', installed: true, judgesOrganization: undefined }]);
  });

  it('a system context installs no seam', async () => {
    const b = await boot('group');

    const outcome = await attempt(() => b.engine.insert('qa_account', { id: 'r2', name: 'two', organization_id: SISTER_ORG }, { context: SYS_CTX } as never));

    expect(outcome.ok, outcome.message).toBe(true);
    expect(b.sightings).toEqual([{ operation: 'insert', installed: false, judgesOrganization: undefined }]);
  });
});
