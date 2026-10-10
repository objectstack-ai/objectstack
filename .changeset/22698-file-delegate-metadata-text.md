---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

`fileAccessDelegate` and the refused file marker now describe what the delegate decides on a record read, beside the download

Clause-②: no

Wording only: no key, type, schema shape or runtime behaviour changes. A record read now follows the download door's field-owned verdict for a file the record owns, so the texts an author reads understated what a declared delegate decides.

- **`fileAccessDelegate`.** This covers the object schema's description and TSDoc, the object form's help text in `en`, `zh-CN`, `ja-JP` and `es-ES`, and the generated reference pages. The named service authorizes downloads of files owned by the object's media fields. It also decides whether a reader who may not read `sys_file` sees those files' name, size and type in a record read of the object. It is asked once per owning record on each such read, so an implementation runs on reads, not only on downloads. A reader who may read `sys_file` never reaches it on a record read. It fails closed on both paths.
- **`FileRefusedValueSchema` (`{ id, metadataRefused: true }`).** The TSDoc and the `metadataRefused` description now give two cases for a reader who may not read `sys_file`: the record being read does not own the file, or the download verdict on the owning record did not allow it. A file the record owns and the verdict allows is served as the full file object.

**For authors.** Nothing to change in metadata. An existing delegate now also decides a refused reader's file metadata on every read. It should keep applying the same rule its service uses to read the record.
