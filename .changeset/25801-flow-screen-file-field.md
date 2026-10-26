---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@object-ui/app-shell': minor
---

feat(spec,automation,app-shell): a flow screen field typed `file` collects an upload, and the run resumes with the uploaded file's id

Clause-②: yes
Metadata-protocol: added

A wizard can now ask for a file before the record that will own it exists, and write everything after its last screen.

- **`@objectstack/spec`**: `ScreenFieldConfigSchema.type` (and the `ScreenFieldSpec` contract) documents `'file'` as the second value domain beside `'number'`. A `type: 'file'` field renders the platform upload widget. The upload goes through the file service and lands as a `sys_file` that no record owns yet. The resume carries that file's id, which is ADR-0104 D3's stored form, and nothing else. A later `create_record` or `update_record` node writes the id into an object's `file` field, and that write claims the file for the record. Under the default `runAs: 'user'`, the claim first makes the download door's read check as the run's user; a `runAs: 'system'` run's write is not checked, as no system write is.
- **`@objectstack/service-automation`**: the resume re-checks a `type: 'file'` field as a value domain. A value that is not a file id, judged by the spec's `isFileIdToken` (the same predicate the claim path reads), is refused with `400 INVALID_SCREEN_INPUT` and the field code `invalid_type` ("must be the id of an uploaded file"). That covers a URL, the expanded `{ id, name, url, … }` read form, a list and a number. The value is never reduced to an id. The refusal writes nothing and keeps the pause, so a corrected resume still lands. An empty optional field and a hidden field are not judged. `image`, `avatar`, `video` and `audio` stay open widget hints.
- **`@object-ui/app-shell`**: the flow screen dialog renders the object form's `FileField` for a `type: 'file'` field and uploads through the console's `UploadProvider`. While an upload is in flight, Submit is disabled and reads "Uploading…". The resume posts each file field as its bare id, and a prefilled expanded value is reduced to its id first.

What to do: nothing for an existing flow. A screen that declared `type: 'file'` used to get a plain text input and accepted any resume value. It now gets the upload widget, and its resume admits a file id only.
