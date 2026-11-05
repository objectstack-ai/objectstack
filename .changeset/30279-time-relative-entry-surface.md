---
'@objectstack/spec': patch
---

fix(spec): the `flow-record-read-and-decision-type-mismatch-refused` upgrade-guide entry names the object a time-relative flow's conditions are typed against: the swept `config.timeRelative.object`, when the start node names no `objectName`, and the start node's `objectName` when that is the swept object (#30279)

Clause-②: no
Metadata-protocol: none

Text only: the entry's `surface` and the matching sentence of its `reason`, which `os migrate meta` and the upgrade guide show, said the refusal covers a time-relative flow "sweeping the start node's objectName". The author-time gate also types such a flow against `config.timeRelative.object` when its start names no `objectName`, and refuses the same conditions there; the entry now says so. Its id, kind, replacement and acceptance criteria are unchanged, and no verdict moves.
