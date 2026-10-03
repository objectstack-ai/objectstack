---
'@objectstack/service-automation': patch
---

fix(service-automation): a flow's `get_record` node that reads the stored-metadata tables is served what the generic data door serves (#21519)

Clause-②: no

The two stored-metadata tables (the current metadata bodies and their version history) hold each body as stored, credential material included, and a content hash computed over it. The generic data door serves such a row with the body as its type's read projection, with the stored credential material withheld, and the hash in keyed form. A flow's `get_record` node read the same rows and served them as stored, under either run identity (`runAs: 'system'` and `runAs: 'user'`). What it read went into the run's declared output, which the flow's caller is handed back, and into any record the flow wrote from it.

**What changes.** When the node reads either table, its answer now takes the data door's form, for one row (`findOne`, no `limit`) and for a row list (`find`, `limit` above 1). The body is projected, and the content hash is keyed under the same key the data door uses. That key is the crypto provider's, read from the data engine when the node runs, or the process-scoped ephemeral key when no provider is registered. So the hash a flow is served equals the hash the data door serves for the same row. A record the flow writes from what it read can therefore carry only the projected body and the keyed hash. A `fields` projection that names the body column without the type column reads the type beside it and drops it again, as on the data door.

**What does not change.** Every other object is read exactly as before. The node's other config keys (`filter`, `limit`, `outputVariable`) and the write nodes behave as before. The node consumes the data door's own functions from `@objectstack/metadata-protocol` (`storedMetadataBodyProjection`, `redactStoredMetadataRows`, `serveStoredMetadataHashColumnRows`, `ephemeralStoredHashDigest`) and keeps no copy of them. `@objectstack/service-automation` now depends on `@objectstack/metadata-protocol`. A composition that runs flows on `ObjectQLPlugin`, as `os dev` and `os serve` do, already loaded that package.
