---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/lint': minor
---

feat(spec): a field marked `searchable: true` is searched when its object declares no `searchableFields`

Clause-②: yes (widening)
Metadata-protocol: semantic

`FieldSchema.searchable` was declared, defaulted and served, and nothing read it: `$search` skipped a field marked `searchable: true`, and a `$searchFields` override naming it was refused `400 INVALID_FIELD` "is not searchable" while the object's served schema said `searchable: true`. It is now honoured (ruling record 6573569376, letter A).

- **Before.** With no `searchableFields` declared, the search set was the type-based auto-default only: the text-like and `select` columns. A `code`, `html`, `lookup` or `json` field marked `searchable: true` was not scanned, and naming it in `$searchFields` answered 400.
- **Now.** With no `searchableFields` declared, the set is the type-based auto-default plus every field marked `searchable: true`, of any type except `secret`, `password` and `vector`, which stay excluded (a virtual `formula` field has no stored column and stays out too). The `$searchFields` ingress allow-list is the same set, so naming a marked field narrows the search to it instead of answering 400. The flag is read before the auto-default's own exclusions, so a marked `hidden` field or a marked field named like a system column joins too.
- **Unchanged.** A declared `searchableFields` is still the whole search set, and no field's own flag is read there. A field without the flag (or with `searchable: false`, the default) resolves exactly as before. A credential field is still never scanned.
- **What may now match more.** A field you already marked `searchable: true` on an object without `searchableFields` is now part of `$search`. For a `lookup` that means its stored record id, not the related record's title. Remove the flag, or declare `searchableFields` to pin the set.
- **New export.** `SEARCH_FLAG_EXCLUDED_TYPES` (`@objectstack/spec/data`) names the three hard exclusions. `SearchFieldMeta` gains the optional `searchable`.
- **Messages.** The `$searchFields` refusal for a field outside the auto-default, and the `searchable-field-unsearchable` lint verdict, now name the missing `searchable: true` and offer it as the fix, instead of calling the field's type unscannable.
