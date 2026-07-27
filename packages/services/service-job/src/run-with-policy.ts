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

const RETRY_DEFAULTS = { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 } as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as any)?.unref?.();
  });
}

function withTimeout(run: () => Promise<void>, jobId: string, timeoutMs?: number): Promise<void> {
  if (!timeoutMs || timeoutMs <= 0) return run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new JobTimeoutError(jobId, timeoutMs)), timeoutMs);
    (timer as any)?.unref?.();
  });
  return Promise.race([run(), guard]).finally(() => clearTimeout(timer)) as Promise<void>;
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
 *   exponential backoff: delay = backoffMs * backoffMultiplier^(retry-1),
 *   up to maxRetries retries after the initial attempt. The last error is
 *   rethrown when all attempts fail.
 */
export async function runWithPolicy(
  jobId: string,
  run: () => Promise<void>,
  options?: JobScheduleOptions,
): Promise<void> {
  const timeoutMs = options?.timeout;
  if (!options?.retryPolicy) {
    return withTimeout(run, jobId, timeoutMs);
  }

  const maxRetries = options.retryPolicy.maxRetries ?? RETRY_DEFAULTS.maxRetries;
  const backoffMs = options.retryPolicy.backoffMs ?? RETRY_DEFAULTS.backoffMs;
  const multiplier = options.retryPolicy.backoffMultiplier ?? RETRY_DEFAULTS.backoffMultiplier;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(backoffMs * Math.pow(multiplier, attempt - 1));
    }
    try {
      await withTimeout(run, jobId, timeoutMs);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
