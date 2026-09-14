---
"@objectstack/plugin-security": minor
---

A **capability name collision now reaches the author**. When a package declares a capability whose name a *different* package already owns, `bootstrapDeclaredCapabilities` refuses to write into that row — correct under ADR-0086 D4, and unchanged — but the refusal is no longer invisible (#18023).

Measured on the pre-change tree, with a collision seeded and **no logger passed**:

```
skippedForeign                = 1     (the declaration was dropped)
author-visible console lines  = 0     (log, info, warn, error, debug — all five)
diagnostic records on outcome = undefined
```

The branch reported through `logger?.warn?.(…)` — optionally chained **twice** — so a caller that passed no logger produced no output at all, and a package's whole declared capability vanished with one internal counter incremented. This module's own header said such a row was "skipped loudly"; nothing about it was loud. Same case after the change:

```
skippedForeign                = 1     (unchanged — the skip is not what was wrong)
author-visible console lines  = 1     warn: [security] [capability_name_collision] …
diagnostic records on outcome = 1     { name, declaredBy, ownedBy, grantedBy, message, fix }
```

**What the author is told is axis-specific, and deliberately not a copy of the permission-set wording.** On that axis the entire declared set is not materialized and none of its permissions are in effect. Here the capability name still *resolves* — the owning package's row answers for it, and the seeder still reports the name as materialized so the back-compat derivation does not clobber that row. What is lost is narrower and is now stated precisely: the declaring package's authored `label`, `description` and `scope` are not applied, and `sys_capability.package_id` attributes the capability to the other package, so the declaring package has no provenance claim over it. The record also names the bootstrap permission set(s) that grant the capability, so the blast radius does not have to be looked up.

New published surface on `@objectstack/plugin-security`, for the same reason the permission-set diagnostic is published — the author-time door must consume one derivation rather than re-spell it:

- `CAPABILITY_NAME_COLLISION` — the stable `capability_name_collision` grep token.
- `capabilityNameCollisionDiagnostic()` / `CapabilityNameCollisionDiagnostic` — the record.
- `formatCapabilityNameCollisionDiagnostic()` — the one-line rendering.
- `reportCapabilityNameCollisions()` — the report channel, which prints through `console.warn` when no sink is injected and keeps the receiver when one is, so a class-based host logger does not throw.

⛔ **The owner-comparison predicate is not duplicated.** Both axes call the existing `permissionSetNameIsForeign`, and the capability seeder's branch now routes through it instead of its own `===`, so a nullish owner reads FOREIGN on both axes by construction.

`CapabilitySeedOutcome` gains an optional `collisions` key carrying those records, so a caller that reads no log at all can still ask what happened. It is absent, never `[]`, when a pass collided on nothing.
