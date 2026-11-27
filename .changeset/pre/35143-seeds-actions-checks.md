---
'@objectstack/lint': minor
'@objectstack/spec': patch
'@objectstack/cli': patch
---

fix(lint)!: three publish-time checks for seeds, flow nodes and actions that save and do not work

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #37814

<!-- adr-0087: registered publish-refuses-seeds-and-actions-that-save-and-do-not-work -->

**BREAKING** for the publish of a seed, a flow, an action or an object that carries one of the errors below: it was accepted before and is refused now, with the fix named in the finding. The schema is unchanged and stored metadata is not rewritten or refused at boot; the refusal comes at the next publish, and from `os validate` / `lint` / `compile` / `build`.

- `seed-record-unknown-field`: a seed record key, or a seed `columns` key, that the engine's insert door would refuse: a key that names no field of the dataset's object, no system column the platform injects on it (`owner_id`, the tenant and audit columns, unless the object opts out), and none of the columns every table carries (`id`, `created_at`, `updated_at`). The seed load writes each record through that insert, so such a record is dropped while the rest load. An object with no field map is not judged, as the engine's door does not judge it. `defineSeed` already refused such a key when it ran; a plain `data: [{ object, records }]` entry and a `seed` saved at the runtime publish door are now judged too. A field an object extension adds counts. Runs on the runtime `seed` door.
- `object-reference-unknown` (and the warning `object-reference-unregistered-platform` for a platform-prefixed name no known package registers), at three more bindings: a seed dataset's `object`, a flow `get_record` / `create_record` / `update_record` / `delete_record` / object-form `screen` node's `config.objectName`, and a standalone action's `objectName`. A seed over a missing object loads nothing, and an action bound to one is carried by no page. A flow node is split as `flow-trigger-unknown-object` is: on `os validate` / `lint` / `build` an unprefixed name the stack does not define is a warning, because a package the stack declares in `dependencies` may define it and a build cannot see that package; at the runtime publish door it is an error, judged against the written package's closure, or against every object the deployment serves for a write that names no package, where a step bound to a missing object fails the run every time it executes. An object the stack extends resolves at these three. At the runtime publish door the seed binding stays with the save door's own refusal of a seed over an unknown object (#34864), which accepts a draft of the object in the same package; the rule now also runs on the runtime `action` door, so an `action` write is therefore also judged for its params' `reference` / `objectOverride` objects, as `os validate` already judged them, and an action saved into a package (`?package=`) is judged against that package's closure, as a flow saved there already was: an object another package owns resolves only when the manifest declares that package in `dependencies`.
- `action-body-write-capability-undeclared`: an L2 action body that calls a `ctx.api` write (`insert`, `update`, `delete`, `updateMany`, `deleteMany`, `upsert`) without `api.write` in its `body.capabilities`. The sandbox refuses the call with `403 INSUFFICIENT_PRIVILEGES` every time the action reaches it. Runs on the runtime `action` and `object` doors.

`os build` now infers `api.write` for every handler write shape the new check reads: a lone `updateMany` or `deleteMany`, `?.` before the leaf, an `.object(…)` argument holding a call, and a handle bound to `.object(…)` (`const repo = ctx.api.object('x'); repo.update(…)`). Before, such a handler was lowered with no grant and refused at every call.

## FROM → TO

- `data: [{ object: 'task', records: [{ name: 'a', stauts: 'open' }] }]` → `status: 'open'`, or declare `stauts` on `task`, or drop the key.
- `{ type: 'create_record', config: { objectName: 'invoce', … } }` → `objectName: 'invoice'` (the object's full, namespaced name).
- `body: { language: 'js', source: "await ctx.api.object('task').update(…)", capabilities: [] }` → `capabilities: ['api.write']`.

`@objectstack/lint` exports two rule id constants, `SEED_RECORD_UNKNOWN_FIELD` and `ACTION_BODY_WRITE_CAPABILITY_UNDECLARED`, so `os explain` carries an entry for each; the rules themselves are not exported. `@objectstack/spec` adds only the upgrade-guide entry `publish-refuses-seeds-and-actions-that-save-and-do-not-work`.
