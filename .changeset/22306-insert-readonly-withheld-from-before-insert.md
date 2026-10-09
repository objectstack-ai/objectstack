---
'@objectstack/objectql': patch
---

A `beforeInsert` hook is no longer shown a caller-supplied value for a `readonly` field, so a hook that stamps an absent read-only column stamps it even when the caller sent one.

Clause-②: no

On a non-system create, the engine took a caller's value for a static `readonly` field out of the row only after `beforeInsert` had run. A hook that stamps such a field only when it is absent (`if (!data.stage_entry_date) data.stage_entry_date = today`) saw the caller's value and did nothing, and the strip then dropped that value. The row stored NULL where the hook would have stamped today. Measured on a real engine over the SQL driver: with the key in the payload the row stored `stage_entry_date` and `days_in_stage` NULL, and without it the hook stamped both. This is the insert-side twin of the `beforeUpdate` rule: a hook is never handed a value that will not be stored.

What changed:

- The same values the create-side static `readonly` strip takes are withheld from `ctx.input.data` before `beforeInsert` runs, and before the defaults. So the hook sees what an honest caller's hook sees: the field's `defaultValue`, or no key.
- The strip itself has not moved. It still runs after the hooks, and the caller's values are handed back to it there. So `onFieldsDropped`, the read-only WARN and `strictReadonlyWrites` see the same payload as before and act the same way on it. A hook that assigns a read-only field still has its value stored. A self-assignment (`data.x = data.x`) of a withheld field is a no-op: the caller's value is still stripped and reported, and `undefined` is never stored.
- Unchanged:
  - a system-context create (`isSystem`), which the strip does not apply to;
  - `sys_` and platform-internal objects, which keep their own write guards;
  - a runtime-owned `autonumber` value, which stays visible to the hook;
  - the audit timeline under `preserveAudit`, which the historical-import channel reinstates through a `beforeInsert` hook.
- A hook that faults reaching through a withheld field (`ctx.input.meta.who = …`) is answered 400, naming the field, the way `beforeUpdate` already answers.

Who is affected: a `beforeInsert` handler that reads a `readonly` field from `ctx.input.data` on a non-system create. The value it used to read was never stored, so it should derive nothing from it. A handler that owns the field assigns it.
