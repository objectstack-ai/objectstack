// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Stranded terminal requests are found (#4469).
 *
 * #4420's failure shape: a request row flipped to `approved` (or `rejected`)
 * while its `flow_run_id` points at a run that no longer exists — the decision
 * landed, the flow never moved. #4460 stopped NEW ones being produced; the rows
 * already stuck had no mechanism to find or release them.
 *
 * `releaseDeadRunRequests` cannot see them, and the reason is the interesting
 * part: it scans `status: 'pending'`, and the very step that zombified the
 * request is the one that took it OUT of `pending`. Breaking it removed it from
 * the only sweeper's field of view. Its liveness oracle could not have answered
 * anyway — `getRun` reads the execution LOG, which returns `null` for a
 * perfectly alive suspended run after a restart.
 *
 * So the inspection uses BOTH oracles and reports only rows that fail both,
 * skipping (never condemning) anything the stores could not answer for.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService } from './approval-service.js';

interface FakeRow { [k: string]: any }

function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
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
      return rows.slice(0, options?.limit ?? 1000);
    },
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
    async update(object: string, idOrData: any, _opts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : _opts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const table = ensure(object);
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete() { return {}; },
    registerHook() {}, unregisterHooksByPackage() { return 0; }, async fire() {},
  };
}

/** A terminal request row as the zombie leaves it: decision recorded, run gone. */
function requestRow(over: Record<string, any> = {}): FakeRow {
  return {
    id: 'areq_1',
    process_name: 'flow:deal_approval',
    object_name: 'opportunity',
    record_id: 'opp1',
    status: 'approved',
    flow_run_id: 'run_1',
    flow_node_id: 'co_sign',
    organization_id: 't1',
    completed_at: '2026-01-15T10:00:05.000Z',
    node_config_json: JSON.stringify({
      approvers: [{ type: 'user', value: 'u9' }],
      behavior: 'first_response',
      approvalStatusField: 'approval_status',
    }),
    ...over,
  };
}

/** An automation surface with both oracles, each independently steerable. */
function automation(opts: {
  suspended?: Record<string, boolean>;
  suspendedThrows?: boolean;
  history?: Record<string, { status?: string }>;
  historyThrows?: boolean;
} = {}) {
  return {
    async resume() { return { success: true }; },
    async hasSuspendedRun(runId: string) {
      if (opts.suspendedThrows) throw new Error('suspended-run store unreadable');
      return opts.suspended?.[runId] ?? false;
    },
    async getRun(runId: string) {
      if (opts.historyThrows) throw new Error('run history unreadable');
      return opts.history?.[runId] ?? null;
    },
  } as any;
}

describe('stranded terminal request inspection (#4469)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;

  beforeEach(() => {
    engine = makeFakeEngine();
    svc = new ApprovalService({ engine: engine as any });
  });

  it('the blind spot, stated: the existing pending-only sweep cannot see a terminal zombie', async () => {
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation());
    // `releaseDeadRunRequests` scans `status: 'pending'`; the zombie is
    // `approved`, so its scan set is empty.
    expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 0, released: 0 });
  });

  it('finds a terminal request whose run is neither suspended nor ever completed', async () => {
    engine._tables['sys_approval_request'] = [requestRow()];
    engine._tables['opportunity'] = [{ id: 'opp1', approval_status: 'pending' }];
    svc.attachAutomation(automation());

    const out = await svc.inspectStrandedRequests();
    expect(out.scanned).toBe(1);
    expect(out.undetermined).toBe(0);
    expect(out.stranded).toHaveLength(1);
    expect(out.stranded[0]).toMatchObject({
      requestId: 'areq_1',
      status: 'approved',
      runId: 'run_1',
      nodeId: 'co_sign',
      flowName: 'deal_approval',
      objectName: 'opportunity',
      recordId: 'opp1',
    });
  });

  it('reports the stale mirrored status — what an operator actually sees on the record', async () => {
    // The decision says `approved`; the business record still reads `pending`
    // because the flow never resumed to move it. That disagreement is the
    // human-facing symptom, so the report carries it.
    engine._tables['sys_approval_request'] = [requestRow()];
    engine._tables['opportunity'] = [{ id: 'opp1', approval_status: 'pending' }];
    svc.attachAutomation(automation());

    const [row] = (await svc.inspectStrandedRequests()).stranded;
    expect(row.mirrorField).toBe('approval_status');
    expect(row.mirroredStatus).toBe('pending');
  });

  it('does NOT report a request whose run is still suspended — that approval is healthy', async () => {
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation({ suspended: { run_1: true } }));
    expect((await svc.inspectStrandedRequests()).stranded).toEqual([]);
  });

  it('does NOT report a request whose run ran to a terminal state — it finished, it is not dangling', async () => {
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation({ history: { run_1: { status: 'completed' } } }));
    expect((await svc.inspectStrandedRequests()).stranded).toEqual([]);
  });

  it('SKIPS a row whose suspension store threw — an outage is unknown, not dead', async () => {
    // The whole point of `hasSuspendedRun` rejecting rather than answering
    // `false` (#4460): a storage blip must never be published as a lost run.
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation({ suspendedThrows: true }));

    const out = await svc.inspectStrandedRequests();
    expect(out.stranded).toEqual([]);
    // …and it is COUNTED, so "0 stranded" can never be read as "all clear"
    // when nothing could actually be checked.
    expect(out.undetermined).toBe(1);
  });

  it('SKIPS a row whose run history threw — same reasoning, second oracle', async () => {
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation({ historyThrows: true }));

    const out = await svc.inspectStrandedRequests();
    expect(out.stranded).toEqual([]);
    expect(out.undetermined).toBe(1);
  });

  it('ignores a request with no `flow_run_id` — no run was ever supposed to move', async () => {
    engine._tables['sys_approval_request'] = [requestRow({ flow_run_id: null })];
    svc.attachAutomation(automation());
    expect((await svc.inspectStrandedRequests()).stranded).toEqual([]);
  });

  it('ignores a `recalled` request — a recall abandons its run deliberately', async () => {
    // `recall` explicitly tolerates a run it cannot resume; reporting those
    // would bury the real findings under expected ones.
    engine._tables['sys_approval_request'] = [requestRow({ status: 'recalled' })];
    svc.attachAutomation(automation());
    const out = await svc.inspectStrandedRequests();
    expect(out.scanned).toBe(0);
    expect(out.stranded).toEqual([]);
  });

  it('covers `rejected` and `returned` too — both reach terminal only by resuming the run', async () => {
    engine._tables['sys_approval_request'] = [
      requestRow({ id: 'areq_r', status: 'rejected', flow_run_id: 'run_r' }),
      requestRow({ id: 'areq_v', status: 'returned', flow_run_id: 'run_v' }),
    ];
    svc.attachAutomation(automation());
    const ids = (await svc.inspectStrandedRequests()).stranded.map(s => s.requestId);
    expect(ids).toEqual(['areq_r', 'areq_v']);
  });

  it('NEVER rewrites a stranded row — the decision really happened', async () => {
    // Auto-rolling back would make the audit trail disagree with the facts.
    // The remedy (re-run downstream actions vs re-open the approval) is an
    // operator judgement call, so the sweep only makes the rows visible.
    engine._tables['sys_approval_request'] = [requestRow()];
    engine._tables['opportunity'] = [{ id: 'opp1', approval_status: 'pending' }];
    const before = JSON.stringify(engine._tables);
    svc.attachAutomation(automation());

    await svc.inspectStrandedRequests();

    expect(JSON.stringify(engine._tables)).toBe(before);
    expect(engine._tables['sys_approval_action'] ?? []).toHaveLength(0);
  });

  it('reports nothing when the engine offers no `hasSuspendedRun` — no oracle, no verdict', async () => {
    // Without it there is no way to tell a live cross-restart pause from a dead
    // run, and `getRun` alone would name every healthy paused approval stranded.
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation({ async resume() { return {}; }, async getRun() { return null; } } as any);
    expect(await svc.inspectStrandedRequests()).toEqual({ scanned: 0, stranded: [], undetermined: 0 });
  });

  it('reports nothing with no automation attached at all', async () => {
    engine._tables['sys_approval_request'] = [requestRow()];
    expect(await svc.inspectStrandedRequests()).toEqual({ scanned: 0, stranded: [], undetermined: 0 });
  });
});
