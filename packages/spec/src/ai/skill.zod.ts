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
// ⚠️ Position matters: `build-docs.ts` takes the FIRST docblock in the file as
// this module's blurb in `content/docs/references/ai/skill.mdx`. Keep the module
// summary above the per-export docs below, or the reference page leads with
// whichever export happens to be declared first (#7113).
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { retiredKey } from '../shared/retired-key';

/**
 * The trigger-condition operators whose `value` is a LIST rather than a scalar
 * (#7113).
 *
 * These are the membership tests: `SkillRegistry.evaluateCondition` (cloud
 * `packages/service-ai/src/skill-registry.ts`) answers them with
 * `list.includes(fieldValue)`, so the authored `value` IS the list. Exported so
 * a producer — a skill designer's condition editor, a generator, a test —
 * asks the question the schema asks instead of hard-coding its own copy of the
 * vocabulary. Same reasoning, and the same naming, as
 * `VIEW_FILTER_LIST_VALUE_OPERATORS` (#6227, `ui/view.zod.ts`).
 */
export const SKILL_TRIGGER_LIST_VALUE_OPERATORS = ['in', 'not_in'] as const;

/**
 * The trigger-condition operators whose `value` is a SCALAR (#7113).
 *
 * `eq` / `neq` are answered by `fieldValue === expected` / `!==` in the cloud
 * consumer. An array comparand there is not a stricter predicate, it is a DEAD
 * one: JavaScript `===` on an array is reference identity, and the context
 * value is never that same reference — so `eq` with an array is always false
 * and `neq` with an array is always true, whatever the context holds.
 *
 * Deliberately does NOT include `contains` — see
 * {@link checkSkillTriggerConditionValueShape}.
 */
export const SKILL_TRIGGER_SCALAR_VALUE_OPERATORS = ['eq', 'neq'] as const;

/** `a string` / `an array of 3` / `null` … — the word the refusal uses. */
function describeConditionValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'no value';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return `a ${typeof value}`;
}

/** A short, bounded rendering of the offending value — a refusal, not a dump. */
function previewConditionValue(value: unknown): string {
  if (value === undefined) return '(omitted)';
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * [#7113] A trigger condition's `value` must have the shape its OPERATOR reads.
 *
 * ## What was wrong
 *
 * `operator` and `value` were declared independently — `z.enum([...])` beside
 * `z.union([z.string(), z.array(z.string())])` — so every operator accepted
 * every shape. `{ field: 'userRole', operator: 'in', value: 'admin' }` was a
 * spec-valid skill trigger: a membership test whose list is not a list. This is
 * the dormant twin of #6227 on `ViewFilterRuleSchema`, and the fix mirrors that
 * one (PR #7114) key for key.
 *
 * ## Why it is the DORMANT twin — and why it is still worth closing
 *
 * #6227's shape genuinely fails at query time (`assertListComparandShapes`,
 * 400 `INVALID_FILTER`), which made it a two-stage failure. This one does not
 * fail at all: the sole consumer,
 * `SkillRegistry.evaluateCondition` (cloud `packages/service-ai/src/skill-registry.ts`),
 * coerces the scalar itself —
 *
 * ```ts
 * case 'in': {
 *   const list = Array.isArray(expected) ? expected : [expected];
 *   return list.includes(fieldValue as string);
 * }
 * ```
 *
 * — so nothing 400s and the predicate evaluates the way the author meant. What
 * is being closed is therefore not a break but a SECOND DIALECT: a
 * consumer-side lenient coercion standing in for a contract the producer never
 * declared, on a surface whose authors are increasingly AI-generated, where
 * "declared = enforced" is what keeps generated metadata honest.
 *
 * That coercion becomes a **no-op** once this tightening ships: no
 * schema-valid condition can reach it carrying a scalar on `in` / `not_in`
 * again. Removing it is deliberately NOT part of this change —
 * contract-first sequencing, the producer moves first — and is filed as a
 * follow-up in the cloud repo.
 *
 * ## `contains` is deliberately left accepting BOTH shapes
 *
 * The check refuses exactly what the consumer cannot meaningfully execute, and
 * nothing more (#5685: a schema stricter than its runtime is the wrong side of
 * the fix — the same line #6227's pins hold). `contains` has TWO live branches
 * in `evaluateCondition`, not one:
 *
 * - string context value + string comparand → substring test;
 * - **array** context value + **array** comparand → `expected.every(v => fieldValue.includes(v))`,
 *   a real subset test. `SkillContext` is `{ [extraField: string]: unknown }`,
 *   so an array-valued context field is a shape the runtime is written for.
 *
 * Constraining `contains` to `z.string()` would therefore un-declare a working
 * capability, which is a retirement decision (ADR-0049) and not a rider on a
 * shape fix. `in` / `not_in` / `eq` / `neq` have no such branch — see the two
 * exported vocabularies above.
 *
 * ## Why `superRefine` and not `z.discriminatedUnion`
 *
 * Same three reasons measured for the #6227 twin: a refinement adds no
 * JSON-Schema structure (`ai/Skill` is a published def, and a union would fan
 * one def into N branches re-declaring the same three keys), it emits ONE issue
 * at path `['value']` naming the operator rather than blaming the
 * discriminator for a defect in `value`, and in Zod 4 it lives inside the
 * schema so `.shape` and the `ZodObject` class survive for every carrier —
 * here `z.array(SkillTriggerConditionSchema)` on `Skill.triggerConditions`.
 */
function checkSkillTriggerConditionValueShape(
  condition: { field?: unknown; operator?: unknown; value?: unknown },
  ctx: z.RefinementCtx,
): void {
  const operator = condition.operator as string;
  const value = condition.value;
  const field = typeof condition.field === 'string' ? condition.field : '<field>';

  const isList = (SKILL_TRIGGER_LIST_VALUE_OPERATORS as readonly string[]).includes(operator);
  const isScalar = (SKILL_TRIGGER_SCALAR_VALUE_OPERATORS as readonly string[]).includes(operator);

  if (isList) {
    if (Array.isArray(value)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message:
        `Operator "${operator}" on field "${field}" requires an ARRAY of values. `
        + `Received ${describeConditionValue(value)} (${previewConditionValue(value)}). `
        + `"${operator}" tests membership of a list — write `
        + `${value === undefined ? '["…"]' : previewConditionValue([value])} for a single value, `
        + `or use "${operator === 'in' ? 'eq' : 'neq'}" to compare against it. `
        + `An empty list [] is allowed and is a real predicate. The cloud agent runtime `
        + `coerces the scalar today; the contract never declared that spelling (#7113).`,
    });
    return;
  }

  if (!isScalar) return;
  if (!Array.isArray(value)) return;
  ctx.addIssue({
    code: 'custom',
    path: ['value'],
    message:
      `Operator "${operator}" on field "${field}" requires a single STRING value. `
      + `Received ${describeConditionValue(value)} (${previewConditionValue(value)}). `
      + `"${operator}" is an identity comparison, so an array can never match a context `
      + `field and the condition would ${operator === 'eq' ? 'never' : 'always'} fire — `
      + `use "${operator === 'eq' ? 'in' : 'not_in'}" to test membership of that list (#7113).`,
  });
}

/**
 * A programmatic condition under which a skill becomes active — one
 * `{ field, operator, value }` triple, ANDed with its siblings.
 *
 * `value`'s shape is coupled to `operator` (#7113, mirroring #6227):
 *
 * | operator | `value` must be |
 * |---|---|
 * | `in` / `not_in` ({@link SKILL_TRIGGER_LIST_VALUE_OPERATORS}) | an array, any length |
 * | `eq` / `neq` ({@link SKILL_TRIGGER_SCALAR_VALUE_OPERATORS}) | a string |
 * | `contains` | either — both spellings execute (see {@link checkSkillTriggerConditionValueShape}) |
 */
export const SkillTriggerConditionSchema = lazySchema(() => z.object({
  /** Condition field (e.g. 'objectName', 'userRole', 'channel') */
  field: z.string().describe('Context field to evaluate'),

  /** Comparison operator */
  operator: z.enum(['eq', 'neq', 'in', 'not_in', 'contains']).describe('Comparison operator'),

  /** Expected value(s) — an array for `in`/`not_in`, a string for `eq`/`neq` */
  value: z.union([z.string(), z.array(z.string())]).describe('Expected value or values'),
}).superRefine(checkSkillTriggerConditionValueShape));

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
