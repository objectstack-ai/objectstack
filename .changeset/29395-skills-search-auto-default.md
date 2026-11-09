---
'@objectstack/skills': patch
---

docs(skills): with no `searchableFields` declared, a field marked `searchable: true` joins the default search set

Clause-②: no
Metadata-protocol: none

- **Before.** `objectstack-data`, `objectstack-query` and the `objectstack-ui` list-views rule taught the record-search auto-default as type-only: the name field plus the text-like and `select` columns. A field marked `searchable: true` was described as doing nothing, and a `$searchFields` override naming one as refused.
- **Now.** Each says what the platform resolves: with no `searchableFields` declared, the set `search` scans, and the set a `$searchFields` override may name, is the type-based default plus every field marked `searchable: true`, of any type except `secret`, `password`, `vector` or a virtual `formula`. Each also says what does not change: `searchable: false`, the default, never removes a field the type default scans, and declaring `searchableFields` chooses the set. The enum half of the type default is spelled `select` alone, as the resolver has it.
- No schema, key or behaviour changes.
