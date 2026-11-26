---
'@object-ui/app-shell': patch
---

fix(console): the record drawer's bar opens the assistant

Clause-②: no
Metadata-protocol: none

The record side drawer is drawn over the right end of the console's top bar, where the assistant's one entry (the robot) sits, so while a record was open in the drawer the assistant could not be opened. The drawer's bar now carries an 「AI Assistant」 control wherever the robot is drawn (the runtime serves AI): it opens the record as its full page, as 「Open as full page」 does, with the assistant open beside it. Both drawers carry it: the object list's (and a record page's) drawer, and the data page's. Without the assistant no control is drawn. The label is the robot's own, already in every locale.
