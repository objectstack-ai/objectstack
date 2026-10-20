---
'@objectstack/spec': patch
---

Automation: two help sentences on `try_catch` now match what the engine binds. The error value's `nodeId` is described as the id of the Try / Catch node itself (not the failing inner step, which is normally named inside `message`), and `errorVariable` says in words what the bound value carries instead of naming a code type. Schema and runtime behaviour are unchanged; the generated reference page and the shipped JSON schema carry the new text.
