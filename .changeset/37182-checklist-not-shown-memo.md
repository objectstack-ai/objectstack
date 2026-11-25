---
'@object-ui/console': patch
---

fix(console): a session the server answered "not shown" sends no first-run checklist reads on its next console opens

Clause-②: no
Metadata-protocol: none

Since the first-run checklist's reads moved above every app route, every session holding any capability sent `GET /api/settings` after the first paint on every console open, only to learn it may not write `localization` and is never shown the checklist: a plain member, and an ordinary organization owner on the cloud control plane (it holds `setup.write`, but that plane's `localization` manifest asks `manage_platform_settings`). The provider now remembers that answer on the device, per organization, user and capability set, for one day, and asks nothing while it stands. An administrator's reads are unchanged; a changed capability set, another user or organization, an expired record, or a failed read reads again.
