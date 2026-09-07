---
"@objectstack/plugin-sharing": patch
---

The share-link REST surface now derives the tenancy posture before it resolves the caller, so an API key stamped with an organization its owner has left can no longer mint links into that organization.

`resolveAuthzContext` gates every posture-conditional refusal on a `tenancyPosture` its **caller** supplies. `SharingServicePlugin`'s share-link door supplied none, so none of them ran: `organization_required` (`core/security/api-key.ts`), `organization_membership_ended` (`core/security/resolve-authz-context.ts`), and the session arm beside it that drops an `activeOrganizationId` claim no `sys_member` row backs. An API key's tenant is `sys_api_key.active_organization_id` copied verbatim — the caller's own stored claim, never vetted against current membership — so under a wall-enforcing posture (`isolated`, `group`) a key belonging to an ex-member was admitted carrying that organization, and `createLink` minted a capability token on a record inside it. The same door carried the session half: a browser session whose owner had been removed kept its organization claim until the session expired.

Measured at the door, under `isolated`: the ex-member's key went from `200` / `201` with the link landing in the store to `401` / `401` with nothing landing; an organization-less key went from admitted to `401`; an ex-member's *session* now has its stale claim dropped and is refused by Layer 0 at `403` while staying signed in. A current member and an anonymous caller are unchanged in every wiring.

A `tenancy` service that was **never registered** stays a supported composition and resolves quietly to "no posture" — behaviour on an embedding without `plugin-auth` is exactly what it was. A `tenancy` service that **was registered and failed to build** now raises `AuthzStoreUnavailableError`, which reaches the wire as `SERVICE_UNAVAILABLE` / 503 rather than being laundered into a `401`: admission was never decided, so it must not be answered.
