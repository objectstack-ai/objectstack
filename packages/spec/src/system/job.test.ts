import { describe, it, expect } from 'vitest';
import {
  CronScheduleSchema,
  IntervalScheduleSchema,
  OnceScheduleSchema,
  ScheduleSchema,
  RetryPolicySchema,
  JobSchema,
  JobExecutionStatus,
  JobExecutionSchema,
  type Schedule,
  type CronSchedule,
  type IntervalSchedule,
  type OnceSchedule,
  type RetryPolicy,
  type Job,
  type JobExecution,
} from './job.zod';

describe('CronScheduleSchema', () => {
  it('should accept valid cron schedule', () => {
    const schedule: CronSchedule = {
      type: 'cron',
      expression: '0 0 * * *',
    };

    expect(() => CronScheduleSchema.parse(schedule)).not.toThrow();
  });

  it('should apply default timezone', () => {
    const schedule = CronScheduleSchema.parse({
      type: 'cron',
      expression: '0 0 * * *',
    });

    expect(schedule.timezone).toBe('UTC');
  });

  it('should accept custom timezone', () => {
    const schedule = CronScheduleSchema.parse({
      type: 'cron',
      expression: '0 9 * * MON-FRI',
      timezone: 'America/New_York',
    });

    expect(schedule.timezone).toBe('America/New_York');
  });

  it('should accept various cron expressions', () => {
    const expressions = [
      '0 0 * * *',           // Daily at midnight
      '*/15 * * * *',        // Every 15 minutes
      '0 9 * * MON-FRI',     // Weekdays at 9 AM
      '0 0 1 * *',           // First day of month
      '0 0 * * 0',           // Every Sunday
      '30 2 * * *',          // Daily at 2:30 AM
    ];

    expressions.forEach(expression => {
      const schedule = { type: 'cron' as const, expression };
      expect(() => CronScheduleSchema.parse(schedule)).not.toThrow();
    });
  });
});

describe('IntervalScheduleSchema', () => {
  it('should accept valid interval schedule', () => {
    const schedule: IntervalSchedule = {
      type: 'interval',
      intervalMs: 60000,
    };

    expect(() => IntervalScheduleSchema.parse(schedule)).not.toThrow();
  });

  it('should accept various intervals', () => {
    const intervals = [
      1000,         // 1 second
      60000,        // 1 minute
      3600000,      // 1 hour
      86400000,     // 1 day
    ];

    intervals.forEach(intervalMs => {
      const schedule = { type: 'interval' as const, intervalMs };
      const parsed = IntervalScheduleSchema.parse(schedule);
      expect(parsed.intervalMs).toBe(intervalMs);
    });
  });

  it('should reject zero or negative intervals', () => {
    expect(() => IntervalScheduleSchema.parse({
      type: 'interval',
      intervalMs: 0,
    })).toThrow();

    expect(() => IntervalScheduleSchema.parse({
      type: 'interval',
      intervalMs: -1000,
    })).toThrow();
  });
});

describe('OnceScheduleSchema', () => {
  it('should accept valid once schedule', () => {
    const schedule: OnceSchedule = {
      type: 'once',
      at: '2024-12-31T23:59:59Z',
    };

    expect(() => OnceScheduleSchema.parse(schedule)).not.toThrow();
  });

  it('should validate datetime format', () => {
    expect(() => OnceScheduleSchema.parse({
      type: 'once',
      at: 'not-a-datetime',
    })).toThrow();

    expect(() => OnceScheduleSchema.parse({
      type: 'once',
      at: '2024-12-31T23:59:59Z',
    })).not.toThrow();
  });
});

describe('ScheduleSchema', () => {
  it('should accept cron schedule', () => {
    const schedule: Schedule = {
      type: 'cron',
      expression: '0 0 * * *',
    };

    expect(() => ScheduleSchema.parse(schedule)).not.toThrow();
  });

  it('should accept interval schedule', () => {
    const schedule: Schedule = {
      type: 'interval',
      intervalMs: 60000,
    };

    expect(() => ScheduleSchema.parse(schedule)).not.toThrow();
  });

  it('should accept once schedule', () => {
    const schedule: Schedule = {
      type: 'once',
      at: '2024-12-31T23:59:59Z',
    };

    expect(() => ScheduleSchema.parse(schedule)).not.toThrow();
  });

  it('should discriminate based on type field', () => {
    const cronSchedule = ScheduleSchema.parse({
      type: 'cron',
      expression: '0 0 * * *',
    });
    expect(cronSchedule.type).toBe('cron');

    const intervalSchedule = ScheduleSchema.parse({
      type: 'interval',
      intervalMs: 30000,
    });
    expect(intervalSchedule.type).toBe('interval');

    const onceSchedule = ScheduleSchema.parse({
      type: 'once',
      at: '2024-12-31T23:59:59Z',
    });
    expect(onceSchedule.type).toBe('once');
  });
});

describe('RetryPolicySchema', () => {
  it('should accept valid retry policy', () => {
    const policy: RetryPolicy = {
      maxRetries: 5,
      backoffMs: 2000,
      backoffMultiplier: 3,
    };

    expect(() => RetryPolicySchema.parse(policy)).not.toThrow();
  });

  // #4661: retry is opt-in since 17.0.0. `maxRetries` defaulted to 3 and
  // `backoffMultiplier` to 2 while this shape was job-only; the converged
  // declaration takes the automation side's 0 / 1, because a retry replays the
  // handler's writes and callouts and that has to be asked for. Existing job
  // documents keep the old numbers — `retry-policy-converged` writes them in —
  // so what changed is only what a NEWLY authored omission means.
  it('applies opt-in defaults: a declared but empty policy does not retry', () => {
    const policy = RetryPolicySchema.parse({});

    expect(policy.maxRetries).toBe(0);
    expect(policy.backoffMs).toBe(1000);
    expect(policy.backoffMultiplier).toBe(1);
    expect(policy.maxRetryDelayMs).toBe(30000);
    expect(policy.jitter).toBe(false);
  });

  // The two keys the convergence brought over from the automation side. They
  // are declared here only because `runWithPolicy` actually honours them
  // (ADR-0049: declared IS enforced).
  it('accepts the maxRetryDelayMs ceiling and jitter', () => {
    const policy = RetryPolicySchema.parse({ maxRetries: 5, maxRetryDelayMs: 60000, jitter: true });

    expect(policy.maxRetryDelayMs).toBe(60000);
    expect(policy.jitter).toBe(true);
  });

  it('rejects the retired `retryDelayMs` spelling with the rename prescription', () => {
    const parse = () => RetryPolicySchema.parse({ retryDelayMs: 500 });

    expect(parse).toThrow(/backoffMs/);
    expect(parse).toThrow(/retryDelayMs/);
  });

  // Bounds the job side did not have before the merge. Both fail loudly rather
  // than being silently reinterpreted — see the
  // `job-retry-policy-constraints-tightened` semantic migration note.
  it('enforces the converged bounds (maxRetries <= 10, backoffMultiplier >= 1)', () => {
    expect(() => RetryPolicySchema.parse({ maxRetries: 20 })).toThrow();
    expect(() => RetryPolicySchema.parse({ backoffMultiplier: 0.5 })).toThrow();
  });

  it('should accept zero retries', () => {
    const policy = RetryPolicySchema.parse({
      maxRetries: 0,
    });

    expect(policy.maxRetries).toBe(0);
  });

  it('should reject negative retries', () => {
    expect(() => RetryPolicySchema.parse({
      maxRetries: -1,
    })).toThrow();
  });

  it('should accept various backoff configurations', () => {
    const configs = [
      { maxRetries: 3, backoffMs: 500, backoffMultiplier: 1.5 },
      { maxRetries: 5, backoffMs: 1000, backoffMultiplier: 2 },
      { maxRetries: 10, backoffMs: 2000, backoffMultiplier: 3 },
    ];

    configs.forEach(config => {
      const parsed = RetryPolicySchema.parse(config);
      expect(parsed.maxRetries).toBe(config.maxRetries);
      expect(parsed.backoffMs).toBe(config.backoffMs);
      expect(parsed.backoffMultiplier).toBe(config.backoffMultiplier);
    });
  });

  it('should demonstrate exponential backoff', () => {
    const policy = RetryPolicySchema.parse({
      maxRetries: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
    });

    // First retry: 1000ms
    // Second retry: 2000ms
    // Third retry: 4000ms
    expect(policy.maxRetries).toBe(3);
    expect(policy.backoffMs).toBe(1000);
    expect(policy.backoffMultiplier).toBe(2);
  });
});

describe('JobSchema', () => {
  it('should accept valid minimal job', () => {
    const job: Job = {
      name: 'daily_cleanup',
      schedule: {
        type: 'cron',
        expression: '0 0 * * *',
      },
      handler: 'jobs/handler.ts',
    };

    expect(() => JobSchema.parse(job)).not.toThrow();
  });

  it('should validate job name format (snake_case)', () => {
    const validNames = [
      'daily_cleanup',
      'send_emails',
      'process_payments',
      'backup_database',
    ];

    validNames.forEach(name => {
      const job = {
        name,
        schedule: { type: 'cron' as const, expression: '0 0 * * *' },
        handler: 'jobs/handler.ts',
      };
      expect(() => JobSchema.parse(job)).not.toThrow();
    });
  });

  it('should reject invalid job name formats', () => {
    const invalidNames = [
      'DailyCleanup',  // PascalCase
      'daily-cleanup', // kebab-case
      'dailyCleanup',  // camelCase
      '123_invalid',   // starts with number
    ];

    invalidNames.forEach(name => {
      expect(() => JobSchema.parse({
        name,
        schedule: { type: 'cron', expression: '0 0 * * *' },
        handler: 'jobs/handler.ts',
      })).toThrow();
    });
  });

  it('should apply default enabled value', () => {
    const job = JobSchema.parse({
      name: 'test_job',
      schedule: { type: 'interval', intervalMs: 60000 },
      handler: 'jobs/handler.ts',
    });

    expect(job.enabled).toBe(true);
  });

  it('should accept job with all fields', () => {
    const job = {
      name: 'complex_job',
      schedule: {
        type: 'cron' as const,
        expression: '0 9 * * MON-FRI',
        timezone: 'America/New_York',
      },
      handler: 'jobs/handler.ts',
      retryPolicy: {
        maxRetries: 5,
        backoffMs: 2000,
        backoffMultiplier: 2,
      },
      timeout: 300000,
      enabled: true,
    };

    const parsed = JobSchema.parse(job);
    expect(parsed.timeout).toBe(300000);
    expect(parsed.retryPolicy?.maxRetries).toBe(5);
  });

  it('should accept different schedule types', () => {
    const schedules: Schedule[] = [
      { type: 'cron', expression: '0 0 * * *' },
      { type: 'interval', intervalMs: 60000 },
      { type: 'once', at: '2024-12-31T23:59:59Z' },
    ];

    schedules.forEach(schedule => {
      const job = {
        name: 'test_job',
        schedule,
        handler: 'jobs/handler.ts',
      };
      expect(() => JobSchema.parse(job)).not.toThrow();
    });
  });

  it('should accept job with timeout', () => {
    const job = {
      name: 'long_running_job',
      schedule: { type: 'cron' as const, expression: '0 0 * * *' },
      handler: 'jobs/handler.ts',
      timeout: 600000, // 10 minutes
    };

    const parsed = JobSchema.parse(job);
    expect(parsed.timeout).toBe(600000);
  });

  it('should accept disabled job', () => {
    const job = {
      name: 'disabled_job',
      schedule: { type: 'interval' as const, intervalMs: 30000 },
      handler: 'jobs/handler.ts',
      enabled: false,
    };

    const parsed = JobSchema.parse(job);
    expect(parsed.enabled).toBe(false);
  });
});

describe('JobExecutionStatus', () => {
  it('should accept valid execution statuses', () => {
    expect(() => JobExecutionStatus.parse('running')).not.toThrow();
    expect(() => JobExecutionStatus.parse('success')).not.toThrow();
    expect(() => JobExecutionStatus.parse('failed')).not.toThrow();
    expect(() => JobExecutionStatus.parse('timeout')).not.toThrow();
    // [#7072] The fifth value, per #5548's ruling: "completed without
    // accomplishing the work". Not a failure, never retried.
    expect(() => JobExecutionStatus.parse('degraded')).not.toThrow();
  });

  it('should reject invalid execution statuses', () => {
    expect(() => JobExecutionStatus.parse('pending')).toThrow();
    expect(() => JobExecutionStatus.parse('cancelled')).toThrow();
    expect(() => JobExecutionStatus.parse('')).toThrow();
    // [#7072] The ruling closes the vocabulary at five: "⛔ Do not open an enum
    // family; a second key would need its own pull." These are the near-misses a
    // future adapter is most likely to reach for; they stay refused.
    expect(() => JobExecutionStatus.parse('partial')).toThrow();
    expect(() => JobExecutionStatus.parse('skipped')).toThrow();
    expect(() => JobExecutionStatus.parse('Degraded')).toThrow();
  });

  it('should carry exactly the five ruled values, in declaration order', () => {
    // [#7072] Pins the vocabulary itself, not just membership: the two
    // `platform-objects` selects (`sys_job_run.status`, `sys_job.last_status`)
    // are *enforced* by ObjectQL's record validator, so this enum growing a
    // value they do not carry is a silently swallowed write rather than a type
    // error. Any change here needs the same change there.
    expect(JobExecutionStatus.options).toEqual([
      'running',
      'success',
      'failed',
      'timeout',
      'degraded',
    ]);
  });
});

describe('JobExecutionSchema', () => {
  it('should accept valid minimal job execution', () => {
    const execution: JobExecution = {
      jobId: 'job-123',
      startedAt: '2024-01-15T10:30:00Z',
      status: 'running',
    };

    expect(() => JobExecutionSchema.parse(execution)).not.toThrow();
  });

  it('should accept completed execution', () => {
    const execution = {
      jobId: 'job-123',
      startedAt: '2024-01-15T10:30:00Z',
      completedAt: '2024-01-15T10:35:00Z',
      status: 'success',
      durationMs: 300000,
    };

    const parsed = JobExecutionSchema.parse(execution);
    expect(parsed.completedAt).toBe('2024-01-15T10:35:00Z');
    expect(parsed.durationMs).toBe(300000);
  });

  it('should accept failed execution', () => {
    const execution = {
      jobId: 'job-456',
      startedAt: '2024-01-15T11:00:00Z',
      completedAt: '2024-01-15T11:05:00Z',
      status: 'failed',
      error: 'Database connection timeout',
      durationMs: 300000,
    };

    const parsed = JobExecutionSchema.parse(execution);
    expect(parsed.status).toBe('failed');
    expect(parsed.error).toBe('Database connection timeout');
  });

  it('should accept timeout execution', () => {
    const execution = {
      jobId: 'job-789',
      startedAt: '2024-01-15T12:00:00Z',
      completedAt: '2024-01-15T12:10:00Z',
      status: 'timeout',
      error: 'Job exceeded maximum execution time of 600000ms',
      durationMs: 600000,
    };

    const parsed = JobExecutionSchema.parse(execution);
    expect(parsed.status).toBe('timeout');
  });

  it('should accept degraded execution', () => {
    // [#7072] A degraded run's `reason` rides the existing `error` field — the
    // ruling's minimal vocabulary applies to columns too, so no `reason` member
    // was added. Note the cost this pins: `error` carries a non-error operator
    // note whenever the status is `degraded`.
    const execution = {
      jobId: 'job-321',
      startedAt: '2024-01-15T13:00:00Z',
      completedAt: '2024-01-15T13:00:02Z',
      status: 'degraded',
      error: 'STORE_UNAVAILABLE',
      durationMs: 2000,
    };

    const parsed = JobExecutionSchema.parse(execution);
    expect(parsed.status).toBe('degraded');
    expect(parsed.error).toBe('STORE_UNAVAILABLE');
  });

  it('should accept all execution statuses', () => {
    const statuses: Array<JobExecution['status']> = ['running', 'success', 'failed', 'timeout', 'degraded'];

    statuses.forEach(status => {
      const execution = {
        jobId: 'job-test',
        startedAt: '2024-01-15T10:00:00Z',
        status,
      };
      const parsed = JobExecutionSchema.parse(execution);
      expect(parsed.status).toBe(status);
    });
  });

  it('should validate datetime formats', () => {
    expect(() => JobExecutionSchema.parse({
      jobId: 'job-123',
      startedAt: 'not-a-datetime',
      status: 'running',
    })).toThrow();

    expect(() => JobExecutionSchema.parse({
      jobId: 'job-123',
      startedAt: '2024-01-15T10:00:00Z',
      completedAt: 'not-a-datetime',
      status: 'success',
    })).toThrow();
  });

  it('should reject execution without required fields', () => {
    expect(() => JobExecutionSchema.parse({
      startedAt: '2024-01-15T10:00:00Z',
      status: 'running',
    })).toThrow();

    expect(() => JobExecutionSchema.parse({
      jobId: 'job-123',
      status: 'running',
    })).toThrow();

    expect(() => JobExecutionSchema.parse({
      jobId: 'job-123',
      startedAt: '2024-01-15T10:00:00Z',
    })).toThrow();
  });
});

describe('Job Scheduling Integration', () => {
  it('should handle daily backup job', () => {
    const job: Job = {
      name: 'daily_backup',
      schedule: {
        type: 'cron',
        expression: '0 2 * * *', // 2 AM daily
        timezone: 'America/New_York',
      },
      handler: 'jobs/backup.ts',
      retryPolicy: {
        maxRetries: 3,
        backoffMs: 5000,
        backoffMultiplier: 2,
      },
      timeout: 1800000, // 30 minutes
      enabled: true,
    };

    expect(() => JobSchema.parse(job)).not.toThrow();
  });

  it('should handle periodic cleanup job', () => {
    const job: Job = {
      name: 'cleanup_temp_files',
      schedule: {
        type: 'interval',
        intervalMs: 3600000, // 1 hour
      },
      handler: 'jobs/cleanup.ts',
      timeout: 60000, // 1 minute
    };

    expect(() => JobSchema.parse(job)).not.toThrow();
  });

  it('should handle one-time scheduled job', () => {
    const job: Job = {
      name: 'data_migration',
      schedule: {
        type: 'once',
        at: '2024-12-31T00:00:00Z',
      },
      handler: 'jobs/migration.ts',
      retryPolicy: {
        maxRetries: 0, // No retries for migrations
      },
      timeout: 7200000, // 2 hours
    };

    expect(() => JobSchema.parse(job)).not.toThrow();
  });

  it('should track job execution history', () => {
    const executions: JobExecution[] = [
      {
        jobId: 'backup-daily',
        startedAt: '2024-01-15T02:00:00Z',
        completedAt: '2024-01-15T02:15:00Z',
        status: 'success',
        durationMs: 900000,
      },
      {
        jobId: 'backup-daily',
        startedAt: '2024-01-16T02:00:00Z',
        completedAt: '2024-01-16T02:10:00Z',
        status: 'success',
        durationMs: 600000,
      },
      {
        jobId: 'backup-daily',
        startedAt: '2024-01-17T02:00:00Z',
        completedAt: '2024-01-17T02:35:00Z',
        status: 'failed',
        error: 'Insufficient disk space',
        durationMs: 2100000,
      },
    ];

    executions.forEach(execution => {
      expect(() => JobExecutionSchema.parse(execution)).not.toThrow();
    });
  });
});

// ── `job.id` retired in 17.0.0 (#4667, ADR-0049) ────────────────────────────
describe('retired job.id (#4667)', () => {
  const base = {
    name: 'nightly_sync',
    schedule: { type: 'cron' as const, expression: '0 0 * * *' },
    handler: 'syncAll',
  };

  it('rejects `id` and says `name` is the identity', () => {
    // The damage this key did was its own describe(): "defaults to `name` when
    // omitted" advertised an identity OVERRIDE. Nothing read it, so two jobs
    // differing only in `id` were one job — the second silently winning. The
    // rejection has to name `name` or the author just deletes the key and keeps
    // wondering how to give a job a stable identifier.
    const parse = () => JobSchema.parse({ ...base, id: 'job_nightly' });
    expect(parse).toThrow(/job\.id.*removed.*17\.0\.0/s);
    expect(parse).toThrow(/`name`/s);
  });

  it('a job with only `name` parses and keeps no `id`', () => {
    const job = JobSchema.parse(base);
    expect(job).not.toHaveProperty('id');
    expect(job.name).toBe('nightly_sync');
  });
});
