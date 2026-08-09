import { describe, it, expect } from 'vitest';
import type { JobHandler, JobRunOutcome } from '@objectstack/spec';
import { runWithPolicy } from './run-with-policy.js';

/**
 * [#6617] `runWithPolicy` must not ERASE what a job run resolved to.
 *
 * `JobHandler` may now resolve a {@link JobRunOutcome}. A wrapper typed
 * `() => Promise<void>` rejects that at compile time — TypeScript's
 * return-type `void` special case does not reach through `Promise<void>` —
 * so the wrapper is generic with `T = void`. These cases pin the two halves:
 * the value survives the wrapper, and retry stays throw-driven so a degraded
 * report never re-runs the job.
 *
 * The `sys_job_run` mapping that CONSUMES the outcome is #5548's half and is
 * deliberately not implemented here.
 */
describe('[#6617] runWithPolicy passes the run outcome through', () => {
  it('returns a degraded outcome unchanged, with no retry policy', async () => {
    const handler: JobHandler = async () => ({ outcome: 'degraded', reason: 'STORE_UNAVAILABLE' });

    const result = await runWithPolicy('wait_wake', () => handler({ jobId: 'wait_wake' }));

    expect(result).toEqual({ outcome: 'degraded', reason: 'STORE_UNAVAILABLE' });
  });

  it('returns a degraded outcome unchanged THROUGH the retry path, without retrying', async () => {
    let attempts = 0;
    const handler: JobHandler = async () => {
      attempts++;
      return { outcome: 'degraded', reason: 'nothing to wake' } satisfies JobRunOutcome;
    };

    const result = await runWithPolicy(
      'wait_wake',
      () => handler({ jobId: 'wait_wake' }),
      { retryPolicy: { maxRetries: 3, backoffMs: 1 } },
    );

    // Resolved is resolved: degraded is not a failure, so one attempt only.
    expect(attempts).toBe(1);
    expect(result).toEqual({ outcome: 'degraded', reason: 'nothing to wake' });
  });

  it('a legacy void handler still resolves undefined — unchanged', async () => {
    const legacy: JobHandler = async () => {};

    const result = await runWithPolicy('sync_metadata', () => legacy({ jobId: 'sync_metadata' }));

    expect(result).toBeUndefined();
  });

  it('a throwing handler still retries and rethrows — unchanged', async () => {
    let attempts = 0;

    await expect(
      runWithPolicy(
        'flaky',
        async () => { attempts++; throw new Error('boom'); },
        { retryPolicy: { maxRetries: 2, backoffMs: 1 } },
      ),
    ).rejects.toThrow('boom');

    expect(attempts).toBe(3); // initial + 2 retries
  });
});
