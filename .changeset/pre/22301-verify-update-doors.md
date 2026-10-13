---
'@objectstack/verify': minor
---

feat(verify): the handle gains a system-context update door and a predicate update door

Clause-②: yes (widening)

An app's tests reach two more engine write paths through the in-process handle, so a suite no longer calls the booted kernel's `objectql` service by hand for them.

- **The system principal on an update.** `hooks.run(object, 'update', { id, ...fields }, { system: true })` writes one row by id under `{ isSystem: true }`, the context a system job or an integration writes under. No permission gate applies. The bound hooks still run (they see `session.isSystem` and no `userId`), declared validations still refuse, and the record-change trigger fires its flows with no trigger user. The new type is `AsSystem` (`{ system: true }`), exported beside `AsUser`.
  - `{ system: true }` beside an `as` token is refused with `code: 'INVALID_REQUEST'`, `status: 400` before anything is written. Fixture rows are still `seed(object, rows)`, which also skips record triggers. (`insert` and `delete` take `{ system: true }` too: see the system insert and delete entry.)
- **The predicate update.** `hooks.updateWhere(object, where, data, opts)` is the engine's own predicate path, `update(object, data, { where, multi: true, context })`. It writes one payload to every row `where` selects and resolves with the affected-row count. The engine dispatches `beforeUpdate` and `afterUpdate` once per matched row, each bound to that row's own pre-image as `previous`, so record-change flows evaluate and fire per row. No REST door reaches this path: `POST /data/:object/updateMany` writes by id. The caller is `{ as: token }` or `{ system: true }`.
  - It refuses with `code: 'INVALID_REQUEST'`, `status: 400`, before the engine is touched, a `where` that is not an object, and a call the engine's own update dispatch would write by id: a `where` that names only an `id`, or an `id` in `data` beside a `where` that selects by nothing else. Write one row by id through `hooks.run(object, 'update', { id, ...fields }, opts)`. An `id` inside a larger predicate (`{ id, status: 'open' }`) stays a predicate update. An `id` in `data` beside a real predicate is refused by the engine itself, as it is on every caller.

Every other refusal from either door is the engine's own error, unchanged: assert on its `code` and `status`.
