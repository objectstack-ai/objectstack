---
"@objectstack/service-realtime": patch
"@objectstack/metadata-core": patch
---

fix(identity): close the generic-write apiMethods hole on sys_presence and sys_metadata (#3220)

Follow-through on #1591/#3213 (better-auth apiMethods reconciliation) for two
non-better-auth managed objects that shipped the same contradiction: their
`enable.apiMethods` advertised generic `create`/`update`/`delete` while their
`managedBy` bucket forbids user-context writes, leaving the generic `/data`
route open to a write the bucket does not permit.

- `sys_presence` (`managedBy: 'append-only'`) advertised `create`/`update`/`delete`
  (update/delete on an append-only object at that) but is written only over the
  realtime websocket/in-memory path, never through ObjectQL. Narrowed to
  `['get', 'list']`.
- `sys_metadata` (`managedBy: 'system'`) advertised full CRUD but customization
  overlays are authored only through the metadata-protocol RPC (engine writes
  carry a transaction context, not a user session); neither the framework nor
  the Console (objectui) POSTs `/data/sys_metadata`. Narrowed to `['get', 'list']`.

Reads stay open. The metadata-protocol / realtime write paths are engine-level
and bypass the HTTP exposure gate, so they are unaffected — verified by the
metadata-authoring dogfood and the objectql overlay tests.

A blast-radius audit confirmed the broader `system`/`append-only` buckets are NOT
safe to guard wholesale: several `system` objects (`sys_user_position`,
`sys_user_permission_set`, `sys_position_permission_set`, `sys_user_preference`,
`sys_import_job`) are legitimately user-writable by design (delegated
administration, user preferences, imports). Generalizing the engine write guard
to those buckets is intentionally NOT done here — see #3220 for the bucket-taxonomy
root cause.
