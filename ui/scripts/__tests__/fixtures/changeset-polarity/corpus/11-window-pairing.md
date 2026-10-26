---
'@object-ui/types': patch
---

The window pin (objectui#9754). A pairing belongs to the CLAUSE that carries the
declaration verb, not to the sentence that happens to hold both names.

`LaneSchema` declares `cards`, and `ObjectKanbanSchema` is the node that
references it.

The reading that must SURVIVE, or the window was narrowed by going blind:
`ObjectKanbanSchema` declares `swimlaneWidth`, and `LaneSchema` is untouched
here.

The coordinated object list, where the second key sits past the cut:
`ObjectKanbanSchema` declares `cardTitle` and `cardSubtitle` on the card head.

A relative clause has no subject of its own and takes its antecedent's:
`SpinnerSchema` (which declares `type` and no `size`) is the other node.

And the residue the clause-polarity repair handed here — one key, two
declaration clauses, opposite polarity: `SpinnerSchema` declares no `cardTitle`,
while `ObjectKanbanSchema` declares `cardTitle` on the card head.
