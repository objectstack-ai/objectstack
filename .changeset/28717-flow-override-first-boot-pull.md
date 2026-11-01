---
'@objectstack/metadata-protocol': patch
'@objectstack/service-automation': patch
---

fix(metadata-protocol, service-automation): a declared `.custom` flow override is armed from the first boot pull, and a legacy package-less row of the same name is named in the boot's shadowing warning (#28717)

Clause-②: no
Metadata-protocol: none

A shipped flow name can hold two stored rows at once: the shipping package's declared override in `<base>.custom` (#28412) and a legacy package-less row saved before it. The registry keeps one bare slot per flow name, and the boot hydration used to give it to whichever row the store read last. When that was the legacy row, the automation boot pull never saw the override: it armed the base flow, and a record change fired before `kernel:ready` ran the base with no error.

- **The override keeps the slot.** The registry hydration now keeps the declared override in the name's bare slot over any other stored row of the name, in either read order. It is judged by the one served-override predicate on the row's stored `package_id` column, never on a body's `_packageId`. Every other pair of stored rows keeps "the last row read wins".
- **The legacy row stays stored and shadowed.** It is not deleted or migrated. The boot pull lists it beside the override, so the engine's shadowing receipt records it as a runtime row, and the existing collision warning names it with the override that is armed.
- **No change when only one row exists.** A legacy row alone is still shadowed by the base and warned. An override alone is still armed silently.

`shadowedStoredRowsOf` is newly exported from `@objectstack/metadata-protocol`. It returns the stored rows a hydrated flow body holds the bare slot over, carried as a non-enumerable symbol that never leaves the process.
