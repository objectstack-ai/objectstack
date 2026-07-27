---
---

CI/test-only: dogfood suite splits into a `shared-showcase` vitest project (12 eligible files share one plain showcase boot per worker via `isolate: false`) and an `isolated` project keeping vitest defaults. Measured: ~93% of the gate's compute was per-file boot overhead. Releases nothing.
