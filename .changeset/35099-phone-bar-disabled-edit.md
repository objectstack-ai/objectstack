---
'@object-ui/app-shell': patch
---

fix(app-shell): a phone's record bar never leads with an Edit that is off, whatever turned it off

Clause-②: no
Metadata-protocol: none

On a phone, the record page's bottom bar moved a greyed Edit out of its first slot only under an approval lock. An Edit turned off by the object's `userActions.edit.disabledWhen`, or by the record's state (every field the edit form shows is read-only through its `readonlyWhen`), still took the first slot, ahead of every action the reader could press. Now Edit moves into the bar's `⋯` for any of the three reasons, still drawn and still off, and the first usable action takes the slot. The state lock keeps its "Not editable in its current state" badge. The desktop header keeps Edit greyed in place for every reason, and an Edit that is on is unchanged.
