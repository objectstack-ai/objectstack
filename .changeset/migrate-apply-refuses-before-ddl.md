---
"@objectstack/cli": minor
---

fix(cli): `os migrate apply` refuses BEFORE writing any DDL when the host config exists but could not be loaded (#13118)

#12953 ruled the exit STATUS on that path and said nothing about the mutation.
So `apply` went on flushing its deferred schema work and applying drift over the
reduced object set, and THEN exited non-zero — one run saying both "this result
is UNMEASURED, not in sync" and "…and I changed your schema on that basis".
Measured on this change's own fixture before the fix: the refused run created
**9 tables** (`sys_metadata`, `sys_metadata_activation`, `sys_metadata_audit`,
`sys_metadata_commit`, `sys_metadata_history`, `sys_migration`,
`sys_migration_journal`, `sys_secret`, `sys_view_definition`), none of them the
deployment's, and exited 1.

Maintainer ruling 2026-08-29, verbatim 「同意」, option 2: 采**选项 2**：
`os migrate apply` 在 host config 存在但不可加载时，**先拒绝、不写任何 DDL**，退出非零。
`os migrate apply` now returns above `flushSchemaDdl()` and
`applyMigrationEntries()` on that path — the two calls in the command that
write — and the refusal on stderr reuses the ruled #12953 wording and
**additionally states that no DDL was executed**, so an operator does not have
to guess whether the database was touched. Under `--json` the document carries
`message: "refused_unloadable_host_config"` with `created: []` and
`applied: []`.

**BEHAVIOUR CHANGE to a mutating command**, shipped as `minor` for the same
reason #12953's exit-status half was: the repo's launch-window convention treats
a deliberate change to a published command's observable behaviour as `minor`
rather than `patch`, and this one additionally adds a new `--json` `message`
value that a consumer can branch on.

Scoped to exactly one shape; the ruling pinned the neighbours as hard as the
changed one, and all three are measured in
`packages/cli/test/migrate-apply-refuses-before-ddl.e2e.test.ts` on both halves
— exit status *and* what the database holds afterwards:

- host config **present and unloadable** → non-zero **and zero tables created**
  (this change);
- host config **absent** → unchanged: exit 0, platform floor still created;
- host config **present and loadable** → unchanged: exit 0, the deployment's own
  tables still created.

⛔ **No flag, env var or other escape hatch.** Option 3 was refused in the same
ruling — this repo does not add a published surface before the need for it is
measured.

`os migrate plan` is untouched: it never wrote to the database, its refusal
message is byte-identical to #12953's, and the no-DDL sentence is opt-in per
call site rather than deduced from the command.

**Recoverability, measured for the ruling.** A partial apply over the reduced
set DOES converge: after repairing the config, a full `apply` on the same
database produces a schema identical to one a never-degraded database gets from
a single full run (verified with a positive control — the same comparison
detects a deliberately introduced one-column difference). So this change is
contract honesty rather than data rescue; the ruling holds either way, and the
cost is simply low.

**Migration.** A CI step that runs `os migrate apply` against a project whose
config needs environment it was not given already failed (#12953); it now also
leaves the database untouched instead of reconciling it against a fraction of
the deployment. Supply that environment to the run (the error names the missing
variable), or fix the config, then re-run.
