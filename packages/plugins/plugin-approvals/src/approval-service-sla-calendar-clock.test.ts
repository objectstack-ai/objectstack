// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ApprovalEscalation.timeoutHours` is CALENDAR (wall-clock) hours — pinned
 * through the real code path, not restated.
 *
 * The declaration's `describe` text on `ApprovalEscalationSchema` says the
 * clock out loud; `slaDueAt` in `approval-service.ts` is the one runtime site
 * that turns the declared number into a deadline; the escalation sweep compares
 * that deadline against the injected clock. This file drives all three through
 * `openNodeRequest` → `getRequest` → `runEscalations`, so the sentence in the
 * schema and the arithmetic in the service cannot drift apart without a red
 * here.
 *
 * Timezone assumption, stated: NONE is required. Every timestamp the service
 * reads or writes is an ISO-8601 UTC string (`toISOString()` / `Date.parse` of
 * a `Z`-suffixed literal) and the deadline is `created_at` plus elapsed
 * milliseconds, so the assertions hold under any `TZ` the runner sets — they
 * are written against UTC instants and never call a local-time accessor. The
 * DST cases document what the SAME instants read as on a wall clock in
 * America/New_York, to make the elapsed-time-versus-local-time distinction
 * visible where a reader would otherwise infer it.
 */

import { describe, it, expect } from 'vitest';
import { ApprovalService } from './approval-service.js';

interface Row { [k: string]: any }

/**
 * Read-and-append engine double: `find` + `insert` only.
 *
 * The three paths under test dispatch nothing else — `openNodeRequest` finds
 * and inserts, `getRequest` finds, and the `notify` escalation arm finds and
 * inserts the audit action. No `update` / `delete` member exists on purpose:
 * `check:engine-double-contract` pins those write verbs to the real engine's
 * dispatch, and a double that does not declare them has nothing to pin.
 */
function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  const matches = (row: Row, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some((sub) => matches(row, sub))) return false;
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
      if (rv !== v) return false;
    }
    return true;
  };
  return {
    _tables: tables,
    async find(object: string, options?: any) {
      return ensure(object).filter((r) => matches(r, options?.filter ?? options?.where));
    },
    async insert(object: string, data: Row) { ensure(object).push({ ...data }); return { ...data }; },
    async count(object: string) { return ensure(object).length; },
    registerHook() { /* no-op */ },
    unregisterHooksByPackage() { /* no-op */ },
  };
}

const HOUR = 3_600_000;
const SYS = { isSystem: true, positions: [], permissions: [] } as any;
const CTX = { userId: 'u1', tenantId: 't1', positions: [], permissions: [] } as any;

/** A node whose only escalation dependency is the clock: `notify`, no reassign. */
function input(nodeId: string, timeoutHours: number) {
  return {
    object: 'opportunity',
    recordId: 'opp1',
    runId: 'run_1',
    nodeId,
    flowName: 'deal_approval',
    config: {
      approvers: [{ type: 'user' as const, value: 'u9' }],
      behavior: 'first_response' as const,
      lockRecord: false,
      escalation: { timeoutHours, action: 'notify' as const, escalateTo: 'boss', notifySubmitter: false },
    },
    record: { id: 'opp1', amount: 100 },
  };
}

/**
 * Open a node request and return the PENDING row. `openNodeRequest` can also
 * answer with an auto outcome (an empty approver slate under
 * `onEmptyApprovers: 'auto_approve'`), which carries no `id` and no SLA — the
 * arm this file is not about, so it is refused loudly rather than narrowed
 * away with a cast.
 */
async function openPending(svc: ApprovalService, nodeInput: ReturnType<typeof input>) {
  const opened = await svc.openNodeRequest(nodeInput, CTX);
  if (!('id' in opened)) throw new Error('expected a pending approval request, got an auto outcome');
  return opened;
}

/** A service whose clock is set by the test, in UTC instants. */
function serviceAt(iso: string) {
  let nowMs = Date.parse(iso);
  const engine = makeEngine();
  const svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(nowMs) } });
  return { svc, engine, setNow: (at: string) => { nowMs = Date.parse(at); } };
}

const utcDay = (iso: string) => new Date(iso).getUTCDay(); // 0 = Sunday … 5 = Friday, 6 = Saturday

// 2026-01-16 is a Friday; the calendar claims below are about the dates they name.
const FRIDAY_1700 = '2026-01-16T17:00:00.000Z';
const MONDAY_0900 = '2026-01-19T09:00:00.000Z';

describe('ApprovalEscalation.timeoutHours is calendar (wall-clock) hours', () => {
  it('the fixture dates are the weekdays the assertions name', () => {
    expect(utcDay(FRIDAY_1700)).toBe(5);
    expect(utcDay(MONDAY_0900)).toBe(1);
  });

  it('Friday 17:00 + timeoutHours 4 is due Friday 21:00 — the same evening, not the next business day', async () => {
    const { svc, setNow } = serviceAt(FRIDAY_1700);
    const req = await openPending(svc, input('sla_4h', 4));

    const row = await svc.getRequest(req.id, SYS);
    expect(row?.created_at).toBe(FRIDAY_1700);
    expect(row?.sla_due_at).toBe('2026-01-16T21:00:00.000Z');
    expect(utcDay(row!.sla_due_at!)).toBe(5);
    // A business-hours reading would put this deadline on Monday at the
    // earliest; the wall clock puts it before Monday's first working hour.
    expect(Date.parse(row!.sla_due_at!)).toBeLessThan(Date.parse(MONDAY_0900));

    // The sweep reads the same deadline: one millisecond early is not overdue,
    // the deadline instant itself is — on Friday night, with nobody at work.
    setNow('2026-01-16T20:59:59.999Z');
    expect(await svc.runEscalations()).toMatchObject({ escalated: 0 });
    setNow('2026-01-16T21:00:00.000Z');
    expect(await svc.runEscalations()).toMatchObject({ escalated: 1 });

    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)).toMatchObject({ action: 'escalate', actor_id: 'system:sla' });
  });

  it('a 168-hour deadline spans the weekend: due the next Friday at the same hour, 7 × 24 elapsed hours', async () => {
    const { svc, setNow } = serviceAt(FRIDAY_1700);
    const req = await openPending(svc, input('sla_168h', 168));

    const row = await svc.getRequest(req.id, SYS);
    const due = row!.sla_due_at!;
    expect(due).toBe('2026-01-23T17:00:00.000Z');
    expect(utcDay(due)).toBe(5);
    expect(Date.parse(due) - Date.parse(FRIDAY_1700)).toBe(168 * HOUR);

    // Saturday and Sunday sit inside the window and are not skipped: the
    // deadline is not 168 working hours later (that would be four weeks out).
    const saturday = '2026-01-17T12:00:00.000Z';
    const sunday = '2026-01-18T12:00:00.000Z';
    expect(utcDay(saturday)).toBe(6);
    expect(utcDay(sunday)).toBe(0);
    for (const weekendInstant of [saturday, sunday]) {
      expect(Date.parse(weekendInstant)).toBeGreaterThan(Date.parse(FRIDAY_1700));
      expect(Date.parse(weekendInstant)).toBeLessThan(Date.parse(due));
    }

    setNow(MONDAY_0900);
    expect(await svc.runEscalations()).toMatchObject({ escalated: 0 });
    setNow(due);
    expect(await svc.runEscalations()).toMatchObject({ escalated: 1 });
  });

  it('a DST transition changes nothing: elapsed hours, not local wall-clock hours (spring forward)', async () => {
    // 2026-03-08T05:00:00Z is 00:00 EST in America/New_York; at 02:00 local the
    // clocks jump to 03:00 EDT. Four ELAPSED hours later is 09:00Z = 05:00 EDT —
    // five o'clock on the local wall, four hours of real time. The service adds
    // elapsed milliseconds, so the deadline is the 09:00Z instant on every host.
    const created = '2026-03-08T05:00:00.000Z';
    const { svc } = serviceAt(created);
    const req = await openPending(svc, input('sla_dst_spring', 4));
    const row = await svc.getRequest(req.id, SYS);
    expect(row?.sla_due_at).toBe('2026-03-08T09:00:00.000Z');
    expect(Date.parse(row!.sla_due_at!) - Date.parse(created)).toBe(4 * HOUR);
  });

  it('a DST transition changes nothing: elapsed hours, not local wall-clock hours (fall back)', async () => {
    // 2026-11-01T05:00:00Z is 01:00 EDT in America/New_York; at 02:00 EDT the
    // clocks go back to 01:00 EST. Four ELAPSED hours later is 09:00Z = 04:00
    // EST — three o'clock-hours on the local wall, four hours of real time.
    const created = '2026-11-01T05:00:00.000Z';
    const { svc } = serviceAt(created);
    const req = await openPending(svc, input('sla_dst_fall', 4));
    const row = await svc.getRequest(req.id, SYS);
    expect(row?.sla_due_at).toBe('2026-11-01T09:00:00.000Z');
    expect(Date.parse(row!.sla_due_at!) - Date.parse(created)).toBe(4 * HOUR);
  });
});
