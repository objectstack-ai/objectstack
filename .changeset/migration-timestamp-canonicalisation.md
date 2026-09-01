---
"@objectstack/metadata": patch
---

fix(metadata): `migrateSysNotificationToEvent` writes canonical ISO timestamps, not `Date.prototype.toString` (#13998)

`selectLegacyRows` reads the legacy `sys_notification` table through
`driver.raw`/`execute` — a door that does not run `formatOutput`, so none of its
repairs apply. On SQLite the legacy stamps come back as canonical ISO text and
`String(row.created_at)` is the identity. On Postgres and MySQL an instant
column materialises as a JS `Date`, so the migration wrote

```
Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)
```

into `created_at` on the new `sys_inbox_message` row and into `created_at` / `at`
on the new `sys_notification_receipt` row — whole seconds in the **migrating
host's** zone with the milliseconds dropped, or a value no dialect's timestamp
grammar accepts at all. The migration is one-way, so that spelling is what the
platform would carry afterwards.

Both stamps are now canonicalised at the migration, matching the repo's existing
correct form: a `Date` is rendered with `toISOString()`, ISO text passes through
untouched. Neither column could be repaired further upstream —  `created_at` is a
builtin audit column that `formatOutput` repairs only in its `if (this.isSqlite)`
arm, and `read_at` is a legacy column ADR-0030 removed from the object, so it is
not a declared `Field.datetime` either and no coercion could ever reach it.

Pinned with a hand-made `Date` driven through the migration's read path under a
forced process zone, which is what breaks the SQLite identity that kept the
existing cases green while the defect was live.
