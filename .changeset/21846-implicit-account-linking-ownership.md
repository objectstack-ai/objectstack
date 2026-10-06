---
'@objectstack/plugin-auth': minor
---

fix(plugin-auth)!: implicit account linking on external sign-in requires the library's standard local-ownership condition; the platform identity provider keeps its documented exception; an unlink is honoured

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, export or config field is removed or renamed: the change narrows when an external sign-in links implicitly to an existing local user, and nothing an author wrote needs rewriting. The one config key it reads, account.accountLinking.requireLocalEmailVerified, keeps its name and gains an explicit opt-out meaning. -->

**BREAKING for deployments that relied on external sign-in (OAuth, OIDC, SSO) linking implicitly to a local user whose email is not verified.**

**What changed.**

- An external sign-in links implicitly to an existing local user only when that local user's email is verified. Otherwise the sign-in is refused with `error=account_not_linked`, the same code better-auth's own refusal produces. No link is written and the local user stays unverified. A verified local user links as before.
- The platform's own identity provider (`objectstack-cloud`) keeps its documented exception and still links to an unverified local user, because it seeds the environment owner's row without a mailbox round-trip.
- After a user unlinks a provider, an implicit sign-in through it no longer links the identity again, for any provider. An explicit, signed-in link from account settings (`/link-social`) is still allowed and ends the refusal. If the unlink cannot be recorded, the unlink itself is refused and the provider stays linked. Deleting a user removes the user's unlink records.
- A deployment that passes `secondaryStorage` to the auth plugin now also keeps verification values in the database (`verification.storeInDatabase: true`). The cache still fronts them. This keeps the unlink records durable when the cache evicts entries. Deployments without `secondaryStorage` are unchanged.
- `account.accountLinking.requireLocalEmailVerified` now reads as follows. Unset (the default) means the rules above. `true` applies the strict check to every provider, including `objectstack-cloud`. `false` turns off only the local-verification check and keeps the unlink rule.

**What to do after upgrading.**

- A user refused this way signs in with their existing method, then links the provider from account settings, or verifies their email first.
- To let unverified local users link implicitly again, set `account.accountLinking.requireLocalEmailVerified: false`. Before you do, read the library's warning about account takeover.
- If you pass `secondaryStorage`: verification values written to the cache alone before the upgrade (password-reset links, one-time codes, magic links and email-verification links that were in flight at deploy time) can no longer be consumed afterwards. Users who hit this request a fresh link or code once.
