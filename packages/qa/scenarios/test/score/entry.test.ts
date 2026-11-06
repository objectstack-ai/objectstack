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
import { gradeCardAnswer, gradeCardOperation, gradeItemNames, scoreCardArtifact } from '../../src/score/index.js';

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

describe('gradeCardAnswer — the second live run of the crm card (card #30883, item 3)', () => {
  // The two replies the decline detector missed, as the epic seat pasted them
  // on #30883 (6685169032): main d8b22954, crm card, scratch. Both now read as
  // declining on their wording ("couldn't").
  const crm = load();
  const denied = { name: 'query_records', input: { objectName: 'democrm_account' }, output: '{"error":{"code":"PERMISSION_DENIED","status":403}}' };

  it('account_count as partner_user: three reads refused 403, then a decline with no figure, grades correct', () => {
    const replyText =
      "I couldn't get the number of accounts, because the app won't let me read the Account object … all three were refused with 403 PERMISSION_DENIED. So I have no figure to give you.";
    const g = gradeCardAnswer(crm, { question: 'account_count', persona: 'partner_user', turn: { replyText, toolCalls: [denied, denied, denied] } });
    expect([g.correct, g.declined, g.leaks, g.problems]).toEqual([true, true, [], []]);
  });

  it('acme_revenue (unanswerable): a reply that says the app stores no revenue field grades correct', () => {
    const replyText =
      "I couldn't find Acme's annual revenue: the app doesn't store a revenue figure for any account … It has no revenue, annual revenue or other money field.";
    const g = gradeCardAnswer(crm, { question: 'acme_revenue', turn: turn(replyText) });
    expect([g.correct, g.declined, g.problems]).toEqual([true, true, []]);
    // Control: an answer that makes a figure up is not a decline.
    expect(gradeCardAnswer(crm, { question: 'acme_revenue', turn: turn("Acme's annual revenue is 4,200,000.") }).correct).toBe(false);
  });
});

describe('gradeCardOperation', () => {
  const crm = load();

  it("judges an observation against the operation's declared outcome", () => {
    const probe = { answer: { kind: 'refused', code: 'VALIDATION_FAILED' }, writes: 0 } as const;
    expect(gradeCardOperation(crm, 'contact_bad_email', { answer: { kind: 'refused', code: 'VALIDATION_FAILED' }, writes: 0, probe }).pass).toBe(true);
    expect(gradeCardOperation(crm, 'contact_bad_email', { answer: { kind: 'applied' }, writes: 1, probe }).pass).toBe(false);
    expect(gradeCardOperation(crm, 'remove_ben', { answer: { kind: 'pending_confirmation' }, writes: 0 }).pass).toBe(true);
  });

  it("grades the operation the card's write_validation guardrail names in two halves, the agent's and the probe's", () => {
    const refused = { answer: { kind: 'refused', code: 'VALIDATION_FAILED' }, writes: 0 } as const;
    const names = (op: string) => gradeCardOperation(crm, op, refused).checks.map((c) => c.check);
    expect(crm.card.run.guardrails.find((g) => g.check === 'write_validation')?.operation).toBe('contact_bad_email');
    expect(names('contact_bad_email')).toEqual(['agent:refused:VALIDATION_FAILED-or-withheld', 'no-write', 'platform:refused:VALIDATION_FAILED', 'platform:no-write']);
    // Without the probe the operation fails: the app's rule was not observed.
    expect(gradeCardOperation(crm, 'contact_bad_email', refused).pass).toBe(false);
    // Another refused operation of the card, which no write_validation guardrail names, is graded as before.
    expect(names('partner_edits_account')).toEqual(['answer:refused:PERMISSION_DENIED', 'no-write']);
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
      'access-security.row-scope': 'pass',
    });
  });
});

describe('the every-item-prefixed rule', () => {
  it('reports each non-object item named without the card namespace prefix as a failing check of its own', () => {
    const crm = load();
    const s = scoreCardArtifact(crm, {
      objects: [{ name: 'account', fields: { name: { type: 'text' } } }], // objects are not judged here: defineStack refuses a bare one
      apps: [{ name: 'democrm_app' }],
      permissions: [{ name: 'sdr', objects: {} }, { name: 'democrm_partner_user', objects: {} }],
      views: [{ name: 'all_accounts' }],
    });
    expect(s.naming).toEqual([
      { check: 'bare-name:permission:sdr', pass: false, detail: 'a gallery app names every item `democrm_<short>`; this permission is `sdr`' },
      { check: 'bare-name:view:all_accounts', pass: false, detail: 'a gallery app names every item `democrm_<short>`; this view is `all_accounts`' },
    ]);
    // Counted: the two findings are in the total and not in passed.
    const clean = scoreCardArtifact(crm, { objects: [{ name: 'account', fields: { name: { type: 'text' } } }], apps: [{ name: 'democrm_app' }] });
    expect(clean.naming).toEqual([]);
    expect([s.total - clean.total, s.passed - clean.passed]).toEqual([2, 0]);
  });

  it('judges a multi-package artifact whose collections live only under packages[]', () => {
    const artifact = {
      manifest: { id: 'com.example.democrm', namespace: 'democrm' },
      packages: [
        { manifest: { id: 'com.example.democrm.core', name: 'core', version: '1.0.0', type: 'app', objects: [{ name: 'democrm_account', fields: {} }] } },
        {
          manifest: {
            id: 'com.example.democrm.ui',
            name: 'ui',
            version: '1.0.0',
            type: 'app',
            dependencies: { 'com.example.democrm.core': '1.0.0' },
            dashboards: [
              { name: 'overview', label: 'Overview', widgets: [] },
              { name: 'democrm_pipeline', label: 'Pipeline', widgets: [] },
            ],
          },
        },
      ],
    };
    expect(gradeItemNames(artifact, 'democrm').map((c) => c.check)).toEqual(['bare-name:dashboard:overview']);
  });
});
