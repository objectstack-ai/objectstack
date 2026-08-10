// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

// ==========================================
// Tool Category
// ==========================================

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/*
 * REMOVED — `ToolCategorySchema` / `ToolCategory` (#3896 audit close-out).
 *
 * The enum existed to type `tool.category`, which was removed with the other
 * inert authoring keys: nothing ever grouped, filtered or routed tools by it
 * (the only reader was a serializer pass-through). With the key gone the
 * exported enum had zero consumers — `action.zod.ts` deliberately keeps its
 * own INLINE copy of the vocabulary rather than importing this one, and says
 * so. Removing rather than orphaning per the #3950 precedent: an exported
 * schema with no consumer is read as a capability by whoever finds it.
 */

// ==========================================
// Tool Schema
// ==========================================

/**
 * Retired `ToolSchema` keys — the rejection carries the upgrade prescription,
 * because the parse error is the one channel every consumer bumping
 * `@objectstack/spec` is guaranteed to hit (pattern of `object.zod.ts`'s
 * `UNKNOWN_KEY_GUIDANCE`, ADR-0049 enforce-or-remove).
 */
const TOOL_RETIRED_KEY_GUIDANCE: Record<string, string> = {
  permissions:
    '`tool.permissions` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — it ' +
    'promised a capability gate on tool invocation that nothing ever enforced: the key is not ' +
    'part of AIToolDefinition and no execution path read it, so a tool "requiring" capabilities ' +
    'ran for everyone. Delete the key. To gate what a tool can DO, gate the underlying action ' +
    '(`action.requiredPermissions`, ADR-0066) or the object it touches (permission sets) — those ' +
    'are the checks the middleware actually runs.',
  active:
    '`tool.active` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    '`active: false` read as "withdrawn" but withdrew nothing: AIToolDefinition has no such ' +
    'field, ToolRegistry.getAll() returns everything, and the tool kept reaching the LLM tool ' +
    'set and `POST /ai/tools/:name/execute` kept running it (unlike agent.active / skill.active, ' +
    'which ARE enforced). Delete the key. To withdraw a tool, remove it from the skills/agents ' +
    'that reference it.',
  category:
    '`tool.category` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — nothing ' +
    'groups, filters or routes tools by it; the only reader was a serializer pass-through. ' +
    'Delete the key. Organizational grouping belongs in the skill that carries the tool.',
  builtIn:
    '`tool.builtIn` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — no ' +
    'runtime branches on it; it never affected registration, selection or execution. Delete ' +
    'the key.',
  requiresConfirmation:
    '`tool.requiresConfirmation` was removed from @objectstack/spec in the 16.x line ' +
    '(#3715, ADR-0033 §2) — it never had a consumer, and a SAFETY flag that is merely ' +
    'accepted is false compliance: authors set it on destructive tools believing the ' +
    'call would pause, and nothing ever did. No execution path read it — not the LLM ' +
    'tool set (a tool reaches the model as name/description/parameters only), not ' +
    '`ToolRegistry.execute`, not `POST /ai/tools/:name/execute`, and not the MCP bridge ' +
    '(which derives `destructiveHint` from a hardcoded name list). Delete the key. For a ' +
    'REAL gate on a destructive operation, put it behind an action and set ' +
    '`action.ai.requiresConfirmation` — that is the flag the HITL approval queue reads ' +
    '(packages/runtime/src/action-execution.ts), and it is the only path that actually ' +
    'stops execution. For AI metadata mutations the ADR-0033 draft/publish workspace is ' +
    'the gate: nothing is live until a human publishes.',
};

/**
 * The standing history sentence for the tool surface, emitted LAST on every
 * rejection — the shared template's `history` slot.
 *
 * `.strict()` matters more than usual here, and this sentence is why. Removing
 * a key from a NON-strict schema replaces one silent no-op with another: the
 * author keeps writing `requiresConfirmation: true`, zod strips it without a
 * word, and the safety flag goes on meaning nothing — the exact "silent strip"
 * ADR-0032 / #1535 closed for objects. Rejecting loudly, with the prescription
 * attached, is what turns the removal into a fix instead of a rename of the
 * problem.
 *
 * ## Why the slot, and why it was empty before (#6805)
 *
 * Until #6805 this file carried a hand-written `$ZodErrorMap` instead of the
 * shared template, and #6416/#6619 recorded the reason it could not fold: the
 * template appends `history` unconditionally (`${message} ${history}`) and this
 * surface emitted no trailing sentence at all. That is a statement about the
 * TEXT, not about the template — the surface has a real history, it simply had
 * never been written down. Writing it is what makes the fold possible, and the
 * fold is what puts `TOOL_RETIRED_KEY_GUIDANCE` — a hand-maintained per-key
 * retirement table, the most rot-prone content the audit exists for — under
 * `alias-integrity.test.ts` for the first time.
 */
const TOOL_STRICT_HISTORY =
  'Until this shape was closed an undeclared key was dropped without a word — the tool '
  + 'still registered and still reached the LLM tool set, minus whatever the key was meant '
  + 'to do (the #1535 silent-strip class).';

/**
 * Tool Schema
 *
 * First-class metadata definition for an AI-callable tool.
 * Tools are the atomic units of AI capability — each tool
 * represents a single, well-defined operation with strict
 * parameter validation via JSON Schema.
 *
 * Aligned with Salesforce Agentforce, Microsoft Copilot Studio,
 * and ServiceNow Now Assist metadata patterns.
 *
 * @example
 * ```ts
 * const tool = defineTool({
 *   name: 'create_case',
 *   label: 'Create Support Case',
 *   description: 'Creates a new support case record',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       subject: { type: 'string', description: 'Case subject' },
 *       priority: { type: 'string', enum: ['low', 'medium', 'high'] },
 *     },
 *     required: ['subject'],
 *   },
 *   objectName: 'support_case',
 * });
 * ```
 */
export const ToolSchema = lazySchema(() => strictObject({
  surface: 'the tool definition',
  history: TOOL_STRICT_HISTORY,
  guidance: TOOL_RETIRED_KEY_GUIDANCE,
}, {
  /** Machine name (snake_case, globally unique) */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Tool unique identifier (snake_case)'),

  /** Human-readable display name */
  label: z.string().describe('Tool display name'),

  /** Detailed description for LLM consumption (the model reads this to decide when to call the tool) */
  description: z.string().describe('Tool description for LLM function calling'),

  /**
   * JSON Schema describing the tool input parameters.
   * Must be a valid JSON Schema object. The AI model generates
   * arguments conforming to this schema.
   */
  parameters: z.record(z.string(), z.unknown()).describe('JSON Schema for tool parameters'),

  /**
   * Optional JSON Schema for the tool output.
   *
   * ⚠️ EXPERIMENTAL — NOT ENFORCED (liveness #1878/#1893). The runtime folds
   * the top-level keys into the tool description shown to the LLM
   * (service-ai action-tools) but performs NO output validation against this
   * schema, and downstream tool chaining does not consume it either.
   */
  outputSchema: z.record(z.string(), z.unknown()).optional().describe('[EXPERIMENTAL — not enforced] JSON Schema for tool output. Keys are folded into the tool description only; outputs are not validated (liveness #1878/#1893).'),

  /**
   * Associated object name (when the tool operates on a specific data object).
   * @example 'support_case'
   */
  objectName: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional().describe('Target object name (snake_case)'),

  // `category`, `permissions`, `active` and `builtIn` were REMOVED by the
  // 2026-07 #3896 security-audit close-out — all four were authorable and
  // inert, and two were misleading in the dangerous direction: `permissions`
  // promised a capability gate on invocation that nothing enforced, and
  // `active: false` read as "withdrawn" while the tool kept reaching the LLM
  // set and `POST /ai/tools/:name/execute` kept running it. The `.strict()`
  // parse rejects each with its prescription (TOOL_RETIRED_KEY_GUIDANCE), and
  // the `tool-inert-authoring-keys-removed` conversion strips them from
  // authored sources.
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this tool.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}).describe('AI tool definition. [READ-ONLY PROJECTION — not an execution entry point] Authoring a tool as metadata does NOT make it runnable: this schema has no `implementation`/`handler` field and no framework executor loads a metadata-authored tool. The runtime executes a separately-registered `AIToolDefinition` (cloud `@objectstack/service-ai`); tool metadata is a one-way projection for Studio/discovery. Do not expect a hand-authored tool to run in the open edition (liveness audit #1878/#1892).'));

export type Tool = z.input<typeof ToolSchema>;

// ==========================================
// Factory
// ==========================================

/**
 * Type-safe factory for creating AI tool metadata definitions.
 *
 * Validates the config at creation time using Zod `.parse()`.
 *
 * @example
 * ```ts
 * const tool = defineTool({
 *   name: 'query_orders',
 *   label: 'Query Orders',
 *   description: 'Search and filter customer orders',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       customerId: { type: 'string' },
 *       status: { type: 'string', enum: ['pending', 'shipped', 'delivered'] },
 *     },
 *     required: ['customerId'],
 *   },
 * });
 * ```
 */
export function defineTool(config: z.input<typeof ToolSchema>): Tool {
  return ToolSchema.parse(config);
}
