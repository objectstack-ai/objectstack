---
'@objectstack/types': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

**Correct the stale premise left behind by #4012: the degraded-boot stderr copy
survives the operator's LOG LEVEL, not `os serve`'s boot-quiet window.**

`emitDegradedBootBanner` writes the `OS_ALLOW_DRIVER_CONNECT_FAILURE` banner to
stderr in addition to `logger.warn`, and every comment and test name explaining
why cited the same reason: `os serve` swallowed all of stdout while the kernel
booted, and `Logger` routes `warn` to stdout. #4012 fixed that — the boot window
now buffers and replays `warn`-and-above — which retires the *stated*
justification for a duplicate that is nonetheless still load-bearing:

`Logger.write()` returns before touching a stream when the record is below
`config.level`, so at `--log-level error`, `fatal` or `silent` the banner's
`logger.warn` reaches **no** stream at all. A production host at `error` is
exactly the deployment this escape hatch exists for, and exactly where a
logger-only banner would vanish. Removing the stderr copy on the strength of
#4012 would therefore have been a regression — so this documents the reason that
is still true, in the places someone would read before deleting it:
`degraded-boot.ts`, the engine's emit site, and all three parity tests
(objectql, runtime, service-datasource), which are renamed off "which `os serve`
boot-quiet cannot swallow" to "which the operator log level cannot filter away".

The objectql parity test now proves the claim instead of asserting around it: it
drives a **real** `ObjectLogger` at `level: 'error'` and requires the banner on
stderr *and* nothing on stdout. Set the level to `warn` and it fails — so the
test is pinned to the level filter rather than passing for any reason.

Also corrected in the same sweep, all comment-only, all previously overstating
what #4012 had not yet fixed:

- the automation wiring summary (`format.ts`, `serve.ts`, its test) claimed the
  boot window swallowed the engine's binding warnings. Its real justification is
  stronger and unchanged: a flow that silently fails to arm emits **no** log line
  at any level, so binding state has to be read off the live engine — absence of
  a warning was never evidence of a bound flow.
- the seed summary (`seed-summary.ts`, `format.ts`, its test) and `AppPlugin`'s
  seed-outcome note attributed the silence to the boot window; the operative
  gate is that `SeedLoader`'s result logs are `info`, under the default `warn`.

No behavior changes.
