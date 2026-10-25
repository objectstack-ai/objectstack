/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - AI Component Zod Validators
 *
 * Zod mirrors of the three AI node declarations in `../ai.ts` —
 * `AIFormAssistSchema`, `AIRecommendationsSchema` and `NLQuerySchema` — which
 * `@object-ui/plugin-ai` registers as `ai-form-assist`, `ai-recommendations`
 * and `nl-query`.
 *
 * ## Why this module exists (objectui#10859)
 *
 * The three keys were REGISTERED, DECLARED on the published TypeScript face and
 * TAUGHT by `packages/plugin-ai/README.md` ("Schema-Driven Usage"), while
 * `AnyComponentSchema` carried no arm for them — so `safeValidateSchema` and
 * `objectui validate` refused every document naming them with `invalid_union`
 * at `type`, the README's own example included. The arms below restate the
 * declarations member for member; `AIComponentSchema` is the category union
 * `AnyComponentSchema` lists.
 *
 * ## The `on*` members: a named refusal here, per key on the TypeScript face
 *
 * The five `on*` members were declared `string` on the TypeScript face — the
 * handler-expression string dialect that objectui#6182 (maintainer ruling,
 * option A) withdrew as an authoring form on EITHER face. The zod face follows
 * that ruling and objectui#6124's shape, `handlerKeyRefusal`, with the
 * disposition measured per key on `@object-ui/plugin-ai`:
 *
 *   - `onSelect` / `onDismiss` (`AIRecommendations`) and `onSubmit`
 *     (`NLQueryInput`) are RUNTIME SLOTS — the registration is the raw
 *     component, `SchemaRenderer` spreads the node's keys onto it as props, and
 *     each component CALLS the prop (`onSelect?.(item)`,
 *     `onSubmitProp?.(queryText)`), so an authored string reaches a call site;
 *   - `onApplySuggestion` / `onRejectSuggestion` have NO reader in the package —
 *     `AIFormAssist` takes `onApply` / `onRefresh`, not these — so they are
 *     RETIRED.
 *
 * When objectui#10859 wrote these arms every TypeScript twin still read
 * `string`, the dialect this face refuses. objectui#10874 settled that face per
 * key, by the objectui#6124 rule: the three RUNTIME SLOTS now declare the
 * callable their component invokes (`onSelect` / `onDismiss` take an
 * `AIRecommendationItem`, `onSubmit` the query string) — the objectui#6124
 * shape, a named refusal on this JSON face and a callable twin on the
 * TypeScript one — and the two RETIRED keys are `?: never` there, so both
 * faces refuse those two. Both halves are pinned in
 * `../__tests__/ai-zod-arms-10859.test.ts` and
 * `../__tests__/ai-node-faces-agree-10874.test.ts`.
 *
 * ## `config` / `context`: retired on both faces (objectui#10874)
 *
 * Nothing in `@object-ui/plugin-ai` read either member: the three components
 * are presentation only and call no model. Both are `retirementTombstone`s here
 * and `?: never` on the TypeScript face, and the refusal says what to do
 * instead — configure the model in the host's own AI service (ObjectUI has no
 * AI-provider API) and hand its output to the node.
 *
 * ⛔ No `.default()` anywhere in this module — see the "authors no default"
 * note in `index.zod.ts`.
 *
 * @module zod/ai
 * @packageDocumentation
 */

import { z } from 'zod';
import { BaseSchema } from './base.zod.js';
import { handlerKeyRefusal, retirementTombstone } from './tombstone.zod.js';

/**
 * The objectui#8178 retirement guidance, one string per retired member so the
 * refusal an author reads names the key and the reason (the TypeScript face
 * carries the same members as `?: never` tombstones).
 */
const retiredAiMember = (node: string, key: string, detail: string) =>
  retirementTombstone(
    `RETIRED (objectui#8178, ADR-0049) — \`${key}\` on \`${node}\` had no reader: ${detail} `
    + 'The value was inert, so it is refused by name rather than silently ignored.',
  );

/**
 * The objectui#10874 retirement guidance for `config` / `context`: the refusal
 * names the key and the node, says why, and prescribes what to do instead.
 */
const retiredAiInput = (node: string, key: 'config' | 'context', instead: string) =>
  retirementTombstone(
    `RETIRED (objectui#10874, ADR-0049) — \`${key}\` on \`${node}\` had no reader: the component is `
    + 'presentation only and calls no model, so the value reached nothing and changed nothing on screen. '
    + `Instead: ${instead} Delete the key from the node.`,
  );

/**
 * The objectui#9256 family-D guidance: the renderer reads NEITHER content
 * channel, so both are refused by name on this face as on the TypeScript one.
 */
const neitherChannel = (node: string, renders: string) =>
  'REFUSED (objectui#9256, ADR-0049) — `' + node + '` reads NEITHER content channel: measured with the '
  + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
  + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
  + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
  + `What it renders instead: ${renders}.`;

/**
 * AI Configuration — mirrors `AIConfig` (`../ai.ts`).
 *
 * No arm below takes it any more: the three `config` members it typed are
 * retirement tombstones since objectui#10874. It stays exported beside its
 * TypeScript twin, which also stays.
 */
export const AIConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'azure', 'custom']).optional().describe('AI provider to use'),
  // `AIModelType | string` on the TypeScript face — the named models are
  // examples, not a closed set, so the accepted value is any string.
  model: z.string().optional().describe('Model identifier'),
  apiEndpoint: z.string().optional().describe('Custom API endpoint URL'),
  temperature: z.number().optional().describe('Sampling temperature (0-1)'),
  maxTokens: z.number().optional().describe('Maximum tokens for response'),
  systemPrompt: z.string().optional().describe('System prompt for the AI model'),
});

/**
 * AI Field Suggestion — mirrors `AIFieldSuggestion` (`../ai.ts`).
 */
export const AIFieldSuggestionSchema = z.object({
  fieldName: z.string().describe('Name of the field being suggested'),
  value: z.any().describe('Suggested value for the field'),
  confidence: z.number().describe('Confidence score (0-1)'),
  reasoning: z.string().optional().describe('Explanation for the suggestion'),
});

/**
 * AI Form Assist Schema — mirrors `AIFormAssistSchema` (`../ai.ts`).
 */
export const AIFormAssistSchema = BaseSchema.extend({
  type: z.literal('ai-form-assist'),
  formId: retiredAiMember(
    'ai-form-assist',
    'formId',
    '`AIFormAssist` takes `({ schema, onApply, onRefresh })` and never reads it.',
  ),
  objectName: retiredAiMember(
    'ai-form-assist',
    'objectName',
    '`AIFormAssist` reaches no data source at all.',
  ),
  fields: retiredAiMember(
    'ai-form-assist',
    'fields',
    'each suggestion already names its own `fieldName`.',
  ),
  context: retiredAiInput(
    'ai-form-assist',
    'context',
    'pass the context to your host\'s own AI service when you ask it for suggestions.',
  ),
  config: retiredAiInput(
    'ai-form-assist',
    'config',
    'configure the model in your host\'s own AI service (ObjectUI has no AI-provider API; these components '
    + 'call no model), and hand its output to the node as `suggestions`.',
  ),
  suggestions: z.array(AIFieldSuggestionSchema).optional().describe('Current suggestions'),
  autoFill: retiredAiMember(
    'ai-form-assist',
    'autoFill',
    'the component destructured it and never used the binding; apply suggestions through `onApply`.',
  ),
  showConfidence: z.boolean().optional().describe('Show confidence scores for suggestions'),
  showReasoning: z.boolean().optional().describe('Show reasoning for suggestions'),
  onApplySuggestion: handlerKeyRefusal('onApplySuggestion', 'retired', 'Callback when a suggestion is applied'),
  onRejectSuggestion: handlerKeyRefusal('onRejectSuggestion', 'retired', 'Callback when a suggestion is rejected'),
  body: retirementTombstone(neitherChannel('ai-form-assist', '`showConfidence`, `showReasoning`, `suggestions`')),
  children: retirementTombstone(neitherChannel('ai-form-assist', '`showConfidence`, `showReasoning`, `suggestions`')),
});

/**
 * AI Recommendation Item — mirrors `AIRecommendationItem` (`../ai.ts`).
 */
export const AIRecommendationItemSchema = z.object({
  id: z.string().describe('Unique identifier'),
  title: z.string().describe('Recommendation title'),
  description: z.string().optional().describe('Recommendation description'),
  score: z.number().describe('Relevance score (0-1)'),
  category: z.string().optional().describe('Recommendation category'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata'),
  action: z
    .object({
      type: z.string().describe('Action type'),
      target: z.string().optional().describe('Action target'),
    })
    .optional()
    .describe('Action to perform when selected'),
});

/**
 * AI Recommendations Schema — mirrors `AIRecommendationsSchema` (`../ai.ts`).
 */
export const AIRecommendationsSchema = BaseSchema.extend({
  type: z.literal('ai-recommendations'),
  objectName: retiredAiMember(
    'ai-recommendations',
    'objectName',
    '`AIRecommendations` renders the `recommendations` it is handed and fetches nothing.',
  ),
  context: retiredAiInput(
    'ai-recommendations',
    'context',
    'pass the context to your host\'s own AI service when you ask it for recommendations.',
  ),
  config: retiredAiInput(
    'ai-recommendations',
    'config',
    'configure the model in your host\'s own AI service (ObjectUI has no AI-provider API; these components '
    + 'call no model), and hand its output to the node as `recommendations`.',
  ),
  recommendations: z.array(AIRecommendationItemSchema).optional().describe('Current recommendations'),
  maxResults: retiredAiMember(
    'ai-recommendations',
    'maxResults',
    '`AIRecommendations` renders EVERY item in `recommendations`; cap the array before handing it over.',
  ),
  showScores: z.boolean().optional().describe('Show relevance scores'),
  // `'carousel'` left this union with objectui#10330 (never implemented), so
  // the two layouts the renderer draws are the whole vocabulary.
  layout: z.enum(['list', 'grid']).optional().describe('Display layout'),
  onSelect: handlerKeyRefusal('onSelect', 'runtime-slot', 'Callback when a recommendation is selected'),
  onDismiss: handlerKeyRefusal('onDismiss', 'runtime-slot', 'Callback when a recommendation is dismissed'),
  loading: z.boolean().optional().describe('Loading state'),
  emptyMessage: z.string().optional().describe('Message to display when no recommendations are available'),
  body: retirementTombstone(
    neitherChannel('ai-recommendations', '`emptyMessage`, `layout`, `loading`, `recommendations`, `showScores`'),
  ),
  children: retirementTombstone(
    neitherChannel('ai-recommendations', '`emptyMessage`, `layout`, `loading`, `recommendations`, `showScores`'),
  ),
});

/**
 * Natural Language Query Result — mirrors `NLQueryResult` (`../ai.ts`).
 */
export const NLQueryResultSchema = z.object({
  query: z.string().describe('Original query string'),
  parsedQuery: z.record(z.string(), z.any()).optional().describe('Parsed query representation'),
  data: z.array(z.any()).optional().describe('Result data'),
  columns: z
    .array(
      z.object({
        name: z.string().describe('Column name'),
        label: z.string().optional().describe('Display label'),
        type: z.string().optional().describe('Column data type'),
      }),
    )
    .optional()
    .describe('Column definitions for the result data'),
  summary: z.string().optional().describe('AI-generated summary of the results'),
  confidence: z.number().optional().describe('Confidence score for the query interpretation (0-1)'),
});

/**
 * Natural Language Query Schema — mirrors `NLQuerySchema` (`../ai.ts`).
 */
export const NLQuerySchema = BaseSchema.extend({
  type: z.literal('nl-query'),
  objectName: retiredAiMember(
    'nl-query',
    'objectName',
    '`NLQueryInput` collects a query string and hands it to `onSubmit`; scope the query in the host that answers it.',
  ),
  placeholder: z.string().optional().describe('Input placeholder text'),
  config: retiredAiInput(
    'nl-query',
    'config',
    'configure the model in your host\'s own AI service (ObjectUI has no AI-provider API; these components '
    + 'call no model), and hand its answer to the node as `result`.',
  ),
  result: NLQueryResultSchema.optional().describe('Current query result'),
  suggestions: z.array(z.string()).optional().describe('Example queries to suggest'),
  showHistory: z.boolean().optional().describe('Show query history'),
  history: z
    .array(
      z.object({
        query: z.string().describe('Query string'),
        timestamp: z.string().describe('Timestamp of the query'),
      }),
    )
    .optional()
    .describe('Query history entries'),
  loading: z.boolean().optional().describe('Loading state'),
  onSubmit: handlerKeyRefusal('onSubmit', 'runtime-slot', 'Callback when a query is submitted'),
  body: retirementTombstone(
    neitherChannel('nl-query', '`history`, `loading`, `placeholder`, `result`, `showHistory`, `suggestions`'),
  ),
  children: retirementTombstone(
    neitherChannel('nl-query', '`history`, `loading`, `placeholder`, `result`, `showHistory`, `suggestions`'),
  ),
});

/**
 * Union of the AI component arms — the category member `AnyComponentSchema`
 * lists (objectui#10859).
 */
const AIComponentSchemaInferred = z.discriminatedUnion('type', [
  AIFormAssistSchema,
  AIRecommendationsSchema,
  NLQuerySchema,
]);

/**
 * The TYPE of {@link AIComponentSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface AIComponentZodType extends AIComponentSchemaInferredType {
  options: AIComponentSchemaInferredType['options'];
}
type AIComponentSchemaInferredType = typeof AIComponentSchemaInferred;

/** The union above, typed by its named {@link AIComponentZodType}. */
export const AIComponentSchema: AIComponentZodType = AIComponentSchemaInferred;
