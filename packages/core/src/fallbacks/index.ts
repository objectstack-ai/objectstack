// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createMemoryCache } from './memory-cache.js';
import { createMemoryQueue } from './memory-queue.js';
import { createMemoryI18n } from './memory-i18n.js';
import { createMemoryMetadata } from './memory-metadata.js';

export { createMemoryCache } from './memory-cache.js';
export { createMemoryQueue } from './memory-queue.js';
export { createMemoryJob } from './memory-job.js';
export { createMemoryI18n, resolveLocale, deepMerge } from './memory-i18n.js';
export { createMemoryMetadata } from './memory-metadata.js';
export {
  wireAuthoredTranslationSync,
  readAuthoredTranslationLayer,
} from './authored-translation-sync.js';

/**
 * Map of core-criticality service names to their in-memory fallback factories.
 * This IS the kernel's pre-injection list: `ObjectKernel.preInjectCoreFallbacks()`
 * registers an entry for every unprovided `core` service before Phase 2, and
 * `validateSystemRequirements()` consults the same map as its final check.
 *
 * [#10746] `job` is deliberately ABSENT — a fallback must not fake capability
 * (maintainer ruling 2026-08-22). `createMemoryJob()`'s `schedule()` records a
 * job and never fires it, so pre-injecting it made every "prefer the platform
 * job service, else own a timer" consumer take the job-service branch and then
 * silently never run: `plugin-reports` logged `dispatcher registered with job
 * service` and dispatched nothing, ever (measured: 0 reads of
 * `sys_report_schedule` in 5600 ms with the success line present). With no
 * entry here, `getService('job')` throws when no job plugin is installed,
 * every consumer's documented no-job-service path becomes reachable (they all
 * already run on `LiteKernel`, which injects no fallbacks), and the kernel
 * says the absence out loud at boot: `validateSystemRequirements()` warns
 * "Core service missing, functionality may be degraded: job". Do NOT re-add
 * the entry to quiet that warning — install `@objectstack/service-job`, or
 * register a real scheduler, instead. `createMemoryJob` stays exported below
 * for embedders who deliberately want a manual-trigger job registry and have
 * read its docblock.
 */
export const CORE_FALLBACK_FACTORIES: Record<string, () => Record<string, any>> = {
  metadata: createMemoryMetadata,
  cache: createMemoryCache,
  queue: createMemoryQueue,
  i18n:  createMemoryI18n,
};
