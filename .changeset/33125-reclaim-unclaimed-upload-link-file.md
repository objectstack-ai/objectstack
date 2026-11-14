---
'@objectstack/service-storage': patch
---

fix(service-storage): a file uploaded through an upload link that named no record, and that no record took, is now reclaimed

Clause-②: no
Metadata-protocol: none

An upload link can name an object and a file field with no record: the user uploads, and the agent then creates the record naming the file id. When the agent or the user stopped after the upload, the file stayed in storage for good, because the `sys_file` sweep only reclaims tombstoned rows and never-completed uploads. Such a file now lands `committed` with `deleted_at` set to the upload time, which puts it on the `sys_file` lifecycle's existing 30-day ttl. The write that names the file clears it. At the sweep, the `sys_file` reap guard reclaims the row and its bytes only when no record or attachment holds the file, no record ever held it, and its one-hour claim window has passed, and only on a deployment whose file-as-reference migration is verified. A file a record names is kept, and its `deleted_at` is cleared. No sweeper or setting is added. Files uploaded before this release carry no `deleted_at` and are not touched. Uploads made through the console are not touched either.
