---
"@objectstack/cli": patch
---

`os build` and `os validate` now report a **permission-set name collision** — the compile-time half of the #17516 refusal, raised behind the SAME predicate and the SAME sentence as the runtime door so the two cannot drift (#18024).

When two packages in one artifact declare a permission set under the same name, `bootstrapDeclaredPermissions` refuses to write into the row the first one owns. That refusal is correct under ADR-0086 D4 and is **unchanged here** — the whole declared set (its object, field, tab and system permissions) is dropped at boot, and nothing else reports it. #17516 gave that drop a runtime door; until now no door said anything at compile time, so the first an author heard of it was a boot warning on a deployed environment.

Measured on the pre-change tree (`origin/main` 8fe5cb8e5), by grep over `packages/cli/src`, `packages/spec/src` and `packages/metadata/src`:

```
permission-set collision diagnostic, compile time  = 0 files
control: `collision|duplicate` in packages/cli/src = 20 files   (so the zero is a reading,
                                                                 not a dead grep)
```

Both commands now compute it, and the findings ride the `warnings` key both payloads already declare — no new top-level key, and no new published export.

- **Reports; it never refuses.** `severity: 'warning'` is declared at the producer and the failure direction is CLOSED: the set is not installed, so nothing is over-granted. Exiting non-zero would narrow what `os build` accepts, which is the option #14553's ruling weighed for `navigationContributions` and did not take.
- **One derivation, so the two doors cannot drift.** The owner comparison is `permissionSetNameIsForeign` and the sentence is `permissionSetNameCollisionDiagnostic` + `formatPermissionSetNameCollisionDiagnostic`, both consumed from `@objectstack/plugin-security`'s package entry — where #17516 published them for exactly this consumer. No second predicate, no retyped sentence: two doors phrasing one refusal differently is the defect, not the fix.
- **Only the composed case is judged.** A name owned by a package some *other* artifact installed is invisible without a database and stays unreported — the same bound the navigation-contribution check keeps for a contribution aimed at an app no package here ships.
- **A package re-declaring its own set name is not a collision.** That is an idempotent re-seed at runtime, which is why the check asks the shipped ownership predicate rather than counting duplicate names. Ablated on disk: removing that one call leaves the suite at 1 failed / 9 passed, and restoring it returns 10 / 10.
