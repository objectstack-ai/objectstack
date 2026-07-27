---
"@objectstack/spec": minor
"@objectstack/service-storage": minor
---

feat(spec)!: media fields declare accept/maxSize, and the stored form is a file reference — ADR-0104 D3 wave 2 (PR-5a)

**`accept` and `maxSize` are now declared on `FieldSchema`, and enforced on the
server.** Both were already read by the upload widgets — `field.accept`,
`field.maxSize` — while the spec did not declare them, so an author who wrote
them had the keys silently stripped at parse and the constraint simply never
existed. That is exactly the ADR-0104 failure class (a declaration accepted in
source, dropped from the contract, with no feedback).

Now that the platform owns the file, `sys_file` carries the authoritative MIME
type and byte size, so a record write is re-checked against the declaration
where it actually binds rather than only in the browser — a client-side check is
a convenience, not a control, since any caller talking to the API directly
bypasses it. Violations raise `FileConstraintError` and fail the write. An entry
is only judged against metadata the file actually reports: a file with no
recorded MIME type cannot fail an `accept` test, and one with no recorded size
cannot fail `maxSize` — "we don't know" must not become "not permitted".

**The stored form of a media field narrows to an opaque `sys_file` id.**
`valueSchemaFor(field, 'stored')` now yields an id for `file`/`image`/`avatar`/
`video`/`audio`; the inline `{url, name, size, …}` blob becomes the `'expanded'`
read form, which also still admits an unresolved id (storage service absent,
file not committed) exactly as an unexpanded lookup id stays valid.

Two legacy forms therefore stop conforming, both deliberately:

- the **inline blob**, which is no longer stored but derived;
- an **external URL**, which was never a managed file — ADR-0104 R7 retires it
  toward an explicit `url` field, and under AI authoring that is the point: it
  stops "managed file" and "external link" being the same declaration.

**Not a breaking change today.** Value-shape checking is warn-first
(ADR-0104 R1/R2): a not-yet-backfilled row still writes and the author gets a
warning naming the field. Hard rejection arrives only when a deployment opts
into `OS_DATA_VALUE_SHAPE_STRICT_ENABLED` — which it should do after running the
backfill and confirming reconciliation. The `!` marks the contract change for
the v17 window, not a runtime break on upgrade.
