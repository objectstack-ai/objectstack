// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declared narrowing of the sharing write gate, with plugin-security composed in.
 *
 * Under `multi: true`, a scalar `where.id` beside another `where` key is a write
 * the engine runs as a predicate. The sharing write gate judges it by the bulk
 * write scope, as it judges every predicate write, and not by id.
 *
 * Two answers are pinned on the same row, side by side:
 *
 *  - the narrowed answer: a row the caller may write only because an
 *    application row-level policy widens the sharing scope for it is not
 *    written by that shape, and the write answers no error;
 *  - the remedy: the same row, addressed by id alone, is judged by id and
 *    written.
 *
 * Real stack: an `ObjectKernel` with `ObjectQLPlugin` over better-sqlite3, the
 * platform permission sets plus an application writer set with a row-level
 * update/delete policy, `SecurityPlugin` and `SharingServicePlugin`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const ORG = 'org_opidc';
const ME = 'usr_opidc_me';
const OTHER = 'usr_opidc_other';
/** Owner-scoped (`private` OWD with an `owner_id`): record sharing enforces on it. */
const DEAL = 'qa_opidc_deal';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } as const;
/** The application's writer set: a row-level policy admits an update or delete of any `open` deal. */
const WRITER = PermissionSetSchema.parse({
  name: 'qa_opidc_writer',
  objects: { [DEAL]: CRUD },
  rowLevelSecurity: [
    { name: 'qa_opidc_open_updates', object: DEAL, operation: 'update', using: "stage == 'open'" },
    { name: 'qa_opidc_open_deletes', object: DEAL, operation: 'delete', using: "stage == 'open'" },
  ],
});

const SYSTEM = { isSystem: true, tenantId: ORG } as const;
const SYS = { context: SYSTEM } as never;
const asCaller = () => ({ userId: ME, tenantId: ORG, positions: [], permissions: [WRITER.name] });

type Outcome = { kind: 'landed' } | { kind: 'refused'; code?: string; status?: number };
const outcomeOf = (p: Promise<unknown>): Promise<Outcome> =>
  p.then(
    () => ({ kind: 'landed' as const }),
    (e: { code?: unknown; status?: unknown; statusCode?: unknown } | null) => {
      const status = e?.statusCode ?? e?.status;
      return {
        kind: 'refused' as const,
        code: e?.code == null ? undefined : String(e.code),
        status: status == null ? undefined : Number(status),
      };
    },
  );

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

function objectsPlugin(): Plugin {
  return {
    name: 'test.objects',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.operator-id-write-gate-composed',
        namespace: 'qa_opidc',
        version: '1.0.0',
        type: 'plugin',
        name: 'Operator id write gate, composed',
        objects: [
          SysUser, SysMember, SysOrganization,
          {
            name: DEAL,
            label: 'Deal',
            sharingModel: 'private',
            fields: {
              name: { type: 'text', label: 'Name' },
              stage: { type: 'text', label: 'Stage' },
              owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
            },
          },
        ],
      });
    },
  };
}

describe('sharing write gate with plugin-security: a scalar id beside another key under multi meets the bulk scope; by id alone it is judged by id', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as never);
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(objectsPlugin());
    await kernel.use(new SecurityPlugin({
      defaultPermissionSets: [...defaultPermissionSets, WRITER],
      fallbackPermissionSet: 'member_default',
    }));
    await kernel.use(new SharingServicePlugin({ registerShareLinkRoutes: false }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');

    await ql.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme' }, SYS);
    for (const userId of [ME, OTHER]) {
      await ql.insert('sys_user', { id: userId, name: userId, email: `${userId}@acme.test`, email_verified: true }, SYS);
      await ql.insert('sys_member', { user_id: userId, organization_id: ORG, role: 'member' }, SYS);
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  const stored = async (id: string) =>
    ((await ql.find(DEAL, { where: { id }, context: SYSTEM } as never)) as Array<{ name?: string }>)[0] ?? null;

  /**
   * Another member's `open` deal, shared to the caller for reading only. Record
   * sharing does not let the caller write it; the application's row-level
   * policy does.
   */
  const seedPolicyAdmittedRow = async (id: string) => {
    await ql.insert(DEAL, { id, owner_id: OTHER, created_by: OTHER, stage: 'open', name: 'seed' }, SYS);
    await ql.insert('sys_record_share', {
      object_name: DEAL, record_id: id, recipient_type: 'user', recipient_id: ME,
      access_level: 'read', source: 'manual',
    }, SYS);
    expect(await ql.findOne(DEAL, { where: { id }, context: asCaller() } as never)).toMatchObject({ id });
  };

  it('update: the two-key predicate answers no error and leaves the row; the same row by id alone is written', async () => {
    await seedPolicyAdmittedRow('u_1');

    const narrowed = await outcomeOf(
      ql.update(DEAL, { name: 'by_predicate' }, { where: { id: 'u_1', stage: 'open' }, multi: true, context: asCaller() } as never),
    );
    expect(narrowed).toEqual({ kind: 'landed' });
    expect(await stored('u_1')).toMatchObject({ name: 'seed' });

    const byId = await outcomeOf(ql.update(DEAL, { name: 'by_id' }, { where: { id: 'u_1' }, context: asCaller() } as never));
    expect(byId).toEqual({ kind: 'landed' });
    expect(await stored('u_1')).toMatchObject({ name: 'by_id' });
  });

  it('delete: the two-key predicate answers no error and leaves the row; the same row by id alone is deleted', async () => {
    await seedPolicyAdmittedRow('d_1');

    const narrowed = await outcomeOf(
      ql.delete(DEAL, { where: { id: 'd_1', stage: 'open' }, multi: true, context: asCaller() } as never),
    );
    expect(narrowed).toEqual({ kind: 'landed' });
    expect(await stored('d_1')).not.toBeNull();

    const byId = await outcomeOf(ql.delete(DEAL, { where: { id: 'd_1' }, context: asCaller() } as never));
    expect(byId).toEqual({ kind: 'landed' });
    expect(await stored('d_1')).toBeNull();
  });
});
