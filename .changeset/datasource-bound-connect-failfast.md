---
"@objectstack/service-datasource": minor
"@objectstack/types": patch
"@objectstack/objectql": patch
---

fix(datasource)!: a declared datasource that objects bind to must connect, or the boot fails (#3758)

`DatasourceConnectionService.handleFailure()` fail-fasted only for an `external`
datasource with `validation.onMismatch: 'fail'`. Everything else degraded to one
`warn` line — including the case the D2 auto-connect gate itself flags as having
**no fallback path**: a datasource that objects bind to explicitly via
`object.datasource`. Those objects never fall through to the `default` driver;
`engine.getDriver` throws `Datasource 'x' is not registered` for them.

So an app declaring `datasource: 'analytics'` with 20 objects bound to it, booted
against a wrong `ANALYTICS_URL`, started clean and exited zero — and then failed
every read and write of those 20 objects with an error that reads nothing like
*the analytics database is unreachable*. The rest of the app worked, which made it
**harder** to locate than a total outage: it looks like "some pages are broken",
not like a misconfigured datasource. This is the same decision #3741/#3751 fixed
one layer up in `ObjectQLEngine.init()`; the boundary here was still drawn in the
old place.

- **Fail-fast is now keyed on "no fallback path", not on `onMismatch` alone.** At
  the `declared-auto` (boot) trigger, a connect failure aborts the boot when the
  datasource is `external` + `onMismatch: 'fail'` **or** when ≥1 object binds to
  it explicitly. `autoConnect: true` with nothing bound stays lenient — that is
  "connect it if you can", and nothing declares a dependency on it. The
  runtime-admin create/update and boot-rehydration triggers are unchanged and
  still always degrade: a UI action must never brick a running server.
- **Every failure mode counts**, not just an unreachable socket: an unresolvable
  `external.credentialsRef` (D3) and an unsupported `driver` leave the bound
  objects exactly as dead, so they take the same verdict.
- **The error names the bound objects** (up to 10, then `+N more`) alongside the
  underlying cause, so the message points at the real problem instead of just the
  datasource name. The service already receives the list for post-connect
  `syncObjectSchema`.
- **`connectDeclared()` attempts every gated datasource before throwing**, and
  aggregates, so one failed boot reports all the misconfigured ones rather than
  one per restart — the same shape as `ObjectQLEngine.init()`'s
  `DriverConnectError`.
- **The escape hatch is shared with the engine guard**:
  `OS_ALLOW_DRIVER_CONNECT_FAILURE=1` now also covers this path (and covers
  `onMismatch: 'fail'`, which previously had no opt-out). The operator intent is
  identical — "I know the database is unreachable, boot anyway" — and two flags
  would only guarantee one of them gets missed. When set, boot continues and a
  `DEGRADED BOOT` banner goes to stderr as well as the logger, because `os serve`
  swallows stdout during boot. `emitDegradedBootBanner` moved to
  `@objectstack/types` so both call sites share one implementation;
  `@objectstack/objectql` re-exports it unchanged.

ADR-0062 D5 is amended with the new criterion and the shared flag.

**Migration.** No change for a correctly configured deployment — a datasource that
connected before still connects. A deployment that was *silently* booting with a
dead, explicitly-bound datasource now fails the boot instead, naming the
datasource, the cause, and the objects that depend on it; fix the datasource
configuration. To keep booting without it — deliberately, knowing every request
touching those objects will fail — set `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`.
