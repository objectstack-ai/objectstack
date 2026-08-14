// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The acting identity on an approval is the AUTHENTICATED CALLER, never a
 * request-body field.
 *
 * Every mutating entrypoint on the service takes an `actorId` and — before this
 * suite — authorized *that value* rather than the caller behind it. The REST
 * routes fill it from `body.actorId ?? body.actor_id ?? context.userId`, so the
 * body won. An authenticated user could therefore name any pending approver and
 * have that approver's decision recorded, finalized, and the owning flow resumed
 * — or name a request's submitter and recall it.
 *
 * #3783 drew exactly this line for the *data-write* identity (see the
 * `actingUserId` docblock in the service) and left the authorization side
 * body-driven, calling a mislabelled audit row "tolerable". It is not merely a
 * label: `pending_approvers.includes(input.actorId)` is the authorization gate
 * itself, so naming someone else does not just misattribute the row — it is how
 * you get through the door.
 *
 * The tests below are all "mallory is logged in, names someone else". Each one
 * must be FORBIDDEN. The final block is the load-bearing negative: the two
 * legitimate callers that supply an actor with no session behind them — the SLA
 * sweep (a reserved sentinel) and the ADR-0043 action link (a single-use token
 * cryptographically bound to one approver) — must keep working, or the fix has
 * simply broken the feature instead of securing it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
import { ApprovalService, SLA_ACTOR_ID } from './approval-service.js';

interface FakeRow { [k: string]: any }

/** Equality/`$in`/`$ne`/`$contains` WHERE matcher — mirrors approval-service.test.ts. */
function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some(sub => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$ne' in (v as any)) {
        if (rv === (v as any).$ne) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$contains' in (v as any)) {
        if (!String(rv ?? '').includes(String((v as any).$contains))) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }

  return {
    _tables: tables,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      if (options?.orderBy?.[0]) {
        const { field, order } = options.orderBy[0];
        rows.sort((a, b) => {
          const av = a[field]; const bv = b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return order === 'desc' ? -cmp : cmp;
        });
      }
      const start = options?.offset ?? 0;
      return rows.slice(start, start + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) {
      ensure(object).push({ ...data });
      return { ...data };
    },
    async update(object: string, idOrData: any, _opts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : _opts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const table = ensure(object);
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete(object: string, options?: any) {
      const table = ensure(object);
      const id = options?.where?.id ?? options?.id;
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table.splice(i, 1);
      return { id };
    },
    registerHook() {},
    unregisterHooksByPackage() { return 0; },
  };
}

/** The submitter, and the approver whose slot is up for grabs. */
const SUBMITTER = 'alice';
const APPROVER = 'bob';
/** Authenticated, ordinary, and on neither side of the request. */
const MALLORY = { userId: 'mallory', tenantId: 't1', positions: [], permissions: [] } as any;
const ALICE = { userId: SUBMITTER, tenantId: 't1', positions: [], permissions: [] } as any;
const SYS = { isSystem: true, positions: [], permissions: [] } as any;

function nodeConfig(approvers: string[], extra: Record<string, any> = {}) {
  return {
    approvers: approvers.map(v => ({ type: 'user' as const, value: v })),
    behavior: 'first_response' as const,
    ...extra,
  };
}

function openInput(approvers: string[], extra: Record<string, any> = {}, configExtra: Record<string, any> = {}) {
  return {
    object: 'opportunity',
    recordId: 'opp1',
    runId: 'run_1',
    nodeId: 'approve_step',
    flowName: 'deal_approval',
    config: nodeConfig(approvers, configExtra),
    record: { id: 'opp1', amount: 100 },
    ...extra,
  };
}

/**
 * Enough automation surface for the send-back path's ADR-0044 guards to pass,
 * so a `sendBack` / `resubmit` test fails on the ACTOR check or not at all —
 * never on a missing `revise` out-edge.
 */
function makeAutomationStub() {
  const resumed: any[] = [];
  const cancelled: string[] = [];
  return {
    resumed,
    cancelled,
    async getFlow() {
      return {
        name: 'deal_approval',
        // #3823 — the revise window is the service-owned node type; `sendBack`
        // refuses a bare `wait` target, so this stub declares the real shape.
        nodes: [
          { id: 'approve_step', type: 'approval' },
          { id: 'wait_revision', type: APPROVAL_REVISE_NODE_TYPE },
        ],
        edges: [
          { id: 'e1', source: 'approve_step', target: 'ok', label: 'approve' },
          { id: 'e2', source: 'approve_step', target: 'no', label: 'reject' },
          { id: 'e3', source: 'approve_step', target: 'wait_revision', label: 'revise' },
          { id: 'e4', source: 'wait_revision', target: 'approve_step', label: 'resubmit', type: 'back' },
        ],
      };
    },
    async resume(runId: string, signal: any) { resumed.push({ runId, signal }); },
    async cancelRun(runId: string) { cancelled.push(runId); },
  };
}

describe('approvals: the actor is the authenticated caller, not a body field', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(baseTime + (n++) * 1000) },
    });
  });

  /** Open a request submitted by alice and pending on bob. */
  const open = (approvers = [APPROVER], configExtra: Record<string, any> = {}) =>
    svc.openNodeRequest(openInput(approvers, {}, configExtra), ALICE);

  // ── the decision itself ─────────────────────────────────────────

  it('decideNode: mallory cannot approve by naming the pending approver', async () => {
    const req = await open();
    await expect(
      svc.decideNode(req.id, { decision: 'approve', actorId: APPROVER }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('decideNode: a refused impersonation writes no audit row and leaves the request pending', async () => {
    const req = await open();
    await expect(
      svc.decideNode(req.id, { decision: 'approve', actorId: APPROVER }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);

    const decisions = (engine._tables['sys_approval_action'] ?? [])
      .filter((a: any) => a.action === 'approve' || a.action === 'reject');
    expect(decisions).toHaveLength(0);
    expect(engine._tables['sys_approval_request'][0].status).toBe('pending');
  });

  it('decideNode: mallory cannot reject by naming the pending approver', async () => {
    const req = await open();
    await expect(
      svc.decideNode(req.id, { decision: 'reject', actorId: APPROVER, comment: 'no' }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('decide: the flow is not resumed by an impersonated decision', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId: string, signal: any) { resumed.push({ runId, signal }); } } as any);
    const req = await open();
    await expect(
      svc.decide(req.id, { decision: 'approve', actorId: APPROVER }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(resumed).toHaveLength(0);
  });

  it('decideNode: a unanimous slate cannot be filled by one user naming the others', async () => {
    const req = await open(['bob', 'carol'], { behavior: 'unanimous' });
    const asBob = { userId: 'bob', tenantId: 't1', positions: [], permissions: [] } as any;
    const first = await svc.decideNode(req.id, { decision: 'approve', actorId: 'bob' }, asBob);
    expect(first.finalized).toBe(false);
    // Bob holds a slot, so he clears the "is a pending approver" gate — but the
    // slot he clears it with is his own, not carol's.
    await expect(
      svc.decideNode(req.id, { decision: 'approve', actorId: 'carol' }, asBob),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(engine._tables['sys_approval_request'][0].status).toBe('pending');
  });

  // ── the submitter-only moves ────────────────────────────────────

  it('recall: mallory cannot withdraw the request by naming its submitter', async () => {
    const req = await open();
    await expect(
      svc.recall(req.id, { actorId: SUBMITTER, comment: 'gone' }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(engine._tables['sys_approval_request'][0].status).toBe('pending');
  });

  it('resubmit: mallory cannot resubmit a returned request by naming its submitter', async () => {
    svc.attachAutomation(makeAutomationStub() as any);
    const req = await open();
    const asBob = { userId: APPROVER, tenantId: 't1', positions: [], permissions: [] } as any;
    await svc.sendBack(req.id, { actorId: APPROVER, comment: 'fix it' }, asBob);
    expect(engine._tables['sys_approval_request'][0].status).toBe('returned');
    await expect(
      svc.resubmit(req.id, { actorId: SUBMITTER, comment: 'done' }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('sendBack: mallory cannot return the request by naming the pending approver', async () => {
    const req = await open();
    await expect(
      svc.sendBack(req.id, { actorId: APPROVER, comment: 'revise' }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(engine._tables['sys_approval_request'][0].status).toBe('pending');
  });

  // ── the thread moves ────────────────────────────────────────────

  it('reassign: mallory cannot move the slot by naming its holder', async () => {
    const req = await open();
    await expect(
      svc.reassign(req.id, { actorId: APPROVER, to: 'mallory' }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(engine._tables['sys_approval_request'][0].pending_approvers).toBe(APPROVER);
  });

  it('requestInfo: mallory cannot post as the pending approver', async () => {
    const req = await open();
    await expect(
      svc.requestInfo(req.id, { actorId: APPROVER, comment: 'send the contract' }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('comment: mallory cannot post to the thread as the submitter', async () => {
    const req = await open();
    await expect(
      svc.comment(req.id, { actorId: SUBMITTER, comment: 'looks fine to me' }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('remind: mallory cannot nudge as the submitter', async () => {
    const req = await open();
    await expect(
      svc.remind(req.id, { actorId: SUBMITTER }, MALLORY),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  // ── the legitimate paths must survive ───────────────────────────
  //
  // Without these, "reject every actorId that isn't the caller" would pass the
  // suite above by breaking the SLA sweep and the emailed action link — the two
  // callers that hold a trustworthy actor with no session behind it.

  it('the real approver still decides their own slot', async () => {
    const req = await open();
    const asBob = { userId: APPROVER, tenantId: 't1', positions: [], permissions: [] } as any;
    const out = await svc.decideNode(req.id, { decision: 'approve', actorId: APPROVER }, asBob);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('approved');
    const row = (engine._tables['sys_approval_action'] ?? []).find((a: any) => a.action === 'approve');
    expect(row.actor_id).toBe(APPROVER);
  });

  it('the real submitter still recalls their own request', async () => {
    const req = await open();
    const out = await svc.recall(req.id, { actorId: SUBMITTER }, ALICE);
    expect(out.request.status).toBe('recalled');
  });

  it('a system context may still name an actor with no session behind it (SLA sweep)', async () => {
    const req = await open();
    const out = await svc.decideNode(req.id, { decision: 'approve', actorId: SLA_ACTOR_ID }, SYS);
    expect(out.finalized).toBe(true);
    const row = (engine._tables['sys_approval_action'] ?? []).find((a: any) => a.action === 'approve');
    expect(row.actor_id).toBe(SLA_ACTOR_ID);
  });

  it('a privileged admin may still override a stuck request', async () => {
    const req = await open(['position:cfo']);
    const admin = {
      userId: 'root', tenantId: 't1', positions: [], permissions: ['admin_full_access'],
    } as any;
    const out = await svc.decideNode(req.id, { decision: 'approve', actorId: 'root' }, admin);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('approved');
  });
});
