// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The scenario library's control cards against the code that owns their
 * source: `docs/qa/scenarios/*.json` read as files, beside the golden corpus
 * (`corpus.ts`) they were derived from.
 *
 *  1. DRIFT. A control card's `expect` was derived once, mechanically, from its
 *     corpus fixture (the card's `provenance` states the rule). Nothing held
 *     the two equal afterwards: an edit to a corpus fixture would leave the
 *     card scoring against a build the corpus no longer models. The pin derives
 *     `expect` from each fixture by that same rule and requires the card to
 *     equal it.
 *  2. END TO END. Each control card is scored against its golden build — the
 *     corpus fixture parsed as `os build` parses it — through
 *     `scoreScenarioArtifact`: shape, capability tags and agent actions. The
 *     readings are pinned, and one card is completed with what it asks of the
 *     build beyond shape, then degraded, to show the score separates the two.
 *  3. TRACE. Every write a card has a persona make, or refuses it
 *     (`personaGrantNeeds`: an `applied` or `pending_confirmation` operation,
 *     one refused `PERMISSION_DENIED`), is a grant the Build checks judge, and
 *     the build is judged only on what its prompt says. So each write need of
 *     every card in the library is stated in that card's rendered build prompt
 *     (`buildPrompt`), for that persona: through the persona's `role` (the
 *     carrier the library's owner ruled), or through the card's prose.
 *
 * The cards are loaded through this package's loader; the corpus is the CLI's
 * (`packages/cli/src/lint/corpus.ts`, the `os lint --eval` golden set), read
 * by a relative import declared as this suite's cross-package input.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';

import { DEFAULT_METADATA_EVAL_CORPUS } from '../../../../cli/src/lint/corpus.js';
import type { ScenarioExpect } from '../../src/schema.js';
import { formatRefusal, loadScenarioFile, loadScenarios, readCapabilityAreas } from '../../src/loader.js';
import { buildPrompt } from '../../src/runner/prompts.js';
import type { ScenarioCard } from '../../src/schema.js';
import { gradeCapabilityTags, personaGrantNeeds, readArtifactFacts, scoreScenarioArtifact } from '../../src/score/scenario-tags.js';

type Bag = Record<string, any>;

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = resolve(HERE, '../../../../../docs/qa/scenarios');

const corpusById = new Map(DEFAULT_METADATA_EVAL_CORPUS.map((c) => [c.id, c]));

const AREAS = readCapabilityAreas(resolve(HERE, '../../../../../docs/qa/platform-checklist/areas'));

/**
 * The control cards: the library's cards named for a golden corpus case (a
 * card's basename is its id), loaded through the card loader — a card it
 * refuses is a red here, never a card scored half-valid.
 */
const controls: ScenarioCard[] = DEFAULT_METADATA_EVAL_CORPUS.map((c) => resolve(SCENARIOS_DIR, `${c.id}.json`))
  .filter((file) => existsSync(file))
  .map((file) => {
    const { card, refusals } = loadScenarioFile(file, { areas: AREAS, library: 'open' });
    if (!card) throw new Error(refusals.map(formatRefusal).join('\n'));
    return card.card;
  })
  .sort((a, b) => (a.id < b.id ? -1 : 1));

/** The derivation the control cards' `provenance` states, applied to a corpus fixture. */
function deriveExpect(fixture: unknown): ScenarioExpect {
  const objects = (fixture as Bag).objects as Bag[];
  const fields = (o: Bag) => Object.entries(o.fields as Bag) as Array<[string, Bag]>;
  const selectFields = objects.flatMap((o) =>
    fields(o).filter(([, f]) => f.type === 'select').map(([name, f]) => ({ object: o.name, field: name, minOptions: f.options.length })),
  );
  const lookups = objects.flatMap((o) =>
    fields(o)
      .filter(([, f]) => f.type === 'lookup' || f.type === 'master_detail')
      .map(([name, f]) => ({ object: o.name, field: name, to: f.reference })),
  );
  return {
    objects: objects.map((o) => o.name),
    minFieldsPerObject: Math.min(...objects.map((o) => fields(o).length)),
    ...(selectFields.length ? { selectFields } : {}),
    ...(lookups.length ? { lookups } : {}),
  };
}


function parsedBuild(stack: unknown): Bag {
  const parsed = ObjectStackDefinitionSchema.safeParse(normalizeStackInput(structuredClone(stack) as Bag));
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return JSON.parse(JSON.stringify(parsed.data)) as Bag;
}

describe('control cards — corpus drift', () => {
  it('finds the three control cards (a pin over nothing would pass)', () => {
    expect(controls.map((c) => c.id)).toEqual(['crm_account_with_contacts', 'invoice_with_line_items', 'project_with_tasks']);
    for (const card of controls) expect(card.id).toBe(corpusById.get(card.id)?.id);
  });

  for (const card of controls) {
    it(`${card.id}: expect equals what corpus.ts derives`, () => {
      expect(card.expect).toEqual(deriveExpect(corpusById.get(card.id)!.fixture));
    });
  }

  it('goes red on a corpus edit the card does not follow', () => {
    const fixture = structuredClone(corpusById.get('crm_account_with_contacts')!.fixture) as Bag;
    fixture.objects[0].fields.industry.options.push({ label: 'Finance', value: 'finance' });
    const card = controls.find((c) => c.id === 'crm_account_with_contacts')!;
    expect(card.expect).not.toEqual(deriveExpect(fixture));
  });
});

describe('control cards — scored end to end against their golden builds', () => {
  // Measured readings. The golden corpus models SHAPE: every `expect` check
  // passes, and so does every tag the closed table judges on shape. It models
  // no permission set and no action, so a card's field-permission tag, every
  // declared agent action and every persona grant fail on it — the card asks
  // for more than the corpus build delivers, which is what a capability score
  // exists to say. Its objects declare no sharing model, so they are private
  // (ADR-0090 D1) and the row-scope tag passes on them.
  const READINGS: Record<string, { tags: Record<string, string>; actions: number; grants: number; passedOf: [number, number] }> = {
    crm_account_with_contacts: {
      tags: {
        'records-forms.lookup': 'pass',
        'records-forms.select-options': 'pass',
        'ai.ask-data': 'unscored',
        'access-security.field-permissions': 'fail',
        'access-security.row-scope': 'pass',
      },
      actions: 0,
      grants: 6,
      passedOf: [12, 28],
    },
    invoice_with_line_items: {
      tags: {
        'records-forms.master-detail-inline-edit': 'pass',
        'records-forms.roll-up-summary': 'pass',
        'records-forms.select-options': 'pass',
        'ai.ask-data': 'unscored',
        'access-security.field-permissions': 'fail',
        'access-security.row-scope': 'pass',
      },
      actions: 0,
      grants: 8,
      passedOf: [20, 39],
    },
    project_with_tasks: {
      tags: {
        'records-forms.master-detail-inline-edit': 'pass',
        'records-forms.roll-up-summary': 'pass',
        'records-forms.select-options': 'pass',
        'ai.ask-data': 'unscored',
        'access-security.row-scope': 'pass',
      },
      actions: 0,
      grants: 5,
      passedOf: [20, 34],
    },
  };

  for (const card of controls) {
    it(`${card.id}: shape passes, the table judges each tag, every declared action and persona grant fails`, () => {
      const s = scoreScenarioArtifact(parsedBuild(corpusById.get(card.id)!.fixture), card);
      const reading = READINGS[card.id]!;
      expect(s.expect.passed).toBe(s.expect.total);
      expect(Object.fromEntries(s.tags.map((t) => [t.tag, t.status]))).toEqual(reading.tags);
      expect(s.agentActions.filter((c) => c.pass)).toHaveLength(reading.actions);
      expect(s.agentActions.length).toBeGreaterThan(0);
      expect(s.personaGrants.map((c) => [c.pass, c.detail?.startsWith('the build declares no permission set ')])).toEqual(
        Array.from({ length: reading.grants }, () => [false, true]),
      );
      expect([s.passed, s.total]).toEqual(reading.passedOf);
    });
  }

  it('crm_account_with_contacts: the build completed with what the card asks scores 1, and each removal scores lower', () => {
    const card = controls.find((c) => c.id === 'crm_account_with_contacts')!;
    const stack = structuredClone(corpusById.get(card.id)!.fixture) as Bag;
    // Each persona's own set, named as the runner grants it with no namespace
    // (its id): the sdr reads accounts and works contacts; the partner user
    // creates contacts and holds no grant on accounts, so its refused account
    // edit is refused by the set. The sdr's deletes are of contacts the admin
    // owns, so its set also lifts the platform's owner-only delete floor
    // (`writeScope: 'org'`; Modify All would unmask `email`).
    stack.permissions = [
      {
        name: 'sdr',
        label: 'SDR',
        objects: { account: { allowRead: true }, contact: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, writeScope: 'org' } },
        fields: { 'contact.email': { readable: false, editable: false } },
      },
      { name: 'partner_user', label: 'Partner User', objects: { contact: { allowRead: true, allowCreate: true } } },
    ];
    stack.actions = (card.run.agentActions ?? []).map((a) => ({
      name: a.name,
      label: a.name,
      objectName: a.object,
      type: 'script',
      target: a.name,
      ai: { exposed: true, description: `${a.summary} Callable by an agent on behalf of the user.`, ...(a.confirm ? { requiresConfirmation: true } : {}) },
    }));
    const complete = parsedBuild(stack);
    const full = scoreScenarioArtifact(complete, card);
    expect(full.score).toBe(1);
    expect(full.unscored).toEqual([{ tag: 'ai.ask-data', reason: 'no check in the closed tag table' }]);

    for (const degrade of [
      (a: Bag) => { a.permissions = []; },
      (a: Bag) => { delete a.permissions[0].objects.contact.allowEdit; },
      (a: Bag) => { delete a.permissions[0].objects.contact.writeScope; },
      (a: Bag) => { a.permissions[1].objects.account = { allowRead: true, allowEdit: true }; },
      (a: Bag) => { a.actions = []; },
      (a: Bag) => { delete a.actions.find((x: Bag) => x.name === 'delete_contact').ai.requiresConfirmation; },
      (a: Bag) => { delete (a.objects as Bag[]).find((o) => o.name === 'contact')!.fields.account; },
      (a: Bag) => { for (const o of a.objects as Bag[]) o.sharingModel = 'public_read'; },
    ]) {
      const a = structuredClone(complete);
      degrade(a);
      expect(scoreScenarioArtifact(a, card).score!).toBeLessThan(1);
    }

    // The sdr deletes a contact it names outright (`remove_ben`, applied: the
    // maintainer's 2026-11-16 ruling) beside the ambiguous delete that waits on
    // confirmation, so withholding the raw delete is measured, and fails, even
    // though the build declares the card's confirm-gated delete_contact.
    const noDelete = structuredClone(complete);
    delete noDelete.permissions[0].objects.contact.allowDelete;
    const withheld = scoreScenarioArtifact(noDelete, card);
    expect(withheld.score!).toBeLessThan(1);
    expect(withheld.personaGrants.find((c) => c.check === 'persona-grant:sdr:contact:delete')).toMatchObject({ pass: false });
    expect(withheld.personaGrants.find((c) => c.check === 'persona-grant:sdr:contact:delete')!.notMeasured).toBeUndefined();
    // Only a delete that waits on confirmation alone leaves the check to the run: with `remove_ben` out of the
    // card, withholding the raw delete is the route the card designs, so the check leaves both figures, never a pass.
    const waiting = { ...card, run: { ...card.run, operations: card.run.operations!.filter((o) => o.id !== 'remove_ben') } };
    const fullWaiting = scoreScenarioArtifact(complete, waiting);
    const routed = scoreScenarioArtifact(noDelete, waiting);
    expect([routed.score, routed.total, routed.passed]).toEqual([1, fullWaiting.total - 1, fullWaiting.passed - 1]);
    expect(routed.personaGrants.find((c) => c.check === 'persona-grant:sdr:contact:delete')!.notMeasured).toMatch(/confirm-gated agent action delete_contact/);
  });

  it("crm_account_with_contacts: the first live run's build (public_read, sdr narrowed by read policies) passes the row-scope tag", () => {
    // As the correction on card #30883 (6682060124) read the built artifact:
    // both objects `public_read`, and the sdr's permission set carrying a
    // `select` policy per object (a hook-maintained copy of the account owner
    // on contact, since RLS cannot traverse `account.owner`).
    const card = controls.find((c) => c.id === 'crm_account_with_contacts')!;
    const stack = structuredClone(corpusById.get(card.id)!.fixture) as Bag;
    for (const o of stack.objects as Bag[]) o.sharingModel = 'public_read';
    (stack.objects as Bag[]).find((o) => o.name === 'contact')!.fields.account_owner = { type: 'text', label: 'Account Owner' };
    stack.permissions = [{
      name: 'crm_sdr',
      label: 'SDR',
      objects: { account: { allowRead: true }, contact: { allowRead: true } },
      rowLevelSecurity: [
        { name: 'own_accounts', object: 'account', operation: 'select', using: 'owner == current_user.id' },
        { name: 'own_contacts', object: 'contact', operation: 'select', using: 'account_owner == current_user.id' },
      ],
    }];
    const built = parsedBuild(stack);
    const rowScope = (a: Bag) =>
      gradeCapabilityTags(readArtifactFacts(a), { ...card, capabilities: ['access-security.row-scope'] }, { namespace: 'crm' })[0]!;
    expect(rowScope(built).checks.map((c) => [c.check, c.pass])).toEqual([
      ['row-scope:account->scoped', true],
      ['row-scope:contact->scoped', true],
    ]);
    // Without the contact policy, the sdr reads every contact: the tag fails on that object alone.
    const leaky = structuredClone(built);
    leaky.permissions[0].rowLevelSecurity.pop();
    expect(rowScope(leaky).checks.map((c) => [c.check, c.pass])).toEqual([
      ['row-scope:account->scoped', true],
      ['row-scope:contact->scoped', false],
    ]);
  });
});

describe('every card — each write need is stated in its build prompt, for its persona', () => {
  const loaded = loadScenarios(SCENARIOS_DIR, { areas: AREAS, library: 'open' });
  if (loaded.refusals.length) throw new Error(loaded.refusals.map(formatRefusal).join('\n'));
  const library: ScenarioCard[] = loaded.cards.map((c) => c.card);
  const writeNeeds = (card: ScenarioCard) =>
    personaGrantNeeds(card)
      .flatMap((n) => (n.verb === 'read' ? [] : [{ ...n, verb: n.verb, key: `${card.id}:${n.persona}:${n.object}:${n.verb}`, refusedOnly: n.requiredBy.length === 0 }]));

  /**
   * The text rule for a need the persona's `role` carries: the role names the
   * object (its machine name with `_` read as a space, a plural allowed) and a
   * word for the verb; a write the card refuses also carries a negation
   * ("may not", "but not", "cannot", "never"). Its limits, stated: the rule
   * reads words, not grammar — it does not check that the verb word governs the
   * object, nor which of two objects a negation applies to; a reviewer reads
   * the role for that. The word lists are the verbs the library's roles use;
   * a new role verb is added here, in the open.
   */
  const VERB_WORDS: Record<'create' | 'update' | 'delete', RegExp> = {
    create: /\b(adds?|creates?|logs?|files?|raises?|registers?|records?|enters?|submits?)\b/i,
    update: /\b(updates?|edits?|changes?|moves?|approves?|reassigns?|closes?|resolves?|cancels?|corrects?|pays?|sends?|extends?|disposes?)\b/i,
    delete: /\b(deletes?|removes?)\b/i,
  };
  const NEGATION = /\b(may not|but not|cannot|never)\b/i;
  const namesObject = (text: string, object: string) => new RegExp(`\\b${object.split('_').join('\\s+')}s?\\b`, 'i').test(text);
  const roleStates = (role: string, n: { object: string; verb: 'create' | 'update' | 'delete'; refusedOnly: boolean }) =>
    namesObject(role, n.object) && VERB_WORDS[n.verb].test(role) && (!n.refusedOnly || NEGATION.test(role));

  /**
   * Each write need of the library and where its build prompt states it:
   * `ROLE` (the persona's role, judged by the text rule above), or the prose
   * passages, quoted verbatim, that name the persona, the object and the act.
   * A prose trace is a reviewer's reading, pinned so that it cannot silently
   * stop being true: a quote edited out of the card's prose, or a new need with
   * no entry, is a red.
   */
  const ROLE = 'role' as const;
  const TRACES: Record<string, typeof ROLE | readonly string[]> = {
    'asset_lifecycle:asset_admin:asset:create': ROLE,
    'asset_lifecycle:asset_admin:checkout:update': ['The asset administrator checks assets out to employees', 'a checkout records the checkout date, a due date'],
    'asset_lifecycle:dept_manager:disposal_request:update': ["the manager of the asset's department decides a scrap request", 'deciding it updates the request'],
    'asset_lifecycle:asset_admin:disposal_request:update': ['once it is approved the asset administrator disposes of the asset'],
    'asset_lifecycle:employee:disposal_request:update': ROLE,
    'crm_account_with_contacts:sdr:contact:create': ROLE,
    'crm_account_with_contacts:sdr:contact:update': ROLE,
    'crm_account_with_contacts:sdr:contact:delete': ROLE,
    'crm_account_with_contacts:partner_user:account:update': ROLE,
    'invoice_with_line_items:sales_rep:invoice_line:create': ROLE,
    'invoice_with_line_items:sales_rep:invoice:update': ROLE,
    'invoice_with_line_items:sales_rep:invoice_line:delete': ROLE,
    'invoice_with_line_items:warehouse_staff:invoice:update': ROLE,
    'leave_balances:employee:leave_request:create': ['An employee files a leave request'],
    'leave_balances:employee:leave_day:update': ['An employee files a leave request with one line per date', "The day lines are details of the request (master-detail), edited inline on the request's form"],
    'leave_balances:dept_manager:approval_step:update': ['up to 3 days needs only the department manager', 'approving or rejecting a step updates that record'],
    'leave_balances:hr_officer:leave_request:delete': ROLE,
    'leave_balances:employee:leave_balance:update': ROLE,
    'order_to_cash:sales_rep:sales_order:create': ['A rep enters sales orders for their own accounts'],
    'order_to_cash:sales_rep:order_line:update': ['A rep enters sales orders', "The lines are details of the order (master-detail), edited inline on the order's form"],
    'order_to_cash:sales_rep:sales_order:update': ['a rep cannot approve their own order'],
    'order_to_cash:sales_manager:sales_order:update': ["goes to the rep's sales manager for approval", 'approving updates the order'],
    'order_to_cash:ar_clerk:invoice:update': ['Only Finance may write off a balance as bad debt', 'Accounts receivable clerk, Finance, organization-wide'],
    'project_with_tasks:contractor:task:create': ROLE,
    'project_with_tasks:contractor:task:update': ROLE,
    'project_with_tasks:contractor:task:delete': ROLE,
    'project_with_tasks:client_viewer:task:update': ROLE,
    'requisition_to_receipt:buyer:purchase_order:create': ['the buyer raises a purchase order to a supplier'],
    'requisition_to_receipt:buyer:po_line:update': ['the buyer raises a purchase order to a supplier with several lines', "The lines are details of the order (master-detail), edited inline on the order's form"],
    'requisition_to_receipt:dept_manager:approval_step:update': ['up to 5,000 the department manager alone', 'approving or rejecting a level updates that record'],
    'requisition_to_receipt:buyer:purchase_order:update': ['the buyer raises a purchase order', 'Cancelling an order already sent to the supplier cannot be undone and is confirmed first'],
    'service_desk:support_agent:ticket:create': ROLE,
    'service_desk:team_lead:ticket:update': ROLE,
    'service_desk:support_agent:ticket:update': ['once an agent takes it, it is open', 'resolving it sends the customer a satisfaction survey'],
    'service_desk:support_agent:satisfaction_rating:update': ["no agent can change a customer's rating"],
    'travel_expense:employee:expense_claim:create': ['Afterwards they file an expense claim with several lines'],
    'travel_expense:employee:claim_line:update': ["The lines are details of the claim (master-detail), edited inline on the claim's form"],
    'travel_expense:dept_manager:approval_step:update': ['the department manager first', 'approving or rejecting a step updates that record'],
    'travel_expense:finance_officer:expense_claim:update': ['once Finance approves, Finance pays it', 'Finance officer, organization-wide'],
    'travel_expense:employee:approval_step:update': ROLE,
  };

  it('reads every card of the library, and every write need has a trace (a need with none is a red)', () => {
    expect(library.length).toBe(9);
    expect(library.flatMap(writeNeeds).map((n) => n.key).sort()).toEqual(Object.keys(TRACES).sort());
  });

  for (const card of library) {
    it(`${card.id}: each write need is stated, by its persona's role or by the quoted prose`, () => {
      const prompt = buildPrompt(card).replace(/\s+/g, ' ');
      for (const n of writeNeeds(card)) {
        const trace = TRACES[n.key]!;
        if (trace === ROLE) {
          const role = card.run.personas.find((p) => p.id === n.persona)!.role;
          expect([n.key, roleStates(role, n)]).toEqual([n.key, true]);
          expect(prompt).toContain(`for \`${n.persona}\` (${role})`);
        } else {
          for (const quote of trace) expect([n.key, prompt.includes(quote)]).toEqual([n.key, true]);
        }
      }
    });
  }

  it('the text rule goes red on the roles the library carried before the owner\'s ruling', () => {
    const need = (object: string, verb: 'create' | 'update' | 'delete', refusedOnly = false) => ({ object, verb, refusedOnly });
    expect(roleStates('External contractor', need('task', 'create'))).toBe(false);
    expect(roleStates('Sales representative', need('invoice_line', 'delete'))).toBe(false);
    expect(roleStates('Warehouse staff', need('invoice', 'update', true))).toBe(false);
    // The object and a verb, but a different verb's word: still red.
    expect(roleStates('External contractor who logs their own tasks', need('task', 'delete'))).toBe(false);
    // A refusal stated without a negation is a grant, not a refusal: red.
    expect(roleStates('Warehouse staff who change invoices', need('invoice', 'update', true))).toBe(false);
    expect(roleStates('Warehouse staff who may read invoices but not change them', need('invoice', 'update', true))).toBe(true);
    expect(roleStates('Sales representative who adds and removes invoice lines and sends invoices', need('invoice_line', 'create'))).toBe(true);
  });
});
