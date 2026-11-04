---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: an external object that states no organization scope reads as empty for every caller, the platform owner included

Clause-②: no (narrowing) — under the `isolated` and `group` postures, an external object registered after the boot that states no organization scope reads as empty for every caller, the declared platform owner included; nothing is widened, and the `single` posture is unchanged.
Metadata-protocol: none

<!-- adr-0087: already-registered external-object-organization-scope-declared -->

**BREAKING** for a deployment running the `isolated` or `group` tenancy posture (`OS_TENANCY_POSTURE`) that registers an external object after the boot without stating its organization scope.

- **The rule (ADR-0015 §10 as amended).** Whose rows an external object serves is a fact only its author can state. Under a walled posture an external object that states none is refused by name when the boot completes, and one registered after the boot — a Studio import, a runtime datasource — reads as empty for every caller, the platform owner included, and accepts no write, until it states its scope. That deny judges the object's configuration, not the reader's organization.
- **What is unchanged.** The declared platform owner's reads still cross the organization wall everywhere else: on local objects, on an external object that declares its own `organization_id`, and in a session with no active organization. Writes stay walled for everyone. A member's reads are unchanged.
- **Who moves, and the fix.** Declare one of the three on the external object, as the ADR-0087 entry `external-object-organization-scope-declared` prescribes: an `organization_id` field of its own (the rows are then walled by organization), `tenancy: { enabled: false }` (shared by every organization), or `systemFields: { tenant: false }` (the same opt-out on the system fields).
