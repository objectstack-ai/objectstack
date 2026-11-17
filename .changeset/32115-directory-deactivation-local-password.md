---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a directory deactivation removes the user's local password; a re-activation restores access through SSO only

Clause-②: yes (narrowing) — narrowed: a SCIM `active: false`, a SCIM `DELETE /Users/{id}`, a SCIM create with `active: false`, and any later SCIM write that leaves the user inactive now also delete the user's local password (every `sys_account` row of the user with `provider_id = 'credential'`), where they left it in place. A later SCIM `active: true` lifts the directory's ban as before and restores no password, so a password sign-in by that user answers the ordinary `401 INVALID_EMAIL_OR_PASSWORD` until a password is set again on purpose.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the SCIM deactivation lifecycle; `content/docs/permissions/authentication.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The change is a runtime write on the SCIM deprovision path (rows of the better-auth account table), so there is nothing stored in metadata for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment that provisions users through a SCIM directory: deactivating or deleting a user through SCIM now removes that user's local password, alongside the ban, the API key revocation and the AI service account suspension it already performed. A re-activation lifts the ban and restores access through the identity provider's sign-in only; the user's other account links (SSO / OAuth) and the user row are kept.

Unchanged: an administrator's ban and unban (`admin/ban-user`, `admin/unban-user`) leave the local password alone; the `active: true` path removes nothing; a deactivation the break-glass last-administrator guard refuses removes nothing.

What to do: nothing. A person who needs a local password after a re-activation sets one again on purpose (`set-initial-password`, or an administrator's Set Password where the deployment allows it).
