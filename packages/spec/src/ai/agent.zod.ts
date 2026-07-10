// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { StateMachineSchema } from '../automation/state-machine.zod';

/**
 * AI Model Configuration
 */
import { lazySchema } from '../shared/lazy-schema';
export const AIModelConfigSchema = lazySchema(() => z.object({
  provider: z.enum(['openai', 'azure_openai', 'anthropic', 'local']).default('openai'),
  model: z.string().describe('Model name (e.g. gpt-4, claude-3-opus)'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().optional(),
  topP: z.number().optional(),
}));

/**
 * AI Tool Definition
 * References to Actions, Flows, or Objects available to the Agent.
 */
export const AIToolSchema = lazySchema(() => z.object({
  type: z.enum(['action', 'flow', 'query', 'vector_search']),
  name: z.string().describe('Reference name (Action Name, Flow Name)'),
  description: z.string().optional().describe('Override description for the LLM'),
}));

/**
 * AI Knowledge Base
 * RAG configuration.
 */
export const AIKnowledgeSchema = lazySchema(() => z.object({
  topics: z.array(z.string()).describe('Topics/Tags to recruit knowledge from'),
  indexes: z.array(z.string()).describe('Vector Store Indexes'),
}));

/**
 * Structured Output Format
 * Defines the expected output format for agent responses
 */
export const StructuredOutputFormatSchema = lazySchema(() => z.enum([
  'json_object',
  'json_schema',
  'regex',
  'grammar',
  'xml',
]).describe('Output format for structured agent responses'));

/**
 * Transform Pipeline Step
 * Post-processing steps applied to structured output
 */
export const TransformPipelineStepSchema = lazySchema(() => z.enum([
  'trim',
  'parse_json',
  'validate',
  'coerce_types',
]).describe('Post-processing step for structured output'));

/**
 * Structured Output Configuration
 * Controls how the agent formats and validates its output
 */
export const StructuredOutputConfigSchema = lazySchema(() => z.object({
  /** Output format type */
  format: StructuredOutputFormatSchema.describe('Expected output format'),

  /** JSON Schema definition for output validation */
  schema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema definition for output'),

  /** Whether to enforce exact schema compliance */
  strict: z.boolean().default(false).describe('Enforce exact schema compliance'),

  /** Retry on validation failure */
  retryOnValidationFailure: z.boolean().default(true).describe('Retry generation when output fails validation'),

  /** Maximum retry attempts */
  maxRetries: z.number().int().min(0).default(3).describe('Maximum retries on validation failure'),

  /** Fallback format if primary format fails */
  fallbackFormat: StructuredOutputFormatSchema.optional().describe('Fallback format if primary format fails'),

  /** Post-processing pipeline steps */
  transformPipeline: z.array(TransformPipelineStepSchema).optional().describe('Post-processing steps applied to output'),
}).describe('Structured output configuration for agent responses'));

export type StructuredOutputFormat = z.infer<typeof StructuredOutputFormatSchema>;
export type TransformPipelineStep = z.infer<typeof TransformPipelineStepSchema>;
export type StructuredOutputConfig = z.infer<typeof StructuredOutputConfigSchema>;

/**
 * AI Agent Schema
 * Definition of an autonomous agent specialized for a domain.
 *
 * The Agent → Skill → Tool three-tier architecture aligns with
 * Salesforce Agentforce, Microsoft Copilot Studio, and ServiceNow
 * Now Assist metadata patterns.
 *
 * - **skills**: Primary capability model — references skill names.
 * - **tools**: Fallback / direct tool references (legacy inline format).
 *
 * @example Agent-Skill Architecture
 * ```ts
 * defineAgent({
 *   name: 'support_tier_1',
 *   label: 'First Line Support',
 *   role: 'Help Desk Assistant',
 *   instructions: 'You are a helpful assistant. Always verify user identity first.',
 *   skills: ['case_management', 'knowledge_search'],
 *   knowledge: { topics: ['faq', 'policies'], indexes: ['support_docs'] },
 * });
 * ```
 *
 * @example Legacy Tool References (backward-compatible)
 * ```ts
 * defineAgent({
 *   name: 'support_tier_1',
 *   label: 'First Line Support',
 *   role: 'Help Desk Assistant',
 *   instructions: 'You are a helpful assistant.',
 *   tools: [
 *     { type: 'flow', name: 'reset_password', description: 'Trigger password reset email' },
 *     { type: 'query', name: 'get_order_status', description: 'Check order shipping status' },
 *   ],
 * });
 * ```
 */
export const AgentSchema = lazySchema(() => z.object({
  /** Identity */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Agent unique identifier'),
  label: z.string().describe('Agent display name'),
  avatar: z.string().optional(),
  role: z.string().describe('The persona/role (e.g. "Senior Support Engineer")'),

  /** Cognition */
  instructions: z.string().describe('System Prompt / Prime Directives'),
  model: AIModelConfigSchema.optional(),
  lifecycle: StateMachineSchema.optional().describe('State machine defining the agent conversation follow and constraints'),

  /**
   * ADR-0063 §1 / ADR-0064 — the product surface this agent IS. The kernel
   * ships exactly two: `ask` (data product, surface `'ask'`) and `build`
   * (authoring product, surface `'build'`). A skill may only bind to an
   * agent whose surface it matches (`'both'` skills bind to either), and the
   * agent's tool set is the union of those skills' tools — nothing falls
   * through to the global registry. Defaults to `'ask'`.
   */
  surface: z.enum(['ask', 'build']).default('ask').describe(
    "Product surface this agent binds ('ask' | 'build') — ADR-0063 §1",
  ),

  /** Capabilities — Skill-based (primary) */
  skills: z.array(z.string().regex(/^[a-z_][a-z0-9_]*$/)).optional().describe('Skill names to attach (Agent→Skill→Tool architecture)'),

  /** Capabilities — Direct tool references (fallback / legacy) */
  tools: z.array(AIToolSchema).optional().describe('Direct tool references (legacy fallback)'),

  /** Knowledge */
  knowledge: AIKnowledgeSchema.optional().describe('RAG access'),

  /** Interface */
  active: z.boolean().default(true),
  access: z.array(z.string()).optional().describe('Who can chat with this agent'),

  /** Permission-set capabilities required to use this agent */
  permissions: z.array(z.string()).optional().describe('Required permission-set capabilities'),

  /** Multi-tenancy & Visibility */
  tenantId: z.string().optional().describe('Tenant/Organization ID'),
  // ⚠️ EXPERIMENTAL — NOT ENFORCED (#1901, ADR-0049). The chat-access evaluator
  // deliberately excludes `visibility` (agent-access.ts) and the agent list
  // route does not filter by it — setting `private` does NOT hide the agent.
  // Use `access` / `permissions` (both ENFORCED at the chat route, #1884) to
  // actually restrict who can use an agent. Enforcement needs owner/org
  // semantics on the listing surface first; tracked in #1901.
  visibility: z.enum(['global', 'organization', 'private']).default('organization')
    .describe('[EXPERIMENTAL — NOT ENFORCED, #1901] Intended listing scope. No runtime consumer yet; use access/permissions for real gating.'),

  /** Autonomous Reasoning */
  planning: z.object({
    /** Planning strategy for autonomous reasoning loops */
    strategy: z.enum(['react', 'plan_and_execute', 'reflexion', 'tree_of_thought']).default('react').describe('Autonomous reasoning strategy'),

    /** Maximum reasoning iterations before stopping */
    maxIterations: z.number().int().min(1).max(100).default(10).describe('Maximum planning loop iterations'),

    /** Whether the agent can revise its own plan mid-execution */
    allowReplan: z.boolean().default(true).describe('Allow dynamic re-planning based on intermediate results'),
  }).optional().describe('Autonomous reasoning and planning configuration'),

  /** Memory Management */
  memory: z.object({
    // NOTE: `shortTerm` ({maxMessages,maxTokens}) was removed (ADR-0013 D3,
    // cloud#339). It declared a working-memory window that NOTHING in the
    // runtime consumed — a config that lies. Cross-turn grounding is done by
    // tools reading live state, and the context budget is governed elsewhere
    // (the per-request token guardrail), not by this field. `longTerm` /
    // `reflectionInterval` are kept as forward-looking, off-by-default config.

    /** Long-term (persistent) memory configuration */
    longTerm: z.object({
      /** Whether long-term memory is enabled */
      enabled: z.boolean().default(false).describe('Enable long-term memory persistence'),

      /** Storage backend for long-term memory */
      store: z.enum(['vector', 'database', 'redis']).default('vector').describe('Long-term memory storage backend'),

      /** Maximum number of persisted memory entries */
      maxEntries: z.number().int().min(1).optional().describe('Max entries in long-term memory'),
    }).optional().describe('Long-term / persistent memory'),

    /** Reflection interval — how often the agent reflects on past actions */
    reflectionInterval: z.number().int().min(1).optional().describe('Reflect every N interactions to improve behavior'),
  }).optional().describe('Agent memory management'),

  /** Guardrails */
  guardrails: z.object({
    /** Maximum tokens the agent may consume per invocation */
    maxTokensPerInvocation: z.number().int().min(1).optional().describe('Token budget per single invocation'),

    /** Maximum wall-clock time per invocation in seconds */
    maxExecutionTimeSec: z.number().int().min(1).optional().describe('Max execution time in seconds'),

    /** Topics or actions the agent must avoid */
    blockedTopics: z.array(z.string()).optional().describe('Forbidden topics or action names'),
  }).optional().describe('Safety guardrails for the agent'),

  /** Structured Output */
  structuredOutput: StructuredOutputConfigSchema.optional().describe('Structured output format and validation configuration'),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this agent.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}));

/**
 * Type-safe factory for creating AI agent definitions.
 *
 * Validates the config at creation time using Zod `.parse()`.
 *
 * @example Agent-Skill Architecture (recommended)
 * ```ts
 * const supportAgent = defineAgent({
 *   name: 'support_agent',
 *   label: 'Support Agent',
 *   role: 'Senior Support Engineer',
 *   instructions: 'You help customers resolve technical issues.',
 *   skills: ['case_management', 'knowledge_search'],
 * });
 * ```
 *
 * @example Legacy Tool References (backward-compatible)
 * ```ts
 * const supportAgent = defineAgent({
 *   name: 'support_agent',
 *   label: 'Support Agent',
 *   role: 'Senior Support Engineer',
 *   instructions: 'You help customers resolve technical issues.',
 *   tools: [{ type: 'action', name: 'create_ticket' }],
 * });
 * ```
 */
export function defineAgent(config: z.input<typeof AgentSchema>): Agent {
  return AgentSchema.parse(config);
}

export type Agent = z.infer<typeof AgentSchema>;
export type AITool = z.infer<typeof AIToolSchema>;
