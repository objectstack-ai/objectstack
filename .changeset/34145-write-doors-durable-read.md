---
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
---

fix(runtime): the automation write doors judge a flow name over every holder, whatever the holder's package's enable state

Clause-②: no
Metadata-protocol: none

Four `/automation` write doors ask a lasting question of a flow name: the clone door's taken-name check on the new name, the copy a refused definition write (`POST /`, `PUT /automation/NAME`) puts back, the credential `PUT /automation/NAME` keeps when the body leaves it out, and the `DELETE /automation/NAME` existence check. They read the engine's served view (`getFlow`), in which a flow whose one package is disabled is no flow. They now read the flow the engine holds over every holder, through the engine's new engine-local `AutomationEngine.getHeldFlow(name)`, so their answers no longer depend on whether that package is enabled. For a flow whose only package is disabled while the engine still holds it:

- Clone with this flow's name as the new name: refused `409`, the door's name-taken answer, and nothing is registered. Before, the copy was admitted and filed in the disabled package's slot.
- A definition write the engine accepts and the store then refuses: the flow the engine held is registered again. Before, the name was withdrawn.
- `PUT` with a body that leaves out a stored credential: the stored credential is kept. Before, nothing was carried forward.
- `DELETE`: the flow is removed and the door answers a deletion. Before, the door removed it and answered `404`.

These are the answers the last release gave: the served view changed after it.

A name two packages hold, one of them disabled, is now refused at these doors `409` (`RESOURCE_CONFLICT`), naming every holder, before anything is registered. That is the answer the doors give while both packages are enabled. Before:

- `DELETE` answered the same refusal: the engine's removal raises it.
- The clone's new name got the name-taken answer, also `409`.
- The definition writes got the same refusal while the engine still held the disabled package's slot, because the engine's registration raises it. Once the disable's re-sync had withdrawn that slot, the registration filed the body in the enabled package's slot. The store's save, which names no package, then refused it `409` naming the packages, and the engine was put back. A composition with no metadata store kept the write.

A flow of an enabled package, and a name the engine does not hold, answer as before. The read and run doors (`GET`, trigger, toggle, runs, the clone's source) keep the served view.
