// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Opening an approval step tells the people it landed on (#22607).
 *
 * ## The defect
 *
 * Every later lifecycle step of a request published a notification topic —
 * reminder, reassignment, escalation, SLA breach, return, request-info,
 * comment, out-of-office cover — and the opening published none. An approver
 * learned that a step was waiting on them only by happening to open the
 * approvals inbox, so an approval ladder sat in silence between rungs.
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL), with the messaging
 * surface recording what reaches it:
 *
 * - opening a step sends ONE `approval.requested` message to each concrete
 *   approver on the slate it opened on — a named user and every holder of a
 *   staffed position alike — through the same `notify()` ingress and payload
 *   shape as `approval.reminder`;
 * - [#23556] the body names the record the way the approvals inbox row does —
 *   the object's label and the record's title, from the same resolution — and
 *   a record with no title is named by label and id, never by the unredacted
 *   submit snapshot;
 * - a person the slate lists twice is one person, and a `type:value` slot
 *   literal (an unstaffed position) names no one;
 * - the control: a step whose approvers resolve to nobody notifies no one,
 *   and the node's `onEmptyApprovers` policy is what decides that case —
 *   `admin_rescue` with no organization administrator to route to (none here)
 *   opens on literals and tells nobody, `auto_approve` and `fail` open
 *   nothing, `fallback` opens on — and tells — its fallback approvers. The
 *   administrators an `admin_rescue` request opens on, and their messages,
 *   are `admin-rescue-named-slate.integration.test.ts`'s;
 * - an out-of-office delegate is told once, by `approval.ooo_substituted`,
 *   never a second time by the opening;
 * - a channel that throws never fails the opening.
 *
 * The inbox half — `emit()` materializing one `sys_inbox_message` per
 * recipient — is the messaging service's, and is the very channel
 * `approval.reminder` already rides end to end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

const USERS = [
  { id: 'u_sub', name: 'Sam Submitter', email: 'sam@example.com' },
  { id: 'u_alice', name: 'Alice', email: 'alice@example.com' },
  { id: 'u_bob', name: 'Bob', email: 'bob@example.com' },
  { id: 'u_carol', name: 'Carol Counsel', email: 'carol@example.com' },
  { id: 'u_dan', name: 'Dan Counsel', email: 'dan@example.com' },
  { id: 'u_ooo', name: 'Olive Away', email: 'olive@example.com' },
  { id: 'u_cover', name: 'Cory Cover', email: 'cory@example.com' },
  { id: 'u_fallback', name: 'Fay Fallback', email: 'fay@example.com' },
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
/** The position directory a `position` approver resolves its holders from. */
const sysUserPosition = {
  name: 'sys_user_position',
  label: 'User Position',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', label: 'User', type: 'text' as const },
    position: { name: 'position', label: 'Position', type: 'text' as const },
    organization_id: { name: 'organization_id', label: 'Organization', type: 'text' as const },
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
  dedupKey?: string;
  actorId?: string;
}

describe('opening an approval step tells each resolved approver, once (approval.requested)', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-01T09:00:00.000Z');
  const emits: Emitted[] = [];

  const makeService = (emit: (input: Emitted) => Promise<unknown>, warn: (...args: any[]) => void = () => {}) => {
    const service = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      logger: { warn, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
    service.attachMessaging({ emit: emit as any });
    return service;
  };

  const open = async (
    key: string, approvers: any[], extra: Record<string, unknown> = {}, service: ApprovalService = svc,
  ): Promise<any> => {
    await engine.insert('crm_deal', { id: `D_${key}`, title: key }, { context: SYSTEM } as any);
    return service.openNodeRequest({
      object: 'crm_deal', recordId: `D_${key}`, runId: `run_${key}`, nodeId: 'review', flowName: 'deal_review',
      config: { approvers, behavior: 'first_response', ...extra } as any,
      submitterId: 'u_sub', record: { id: `D_${key}`, title: key },
    }, asUser('u_sub'));
  };

  /** The `approval.requested` messages one request sent. */
  const requested = (requestId: string) =>
    emits.filter((e) => e.topic === 'approval.requested' && e.source?.id === requestId);
  /** Who those messages went to, one entry per message. */
  const toldOn = (requestId: string) => requested(requestId).flatMap((e) => e.audience).sort();
  /** Every message about one request, as `topic>recipient`. */
  const messagesAbout = (requestId: string) =>
    emits.filter((e) => e.source?.id === requestId)
      .flatMap((e) => e.audience.map((a) => `${e.topic}>${a}`)).sort();

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, sysUserPosition, deal, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    for (const u of USERS) await engine.insert('sys_user', u, { context: SYSTEM } as any);
    // `legal` is staffed by two people; `treasury` by nobody.
    for (const [id, user] of [['up_1', 'u_carol'], ['up_2', 'u_dan']]) {
      await engine.insert('sys_user_position', { id, user_id: user, position: 'legal', organization_id: null },
        { context: SYSTEM } as any);
    }
    await engine.insert('sys_approval_delegation', {
      id: 'dlg_1', delegator_id: 'u_ooo', delegate_id: 'u_cover', reason: 'leave',
      valid_from: '2026-09-01T00:00:00.000Z', valid_until: '2026-12-31T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
    }, { context: SYSTEM } as any);

    svc = makeService(async (input) => { emits.push(input); });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('puts one message in each resolved approver\'s inbox — a named user and every holder of a staffed position', async () => {
    const row = await open('ladder', [{ type: 'user', value: 'u_alice' }, { type: 'position', value: 'legal' }]);
    // The slate the request opened on is the one the messages go to.
    expect([...row.pending_approvers].sort()).toEqual(['u_alice', 'u_carol', 'u_dan']);
    expect(toldOn(row.id)).toEqual(['u_alice', 'u_carol', 'u_dan']);

    // One message per person, each addressed to that person alone, in the
    // reminder's shape: the request as its source, the inbox deep-linked to
    // it, the submitter as the actor. [#23556] The body names the record by
    // its object's label and its title, never `crm_deal/D_ladder`.
    for (const e of requested(row.id)) {
      expect(e.audience).toHaveLength(1);
      expect(e.payload).toEqual({
        title: 'Approval requested',
        body: `A decision on Deal "ladder" is waiting on you.`,
        actionUrl: `/system/approvals?request=${encodeURIComponent(row.id)}`,
      });
      expect(e.source).toEqual({ object: 'sys_approval_request', id: row.id });
      expect(e.actorId).toBe('u_sub');
    }
    expect(new Set(requested(row.id).map((e) => e.dedupKey)).size).toBe(3);

    // [#23556] ...and by the very name the recipient's own inbox row shows.
    const [listed] = await svc.listRequests({ approverId: 'u_alice', recordId: 'D_ladder' }, asUser('u_alice'));
    expect([listed?.object_label, listed?.record_title]).toEqual(['Deal', 'ladder']);
    expect(requested(row.id)[0]?.payload?.body)
      .toBe(`A decision on ${listed!.object_label} "${listed!.record_title}" is waiting on you.`);
  });

  it('[#23556] a record with no title is named by its object label and id — never by the unredacted submit snapshot', async () => {
    // The live record has no title; the trigger snapshot the flow handed over
    // still carries one. The inbox reads that snapshot only after redacting it
    // for its reader's field-level security, and stored notification text has
    // no reader to redact for — so the body names what it named before: the id.
    const SNAPSHOT_TITLE = 'Snapshot-only title';
    await engine.insert('crm_deal', { id: 'D_untitled', title: null }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'crm_deal', recordId: 'D_untitled', runId: 'run_untitled', nodeId: 'review', flowName: 'deal_review',
      config: { approvers: [{ type: 'user', value: 'u_alice' }], behavior: 'first_response' } as any,
      submitterId: 'u_sub', record: { id: 'D_untitled', title: SNAPSHOT_TITLE },
    }, asUser('u_sub'));
    // The scene: the snapshot really does carry the title the body must not use.
    expect(row.payload).toMatchObject({ title: SNAPSHOT_TITLE });

    const [message] = requested(row.id);
    expect(message?.audience).toEqual(['u_alice']);
    expect(message?.payload?.body).toBe('A decision on Deal D_untitled is waiting on you.');
    expect(String(message?.payload?.body)).not.toContain(SNAPSHOT_TITLE);
  });

  it('a person the slate lists under two groups is told once', async () => {
    const row = await open('twice', [
      { type: 'user', value: 'u_bob', group: 'finance' },
      { type: 'user', value: 'u_bob', group: 'legal' },
    ], { behavior: 'per_group' });
    // Guard the guard: the slate really does carry the person twice.
    expect(row.pending_approvers).toEqual(['u_bob', 'u_bob']);
    expect(toldOn(row.id)).toEqual(['u_bob']);
  });

  it('a slot literal names no one: a mixed slate tells only its people', async () => {
    const row = await open('mixed', [{ type: 'position', value: 'treasury' }, { type: 'user', value: 'u_bob' }]);
    expect(row.pending_approvers).toEqual(['position:treasury', 'u_bob']);
    expect(toldOn(row.id)).toEqual(['u_bob']);
    expect(messagesAbout(row.id)).toEqual(['approval.requested>u_bob']);
  });

  describe('control — a step whose approvers resolve to nobody notifies no one; onEmptyApprovers decides it', () => {
    const UNSTAFFED = [{ type: 'position', value: 'treasury' }];

    it('admin_rescue (the default), with no organization administrator, opens on the literal and tells nobody', async () => {
      const row = await open('rescue', UNSTAFFED);
      expect([row.status, row.pending_approvers]).toEqual(['pending', ['position:treasury']]);
      expect(messagesAbout(row.id)).toEqual([]);
    });

    it('auto_approve opens no request, so there is no one to tell', async () => {
      const before = emits.length;
      const outcome = await open('waved', UNSTAFFED, { onEmptyApprovers: 'auto_approve' });
      expect(outcome).toEqual({ autoApproved: true, reason: 'empty_approvers' });
      expect(emits.slice(before)).toEqual([]);
    });

    it('fail refuses the opening, and tells nobody', async () => {
      const before = emits.length;
      await expect(open('refused', UNSTAFFED, { onEmptyApprovers: 'fail' })).rejects.toThrow(/^NO_APPROVERS:/);
      expect(emits.slice(before)).toEqual([]);
    });

    it('fallback opens on the declared fallback approvers — and tells them', async () => {
      const row = await open('fallback', UNSTAFFED, {
        onEmptyApprovers: 'fallback', fallbackApprovers: [{ type: 'user', value: 'u_fallback' }],
      });
      expect(row.pending_approvers).toEqual(['u_fallback']);
      expect(messagesAbout(row.id)).toEqual(['approval.requested>u_fallback']);
    });
  });

  it('an out-of-office delegate is told once — by approval.ooo_substituted, not a second time by the opening', async () => {
    const row = await open('cover', [{ type: 'user', value: 'u_ooo' }, { type: 'user', value: 'u_alice' }]);
    expect(row.pending_approvers).toEqual(['u_cover', 'u_alice']);
    expect(messagesAbout(row.id)).toEqual([
      'approval.ooo_skipped>u_ooo',
      'approval.ooo_substituted>u_cover',
      'approval.requested>u_alice',
    ]);
  });

  it('a channel that throws never fails the opening', async () => {
    const warned: string[] = [];
    const failing = makeService(
      async () => { throw new Error('channel down'); },
      (_msg: string, meta?: any) => { if (meta?.topic) warned.push(meta.topic); },
    );
    const row = await open('down', [{ type: 'user', value: 'u_alice' }], {}, failing);
    expect([row.status, row.pending_approvers]).toEqual(['pending', ['u_alice']]);
    // The failure is said, not swallowed.
    expect(warned).toEqual(['approval.requested']);
  });
});
