---
'@objectstack/service-storage': patch
---

fix(service-storage): a file name carrying slashes no longer becomes nested directories inside the storage root

Clause-②: no
Metadata-protocol: none

The storage key of a new file is `<scope>/<fileId><.ext>`, and the extension used to be everything after the file name's last dot, separators included: `../../etc/passwd` keyed as `user/ID./etc/passwd`. Nothing left the storage root, but the layout of the root was shaped by user input, and drivers where `/` means something (local directories, S3 prefixes) materialised it.

Every key builder now takes the extension from the file name's basename (everything up to the last `/` or `\` dropped) and keeps it only when it is 1 to 16 ASCII letters or digits; otherwise the key has no extension. That covers the presigned and chunked upload doors, the server-side attach verbs, the record upload link, the copy made when a file id is reused by another field, and the legacy data-URI backfill. The client's name is still stored as the file's `name`, which is what downloads and listings show. Existing keys are not migrated: every reader reads the stored key, so only new keys change shape.
