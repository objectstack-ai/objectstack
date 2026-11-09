---
'@objectstack/service-datasource': patch
---

fix(service-datasource): an object drafted or imported from an external datasource table gives each field a readable label

Clause-②: no
Metadata-protocol: none

Every field of a generated object draft (`generateObjectDraft`, `importObject`, `os datasource introspect`) now carries a `label`, derived from the field's name by the same snake_case to Title Case step that already labels the object: a table with columns `part_no` and `part_name` yields fields labelled `Part No` and `Part Name`, so the record form of a synced object no longer shows raw column names. The label follows the name the field is saved under (after `rename` and the numbering of a taken name), a lookup keeps the label of the column it replaces, and the rendered `*.object.ts` source carries the same label. The object's own label is unchanged. Objects imported before this release keep their stored fields; re-import or edit the labels to change them.
