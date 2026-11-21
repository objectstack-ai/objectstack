// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ApprovalEscalation.timeoutHours` counts on the escalation's `clock` —
 * wall-clock hours by default, working hours on a working calendar under
 * `'working_time'` (ADR-0157 D5) — pinned through the real code path, not
 * restated.
 *
 * The declaration's `describe` text on `ApprovalEscalationSchema` says the
 * clock out loud; `slaDueAt` in `approval-service.ts` is the one runtime site
 * that turns the declared number into a wall-clock deadline, reached with the
 * working-time count through `ApprovalService.slaDeadline`, the one function
 * the read projection and the sweep share; the escalation sweep compares
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
import { WorkCalendarService } from '@objectstack/objectql';
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
      const rows = ensure(object).filter((r) => matches(r, options?.filter ?? options?.where));
      // Honour the caller's bound by presence, after the filter — the shape
      // `check:objectql-double-limit` pins, so a `limit: 1` read cannot be
      // silently answered with every row.
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
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

describe('ApprovalEscalation.timeoutHours on the default clock is wall-clock hours', () => {
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
    expect(actions.at(-1)).toMatchObject({ action: 'escalate' });
    expect(actions.at(-1)?.actor_id).toBeUndefined();
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

// ── escalation.clock: 'working_time' (ADR-0157 D5, D9, D12) ─────────────────
//
// The REAL calendar service (`@objectstack/objectql`) over a read double of the
// two calendar objects, so the D2 resolution (the named code, else the
// organization default, else a refusal) is the shipped one, not restated here.
// Calendar instants are written in Asia/Shanghai (+08:00), the calendar's own
// zone; the assertions compare UTC instants, so no runner `TZ` matters.

const WEEKDAY = '09:00-12:00, 13:00-18:00';
const CN_CALENDAR: Row = {
  id: 'cal_cn', organization_id: 't1', code: 'cn_standard', name: 'China', timezone: 'Asia/Shanghai',
  is_default: true, maintained_from: '2026-01-01', maintained_through: '2026-12-31',
  monday_periods: WEEKDAY, tuesday_periods: WEEKDAY, wednesday_periods: WEEKDAY,
  thursday_periods: WEEKDAY, friday_periods: WEEKDAY, saturday_periods: '', sunday_periods: '',
};
// A Monday holiday (2026-04-06), the National Day week (2026-10-01..07, off)
// and its 调休 make-up Saturday (2026-10-10, on).
const CN_EXCEPTIONS: Row[] = [
  { id: 'ex_0406', calendar: 'cal_cn', organization_id: 't1', date: '2026-04-06', kind: 'off' },
  ...['01', '02', '03', '04', '05', '06', '07'].map((d) => ({
    id: `ex_10${d}`, calendar: 'cal_cn', organization_id: 't1', date: `2026-10-${d}`, kind: 'off',
  })),
  { id: 'ex_1010', calendar: 'cal_cn', organization_id: 't1', date: '2026-10-10', kind: 'on', periods: WEEKDAY },
];
const sh = (day: string, hm: string) => new Date(`${day}T${hm}:00+08:00`).toISOString();

/** A read double over the two calendar objects: equality `where`s, scoped by the read's tenant. */
function calendarReads(calendars: Row[], exceptions: Row[]) {
  return {
    async find(object: string, query: Row) {
      const src = object === 'sys_work_calendar' ? calendars : exceptions;
      const tenant = query.context?.tenantId;
      const hits = src
        .filter((r) => tenant === undefined || r.organization_id === tenant)
        .filter((r) => Object.entries(query.where ?? {}).every(([k, v]) => {
          // Equality only: a combinator or an operator object is refused, never answered wrong.
          if (k.startsWith('$') || (v !== null && typeof v === 'object')) throw new Error(`calendarReads answers equality only, not ${k}`);
          return r[k] === v;
        }));
      const from = query.offset ?? 0;
      return hits.slice(from, from + (query.limit ?? hits.length));
    },
  };
}

/** A service on the real calendar service; `ttlMs: 0` so every computation reads the rows (D12). */
function workingTimeServiceAt(iso: string, calendars: Row[] = [CN_CALENDAR], exceptions: Row[] = CN_EXCEPTIONS) {
  let nowMs = Date.parse(iso);
  const engine = makeEngine();
  const reads = calendarReads(calendars, exceptions);
  const calendar = new WorkCalendarService({ getEngine: () => reads, posture: () => 'isolated', ttlMs: 0 });
  const svc = new ApprovalService({
    engine: engine as any,
    clock: { now: () => new Date(nowMs) },
    workCalendar: () => calendar,
  });
  return { svc, engine, setNow: (at: string) => { nowMs = Date.parse(at); } };
}

function workingTimeInput(nodeId: string, timeoutHours: number, extra: Row = {}) {
  const base = input(nodeId, timeoutHours);
  return { ...base, config: { ...base.config, escalation: { ...base.config.escalation, clock: 'working_time' as const, ...extra } } };
}

describe("ApprovalEscalation.clock 'working_time' counts the hours on a working calendar", () => {
  it('Friday 17:00 + 4 working hours, Monday a holiday: due Tuesday 12:00, and the sweep fires then, not earlier', async () => {
    const created = sh('2026-04-03', '17:00'); // a Friday
    expect(utcDay(created)).toBe(5);
    const { svc, setNow } = workingTimeServiceAt(created);
    const req = await openPending(svc, workingTimeInput('wt_holiday', 4));
    expect(req.sla_due_at).toBe(sh('2026-04-07', '12:00'));

    const row = await svc.getRequest(req.id, SYS);
    // One hour on Friday (17:00-18:00), the weekend and the Monday holiday
    // skipped, three hours on Tuesday morning (09:00-12:00).
    expect(row?.sla_due_at).toBe(sh('2026-04-07', '12:00'));
    expect(row?.sla_due_refusal).toBeUndefined();

    // The wall-clock deadline (Friday 21:00) and the Monday that would be the
    // next working day without the holiday both pass without an escalation.
    for (const at of [sh('2026-04-03', '21:00'), sh('2026-04-06', '12:00'), sh('2026-04-07', '11:59')]) {
      setNow(at);
      expect(await svc.runEscalations()).toMatchObject({ escalated: 0 });
    }
    setNow(sh('2026-04-07', '12:00'));
    expect(await svc.runEscalations()).toMatchObject({ escalated: 1 });
    expect((await svc.listActions(req.id, SYS)).at(-1)).toMatchObject({ action: 'escalate' });
  });

  it('Friday 17:00 + 4 working hours before a 调休 make-up Saturday: due that Saturday 12:00', async () => {
    const created = sh('2026-10-09', '17:00'); // the Friday after National Day week
    expect(utcDay(created)).toBe(5);
    const { svc, setNow } = workingTimeServiceAt(created);
    const req = await openPending(svc, workingTimeInput('wt_makeup', 4, { calendar: 'cn_standard' }));
    expect((await svc.getRequest(req.id, SYS))?.sla_due_at).toBe(sh('2026-10-10', '12:00'));

    setNow(sh('2026-10-10', '11:59'));
    expect(await svc.runEscalations()).toMatchObject({ escalated: 0 });
    setNow(sh('2026-10-10', '12:00'));
    expect(await svc.runEscalations()).toMatchObject({ escalated: 1 });
  });

  it('the deadline is recomputed on every read and sweep, never stored: a holiday entered later moves it (D12)', async () => {
    const created = sh('2026-04-03', '17:00');
    const exceptions = [...CN_EXCEPTIONS];
    const { svc, setNow } = workingTimeServiceAt(created, [CN_CALENDAR], exceptions);
    const req = await openPending(svc, workingTimeInput('wt_moves', 4));
    expect((await svc.getRequest(req.id, SYS))?.sla_due_at).toBe(sh('2026-04-07', '12:00'));

    exceptions.push({ id: 'ex_0407', calendar: 'cal_cn', organization_id: 't1', date: '2026-04-07', kind: 'off' });
    expect((await svc.getRequest(req.id, SYS))?.sla_due_at).toBe(sh('2026-04-08', '12:00'));
    setNow(sh('2026-04-07', '12:00'));
    expect(await svc.runEscalations()).toMatchObject({ escalated: 0 });
    setNow(sh('2026-04-08', '12:00'));
    expect(await svc.runEscalations()).toMatchObject({ escalated: 1 });
  });

  it('a calendar that cannot answer: no escalation, the reason is served, and the next sweep retries (D9)', async () => {
    const created = sh('2026-04-03', '17:00');
    const calendars: Row[] = [];
    const { svc, setNow } = workingTimeServiceAt(created, calendars);
    const req = await openPending(svc, workingTimeInput('wt_missing', 4, { calendar: 'cn_standard' }));

    const row = await svc.getRequest(req.id, SYS);
    expect(row?.sla_due_at).toBeUndefined();
    expect(row?.sla_due_refusal).toMatchObject({
      code: 'ERR_WORK_CALENDAR_UNRESOLVED', reason: 'not_found', calendar: 'cn_standard',
    });
    expect(row?.sla_due_refusal?.message).toEqual(expect.any(String));

    // Long past any deadline: still no escalation, and no wall-clock fallback.
    setNow(sh('2026-04-20', '12:00'));
    expect(await svc.runEscalations()).toMatchObject({ escalated: 0 });
    expect((await svc.listActions(req.id, SYS)).some((a) => a.action === 'escalate')).toBe(false);

    // The administrator fixes the calendar; the next sweep recovers with no other step.
    calendars.push(CN_CALENDAR);
    expect(await svc.runEscalations()).toMatchObject({ escalated: 1 });
    const fixed = await svc.getRequest(req.id, SYS);
    expect(fixed?.sla_due_at).toBe(sh('2026-04-07', '12:00'));
    expect(fixed?.sla_due_refusal).toBeUndefined();
  });

  it('no named calendar and no organization default refuses no_default; a calendar not maintained that far names the date', async () => {
    const { svc } = workingTimeServiceAt(sh('2026-04-03', '17:00'), [{ ...CN_CALENDAR, is_default: false }]);
    const req = await openPending(svc, workingTimeInput('wt_no_default', 4));
    expect((await svc.getRequest(req.id, SYS))?.sla_due_refusal).toMatchObject({
      code: 'ERR_WORK_CALENDAR_UNRESOLVED', reason: 'no_default',
    });

    const short = workingTimeServiceAt(sh('2026-10-09', '17:00'), [{ ...CN_CALENDAR, maintained_through: '2026-10-09' }]);
    const late = await openPending(short.svc, workingTimeInput('wt_unmaintained', 4));
    const read = await short.svc.getRequest(late.id, SYS);
    expect(read?.sla_due_at).toBeUndefined();
    expect(read?.sla_due_refusal).toMatchObject({ code: 'ERR_WORK_CALENDAR_NOT_MAINTAINED', calendar: 'cn_standard', date: '2026-10-10' });
    short.setNow(sh('2026-12-31', '12:00'));
    expect(await short.svc.runEscalations()).toMatchObject({ escalated: 0 });
  });

  it("a service with no calendar service refuses too: 'working_time' never falls back to wall-clock hours", async () => {
    const { svc, setNow } = serviceAt(sh('2026-04-03', '17:00'));
    const req = await openPending(svc, workingTimeInput('wt_no_service', 4));
    const row = await svc.getRequest(req.id, SYS);
    expect(row?.sla_due_at).toBeUndefined();
    expect(row?.sla_due_refusal).toMatchObject({ code: 'ERR_WORK_CALENDAR_UNRESOLVED', reason: 'no_default' });
    setNow(sh('2026-04-03', '21:00'));
    expect(await svc.runEscalations()).toMatchObject({ escalated: 0 });
  });

  it("an explicit 'wall_clock' is the default clock: Friday 17:00 + 4 is due Friday 21:00 with a calendar present", async () => {
    const { svc } = workingTimeServiceAt(FRIDAY_1700);
    const req = await openPending(svc, workingTimeInput('wc_explicit', 4, { clock: 'wall_clock' }));
    const row = await svc.getRequest(req.id, SYS);
    expect(row?.sla_due_at).toBe('2026-01-16T21:00:00.000Z');
    expect(row?.sla_due_refusal).toBeUndefined();
  });
});
