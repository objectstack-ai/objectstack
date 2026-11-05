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
 * The cards are read as plain JSON, not through the card loader: this package
 * takes no dependency on the private `@objectstack/scenarios`
 * (`scenario-score.ts` says why). The loader's own suite validates the cards.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';

import { DEFAULT_METADATA_EVAL_CORPUS } from './corpus.js';
import type { ScenarioExpectation } from './scenario-score.js';
import { scoreScenarioArtifact, type ScenarioArtifactCard } from './scenario-tags.js';

type Bag = Record<string, any>;

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = resolve(HERE, '../../../../docs/qa/scenarios');

const cards: Bag[] = readdirSync(SCENARIOS_DIR)
  .filter((n) => n.endsWith('.json'))
  .sort()
  .map((n) => JSON.parse(readFileSync(resolve(SCENARIOS_DIR, n), 'utf8')) as Bag);

const corpusById = new Map(DEFAULT_METADATA_EVAL_CORPUS.map((c) => [c.id, c]));
const controls = cards.filter((c) => corpusById.has(c.id));

/** The derivation the control cards' `provenance` states, applied to a corpus fixture. */
function deriveExpect(fixture: unknown): ScenarioExpectation {
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

/** The slice of a card the artifact scorer reads. */
const cardSlice = (card: Bag): ScenarioArtifactCard => ({
  expect: card.expect,
  capabilities: card.capabilities,
  personas: card.run.personas,
  agentActions: card.run.agentActions,
});

function parsedBuild(stack: unknown): Bag {
  const parsed = ObjectStackDefinitionSchema.safeParse(normalizeStackInput(structuredClone(stack) as Bag));
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return JSON.parse(JSON.stringify(parsed.data)) as Bag;
}

describe('control cards — corpus drift', () => {
  it('finds the three control cards (a pin over nothing would pass)', () => {
    expect(controls.map((c) => c.id)).toEqual(['crm_account_with_contacts', 'invoice_with_line_items', 'project_with_tasks']);
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
  // build delivers, which is what a capability score exists to say.
  const READINGS: Record<string, { tags: Record<string, string>; actions: number; passedOf: [number, number] }> = {
    crm_account_with_contacts: {
      tags: {
        'records-forms.lookup': 'pass',
        'records-forms.select-options': 'pass',
        'ai.ask-data': 'unscored',
        'access-security.field-permissions': 'fail',
      },
      actions: 0,
      passedOf: [10, 18],
    },
    invoice_with_line_items: {
      tags: {
        'records-forms.master-detail-inline-edit': 'pass',
        'records-forms.roll-up-summary': 'pass',
        'records-forms.select-options': 'pass',
        'ai.ask-data': 'unscored',
        'access-security.field-permissions': 'fail',
      },
      actions: 0,
      passedOf: [18, 27],
    },
    project_with_tasks: {
      tags: {
        'records-forms.master-detail-inline-edit': 'pass',
        'records-forms.roll-up-summary': 'pass',
        'records-forms.select-options': 'pass',
        'ai.ask-data': 'unscored',
      },
      actions: 0,
      passedOf: [19, 26],
    },
  };

  for (const card of controls) {
    it(`${card.id}: shape passes, the table judges each tag, every declared action fails`, () => {
      const s = scoreScenarioArtifact(parsedBuild(corpusById.get(card.id)!.fixture), cardSlice(card));
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
    stack.actions = (card.run.agentActions as Bag[]).map((a) => ({
      name: a.name,
      label: a.name,
      objectName: a.object,
      type: 'script',
      target: a.name,
      ai: { exposed: true, description: `${a.summary} Callable by an agent on behalf of the user.`, ...(a.confirm ? { requiresConfirmation: true } : {}) },
    }));
    const complete = parsedBuild(stack);
    const full = scoreScenarioArtifact(complete, cardSlice(card));
    expect(full.score).toBe(1);
    expect(full.unscored).toEqual([{ tag: 'ai.ask-data', reason: 'no check in the closed tag table' }]);

    for (const degrade of [
      (a: Bag) => { a.permissions = []; },
      (a: Bag) => { a.actions = []; },
      (a: Bag) => { delete a.actions.find((x: Bag) => x.name === 'delete_contact').ai.requiresConfirmation; },
      (a: Bag) => { delete (a.objects as Bag[]).find((o) => o.name === 'contact')!.fields.account; },
    ]) {
      const a = structuredClone(complete);
      degrade(a);
      expect(scoreScenarioArtifact(a, cardSlice(card)).score!).toBeLessThan(1);
    }
  });
});
