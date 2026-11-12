---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): SSO sign-in by email reads every provider, not the first 100

Clause-②: yes (widening)
Metadata-protocol: none

`@better-auth/sso` reads the SSO provider table with no limit in three places and treats the answer as the whole table: `/sign-in/sso` by email (its second step, which matches an address to a provider whose domain list covers it, such as a subdomain of a listed domain or a non-first entry of a comma-separated list), `/sso/providers`, and the per-user quota check in `/sso/register`. better-auth's adapter factory turns a read with no limit into its default of 100 rows, so with more than 100 providers an address whose provider sat at row 101 or later was refused with `404 No provider found for the issuer`, and `/sso/providers` left out a caller's own providers past row 100. Those reads now see every row. Which provider an address routes to is unchanged: matching is still the vendor's own, in the same row order; every other better-auth model keeps the factory's 100-row default.
