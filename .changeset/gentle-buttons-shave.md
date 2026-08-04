---
'@objectstack/plugin-auth': patch
'@objectstack/types': patch
---

fix(auth): `organization/create` gates on the authoritative `OS_TENANCY_POSTURE`, not the demoted `OS_MULTI_ORG_ENABLED` (#5233)

A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
`group`), legacy boolean unset — mounted the entire organization wall and still
answered `403 Creating additional organizations is disabled on this deployment.`
to `POST /api/v1/auth/organization/create`. Org-less users had no way to create
their workspace, so the guided "Create your workspace" path was a dead end.

ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
`OS_MULTI_ORG_ENABLED` to a back-compat *input* of `resolveTenancyPosture()`.
Two sites in `AuthManager` kept reading the demoted boolean directly, so both
reported "single-org" on a deployment that had asked for a wall and got one:

- `organizationHooks.beforeCreateOrganization` — the 403 above. It now judges
  `postureEnforcesWall(resolveTenancyPosture())`, matching the knob `serve.ts`'s
  own ADR-0093 D5 boot guard keys on. Intent is unchanged (single-org still
  refuses); only the knob is corrected.
- `/auth/config`'s `features.multiOrgEnabled` — its no-tenancy-service fallback
  read the same boolean. It now falls back to the resolved posture, so a lean
  embedding advertises the capability its own gate allows.

**No configuration change is needed anywhere.** Deployments that set only
`OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
workaround people used to unblock themselves stays valid. Deployments that set
only `OS_TENANCY_POSTURE` can now drop the redundant boolean.

`resolveMultiOrgEnabled()`'s doc comment in `@objectstack/types` — which still
instructed "the auth manager's `/auth/config` feature flag and org-create guard
… MUST call this", written before the demotion — now says the opposite: ask the
posture, and never gate on this boolean. Its behaviour is unchanged.
