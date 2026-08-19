---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
---

Declare `MetadataProtocol.getMetaItemLayered` — the layered three-way diagnostic read (`GET /api/v1/meta/:type/:name/layers`) now appears on the protocol interface, typed against the already-declared `GetMetaItemLayeredRequestSchema` / `GetMetaItemLayeredResponseSchema`, so callers no longer reach the verb through `any`. Declared optional like its `getMetaItemCached` / `deleteMetaItem` siblings: a declared-surface catch-up to a shipped verb, not a new capability.

In `@objectstack/metadata-protocol`, the implementation's inline return-type annotation for `getMetaItemLayered` drops its dead `'overlay'` arm on `lockSource` and annotates with `MetadataLockSource` directly — the only producer feeding that field on the layered read path is `resolveLockState`, whose return is already typed `MetadataLockSource | undefined` (`'artifact' | 'package' | 'env-forced'`); the `'overlay'` literal in the file belongs to `getEffectiveLock`, a write/delete-door helper that never feeds this response. Type-level change only; no runtime behaviour or wire vocabulary changes.
