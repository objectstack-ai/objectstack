---
'@objectstack/plugin-security': minor
---

feat(plugin-security): `getRecordFieldAccess` answers `writable`, from the write gate run over an update of the row

Clause-②: yes (widening)
Metadata-protocol: added

The record field-access answer gains `writable`. It is not composed from the gate's parts: the plugin keeps the authorization middleware it registers on the engine and runs that same function over a by-id update of the stored row with an empty payload, ending the chain before the engine's executor (hooks, validation, the driver write and audit). Every row-level gate the write meets is therefore the one the verdict meets: the object grant, the row-level security pre-image with the ownership floor, and the controlled-by-parent master. At the chain's end it asks plugin-sharing's by-id gate with the context as the middleware stamped it. Any refusal answers `false`, and so does a boot with no engine. The probe runs on a copy of the caller's context and advances no write epoch, so it leaves no shared state behind. `editable` is unchanged.
