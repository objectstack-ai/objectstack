---
"@objectstack/plugin-sharing": patch
---

security(plugin-sharing): a `manage_sharing` holder with no ACTIVE organization no longer reads every tenant's sharing rules (#8158)

`SharingRuleService` decided its admin read scope on the **absence of an
organization id**, not on system-ness:

```ts
if (!orgId) return where;   // unscoped — every tenant's rows
```

That unfiltered branch exists for the system context — boot seeding, the
reconcile hooks, the backfills — which legitimately reads across tenants. But
it was reached by any caller whose context happened to carry no organization,
and the ADR-0111 D6 gate admits any caller holding the **org-scoped**
`manage_sharing` capability. So an authenticated, non-system caller arriving
with neither `organizationId` nor `tenantId` received the system read scope:
`listRules` returned **every organization's** rules, `getRule` resolved any of
them by id or by name, and `evaluateRule` reached those rows too — a
cross-tenant **write**, since it reconciles `sys_record_share` grants.

**That session is reachable in a real deployment**, measured end to end over
HTTP rather than inferred: a permission-set grant is independent of
organization membership, and an org-scoped grant still resolves when the caller
has no active organization to compare it against. A user holding
`manage_sharing` with no `sys_member` row — a multi-organization deployment
(whose membership reconciler binds nobody), an `invite-only` deployment, a user
removed from their organization, an SSO JIT user pending placement — signs in,
carries the capability, and carries no tenant.

**The fix** distinguishes "system context" from "no organization id" at the
decision point instead of conflating them: `adminOrgScope`, `getRule` and
`findRuleRowByName` (three sites, one shape) now take the execution context,
and an authenticated caller with no resolvable organization is **refused** with
`PERMISSION_DENIED` (HTTP 403) naming the missing organization. A refusal
rather than an empty list, because `manage_sharing` is declared `scope: 'org'`:
with no organization there is no scope in which it grants anything, and an
empty answer over rules that exist and are actively granting access reads as
"this deployment has no sharing rules".

**Unchanged**, and covered by tests: system contexts keep the unfiltered read
and the unfiltered seed (boot seeding is untouched); **platform operators**
(`manage_platform_settings`, or the `platform_admin` position) keep it too,
with or without an active organization — that is what the platform-only Setup
sharing pages are, and a single-tenant deployment before its default
organization is bootstrapped has exactly that caller; and an org-bound admin
still sees its own organization's rules plus the platform-global ones, exactly
as #7676 / #7761 left it.
