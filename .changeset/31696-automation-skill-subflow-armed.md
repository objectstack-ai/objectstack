---
'@objectstack/skills': patch
---

docs(skills): the automation skill no longer says a flow name two packages hold is never armed

Clause-②: no
Metadata-protocol: none

The `subflow` row of `skills/objectstack-automation/SKILL.md` ended its two-holder case with the remark "an older clash, never armed". That remark is false, since two packages' flows of one name can each be armed, and it is removed: the parenthetical now reads `(package / package-less caller)`. Nothing is said in its place about whether the two flows are armed. The refusal the row teaches is unchanged: a caller that names neither package is refused, naming both. No other text changes.
