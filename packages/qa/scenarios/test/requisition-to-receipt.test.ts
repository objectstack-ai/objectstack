// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mid-tier `requisition_to_receipt` card (采购申请到收货) — it loads with
 * no refusal, meets the mid-tier floor, and every question's COMPUTED truth
 * (over all rows, and per persona) is the hand-worked one pinned here. A
 * deliberately wrong truth in a fixture copy of the card is red against these
 * pins.
 *
 * The seed follows the arithmetic rule in the card's `$comment`, so the
 * values below are worked from that rule rather than read off the evaluator.
 * Two facts carry most derivations: the tier m = i mod 7 has seven amounts
 * summing to 104,800, and over i = 1..84 (lcm of 12 requesters and 7 tiers)
 * every requester buys every tier once, so each department requests
 * 4 × 104,800 = 419,200 there.
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
  type Truth,
  type TruthKey,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD = resolve(HERE, '../../../../docs/qa/scenarios/requisition_to_receipt.json');
const AREAS_DIR = resolve(HERE, '../../../../docs/qa/platform-checklist/areas');

const areas = readCapabilityAreas(AREAS_DIR);

const scalar = (value: number): Truth => ({ kind: 'scalar', value });
const groups = (...g: Array<[TruthKey, number]>): Truth => ({
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
  // All 120 = 17 × 104,800 + 1,200 (i = 120 is tier 1) = 1,782,800. Less the
  // 12 rejected (i mod 10 = 7: i 7-67 one of each tier, then 77, 87, 97, 107,
  // 117 = 91,600) = 196,400, the 9 pending (91 92 93 101 102 103 111 112 113)
  // = 115,000 and the 6 drafts (99 100 109 110 119 120) = 53,000.
  approved_spend: scalar(1418400),
  // i 1-60: 6 rejected, 54 received. i 61-90: 3 rejected, 6 ordered (8, 9),
  // 21 received. i 91-120: 9 pending (1-3), 6 approved (4-5), 6 ordered (6, 8),
  // 3 rejected, 6 draft (9, 0).
  requisitions_by_status: groups(
    ['approved', 6],
    ['draft', 6],
    ['ordered', 12],
    ['pending_approval', 9],
    ['received', 75],
    ['rejected', 12],
  ),
  // Tiers 1-3 need one level, 4, 5 and 0 two, 6 three: 17 of each tier in
  // i 1-119, and i = 120 is tier 1.
  requisitions_by_approval_levels: groups([1, 52], [2, 51], [3, 17]),
  // s01: 12 monitor POs × 3,600 + 13 server POs × 48,000 = 667,200.
  // s04: 13 consulting POs × 26,000. s05: 13 laptop POs × 12,000. The fourth,
  // s02, holds 13 × 1,200 + 11 × 9,000 = 114,600: no tie at the cut-off.
  top_suppliers: ranking(['s01', 667200], ['s04', 338000], ['s05', 156000]),
  // asOf 2026-10-31, previous_month = September = i 61-90: four full tier
  // cycles (61-88) = 419,200, plus i 89 (tier 5) and 90 (tier 6) = 74,000.
  requested_last_month: scalar(493200),
  // Lines reached through line → order → requisition → requester → department
  // (three hops). Per department: requested total, less what has no sent or
  // received PO (rejected, pending, draft, approved).
  //   Sales 419,200 + 178,600 − 104,600 − 57,000 − 42,800 = 393,400.
  //   Engineering 419,200 + 197,000 − 35,000 − 54,400 − 56,600 = 470,200.
  //   Operations 419,200 + 149,600 − 56,800 − 3,600 − 10,200 − 26,000 = 472,200.
  ordered_by_department: groups(['dep_eng', 470200], ['dep_ops', 472200], ['dep_sales', 393400]),
  // Receipts reached through their line. Tier 4 received POs: the nine of
  // i 4-60, then 74 and 81: 11 × 2 laptops.
  laptops_received: scalar(22),
  // r111 (48,000, three levels) is pending at level 1 with the Sales manager.
  pr_0111_waiting_on: groups(['e13', 1]),
  department_budgets: groups(
    ['Engineering', 800000],
    ['Executive office', 100000],
    ['Finance', 60000],
    ['Operations', 400000],
    ['Sales', 300000],
  ),
  laptops_in_stock: UNANSWERABLE,
};

/** The same questions answered AS a persona: row scope applied, hidden reads withheld. */
const EXPECTED_PERSONA_TRUTHS: Record<string, Record<string, Truth>> = {
  // requester is e02: i = 2 mod 12 (2, 14, ..., 110), never rejected; 110 is a
  // draft, the other nine sum to 117,400. Sales holds no approved requisition,
  // so its approved spend equals its ordered-by-department figure.
  approved_spend: { requester: scalar(117400), dept_manager: scalar(393400) },
  // Sales (e01-e04): drafts 99 100 109 110, pending 111 112, ordered 88 98,
  // rejected 27 37 87 97, the other 28 received.
  requisitions_by_status: {
    dept_manager: groups(['draft', 4], ['ordered', 2], ['pending_approval', 2], ['received', 28], ['rejected', 4]),
  },
  // Neither the requester nor the buyer may see a budget; the manager sees their own department's.
  department_budgets: { requester: WITHHELD, dept_manager: groups(['Sales', 300000]), buyer: WITHHELD },
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
  const dir = mkdtempSync(join(tmpdir(), 'scenario-requisition-to-receipt-'));
  dirs.push(dir);
  const card = JSON.parse(readFileSync(CARD, 'utf8'));
  mutate(card);
  const file = join(dir, 'requisition_to_receipt.json');
  writeFileSync(file, JSON.stringify(card, null, 2));
  return load(file);
}

describe('scenario card requisition_to_receipt (docs/qa/scenarios/requisition_to_receipt.json)', () => {
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
    // The approval flow's own object is expected and seeded with all three amount levels.
    expect(ex.objects).toContain('approval_step');
    expect(new Set(run.seed.approval_step.map((s) => s.level))).toEqual(new Set([1, 2, 3]));
    // 2-3 roles with a row scope.
    const scoped = run.personas.filter((p) => (p.scope?.length ?? 0) > 0);
    expect(scoped.length).toBeGreaterThanOrEqual(2);
    expect(scoped.length).toBeLessThanOrEqual(3);
    // >=100 rows on the main object, spanning >=3 months.
    const requisitions = run.seed.purchase_requisition;
    expect(requisitions.length).toBeGreaterThanOrEqual(100);
    expect(new Set(requisitions.map((r) => String(r.request_date).slice(0, 7))).size).toBeGreaterThanOrEqual(3);
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
    expect(outcome('raise_po_from_text')?.kind).toBe('applied');
    expect(outcome('fix_chair_quantity')?.kind).toBe('applied');
    expect(outcome('manager_approves_level_one')?.kind).toBe('applied');
    expect(outcome('cancel_sent_po')).toEqual({ kind: 'pending_confirmation' });
    expect(outcome('manager_approves_finance_level')).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED' });
    expect(outcome('receive_more_than_ordered')).toEqual({ kind: 'refused', code: 'VALIDATION_FAILED' });
  });

  it('keeps the seed internally consistent: amounts, approval levels, routing, orders and receipts agree', () => {
    const { seed } = card.run;
    const num = (v: unknown) => v as number;
    // A line is quantity × unit price; an order totals its lines and equals its requisition.
    const requisition = new Map(seed.purchase_requisition.map((r) => [r.id, r]));
    const lineTotals = new Map<string, number>();
    const lineQuantity = new Map<string, number>();
    for (const l of seed.po_line) {
      expect(l.amount, l.id).toBe(num(l.quantity) * num(l.unit_price));
      lineTotals.set(l.purchase_order as string, (lineTotals.get(l.purchase_order as string) ?? 0) + num(l.amount));
      lineQuantity.set(l.id, num(l.quantity));
    }
    const orderOf = new Map<string, (typeof seed.purchase_order)[number]>();
    for (const po of seed.purchase_order) {
      expect(po.total_amount, po.id).toBe(lineTotals.get(po.id));
      expect(po.total_amount, po.id).toBe(requisition.get(po.requisition as string)?.total_amount);
      orderOf.set(po.requisition as string, po);
    }
    // The approval levels follow the amount thresholds; each level routes to its approver.
    const manager = new Map(seed.department.map((d) => [d.id, d.manager]));
    const department = new Map(seed.employee.map((e) => [e.id, e.department as string]));
    const steps = new Map<string, Array<(typeof seed.approval_step)[number]>>();
    for (const s of seed.approval_step) {
      const r = requisition.get(s.requisition as string)!;
      const expected = { 1: manager.get(department.get(r.requester as string)!), 2: 'e16', 3: 'e18' }[num(s.level)];
      expect(s.approver, s.id).toBe(expected);
      steps.set(r.id, [...(steps.get(r.id) ?? []), s]);
    }
    for (const r of seed.purchase_requisition) {
      const amount = num(r.total_amount);
      expect(r.approval_levels, r.id).toBe(amount <= 5000 ? 1 : amount <= 30000 ? 2 : 3);
      const decisions = (steps.get(r.id) ?? []).map((s) => `${s.level}:${s.decision}`);
      const levels = num(r.approval_levels);
      const approvedTo = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}:approved`);
      if (r.status === 'draft') expect(decisions, r.id).toEqual([]);
      else if (r.status === 'rejected') expect(decisions, r.id).toEqual(['1:rejected']);
      else if (r.status === 'pending_approval') {
        expect(decisions.length, r.id).toBeLessThanOrEqual(levels);
        expect(decisions, r.id).toEqual([...approvedTo(decisions.length - 1), `${decisions.length}:pending`]);
      } else expect(decisions, r.id).toEqual(approvedTo(levels));
      // An order exists exactly for ordered (sent), received (received) and some approved (draft) requisitions.
      const po = orderOf.get(r.id);
      if (r.status === 'ordered') expect(po?.status, r.id).toBe('sent');
      else if (r.status === 'received') expect(po?.status, r.id).toBe('received');
      else if (r.status === 'approved') expect([undefined, 'draft'], r.id).toContain(po?.status);
      else expect(po, r.id).toBeUndefined();
    }
    // A received order has every line fully received; nothing else has a receipt.
    const receivedOrder = new Set(seed.purchase_order.filter((po) => po.status === 'received').map((po) => po.id));
    const receivedLines = new Map(seed.goods_receipt.map((g) => [g.po_line as string, num(g.quantity_received)]));
    for (const l of seed.po_line) {
      const expected = receivedOrder.has(l.purchase_order as string) ? lineQuantity.get(l.id) : undefined;
      expect(receivedLines.get(l.id), l.id).toBe(expected);
    }
    expect(receivedLines.size).toBe(seed.goods_receipt.length);
  });

  it('a deliberately wrong seed cell in a fixture copy is red against the pins', () => {
    // r062 is e02's received September requisition: one unit more moves the
    // approved spend, last month's total, and both personas' approved spend.
    const copy = loadCopy((c) => {
      c.run.seed.purchase_requisition.find((r: { id: string }) => r.id === 'r062').total_amount += 1;
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.approved_spend).toEqual(scalar(1418401));
    expect(copy.truths.requested_last_month).toEqual(scalar(493201));
    expect(copy.personaTruths.approved_spend).toEqual({ requester: scalar(117401), dept_manager: scalar(393401) });
  });

  it('a deliberately wrong truth spec in a fixture copy is red against the pins', () => {
    // Counting only received orders drops the sent ones (s01 loses PO-0069, PO-0079 and PO-0118).
    const copy = loadCopy((c) => {
      c.run.questions.find((q: { id: string }) => q.id === 'top_suppliers').truth.filter[0].value = ['received'];
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.top_suppliers).not.toEqual(EXPECTED_TRUTHS.top_suppliers);
  });
});
