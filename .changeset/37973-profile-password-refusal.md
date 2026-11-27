---
'@object-ui/auth': patch
'@object-ui/console': patch
---

fix(console): the profile page's password card shows a password refusal in the session's language

Clause-②: no
Metadata-protocol: none

The profile page's password card (set a local password, change password) now maps a refusal's `code` through `passwordDoorRefusalMessages`, as the set-password and reset-password pages do: a 409 `RESOURCE_CONFLICT` (a cloud-managed runtime, an SSO-only account, a pending SSO person) shows the localized sentence instead of the server's English one. Any other code keeps the server's message.

`@object-ui/auth`: `sendVerificationEmail`, `signOut` and `signInWithProvider` now reject through the same error builder as the other doors, so the thrown error carries the refusal's `code` and HTTP `status`, read from better-auth's flat body or from the ADR-0112 envelope. The `message` is unchanged.
