// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dead-run sweep classifies EVERY `ExecutionStatus` member (#16433).
 *
 * ## What this file exists to stop
 *
 * `TERMINAL_RUN_STATUSES` was a hand-copied four-member subset of a nine-member
 * enum: `completed`, `failed`, `cancelled`, `timed_out`. #14945 appended
 * `refused` — documented on the enum as *"Terminal, never resumed"* — and the
 * subset did not grow with it, so `releaseDeadRunRequests` `continue`d past a
 * refused run and the approval pending on it read ALIVE forever. Nothing went
 * red: a subset missing a member is still a valid subset.
 *
 * ## Why the pin has to CONSTRUCT the future
 *
 * The defect is latent. Nothing in the engine drives a run to `refused` today
 * (that is #15788 lane 2's deliverable), so a test exercising only the four
 * statuses that exist in practice passes on the unfixed tree and proves
 * nothing. ⇒ the `refused` case below is written against the state the enum
 * already declares rather than the states the engine currently produces. On the
 * unfixed tree it is RED (`released: 0`, the row still `pending`); that
 * prediction was recorded before it was run, and the ablation is in the PR.
 *
 * ## The three things it holds
 *
 * 1. TOTALITY — every `ExecutionStatus` member is classified. The
 *    `satisfies Record<ExecutionStatus, RunLiveness>` in `approval-service.ts`
 *    makes a tenth member fail to COMPILE; this file makes it fail a TEST too,
 *    by comparing the map's keys with `ExecutionStatus.options` in both
 *    directions. Two independent mechanisms, because the compile-time one is
 *    invisible to anyone reading only the test report.
 * 2. BEHAVIOUR — every member is driven through the real sweep and must act as
 *    it is classified. Classification and behaviour therefore cannot drift
 *    apart: this is not a test of the table against itself.
 * 3. THE NEGATIVE CONTROLS — `pending` / `running` / `paused` / `retrying` are
 *    still skipped. ⛔ A fix that started releasing approvals out from under
 *    LIVE runs would be far worse than the leak it closes, so the live half of
 *    the table is asserted with the same force as the terminal half.
 */

import { describe, it, expect, beforeEach } from 'vitest';
// [#4434 / `pnpm check:engine-double-contract`] A fake looser than `ObjectQL`
// is how a dead REST route once shipped with its suite green, so this double's
// write verbs route through the REAL dispatch predicates rather than
// hand-copying an id/multi check. `metadata-core` is where they live (#5619)
// and this package's vitest config aliases it to SOURCE, so the pin is a
// verdict about the checkout rather than about build state.
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  type EngineDeleteDispatchInput,
  type EngineUpdateDispatchInput,
} from '@objectstack/metadata-core';
import { ExecutionStatus } from '@objectstack/spec/automation';
import { APPROVAL_STATUSES } from '@objectstack/spec/contracts';
import {
  ApprovalService,
  RUN_STATUS_LIVENESS,
  REQUEST_STATUS_STRANDABILITY,
} from './approval-service.js';

interface FakeRow { [k: string]: unknown }

/**
 * The narrowest engine `releaseDeadRunRequests` can run against: it lists
 * pending requests, writes one audit row, flips the request, and re-syncs the
 * approver index. No hooks and no record lock — those are pinned by
 * `approval-service.test.ts`; what is under test here is which statuses reach
 * the release at all.
 */
function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  const matches = (row: FakeRow, filter: unknown): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter as Record<string, unknown>)) {
      // ⛔ REFUSE a combinator rather than read it as a field name
      // (`pnpm check:where-matcher`). This double implements no `$or`/`$and`,
      // and a matcher that silently treats `$or` as a column is how a double
      // reports a filter it never applied. `$in` below is a VALUE operator,
      // which it does implement.
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter combinator ${k}`);
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as Record<string, unknown>)) {
        if (!((v as { $in: unknown[] }).$in).includes(rv)) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  };
  return {
    _tables: tables,
    async find(object: string, options?: { where?: unknown; filter?: unknown; limit?: number }) {
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      return rows.slice(0, options?.limit ?? 1000);
    },
    async insert(object: string, data: FakeRow) { ensure(object).push({ ...data }); return { ...data }; },
    async update(object: string, data: FakeRow, options?: EngineUpdateDispatchInput) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const table = ensure(object);
      const targets = dispatch.kind === 'by-id'
        ? table.filter(r => r.id === dispatch.id)
        : table.filter(r => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(object: string, options?: EngineDeleteDispatchInput) {
      const dispatch = assertEngineDeleteDispatch(options);
      const table = ensure(object);
      const targets = dispatch.kind === 'by-id'
        ? table.filter(r => r.id === dispatch.id)
        : table.filter(r => matches(r, options?.where));
      tables[object] = table.filter(r => !targets.includes(r));
      return dispatch.kind === 'by-id' ? targets.length > 0 : targets.length;
    },
    registerHook() {}, unregisterHooksByPackage() { return 0; }, async fire() {},
  };
}

/** One pending, node-driven request — exactly what the sweep is meant to find. */
const pendingRequest = (): FakeRow => ({
  id: 'areq_1',
  object_name: 'opportunity',
  record_id: 'opp1',
  organization_id: null,
  status: 'pending',
  flow_run_id: 'run_1',
  flow_node_id: 'approval_1',
  pending_approvers: 'u9',
  created_at: '2026-01-15T10:00:00.000Z',
  updated_at: '2026-01-15T10:00:00.000Z',
});

describe('the dead-run sweep classifies every ExecutionStatus member (#16433)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;

  /** Run the sweep once against a run answering `status`. */
  const sweep = async (status: string) => {
    svc.attachAutomation({ getRun: async () => ({ status }) } as never);
    return svc.releaseDeadRunRequests();
  };

  const requestRow = () => engine._tables['sys_approval_request']![0]!;

  beforeEach(() => {
    engine = makeFakeEngine();
    let n = 0;
    svc = new ApprovalService({
      engine: engine as never,
      clock: { now: () => new Date(Date.parse('2026-01-15T10:00:00Z') + (n++) * 1000) },
    });
    engine._tables['sys_approval_request'] = [pendingRequest()];
  });

  // ── 1. Totality ──────────────────────────────────────────────────────────

  it('the enum is reachable and has the members this file assumes', () => {
    // Guard the guard (#3786's rule): an unresolvable import would make the two
    // set comparisons below compare nothing with nothing and pass.
    expect(ExecutionStatus.options.length).toBeGreaterThan(8);
    expect(ExecutionStatus.options).toContain('refused');
  });

  it('classifies every ExecutionStatus member — no member is unclassified', () => {
    // ⇒ A TENTH member added to the enum lands here as a missing key and this
    // fails until someone decides whether it is terminal or live. That is the
    // whole point of the card: the next addition cannot be silent.
    expect(Object.keys(RUN_STATUS_LIVENESS).sort()).toEqual([...ExecutionStatus.options].sort());
  });

  it('classifies NOTHING the enum does not declare — no stale member', () => {
    // The other direction: a member removed from `ExecutionStatus` must not
    // linger here as a status the sweep still acts on.
    for (const status of Object.keys(RUN_STATUS_LIVENESS)) {
      expect(ExecutionStatus.options).toContain(status);
    }
  });

  it("`refused` is classified terminal, on the declaration the enum itself carries", () => {
    // ⛔ Not on intuition: `execution.zod.ts` documents this member "Terminal,
    // never resumed" beside `outcome: 'refused'`. This is that sentence made
    // machine-readable for the one reader that has to act on it.
    expect(RUN_STATUS_LIVENESS.refused).toBe('terminal');
  });

  // ── 2. Behaviour, member by member ───────────────────────────────────────

  const terminal = ExecutionStatus.options.filter(
    s => RUN_STATUS_LIVENESS[s as keyof typeof RUN_STATUS_LIVENESS] === 'terminal',
  );
  const live = ExecutionStatus.options.filter(
    s => RUN_STATUS_LIVENESS[s as keyof typeof RUN_STATUS_LIVENESS] === 'live',
  );

  it('the two halves are both non-empty and together cover the enum', () => {
    expect(terminal.length).toBeGreaterThan(0);
    expect(live.length).toBeGreaterThan(0);
    expect(terminal.length + live.length).toBe(ExecutionStatus.options.length);
  });

  it.each(terminal)('releases a pending approval on a %s run', async (status) => {
    // `refused` is THE case this card exists for, and on the unfixed tree this
    // row is red: `{ scanned: 1, released: 0 }` with the request still pending.
    expect(await sweep(status)).toEqual({ scanned: 1, released: 1 });
    expect(requestRow().status).toBe('recalled');
    expect(requestRow().pending_approvers).toBeNull();
    expect(requestRow().completed_at).toBeTruthy();
  });

  it.each(live)('leaves a pending approval alone on a %s run', async (status) => {
    // ⛔ The negative control the fix must not move. Releasing approvals out
    // from under a live run is worse than the leak this card closes.
    expect(await sweep(status)).toEqual({ scanned: 1, released: 0 });
    expect(requestRow().status).toBe('pending');
  });

  it('audits a refused-run release as a dead-run abandonment', async () => {
    await sweep('refused');
    const actions = engine._tables['sys_approval_action'] ?? [];
    const action = actions.find(a => a['actor_id'] === 'system:dead-run');
    expect(action).toBeTruthy();
    expect(action!['action']).toBe('recall');
    expect(String(action!['comment'])).toContain('refused');
    expect(String(action!['comment'])).toContain('run_1');
  });

  it('still ignores a status the enum does not declare at all', async () => {
    // Unknown liveness is not death — the closed-set reading at the call site
    // survives the derivation.
    expect(await sweep('reticulating_splines')).toEqual({ scanned: 1, released: 0 });
    expect(requestRow().status).toBe('pending');
  });
});

// ── The file's OTHER hand-copied subset, same construction (#16433) ────────
//
// `STRANDABLE_REQUEST_STATUSES` is a subset of `APPROVAL_STATUSES`, which grew
// `cancelled` (#13568) after that subset was written. The reading: `cancelled`
// is correctly OUTSIDE it — `cancelForDeletedRecord` does not resume the run
// and warns about it by name, so reporting those rows would bury the real
// findings. The value was right; only the mechanism was a hand-copy.

describe('the stranded-request scan classifies every ApprovalStatus (#16433)', () => {
  it('the contract vocabulary is reachable', () => {
    expect(APPROVAL_STATUSES.length).toBeGreaterThan(4);
  });

  it('classifies every APPROVAL_STATUSES member, and nothing else', () => {
    expect(Object.keys(REQUEST_STATUS_STRANDABILITY).sort()).toEqual([...APPROVAL_STATUSES].sort());
  });

  it('keeps the strandable set byte-identical to the literal it replaced', () => {
    // The derivation is a refactor, not a widening: `inspectStrandedRequests`
    // must query exactly what it queried before, in the same order.
    const strandable = Object.entries(REQUEST_STATUS_STRANDABILITY)
      .filter(([, v]) => v === 'strandable')
      .map(([k]) => k);
    expect(strandable).toEqual(['approved', 'rejected', 'returned']);
  });

  it('keeps `recalled` and `cancelled` out, each for its own recorded reason', () => {
    expect(REQUEST_STATUS_STRANDABILITY.recalled).toBe('not-strandable');
    expect(REQUEST_STATUS_STRANDABILITY.cancelled).toBe('not-strandable');
  });
});
