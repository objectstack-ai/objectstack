---
'@objectstack/spec': minor
'@objectstack/plugin-audit': minor
'@objectstack/rest': patch
'@objectstack/cli': patch
---

feat(data): `enable.files` goes live — opt-in gate for the generic Attachments surface (#2727)

The last dead ObjectCapabilities flag gets its enforcement contract.
`enable.files` is opt-IN (spec default stays `false`): the generic record
Attachments panel is a new surface, not an existing behavior.

- plugin-audit registers a `sys_attachment` beforeInsert hook: attachment
  join rows may only target objects that explicitly declare
  `enable: { files: true }` — anything else (absent block, absent flag,
  explicit false, unknown object) rejects fail-closed with
  403 `FILES_DISABLED` (CLONE_DISABLED / FEEDS_DISABLED pattern).
- `mapDataError` maps `FILES_DISABLED` → 403 with the gated target object
  (generic data routes bypass `sendError`'s `.status` passthrough — the
  #2707 lesson, applied at introduction time).
- `Field.file` / `Field.image` are deliberately independent: they store
  the file URL in the record's own column and never create
  `sys_attachment` rows, so field-level attachments work regardless of
  this flag.
- Liveness ledger: `enable.files` dead→live, authorWarn dropped —
  ObjectCapabilities is now 100% live. The compile-time
  liveness-dead-property warning no longer fires for it; `describe()` and
  the reference docs state the real contract.

Companion objectui PR ships `RecordAttachmentsPanel` (upload/list/
download/delete over the presigned three-step storage flow), rendered on
record pages when the flag is true.
