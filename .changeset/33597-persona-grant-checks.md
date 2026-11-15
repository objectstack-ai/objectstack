---
'@objectstack/scenarios': patch
---

feat(scenarios): the Build half checks each persona's permission set for what the card has that persona read and write

Clause-②: no
Metadata-protocol: none

`scoreCardArtifact` (and `scoreScenarioArtifact`) gain `personaGrants`: one Build check per persona × object × verb the card implies, named `persona-grant:<persona>:<object>:<verb>`, judged against that persona's own permission set (`<namespace>_<persona id>`, the set the runner signs the persona in with). The needs come from the card alone: a question asked as the persona needs `read` on its object (not when the persona hides that object), an `applied` or `pending_confirmation` operation needs its kind, and an operation refused `PERMISSION_DENIED` must be refused by the set. The grant is read as the platform folds it (`buildEffectiveObjectPermissions`, then `objectPermissionGrants`: edit and delete are read and grant).

- A needed verb passes when the set grants it. A withheld verb that only `pending_confirmation` operations need, where the build declares the card's confirm-gated agent action on that object, is not measured (out of passed and total, never a pass): that action is the route the card designs, and its body writes as the platform.
- A refused write passes when the set grants no verb or locks a field the write names; it is not measured when only a row rule could refuse it, and fails when nothing in the set refuses it.
- A persona whose set the build does not declare fails each of its checks.

Not-measured checks now leave the card score's passed and total.
