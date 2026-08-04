---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
'@objectstack/plugin-dev': patch
'@objectstack/driver-sql': patch
'@objectstack/cli': patch
'@objectstack/cloud-connection': patch
---

fix(tenancy): eight sites answered "is this deployment multi-org?" with the demoted `OS_MULTI_ORG_ENABLED` (#5262)

ADR-0105 D1 made `OS_TENANCY_POSTURE` the authoritative knob and demoted
`OS_MULTI_ORG_ENABLED` to a back-compat *input* of `resolveTenancyPosture()`.
A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
`group`), legacy boolean unset — therefore reads `false` from
`resolveMultiOrgEnabled()` while running a fully mounted organization wall.
#5233 corrected two sites in `plugin-auth`; a census found eight more, all
written before that function's doc comment was corrected. Third recurrence of
the shape (cloud#1020, #5233).

Each site was judged separately for **which** posture answers its question —
what the operator REQUESTED, or what the `tenancy` service reports is actually
IN FORCE — rather than converted mechanically:

- `objectql` `SchemaRegistry` — the env-derived multi-tenant default. Reads the
  REQUESTED posture (it is constructed below the kernel, with no service
  registry to ask). The `organization_id` column was always provisioned; what
  diverged is its INDEX, so a posture-only deployment ran the Layer 0 wall's
  hottest predicate unindexed while SecurityPlugin compiled that same wall.
- `plugin-dev` — whether to load the enterprise `@objectstack/organizations`.
  REQUESTED posture, mirroring `serve.ts`: this branch is what mounts the wall,
  so asking whether the wall is up would be circular. A posture-only dev stack
  previously never loaded the package at all and served traffic unwalled. Its
  diagnostic now names the posture that was requested instead of asserting
  `OS_MULTI_ORG_ENABLED=true` at an operator who never set it.
- `runtime` `AppPlugin` (inline seed + hot-reload seeder) — EFFECTIVE posture,
  via the `tenancy` service. These ask "will the per-org replay run instead of
  me?", and on an ADR-0093 D5 degraded boot that replay does not exist, so
  keying on the request would defer to a replay that can never happen. Walled
  deployments previously inline-seeded exactly the NULL-organization rows the
  code's own comment exists to avoid.
- `cloud-connection` marketplace local install (install-time seed + rehydrate
  heal) — EFFECTIVE posture, same reasoning. The install path is a write path:
  a walled deployment wrote every sample row with no `organization_id`, landing
  the app's data outside the wall its own reads apply.
- `driver-sql` `isMultiTenantMode()` — REQUESTED posture (a driver has no
  kernel to ask, and a suppressed warning is the costlier error for a
  diagnostic). It also no longer memoises into `_multiTenantMode`: that froze a
  process-level fact into a per-instance verdict on whichever write landed
  first. The gate now resolves live, which is affordable because
  `auditMissingTenant` consults it only after the `tenantId` early-out.
- `cli` `os verify` — REQUESTED posture. This one produced a green verification
  run over an unverified property: a posture-only deployment silently skipped
  every multi-tenant proof and exited 0.

**No configuration change is needed anywhere.** Deployments setting only
`OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
belt-and-braces configuration stays valid. Deployments that set only
`OS_TENANCY_POSTURE` can now drop the redundant boolean. Single-org behaviour is
unchanged at every site; only the knob each one reads is corrected.
