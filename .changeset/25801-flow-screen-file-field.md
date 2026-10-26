---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@object-ui/app-shell': minor
---

feat(spec,automation,app-shell): a flow screen field typed `file` collects an upload, and the run resumes with the uploaded file's id

Clause-②: yes (narrowing)
Metadata-protocol: semantic

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped. `ScreenFieldConfigSchema.type` stays an open string, so every flow that parsed before still parses, and nothing exported is removed or narrowed. What changes is what a screen field already declared `type: 'file'` means: the console renders the upload widget for it, and the resume door refuses a value that is not a file id. The remedy is a change in what a caller posts to `resume` (the uploaded file's id), never a rewrite of a package source or a stored row, so there is nothing for `objectstack migrate meta` to rewrite. The other categories are closed on facts: the three packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no runtime interface, type or export is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

A wizard can now ask for a file before the record that will own it exists, and write everything after its last screen.

- **`@objectstack/spec`**: `ScreenFieldConfigSchema.type` (and the `ScreenFieldSpec` contract) documents `'file'` as the second value domain beside `'number'`. A `type: 'file'` field renders the platform upload widget. The upload goes through the file service and lands as a `sys_file` that no record owns yet. The resume carries that file's id, which is ADR-0104 D3's stored form, and nothing else. A later `create_record` or `update_record` node writes the id into an object's `file` field, and that write claims the file for the record. Under the default `runAs: 'user'`, the claim first makes the download door's read check as the run's user; a `runAs: 'system'` run's write is not checked, as no system write is.
- **`@objectstack/service-automation`**: the resume re-checks a `type: 'file'` field as a value domain. A value that is not a file id, judged by the spec's `isFileIdToken` (the same predicate the claim path reads), is refused with `400 INVALID_SCREEN_INPUT` and the field code `invalid_type` ("must be the id of an uploaded file"). That covers a URL, the expanded `{ id, name, url, … }` read form, a list and a number. The value is never reduced to an id. The refusal writes nothing and keeps the pause, so a corrected resume still lands. An empty optional field and a hidden field are not judged. `image`, `avatar`, `video` and `audio` stay open widget hints.
- **`@object-ui/app-shell`**: the flow screen dialog renders the object form's `FileField` for a `type: 'file'` field and uploads through the console's `UploadProvider`. While an upload is in flight, Submit is disabled and reads "Uploading…". The resume posts each file field as its bare id, and a prefilled expanded value is reduced to its id first.

**BREAKING** (a resume-acceptance narrowing) for a flow whose `screen` node already declares a field `type: 'file'`. None was found in this repository's examples or packages.

- **Before.** `type: 'file'` was an open widget hint the console did not know, so the field rendered a plain text input, and `POST /automation/:name/runs/:runId/resume` accepted any value for it.
- **Now.** The field renders the upload widget, and the resume refuses any value that is not a file id with `400 INVALID_SCREEN_INPUT` (`invalid_type`). The refusal keeps the pause.
- **Fix.** A caller that resumes the run itself, without the console, uploads the file through the file service first and posts the minted `sys_file` id for the field: FROM `{ "contract_file": "https://…/nda.pdf" }` TO `{ "contract_file": "FILE_ID" }`. A field that was never meant to collect an upload takes another `type`, such as `text`.
