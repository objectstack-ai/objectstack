---
"@objectstack/objectql": patch
---

The platform-object tenancy census is derived and gated instead of hand-written in a comment. Documentation only — no runtime behaviour changes.

`PLATFORM_OBJECT_TENANCY`'s header explained why the reclassification needs a ledger rather than a schema read, and backed the argument with three hand-written digits and a parenthetical attributing them. Nothing re-derived any of it, so it was true only until the population moved and failed silently when it did — in both of the directions a prose count can.

The parenthetical mis-attributed the exclusion: it named `sys_sso_provider`'s `tenancy.enabled: false` as an addition to the `managedBy: 'better-auth'` set that object was already in, and left `sys_api_key`'s identical opt-out unnamed. The arithmetic stayed right, which is why no reader and no gate caught it — a wrong reason producing a right total is the shape that survives longest. The digits then went stale when an object opted out of the tenant column through a third mechanism the parenthetical's taxonomy had no slot for (`systemFields: { tenant: false }`), while the gated page next door was updated in the same commit.

The digits and the parenthetical are deleted rather than corrected. The header now points at `scripts/platform-object-tenancy-census.json` and states the PREDICATE it was missing: an object is inside the machinery when `resolveTenantFieldName` answers non-null on the **registered** schema — after `applySystemFields` has injected the tenant column, because the injected column is what the engine sees, not what the author typed. Counting `managedBy` as if the resolver read it is the mistake that produced the wrong reason.

The artefact is derived by `scripts/platform-object-tenancy-census.mjs`, which loads `resolveTenantFieldName` and `resolveInjectedSystemColumns` from source and executes them rather than re-spelling what they decide, and is held to the tree by `scripts/check-platform-object-tenancy-census.mjs`. It records per object the declaration on that object's own schema that puts it outside the reach; declarations are not mutually exclusive and an object carrying two keeps both. An excluded object with no declared mechanism is an error, not a default: the generator refuses to commit the row and the gate reds, so a new exclusion mechanism is adjudicated rather than absorbed into an existing total.
