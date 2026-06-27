// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';

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
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

// ==========================================
// 2. Execution Log
// ==========================================

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
  iteration: z.number().int().min(0).optional().describe('Zero-based loop iteration or parallel branch index of the enclosing region'),
  regionKind: z.string().optional().describe('Region kind the step ran in: loop-body | parallel-branch | try | catch'),
}));
export type ExecutionStepLog = z.infer<typeof ExecutionStepLogSchema>;

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
export type ExecutionLog = z.infer<typeof ExecutionLogSchema>;

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
export type ExecutionErrorSeverity = z.infer<typeof ExecutionErrorSeverity>;

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
export type ExecutionError = z.infer<typeof ExecutionErrorSchema>;

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
export type Checkpoint = z.infer<typeof CheckpointSchema>;

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
export type ConcurrencyPolicy = z.infer<typeof ConcurrencyPolicySchema>;

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

  /** Schedule configuration */
  cronExpression: CronExpressionInputSchema.describe('Cron expression — cron`0 9 * * MON-FRI`'),
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
export type ScheduleState = z.infer<typeof ScheduleStateSchema>;

// ==========================================
// Type Exports
// ==========================================

export type ExecutionStepLogParsed = z.infer<typeof ExecutionStepLogSchema>;
export type ExecutionLogParsed = z.infer<typeof ExecutionLogSchema>;
export type ExecutionErrorParsed = z.infer<typeof ExecutionErrorSchema>;
export type CheckpointParsed = z.infer<typeof CheckpointSchema>;
export type ConcurrencyPolicyParsed = z.infer<typeof ConcurrencyPolicySchema>;
export type ScheduleStateParsed = z.infer<typeof ScheduleStateSchema>;
