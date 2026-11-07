// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mid-tier `travel_expense` card (差旅报销) — it loads with no refusal,
 * meets the mid-tier floor, and every question's COMPUTED truth (over all
 * rows, and per persona) is the hand-worked one pinned here. A deliberately
 * wrong truth in a fixture copy of the card is red against these pins.
 *
 * The seed follows the arithmetic rule in the card's `$comment`, so the
 * values below are worked from that rule rather than read off the evaluator;
 * a few derivations are written out next to their pin.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario, type Truth } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD = resolve(HERE, '../../../../docs/qa/scenarios/travel_expense.json');
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
  // 75 paid claims (54 of i 1-60, 21 of i 61-90, none in October).
  paid_reimbursement: scalar(145800),
  // i 1-60: 6 rejected (i mod 10 = 7), 54 paid. i 61-90: 3 rejected,
  // 6 manager_approved (8, 9), 21 paid. i 91-120: 12 submitted (1-4),
  // 6 manager_approved (5-6), 3 rejected, 3 finance_approved, 6 draft.
  claims_by_status: groups(
    ['draft', 6],
    ['finance_approved', 3],
    ['manager_approved', 12],
    ['paid', 75],
    ['rejected', 12],
    ['submitted', 12],
  ),
  // e09 (g3, i = 9 mod 12, so 2-day trips with airfare): paid i = 9, 21, 33,
  // 45, 81 → 650 hotel + 360 meals + airfare 2800, or 3300 when i mod 9 = 0
  // (9, 45, 81): 3 × 4310 + 2 × 3810 = 20550. e02 (g2, i = 2 mod 12, 4-day
  // trips, nothing over): 8 paid + c098 finance_approved, 9 × 1870 = 16830.
  // The fourth, e12, has 16430: no tie at the cut-off.
  top_claimants: ranking(['e09', 20550], ['e06', 19070], ['e02', 16830]),
  // asOf 2026-10-31, previous_month = September = claims i 61-90.
  claimed_last_month: scalar(59900),
  // Lines reached through claim → claimant → department (two hops).
  over_standard_by_department: groups(['dep_eng', 18], ['dep_ops', 12], ['dep_sales', 8]),
  sales_paid_hotel: scalar(27800),
  // 120 claim trips + t121 + t124 approved; t122, t123, t126 submitted; t125 rejected.
  trips_by_status: groups(['approved', 122], ['rejected', 1], ['submitted', 3]),
  // c093 is submitted by e09, the Operations manager: step 1 goes to e14.
  ec_0093_waiting_on: groups(['e14', 1]),
  department_budgets: groups(['Engineering', 40000], ['Finance', 5000], ['Operations', 30000], ['Sales', 60000]),
  recoverable_vat: UNANSWERABLE,
};

/** The same questions answered AS a persona: row scope applied, hidden reads withheld. */
const EXPECTED_PERSONA_TRUTHS: Record<string, Record<string, Truth>> = {
  // employee is e02: 8 paid claims at 1870 each. dept_manager sees Sales (e01-e04).
  paid_reimbursement: { employee: scalar(14960), dept_manager: scalar(46680) },
  // Sales holds 40 claims, k = 1-4 of each block of 12: drafts c099, c100, c109, c110.
  claims_by_status: {
    dept_manager: groups(
      ['draft', 4],
      ['finance_approved', 1],
      ['manager_approved', 1],
      ['paid', 28],
      ['rejected', 4],
      ['submitted', 2],
    ),
  },
  // e02 travelled for its 10 claims and t121, and has t122 submitted; Finance does not see trips.
  trips_by_status: { employee: groups(['approved', 11], ['submitted', 1]), finance_officer: WITHHELD },
  // The employee may not see any travel budget; the manager sees their own department's.
  department_budgets: { employee: WITHHELD, dept_manager: groups(['Sales', 60000]) },
};

function load(file: string): LoadedScenario {
  const { card, refusals } = loadScenarioFile(file, { areas, library: 'open' });
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
  const dir = mkdtempSync(join(tmpdir(), 'scenario-travel-expense-'));
  dirs.push(dir);
  const card = JSON.parse(readFileSync(CARD, 'utf8'));
  mutate(card);
  const file = join(dir, 'travel_expense.json');
  writeFileSync(file, JSON.stringify(card, null, 2));
  return load(file);
}

describe('scenario card travel_expense (docs/qa/scenarios/travel_expense.json)', () => {
  const loaded = load(CARD);
  const { card } = loaded;

  it("every question's computed truth, over all rows and per persona, is the hand-worked one", () => {
    assertPinned(loaded);
  });

  it('meets the mid-tier floor', () => {
    const { run, expect: ex } = card;
    // A gallery starter template, so the loader holds it to the gallery floor too.
    expect(card.tier).toBe('starter');
    // 5-8 related objects, at least one report or dashboard.
    expect(ex.objects.length).toBeGreaterThanOrEqual(5);
    expect(ex.objects.length).toBeLessThanOrEqual(8);
    expect(ex.dashboards?.length ?? 0).toBeGreaterThanOrEqual(1);
    // The approval flow's own object is expected and seeded with both steps.
    expect(ex.objects).toContain('approval_step');
    expect(new Set(run.seed.approval_step.map((s) => s.step))).toEqual(new Set([1, 2]));
    // 2-3 roles with a row scope.
    const scoped = run.personas.filter((p) => (p.scope?.length ?? 0) > 0);
    expect(scoped.length).toBeGreaterThanOrEqual(2);
    expect(scoped.length).toBeLessThanOrEqual(3);
    // >=100 rows on the main object, spanning >=3 months.
    const claims = run.seed.expense_claim;
    expect(claims.length).toBeGreaterThanOrEqual(100);
    expect(new Set(claims.map((c) => String(c.claim_date).slice(0, 7))).size).toBeGreaterThanOrEqual(3);
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
    expect(outcome('fix_meal_days')?.kind).toBe('applied');
    expect(outcome('manager_approves_step_one')?.kind).toBe('applied');
    expect(outcome('pay_claim')).toEqual({ kind: 'pending_confirmation' });
    expect(outcome('employee_approves_own_claim')).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED' });
    expect(outcome('over_standard_without_reason')).toEqual({ kind: 'refused', code: 'VALIDATION_FAILED' });
  });

  it('keeps the seed internally consistent: claim totals sum their lines, over_standard means above the grade cap', () => {
    const { seed } = card.run;
    const grade = new Map(seed.employee.map((e) => [e.id, e.grade]));
    const claimant = new Map(seed.expense_claim.map((c) => [c.id, c.claimant as string]));
    const cap = new Map(seed.travel_standard.map((t) => [`${t.grade}.${t.expense_type}`, t.cap_amount as number]));
    const totals = new Map<string, number>();
    for (const l of seed.claim_line) {
      const qty = l.quantity as number;
      const unit = l.unit_amount as number;
      expect(l.amount, l.id).toBe(qty * unit);
      const limit = cap.get(`${grade.get(claimant.get(l.claim as string)!)}.${l.expense_type}`);
      expect(l.over_standard, l.id).toBe(unit > limit!);
      expect(l.over_reason !== null, l.id).toBe(l.over_standard);
      totals.set(l.claim as string, (totals.get(l.claim as string) ?? 0) + (l.amount as number));
    }
    for (const c of seed.expense_claim) expect(c.total_amount, c.id).toBe(totals.get(c.id));
  });

  it('a deliberately wrong seed cell in a fixture copy is red against the pins', () => {
    // c009 is a paid e09 claim: one unit more moves paid_reimbursement and top_claimants.
    const copy = loadCopy((c) => {
      c.run.seed.expense_claim.find((r: { id: string }) => r.id === 'c009').total_amount += 1;
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.paid_reimbursement).toEqual(scalar(145801));
    expect(copy.truths.top_claimants).toEqual(ranking(['e09', 20551], ['e06', 19070], ['e02', 16830]));
  });

  it('a deliberately wrong truth spec in a fixture copy is red against the pins', () => {
    // Counting only paid claims drops c098 (finance_approved) from e02's total.
    const copy = loadCopy((c) => {
      c.run.questions.find((q: { id: string }) => q.id === 'top_claimants').truth.filter[0].value = ['paid'];
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.top_claimants).not.toEqual(EXPECTED_TRUTHS.top_claimants);
  });
});
