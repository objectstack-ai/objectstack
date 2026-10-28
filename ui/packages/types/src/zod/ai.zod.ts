/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - AI Component Zod Validators — RETIRED
 *
 * This module mirrored the three node declarations of `../ai.ts`, which
 * `@object-ui/plugin-ai` registered as `ai-form-assist`, `ai-recommendations`
 * and `nl-query`. That package is RETIRED (objectstack#25921, ruling A), so no
 * renderer serves the three literals and a page carrying one renders the
 * OBJUI-001 "Unknown component type" panel.
 *
 * Two halves, one per audience:
 *
 *   - **The refusal arms** ({@link RetiredAIFormAssistNodeSchema} and its two
 *     siblings) take the arms' place inside `AnyComponentSchema`, in the shape
 *     of `cloud.zod.ts#RetiredCloudPlanStatusNodeSchema` (objectui#12954): a
 *     stale document is refused BY NAME, at `type`, with the remedy. Deleting
 *     the arms would already refuse, but with the union's remedy-free
 *     `Invalid input`. They are deliberately NOT re-exported from
 *     `index.zod.ts`: nothing outside this package parses against a refusal arm.
 *   - **The published names** (`AIFormAssistSchema` and the rest) are
 *     `@deprecated` `z.never()` tombstones, the zod spelling of the `never`
 *     their TypeScript twins in `../ai.ts` carry. Every parse against one fails
 *     with the remedy. They leave the published face under objectstack#25912's
 *     sunset rule, not here.
 *
 * Pinned in `../__tests__/plugin-ai-retired-25921.test.ts`.
 *
 * ⛔ No `.default()` anywhere in this module — see the "authors no default"
 * note in `index.zod.ts`.
 *
 * @module zod/ai
 * @packageDocumentation
 */

import { z } from 'zod';
import { retiredNodeType } from './tombstone.zod.js';

/** The remedy every refusal in this module carries — one string, both channels. */
const PLUGIN_AI_RETIRED =
  'It retired with `@object-ui/plugin-ai`: nothing registers it, so the page rendered '
  + 'the "Unknown component type" panel in its place. Remove the node from the page; there is no '
  + 'replacement node type.';

/** A published name kept as a `never` tombstone: every parse fails, naming the remedy. */
const retiredExport = (name: string) => {
  const text = `RETIRED — \`${name}\` mirrored a node type of \`@object-ui/plugin-ai\`, which retired, `
    + 'and accepts nothing. Remove the reference.';
  return z.never({ error: text }).describe(text);
};

/** ⛔ `ai-form-assist` is RETIRED — its named refusal inside `AnyComponentSchema`. */
export const RetiredAIFormAssistNodeSchema = retiredNodeType('ai-form-assist', PLUGIN_AI_RETIRED);

/** ⛔ `ai-recommendations` is RETIRED — its named refusal inside `AnyComponentSchema`. */
export const RetiredAIRecommendationsNodeSchema = retiredNodeType('ai-recommendations', PLUGIN_AI_RETIRED);

/** ⛔ `nl-query` is RETIRED — its named refusal inside `AnyComponentSchema`. */
export const RetiredNLQueryNodeSchema = retiredNodeType('nl-query', PLUGIN_AI_RETIRED);

/** @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921); accepts nothing. Remove the reference. */
export const AIConfigSchema = retiredExport('AIConfigSchema');

/** @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921); accepts nothing. Remove the reference. */
export const AIFieldSuggestionSchema = retiredExport('AIFieldSuggestionSchema');

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921):
 * `ai-form-assist` is no longer a node type; accepts nothing. Remove the node
 * from the page.
 */
export const AIFormAssistSchema = retiredExport('AIFormAssistSchema');

/** @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921); accepts nothing. Remove the reference. */
export const AIRecommendationItemSchema = retiredExport('AIRecommendationItemSchema');

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921):
 * `ai-recommendations` is no longer a node type; accepts nothing. Remove the
 * node from the page.
 */
export const AIRecommendationsSchema = retiredExport('AIRecommendationsSchema');

/** @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921); accepts nothing. Remove the reference. */
export const NLQueryResultSchema = retiredExport('NLQueryResultSchema');

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921):
 * `nl-query` is no longer a node type; accepts nothing. Remove the node from
 * the page.
 */
export const NLQuerySchema = retiredExport('NLQuerySchema');

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921). It was
 * the category union of the three arms; `AnyComponentSchema` now lists their
 * refusal arms instead. Accepts nothing. Remove the reference.
 */
export const AIComponentSchema = retiredExport('AIComponentSchema');

/** @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921). Remove the reference. */
export type AIComponentZodType = typeof AIComponentSchema;
