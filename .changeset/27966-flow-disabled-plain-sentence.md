---
'@objectstack/service-automation': patch
'@objectstack/types': patch
'@objectstack/objectql': patch
---

fix: a flow an administrator switched off is refused with a plain sentence, the same one a switched-off action reads as

Clause-②: no
Metadata-protocol: none

- **The flow refusal** (`@objectstack/service-automation`). A packaged flow switched off under Setup › Packaged automation is still refused `FLOW_DISABLED`, at every door that runs it: its trigger, a direct run, and a parent flow that calls it as a subflow. The message now reads: "This flow is turned off for this deployment. An administrator can turn it on again under Setup › Packaged automation, or copy it there under a new name." It no longer names the ledger table or the ADR. The engine writes those, with the code and the flow's name, to an `info` log line each time it refuses one. A flow disabled by its own status (`obsolete` / `invalid`) still reads "Flow '…' is disabled", so the two reasons stay distinguishable.
- **One sentence for both** (`@objectstack/types`, `@objectstack/objectql`). `describeTurnedOffPackagedItem('action' | 'flow')` builds the sentence. The action refusal (`ACTION_DISABLED`) reads from it too, and its wording is unchanged. Only the last clause differs: a flow can be copied under a new name, and an action cannot, so the action sentence still offers another action instead.
