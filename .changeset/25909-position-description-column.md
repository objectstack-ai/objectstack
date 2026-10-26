---
'@object-ui/app-shell': patch
---

fix(app-shell): the Setup → Positions list shows each position's description

Clause-②: no
Metadata-protocol: none

The position list in Setup declared only Name, Label, Holders and Permission sets, so a position's `description`, which `GET /meta/position` already serves, was never shown. The list now has a Description column right after Label, the same column the permission-set list next to it has. A position without a description shows the empty cell. The text is the served one, so a description the translation bundle's `positions` namespace translates shows translated, like the label.

What to do: nothing.
