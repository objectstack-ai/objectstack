---
"@objectstack/spec": major
---

Remove the dead `PolicySchema` / `definePolicy` and the stack `policies` collection (#1882, ADR-0049).

`PolicySchema` (password / network / session / audit "org security policy") was
**100% unenforced** — no runtime consumer ever read it. Per ADR-0049
(enforce-or-remove) it is removed rather than implemented:

- `@objectstack/spec`: delete `security/policy.zod.ts` (`PolicySchema`,
  `Password/Network/Session/AuditPolicySchema`, `definePolicy`); drop the
  `policies` field from the stack schema and the `policies` collection wiring
  (`MAP_SUPPORTED_FIELDS`, `METADATA_ALIASES`).
- `@objectstack/downstream-contract`: drop the `DcPolicy` fixture/case (the
  contract gate stays green — `SharingRule` / `PermissionSet` are unaffected).
- Examples (`app-crm`, `app-showcase`): drop their unused policy definitions.

No migration needed for consumers: `policies` was never enforced. `SharingRule`,
`PermissionSet`, RLS, and all `*PolicySchema` siblings (retry/retention/RLS/etc.)
are unrelated and unchanged. Verified: hotcrm + templates have zero Policy-API
usage; downstream-contract gate green.
