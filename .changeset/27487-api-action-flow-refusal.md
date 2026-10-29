---
'@object-ui/app-shell': patch
---

fix(console): a flow-backed api action shows the run's refusal, not the engine's node chain

Clause-②: no
Metadata-protocol: none

A `type: 'api'` action whose target is a declared `type: 'flow'` endpoint gets the trigger door's `400 FLOW_FAILED` when the run fails. The record page's action menu and the list and toolbar actions showed that envelope's message, so a member refused on the flow's write read text like `Node 'recalc_each' failed: map … subflow … update_record(showcase_task) failed: …`. Both api handlers now read the answer by the rule a screen flow already uses: the flow's own `errorMessage`, then the producer-marked `userMessage`, then the refusal the write met (`innerRefusal`), rendered as the record form renders it (a permission denial reads the form's permission line in the console's language), and only then the message. Any other error answer reads as before.

A failure inside a `map` item or a `subflow` reaches this door with no `innerRefusal` until the engine carries it out of those nodes, so that chain still shows the message.
