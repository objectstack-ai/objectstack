---
'@object-ui/plugin-designer': patch
---

fix(plugin-designer): the Field Designer drawer no longer offers an External ID switch, and keeps a stored `externalId`

Clause-②: no
Metadata-protocol: none

`field.externalId` is graded `dead`: no upsert, import or seed matches on it, so the drawer's Advanced section stops offering it. The key is not retired, so a stored value must survive: the drawer's update path used to write `externalId: data.externalId === true`, and now leaves the key to the field's own spread, so a field carrying `externalId: true` keeps it through an edit-and-save on the Metadata Fields page. A newly created field no longer carries `externalId: false`. The `appDesigner.fieldDesigner.externalId` fallback string is removed.
