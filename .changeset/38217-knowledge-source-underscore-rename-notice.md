---
'@objectstack/spec': patch
---

docs(spec): the `knowledge-source-id-to-name` conversion names the underscore-led id as the one source its rename rebuilds

Clause-②: no
Metadata-protocol: none

The conversion's summary said, for every knowledge source, that the value of `id` is kept as `name`, "so no index is rebuilt". That holds for every source but one class: a source whose `id` begins with an underscore. `name` refuses the underscore, so that source takes a new name, is built again under it, and its old index is dropped with `dropSource`, which the author runs; nothing drops it automatically. The summary (which reaches the upgrade guide and `os migrate meta --json`'s `specChanges`) and the conversion's comment now say so, in the words the `id` tombstone and the upgrade entry `knowledge-source-registration-governed` already use.

What the conversion does is unchanged: it copies an underscore-led id as it is, so `os migrate meta --from 18` shows the edit, the upgrade entry that judges it beside it, and the refusal of that `name` with the instruction to rename it without the underscore. The conversion's fixture and new tests pin that case; a plain id still reads "no index is rebuilt".
