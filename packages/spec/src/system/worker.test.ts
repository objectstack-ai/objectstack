import { describe, it, expect } from 'vitest';
import {
  TaskPriority,
  TaskStatus,
  TaskSchema,
  TaskRetryPolicySchema,
  TaskExecutionResultSchema,
  QueueConfigSchema,
  BatchTaskSchema,
  BatchProgressSchema,
  WorkerConfigSchema,
  WorkerStatsSchema,
  TASK_PRIORITY_VALUES,
  type Task,
  type TaskRetryPolicy,
  type QueueConfig,
  type BatchTask,
  type WorkerConfig,
} from './worker.zod';

describe('TaskPriority', () => {
  it('should accept valid task priorities', () => {
    expect(() => TaskPriority.parse('critical')).not.toThrow();
    expect(() => TaskPriority.parse('high')).not.toThrow();
    expect(() => TaskPriority.parse('normal')).not.toThrow();
    expect(() => TaskPriority.parse('low')).not.toThrow();
    expect(() => TaskPriority.parse('background')).not.toThrow();
  });

  it('should reject invalid priorities', () => {
    expect(() => TaskPriority.parse('urgent')).toThrow();
    expect(() => TaskPriority.parse('medium')).toThrow();
  });

  it('should have correct priority value mappings', () => {
    expect(TASK_PRIORITY_VALUES.critical).toBe(0);
    expect(TASK_PRIORITY_VALUES.high).toBe(1);
    expect(TASK_PRIORITY_VALUES.normal).toBe(2);
    expect(TASK_PRIORITY_VALUES.low).toBe(3);
    expect(TASK_PRIORITY_VALUES.background).toBe(4);
  });
});

describe('TaskStatus', () => {
  it('should accept valid task statuses', () => {
    const statuses = ['pending', 'queued', 'processing', 'completed', 'failed', 'cancelled', 'timeout', 'dead'];
    statuses.forEach(status => {
      expect(() => TaskStatus.parse(status)).not.toThrow();
    });
  });

  it('should reject invalid statuses', () => {
    expect(() => TaskStatus.parse('running')).toThrow();
    expect(() => TaskStatus.parse('success')).toThrow();
  });
});

describe('TaskRetryPolicySchema', () => {
  it('should accept valid retry policy', () => {
    const policy: TaskRetryPolicy = {
      maxRetries: 5,
      backoffStrategy: 'exponential',
      initialDelayMs: 2000,
      maxDelayMs: 120000,
      backoffMultiplier: 3,
    };

    expect(() => TaskRetryPolicySchema.parse(policy)).not.toThrow();
  });

  it('should apply default values', () => {
    const policy = TaskRetryPolicySchema.parse({});

    expect(policy.maxRetries).toBe(3);
    expect(policy.backoffStrategy).toBe('exponential');
    expect(policy.initialDelayMs).toBe(1000);
    expect(policy.maxDelayMs).toBe(60000);
    expect(policy.backoffMultiplier).toBe(2);
  });

  it('should accept different backoff strategies', () => {
    const strategies = ['fixed', 'linear', 'exponential'];
    strategies.forEach(backoffStrategy => {
      const policy = TaskRetryPolicySchema.parse({ backoffStrategy });
      expect(policy.backoffStrategy).toBe(backoffStrategy);
    });
  });

  it('should accept zero retries', () => {
    const policy = TaskRetryPolicySchema.parse({ maxRetries: 0 });
    expect(policy.maxRetries).toBe(0);
  });

  it('should reject negative retries', () => {
    expect(() => TaskRetryPolicySchema.parse({ maxRetries: -1 })).toThrow();
  });
});

describe('TaskSchema', () => {
  it('should accept valid minimal task', () => {
    const task: Task = {
      id: 'task-123',
      type: 'send_email',
      payload: { to: 'user@example.com', subject: 'Welcome' },
    };

    expect(() => TaskSchema.parse(task)).not.toThrow();
  });

  it('should apply default values', () => {
    const task = TaskSchema.parse({
      id: 'task-123',
      type: 'process_data',
      payload: { data: 'test' },
    });

    expect(task.queue).toBe('default');
    expect(task.priority).toBe('normal');
    expect(task.attempts).toBe(0);
    expect(task.status).toBe('pending');
  });

  it('should validate task type format (snake_case)', () => {
    const validTypes = ['send_email', 'process_payment', 'generate_report'];
    validTypes.forEach(type => {
      const task = { id: 'task-123', type, payload: {} };
      expect(() => TaskSchema.parse(task)).not.toThrow();
    });
  });

  it('should reject invalid task type formats', () => {
    const invalidTypes = ['SendEmail', 'send-email', 'sendEmail', '123_invalid'];
    invalidTypes.forEach(type => {
      expect(() => TaskSchema.parse({
        id: 'task-123',
        type,
        payload: {},
      })).toThrow();
    });
  });

  it('should accept task with all fields', () => {
    const task = {
      id: 'task-456',
      type: 'complex_task',
      payload: { data: 'complex' },
      queue: 'background',
      priority: 'high',
      retryPolicy: {
        maxRetries: 5,
        backoffStrategy: 'linear',
        initialDelayMs: 2000,
        maxDelayMs: 60000,
      },
      timeoutMs: 300000,
      scheduledAt: '2024-12-31T23:59:59Z',
      attempts: 2,
      status: 'processing',
      metadata: {
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:05:00Z',
        createdBy: 'user-123',
        tags: ['urgent', 'customer-facing'],
      },
    };

    const parsed = TaskSchema.parse(task);
    expect(parsed.priority).toBe('high');
    expect(parsed.retryPolicy?.maxRetries).toBe(5);
    expect(parsed.metadata?.tags).toEqual(['urgent', 'customer-facing']);
  });

  it('should accept different priorities', () => {
    const priorities: Array<Task['priority']> = ['critical', 'high', 'normal', 'low', 'background'];
    priorities.forEach(priority => {
      const task = { id: 'task-123', type: 'test_task', payload: {}, priority };
      const parsed = TaskSchema.parse(task);
      expect(parsed.priority).toBe(priority);
    });
  });

  it('should accept different statuses', () => {
    const statuses: Array<Task['status']> = ['pending', 'queued', 'processing', 'completed', 'failed', 'cancelled', 'timeout', 'dead'];
    statuses.forEach(status => {
      const task = { id: 'task-123', type: 'test_task', payload: {}, status };
      const parsed = TaskSchema.parse(task);
      expect(parsed.status).toBe(status);
    });
  });
});

describe('TaskExecutionResultSchema', () => {
  it('should accept successful execution result', () => {
    const result = {
      taskId: 'task-123',
      status: 'completed',
      result: { sent: true, messageId: 'msg-456' },
      durationMs: 1500,
      startedAt: '2024-01-15T10:00:00Z',
      completedAt: '2024-01-15T10:00:01.500Z',
      attempt: 1,
      willRetry: false,
    };

    expect(() => TaskExecutionResultSchema.parse(result)).not.toThrow();
  });

  it('should accept failed execution result', () => {
    const result = {
      taskId: 'task-456',
      status: 'failed',
      error: {
        message: 'Connection timeout',
        stack: 'Error: Connection timeout\n  at ...',
        code: 'ETIMEDOUT',
      },
      durationMs: 30000,
      startedAt: '2024-01-15T10:00:00Z',
      completedAt: '2024-01-15T10:00:30Z',
      attempt: 2,
      willRetry: true,
    };

    const parsed = TaskExecutionResultSchema.parse(result);
    expect(parsed.error?.message).toBe('Connection timeout');
    expect(parsed.willRetry).toBe(true);
  });

  it('should accept timeout execution result', () => {
    const result = {
      taskId: 'task-789',
      status: 'timeout',
      error: {
        message: 'Task exceeded 300000ms timeout',
        code: 'TASK_TIMEOUT',
      },
      startedAt: '2024-01-15T10:00:00Z',
      completedAt: '2024-01-15T10:05:00Z',
      attempt: 1,
      willRetry: false,
    };

    expect(() => TaskExecutionResultSchema.parse(result)).not.toThrow();
  });
});

describe('QueueConfigSchema', () => {
  it('should accept valid minimal queue config', () => {
    const config: QueueConfig = {
      name: 'notifications',
    };

    expect(() => QueueConfigSchema.parse(config)).not.toThrow();
  });

  it('should apply default values', () => {
    const config = QueueConfigSchema.parse({ name: 'test_queue' });

    expect(config.concurrency).toBe(5);
    expect(config.priority).toBe(0);
  });

  it('should accept queue with rate limiting', () => {
    const config = {
      name: 'rate_limited_queue',
      concurrency: 10,
      rateLimit: {
        max: 100,
        durationMs: 60000,
      },
    };

    const parsed = QueueConfigSchema.parse(config);
    expect(parsed.rateLimit?.max).toBe(100);
    expect(parsed.rateLimit?.durationMs).toBe(60000);
  });

  it('should accept queue with auto-scaling', () => {
    const config = {
      name: 'auto_scale_queue',
      autoScale: {
        enabled: true,
        minWorkers: 2,
        maxWorkers: 20,
        scaleUpThreshold: 200,
        scaleDownThreshold: 20,
      },
    };

    const parsed = QueueConfigSchema.parse(config);
    expect(parsed.autoScale?.enabled).toBe(true);
    expect(parsed.autoScale?.maxWorkers).toBe(20);
  });

  it('should accept queue with dead letter queue', () => {
    const config = {
      name: 'main_queue',
      deadLetterQueue: 'failed_tasks',
      defaultRetryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential',
      },
    };

    const parsed = QueueConfigSchema.parse(config);
    expect(parsed.deadLetterQueue).toBe('failed_tasks');
  });
});

describe('BatchTaskSchema', () => {
  it('should accept valid batch task', () => {
    const batch: BatchTask = {
      id: 'batch-123',
      type: 'import_records',
      items: [{ name: 'Item 1' }, { name: 'Item 2' }, { name: 'Item 3' }],
    };

    expect(() => BatchTaskSchema.parse(batch)).not.toThrow();
  });

  it('should apply default values', () => {
    const batch = BatchTaskSchema.parse({
      id: 'batch-456',
      type: 'process_items',
      items: [1, 2, 3],
    });

    expect(batch.batchSize).toBe(100);
    expect(batch.queue).toBe('batch');
    expect(batch.priority).toBe('normal');
    expect(batch.parallel).toBe(true);
    expect(batch.stopOnError).toBe(false);
  });

  it('should accept batch with custom configuration', () => {
    const batch = {
      id: 'batch-789',
      type: 'export_data',
      items: Array(500).fill({ data: 'test' }),
      batchSize: 50,
      queue: 'exports',
      priority: 'high',
      parallel: false,
      stopOnError: true,
    };

    const parsed = BatchTaskSchema.parse(batch);
    expect(parsed.batchSize).toBe(50);
    expect(parsed.parallel).toBe(false);
    expect(parsed.stopOnError).toBe(true);
  });
});

describe('BatchProgressSchema', () => {
  it('should accept batch progress', () => {
    const progress = {
      batchId: 'batch-123',
      total: 1000,
      processed: 500,
      succeeded: 480,
      failed: 20,
      percentage: 50,
      status: 'running',
      startedAt: '2024-01-15T10:00:00Z',
    };

    const parsed = BatchProgressSchema.parse(progress);
    expect(parsed.percentage).toBe(50);
    expect(parsed.status).toBe('running');
  });

  it('should apply default values', () => {
    const progress = BatchProgressSchema.parse({
      batchId: 'batch-456',
      total: 100,
      percentage: 0,
      status: 'pending',
    });

    expect(progress.processed).toBe(0);
    expect(progress.succeeded).toBe(0);
    expect(progress.failed).toBe(0);
  });
});

describe('WorkerConfigSchema', () => {
  it('should accept valid worker config', () => {
    const config: WorkerConfig = {
      name: 'worker-1',
      queues: ['notifications', 'emails'],
    };

    expect(() => WorkerConfigSchema.parse(config)).not.toThrow();
  });

  it('should apply default values', () => {
    const config = WorkerConfigSchema.parse({
      name: 'worker-2',
      queues: ['default'],
    });

    expect(config.pollIntervalMs).toBe(1000);
    expect(config.visibilityTimeoutMs).toBe(30000);
    expect(config.defaultTimeoutMs).toBe(300000);
    expect(config.shutdownTimeoutMs).toBe(30000);
  });

  it('should accept worker with queue configurations', () => {
    const config = {
      name: 'worker-3',
      queues: ['high_priority', 'normal'],
      queueConfigs: [
        {
          name: 'high_priority',
          concurrency: 10,
          priority: 0,
        },
        {
          name: 'normal',
          concurrency: 5,
          priority: 1,
        },
      ],
      pollIntervalMs: 500,
      defaultTimeoutMs: 600000,
    };

    const parsed = WorkerConfigSchema.parse(config);
    expect(parsed.queueConfigs).toHaveLength(2);
    expect(parsed.pollIntervalMs).toBe(500);
  });

  it('should require at least one queue', () => {
    expect(() => WorkerConfigSchema.parse({
      name: 'worker-4',
      queues: [],
    })).toThrow();
  });
});

describe('WorkerStatsSchema', () => {
  it('should accept worker stats', () => {
    const stats = {
      workerName: 'worker-1',
      totalProcessed: 1000,
      succeeded: 950,
      failed: 50,
      active: 5,
      avgExecutionMs: 1500,
      uptimeMs: 3600000,
      queues: {
        notifications: {
          pending: 10,
          active: 3,
          completed: 500,
          failed: 25,
        },
        emails: {
          pending: 5,
          active: 2,
          completed: 450,
          failed: 25,
        },
      },
    };

    const parsed = WorkerStatsSchema.parse(stats);
    expect(parsed.totalProcessed).toBe(1000);
    expect(parsed.queues?.notifications.completed).toBe(500);
  });
});

describe('Worker Integration', () => {
  it('should handle email sending task', () => {
    const task: Task = {
      id: 'email-task-123',
      type: 'send_email',
      payload: {
        to: 'customer@example.com',
        template: 'order_confirmation',
        data: { orderId: 'ORD-123', amount: 99.99 },
      },
      queue: 'notifications',
      priority: 'high',
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential',
        initialDelayMs: 1000,
        maxDelayMs: 60000,
      },
      timeoutMs: 30000,
    };

    expect(() => TaskSchema.parse(task)).not.toThrow();
  });

  it('should handle batch import task', () => {
    const batch: BatchTask = {
      id: 'import-batch-456',
      type: 'import_customer',
      items: Array(1000).fill(null).map((_, i) => ({
        name: `Customer ${i}`,
        email: `customer${i}@example.com`,
      })),
      batchSize: 100,
      queue: 'batch_import',
      priority: 'low',
      parallel: true,
      stopOnError: false,
    };

    const parsed = BatchTaskSchema.parse(batch);
    expect(parsed.items).toHaveLength(1000);
    expect(parsed.batchSize).toBe(100);
  });

  it('should handle scheduled maintenance task', () => {
    const task: Task = {
      id: 'maintenance-daily',
      type: 'cleanup_temp_files',
      payload: { olderThanDays: 7 },
      queue: 'maintenance',
      priority: 'background',
      scheduledAt: '2024-12-31T02:00:00Z',
      timeoutMs: 3600000,
    };

    expect(() => TaskSchema.parse(task)).not.toThrow();
  });

  it('should demonstrate priority-based task processing', () => {
    const tasks: Task[] = [
      { id: '1', type: 'task_1', payload: {}, priority: 'critical' },
      { id: '2', type: 'task_2', payload: {}, priority: 'low' },
      { id: '3', type: 'task_3', payload: {}, priority: 'high' },
      { id: '4', type: 'task_4', payload: {}, priority: 'background' },
      { id: '5', type: 'task_5', payload: {}, priority: 'normal' },
    ];

    tasks.forEach(task => {
      expect(() => TaskSchema.parse(task)).not.toThrow();
    });

    // Sort by priority
    const sorted = tasks.sort((a, b) => 
      TASK_PRIORITY_VALUES[a.priority] - TASK_PRIORITY_VALUES[b.priority]
    );

    expect(sorted[0].priority).toBe('critical');
    expect(sorted[4].priority).toBe('background');
  });
});

// #15679 (stack card 4/6 of #14478) — ruling B. The old spelling is a
// `retiredKey()` tombstone; asserted on the issue CODE and the prescription,
// never on a bare `toThrow()`. The counter-example was already in this file:
// `TaskExecutionResult.durationMs` spelled the identical measurement correctly
// ninety lines up, which is what made the bare `rateLimit.duration` a drift
// rather than a convention. A silent strip here would have left a queue
// unthrottled with no error.
describe('QueueConfig.rateLimit.duration carries its unit (#15679)', () => {
  it('REFUSES the retired `rateLimit.duration` with the rename in the message', () => {
    const result = QueueConfigSchema.safeParse({
      name: 'rate_limited_queue',
      rateLimit: { max: 100, duration: 60000 },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'rateLimit.duration');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`QueueConfig.rateLimit.duration` was renamed to `durationMs`');
  });

  it('accepts `rateLimit.durationMs` at the same magnitude; `max` stays a bare COUNT', () => {
    const parsed = QueueConfigSchema.parse({
      name: 'rate_limited_queue',
      rateLimit: { max: 100, durationMs: 60000 },
    });
    expect(parsed.rateLimit?.durationMs).toBe(60000);
    expect(parsed.rateLimit?.max).toBe(100);
  });
});
