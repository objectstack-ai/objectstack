---
'@objectstack/cli': patch
---

`os lint`: dedup actions on their real engine key, not the bare name

`naming/namespace-prefix` deduplicated every bare-named type on `name` alone.
For actions that is not the key they occupy: the engine registers an action
under `objectName:name` (`ObjectQLPlugin.actionObjectKey`, with the canonical
object-less key `global` since #3913), so a package that declares one
`log_call` per object occupies one distinct key per object and nothing shadows
anything.

The bare-name dedup therefore flagged that shape as an intra-package duplicate
and the noise grew linearly with the object count — 12 fixed warnings per run
on HotCRM (5 objects x 3 activity actions), where following the "rename one"
prescription would have broken the shared i18n keys the shape depends on.
Actions now dedup on `objectName:name`; the other six types keep bare-name
dedup and their message text verbatim.

Genuine shadowing is still reported: two actions sharing one `objectName`, two
object-less actions sharing a name, and an action on an object literally named
`global` meeting an object-less one all still warn — with a remedy calibrated
for actions, which offers separating them by `objectName` before renaming.
