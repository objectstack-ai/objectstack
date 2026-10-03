---
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': minor
---

fix(runtime): a sandboxed body or an action handler that reads the stored-metadata tables is served what the generic data door serves (#21454)

Clause-②: yes

The two stored-metadata tables (the current metadata bodies and their version history) hold each body as stored, credential material included, and a content hash computed over it. The generic data door serves such a row with the body as its type's read projection, with the stored credential material withheld, and the hash in keyed form. Three in-process reader contexts served the same rows as stored:

- a sandboxed action or hook body that reads through `ctx.api.object(...)`, inside `ctx.api.transaction(...)` too;
- an action handler that reads through `ctx.engine.find(...)`;
- an action handler that reads through `ctx.api.object(...)`.

An action body and an action handler run elevated, so the stored form reached whoever could invoke the action, a member included.

**What changes.** A read of either table through any of these contexts now answers the data door's form: the projected body, and the content hash under the same key the data door uses. That key is the crypto provider's, or the process-scoped ephemeral key when no provider is registered. `find`, `findOne` and `aggregate` are served this way, and so is every context the scoped API derives: `sudo()`, `withRunAs(...)`, a `transaction(...)` callback's context, and the context `beginTransaction()` returns. A hook body that copies what it read into another record can now copy only the projected form. A projection that names the body column without the type column reads the type beside it and drops it again, as on the data door.

**What does not change.** Every other object, every write and `count` behave as before. The platform's own readers of these tables still read the stored form, because the projection is applied at the reader contexts and not in the engine.

`@objectstack/metadata-protocol` now exports the data door's stored-row serve, so these contexts consume it and keep no copy: `storedMetadataBodyProjection`, `redactStoredMetadataRows`, `serveStoredMetadataHashColumnRows`, `ephemeralStoredHashDigest` and the `StoredHashDigest` type. The exports are additive.

The four functions `storedMetadataBodyProjection`, `redactStoredMetadataRows`, `serveStoredMetadataHashColumnRows` and `ephemeralStoredHashDigest`, and the type `StoredHashDigest`, are new public API of `@objectstack/metadata-protocol`, and `@objectstack/runtime` consumes them.
