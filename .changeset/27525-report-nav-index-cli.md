---
'@objectstack/cli': minor
---

docs(cli): `os explain app` says a `report` navigation item may omit `reportName` to open the app's report index

Clause-②: yes (widening)
Metadata-protocol: added

The `navigation` row of `os explain app` now ends its `report -> reportName` target with "(omit it on a report item to open the app's report index)", the widening `@objectstack/spec` ships in this release. Only the help text changes; the command's behaviour and output shape are the same. Graded `minor` because this PR declares `Metadata-protocol: added`, which sets the floor for every package it moves.
