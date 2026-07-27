---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
'@objectstack/plugin-auth': minor
'@objectstack/core': minor
'@objectstack/types': minor
'@objectstack/lint': minor
'@objectstack/platform-objects': minor
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/plugin-approvals': patch
'@objectstack/cli': patch
---

ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
first-class authorization dimension.

> This release carries BREAKING spec removals (see "Enforce-or-remove" below)
> but is recorded as `minor`: every publishable package is in the Changesets
> lockstep group, so one `major` would promote the whole monorepo. Breaking
> changes ship as `minor` during the launch window — the migration notes below
> are what reach consumers in `CHANGELOG.md`.

## Tenancy is now a spectrum (D1)

`single | group | isolated`, resolved by the `tenancy` service and selected with
the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
`OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
(`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
rather than silently landing in a posture with no organization wall.

- `single` — no wall (unchanged).
- `group` — **new.** Organizations are membership boundaries over one shared
  dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
  semantics). Enforced by the OPEN engine.
- `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
  probe and degraded-boot handling all unchanged.

## Organization scope is a first-class context field (D2)

`ExecutionContext.accessible_org_ids` — every organization the caller holds a
currently-valid membership in (ADR-0091 validity windows) — is resolved once by
`resolveAuthzContext` and carried by every transport. The `group` wall reads it
directly; RLS policies may reference it as
`organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
fails the wall closed.

Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
computed independently of the RLS compiler, AND-composed outermost, and
crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
ADR-0095's W1/W2 invariants hold in every posture.

## Two P0 correctness fixes (D3, D4) — behavior changes

**D3 — app-authored org-scoped RLS policies are no longer silently dropped**
(finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
`using` contained the substring `current_user.organization_id` when isolation was
inactive, which swallowed app-authored policies as well as the platform's own.
Stripping is now decided by PROVENANCE (identity against the shipped
declaration). **Upgrade impact:** in a deployment with no organization wall, an
app-authored policy referencing the active organization is now RETAINED and
fails closed (zero rows) with a one-time warning, where it previously vanished
and the object read unscoped. `getReadFilter` shared the defect, so analytics and
raw-SQL consumers were affected too. If a policy was only ever meant for
multi-org, delete it or install `@objectstack/organizations`.

**D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
boundary** (finding F2, framework#3540). Under a wall-less posture nothing
bounded the wildcard superuser bits `organization_admin` carries, so a
deployment that accumulated organizations (personal orgs on signup) made every
owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
revokes the superseded variant whenever the posture changes. **Upgrade impact:**
in `single` posture an org owner/admin keeps full CRUD but loses the blanket
ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
available through `admin_full_access` or an explicitly authored permission set —
it just stops being a side effect of a better-auth membership role.

## Engine-owned organization stamping (D5)

Under any wall-enforcing posture the engine stamps `organization_id` from the
caller's active organization on an insert that omits it, and validates every
supplied value against the wall. Idempotent with the enterprise auto-stamp
(neither overwrites a supplied value). This also closes a real hole: the
pre-existing post-image check required a non-array payload, so a BULK insert
could carry a forged `organization_id` per row. One forged row now denies the
whole write.

## Group structure, extension fields and red-line lints (D6, D7)

- `sys_organization` gains `parent_organization_id` and `sort_order` — a
  **reporting dimension only**.
- New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
  `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
  `os validate`: an RLS policy or sharing rule that walks the org tree is an
  error, as is a business-unit grant on a platform-global object.
- Extension fields on better-auth-managed objects ride the existing ADR-0092
  whitelist. A new guard derives better-auth's real field surface from
  `getAuthTables()` at the pinned version and fails the build on any name
  collision, so a library upgrade cannot silently take ownership of a column.

## Enforce-or-remove (D11) — BREAKING

Both removals are of surface that had **zero runtime consumers**, so no
behavior changes; authoring them is now a no-op instead of a lint warning.

- **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
  it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
  supplied by a registered membership resolver (below); a constant belongs in
  the policy itself as a literal (`status = 'published'`).
- **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
  — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
  matrix requirements are served by multi-position × business-unit anchoring; a
  generalized dimension-security module will arrive with its own ADR.
- **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
  merged since ADR-0056 finally has a producer: register an
  `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
  `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
  construction — an unresolved key makes its policies drop out. Kernel-owned
  keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
  overwritten from this seam.

## Edition boundary (D12)

The `group` posture's enforcement primitives ship OPEN — the union wall,
`accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
fixes and the D6 lints — because the correctness of a wall is never a paid
feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
enterprise `org-scoping` probe, so the current commercial boundary for
legal-entity isolation is unchanged by this release.
