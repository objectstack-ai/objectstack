---
'@objectstack/spec': minor
---

`IDataDriver.update()` now declares its not-found arm: the return type is `Promise<Record<string, unknown> | null>`, and the docblock says when `null` is returned (no record with that id, on a driver not configured to throw on missing records). This is the shape `findOne()` already carries and the not-found vocabulary `delete()` already uses; it declares the behaviour four of the six shipped drivers have always had, which the previous declaration forbade. Callers that read fields off an `update()` result now narrow the `null` arm first — a compile-time obligation in place of a silent runtime hazard.
