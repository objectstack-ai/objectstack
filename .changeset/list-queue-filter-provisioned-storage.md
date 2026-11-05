---
'@object-ui/plugin-list': patch
---

fix(plugin-list): the list's 在队列中 ("In a queue") filter is no longer offered on an external (federated) object

Clause-②: no
Metadata-protocol: none

An ADR-0015 `external` object is served with the platform's injected `queue` column like any `ownership: 'user'` object, but the remote database owns its schema, so the column has no storage behind it and no row of that table can ever sit in a queue. `objectHasOwnershipQueue` now also requires `platformProvisionsStorage(objectDef)` from `@objectstack/spec/data`, so the toggle appears only on objects whose storage the platform provisions. Ordinary `ownership: 'user'` objects are unchanged.
