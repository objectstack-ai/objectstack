---
'@objectstack/spec': patch
---

docs(spec): the solution-blueprint widget `aggregate` describes, on the lenient schema and its strict mirror, no longer promise "the reader's own default" when the key is unset. Both now read one shared rule: a widget that names a `measure` and leaves `aggregate` unset is incomplete, and a reader may refuse it; no default aggregation is promised. Only a count widget, which names no `measure`, may leave it unset, and the strict mirror's `null` stays legal there, as its describe now says. Describe text only: the accepted set of both schemas is unchanged.

Clause-②: no
Metadata-protocol: none
