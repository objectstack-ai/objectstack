# @objectstack/service-job

Job Service for ObjectStack — implements `IJobService` with setInterval and cron scheduling.

## Features

- **Cron Scheduling**: Schedule jobs with cron expressions
- **Interval Scheduling**: Run jobs at fixed intervals
- **Job Queue**: Manage job execution queue
- **Retry Logic**: Automatic retry on failure with exponential backoff
- **Job History**: Track execution history and status
- **Concurrency Control**: Limit concurrent job execution
- **Timezone Support**: Schedule jobs in specific timezones
- **Type-Safe**: Full TypeScript support

## Installation

```bash
pnpm add @objectstack/service-job
```

## Basic Usage

```typescript
import { defineStack } from '@objectstack/spec';
import { ServiceJob } from '@objectstack/service-job';

const stack = defineStack({
  services: [
    ServiceJob.configure({
      timezone: 'America/New_York',
      maxConcurrent: 5,
    }),
  ],
});
```

## Configuration

```typescript
interface JobServiceConfig {
  /** Default timezone for cron jobs (default: 'UTC') */
  timezone?: string;

  /** Maximum concurrent job executions (default: 10) */
  maxConcurrent?: number;

  /** Enable job history tracking (default: true) */
  enableHistory?: boolean;

  /** Maximum history entries per job (default: 100) */
  maxHistorySize?: number;
}
```

## Service API

```typescript
// Get job service
const jobs = kernel.getService<IJobService>('job');
```

### Cron Jobs

```typescript
// Schedule a job with cron expression
const job = await jobs.schedule({
  name: 'daily_report',
  schedule: '0 9 * * *', // Every day at 9 AM
  handler: async (context) => {
    console.log('Generating daily report...');
    // Your job logic here
  },
  timezone: 'America/New_York',
});

// Common cron patterns:
// '*/5 * * * *'      - Every 5 minutes
// '0 */2 * * *'      - Every 2 hours
// '0 9 * * 1-5'      - Weekdays at 9 AM
// '0 0 1 * *'        - First day of every month at midnight
// '0 0 * * 0'        - Every Sunday at midnight
```

### Interval Jobs

```typescript
// Run every 30 seconds
const job = await jobs.scheduleInterval({
  name: 'health_check',
  interval: 30000, // milliseconds
  handler: async (context) => {
    console.log('Running health check...');
  },
});

// Run every 5 minutes
const job = await jobs.scheduleInterval({
  name: 'sync_data',
  interval: 5 * 60 * 1000, // 5 minutes
  handler: async (context) => {
    // Sync data
  },
});
```

### One-Time Jobs

```typescript
// Schedule a one-time job
const job = await jobs.scheduleOnce({
  name: 'send_reminder',
  runAt: new Date('2024-12-25T09:00:00Z'),
  handler: async (context) => {
    console.log('Sending holiday reminder...');
  },
});

// Schedule to run after a delay
const job = await jobs.scheduleOnce({
  name: 'delayed_task',
  delay: 3600000, // 1 hour from now
  handler: async (context) => {
    console.log('Executing delayed task...');
  },
});
```

### Job Management

```typescript
// List all jobs
const allJobs = await jobs.listJobs();

// Get job details
const job = await jobs.getJob('daily_report');

// Stop a job
await jobs.stopJob('daily_report');

// Resume a stopped job
await jobs.resumeJob('daily_report');

// Delete a job
await jobs.deleteJob('daily_report');

// Run a job immediately (ignoring schedule)
await jobs.runNow('daily_report');
```

## Advanced Features

### Job Context

```typescript
const job = await jobs.schedule({
  name: 'process_orders',
  schedule: '*/10 * * * *',
  handler: async (context) => {
    console.log('Job name:', context.jobName);
    console.log('Execution ID:', context.executionId);
    console.log('Scheduled time:', context.scheduledTime);
    console.log('Execution count:', context.executionCount);

    // Access services
    const db = context.kernel.getService('database');
    const orders = await db.find({ object: 'order', status: 'pending' });

    // Process orders...
  },
});
```

### Retry Configuration

```typescript
const job = await jobs.schedule({
  name: 'api_sync',
  schedule: '0 * * * *', // Every hour
  retry: {
    maxAttempts: 3,
    backoff: 'exponential', // 'linear' or 'exponential'
    initialDelay: 1000, // 1 second
    maxDelay: 60000, // 1 minute
  },
  handler: async (context) => {
    // May fail and retry
    await syncWithExternalAPI();
  },
});
```

### Concurrency Control

```typescript
const job = await jobs.schedule({
  name: 'heavy_processing',
  schedule: '*/5 * * * *',
  concurrency: 1, // Only one instance can run at a time
  handler: async (context) => {
    // Long-running process
  },
});
```

### Job History

```typescript
// Get execution history for a job
const history = await jobs.getJobHistory('daily_report', {
  limit: 50,
  status: 'success', // 'success', 'failed', 'running'
});

// Example history entry:
// {
//   executionId: 'exec:abc123',
//   jobName: 'daily_report',
//   status: 'success',
//   startedAt: '2024-01-15T09:00:00Z',
//   completedAt: '2024-01-15T09:05:23Z',
//   duration: 323000, // milliseconds
//   error: null,
//   result: { records: 1250 }
// }

// Clear history for a job
await jobs.clearHistory('daily_report');
```

### Job Data & Results

```typescript
const job = await jobs.schedule({
  name: 'data_export',
  schedule: '0 0 * * *',
  handler: async (context) => {
    const records = await exportData();

    // Return result data
    return {
      recordCount: records.length,
      fileSize: calculateSize(records),
      exportedAt: new Date(),
    };
  },
});

// Get last execution result
const lastRun = await jobs.getLastExecution('data_export');
console.log('Last export:', lastRun.result);
```

## Common Patterns

### Database Cleanup Job

```typescript
jobs.schedule({
  name: 'cleanup_old_records',
  schedule: '0 2 * * *', // 2 AM daily
  handler: async (context) => {
    const db = context.kernel.getService('database');

    // Delete records older than 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    await db.delete({
      object: 'audit_log',
      filters: [{ field: 'created_at', operator: 'lt', value: cutoff }],
    });
  },
});
```

### Report Generation Job

```typescript
jobs.schedule({
  name: 'weekly_sales_report',
  schedule: '0 8 * * 1', // Mondays at 8 AM
  handler: async (context) => {
    const analytics = context.kernel.getService('analytics');

    const data = await analytics.query({
      object: 'order',
      aggregations: [{ function: 'sum', field: 'amount' }],
      groupBy: ['sales_rep'],
      filters: [{ field: 'created_at', operator: 'last_week' }],
    });

    // Generate and email report
    await sendReport(data);
  },
});
```

### Cache Warming Job

```typescript
jobs.scheduleInterval({
  name: 'warm_cache',
  interval: 15 * 60 * 1000, // Every 15 minutes
  handler: async (context) => {
    const cache = context.kernel.getService('cache');

    // Pre-load frequently accessed data
    const popularProducts = await getPopularProducts();
    await cache.set('popular_products', popularProducts, { ttl: 900 });
  },
});
```

## REST API Endpoints

```
GET    /api/v1/jobs                    # List all jobs
GET    /api/v1/jobs/:name              # Get job details
POST   /api/v1/jobs/:name/run          # Run job immediately
POST   /api/v1/jobs/:name/stop         # Stop job
POST   /api/v1/jobs/:name/resume       # Resume job
DELETE /api/v1/jobs/:name              # Delete job
GET    /api/v1/jobs/:name/history      # Get execution history
```

## Best Practices

1. **Idempotent Handlers**: Job handlers should be idempotent (safe to run multiple times)
2. **Error Handling**: Always handle errors gracefully and log failures
3. **Timeout Limits**: Set reasonable timeout limits for long-running jobs
4. **Resource Limits**: Limit concurrent executions to avoid overloading the system
5. **Monitoring**: Monitor job execution times and failure rates
6. **Timezone Awareness**: Always specify timezone for cron jobs to avoid ambiguity
7. **Cleanup**: Periodically delete old job history to save storage

## Performance Considerations

- **Concurrency**: Limit concurrent jobs based on system resources
- **Job Duration**: Keep job execution time reasonable (< 5 minutes ideal)
- **History Size**: Limit history entries to prevent memory bloat
- **Batch Processing**: Process records in batches for large datasets

## Contract Implementation

Implements `IJobService` from `@objectstack/spec/contracts`:

```typescript
interface IJobService {
  schedule(options: ScheduleOptions): Promise<Job>;
  scheduleInterval(options: IntervalOptions): Promise<Job>;
  scheduleOnce(options: OnceOptions): Promise<Job>;
  getJob(name: string): Promise<Job>;
  listJobs(filter?: JobFilter): Promise<Job[]>;
  stopJob(name: string): Promise<void>;
  resumeJob(name: string): Promise<void>;
  deleteJob(name: string): Promise<void>;
  runNow(name: string): Promise<JobExecution>;
  getJobHistory(name: string, options?: HistoryOptions): Promise<JobExecution[]>;
}
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [Cron Expression Generator](https://crontab.guru/)
- [@objectstack/spec/contracts](../../spec/src/contracts/)
- [Job Scheduling Guide](/content/docs/kernel/runtime-services/queue-service.mdx)
