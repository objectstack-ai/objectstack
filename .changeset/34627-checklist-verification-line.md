---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): the AI build result card draws the checklist's verification line, and states a failed build once

Clause-②: no
Metadata-protocol: none

When an AI build fails verification, the result card's `checklist` now carries a `verification` line (`{ kind: 'verification', status: 'failed', label, count }`), and its `status` and `passed/total` follow the verdict. The console dropped that line, so a failed build read "Checks passed 4/5" over four rows. The card now draws it as a red row: the producer's label, then the issue count. A failed checklist is the one place the turn states the failure: the build's draft card no longer draws its "N to fix" chip or the red "fix the problems" sentence beside it. The findings stay behind its Technical details.

A checklist line of any other kind that carries a valid `status` and a string `line` is drawn by those two fields, so a new kind from the producer needs no console change. Lines of the existing kinds draw as before.
