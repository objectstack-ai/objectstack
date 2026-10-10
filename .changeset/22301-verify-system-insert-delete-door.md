---
'@objectstack/verify': minor
---

feat(verify): `hooks.run` takes the system principal on an insert and a delete, so a user-less record trigger can be driven

Clause-②: yes (widening)

An app's tests can drive a record-change flow fired by a write with no user (an integration's or a system job's insert or delete) through the in-process handle, so a suite no longer hands a flow a record through the booted kernel's `automation` service by hand.

- **`hooks.run(object, 'insert' | 'delete', input, { system: true })`** is the engine's own `insert` / `delete` under `{ isSystem: true }`, the same call the person's write makes with only the context changed. `{ system: true }` on `update` is unchanged. No permission gate applies. The bound hooks still run (they see `session.isSystem` and no `userId`), declared validations still refuse, and the record-change trigger fires the object's flows with no trigger user.
- **A record the engine no longer holds.** A system (or a person's) delete hands a `record-after-delete` flow the row's pre-image as `record` and as `previous`, and by then the engine no longer holds the row: the flow's `get_record` of that id finds nothing. A `record-before-delete` flow on the same delete still finds it.
- **Not `seed`.** `seed(object, rows)` also runs as the system, and it sets `skipTriggers`, so it fires no record-change flow: use it for end-state fixture data, and `{ system: true }` for a write the app should react to.
- A call naming both callers (`{ as: token, system: true }`) is still refused with `code: 'INVALID_REQUEST'`, `status: 400`, before anything is written. Every other refusal is the engine's own error, unchanged: assert on its `code` and `status`.
