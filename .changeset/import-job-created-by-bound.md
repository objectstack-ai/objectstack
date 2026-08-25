---
'@objectstack/platform-objects': minor
---

Declare a sourced `maxLength` on `sys_import_job.created_by`, so its declared
index can exist on MySQL — route A's last column

`driver-sql` (since #11430) honours a keyed text-family field's declared
`maxLength`, emitting `varchar(maxLength)` instead of `TEXT`, and #11699
declared bounds on thirteen keyed identity columns. `sys_import_job.created_by`
is keyed by `(created_by, created_at)` and declared no bound at all, so on MySQL
that index was refused (`ER_BLOB_KEY_WITHOUT_LENGTH`: a TEXT/BLOB column cannot
be a key without a prefix length) and the object landed registered-but-broken.
It was the only remaining such object outside the >768-character class that
#11627 tracks.

The bound is **255**, derived by referenced-column transitivity rather than
chosen: the column holds a `sys_user.id` stamped by the rest-server import route
from `context.userId`, and `driver-sql` creates every table's primary key as
`table.string('id').primary()` — knex's `varchar(255)` — so no id this column
can receive exceeds 255. It agrees with what the column would get if declared
like its siblings (`Field.lookup('sys_user')` emits
`DEFAULT_STRING_VARCHAR_CHARS` = 255) and with the landed declarations for the
same value class (`sys_metadata_audit.actor`, `sys_metadata_commit.actor`,
`sys_view_definition.owner`, all 255). A minted platform id is 26 characters, so
the bound clears the floor with 229 characters of headroom.

This is behaviour-narrowing on a published object: on a strict MySQL server a
`created_by` longer than 255 is now **refused** (`ER_DATA_TOO_LONG`, 0 rows)
rather than stored, where previously the column was unbounded `TEXT`. No value
the producing contract can emit is affected, because the id it copies is itself
capped at 255 by its own column.

The route-A pin moves from `identity/identity-keyed-text-bounds.test.ts` to
`platform-keyed-text-bounds.test.ts` and now enumerates **every** platform
object the package exports, not just `identity/`. That directory scoping is
exactly how this column escaped the first pass — the pin could not see it — and
a new control asserts the enumeration reaches columns in `audit/`, `metadata/`
and `system/` so the narrowing cannot silently return.
