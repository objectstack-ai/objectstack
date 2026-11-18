// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { dependentRequired, requiredOneOf } from '../shared/refinement-projection';
import { ObjectQuerySourceSchema } from '../ai/object-query-source.zod';
import { ApiErrorSchema } from './contract.zod';
import { StandardErrorCode } from './errors.zod';

/**
 * The AI answer follow-up routes: saved questions, an answer turned into an
 * artifact, and an answer's rating.
 *
 * | Method | Path | Request | `data` on success |
 * |:--|:--|:--|:--|
 * | GET    | `/api/v1/ai/saved-questions` | none | {@link ListAiSavedQuestionsResponseSchema} |
 * | POST   | `/api/v1/ai/saved-questions` | {@link CreateAiSavedQuestionRequestSchema} | {@link CreateAiSavedQuestionResponseSchema} (201) |
 * | DELETE | `/api/v1/ai/saved-questions/:id` | none | no body (204) |
 * | POST   | `/api/v1/ai/saved-questions/:id/run` | none | {@link RunAiSavedQuestionResponseSchema} |
 * | POST   | `/api/v1/ai/conversations/:id/turns/:turnId/artifact` | {@link CreateAiAnswerArtifactRequestSchema} | {@link CreateAiAnswerArtifactResponseSchema} (201) |
 * | GET    | `/api/v1/ai/conversations/:id/turns/:turnId/feedback` | none | {@link GetAiAnswerFeedbackResponseSchema} |
 * | POST   | `/api/v1/ai/conversations/:id/turns/:turnId/feedback` | {@link SetAiAnswerFeedbackRequestSchema} | {@link SetAiAnswerFeedbackResponseSchema} |
 * | DELETE | `/api/v1/ai/conversations/:id/turns/:turnId/feedback` | none | no body (204), also when no rating was there |
 *
 * Like the other `/api/v1/ai/**` shapes in `protocol.zod.ts`, these describe
 * the wire, not a protocol this repo serves: the producer is the cloud AI
 * service (`service-ai`: `routes/saved-question-routes.ts`,
 * `routes/feedback-routes.ts`, `saved/saved-question-store.ts`,
 * `saved/source-artifact.ts`, `feedback/answer-feedback-store.ts`). Every
 * success body is the platform envelope `{ success: true, data }` and each
 * response schema here is the `data` payload. A failure body is
 * `{ success: false, error }` with `error` one of the three route errors below,
 * whose `code` lists hold both the route handler's codes and the framework
 * door's. The door answers ahead of the handler, with no `details`: 401
 * UNAUTHENTICATED for a caller with no session (`packages/runtime`
 * `domains/ai.ts`; a route mounted on the HTTP server answers the flat
 * `{ error, code, message }` body instead, `dispatcher-plugin.ts`, ADR-0112),
 * 501 NOT_IMPLEMENTED when the deployment serves no AI, and 503
 * SERVICE_UNAVAILABLE before the AI routes are published.
 *
 * Every route is the signed-in caller's own: a saved question that is not the
 * caller's answers 404, and a conversation that is not the caller's answers 403
 * when a question is saved from one of its answers, and on the artifact and
 * feedback routes.
 */

// ── Saved questions ───────────────────────────────────────────────────────

/** One saved question, as the saved-question routes answer it. */
export const AiSavedQuestionSchema = lazySchema(() => z.object({
  id: z.string().describe('Saved question id'),
  question: z.string().describe('The question text'),
  source: ObjectQuerySourceSchema.nullable().describe(
    'The query the answer ran, read off the caller\'s stored turn when the question was saved from an answer; '
    + 'null for a typed question, or when the answer ran no query',
  ),
  agentId: z.string().nullable().describe('The agent of the conversation it was saved from; null for a typed question'),
  conversationId: z.string().nullable().describe('The conversation it was saved from; null for a typed question'),
  turnId: z.string().nullable().describe('The turn it was saved from; null for a typed question'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
}));

/** `GET /api/v1/ai/saved-questions`. */
export const ListAiSavedQuestionsResponseSchema = lazySchema(() => z.object({
  questions: z.array(AiSavedQuestionSchema).describe(
    'The caller\'s saved questions in the session\'s organization, newest first, at most 200',
  ),
}));

/**
 * `POST /api/v1/ai/saved-questions` — a typed question (`question`), or one of
 * the caller's answers (`conversationId` with `turnId`). Saved from an answer,
 * the query comes off the stored turn; a `source` in the body is not read.
 */
export const CreateAiSavedQuestionRequestSchema = lazySchema(() => z.object({
  question: z.string().optional().describe(
    'The question text. Required without `conversationId`; from an answer it replaces the turn\'s own question. '
    + 'A question longer than 2000 characters is refused (413 VALUE_TOO_LONG)',
  ),
  conversationId: z.string().optional().describe('The caller\'s conversation the answer is in; sent with `turnId`'),
  turnId: z.string().optional().describe('The turn of that conversation; sent with `conversationId`'),
  toolCallId: z.string().optional().describe(
    'The tool call of the turn whose query is saved; the turn\'s last query when omitted',
  ),
})
  .refine(dependentRequired({ conversationId: ['turnId'], turnId: ['conversationId'] }), {
    message: 'conversationId and turnId are sent together',
  })
  .refine(requiredOneOf(['question', 'conversationId']), {
    message: 'a question, or a conversationId and turnId, is required',
  }));

/** `POST /api/v1/ai/saved-questions` — 201. */
export const CreateAiSavedQuestionResponseSchema = lazySchema(() => z.object({
  question: AiSavedQuestionSchema.describe('The saved question'),
}));

/**
 * `POST /api/v1/ai/saved-questions/:id/run` — the stored query run again as the
 * caller, under their current permissions. Nothing is stored. No request body.
 */
export const RunAiSavedQuestionResponseSchema = lazySchema(() => z.object({
  question: z.string().describe('The saved question text'),
  toolName: z.enum(['aggregate_data', 'query_records']).describe(
    'The data tool that ran the query: aggregate_data for an aggregate, query_records for a record read',
  ),
  result: z.unknown().describe('The data tool\'s result, parsed from its JSON text'),
}));

/**
 * The `error.code` vocabulary of the saved-question routes: the handler's codes
 * and the framework door's (UNAUTHENTICATED, NOT_IMPLEMENTED, SERVICE_UNAVAILABLE).
 */
export const AiSavedQuestionErrorCodeSchema = lazySchema(() => StandardErrorCode.extract([
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'MISSING_REQUIRED_FIELD',
  'VALIDATION_ERROR',
  'VALUE_TOO_LONG',
  'RESOURCE_NOT_FOUND',
  'RESOURCE_CONFLICT',
  'INTERNAL_ERROR',
  'NOT_IMPLEMENTED',
  'SERVICE_UNAVAILABLE',
]));

/**
 * `error.details.reason` on a saved-question run refusal:
 * `saved_question_has_no_query` (409 RESOURCE_CONFLICT, the question was saved
 * without a query; `details.question` carries its text) or
 * `saved_question_run_failed` (422 VALIDATION_ERROR, the data tool refused).
 */
export const AiSavedQuestionRefusalReasonSchema = lazySchema(() => z.enum([
  'saved_question_has_no_query',
  'saved_question_run_failed',
]));

/** The `error` of a saved-question route failure. */
export const AiSavedQuestionErrorSchema = lazySchema(() => ApiErrorSchema.extend({
  code: AiSavedQuestionErrorCodeSchema.describe('Error code'),
  details: z.object({
    reason: AiSavedQuestionRefusalReasonSchema.describe('The named refusal'),
    question: z.string().optional().describe('The saved question text, on saved_question_has_no_query'),
  }).optional().describe('Present on a run refusal'),
}));

// ── Answer → artifact ─────────────────────────────────────────────────────

/** What an answer can be turned into. */
export const AiAnswerArtifactKindSchema = lazySchema(() => z.enum(['view', 'report', 'widget']));

/**
 * `POST /api/v1/ai/conversations/:id/turns/:turnId/artifact`. The artifact is
 * built from the `source` block of the caller's stored turn, never from the
 * request body.
 */
export const CreateAiAnswerArtifactRequestSchema = lazySchema(() => z.object({
  kind: AiAnswerArtifactKindSchema.describe(
    'view: the caller\'s own list view; report: a dataset and a report draft; widget: a dataset and a new '
    + 'one-widget dashboard draft. report and widget need the manage_metadata capability',
  ),
  toolCallId: z.string().optional().describe('The tool call of the turn to build from; the turn\'s last query when omitted'),
  label: z.string().optional().describe(
    'The artifact label; the turn\'s question when omitted. Cut to 120 characters',
  ),
}));

/** One metadata draft the artifact route staged. */
export const AiAnswerArtifactDraftSchema = lazySchema(() => z.object({
  type: z.enum(['dataset', 'report', 'dashboard']).describe('Metadata type of the draft'),
  name: z.string().describe('Metadata item name of the draft'),
}));

/** A metadata item body as the artifact route answers it. */
const ArtifactItemSchema = () => z.record(z.string(), z.unknown());

/** `kind: 'view'` — the caller's own `sys_personal_view` row. */
const AnswerViewArtifactSchema = () => z.object({
  kind: z.literal('view').describe('The artifact kind'),
  view: z.object({
    id: z.string().optional().describe('The personal view row id, when the engine answered one'),
    object_name: z.string().describe('The object the view lists'),
    label: z.string().describe('The view label'),
    config: z.record(z.string(), z.unknown()).describe('The list view configuration, a ListView'),
  }).describe('The saved personal view'),
});

/** `kind: 'report'` — a dataset draft and a report draft, nothing published. */
const AnswerReportArtifactSchema = () => z.object({
  kind: z.literal('report').describe('The artifact kind'),
  published: z.literal(false).describe('Always false: the drafts are not published'),
  drafts: z.array(AiAnswerArtifactDraftSchema).describe('The drafts staged: the dataset, then the report'),
  dataset: ArtifactItemSchema().describe('The dataset draft body'),
  report: ArtifactItemSchema().describe('The report draft body'),
});

/** `kind: 'widget'` — a dataset draft and a new one-widget dashboard draft, nothing published. */
const AnswerWidgetArtifactSchema = () => z.object({
  kind: z.literal('widget').describe('The artifact kind'),
  published: z.literal(false).describe('Always false: the drafts are not published'),
  drafts: z.array(AiAnswerArtifactDraftSchema).describe('The drafts staged: the dataset, then the dashboard'),
  dataset: ArtifactItemSchema().describe('The dataset draft body'),
  dashboard: ArtifactItemSchema().describe('The dashboard draft body'),
});

/** `POST /api/v1/ai/conversations/:id/turns/:turnId/artifact` — 201, discriminated by `kind`. */
export const CreateAiAnswerArtifactResponseSchema = lazySchema(() => z.discriminatedUnion('kind', [
  AnswerViewArtifactSchema(),
  AnswerReportArtifactSchema(),
  AnswerWidgetArtifactSchema(),
]));

/**
 * The `error.code` vocabulary of the artifact route: the handler's codes and the
 * framework door's (UNAUTHENTICATED, NOT_IMPLEMENTED, SERVICE_UNAVAILABLE).
 */
export const AiAnswerArtifactErrorCodeSchema = lazySchema(() => StandardErrorCode.extract([
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'MISSING_REQUIRED_FIELD',
  'VALIDATION_ERROR',
  'RESOURCE_NOT_FOUND',
  'NOT_IMPLEMENTED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]));

/**
 * `error.details.reason` on an artifact refusal. 403 PERMISSION_DENIED:
 * `report_authoring_requires_manage_metadata` (a report or widget without the
 * manage_metadata capability) and `report_authoring_walled` (under the isolated
 * or group tenancy posture). 422 VALIDATION_ERROR: `answer_has_no_query`, and
 * the reasons the answer's query cannot be carried into the artifact kind.
 */
export const AiAnswerArtifactRefusalReasonSchema = lazySchema(() => z.enum([
  'report_authoring_requires_manage_metadata',
  'report_authoring_walled',
  'answer_has_no_query',
  'not_an_aggregate',
  'not_a_record_list',
  'filter_not_expressible',
  'sort_not_expressible',
  'limit_not_expressible',
  'latest_per_not_expressible',
  'member_not_expressible',
  'spec_refused',
]));

/** The `error` of an artifact route failure. */
export const AiAnswerArtifactErrorSchema = lazySchema(() => ApiErrorSchema.extend({
  code: AiAnswerArtifactErrorCodeSchema.describe('Error code'),
  details: z.object({
    reason: AiAnswerArtifactRefusalReasonSchema.describe('The named refusal'),
    issues: z.unknown().optional().describe('The schema issues, on spec_refused'),
  }).optional().describe('Present on a named refusal'),
}));

// ── Answer feedback ───────────────────────────────────────────────────────

/** An answer's rating. */
export const AiAnswerRatingSchema = lazySchema(() => z.enum(['up', 'down']));

/** The caller's rating of one answer. */
export const AiAnswerFeedbackSchema = lazySchema(() => z.object({
  conversationId: z.string().describe('The conversation of the rated answer'),
  turnId: z.string().describe('The turn of the rated answer'),
  rating: AiAnswerRatingSchema.describe('The rating'),
  note: z.string().nullable().describe('The caller\'s note; null when none'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
  updatedAt: z.string().nullable().describe('Last change timestamp (ISO 8601); null when never set'),
}));

/** `GET /api/v1/ai/conversations/:id/turns/:turnId/feedback`. */
export const GetAiAnswerFeedbackResponseSchema = lazySchema(() => z.object({
  feedback: AiAnswerFeedbackSchema.nullable().describe('The caller\'s rating of the answer; null when unrated'),
}));

/** `POST /api/v1/ai/conversations/:id/turns/:turnId/feedback` — rate, or change the rating. */
export const SetAiAnswerFeedbackRequestSchema = lazySchema(() => z.object({
  rating: AiAnswerRatingSchema.describe('The rating'),
  note: z.string().nullable().optional().describe(
    'A note on the answer. Trimmed; blank or null stores none. A note longer than 500 characters is refused '
    + '(413 VALUE_TOO_LONG)',
  ),
}));

/** `POST /api/v1/ai/conversations/:id/turns/:turnId/feedback`. */
export const SetAiAnswerFeedbackResponseSchema = lazySchema(() => z.object({
  feedback: AiAnswerFeedbackSchema.describe('The stored rating'),
}));

/**
 * The `error.code` vocabulary of the feedback routes: the handler's codes and the
 * framework door's (UNAUTHENTICATED, NOT_IMPLEMENTED, SERVICE_UNAVAILABLE).
 */
export const AiAnswerFeedbackErrorCodeSchema = lazySchema(() => StandardErrorCode.extract([
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'MISSING_REQUIRED_FIELD',
  'VALIDATION_ERROR',
  'VALUE_TOO_LONG',
  'RESOURCE_NOT_FOUND',
  'INTERNAL_ERROR',
  'NOT_IMPLEMENTED',
  'SERVICE_UNAVAILABLE',
]));

/** The `error` of a feedback route failure. */
export const AiAnswerFeedbackErrorSchema = lazySchema(() => ApiErrorSchema.extend({
  code: AiAnswerFeedbackErrorCodeSchema.describe('Error code'),
}));

// ── Types ─────────────────────────────────────────────────────────────────

export type AiSavedQuestion = z.input<typeof AiSavedQuestionSchema>;
export type ListAiSavedQuestionsResponse = z.input<typeof ListAiSavedQuestionsResponseSchema>;
export type CreateAiSavedQuestionRequest = z.input<typeof CreateAiSavedQuestionRequestSchema>;
export type CreateAiSavedQuestionResponse = z.input<typeof CreateAiSavedQuestionResponseSchema>;
export type RunAiSavedQuestionResponse = z.input<typeof RunAiSavedQuestionResponseSchema>;
export type AiSavedQuestionErrorCode = z.input<typeof AiSavedQuestionErrorCodeSchema>;
export type AiSavedQuestionRefusalReason = z.input<typeof AiSavedQuestionRefusalReasonSchema>;
export type AiSavedQuestionError = z.input<typeof AiSavedQuestionErrorSchema>;
export type AiAnswerArtifactKind = z.input<typeof AiAnswerArtifactKindSchema>;
export type CreateAiAnswerArtifactRequest = z.input<typeof CreateAiAnswerArtifactRequestSchema>;
export type AiAnswerArtifactDraft = z.input<typeof AiAnswerArtifactDraftSchema>;
export type CreateAiAnswerArtifactResponse = z.input<typeof CreateAiAnswerArtifactResponseSchema>;
export type AiAnswerArtifactErrorCode = z.input<typeof AiAnswerArtifactErrorCodeSchema>;
export type AiAnswerArtifactRefusalReason = z.input<typeof AiAnswerArtifactRefusalReasonSchema>;
export type AiAnswerArtifactError = z.input<typeof AiAnswerArtifactErrorSchema>;
export type AiAnswerRating = z.input<typeof AiAnswerRatingSchema>;
export type AiAnswerFeedback = z.input<typeof AiAnswerFeedbackSchema>;
export type GetAiAnswerFeedbackResponse = z.input<typeof GetAiAnswerFeedbackResponseSchema>;
export type SetAiAnswerFeedbackRequest = z.input<typeof SetAiAnswerFeedbackRequestSchema>;
export type SetAiAnswerFeedbackResponse = z.input<typeof SetAiAnswerFeedbackResponseSchema>;
export type AiAnswerFeedbackErrorCode = z.input<typeof AiAnswerFeedbackErrorCodeSchema>;
export type AiAnswerFeedbackError = z.input<typeof AiAnswerFeedbackErrorSchema>;
