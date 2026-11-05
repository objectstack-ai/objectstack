---
'@objectstack/lint': patch
---

fix(lint): `os validate` warns on a flow start input whose record declaration (`objectName`) can never work as written

Clause-②: no
Metadata-protocol: none

Two new warnings from the flow trigger-readiness rule, beside `flow-input-unknown-object`. Both are advisory: no build or publish that passed before is refused.

- **`flow-input-object-less`** — a start input declares `objectName: 'global'`, the object-less placeholder. The pattern accepts it, but the start doors load nothing for an object-less key, so the value reaches the run unjudged. Located at `flows[N].variables[M].objectName`. Fix: name the object whose record id the input carries, or remove `objectName`.
- **`flow-input-record-read-as-list`** — a start input declares one record id, and a `get_record`, `update_record` or `delete_record` node in the same flow reads it as a list (`filter: { id: { $in: <the input> } }`). Start admission judges the input both ways and no value is both, so every start that supplies it is refused `400`. Located at the node's `config.filter.id.$in`. Fix: remove the input's `objectName` if it carries a list of ids, or read it as one id with `filter.id` or `filter.id.$eq`.

`flow-input-unknown-object` answers exactly as before, including for `'global'` when the stack defines no object of that name.
