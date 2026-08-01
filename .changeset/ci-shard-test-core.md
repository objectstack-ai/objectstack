---
---

CI-only: shard the Test Core job by package (deterministic, test-file-count-balanced
halves via `scripts/partition-test-shards.mjs`), move the dogfood verify-CLI pass into
its own parallel job aggregated by the existing Dogfood Regression Gate, and repoint
the temporal-conformance Turbo cache fallback at the Build Core namespace. Releases
nothing.
