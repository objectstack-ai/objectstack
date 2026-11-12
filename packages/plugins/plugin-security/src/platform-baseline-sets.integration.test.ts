// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform baseline seam on a real stack: a platform service registers an
 * object, contributes a read-and-create set for it from its `kernel:ready`
 * handler, and the REAL `SecurityPlugin` hands that set to every member — and
 * to no one else.
 *
 *  - the REAL `SecurityPlugin` with the shipped permission sets and an app set
 *    that names nothing of the service's;
 *  - the REAL caller resolution (`resolveAuthzContext`, then
 *    `assembleExecutionContext`), so a member's `everyone` anchor and an
 *    external's lack of it are the resolver's answer;
 *  - the contributor registered AFTER the security plugin, so its set lands
 *    after the anchor's `kernel:ready` derivation and the anchor's definition
 *    names it only through the derivation owed at `kernel:bootstrapped`.
 *
 * What it pins: a member reads and creates the contributed object and nothing
 * more; the explainer names the set as the baseline that grants it; the
 * `everyone` definition names it; an external member and an agent principal
 * gain nothing; a contribution naming another package's object is refused on
 * the real registry; the window is closed once the kernel has bootstrapped;
 * and a deployment declaring no member baseline hands the set to no one.
 * Each refusal rule on its own: `platform-baseline-sets.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, resolveAuthzContext, assembleExecutionContext, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ISecurityService, PlatformBaselineSetContribution } from '@objectstack/spec/contracts';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

/** The platform service's package id, and the object it registers. */
/** The members this suite drives, each one the plugin serves. */
type SecurityService = Required<Pick<ISecurityService, 'explain' | 'resolvePermissionSetsForContext' | 'contributePlatformBaselineSet'>>;

const SERVICE = 'com.example.service.notes';
const NOTE = 'pbs_note';
/** An object another package registers. */
const LEDGER = 'pbs_ledger';
const ORG = 'org_pbs';
const ALICE = 'usr_pbs_alice';
const EVE = 'usr_pbs_eve';
const SYS = { isSystem: true, tenantId: ORG } as const;

const SERVICE_SET = {
  name: 'pbs_notes_member',
  label: 'Notes (every member)',
  objects: { [NOTE]: { allowRead: true, allowCreate: true } },
};

/** The app's member set: its own object only. */
const APP_SET = PermissionSetSchema.parse({
  name: 'pbs_app_member',
  objects: { [LEDGER]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
});

type Ctx = Record<string, unknown>;
type Outcome = { joined: boolean } | { refused: string };

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.pbs.driver',
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

const textObject = (name: string) => ({ name, label: name, fields: { name: { type: 'text', label: 'Name' } } });

/** The identity objects and the other package's object. */
function appPlugin(): Plugin {
  return {
    name: 'test.pbs.app',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.pbs.app',
        version: '1.0.0',
        type: 'plugin',
        name: 'Platform baseline app',
        objects: [SysUser, SysMember, SysOrganization, textObject(LEDGER)],
      });
    },
  };
}

/**
 * The platform service: registers its object, and contributes from its
 * `kernel:ready` handler — first a set naming the app's object, which the seam
 * refuses, then its own set.
 */
function servicePlugin(outcomes: Record<string, Outcome>): Plugin {
  return {
    name: SERVICE,
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: SERVICE,
        version: '1.0.0',
        type: 'plugin',
        name: 'Notes service',
        objects: [textObject(NOTE)],
      });
    },
    async start(ctx: PluginContext) {
      ctx.hook('kernel:ready', async () => {
        const security = ctx.getService<SecurityService>('security');
        const attempt = (set: unknown): Outcome => {
          try {
            return { joined: security.contributePlatformBaselineSet(SERVICE, set as PlatformBaselineSetContribution).joined };
          } catch (e) {
            return { refused: (e as Error).message };
          }
        };
        outcomes.others = attempt({ name: 'pbs_ledger_member', objects: { [LEDGER]: { allowRead: true } } });
        outcomes.own = attempt(SERVICE_SET);
      });
    },
  };
}

async function boot(fallbackPermissionSet: string | null, outcomes: Record<string, Outcome>): Promise<ObjectKernel> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(sqliteDriverPlugin());
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(appPlugin());
  await kernel.use(new SecurityPlugin({ defaultPermissionSets: [...defaultPermissionSets, APP_SET], fallbackPermissionSet }));
  await kernel.use(servicePlugin(outcomes));
  await kernel.bootstrap();
  return kernel;
}

/** The wire answer a refused engine call maps to, as the data door sends it. */
async function refusal(run: () => Promise<unknown>, object: string): Promise<{ status: number; code: string } | 'admitted'> {
  try {
    await run();
  } catch (e) {
    const wire = mapDataError(e, object);
    return { status: wire.status, code: String(wire.body.code) };
  }
  return 'admitted';
}

async function seedPeople(ql: ObjectQL): Promise<void> {
  await ql.insert('sys_organization', { id: ORG, name: 'Notes Co', slug: 'notes-co' }, { context: SYS } as never);
  for (const [userId, role] of [[ALICE, 'member'], [EVE, 'external']] as const) {
    await ql.insert('sys_user', { id: userId, name: userId, email: `${userId}@notes.test`, email_verified: true }, { context: SYS } as never);
    await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role }, { context: SYS } as never);
  }
  await ql.insert(NOTE, { name: 'seeded note' }, { context: SYS } as never);
}

async function contextOf(ql: ObjectQL, userId: string): Promise<Ctx> {
  const authz = await resolveAuthzContext({
    ql,
    headers: {},
    getSession: async () => ({ user: { id: userId }, session: { id: `ses_${userId}`, userId, activeOrganizationId: ORG } }),
  } as never);
  return assembleExecutionContext({
    authz,
    oauth: undefined,
    localization: undefined,
    requestLocale: undefined,
    accessToken: undefined,
  } as never) as unknown as Ctx;
}

describe('a platform service’s baseline set reaches every member, and no one else', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let security: SecurityService;
  const outcomes: Record<string, Outcome> = {};
  const as: Record<string, Ctx> = {};

  beforeAll(async () => {
    kernel = await boot(APP_SET.name, outcomes);
    ql = kernel.getService<ObjectQL>('objectql');
    security = kernel.getService<SecurityService>('security');
    await seedPeople(ql);
    as.alice = await contextOf(ql, ALICE);
    as.eve = await contextOf(ql, EVE);
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('the fixture is armed: the service’s own set joined, and the resolver gives a member the everyone anchor and an external none', () => {
    expect(outcomes.own).toEqual({ joined: true });
    expect(as.alice.positions).toEqual(expect.arrayContaining(['org_member', 'everyone']));
    expect(as.eve.positions).toContain('org_external');
    expect(as.eve.positions).not.toContain('everyone');
  });

  it('a member reads and creates the service’s object, and edits and deletes nothing of it', async () => {
    const rows = (await ql.find(NOTE, { context: as.alice } as never)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.name)).toContain('seeded note');
    const created = (await ql.insert(NOTE, { name: 'alice wrote this' }, { context: as.alice } as never)) as { id: string };
    expect(created.id).toBeTruthy();
    expect(await refusal(() => ql.update(NOTE, { name: 'renamed' }, { where: { id: created.id }, context: as.alice } as never), NOTE))
      .toMatchObject({ status: 403 });
    expect(await refusal(() => ql.delete(NOTE, { where: { id: created.id }, context: as.alice } as never), NOTE))
      .toMatchObject({ status: 403 });
  });

  it('the explainer names the service’s set as the baseline that grants it', async () => {
    const decision = await security.explain({ object: NOTE, operation: 'create' }, as.alice);
    expect(decision.allowed).toBe(true);
    expect(decision.principal.permissionSets).toContain(SERVICE_SET.name);
    const contributors = decision.layers.flatMap((l: any) => l.contributors ?? []);
    expect(contributors).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'permission_set', name: SERVICE_SET.name, via: 'additive baseline (ADR-0090 D5)' })]),
    );
  });

  it('the everyone anchor’s definition names it, though it landed after the kernel:ready derivation', () => {
    const everyone = (ql as any).registry.getItem('position', 'everyone');
    expect(everyone?.permissionSets).toEqual([APP_SET.name, 'member_default', SERVICE_SET.name]);
  });

  it('the set is held in the catalog by the service’s own package', () => {
    const item = (ql as any).registry.getItem('permission', SERVICE_SET.name);
    expect(item?._packageId).toBe(SERVICE);
  });

  it('an external member gains nothing: the read and the create are both refused', async () => {
    expect(await refusal(() => ql.find(NOTE, { context: as.eve } as never), NOTE)).toMatchObject({ status: 403 });
    expect(await refusal(() => ql.insert(NOTE, { name: 'eve' }, { context: as.eve } as never), NOTE)).toMatchObject({ status: 403 });
    const decision = await security.explain({ object: NOTE, operation: 'read' }, as.eve);
    expect(decision.allowed).toBe(false);
    expect(decision.principal.permissionSets).not.toContain(SERVICE_SET.name);
  });

  it('an agent principal gains nothing: it resolves no human baseline', async () => {
    const agent = { userId: ALICE, tenantId: ORG, positions: [], permissions: [], principalKind: 'agent' as const };
    const sets = await security.resolvePermissionSetsForContext(agent);
    expect(sets.map((s: { name: string }) => s.name)).not.toContain(SERVICE_SET.name);
    expect(await refusal(() => ql.find(NOTE, { context: agent } as never), NOTE)).toMatchObject({ status: 403 });
  });

  it('a set naming another package’s object is refused on the real registry, and grants nothing', async () => {
    expect(outcomes.others).toEqual({ refused: expect.stringContaining(`'${LEDGER}' is registered by 'test.pbs.app', not by '${SERVICE}'`) });
    expect((ql as any).registry.getItem('permission', 'pbs_ledger_member')).toBeUndefined();
  });

  it('the boot window is closed once the kernel has bootstrapped', () => {
    expect(() => security.contributePlatformBaselineSet(SERVICE, SERVICE_SET)).toThrow(/boot window is closed/);
  });
});

describe('a deployment that declares no member baseline (fallbackPermissionSet: null)', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  const outcomes: Record<string, Outcome> = {};

  beforeAll(async () => {
    kernel = await boot(null, outcomes);
    ql = kernel.getService<ObjectQL>('objectql');
    await seedPeople(ql);
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('hands the set to no one: it is admitted, joins nothing, and a member is refused', async () => {
    expect(outcomes.own).toEqual({ joined: false });
    const alice = await contextOf(ql, ALICE);
    expect(await refusal(() => ql.find(NOTE, { context: alice } as never), NOTE)).toMatchObject({ status: 403 });
    expect(kernel.getService<string[]>('security.baselinePermissionSets')).toEqual([]);
  });
});
