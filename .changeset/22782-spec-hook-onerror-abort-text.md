---
'@objectstack/spec': patch
---

`HookSchema.onError` and `HookEvent` now say where an `after*` hook's `abort` rolls the write back, and what it means elsewhere

Clause-②: no

Text only: no key, shape, default or enum changes, and every hook that parsed before parses the same.

- **`onError`** (its TSDoc and `describe()`): `abort` refuses the operation. A blocking hook's abort rolls the write back whenever the write runs inside a unit of work. Those units are a caller's `transaction()`, an atomic batch or cascade, and the unit the write door now opens for a blocking `abort` `after*` hook on an object on the default datasource whose driver declares transactions (`@objectstack/objectql`, same release). On an object on another datasource, or a driver without transactions, an `after*` hook's abort refuses the caller while the row stays stored.
- **`HookEvent`'s JSDoc** listed three ways a write ends up inside a unit of work. It now lists four: the write door's own unit is the new one.
