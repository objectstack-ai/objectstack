---
'@objectstack/metadata': patch
---

Artifact/HMR loader: read a view container's own top-level `object` field

`MetadataPlugin`'s artifact/HMR registrar derived which object a `defineView`
container binds to by walking `list.data.object` then `form.data.object`, and
never consulted the container's own top-level `object` — the field
`ViewSchema.object` documents as "how a stack-level `views: [...]` entry says
which object its views belong to; read by `getViewsByObject()` /
`GET /meta/view?object=`".

A package-shipped `defineView({ object: 'crm_lead', list: { columns: [...] } })`
therefore registered nothing at all through this path: the container was dropped
before registration, so no expanded `crm_lead.<key>` ViewItems were produced and
`getViewsByObject('crm_lead')` / `GET /meta/view?object=crm_lead` answered empty
for it. Both derivation sites now call the package's single spelling of that
derivation (`deriveViewContainerObject`), which consults the container's own
`object` first and keeps the existing `list.data.object` → `form.data.object` →
row-name fallback unchanged for every container written before that field was
read here. This is the same order #13407 settled at the runtime door.
