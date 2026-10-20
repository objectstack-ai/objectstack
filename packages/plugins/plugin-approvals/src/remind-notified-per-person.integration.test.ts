// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A reminder's `notified` counts the reminders it hands over — one per
 * distinct approver address, never one per slate slot (#24751).
 *
 * ## The defect
 *
 * A `per_group` slate lists a person once per group they resolved into, and
 * `pending_approvers` keeps every one of those slots until the first vote. So
 * one user placed in two groups stands on the stored slate twice. The opening
 * fan-out told that person once (`openedOn`, a Set); `remind()` looped over
 * the raw slots and added each `notify()` result, so `POST …/remind` answered
 * `notified: 2` while messaging stored ONE reminder for them — the second emit
 * carries the same dedup key. The console shows that number to the submitter
 * ("Reminder sent to N approver(s)").
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), with the real
 * `AutomationEngine` running each flow and the real approval node opening the
 * request, and the messaging surface recording every emit it is handed:
 *
 * - one approver listed in two groups: the stored slate really lists them
 *   twice (the scene), the reminder hands messaging ONE reminder for them and
 *   answers `notified: 1`;
 * - the same holds for an approver authored as an email in both groups;
 * - control: two distinct approvers get a reminder each, `notified: 2`;
 * - a `position:*` literal the slate keeps beside a person adds nothing — no
 *   emit, no count — while the person beside it is still reminded;
 * - an account's id and its email are two addresses, at the reminder exactly
 *   as at the opening: two reminders, `notified: 2`;
 * - on every slate, the reminder reaches exactly the addresses the opening's
 *   `approval.requested` reached.
 *
 * Unchanged by the fix and held here too: each reminder's topic, deep link and
 * per-approver dedup key, and the one `remind` audit row per reminder.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationEngine } from '@objectstack/service-automation';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const ORG = 'org_remind';
const ALICE_EMAIL = 'alice@example.com';

const USERS = [
  { id: 'u_sub', name: 'Sam Submitter', email: 'sam@example.com' },
  { id: 'u_alice', name: 'Alice', email: ALICE_EMAIL },
  { id: 'u_bob', name: 'Bob', email: 'bob@example.com' },
];

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

/** The plugin's own object definitions, as its manifest registers them. */
async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: silent,
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

/** A `user` approver in a named group of a `per_group` slate. */
const inGroup = (value: string, group: string) => ({ type: 'user', value, group });

/** One `per_group` approval step between start and two ends. */
function perGroup(name: string, approvers: Array<Record<string, unknown>>): any {
  return {
    name, label: name, type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'review', type: 'approval', label: 'Review', config: { approvers, behavior: 'per_group' } },
      { id: 'ok', type: 'end', label: 'Approved' },
      { id: 'no', type: 'end', label: 'Rejected' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'review' },
      { id: 'e2', source: 'review', target: 'ok', label: 'approve' },
      { id: 'e3', source: 'review', target: 'no', label: 'reject' },
    ],
  };
}

/** The slates under test — each its own flow, so each request is its own reminder window. */
const SLATES: Record<string, Array<Record<string, unknown>>> = {
  twice_by_id: [inGroup('u_alice', 'first'), inGroup('u_alice', 'second')],
  twice_by_email: [inGroup(ALICE_EMAIL, 'first'), inGroup(ALICE_EMAIL, 'second')],
  two_people: [inGroup('u_alice', 'first'), inGroup('u_bob', 'second')],
  // `position:nobody_holds` stays on the slate as its `type:value` literal.
  person_and_literal: [inGroup('u_alice', 'first'), { type: 'position', value: 'nobody_holds', group: 'second' }],
  id_and_email: [inGroup('u_alice', 'first'), inGroup(ALICE_EMAIL, 'second')],
};

interface Emitted {
  topic: string;
  audience: string[];
  dedupKey?: string;
  source?: { object: string; id: string };
  payload?: Record<string, unknown>;
}

describe('a reminder counts the reminders it hands over, one per distinct approver address', () => {
  let engine: ObjectQL;
  let automation: AutomationEngine;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-20T09:00:00.000Z');
  const emits: Emitted[] = [];

  /** Start `flow` on a fresh deal as the submitter; answer the request it opened. */
  const submit = async (flow: string): Promise<any> => {
    const record = { id: `D_${flow}`, title: flow, organization_id: ORG };
    await engine.insert('crm_deal', record, { context: SYSTEM } as any);
    const run = await automation.execute(flow, { object: 'crm_deal', record, userId: 'u_sub' } as any);
    expect(run.status, `${flow} paused on its approval step`).toBe('paused');
    const rows: any[] = await engine.find('sys_approval_request', {
      where: { record_id: record.id, status: 'pending' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(rows.length, `one pending request on ${record.id}`).toBe(1);
    return rows[0];
  };
  /** The audiences of one topic's emits about one request, in emit order. */
  const audiencesOf = (topic: string, requestId: string) =>
    emits.filter((e) => e.topic === topic && e.source?.id === requestId).map((e) => e.audience);
  /**
   * Submit on `flow`, then send its reminder as the submitter. Every slate also
   * holds the reminder to the opening's rule: it reaches exactly the addresses
   * `approval.requested` reached (none of these slates has an out-of-office hop).
   */
  const remindOn = async (flow: string) => {
    const req = await submit(flow);
    const stored = String(req.pending_approvers ?? '').split(',').filter(Boolean);
    const out = await svc.remind(req.id, { actorId: 'u_sub' }, asUser('u_sub'));
    const reminders = audiencesOf('approval.reminder', req.id);
    const opened = audiencesOf('approval.requested', req.id);
    expect(opened.length, `${flow}: the opening told someone`).toBeGreaterThan(0);
    // Soft, so a broken fan-out still reaches the case's own `notified` assertion.
    expect.soft(reminders, `${flow}: the reminder reached whom the opening reached`).toEqual(opened);
    return { req, stored, notified: out.notified, reminders };
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

    automation = new AutomationEngine(silent);
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: silent,
    });
    svc.attachAutomation(automation as any);
    svc.attachMessaging({ async emit(input) { emits.push(input as Emitted); } });
    registerApprovalNode(automation as any, svc, silent);

    for (const [name, approvers] of Object.entries(SLATES)) automation.registerFlow(name, perGroup(name, approvers));
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('an approver the slate lists in two groups is handed one reminder and counted once', async () => {
    const { req, stored, notified, reminders } = await remindOn('twice_by_id');
    // The scene: the stored slate really lists her twice, so a count of 1 is the rule, not an empty slate.
    expect(stored).toEqual(['u_alice', 'u_alice']);

    expect(reminders).toEqual([['u_alice']]);
    expect(notified).toBe(1);

    // Unchanged: the reminder itself — topic, deep link, per-approver dedup key — and its one audit row.
    const [reminder] = emits.filter((e) => e.topic === 'approval.reminder' && e.source?.id === req.id);
    expect(reminder.payload?.actionUrl).toBe(`/system/approvals?request=${encodeURIComponent(req.id)}`);
    expect(reminder.dedupKey).toMatch(new RegExp(`^approval-remind-${req.id}-.+-u_alice$`));
    const audit: any[] = await engine.find('sys_approval_action', {
      where: { request_id: req.id, action: 'remind' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(audit.map((a) => a.actor_id)).toEqual(['u_sub']);
  });

  it('an approver authored as the same email in two groups is handed one reminder and counted once', async () => {
    const { stored, notified, reminders } = await remindOn('twice_by_email');
    expect(stored).toEqual([ALICE_EMAIL, ALICE_EMAIL]);
    expect(reminders).toEqual([[ALICE_EMAIL]]);
    expect(notified).toBe(1);
  });

  it('control: two distinct approvers are each handed a reminder, and both are counted', async () => {
    const { stored, notified, reminders } = await remindOn('two_people');
    expect(stored).toEqual(['u_alice', 'u_bob']);
    expect(reminders).toEqual([['u_alice'], ['u_bob']]);
    expect(notified).toBe(2);
  });

  it('a position:* literal on the slate adds nothing, and the person beside it is still reminded', async () => {
    const { stored, notified, reminders } = await remindOn('person_and_literal');
    expect(stored).toEqual(['u_alice', 'position:nobody_holds']);
    // The literal names no one: no emit carries it, and it adds nothing to the count.
    expect(reminders).toEqual([['u_alice']]);
    expect(notified).toBe(1);
  });

  it("an account's id and its email are two addresses: two reminders, as at the opening", async () => {
    const { stored, notified, reminders } = await remindOn('id_and_email');
    expect(stored).toEqual(['u_alice', ALICE_EMAIL]);
    expect(reminders).toEqual([['u_alice'], [ALICE_EMAIL]]);
    expect(notified).toBe(2);
  });
});
