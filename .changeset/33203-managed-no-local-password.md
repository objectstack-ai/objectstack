---
'@objectstack/plugin-auth': patch
---

fix(auth)!: a cloud-managed environment sets no local password for anyone, a platform administrator included

Clause-②: yes (narrowing) — narrowed: on a cloud-managed environment only (`OS_CLOUD_MANAGED=1`), `POST /admin/set-user-password` now answers `409 RESOURCE_CONFLICT` for an `env_native` target too, where it set the password, and `POST /set-initial-password` now answers `409 RESOURCE_CONFLICT` to a signed-in platform administrator too, where it set their first local password. The two refusal sentences (`CLOUD_MANAGED_REFUSAL_MESSAGES.setUserPassword` and `.setInitialPassword`) no longer promise a local or break-glass password. The managed `set-user-password` arm no longer reads the target's identity source, so its `503 SERVICE_UNAVAILABLE` answer for an unreadable source is gone on a managed environment.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the cloud-managed password doors; `content/docs/permissions/authentication.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answers are runtime refusals at two auth doors under a deployment switch that only hosted environments set, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a cloud-managed environment (`OS_CLOUD_MANAGED=1`, set only on hosted containers): a hosted environment keeps no local password for anyone and has no local break-glass administrator. `POST /admin/set-user-password` (the Set Password action on a user) refuses every target, an environment-native account included, and `POST /set-initial-password` refuses every signed-in caller, a platform administrator included. Each answers `409 RESOURCE_CONFLICT` and writes nothing. A caller with no session at `set-initial-password` is answered as before.

Unchanged: every self-hosted deployment (the variable unset), where the doors answer as before, SSO-only mode's rules included; and a local password a user already holds on a managed environment (invalidating those is the hosting cloud's work).

What to do: nothing on a self-hosted deployment. On a hosted environment, sign in through the hosting organisation's identity provider; there is no local password to set.
