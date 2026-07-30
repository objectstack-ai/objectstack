// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In-memory job scheduler fallback.
 *
 * Implements the IJobService contract with basic schedule/cancel/trigger
 * operations.  Used by ObjectKernel as an automatic fallback when no real
 * job plugin (e.g. Agenda / BullMQ) is registered.
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
