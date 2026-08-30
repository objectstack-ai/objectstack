---
"@objectstack/spec": patch
---

Customer-facing refusal and warning messages built inside plain `function` declarations (and two hoisted ruling consts) no longer cite internal tracker ids. The teaching stays; customer-resolvable anchors stay — ADR ids, protocol versions, error codes such as `INVALID_FILTER / 400`, and ruling dates — while the `#NNNN` tokens, which resolve to nothing for a refused author, are gone. The doc-authoring gate now recognises function declarations as text sinks (its fifth population, with its own blindness floor) and prints its own scan boundary, so the next boundary move is visible from the gate's output.
