// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15970 — a `recall` whose resume strands says WHICH failure it was, in
 * fields, not only in prose (the #16472 family ruling, option A).
 *
 * ## The reported defect
 *
 * A flow parks at an `approval` node; the reject branch's downstream node
 * throws. The submitter RECALLS the request, which resumes the run down the
 * `reject` edge — and that resume strands it. The withdrawal is durable and
 * the call correctly does not throw, but everything a caller could act on was
 * dropped: `resumed: false` plus one sentence of prose, while the engine had
 * already stamped `AutomationResult.status: 'stranded'` on the error one line
 * above. `recall` resumes DIRECTLY rather than through
 * `resumeRecordedOutcome`, so it never reached the derivation
 * (`repairable = status === 'stranded'`) every other door shares — a producer
 * with a consumer on every door but this one.
 *
 * ## What is fixed, and what deliberately is not
 *
 * ⛔ The no-throw stays. The ruling upholds it by name: the withdrawal and the
 * record-lock release are the point and they have already happened. ⛔ The log
 * line stays byte-for-byte as it was — the ruling left logging alone. What
 * changes is `ApprovalRecallResult.resumeFailure`, a slot `packages/spec`
 * already declared and left without a producer on this door.
 *
 * ## The population, and why the doors are measured TOGETHER
 *
 * The card's whole claim is *"the difference is the door, not the strand"*, so
 * a harness that only exercised `recall` could pass vacuously — a fixture that
 * never strands anything answers "no report" just as convincingly. Every case
 * below drives the SAME lever (a throwing `mark_rejected`) through the same
 * live engine, and the `decide` control asserts the #13807 envelope on it, so
 * the recall readings are known to be about the door.
 *
 *  - PIN 1  the card's own table, every row, with the fixed `resumeFailure`;
 *  - PIN 2  a healthy recall — absence is a READING here, not the fixture;
 *  - PIN 3  a resume failure the engine does NOT call stranded: still no
 *           report, on purpose (see the assertion's own note);
 *  - CONTROL the identical strand through `decide`, which throws the #13807
 *           envelope — the harness discriminates the two doors.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
// [#4550] The engine double below routes its write verbs through ObjectQL's OWN
// dispatch predicates rather than a hand-mirrored copy.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { strandedDecisionDetails } from '@objectstack/types';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;

/** One captured log line — typed so the assertions below need no `any` parameter. */
interface LoggedLine { level: string; msg: string; meta?: unknown }

/** Captures the door's log lines so PIN 1 can assert the level was left alone. */
function recordingLogger() {
  const lines: LoggedLine[] = [];
  const at = (level: string) => (msg: unknown, meta?: unknown) =>
    void lines.push({ level, msg: String(msg), meta });
  return { lines, info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
}

/** In-memory ObjectQL stand-in for the approvals tables. */
function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  const rows = (o: string) => (tables.get(o) ?? (tables.set(o, []), tables.get(o)!));
  // ⭐ The lever that makes a REAL strand reachable from a test: fail the very
  // next insert into one table, once. The approval node's executor opens the
  // next round by inserting a `sys_approval_request`, so failing that insert
  // strands the resume the same way the card's own reject-branch throw does —
  // `RESUME_FAILED` with `repairable: true`, the suspension already consumed.
  // Set to a table name; the first insert into it throws and clears the lever.
  let failNextInsertOn: string | undefined;
  const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
    if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
    if (v && typeof v === 'object' && '$ne' in (v as any)) return row[k] !== (v as any).$ne;
    return row[k] === v;
  });
  return {
    tables,
    set failNextInsert(object: string | undefined) { failNextInsertOn = object; },
    get failNextInsert() { return failNextInsertOn; },
    async find(object: string, opts: any = {}) {
      const where = opts.where ?? opts.filter ?? {};
      const out = rows(object).filter(r => matches(r, where));
      // ⚠️ `orderBy` is honoured, and that is load-bearing rather than polish:
      // `assertLatestForRun` selects the newest request with
      // `orderBy [{field:'created_at', order:'desc'}], limit 1`. A double that
      // ignored it returned the OLDEST row, so the guard passed on every input
      // and a pin naming it would have measured nothing — the phantom-check
      // shape. SortNode's key is `order`, not `direction` (spec/data/query.zod.ts).
      if (Array.isArray(opts.orderBy)) {
        for (const sort of [...opts.orderBy].reverse()) {
          const field = sort?.field;
          if (!field) continue;
          const dir = sort?.order === 'desc' ? -1 : 1;
          out.sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * dir);
        }
      }
      // The caller's bound is honoured by PRESENCE, never truthiness.
      const start = opts.offset ?? 0;
      const page = typeof opts.limit === 'number' ? out.slice(start, start + opts.limit) : out.slice(start);
      return page.map(r => ({ ...r }));
    },
    async insert(object: string, data: any) {
      if (failNextInsertOn === object) {
        failNextInsertOn = undefined;
        throw new Error(`injected one-shot insert failure on ${object}`);
      }
      rows(object).push({ ...data }); return { ...data };
    },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const table = rows(object);
      if (dispatch.kind === 'multi') {
        let n = 0;
        for (let i = 0; i < table.length; i++) {
          if (matches(table[i], options?.where)) { table[i] = { ...table[i], ...data }; n++; }
        }
        return { updated: n };
      }
      const i = table.findIndex(r => r.id === dispatch.id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return i >= 0 ? { ...table[i] } : null;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const table = rows(object);
      if (dispatch.kind === 'multi') {
        const survivors = table.filter(r => !matches(r, options?.where));
        const deleted = table.length - survivors.length;
        table.splice(0, table.length, ...survivors);
        return { deleted };
      }
      const i = table.findIndex(r => r.id === dispatch.id);
      if (i >= 0) table.splice(i, 1);
      return { id: dispatch.id };
    },
  };
}

const DEAL_APPROVAL = {
  name: 'deal_approval', label: 'Deal Approval', type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'approve_step', type: 'approval', label: 'Manager Approval',
      config: { approvers: [{ type: 'user', value: 'u1' }] } },
    { id: 'on_approved', type: 'mark', label: 'Approved' },
    { id: 'mark_rejected', type: 'mark', label: 'Rejected' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'approve_step' },
    { id: 'e2', source: 'approve_step', target: 'on_approved', label: 'approve' },
    { id: 'e3', source: 'approve_step', target: 'mark_rejected', label: 'reject' },
    { id: 'e4', source: 'on_approved', target: 'end' },
    { id: 'e5', source: 'mark_rejected', target: 'end' },
  ],
};

/** The card's own failing node text: the reject branch writes to a gone record. */
const DOWNSTREAM_FAILURE =
  'update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found';


describe('#15970 — a recall whose resume strands carries the discriminator', () => {
  let data: ReturnType<typeof makeFakeEngine>;
  let service: ApprovalService;
  let logger: ReturnType<typeof recordingLogger>;
  let marks: string[];
  let rejectBranchThrows: string | undefined;

  /** One live process: real engine, real approval node, real approvals service. */
  function boot() {
    const automation = new AutomationEngine(logger as any, new InMemorySuspendedRunStore());
    registerApprovalNode(automation, service, logger as any);
    automation.registerNodeExecutor({
      type: 'mark',
      async execute(node: any) {
        if (node.id === 'mark_rejected' && rejectBranchThrows) throw new Error(rejectBranchThrows);
        marks.push(node.id);
        return { success: true };
      },
    } as never);
    automation.registerFlow('deal_approval', DEAL_APPROVAL as never);
    service.attachAutomation(automation);
    return automation;
  }

  beforeEach(() => {
    marks = []; rejectBranchThrows = undefined;
    logger = recordingLogger();
    data = makeFakeEngine();
    service = new ApprovalService({ engine: data as any, logger: logger as any });
  });

  async function park(automation: AutomationEngine) {
    await automation.execute('deal_approval', {
      object: 'crm_deal', record: { id: 'd1', amount: 100 }, userId: 'submitter',
    } as never);
    return (await data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
  }

  it("PIN 1 — the card's table, row for row, with the machine-readable half filled", async () => {
    rejectBranchThrows = DOWNSTREAM_FAILURE;
    const automation = boot();
    const req = await park(automation);
    const runId = req.flow_run_id as string;

    const outcome = await service
      .recall(req.id, { actorId: 'submitter' }, SYSTEM_CTX)
      .then(r => ({ ok: true as const, r }), (e: Error) => ({ ok: false as const, e }));

    // ── ROW 1: the call. ⛔ Unchanged by this card and asserted so it stays
    //    unchanged: the ruling upholds the no-throw, and a fix that made this
    //    door fail would be the wrong fix, not a stricter one.
    expect(outcome.ok, 'a recall abandons the request — a lost run must not fail the call').toBe(true);
    const result = outcome.ok ? outcome.r : (undefined as never);

    // ── ROWS 2-3: what the caller was ALREADY told, both unchanged.
    expect(result.resumed, 'this run really was not resumed').toBe(false);
    expect(result.resumeError, 'the prose half is still there').toContain(runId);
    expect(result.resumeError).toContain(DOWNSTREAM_FAILURE);

    // ── ROW 4: the withdrawal is durable — the whole reason the call tolerates
    //    the failed resume in the first place.
    expect(result.request.status).toBe('recalled');

    // ── ROW 5: ⛔ `strandedDecisionDetails` still answers `undefined`, and that
    //    is CORRECT rather than unfixed. It is the ERROR-envelope reader for a
    //    door that THROWS (#13807) — it reads a carrier property off a thrown
    //    error — so against any recall RESULT it can only ever answer
    //    `undefined`, whatever this door does. The ruling put the success-answer
    //    carrier on `resumeFailure` for exactly that reason (the spec's own
    //    "⛔ Not `StrandedDecisionDetails`" note).
    expect(strandedDecisionDetails(result as unknown)).toBeUndefined();

    // ── ROWS 6-7: the run really is stranded, and really is repairable — the
    //    two facts the caller had no way to learn.
    expect(await automation.hasSuspendedRun(runId), 'the pause was consumed and not re-armed').toBe(false);
    expect(marks, 'the reject branch never finished — real abandoned work').toEqual([]);

    // ── THE FIX. Every member, and the `runId` by identity rather than by
    //    truthiness: naming the wrong run is the failure mode #15556 measured
    //    one door over.
    expect(result.resumeFailure).toEqual({
      code: 'RESUME_FAILED',
      runId,
      status: 'stranded',
      repairable: true,
    });
    // Presence is the signal (the member's docblock): omitted, never set to
    // `undefined`, so `in` reads it correctly.
    expect(Object.prototype.hasOwnProperty.call(result, 'resumeFailure')).toBe(true);

    // ── `repairable: true` is a PROMISE, so it is cashed here rather than
    //    asserted as a literal: the verb it names actually re-arms this run.
    const restored = await automation.restoreConsumedSuspension(runId, { requestedBy: 'ops' });
    expect(restored.restored, 'the discriminator promised a repair that exists').toBe(true);
    expect(await automation.hasSuspendedRun(runId)).toBe(true);

    // ── ⛔ The log is untouched by this card — same message, same `error`
    //    level, same context keys. The ruling left logging alone, and the
    //    report is a SIBLING of the log line, not a replacement for it.
    const failedLines = logger.lines.filter(l => l.level === 'error'
      && l.msg === '[approvals] resume after recall failed — the run may be stranded');
    expect(failedLines.length, 'said once, at error').toBe(1);
    expect(Object.keys(failedLines[0].meta as object).sort()).toEqual(['error', 'request', 'run']);
  });

  it('PIN 2 — a healthy recall reports nothing, so PIN 1 is a reading and not the fixture', async () => {
    const automation = boot();
    const req = await park(automation);
    const runId = req.flow_run_id as string;

    const result = await service.recall(req.id, { actorId: 'submitter' }, SYSTEM_CTX);

    expect(result.resumed, 'the reject edge was walked to the end').toBe(true);
    expect(marks).toEqual(['mark_rejected']);
    expect(result.request.status).toBe('recalled');
    expect(result.resumeError).toBeUndefined();
    // Absence is the correct reading for a run with nothing to report — and it
    // is what makes PIN 1's presence a measurement.
    expect(result.resumeFailure).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, 'resumeFailure')).toBe(false);
    expect(await automation.hasSuspendedRun(runId)).toBe(false);
    expect(logger.lines.filter(l => l.level === 'error')).toEqual([]);
  });

  it('PIN 3 — a resume failure the engine does NOT call stranded reports no code at all', async () => {
    // POPULATION: the run behind the request is gone by the time the recall
    // reaches it, so the engine answers `RUN_NOT_FOUND` — a failure with a
    // `code` and NO `status`.
    //
    // ⛔ This exit deliberately carries no `resumeFailure`, and the reason is a
    // boundary rather than an omission: its honest code is
    // `RESUME_TARGET_LOST` (the member's own docblock says so), and this
    // package's ADR-0112 ledger row admits exactly one code — `RESUME_FAILED`
    // (`error-code-ledger.zod.ts`, `'@objectstack/plugin-approvals'`, whose
    // comment spells out that this package stamps neither of the other two).
    // Stamping `RESUME_FAILED` here to fill the slot would make the
    // discriminator lie about WHICH failure this was — the defect PIN 1 fixes,
    // one field over. Absence is declared legitimate by the member's docblock
    // ("An absent member means no report was made, never that no run is
    // stranded") and is exactly what `resumeRecordedOutcome` answers on the
    // same exits.
    const automation = boot();
    const req = await park(automation);
    const runId = req.flow_run_id as string;
    expect(await automation.cancelRun(runId), 'the run is gone before the recall lands').toBe(true);

    const result = await service.recall(req.id, { actorId: 'submitter' }, SYSTEM_CTX);

    expect(result.resumed).toBe(false);
    expect(result.resumeError, 'still told, in prose').toMatch(/RUN_NOT_FOUND/);
    expect(result.request.status, 'and the withdrawal is still durable').toBe('recalled');
    expect(result.resumeFailure).toBeUndefined();
  });

  it('CONTROL — the identical strand through `decide` throws the #13807 envelope', async () => {
    // Without this the recall readings above could not be attributed to the
    // DOOR: a fixture that never really strands anything produces the same
    // "no report" answer. Same lever, same flow, same engine — different door.
    rejectBranchThrows = DOWNSTREAM_FAILURE;
    const automation = boot();
    const req = await park(automation);
    const runId = req.flow_run_id as string;

    const err = await service
      .decide(req.id, { decision: 'reject', actorId: 'u1', comment: 'no' }, SYSTEM_CTX)
      .then(() => null, (e: Error) => e);

    expect(err, 'this door reports the same strand by THROWING').toBeTruthy();
    expect(err?.message).toMatch(/^RESUME_FAILED/);
    expect(strandedDecisionDetails(err)).toEqual({
      finalized: true, decision: 'reject', runId, repairable: true,
    });
    // The strand itself is identical on both doors — which is the card's claim:
    // the difference was the door, never the strand.
    expect(await automation.hasSuspendedRun(runId)).toBe(false);
    expect((await automation.restoreConsumedSuspension(runId, { requestedBy: 'ops' })).restored).toBe(true);
  });
});
