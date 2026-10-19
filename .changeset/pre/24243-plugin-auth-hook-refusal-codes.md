---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): the organization, invitation-placement and phone-OTP hook refusals carry their ADR-0112 codes

Clause-②: no

Eight refusals thrown from plugin-auth's better-auth hooks answered with `message` alone, so a client could only show or match English prose. Each now carries a `code` it can branch on, and keeps its HTTP status.

- `POST /auth/organization/create`: the reserved `__global__` id or slug answers 400 `VALIDATION_ERROR`. Where the deployment's effective tenancy posture enforces no organization wall (`/auth/config` publishes `features.multiOrgEnabled: false`), creating an organization answers 403 `ORGANIZATION_CREATION_DISABLED`.
- `POST /auth/organization/invite-member` with placement intent (`businessUnitId` and `positions`): with no delegated-administration runtime to authorize it, 403 `INVITE_PLACEMENT_UNSUPPORTED`; refused by the delegated-administration gate, 403 `INVITE_PLACEMENT_OUTSIDE_ISSUER_SCOPE`.
- `POST /auth/organization/update` with a new slug: while the organization has an active environment (any environment that is neither archived nor failed), 403 `ORGANIZATION_SLUG_LOCKED_BY_ACTIVE_ENVIRONMENTS`. Its message no longer says environments "still reference" the organization or tells you to rename their hostnames: the guard reads no hostname, and archiving those environments is the remedy. When the guard's own read cannot answer, 503 `SERVICE_UNAVAILABLE`.
- Phone OTP sends (`/auth/phone-number/send-otp`, `/auth/phone-number/request-password-reset`): the per-number limit and the deployment's daily SMS quota both answer 429 `RATE_LIMIT_EXCEEDED`. It is one code for both walls, so a caller still cannot tell which budget it hit. The body is better-auth's flat `code` and `message`, with no `Retry-After` header.
- **One behaviour change:** a placement check that fails before the gate reaches a verdict (the issuer's grants could not be read from the store) now answers 503 `SERVICE_UNAVAILABLE`, not a 403 scope refusal carrying the store's message. No invitation is created either way.
