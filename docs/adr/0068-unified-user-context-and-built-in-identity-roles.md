# ADR-0068: Unified user-context contract & built-in identity roles — one `current_user` shape across formula/RLS/client, identities as roles not booleans

**Status**: Proposed (2026-06-24)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (`sys_role` is platform-native, decoupled from better-auth; `ExecutionContext.roles` = union of `sys_member.role` + `sys_user_role.role`), [ADR-0066](./0066-unified-authorization-model.md) (capability/assignment/requirement separation; resources declare a capability, never "who"), [ADR-0058](./0058-expression-and-predicate-surface.md) (CEL predicate surface)
**Consumers**: `@objectstack/spec` (the `EvalUser` contract), `@objectstack/plugin-security` (`resolve-execution-context`, RLS), `@objectstack/plugin-auth` (`customSession` bridge), `@objectstack/formula` (`buildScope`), `@objectstack/runtime`, `../objectui` (AuthProvider / ExpressionProvider / predicate scope), `../cloud` (control-plane metadata — consumer only)

**Premise**: pre-launch — specify the target end-state. This ADR is a **consolidation**: the platform already has the right model (ADR-0057 role union, ADR-0066 capability split); it fills the gaps that make the *user-facing surface* (what a formula / RLS policy / UI predicate — and the AI that authors them — actually sees) inconsistent. Items are tagged **[existing]** / **[new]**.

> **Trigger**: a platform-admin-only action (`sys_environment` "Change Plan (admin)", gated on `ctx.user.isPlatformAdmin == true`) was silently hidden in the cloud console (objectui#1928). Root cause was a *predicate-context* gap, not a permission gap. Investigation surfaced four general, related defects:
> 1. **Three names for the same user**: server formulas expose `os.user.role` (**singular**), RLS exposes `current_user.roles` (**plural array**), the client exposes `ctx.user.role` / `user.roles` / `user.isPlatformAdmin`. No predicate can be written once and evaluated everywhere.
> 2. **`role` (singular) vs `roles` (array)** coexist with subtly different semantics (`role` is overwritten to `'admin'` on promotion; `roles` is the list) — a footgun for humans and a hazard for AI authoring.
> 3. **Identity-as-boolean**: `isPlatformAdmin` is a bespoke flag orthogonal to `roles[]`; org membership tiers (`owner/admin/member`) leak in as raw better-auth strings. Identities are modeled three different ways.
> 4. **The client owns the user shape**: objectui defines its own `AuthUser` and strips it 5 independent ways (FALLBACK_USER ×3, `expressionUser`, preview) — the contract is duplicated and drifts.

## TL;DR

1. **[new] One contract**: define `EvalUser` in `@objectstack/spec`. Expose the signed-in user under the canonical name **`current_user`** (aliases `user`, `ctx.user`) with an **identical shape and variable name** in formulas, RLS, and the client. `roles: string[]` is canonical; singular `role` is at most a derived "primary" alias.
2. **[new] Identities are roles, not booleans**: seed built-in `sys_role` rows — `platform_admin` (unscoped), `org_owner` / `org_admin` / `org_member` (org-scoped) — managed, reserved, with `label`/`description`. They appear uniformly in `current_user.roles`. `isPlatformAdmin` becomes a **derived alias** of `'platform_admin' in roles`.
3. **[existing→ruled] Role-definition authority follows the isolation boundary**: global roles are defined only by the **super-admin or packages** (namespaced, managed); a per-environment tenant may define roles **inside its own env**; ad-hoc role definition in a *shared* kernel's cross-tenant namespace is **forbidden**.
4. **[ruled] v1 gating**: platform-operator actions gate on `isPlatformAdmin` (sole operator); AI-authored in-app gates use the **env's `sys_role` catalog** (closed enum + server validation). **Capability-gating is deferred** → cloud#474.

---

## Context: what each surface exposes today

| Surface | User variable | Role field | Source | Status |
|---|---|---|---|---|
| Server formula (`@objectstack/formula`) | `os.user` | `role` (**singular**) | `EvalContext.user.role` (`stdlib.buildScope`) | **[existing]** |
| Server RLS (`plugin-security`) | `current_user` | `roles` (**array**) | `ExecutionContext.roles` (union of `sys_member.role` + `sys_user_role.role`, ADR-0057 D4) | **[existing]** |
| Client predicates (objectui) | `ctx.user` / `user` | `role` + `roles` + `isPlatformAdmin` | objectui-defined `AuthUser` | **[existing]** |

The model underneath is already correct: `sys_role` is platform-native (ADR-0057), `ExecutionContext.roles` unions membership + RBAC, authz is capability/permission-set driven (ADR-0066). **Only the author-facing projection is inconsistent.**

---

## Decision

### D1 — One user-context contract (`EvalUser`), one variable name `current_user` [new]

- **`EvalUser` is defined once in `@objectstack/spec`** and imported by every evaluator. Shape:
  ```ts
  interface EvalUser {
    id: string;
    name?: string;
    email?: string;
    roles: string[];            // CANONICAL. scope-resolved (see D3).
    isPlatformAdmin?: boolean;   // DERIVED alias of `roles.includes('platform_admin')` (D2). deprecated surface.
    organizationId?: string | null;
    // role (singular) is NOT part of the contract. If retained for back-compat it is a derived "primary role" alias only.
  }
  ```
- **Canonical variable `current_user`** in all three surfaces, with `user` and `ctx.user` as **aliases pointing at the same object**. A predicate `current_user.roles.exists(r, r == 'org_admin')` (or `'org_admin' in current_user.roles`) evaluates identically in a formula, an RLS policy, and a client `visible` gate. The legacy `os.user` formula namespace also exposes `current_user`/`user`.
- **`roles` is the only canonical role field.** Singular `role` is removed from the author surface (kept, if at all, as a derived alias) — its "overwritten to `'admin'` on promotion" behavior is the footgun this eliminates.
- **Conformance** (each owns its build site):
  - `@objectstack/formula` `buildScope` — mount `current_user` (+ aliases) from `EvalUser`; **add `roles[]`** (today only `role`). **[new]**
  - `plugin-security` RLS / `resolve-execution-context` — emit `EvalUser` shape; `current_user.roles` already exists. **[existing→align]**
  - objectui — **delete the local `AuthUser`**, import `EvalUser` from spec; `ExpressionProvider` exposes `current_user`/`user`/`ctx.user` (same object); collapse the 5 fallback/guest definitions into a single `createEvalUser()` factory. **[new]**

### D2 — Identities are built-in roles, not bespoke booleans [new]

- **Seed built-in `sys_role` rows** (managed, reserved namespace, carry `label` + `description`):
  | name | scope | source of truth (unchanged) | description (for humans + AI grounding) |
  |---|---|---|---|
  | `platform_admin` | unscoped (`org_id = null`) | unscoped `sys_user_permission_set` → `admin_full_access` | "Platform operator (SaaS admin). NOT a tenant user role." |
  | `org_owner` | org-scoped | `sys_member.role = owner` | "Organization owner within a tenant." |
  | `org_admin` | org-scoped | `sys_member.role = admin` | "Organization administrator within a tenant." |
  | `org_member` | org-scoped | `sys_member.role = member` | "Organization member within a tenant." |
- **One-way projection, sources never change**: `sys_member.role` stays the source for membership; the unscoped `admin_full_access` link stays the source for platform admin; `sys_user_role` stays the source for business roles. The built-in role **names** are a normalized projection into `current_user.roles` (extends `auto-org-admin-grant`'s membership→grant pattern to the role-name layer). Nobody hand-edits the built-in rows.
- **`org_*` name normalization**: `resolve-execution-context` and the `customSession` bridge emit `org_owner/admin/member` (not the raw better-auth `owner/admin/member`) so the array is unambiguous and self-documenting.
- **`isPlatformAdmin` → derived alias** (`roles.includes('platform_admin')`). Kept during migration (so the merged objectui#1928 fix and existing predicates keep working), marked deprecated. **No new identity booleans.**

### D3 — Role-definition authority follows the isolation boundary [ruled]

- **Global / cross-tenant roles**: defined **only** by the super-admin or by **packages** (declared metadata, namespaced `<packageId>.<role>`, `managed_by: 'package'`, auto-created on install via `bootstrapDeclaredRoles`, updated/removed with the package). [existing mechanism, made a rule]
- **Per-environment tenant roles**: an env's own admin may define roles **inside that env** (separate kernel/DB ⇒ naturally isolated namespace). This is *env-scoped authoring*, not the forbidden case.
- **Forbidden**: ad-hoc role **definition** by an org inside a *shared* kernel's cross-tenant (`org_id = null`) `sys_role` namespace — it collides/leaks. (Org admins **assign** existing roles; they do not define new ones in a shared namespace.) This tightens the current "tenants may add custom rows" note on `sys_role`.
- **Out of scope (deferred)**: org-*scoped* role **definitions** in a shared kernel (would require `organization_id` on `sys_role`). Only add if a concrete "many orgs share one kernel and each needs custom role types" need appears.

### D4 — Gating policy for v1 [ruled]

- **Platform-operator actions** (e.g. `sys_environment` lifecycle, billing override) gate on `current_user.isPlatformAdmin` (≡ `'platform_admin' in roles`). Sole operator = the founder; multi-tenant-safe (a platform-scope identity, not a tenant role name).
- **AI-authored in-app gates** use the **env's `sys_role` catalog** as a **closed enum**, given to the AI as grounding *including the system-predefined roles* (`platform_admin`, `org_*`) with their `label`/`description` so it disambiguates (`org_admin` = tenant admin vs `platform_admin` = SaaS operator). The server **validates** authored predicates against the catalog and **rejects unknown role names** (anti-hallucination). Roles — concrete, enumerable, tenant-local vocabulary — are the right grounding for AI in-app authoring.
- **Capability-gating is deferred** to **cloud#474** (platform capability catalog inventory + migration of platform/cross-tenant gating to `requiredPermissions`). Per ADR-0066, *shippable cross-tenant* metadata must ultimately gate on capabilities (stable platform vocabulary), never tenant role names — but that is not needed for the one-operator v1.

---

## Scope

**v1 (this ADR):** D1 + D2 + D3 + D4. Foundational *contracts* — cheapest to land before the AI generates a large body of metadata against the inconsistent shapes.

**Non-goals / deferred:**
- Capability catalog inventory + capability-gating migration → **cloud#474**.
- Org-*scoped* custom role definitions in a shared kernel (D3 out-of-scope).
- Role visibility **hierarchy** (lives on `sys_business_unit`, ADR-0057 D5 — unchanged).
- Deeper formula/RLS unification beyond the `current_user` object (e.g. `record`/`org`/`env` namespaces) — only the user object is in scope here.

---

## Consequences

**Good**
- A predicate is written **once** and means the same thing in a formula, an RLS policy, and a UI gate — and the AI learns **one** pattern (`current_user.roles`), grounded in a closed, validated enum.
- Identities are uniform: one `roles[]` array (incl. `platform_admin`, `org_*`, package, business), **zero bespoke identity booleans** going forward.
- The contract is **framework-owned** (`@objectstack/spec`); objectui and cloud *conform/consume* instead of each re-inventing the user shape.
- Forward-compatible with capabilities (cloud#474): a role simply *bundles* capabilities; gating can migrate from role/`isPlatformAdmin` to `requiredPermissions` without touching the user-context contract.

**Bad / costs**
- A breaking-ish change to the predicate surface: `os.user.role` (formula) and bare singular `role` are deprecated. Mitigated by keeping aliases (`user`, `ctx.user`, `os.user`) and the `isPlatformAdmin` alias during migration; pre-launch ⇒ small consumer set.
- One-way projection adds a small reconcile (membership/admin → role-name in `current_user.roles`) — but it reuses the existing `auto-org-admin-grant` pattern.

---

## Migration / conformance checklist

1. **`@objectstack/spec`** — add `EvalUser`; document `current_user` (+ aliases) as the canonical predicate variable; mark singular `role` deprecated.
2. **`@objectstack/formula`** — `buildScope`: mount `current_user`/`user` from `EvalUser`; add `roles[]`.
3. **`plugin-security`** — `resolve-execution-context`: project `platform_admin` into `roles`; normalize `org_*` names; emit `EvalUser`. Seed built-in role rows (sibling to `bootstrap-declared-roles` / `bootstrap-system-capabilities`) with labels/descriptions.
4. **`plugin-auth`** — `customSession`: emit the same normalized `roles[]` (incl. `platform_admin`) + `isPlatformAdmin` alias; stop leaking raw `owner/admin/member`.
5. **`../objectui`** — delete local `AuthUser`, import `EvalUser`; `ExpressionProvider` exposes `current_user`/`user`/`ctx.user`; one `createEvalUser()` factory replaces the 5 fallback definitions.
6. **`../cloud`** — **consumer only**: no contract changes; existing `ctx.user.isPlatformAdmin` gates keep working via the alias; capability migration tracked in cloud#474.
7. **Anti-hallucination** — AI authoring is handed the env `sys_role` catalog (incl. system-predefined, with descriptions) as a closed enum; server rejects predicates referencing unknown role names.
