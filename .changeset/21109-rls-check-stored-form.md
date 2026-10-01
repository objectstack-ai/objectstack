---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a row-level `check` judges a `date`, `datetime` or `time` column as the row will be stored, so the write and the read the same policy scopes give one answer for one row (#21109)

Clause-②: no

The write check evaluates the compiled `check` filter in-process against the write's post-image. That image held each value as the caller or a hook wrote it, while the read compares the value the driver stored, in its column's storage form, against a comparand put into the same form. On a temporal column the two forms differ, so one row could get two answers. Measured through `ObjectQL.insert` with `SecurityPlugin` on SQLite, as a member resolving a permission set, with the same predicate as `using` and `check`:

| `check` | written | write, before | stored | read |
|---|---|---|---|---|
| `record.due_on == '2026-01-05'` | `'2026-01-05T15:00:00Z'`, or a `Date` on that day | 403 | `2026-01-05` | shown |
| `record.start_time == '09:00'` | `'09:00:00'` | 403 | `09:00:00` | shown |
| `record.due_at == '2026-01-05T10:00:00Z'` | `'2026-01-05T18:00:00+08:00'` | 403 | `2026-01-05T10:00:00.000Z` | shown |
| `record.due_on > '2026-01-05'` | `'2026-01-05T15:00:00Z'` | admitted | `2026-01-05` | hidden |

Now, before the check is judged, every column the object declares `date`, `datetime` or `time` is put into `@objectstack/core`'s `temporalStorageForm`, the rule the drivers write and compare those columns by. That applies to the post-image's value and to the check's value comparands on the column (`$eq`, `$ne`, the orderings, `$in`, `$nin`, `$between`). The first three rows above are now admitted. The last is now refused, which is the read/write agreement this change buys: the read never showed that row, so a write that stores a day the predicate excludes is no longer admitted on the strength of the time of day it was sent with. Every insert, by-id update and predicate update takes the same step.

Unchanged: a column the object does not declare temporal is judged as written, whatever its value looks like; an object whose schema cannot be loaded is judged as before; a value the storage rule cannot read is judged as written; and refusals keep their code and status (`PERMISSION_DENIED` / 403).
