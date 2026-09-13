---
"@objectstack/plugin-security": minor
---

A **permission-set name collision now reaches the author**. When a package declares a permission set whose name a *different* package already owns, `bootstrapDeclaredPermissions` refuses to write into that row — correct under ADR-0086 D4, and unchanged — but the refusal is no longer invisible (#17516).

Measured on the pre-change tree, with a collision seeded and **no logger passed**:

```
skippedForeign                 = 1     (the entire declared set was dropped)
author-visible console lines   = 0     (log, info, warn, error, debug — all five)
diagnostic records on outcome  = undefined
```

The branch reported through `logger?.warn?.(…)` — optionally chained **twice** — so a caller that passed no logger produced no output at all, and a package's whole declared permission set vanished with one internal counter incremented. The comment there said *"refuse loudly"*; nothing about it was loud. Same case after the change:

```
skippedForeign                 = 1     (unchanged — the skip is not what was wrong)
author-visible console lines   = 1     warn: [security] [permission_set_name_collision] …
diagnostic records on outcome  = 1     { name, declaredBy, ownedBy, message, fix }
```

- **It prints with no sink injected.** `reportPermissionSetNameCollisions` falls back to `console.warn`, per the #10556 ruling that silent-by-declaration is rejected — an injected host sink still replaces it rather than printing beside it. The call keeps the receiver (a property-access call, never a detached `logger.warn ?? console.warn`), so a class-based host sink does not throw.
- **The refusal is also readable without a log.** `PermissionSeedOutcome` gains an optional `collisions` array carrying one diagnostic per dropped set — absent, never `[]`, when the pass hit none. A counter with no record is what made the drop undiagnosable.
- **One derivation, so two doors cannot drift.** `permissionSetNameIsForeign`, `permissionSetNameCollisionDiagnostic` and `formatPermissionSetNameCollisionDiagnostic` are exported from the package entry so a compile-time door consumes them rather than re-deriving the predicate or re-spelling the wording — the shape #14553 established for `navigationContributions`. ⚠️ Only the **runtime** door ships here; the compile-time door (`os build` / `os validate`) lives in another package and is not part of this change.
- **A stable, greppable token**, `permission_set_name_collision`, is stamped as `event` on every report. It is a snake_case data value, not an ADR-0112 error code: it is never routed to `error.code` and never reaches a wire refusal, the same discrimination the sibling `position_name_fold_grant` token already makes in this package.
- **The branch comment's premise is corrected.** It claimed package-namespaced object api names make set-name collisions a packaging bug rather than a merge case. **ADR-0130 D1 falsifies that** — N packages may co-own one namespace — so a collision is a legal configuration that gets *more* common, not an error that should never happen. The diagnostic's `fix` text names both legal resolutions.

⛔ **No wire byte moves and no skip changes.** The foreign row is still never written; `skippedForeign` still counts it; the ADR-0086 P2 publish materializer still returns its existing `permission set name is owned by another package` failure text. A non-colliding pass stays completely silent on all five console channels, asserted over a pass that really does seed and re-seed.
