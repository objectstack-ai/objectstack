---
'@objectstack/skills': patch
---

test(skills): the platform skill's evals ask for push notifications on an `os serve` deployment

Clause-②: no
Metadata-protocol: none

`skills/objectstack-platform/evals/config-plugins-ops.json` gains case 12: the prompt asks to turn on push notifications for an `os serve` deployment of the team's own white-label apps, and the expected answer declares `requires: ['push']` with a top-level `push:` key on the stack definition using `transport: 'direct'` and an `apns` and/or `fcm` block, each naming its secret by `credentialRef`, and writes no secret inline. The case refuses `transport: 'relay'`: the hosted relay, which an absent or empty `push` block also reads as, is refused at boot until its sender ships.
