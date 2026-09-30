---
'@objectstack/runtime': minor
---

fix(runtime)!: the /automation create and update doors save the flow as a tenant row, so what they answer 200 for survives a restart, and the removal door deletes that row too (#20862)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata changes shape and nothing an author wrote is renamed or removed, so `objectstack migrate meta` has nothing to rewrite. What moves is which definition writes and removals the /automation doors accept: the ones the metadata store refuses are now refused there too. -->

**BREAKING**: shipped as `minor` under the launch-window convention. `POST /api/v1/automation` and `PUT /api/v1/automation/:name` now refuse a definition the metadata store refuses, which they used to register and answer `200` for. `DELETE /api/v1/automation/:name` now relays a store's refusal to delete the flow's row.

**What changed.** The create and update doors registered a flow in the automation engine and wrote no metadata row. The next boot binds flows from the stored metadata, so a flow created through `POST /automation` was gone after a restart, and an update through `PUT /automation/:name` to a flow stored through `/meta` lost to the stored definition. Both doors now save the definition through the metadata protocol's own `saveMetaItem`: the save `PUT /api/v1/meta/flow/:name` uses, and the one the clone door (`POST /automation/:name/clone`) already used. The row is env-wide and live (`active`), so the flow reads back on `/meta` and survives a cold boot. The three doors share one path.

- **Engine first, store second.** The engine's registration is still the first check. Its refusal is answered as before (`400 VALIDATION_FAILED`), and nothing is saved.
- **A save the store refuses is relayed with its own code and status, and leaves no registration behind.** A create is withdrawn from the engine. An update puts back the definition the engine held, so a refused update does not take the flow down.
- **`DELETE /automation/:name` deletes the tenant row too**, through `deleteMetaItem`, so a flow created through the door does not come back at the next boot. The engine's own removal refusal (`DELETE_RESTRICTED` / `409`) is still raised before the store is touched. A name with no stored row is removed as before. A delete the store refuses puts the definition back and relays the refusal.
- **Unchanged:** the locked-base refusal on a packaged flow's name (`403 NOT_OVERRIDABLE`) and the refusal of a definition claiming a package's provenance (`422 INVALID_METADATA`) still answer first. A composition with no metadata protocol keeps the engine-only registration and removal it always had.

**Newly refused, because the metadata store refuses them** (measured on the showcase):

- A flow name with a leading underscore. `FlowSchema` admits it and the metadata item-name grammar does not, so the door answers `400 INVALID_REQUEST`. Rename the flow to a name that starts with a letter.
- A definition a gating runtime publish rule refuses, such as a default edge that also carries a condition (`flow-default-edge-with-condition`). The door answers `422 INVALID_METADATA` with the rule's finding. Fix the definition as the finding says.

Such a flow could never be stored, so before this change it ran only until the next restart.
