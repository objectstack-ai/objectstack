---
"@objectstack/service-job": patch
"@objectstack/trigger-schedule": patch
---

Fix scheduled and time-relative flows permanently failing to re-bind after a kernel rebuild.

`DbJobAdapter.destroy()` destroyed only its interval adapter, never the cron adapter it
was handed — so every evicted kernel left its croner timers running, holding their names
in croner's process-global registry for the life of the process. Because kernel eviction
is routine in the cloud runtime, the normal path was: a scheduled automation binds once,
the next metadata edit evicts the kernel, and the flow never binds again ("name already
taken") while Studio, the metadata API and `verify_build` all keep reporting it healthy.

Four changes close it:

- `DbJobAdapter.destroy()` now also destroys the cron adapter, and `JobServicePlugin`
  releases the cron adapter it owns on the `adapter: 'cron'` path.
- `CronJobAdapter` scopes its entry in croner's process-global registry to the adapter
  INSTANCE (`CronJobAdapter.cronRegistryName()` exposes the key). This also fixes a
  second defect with no eviction involved: two environments in one container binding the
  same flow name no longer collide.
- Registering a name something else still holds now REPLACES it — the previous job is
  stopped, never left running alongside the new one.
- A flow that fails to bind to the job service is now reported at `error` with the
  consequence and the remedy, instead of a `warn` nobody reads.
