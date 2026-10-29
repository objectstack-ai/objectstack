---
'@objectstack/lint': patch
---

docs(lint): the liveness lint's `live-elsewhere` worked example no longer names `manifest.runtime`, a `live` row since the boot-time loader began dispatching on the plugin tier

Clause-②: no
Metadata-protocol: none

`lintLivenessProperties` used `manifest.runtime` as its worked example of a `live-elsewhere` row in its doc comment and in the `live-elsewhere` verdict's default hint. That row reads `live` now, so the example taught the opposite of the ledger. Both places describe the verdict generically instead (a key with zero local dispatch whose only enforcer is a gate in another repository, a marketplace publish gate for instance, named by the ledger row's `evidence`), since no shipped row holds the verdict today. The rule, its id and the hint's instruction (keep the property; read the row's evidence for the enforcer) are unchanged.
