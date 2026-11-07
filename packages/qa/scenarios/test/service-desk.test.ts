// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mid-tier `service_desk` card (客服工单) — it loads with no refusal,
 * meets the mid-tier floor, and every question's COMPUTED truth (over all
 * rows, and per persona) is the hand-worked one pinned here. A deliberately
 * wrong truth in a fixture copy of the card is red against these pins.
 *
 * The seed follows the arithmetic rule in the card's `$comment`, so the
 * values below are worked from that rule rather than read off the evaluator;
 * the derivations are written out next to their pin.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario, type Truth } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD = resolve(HERE, '../../../../docs/qa/scenarios/service_desk.json');
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
  // Only October holds unresolved tickets: escalated 91, 103, 111 open; the
  // rest of 91-117 by i mod 3 (0 open: 96, 99, 105, 108, 114, 117; 1 pending:
  // 94, 97, 100, 106, 109, 115) once urgent and high are resolved; 118-120 new.
  open_tickets: scalar(18),
  // 60 closed, 30 September resolved + 12 October resolved = 42.
  tickets_by_status: groups(['closed', 60], ['new', 3], ['open', 9], ['pending', 6], ['resolved', 42]),
  // k 1-4 / 5-7 / 8-9 of each block of 12, over ten blocks; the fourth has 10: no tie at the cut-off.
  top_customers: ranking(['cus_01', 40], ['cus_02', 30], ['cus_03', 20]),
  // last_days 30 ending 2026-10-31 starts on 10-02, so i 92-120: i mod 10 in
  // 1-3 gives 92, 93, 101, 102, 103, 111, 112, 113. TK-0091 (10-01, urgent) falls outside.
  urgent_high_last_30_days: scalar(8),
  // Breached = escalated and resolved: 3, 11, 23, 31, 43, 51, 63, 71, 83 (91, 103, 111 are
  // still open, so not yet judged). Customers: cus_01 (3, 51, 63) and cus_02 (31, 43) are
  // enterprise, cus_05 (11, 23, 71, 83) standard.
  breaches_by_customer_tier: groups(['enterprise', 5], ['standard', 4]),
  // Answered surveys (i mod 3 != 0) per group:
  // Billing, 18 answered: 29, 49, 89 low (3 points), 15 more at 5 = 84.
  // Technical, 46 answered: 17 low (8, 10, 19, 20, 28, 38, 40, 50, 58, 59, 68, 70, 79, 80,
  // 88, 98, 110) at 3, 29 at 5 = 196. Tier 2: 11, 23, 31, 43, 71, 83, all breached at 2.
  csat_by_group: groups(['grp_billing', 84 / 18], ['grp_tech', 196 / 46], ['grp_tier2', 2]),
  // Replies by priority (45 / 30 / 15 / 10) on every ticket but the three new ones, and
  // a08's 40-minute note on each of the 12 escalated tickets.
  // Billing 6 / 6 / 12 / 6 tickets: 270 + 180 + 180 + 60. Technical 0 / 12 / 36 / 30 with
  // the three new ones low: 360 + 540 + 270. Tier 2: 6 x 45 + 6 x 30 + 12 x 40.
  minutes_by_group: groups(['grp_billing', 690], ['grp_tech', 1170], ['grp_tier2', 930]),
  // t108: how_to (i mod 4 = 0), so grp_tech and a07; i mod 3 = 0, so open.
  tk_0108_owner: groups(['Aisha Rahman', 1]),
  contract_value_by_tier: groups(['enterprise', 210000], ['premium', 70000], ['standard', 20000]),
  avg_first_response_hours: UNANSWERABLE,
};

/** The same questions answered AS a persona: row scope applied, hidden reads withheld. */
const EXPECTED_PERSONA_TRUTHS: Record<string, Record<string, Truth>> = {
  open_tickets: {
    // support_agent is a02 (i mod 8 = 1): of its October tickets 97 is pending and 105 open.
    support_agent: scalar(2),
    // grp_tech: open 96, 99, 108, 114; pending 94, 100, 106, 115; new 118, 119, 120.
    team_lead: scalar(11),
    // cus_03 is i mod 12 = 8 or 9: in October 92, 93, 104, 116 are resolved, 105 and 117 open.
    portal_customer: scalar(2),
  },
  // 78 technical tickets: 39 closed (45 of i 1-60, less 6 escalated), 11 unresolved, 28 resolved.
  tickets_by_status: {
    team_lead: groups(['closed', 39], ['new', 3], ['open', 4], ['pending', 4], ['resolved', 28]),
  },
  csat_by_group: {
    // a02's answered surveys: 1, 17, 25, 41, 49, 65, 73, 89, 113; 49 and 89 are low.
    support_agent: groups(['grp_billing', 41 / 9]),
    // cus_03's i mod 12 = 9 tickets are billing with i mod 3 = 0, so never answered; the
    // ten i mod 12 = 8 how_to tickets are, four of them low (8, 20, 68, 80): 12 + 30.
    portal_customer: groups(['grp_tech', 42 / 10]),
  },
  // The lead sees only their group's comments; the portal hides the minutes field.
  minutes_by_group: { team_lead: groups(['grp_tech', 1170]), portal_customer: WITHHELD },
  // Only team leads (and the support manager) see a contract value.
  contract_value_by_tier: {
    support_agent: WITHHELD,
    team_lead: groups(['enterprise', 210000], ['premium', 70000], ['standard', 20000]),
    portal_customer: WITHHELD,
  },
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
  const dir = mkdtempSync(join(tmpdir(), 'scenario-service-desk-'));
  dirs.push(dir);
  const card = JSON.parse(readFileSync(CARD, 'utf8'));
  mutate(card);
  const file = join(dir, 'service_desk.json');
  writeFileSync(file, JSON.stringify(card, null, 2));
  return load(file);
}

describe('scenario card service_desk (docs/qa/scenarios/service_desk.json)', () => {
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
    // The escalation automation's own object is expected, with at least one active rule.
    expect(ex.objects).toContain('escalation_rule');
    expect(run.seed.escalation_rule.some((r) => r.active === true)).toBe(true);
    // 2-3 roles with a row scope.
    const scoped = run.personas.filter((p) => (p.scope?.length ?? 0) > 0);
    expect(scoped.length).toBeGreaterThanOrEqual(2);
    expect(scoped.length).toBeLessThanOrEqual(3);
    // >=100 rows on the main object, spanning >=3 months.
    const tickets = run.seed.ticket;
    expect(tickets.length).toBeGreaterThanOrEqual(100);
    expect(new Set(tickets.map((t) => String(t.opened_on).slice(0, 7))).size).toBeGreaterThanOrEqual(3);
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
    expect(outcome('log_ticket_from_call')?.kind).toBe('applied');
    expect(outcome('reassign_ticket')?.kind).toBe('applied');
    expect(outcome('reply_then_resolve')?.kind).toBe('applied');
    expect(outcome('close_ticket')).toEqual({ kind: 'pending_confirmation' });
    expect(outcome('agent_edits_rating')).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED' });
    expect(outcome('resolve_without_code')).toEqual({ kind: 'refused', code: 'VALIDATION_FAILED' });
  });

  it('keeps the seed internally consistent with the SLA, escalation, routing and survey rules', () => {
    const { seed } = card.run;
    const sla = new Map(seed.sla_policy.map((s) => [s.id, s]));
    const rules = new Map(seed.escalation_rule.map((r) => [r.id, r]));
    const agentGroup = new Map(seed.agent.map((a) => [a.id, a.group]));
    const replyMinutes: Record<string, number> = { urgent: 45, high: 30, normal: 15, low: 10 };
    const resolved = new Set<string>();
    const priority = new Map<string, string>();
    for (const t of seed.ticket) {
      priority.set(t.id, t.priority as string);
      const policy = sla.get(t.sla_policy as string)!;
      // The SLA policy follows the priority; an assigned ticket sits in its agent's group.
      expect(policy.priority, t.id).toBe(t.priority);
      if (t.assignee !== null) expect(agentGroup.get(t.assignee as string), t.id).toBe(t.group);
      expect(t.assignee === null, t.id).toBe(t.status === 'new');
      const done = t.status === 'resolved' || t.status === 'closed';
      if (done) resolved.add(t.id);
      // Resolved or closed carries its code and hours; breached means later than the target.
      expect(t.resolution_code !== null, t.id).toBe(done);
      expect(t.sla_breached, t.id).toBe(done ? (t.resolution_hours as number) > (policy.resolution_hours as number) : null);
      // Escalated = moved by its priority's active rule, into that rule's group.
      if (t.escalated_by !== null) {
        const rule = rules.get(t.escalated_by as string)!;
        expect([rule.priority, rule.active, rule.escalate_to], t.id).toEqual([t.priority, true, t.group]);
        if (done) expect(t.resolution_hours as number, t.id).toBeGreaterThan(rule.after_hours as number);
      } else {
        expect(t.group, t.id).not.toBe('grp_tier2');
        // Nothing un-escalated outlived an active rule: every unresolved urgent or high ticket is escalated.
        expect(!done && (t.priority === 'urgent' || t.priority === 'high'), t.id).toBe(false);
        if (done && (t.priority === 'urgent' || t.priority === 'high')) {
          const rule = seed.escalation_rule.find((r) => r.priority === t.priority)!;
          expect(t.resolution_hours as number, t.id).toBeLessThanOrEqual(rule.after_hours as number);
        }
      }
    }
    // An agent reply logs its priority's minutes; an internal note is the escalation note.
    for (const c of seed.ticket_comment) {
      if (c.author_type === 'customer') expect([c.author, c.visibility, c.minutes], c.id).toEqual([null, 'public', 0]);
      else if (c.visibility === 'public') expect(c.minutes, c.id).toBe(replyMinutes[priority.get(c.ticket as string)!]);
      else expect([c.author, c.minutes], c.id).toEqual(['a08', 40]);
    }
    // Exactly one survey per resolved or closed ticket; an answered one carries a 1-5 score.
    expect(new Set(seed.satisfaction_rating.map((r) => r.ticket))).toEqual(resolved);
    expect(seed.satisfaction_rating.length).toBe(resolved.size);
    for (const r of seed.satisfaction_rating) {
      if (r.status === 'answered') expect([1, 2, 3, 4, 5], r.id).toContain(r.score);
      else expect([r.score, r.rated_on], r.id).toEqual([null, null]);
    }
  });

  it("matches each created row's post-state by a `where` no seeded row satisfies", () => {
    // Otherwise a grader reading the post-state back could match a seeded row, not the write.
    const { seed, operations } = card.run;
    for (const op of operations) {
      if (op.outcome.kind !== 'applied') continue;
      for (const st of op.outcome.state) {
        if (st.where === undefined) continue;
        const hits = seed[st.object].filter((row) => Object.entries(st.where!).every(([k, v]) => row[k] === v));
        expect(hits.map((r) => r.id), `${op.id} → ${st.object}`).toEqual([]);
      }
    }
  });

  it('a deliberately wrong seed cell in a fixture copy is red against the pins', () => {
    // sr_029 is an answered billing survey at 3 points: one point more moves Billing's average.
    const copy = loadCopy((c) => {
      c.run.seed.satisfaction_rating.find((r: { id: string }) => r.id === 'sr_029').score += 1;
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.csat_by_group).toEqual(groups(['grp_billing', 85 / 18], ['grp_tech', 196 / 46], ['grp_tier2', 2]));
  });

  it('a deliberately wrong truth spec in a fixture copy is red against the pins', () => {
    // Dropping `pending` from the unresolved statuses loses six tickets, four of them the lead's.
    const copy = loadCopy((c) => {
      c.run.questions.find((q: { id: string }) => q.id === 'open_tickets').truth.filter[0].value = ['new', 'open'];
    });
    expect(() => assertPinned(copy)).toThrow();
    expect(copy.truths.open_tickets).toEqual(scalar(12));
    expect(copy.personaTruths.open_tickets.team_lead).toEqual(scalar(7));
  });
});
