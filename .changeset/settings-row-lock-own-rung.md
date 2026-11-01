---
'@objectstack/service-settings': patch
---

fix(service-settings): a locked settings row binds the organization's own administrators; only the platform rung writes through a lock at its own scope

Clause-②: no
Metadata-protocol: none

A locked settings row is platform-locked. A lock at an upper scope already refused every write below it; a lock at the write's own scope now binds too:

- **A locked tenant row** refuses a save of that key by its own organization's administrators — `SettingsLockedError`, `409 SETTINGS_LOCKED` on `PUT /api/settings/:namespace`, `details.reason: 'locked-by-tenant'` — and a reset over it is refused the same way. Another organization's row and writes are unaffected.
- **A locked global row** refuses a write of that global key from anyone but the platform (`locked-by-global`).
- **The platform rung writes through**: a caller holding `manage_platform_settings`, or a trusted in-process caller (one whose `SettingsContext` is not `enforced`). The row keeps its lock after that write, on the engine store and on the in-memory store alike (the in-memory store now keeps a row's columns the write does not carry, as the engine's update does).
- A locked upper rung still refuses the platform's write below it, as before.
- The user rung carries no lock: `get()` reports none for a user row, and its owner's write is not refused.

The read side is unchanged: `get()`, `getMany()` and `getNamespace()` already reported such a row as `locked: true`, and the settings page already showed the field as locked. What they report as locked is now what a non-platform save is refused on.
