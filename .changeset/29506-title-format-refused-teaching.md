---
'@objectstack/skills': patch
---

docs(skills): teach that a save and `os validate` refuse `titleFormat`

Clause-②: no
Metadata-protocol: none

- `objectstack-data` (object properties table) and `objectstack-formula` (template carriers) no longer call `titleFormat` deprecated: since #29499 the metadata save gate and `os validate` refuse an object that declares it (`title-format-retired`), and it moves to `nameField`. The formula skill drops the sentence that restated the template grammar cell beside it.
- ADR-0079 D3 gains a dated amendment note citing ruling 6574393684 and #29499; the decision is unchanged.
