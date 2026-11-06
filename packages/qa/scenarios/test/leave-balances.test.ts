// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mid-tier `leave_balances` card (请假与假期余额) — it loads with no
 * refusal, meets the mid-tier floor, and every question's COMPUTED truth (over
 * all rows, and per persona) is the hand-worked one pinned here. A deliberately
 * wrong seed cell or truth spec in a fixture copy of the card is red against
 * these pins.
 *
 * The seed follows the arithmetic rule in the card's `$comment`, so the values
 * below are worked from that rule rather than read off the evaluator; the
 * derivations are written out next to their pins. The service-year tiers used
 * below: on 1 July 2026, e07 and e11 have under 3 years (5 days), e03, e06,
 * e08, e10, e12 and e13 have 3 to 9 years (10 days), and e01, e02, e04, e05,
 * e09 and e14 have 10 or more (15 days).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  formatRefusal,
  loadScenarioFile,
  readCapabilityAreas,
  type LoadedScenario,
  type SeedRow,
  type Truth,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD = resolve(HERE, '../../../../docs/qa/scenarios/leave_balances.json');
const AREAS_DIR = resolve(HERE, '../../../../docs/qa/platform-checklist/areas');

const areas = readCapabilityAreas(AREAS_DIR);

const scalar = (value: number): Truth => ({ kind: 'scalar', value });
const groups = (...g: Array<[string | null, number]>): Truth => ({
  kind: 'groups',
  groups: g.map(([key, value]) => ({ key, value })),
});
const ranking = (...r: Array<[string, number]>): Truth => ({
  kind: 'ranking',
  rows: r.map(([key, value]) => ({ key, value })),
});
const UNANSWERABLE: Truth = { kind: 'unanswerable' };
const WITHHELD: Truth = { kind: 'withheld' };

const EXPECTED_TRUTHS: Record<string, Truth> = {
  // 78 approved requests: 24 in each of July, August and September (i mod 10
  // is neither 3 nor 7) and 6 in October (i mod 10 = 8 or 9), worth
  // 53 + 66 + 56 + 18.5 days.
  approved_days: scalar(193.5),
  // e02's six annual requests are all approved: 2 + 2 + 3 + 4 + 2 + 5 (lr_002,
  // 026, 038, 062, 086, 098). e04: 2 + 5 + 3 + 4 + 0.5 (lr_088 is a single
  // morning). e06: 4 + 1 + 5 + 2.5 + 1. The fourth, e12, has 12: no tie at the
  // cut-off.
  top_annual_takers: ranking(['e02', 18], ['e04', 14.5], ['e06', 13.5]),
  // asOf 2026-09-30, previous_month = August = requests i 31-60. Their nominal
  // days run four whole i mod 7 cycles (4 × 18) plus i 59 and 60 (3 + 1) = 76;
  // the half days of i 33, 44 and 55 take 1.5 off; the six not approved
  // (i 33, 37, 43, 47, 53, 57: 1.5 + 2 + 1 + 2 + 1 + 1) take 8.5 off.
  approved_days_last_month: scalar(66),
  // Sales e01 3 + e02 18 + e03 2 + e04 14.5; Engineering e05 4 + e06 13.5 +
  // e07 3 + e08 9; Operations e09 6 + e10 9.5 + e11 1.5 + e12 12. HR files none,
  // so it forms no group.
  annual_days_by_department: groups(['dep_eng', 29.5], ['dep_ops', 29], ['dep_sales', 37.5]),
  // Entitlement + carry-over - used, per employee. Engineering: e05 15 + 3 - 4,
  // e06 10 + 5 - 13.5, e07 5 + 0 - 3, e08 10 + 2 - 9. HR: e13 10 + 2, e14 15 + 5.
  // Operations: e09 15 - 6, e10 10 + 2 - 9.5, e11 5 - 1.5, e12 10 + 5 - 12.
  // Sales: e01 15 + 5 - 3, e02 15 + 4 - 18, e03 10 - 2, e04 15 + 5 - 14.5.
  remaining_annual_by_department: groups(['dep_eng', 20.5], ['dep_hr', 32], ['dep_ops', 18], ['dep_sales', 31.5]),
  // e02 1, e06 1.5, e07 2; the fourth, e10, has 2.5: no tie at the cut-off.
  lowest_annual_remaining: ranking(['e02', 1], ['e06', 1.5], ['e07', 2]),
  // LR-0105 is e09's 5-day request (i mod 10 = 5): e09 manages Operations, so
  // step 1 went to e14 (approved); step 2 waits on e13.
  lr_0105_waiting_on: groups(['e13', 1]),
  // October's pending requests (i mod 10 = 2, 4, 5, 6): Sales lr_112 (e01);
  // Engineering lr_092, 102, 104, 114, 115, 116 (e05); Operations lr_094,
  // 095, 096, 106 (e09); lr_105 at step 2 (e13).
  pending_by_approver: groups(['e01', 1], ['e05', 6], ['e09', 4], ['e13', 1]),
  // The 24 sick requests (i mod 5 = 4) by i mod 7: surgery 8 (0, 4),
  // physiotherapy 6 (1, 5), dental 7 (2, 6), post-operative rest 3 (3).
  sick_by_medical_note: groups(
    ['Dental treatment', 7],
    ['Physiotherapy course', 6],
    ['Post-operative rest', 3],
    ['Scheduled minor surgery', 8],
  ),
  unpaid_leave_deduction: UNANSWERABLE,
};

/** The same questions answered AS a persona: row scope applied, hidden reads withheld. */
const EXPECTED_PERSONA_TRUTHS: Record<string, Record<string, Truth>> = {
  // employee is e07: lr_019 (sick 2), lr_031 (annual 3), lr_055 (personal 3.5,
  // i = 55 is a half day) and lr_079 (sick 2). dept_manager sees Engineering:
  // e05 11 + e06 21.5 + e07 10.5 + e08 17.5.
  approved_days: { employee: scalar(10.5), dept_manager: scalar(60.5) },
  remaining_annual_by_department: { employee: groups(['dep_eng', 2]), dept_manager: groups(['dep_eng', 20.5]) },
  // e07's only pending request is lr_115, at step 1 with e05.
  pending_by_approver: { employee: groups(['e05', 1]), dept_manager: groups(['e05', 6]) },
  // e07's sick requests are i = 19 (19 mod 7 = 5) and 79 (79 mod 7 = 2). The
  // medical note is the requester's alone: the manager and HR decline.
  sick_by_medical_note: {
    employee: groups(['Dental treatment', 1], ['Physiotherapy course', 1]),
    dept_manager: WITHHELD,
    hr_officer: WITHHELD,
  },
};

function load(file: string): LoadedScenario {
  const { card, refusals } = loadScenarioFile(file, { areas });
  expect(refusals.map(formatRefusal)).toEqual([]);
  expect(card).toBeDefined();
  return card!;
}

function assertPinned(loaded: LoadedScenario): void {
  expect(loaded.truths).toEqual(EXPECTED_TRUTHS);
  expect(loaded.personaTruths).toEqual(EXPECTED_PERSONA_TRUTHS);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a card is mutated as raw JSON on purpose
type RawCard = any;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A fixture copy of the card with one change, loaded from its own directory. */
function loadCopy(mutate: (card: RawCard) => void): LoadedScenario {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-leave-balances-'));
  dirs.push(dir);
  const card = JSON.parse(readFileSync(CARD, 'utf8'));
  mutate(card);
  const file = join(dir, 'leave_balances.json');
  writeFileSync(file, JSON.stringify(card, null, 2));
  return load(file);
}

const num = (row: SeedRow, field: string): number => row[field] as number;
const str = (row: SeedRow, field: string): string => row[field] as string;
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe('scenario card leave_balances (docs/qa/scenarios/leave_balances.json)', () => {
  const loaded = load(CARD);
  const { card } = loaded;
  const { seed } = card.run;
  const byId = (object: string) => new Map(seed[object].map((r) => [r.id, r]));
  const requests = byId('leave_request');
  const balances = byId('leave_balance');
  const employees = byId('employee');

  it("every question's computed truth, over all rows and per persona, is the hand-worked one", () => {
    assertPinned(loaded);
  });

  it('meets the mid-tier floor', () => {
    const { run, expect: ex } = card;
    // 5-8 related objects, at least one report or dashboard.
    expect(ex.objects.length).toBeGreaterThanOrEqual(5);
    expect(ex.objects.length).toBeLessThanOrEqual(8);
    expect(ex.dashboards?.length ?? 0).toBeGreaterThanOrEqual(1);
    // The approval route's own object is expected and seeded with both steps.
    expect(ex.objects).toContain('approval_step');
    expect(new Set(run.seed.approval_step.map((s) => s.step))).toEqual(new Set([1, 2]));
    // 2-3 roles with a row scope.
    const scoped = run.personas.filter((p) => (p.scope?.length ?? 0) > 0);
    expect(scoped.length).toBeGreaterThanOrEqual(2);
    expect(scoped.length).toBeLessThanOrEqual(3);
    // >=100 rows on the main object, spanning >=3 months.
    expect(run.seed.leave_request.length).toBeGreaterThanOrEqual(100);
    expect(new Set(run.seed.leave_request.map((r) => str(r, 'start_date').slice(0, 7))).size).toBeGreaterThanOrEqual(3);
    // 8-10 questions, 4-6 operations, no countsReason needed.
    expect(run.questions.length).toBeGreaterThanOrEqual(8);
    expect(run.questions.length).toBeLessThanOrEqual(10);
    expect(run.operations.length).toBeGreaterThanOrEqual(4);
    expect(run.operations.length).toBeLessThanOrEqual(6);
    expect(run.countsReason).toBeUndefined();
    // >=3 agent actions, >=1 confirm-gated.
    expect(run.agentActions?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(run.agentActions?.some((a) => a.confirm)).toBe(true);
    // Each operation kind the card names, by its declared outcome.
    const outcome = (id: string) => run.operations.find((o) => o.id === id)?.outcome;
    expect(outcome('file_and_submit_from_text')?.kind).toBe('applied');
    expect(outcome('half_day_on_draft')?.kind).toBe('applied');
    expect(outcome('manager_approves_step_one')?.kind).toBe('applied');
    expect(outcome('delete_withdrawn_request')).toEqual({ kind: 'pending_confirmation' });
    expect(outcome('raise_own_entitlement')).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED' });
    expect(outcome('submit_over_balance')).toEqual({ kind: 'refused', code: 'VALIDATION_FAILED' });
  });

  it("keeps each request's days equal to its working-day lines", () => {
    const lines = new Map<string, SeedRow[]>();
    for (const d of seed.leave_day) {
      expect(num(d, 'day_value'), d.id).toBe(d.portion === 'full_day' ? 1 : 0.5);
      const day = new Date(`${str(d, 'leave_date')}T00:00:00Z`).getUTCDay();
      expect(day >= 1 && day <= 5, `${d.id} falls on a weekday`).toBe(true);
      const list = lines.get(str(d, 'request')) ?? [];
      list.push(d);
      lines.set(str(d, 'request'), list);
    }
    for (const r of seed.leave_request) {
      const own = lines.get(r.id) ?? [];
      expect(own.length, r.id).toBeGreaterThan(0);
      expect(num(r, 'days'), r.id).toBe(sum(own.map((d) => num(d, 'day_value'))));
      expect(r.start_date, r.id).toBe(own[0].leave_date);
      expect(r.end_date, r.id).toBe(own[own.length - 1].leave_date);
    }
  });

  it('keeps every balance equal to its approved requests, and the tenure rule', () => {
    const SERVICE_START = '2026-07-01';
    for (const b of seed.leave_balance) {
      const approved = seed.leave_request.filter((r) => r.balance === b.id && r.status === 'approved');
      expect(num(b, 'used_days'), b.id).toBe(sum(approved.map((r) => num(r, 'days'))));
      expect(num(b, 'remaining_days'), b.id).toBe(
        num(b, 'entitled_days') + num(b, 'carried_over_days') - num(b, 'used_days'),
      );
      expect(num(b, 'remaining_days'), b.id).toBeGreaterThanOrEqual(0);
      if (b.leave_type === 'lt_annual') {
        const hired = str(employees.get(str(b, 'employee'))!, 'hire_date');
        const years = Number(SERVICE_START.slice(0, 4)) - Number(hired.slice(0, 4)) - (hired.slice(5) > SERVICE_START.slice(5) ? 1 : 0);
        expect(b.entitled_days, b.id).toBe(years < 3 ? 5 : years < 10 ? 10 : 15);
      } else {
        expect([b.entitled_days, b.carried_over_days], b.id).toEqual([10, 0]);
      }
    }
    // A personal request draws on no balance; any other on the requester's own.
    for (const r of seed.leave_request) {
      if (r.leave_type === 'lt_personal') expect(r.balance, r.id).toBeNull();
      else expect(r.balance, r.id).toBe(`bal_${str(r, 'employee')}_${str(r, 'leave_type').slice(3)}`);
    }
  });

  it('routes each request by its days, and its status follows its steps', () => {
    const departments = byId('department');
    const steps = new Map<string, SeedRow[]>();
    for (const s of seed.approval_step) steps.set(str(s, 'request'), [...(steps.get(str(s, 'request')) ?? []), s]);
    for (const r of seed.leave_request) {
      const own = (steps.get(r.id) ?? []).sort((a, b) => num(a, 'step') - num(b, 'step'));
      if (r.status === 'draft') {
        expect(own, r.id).toEqual([]);
        expect(r.submitted_on, r.id).toBeNull();
        continue;
      }
      const manager = str(departments.get(str(employees.get(str(r, 'employee'))!, 'department'))!, 'manager');
      expect(own[0].approver, r.id).toBe(manager === r.employee ? 'e14' : manager);
      if (own.length === 2) expect(own[1].approver, r.id).toBe('e13');
      const decisions = own.map((s) => s.decision);
      const twoStep = num(r, 'days') > 3;
      const expected: Record<string, string[][]> = {
        approved: [twoStep ? ['approved', 'approved'] : ['approved']],
        rejected: [twoStep ? ['approved', 'rejected'] : ['rejected']],
        withdrawn: [['cancelled']],
        pending: twoStep ? [['pending'], ['approved', 'pending']] : [['pending']],
      };
      expect(expected[str(r, 'status')], `${r.id} ${r.status}`).toContainEqual(decisions);
    }
  });

  it('holds its own validation rules: a long sick leave has a certificate, a request fits its balance when submitted', () => {
    const lastDecision = new Map<string, string>();
    for (const s of seed.approval_step) {
      const on = s.decided_on as string | null;
      if (on !== null && on > (lastDecision.get(str(s, 'request')) ?? '')) lastDecision.set(str(s, 'request'), on);
    }
    const fits = (r: SeedRow, asOf: string): boolean => {
      const b = balances.get(str(r, 'balance'))!;
      const used = seed.leave_request
        .filter((o) => o.balance === b.id && o.status === 'approved' && (lastDecision.get(o.id) ?? '') < asOf)
        .map((o) => num(o, 'days'));
      return num(r, 'days') <= num(b, 'entitled_days') + num(b, 'carried_over_days') - sum(used);
    };
    for (const r of seed.leave_request) {
      if (r.leave_type === 'lt_sick') expect(r.has_certificate, r.id).toBe(num(r, 'days') > 2);
      if (r.status !== 'draft' && r.balance !== null) expect(fits(r, str(r, 'submitted_on')), r.id).toBe(true);
    }
    // The refused submission is real: LR-0091 asks 5 days of e07's 2.
    expect(fits(requests.get('lr_091')!, card.asOf!)).toBe(false);
    expect(balances.get('bal_e07_annual')!.remaining_days).toBe(2);
  });

  it('names each created row by a `where` no seeded row matches', () => {
    for (const op of card.run.operations) {
      if (op.outcome.kind !== 'applied') continue;
      for (const st of op.outcome.state) {
        if (st.where === undefined) continue;
        const where = Object.entries(st.where);
        const hits = seed[st.object].filter((row) => where.every(([k, v]) => row[k] === v));
        expect(hits.map((h) => h.id), `${op.id} → ${st.object} ${JSON.stringify(st.where)}`).toEqual([]);
      }
    }
  });

  it('a deliberately wrong seed cell in a fixture copy is red against the pins', () => {
    // lr_098 is e02's approved 5-day annual request: one day more moves the
    // total and the top of the ranking.
    const copy = loadCopy((c) => {
      c.run.seed.leave_request.find((r: { id: string }) => r.id === 'lr_098').days += 1;
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.approved_days).toEqual(scalar(194.5));
    expect(copy.truths.top_annual_takers).toEqual(ranking(['e02', 19], ['e04', 14.5], ['e06', 13.5]));
  });

  it('a deliberately wrong truth spec in a fixture copy is red against the pins', () => {
    // A window off by one month answers September (i 61-90): 56 days.
    const copy = loadCopy((c) => {
      c.run.questions.find((q: { id: string }) => q.id === 'approved_days_last_month').truth.filter[1].value.period = 'this_month';
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.approved_days_last_month).toEqual(scalar(56));
  });
});
