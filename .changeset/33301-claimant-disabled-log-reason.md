---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the `claimant-disabled` warning of the `renamedFrom` holder carry names the enable that carries the holders

Clause-②: no
Metadata-protocol: none

When a declared position rename is not carried because the renamed position's package is disabled, the warning said "the first boot after it is enabled carries them". Since the runtime enable route announces the package it switches on, enabling it through `PATCH /packages/:id/enable` carries the holders at once; the warning now says so, and still names the first boot after it is enabled. Only the warning's text changes.
