---
"@objectstack/runtime": minor
"@objectstack/service-datasource": minor
"@objectstack/cli": patch
---

feat(runtime)!: the standalone `default` datasource is a declaration, connected through the one datasource path (#3826)

ADR-0062 D1 asked for exactly one "definition → live driver" path. Construction
converged earlier; the *connect + failure verdict* half did not — the standalone
`default` driver was pre-built and smuggled into the engine as a `driver.*`
kernel service, so "what if it cannot connect" lived in `ObjectQLEngine.init()`,
a second implementation of the policy `DatasourceConnectionService` owns for
every other datasource. #3741 → #3758 showed what two copies cost: a fix to one
missed the other for three months.

- **`createStandaloneStack` now emits a datasource DEFINITION**, not a driver.
  URL→config translation and `mkdir` stay host concerns; the new
  **`DefaultDatasourcePlugin`** (exported from `@objectstack/runtime`) connects
  the definition at boot through the shared `DatasourceConnectionService` —
  same driver factory, same failure verdict, same retained state. It must be
  registered before `ObjectQLPlugin` (boot schema-sync needs the driver);
  `createStandaloneStack` orders it correctly.
- **`sqlite-wasm` joined the shared driver factory** (`sqlite-wasm` /
  `wasm-sqlite` ids) — it was the last bespoke construction site.
- **`bootCritical` on `ConnectableDatasource`**: the host declares a datasource
  the platform cannot run without; a boot connect failure is then fatal
  regardless of object bindings, sharing `OS_ALLOW_DRIVER_CONNECT_FAILURE` and
  the `DEGRADED BOOT` banner with the engine-level guard. A connect policy that
  denies a boot-critical datasource fails the boot loudly — the #3828 "denial is
  not a failure" boundary was drawn for optional datasources.
- **`connect(record, { asDefault: true })`**: registers the built driver as the
  engine's default under its natural name (no `'default'` stamping — routing to
  `default` goes through the engine's default-driver fallback, and the natural
  name keeps logs/lookups byte-for-byte with the previous boot).
- **`default` is a host-reserved name**: an app bundle declaring a datasource
  named `default` is rejected at load (`AppPlugin`), and the runtime-admin
  create rejects it too. It would shadow the host's primary datasource and, if
  it passed the auto-connect gate, silently divert every unbound object.
- The primary DB now shows a REAL `status` in Setup → Datasources (#3827) —
  `ok` when connected, `error` + reason when the operator boots degraded.
- `ObjectQLEngine.init()` is unchanged and keeps its fail-fast: it re-connects
  the already-connected default (every open-core driver's `connect()` is
  idempotent), which is exactly the boot verification #3741 wants.
- `DriverPlugin` remains the escape hatch for tests and pre-built/proxy drivers
  (e.g. the CLI's `telemetry` datasource) — no longer how the standalone
  default boots. The CLI serve config-load fallback (`createStorageDriver`,
  incl. mysql/turso) still constructs directly; tracked in #3826.

**Migration.** Boots through `createStandaloneStack` (CLI `serve`/`dev`
artifact path, quickstarts, embedders using the stack factory) change shape but
not behavior: same driver kinds, same URLs, same fail-fast semantics, same
escape hatch. Embedders that composed `DriverPlugin` manually are unaffected.
An app that declared a datasource literally named `default` now fails to load
with a rename instruction — that name never routed correctly to begin with.
