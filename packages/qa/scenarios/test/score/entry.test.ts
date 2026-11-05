// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The runner's entry (`@objectstack/scenarios/score`): each function scores a
 * card the LOADER returned, so the truths and outcomes it judges against are
 * the loader's, read off the real `crm_account_with_contacts` card.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import { gradeCardAnswer, gradeCardOperation, scoreCardArtifact } from '../../src/score/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD_FILE = resolve(HERE, '../../../../../docs/qa/scenarios/crm_account_with_contacts.json');
const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');

function load(): LoadedScenario {
  const { card, refusals } = loadScenarioFile(CARD_FILE, { areas: readCapabilityAreas(AREAS_DIR) });
  if (!card) throw new Error(refusals.map(formatRefusal).join('\n'));
  return card;
}

const turn = (replyText: string) => ({ replyText, toolCalls: [] });

describe('gradeCardAnswer', () => {
  const crm = load();

  it("grades a persona against that persona's computed truth (sdr sees 2 of the 3 accounts)", () => {
    expect(gradeCardAnswer(crm, { question: 'account_count', persona: 'sdr', turn: turn('You have 2 accounts.\nSource: account') }).correct).toBe(true);
    const leaked = gradeCardAnswer(crm, { question: 'account_count', persona: 'sdr', turn: turn('There are 3 accounts.\nSource: account') });
    expect([leaked.correct, leaked.leaks]).toEqual([false, ["reply: a figure outside the persona's scope (3)"]]);
  });

  it('grades a withheld truth as must-not-reveal, with the hidden object read from the persona', () => {
    expect(gradeCardAnswer(crm, { question: 'account_count', persona: 'partner_user', turn: turn('Sorry, you do not have access to accounts.') }).correct).toBe(true);
    const g = gradeCardAnswer(crm, {
      question: 'account_count',
      persona: 'partner_user',
      turn: { replyText: "I can't share that.", toolCalls: [{ name: 'count_records', input: { objectName: 'account' }, output: { count: 3 } }] },
    });
    expect(g.leaks).toEqual(['count_records answered over hidden object account']);
  });

  it('grades a question with no persona against the all-rows truth', () => {
    expect(gradeCardAnswer(crm, { question: 'account_count', turn: turn('There are 3 accounts.\nSource: account') }).correct).toBe(true);
  });

  it('refuses a question, persona or pairing the card does not have', () => {
    expect(() => gradeCardAnswer(crm, { question: 'nope', turn: turn('') })).toThrow(RangeError);
    expect(() => gradeCardAnswer(crm, { question: 'account_count', persona: 'nobody', turn: turn('') })).toThrow(RangeError);
    expect(() => gradeCardAnswer(crm, { question: 'tech_accounts', persona: 'sdr', turn: turn('') })).toThrow(RangeError);
  });
});

describe('gradeCardOperation', () => {
  const crm = load();

  it("judges an observation against the operation's declared outcome", () => {
    expect(gradeCardOperation(crm, 'contact_bad_email', { answer: { kind: 'refused', code: 'VALIDATION_FAILED' }, writes: 0 }).pass).toBe(true);
    expect(gradeCardOperation(crm, 'contact_bad_email', { answer: { kind: 'applied' }, writes: 1 }).pass).toBe(false);
    expect(gradeCardOperation(crm, 'remove_chen', { answer: { kind: 'pending_confirmation' }, writes: 0 }).pass).toBe(true);
  });

  it('refuses an operation the card does not have', () => {
    expect(() => gradeCardOperation(crm, 'nope', { answer: { kind: 'applied' } })).toThrow(RangeError);
  });
});

describe('scoreCardArtifact', () => {
  it('scores the loaded card against a built artifact', () => {
    const crm = load();
    const artifact = {
      objects: [
        { name: 'account', fields: { name: { type: 'text' }, industry: { type: 'select', options: [{ value: 'tech' }, { value: 'retail' }] } } },
        { name: 'contact', fields: { full_name: { type: 'text' }, email: { type: 'email' }, account: { type: 'lookup', reference: 'account' } } },
      ],
    };
    const s = scoreCardArtifact(crm, artifact);
    expect(s.expect.passed).toBe(s.expect.total);
    expect(Object.fromEntries(s.tags.map((t) => [t.tag, t.status]))).toEqual({
      'records-forms.lookup': 'pass',
      'records-forms.select-options': 'pass',
      'ai.ask-data': 'unscored',
      'access-security.field-permissions': 'fail',
    });
  });
});
