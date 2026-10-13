---
'@objectstack/cli': minor
'@objectstack/plugin-security': patch
'@objectstack/driver-sql': patch
'@objectstack/runtime': patch
---

feat(cli)!: `os meta resync` is deleted

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A CLI command is removed; it reconciled platform rows no reader uses for authorization, and no key of any spec schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered). -->

**BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.

`os meta resync` reconciled the platform-default `sys_permission_set` rows (`admin_full_access`, `member_default`, …) to the shipped declaration. Since the authorization resolver reads permission sets from the security catalog (ADR-0131 D3), an edited default set is served from its declaration at the next boot, and the rows the command reconciled decide nothing. The command, its `--yes` / `--json` modes and its skip-count explanation are gone; a script that calls it gets oclif's unknown-command error.

In `@objectstack/plugin-security`, `@objectstack/driver-sql` and `@objectstack/runtime`, shipped comments and one warning sentence (the permission-set backfill's re-provision list) no longer name the command. Their behaviour is unchanged.
