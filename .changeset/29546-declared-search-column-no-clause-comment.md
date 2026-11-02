---
'@objectstack/spec': patch
---

docs(spec): the `resolveSearchFieldResolution` docblock says a declared search column whose type can never hold a string is admitted to the set but contributes no clause

Clause-②: no
Metadata-protocol: none

The declared-branch text on `resolveSearchFieldResolution` (`@objectstack/spec`, shipped in its `.d.ts`) still said a `json` column declared in `searchableFields` is "a scan that CAN match". The `$search` expansion in `@objectstack/objectql` gives such a column no clause: its declared type can never hold a string, which is the text-operator door's `door-refusal` verdict (`textOperatorDoorVerdict`). The docblock now says so:

- a declared `json` column (or any numeric, boolean, date or time, or structured-JSON column) is still admitted to the set, but contributes no clause;
- a set made only of such columns answers no rows, never an error;
- a declared single-valued `lookup` column still matches by substring over the stored foreign key;
- only an entry that names no column at all is dropped, as before.

Comment-only: no behaviour, schema or accepted value moves.
