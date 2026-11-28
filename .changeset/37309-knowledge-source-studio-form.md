---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
---

feat(studio): create and edit a knowledge source (`knowledge_source`) in Studio — a form for the type, with field pickers scoped to the source's own object

Clause-②: yes (widening) — one new public export, `knowledgeSourceForm` from `@objectstack/spec/ai`, and `/meta/types` now serves a form for `knowledge_source`; no key is added to what a source may hold
Metadata-protocol: none

ADR-0161 K4, clause 2 (runtime authoring). A knowledge source can now be created and edited in Studio like a skill or a context pack: Studio's metadata editor lays it out with the new `knowledgeSourceForm` (`@objectstack/spec/ai`, registered in `METADATA_FORM_REGISTRY` as `knowledge_source`), and a Save goes through the metadata API, where the two save-time guards (the `manage_knowledge_sources` capability, and source admission as the author) refuse what they refuse today. The knowledge service picks the published source up with no restart, and `search_knowledge` answers from it.

- **Basics.** `name`, `label`, `description`, `aiExposed`, and `adapter` as optional free text: blank means the deployment's store (pgvector on PostgreSQL, turso otherwise, else the only store mounted).
- **Records.** The object is picked from the object catalog; `source.content` (in order) and `source.metadataFields` are field pickers over that object's fields. `source.where` is the JSON editor and takes an ObjectQL filter, for example `{"status": {"$ne": "done"}}`. `source.split` takes the strategy (`whole`, `recursive`, `markdown`), `maxChars` and `minChars`.
- **Egress and cost.** Beside `content` the form says that a build costs money: the first build sends the text of every listed field of every matching record to your embedding provider, which bills for it, and keeps it in an index; a rebuild after a change of embedding model or split sends all of it again. Beside `adapter` it says that the `memory` store re-embeds the whole source on every boot. Content fields are named one by one: there is no wildcard.
- **Refresh.** `refresh.onRecordChange`.
- No control is offered for a key the type does not carry (`embedding`, `vectorStore`, `adapterConfig`, `refresh.cron`, a `'*'` member).
- **Field pickers follow the object the form declares.** Studio's metadata editor bound its field pickers to an object found at a fixed set of item paths (`interfaceConfig.source`, `data.object`, `object`, `objectName`); it now also reads the path the type's form declares on its picker rows (`dependsOn`, under the composites the row sits in), which is how a knowledge source's pickers offer the fields of `source.object`. Types the fixed set already served are bound as before.
- **Translations.** The form's section and help strings are in the Setup bundles (`@objectstack/platform-objects`), translated for zh-CN, ja-JP and es-ES; the other locales carry the English text until they are translated, as for every metadata form.
