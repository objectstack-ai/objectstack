---
'@objectstack/skills': patch
---

test(skills): the platform skill's evals ask for push notifications on an `os serve` deployment

Clause-②: no
Metadata-protocol: none

`skills/objectstack-platform/evals/config-plugins-ops.json` gains case 12: the prompt asks to turn on push notifications for an `os serve` deployment, and the expected answer declares `requires: ['push']` with a top-level `push:` key on the stack definition and writes no secret inline (the APNs signing key and the Firebase service-account JSON are named by reference). The assertions stay with what `objectstack-platform/SKILL.md` teaches today, the `push` token and the top-level key; the push block's transport and vendor shape are not asserted until the skill teaches them.
