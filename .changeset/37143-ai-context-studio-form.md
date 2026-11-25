---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): author context packs (`ai_context`) in Studio — a form for the type, and a related-lists block that picks each list's columns from its own child object

Clause-②: no
Metadata-protocol: none

ADR-0160 D1, clause 2 (runtime authoring). A context pack can now be created and edited in Studio like a skill: Studio's metadata editor lays it out with the new `aiContextForm` (`@objectstack/spec/ai`, registered in `METADATA_FORM_REGISTRY` as `ai_context`), and saving goes through the metadata API, where the pack's author defects are reported at save as before.

- **Root object and its fields.** The root is picked from the object catalog; `fields` is the generic field picker scoped to that root (`field-multi`, `dependsOn: 'object'`); `body.field` is a single field picker over the root's fields.
- **Related lists.** `related` uses the `related-list-entries` block. Under a pack, whose entries are `{ object, field?, fields? }`, the block offers every reference field of a served object that points at the root (a self-reference and each of a child's several links included) and writes the pick as `{ object, field }`; each entry's columns are picked from that child object's fields. It stops adding at the schema's bounds (3 lists, 10 columns), and an emptied list or column set removes its key. A stored entry the catalog shows no link for is kept and marked; the save-time report judges it. The object form's `relatedLists` keeps its chip face unchanged: the block tells the two apart by the entry schema it is handed.
- No key is added to `AiContextSchema`, and nothing a pack may hold changes.
