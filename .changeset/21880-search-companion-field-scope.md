---
'@objectstack/objectql': patch
---

A field-narrowed `$search` no longer matches through the pinyin search companion of a field outside the search-field set (#21880).

Clause-②: no

- **What changed.** When the optional pinyin search companion is on (`OS_SEARCH_PINYIN_ENABLED`), the engine's search expansion (`expandSearchToFilter`) adds the companion clause only when every field the companion mirrors is inside the effective search-field set: the set `resolveSearchFields` computes, after any `$searchFields` narrowing. The mirrored fields are read from `resolveSearchCompanionSources`, the same function the companion is provisioned and filled from.
- **What stays the same.** A search with no narrowing keeps the clause whenever the display/name field is in the object's searchable set, so pinyin recall there is unchanged. A CJK term still skips the clause. Deployments with the companion off see no change.
- **Who notices.** A search narrowed to fields that leave out the display/name field, by a `$searchFields` override, by the narrowing global search applies to the fields a caller may query, or by a declared `searchableFields` that omits it, no longer matches through that field's pinyin form.
