---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the security plugin's metadata-derived caches now invalidate on a runtime metadata publish

Clause-②: no
Metadata-protocol: none

The security plugin keeps the per-object inputs it derives from metadata for reuse across requests. Those caches are now dropped whenever metadata changes at runtime, so the next request is judged by the published declaration without a restart (#26596, #26698):

- **The signal.** The plugin listens to the protocol's post-persistence `onMetadataMutation` notification, which every metadata authoring door emits (save, per-item and package publish, revert, rollback, delete) after the engine registry holds the new definition, and which a cluster peer replays after converging its own registry. Drafts are ignored. It also listens to the `metadata:reloaded` announcement that an artifact reload fires.
- **What it replaces.** The previous subscription probed an optional `watch` member on the metadata service, which `MetadataManager` does not implement, and the runtime authoring path does not announce to the metadata service's watchers in any case.
- **Composition note.** A protocol service that offers no `onMetadataMutation` is reported once at `warn` when the plugin starts.
