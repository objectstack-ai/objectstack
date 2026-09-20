---
'@objectstack/plugin-hono-server': patch
---

`/auth/me/permissions` now answers a wildcard-only `viewAllRecords` principal instead of staying silent about every object it can reach.

`seedSuperUserRestrictedObjects` was guarded to `modifyAllRecords` super-users alone. A principal that reaches an object only through a wildcard `viewAllRecords` grant therefore got **no entry at all**: the client fell back to its default-allow path and rendered write and Export affordances the server answers `403 EXPORT_NOT_PERMITTED`. Same silence, same consequence, different principal class from the one framework#18931 closed.

- **One predicate admits both classes.** The seed now asks the wildcard READ bypass — `viewAllRecords || modifyAllRecords` — which is the same question `foldWildcardSuperUser` already asks to decide whose `allowRead` it pulls true, and the same one `PermissionEvaluator` applies server-side. It is now a single module-local reading both call sites share, so the seed can never materialise an entry for a principal the fold leaves entirely false.
- **A plain wildcard grant carrying neither bypass bit is still not seeded.** That is what makes the admission the read bypass rather than "any wildcard": the fold pulls nothing true for it, so a seeded entry would be an all-false claim with no server behaviour behind it.
- **The seeded entry is the truth, not an overreach.** It starts `{allow*: false}`, the fold pulls `allowRead` true, and the write bits stay false. The seed only ever touches objects with **no explicit entry**, and on those a viewAll-only principal really can only read — so "explicit false" for edit is what is true about it, where the silence it replaces was not.
- **`apiOperations` is attached through the predicate already shared with the modify-all class** — an unrestricted object whose export stays allowed is still skipped, because for it the client's default-allow path is already right.

⚠️ **This is a deliberate behaviour change on an existing published channel, ruled rather than inferred.** For a viewAll-only principal a client that reads "no entry" as default-allow now reads an explicit `allowEdit: false` instead. Two pins asserting the old silence (`toBeUndefined` for the viewAll-only principal, one of them added by the framework#18931 PR that pinned this boundary while saying the pin was not a ruling that the silence was correct) are inverted on purpose under that ruling. Payload growth is the same one-entry-per-object framework#18931 accepted, now also for viewAll principals.
