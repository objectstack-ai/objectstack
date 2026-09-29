---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `security/explain` answers with enforcement's refusal for a row-level policy that compares two fields of no shared comparison class, instead of a record verdict (#20431)

Clause-②: no

A row-level policy can compare two fields that share no comparison class: text against a number, or any field against a file field, a formula field, or a field that holds a list or an object. The platform defines no answer for such a comparison. The SQL driver refuses to compile it, so every find the policy scopes answers `INVALID_FILTER` / 400. A by-id update or delete fails closed at its row-level gate, because that gate's pre-image read is the same refused read.

The explain engine's record attribution judged the same predicate in-process, without the object's declared columns. So it compared the two raw values, and it reported `record.visible` as `true` or `false` depending on how those values happened to compare. For one ordering of a pair, it reported the record visible where enforcement refuses the read.

The record matcher now receives the object's declared columns, as the RLS write check already does, and it refuses the comparison the way the driver does. A record-grained explanation (`recordId`) under such a policy is now refused with the matcher's envelope: `INVALID_FILTER` / 400, the same envelope the find answers with. No record verdict is reported. The message names the policy and both fields with their declared types. This is the answer explain already gives to the matcher's other `INVALID_FILTER` refusals, including a field-to-field comparison against a field that holds a list. Both orderings of one pair now get this one answer.

Unchanged:

- Enforcement admits and refuses exactly what it did before.
- A comparison between two fields of one class keeps its record verdict.
- A schema that cannot be read hands over no columns, so the matcher judges values only, as before.
- An object-level explanation (no `recordId`), which runs no record matcher.
