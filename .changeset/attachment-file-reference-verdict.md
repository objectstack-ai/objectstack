---
'@objectstack/service-storage': patch
---

feat(service-storage): `sys_attachment` verifies the caller may open the file a row references

Clause-②: no
Metadata-protocol: none

An attachment links an `attachments`-scope file to a parent record, and the download door admits a caller through any parent record the file is attached to. The `sys_attachment` write gate now asks, of every insert and of every update that changes `file_id`, the same question a file-class field asks before it references a file: may this caller open the file it names?

- **One predicate, two write doors.** The check is the one the file-field door already runs (`findReferenceableFile`, bound by the storage plugin to the download door's own verdict), now shared by both doors from `referenceable-file.ts`, so a field reference and an attachment reference cannot disagree about which files a caller may take.
- **The refusal is the file-field door's.** A file the caller may not open, and an id that names no file the acting organization reaches, are answered alike: `400 VALIDATION_FAILED` with one `invalid_value` entry for `file_id` ("File cannot reference this file: it is not a file you can open. Choose a file you can open, or upload it again."). Nothing is written.
- **What keeps working.** Attaching a file you uploaded, or one you can already open through another record, is admitted as before, as is `attachFileAs`, which attaches the caller's own fresh upload. System-context and context-less writes (seeds, engine self-writes, lifecycle sweeps) are not judged. The parent and row rules still answer first, so a caller they refuse keeps their refusal. A kernel that composes no download gate serves every file, and so every file may be referenced there.
