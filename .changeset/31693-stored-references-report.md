---
'@objectstack/cli': patch
'@objectstack/spec': patch
---

feat(cli): `os migrate stored-references` reports the stored references the upgrade left naming no package, and `bind` writes one reviewed row (ADR-0150 D10)

Clause-②: no
Metadata-protocol: none

The ADR-0150 D8 boot backfills bind a stored reference to a package only when the one D3 resolution rule names exactly one holder. A name two packages hold was left null with a boot warning per name, and no row id. `os migrate stored-references` now lists each such row: its D8 row, table, id, the name and every candidate by qualified address (`namespace/name`, or `_env/name` for the environment). It covers user permission-set assignments, audience-binding suggestions, managed sharing rules, queue memberships, open approval requests, paused flow runs, flow credentials, flow dispatch keys, connector connections, assignment cursors and legacy email templates. A suggestion a package wrote naming an environment-authored permission set (D3 (a)), or a name held only outside the package's declared dependencies (D3 (c)), is listed with its fix and is never bindable. The report also lists the packaged fields whose picklist the rule refuses (R17), and each name the boot's holder seal found held by two packages. A D8 table the composition does not carry is named, not skipped. The report is read-only, and `--json` prints the same bytes on every run.

`os migrate stored-references bind --table T --id ID --package P` writes the operator's chosen package into one row. It asks the rule again at write time and refuses, writing nothing, when the row is already bound, the name now resolves on its own, nothing holds it, or the package is not among the candidates now (a stale report). It never picks and has no bind-all. The write goes through the engine on a boot that composes the audit plugin, so each bind leaves one `sys_audit_log` row, and a second run writes nothing. It takes `--yes`, the SQLite occupancy check and `--force`, and `serve`'s `--preset` and `--dev`.

A new ADR-0087 semantic entry, `stored-reference-package-bind-reviewed`, tells an upgrading operator to run the report and bind the ambiguous rows after review.
