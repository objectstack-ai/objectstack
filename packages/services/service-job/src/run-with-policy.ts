// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { JobScheduleOptions } from '@objectstack/spec/contracts';

/**
 * Error thrown when a job attempt exceeds its configured `timeout`.
 * Executors map it to JobExecution status 'timeout' (vs plain 'failed').
 */
export class JobTimeoutError extends Error {
  constructor(jobId: string, timeoutMs: number) {
    super(`Job "${jobId}" timed out after ${timeoutMs}ms`);
    this.name = 'JobTimeoutError';
  }
}

/**
 * Mirrors the declared defaults of `RetryPolicySchema`
 * (`@objectstack/spec` `shared/retry-policy.zod.ts`) — the declared default IS
 * the enforced one (#4277). They apply only to a caller that hand-builds
 * `JobScheduleOptions` without going through Zod; an authored `job.retryPolicy`
 * arrives already defaulted.
 *
 * `maxRetries` was 3 and `backoffMultiplier` 2 before 17.0.0 (#4661). Existing
 * job documents keep those numbers — the `retry-policy-converged`
 * conversion writes them in — so this change is only about what an omission
 * means from now on: no retry unless asked for.
 */
const RETRY_DEFAULTS = {
  maxRetries: 0,
  backoffMs: 1000,
  backoffMultiplier: 1,
  maxRetryDelayMs: 30000,
  jitter: false,
} as const;

/**
 * How ONE attempt settled, as observed by {@link runWithPolicy} itself.
 *
 * `timedOut` is the whole point of the shape: it is reported at the instant the
 * timeout guard wins the race, while the abandoned handler is still running.
 * A recorder driven by these results therefore cannot be overtaken by a late
 * handler resolution — the value an already-timed-out attempt eventually
 * resolves to loses the race and never reaches an observer (#7734).
 */
export type JobAttemptResult<T> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; error: unknown; timedOut: boolean; durationMs: number };

/**
 * Per-attempt observer for {@link runWithPolicy}.
 *
 * Exists so the party that DURABLY RECORDS a run (`DbJobAdapter`) can be the
 * same party that OBSERVES its timeout and its attempt number. Recording from
 * outside the policy — wrapping the handler in a recorder and letting the guard
 * race the *recorder* — records whatever the abandoned handler eventually did,
 * which is how a timed-out run came to persist `status: 'success'` (#7734).
 *
 * Both callbacks are awaited: `onAttemptStart` before the attempt's clock
 * starts (so a recorder's own I/O never eats the timeout budget), and
 * `onAttemptSettled` before any retry backoff. Both are optional, and a caller
 * that passes no recorder at all gets exactly the previous behaviour.
 */
export interface JobAttemptRecorder<T = unknown> {
  /** Called once per attempt, before it starts. `attempt` is 1-based. */
  onAttemptStart?(attempt: number): void | Promise<void>;
  /** Called once per attempt, the moment it settles — timeout included. */
  onAttemptSettled?(attempt: number, result: JobAttemptResult<T>): void | Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as any)?.unref?.();
  });
}

function withTimeout<T>(run: () => Promise<T>, jobId: string, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new JobTimeoutError(jobId, timeoutMs)), timeoutMs);
    (timer as any)?.unref?.();
  });
  return Promise.race([run(), guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Execute one job run under the authored `retryPolicy` / `timeout`
 * (#3494 — JobSchema's retryPolicy/timeout used to be parsed-but-ignored).
 *
 * - No options → exactly the legacy behavior: one attempt, no time limit.
 * - `timeout` applies per attempt; an over-limit attempt rejects with
 *   {@link JobTimeoutError}. JavaScript cannot forcibly cancel the in-flight
 *   handler — the attempt is abandoned, not killed.
 * - `retryPolicy` re-runs failed attempts (including timeouts) with
 *   exponential backoff: delay = min(backoffMs * backoffMultiplier^(retry-1),
 *   maxRetryDelayMs), randomized into [50%, 100%] when `jitter` is set, up to
 *   maxRetries retries after the initial attempt. The last error is rethrown
 *   when all attempts fail.
 * - `maxRetryDelayMs` / `jitter` arrived with the 17.0.0 retry-policy
 *   convergence (#4661) and are enforced here, not merely declared: jitter is
 *   what stops a fleet of jobs that failed on the same outage from retrying in
 *   lockstep.
 *
 * An optional {@link JobAttemptRecorder} observes each attempt from INSIDE the
 * policy (#7734). It is the only way to learn that an attempt timed out at the
 * moment it did: `withTimeout` abandons the attempt but cannot cancel the
 * handler, so anything watching from outside eventually sees the abandoned
 * handler's own result and mistakes it for the run's.
 *
 * Generic in the run's resolved value, defaulting to `void` (#6617). Every
 * existing caller passes a `() => Promise<void>` and still infers `T = void`,
 * so this is purely additive — what changed is that the wrapper no longer
 * ERASES what the run resolved to. It has to stop erasing it because
 * {@link JobHandler} can now resolve a `JobRunOutcome`, and a wrapper typed
 * `() => Promise<void>` rejects that: TypeScript's return-type `void` special
 * case does not reach through `Promise<void>`. Retry semantics are untouched —
 * only a REJECTED promise retries, so a resolved outcome (degraded or not)
 * returns on the first attempt exactly as a resolved `undefined` always did.
 */
export async function runWithPolicy<T = void>(
  jobId: string,
  run: () => Promise<T>,
  options?: JobScheduleOptions,
  recorder?: JobAttemptRecorder<T>,
): Promise<T> {
  const timeoutMs = options?.timeout;
  const policy = options?.retryPolicy;

  // No policy ⇒ maxRetries 0 ⇒ the loop below runs exactly one attempt and
  // rethrows its error: the legacy single-shot path, expressed once so the
  // recorder is driven identically with and without a retry policy.
  const maxRetries = policy ? (policy.maxRetries ?? RETRY_DEFAULTS.maxRetries) : 0;
  const backoffMs = policy?.backoffMs ?? RETRY_DEFAULTS.backoffMs;
  const multiplier = policy?.backoffMultiplier ?? RETRY_DEFAULTS.backoffMultiplier;
  const maxRetryDelayMs = policy?.maxRetryDelayMs ?? RETRY_DEFAULTS.maxRetryDelayMs;
  const jitter = policy?.jitter ?? RETRY_DEFAULTS.jitter;

  let lastError: unknown;
  for (let retry = 0; retry <= maxRetries; retry++) {
    if (retry > 0) {
      // Same formula the try_catch executor runs — one policy, one backoff.
      let delay = Math.min(backoffMs * Math.pow(multiplier, retry - 1), maxRetryDelayMs);
      if (jitter) delay = delay * (0.5 + Math.random() * 0.5);
      await sleep(delay);
    }
    const attempt = retry + 1; // 1-based, as `sys_job_run.attempt` records it
    await recorder?.onAttemptStart?.(attempt);
    const startMs = Date.now();
    try {
      const value = await withTimeout(run, jobId, timeoutMs);
      await recorder?.onAttemptSettled?.(attempt, { ok: true, value, durationMs: Date.now() - startMs });
      return value;
    } catch (err) {
      await recorder?.onAttemptSettled?.(attempt, {
        ok: false,
        error: err,
        timedOut: err instanceof JobTimeoutError,
        durationMs: Date.now() - startMs,
      });
      lastError = err;
    }
  }
  throw lastError;
}
