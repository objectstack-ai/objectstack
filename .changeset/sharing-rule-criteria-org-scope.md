---
"@objectstack/plugin-sharing": patch
---

**Behaviour change (narrowing):** an **org-stamped** sharing rule's criteria sweep is now scoped to that rule's own organization, where it previously swept **every** organization's records (#10119).

`SharingRuleService.findMatchingRecords` (the whole-rule evaluation pass) and `recordMatches` (the per-record write-hook pass) ran the rule's criteria query under a bare system context carrying no tenant, for every rule. The recipient half was already org-aware — `expandRecipient` threads `rule.organization_id` into the team / business-unit / position graph services — so a rule stamped with an `organization_id` expanded recipients inside its own organization and then matched records belonging to all the others. `reconcile` materialized the cross product: `sys_record_share` rows granting one organization's users access to another organization's records.

Measured on `main` before the change, through a real `ObjectQL` on a real `SqlDriver`: an `org_a`-stamped rule matched **the same four records as a platform-global rule** (`deal_a1`, `deal_b1`, `deal_b2`, `deal_p1`) and materialized a grant on each; the per-record hook pass minted a grant on `org_b`'s record with `grantsCreated: 1`.

What changes, and for whom:

- **Org-stamped rules** (`organization_id` non-null — what any org admin mints through `defineRule`) now run their criteria query with `tenantId` set to the rule's organization. The platform's existing chokepoint does the rest: `ObjectQLEngine.buildDriverOptions` threads it to `DriverOptions.tenantId` and `SqlDriver.applyTenantScope` emits `(organization_id = ? OR organization_id IS NULL)`. So such a rule matches its own organization's records **plus** platform-owned null-org records, and no other tenant's. `SharingRuleEvaluationResult.matchedRecords` falls accordingly, and the next reconcile pass **revokes** the cross-org `sys_record_share` rows it previously created, through the existing revoke-the-remainder branch — no migration is needed.
- **Platform-global rules** (`organization_id = null`) are unchanged: they keep the full unscoped sweep, which is their declared behaviour (documented at the `deleteRule` platform-authority guard). Both directions are pinned.
- **No public contract changes.** No schema, route, error code or accept/reject set moves; the system elevation on the criteria read is retained (the evaluator still sees rows no individual recipient could), only the tenant axis is added.

The cross-org rows this stops creating were **inert** under a walled posture — the Layer-0 tenant wall AND-composes over sharing's Layer-1 widening, so such a grant could not open a read across the wall. The costs were `sys_record_share` bloat (every org-stamped rule scanning the whole table at `limit: 5000`) and a population that is wrong at rest, which any consumer reading `sys_record_share` directly, or any future softening of the wall, would inherit.
