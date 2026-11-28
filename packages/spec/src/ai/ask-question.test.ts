// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ask-question envelope (question-card topic #37871, D2): the closed shape,
 * its limits, and `parseAskQuestionEnvelope` — the new envelope, the legacy
 * `ask_which` result, and `null` for everything else.
 *
 * Refusal legs assert the issue zod answers and its path, not a bare failure:
 * a shape that degraded to a loose object would still fail on `null`.
 */

import { describe, expect, it } from 'vitest';
import {
  ASK_QUESTION_LIMITS,
  ASK_QUESTION_STATUS,
  ASK_WHICH_LEGACY_STATUS,
  AskQuestionEnvelopeSchema,
  AskQuestionOptionSchema,
  AskQuestionSchema,
  parseAskQuestionEnvelope,
} from './index';

const OPTIONS = [
  { label: 'Closed date', description: 'Revenue counted when the deal closed', recommended: true },
  { label: 'Created date' },
];

const ENVELOPE = {
  success: true,
  status: 'asked',
  reply: 'Which date should revenue be counted by?\n- Closed date\n- Created date',
  questions: [{ question: 'Which date should revenue be counted by?', options: OPTIONS }],
};

/** The first issue's code and path, or `undefined` when the parse succeeds. */
function firstIssue(
  schema: { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; keys?: string[] }> } } },
  value: unknown,
) {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  const [issue] = result.error!.issues;
  return { code: issue.code, path: issue.path, keys: issue.keys };
}

function withQuestion(question: Record<string, unknown>) {
  return { ...ENVELOPE, questions: [{ ...ENVELOPE.questions[0], ...question }] };
}

function options(n: number) {
  return Array.from({ length: n }, (_, i) => ({ label: `Option ${i + 1}` }));
}

describe('AskQuestionEnvelopeSchema', () => {
  it('admits the full shape and returns it unchanged', () => {
    const full = {
      ...ENVELOPE,
      preface: 'Two things decide this number.',
      questions: [
        { header: 'Date', question: 'Which date?', options: OPTIONS },
        { header: 'Currency', question: 'Which currency?', options: [{ label: 'USD' }, { label: 'EUR' }] },
      ],
    };
    const parsed = AskQuestionEnvelopeSchema.safeParse(full);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(full);
  });

  it('refuses an unknown key at every level, never drops it', () => {
    expect(firstIssue(AskQuestionEnvelopeSchema, { ...ENVELOPE, multiSelect: true }))
      .toMatchObject({ code: 'unrecognized_keys', keys: ['multiSelect'] });
    expect(firstIssue(AskQuestionSchema, { question: 'Q?', options: OPTIONS, allowOther: true }))
      .toMatchObject({ code: 'unrecognized_keys', keys: ['allowOther'] });
    expect(firstIssue(AskQuestionOptionSchema, { label: 'A', value: 'a' }))
      .toMatchObject({ code: 'unrecognized_keys', keys: ['value'] });
  });

  it('refuses a status other than asked, and success other than true', () => {
    expect(firstIssue(AskQuestionEnvelopeSchema, { ...ENVELOPE, status: 'asked_which' }))
      .toMatchObject({ code: 'invalid_value', path: ['status'] });
    expect(firstIssue(AskQuestionEnvelopeSchema, { ...ENVELOPE, success: false }))
      .toMatchObject({ code: 'invalid_value', path: ['success'] });
  });

  it('refuses an empty or missing reply', () => {
    expect(firstIssue(AskQuestionEnvelopeSchema, { ...ENVELOPE, reply: '' }))
      .toMatchObject({ code: 'too_small', path: ['reply'] });
    const { reply: _reply, ...noReply } = ENVELOPE;
    expect(firstIssue(AskQuestionEnvelopeSchema, noReply)).toMatchObject({ code: 'invalid_type', path: ['reply'] });
  });

  it('takes one or two questions: zero and three are refused', () => {
    const q = ENVELOPE.questions[0];
    expect(AskQuestionEnvelopeSchema.safeParse({ ...ENVELOPE, questions: [q] }).success).toBe(true);
    expect(AskQuestionEnvelopeSchema.safeParse({ ...ENVELOPE, questions: [q, q] }).success).toBe(true);
    expect(firstIssue(AskQuestionEnvelopeSchema, { ...ENVELOPE, questions: [] }))
      .toMatchObject({ code: 'too_small', path: ['questions'] });
    expect(firstIssue(AskQuestionEnvelopeSchema, { ...ENVELOPE, questions: [q, q, q] }))
      .toMatchObject({ code: 'too_big', path: ['questions'] });
  });

  it('takes two to four options: one and five are refused', () => {
    for (const n of [2, 3, 4]) {
      expect(AskQuestionEnvelopeSchema.safeParse(withQuestion({ options: options(n) })).success).toBe(true);
    }
    expect(firstIssue(AskQuestionEnvelopeSchema, withQuestion({ options: options(1) })))
      .toMatchObject({ code: 'too_small', path: ['questions', 0, 'options'] });
    expect(firstIssue(AskQuestionEnvelopeSchema, withQuestion({ options: options(5) })))
      .toMatchObject({ code: 'too_big', path: ['questions', 0, 'options'] });
  });

  it('holds every length limit at its edge', () => {
    const at = (n: number) => 'x'.repeat(n);
    const L = ASK_QUESTION_LIMITS;
    const cases: Array<[string, (s: string) => unknown, number, PropertyKey[]]> = [
      ['preface', (s) => ({ ...ENVELOPE, preface: s }), L.prefaceMaxLength, ['preface']],
      ['header', (s) => withQuestion({ header: s }), L.headerMaxLength, ['questions', 0, 'header']],
      ['question', (s) => withQuestion({ question: s }), L.questionMaxLength, ['questions', 0, 'question']],
      ['label', (s) => withQuestion({ options: [{ label: s }, { label: 'B' }] }), L.labelMaxLength,
        ['questions', 0, 'options', 0, 'label']],
      ['description', (s) => withQuestion({ options: [{ label: 'A', description: s }, { label: 'B' }] }),
        L.descriptionMaxLength, ['questions', 0, 'options', 0, 'description']],
    ];
    for (const [name, build, max, path] of cases) {
      expect(AskQuestionEnvelopeSchema.safeParse(build(at(max))).success, `${name} at ${max}`).toBe(true);
      expect(firstIssue(AskQuestionEnvelopeSchema, build(at(max + 1))), `${name} at ${max + 1}`)
        .toMatchObject({ code: 'too_big', path });
    }
    expect(L).toMatchObject({
      prefaceMaxLength: 80, headerMaxLength: 16, questionMaxLength: 120, labelMaxLength: 24, descriptionMaxLength: 60,
    });
  });

  it('refuses a blank label or question', () => {
    expect(firstIssue(AskQuestionEnvelopeSchema, withQuestion({ question: '   ' })))
      .toMatchObject({ code: 'invalid_format', path: ['questions', 0, 'question'] });
    expect(firstIssue(AskQuestionEnvelopeSchema, withQuestion({ options: [{ label: '' }, { label: 'B' }] })))
      .toMatchObject({ code: 'too_small', path: ['questions', 0, 'options', 0, 'label'] });
  });

  it('refuses duplicate labels within a question, but not across questions', () => {
    expect(firstIssue(AskQuestionEnvelopeSchema, withQuestion({ options: [{ label: 'Same' }, { label: 'Same ' }] })))
      .toMatchObject({ code: 'custom', path: ['questions', 0, 'options', 1, 'label'] });
    const q = { question: 'Q?', options: [{ label: 'Yes' }, { label: 'No' }] };
    expect(AskQuestionEnvelopeSchema.safeParse({ ...ENVELOPE, questions: [q, q] }).success).toBe(true);
  });

  it('admits one recommended option and refuses two', () => {
    const two = [{ label: 'A', recommended: true }, { label: 'B', recommended: true }];
    expect(firstIssue(AskQuestionEnvelopeSchema, withQuestion({ options: two })))
      .toMatchObject({ code: 'custom', path: ['questions', 0, 'options'] });
    const oneAndFalse = [{ label: 'A', recommended: true }, { label: 'B', recommended: false }];
    expect(AskQuestionEnvelopeSchema.safeParse(withQuestion({ options: oneAndFalse })).success).toBe(true);
  });
});

describe('parseAskQuestionEnvelope', () => {
  it('answers a valid envelope as parsed', () => {
    expect(parseAskQuestionEnvelope(ENVELOPE)).toEqual(ENVELOPE);
  });

  it('answers null for an envelope that breaks the contract', () => {
    expect(parseAskQuestionEnvelope(withQuestion({ options: options(5) }))).toBeNull();
    expect(parseAskQuestionEnvelope(withQuestion({ options: [{ label: 'A' }, { label: 'A' }] }))).toBeNull();
    expect(parseAskQuestionEnvelope({ ...ENVELOPE, questions: [ENVELOPE.questions[0], ENVELOPE.questions[0], ENVELOPE.questions[0]] }))
      .toBeNull();
    expect(parseAskQuestionEnvelope({ ...ENVELOPE, extra: 1 })).toBeNull();
  });

  it('answers null for garbage', () => {
    for (const value of [null, undefined, 'asked', 42, true, [], [ENVELOPE], {}, { status: 'pending_approval' },
      { type: 'text', value: JSON.stringify(ENVELOPE) }]) {
      expect(parseAskQuestionEnvelope(value), JSON.stringify(value) ?? String(value)).toBeNull();
    }
  });

  describe('the legacy ask_which result', () => {
    const LEGACY = {
      success: true,
      status: ASK_WHICH_LEGACY_STATUS,
      question: 'Which revenue did you mean?',
      readings: ['Booked revenue', 'Invoiced revenue', 'Collected revenue'],
      reply: 'Which revenue did you mean?\n- Booked revenue\n- Invoiced revenue\n- Collected revenue',
    };

    it('reads as one question whose options are the readings, with no description', () => {
      expect(parseAskQuestionEnvelope(LEGACY)).toEqual({
        success: true,
        status: ASK_QUESTION_STATUS,
        reply: LEGACY.reply,
        questions: [{
          question: LEGACY.question,
          options: [{ label: 'Booked revenue' }, { label: 'Invoiced revenue' }, { label: 'Collected revenue' }],
        }],
      });
    });

    it('ignores keys it does not convert', () => {
      expect(parseAskQuestionEnvelope({ ...LEGACY, toolCallId: 'call_1' })).not.toBeNull();
    });

    it('answers null when the result cannot be a card under the same limits', () => {
      expect(parseAskQuestionEnvelope({ ...LEGACY, readings: ['Only one'] })).toBeNull();
      expect(parseAskQuestionEnvelope({ ...LEGACY, readings: ['A', 'B', 'C', 'D', 'E'] })).toBeNull();
      expect(parseAskQuestionEnvelope({ ...LEGACY, readings: ['A', 'A'] })).toBeNull();
      expect(parseAskQuestionEnvelope({ ...LEGACY, readings: ['A', ' A '] })).toBeNull();
      expect(parseAskQuestionEnvelope({ ...LEGACY, readings: ['A', '   '] })).toBeNull();
      expect(parseAskQuestionEnvelope({
        ...LEGACY,
        readings: ['x'.repeat(ASK_QUESTION_LIMITS.legacyReadingMaxLength + 1), 'B'],
      })).toBeNull();
      expect(parseAskQuestionEnvelope({ ...LEGACY, question: 'q'.repeat(ASK_QUESTION_LIMITS.questionMaxLength + 1) }))
        .toBeNull();
      expect(parseAskQuestionEnvelope({ ...LEGACY, reply: '' })).toBeNull();
    });

    it('holds a reading to its own limit, longer than the label limit', () => {
      // Real ask_which readings run past the envelope's 24-character label
      // (most of them do), so a reading gets the description's length.
      expect(ASK_QUESTION_LIMITS.legacyReadingMaxLength).toBeGreaterThan(ASK_QUESTION_LIMITS.labelMaxLength);
      const atEdge = 'r'.repeat(ASK_QUESTION_LIMITS.legacyReadingMaxLength);
      const overLabel = 'Revenue booked when the deal closed';
      expect(overLabel.length).toBeGreaterThan(ASK_QUESTION_LIMITS.labelMaxLength);
      const parsed = parseAskQuestionEnvelope({ ...LEGACY, readings: [atEdge, overLabel] });
      expect(parsed?.questions[0]?.options).toEqual([{ label: atEdge }, { label: overLabel }]);
    });

    it('keeps the new envelope at the label limit', () => {
      const long = 'x'.repeat(ASK_QUESTION_LIMITS.labelMaxLength + 1);
      expect(parseAskQuestionEnvelope(withQuestion({ options: [{ label: long }, { label: 'B' }] }))).toBeNull();
    });

    it('answers null for a malformed legacy result', () => {
      expect(parseAskQuestionEnvelope({ ...LEGACY, success: false })).toBeNull();
      expect(parseAskQuestionEnvelope({ ...LEGACY, readings: 'Booked revenue' })).toBeNull();
      expect(parseAskQuestionEnvelope({ ...LEGACY, readings: [1, 2] })).toBeNull();
      const { reply: _reply, ...noReply } = LEGACY;
      expect(parseAskQuestionEnvelope(noReply)).toBeNull();
      const { question: _question, ...noQuestion } = LEGACY;
      expect(parseAskQuestionEnvelope(noQuestion)).toBeNull();
    });
  });
});
