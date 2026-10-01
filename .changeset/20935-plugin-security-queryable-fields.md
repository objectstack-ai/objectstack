---
'@objectstack/plugin-security': minor
---

The `security` service implements `getQueryableFields(object, context)` (#20935). A field is in the answer exactly when a query naming it as a filter, a sort key, a group key or an aggregate input passes the engine's field guards: the answer is read from the one field map the predicate guard and the aggregate-input guard now share (permission sets, field grants, the `requiredPermissions` check, the on-behalf-of delegator intersection, and every field whose masking rule applies to the caller). The two guards refuse exactly what they refused before.
