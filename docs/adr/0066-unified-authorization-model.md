# ADR-0066: Unified authorization model — capability registry, secure-by-default posture, resource→capability contracts, dual-surface gates

**Status**: Accepted (2026-06-23) — D1–D5 + refinements ⑤/⑨ implemented (capability registry + `defineCapability` seeding, `access.default` posture with posture-gated superuser bypass, `requiredPermissions` AND-gates on object/field/action, `crudBucketForOperation`, `validateCapabilityReferences` lint); D4's UI half enforced in objectui ActionRunner.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (`readScope`/`writeScope` depth: own/unit/unit_and_below/org), [ADR-0058](./0058-expression-and-predicate-surface.md) (CEL predicate surface used by RLS); relates to cloud ADR-0016 (authz open/paid boundary)
**Consumers**: `@objectstack/spec` (object/app/permission schemas), `@objectstack/plugin-security` (RLS/FLS compiler + enforcement), `../objectui` (ActionRunner + app/nav gating), `../cloud` (control-plane objects, e.g. `sys_license`)

**Premise**: pre-launch — specify the target end-state. This ADR is a *consolidation*: it names the layers the platform already has, then fills four gaps with minimal additions that reuse existing vocabulary. Every item below is tagged **[existing]** or **[new]**.

> **Trigger**: `sys_license` (cloud) needed "platform-admin-only + platform-global, secret token" and there was no clean way to express it. Investigation showed this is not a one-off: the platform can declare RLS/grants only on **global permission sets** (which can't reference a tenant-private or package-private object), objects are **allow-by-default** (wildcard `'*': {allowRead:true}`), capabilities are **strings** (not maintainable records), and action gating is **per-surface** (UI predicate + a separate server check). These are general gaps.

## The three-way separation (principle)

Authorization splits into three concerns that must stay decoupled:

1. **Capability** — *what can be done* (`manage_users`, `manage_licenses`, `export_data`, `approve_invoice`). **Defined** by the platform/package, **extended** by admins.
2. **Assignment** — *who holds a capability* — permission sets / roles / user bindings. **Maintained by admins at runtime.** **[existing]** `sys_permission_set`, `sys_role`, `sys_user_permission_set`, `sys_role_permission_set` are runtime records edited in Setup.
3. **Requirement** — *what a resource needs* — an object / field / action / app **references** a capability (a contract). It does **not** encode the assignment.

The design rule that resolves the recurring confusion: **a resource declares the capability it requires (a stable contract); the capability and its assignment are dynamic, admin-maintained records.** A resource never bakes "who" — only "what is required".

## Authorization needs (taxonomy: need × status)

| # | Need | Status |
|---|---|---|
| 1 | Object CRUD (read/create/update/delete an object type) | **[existing]** permission-set `objects:{allowRead/Create/Edit/Delete}` |
| 2 | Field-level security (FLS) | **[existing, partial]** permission-set field rules |
| 3 | Row-level security: ownership (`created_by`), hierarchy (own/unit/unit_and_below/own_and_reports), org/tenant isolation, explicit sharing, CEL predicates | **[existing]** RLS compiler + ADR-0057 depth + `tenant_isolation` wildcard + sharing |
| 4 | System/functional capabilities (`manage_*`, `approve`, `export`, `issue_license`) | **[existing, as strings]** `systemPermissions` — **gap: not first-class records** |
| 5 | App / nav / page surface access | **[existing]** `App.requiredPermissions` |
| 6 | Action/button gating, enforced on **both** UI and server | **[existing, per-surface]** UI `visible`/`disabled` CEL + ad-hoc server checks — **gap: no single declaration gating both** |
| 7 | Tenancy posture (tenant-scoped vs platform-global) | **[existing]** `tenancy.enabled` |
| 8 | Default exposure posture (public-by-default vs private/deny-by-default) | **gap** — wildcard `'*':{allowRead:true}` makes every object readable by default |
| 9 | Admin tiers: platform / org / delegated | **[existing]** `admin_full_access` / `organization_admin`; delegated = future |
| 10 | Dynamic, runtime-maintained assignment | **[existing]** Setup over the RBAC records |
| 11 | Package ships secure defaults, admin-maintainable after | **[existing, partial]** `stack.permissions` seeds permission sets — **gap: per-object secure default for a package's own object** |
| 12 | Combination semantics (grants union/most-permissive; explicit deny) | **[existing]** union |
| 13 | Anti-escalation (org admin can't self-grant platform admin) | **[existing]** RBAC tables read-only for `organization_admin` |

## Decisions (four additions, each reuses existing vocabulary)

### D1 — Capability registry [new]
Promote capabilities from bare strings to **first-class records** (`sys_permission` / capability definition) with `name`, `label`, `description`, `scope` (platform | org), and a `managedBy` (platform | package | admin). `systemPermissions[]` on permission sets and `requiredPermissions[]` on resources become **references** to these records. Packages declare their capabilities; admins add new ones in Setup. Back-compat: existing string capabilities are seeded as records with the same `name`, so all current references keep resolving.

**Landed (2026-07):** the curated platform set is `@objectstack/spec` `PLATFORM_CAPABILITIES` (`security/capabilities.ts`), seeded `managed_by:'platform'` by `bootstrap-system-capabilities.ts`. "**Packages declare their capabilities**" is now an EXPLICIT API — `defineCapability` + a stack's `capabilities` array (`{ name, label?, description?, scope, packageId? }`) — materialized into `sys_capability` with `managed_by:'package'` + `package_id` provenance by `bootstrap-declared-capabilities.ts` (idempotent, upgrade-aware; refuses to hijack curated/foreign capabilities, never clobbers admin rows, and *claims* a pre-existing derived placeholder). This retires the implicit back-door where a capability existed only as an untitled placeholder derived from a permission set's `systemPermissions[]`; that derivation still runs for back-compat but skips any explicitly-declared name. A capability is **not** a contract and carries no `inputs`: DEFINE (`defineCapability`) / GRANT (`systemPermissions`) / REQUIRE (`requiredPermissions`) stay decoupled. Aligns with ADR-0094 D5 (retire implicit `managed_by`-guessing).

### D2 — Secure-by-default object/field posture [new] (data-model posture, NOT a permission)
Add an object (and field) flag that opts it **out of blanket wildcard grants** — e.g. `access: { default: 'private' }` (vs the implicit `'public'`). A `private` object is **not** covered by `'*': {allowRead:true}`; access requires an **explicit** permission-set grant. Mirrors Salesforce "new object = no access until granted." This is a posture like `tenancy`, declared on the object — it is **not** an assignment and names no principal. `admin_full_access` (the superuser `'*'` grant) still covers private objects unless it too is excluded (rare).

**Enforcement — RLS exemption via the superuser bypass (revised ①).** A `private` (or `tenancy.enabled:false`, i.e. platform-global) object must also be exempt from the wildcard RLS policies (`tenant_isolation`, owner scoping) so a platform admin — *including one who is also an org admin*, whose `organization_admin` set contributes a narrowing `tenant_isolation` policy that the OR-union would otherwise apply — sees **all** rows. The general principle (Salesforce *View All Data* / Dataverse *Organization* access level): **`viewAllRecords` bypasses read-side RLS and `modifyAllRecords` bypasses write-side RLS for that object** — but *only* when the object's posture permits it (platform-global or `private`). The posture gates the bypass so that in a shared multi-tenant DB a platform admin is **not** silently granted cross-tenant visibility on ordinary *tenant business* objects; the bypass applies to control-plane / global / private objects, which is exactly where it is wanted. This replaces the original narrower "a `private` object skips the wildcard `tenant_isolation`" wording: same outcome for `sys_license`, but one explainable rule that also covers the write path.

**When `private` vs `requiredPermissions` (D3) — author guidance (③).** `private` is a *data-model posture* — "no ambient grant; needs an explicit grant" — use it when the default answer should be *nobody*. `requiredPermissions` (D3) is a *capability contract* — "needs a named capability" — use it when the answer is *whoever holds capability X*. Either one alone secures a sensitive object; using both (as `sys_license` does) is defence-in-depth, not a requirement.

### D3 — Resource→capability requirement [existing concept, new placement]
Extend `requiredPermissions` (today only on `App`/nav, **[existing]**) to **Object**, **Field**, and **Action**. A resource references the capability (D1) needed to access/invoke it — a contract, not an assignment. The security engine enforces it as an **AND-gate** — checked *in addition to* (not instead of) the permission-set CRUD grant; see *Precedence / combination semantics*. sys_license becomes: `access:{default:'private'}` + `requiredPermissions:['manage_licenses']`.

### D4 — Dual-surface action gates [new]
An action declaring `requiredPermissions` is enforced in **one place, two surfaces**: the ActionRunner hides/disables it in the UI **and** the server rejects the call when the caller lacks the capability. Removes the "UI-gated but server-open" footgun (and the inverse). Server enforcement is the source of truth; UI gating is derived from the same declaration.

### D5 — Package-seeded, admin-maintainable policies [existing mechanism, fill the gap]
A package may seed permission-set policies (incl. per-object grants for **its own** objects) via `stack.permissions` **[existing]**; these land as `sys_permission_set` records **admins can edit in Setup** **[existing]**. The gap to close: make a package's per-object secure default (D2 + an admin-only grant) expressible + seedable so a sensitive package object is locked on install and tunable thereafter.

## What stays unchanged (existing strengths)
Permission sets / roles / bindings as runtime records (assignment layer); the full RLS spectrum (ownership, hierarchy depth ADR-0057, tenant isolation, sharing, CEL); `tenancy`; `App.requiredPermissions`; anti-escalation; union grant semantics.

## Worked example — `sys_license` (cloud)
```ts
ObjectSchema.create({
  name: 'sys_license',
  tenancy: { enabled: false },              // [existing] platform-global (no org-RLS)
  access:  { default: 'private' },          // [new D2] not covered by wildcard grants
  requiredPermissions: ['manage_licenses'], // [new D3] references a capability (D1)
  fields: { signed_token: { /* [new D3 field] requiredPermissions: ['manage_licenses'] */ } },
  actions: [{ name: 'issue_and_sign', requiredPermissions: ['manage_licenses'], /* [new D4] UI+server */ }],
});
```
Cloud seeds (D5): `manage_licenses` capability + an `admin_full_access` grant. Result: platform-global, secret token, super-admin-only — and admins maintain who holds `manage_licenses` at runtime.

## Phasing
1. **D2 + D3 (object)** — the minimal unblock: `access:{default}` posture + object `requiredPermissions` + engine enforcement. (Lets sys_license and any sensitive object be expressed correctly.)
2. **D4** — action dual-surface gating.
3. **D1** — capability registry (string→record), back-compat seeded.
4. **D3 (field) + D5** — field-level requirements + package secure-default seeding; delegated admin (#9).

## Precedence / combination semantics (②)

Authorization resolves in a fixed order, adopted from shapes proven elsewhere — ServiceNow ACLs (required-role **AND** condition), Odoo record rules (global-**AND**, group-**OR**), Salesforce (union grants):

1. **AND-gates (hard prerequisites).** A resource's `requiredPermissions` (D3) and its `private` posture (D2) are prerequisites, not grants. The caller must clear every gate *before* any grant is consulted: missing a required capability, or lacking an explicit grant on a `private` object, **denies** regardless of how permissive the rest of the configuration is.
2. **Grants union (most-permissive).** Within the gates, object-CRUD and field grants combine most-permissively across the caller's permission sets — any set that allows wins (the existing semantics).
3. **RLS: OR within an object, AND with tenant-global.** Multiple row policies for the same object/operation are OR-combined (any matching policy admits the row); the wildcard tenant-isolation policy AND-s on top as a global scope. The **superuser bypass** (D2: `viewAllRecords`/`modifyAllRecords`, gated by posture) short-circuits RLS for the object.
4. **Explicit deny overrides (when introduced).** If/when a per-resource deny is added (Salesforce permission-set-group *muting*; see Future refinements) it sits at the top and overrides any union grant. Until then there is no implicit deny except the gates in (1) and fail-closed defaults (an applicable-but-uncompilable RLS policy denies).

## Open-core boundary
All of this is **open mechanism** (framework `spec` + `plugin-security`): schema fields, the registry, the enforcement engine. The *policies* (which capabilities, which grants) are **data** — shipped by distributions/packages and maintained by admins. No commercial policy is encoded in the framework.

## Consequences
- **+** Security becomes declarative metadata co-located with the resource (single source of truth); generalizes to every object + third-party app; capabilities are admin-extensible records; sensitive resources are secure-by-default.
- **−** Migration: string capabilities → records (seeded, back-compat); a `private` default flips the implicit allow-by-default for objects that adopt it (opt-in, no forced migration).
- **−** Combination/precedence is now **explicitly specified** (see *Precedence / combination semantics*) rather than left as an open edge case; explicit deny (muting) is deferred to Future refinements.


## Future refinements (beyond the phased plan)

Captured for the record; **out of scope for Phases 1–4 above**. Each is anchored to a mainstream-platform precedent.

- **④ Deny-by-default target for sensitive objects.** Salesforce / Dataverse / ServiceNow / SAP are all deny-by-default; ObjectStack stays allow-by-default for *tenant business* objects (low-code ergonomics, à la Airtable/Notion within a workspace) but should make **system / control-plane / sensitive** objects `private` by default, ship genuine reference data (countries, currencies, picklists) as explicit `public`, and surface each object's posture visibly in Studio. The `access` flag (D2) is the primitive; this is a defaults + visibility call, staged per object — no forced migration. **System-object slice landed (2026-07):** the raw secret/credential stores — `sys_secret`, `sys_jwks`, `sys_verification`, `sys_oauth_access_token`, `sys_oauth_refresh_token`, `sys_device_code` — declare `access: { default: 'private' }`, and `sys_scim_provider` carries the D3 capability gate (mirroring `sys_sso_provider`); pinned by `platform-objects.test.ts` + the D10 matrix row `secure-by-default-posture`. Member self-service objects (`sys_session`, `sys_api_key`, `sys_oauth_application`, `sys_two_factor`) deliberately stay public-posture — the Account app reads them with a member context; row scoping is their guard. Still open: Studio posture surfacing (objectui) and the explicit-`public` reference-data convention (no such objects ship in framework today).
- **⑤ Per-operation `requiredPermissions`.** Today object-level `requiredPermissions` gates all of CRUD. ERP routinely needs "read-open / write-gated" (Salesforce & Dataverse separate capability by operation). Allow `requiredPermissions` to be either `string[]` (all operations) or a per-operation map `{ read, create, update, delete }`. Field-level (D3) and action-level (D4) requirements already give finer control; this closes the object-level gap. **Landed (2026-07):** spec `ObjectRequiredPermissionsSchema` union (`spec/data/object.zod.ts`); enforced per operation in `plugin-security/security-plugin.ts` (the `all` bucket preserves the array form's gate-everything semantics, so it is backward-compatible). `transfer`/`restore` fold into `update`, `purge` into `delete` via `crudBucketForOperation`.
- **⑥ Capabilities in the expression surface.** Salesforce *Custom Permissions* are referenceable in formulas / validation / flows (`$Permission.X`). Expose the caller's held capabilities to the CEL/predicate surface (ADR-0058) so `visible` / validation / sharing predicates can branch on a capability. High-leverage once D1 makes capabilities first-class.
- **⑦ Permission-set groups + subtractive *muting*.** Pure union does not scale governance ("permission-set explosion"); Salesforce added permission-set-group *muting* precisely to allow taking access away. Roles→permission-sets already bundle; a subtractive/deny layer (precedence step 4) is the missing piece for large-org administration. Pairs with delegated admin (#9).
- **⑧ FLS posture: unlisted fields are visible, and field grants union without deny** *(recorded 2026-07 pre-launch architecture assessment)*. Runtime FLS is block-list-shaped: `field-masker.ts` hides a field only when an explicit rule marks it `readable:false`, so an **undeclared** sensitive field is exposed by default, and `getFieldPermissions` merges most-permissively, so one set's `readable:true` permanently out-votes another's `false`. Consequences: protecting a salary/ID-number field relies on discipline (grant it only where needed), not mechanism. The object-level `private` posture (D2/④) mitigates the unlisted-default-visible half for objects that adopt it; the union half is the field-level face of ⑦ — a muting/deny layer must cover **field** grants, not just object grants, when it lands. Until then, treat "sensitive field on a `public` object" as a smell in review.
- **⑨ Authoring-time validation for capability references** *(recorded 2026-07 pre-launch architecture assessment)*. `systemPermissions` / `requiredPermissions` are free strings today; a typo (`mange_users`) fails closed at runtime — the safe direction — but is undiscoverable: nothing reports that the referenced capability exists nowhere. When D1 lands the `sys_permission` registry, add the authoring/publish-gate lint alongside it: referencing an unregistered capability warns at author time (consistent with ADR-0049 honesty and the contract-first Prime Directive — reject at the producer, don't tolerate at the consumer). **Landed (2026-07):** `validateCapabilityReferences` in `@objectstack/lint` warns (never errors — cross-package capabilities and the fail-closed runtime make a hard gate wrong) when a `requiredPermissions` reference resolves against neither the built-in set (`@objectstack/spec` `PLATFORM_CAPABILITY_NAMES`), nor a capability the stack grants via a permission set's `systemPermissions`, nor a `sys_capability` seed row. Wired into `os validate` and `os lint`. `systemPermissions` (the declaration side) is deliberately not flagged.
