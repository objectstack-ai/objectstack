// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A scheduled fire still running: when it started, for the skipped-tick
 * warning, and the promise that settles when it ends, for the shutdown drain.
 */
export interface ScheduledFire {
  readonly startedAt: string;
  /** Resolves once the fire has settled, however it ended. Never rejects. */
  readonly settled: Promise<void>;
}

/**
 * How long a timer adapter's `destroy()` waits, by default, for the scheduled
 * fires it holds in flight before it returns without them.
 *
 * It has to sit well inside the kernel's whole shutdown budget
 * (`ObjectKernelConfig.shutdownTimeout`, 60 s by default in
 * `@objectstack/core`), which every plugin's `destroy()` shares — the job
 * plugin's wait must leave the rest of the teardown room to run.
 */
export const DEFAULT_SHUTDOWN_DRAIN_MS = 10_000;

/**
 * Open a scheduled fire: the record the in-flight latch holds, and the
 * function that marks it settled. The caller sets the record before its first
 * `await` and calls `finish()` in a `finally`.
 */
export function openScheduledFire(): { fire: ScheduledFire; finish: () => void } {
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => { finish = resolve; });
  return { fire: { startedAt: new Date().toISOString(), settled }, finish };
}

/**
 * Wait for every fire in `inFlight` to settle, for at most `boundMs`. Answers
 * the names of the jobs whose fire was still running when the bound passed —
 * empty when everything settled in time.
 *
 * The bound's timer is cleared the moment the wait is decided and is not
 * `unref`'d while it runs, so it neither outlives the drain nor lets the
 * process exit in the middle of one.
 */
export async function drainScheduledFires(
  inFlight: ReadonlyMap<string, ScheduledFire>,
  boundMs: number,
): Promise<string[]> {
  const pending = [...inFlight.entries()];
  if (pending.length === 0) return [];
  const done = new Set<string>();
  const all = Promise.all(pending.map(([name, fire]) => fire.settled.then(() => { done.add(name); })));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, boundMs)); });
  try {
    await Promise.race([all, bound]);
  } finally {
    clearTimeout(timer);
  }
  return pending.map(([name]) => name).filter((name) => !done.has(name));
}

/**
 * The one line a drain that ran out of time leaves: which jobs it returned
 * without, and what that means for them.
 */
export function drainExpiredMessage(adapter: string, names: readonly string[], boundMs: number): string {
  const jobs = names.map((n) => `"${n}"`).join(', ');
  return (
    `${adapter}: shutdown stopped waiting for the scheduled run of ${jobs} after ${boundMs} ms; ` +
    'it is still executing and will run on without its kernel, so whatever it writes after this may fail.'
  );
}

/**
 * The one line a skipped tick leaves (#31811): which job, and which run of it
 * is still in flight. Shared by both timer adapters so the two spell it alike.
 */
export function skippedTickMessage(adapter: string, name: string, running: ScheduledFire): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(running.startedAt).getTime()) / 1000));
  return (
    `${adapter}: scheduled fire of "${name}" skipped — its run started at ${running.startedAt} ` +
    `(${seconds} s ago) is still in flight on this node. The next tick tries again.`
  );
}
