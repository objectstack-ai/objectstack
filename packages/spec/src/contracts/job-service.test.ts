import { describe, it, expect } from 'vitest';
import type { IJobService, JobHandler, JobRunOutcome, JobExecution } from './job-service';

describe('Job Service Contract', () => {
  it('should allow a minimal IJobService implementation with required methods', () => {
    const service: IJobService = {
      schedule: async (_name, _schedule, _handler) => {},
      cancel: async (_name) => {},
      trigger: async (_name, _data?) => {},
    };

    expect(typeof service.schedule).toBe('function');
    expect(typeof service.cancel).toBe('function');
    expect(typeof service.trigger).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const service: IJobService = {
      schedule: async () => {},
      cancel: async () => {},
      trigger: async () => {},
      getExecutions: async (_name, _limit?) => [],
      listJobs: async () => [],
    };

    expect(service.getExecutions).toBeDefined();
    expect(service.listJobs).toBeDefined();
  });

  it('should schedule and trigger a job', async () => {
    const jobs = new Map<string, JobHandler>();

    const service: IJobService = {
      schedule: async (name, _schedule, handler) => {
        jobs.set(name, handler);
      },
      cancel: async (name) => { jobs.delete(name); },
      trigger: async (name, data?) => {
        const handler = jobs.get(name);
        if (handler) await handler({ jobId: name, data });
      },
    };

    const executed: string[] = [];
    await service.schedule(
      'sync_metadata',
      { type: 'cron', expression: '0 0 * * *' },
      async (ctx) => { executed.push(ctx.jobId); },
    );

    await service.trigger('sync_metadata');
    expect(executed).toEqual(['sync_metadata']);
  });

  it('should cancel a scheduled job', async () => {
    const jobs = new Map<string, JobHandler>();

    const service: IJobService = {
      schedule: async (name, _schedule, handler) => { jobs.set(name, handler); },
      cancel: async (name) => { jobs.delete(name); },
      trigger: async (name) => {
        const handler = jobs.get(name);
        if (handler) await handler({ jobId: name });
      },
    };

    const executed: string[] = [];
    await service.schedule('cleanup', { type: 'interval', intervalMs: 60000 }, async (ctx) => {
      executed.push(ctx.jobId);
    });

    await service.cancel('cleanup');
    await service.trigger('cleanup');
    expect(executed).toHaveLength(0);
  });

  it('should return job executions', async () => {
    const executions: JobExecution[] = [
      { jobId: 'sync', status: 'success', startedAt: '2025-01-01T00:00:00Z', completedAt: '2025-01-01T00:00:05Z', durationMs: 5000 },
      { jobId: 'sync', status: 'failed', startedAt: '2025-01-02T00:00:00Z', error: 'Connection timeout' },
    ];

    const service: IJobService = {
      schedule: async () => {},
      cancel: async () => {},
      trigger: async () => {},
      getExecutions: async (name, limit?) => {
        const filtered = executions.filter(e => e.jobId === name);
        return limit ? filtered.slice(0, limit) : filtered;
      },
    };

    const results = await service.getExecutions!('sync');
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('success');
    expect(results[1].error).toBe('Connection timeout');
  });

  it('should list registered jobs', async () => {
    const service: IJobService = {
      schedule: async () => {},
      cancel: async () => {},
      trigger: async () => {},
      listJobs: async () => ['sync_metadata', 'cleanup_logs', 'send_reports'],
    };

    const jobs = await service.listJobs!();
    expect(jobs).toHaveLength(3);
    expect(jobs).toContain('cleanup_logs');
  });
});

/**
 * [#6617] The degraded-outcome reporting channel — the spec half of #5548's
 * B-minimal ruling.
 *
 * These are COMPILE-TIME pins first and runtime assertions second: the package
 * type-checks its tests through `tsconfig.test.json`, so an assignability pin
 * here is a real check rather than a phantom one. Reverse verification for the
 * whole block is `JobHandler`'s return type narrowed back to `Promise<void>` —
 * which reddens the `degraded` direction only, and leaves every legacy pin
 * green. That asymmetry IS additivity.
 */
describe('[#6617] JobHandler degraded-outcome channel', () => {
  /**
   * The handler type EXACTLY as it stood before #6617. Pinning it as a
   * standalone declaration is what makes the additivity claim falsifiable:
   * if the union ever stops being a widening, these assignments break.
   */
  type PreIssue6617JobHandler = (context: { jobId: string; data?: unknown }) => Promise<void>;

  it('(a) an existing Promise< void > handler is unchanged — additivity, implementer side', async () => {
    // Written the way every handler in the repo is written today: no return.
    const legacy: PreIssue6617JobHandler = async (ctx) => {
      void ctx.jobId;
    };

    // The pin: the PRE-change type is still assignable to the post-change one.
    // A narrowing (rather than a widening) of JobHandler breaks this line.
    const stillAJobHandler: JobHandler = legacy;

    // …and inline literals keep inferring, with no annotation ceremony.
    const inlineLegacy: JobHandler = async () => {};

    await expect(stillAJobHandler({ jobId: 'sync_metadata' })).resolves.toBeUndefined();
    await expect(inlineLegacy({ jobId: 'sync_metadata' })).resolves.toBeUndefined();
  });

  it('(b) a handler reporting { outcome: degraded, reason } is type-legal', async () => {
    // THE pin that must go red when the union is narrowed back to Promise< void >.
    const degraded: JobHandler = async () => ({
      outcome: 'degraded',
      reason: 'STORE_UNAVAILABLE',
    });

    const completed: JobHandler = async () => ({ outcome: 'completed' });

    await expect(degraded({ jobId: 'wait_wake' })).resolves.toEqual({
      outcome: 'degraded',
      reason: 'STORE_UNAVAILABLE',
    });
    await expect(completed({ jobId: 'wait_wake' })).resolves.toEqual({ outcome: 'completed' });
  });

  it('reason is optional, and the outcome union admits exactly two members', async () => {
    const bare: JobRunOutcome = { outcome: 'degraded' };
    expect(bare.reason).toBeUndefined();

    // @ts-expect-error 'skipped' is not a member of the outcome union — the
    // third state is `degraded`, and new states are a spec decision, not a
    // free-text field. (This directive is live: the tests are type-checked.)
    const bogus: JobRunOutcome = { outcome: 'skipped' };
    expect(bogus.outcome).toBe('skipped');
  });

  it('an adapter that IGNORES the resolved value keeps todays behaviour exactly', async () => {
    // This is `DbJobAdapter.wrap()`'s shape as it stands on main (L161-176):
    // `await handler(ctx)` discards the resolved value, and only a THROW takes
    // the failure branch. #5548 is what teaches it to read the value.
    const recorded: string[] = [];
    const wrap = (handler: JobHandler): JobHandler => async (ctx) => {
      try {
        await handler(ctx);
        recorded.push('success');
      } catch {
        recorded.push('failed');
      }
    };

    await wrap(async () => {})({ jobId: 'legacy' });
    await wrap(async () => ({ outcome: 'degraded', reason: 'nothing to wake' }))({ jobId: 'new' });

    // Both land on `success` — an unwired adapter cannot regress, which is the
    // safety argument for landing the spec half first.
    expect(recorded).toEqual(['success', 'success']);
  });

  it('a consumer that DOES read the value distinguishes all three states', async () => {
    // The mapping #5548 will implement, pinned here at the contract level so
    // the spec half states what the services half owes.
    const classify = async (handler: JobHandler): Promise<'success' | 'degraded' | 'failed'> => {
      let result: void | JobRunOutcome;
      try {
        result = await handler({ jobId: 'j' });
      } catch {
        return 'failed';
      }
      // Reporting nothing is success — "不回报 = 现状".
      return result && result.outcome === 'degraded' ? 'degraded' : 'success';
    };

    expect(await classify(async () => {})).toBe('success');
    expect(await classify(async () => ({ outcome: 'completed' }))).toBe('success');
    expect(await classify(async () => ({ outcome: 'degraded', reason: 'x' }))).toBe('degraded');
    expect(await classify(async () => { throw new Error('boom'); })).toBe('failed');
  });

  it('degraded does not travel the retry path — retry is throw-driven', async () => {
    // Mirrors `runWithPolicy`: retries are driven by a REJECTED promise, so a
    // resolved degraded report can never re-run the job.
    let attempts = 0;
    const runWithRetry = async (handler: JobHandler, maxRetries: number) => {
      for (let i = 0; i <= maxRetries; i++) {
        try {
          return await handler({ jobId: 'j' });
        } catch (err) {
          if (i === maxRetries) throw err;
        }
      }
    };

    const degraded: JobHandler = async () => {
      attempts++;
      return { outcome: 'degraded', reason: 'STORE_UNAVAILABLE' };
    };

    const outcome = await runWithRetry(degraded, 3);
    expect(attempts).toBe(1); // ← not 4: degraded is not a failure
    expect(outcome).toEqual({ outcome: 'degraded', reason: 'STORE_UNAVAILABLE' });

    let thrownAttempts = 0;
    await expect(runWithRetry(async () => { thrownAttempts++; throw new Error('boom'); }, 3))
      .rejects.toThrow('boom');
    expect(thrownAttempts).toBe(4); // ← a throw still retries, unchanged
  });
});
