---
'@object-ui/data-objectstack': patch
'@object-ui/plugin-designer': patch
'@object-ui/app-shell': patch
---

fix(plugin-designer): the fields page and the objects page save an object as its author wrote it, not as the console is served it

Clause-②: yes
Metadata-protocol: none

`MetadataFieldsPage` took its edit base from the item read and `MetadataObjectsPage` from the list read. The server translates both for the console's `Accept-Language` and fills both with the platform's injected columns (`owner_id` and the rest), and both pages spread that served object back as the save body. In a Chinese console one field relabel or one description edit therefore stored every other label of the object in Chinese, and the injected columns as authored fields. Both pages now build the save body on the object as authored, `overlay ?? code` from the layered read (`GET /meta/object/:name/layers`, served untranslated). The fields page shows and edits the authored fields. The objects page keeps showing the listed object as served and writes back only the keys the edit changed. When the layered read holds neither layer, the fields page says the object was not found and the objects page saves nothing and says why.

`@object-ui/data-objectstack` now exports the reading itself, `authoredBuffer`, `authoredPublished` and `editsAuthoredLayers` with the `AuthoredBuffer` and `AuthoredLayers` types, beside `MetadataClient.layered`. `@object-ui/app-shell` re-exports them from its `authoredObjectBuffer.ts` with no change in behaviour, so its editors and plugin-designer's pages share one copy.
