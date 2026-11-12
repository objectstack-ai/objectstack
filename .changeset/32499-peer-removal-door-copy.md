---
'@objectstack/metadata': patch
---

fix(metadata): a removal reaches a cluster peer's artifact-door copy too, so a removed item stops answering on every node

Clause-②: no
Metadata-protocol: none

`MetadataManager.unregister` deletes the artifact door's in-memory (`memory:`) copy of the removed item on the node that runs it. A cluster peer heard the removal on the `metadata.changed` channel and dropped only its registry entry, so its next read fell through to its own door copy and served the removed item: the node that ran the removal answered nothing, every other node answered the door's body.

Now the `deleted` event `unregister()` (and `unregisterPackage`, `bulkUnregister`) publishes carries a `removal` marker with the package the removal named, and a peer deletes its own in-memory copy by the same key before it drops its registry entry: by name, or only that package's slot for a type stored per `(package, name)`. The cluster then answers the same thing on every node.

- A peer never deletes from the shared `datasource:` store; the origin already has.
- Every other event keeps the peer's in-memory copy: a create or an update, a `deleted` event from a file or repository watcher, a removal published by a node without this change, and a `removal` whose package is not a string.
- A peer whose in-memory loader refuses the delete logs it once at `error`, naming the item and the fix (re-issue the removal on that node).
- Unchanged: a removal made with `notify: false` publishes nothing and reaches no peer. A reload or restart of the artifact still restores a door item on every node.
