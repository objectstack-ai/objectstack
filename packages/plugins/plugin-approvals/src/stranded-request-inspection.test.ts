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
 *
 * ── #13909: the second oracle was too narrow ────────────────────────────────
 *
 * `if (terminal) continue` read the mere EXISTENCE of a history row as health.
 * The engine consumes a suspension before running the downstream nodes
 * (`forgetSuspendedRun(run, 'resumed')` precedes `traverseNext`), so a node that
 * merely threw threw with the pause already gone and the catch arm wrote a
 * terminal `failed` row — the decision durable, the continuation stopped
 * half-way, nothing able to resume it. The row this inspection read as "it
 * finished, it is not dangling" is written BY the failure that stranded it, so
 * the one shape an operator most needs was reported as `0`.
 *
 * The widening is deliberately narrow, and the second half of this file pins
 * that: `completed`, `cancelled`, `paused` and any status this code does not
 * recognise are each STILL skipped, one test per reason. A widening that
 * reported everything would bury the finding it exists to surface.
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
      // #13909 — WHICH shape: no history row at all, the original #4469 zombie.
      runState: 'missing',
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

  it('does NOT report a request whose run COMPLETED — the decision advanced the flow', async () => {
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


/**
 * The widening (#13909) — and, in equal measure, everything it must NOT widen.
 *
 * The positive is one test; the negatives are five, because "it now reports the
 * bad one" says nothing about whether it started reporting the good ones too.
 */
describe('stranded inspection sees a run that FAILED mid-resume (#13909)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;

  beforeEach(() => {
    engine = makeFakeEngine();
    svc = new ApprovalService({ engine: engine as any });
  });

  it('reports a terminal request whose run recorded a terminal `failed` row', async () => {
    // The shape the card owns: the resume consumed the pause, a downstream node
    // threw, the catch arm recorded `failed`. `hasSuspendedRun` is false because
    // the suspension really is gone — that is the defect, not a healthy state.
    engine._tables['sys_approval_request'] = [requestRow({ status: 'rejected' })];
    engine._tables['opportunity'] = [{ id: 'opp1', approval_status: 'pending' }];
    svc.attachAutomation(automation({ history: { run_1: { status: 'failed' } } }));

    const out = await svc.inspectStrandedRequests();
    expect(out.scanned).toBe(1);
    expect(out.undetermined).toBe(0);
    expect(out.stranded).toHaveLength(1);
    expect(out.stranded[0]).toMatchObject({
      requestId: 'areq_1',
      status: 'rejected',
      runId: 'run_1',
      runState: 'failed',
      nodeId: 'co_sign',
      objectName: 'opportunity',
      recordId: 'opp1',
    });
    // The operator-facing symptom is carried for this shape too: the record's
    // mirror still reads what it read before the decision.
    expect(out.stranded[0].mirroredStatus).toBe('pending');
  });

  it('the OLD oracle would have skipped it — the terminal row is written BY the failure', async () => {
    // Pins the mechanism rather than the outcome: `getRun` DOES answer for this
    // run, which is exactly why `if (terminal) continue` reported all clear.
    const auto = automation({ history: { run_1: { status: 'failed' } } });
    expect(await auto.getRun('run_1')).not.toBeNull();
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(auto);
    expect((await svc.inspectStrandedRequests()).stranded).toHaveLength(1);
  });

  // ── The negatives, one reason per test ─────────────────────────────────────

  it('does NOT report a run that was CANCELLED — stopping it was the intent', async () => {
    // `cancelRun` (ADR-0044) is an operator deliberately ending the run, the
    // run-side twin of a `recalled` request. Reporting these would bury the
    // real findings under expected ones.
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation({ history: { run_1: { status: 'cancelled' } } }));
    const out = await svc.inspectStrandedRequests();
    expect(out.scanned).toBe(1);
    expect(out.stranded).toEqual([]);
    expect(out.undetermined).toBe(0);
  });

  it('does NOT report a run whose last history row says `paused` — that is ambiguous, not stranded', async () => {
    // A resume in flight has already consumed the suspension and not yet
    // written its terminal row: `hasSuspendedRun` false + history `paused` reads
    // identically to a process that died in that window. Condemning it would
    // name every concurrently resuming approval.
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation({ history: { run_1: { status: 'paused' } } }));
    const out = await svc.inspectStrandedRequests();
    expect(out.scanned).toBe(1);
    expect(out.stranded).toEqual([]);
    expect(out.undetermined).toBe(0);
  });

  it('does NOT report a status it does not recognise — a new run state is not evidence of a strand', async () => {
    // The spec's `ExecutionStatus` vocabulary is wider than the four statuses
    // the engine writes (`timed_out`, `retrying`, …). The default arm stays
    // silent so a future status cannot become a silent false positive.
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation({ history: { run_1: { status: 'timed_out' } } }));
    expect((await svc.inspectStrandedRequests()).stranded).toEqual([]);
  });

  it('does NOT report a FAILED run that is still suspended — the first oracle still gates', async () => {
    // A run re-parked at a later node after an earlier failed leg is alive and
    // resumable; the suspension oracle short-circuits before the run state is
    // ever classified.
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation({
      suspended: { run_1: true }, history: { run_1: { status: 'failed' } },
    }));
    expect((await svc.inspectStrandedRequests()).stranded).toEqual([]);
  });

  it('still SKIPS a failed-run row whose suspension store threw — an outage stays unknown', async () => {
    // The widening must not turn an unreadable store into a verdict: the
    // undetermined counter, not the stranded list, is where this belongs.
    engine._tables['sys_approval_request'] = [requestRow()];
    svc.attachAutomation(automation({ suspendedThrows: true, history: { run_1: { status: 'failed' } } }));
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded).toEqual([]);
    expect(out.undetermined).toBe(1);
  });

  it('separates the two shapes in one mixed population — and reports only those two', async () => {
    // The aggregate pin: four terminal requests, four different run states, and
    // exactly the two unrecoverable ones come back, each labelled.
    engine._tables['sys_approval_request'] = [
      requestRow({ id: 'areq_missing', flow_run_id: 'run_missing' }),
      requestRow({ id: 'areq_failed', flow_run_id: 'run_failed' }),
      requestRow({ id: 'areq_done', flow_run_id: 'run_done' }),
      requestRow({ id: 'areq_cancelled', flow_run_id: 'run_cancelled' }),
    ];
    svc.attachAutomation(automation({
      history: {
        run_failed: { status: 'failed' },
        run_done: { status: 'completed' },
        run_cancelled: { status: 'cancelled' },
        // `run_missing` deliberately absent — `getRun` answers null for it.
      },
    }));

    const out = await svc.inspectStrandedRequests();
    expect(out.scanned).toBe(4);
    expect(out.stranded.map(s => [s.requestId, s.runState])).toEqual([
      ['areq_missing', 'missing'],
      ['areq_failed', 'failed'],
    ]);
  });

  it('NEVER rewrites a failed-run row either — the decision really happened', async () => {
    engine._tables['sys_approval_request'] = [requestRow()];
    engine._tables['opportunity'] = [{ id: 'opp1', approval_status: 'pending' }];
    svc.attachAutomation(automation({ history: { run_1: { status: 'failed' } } }));
    const before = JSON.stringify(engine._tables);

    await svc.inspectStrandedRequests();

    expect(JSON.stringify(engine._tables)).toBe(before);
    expect(engine._tables['sys_approval_action'] ?? []).toHaveLength(0);
  });
});
