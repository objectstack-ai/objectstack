---
"@objectstack/service-automation": minor
"@objectstack/runtime": minor
---

feat(automation): honor flow deployment status for enable/disable + expose runtime enable/bound state

The engine bound and ran **every** registered flow, ignoring the flow's
persisted `status` — so an author had no way to turn an automation off (short of
deleting it) and no way to see whether one was actually live. This is the engine
half of the Studio's "clear on/off switch + visible enabled/bound status".

- **`registerFlow` now honors `status`:** a flow whose deployment `status` is
  `obsolete` or `invalid` is treated as **disabled** — its trigger is not bound
  and `execute()` refuses it. `draft` / `active` — and any legacy flow with no
  explicit status — stay enabled, so **existing flows are unaffected** (zero
  regression; this is the on/off switch persisting via the existing `status`
  field, applied on the next publish rebind). A status flip back OUT of a
  disabled state re-enables on re-register even if the flow had been turned off;
  a runtime `toggleFlow()` override on a still-enabled flow is preserved.

- **New `getFlowRuntimeStates()` + `GET /api/v1/automation/_status`:** returns
  `[{ name, enabled, bound }]` for every registered flow — the truth behind the
  Studio's status badges (persisted `status` is metadata; whether a flow is
  actually enabled and wired to its trigger is engine state). Underscore-prefixed
  so no flow name can shadow the route; degrades to an empty list on an older
  service.

Tests cover: draft/active flows bind + enable (unchanged), an `obsolete` flow is
neither bound nor enabled and `execute()` refuses it, a status flip
obsolete→active re-enables + re-binds, and the `_status` route shape.
