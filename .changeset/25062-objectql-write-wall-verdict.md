---
'@objectstack/objectql': patch
---

fix(objectql): the write preview (`validate()`, the import dry run) answers a row's `organization_id` from the Layer 0 tenant wall's own verdict

Clause-②: yes (widening)

Metadata-protocol: none

`validate()` runs no middleware, so the tenant write wall never judged a preview row. On a walled deployment (`group` or `isolated`) the preview reported a caller's `organization_id` as dropped where the write stores it as sent, and answered valid a row naming an organization the write refuses with 403.

- **New, optional: `ObjectQL.registerWriteWallVerdict(fn)`**, beside `registerWriteGateProbe`, with its types `WriteWallVerdict` and `WriteWallRowVerdict`. The layer that owns the wall registers it (`@objectstack/plugin-security` does), and the engine never decides the verdict itself.
- **`validate()` reads each row's verdict.** A row whose organization the wall judges keeps `organization_id` through the static `readonly` strip, so no `droppedFields` entry names it, as on the write. A row the wall refuses answers `valid: false` with the write's own code (`PERMISSION_DENIED`) and message, under `organization_id` for a refused value and `_record` for the caller's state, and it drops nothing. Rows stay independent, and the set's `valid` stays the conjunction. A row the strips changed is asked about again, as the write's stored-image half judges it.
- **Unregistered, nothing changes**: the strip runs as before, which is what the write does in a composition without the security plugin.
- **Named limit:** the preview runs no hooks, so an organization a `beforeInsert` / `beforeUpdate` hook writes is judged by the write alone.
