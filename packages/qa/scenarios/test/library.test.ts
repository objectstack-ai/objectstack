// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The open scenario library under `docs/qa/scenarios/` — every card in the
 * directory loads, and every question's COMPUTED truth is the one pinned
 * here. A broken card, or a seed edit that moves an answer, is red in CI.
 *
 * The expected values below were worked out by hand from each card's seed
 * rows, independently of the evaluator; they are the oracle the evaluator is
 * held to, not a snapshot of what it printed.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarios, readCapabilityAreas, type Truth } from '../src/index.js';

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

const EXPECTED_TRUTHS: Record<string, Record<string, Truth>> = {
  invoice_with_line_items: {
    invoices_not_draft: scalar(2),
    inv_002_amount: scalar(120),
    amount_per_invoice: groups(['i1', 100], ['i2', 120], ['i3', 75]),
    avg_quantity: scalar(4),
    top_products: ranking(['Gadget', 125], ['Service', 100]),
  },
  project_with_tasks: {
    open_tasks: scalar(3),
    relaunch_estimate: scalar(38),
    tasks_per_project: groups(['p1', 3], ['p2', 1], ['p3', 2]),
    largest_task: scalar(24),
    biggest_project: ranking(['p1', 38]),
  },
  blog_post_with_comments: {
    comment_count: scalar(5),
    ana_comments: scalar(2),
    // A post no comment names (po3) has no group: groups come from the rows.
    comments_per_post: groups(['po1', 2], ['po2', 3]),
    most_discussed: ranking(['po2', 3]),
  },
  expense_report_with_lines: {
    berlin_total: scalar(640),
    spend_by_category: groups(['travel', 350], ['lodging', 280], ['meals', 200]),
    avg_line: scalar(166),
    cheapest_meal: scalar(40),
    top_lines: ranking(['e1', 320], ['e2', 280]),
    october_first_week: scalar(640),
  },
  crm_account_with_contacts: {
    tech_accounts: scalar(2),
    // The contact with no account is its own (null) group, sorted first.
    contacts_per_account: groups([null, 1], ['ac1', 2], ['ac2', 1], ['ac3', 1]),
    unattached_contacts: scalar(1),
    best_covered_account: ranking(['ac1', 2]),
  },
  book_library: {
    books_available: scalar(2),
    active_loans: scalar(2),
    loans_per_member: groups(['m1', 3], ['m2', 1], ['m3', 1]),
    top_borrower: ranking(['m1', 3]),
    avg_returned_days: scalar(12),
  },
  tickets_select_dense: {
    open_tickets: scalar(3),
    tickets_by_priority: groups(['high', 2], ['low', 2], ['medium', 1], ['urgent', 1]),
    hot_tickets: scalar(3),
    unclosed_hours: scalar(11),
    top_requester: ranking(['ana', 2]),
  },
  leave_system: {
    requests_by_status: groups(['approved', 2], ['pending', 2], ['rejected', 1]),
    approved_days: scalar(8),
    days_per_employee: groups(['em1', 4], ['em2', 2], ['em3', 5.5]),
    longest_request: scalar(5),
    most_leave: ranking(['em3', 5.5]),
  },
  purchase_master_detail: {
    po_1001_total: scalar(200),
    total_per_order: groups(['po1', 200], ['po2', 400]),
    line_count: scalar(4),
    avg_unit_cost: scalar(42.25),
    largest_lines: ranking(['ol3', 340], ['ol2', 120]),
  },
};

describe('the open scenario library (docs/qa/scenarios)', () => {
  const areas = readCapabilityAreas(AREAS_DIR);
  const result = loadScenarios(SCENARIOS_DIR, { areas });

  it('loads every card with no refusal', () => {
    expect(result.refusals.map(formatRefusal)).toEqual([]);
  });

  it('holds exactly the nine seed cards', () => {
    expect(result.cards.map((c) => c.card.id).sort()).toEqual(Object.keys(EXPECTED_TRUTHS).sort());
  });

  for (const [id, expected] of Object.entries(EXPECTED_TRUTHS)) {
    it(`${id}: every question's computed truth is the hand-worked one`, () => {
      const loaded = result.cards.find((c) => c.card.id === id);
      expect(loaded, `${id} did not load`).toBeDefined();
      expect(loaded!.truths).toEqual(expected);
      // The Run half is complete: ≥3 questions, ≥2 personas, all five guardrails.
      expect(loaded!.card.run.questions.length).toBeGreaterThanOrEqual(3);
      expect(loaded!.card.run.personas.length).toBeGreaterThanOrEqual(2);
      expect(new Set(loaded!.card.run.guardrails.map((g) => g.check)).size).toBe(5);
    });
  }

  it('reads the capability areas from the checklist tree', () => {
    // A closed set read from disk, not a list kept here: the assertion is only
    // that it is non-trivial and holds an area every seed card uses.
    expect(areas.size).toBeGreaterThan(1);
    expect(areas.has('ai')).toBe(true);
  });
});
