---
"@objectstack/runtime": minor
"@objectstack/service-datasource": minor
"@objectstack/verify": patch
---

feat(runtime,datasource): the default-datasource connect seam accepts a host driver factory — adopt pre-built instances without forking the verdict (#3826)

ADR-0062 D1's open-core convergence (#3869/#3886) left one structural question
open: a host whose `default` needs a driver the shared factory cannot build —
the cloud distribution's `turso`, or an instance pooled BEYOND one kernel (the
cloud control-plane driver doubles as the proxy base of every environment
kernel; per-environment drivers are cached across kernel rebuilds) — had only
two options, both bad: stay on the legacy pre-built `DriverPlugin` path, whose
connect verdict lives in `ObjectQLEngine.init()` (the second implementation
#3826 exists to retire), or fork the connect orchestration. Either re-opens the
#3741 → #3758 drift this whole line of work is about.

Two additive pieces close it:

- **`DefaultDatasourcePlugin` accepts an injected `IDatasourceDriverFactory`**
  (defaults to the shared open-core factory, byte-for-byte unchanged when
  omitted). The factory only changes what `create()` returns — the policy-free
  init connect, `bootCritical` fail-fast, `OS_ALLOW_DRIVER_CONNECT_FAILURE`
  escape hatch, and the start() replay into retained admin state are identical
  either way, and the new tests pin that (an adopted instance that cannot
  connect takes the exact same verdict).
- **`createPrebuiltDriverFactory(driver, { driverId?, fallback? })`** in
  `@objectstack/service-datasource` — the "adopt an existing driver" seam the
  first #3826 pass found missing, landed AS a factory so it composes into the
  one connect path instead of becoming a second entry point. `create()` returns
  the SAME instance every call: construction, pooling, and reuse stay host
  concerns; only the verdict converges. Not for the common case — a `default`
  expressible as `{ driver, config }` should stay a plain definition.

The `@objectstack/verify` dogfood harness now boots through
`DefaultDatasourcePlugin` (declared `sqlite-wasm` definition) instead of a
pre-built `DriverPlugin` — so the dogfood gate exercises the same declared
-default connect path `objectstack dev`/`serve` use, which is the §Risk
mitigation ADR-0062 promised ("behind the dogfood gate") and did not yet have.
The degraded-boot parity guard stays: `ObjectQLEngine.init()`'s verdict is
still live for the boot re-verification, `DriverPlugin` escape-hatch drivers,
and the cloud compositions until they converge onto this seam.
