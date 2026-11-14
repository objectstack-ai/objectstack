---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: with SSO domain verification on, an SSO sign-in links to an existing account, or changes its email address, only at a domain the provider has proven

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches SSO domain verification, account linking or an address change through an SSO provider; `content/docs/permissions/sso.mdx` ("Domain verification (opt-in)") states the rule.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: sys_sso_provider and sys_user keep their columns, and no stored row changes shape. The rule is judged when an SSO sign-in reaches an account, so there is nothing at rest for a metadata migration to rewrite and no tombstone. -->

**BREAKING** — with SSO domain verification on (`OS_SSO_DOMAIN_VERIFICATION=true` or `plugins.ssoDomainVerification`), the rule that already decides account creation (an account reached through a provider holds an email address only at a domain that provider has proven) now also decides the two other ways an SSO sign-in (SAML or OIDC) reaches an account:

- **An implicit link.** A sign-in that links to an account that already exists is admitted only when the asserted email address is at one of the provider's listed, verified domains, matched exactly. Two cases, kept apart: an address at a domain the provider does not list at all was already not linked and is still refused as before, with the same answer; an address at a subdomain of a listed domain that is not itself listed and verified was linked before and is now refused with `EMAIL_DOMAIN_NOT_ALLOWED`.
- **An address change.** A later sign-in that would change the stored email address of an account the provider is already linked to (the provider is set to update the account from what the identity provider asserts) is admitted only when the new address is at one of those domains. A sign-in that would not change the stored address is not judged: one asserting the account's own address, and one through a provider that does not update the account (every SAML provider, and an OIDC provider whose update setting is off).
- A refusal under this rule is `EMAIL_DOMAIN_NOT_ALLOWED`, the code creation already answers: the sign-in redirects to the error page with `error=EMAIL_DOMAIN_NOT_ALLOWED`, no link is written, no session is issued, and the stored address is unchanged. A provider that cannot be read refuses.
- Unchanged: environments with verification off; sign-ins that would not change the stored address; explicit links from account settings; sign-ins through the cloud identity provider and enterprise OAuth providers.

**Who moves.**

- A deployment with verification on, whose people already hold local accounts at a subdomain of a domain its provider lists (for example `eng.acme.com` under a provider listing `acme.com`), lists that subdomain on the provider and verifies it before those people first sign in through the provider. Accounts at a domain the provider does not list at all were not linked before either; nothing moves for them.
- A deployment with verification on, whose provider updates accounts from what its identity provider asserts and whose people move to a new email domain, lists the new domain on the provider and verifies it before the move.
