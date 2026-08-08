// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Worker System Protocol
 * 
 * Background task processing system with queues, priorities, and retry logic.
 * Provides a robust foundation for async task execution similar to:
 * - Sidekiq (Ruby)
 * - Celery (Python)
 * - Bull/BullMQ (Node.js)
 * - AWS SQS/Lambda
 * 
 * Features:
 * - Task queues with priorities
 * - Task scheduling and retry logic
 * - Batch processing
 * - Dead letter queues
 * - Task monitoring and logging
 * 
 * @example Basic task
 * ```typescript
 * const task: Task = {
 *   id: 'task-123',
 *   type: 'send_email',
 *   payload: { to: 'user@example.com', subject: 'Welcome' },
 *   queue: 'notifications',
 *   priority: 5
 * };
 * ```
 */

// ==========================================
// Task Priority
// ==========================================

/**
 * Task Priority Enum
 * Lower numbers = higher priority
 */
import { lazySchema } from '../shared/lazy-schema';
export const TaskPriority = z.enum([
  'critical',   // 0 - Must execute immediately
  'high',       // 1 - Execute soon
  'normal',     // 2 - Default priority
  'low',        // 3 - Execute when resources available
  'background', // 4 - Execute during low-traffic periods
]);

export type TaskPriority = z.input<typeof TaskPriority>;

/**
 * Task Priority Mapping
 * Maps priority names to numeric values for sorting
 */
export const TASK_PRIORITY_VALUES: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

// ==========================================
// Task Status
// ==========================================

/**
 * Task Status Enum
 * Lifecycle states of a task
 */
export const TaskStatus = z.enum([
  'pending',      // Waiting to be processed
  'queued',       // In queue, ready for worker
  'processing',   // Currently being executed
  'completed',    // Successfully completed
  'failed',       // Failed (may retry)
  'cancelled',    // Manually cancelled
  'timeout',      // Exceeded execution timeout
  'dead',         // Moved to dead letter queue
]);

export type TaskStatus = z.input<typeof TaskStatus>;

// ==========================================
// Task Schema
// ==========================================

/**
 * Task Retry Policy Schema
 * Configuration for task retry behavior
 */
export const TaskRetryPolicySchema = lazySchema(() => z.object({
  maxRetries: z.number().int().min(0).default(3).describe('Maximum retry attempts'),
  backoffStrategy: z.enum(['fixed', 'linear', 'exponential']).default('exponential')
    .describe('Backoff strategy between retries'),
  initialDelayMs: z.number().int().positive().default(1000).describe('Initial retry delay in milliseconds'),
  maxDelayMs: z.number().int().positive().default(60000).describe('Maximum retry delay in milliseconds'),
  backoffMultiplier: z.number().positive().default(2).describe('Multiplier for exponential backoff'),
}));

export type TaskRetryPolicy = z.input<typeof TaskRetryPolicySchema>;
/** Post-parse shape of {@link TaskRetryPolicy} — defaults applied, transforms run (ADR-0122). */
export type TaskRetryPolicyParsed = z.infer<typeof TaskRetryPolicySchema>;

/**
 * Task Schema
 * Represents a background task to be executed
 * 
 * @example
 * {
 *   "id": "task-abc123",
 *   "type": "send_email",
 *   "payload": { "to": "user@example.com", "template": "welcome" },
 *   "queue": "notifications",
 *   "priority": "high",
 *   "retryPolicy": {
 *     "maxRetries": 3,
 *     "backoffStrategy": "exponential"
 *   }
 * }
 */
export const TaskSchema = lazySchema(() => z.object({
  /**
   * Unique task identifier
   */
  id: z.string().describe('Unique task identifier'),
  
  /**
   * Task type (handler identifier)
   */
  type: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Task type (snake_case)'),
  
  /**
   * Task payload data
   */
  payload: z.unknown().describe('Task payload data'),
  
  /**
   * Queue name
   */
  queue: z.string().default('default').describe('Queue name'),
  
  /**
   * Task priority
   */
  priority: TaskPriority.default('normal').describe('Task priority level'),
  
  /**
   * Retry policy
   */
  retryPolicy: TaskRetryPolicySchema.optional().describe('Retry policy configuration'),
  
  /**
   * Execution timeout in milliseconds
   */
  timeoutMs: z.number().int().positive().optional().describe('Task timeout in milliseconds'),
  
  /**
   * Scheduled execution time
   */
  scheduledAt: z.string().datetime().optional().describe('ISO 8601 datetime to execute task'),
  
  /**
   * Maximum execution attempts
   */
  attempts: z.number().int().min(0).default(0).describe('Number of execution attempts'),
  
  /**
   * Task status
   */
  status: TaskStatus.default('pending').describe('Current task status'),
  
  /**
   * Task metadata
   */
  metadata: z.object({
    createdAt: z.string().datetime().optional().describe('When task was created'),
    updatedAt: z.string().datetime().optional().describe('Last update time'),
    createdBy: z.string().optional().describe('User who created task'),
    tags: z.array(z.string()).optional().describe('Task tags for filtering'),
  }).optional().describe('Task metadata'),
}));

export type Task = z.input<typeof TaskSchema>;
/** Post-parse shape of {@link Task} — defaults applied, transforms run (ADR-0122). */
export type TaskParsed = z.infer<typeof TaskSchema>;

// ==========================================
// Task Execution Result
// ==========================================

/**
 * Task Execution Result Schema
 * Result of a task execution attempt
 */
export const TaskExecutionResultSchema = lazySchema(() => z.object({
  /**
   * Task identifier
   */
  taskId: z.string().describe('Task identifier'),
  
  /**
   * Execution status
   */
  status: TaskStatus.describe('Execution status'),
  
  /**
   * Execution result data
   */
  result: z.unknown().optional().describe('Execution result data'),
  
  /**
   * Error information
   */
  error: z.object({
    message: z.string().describe('Error message'),
    stack: z.string().optional().describe('Error stack trace'),
    code: z.string().optional().describe('Error code'),
  }).optional().describe('Error details if failed'),
  
  /**
   * Execution duration
   */
  durationMs: z.number().int().optional().describe('Execution duration in milliseconds'),
  
  /**
   * Execution timestamps
   */
  startedAt: z.string().datetime().describe('When execution started'),
  completedAt: z.string().datetime().optional().describe('When execution completed'),
  
  /**
   * Retry information
   */
  attempt: z.number().int().min(1).describe('Attempt number (1-indexed)'),
  willRetry: z.boolean().describe('Whether task will be retried'),
}));

export type TaskExecutionResult = z.input<typeof TaskExecutionResultSchema>;

// ==========================================
// Queue Configuration
// ==========================================

/**
 * Queue Configuration Schema
 * Configuration for a task queue
 * 
 * @example
 * {
 *   "name": "notifications",
 *   "concurrency": 10,
 *   "rateLimit": {
 *     "max": 100,
 *     "duration": 60000
 *   }
 * }
 */
export const QueueConfigSchema = lazySchema(() => z.object({
  /**
   * Queue name
   */
  name: z.string().describe('Queue name (snake_case)'),
  
  /**
   * Maximum concurrent workers
   */
  concurrency: z.number().int().min(1).default(5).describe('Max concurrent task executions'),
  
  /**
   * Rate limiting
   */
  rateLimit: z.object({
    max: z.number().int().positive().describe('Maximum tasks per duration'),
    duration: z.number().int().positive().describe('Duration in milliseconds'),
  }).optional().describe('Rate limit configuration'),
  
  /**
   * Default retry policy
   */
  defaultRetryPolicy: TaskRetryPolicySchema.optional().describe('Default retry policy for tasks'),
  
  /**
   * Dead letter queue
   */
  deadLetterQueue: z.string().optional().describe('Dead letter queue name'),
  
  /**
   * Queue priority
   */
  priority: z.number().int().min(0).default(0).describe('Queue priority (lower = higher priority)'),
  
  /**
   * Auto-scaling configuration
   */
  autoScale: z.object({
    enabled: z.boolean().default(false).describe('Enable auto-scaling'),
    minWorkers: z.number().int().min(1).default(1).describe('Minimum workers'),
    maxWorkers: z.number().int().min(1).default(10).describe('Maximum workers'),
    scaleUpThreshold: z.number().int().positive().default(100).describe('Queue size to scale up'),
    scaleDownThreshold: z.number().int().min(0).default(10).describe('Queue size to scale down'),
  }).optional().describe('Auto-scaling configuration'),
}));

export type QueueConfig = z.input<typeof QueueConfigSchema>;
/** Post-parse shape of {@link QueueConfig} — defaults applied, transforms run (ADR-0122). */
export type QueueConfigParsed = z.infer<typeof QueueConfigSchema>;

// ==========================================
// Batch Processing
// ==========================================

/**
 * Batch Task Schema
 * Configuration for batch processing multiple items
 * 
 * @example
 * {
 *   "id": "batch-import-123",
 *   "type": "import_records",
 *   "items": [{ "name": "Item 1" }, { "name": "Item 2" }],
 *   "batchSize": 100,
 *   "queue": "batch_processing"
 * }
 */
export const BatchTaskSchema = lazySchema(() => z.object({
  /**
   * Batch job identifier
   */
  id: z.string().describe('Unique batch job identifier'),
  
  /**
   * Task type for processing each item
   */
  type: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Task type (snake_case)'),
  
  /**
   * Items to process
   */
  items: z.array(z.unknown()).describe('Array of items to process'),
  
  /**
   * Batch size (items per task)
   */
  batchSize: z.number().int().min(1).default(100).describe('Number of items per batch'),
  
  /**
   * Queue name
   */
  queue: z.string().default('batch').describe('Queue for batch tasks'),
  
  /**
   * Priority
   */
  priority: TaskPriority.default('normal').describe('Batch task priority'),
  
  /**
   * Parallel processing
   */
  parallel: z.boolean().default(true).describe('Process batches in parallel'),
  
  /**
   * Stop on error
   */
  stopOnError: z.boolean().default(false).describe('Stop batch if any item fails'),
  
  /**
   * Progress callback
   * 
   * Called after each batch completes to report progress.
   * Invoked asynchronously and should not throw errors.
   * If the callback throws, the error is logged but batch processing continues.
   * 
   * @param progress - Object containing processed count, total count, and failed count
   */
  onProgress: z.function()
    .input(z.tuple([z.object({
      processed: z.number(),
      total: z.number(),
      failed: z.number(),
    })]))
    .output(z.void())
    .optional()
    .describe('Progress callback function (called after each batch)'),
}));

export type BatchTask = z.input<typeof BatchTaskSchema>;
/** Post-parse shape of {@link BatchTask} — defaults applied, transforms run (ADR-0122). */
export type BatchTaskParsed = z.infer<typeof BatchTaskSchema>;

/**
 * Batch Progress Schema
 * Tracks progress of a batch job
 */
export const BatchProgressSchema = lazySchema(() => z.object({
  /**
   * Batch job identifier
   */
  batchId: z.string().describe('Batch job identifier'),
  
  /**
   * Total items
   */
  total: z.number().int().min(0).describe('Total number of items'),
  
  /**
   * Processed items
   */
  processed: z.number().int().min(0).default(0).describe('Items processed'),
  
  /**
   * Successful items
   */
  succeeded: z.number().int().min(0).default(0).describe('Items succeeded'),
  
  /**
   * Failed items
   */
  failed: z.number().int().min(0).default(0).describe('Items failed'),
  
  /**
   * Progress percentage
   */
  percentage: z.number().min(0).max(100).describe('Progress percentage'),
  
  /**
   * Status
   */
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).describe('Batch status'),
  
  /**
   * Timestamps
   */
  startedAt: z.string().datetime().optional().describe('When batch started'),
  completedAt: z.string().datetime().optional().describe('When batch completed'),
}));

export type BatchProgress = z.input<typeof BatchProgressSchema>;
/** Post-parse shape of {@link BatchProgress} — defaults applied, transforms run (ADR-0122). */
export type BatchProgressParsed = z.infer<typeof BatchProgressSchema>;

// ==========================================
// Worker Configuration
// ==========================================

/**
 * Worker Configuration Schema
 * Configuration for a worker instance
 */
export const WorkerConfigSchema = lazySchema(() => z.object({
  /**
   * Worker name
   */
  name: z.string().describe('Worker name'),
  
  /**
   * Queues to process
   */
  queues: z.array(z.string()).min(1).describe('Queue names to process'),
  
  /**
   * Queue configurations
   */
  queueConfigs: z.array(QueueConfigSchema).optional().describe('Queue configurations'),
  
  /**
   * Polling interval
   */
  pollIntervalMs: z.number().int().positive().default(1000).describe('Queue polling interval in milliseconds'),
  
  /**
   * Visibility timeout
   */
  visibilityTimeoutMs: z.number().int().positive().default(30000)
    .describe('How long a task is invisible after being claimed'),
  
  /**
   * Task timeout
   */
  defaultTimeoutMs: z.number().int().positive().default(300000).describe('Default task timeout in milliseconds'),
  
  /**
   * Graceful shutdown timeout
   */
  shutdownTimeoutMs: z.number().int().positive().default(30000)
    .describe('Graceful shutdown timeout in milliseconds'),
  
  /**
   * Task handlers
   */
  handlers: z.record(z.string(), z.function()).optional().describe('Task type handlers'),
}));

export type WorkerConfig = z.input<typeof WorkerConfigSchema>;
/** Post-parse shape of {@link WorkerConfig} — defaults applied, transforms run (ADR-0122). */
export type WorkerConfigParsed = z.infer<typeof WorkerConfigSchema>;

// ==========================================
// Worker Stats
// ==========================================

/**
 * Worker Stats Schema
 * Runtime statistics for a worker
 */
export const WorkerStatsSchema = lazySchema(() => z.object({
  /**
   * Worker name
   */
  workerName: z.string().describe('Worker name'),
  
  /**
   * Total tasks processed
   */
  totalProcessed: z.number().int().min(0).describe('Total tasks processed'),
  
  /**
   * Successful tasks
   */
  succeeded: z.number().int().min(0).describe('Successful tasks'),
  
  /**
   * Failed tasks
   */
  failed: z.number().int().min(0).describe('Failed tasks'),
  
  /**
   * Active tasks
   */
  active: z.number().int().min(0).describe('Currently active tasks'),
  
  /**
   * Average execution time
   */
  avgExecutionMs: z.number().min(0).optional().describe('Average execution time in milliseconds'),
  
  /**
   * Uptime
   */
  uptimeMs: z.number().int().min(0).describe('Worker uptime in milliseconds'),
  
  /**
   * Queue stats
   */
  queues: z.record(z.string(), z.object({
    pending: z.number().int().min(0).describe('Pending tasks'),
    active: z.number().int().min(0).describe('Active tasks'),
    completed: z.number().int().min(0).describe('Completed tasks'),
    failed: z.number().int().min(0).describe('Failed tasks'),
  })).optional().describe('Per-queue statistics'),
}));

export type WorkerStats = z.input<typeof WorkerStatsSchema>;

// ==========================================
// Helper Functions
// ==========================================

/**
 * Helper to create a task
 */
export const Task = Object.assign(TaskSchema, {
  create: <T extends z.input<typeof TaskSchema>>(task: T) => task,
});

/**
 * Helper to create a queue config
 */
export const QueueConfig = Object.assign(QueueConfigSchema, {
  create: <T extends z.input<typeof QueueConfigSchema>>(config: T) => config,
});

/**
 * Helper to create a worker config
 */
export const WorkerConfig = Object.assign(WorkerConfigSchema, {
  create: <T extends z.input<typeof WorkerConfigSchema>>(config: T) => config,
});

/**
 * Helper to create a batch task
 */
export const BatchTask = Object.assign(BatchTaskSchema, {
  create: <T extends z.input<typeof BatchTaskSchema>>(batch: T) => batch,
});
