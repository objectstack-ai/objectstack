---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/cli": minor
"@objectstack/plugin-security": minor
---

ADR-0090 P4 — explain engine (D6), access-matrix snapshot gate, recalibrated benchmark.

**Explain contract (@objectstack/spec).** `ExplainRequestSchema` / `ExplainDecisionSchema` / `ExplainLayerSchema`: `explain(principal, object, operation)` reports the verdict of every evaluation-pipeline layer in order (principal → required_permissions → object_crud → fls → owd_baseline → depth → sharing → vama_bypass → rls), with per-layer contributor attribution (which permission set, reached via which position/baseline) and — for reads — the composed row filter as the machine artifact. Carries the D10 dual attribution (`principalKind`, `onBehalfOf`).

**Explain engine (@objectstack/plugin-security).** `explainAccess` is "explained by construction": it calls the SAME permission-set resolution, evaluator, FLS mask, and RLS composition the enforcement middleware calls (injected from `SecurityPlugin`), so the report cannot drift from enforcement. Exposed on the `security` kernel service as `explain(request, callerContext)`; explaining another user requires `manage_users` (the target's context is reconstructed from `sys_user_position` / `sys_user_permission_set` with everyone-anchor semantics via `buildContextForUser`).

**Access-matrix snapshot gate (@objectstack/lint + os compile).** `buildAccessMatrix(stack)` derives the (permission set × object) capability matrix purely from metadata; `diffAccessMatrix` renders semantic review lines ("'crm_admin' gains delete on 'crm_lead'", depth changes, OWD swings, entry add/remove). `os compile` gains an opt-in gate: with `access-matrix.json` committed next to the config, any drift fails the build with those lines until re-snapshotted via `--update-access-matrix` — every capability change becomes a reviewable diff. Seeded for `examples/app-crm`.

**Benchmark (ADR-0090 Addendum).** `scripts/bench/permission-bench.mts` — single-org 10k users × 1M rows per the recalibrated topology; asserts the O()-shape property (per-request cost independent of user population; unit-depth IN-set cost tracks unit size). Passing at 0.1µs/eval and 59ms/1M-row IN-set scan.
