// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { retiredKey } from '../shared/retired-key';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { StateMachineSchema } from '../automation/state-machine.zod';

/**
 * AI Model Configuration
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * Shared history for this file (#4001).
 *
 * An agent is configuration for something that then behaves autonomously. A
 * dropped key does not stop it — the agent registers, answers, and calls tools,
 * just without the constraint its author wrote. The output looks like a working
 * agent, which is why this surface hides its mistakes better than most.
 */
const AGENT_HISTORY =
  'Until #4001 closed this shape these were dropped silently — the agent still registered '
  + 'and still answered, minus whatever the key was meant to configure or constrain.';

export const AIModelConfigSchema = lazySchema(() => strictObject({
  surface: 'this model configuration',
  history: AGENT_HISTORY,
  aliases: {
    modelName: 'model', llm: 'model', deployment: 'model', engine: 'model',
    temp: 'temperature',
    maxOutputTokens: 'maxTokens', max_tokens: 'maxTokens', tokenLimit: 'maxTokens',
    top_p: 'topP', nucleus: 'topP',
  },
}, {
  provider: z.enum(['openai', 'azure_openai', 'anthropic', 'local']).default('openai'),
  model: z.string().describe('Model name (e.g. gpt-4, claude-3-opus)'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().optional(),
  topP: z.number().optional(),
}));

/*
 * REMOVED — `AIKnowledgeSchema` / `AIKnowledge` (#3896 audit close-out). It
 * typed `agent.knowledge`, tombstoned below: the RAG path never read the
 * agent record, so the whole block was a grounding claim nothing enforced.
 * The protocol-17 `agent-knowledge-topics-to-sources` conversion remains in
 * the chain (it rewrites historical SOURCES and imports nothing from here).
 */

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
export const StructuredOutputConfigSchema = lazySchema(() => strictObject({
  surface: 'this structured-output configuration',
  history: AGENT_HISTORY,
  aliases: {
    type: 'format', outputFormat: 'format',
    jsonSchema: 'schema', responseSchema: 'schema',
    retries: 'maxRetries', maxAttempts: 'maxRetries',
    retryOnFailure: 'retryOnValidationFailure', retry: 'retryOnValidationFailure',
    fallback: 'fallbackFormat',
    pipeline: 'transformPipeline', transforms: 'transformPipeline', postProcess: 'transformPipeline',
  },
}, {
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

export type StructuredOutputFormat = z.input<typeof StructuredOutputFormatSchema>;
export type TransformPipelineStep = z.input<typeof TransformPipelineStepSchema>;
export type StructuredOutputConfig = z.input<typeof StructuredOutputConfigSchema>;
/** Post-parse shape of {@link StructuredOutputConfig} — defaults applied, transforms run (ADR-0122). */
export type StructuredOutputConfigParsed = z.infer<typeof StructuredOutputConfigSchema>;

/**
 * AI Agent Schema
 * Definition of an autonomous agent specialized for a domain.
 *
 * The Agent → Skill → Tool three-tier architecture aligns with
 * Salesforce Agentforce, Microsoft Copilot Studio, and ServiceNow
 * Now Assist metadata patterns.
 *
 * - **skills**: THE capability model — an agent references skill names, and
 *   its tool set is exactly the union of those skills' tools (ADR-0064).
 *   There is no direct-tool slot and no global fall-through.
 *
 * @example Agent-Skill Architecture
 * ```ts
 * defineAgent({
 *   name: 'support_tier_1',
 *   label: 'First Line Support',
 *   role: 'Help Desk Assistant',
 *   instructions: 'You are a helpful assistant. Always verify user identity first.',
 *   skills: ['case_management', 'knowledge_search'],
 *   knowledge: { sources: ['faq', 'policies'], indexes: ['support_docs'] },
 * });
 * ```
 */
export const AgentSchema = lazySchema(() => strictObject({
  surface: 'this agent',
  history: AGENT_HISTORY,
  aliases: {
    displayName: 'label', title: 'label',
    persona: 'role', systemRole: 'role',
    prompt: 'instructions', systemPrompt: 'instructions', primeDirectives: 'instructions',
    enabled: 'active', isActive: 'active',
    allowedUsers: 'access', users: 'access', audience: 'access',
    capabilities: 'skills', abilities: 'skills',
    icon: 'avatar', image: 'avatar',
    output: 'structuredOutput', responseFormat: 'structuredOutput',
    limits: 'guardrails', safety: 'guardrails',
  },
  guidance: {
    // ── The two security-shaped removals ──────────────────────────────────
    // Both were dropped rather than tombstoned (see the block below `access`)
    // because at the time there was no rejection to hang a prescription on —
    // the shape was `.strip`, so any tombstone would have been prose in a
    // comment. Closing the shape creates that channel, so they get one now.
    // These are `guidance` rather than `retiredKey` deliberately: both removals
    // are a major behind, and re-declaring a key on the published type a major
    // after deleting it is a worse trade than carrying the sentence here.
    //
    // This is the `skill.permissions` class, which is the class this campaign
    // cares most about: a key that READS as a security control, is not one, and
    // says nothing when you write it. An author who set `visibility: 'private'`
    // believed the agent was hidden. It was listed to everyone, and had been
    // all along.
    visibility:
      '`visibility` was removed in #1901 — it never hid anything. No runtime read it: '
      + 'the chat-access evaluator ignored it and the agent list route did not filter on it, '
      + "so `private` listed the agent to everyone. Use `access` (who may chat) and/or "
      + '`permissions` (required permission-set capabilities) — both ENFORCED at the chat route since #1884.',
    tenantId:
      '`tenantId` was removed in #2377 — it never scoped anything. Tenancy comes from the '
      + 'request context (`resolveAuthzContext`), never from a field on the artifact, so this '
      + 'key did not restrict which tenant could reach the agent. Delete it; scope reachability '
      + 'with `access` / `permissions`.',
    // ── Wrong-layer pointers ──────────────────────────────────────────────
    temperature: 'model settings live under `model` — write `model: { temperature: … }`',
    provider: 'model settings live under `model` — write `model: { provider: … }`',
    maxTokens:
      'ambiguous at this level — per-request model output is `model.maxTokens`; a budget '
      + 'ceiling for the whole invocation is `guardrails.maxTokensPerInvocation`',
  },
}, {
  /** Identity */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Agent unique identifier'),
  label: z.string().describe('Agent display name'),
  avatar: z.string().optional(),
  role: z.string().describe('The persona/role (e.g. "Senior Support Engineer")'),

  /** Cognition */
  instructions: z.string().describe('System Prompt / Prime Directives'),
  model: AIModelConfigSchema.optional(),
  lifecycle: StateMachineSchema.optional().describe('[EXPERIMENTAL — not enforced] State machine defining the agent conversation flow and constraints. Parsed but no runtime consumer yet (liveness #1878/#1893).'),

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

  /**
   * [REMOVED in protocol 17 — #3894] The legacy inline
   * `{type,name,description}[]` fallback.
   *
   * ADR-0064's central invariant is "an agent's tool set is the union of its
   * surface-compatible skills' tools; nothing falls through to the global
   * registry", and this field was the one seam that broke it: the runtime
   * resolved `agent.tools[].name` against the FULL registry with no surface
   * check, so an `ask`-surface agent could name an authoring tool and get it.
   *
   * Tombstoned rather than deleted: `AgentSchema` is not `.strict()`, so a
   * plain deletion would silently strip the key and the agent would quietly
   * reach none of the tools its author listed — the same silent-capability-loss
   * shape this whole issue is about (#3820), restored one layer down.
   */
  tools: retiredKey(
    '`agent.tools` was removed in @objectstack/spec 17 (#3894) — use `skills`. ' +
    'An agent reaches exactly the tools its surface-compatible skills declare ' +
    '(ADR-0064), so move each reference into a skill: a platform tool by its ' +
    'registered name, or `action_<name>` for one of your own AI-exposed Actions. ' +
    'This is NOT a rename — there is no key the value moves to: the migration ' +
    'DELETES the key and emits a notice naming each tool that was listed, and ' +
    'you re-declare each one in a skill by hand. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),

  /** Knowledge */
  // `knowledge` REMOVED (#3896 audit close-out) — a GROUNDING claim nothing
  // enforced: the RAG path never reads the agent record; `search_knowledge`
  // takes `sourceIds` from the LLM's own tool-call arguments (cloud
  // knowledge-tools.ts:96). An author who "scoped" retrieval here scoped
  // nothing — the dangerous direction, same shape as tool.permissions.
  knowledge: retiredKey(
    '`agent.knowledge` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    'declaring knowledge sources/indexes on an agent never scoped retrieval: the ' +
    "`search_knowledge` tool takes `sourceIds` from the LLM's tool-call arguments, not from " +
    'the agent record. Delete the block. Restrict retrieval at the knowledge-service / ' +
    'source level (per-source permissions), and describe intended grounding in ' +
    '`instructions` so the model asks for the right sources. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),

  /** Interface */
  active: z.boolean().default(true),
  access: z.array(z.string()).optional().describe('Who can chat with this agent'),

  /** Permission-set capabilities required to use this agent */
  permissions: z.array(z.string()).optional().describe('Required permission-set capabilities'),

  // Two agent-scoping fields were REMOVED as unenforced security properties
  // (ADR-0049 / ADR-0056 D8 "design+enforce or remove"), not merely marked:
  //   • `tenantId` — 16.x line (#2377): had no runtime reader and did NOT scope
  //     the agent to a tenant. Tenancy comes from the request context
  //     (resolveAuthzContext), never a field on the artifact.
  //   • `visibility` (`global`/`organization`/`private`) — removed 2026-07 (#1901).
  //     No runtime consumer ever read it: the chat-access evaluator excluded it
  //     and the agent list route did not filter by it, so `private` never hid an
  //     agent. Enforcing it correctly needs owner/org anchors that do not exist
  //     yet (agents have no owner field; the `EXTERNAL` posture rung is never
  //     derived — see #1901). Carrying a security-shaped field that lies is a
  //     liability, so it was dropped rather than left marked. Restrict who can
  //     use an agent with `access` / `permissions` — both ENFORCED at the chat
  //     route (#1884). Re-introduce `visibility` when the listing surface gains
  //     real owner/org semantics.

  /** Autonomous Reasoning */
  planning: strictObject({
    surface: 'this planning configuration',
    history: AGENT_HISTORY,
    aliases: { maxSteps: 'maxIterations', maxLoops: 'maxIterations', iterations: 'maxIterations', maxTurns: 'maxIterations' },
  }, {
    /** Maximum reasoning iterations before stopping */
    maxIterations: z.number().int().min(1).max(100).default(10).describe('Maximum planning loop iterations'),
  }).optional().describe('Autonomous reasoning and planning configuration'),

  /** Memory Management */
  memory: strictObject({
    surface: 'this memory configuration',
    history: AGENT_HISTORY,
    aliases: { persistent: 'longTerm', persistence: 'longTerm', reflection: 'reflectionInterval', reflectEvery: 'reflectionInterval' },
    guidance: {
      // The removal recorded in the note below, given the rejection it never had.
      shortTerm:
        '`shortTerm` was removed (ADR-0013 D3, cloud#339) — it declared a working-memory '
        + 'window nothing in the runtime consumed. Cross-turn grounding comes from tools reading '
        + 'live state, and the context budget is governed by the per-request token guardrail, '
        + 'not by this block. Delete it.',
    },
  }, {
    // NOTE: `shortTerm` ({maxMessages,maxTokens}) was removed (ADR-0013 D3,
    // cloud#339). It declared a working-memory window that NOTHING in the
    // runtime consumed — a config that lies. Cross-turn grounding is done by
    // tools reading live state, and the context budget is governed elsewhere
    // (the per-request token guardrail), not by this field. `longTerm` /
    // `reflectionInterval` are kept as forward-looking, off-by-default config.

    /** Long-term (persistent) memory configuration */
    longTerm: strictObject({
      surface: 'this long-term memory configuration',
      history: AGENT_HISTORY,
      aliases: { backend: 'store', storage: 'store', provider: 'store', limit: 'maxEntries', maxItems: 'maxEntries', active: 'enabled' },
    }, {
      /** Whether long-term memory is enabled */
      enabled: z.boolean().default(false).describe('Enable long-term memory persistence'),

      /** Storage backend for long-term memory */
      store: z.enum(['vector', 'database', 'redis']).default('vector').describe('Long-term memory storage backend'),

      /** Maximum number of persisted memory entries */
      maxEntries: z.number().int().min(1).optional().describe('Max entries in long-term memory'),
    }).optional().describe('Long-term / persistent memory'),

    /** Reflection interval — how often the agent reflects on past actions */
    reflectionInterval: z.number().int().min(1).optional().describe('Reflect every N interactions to improve behavior'),
  }).optional().describe('[EXPERIMENTAL — not enforced] Agent memory management. Parsed but no runtime consumer yet (liveness #1878/#1893).'),

  /** Guardrails */
  guardrails: strictObject({
    surface: 'these guardrails',
    history: AGENT_HISTORY,
    aliases: {
      maxTokens: 'maxTokensPerInvocation', tokenBudget: 'maxTokensPerInvocation', tokenLimit: 'maxTokensPerInvocation',
      timeout: 'maxExecutionTimeSec', maxExecutionTime: 'maxExecutionTimeSec', timeoutSec: 'maxExecutionTimeSec',
      blocked: 'blockedTopics', forbiddenTopics: 'blockedTopics', denyTopics: 'blockedTopics',
    },
    guidance: {
      // Guardrails are the block an author reaches for when they want a limit
      // enforced, so a near-miss here is more likely than elsewhere to be
      // someone asking for a control that does not exist. Say which do.
      allowedTopics:
        'there is no allow-list — only `blockedTopics` (a deny-list). Steer permitted scope '
        + 'in `instructions`; restrict WHO can invoke the agent with `access` / `permissions`',
      maxCostUsd: 'there is no cost ceiling here — budget by tokens with `maxTokensPerInvocation`',
      rateLimit: 'per-caller rate limiting is not an agent field — it is enforced by the quota service',
    },
  }, {
    /** Maximum tokens the agent may consume per invocation */
    maxTokensPerInvocation: z.number().int().min(1).optional().describe('Token budget per single invocation'),

    /** Maximum wall-clock time per invocation in seconds */
    maxExecutionTimeSec: z.number().int().min(1).optional().describe('Max execution time in seconds'),

    /** Topics or actions the agent must avoid */
    blockedTopics: z.array(z.string()).optional().describe('Forbidden topics or action names'),
  }).optional().describe('[EXPERIMENTAL — not enforced] Safety guardrails for the agent. Parsed but not enforced — real limits come from the quota service (liveness #1878/#1893).'),

  /** Structured Output */
  structuredOutput: StructuredOutputConfigSchema.optional().describe('[EXPERIMENTAL — not enforced] Structured output format and validation configuration. Parsed but no runtime consumer yet (liveness #1878/#1893).'),
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
 */
export function defineAgent(config: z.input<typeof AgentSchema>): AgentParsed {
  return AgentSchema.parse(config);
}

export type Agent = z.input<typeof AgentSchema>;
/** Post-parse shape of {@link Agent} — defaults applied, transforms run (ADR-0122). */
export type AgentParsed = z.infer<typeof AgentSchema>;
