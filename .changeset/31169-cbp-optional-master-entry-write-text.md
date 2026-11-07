---
'@objectstack/spec': patch
---

docs(spec): the semantic migration entry `cbp-optional-master-admitted` states the current write rule for an empty optional master

Clause-②: no
Metadata-protocol: none

The entry's `replacement`, and its paragraph in the protocol upgrade guide, still said that a write leaving an optional `controlled_by_parent` master empty is refused with 422. The write gate admits such writes since the owner rule landed (ADR-0055 §3 as amended): an insert that names no master is admitted and its creator owns the row; its owner and a holder of Modify All on the detail update or delete a row whose master reference is empty, and everyone else, View All included, is refused `403 PERMISSION_DENIED`; an update that empties a named master asks edit access on the master it leaves. Only a required master's empty stored reference is still refused with `422 MISSING_REQUIRED_FIELD`. Text only: the entry's `id`, `surface`, `reason` and `acceptanceCriteria`, and every schema and runtime answer, are unchanged.
