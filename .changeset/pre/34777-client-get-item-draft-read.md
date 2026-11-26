---
'@objectstack/client': patch
---

feat(client): `meta.getItem` reads a pending draft with `state: 'draft'`

Clause-②: yes (widening)
Metadata-protocol: none

`meta.getItem(type, name, { packageId, state: 'draft' })` sends `?state=draft` beside `?package=`, on the unscoped client and on the environment-scoped twin. It is the strict draft read the REST door already serves: the answer is the draft row, and its `item._diagnostics` carries the publish verdict (what publishing that draft would refuse). `'active'` is the default said out loud and sends nothing, so a call without the member is the request it always was. A caller the door does not admit to drafts is answered with the published item, so compare the answer's `version` with the draft's before reading it as the draft.
