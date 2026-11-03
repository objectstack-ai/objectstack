---
'@object-ui/mobile': patch
'@object-ui/fields': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): photos, attachments and record sharing go through the mobile shell's `pickImage()`, `openFile()` and `share()`

Clause-②: yes
Metadata-protocol: none

The ObjectStack mobile shell offers three optional bridge methods for files, each feature-detected with `has()`. The Console now calls them, and a plain browser or an older shell behaves exactly as before.

- `@object-ui/mobile`: `ObjectStackNative` gains the optional `pickImage?`, `openFile?` and `share?` members, with the typed wrappers `nativePickImage`, `nativeOpenFile` and `nativeShare` (they resolve `unavailable | ok | failed` and never throw), the types `NativePickImageOptions`, `NativeFile` and `NativeShareContent`, the bridge limit `NATIVE_FILE_MAX_BYTES` (8 MiB), and two helpers: `fileFromNativeFile` (a bridge file to an uploadable `File`) and `nativeFileFromBlob` (bytes to a bridge file).
- File and image fields: in a shell with `pickImage`, "Take photo" and "Choose photo" use the shell's camera and photo library. The picked image goes through the field's existing upload pipeline, so the size check and the stored `sys_file` reference are the same as for an `<input type=file>` pick. A cancel uploads nothing; a shell failure shows an error toast. New strings: `fields.file.choosePhoto` and `fields.file.photoFailed`.
- Record attachments: in a shell with `openFile`, tapping an attachment fetches its bytes with the Console's own session and hands the bytes to the shell. A file over 8 MiB, a failed fetch, or a refusal from the shell keeps the browser behaviour. The signed download URL never crosses the bridge.
- Record page Share: in a shell with `share`, it opens the OS share sheet with the record's page link and title. A refusal from the shell keeps today's `navigator.share` or clipboard copy.
