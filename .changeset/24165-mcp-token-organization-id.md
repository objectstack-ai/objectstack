---
'@objectstack/spec': minor
---

feat(spec/contracts): `IAuthService.verifyMcpAccessToken`'s verified result gains an optional `organizationId`, the organization the user's OAuth consent bound

Clause-②: yes (widening)

- **What changed.** The verified result of `verifyMcpAccessToken` (`@objectstack/spec/contracts`) is now `{ userId: string; scopes: string[]; clientId?: string; organizationId?: string }`. `organizationId` is the organization the user's OAuth consent bound (the user's current organization at the moment of consent), read from the access token's `organization_id` claim.
- **Absent** when no consent bound one: a token minted before consents bound an organization, and a machine-to-machine (`client_credentials`) token, which no user consented to. Absent means no organization, so only the user's global grants apply.
- **A claim, not an authorization.** A caller vets it on every request by the rule that vets a session's active organization (`vetOrganizationClaim`, `@objectstack/core`). Once no current membership backs it, the principal resolves with no organization (global grants only: tenant reads come back empty and tenant writes are refused), never in another organization. The token acts in that one organization only: never the union of the user's organizations, and never the organization the user's browser session has selected now.
- **Type only, and additive.** The member is optional, so an implementation that returns no `organizationId` still satisfies the contract, and nothing this package does at runtime changes. This package declares the member only: writing the claim at consent is the auth plugin's, and reading it into the OAuth session is the runtime's.
