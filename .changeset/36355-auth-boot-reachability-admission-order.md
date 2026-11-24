---
'@objectstack/plugin-auth': patch
---

docs(plugin-auth): the `no_sign_in_account_at_boot` boot report now states the admission order the audience gate actually reads

Clause-②: no
Metadata-protocol: none

The recovery remedy in the boot report still holds — a pending `sys_invitation` row gets that one sign-up admitted under every audience posture — but its sentence said the invitation carve-out is what admits it everywhere. The audience gate reads the posture's own rule first: under `open`, and for an address on the `email_domain` allowlist, the posture admits the sign-up, invitation or not; the invitation admits it under `invite_only` and for an address off the allowlist. The message now says so. No admission behaviour changes.
