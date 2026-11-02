---
'@objectstack/verify': patch
---

docs(verify): the `BootOptions.multiTenant: 'posture-only'` doc comment says what the stand-in walls and what it does not

Clause-②: no
Metadata-protocol: none

Doc comments only; no behaviour changes. The `multiTenant` doc comment said a `'posture-only'` boot stamps no `organization_id`, scopes no query, and that a cross-organization fixture booted this way "would assert nothing". Since ADR-0131 (D8, D11) the organization wall keys on the posture in force, so that was the opposite of what the code does:

- **Insert.** The engine lands a write in the caller's active organization, and the SQL driver stamps an absent `organization_id` from it.
- **Read.** Layer 0 and the driver scope project one verdict, which walls under `isolated` (`organization_id = active org`) and `group` (`IN accessible_org_ids`).

The comment now says a cross-organization fixture can boot this way, as long as it measures the wall: the other organization's row is hidden, its own row is served, and the stamp is checked. It also names what the stand-in does not give a fixture, for which `multiTenant: true` with `@objectstack/organizations` is still needed: the default-organization bootstrap, per-organization seed replay, the walled membership-policy gate, and the deployment declarations on the `org-scoping` service. It notes that `databaseDriver: 'memory'` refuses a walled posture. The `orgContext` comment no longer says `multiTenant: true` is the only cross-organization proof.
