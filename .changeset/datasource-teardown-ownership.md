---
"@objectstack/service-datasource": minor
"@objectstack/runtime": minor
---

feat(datasource,runtime): kernel teardown disconnects through the one datasource path — and never closes an adopted pool (#3993)

After the #3826 connect convergence, ADR-0062 D5's "owns connect/disconnect"
was half-true: nothing disconnected the `default` (or a declared datasource's
pool) on graceful shutdown. `DriverPlugin` never had teardown, `ObjectQLPlugin`
teardown never touched drivers, and the kernel's actual teardown phase is
`destroy()` — the Plugin contract has no `stop()`, so stray `stop` methods were
never called by anything.

The disconnect half now mirrors the connect half:

- **`DatasourceConnectionService.disconnect(name, { asDefault })`** resolves
  the default under its NATURAL name (the same #3826 rule that makes
  `drivers.get('default')` impossible — the old lookup could never have found
  it), and honours a new ownership discriminator recorded at connect time.
- **`disconnectAll()`** closes exactly the pools THIS service opened —
  `'connected'` states only. `already-registered` drivers belong to whoever
  registered them (an `onEnable` bridge, the default's idempotent replay) and
  are never touched.
- **`DatasourceDriverHandle.ownership: 'factory' | 'host'`** is the
  discriminator. `createPrebuiltDriverFactory` stamps its handles `'host'`:
  an ADOPTED instance's pool outlives the kernel (the cloud control-plane
  driver doubles as every environment kernel's proxy base; per-environment
  drivers are registry-cached across kernel rebuilds), so kernel teardown —
  including a cloud LRU eviction's `kernel.shutdown()` — clears the retained
  verdict but NEVER closes the pool. Factory-built instances disconnect as
  before there was a before.
- **`DefaultDatasourcePlugin.destroy()`** and
  **`DatasourceAdminServicePlugin.destroy()`** wire the sweep at the kernel's
  real teardown phase, best-effort (a failed disconnect never masks shutdown).

A welcome side effect: a file-backed `sqlite-wasm` default with
`persist: 'on-disconnect'` now actually flushes on graceful shutdown.

Also flips ADR-0062's status to reflect the completed convergence (#3992):
D1 is fully implemented across both repos since cloud#915; the remaining
`DriverPlugin` uses are documented named-auxiliary/escape-hatch cases, and the
degraded-boot parity guard stays with its role shifted to "the escape hatches
must not drift".
