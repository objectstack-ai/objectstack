---
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
---

fix(runtime): the automation write doors keep a flow whose only package is disabled, whatever that package's enable state

Clause-②: yes (widening)
Metadata-protocol: none

**Added:** `AutomationEngine.getHeldFlow(name)` on `@objectstack/service-automation`: the flow the engine holds under a bare name, judged over every holder (a disabled package's included, `null` for a name it does not hold or a slot-key spelling); a name two packages hold is refused `409` naming every holder. Like `getFlow`, it settles the name first, so a lone qualified slot of a name one package holds again is re-keyed to the bare name.

Four `/automation` write doors ask a lasting question of a flow name: the clone door's taken-name check on the new name, the copy a refused definition write (`POST /`, `PUT /automation/NAME`) puts back, the credential `PUT /automation/NAME` keeps when the body leaves it out, and the `DELETE /automation/NAME` existence check. They read the engine's served view (`getFlow`), in which a flow whose one package is disabled is no flow. For a name one package holds they now read the flow the engine holds over every holder, through `getHeldFlow`, so their answers no longer depend on whether that package is enabled. For a flow whose only package is disabled while the engine still holds it:

- Clone with this flow's name as the new name: refused `409`, the door's name-taken answer, and nothing is registered. Before, the copy was admitted and filed in the disabled package's slot.
- A definition write the engine accepts and the store then refuses: the flow the engine held is registered again. Before, the name was withdrawn.
- `PUT` with a body that leaves out a stored credential: the stored credential is kept. Before, nothing was carried forward.
- `DELETE`: the flow is removed and the door answers a deletion. Before, the door removed it and answered `404`.

These are the answers the last release gave: the served view changed after it.

A name two packages hold is read at these doors on its served holder, as before: a refused definition write puts back the served holder's body, and a `PUT` keeps the served holder's stored credential. With one holder disabled, a package-less `PUT /automation/NAME` or `POST /automation` onto such a name is admitted into the enabled holder, with or without a metadata store (the store's save, naming no package, writes the enabled holder's row), as before. While both holders are enabled, the definition writes and `DELETE` are refused `409` (`RESOURCE_CONFLICT`) naming every holder, as before.

The clone door's new name: a name two packages hold is taken. While one holder is disabled it gets the door's name-taken `409`, as before. While both are enabled, the engine's refusal used to leave the door thrown, naming every holder; the door now answers its own name-taken refusal, returned, with the same status and code (`409`, `RESOURCE_CONFLICT`), whose remedy is a new name.

A flow of an enabled package, and a name the engine does not hold, answer as before. The read and run doors (`GET`, trigger, toggle, runs, the clone's source) keep the served view.
