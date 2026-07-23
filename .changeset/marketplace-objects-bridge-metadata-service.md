---
"@objectstack/objectql": patch
"@objectstack/cloud-connection": patch
---

fix(objectql): bridge late-registered manifest objects into the metadata service

Marketplace-installed template packages register through the `manifest`
service on `kernel:ready` (install) or later (HTTP install), but the one-shot
SchemaRegistry→metadata bridge runs once during `ObjectQLPlugin.start()` —
so their objects only ever reached the ObjectQL registry. Every
IMetadataService consumer (AI `describe_object`, Studio object lists,
`metadata.listObjects`) missed them; only the seed loader had grown an
engine-side fallback (#3422).

The manifest service's `register` now bridges the manifest's own objects into
the metadata service after registering them with the engine, resolving the
service at call time and mirroring the startup bridge's contract:
`register('object', name, obj, { notify: false })` (#3112), skip entries it
did not bridge itself, refresh its own copy on same-package re-install (hot
upgrade). Armed only after `start()` has run the one-shot bridge, and never
on project kernels — boot-time behavior is unchanged. `register` now returns
a promise; the marketplace install/rehydrate paths await it so metadata reads
right after an install are deterministic.
