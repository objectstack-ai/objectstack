---
"@objectstack/metadata-protocol": minor
---

`publishPackageDrafts` (Studio's "publish whole app", `POST /packages/:id/publish-drafts`) now reports the #4463 runtime authoring gate's non-blocking findings on each `published[]` element as an optional `advisories` key — the same element shape and omitted-when-empty discipline as the single-item publish door (#9176). An advisory-free batch's response bytes are unchanged, and `failed[]` elements are unaffected (an `error` finding still aborts the batch). Previously the batch door computed these per-draft findings and discarded them.
