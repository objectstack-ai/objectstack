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

/** What the #15358 third oracle answers, per run — see `ApprovalResumeSurface`. */
type Verdict =
  | { repairable: true }
  | { repairable: false; reason: 'RUN_SUSPENDED' | 'SNAPSHOT_DROPPED' | 'NO_CONSUMED_SUSPENSION' };

/**
 * An automation surface with both oracles, each independently steerable — and,
 * ONLY when `repairability` / `repairabilityThrows` is given, the #15358 third
 * oracle (`inspectConsumedSuspension`). Its absence by default is deliberate:
 * every test above the #15358 block drives a surface that cannot be asked,
 * which is exactly the population the undifferentiated `'failed'` is kept for.
 */
function automation(opts: {
  suspended?: Record<string, boolean>;
  suspendedThrows?: boolean;
  history?: Record<string, { status?: string }>;
  historyThrows?: boolean;
  repairability?: Record<string, Verdict>;
  repairabilityThrows?: boolean;
  /** Runs whose third-oracle read THROWS — a store outage on those rows alone. */
  repairabilityThrowsFor?: string[];
  /**
   * Runs whose host RESOLVES `undefined` — a contract-violating implementation
   * of its own declared surface (#16709 item 3). ⛔ Deliberately outside
   * `Verdict`: pinning what happens when a host lies is the whole point, and
   * the cast that makes it expressible is confined to this double.
   */
  repairabilityMalformedFor?: string[];
} = {}) {
  const inspectCalls: string[] = [];
  const surface: any = {
    inspectCalls,
    async resume() { return { success: true }; },
    async hasSuspendedRun(runId: string) {
      if (opts.suspendedThrows) throw new Error('suspended-run store unreadable');
      return opts.suspended?.[runId] ?? false;
    },
    async getRun(runId: string) {
      if (opts.historyThrows) throw new Error('run history unreadable');
      return opts.history?.[runId] ?? null;
    },
  };
  if (
    opts.repairability !== undefined || opts.repairabilityThrows
    || opts.repairabilityThrowsFor || opts.repairabilityMalformedFor
  ) {
    surface.inspectConsumedSuspension = async (runId: string): Promise<Verdict> => {
      inspectCalls.push(runId);
      if (opts.repairabilityThrows || opts.repairabilityThrowsFor?.includes(runId)) {
        throw new Error('run history unreadable for the consumed suspension');
      }
      if (opts.repairabilityMalformedFor?.includes(runId)) return undefined as unknown as Verdict;
      const v = opts.repairability?.[runId];
      if (!v) throw new Error(`test surface: no verdict scripted for ${runId}`);
      return v;
    };
  }
  return surface;
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

// ── #15358: the third oracle tells the `failed` rows apart ─────────────────
//
// `status === 'failed'` over-reports in one direction: a cascade-failed run
// (an ancestor `failAncestors` failed while parked at its `subflow` node —
// `failSuspendedRun` consumed its pause and journalled nothing, so nothing
// re-arms it; #15222) has the same terminal row as the #13909 strand that
// `restoreConsumedSuspension` repairs. The engine publishes the difference as
// a dedicated read-only member (ruling B′, 2026-09-07), never on the object
// `getRun` answers. This block pins the plugin's side of that contract on a
// scripted surface; `stranded-run-repairability.test.ts` drives the real
// engine through both shapes.

describe('#15358 — the third oracle splits `failed` three ways, and its ABSENCE is fail-closed', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;

  beforeEach(() => {
    engine = makeFakeEngine();
    svc = new ApprovalService({ engine: engine as any });
    engine._tables['sys_approval_request'] = [requestRow()];
  });

  const failedRun = { history: { run_1: { status: 'failed' as const } } };

  it('⭐ a surface WITHOUT the member reports the row `failed` — never `unrepairable`, never skipped', async () => {
    // Absence of the discriminator is not evidence of anything. On a real
    // engine it is absent from `getRun` for BOTH the repairable strand and the
    // cascade-failed ancestor, so reading absence as "not a strand" would call
    // the repairable row dead — #15555's false negative, one surface over.
    const auto = automation(failedRun);
    expect(typeof auto.inspectConsumedSuspension).toBe('undefined');
    svc.attachAutomation(auto);
    const out = await svc.inspectStrandedRequests();
    expect(out.undetermined).toBe(0);
    expect(out.stranded.map(s => s.runState)).toEqual(['failed']);
  });

  it('`repairable: true` → `repairable`', async () => {
    svc.attachAutomation(automation({ ...failedRun, repairability: { run_1: { repairable: true } } }));
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded.map(s => s.runState)).toEqual(['repairable']);
    expect(out.undetermined).toBe(0);
  });

  it('`SNAPSHOT_DROPPED` → `snapshot_dropped` — its own class, folded into neither neighbour', async () => {
    svc.attachAutomation(automation({
      ...failedRun, repairability: { run_1: { repairable: false, reason: 'SNAPSHOT_DROPPED' } },
    }));
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded.map(s => s.runState)).toEqual(['snapshot_dropped']);
  });

  it('`NO_CONSUMED_SUSPENSION` → `unrepairable` — the cascade-failed / never-paused shape', async () => {
    svc.attachAutomation(automation({
      ...failedRun, repairability: { run_1: { repairable: false, reason: 'NO_CONSUMED_SUSPENSION' } },
    }));
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded.map(s => s.runState)).toEqual(['unrepairable']);
  });

  it('`RUN_SUSPENDED` → not stranded: re-armed between the two reads, the run is alive', async () => {
    svc.attachAutomation(automation({
      ...failedRun, repairability: { run_1: { repairable: false, reason: 'RUN_SUSPENDED' } },
    }));
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded).toEqual([]);
    // Skipped as alive — NOT counted as unknown.
    expect(out.undetermined).toBe(0);
  });

  it('⭐ [#16709 item 2] a THROWN read keeps the row REPORTED as `failed` — it never leaves the list', async () => {
    // ⚠️ This assertion USED TO READ `expect(out.stranded).toEqual([])`: a
    // thrown third read was counted `undetermined` and the row dropped, as for
    // the other two oracles. Ruled the other way (PM seat, 2026-09-08).
    //
    // The two earlier oracles and this one are not asked the same question. A
    // thrown `hasSuspendedRun` or `getRun` leaves it unknown WHETHER the row is
    // stranded at all, and a storage outage must not be published as a lost
    // run. By the time this oracle is asked, both have already answered: no
    // live pause, terminal `failed`. It is asked only WHICH of the three
    // shapes — so a read that could not be made is the textbook "could not
    // differentiate", which is exactly what `'failed'` is kept for (#15358
    // ruling, item 1). Dropping the row would let "nothing stranded" read TRUE
    // while a row is in fact stuck, with a log line as its only trace; for a
    // REPORT, fail-closed means showing the row.
    svc.attachAutomation(automation({ ...failedRun, repairabilityThrows: true }));
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded.map(s => [s.requestId, s.runState])).toEqual([['areq_1', 'failed']]);
    // The counter is KEPT, as telemetry — it and `stranded` now overlap by
    // design, and neither alone sizes the scan's blind spot.
    expect(out.undetermined).toBe(1);
  });

  it('an answer this build does not know stays `failed` — reported, undifferentiated', async () => {
    // An engine ahead of this plugin. Fail-closed exactly as an absent member:
    // a word this code cannot read condemns nothing.
    svc.attachAutomation(automation({
      ...failedRun,
      repairability: { run_1: { repairable: false, reason: 'SOMETHING_NEWER' as any } },
    }));
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded.map(s => s.runState)).toEqual(['failed']);
    expect(out.undetermined).toBe(0);
  });

  it('is asked for `failed` rows ONLY — with the failed row as the positive control', async () => {
    engine._tables['sys_approval_request'] = [
      requestRow({ id: 'areq_missing', flow_run_id: 'run_missing' }),
      requestRow({ id: 'areq_failed', flow_run_id: 'run_failed' }),
      requestRow({ id: 'areq_done', flow_run_id: 'run_done' }),
      requestRow({ id: 'areq_cancelled', flow_run_id: 'run_cancelled' }),
      requestRow({ id: 'areq_parked', flow_run_id: 'run_parked' }),
    ];
    const auto = automation({
      suspended: { run_parked: true },
      history: {
        run_failed: { status: 'failed' },
        run_done: { status: 'completed' },
        run_cancelled: { status: 'cancelled' },
        run_parked: { status: 'failed' },
      },
      repairability: { run_failed: { repairable: false, reason: 'NO_CONSUMED_SUSPENSION' } },
    });
    svc.attachAutomation(auto);
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded.map(s => [s.requestId, s.runState])).toEqual([
      ['areq_missing', 'missing'],
      ['areq_failed', 'unrepairable'],
    ]);
    // Exactly one read, for exactly the failed-and-not-suspended row: a
    // `missing` run has nothing to ask about, a finished or cancelled run is
    // not reported at all, and a parked run never reaches the second oracle.
    expect(auto.inspectCalls).toEqual(['run_failed']);
  });

  it('one mixed population, every label distinct — nothing folded', async () => {
    engine._tables['sys_approval_request'] = [
      requestRow({ id: 'areq_missing', flow_run_id: 'run_missing' }),
      requestRow({ id: 'areq_repairable', flow_run_id: 'run_repairable' }),
      requestRow({ id: 'areq_dropped', flow_run_id: 'run_dropped' }),
      requestRow({ id: 'areq_cascade', flow_run_id: 'run_cascade' }),
    ];
    svc.attachAutomation(automation({
      history: {
        run_repairable: { status: 'failed' },
        run_dropped: { status: 'failed' },
        run_cascade: { status: 'failed' },
      },
      repairability: {
        run_repairable: { repairable: true },
        run_dropped: { repairable: false, reason: 'SNAPSHOT_DROPPED' },
        run_cascade: { repairable: false, reason: 'NO_CONSUMED_SUSPENSION' },
      },
    }));
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded.map(s => [s.requestId, s.runState])).toEqual([
      ['areq_missing', 'missing'],
      ['areq_repairable', 'repairable'],
      ['areq_dropped', 'snapshot_dropped'],
      ['areq_cascade', 'unrepairable'],
    ]);
    expect(out.undetermined).toBe(0);
  });

  it('still NEVER rewrites anything — the third oracle is a read like the other two', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', approval_status: 'pending' }];
    svc.attachAutomation(automation({
      ...failedRun, repairability: { run_1: { repairable: false, reason: 'NO_CONSUMED_SUSPENSION' } },
    }));
    const before = JSON.stringify(engine._tables);
    await svc.inspectStrandedRequests();
    expect(JSON.stringify(engine._tables)).toBe(before);
  });
});

// ── #16709: a failure to DIFFERENTIATE never costs a row its place, and never
//    costs another row its answer ─────────────────────────────────────────────
//
// Two residues of the #15358 contract review, ruled together (PM seat,
// 2026-09-08):
//
//   item 2 — a thrown third read counted `undetermined` and DROPPED the row.
//   item 3 — `refineFailedRunState(verdict)` ran OUTSIDE the `try`, so a host
//            that violates its own declared surface by resolving `undefined`
//            threw a `TypeError` out of `inspectStrandedRequests` and the scan
//            enumerated NOTHING.
//
// Both are the same mistake at two altitudes: this method exists to enumerate
// the rows that cannot advance, so a row it could not differentiate stays in
// the report as the undifferentiated `'failed'`, and a row it could not read
// at all costs no OTHER row its answer. ⛔ Neither is a new `StrandedRunState`
// member: `'failed'` already means "reported, could not differentiate".

describe('#16709 — a failure to differentiate keeps the row, and stays local to it', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;

  beforeEach(() => {
    engine = makeFakeEngine();
    svc = new ApprovalService({ engine: engine as any });
    engine._tables['sys_approval_request'] = [requestRow()];
  });

  const failedRun = { history: { run_1: { status: 'failed' as const } } };

  it('⭐ item 3 — a host resolving `undefined` is answered, not thrown out of the scan', async () => {
    // The declared surface says this member resolves a verdict. A host that
    // resolves `undefined` breaks that — and `refineFailedRunState` reads
    // `verdict.repairable`, so the old code's `TypeError` escaped the method.
    svc.attachAutomation(automation({ ...failedRun, repairabilityMalformedFor: ['run_1'] }));
    await expect(svc.inspectStrandedRequests()).resolves.toMatchObject({ scanned: 1, undetermined: 1 });
    const out = await svc.inspectStrandedRequests();
    // Same disposition as a thrown read: reported, undifferentiated.
    expect(out.stranded.map(s => [s.requestId, s.runState])).toEqual([['areq_1', 'failed']]);
  });

  it('⭐ items 2+3 — one bad row costs ITSELF a label and every other row nothing', async () => {
    // The harm the two items share, measured on one population: before the
    // fix the malformed row alone turned this whole call into a rejection, so
    // `areq_ok` — a perfectly readable, perfectly repairable strand — was
    // never enumerated either. A PARTIAL answer became NO answer.
    engine._tables['sys_approval_request'] = [
      requestRow({ id: 'areq_throw', flow_run_id: 'run_throw' }),
      requestRow({ id: 'areq_malformed', flow_run_id: 'run_malformed' }),
      requestRow({ id: 'areq_ok', flow_run_id: 'run_ok' }),
      requestRow({ id: 'areq_missing', flow_run_id: 'run_missing' }),
    ];
    const auto = automation({
      history: {
        run_throw: { status: 'failed' },
        run_malformed: { status: 'failed' },
        run_ok: { status: 'failed' },
        // `run_missing` absent on purpose — it never reaches the third oracle.
      },
      repairability: { run_ok: { repairable: true } },
      repairabilityThrowsFor: ['run_throw'],
      repairabilityMalformedFor: ['run_malformed'],
    });
    svc.attachAutomation(auto);

    const out = await svc.inspectStrandedRequests();
    expect(out.scanned).toBe(4);
    expect(out.stranded.map(s => [s.requestId, s.runState])).toEqual([
      ['areq_throw', 'failed'],
      ['areq_malformed', 'failed'],
      ['areq_ok', 'repairable'],
      ['areq_missing', 'missing'],
    ]);
    // Both undifferentiated rows are counted, and only those two.
    expect(out.undetermined).toBe(2);
    // The third oracle really was reached for each `failed` row, and only
    // those — so the labels above are its answers, not a skipped branch.
    expect(auto.inspectCalls).toEqual(['run_throw', 'run_malformed', 'run_ok']);
  });

  it('⛔ item 2 does NOT widen to the two earlier oracles — those still SKIP their row', async () => {
    // The control that makes the ruling legible. The distinction is not "a
    // throw is fine now": it is WHICH question was being asked. A thrown first
    // or second oracle leaves it unknown whether the row is stranded at all,
    // and condemning on an outage is the harm those arms were written for.
    engine._tables['sys_approval_request'] = [requestRow({ id: 'areq_h', flow_run_id: 'run_h' })];
    svc.attachAutomation(automation({ suspendedThrows: true }));
    expect(await svc.inspectStrandedRequests()).toMatchObject({ scanned: 1, stranded: [], undetermined: 1 });

    svc.attachAutomation(automation({ historyThrows: true }));
    expect(await svc.inspectStrandedRequests()).toMatchObject({ scanned: 1, stranded: [], undetermined: 1 });

    // Positive control on the same row: with both stores readable and only the
    // THIRD read failing, the row IS reported — so the empty lists above are
    // those two oracles' posture, not a row that was never strandable.
    svc.attachAutomation(automation({
      history: { run_h: { status: 'failed' } }, repairabilityThrowsFor: ['run_h'],
    }));
    const out = await svc.inspectStrandedRequests();
    expect(out.stranded.map(s => s.runState)).toEqual(['failed']);
    expect(out.undetermined).toBe(1);
  });

  it('⛔ still no sixth `StrandedRunState`: the undifferentiated rows are literally `failed`', async () => {
    // Item 2's ruling is a re-use of an existing member, not a new one — the
    // reason it touches no barrel-exported type. Every label this scan can
    // emit is one of the five, and both undifferentiated shapes emit the same
    // string an ABSENT member emits.
    engine._tables['sys_approval_request'] = [
      requestRow({ id: 'areq_absent', flow_run_id: 'run_absent' }),
      requestRow({ id: 'areq_throw', flow_run_id: 'run_throw' }),
      requestRow({ id: 'areq_malformed', flow_run_id: 'run_malformed' }),
    ];
    const history = {
      run_absent: { status: 'failed' }, run_throw: { status: 'failed' }, run_malformed: { status: 'failed' },
    };
    // The member is absent for `run_absent`'s scan…
    svc.attachAutomation(automation({ history }));
    const blind = await svc.inspectStrandedRequests();
    // …and present-but-failing for the other two.
    svc.attachAutomation(automation({
      history, repairabilityThrowsFor: ['run_throw', 'run_absent'],
      repairabilityMalformedFor: ['run_malformed'],
    }));
    const failing = await svc.inspectStrandedRequests();

    expect(new Set([...blind.stranded, ...failing.stranded].map(s => s.runState))).toEqual(new Set(['failed']));
  });
});
