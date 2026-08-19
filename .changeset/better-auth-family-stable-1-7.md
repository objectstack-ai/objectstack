---
"@objectstack/plugin-auth": patch
"@objectstack/platform-objects": patch
"@objectstack/client": patch
---

deps(auth): the better-auth family moves off the `1.7.0-rc.2` prerelease onto stable `^1.7.1` (#3002)

`@objectstack/plugin-auth` shipped with **exact pins on a release candidate** —
`better-auth`, `@better-auth/core`, `@better-auth/oauth-provider` and
`@better-auth/sso` all at `1.7.0-rc.2`. That pin was never housekeeping debt: it was
the remediation for **GHSA-p2fr-6hmx-4528** (`@better-auth/oauth-provider`) and
**GHSA-j8v8-g9cx-5qf4** (`@better-auth/scim`, high — account/provider takeover), both
patched only in `>=1.7.0-beta.4`, so there was no stable line to move to. Upstream has
now shipped one: `npm view <pkg> dist-tags` reports `latest: 1.7.1` for every family
member. The declarations become `^1.7.1`, which is what a downstream
`npx create-objectstack` install now resolves.

**`@better-auth/scim` deliberately stays at `1.7.0-rc.1`.** Measured against the
published stable tarball rather than assumed: `@better-auth/scim@1.7.1` ships the rc.2
**rewrite** — no `scimProvider` model, no generate-token endpoint, and six replacement
models (`scimUser`, `scimGroup`, `scimGroupMember`, `scimSubject`,
`scimConnectionBinding`, `scimIdentityTombstone`). Adopting it is a feature migration
(ADR-0071, tracked separately), not a version bump. The hold stays security-clean: rc.1
is above the advisory's fix floor, `pnpm audit --audit-level=high` is green, and rc.1's
peer ranges accept the stable 1.7.1 core the rest of the family resolves to.

**Three pieces of upstream drift are absorbed here, and one of them was a live
sign-in outage waiting to happen.**

`1.7.0-rc.2` renamed the account model's `accountId` field to `providerAccountId`;
**stable 1.7.0/1.7.1 renamed it back to `accountId`**, keeping the new required
`issuer`. Carrying the rc.2 spelling into the stable line left the field unmapped, so
better-auth's adapter asked for a column named `accountId` and **every sign-up answered
500** — `Unknown field 'accountId' on object 'sys_account'`. The `account_id` column
itself never changed and no data moves; only the camelCase key does. The same rename
reaches `@objectstack/client`: `auth.accounts.list()` (better-auth's `/list-accounts`)
returns `accountId`, and its declared response type said `providerAccountId`. If you
read that field off the client's typed response, rename it.

`@better-auth/oauth-provider` 1.7.1's client model writes three fields the platform
object did not answer for. `applicationType` is the OIDC spelling of what rc.2 called
`type`, so it maps onto the **existing** `type` column and no data moves;
`clientDiscoveryId` and `clientCredentialsScopes` are genuinely new and are now
declared on `sys_oauth_application` as `client_discovery_id` and
`client_credentials_scopes`. Without them, dynamic client registration
(`POST /oauth2/register`) fails at the driver.

Two endpoints are newly mounted by the auth catch-all and are now ledgered:
`POST /oauth2/end-session` and `POST /oauth2/end-session/confirm` — the POST form of
OIDC RP-initiated logout, whose `GET` counterpart was already published.

**Nothing here needs an action on upgrade.** The new columns are additive and optional,
and the field rename is internal to how the plugin talks to better-auth — with the one
exception of the `@objectstack/client` response type named above.
