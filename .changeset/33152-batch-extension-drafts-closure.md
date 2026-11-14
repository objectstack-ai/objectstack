---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a package publish judges each draft with the batch's own extension drafts folded onto their targets

Clause-②: no — this removes a false refusal the published contract already denies: the `@objectstack/metadata-protocol` changelog entry 0c24898 states "a package publishes as a self-consistent unit — `publishPackageDrafts` judges each draft against the batch's own pending declarations", and the batch's `object_extension` drafts were the pending declarations left out. No exported type or signature changes.
Metadata-protocol: none — no key, value or metadata type changes; `os build` already accepts these packages, and the batch door now gives the same verdict.

`publishPackageDrafts` (and the draft read's publish verdict, which uses the same collection) now carries the package's `object_extension` drafts in the batch's pending set, and the runtime authoring gate adds each draft's `fields` to its target in the object universe, the way the registry serves a published extension. Before, a draft whose formula or lookup hop read a field that a sibling extension draft adds (for example `{ extend: 'crm_region', fields: { tier__c } }` beside a formula `record.region.tier__c`) was refused with `INVALID_METADATA` (`unknown field tier__c on crm_region`), and the whole batch rolled back. The workaround was to publish the extension first through the per-item door; it is no longer needed.

A hop into a field that neither the batch nor the live object has is still refused, and the batch still rolls back.
