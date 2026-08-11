---
'@objectstack/plugin-sharing': patch
---

Make package-seeded sharing rules visible and addressable by name to org-scoped admins

Sharing rules seeded from an app or package are defined under the system context, so they are stored with `organization_id = null` (platform-global). `SharingRuleService.listRules` and the by-name fallback of `getRule` scoped their reads with a strict `organization_id = <caller org>` equality, which such a row can never satisfy. An authenticated org-scoped admin therefore saw `GET /api/v1/sharing/rules` return an empty list over a table of active seeded rules, and by-name `GET` and `evaluate` answered 404 `RULE_NOT_FOUND`; only the by-id branch, which was never org-scoped, still worked.

Both admin reads now match "this organization OR platform-global", mirroring how enforcement has always read these rows under the system context. Consequences worth knowing:

- Seeded rules now appear in the admin rule list and can be fetched, evaluated and deleted by name. An org admin could already do all three **by row id** — the by-id branch carries no org filter — so this adds an address form and discoverability, not a new authority. Deleting a package-seeded rule remains reversible: the next boot reseeds it.
- Rules belonging to a **different** organization remain invisible and unresolvable by name; only rows belonging to no organization at all become visible.
- `defineRule` is deliberately **not** widened. Its existence lookup decides upsert-vs-insert, so widening it would let one organization's admin rewrite a row every other organization reads. A same-named create still produces a row stamped with the caller's own organization, and by-name lookups prefer that row over the platform-global one.
- Callers passing a context with no organization (boot seeding, rule hooks, backfills, the boot reconcile) are unaffected — that path was already unfiltered and is unchanged.
