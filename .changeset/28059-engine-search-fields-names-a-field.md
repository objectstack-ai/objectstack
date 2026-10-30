---
'@objectstack/spec': patch
---

fix(spec)!: `EngineQueryOptionsSchema.searchFields` and its aggregate and count siblings refuse an empty list, as `FullTextSearchSchema.fields` does (#28059)

Clause-②: no (narrowing) — the engine-side declarations of the search-field override refuse `searchFields: []`, which they admitted before. Nothing is widened and no key is added, removed or renamed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata type or stored shape moves: these are in-process engine option declarations no metadata type embeds, never stored, and the value they stop admitting is the one the Data API doors and the shared FullTextSearchSchema.fields already refuse. A caller names at least one field or leaves the key out; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing of published engine option declarations (`@objectstack/spec/data`), read by codegen, the reference docs and any caller that parses an engine option bag with them.

- **Before.** `EngineQueryOptionsSchema.searchFields`, `EngineAggregateOptionsSchema.searchFields` and `EngineCountOptionsSchema.searchFields` admitted `[]`, while the structured `search.fields` on the same schemas (it reuses `FullTextSearchSchema`) refused it. One schema said two things about one value.
- **Now.** All three take the shared search-field array arm: a list must hold at least one name, refused with the same sentence (`Name at least one field, or leave the key out to search the default search fields`) at `searchFields`. A list with a blank member is still admitted, as the Data API doors admit it and then refuse the blank name as an unknown field.
- **Unchanged.** The Data API doors already refused an empty override, and in the same release the in-process engine refuses it too (#27732): `engine.find` / `findOne` / `count` / `aggregate` called directly with `searchFields: []` or `search.fields: []` answer `400 VALIDATION_ERROR` with the same sentence. The engine does not parse its options with these schemas, so the declarations now state the refusal it enforces. The TypeScript types are unchanged (`string[] | undefined`).
- **Who sees it.** Code that parses an engine option bag with one of these schemas and sent `searchFields: []`, or a generated client that trusted the wider declaration.

**Supersedes, in the same release.** Two earlier entries no longer hold for these declarations: the `#27683` entry's "Unchanged" bullet saying the engine-side declarations still admit `[]`, and the `#27484` entry's "Not yet narrowed" bullet, whose remaining member `EngineQueryOptionsSchema.searchFields` (with its aggregate and count siblings) refuses `[]` now. A string `''` was never part of these array declarations; it is the transport spelling `$searchFields`, narrowed by `#27683`.

**The remedy.** Name at least one field in `searchFields`, or leave it out to search the object's default search fields.
