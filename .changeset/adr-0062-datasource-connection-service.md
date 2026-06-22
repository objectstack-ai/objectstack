---
"@objectstack/service-datasource": minor
"@objectstack/runtime": minor
"@objectstack/spec": minor
---

feat(datasource): auto-connect declared external datasources (ADR-0062 Phase 1, D1/D2/D5)

A declared external datasource is now connected to a live ObjectQL driver and its
federated objects are queryable **with zero app code** — no `onEnable` driver
wiring. Implements ADR-0062 Phase 1.

- **D1 — one connect path.** New `DatasourceConnectionService` in
  `@objectstack/service-datasource` owns the single "definition → live driver"
  path: build via the injected driver factory → resolve `external.credentialsRef`
  via the `SecretBinder` → connect → `engine.registerDriver` under the datasource
  name → register the datasource def → sync each bound federated object's read
  metadata (DDL-free). Both origins converge on it: the runtime-admin
  `registerPool` now delegates here, and `AppPlugin` auto-connects code-defined
  datasources. Exposed as the `'datasource-connection'` kernel service.
- **D2 — opt-in-safe gate.** A declared datasource auto-connects only when it is
  `external`, an object **explicitly** binds to it via `object.datasource`, or it
  sets the new `autoConnect: true` flag. A managed datasource that nothing
  explicitly binds (incl. ones referenced only by a `datasourceMapping` rule, e.g.
  `examples/app-crm`'s `:memory:` datasources) stays metadata-only — existing apps
  are byte-for-byte unchanged. See the ADR-0062 D2 implementation note.
- **D5 — lifecycle, ordering & policy.** Connect happens in `AppPlugin.start()`
  (before the `kernel:ready` validation gate, relying on the kernel's
  init-all-then-start-all ordering). Fail-fast for a declared `external` datasource
  with `validation.onMismatch: 'fail'`; degrade-with-warning otherwise (and always
  for runtime-admin/rehydrate, so a UI action or replica blip never bricks the
  server). Adds a host-injectable `DatasourceConnectPolicy` (open-core default
  allows; a multi-tenant host binds a stricter fail-closed policy for egress
  isolation) consulted before every connect — one connect path, no cloud fork.

Adds `datasource.autoConnect` to the spec. The legacy `onEnable` +
`ctx.drivers.register` bridge remains supported as an escape hatch (idempotent vs.
auto-connect). No behavior change for managed apps.
