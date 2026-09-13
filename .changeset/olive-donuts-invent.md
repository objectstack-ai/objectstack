---
'@objectstack/runtime': minor
---

**`AppPlugin` now names the manifest-stage `permissions` value its ADR-0057 security registrar cannot read, instead of dropping it in silence.**

The registrar flattens the manifest under the stack's own collections (`{ ...manifest, ...collections }`), so `manifest.permissions` is read whenever the stack declares no `permissions` collection of its own. That key is the ADR-0025 §3.2 capability grant a package *requests* — a flat list of permission strings, or `{ services, hooks, network, fs }` — while the registrar wants ADR-0090 `PermissionSet[]`. Both arms were skipped with nothing logged: the structured arm is not an array, so the whole value never entered the loop; every member of the flat list carries no `name`, so all of them were dropped. An author who wrote `manifest: { permissions: ['sales_rep'] }` meaning a permission set got no set registered, no `sys_audience_binding_suggestion`, and no line anywhere saying why — the "absence must be loud" rule in AGENTS.md → Route & surface ownership §3.

It now warns once per boot, naming the field, how many entries were lost, both readings of the key, and where permission sets belong (`defineStack({ permissions: [ … ] })`). The report is written per `SECURITY_FIELDS` entry, so a hand-built bundle carrying `positions` / `capabilities` / `sharingRules` on its manifest is named too.

**Nothing else moves.** Which items register is byte-for-byte unchanged — the registrar is deliberately *not* made tolerant of the grant reading (widening the key was rejected by name, #14242 road C, maintainer 2026-09-02). The line is `warn`, not `error`: nothing here claimed to persist anything. It stays silent on every shape where nothing was lost — a stack declaring its own `permissions` collection, a manifest with no such key, a manifest whose entries the registrar really can read, and the `securityMetadataRegistrar: 'artifact-door'` composition that owns the route.
