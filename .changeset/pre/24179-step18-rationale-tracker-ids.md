---
'@objectstack/spec': patch
---

Clause-②: no

fix(spec): the protocol 17 → 18 upgrade rationale states the element data-binding ruling in words instead of a tracker id

- **What was wrong.** Two sentences of step 18's rationale, the one `os migrate meta` prints for the hop and the upgrade guide renders, cited their decision as a tracker number and a ruling letter. The sentence on the element layer's flat data-binding keys and the one on `object-grid`'s `defaultFilters` each carried that parenthetical, which tells an upgrading author nothing.
- **What changes.** Each parenthetical now says what was decided, with the ruling's date: the element layer loses its second data door while the `object-*` blocks keep their native keys, and `defaultFilters` retires together with the element layer's flat binding keys, in the shape of the `defaultSort` retirement. The rest of both sentences, every other fragment, and every conversion and migration entry are unchanged.
