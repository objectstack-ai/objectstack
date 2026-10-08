// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { enumWithRetiredValues, retiredKey } from '../shared/retired-key';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { lazySchema } from '../shared/lazy-schema';
import { aiJsonSchemaSlot } from '../shared/ai-json-schema-slot';
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
  'Until this shape was closed these were dropped silently — the agent still registered '
  + 'and still answered, minus whatever the key was meant to configure or constrain.';

/**
 * AI Model Configuration
 */
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

// ── Retired structured-output members (ADR-0049 enforce-or-remove) ──────────
//
// Ruling record 5945617233 (letter A, #21277) retired the four members the one
// runtime that executes agents, cloud's AI service, refuses before an agent's
// first turn (`AI_AGENT_STRUCTURED_OUTPUT_UNSUPPORTED`): the `regex`, `grammar`
// and `xml` formats and the `coerce_types` step. Each is a VALUE-level
// retirement (`enumWithRetiredValues`, shared/retired-key.ts): the member left
// its enum, so `tsc` refuses it, and the parse answers it with the
// prescription below instead of zod's anonymous enum message. The ADR-0087
// conversion `agent-structured-output-refused-members-removed`
// (conversions/registry.ts) lists the mechanical edit for existing sources and
// replays it over stored rows. Module-private and written with `//`, never
// `/** */`: prose an enum's error map consumes, not documented surface — an
// export with no reader is a published surface the next narrowing must keep.
const JSON_ONLY_FORMAT_FIX =
  'Structured output is JSON-only. At `agent.structuredOutput.format`, use `json_schema` with a JSON '
  + 'Schema in `schema`, or `json_object` — or delete the `structuredOutput` block if the agent needs '
  + 'no output contract; at `agent.structuredOutput.fallbackFormat`, name one of those two or delete '
  + 'the key. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

const STRUCTURED_OUTPUT_FORMAT_RETIRED = {
  regex:
    '`regex` was removed from `StructuredOutputFormat` in @objectstack/spec 17.7.0 (ADR-0049 '
    + 'enforce-or-remove) — no key ever carried the pattern a `regex` answer would be checked '
    + 'against, and the cloud AI runtime refuses an agent that declares it before its first turn. '
    + JSON_ONLY_FORMAT_FIX,
  grammar:
    '`grammar` was removed from `StructuredOutputFormat` in @objectstack/spec 17.7.0 (ADR-0049 '
    + 'enforce-or-remove) — no key ever carried the grammar a `grammar` answer would be checked '
    + 'against, and the cloud AI runtime refuses an agent that declares it before its first turn. '
    + JSON_ONLY_FORMAT_FIX,
  xml:
    '`xml` was removed from `StructuredOutputFormat` in @objectstack/spec 17.7.0 (ADR-0049 '
    + 'enforce-or-remove) — the cloud AI runtime checks a final answer only as JSON, and refuses an '
    + 'agent that declares `xml` before its first turn. '
    + JSON_ONLY_FORMAT_FIX,
} as const;

const COERCE_TYPES_RETIRED =
  '`coerce_types` was removed from `TransformPipelineStep` in @objectstack/spec 17.7.0 (ADR-0049 '
  + 'enforce-or-remove) — there is no coercion engine, and the cloud AI runtime refuses an agent '
  + 'whose `agent.structuredOutput.transformPipeline` lists it before its first turn. Delete the '
  + 'step and declare the exact types in `schema`, so the answer is validated as the model wrote '
  + 'it; `trim`, `parse_json` and `validate` are unchanged. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/**
 * Structured Output Format
 *
 * The format an agent's final answer is checked against: JSON only
 * (`json_object` or `json_schema`). The `regex`, `grammar` and `xml` members
 * were retired (ADR-0049) — the runtime refused all three — and are answered
 * at parse with their prescription.
 */
export const StructuredOutputFormatSchema = lazySchema(() => enumWithRetiredValues(
  ['json_object', 'json_schema'],
  STRUCTURED_OUTPUT_FORMAT_RETIRED,
).describe('Output format for structured agent responses (JSON only)'));

/**
 * Transform Pipeline Step
 *
 * Post-processing steps applied to structured output. The `coerce_types` step
 * was retired (ADR-0049) — no coercion engine existed and the runtime refused
 * it — and is answered at parse with its prescription.
 */
export const TransformPipelineStepSchema = lazySchema(() => enumWithRetiredValues(
  ['trim', 'parse_json', 'validate'],
  { coerce_types: COERCE_TYPES_RETIRED },
).describe('Post-processing step for structured output'));

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

  /**
   * JSON Schema definition for output validation. The cloud AI runtime
   * compiles it, and its schema reader refuses an untyped subschema that
   * carries a type-scoped keyword (`properties`, `items`, `pattern`,
   * `minimum`, …). The slot refuses the same schemas here, at the subschema's
   * path, through the one factory `action.ai.outputSchema` shares
   * (`shared/ai-json-schema-slot.ts`).
   */
  schema: aiJsonSchemaSlot('structuredOutput.schema').optional().describe(
    'JSON Schema definition for output. An untyped subschema that carries a type-scoped keyword '
    + '(properties, items, pattern, minimum, …) is refused at its path, because the AI runtime\'s '
    + 'schema reader does not check it; declare its "type".',
  ),

  /** Whether to enforce exact schema compliance */
  strict: z.boolean().default(false).describe('Enforce exact schema compliance'),

  /** Retry on validation failure */
  retryOnValidationFailure: z.boolean().default(true).describe('Retry generation when output fails validation'),

  /** Maximum retry attempts */
  maxRetries: z.number().int().min(0).default(3).describe('Maximum retries on validation failure'),

  /**
   * Fallback format. The cloud AI runtime checks the last answer against it
   * once the primary format's retries are spent.
   */
  fallbackFormat: StructuredOutputFormatSchema.optional().describe(
    "Fallback format: once the primary format's retries are spent, the last answer is checked against this format instead",
  ),

  /** Post-processing pipeline steps */
  transformPipeline: z.array(TransformPipelineStepSchema).optional().describe('Post-processing steps applied to output'),
}).describe('Structured output configuration for agent responses'));

export type StructuredOutputFormat = z.input<typeof StructuredOutputFormatSchema>;
export type TransformPipelineStep = z.input<typeof TransformPipelineStepSchema>;
export type StructuredOutputConfig = z.input<typeof StructuredOutputConfigSchema>;
/** Post-parse shape of {@link StructuredOutputConfig} — defaults applied, transforms run (ADR-0122). */
export type StructuredOutputConfigParsed = z.infer<typeof StructuredOutputConfigSchema>;

// ── The agent memory contract (ADR-0049 enforce-or-remove) ──────────────────
//
// Ruling record 5950198150 (letter A′, #20274): the `agent.memory` contract
// states exactly what the runtime honours. The one runtime that executes
// agents, cloud's AI service, enforces long-term memory from `enabled`,
// `maxEntries` and `reflectionInterval`, and refused before an agent's first
// turn (`AI_AGENT_MEMORY_UNSUPPORTED`) the declarations this spec still
// accepted: an enabled `longTerm` missing either number, a `reflectionInterval`
// without an enabled `longTerm`, and a `store` other than its own database
// store — `vector`, the old default, included. Authoring now refuses the same
// declarations, by name, with these prescriptions. Module-private and written
// with `//`, never `/** */`: prose the schema's refusals consume, not
// documented surface.
const LONG_TERM_STORE_RETIRED =
  '`agent.memory.longTerm.store` was removed in @objectstack/spec 17.7.0 (ADR-0049 '
  + 'enforce-or-remove) — the memory store is platform infrastructure, not agent metadata: the '
  + 'cloud AI runtime keeps long-term memory notes in its own database store, and refused the '
  + '`vector` store (the old default) and `redis` before an agent\'s first turn. Delete the key; '
  + 'long-term memory is configured by `enabled`, `maxEntries` and '
  + '`agent.memory.reflectionInterval`, and where the notes are kept is the platform\'s choice. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

const LONG_TERM_STORE_SPELLING_RETIRED =
  'there is no storage-backend key on long-term memory — where the notes are kept is the '
  + 'platform\'s choice, not agent metadata (`agent.memory.longTerm.store` was removed in '
  + '@objectstack/spec 17.7.0, ADR-0049 enforce-or-remove). Delete the key.';

const MAX_ENTRIES_REQUIRED =
  '`agent.memory.longTerm.maxEntries` is required when `agent.memory.longTerm.enabled` is '
  + 'true — it is how many distilled notes are kept for each user (the newest are recalled before '
  + 'the first round, and older ones are evicted), and the spec declares no default for it. Declare '
  + 'it as an integer of at least 1, or delete `longTerm` and `reflectionInterval` if the agent '
  + 'needs no long-term memory.';

const REFLECTION_INTERVAL_REQUIRED =
  '`agent.memory.reflectionInterval` is required when `agent.memory.longTerm.enabled` is true — '
  + 'it is how many delivered interactions pass between reflections, and a reflection is what '
  + 'writes a note to long-term memory, so without it nothing is ever remembered; the spec '
  + 'declares no default for it. Declare it as an integer of at least 1, or delete `longTerm` if '
  + 'the agent needs no long-term memory.';

const REFLECTION_INTERVAL_WITHOUT_LONG_TERM =
  '`agent.memory.reflectionInterval` requires `agent.memory.longTerm.enabled: true` — a '
  + 'reflection writes a note to long-term memory, and this agent has none enabled, so the '
  + 'interval would do nothing. Enable long-term memory (`longTerm: { enabled: true, maxEntries: N }`) '
  + 'or delete `reflectionInterval`.';

/**
 * The three refusals of the agent memory contract, each a `custom` issue at
 * the path of the key it names (the house refinement shape —
 * `ai/skill.zod.ts`'s `checkSkillTriggerConditionValueShape`).
 *
 * A refinement on `memory`, not on `longTerm`, because `reflectionInterval` is
 * `longTerm`'s sibling. No default is declared for either number: the runtime
 * adds none, and a spec default would be a number with no measured basis that
 * a later release could only remove by breaking it. It runs only on a body the
 * shape already accepted — an unknown key, a wrong type or the `store`
 * tombstone aborts first — so an author meets one complaint at a time.
 */
function checkAgentMemoryContract(
  memory: { longTerm?: { enabled?: boolean; maxEntries?: number }; reflectionInterval?: number },
  ctx: z.RefinementCtx,
): void {
  const enabled = memory.longTerm?.enabled === true;
  if (enabled) {
    if (memory.longTerm?.maxEntries === undefined) {
      ctx.addIssue({ code: 'custom', path: ['longTerm', 'maxEntries'], message: MAX_ENTRIES_REQUIRED });
    }
    if (memory.reflectionInterval === undefined) {
      ctx.addIssue({ code: 'custom', path: ['reflectionInterval'], message: REFLECTION_INTERVAL_REQUIRED });
    }
    return;
  }
  if (memory.reflectionInterval !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['reflectionInterval'], message: REFLECTION_INTERVAL_WITHOUT_LONG_TERM });
  }
}

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
      '`visibility` was removed — it never hid anything. No runtime read it: '
      + 'the chat-access evaluator ignored it and the agent list route did not filter on it, '
      + "so `private` listed the agent to everyone. Use `access` (who may chat) and/or "
      + '`permissions` (required permission-set capabilities) — both ENFORCED at the chat route.',
    tenantId:
      '`tenantId` was removed — it never scoped anything. Tenancy comes from the '
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

  /**
   * [REMOVED — #21320] The agent conversation state machine. ADR-0049
   * enforce-or-remove, ruled D (retire) on objectstack-ai/cloud#2569: it was
   * parsed and never read — no runtime in this repository or in cloud moved an
   * agent through a declared state or refused an undeclared transition, and
   * every enforcement design measured there was a subset statechart
   * interpreter beside Flow, the two-engine shape ADR-0020 already rejected.
   * What it reached for is served elsewhere: a phase of a conversation is a
   * skill with its own `instructions` and `tools`, selected by
   * `triggerConditions` (ADR-0064); multi-step process orchestration is a Flow
   * (ADR-0019); a record's status transitions are the `state_machine`
   * validation rule (ADR-0020).
   *
   * Tombstoned rather than deleted, for the two channels `retiredKey()` gives
   * (`shared/retired-key.ts`): `tsc` refuses the key (its input type is
   * `never`), and the parse answers with the prescription rather than a bare
   * unrecognized-key error. This was the last authorable door to the XState
   * `StateMachineSchema` (`automation/state-machine.zod.ts`), which left with
   * it. The ADR-0087 conversion `agent-lifecycle-removed` deletes the key from
   * stored rows and existing sources.
   */
  lifecycle: retiredKey(
    '`agent.lifecycle` was removed in @objectstack/spec 17.7.0 (ADR-0049 enforce-or-remove) — '
    + 'no runtime ever read it: no agent moved through a declared state and no transition was '
    + 'ever refused. Delete the key. A phase of a conversation is a skill with its own '
    + '`instructions` and `tools`, selected by its `triggerConditions` (ADR-0064); multi-step '
    + 'process orchestration is a Flow (ADR-0019); a record\'s status transitions are a '
    + '`state_machine` validation rule on the object (ADR-0020). '
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.',
  ),

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
   * Tombstoned rather than deleted: `AgentSchema` is `strictObject`, so a plain
   * deletion would already REJECT the key — but only with a generic unknown-key
   * error. The prescription is the payload. An author who wrote `tools` has to
   * be told the specific thing this key's removal means: the capability moves
   * into a skill, and ADR-0064's union is the only path from an agent to a tool
   * — which this tombstone says and an unknown-key rejection cannot. It also
   * types the key `never`, so the same mistake fails `tsc` at the authoring site
   * before any parse runs. Those are the two channels an upgrading author, very
   * often an AI (ADR-0033), actually reads (`shared/retired-key.ts`).
   */
  tools: retiredKey(
    '`agent.tools` was removed in @objectstack/spec 17 — use `skills`. ' +
    'An agent reaches exactly the tools its surface-compatible skills declare ' +
    '(ADR-0064), so move each reference into a skill: a platform tool by its ' +
    'registered name, or `action_<name>` for one of your own AI-exposed Actions. ' +
    'This is NOT a rename — there is no key the value moves to: the migration ' +
    'DELETES the key and emits a notice naming each tool that was listed, and ' +
    'you re-declare each one in a skill by hand. ' +
    'ADR-0064 itself still reads `Proposed` and is cloud-owned — that scopes its ' +
    'RUNTIME half (tool resolution, which lives in cloud `service-ai`), not this ' +
    'rejection: the authoring invariant binds you here, and ADR-0109 ' +
    '(Accepted — implemented) is the in-repo record that carries it. ' +
    'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.',
  ),

  /** Knowledge */
  // `knowledge` REMOVED (#3896 audit close-out) — a GROUNDING claim nothing
  // enforced: the RAG path never reads the agent record; `search_knowledge`
  // takes `sourceIds` from the LLM's own tool-call arguments (cloud
  // knowledge-tools.ts:96). An author who "scoped" retrieval here scoped
  // nothing — the dangerous direction, same shape as tool.permissions.
  knowledge: retiredKey(
    '`agent.knowledge` was removed in @objectstack/spec 17.0.0 (audit close-out) — ' +
    'declaring knowledge sources/indexes on an agent never scoped retrieval: the ' +
    "`search_knowledge` tool takes `sourceIds` from the LLM's tool-call arguments, not from " +
    'the agent record. Delete the block. Restrict retrieval at the knowledge-service / ' +
    'source level (per-source permissions), and describe intended grounding in ' +
    '`instructions` so the model asks for the right sources. ' +
    'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.',
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
        '`shortTerm` was removed (ADR-0013 D3) — it declared a working-memory '
        + 'window nothing in the runtime consumed. Cross-turn grounding comes from tools reading '
        + 'live state, and the context budget is governed by the per-request token guardrail, '
        + 'not by this block. Delete it.',
    },
  }, {
    // NOTE: `shortTerm` ({maxMessages,maxTokens}) was removed (ADR-0013 D3,
    // cloud#339). It declared a working-memory window that NOTHING in the
    // runtime consumed — a config that lies. Cross-turn grounding is done by
    // tools reading live state, and the context budget is governed elsewhere
    // (the per-request token guardrail), not by this field.
    //
    // `longTerm` / `reflectionInterval` are ENFORCED, by the cloud AI runtime
    // (its `compileAgentMemory` reader, #20274): the newest `maxEntries`
    // distilled notes for the user and agent are recalled before the first
    // round, every `reflectionInterval` delivered interactions one reflection
    // writes a note, and notes beyond `maxEntries` are evicted. The contract
    // states exactly that and nothing more (ADR-0049, ruling record
    // 5950198150, letter A′): both numbers are REQUIRED once `longTerm.enabled`
    // is true, with no default declared — see `checkAgentMemoryContract` — and
    // the storage backend is not agent metadata: `longTerm.store` is
    // tombstoned below.

    /** Long-term memory: distilled notes kept per user and agent. */
    longTerm: strictObject({
      surface: 'this long-term memory configuration',
      history: AGENT_HISTORY,
      aliases: { limit: 'maxEntries', maxItems: 'maxEntries', active: 'enabled' },
      // `backend` / `storage` / `provider` used to be aliases steering onto
      // `store`. An alias may not target a tombstone (an author told to write
      // the key guaranteed to be refused next), so the three spellings carry
      // the same answer as the tombstone instead.
      guidance: {
        backend: LONG_TERM_STORE_SPELLING_RETIRED,
        storage: LONG_TERM_STORE_SPELLING_RETIRED,
        provider: LONG_TERM_STORE_SPELLING_RETIRED,
      },
    }, {
      /** Whether long-term memory is enabled. When true, `maxEntries` and `memory.reflectionInterval` are required. */
      enabled: z.boolean().default(false).describe(
        'Enable long-term memory. When true, maxEntries and memory.reflectionInterval are required',
      ),

      /**
       * REMOVED — the storage backend. The memory store is platform
       * infrastructure, not agent metadata: the cloud AI runtime keeps the
       * notes in its own database store and refused the `vector` default and
       * `redis` before an agent's first turn. The ADR-0087 conversion
       * `agent-memory-long-term-store-removed` deletes the key from existing
       * sources and stored rows.
       */
      store: retiredKey(LONG_TERM_STORE_RETIRED),

      /**
       * How many distilled notes are kept and recalled for each user: the
       * newest `maxEntries` are recalled before the first round, and notes
       * beyond it are evicted. Required when `enabled` is true.
       */
      maxEntries: z.number().int().min(1).optional().describe(
        'How many distilled notes are kept per user: the newest N are recalled before the first round, and notes beyond N are evicted. Required when enabled is true',
      ),
    }).optional().describe('Long-term memory: distilled notes kept per user and agent and recalled before each conversation'),

    /**
     * How many delivered interactions pass between reflections. Each
     * reflection writes one distilled note to long-term memory. Required when
     * `longTerm.enabled` is true, and refused without it.
     */
    reflectionInterval: z.number().int().min(1).optional().describe(
      'Reflect every N delivered interactions: each reflection writes one distilled note to long-term memory. Required when longTerm.enabled is true, and refused without it',
    ),
  }).superRefine(checkAgentMemoryContract).optional().describe(
    'Agent memory (long-term notes recalled before each conversation and written by periodic reflection), enforced by the cloud AI runtime; the open framework edition does not run agents.',
  ),

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

    /**
     * Topics or actions the agent must avoid. The cloud AI runtime matches each
     * entry exactly and case-sensitively against the tool name, against
     * `action_` plus the action type, and against the tool category.
     */
    blockedTopics: z.array(z.string()).optional().describe(
      'Forbidden topics or action names: each entry is an exact, case-sensitive match on the tool name, on `action_` plus the action type, or on the tool category',
    ),
  }).optional().describe('Safety guardrails for the agent (token budget, time limit, blocked topics), enforced per user turn by the cloud AI runtime; the open framework edition does not run agents.'),

  /** Structured Output */
  structuredOutput: StructuredOutputConfigSchema.optional().describe('Structured output contract for the agent\'s final answer (JSON format, schema, retries, fallback format, transform steps), enforced on every final answer by the cloud AI runtime; the open framework edition does not run agents.'),
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
