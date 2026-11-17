---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

fix(runtime): a resume approval is bound to the screen it was given on, so a wizard that moved on is never handed the earlier screen's values

Clause-②: yes (widening)
Metadata-protocol: none

A multi-screen wizard stays paused under the same run id as it moves from screen to screen. So when the MCP `resume_run` tool handed a resume to the person (an action that declares `ai.requiresConfirmation: true`), a second resume of the same pending item was still admitted after the first approval had moved the wizard on: the values given for the first screen were submitted to the next screen, as the approver. The same happened when the agent called `resume_run` twice (two pending items), and when the person advanced the wizard in the app before the item was approved.

- The hand-off now names the screen its values were given for: `ActionConfirmationHandOff.run.screenNodeId` (the `ScreenSpec.nodeId` the run was parked on). It is optional and absent only when the engine named no node.
- `dispatchActionResume` takes the same optional `screenNodeId`. A host that stores it with the pending item and passes it back on approval binds the approval to that screen: a run no longer paused on it is refused `409 RESOURCE_CONFLICT`, nothing resumes, and the run stays where it is. A `screenNodeId` that is not a non-empty string is refused `400`.
- An elicited approval (a client that can be asked in place) is bound the same way: if the wizard moved on while the person was being asked, the resume is refused `409 RESOURCE_CONFLICT`.
- Nothing already accepted is refused: a call that passes no `screenNodeId` resumes the run's current screen, as before. A host should pass it to get the binding.

Limit: a wizard that loops back to the same screen node cannot be told apart by node id; no flow doing that has been found in use.
