---
"@objectstack/objectql": patch
---

feat(objectql): enforce package-first authoring at the kernel (ADR-0070 D1/D2)

A runtime-only metadata **create** that targets a read-only code/installed
package now throws `writable_package_required` (status 422) instead of silently
coercing `package_id` to `null`. The old coercion (#2252 stopgap) unblocked
editing but scattered orphans into a package-less bucket with no container to
delete (#1946); the rejection instead directs the authoring surface (Studio /
AI) to pick or create a writable base first.

`isLoadedPackage` is generalized into `isWritablePackage` (D2): a package is
writable unless it is a booted code package (registered in the engine manifest
map) or a `system`/`cloud`-scoped installed package. The old "owns ≥1 registered
object" heuristic is dropped — it was the read-only-after-publish trap (#2252),
since a writable base accrues registered objects once its drafts publish.

`null` is still accepted as the legacy org-overlay destination; ADR-0070 D5
retires it after the orphan migration.
