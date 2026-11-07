// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mid-tier `asset_lifecycle` card (资产全生命周期) — it loads with no
 * refusal, meets the mid-tier floor, and every question's COMPUTED truth (over
 * all rows, and per persona) is the hand-worked one pinned here. A deliberately
 * wrong truth in a fixture copy of the card is red against these pins.
 *
 * The seed follows the arithmetic rule in the card's `$comment`, so the values
 * below are worked from that rule rather than read off the evaluator; the
 * derivations are written out next to their pin. Shorthand: an asset bought in
 * June has 4 depreciation entries by 2026-10-31 (July to October), July 3,
 * August 2, September 1; a month's charge is 200 per laptop or phone, 30 per
 * monitor and 20 per chair.
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
const CARD = resolve(HERE, '../../../../docs/qa/scenarios/asset_lifecycle.json');
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
  // disposed: a043, a070. pending_disposal: a024, a088, a102, a114 (submitted or approved scrap).
  // in_repair: i mod 11 = 8 → a008, a019, a030, a041, a052, a063. in_use: the 64 kits less those
  // six and the two kit assets handed back for scrap (a043, a024) = 56, plus the 9 open loaners
  // (k = 1, 2, 4, 5, 7, 8, 10, 11, 13) and the replacement phone a075 = 66. in_stock: the other 42.
  assets_by_status: groups(['disposed', 2], ['in_repair', 6], ['in_stock', 42], ['in_use', 66], ['pending_disposal', 4]),
  // 30 assets per category; per purchase month (Jun/Jul/Aug/Sep) laptops 8/7/8/7, monitors 8/7/8/7,
  // phones 7/8/7/8, chairs 7/8/7/8. Laptop: 30 × 7200 − 200 × (8·4 + 7·3 + 8·2 + 7·1 = 76) = 200800.
  // Monitor without a070 (Aug): 29 × 1800 − 30 × (32 + 21 + 7·2 + 7 = 74) = 49980. Phone without
  // a043 (Jul): 29 × 4800 − 200 × (28 + 7·3 + 14 + 8 = 71) = 125000. Chair: 72000 − 20 × 74 = 70520.
  book_value_by_category: groups(['Laptop', 200800], ['Mobile phone', 125000], ['Monitor', 49980], ['Office chair', 70520]),
  // Completed repairs: i mod 6 = 3 at 10·i + 500 (phones) or + 300 (laptops), plus a009's 900 and
  // a021's 400: a009 390 + 900 = 1290, a063 1130, a051 1010. The fourth, a021 510 + 400 = 910,
  // leaves no tie at the cut-off.
  top_repair_cost_assets: ranking(['a009', 1290], ['a063', 1130], ['a051', 1010]),
  // asOf 2026-10-31, previous_month = September: every asset bought June-August (i 1-90: 23 laptops,
  // 23 monitors, 22 phones, 22 chairs = 10130) less a043, scrapped on 2026-09-20 (200). a070 was
  // scrapped in October, so its September entry stands.
  depreciation_last_month: scalar(9930),
  // Open loaners due before 2026-10-31 are k = 1, 2, 4, 5, 7, 8 → e02, e03 (Engineering), e05,
  // e06, e08 (Sales), e09 (Operations). Kit checkouts have no due date and are never overdue.
  overdue_loaners_by_department: groups(['dep_eng', 2], ['dep_ops', 1], ['dep_sales', 3]),
  // a019, a052 Engineering; a030, a063 Finance; a041 Operations; a008 Sales.
  open_repairs_by_department: groups(['dep_eng', 2], ['dep_fin', 2], ['dep_ops', 1], ['dep_sales', 1]),
  // a009 (Operations, block 0) went out to e09, back for two repairs, and was re-issued to e09:
  // three checkouts, one open.
  who_holds_ast_0009: groups(['e09', 1]),
  // DR-0005 scraps a114, an Engineering monitor: Engineering's manager e01 decides it.
  dr_0005_waiting_on: groups(['e01', 1]),
  asset_budgets: groups(['Engineering', 150000], ['Finance', 40000], ['Operations', 80000], ['Sales', 90000]),
  laptop_warranty_expiring: UNANSWERABLE,
};

/** The same questions answered AS a persona: row scope applied, hidden reads withheld. */
const EXPECTED_PERSONA_TRUTHS: Record<string, Record<string, Truth>> = {
  // employee is e06, holding kit a021, a022, a023 (a024 went back for scrap) and loaner a085.
  // dept_manager sees Sales' 32 assets, i = 16b + 5..8: a070 disposed; a024, a088, a102 pending;
  // a008 in repair; in use the 16 Sales kit assets less a008 and a024, plus loaners a069, a085,
  // a117 (a101 was returned) = 17; in stock the other 10.
  assets_by_status: {
    employee: groups(['in_use', 4]),
    dept_manager: groups(['disposed', 1], ['in_repair', 1], ['in_stock', 10], ['in_use', 17], ['pending_disposal', 3]),
  },
  // The employee may not see a book value. Sales holds two assets of each category per purchase
  // month — entries 4+4+3+3+2+2+1+1 = 20 per category. Laptop:
  // 8 × 7200 − 200 × 20 = 53600. Monitor without a070 (2 entries): 7 × 1800 − 30 × 18 = 12060.
  // Phone: 38400 − 4000 = 34400. Chair: 19200 − 400 = 18800.
  book_value_by_category: {
    employee: WITHHELD,
    dept_manager: groups(['Laptop', 53600], ['Mobile phone', 34400], ['Monitor', 12060], ['Office chair', 18800]),
  },
  // The employee may not see a depreciation entry. Sales bought 24 assets in June-August, six of
  // each category: 6 × (200 + 30 + 200 + 20) = 2700 (a070's September entry included).
  depreciation_last_month: { employee: WITHHELD, dept_manager: scalar(2700) },
  // e06's own loaner a085 (CO-0084, due 2026-10-27); the manager sees e05, e06 and e08's.
  overdue_loaners_by_department: { employee: groups(['dep_sales', 1]), dept_manager: groups(['dep_sales', 3]) },
  // The manager sees their own department's budget; the asset administrator sees none.
  asset_budgets: { dept_manager: groups(['Sales', 90000]), asset_admin: WITHHELD },
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
  const dir = mkdtempSync(join(tmpdir(), 'scenario-asset-lifecycle-'));
  dirs.push(dir);
  const card = JSON.parse(readFileSync(CARD, 'utf8'));
  mutate(card);
  const file = join(dir, 'asset_lifecycle.json');
  writeFileSync(file, JSON.stringify(card, null, 2));
  return load(file);
}

const byId = (rows: readonly SeedRow[]) => new Map(rows.map((r) => [r.id, r]));
const month = (isoDate: unknown) => Number(String(isoDate).slice(5, 7));

describe('scenario card asset_lifecycle (docs/qa/scenarios/asset_lifecycle.json)', () => {
  const loaded = load(CARD);
  const { card } = loaded;
  const { seed } = card.run;

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
    // The scrap approval's own object is expected and seeded in every state it moves through.
    expect(ex.objects).toContain('disposal_request');
    expect(new Set(seed.disposal_request.map((d) => d.status))).toEqual(
      new Set(['submitted', 'approved', 'rejected', 'completed']),
    );
    // 2-3 roles with a row scope.
    const scoped = run.personas.filter((p) => (p.scope?.length ?? 0) > 0);
    expect(scoped.length).toBeGreaterThanOrEqual(2);
    expect(scoped.length).toBeLessThanOrEqual(3);
    // >=100 rows on the main object, spanning >=3 months.
    expect(seed.asset.length).toBeGreaterThanOrEqual(100);
    expect(new Set(seed.asset.map((a) => String(a.purchase_date).slice(0, 7))).size).toBeGreaterThanOrEqual(3);
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
    expect(outcome('receive_and_issue_from_text')?.kind).toBe('applied');
    expect(outcome('extend_overdue_loaner')?.kind).toBe('applied');
    expect(outcome('manager_approves_scrap')?.kind).toBe('applied');
    expect(outcome('dispose_scrapped_asset')).toEqual({ kind: 'pending_confirmation' });
    expect(outcome('employee_approves_own_scrap')).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED' });
    expect(outcome('check_out_asset_in_repair')).toEqual({ kind: 'refused', code: 'VALIDATION_FAILED' });
  });

  it('keeps the seed internally consistent: depreciation, book value, status, custodian and approver follow the records', () => {
    const category = byId(seed.asset_category);
    const department = byId(seed.department);
    const scrap = new Map(seed.disposal_request.map((d) => [d.asset as string, d]));
    const entries = new Map<string, SeedRow[]>();
    for (const e of seed.depreciation_entry) {
      entries.set(e.asset as string, [...(entries.get(e.asset as string) ?? []), e]);
    }
    for (const a of seed.asset) {
      const cat = category.get(a.category as string)!;
      const charge = (a.purchase_cost as number) / (cat.useful_life_months as number);
      const disposedOn = scrap.get(a.id)?.status === 'completed' ? scrap.get(a.id)!.disposed_on : null;
      // One entry per month after the purchase month through October, none from the disposal month on.
      const last = disposedOn === null ? 10 : month(disposedOn) - 1;
      const own = entries.get(a.id) ?? [];
      expect(own.map((e) => month(e.posted_on)), a.id).toEqual(
        Array.from({ length: Math.max(0, last - month(a.purchase_date)) }, (_, k) => month(a.purchase_date) + 1 + k),
      );
      for (const e of own) {
        expect(e.amount, e.id).toBe(charge);
        expect(e.period, e.id).toBe(String(e.posted_on).slice(0, 7));
      }
      expect(a.accumulated_depreciation, a.id).toBe(own.reduce((s, e) => s + (e.amount as number), 0));
      expect(a.book_value, a.id).toBe((a.purchase_cost as number) - (a.accumulated_depreciation as number));

      const open = seed.checkout.filter((c) => c.asset === a.id && c.status === 'open');
      const repairing = seed.repair_order.some((r) => r.asset === a.id && ['open', 'in_progress'].includes(r.status as string));
      const s = scrap.get(a.id)?.status;
      const status =
        s === 'completed'
          ? 'disposed'
          : s === 'submitted' || s === 'approved'
            ? 'pending_disposal'
            : repairing
              ? 'in_repair'
              : open.length > 0
                ? 'in_use'
                : 'in_stock';
      expect(a.status, a.id).toBe(status);
      expect(open.length, a.id).toBeLessThanOrEqual(1);
      expect(a.custodian, a.id).toBe(open[0]?.employee ?? null);
    }
    for (const c of seed.checkout) expect(c.status === 'open', c.id).toBe(c.returned_on === null);
    for (const d of seed.disposal_request) {
      const asset = seed.asset.find((a) => a.id === d.asset)!;
      expect(d.approver, d.id).toBe(department.get(asset.department as string)!.manager);
    }
  });

  it('acts on rows in the state each operation describes', () => {
    const op = (id: string) => card.run.operations.find((o) => o.id === id)!;
    const asset = byId(seed.asset);
    const checkout = byId(seed.checkout);
    const scrap = byId(seed.disposal_request);
    // The loaner to extend is e06's, open and overdue.
    expect(checkout.get(op('extend_overdue_loaner').target!)).toMatchObject({
      employee: 'e06',
      status: 'open',
      due_on: '2026-10-27',
    });
    // The manager approves a submitted Sales request they hold; the disposal executes an approved one.
    expect(scrap.get(op('manager_approves_scrap').target!)).toMatchObject({ status: 'submitted', approver: 'e05' });
    expect(scrap.get(op('dispose_scrapped_asset').target!)).toMatchObject({ status: 'approved' });
    // The employee tries to approve the request they filed themselves.
    expect(scrap.get(op('employee_approves_own_scrap').target!)).toMatchObject({ status: 'submitted', requested_by: 'e06' });
    // The checkout refused by validation names an asset that is in repair.
    expect(asset.get(op('check_out_asset_in_repair').values!.asset as string)?.status).toBe('in_repair');
    // The delivered serials are new, and the new checkout's (employee, date) key matches no seeded row.
    const serials = new Set(seed.asset.map((a) => a.serial_no));
    for (const s of ['MN-26201', 'MN-26202', 'MN-26203']) expect(serials.has(s), s).toBe(false);
    expect(seed.checkout.some((c) => c.employee === 'e03' && c.checked_out_on === '2026-10-31')).toBe(false);
  });

  it('a deliberately wrong seed cell in a fixture copy is red against the pins', () => {
    // ro07 is a009's second repair: one unit more moves top_repair_cost_assets.
    const copy = loadCopy((c) => {
      c.run.seed.repair_order.find((r: { id: string }) => r.id === 'ro07').cost += 1;
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.top_repair_cost_assets).toEqual(ranking(['a009', 1291], ['a063', 1130], ['a051', 1010]));
  });

  it('a deliberately wrong truth spec in a fixture copy is red against the pins', () => {
    // Reading this month instead of last: October charges every asset not disposed of —
    // 30 laptops, 29 monitors, 29 phones, 30 chairs = 6000 + 870 + 5800 + 600 = 13270;
    // Sales' 8 laptops, 7 monitors, 8 phones, 8 chairs = 1600 + 210 + 1600 + 160 = 3570.
    const copy = loadCopy((c) => {
      c.run.questions.find((q: { id: string }) => q.id === 'depreciation_last_month').truth.filter[0].value.period =
        'this_month';
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.depreciation_last_month).toEqual(scalar(13270));
    expect(copy.personaTruths.depreciation_last_month).toEqual({ employee: WITHHELD, dept_manager: scalar(3570) });
  });
});
