---
'@objectstack/objectql': minor
---

A `beforeInsert` hook is no longer shown a caller-supplied value for a `readonly` field, so a hook that stamps an absent read-only column stamps it even when the caller sent one.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) An enforcement-ORDER change to what a hook is shown. No authorable key, spelling, export or stored shape moves, so a stored `sys_metadata` row needs no conversion and an upgrader has nothing to hand-edit. What changes is the image a `beforeInsert` handler reads on `ctx.input.data` on a non-system create; a handler that depended on seeing a caller's read-only value fixes it in its own code, not in metadata. -->

**BREAKING** — what a `beforeInsert` handler reads on `ctx.input.data` changes on a non-system create. This ships as `minor` under the launch-window convention for breaking changes.

- **What it reads now.** A caller-supplied value for a field the create-side static `readonly` strip takes is not on `ctx.input.data`. The field holds its `defaultValue`, or there is no key, which is exactly what the hook sees when the caller did not send the field.
- **Which fields.** The withheld set is the create strip's own subject (`staticReadonlyInsertSubject`): author-declared `readonly: true` fields that are not runtime-owned, on an object outside the `sys_` namespace and the platform-internal `managedBy` buckets. It has two edges:
  - a runtime-owned `autonumber` value stays visible to the hook;
  - under `preserveAudit`, the audit timeline (`created_at`, `created_by`, `updated_at`, `updated_by`) stays visible, because the historical-import channel reinstates it through a `beforeInsert` hook.
- **Two answers at the REST door change.**
  - A hook that self-assigns a withheld field with no `defaultValue` (`data.x = data.x`) used to turn the caller's forged value into a hook write, which was stored. Under `strictReadonlyWrites` that create now answers 400 where it answered 201.
  - A hook or sandboxed `body` that reaches through a withheld field (`ctx.input.meta.who = …`) now faults, and the create answers 400 naming the field where it answered 201.
- A `system`-context create (`isSystem`) is unchanged: the strip does not apply to it, so nothing is withheld.

## The defect

On a non-system create, the engine took a caller's value for a static `readonly` field out of the row only after `beforeInsert` had run. A hook that stamps such a field only when it is absent (`if (!data.stage_entry_date) data.stage_entry_date = today`) saw the caller's value and did nothing, and the strip then dropped that value. The row stored NULL where the hook would have stamped today. Measured on a real engine over the SQL driver: with the key in the payload, the row stored `stage_entry_date` and `days_in_stage` NULL; without it, the hook stamped both. This is the insert-side twin of the `beforeUpdate` rule: a hook is never handed a value that will not be stored.

## What did not move

- **The strip still runs after the hooks.** The caller's values are handed back to it there, wherever no hook wrote the key. So `onFieldsDropped`, the read-only WARN and `strictReadonlyWrites` judge the same payload as before.
- **A hook that assigns a read-only field still has its value stored.**
- **A self-assignment (`data.x = data.x`) of a withheld field** follows the engine's rule:
  - with no `defaultValue` the hook reads `undefined`, the write is undone, and the caller's value is stripped and reported. `undefined` is never stored.
  - with a `defaultValue` the hook reads and re-assigns the default, which counts as the hook's write. The default is stored, and nothing is reported.
- **Faults are explained.** A hook that faults reaching through a withheld field is answered 400 naming the field, the way `beforeUpdate` already answers.

## Who is affected

A `beforeInsert` handler that reads a `readonly` field from `ctx.input.data` on a non-system create.

- **A handler that derives a value from the field:** the value it used to read was never stored, so it should derive nothing from it.
- **A handler that owns the field:** it assigns the field.
- **A handler that reports what the caller sent:** a create has no `ctx.submitted` to read it from.
