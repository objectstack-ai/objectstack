---
"@objectstack/plugin-sharing": patch
---

revert(plugin-sharing): drop the NULL-inclusive business-unit screen added after 17.2.0

17.3 does not ship the NULL-inclusive business-unit screen added after 17.2.0;
#14547 remains as in 17.2.0 and is fixed structurally in v18 (the v18 org-ownership decision (PR #14976), C1: the
Default Organization exists before application seed datasets load, and the seed
loader stamps `sys_business_unit` seeds).

`BusinessUnitGraphService.orgScope` briefly read
`$or: [{ organization_id: <rule org> }, { organization_id: null }]` so that an
org-stamped sharing rule could name a seeded (org-less) `sys_business_unit`
row. It is restored to the strict `organization_id = <rule org>` equality
17.2.0 ships. That shape re-implemented, a second time and in a second place,
the predicate `SqlDriver.applyTenantScope` already owns — the duplication
the v18 org-ownership decision (PR #14976) exists to retire (#10103 cause 1) — and it had not been released, so
reverting costs nothing while shipping it would have owed v18 a breaking change
and a migration.

The other half of the same change is KEPT and is not touched:
`BusinessUnitGraphService.memberScope` still screens both
`sys_business_unit_member` reads with a strict equality. Those reads previously
carried no organization predicate at all, so an org-stamped rule reaching any
visible unit collected every tenant's membership rows hanging off it; a strict
unit screen narrows which units are reachable but does not close that, because
other organizations' member rows sit on org-stamped units too.
`SharingRuleService.warnOnEmptyUnitExpansion` is also kept: it is what keeps the
remaining #14547 symptom loud instead of silent.
