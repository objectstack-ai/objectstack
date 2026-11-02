---
'@objectstack/spec': minor
---

feat(spec): declare the nine remaining served `features` keys on the `GET /api/v1/auth/config` response

Clause-②: yes (widening)
Metadata-protocol: added

`AuthFeaturesConfigSchema` gains nine optional keys that the server already serves in `features` and the console already reads. The contract did not declare them, so a client that parsed the response through `GetAuthConfigResponseSchema` lost all nine, because a plain object schema strips keys it does not know.

- **Flags (booleans):** `multiOrgEnabled` (an organization wall is enforced; default-on, so absent reads as on), `degradedTenancy` (isolation was asked for but is not active), `oidcProvider` (the embedded OIDC authorization server is wired; default-on), `deviceAuthorization` (the device-code CLI login is wired), `admin` (the admin plugin is wired, forced on by SCIM).
- **Values:** `tenancyPosture` (`single` | `group` | `isolated`, the same vocabulary as `TenancyPostureSchema`), `audiencePosture` (`invite_only` | `email_domain` | `open`, the same vocabulary as `AUDIENCE_POSTURES`), `termsUrl` and `privacyUrl` (the legal links under the login card; absent when the operator suppressed them).
- None carries a default: a key the server does not send stays absent.
- A new test holds the schema's declared keys equal to `PUBLIC_AUTH_FEATURES` plus `PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS` (the retired `passkeys` / `magicLink` tombstones excepted), so the next served and classified key cannot be left undeclared.
- The development-only top-level `devSeedAdmin` hint stays undeclared on purpose: it carries the seeded admin's password and no production deployment serves it.

What to do: nothing. Every payload accepted before is accepted unchanged. A client that typed the response from `@objectstack/spec` (for example through `@objectstack/client`'s re-exported `AuthFeaturesConfig`) now sees the nine keys as optional.
