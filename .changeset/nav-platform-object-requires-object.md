---
"@objectstack/spec": patch
"@objectstack/platform-objects": patch
---

Clause-②: no
Metadata-protocol: none

An app menu entry naming a platform object the stack does not declare (`sys_task`, `sys_note`, or any `sys_`/`cloud_`/`ai_` name) is still refused by `defineStack` / `os validate`, but the refusal now names the fix: add `requiresObject: '<name>'` to the entry (the menu hides it wherever the object is not registered) and do not declare a copy of the object in the package. A name without a platform prefix keeps the old message. The `sys_task` and `sys_note` docblocks now teach the menu entry with `requiresObject`.
