---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a position saved active through the metadata save door carries the holders of its renamed names at once

Clause-②: no
Metadata-protocol: none

A position saved straight to active through the metadata save door (`PUT /api/v1/meta/position/:name`, the default mode, no draft) now carries the holders of the names it lists in `renamedFrom` before the door answers, as a draft save followed by the per-item publish (`POST /api/v1/meta/position/:name/publish`) already did. Before this fix the active save announced nothing, so the holder carry ran only at the next restart: until then each holder (`sys_user_position.position`) kept the old name, which no position serves any more, and lost that position's access.

The active save of a position now signals the host the way the per-item publish does (`onMetaItemPublished`), awaited, after the save's projector and mutation event. `ObjectQLPlugin` turns that into `metadata:reloaded` with `changed: ['position/NAME']`, which the carry reads. Only the node that took the save announces.

What it does not change:

- Position only. An active save of any other type announces nothing new.
- The per-item publish and `POST /packages/:id/publish-drafts` still announce once each; neither passes through the save door.
- A restore or revert that saves a position through `saveMetaItem` announces too, so it carries that position's holders at once as well.
