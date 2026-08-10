---
"@objectstack/plugin-security": patch
---

docs(plugin-security,skills): re-premise `member_default`'s removed wildcard in the published customer skill and in the plugin's own README (#7151)

Two shipped documents still described a permission-set shape the platform has not
had for two releases. Both premises were re-measured against the real imported
`defaultPermissionSets` at this branch point, and both had expired:

- `member_default.objects['*']` is `undefined` — the plain `'*'` object grant was
  removed when the platform baseline narrowed to explicit-allow.
- Neither `member_default` nor `viewer_readonly` carries a `tenant_isolation`
  entry in `rowLevelSecurity`, and neither carries any wildcard tenant policy at
  all. Tenant isolation is **Layer 0** (`tenant-layer.ts`) since ADR-0095 D1.

**`packages/plugins/plugin-security/README.md`** described the pre-ADR-0095
probe-and-strip mechanism as the plugin's own current behaviour ("Service present
→ keeps the wildcard `tenant_isolation` RLS policy … shipped with the default
`member_default` / `viewer_readonly` permission sets"). Rewritten to the real
mechanism: the plugin resolves a tenancy **posture** at start time; the tenant
wall is Layer 0, AND-composed ahead of business RLS and inert under `single`; and
the strip that survives targets the platform's own tenant-scoped policies **by
provenance** (`organization_admin`'s `sys_member_org` / `sys_invitation_org` /
`sys_team_org`, the `sys_organization_self` carve-out), never an app-authored
policy — which reaches the compiler and fails closed there (ADR-0105 D3).

**`skills/objectstack-data/SKILL.md`** (published customer guidance) did not
merely mention the wildcard — its ⚠️ callout built a recommendation on a leak
that cannot happen. The recommended recipe
(`tenancy: { enabled: false }` + `requiredPermissions`) is unchanged and still
correct, but every stated reason for it was rewritten to the measured one:

- the empty-list symptom is the Layer 0 tenant wall denying rows whose
  `organization_id` is null or absent, not a `member_default` RLS policy;
- `viewAllRecords` short-circuits business RLS only and never crosses the wall —
  that takes a true platform admin (the superuser bit **and** a
  platform-exclusive capability) on a posture that permits it;
- the ⚠️ now names the surviving hazard truthfully. `tenancy: { enabled: false }`
  alone switches the wall off for every caller, and the risk is any permission
  set with a wildcard read grant — the shipped `viewer_readonly` still has one —
  not `member_default`, which grants only the objects it names.

No runtime behaviour changes; documentation only.
