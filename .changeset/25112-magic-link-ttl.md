---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the Magic Link mail states the lifetime the link really has, five minutes

Clause-②: no

Metadata-protocol: none

The `auth.magic_link` mail said "This link expires in 10 minutes", while the link it carried lived 300 seconds: `magicLink()` was mounted without `expiresIn`, so better-auth's own default applied, and the mail's `expiresInMinutes` was a separate hard-coded `10`. The mount now states `expiresIn: 300` explicitly, and the mail's `expiresInMinutes` is derived from that same value, so every locale of the mail now reads "5 minutes". The link's lifetime does not change. Nothing to do on upgrade; a customised `auth.magic_link` template that hard-codes its own number should read `expiresInMinutes` instead.
