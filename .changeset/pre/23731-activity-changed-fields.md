---
'@objectstack/plugin-audit': minor
'@objectstack/cli': minor
---

feat(plugin-audit): `sys_activity` rows carry two writer-stamped read-rule columns, and the withheld-row rule is a predicate over them, with no SYSTEM pre-scan (ADR-0139 E6)

**Run `os migrate activity-changed-fields --apply` at once after upgrading.** After the upgrade, and until it runs, the `sys_activity` rows written before the upgrade carry no stamp and are withheld from every non-system reader: activity feeds, the header bell and record timelines show only the rows written since the upgrade. The door is `os migrate activity-changed-fields`, dry run by default, `--apply` to write, idempotent, and it stamps both columns in one run. Its flags are `os migrate audit-metadata-bodies`'s, one for one (`--database-url`, `--apply`, `--yes`, `--force`, `--json`). The columns arrive with the upgraded deployment's schema sync, which an `--apply` run performs itself; a dry run against a database no upgraded process has opened cannot read them and exits `1`.

Clause-②: yes

`sys_activity` gains two columns, stamped at write time by one derivation (`planActivityStamp`): the CRUD mirror stamps its own rows, and a `sys_activity` before-insert hook stamps every row any other writer inserts (an app's own server action, the seed loader), over whatever value that writer sent.

- `changed_fields` (`tags`) — the key set of the recorded change: for an update, every field its recorded `old` / `new` values name; `[]` for a create, a delete, a note, or an update that touched only `internal` fields. It is served narrowed to the fields the reader is served.
- `milestone_key` (`text`) — for a fired activity milestone, one sorted, comma-joined key of every field the object's `activityMilestones` declaration watched when it fired; `null` for every other row. It is never served.

The withheld-row rule is now a WHERE over those two columns, one branch per parent object, on `find`, `findOne`, `count` and `aggregate`. It reads no row, so the 2,000-row SYSTEM pre-scan and its window are gone: a broad read of the stream is served every row the caller may read, with a true `total`. What the rule withholds:

- an update row whose `changed_fields` is non-empty and names no field the reader is served (unchanged);
- a fired milestone row, unless its key equals the key of the object's CURRENT `activityMilestones` declaration and the reader is served every field that declaration watches. **The cost:** a milestone row written under an earlier declaration, or naming a since-removed field, is withheld from every non-exempt reader until retention ages it out (14 days declared; `lifecycle.retention_overrides` may lengthen it);
- an unstamped row, from every non-system reader: one at rest from before the upgrade until the backfill stamps it, and one the planner cannot judge (a milestone row naming no readable watched-field list), which stays unstamped.

The parent-field query guard covers both columns as it covers `metadata`: a reader withheld any field of the parent is refused a filter, sort, group or aggregate over `changed_fields` or `milestone_key` (`PERMISSION_DENIED` / 403).

`@objectstack/plugin-audit` exports the backfill, `backfillActivityChangedFields` (with `ACTIVITY_BACKFILL_PAGE_SIZE` and its report and engine types), and the planner, `planActivityStamp` (with `ACTIVITY_CHANGED_FIELDS_COLUMN`, `ACTIVITY_MILESTONE_KEY_COLUMN` and `ActivityStamp`). Inside the module (none of it is exported from the package), `computeWithheldUpdateFilter` keeps its name and now builds the predicate, `isWithheldOnlyUpdate` keeps its name as the update half over `changed_fields`, and `isWithheldMilestone` / `isWithheldRow` are gone with the pre-scan they judged for.
