---
---

CI-only: the Dogfood Regression Gate no longer reports a superseded (cancelled) run as a failure — `cancelled` joins the pass branch, backed by a fail-fast experiment showing a real shard failure always aggregates as `failure`. Releases nothing.
