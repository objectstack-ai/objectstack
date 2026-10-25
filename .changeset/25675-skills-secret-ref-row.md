---
'@objectstack/skills': patch
---

docs(skills): the automation skill's inbound-hook table names `config.secretRef`, the form a package ships instead of a literal secret

Clause-②: no

Metadata-protocol: none

The `objectstack-automation` skill's start-node table said an `api` flow needs a non-blank literal `secret`, or the flow is refused at registration. An `api` flow's start node may now name its secret instead, with `secretRef: 'NAME'`: the deployment fills that name (an environment variable in the open tier, never `OS_*`), and the engine reads it at every post, answering `503` while the name is unfilled. The row now says either one is required, and that a package ships `secretRef` and never commits a literal. The signature line names the `x-objectstack-signature` header the row used to carry.
