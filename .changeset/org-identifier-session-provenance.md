---
'@objectstack/service-storage': patch
'@objectstack/plugin-audit': patch
---

Attachment access hooks: read the caller's org under the blessed `organizationId` name

`callerContext()` in the `sys_attachment` access kit built its fallback
execution envelope from `session.tenantId` — an alias removed from the
hook/action session surface in v11 (#3290). `HookContextSchema` strips a
`tenantId` key and the engine's `buildSession` only ever emits
`organizationId`, so on every call that reached the session fallback (no
execution context riding along) the envelope handed to
`ISharingService.canEdit` carried **no organization at all**. Parent-record
access for attachments was therefore evaluated without the caller's active
org on that path. It now reads `session.organizationId`, matching the
`sys_comment` kit, which already did.

The `sys_comment` kit's own `callerContext()` had the same read as a dead
first arm (`s.tenantId ?? s.organizationId`); the arm is removed. That half
is behaviour-neutral — the fallback already carried the value.

Both kits gain coverage of the session-fallback path in both directions: the
blessed name is read, and a stray removed-alias key does not become the org.
