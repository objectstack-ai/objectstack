// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A malformed card is REFUSED with its file and the field path — each class
 * of refusal asserted on its own. Every case starts from a real library card
 * that loads clean, changes exactly one thing, and asserts the loader names
 * that thing: the file, the exact path, and the class of the fault.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarios, readCapabilityAreas } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_CARD = resolve(HERE, '../../../../docs/qa/scenarios/crm_account_with_contacts.json');
const AREAS_DIR = resolve(HERE, '../../../../docs/qa/platform-checklist/areas');

const areas = readCapabilityAreas(AREAS_DIR);
const base = JSON.parse(readFileSync(BASE_CARD, 'utf8'));
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a card is mutated as raw JSON on purpose
type RawCard = any;

function load(mutate: (card: RawCard) => void, fileName = `${base.id}.json`) {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-refusal-'));
  dirs.push(dir);
  const card = structuredClone(base);
  mutate(card);
  const file = join(dir, fileName);
  writeFileSync(file, JSON.stringify(card, null, 2));
  return { file, ...loadScenarios(dir, { areas }) };
}

const q = (c: RawCard, id: string) => c.run.questions.find((x: { id: string }) => x.id === id);
const op = (c: RawCard, id: string) => c.run.operations.find((x: { id: string }) => x.id === id);

/** [name, mutation, the ONE refusal's exact path, its message]. */
const CASES: Array<[string, (c: RawCard) => void, string, RegExp]> = [
  // ── the three classes the card names ──
  ['an unknown capability area, naming the closed set', (c) => (c.capabilities[0] = 'billing.invoices'), 'capabilities[0]', /unknown capability area `billing`.*records-forms/],
  ['a category outside the closed enum', (c) => (c.category = 'retail'), 'category', /expected one of/],
  ['a truth kind outside the enum', (c) => (c.run.questions[0].truth.kind = 'median'), 'run.questions[0].truth.kind', /discriminator/],
  // ── shape ──
  ['an unknown key, locating the key itself', (c) => (c.run.questions[0].truth.limit = 5), 'run.questions[0].truth.limit', /unknown key `limit`/],
  ['a prompt with no language', (c) => (c.prompt.short = {}), 'prompt.short', /at least one language/],
  ['fewer than five questions', (c) => (c.run.questions = c.run.questions.slice(0, 4)), 'run.questions', /5/],
  // ── expect consistency ──
  ['a lookup to an object the card does not expect', (c) => c.expect.lookups.push({ object: 'contact', field: 'email', to: 'customer' }), 'expect.lookups[1].to', /lookup target `customer` is not in expect.objects/],
  ['a dangling app nav target', (c) => (c.expect.appNavTargets = ['account', 'overview']), 'expect.appNavTargets[1]', /dangling nav/],
  ['a seed thinner than minFieldsPerObject', (c) => { c.expect.minFieldsPerObject = 4; c.run.seed.contact[0].phone = '555'; }, 'run.seed.account', /3 field\(s\), fewer than expect.minFieldsPerObject = 4/],
  // ── questions ──
  ['a field no seed row carries (no truth computed from a typo)', (c) => (c.run.questions[0].truth.filter[0].field = 'industri'), 'run.questions[0].truth.filter[0].field', /no seed row of `account` carries `industri`/],
  ['a topN whose cut-off falls inside a tie', (c) => (q(c, 'best_covered_account').truth.n = 2), 'run.questions[3].truth.n', /inside a tie/],
  ['an aggregate over no values', (c) => (c.run.questions[0].truth = { kind: 'min', field: 'name', filter: [{ field: 'industry', op: 'eq', value: 'mining' }] }), 'run.questions[0].truth', /undefined/],
  ['a numeric aggregate over a text value', (c) => (c.run.questions[0].truth = { kind: 'sum', field: 'name' }), 'run.questions[0].truth.field', /is not a number/],
  // ── relation paths ──
  ['a path through a field that is not a declared lookup', (c) => (q(c, 'contacts_by_industry').truth.groupBy = 'email.domain'), 'run.questions[6].truth.groupBy', /`email` is not a lookup of `contact`/],
  ['a path ending on a field the target does not carry', (c) => (q(c, 'tech_contacts').truth.filter[0].field = 'account.region'), 'run.questions[5].truth.filter[0].field', /no seed row of `account` carries `region`/],
  // ── time windows ──
  ['a window with no card-level asOf', (c) => (c.run.questions[0].truth.filter[0] = { field: 'name', op: 'in_window', value: { kind: 'last_days', days: 30 } }), 'run.questions[0].truth.filter[0].value', /needs the card-level `asOf`/],
  ['a window over a field that holds no date', (c) => { c.asOf = '2026-10-31'; c.run.questions[0].truth.filter[0] = { field: 'name', op: 'in_window', value: { kind: 'calendar', period: 'this_month' } }; }, 'run.questions[0].truth.filter[0].field', /is not an ISO date/],
  ['a scalar value on in_window', (c) => (c.run.questions[0].truth.filter[0].op = 'in_window'), 'run.questions[0].truth.filter[0].value', /only it, takes a window/],
  ['an asOf that is not a date', (c) => (c.asOf = '2026-13-01'), 'asOf', /date/i],
  // ── personas and row scope ──
  ['a persona that hides nothing', (c) => (c.run.personas[1].hidden = {}), 'run.personas[1].hidden', /at least one object or field/],
  ['a row scope on a path that does not resolve', (c) => (c.run.personas[0].scope[1].field = 'account.region'), 'run.personas[0].scope[1].field', /no seed row of `account` carries `region`/],
  ['a question asked as an unknown persona', (c) => (q(c, 'account_count').personas[0] = 'ghost'), 'run.questions[4].personas[0]', /no persona `ghost`/],
  // ── unanswerable ──
  ['an unanswerable truth without its reason', (c) => delete q(c, 'acme_revenue').truth.reason, 'run.questions[7].truth.reason', /expected string/],
  // ── seed, operations and outcomes ──
  ['a lookup value naming no seeded row', (c) => (c.run.seed.contact[3].account = 'ac9'), 'run.seed.contact[3].account', /names no seeded `account` row/],
  ['an operation on a row the seed does not hold', (c) => (op(c, 'move_eli').target = 'ct99'), 'run.operations[1].target', /no seeded `contact` row has id `ct99`/],
  ['an operation with no declared outcome', (c) => delete op(c, 'add_contact').outcome, 'run.operations[0].outcome', /expected object|invalid/i],
  ['an operation acting as an unknown persona', (c) => (op(c, 'add_contact').actingAs = 'ghost'), 'run.operations[0].actingAs', /no persona `ghost`/],
  ['a refusal code outside the platform error-code catalogue', (c) => (op(c, 'contact_bad_email').outcome.code = 'VALIDATION_BROKEN'), 'run.operations[3].outcome.code', /expected one of/],
  ['a post-state naming a created row by an id the seed lacks', (c) => (op(c, 'add_contact').outcome.state[0] = { object: 'contact', id: 'ct9', values: { full_name: 'Fay Wu' } }), 'run.operations[0].outcome.state[0].id', /matched by `where`/],
  ['a post-state naming its row twice', (c) => (op(c, 'move_eli').outcome.state[0].where = { full_name: 'Dee' }), 'run.operations[1].outcome.state[0].id', /exactly one of `id` or `where`/],
  // ── guardrails ──
  ['a card that drops one of the five guardrail checks', (c) => (c.run.guardrails = c.run.guardrails.filter((g: { check: string }) => g.check !== 'audit_actor')), 'run.guardrails', /5/],
  ['an injection guardrail pointing at a non-text cell', (c) => (c.run.guardrails[4].cell = { object: 'contact', id: 'ct4', field: 'account' }), 'run.guardrails[4].cell.field', /not a text cell/],
  ['a confirmation check on an operation that does not wait', (c) => (c.run.guardrails[2].operation = 'add_contact'), 'run.guardrails[2].operation', /outcome is `pending_confirmation`, not `applied`/],
  ['an audit check on an operation that names no audit actor', (c) => delete op(c, 'move_eli').outcome.auditActor, 'run.guardrails[3].operation', /declare `outcome.auditActor`/],
  // ── counts, agent actions, iterate ──
  ['fewer than 8 questions without a stated reason', (c) => c.run.questions.pop(), 'run.countsReason', /7 questions \/ 5 operations is below the default 8 \/ 4/],
  ['agent actions with none confirm-gated', (c) => c.run.agentActions.forEach((a: { confirm: boolean }) => (a.confirm = false)), 'run.agentActions', /at least one confirm-gated/],
  ['an agent action on an unexpected object', (c) => (c.run.agentActions[0].object = 'lead'), 'run.agentActions[0].object', /`lead` is not in expect.objects/],
  ['an iterate delta that re-adds an expected object', (c) => (c.iterate.expectDelta = { objects: ['account'] }), 'iterate.expectDelta.objects[0]', /already in expect.objects/],
];

describe('scenario card refusals', () => {
  it('the unmutated base card loads clean (control)', () => {
    const r = load(() => {});
    expect(r.refusals).toEqual([]);
    expect(r.cards).toHaveLength(1);
  });

  it('a card below the default counts loads once it states why (control for countsReason)', () => {
    const r = load((c) => {
      c.run.questions.pop();
      c.run.countsReason = 'The two-object CRM model carries seven distinct questions.';
    });
    expect(r.refusals).toEqual([]);
  });

  for (const [name, mutate, path, message] of CASES) {
    it(`refuses ${name}`, () => {
      const r = load(mutate);
      expect(r.refusals.map(formatRefusal)).toHaveLength(1);
      expect(r.refusals[0]).toMatchObject({ file: r.file, path });
      expect(r.refusals[0].message).toMatch(message);
      // A refused card is not handed out half-valid.
      expect(r.cards).toEqual([]);
    });
  }

  it('refuses a card whose id is not its basename', () => {
    const r = load(() => {}, 'crm.json');
    expect(r.refusals).toEqual([{ file: r.file, path: 'id', message: expect.stringMatching(/basename `crm`/) }]);
  });

  it('refuses a file that is not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenario-refusal-'));
    dirs.push(dir);
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{ "id": ');
    expect(loadScenarios(dir, { areas }).refusals).toEqual([{ file, path: '(card)', message: expect.stringMatching(/not valid JSON/) }]);
  });
});
