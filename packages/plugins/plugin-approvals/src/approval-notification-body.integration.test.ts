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
 * - the battery reaches every call site that can notify anyone — twelve of
 *   the thirteen — so neither pin passes over a site it never drove.
 *
 * The thirteenth, the reminder to a slot literal (`position:<p>`), never reaches
 * messaging at all: `notify()` drops every audience entry that is a slot
 * address, and that reminder's audience is nothing else. Its payload is held
 * to the same declared shape by the compiler, not by this battery.
 *
 * The end-to-end half — the text read back from the recipient's
 * `GET /api/v1/notifications` through the real messaging service — is the
 * dogfood pin `packages/qa/dogfood/test/approval-notification-body.dogfood.test.ts`.
 *
 * ## And how it names the record (#23978)
 *
 * Ruling B of #23556 / #23594 names the record an approval notification is
 * about by its object's label and its id (`Deal D_123`), with no title, through
 * `nameSubjectRecord`. `approval.requested` used it; every other body that
 * names the record built `<object_name>/<record_id>`, so an approver read the
 * API name and a slash in the reminder, the SLA breach, the escalation, the
 * hand-off, both send-back sentences and both out-of-office sentences. The same
 * battery pins the record's name in each of those bodies, and a control: a
 * record of an object whose schema has no label is named by the object's API
 * name and the id, the helper's own fallback.
 *
 * ## And whom the out-of-office bodies name (#24065)
 *
 * The two out-of-office bodies also name a person: the delegate is told whom
 * they cover, and the absent approver is told who covers for them. Both used to
 * interpolate the raw `sys_user` id (`… while u_ooo is out of office.`). They
 * now name each person through `resolveUserNames`, the chain the approvals door
 * names people with. The battery pins each person's name in each body, and a
 * control: an approver id no account row answers to is named by that id, the
 * way every reader of the chain renders an unresolved address.
 *
 * ## And whose notification it is (#23284)
 *
 * The same battery pins the organization every call site hands messaging: the
 * request's own `organization_id`, read back from the stored request row.
 * Before it, `notify()` passed none, so every approval notification —
 * `approval.requested` from a user's own submission included — reached
 * `sys_notification` with `organization_id` NULL. The deals live in two
 * organizations, so a site that passed one fixed organization, or the actor's,
 * would not satisfy the pin.
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

/**
 * [#24065] An approver id no `sys_user` row answers to, such as an account
 * removed after its out-of-office delegation was written. Deliberately not in
 * {@link USERS}.
 */
const GONE = 'u_gone';

/** The text each person writes — distinct, so no one can pass for another. */
const COMMENT = 'The signed contract is attached to the record now.';
const QUESTION = 'Which cost centre should this be booked against?';
const SEND_BACK = 'Split the total by quarter, please.';

/**
 * [#23284] The two organizations the battery's deals live in. The SLA pair sits
 * in the second, every other request in the first — so "the request's
 * organization" cannot be satisfied by a constant.
 */
const ORG_A = 'org_battery_a';
const ORG_B = 'org_battery_b';
const orgOfDeal = (key: string): string => (key.startsWith('sla_') ? ORG_B : ORG_A);

/**
 * The fields `notify()` declares for a notification's payload. [#24564] No
 * `actions`: an ADR-0043 action link never rides a payload messaging stores.
 */
const PAYLOAD_FIELDS = new Set(['title', 'body', 'actionUrl']);

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
/** [#23978] The control: an object whose schema declares no label. */
const memo = {
  name: 'crm_memo',
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
  organizationId?: string;
}

describe('every approval notification carries its text in body', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-01T09:00:00.000Z');
  const emits: Emitted[] = [];
  const ids: Record<string, string> = {};

  const open = async (key: string, approvers: any[], extra: Record<string, unknown> = {}, object: string = deal.name) => {
    await engine.insert(object, { id: `D_${key}`, title: key, organization_id: orgOfDeal(key) }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object, recordId: `D_${key}`, runId: `run_${key}`, nodeId: 'review', flowName: FLOW.name,
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
    for (const def of [sysUser, deal, memo, ...(await packageObjects())]) {
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
    // A remind reaches the person — with no action link (#24564).
    await svc.remind(ids.thread, { actorId: 'u_sub' }, asUser('u_sub'));
    await svc.reassign(ids.thread, { actorId: 'u_alice', to: 'u_bob' }, asUser('u_alice'));

    // ── Send back, within budget and past it ──
    await open('revise', [{ type: 'user', value: 'u_alice' }]);
    await svc.sendBack(ids.revise, { actorId: 'u_alice', comment: SEND_BACK } as any, asUser('u_alice'));
    await open('budget', [{ type: 'user', value: 'u_alice' }], { maxRevisions: 0 });
    await svc.sendBack(ids.budget, { actorId: 'u_alice' } as any, asUser('u_alice'));
    // [#23978] Within budget and with no note, the body is the service's own sentence.
    await open('rework', [{ type: 'user', value: 'u_alice' }]);
    await svc.sendBack(ids.rework, { actorId: 'u_alice' } as any, asUser('u_alice'));

    // ── [#23978] The control: a reminder about a record of an object with no label ──
    await open('bare', [{ type: 'user', value: 'u_alice' }], {}, memo.name);
    await svc.remind(ids.bare, { actorId: 'u_sub' }, asUser('u_sub'));

    // ── Out of office: the routing substitutes a delegate ──
    await engine.insert('sys_approval_delegation', {
      id: 'dlg_1', delegator_id: 'u_ooo', delegate_id: 'u_bob', reason: 'leave',
      valid_from: '2026-09-01T00:00:00.000Z', valid_until: '2026-12-31T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
    }, { context: SYSTEM } as any);
    const ooo = await open('ooo', [{ type: 'user', value: 'u_ooo' }]);
    expect(ooo.pending_approvers).toEqual(['u_bob']);
    // [#24065] The control: the absent approver names no account, so no name
    // can be read for them; the delegate the same hop routes to does.
    await engine.insert('sys_approval_delegation', {
      id: 'dlg_2', delegator_id: GONE, delegate_id: 'u_alice', reason: 'leave',
      valid_from: '2026-09-01T00:00:00.000Z', valid_until: '2026-12-31T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
    }, { context: SYSTEM } as any);
    const oooGone = await open('ooo_gone', [{ type: 'user', value: GONE }]);
    expect(oooGone.pending_approvers).toEqual(['u_alice']);

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

  it('the battery reaches every call site that can notify anyone — twelve of the thirteen', () => {
    expect(new Set(emits.map(siteOf))).toEqual(new Set([
      // The opening tells each concrete approver on every request the battery
      // opens — all but `ooo` and `ooo_gone`, whose one approver is the
      // delegate, told once by `approval.ooo_substituted` instead.
      'approval.requested@thread',
      'approval.requested@revise',
      'approval.requested@budget',
      'approval.requested@sla_notify',
      'approval.requested@sla_reassign',
      'approval.requested@rework',
      'approval.requested@bare',
      'approval.ooo_substituted@ooo',
      'approval.ooo_skipped@ooo',
      'approval.ooo_substituted@ooo_gone',
      'approval.ooo_skipped@ooo_gone',
      'approval.returned@budget',
      'approval.returned@revise',
      'approval.returned@rework',
      'approval.reassigned@thread',
      'approval.reminder@thread',
      'approval.reminder@bare',
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

  it('[#23978] every body that names the record names it by its object label and its id, as approval.requested does', () => {
    // Ruling B of #23556 / #23594: label and id, no title — one form for every
    // body, the one `approval.requested` already sends. The pin is the record's
    // name in each body, not the rest of the sentence around it.
    const NAMED: Record<string, string> = {
      'approval.requested@thread': 'Deal D_thread',
      'approval.reminder@thread': 'Deal D_thread',
      'approval.sla_breached@sla_notify': 'Deal D_sla_notify',
      'approval.sla_breached@sla_notify>submitter': 'Deal D_sla_notify',
      'approval.escalated@sla_reassign': 'Deal D_sla_reassign',
      'approval.reassigned@thread': 'Deal D_thread',
      'approval.returned@budget': 'Deal D_budget',
      'approval.returned@rework': 'Deal D_rework',
      'approval.ooo_substituted@ooo': 'Deal D_ooo',
      'approval.ooo_skipped@ooo': 'Deal D_ooo',
      // The control: the object's schema has no label, so the record is named
      // by the object's API name and the id.
      'approval.reminder@bare': 'crm_memo D_bare',
    };
    const offenders = Object.entries(NAMED).flatMap(([site, name]) => {
      const bodies = emits.filter((e) => siteOf(e) === site).map((e) => String(e.payload?.body));
      if (!bodies.length) return [`${site}: sent nothing`];
      return bodies.filter((body) => !body.includes(name)).map((body) => `${site}: ${body}`);
    });
    expect(offenders).toEqual([]);

    // And no body anywhere in the battery joins the API name and the id with a slash.
    const slashed = emits
      .map((e) => `${siteOf(e)}: ${String(e.payload?.body)}`)
      .filter((line) => /\bcrm_(deal|memo)\/D_/.test(line));
    expect(slashed).toEqual([]);
  });

  /** [#24065] Every body one call site sent. */
  const bodiesAt = (site: string): string[] =>
    emits.filter((e) => siteOf(e) === site).map((e) => String(e.payload?.body));

  it('[#24065] both out-of-office bodies name the absent approver and the delegate by display name, never by user id', () => {
    // The pin is each person's name in each body, not the sentence around it.
    const NAMED: Record<string, { name: string; id: string }> = {
      // The delegate is told whom they cover …
      'approval.ooo_substituted@ooo': { name: 'Olive Away', id: 'u_ooo' },
      // … and the absent approver who covers for them.
      'approval.ooo_skipped@ooo': { name: 'Bob', id: 'u_bob' },
      // The control's resolvable half: the delegate on the same hop as an
      // approver no account answers to.
      'approval.ooo_skipped@ooo_gone': { name: 'Alice', id: 'u_alice' },
    };
    const offenders = Object.entries(NAMED).flatMap(([site, { name, id }]) => {
      const bodies = bodiesAt(site);
      if (!bodies.length) return [`${site}: sent nothing`];
      return bodies.filter((body) => !body.includes(name) || body.includes(id)).map((body) => `${site}: ${body}`);
    });
    expect(offenders).toEqual([]);

    // And no out-of-office body anywhere in the battery names one of its
    // people by their user id.
    const byId = emits
      .filter((e) => e.topic === 'approval.ooo_substituted' || e.topic === 'approval.ooo_skipped')
      .flatMap((e) => USERS.filter((u) => String(e.payload?.body).includes(u.id))
        .map((u) => `${siteOf(e)}: names ${u.id} in ${String(e.payload?.body)}`));
    expect(byId).toEqual([]);
  });

  it('[#24065] a person no name can be read for is named by their stored id, as every reader of the chain renders an unresolved address', () => {
    // `u_gone` names no `sys_user` row, so the chain answers no name for it.
    // The body still names the person, by the id the delegation stores: never
    // an empty slot, never `undefined`.
    expect(bodiesAt('approval.ooo_substituted@ooo_gone')).toEqual([expect.stringContaining(GONE)]);
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

  it("[#23284] every notification carries its request's organization, read back from the stored request", async () => {
    const stored = new Map<string, string | null>();
    for (const id of Object.values(ids)) {
      const row = await engine.findOne('sys_approval_request', { where: { id }, fields: ['id', 'organization_id'] }, { context: SYSTEM });
      stored.set(id, row?.organization_id ?? null);
    }
    // The fixture really is two organizations, and each request landed in its
    // deal's — otherwise the identity below could hold for a constant.
    expect(new Set(stored.values())).toEqual(new Set([ORG_A, ORG_B]));
    for (const [key, id] of Object.entries(ids)) expect(stored.get(id), key).toBe(orgOfDeal(key));

    const offenders = emits
      .filter((e) => e.organizationId !== stored.get(e.source?.id ?? ''))
      .map((e) => `${siteOf(e)}: organizationId ${JSON.stringify(e.organizationId)}, request ${JSON.stringify(stored.get(e.source?.id ?? ''))}`);
    expect(offenders).toEqual([]);
  });
});
