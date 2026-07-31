---
---

test-only: the D12 honesty gate iterates the known-fake inventory — every
`CORE_FALLBACK_FACTORIES` product registered slot-by-slot must come out of
both discovery builders as `degraded`, never `available` (#3898 suggestion 4;
`cache`/`queue`/`job` had no per-slot pin before). Releases nothing.
