---
'@objectstack/plugin-audit': patch
---

`sys_activity.actor_name` is written: a user's create, update or delete records that user's display name on its activity row, so the record History tab names who acted instead of "Unknown user"

Clause-②: no

`sys_activity` declares `actor_name` and lists it among its highlight fields, because activity
entries are denormalized snapshots read in time order. The audit writer filled `actor_id` and never
`actor_name`, so every row carried the user's id and no name. A renderer that reads the name, such
as the record History tab, showed "Unknown user" for every entry, for every user.

The writer now records the name when it writes the row. The name is the title of the user's
`sys_user` row (its `name` column), read once per user and kept for 30 seconds. A predicate write
over many rows costs one `sys_user` read for its actor, not one per row.

- **A user write.** `actor_name` is the user's display name. `actor_id` is unchanged, and the name
  is read for that same id. This includes a write the system authorized on behalf of a credited
  user (`attributedUserId`).
- **A user whose name cannot be read** (no row, or a blank name). `actor_name` stays empty. The
  writer never puts the id in it.
- **A write with no user** (boot, migration, a scheduled job, a flow running as the system).
  `actor_name` stays empty, as before. Per ADR-0118 D1 the system actor is `null`, and the UI
  renders the "System" label for it.
- **An object with `enable.activities: false`.** No activity row is written and no name is read,
  as before.

Rows written before this change keep `actor_id` and no name. This change does not backfill them.
Nothing you author changes: no key, option, export or type is added or removed.
