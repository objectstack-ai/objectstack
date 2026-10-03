// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0118 D1, the family pin: every `sys_user` lookup this package writes
 * holds a user id or null — never a slot address, never a machine sentinel —
 * and so does the actor `notify` hands to `sys_notification.actor_id`.
 *
 * ## Why one battery and not one pin per writer
 *
 * The defect was never one wrong write. The person column of an approval
 * action held the slot a decision took (`position:<p>`, an email); the SLA and
 * dead-run sweeps wrote their own sentinels (`system:sla`, `system:dead-run`)
 * into it; the reassign hand-off parties were declared `sys_user` lookups and
 * held slot addresses; `notify` forwarded the same slot literals and the SLA
 * sentinel as the notification's actor. Each was a separate writer drifting
 * on its own, and a lookup holding a non-id fails silently: the row drops out
 * of every join and report on it, with no error.
 *
 * So this file does not list the columns. It reads the `sys_user` lookups
 * from the package's OWN object definitions — the `objects` the plugin
 * registers in its manifest — drives every write path the service has
 * through the real `ApprovalService` on a real `ObjectQL` over `SqlDriver`
 * (better-sqlite3, in-memory, real DDL), and then reads every stored row of
 * every object back. A lookup added later is caught twice: its rows are held
 * to "an id or null" with no edit here, and the coverage pin goes red until
 * the battery reaches a write of it.
 *
 * "An id" means a row of `sys_user` — the battery's own users, read back from
 * the table, not a pattern.
 *
 * ## What else it pins
 *
 * - **Each machine actor writes null**: the SLA sweep's `escalate` row and the
 *   auto-decision it takes, the dead-run sweep's `recall`, the OOO
 *   substitution; and none of their notifications forwards an actor.
 * - **A reassign round-trips its slot addresses**: a position and an email,
 *   handed over and received, are stored and read back as the addresses they
 *   are — `reassign_from` / `reassign_to` are slot-address columns, like
 *   `acted_as`, and a name resolves only where an address names an account.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string, positions: string[] = []) =>
  ({ userId, positions, permissions: [] }) as any;

/** The battery's people. Every id the pin accepts is a row of this table. */
const USERS = [
  { id: 'u_sub', name: 'Sam Submitter', email: 'sam@example.com' },
  { id: 'u_legal', name: 'Lee Legal', email: 'lee@example.com' },
  { id: 'u_mail', name: 'Mia Mail', email: 'mail@example.com' },
  { id: 'u_alice', name: 'Alice', email: 'alice@example.com' },
  { id: 'u_bob', name: 'Bob', email: 'bob@example.com' },
  { id: 'u_ooo', name: 'Olive Away', email: 'olive@example.com' },
  { id: 'u_boss', name: 'Boss', email: 'boss@example.com' },
];
const POSITION = 'position:legal';
const EMAIL = 'mail@example.com';

/** Just enough of `sys_user` for the reads the service makes (email, name). */
const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};
const deal = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

/** The flow the requests belong to: an approval node with a revise window. */
const FLOW = {
  name: 'deal_review',
  nodes: [
    { id: 'review', type: 'approval' },
    { id: 'rework', type: APPROVAL_REVISE_NODE_TYPE },
  ],
  edges: [{ id: 'e_revise', source: 'review', target: 'rework', label: 'revise' }],
};

/** The plugin's own object definitions, as its manifest registers them. */
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

/** Every `sys_user` lookup an object declares, read from its field definitions. */
function sysUserLookups(objects: any[]): Array<{ object: string; field: string }> {
  const out: Array<{ object: string; field: string }> = [];
  for (const obj of objects) {
    for (const [field, def] of Object.entries<any>(obj.fields ?? {})) {
      const lookup = def?.type === 'lookup' || def?.type === 'master_detail' || def?.type === 'user';
      const target = def?.type === 'user' ? 'sys_user' : def?.reference;
      if (lookup && target === 'sys_user') out.push({ object: obj.name, field });
    }
  }
  return out;
}

describe('ADR-0118 D1 — every sys_user lookup approvals writes holds an id or null', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let objects: any[];
  let now = Date.parse('2026-10-01T09:00:00.000Z');
  const emits: any[] = [];
  const ids: Record<string, string> = {};

  const rowsOf = async (object: string) =>
    (await engine.find(object, { context: SYSTEM } satisfies EngineQueryOptions)) as any[];
  const actionsOf = async (requestId: string) =>
    ((await engine.find('sys_approval_action', {
      where: { request_id: requestId }, orderBy: [{ field: 'created_at', order: 'asc' }], context: SYSTEM,
    } satisfies EngineQueryOptions)) as any[]);
  const open = async (key: string, approvers: any[], extra: Record<string, unknown> = {}, runId = `run_${key}`) => {
    await engine.insert('crm_deal', { id: `D_${key}`, title: key }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'crm_deal', recordId: `D_${key}`, runId, nodeId: 'review', flowName: FLOW.name,
      config: { approvers, behavior: 'first_response', ...extra } as any,
      submitterId: 'u_sub', record: { id: `D_${key}`, title: key },
    }, asUser('u_sub'));
    ids[key] = row.id;
    return row;
  };

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    objects = await packageObjects();
    for (const def of [sysUser, deal, ...objects]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);

    svc = new ApprovalService({
      engine: engine as any,
      // Every reading moves a second on, so the action log has one order.
      clock: { now: () => new Date(now += 1000) },
      automation: {
        resume: async () => ({ status: 'completed' }),
        cancelRun: async () => undefined,
        getRun: async (runId: string) => ({ id: runId, status: runId === 'run_dead' ? 'failed' : 'paused' }),
        getFlow: async () => FLOW,
      } as any,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
    svc.attachMessaging({ async emit(input) { emits.push(input); } });

    // ── People acting on a request: a position slot, an email slot, user ids ──
    const thread = await open('thread', [{ type: 'position', value: 'legal' }, { type: 'user', value: 'u_alice' }],
      { behavior: 'unanimous' });
    expect(thread.pending_approvers).toEqual([POSITION, 'u_alice']);
    const legal = asUser('u_legal', ['legal']);
    await svc.comment(ids.thread, { actorId: POSITION, comment: 'looking' }, legal);
    await svc.requestInfo(ids.thread, { actorId: POSITION, comment: 'need the contract' }, legal);
    await svc.comment(ids.thread, { actorId: 'u_sub', comment: 'attached' }, asUser('u_sub'));
    await svc.remind(ids.thread, { actorId: 'u_sub' }, asUser('u_sub'));
    // The two reassign shapes the ruling names: a position handed to an email,
    // then that email handed to a position — and a user id to a user id.
    await svc.reassign(ids.thread, { actorId: POSITION, from: POSITION, to: EMAIL }, legal);
    await svc.reassign(ids.thread, { actorId: EMAIL, from: EMAIL, to: 'position:finance' }, asUser('u_mail'));
    await svc.reassign(ids.thread, { actorId: 'u_alice', to: 'u_bob' }, asUser('u_alice'));
    await svc.decideNode(ids.thread, { decision: 'approve' } as any, asUser('u_bob'));

    // ── The action link, bound to an email slot ──
    await open('link', [{ type: 'user', value: EMAIL }]);
    const tokens = await svc.issueActionTokens(ids.link, EMAIL);
    expect(await svc.redeemActionToken(tokens.approve)).toMatchObject({ ok: true });

    // ── Send back, within budget and past it ──
    await open('revise', [{ type: 'user', value: 'u_alice' }]);
    await svc.sendBack(ids.revise, { actorId: 'u_alice', comment: 'fix the total' } as any, asUser('u_alice'));
    await open('budget', [{ type: 'user', value: 'u_alice' }], { maxRevisions: 0 });
    await svc.sendBack(ids.budget, { actorId: 'u_alice' } as any, asUser('u_alice'));

    // ── The submitter withdraws ──
    await open('recall', [{ type: 'user', value: 'u_alice' }]);
    await svc.recall(ids.recall, { actorId: 'u_sub' } as any, asUser('u_sub'));

    // ── Out of office: the routing substitutes a delegate ──
    await engine.insert('sys_approval_delegation', {
      id: 'dlg_1', delegator_id: 'u_ooo', delegate_id: 'u_bob', reason: 'leave',
      valid_from: '2026-09-01T00:00:00.000Z', valid_until: '2026-12-31T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
    }, { context: SYSTEM } as any);
    const ooo = await open('ooo', [{ type: 'user', value: 'u_ooo' }]);
    expect(ooo.pending_approvers).toEqual(['u_bob']);

    // ── The SLA sweep, one request per escalation action ──
    await open('sla_notify', [{ type: 'user', value: 'u_alice' }],
      { escalation: { timeoutHours: 1, action: 'notify', escalateTo: 'u_boss', notifySubmitter: true } });
    await open('sla_reassign', [{ type: 'user', value: 'u_alice' }],
      { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'u_boss', notifySubmitter: true } });
    await open('sla_approve', [{ type: 'user', value: 'u_alice' }],
      { escalation: { timeoutHours: 1, action: 'auto_approve', notifySubmitter: false } });
    await open('sla_reject', [{ type: 'user', value: 'u_alice' }],
      { escalation: { timeoutHours: 1, action: 'auto_reject', notifySubmitter: false } });
    // ── The dead-run sweep ──
    await open('dead', [{ type: 'user', value: 'u_alice' }], {}, 'run_dead');

    now += 2 * 3600_000;
    expect(await svc.runEscalations()).toMatchObject({ escalated: 4 });
    expect(await svc.releaseDeadRunRequests()).toMatchObject({ released: 1 });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('reads the lookups from the package\'s own object definitions — and the reassign parties are not among them', async () => {
    const lookups = sysUserLookups(objects);
    // The scan found the column the family is about, so it is not a pass over nothing.
    expect(lookups).toContainEqual({ object: 'sys_approval_action', field: 'actor_id' });
    // A reassignment moves a SLOT: both parties are slot-address columns, the
    // same declared kind as `acted_as`, not `sys_user` lookups.
    const action = objects.find((o) => o.name === 'sys_approval_action');
    for (const field of ['reassign_from', 'reassign_to']) {
      expect(lookups).not.toContainEqual({ object: 'sys_approval_action', field });
      expect(action.fields[field].type).toBe(action.fields.acted_as.type);
      expect(action.fields[field].maxLength).toBe(action.fields.acted_as.maxLength);
    }
  });

  it('every stored value of every declared sys_user lookup is a user id or null', async () => {
    const people = new Set((await rowsOf('sys_user')).map((u) => String(u.id)));
    const offenders: string[] = [];
    for (const { object, field } of sysUserLookups(objects)) {
      for (const row of await rowsOf(object)) {
        const value = row[field];
        if (value != null && !people.has(String(value))) offenders.push(`${object}.${field} = '${value}' (row ${row.id})`);
      }
    }
    expect(offenders, 'a sys_user lookup holds a non-id: ADR-0118 D1 allows a user id or null').toEqual([]);
  });

  it('the battery reaches a write of every declared sys_user lookup — a new one is red until it does', async () => {
    const unwritten: string[] = [];
    for (const { object, field } of sysUserLookups(objects)) {
      if (!(await rowsOf(object)).some((row) => row[field] != null)) unwritten.push(`${object}.${field}`);
    }
    expect(unwritten, 'drive a write of this lookup in the battery above, so the id-or-null pin covers it').toEqual([]);
  });

  it('notify forwards the person a context vouches for, or no actor — never a slot or a sentinel', async () => {
    const people = new Set(USERS.map((u) => u.id));
    const forwarded = emits.filter((e) => 'actorId' in e);
    expect(forwarded.filter((e) => !people.has(e.actorId)).map((e) => `${e.topic}: '${e.actorId}'`)).toEqual([]);
    // Each person-driven path forwards its person, so the pin is not vacuous:
    // the slot-gated ones forward the HOLDER, never the address acted under.
    const actorOf = (topic: string) => [...new Set(emits.filter((e) => e.topic === topic).map((e) => e.actorId))];
    expect(actorOf('approval.request_info')).toEqual(['u_legal']);
    expect(actorOf('approval.comment')).toEqual(['u_legal', 'u_sub']);
    expect(actorOf('approval.reminder')).toEqual(['u_sub']);
    expect(actorOf('approval.reassigned')).toEqual(['u_legal', 'u_alice']);
    expect(actorOf('approval.returned')).toEqual(['u_alice']);
  });

  it('each machine actor writes null, and its notifications name no actor', async () => {
    const machineRows: Array<[string, string]> = [
      ['sla_notify', 'escalate'],
      ['sla_reassign', 'escalate'],
      ['sla_approve', 'escalate'], ['sla_approve', 'approve'],
      ['sla_reject', 'escalate'], ['sla_reject', 'reject'],
      ['dead', 'recall'],
      ['ooo', 'ooo_substitute'],
    ];
    for (const [key, kind] of machineRows) {
      const rows = (await actionsOf(ids[key])).filter((a) => a.action === kind);
      expect(rows.length, `${key}: one '${kind}' row`).toBe(1);
      expect([key, kind, rows[0].actor_id ?? null]).toEqual([key, kind, null]);
    }
    // The fact that a sweep acted is the row's KIND and its comment, not an actor.
    expect((await actionsOf(ids.sla_approve)).find((a) => a.action === 'escalate')?.comment).toBe('auto_approve');
    expect((await actionsOf(ids.dead)).find((a) => a.action === 'recall')?.comment).toMatch(/run_dead is failed/);

    const machineTopics = ['approval.sla_breached', 'approval.escalated', 'approval.ooo_substituted', 'approval.ooo_skipped'];
    const machine = emits.filter((e) => machineTopics.includes(e.topic));
    expect(new Set(machine.map((e) => e.topic))).toEqual(new Set(machineTopics));
    expect(machine.filter((e) => 'actorId' in e).map((e) => `${e.topic}: '${e.actorId}'`)).toEqual([]);
  });

  it('a reassign of a position and of an email round-trips its slot addresses, beside the person who moved it', async () => {
    const moves = (await actionsOf(ids.thread))
      .filter((a) => a.action === 'reassign')
      .map((a) => [a.actor_id, a.acted_as, a.reassign_from, a.reassign_to]);
    expect(moves).toEqual([
      ['u_legal', POSITION, POSITION, EMAIL],
      ['u_mail', EMAIL, EMAIL, 'position:finance'],
      ['u_alice', 'u_alice', 'u_alice', 'u_bob'],
    ]);
    // The read API hands the addresses back as stored. A name resolves only
    // where the address names an account: a user id, or an email an account
    // carries — never a position.
    const log = (await svc.listActions(ids.thread, SYSTEM)).filter((a) => a.action === 'reassign');
    expect(log.map((a) => [a.reassign_from, a.reassign_from_name ?? null, a.reassign_to, a.reassign_to_name ?? null])).toEqual([
      [POSITION, null, EMAIL, 'Mia Mail'],
      [EMAIL, 'Mia Mail', 'position:finance', null],
      ['u_alice', 'Alice', 'u_bob', 'Bob'],
    ]);
  });
});
