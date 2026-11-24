---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(studio): the key-fields editor no longer previews a record-page strip

Clause-②: no
Metadata-protocol: none

The default record page draws no key-field strip, so Studio's object settings
stop drawing a "Highlight strip preview" under the `highlightFields` list. The
ordered rows stay: order still decides which fields each surface takes. The
`engine.studio.settings.highlightPreview` catalogue key leaves the studio
namespace (English and Chinese).
