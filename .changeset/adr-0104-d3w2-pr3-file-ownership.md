---
"@objectstack/service-storage": minor
"@objectstack/spec": minor
---

feat(storage): exclusive field-reference file ownership — ADR-0104 D3 wave 2 (PR-3)

A `file`/`image`/`avatar`/`video`/`audio` field that holds a `sys_file` id now
records its owner on the file: `sys_file.ref_object` / `ref_id` / `ref_field`
name the single `(object, record, field)` slot that references it, maintained on
the engine write path — claimed on insert, reconciled on update, released when
the owning record is deleted.

**Field references are exclusive, unlike attachments.** The attachments surface
deliberately shares one file across many `sys_attachment` join rows; a field
reference is owned by at most one slot, and writing an already-owned id into a
second slot **copies the bytes into a fresh `sys_file`** rather than sharing the
row. That keeps a file's read authorisation derived from exactly one parent
record instead of the union of every referrer's — so copying a private record's
file id into a world-readable one cannot silently widen access — and it removes
reference counting from the lifecycle entirely: a file is released because its
one owner let go, never because a count came back zero.

**Deletes nothing.** This records and releases ownership; it never tombstones,
and the `scope === 'attachments'` guardrail that keeps field-referenced files
out of the reap is untouched. Collection is a separate, gated change that must
also extend the reap guard's sweep-time re-verify in the same commit.

Also exports `isFileIdToken` from `@objectstack/spec/data` as the single arbiter
of "is this stored string an opaque file id, or a legacy/external URL?", now
shared by the read resolver and the write claimer so the two cannot drift.

Dormant until a field actually holds an id token: objects without file-class
fields, inline-blob values and URL-shaped values all exit before any I/O.
