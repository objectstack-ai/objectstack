// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

// ==========================================
// Tool Category
// ==========================================

/**
 * Tool Category
 * Classifies the tool by its operational domain.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ToolCategorySchema = lazySchema(() => z.enum([
  'data',           // CRUD / query operations
  'action',         // Side-effect actions (send email, create record)
  'flow',           // Trigger a visual flow
  'integration',    // External API / webhook calls
  'vector_search',  // RAG / vector search
  'analytics',      // Aggregation & reporting
  'utility',        // Formatters, parsers, helpers
]).describe('Tool operational category'));

export type ToolCategory = z.infer<typeof ToolCategorySchema>;

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
 * Custom zod `error` for the `.strict()` ToolSchema.
 *
 * `.strict()` matters more than usual here. Removing a key from a NON-strict
 * schema replaces one silent no-op with another: the author keeps writing
 * `requiresConfirmation: true`, zod strips it without a word, and the safety
 * flag goes on meaning nothing — the exact "silent strip" ADR-0032 / #1535
 * closed for objects. Rejecting loudly, with the prescription attached, is what
 * turns the removal into a fix instead of a rename of the problem.
 */
const strictToolError: z.core.$ZodErrorMap = (issue) => {
  if (issue.code !== 'unrecognized_keys') return undefined;
  const keys = (issue as { keys?: readonly string[] }).keys ?? [];
  const lines = keys.map((key) =>
    TOOL_RETIRED_KEY_GUIDANCE[key] ?? `\`${key}\` is not a ToolSchema field.`,
  );
  return (
    `Unrecognized key(s) on the tool definition: ${keys.map((k) => `\`${k}\``).join(', ')}.\n` +
    lines.map((l) => `  • ${l}`).join('\n')
  );
};

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
 *   category: 'action',
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
export const ToolSchema = lazySchema(() => z.object({
  /** Machine name (snake_case, globally unique) */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Tool unique identifier (snake_case)'),

  /** Human-readable display name */
  label: z.string().describe('Tool display name'),

  /** Detailed description for LLM consumption (the model reads this to decide when to call the tool) */
  description: z.string().describe('Tool description for LLM function calling'),

  /** Operational category */
  category: ToolCategorySchema.optional().describe('Tool category for grouping and filtering'),

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

  /** Permission-set capabilities required to use this tool */
  permissions: z.array(z.string()).optional().describe('Required permission-set capabilities'),

  /** Whether the tool is enabled */
  active: z.boolean().default(true).describe('Whether the tool is enabled'),

  /** Whether this is a platform built-in tool (vs. user-defined) */
  builtIn: z.boolean().default(false).describe('Platform built-in tool flag'),
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

}, { error: strictToolError }).strict().describe('AI tool definition. [READ-ONLY PROJECTION — not an execution entry point] Authoring a tool as metadata does NOT make it runnable: this schema has no `implementation`/`handler` field and no framework executor loads a metadata-authored tool. The runtime executes a separately-registered `AIToolDefinition` (cloud `@objectstack/service-ai`); tool metadata is a one-way projection for Studio/discovery. Do not expect a hand-authored tool to run in the open edition (liveness audit #1878/#1892).'));

export type Tool = z.infer<typeof ToolSchema>;

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
 *   category: 'data',
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
