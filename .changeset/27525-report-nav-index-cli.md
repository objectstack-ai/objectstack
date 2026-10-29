---
'@objectstack/cli': patch
---

docs(cli): `os explain app` says a `report` navigation item may omit `reportName` to open the app's report index

Clause-②: no
Metadata-protocol: none

The `navigation` row of `os explain app` now ends its `report -> reportName` target with "(omit it on a report item to open the app's report index)", matching the widening `@objectstack/spec` ships in this release. Only the help text changes; the command's behaviour and output shape are the same.
