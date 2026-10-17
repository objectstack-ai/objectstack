---
'@objectstack/plugin-auth': minor
'@objectstack/platform-objects': patch
---

feat(plugin-auth): an OAuth consent binds the consenting user's active organization, the access token carries it as `organization_id`, and `verifyMcpAccessToken` returns it as `organizationId`

Clause-②: yes (widening)

- **What changed.** When a user consents to an OAuth client, the embedded authorization server records the consenting session's active organization as the consent's `reference_id`. The value rides the authorization code onto the refresh family it starts (`sys_oauth_refresh_token.reference_id`), and every access token minted from either carries it as the `organization_id` claim. It is written through the installed `@better-auth/oauth-provider`'s own seams (`postLogin.consentReferenceId` and `customAccessTokenClaims`); no new configuration key or environment variable.
- **The session's organization, never the request's.** The value is read from the consenting session only. Nothing in the authorize request, the consent body or the client's registration can choose it.
- **No organization, no claim.** A user with no active organization at consent gets a consent with no reference, and tokens with no `organization_id`. There is no guessed or default organization; such a token's principal resolves with global grants only.
- **A refresh keeps the consent's organization.** A refresh token mints access tokens in the organization its consent bound, even after the user switches the browser session to another organization. Authorizing again while another organization is active asks for a second consent, for that organization.
- **Existing consents re-confirm once.** A consent stored before this change has no reference, so the next authorization made while the user has an active organization shows the consent page again, once. Until the user re-confirms, a refresh family started before this change keeps minting tokens with no `organization_id`, so they carry global grants only.
- **`AuthManager.verifyMcpAccessToken`.** Its result type gains `organizationId?: string`, matching `IAuthService.verifyMcpAccessToken` in `@objectstack/spec/contracts`, and it returns the token's `organization_id` claim there. A token whose `organization_id` is present but is not a non-empty string is refused, as every other malformed token is: this server never mints one. The organization is a record, not an authorization. The caller vets it against a current membership on every request.
- **`@objectstack/platform-objects`.** The `reference_id` field description on `sys_oauth_consent`, `sys_oauth_refresh_token` and `sys_oauth_access_token` now names the bound organization, instead of "Caller-supplied correlation identifier". Prose only; no field, type or schema change.
