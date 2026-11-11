---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the SSO domain check refuses a subdomain listed beside its parent's provider, and compares every domain in one spelling

Clause-②: no
Metadata-protocol: none

`POST /sso/register` (and both console register bridges) and a domain edit on `POST /sso/update-provider` already refuse `409 RESOURCE_CONFLICT` (`field: 'domain'`) a domain entry another SSO provider lists. Two more shapes are now refused the same way, because sign-in would not reliably reach the second provider by address:

- **A subdomain beside its parent, when the subdomain's provider does not hold it as its whole domain.** Sign-in first looks for a provider whose whole `domain` value equals the address's domain, then takes the first provider, in the store's row order, whose list holds the domain or a parent of it. So `eng.acme.com, foo.com` (or `https://eng.acme.com`, or `Eng.Acme.com`) beside a provider for `acme.com` left `eng.acme.com` to row order. It is refused in both registration orders: listing the subdomain beside the parent, and adding the parent beside a provider that lists the subdomain. A provider whose whole domain is exactly `eng.acme.com` beside one for `acme.com` is still accepted either way round.
- **One domain in another spelling.** `bücher.de` and `xn--bcher-kva.de` are one domain, and so are `acme.com.` and `acme.com`. Every provider is now read and compared in one spelling, the lower-case ASCII host; before, the store was narrowed by the raw text, so a domain stored in Unicode was missed by its punycode form.

To register such a provider, give the subdomain a provider whose only domain entry it is, or edit the parent (or the listed subdomain) off the provider that holds it. The refusal message names which case applies and, to a platform administrator, the holding provider (`heldBy`).

No stored provider is touched or re-checked. Two registers racing for one domain can still both pass: the check is a read before the vendor's insert, and the store holds no constraint that expresses the rule.
