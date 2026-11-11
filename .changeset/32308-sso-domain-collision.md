---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: the SSO domain check refuses a subdomain listed beside its parent's provider, and compares every domain in one spelling

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. The new refusals are answers of the auth routes to a request; no stored provider row is rewritten or re-checked by the upgrade, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on SSO provider registration and provider domain edits (`@objectstack/plugin-auth`).

`POST /api/v1/auth/sso/register`, the `register_sso_provider` / `register_saml_provider` actions behind `/api/v1/auth/admin/sso/register` and `/register-saml`, and `POST /api/v1/auth/sso/update-provider` with a `domain` already refuse `409 RESOURCE_CONFLICT` (`field: 'domain'`) a domain entry another SSO provider lists. Sign-in first looks for a provider whose whole `domain` value equals the address's domain, then takes the first provider, in the store's row order, whose list holds the domain or a parent of it. Three more shapes are now refused the same way: the first two because sign-in would not reliably reach the second provider by address, the third because its two spellings name one DNS domain. Each was accepted before this release and saved the provider; each is now refused `409 RESOURCE_CONFLICT` with `field: 'domain'`, and nothing is saved:

- **A listed subdomain beside its parent's provider.** Before: `eng.acme.com, foo.com` (or `https://eng.acme.com`, or `Eng.Acme.com`), registered or written by a domain edit beside a provider for `acme.com`, was saved, and sign-in for `eng.acme.com` went to whichever of the two came first in row order. Now: refused, naming the parent entry (`through its entry 'acme.com'`) and, to a platform administrator, the provider that holds it (`heldBy`).
- **A parent beside a provider that lists the subdomain.** Before: `acme.com`, registered or written by a domain edit beside a provider whose list holds `eng.acme.com`, was saved. Now: refused, naming the subdomain entry and, to a platform administrator, its provider.
- **One domain in another spelling.** Two legs are newly refused. Before: a punycode entry requested beside the same name stored in Unicode (`xn--bcher-kva.de` beside a stored `bücher.de`), and an entry with a trailing root dot beside the same name without it (`acme.com.` beside a stored `acme.com`), were saved, because the store was narrowed by the raw text of the request. (The reverse internationalised leg, `MÜNCHEN.de` requested beside a stored `xn--mnchen-3ya.de`, was already refused: the request was parsed to punycode before the store was read.) Now: every entry on both sides is compared as one lower-case ASCII host (punycode for an internationalised name, trailing root dot dropped), so both legs are refused as one DNS domain. Sign-in itself does not convert between Unicode and punycode, so each spelling routes only to a provider stored in that spelling; the refusal rests on the two being one domain, which the platform gives one provider.

Still accepted, either way round: a provider whose whole domain is exactly `eng.acme.com` beside one for `acme.com`, and entries that only look alike (`xacme.com` beside `acme.com`, `bucher.de` beside `bücher.de`). To register a refused provider, give the subdomain a provider whose only domain entry it is, or edit the parent (or the listed subdomain) off the provider that holds it.

**Providers already stored are not touched.** A pair that already collides in one of these shapes stays stored, and this release does not change how sign-in routes between them; nothing re-checks the store at upgrade or at boot. The check runs only on a request that writes a domain: a register, or an `update-provider` that carries `domain`. An `update-provider` without `domain` (an OIDC or SAML settings edit) is not judged and passes. An `update-provider` that carries `domain` is judged even when it re-saves the provider's stored value unchanged, so either provider of a stored colliding pair is refused `409` on a domain write until one of them edits the colliding entry off; after that, both save cleanly. Deleting either provider is not affected.

Two registers racing for one domain can still both pass: the check is a read before the vendor's insert, and the store holds no constraint that expresses the rule.
