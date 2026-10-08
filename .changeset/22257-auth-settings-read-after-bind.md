---
'@objectstack/plugin-auth': patch
---

A seeded boot no longer reads the `auth` settings before the settings engine binds

Clause-②: no

Under `os serve` and `os dev`, an app with inline seed data emits `app:seeded` while plugins are still starting. The auth plugin's one-time membership backfill (ADR-0093 D6) ran on that event. Through it, the plugin bound the `auth` settings namespace before `SettingsServicePlugin` had bound its data engine. The boot logged `[SettingsService] Pre-bind READ of namespace 'auth'`, and the binding was computed from the manifest defaults, not from the saved `auth` settings. Measured on the showcase: one such line on every boot.

The backfill is now armed by its own `kernel:ready` hook, which runs after the settings plugin binds its engine. A trigger of the pass before that hook does nothing: the `kernel:ready` pass runs afterwards and scans the same rows. A seed that settles after `kernel:ready` still re-runs the pass, as before.

- **Which settings are read is unchanged.** Only the moment of the first read moves.
- **A saved `auth.membership_policy` governs the one-time pass.** Before, the pass's first run could read the manifest default `auto` while a saved `invite-only` sat unread.
