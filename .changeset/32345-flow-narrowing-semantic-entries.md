---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide names the two flow shapes the authoring rules now refuse at a live save and a publish, a flow with no top-level start node and a node no edge from the start node reaches (#32345)

Clause-②: no
Metadata-protocol: none

- **What.** Two new semantic migration entries in protocol 18's step of the upgrade guide and `os migrate meta`, one per rule: `flow-start-node-missing-refused` (rule `flow-start-node-missing`) and `flow-node-unreachable-refused` (rule `flow-node-unreachable`). Each says what used to store, what is refused now (`os validate` / `os build` / `os lint`, and `422 INVALID_METADATA` at the flow live save and publish doors, while a draft still saves with the finding), and the fix.
- **The fix each names.** For a flow with no start node: add a node with `type: 'start'` to the top-level `nodes` and an edge from it to the first step. For an unreached node: wire it from the start node, or delete it; a second start node is deleted.
- **Rows stored before the release.** A start-less row stays stored and readable but is not armed: the engine refuses to register it, and the metadata read serves it beside `registration: refused`. A row holding an unreached node still registers and runs as before, and the node still never runs. For both, a live re-save is refused until fixed, a stored draft is judged at publish, and deleting the flow or saving it as a draft still works.
- **No automatic rewrite.** The start node carries the trigger, and whether an unreached step was meant to run is the author's judgement.
- **Not changed.** No schema, export or accepted input moves: the two refusals ship with `@objectstack/lint`, and these are their guide entries.
