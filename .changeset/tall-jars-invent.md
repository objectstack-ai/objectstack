---
'@objectstack/metadata-protocol': patch
---

Global search (`GET /api/v1/search`) now resolves searchable fields the same way `$search` does, so the ⌘K palette recalls what the list quick-search recalls (#7643)

`searchAll` built its own filter instead of going through the engine's ADR-0061 `$search` expansion, which made the palette's recall a strict subset of the executor's. It now hands the engine `search: <query>` per object and lets one expansion resolve the fields and compile the clause.

What a caller observes changing on `GET /api/v1/search` — both are widenings; no query that returned a hit before returns fewer:

- **Pinyin/initials recall now works on this endpoint.** Where the deployment provisions the hidden `__search` companion column (`OS_SEARCH_PINYIN_ENABLED`), latin terms are OR-ed against it, so `hnkj` and `huaningkeji` now return the CJK-named record that `POST /api/v1/data/:object/query {"search":"hnkj"}` already returned. Previously: 0 hits.
- **Which columns are scanned now follows the object, not a field flag.** Resolution is the object's declared `searchableFields`, else the auto-default (display/name field plus short-text and enum fields) — the set `searchableFields` documents itself as governing. The endpoint previously scanned only text-typed fields carrying the field-level `searchable: true` flag, falling back to the title field alone, so most objects were searched on one column. Hits from a second column (an email, a description, a select's label) are new.
- Enum (`select`/`status`) columns are now matched by option LABEL, and virtual `formula` fields are excluded, both as on the executor path.

Unchanged: which objects are swept and their opt-outs (`enable.searchable`, `enable.apiEnabled`, the `sys_*` skips), the per-object and overall caps, ordering, RLS/RBAC enforcement, and the response shape. The `$search` executor path itself is untouched. A record matched only through the pinyin companion has no `snippet` — no source column contains the typed term.

Also corrects the stale case declaration on this path (#7850): the doc comment said "case-insensitive LIKE" while the sentence below it named `$contains`, which #4706 Q2 = A defines as case-**sensitive**. Matching folds case via `$icontains`; behaviour is unchanged by that edit.
