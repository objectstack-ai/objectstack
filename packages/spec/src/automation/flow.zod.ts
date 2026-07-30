// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { strictUnknownKeyError } from '../shared/suggestions.zod';

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
import { retiredKey } from '../shared/retired-key';
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
  'notify',             // Outbound notification (ADR-0012) — dispatched via the messaging service
  'script',             // Custom action: a built-in side-effect (`config.actionType: 'email'|'slack'`)
                        //   or a registered function (`config.function: 'name'` + `config.inputs`),
                        //   resolved from `defineStack({ functions })`. (Inline `config.script` JS is
                        //   recognized but NOT executed by the built-in runtime — no server-side
                        //   sandbox.) A script node naming none of these is flagged at build and
                        //   fails loudly at run time (#1870).
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

/*
 * ── Unknown-key strictness (#4001, ADR-0078) ────────────────────────────────
 *
 * The four AUTHORING schemas in this module (flow / node / edge / variable)
 * are `.strict()`: a key they do not declare is a loud, fixable parse error,
 * not a silent strip. Flows are the most AI-authored surface in the platform,
 * and an AI author + a silently dropped key is the worst combination — the
 * agent gets a success envelope and reports "done" over dead metadata
 * (cloud#688 / #2419 is exactly this class). A node's `config` stays an OPEN
 * record here: it is per-node-type, owned by the registered executor's
 * `configSchema` (#4027/#4040) and the ADR-0087 conversion layer — outer-shell
 * strictness must not close the plugin node-type namespace.
 *
 * Key lists are kept beside the schemas rather than derived from `.shape`
 * (bodies are allocated lazily; `flow.test.ts` drift-guards every entry).
 */

/** Keys {@link FlowVariableSchema} declares (drift-guarded by flow.test.ts). */
const FLOW_VARIABLE_KEYS = ['name', 'type', 'isInput', 'isOutput'] as const;

const flowVariableUnknownKeyError = strictUnknownKeyError({
  surface: 'this flow variable',
  knownKeys: FLOW_VARIABLE_KEYS,
  aliases: { input: 'isInput', output: 'isOutput' },
  history:
    'Until #4001 these were dropped silently — the variable still parsed, so a ' +
    'mis-declared input/output contract shipped without a diagnostic.',
});

/**
 * Flow Variable Schema
 * Variables available within the flow execution context.
 */
export const FlowVariableSchema = lazySchema(() => z.object({
  name: z.string().describe('Variable name'),
  type: z.string().describe('Data type (text, number, boolean, object, list)'),
  isInput: z.boolean().default(false).describe('Is input parameter'),
  isOutput: z.boolean().default(false).describe('Is output parameter'),
}, { error: flowVariableUnknownKeyError }).strict());

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
/** Keys {@link FlowNodeSchema} declares (drift-guarded by flow.test.ts). */
const FLOW_NODE_KEYS = [
  'id', 'type', 'label', 'config', 'connectorConfig', 'position', 'timeoutMs',
  'inputSchema', 'outputSchema', 'waitEventConfig', 'boundaryConfig',
] as const;

const flowNodeUnknownKeyError = strictUnknownKeyError({
  surface: 'this flow node',
  knownKeys: FLOW_NODE_KEYS,
  aliases: {
    configuration: 'config',
    settings: 'config',
    properties: 'config',
    options: 'config',
    params: 'config',
    parameters: 'config',
  },
  guidance: {
    inputs:
      '`inputs` is not a FlowNode key — a node\'s runtime inputs live under `config` ' +
      '(e.g. `config.inputs` for script/function nodes); `inputSchema` declares their types.',
  },
  history:
    'Until #4001 these were dropped silently — the node still parsed, so a mis-placed ' +
    'config shipped as a step that quietly ignored it.',
});

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

  // `outputSchema` REMOVED (#3896 audit close-out): declared, never validated —
  // no engine path checked node outputs against it (ledger: dead).
  outputSchema: retiredKey(
    '`flow.nodes[].outputSchema` was removed in @objectstack/spec 17.0.0 (#3896 audit ' +
    'close-out) — it was never validated: the engine does not check node outputs against ' +
    'it, so it documented a contract nothing enforced. Delete the key. Downstream nodes ' +
    "read prior outputs via expressions ({{nodeId.field}}) regardless of any declaration.",
  ),

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
}, { error: flowNodeUnknownKeyError }).strict());

/** Keys {@link FlowEdgeSchema} declares (drift-guarded by flow.test.ts). */
const FLOW_EDGE_KEYS = ['id', 'source', 'target', 'condition', 'type', 'label', 'isDefault'] as const;

const flowEdgeUnknownKeyError = strictUnknownKeyError({
  surface: 'this flow edge',
  knownKeys: FLOW_EDGE_KEYS,
  aliases: {
    // n8n / mermaid / BPMN-tool vocabulary an author (or AI) imports wholesale.
    from: 'source',
    to: 'target',
    sourceid: 'source',
    targetid: 'target',
    expression: 'condition',
    when: 'condition',
    guard: 'condition',
  },
  history:
    'Until #4001 these were dropped silently — the edge still parsed, so a branch ' +
    'predicate or endpoint the author wrote was quietly ignored.',
});

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
}, { error: flowEdgeUnknownKeyError }).strict());

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
/** Keys {@link FlowSchema} declares (drift-guarded by flow.test.ts). */
const FLOW_KEYS = [
  'name', 'label', 'description', 'successMessage', 'errorMessage', 'version',
  'status', 'template', 'type', 'variables', 'nodes', 'edges', 'active', 'runAs',
  'errorHandling', 'protection',
  // ADR-0010 runtime protection envelope (MetadataProtectionFields spread).
  '_lock', '_lockReason', '_lockSource', '_provenance', '_packageId',
  '_packageVersion', '_lockDocsUrl',
] as const;

const flowUnknownKeyError = strictUnknownKeyError({
  surface: 'this flow',
  knownKeys: FLOW_KEYS,
  aliases: {
    steps: 'nodes',
    connections: 'edges',
    transitions: 'edges',
    links: 'edges',
    trigger: 'type',
    triggertype: 'type',
    title: 'label',
  },
  guidance: {
    object:
      '`object` is not a Flow field — a record-change flow binds its object on the ' +
      'START node\'s `config` (`{ objectName, triggerType, condition }`), not at the ' +
      'flow top level.',
    objectName:
      '`objectName` is not a Flow field — it belongs on the START node\'s `config` ' +
      '(`{ objectName, triggerType, condition }`), not at the flow top level.',
    schedule:
      '`schedule` is not a Flow field — a schedule flow declares its cron/interval as ' +
      '`config.schedule` on the START node, not at the flow top level.',
  },
  history:
    'Until #4001 these were dropped silently — the flow still parsed, so a trigger ' +
    'binding or config the author wrote was quietly ignored.',
});

export const FlowSchema = lazySchema(() => z.object({
  /** Identity */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine name'),
  label: z.string().describe('Flow label'),
  description: z.string().optional(),

  /**
   * Terminal messages for `screen`-flow runs. When the run reaches a terminal
   * state, the UI flow-runner shows `successMessage` instead of a generic
   * "Done" toast, and `errorMessage` instead of the raw error. Both are
   * surfaced on the terminal {@link AutomationResult} (`successMessage` /
   * `errorMessage`). Plain strings; `{var}` is NOT interpolated here.
   */
  successMessage: z.string().optional().describe('Toast shown when a screen flow completes (defaults to a generic "Done").'),
  errorMessage: z.string().optional().describe('Toast shown when a screen flow fails (defaults to the raw error).'),

  /** Metadata & Versioning */
  version: z.number().int().default(1).describe('Version number'),
  status: z.enum(['draft', 'active', 'obsolete', 'invalid']).default('draft').describe('Deployment status'),
  // `template` REMOVED (#3896 audit close-out): no reader in designer or engine.
  template: retiredKey(
    '`flow.template` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    'no designer or engine path ever read it, so flagging a flow as a template/subflow did ' +
    'nothing. Delete the key. Shared logic is invoked via a subflow NODE referencing the ' +
    'flow by name.',
  ),

  /** Trigger Type */
  type: z.enum(['autolaunched', 'record_change', 'schedule', 'screen', 'api']).describe('Flow type'),
  
  /** Configuration Variables */
  variables: z.array(FlowVariableSchema).optional().describe('Flow variables'),
  
  /** Graph Definition */
  nodes: z.array(FlowNodeSchema).describe('Flow nodes'),
  edges: z.array(FlowEdgeSchema).describe('Flow connections'),
  
  // `active` REMOVED (#3896 audit close-out) — the rls.enabled shape, in the
  // over-permissive direction: the spec default was `false` while the engine
  // treated an unset flow as ENABLED, and `active: false` never stopped a flow
  // (`status` is the enforced lifecycle). An author who "disabled" a flow here
  // left it firing.
  active: retiredKey(
    '`flow.active` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — it ' +
    'never had an effect: the engine arms flows from `status`, and `active: false` did NOT ' +
    'stop a flow (worse, the default read as disabled while the engine treated unset as ' +
    "enabled). Delete the key. Use `status: 'obsolete'` (or 'invalid') to unbind and " +
    "disable a flow, `status: 'active'` to arm it.",
  ),
  // ADR-0049 / #1888 — ENFORCED. The service-automation engine establishes the
  // declared identity for the run's data operations and restores the caller's
  // context afterward: `system` runs elevated (a full-access, RLS-bypassing
  // system principal); `user` (default) runs as the triggering user, so CRUD
  // nodes' ObjectQL reads/writes respect that user's row-level security.
  //
  // A run under `user` that resolves NO trigger user has nothing to scope to, so
  // its data operations are REFUSED (#3760). This is NOT a schedule-only case —
  // it is any run whose trigger supplied no user, and the commonest by far is a
  // record-change flow fired by a write that carried none (any `isSystem`
  // plugin/service write; `isSystem` does not suppress trigger dispatch, only
  // `skipTriggers` does). Declare `system` to make the elevation explicit.
  runAs: z
    .enum(['system', 'user'])
    .default('user')
    .describe(
      'Execution identity for the run: system = elevated (bypasses RLS), user = the triggering user (RLS-respecting). ' +
        'A run with no trigger user has no identity to scope to, so under user its data operations are REFUSED — ' +
        'declare system to make the elevation explicit. This covers schedule/time-relative/api triggers AND any ' +
        'record-change flow fired by a write that carried no user.',
    ),

  /** Error Handling Strategy */
  errorHandling: z.object({
    strategy: z.enum(['fail', 'retry', 'continue']).default('fail').describe('How to handle node execution errors'),
    maxRetries: z.number().int().min(0).max(10).default(0).describe('Number of retry attempts (only for retry strategy)'),
    retryDelayMs: z.number().int().min(0).default(1000).describe('Delay between retries in milliseconds'),
    backoffMultiplier: z.number().min(1).default(1).describe('Multiplier for exponential backoff between retries'),
    maxRetryDelayMs: z.number().int().min(0).default(30000).describe('Maximum delay between retries in milliseconds'),
    jitter: z.boolean().default(false).describe('Add random jitter to retry delay to avoid thundering herd'),
    // `fallbackNodeId` REMOVED (#3896 audit close-out): the engine routes
    // unrecoverable errors via per-node FAULT EDGES, never this — an author
    // who configured a fallback here had none.
    fallbackNodeId: retiredKey(
      '`flow.errorHandling.fallbackNodeId` was removed in @objectstack/spec 17.0.0 (#3896 ' +
      'audit close-out) — the engine routes unrecoverable node errors via per-node fault ' +
      "edges (an edge with condition 'fault'), and never read this key: a fallback " +
      'configured here silently did not exist. Delete the key and draw a fault edge from ' +
      'the failing node to the handler node instead.',
    ),
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

}, { error: flowUnknownKeyError }).strict());

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
