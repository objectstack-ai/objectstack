---
'@objectstack/runtime': patch
---

feat(runtime): `dispatchActionResume` resumes a handed-off `resume_run` as the person who approved it

Clause-②: yes (widening)
Metadata-protocol: none

The confirmation contract says that approving a handed-off `resume_run` resumes that parked run, with the values the call carried, as the approver. Until now the framework exported no way to do that: `dispatchAction` only starts an action, and the MCP `resume_run` door hands a gated action off again. A host that implements the pending-confirmation service (`ai.actionConfirmation`) could hold a handed-off `resume_run` but had to keep refusing it.

`dispatchActionResume(kernel, { executionContext, runId, values, confirm })` is the approval leg. It asks every `resume_run` gate again as the approving person: the run must still be paused and started by that person, the flow action that admits it must pass every `run_action` gate, the subject record is read again as the person, and the run must be paused on a screen. Then it resumes that run. Only a run that is no longer paused is refused: a wizard the approval moved on to its next screen is still paused under the same run id, so the host's approve door decides each pending item once and voids an item whose run has moved on. The confirmation gate reads `confirm` as `dispatchAction`'s does, so a declared-gated action resumes on the person's `confirm: true` and nothing is handed off again. An AI service account is refused whatever it carries. The answer is the REST envelope, as `dispatchAction`'s is.

Nothing changes for an existing caller.
