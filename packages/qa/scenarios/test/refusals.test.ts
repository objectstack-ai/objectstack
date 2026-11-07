// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A malformed card is REFUSED with its file and the field path — each class
 * of refusal asserted on its own. Every case starts from a real library card
 * that loads clean, changes exactly one thing, and asserts the loader names
 * that thing: the file, the exact path, and the class of the fault.
 */

import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { ErrorCode } from '@objectstack/spec/api';

import { formatRefusal, libraryOf, loadScenarioFile, loadScenarios, readCapabilityAreas, type ScenarioLibrary } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const OPEN_DIR = resolve(HERE, '../../../../docs/qa/scenarios');
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

function load(mutate: (card: RawCard) => void, fileName = `${base.id}.json`, library: ScenarioLibrary = 'open') {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-refusal-'));
  dirs.push(dir);
  const card = structuredClone(base);
  mutate(card);
  const file = join(dir, fileName);
  writeFileSync(file, JSON.stringify(card, null, 2));
  return { file, ...loadScenarios(dir, { areas, library }) };
}

const q = (c: RawCard, id: string) => c.run.questions.find((x: { id: string }) => x.id === id);
const op = (c: RawCard, id: string) => c.run.operations.find((x: { id: string }) => x.id === id);

/** [name, mutation, the ONE refusal's exact path, its message]. */
const CASES: Array<[string, (c: RawCard) => void, string, RegExp]> = [
  // ── the three classes the card names ──
  ['an unknown capability area, naming the closed set', (c) => (c.capabilities[0] = 'billing.invoices'), 'capabilities[0]', /unknown capability area `billing`.*records-forms/],
  ['a business function outside the spec facet', (c) => (c.businessFunctions = ['operations']), 'businessFunctions[0]', /expected one of/],
  ['more business functions than the spec allows', (c) => (c.businessFunctions = ['sales', 'finance', 'hr', 'legal']), 'businessFunctions', /at most 3 business functions/],
  ['a business function listed twice', (c) => (c.businessFunctions = ['sales', 'sales']), 'businessFunctions', /more than once/],
  ['the retired single category', (c) => (c.category = 'crm'), 'category', /unknown key `category`/],
  ['a truth kind outside the enum', (c) => (c.run.questions[0].truth.kind = 'median'), 'run.questions[0].truth.kind', /discriminator/],
  // ── shape ──
  ['an unknown key, locating the key itself', (c) => (c.run.questions[0].truth.limit = 5), 'run.questions[0].truth.limit', /unknown key `limit`/],
  ['a prompt with no language', (c) => (c.prompt.short = {}), 'prompt.short', /at least one language/],
  ['fewer than five questions', (c) => (c.run.questions = c.run.questions.slice(0, 4)), 'run.questions', /5/],
  // ── the app code (its namespace is `demo` + code) ──
  ['a card with no app code', (c) => delete c.code, 'code', /names its app `code`/],
  ['an app code with an underscore', (c) => (c.code = 'crm_app'), 'code', /2–8 lowercase letters/],
  ['an app code longer than eight letters', (c) => (c.code = 'customers'), 'code', /2–8 lowercase letters/],
  // ── the tier (what the card is for) ──
  ['a card with no tier', (c) => delete c.tier, 'tier', /names its `tier`: `control`.*`starter` or `delivery`/],
  ['a tier outside the closed set', (c) => (c.tier = 'gallery'), 'tier', /expected one of "control"\|"starter"\|"delivery"/],
  // ── the origin (where the card comes from) ──
  ['a card with no origin', (c) => delete c.origin, 'origin', /names its `origin`: `generic`.*`customer-derived` or `held-out`/],
  ['an origin outside the closed set', (c) => (c.origin = 'public'), 'origin', /expected one of "generic"\|"customer-derived"\|"held-out"/],
  // ── the title: `{ zh, en }`, both non-empty ──
  ['a title as one string (the retired shape)', (c) => (c.title = 'CRM: accounts and contacts'), 'title', /names its `title` as `\{ zh, en \}`, both non-empty/],
  ['a card with no title', (c) => delete c.title, 'title', /names its `title` as `\{ zh, en \}`/],
  ['a title with no Chinese', (c) => delete c.title.zh, 'title.zh', /expected string/],
  ['a title with no English', (c) => delete c.title.en, 'title.en', /expected string/],
  ['an empty English title', (c) => (c.title.en = ''), 'title.en', /must not be blank/],
  ['a blank Chinese title', (c) => (c.title.zh = ' \t'), 'title.zh', /must not be blank/],
  ['a title in a third language', (c) => (c.title.ja = '顧客管理'), 'title.ja', /unknown key `ja`/],
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
  ['a row scope on a card without the row-scope tag', (c) => (c.capabilities = c.capabilities.filter((t: string) => t !== 'access-security.row-scope')), 'capabilities', /persona\(s\) `sdr` declare a row `scope`, so the card must carry `access-security.row-scope`/],
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
  // ── reach: an operation its acting persona cannot reach has one outcome ──
  ['an applied create writing a field the persona must not read', (c) => (op(c, 'add_contact').values.email = 'fay@bitworks.test'), 'run.operations[0].outcome', /`sdr` must not read `contact.email`.*`PERMISSION_DENIED`/],
  ['an applied update on a row outside the persona\'s row scope', (c) => (op(c, 'move_eli').target = 'ct4'), 'run.operations[1].outcome', /row `ct4` is outside `sdr`'s row scope on `contact`.*`RECORD_NOT_FOUND`/],
  ['a pending delete on a row outside the persona\'s row scope', (c) => (op(c, 'remove_ben').target = 'ct3'), 'run.operations[2].outcome', /row `ct3` is outside `sdr`'s row scope.*`RECORD_NOT_FOUND`/],
  ['a validation refusal on a field the persona must not read', (c) => (op(c, 'contact_bad_email').actingAs = 'sdr'), 'run.operations[3].outcome.code', /`sdr` must not read `contact.email`.*`PERMISSION_DENIED`/],
  ['a refusal code other than the hidden object\'s', (c) => (op(c, 'partner_edits_account').outcome.code = ErrorCode.parse('RECORD_NOT_FOUND')), 'run.operations[4].outcome.code', /`partner_user` must not read `account`.*`PERMISSION_DENIED`/],
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

  it('an out-of-scope update declared as the refusal a faithful build answers loads clean (control for reach)', () => {
    const r = load((c) => {
      const o = op(c, 'move_eli');
      o.target = 'ct4';
      o.outcome = { kind: 'refused', code: ErrorCode.parse('RECORD_NOT_FOUND') };
      c.run.guardrails[3].operation = 'add_contact';
      op(c, 'add_contact').outcome.auditActor = 'sdr';
    });
    expect(r.refusals.map(formatRefusal)).toEqual([]);
  });

  it('a card whose personas scope no rows loads without the row-scope tag (control for the tag rule)', () => {
    const r = load((c) => {
      c.capabilities = c.capabilities.filter((t: string) => t !== 'access-security.row-scope');
      delete c.run.personas[0].scope;
    });
    expect(r.refusals.map(formatRefusal)).toEqual([]);
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

  it('refuses every card sharing an app code, each naming the other (control: distinct codes load)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenario-refusal-'));
    dirs.push(dir);
    const first = join(dir, `${base.id}.json`);
    const second = join(dir, 'crm_twin.json');
    writeFileSync(first, JSON.stringify(base));
    writeFileSync(second, JSON.stringify({ ...base, id: 'crm_twin' }));
    const r = loadScenarios(dir, { areas, library: 'open' });
    expect(r.cards).toEqual([]);
    expect(r.refusals).toEqual([
      { file: first, path: 'code', message: expect.stringMatching(/^duplicate app code `crm`, also the code of crm_twin\.json/) },
      { file: second, path: 'code', message: expect.stringMatching(/^duplicate app code `crm`, also the code of crm_account_with_contacts\.json/) },
    ]);

    const twin = { ...base, id: 'crm_twin' };
    twin.code = 'crmtwin';
    writeFileSync(second, JSON.stringify(twin));
    const ok = loadScenarios(dir, { areas, library: 'open' });
    expect(ok.refusals).toEqual([]);
    expect(ok.cards.map((c) => c.card.code)).toEqual(['crm', 'crmtwin']);
  });

  it('names a shared app code even on a card refused for another fault', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenario-refusal-'));
    dirs.push(dir);
    const first = join(dir, `${base.id}.json`);
    const second = join(dir, 'crm_twin.json');
    writeFileSync(first, JSON.stringify(base));
    writeFileSync(second, JSON.stringify({ ...base, id: 'crm_twin', businessFunctions: ['retail'] }));
    const r = loadScenarios(dir, { areas, library: 'open' });
    expect(r.cards).toEqual([]);
    expect(r.refusals.map((x) => [x.file, x.path])).toEqual([
      [first, 'code'],
      [second, 'businessFunctions[0]'],
      [second, 'code'],
    ]);
  });

  it('refuses a file that is not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenario-refusal-'));
    dirs.push(dir);
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{ "id": ');
    expect(loadScenarios(dir, { areas, library: 'open' }).refusals).toEqual([{ file, path: '(card)', message: expect.stringMatching(/not valid JSON/) }]);
  });
});

/**
 * The library a card is loaded as. The private overlay holds customer-derived
 * and held-out cards only, so a `generic` card there is refused; the caller
 * states the library (`LoadOptions.library`), and the CLIs answer it from the
 * directory's real path (`libraryOf`).
 */
describe('the origin and the library: no generic card in the private overlay', () => {
  it('the base card is generic and loads clean as the open library (control)', () => {
    expect(base.origin).toBe('generic');
    expect(load(() => {}, undefined, 'open').refusals).toEqual([]);
  });

  it('refuses a generic card loaded as the overlay, at `origin`, and hands it out not at all', () => {
    const r = load(() => {}, undefined, 'overlay');
    expect(r.cards).toEqual([]);
    expect(r.refusals).toEqual([
      {
        file: r.file,
        path: 'origin',
        message: expect.stringMatching(/^a `generic` card does not belong in the private overlay, which holds only `customer-derived` and `held-out` cards: move it to the open library \(docs\/qa\/scenarios\)/),
      },
    ]);
  });

  it('a customer-derived or a held-out card loads clean as the overlay (control for the refusal)', () => {
    for (const origin of ['customer-derived', 'held-out']) {
      const r = load((c) => (c.origin = origin), undefined, 'overlay');
      expect(r.refusals.map(formatRefusal), origin).toEqual([]);
      expect(r.cards.map((x) => x.card.origin)).toEqual([origin]);
    }
  });

  it('one file loaded as the overlay is judged the same way', () => {
    const { file } = load(() => {});
    expect(loadScenarioFile(file, { areas, library: 'overlay' }).refusals.map((x) => x.path)).toEqual(['origin']);
    expect(loadScenarioFile(file, { areas, library: 'open' }).card?.card.origin).toBe('generic');
  });

  it('libraryOf: the repository\'s docs/qa/scenarios is the open library by real path, through a link too; any other directory is the overlay', () => {
    expect(libraryOf(OPEN_DIR, REPO)).toBe('open');
    expect(libraryOf(join(OPEN_DIR, '..', 'scenarios', '.'), REPO)).toBe('open');
    const elsewhere = mkdtempSync(join(tmpdir(), 'scenario-overlay-'));
    dirs.push(elsewhere);
    const link = join(elsewhere, 'linked-open-library');
    symlinkSync(OPEN_DIR, link);
    expect(libraryOf(link, REPO)).toBe('open');
    expect(libraryOf(elsewhere, REPO)).toBe('overlay');
  });
});

/**
 * The gallery floor a `starter` or `delivery` card meets, line by line: 5
 * expected objects, 1 dashboard, 100 rows on one seeded object, 2 personas
 * with a row scope, 8 questions, 4 operations, 3 agent actions. The numbers
 * are spelled here, not imported, so moving the floor is a visible edit.
 *
 * The control card is raised to EXACTLY the floor on every line (it loads),
 * then each case lowers one line by one and asserts the one refusal it earns.
 */
describe('the gallery floor (tier starter | delivery)', () => {
  const extra = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix} ${i + 1}`, kind: 'call' }));

  /** The control card, declared `starter` and raised to exactly the floor. */
  const atFloor = (tier: 'starter' | 'delivery') => (c: RawCard) => {
    c.tier = tier;
    // 2 → 5 objects; `activity` carries exactly 100 rows, the largest object.
    c.expect.objects.push('region', 'territory', 'activity');
    Object.assign(c.run.seed, { region: extra(1, 'rg'), territory: extra(1, 'tr'), activity: extra(100, 'act') });
    // 0 → 1 dashboard.
    c.expect.dashboards = ['pipeline'];
    // 1 → 2 personas with a row scope (a scope on an object no question or write reads).
    c.run.personas[1].scope = [{ object: 'activity', field: 'kind', value: 'call' }];
    // 5 → 4 operations (no guardrail names this one); 8 questions and 3 agent actions already sit on the floor.
    c.run.operations = c.run.operations.filter((o: { id: string }) => o.id !== 'partner_edits_account');
  };
  const below = (mutate: (c: RawCard) => void, tier: 'starter' | 'delivery' = 'starter') => (c: RawCard) => {
    atFloor(tier)(c);
    mutate(c);
  };

  it('a starter card exactly at the floor loads clean (control for every case below)', () => {
    const r = load(atFloor('starter'));
    expect(r.refusals.map(formatRefusal)).toEqual([]);
    expect(r.cards.map((x) => x.card.tier)).toEqual(['starter']);
    // The fixture sits ON the floor, line by line, so each case below is one step under it.
    const card = r.cards[0].card;
    expect(card.expect.objects).toHaveLength(5);
    expect(card.expect.dashboards).toHaveLength(1);
    expect(Math.max(...Object.values(card.run.seed).map((rows) => rows.length))).toBe(100);
    expect(card.run.personas.filter((p) => p.scope !== undefined)).toHaveLength(2);
    expect(card.run.questions).toHaveLength(8);
    expect(card.run.operations).toHaveLength(4);
    expect(card.run.agentActions).toHaveLength(3);
  });

  it('a delivery card exactly at the floor loads clean (delivery holds the same floor)', () => {
    const r = load(atFloor('delivery'));
    expect(r.refusals.map(formatRefusal)).toEqual([]);
  });

  it('a control card has no floor: the two-object, eight-row base card loads clean', () => {
    expect(base.tier).toBe('control');
    expect(load(() => {}).refusals).toEqual([]);
  });

  it('the same two-object, eight-row card declared starter is refused at every line it falls short of', () => {
    const r = load((c) => (c.tier = 'starter'));
    expect(r.cards).toEqual([]);
    expect(r.refusals.map((x) => [x.path, x.message])).toEqual([
      ['expect.objects', expect.stringMatching(/^a `starter` card expects at least 5 objects \(the gallery floor\); this one expects 2: .*declare it `control`/)],
      ['expect.dashboards', expect.stringMatching(/at least 1 dashboard .*this one expects 0/)],
      ['run.seed', expect.stringMatching(/at least 100 rows on one object .*this one seeds at most 5, on `contact`/)],
      ['run.personas', expect.stringMatching(/at least 2 personas with a row `scope` .*this one has 1/)],
    ]);
  });

  /** [name, mutation one step below the floor, the ONE refusal's path, its message]. */
  const FLOOR_CASES: Array<[string, (c: RawCard) => void, string, RegExp]> = [
    ['4 expected objects', below((c) => {
      c.expect.objects = c.expect.objects.filter((o: string) => o !== 'territory');
      delete c.run.seed.territory;
    }), 'expect.objects', /^a `starter` card expects at least 5 objects \(the gallery floor\); this one expects 4:/],
    ['no dashboard', below((c) => delete c.expect.dashboards), 'expect.dashboards', /expects at least 1 dashboard .*this one expects 0/],
    ['99 rows on its largest object', below((c) => c.run.seed.activity.pop()), 'run.seed', /seeds at least 100 rows on one object .*this one seeds at most 99, on `activity`/],
    ['1 persona with a row scope', below((c) => delete c.run.personas[1].scope), 'run.personas', /has at least 2 personas with a row `scope` .*this one has 1/],
    // Below the default band too, yet the band's "state why in countsReason" is not
    // offered: no reason lifts a gallery card's floor.
    ['7 questions', below((c) => c.run.questions.pop()), 'run.questions', /asks at least 8 questions .*this one asks 7:/],
    ['7 questions with a countsReason', below((c) => {
      c.run.questions.pop();
      c.run.countsReason = 'The model carries seven distinct questions.';
    }), 'run.questions', /this one asks 7 \(a `countsReason` does not lower the floor\)/],
    ['3 operations', below((c) => (c.run.operations = c.run.operations.filter((o: { id: string }) => o.id !== 'add_contact'))), 'run.operations', /performs at least 4 operations .*this one performs 3:/],
    ['no agent actions', below((c) => delete c.run.agentActions), 'run.agentActions', /declares at least 3 agent actions .*this one declares 0/],
    ['4 expected objects, as a delivery card', below((c) => {
      c.expect.objects = c.expect.objects.filter((o: string) => o !== 'territory');
      delete c.run.seed.territory;
    }, 'delivery'), 'expect.objects', /^a `delivery` card expects at least 5 objects \(the gallery floor\); this one expects 4:/],
  ];

  for (const [name, mutate, path, message] of FLOOR_CASES) {
    it(`refuses a gallery card with ${name}`, () => {
      const r = load(mutate);
      expect(r.refusals.map(formatRefusal)).toHaveLength(1);
      expect(r.refusals[0]).toMatchObject({ file: r.file, path });
      expect(r.refusals[0].message).toMatch(message);
      expect(r.cards).toEqual([]);
    });
  }
});
