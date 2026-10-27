---
'@objectstack/cli': patch
---

fix(cli): `os dev`'s in-place organization-ownership upgrade names what stopped it, and the exact command that carries on

Clause-②: no
Metadata-protocol: none

When the organization-ownership boot guard refuses a development database, `os dev` copies it and runs the ceremony on it in place. When that upgrade did not finish, it could exit with 「The upgrade did not run to a report」 and no cause.

What changes:

- The ceremony's own refusal is printed in its own words, also when the terminal forces colour (`FORCE_COLOR`): the refusal lines are read with colour stripped, and the `✗` glyph is no longer printed twice.
- An apply that stopped with no refusal of its own (an uncaught error, a crash, a signal) says how it ended and prints the end of its log, without the kernel's boot narration.
- A report file still holding the apply's reservation text, or one that does not parse, is read as "no report", with the cause, never as "a blocker (above)" with nothing above. A blocked report that names no blocker prints the log's cause too.
- A stale `organization_id` the plan gives the column-drop fate is upgraded as before, but no longer silently: before the apply runs, `os dev` prints per table how many stamped values the drop discards, and names the copy that keeps them.
- Each failed upgrade ends on the exact command that carries on: `os migrate organization-ownership --dev --database-url URL --apply --plan-file PLAN --backup-taken`, with the database and the plan the upgrade wrote.

The copy taken before the upgrade is kept, as before. A development database with a stale `organization_id` column on `sys_flow_credential` and `sys_secret` (objects that no longer declare it) is upgraded and starts under `os dev`, now pinned by a test. The production ceremony is unchanged.

What to do: nothing.
