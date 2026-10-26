---
'@object-ui/app-shell': patch
---

fix(app-shell): readable option labels for unlabeled datasource enum selects (objectui#13353)

Setup → Datasources: a driver-config JSON Schema `enum` select showed each raw value (`off`, `safe`) as its option text. The driver-config schema declares no per-option label, so each option's text is now built from its raw value with Studio's `humanizeKey`, the helper `SchemaForm`'s enum selects already use (`off` → "Off", `read_only` → "Read Only", `fullSync` → "Full Sync"). The value the form saves stays the raw enum member.

Clause-②: no
Metadata-protocol: none
