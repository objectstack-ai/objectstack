---
"@objectstack/service-messaging": patch
---

Migrate the inbox read-receipt race fallback onto the shared `isUniqueViolationError` predicate from `@objectstack/types` (#6542), deleting the last hand-written `isUniqueViolation()` copy that #6250 inventoried. One behaviour change, in the direction the call site wants: the shared predicate follows a bounded step down the `cause` chain, so a unique-constraint conflict wrapped by a pool or query-builder layer now triggers the `flipToRead()` convergence instead of being rethrown as a failed mark-read.
