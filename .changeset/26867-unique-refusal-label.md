---
'@objectstack/types': patch
'@objectstack/objectql': patch
'@objectstack/core': patch
---

fix(types): a unique refusal tells the user which field by its label, never by its API key

Clause-②: no
Metadata-protocol: none

A create or update refused by a single-column unique index answered `409 UNIQUE_VIOLATION` with a user-facing `error` that named the field by its API key ("A record with this gsku already exists"), while `developerMessage` named it by its label. The split was inverted: the developer read the label and the end user read `gsku`.

- **The user-facing `error` names the field by its label.** For a field labelled `Global SKU`, the body now reads `"error": "A record with this Global SKU already exists"`. `field` still carries the API key (`gsku`) for programs, and `code`, the status and `developerMessage` are unchanged.
- **In the writer's locale.** The label is read the same way the record validator and the `DELETE_RESTRICTED` refusal read theirs: the translation bundle for the request's locale, then the declared `label`. That one label feeds both the user-facing sentence and the engine's own `message` (the `developerMessage` on the wire). A request in `zh-CN` against a translated object reads its labels in `zh-CN` in both. The sentence around the label stays English.
- **No label, no name.** When the field declares no label and the bundle holds none, the sentence is the generic `"A record with this value already exists"`, and `field` still names the key. The same applies to a raw driver unique error that no engine write door wrapped, since it carries no schema to read a label from, and to `sanitizeRowError` (`@objectstack/core`), the import runner's text cleaner. The composite-index answer is unchanged.
- **`DuplicateRecordError` gains `fieldLabel`** (`@objectstack/objectql`): the conflicting field's display name in the writer's locale, set only when the field has one. `envelopeUniqueViolation` takes the write's message context as an optional fourth argument, and every engine write door passes it.

If a client matched the old sentence text to find the field, read `field` instead. It has carried the API key on this body all along.
