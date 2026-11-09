---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): Studio's publish review sheet says a customization lives in this environment's database and moves only by `os package export` (#30119)

Clause-②: yes (widening) — new `@object-ui/i18n` key `preview.changes.customizationEnvironment` in every pack; `preview/savedToCustomization` gains `customizationEnvironmentText` and `PACKAGE_EXPORT_COMMAND`
Metadata-protocol: none

Reviewing a read-only package's customizations, the sheet adds one line under "Saved to BASE's customizations": the changes are kept in this environment's database as items of the `.custom` package it names (the id the server answered for the base), not in the project's source, and they reach another environment only through `os package export`.
