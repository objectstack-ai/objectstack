// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

// ==========================================
// Trigger Condition
// ==========================================

/**
 * Skill Trigger Condition Schema
 *
 * Defines programmatic conditions under which a skill becomes active.
 * Allows context-aware activation based on object type, user role, etc.
 */
import { lazySchema } from '../shared/lazy-schema';
export const SkillTriggerConditionSchema = lazySchema(() => z.object({
  /** Condition field (e.g. 'objectName', 'userRole', 'channel') */
  field: z.string().describe('Context field to evaluate'),

  /** Comparison operator */
  operator: z.enum(['eq', 'neq', 'in', 'not_in', 'contains']).describe('Comparison operator'),

  /** Expected value(s) */
  value: z.union([z.string(), z.array(z.string())]).describe('Expected value or values'),
}));

export type SkillTriggerCondition = z.infer<typeof SkillTriggerConditionSchema>;

// ==========================================
// Skill Schema
// ==========================================

/**
 * Skill Schema
 *
 * An ability group that aggregates related tools by domain.
 * Skills are the middle tier of the Agent → Skill → Tool architecture,
 * providing reusable capability bundles that can be shared across agents.
 *
 * Aligned with Salesforce Agentforce Topics, Microsoft Copilot Studio Topics,
 * and ServiceNow Skill metadata patterns.
 *
 * @example
 * ```ts
 * const skill = defineSkill({
 *   name: 'case_management',
 *   label: 'Case Management',
 *   description: 'Handles support case lifecycle',
 *   instructions: 'Use these tools to create, update, and resolve support cases.',
 *   tools: ['create_case', 'update_case', 'resolve_case', 'query_cases'],
 *   triggerPhrases: ['create a case', 'open a ticket', 'resolve issue'],
 * });
 * ```
 */
export const SkillSchema = lazySchema(() => z.object({
  /** Machine name (snake_case, globally unique) */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Skill unique identifier (snake_case)'),

  /** Human-readable display name */
  label: z.string().describe('Skill display name'),

  /** Detailed description of the skill's purpose */
  description: z.string().optional().describe('Skill description'),

  /**
   * ADR-0063 §3 / ADR-0064 — skill ↔ agent affinity. Which kernel agent
   * surface this skill belongs to:
   *
   * - `'ask'`   — the data product (read/query/explore + run actions).
   * - `'build'` — the authoring product (metadata draft → verify → publish).
   * - `'both'`  — genuinely shared, read-only capability (e.g. a
   *               `schema_reader` exposing `describe_object`/`list_objects`).
   *
   * A skill may only bind to an agent whose surface it matches (`'both'`
   * matches either); the runtime enforces this at load time. An agent's
   * tool set is the union of its surface-compatible skills' tools — there
   * is no global fall-through (ADR-0064). Defaults to `'ask'`, the
   * data-console surface. (Both the `ask` and `build` in-product agent
   * runtimes ship in the cloud / Enterprise distribution per ADR-0025;
   * the surface value here is authoring metadata, not an edition gate.)
   */
  surface: z.enum(['ask', 'build', 'both']).default('ask').describe(
    "Agent surface this skill binds to ('ask' | 'build' | 'both') — ADR-0063 §3",
  ),

  /**
   * Instructions injected into the system prompt when this skill is active.
   * Guides the LLM on how and when to use the skill's tools.
   */
  instructions: z.string().optional().describe('LLM instructions when skill is active'),

  /**
   * References to tool names that belong to this skill.
   *
   * - Plain names (`create_case`) match a tool with that exact name.
   * - Trailing-wildcard patterns (`action_*`) match every tool whose
   *   name starts with the prefix. Useful for subscribing to a family
   *   of dynamically registered tools (e.g. the `action_<name>` tools
   *   materialised from each object's declarative Action list).
   *
   * Tools should also be registered as first-class metadata
   * (type: 'tool') unless they are dynamically materialised at runtime.
   */
  tools: z.array(z.string().regex(/^[a-z_][a-z0-9_]*\*?$/)).describe('Tool names belonging to this skill (supports trailing wildcard, e.g. `action_*`)'),

  /**
   * Natural language phrases that trigger skill activation.
   * Used for intent matching and skill routing.
   */
  triggerPhrases: z.array(z.string()).optional().describe('Phrases that activate this skill'),

  /**
   * Programmatic conditions for skill activation.
   * Evaluated against the runtime context (object name, user role, etc.).
   */
  triggerConditions: z.array(SkillTriggerConditionSchema).optional().describe('Programmatic activation conditions'),

  /** Permission profiles/roles required to use this skill */
  permissions: z.array(z.string()).optional().describe('Required permissions or roles'),

  /** Whether the skill is enabled */
  active: z.boolean().default(true).describe('Whether the skill is enabled'),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this skill.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}));

export type Skill = z.infer<typeof SkillSchema>;

// ==========================================
// Factory
// ==========================================

/**
 * Type-safe factory for creating AI skill definitions.
 *
 * Validates the config at creation time using Zod `.parse()`.
 *
 * @example
 * ```ts
 * const skill = defineSkill({
 *   name: 'order_management',
 *   label: 'Order Management',
 *   description: 'Handles order lifecycle operations',
 *   instructions: 'Use these tools to manage customer orders.',
 *   tools: ['create_order', 'update_order', 'cancel_order'],
 *   triggerPhrases: ['place an order', 'cancel my order'],
 *   triggerConditions: [
 *     { field: 'objectName', operator: 'eq', value: 'order' },
 *   ],
 * });
 * ```
 */
export function defineSkill(config: z.input<typeof SkillSchema>): Skill {
  return SkillSchema.parse(config);
}
