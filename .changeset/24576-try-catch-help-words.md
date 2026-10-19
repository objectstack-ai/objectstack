---
'@objectstack/service-automation': patch
---

The flow inspector's Error Variable help for a Try / Catch node describes the caught error in words

Clause-②: no (help text only: the `try_catch` descriptor's `configSchema` accepts exactly what it accepted before, and the value bound to the error variable is unchanged)

- The `errorVariable` description no longer names a TypeScript type (`TryCatchErrorValue`). It now says what the bound value carries, in plain language: the id of the Try / Catch node (`nodeId`), the failure message (`message`), the platform error code when the failing step reported one (`code`), and, for a failure inside a loop, the zero-based pass number (`iteration`) and the item being processed (`item`). The default variable `$error` is named.
- The old text also left out `code`, which the engine has bound since the classified-code change; an author reading the inspector had no way to learn that a catch region can branch on it.
