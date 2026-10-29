---
'@objectstack/objectql': patch
---

fix(objectql): the nested-relation condition refusal states what to write inside the 500-character client cap

Clause-②: no
Metadata-protocol: none

`POST /api/v1/data/OBJECT/query` (and `find` / `count` / `aggregate` / `update` / `delete`) refuses a nested-relation condition in `where` with `400 INVALID_FILTER` when it reaches a second relation, uses a dotted key, names no key, names a key the related object does not declare, or sits beneath a relation whose related object is not registered. A client reads at most 500 characters of that message, and for a second-level relation, a dotted key and an empty condition the refusal printed its route after "NOT applied", so with an ordinary field name the route was cut off. Each refusal now reads: where the condition sits, the short reason, what to write instead, then "NOT applied" and any reasoning. The head names the column after the path by its type (`beneath the lookup field`), and the two-step route reads `then match its ids: …`; on a multi-valued relation the ids route reads `an $or of { "FIELD": { "$contains": ID } }, one per id` (the cap refusal uses the same spelling).

Both refusal heads — this one and the no-operator-object refusal's — now name the condition's or object's first key and count the rest (`keys "region", and 2 more`) instead of listing three, so with long object, field and key names every route still lands inside the cut.

The cap, the truncation, the code and the status are unchanged, and so is the set of filters refused.
