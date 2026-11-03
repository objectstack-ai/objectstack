---
'@objectstack/skills': patch
---

docs(skills): the formula skill teaches the null-guard gate on a record-triggered flow's conditions

Clause-②: no
Metadata-protocol: none

The publish-time null-guard gate (`os validate` / `os build` / `os lint` and the runtime publish gate) has judged a record-triggered flow's start `config.condition`, every edge `condition` and every `decision` branch `expression` since the lint change that widened it; the formula skill now says so where it teaches the gate: which slots are judged, that a `count` / `sum` roll-up is always valued while `min` / `max` / `avg` stay nullable, that a bare field name in a flow condition is the field and is judged alike, that a guard in the start condition holds at every edge and branch and is spelled `record.<field> != null` so both doors accept it, and that an unguarded null fails the run while the write that fired it still lands. One eval exercises a refused flow edge. The flows docs page carries the same rule where edge and decision conditions are taught.
