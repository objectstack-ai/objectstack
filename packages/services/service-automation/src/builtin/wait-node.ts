// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { IJobService } from '@objectstack/spec/contracts';
import type { AutomationEngine } from '../engine.js';

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
      // Prefer the spec-structured `waitEventConfig` block; fall back to a loose
      // `config` for hand-authored flows that put the same keys under config.
      const loose = (node.config ?? {}) as Record<string, unknown>;
      const wec = (node.waitEventConfig ?? {}) as Record<string, unknown>;
      const eventType = String(wec.eventType ?? loose.eventType ?? 'timer');
      const runId = variables.get('$runId');

      if (eventType === 'timer') {
        const durationMs =
          parseIsoDuration(wec.timerDuration ?? loose.timerDuration ?? loose.duration) ??
          (typeof wec.timeoutMs === 'number' ? wec.timeoutMs : undefined) ??
          (typeof loose.timeoutMs === 'number' ? (loose.timeoutMs as number) : undefined);

        const job = getJobService();
        if (job && runId != null && durationMs && durationMs > 0) {
          const jobName = `flow-wait:${String(runId)}:${node.id}`;
          const at = new Date(Date.now() + durationMs).toISOString();
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
            return { success: true, suspend: true, correlation: jobName };
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
        // Degrade: still suspend; resumption comes from an external resume().
        return { success: true, suspend: true, correlation: `timer:${node.id}` };
      }

      // signal / webhook / manual / condition — suspend; an external producer
      // resumes the run when the named event arrives.
      const signal = String(wec.signalName ?? loose.signalName ?? loose.signal ?? `wait:${node.id}`);
      return { success: true, suspend: true, correlation: signal };
    },
  });

  ctx.logger.info('[Wait Node] 1 built-in node executor registered');
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
