---
'@object-ui/app-shell': patch
'@object-ui/plugin-form': patch
---

fix(console): under draft preview, the New record form draws a field that exists only in the draft, disabled, and never writes it

Clause-②: no
Metadata-protocol: none

Under `?preview=draft` the console reads metadata from the draft overlay, so the New record page and the global New/Edit modal listed a field the draft adds. Its definition, though, came from the adapter's published `getObjectSchema`, which does not declare it, so the form dropped it. In draft preview both surfaces now hand the form a data source that answers the published object definition plus each field only the draft declares, with its draft definition and the marker `_draftOnly: true`; the form draws such a field disabled and does not require it (its draft `required` / `requiredWhen` are dropped from that copy, so a required draft field cannot make the save refuse), and the data source leaves it out of the record a create or update sends, so neither a value nor its declared default is written. The data door validates against the published object, and preview keeps the data plane untouched (ADR-0037 Phase 1). Outside preview the form gets the adapter itself, so the published path is unchanged and still reads each object document once. A draft list column on a draft-only field is not covered here.

`@object-ui/plugin-form`: `ObjectForm` and the shared object-schema field mapping draw a field carrying `_draftOnly: true` disabled, and a form view restating `required` over such a field does not make it required. `_draftOnly` is an underscore-private convention between the console and this package, never an authoring key; nothing new is exported.
