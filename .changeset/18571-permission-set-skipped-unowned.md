---
"@objectstack/plugin-security": minor
---

**The permission-set seeder's unowned refusal now moves a counter.** `PermissionSeedOutcome` gains a required `skippedUnowned`, incremented on the `!packageId` branch of `upsertPackagePermissionSet` — the branch that refuses to materialize a declared set with no resolvable owner (#18571).

⛔ **The refusal itself is unchanged.** A `managed_by:'package'` row with no `package_id` makes uninstall undefined, which is exactly the ADR-0086 D3 ambiguity the branch exists to prevent. This card adds a channel, not a verdict.

#18564 gave that refusal its author-visible line. What it left is the programmatic half: the outcome came back with all six counters at zero, so a caller that reads no log at all — a boot report, a Setup surface, a test — could not tell a pass that refused a declaration from a pass with nothing to do. Measured against the sibling axis, which has counted the same refusal at the same boundary since #4967:

```
axis                       unowned refusal      counter moved   author-visible line
capability                 skippedUnowned            1                  1
permission set (before)    — none declared —         0                  1
permission set (after)     skippedUnowned            1                  1
```

**Required, not optional** — like `skippedForeign` and unlike `deleted`. An absent key on a *refusal* count reads exactly like a pass with nothing to refuse, which is the defect restated. All four construction sites initialize it (`bootstrapDeclaredPermissions`, `upsertPackagePermissionSet`, `upsertEnvPermissionSet`, `retirePermissionSetRecord`), so every door that returns this outcome answers the question.

**Both doors onto the branch increment it.** The boot catalog loop aggregates it alongside the five counters it already forwarded; the ADR-0086 P2 publish materializer passes no collector and returns its own outcome, so a fix wired only into the aggregation would have left that caller as silent as before.

**The accounting closes.** `seeded + updated + unchanged + skippedEnvAuthored + skippedForeign + skippedUnowned + unreadable` is now the number of named declarations a pass read — pinned by a conservation test modelled on the capability axis'. Before this counter that sum was short by every unowned declaration.

New published surface on `@objectstack/plugin-security`: the `skippedUnowned` member of the barrel-exported `PermissionSeedOutcome`. Reading an outcome is unaffected; the repo-wide sweep found no construction site for this type outside the package, so no consumer owes the new field.
