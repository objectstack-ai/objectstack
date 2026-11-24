---
'@object-ui/app-shell': patch
---

fix(console): an action refused before it reaches its flow shows the refusal's userMessage

Clause-②: no
Metadata-protocol: none

When the action route refuses a click before it hands it to the action's flow — the subject record was deleted or became unreadable after the page loaded (`404 RECORD_NOT_FOUND`), or the subject is denied or locked — the red toast now shows the envelope's producer-marked `userMessage` (the translated line) and falls back to the developer `message` only when the envelope carries none. The same rule already held when the handler threw.

It covers every failure arm the flow reader has outside a failed run: the action door and the trigger route of a `type: 'flow'` launch, a resume that finds no run, and any other refused or transport answer. A `type: 'api'` action refused at the action door reads it the same way; `type: 'script'` already did. An action's authored `errorMessage` still wins over both. No props or exports change.
