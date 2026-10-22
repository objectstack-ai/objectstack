---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): SSO domain verification accepts the DNS TXT record that request-domain-verification tells the operator to publish (#25111)

Clause-②: no — the verify door now accepts the record the platform already names, as `@better-auth/sso` designed it; the one record it stops accepting is `undefined=TOKEN`, which only the defect produced and nothing instructs.
Metadata-protocol: none

`POST /api/v1/auth/admin/sso/request-domain-verification` tells the operator to publish a TXT record named `_better-auth-token-PROVIDER.DOMAIN` with the value `_better-auth-token-PROVIDER=TOKEN`. `POST /api/v1/auth/admin/sso/verify-domain` (and the vendor route behind it, `POST /api/v1/auth/sso/verify-domain`) refused exactly that record with `502 DOMAIN_VERIFICATION_FAILED`. The vendor builds the record it accepts from the verification row's `identifier`, and the storage adapter handed it that row without the column (`sys_verification.identifier` is `internal`), so it expected `undefined=TOKEN`.

- **Now.** The adapter hands better-auth the row's `identifier` the same way it already hands back `value`. The instructed record verifies on both doors and marks the provider verified.
- **Still refused.** A wrong token, the token under another provider's label, the record published under another provider's name, and `undefined=TOKEN`: each answers `502 DOMAIN_VERIFICATION_FAILED` and leaves the provider unverified.
- **Unchanged.** A record holding only the token is still accepted, as the vendor designed it. The generic data API still omits `identifier` from every `sys_verification` row.
