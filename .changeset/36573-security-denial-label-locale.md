---
'@objectstack/plugin-security': patch
---

Clause-②: no
Metadata-protocol: none

A security refusal's `userMessage` (the master-detail write gate and the field-write gate) now negotiates the label locale against the locales the i18n service holds before it translates the object or field label, the way objectql's refusals and the metadata route do. A request in a regional tag such as `en-US`, in a deployment authored in `en` that defaults to another language, now names the master object by its authored label (`Contract`) instead of the default language's row.
