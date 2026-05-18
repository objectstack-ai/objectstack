// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService } from './approval-service.js';

interface FakeRow { [k: string]: any }

function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (row[k] !== v) return false;
    }
    return true;
  }

  return {
    _tables: tables,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      if (options?.orderBy?.[0]) {
        const { field, direction } = options.orderBy[0];
        rows.sort((a, b) => {
          const av = a[field]; const bv = b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return direction === 'desc' ? -cmp : cmp;
        });
      }
      return rows.slice(0, options?.limit ?? 1000);
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
  };
}

const CTX = { userId: 'u1', tenantId: 't1', roles: [], permissions: [] };
const SYS = { isSystem: true, roles: [], permissions: [] };

function singleStep(approvers: string[], behavior: 'first_response' | 'unanimous' = 'first_response') {
  return {
    name: 'proc',
    label: 'Proc',
    object: 'opportunity',
    active: true,
    steps: [{
      name: 'sales_manager',
      label: 'Sales Manager',
      approvers: approvers.map(v => ({ type: 'user' as const, value: v })),
      behavior,
    }],
  };
}

function multiStep() {
  return {
    name: 'proc',
    label: 'Proc',
    object: 'opportunity',
    active: true,
    steps: [
      { name: 'step1', label: 'Step 1', approvers: [{ type: 'user' as const, value: 'u1' }], behavior: 'first_response' },
      { name: 'step2', label: 'Step 2', approvers: [{ type: 'user' as const, value: 'u2' }], behavior: 'first_response', rejectionBehavior: 'back_to_previous' as const },
    ],
  };
}

describe('ApprovalService', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({
      engine: engine as any,
      // Ensure strictly increasing timestamps so created_at sort is deterministic.
      clock: { now: () => new Date(baseTime + (n++) * 1000) },
    });
  });

  // ── Process CRUD ───────────────────────────────────────────────

  it('defineProcess: creates with generated id and validates JSON', async () => {
    const r = await svc.defineProcess({
      name: 'proc', label: 'P', object: 'opportunity',
      definition: singleStep(['u9']),
    }, CTX);
    expect(r.id).toMatch(/^apv_/);
    expect(r.active).toBe(true);
    expect(engine._tables['sys_approval_process'].length).toBe(1);
    expect(engine._tables['sys_approval_process'][0].definition_json).toContain('sales_manager');
  });

  it('defineProcess: upserts when name matches', async () => {
    const a = await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    const b = await svc.defineProcess({ name: 'proc', label: 'P2', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    expect(b.id).toBe(a.id);
    expect(b.label).toBe('P2');
    expect(engine._tables['sys_approval_process'].length).toBe(1);
  });

  it('defineProcess: rejects invalid definition', async () => {
    await expect(svc.defineProcess({
      name: 'proc', label: 'P', object: 'opportunity',
      definition: { name: 'proc', label: 'P', object: 'opportunity', steps: [] },
    }, CTX)).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('listProcesses({activeOnly:true}) filters', async () => {
    await svc.defineProcess({ name: 'proc_a', label: 'A', object: 'opportunity', active: true, definition: { ...singleStep(['u1']), name: 'proc_a' } }, CTX);
    await svc.defineProcess({ name: 'proc_b', label: 'B', object: 'opportunity', active: false, definition: { ...singleStep(['u1']), name: 'proc_b', active: false } }, CTX);
    const active = await svc.listProcesses({ activeOnly: true }, CTX);
    expect(active.length).toBe(1);
    expect(active[0].name).toBe('proc_a');
  });

  it('getProcess by name then id; deleteProcess removes row', async () => {
    const r = await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    expect((await svc.getProcess('proc', CTX))?.id).toBe(r.id);
    expect((await svc.getProcess(r.id, CTX))?.name).toBe('proc');
    await svc.deleteProcess('proc', CTX);
    expect(engine._tables['sys_approval_process'].length).toBe(0);
  });

  // ── Submit ─────────────────────────────────────────────────────

  it('submit: happy path → creates request + submit action + pending_approvers', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1', submitterId: 'u1' }, CTX);
    expect(req.status).toBe('pending');
    expect(req.pending_approvers).toEqual(['u9']);
    expect(req.current_step).toBe('sales_manager');
    expect(engine._tables['sys_approval_action'].length).toBe(1);
    expect(engine._tables['sys_approval_action'][0].action).toBe('submit');
  });

  it('submit: deduplicates pending requests', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    await expect(svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX))
      .rejects.toThrow(/DUPLICATE_REQUEST/);
  });

  it('submit: throws when no active process', async () => {
    await expect(svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX))
      .rejects.toThrow(/NO_ACTIVE_PROCESS/);
  });

  // ── Approve ────────────────────────────────────────────────────

  it('approve single step → finalized=true and status approved', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    const out = await svc.approve(req.id, { actorId: 'u9' }, CTX);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('approved');
    expect(out.request.completed_at).toBeTruthy();
  });

  it('approve multi step → advances to next step', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: multiStep() }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    const out1 = await svc.approve(req.id, { actorId: 'u1' }, CTX);
    expect(out1.finalized).toBe(false);
    expect(out1.request.current_step).toBe('step2');
    expect(out1.request.current_step_index).toBe(1);
    expect(out1.request.pending_approvers).toEqual(['u2']);
    const out2 = await svc.approve(req.id, { actorId: 'u2' }, CTX);
    expect(out2.finalized).toBe(true);
    expect(out2.request.status).toBe('approved');
  });

  it('approve unanimous: first vote not final, second vote finalizes', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u1', 'u2'], 'unanimous') }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    const a = await svc.approve(req.id, { actorId: 'u1' }, CTX);
    expect(a.finalized).toBe(false);
    expect(a.request.pending_approvers).toEqual(['u2']);
    const b = await svc.approve(req.id, { actorId: 'u2' }, CTX);
    expect(b.finalized).toBe(true);
    expect(b.request.status).toBe('approved');
  });

  it('approve by non-pending approver → FORBIDDEN', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    await expect(svc.approve(req.id, { actorId: 'mallory' }, CTX)).rejects.toThrow(/FORBIDDEN/);
  });

  it('approve when not pending → INVALID_STATE', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    await svc.approve(req.id, { actorId: 'u9' }, CTX);
    await expect(svc.approve(req.id, { actorId: 'u9' }, SYS)).rejects.toThrow(/INVALID_STATE/);
  });

  // ── Reject ─────────────────────────────────────────────────────

  it('reject default → finalized rejected', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    const out = await svc.reject(req.id, { actorId: 'u9', comment: 'no' }, CTX);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('rejected');
  });

  it('reject back_to_previous: advances back', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: multiStep() }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    await svc.approve(req.id, { actorId: 'u1' }, CTX); // advance to step2
    const out = await svc.reject(req.id, { actorId: 'u2' }, CTX);
    expect(out.finalized).toBe(false);
    expect(out.request.current_step_index).toBe(0);
    expect(out.request.current_step).toBe('step1');
    expect(out.request.pending_approvers).toEqual(['u1']);
  });

  // ── Recall ─────────────────────────────────────────────────────

  it('recall by submitter → status recalled', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1', submitterId: 'u1' }, CTX);
    const out = await svc.recall(req.id, { actorId: 'u1' }, CTX);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('recalled');
  });

  it('recall by non-submitter → FORBIDDEN', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1', submitterId: 'u1' }, CTX);
    await expect(svc.recall(req.id, { actorId: 'mallory' }, CTX)).rejects.toThrow(/FORBIDDEN/);
  });

  // ── Listing ────────────────────────────────────────────────────

  it('listRequests: filters by approverId via post-filter', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    await svc.submit({ object: 'opportunity', recordId: 'opp2' }, CTX);
    const mine = await svc.listRequests({ approverId: 'u9' }, CTX);
    expect(mine.length).toBe(2);
    const empty = await svc.listRequests({ approverId: 'noone' }, CTX);
    expect(empty.length).toBe(0);
  });

  it('listActions: returns rows ordered by created_at ASC', async () => {
    await svc.defineProcess({ name: 'proc', label: 'P', object: 'opportunity', definition: singleStep(['u9']) }, CTX);
    const req = await svc.submit({ object: 'opportunity', recordId: 'opp1' }, CTX);
    await svc.approve(req.id, { actorId: 'u9' }, CTX);
    const actions = await svc.listActions(req.id, CTX);
    expect(actions.map(a => a.action)).toEqual(['submit', 'approve']);
  });
});
