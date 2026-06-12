// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

/**
 * Flow Node Types — **built-in seed set** (ADR-0018).
 *
 * Historically this `z.enum` *gated* `FlowNodeSchema.type`, which made the
 * closed protocol reject any plugin-registered node type — defeating the open
 * runtime registry (`registerNodeExecutor(type: string)`). Per ADR-0018 the
 * gate is removed: `FlowNodeSchema.type` is now a validated `string`, checked
 * against the live action registry at `registerFlow()` time, not frozen here.
 *
 * `FlowNodeAction` is **retained** as the canonical list of built-in type ids
 * (documentation + the seed descriptor set the engine registers at boot). It
 * no longer constrains authored flows — plugins extend the vocabulary.
 */
import { lazySchema } from '../shared/lazy-schema';
export const FlowNodeAction = z.enum([
  'start',              // Trigger
  'end',                // Return/Stop
  'decision',           // If/Else logic
  'assignment',         // Set Variable
  'loop',               // For Each
  'create_record',      // CRUD: Create
  'update_record',      // CRUD: Update
  'delete_record',      // CRUD: Delete
  'get_record',         // CRUD: Get/Query
  'http',               // Outbound HTTP callout (ADR-0018 M3) — canonical; outbox-backed when durable
  'http_request',       // Deprecated alias of `http` (ADR-0018 M3)
  'notify',             // Outbound notification (ADR-0012) — dispatched via the messaging service
  'script',             // Custom Script (JS/TS)
  'screen',             // Screen / User-Input Element
  'wait',               // Delay/Sleep
  'subflow',            // Call another flow
  'map',                // Sequential multi-instance — per-item subflow, each may pause (ADR-0037 A2)
  'connector_action',   // Zapier-style integration action
  'parallel_gateway',   // BPMN Parallel Gateway — AND-split (all outgoing branches execute concurrently)
  'join_gateway',       // BPMN Join Gateway — AND-join (waits for all incoming branches to complete)
  'boundary_event',     // BPMN Boundary Event — attached to a host node for timer/error/signal interrupts
]);

/**
 * The built-in node type ids as a plain string array — the seed set the
 * runtime registers descriptors for at boot. Consumers that need to know
 * "which types ship in the box" (vs plugin-contributed) read this.
 */
export const FLOW_BUILTIN_NODE_TYPES: readonly string[] = FlowNodeAction.options;

/**
 * Structural node types the engine handles without a registered executor
 * (the start sentinel and the end terminator). These are always legal
 * regardless of what executors are registered.
 */
export const FLOW_STRUCTURAL_NODE_TYPES: readonly string[] = ['start', 'end'];

/**
 * Flow Variable Schema
 * Variables available within the flow execution context.
 */
export const FlowVariableSchema = lazySchema(() => z.object({
  name: z.string().describe('Variable name'),
  type: z.string().describe('Data type (text, number, boolean, object, list)'),
  isInput: z.boolean().default(false).describe('Is input parameter'),
  isOutput: z.boolean().default(false).describe('Is output parameter'),
}));

/**
 * Flow Node Schema
 * A single step in the visual logic graph.
 * 
 * @example Decision Node
 * {
 *   id: "dec_1",
 *   type: "decision",
 *   label: "Is High Value?",
 *   config: {
 *     conditions: [
 *       { label: "Yes", expression: "{amount} > 10000" },
 *       { label: "No", expression: "true" } // default
 *     ]
 *   },
 *   position: { x: 300, y: 200 }
 * }
 */
export const FlowNodeSchema = lazySchema(() => z.object({
  id: z.string().describe('Node unique ID'),
  type: z.string().min(1).describe(
    'Action type — a built-in FlowNodeAction id or a plugin-registered node type. ' +
    'Validated against the live action registry at registerFlow() (ADR-0018), not by a closed enum.',
  ),
  label: z.string().describe('Node label'),
  
  /** Node Configuration Options (Specific to type) */
  config: z.record(z.string(), z.unknown()).optional().describe('Node configuration'),
  
  /** 
   * Connector Action Configuration
   * Used when type is 'connector_action'
   */
  connectorConfig: z.object({
    connectorId: z.string(),
    actionId: z.string(),
    input: z.record(z.string(), z.unknown()).describe('Mapped inputs for the action'),
  }).optional(),

  /** UI Position (for the canvas) */
  position: z.object({ x: z.number(), y: z.number() }).optional(),

  /** Node-level execution timeout */
  timeoutMs: z.number().int().min(0).optional().describe('Maximum execution time for this node in milliseconds'),

  /** Node input schema declaration for Studio form generation and runtime validation */
  inputSchema: z.record(z.string(), z.object({
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']).describe('Parameter type'),
    required: z.boolean().default(false).describe('Whether the parameter is required'),
    description: z.string().optional().describe('Parameter description'),
  })).optional().describe('Input parameter schema for this node'),

  /** Node output schema declaration */
  outputSchema: z.record(z.string(), z.object({
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']).describe('Output type'),
    description: z.string().optional().describe('Output description'),
  })).optional().describe('Output schema declaration for this node'),

  /**
   * Wait Event Configuration (for 'wait' nodes)
   * Defines what external event or condition should resume the paused execution.
   * Industry alignment: BPMN Intermediate Catch Events, Temporal Signals.
   */
  waitEventConfig: z.object({
    /** Type of event to wait for */
    eventType: z.enum(['timer', 'signal', 'webhook', 'manual', 'condition'])
      .describe('What kind of event resumes the execution'),
    /** Duration to wait (ISO 8601 duration or milliseconds) — for timer events */
    timerDuration: z.string().optional().describe('ISO 8601 duration (e.g., "PT1H") or wait time for timer events'),
    /** Signal name to listen for — for signal/webhook events */
    signalName: z.string().optional().describe('Named signal or webhook event to wait for'),
    /** Timeout before auto-failing or continuing — optional guard */
    timeoutMs: z.number().int().min(0).optional().describe('Maximum wait time before timeout (ms)'),
    /** Action to take on timeout */
    onTimeout: z.enum(['fail', 'continue']).default('fail').describe('Behavior when the wait times out'),
  }).optional().describe('Configuration for wait node event resumption'),

  /**
   * Boundary Event Configuration (for 'boundary_event' nodes)
   * Attaches an event handler to a host activity node (BPMN Boundary Event pattern).
   * Industry alignment: BPMN Boundary Error/Timer/Signal Events.
   */
  boundaryConfig: z.object({
    /** ID of the host node this boundary event is attached to */
    attachedToNodeId: z.string().describe('Host node ID this boundary event monitors'),
    /** Type of boundary event */
    eventType: z.enum(['error', 'timer', 'signal', 'cancel'])
      .describe('Boundary event trigger type'),
    /** Whether the boundary event interrupts the host activity */
    interrupting: z.boolean().default(true)
      .describe('If true, the host activity is cancelled when this event fires'),
    /** Error code filter — only for error boundary events */
    errorCode: z.string().optional().describe('Specific error code to catch (empty = catch all errors)'),
    /** Timer duration — only for timer boundary events */
    timerDuration: z.string().optional().describe('ISO 8601 duration for timer boundary events'),
    /** Signal name — only for signal boundary events */
    signalName: z.string().optional().describe('Named signal to catch'),
  }).optional().describe('Configuration for boundary events attached to host nodes'),
}));

/**
 * Flow Edge Schema
 * Connections between nodes.
 */
export const FlowEdgeSchema = lazySchema(() => z.object({
  id: z.string().describe('Edge unique ID'),
  source: z.string().describe('Source Node ID'),
  target: z.string().describe('Target Node ID'),
  
  /** Condition for this path (only for decision/branch nodes) */
  condition: ExpressionInputSchema.optional().describe('Predicate (CEL) returning boolean used for branching.'),
  
  type: z.enum(['default', 'fault', 'conditional', 'back'])
    .default('default')
    .describe(
      'Connection type: default (normal flow), fault (error path), conditional (expression-guarded), '
      + 'or back (ADR-0044 declared back-edge — traversed normally at run time, but excluded from DAG '
      + 'cycle validation so a revise/rework loop can re-enter an earlier node)',
    ),
  label: z.string().optional().describe('Label on the connector'),

  /**
   * Default Sequence Flow marker (BPMN Default Flow semantics).
   * When true, this edge is taken when no sibling conditional edges match.
   * Only meaningful on outgoing edges of decision/gateway nodes.
   */
  isDefault: z.boolean().default(false)
    .describe('Marks this edge as the default path when no other conditions match'),
}));

/**
 * Flow Schema
 * Visual Business Logic Orchestration.
 * 
 * @example Simple Approval Logic
 * {
 *   name: "approve_order_flow",
 *   label: "Approve Large Orders",
 *   type: "record_change",
 *   status: "active",
 *   nodes: [
 *     { id: "start", type: "start", label: "Start", position: {x: 0, y: 0} },
 *     { id: "check_amount", type: "decision", label: "Check Amount", position: {x: 0, y: 100} },
 *     { id: "auto_approve", type: "update_record", label: "Auto Approve", position: {x: -100, y: 200} },
 *     { id: "submit_for_approval", type: "connector_action", label: "Submit", position: {x: 100, y: 200} }
 *   ],
 *   edges: [
 *     { id: "e1", source: "start", target: "check_amount" },
 *     // Conditions are bare CEL (ADR-0032). Reference fields directly —
 *     // `record.amount`, `previous.status`, `<var>.field` — and DO NOT wrap them
 *     // in `{…}` template braces: `{amount}` parses as a CEL map literal and fails.
 *     { id: "e2", source: "check_amount", target: "auto_approve", condition: "record.amount < 500" },
 *     { id: "e3", source: "check_amount", target: "submit_for_approval", condition: "record.amount >= 500" }
 *   ]
 * }
 */
export const FlowSchema = lazySchema(() => z.object({
  /** Identity */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine name'),
  label: z.string().describe('Flow label'),
  description: z.string().optional(),
  
  /** Metadata & Versioning */
  version: z.number().int().default(1).describe('Version number'),
  status: z.enum(['draft', 'active', 'obsolete', 'invalid']).default('draft').describe('Deployment status'),
  template: z.boolean().default(false).describe('Is logic template (Subflow)'),

  /** Trigger Type */
  type: z.enum(['autolaunched', 'record_change', 'schedule', 'screen', 'api']).describe('Flow type'),
  
  /** Configuration Variables */
  variables: z.array(FlowVariableSchema).optional().describe('Flow variables'),
  
  /** Graph Definition */
  nodes: z.array(FlowNodeSchema).describe('Flow nodes'),
  edges: z.array(FlowEdgeSchema).describe('Flow connections'),
  
  /** Execution Config */
  active: z.boolean().default(false).describe('Is active (Deprecated: use status)'),
  runAs: z.enum(['system', 'user']).default('user').describe('Execution context'),

  /** Error Handling Strategy */
  errorHandling: z.object({
    strategy: z.enum(['fail', 'retry', 'continue']).default('fail').describe('How to handle node execution errors'),
    maxRetries: z.number().int().min(0).max(10).default(0).describe('Number of retry attempts (only for retry strategy)'),
    retryDelayMs: z.number().int().min(0).default(1000).describe('Delay between retries in milliseconds'),
    backoffMultiplier: z.number().min(1).default(1).describe('Multiplier for exponential backoff between retries'),
    maxRetryDelayMs: z.number().int().min(0).default(30000).describe('Maximum delay between retries in milliseconds'),
    jitter: z.boolean().default(false).describe('Add random jitter to retry delay to avoid thundering herd'),
    fallbackNodeId: z.string().optional().describe('Node ID to jump to on unrecoverable error'),
  }).optional().describe('Flow-level error handling configuration'),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this flow.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}));

/**
 * Type-safe factory for creating flow definitions.
 *
 * Validates the config at creation time using Zod `.parse()`.
 *
 * @example
 * ```ts
 * const onCreateFlow = defineFlow({
 *   name: 'on_task_create',
 *   label: 'On Task Create',
 *   type: 'record_change',
 *   nodes: [
 *     { id: 'start', type: 'start', label: 'Start' },
 *     { id: 'end', type: 'end', label: 'End' },
 *   ],
 *   edges: [{ id: 'e1', source: 'start', target: 'end' }],
 * });
 * ```
 */
export function defineFlow(config: z.input<typeof FlowSchema>): FlowParsed {
  return FlowSchema.parse(config);
}

export type Flow = z.input<typeof FlowSchema>;
export type FlowParsed = z.infer<typeof FlowSchema>;
export type FlowNode = z.input<typeof FlowNodeSchema>;
export type FlowNodeParsed = z.infer<typeof FlowNodeSchema>;
export type FlowEdge = z.input<typeof FlowEdgeSchema>;
export type FlowEdgeParsed = z.infer<typeof FlowEdgeSchema>;

/**
 * Flow Version History Schema
 * Tracks historical versions of flow definitions for rollback support.
 *
 * Industry alignment: Salesforce Flow Versions, n8n Workflow History.
 */
export const FlowVersionHistorySchema = lazySchema(() => z.object({
  flowName: z.string().describe('Flow machine name'),
  version: z.number().int().min(1).describe('Version number'),
  definition: FlowSchema.describe('Complete flow definition snapshot'),
  createdAt: z.string().datetime().describe('When this version was created'),
  createdBy: z.string().optional().describe('User who created this version'),
  changeNote: z.string().optional().describe('Description of what changed in this version'),
}));

export type FlowVersionHistory = z.input<typeof FlowVersionHistorySchema>;
export type FlowVersionHistoryParsed = z.infer<typeof FlowVersionHistorySchema>;
