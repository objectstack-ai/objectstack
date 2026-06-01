---
"@objectstack/platform-objects": minor
"@objectstack/plugin-approvals": minor
---

ADR-0029 K2.b — approvals domain ownership + Setup nav contribution.

Moves `sys_approval_request` / `sys_approval_action` out of the
`@objectstack/platform-objects` monolith into `@objectstack/plugin-approvals`,
which already registers and operates them — so the plugin now owns its data
model, behavior, and admin menu as one unit.

- The object definitions move to `plugin-approvals`; `platform-objects` no
  longer exports them from `/audit`. Runtime is unchanged (the plugin already
  registered them at runtime).
- **D7 navigation** — the Setup app's `group_approvals` entries (`Requests`,
  `Action History`) move out of `platform-objects`' `SETUP_NAV_CONTRIBUTIONS`
  into `plugin-approvals`' `navigationContributions`. The plugin fills the slot
  it owns; when the plugin is absent the slot stays empty.
- **i18n (D8)** — the objects are removed from the `platform-objects` i18n
  extract config; their existing generated translation bundles keep working at
  runtime (object-name keyed). Migrating the i18n extraction/bundles to the
  plugin remains the tracked cross-cutting follow-up (best done with the
  `os i18n extract` tooling, not hand-edited generated files).
