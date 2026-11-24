// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The open scenario library under `docs/qa/scenarios/` — every card in the
 * directory loads, and every question's COMPUTED truth (over all rows, and
 * per persona) is the one pinned here. A broken card, or a seed edit that moves an answer, is red in CI.
 *
 * The expected values below were worked out by hand from each card's seed
 * rows, independently of the evaluator; they are the oracle the evaluator is
 * held to, not a snapshot of what it printed.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SelectOptionSchema } from '@objectstack/spec/data';

import { formatRefusal, loadScenarios, readCapabilityAreas, truthsOver, type Truth } from '../src/index.js';
import { promptLanguageGaps } from '../src/runner/prompts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = resolve(HERE, '../../../../docs/qa/scenarios');
const AREAS_DIR = resolve(HERE, '../../../../docs/qa/platform-checklist/areas');

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

const EXPECTED_TRUTHS: Record<string, Record<string, Truth>> = {
  invoice_with_line_items: {
    invoices_not_draft: scalar(2),
    inv_002_amount: scalar(120),
    amount_per_invoice: groups(['i1', 100], ['i2', 120], ['i3', 75]),
    avg_quantity: scalar(4),
    top_products: ranking(['Gadget', 125], ['Service', 100]),
    invoice_count: scalar(3),
    // Cross-object: invoice_line rows filtered through `invoice.status`.
    billed_amount: scalar(220),
    // asOf 2026-10-31, calendar this_month: i2 (10-03) and i3 (10-28), not i1 (09-12).
    issued_this_month: scalar(2),
    tax_rate: UNANSWERABLE,
    // The answerable twins of the three unanswerable questions, and the min truth.
    inv_002_largest_line: scalar(100),
    acme_discount: UNANSWERABLE,
    // Acme's invoices are i1 (100) and i2 (120).
    acme_invoiced: scalar(220),
    lowest_shipping: UNANSWERABLE,
    smallest_invoice: scalar(75),
  },
  project_with_tasks: {
    open_tasks: scalar(3),
    relaunch_estimate: scalar(38),
    tasks_per_project: groups(['p1', 3], ['p2', 1], ['p3', 2]),
    largest_task: scalar(24),
    biggest_project: ranking(['p1', 38]),
    tasks_in_active_projects: scalar(3),
    open_by_project_status: groups(['active', 2], ['planned', 1]),
    relaunch_sponsor: UNANSWERABLE,
    // Website relaunch tasks not done: t2 (in_progress) and t3 (todo).
    relaunch_open_tasks: scalar(2),
    office_move_hourly_rate: UNANSWERABLE,
    // Office move: t5 (12) and t6 (2).
    office_move_avg_estimate: scalar(7),
    smallest_budget: UNANSWERABLE,
    smallest_total_estimate: scalar(4),
  },
  crm_account_with_contacts: {
    tech_accounts: scalar(2),
    // The contact with no account is its own (null) group, sorted first.
    contacts_per_account: groups([null, 1], ['ac1', 2], ['ac2', 1], ['ac3', 1]),
    unattached_contacts: scalar(1),
    best_covered_account: ranking(['ac1', 2]),
    account_count: scalar(3),
    tech_contacts: scalar(3),
    contacts_by_industry: groups([null, 1], ['retail', 1], ['tech', 3]),
    acme_revenue: UNANSWERABLE,
    // Headcounts: Acme 120, Shopwell 15, Bitworks 45.
    acme_headcount: scalar(120),
    avg_credit_limit: UNANSWERABLE,
    avg_headcount: scalar(60),
    most_open_tickets: UNANSWERABLE,
    largest_headcount: scalar(120),
    smallest_headcount: scalar(15),
  },
};

/** The same questions answered AS a persona: row scope applied, hidden reads withheld. */
const EXPECTED_PERSONA_TRUTHS: Record<string, Record<string, Record<string, Truth>>> = {
  invoice_with_line_items: {
    // sales_rep owns i1 and i3 (scope reaches lines through `invoice.owner`);
    // warehouse_staff must not see `amount`.
    amount_per_invoice: { sales_rep: groups(['i1', 100], ['i3', 75]), warehouse_staff: WITHHELD },
    invoice_count: { sales_rep: scalar(2), warehouse_staff: scalar(3) },
  },
  project_with_tasks: {
    // contractor is assigned t1, t3, t5 — only t3 is open; client_viewer hides `task`.
    open_tasks: { contractor: scalar(1), client_viewer: WITHHELD },
    relaunch_estimate: { contractor: WITHHELD },
    // contractor is assigned t1 (done) and t3 (todo) on the relaunch.
    relaunch_open_tasks: { contractor: scalar(1), client_viewer: WITHHELD },
  },
  crm_account_with_contacts: {
    // sdr owns ac1 and ac3; the unattached contact resolves to no owner.
    contacts_per_account: { sdr: groups(['ac1', 2], ['ac3', 1]) },
    account_count: { sdr: scalar(2), partner_user: WITHHELD },
    // sdr's accounts are Acme (120) and Bitworks (45); partner_user hides `account`.
    smallest_headcount: { sdr: scalar(45), partner_user: WITHHELD },
  },
};

describe('the open scenario library (docs/qa/scenarios)', () => {
  const areas = readCapabilityAreas(AREAS_DIR);
  const result = loadScenarios(SCENARIOS_DIR, { areas, library: 'open' });

  it('loads every card with no refusal', () => {
    expect(result.refusals.map(formatRefusal)).toEqual([]);
  });

  it('holds the three control cards (each mid-tier card pins itself in test/<id>.test.ts)', () => {
    // The loader lists every `*.json` here and yields a card or a refusal for each, and the test
    // above asserts no refusal, so every card file loaded. Only the controls are named here, so a
    // new card never edits this file.
    expect(result.cards.map((c) => c.card.id)).toEqual(expect.arrayContaining(Object.keys(EXPECTED_TRUTHS)));
  });

  it('the three controls, and only they, are tier `control` (internal checks, never exported)', () => {
    const controls = result.cards.filter((c) => c.card.tier === 'control').map((c) => c.card.id);
    expect(controls.sort()).toEqual(Object.keys(EXPECTED_TRUTHS).sort());
  });

  it('every card is `generic` (the open library holds no customer-derived or held-out card) and carries a Chinese and an English title', () => {
    expect(result.cards.length).toBeGreaterThanOrEqual(9);
    for (const { card } of result.cards) {
      expect(card.origin, card.id).toBe('generic');
      expect(Object.keys(card.title).sort(), card.id).toEqual(['en', 'zh']);
      // A Chinese title is Chinese: at least one CJK ideograph, not the English one copied over.
      expect(card.title.zh, card.id).toMatch(/[\u4e00-\u9fff]/);
      expect(card.title.zh, card.id).not.toBe(card.title.en);
    }
  });

  for (const [id, expected] of Object.entries(EXPECTED_TRUTHS)) {
    it(`${id}: every question's computed truth is the hand-worked one`, () => {
      const loaded = result.cards.find((c) => c.card.id === id);
      expect(loaded, `${id} did not load`).toBeDefined();
      expect(loaded!.truths).toEqual(expected);
      expect(loaded!.personaTruths).toEqual(EXPECTED_PERSONA_TRUTHS[id]);
      // The Run half is complete: ≥5 questions, ≥2 personas, all five guardrails.
      expect(loaded!.card.run.questions.length).toBeGreaterThanOrEqual(5);
      expect(loaded!.card.run.personas.length).toBeGreaterThanOrEqual(2);
      expect(new Set(loaded!.card.run.guardrails.map((g) => g.check)).size).toBe(5);
    });
  }

  it('every seed value of a single-choice field the card asks for is a valid option value', () => {
    // An option value is a lowercase machine identifier (`SelectOptionSchema.value`), so a build
    // can only declare options the platform accepts; a seed value no option can hold is refused,
    // with every row that looks it up (requisition_to_receipt's `supplier.rating` "A"/"B"/"C").
    const invalid: string[] = [];
    for (const { card } of result.cards) {
      for (const { object, field } of card.expect.selectFields ?? []) {
        for (const row of card.run.seed[object] ?? []) {
          const v = row[field];
          if (v === null || v === undefined) continue;
          if (!SelectOptionSchema.safeParse({ label: String(v), value: v }).success) invalid.push(`${card.id}: ${object}.${field} = ${JSON.stringify(v)}`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it('a seed row dated after the card\'s asOf is a plan (a due, start, end or expected date), never a fact the card treats as done', () => {
    // travel_expense's step `as_118_2` was decided 2026-11-02, after its asOf 2026-10-31: the agent
    // rightly refused to pay a claim over a future-dated approval. Each card's future-dated fields, pinned.
    const future: Record<string, string[]> = {};
    for (const { card } of result.cards) {
      if (card.asOf === undefined) continue;
      const fields = new Set<string>();
      for (const [object, rows] of Object.entries(card.run.seed)) {
        for (const row of rows) {
          for (const [field, v] of Object.entries(row)) {
            if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && v.slice(0, 10) > card.asOf) fields.add(`${object}.${field}`);
          }
        }
      }
      if (fields.size > 0) future[card.id] = [...fields].sort();
    }
    expect(future).toEqual({
      asset_lifecycle: ['checkout.due_on'],
      leave_balances: ['leave_day.leave_date', 'leave_request.end_date', 'leave_request.start_date'],
      order_to_cash: ['invoice.due_date'],
      requisition_to_receipt: ['purchase_order.expected_date'],
      travel_expense: ['trip_request.end_date', 'trip_request.start_date'],
    });
  });

  it('a last-N-days truth counts no row on the extra day the platform\'s preset adds (last_30_days spans 31 days ending on asOf)', () => {
    // The card's `last_days` window is the N days ending on asOf; the platform's
    // `last_N_days` preset runs from N days before asOf, one day more. A row on that
    // day makes an app that uses the preset answer differently from the card.
    const ambiguous: string[] = [];
    for (const loaded of result.cards) {
      const widened = structuredClone(loaded.card);
      const ids: string[] = [];
      for (const q of widened.run.questions) {
        for (const f of 'filter' in q.truth ? (q.truth.filter ?? []) : []) {
          if (f.op === 'in_window' && typeof f.value === 'object' && f.value !== null && 'kind' in f.value && f.value.kind === 'last_days') {
            f.value = { kind: 'last_days', days: f.value.days + 1 };
            ids.push(q.id);
          }
        }
      }
      if (ids.length === 0) continue;
      const wide = truthsOver(widened, loaded.card.run.seed);
      for (const id of [...new Set(ids)]) {
        if (JSON.stringify([wide.truths[id], wide.personaTruths[id]]) !== JSON.stringify([loaded.truths[id], loaded.personaTruths[id]])) ambiguous.push(`${loaded.card.id}/${id}`);
      }
    }
    expect(ambiguous).toEqual([]);
  });

  it('names its decide action as the route (`via`) of each manager approval the card decides through it, and only those', () => {
    // The Build grant check leaves these writes to the run when the set withholds the verb and the build
    // declares the action. asset_lifecycle manager_approves_scrap and order_to_cash approve_discount have
    // the same shape but no measured run behind them, so they stay measured until one exists.
    const routed = result.cards.flatMap(({ card }) =>
      card.run.operations.filter((o) => o.via !== undefined).map((o) => `${card.id}/${o.id} via ${o.via}`),
    );
    expect(routed.sort()).toEqual([
      'leave_balances/manager_approves_step_one via decide_approval_step',
      'requisition_to_receipt/manager_approves_level_one via decide_approval_step',
      'travel_expense/manager_approves_step_one via decide_approval_step',
    ]);
  });

  it('every card tagged for a report asks for one in its detailed prompt, in both languages', () => {
    // The Build check `dashboards.report` grades a report the prompt never asked for otherwise.
    const silent = result.cards
      .filter(({ card }) => card.capabilities.includes('dashboards.report'))
      .filter(({ card }) => !/\breport\b/i.test(card.prompt.detailed.en ?? '') || !/报表/.test(card.prompt.detailed.zh ?? ''))
      .map(({ card }) => card.id);
    expect(silent).toEqual([]);
  });

  it('reads the capability areas from the checklist tree', () => {
    // A closed set read from disk, not a list kept here: the assertion is only
    // that it is non-trivial and holds an area every seed card uses.
    expect(areas.size).toBeGreaterThan(1);
    expect(areas.has('ai')).toBe(true);
  });
});

describe('the three control cards: Chinese asks, unanswerable twins, every field aggregate', () => {
  const result = loadScenarios(SCENARIOS_DIR, { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });
  const controls = result.cards.filter((c) => c.card.tier === 'control');

  it('holds the three controls (control for the cases below)', () => {
    expect(controls.map((c) => c.card.id).sort()).toEqual(Object.keys(EXPECTED_TRUTHS).sort());
  });

  for (const { card } of controls) {
    it(`${card.id}: --lang zh runs it in every mode, with either build prompt: no text the runner sends lacks its Chinese`, () => {
      for (const prompt of ['short', 'detailed'] as const) {
        expect(promptLanguageGaps(card, { lang: 'zh', prompt }, ['scratch', 'template', 'ask']), prompt).toEqual([]);
      }
      // Each Chinese text is Chinese, not the English one copied over.
      const texts = [card.prompt.short, card.prompt.detailed, card.iterate.change, ...card.run.questions.map((q) => q.ask), ...card.run.operations.map((o) => o.ask)];
      for (const t of texts) {
        expect(t.zh, t.en).toMatch(/[\u4e00-\u9fff]/);
        expect(t.zh, t.en).not.toBe(t.en);
      }
    });

    it(`${card.id}: three unanswerable questions beside the answerable ones, and an avg, a max and a min truth`, () => {
      const kinds = card.run.questions.map((q) => q.truth.kind);
      expect(kinds.filter((k) => k === 'unanswerable')).toHaveLength(3);
      for (const kind of ['avg', 'max', 'min'] as const) expect(kinds, kind).toContain(kind);
    });
  }
});
