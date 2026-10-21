---
'@objectstack/objectql': patch
---

fix(objectql): a unique refusal's user-facing sentence names the object and the field by label

Clause-②: no (text only: the user-facing sentence names the object and field by label, and `developerMessage` opens with the API names; no code, status, outcome or export moves)

`DuplicateRecordError.message` is the sentence every door keeps as thrown, so a record save and a screen flow refused by a unique constraint show it to the end user word for word. It named the object, and the field when the driver reported one, by API name: `Duplicate record refused on 'crm_account': …`.

- **The sentence now uses the declared `label`.** The engine looks up the object's and the field's labels in its registry on every write door that raises the refusal: insert (single and batch), and update by id and by predicate. Example: `Duplicate record refused on 'Account': a unique constraint on 'Account Name' already holds this value. No record was written.` Where no label is declared, the sentence uses the API name, exactly as before. The opening words and `No record was written.` are unchanged.
- **The API names stay available for diagnostics.** They are still on `object` and `field`, and `developerMessage` now opens with them: `Duplicate record refused on object 'crm_account', field 'name'. …`.
- **Unchanged:** the code (`DUPLICATE_RECORD` in the engine, `UNIQUE_VIOLATION` on every wire route), the 409 status and the outcome. `DuplicateRecordError`'s constructor takes an optional fourth argument with the labels. Callers that pass three arguments get the API-name sentence.
- **For HTTP clients:** on the REST data routes the curated `error` text is unchanged. The wire `developerMessage` (which carries the engine's sentence) now names the labels, and the body's `object` and `field` keys still carry the API names.
