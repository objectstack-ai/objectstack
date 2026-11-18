// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The AI answer follow-up routes, held to the bodies their producer answers.
 *
 * The producer is cloud's `service-ai`, read at cloud commit `c21b372`; each
 * fixture below names the file and line its shape was read from. Each route
 * is pinned twice: a body built from the producer's shape parses, and the same
 * body without a required member is refused. The error pins build the body the
 * producer's `sendError` writes (`routes/envelope.ts:198-210`:
 * `{ code, message, httpStatus, ...extra }`).
 *
 * Imported through the `./api` entry barrel, so a missing export reds here.
 */

import { describe, expect, it } from 'vitest';
import {
  AiAnswerArtifactErrorSchema,
  AiAnswerFeedbackErrorSchema,
  AiConversationSchema,
  AiSavedQuestionErrorSchema,
  CreateAiAnswerArtifactRequestSchema,
  CreateAiAnswerArtifactResponseSchema,
  CreateAiSavedQuestionRequestSchema,
  CreateAiSavedQuestionResponseSchema,
  GetAiAnswerFeedbackResponseSchema,
  ListAiSavedQuestionsResponseSchema,
  RunAiSavedQuestionResponseSchema,
  SetAiAnswerFeedbackRequestSchema,
  SetAiAnswerFeedbackResponseSchema,
} from './index';
import { serviceUnavailableMessage } from '../system';

/** Drop one key from a fixture. */
function without<T extends Record<string, unknown>>(value: T, key: keyof T): Record<string, unknown> {
  const { [key]: _dropped, ...rest } = value;
  return rest;
}

// `saved/source-artifact.ts:122-139` (`parseResultSource`): an aggregate block.
const SOURCE = {
  object: 'opportunity',
  label: 'Opportunities',
  filter: { stage: { $eq: 'won' } },
  scope: 'visible_to_you',
  groupBy: ['region'],
  aggregations: [{ function: 'sum', field: 'amount' }],
  records: 42,
  line: 'Source: Opportunities · stage = won',
};

// `saved/saved-question-store.ts:114-124` (`toSaved`), on the row `create` writes (:248-262).
const SAVED = {
  id: 'sq_6f1c',
  question: 'Won amount by region',
  source: SOURCE,
  agentId: 'ask',
  conversationId: 'conv_1',
  turnId: 'turn_1',
  createdAt: '2026-11-18T10:00:00.000Z',
};

// `feedback/answer-feedback-store.ts:124-133` (`toFeedback`).
const FEEDBACK = {
  conversationId: 'conv_1',
  turnId: 'turn_1',
  rating: 'down',
  note: 'Wrong quarter',
  createdAt: '2026-11-18T10:00:00.000Z',
  updatedAt: '2026-11-18T10:00:00.000Z',
};

describe('saved questions', () => {
  it('GET answers `{ questions }` (saved-question-routes.ts:274); a typed question carries null links', () => {
    const typed = { ...SAVED, source: null, agentId: null, conversationId: null, turnId: null };
    expect(ListAiSavedQuestionsResponseSchema.safeParse({ questions: [SAVED, typed] }).success).toBe(true);
    expect(ListAiSavedQuestionsResponseSchema.safeParse({ questions: [without(SAVED, 'createdAt')] }).success).toBe(false);
    expect(ListAiSavedQuestionsResponseSchema.safeParse({}).success).toBe(false);
  });

  it('POST takes a typed question, or conversationId with turnId (saved-question-routes.ts:290-316)', () => {
    expect(CreateAiSavedQuestionRequestSchema.safeParse({ question: 'Won amount by region' }).success).toBe(true);
    expect(CreateAiSavedQuestionRequestSchema.safeParse({ conversationId: 'conv_1', turnId: 'turn_1', toolCallId: 'call_2' }).success).toBe(true);
    // :297-298 — one of the pair without the other is refused.
    expect(CreateAiSavedQuestionRequestSchema.safeParse({ conversationId: 'conv_1' }).success).toBe(false);
    expect(CreateAiSavedQuestionRequestSchema.safeParse({ question: 'q', turnId: 'turn_1' }).success).toBe(false);
    // :315-316 — no question and no turn.
    expect(CreateAiSavedQuestionRequestSchema.safeParse({}).success).toBe(false);
  });

  it('POST answers `{ question }` (saved-question-routes.ts:330)', () => {
    expect(CreateAiSavedQuestionResponseSchema.safeParse({ question: SAVED }).success).toBe(true);
    expect(CreateAiSavedQuestionResponseSchema.safeParse({ question: without(SAVED, 'id') }).success).toBe(false);
  });

  it('run answers `{ question, toolName, result }` (saved-question-routes.ts:394)', () => {
    const run = { question: 'Won amount by region', toolName: 'aggregate_data', result: { rows: [{ region: 'EMEA', sum_amount: 10 }] } };
    expect(RunAiSavedQuestionResponseSchema.safeParse(run).success).toBe(true);
    expect(RunAiSavedQuestionResponseSchema.safeParse(without(run, 'toolName')).success).toBe(false);
  });

  it('the run refusal names its reason in details (saved-question-routes.ts:369-372, :392)', () => {
    const noQuery = {
      code: 'RESOURCE_CONFLICT',
      message: 'This question was saved without a query. Ask it again in the chat.',
      httpStatus: 409,
      details: { reason: 'saved_question_has_no_query', question: 'Won amount by region' },
    };
    expect(AiSavedQuestionErrorSchema.safeParse(noQuery).success).toBe(true);
    expect(AiSavedQuestionErrorSchema.safeParse({ ...noQuery, details: { reason: 'invented' } }).success).toBe(false);
    // :319 — a code outside the route's vocabulary is refused.
    expect(AiSavedQuestionErrorSchema.safeParse({ code: 'VALUE_TOO_LONG', message: 'too long', httpStatus: 413 }).success).toBe(true);
    expect(AiSavedQuestionErrorSchema.safeParse({ code: 'QUOTA_EXCEEDED', message: 'x', httpStatus: 429 }).success).toBe(false);
  });
});

describe('answer → artifact', () => {
  it('the request names a kind (saved-question-routes.ts:415-419; source-artifact.ts:49)', () => {
    expect(CreateAiAnswerArtifactRequestSchema.safeParse({ kind: 'report', toolCallId: 'call_2', label: 'Won by region' }).success).toBe(true);
    expect(CreateAiAnswerArtifactRequestSchema.safeParse({ toolCallId: 'call_2' }).success).toBe(false);
    expect(CreateAiAnswerArtifactRequestSchema.safeParse({ kind: 'chart' }).success).toBe(false);
  });

  it('kind view answers the personal view row (saved-question-routes.ts:452; source-artifact.ts:539)', () => {
    const view = {
      kind: 'view',
      view: { id: 'pv_1', object_name: 'opportunity', label: 'Open deals', config: { columns: [], sort: [{ field: 'amount', order: 'desc' }] } },
    };
    expect(CreateAiAnswerArtifactResponseSchema.safeParse(view).success).toBe(true);
    expect(CreateAiAnswerArtifactResponseSchema.safeParse({ kind: 'view', view: without(view.view, 'object_name') }).success).toBe(false);
  });

  it('kind report and widget answer the staged drafts (saved-question-routes.ts:474-483)', () => {
    const dataset = { name: 'ask_opportunity_1a2b3c4d', label: 'Won by region', object: 'opportunity', dimensions: [], measures: [] };
    const report = {
      kind: 'report',
      published: false,
      drafts: [{ type: 'dataset', name: dataset.name }, { type: 'report', name: dataset.name }],
      dataset,
      report: { name: dataset.name, label: dataset.label, type: 'summary', dataset: dataset.name },
    };
    expect(CreateAiAnswerArtifactResponseSchema.safeParse(report).success).toBe(true);
    expect(CreateAiAnswerArtifactResponseSchema.safeParse(without(report, 'drafts')).success).toBe(false);
    // :455, :482 — a widget's presentation is a dashboard, under the `dashboard` key.
    const widget = {
      ...without(report, 'report'),
      kind: 'widget',
      drafts: [{ type: 'dataset', name: dataset.name }, { type: 'dashboard', name: dataset.name }],
      dashboard: { name: dataset.name, label: dataset.label, widgets: [] },
    };
    expect(CreateAiAnswerArtifactResponseSchema.safeParse(widget).success).toBe(true);
    expect(CreateAiAnswerArtifactResponseSchema.safeParse(without(widget, 'dashboard')).success).toBe(false);
  });

  it('a refusal names its reason (saved-question-routes.ts:233-238, :84-88)', () => {
    const authoring = {
      code: 'PERMISSION_DENIED',
      message: 'A report or dashboard is shared metadata.',
      httpStatus: 403,
      category: 'authorization',
      details: { reason: 'report_authoring_requires_manage_metadata' },
    };
    expect(AiAnswerArtifactErrorSchema.safeParse(authoring).success).toBe(true);
    const sourceRefused = {
      code: 'VALIDATION_ERROR',
      message: 'This answer lists records and states no figure.',
      httpStatus: 422,
      details: { reason: 'not_an_aggregate' },
    };
    expect(AiAnswerArtifactErrorSchema.safeParse(sourceRefused).success).toBe(true);
    expect(AiAnswerArtifactErrorSchema.safeParse({ ...sourceRefused, details: {} }).success).toBe(false);
  });
});

describe('answer feedback', () => {
  it('GET answers `{ feedback }`, null when unrated (feedback-routes.ts:132)', () => {
    expect(GetAiAnswerFeedbackResponseSchema.safeParse({ feedback: FEEDBACK }).success).toBe(true);
    expect(GetAiAnswerFeedbackResponseSchema.safeParse({ feedback: null }).success).toBe(true);
    expect(GetAiAnswerFeedbackResponseSchema.safeParse({ feedback: without(FEEDBACK, 'rating') }).success).toBe(false);
  });

  it('POST takes a rating and an optional note (feedback-routes.ts:148-164)', () => {
    expect(SetAiAnswerFeedbackRequestSchema.safeParse({ rating: 'down', note: 'Wrong quarter' }).success).toBe(true);
    expect(SetAiAnswerFeedbackRequestSchema.safeParse({ rating: 'up', note: null }).success).toBe(true);
    expect(SetAiAnswerFeedbackRequestSchema.safeParse({ note: 'Wrong quarter' }).success).toBe(false);
    expect(SetAiAnswerFeedbackRequestSchema.safeParse({ rating: 'meh' }).success).toBe(false);
  });

  it('POST answers `{ feedback }` (feedback-routes.ts:170)', () => {
    expect(SetAiAnswerFeedbackResponseSchema.safeParse({ feedback: { ...FEEDBACK, note: null } }).success).toBe(true);
    expect(SetAiAnswerFeedbackResponseSchema.safeParse({ feedback: without(FEEDBACK, 'turnId') }).success).toBe(false);
  });

  it('the owner refusal (feedback-routes.ts:107-110)', () => {
    const notOwner = { code: 'PERMISSION_DENIED', message: 'You can rate only the answers in your own conversations.', httpStatus: 403, category: 'authorization' };
    expect(AiAnswerFeedbackErrorSchema.safeParse(notOwner).success).toBe(true);
    expect(AiAnswerFeedbackErrorSchema.safeParse(without(notOwner, 'code')).success).toBe(false);
  });
});

describe('the framework door\'s refusals parse against each route error', () => {
  // The door answers ahead of the route handler. `packages/runtime/src/domains/ai.ts:63-67`:
  // `deps.error(ANONYMOUS_DENY_MESSAGE, 401, { code: 'UNAUTHENTICATED' })`, written by
  // `error-envelope.ts` `buildApiError` as `{ code, message, httpStatus }` (the `details.code`
  // is promoted, so no `details` remains). `dispatcher-plugin.ts:290-301` answers the same
  // code on a route mounted on the HTTP server. 501 (`domains/unavailable.ts`) and 503
  // (`domains/ai.ts`) carry the status-derived code (`HttpStatusErrorCodeMap`).
  const DOOR = [
    { code: 'UNAUTHENTICATED', message: 'Authentication is required to access this endpoint.', httpStatus: 401 },
    { code: 'NOT_IMPLEMENTED', message: serviceUnavailableMessage('ai'), httpStatus: 501 },
    { code: 'SERVICE_UNAVAILABLE', message: 'AI service routes not yet initialized', httpStatus: 503 },
  ];
  const ROUTE_ERRORS = {
    savedQuestion: AiSavedQuestionErrorSchema,
    artifact: AiAnswerArtifactErrorSchema,
    feedback: AiAnswerFeedbackErrorSchema,
  };

  for (const [route, schema] of Object.entries(ROUTE_ERRORS)) {
    it(`the ${route} error admits the door's 401, 501 and 503`, () => {
      for (const body of DOOR) expect(schema.safeParse(body).success, `${route} ${body.code}`).toBe(true);
    });

    it(`CONTROL: the ${route} code list stays closed`, () => {
      expect(schema.safeParse({ ...DOOR[0], code: 'RATE_LIMIT_EXCEEDED', httpStatus: 429 }).success).toBe(false);
    });
  }
});

describe('a conversation message carries its turnId', () => {
  const conversation = {
    id: 'conv_1',
    messages: [{ role: 'user', content: 'Won amount by region' }, { role: 'assistant', content: 'EMEA leads.' }],
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
  };

  it('CONTROL: a stored conversation with no turnId still parses', () => {
    expect(AiConversationSchema.safeParse(conversation).success).toBe(true);
  });

  it('a message stored with no turn may carry turnId: null (the column is nullable)', () => {
    const unstamped = { ...conversation, messages: conversation.messages.map((m) => ({ ...m, turnId: null })) };
    expect(AiConversationSchema.safeParse(unstamped).success).toBe(true);
  });

  it('a message with turnId keeps it, typed', () => {
    const stamped = {
      ...conversation,
      messages: conversation.messages.map((m) => ({ ...m, turnId: 'turn_1' })),
    };
    const parsed = AiConversationSchema.parse(stamped);
    expect(parsed.messages.map((m) => m.turnId)).toEqual(['turn_1', 'turn_1']);
    expect(AiConversationSchema.safeParse({ ...conversation, messages: [{ role: 'user', content: 'q', turnId: 7 }] }).success).toBe(false);
  });
});
