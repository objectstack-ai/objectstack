---
'@objectstack/platform-objects': patch
---

fix(platform-objects): drop the field form's `externalId` labels from the metadata-forms translations

Clause-②: no
Metadata-protocol: none

The field metadata form no longer offers `externalId` (the key is graded `dead`: nothing matches on it), so its label and its "Mark as external ID for upsert operations" help text are regenerated out of the `metadata-forms` bundles for every locale (`en`, `zh-CN`, `ja-JP`, `es-ES`).
