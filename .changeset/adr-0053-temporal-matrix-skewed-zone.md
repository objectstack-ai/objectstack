---
---

ci(temporal): run the non-SQL temporal backends under a skewed process zone too (#4081)

The `temporal-conformance` job pinned `TZ: America/New_York` on the live
Postgres/MySQL sweep only. `core`, `formula`, `driver-memory`, `driver-mongodb`
and `service-analytics` — the backends where a stray `getFullYear()` or a
local-midnight `new Date(y, m, d)` is easiest to write and hardest to see — kept
running in the runner's default UTC, where every offset bug is invisible because
the offset is zero.

They now run in the same skewed zone, and both TZ-skewed steps carry a
non-vacuity guard that fails the job if the process zone is UTC or the offset is
zero, so the coverage cannot silently evaporate if the runner image changes.

CI configuration only; releases nothing.
