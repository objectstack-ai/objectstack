---
---

Showcase-only: fix four declarations the reference app made that the runtime
never honoured, each announced by one line in the boot warning block. Releases
nothing — `@objectstack/example-showcase` is private.

- **The nightly job now exists.** `showcase_health_sweep` named
  `handler: 'sweepProjectHealth'` and no function of that name was defined
  anywhere, so `AppPlugin` skipped it at every boot and "Nightly Project Health
  Sweep" had never run. Implemented for real: it recomputes
  `showcase_project.health` from budget burn measured against delivered task
  progress, over an engine handle captured at `onEnable` (a job handler is
  invoked with `{ jobId, data }` and no data engine). It is registered in the
  bare-callable form rather than the `effect: 'writes'` declaration it wants:
  that declared form cannot survive `objectstack build` today, filed as #4976.
- **`showcase.export_data` now materializes.** The capability declared no
  owning package, so it was never written to `sys_capability` — leaving
  `OpsPermissionSet` granting a permission that would never exist. It now
  authors the ADR-0086 D3 `packageId` provenance. The platform half (an
  app-declared capability can never receive the registry stamp, and a refused
  declaration still suppresses the back-compat derivation) is filed as #4967.
- **Retry policies use the canonical key.** Two `try_catch` nodes still spelled
  the base delay `retryDelayMs`, which only kept working through the
  `retry-policy-converged` conversion — and that conversion retires in protocol
  18. Renamed to `backoffMs`. `maxRetryDelayMs` is unchanged: it is a canonical
  key of `RetryPolicySchema`, not part of that rename.
- **Seed data no longer breaks ADR-0104 on its own first boot.** Ten
  `showcase_task.cover` values were inline `data:image/svg+xml` URIs in a
  `Field.image()`, whose stored form is an opaque `sys_file` id. Because a boot
  may not attest a contract it has already broken (#4769), a brand-new
  datastore could never auto-attest `adr-0104-file-references` — the gate stayed
  open on day one of every fresh install. The values are removed; `cover` stays
  declared, with its gallery binding, and is populated by uploading a cover.

Guarded by `test/inert-wirings.test.ts`: every declared job's handler must
resolve against `defineStack({ functions })` in a form the build can carry,
every declared capability must
resolve an owning package, no permission set may grant an undeclared
capability, no **source file** may author `retryDelayMs` (the parsed stack
cannot answer this — the conversion has already rewritten it), and no seeded
file-class value may fail its ADR-0104 stored shape.
