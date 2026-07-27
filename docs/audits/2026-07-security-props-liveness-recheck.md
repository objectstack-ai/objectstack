# Recheck: "parsed-but-unenforced security props" — current state

**Date**: 2026-07-25 · **Supersedes**: the security cluster of
[`README.md` §1](./README.md) and [`2026-06-security-identity-property-liveness.md`](./2026-06-security-identity-property-liveness.md)
(both dated 2026-06-15). · **Umbrella**: #1878.

The 2026-06 audit flagged a cluster of security-shaped properties as
"parsed-but-unenforced — latent access-control gaps / false compliance." Those
docs are now **substantially stale**: the gap was closed the correct way — the
dead spec surface was *deleted*, the real capabilities were *rebuilt as enforced
settings / engine paths*, and the remaining schema-only items were *pruned*.
This recheck records the current per-property status with `file:line` evidence
so the umbrella can be closed on this cluster and the two remaining prune
candidates can be actioned.

> **Method note.** Three independent read-only passes over the open-framework
> PRIMARY checkout. Enforcement that ships in the closed
> `@objectstack/security-enterprise` / cloud `service-ai` packages is **not**
> in this repo — where a capability is enterprise/cloud-enforced it is called
> out explicitly, and the open edition's **fail-closed** default is cited.

## Per-property status

| Property (2026-06 claim) | Current status | Evidence | Disposition |
|---|---|---|---|
| **`PolicySchema`** — "100% dead, false compliance" | **DELETED, then rebuilt as enforced settings** | Schema removed in v11.0 (`#2387`, ADR-0049 enforce-or-**remove**); capabilities rebuilt on the auth Settings namespace by **ADR-0069** (`service-settings/.../auth.manifest.ts`, bound via `plugin-auth/src/auth-plugin.ts` `bindAuthSettings`) | keep-removed |
| ├ password complexity / min-length | **ENFORCED** | `auth-manager.ts` `assertPasswordComplexity` (sign-up/reset/change); native `min/maxPasswordLength` | keep |
| ├ HIBP breach check | **ENFORCED** (opt-in) | `auth-manager.ts` mounts `haveIBeenPwned()` when `password_reject_breached` | keep |
| ├ account lockout | **ENFORCED** | `assertAccountNotLocked` + `recordSignInOutcome` (`failed_login_count` / `locked_until`), settings `lockout_threshold`/`lockout_duration_minutes` | keep |
| ├ MFA / `forceMfa` | **ENFORCED** (renamed) | `computeAuthGate` → `MFA_REQUIRED`; spec `forceMfa` → setting `mfa_required` + per-org `sys_organization.require_mfa` | keep (intentional naming drift) |
| ├ session timeout (expiry/idle/absolute/concurrent) | **ENFORCED** | native `session.expiresIn`/`updateAge` + `enforceSessionControls` (P2) | keep |
| ├ IP allow-list | **PARTIAL** — global enforced; per-org/user not landed | `AuthManager.isClientIpAllowed` + auth-route 403; per-org `sys_organization.allowed_ip_ranges` unimplemented | wire per-org (**#2571**) |
| ├ audit retention (old `PolicySchema.audit.*`) | spec field gone; behavior on the **lifecycle** surface | retention enforced by LifecycleService from `lifecycle` declarations + settings | keep |
| **Permission `allowTransfer`** | **ENFORCED** | owner-write guard `plugin-security/src/security-plugin.ts` → `checkObjectPermission('transfer', …)` → `PermissionDeniedError` (#3004) | keep |
| **Permission `allowRestore` / `allowPurge`** | **PARTIAL** — bits pre-mapped + fail-closed; the `restore`/`purge` ops are M2-pending (nothing ungated) | `permission-evaluator.ts` `DESTRUCTIVE_OPERATIONS` deny-by-default; no `restore`/`purge` ObjectQL op exists yet | keep (M2 roadmap) |
| **Object `apiEnabled` / `apiMethods`** | **ENFORCED** on both surfaces | hono `rest-server.ts` `enforceApiAccess` (404/405); runtime dispatcher `http-dispatcher.ts` → `api-exposure.ts checkApiExposure` (landed #1937; `import`/`export` verbs added #3391/#3025) | keep |
| **Action `disabled` (CEL)** | **DEAD in framework** — runtime gating is an objectui concern | spec converged on `disabled` (`action.zod.ts`; no `enabled` key); only framework reader is the design-time lint `validate-expressions.ts` | wire-rename in **objectui** (`action-button.tsx`) |
| **Agent `permissions` / `access`** | **ENFORCED in the shipped runtime** (enterprise/cloud), PARSED-ONLY in tracked source | seat plumbing tracked (`core/src/security/resolve-authz-context.ts`, `plugin-hono-server`); the gate that reads them + 403s ships in the **git-untracked** `service-ai/dist` bundle | keep (document as enterprise-enforced) |
| **Agent `visibility` / `tenantId`** | **PRUNED** | removed as security-shaped fields that lie (`#1901` / `#2377`) | done |
| **Flow `runAs`** | **ENFORCED** (data ops) | `service-automation/src/engine.ts` → `runtime-identity.ts` → `builtin/crud-nodes.ts`; dogfood `flow-runas.dogfood.test.ts` | keep |
| **Role `parent`** (manager rollup) | **DEAD / never existed** | "Role" → `sys_position`, explicitly **flat** (`identity/position.zod.ts`, ADR-0090 D3); hierarchy uses the BU tree + `sys_user.manager_id`, not a position parent | done (superseded) |
| **SharingRuleSchema** | **PARTIAL** — criteria-type enforced; owner-type + group/guest recipients dead | registered `metadata/src/plugin.ts`; enforce path `plugin-sharing/.../sharing-rule-service.ts` (criteria → `recordMatches` → `expandRecipient` → `sys_record_share`); owner-type / group / guest recipients skipped in `bootstrap-declared-sharing-rules.ts` | **enforce-or-prune** the dead recipient types |
| **ADR-0057 hierarchy scope** (`unit`/`unit_and_below`/`own_and_reports`) | **ENFORCED** mechanism; `own`/`org` concrete here, the three hierarchy depths **fail-closed** to enterprise resolver | evaluator `permission-evaluator.ts` → filter `sharing-service.ts` → live queries `sharing-plugin.ts`; hierarchy depths via pluggable `IHierarchyScopeResolver`, open edition returns owner-only when absent; authoring gate `stack.zod.ts` requires `hierarchy-security` | keep (seam correct, fail-closed) |

## Net

The "false compliance" narrative no longer holds: of the eight flagged items,
**five are enforced** (password/MFA/lockout/session policy, `allowTransfer`,
`apiEnabled`/`apiMethods`, `runAs`, ADR-0057 scope + criteria SharingRules),
**two were correctly pruned** (`PolicySchema`, agent `visibility`; `role.parent`
never existed), and the rest are roadmap (`allowRestore`/`allowPurge` M2) or
enterprise/cloud-enforced (agent `access`).

## Genuine remaining loose ends (actionable)

1. ~~**Prune `AuditRetentionPolicySchema`**~~ — **✅ Done (2026-07-27)**, and the
   verified scope was larger: the **entire `audit.zod.ts` module** (AuditConfig /
   AuditStorageConfig / AuditRetentionPolicy / AuditEventFilter /
   SuspiciousActivityRule + the AuditEvent* shape schemas) had zero consumers —
   the live audit path (plugin-audit) captures unconditionally via engine hooks
   and defines its own `sys_audit_log` row shape, and `AuditConfigSchema.enabled`
   contradicted the always-on compliance-ledger contract. Whole module removed;
   the enforced authoring surface is object/field `trackHistory` + the object
   `lifecycle` `audit` category, with per-org overrides in settings.
2. ~~**SharingRule dead recipient types**~~ — **✅ Done (#3557)**: recipients
   reconciled against the live identity model — `group` wired as `team`,
   `business_unit` added, and the unenforceable `guest` recipient + `owner`-type
   rules removed from the authoring surface (authored rules no longer silently
   no-op).
3. **Per-org / per-user IP allow-list** — global-only today; per-org
   `sys_organization.allowed_ip_ranges` is unimplemented (tracked **#2571**).
4. **Doc / ledger drift** (non-code-behavior):
   - `packages/qa/dogfood/test/authz-conformance.matrix.ts` still marks
     `flow-run-as` as `removed / ADR-0049 → roadmap M2`, contradicting the live
     enforcement + passing dogfood tests. Stale ledger entry.
   - The agent `access`/`permissions` schema comment asserts in-repo
     enforcement, but that gate lives in the untracked `service-ai/dist` — the
     comment should point at the enterprise package.
   - This doc supersedes the two stale 2026-06 security audits (annotated).

None of these is a live "authored-but-silently-unenforced" access-control gap of
the kind the 2026-06 audit warned about; they are cleanup + one tracked feature.
