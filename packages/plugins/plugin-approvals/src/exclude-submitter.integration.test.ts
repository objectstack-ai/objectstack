// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25573] An approval node's `excludeSubmitter: true` keeps the request's
 * submitter from approving it (ruling 6377888641, letter B).
 *
 * ## The defect
 *
 * A two-level admission approval routed step 1 to a `field` approver (the
 * category manager on the record) and step 2 to a `position`. When the
 * category manager submitted the admission themselves, step 1 resolved to the
 * submitter and they approved their own request. The spec carries the step
 * option `excludeSubmitter` (#25609) and refuses it beside
 * `onEmptyApprovers: 'auto_approve'` (#25635, letter A); this is the runtime
 * that honours it.
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), with the real
 * administrator resolution reading a bound security catalog:
 *
 * - the submitter is off the slate on a `field` step and on a `position` step,
 *   and the emptied slate takes the node's `onEmptyApprovers` route (the
 *   administrators by default, the declared `fallbackApprovers`, or the `fail`
 *   refusal), never the submitter;
 * - a slate minus the submitter keeps everyone else, per_group tags included;
 * - the email slot and an out-of-office hop that lands on the submitter are
 *   the submitter too;
 * - the fallback slate and the administrators' slate are screened the same
 *   way, and an organization whose only administrator is the submitter gets
 *   the slate that names no one;
 * - the request records the route on its timeline, as data the approvals door
 *   renders in the reader's language;
 * - after the open: the decision refuses the submitter's approval (the
 *   privileged override included) and keeps their rejection; the reassign door
 *   refuses to hand the slot back to them; an SLA escalation leaves them off;
 * - CONTROLS: the option off leaves every slate, timeline and decision as
 *   before; the option on with a slate that never named the submitter writes
 *   no note.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  bindSecurityCatalogReader, createMemoryI18n, type SecurityCatalogEntry, type SecurityCatalogReader,
} from '@objectstack/core';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { ApprovalsTranslations } from './translations/index.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;

const ORG = 'org_a';
/** An organization whose only administrator is the submitter. */
const SOLO_ORG = 'org_solo';

const as = (userId: string, org: string, permissions: string[] = []) =>
  ({ userId, tenantId: org, positions: [], permissions }) as any;
const SUB = as('u_sub', ORG);
const OWNER = as('u_owner', ORG, ['organization_admin']);

const USERS = ['u_sub', 'u_owner', 'u_admin', 'u_alice', 'u_bob', 'u_fallback', 'u_dir', 'u_away']
  .map((id) => ({ id, name: id, email: `${id}@example.com` }));

const MEMBERS: Array<[string, string, string]> = [
  ['u_sub', ORG, 'member'],
  ['u_owner', ORG, 'owner'],
  ['u_admin', ORG, 'admin'],
  ['u_alice', ORG, 'member'],
  ['u_bob', ORG, 'member'],
  ['u_fallback', ORG, 'member'],
  ['u_dir', ORG, 'member'],
  ['u_away', ORG, 'member'],
  ['u_sub', SOLO_ORG, 'owner'],
];

const GRANTS: Array<[string, string, string]> = [
  ['u_owner', 'organization_admin', ORG],
  ['u_admin', 'organization_admin_no_bypass', ORG],
  ['u_sub', 'organization_admin', SOLO_ORG],
];

/** `sys_user_position`: who holds which position, per organization. */
const POSITIONS: Array<[string, string, string]> = [
  ['u_sub', 'category_manager', ORG],
  ['u_sub', 'buyer', ORG],
  ['u_alice', 'buyer', ORG],
  ['u_dir', 'procurement_director', ORG],
  ['u_sub', 'treasury', ORG],
];

const text = (name: string) => ({ name, label: name, type: 'text' as const });
const objectDef = (name: string, fields: string[]) => ({
  name,
  label: name,
  fields: Object.fromEntries([
    ['id', { ...text('id'), primaryKey: true }],
    ...fields.map((f) => [f, text(f)]),
  ]),
});

function catalogServing(names: string[]): SecurityCatalogReader {
  const entry = (name: string): SecurityCatalogEntry => ({
    type: 'permission', name, definition: { name }, source: 'registry',
  });
  return {
    async resolve(type, name) {
      return type === 'permission' && names.includes(name) ? entry(name) : undefined;
    },
    async list(type) {
      return type === 'permission' ? names.map(entry) : [];
    },
  };
}

async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

const ON = { excludeSubmitter: true };
const FIELD_STEP = [{ type: 'field', value: 'category_manager' }];
const POSITION_STEP = [{ type: 'position', value: 'category_manager' }];

describe('[#25573] excludeSubmitter keeps the submitter from approving their own request', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-24T09:00:00.000Z');

  /** Open a step on a fresh admission whose category manager is `manager`. */
  const open = async (
    key: string, approvers: any[], extra: Record<string, unknown> = {},
    { org = ORG, manager = 'u_sub' }: { org?: string; manager?: string } = {},
  ): Promise<any> => {
    const record = { id: `ADM_${key}`, title: key, category_manager: manager };
    await engine.insert('srm_admission', record, { context: SYSTEM } as any);
    return svc.openNodeRequest({
      object: 'srm_admission', recordId: record.id, runId: `run_${key}`, nodeId: 'category_review',
      flowName: 'admission', config: { approvers, behavior: 'first_response', ...extra } as any,
      submitterId: 'u_sub', record, organizationId: org,
    }, as('u_sub', org));
  };
  const actionsOf = async (requestId: string): Promise<any[]> => engine.find('sys_approval_action', {
    where: { request_id: requestId }, context: SYSTEM,
  });
  const notesOf = async (requestId: string) =>
    (await actionsOf(requestId)).filter((a) => a.action === 'comment' && !a.actor_id).map((a) => a.comment);
  const snapshotOf = async (requestId: string) => {
    const [row]: any[] = await engine.find('sys_approval_request', { where: { id: requestId }, context: SYSTEM });
    return JSON.parse(row.node_config_json);
  };
  const EXCLUDED = "The request's submitter was removed from its approvers because this step sets excludeSubmitter";

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    const defs = [
      objectDef('sys_user', ['name', 'email']),
      objectDef('sys_member', ['user_id', 'organization_id', 'role']),
      objectDef('sys_user_position', ['user_id', 'position', 'organization_id']),
      objectDef('sys_user_permission_set', ['user_id', 'permission_set', 'organization_id']),
      objectDef('srm_admission', ['title', 'category_manager']),
      ...(await packageObjects()),
    ];
    for (const def of defs) engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    await engine.syncSchemas();
    await relaxTenantColumns(engine, ['sys_user', 'srm_admission']);
    bindSecurityCatalogReader(engine, catalogServing(['organization_admin', 'organization_admin_no_bypass']));
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);
    for (const [i, [user_id, organization_id, role]] of MEMBERS.entries()) {
      await engine.insert('sys_member', { id: `m_${i}`, user_id, organization_id, role }, { context: SYSTEM } as any);
    }
    for (const [i, [user_id, permission_set, organization_id]] of GRANTS.entries()) {
      await engine.insert('sys_user_permission_set', { id: `ups_${i}`, user_id, permission_set, organization_id },
        { context: SYSTEM } as any);
    }
    for (const [i, [user_id, position, organization_id]] of POSITIONS.entries()) {
      await engine.insert('sys_user_position', { id: `pos_${i}`, user_id, position, organization_id },
        { context: SYSTEM } as any);
    }
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  describe('at the open', () => {
    it('a field step that resolves to the submitter opens on the administrators, never on the submitter', async () => {
      const row = await open('field', FIELD_STEP, ON);
      expect([...row.pending_approvers].sort()).toEqual(['u_admin', 'u_owner']);
      expect(await notesOf(row.id)).toEqual([
        "Routed to this organization's administrators because the approver slate named no one: the only approver "
          + "it resolved to was the request's submitter, whom excludeSubmitter removes.",
        `${EXCLUDED}; this organization's administrators decide it.`,
      ]);
    });

    it('a position step held only by the submitter opens on the declared fallbackApprovers', async () => {
      const row = await open('position', POSITION_STEP, {
        ...ON, onEmptyApprovers: 'fallback', fallbackApprovers: [{ type: 'user', value: 'u_fallback' }],
      });
      expect(row.pending_approvers).toEqual(['u_fallback']);
      expect(await notesOf(row.id)).toEqual([`${EXCLUDED}; the declared fallbackApprovers decide it.`]);
      expect((await snapshotOf(row.id)).__submitterExclusionNote).toMatchObject({ route: 'fallback' });
    });

    it("onEmptyApprovers: 'fail' refuses, naming the exclusion", async () => {
      await expect(open('fail', FIELD_STEP, { ...ON, onEmptyApprovers: 'fail' })).rejects.toThrow(
        /^NO_APPROVERS: .* other than the request's submitter, whom the node's excludeSubmitter removes, /,
      );
    });

    it('a slate minus the submitter keeps everyone else, and the per_group tally reads only them', async () => {
      const row = await open('shared', [
        { type: 'position', value: 'buyer', group: 'buying' },
        { type: 'position', value: 'procurement_director', group: 'direction' },
      ], { ...ON, behavior: 'per_group' });
      expect([...row.pending_approvers].sort()).toEqual(['u_alice', 'u_dir']);
      expect((await snapshotOf(row.id)).__approverGroups).toEqual({ u_alice: ['buying'], u_dir: ['direction'] });
      expect(await notesOf(row.id)).toEqual([`${EXCLUDED}; the remaining approvers decide it.`]);
    });

    it("the submitter's email slot and an out-of-office hop onto the submitter are the submitter too", async () => {
      await engine.insert('sys_approval_delegation', {
        id: 'dlg_away', delegator_id: 'u_away', delegate_id: 'u_sub', reason: 'leave', organization_id: ORG,
        valid_from: '2026-09-01T00:00:00.000Z', valid_until: '2026-12-31T00:00:00.000Z',
        created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
      }, { context: SYSTEM } as any);
      const row = await open('addresses', [
        { type: 'user', value: 'u_sub@example.com' },
        { type: 'user', value: 'u_away' },
        { type: 'user', value: 'u_bob' },
      ], ON);
      expect(row.pending_approvers).toEqual(['u_bob']);
    });

    it('the fallback slate is screened too: one naming only the submitter degrades to the administrators', async () => {
      const row = await open('fallback_self', POSITION_STEP, {
        ...ON, onEmptyApprovers: 'fallback', fallbackApprovers: [{ type: 'position', value: 'treasury' }],
      });
      expect([...row.pending_approvers].sort()).toEqual(['u_admin', 'u_owner']);
      expect((await snapshotOf(row.id)).__submitterExclusionNote).toMatchObject({ route: 'administrators' });
    });

    it('an organization whose only administrator is the submitter opens on the slate that names no one', async () => {
      const row = await open('solo', FIELD_STEP, ON, { org: SOLO_ORG });
      expect(row.pending_approvers).toEqual([]);
      expect(await notesOf(row.id)).toEqual([
        `${EXCLUDED}; no one else could take it, so only a privileged override can decide it.`,
      ]);
      // …and the submitter, that organization's administrator, cannot take it
      // through the override either.
      await expect(svc.decide(row.id, { decision: 'approve', actorId: 'u_sub' } as any,
        as('u_sub', SOLO_ORG, ['organization_admin']))).rejects.toThrow(/^FORBIDDEN: 'u_sub' submitted this request/);
    });

    it('the note is data the approvals door renders in the reader\'s language', async () => {
      const i18n = createMemoryI18n();
      for (const [locale, data] of Object.entries(ApprovalsTranslations)) {
        i18n.loadTranslations(locale, data as Record<string, unknown>);
      }
      const reader = new ApprovalService({
        engine: engine as any,
        clock: { now: () => new Date(now += 1000) },
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
        i18nServiceSource: () => i18n,
      });
      const row = await open('zh', [{ type: 'position', value: 'buyer' }], ON);
      const served = await reader.listActions(row.id, { ...SUB, locale: 'zh-CN' });
      expect(served.filter((a) => a.action === 'comment' && !a.actor_id).map((a) => a.comment))
        .toEqual(['本步骤设置了 excludeSubmitter，提交人已从审批人中移除；由其余审批人决定。']);
      // A read, never a write.
      expect(await notesOf(row.id)).toEqual([`${EXCLUDED}; the remaining approvers decide it.`]);
    });
  });

  describe('after the open', () => {
    it("the decision refuses the submitter's approval and keeps their rejection", async () => {
      const row = await open('decide', [{ type: 'user', value: 'u_bob' }], ON);
      // A slot in the submitter's hands, the way a later staffing puts it there.
      await engine.update('sys_approval_request', { id: row.id, pending_approvers: 'u_sub,u_bob' },
        { context: SYSTEM } as any);
      await expect(svc.decide(row.id, { decision: 'approve', actorId: 'u_sub' } as any, SUB))
        .rejects.toThrow(/^FORBIDDEN: 'u_sub' submitted this request, and its approval step sets excludeSubmitter/);
      expect((await actionsOf(row.id)).map((a) => a.action)).toEqual(['submit']);
      const out = await svc.decide(row.id, { decision: 'reject', actorId: 'u_sub' } as any, SUB);
      expect(out.request.status).toBe('rejected');
    });

    it('the reassign door refuses to hand the slot back to the submitter, by id or by a position only they hold', async () => {
      const row = await open('reassign', [{ type: 'user', value: 'u_bob' }], ON);
      const bob = as('u_bob', ORG);
      for (const to of ['u_sub', 'u_sub@example.com', 'position:category_manager']) {
        await expect(svc.reassign(row.id, { actorId: 'u_bob', to } as any, bob), to)
          .rejects.toThrow(/^VALIDATION_FAILED: cannot reassign to .*the request's submitter, and this approval step sets excludeSubmitter/);
      }
      // A position the submitter shares hands the slot to the others.
      const moved = await svc.reassign(row.id, { actorId: 'u_bob', to: 'position:buyer' } as any, bob);
      expect(moved.request.pending_approvers).toEqual(['position:buyer']);
    });

    it('an SLA escalation leaves the submitter off the new slate, and one onto the submitter alone is not applied', async () => {
      const overdue = async (row: any) => engine.update('sys_approval_request',
        { id: row.id, created_at: new Date(now - 10 * 3600_000).toISOString() }, { context: SYSTEM } as any);
      const shared = await open('esc_shared', [{ type: 'user', value: 'u_bob' }], {
        ...ON, escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'buyer', notifySubmitter: false },
      });
      const alone = await open('esc_alone', [{ type: 'user', value: 'u_bob' }], {
        ...ON, escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'u_sub', notifySubmitter: false },
      });
      await overdue(shared);
      await overdue(alone);
      await svc.runEscalations();
      expect((await svc.getRequest(shared.id, SYSTEM))?.pending_approvers).toEqual(['u_alice']);
      expect((await svc.getRequest(alone.id, SYSTEM))?.pending_approvers).toEqual(['u_bob']);
      expect((await actionsOf(alone.id)).find((a) => a.action === 'escalate')?.comment).toContain(
        "not applied: the target is the request's submitter, whom the step's excludeSubmitter keeps off the slate",
      );
    });
  });

  describe('controls', () => {
    it('the option off: the submitter stays on the slate, no note, and their approval stands', async () => {
      const row = await open('off', FIELD_STEP);
      expect(row.pending_approvers).toEqual(['u_sub']);
      expect(await notesOf(row.id)).toEqual([]);
      const out = await svc.decide(row.id, { decision: 'approve', actorId: 'u_sub' } as any, SUB);
      expect(out.request.status).toBe('approved');
    });

    it('the option on with a slate that never named the submitter: unchanged, and no note', async () => {
      const row = await open('elsewhere', FIELD_STEP, ON, { manager: 'u_bob' });
      expect(row.pending_approvers).toEqual(['u_bob']);
      expect(await notesOf(row.id)).toEqual([]);
      expect((await snapshotOf(row.id)).__submitterExclusionNote).toBeUndefined();
      const out = await svc.decide(row.id, { decision: 'approve', actorId: 'u_bob' } as any, as('u_bob', ORG));
      expect(out.request.status).toBe('approved');
    });

    it('the option off: the reassign door hands the slot to the submitter as before', async () => {
      const row = await open('reassign_off', [{ type: 'user', value: 'u_bob' }]);
      const moved = await svc.reassign(row.id, { actorId: 'u_bob', to: 'u_sub' } as any, as('u_bob', ORG));
      expect(moved.request.pending_approvers).toEqual(['u_sub']);
    });
  });
});
