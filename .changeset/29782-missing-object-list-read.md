---
'@object-ui/data-objectstack': patch
---

fix(data-objectstack): a plain list read of an object the server does not know rejects with its 404 code and sentence instead of reading as an empty list

Clause-②: no
Metadata-protocol: none

`ObjectStackAdapter.find` on its plain path (no `$expand`, no `$search`) used to turn every 404 into `{ data: [], total: 0 }` and remember the resource, so every later read of it answered empty without asking the server. That memo exists for optional platform collections such as `sys_presence` and `sys_activity`, whose absence means the deployment does not install the feature. It also swallowed the 404 `OBJECT_NOT_FOUND` of a list's own object, so an object that failed to register read as "no data yet".

The empty answer and the memo now apply only to names in the platform registry (`isPlatformProvidedObjectName` from `@objectstack/spec`). A 404 on any other object is rethrown with its code, status and message, and is not remembered, so lists, boards, widgets and pickers over a missing object show their load-failure state. A dashboard figure over a missing object no longer reads 0. Enable-block denials (`OBJECT_API_DISABLED`, `OBJECT_API_METHOD_NOT_ALLOWED`) are rethrown as before.
