---
'@objectstack/types': patch
---

fix: the switched-off packaged item sentence names where the switch is now, not the retired Setup › Packaged automation page

Clause-②: no
Metadata-protocol: none

`describeTurnedOffPackagedItem`, the sentence both refusal engines send when an administrator has switched a packaged action or flow off (`ACTION_DISABLED`, `FLOW_DISABLED`), named Setup › Packaged automation as the place to turn it on again. That page is retired: an action's switch is on Setup's Packaged Actions page, and a flow's switch, with New similar beside it, is on the flow in its package's Automations in Studio. The sentence now names each:

- Action: "This action is turned off for this deployment. An administrator can turn it on again under Setup › Packaged Actions, or you can use another action."
- Flow: "This flow is turned off for this deployment. An administrator can turn it on again in its package's Automations in Studio, or copy it there under a new name."

Words only. The envelope codes are unchanged, and a machine reads those, not the sentence.
