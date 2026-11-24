---
'@objectstack/scenarios': patch
---

docs(scenarios): an acknowledged roll-up finding on a child the card withholds is still charged

Clause-②: no
Metadata-protocol: none

The scenario runner's README now states how the scorer treats a `security-rollup-source-unreadable` finding the build acknowledged with `rollupSourceUnreadableReason`: it is charged as a failed Build check exactly like an unacknowledged one, whenever the card withholds the roll-up's child (or the child field it reads) from that persona. A written reason does not change what the persona sees, so a total the card withholds has to be masked, not explained. The scorer's behaviour does not change; a test now runs the real rule on acknowledged permission sets and pins that the runner reads the rule's suffixed `info` message on both of its readings (the child object and the child field) and charges every one.
