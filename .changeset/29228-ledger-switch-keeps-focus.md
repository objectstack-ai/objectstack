---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's flow ledger switch keeps keyboard focus while its toggle is in flight and after the answer lands

Clause-②: no
Metadata-protocol: none

On Studio › Automations, a read-only package's flow offers the switch that turns it on or off for this deployment. While a toggle was in flight the switch drew `disabled`, and a browser moves focus off a focused control that turns disabled, to the page body, where it stayed once the answer landed. A keyboard or screen reader author had to tab back from the top of the page after every flip, accepted or refused. In flight the switch is now `aria-disabled` and refuses the press in its own handler, so it keeps focus and a second Space still sends no second request. A switch the deployment's posture walls off stays `disabled` and described by its reason, as before.
