---
'@objectstack/runtime': patch
---

fix(runtime): an OAuth MCP agent acts in the organization the user's consent bound, so the user's organization-scoped grants count for it

Clause-②: no

- **What was wrong.** On the `/mcp` door, `resolveExecutionContext` built a verified OAuth access token's principal with no organization. The agent's delegator (the user it acts for, ADR-0090 D10) was then resolved with no active organization and held only its global grants. Every grant an administrator assigns is scoped to an organization, so an ordinary user's agent was refused every object operation: `on-behalf-of principal may not 'find' … the delegator lacks that grant (ADR-0090 D10 intersection)`.
- **What changed.** The principal is resolved in the organization the consent bound: the `organizationId` that `IAuthService.verifyMcpAccessToken` returns from the token's `organization_id` claim. It is handed to the shared resolver where a session carries its active organization, so it is vetted on every request by the rule a browser session's organization gets (`vetOrganizationClaim`, `@objectstack/core`). The user's grants scoped to that organization count for the agent; grants scoped to the user's other organizations do not. It is never the union of the user's organizations, never the organization the user's browser session has selected now, and never a widened global grant.
- **A membership that is gone.** Under a walled tenancy posture (`isolated`, `group`), a token whose organization the user no longer belongs to resolves with no organization, so only global grants apply. Under `isolated`, a former member's agent gets an empty `200` read and a refused tenant write. The same holds for an organization the user never belonged to, whatever put it on the token. Under `single`, or with no `tenancy` service, the organization stands as claimed, exactly as a browser session's does there.
- **Unchanged.** A token with no `organization_id` (minted before consents bound one, or by a user with no active organization at consent) resolves with no organization, as before: global grants only, until the user re-confirms the consent once. A platform admin's global grant applies as before. The API-key and session tracks are untouched.
