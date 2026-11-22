---
'@objectstack/scenarios': patch
---

Clause-②: no
Metadata-protocol: none

feat(scenarios): the build prompt's confirm-first line asks the build to lock the change a gated action makes

A confirm-gated agent action (`ai.requiresConfirmation`) guards its own door only; the gate is not widened to the raw data door, so an agent that met the gate could still write the target state with a plain record update. The build contract's line for each confirm-first action now also asks the build to lock that change: when the action changes fields of its row, those fields are made not editable for each person who runs it, at the stage the action acts on (a field permission `when` in their permission set), and the action writes them elevated, so the same people's other changes to those fields still land. An action that deletes its row locks nothing, and its people keep their delete right. Lines for actions that are not confirm-gated are unchanged.
