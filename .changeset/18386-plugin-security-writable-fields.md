---
'@objectstack/plugin-security': minor
---

The `security` service implements `getWritableFields(object, context)` (#18386). It uses the same permission sets, field grants, `requiredPermissions` check and on-behalf-of delegator intersection as the write gate. A field is in the answer exactly when a write naming it passes the field-level-security check. `getReadableFields` now shares that derivation, and its answers are unchanged.
