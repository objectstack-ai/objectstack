---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the position write-through and the row-only position backfill are deleted, and the boot reference report stops reading position rows (ADR-0131 D3, C3 stage 7b)

Clause-②: no

Stage 8 stopped registering the `sys_position` row object, the `sys_position` data-door write-through and the row-only position backfill. This change deletes the modules behind them, `position-write-through` and `position-environment-backfill`. A position is written through the metadata door alone (`PUT /api/v1/meta/position/:name`). No export of the package's entry changes.

What a deployment observes:

- **The boot reference report reads no `sys_position` row.** It still lists, per organization, every position assignment and permission-set grant whose name the security catalog does not resolve, and every grant that names no permission set. It no longer has the two position-row lines ("position(s) … have sys_position rows and no definition" and "position name(s) are carried by more than one sys_position row"). No composition provisions that table any more, so those lines could not fire. Legacy position rows are converted and reported by the upgrade ceremony (ADR-0131 D10).
- The Setup-create refusal for a position name the catalog already holds (`409 UNIQUE_VIOLATION`, raised by the deleted write-through) goes with its module. A `sys_position` data-door create cannot reach the engine any more, so nothing raised it.
