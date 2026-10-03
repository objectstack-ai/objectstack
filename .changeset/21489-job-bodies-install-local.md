---
'@objectstack/runtime': minor
'@objectstack/cloud-connection': minor
'@objectstack/cli': minor
'@objectstack/spec': minor
---

fix(runtime,cloud-connection)!: a job's sandboxed `body` is scheduled on every door that brings an artifact in, and install-local refuses an enabled job with no `body` (#21489)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no authorable key, spelling, export or stored shape moves: `JobSchema` is unchanged by this release (its `body` landed earlier), so `objectstack migrate meta` has nothing to rewrite. What changes is which packages one install door accepts, and that job bodies now run. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a refused install or a scheduled body (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: `os package install` (the install-local door, `POST /api/v1/marketplace/install-local`) now refuses a package that declares an **enabled job with no `body`**. Such a job names its code only through `handler` — a `defineStack({ functions })` entry, which travels in the artifact's runtime module and never in the package JSON this door installs — so it used to install with a 200 and never run, hot or after a restart, with nothing saying so.

- **Job bodies run.** A job's sandboxed `body` (`JobSchema.body`, the hook body shape) is now scheduled on every door that brings an artifact in: the boot (`os start --artifact`, a `defineStack` config) and install-local, on install and on every rehydrate after a restart. One binder does it for all of them. With both `body` and `handler` declared, the `body` wins. The body runs in the QuickJS sandbox with `ctx.api` (as system: a job has no caller), `ctx.log` and `ctx.crypto` behind its declared `capabilities`. The job's `timeoutMs` is its one time limit; with none, a job body gets a 5000 ms CPU budget. A body may return `{ outcome: 'degraded', reason }` to report a run that did not do its work.
- **A package's jobs stop with it.** Re-scheduling a package's jobs replaces its set: a reinstall whose new version drops, disables or can no longer run a job cancels that job, and a version with no jobs cancels them all. Uninstalling a package cancels its scheduled jobs through a new uninstall cleanup, `runtime.package-jobs`, on the protocol's uninstall-cleanup registry, so install-local's `DELETE` and the protocol's package uninstall both stop them and report it in `cleanups`. Another package's jobs are never touched.
- **The refusal.** The install answers `422` with `VALIDATION_ERROR`, names each refused job and the function its `handler` declares, and installs nothing: nothing is registered, persisted or scheduled. A disabled job (`enabled: false`) is not judged. A package installed by an earlier version keeps rehydrating; its handler-only job is reported at `warn` and does not run.
- **CLI.** `os package install` prints a refusal's code beside its status (`Install failed (422 VALIDATION_ERROR): …`), for every refusal alike.
- **Spec.** The shipped liveness ledger records `job.body` (`language`, `source`, `capabilities`, `memoryMb`) as live, so `os validate` / `os build` no longer warn that a job's `body` is planned and not read yet. `body.timeoutMs` stays refused on a job. `JobSchema.body`'s description and the `defineJob` example no longer say to keep a `handler` until the runtime runs job bodies.
- **Unchanged:** a `handler` job on a boot that loads the artifact's runtime module (`os start --artifact`, a `defineStack` config) still runs its `functions` entry; a package without jobs installs exactly as before.

The route for a refused package: give each enabled job a `body` (sandboxed JS that reaches data through `ctx.api`), or boot the artifact with `os start --artifact`, which loads its runtime module. It ships as `minor` under the launch-window convention for accept-set narrowings.
