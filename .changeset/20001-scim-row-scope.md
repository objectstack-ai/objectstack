---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: the SCIM projection tables are row-scoped in every shipped permission set — no principal below platform admin reads a SCIM row another organization provisioned (#20001)

Clause-②: no (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner and the ADR-0087 disposition below, never by the level).

The seven `@better-auth/scim` tables carry no tenant column, so the organization
wall is inert on them, and the read that the shipped permission sets grant on
every better-auth-managed object had no row policy behind it for any of the
seven. Any authenticated member could therefore read the users, groups and
memberships every organization's identity provider had provisioned.

**What a principal can no longer read.** Every shipped set that grants that read
and carries row-level security — `member_default`, `viewer_readonly`,
`organization_admin` and its wall-less variant `organization_admin_no_bypass` —
now declares a row policy on each table:

- `sys_scim_user`, `sys_scim_subject`, `sys_scim_projection_grant` and
  `sys_scim_identity_tombstone`: only the rows whose `user_id` is the caller
  (the `<table>_self` policies);
- `sys_scim_group`, `sys_scim_group_member` and `sys_scim_connection_binding`:
  no row at all (the `<table>_none` policies).

This binds organization admins as well: an org admin no longer reads their own
organization's SCIM users or groups, only the rows about themselves. An MCP
agent acting for a user is bounded by that user's sets and reads the same. No
organization-scoped read replaces the old one, because none of the seven tables
has a column naming the organization and a row policy cannot follow
`connection_id` to the connection's organization. `admin_full_access` is
unchanged and still reads every row.

**Remedy.** A deployment that needs a principal below platform admin to read
these tables grants it in a permission set of its own, with a row-level-security
policy on each table that names the rows it may see. Do not reach for a policy
that admits every row: no organization wall bounds these tables, so such a
policy admits every organization's rows.

Unchanged: SCIM provisioning itself (its reads and writes run through
better-auth's adapter under system context, which no row policy reaches), and
every other managed object.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: `packages/spec` is untouched, no object definition or column changes, and the shipped permission sets are code evaluated from the in-memory declaration, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. The change is a narrowing of what the platform's own sets admit at runtime. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers it (not `registered` / `already-registered`); and it is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
