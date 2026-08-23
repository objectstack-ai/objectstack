---
"@objectstack/runtime": patch
---

**Tests (log hygiene):** the sixteen remaining passing `@objectstack/runtime`
fixtures that printed expected `refused a read on` failures into the shared
shard log now **withhold and assert** that noise instead of emitting it
(#10629). No runtime behaviour changes and no test was skipped, loosened or
removed — the same 78 tests pass, and 268 lines of expected-failure output
(134 `[sql-driver] DATABASE_ERROR — the backend refused a read on '<table>'`
envelopes plus their 134 matching `ERROR Find operation failed` engine frames)
leave the `Test Core` log.

Why this is worth a release note at all: turbo interleaves package logs without
attribution, so an ERROR-shaped line from a **green** test is indistinguishable
from a real failure in a shard log. Lines of exactly this shape were once
lifted verbatim into a p1 flake signature (#10293) and sent a whole dispatch
cycle at the wrong mechanism. Expected-failure noise from a passing test is a
diagnosis tax on every future red shard.

Each fixture provokes a **fail-soft probe** — a read the runtime issues to find
out whether something is installed, and whose missing-table answer it swallows
by design: `resolveUserAuthzGrants`' six `sys_*` `tryFind`s,
`ObjectQL.probeInstallOrganizations`, `SeedLoaderService.resolveSoleOrganizationId`,
the lifecycle governance snapshot, `runBuildProbes`' view read, and the boot
metadata load. Every one of them was judged expected rather than diagnostic;
none was silenced on the strength of "it looks like noise".

⛔ This is not a mute. PR #10630 ruled the shape for this class on two files —
withhold only a line that names an expected table **and** carries that same
table's `no such table` reason, count what was withheld, and assert the counts —
and this applies that shape verbatim through one shared, test-only module,
`packages/runtime/src/expected-read-refusal-noise.ts`. A fixture that stopped
provoking its probe, or whose table started resolving, now goes **red** instead
of merely going quiet; the engine frame is withheld only when it sits directly
above a driver refusal the capture already recognised, so an identically-shaped
fault from any other cause still reaches the log with both halves intact.
