---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: with SSO domain verification on, an SSO sign-in links to an existing account, or changes its email address, only at a domain the provider has proven

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches SSO domain verification, account linking or an address change through an SSO provider; `content/docs/permissions/sso.mdx` ("Domain verification (opt-in)") states the rule.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: sys_sso_provider and sys_user keep their columns, and no stored row changes shape. The rule is judged when an SSO sign-in reaches an account, so there is nothing at rest for a metadata migration to rewrite and no tombstone. -->

**BREAKING** — with SSO domain verification on (`OS_SSO_DOMAIN_VERIFICATION=true` or `plugins.ssoDomainVerification`), the rule that already decides account creation (an account reached through a provider holds an email address only at a domain that provider has proven) now also decides the two other ways an SSO sign-in (SAML or OIDC) reaches an account:

- **An implicit link.** A sign-in that links to an account that already exists is admitted only when the asserted email address is at one of the provider's listed, verified domains, matched exactly: a subdomain counts only when it is itself listed and verified.
- **An address change.** A later sign-in into an account the provider is already linked to, asserting an email address other than the account's own, is admitted only when the asserted address is at one of those domains.
- The refusal is `EMAIL_DOMAIN_NOT_ALLOWED`, the code creation already answers: the sign-in redirects to the error page with `error=EMAIL_DOMAIN_NOT_ALLOWED`, no link is written, no session is issued, and the stored address is unchanged. A provider that cannot be read refuses.
- Unchanged: environments with verification off; sign-ins that assert the account's own address; explicit links from account settings; sign-ins through the cloud identity provider and enterprise OAuth providers.

**Who moves.**

- A deployment with verification on, whose people already hold local accounts at a subdomain or at another domain than the ones its provider lists, lists each such domain on the provider and verifies it before those people first sign in through the provider.
- A deployment with verification on, whose identity provider moves people to a new email domain, lists the new domain on the provider and verifies it before the move.
