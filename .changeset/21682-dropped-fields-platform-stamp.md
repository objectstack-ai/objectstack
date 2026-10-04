---
'@objectstack/objectql': patch
---

`droppedFields` on a create names only keys the caller sent, never a value a write middleware filled in

Clause-②: no

With `@objectstack/organizations` mounted (the walled tenancy postures), a non-system create that names no `organization_id` has that column filled with the caller's active organization by the organizations write middleware. `ObjectQL.insert` took its record of what the caller sent after that middleware had run. So the static `readonly` strip treated the fill as a caller write, took it, and reported it:

- Before: `POST /api/v1/data/<object>` with a body that names no `organization_id` answered 201 with `droppedFields: [{ object, fields: ['organization_id'], reason: 'readonly' }]`. `onFieldsDropped` fired with the same event. The console showed it as a warning toast on every such create.
- After: the same create answers 201 with no `droppedFields`, and `onFieldsDropped` does not fire. The row is stored in the active organization, as before.

`insert` now records which keys each row carries before any write middleware runs. Only those keys count as sent by the caller. No field is exempted by name, so this covers every write middleware fill, including the `owner_id` fill of `@objectstack/plugin-security`. The referential-integrity check reads the same record, so it no longer checks a middleware-filled reference as if the caller had sent it.

Unchanged:

- A key the caller does send is judged and reported as before. That includes `organization_id` itself, and a key whose value a middleware rewrote.
- The array insert (`createMany`) and the `single` posture already reported nothing for an absent `organization_id`, and they still do.
- The stored row is the same. Before, the filled column was stripped and then filled again from the same active organization further down. Now the fill is kept.

No export, type, error code or status changes.
