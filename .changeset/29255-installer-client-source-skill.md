---
'@objectstack/skills': patch
---

docs(skills): the automation skill's OAuth recipe teaches the installer-supplied client

Clause-②: no
Metadata-protocol: none

Recipe 6 of `objectstack-automation/references/integration-recipes.md` now shows `clientSource: 'installer'` beside a declared `clientId` + `credentialRef`, with when to use which: a declared client for an app its publisher deploys, the installer form for one installed on deployments the publisher never sees. The administrator registers a client with the vendor against the `redirectUri` the connection's status read answers, connects with `{ clientId, clientSecret }` (no secret for a public client; a reconnect naming no client keeps the stored one), and the connection reads back `client: { source: 'installer', clientId, hasSecret }`, never the secret.
