---
"@objectstack/service-storage": minor
---

feat(storage): governed download for field-owned files — ADR-0104 D3 wave 2 (PR-4)

A file owned by a record's field (`sys_file.ref_object` / `ref_id`, set by
PR-3) is now authorized on download the same way an attachment is: the caller
must be able to READ the file's parent record, or be its uploader. Previously
only `attachments`-scope files were gated and every field file kept an
anonymous capability URL.

**Parent resolution differs by surface, and that asymmetry is the point.** An
attachment may hang off many records, so its readable-by set is the union over
its `sys_attachment` join rows. A field-owned file belongs to exactly one
record, so its readable-by set is that one record's — nothing more. Under a
shared reference model the field case would have had to union too, which is
what makes copying a file id into a more public record silently widen access.

Denials are reported as `FILE_DOWNLOAD_DENIED` (403), distinct from the
attachments path's `ATTACHMENT_DOWNLOAD_DENIED`, since the file *belongs to* one
record rather than being *attached to* several.

**`acl: 'public_read'` is the opt-out**, and now an explicit declaration rather
than the silent default every field file used to get. Genuinely public images —
anything embedded in an `<img src>`, which cannot carry a bearer token — must
declare it.

**Dual-mode safe, gates nothing that is open today.** A pre-cutover field holds
an inline blob or an external URL, never a `sys_file` id, so no existing file
has an owner recorded and none of them start being gated. The gate engages only
for files a record's field has actually claimed, and disengages again when
ownership is released.
