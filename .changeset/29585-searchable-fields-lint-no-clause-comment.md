---
'@objectstack/lint': patch
---

docs(lint): the `validateSearchableFields` module docblock says a declared search column whose type can never hold a string is admitted but contributes no clause

Clause-②: no
Metadata-protocol: none

The module docblock of `validate-searchable-fields.ts` (`@objectstack/lint`, shipped in its `.d.ts`) still said a `json` or `lookup` column on an object's own `searchableFields` is "a scan that CAN match" via `$contains`. The `$search` expansion in `@objectstack/objectql` reads it differently, and the docblock now says so:

- a declared `json` column (or any column whose declared type can never hold a string, the text-operator door's `door-refusal` verdict, `textOperatorDoorVerdict`) is admitted to the set but contributes no clause;
- a set made only of such columns answers no rows, never an error;
- a declared single-valued `lookup` column becomes an `$icontains` over the stored foreign key; a `multiple: true` one, a `$contains` membership match.

Comment-only: no rule behaviour, finding or test moves.
