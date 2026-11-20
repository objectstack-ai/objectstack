---
'@objectstack/skills': patch
---

docs(skills): the data skill says a seed record with a blank key field is refused at load, and a saved seed naming an unknown object is refused 422

Clause-②: no
Metadata-protocol: none

objectstack-data's `references/seeds.md`:

- "`externalId` selection" says every record carries a value for each `externalId` field (each field of a list, or `name` when the seed names none), and that a record leaving one blank (no value, `null` or `''`; whitespace is a value) is refused at load in every mode: the load result names the object, the record index, the field and the fix, and the other records still load. The `externalId` row of the field table points at it.
- The note under the field table says a `seed` saved at runtime names its `object` itself, and that one resolving to nothing is refused with `422 INVALID_METADATA` at `object` ("which is not defined"). The fix is the object's full name (`crm_lead`, not `lead`) or creating the object first: a draft of it is enough for a draft seed, a live seed needs it published. The `object` row points at the note.
- Three restatements in the same file were removed to pay for part of the new text: the `columns` row's shape literal, the one-row best-practices table (now a sentence) and the second telling of what a refused seed value leaves behind.

`evals/hooks-security-seeds-datasources.json` gains one case on each refusal.
