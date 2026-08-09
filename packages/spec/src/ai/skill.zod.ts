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
import { strictObject } from '../shared/strict-object';
import { retiredKey } from '../shared/retired-key';
export const SkillTriggerConditionSchema = lazySchema(() => z.object({
  /** Condition field (e.g. 'objectName', 'userRole', 'channel') */
  field: z.string().describe('Context field to evaluate'),

  /** Comparison operator */
  operator: z.enum(['eq', 'neq', 'in', 'not_in', 'contains']).describe('Comparison operator'),

  /** Expected value(s) */
  value: z.union([z.string(), z.array(z.string())]).describe('Expected value or values'),
}));

export type SkillTriggerCondition = z.input<typeof SkillTriggerConditionSchema>;

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
 * ## Where each half of a skill runs (#3905)
 *
 * ADR-0063 §2 makes skills the only third-party extension primitive, and the
 * open distribution is deliberately BYO-AI (cloud ADR-0025): it ships MCP, not
 * an in-product agent runtime. The two halves of a skill therefore reach very
 * different runtimes, and the schema says which is which rather than implying
 * both work everywhere:
 *
 * - **`instructions`** — served **everywhere**. `@objectstack/mcp` projects it
 *   onto the MCP `prompts` primitive, so any connected MCP client can
 *   `prompts/list` / `prompts/get` a skill authored in the open framework.
 * - **`tools` / `surface` / `triggerConditions`** — **cloud-runtime-only**.
 *   Tool binding and skill↔agent affinity are read by the in-product `ask` /
 *   `build` agent runtime, which ships in the cloud / Enterprise distribution.
 *   In the open framework there is no agent loop to bind tools to (the client's
 *   own model drives a flat MCP tool list), so these keys are authored for
 *   cloud and inert here. They are still validated — a skill naming a tool that
 *   does not exist is an authoring error in both distributions.
 *
 * NOTE — there is deliberately NO per-skill `permissions` field. Access to AI
 * capability is gated at the AGENT level (`agent.access` / `agent.permissions`,
 * both enforced at the chat route), and each tool enforces its own authz when
 * invoked. A `permissions` key authored on a skill is unknown to this schema
 * and silently stripped at parse time — it grants and restricts nothing
 * (ADR-0049: no unenforced security-shaped fields). Do not author one.
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
export const SkillSchema = lazySchema(() => strictObject({
  surface: 'this skill',
  history:
    'Until #4001 closed this shape these were dropped silently — the item still registered, minus whatever the key was meant to configure.',
  aliases: { prompt: 'instructions', content: 'instructions', body: 'instructions', tool: 'tools' },
  guidance: {
    // #5013 — `trigger` used to be an ALIAS pointing at `triggers`, a key this
    // schema has never declared: the author was told to write it, wrote it, and
    // was rejected a second time with no suggestion left to give.
    //
    // It is not repointed at `triggerConditions`, because a rename is the wrong
    // instrument here. The prescription the `triggerPhrases` tombstone below
    // carries is a SPLIT — routing intent goes to `triggerConditions`, natural
    // language to `description` / `instructions` — so an author who wrote
    // `trigger: 'create a case'` and took a rename would land a phrase in an
    // array-of-conditions slot and be rejected on the value instead of the key.
    // That is ledger finding 7 exactly: this campaign's own fix signposting the
    // way back into the failure mode it exists to kill.
    trigger:
      '`trigger` is not a skill key, and skills have never been activated by a phrase. '
      + 'Activation is `triggerConditions` (an AND of context field/operator/value) intersected '
      + "with the agent's `skills[]` allowlist, plus explicit /skill-name pinning. If you meant a "
      + 'programmatic condition, write `triggerConditions: [{ field: …, operator: …, value: … }]`; '
      + 'if you meant natural-language intent for the LLM to route on, that belongs in '
      + '`description` / `instructions`, which are the strings actually put in front of the model.',
    permissions:
      '`permissions` is not a skill key — skill invocation was never permission-gated, '
      + 'so this was stripped in silence and the author believed they had a gate. Gate at '
      + 'the AGENT instead (`access` / `permissions` on the agent, enforced since #1884), '
      + "or on the underlying tools' actions.",
  },
}, {
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
   * data-console surface.
   *
   * **CLOUD-RUNTIME-ONLY.** Both the `ask` and `build` in-product agent
   * runtimes ship in the cloud / Enterprise distribution (ADR-0025), and this
   * key is read only there — it is authoring metadata, not an edition gate.
   * The open framework has no agent to bind to; what it serves from a skill is
   * `instructions`, as an MCP prompt (#3905).
   */
  surface: z.enum(['ask', 'build', 'both']).default('ask').describe(
    "Agent surface this skill binds to ('ask' | 'build' | 'both') — ADR-0063 §3; read by the cloud agent runtime only",
  ),

  /**
   * Instructions injected into the system prompt when this skill is active.
   * Guides the LLM on how and when to use the skill's tools.
   *
   * The half of a skill that runs in **every** distribution (#3905). On the
   * cloud agent runtime it is injected into the active agent's system prompt;
   * in the open framework `@objectstack/mcp` projects it onto the MCP `prompts`
   * primitive, so a connected client can list this skill by name and fetch this
   * text. A skill with no `instructions` has nothing to project and is not
   * listed as a prompt at all.
   */
  instructions: z.string().optional().describe('LLM instructions when skill is active — also served as an MCP prompt (#3905)'),

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
   *
   * **CLOUD-RUNTIME-ONLY** (#3905). Tool binding is consumed by the in-product
   * agent runtime, which composes an agent's tool set from its
   * surface-compatible skills. Over MCP the model lives client-side and the
   * server exposes one flat tool list, so there is nothing here to bind: an
   * AI-exposed Action is already reachable as `action_<name>` through
   * `list_actions` / `run_action`. The references are still checked at
   * authoring time in both distributions (`ai-skill-tool-unresolved`).
   */
  tools: z.array(z.string().regex(/^[a-z_][a-z0-9_]*\*?$/)).describe('Tool names belonging to this skill (supports trailing wildcard, e.g. `action_*`) — bound by the cloud agent runtime only'),

  /**
   * Natural language phrases that trigger skill activation.
   * Used for intent matching and skill routing.
   */
  // `triggerPhrases` REMOVED (#3896 audit close-out): phrases were NEVER
  // matched against the user's message — activation is `triggerConditions` ∩
  // the agent's `skills[]` allowlist (+ explicit /skill-name pinning). The
  // cloud API served the field back to clients, a dead-end projection that
  // made the false capability look extra real.
  triggerPhrases: retiredKey(
    '`skill.triggerPhrases` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) ' +
    "— phrases were never matched against the user's message; skill activation is " +
    "`triggerConditions` (AND of context field/operator/value) intersected with the agent's " +
    '`skills[]`, plus explicit /skill-name pinning. Delete the key. Put routing intent in ' +
    '`triggerConditions`; describe intent in `description`/`instructions` for the LLM. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),

  /**
   * Programmatic conditions for skill activation.
   * Evaluated against the runtime context (object name, user role, etc.).
   *
   * **CLOUD-RUNTIME-ONLY** (#3905) — activation is a property of an agent loop.
   * MCP has no server-side activation step: a client lists every projected
   * prompt and decides for itself which to fetch.
   */
  triggerConditions: z.array(SkillTriggerConditionSchema).optional().describe('Programmatic activation conditions — evaluated by the cloud agent runtime only'),

  /**
   * Whether the skill is enabled. Honoured in both distributions: an inactive
   * skill is dropped by the cloud skill registry and is not projected as an
   * MCP prompt (#3905).
   */
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

export type Skill = z.input<typeof SkillSchema>;
/** Post-parse shape of {@link Skill} — defaults applied, transforms run (ADR-0122). */
export type SkillParsed = z.infer<typeof SkillSchema>;

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
export function defineSkill(config: z.input<typeof SkillSchema>): SkillParsed {
  return SkillSchema.parse(config);
}
