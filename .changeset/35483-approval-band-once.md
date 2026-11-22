---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a laid-out record page whose first details block draws no body still shows the approval band

Clause-②: no
Metadata-protocol: none

The laid-out record page draws the record's approval band ("Locked for approval" / "In approval · editable", with its recall lever and tally) once per page. It used to give the band to the first `record:details` node of the details column and tell every later one not to draw it, so on a slotted page whose `details` slot puts first a `record:details` the reader may not see (its `requiredPermissions` withheld) or one that draws its own header (`showHeader: true`), a locked record showed no band at all. The details column now draws the band by the first details body that reaches its place, the rule a page drawn as written already follows: the next part draws it. Every other page reads as before, the band stays above a body table, and whether the band reads locked or editable (a `lockRecord: false` approval node) is unchanged.
