---
"@objectstack/plugin-security": minor
"@objectstack/cli": minor
---

fix(cli,plugin-security): `os meta resync` to re-materialize default permission sets from dist (#2705)

The default permission sets (`admin_full_access` / `member_default` /
`viewer_readonly` …) were seeded **insert-once** at boot: `bootstrapPlatformAdmin`
skipped any row that already existed and never wrote the shipped declaration
back. So editing a default set's source, recompiling, and restarting `os dev`
**without** `--fresh` left the runtime serving the OLD value — silently, because
the runtime authz resolver hydrates permission sets from the `sys_permission_set`
row (`resolve-authz-context.ts`), not from the in-memory dist. A permission-gated
surface (e.g. `setup.access`) would keep its stale behavior with no error, which
repeatedly misled debugging. Every *other* metadata seed (declared permission
sets, positions, built-in roles, capabilities) already upserts on boot, leaving
the platform-default path the lone insert-once holdout — a gap ADR-0090 widened
by persisting more facets (`system_permissions`, delegated-admin `admin_scope`)
onto the same row.

The insert-once posture is deliberate for prod (it protects an admin's Setup
edits and keeps the defaults env-authored — the exact posture
`bootstrapDeclaredPermissions` relies on), so this is **not** switched to a blind
upsert. Instead:

- `bootstrapPlatformAdmin` gains a `resync` option. Default boot behavior is
  unchanged (insert-once). Under `resync`, an existing row is reconciled to the
  shipped dist **only** when the platform still owns it (`managed_by` absent or
  `'platform'`); a row an admin took over (`managed_by:'user'`) or a package owns
  (`'package'`) is an intentional override and is left untouched.
- New `os meta resync` command boots the runtime, reconciles the default
  permission-set rows to the compiled dist, and reports what was reconciled /
  preserved / newly seeded — **without touching business data** and without a
  `--fresh` wipe. Gated behind a confirmation prompt (`--yes` to skip; `--json`
  for scripting).

Prod boot is unaffected; the fix is entirely opt-in via the new command.
