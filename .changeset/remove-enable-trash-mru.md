---
"@objectstack/spec": minor
---

feat(spec)!: remove the dead `object.enable.trash` / `enable.mru` capability flags (#2377, ADR-0049 enforce-or-remove — close-out)

Both flags parsed and defaulted to `true` but had **no runtime consumer**:
every delete has always been a hard delete (no recycle bin), and no MRU
tracking was ever implemented. A default-true flag promising recoverability
is the worst kind of false affordance — first-party objects were authoring
`trash: false // Never soft-delete audit logs` in the belief that a
soft-delete existed to opt out of.

- `ObjectCapabilities` is now **`.strict()`** (pattern of the tenancy block,
  #2763): an unknown `enable` key — the retired `trash`/`mru` or a typo like
  `feedEnabled` — fails parse with upgrade guidance instead of stripping
  silently (#1535). The retired-key tombstones live in
  `CAPABILITIES_RETIRED_KEY_GUIDANCE`.
- ~45 first-party object definitions (platform-objects, plugin-security,
  plugin-audit, plugin-approvals, plugin-sharing, metadata-core,
  service-realtime, examples) dropped their inert `trash:`/`mru:` lines.
- Liveness ledger: both entries deleted (removal precedent: `tags`/
  `recordName`); object row in the README count table now shows **0 dead**.
- Docs + skills no longer advertise a recycle bin / MRU tracking; the API
  skill's "DELETE is soft-delete when `trash: true`" claim is corrected to
  the real contract (hard delete; use per-field `trackHistory` or a
  `lifecycle` policy for recoverability).

**Migration**: delete any `enable.trash` / `enable.mru` keys from object
metadata — they never changed behavior. `ObjectSchema.create()` /
`ObjectCapabilities.parse()` now reject them with this prescription. A real
recycle bin or MRU feature, if built, returns as a live enforced flag
(#1893 prune-or-build).
