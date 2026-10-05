// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every approval notification carries its text in `body` — the one field the
 * `messaging` service's `EmitInput` documents for it, and the only one the
 * delivered notification is built from.
 *
 * ## The defect
 *
 * Every approval notification reached its recipient as a title over an empty
 * body. The service put its text in `payload.message`; messaging reads
 * `payload.title` and `payload.body` (the inline fan-out, the outbox snapshot
 * and the dispatcher alike), so the comment, the request-info question and
 * every escalation line were dropped on the way to the inbox. The flow
 * `notify` node and the @mention producer already send `body`.
 *
 * ## What this pins
 *
 * The fix is at the producer, with no alias in messaging. `notify()` types its
 * payload, so a call site that spells the text any other way does not compile;
 * this file pins the behaviour across EVERY call site the service has, driven
 * through the real `ApprovalService` on a real `ObjectQL` over `SqlDriver`
 * (better-sqlite3, in-memory, real DDL):
 *
 * - a comment and a request-info question ARE the body their recipient gets;
 * - every notification carries a non-empty `body` and no field outside the
 *   payload `notify()` declares — so a second spelling of the text is red;
 * - the battery reaches every call site that can notify anyone — eleven of
 *   the twelve — so neither pin passes over a site it never drove.
 *
 * The twelfth, the reminder to a slot literal (`position:<p>`), never reaches
 * messaging at all: `notify()` drops every audience entry that is a slot
 * address, and that reminder's audience is nothing else. Its payload is held
 * to the same declared shape by the compiler, not by this battery.
 *
 * The end-to-end half — the text read back from the recipient's
 * `GET /api/v1/notifications` through the real messaging service — is the
 * dogfood pin `packages/qa/dogfood/test/approval-notification-body.dogfood.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string, positions: string[] = []) =>
  ({ userId, positions, permissions: [] }) as any;

const USERS = [
  { id: 'u_sub', name: 'Sam Submitter', email: 'sam@example.com' },
  { id: 'u_legal', name: 'Lee Legal', email: 'lee@example.com' },
  { id: 'u_alice', name: 'Alice', email: 'alice@example.com' },
  { id: 'u_bob', name: 'Bob', email: 'bob@example.com' },
  { id: 'u_ooo', name: 'Olive Away', email: 'olive@example.com' },
  { id: 'u_boss', name: 'Boss', email: 'boss@example.com' },
];

/** The text each person writes — distinct, so no one can pass for another. */
const COMMENT = 'The signed contract is attached to the record now.';
const QUESTION = 'Which cost centre should this be booked against?';
const SEND_BACK = 'Split the total by quarter, please.';

/** The fields `notify()` declares for a notification's payload. */
const PAYLOAD_FIELDS = new Set(['title', 'body', 'actionUrl', 'actions']);

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

interface Emitted {
  topic: string;
  audience: string[];
  source?: { object: string; id: string };
  payload?: Record<string, unknown>;
}

describe('every approval notification carries its text in body', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-01T09:00:00.000Z');
  const emits: Emitted[] = [];
  const ids: Record<string, string> = {};

  const open = async (key: string, approvers: any[], extra: Record<string, unknown> = {}) => {
    await engine.insert('crm_deal', { id: `D_${key}`, title: key }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'crm_deal', recordId: `D_${key}`, runId: `run_${key}`, nodeId: 'review', flowName: FLOW.name,
      config: { approvers, behavior: 'first_response', ...extra } as any,
      submitterId: 'u_sub', record: { id: `D_${key}`, title: key },
    }, asUser('u_sub'));
    ids[key] = row.id;
    return row;
  };

  /** Which call site an emit came from: its topic, its request, and what tells two sites on one request apart. */
  const siteOf = (e: Emitted): string => {
    const key = Object.keys(ids).find((k) => ids[k] === e.source?.id) ?? '?';
    const links = Array.isArray(e.payload?.actions) ? '+links' : '';
    const toSubmitter = e.topic === 'approval.sla_breached' && e.audience.join() === 'u_sub' ? '>submitter' : '';
    return `${e.topic}@${key}${links}${toSubmitter}`;
  };

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, deal, ...(await packageObjects())]) {
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
        getRun: async (runId: string) => ({ id: runId, status: 'paused' }),
        getFlow: async () => FLOW,
      } as any,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
    svc.attachMessaging({ async emit(input) { emits.push(input as Emitted); } });

    // ── The thread: a position slot (a literal no account holds) and a person ──
    const thread = await open('thread', [{ type: 'position', value: 'legal' }, { type: 'user', value: 'u_alice' }],
      { behavior: 'unanimous' });
    expect(thread.pending_approvers).toEqual(['position:legal', 'u_alice']);
    await svc.comment(ids.thread, { actorId: 'u_sub', comment: COMMENT }, asUser('u_sub'));
    await svc.requestInfo(ids.thread, { actorId: 'u_alice', comment: QUESTION }, asUser('u_alice'));
    // A remind reaches the person with their own action links.
    await svc.remind(ids.thread, { actorId: 'u_sub' }, asUser('u_sub'));
    await svc.reassign(ids.thread, { actorId: 'u_alice', to: 'u_bob' }, asUser('u_alice'));

    // ── Send back, within budget and past it ──
    await open('revise', [{ type: 'user', value: 'u_alice' }]);
    await svc.sendBack(ids.revise, { actorId: 'u_alice', comment: SEND_BACK } as any, asUser('u_alice'));
    await open('budget', [{ type: 'user', value: 'u_alice' }], { maxRevisions: 0 });
    await svc.sendBack(ids.budget, { actorId: 'u_alice' } as any, asUser('u_alice'));

    // ── Out of office: the routing substitutes a delegate ──
    await engine.insert('sys_approval_delegation', {
      id: 'dlg_1', delegator_id: 'u_ooo', delegate_id: 'u_bob', reason: 'leave',
      valid_from: '2026-09-01T00:00:00.000Z', valid_until: '2026-12-31T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
    }, { context: SYSTEM } as any);
    const ooo = await open('ooo', [{ type: 'user', value: 'u_ooo' }]);
    expect(ooo.pending_approvers).toEqual(['u_bob']);

    // ── The SLA sweep: a notify (submitter told) and a reassign (submitter not) ──
    await open('sla_notify', [{ type: 'user', value: 'u_alice' }],
      { escalation: { timeoutHours: 1, action: 'notify', escalateTo: 'u_boss', notifySubmitter: true } });
    await open('sla_reassign', [{ type: 'user', value: 'u_alice' }],
      { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'u_boss', notifySubmitter: false } });
    now += 2 * 3600_000;
    expect(await svc.runEscalations()).toMatchObject({ escalated: 2 });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the battery reaches every call site that can notify anyone — eleven of the twelve', () => {
    expect(new Set(emits.map(siteOf))).toEqual(new Set([
      'approval.ooo_substituted@ooo',
      'approval.ooo_skipped@ooo',
      'approval.returned@budget',
      'approval.returned@revise',
      'approval.reassigned@thread',
      'approval.reminder@thread+links',
      'approval.request_info@thread',
      'approval.comment@thread',
      'approval.escalated@sla_reassign',
      'approval.sla_breached@sla_notify',
      'approval.sla_breached@sla_notify>submitter',
    ]));
  });

  it("a comment, a request-info question and a send-back note are their recipient's body", () => {
    const one = (topic: string, key: string) => {
      const hits = emits.filter((e) => e.topic === topic && e.source?.id === ids[key]);
      expect(hits.length, `${topic} on ${key}`).toBe(1);
      return hits[0];
    };
    const comment = one('approval.comment', 'thread');
    expect([comment.audience, comment.payload?.body]).toEqual([['u_alice'], COMMENT]);
    const question = one('approval.request_info', 'thread');
    expect([question.audience, question.payload?.body]).toEqual([['u_sub'], QUESTION]);
    const sentBack = one('approval.returned', 'revise');
    expect([sentBack.audience, sentBack.payload?.body]).toEqual([['u_sub'], SEND_BACK]);
  });

  it('every notification carries a non-empty body, and no field the payload does not declare', () => {
    const offenders: string[] = [];
    for (const e of emits) {
      const payload = e.payload ?? {};
      if (typeof payload.body !== 'string' || payload.body.trim() === '') {
        offenders.push(`${siteOf(e)}: body is ${JSON.stringify(payload.body)}`);
      }
      for (const field of Object.keys(payload)) {
        if (!PAYLOAD_FIELDS.has(field)) offenders.push(`${siteOf(e)}: undeclared payload field '${field}'`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
