---
'@objectstack/core': patch
'@objectstack/runtime': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-security': patch
'@objectstack/platform-objects': patch
---

feat(plugin-auth): register an AI service account and mint its API key (ADR-0151 D1, D4)

Clause-②: yes (widening) — two new auth doors (`POST /api/v1/auth/service-account/register`, `POST /api/v1/auth/service-account/create-key`), two new `sys_user` actions, and `readRequestedApiKeyExpiry`, `signApiKeyExpiry`, `API_KEY_EXPIRY_TOO_LONG_CODE` and `ApiKeyExpiryRefusal` newly exported by `@objectstack/core`. Nothing existing is removed, retyped or refused: the break-glass guard and the upgrade-report audience now leave AI service accounts out, and an account row is only written by the new door (or by a seed).
Metadata-protocol: none

An organization administrator, or a platform administrator, can now register an **AI service account**: Setup → Users → *Register AI Service Account*, or `POST /api/v1/auth/service-account/register` with a `name` and an optional `ownerId`. One act writes a `sys_user` of kind `agent`, accountable to the named owner (the caller by default; the owner must be an active member of the organization), with a placeholder email that is never delivered and never collides with a real address, and a plain `member` membership of the caller's active organization. If either write is refused, neither stays.

The account's owner, an administrator of its organization, or a platform administrator mints its API key: *Create API Key* on the account, or `POST /api/v1/auth/service-account/create-key` with `userId`. The key is shown once, bound to the account's organization, and signed under the same expiry policy and ceiling as `POST /api/v1/keys` (the two now share one rule in `@objectstack/core`). The key acts as the account, under the agent ceiling.

Both doors read the caller from a signed-in session only: anonymous is `401`, and a caller carrying only an API key (the account's own included) is `401` too, so an account can neither register another nor mint its own key. Refusals reuse the existing codes: `403 PERMISSION_DENIED`, `400 VALIDATION_FAILED`, `404 RESOURCE_NOT_FOUND` for an id that is not an account, `409 RESOURCE_CONFLICT` for an account with no active membership, `503` when the authority read is unavailable.

An AI service account is never counted as one of the administrators the break-glass guard keeps (whatever grant or membership grade it holds), and never receives the upgrade report or counts as an organization's administrator there.
