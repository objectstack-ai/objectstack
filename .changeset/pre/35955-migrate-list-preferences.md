---
'@objectstack/cli': patch
---

feat(cli): `os migrate list-preferences` deletes the per-reader list preference rows the Console no longer reads

Clause-②: no
Metadata-protocol: none

The Console no longer reads or writes the per-reader list preference rows an earlier Console stored in `sys_user_preference` under `ui.list.<object>` (column widths, row height, view-tab order and, before that, sorts, filters and columns). The rows are not carried anywhere. This new operator command deletes them.

- `os migrate list-preferences` is a dry run by default: it counts the rows, readers and organizations, and per key the rows and readers holding it. It never prints a value and writes no row, table or file.
- `--apply` deletes, and only with `--export <path>`: every row the run deletes, as stored, is written to an owner-only file (`0600`, never overwriting one) and read back before the first delete. Each delete is the engine's by-id delete in the system context, on every organization's rows.
- After the deletes the family is read again; any row still there exits `1`. A second run finds nothing and exits `0`.
- A row belongs to the family only when its key starts with `ui.list.`, compared exactly. `ui.record.<object>` and every other preference key are untouched.
- Nothing on a boot, upgrade or migrate path runs it.

Upgrade note: once the upgraded Console is serving, run `os migrate list-preferences` once, a dry run first and then `--apply --export <path>`. Left in place the rows are unread, so it is cleanup, not a gate.
