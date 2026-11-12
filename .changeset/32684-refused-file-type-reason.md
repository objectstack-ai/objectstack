---
'@object-ui/react': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

fix(react, fields): a file the field does not accept reads as the server's reason, not as a permission denial, and the file widget warns before uploading it

Clause-②: yes
Metadata-protocol: none

- **`@object-ui/react`.** `isPermissionError` lets the producer's classification decide first: a refusal that names both a client-error status other than 401 and 403 and a machine code is not a denial, whatever its sentence says. A file field's `400 ERR_FILE_CONSTRAINT` ("File type 'text/plain' is not permitted by the accept list declared for 'invoice_file' …") used to match the "not permitted" text read, so the record form and the console's form page said "You don't have permission to save this record." when the file type was the problem; both now show the server's sentence. A 403, a `PERMISSION_DENIED` or `FORBIDDEN` code, and a refusal with no code (or no status, or a 401 or 5xx) read exactly as before, so every real denial still shows the fixed localized line.
- **`@object-ui/fields`.** `FileField` and `FileCell` check a pick, a drop and a native photo pick against the field's `accept` list the way the server checks it on save (exact MIME type, `type/*` wildcard, `.ext` on the file name; an entry the file reports nothing to judge against is not a failure). A file outside the list is refused in the widget with a hint naming it and the accepted types, and is never uploaded. Before, a file chosen past the picker's own filter uploaded silently and the save was refused later, and a drop outside the list vanished without a word.
- **`@object-ui/i18n`.** New key `fields.file.typeNotAccepted` (`{{name}}`, `{{accept}}`) in every built-in pack.
