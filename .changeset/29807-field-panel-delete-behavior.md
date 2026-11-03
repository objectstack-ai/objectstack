---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the Studio object designer's field panel offers a Delete Behavior row on lookup, user and master_detail fields

Clause-②: no
Metadata-protocol: none

The field panel in the Studio object designer now draws a Delete Behavior select, so an author can set or clear `deleteBehavior` without editing raw metadata. It follows the generic `field` form's rows for the same key: a `lookup` or `user` field offers Set Null, Cascade and Restrict, and a `master_detail` field offers Cascade and Restrict only, because the spec refuses an authored `set_null` there. The leading "— None —" item removes the key, so the field declares nothing (the spec default on a `lookup`; no part in the delete walk on a `user` field). Changing a field to a type without the row removes the key, and changing it to `master_detail` removes an authored `set_null`. The labels are new Studio namespace keys (`designer.field.deleteBehavior.*`) in English and Chinese.
