---
'@objectstack/plugin-auth': minor
---

With SSO domain verification on, `POST /api/v1/auth/admin/sso/request-domain-verification` and `POST /api/v1/auth/admin/sso/verify-domain` answer an unknown `providerId` with `404 RESOURCE_NOT_FOUND`, no longer with `400 DOMAIN_VERIFICATION_DISABLED`

Clause-②: yes (widening)

- **Before.** With `OS_SSO_DOMAIN_VERIFICATION` on, a platform admin who sent a `providerId` that does not exist got `400 DOMAIN_VERIFICATION_DISABLED`, "Domain verification is not enabled for this environment (set OS_SSO_DOMAIN_VERIFICATION)": an instruction to turn on a feature that was already on. `@better-auth/sso` answers both an unmounted route (feature off) and an unknown provider (feature on) with a `404` that carries no `code`, and both bridges mapped every such `404` to the feature-off answer.
- **Now.** The two mounts hand each bridge the environment's own setting (`AuthManager.isSsoDomainVerificationEnabled()`). Off: `400 DOMAIN_VERIFICATION_DISABLED`, as before, and the vendor is no longer called. On: a code-less vendor `404` is the provider lookup missing, answered `404 RESOURCE_NOT_FOUND` with a message naming the provider id. The decision never reads the vendor's `404` wording.
- **Unchanged.** The platform-admin gate answers first, on or off (an anonymous caller gets `401`). A missing `providerId` is still `400 INVALID_REQUEST`. With the feature on, an existing provider still gets the vendor's own answer: the DNS record, `NO_PENDING_VERIFICATION`, `DOMAIN_VERIFICATION_FAILED`, a `403` for a provider the caller may not manage.
- **The exported bridges.** `runRequestDomainVerification` and `runVerifyDomain` take an optional third argument, `{ domainVerificationEnabled?: boolean }`. A caller that omits it keeps the earlier mapping: a code-less `404` is answered `400 DOMAIN_VERIFICATION_DISABLED`, byte for byte. A host that mounts these helpers itself passes the environment's setting to get the not-found answer.
