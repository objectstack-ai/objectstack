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
  },
  crm_account_with_contacts: {
    // sdr owns ac1 and ac3; the unattached contact resolves to no owner.
    contacts_per_account: { sdr: groups(['ac1', 2], ['ac3', 1]) },
    account_count: { sdr: scalar(2), partner_user: WITHHELD },
  },
};

describe('the open scenario library (docs/qa/scenarios)', () => {
  const areas = readCapabilityAreas(AREAS_DIR);
  const result = loadScenarios(SCENARIOS_DIR, { areas });

  it('loads every card with no refusal', () => {
    expect(result.refusals.map(formatRefusal)).toEqual([]);
  });

  it('holds exactly the three control cards (the mid-tier cards land on their own)', () => {
    expect(result.cards.map((c) => c.card.id).sort()).toEqual(Object.keys(EXPECTED_TRUTHS).sort());
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

  it('reads the capability areas from the checklist tree', () => {
    // A closed set read from disk, not a list kept here: the assertion is only
    // that it is non-trivial and holds an area every seed card uses.
    expect(areas.size).toBeGreaterThan(1);
    expect(areas.has('ai')).toBe(true);
  });
});
