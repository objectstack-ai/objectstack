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
export const WaitEventTypeSchema = lazySchema(() => z.enum([
  'timer',      // Resume after duration/datetime
  'signal',     // Resume on named signal dispatch
  'webhook',    // Resume on incoming webhook call
  'manual',     // Resume by manual operator action
  'condition',  // Resume when a data condition is met (polling)
]).describe('Wait event type determining how a paused flow is resumed'));

export type WaitEventType = z.infer<typeof WaitEventTypeSchema>;

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

export type WaitResumePayload = z.infer<typeof WaitResumePayloadSchema>;

// ─── Wait Executor Config ────────────────────────────────────────────

/**
 * Timeout behavior when a wait node exceeds its timeout.
 */
export const WaitTimeoutBehaviorSchema = lazySchema(() => z.enum([
  'fail',       // Mark execution as failed
  'continue',   // Continue to next node (skip wait)
  'fallback',   // Execute a fallback edge
]).describe('Behavior when a wait node exceeds its timeout'));

export type WaitTimeoutBehavior = z.infer<typeof WaitTimeoutBehaviorSchema>;

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

export type WaitExecutorConfig = z.infer<typeof WaitExecutorConfigSchema>;

// ─── Node Executor Descriptor ────────────────────────────────────────

/**
 * Generic node executor plugin descriptor.
 * Each node type (wait, script, http_request, etc.) can register
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

export type NodeExecutorDescriptor = z.infer<typeof NodeExecutorDescriptorSchema>;

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

export type ActionCategory = z.infer<typeof ActionCategorySchema>;

/**
 * Authoring surfaces that may offer an action. A descriptor opts into the
 * paradigms whose users should see it in their palette.
 */
export const ActionParadigmSchema = lazySchema(() => z.enum([
  'flow',           // visual Flow canvas
  'approval',       // Approval Process steps
  // 'workflow_rule' retired (ADR-0018 M5 dropped; see ADR-0019): Workflow Rules
  // were removed in #1398 and `workflow` was reclaimed for state machines, so
  // there is no declarative rule authoring view to compile to Flow.
]).describe('Authoring paradigm that may offer this action'));

export type ActionParadigm = z.infer<typeof ActionParadigmSchema>;

/**
 * Canonical, cross-paradigm **Action descriptor** (ADR-0018 §1).
 *
 * This is the single source of truth for "what a node/action is" — the
 * shape a plugin publishes when it registers an executor. It supersedes the
 * closed enums (`FlowNodeAction`, `WorkflowAction`), which become *seed*
 * descriptor sets registered at boot. (ADR-0019 removed the third such enum,
 * `ApprovalActionType`, along with the standalone approval process type.)
 *
 * The runtime registry (`AutomationEngine.getActionDescriptors()`) aggregates
 * these and backs both:
 *  - **flow validation** (`registerFlow()` checks `node.type` is a registered
 *    action, and that `config` satisfies `configSchema`), and
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
   * `config`. Drives Studio form generation and `registerFlow()` config
   * validation. Optional — actions with no config omit it.
   */
  configSchema: z.unknown().optional()
    .describe('JSON Schema for the node config (drives form + parse validation)'),

  // ── capabilities ──────────────────────────────────────────────────
  /** Supports async pause/resume (e.g. wait, human_task). */
  supportsPause: z.boolean().default(false).describe('Supports async pause/resume'),
  /** Supports mid-execution cancellation. */
  supportsCancellation: z.boolean().default(false).describe('Supports cancellation'),
  /** Supports retry on failure. */
  supportsRetry: z.boolean().default(true).describe('Supports retry on failure'),
  /** Dispatch through the ADR-0012 service-messaging outbox. */
  needsOutbox: z.boolean().default(false)
    .describe('Dispatch via service-messaging outbox (retry/idempotency/dead-letter)'),
  /** Request/response action that suspends the flow until a reply. */
  isAsync: z.boolean().default(false)
    .describe('Suspends the flow awaiting an external reply'),

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

export type ActionDescriptor = z.infer<typeof ActionDescriptorSchema>;
export type ActionDescriptorInput = z.input<typeof ActionDescriptorSchema>;

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
export function defineActionDescriptor(input: ActionDescriptorInput): ActionDescriptor {
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
