---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

feat(spec): `ISharingRuleService` declares the optional `declaredRuleNamed` reader that the catalog activation door uses for declared sharing rules

Clause-②: yes (widening)
Metadata-protocol: none

- **The contract member.** `ISharingRuleService` (`@objectstack/spec/contracts`) gains an optional `declaredRuleNamed?(name)` member. It returns `Promise<{ name: string; packageId?: string } | null>`: the rule the application declares under that name, or `null` when nothing servable is declared under it. The answer covers every organization, and it does not depend on whether the activation ledger has the rule switched off. `POST /api/v1/security/_activation/sharing_rule/:name` reads it to confirm the name it is asked to switch. Before this change the door read the method by duck type, and the contract did not mention it.
- **Optional, so no implementer breaks.** An implementation that serves no declared rules can leave it out. A caller probes for it and refuses fail-closed when it is absent. The activation door still answers `503 SERVICE_UNAVAILABLE` in that case, so the door's behaviour does not change. `@objectstack/plugin-sharing`'s `SharingRuleService` already implements it with a compatible signature.
- **The ledger's field description.** On `sys_metadata_activation`, the `metadata_type` description now lists every type the ledger holds: `flow`, `action`, `position`, `permission`, `sharing_rule` and `webhook`. It used to stop at `flow`, `permission`, ….
