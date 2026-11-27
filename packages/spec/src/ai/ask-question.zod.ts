// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * The ask-question envelope — the structured result a question tool returns
 * when the AI ends its turn on a clarifying question, and the one shape the
 * console reads to draw a clickable question card in the composer's place
 * (question-card topic #37871, decisions D1 and D2).
 *
 * ## Who writes it, who reads it
 *
 * - **Producer:** the question tool in the AI service. It ends the turn the way
 *   `ask_which` does (`ctx.requestTurnEnd(reply)`); `reply` is the plain-text
 *   question it ended the turn with, which is what model history, the
 *   conversation list and evals read. The tool result carries this envelope
 *   beside it.
 * - **Reader:** the console's chat. It peels the stream's
 *   `{ type: 'text', value }` wrapper itself (`parseResultEnvelope` in
 *   `@object-ui/plugin-chatbot`), then hands the object to
 *   {@link parseAskQuestionEnvelope}. A `null` answer means "no card": the
 *   message renders as the text it already is.
 *
 * The answer to a question is an ordinary next user message. Nothing here is
 * stored as turn state and no endpoint takes an answer (D1).
 *
 * ## What is not in the envelope
 *
 * - "Type something else" is not an option: the console always offers it.
 * - No multi-select in v1: options are mutually exclusive.
 *
 * ## The legacy `asked_which` result
 *
 * Until the question tool emits this envelope, the one producer in the field
 * is `ask_which`'s existing result,
 * `{ success: true, status: 'asked_which', question, readings, reply }`.
 * {@link parseAskQuestionEnvelope} reads it as one question whose options are
 * the readings, with no description, under the envelope's limits with one
 * exception: a reading is a whole sentence-sized phrase, not a short label, so
 * it is held to its own limit, `ASK_QUESTION_LIMITS.legacyReadingMaxLength`,
 * and the card wraps it. Every other limit is the envelope's, so a legacy
 * result the card cannot draw (a reading over its limit, one reading or more
 * than four, a duplicate) answers `null` and stays text, as it renders today.
 * Stored conversations keep their old results, so this reading stays as long
 * as those rows can be shown.
 */

/** The status a question tool's result carries when the turn ended on a question. */
export const ASK_QUESTION_STATUS = 'asked';

/** The status of the legacy `ask_which` result {@link parseAskQuestionEnvelope} still reads. */
export const ASK_WHICH_LEGACY_STATUS = 'asked_which';

/**
 * The limits of an ask-question envelope, in UTF-16 code units for lengths.
 * Sized so a card fits the composer's place on a narrow drawer: the producer
 * holds its output to them, and the card component lays out against them.
 */
export const ASK_QUESTION_LIMITS = {
  /** Questions in one envelope. Two questions stop on "send"; one sends on click. */
  minQuestions: 1,
  maxQuestions: 2,
  /** Options per question. */
  minOptions: 2,
  maxOptions: 4,
  /** One lead-in sentence above the questions. */
  prefaceMaxLength: 80,
  /** The short name a two-question answer is composed with (`header: answer`). */
  headerMaxLength: 16,
  questionMaxLength: 120,
  labelMaxLength: 24,
  descriptionMaxLength: 60,
  /**
   * A legacy `ask_which` reading, which becomes an option label with no
   * description. Readings were never held to the label limit, so they get
   * the description's length instead; the new envelope's labels stay at
   * `labelMaxLength`.
   */
  legacyReadingMaxLength: 60,
} as const;

/** A non-empty string with at least one non-space character, at most `max` long. */
function text(max: number) {
  return z.string().min(1).max(max).regex(/\S/, { message: 'Must not be blank' });
}

/** One option of a question: a label, an optional second line, an optional "recommended" tag. */
export const AskQuestionOptionSchema = lazySchema(() => strictObject(
  {
    surface: 'an ask-question option',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
    aliases: {
      text: 'label',
      value: 'label',
      title: 'label',
      hint: 'description',
      detail: 'description',
      default: 'recommended',
      preferred: 'recommended',
    },
  },
  {
    label: text(ASK_QUESTION_LIMITS.labelMaxLength).describe(
      'What the option says, and the answer text sent when it is picked. Unique within its question',
    ),
    description: text(ASK_QUESTION_LIMITS.descriptionMaxLength).optional().describe(
      'One line under the label saying what picking it means',
    ),
    recommended: z.boolean().optional().describe('Marks the option the AI recommends. At most one per question'),
  },
));

/** One question: an optional header, the question, and two to four mutually exclusive options. */
export const AskQuestionSchema = lazySchema(() => strictObject(
  {
    surface: 'an ask-question question',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
    aliases: {
      title: 'header',
      prompt: 'question',
      text: 'question',
      choices: 'options',
      readings: 'options',
    },
  },
  {
    header: text(ASK_QUESTION_LIMITS.headerMaxLength).optional().describe(
      'A short name for the question, used to compose a two-question answer',
    ),
    question: text(ASK_QUESTION_LIMITS.questionMaxLength).describe('The question'),
    options: z.array(AskQuestionOptionSchema)
      .min(ASK_QUESTION_LIMITS.minOptions)
      .max(ASK_QUESTION_LIMITS.maxOptions)
      .describe('Two to four mutually exclusive options; labels unique, at most one recommended'),
  },
).superRefine(refineOptions));

/**
 * The rules over a question's options that one option alone cannot hold:
 * labels unique (compared trimmed, since a label is the answer text) and at
 * most one option recommended. Shared by the envelope's question and the
 * legacy reading's, so both refuse the same way.
 */
function refineOptions(
  question: { options: ReadonlyArray<{ label: string; recommended?: boolean }> },
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  question.options.forEach((option, index) => {
    const label = option.label.trim();
    if (seen.has(label)) {
      ctx.addIssue({
        code: 'custom',
        path: ['options', index, 'label'],
        message: `Duplicate option label "${label}": labels are the answer text, so each must be unique within its question`,
      });
    }
    seen.add(label);
  });
  const recommended = question.options.filter((option) => option.recommended === true).length;
  if (recommended > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['options'],
      message: `${recommended} options are marked recommended: at most one per question`,
    });
  }
}

/** The ask-question envelope a question tool's result carries. */
export const AskQuestionEnvelopeSchema = lazySchema(() => strictObject(
  {
    surface: 'an ask-question envelope',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
    aliases: {
      intro: 'preface',
      lead: 'preface',
      message: 'reply',
      text: 'reply',
      question: 'questions',
    },
  },
  {
    success: z.literal(true).describe('Always true: a question is a successful tool result'),
    status: z.literal(ASK_QUESTION_STATUS).describe('`asked`: the turn ended on this question'),
    reply: z.string().min(1).describe(
      'The plain text the turn ended with. The console draws the card only when this equals the last assistant text',
    ),
    preface: text(ASK_QUESTION_LIMITS.prefaceMaxLength).optional().describe(
      'One lead-in sentence above the questions',
    ),
    questions: z.array(AskQuestionSchema)
      .min(ASK_QUESTION_LIMITS.minQuestions)
      .max(ASK_QUESTION_LIMITS.maxQuestions)
      .describe('One or two questions'),
  },
));

/**
 * The legacy `ask_which` result, read only to be converted. Open on purpose:
 * it is a shape an existing producer already writes and stored conversations
 * already hold, which this package never declared, so the reader takes the
 * keys it converts and ignores the rest rather than turning a stored result it
 * never owned into text. Not exported: nothing new is written in this shape.
 */
const AskWhichLegacyResultSchema = z.looseObject({
  success: z.literal(true),
  status: z.literal(ASK_WHICH_LEGACY_STATUS),
  question: z.string(),
  readings: z.array(z.string()),
  reply: z.string(),
});

/**
 * The one question a legacy `ask_which` result converts to: the envelope's
 * question rules, with each reading held to `legacyReadingMaxLength` instead
 * of the label limit. Not exported, for the same reason as the result above.
 */
const AskWhichLegacyQuestionSchema = z.object({
  question: text(ASK_QUESTION_LIMITS.questionMaxLength),
  options: z.array(z.object({ label: text(ASK_QUESTION_LIMITS.legacyReadingMaxLength) }))
    .min(ASK_QUESTION_LIMITS.minOptions)
    .max(ASK_QUESTION_LIMITS.maxOptions),
}).superRefine(refineOptions);

/**
 * Read a tool result as an ask-question envelope.
 *
 * Takes the already-unwrapped result object (peeling the stream's
 * `{ type: 'text', value }` wrapper stays with the caller). Answers the parsed
 * envelope for a valid {@link AskQuestionEnvelopeSchema} value or a legacy
 * `ask_which` result that converts to one (its option labels then run to
 * `ASK_QUESTION_LIMITS.legacyReadingMaxLength`), and `null` for anything
 * else — the caller then shows the result as the text it already is.
 */
export function parseAskQuestionEnvelope(value: unknown): AskQuestionEnvelopeParsed | null {
  if (value === null || typeof value !== 'object') return null;
  const status = (value as { status?: unknown }).status;
  if (status === ASK_QUESTION_STATUS) {
    const parsed = AskQuestionEnvelopeSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  if (status === ASK_WHICH_LEGACY_STATUS) {
    const legacy = AskWhichLegacyResultSchema.safeParse(value);
    if (!legacy.success || legacy.data.reply.length === 0) return null;
    const question = AskWhichLegacyQuestionSchema.safeParse({
      question: legacy.data.question,
      options: legacy.data.readings.map((label) => ({ label })),
    });
    if (!question.success) return null;
    return {
      success: true,
      status: ASK_QUESTION_STATUS,
      reply: legacy.data.reply,
      questions: [question.data],
    };
  }
  return null;
}

export type AskQuestionOption = z.input<typeof AskQuestionOptionSchema>;
export type AskQuestionOptionParsed = z.infer<typeof AskQuestionOptionSchema>;
export type AskQuestion = z.input<typeof AskQuestionSchema>;
export type AskQuestionParsed = z.infer<typeof AskQuestionSchema>;
export type AskQuestionEnvelope = z.input<typeof AskQuestionEnvelopeSchema>;
export type AskQuestionEnvelopeParsed = z.infer<typeof AskQuestionEnvelopeSchema>;
