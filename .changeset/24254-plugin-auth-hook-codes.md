---
"@objectstack/spec": minor
---

feat(spec): register four organization and invitation-placement refusal codes under `@objectstack/plugin-auth`

Clause-②: yes (widening)

The error-code ledger (`ERROR_CODE_LEDGER`, and so `ErrorCode`) gains four `@objectstack/plugin-auth` codes. Each names a hook refusal that today answers a bare `403 FORBIDDEN` with a message and no `code`, so a client such as the console cannot tell it apart from any other refusal on the same endpoint:

- `ORGANIZATION_CREATION_DISABLED`: creating an organization is refused for every caller, because the deployment's effective tenancy posture enforces no organization wall (`/auth/config` reports `features.multiOrgEnabled: false`).
- `ORGANIZATION_SLUG_LOCKED_BY_ACTIVE_ENVIRONMENTS`: an organization's slug cannot change while the organization has an environment whose status is neither archived nor failed.
- `INVITE_PLACEMENT_UNSUPPORTED`: fail-closed. The invitation carries a placement (a business unit and positions), and this deployment has no delegated-administration runtime to authorize it.
- `INVITE_PLACEMENT_OUTSIDE_ISSUER_SCOPE`: the delegated-administration gate refused the invitation's placement, because the business unit or a position lies outside the issuer's delegated scope.

Registration only: `@objectstack/plugin-auth` still throws these refusals without a code until #24243 stamps them. The same change names a standard code, which needs no ledger row, for the plugin's other four code-less refusals: `RATE_LIMIT_EXCEEDED` for both phone-OTP send walls, which stay indistinguishable; `SERVICE_UNAVAILABLE` for the slug guard's read fault; and `VALIDATION_ERROR` for the reserved `__global__` organization id or slug. No existing code changes, and no standard-catalog member is shadowed (none needs a synonym waiver).
