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
 *   requiresConfirmation: true,
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
   * Used for structured output validation and downstream tool chaining.
   */
  outputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for tool output'),

  /**
   * Associated object name (when the tool operates on a specific data object).
   * @example 'support_case'
   */
  objectName: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional().describe('Target object name (snake_case)'),

  /** Whether the tool requires human confirmation before execution */
  requiresConfirmation: z.boolean().default(false).describe('Require user confirmation before execution'),

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

}));

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
