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
import { formatRefusal, loadScenarioFile, readCapabilityAreas } from '../../src/loader.js';
import type { ScenarioCard } from '../../src/schema.js';
import { gradeCapabilityTags, readArtifactFacts, scoreScenarioArtifact } from '../../src/score/scenario-tags.js';

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
    const { card, refusals } = loadScenarioFile(file, { areas: AREAS });
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
  // no permission set and no action, so a card's field-permission tag and every
  // declared agent action fail on it — the card asks for more than the corpus
  // build delivers, which is what a capability score exists to say. Its objects
  // declare no sharing model, so they are private (ADR-0090 D1) and the
  // row-scope tag passes on them.
  const READINGS: Record<string, { tags: Record<string, string>; actions: number; passedOf: [number, number] }> = {
    crm_account_with_contacts: {
      tags: {
        'records-forms.lookup': 'pass',
        'records-forms.select-options': 'pass',
        'ai.ask-data': 'unscored',
        'access-security.field-permissions': 'fail',
        'access-security.row-scope': 'pass',
      },
      actions: 0,
      passedOf: [12, 20],
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
      passedOf: [20, 29],
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
      passedOf: [20, 27],
    },
  };

  for (const card of controls) {
    it(`${card.id}: shape passes, the table judges each tag, every declared action fails`, () => {
      const s = scoreScenarioArtifact(parsedBuild(corpusById.get(card.id)!.fixture), card);
      const reading = READINGS[card.id]!;
      expect(s.expect.passed).toBe(s.expect.total);
      expect(Object.fromEntries(s.tags.map((t) => [t.tag, t.status]))).toEqual(reading.tags);
      expect(s.agentActions.filter((c) => c.pass)).toHaveLength(reading.actions);
      expect(s.agentActions.length).toBeGreaterThan(0);
      expect([s.passed, s.total]).toEqual(reading.passedOf);
    });
  }

  it('crm_account_with_contacts: the build completed with what the card asks scores 1, and each removal scores lower', () => {
    const card = controls.find((c) => c.id === 'crm_account_with_contacts')!;
    const stack = structuredClone(corpusById.get(card.id)!.fixture) as Bag;
    stack.permissions = [{
      name: 'crm_sdr',
      label: 'SDR',
      objects: { account: { allowRead: true }, contact: { allowRead: true, allowCreate: true, allowEdit: true } },
      fields: { 'contact.email': { readable: false, editable: false } },
    }];
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
      (a: Bag) => { a.actions = []; },
      (a: Bag) => { delete a.actions.find((x: Bag) => x.name === 'delete_contact').ai.requiresConfirmation; },
      (a: Bag) => { delete (a.objects as Bag[]).find((o) => o.name === 'contact')!.fields.account; },
      (a: Bag) => { for (const o of a.objects as Bag[]) o.sharingModel = 'public_read'; },
    ]) {
      const a = structuredClone(complete);
      degrade(a);
      expect(scoreScenarioArtifact(a, card).score!).toBeLessThan(1);
    }
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
