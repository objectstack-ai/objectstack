---
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

Render `saveMetaItem`'s `422 INVALID_METADATA` findings clause per write face

The spec-validation refusal restated its own findings in the message
(`<path>: <message>` for the first three, plus a `(+N more)` tail) while
attaching the same array as `issues`. On the HTTP 422 both channels ride one
response, so every console rendering both showed each finding twice.

The clause is now rendered per face. The `/meta` HTTP write doors — REST's
`PUT /meta/:type/:name` and `PUT /meta/:type/:a/:b`, and the runtime
dispatcher's `PUT /meta` — declare that they carry the findings structurally
and get a one-sentence headline instead: the issue count plus up to three
`path [zod code]` locators, the same grammar the seed refusal and the
author-time gate already compose. `issues[]` is attached unchanged on every
face, so nothing is withheld from anyone.

Faces that carry no structured channel keep the full prose, byte for byte —
`duplicatePackage`'s `failed[].error`, `migrateStoredMetadata`'s
`rows[].reason`, and the two out-of-package log faces, where this sentence is
the sole carrier of the author's prescription. Silence means "keep the prose":
a write door only ever drops the restatement by declaring itself, never by
omission.
