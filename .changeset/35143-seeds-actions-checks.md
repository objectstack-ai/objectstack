---
'@objectstack/lint': minor
'@objectstack/spec': patch
'@objectstack/cli': patch
---

fix(lint)!: three publish-time checks for seeds, flow nodes and actions that save and do not work

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — `skills/objectstack-ui/rules/actions.md` teaches the `api.write` grant as prose ("without it the sandbox throws on a write"); the trap is now refused at validate and publish

<!-- adr-0087: registered publish-refuses-seeds-and-actions-that-save-and-do-not-work -->

**BREAKING** for the publish of a seed, a flow, an action or an object that carries one of the errors below: it was accepted before and is refused now, with the fix named in the finding. The schema is unchanged and stored metadata is not rewritten or refused at boot; the refusal comes at the next publish, and from `os validate` / `lint` / `compile` / `build`.

- `seed-record-unknown-field`: a seed record key, or a seed `columns` key, that names no field of the dataset's object nor a system column the platform injects on it (`created_at`, `owner_id` and the rest, unless the object opts out). The seed load writes each record through the engine's insert, which refuses a key the object does not declare, so the record is dropped while the rest load. `defineSeed` already refused such a key when it ran; a plain `data: [{ object, records }]` entry and a `seed` saved at the runtime publish door are now judged too. A field an object extension adds counts. Runs on the runtime `seed` door.
- `object-reference-unknown` (and the warning `object-reference-unregistered-platform` for a platform-prefixed name no known package registers), at three more bindings: a seed dataset's `object`, a flow `get_record` / `create_record` / `update_record` / `delete_record` / object-form `screen` node's `config.objectName`, and a standalone action's `objectName`. A seed over a missing object loads nothing, a flow step bound to one fails the run on every execution, and an action bound to one is carried by no page. An object the stack extends resolves at these three. At the runtime publish door the seed binding stays with the save door's own refusal of a seed over an unknown object (#34864), which accepts a draft of the object in the same package; the rule now also runs on the runtime `action` door, so an `action` write is therefore also judged for its params' `reference` / `objectOverride` objects, as `os validate` already judged them, and an action saved into a package (`?package=`) is judged against that package's closure, as a flow saved there already was: an object another package owns resolves only when the manifest declares that package in `dependencies`.
- `action-body-write-capability-undeclared`: an L2 action body that calls a `ctx.api` write (`insert`, `update`, `delete`, `updateMany`, `deleteMany`, `upsert`) without `api.write` in its `body.capabilities`. The sandbox refuses the call with `403 INSUFFICIENT_PRIVILEGES` every time the action reaches it. Runs on the runtime `action` and `object` doors.

`os build` now infers `api.write` for a handler whose only write is `updateMany` or `deleteMany`; before, such a handler was lowered with no grant and refused at every call.

## FROM → TO

- `data: [{ object: 'task', records: [{ name: 'a', stauts: 'open' }] }]` → `status: 'open'`, or declare `stauts` on `task`, or drop the key.
- `{ type: 'create_record', config: { objectName: 'invoce', … } }` → `objectName: 'invoice'` (the object's full, namespaced name).
- `body: { language: 'js', source: "await ctx.api.object('task').update(…)", capabilities: [] }` → `capabilities: ['api.write']`.

No new exports. `@objectstack/spec` adds only the upgrade-guide entry `publish-refuses-seeds-and-actions-that-save-and-do-not-work`.
