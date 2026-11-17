---
'@object-ui/app-shell': patch
---

fix(console): under draft preview, the New record form draws a field that exists only in the draft, and never writes it

Clause-②: no
Metadata-protocol: none

Under `?preview=draft` the console reads metadata from the draft overlay, so the New record page and the global New/Edit modal listed a field the draft adds. Its definition, though, came from the adapter's published `getObjectSchema`, which does not declare it, so the form dropped it. In draft preview both surfaces now hand the form a data source that answers the published object definition plus each field only the draft declares, with its draft definition, and that leaves those fields out of the record a create or update sends. A value typed into such a field, or its declared default, is never written: the data door validates against the published object, and preview keeps the data plane untouched (ADR-0037 Phase 1). Outside preview the form gets the adapter itself, so the published path is unchanged and still reads each object document once. A draft list column on a draft-only field is not covered here.
