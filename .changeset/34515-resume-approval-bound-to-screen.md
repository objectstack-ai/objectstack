---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

fix(runtime)!: a resume approval is bound to the screen it was given on, so a wizard that moved on is never handed the earlier screen's values

Clause-②: yes (narrowing) — narrowed: an MCP `resume_run` of a declared-gated flow action on a client that is asked in place (form-mode `elicitation`), where the person accepts after the wizard moved on to another screen in the meantime, is now refused `409 RESOURCE_CONFLICT` and resumes nothing, where it resumed the screen the run had moved on to. Widened beside it: `ActionConfirmationHandOff.run.screenNodeId` and `ActionResumeRequest.screenNodeId` are new optional keys, and a host call that omits `screenNodeId` behaves as before.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches what a second resume of one run does (`skills/objectstack-ai/SKILL.md` lines 211–217 and `skills/objectstack-platform/SKILL.md` line 344 teach the hand-off, the `confirm` refusal and the elicitation answers only); `content/docs/ui/actions.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is removed, renamed or re-shaped: the two new keys are optional TypeScript members of runtime contracts, and the moved answer is a runtime refusal at the MCP `resume_run` door, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for an MCP client that is asked in place: when the person accepts a `resume_run` of a declared-gated action after the wizard has moved on to another screen (advanced in the app while they were being asked), the call is refused `409 RESOURCE_CONFLICT`, nothing resumes, and the run stays on the screen it is on. Before this change the same call resumed that other screen with the values the agent gave for the first one, as the person. The agent asks again on the screen the run is on now.

A multi-screen wizard stays paused under the same run id as it moves from screen to screen. So when the MCP `resume_run` tool handed a resume to the person, a second resume of the same pending item was still admitted after the first approval had moved the wizard on: the values given for the first screen were submitted to the next screen, as the approver. The same happened when the agent called `resume_run` twice (two pending items), and when the person advanced the wizard in the app before the item was approved.

- The hand-off now names the screen its values were given for: `ActionConfirmationHandOff.run.screenNodeId` (the `ScreenSpec.nodeId` the run was parked on). It is optional and absent only when the engine named no node.
- `dispatchActionResume` takes the same optional `screenNodeId`. A host that stores it with the pending item and passes it back on approval binds the approval to that screen: a run no longer paused on it is refused `409 RESOURCE_CONFLICT`, nothing resumes, and the run stays where it is. A `screenNodeId` that is not a non-empty string is refused `400`.
- A host call that passes no `screenNodeId` resumes the run's current screen, as before. A host should pass it to get the binding.

Unchanged: a single-screen flow, an elicited approval whose run is still on the screen the person was asked about, and an MCP `resume_run` of an action that declares no confirmation.

Limit: a wizard that loops back to the same screen node cannot be told apart by node id; no flow doing that has been found in use.
