/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - AI Schema — RETIRED
 *
 * Every declaration in this module mirrored `@object-ui/plugin-ai`, which
 * registered the `ai-form-assist`, `ai-recommendations` and `nl-query` node
 * types. That package is RETIRED (objectstack#25921, ruling A: the console
 * registered it neither eagerly nor lazily, and nothing in the workspace
 * imported it), so no renderer serves the three literals any more: a page
 * carrying one renders the OBJUI-001 "Unknown component type" panel.
 *
 * **What changed.** `AnySchema` has no member for the three literals, and every
 * name below is `never`, so a node literal annotated with one is refused at the
 * authoring site instead of type-checking in front of a runtime refusal. The
 * zod face refuses the same three literals BY NAME at `type`
 * (`./zod/ai.zod.ts`).
 *
 * **Why the names stay.** The ruling retires the mirrors under the tombstone
 * rule: `@deprecated` + `never`, remedy in the text. When a tombstone leaves
 * the published face is the sunset rule objectstack#25912 decides; until it
 * lands the names stay importable, so an upgrading consumer reads a
 * deprecation and a `never` instead of a TS2305 on its import line.
 *
 * **Remedy.** Remove the node from the page: there is no replacement node
 * type. A host that still wants these components keeps its own copy and
 * registers it under its own type key.
 *
 * `ai-insights` (`AIInsightsSchema`) left earlier, whole, under objectui#8800;
 * its absence stays pinned in `./__tests__/ai-insights-retired-8800.test.ts`.
 * The executable half of this retirement is
 * `./__tests__/plugin-ai-retired-25921.test.ts`.
 *
 * @module ai
 */

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921). No node
 * type reads it; remove the reference.
 */
export type AIProvider = never;

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921). No node
 * type reads it; remove the reference.
 */
export type AIModelType = never;

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921). No node
 * type reads it; configure the model in the host's own AI service.
 */
export type AIConfig = never;

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921): it typed
 * the `suggestions` of the retired `ai-form-assist` node. Remove the reference.
 */
export type AIFieldSuggestion = never;

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921):
 * `ai-form-assist` is no longer a node type and nothing renders it. Remove the
 * node from the page; there is no replacement node type.
 */
export type AIFormAssistSchema = never;

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921): it typed
 * the `recommendations` of the retired `ai-recommendations` node. Remove the
 * reference.
 */
export type AIRecommendationItem = never;

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921):
 * `ai-recommendations` is no longer a node type and nothing renders it. Remove
 * the node from the page; there is no replacement node type.
 */
export type AIRecommendationsSchema = never;

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921): it typed
 * the `result` of the retired `nl-query` node. Remove the reference.
 */
export type NLQueryResult = never;

/**
 * @deprecated RETIRED with `@object-ui/plugin-ai` (objectstack#25921):
 * `nl-query` is no longer a node type and nothing renders it. Remove the node
 * from the page; there is no replacement node type.
 */
export type NLQuerySchema = never;
