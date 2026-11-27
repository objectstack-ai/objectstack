---
'@object-ui/app-shell': patch
---

fix(app-shell): a state machine rule's "Next states" box in Studio takes a typed comma, so a second next state can be typed in

Clause-②: no
Metadata-protocol: none

The box showed the parsed next states again after every key, so a typed `,` and the space after it were dropped and typing `done, closed` gave the single state `donec`. The box now keeps the text being typed and writes the parsed next states on each change; when it loses focus it shows them again. The row's "May be cleared" checkbox still carries the empty-string target, and editing the box keeps it.
