// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In-memory job registry — schedule/cancel/trigger bookkeeping with NO timer.
 *
 * [#10746] NOT pre-injected by ObjectKernel any more (it used to be, via
 * `CORE_FALLBACK_FACTORIES`): a fallback must not fake capability (maintainer
 * ruling 2026-08-22). Advertising a `schedule()` that records and never fires
 * made every "prefer the platform job service, else own a timer" consumer
 * take the job-service branch and then silently never run. The export remains
 * for embedders who deliberately want a manual-trigger job registry — e.g. in
 * tests that drive handlers via `trigger()` — and have read this docblock.
 *
 * [#4058] `degraded` (ADR-0076 D12), with the missing half named in the
 * message rather than left for a deployer to discover: `trigger()` really runs
 * the registered handler, but nothing here owns a timer, so a `schedule()`d job
 * NEVER fires on its own. That is reduced capability, not fabricated output —
 * no call returns a made-up answer. `handlerReady: false`: no HTTP surface.
 */
export function createMemoryJob() {
  const jobs = new Map<string, any>();
  return {
    __serviceInfo: {
      status: 'degraded' as const,
      handlerReady: false,
      message: 'In-process job registry — trigger() runs handlers, but scheduled jobs never fire on their own (no timer). Register a job plugin (e.g. Agenda) for real scheduling.',
    },
    _serviceName: 'job',
    async schedule(name: string, schedule: any, handler: any): Promise<void> { jobs.set(name, { schedule, handler }); },
    async cancel(name: string): Promise<void> { jobs.delete(name); },
    async trigger(name: string, data?: unknown): Promise<void> {
      const job = jobs.get(name);
      if (job?.handler) await job.handler({ jobId: name, data });
    },
    async getExecutions(): Promise<any[]> { return []; },
    async listJobs(): Promise<string[]> { return [...jobs.keys()]; },
  };
}
