---
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': minor
---

fix(runtime): the `/automation` write doors refuse a packaged flow, as the metadata door does (#20679)

Clause-②: yes (widening)

A flow that a code package ships has a locked base (ADR-0126 §2): changing or removing it in place is refused. `PUT /api/v1/meta/flow/:name` already refused it. The two `/automation` definition doors did not: an administrator holding `manage_metadata` could rewrite a packaged flow in the live engine with `PUT /api/v1/automation/:name` or with `POST /api/v1/automation` under its name (a create onto an existing name overwrites it), or remove it with `DELETE /api/v1/automation/:name`.

All three now answer a packaged flow with the same code and status the metadata door gives (`403` `NOT_OVERRIDABLE`), and with the same sentence wherever the metadata protocol's own package door answers. The refusal comes before the engine is called, so nothing is registered or removed. On `DELETE`, it also comes before the engine's own `DELETE_RESTRICTED` / `409` for a packaged subflow that packaged callers still reach.

What is not refused:

- A flow that no code package ships, including a flow created with `POST /api/v1/automation` or authored through the metadata door. It is updated and removed as before.
- `POST /api/v1/automation/:name/clone`, which copies a packaged flow under a new name. This is the supported way to customize one (ADR-0126 §7.1).
- `POST /api/v1/automation/:name/toggle`, the switch that turns a packaged flow on or off (ADR-0126 §7.2).
- A deployment that sets `OS_METADATA_WRITABLE=flow`. It opens both doors, as the refusal message says.

**The widening.** `@objectstack/metadata-protocol` gains one public method, `ObjectStackProtocolImplementation.packagedBaseRefusal({ type, name, operation })`. It returns the refusal the metadata door would give for writing (`'save'`) or removing (`'delete'`) an existing item because a code package ships it, or `null` when that door would not refuse on this ground. `saveMetaItem` and `deleteMetaItem` call the same code, so the two doors cannot disagree. Their own refusals are unchanged.
