---
'@object-ui/plugin-list': patch
---

fix(plugin-list): a list view whose `sharing` sets `lockedBy` and no `type` shows its lock indicator

Clause-②: no
Metadata-protocol: none

The list toolbar drew its read-only sharing indicator only when the view declared `sharing.type`. `ViewSharingSchema` defaults `type` to `collaborative`, and the served view carries the authored body without that default, so a view authored as `sharing: { lockedBy: 'admin@objectos.ai' }` showed no lock: other readers did not learn the view was locked.

- **Now.** The indicator draws when `sharing` declares a `type` or a `lockedBy`; the lock keys on `lockedBy` alone. An absent `type` shows the spec's default type label ("Shared view"), read from `ViewSharingSchema` rather than restated in the renderer.
- **Unchanged.** A view with `type` set renders as before, a `sharing` block with neither key shows nothing, and no key, value or copy changes.
