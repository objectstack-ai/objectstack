---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's flow definition switch keeps keyboard focus while its save is in flight and after the answer lands

Clause-②: no
Metadata-protocol: none

On Studio › Automations, a writable package's flow carries a switch that turns the flow on or off in its draft. While that save was in flight the switch drew `disabled`, and a browser moves focus off a focused control that turns disabled, to the page body, where it stayed once the save landed. A keyboard or screen reader author had to tab back from the top of the page after every flip, saved or refused. In flight the switch is now `aria-disabled` and refuses the press in its own handler, so it keeps focus and a second Space still sends no second save. A read-only package's switch, and one with no canvas to edit, stay `disabled` and described as before.
