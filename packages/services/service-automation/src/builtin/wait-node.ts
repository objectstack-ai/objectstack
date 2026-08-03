// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { IJobService } from '@objectstack/spec/contracts';
import type { AutomationEngine, SuspendedRunStore } from '../engine.js';

/**
 * `wait` built-in node — a durable pause (ADR-0019 suspend/resume), the timer /
 * signal sibling of the human-input `screen` and `approval` nodes.
 *
 * On entry the node *suspends* the run (the engine snapshots the continuation
 * and returns `{ status: 'paused', runId }`). How it resumes depends on
 * `waitEventConfig.eventType`:
 *
 *  - **timer** — schedule a one-shot job (`IJobService`, `{ type: 'once', at }`)
 *    that calls `engine.resume(runId)` when the duration elapses. With no job
 *    service the node still suspends, but resumption must come from an external
 *    `resume(runId)` (logged) — never silently no-ops or fails the flow,
 *    matching the platform's degrade-don't-crash convention.
 *  - **signal / webhook / manual / condition** — suspend with the signal name as
 *    the correlation key; an external producer resumes the run when the event
 *    arrives (`resume(runId)`), exactly like a decision-less approval.
 *
 * Reads its own run id from the `$runId` variable the engine injects at start
 * (same mechanism the approval node uses to map external state back to the run).
 */
export function registerWaitNode(engine: AutomationEngine, ctx: PluginContext): void {
  const getJobService = (): IJobService | undefined => {
    try {
      return ctx.getService<IJobService>('job');
    } catch {
      return undefined;
    }
  };

  engine.registerNodeExecutor({
    type: 'wait',
    descriptor: defineActionDescriptor({
      type: 'wait',
      version: '1.0.0',
      name: 'Wait',
      description: 'Pause the flow until a timer elapses or a named signal arrives.',
      icon: 'timer-reset',
      category: 'logic',
      source: 'builtin',
      // Durable pause — the run suspends and resumes later (timer/signal).
      supportsPause: true,
      isAsync: true,
    }),
    async execute(node, variables, _context) {
      // `waitEventConfig` is the whole contract (`FlowNodeSchema`, flow.zod.ts).
      // The loose `config.*` back door this used to also read — six keys, two of
      // them (`duration`, `signal`) spellings the spec never declared — graduated
      // into the ADR-0087 D2 conversion layer as
      // `flow-node-wait-event-config-lift` (#4045). It is rewritten at load,
      // including the `registerFlow` rehydration seam, so there is nothing left
      // to fall back to here (PD #12: no consumer-side fallbacks).
      //
      // The `?? 'timer'` below is NOT such a fallback: `waitEventConfig` is
      // itself optional, and a wait node without one is a valid timer wait.
      const wec = (node.waitEventConfig ?? {}) as Record<string, unknown>;
      const eventType = String(wec.eventType ?? 'timer');
      const runId = variables.get('$runId');

      if (eventType === 'timer') {
        // One source for the wait length. `timeoutMs` used to double as this
        // when `timerDuration` was absent — it was retired in protocol 17 (#4158)
        // precisely because that is not what it said it did, and the conversion
        // rewrites it to `timerDuration`, so there is one spelling left.
        const durationMs = parseIsoDuration(wec.timerDuration);

        // Persist the wake deadline as node output: the engine writes output
        // to variables (`<nodeId>.waitUntil`) *before* snapshotting the
        // suspended run, so a cold-booted kernel can re-arm the timer from the
        // durable store ({@link rearmSuspendedWaitTimers}).
        const at = durationMs && durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : undefined;
        const output = at ? { waitUntil: at } : undefined;

        const job = getJobService();
        if (job && runId != null && at) {
          const jobName = `flow-wait:${String(runId)}:${node.id}`;
          try {
            await job.schedule(jobName, { type: 'once', at }, async () => {
              try {
                await engine.resume(String(runId));
              } finally {
                // One-shot: drop the job so it never re-fires.
                try {
                  await job.cancel?.(jobName);
                } catch {
                  /* best-effort */
                }
              }
            });
            return { success: true, suspend: true, correlation: jobName, output };
          } catch (err) {
            ctx.logger.warn(
              `[wait] node '${node.id}': failed to schedule timer resume (${(err as Error)?.message ?? err}); ` +
                `suspending without auto-resume (resume it via resume(runId))`,
            );
          }
        } else if (!job) {
          ctx.logger.warn(
            `[wait] node '${node.id}': no job service registered — suspending without an auto-resume timer ` +
              `(resume it via resume(runId), or install the job service for durable timers)`,
          );
        }
        // Degrade: still suspend; resumption comes from an external resume()
        // (or a later boot's re-arm pass, when the deadline was persisted).
        return { success: true, suspend: true, correlation: `timer:${node.id}`, output };
      }

      // signal / webhook / manual / condition — suspend; an external producer
      // resumes the run when the named event arrives.
      const signal = String(wec.signalName ?? `wait:${node.id}`);
      return { success: true, suspend: true, correlation: signal };
    },
  });

  ctx.logger.info('[Wait Node] 1 built-in node executor registered');
}

/** Minimal logger surface for {@link rearmSuspendedWaitTimers}. */
interface RearmLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  /**
   * #4632 — required, not optional. Every degradation on the re-arm path leaves
   * a run persisted-but-unreachable, which is a durability degradation and must
   * be reported at `error`; a logger that cannot carry that level could not
   * satisfy the contract this function owes its caller.
   */
  error(msg: string, ...args: unknown[]): void;
}

/**
 * Re-arm auto-resume timers for suspended timer-`wait` runs after a cold boot
 * (ADR-0019 follow-up). The one-shot job a `wait` node schedules lives in the
 * job service's process memory unless that service is itself durable — so a
 * restart loses the wake-up while the suspended run survives in
 * `sys_automation_run`. This pass walks the durable store and:
 *
 *  - **overdue** deadlines (`<nodeId>.waitUntil` in the past) → `resume()` now;
 *  - **future** deadlines → re-schedule the same `flow-wait:<runId>:<nodeId>`
 *    one-shot job (no job service → warn and leave it for an external resume);
 *  - runs without a persisted `waitUntil` (approval / screen / signal pauses,
 *    or pre-deadline-persistence rows) → skipped untouched.
 *
 * Double-fire safe: if the original job *did* survive (durable job store), the
 * second `resume(runId)` finds no suspended run — the engine's resume
 * idempotency absorbs it. Returns how many runs were resumed or re-armed.
 *
 * Called by `AutomationServicePlugin.start()` *after* the flow pull, because
 * `resume()` needs the flow definitions registered.
 */
export async function rearmSuspendedWaitTimers(
  engine: Pick<AutomationEngine, 'resume'>,
  store: SuspendedRunStore,
  job: IJobService | undefined,
  logger: RearmLogger,
): Promise<number> {
  let runs;
  try {
    runs = await store.list();
  } catch (err) {
    // #4632 — durability degradation, not a functional one: returning 0 here
    // re-arms NOTHING, so every run persisted before this restart stays paused
    // forever while the process reports a clean boot. The rows survived; the
    // promise that they would resume did not.
    logger.error(
      `[wait] suspended wait-timer re-arm ABORTED — the suspended-run store could not be listed, so NO timer was re-armed: ` +
        `every wait/approval paused before this restart will hang indefinitely instead of resuming. The runs themselves are ` +
        `still persisted. Fix the store/datasource error and restart to re-attempt the re-arm, or resume them via ` +
        `resume(runId). Cause: ${(err as Error)?.message ?? err}`,
    );
    return 0;
  }

  let rearmed = 0;
  for (const run of runs) {
    const wakeAt = run.variables?.[`${run.nodeId}.waitUntil`];
    if (typeof wakeAt !== 'string' || !wakeAt) continue; // not a timer wait
    const atMs = Date.parse(wakeAt);
    if (Number.isNaN(atMs)) continue;

    if (atMs <= Date.now()) {
      // Deadline elapsed while the process was down — resume immediately.
      try {
        await engine.resume(run.runId);
        rearmed++;
      } catch (err) {
        // #4632 — this run's deadline already passed, so nothing else will ever
        // wake it: it is persisted, overdue, and now unreachable.
        logger.error(
          `[wait] suspended run '${run.runId}' is OVERDUE and could not be resumed — it stays persisted but nothing will ` +
            `wake it again (its deadline has already passed, so no timer will be re-armed for it). Fix the cause below and ` +
            `restart, or resume it directly via resume('${run.runId}'). Cause: ${(err as Error)?.message ?? err}`,
        );
      }
      continue;
    }

    if (!job) {
      // #4632 — deliberately stays `warn`. This is the FUNCTIONAL half of the
      // rule: a host with no job service never had auto-resume to begin with,
      // so nothing was promised and then broken — the capability is simply not
      // composed, and the line already names the remedy. Escalating a declared
      // absence like this to `error` is the mirror-image failure: it would fire
      // once per suspended run on every boot of every job-less host, and teach
      // everyone to skim `error` — which is what made the #4420 `warn`
      // unreadable in the first place.
      logger.warn(
        `[wait] timer re-arm: run '${run.runId}' waits until ${wakeAt} but no job service is registered — ` +
          `resume it externally via resume(runId)`,
      );
      continue;
    }

    const jobName = `flow-wait:${run.runId}:${run.nodeId}`;
    try {
      await job.schedule(jobName, { type: 'once', at: wakeAt }, async () => {
        try {
          await engine.resume(run.runId);
        } finally {
          try {
            await job.cancel?.(jobName);
          } catch {
            /* best-effort */
          }
        }
      });
      rearmed++;
    } catch (err) {
      // #4632 — the run is persisted and waiting, but its wake-up job was never
      // scheduled: it will sit at its wait node past its deadline with nothing
      // to resume it.
      logger.error(
        `[wait] suspended run '${run.runId}' could NOT be re-scheduled — it stays persisted with a deadline of ${wakeAt}, ` +
          `but no job was armed to wake it, so it will hang past that deadline instead of resuming. Fix the job-service ` +
          `error below and restart to re-attempt the re-arm, or resume it via resume('${run.runId}'). ` +
          `Cause: ${(err as Error)?.message ?? err}`,
      );
    }
  }
  return rearmed;
}

/**
 * Parse an ISO-8601 duration (the subset flows use — weeks/days + a time part
 * of hours/minutes/seconds, e.g. `PT1H`, `P3D`, `PT90M`, `P1DT12H`) into
 * milliseconds. A bare positive number is treated as milliseconds. Returns
 * `undefined` for anything unparseable / non-positive.
 */
export function parseIsoDuration(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input > 0 ? input : undefined;
  if (typeof input !== 'string') return undefined;
  const s = input.trim();
  if (!s) return undefined;
  // Plain numeric string ⇒ milliseconds.
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : undefined;
  }
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m) return undefined;
  const [, w, d, h, min, sec] = m;
  if (!w && !d && !h && !min && !sec) return undefined;
  const totalSec =
    Number(w ?? 0) * 7 * 86_400 +
    Number(d ?? 0) * 86_400 +
    Number(h ?? 0) * 3_600 +
    Number(min ?? 0) * 60 +
    Number(sec ?? 0);
  const ms = totalSec * 1000;
  return ms > 0 ? ms : undefined;
}
