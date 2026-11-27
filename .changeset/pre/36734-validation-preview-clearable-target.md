---
'@object-ui/app-shell': patch
---

fix(app-shell): the validation preview names a state machine's `''` target as "May be cleared"

Clause-②: no
Metadata-protocol: none

A state-machine rule whose transitions list `''` (the state may be cleared) previewed in the metadata admin as a trailing separator (`open | `) or, when `''` was the only target, a blank row. The preview now names that target in words, "May be cleared" (zh-CN "可清空"), the same words the Studio rules panel puts on the row's checkbox. A state with no targets still reads as a dead end. Display only: how the rule saves and enforces is unchanged.
