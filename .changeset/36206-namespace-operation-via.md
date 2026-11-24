---
'@objectstack/scenarios': patch
---

fix(scenarios): a namespaced card prefixes each operation's `via` the way it prefixes the agent action it names

Clause-②: no
Metadata-protocol: none

`namespacedScenario` prefixed `run.agentActions[].name` with the card's namespace but copied `run.operations[].via` bare, so the persona-grant check never found the routed action a build declares (`decide_approval_step` against `demoleave_decide_approval_step`) and failed builds that route the decision through the card's own action. The namespaced card now carries `via` prefixed, and the loader's rule (a `via` is one of the card's agent actions on the operation's object) holds on it as on the plain card.
