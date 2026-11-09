---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide names a dataset or cube dimension over a formula field, which the dataset compile and the authoring rules now refuse (#30822)

Clause-②: no
Metadata-protocol: none

- **What.** A new semantic migration entry, `dataset-dimension-virtual-field-refused`, in protocol 18's step of the upgrade guide and `os migrate meta`: a `datasets[].dimensions[].field` or an `analyticsCubes[].dimensions.KEY.sql` naming a `formula` field. It quotes both refusals as they ship: the dataset compile's `400 DATASET_INVALID` and the authoring rule `dimension-virtual-field-refused` (`os validate` / `os build` / `os lint`, and `422` at the runtime dataset save).
- **No automatic rewrite.** Which stored field should carry the value is the author's judgement. The remedy: store the value in a field of its own on the object (written by a hook or a flow when its source changes) and point the dimension at that field, or remove the dimension.
- **Relevance.** `os migrate meta` lists the entry unless the stack provably declares no `datasets` and no `analyticsCubes`.
- **Not changed.** No schema, export or accepted input moves: the refusal itself shipped with `@objectstack/service-analytics` and `@objectstack/lint`, and this is its guide entry, the dimension-side sibling of `dataset-measure-aggregate-field-type-refused`.
