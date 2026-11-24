// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package-declared sharing rule grants in an organization created AFTER the
 * server booted, exactly as in one present at boot — without a restart.
 *
 * ## The defect this pins
 *
 * The per-record rule hooks (`bindRuleHooks`) bind on the objects of the rules
 * the service serves. Under a walled posture a declared rule is served once per
 * organization (ADR-0131 D2), so a kernel that booted with no organization
 * served no declared rule and bound no hook on its object. The middleware that
 * serves a newly created organization (`addDeclaredRuleScope`) added the scope
 * and bound nothing, so a record written in that organization reached no
 * hook: no `sys_record_share` row, and the recipient could not read it until
 * the next boot. That is a fresh environment's first sign-up.
 *
 * The hooks now bind on every object a DECLARATION names, whatever
 * organizations it is served in at the moment of binding; the organization is
 * resolved when a record is evaluated.
 *
 * ## Tenant isolation, both directions
 *
 * Binding on the object is organization-agnostic; evaluation is not. A rule of
 * organization A must never grant on a record of organization B — neither an
 * organization-authored row nor A's projection of the declared rule. The
 * second case pins both, beside the control that proves the organization-A row
 * is live at all.
 *
 * Real stack, ONE boot: an `ObjectKernel` with `ObjectQLPlugin` over
 * better-sqlite3 and `SharingServicePlugin`, under the `isolated` posture —
 * the `tenancy` service the sharing plugin reads, and the engine's posture
 * accessor the security plugin hands it in a deployment, so a rule's criteria
 * sweep runs inside its organization at the driver. Every organization is
 * created after `bootstrap()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { SharingServicePlugin } from './sharing-plugin.js';

const TASK = 'qa_lateorg_task';
const RULE = 'qa_lateorg_task_assignee';
const ORG_A = 'org_lateorg_a';
const ORG_B = 'org_lateorg_b';
const CREATOR_A = 'usr_lateorg_creator_a';
const ASSIGNEE_A = 'usr_lateorg_assignee_a';
const CREATOR_B = 'usr_lateorg_creator_b';
const ASSIGNEE_B = 'usr_lateorg_assignee_b';
/** The recipient of organization A's own authored rule. */
const WATCHER_A = 'usr_lateorg_watcher_a';
const PEOPLE = [CREATOR_A, ASSIGNEE_A, CREATOR_B, ASSIGNEE_B, WATCHER_A];

const SYSTEM = { isSystem: true } as const;
const as = (userId: string, organizationId: string) => ({ userId, tenantId: organizationId, positions: [], permissions: [] });

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

/** The `isolated` posture, read by the sharing plugin and the engine alike. */
function isolatedPosturePlugin(): Plugin {
  return {
    name: 'test.lateorg.posture',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.registerService('tenancy', { posture: 'isolated' });
      ctx.getService<ObjectQL>('objectql').setTenancyPostureProvider(() => 'isolated');
    },
  };
}

/** The identity objects, a private task object, and the package's declared `field` rule on it. */
function packagePlugin(): Plugin {
  return {
    name: 'test.lateorg.package',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.declared-rule-late-organization',
        namespace: 'qa_lateorg',
        version: '1.0.0',
        type: 'plugin',
        name: 'Declared rule, late organization',
        objects: [
          SysUser,
          SysMember,
          SysOrganization,
          {
            name: TASK,
            label: 'Task',
            sharingModel: 'private',
            fields: {
              title: { type: 'text', label: 'Title' },
              owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
              assignee_id: { type: 'lookup', reference: 'sys_user', label: 'Assignee' },
              // The tenant column: the wall and a rule's criteria sweep scope by it.
              organization_id: { type: 'lookup', reference: 'sys_organization', label: 'Organization' },
            },
          },
        ],
        sharingRules: [
          {
            name: RULE,
            label: 'Task assignee',
            object: TASK,
            type: 'criteria',
            condition: 'record.assignee_id != null',
            sharedWith: { type: 'field', value: 'assignee_id' },
            accessLevel: 'edit',
          },
        ],
      });
    },
  };
}

type Grant = { record_id: string; recipient_id: string; access_level: string; source: string; source_id: string; organization_id?: string | null };

describe('a declared sharing rule grants in an organization created after boot (one boot, walled posture)', () => {
  let kernel: ObjectKernel | undefined;
  let ql: ObjectQL;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as never);
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(isolatedPosturePlugin());
    await kernel.use(packagePlugin());
    await kernel.use(new SharingServicePlugin({ registerShareLinkRoutes: false }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    for (const userId of PEOPLE) {
      await ql.insert('sys_user', { id: userId, name: userId, email: `${userId}@lateorg.test`, email_verified: true }, { context: SYSTEM } as never);
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  /** Every rule grant on one record, read unscoped. */
  const grantsOn = async (recordId: string): Promise<Grant[]> =>
    (await ql.find('sys_record_share', { where: { object_name: TASK, record_id: recordId }, context: SYSTEM } as never)) as Grant[];
  const readAs = async (userId: string, organizationId: string, id: string) =>
    (await ql.findOne(TASK, { where: { id }, context: as(userId, organizationId) } as never)) as Record<string, unknown> | null;
  const createOrganization = async (id: string) => {
    await ql.insert('sys_organization', { id, name: id, slug: id.replace(/_/g, '-') }, { context: SYSTEM } as never);
  };
  const createTask = async (id: string, organizationId: string, creator: string, assignee: string, title = `task ${id}`) => {
    await ql.insert(TASK, { id, title, assignee_id: assignee }, { context: as(creator, organizationId) } as never);
    // The record is stamped with its organization, so the isolation below is about organizations at all.
    const stored = (await ql.find(TASK, { where: { id }, context: SYSTEM } as never)) as Array<Record<string, unknown>>;
    expect(stored[0]?.organization_id).toBe(organizationId);
    return id;
  };

  it('grants the assignee edit on a record of the first organization, created after bootstrap, with no rule write and no restart', async () => {
    await createOrganization(ORG_A);
    const id = await createTask('task_lateorg_a1', ORG_A, CREATOR_A, ASSIGNEE_A);

    expect(await grantsOn(id)).toEqual([
      expect.objectContaining({ recipient_id: ASSIGNEE_A, access_level: 'edit', source: 'rule', source_id: RULE }),
    ]);
    expect(await readAs(ASSIGNEE_A, ORG_A, id)).toMatchObject({ id, assignee_id: ASSIGNEE_A });
    // Under-grant fixed, no over-grant: a member the rule does not name still reads nothing.
    expect(await readAs(WATCHER_A, ORG_A, id)).toBeNull();
  });

  it('keeps every grant inside its own organization: organization A\'s rules grant nothing on organization B\'s records', async () => {
    await createOrganization(ORG_B);
    // Organization A authors a rule of its own on the same object.
    await ql.insert('sys_sharing_rule', {
      name: 'qa_lateorg_a_shared_to_watcher',
      label: 'Shared tasks to the watcher',
      object_name: TASK,
      criteria_json: JSON.stringify({ title: 'shared' }),
      recipient_type: 'user',
      recipient_id: WATCHER_A,
      access_level: 'read',
      active: true,
      organization_id: ORG_A,
    }, { context: { isSystem: true, tenantId: ORG_A } } as never);

    // Control: the organization-A row is live on organization A's records.
    const inA = await createTask('task_lateorg_a2', ORG_A, CREATOR_A, ASSIGNEE_A, 'shared');
    expect((await grantsOn(inA)).map((g) => g.recipient_id).sort()).toEqual([ASSIGNEE_A, WATCHER_A].sort());

    // Organization B's record matches A's criteria and names an assignee.
    const inB = await createTask('task_lateorg_b1', ORG_B, CREATOR_B, ASSIGNEE_B, 'shared');
    const grants = await grantsOn(inB);
    // One grant: B's projection of the declared rule. Neither A's authored row
    // nor A's projection of the declared rule wrote one here.
    expect(grants).toEqual([
      expect.objectContaining({ recipient_id: ASSIGNEE_B, access_level: 'edit', source: 'rule', source_id: RULE }),
    ]);
    expect(grants[0]?.organization_id).toBe(ORG_B);
    expect(await readAs(ASSIGNEE_B, ORG_B, inB)).toMatchObject({ id: inB });
    expect(await readAs(WATCHER_A, ORG_A, inB)).toBeNull();
  });
});
