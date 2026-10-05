---
'@objectstack/plugin-auth': patch
---

Implicit account linking on external sign-in (OAuth, OIDC, SSO) now requires the library's standard local-ownership condition: an external identity links implicitly to an existing local user only when that local user's email is verified. The platform's own identity provider (`objectstack-cloud`) keeps its documented exception, and a user's unlink is honoured.

Clause-②: no

- **Local ownership.** An external sign-in whose email matches an existing local user whose email is not verified is refused with `error=account_not_linked`. That is the same code better-auth's own refusal produces. No link is written and the local user stays unverified. A verified local user links as before.
- **Platform identity provider.** `objectstack-cloud` still links to an unverified local user, because it seeds the environment owner's row without a mailbox round-trip.
- **Unlink is honoured.** After a user unlinks a provider, an implicit sign-in through that provider no longer links the identity again, for any provider. An explicit, signed-in link from account settings (`/link-social`) is still allowed and ends the refusal.
- **Operator override.** `account.accountLinking.requireLocalEmailVerified` is now read as follows. Unset (the default) means the rules above. `true` applies the strict check to every provider, including `objectstack-cloud`. `false` turns off only the local-verification check and keeps the unlink rule.
- To let unverified local users link implicitly again, set `account.accountLinking.requireLocalEmailVerified: false`. Before you do, read the library's warning about account takeover.
