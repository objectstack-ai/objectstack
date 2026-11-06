// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mid-tier `order_to_cash` card (订单到收款) — it loads with no refusal,
 * meets the mid-tier floor, and every question's COMPUTED truth (over all
 * rows, and per persona) is the hand-worked one pinned here. A deliberately
 * wrong truth in a fixture copy of the card is red against these pins.
 *
 * The seed follows the arithmetic rule in the card's `$comment`, so the
 * values below are worked from that rule rather than read off the evaluator;
 * the derivations are written out next to their pin. The rule itself is
 * re-checked against the seed rows in the consistency test below.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario, type Truth } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD = resolve(HERE, '../../../../docs/qa/scenarios/order_to_cash.json');
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
  // The open balance by account: Harbor Foods (a05) 59950 (it has paid none of
  // its nine invoices), Cedar Logistics (a02) 16650 (INV-1074 10 days overdue
  // + INV-1086 not yet due), Ironwood Labs (a09) 10000 (half of six past-due
  // invoices + INV-1093 not yet due), and the not-yet-due invoices of a03 2800,
  // a04 9000, a06 4640, a07 9600, a08 8800, a12 2800.
  open_receivables: scalar(124240),
  // Overdue on 2026-10-31: Harbor 4300 + 6800 (61-90: INV-1005, INV-1017),
  // 9300 + 5550 (31-60), 4300 + 6800 (1-30); Ironwood 1600 + 1000 (61-90),
  // 800 (31-60), 1200 + 1600 + 1000 (1-30); Cedar 10200 (1-30). The rest is current.
  receivables_aging: groups(
    ['current', 69790],
    ['overdue_1_30', 25100],
    ['overdue_31_60', 15650],
    ['overdue_61_90', 13700],
  ),
  // i 1-90: 4 cancelled (13, 33, 53, 73), 86 fulfilled. i 91-120 by i mod 10:
  // 9 fulfilled (1-3), 9 confirmed (4, 5, 9), 6 draft (6-7), 3 cancelled (8),
  // 3 pending_approval (0).
  orders_by_status: groups(
    ['cancelled', 7],
    ['confirmed', 9],
    ['draft', 6],
    ['fulfilled', 95],
    ['pending_approval', 3],
  ),
  // a02 (i = 2 mod 12, so p2 and three p6 a line): fulfilled i = 2, 14, 26, 38,
  // 50, 62, 74, 86 → 165 Widget Pro × 250 less 500 off i = 50, plus 8 × 2700 =
  // 62350. a11: 140 × 250 + 7 × 3600 = 60200. a05: 175 × 250 + 9 × 1800 =
  // 59950. The fourth, a08, has 44950: no tie at the cut-off.
  top_accounts_billed: ranking(['a02', 62350], ['a11', 60200], ['a05', 59950]),
  // Payments dated 2026-10-02..31. East: a01 5400, a02 21350, a03 9200,
  // a07 10800, a08 20200, a09 3800. West: a04 7200, a06 5600, a10 6960,
  // a11 28300, a12 5440 (Harbor Foods paid nothing).
  collected_by_team_last_30_days: groups(['east', 70750], ['west', 53500]),
  // The 104 confirmed or fulfilled orders. Subscription is p5, the service line
  // when i mod 3 = 1: 40 such orders carry 100 units (1 + i mod 4 cycles
  // 2, 1, 4, 3); the 6 not counted (13, 73, 97, 100, 106, 118) carry 13, so
  // 87 × 600 = 52200. All lines of those orders sum to 479250.
  booked_by_category: groups(['hardware', 311550], ['services', 115500], ['subscription', 52200]),
  // Harbor Foods is e07's, Cedar Logistics e03's, Ironwood Labs e04's.
  overdue_by_owner: groups(['e07', 37050], ['e03', 10200], ['e04', 7200]),
  // SO-0120 is for a12, owned by e08 of team west, so it waits on e05.
  so_0120_waiting_on: groups(['e05', 1]),
  // 2026-10-18..31: e07's October call (day 30 - 2 × 5 = 20) and the
  // collection call on INV-1065 (due 10-12, + 15 days = 10-27). INV-1077
  // reaches 15 days past due only on 11-08.
  harbor_recent_followups: groups(['e07', 1], ['e09', 1]),
  september_commission: UNANSWERABLE,
};

/** The same questions answered AS a persona: row scope applied, hidden reads withheld. */
const EXPECTED_PERSONA_TRUTHS: Record<string, Record<string, Truth>> = {
  // sales_rep is e03 (a02 16650 + a08 8800); sales_manager sees team east:
  // a02, a03 2800, a07 9600, a08, a09 10000 (a01 has nothing open).
  open_receivables: { sales_rep: scalar(25450), sales_manager: scalar(47850) },
  receivables_aging: {
    sales_manager: groups(
      ['current', 30450],
      ['overdue_1_30', 14000],
      ['overdue_31_60', 800],
      ['overdue_61_90', 2600],
    ),
  },
  // e03's 20 orders (i = 2 or 8 mod 12): 98 cancelled, 104 confirmed, 116 draft,
  // 110 pending_approval, the other 16 fulfilled.
  orders_by_status: {
    sales_rep: groups(['cancelled', 1], ['confirmed', 1], ['draft', 1], ['fulfilled', 16], ['pending_approval', 1]),
  },
  // East only: a08 is 155 × 250 less 1000 off i = 20 and 80, plus 8 × 900.
  top_accounts_billed: { sales_manager: ranking(['a02', 62350], ['a08', 44950], ['a07', 44400]) },
  // A rep sees no payment at all; the manager sees team east's.
  collected_by_team_last_30_days: { sales_rep: WITHHELD, sales_manager: groups(['east', 70750]) },
  overdue_by_owner: { sales_manager: groups(['e03', 10200], ['e04', 7200]) },
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
  const dir = mkdtempSync(join(tmpdir(), 'scenario-order-to-cash-'));
  dirs.push(dir);
  const card = JSON.parse(readFileSync(CARD, 'utf8'));
  mutate(card);
  const file = join(dir, 'order_to_cash.json');
  writeFileSync(file, JSON.stringify(card, null, 2));
  return load(file);
}

const AS_OF = '2026-10-31';
const addDays = (ymd: string, days: number): string =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

describe('scenario card order_to_cash (docs/qa/scenarios/order_to_cash.json)', () => {
  const loaded = load(CARD);
  const { card } = loaded;

  it("every question's computed truth, over all rows and per persona, is the hand-worked one", () => {
    assertPinned(loaded);
  });

  it('meets the mid-tier floor', () => {
    const { run, expect: ex } = card;
    // 5-8 related objects, at least one report or dashboard.
    expect(ex.objects.length).toBeGreaterThanOrEqual(5);
    expect(ex.objects.length).toBeLessThanOrEqual(8);
    expect(ex.dashboards?.length ?? 0).toBeGreaterThanOrEqual(1);
    // The approval flow: every discounted order is routed to an approver, and
    // the automation's collection calls are seeded as activities.
    expect(run.seed.sales_order.filter((o) => o.approver !== null).length).toBeGreaterThan(0);
    expect(run.seed.activity.filter((a) => a.type === 'collection_call').length).toBeGreaterThan(0);
    // 2-3 roles with a row scope.
    const scoped = run.personas.filter((p) => (p.scope?.length ?? 0) > 0);
    expect(scoped.length).toBeGreaterThanOrEqual(2);
    expect(scoped.length).toBeLessThanOrEqual(3);
    // >=100 rows on the main object, spanning >=3 months.
    const orders = run.seed.sales_order;
    expect(orders.length).toBeGreaterThanOrEqual(100);
    expect(new Set(orders.map((o) => String(o.order_date).slice(0, 7))).size).toBeGreaterThanOrEqual(3);
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
    expect(outcome('order_from_text')?.kind).toBe('applied');
    expect(outcome('change_line_quantity')?.kind).toBe('applied');
    expect(outcome('approve_discount')?.kind).toBe('applied');
    expect(outcome('write_off_balance')).toEqual({ kind: 'pending_confirmation' });
    expect(outcome('rep_approves_own_discount')).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED' });
    expect(outcome('overpay_invoice')).toEqual({ kind: 'refused', code: 'VALIDATION_FAILED' });
  });

  it('keeps the seed internally consistent with the rule in $comment', () => {
    const { seed } = card.run;
    const manager = new Map(seed.employee.map((e) => [e.id, e.manager]));
    const account = new Map(seed.account.map((a) => [a.id, a]));
    const listPrice = new Map(seed.product.map((p) => [p.id, p.list_price as number]));

    // Lines: list price, amount after discount; an order totals its lines.
    const totals = new Map<string, number>();
    const discounted = new Set<string>();
    for (const l of seed.order_line) {
      const qty = l.quantity as number;
      const unit = l.unit_price as number;
      const disc = l.discount_pct as number;
      expect(unit, l.id).toBe(listPrice.get(l.product as string));
      expect(l.amount, l.id).toBe((qty * unit * (100 - disc)) / 100);
      if (disc > 10) discounted.add(l.order as string);
      totals.set(l.order as string, (totals.get(l.order as string) ?? 0) + (l.amount as number));
    }

    // Orders: owned by the account's owner; an order with a discount above 10%
    // is routed to the owner's manager and carries approved_on once past approval.
    for (const o of seed.sales_order) {
      expect(o.total_amount, o.id).toBe(totals.get(o.id));
      expect(o.owner, o.id).toBe(account.get(o.account as string)?.owner);
      const routed = discounted.has(o.id);
      expect(o.approver, o.id).toBe(routed ? manager.get(o.owner as string) : null);
      const approved = routed && !['draft', 'pending_approval'].includes(o.status as string);
      expect(o.approved_on, o.id).toBe(approved ? addDays(o.order_date as string, 1) : null);
    }

    // Invoices: exactly one per fulfilled order, for its total, due after the terms.
    const orderById = new Map(seed.sales_order.map((o) => [o.id, o]));
    const paid = new Map<string, number>();
    for (const p of seed.payment) paid.set(p.invoice as string, (paid.get(p.invoice as string) ?? 0) + (p.amount as number));
    const invoiced = seed.invoice.map((v) => v.order);
    expect(new Set(invoiced).size).toBe(invoiced.length);
    expect(new Set(invoiced)).toEqual(new Set(seed.sales_order.filter((o) => o.status === 'fulfilled').map((o) => o.id)));
    for (const v of seed.invoice) {
      const o = orderById.get(v.order as string)!;
      const terms = account.get(v.account as string)?.payment_terms === 'net_45' ? 45 : 30;
      expect(v.account, v.id).toBe(o.account);
      expect(v.amount, v.id).toBe(o.total_amount);
      expect(v.invoice_date, v.id).toBe(addDays(o.order_date as string, 7));
      expect(v.due_date, v.id).toBe(addDays(v.invoice_date as string, terms));
      // Roll-up, balance formula, status and aging bucket as of asOf.
      const amountPaid = paid.get(v.id) ?? 0;
      const balance = (v.amount as number) - amountPaid;
      expect(v.amount_paid, v.id).toBe(amountPaid);
      expect(v.balance, v.id).toBe(balance);
      expect(v.status, v.id).toBe(balance === 0 ? 'paid' : amountPaid > 0 ? 'partially_paid' : 'open');
      const late = daysBetween(v.due_date as string, AS_OF);
      const bucket =
        balance === 0
          ? null
          : late <= 0
            ? 'current'
            : late <= 30
              ? 'overdue_1_30'
              : late <= 60
                ? 'overdue_31_60'
                : late <= 90
                  ? 'overdue_61_90'
                  : 'overdue_90_plus';
      expect(v.aging_bucket, v.id).toBe(bucket);
    }

    // The automation: a collection call by e09 exactly when an invoice is 15
    // days past due by asOf and not fully paid on that day.
    const calls = seed.activity.filter((a) => a.type === 'collection_call');
    const due15 = seed.invoice.filter((v) => {
      const on = addDays(v.due_date as string, 15);
      const paidBy = seed.payment
        .filter((p) => p.invoice === v.id && (p.payment_date as string) <= on)
        .reduce((s, p) => s + (p.amount as number), 0);
      return on <= AS_OF && paidBy < (v.amount as number);
    });
    expect(calls.map((a) => a.invoice).sort()).toEqual(due15.map((v) => v.id).sort());
    for (const a of calls) {
      const v = seed.invoice.find((x) => x.id === a.invoice)!;
      expect(a.owner, a.id).toBe('e09');
      expect(a.account, a.id).toBe(v.account);
      expect(a.activity_date, a.id).toBe(addDays(v.due_date as string, 15));
    }
  });

  it('declares write outcomes that agree with the seed rule', () => {
    const { seed, operations } = card.run;
    const op = (id: string) => operations.find((o) => o.id === id)!;
    // order_from_text: 40 × 250 + 2 × 400 × 0.8 = 10640, routed to e03's manager.
    expect(op('order_from_text').outcome).toMatchObject({
      kind: 'applied',
      state: [{ values: { owner: 'e03', approver: 'e01', total_amount: 10000 + 640 } }, {}, {}],
    });
    // change_line_quantity: SO-0116 is a draft of e03's a08 with 15 Widget Pro and one Training Day.
    const so116 = seed.sales_order.find((o) => o.id === 'so116')!;
    expect([so116.status, so116.owner, so116.total_amount]).toEqual(['draft', 'e03', 15 * 250 + 900]);
    expect(op('change_line_quantity').outcome).toMatchObject({ state: [{}, { values: { total_amount: 25 * 250 + 900 } }] });
    // approve_discount / rep_approves_own_discount: SO-0110 is e03's, pending on e01.
    const so110 = seed.sales_order.find((o) => o.id === 'so110')!;
    expect([so110.status, so110.owner, so110.approver]).toEqual(['pending_approval', 'e03', 'e01']);
    // overpay_invoice: INV-1009 is half paid, so 3200 is above its 1600 open balance.
    const inv009 = seed.invoice.find((v) => v.id === 'inv009')!;
    expect([inv009.status, inv009.amount, inv009.balance]).toEqual(['partially_paid', 3200, 1600]);
    expect(op('overpay_invoice').values?.amount).toBeGreaterThan(inv009.balance as number);
    // write_off_balance: INV-1005 is Harbor Foods', unpaid and 81 days past due.
    const inv005 = seed.invoice.find((v) => v.id === 'inv005')!;
    expect([inv005.account, inv005.status, inv005.aging_bucket]).toEqual(['a05', 'open', 'overdue_61_90']);
  });

  it('a deliberately wrong seed cell in a fixture copy is red against the pins', () => {
    // INV-1005 is an open, 61-90-day Harbor Foods invoice: one more unit of balance
    // moves the total, its aging bucket and e07's overdue figure.
    const copy = loadCopy((c) => {
      c.run.seed.invoice.find((r: { id: string }) => r.id === 'inv005').balance += 1;
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.open_receivables).toEqual(scalar(124241));
    expect(copy.truths.overdue_by_owner).toEqual(groups(['e07', 37051], ['e03', 10200], ['e04', 7200]));
  });

  it('a deliberately wrong truth spec in a fixture copy is red against the pins', () => {
    // Counting only `open` invoices drops Ironwood's half-paid balances from the aging.
    const copy = loadCopy((c) => {
      c.run.questions.find((q: { id: string }) => q.id === 'receivables_aging').truth.filter[0].value = ['open'];
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.receivables_aging).toEqual(
      groups(['current', 69790], ['overdue_1_30', 21300], ['overdue_31_60', 14850], ['overdue_61_90', 11100]),
    );
  });
});
