// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/node-executor
 *
 * Node Executor Plugin Protocol — Wait Node Pause/Resume
 *
 * Defines the specification for node executor plugins, with a focus on
 * the `wait` node executor that supports flow pause and external-event
 * resume (signal, manual, webhook, condition).
 *
 * The protocol covers:
 * - **WaitResumePayload**: The payload delivered when a paused flow is resumed
 * - **WaitExecutorConfig**: Configuration for the wait executor plugin
 * - **NodeExecutorDescriptor**: Generic node executor plugin descriptor
 */

import { z } from 'zod';

// ─── Wait Event Types ────────────────────────────────────────────────

/**
 * Wait event type — determines how a wait node is resumed.
 * Mirrors the `waitEventConfig.eventType` in flow.zod.ts.
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
export const WaitEventTypeSchema = lazySchema(() => z.enum([
  'timer',      // Resume after duration/datetime
  'signal',     // Resume on named signal dispatch
  'webhook',    // Resume on incoming webhook call
  'manual',     // Resume by manual operator action
  'condition',  // Resume when a data condition is met (polling)
]).describe('Wait event type determining how a paused flow is resumed'));

export type WaitEventType = z.input<typeof WaitEventTypeSchema>;

// ─── Wait Resume Payload ─────────────────────────────────────────────

/**
 * Payload delivered when a paused wait node is resumed by an external event.
 * The runtime engine passes this to the flow executor to continue execution.
 */
export const WaitResumePayloadSchema = lazySchema(() => z.object({
  /** The execution id of the paused flow */
  executionId: z.string().describe('Execution ID of the paused flow'),

  /** The checkpoint id being resumed */
  checkpointId: z.string().describe('Checkpoint ID to resume from'),

  /** The node id of the wait node being resumed */
  nodeId: z.string().describe('Wait node ID being resumed'),

  /** The event type that triggered the resume */
  eventType: WaitEventTypeSchema.describe('Event type that triggered resume'),

  /** Signal name (for signal events) */
  signalName: z.string().optional().describe('Signal name (when eventType is signal)'),

  /** Webhook payload data (for webhook events) */
  webhookPayload: z.record(z.string(), z.unknown()).optional()
    .describe('Webhook request payload (when eventType is webhook)'),

  /** Who/what triggered the resume */
  resumedBy: z.string().optional().describe('User ID or system identifier that triggered resume'),

  /** Timestamp of the resume event */
  resumedAt: z.string().datetime().describe('ISO 8601 timestamp of the resume event'),

  /** Additional variables to merge into flow context on resume */
  variables: z.record(z.string(), z.unknown()).optional()
    .describe('Variables to merge into flow context upon resume'),
}).describe('Payload for resuming a paused wait node'));

export type WaitResumePayload = z.input<typeof WaitResumePayloadSchema>;

// ─── Wait Executor Config ────────────────────────────────────────────

/**
 * Timeout behavior when a wait node exceeds its timeout.
 */
export const WaitTimeoutBehaviorSchema = lazySchema(() => z.enum([
  'fail',       // Mark execution as failed
  'continue',   // Continue to next node (skip wait)
  'fallback',   // Execute a fallback edge
]).describe('Behavior when a wait node exceeds its timeout'));

export type WaitTimeoutBehavior = z.input<typeof WaitTimeoutBehaviorSchema>;

/**
 * Configuration for the wait node executor plugin.
 * Controls polling intervals, webhook endpoint patterns, and timeout behavior.
 */
export const WaitExecutorConfigSchema = lazySchema(() => z.object({
  /** Default timeout for wait nodes without explicit timeout (ms) */
  defaultTimeoutMs: z.number().int().min(0).default(86400000)
    .describe('Default timeout in ms (default: 24 hours)'),

  /** Default timeout behavior */
  defaultTimeoutBehavior: WaitTimeoutBehaviorSchema.default('fail')
    .describe('Default behavior when wait timeout is exceeded'),

  /** Polling interval for condition-based waits (ms) */
  conditionPollIntervalMs: z.number().int().min(1000).default(30000)
    .describe('Polling interval for condition waits in ms (default: 30s)'),

  /** Maximum polling attempts for condition waits (0 = unlimited until timeout) */
  conditionMaxPolls: z.number().int().min(0).default(0)
    .describe('Max polling attempts for condition waits (0 = unlimited)'),

  /** Webhook endpoint URL pattern (runtime fills in execution/node ids) */
  webhookUrlPattern: z.string().default('/api/v1/automation/resume/{executionId}/{nodeId}')
    .describe('URL pattern for webhook resume endpoints'),

  /** Whether to persist checkpoints to durable storage */
  persistCheckpoints: z.boolean().default(true)
    .describe('Persist wait checkpoints to durable storage'),

  /** Maximum concurrent paused executions (0 = unlimited) */
  maxPausedExecutions: z.number().int().min(0).default(0)
    .describe('Max concurrent paused executions (0 = unlimited)'),
}).describe('Wait node executor plugin configuration'));

export type WaitExecutorConfig = z.input<typeof WaitExecutorConfigSchema>;
/** Post-parse shape of {@link WaitExecutorConfig} — defaults applied, transforms run (ADR-0122). */
export type WaitExecutorConfigParsed = z.infer<typeof WaitExecutorConfigSchema>;

// ─── Node Executor Descriptor ────────────────────────────────────────

/**
 * Generic node executor plugin descriptor.
 * Each node type (wait, script, http, etc.) can register
 * a custom executor via this descriptor.
 */
export const NodeExecutorDescriptorSchema = lazySchema(() => z.object({
  /** Unique executor identifier */
  id: z.string().describe('Unique executor plugin identifier'),

  /** Human-readable name */
  name: z.string().describe('Display name'),

  /** The FlowNodeAction types this executor handles */
  nodeTypes: z.array(z.string()).min(1)
    .describe('FlowNodeAction types this executor handles'),

  /** Executor plugin version (semver) */
  version: z.string().describe('Plugin version (semver)'),

  /** Description of the executor */
  description: z.string().optional().describe('Executor description'),

  /** Whether this executor supports async pause/resume */
  supportsPause: z.boolean().default(false)
    .describe('Whether the executor supports async pause/resume'),

  /** Whether this executor supports cancellation mid-execution */
  supportsCancellation: z.boolean().default(false)
    .describe('Whether the executor supports mid-execution cancellation'),

  /** Whether this executor supports retry on failure */
  supportsRetry: z.boolean().default(true)
    .describe('Whether the executor supports retry on failure'),

  /** Executor-specific configuration schema (JSON Schema reference) */
  configSchemaRef: z.string().optional()
    .describe('JSON Schema $ref for executor-specific config'),
}).describe('Node executor plugin descriptor'));

export type NodeExecutorDescriptor = z.input<typeof NodeExecutorDescriptorSchema>;
/** Post-parse shape of {@link NodeExecutorDescriptor} — defaults applied, transforms run (ADR-0122). */
export type NodeExecutorDescriptorParsed = z.infer<typeof NodeExecutorDescriptorSchema>;

// ─── Action Descriptor (ADR-0018, canonical) ─────────────────────────

/**
 * Action category — used by the designer to group the palette and by the
 * runtime to apply category-wide policy (e.g. `human` actions are always
 * async / suspend the flow).
 */
export const ActionCategorySchema = lazySchema(() => z.enum([
  'logic',    // decision / assignment / loop / gateways
  'data',     // CRUD on records
  'io',       // outbound calls — http / notify / connector
  'human',    // screen / user_task — suspends awaiting human input
  'control',  // start / end / wait / subflow
  'custom',   // plugin-defined, uncategorised
]).describe('Action palette category'));

export type ActionCategory = z.input<typeof ActionCategorySchema>;

/**
 * Authoring surfaces that may offer an action. A descriptor opts into the
 * paradigms whose users should see it in their palette.
 */
export const ActionParadigmSchema = lazySchema(() => z.enum([
  'flow',           // visual Flow canvas
  'approval',       // Approval flow-node steps
  // 'workflow_rule' retired (ADR-0018 M5 dropped; see ADR-0019): workflow rules
  // were removed in #1398 and `workflow` was reclaimed for state machines, so
  // there is no declarative rule authoring view to compile to Flow.
]).describe('Authoring paradigm that may offer this action'));

export type ActionParadigm = z.input<typeof ActionParadigmSchema>;

/**
 * Canonical, cross-paradigm **Action descriptor** (ADR-0018 §1).
 *
 * This is the single source of truth for "what a node/action is" — the
 * shape a plugin publishes when it registers an executor. It supersedes the
 * closed enums (`FlowNodeAction`, `WorkflowAction`), which become *seed*
 * descriptor sets registered at boot. (ADR-0019 removed the third such enum,
 * `ApprovalActionType`, along with the standalone approval authoring type.)
 *
 * The runtime registry (`AutomationEngine.getActionDescriptors()`) aggregates
 * these and backs both:
 *  - **flow validation** — `registerFlow()` checks `node.type` is a registered
 *    action, and validates the expression slots the descriptor declares (see
 *    {@link configSchema} for exactly how far that goes), and
 *  - the **designer palette** (label / icon / category / config form).
 *
 * Keyed by `type` (not `id` + `nodeTypes` like the legacy
 * {@link NodeExecutorDescriptorSchema}) so that one descriptor maps to exactly
 * one registry node type — the unit the engine dispatches on.
 */
export const ActionDescriptorSchema = lazySchema(() => z.object({
  // ── identity ──────────────────────────────────────────────────────
  /** Registry node type — matches the executor's `type`. */
  type: z.string().min(1).describe('Registry action/node type (matches the executor type)'),
  /** Executor version (semver). */
  version: z.string().describe('Executor version (semver)'),
  /** Human-readable label (may be an i18n key). */
  name: z.string().describe('Display label (or i18n key)'),
  /** Longer description for the palette / docs. */
  description: z.string().optional().describe('Action description'),

  // ── palette presentation ──────────────────────────────────────────
  /** Icon id resolved by the designer. */
  icon: z.string().optional().describe('Icon id resolved by the designer'),
  /** Palette grouping. */
  category: ActionCategorySchema.default('custom').describe('Palette category'),
  /** Which authoring surfaces may offer this action. */
  paradigms: z.array(ActionParadigmSchema).default(['flow'])
    .describe('Authoring surfaces that may offer this action'),

  // ── config contract ───────────────────────────────────────────────
  /**
   * JSON Schema (compiled from the executor's Zod) describing the node
   * `config`. Drives Studio form generation. Optional — actions with no config
   * omit it.
   *
   * **What actually validates against this, and what does not** (#4027,
   * tightened by #4277). `FlowNodeSchema.config` is `z.record(z.unknown())`,
   * so the flow-level parse never types a node's config — enforcement is
   * layered on top:
   *
   *  - **Unknown keys are rejected at `registerFlow()`** (#4277, tightening
   *    the #4059 warning): a config key this schema does not declare fails
   *    registration with the path, the declared key set, a did-you-mean, and
   *    a per-key tombstone where one exists. The walk stops at keyValue maps
   *    (`additionalProperties: true` — those keys are author data) and
   *    exempts `assignment` wholesale (its top-level keys ARE the author's
   *    variable names).
   *  - **Expression slots are validated.** Every property marked
   *    `xExpression: 'expression'` (bare CEL) is parse-checked at `registerFlow()`
   *    and by `objectstack validate`, via the `FLOW_NODE_EXPRESSION_PATHS` ledger
   *    and its reconciliation ratchet — so a declared predicate cannot go
   *    unvalidated the way `screen.fields[].visibleWhen` did for four months
   *    (#3528). Slots marked `xExpression: 'template'` are recorded but not
   *    checked: no validator implements the single-brace `{var}` dialect they use.
   *  - **Types and `required` are enforced at execute time for the
   *    contract-carrying builtins** (#4277): those executors `parse()` their
   *    config against the Zod contracts in `io-node-config.zod.ts` /
   *    `builtin-node-config.zod.ts` / `control-flow.zod.ts`, refusing the node
   *    (guard, not routable) on violation. For a plugin-contributed executor
   *    this schema remains designer-facing — the plugin must still validate
   *    its own config, and SHOULD follow the same parse pattern.
   *
   * The schema is hand-written per executor rather than derived from the code
   * that reads `config`; the form↔Zod ledger tests in `service-automation`
   * reconcile the two for the builtins.
   */
  configSchema: z.unknown().optional()
    .describe('JSON Schema for the node config (drives the designer form; undeclared keys are rejected at registration)'),

  // ── capabilities ──────────────────────────────────────────────────
  /**
   * Supports async pause/resume (e.g. wait, human_task).
   *
   * **Declared = enforced, since #6667** (which closed the #5703 seam). This
   * was a declaration no execution path read until then; `AutomationEngine`
   * now enforces it at the ONE seam every suspension passes through, so the
   * three authoring-time consumers it always had — the designer palette, the
   * registration warning below, and the `check:resume-authority-declared`
   * gate — are no longer the whole of its effect.
   *
   * What the runtime half does, and the boundary #6667 drew deliberately:
   *
   *  - **Mismatch is refused.** A node type whose descriptor declares
   *    `supportsPause: false` — or OMITS the key, which parses to the same
   *    `false` by the default above — and whose executor returns
   *    `suspend: true` has that suspension REFUSED. It is a guard-class
   *    refusal: a metadata defect, not a runtime one, so a `fault` edge does
   *    not route it, and nothing durable is written for a pause nothing could
   *    have continued (a type declaring no pause declares no `resumeAuthority`
   *    either, and an unclaimed pause is fail-closed since #5561).
   *  - **The inverse is legal.** `supportsPause: true` on a type that never
   *    suspends is not a mismatch — the declaration is a CAPABILITY, not an
   *    obligation. `wait` legitimately returns without suspending when its
   *    condition is already met.
   *  - **Silence is not `false`.** An executor that publishes NO descriptor
   *    declares nothing for this gate to enforce (`NodeExecutor.descriptor` is
   *    optional by contract), so its pauses are not refused here; they stay
   *    governed by #5561's resume gate, which refuses an undeclared
   *    `resumeAuthority` at the resume end instead.
   *
   * Alias hop included: the descriptor consulted is the canonical one a
   * deprecated ADR-0018 alias forwards to, never the synthesized alias
   * descriptor carrying schema defaults.
   */
  supportsPause: z.boolean().default(false).describe('Supports async pause/resume'),
  /** Supports mid-execution cancellation. */
  supportsCancellation: z.boolean().default(false).describe('Supports cancellation'),
  /** Supports retry on failure. */
  supportsRetry: z.boolean().default(true).describe('Supports retry on failure'),
  /** Dispatch through the ADR-0012 service-messaging outbox. */
  needsOutbox: z.boolean().default(false)
    .describe('Dispatch via service-messaging outbox (retry/idempotency/dead-letter)'),
  /**
   * Tombstoned, not deleted (ADR-0104): `ActionDescriptorSchema` is not
   * `.strict()`, so a plain deletion would let the five shipped descriptors —
   * and every third-party one — keep writing `isAsync`, parse clean, and lose
   * the value in silence. `retiredKey()` turns that into a rejection carrying
   * the fix, in both channels a descriptor author meets: `tsc` (the input type
   * is `never`) and the parse `defineActionDescriptor()` runs.
   *
   * Retired under ADR-0049 enforce-or-remove (#6748): a fresh three-repo
   * measurement found ZERO readers. `isAsync` was a second, weaker spelling of
   * the thing `supportsPause` above now enforces — and where `supportsPause`
   * grew a runtime consumer in #6667, this one never had one to grow into, so
   * it took the remove leg of the same ruling rather than the enforce leg.
   */
  isAsync: retiredKey(
    '`ActionDescriptor.isAsync` was removed in @objectstack/spec 17 (#6748, ADR-0049) — ' +
    'no execution path ever read it, so declaring it never made a node suspend and ' +
    'omitting it never stopped one. Delete the key. The live mechanism is two-part: an ' +
    'executor suspends by RETURNING `suspend: true` from `execute()`, and its descriptor ' +
    'must declare `supportsPause: true` (plus the `resumeAuthority` its pauses need) or ' +
    'the engine refuses that suspension (#6667). Declaring `isAsync: true` alongside ' +
    '`supportsPause: true` was always redundant; declaring it alone was always inert.',
  ),

  /**
   * The effect contract this action places on the AUTHOR-SUPPLIED code it
   * invokes (#4396).
   *
   *  - `'none'` (default) — the action invokes no author code, so there is no
   *    such contract to state. Nearly every action.
   *  - `'pure'` — it does, and that code must not perform data I/O: it takes
   *    its inputs, RETURNS a value, and a later DECLARATIVE node persists the
   *    result. `script` is the built-in that declares this, and the rule is
   *    load-bearing rather than stylistic — the node reports no record metrics
   *    precisely because every write it causes is a downstream `create_record`
   *    / `update_record` counting itself (#4354). A function that writes anyway
   *    makes its run under-report.
   *
   * It is declared HERE because the alternative — the state this field was
   * added to leave — was a rule visible only inside the executor's own source:
   * `category: 'logic'` said nothing about it, so no author, lint or designer
   * could read the contract the run summary was relying on. A function that
   * legitimately writes says so on its own registration
   * (`FlowFunctionEffectSchema`, `defineStack({ functions })`) and its step is
   * then counted as `unmeasuredEffect` rather than as nothing.
   *
   * Declaration, not enforcement: author code can close over a data client at
   * module scope, and no descriptor field stops that.
   */
  handlerContract: z.enum(['none', 'pure']).default('none')
    .describe("Effect contract for author-supplied code this action invokes: 'none' (invokes none) or 'pure' (must not write — it returns a value and the flow graph persists it)"),

  /**
   * WHO may resume a run this node suspended (#3801). The generic resume
   * route (`POST /automation/:name/runs/:runId/resume`) validates machine
   * state only — the run exists, the flow exists, the suspended node still
   * exists — so the node type that *produced* the pause is what decides
   * whether a raw resume is a legitimate continuation or a bypass.
   *
   *  - `'any'` — the caller supplies the continuation and the route is the
   *    intended door: a `screen` node's collected inputs, a `wait` node's
   *    external signal. **A pausing node must opt into this explicitly**; see
   *    the omission semantics below.
   *  - `'service'` — resuming is a SIDE EFFECT of a decision some service must
   *    authorize and record first, so only that service may drive it. An
   *    `approval` node declares this: `ApprovalService.decide` enforces the
   *    approver slate, writes the `sys_approval_action` row and mirrors the
   *    status field, then resumes. A raw resume around it would walk the
   *    `approve` edge with no decision recorded, leaving the request row and
   *    the run permanently disagreeing.
   *
   * The engine enforces it: a resume of a `'service'` suspension is refused
   * unless the signal carries the in-process `RESUME_AUTHORITY_SERVICE`
   * marker — a symbol, so a JSON body can never carry it.
   *
   * **Omitting it means `'service'` — fail-closed, not `'any'`** (ADR-0044's
   * 2026-07-28 amendment, landed in two steps on #5561). A pausing node type
   * that never states who may continue its pauses is closed to the generic
   * resume route until its author states it: `AutomationEngine` resolves an
   * absent value to `'service'` (`resolveResumeAuthority`), so a raw resume of
   * such a pause answers `PERMISSION_DENIED` with a message naming the
   * one-line fix. **Registering a pausing node whose pause really is open to
   * the route? Declare `resumeAuthority: 'any'` — it is an opt-in now, not an
   * inheritance.**
   *
   * The field carries no Zod `.default()`, and that is what makes the rule
   * expressible at all (step one, #5561). A default would make "the author
   * decided `'any'`" and "the author never considered it" the same value by the
   * time any consumer sees the descriptor: Zod fills the key inside
   * {@link defineActionDescriptor}, so the omission became unrecoverable one
   * function call after it happened — measured, not assumed (the two parses
   * were byte-identical). That erasure is how #3823 shipped: ADR-0044 pointed a
   * revise edge at a generic `wait`, `wait` is legitimately `'any'`, and a
   * pause standing in a service-owned position inherited a fail-open value
   * nobody had chosen. Absent now means absent, and three seams read it —
   * `AutomationEngine.registerNodeExecutor` warns once per node type when a
   * `supportsPause` descriptor omits it, the resume gate refuses the pauses it
   * produces, and `check:resume-authority-declared` fails CI on an omission in
   * this repo's own executors.
   *
   * The guess is made in the loud direction on purpose. Guessing `'any'` for an
   * unclaimed pause continues a run past a decision nothing recorded and says
   * nothing; guessing `'service'` refuses a resume and hands back the
   * declaration that fixes it. Only one of those two mistakes is discoverable
   * by the person who made it.
   */
  resumeAuthority: z.enum(['any', 'service']).optional()
    .describe("Who may resume a run this node suspended: 'any' (the generic resume route) or 'service' (only the owning service, e.g. approvals). Carries no schema default so an omission stays observable — and an omission is fail-CLOSED at run time, equivalent to 'service': a pausing node whose pause is open to the generic route must declare 'any' explicitly (#5561)"),

  /**
   * Runtime maturity of the capability behind this descriptor (ADR-0041 §4).
   * The platform routinely ships contracts ahead of runtimes; `reserved`
   * marks a surface whose runtime has NOT shipped, so designers (Studio)
   * can render it visible-but-disabled instead of letting authors build on
   * something that silently never runs.
   */
  maturity: z.enum(['ga', 'beta', 'reserved']).default('ga')
    .describe('Runtime maturity: ga (shipped), beta, or reserved (contract only — designers grey this out)'),

  // ── provenance ────────────────────────────────────────────────────
  /**
   * Whether this action ships with the platform (`builtin`, seeded by the
   * automation core) or is contributed by a third-party plugin (`plugin`).
   * Built-in actions are the platform's foundational vocabulary; plugins
   * extend it (ADR-0018 — open, marketplace-extensible registry).
   */
  source: z.enum(['builtin', 'plugin']).default('plugin')
    .describe('builtin = platform baseline; plugin = third-party contributed'),

  // ── lifecycle ─────────────────────────────────────────────────────
  /** Marks a retained-but-superseded type kept as a migration alias. */
  deprecated: z.boolean().default(false).describe('Deprecated alias kept for back-compat'),
  /** When deprecated, the type that supersedes this one. */
  aliasOf: z.string().optional().describe('Canonical type this alias forwards to'),
}).describe('Canonical cross-paradigm action/node descriptor (ADR-0018)'));

export type ActionDescriptor = z.input<typeof ActionDescriptorSchema>;
/** Post-parse shape of {@link ActionDescriptor} — defaults applied, transforms run (ADR-0122). */
export type ActionDescriptorParsed = z.infer<typeof ActionDescriptorSchema>;

/**
 * Type-safe factory for an {@link ActionDescriptor}. Validates and applies
 * schema defaults at creation time, so an executor can publish a descriptor
 * by stating only the fields it cares about:
 *
 * @example
 * ```ts
 * engine.registerNodeExecutor({
 *   type: 'decision',
 *   descriptor: defineActionDescriptor({
 *     type: 'decision', version: '1.0.0', name: 'Decision', category: 'logic',
 *   }),
 *   async execute(node, vars, ctx) { ... },
 * });
 * ```
 */
export function defineActionDescriptor(input: ActionDescriptor): ActionDescriptorParsed {
  return ActionDescriptorSchema.parse(input);
}

// ─── Built-in Wait Executor Descriptor ───────────────────────────────

/**
 * Built-in descriptor for the wait node executor.
 * Runtime implementations should register this or a compatible executor.
 */
export const WAIT_EXECUTOR_DESCRIPTOR: NodeExecutorDescriptor = {
  id: 'objectstack:wait-executor',
  name: 'Wait Node Executor',
  nodeTypes: ['wait'],
  version: '1.0.0',
  description: 'Pauses flow execution and resumes on timer, signal, webhook, manual action, or condition events.',
  supportsPause: true,
  supportsCancellation: true,
  supportsRetry: true,
};
