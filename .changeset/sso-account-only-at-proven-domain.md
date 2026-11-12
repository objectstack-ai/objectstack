---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: with SSO domain verification on, a provider creates an account only for an email address at a domain it has proven

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches SSO domain verification or account creation through an SSO provider; `content/docs/permissions/sso.mdx` ("Domain verification (opt-in)") states the rule.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: sys_sso_provider keeps its columns, and no stored row changes shape. The rule is judged when an account is created, so there is nothing at rest for a metadata migration to rewrite and no tombstone. -->

**BREAKING** — with SSO domain verification on (`OS_SSO_DOMAIN_VERIFICATION=true` or `plugins.ssoDomainVerification`), a new account created by a sign-in through an SSO provider (SAML or OIDC) is admitted only when the email address's domain is one of the provider's verified domains.

- A provider's verified domains are the domains its `domain` value lists, when the provider's domain verification has succeeded. One verified flag covers the whole list. A listed entry counts only for the host the provider proved: an entry not written as a bare host name (a URL, a port, a path) proves nothing, and the list's other entries still count.
- The address's domain must equal a listed domain. A subdomain counts only when it is itself listed and verified; a parent never counts for a listed subdomain. Case, and the Unicode and punycode forms of an internationalised name, are one domain. An address whose domain part is not a bare host name in that one spelling (a port, a path, a trailing dot, full-width letters) is refused.
- The refusal is `EMAIL_DOMAIN_NOT_ALLOWED`, an existing code: the sign-in redirects to the error page with `error=EMAIL_DOMAIN_NOT_ALLOWED`, and no user, account, membership or session is created. No audience posture, pending invitation, `allowJit` setting or first-user carve-out relaxes the rule.
- Unchanged: environments with verification off; accounts that already exist; account linking; sign-ins through the cloud identity provider and enterprise OAuth providers.

**Who moves.**

- A deployment with verification on, whose people first sign in at a subdomain or at another domain than the ones its provider lists, lists each such domain on the provider and verifies it.
- A provider whose domain list writes an entry as a URL or with a port or path (`https://acme.com`, `acme.com:443`) rewrites it as the bare host name (`acme.com`) and verifies the provider again.
- Editing a provider's domain list clears its verified state until every listed domain is proven again, so verify the provider again after adding a domain.
- Accounts that already exist are not re-checked; their sign-ins continue as before.
