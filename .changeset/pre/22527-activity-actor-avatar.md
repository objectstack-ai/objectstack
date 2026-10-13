---
'@objectstack/plugin-audit': patch
---

`sys_activity.actor_avatar_url` is written: a user's create, update or delete records that user's profile image on its activity row, so the record History tab and the activity feed show the user's avatar instead of the generic one

Clause-②: no

`sys_activity` declares `actor_avatar_url` as one of its denormalized actor columns, and the record
History tab and the record activity feed both read it as an image source. The audit writer never
filled it, so every row carried a null avatar, even for a user with a profile image.

The writer now copies the acting user's `sys_user.image` (the profile-image URL that
`POST /api/v1/auth/update-user` and the console's avatar uploader write) into `actor_avatar_url`
when it writes the row. The value is copied as stored. It comes from the same `sys_user` read that
already supplies `actor_name`, read once per user and kept for 30 seconds, so the avatar adds no
read: a predicate write over many rows still costs one `sys_user` read for its actor.

- **A user with a profile image.** `actor_avatar_url` is that image's URL.
- **A user with no profile image.** `actor_avatar_url` stays empty, as before.
- **A write with no user** (boot, migration, a scheduled job, a flow running as the system).
  `actor_avatar_url` stays empty, as before. Per ADR-0118 D1 the system actor is `null`, and how
  the system is shown is the renderer's choice.

Rows written before this change keep their empty avatar; a later change to a user's image shows on
rows written after it, as with the name.
