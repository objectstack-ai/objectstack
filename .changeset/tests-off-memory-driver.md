---
"@objectstack/runtime": patch
"@objectstack/client": patch
"@objectstack/metadata": patch
---

test(runtime,client,metadata): back the remaining suites with in-memory SQLite instead of the mingo driver (#4065)

Ten test files used `InMemoryDriver` as a convenience backing store — somewhere
for rows to go while the suite proved something else (REST routing, datasource
auto-connect, the batch `$ref` contract, metadata history). They now run on
`SqliteWasmDriver` at `:memory:`, the same engine `@objectstack/verify`'s
`bootStack` already gives the dogfood gate: pure JS (no native build, CI-safe on
any runner) and real SQL semantics.

The point is fidelity, not tidiness. Production runs SQL, and mingo differs from
it in ways that let a suite pass while the behaviour it stands for is broken.
Every failure this migration produced was a fixture defect the memory driver had
been absorbing:

- **Tables were never created.** `driver.create()` on the memory driver is a
  bare `table.push()` onto an auto-vivified array, so an object registered
  *after* `kernel.bootstrap()` — which misses the boot-time schema sync — looked
  fine. On SQL the first write fails with `no such table`, which the REST error
  mapper turns into a **404 `OBJECT_NOT_FOUND`**: a routing-shaped symptom for a
  DDL-shaped cause. Four suites needed an explicit `syncObjectSchema`.
- **A missing object declaration read as working.** `notifications.hono.integration`
  writes `sys_notification`, which `MessagingServicePlugin` does not declare —
  it is a platform object, and that lean kernel never booted `platform-objects`.
  Auto-vivification hid the omission entirely. The suite now registers the real
  `SysNotification` rather than a hand-copied stand-in, so there is still exactly
  one schema for it (Prime Directive #12).
- **`connect()` was optional.** The memory driver needs none; a SQL driver does.

What deliberately did NOT move: `read-coercion-conformance` keeps its two-driver
matrix (proving a stored value reads back as its declared type on *both* engines
is the entire point of that gate), and the suites whose subject IS the memory
driver or its wiring — `standalone-stack` (`memory://` scheme),
`sqlite-driver-fallback` (the dev step-down), the CLI's driver-label tests, and
driver-memory's own suite.

`datasource-autoconnect` is in that second group as of #4083, which landed a
regression test there for exactly the memory-pool property this PR originally
proposed to migrate away from. Moving that file to SQLite would have left the
new test passing vacuously — a wasm-SQLite pool never writes `.objectstack/` at
all — so it stays on the memory driver and keeps guarding what it was written
to guard.

No new coverage is claimed here: each suite asserts exactly what it asserted
before, against a more faithful store.
