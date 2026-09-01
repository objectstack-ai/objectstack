---
"@objectstack/spec": patch
---

Drop four dead members — 'object', 'grid', 'geometry', 'encrypted' — from `SEARCH_AUTO_EXCLUDED_TYPES` (`search-fields.ts`). None of the four was ever a member of the `FieldType` enum at any commit, so none could ever match a real field's `type`: the exclusion set's live behaviour is unchanged, and the file's fail-closed tiebreak comment no longer asserts a safety property for names that cannot occur. The `[#13695]` pin in `search-fields.test.ts` is extended to hold every search type vocabulary (`SEARCHABLE_TEXTUAL_TYPES`, `SEARCHABLE_ENUM_TYPES`, `SEARCH_AUTO_EXCLUDED_TYPES`, `SEARCH_VIRTUAL_TYPES`) to `FieldType` membership, so a future ghost entry is a red test instead of a silent no-op.
