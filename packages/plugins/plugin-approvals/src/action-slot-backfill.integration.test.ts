// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21411 — the boot-time action-slot backfill, on the real engine.
 *
 * `sys_approval_action.actor_id` used to hold the SLOT a slot-gated action took
 * — a `position:<p>` literal, an email — so on those decisions no record named
 * the person who decided. The writers now put the person in `actor_id` and the
 * slot in `acted_as`, and every slot reader reads `acted_as` with no fallback.
 * Rows written before that are moved by `backfillActionSlots`, wired on
 * `kernel:ready`. The same column also held the two machine sweeps' sentinels
 * (`system:sla`, `system:dead-run`); a machine now records null (ADR-0118 D1),
 * and the same pass nulls the stored ones. This pins what it moves, what it
 * clears, what it leaves alone, that it is idempotent, and — end to end — that
 * an in-flight multi-approver tally still counts the votes it had already
 * collected.
 *
 * ## Why this file boots the real engine
 *
 * The repair is a set of driver-side predicates (`$contains` on a lookup
 * column, `$nin`, `$and` / `$or`, the keyset seek) plus writes of a column the
 * DDL must actually carry. A fake engine would be a matcher written by the same
 * author as the assertion, deciding the one thing this file exists to measure.
 * So: a real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3
 * `:memory:`, the real `sys_approval_*` schemas synced through the real DDL,
 * and the real `ApprovalService` opening and deciding the request.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService, SLA_ACTOR_ID } from './approval-service.js';
import { backfillActionSlots, LEGACY_MACHINE_SENTINELS } from './action-slot-backfill.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const SUBMITTER = { userId: 'u_submitter', positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

const deal = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

describe('the boot-time action-slot backfill (#21411)', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;

  const action = async (id: string) =>
    ((await engine.find('sys_approval_action', {
      where: { id }, context: SYSTEM,
    } satisfies EngineQueryOptions)) as any[])[0];
  const recorded = async (id: string) => {
    const row = await action(id);
    return [row?.actor_id ?? null, row?.acted_as ?? null];
  };
  /** A row exactly as the pre-`acted_as` writer stored it. */
  const legacy = (id: string, requestId: string, act: string, actorId: string | null) =>
    engine.insert('sys_approval_action', {
      id, request_id: requestId, step_name: 'review', step_index: 0, action: act,
      actor_id: actorId, created_at: '2026-09-01T00:00:00.000Z',
    }, { context: SYSTEM } as any);

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [deal, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    // Real DDL — including the `acted_as` column, so a write of it the schema
    // does not carry fails here rather than passing against a permissive fake.
    await engine.syncSchemas();
    svc = new ApprovalService({ engine: engine as any, logger: { warn: () => {} } as any });
    await engine.insert('crm_deal', { id: 'D1', title: 'Deal' }, { context: SYSTEM } as any);
  });

  /** The value the dead-run sweep stored in `actor_id` before it recorded null. */
  const DEAD_RUN_SENTINEL = 'system:dead-run';

  it('the sentinels it clears are the two the machine sweeps stored — the SLA one is still the sweep\'s acting identity', () => {
    expect([...LEGACY_MACHINE_SENTINELS].sort()).toEqual([SLA_ACTOR_ID, DEAD_RUN_SENTINEL].sort());
  });

  it('moves slot literals out of actor_id, nulls the machine sentinels, stamps the votes a pending tally counts, leaves everything else — and a second run writes nothing', async () => {
    // A request still collecting votes, opened by the real service: unanimous
    // over a position nobody holds (a literal slot) and two user-id slots.
    const open = await svc.openNodeRequest({
      object: 'crm_deal', recordId: 'D1', runId: 'run_1', nodeId: 'review', flowName: 'deal_review',
      config: { approvers: [{ type: 'position', value: 'finance' }, { type: 'user', value: 'u9' }, { type: 'user', value: 'u8' }], behavior: 'unanimous' } as any,
      record: { id: 'D1', title: 'Deal' },
    }, SUBMITTER) as any;
    expect(open.pending_approvers).toEqual(['position:finance', 'u9', 'u8']);
    // Two votes the OLD writer recorded — each under its slot, in actor_id —
    // and the slate the old tally then left.
    await legacy('aact_vote_literal', open.id, 'approve', 'position:finance');
    await legacy('aact_vote_user', open.id, 'approve', 'u9');
    // A sentinel row on the still-pending request, in the very shape pass 2
    // stamps (an approve at step 0): it took no slot, so it is cleared and
    // never stamped as a vote.
    await legacy('aact_sla_vote', open.id, 'approve', SLA_ACTOR_ID);
    await engine.update('sys_approval_request', { id: open.id, pending_approvers: 'u8' }, { context: SYSTEM } as any);

    // A finished request's history.
    const done = 'areq_done';
    await engine.insert('sys_approval_request', {
      id: done, process_name: 'flow:deal_review', object_name: 'crm_deal', record_id: 'D1',
      submitter_id: 'u_submitter', status: 'approved', current_step: 'review', current_step_index: 0,
      created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
    }, { context: SYSTEM } as any);
    await legacy('aact_email', done, 'approve', 'mail.reviewer@example.com');
    await legacy('aact_role', done, 'comment', 'role:finance');
    await legacy('aact_user_done', done, 'approve', 'u7');
    await legacy('aact_sla', done, 'escalate', SLA_ACTOR_ID);
    await legacy('aact_dead', done, 'recall', DEAD_RUN_SENTINEL);
    await legacy('aact_system', done, 'ooo_substitute', null);
    // A row the NEW writer wrote: already two facts.
    await engine.insert('sys_approval_action', {
      id: 'aact_new', request_id: done, step_index: 0, action: 'approve',
      actor_id: 'u5', acted_as: 'position:legal', created_at: '2026-09-02T00:00:00.000Z',
    }, { context: SYSTEM } as any);

    const first = await backfillActionSlots(engine as any, { pageSize: 2 });
    // Pass 1 moved three literals (two finished, one pending) and nulled three
    // sentinels; pass 2 stamped the one user-id vote still being counted.
    expect(first).toEqual({ literalsMoved: 3, sentinelsCleared: 3, votesStamped: 1 });

    // Slot literals: the slot moves to acted_as, the person is unknown — null.
    expect(await recorded('aact_vote_literal')).toEqual([null, 'position:finance']);
    expect(await recorded('aact_email')).toEqual([null, 'mail.reviewer@example.com']);
    expect(await recorded('aact_role')).toEqual([null, 'role:finance']);
    // The pending tally's user-id vote: the person stays, the slot is stamped.
    expect(await recorded('aact_vote_user')).toEqual(['u9', 'u9']);
    // A finished request's user-id row: no guessed slot (it might be an
    // override that predates via_override). Found by its person instead.
    expect(await recorded('aact_user_done')).toEqual(['u7', null]);
    // The machine sentinels: null, and no slot — the sweep took none.
    expect(await recorded('aact_sla')).toEqual([null, null]);
    expect(await recorded('aact_dead')).toEqual([null, null]);
    expect(await recorded('aact_sla_vote')).toEqual([null, null]);
    // Their kind and comment are what say a sweep acted, and stay as stored.
    expect((await action('aact_dead'))?.action).toBe('recall');
    // The system row and the new row: untouched.
    expect(await recorded('aact_system')).toEqual([null, null]);
    expect(await recorded('aact_new')).toEqual(['u5', 'position:legal']);
    // No sentinel is left anywhere in the lookup.
    const leftover = (await engine.find('sys_approval_action', {
      where: { actor_id: { $in: [...LEGACY_MACHINE_SENTINELS] } }, context: SYSTEM,
    } satisfies EngineQueryOptions)) as any[];
    expect(leftover).toEqual([]);

    // Idempotent: nothing left that either predicate matches.
    expect(await backfillActionSlots(engine as any, { pageSize: 2 })).toEqual({ literalsMoved: 0, sentinelsCleared: 0, votesStamped: 0 });

    // ⭐ End to end: the last slot holder's approval finalizes the request,
    // because the tally counts the two votes the old writer recorded.
    const last = await svc.decideNode(open.id, { decision: 'approve' } as any, asUser('u8'));
    expect(last.finalized).toBe(true);
    expect(last.request.status).toBe('approved');
  });
});
