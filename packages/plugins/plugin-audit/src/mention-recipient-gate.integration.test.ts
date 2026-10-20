// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `collab.mention` notification reaches a mentioned user only when that user
 * can READ the record the comment is about (`mention-recipient-gate.ts`).
 *
 * ## What is real
 *
 * The kernel, ObjectQL, a real SQLite driver, `AuditPlugin` (its comment write
 * gates and its mention writer, wired with the real recipient gate), the
 * identity rows (`sys_user`, `sys_member` — the platform's own object
 * definitions) and the grant resolution over them (`resolveUserAuthzGrants`,
 * `vetOrganizationClaim`, `resolveReadableParentIds` from `@objectstack/core`).
 * Every comment is inserted through the engine as its author, so the comment
 * write gates run and the mention writer fires from the real `afterInsert`.
 *
 * ## The two stand-ins
 *
 * - plugin-security's read enforcement on the record object, played by ONE
 *   engine middleware: the ADR-0093 tenant wall (`isolated`: the caller's
 *   active organization; `group`: any organization the caller is a member of;
 *   no organization under a wall: nothing) and an owner-only rule for a
 *   `confidential` row standing in for record sharing. The real pair is
 *   plugin-security's to pin; what is pinned HERE is that the gate asks the
 *   read in the mentioned user's own envelope, with their organization claim
 *   vetted — the stand-in admits whatever envelope it is handed.
 * - the `messaging` service, played by a recorder of `emit()` calls (the
 *   inbox materialisation is service-messaging's to pin).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysMember, SysUser } from '@objectstack/platform-objects/identity';

import { AuditPlugin } from './audit-plugin.js';
import { admitMentionRecipients } from './mention-recipient-gate.js';

const TASK = 'mrg_task';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.mention-gate';
const SYS = { isSystem: true } as const;

const ORG_A = 'org_a';
const ORG_B = 'org_b';
/** The author: a member of ORG_A. */
const ALICE = { id: 'u_alice', email: 'alice@a.test' };
/** A fellow member of ORG_A, who reads every non-confidential task there. */
const CAROL = { id: 'u_carol', email: 'carol@a.test' };
/** A member of ORG_B only. */
const BOB = { id: 'u_bob', email: 'bob@b.test' };

type Posture = 'single' | 'isolated' | 'group';
const tenancy: { posture: Posture } = { posture: 'isolated' };

const READ_OPS = new Set(['find', 'findOne', 'count']);

/** plugin-security's read enforcement on TASK, as the module header sets out. */
function admits(row: Record<string, any>, context: any): boolean {
  if (tenancy.posture === 'isolated' && row.organization_id !== context.tenantId) return false;
  if (tenancy.posture === 'group' && !(context.accessible_org_ids ?? []).includes(row.organization_id)) return false;
  if (row.confidential && row.owner_id !== context.userId) return false;
  return true;
}

const emits: Array<Record<string, any>> = [];

function standIns(): Plugin {
  return {
    name: 'test.mention-gate-stand-ins',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService('tenancy', {
        get posture() {
          return tenancy.posture;
        },
        defaultOrgId: async () => ORG_A,
      });
      ctx.registerService('messaging', {
        emit: async (event: Record<string, any>) => {
          emits.push(event);
          return {};
        },
      });
    },
  };
}

const authorContext = () => ({
  userId: ALICE.id,
  tenantId: ORG_A,
  positions: ['org_member'],
  permissions: [],
  accessible_org_ids: [ORG_A],
});

describe('@mention notifications reach only mentioned users who can read the record', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let openTask: string;
  let confidentialTask: string;
  let seq = 0;

  /** Post a comment on `taskId` as ALICE, mentioning `mentions`; the mention emits it produced. */
  const comment = async (taskId: string, mentions: unknown[]) => {
    emits.length = 0;
    seq += 1;
    await engine.insert(
      'sys_comment',
      { thread_id: `${TASK}:${taskId}`, body: `note ${seq}`, mentions: JSON.stringify(mentions) },
      { context: authorContext() } as any,
    );
    return emits.filter((e) => e.topic === 'collab.mention');
  };
  const audiences = (events: Array<Record<string, any>>) => events.map((e) => e.audience);

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(standIns());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(SysUser as any, HARNESS_PACKAGE);
    engine.registry.registerObject(SysMember as any, HARNESS_PACKAGE);
    engine.registry.registerObject(
      {
        name: TASK,
        label: 'Task',
        fields: {
          name: { name: 'name', label: 'Name', type: 'text' },
          organization_id: { name: 'organization_id', label: 'Organization', type: 'text' },
          owner_id: { name: 'owner_id', label: 'Owner', type: 'text' },
          confidential: { name: 'confidential', label: 'Confidential', type: 'boolean' },
        },
      } as any,
      HARNESS_PACKAGE,
    );
    await engine.syncSchemas();

    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      await next();
      if (!READ_OPS.has(op.operation) || !op.context || op.context.isSystem) return;
      if (op.operation === 'count') return;
      if (Array.isArray(op.result)) op.result = op.result.filter((r: any) => admits(r, op.context));
      else if (op.result && !admits(op.result, op.context)) op.result = null;
    }, { object: TASK });

    for (const u of [ALICE, CAROL, BOB]) {
      await engine.insert('sys_user', { id: u.id, name: u.id, email: u.email }, { context: SYS } as any);
    }
    for (const [user, org] of [[ALICE, ORG_A], [CAROL, ORG_A], [BOB, ORG_B]] as const) {
      await engine.insert('sys_member', { user_id: user.id, organization_id: org, role: 'member' }, { context: SYS } as any);
    }
    openTask = (await engine.insert(TASK, { name: 'open', organization_id: ORG_A, owner_id: ALICE.id }, { context: SYS } as any)).id;
    confidentialTask = (
      await engine.insert(TASK, { name: 'confidential', organization_id: ORG_A, owner_id: ALICE.id, confidential: true }, { context: SYS } as any)
    ).id;
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  beforeEach(() => {
    tenancy.posture = 'isolated';
  });

  describe('isolated', () => {
    it('control: the other organization\'s user cannot read the record, the fellow member can', async () => {
      const asBob = await engine.find(TASK, { where: { id: openTask }, context: { userId: BOB.id, tenantId: ORG_B } } as any);
      const asCarol = await engine.find(TASK, { where: { id: openTask }, context: { userId: CAROL.id, tenantId: ORG_A } } as any);
      expect(asBob).toEqual([]);
      expect(asCarol.map((r: any) => r.id)).toEqual([openTask]);
    });

    it('withholds the notification from a user of another organization mentioned by id', async () => {
      expect(audiences(await comment(openTask, [BOB.id]))).toEqual([]);
    });

    it('withholds the notification from a user of another organization mentioned by email', async () => {
      expect(audiences(await comment(openTask, [BOB.email]))).toEqual([]);
    });

    it('notifies a fellow member who can read the record, with the record as the deep link', async () => {
      const events = await comment(openTask, [CAROL.id, BOB.id]);
      expect(audiences(events)).toEqual([[CAROL.id]]);
      expect(events[0]).toMatchObject({
        source: { object: TASK, id: openTask },
        organizationId: ORG_A,
        payload: { body: `note ${seq}` },
      });
    });

    it('resolves a fellow member mentioned by email to their user id', async () => {
      expect(audiences(await comment(openTask, [CAROL.email]))).toEqual([[CAROL.id]]);
    });

    it('never notifies the author, by id or by email', async () => {
      expect(audiences(await comment(openTask, [ALICE.id, ALICE.email]))).toEqual([]);
    });

    it('treats an audience expansion as no mention at all', async () => {
      expect(audiences(await comment(openTask, ['role:member', `team:t1`, `owner_of:${TASK}:${openTask}`]))).toEqual([]);
    });
  });

  describe('group', () => {
    it('withholds from a non-member of the record\'s organization and notifies a member', async () => {
      tenancy.posture = 'group';
      expect(audiences(await comment(openTask, [BOB.id, BOB.email, CAROL.id]))).toEqual([[CAROL.id]]);
    });
  });

  describe('single', () => {
    it('withholds from a fellow member the record\'s own sharing excludes', async () => {
      tenancy.posture = 'single';
      const asCarol = await engine.find(TASK, { where: { id: confidentialTask }, context: { userId: CAROL.id, tenantId: ORG_A } } as any);
      expect(asCarol).toEqual([]);
      expect(audiences(await comment(confidentialTask, [CAROL.id]))).toEqual([]);
      expect(audiences(await comment(openTask, [CAROL.id]))).toEqual([[CAROL.id]]);
    });
  });

  it('logs each withheld recipient with the user id and the reason, never the comment text', async () => {
    const warned: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const admitted = await admitMentionRecipients(
      {
        engine: engine as any,
        getTenancyPosture: () => 'isolated',
        logger: { warn: (message, meta) => warned.push({ message, meta }) },
      },
      { mentions: [BOB.id, CAROL.id, 'nobody@nowhere.test'], threadId: `${TASK}:${openTask}`, actorId: ALICE.id, organizationId: ORG_A, commentId: 'c1' },
    );
    expect(admitted).toEqual([CAROL.id]);
    expect(warned.map((w) => w.meta)).toEqual([
      { reason: 'unknown_email', commentId: 'c1' },
      { reason: 'cannot_read_source', userId: BOB.id, commentId: 'c1' },
    ]);
  });
});
