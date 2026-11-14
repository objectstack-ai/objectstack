---
'@objectstack/plugin-auth': patch
---

fix(auth)!: an unmapped SAML sign-in reads the standard email and name claims before the NameID, and an SSO provider creates an account only for an email address

Clause-②: yes (narrowing) — narrowed: a new account a SAML or OIDC sign-in would create through an `@better-auth/sso` provider is refused `403 INVALID_EMAIL` (`error=INVALID_EMAIL` on the sign-in's error redirect) when the email the sign-in resolved to is not an email address, with SSO domain verification off as well as on, where it was created with that value as its email. Widened: for each SAML attribute-mapping member a provider leaves unset, the sign-in first reads the standard claim the assertion carries (`http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`, `givenname`, `surname`, `name`), where it read only `email` / `givenName` / `surname` / `displayName` and the NameID. No first-party composition in this repository registers a SAML or OIDC provider.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the SAML attribute mapping or SSO account creation; `content/docs/permissions/sso.mdx` gains both rules in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped, and no stored row changes: the provider's stored mapping is read as before, the added claims are read at sign-in only, and the moved answer is a runtime refusal at account creation, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment whose SAML or OIDC provider resolves a person to a value that is not an email address: such a sign-in no longer creates an account. The common case is an identity provider that sends no email attribute, so the sign-in fell back to an opaque persistent or transient NameID (Microsoft Entra ID's IdP-initiated sign-in is one), or an OIDC mapping that names a claim holding a user name. With SSO domain verification on, such a value was already refused `EMAIL_DOMAIN_NOT_ALLOWED`, and still is. Also moved: for a SAML provider with no email mapping set whose assertion carries both a plain `email` attribute and the standard `emailaddress` claim, the standard claim now takes precedence, so where the two differ a new account is created at the claim's address rather than the `email` attribute's (an existing account still signs in by its account key).

Unchanged: an account that already exists signs in as before, whatever its email; linking; and every account creation that is not through an SSO provider.

What to do: nothing, unless a provider's users are created with a value that is not an address. For such a provider, map its email attribute (SAML) or claim (OIDC) to the one that carries the user's address.

The standard claims: Microsoft Entra ID and AD FS send them by default, and neither sends an `email` attribute, so an Entra ID provider with nothing mapped keyed its users on the NameID, an email-format user principal name when the sign-in started from the sign-in page and an opaque persistent id when it started from the identity provider's app portal. Both entries now resolve to the address in the `emailaddress` claim, so the second entry never creates another account: it finds the account the first one made and is refused `account_not_linked`, creating nothing, until that account is linked to it. A member an administrator mapped is always read as mapped, and a provider that sends `email` and none of these claims signs in exactly as before. A provider that encrypts its assertions reads only what it maps.
