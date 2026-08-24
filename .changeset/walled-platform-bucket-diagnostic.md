---
'@objectstack/plugin-security': patch
---

Stop the per-organization catalog pass from reporting the platform's own
permission sets as "pre-fix" leftovers with a remedy that recreates them

On a fresh walled deployment (`OS_TENANCY_POSTURE=isolated`, three
organizations) the boot log warned, once per organization, that *"pre-fix
organization-less `sys_permission_set` rows are still present"* and offered
*"re-initialize the deployment, or adopt each row by hand"*. Both halves were
wrong there:

- **Nothing was pre-fix.** The eight rows it named (`admin_full_access`,
  `organization_admin`, `organization_admin_no_bypass`, `member_default`,
  `viewer_readonly`, `mcp_agent_data_read`, `mcp_agent_data_write`,
  `mcp_agent_restricted`) were minted 1.3 s earlier — before the deployment's
  first organization existed — by `bootstrapPlatformAdmin`, the fifth seeder,
  which the #10103 ruling deliberately left outside the per-organization
  conversion. An operator on a deployment hours old was told they were carrying
  legacy state they never had.
- **Its first remedy did not terminate.** Re-initializing a fresh walled
  deployment mints exactly those eight rows again on the next boot, so only the
  hand-adoption branch ends — and that one hands a platform-wide bucket to a
  single tenant.

The pass now separates the two classes it was conflating and reports each with
the remedy that fits, carrying a machine-readable `origin`
(`'platform-bucket'` / `'pre-fix-residue'`) beside the named rows:

- the **platform bucket** — names an organization-less writer still seeds on
  every boot — is reported as what it is, states that this organization's own
  copies were created and no action is required, and says plainly that
  re-initializing does *not* clear it;
- a **genuine pre-fix leftover** keeps the original wording and the original
  remedy, unchanged.

Membership is decided by name rather than by `managed_by`, because the question
the remedy turns on is "will a re-initialized deployment have this row again?"
— true for these names whatever provenance the current row carries (a
pre-#8692 install stores `'admin'` on the very same names). It falls back to the
shipped `defaultPermissionSets`, so a host that never threads the new
`platformBucketNames` option still classifies correctly; the option exists for
a host that overrode `SecurityPluginOptions.defaultPermissionSets`.

`bootstrapPlatformAdmin` also declares what it wrote: under a walled posture it
now logs that the platform defaults were seeded *without* an organization and
that each organization's copies come from the catalog pass. The rig's boot line
read `{"seeded":8}` with nothing to indicate the rows carried no organization
at all, so the operator's first sight of them was the warning above.

**No behaviour change to the seeding itself.** The eight rows are still minted,
still organization-less, still unreaped — that is the ruled outcome of #10103
(2026-08-20), and `PLATFORM_ADMIN` is derived from an unscoped grant pointing at
the `admin_full_access` row *by row id*, so removing them would silently demote
every platform admin. Whether the platform bucket should be materialized per
organization remains the maintainer's open call, not this change.
