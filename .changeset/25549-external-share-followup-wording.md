---
'@objectstack/plugin-sharing': patch
'@objectstack/spec': patch
---

docs: the sharing-rule pass note and the `ISharingService.grant` contract say what a share on a public object does

Clause-②: no
Metadata-protocol: none

A follow-up to the external-share change. The one-line `note` a sharing-rule pass carries when it skips recipients on a public object now also covers a record whose organization could not be resolved, which admits no recipient. The `ISharingService.grant` docblock no longer says a share on a public object enforces nothing: it is admitted for an `external` member of the record's organization.
