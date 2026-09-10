// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Automation Execution Protocol
 *
 * Defines schemas for execution logging, error tracking, checkpointing,
 * concurrency control, and scheduled execution persistence.
 *
 * Industry alignment: Salesforce Flow Interviews, Temporal Workflow History,
 * AWS Step Functions execution logs.
 */

// ==========================================
// 1. Execution Status
// ==========================================

/**
 * Execution Status Enum
 * Tracks the lifecycle of a flow execution instance.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ExecutionStatus = z.enum([
  'pending',     // Queued, not yet started
  'running',     // Currently executing
  'paused',      // Paused at a wait/checkpoint node
  'completed',   // Successfully finished
  'failed',      // Terminated with error
  'cancelled',   // Manually cancelled
  'timed_out',   // Exceeded max execution time
  'retrying',    // Failed and retrying
  // #14945 — the run reached an `end` node declaring `outcome: 'refused'`: a
  // successful evaluation that said no. Terminal, never resumed, and DISTINCT
  // from `failed` (nothing threw; the flow refused on purpose). The rendered
  // refusal text rides beside it on the run row as `refusalMessage`. Appended
  // last so every reader that indexes `.options` keeps its positions.
  'refused',     // Terminal: the flow refused (an `end` node with outcome: 'refused')
]);
export type ExecutionStatus = z.input<typeof ExecutionStatus>;

// ==========================================
// 2. Execution Log
// ==========================================

/**
 * What one node execution did to the data, reported by the node executor
 * itself (#4354).
 *
 * A scheduled sweep that selects records and then writes none looks — in every
 * surface the platform had — exactly like a sweep with nothing to do: both
 * report success, emit no log and write nothing. These two counters are what
 * tells them apart, so they are declared by the executor rather than inferred
 * by the engine from a node's output shape: only the node knows whether its
 * `result` was a row count, a record, or a boolean.
 *
 * Absent ⇒ the node touched no records (a `decision`, an `assignment`), which
 * is different from `0` — "read nothing" is a fact, "reads nothing" is a kind.
 *
 * And `unmeasuredEffect` is the third answer, which a two-counter model would
 * have had to fake: a `connector_action` reaches an external system, and when
 * the action declares nothing about whether it reads or writes, `0` understates
 * a write and `1` overstates a read. Both are worse than saying so, and in
 * opposite directions — an understated `0` puts a run that DID act inside the
 * broken-sweep FIRST FILTER (`selected > 0 AND acted = 0 AND unmeasured = 0`),
 * and an overstated `1` keeps a run that acted on nothing outside it, which is
 * the original bug back again.
 *
 * Being inside that filter is not the accusation an alarm reading makes of it:
 * it is a first filter and not a verdict (#12685) — a healthy idempotent sweep
 * that re-selects the same records and gates each one on "already handled"
 * satisfies it on every run too, and what separates the two is the per-node
 * fold spelled out on `FlowRunSummarySchema` below. That is also what makes a
 * fabricated count the expensive kind of wrong: the fold is the step that would
 * have settled it, and a faked `acted` is a fact the fold can only repeat.
 *
 * [#4395] "Declares nothing" is now the fallback rather than the only case:
 * `ConnectorActionSchema.effect` lets an action say `read` or `write`, and a
 * step dispatching a declared action reports a real `acted` (0 for a read, 1
 * for an accepted write) instead of this flag. `unmeasuredEffect` keeps exactly
 * its meaning and its consumers — it is what an UNdeclared action still
 * reports, alongside a declared write whose dispatch failed (the upstream may
 * have been reached) and a `script` step calling a function declared
 * `'writes'` (#4396).
 *
 * `failures` is the fourth answer, and it exists for one shape: a node that
 * DELEGATES to a child run — a `subflow`, or each item of a `map` — whose
 * child completed while containing failures of its own (#15617). The child's
 * steps live in the child's log, so the parent's per-node fold cannot see
 * them; `selected` / `acted` already ride up through these metrics so that a
 * parent answers "what did this run cause", and until this slot existed the
 * failure count did not: a parent whose child lost a row read `failed: 0`,
 * which is the misreading the run-level `failed` was added to prevent
 * (#13681), one level up. The slot carries a COMPLETED child's
 * `summary.failed` and folds into the delegating node's `failures` — the same
 * fold shape `acted` has, so `failed = Σ nodes[].failures` keeps holding with
 * the child counted in. It is NOT the same rule as `acted` at the failed-child
 * boundary, below.
 *
 * It is NOT this execution's own outcome. A step that failed is
 * `status: 'failure'` and counts once, in `nodes[].failures`, as it always
 * has — and that is also the whole answer for a child that FAILED, whether or
 * not it also contained failures before it failed: the delegating step is the
 * failure, the child's own `failed` (contained and fatal alike) stays on the
 * child's run row, and nothing rides up here, so one failure is never counted
 * twice. Unlike `acted`, which does carry a failed child's writes up (rows it
 * wrote before it died), this slot carries nothing from a failed child.
 * Absent ⇒ this execution delegated nothing, or its child tracked no count
 * (an older run), or the producer did not track it (a step recorded before
 * its executor populated the slot); in every case it is not `0`.
 */
export const ExecutionStepMetricsSchema = lazySchema(() => z.object({
  selected: z.number().int().min(0).optional()
    .describe('Records this node READ or matched (a `get_record` query, a lookup)'),
  acted: z.number().int().min(0).optional()
    .describe('Records this node WROTE (created / updated / deleted) or effects it dispatched (notifications delivered)'),
  unmeasuredEffect: z.boolean().optional()
    .describe('This execution may have caused an effect the platform cannot count (an external write through a connector). NOT interchangeable with `acted: 0` — it says the count is unknown, not that it is zero.'),
  failures: z.number().int().min(0).optional()
    .describe('Node executions that failed inside a child run this execution delegated to and went on from — a `subflow` child or a `map` item whose run COMPLETED while containing failures: its `summary.failed`, rolled up so the parent answers "what did this run cause". Folds into this node\'s `failures` and so into the run-level `failed`. NOT this execution\'s own outcome: a step that failed is `status: \'failure\'` and counts once through `nodes[].failures`, and a child that FAILED — whether or not it also contained failures before it failed — is exactly that step failure: its own `failed`, contained and fatal alike, stays on the child\'s run row and nothing rides up here (unlike `acted`, which does carry a failed child\'s writes). Absent = delegated nothing, or the child tracked no count, or the producer did not track it; never zero.'),
}));
export type ExecutionStepMetrics = z.input<typeof ExecutionStepMetricsSchema>;

/**
 * The gate that kept a step from running — recorded on a `skipped` step so the
 * run trace names *which* condition closed, not merely that something did.
 *
 * This is the signal #4347 had no way to emit: a conditional edge inside a
 * `loop` body evaluated false on every iteration, so the flow selected every
 * stalled deal and nudged nobody, silently and green.
 */
export const ExecutionStepSkipReasonSchema = lazySchema(() => z.object({
  nodeId: z.string().describe('Node whose out-edge did not open (the gate)'),
  edgeId: z.string().optional().describe('Edge whose condition evaluated false'),
  label: z.string().optional().describe('Edge label, when the flow names its branches'),
}));
export type ExecutionStepSkipReason = z.input<typeof ExecutionStepSkipReasonSchema>;

/**
 * Execution Step Log Entry
 * Records the result of executing a single node in the flow graph.
 */
export const ExecutionStepLogSchema = lazySchema(() => z.object({
  nodeId: z.string().describe('Node ID that was executed'),
  nodeType: z.string().describe('Node action type (e.g., "decision", "http")'),
  nodeLabel: z.string().optional().describe('Human-readable node label'),
  status: z.enum(['success', 'failure', 'skipped']).describe('Step execution result'),
  startedAt: z.string().datetime().describe('When the step started'),
  completedAt: z.string().datetime().optional().describe('When the step completed'),
  durationMs: z.number().int().min(0).optional().describe('Step execution duration in milliseconds'),
  input: z.record(z.string(), z.unknown()).optional().describe('Input data passed to the node'),
  output: z.record(z.string(), z.unknown()).optional().describe('Output data produced by the node'),
  error: z.object({
    code: z.string().describe('Error code'),
    message: z.string().describe('Error message'),
    stack: z.string().optional().describe('Stack trace'),
  }).optional().describe('Error details if step failed'),
  retryAttempt: z.number().int().min(0).optional().describe('Retry attempt number (0 = first try)'),
  // #1479: structured-region grouping. Tag a step that ran inside a
  // `loop` / `parallel` / `try_catch` body region with its immediate container,
  // so run observability can nest per-iteration / per-branch body steps under
  // the container instead of showing it as a single opaque step.
  parentNodeId: z.string().optional().describe('Enclosing structured-region container node ID (loop/parallel/try_catch)'),
  // `iteration` is SINGLE-VALUED: the zero-based iteration of the enclosing
  // `loop`, carried through any nesting. It used to double as the parallel
  // branch index — one field, two meanings, told apart only by reading
  // `regionKind` first — so for `loop { body: [ parallel { branches } ] }`
  // every branch step recorded the branch index and no step of that branch
  // recorded the loop iteration: a per-row failure inside a branch was
  // attributable to a branch, never to the row. The branch index now has its
  // own key, `branch`, below (maintainer ruling 2026-09-03, option A: one
  // meaning per key; the overload-plus-second-index alternative was not taken).
  //
  // A `try` / `catch` region has no index of its own, so a step it ran for a
  // loop body — `loop { body: [ try_catch { try, catch } ] }`, the containment
  // spelling for a per-iteration failure that must not end the sweep — carries
  // the ENCLOSING LOOP's iteration while `regionKind` keeps naming the
  // try/catch region: the step says which region ran it AND which row it ran
  // for. Without that, a caught per-row failure is attributable to no row.
  iteration: z.number().int().min(0).optional().describe('Zero-based iteration of the enclosing `loop`, carried through any nesting — a step inside a `parallel` branch that is itself inside a loop body carries the loop\'s iteration here and its branch index on `branch`. A step inside a `try` / `catch` region that is itself inside a loop body carries the enclosing loop\'s iteration — a try/catch region has no index of its own — while `regionKind` stays `try` / `catch`.'),
  // A `parallel` region DOES have an index of its own, which is exactly why it
  // cannot share `iteration`: a branch step of a parallel node inside a loop
  // body carries BOTH — `iteration` for the row, `branch` for the branch.
  branch: z.number().int().min(0).optional().describe('Zero-based index of the enclosing `parallel` branch. Present only on a step inside a parallel branch; absent everywhere else. When the parallel node is itself inside a loop body, the loop iteration is reported through `iteration`, never here.'),
  regionKind: z.string().optional().describe('Region kind the step ran in: loop-body | parallel-branch | try | catch. Stays `try` / `catch` for a step inside a try/catch region nested in a loop body; the loop is reported through `iteration`. For `parallel-branch` the branch index is reported through `branch`, and the enclosing loop iteration — when the parallel node sits inside a loop body — through `iteration`.'),
  // #4354: what the step did to the data, and — for a `skipped` step — which
  // gate stopped it. Both feed the run summary aggregated on ExecutionLog.
  metrics: ExecutionStepMetricsSchema.optional()
    .describe('Records this step selected / acted on — and, for a step that delegated to a child run (`subflow`, a `map` item), the failures that child contained — as reported by the node executor'),
  skippedBy: ExecutionStepSkipReasonSchema.optional()
    .describe('The gate that closed, when `status` is `skipped`'),
}));
export type ExecutionStepLog = z.input<typeof ExecutionStepLogSchema>;

// ==========================================
// 2b. Flow Run Summary (#4354)
// ==========================================

/**
 * One node's contribution to a run, folded across every time it ran — a loop
 * body node that ran 30 times is ONE entry with `runs: 30`, not 30 entries.
 */
export const FlowRunNodeSummarySchema = lazySchema(() => z.object({
  nodeId: z.string().describe('Node ID'),
  nodeType: z.string().describe('Node action type (e.g., "get_record", "decision")'),
  nodeLabel: z.string().optional().describe('Human-readable node label'),
  status: z.enum(['success', 'failure', 'skipped'])
    .describe('Terminal status of the node across the run — `failure` if any execution failed, else `success` if any succeeded, else `skipped`. Judged on this node\'s OWN executions: a delegating node (`subflow` / `map`) whose child completed while containing failures reads `success` here with `failures > 0`'),
  runs: z.number().int().min(0).describe('Times the node executed (loop iterations and parallel branches each count)'),
  failures: z.number().int().min(0).describe('Executions that failed — a failure a `try_catch` caught or a `fault` edge routed counts here too — plus what a delegating execution rolled up from a child run that COMPLETED (`metrics.failures`: the contained failures of a `subflow` child or a `map` item). On a delegating node this may therefore exceed `runs` and is no longer only this node\'s own failed executions; a child that FAILED adds only the step\'s own failure (unlike `acted`, which carries a failed child\'s writes too); the run-level `failed` is the sum of this across `nodes`'),
  skipped: z.number().int().min(0).describe('Times a closed gate kept this node from running at all'),
  selected: z.number().int().min(0).optional().describe('Records read across every execution — omitted for a node that reads none'),
  acted: z.number().int().min(0).optional().describe('Records written / effects dispatched across every execution — omitted for a node that writes none'),
  unmeasured: z.number().int().min(0).optional().describe('Executions that may have caused an effect the platform cannot count (see ExecutionStepMetrics.unmeasuredEffect)'),
}));
export type FlowRunNodeSummary = z.input<typeof FlowRunNodeSummarySchema>;

/** A gate that closed during the run, and how often. */
export const FlowRunGateSummarySchema = lazySchema(() => z.object({
  nodeId: z.string().describe('Node whose out-edge did not open (the gate)'),
  targetNodeId: z.string().describe('Node the closed edge would have run'),
  edgeId: z.string().optional().describe('Edge whose condition evaluated false'),
  label: z.string().optional().describe('Edge label, when the flow names its branches'),
  skipped: z.number().int().min(1).describe('Times this gate evaluated false (once per loop iteration)'),
}));
export type FlowRunGateSummary = z.input<typeof FlowRunGateSummarySchema>;

/**
 * Per-run rollup of what a flow execution actually *did* (#4354).
 *
 * The counters exist to answer one question no other surface could: is a green
 * run doing its job, or has it silently stopped? `selected > 0 && acted == 0`
 * (with `unmeasured = 0`) is the FIRST FILTER for a broken sweep, not a verdict
 * (#12685): a healthy idempotent sweep that re-selects the same records and
 * gates each one on "already handled" satisfies it on every run while that work
 * stands, so "over N consecutive runs" does not separate the two —
 * consecutiveness filters flapping, which is a different failure. What
 * separates them is the per-node fold below: a healthy skip is accounted for by
 * a read this run performed — the lookup the gate depends on shows `runs > 0`
 * and `selected > 0` in `nodes[]` — while a dead gate skips just as often with
 * nothing behind it (`runs: 0`, or `selected: 0`). The platform ships the
 * measurement so every flow gets it, rather than each app rebuilding a detector
 * out of the same primitives that fail silently.
 *
 * `failed` reads BESIDE that filter rather than inside it: `acted = 0` with
 * `failed > 0` is not a sweep that silently stopped but one whose writes were
 * attempted and failed — contained, so the run still reads `completed` — and
 * the remedy is the failing node, not the gate.
 *
 * Totals are sums over `nodes`, which is itself a fold of the run's step log,
 * so a loop that ran a write 30 times contributes 30 to `acted`. A `subflow`
 * node — and each item of a `map` — rolls its child run up into this one
 * through the delegating step's metrics, total by total, each on its own
 * rule: `selected` and `acted` as totals, from a completed and a failed child
 * alike; `unmeasured` as ONE per-execution flag (N uncountable effects in the
 * child collapse to one on the parent's step, so this total counts parent
 * executions, not the child's effects); `failed` as the child's contained
 * failures, from a child that COMPLETED only, on `metrics.failures`, folding
 * into that node's `failures` and so into `failed` (#15617); and `skipped`
 * not at all — a child's closed gates stay on the child's row. The child
 * keeps its own run row, so the child's work is counted there too,
 * deliberately: this summary answers "what did this run cause", not "what did
 * this run's own nodes do". A child that FAILED — whether or not it also
 * contained failures before it failed — is the delegating step's own failure,
 * counted once, as it always was; nothing of that child's `failed` rides up,
 * which is the one place this rule parts from `acted`'s.
 */
export const FlowRunSummarySchema = lazySchema(() => z.object({
  selected: z.number().int().min(0).describe('Total records read by the run'),
  acted: z.number().int().min(0).describe('Total records written / effects dispatched by the run'),
  skipped: z.number().int().min(0).describe('Total node executions a closed gate prevented'),
  /**
   * The qualifier `acted` needs to be trusted. A run that dispatched an
   * uncountable effect (a `connector_action`) can report `acted: 0` while
   * having done plenty, so the broken-sweep FILTER is
   * `selected > 0 AND acted = 0 AND unmeasured = 0` — the third clause is what
   * keeps it off healthy connector-driven flows, because such a run has an
   * INCOMPLETE `acted` count, not a zero one. A filter, not a verdict: what
   * actually separates a broken sweep from a healthy idempotent one is the
   * per-node fold, spelled out on `FlowRunSummarySchema` above (#12685).
   *
   * Optional, and `undefined` is NOT `0`: a run recorded before this field
   * existed did not track uncountable effects at all, and defaulting it to zero
   * would tell an operator "fully measured" about a run nobody measured.
   */
  unmeasured: z.number().int().min(0).optional()
    .describe('Total executions that may have caused an effect the platform cannot count. Absent = not tracked (an older run), which is not the same as zero.'),
  /**
   * The count a green run hides. `loop { body: [ try_catch { try, catch } ] }`
   * is the containment spelling — a per-iteration failure is caught, the loop
   * goes on to the next item and the run completes — and until this field
   * existed the run row said nothing about it: the caught failure was in the
   * step log and in `nodes[].failures`, but no run-level number and no summary
   * line carried it, so a run that lost two rows out of five was
   * indistinguishable from one that lost none. This is `nodes[].failures`,
   * folded: `failed = Σ nodes[].failures`, and stated as a fold so the
   * run-level count can never disagree with the per-node breakdown.
   *
   * Every node execution that failed counts — on a run that completed all of
   * them were contained (caught by a `try_catch` or routed down a `fault`
   * edge); on a run that failed, the fatal one is in the count too. And the
   * fold INCLUDES what a delegating node rolled up from its child (#15617): a
   * `subflow` or `map` child that completed while containing failures reports
   * them on the delegating step's `metrics.failures`, which folds into that
   * node's `failures` and so arrives here. Before that slot existed the fold
   * could not see them, so a parent whose child lost rows read `failed: 0`
   * while the paragraph above promised "what did this run cause"; the two now
   * agree. A child that FAILED — whether or not it also contained failures
   * before it failed — is the delegating step's own failure, counted once
   * here as it always was; its own `failed`, contained and fatal alike, stays
   * on its own run row and nothing of it rides up (unlike `acted`, which
   * carries a failed child's writes).
   *
   * Same convention as `unmeasured`, for the same reason: optional, and absent
   * is NOT zero. A run recorded before this field existed did not carry the
   * count, and defaulting it to `0` would tell an operator "nothing failed"
   * about a run nobody measured.
   */
  failed: z.number().int().min(0).optional()
    .describe('Total node executions that failed — a fold of `nodes[].failures`, INCLUDING what a delegating node (`subflow` / `map`) rolled up from a child run that COMPLETED while containing failures: this total answers "what did this run cause", subflows included, so a parent whose child lost rows does not read `failed: 0`. A child that FAILED — whether or not it also contained failures before it failed — counts once, as the delegating step\'s own failure, and its own `failed` stays on its row (unlike `acted`, which carries a failed child\'s writes). On a run that completed every one of them was contained (caught by a `try_catch` or routed down a `fault` edge) and the run went on. Absent = not tracked (an older run), which is not the same as zero.'),
  nodes: z.array(FlowRunNodeSummarySchema).describe('Per-node breakdown, in first-execution order'),
  gates: z.array(FlowRunGateSummarySchema).describe('Gates that closed during the run, most-skipped first'),
  detailOmitted: z.boolean().optional()
    .describe('Set when persistence dropped `nodes`/`gates` to keep the stored row bounded — the totals are still exact. Declared so empty arrays are never mistaken for "nothing ran".'),
}));
export type FlowRunSummary = z.input<typeof FlowRunSummarySchema>;

/**
 * Execution Log Schema
 * Full execution history for a single flow run.
 *
 * @example
 * {
 *   id: 'exec_001',
 *   flowName: 'approve_order_flow',
 *   flowVersion: 1,
 *   status: 'completed',
 *   trigger: { type: 'record_change', recordId: 'rec_123', object: 'order' },
 *   steps: [
 *     { nodeId: 'start', nodeType: 'start', status: 'success', startedAt: '...', durationMs: 1 },
 *     { nodeId: 'check_amount', nodeType: 'decision', status: 'success', startedAt: '...', durationMs: 5 },
 *   ],
 *   startedAt: '2026-02-01T10:00:00Z',
 *   completedAt: '2026-02-01T10:00:01Z',
 *   durationMs: 1050,
 * }
 */
export const ExecutionLogSchema = lazySchema(() => z.object({
  /** Unique execution ID */
  id: z.string().describe('Execution instance ID'),

  /** Flow reference */
  flowName: z.string().describe('Machine name of the executed flow'),
  flowVersion: z.number().int().optional().describe('Version of the flow that was executed'),

  /** Execution status */
  status: ExecutionStatus.describe('Current execution status'),

  /**
   * #14945: the rendered refusal. Set when `status` is `refused` — the `end`
   * node's `message` template, interpolated against the run's variables at
   * the moment the run reached it (per-record text, the same rendering a
   * `screen` node's `description` gets). Absent on every other status: a
   * refusal is the only terminal that carries AUTHORED text on the run row —
   * a failure's reason is the failing step's `error`, and a completion's
   * `successMessage` is copied from the flow definition onto the RESULT, not
   * stored here.
   */
  refusalMessage: z.string().optional().describe(
    'Rendered `end` node `message` when `status` is `refused` — the per-record text the flow refused with. '
    + 'Absent on every other status.',
  ),

  /** Trigger context */
  trigger: z.object({
    type: z.string().describe('Trigger type (e.g., "record_change", "schedule", "api", "manual")'),
    recordId: z.string().optional().describe('Triggering record ID'),
    object: z.string().optional().describe('Triggering object name'),
    userId: z.string().optional().describe('User who triggered the execution'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Additional trigger context'),
  }).describe('What triggered this execution'),

  /** Step-by-step execution history */
  steps: z.array(ExecutionStepLogSchema).describe('Ordered list of executed steps'),

  /**
   * #4354: what the run did, folded out of `steps`. Present on terminal runs;
   * absent on a run written before the summary existed (or by an engine that
   * does not compute one) — which is why it is optional rather than defaulted
   * to zeros: an absent summary must not read as "this run did nothing".
   */
  summary: FlowRunSummarySchema.optional()
    .describe('Per-run rollup: records selected / acted on, gate skips, per-node status'),

  /** Execution variables snapshot */
  variables: z.record(z.string(), z.unknown()).optional().describe('Final state of flow variables'),

  /** Timing */
  startedAt: z.string().datetime().describe('Execution start timestamp'),
  completedAt: z.string().datetime().optional().describe('Execution completion timestamp'),
  durationMs: z.number().int().min(0).optional().describe('Total execution duration in milliseconds'),

  /** Context */
  runAs: z.enum(['system', 'user']).optional().describe('Execution context identity'),
  tenantId: z.string().optional().describe('Tenant ID for multi-tenant isolation'),
}));
export type ExecutionLog = z.input<typeof ExecutionLogSchema>;

// ==========================================
// 3. Execution Error Tracking & Diagnostics
// ==========================================

/**
 * Execution Error Severity
 */
export const ExecutionErrorSeverity = z.enum([
  'warning',    // Non-fatal issue (e.g., deprecated node type)
  'error',      // Node-level failure (may be retried)
  'critical',   // Flow-level failure (execution terminated)
]);
export type ExecutionErrorSeverity = z.input<typeof ExecutionErrorSeverity>;

/**
 * Execution Error Schema
 * Detailed error record for diagnostics and troubleshooting.
 */
export const ExecutionErrorSchema = lazySchema(() => z.object({
  id: z.string().describe('Error record ID'),
  executionId: z.string().describe('Parent execution ID'),
  nodeId: z.string().optional().describe('Node where the error occurred'),
  severity: ExecutionErrorSeverity.describe('Error severity level'),
  code: z.string().describe('Machine-readable error code'),
  message: z.string().describe('Human-readable error message'),
  stack: z.string().optional().describe('Stack trace for debugging'),
  context: z.record(z.string(), z.unknown()).optional()
    .describe('Additional diagnostic context (input data, config snapshot)'),
  timestamp: z.string().datetime().describe('When the error occurred'),
  retryable: z.boolean().default(false).describe('Whether this error can be retried'),
  resolvedAt: z.string().datetime().optional().describe('When the error was resolved (e.g., after successful retry)'),
}));
export type ExecutionError = z.input<typeof ExecutionErrorSchema>;

// ==========================================
// 4. Checkpointing / Resume
// ==========================================

/**
 * Checkpoint Schema
 * Captures the execution state at a specific node for pause/resume.
 *
 * Used by wait nodes, user-input screens, and crash recovery.
 */
export const CheckpointSchema = lazySchema(() => z.object({
  /** Unique checkpoint ID */
  id: z.string().describe('Checkpoint ID'),

  /** Execution reference */
  executionId: z.string().describe('Parent execution ID'),
  flowName: z.string().describe('Flow machine name'),

  /** State snapshot */
  currentNodeId: z.string().describe('Node ID where execution is paused'),
  variables: z.record(z.string(), z.unknown()).describe('Flow variable state at checkpoint'),
  completedNodeIds: z.array(z.string()).describe('List of node IDs already executed'),

  /** Timing */
  createdAt: z.string().datetime().describe('Checkpoint creation timestamp'),
  expiresAt: z.string().datetime().optional().describe('Checkpoint expiration (auto-cleanup)'),

  /** Reason */
  reason: z.enum(['wait', 'screen_input', 'approval', 'error', 'manual_pause', 'parallel_join', 'boundary_event'])
    .describe('Why the execution was checkpointed'),
}));
export type Checkpoint = z.input<typeof CheckpointSchema>;

// ==========================================
// 5. Concurrency Control
// ==========================================

/**
 * Concurrency Policy Schema
 * Controls how concurrent executions of the same flow are handled.
 *
 * Industry alignment: Salesforce "Allow multiple instances", Temporal "Workflow ID reuse policy"
 */
export const ConcurrencyPolicySchema = lazySchema(() => z.object({
  /** Maximum concurrent executions of this flow */
  maxConcurrent: z.number().int().min(1).default(1)
    .describe('Maximum number of concurrent executions allowed'),

  /** What to do when max concurrency is reached */
  onConflict: z.enum(['queue', 'reject', 'cancel_existing'])
    .default('queue')
    .describe('queue = enqueue for later, reject = fail immediately, cancel_existing = stop running instance'),

  /** Lock scope for concurrency */
  lockScope: z.enum(['global', 'per_record', 'per_user'])
    .default('global')
    .describe('Scope of the concurrency lock'),

  /** Queue timeout (only when onConflict is "queue") */
  queueTimeoutMs: z.number().int().min(0).optional()
    .describe('Maximum time to wait in queue before timing out (ms)'),
}));
export type ConcurrencyPolicy = z.input<typeof ConcurrencyPolicySchema>;

// ==========================================
// 6. Scheduled Execution Persistence
// ==========================================

/**
 * Schedule State Schema
 * Tracks the runtime state of scheduled flow executions.
 *
 * Persists next-run times, pause/resume state, and execution history references.
 */
export const ScheduleStateSchema = lazySchema(() => z.object({
  /** Unique schedule ID */
  id: z.string().describe('Schedule instance ID'),

  /** Flow reference */
  flowName: z.string().describe('Flow machine name'),

  /*
   * `cronExpression` was DELETED here in @objectstack/spec 18 (ADR-0049
   * enforce-or-remove, #16320). It was this schema's REQUIRED cron and was read by
   * nothing: `ScheduleStateSchema` has no consumer outside `packages/spec`, and the
   * schedule trigger that does run reads a flow start node's `config.schedule`
   * through `trigger-schedule/schedule-trigger.ts` `normalizeSchedule` — a different
   * shape this key never reached. Deleted outright — no `retiredKey()` tombstone, no
   * D2 conversion, no D3 semantic entry (maintainer ruling 2026-09-10 on the
   * retirement PR). `timezone` / `status` / `nextRunAt` stay: the ruling retires the
   * cron position, not the def. A scheduled flow declares its cadence on the flow's
   * start node (`config.schedule`); the one cron slot the platform evaluates is
   * `Job.schedule.expression` (`system/job.zod.ts`).
   */
  timezone: z.string().default('UTC').describe('IANA timezone for cron evaluation'),

  /** Runtime state */
  status: z.enum(['active', 'paused', 'disabled', 'expired'])
    .default('active')
    .describe('Current schedule status'),
  nextRunAt: z.string().datetime().optional().describe('Next scheduled execution timestamp'),
  lastRunAt: z.string().datetime().optional().describe('Last execution timestamp'),
  lastExecutionId: z.string().optional().describe('Execution ID of the last run'),
  lastRunStatus: ExecutionStatus.optional().describe('Status of the last run'),

  /** Execution tracking */
  totalRuns: z.number().int().min(0).default(0).describe('Total number of executions'),
  consecutiveFailures: z.number().int().min(0).default(0).describe('Consecutive failed executions'),

  /** Bounds */
  startDate: z.string().datetime().optional().describe('Schedule effective start date'),
  endDate: z.string().datetime().optional().describe('Schedule expiration date'),
  maxRuns: z.number().int().min(1).optional().describe('Maximum total executions before auto-disable'),

  /** Metadata */
  createdAt: z.string().datetime().describe('Schedule creation timestamp'),
  updatedAt: z.string().datetime().optional().describe('Last update timestamp'),
  createdBy: z.string().optional().describe('User who created the schedule'),
}));
export type ScheduleState = z.input<typeof ScheduleStateSchema>;

// ==========================================
// Type Exports
// ==========================================

export type ExecutionStepLogParsed = z.infer<typeof ExecutionStepLogSchema>;
export type ExecutionLogParsed = z.infer<typeof ExecutionLogSchema>;
export type FlowRunSummaryParsed = z.infer<typeof FlowRunSummarySchema>;
export type ExecutionErrorParsed = z.infer<typeof ExecutionErrorSchema>;
export type CheckpointParsed = z.infer<typeof CheckpointSchema>;
export type ConcurrencyPolicyParsed = z.infer<typeof ConcurrencyPolicySchema>;
export type ScheduleStateParsed = z.infer<typeof ScheduleStateSchema>;
