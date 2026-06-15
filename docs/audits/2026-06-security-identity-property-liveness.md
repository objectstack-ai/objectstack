# Audit: Security/Identity metadata liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/{identity,security}/*.zod.ts` — RoleSchema, PermissionSetSchema, PolicySchema, SharingRuleSchema. **Consumers**: `plugin-security`, `plugin-sharing`, `plugin-auth`, `objectql`. No dedicated Studio designers — generic metadata-admin forms only. **⚠️ This layer is security-critical: "parsed but unenforced" = latent access-control gap.**

## 🔴🔴 PolicySchema is 100% DEAD (highest impact)
Every prop — `password.*` (minLength/requireUppercase/…), `session.*` (idle/absolute timeout), `forceMfa`, `network.*` (`trustedRanges`/`blockUnknown`/`vpnRequired`), `audit.*` (retention/redaction), `isDefault`, `assignedProfiles` — has **zero runtime consumers**, and `PolicySchema` **isn't even registered as a metadata type** (absent from `metadata-type-schemas.ts`). `better-auth` (`auth-manager.ts:458`) runs its own **hardcoded** session/scrypt config, fully independent. **Authoring a security/compliance Policy gives a false sense of compliance with zero enforcement.**

## 🔴 PermissionSet — destructive lifecycle ops not gated
- `objects.*.allowTransfer` / `allowRestore` / `allowPurge` — **DEAD**: omitted from `OPERATION_TO_PERMISSION` (`permission-evaluator.ts:8-16`). Ownership transfer, undelete, and hard-delete/GDPR purge (the most destructive ops) are **not gated by RBAC**.
- `isProfile` — DEAD (profile-vs-permset never gates anything).
- `systemPermissions` — PARTIAL: enforced only for **app-entry/nav visibility** (`hono-plugin.ts:741`), **not** as a general capability gate (e.g. `manage_users` is checked nowhere in the data path).
- `tabPermissions` — PARTIAL: only `'hidden'` is read; `default_on`/`default_off` never read; UI-only, not a boundary.
- `contextVariables` (RLS) — **DEAD**: `rls-compiler.ts` never reads it (doc claims runtime evaluation; RLS uses only `current_user.*` built-ins).
- **LIVE & fail-closed**: `objects.*` CRUD, `viewAllRecords`/`modifyAllRecords`, `fields.*` FLS (read-mask **and** write-deny), `rowLevelSecurity` (find + analytics raw-SQL).

## 🔴 Role.parent is DEAD
`team-graph.ts:27` explicitly does **not** walk a hierarchy. The schema's documented "managers see subordinates' data" rollup is **unimplemented** everywhere. `label`/`description` display-only.

## 🔴 SharingRuleSchema is disconnected from the live engine
The runtime enforces a **separate, divergent** `sys_sharing_rule`/`sys_record_share` model: `criteria_json` is a **JSON ObjectQL filter, not** the spec's CEL `condition` (unparsable CEL → "match nothing", `sharing-rule-service.ts:33`); `recipient_type ∈ user/team/department/role/queue`, **not** the spec enum (`role_and_subordinates`/`group`/`guest`). The spec `SharingRuleSchema` has **no runtime consumer** — authoring it has no effect. (Runtime sharing itself IS live + enforced via `sharing-plugin.ts:227`, just under a different contract; role expansion is flat — no subordinate rollup.)

## Recommendation (security ADR — high priority)
1. **PolicySchema**: enforce (wire into better-auth + audit) or delete — shipping unenforced security policy is a compliance liability.
2. **Gate `allowTransfer`/`allowRestore`/`allowPurge`** (add to `OPERATION_TO_PERMISSION`) — destructive ops must be permissioned.
3. **Reconcile SharingRuleSchema with `sys_sharing_rule`** (one contract) or document the spec as non-authoritative.
4. Implement or remove Role `parent` hierarchy and RLS `contextVariables`.
