---
"@objectstack/objectql": patch
---

fix(objectql): `DuplicateRecordError.developerMessage` names the wire spelling a client branches on (#14723)

The envelope's `developerMessage` — the remedy sentence addressed to the
application author — told its reader to "branch on `code === 'DUPLICATE_RECORD'`",
which is the engine's THROWN identity and holds only for an in-process caller of
`engine.insert` / `engine.update`. Every REST route reports the same refusal as
`UNIQUE_VIOLATION`, and since #14723 the per-row reports of the batch and import
surfaces do too, so the sentence was a platform contradicting itself on the one
line an author is most likely to copy. It now says both halves: over the HTTP
API branch on `code === 'UNIQUE_VIOLATION'` on every route, whole-request and
per-row alike; inside the engine the thrown class carries `DUPLICATE_RECORD`.
The class's own docblock says the same. Nothing else about the envelope moves:
`code`, `status`, `cause`, `field`, `object` and the user-facing `message` are
byte-identical, and every pin on the engine's thrown code holds.
