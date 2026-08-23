---
'@objectstack/core': minor
---

`ObjectKernel` no longer pre-injects the in-memory `job` fallback for the `job` core-service slot — a fallback must not fake capability (#10746, maintainer ruling 2026-08-22). `createMemoryJob()`'s `schedule()` records a job and never fires it (it owns no timer), so pre-injecting it made every "prefer the platform job service, else own a timer" consumer take the job-service branch on a kernel without `@objectstack/service-job` and then silently never run: `plugin-reports` logged `dispatcher registered with job service` and dispatched nothing, ever.

Behavior change, FROM → TO: on an `ObjectKernel` without a registered `job` service, `getService('job')` FROM resolving a non-scheduling in-memory registry TO throwing `Service 'job' not found`. Consumers' documented no-job-service paths take over (`plugin-reports` falls through to its own `setInterval` and scheduled reports actually dispatch; schedule triggers and declarative jobs warn loudly instead of scheduling into the void), and the kernel says the absence out loud at boot: `Core service missing, functionality may be degraded: job`.

One-line fix if you relied on the old behavior: install `@objectstack/service-job` for real scheduling, or — if you deliberately want the manual-trigger in-memory registry — register it explicitly: `kernel.registerService('job', createMemoryJob())` (the factory is still exported from `@objectstack/core`).
